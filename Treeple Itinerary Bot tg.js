/**************************************
 * TREEPLE ITINERARY CREATOR BOT v5 (clean)
 * - Telegram Webhook -> Google Sheets (Requests)
 * - Writes by header names (robust to multiline headers)
 * - TEMPLATE_KEY = season template: winter/spring/summer/autumn (lowercase)
 **************************************/

const PROP = {
  TELEGRAM_TOKEN: "TELEGRAM_TOKEN",
  WEB_APP_URL: "WEB_APP_URL",         // must end with /exec
  SPREADSHEET_ID: "SPREADSHEET_ID",   // Google Sheet file id
  SHEET_REQUESTS: "SHEET_REQUESTS",   // optional tab name
};

const TZ = "Asia/Almaty";

// ===================== WEB APP =====================
function doGet() {
  return HtmlService.createHtmlOutput("TREEPLE BOT LIVE ✅ v5");
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return HtmlService.createHtmlOutput("BUSY");

  try {
    const update = safeJsonParse_(e && e.postData && e.postData.contents);
    if (update) {
      // ВАЖНО: дедуп update_id (убирает дубли и “пачки”)
      if (isDuplicateUpdate_(update)) return HtmlService.createHtmlOutput("OK");
      handleUpdate_(update);
    }

    return HtmlService.createHtmlOutput("OK");
  } catch (err) {
    console.error(err && err.stack ? err.stack : err);
    return HtmlService.createHtmlOutput("OK");
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}


// ===================== COMMANDS / SETUP =====================
function setConfig(token, webAppUrl, spreadsheetId, sheetRequestsName) {
  const sp = PropertiesService.getScriptProperties();
  if (token) sp.setProperty(PROP.TELEGRAM_TOKEN, String(token).trim());
  if (webAppUrl) sp.setProperty(PROP.WEB_APP_URL, String(webAppUrl).trim());
  if (spreadsheetId) sp.setProperty(PROP.SPREADSHEET_ID, String(spreadsheetId).trim());
  if (sheetRequestsName) sp.setProperty(PROP.SHEET_REQUESTS, String(sheetRequestsName).trim());
  Logger.log("✅ Config saved.");
}

function setWebAppUrlAuto() {
  const url = ScriptApp.getService().getUrl(); // gives /exec for deployed web app
  PropertiesService.getScriptProperties().setProperty(PROP.WEB_APP_URL, url);
  Logger.log("WEB_APP_URL = " + url);
}

function authorizeNow() {
  UrlFetchApp.fetch("https://api.telegram.org");
  const ssId = (PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID) || "").trim();
  if (ssId) SpreadsheetApp.openById(ssId).getSheets();
  Logger.log("✅ Authorization OK");
}

function resetWebhook() {
  const token = TELEGRAM_TOKEN_();
  const url = WEB_APP_URL_();
  if (!token) { Logger.log("❌ Missing TELEGRAM_TOKEN"); return; }
  if (!url) { Logger.log("❌ Missing WEB_APP_URL"); return; }

  const api = `https://api.telegram.org/bot${encodeURIComponent(token)}/setWebhook`;
  const res = UrlFetchApp.fetch(api, {
    method: "post",
    payload: {
      url,
      drop_pending_updates: true,
      allowed_updates: JSON.stringify(["message", "callback_query"])
    },
    muteHttpExceptions: true
  });
  Logger.log(res.getContentText());
}

function hardResetWebhook() {
  const token = TELEGRAM_TOKEN_();
  if (!token) { Logger.log("❌ Missing TELEGRAM_TOKEN"); return; }

  const del = `https://api.telegram.org/bot${encodeURIComponent(token)}/deleteWebhook`;
  Logger.log(UrlFetchApp.fetch(del, { method: "post", muteHttpExceptions: true }).getContentText());
  resetWebhook();
}

function getWebhookInfo() {
  const token = TELEGRAM_TOKEN_();
  if (!token) { Logger.log("❌ Missing TELEGRAM_TOKEN"); return; }
  const api = `https://api.telegram.org/bot${encodeURIComponent(token)}/getWebhookInfo`;
  Logger.log(UrlFetchApp.fetch(api, { muteHttpExceptions: true }).getContentText());
}

function debugProps() {
  const sp = PropertiesService.getScriptProperties();
  Logger.log("TELEGRAM_TOKEN exists? " + Boolean(sp.getProperty(PROP.TELEGRAM_TOKEN)));
  Logger.log("WEB_APP_URL = " + sp.getProperty(PROP.WEB_APP_URL));
  Logger.log("SPREADSHEET_ID = " + sp.getProperty(PROP.SPREADSHEET_ID));
  Logger.log("SHEET_REQUESTS = " + sp.getProperty(PROP.SHEET_REQUESTS));
}

function debugStorage() {
  const ss = openSpreadsheet_();
  Logger.log("Spreadsheet URL = " + ss.getUrl());
  const sh = getRequestsSheet_(ss);
  Logger.log("Requests sheet = " + sh.getName());
  Logger.log("Normalized headers = " + Object.keys(getHeaderMapNorm_(sh)).join(", "));
}

function debugCols() {
  const ss = openSpreadsheet_();
  const sh = getRequestsSheet_(ss);
  const map = getHeaderMapNorm_(sh);
  Logger.log("SEASON col = " + map.SEASON);
  Logger.log("TEMPLATEKEY col = " + map.TEMPLATEKEY);
  Logger.log("TOURTITLE col = " + map.TOURTITLE);
}

// ===================== TELEGRAM HANDLING =====================
function handleUpdate_(u) {
  if (u.callback_query) {
    answerCallbackQuery_(u.callback_query.id);
    return;
  }
  if (u.message) onMessage_(u.message);
}

