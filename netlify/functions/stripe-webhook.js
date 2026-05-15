const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let stripeEvent;

  try {
    // Verify webhook signature
    stripeEvent = stripe.webhooks.constructEvent(event.body, sig, endpointSecret);
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
      const email = session.metadata.customer_email || session.customer_details.email;
      let items = [];
      
      if (session.metadata.order_items) {
        items = JSON.parse(session.metadata.order_items);
      }

      // Google Apps Script (GAS) Web App URL
      // Make sure to set this environment variable in Netlify
      const gasUrl = process.env.GAS_WEB_APP_URL;

      if (gasUrl && items.length > 0) {
        const payload = {
          email: email,
          items: items
        };

        // Send data to Google Apps Script
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
        
        console.log('Successfully sent order data to GAS');
      } else {
        console.log('Skipped GAS posting. Missing GAS_WEB_APP_URL or empty items.');
      }
    } catch (error) {
      console.error('Error processing successful checkout:', error);
      // We still return 200 to Stripe so it doesn't retry the webhook infinitely,
      // but log the error for debugging.
    }
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ received: true })
  };
};
