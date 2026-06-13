const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

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

  try {
    const { email, customer_name, customer_zip, customer_address, customer_phone, items, coupon_code, projectId } = JSON.parse(event.body);

    if (!items || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'カートに商品がありません。' })
      };
    }

    // クーポン検証 (Firestore REST API)
    let appliedDiscount = 0;
    if (coupon_code && projectId) {
      try {
        const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/coupons/${coupon_code.toUpperCase()}`;
        const res = await fetch(url);
        if (res.ok) {
          const doc = await res.json();
          let isValid = true;
          
          if (doc.fields) {
            // Check if used and NOT unlimited
            const isUnlimited = doc.fields.isUnlimited && doc.fields.isUnlimited.booleanValue === true;
            if (!isUnlimited && doc.fields.isUsed && doc.fields.isUsed.booleanValue === true) {
              isValid = false;
            }
            // Check if expired
            if (doc.fields.expiresAt) {
              const expiresAtVal = doc.fields.expiresAt.timestampValue || doc.fields.expiresAt.stringValue;
              if (expiresAtVal) {
                const expiry = new Date(expiresAtVal);
                expiry.setHours(23, 59, 59, 999);
                if (new Date() > expiry) {
                  isValid = false;
                }
              }
            }
          }
          if (isValid) {
            if (doc.fields && doc.fields.discountRate) {
              const rateVal = doc.fields.discountRate.integerValue || doc.fields.discountRate.doubleValue || doc.fields.discountRate.stringValue;
              if (rateVal) {
                const rate = parseFloat(rateVal);
                appliedDiscount = rate >= 1 ? rate / 100 : rate;
              } else {
                appliedDiscount = 0.10;
              }
            } else {
              appliedDiscount = 0.10; // デフォルト10%
            }
          }
        }
      } catch (e) {
        console.error('Firestore REST validation error:', e);
      }
    }

    // 価格計算ロジック（通常は定価販売）
    function getPriceData(model, lens) {
      let orig = 0;

      if (model === 'AF-901') {
        orig = 16500;
      } else if (model === 'AF-302-WP') {
        if (lens && lens.includes('■調光')) {
           orig = 28600;
        } else if (lens && lens.includes('★偏光')) {
           orig = 26400;
        } else {
           orig = 22000;
        }
      } else {
        if (lens && lens.includes('■調光')) {
           orig = 28600;
        } else if (lens && lens.includes('★偏光')) {
           orig = 26400;
        } else {
           orig = 22000;
        }
      }
      return { orig: orig, sale: orig };
    }

    // Convert cart items to Stripe line_items format using securely calculated prices
    const secureItems = [];
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
      
      // Store secure item for metadata
      secureItems.push({
        model: item.model,
        lens: item.lens,
        frame: item.frame,
        price: securePrice,
        originalPrice: priceInfo.orig
      });
      
      return {
        price_data: {
          currency: 'jpy',
          product_data: {
            name: productName,
            description: productDesc,
          },
          unit_amount: securePrice,
        },
        quantity: 1,
      };
    });

    // 送料の追加
    const SHIPPING_FEE = 600;
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
    
    // Convert secure items to JSON string for metadata (Webhook will read this)
    const itemsJson = JSON.stringify(secureItems);

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
        total_amount: totalSale.toString(),
        order_items: itemsJson.length <= 400 ? itemsJson : JSON.stringify([{ error: "items too long" }])
      }
    });

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ url: session.url })
    };

  } catch (error) {
    console.error('Error creating checkout session:', error);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: error.message })
    };
  }
};