function onMessage_(m) {
  var chatId = m && m.chat && m.chat.id;
  if (!chatId) return;

  var text = (m.text || "").toString().trim();
  if (!text) return;

  // ---------- small helpers ----------
  function cmd_(t) {
    if (!t || t.charAt(0) !== "/") return "";
    var c = t.split(/\s+/)[0].toLowerCase();
    if (c.indexOf("@") >= 0) c = c.split("@")[0];
    return c;
  }

  function parseTimeHHMMOrDash_(s) {
    var t = String(s || "").trim();
    if (t === "-" || t === "") return "-";
    var mm = /^(\d{1,2}):(\d{2})$/.exec(t);
    if (!mm) return null;
    var hh = Number(mm[1]), mi = Number(mm[2]);
    if (hh < 0 || hh > 23 || mi < 0 || mi > 59) return null;
    return (hh < 10 ? "0" : "") + hh + ":" + mm[2];
  }

  function parseIntSafe_(s) {
    var n = Number(String(s || "").trim());
    if (!isFinite(n)) return null;
    return Math.floor(n);
  }

  function parseDateDdMmYyyy_(s) {
    var t = String(s || "").trim();
    var m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(t);
    if (!m) return null;
    var d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    if (isNaN(d.getTime())) return null;
    return d;
  }

  function seasonFromDate_(d) {
    var mo = d.getMonth() + 1;
    if (mo === 12 || mo === 1 || mo === 2) return { seasonLabel: "Winter", templateKey: "winter" };
    if (mo >= 3 && mo <= 5) return { seasonLabel: "Spring", templateKey: "spring" };
    if (mo >= 6 && mo <= 8) return { seasonLabel: "Summer", templateKey: "summer" };
    return { seasonLabel: "Autumn", templateKey: "autumn" };
  }

  // ---------- STRUCT STORAGE ----------
  function itinKey_() { return "ITIN_" + String(chatId); }

  function getItin_() {
    var raw = PropertiesService.getScriptProperties().getProperty(itinKey_());
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  function setItin_(it) {
    PropertiesService.getScriptProperties().setProperty(itinKey_(), JSON.stringify(it || {}));
  }

  function clearItin_() {
    PropertiesService.getScriptProperties().deleteProperty(itinKey_());
  }

  function fmtItin_(it) {
    if (!it || !it.days || !it.days.length) return "";
    var out = [];
    for (var i = 0; i < it.days.length; i++) {
      var d = it.days[i] || {};
      out.push(String(d.number || ("Day " + (i + 1))) + " – " + String(d.date || "") + ": " + String(d.name || ""));
      if (d.time) out.push(String(d.time));
      if (d.location) out.push(String(d.location));
      if (d.overnight) out.push(String(d.overnight));
      if (d.description) out.push(String(d.description));
      out.push("");
    }
    return out.join("\n").trim();
  }

  function extractJson_(s) {
    var t = String(s || "").trim();
    var a = t.indexOf("{");
    var b = t.lastIndexOf("}");
    if (a >= 0 && b > a) t = t.substring(a, b + 1);
    return t;
  }

  function validateItin_(obj, opts) {
    if (typeof validateItinStruct_ === "function") return validateItinStruct_(obj, opts || {});
    if (!obj || typeof obj !== "object") return null;
    if (!obj.meta || !obj.days || !Array.isArray(obj.days) || !obj.days.length) return null;

    for (var i = 0; i < obj.days.length; i++) {
      var d = obj.days[i] || {};
      if (!d.number) d.number = "Day " + (i + 1);
      if (d.date === null || d.date === undefined) d.date = "";
      if (d.name === null || d.name === undefined) d.name = "";
      if (d.time === null || d.time === undefined) d.time = "";
      if (d.location === null || d.location === undefined) d.location = "";
      if (d.overnight === null || d.overnight === undefined) d.overnight = "";
      if (d.description === null || d.description === undefined) d.description = "";
      obj.days[i] = d;
    }
    return obj;
  }

  function stripEditPrefix_(t) {
    var s = String(t || "").trim();
    if (s.toLowerCase().indexOf("/edit") === 0) {
      return s.replace(/^\/edit(@\w+)?\s*/i, "").trim();
    }
    return s;
  }

  // ---------- HELP ----------
  function helpText_() {
    return (
      "Hi! I’m Treeple Bot.\n\n" +
      "Commands:\n" +
      "/new — create request\n" +
      "/show — show current draft\n" +
      "/gen — generate draft (from Library) if request exists\n" +
      "/docs — rebuild Google Doc (after edits)\n" +
      "/cancel — cancel / reset"
    );
  }

  // ---------- MAIN (LOCK) ----------
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    var c = cmd_(text);

    // session
    var sess = getSession_(chatId);
    if (!sess || typeof sess !== "object") sess = { state: "IDLE", data: {} };
    if (!sess.state) sess.state = "IDLE";
    if (!sess.data || typeof sess.data !== "object") sess.data = {}; // ✅ FIX: data всегда существует

    // alias
    if (c === "/docs") c = "/done";

    // ---------- GLOBAL COMMANDS ----------
    if (c === "/start") {
      clearSession_(chatId);
      clearDraft_(chatId);
      clearItin_();
      return sendMessage_(chatId, helpText_());
    }

    if (c === "/cancel") {
      clearSession_(chatId);
      clearDraft_(chatId);
      clearItin_();
      return sendMessage_(chatId, "OK. Cancelled. Type /new to start again.");
    }

    if (c === "/new") {
      var username = "";
      if (m && m.from) {
        username = (m.from.username || ((m.from.first_name || "") + " " + (m.from.last_name || "")).trim() || "");
      }
      clearItin_();
      clearDraft_(chatId);
      setSession_(chatId, { state: "WAIT_CITY", data: { username: username } });
      return sendMessage_(chatId, "Where are we going? Type city/region (e.g., Almaty or Almaty + Kolsay).");
    }

    if (c === "/show") {
      var it0 = getItin_();
      if (it0) return sendLongMessage_(chatId, fmtItin_(it0));

      var d0 = getDraft_(chatId);
      if (!d0) return sendMessage_(chatId, "No draft yet. Use /new.");
      return sendLongMessage_(chatId, d0);
    }

     if (c === "/done") {
     var requestId = (sess && sess.data && sess.data.requestId) ? String(sess.data.requestId) : "";

     // fallback: если вдруг session потерялась, попробуем взять последний requestId из Script Properties
     if (!requestId) {
     requestId = String(PropertiesService.getScriptProperties().getProperty("LAST_REQUEST_ID_" + chatId) || "").trim();
     }
     if (!requestId) {
       return sendMessage_(chatId, "No requestId found. Use /new to generate a request first.");
     }

     var itDone = null;
     var sp = PropertiesService.getScriptProperties();
     var rawByReq = sp.getProperty("ITIN_" + requestId);
     if (rawByReq) {
       try { itDone = JSON.parse(rawByReq); } catch (_) { itDone = null; }
     }
     if (!itDone) itDone = getItin_();
     if (!itDone) {
       var rawLast = sp.getProperty("LAST_ITIN_JSON");
       if (rawLast) {
         try { itDone = JSON.parse(rawLast); } catch (_) { itDone = null; }
       }
     }
     if (!itDone) return sendMessage_(chatId, "No itinerary to export. Use /new (or /gen).");
     sp.setProperty("LAST_REQUEST_ID_" + chatId, requestId);
     sp.setProperty("ITIN_" + requestId, JSON.stringify(itDone));

     if (typeof exportDocForChat !== "function") {
       return sendMessage_(chatId, "❌ Missing exportDocForChat(chatId, requestId) in DocsExport.gs");
     }

     sendMessage_(chatId, "⏳ Creating Google Doc from season template...");
     var url = "";
     try {
       url = exportDocForChat(chatId, requestId);
     } catch (eDoc) {
       var msg = (eDoc && eDoc.message) ? eDoc.message : String(eDoc);
       var hint = "Please verify TEMPLATE_*_ID, template access, and Web App deployment (Execute as Me, Anyone access).";
       sendMessage_(chatId, "❌ Doc export failed: " + msg + "\n" + hint);
       return;
     }

     // синк в days sheet (если есть)
     try { upsertDays_(requestId, itDone); } catch (e) {}

     clearSession_(chatId);

     return sendMessage_(chatId, "✅ Google Doc:\n" + url + "\nType /new for a new request. (Use /show to view draft)");
    }


    // /gen = regenerate from saved req in session
    if (c === "/gen") {
      var req0 = (sess && sess.data && sess.data.req) ? sess.data.req : null;
      if (!req0) return sendMessage_(chatId, "No request context to generate from. Start with /new and finish the form.");

      if (typeof gen_generateItineraryStruct_ !== "function") {
        return sendMessage_(chatId, "❌ Missing gen_generateItineraryStruct_(req) in Generator.gs");
      }

      var it = gen_generateItineraryStruct_(req0);
      it = validateItin_(it, { strict: false });
      if (!it) return sendMessage_(chatId, "❌ Generator returned invalid structure.");

      setItin_(it);

      var preview = fmtItin_(it);
      setDraft_(chatId, preview);

      // requestId
      var reqId = (sess && sess.data && sess.data.requestId) ? String(sess.data.requestId) : ("CHAT-" + chatId + "-" + Date.now());

      // сохраняем контекст + requestId
      sess.state = "EDIT_ITIN";
      sess.data.req = req0;
      sess.data.requestId = reqId;
      setSession_(chatId, sess);
      if (reqId) {
        PropertiesService.getScriptProperties().setProperty("LAST_REQUEST_ID_" + chatId, String(reqId));
        PropertiesService.getScriptProperties().setProperty("ITIN_" + String(reqId), JSON.stringify(it));
      }

      // ✅ AUTO EXPORT
      if (typeof exportDocForChat !== "function") {
        return sendMessage_(chatId, "❌ Missing exportDocForChat(chatId, requestId) in DocsExport.gs");
      }
      sendMessage_(chatId, "⏳ Creating Google Doc from season template...");
      var url = exportDocForChat(chatId, reqId);
      sendMessage_(chatId, "✅ Google Doc:\n" + url);

      sendMessage_(chatId, "✅ Updated. Reply with another edit, or type /done to export again. Use /show to view.");
      return sendLongMessage_(chatId, preview);
    }

    // ---------- EDIT MODE (STRUCT) ----------
   if (sess.state === "EDIT_ITIN") {
  // любое сообщение без /команды = edit
     if (!c) {
       var itCur = getItin_();
       if (!itCur) return sendMessage_(chatId, "No itinerary in memory. Use /new.");

       var editText = stripEditPrefix_(text);
       if (!editText) editText = text;

       var logic = "";
       if (typeof buildTravelLogicBlock_ === "function") {
       logic = buildTravelLogicBlock_(itCur.meta || {});
      }

       if (typeof openAiText_ !== "function") {
       return sendMessage_(chatId, "⚠️ OpenAI is not available for structured edits. Use /show and regenerate if needed.");
      }

       var prompt =
         "You are a strict JSON itinerary editor.\n" +
         "Return ONLY valid JSON. No markdown, no comments.\n\n" +
         (logic ? (logic + "\n") : "") +
         "SCHEMA:\n" +
         "{ meta: {...}, days: [ {number,date,name,time,location,overnight,description} ] }\n\n" +
         "HARD RULES:\n" +
         "- Language: English.\n" +
         "- Keep the number of days the same unless user explicitly changes trip length.\n" +
         "- Keep dates unless user explicitly changes dates.\n" +
         "- time/location/overnight MUST include labels exactly: 'Time:', 'Visited Locations:', 'Overnight:' (or be empty).\n" +
         "- Each description MUST be 20–35 words (not shorter).\n" +
         "- Be realistic: late arrivals = no sightseeing. Long day trips = early start + late return.\n" +
         "- Arrival day: if arrival >= 18:00, only transfer/check-in/dinner/rest.\n" +
         "- Departure day: only checkout + airport transfer, no long tours.\n\n" +
         "CURRENT_JSON:\n" + JSON.stringify(itCur) + "\n\n" +
         "USER_EDITS:\n" + editText;

       var raw = openAiText_(prompt, { max_output_tokens: 2500 });

       var parsed = null;
       try { parsed = JSON.parse(extractJson_(raw)); } catch (e) { parsed = null; }

       parsed = validateItin_(parsed, { strict: true });
       if (!parsed) return sendMessage_(chatId, "❌ Edit failed (invalid JSON). Try simpler edit.");

        // post-fix logic + description length
       if (typeof applyTravelLogicPostFix_ === "function") {
       parsed = applyTravelLogicPostFix_(parsed);
       }

       setItin_(parsed);

       var preview = fmtItin_(parsed);
       setDraft_(chatId, preview);

       // auto rebuild doc after each edit (если есть requestId)
       var requestId = (sess && sess.data && sess.data.requestId) ? String(sess.data.requestId) : "";
       if (!requestId) {
       requestId = PropertiesService.getScriptProperties().getProperty("LAST_REQUEST_ID_" + chatId) || "";
       }
       if (requestId) {
         PropertiesService.getScriptProperties().setProperty("LAST_REQUEST_ID_" + chatId, String(requestId));
         PropertiesService.getScriptProperties().setProperty("ITIN_" + String(requestId), JSON.stringify(parsed));
       }

       var docUrl = "";
       if (requestId && typeof exportDocForChat === "function") {
        try {
        sendMessage_(chatId, "⏳ Rebuilding Google Doc from season template...");
        docUrl = exportDocForChat(chatId, requestId);
        sendMessage_(chatId, "✅ Google Doc:\n" + docUrl);
       } catch (e2) {
        sendMessage_(chatId, "⚠️ Doc rebuild failed: " + (e2 && e2.message ? e2.message : String(e2)));
      }
    }

    sendMessage_(chatId, "✅ Updated. Reply with another edit, or type /done to export again. Use /show to view.");
    return sendLongMessage_(chatId, preview);
  }
}

    // ---------- FORM FLOW ----------
    switch (sess.state) {
      case "WAIT_CITY":
        sess.data.city = text;
        sess.state = "WAIT_START";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "Start date? Format: DD.MM.YYYY (e.g., 15.01.2026).");

      case "WAIT_START": {
        var d1 = parseDateDdMmYyyy_(text);
        if (!d1) return sendMessage_(chatId, "I can’t parse the date. Format: DD.MM.YYYY (e.g., 15.01.2026).");

        var TZ_ = (typeof TZ !== "undefined" && TZ) ? TZ : Session.getScriptTimeZone();
        var s = seasonFromDate_(d1);

        sess.data.start = Utilities.formatDate(d1, TZ_, "dd.MM.yyyy");
        sess.data.season = s.seasonLabel;
        sess.data.templateKey = s.templateKey;

        sess.state = "WAIT_DAYS";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "How many days? (number, e.g., 7)");
      }

      case "WAIT_DAYS": {
        var days = parseIntSafe_(text);
        if (days === null || days < 1 || days > 30) return sendMessage_(chatId, "Days must be a number 1–30.");
        sess.data.days = days;
        sess.state = "WAIT_PAX";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "How many adults? (number, e.g., 2)");
      }

      case "WAIT_PAX": {
        var pax = parseIntSafe_(text);
        if (pax === null || pax < 1 || pax > 200) return sendMessage_(chatId, "Adults must be a number 1–200.");
        sess.data.pax = pax;
        sess.state = "WAIT_KIDS";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "How many kids? (number, can be 0)");
      }

      case "WAIT_KIDS": {
        var kids = parseIntSafe_(text);
        if (kids === null || kids < 0 || kids > 100) return sendMessage_(chatId, "Kids must be a number 0–100.");
        sess.data.kids = kids;
        sess.state = "WAIT_ARRIVAL";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "ARRIVAL_TIME? Format HH:MM (e.g., 10:30) or '-' if unknown.");
      }

      case "WAIT_ARRIVAL": {
        var at = parseTimeHHMMOrDash_(text);
        if (at === null) return sendMessage_(chatId, "ARRIVAL_TIME must be HH:MM (e.g., 10:30) or '-'.");
        sess.data.arrivalTime = at;
        sess.state = "WAIT_DEPARTURE";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "DEPARTURE_TIME? Format HH:MM (e.g., 19:00) or '-' if unknown.");
      }

      case "WAIT_DEPARTURE": {
        var dt = parseTimeHHMMOrDash_(text);
        if (dt === null) return sendMessage_(chatId, "DEPARTURE_TIME must be HH:MM (e.g., 19:00) or '-'.");
        sess.data.departureTime = dt;
        sess.state = "WAIT_NOTES";
        setSession_(chatId, sess);
        return sendMessage_(chatId, "Any notes / location wishes? Type text, or /skip to leave empty.");
      }

      case "WAIT_NOTES": {
       // гарантируем data
       if (!sess.data || typeof sess.data !== "object") sess.data = {};

       // /skip работает даже если это не команда
       var rawTxt = String(m.text || "").trim();
       var isSkip = /^\/skip(\s|$)/i.test(rawTxt);
       sess.data.notes = isSkip ? "" : rawTxt;

       // 1) saveRequest_
       var saved = null;
       try {
       if (typeof saveRequest_ === "function") saved = saveRequest_(chatId, sess.data);
       } catch (e1) {
       sendMessage_(chatId, "❌ saveRequest_ crashed: " + (e1 && e1.message ? e1.message : String(e1)));
       throw e1;
       }

       var req = {
       city: sess.data.city || "",
       start: sess.data.start || "",
       days: Number(sess.data.days || 0),
       pax: Number(sess.data.pax || 0),
       kids: Number(sess.data.kids || 0),
       arrivalTime: sess.data.arrivalTime || "-",
       departureTime: sess.data.departureTime || "-",
       notes: (sess.data.notes == null) ? "" : String(sess.data.notes),  // ✅ важно
       season: sess.data.season || "",
       templateKey: sess.data.templateKey || "",
       datesText: (saved && saved.dates) ? saved.dates : ""
       };

       if (typeof gen_generateItineraryStruct_ !== "function") {
       clearSession_(chatId);
       return sendMessage_(chatId, "❌ Missing gen_generateItineraryStruct_(req) in Generator.gs");
       }

       sendMessage_(chatId, "⏳ Saving request and generating itinerary from Library (STRUCT)...");

       // 2) generator
       var itNew = null;
       try {
        itNew = gen_generateItineraryStruct_(req);
       } catch (e2) {
       sendMessage_(chatId, "❌ gen_generateItineraryStruct_ crashed: " + (e2 && e2.message ? e2.message : String(e2)));
        throw e2;
       }

       itNew = validateItin_(itNew, { strict: false });
       if (!itNew) {
        clearSession_(chatId);
        return sendMessage_(chatId, "❌ Generator returned invalid structure.");
       }

       setItin_(itNew);
        if (saved && saved.requestId) {
        PropertiesService.getScriptProperties().setProperty("LAST_REQUEST_ID_" + chatId, String(saved.requestId));
        PropertiesService.getScriptProperties().setProperty("ITIN_" + String(saved.requestId), JSON.stringify(itNew));
        }
       var preview = fmtItin_(itNew);
       setDraft_(chatId, preview);

       var requestId = (saved && saved.requestId) ? String(saved.requestId) : ("CHAT-" + chatId + "-" + Date.now());

       setSession_(chatId, { state: "EDIT_ITIN", data: { req: req, requestId: requestId } });

       sendMessage_(chatId, "✅ Updated. Reply with another edit, or type /done to export again. Use /show to view.");
       // если ты хочешь авто-экспорт тут — оставь как есть у себя
       return sendLongMessage_(chatId, preview);
      }


      default:
        if (!c) return sendMessage_(chatId, "Type /new to create a request. Or /start to see commands.");
        return;
    }

  } catch (e) {
    console.error(e && e.stack ? e.stack : e);
    try { sendMessage_(chatId, "❌ Error: " + (e && e.message ? e.message : String(e))); } catch (_) {}
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}




