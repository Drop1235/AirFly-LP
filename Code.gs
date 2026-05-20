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
    
    // セキュリティトークンの検証
    var expectedToken = "TEMPMACHI_AIRFLY_SECURE_HOOK_2026";
    if (params.secret_token !== expectedToken) {
      throw new Error("Unauthorized request");
    }
    
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
    
    // --- 郵便番号のハイフン自動整形ロジック ---
    var formattedZip = zip;
    var cleanZip = String(zip).replace(/\D/g, ''); // 数字だけを抽出
    if (cleanZip.length === 7) {
      formattedZip = cleanZip.slice(0, 3) + '-' + cleanZip.slice(3);
    }
    
    // --- 電話番号のハイフン自動整形ロジック ---
    var formattedPhone = phone;
    var cleanPhone = String(phone).replace(/\D/g, ''); // 数字だけを抽出
    if (cleanPhone.length === 11) {
      // 携帯電話などの11桁 (090-1234-5678)
      formattedPhone = cleanPhone.slice(0, 3) + '-' + cleanPhone.slice(3, 7) + '-' + cleanPhone.slice(7);
    } else if (cleanPhone.length === 10) {
      if (cleanPhone.indexOf('03') === 0 || cleanPhone.indexOf('06') === 0) {
        // 東京・大阪などの10桁 (03-1234-5678)
        formattedPhone = cleanPhone.slice(0, 2) + '-' + cleanPhone.slice(2, 6) + '-' + cleanPhone.slice(6);
      } else {
        // その他の地域の10桁 (045-123-4567)
        formattedPhone = cleanPhone.slice(0, 3) + '-' + cleanPhone.slice(3, 6) + '-' + cleanPhone.slice(6);
      }
    }
    
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
      "'" + formattedZip,
      address,
      "'" + formattedPhone,
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
      + "〒" + formattedZip + "\n"
      + address + "\n"
      + "電話番号: " + formattedPhone + "\n\n"
      + "商品は通常、2日～1週間程度でお届けいたします。\n"
      + "なお、在庫状況によっては2週間～1ヶ月ほどお時間をいただく場合がございます。\n"
      + "商品の到着まで、楽しみにお待ちくださいませ。\n\n"
      + "------------------------\n"
      + "株式会社TempMachi\n"
      + "Email: hanks@tempmachi.com\n"
      + "URL: https://www.tempmachi.com/\n"
      + "------------------------";
      
    var subjectAdmin = "【新規注文通知】Stripe決済が完了しました";
    var bodyAdmin = "新規のご注文が入りました（Stripe決済完了済）。\n\n"
      + "【お客様情報】\n"
      + "お名前: " + customerName + "\n"
      + "メール: " + email + "\n"
      + "〒" + formattedZip + "\n"
      + address + "\n"
      + "電話番号: " + formattedPhone + "\n\n"
      + "【ご注文内容】\n"
      + itemsString + "\n"
      + "決済金額（送料込）: ¥" + parseInt(totalAmount).toLocaleString() + "\n\n"
      + "スプレッドシートをご確認ください。";

    // 購入者宛メール送信（メールアドレスが入力されている場合のみ）
    if (email) {
      GmailApp.sendEmail(email, subjectBuyer, bodyBuyer, {
        from: adminEmail,
        name: "株式会社TempMachi"
      });
    }
    
    // 管理者宛メール送信
    GmailApp.sendEmail(adminEmail, subjectAdmin, bodyAdmin);
    // 成功レスポンス
    return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Order saved and emails sent successfully" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    // エラーレスポンス
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.message }))
      .setMimeType(ContentService.MimeType.JSON);
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
    .setMimeType(ContentService.MimeType.TEXT);
}

// スプレッドシートが開かれたときにカスタムメニューを自動で追加する
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('TempMachi メニュー')
    .addItem('選択した注文を代理店へメール送信', 'sendToAgent')
    .addToUi();
}

