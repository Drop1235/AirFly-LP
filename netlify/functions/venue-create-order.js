// 会場販売：注文の受付（未払い状態で Firestore に保存し、受付番号を発行する）
const { getDb, admin, verifyAdmin, isEventOpen, json, EMAIL_PATTERN } = require('../lib/venue');
const { calcVenueTotals, KNOWN_MODELS } = require('../lib/pricing');

const MAX_ITEMS = 20;

function isShortString(v, max) {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= max;
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const body = JSON.parse(event.body || '{}');
    const { event_id, email, customer_name, customer_zip, customer_address, customer_phone, items, entered_by, id_token, opt_in } = body;

    if (!isShortString(event_id, 100)) return json(400, { error: '会場情報が不正です。' });
    if (!isShortString(customer_name, 100) || !isShortString(email, 200) || !isShortString(customer_address, 300)) {
      return json(400, { error: 'お客様情報の必須項目が入力されていません。' });
    }
    if (!EMAIL_PATTERN.test(email.trim())) {
      return json(400, { error: 'メールアドレスの形式が正しくありません。' });
    }
    if (!/^\d{7}$/.test(customer_zip || '') || !/^\d{10,11}$/.test(customer_phone || '')) {
      return json(400, { error: '郵便番号または電話番号の形式が正しくありません。' });
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > MAX_ITEMS) {
      return json(400, { error: 'カートに商品がありません。' });
    }
    for (const item of items) {
      if (!item || !KNOWN_MODELS.includes(item.model) || !isShortString(item.lens, 50) || !isShortString(item.frame, 50)) {
        return json(400, { error: '商品情報が不正です。' });
      }
    }

    let enteredBy = 'customer';
    if (entered_by === 'staff') {
      if (!(await verifyAdmin(id_token))) return json(401, { error: 'スタッフ認証に失敗しました。再ログインしてください。' });
      enteredBy = 'staff';
    }

    const db = getDb();
    const eventRef = db.collection('venue_events').doc(event_id);
    const orderRef = db.collection('venue_orders').doc();
    const totals = calcVenueTotals(items.map(i => ({ model: i.model, lens: i.lens, frame: i.frame })));

    const receiptNo = await db.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists || !isEventOpen(eventSnap.data())) {
        throw Object.assign(new Error('この会場の受付期間外です。'), { statusCode: 400 });
      }
      const ev = eventSnap.data();
      const seq = (ev.orderSeq || 0) + 1;
      const no = `${ev.prefix || 'A'}-${String(seq).padStart(3, '0')}`;
      tx.update(eventRef, { orderSeq: seq });
      tx.set(orderRef, {
        eventId: event_id,
        eventName: ev.name,
        receiptNo: no,
        status: 'unpaid',
        enteredBy: enteredBy,
        customerName: customer_name.trim(),
        email: email.trim(),
        zip: customer_zip,
        address: customer_address.trim(),
        phone: customer_phone,
        optIn: opt_in === true,
        items: totals.items,
        subtotal: totals.subtotal,
        shippingFee: totals.shippingFee,
        total: totals.total,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return no;
    });

    return json(200, {
      order_id: orderRef.id,
      receipt_no: receiptNo,
      items: totals.items,
      subtotal: totals.subtotal,
      shipping_fee: totals.shippingFee,
      total: totals.total
    });
  } catch (error) {
    console.error('venue-create-order error:', error);
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : '注文の受付に失敗しました。' });
  }
};