// ===================== SAVE INTO YOUR REQUEST SHEET =====================
function saveRequest_(chatId, data) {
    // ✅ SAFETY: normalize input
  data = data || {};
  data.notes = (data.notes == null) ? "" : String(data.notes);
  data.city = (data.city == null) ? "" : String(data.city);
  data.start = (data.start == null) ? "" : String(data.start);
  data.arrivalTime = (data.arrivalTime == null) ? "-" : String(data.arrivalTime);
  data.departureTime = (data.departureTime == null) ? "-" : String(data.departureTime);
  data.days = Number(data.days || 0);
  data.pax = Number(data.pax || 0);
  data.kids = Number(data.kids || 0);

  var ss = openSpreadsheet_();
  var sh = getRequestsSheet_(ss);
  var row = appendStyledBlankRow_(sh);
  var map = (typeof getHeaderMapNorm_ === "function") ? getHeaderMapNorm_(sh) : {};

  var start = toDate_(data.start);
  var days = Number(data.days || 0);
  var nights = Math.max(0, days - 1);

  var end = new Date(start.getTime());
  end.setDate(start.getDate() + days - 1);

  var createdAtStr = Utilities.formatDate(new Date(), TZ, "dd.MM.yyyy H:mm");
  var startStr = Utilities.formatDate(start, TZ, "dd.MM.yyyy");
  var endStr = Utilities.formatDate(end, TZ, "dd.MM.yyyy");
  var datesStr = startStr + " - " + endStr;

  var monthNum = start.getMonth() + 1;
  var season = seasonTitle_(monthNum);      // Winter/Spring/Summer/Autumn
  var templateKey = season.toLowerCase();   // winter/spring/summer/autumn
  var tourMonth = monthNameEn_(monthNum);   // January ...

  var daysNights = String(days) + "D" + String(nights) + "N";
  var tourTitle = (data.city || "Tour") + " • " + daysNights + " • " + season;

  var requestId = makeRequestId_();

  // Фолбэки под твою таблицу (как на скрине A..Q)
  setCellSafe_(sh, row, col_(map, "REQUESTID", 1), requestId);
  setCellSafe_(sh, row, col_(map, "CREATEDAT", 2), createdAtStr);
  setCellSafe_(sh, row, col_(map, "STATUS", 3), "NEW");
  setCellSafe_(sh, row, col_(map, "TELEGRAMCHATID", 4), String(chatId));

  // dropdown-safe (чтобы не оставалось пустым даже при Reject input)
  setCellRespectValidation_(sh.getRange(row, col_(map, "SEASON", 5)), season,
    ["Winter","Spring","Summer","Autumn","-",""]);
  setCellRespectValidation_(sh.getRange(row, col_(map, "TEMPLATEKEY", 6)), templateKey,
    ["winter","spring","summer","autumn","-","", "Winter","Spring","Summer","Autumn"]);

  setCellSafe_(sh, row, col_(map, "TOURTITLE", 7), tourTitle);
  setCellSafe_(sh, row, col_(map, "DATES", 8), datesStr);
  setCellSafe_(sh, row, col_(map, "CITY", 9), data.city || "");
  setCellSafe_(sh, row, col_(map, "DAYSNIGHTS", 10), daysNights);
  setCellSafe_(sh, row, col_(map, "PAXTAG", 11), String(data.pax || ""));
  setCellSafe_(sh, row, col_(map, "TOURMONTH", 12), tourMonth);
  setCellSafe_(sh, row, col_(map, "KIDS", 13), String((data.kids === undefined || data.kids === null) ? 0 : data.kids));

  setCellSafe_(sh, row, col_(map, "FREEFORMLOCATIONREQUESTS", 14), data.notes || "");
  setCellSafe_(sh, row, col_(map, "ARRIVALTIME", 15), data.arrivalTime || "-");
  setCellSafe_(sh, row, col_(map, "DEPARTURETIME", 16), data.departureTime || "-");
  // DOC_URL (17) оставляем пустым

  return {
    requestId: requestId,
    city: data.city || "",
    dates: datesStr,
    pax: data.pax || 0,
    kids: (data.kids === undefined || data.kids === null) ? 0 : data.kids,
    templateKey: templateKey
  };
}

