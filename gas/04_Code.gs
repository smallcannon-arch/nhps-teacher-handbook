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
    if (action === "getDirectory") {
      return jsonResponse(getPublishedDirectory());
    }
    return jsonResponse({ ok: false, error: "UNKNOWN_ACTION" });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function doPost(e) {
  var requestStarted = Date.now();
  var email = "";
  var cmd = "";
  try {
    var payload = parsePostPayload_(e);
    cmd = payload.cmd || "";
    var user = requireUser_(payload.idToken);
    var authFinished = Date.now();
    email = user.email;

    if (cmd === "accountList") return jsonResponse(getManagedAccounts_(user));
    if (cmd === "accountSave") return jsonResponse(saveManagedAccount_(payload, user));

    if (cmd === "adminList") {
      logAction(email, cmd, "", "ok", "load admin handbook");
      return jsonResponse(getAdminHandbook(user));
    }
    if (cmd === "directoryList") {
      logAction(email, cmd, "", "ok", "load directory admin");
      var auditFinished = Date.now();
      var directory = getAdminDirectory(user);
      directory.timing_ms = {
        auth: authFinished - requestStarted,
        audit: auditFinished - authFinished,
        directory: Date.now() - auditFinished,
        total: Date.now() - requestStarted
      };
      return jsonResponse(directory);
    }
    if (cmd === "saveDirectoryResource") {
      return jsonResponse(saveDirectoryResource_(payload, user));
    }
    if (cmd === "deleteDirectoryResource") {
      return jsonResponse(deleteDirectoryResource_(payload, user));
    }
    if (cmd === "batchDeleteDirectoryResources") {
      return jsonResponse(batchDeleteDirectoryResources_(payload, user));
    }
    if (cmd === "restoreDirectoryResources") {
      return jsonResponse(restoreDirectoryResources_(payload, user));
    }
    if (cmd === "reorderDirectoryItems") {
      return jsonResponse(reorderDirectoryItems_(payload, user));
    }
    if (cmd === "batchUpdateDirectoryResources") {
      return jsonResponse(batchUpdateDirectoryResources_(payload, user));
    }
    if (cmd === "saveDirectoryShortcut") {
      return jsonResponse(saveDirectoryShortcut_(payload, user));
    }
    if (cmd === "deleteDirectoryShortcut") {
      return jsonResponse(deleteDirectoryShortcut_(payload, user));
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
    if (cmd === "deleteChapter") {
      return jsonResponse(deleteChapter_(payload, user));
    }

    return jsonResponse({ ok: false, error: "UNKNOWN_CMD" });
  } catch (err) {
    if (cmd === "accountList" || cmd === "accountSave") {
      logAction("", cmd, "", "error", "account management request failed");
    } else {
      logAction(email, cmd, "", "error", String(err && err.message || err));
    }
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
