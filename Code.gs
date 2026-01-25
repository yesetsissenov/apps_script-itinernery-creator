// File: Code.gs
// Deployment:
// - Deploy as Web App (Execute as: Me, Who has access: Anyone).
// - Set Telegram webhook to WEB_APP_URL (/exec) using setupWebhook_().

function doGet() {
  return ContentService.createTextOutput("ok");
}

function doPost(e) {
  var raw = e && e.postData && e.postData.contents ? e.postData.contents : "";
  var update = null;
  try {
    update = raw ? JSON.parse(raw) : null;
  } catch (err) {
    _diagSave_("other", null, null, null, raw, "Invalid JSON: " + err);
    return ContentService.createTextOutput("ok");
  }

  try {
    _diagSaveFromUpdate_(update, raw);

    if (_isDuplicateUpdate_(update)) {
      return ContentService.createTextOutput("ok");
    }

    _routeUpdate_(update);
  } catch (err2) {
    _diagSaveError_(err2);
    var chatId = _safeGetChatId_(update);
    if (chatId) {
      sendMessage_(chatId, "Sorry, an error occurred. Please try again.");
    }
  }

  return ContentService.createTextOutput("ok");
}

function setupWebhook_() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty("TELEGRAM_TOKEN");
  var url = props.getProperty("WEB_APP_URL");
  if (!token || !url) {
    throw new Error("Missing TELEGRAM_TOKEN or WEB_APP_URL");
  }
  var payload = {
    url: url
  };
  return tgCall_("setWebhook", payload);
}

function _routeUpdate_(update) {
  if (!update) {
    return;
  }
  if (update.message) {
    _handleMessage_(update.message);
    return;
  }
  if (update.edited_message) {
    _handleMessage_(update.edited_message);
    return;
  }
  if (update.callback_query) {
    _handleCallback_(update.callback_query);
    return;
  }
}

function _handleMessage_(msg) {
  var chatId = msg.chat && msg.chat.id ? msg.chat.id : null;
  if (!chatId) {
    return;
  }
  var text = msg.text ? String(msg.text).trim() : "";
  if (!text) {
    sendMessage_(chatId, "Please send a command or text.");
    return;
  }
  if (text.charAt(0) === "/") {
    _handleCommand_(chatId, text);
    return;
  }
  _handleFreeText_(chatId, text);
}

function _handleCallback_(cb) {
  var chatId = cb.message && cb.message.chat ? cb.message.chat.id : null;
  var data = cb.data ? String(cb.data) : "";
  if (!chatId) {
    return;
  }
  answerCallbackQuery_(cb.id, "Received");
  sendMessage_(chatId, "Callback received: " + data);
}

function _handleCommand_(chatId, text) {
  var cmd = text.split(" ")[0].toLowerCase();
  if (cmd === "/start") {
    clearSession_(chatId);
    clearDraft_(chatId);
    clearItinerary_(chatId);
    sendStart_(chatId);
    return;
  }
  if (cmd === "/cancel") {
    clearSession_(chatId);
    sendMessage_(chatId, "Canceled. Use /new to start.");
    return;
  }
  if (cmd === "/new") {
    _startGuidedNew_(chatId);
    return;
  }
  if (cmd === "/newv2") {
    _startFreeformNew_(chatId);
    return;
  }
  if (cmd === "/show") {
    _showCurrentDraft_(chatId);
    return;
  }
  if (cmd === "/gen") {
    _generateItineraryForChat_(chatId);
    return;
  }
  if (cmd === "/edit") {
    _startEdit_(chatId);
    return;
  }
  if (cmd === "/docs") {
    _exportDocsForChat_(chatId);
    return;
  }
  if (cmd === "/done") {
    _finishChat_(chatId);
    return;
  }
  sendMessage_(chatId, "Unknown command. Use /start.");
}

function sendStart_(chatId) {
  var lines = [
    "Treeple Itinerary Creator",
    "Commands:",
    "/new - guided request",
    "/newv2 - free text request",
    "/show - show current draft",
    "/gen - generate itinerary",
    "/edit - edit itinerary",
    "/docs - export Google Doc",
    "/done - finish and reset",
    "/cancel - cancel"
  ];
  sendMessage_(chatId, lines.join("\n"));
}