// ---------- helpers ----------
function col_(map, key, fallbackCol) {
  return (map && map[key]) ? map[key] : fallbackCol;
}

function setCellSafe_(sheet, row, col, value) {
  if (!col) return;
  var r = sheet.getRange(row, col);
  var dv = r.getDataValidation();

  // если Reject input ломает запись — временно снимаем validation, пишем, возвращаем
  if (dv) {
    try {
      r.setValue(value);
      return;
    } catch (e) {
      try {
        r.clearDataValidations();
        r.setValue(value);
      } finally {
        try { r.setDataValidation(dv); } catch (_) {}
      }
      return;
    }
  }
  r.setValue(value);
}

function setCellRespectValidation_(range, value, fallbackChoices) {
  var dv = range.getDataValidation();
  var v = (value === undefined || value === null) ? "" : String(value);

  if (!dv) {
    range.setValue(v);
    return;
  }

  var allowed = getAllowedFromValidation_(dv);
  if (allowed && allowed.length) {
    if (allowed.indexOf(v) !== -1) {
      range.setValue(v);
      return;
    }

    var fb = [];
    if (fallbackChoices !== undefined && fallbackChoices !== null) {
      fb = Array.isArray(fallbackChoices) ? fallbackChoices : [fallbackChoices];
    }

    for (var i = 0; i < fb.length; i++) {
      var cand = String(fb[i]);
      if (allowed.indexOf(cand) !== -1) {
        range.setValue(cand);
        return;
      }
    }

    if (allowed.indexOf("-") !== -1) {
      range.setValue("-");
      return;
    }

    range.setValue(String(allowed[0]));
    return;
  }

  // если не смогли распарсить allowed — force set
  var old = dv;
  try {
    range.setValue(v);
  } catch (e2) {
    try {
      range.clearDataValidations();
      range.setValue(v);
    } finally {
      try { range.setDataValidation(old); } catch (_2) {}
    }
  }
}

