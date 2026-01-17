function buildTravelLogicBlock_(meta) {
  meta = meta || {};
  var city = meta.city || "the city";
  var arrival = String(meta.arrivalTime || "-").trim();
  var depart = String(meta.departureTime || "-").trim();
  var pax = meta.pax || meta.adults || "";
  var kids = meta.kids || "";

  return (
    "TRAVEL LOGIC RULES (must follow строго):\n" +
    "1) If ARRIVAL_TIME is late (>= 18:00), Day 1 MUST be light: airport meet, transfer, hotel check-in, short dinner/tea nearby. No long city walks or attractions.\n" +
    "2) Always assume airport+bags+transfer+check-in takes 2–2.5 hours. Plan activities AFTER that.\n" +
    "3) If DEPARTURE_TIME is early (<= 10:30), last day MUST be only: breakfast (optional), checkout, transfer to airport.\n" +
    "4) Day titles must reflect reality (no 'Full city tour' on late arrival, no 'Shopping' at airport).\n" +
    "5) Avoid duplicate day names. If same area continues (e.g., Kolsai/Kaindy 2D1N), name as '— Day 1' and '— Day 2' with different descriptions.\n" +
    "6) Descriptions MUST be 20–35 words each, practical and travel-realistic. Mention pace, transfers, breaks, and why it makes sense.\n" +
    "7) Keep locations consistent with the day; Overnight must match real overnight city.\n" +
    "Context: City=" + city + ", Arrival=" + arrival + ", Departure=" + depart + ", Pax=" + pax + ", Kids=" + kids + ".\n"
  );
}
function applyTravelLogicPostFix_(it) {
  if (!it || !it.days || !it.days.length) return it;
  if (!it.meta) it.meta = {};

  var arr = String(it.meta.arrivalTime || "-").trim();
  var dep = String(it.meta.departureTime || "-").trim();

  function parseHHMM_(t) {
    var m = /^(\d{2}):(\d{2})$/.exec(String(t || "").trim());
    if (!m) return null;
    return { h: Number(m[1]), m: Number(m[2]) };
  }
  function minutes_(hm) { return hm ? (hm.h * 60 + hm.m) : null; }
  function wc_(s) { return String(s || "").trim().split(/\s+/).filter(Boolean).length; }

  // --- Late arrival fix for Day 1 ---
  var a = parseHHMM_(arr);
  var aMin = minutes_(a);
  if (aMin !== null && aMin >= 18 * 60) {
    var d1 = it.days[0] || {};
    d1.name = "Arrival + Hotel Check-in";
    d1.time = "Time: " + arr + " arrival (hotel after ~2–2.5h)";
    d1.location = "Visited Locations: Airport, hotel area";
    d1.overnight = d1.overnight || "Overnight: " + (it.meta.city || "Almaty");
    d1.description =
      "Meet your driver at the airport, transfer to the hotel, and settle in after check-in. If you feel fresh, enjoy a short nearby dinner and rest to recover from the flight.";
    it.days[0] = d1;
  }

  // --- Early departure fix for last day ---
  var d = parseHHMM_(dep);
  var dMin = minutes_(d);
  if (dMin !== null && dMin <= (10 * 60 + 30)) {
    var last = it.days[it.days.length - 1] || {};
    last.name = "Departure";
    last.time = "Time: transfer based on flight (" + dep + ")";
    last.location = "Visited Locations: hotel, airport";
    last.overnight = "Overnight: -";
    last.description =
      "After breakfast (time permitting), check out and transfer to the airport. We’ll plan an easy schedule to avoid rush and keep everything smooth for your departure.";
    it.days[it.days.length - 1] = last;
  }

  // --- Enforce 20–35 words descriptions (soft) ---
  for (var i = 0; i < it.days.length; i++) {
    var di = it.days[i] || {};
    var w = wc_(di.description);
    if (w < 20) {
      di.description = (di.description || "").trim() +
        " Expect a comfortable pace with photo stops, short breaks, and time to adjust to the day’s travel flow.";
    }
    it.days[i] = di;
  }

  return it;
}
