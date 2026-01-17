/****************************************************
 * DocsExport.gs (STRUCT VERSION) — FIXED + RETRIES
 * Creates Google Doc from seasonal template and replaces {{{PLACEHOLDER}}}
 * NO draft parsing. Uses itinerary JSON (struct) from Script Properties or "days" sheet.
 *
 * FIXES:
 *  - Retries for DocumentApp.openById + Drive operations (fixes "document is inaccessible")
 *  - Small waits after makeCopy (Google Drive propagation)
 *  - Replacement in Body + Header + Footer
 ****************************************************/

var DOCEXP_ = {
  MAX_DAYS: 12,
  RETRIES: 8,
  RETRY_SLEEP_MS: 600
};

/* ============================================================
 *                     PUBLIC API
 * ============================================================ */

/**
 * Export Google Doc for chat/request.
 * Sources, in order:
 *  1) ScriptProperties ITIN_<chatId>
 *  2) ScriptProperties ITIN_<requestId>
 *  3) ScriptProperties LAST_ITIN_JSON
 *  4) Build from "days" sheet if present (requires requestId)
 *
 * @param {number|string} chatId
 * @param {string} requestId  (can be empty; then sheet updates are skipped)
 * @returns {string} docUrl
 */
function exportDocForChat(chatId, requestId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    chatId = (chatId === null || chatId === undefined) ? "" : String(chatId);
    requestId = (requestId === null || requestId === undefined) ? "" : String(requestId).trim();

    // spreadsheet (optional)
    var ss = _openSpreadsheet_(); // can be null if SPREADSHEET_ID not set
    var reqSheet = ss ? _getRequestsSheet_(ss) : null;

    // request meta from sheet (optional)
    var reqMeta = (reqSheet && requestId) ? _getRequestMetaById_(reqSheet, requestId) : {};

    // itinerary struct from props / days sheet
    var it = _loadItineraryStruct_(chatId, requestId);

    if ((!it || !it.days || !it.days.length) && ss && requestId) {
      var daysSheet = _getDaysSheet_(ss);
      if (daysSheet) it = _buildItineraryFromDaysSheet_(daysSheet, requestId, reqMeta);
    }

    it = _normalizeItinerary_(it, reqMeta);

    if (!it || !it.days || !it.days.length) {
      throw new Error("No itinerary structure found. Save ITIN_<chatId> to Script Properties or ensure days sheet exists (requires requestId).");
    }
    if (it.days.length > DOCEXP_.MAX_DAYS) {
      throw new Error("Itinerary has " + it.days.length + " days. Template supports max " + DOCEXP_.MAX_DAYS + " days.");
    }

    // template id by season key
    var templateKey = (it.meta && it.meta.templateKey) ? String(it.meta.templateKey).toLowerCase() : "";
    if (!templateKey) templateKey = _seasonKeyFromStart_(it.meta && it.meta.startDate);

    var templateId = _templateIdByKey_(templateKey);
    if (!templateId) {
      throw new Error("Template ID missing. Set TEMPLATE_WINTER_ID / TEMPLATE_SPRING_ID / TEMPLATE_SUMMER_ID (and optionally TEMPLATE_AUTUMN_ID).");
    }

    // placeholders map
    var placeholders = _buildPlaceholders_(it);

    // filename
    // Example: 8D7N _ 4pax _ March _ Almaty _ Spring
    var fileName = [
      placeholders.DAYS_NIGHTS || "",
      placeholders.PAX_TAG || "",
      placeholders.TOUR_MONTH || "",
      (it.meta && it.meta.city) ? it.meta.city : (reqMeta.city || "Almaty"),
      _cap1_(templateKey)
    ].join(" _ ").replace(/\s+/g, " ").trim();

    if (!fileName) fileName = "Itinerary " + new Date().toISOString();

    // create doc
    var docUrl = _createDocFromTemplate_(templateId, fileName, placeholders);

    // update request row in sheet (optional)
    if (reqSheet && requestId) {
      _updateRequestRow_(reqSheet, requestId, {
        DOC_URL: docUrl,
        STATUS: "DOC_CREATED"
      });
    }

    return docUrl;

  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

/**
 * Export doc for requestId only (no chat needed).
 * Uses ITIN_<requestId> or days sheet.
 */
function exportDocForRequest(requestId) {
  return exportDocForChat("", requestId);
}

/* ============================================================
 *                     TESTS (EDITOR)
 * ============================================================ */

/**
 * TEST 1: Creates doc from SAMPLE itinerary (no Telegram needed).
 * Requires template IDs in Script Properties.
 * Logs DOC_URL.
 */
function testDocsExport_Sample() {
  var sample = _sampleItinerary_();
  sample = _normalizeItinerary_(sample, {});
  var key = String(sample.meta.templateKey || "spring").toLowerCase();

  var templateId = _templateIdByKey_(key);
  if (!templateId) throw new Error("Set TEMPLATE_*_ID in Script Properties (e.g., TEMPLATE_SPRING_ID)");

  var placeholders = _buildPlaceholders_(sample);

  var fileName = [
    placeholders.DAYS_NIGHTS,
    placeholders.PAX_TAG,
    placeholders.TOUR_MONTH,
    sample.meta.city,
    _cap1_(key)
  ].join(" _ ");

  var url = _createDocFromTemplate_(templateId, fileName, placeholders);
  Logger.log("DOC_URL=" + url);
}

/**
 * TEST 2: Creates doc from real itinerary stored as ITIN_<TEST_CHAT_ID>.
 * Set Script Property: TEST_CHAT_ID
 * IMPORTANT: requestId can be fake for test (sheet update will be skipped if not found)
 */
function testDocsExport_FromChat() {
  var chatId = PropertiesService.getScriptProperties().getProperty("TEST_CHAT_ID");
  if (!chatId) throw new Error("Set Script Property TEST_CHAT_ID (your Telegram chat id)");

  var it = _loadItineraryStruct_(chatId, "");
  if (!it) throw new Error("No ITIN_" + chatId + " in Script Properties. Generate itinerary in Telegram first.");

  var requestId = "TEST-" + new Date().getTime();
  var url = exportDocForChat(chatId, requestId);
  Logger.log("DOC_URL=" + url);
}

/**
 * TEST 3: Export by existing requestId (must exist in requests sheet and/or days sheet).
 * Set Script Property: TEST_REQUEST_ID
 */
function testDocsExport_FromRequestId() {
  var requestId = PropertiesService.getScriptProperties().getProperty("TEST_REQUEST_ID");
  if (!requestId) throw new Error("Set Script Property TEST_REQUEST_ID (existing requestId in sheet)");

  var url = exportDocForRequest(String(requestId));
  Logger.log("DOC_URL=" + url);
}

/* ============================================================
 *                     CORE HELPERS
 * ============================================================ */

function _prop_(name, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(name);
  v = (v === null || v === undefined) ? "" : String(v).trim();
  if (v) return v;
  return (fallback === undefined || fallback === null) ? "" : String(fallback).trim();
}

function _openSpreadsheet_() {
  // user said: REQUESTS_SHEET_ID is actually SPREADSHEET_ID
  var ssId = _prop_("SPREADSHEET_ID", _prop_("REQUESTS_SHEET_ID", ""));
  if (!ssId) return null;
  return SpreadsheetApp.openById(ssId);
}

function _normHeader_(h) {
  return String(h || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[_\-]+/g, "")
    .replace(/[^A-Z0-9А-ЯЁ]/g, "");
}

function _headerMap_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1) return {};
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  for (var c = 0; c < headers.length; c++) {
    var key = _normHeader_(headers[c]);
    if (key) map[key] = c + 1;
  }
  return map;
}