function getAllowedFromValidation_(dv) {
  try {
    var crit = dv.getCriteriaType();
    var args = dv.getCriteriaValues();

    if (crit === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST) {
      var list = (args && args[0] && args[0].length) ? args[0] : [];
      var out = [];
      for (var i = 0; i < list.length; i++) out.push(String(list[i]));
      return out;
    }

    if (crit === SpreadsheetApp.DataValidationCriteria.VALUE_IN_RANGE) {
      var rng = args ? args[0] : null;
      if (!rng) return null;

      var vals = rng.getValues();
      var out2 = [];
      for (var r = 0; r < vals.length; r++) {
        for (var c = 0; c < vals[r].length; c++) {
          var x = vals[r][c];
          if (x !== "" && x !== null && x !== undefined) out2.push(String(x));
        }
      }
      return out2;
    }
  } catch (e) {}
  return null;
}


// ===================== SHEET / HEADERS HELPERS =====================
function openSpreadsheet_() {
  const ssId = (PropertiesService.getScriptProperties().getProperty(PROP.SPREADSHEET_ID) || "").trim();
  if (!ssId) throw new Error("SPREADSHEET_ID is missing. Put your 'Treeple Bot Requests' file ID into Script properties.");
  return SpreadsheetApp.openById(ssId);
}

