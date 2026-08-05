/* ══════════════════════════════════════════════════════════
   員工後台登入（LINE Login）

   流程：
   1. 開啟後台 → 沒登入過就擋一張登入畫面
   2. 按「用 LINE 登入」→ 跳到 LINE 授權頁
   3. 授權完 LINE 把人送回來，網址上帶一組一次性的 code
   4. 前端把 code 送去 Railway，Railway 用 Channel secret 換出身分
   5. 拿到身分就放行，並把結果記在 sessionStorage（關掉分頁就要重登）

   目前階段：只認人，還不擋權限。
   權限勾選與資料庫規則是下一步，做完才會真的擋得住。
   ══════════════════════════════════════════════════════════ */

var AUTH_CHANNEL_ID = "2010980574";
var AUTH_API        = "https://otto2-notify-production.up.railway.app";
var AUTH_REDIRECT   = "https://otto2tfs2000-ctrl.github.io/salary-system/";
var AUTH_KEY        = "otto2_staff_session";

var ME = null;   /* 登入後放這裡：{userId, displayName, picture, staff, registered} */

/* 這個人能不能做某個動作。key：checkout（核銷）、void（作廢）、sellPlan（賣方案）
   還沒登記在名單裡的人一律放行，否則第一次設定管理員時會把自己鎖死。
   名單裡有這個人，就照他的 acts 走。 */
function can(k){
  if (!ME) return true;
  var st = ME.staff;
  if (!st) return true;
  if (st.active === false) return false;
  if (st.role === "owner") return true;
  return Array.isArray(st.acts) && st.acts.indexOf(k) >= 0;
}

/* 用 localStorage 不用 sessionStorage：關掉分頁還記得，不用每次重登。
   存 30 天，超過就要求再登入一次。 */
var AUTH_DAYS = 30;
function authSaved(){
  try {
    var v = JSON.parse(localStorage.getItem(AUTH_KEY) || "null");
    if (!v || !v.userId) return null;
    if (v.savedAt && Date.now() - v.savedAt > AUTH_DAYS * 86400000) return null;
    return v;
  } catch(e){ return null }
}
function authStore(v){
  try {
    v.savedAt = Date.now();
    localStorage.setItem(AUTH_KEY, JSON.stringify(v));
  } catch(e){}
}
function authClear(){
  try { localStorage.removeItem(AUTH_KEY) } catch(e){}
  location.href = AUTH_REDIRECT;
}

/* 每次開頁面重抓一次自己的權限。
   這樣管理員改完設定，對方重整就生效，不用叫他登出再登入。 */
async function authRefreshStaff(){
  if (!ME || !ME.userId) return;
  try {
    var r = await fetch("https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app/staff/" +
      ME.userId + ".json");
    if (!r.ok) return;
    var st = await r.json();
    ME.staff = st || null;
    ME.registered = !!(st && st.active !== false);
    authStore(ME);
  } catch(e){}
}

/* 導去 LINE 授權頁。state 是防造假用的一次性亂數 */
function authGoLine(){
  /* 帶著邀請碼去登入，回來時才知道要建哪個帳號 */
  var iv = new URLSearchParams(location.search).get("invite");
  if (iv) { try { sessionStorage.setItem("otto2_invite", iv) } catch(e){} }
  var state = Math.random().toString(36).slice(2) + Date.now().toString(36);
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
      '用 LINE 登入</button>'
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
   這只是介面，真正擋住是資料庫規則的工作（下一步）。 */
function authApplyTabs(){
  if (!ME) return;
  var st = ME.staff;
  /* 名單裡還沒有這個人：先只留今日排課，避免什麼都看不到 */
  var allowed = (st && Array.isArray(st.tabs) && st.tabs.length) ? st.tabs : null;
  if (!allowed) return;
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

/* ── 主流程 ── */
async function authInit(){
  /* 已經登入過就直接放行 */
  var s = authSaved();
  if (s && s.userId){
    ME = s; authHideScreen(); authBadge();
    await authRefreshStaff();
    /* 權限可能剛被改過，重畫一次徽章與分頁 */
    var old = document.getElementById("auth-badge");
    if (old) old.remove();
    authBadge();
    return;
  }

  /* 從 LINE 回來，網址上會帶 code */
  var q = new URLSearchParams(location.search);
  var code = q.get("code"), state = q.get("state"), err = q.get("error");

  if (err){
    authShowLogin("上次登入沒有完成（" + err + "），再試一次。");
    return;
  }
  if (!code){
    var iv = q.get("invite");
    authShowLogin(iv ? "這是一組邀請連結。用 LINE 登入之後，帳號就會自動建立好。" : null);
    return;
  }

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
      body: JSON.stringify({ code: code, redirectUri: AUTH_REDIRECT,
        invite: (function(){ try { return sessionStorage.getItem("otto2_invite") || "" } catch(e){ return "" } })() })
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
    authHideScreen();
    authBadge();
    console.log("登入成功：", j.displayName, j.userId, "名單狀態：", j.registered ? "已登記" : "尚未登記");
  } catch(e){
    authShowError("連不上登入服務", e.message);
  }
}

/* 頁面一開就先擋起來，避免資料閃一下才蓋住 */
(function(){
  function boot(){
    if (!authSaved()) authShowLogin();
    authInit();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
