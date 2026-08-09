/* ══════════════════════════════════════════════════════════
   員工後台登入（LINE Login）

   流程：
   1. 開啟後台 → 沒登入過就擋一張登入畫面
   2. 按「用 LINE 登入」→ 跳到 LINE 授權頁
   3. 授權完 LINE 把人送回來，網址上帶一組一次性的 code
   4. 前端把 code 送去 Railway，Railway 用 Channel secret 換出身分
   5. 拿到身分就放行，並把結果記在 localStorage

   ── 2026-08-09 這一版改了什麼 ──
   以前這支檔案會直接從瀏覽器讀 otto2-2026 的員工名單，
   代表那本資料庫必須開放讀取。而名單裡存著 appKey，
   那是「主畫面 APP 專屬連結」的登入密碼——
   任何人撈走名單就能冒充任何一位員工登入。

   現在改成三件事都由 Railway 代勞，瀏覽器碰不到員工名單：
   ・確認名單是不是空的  → GET  /auth/bootstrap
   ・專屬連結驗證        → POST /auth/key
   ・重新讀自己的權限    → POST /staff/me

   另外登入成功時，Railway 會發一張有簽章的憑證（ME.token）。
   後面所有跟伺服器要資料的動作都靠它證明身分，
   不再用 LINE userId——那串在畫面上就看得到，本來就不是秘密。
   ══════════════════════════════════════════════════════════ */

var AUTH_CHANNEL_ID = "2010980574";
var AUTH_API        = "https://otto2-notify-production.up.railway.app";
var AUTH_REDIRECT   = "https://otto2tfs2000-ctrl.github.io/salary-system/";
var AUTH_KEY        = "otto2_staff_session";

var ME = null;   /* 登入後放這裡：{userId, displayName, picture, staff, registered, token} */

/* ══ 診斷追蹤（2026-08-09b）══════════════════════════════
   「每次重整都要重新登入」查不出原因，是因為出問題的三個地方
   都被 try{}catch(e){} 靜靜吞掉了，畫面上一點跡象都沒有。
   這一版把每個判斷點記下來，並印在登入卡片下面，
   不用開 Console 也看得到到底走了哪一條路。
   查清楚之後這段可以整個拿掉。 */
var AUTH_TRACE = [];
function authLog(m, d){
  AUTH_TRACE.push(m);
  try { console.log("[auth] " + m, d === undefined ? "" : d) } catch(e){}
}
function authTraceHtml(){
  if (!AUTH_TRACE.length) return "";
  return '<div style="margin-top:18px;padding-top:12px;border-top:1px solid #ece7dc;' +
         'font-size:10.5px;color:#a8a29a;line-height:1.6;text-align:left;word-break:break-all">' +
         AUTH_TRACE.map(function(x){ return "・" + x }).join("<br>") + '</div>';
}

/* 這個人能不能做某個動作。key：checkout（核銷）、void（作廢）、sellPlan（賣方案）
   名單裡沒有這個人 → 一律不行。名單整個是空的（系統剛裝好）才放行，
   讓第一個人有辦法把自己設成管理員。 */
var AUTH_BOOTSTRAP = false;   /* 名單是空的 */
function can(k){
  if (!ME) return AUTH_BOOTSTRAP;
  var st = ME.staff;
  if (!st) return AUTH_BOOTSTRAP;
  if (st.active === false) return false;
  if (st.role === "owner") return true;
  return Array.isArray(st.acts) && st.acts.indexOf(k) >= 0;
}

/* 用 localStorage 不用 sessionStorage：關掉分頁還記得，不用每次重登。
   存 30 天，超過就要求再登入一次。 */
