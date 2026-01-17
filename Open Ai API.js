/*******************************************************
 * OpenAI API (Apps Script) — Responses API wrapper (robust)
 *
 * Script Properties (required):
 *  - OPENAI_API_KEY
 *
 * Optional:
 *  - OPENAI_MODEL              (default: gpt-5-mini)
 *  - OPENAI_MAX_ATTEMPTS       (default: 6)
 *  - OPENAI_MAX_OUTPUT_TOKENS  (default: 1200)
 *  - OPENAI_TEMPERATURE        (default: 0.2)  // will be ignored for gpt-5* / o*
 *  - OPENAI_REASONING_EFFORT   (low|medium|high) default: medium  // for gpt-5 / o*
 *  - OPENAI_STRICT             ("1" => throw even on transient errors; default "0")
 *  - OPENAI_DEBUG              ("1" => more logs; default "0")
 *******************************************************/

function OPENAI_API_KEY_() {
  return (PropertiesService.getScriptProperties().getProperty("OPENAI_API_KEY") || "").trim();
}
function OPENAI_MODEL_() {
  return (PropertiesService.getScriptProperties().getProperty("OPENAI_MODEL") || "gpt-5-mini").trim();
}
function OPENAI_MAX_ATTEMPTS_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_MAX_ATTEMPTS") || "").trim();
  var n = Number(v || 6);
  return (n && n >= 1) ? Math.floor(n) : 6;
}
function OPENAI_MAX_OUTPUT_TOKENS_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_MAX_OUTPUT_TOKENS") || "").trim();
  var n = Number(v || 1200);
  return (n && n >= 1) ? Math.floor(n) : 1200;
}
function OPENAI_TEMPERATURE_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_TEMPERATURE") || "").trim();
  var n = Number(v || 0.2);
  return isFinite(n) ? n : 0.2;
}
function OPENAI_REASONING_EFFORT_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_REASONING_EFFORT") || "medium").trim().toLowerCase();
  if (v !== "low" && v !== "medium" && v !== "high") v = "medium";
  return v;
}
function OPENAI_STRICT_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_STRICT") || "0").trim().toLowerCase();
  return (v === "1" || v === "true" || v === "yes");
}
function OPENAI_DEBUG_() {
  var v = (PropertiesService.getScriptProperties().getProperty("OPENAI_DEBUG") || "0").trim().toLowerCase();
  return (v === "1" || v === "true" || v === "yes");
}

/**
 * Main text call (Responses API).
 * By default on transient errors returns "" (so Generator can fallback to Library).
 *
 * @param {string} prompt
 * @param {{model?:string, temperature?:number, max_output_tokens?:number}} opts
 * @returns {string} output text OR "" if transient fail (unless OPENAI_STRICT=1)
 */
function openAiText_(prompt, opts) {
  opts = opts || {};

  var key = OPENAI_API_KEY_();
  if (!key) throw new Error("Missing Script Property: OPENAI_API_KEY");

  var p = String(prompt || "").trim();
  if (!p) throw new Error("openAiText_: prompt is empty");

  var model = String(opts.model || OPENAI_MODEL_() || "gpt-5-mini").trim();
  var maxTokens = (opts.max_output_tokens == null ? OPENAI_MAX_OUTPUT_TOKENS_() : Number(opts.max_output_tokens));
  maxTokens = (isFinite(maxTokens) ? Math.floor(maxTokens) : 1200);

  var temperature = (opts.temperature == null ? OPENAI_TEMPERATURE_() : Number(opts.temperature));
  temperature = (isFinite(temperature) ? temperature : 0.2);

  var url = "https://api.openai.com/v1/responses";
  var basePayload = {
    model: model,
    input: p,
    max_output_tokens: maxTokens
  };

  // Add reasoning.effort for GPT-5 / o-series (supported for these families)
  if (isReasoningFamily_(model)) {
    basePayload.reasoning = { effort: OPENAI_REASONING_EFFORT_() };
  }

  // Temperature: some models reject it (e.g., GPT-5 family). We only send it for non-reasoning families.
  var payload = clone_(basePayload);
  if (shouldSendTemperature_(model)) {
    payload.temperature = temperature;
  }

  var params = {
    method: "post",
    contentType: "application/json",
    headers: { Authorization: "Bearer " + key },
    muteHttpExceptions: true
  };

  // 1) First attempt (maybe with temperature)
  var res = fetchWithRetry_(url, withPayload_(params, payload), OPENAI_MAX_ATTEMPTS_());
  var handled = handleResponseOrRetryNoTemp_(url, params, res, payload, basePayload);
  return handled;
}

