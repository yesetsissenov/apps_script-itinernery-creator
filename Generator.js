/***************************************
 * Generator.gs
 * Library → Route template → Program blocks → Draft text
 * Optional: OpenAI “final polish”
 *
 * Requires Script Properties:
 *   LIBRARY_SPREADSHEET_ID = <your Library spreadsheet id>
 *
 * Optional:
 *   USE_OPENAI = "1" | "0"
 *   OPENAI_MODEL = "gpt-5-mini" (or any existing)
 *
 * Depends on Open Ai API.gs having:
 *   openAiText_(prompt, opts)
 *   OPENAI_MODEL_()  (optional)
 *   USE_OPENAI_()    (optional)
 ***************************************/

function LIBRARY_SPREADSHEET_ID_() {
  return (PropertiesService.getScriptProperties().getProperty("LIBRARY_SPREADSHEET_ID") || "").trim();
}

function openLibrarySpreadsheet_() {
  var id = LIBRARY_SPREADSHEET_ID_();
  if (!id) throw new Error("LIBRARY_SPREADSHEET_ID is missing in Script Properties");
  return SpreadsheetApp.openById(id);
}

function gen_useOpenAI_() {
  try {
    if (typeof USE_OPENAI_ === "function") return !!USE_OPENAI_();
  } catch (e) {}
  var v = (PropertiesService.getScriptProperties().getProperty("USE_OPENAI") || "0").trim();
  return v === "1" || v.toLowerCase() === "true";
}

function gen_openAiModel_() {
  try {
    if (typeof OPENAI_MODEL_ === "function") return OPENAI_MODEL_();
  } catch (e) {}
  return (PropertiesService.getScriptProperties().getProperty("OPENAI_MODEL") || "gpt-5-mini").trim();
}

/** Public: main entry used from tg file */
function gen_generateItineraryText_(req) {
  // req: { city, start, days, pax, kids, notes, arrivalTime, departureTime, season? }
  if (!req) throw new Error("gen_generateItineraryText_: req is missing");

  var city = String(req.city || "Almaty").trim();
  var days = Number(req.days || 0);
  if (!days || days < 1) throw new Error("gen_generateItineraryText_: req.days missing");

  var start = gen_toDate_(req.start);
  var season = gen_normalizeSeason_(req.season || gen_seasonTitle_(start.getMonth() + 1));
  var lang = "en";


  var lib = gen_loadLibrary_();
  var route = gen_pickRoute_(lib.routes, city, season, days);

  var plans = gen_buildDayPlans_(route, lib.blocksMap, season, city, days, req);
  var skeleton = gen_formatDraft_(plans, start, lang, req);

  // Optional: one OpenAI pass to polish formatting & language
  if (gen_useOpenAI_()) {
    if (typeof openAiText_ !== "function") {
      throw new Error("openAiText_ not found. Check Open Ai API.gs");
    }
    var prompt = gen_promptPolish_(skeleton, lang);
    var out = openAiText_(prompt, { model: gen_openAiModel_() });
    if (out && String(out).trim()) return String(out).trim();
  }

  return skeleton;
}
/* ===================== Generator.gs ===================== */
/* Uses Library sheets to build itinerary. Adds STRUCT generator for bot + doc export. */

var GEN_ = {
  MAX_DAYS: 14,
  DEFAULT_LANG: "en"
};

/** ===================== PUBLIC API ===================== **/

/**
 * STRUCT generator used by Telegram bot (NO text parsing).
 * Returns:
 * {
 *   meta: { city,start,days,pax,kids,arrivalTime,departureTime,season,templateKey,daysNights,paxTag,tourMonth },
 *   days: [ { number,date,name,time,location,overnight,description } ... ]
 * }
 */
