// 会場販売：スタッフ操作（支払済の確定 / スプシ・メールの再送 / 注文キャンセル）
// 支払済にした時点で GAS へ送り、スプレッドシート記録とお客様への注文詳細メール送信を行う
const { getDb, admin, verifyAdmin, isEventOpen, json, sendVenueOrderToGas } = require('../lib/venue');
const { calcVenueTotals } = require('../lib/pricing');

const PAYMENT_METHODS = ['cash', 'square'];

function httpError(statusCode, message) {
  return Object.assign(new Error(message), { statusCode });
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return json(200, {});
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method Not Allowed' });

  try {
    const { id_token, order_id, action = 'confirm', payment_method, deliveries } = JSON.parse(event.body || '{}');

    if (!(await verifyAdmin(id_token))) return json(401, { error: 'スタッフ認証に失敗しました。再ログインしてください。' });
    if (typeof order_id !== 'string' || !order_id) return json(400, { error: '注文IDが不正です。' });

    const db = getDb();
    const orderRef = db.collection('venue_orders').doc(order_id);

    if (action === 'cancel') {
      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw httpError(404, '注文が見つかりません。');
        if (snap.data().status !== 'unpaid') throw httpError(409, '未払いの注文のみキャンセルできます。');
        tx.update(orderRef, { status: 'cancelled', cancelledAt: admin.firestore.FieldValue.serverTimestamp() });
      });
      return json(200, { status: 'cancelled' });
    }

    if (action === 'confirm') {
      if (!PAYMENT_METHODS.includes(payment_method)) return json(400, { error: '支払方法が不正です。' });

      await db.runTransaction(async (tx) => {
        const snap = await tx.get(orderRef);
        if (!snap.exists) throw httpError(404, '注文が見つかりません。');
        const order = snap.data();
        if (order.status !== 'unpaid') throw httpError(409, 'この注文はすでに処理済みです。');

        const eventSnap = await tx.get(db.collection('venue_events').doc(order.eventId));
        if (!isEventOpen(eventSnap.exists ? eventSnap.data() : null)) {
          throw httpError(400, '受付期間が終了した注文です（未払いのため自動キャンセル扱い）。');
        }

        const deliveryList = Array.isArray(deliveries) ? deliveries : [];
        const totals = calcVenueTotals(order.items, order.items.map((_, i) => deliveryList[i]));
        tx.update(orderRef, {
          status: 'paid',
          paymentMethod: payment_method,
          items: totals.items,
          subtotal: totals.subtotal,
          shippingFee: totals.shippingFee,
          total: totals.total,
          sheetSynced: false,
          paidAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
    } else if (action !== 'resync') {
      return json(400, { error: '不正な操作です。' });
    }

    // スプシ記録＋メール送信（confirm 直後、または失敗時の再送）
    const snap = await orderRef.get();
    const order = snap.data();
    if (!order || order.status !== 'paid') return json(409, { error: '支払済の注文ではありません。' });
    if (order.sheetSynced) return json(200, { status: 'paid', synced: true, total: order.total });

    try {
      await sendVenueOrderToGas(order);
      await orderRef.update({ sheetSynced: true, sheetError: admin.firestore.FieldValue.delete() });
      return json(200, { status: 'paid', synced: true, total: order.total });
    } catch (e) {
      console.error('GAS sync failed:', e);
      await orderRef.update({ sheetError: e.message });
      // 支払自体は確定済み。画面から再送できるようにする
      return json(200, { status: 'paid', synced: false, total: order.total, error: e.message });
    }
  } catch (error) {
    console.error('venue-confirm-payment error:', error);
    return json(error.statusCode || 500, { error: error.statusCode ? error.message : '処理に失敗しました。' });
  }
};
