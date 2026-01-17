/**********************
 * TravelLogic.gs
 * 1) buildTravelLogicBlock_(meta) — текст правил для промпта (EDIT)
 * 2) applyTravelLogicPostFix_(it) — пост-правка логики + длины описаний (GEN + EDIT)
 **********************/

function buildTravelLogicBlock_(meta) {
  meta = meta || {};
  var city = String(meta.city || "");
  var arrival = String(meta.arrivalTime || "-");
  var depart = String(meta.departureTime || "-");

  return (
    "TRAVEL LOGIC (follow strictly):\n" +
    "- Assume private tour reality: customs + baggage + transfer + hotel check-in take ~2–2.5 hours after landing.\n" +
    "- If arrival is late (>= 18:00) then Day 1 must be ONLY: transfer, check-in, short dinner near hotel, rest. NO sightseeing walks.\n" +
    "- If arrival is very late (>= 21:00) then Day 1 must be ONLY: transfer + check-in + rest.\n" +
    "- If arrival is early (<= 15:00), Day 1 can be a light city walk only (no heavy activities).\n" +
    "- If arrival time is unknown, keep Day 1 neutral: arrival, transfer, check-in, rest; mention 'depending on arrival time'.\n" +
    "- For departure day: plan hotel checkout + transfer. Leave hotel ~3 hours before flight time; arrive airport ~2 hours before flight.\n" +
    "- For departure day with unknown time: keep it flexible, no long excursions.\n" +
    "- Day trips like Charyn/Kolsai/Kaindy are full-day long drives (early start + late return).\n" +
    "- After long day trips, no late-evening city walks or shopping add-ons.\n" +
    "- Avoid duplicate consecutive days with the same title/locations; vary the second day if needed.\n" +
    "- Descriptions must be practical and realistic for timing, driving, meals, rest.\n" +
    (city ? ("- City/region: " + city + "\n") : "") +
    (arrival && arrival !== "-" ? ("- Arrival time: " + arrival + "\n") : "") +
    (depart && depart !== "-" ? ("- Departure time: " + depart + "\n") : "")
  );
}

function applyTravelLogicPostFix_(it) {
  if (!it || !it.days || !it.days.length) return it;
  it.meta = it.meta || {};

  var arrivalMin = _tl_parseHHMM_(it.meta.arrivalTime);
  var departMin = _tl_parseHHMM_(it.meta.departureTime);
  var city = String(it.meta.city || "Almaty");

  // normalize labels + description length for all days
  for (var i = 0; i < it.days.length; i++) {
    it.days[i] = it.days[i] || {};
    _tl_ensureLabels_(it.days[i]);
    _tl_ensureDescLen_(it.days[i]);
  }

  // Day 1 logic
  if (arrivalMin !== null) {
    var d1 = it.days[0] || {};
    if (arrivalMin >= 21 * 60) {
      d1.name = "Arrival, Transfer, Check-in, Rest";
      d1.time = "Time: " + _tl_fmtHHMM_(arrivalMin) + " – late evening (approx.)";
      d1.location = "Visited Locations: Airport, Hotel";
      d1.overnight = "Overnight: " + city;
      d1.description = _tl_forceDesc_(
        d1.description,
        "After landing, you’ll complete airport formalities and meet your private driver. Transfer to the hotel, check in, and rest to recover from the flight and get ready for the active days ahead."
      );
    } else if (arrivalMin >= 18 * 60) {
      d1.name = "Arrival, Transfer, Dinner, Rest";
      d1.time = "Time: " + _tl_fmtHHMM_(arrivalMin) + " – evening (approx.)";
      d1.location = "Visited Locations: Airport, Hotel, Nearby Restaurant";
      d1.overnight = "Overnight: " + city;
      d1.description = _tl_forceDesc_(
        d1.description,
        "Arrive in the evening and meet your private driver. After customs and baggage, transfer to the hotel for check-in, then enjoy a calm dinner near your hotel and take time to rest and settle in."
      );
    } else if (arrivalMin <= 15 * 60) {
      d1.name = d1.name || "Arrival, Transfer, Light City Walk";
      d1.time = d1.time || ("Time: " + _tl_fmtHHMM_(arrivalMin) + " – evening (approx.)");
      d1.location = d1.location || "Visited Locations: Airport, City Center";
      d1.overnight = d1.overnight || ("Overnight: " + city);
      d1.description = _tl_forceDesc_(
        d1.description,
        "After arrival and hotel check-in, enjoy a gentle introduction to the city with a short walk and photo stops. Keep the pace light, with time for rest after travel and a relaxed dinner nearby."
      );
    }
    it.days[0] = d1;
    _tl_ensureLabels_(it.days[0]);
    _tl_ensureDescLen_(it.days[0]);
  } else {
    var d1Unknown = it.days[0] || {};
    d1Unknown.name = "Arrival, Transfer, Rest";
    d1Unknown.time = "Time: Flexible (depending on arrival)";
    d1Unknown.location = "Visited Locations: Airport, Hotel";
    d1Unknown.overnight = "Overnight: " + city;
    d1Unknown.description = _tl_forceDesc_(
      d1Unknown.description,
      "Arrive in Almaty and meet your private driver for the transfer. Check in to the hotel and rest after the journey, with a light meal or short walk possible depending on arrival time."
    );
    it.days[0] = d1Unknown;
    _tl_ensureLabels_(it.days[0]);
    _tl_ensureDescLen_(it.days[0]);
  }

  // Last day logic
  if (departMin !== null) {
    var last = it.days[it.days.length - 1] || {};
    var leaveMin = Math.max(0, departMin - 180); // ~3h before flight
    last.name = last.name || "Departure";
    last.time = "Time: " + _tl_fmtHHMM_(leaveMin) + " – " + _tl_fmtHHMM_(departMin);
    last.location = "Visited Locations: Hotel, Airport";
    last.overnight = "Overnight: -";
    last.description = _tl_forceDesc_(
      last.description,
      "Depending on your flight time, enjoy light free time or breakfast, then check out. Your private driver will transfer you to the airport early enough for check-in, security, and a comfortable departure."
    );
    it.days[it.days.length - 1] = last;
    _tl_ensureLabels_(last);
    _tl_ensureDescLen_(last);
  } else {
    var lastUnknown = it.days[it.days.length - 1] || {};
    lastUnknown.name = "Departure";
    lastUnknown.time = "Time: Flexible (transfer when needed)";
    lastUnknown.location = "Visited Locations: Hotel, Airport";
    lastUnknown.overnight = "Overnight: -";
    lastUnknown.description = _tl_forceDesc_(
      lastUnknown.description,
      "Checkout and transfer to the airport will be arranged when your flight details are confirmed. Keep the day light and flexible to ensure a comfortable, on-time departure."
    );
    it.days[it.days.length - 1] = lastUnknown;
    _tl_ensureLabels_(lastUnknown);
    _tl_ensureDescLen_(lastUnknown);
  }

  _tl_applyLongTripRule_(it);
  _tl_applyKolsaiKaindy2d1n_(it);
  _tl_fixDuplicateDays_(it);
  _tl_applyCityBaseOvernights_(it);

  return it;
}