function gen_generateItineraryStruct_(req) {
 req = req || {}; // <<< CRITICAL FIX: prevents req.notes crash forever
 req = req || {};
 req.notes = String(req.notes || "");
 req.arrivalTime = String(req.arrivalTime || "-");
 req.departureTime = String(req.departureTime || "-");

  var city = String(req.city || "").trim();
  if (!city) throw new Error("gen_generateItineraryStruct_: city is required");

  var startDate = gen_toDate_(req.start || "");
  var days = Number(req.days || 0);
  if (!isFinite(days) || days < 1) throw new Error("gen_generateItineraryStruct_: days must be >= 1");
  days = Math.min(days, GEN_.MAX_DAYS);

  var pax = Number(req.pax || 0); if (!isFinite(pax)) pax = 0;
  var kids = Number(req.kids || 0); if (!isFinite(kids)) kids = 0;

  var arrivalTime = String(req.arrivalTime || "-").trim() || "-";
  var departureTime = String(req.departureTime || "-").trim() || "-";

  // Season/templateKey may be passed from onMessage; else compute.
  var seasonObj = gen_seasonFromDate_(startDate);
  var season = String(req.season || seasonObj.seasonLabel);
  var templateKey = String(req.templateKey || seasonObj.templateKey);

  var tourMonth = gen_monthNameEn_(startDate.getMonth() + 1);
  var daysNights = days + "D" + Math.max(0, days - 1) + "N";
  var paxTag = gen_paxTag_(pax, kids);

  var safeNotes = String(req.notes || ""); // <<< safe even if notes missing
  // Load library and build day plans
  var lib = gen_loadLibrary_();

  // Pick best route
  var route = gen_pickRoute_(lib.routes, city, season, days, safeNotes, "en");

  // Build day plans from blocks
  var plans = gen_buildDayPlans_(route, lib.blocksMap, season, city, days, { notes: safeNotes });

  // Convert to STRUCT days
  var outDays = [];
  for (var i = 0; i < days; i++) {
    var plan = plans[i] || { title: "", text: "" };

    var d = new Date(startDate.getTime());
    d.setDate(d.getDate() + i);

    var guessed = gen_guessFields_(i, days, city, plan.title, plan.text, arrivalTime, departureTime);

    outDays.push({
      number: "Day " + (i + 1),
      date: gen_fmtDate_(d, "en"),
      name: String(plan.title || "").trim(),
      time: guessed.time,               // raw (for template)
      location: guessed.location,       // raw list "A, B, C"
      overnight: guessed.overnight,     // raw "Almaty" / "Saty" / "-"
      description: String(plan.text || "").trim()
    });
  }

  var it = {
     meta: {
       city: city,
       start: gen_fmtDate_(startDate, "en"),
       days: days,
       pax: pax,
       kids: kids,
       arrivalTime: arrivalTime,
       departureTime: departureTime,
        season: season,
       templateKey: templateKey,
       daysNights: daysNights,
       paxTag: paxTag,
       tourMonth: tourMonth
     },
     days: outDays
    };

   // пост-логика: arrival/departure realism + 20–35 words
    if (typeof applyTravelLogicPostFix_ === "function") {
   it = applyTravelLogicPostFix_(it);
  }

 return it;
}

/**
 * Optional: text generator (kept for compatibility)
 */
function gen_generateItineraryText_(req) {
  var it = gen_generateItineraryStruct_(req);
  return gen_formatStructAsText_(it);
}

/** ===================== FORMATTERS ===================== **/

function gen_formatStructAsText_(it) {
  if (!it || !it.days || !it.days.length) return "";
  var out = [];
  for (var i = 0; i < it.days.length; i++) {
    var d = it.days[i];
    out.push(d.number + " – " + d.date + ": " + (d.name || ""));
    if (d.time) out.push("Time: " + d.time);
    if (d.location) out.push("Visited Locations: " + d.location);
    if (d.overnight) out.push("Overnight: " + d.overnight);
    if (d.description) out.push(d.description);
    out.push("");
  }
  return out.join("\n").trim();
}

