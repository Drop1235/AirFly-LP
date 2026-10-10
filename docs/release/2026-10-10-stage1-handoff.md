# リリース前ハードニング 第1段階 引き継ぎメモ（2026-10-10）

対象: AirFly LP（`Drop1235/AirFly-LP`）／会場販売機能のリリース前
実施: release-hardening 第1段階（静的精査・アーキテクチャ確認。コードの変更は公開範囲の修正のみ）
基準コミット: `f244a33`（main。PR #1〜#3 マージ後）

---

## 1. リリース総合判定：**CONDITIONAL GO（条件付き）**

会場販売の機能そのものに、リリースを止める欠陥は見つかっていない。ただし次の4つが済むまでは公開しないこと。

| # | 条件 | 担当 |
|---|---|---|
| C1 | GASのトークン差し替え（スクリプトプロパティ設定 → 最新の Code.gs を再デプロイ → Netlify の `GAS_SECRET_TOKEN` 更新 → 旧トークン削除） | 人 |
| C2 | 会場販売の本番テスト（`docs/venue-sales-setup.md` 作業5） | 人 |
| C3 | Web注文（Stripe）の本番テスト1件。今回 `create-checkout-session.js` と GAS の Web 記録経路にも手を入れたため | 人 |
| C4 | 公開範囲の本番確認：`/Code.gs`・`/docs/venue-sales-setup.md`・`/package.json`・`/netlify.toml` が404になること | 人（この作業環境からはNetlifyに接続不可） |

既存の問題で、今回のリリースとは別に早めに直すべきもの：S1〜S3（下記）。

---

## 2. フェーズ0・1：安全確認とベースライン

### 安全確認
- この作業環境から本番（Netlify / Firebase / GAS / Stripe）へは**ネットワーク的に到達できない**。本番データを書き換えるおそれはない
- 動的テストは、Firebase・GAS・Netlify Functions をモックしたローカル環境で実施（テスト用スクリプトは作業用領域にあり、リポジトリには含めていない）
- Stripe のキーが本番用（`sk_live_`）かテスト用かは未確認（Netlify の環境変数の中にあり、こちらからは見えない）

### ベースライン
| 項目 | 結果 |
|---|---|
| 型チェック / ESLint | 対象外（素のJS。tsconfig・ESLint設定なし） |
| 構文チェック（`node --check`） | Netlify Functions 4本・lib 2本・Code.gs・index.html 内のスクリプト：すべて通過 |
| ビルド（`node scripts/build-site.js`） | 通過。禁止ファイルを混ぜると失敗することも確認済み |
| 自動テスト（作業用領域のモックテスト） | サーバー関数・GAS・画面：すべてPASS |
| `npm audit --omit=dev` | **10件（high 2 / moderate 8）**。すべて `firebase-admin@12` の依存（node-forge, uuid, qs ほか）。修正には `firebase-admin@14.5.0` への更新が必要（メジャー更新） |

### 公開資産とデプロイ経路
| 資産 | 経路 | 備考 |
|---|---|---|
| LP `https://airfly-tm.netlify.app/` | GitHub main への push → Netlify 自動デプロイ（CIなし） | 配信元は `_site/`（PR #3 で修正。それ以前はリポジトリ全体を公開していた） |
| Netlify Functions（4本） | 同上 | `create-checkout-session` / `stripe-webhook` / `venue-create-order` / `venue-confirm-payment` |
| GAS Webアプリ | 手動で貼り付け → 「デプロイを管理」で新バージョン | リポジトリの `Code.gs` と本番が一致している保証がない（手動反映のため） |
| Firestore（airfly-lp） | コンソールで手動設定 | ルールはリポジトリで管理されていない |
| Googleスプレッドシート（注文台帳） | — | 共有設定は未確認 |
| Stripe | ダッシュボード | Webhook の送信先と署名シークレット |
| tempmachi.com | 別サイト | 今回の検査範囲外（LPからはリンクのみ） |

### すでに対応したこと
- **公開範囲（重大）**：`publish = "."` により、`Code.gs`（GASトークン入り）・`docs/`・`netlify/`・`node_modules/` などが配信されていた → `_site/` の許可リスト方式に変更（PR #3）
- **GASトークン**：コードから削除し、スクリプトプロパティから読むように変更。未設定なら拒否する。**漏れた旧トークンの差し替え（C1）が済むまでは「対応中」**

---

## 3. 自動バックアップの設計（第2段階では前提として扱い、変えない）

### 現状
- 注文台帳（スプレッドシート）：Google の版履歴のみ。行の削除や上書きをまとめて戻す手段がない
- Firestore：Sparkプラン（無料）のため、マネージドのエクスポートやPITR（任意時点への復元）は使えない。クーポン・メルマガ登録者・会場の大会と注文は、どこにも複製がない