function _startGuidedNew_(chatId) {
  setSession_(chatId, { state: "new_city", data: {} });
  sendMessage_(chatId, "Please enter city (required)." );
}

function _startFreeformNew_(chatId) {
  if (!openAiAvailable_()) {
    sendMessage_(chatId, "OpenAI is not configured. Please use /new guided flow.");
    return;
  }
  setSession_(chatId, { state: "newv2_wait", data: {} });
  sendMessage_(chatId, "Please describe your request in one message.");
}

function _handleFreeText_(chatId, text) {
  var session = getSession_(chatId);
  if (!session || !session.state) {
    sendMessage_(chatId, "Please use /new or /newv2 to start.");
    return;
  }

  if (session.state === "newv2_wait") {
    _handleFreeformParse_(chatId, text, session);
    return;
  }
  if (session.state === "edit_wait") {
    _handleEditInstruction_(chatId, text, session);
    return;
  }
  _handleGuidedFlow_(chatId, text, session);
}

function _handleGuidedFlow_(chatId, text, session) {
  var data = session.data || {};
  if (session.state === "new_city") {
    data.city = text;
    session.state = "new_start";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Start date (DD.MM.YYYY)?");
    return;
  }
  if (session.state === "new_start") {
    data.start = text;
    session.state = "new_days";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Number of days (1-30)?");
    return;
  }
  if (session.state === "new_days") {
    var days = parseInt(text, 10);
    if (isNaN(days) || days < 1 || days > 30) {
      sendMessage_(chatId, "Please enter a number between 1 and 30.");
      return;
    }
    data.days = days;
    session.state = "new_adults";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Adults count (1-200)?");
    return;
  }
  if (session.state === "new_adults") {
    var pax = parseInt(text, 10);
    if (isNaN(pax) || pax < 1 || pax > 200) {
      sendMessage_(chatId, "Please enter a number between 1 and 200.");
      return;
    }
    data.pax = pax;
    session.state = "new_kids";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Kids count (0-100)?");
    return;
  }
  if (session.state === "new_kids") {
    var kids = parseInt(text, 10);
    if (isNaN(kids) || kids < 0 || kids > 100) {
      sendMessage_(chatId, "Please enter a number between 0 and 100.");
      return;
    }
    data.kids = kids;
    session.state = "new_arrival";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Arrival time (HH:MM or -)?");
    return;
  }
  if (session.state === "new_arrival") {
    data.arrivalTime = text;
    session.state = "new_departure";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Departure time (HH:MM or -)?");
    return;
  }
  if (session.state === "new_departure") {
    data.departureTime = text;
    session.state = "new_notes";
    session.data = data;
    setSession_(chatId, session);
    sendMessage_(chatId, "Notes (optional, or type -)?");
    return;
  }
  if (session.state === "new_notes") {
    data.notes = text === "-" ? "" : text;
    session.state = "idle";
    session.data = data;
    setSession_(chatId, session);
    _finalizeRequest_(chatId, data);
    return;
  }

  sendMessage_(chatId, "Please use /new to start.");
}

function _handleFreeformParse_(chatId, text, session) {
  var data = session.data || {};
  var parsed = openAiParseRequest_(text);
  if (!parsed) {
    sendMessage_(chatId, "Could not parse request. Please use /new guided flow.");
    return;
  }
  var merged = _mergeRequestData_(data, parsed);
  var missing = _missingCriticalFields_(merged);
  if (missing.length) {
    var next = missing[0];
    session.data = merged;
    session.state = _stateForField_(next);
    setSession_(chatId, session);
    sendMessage_(chatId, _promptForField_(next));
    return;
  }
  session.state = "idle";
  session.data = merged;
  setSession_(chatId, session);
  _finalizeRequest_(chatId, merged);
}

