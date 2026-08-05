/* ══════════════════════════════════════════════════════════
   帳號與權限（老師設定分頁最上方）

   資料放在 otto2-2026：
   /staff/{LINE userId} = { name, role, tabs:[], active, addedAt, addedBy }
   /staffInvites/{token} = { role, name, createdAt, used, usedBy }

   做法是邀請制：你產生一組一次性連結給對方，對方用 LINE 打開、
   授權完成就自動綁定，你不需要知道任何人的 LINE ID。
   ══════════════════════════════════════════════════════════ */

var STAFF_DB  = "https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app";
var STAFF_URL = "https://otto2tfs2000-ctrl.github.io/salary-system/";

/* 分頁清單，key 要跟 index.html 的 data-tab 一致 */
var STAFF_TABS = [
  { k:"today",       n:"今日排課" },
  { k:"daily",       n:"每日填寫" },
  { k:"member",      n:"會員" },
  { k:"monthly",     n:"月報總覽" },
  { k:"consumables", n:"耗材記帳" },
  { k:"inventory",   n:"庫存盤點" },
  { k:"recipe",      n:"課程用料" },
  { k:"salary",      n:"本月薪資" },
  { k:"settings",    n:"老師設定" }
];

/* 能按的動作，跟分頁分開管。
   看得到畫面不等於能動錢——核銷扣點數、作廢退庫存、賣方案是幾萬塊入帳。 */
var STAFF_ACTS = [
  { k:"checkout", n:"核銷",   d:"扣點數、扣材料、記當日營收" },
  { k:"void",     n:"作廢核銷", d:"回補點數與材料，改動已成立的帳" },
  { k:"sellPlan", n:"賣方案",  d:"發點數給客人，金額直接進業績" }
];

var STAFF_ROLES = {
  teacher: { n:"老師",   tabs:["today","monthly","recipe"], acts:[] },
  admin:   { n:"行政／業務",
             tabs:["today","daily","member","monthly","consumables","inventory","recipe"],
             acts:["checkout","void","sellPlan"] },
  owner:   { n:"管理員", tabs:STAFF_TABS.map(function(t){ return t.k }),
             acts:STAFF_ACTS.map(function(a){ return a.k }) }
};

var stList = null, stInvites = null, stLoading = false;

