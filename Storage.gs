// File: Storage.gs

function saveDraft_(chatId, text) {
  var key = "DRAFT_" + chatId;
  PropertiesService.getScriptProperties().setProperty(key, text);
}

function getDraft_(chatId) {
  var key = "DRAFT_" + chatId;
  return PropertiesService.getScriptProperties().getProperty(key);
}

function clearDraft_(chatId) {
  var key = "DRAFT_" + chatId;
  PropertiesService.getScriptProperties().deleteProperty(key);
}

function saveItinerary_(chatId, itinerary, requestId) {
  var keyChat = "ITIN_" + chatId;
  PropertiesService.getScriptProperties().setProperty(keyChat, JSON.stringify(itinerary));
  if (requestId) {
    var keyReq = "ITIN_" + requestId;
    PropertiesService.getScriptProperties().setProperty(keyReq, JSON.stringify(itinerary));
  }
}

function getItinerary_(chatIdOrRequestId) {
  var key = "ITIN_" + chatIdOrRequestId;
  var raw = PropertiesService.getScriptProperties().getProperty(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function clearItinerary_(chatId) {
  var keyChat = "ITIN_" + chatId;
  PropertiesService.getScriptProperties().deleteProperty(keyChat);
}