var AUTH_DAYS = 30;
function authSaved(){
  var raw = null;
  try { raw = localStorage.getItem(AUTH_KEY) }
  catch(e){ authLog("讀 localStorage 失敗：" + e.name); return null }
  if (!raw){ authLog("localStorage 裡沒有登入紀錄"); return null }
  var v = null;
  try { v = JSON.parse(raw) }
  catch(e){ authLog("登入紀錄的 JSON 壞掉（" + raw.length + " 字）"); return null }
  if (!v || !v.userId){ authLog("登入紀錄裡沒有 userId"); return null }
  if (v.savedAt && Date.now() - v.savedAt > AUTH_DAYS * 86400000){
    authLog("登入紀錄超過 " + AUTH_DAYS + " 天（存於 " + new Date(v.savedAt).toLocaleString() + "）");
    return null;
  }
  authLog("找到登入紀錄：" + (v.displayName || v.userId) +
          "／token " + (v.token ? "有" : "沒有") +
          "／存於 " + (v.savedAt ? new Date(v.savedAt).toLocaleTimeString() : "未知"));
  return v;
}
function authStore(v){
  try {
    v.savedAt = Date.now();
    localStorage.setItem(AUTH_KEY, JSON.stringify(v));
    authLog("已寫入登入紀錄");
  } catch(e){
    authLog("★寫入登入紀錄失敗：" + e.name + "——這就是每次都要重登的原因");
  }
}
function authClear(){
  authLog("使用者按了登出／重新登入，清掉紀錄");
  try { localStorage.removeItem(AUTH_KEY) } catch(e){}
  location.href = AUTH_REDIRECT;
}

/* ══ 跟伺服器要資料的共用管道 ══
   member.js、booking.js 這些檔案都用這個，不要各寫各的。
   會自動把憑證附上去；憑證過期就跳出重新登入畫面。

   用法：var j = await staffApi("/staff/members", { shallow: true });
   ════════════════════════════════════════════════════════ */
async function staffApi(path, body){
  if (!ME || !ME.token) throw new Error("尚未登入");
  var payload = Object.assign({ token: ME.token }, body || {});
  var r = await fetch(AUTH_API + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  var j = null;
  try { j = await r.json() } catch(e){}
  if (r.status === 401){
    /* 憑證過期或被換過 → 清掉，要求重登 */
    authLog("★staffApi " + path + " 回 401，清掉登入紀錄");
    try { localStorage.removeItem(AUTH_KEY) } catch(e){}
    authShowError("登入已過期", "請重新登入一次。");
    throw new Error("登入已過期");
  }
  if (!r.ok || !j || !j.ok) throw new Error((j && j.error) || ("伺服器回應異常（" + r.status + "）"));
  return j;
}

/* 會員清單。shallow=true 只回電話清單，資料量小很多 */
async function staffMembers(shallow){
  var j = await staffApi("/staff/members", { shallow: !!shallow });
  return j.members || {};
}

/* 每次開頁面重抓一次自己的權限。
   這樣管理員改完設定，對方重整就生效，不用叫他登出再登入。 */
async function authRefreshStaff(){
  if (!ME || !ME.token){ authLog("沒有 token，跳過重讀權限"); return }
  var t0 = Date.now();
  try {
    var r = await fetch(AUTH_API + "/staff/me", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: ME.token })
    });
    var ms = Date.now() - t0;
    if (r.status === 401){
      /* 憑證過期，當作沒登入 */
      authLog("★/staff/me 回 401（" + ms + "ms），憑證被伺服器拒絕");
      ME = null;
      try { localStorage.removeItem(AUTH_KEY) } catch(e){}
      return;
    }
    if (!r.ok){ authLog("/staff/me 回 " + r.status + "（" + ms + "ms），權限沿用舊的"); return }
    var j = await r.json();
    if (!j || !j.ok){ authLog("/staff/me 回應內容異常，權限沿用舊的"); return }
    ME.staff = j.staff || null;
    ME.registered = !!j.registered;
    authLog("/staff/me 正常（" + ms + "ms）／身分 " +
            ((j.staff && j.staff.role) || "不在名單") );
    authStore(ME);
  } catch(e){
    authLog("★連不上 /staff/me：" + e.message + "（" + (Date.now()-t0) + "ms），權限沿用舊的");
  }
}

