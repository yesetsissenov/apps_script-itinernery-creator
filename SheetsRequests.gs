// File: SheetsRequests.gs

function openSpreadsheet_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("SPREADSHEET_ID");
  if (!id) {
    throw new Error("Missing SPREADSHEET_ID");
  }
  return SpreadsheetApp.openById(id);
}

function getRequestsSheet_() {
  var props = PropertiesService.getScriptProperties();
  var name = props.getProperty("SHEET_REQUESTS") || "Requests";
  var ss = openSpreadsheet_();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  return sheet;
}

function normalizeHeader_(header) {
  return String(header || "")
    .toUpperCase()
    .replace(/[\s_\n\r]+/g, "")
    .trim();
}

function buildHeaderMap_(sheet) {
  var range = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 1);
  var values = range.getValues()[0];
  var map = {};
  for (var i = 0; i < values.length; i++) {
    var norm = normalizeHeader_(values[i]);
    if (norm) {
      map[norm] = i + 1;
    }
  }
  return map;
}

function saveRequest_(req) {
  var sheet = getRequestsSheet_();
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1).setValue("REQUESTID");
  }
  var headers = buildHeaderMap_(sheet);
  var row = sheet.getLastRow() + 1;
  var values = {};
  values.REQUESTID = req.requestId;
  values.CREATEDAT = req.createdAt;
  values.STATUS = req.status;
  values.TELEGRAMCHATID = req.chatId;
  values.SEASON = req.season;
  values.TEMPLATEKEY = req.templateKey;
  values.TOURTITLE = req.city + " Itinerary";
  values.DATES = req.datesText;
  values.CITY = req.city;
  values.DAYSNIGHTS = req.days + "D" + (req.days - 1) + "N";
  values.PAXTAG = req.pax;
  values.TOURMONTH = _monthNameFromDate_(req.start);
  values.KIDS = req.kids;
  values.FREEFORMLOCATIONREQUESTS = req.notes;
  values.ARRIVALTIME = req.arrivalTime;
  values.DEPARTURETIME = req.departureTime;
  Object.keys(values).forEach(function(key) {
    var col = headers[normalizeHeader_(key)];
    if (col) {
      sheet.getRange(row, col).setValue(values[key]);
    }
  });
}

function updateRequestDocUrl_(requestId, url) {
  var sheet = getRequestsSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var headers = buildHeaderMap_(sheet);
  var requestCol = headers["REQUESTID"];
  var docCol = headers["DOCURL"] || headers["DOC_URL"];
  if (!requestCol || !docCol) return;
  var range = sheet.getRange(2, requestCol, lastRow - 1, 1).getValues();
  for (var i = 0; i < range.length; i++) {
    if (String(range[i][0]) === String(requestId)) {
      sheet.getRange(i + 2, docCol).setValue(url);
      return;
    }
  }
}

function _monthNameFromDate_(text) {
  var dateObj = _parseDate_(text);
  if (!dateObj) return "";
  var tz = Session.getScriptTimeZone();
  return Utilities.formatDate(dateObj, tz, "MMMM");
}
