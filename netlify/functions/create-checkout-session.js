const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { getPriceData, SHIPPING_FEE, KNOWN_MODELS } = require('../lib/pricing');
const { getDb, admin } = require('../lib/venue');

const MAX_ITEMS = 50;

function isShortString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

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
    const { email, customer_name, customer_zip, customer_address, customer_phone, opt_in, items, coupon_code, ref_source } = JSON.parse(event.body);

    if (!Array.isArray(items) || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'カートに商品がありません。' })
      };
    }
    // 明細はスプレッドシート・メールにそのまま載るため、カタログにある商品だけを受け付ける
    if (items.length > MAX_ITEMS) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `一度にご注文いただけるのは${MAX_ITEMS}点までです。` }) };
    }
    for (const item of items) {
      if (!item || !KNOWN_MODELS.includes(item.model) || !isShortString(item.lens, 50) || !isShortString(item.frame, 50)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: '商品情報が不正です。ページを再読み込みしてやり直してください。' }) };
      }
    }

    // クーポンの検証と消費（1回限り・回数上限つきのクーポンは、ここでサーバーが使用回数を更新する）
    let appliedDiscount = 0;
    // 台帳（スプレッドシート）に記録するクーポン。検証を通ったコードだけを入れる
    let appliedCouponCode = '';
    if (coupon_code) {
      const result = await redeemCoupon(coupon_code, ref_source);
      if (result.error) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: result.error }) };
      }
      appliedDiscount = result.discount;
      consumedCouponRef = result.consumedRef;
      appliedCouponCode = result.code;
    }

    // Convert cart items to Stripe line_items format using securely calculated prices
    let totalSale = 0;
    
    const line_items = items.map(item => {
      const priceInfo = getPriceData(item.model, item.lens);
      let securePrice = priceInfo.sale;
      
      // クーポン割引適用（各商品の単価に割引率をかける）
      if (appliedDiscount > 0) {
        securePrice = Math.floor(securePrice * (1 - appliedDiscount));
      }
      
      totalSale += securePrice;
      
      const productName = `AirFly ${item.model}`;
      const productDesc = `レンズ: ${item.lens} / フレーム: ${item.frame}` + (appliedDiscount > 0 ? ` (クーポン${Math.round(appliedDiscount * 100)}%OFF適用済み)` : '');
      
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
        total_amount: totalSale.toString(),
        // クーポン経由の注文を台帳で見分けるため（Stripeのmetadataは1つの値が500文字までなので短く保つ）
        coupon_code: appliedCouponCode,
        coupon_discount_rate: appliedDiscount > 0 ? String(Math.round(appliedDiscount * 100)) : ''
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    // 決済画面を作れなかった場合は、消費したクーポンを元に戻す
    if (consumedCouponRef) {
      await consumedCouponRef.ref.update(consumedCouponRef.rollbackUpdate)
        .catch(e => console.error('Failed to release coupon:', e));
    }
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};

// クーポンを検証し、1回限り・回数上限つきのものはトランザクションで使用回数を更新する
// 戻り値: { discount, consumedRef, code } または { error }
// code は Firestore に登録されている正規のコード（台帳に記録するのはこちら。ブラウザから来た文字列は使わない）
async function redeemCoupon(rawCode, refSource) {
  if (typeof rawCode !== 'string' || !rawCode.trim() || rawCode.length > 100 || rawCode.includes('/')) {
    return { error: '有効なクーポンコードではありません。' };
  }
  const normalizedCode = rawCode.trim().toUpperCase();
  const db = getDb();
  const ref = db.collection('coupons').doc(normalizedCode);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { error: '有効なクーポンコードではありません。' };
    const c = snap.data();

    // LINE限定クーポン（AF-LINE* または lineOnly === true）は ?ref=line 経由のみ許可
    const isLineCoupon = c.lineOnly === true || normalizedCode.startsWith('AF-LINE');
    if (isLineCoupon && refSource !== 'line') {
      return { error: 'このクーポンは公式LINEのご案内リンクからのみご利用いただけます。' };
    }

    const usedCount = Number.isInteger(c.usedCount) ? c.usedCount : (c.isUsed === true ? 1 : 0);
    // AF-LINE* クーポンは maxUses 未設定でも自動的に上限10回として保護する
    const maxUses = Number.isInteger(c.maxUses) && c.maxUses > 0
      ? c.maxUses
      : (isLineCoupon ? 10 : (c.isUnlimited === true ? null : 1));

    if ((maxUses !== null && usedCount >= maxUses) || (!c.isUnlimited && maxUses === 1 && c.isUsed === true)) {
      return { error: 'このクーポンコードは利用上限に達したか、すでに使用されています。' };
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

    if (maxUses === null) {
      tx.update(ref, { usedCount: usedCount + 1, lastUsedAt: admin.firestore.FieldValue.serverTimestamp() });
      return { discount, consumedRef: null, code: ref.id };
    }

    const nextCount = usedCount + 1;
    const reachedLimit = nextCount >= maxUses;
    tx.update(ref, {
      usedCount: nextCount,
      isUsed: reachedLimit,
      usedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return {
      discount,
      consumedRef: {
        ref,
        rollbackUpdate: {
          usedCount: usedCount,
          isUsed: false
        }
      },
      code: ref.id
    };
  });
}
