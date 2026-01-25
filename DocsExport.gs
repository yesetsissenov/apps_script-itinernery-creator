// File: DocsExport.gs

function exportDocForChat(chatId, requestId) {
  var itinerary = getItinerary_(chatId);
  if (!itinerary) return null;
  var meta = itinerary.meta || {};
  var templateId = doc_pickTemplateId_(meta.templateKey);
  var doc;
  if (templateId) {
    var file = DriveApp.getFileById(templateId).makeCopy(meta.city + " Itinerary" + " " + new Date().getTime());
    doc = DocumentApp.openById(file.getId());
  } else {
    doc = DocumentApp.create(meta.city + " Itinerary" + " " + new Date().getTime());
  }

  var body = doc.getBody();
  doc_fillPlaceholders_(body, meta);
  doc_appendDays_(body, itinerary.days || []);
  doc.saveAndClose();
  var url = doc.getUrl();
  if (requestId) {
    updateRequestDocUrl_(requestId, url);
  }
  return url;
}

function doc_pickTemplateId_(templateKey) {
  if (!templateKey) return null;
  var props = PropertiesService.getScriptProperties();
  var keyUpper = String(templateKey).toUpperCase();
  var byKey = props.getProperty("DOC_TEMPLATE_ID_" + keyUpper);
  if (byKey) return byKey;
  if (keyUpper === "WINTER") return props.getProperty("DOC_TEMPLATE_ID_WINTER");
  if (keyUpper === "SPRING") return props.getProperty("DOC_TEMPLATE_ID_SPRING");
  if (keyUpper === "SUMMER") return props.getProperty("DOC_TEMPLATE_ID_SUMMER");
  if (keyUpper === "AUTUMN") return props.getProperty("DOC_TEMPLATE_ID_AUTUMN");
  return null;
}

function doc_fillPlaceholders_(body, meta) {
  var map = {
    CITY: meta.city,
    START: meta.start,
    DAYS: meta.days,
    PAX: meta.pax,
    KIDS: meta.kids,
    ARRIVALTIME: meta.arrivalTime,
    DEPARTURETIME: meta.departureTime,
    SEASON: meta.season,
    DATESTEXT: meta.datesText
  };
  Object.keys(map).forEach(function(key) {
    doc_replaceAll_(body, "{{" + key + "}}", String(map[key] || ""));
  });
}

function doc_replaceAll_(body, token, value) {
  var range = body.findText(token);
  while (range) {
    range.getElement().asText().replaceText(token, value);
    range = body.findText(token, range);
  }
}

function doc_appendDays_(body, days) {
  body.appendParagraph("Itinerary").setHeading(DocumentApp.ParagraphHeading.HEADING2);
  days.forEach(function(day) {
    body.appendParagraph("Day " + day.number + " - " + (day.date || "")).setHeading(DocumentApp.ParagraphHeading.HEADING3);
    if (day.name) body.appendParagraph(day.name);
    if (day.time) body.appendParagraph("Time: " + day.time);
    if (day.location) body.appendParagraph("Location: " + day.location);
    if (day.overnight) body.appendParagraph("Overnight: " + day.overnight);
    if (day.description) body.appendParagraph(day.description);
  });
}