function gen_wordCount_(text) {
  var cleaned = String(text || "")
    .replace(/[^A-Za-z0-9'\-\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return 0;
  return cleaned.split(" ").filter(function (w) { return w; }).length;
}

function gen_ensureMinWords_(text, min, max, opts) {
  opts = opts || {};
  min = Number(min || 20);
  max = Number(max || 35);
  var base = String(text || "").trim();
  var count = gen_wordCount_(base);

  if (count < min) {
    if (opts.allowOpenAI && gen_useOpenAI_() && typeof openAiText_ === "function") {
      var prompt =
        "Expand the following day description to " + min + "–" + max + " words.\n" +
        "Rules: keep facts and locations unchanged, no new places, professional tour-operator tone.\n" +
        "Return only the revised sentence(s), no quotes or markdown.\n\n" +
        "TEXT:\n" + base;
      var expanded = String(openAiText_(prompt, { model: gen_openAiModel_(), max_output_tokens: 200 }) || "").trim();
      if (expanded) {
        base = expanded;
        count = gen_wordCount_(base);
      }
    }

    if (count < min) {
      var pads = [
        "Your guide will help keep the pace comfortable with short breaks and photo stops along the way.",
        "Transfers are arranged for comfort and safety, with time to relax between highlights.",
        "Enjoy a smooth itinerary flow with easy logistics and time for rest."
      ];
      var idx = 0;
      while (count < min && idx < pads.length) {
        base = (base + " " + pads[idx]).replace(/\s+/g, " ").trim();
        count = gen_wordCount_(base);
        idx++;
      }
    }
  }

  if (count > max) {
    if (opts.allowOpenAI && gen_useOpenAI_() && typeof openAiText_ === "function") {
      var prompt2 =
        "Shorten the following day description to " + min + "–" + max + " words.\n" +
        "Rules: keep facts and locations unchanged, no new places.\n" +
        "Return only the revised sentence(s), no quotes or markdown.\n\n" +
        "TEXT:\n" + base;
      var shortened = String(openAiText_(prompt2, { model: gen_openAiModel_(), max_output_tokens: 200 }) || "").trim();
      if (shortened) base = shortened;
    } else {
      var words = base.split(/\s+/);
      base = words.slice(0, max).join(" ").replace(/\s+/g, " ").trim();
      if (base && base.slice(-1) !== ".") base += ".";
    }
  }

  return base;
}

/** ===================== FIELD GUESSING ===================== **/

function gen_guessFields_(i, totalDays, city, title, text, arrivalTime, departureTime) {
  var t = String(title || "");
  var low = t.toLowerCase();

  // defaults
  var time = "";
  var location = "";
  var overnight = (i === totalDays - 1) ? "-" : city;

  // Day 1 / last day heuristics
  if (i === 0) {
    location = "Airport";
    time = gen_arrivalWindow_(arrivalTime);
    overnight = city;
  }
  if (i === totalDays - 1) {
    location = "Airport";
    time = (departureTime && departureTime !== "-") ? departureTime : "";
    overnight = "-";
  }

  // Keyword-based
  if (low.indexOf("mede") >= 0 || low.indexOf("shymbulak") >= 0) {
    time = time || "10:00–17:00";
    location = location || "Medeu, Shymbulak";
    overnight = (i === totalDays - 1) ? "-" : city;
  }
  if (low.indexOf("charyn") >= 0) {
    time = time || "07:00–20:00";
    location = location || "Charyn Canyon, Black Canyon, Moon Canyon";
    overnight = (i === totalDays - 1) ? "-" : city;
  }
  if (low.indexOf("altyn emel") >= 0) {
    time = time || "Full day";
    location = location || "Altyn Emel National Park";
    overnight = (low.indexOf("day 1") >= 0 || i < totalDays - 1) ? "Basshi/park area" : city;
  }
  if (low.indexOf("kolsai") >= 0 || low.indexOf("kaindy") >= 0) {
    time = time || "Full day";
    if (low.indexOf("kaindy") >= 0) location = location || "Kaindy Lake";
    else location = location || "Kolsai Lakes";
    overnight = (low.indexOf("day 1") >= 0) ? "Saty/Kolsai area" : city;
  }
  if (low.indexOf("shopping") >= 0 || low.indexOf("free time") >= 0) {
    time = time || "12:00–18:00";
    location = location || "MEGA Mall (Al-Farabi), Arbat";
    overnight = (i === totalDays - 1) ? "-" : city;
  }

  // If still empty, try extract some places from title
  if (!location && t) {
    location = t.replace(/\s*\(.*?\)\s*/g, "").split(/,|&|\/|–|-| and /i)
      .map(function(x){ return String(x || "").trim(); })
      .filter(function(x){ return x && x.length >= 3 && x.toLowerCase() !== "day"; })
      .slice(0, 4)
      .join(", ");
  }

  return { time: time, location: location, overnight: overnight };
}

function gen_arrivalWindow_(arrivalTime) {
  var t = String(arrivalTime || "-").trim();
  if (t === "-" || !/^\d{1,2}:\d{2}$/.test(t)) return "16:00–20:00";
  var parts = t.split(":");
  var hh = Number(parts[0]), mm = Number(parts[1]);
  var mins = hh * 60 + mm + 120; // +2h for airport/customs/transfer
  var start = Math.max(16 * 60, mins);
  var end = Math.min(23 * 60, start + 240); // +4h city walk
  return gen_hhmm_(start) + "–" + gen_hhmm_(end);
}
function gen_hhmm_(mins) {
  var hh = Math.floor(mins / 60);
  var mm = mins % 60;
  return (hh < 10 ? "0" : "") + hh + ":" + (mm < 10 ? "0" : "") + mm;
}

function gen_paxTag_(pax, kids) {
  var a = (pax > 0) ? (pax + "A") : "";
  var k = (kids > 0) ? ("+" + kids + "K") : "";
  return (a + k) || "";
}

function gen_monthNameEn_(m) {
  var arr = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  return arr[(m - 1) % 12];
}

function gen_seasonFromDate_(d) {
  var m = d.getMonth() + 1;
  if (m === 12 || m === 1 || m === 2) return { seasonLabel: "Winter", templateKey: "winter" };
  if (m >= 3 && m <= 5) return { seasonLabel: "Spring", templateKey: "spring" };
  if (m >= 6 && m <= 8) return { seasonLabel: "Summer", templateKey: "summer" };
  return { seasonLabel: "Autumn", templateKey: "autumn" };
}

/** ===================== EXISTING LIBRARY CODE (from your Generator.txt) ===================== **/

function gen_openLibSpreadsheet_() {
  var sp = PropertiesService.getScriptProperties();
  var ssId = (sp.getProperty("LIB_SHEET_ID") || sp.getProperty("SPREADSHEET_ID") || "").trim();
  if (!ssId) throw new Error("Missing LIB_SHEET_ID or SPREADSHEET_ID in Script Properties");
  return SpreadsheetApp.openById(ssId);
}

function gen_loadLibrary_() {
  var sp = PropertiesService.getScriptProperties();

  var routesName = sp.getProperty("LIB_ROUTES_SHEET_NAME") || "LIBRARY - ROUTES_TEMPLATES";
  var blocksName = sp.getProperty("LIB_BLOCKS_SHEET_NAME") || "LIBRARY - LIBRARY_BLOCKS";
  var progName   = sp.getProperty("LIB_PROGRAM_SHEET_NAME") || "LIBRARY - PROGRAM_BLOCKS";

  var ss = gen_openLibSpreadsheet_();
  var shRoutes = ss.getSheetByName(routesName);
  var shBlocks = ss.getSheetByName(blocksName);
  var shProg   = ss.getSheetByName(progName);

  if (!shRoutes) throw new Error("Routes sheet not found: " + routesName);
  if (!shBlocks) throw new Error("Blocks sheet not found: " + blocksName);
  if (!shProg) throw new Error("Program sheet not found: " + progName);

  var routes = gen_readRoutes_(shRoutes);
  var blocksMap = gen_readBlocks_(shBlocks);
  gen_applyProgramToBlocks_(shProg, blocksMap);

  return { routes: routes, blocksMap: blocksMap };
}

function gen_readRoutes_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  var head = values[0].map(String);
  var idx = {};
  for (var i = 0; i < head.length; i++) idx[head[i].trim().toUpperCase()] = i;

  function get(row, key) {
    var j = idx[key];
    return j === undefined ? "" : row[j];
  }

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var routeId = String(get(row, "ROUTE_ID") || "").trim();
    if (!routeId) continue;

    out.push({
      routeId: routeId,
      city: String(get(row, "CITY") || "").trim(),
      season: String(get(row, "SEASON") || "").trim(),
      days: Number(get(row, "DAYS") || 0),
      lang: String(get(row, "LANG") || "en").trim(),
      tags: String(get(row, "TAGS") || "").trim(),
      dayBlocks: String(get(row, "DAY_BLOCKS") || "").trim()
    });
  }
  return out;
}