function getRequestsSheet_(ss) {
  const preferred = (PropertiesService.getScriptProperties().getProperty(PROP.SHEET_REQUESTS) || "").trim();
  if (preferred) {
    const sh = ss.getSheetByName(preferred);
    if (sh) return sh;
  }
  // auto-detect by required columns
  for (const sh of ss.getSheets()) {
    const map = getHeaderMapNorm_(sh);
    if (map.REQUESTID && map.TELEGRAMCHATID && map.CITY) return sh;
  }
  return ss.getSheets()[0];
}

function getHeaderMapNorm_(sheet) {
  const lastCol = sheet.getLastColumn();
  const map = {};
  if (lastCol < 1) return map;

  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  headers.forEach((h, i) => {
    const raw = String(h || "");
    const norm = normalizeHeader_(raw);
    if (norm) map[norm] = i + 1;

    // extra heuristics
    const up = raw.toUpperCase().replace(/[\r\n]+/g, " ").trim();
    if (!map.TEMPLATEKEY && up.includes("TEMPLATE") && up.includes("KEY")) map.TEMPLATEKEY = i + 1;
    if (!map.TOURTITLE && up.includes("TOUR") && up.includes("TITLE")) map.TOURTITLE = i + 1;
    if (!map.SEASON && up.includes("SEASON")) map.SEASON = i + 1;
    if (!map.CREATEDAT && up.includes("CREATED")) map.CREATEDAT = i + 1;
    if (!map.TELEGRAMCHATID && up.includes("TELEGRAM") && up.includes("CHAT") && up.includes("ID")) map.TELEGRAMCHATID = i + 1;
  });

  return map;
}