function _col_(map, candidates, def) {
  if (!Array.isArray(candidates)) candidates = [candidates];
  for (var i = 0; i < candidates.length; i++) {
    var k = _normHeader_(candidates[i]);
    if (map[k]) return map[k];
  }
  return def || 0;
}

function _getRequestsSheet_(ss) {
  var sh =
    ss.getSheetByName("request") ||
    ss.getSheetByName("requests") ||
    ss.getSheetByName("REQUEST") ||
    ss.getSheetByName("REQUESTS");
  if (sh) return sh;

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var mp = _headerMap_(sheets[i]);
    if (mp[_normHeader_("REQUEST_ID")] || mp[_normHeader_("REQUESTID")]) return sheets[i];
  }
  return ss.getSheets()[0];
}

function _getDaysSheet_(ss) {
  var sh = ss.getSheetByName("days") || ss.getSheetByName("DAYS");
  if (sh) return sh;

  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var mp = _headerMap_(sheets[i]);
    var hasReq = mp[_normHeader_("REQUEST_ID")] || mp[_normHeader_("REQUESTID")];
    var hasDay = mp[_normHeader_("DAY_INDEX")] || mp[_normHeader_("DAYINDEX")];
    if (hasReq && hasDay) return sheets[i];
  }
  return null;
}

