// 価格計算（Web決済・会場販売で共通）
// ※フロントエンド（index.html の getPriceData）と同じ定価テーブルを保つこと

const SHIPPING_FEE = 600;
const VENUE_DISCOUNT_RATE = 0.15; // 会場限定 15%OFF

const KNOWN_MODELS = ['AF-301-BK', 'AF-301-WV', 'AF-301', 'AF-302-WP', 'AF-302-SP', 'AF-901'];

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

function getVenueUnitPrice(model, lens) {
  return Math.floor(getPriceData(model, lens).orig * (1 - VENUE_DISCOUNT_RATE));
}

// deliveries: 各商品の受取方法（'ship' | 'handover'）。省略時は全て配送。
// 1点でも配送があれば送料がかかる。
function calcVenueTotals(items, deliveries) {
  let subtotal = 0;
  let hasShipping = false;
  const pricedItems = items.map((item, i) => {
    const price = getVenueUnitPrice(item.model, item.lens);
    const delivery = deliveries && deliveries[i] === 'handover' ? 'handover' : 'ship';
    if (delivery === 'ship') hasShipping = true;
    subtotal += price;
    return {
      model: item.model,
      lens: item.lens,
      frame: item.frame,
      price: price,
      originalPrice: getPriceData(item.model, item.lens).orig,
      delivery: delivery
    };
  });
  const shippingFee = hasShipping ? SHIPPING_FEE : 0;
  return { items: pricedItems, subtotal, shippingFee, total: subtotal + shippingFee };
}

module.exports = {
  SHIPPING_FEE,
  VENUE_DISCOUNT_RATE,
  KNOWN_MODELS,
  getPriceData,
  getVenueUnitPrice,
  calcVenueTotals
};