// 選択された注文データを綺麗なHTML表形式にして代理店へメール送信する
function sendToAgent() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    ui.alert('エラー', 'データが登録されていません。', ui.ButtonSet.OK);
    return;
  }
  
  // 2行目から最終行までのデータを一括取得 (A列〜J列)
  // A=1, B=2(名前), C=3(メール), D=4(注文内容), E=5(郵便番号), F=6(住所), G=7(電話番号), H=8(金額), I=9(チェックボックス), J=10(ステータス)
  var range = sheet.getRange(2, 1, lastRow - 1, 10);
  var values = range.getValues();
  
  var targets = [];
  
  for (var i = 0; i < values.length; i++) {
    var rowNum = i + 2;
    var rowData = values[i];
    var isChecked = rowData[8]; // I列 (9列目, 0-indexedなので 8)
    var status = rowData[9];    // J列 (10列目, 0-indexedなので 9)
    
    // チェックが入っており、かつステータスが「送信済」を含まない場合を対象にする
    if (isChecked === true && (!status || String(status).indexOf('送信済') === -1)) {
      targets.push({
        rowNum: rowNum,
        name: rowData[1],       // B列
        email: rowData[2],      // C列
        items: rowData[3],      // D列
        zip: rowData[4],        // E列
        address: rowData[5],    // F列
        phone: rowData[6],      // G列
        totalAmount: rowData[7] // H列
      });
    }
  }
  
  if (targets.length === 0) {
    ui.alert('確認', '「代理店へ送信」にチェックが入っており、かつ未送信の注文が見つかりませんでした。\n\n※すでに「送信済」になっている注文は自動的にスキップされます。', ui.ButtonSet.OK);
    return;
  }
  
  // 送信の最終確認ポップアップ
  var confirmResponse = ui.alert(
    '送信確認',
    '選択された ' + targets.length + ' 件の注文を1通のメールにまとめて代理店へメール送信します。よろしいですか？',
    ui.ButtonSet.YES_NO
  );
  
  if (confirmResponse !== ui.Button.YES) {
    ui.alert('キャンセル', '送信をキャンセルしました。', ui.ButtonSet.OK);
    return;
  }
  
  // ★★★ 代理店様の宛先メールアドレスを設定してください ★★★
  // 複数人に送りたい場合は、カンマ区切りで指定できます（例: "aaa@example.com,bbb@example.com"）
  var agentEmail = "agent@example.com"; 
  var adminEmail = "hanks@tempmachi.com"; // 送信元 (kazunori.matsunaga@tempmachi.com のGmail設定でエイリアス登録されたもの)
  
  // --- HTMLメール本文の構築 ---
  var subject = "【注文転送】新規注文手配依頼（計 " + targets.length + " 件）";
  
  var htmlBody = "<div style='font-family: sans-serif; font-size: 14px; line-height: 1.5; color: #333; max-width: 900px;'>"
    + "<p>株式会社ウェルゴジャパン　小西 忠彦様</p>"
    + "<p>いつもお世話になっております。株式会社TempMachiの松永です。<br>"
    + "AirFlyの新規注文が <strong>" + targets.length + " 件</strong> 入りましたので、手配をお願いいたします。</p>"
    + "<br>"
    + "<table style='border-collapse: collapse; width: 100%; font-size: 13px; margin: 20px 0; border: 1px solid #ddd;'>"
    + "  <thead>"
    + "    <tr style='background-color: #2c3e50; color: #ffffff; text-align: left;'>"
    + "      <th style='padding: 10px; border: 1px solid #ddd; width: 40px; text-align: center;'>No.</th>"
    + "      <th style='padding: 10px; border: 1px solid #ddd; width: 120px;'>お名前</th>"
    + "      <th style='padding: 10px; border: 1px solid #ddd;'>注文内容</th>"
    + "      <th style='padding: 10px; border: 1px solid #ddd; width: 320px;'>お届け先情報</th>"
    + "      <th style='padding: 10px; border: 1px solid #ddd; width: 90px; text-align: right;'>金額</th>"
    + "    </tr>"
    + "  </thead>"
    + "  <tbody>";
  
  for (var j = 0; j < targets.length; j++) {
    var t = targets[j];
    var bgStyle = (j % 2 === 1) ? "background-color: #fcfcfc;" : "";
    
    htmlBody += "    <tr style='" + bgStyle + "'>"
      + "      <td style='padding: 10px; border: 1px solid #ddd; text-align: center; vertical-align: top;'>" + (j + 1) + "</td>"
      + "      <td style='padding: 10px; border: 1px solid #ddd; font-weight: bold; vertical-align: top;'>" + t.name + " 様</td>"
      + "      <td style='padding: 10px; border: 1px solid #ddd; white-space: pre-wrap; vertical-align: top;'>" + t.items + "</td>"
      + "      <td style='padding: 10px; border: 1px solid #ddd; line-height: 1.4; vertical-align: top;'>"
      + "        〒" + t.zip + "<br>"
      + "        " + t.address + "<br>"
      + "        <strong>TEL:</strong> " + t.phone
      + "      </td>"
      + "      <td style='padding: 10px; border: 1px solid #ddd; font-weight: bold; text-align: right; vertical-align: top;'>" + t.totalAmount + "</td>"
      + "    </tr>";
  }
  
  htmlBody += "  </tbody>"
    + "</table>"
    + "<br>"
    + "<p>以上、よろしくお願い申し上げます。</p>"
    + "<hr style='border: 0; border-top: 1px solid #ccc; margin: 30px 0 20px 0;'>"
    + "<p style='font-size: 12px; color: #7f8c8d;'>"
    + "  <strong>株式会社TempMachi</strong><br>"
    + "  Email: hanks@tempmachi.com<br>"
    + "  URL: https://www.tempmachi.com/"
    + "</p>"
    + "</div>";

  // テキストメールのフォールバック用（HTML未対応メールソフト用）
  var textBody = "株式会社ウェルゴジャパン　小西 忠彦様\n\nいつもお世話になっております。株式会社TempMachiの松永です。\nAirFlyの新規注文が " + targets.length + " 件入りましたので手配をお願いいたします。\n\n"
    + "※HTML形式のメールが表示できるメールソフトでご確認ください。";

  var successCount = 0;
  
  try {
    // 代理店へメール送信 (HTMLメール)
    GmailApp.sendEmail(agentEmail, subject, textBody, {
      from: adminEmail,
      name: "株式会社TempMachi",
      htmlBody: htmlBody
    });
    
    // スプレッドシート側のステータスを一括更新
    var now = new Date();
    var formattedDate = Utilities.formatDate(now, 'Asia/Tokyo', 'MM/dd HH:mm');
    
    for (var k = 0; k < targets.length; k++) {
      var target = targets[k];
      sheet.getRange(target.rowNum, 9).setValue(false); // チェックボックスを OFF に戻す
      sheet.getRange(target.rowNum, 10).setValue("送信済 (" + formattedDate + ")"); // ステータスに記録
      successCount++;
    }
    
  } catch (e) {
    ui.alert('エラー', 'メール送信中にエラーが発生しました:\n' + e.message, ui.ButtonSet.OK);
    return;
  }
  
  // 完了報告ポップアップ
  ui.alert('送信完了', successCount + ' 件の注文を代理店へ美しい表形式で一括メール送信し、ステータスを「送信済」に更新しました！', ui.ButtonSet.OK);
}