function _findRowByRequestId_(sheet, requestId) {
  var mp = _headerMap_(sheet);
  var colReq = _col_(mp, ["REQUEST_ID", "REQUESTID"], 0);
  if (!colReq) return 0;

  var last = sheet.getLastRow();
  if (last < 2) return 0;

  var values = sheet.getRange(2, colReq, last - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0] || "").trim() === String(requestId)) return i + 2;
  }
  return 0;
}

function _getRequestMetaById_(reqSheet, requestId) {
  var row = _findRowByRequestId_(reqSheet, requestId);
  if (!row) return {};

  var mp = _headerMap_(reqSheet);
  var lastCol = reqSheet.getLastColumn();
  var vals = reqSheet.getRange(row, 1, 1, lastCol).getValues()[0];

  function getByCandidates_(cands, def) {
    for (var i = 0; i < cands.length; i++) {
      var col = _col_(mp, cands[i], 0);
      if (col) {
        var v = vals[col - 1];
        if (v !== "" && v !== null && v !== undefined) return v;
      }
    }
    return def;
  }

  return {
    requestId: requestId,
    city: String(getByCandidates_(["CITY", "DESTINATION", "REGION"], "") || ""),
    start: String(getByCandidates_(["START", "START_DATE", "DATE_START"], "") || ""),
    days: Number(getByCandidates_(["DAYS", "TOUR_DAYS"], 0) || 0),
    pax: Number(getByCandidates_(["PAX", "ADULTS"], 0) || 0),
    kids: Number(getByCandidates_(["KIDS", "CHILDREN"], 0) || 0),
    arrivalTime: String(getByCandidates_(["ARRIVAL_TIME", "ARRIVALTIME"], "-") || "-"),
    departureTime: String(getByCandidates_(["DEPARTURE_TIME", "DEPARTURETIME"], "-") || "-"),
    season: String(getByCandidates_(["SEASON"], "") || ""),
    templateKey: String(getByCandidates_(["TEMPLATE_KEY", "TEMPLATEKEY"], "") || "")
  };
}

function _updateRequestRow_(reqSheet, requestId, patch) {
  patch = patch || {};
  var row = _findRowByRequestId_(reqSheet, requestId);
  if (!row) return;

  var mp = _headerMap_(reqSheet);
  var cols = {
    DOC_URL: _col_(mp, ["DOC_URL", "DOCURL", "DOC_LINK", "DOCLINK"], 0),
    STATUS: _col_(mp, ["STATUS"], 0)
  };

  if (cols.DOC_URL && patch.DOC_URL) reqSheet.getRange(row, cols.DOC_URL).setValue(patch.DOC_URL);
  if (cols.STATUS && patch.STATUS) reqSheet.getRange(row, cols.STATUS).setValue(patch.STATUS);
}

/* ============================================================
 *             ITINERARY STRUCT LOAD / NORMALIZE
 * ============================================================ */

function _loadItineraryStruct_(chatId, requestId) {
  var sp = PropertiesService.getScriptProperties();

  function readKey_(k) {
    var raw = sp.getProperty(k);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }

  if (chatId) {
    var it1 = readKey_("ITIN_" + String(chatId));
    if (it1) return it1;
  }

  if (requestId) {
    var it2 = readKey_("ITIN_" + String(requestId));
    if (it2) return it2;
  }

  var it3 = readKey_("LAST_ITIN_JSON");
  if (it3) return it3;

  return null;
}