function _handleEditInstruction_(chatId, text, session) {
  if (!openAiAvailable_()) {
    sendMessage_(chatId, "OpenAI is not configured. Edit is unavailable.");
    return;
  }
  var itinerary = getItinerary_(chatId);
  if (!itinerary) {
    sendMessage_(chatId, "No itinerary found. Use /gen first.");
    return;
  }
  var updated = openAiEditItinerary_(itinerary, text);
  if (!updated) {
    sendMessage_(chatId, "Could not apply edits. Please try again.");
    return;
  }
  saveItinerary_(chatId, updated, updated.meta && updated.meta.requestId ? updated.meta.requestId : null);
  var draft = gen_formatDraftText_(updated);
  saveDraft_(chatId, draft);
  sendMessage_(chatId, "Edits applied. Use /show to view.");
  session.state = "idle";
  setSession_(chatId, session);
}

function _showCurrentDraft_(chatId) {
  var draft = getDraft_(chatId);
  if (!draft) {
    sendMessage_(chatId, "No draft available. Use /gen after creating a request.");
    return;
  }
  sendLongMessage_(chatId, draft);
}

function _generateItineraryForChat_(chatId) {
  var session = getSession_(chatId);
  if (!session || !session.data) {
    sendMessage_(chatId, "No request found. Use /new.");
    return;
  }
  var data = session.data;
  var missing = _missingCriticalFields_(data);
  if (missing.length) {
    sendMessage_(chatId, "Missing fields: " + missing.join(", ") + ". Use /new to complete.");
    return;
  }
  var req = _buildRequestFromData_(chatId, data);
  var itinerary = gen_generateItineraryStruct_(req);
  saveItinerary_(chatId, itinerary, req.requestId);
  var draft = gen_formatDraftText_(itinerary);
  saveDraft_(chatId, draft);
  sendLongMessage_(chatId, draft);
}

function _startEdit_(chatId) {
  if (!openAiAvailable_()) {
    sendMessage_(chatId, "OpenAI is not configured. Edit is unavailable.");
    return;
  }
  setSession_(chatId, { state: "edit_wait", data: getSession_(chatId) ? getSession_(chatId).data : {} });
  sendMessage_(chatId, "Please describe the edits you want.");
}

function _exportDocsForChat_(chatId) {
  var itinerary = getItinerary_(chatId);
  if (!itinerary) {
    sendMessage_(chatId, "No itinerary found. Use /gen first.");
    return;
  }
  var requestId = itinerary.meta && itinerary.meta.requestId ? itinerary.meta.requestId : null;
  var url = exportDocForChat(chatId, requestId);
  if (url) {
    sendMessage_(chatId, "Document ready: " + url);
  } else {
    sendMessage_(chatId, "Could not export document.");
  }
}

function _finishChat_(chatId) {
  var itinerary = getItinerary_(chatId);
  if (!itinerary) {
    sendMessage_(chatId, "No itinerary found. Use /gen first.");
    return;
  }
  var requestId = itinerary.meta && itinerary.meta.requestId ? itinerary.meta.requestId : null;
  var url = exportDocForChat(chatId, requestId);
  if (url) {
    sendMessage_(chatId, "Final document: " + url);
  }
  clearSession_(chatId);
  clearDraft_(chatId);
  clearItinerary_(chatId);
}

function _finalizeRequest_(chatId, data) {
  var req = _buildRequestFromData_(chatId, data);
  saveRequest_(req);
  sendMessage_(chatId, "Request saved. Use /gen to generate itinerary.");
}

function _buildRequestFromData_(chatId, data) {
  var requestId = data.requestId ? data.requestId : _makeRequestId_(chatId);
  var startDate = _parseDate_(data.start);
  var endDate = startDate ? new Date(startDate.getTime() + (data.days - 1) * 24 * 60 * 60 * 1000) : null;
  var datesText = startDate && endDate ? _formatDate_(startDate) + " - " + _formatDate_(endDate) : "";
  var season = gen_guessSeason_(startDate);
  var templateKey = season ? season.toLowerCase() : "";
  return {
    requestId: requestId,
    createdAt: new Date(),
    status: "NEW",
    chatId: chatId,
    city: data.city,
    start: data.start,
    days: data.days,
    pax: data.pax,
    kids: data.kids || 0,
    arrivalTime: data.arrivalTime || "-",
    departureTime: data.departureTime || "-",
    notes: data.notes || "",
    season: season,
    templateKey: templateKey,
    datesText: datesText
  };
}

