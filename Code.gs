function doPost(e) {
  // CORS対策: ブラウザからのアクセスを許可するヘッダーを設定
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    // リクエストボディのパース
    var params = JSON.parse(e.postData.contents);
    
    var email = params.email || "";
    var customerName = params.customer_name || "未入力";
    var zip = params.customer_zip || "未入力";
    var address = params.customer_address || "未入力";
    var phone = params.customer_phone || "未入力";
    var totalAmount = params.total_amount || "0";
    var items = params.items || [];
    
    // アイテム情報を1つの文字列にまとめる
    var itemsString = "";
    for (var i = 0; i < items.length; i++) {
      var item = items[i];
      itemsString += "[" + (i + 1) + "] モデル: " + item.model + " / レンズ: " + item.lens + " / フレーム: " + item.frame + "\n";
    }
    itemsString = itemsString.trim();
    
    // スプレッドシートIDとシート名を指定
    var SPREADSHEET_ID = "1oEODWeCC1Tr7oZ3fFhylvm8MTbEuQjcWyF2YT4ruFOk";
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0]; // 最初のシート
    
    // タイムスタンプの取得
    var date = new Date();
    
    // シートの最終行にデータを追加（1回の注文につき1行）
    sheet.appendRow([
      date,
      customerName,
      email,
      itemsString,
      "'" + zip,
      address,
      "'" + phone,
      "¥" + String(totalAmount).replace(/\B(?=(\d{3})+(?!\d))/g, ",")
    ]);
    
    // --- メール自動送信処理 ---
    
    // 管理者メールアドレス（自分のアドレスを設定してください）
    var adminEmail = "hanks@tempmachi.com"; // ★★★ここに管理者アドレスを入力★★★
    
    var subjectBuyer = "【TempMachi】ご注文ありがとうございます";
    var bodyBuyer = customerName + " 様\n\n"
      + "この度はTempMachiよりAirFlyをご注文いただき、誠にありがとうございます。\n"
      + "以下の内容でご注文を承りました。\n\n"
      + "【ご注文内容】\n"
      + itemsString + "\n"
      + "決済金額（送料込）: ¥" + parseInt(totalAmount).toLocaleString() + "\n\n"
      + "【お届け先】\n"
      + "〒" + zip + "\n"
      + address + "\n"
      + "電話番号: " + phone + "\n\n"
      + "商品は通常、2日～1週間程度でお届けいたします。\n"
      + "なお、在庫状況によっては2週間～1ヶ月ほどお時間をいただく場合がございます。\n"
      + "商品の到着まで、楽しみにお待ちくださいませ。\n\n"
      + "------------------------\n"
      + "株式会社TempMachi\n"
      + "Email:kazunori.matsunaga@tempmachi.com\n"
      + "URL:https://www.tempmachi.com/\n"
      + "------------------------";
      
    var subjectAdmin = "【新規注文通知】Stripe決済が完了しました";
    var bodyAdmin = "新規のご注文が入りました（Stripe決済完了済）。\n\n"
      + "【お客様情報】\n"
      + "お名前: " + customerName + "\n"
      + "メール: " + email + "\n"
      + "〒" + zip + "\n"
      + address + "\n"
      + "電話番号: " + phone + "\n\n"
      + "【ご注文内容】\n"
      + itemsString + "\n"
      + "決済金額（送料込）: ¥" + parseInt(totalAmount).toLocaleString() + "\n\n"
      + "スプレッドシートをご確認ください。";

    // 購入者宛メール送信（メールアドレスが入力されている場合のみ）
    if (email) {
      GmailApp.sendEmail(email, subjectBuyer, bodyBuyer);
    }
    
    // 管理者宛メール送信
    // GmailApp.sendEmail(adminEmail, subjectAdmin, bodyAdmin); // ★★★運用時はコメントアウトを外してください★★★
    
    // 成功レスポンス
    return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Order saved and emails sent successfully" }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders(headers);
      
  } catch(error) {
    // エラーレスポンス
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.message }))
      .setMimeType(ContentService.MimeType.JSON)
      .setHeaders(headers);
  }
}

// OPTIONSリクエスト対応（プリフライトリクエスト用）
function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT)
    .setHeaders(headers);
}