function normalizeHeader_(h) {
  return String(h || "")
    .toUpperCase()
    .replace(/[\r\n]+/g, "")   // remove newlines
    .replace(/\s+/g, "")       // remove spaces
    .replace(/[^A-Z0-9]/g, "");// remove underscores/dashes/etc
}

function appendStyledBlankRow_(sheet) {
  const lastCol = Math.max(1, sheet.getLastColumn());
  const lastRow = Math.max(1, sheet.getLastRow());
  sheet.insertRowAfter(lastRow);
  const newRow = lastRow + 1;

  // copy row 2 formatting/validations if exists
  if (sheet.getLastRow() >= 2) {
    const src = sheet.getRange(2, 1, 1, lastCol);
    const dst = sheet.getRange(newRow, 1, 1, lastCol);
    src.copyTo(dst);
    dst.clear({ contentsOnly: true }); // keep validations/formatting, clear values/formulas
  }
  return newRow;
}

function setValueRespectValidation_(range, value, fallback) {
  const v = (value === undefined || value === null) ? "" : String(value);
  try {
    range.setValue(v);
  } catch (e) {
    const fb = (fallback === undefined || fallback === null) ? "-" : String(fallback);
    try { range.setValue(fb); } catch (_) {}
  }
}

// ===================== TELEGRAM API =====================
function TELEGRAM_TOKEN_() {
  return (PropertiesService.getScriptProperties().getProperty(PROP.TELEGRAM_TOKEN) || "").trim();
}
function WEB_APP_URL_() {
  return (PropertiesService.getScriptProperties().getProperty(PROP.WEB_APP_URL) || "").trim();
}

function tgCall_(method, payload) {
  const token = TELEGRAM_TOKEN_();
  if (!token) throw new Error("Missing TELEGRAM_TOKEN");
  const url = `https://api.telegram.org/bot${encodeURIComponent(token)}/${method}`;
  const res = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload || {}),
    muteHttpExceptions: true
  });
  return safeJsonParse_(res.getContentText());
}

function sendMessage_(chatId, text, opts) {
  var token = PropertiesService.getScriptProperties().getProperty("TELEGRAM_TOKEN");
  var url = "https://api.telegram.org/bot" + token + "/sendMessage";

  var payload = {
    chat_id: chatId,
    text: String(text || ""),
    parse_mode: "HTML",
    disable_web_page_preview: true
  };

  if (opts && opts.reply_markup) {
    // Telegram ждёт JSON-строку
    payload.reply_markup = JSON.stringify(opts.reply_markup);
  }

  UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}


function draftKey_(chatId) { return "DRAFT_" + String(chatId); }
function getDraft_(chatId) { return PropertiesService.getScriptProperties().getProperty(draftKey_(chatId)) || ""; }
function setDraft_(chatId, text) { PropertiesService.getScriptProperties().setProperty(draftKey_(chatId), String(text || "")); }
function clearDraft_(chatId) { PropertiesService.getScriptProperties().deleteProperty(draftKey_(chatId)); }

function sendLongMessage_(chatId, text) {
  var max = 3500;
  var s = String(text || "");
  for (var i = 0; i < s.length; i += max) sendMessage_(chatId, s.substring(i, i + max));
}

function sendLongMessage_(chatId, text) {
  var max = 3500; // безопасно для Telegram
  var s = String(text || "");
  for (var i = 0; i < s.length; i += max) {
    sendMessage_(chatId, s.substring(i, i + max));
  }
}


function answerCallbackQuery_(id) {
  if (!id) return;
  return tgCall_("answerCallbackQuery", { callback_query_id: id });
}

// ===================== SESSIONS =====================
function sessionKey_(chatId) { return `SESS_${chatId}`; }

function sessKey_(chatId) {
  return "SESS_" + String(chatId);
}

function getSession_(chatId) {
  var k = sessKey_(chatId);
  var cache = CacheService.getScriptCache();

  var raw = cache.get(k);
  if (!raw) raw = PropertiesService.getScriptProperties().getProperty(k);
  if (!raw) return null;

  try { return JSON.parse(raw); } catch (e) { return null; }
}

function setSession_(chatId, sess) {
  var k = sessKey_(chatId);
  var raw = JSON.stringify(sess || {});
  CacheService.getScriptCache().put(k, raw, 21600); // 6 часов
  PropertiesService.getScriptProperties().setProperty(k, raw);
}

function clearSession_(chatId) {
  var k = sessKey_(chatId);
  CacheService.getScriptCache().remove(k);
  PropertiesService.getScriptProperties().deleteProperty(k);
}


// ===================== UTIL =====================
function safeJsonParse_(s) { try { return JSON.parse(s); } catch (_) { return null; } }

function makeRequestId_() {
  const stamp = Utilities.formatDate(new Date(), TZ, "yyyyMMdd-HHmmss");
  const rnd = Math.floor(Math.random() * 0xFFFF).toString(16).toUpperCase().padStart(4, "0");
  return `REQ-${stamp}-${rnd}`;
}

function parseDateDdMmYyyy_(text) {
  const m = String(text || "").trim().match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{4})$/);
  if (!m) return null;
  const dd = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  const yy = parseInt(m[3], 10);
  const d = new Date(yy, mm - 1, dd);
  if (d.getFullYear() !== yy || d.getMonth() !== mm - 1 || d.getDate() !== dd) return null;
  return d;
}

