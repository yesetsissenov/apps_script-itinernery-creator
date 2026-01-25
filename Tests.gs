// File: Tests.gs

function TEST_webhookEndpoint_() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty("WEB_APP_URL");
  if (!url) {
    throw new Error("Missing WEB_APP_URL");
  }
  var res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  Logger.log("Status: " + res.getResponseCode());
  Logger.log("Body: " + res.getContentText());
}

function TEST_sendToLastChat_(text) {
  return debugToLastChat_(text || "Test message");
}

function TEST_saveRequest_() {
  var req = {
    requestId: "REQ-TEST-" + new Date().getTime(),
    createdAt: new Date(),
    status: "TEST",
    chatId: "TEST",
    city: "Test City",
    start: "01.01.2025",
    days: 3,
    pax: 2,
    kids: 0,
    arrivalTime: "10:00",
    departureTime: "18:00",
    notes: "Test note",
    season: "Winter",
    templateKey: "winter",
    datesText: "01.01.2025 - 03.01.2025"
  };
  saveRequest_(req);
}

function TEST_sessionRoundTrip_() {
  var chatId = "TEST";
  setSession_(chatId, { state: "test", data: { ok: true } });
  var session = getSession_(chatId);
  Logger.log(session);
  clearSession_(chatId);
  Logger.log(getSession_(chatId));
}

function RESET_DEDUPE_() {
  var props = PropertiesService.getScriptProperties();
  var list = props.getProperty("DEDUPE_KEYS");
  if (list) {
    var keys = list.split(",").filter(function(k) { return k; });
    if (keys.length) {
      CacheService.getScriptCache().removeAll(keys);
    }
  }
  props.deleteProperty("TG_LAST_UPDATE_ID");
  props.deleteProperty("DEDUPE_KEYS");
}

function CLEAR_RUNTIME_PROPERTIES_() {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  keys.forEach(function(key) {
    if (key.indexOf("SESS_") === 0 || key.indexOf("DRAFT_") === 0 || key.indexOf("ITIN_") === 0 || key.indexOf("DIAG_") === 0) {
      props.deleteProperty(key);
    }
  });
}
