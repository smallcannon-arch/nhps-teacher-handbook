function doGet(e) {
  try {
    var action = (e && e.parameter && e.parameter.action) || "getHandbook";
    if (action === "health") {
      return jsonResponse({ ok: true, app_version: APP.VERSION, time: nowText() });
    }
    if (action === "getConfig") {
      return jsonResponse(getConfigPayload());
    }
    if (action === "getHandbook") {
      return jsonResponse(getPublishedHandbook());
    }
    return jsonResponse({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var email = "";
  var cmd = "";
  try {
    var payload = parsePostPayload_(e);
    cmd = payload.cmd || "";
    var user = requireUser_(payload.idToken);
    email = user.email;

    if (cmd === "adminList") {
      logAction(email, cmd, "", "ok", "load admin handbook");
      return jsonResponse(getAdminHandbook(user));
    }
    if (cmd === "saveDraft") {
      return jsonResponse(saveDraft_(payload, user));
    }
    if (cmd === "submitReview") {
      return jsonResponse(submitReview_(payload, user));
    }
    if (cmd === "publishChapter") {
      return jsonResponse(publishChapter_(payload, user));
    }
    if (cmd === "withdrawChapter") {
      return jsonResponse(withdrawChapter_(payload, user));
    }

    return jsonResponse({ ok: false, error: "UNKNOWN_CMD" });
  } catch (err) {
    logAction(email, cmd, "", "error", String(err && err.message || err));
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function parsePostPayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  var type = String(e.postData.type || "");
  var contents = String(e.postData.contents || "");
  var trimmed = contents.trim();
  if (type.indexOf("application/json") >= 0 || trimmed.indexOf("{") === 0 || trimmed.indexOf("[") === 0) {
    return JSON.parse(contents);
  }
  var data = {};
  contents.split("&").forEach(function(pair) {
    var parts = pair.split("=");
    data[decodeURIComponent(parts[0] || "")] = decodeURIComponent((parts[1] || "").replace(/\+/g, " "));
  });
  if (data.payload) return JSON.parse(data.payload);
  return data;
}