function gen_readBlocks_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return {};
  var head = values[0].map(String);
  var idx = {};
  for (var i = 0; i < head.length; i++) idx[head[i].trim().toUpperCase()] = i;

  function get(row, key) {
    var j = idx[key];
    return j === undefined ? "" : row[j];
  }

  var map = {};
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blockId = String(get(row, "BLOCK_ID") || "").trim();
    if (!blockId) continue;

    map[blockId] = {
      blockId: blockId,
      title: String(get(row, "TITLE") || "").trim(),
      text: String(get(row, "TEXT") || "").trim(),
      season: String(get(row, "SEASON") || "").trim(),
      city: String(get(row, "CITY") || "").trim(),
      tags: String(get(row, "TAGS") || "").trim()
    };
  }
  return map;
}

function gen_applyProgramToBlocks_(sheet, blocksMap) {
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return;
  var head = values[0].map(String);
  var idx = {};
  for (var i = 0; i < head.length; i++) idx[head[i].trim().toUpperCase()] = i;

  function get(row, key) {
    var j = idx[key];
    return j === undefined ? "" : row[j];
  }

  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    var blockId = String(get(row, "BLOCK_ID") || "").trim();
    if (!blockId || !blocksMap[blockId]) continue;

    var prog = String(get(row, "PROGRAM") || "").trim();
    if (prog) blocksMap[blockId].program = prog;
  }
}

function gen_pickRoute_(routes, city, season, days, notes, lang) {
  var c = String(city || "").toLowerCase();
  var s = String(season || "").toLowerCase();
  var l = String(lang || "en").toLowerCase();

  var candidates = routes.filter(function(rt) {
    var okCity = !rt.city || String(rt.city).toLowerCase().indexOf(c) >= 0;
    var okSeason = !rt.season || String(rt.season).toLowerCase().indexOf(s) >= 0;
    var okLang = !rt.lang || String(rt.lang).toLowerCase().indexOf(l) >= 0;
    var okDays = !rt.days || Number(rt.days) === Number(days);
    return okCity && okSeason && okLang && okDays;
  });

  if (!candidates.length) candidates = routes.slice();

  // TODO: you can improve matching with notes/tags later.
  candidates.sort(function(a, b) { return (b.routeId || "").length - (a.routeId || "").length; });
  return candidates[0] || { routeId: "AUTO", dayBlocks: "" };
}

function gen_buildDayPlans_(route, blocksMap, season, city, days, ctx) {
  ctx = ctx || {};
  var notes = String(ctx.notes || "");

  var blocks = String(route.dayBlocks || "").split("|").map(function(x){ return String(x||"").trim(); }).filter(Boolean);
  var plans = [];

  for (var i = 0; i < days; i++) {
    var blockId = blocks[i] || blocks[blocks.length - 1] || "";
    var b = blocksMap[blockId];

    if (!b) {
      plans.push({ title: "Free Day in " + city, text: "Leisure time and flexible program based on preferences.\nNotes: " + notes });
      continue;
    }

    var title = b.title || ("Day " + (i + 1));
    var text = b.text || "";
    if (notes) text += "\n\nNotes: " + notes;

    plans.push({ title: title, text: text });
  }
  return plans;
}

function gen_toDate_(x) {
  if (x instanceof Date) return x;
  var s = String(x || "").trim();
  var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    var dd = parseInt(m[1], 10);
    var mm = parseInt(m[2], 10);
    var yy = parseInt(m[3], 10);
    var d = new Date(yy, mm - 1, dd);
    if (!isNaN(d.getTime())) return d;
  }
  var d2 = new Date(s);
  if (!isNaN(d2.getTime())) return d2;
  throw new Error("Invalid date: " + String(x));
}

