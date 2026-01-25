// File: Telegram.gs

function tgCall_(method, payload) {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_TOKEN");
  if (!token) {
    throw new Error("Missing TELEGRAM_TOKEN");
  }
  var url = "https://api.telegram.org/bot" + token + "/" + method;
  var options = {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify(payload)
  };
  var res = UrlFetchApp.fetch(url, options);
  var code = res.getResponseCode();
  if (code >= 300) {
    throw new Error("Telegram API error " + code + ": " + res.getContentText());
  }
  return JSON.parse(res.getContentText());
}

function sendMessage_(chatId, text) {
  var payload = {
    chat_id: chatId,
    text: text
  };
  return tgCall_("sendMessage", payload);
}

function sendLongMessage_(chatId, text) {
  var max = 3500;
  var offset = 0;
  while (offset < text.length) {
    var chunk = text.substring(offset, offset + max);
    sendMessage_(chatId, chunk);
    offset += max;
  }
}

function answerCallbackQuery_(callbackId, text) {
  var payload = {
    callback_query_id: callbackId,
    text: text || ""
  };
  return tgCall_("answerCallbackQuery", payload);
}
