const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || '');

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify webhook signature
    let rawBody = event.body;
    if (event.isBase64Encoded) {
      rawBody = Buffer.from(event.body, 'base64').toString('utf8');
    }
    stripeEvent = stripe.webhooks.constructEvent(rawBody, sig, endpointSecret);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return {
      statusCode: 400,
      body: `Webhook Error: ${err.message}`
    };
  }

  // Handle the checkout.session.completed event
  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;

    try {
      const items = await getOrderItems(session);
      const gasUrl = process.env.GAS_WEB_APP_URL;
      if (!gasUrl) throw new Error('GAS_WEB_APP_URL is not set');
      if (items.length === 0) throw new Error(`No order items found for session ${session.id}`);

      const payload = {
        email: session.metadata.customer_email || (session.customer_details && session.customer_details.email) || '',
        customer_name: session.metadata.customer_name || '',
        customer_zip: session.metadata.customer_zip || '',
        customer_address: session.metadata.customer_address || '',
        customer_phone: session.metadata.customer_phone || '',
        opt_in: session.metadata.opt_in === 'true',
        total_amount: session.metadata.total_amount || String(session.amount_total || 0),
        items: items,
        stripe_session_id: session.id, // GAS側の重複記録防止に使う
        secret_token: process.env.GAS_SECRET_TOKEN
      };

      const response = await fetch(gasUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain' // GAS expects text/plain for CORS reasons
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Failed to send data to GAS. Status: ${response.status}`);
      }
      // GASはエラー時もHTTP 200でJSONを返すため本文も確認する
      const result = await response.json().catch(() => null);
      if (!result || result.status !== 'success') {
        throw new Error('GAS error: ' + (result && result.message ? result.message : 'invalid response'));
      }
      console.log('Successfully sent order data to GAS:', session.id);
    } catch (error) {
      // 記録できなかった注文を消さないよう、失敗を返して Stripe に再送させる（最大3日間）。
      // GAS側は Stripe の決済IDで重複を判定するため、再送で二重記録にはならない。
      console.error('Error processing successful checkout:', session.id, error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Failed to record order' })
      };
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};

// 決済の明細（商品ごとの model / lens / frame / 金額）を取得する
// 商品ごとの metadata を持たない旧形式のセッションは、セッションの order_items メタデータから読む
async function getOrderItems(session) {
  const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
    limit: 100,
    expand: ['data.price.product']
  });
  const items = lineItems.data
    .map(li => {
      const meta = (li.price && li.price.product && li.price.product.metadata) || {};
      if (!meta.model) return null; // 送料など
      return { model: meta.model, lens: meta.lens, frame: meta.frame, price: li.amount_total };
    })
    .filter(Boolean);
  if (items.length > 0) return items;

  if (session.metadata.order_items) {
    const legacy = JSON.parse(session.metadata.order_items);
    return legacy.filter(item => item && item.model);
  }
  return [];
}