/* 導去 LINE 授權頁。state 是防造假用的一次性亂數 */
function authGoLine(){
  /* 邀請碼直接塞進 state 一起送去 LINE。
     LINE 會把 state 原封不動還回來，所以中間就算換了瀏覽器分頁也不會弄丟。
     （之前存在瀏覽器暫存區，跳去 LINE App 授權再跳回來就不見了。） */
  var iv = new URLSearchParams(location.search).get("invite") || "";
  var rnd = Math.random().toString(36).slice(2) + Date.now().toString(36);
  var state = iv ? (rnd + "~" + iv) : rnd;
  try { sessionStorage.setItem("otto2_auth_state", state) } catch(e){}
  var u = "https://access.line.me/oauth2/v2.1/authorize" +
    "?response_type=code" +
    "&client_id=" + encodeURIComponent(AUTH_CHANNEL_ID) +
    "&redirect_uri=" + encodeURIComponent(AUTH_REDIRECT) +
    "&state=" + encodeURIComponent(state) +
    "&scope=" + encodeURIComponent("profile openid");
  location.href = u;
}

/* ── 畫面 ── */
function authScreen(inner){
  var box = document.getElementById("auth-gate");
  if (!box){
    box = document.createElement("div");
    box.id = "auth-gate";
    box.style.cssText = "position:fixed;inset:0;z-index:1000;background:#f7f5f0;" +
      "display:flex;align-items:center;justify-content:center;padding:24px";
    document.body.appendChild(box);
  }
  box.innerHTML =
    '<div style="background:#fff;border:1px solid #e2ddd2;border-radius:16px;' +
    'padding:38px 34px;max-width:380px;width:100%;text-align:center;' +
    'box-shadow:0 4px 24px rgba(43,41,38,.10)">' + inner + '</div>';
  box.style.display = "flex";
}
function authHideScreen(){
  var box = document.getElementById("auth-gate");
  if (box) box.style.display = "none";
}

function authShowLogin(msg){
  authScreen(
    '<div style="font-family:Georgia,serif;font-size:19px;color:#a67c28;letter-spacing:.5px">Otto2 ARTCLUB</div>' +
    '<div style="font-size:11px;color:#948e83;letter-spacing:2.4px;margin-top:3px">員工後台</div>' +
    '<div style="font-size:13px;color:#6b665e;margin:24px 0 20px;line-height:1.7">' +
      (msg || "請用 LINE 登入，系統會認出你是誰。") + '</div>' +
    '<button onclick="authGoLine()" style="width:100%;padding:13px;border:none;border-radius:9px;' +
      'background:#06C755;color:#fff;font-size:15px;font-weight:500;cursor:pointer;font-family:inherit">' +
      '用 LINE 登入</button>' + authTraceHtml()
  );
}

function authShowError(title, detail){
  authScreen(
    '<div style="font-size:15px;font-weight:600;color:#d64545;margin-bottom:10px">' + title + '</div>' +
    '<div style="font-size:13px;color:#6b665e;line-height:1.75;margin-bottom:22px">' + (detail || "") + '</div>' +
    '<button onclick="authClear()" style="width:100%;padding:12px;border:1px solid #d0c9ba;' +
      'border-radius:9px;background:#fff;color:#6b665e;font-size:14px;cursor:pointer;font-family:inherit">' +
      '重新登入</button>'
  );
}

/* 依權限收掉看不到的分頁。
   這只是介面，真正擋住是資料庫規則的工作。 */
function authApplyTabs(){
  if (!ME) return;
  var st = ME.staff;
  if (!st && AUTH_BOOTSTRAP) return;      /* 系統剛裝好，全開讓人設定管理員 */
  var allowed = (st && Array.isArray(st.tabs)) ? st.tabs : [];
  if (st && st.role === "owner") return;   /* 管理員看全部 */
  var first = null;
  document.querySelectorAll(".tabs .tab").forEach(function(el){
    var k = el.dataset.tab;
    if (allowed.indexOf(k) < 0) el.style.display = "none";
    else if (!first) first = k;
  });
  /* 目前這頁不在權限內就跳到第一個看得到的 */
  var cur = document.querySelector(".page.active");
  var curKey = cur ? String(cur.id).replace("tab-", "") : "";
  if (first && allowed.indexOf(curKey) < 0 && window.switchTab) switchTab(first);
}