function toDate_(x) {
  if (x instanceof Date) return x;

  if (typeof x === "string") {
    // try dd.MM.yyyy
    const m = x.trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      const dd = parseInt(m[1], 10);
      const mm = parseInt(m[2], 10);
      const yy = parseInt(m[3], 10);
      const d1 = new Date(yy, mm - 1, dd);
      if (!isNaN(d1.getTime())) return d1;
    }
    // ISO etc
    const d2 = new Date(x);
    if (!isNaN(d2.getTime())) return d2;
  }

  throw new Error("Invalid start date in session: " + String(x));
}

function normalizeTimeOrDash_(text) {
  const t = String(text || "").trim();
  if (t === "-" || t.toLowerCase() === "unknown") return "-";
  const m = t.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m) return null;
  return `${String(m[1]).padStart(2, "0")}:${m[2]}`;
}

function monthNameEn_(m) {
  const arr = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return arr[m - 1] || "";
}

function seasonTitle_(m) {
  if (m === 12 || m === 1 || m === 2) return "Winter";
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  return "Autumn";
}



function authorizeNow() {
  // 1) UrlFetch (нужно, чтобы отправлять ответы в Telegram)
  UrlFetchApp.fetch("https://api.telegram.org");

  // 2) Sheets (если используешь setup/запись заявок)
  const sp = PropertiesService.getScriptProperties();
  const ssId = sp.getProperty("SPREADSHEET_ID");
  if (ssId) SpreadsheetApp.openById(ssId).getSheets();

  Logger.log("✅ Authorization OK");
}
function hardResetWebhook() {
  const token = (PropertiesService.getScriptProperties().getProperty("TELEGRAM_TOKEN") || "").trim();
  if (!token) throw new Error("No TELEGRAM_TOKEN");

  const delUrl = `https://api.telegram.org/bot${token}/deleteWebhook`;
  Logger.log(UrlFetchApp.fetch(delUrl, { method: "post", muteHttpExceptions: true }).getContentText());

  resetWebhook();
}
function debugStorage() {
  const sp = PropertiesService.getScriptProperties();
  const ssId = sp.getProperty("SPREADSHEET_ID");
  Logger.log("SPREADSHEET_ID = " + ssId);
  if (!ssId) { Logger.log("NO SPREADSHEET_ID (setup() created new one earlier)"); return; }

  const ss = SpreadsheetApp.openById(ssId);
  Logger.log("Spreadsheet URL = " + ss.getUrl());
  Logger.log("Sheets = " + ss.getSheets().map(s => s.getName()).join(", "));

  const req = getRequestsSheet_(ss);
  Logger.log("Detected REQUEST sheet = " + req.getName() + " (rows=" + req.getLastRow() + ")");
}

function debugCols() {
  const ss = openSpreadsheet_();
  const sh = getRequestsSheet_(ss);
  const map = getHeaderMapNorm_(sh);
  Logger.log("TEMPLATEKEY col = " + map.TEMPLATEKEY);
  Logger.log("TOURTITLE col = " + map.TOURTITLE);
  Logger.log("SEASON col = " + map.SEASON);
}
function commandName_(text) {
  const t = String(text || "").trim();
  const first = t.split(/\s+/)[0];     // берём первый “токен”
  return first.split("@")[0];          // /new@BotName -> /new
}

function isDuplicateUpdate_(update) {
  const id = update && update.update_id;
  if (id === undefined || id === null) return false;

  const cache = CacheService.getScriptCache();
  const key = "upd_" + String(id);

  if (cache.get(key)) return true;     // уже обработан
  cache.put(key, "1", 21600);          // 6 часов
  return false;
}
function handleEditDraft_(chatId, text) {
  var t = String(text || "").trim();
  var cmd = commandName_(t);

  // commands still work
  if (cmd === "/show") {
    var cur = getDraft_(chatId);
    if (!cur) return sendMessage_(chatId, "No draft yet. Use /gen first.");
    return sendLongMessage_(chatId, cur);
  }

  if (cmd === "/done") {
    clearSession_(chatId);
    return sendMessage_(chatId, "✅ Done. Draft saved. Use /show to view or /gen to regenerate.");
  }

  if (cmd === "/cancel") {
    clearSession_(chatId);
    return sendMessage_(chatId, "Cancelled. Use /gen to generate again or /new for a new request.");
  }

  // any other message = edit instruction
  var draft = getDraft_(chatId);
  if (!draft) return sendMessage_(chatId, "No draft found. Use /gen first.");

  // Build an edit prompt (English only)
  var prompt =
    "You are editing a Treeple travel itinerary.\n" +
    "Apply the user's requested changes to the CURRENT ITINERARY.\n" +
    "Output the FULL updated itinerary (not a summary).\n" +
    "Keep the same format for each day:\n" +
    "Day N – DD.MM.YYYY: Title\nTime: ...\nVisited Locations: ...\nOvernight: ...\nDescription...\n" +
    "Language: English only. No emojis. No tables.\n\n" +
    "USER CHANGE REQUEST:\n" + t + "\n\n" +
    "CURRENT ITINERARY:\n" + draft;

  var updated = openAiText_(prompt, { model: gen_openAiModel_ ? gen_openAiModel_() : OPENAI_MODEL_() });

  if (!updated || !String(updated).trim()) {
    return sendMessage_(chatId, "⚠️ OpenAI returned empty text. Try again.");
  }

  updated = String(updated).trim();
  setDraft_(chatId, updated);

  sendMessage_(chatId, "✅ Updated. Send another change, or /show, or /done.");
  return sendLongMessage_(chatId, updated);
}

function parseTimeHHMM_(s) {
  s = String(s || "").trim();
  if (!s || s === "-" || s.toLowerCase() === "unknown") return "-";
  // accept H:MM or HH:MM
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  var hh = Number(m[1]), mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
}

function addDays_(dateObj, daysToAdd) {
  var d = new Date(dateObj.getTime());
  d.setDate(d.getDate() + Number(daysToAdd || 0));
  return d;
}