function gen_fmtDate_(d, lang) {
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var yy = d.getFullYear();
  return dd + "." + mm + "." + yy;
}

/** ===================== TESTS ===================== **/

function testGeneratorStructLocal() {
  var req = {
    city: "Almaty",
    start: "15.01.2026",
    days: 8,
    pax: 4,
    kids: 1,
    arrivalTime: "10:30",
    departureTime: "19:30",
    notes: "1 airport + city, 2 Kolsai overnight, 3 Kaindy return, 4 Shymbulak, 5 Almarasan"
  };
  var it = gen_generateItineraryStruct_(req);
  Logger.log(JSON.stringify(it, null, 2));
}


/* ===================== Library loading ===================== */

function gen_loadLibrary_() {
  var ss = openLibrarySpreadsheet_();

  var routes = gen_readSheetObjects_(ss, "ROUTES_TEMPLATES");
  var blocks = gen_readSheetObjects_(ss, "PROGRAM_BLOCKS");

  var blocksMap = {};
  for (var i = 0; i < blocks.length; i++) {
    var b = blocks[i];
    var id = String(b.BLOCK_ID || b.block_id || "").trim();
    if (!id) continue;
    blocksMap[id] = b;
  }

  return { routes: routes, blocksMap: blocksMap };
}

function gen_readSheetObjects_(ss, sheetName) {
  var sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error("Нет листа '" + sheetName + "' в Library");
  var lastRow = sh.getLastRow();
  var lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];

  var values = sh.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h || "").trim(); });

  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // skip fully empty
    var any = false;
    for (var c = 0; c < row.length; c++) {
      if (row[c] !== "" && row[c] !== null && row[c] !== undefined) { any = true; break; }
    }
    if (!any) continue;

    var obj = {};
    for (var j = 0; j < headers.length; j++) {
      var key = headers[j];
      if (!key) continue;
      obj[key] = row[j];
    }
    out.push(obj);
  }
  return out;
}

/* ===================== Route picking ===================== */

function gen_pickRoute_(routes, city, season, days) {
  // We rely mostly on SEASON + DAYS_COUNT. City can be future extension.
  var s = gen_normalizeSeason_(season);

  var candidates = [];
  for (var i = 0; i < routes.length; i++) {
    var rt = routes[i];
    var rtSeason = gen_normalizeSeason_(rt.SEASON || rt.season || "all");
    var dCount = Number(rt.DAYS_COUNT || rt.days_count || rt.DAYS || 0);

    if (!dCount) continue;

    var seasonOk = (rtSeason === "all" || rtSeason === s);
    if (!seasonOk) continue;

    candidates.push({ route: rt, days: dCount });
  }

  if (!candidates.length) {
    // fallback: ignore season
    for (var k = 0; k < routes.length; k++) {
      var rt2 = routes[k];
      var dc2 = Number(rt2.DAYS_COUNT || rt2.days_count || rt2.DAYS || 0);
      if (!dc2) continue;
      candidates.push({ route: rt2, days: dc2 });
    }
  }

  // prefer exact days, else max <= days, else min >= days, else first
  var exact = null;
  var bestLe = null;
  var bestGe = null;

  for (var n = 0; n < candidates.length; n++) {
    var cand = candidates[n];
    if (cand.days === days) exact = cand.route;
    if (cand.days <= days && (!bestLe || cand.days > bestLe.days)) bestLe = cand;
    if (cand.days >= days && (!bestGe || cand.days < bestGe.days)) bestGe = cand;
  }

  if (exact) return exact;
  if (bestLe) return bestLe.route;
  if (bestGe) return bestGe.route;
  return candidates[0].route;
}

function gen_routeBlockIds_(route) {
  var ids = [];
  // columns: DAY_1_BLOCK_ID, DAY_2_BLOCK_ID, ...
  for (var d = 1; d <= 30; d++) {
    var key = "DAY_" + d + "_BLOCK_ID";
    if (!(key in route)) break;
    var v = String(route[key] || "").trim();
    if (!v) break;
    ids.push(v);
  }
  return ids;
}

/* ===================== Plans building ===================== */

function gen_buildDayPlans_(route, blocksMap, season, city, targetDays, req) {
  var routeIds = gen_routeBlockIds_(route);
  var plans = [];

  for (var i = 0; i < routeIds.length; i++) {
    var id = routeIds[i];
    var block = blocksMap[id];

    if (!block) {
      plans.push({
        blockId: id,
        title: id + " (NOT FOUND in PROGRAM_BLOCKS)",
        time: "",
        locations: "",
        overnight: city,
        description: ""
      });
      continue;
    }

    var expanded = gen_expandBlock_(block, id, city);
    for (var x = 0; x < expanded.length; x++) plans.push(expanded[x]);
  }

  // Ensure notes-required blocks exist (insert if missing)
  var requiredIds = gen_requiredBlocksFromNotes_(String(req.notes || ""), blocksMap);
  plans = gen_ensureRequired_(plans, requiredIds, blocksMap, city);

  // If not enough days → pad with fallbacks
  if (plans.length < targetDays) {
    var fallback = gen_fallbackBlockIds_(city);
    var idx = 0;
    while (plans.length < targetDays && fallback.length) {
      var fid = fallback[idx % fallback.length];
      idx++;

      var fb = blocksMap[fid];
      if (!fb) continue;

      var add = gen_expandBlock_(fb, fid, city);
      for (var z = 0; z < add.length && plans.length < targetDays; z++) plans.push(add[z]);
    }
  }

  // Trim to targetDays
  if (plans.length > targetDays) plans = plans.slice(0, targetDays);

  // If last day & has departure time → add a tiny note to last day (optional)
  // (we keep it minimal, no hard dependency on having a “departure” block)
  return plans;
}