/* ---------- helpers ---------- */

function _tl_parseHHMM_(t) {
  t = String(t || "").trim();
  if (!t || t === "-") return null;
  var m = /^(\d{1,2}):(\d{2})$/.exec(t);
  if (!m) return null;
  var hh = Number(m[1]), mm = Number(m[2]);
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function _tl_fmtHHMM_(mins) {
  var hh = Math.floor(mins / 60);
  var mm = mins % 60;
  return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
}

function _tl_ensureLabels_(d) {
  d.number = d.number || "";
  d.date = d.date || "";
  d.name = d.name || "";
  d.time = d.time || "";
  d.location = d.location || "";
  d.overnight = d.overnight || "";
  d.description = d.description || "";

  if (d.time && !/^Time:/i.test(d.time)) d.time = "Time: " + String(d.time).trim();
  if (d.location && !/^Visited Locations:/i.test(d.location)) d.location = "Visited Locations: " + String(d.location).trim();
  if (d.overnight && !/^Overnight:/i.test(d.overnight)) d.overnight = "Overnight: " + String(d.overnight).trim();
}

function _tl_words_(s) {
  s = String(s || "").replace(/\s+/g, " ").trim();
  if (!s) return [];
  return s.split(" ");
}

function _tl_forceDesc_(current, fallback) {
  var c = String(current || "").trim();
  if (c) return c;
  return String(fallback || "").trim();
}

function _tl_ensureDescLen_(d) {
  if (typeof gen_ensureMinWords_ === "function") {
    d.description = gen_ensureMinWords_(d.description, 20, 35, { allowOpenAI: true });
    return;
  }
  var w = _tl_words_(d.description);
  if (w.length < 20) {
    var pad = "Your private guide will help with timing, breaks, and the best photo stops, keeping the day comfortable and well-paced.";
    var combined = (String(d.description || "").trim() + " " + pad).replace(/\s+/g, " ").trim();
    d.description = combined;
    w = _tl_words_(d.description);
  }
  if (w.length > 35) {
    d.description = w.slice(0, 35).join(" ") + ".";
  }
}

function _tl_applyLongTripRule_(it) {
  var longTripRe = /(charyn|kolsai|kaindy|altyn emel|chundzha|tamgaly|issyk|turgen|assy)/i;
  for (var i = 0; i < it.days.length; i++) {
    var d = it.days[i] || {};
    var text = [d.name, d.location, d.description].join(" ");
    if (!longTripRe.test(text)) continue;
    if (/night walk|evening walk|shopping|night|mall/i.test(d.description || "")) {
      d.description = _tl_forceDesc_(
        d.description,
        "This is a full-day scenic trip with early departure and a late return. After the drive back, enjoy a calm evening and rest at the hotel."
      );
    } else {
      d.description = (String(d.description || "").trim() + " Transfers are arranged for comfort, with short breaks along the way.").trim();
    }
    _tl_ensureDescLen_(d);
  }
}

function _tl_applyKolsaiKaindy2d1n_(it) {
  if (!it || !it.days || it.days.length < 2) return;
  var idx = -1;
  for (var i = 0; i < it.days.length - 1; i++) {
    var d1 = it.days[i] || {};
    var d2 = it.days[i + 1] || {};
    var t1 = [d1.name, d1.location, d1.description].join(" ").toLowerCase();
    var t2 = [d2.name, d2.location, d2.description].join(" ").toLowerCase();
    if (t1.indexOf("kolsai") >= 0 && t2.indexOf("kaindy") >= 0) {
      idx = i;
      break;
    }
    if (t1.indexOf("kaindy") >= 0 && t2.indexOf("kolsai") >= 0) {
      idx = i;
      _tl_swapDays_(it, i, i + 1);
      break;
    }
  }
  if (idx >= 0) {
    var dayA = it.days[idx];
    var dayB = it.days[idx + 1];
    dayA.name = "Charyn Canyon + Kolsai Lakes, Overnight in Saty";
    dayA.time = "Time: 07:00 – evening (approx.)";
    dayA.location = "Visited Locations: Charyn Canyon, Kolsai Lakes";
    dayA.overnight = "Overnight: Saty/Kolsai area";
    dayA.description = _tl_forceDesc_(
      dayA.description,
      "Depart early for a scenic drive to Charyn Canyon and continue to the Kolsai Lakes. Enjoy short walks and viewpoints, then check in for an overnight stay near Saty to keep the pace comfortable."
    );
    _tl_ensureDescLen_(dayA);

    dayB.name = "Kaindy Lake + Return to City";
    dayB.time = "Time: 08:00 – evening (approx.)";
    dayB.location = "Visited Locations: Kaindy Lake";
    dayB.overnight = "Overnight: " + String(it.meta.city || "Almaty");
    dayB.description = _tl_forceDesc_(
      dayB.description,
      "Visit Kaindy Lake with its submerged forest and enjoy gentle nature time. Afterward, return to the city with stops as needed, arriving by evening for rest."
    );
    _tl_ensureDescLen_(dayB);
  }
}

function _tl_swapDays_(it, a, b) {
  var tmp = it.days[a];
  it.days[a] = it.days[b];
  it.days[b] = tmp;
}

function _tl_fixDuplicateDays_(it) {
  for (var i = 1; i < it.days.length; i++) {
    var prev = it.days[i - 1] || {};
    var cur = it.days[i] || {};
    if (!prev.name || !cur.name) continue;
    var sameName = String(prev.name).toLowerCase() === String(cur.name).toLowerCase();
    var sameLoc = String(prev.location || "").toLowerCase() === String(cur.location || "").toLowerCase();
    if (sameName && sameLoc) {
      cur.name = "City Highlights and Leisure Time";
      cur.time = cur.time || "Time: 10:00 – 18:00";
      cur.location = "Visited Locations: City Center, Local Parks";
      cur.overnight = cur.overnight || ("Overnight: " + String(it.meta.city || "Almaty"));
      cur.description = _tl_forceDesc_(
        cur.description,
        "Enjoy a relaxed city day with flexible sightseeing and time for photos, cafes, or museums. The pace is gentle, with room for breaks and short walks around central landmarks."
      );
      _tl_ensureLabels_(cur);
      _tl_ensureDescLen_(cur);
    }
  }
}

function _tl_applyCityBaseOvernights_(it) {
  var city = String(it.meta.city || "Almaty");
  for (var i = 0; i < it.days.length; i++) {
    var d = it.days[i] || {};
    if (i === it.days.length - 1) continue;
    if (!d.overnight || d.overnight === "Overnight: -") {
      d.overnight = "Overnight: " + city;
    }
  }
}

function validateItinStruct_(obj, opts) {
  opts = opts || {};
  if (!obj || typeof obj !== "object") return null;
  if (!obj.meta || !obj.days || !Array.isArray(obj.days) || !obj.days.length) return null;

  var strict = !!opts.strict;
  for (var i = 0; i < obj.days.length; i++) {
    var d = obj.days[i] || {};
    if (!d.number) d.number = "Day " + (i + 1);
    if (d.date === null || d.date === undefined) d.date = "";
    if (d.name === null || d.name === undefined) d.name = "";
    if (d.time === null || d.time === undefined) d.time = "";
    if (d.location === null || d.location === undefined) d.location = "";
    if (d.overnight === null || d.overnight === undefined) d.overnight = "";
    if (d.description === null || d.description === undefined) d.description = "";

    if (strict) {
      if (d.time && !/^Time:/i.test(d.time)) return null;
      if (d.location && !/^Visited Locations:/i.test(d.location)) return null;
      if (d.overnight && !/^Overnight:/i.test(d.overnight)) return null;
      if (_tl_words_(d.description).length < 20) return null;
    }
    obj.days[i] = d;
  }
  return obj;
}