/**
 * If we got a 400 specifically about temperature, retry once without temperature.
 */
function handleResponseOrRetryNoTemp_(url, params, res, sentPayload, basePayloadNoTemp) {
  var code = res.getResponseCode();
  var body = res.getContentText() || "";
  var headers = safeGetHeaders_(res);

  // Success
  if (code >= 200 && code < 300) {
    var json = safeJsonParse_(body);
    if (!json) {
      logOpenAiIssue_("OpenAI returned non-JSON on 2xx", code, body, headers);
      if (OPENAI_STRICT_()) throw new Error("OpenAI non-JSON response on " + code + ": " + body.slice(0, 600));
      return "";
    }
    return extractOutputText_(json);
  }

  // Parse error JSON if possible
  var errJson = safeJsonParse_(body);
  var param = (errJson && errJson.error && errJson.error.param) ? String(errJson.error.param) : "";
  var msg = (errJson && errJson.error && errJson.error.message) ? String(errJson.error.message) : "";

  // If error is about temperature => retry once without temperature
  if (code === 400 && (param === "temperature" || msg.toLowerCase().indexOf("temperature") >= 0)) {
    var payload2 = clone_(basePayloadNoTemp);
    // (basePayloadNoTemp already has no temperature)
    if (OPENAI_DEBUG_()) Logger.log("[OpenAI] Retrying without temperature due to 400 param=temperature");
    var res2 = fetchWithRetry_(url, withPayload_(params, payload2), OPENAI_MAX_ATTEMPTS_());
    return handleFinal_(res2);
  }

  // Hard config errors should not be hidden
  if (code === 400 || code === 401 || code === 403) {
    throw new Error("OpenAI HTTP " + code + ": " + compact_(body, 2000));
  }

  // Transient errors: fallback unless strict
  logOpenAiIssue_("OpenAI HTTP error", code, body, headers);
  var retryable = isRetryableStatus_(code) || looksLikeCloudflareHtml_(body);
  if (retryable && !OPENAI_STRICT_()) return "";

  throw new Error("OpenAI HTTP " + code + ": " + compact_(body, 2000));
}

function handleFinal_(res) {
  var code = res.getResponseCode();
  var body = res.getContentText() || "";
  var headers = safeGetHeaders_(res);

  if (code >= 200 && code < 300) {
    var json = safeJsonParse_(body);
    if (!json) {
      logOpenAiIssue_("OpenAI returned non-JSON on 2xx", code, body, headers);
      if (OPENAI_STRICT_()) throw new Error("OpenAI non-JSON response on " + code + ": " + body.slice(0, 600));
      return "";
    }
    return extractOutputText_(json);
  }

  // Hard errors
  if (code === 400 || code === 401 || code === 403) {
    throw new Error("OpenAI HTTP " + code + ": " + compact_(body, 2000));
  }

  // Transient: fallback unless strict
  logOpenAiIssue_("OpenAI HTTP error (final)", code, body, headers);
  var retryable = isRetryableStatus_(code) || looksLikeCloudflareHtml_(body);
  if (retryable && !OPENAI_STRICT_()) return "";

  throw new Error("OpenAI HTTP " + code + ": " + compact_(body, 2000));
}

/* ===================== Retry wrapper ===================== */

