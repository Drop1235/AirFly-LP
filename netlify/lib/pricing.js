// 価格計算（Web決済・会場販売で共通）
// ※フロントエンド（index.html の getPriceData）と同じ定価テーブルを保つこと

const SHIPPING_FEE = 600;
// 会場の割引率（%）は大会ごとに設定する（0 = 定価）。未設定の大会・注文は従来どおり15%
const DEFAULT_VENUE_DISCOUNT_PERCENT = 15;
const MAX_VENUE_DISCOUNT_PERCENT = 50;

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

// 大会・注文に保存された割引率（%）。0〜50の整数でなければ従来の15%として扱う
function venueDiscountPercent(value) {
  return Number.isInteger(value) && value >= 0 && value <= MAX_VENUE_DISCOUNT_PERCENT ? value : DEFAULT_VENUE_DISCOUNT_PERCENT;
}

function getVenueUnitPrice(model, lens, discountPercent) {
  return Math.floor(getPriceData(model, lens).orig * (100 - venueDiscountPercent(discountPercent)) / 100);
}

// deliveries: 各商品の受取方法（'ship' | 'handover'）。省略時は全て配送。
// 1点でも配送があれば送料がかかる（大会の設定で送料無料の場合は0円）。
// options: { discountPercent: 割引率（%）, freeShipping: 送料無料か }
function calcVenueTotals(items, deliveries, options) {
  const discountPercent = venueDiscountPercent(options && options.discountPercent);
  const freeShipping = !!(options && options.freeShipping);
  let subtotal = 0;
  let hasShipping = false;
  const pricedItems = items.map((item, i) => {
    const price = getVenueUnitPrice(item.model, item.lens, discountPercent);
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
  const shippingFee = hasShipping && !freeShipping ? SHIPPING_FEE : 0;
  return { items: pricedItems, subtotal, shippingFee, total: subtotal + shippingFee, discountPercent, freeShipping };
}

module.exports = {
  SHIPPING_FEE,
  MAX_VENUE_DISCOUNT_PERCENT,
  KNOWN_MODELS,
  getPriceData,
  venueDiscountPercent,
  getVenueUnitPrice,
  calcVenueTotals
};