function gen_requiredBlocksFromNotes_(notes, blocksMap) {
  var n = String(notes || "");
  if (!n) return [];

  var reqIds = [];
  var rules = [
    { re: /(көлсай|kolsay)/i, id: "KOL_2D_KOLSAY_KAINDY" },
    { re: /(кайынд|kaindy)/i, id: "KOL_2D_KOLSAY_KAINDY" },
    { re: /(шымбул|shymbul)/i, id: "ALM_MEDEU_SHYMBULAK" },
    { re: /(чарын|charyn)/i, id: "CHR_CHARYN_FULLDAY" },
    { re: /(тамғал|tamgaly)/i, id: "IL_TAMGALY_TAS" },
    { re: /(шопп|shopping|mega)/i, id: "ALM_SHOPPING_DAY" }
  ];

  for (var i = 0; i < rules.length; i++) {
    if (rules[i].re.test(n)) {
      if (blocksMap[rules[i].id]) reqIds.push(rules[i].id);
    }
  }

  // uniq
  var uniq = {};
  var out = [];
  for (var j = 0; j < reqIds.length; j++) {
    if (!uniq[reqIds[j]]) { uniq[reqIds[j]] = true; out.push(reqIds[j]); }
  }
  return out;
}

function gen_ensureRequired_(plans, requiredIds, blocksMap, city) {
  if (!requiredIds || !requiredIds.length) return plans;

  function hasBlock(id) {
    for (var i = 0; i < plans.length; i++) {
      if (plans[i].blockId === id) return true;
    }
    return false;
  }

  for (var r = 0; r < requiredIds.length; r++) {
    var rid = requiredIds[r];
    if (hasBlock(rid)) continue;

    var b = blocksMap[rid];
    if (!b) continue;

    // Replace the last “generic” day if exists, else append
    var inserted = false;
    for (var k = plans.length - 1; k >= 0; k--) {
      if (plans[k].blockId && plans[k].blockId.indexOf("NOT FOUND") === -1) {
        // replace only if it's a fallback-ish day
        if (plans[k].blockId === "ALM_SHOPPING_DAY") continue;
        // do replacement
        var add = gen_expandBlock_(b, rid, city);
        plans.splice(k, 1); // remove one day
        // insert add (may be 2 days) at position k
        for (var x = add.length - 1; x >= 0; x--) plans.splice(k, 0, add[x]);
        inserted = true;
        break;
      }
    }
    if (!inserted) {
      var add2 = gen_expandBlock_(b, rid, city);
      for (var y = 0; y < add2.length; y++) plans.push(add2[y]);
    }
  }

  return plans;
}

function gen_fallbackBlockIds_(city) {
  // For Almaty typical safe fallbacks
  return [
    "ALM_CITY_HIGHLIGHTS_STD",
    "ALM_MEDEU_SHYMBULAK",
    "ALM_SHYMBULAK_GORELNIK_ACTIVE",
    "ALM_SHOPPING_DAY",
    "CHR_CHARYN_BLACK_MOON"
  ];
}

/* ===================== Block expansion ===================== */

function gen_expandBlock_(block, blockId, city) {
  var title = String(block.TITLE || block.title || blockId).trim();
  var time = String(block.SUGGESTED_TIME || block.suggested_time || "").trim();
  var covers = String(block.WHAT_IT_COVERS || block.what_it_covers || "").trim();
  var outTpl = String(block.OUTPUT_TEMPLATE || block.output_template || "").trim();

  // Detect multi-day template: "DAY 1:" ..."DAY 2:"
  if (outTpl && /(^|\n)\s*DAY\s*1\s*:/i.test(outTpl) && /(^|\n)\s*DAY\s*2\s*:/i.test(outTpl)) {
    var parts = gen_splitMultiDay_(outTpl); // [{dayNum:1, text:"..."}, ...]
    var res = [];
    for (var i = 0; i < parts.length; i++) {
      var info = gen_parseTemplatePart_(parts[i].text, city);
      res.push({
        blockId: blockId,
        title: title + " — Day " + parts[i].dayNum,
        time: time,
        locations: info.locations,
        overnight: info.overnight || city,
        description: info.description || covers
      });
    }
    return res;
  }

  // Single-day
  var info1 = gen_parseTemplatePart_(outTpl, city);
  return [{
    blockId: blockId,
    title: title,
    time: time,
    locations: info1.locations,
    overnight: info1.overnight || city,
    description: info1.description || covers
  }];
}