function stEsc(s){ return String(s == null ? "" : s).replace(/[&<>"]/g, function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] }) }

async function stLoad(force){
  if (stLoading) return;
  if (stList && !force) return;
  stLoading = true;
  try {
    var a = await (await fetch(STAFF_DB + "/staff.json")).json() || {};
    stList = Object.keys(a).map(function(uid){
      return Object.assign({ uid: uid }, a[uid] || {});
    });
    var b = await (await fetch(STAFF_DB + "/staffInvites.json")).json() || {};
    stInvites = Object.keys(b).map(function(t){
      return Object.assign({ token: t }, b[t] || {});
    }).filter(function(i){ return !i.used });
  } catch(e){ stList = stList || []; stInvites = stInvites || []; }
  stLoading = false;
}

/* 目前登入者是不是管理員。沒有任何帳號時，先讓第一個人有辦法把自己設進去 */
function stIsOwner(){
  if (!ME || !ME.userId) return false;
  var me = (stList || []).filter(function(s){ return s.uid === ME.userId })[0];
  return !!(me && me.role === "owner" && me.active !== false);
}
function stNobodyYet(){ return !stList || !stList.length }

async function renderStaff(){
  var el = document.getElementById("staff-body");
  if (!el) return;
  if (!stList){ el.innerHTML = '<div class="empty">載入帳號中…</div>'; await stLoad(); }

  var h = '<div class="card">';
  h += '<div class="card-title">🔑 帳號與權限</div>';

  if (stNobodyYet()){
    h += '<div class="info-box">還沒有任何帳號。先把自己設成管理員，之後才能發邀請給其他人。' +
         '<div style="margin-top:10px"><button class="btn btn-gold btn-sm" onclick="stMakeMeOwner()">' +
         '把我設為管理員</button></div></div>';
  } else if (!stIsOwner()){
    h += '<div class="info-box">只有管理員能管理帳號。</div></div>';
    el.innerHTML = h;
    return;
  }

  if (!stNobodyYet()){
    h += '<table><thead><tr><th>姓名</th><th style="width:88px">身分</th>' +
         '<th>看得到的分頁</th><th style="width:150px">可執行動作</th><th style="width:60px">狀態</th>' +
         '<th style="width:150px"></th></tr></thead><tbody>';
    stList.forEach(function(s, i){
      var tabs = s.tabs || [];
      var names = STAFF_TABS.filter(function(t){ return tabs.indexOf(t.k) >= 0 })
                            .map(function(t){ return t.n });
      h += '<tr>' +
        '<td>' + stEsc(s.name || "（未命名）") +
          (ME && s.uid === ME.userId ? '<span class="muted" style="font-size:11px">（你）</span>' : '') + '</td>' +
        '<td><span class="badge ' + (s.role === "owner" ? "b-gold" : s.role === "admin" ? "b-blue" : "b-gray") + '">' +
          ((STAFF_ROLES[s.role] || {}).n || s.role || "—") + '</span></td>' +
        '<td style="font-size:12px;color:var(--text2)">' + (names.join("、") || "—") + '</td>' +
        '<td style="font-size:12px;color:var(--text2)">' +
          (STAFF_ACTS.filter(function(a){ return (s.acts||[]).indexOf(a.k) >= 0 })
                     .map(function(a){ return a.n }).join("、") || "—") + '</td>' +
        '<td>' + (s.active === false ? '<span class="badge b-red">停用</span>'
                                     : '<span class="badge b-green">啟用</span>') + '</td>' +
        '<td style="display:flex;gap:6px">' +
          '<button class="btn btn-outline btn-sm" onclick="stEdit(' + i + ')">編輯</button>' +
          (ME && s.uid === ME.userId ? '' :
            '<button class="btn btn-del btn-sm" onclick="stRemove(' + i + ')">移除</button>') +
        '</td></tr>';
    });
    h += '</tbody></table>';

    /* 邀請 */
    h += '<div style="margin-top:20px;padding-top:18px;border-top:1px solid var(--border)">';
    h += '<div style="font-size:13px;font-weight:600;color:var(--gold2);margin-bottom:12px">邀請新帳號</div>';
    h += '<div class="row" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">';
    h += '<div class="fg" style="flex:1;min-width:150px"><label>姓名</label>' +
         '<input id="st-inv-name" placeholder="例：蓁蓁"></div>';
    h += '<div class="fg" style="flex:0 0 150px"><label>身分</label><select id="st-inv-role">' +
         '<option value="teacher">老師</option><option value="admin">行政</option>' +
         '<option value="owner">管理員</option></select></div>';
    h += '<button class="btn btn-gold" onclick="stMakeInvite()">產生邀請連結</button>';
    h += '</div>';
    h += '<div class="muted" style="font-size:12px;margin-top:8px">' +
         '連結傳給對方，對方用 LINE 打開、授權完成就綁定好了。一組連結只能用一次。</div>';
    h += '<div id="st-inv-out" style="margin-top:12px"></div>';

    if (stInvites && stInvites.length){
      h += '<div style="margin-top:14px"><div class="muted" style="font-size:12px;margin-bottom:6px">' +
           '還沒被使用的邀請 ' + stInvites.length + ' 組</div>';
      stInvites.forEach(function(iv, k){
        h += '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;' +
             'border-bottom:1px solid var(--border);font-size:12.5px">' +
             '<span>' + stEsc(iv.name || "—") + '</span>' +
             '<span class="badge b-gray">' + ((STAFF_ROLES[iv.role] || {}).n || iv.role) + '</span>' +
             '<button class="btn btn-outline btn-sm" style="margin-left:auto" ' +
               'onclick="stCopyInvite(\'' + iv.token + '\')">複製連結</button>' +
             '<button class="btn btn-del btn-sm" onclick="stKillInvite(' + k + ')">作廢</button>' +
             '</div>';
      });
      h += '</div>';
    }
    h += '</div>';
  }

  h += '</div>';
  el.innerHTML = h;
}

/* ── 第一個管理員 ── */
async function stMakeMeOwner(){
  if (!ME || !ME.userId){ alert("請先登入"); return }
  if (!confirm("把「" + (ME.displayName || "你") + "」設為管理員？\n\n管理員看得到全部分頁，也能管理其他人的權限。")) return;
  await stSave(ME.userId, {
    name: ME.displayName || "管理員", role: "owner",
    tabs: STAFF_ROLES.owner.tabs, acts: STAFF_ROLES.owner.acts, active: true,
    addedAt: new Date().toISOString(), addedBy: "self"
  });
  await stLoad(1); renderStaff();
  alert("已設定完成。重新整理後權限就會生效。");
}

async function stSave(uid, obj){
  await fetch(STAFF_DB + "/staff/" + uid + ".json", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  });
}

/* ── 編輯 ── */
function stEdit(i){
  var s = stList[i]; if (!s) return;
  var tabs = s.tabs || [];
  var h = '<h3 style="margin:0 0 4px">' + stEsc(s.name || "（未命名）") + '</h3>';
  h += '<div class="muted" style="font-size:11.5px;margin-bottom:16px;word-break:break-all">' + s.uid + '</div>';
  h += '<div class="fg" style="margin-bottom:14px"><label>姓名</label>' +
       '<input id="st-e-name" value="' + stEsc(s.name || "") + '"></div>';
  h += '<div class="fg" style="margin-bottom:14px"><label>身分（換身分會套用預設分頁）</label>' +
       '<select id="st-e-role" onchange="stRoleChanged()">';
  Object.keys(STAFF_ROLES).forEach(function(k){
    h += '<option value="' + k + '"' + (s.role === k ? " selected" : "") + '>' + STAFF_ROLES[k].n + '</option>';
  });
  h += '</select></div>';
  h += '<div class="fg"><label>看得到的分頁</label><div id="st-e-tabs" style="display:grid;' +
       'grid-template-columns:repeat(2,1fr);gap:7px;margin-top:6px">';
  STAFF_TABS.forEach(function(t){
    h += '<label style="display:flex;align-items:center;gap:7px;font-size:13px;cursor:pointer">' +
         '<input type="checkbox" value="' + t.k + '"' + (tabs.indexOf(t.k) >= 0 ? " checked" : "") + '>' +
         t.n + '</label>';
  });
  h += '</div></div>';
  h += '<div class="fg" style="margin-top:16px"><label>可執行的動作</label>' +
       '<div id="st-e-acts" style="margin-top:6px">';
  STAFF_ACTS.forEach(function(a){
    h += '<label style="display:flex;align-items:flex-start;gap:8px;font-size:13px;' +
         'cursor:pointer;padding:6px 0">' +
         '<input type="checkbox" value="' + a.k + '" style="margin-top:3px"' +
         ((s.acts || []).indexOf(a.k) >= 0 ? " checked" : "") + '>' +
         '<span>' + a.n + '<span class="muted" style="display:block;font-size:11.5px">' + a.d + '</span></span>' +
         '</label>';
  });
  h += '</div></div>';
  h += '<label style="display:flex;align-items:center;gap:7px;font-size:13px;margin-top:16px;cursor:pointer">' +
       '<input type="checkbox" id="st-e-active"' + (s.active !== false ? " checked" : "") + '>啟用這個帳號</label>';
  h += '<div class="row" style="margin-top:20px;display:flex;gap:8px">' +
       '<button class="btn btn-outline" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="margin-left:auto" onclick="stSaveEdit(' + i + ')">儲存</button></div>';
  mbModal(h);
}

/* 換身分時，分頁勾選跟著跳到該身分的預設值 */
function stRoleChanged(){
  var r = document.getElementById("st-e-role").value;
  var def = (STAFF_ROLES[r] || {}).tabs || [];
  document.querySelectorAll("#st-e-tabs input").forEach(function(c){
    c.checked = def.indexOf(c.value) >= 0;
  });
  var da = (STAFF_ROLES[r] || {}).acts || [];
  document.querySelectorAll("#st-e-acts input").forEach(function(c){
    c.checked = da.indexOf(c.value) >= 0;
  });
}

async function stSaveEdit(i){
  var s = stList[i]; if (!s) return;
  var tabs = [], acts = [];
  document.querySelectorAll("#st-e-tabs input:checked").forEach(function(c){ tabs.push(c.value) });
  document.querySelectorAll("#st-e-acts input:checked").forEach(function(c){ acts.push(c.value) });
  var obj = Object.assign({}, s, {
    name: document.getElementById("st-e-name").value.trim() || s.name || "",
    role: document.getElementById("st-e-role").value,
    tabs: tabs,
    acts: acts,
    active: document.getElementById("st-e-active").checked
  });
  delete obj.uid;
  /* 不讓自己把自己鎖在外面 */
  if (ME && s.uid === ME.userId && (obj.role !== "owner" || !obj.active)){
    if (!confirm("你正在調降自己的權限。\n儲存後可能就進不了這一頁了，確定嗎？")) return;
  }
  await stSave(s.uid, obj);
  mbClose(); await stLoad(1); renderStaff();
}

async function stRemove(i){
  var s = stList[i]; if (!s) return;
  if (!confirm("移除「" + (s.name || s.uid) + "」的帳號？\n\n對方下次開後台就會被擋在登入畫面外。\n之後要再給權限，重發一次邀請即可。")) return;
  await fetch(STAFF_DB + "/staff/" + s.uid + ".json", { method: "DELETE" });
  await stLoad(1); renderStaff();
}

/* ── 邀請 ── */
/* openExternalBrowser=1 是 LINE 專用參數：
   從 LINE 對話點連結時，強制用手機的預設瀏覽器開，不要用 LINE 內建瀏覽器。
   LINE 內建瀏覽器跑不了 LINE Login，會直接報「無法正常執行」。 */
function stInviteLink(token){
  return STAFF_URL + "?invite=" + token + "&openExternalBrowser=1";
}
function stToken(){
  return "iv" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
async function stMakeInvite(){
  var name = document.getElementById("st-inv-name").value.trim();
  var role = document.getElementById("st-inv-role").value;
  if (!name){ alert("請先填姓名，之後名單才看得懂是誰"); return }
  var token = stToken();
  await fetch(STAFF_DB + "/staffInvites/" + token + ".json", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, role: role, tabs: (STAFF_ROLES[role] || {}).tabs || [],
      acts: (STAFF_ROLES[role] || {}).acts || [],
      createdAt: new Date().toISOString(), used: false,
      createdBy: (ME && ME.displayName) || "" })
  });
  var link = stInviteLink(token);
  document.getElementById("st-inv-out").innerHTML =
    '<div class="info-box" style="margin:0"><div style="font-size:12px;margin-bottom:8px">' +
    '給 ' + stEsc(name) + ' 的連結（只能用一次）</div>' +
    '<div style="background:#fff;border:1px solid var(--border);border-radius:7px;padding:9px 11px;' +
    'font-size:12px;word-break:break-all;margin-bottom:9px">' + link + '</div>' +
    '<button class="btn btn-gold btn-sm" onclick="stCopy(\'' + link + '\')">複製連結</button></div>';
  document.getElementById("st-inv-name").value = "";
  await stLoad(1);
}
function stCopy(txt){
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ alert("已複製，貼給對方即可") },
      function(){ prompt("手動複製：", txt) });
  } else prompt("手動複製：", txt);
}
function stCopyInvite(token){ stCopy(stInviteLink(token)) }
async function stKillInvite(k){
  var iv = stInvites[k]; if (!iv) return;
  if (!confirm("作廢給「" + (iv.name || "—") + "」的邀請連結？")) return;
  await fetch(STAFF_DB + "/staffInvites/" + iv.token + ".json", { method: "DELETE" });
  await stLoad(1); renderStaff();
}


/* ── 保險：自己盯著這一頁 ─────────────────────────────
   不依賴 app.js 的分頁切換，也不依賴點擊事件——
   直接每半秒看一次「老師設定是不是打開著、卡片是不是空的」，
   是的話就畫。畫完就停手，不會一直重畫。 */
(function(){
  var drawnFor = null;
  function tick(){
    var p = document.getElementById("tab-settings");
    var box = document.getElementById("staff-body");
    if (!p || !box) return;
    var on = p.classList.contains("active");
    if (!on){ drawnFor = null; return }
    if (drawnFor === "on" && box.innerHTML.trim()) return;
    drawnFor = "on";
    try { renderStaff() } catch(e){ console.log("renderStaff 失敗", e) }
  }
  setInterval(tick, 500);
  setTimeout(tick, 200);
})();
