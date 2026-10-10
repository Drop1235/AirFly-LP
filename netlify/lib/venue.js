// 会場販売用の共通処理（Firebase Admin・管理者認証・開催日判定・GAS送信）
const admin = require('firebase-admin');

const ADMIN_EMAIL = process.env.VENUE_ADMIN_EMAIL || 'hanks@tempmachi.com';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

// サービスアカウントは以下のどちらかで設定する
//  - FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY（推奨：Lambdaの環境変数サイズ上限対策）
//  - FIREBASE_SERVICE_ACCOUNT（JSON文字列 または そのBase64）
function getCredential() {
  if (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID || 'airfly-lp',
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
    });
  }
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    throw new Error('Firebaseのサービスアカウントが設定されていません。');
  }
  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return admin.credential.cert(JSON.parse(json));
}

function getDb() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: getCredential() });
  }
  return admin.firestore();
}

// 管理者（Firebase Auth でログイン中のスタッフ）かを検証する
async function verifyAdmin(idToken) {
  if (!idToken) return false;
  getDb();
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    return decoded.email === ADMIN_EMAIL;
  } catch (e) {
    console.error('ID token verification failed:', e.message);
    return false;
  }
}

// 日本時間の今日（YYYY-MM-DD）
function todayJst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function isEventOpen(eventData) {
  if (!eventData) return false;
  const today = todayJst();
  const start = eventData.startDate;
  const end = eventData.endDate || eventData.startDate;
  return !!start && start <= today && today <= end;
}

function json(statusCode, body) {
  return { statusCode, headers: CORS_HEADERS, body: JSON.stringify(body) };
}

const PAYMENT_METHOD_LABELS = { cash: '現金', square: 'Square' };
const ENTERED_BY_LABELS = { customer: 'お客様', staff: 'スタッフ代理' };

// 支払済の会場注文をGAS（スプレッドシート記録＋お客様へのメール）へ送る
async function sendVenueOrderToGas(order) {
  const gasUrl = process.env.GAS_WEB_APP_URL;
  if (!gasUrl) throw new Error('GAS_WEB_APP_URL が設定されていません。');

  const payload = {
    secret_token: process.env.GAS_SECRET_TOKEN,
    channel: 'venue',
    event_name: order.eventName,
    receipt_no: order.receiptNo,
    payment_method: PAYMENT_METHOD_LABELS[order.paymentMethod] || order.paymentMethod,
    entered_by: ENTERED_BY_LABELS[order.enteredBy] || order.enteredBy,
    email: order.email,
    customer_name: order.customerName,
    customer_zip: order.zip,
    customer_address: order.address,
    customer_phone: order.phone,
    subtotal: order.subtotal,
    shipping_fee: order.shippingFee,
    total_amount: order.total,
    items: order.items
  };

  const response = await fetch(gasUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error(`GASへの送信に失敗しました (status ${response.status})`);
  }
  // GASはエラー時もHTTP 200でJSONを返すため本文も確認する
  const result = await response.json().catch(() => null);
  if (!result || result.status !== 'success') {
    throw new Error('GAS処理エラー: ' + (result && result.message ? result.message : '不明な応答'));
  }
}

module.exports = {
  admin,
  getDb,
  verifyAdmin,
  todayJst,
  isEventOpen,
  json,
  CORS_HEADERS,
  sendVenueOrderToGas
};