function gen_splitMultiDay_(tpl) {
  // Splits into chunks after "DAY N:"
  // We keep simple: find all "DAY <num>:" headers
  var re = /(^|\n)\s*DAY\s*(\d+)\s*:\s*/ig;
  var matches = [];
  var m;
  while ((m = re.exec(tpl)) !== null) {
    matches.push({ idx: m.index + m[1].length, dayNum: parseInt(m[2], 10) });
  }
  if (!matches.length) return [{ dayNum: 1, text: tpl }];

  var out = [];
  for (var i = 0; i < matches.length; i++) {
    var start = matches[i].idx;
    var end = (i + 1 < matches.length) ? matches[i + 1].idx - 1 : tpl.length;
    var chunk = tpl.substring(start, end).trim();
    out.push({ dayNum: matches[i].dayNum, text: chunk });
  }
  return out;
}

function gen_parseTemplatePart_(text, city) {
  var t = String(text || "").trim();
  var locations = "";
  var overnight = "";
  var description = "";

  if (!t) return { locations: "", overnight: city, description: "" };

  // Look for lines like: "DAY_LOCATION:" or "Location:"
  var loc = t.match(/DAY_LOCATION\s*:\s*(.*)/i) || t.match(/Location\s*:\s*(.*)/i);
  if (loc && loc[1]) locations = String(loc[1]).replace(/^Location\s*/i, "").trim();

  var ov = t.match(/DAY_OVERNIGHT\s*:\s*(.*)/i) || t.match(/Overnight\s*:\s*(.*)/i);
  if (ov && ov[1]) overnight = String(ov[1]).trim();

  // Description hint
  var desc = t.match(/DAY_DESCRIPTION\s*:\s*(.*)/i);
  if (desc && desc[1]) description = String(desc[1]).trim();

  // If still empty, take first 1–2 lines as description
  if (!description) {
    var lines = t.split(/\r?\n/).map(function (s) { return String(s || "").trim(); }).filter(function (s) { return !!s; });
    if (lines.length) {
      // avoid “Location:” lines
      var filtered = [];
      for (var i = 0; i < lines.length; i++) {
        if (/^(DAY_LOCATION|DAY_OVERNIGHT|Location|Overnight)\s*:/i.test(lines[i])) continue;
        filtered.push(lines[i]);
      }
      description = filtered.slice(0, 2).join(" ");
    }
  }

  return { locations: locations, overnight: overnight, description: description };
}

/* ===================== Draft formatting ===================== */

function gen_formatDraft_(plans, startDate, lang, req) {
  var lines = [];

  var totalDays = plans.length;
  var endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + totalDays - 1);

  lines.push("ITINERARY (DRAFT)");
  lines.push("City: " + String(req.city || ""));
  lines.push("Dates: " + gen_fmtDate_(startDate, lang) + " - " + gen_fmtDate_(endDate, lang));
  lines.push("Days: " + totalDays + ", Pax: " + Number(req.pax || 0) + ", Kids: " + Number(req.kids || 0));
  lines.push("");

  if (req.arrivalTime || req.departureTime) {
    lines.push((lang === "ru" ? "Arrival/Departure: " : "Arrival/Departure: ") +
      (req.arrivalTime ? String(req.arrivalTime) : "-") + " / " +
      (req.departureTime ? String(req.departureTime) : "-"));
    lines.push("");
  }

  if (req.notes) {
    lines.push(lang === "ru" ? "Пожелания клиента:" : "Client notes:");
    lines.push(String(req.notes));
    lines.push("");
  }

  for (var i = 0; i < plans.length; i++) {
    var d = new Date(startDate);
    d.setDate(startDate.getDate() + i);

    var dayTitle = plans[i].title || ("Day " + (i + 1));
    lines.push("Day " + (i + 1) + " – " + gen_fmtDate_(d, lang) + ": " + dayTitle);

    if (plans[i].time) lines.push("Time: " + plans[i].time);
    if (plans[i].locations) lines.push("Visited Locations: " + plans[i].locations);
    lines.push("Overnight: " + (plans[i].overnight || String(req.city || "")));

    if (plans[i].description) lines.push(plans[i].description);

    lines.push("");
  }

  return lines.join("\n").trim();
}

function gen_promptPolish_(draft, lang) {
  return (
    "You are a Treeple travel itinerary editor. Rewrite the draft into a clean final itinerary.\n" +
    "Rules:\n" +
    "1) Keep the structure for each day exactly:\n" +
    "   Day N – DD.MM.YYYY: Title\n" +
    "   Time: ...\n" +
    "   Visited Locations: ...\n" +
    "   Overnight: ...\n" +
    "   1–3 sentences description\n" +
    "2) Language: English only.\n" +
    "3) No emojis, no markdown tables, no bullet tables.\n" +
    "4) Do not invent flights/times if missing. If unknown, keep neutral.\n\n" +
    "DRAFT:\n" + draft
  );
}


/* ===================== Utils ===================== */

function gen_detectLang_(req) {
  var t = String((req && req.notes) || "");
  if (/[А-Яа-яЁё]/.test(t)) return "ru";
  return "en";
}