function fetchWithRetry_(url, params, maxAttempts) {
  maxAttempts = maxAttempts || 6;

  for (var attempt = 1; attempt <= maxAttempts; attempt++) {
    var res;
    try {
      res = UrlFetchApp.fetch(url, params);
    } catch (e) {
      if (attempt === maxAttempts) throw e;
      sleepBackoff_(attempt, null);
      continue;
    }

    var code = res.getResponseCode();
    var body = res.getContentText() || "";
    var retryable = isRetryableStatus_(code) || looksLikeCloudflareHtml_(body);

    if (!retryable || attempt === maxAttempts) return res;

    var retryAfterSec = parseRetryAfterSeconds_(res);
    sleepBackoff_(attempt, retryAfterSec);
  }
  return UrlFetchApp.fetch(url, params);
}

/* ===================== Helpers ===================== */

function isReasoningFamily_(model) {
  var m = String(model || "").toLowerCase();
  return m.indexOf("gpt-5") === 0 || m.indexOf("o") === 0; // gpt-5*, o*
}

function shouldSendTemperature_(model) {
  // Heuristic: do NOT send temperature for gpt-5* and o* families (they may reject it).
  // For other models, it's allowed by the API reference.
  return !isReasoningFamily_(model);
}

function withPayload_(params, payloadObj) {
  var p = clone_(params);
  p.payload = JSON.stringify(payloadObj);
  return p;
}

function clone_(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
}

function isRetryableStatus_(code) {
  return code === 408 || code === 429 || code === 500 || code === 502 || code === 503 || code === 504;
}

function looksLikeCloudflareHtml_(body) {
  if (!body) return false;
  var t = String(body).trim().toLowerCase();
  if (t.charAt(0) !== "<") return false;
  return (t.indexOf("cloudflare") >= 0) || (t.indexOf("bad gateway") >= 0);
}

function parseRetryAfterSeconds_(res) {
  try {
    var h = safeGetHeaders_(res);
    var ra = h["retry-after"] || h["Retry-After"] || "";
    var n = Number(ra);
    return (isFinite(n) && n > 0) ? Math.floor(n) : null;
  } catch (e) {
    return null;
  }
}

function sleepBackoff_(attempt, retryAfterSec) {
  if (retryAfterSec != null) {
    Utilities.sleep(Math.min(20000, retryAfterSec * 1000));
    return;
  }
  var base = 600 * Math.pow(2, attempt - 1);
  var jitter = Math.floor(Math.random() * 400);
  Utilities.sleep(Math.min(12000, base + jitter));
}

function extractOutputText_(json) {
  if (json && json.output_text != null) return String(json.output_text).trim();

  var out = "";
  var arr = json && json.output;
  if (arr && arr.length) {
    for (var i = 0; i < arr.length; i++) {
      var item = arr[i];
      var content = item && item.content;
      if (!content || !content.length) continue;
      for (var j = 0; j < content.length; j++) {
        var c = content[j];
        if (c && (c.type === "output_text" || c.type === "text") && c.text) out += c.text;
      }
    }
  }
  return String(out || "").trim();
}

function safeJsonParse_(s) {
  try { return JSON.parse(s); } catch (e) { return null; }
}

function compact_(s, maxLen) {
  var t = String(s || "");
  if (t.length <= maxLen) return t;
  return t.slice(0, maxLen) + "\n...(truncated)";
}

function safeGetHeaders_(res) {
  var out = {};
  try {
    var h = res.getAllHeaders ? res.getAllHeaders() : {};
    for (var k in h) {
      if (!h.hasOwnProperty(k)) continue;
      out[k] = h[k];
      out[String(k).toLowerCase()] = h[k];
    }
  } catch (e) {}
  return out;
}

function logOpenAiIssue_(label, code, body, headers) {
  var debug = OPENAI_DEBUG_();
  var cfRay = (headers && (headers["cf-ray"] || headers["CF-RAY"])) ? String(headers["cf-ray"] || headers["CF-RAY"]) : "";
  var msg = "[OpenAI] " + label + " | HTTP " + code + (cfRay ? (" | cf-ray=" + cfRay) : "");
  Logger.log(msg);
  if (debug) Logger.log("[OpenAI] body: " + compact_(body, 1200));
}

/**
 * Manual test from editor
 */
function testOpenAI() {
  var out = openAiText_("Reply with one word: OK", { max_output_tokens: 200 });
  Logger.log("OPENAI_OUT=[" + out + "]");
}