/* 登入成功後在右上角顯示是誰 */
function authBadge(){
  if (!ME) return;
  var bar = document.querySelector(".topbar > div:last-child");
  if (!bar || document.getElementById("auth-badge")) return;
  var role = ME.staff && ME.staff.role;
  var roleName = role === "owner" ? "管理員" : role === "admin" ? "行政" : role === "teacher" ? "老師" : "未登記";
  var el = document.createElement("div");
  el.id = "auth-badge";
  el.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:#6b665e";
  el.innerHTML =
    (ME.picture ? '<img src="' + ME.picture + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover">' : '') +
    '<span title="' + ME.userId + '">' + (ME.displayName || "已登入") + '</span>' +
    '<span style="color:#948e83">' + roleName + '</span>' +
    '<span onclick="authClear()" style="cursor:pointer;color:#948e83;text-decoration:underline">登出</span>';
  bar.insertBefore(el, bar.firstChild);
  authApplyTabs();
}

/* 名單裡沒有這個人 → 擋在門外，並顯示他的 LINE ID 讓管理員能加人 */
function authShowNotAllowed(){
  authScreen(
    '<div style="font-family:Georgia,serif;font-size:18px;color:#a67c28">Otto2 ARTCLUB</div>' +
    '<div style="font-size:11px;color:#948e83;letter-spacing:2.4px;margin-top:3px">員工後台</div>' +
    '<div style="font-size:14px;font-weight:600;color:#2b2926;margin:22px 0 8px">' +
      (ME && ME.displayName ? ME.displayName + '，' : '') + '這個帳號還沒有權限</div>' +
    '<div style="font-size:13px;color:#6b665e;line-height:1.75;margin-bottom:18px">' +
      '請向管理員索取邀請連結，或把下面這串 ID 給管理員。</div>' +
    '<div style="background:#f0ece2;border-radius:8px;padding:10px;font-size:11px;' +
      'color:#6b665e;word-break:break-all;margin-bottom:18px">' + ((ME && ME.userId) || "") + '</div>' +
    '<button onclick="authClear()" style="width:100%;padding:12px;border:1px solid #d0c9ba;' +
      'border-radius:9px;background:#fff;color:#6b665e;font-size:14px;cursor:pointer;font-family:inherit">' +
      '換一個帳號登入</button>' + authTraceHtml()
  );
}

/* 名單整個是空的嗎？是的話允許第一個人自己設成管理員。
   改由伺服器回答，只回一個是非題，不吐出任何名單內容。 */
async function authCheckBootstrap(){
  try {
    var r = await fetch(AUTH_API + "/auth/bootstrap");
    var j = r.ok ? await r.json() : null;
    AUTH_BOOTSTRAP = !!(j && j.empty);
  } catch(e){ AUTH_BOOTSTRAP = false; }
  return AUTH_BOOTSTRAP;
}

/* 登入後統一判斷放不放行 */
async function authGate(){
  await authCheckBootstrap();
  var st = ME && ME.staff;
  if (st && st.active !== false){
    authLog("放行：" + (ME.displayName || "") + "／" + (st.role || ""));
    authHideScreen(); authBadge(); return true;
  }
  if (AUTH_BOOTSTRAP){ authLog("名單是空的，放行讓第一個人設定管理員"); authHideScreen(); authBadge(); return true }
  authLog("★擋下：" + (st ? "帳號被停用" : "不在員工名單裡"));
  authShowNotAllowed();
  return false;
}

/* ── 主流程 ── */
/* ══ 主畫面 APP 專用登入（專屬連結）══════════════════════
   iPhone 把「主畫面 APP」和 Safari 當成兩個分開的容器，
   資料不互通。而 LINE 登入是整頁跳去 access.line.me，
   一離開本站就會被丟到 Safari，授權完人也留在 Safari，
   主畫面 APP 那邊永遠收不到登入結果 → 每次開都要重登。

   這條路全程不離開本站，所以在哪個容器開，就存在哪個容器。
   連結格式： .../salary-system/?k=<LINE userId>.<金鑰>
   金鑰放在 otto2-2026 的 staff/{userId}/appKey

   ★改動★ 以前是在這裡自己讀資料庫比對金鑰，等於要求資料庫公開。
   現在把 uid 和金鑰送去 Railway 比對，瀏覽器讀不到任何人的金鑰。
   ════════════════════════════════════════════════════ */
async function authKeyLogin(raw){
  var i = String(raw).indexOf(".");
  if (i < 1){ authShowLogin("這條連結格式不對，跟管理員重新要一次。"); return }
  var uid = raw.slice(0, i), key = raw.slice(i + 1);
  authScreen('<div style="font-size:14px;color:#6b665e">登入中…</div>');
  try {
    var r = await fetch(AUTH_API + "/auth/key", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uid: uid, key: key })
    });
    var j = null;
    try { j = await r.json() } catch(e){}
    if (!j || !j.ok){
      authShowLogin((j && j.error) || "這條連結已經失效，跟管理員重新要一次。");
      return;
    }
    ME = j;
    authStore(j);
    history.replaceState(null, "", AUTH_REDIRECT);   /* 把金鑰從網址上藏掉 */
    await authGate();
  } catch(e){
    authShowError("連不上登入服務", e.message);
  }
}

