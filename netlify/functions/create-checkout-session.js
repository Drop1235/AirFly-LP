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
    const { email, customer_name, customer_zip, customer_address, customer_phone, items } = JSON.parse(event.body);

    if (!items || items.length === 0) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ error: 'カートに商品がありません。' })
      };
    }

    // 価格計算ロジック（フロントエンドと同じものをバックエンドで保持）
    function getPriceData(model, lens) {
      let orig = 0;
      let sale = 0;

      if (model === 'AF-901') {
        orig = 16500;
        sale = 14850;
      } else if (model === 'AF-302-WP') {
        if (lens && lens.includes('★偏光')) {
           orig = 26400;
        } else {
           orig = 22000;
        }
        sale = 23760;
      } else {
        if (lens && lens.includes('★偏光')) {
           orig = 26400;
           sale = 22000;
        } else {
           orig = 22000;
           sale = 18000;
        }
      }
      return { orig: orig, sale: sale };
    }

    // Convert cart items to Stripe line_items format using securely calculated prices
    const secureItems = [];
    let totalSale = 0;
    
    const line_items = items.map(item => {
      const productName = `AirFly ${item.model}`;
      const productDesc = `レンズ: ${item.lens} / フレーム: ${item.frame}`;
      
      // Calculate secure price
      const priceInfo = getPriceData(item.model, item.lens);
      const securePrice = priceInfo.sale;
      totalSale += securePrice;
      
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