function _buildItineraryFromDaysSheet_(daysSheet, requestId, reqMeta) {
  var mp = _headerMap_(daysSheet);
  var colReq = _col_(mp, ["REQUEST_ID", "REQUESTID"], 0);
  if (!colReq) return null;

  var last = daysSheet.getLastRow();
  if (last < 2) return null;

  var data = daysSheet.getRange(2, 1, last - 1, daysSheet.getLastColumn()).getValues();

  var colIdx  = _col_(mp, ["DAY_INDEX", "DAYINDEX"], 0);
  var colDate = _col_(mp, ["DAY_DATE", "DAYDATE"], 0);
  var colName = _col_(mp, ["DAY_NAME", "DAYNAME"], 0);
  var colTime = _col_(mp, ["DAY_TIME", "DAYTIME"], 0);
  var colDesc = _col_(mp, ["DAY_DESCRIPTION", "DAYDESCRIPTION"], 0);
  var colLoc  = _col_(mp, ["DAY_LOCATION", "DAYLOCATION"], 0);
  var colOv   = _col_(mp, ["DAY_OVERNIGHT", "DAYOVERNIGHT"], 0);

  var days = [];
  for (var r = 0; r < data.length; r++) {
    if (String(data[r][colReq - 1] || "").trim() !== String(requestId)) continue;

    var i = colIdx ? Number(data[r][colIdx - 1] || 0) : (days.length + 1);
    var dateVal = colDate ? data[r][colDate - 1] : "";
    var dateStr = _dateToDDMMYYYY_(dateVal);

    days.push({
      number: "Day " + i,
      date: dateStr,
      name: colName ? String(data[r][colName - 1] || "") : "",
      time: colTime ? String(data[r][colTime - 1] || "") : "",
      location: colLoc ? String(data[r][colLoc - 1] || "") : "",
      overnight: colOv ? String(data[r][colOv - 1] || "") : "",
      description: colDesc ? String(data[r][colDesc - 1] || "") : ""
    });
  }

  days.sort(function(a, b) {
    var ai = Number(String(a.number || "").replace(/[^\d]/g, "")) || 0;
    var bi = Number(String(b.number || "").replace(/[^\d]/g, "")) || 0;
    return ai - bi;
  });

  return {
    meta: {
      city: (reqMeta && reqMeta.city) ? reqMeta.city : "",
      startDate: (reqMeta && reqMeta.start) ? String(reqMeta.start) : "",
      templateKey: (reqMeta && reqMeta.templateKey) ? String(reqMeta.templateKey).toLowerCase() : ""
    },
    days: days
  };
}

function _normalizeItinerary_(it, reqMeta) {
  reqMeta = reqMeta || {};
  if (!it || typeof it !== "object") return null;
  if (!it.meta) it.meta = {};
  if (!Array.isArray(it.days)) it.days = [];

  // meta merge
  if (!it.meta.city) it.meta.city = reqMeta.city || it.meta.city || "Almaty";
  if (!it.meta.startDate) it.meta.startDate = reqMeta.start || it.meta.startDate || "";
  if (!it.meta.templateKey) it.meta.templateKey = (reqMeta.templateKey || it.meta.templateKey || "").toLowerCase();

  // compute month/season if possible
  var startDate = _parseDateAny_(it.meta.startDate);
  if (startDate) {
    it.meta.tourMonth = _monthNameEn_(startDate);
    it.meta.season = _seasonTitleFromMonth_(startDate.getMonth() + 1);
    if (!it.meta.templateKey) it.meta.templateKey = it.meta.season.toLowerCase();
  }

  // pax
  it.meta.pax = Number(it.meta.pax || reqMeta.pax || 0) || 0;
  it.meta.kids = Number(it.meta.kids || reqMeta.kids || 0) || 0;

  it.meta.arrivalTime = String(it.meta.arrivalTime || reqMeta.arrivalTime || "-");
  it.meta.departureTime = String(it.meta.departureTime || reqMeta.departureTime || "-");

  // days/nights
  var dcount = it.days.length || Number(reqMeta.days || 0) || 0;
  if (!dcount) dcount = it.days.length;
  var nights = Math.max(0, dcount - 1);

  it.meta.daysCount = dcount;
  it.meta.daysNights = dcount ? (dcount + "D" + nights + "N") : "";
  it.meta.paxTag = it.meta.pax ? (String(it.meta.pax) + "pax") : "";

  // normalize day fields + labels
  for (var i = 0; i < it.days.length; i++) {
    var d = it.days[i] || {};

    if (!d.number) d.number = "Day " + (i + 1);
    if (d.date === null || d.date === undefined) d.date = "";
    if (d.name === null || d.name === undefined) d.name = "";
    if (d.time === null || d.time === undefined) d.time = "";
    if (d.location === null || d.location === undefined) d.location = "";
    if (d.overnight === null || d.overnight === undefined) d.overnight = "";
    if (d.description === null || d.description === undefined) d.description = "";

    // Optional label enforcement (works well with template)
    if (d.time && String(d.time).trim() && !/^Time:/i.test(d.time)) d.time = "Time: " + String(d.time).trim();
    if (d.location && String(d.location).trim() && !/^Visited Locations:/i.test(d.location)) d.location = "Visited Locations: " + String(d.location).trim();
    if (d.overnight && String(d.overnight).trim() && !/^Overnight:/i.test(d.overnight)) d.overnight = "Overnight: " + String(d.overnight).trim();

    it.days[i] = d;
  }

  return it;
}