async function authInit(){
  /* 已經登入過就直接放行。
     注意：舊版存下來的登入紀錄沒有 token 這個欄位，
     那種一律當作沒登入，請對方重登一次換到新的憑證。 */
  authLog("authInit 開始，網址 " + location.pathname + location.search);
  var s = authSaved();
  if (s && s.userId && s.token){
    authLog("走「已登入」這條");
    ME = s;
    await authRefreshStaff();
    if (!ME){ authShowLogin("登入已過期，請重新登入。"); return }
    var old = document.getElementById("auth-badge");
    if (old) old.remove();
    if (location.search.indexOf("k=") >= 0) history.replaceState(null, "", AUTH_REDIRECT);
    await authGate();
    return;
  }
  if (s && s.userId && !s.token){
    authLog("★舊版紀錄沒有 token，刪掉要求重登");
    try { localStorage.removeItem(AUTH_KEY) } catch(e){}
  }

  /* 專屬連結（主畫面 APP 走這條，不會跳出去 LINE） */
  var kq = new URLSearchParams(location.search).get("k");
  if (kq){ authLog("走「專屬連結」這條"); await authKeyLogin(kq); return; }

  /* 從 LINE 回來，網址上會帶 code */
  var q = new URLSearchParams(location.search);
  var code = q.get("code"), state = q.get("state"), err = q.get("error");

  if (err){
    authShowLogin("上次登入沒有完成（" + err + "），再試一次。");
    return;
  }
  if (!code){
    authLog("★沒有可用的登入紀錄，也沒有 LINE 回傳的 code → 顯示登入畫面");
    var iv = q.get("invite");
    authShowLogin(iv ? "這是一組邀請連結。用 LINE 登入之後，帳號就會自動建立好。" : null);
    return;
  }

  /* 從 state 把邀請碼拆回來 */
  var invite = "";
  if (state && state.indexOf("~") > 0) invite = state.split("~").slice(1).join("~");
  var expect = null;
  try { expect = sessionStorage.getItem("otto2_auth_state") } catch(e){}
  if (expect && state && state !== expect){
    authShowError("登入驗證失敗", "網址帶回來的驗證碼對不上，為了安全起見請重新登入一次。");
    return;
  }

  authScreen('<div style="font-size:14px;color:#6b665e">登入中…</div>');
  try {
    var r = await fetch(AUTH_API + "/auth/line", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: code, redirectUri: AUTH_REDIRECT, invite: invite })
    });
    var j = await r.json();
    if (!j.ok){
      authShowError("登入失敗", (j.error || "") + (j.detail ? "<br>" + j.detail : ""));
      return;
    }
    ME = j;
    authStore(j);
    try { sessionStorage.removeItem("otto2_auth_state"); sessionStorage.removeItem("otto2_invite") } catch(e){}
    /* 把網址上的 code 清掉，重整時才不會拿失效的 code 再換一次 */
    history.replaceState(null, "", AUTH_REDIRECT);
    await authGate();
    console.log("登入成功：", j.displayName, j.userId, "名單狀態：", j.registered ? "已登記" : "尚未登記");
  } catch(e){
    authShowError("連不上登入服務", e.message);
  }
}

/* 頁面一開就先擋起來，避免資料閃一下才蓋住 */
(function(){
  function boot(){
    authLog("頁面載入（" + document.readyState + "）");
    if (!authSaved()) authShowLogin();
    authInit();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