function _mergeRequestData_(base, add) {
  var out = {};
  Object.keys(base || {}).forEach(function(key) {
    out[key] = base[key];
  });
  Object.keys(add || {}).forEach(function(key2) {
    if (add[key2] !== undefined && add[key2] !== null && add[key2] !== "") {
      out[key2] = add[key2];
    }
  });
  return out;
}

function _missingCriticalFields_(data) {
  var missing = [];
  if (!data.city) missing.push("city");
  if (!data.start) missing.push("start");
  if (!data.days) missing.push("days");
  if (!data.pax) missing.push("pax");
  return missing;
}

function _stateForField_(field) {
  if (field === "city") return "new_city";
  if (field === "start") return "new_start";
  if (field === "days") return "new_days";
  if (field === "pax") return "new_adults";
  return "new_city";
}

function _promptForField_(field) {
  if (field === "city") return "Please enter city (required).";
  if (field === "start") return "Start date (DD.MM.YYYY)?";
  if (field === "days") return "Number of days (1-30)?";
  if (field === "pax") return "Adults count (1-200)?";
  return "Please provide the missing field.";
}

function _parseDate_(text) {
  if (!text) return null;
  var parts = text.split(".");
  if (parts.length !== 3) return null;
  var day = parseInt(parts[0], 10);
  var month = parseInt(parts[1], 10) - 1;
  var year = parseInt(parts[2], 10);
  if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
  return new Date(year, month, day);
}

function _formatDate_(dateObj) {
  if (!dateObj) return "";
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(dateObj, tz, "dd.MM.yyyy");
}

function _makeRequestId_(chatId) {
  return "REQ-" + chatId + "-" + new Date().getTime();
}

function _safeGetChatId_(update) {
  try {
    if (update && update.message && update.message.chat && update.message.chat.id) return update.message.chat.id;
    if (update && update.edited_message && update.edited_message.chat && update.edited_message.chat.id) return update.edited_message.chat.id;
    if (update && update.callback_query && update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id) return update.callback_query.message.chat.id;
  } catch (err) {
    return null;
  }
  return null;
}

function _isDuplicateUpdate_(update) {
  if (!update) return false;
  var cache = CacheService.getScriptCache();
  if (update.update_id) {
    var key = "DEDUPE_UPDATE_" + update.update_id;
    if (cache.get(key)) {
      return true;
    }
    cache.put(key, "1", 3600);
    _trackDedupeKey_(key);
  }
  var msg = update.message || update.edited_message;
  if (msg && msg.message_id && msg.chat && msg.chat.id) {
    var key2 = "DEDUPE_MSG_" + msg.chat.id + "_" + msg.message_id;
    if (cache.get(key2)) {
      return true;
    }
    cache.put(key2, "1", 3600);
    _trackDedupeKey_(key2);
  }
  return false;
}

function _diagSaveFromUpdate_(update, raw) {
  var kind = "other";
  var chatId = "";
  var text = "";
  var cbData = "";
  if (update && update.message) {
    kind = "message";
    chatId = update.message.chat && update.message.chat.id ? String(update.message.chat.id) : "";
    text = update.message.text ? String(update.message.text) : "";
  } else if (update && update.edited_message) {
    kind = "edited_message";
    chatId = update.edited_message.chat && update.edited_message.chat.id ? String(update.edited_message.chat.id) : "";
    text = update.edited_message.text ? String(update.edited_message.text) : "";
  } else if (update && update.callback_query) {
    kind = "callback_query";
    chatId = update.callback_query.message && update.callback_query.message.chat && update.callback_query.message.chat.id ? String(update.callback_query.message.chat.id) : "";
    cbData = update.callback_query.data ? String(update.callback_query.data) : "";
  }
  var updateId = update && update.update_id ? String(update.update_id) : "";
  _diagSave_(kind, updateId, chatId, text, raw, "", cbData);
}

function _diagSaveError_(err) {
  var msg = err && err.message ? err.message : String(err);
  _diagSave_("error", "", "", "", "", msg, "");
}

function _trackDedupeKey_(key) {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty("DEDUPE_KEYS");
  var list = existing ? existing.split(",") : [];
  if (list.indexOf(key) === -1) {
    list.push(key);
    props.setProperty("DEDUPE_KEYS", list.join(","));
  }
}