/* ============================================================
 *                 PLACEHOLDERS + DOC CREATE
 * ============================================================ */

function _buildPlaceholders_(it) {
  var meta = it.meta || {};
  var days = it.days || [];

  var ph = {};
  ph.DAYS_NIGHTS = meta.daysNights || "";
  ph.PAX_TAG = meta.paxTag || "";
  ph.TOUR_MONTH = meta.tourMonth || "";

  ph.ARRIVAL_TIME = meta.arrivalTime || "-";
  ph.DEPARTURE_TIME = meta.departureTime || "-";

  for (var i = 1; i <= DOCEXP_.MAX_DAYS; i++) {
    var idx = (i < 10 ? "0" : "") + i;
    var d = days[i - 1];

    ph["DAY_" + idx + "_NUMBER"] = d ? (d.number || "") : "";
    ph["DAY_" + idx + "_DATE"] = d ? (d.date || "") : "";
    ph["DAY_" + idx + "_NAME"] = d ? (d.name || "") : "";
    ph["DAY_" + idx + "_TIME"] = d ? (d.time || "") : "";
    ph["DAY_" + idx + "_DESCRIPTION"] = d ? (d.description || "") : "";
    ph["DAY_" + idx + "_LOCATION"] = d ? (d.location || "") : "";
    ph["DAY_" + idx + "_OVERNIGHT"] = d ? (d.overnight || "") : "";
  }

  return ph;
}

function _templateIdByKey_(key) {
  key = String(key || "").toLowerCase();

  if (key === "winter") return _prop_("TEMPLATE_WINTER_ID", "");
  if (key === "spring") return _prop_("TEMPLATE_SPRING_ID", "");
  if (key === "summer") return _prop_("TEMPLATE_SUMMER_ID", "");
  if (key === "autumn") return _prop_("TEMPLATE_AUTUMN_ID", _prop_("TEMPLATE_SUMMER_ID", ""));

  // fallback priority
  return _prop_("TEMPLATE_SPRING_ID", _prop_("TEMPLATE_SUMMER_ID", _prop_("TEMPLATE_WINTER_ID", "")));
}

/**
 * Create doc copy and replace placeholders with retries.
 */
function _createDocFromTemplate_(templateId, fileName, placeholders) {
  var outFolderId = _prop_("OUTPUT_FOLDER_ID", "");
  var tpl = DriveApp.getFileById(templateId);

  // sanity check: template should be a Google Doc
  try {
    var mt = tpl.getMimeType();
    if (mt && mt.indexOf("application/vnd.google-apps.document") < 0) {
      // Not fatal in theory, but DocumentApp.openById will fail for non-doc
      throw new Error("Template is not a Google Doc. MimeType=" + mt + ". Please use a Google Docs template (not .docx file).");
    }
  } catch (e) {
    // ignore mime errors
  }

  var copy = _retry_(function() {
    return outFolderId
      ? tpl.makeCopy(fileName, DriveApp.getFolderById(outFolderId))
      : tpl.makeCopy(fileName);
  }, "makeCopy");

  // Drive propagation delay (важно!)
  Utilities.sleep(900);

  // set sharing with retry (иногда тоже падает транзиентно)
  _retry_(function() {
    copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    return true;
  }, "setSharing");

  // open doc with retry
  var doc = _retry_(function() {
    return DocumentApp.openById(copy.getId());
  }, "DocumentApp.openById");

  // Replace in body + header + footer
  _replacePlaceholdersInDoc_(doc, placeholders);

  doc.saveAndClose();

  // Sometimes getUrl() right after save can be flaky; reopen safely
  var url = _retry_(function() {
    return DocumentApp.openById(copy.getId()).getUrl();
  }, "getUrl");

  return url;
}

function _replacePlaceholdersInDoc_(doc, placeholders) {
  var body = doc.getBody();
  _replaceInElement_(body, placeholders);

  var header = doc.getHeader();
  if (header) _replaceInElement_(header, placeholders);

  var footer = doc.getFooter();
  if (footer) _replaceInElement_(footer, placeholders);
}

