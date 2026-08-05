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

function authSaved(){
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || "null") } catch(e){ return null }
}
function authStore(v){
  try { sessionStorage.setItem(AUTH_KEY, JSON.stringify(v)) } catch(e){}
}
function authClear(){
  try { sessionStorage.removeItem(AUTH_KEY) } catch(e){}
  location.href = AUTH_REDIRECT;
}

/* 導去 LINE 授權頁。state 是防造假用的一次性亂數 */
function authGoLine(){
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

/* 登入成功後在右上角顯示是誰 */
function authBadge(){
  if (!ME) return;
  var bar = document.querySelector(".topbar > div:last-child");
  if (!bar || document.getElementById("auth-badge")) return;
  var el = document.createElement("div");
  el.id = "auth-badge";
  el.style.cssText = "display:flex;align-items:center;gap:8px;font-size:12px;color:#6b665e";
  el.innerHTML =
    (ME.picture ? '<img src="' + ME.picture + '" style="width:24px;height:24px;border-radius:50%;object-fit:cover">' : '') +
    '<span>' + (ME.displayName || "已登入") + '</span>' +
    '<span onclick="authClear()" style="cursor:pointer;color:#948e83;text-decoration:underline">登出</span>';
  bar.insertBefore(el, bar.firstChild);
}

/* ── 主流程 ── */
async function authInit(){
  /* 已經登入過就直接放行 */
  var s = authSaved();
  if (s && s.userId){ ME = s; authHideScreen(); authBadge(); return }

  /* 從 LINE 回來，網址上會帶 code */
  var q = new URLSearchParams(location.search);
  var code = q.get("code"), state = q.get("state"), err = q.get("error");

  if (err){
    authShowLogin("上次登入沒有完成（" + err + "），再試一次。");
    return;
  }
  if (!code){ authShowLogin(); return }

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
      body: JSON.stringify({ code: code, redirectUri: AUTH_REDIRECT })
    });
    var j = await r.json();
    if (!j.ok){
      authShowError("登入失敗", (j.error || "") + (j.detail ? "<br>" + j.detail : ""));
      return;
    }
    ME = j;
    authStore(j);
    try { sessionStorage.removeItem("otto2_auth_state") } catch(e){}
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
