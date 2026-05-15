function doPost(e) {
  // CORS対策: ブラウザからのアクセスを許可するヘッダーを設定
  var headers = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  };

  try {
    // リクエストボディのパース (fetch APIから送信されたJSONデータ)
    var params = JSON.parse(e.postData.contents);
    
    var email = params.email || "";
    var model = params.model || "";
    var lens = params.lens || "";
    var frame = params.frame || "";
    var price = params.price || 0;
    
    // スプレッドシートIDとシート名を指定
    var SPREADSHEET_ID = "1Wu0RyGpWtIUBsH0tl9dQwt7DX4e5EsZHazJ8b5yTk6Q";
    var sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheets()[0]; // 最初のシート（必要に応じてシート名で指定）
    
    // タイムスタンプの取得
    var date = new Date();
    
    // シートの最終行にデータを追加
    sheet.appendRow([
      date,
      email,
      model,
      lens,
      frame,
      price
    ]);
    
    // 成功レスポンス
    return ContentService.createTextOutput(JSON.stringify({ "status": "success", "message": "Order saved successfully" }))
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