function _replaceInElement_(element, placeholders) {
  for (var k in placeholders) {
    if (!placeholders.hasOwnProperty(k)) continue;
    var val = placeholders[k];
    if (val === null || val === undefined) val = "";
    val = String(val);

    // pattern for {{{KEY}}}
    var pattern = "\\{\\{\\{" + _escapeRegExp_(k) + "\\}\\}\\}";
    element.replaceText(pattern, val);
  }
}

function _escapeRegExp_(s) {
  return String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Retry helper for transient Google errors.
 */
function _retry_(fn, label) {
  var lastErr;
  for (var i = 0; i < DOCEXP_.RETRIES; i++) {
    try {
      return fn();
    } catch (e) {
      lastErr = e;
      Utilities.sleep(DOCEXP_.RETRY_SLEEP_MS * (i + 1));
    }
  }
  throw new Error((label ? (label + " failed: ") : "") + (lastErr && lastErr.message ? lastErr.message : String(lastErr)));
}

/* ============================================================
 *                      DATE / SEASON
 * ============================================================ */

function _parseDateAny_(v) {
  if (!v) return null;

  if (Object.prototype.toString.call(v) === "[object Date]") return v;

  var s = String(v).trim();

  // dd.MM.yyyy
  var m1 = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(s);
  if (m1) {
    var d = new Date(Number(m1[3]), Number(m1[2]) - 1, Number(m1[1]));
    if (!isNaN(d.getTime())) return d;
  }

  // yyyy-MM-dd
  var m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m2) {
    var d2 = new Date(Number(m2[1]), Number(m2[2]) - 1, Number(m2[3]));
    if (!isNaN(d2.getTime())) return d2;
  }

  // try Date.parse
  var t = Date.parse(s);
  if (!isNaN(t)) return new Date(t);

  return null;
}

function _dateToDDMMYYYY_(v) {
  if (!v) return "";
  var d = _parseDateAny_(v);
  if (!d) return String(v);
  var dd = (d.getDate() < 10 ? "0" : "") + d.getDate();
  var mm = (d.getMonth() + 1 < 10 ? "0" : "") + (d.getMonth() + 1);
  return dd + "." + mm + "." + d.getFullYear();
}

function _monthNameEn_(d) {
  var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return months[d.getMonth()];
}

function _seasonTitleFromMonth_(m) {
  if (m === 12 || m === 1 || m === 2) return "Winter";
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  return "Autumn";
}

function _seasonKeyFromStart_(startDate) {
  var d = _parseDateAny_(startDate);
  if (!d) return "summer";
  return _seasonTitleFromMonth_(d.getMonth() + 1).toLowerCase();
}

function _cap1_(s) {
  s = String(s || "");
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/* ============================================================
 *                      SAMPLE ITIN
 * ============================================================ */

function _sampleItinerary_() {
  var start = new Date();
  var dd = (start.getDate() < 10 ? "0" : "") + start.getDate();
  var mm = (start.getMonth() + 1 < 10 ? "0" : "") + (start.getMonth() + 1);
  var yyyy = start.getFullYear();

  function addDays_(n) {
    var d = new Date(start.getTime());
    d.setDate(start.getDate() + n);
    return _dateToDDMMYYYY_(d);
  }

  return {
    meta: {
      city: "Almaty",
      startDate: dd + "." + mm + "." + yyyy,
      templateKey: "spring",
      pax: 4,
      kids: 1,
      arrivalTime: "10:30",
      departureTime: "16:45"
    },
    days: [
      {
        number: "Day 1",
        date: addDays_(0),
        name: "Arrival and Light City Walk",
        time: "Time: 16:00 – 20:00",
        location: "Visited Locations: Airport, Arbat",
        overnight: "Overnight: Almaty",
        description: "Arrive in Almaty, transfer to the hotel, and enjoy a gentle first walk in the city center if time and energy allow."
      },
      {
        number: "Day 2",
        date: addDays_(1),
        name: "Medeu and Shymbulak",
        time: "Time: 10:00 – 17:00",
        location: "Visited Locations: Medeu, Shymbulak",
        overnight: "Overnight: Almaty",
        description: "Visit Medeu ice rink and take the cable car up to Shymbulak for panoramic mountain views, free time, and a relaxed return to the city."
      },
      {
        number: "Day 3",
        date: addDays_(2),
        name: "Departure",
        time: "Time: 12:00 – 14:00",
        location: "Visited Locations: Airport",
        overnight: "Overnight: -",
        description: "Free time depending on your flight schedule, then a comfortable transfer to the airport for departure."
      }
    ]
  };
}