function gen_normalizeSeason_(s) {
  var v = String(s || "").trim().toLowerCase();
  if (!v) return "all";
  if (v === "winter" || v === "spring" || v === "summer" || v === "autumn") return v;
  if (v === "all") return "all";
  // Sometimes dropdown has "Winter" etc
  if (v.indexOf("wint") === 0) return "winter";
  if (v.indexOf("spr") === 0) return "spring";
  if (v.indexOf("sum") === 0) return "summer";
  if (v.indexOf("aut") === 0 || v.indexOf("fall") === 0) return "autumn";
  return "all";
}

function gen_seasonTitle_(m) {
  // Month number 1..12
  if (m === 12 || m === 1 || m === 2) return "Winter";
  if (m >= 3 && m <= 5) return "Spring";
  if (m >= 6 && m <= 8) return "Summer";
  return "Autumn";
}

function gen_toDate_(x) {
  if (x instanceof Date) return x;

  if (typeof x === "string") {
    var s = x.trim();
    // dd.MM.yyyy
    var m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m) {
      var dd = parseInt(m[1], 10);
      var mm = parseInt(m[2], 10);
      var yy = parseInt(m[3], 10);
      var d = new Date(yy, mm - 1, dd);
      if (!isNaN(d.getTime())) return d;
    }
    var d2 = new Date(s);
    if (!isNaN(d2.getTime())) return d2;
  }

  throw new Error("Invalid date: " + String(x));
}

function gen_fmtDate_(d, lang) {
  var dd = String(d.getDate()).padStart(2, "0");
  var mm = String(d.getMonth() + 1).padStart(2, "0");
  var yy = d.getFullYear();
  return dd + "." + mm + "." + yy;
}

/* ===================== Tests ===================== */

function testLibraryRead() {
  var lib = gen_loadLibrary_();
  Logger.log("Routes loaded: " + lib.routes.length);
  Logger.log("Blocks loaded: " + Object.keys(lib.blocksMap).length);
}

function testGeneratorLocal() {
  var req = {
    city: "Almaty",
    start: "15.01.2026",
    days: 8,
    pax: 6,
    kids: 2,
    arrivalTime: "10:30",
    departureTime: "19:30",
    notes: "1 аэропорт и сити тур 2 день кольсай с ночевкой 3 день кайынды возвращение в город 4 день шымбулак и сити тур 5 день алма арасан и бао"
  };
  var out = gen_generateItineraryText_(req);
  Logger.log(out);
}

function testGen_ArrivalLate() {
  var req = {
    city: "Almaty",
    start: "15.01.2026",
    days: 5,
    pax: 2,
    kids: 0,
    arrivalTime: "19:30",
    departureTime: "10:10",
    notes: ""
  };
  var it = gen_generateItineraryStruct_(req);
  var day1 = it.days[0] || {};
  if (!/Arrival, Transfer, Dinner, Rest/i.test(day1.name || "")) {
    throw new Error("Late arrival rule failed: Day 1 name mismatch.");
  }
  if (!/^Time:/i.test(day1.time || "")) {
    throw new Error("Late arrival rule failed: Day 1 time missing prefix.");
  }
  Logger.log("testGen_ArrivalLate OK");
}

function testGen_DepartureDay() {
  var req = {
    city: "Almaty",
    start: "15.01.2026",
    days: 5,
    pax: 2,
    kids: 0,
    arrivalTime: "10:00",
    departureTime: "10:10",
    notes: ""
  };
  var it = gen_generateItineraryStruct_(req);
  var last = it.days[it.days.length - 1] || {};
  if (!/Hotel, Airport/i.test(last.location || "")) {
    throw new Error("Departure rule failed: last day locations incorrect.");
  }
  if (!/^Time:/i.test(last.time || "")) {
    throw new Error("Departure rule failed: last day time missing prefix.");
  }
  Logger.log("testGen_DepartureDay OK");
}

function testGen_MinWords_AllDays() {
  var req = {
    city: "Almaty",
    start: "15.01.2026",
    days: 7,
    pax: 4,
    kids: 1,
    arrivalTime: "12:00",
    departureTime: "18:00",
    notes: ""
  };
  var it = gen_generateItineraryStruct_(req);
  for (var i = 0; i < it.days.length; i++) {
    var count = gen_wordCount_(it.days[i].description);
    if (count < 20) {
      throw new Error("Min words rule failed on day " + (i + 1) + ": " + count);
    }
  }
  Logger.log("testGen_MinWords_AllDays OK");
}

function testEdit_Prefixes() {
  var it = {
    meta: { city: "Almaty" },
    days: [
      {
        number: "Day 1",
        date: "15.01.2026",
        name: "City Highlights",
        time: "10:00–18:00",
        location: "City Center",
        overnight: "Almaty",
        description: "Short description that is not long enough."
      }
    ]
  };
  if (typeof validateItinStruct_ !== "function") {
    throw new Error("validateItinStruct_ not available.");
  }
  var out = validateItinStruct_(it, { strict: true });
  if (out) {
    throw new Error("Prefix validation failed: invalid itinerary should be rejected.");
  }
  Logger.log("testEdit_Prefixes OK");
}
