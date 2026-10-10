const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getPriceData, SHIPPING_FEE } = require('../lib/pricing');
const { getDb, admin } = require('../lib/venue');

exports.handler = async (event, context) => {
  // CORS Headers
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // Handle OPTIONS request for CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: 'Method Not Allowed' };
  }

  let consumedCouponRef = null;
  try {
    // ※割引の検証先（Firebaseプロジェクト）はクライアントから受け取らない（サーバー側の設定で固定）
    const { email, customer_name, customer_zip, customer_address, customer_phone, opt_in, items, coupon_code } = JSON.parse(event.body);

    if (!items || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'カートに商品がありません。' })
      };
    }

    // クーポンの検証と消費（1回限りのクーポンは、ここでサーバーが使用済みにする）
    let appliedDiscount = 0;
    if (coupon_code) {
      const result = await redeemCoupon(coupon_code);
      if (result.error) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: result.error }) };
      }
      appliedDiscount = result.discount;
      consumedCouponRef = result.consumedRef;
    }

    // Convert cart items to Stripe line_items format using securely calculated prices
    let totalSale = 0;
    
    const line_items = items.map(item => {
      const priceInfo = getPriceData(item.model, item.lens);
      let securePrice = priceInfo.sale;
      
      // クーポン割引適用 (各商品の単価を10%オフにする)
      if (appliedDiscount > 0) {
        securePrice = Math.floor(securePrice * (1 - appliedDiscount));
      }
      
      totalSale += securePrice;
      
      const productName = `AirFly ${item.model}`;
      const productDesc = `レンズ: ${item.lens} / フレーム: ${item.frame}` + (appliedDiscount > 0 ? ' (クーポン10%OFF適用済み)' : '');
      
      return {
        price_data: {
          currency: 'jpy',
          product_data: {
            name: productName,
            description: productDesc,
            // Webhook で商品明細を復元するために保持（セッションのメタデータは500文字制限があるため商品ごとに持たせる）
            metadata: { model: item.model, lens: item.lens, frame: item.frame },
          },
          unit_amount: securePrice,
        },
        quantity: 1,
      };
    });

    // 送料の追加
    line_items.push({
      price_data: {
        currency: 'jpy',
        product_data: {
          name: '送料（全国一律）',
        },
        unit_amount: SHIPPING_FEE,
      },
      quantity: 1,
    });
    totalSale += SHIPPING_FEE;

    // Create Stripe Checkout Session
    const origin = event.headers.origin || process.env.URL || 'http://localhost:8888';

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: email || undefined,
      line_items: line_items,
      mode: 'payment',
      success_url: `${origin}?success=true`,
      cancel_url: `${origin}?canceled=true`,
      metadata: {
        customer_email: email || '',
        customer_name: customer_name || '',
        customer_zip: customer_zip || '',
        customer_address: customer_address || '',
        customer_phone: customer_phone || '',
        opt_in: opt_in ? 'true' : 'false',
        total_amount: totalSale.toString()
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    // 決済画面を作れなかった場合は、消費したクーポンを未使用に戻す
    if (consumedCouponRef) {
      await consumedCouponRef.update({ isUsed: false, usedAt: admin.firestore.FieldValue.delete() })
        .catch(e => console.error('Failed to release coupon:', e));
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// クーポンを検証し、1回限りのものはトランザクションで使用済みにする（同時利用でも1回だけ成功する）
// 戻り値: { discount, consumedRef } または { error }
async function redeemCoupon(rawCode) {
  if (typeof rawCode !== 'string' || !rawCode.trim() || rawCode.length > 100 || rawCode.includes('/')) {
    return { error: '有効なクーポンコードではありません。' };
  }
  const db = getDb();
  const ref = db.collection('coupons').doc(rawCode.trim().toUpperCase());
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: '有効なクーポンコードではありません。' };
    const c = snap.data();

    const isUnlimited = c.isUnlimited === true;
    if (!isUnlimited && c.isUsed === true) {
      return { error: 'このクーポンコードはすでに使用されています。' };
    }
    if (c.expiresAt) {
      const expiry = c.expiresAt.toDate ? c.expiresAt.toDate() : new Date(c.expiresAt);
      expiry.setHours(23, 59, 59, 999);
      if (new Date() > expiry) return { error: 'このクーポンコードは有効期限が切れています。' };
    }

    // 割引率（10 = 10%）。範囲外の値は無効なクーポンとして扱う
    const rate = c.discountRate === undefined ? 10 : Number(c.discountRate);
    const discount = rate >= 1 ? rate / 100 : rate;
    if (!(discount > 0 && discount < 1)) return { error: '有効なクーポンコードではありません。' };

    if (isUnlimited) return { discount, consumedRef: null };
    tx.update(ref, { isUsed: true, usedAt: admin.firestore.FieldValue.serverTimestamp() });
    return { discount, consumedRef: ref };
  });
}
