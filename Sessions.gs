// File: Sessions.gs

function getSession_(chatId) {
  var key = "SESS_" + chatId;
  var cache = CacheService.getScriptCache();
  var cached = cache.get(key);
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (err) {
      return null;
    }
  }
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err2) {
    return null;
  }
}

function setSession_(chatId, session) {
  var key = "SESS_" + chatId;
  var raw = JSON.stringify(session);
  CacheService.getScriptCache().put(key, raw, 3600);
  PropertiesService.getScriptProperties().setProperty(key, raw);
}

function clearSession_(chatId) {
  var key = "SESS_" + chatId;
  CacheService.getScriptCache().remove(key);
  PropertiesService.getScriptProperties().deleteProperty(key);
}