### 方針
| 対象 | 頻度 | 保存先 | 保持 | 方式 |
|---|---|---|---|---|
| 注文台帳（スプシ） | 毎日 3:00 | Googleドライブ「AirFly_backup/sheets」 | 30日 | GASの時間主導トリガーで `makeCopy` |
| Firestore（coupons / mail_list / venue_events / venue_orders） | 毎日 3:10 | Googleドライブ「AirFly_backup/firestore」 | 30日 | Netlify の定期実行関数で読み出し → GASへPOST → JSONファイルとして保存 |
| 失敗時の通知 | 都度 | hanks@tempmachi.com | — | GASがメールで通知 |

- バックアップ用フォルダは**共有しない**（オーナーのみ）。会場の注文には個人情報が含まれるため
- 復元手順：スプシはコピーから該当行を貼り戻す。Firestoreは JSON から復元用の関数で書き戻す（復元用の関数は、使うときに作る）

### コード差分案（第2段階では実装しない。別PRで実施）
**GAS（Code.gs に追加）**
```javascript
// 毎日の台帳バックアップ（トリガー：時間主導型・日次・午前3時）
function backupOrderSheet() {
  try {
    var folder = getBackupFolder_("sheets");
    var file = DriveApp.getFileById("1oEODWeCC1Tr7oZ3fFhylvm8MTbEuQjcWyF2YT4ruFOk");
    file.makeCopy("orders_" + Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd"), folder);
    pruneOldBackups_(folder, 30);
  } catch (e) {
    GmailApp.sendEmail("hanks@tempmachi.com", "【要確認】注文台帳のバックアップに失敗しました", e.message);
  }
}
// doPost に action: "firestore_backup" を追加し、受け取ったJSONを
// getBackupFolder_("firestore") に "firestore_yyyyMMdd.json" として保存 → pruneOldBackups_
```
**Netlify（`netlify/functions/backup-firestore.js`、定期実行）**
```javascript
// netlify.toml: [functions."backup-firestore"] schedule = "10 18 * * *"  # UTC 18:10 = JST 3:10
const { getDb } = require('../lib/venue');
exports.handler = async () => {
  const db = getDb();
  const out = {};
  for (const col of ['coupons', 'mail_list', 'venue_events', 'venue_orders']) {
    out[col] = (await db.collection(col).get()).docs.map(d => ({ id: d.id, ...d.data() }));
  }
  // GASへ { secret_token, action: 'firestore_backup', data: out } をPOST（sendVenueOrderToGas と同じ方式）
};
```

---

## 4. 軽度のバグチェック（非同期処理・整合性）

| # | 重要度 | 内容 | 対象 |
|---|---|---|---|
| B1 | **高**（2026-10-10 修正済み） | **Stripe決済後のスプシ記録が失敗すると、注文が消える**。`stripe-webhook.js` は GAS への送信に失敗してもログを出すだけで 200 を返すため、Stripe は再送しない。決済は完了しているのに、台帳にも管理者宛てメールにも残らない | `netlify/functions/stripe-webhook.js:81-85` |
| B2 | **高**（2026-10-10 修正済み） | **5点以上（商品名が短ければ6点以上）の注文で、商品明細が失われる**。Stripe のメタデータが400文字を超えると、明細を `[{error:"items too long"}]` に置き換えるため、台帳には「モデル: undefined」と記録される。4点で393文字（上限ぎりぎり） | `create-checkout-session.js:157` |
| B3 | 中 | Web のクーポン割引の計算が、画面（合計×割引率を四捨五入）とサーバー（1点ごとに切り捨て）で違う。複数商品のとき、表示額と決済額が数円ずれることがある | `index.html` renderCart / `create-checkout-session.js` |
| B4 | 低 | 会場受付の確定処理で、GAS への送信中に別端末から再送するとメールが二重になりうる（台帳は重複判定済み）。スタッフ1名の運用なら実害はほぼない | `venue-confirm-payment.js` |
| B5 | 低 | `Code.gs.bak`・`extracted_code.txt` が不要ファイルとして残っている（公開はされなくなった） | リポジトリ直下 |

---

## 5. 第2段階で深掘りするセキュリティ候補（優先度順・7件）

