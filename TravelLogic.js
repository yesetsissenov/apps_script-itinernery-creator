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
    "- For departure day: plan hotel checkout + transfer. Leave hotel ~3 hours before flight time; arrive airport ~2 hours before flight.\n" +
    "- Day trips like Charyn/Kolsai/Kaindy are full-day long drives (early start + late return).\n" +
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
      d1.name = d1.name || "Arrival + Check-in";
      d1.time = "Time: " + _tl_fmtHHMM_(arrivalMin) + " – late evening (approx.)";
      d1.location = "Visited Locations: Airport, Hotel";
      d1.overnight = d1.overnight && /^Overnight:/i.test(d1.overnight) ? d1.overnight : "Overnight: " + String(it.meta.city || "Almaty");
      d1.description = _tl_forceDesc_(
        d1.description,
        "After landing, you’ll complete airport formalities and meet your private driver. Transfer to the hotel, check in, and rest to recover from the flight and get ready for the active days ahead."
      );
    } else if (arrivalMin >= 18 * 60) {
      d1.name = d1.name || "Arrival + Easy Evening";
      d1.time = "Time: " + _tl_fmtHHMM_(arrivalMin) + " – evening (approx.)";
      d1.location = "Visited Locations: Airport, Hotel, Nearby Restaurant";
      d1.overnight = d1.overnight && /^Overnight:/i.test(d1.overnight) ? d1.overnight : "Overnight: " + String(it.meta.city || "Almaty");
      d1.description = _tl_forceDesc_(
        d1.description,
        "Arrive in the evening and meet your private driver. After customs and baggage, transfer to the hotel for check-in, then enjoy a calm dinner near your hotel and take time to rest and settle in."
      );
    }
    it.days[0] = d1;
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
  }

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
  var w = _tl_words_(d.description);
  if (w.length < 20) {
    // add a practical padding sentence
    var pad = "Your private guide will help with timing, breaks, and the best photo stops, keeping the day comfortable and well-paced.";
    var combined = (String(d.description || "").trim() + " " + pad).replace(/\s+/g, " ").trim();
    d.description = combined;
    w = _tl_words_(d.description);
  }
  if (w.length > 35) {
    d.description = w.slice(0, 35).join(" ") + ".";
  }
}
