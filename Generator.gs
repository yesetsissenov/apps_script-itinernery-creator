// File: Generator.gs

function gen_generateItineraryStruct_(req) {
  var startDate = _parseDate_(req.start);
  var days = req.days || 1;
  var meta = {
    requestId: req.requestId,
    city: req.city,
    start: req.start,
    days: req.days,
    pax: req.pax,
    kids: req.kids,
    arrivalTime: req.arrivalTime,
    departureTime: req.departureTime,
    season: req.season,
    templateKey: req.templateKey,
    datesText: req.datesText
  };

  var libraryDays = gen_loadLibraryDays_(req.city);
  var itineraryDays = [];
  if (libraryDays && libraryDays.length) {
    for (var i = 0; i < days; i++) {
      var lib = libraryDays[i % libraryDays.length];
      itineraryDays.push(gen_buildDay_(i + 1, startDate, lib));
    }
  } else {
    itineraryDays = gen_buildFallback_(req, startDate);
  }

  return {
    meta: meta,
    days: itineraryDays
  };
}

function gen_loadLibraryDays_(city) {
  var ss;
  try {
    ss = openSpreadsheet_();
  } catch (err) {
    return null;
  }
  var sheet = gen_findLibrarySheet_(ss);
  if (!sheet) return null;
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return null;
  var headers = values[0].map(function(h) { return normalizeHeader_(h); });
  var idx = {};
  headers.forEach(function(h, i) { idx[h] = i; });
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var day = {
      name: row[idx.DAYNAME] || row[idx.NAME] || "Day Plan",
      time: row[idx.TIME] || "",
      location: row[idx.LOCATION] || city,
      overnight: row[idx.OVERNIGHT] || city,
      description: row[idx.DESCRIPTION] || "",
      city: row[idx.CITY] || city
    };
    out.push(day);
  }
  return out.length ? out : null;
}

function gen_findLibrarySheet_(ss) {
  var sheets = ss.getSheets();
  for (var i = 0; i < sheets.length; i++) {
    var name = sheets[i].getName().toLowerCase();
    if (name.indexOf("day") !== -1 || name.indexOf("library") !== -1) {
      return sheets[i];
    }
  }
  return null;
}

function gen_buildFallback_(req, startDate) {
  var days = req.days || 1;
  var list = [];
  for (var i = 0; i < days; i++) {
    var num = i + 1;
    var plan = {
      name: gen_defaultDayName_(num, days),
      time: gen_defaultDayTime_(num, days, req.arrivalTime, req.departureTime),
      location: req.city,
      overnight: req.city,
      description: gen_defaultDayDescription_(num, days, req.city)
    };
    list.push(gen_buildDay_(num, startDate, plan));
  }
  return list;
}

function gen_buildDay_(num, startDate, plan) {
  var date = startDate ? new Date(startDate.getTime() + (num - 1) * 24 * 60 * 60 * 1000) : null;
  return {
    number: num,
    date: date ? _formatDate_(date) : "",
    name: plan.name,
    time: plan.time,
    location: plan.location,
    overnight: plan.overnight,
    description: plan.description
  };
}

function gen_defaultDayName_(num, total) {
  if (num === 1) return "Arrival and orientation";
  if (num === total) return "Departure";
  return "Explore the city";
}

function gen_defaultDayTime_(num, total, arrival, departure) {
  if (num === 1) return arrival || "";
  if (num === total) return departure || "";
  return "09:00 - 18:00";
}

function gen_defaultDayDescription_(num, total, city) {
  if (num === 1) return "Arrive in " + city + ", transfer to hotel, light walk and rest.";
  if (num === total) return "Check-out, transfer to airport or station.";
  if (num % 3 === 0) return "Day trip to nearby highlights with local guide.";
  return "City sightseeing and cultural activities in " + city + ".";
}

function gen_formatDraftText_(itinerary) {
  var lines = [];
  var meta = itinerary.meta || {};
  lines.push("Itinerary Preview");
  lines.push("City: " + (meta.city || ""));
  lines.push("Dates: " + (meta.datesText || ""));
  lines.push("Pax: " + (meta.pax || "") + " Adults, Kids: " + (meta.kids || 0));
  lines.push("Arrival: " + (meta.arrivalTime || "-") + ", Departure: " + (meta.departureTime || "-"));
  lines.push("---");
  (itinerary.days || []).forEach(function(day) {
    lines.push(gen_formatDayBlock_(day));
  });
  return lines.join("\n");
}

function gen_formatDayBlock_(day) {
  var parts = [];
  parts.push("Day " + day.number + " - " + (day.date || ""));
  parts.push(day.name || "");
  if (day.time) parts.push("Time: " + day.time);
  if (day.location) parts.push("Location: " + day.location);
  if (day.overnight) parts.push("Overnight: " + day.overnight);
  if (day.description) parts.push(day.description);
  return parts.join("\n");
}

function gen_guessSeason_(dateObj) {
  if (!dateObj) return "";
  var month = dateObj.getMonth() + 1;
  if (month === 12 || month <= 2) return "Winter";
  if (month >= 3 && month <= 5) return "Spring";
  if (month >= 6 && month <= 8) return "Summer";
  return "Autumn";
}