| # | 優先 | 対象 | 疑っている点 | 再現の当て |
|---|---|---|---|---|
| S1 | 1 | `create-checkout-session.js` ＋ Firestore ルール（coupons） | **1回限りのクーポンが何度でも使える**。サーバーは「使用済みか」を確認するだけで、使用済みにする処理はブラウザ任せ。関数を直接呼べば、同じクーポンで何度でも割引決済を作れる。さらに、ルール上は誰でも任意のクーポンを「使用済み」にできる（他人の未使用クーポンを潰せる） | あり：関数に直接POSTして、複数のセッションが割引額で作られるかを見る |
| S2 | 2 | `stripe-webhook.js` → GAS | Webhook の重複受信・再送時の二重記録（`checkout.session.completed` が複数回届く場合）。B1 の修正（失敗時に500を返して再送させる）と一緒に、冪等性（同じ決済を何度処理しても結果が同じになること）を設計する必要がある | あり：同じイベントを2回送る |
| S3 | 3 | `firebase-admin@12` の依存 | node-forge（high）の脆弱性。`verifyIdToken`（管理者認証）の経路に関係するかを確認する | 一部：影響する関数呼び出しの経路を追う |
| S4 | 4 | `venue-create-order.js` | 認証なしで誰でも呼べる（開催日のみ）。大量の注文作成による受付番号の枯渇・一覧の汚染、受付番号採番の取り合い（トランザクションの競合） | あり：同時に並列でPOSTする |
| S5 | 5 | Firestore ルール（mail_list） | 書き込みが誰でも可能（`allow write: if true`）。任意のドキュメントの作成・上書きや、大量の書き込みができる。項目の制限なし | あり：任意のフィールドを書き込む |
| S6 | 6 | 管理者認証（Firebase Auth） | メール＋パスワード認証の新規登録が有効なら、管理者メール以外のアカウントは作れる（ルールはメール一致で判定）。`email_verified` を見ていない点の実害の有無 | 一部：Auth設定の確認は人が行う |
| S7 | 7 | `index.html` の innerHTML 出力 | クーポン一覧（管理者が作成）、完了画面（localStorage 由来）など、エスケープしていない出力の棚卸し。会場受付はエスケープ済み | あり：ペイロードを入れて描画する |

### 第2段階で見ないもの（スコープ外）
- バックアップの実装（上の設計で確定。別PRで行う）
- UI・文言・デザイン、新機能の検討
- tempmachi.com、Stripe ダッシュボードの設定内容

---

## 6. 人が本番で確認する項目（チェックリスト）

**必須（1つでも通らなければ公開しない）**
- [ ] C1 トークン差し替えの完了後、Web注文・会場注文の両方がスプシに記録される
- [ ] C4 `https://airfly-tm.netlify.app/Code.gs` が 404 になる（`/package.json`・`/netlify.toml`・`/docs/venue-sales-setup.md` も同様）
- [ ] C2 会場販売の通しテスト（注文 → 受付 → 現金 → スプシ・メール）
- [ ] C3 Web注文の通しテスト（99%OFFのテスト用クーポン → Stripe決済 → スプシ・メール → 返金）
- [ ] Netlify の `STRIPE_SECRET_KEY` が本番用（`sk_live_`）であること（値は見せない。先頭だけ確認する）

**推奨**
- [ ] 注文台帳のスプシの共有設定が「制限付き」になっている（「リンクを知っている全員」になっていない）
- [ ] Firebase Authentication で、メール/パスワードの新規登録をクライアントから行えないようにする（または不要なユーザーがいないかを確認する）
- [ ] Gmail の送信元（hanks@tempmachi.com）から送ったメールが、迷惑メールフォルダに入らない

---

## 7. 第2段階のプロンプト（そのままコピーして使う）

```markdown
/release-hardening 第2段階（セキュリティ特化深掘り精査）
引き継ぎメモ: docs/release/2026-10-10-stage1-handoff.md
対象リポジトリ: Drop1235/AirFly-LP（main）
スコープ（ここ以外は見ない）:
- S1: netlify/functions/create-checkout-session.js ＋ Firestore coupons ルール / 1回限りクーポンの再利用・他人のクーポンを使用済みにできる
- S2: netlify/functions/stripe-webhook.js → Code.gs doPost / Webhook重複受信と冪等性（B1修正：GAS失敗時は500で再送・Q列の決済IDで重複判定・LockService。この修正自体に抜けがないかを検証）
- S3: firebase-admin@12 依存（node-forge high）/ verifyIdToken 経路への影響と、14.x への更新可否
- S4: netlify/functions/venue-create-order.js / 認証なしの大量作成・採番の競合
- S5: Firestore mail_list ルール / 任意の書き込み・上書き
- S6: 管理者認証（Firebase Auth + ルールのメール一致判定）/ email_verified 未確認の実害
- S7: index.html の innerHTML 出力 / エスケープ漏れ

【実行制約】
・本番（Netlify / Firebase / GAS / Stripe）には接続しない。Firebase・GAS・Stripe はモックで再現する
・候補は1件ずつ「再現できた／できなかった」まで確定させる。「怪しい」のまま残さない
・バックアップ設計・UI・新機能はスコープ外

【検証シナリオ】
1. IDOR（他者データの不正閲覧・編集・削除）
2. 権限昇格（管理者操作のバイパス）
3. 不正なペイロード・余計なフィールドによるデータ破壊
4. 決済の改ざん・Webhook偽装・二重処理

【出力フォーマット】
脆弱性の一覧（CVSS v3.1スコア順）：重要度 / スコア / 攻撃シナリオ / 対象箇所 / 被害 / 修正コード案
成果物：docs/release/ にセキュリティ検査報告書とリリース前テスト仕様書の2本
```
