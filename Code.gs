/**
 * 注文データ受け取り用Webhook (Stripe等から)
 */
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
      formattedPhone = cleanPhone.slice(0, 3) + '-' + cleanPhone.slice(3, 7) + '-' + cleanPhone.slice(7);
    } else if (cleanPhone.length === 10) {
      if (cleanPhone.indexOf('03') === 0 || cleanPhone.indexOf('06') === 0) {
        formattedPhone = cleanPhone.slice(0, 2) + '-' + cleanPhone.slice(2, 6) + '-' + cleanPhone.slice(6);
      } else {
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
    var adminEmail = "hanks@tempmachi.com";
    
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

    if (email) {
      GmailApp.sendEmail(email, subjectBuyer, bodyBuyer, {
        from: adminEmail,
        name: "株式会社TempMachi"
      });
    }
    
    GmailApp.sendEmail(adminEmail, subjectAdmin, bodyAdmin);
    
    return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Order saved and emails sent successfully" }))
      .setMimeType(ContentService.MimeType.JSON);
      
  } catch(error) {
    return ContentService.createTextOutput(JSON.stringify({ "status": "error", "message": error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doOptions(e) {
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  return ContentService.createTextOutput("")
    .setMimeType(ContentService.MimeType.TEXT);
}

/**
 * スプレッドシートが開かれたときにカスタムメニューを追加
 */
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('TempMachi メニュー')
    .addItem('選択した注文をLINEで代理店へ送信', 'sendToLine')
    .addToUi();
}

/**
 * 選択した注文データを抽出し、LINE送信用のポップアップダイアログを表示する
 */
function sendToLine() {
  var ui = SpreadsheetApp.getUi();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var lastRow = sheet.getLastRow();
  
  if (lastRow < 2) {
    ui.alert('エラー', 'データが登録されていません。', ui.ButtonSet.OK);
    return;
  }
  
  // A=1, B=2(名前), C=3(メール), D=4(注文内容), E=5(郵便番号), F=6(住所), G=7(電話番号), H=8(金額), I=9(チェックボックス), J=10(ステータス)
  var range = sheet.getRange(2, 1, lastRow - 1, 10);
  var values = range.getValues();
  
  var targets = [];
  var rowNums = [];
  
  for (var i = 0; i < values.length; i++) {
    var rowNum = i + 2;
    var rowData = values[i];
    var isChecked = rowData[8]; // I列
    var status = rowData[9];    // J列
    
    // チェックが入っており、かつステータスが「送信済」を含まない場合を対象にする
    if (isChecked === true && (!status || String(status).indexOf('送信済') === -1)) {
      targets.push({
        rowNum: rowNum,
        name: rowData[1],       // B列
        items: rowData[3],      // D列
        zip: rowData[4],        // E列
        address: rowData[5],    // F列
        phone: rowData[6]       // G列
      });
      rowNums.push(rowNum);
    }
  }
  
  if (targets.length === 0) {
    ui.alert('確認', '「代理店へ送信」にチェックが入っており、かつ未送信の注文が見つかりませんでした。\n\n※すでに「送信済」になっている注文は自動的にスキップされます。', ui.ButtonSet.OK);
    return;
  }
  
  // 「マスタ」シートからフレーム変換マッピングを取得
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var masterSheet = ss.getSheetByName("マスタ");
  var frameMap = {};
  if (masterSheet) {
    var masterValues = masterSheet.getDataRange().getValues();
    for (var m = 1; m < masterValues.length; m++) { // ヘッダーをスキップ
      var originalFrame = masterValues[m][0]; // A列: 元のフレーム名
      var convertedFrame = masterValues[m][1]; // B列: 変換後のフレーム名
      if (originalFrame) {
        frameMap[originalFrame] = convertedFrame;
      }
    }
  }
  
  // LINE送信テキストの構築
  var lineText = "【手配依頼】\n新規注文が " + targets.length + " 件入りました。\n発注手配をお願い致します。\n\n";
  
  for (var j = 0; j < targets.length; j++) {
    var t = targets[j];
    lineText += "①\n"; // ※数字は後ほど動的に変換します
    
    // 注文アイテムのパースと整形
    var parsedItems = parseOrderItems(t.items, frameMap);
    lineText += parsedItems + "\n";
    
    // 郵便番号のハイフン処理
    var formattedZip = String(t.zip).replace('〒', '').trim();
    var cleanZip = formattedZip.replace(/\D/g, '');
    if (cleanZip.length === 7) {
      formattedZip = cleanZip.slice(0, 3) + '-' + cleanZip.slice(3);
    }
    
    lineText += "＜送り先＞\n";
    lineText += "〒" + formattedZip + "\n";
    lineText += t.address + "\n";
    lineText += t.name + " 様\n";
    lineText += t.phone + "\n\n";
  }
  
  // ①、②、③ の丸数字を自動で動的に置換するロジック
  var finalLineText = "";
  var sections = lineText.trim().split("①\n");
  var numSymbols = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫", "⑬", "⑭", "⑮", "⑯", "⑰", "⑱", "⑲", "⑳"];
  
  finalLineText += sections[0];
  for (var k = 1; k < sections.length; k++) {
    var symbol = numSymbols[k - 1] || ("(" + k + ")");
    finalLineText += symbol + "\n" + sections[k];
  }
  
  finalLineText = finalLineText.trim();
  
  // 1. 先行してスプレッドシートのステータスを「送信済」に更新（確実に処理を記録）
  completeLineStatusUpdate(rowNums);
  
  // 2. HTMLダイアログの表示
  showLinePopup(finalLineText, rowNums);
}

/**
 * 注文アイテムをパースし、フレームマスタの適用と表記のクレンジングを行う
 */
function parseOrderItems(itemsText, frameMap) {
  var lines = itemsText.split('\n');
  var formattedItems = [];
  
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    
    var model = "";
    var lens = "";
    var frame = "";
    
    var modelMatch = line.match(/モデル:\s*([^\/]+)/);
    var lensMatch = line.match(/レンズ:\s*([^\/]+)/);
    var frameMatch = line.match(/フレーム:\s*(.+)$/);
    
    if (modelMatch) model = modelMatch[1].trim();
    if (lensMatch) lens = lensMatch[1].trim();
    if (frameMatch) frame = frameMatch[1].trim();
    
    // フレームをマスタ変換（マスタにない場合はそのまま）
    var convertedFrame = frameMap[frame] || frame;
    
    // レンズの表記修正
    var convertedLens = lens;
    
    // 「★偏光」または「■調光」などのプレフィックスを追加（すでに入っていなければ）
    if (convertedLens.indexOf("調光") !== -1) {
      convertedLens = convertedLens.replace(/調光調光/g, "調光"); // 表記崩れ防止
      if (convertedLens.indexOf("■") === -1) {
        convertedLens = "■" + convertedLens;
      }
    } else if (convertedLens.indexOf("偏光") !== -1) {
      if (convertedLens.indexOf("★") === -1) {
        convertedLens = "★" + convertedLens;
      }
    }
    
    // レンズの先頭にモデル名を結合する（レンズ名にまだモデル名が含まれていない場合のみ）
    var finalLens = convertedLens;
    if (model && finalLens.indexOf(model) === -1) {
      finalLens = model + finalLens;
    }
    
    // フレームはマスタ変換後のもの（convertedFrame）をそのまま出力（モデル名の重複防止）
    formattedItems.push(convertedFrame);
    formattedItems.push(finalLens);
  }
  
  return formattedItems.join('\n');
}

/**
 * LINE起動用のモーダルダイアログを表示する
 */
function showLinePopup(text, rowNums) {
  var escapedText = escapeHtml(text);
  // LINEのWeb共有（Line It!）の正式な共有URLスキームを使用します。
  var lineUrl = "https://social-plugins.line.me/lineit/share?url=" + encodeURIComponent("https://airfly-tm.netlify.app/") + "&text=" + encodeURIComponent(text);
  
  var html = '<!DOCTYPE html>'
    + '<html>'
    + '<head>'
    + '  <meta charset="utf-8">'
    + '  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">'
    + '  <style>'
    + '    body {'
    + '      font-family: "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;'
    + '      margin: 0;'
    + '      padding: 24px;'
    + '      background-color: #f8fafc;'
    + '      color: #0f172a;'
    + '      display: flex;'
    + '      flex-direction: column;'
    + '      height: 100vh;'
    + '      box-sizing: border-box;'
    + '    }'
    + '    .container {'
    + '      display: flex;'
    + '      flex-direction: column;'
    + '      gap: 16px;'
    + '      height: 100%;'
    + '    }'
    + '    .header {'
    + '      display: flex;'
    + '      align-items: center;'
    + '      gap: 10px;'
    + '    }'
    + '    .icon-container {'
    + '      width: 36px;'
    + '      height: 36px;'
    + '      background-color: #ecfdf5;'
    + '      border-radius: 10px;'
    + '      display: flex;'
    + '      align-items: center;'
    + '      justify-content: center;'
    + '    }'
    + '    .icon {'
    + '      font-size: 20px;'
    + '    }'
    + '    .title {'
    + '      font-size: 18px;'
    + '      font-weight: 700;'
    + '      color: #0f172a;'
    + '      margin: 0;'
    + '    }'
    + '    .desc {'
    + '      font-size: 13px;'
    + '      color: #475569;'
    + '      line-height: 1.6;'
    + '      margin: 0;'
    + '      background-color: #f1f5f9;'
    + '      padding: 12px 16px;'
    + '      border-radius: 8px;'
    + '      border-left: 4px solid #06C755;'
    + '    }'
    + '    .btn-wrapper {'
    + '      display: flex;'
    + '      flex-direction: column;'
    + '      align-items: center;'
    + '      margin: 8px 0;'
    + '    }'
    + '    .btn {'
    + '      display: inline-flex;'
    + '      align-items: center;'
    + '      justify-content: center;'
    + '      gap: 10px;'
    + '      background: linear-gradient(135deg, #06C755 0%, #05B34C 100%);'
    + '      color: white;'
    + '      font-weight: 600;'
    + '      padding: 14px 32px;'
    + '      border-radius: 12px;'
    + '      text-decoration: none;'
    + '      box-shadow: 0 10px 20px -10px rgba(6, 199, 85, 0.5), 0 4px 6px -2px rgba(6, 199, 85, 0.2);'
    + '      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);'
    + '      font-size: 15px;'
    + '      border: none;'
    + '      cursor: pointer;'
    + '      width: 100%;'
    + '      box-sizing: border-box;'
    + '      text-align: center;'
    + '    }'
    + '    .btn:hover {'
    + '      transform: translateY(-2px);'
    + '      box-shadow: 0 15px 25px -10px rgba(6, 199, 85, 0.6), 0 6px 10px -2px rgba(6, 199, 85, 0.3);'
    + '    }'
    + '    .btn:active {'
    + '      transform: translateY(0);'
    + '      box-shadow: 0 5px 10px -5px rgba(6, 199, 85, 0.5);'
    + '    }'
    + '    .status-badge {'
    + '      margin-top: 8px;'
    + '      font-size: 11px;'
    + '      color: #16a34a;'
    + '      font-weight: 600;'
    + '      background-color: #dcfce7;'
    + '      padding: 4px 10px;'
    + '      border-radius: 100px;'
    + '      display: inline-flex;'
    + '      align-items: center;'
    + '      gap: 4px;'
    + '    }'
    + '    .preview-section {'
    + '      display: flex;'
    + '      flex-direction: column;'
    + '      flex-grow: 1;'
    + '      min-height: 0;'
    + '    }'
    + '    .preview-header {'
    + '      display: flex;'
    + '      justify-content: space-between;'
    + '      align-items: center;'
    + '      margin-bottom: 6px;'
    + '    }'
    + '    .preview-title {'
    + '      font-size: 12px;'
    + '      font-weight: 600;'
    + '      color: #475569;'
    + '      text-transform: uppercase;'
    + '      letter-spacing: 0.05em;'
    + '    }'
    + '    .preview-box {'
    + '      background-color: #ffffff;'
    + '      border: 1px solid #e2e8f0;'
    + '      border-radius: 10px;'
    + '      padding: 14px;'
    + '      font-size: 12px;'
    + '      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;'
    + '      white-space: pre-wrap;'
    + '      overflow-y: auto;'
    + '      color: #334155;'
    + '      flex-grow: 1;'
    + '      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.02);'
    + '      line-height: 1.6;'
    + '    }'
    + '    /* スクロールバーのカスタマイズ */'
    + '    .preview-box::-webkit-scrollbar {'
    + '      width: 6px;'
    + '    }'
    + '    .preview-box::-webkit-scrollbar-track {'
    + '      background: transparent;'
    + '    }'
    + '    .preview-box::-webkit-scrollbar-thumb {'
    + '      background: #cbd5e1;'
    + '      border-radius: 3px;'
    + '    }'
    + '    .preview-box::-webkit-scrollbar-thumb:hover {'
    + '      background: #94a3b8;'
    + '    }'
    + '  </style>'
    + '</head>'
    + '<body>'
    + '  <div class="container">'
    + '    <div class="header">'
    + '      <div class="icon-container">'
    + '        <span class="icon">💬</span>'
    + '      </div>'
    + '      <h1 class="title">LINEで注文手配</h1>'
    + '    </div>'
    + '    '
    + '    <p class="desc">'
    + '      「LINEを起動して送信」ボタンを押すと、自動で宛先選択＆注文内容が入力されたLINE送信画面が開きます。'
    + '    </p>'
    + '    '
    + '    <div class="btn-wrapper">'
    + '      <a class="btn" href="' + lineUrl + '" target="_blank" rel="noopener noreferrer" onclick="setTimeout(function(){ google.script.host.close(); }, 300);">'
    + '        LINEを起動して送信'
    + '      </a>'
    + '      <div class="status-badge">'
    + '        <span>✓</span> スプレッドシートを「送信済」に更新しました'
    + '      </div>'
    + '    </div>'
    + '    '
    + '    <div class="preview-section">'
    + '      <div class="preview-header">'
    + '        <span class="preview-title">送信内容プレビュー</span>'
    + '      </div>'
    + '      <pre class="preview-box">' + escapedText + '</pre>'
    + '    </div>'
    + '  </div>'
    + '</body>'
    + '</html>';
    
  var htmlOutput = HtmlService.createHtmlOutput(html)
    .setWidth(460)
    .setHeight(450);
  SpreadsheetApp.getUi().showModalDialog(htmlOutput, "LINEで注文手配");
}

/**
 * HTMLのエスケープ処理
 */
function escapeHtml(string) {
  if (typeof string !== 'string') {
    return string;
  }
  return string.replace(/[&<>"']/g, function(match) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[match];
  });
}

/**
 * LINE起動ボタンが実際に押された後に呼び出されるステータス更新関数
 */
function completeLineStatusUpdate(rowNums) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getActiveSheet();
  var now = new Date();
  var formattedDate = Utilities.formatDate(now, 'Asia/Tokyo', 'MM/dd HH:mm');
  
  for (var i = 0; i < rowNums.length; i++) {
    var row = rowNums[i];
    sheet.getRange(row, 9).setValue(false); // チェックボックスを OFF に戻す
    sheet.getRange(row, 10).setValue("送信済 (" + formattedDate + ")"); // ステータスに記録
  }
}
