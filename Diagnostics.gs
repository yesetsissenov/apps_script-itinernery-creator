// File: Diagnostics.gs

function _diagSave_(kind, updateId, chatId, text, raw, err, cbData) {
  var props = PropertiesService.getScriptProperties();
  if (updateId) props.setProperty("DIAG_LAST_UPDATE_ID", String(updateId));
  if (kind) props.setProperty("DIAG_LAST_KIND", String(kind));
  if (chatId) props.setProperty("DIAG_LAST_CHAT_ID", String(chatId));
  if (text) props.setProperty("DIAG_LAST_TEXT", String(text));
  if (cbData) props.setProperty("DIAG_LAST_CB_DATA", String(cbData));
  if (raw) props.setProperty("DIAG_LAST_RAW", String(raw).substring(0, 4500));
  if (err) props.setProperty("DIAG_LAST_ERR", String(err));
}

function debugToLastChat_(text) {
  var props = PropertiesService.getScriptProperties();
  var chatId = props.getProperty("DIAG_LAST_CHAT_ID");
  if (!chatId) return null;
  return sendMessage_(chatId, text);
}
