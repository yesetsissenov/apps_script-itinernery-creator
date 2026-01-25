// File: OpenAI.gs

function openAiAvailable_() {
  var props = PropertiesService.getScriptProperties();
  return !!props.getProperty("OPENAI_API_KEY");
}

function openAiText_(systemText, userText) {
  var props = PropertiesService.getScriptProperties();
  var apiKey = props.getProperty("OPENAI_API_KEY");
  if (!apiKey) return null;
  var model = props.getProperty("OPENAI_MODEL") || "gpt-4o-mini";
  var payload = {
    model: model,
    messages: [
      { role: "system", content: systemText },
      { role: "user", content: userText }
    ],
    temperature: 0.2
  };
  var options = {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify(payload),
    headers: {
      Authorization: "Bearer " + apiKey
    }
  };
  var res = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", options);
  var code = res.getResponseCode();
  if (code >= 300) {
    _diagSave_("openai_error", "", "", "", "", "OpenAI error " + code + ": " + res.getContentText(), "");
    return null;
  }
  var body = JSON.parse(res.getContentText());
  return body && body.choices && body.choices[0] && body.choices[0].message ? body.choices[0].message.content : null;
}

function openAiParseRequest_(text) {
  var systemText = "You extract itinerary request fields as JSON. Output JSON only.";
  var userText = "Extract: city, start (DD.MM.YYYY), days (int), pax (int adults), kids (int), arrivalTime, departureTime, notes. If missing, omit. Text: " + text;
  var raw = openAiText_(systemText, userText);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}

function openAiEditItinerary_(itinerary, instruction) {
  var systemText = "You edit itinerary JSON. Return full JSON only. Keep English, no emojis.";
  var userText = "Current itinerary JSON:\n" + JSON.stringify(itinerary) + "\nInstruction: " + instruction;
  var raw = openAiText_(systemText, userText);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    return null;
  }
}
