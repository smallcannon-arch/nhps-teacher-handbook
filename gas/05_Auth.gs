function requireUser_(idToken) {
  if (!idToken) throw new Error("缺少 Google 登入 token");
  var profile = verifyGoogleIdToken_(idToken);
  var email = String(profile.email || "").toLowerCase();
  if (!email) throw new Error("Google token 無 email");

  var users = readTable(APP.SHEETS.USERS);
  var user = users.find(function(row) {
    return String(row.email || "").toLowerCase() === email && String(row.enabled).toUpperCase() === "TRUE";
  });
  if (!user) throw new Error("此帳號未授權使用後台：" + email);

  return {
    email: email,
    name: user.name || profile.name || "",
    role: user.role || "viewer",
    office: user.office || ""
  };
}

function verifyGoogleIdToken_(idToken) {
  var url = "https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(idToken);
  var response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  var code = response.getResponseCode();
  var body = response.getContentText();
  if (code < 200 || code >= 300) {
    throw new Error("Google token 驗證失敗");
  }
  var profile = JSON.parse(body);
  if (APP.GOOGLE_CLIENT_ID && APP.GOOGLE_CLIENT_ID.indexOf("PASTE_") !== 0 && profile.aud !== APP.GOOGLE_CLIENT_ID) {
    throw new Error("Google token audience 不符");
  }
  if (String(profile.email_verified) !== "true") {
    throw new Error("Google email 尚未驗證");
  }
  return profile;
}

function requireEditor_(user) {
  if (["admin", "editor", "reviewer"].indexOf(user.role) < 0) {
    throw new Error("權限不足：需要 editor 以上");
  }
}

function requireReviewer_(user) {
  if (["admin", "reviewer"].indexOf(user.role) < 0) {
    throw new Error("權限不足：需要 reviewer 或 admin");
  }
}
