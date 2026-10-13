/* ══════════════════════════════════════════════════════════
   📚 課程管理（2026-10-13，第一階段：只整理、只核對，不連動）

   目標：把「課程／價格（優惠價、原價、早鳥價）／用料」放在同一個畫面管理，
   之後預約頁、會員扣點、LINE 預約、核銷都改讀這一份，不再各讀各的。

   加購（2026-10-13）：courseCatalog/addons/{id} = { course 課程名稱, spec 規格（空＝這門課所有規格）, name 加購名稱, price, unit fixed|hour（固定金額／每小時）, sort, on }。
   對應試算表「加購」分頁；在課程編輯視窗裡管理。用「課程名稱＋規格」對應課程列（規格留空＝每個規格都有）。

   第一階段的鐵則（大熊要求）：先不動會員預約和扣課系統。
   ・這裡的資料是從試算表「課程」分頁「複製」過來的，試算表完全不動，預約系統現在還是讀試算表。
   ・資料放 otto2-2026 的 courseCatalog/（跟 shipments 一樣，在 salaryData 外面）。
     不放進 salaryData，是因為 salaryData 會被整包覆蓋，過去發生過資料消失。
   ・每一列單獨寫入，不整包覆蓋；寫入前會檢查這一筆有沒有被別人改過。
   ・每次新增／修改／刪除都留紀錄在 courseCatalogLog/（含改之前的內容，救得回來）。
   ・第一次匯入時，會把試算表當下的原樣完整存一份在 courseCatalogSnap/ 當備份。
   ・用料（S.recipes）只「讀」不「寫」，用「課程名|規格」對應，跟課程用料分頁同一條規則。

   資料欄位（courseCatalog/rows/{id}）：
   cat 分類／name 課程名稱／spec 規格／desc 說明／dur 時長／price 試算表原本的價格（舊價格，只當對照，不在畫面上編輯）／
   pOrig 原價（單次、或來很多次的非會員；課程卡片先顯示）／pMember 會員價（一般活動課的「優惠價」也填這格）／pFirst 初次體驗價（選填，第一次來上這門課的客人；沒填就跟會員價一樣）／
   early 早鳥價＋earlyUntil 早鳥截止（含當天，YYYY-MM-DD，所有人）／
   pair 兩人價／img 圖片網址／on 上架／sort 排序／minAge 最小年齡／multi 可加堂／addon 可加購／
   seats 佔位／hourly 計時／ord 試算表原本的先後／src sheet 或 new／updatedAt／updatedBy
   ══════════════════════════════════════════════════════════ */

var CAT_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app';
var CAT_SHEET_ID = '1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M';
var catRows = null, catMeta = null, catSheet = null, catAddons = null, catAddonSheet = null, catAddonEdit = null;
var catFilter = '', catCatFilter = '', catOnFilter = '', catView = 'list', catEdit = null, catBusy = false;
/* 分類收合狀態：記在這台電腦的瀏覽器裡（只是畫面偏好，不進資料庫） */
var catClosed = {};
try { catClosed = JSON.parse(localStorage.getItem('catClosed') || '{}') || {} } catch (e) { catClosed = {} }
function catSaveClosed(){ try { localStorage.setItem('catClosed', JSON.stringify(catClosed)) } catch (e) {} }
function catToggleCat(enc){
  var c = decodeURIComponent(enc);
  if (catClosed[c]) delete catClosed[c]; else catClosed[c] = 1;
  catSaveClosed(); renderCatalog();
}
function catFoldAll(close){
  catClosed = {};
  if (close) catRows.forEach(function(r){ catClosed[r.cat || ''] = 1 });
  catSaveClosed(); renderCatalog();
}

/* 比對試算表時看的欄位（欄位代號, 顯示名稱） */
var CAT_CMP = [['cat', '分類'], ['desc', '說明'], ['dur', '時長'], ['price', '試算表價格'], ['img', '圖片'], ['on', '上架'],
  ['sort', '排序'], ['minAge', '最小年齡'], ['multi', '可加堂'], ['addon', '可加購'], ['seats', '佔位'],
  ['hourly', '計時'], ['pair', '兩人價'], ['early', '早鳥價'], ['earlyUntil', '早鳥截止']];

function catEsc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] });
}
function catNum(v){ var m = String(v == null ? '' : v).replace(/[^\d.]/g, ''); return m ? Math.round(parseFloat(m)) : 0 }
function catStr(v){ return String(v == null ? '' : v).trim() }
function catKey(r){ var sp = catStr(r.spec); return catStr(r.name) + (sp ? '|' + sp : '') }   /* 跟 recipe.js 的 rcKey 同一條 */
/* 規格欄寫的是價格別（體驗價／會員價／單次原價）的列：一門課拆成好幾列、各收各的價，不適用「原價＋優惠價」 */
function catIsTier(r){ return /體驗價|會員價|單次原價|優惠價|原價/.test(String(r.spec || '')) }
/* 選圖繪畫、創作繪畫、邏輯素描：一門課拆成「體驗價／會員價／單次原價」三列（用料是掛在這三列上，不能動）。
   新的三個價格（原價／初次體驗價／會員價）統一填在「單次原價」那一列（base），另外兩列只是舊的價格別列（legacy） */
function catIsBase(r){ return catIsTier(r) && /單次原價/.test(String(r.spec || '')) }
function catIsLegacy(r){ return catIsTier(r) && !catIsBase(r) }
function catTierRows(r){
  var same = catRows.filter(function(x){ return x.name === r.name && catIsTier(x) });
  return { base: same.find(catIsBase) || null, first: same.find(function(x){ return /體驗價/.test(x.spec) }) || null, member: same.find(function(x){ return /會員價/.test(x.spec) }) || null };
}
function catToday(){ return new Date(Date.now() + 288e5).toISOString().slice(0, 10) }
function catMd(d){ return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '' }
function catBy(){
  try { var m = window.ME || {}; return (m.staff && (m.staff.name || m.staff.displayName)) || m.displayName || '' } catch (e) { return '' }
}
/* 日期寫法都收：2026/10/20、2026-10-20、2026年10月20日、10/20（算今年）、Date(2026,9,20) */
function catDay(raw){
  var t = String(raw == null ? '' : raw).trim(), ty = catToday(), m;
  if ((m = t.match(/(\d{4})\s*[\/\-.年]\s*(\d{1,2})\s*[\/\-.月]\s*(\d{1,2})/))) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = t.match(/Date\((\d{4}),(\d{1,2}),(\d{1,2})\)/))) return m[1] + '-' + ('0' + (+m[2] + 1)).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  if ((m = t.match(/^(\d{1,2})\s*[\/\-.]\s*(\d{1,2})$/))) return ty.slice(0, 4) + '-' + ('0' + m[1]).slice(-2) + '-' + ('0' + m[2]).slice(-2);
  return '';
}

/* ── 資料庫（只碰 courseCatalog／courseCatalogSnap／courseCatalogLog 三個位置）── */
async function catFb(method, path, body){
  var o = { method: method };
  if (body !== undefined) { o.headers = { 'Content-Type': 'application/json' }; o.body = JSON.stringify(body) }
  var r = await fetch(CAT_URL + path + '.json', o);
  if (!r.ok) throw new Error('資料庫回應 ' + r.status);
  try { return await r.json() } catch (e) { return null }
}
async function catLog(act, row, before, after){
  try {
    await catFb('POST', '/courseCatalogLog', { at: new Date().toISOString(), by: catBy(), act: act,
      id: row.id || '', name: row.name || '', spec: row.spec || '', before: before || null, after: after || null });
  } catch (e) { console.warn('課程紀錄寫入失敗', e) }
}
async function catLoad(){
  var d = await catFb('GET', '/courseCatalog');
  catMeta = (d && d.meta) || null;
  catAddons = Object.keys((d && d.addons) || {}).map(function(k){ var a = d.addons[k]; a.id = a.id || k; return a });
  catRows = Object.keys((d && d.rows) || {}).map(function(k){ var r = d.rows[k]; r.id = r.id || k; return r });
  catSortRows();
}
function catSortRows(){
  var ord = {};
  catRows.forEach(function(r){ var c = r.cat || '', o = +r.ord || 0; if (ord[c] === undefined || o < ord[c]) ord[c] = o });
  catRows.sort(function(a, b){
    var x = ord[a.cat || ''], y = ord[b.cat || ''];
    if (x !== y) return x - y;
    if ((a.cat || '') !== (b.cat || '')) return String(a.cat).localeCompare(String(b.cat), 'zh-Hant');
    return ((+a.sort || 99) - (+b.sort || 99)) || ((+a.ord || 0) - (+b.ord || 0));
  });
}

/* ── 讀試算表（只讀）── */
async function catReadSheet(){
  var url = 'https://docs.google.com/spreadsheets/d/' + CAT_SHEET_ID + '/gviz/tq?sheet=' + encodeURIComponent('課程') + '&tqx=out:json';
  var t = await (await fetch(url)).text();
  var j = JSON.parse(t.substring(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (!j.table) throw new Error('讀不到試算表「課程」分頁');
  var clean = function(x){ return String(x == null ? '' : x).replace(/\s/g, '') };
  var head = (j.table.cols || []).map(function(c){ return clean(c && (c.label || c.id)) });
  var rows = j.table.rows.map(function(r){ return (r.c || []).map(function(c){ return c ? (c.f == null ? c.v : c.f) : '' }) });
  /* gviz 認不出標題列的時候，標題會在第一列 */
  if (head.indexOf('分類') < 0 && rows.length && clean(rows[0][0]) === '分類') head = rows.shift().map(clean);
  var ix = function(n, fb){ var i = head.indexOf(n); return i >= 0 ? i : fb };
  var I = { cat: ix('分類', 0), name: ix('課程名稱', 1), desc: ix('說明', 2), spec: ix('規格', 3), dur: ix('時長', 4),
    price: ix('價格', 5), img: ix('圖片網址', 6), on: ix('上架', 7), sort: ix('排序', 8), minAge: ix('最小年齡', 9),
    multi: ix('可加堂', 10), addon: ix('可加購', 11), seats: ix('佔位', -1), hourly: ix('計時', -1),
    pair: ix('兩人價', -1), early: ix('早鳥價', -1), until: ix('早鳥截止', -1) };
  var g = function(r, i){ return i >= 0 && r[i] != null ? r[i] : '' };
  var out = [];
  rows.forEach(function(r, n){
    var name = catStr(g(r, I.name));
    if (!name) return;
    var on = catStr(g(r, I.on));
    out.push({ cat: catStr(g(r, I.cat)), name: name, desc: catStr(g(r, I.desc)), spec: catStr(g(r, I.spec)),
      dur: catStr(g(r, I.dur)), price: catNum(g(r, I.price)), img: catStr(g(r, I.img)),
      on: on.toUpperCase() !== 'N', sort: parseInt(g(r, I.sort), 10) || 99, minAge: parseInt(g(r, I.minAge), 10) || 0,
      multi: catStr(g(r, I.multi)).toUpperCase() === 'Y', addon: catStr(g(r, I.addon)),
      seats: catNum(g(r, I.seats)), hourly: catNum(g(r, I.hourly)), pair: catNum(g(r, I.pair)),
      early: catNum(g(r, I.early)), earlyUntil: catDay(g(r, I.until)), _n: n });
  });
  /* 試算表有沒有「早鳥價」「早鳥截止」兩欄：沒有的話，比對時不看早鳥（不然這裡填的早鳥會被誤報成差異） */
  out.hasEarly = I.early >= 0 && I.until >= 0;
  return out;
}
function catFromSheet(s, id, ord){
  var r = { id: id, cat: s.cat, name: s.name, spec: s.spec, desc: s.desc, dur: s.dur, price: s.price,
    pMember: 0, pFirst: 0, pOrig: 0, early: s.early, earlyUntil: s.earlyUntil, pair: s.pair, img: s.img, on: s.on,
    sort: s.sort, minAge: s.minAge, multi: s.multi, addon: s.addon, seats: s.seats, hourly: s.hourly,
    ord: ord, src: 'sheet', updatedAt: new Date().toISOString(), updatedBy: catBy() };
  return r;
}

/* ── 用料（只讀 S.recipes）── */
function catRecipeCount(r){
  try {
    var x = (typeof S !== 'undefined' && S.recipes) ? S.recipes[catKey(r)] : null;
    return x && x.items ? x.items.length : 0;
  } catch (e) { return 0 }
}
function catGoRecipe(id){
  var r = catRows.find(function(x){ return x.id === id }); if (!r) return;
  if (typeof rcFilter !== 'undefined') rcFilter = r.name;
  switchTab('recipe');
}

/* ── 畫面 ── */
async function renderCatalog(){
  var el = document.getElementById('catalog-body'); if (!el) return;
  if (!catRows) {
    el.innerHTML = '<div class="empty">載入課程中…</div>';
    try { await catLoad() } catch (e) { el.innerHTML = '<div class="empty">讀不到課程資料：' + catEsc(e.message) + '</div>'; return }
  }
  el.innerHTML = catHtml();
}
function catBanner(){
  return '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13.5px;line-height:1.8;margin-bottom:12px">' +
    '🧪 <b>第一階段・整理與核對用</b><br>這裡的課程是從試算表「複製」過來的。<b>改這裡不會影響</b>預約頁、會員扣點、LINE 預約和核銷，' +
    '那些現在都還是讀試算表。等你確認這裡的資料都對、跟課程用料也對得上，才會一起切換過來。</div>';
}
function catHtml(){
  var h = catBanner();
  if (!catRows.length) {
    return h + '<div class="card"><div class="card-title">還沒有課程資料</div>' +
      '<div class="muted" style="font-size:13.5px;line-height:1.8;margin-bottom:12px">按下面的按鈕，會把試算表「課程」分頁目前的每一列複製進來。' +
      '試算表本身不會被改動，匯入前也會先把試算表原樣備份一份。</div>' +
      '<button class="btn btn-gold" onclick="catImportAll()">從試算表匯入全部課程</button></div>';
  }
  var on = catRows.filter(function(r){ return r.on !== false }).length;
  h += '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">課程管理' +
    '<span class="muted" style="font-size:12.5px;font-weight:400">共 ' + catRows.length + ' 列・上架 ' + on + ' 列</span>' +
    '<span style="flex:1"></span>' +
    '<button class="btn ' + (catView === 'list' ? 'btn-gold' : 'btn-outline') + ' btn-sm" onclick="catView=\'list\';renderCatalog()">課程清單</button>' +
    '<button class="btn ' + (catView === 'check' ? 'btn-gold' : 'btn-outline') + ' btn-sm" onclick="catShowCheck()">🔍 核對報告</button>' +
    '<button class="btn btn-outline btn-sm" onclick="catCsv()">⬇ 備份 CSV</button>' +
    '<button class="btn btn-outline btn-sm" onclick="catRows=null;catSheet=null;catAddonSheet=null;renderCatalog()">↻ 重新讀取</button>' +
    '<button class="btn btn-gold btn-sm" onclick="catNew()">＋ 新增課程</button></div>';
  if (catView !== 'check' && (!catAddons || !catAddons.length)) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13.5px;line-height:1.8;margin:8px 0">' +
    '加購項目（試算表「加購」分頁）還沒有複製進來，所以課程的編輯視窗裡看不到加購。<button class="btn btn-gold btn-sm" style="margin-left:8px" onclick="catImportAddons()">從試算表複製加購</button></div>';
  h += catView === 'check' ? catCheckHtml() : catListHtml();
  return h + '</div>';
}
function catEarlyState(r){
  if (!r.early) return '<span class="muted">—</span>';
  var t = catToday();
  if (!r.earlyUntil) return '<span style="color:var(--red)">$' + r.early.toLocaleString() + '<br>缺截止日</span>';
  if (t <= r.earlyUntil) return '<span style="color:#2e7d4f">$' + r.early.toLocaleString() + '<br><span style="font-size:12px">至 ' + catMd(r.earlyUntil) + '</span></span>';
  return '<span class="muted">$' + r.early.toLocaleString() + '<br><span style="font-size:12px">' + catMd(r.earlyUntil) + ' 已過期</span></span>';
}
function catListHtml(){
  var cats = [];
  catRows.forEach(function(r){ if (cats.indexOf(r.cat) < 0) cats.push(r.cat) });
  var h = '<div class="row" style="margin:6px 0 10px;gap:8px;flex-wrap:wrap">' +
    '<input id="cat-search" placeholder="搜尋課程名稱／規格／分類" value="' + catEsc(catFilter) + '" style="flex:1 1 220px;min-width:180px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px">' +
    '<select id="cat-cat" style="max-width:200px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px"><option value="">全部分類</option>' + cats.map(function(c){
      return '<option value="' + catEsc(c) + '"' + (catCatFilter === c ? ' selected' : '') + '>' + catEsc(c || '（沒分類）') + '</option>' }).join('') + '</select>' +
    '<select id="cat-on" style="max-width:130px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px"><option value="">上架＋下架</option><option value="1"' + (catOnFilter === '1' ? ' selected' : '') + '>只看上架</option>' +
    '<option value="0"' + (catOnFilter === '0' ? ' selected' : '') + '>只看下架</option></select>' +
    '<button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="catFoldAll(true)">全部收起</button>' +
    '<button class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="catFoldAll(false)">全部展開</button>' +
    '<button class="btn btn-outline btn-sm" style="white-space:nowrap" title="把還沒填的價格先帶入試算表原本的價格（只填空格，已經填過的不會動）" onclick="catFillAllOrig()">價格先帶入試算表</button></div>';
  var list = catRows.filter(function(r){
    if (catCatFilter && r.cat !== catCatFilter) return false;
    if (catOnFilter === '1' && r.on === false) return false;
    if (catOnFilter === '0' && r.on !== false) return false;
    if (catFilter && (r.name + r.spec + r.cat).indexOf(catFilter) < 0) return false;
    return true;
  });
  var elig = catRows.filter(function(r){ return !catIsLegacy(r) }), done = elig.filter(function(r){ return r.pOrig > 0 }).length;
  var legN = catRows.length - elig.length;
  h += '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:8px">' +
    '<b>原價</b>：單次、或來很多次的非會員付的價格，也是課程卡片先顯示的價格。<b>會員價（優惠價）</b>：會員付的價格；一般活動課的「優惠價」也填這格，第一次來的客人同樣適用。' +
    '<b>初次體驗價</b>（選填）：第一次來上這門課的客人付的價格，繪畫課這類體驗價和會員價不同的才填，沒填就跟會員價一樣。<b>早鳥價</b>：特定課程的限時價，所有人都適用，到截止日自動結束。<br>' +
    '這些價格現在還沒有任何系統在用，可以慢慢填。灰色小字是試算表原本的價格，預約頁現在還是收那個。<br>' +
    '已填原價 <b>' + done + '</b> / ' + elig.length + ' 列' + (legN ? '（選圖繪畫、創作繪畫、邏輯素描的「體驗價」「會員價」兩列，共 ' + legN + ' 列，只是舊的價格別列，這三門課的價格填在「單次原價」那一列）' : '') + '</div>';
  h += '<div style="overflow-x:auto"><table><thead><tr><th>課程</th><th style="width:80px">原價</th><th style="width:96px">會員價<br><span style="font-weight:400;font-size:11px">（優惠價）</span></th><th style="width:84px">初次體驗價</th>' +
    '<th style="width:96px">早鳥價</th><th style="width:56px">上架</th><th style="width:66px">加購</th><th style="width:76px">用料</th><th style="width:76px"></th></tr></thead><tbody>';
  var last = null, cnt = {};
  list.forEach(function(r){ cnt[r.cat || ''] = (cnt[r.cat || ''] || 0) + 1 });
  list.forEach(function(r){
    /* 有在搜尋的時候一律展開，不然搜到的東西會藏在收起來的分類裡 */
    var closed = !!catClosed[r.cat || ''] && !catFilter;
    if (r.cat !== last) {
      last = r.cat;
      h += '<tr style="cursor:pointer" onclick="catToggleCat(\'' + encodeURIComponent(r.cat || '') + '\')"><td colspan="9" style="background:var(--bg2,#f6f1e7);font-weight:600;font-size:13.5px;user-select:none">' +
        '<span style="display:inline-block;width:18px;color:var(--gold2)">' + (closed ? '▶' : '▼') + '</span>' + catEsc(r.cat || '（沒分類）') +
        ' <span class="muted" style="font-weight:400;font-size:12.5px">' + cnt[r.cat || ''] + ' 列</span></td></tr>';
    }
    if (closed) return;
    var n = catRecipeCount(r), off = r.on === false;
    h += '<tr' + (off ? ' style="opacity:.55"' : '') + '><td>' + catEsc(r.name) + (r.spec ? '<span class="muted" style="font-size:13px">（' + catEsc(r.spec) + '）</span>' : '') +
      (r.src === 'new' ? ' <span style="font-size:11px;color:#b07a1f">新增</span>' : '') + '</td>' +
      (catIsLegacy(r) ? '<td colspan="4" class="muted" style="font-size:12px">舊的價格別列（試算表 ' + (r.price ? r.price.toLocaleString() : '—') + '）・價格請看「單次原價」那一列</td>' :
      '<td style="text-align:right">' + (r.pOrig ? r.pOrig.toLocaleString() :
        (r.price ? '<span class="muted" style="font-size:12px" title="試算表原本的價格，預約頁現在還是收這個">試算表 ' + r.price.toLocaleString() + '</span>' : '<span class="muted">—</span>')) + '</td>' +
      '<td style="text-align:right">' + (r.pMember ? r.pMember.toLocaleString() : '<span class="muted">—</span>') + '</td>' +
      '<td style="text-align:right">' + (r.pFirst ? r.pFirst.toLocaleString() : '<span class="muted">—</span>') + '</td>' +
      '<td style="text-align:right;font-size:13px">' + catEarlyState(r) + '</td>') +
      '<td style="text-align:center">' + (off ? '<span class="muted">下架</span>' : '✓') + '</td>' +
      '<td>' + (catAddonsFor(r).length ? '<button class="btn-sm" style="white-space:nowrap" title="打開編輯視窗看加購項目" onclick="catOpen(\'' + r.id + '\')">' + catAddonsFor(r).length + ' 項</button>' : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (n ? '<button class="btn-sm" style="white-space:nowrap" onclick="catGoRecipe(\'' + r.id + '\')">' + n + ' 項</button>' : '<span class="muted">—</span>') + '</td>' +
      '<td><button class="btn-sm" style="white-space:nowrap" onclick="catOpen(\'' + r.id + '\')">編輯</button></td></tr>';
  });
  h += '</tbody></table></div>';
  if (!list.length) h += '<div class="empty">找不到符合的課程</div>';
  /* 搜尋框重畫後要接回去，不然每打一個字就掉焦點 */
  setTimeout(function(){
    var sb = document.getElementById('cat-search');
    if (sb) { sb.oninput = function(){ catFilter = this.value.trim(); var pos = this.selectionStart; renderCatalog(); setTimeout(function(){ var s2 = document.getElementById('cat-search'); if (s2) { s2.focus(); try { s2.setSelectionRange(pos, pos) } catch (e) {} } }, 0) } }
    var c1 = document.getElementById('cat-cat'); if (c1) c1.onchange = function(){ catCatFilter = this.value; renderCatalog() };
    var c2 = document.getElementById('cat-on'); if (c2) c2.onchange = function(){ catOnFilter = this.value; renderCatalog() };
  }, 0);
  return h;
}

/* ── 編輯 ── */
function catNew(){
  var mx = 0; catRows.forEach(function(r){ if ((+r.ord || 0) > mx) mx = +r.ord });
  catEdit = { id: 'n' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), _new: true, orig: null,
    row: { cat: catCatFilter || '', name: '', spec: '', desc: '', dur: '', price: 0, pMember: 0, pFirst: 0, pOrig: 0, early: 0, earlyUntil: '',
      pair: 0, img: '', on: true, sort: 99, minAge: 0, multi: false, addon: '', seats: 0, hourly: 0 }, ord: mx + 10 };
  catDrawModal();
}
function catOpen(id){
  var r = catRows.find(function(x){ return x.id === id }); if (!r) return;
  catEdit = { id: id, _new: false, orig: JSON.parse(JSON.stringify(r)), row: JSON.parse(JSON.stringify(r)) };
  catDrawModal();
}
function catCloseModal(){ document.getElementById('cat-modal').style.display = 'none'; catEdit = null }
function catFld(lb, inner, tip){
  return '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:9px;flex-wrap:wrap"><label style="width:104px;color:var(--text2);font-size:13.5px;padding-top:7px">' + lb +
    '</label><div style="flex:1 1 240px">' + inner + (tip ? '<div class="muted" style="font-size:12px;margin-top:3px">' + tip + '</div>' : '') + '</div></div>';
}
function catIn(id, v, type, w, ro, ph){
  return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + catEsc(v == null ? '' : v) + '"' + (ro ? ' readonly style="background:#eee;' : ' style="') +
    'width:' + (w || 260) + 'px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px"' +
    (type === 'number' ? ' min="0" step="1" onwheel="this.blur()"' : '') + (ph ? ' placeholder="' + catEsc(ph) + '"' : '') + '>';
}
function catCatSel(){
  var sel = document.getElementById('cf-catsel'), inp = document.getElementById('cf-cat');
  if (sel && inp) { inp.style.display = sel.value === '__new__' ? 'block' : 'none'; if (sel.value === '__new__') inp.focus() }
}
function catDrawModal(){
  var e = catEdit, r = e.row, locked = !e._new && catRecipeCount(e.orig) > 0;
  var cats = []; catRows.forEach(function(x){ if (cats.indexOf(x.cat) < 0) cats.push(x.cat) });
  var kind = !e._new && catIsLegacy(r) ? 'legacy' : !e._new && catIsBase(r) ? 'base' : 'normal';
  var sty = 'padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px';
  var h = '<h3 style="margin:0 0 4px">' + (e._new ? '新增課程' : catEsc(r.name) + (r.spec ? '（' + catEsc(r.spec) + '）' : '')) + '</h3>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:12px">第一階段：存在這裡不會影響預約頁和扣點。</div>';
  h += catFld('分類', '<select id="cf-catsel" onchange="catCatSel()" style="' + sty + ';min-width:220px">' +
    (!r.cat ? '<option value="" selected disabled>請選擇分類…</option>' : '') +
    cats.map(function(c){ return '<option value="' + catEsc(c) + '"' + (c === r.cat ? ' selected' : '') + '>' + catEsc(c || '（沒分類）') + '</option>' }).join('') +
    '<option value="__new__">＋ 新增分類…</option></select>' +
    '<input id="cf-cat" type="text" placeholder="輸入新的分類名稱" style="display:none;margin-top:6px;width:240px;max-width:100%;' + sty + '">',
    '從現有的大項目選；要新開一個大項目，選最下面的「＋ 新增分類」');
  h += catFld('課程名稱', catIn('cf-name', r.name, 'text', 300, locked), locked ? '這門課已經建了用料，名稱和規格先鎖住（改了會跟用料對不上）。需要改請先跟我說。' : '');
  h += catFld('規格', catIn('cf-spec', r.spec, 'text', 300, locked), '同一門課分不同「價格別」或「尺寸」時才填，例如：體驗價／會員價／單次原價，或 A5透明框、30x30cm畫布。只有一種就留空');
  h += catFld('說明', '<textarea id="cf-desc" rows="2" style="width:300px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:inherit">' + catEsc(r.desc) + '</textarea>');
  h += catFld('時長', catIn('cf-dur', r.dur, 'text', 160, false, '例：2-2.5小時'));
  h += '<div style="border-top:1px solid var(--border);margin:12px 0 10px;padding-top:10px;font-size:13.5px;font-weight:600">價格</div>';
  var oldLine = !e._new ? '<div class="muted" style="font-size:12.5px;margin-bottom:6px">試算表原本的價格（舊價格，只當對照）：<b>' + (r.price ? 'NT$' + r.price.toLocaleString() : '—') + '</b>　預約頁現在還是收這個。</div>' : '';
  if (kind === 'legacy') {
    h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;line-height:1.8;margin-bottom:10px">這一列（' + catEsc(r.spec) + '）是舊的價格別列，只是為了對應「課程用料」才留著。<br>' +
      '<b>「' + catEsc(r.name) + '」的三個價格（原價／初次體驗價／會員價）請填在「單次原價」那一列。</b>' +
      (catTierRows(r).base ? '<br><button type="button" class="btn btn-gold btn-sm" style="margin-top:8px" onclick="catOpen(\'' + catTierRows(r).base.id + '\')">前往「單次原價」那一列編輯價格</button>' : '') + '</div>' + oldLine;
  } else {
    if (kind === 'base') h += '<div class="card" style="background:#eef7f0;border-color:#b9dcc4;font-size:13px;line-height:1.8;margin-bottom:10px">「' + catEsc(r.name) + '」的三個價格都填在這一列：原價、初次體驗價、會員價。' +
      '另外「體驗價」「會員價」那兩列是舊的價格別列，先留著對應用料，不用填。<br><button type="button" class="btn btn-outline btn-sm" style="margin-top:6px" onclick="catFillTier()">從試算表原本三列的價格帶入</button></div>';
    h += catFld('原價', catIn('cf-po', r.pOrig || '', 'number', 120) +
      (kind === 'normal' && r.price > 0 ? ' <button type="button" class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="catFillOrig()">帶入試算表價格 ' + r.price.toLocaleString() + '</button>' : ''),
      '單次、或來很多次的非會員，付這個價。課程卡片上也是先顯示這個價格。');
    h += catFld('會員價（優惠價）', catIn('cf-pm', r.pMember || '', 'number', 120), '會員付這個價。一般活動課的「優惠價」也填這裡（第一次來的客人也適用）。留空＝沒有優惠，大家都付原價。');
    h += catFld('初次體驗價', catIn('cf-pf', r.pFirst || '', 'number', 120), '選填。第一次來上這門課的客人付這個價（例如繪畫體驗課）。留空＝第一次來的客人跟會員付一樣的價（會員價／優惠價）。');
    h += '<div style="margin:12px 0 8px;font-size:13px;color:var(--text2)">早鳥活動（選填，只有特定課程才填）</div>';
    h += catFld('早鳥價', catIn('cf-early', r.early || '', 'number', 120), '截止日前預約的所有人（含會員）都付這個價。');
    h += catFld('早鳥截止', catIn('cf-until', r.earlyUntil, 'date', 170), '最後一天，含當天。過了自動恢復成原價／會員價。');
    h += '<div style="margin:12px 0 8px;font-size:13px;color:var(--text2)">同行優惠（選填）</div>';
    h += catFld('兩人價', catIn('cf-pair', r.pair || '', 'number', 120), '兩人同行的總價；留空＝沒有優惠。');
    h += '<div id="cf-preview" style="background:#f6f1e7;border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.9;margin:10px 0"></div>' + oldLine;
  }
  h += '<div style="border-top:1px solid var(--border);margin:12px 0 10px;padding-top:10px;font-size:13.5px;font-weight:600">加購項目</div>' +
    (e._new ? '<div class="muted" style="font-size:13px;margin-bottom:8px">先按下面的「儲存」建立這門課，之後再回來新增加購項目。</div>' : '<div id="cf-addons"></div>');
  h += '<div style="border-top:1px solid var(--border);margin:12px 0 10px;padding-top:10px;font-size:13.5px;font-weight:600">其他</div>';
  h += catFld('圖片網址', catIn('cf-img', r.img, 'text', 300));
  h += catFld('排序', catIn('cf-sort', r.sort, 'number', 80), '同分類內由小到大');
  h += catFld('最小年齡', catIn('cf-age', r.minAge || '', 'number', 80));
  h += catFld('可加堂', '<select id="cf-multi" style="padding:7px 8px;border:1px solid var(--border);border-radius:6px"><option value="N"' + (r.multi ? '' : ' selected') + '>否</option><option value="Y"' + (r.multi ? ' selected' : '') + '>是</option></select>');
  h += catFld('可加購', catIn('cf-addon', r.addon, 'text', 300, false, '備註文字；實際加購品項目前還在試算表「加購」分頁'));
  h += catFld('佔位', catIn('cf-seats', r.seats || '', 'number', 80), '一組佔幾個位子（地毯課填 3）；留空＝一般');
  h += catFld('計時', catIn('cf-hourly', r.hourly || '', 'number', 100), '每小時多少錢；留空＝不是計時課');
  h += catFld('上架', '<label style="font-size:14px"><input type="checkbox" id="cf-on"' + (r.on !== false ? ' checked' : '') + '> 在課程清單顯示</label>');
  h += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-gold" id="cf-save" onclick="catSave()">儲存</button>' +
    '<button class="btn btn-outline" onclick="catCloseModal()">取消</button>' +
    (e._new ? '' : '<button class="btn btn-outline" style="margin-left:auto;color:#b5482b" onclick="catDelete()">刪除</button>') + '</div>';
  document.getElementById('cat-modal-body').innerHTML = h;
  ['cf-po', 'cf-pm', 'cf-pf', 'cf-early', 'cf-until', 'cf-pair'].forEach(function(id){ var x = document.getElementById(id); if (x) { x.oninput = catPreview; x.onchange = catPreview } });
  catPreview();
  catAddonEdit = null; catAddonDraw();
  document.getElementById('cat-modal').style.display = 'block';
}
function catFillOrig(){
  var e = catEdit; if (!e || !(e.row.price > 0)) return;
  document.getElementById('cf-po').value = e.row.price; catPreview();
}
/* 三列式課程：原價←單次原價那列、初次體驗價←體驗價那列、會員價←會員價那列（都是試算表原本的價格） */
function catFillTier(){
  var e = catEdit; if (!e) return;
  var t = catTierRows(e.row), set = function(id, v){ var x = document.getElementById(id); if (x && v > 0) x.value = v };
  set('cf-po', (t.base || e.row).price); set('cf-pf', t.first && t.first.price); set('cf-pm', t.member && t.member.price);
  catPreview();
}
/* 編輯視窗裡的「家長會看到什麼」：邊填邊更新，不用自己想像 */
function catPreview(){
  var el = document.getElementById('cf-preview'); if (!el) return;
  var v = function(id){ var x = document.getElementById(id); return x ? x.value : '' };
  var po = catNum(v('cf-po')), pm = catNum(v('cf-pm')), pf = catNum(v('cf-pf')), eb = catNum(v('cf-early')), un = catDay(v('cf-until')), pr = catNum(v('cf-pair'));
  var f = function(n){ return '<b>NT$' + n.toLocaleString() + '</b>' }, bad = function(t){ return '<span style="color:var(--red)">' + t + '</span>' }, sv = function(n){ return po > n ? '（省 ' + (po - n).toLocaleString() + '）' : '　' + bad('沒有比原價低') }, L = [];
  L.push('<div style="font-weight:600;margin-bottom:2px">家長會看到：</div>');
  L.push(po ? '・課程卡片先顯示：' + f(po) + '（原價）' : '・' + bad('還沒填原價'));
  if (po) {
    L.push(pm ? '・會員：' + f(pm) + sv(pm) : '・會員：沒有會員價，付原價');
    L.push(pf ? '・第一次上這門課的客人：' + f(pf) + sv(pf) : pm ? '・第一次上這門課的客人：' + f(pm) + '（跟會員價一樣）' : '・第一次上這門課的客人：付原價');
    L.push('・單次、來很多次的非會員：' + f(po));
  }
  if (eb && un) {
    var lo = Math.min.apply(null, [pm, pf].filter(function(n){ return n > 0 }).concat([po || 1e9]));
    L.push('・早鳥期間（到 ' + catMd(un) + '）：所有人 ' + f(eb) + '，過了自動恢復' + (po && eb >= po ? '　' + bad('早鳥價沒有比原價低') : '') +
      ((pm || pf) && eb > lo ? '　' + bad('早鳥價比會員價／體驗價還高，那些客人早鳥期間反而付比較多') : ''));
  } else if (eb || un) L.push('・' + bad('早鳥價和截止日要一起填'));
  if (pr) L.push('・兩人同行：2 位 ' + f(pr));
  el.innerHTML = L[0] + L.slice(1).join('<br>');
}
function catFormGet(){
  var g = function(id){ var x = document.getElementById(id); return x ? x.value : '' };
  var has = function(id){ return !!document.getElementById(id) };
  var o = catEdit.orig || catEdit.row || {};
  var num = function(id, k){ return has(id) ? catNum(g(id)) : (+o[k] || 0) };
  var sel = g('cf-catsel'), cat = sel === '__new__' ? catStr(g('cf-cat')) : catStr(sel);
  return { cat: cat, name: catStr(g('cf-name')), spec: catStr(g('cf-spec')), desc: catStr(g('cf-desc')), dur: catStr(g('cf-dur')),
    pMember: num('cf-pm', 'pMember'), pFirst: num('cf-pf', 'pFirst'), pOrig: num('cf-po', 'pOrig'), early: num('cf-early', 'early'),
    earlyUntil: has('cf-until') ? catDay(g('cf-until')) : (o.earlyUntil || ''), pair: num('cf-pair', 'pair'), img: catStr(g('cf-img')),
    on: !!(document.getElementById('cf-on') || {}).checked, sort: parseInt(g('cf-sort'), 10) || 99, minAge: parseInt(g('cf-age'), 10) || 0,
    multi: g('cf-multi') === 'Y', addon: catStr(g('cf-addon')), seats: catNum(g('cf-seats')), hourly: catNum(g('cf-hourly')) };
}
async function catSave(){
  if (catBusy || !catEdit) return;
  var v = catFormGet(), e = catEdit;
  if (!v.name) { alert('請填課程名稱'); return }
  if (!v.cat) { alert('請填分類'); return }
  if (v.early && !v.earlyUntil) { alert('有填早鳥價，請也填早鳥截止日'); return }
  if (!v.early && v.earlyUntil) { alert('有填早鳥截止日，請也填早鳥價'); return }
  if ((v.pMember || v.pFirst) && !v.pOrig) { alert('有填會員價或初次體驗價，請先填原價（課程卡片要先顯示原價）'); return }
  if (v.pOrig && v.pMember && v.pMember >= v.pOrig && !confirm('會員價（' + v.pMember + '）沒有比原價（' + v.pOrig + '）低，確定嗎？')) return;
  if (v.pOrig && v.pFirst && v.pFirst >= v.pOrig && !confirm('初次體驗價（' + v.pFirst + '）沒有比原價（' + v.pOrig + '）低，確定嗎？')) return;
  if (v.pOrig && v.early && v.early >= v.pOrig && !confirm('早鳥價（' + v.early + '）沒有比原價（' + v.pOrig + '）低，確定嗎？')) return;
  var lowOther = Math.min.apply(null, [v.pMember, v.pFirst].filter(function(n){ return n > 0 }).concat([1e9]));
  if (v.early && lowOther < 1e9 && v.early > lowOther && !confirm('早鳥價（' + v.early + '）比會員價／體驗價（' + lowOther + '）還高：那些客人早鳥期間反而要付比較多。確定嗎？')) return;
  var key = catKey(v);
  if (catRows.some(function(r){ return r.id !== e.id && catKey(r) === key })) { alert('已經有同名同規格的課程了：' + key); return }
  if (v.earlyUntil && v.earlyUntil < catToday() && !confirm('早鳥截止日已經過了，存下來會是「已過期」，確定嗎？')) return;
  catBusy = true;
  var btn = document.getElementById('cf-save'); if (btn) btn.disabled = true;
  try {
    if (!e._new) {
      /* 寫之前確認這一筆沒被別人改過，改過就不蓋 */
      var cur = await catFb('GET', '/courseCatalog/rows/' + e.id + '/updatedAt');
      if ((cur || '') !== (e.orig.updatedAt || '')) { alert('這一筆剛剛被別人改過了，沒有儲存。請按「↻ 重新讀取」後再改。'); return }
    }
    var row = Object.assign({}, e.orig || {}, v, { id: e.id, updatedAt: new Date().toISOString(), updatedBy: catBy() });
    if (e._new) { row.src = 'new'; row.ord = e.ord }
    await catFb('PUT', '/courseCatalog/rows/' + e.id, row);
    await catLog(e._new ? 'add' : 'edit', row, e.orig, row);
    var i = catRows.findIndex(function(r){ return r.id === e.id });
    if (i >= 0) catRows[i] = row; else catRows.push(row);
    catSortRows(); catCloseModal(); renderCatalog();
  } catch (err) {
    alert('儲存失敗：' + err.message + '\n資料沒有被改動，請再試一次。');
  } finally { catBusy = false; if (btn) btn.disabled = false }
}
async function catDelete(){
  var e = catEdit; if (!e || e._new || catBusy) return;
  if (catRecipeCount(e.orig)) { alert('這門課有建用料，不能直接刪除。如果不再開，請把「上架」關掉就好。'); return }
  if (!confirm('確定刪除「' + catKey(e.orig) + '」嗎？\n會留下刪除紀錄，但畫面上無法直接復原。')) return;
  catBusy = true;
  try {
    await catFb('DELETE', '/courseCatalog/rows/' + e.id);
    await catLog('delete', e.orig, e.orig, null);
    catRows = catRows.filter(function(r){ return r.id !== e.id });
    catCloseModal(); renderCatalog();
  } catch (err) { alert('刪除失敗：' + err.message) } finally { catBusy = false }
}

/* ── 價格先帶入試算表原本的價格（只填空格；三列式課程把三列的價格整理到「單次原價」那一列）── */
function catFillPlan(){
  var plan = [];
  catRows.forEach(function(r){
    if (catIsLegacy(r)) return;
    var patch = {};
    if (catIsBase(r)) {
      var t = catTierRows(r);
      if (!r.pOrig && r.price > 0) patch.pOrig = r.price;
      if (!r.pFirst && t.first && t.first.price > 0) patch.pFirst = t.first.price;
      if (!r.pMember && t.member && t.member.price > 0) patch.pMember = t.member.price;
    } else if (!r.pOrig && r.price > 0) patch.pOrig = r.price;
    if (Object.keys(patch).length) plan.push({ r: r, patch: patch });
  });
  return plan;
}
async function catFillAllOrig(){
  if (catBusy) return;
  var plan = catFillPlan();
  if (!plan.length) { alert('沒有需要帶入的：該填的格子不是已經有價格，就是試算表沒有價格可以帶。'); return }
  var tierN = plan.filter(function(x){ return catIsBase(x.r) }).length;
  if (!confirm('要把試算表原本的價格先帶進 ' + plan.length + ' 列嗎？\n\n・只填空格，你已經填過的價格不會被改\n' +
    '・一般課程：原價 ← 試算表價格\n' + (tierN ? '・選圖繪畫、創作繪畫、邏輯素描（' + tierN + ' 門）：原價／初次體驗價／會員價 ← 三列各自的試算表價格，填在「單次原價」那一列\n' : '') +
    '・帶入之後還是可以一列一列改')) return;
  catBusy = true;
  try {
    await catLoad();   /* 先重讀一次，只補現在還是空的 */
    plan = catFillPlan();
    var now = new Date().toISOString(), by = catBy();
    for (var i = 0; i < plan.length; i += 10) {
      await Promise.all(plan.slice(i, i + 10).map(function(x){
        return catFb('PATCH', '/courseCatalog/rows/' + x.r.id, Object.assign({}, x.patch, { updatedAt: now, updatedBy: by }));
      }));
    }
    plan.forEach(function(x){ Object.assign(x.r, x.patch, { updatedAt: now, updatedBy: by }) });
    await catLog('fillOrig', { id: '', name: '價格帶入試算表' }, null, { count: plan.length, ids: plan.map(function(x){ return x.r.id }) });
    renderCatalog();
    alert('已帶入 ' + plan.length + ' 列。');
  } catch (err) { alert('帶入失敗：' + err.message + '\n（可能有一部分已經寫入，請按「↻ 重新讀取」看現況。）') } finally { catBusy = false }
}

/* ── 從試算表匯入（複製，不改試算表）── */
async function catImportAll(){
  if (catBusy) return;
  if (catRows && catRows.length) { alert('這裡已經有課程了。要補進試算表新增的課，請到「核對報告」。'); return }
  if (!confirm('要把試算表「課程」分頁目前的每一列複製進來嗎？\n\n試算表本身不會被改動，匯入前會先把它原樣備份一份。')) return;
  catBusy = true;
  try {
    var sheet = await catReadSheet();
    if (!sheet.length) throw new Error('試算表讀到 0 列，沒有匯入');
    var ts = new Date().toISOString();
    /* 1) 先備份試算表原樣 */
    await catFb('PUT', '/courseCatalogSnap/' + ts.replace(/[.:]/g, '-'), { at: ts, by: catBy(), count: sheet.length, rows: sheet });
    /* 2) 寫入每一列（一次 PATCH 到 rows 底下，只新增這些 id） */
    var rows = {}, seen = {}, dup = [];
    sheet.forEach(function(s, i){
      var id = 'c' + ('000' + (i + 1)).slice(-3), k = catKey(s);
      if (seen[k]) dup.push(k); seen[k] = 1;
      rows[id] = catFromSheet(s, id, (i + 1) * 10);
    });
    await catFb('PATCH', '/courseCatalog/rows', rows);
    await catFb('PATCH', '/courseCatalog/meta', { importedAt: ts, importedBy: catBy(), count: sheet.length });
    await catLog('import', { id: '', name: '全部匯入' }, null, { count: sheet.length });
    catRows = null; catSheet = null;
    await renderCatalog();
    alert('匯入完成：' + sheet.length + ' 列。' + (dup.length ? '\n\n⚠ 試算表裡有同名同規格重複的課：\n' + dup.join('\n') : '') + '\n\n接著請到「🔍 核對報告」確認跟試算表一模一樣。');
  } catch (err) {
    alert('匯入失敗：' + err.message + '\n沒有改動任何現有資料。');
  } finally { catBusy = false }
}

/* ── 核對報告 ── */
async function catShowCheck(){
  catView = 'check';
  var el = document.getElementById('catalog-body');
  if (!catSheet) {
    if (el) el.innerHTML = catBanner() + '<div class="empty">讀取試算表現況中…</div>';
    try { catSheet = await catReadSheet() } catch (err) { catView = 'list'; alert('讀不到試算表：' + err.message); renderCatalog(); return }
  }
  if (!catAddonSheet) { try { catAddonSheet = await catReadAddons() } catch (err) { catAddonSheet = null } }
  renderCatalog();
}
function catSame(a, b){ return String(a == null ? '' : a).trim() === String(b == null ? '' : b).trim() }
function catCompare(){
  var pool = {};
  catRows.forEach(function(r){ var k = catKey(r); (pool[k] = pool[k] || []).push(r) });
  var onlySheet = [], diffs = [], same = 0, matched = {};
  catSheet.forEach(function(s){
    var k = catKey(s), c = (pool[k] || []).shift();
    if (!c) { onlySheet.push(s); return }
    matched[c.id] = 1;
    var f = [];
    CAT_CMP.forEach(function(p){
      if ((p[0] === 'early' || p[0] === 'earlyUntil') && !catSheet.hasEarly) return;
      if (!catSame(s[p[0]], c[p[0]])) f.push({ k: p[0], label: p[1], sv: s[p[0]], hv: c[p[0]] });
    });
    if (f.length) diffs.push({ row: c, sheet: s, fields: f }); else same++;
  });
  var onlyHere = catRows.filter(function(r){ return !matched[r.id] });
  return { onlySheet: onlySheet, onlyHere: onlyHere, diffs: diffs, same: same };
}
function catFv(k, v){
  if (k === 'on' || k === 'multi') return v ? '是' : '否';
  if (k === 'earlyUntil') return v ? catMd(v) : '（空）';
  if (v === '' || v == null || v === 0) return '（空）';
  return catEsc(v);
}
function catCheckHtml(){
  var c = catCompare(), h = '';
  var okAll = !c.onlySheet.length && !c.diffs.length;
  h += '<div class="card" style="margin:8px 0;background:' + (okAll ? '#eef7f0' : '#fff8e6') + '"><div style="font-size:15px;font-weight:600">① 跟試算表比對' +
    '<button class="btn btn-outline btn-sm" style="margin-left:10px" onclick="catSheet=null;catAddonSheet=null;catShowCheck()">↻ 重新讀取試算表</button></div>' +
    '<div style="font-size:13.5px;margin-top:6px;line-height:1.8">試算表 <b>' + catSheet.length + '</b> 列・這裡 <b>' + catRows.length + '</b> 列・完全一樣 <b style="color:#2e7d4f">' + c.same + '</b> 列' +
    (c.diffs.length ? '・有差異 <b style="color:#b5482b">' + c.diffs.length + '</b> 列' : '') + (c.onlySheet.length ? '・試算表有、這裡沒有 <b style="color:#b5482b">' + c.onlySheet.length + '</b> 列' : '') +
    (c.onlyHere.length ? '・只在這裡有 <b>' + c.onlyHere.length + '</b> 列' : '') + '</div>' +
    (okAll ? '<div style="font-size:13.5px;margin-top:4px;color:#2e7d4f">✓ 試算表裡的課程，這裡都有，而且內容一樣。</div>' : '') + '</div>';
  if (c.onlySheet.length) {
    h += '<div class="card" style="margin:8px 0"><div style="font-weight:600;font-size:14px">試算表有、這裡還沒有（' + c.onlySheet.length + '）' +
      '<button class="btn btn-gold btn-sm" style="margin-left:10px" onclick="catAddMissing()">全部補進來</button></div><div style="font-size:13px;margin-top:6px;line-height:1.8">' +
      c.onlySheet.map(function(s){ return catEsc(catKey(s)) + '　$' + (s.price || 0).toLocaleString() }).join('<br>') + '</div></div>';
  }
  if (c.diffs.length) {
    h += '<div class="card" style="margin:8px 0"><div style="font-weight:600;font-size:14px">內容不一樣的列（' + c.diffs.length + '）</div>' +
      '<div class="muted" style="font-size:12.5px;margin:4px 0 8px">如果是你在這裡刻意改的，不用管。如果是試算表後來改了，按「採用試算表」就會把這一列更新成試算表的內容（只更新有差異的欄位）。</div>';
    c.diffs.forEach(function(d){
      h += '<div style="border-top:1px solid var(--border);padding:8px 0;font-size:13.5px"><div style="display:flex;align-items:center;gap:8px"><b>' + catEsc(catKey(d.row)) + '</b>' +
        '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="catAdopt(\'' + d.row.id + '\')">採用試算表</button></div>' +
        d.fields.map(function(f){ return '<div class="muted" style="font-size:13px">' + f.label + '：試算表 ' + catFv(f.k, f.sv) + ' ／ 這裡 ' + catFv(f.k, f.hv) + '</div>' }).join('') + '</div>';
    });
    h += '</div>';
  }
  if (c.onlyHere.length) {
    h += '<div class="card" style="margin:8px 0"><div style="font-weight:600;font-size:14px">只在這裡有、試算表沒有（' + c.onlyHere.length + '）</div>' +
      '<div class="muted" style="font-size:12.5px;margin:4px 0 6px">你在這裡新增的課，或試算表後來刪掉的列，會出現在這裡。</div><div style="font-size:13px;line-height:1.8">' +
      c.onlyHere.map(function(r){ return catEsc(catKey(r)) + (r.src === 'new' ? '　<span style="color:#b07a1f">（這裡新增的）</span>' : '　<span style="color:#b5482b">（試算表已沒有這一列）</span>') }).join('<br>') + '</div></div>';
  }
  /* ② 跟課程用料比對（只讀） */
  var keys = {}; catRows.forEach(function(r){ keys[catKey(r)] = 1 });
  var rec = (typeof S !== 'undefined' && S.recipes) ? S.recipes : {};
  var orphan = Object.keys(rec).filter(function(k){ return rec[k] && rec[k].items && rec[k].items.length && !keys[k] });
  var noRec = catRows.filter(function(r){ return r.on !== false && !catRecipeCount(r) });
  var haveRec = catRows.filter(function(r){ return catRecipeCount(r) }).length;
  h += '<div class="card" style="margin:8px 0;background:' + (orphan.length ? '#fff8e6' : '#eef7f0') + '"><div style="font-size:15px;font-weight:600">② 跟課程用料比對（只讀，不會改用料）</div>' +
    '<div style="font-size:13.5px;margin-top:6px;line-height:1.8">這裡有 <b>' + haveRec + '</b> 列已經建了用料' + (orphan.length ? '・<b style="color:#b5482b">' + orphan.length + '</b> 筆用料找不到對應的課程' : '・每一筆用料都找得到對應的課程 ✓') + '</div>';
  if (orphan.length) h += '<div style="font-size:13px;margin-top:6px;line-height:1.8">' + orphan.map(function(k){ return catEsc(k) + '　' + rec[k].items.length + ' 項材料' }).join('<br>') +
    '<div class="muted" style="font-size:12.5px;margin-top:4px">通常是課程改過名字或規格，用料還掛在舊名字上。</div></div>';
  h += '</div>';
  h += '<div class="card" style="margin:8px 0"><div style="font-weight:600;font-size:14px">上架中、還沒建用料的課（' + noRec.length + '）</div>' +
    '<div class="muted" style="font-size:12.5px;margin:4px 0 6px">有些課本來就不用扣材料，這份只是讓你知道有哪些還沒建。</div><div style="font-size:13px;line-height:1.8">' +
    (noRec.length ? noRec.map(function(r){ return catEsc(catKey(r)) }).join('<br>') : '都建好了 ✓') + '</div></div>';
  /* ③ 價格填寫進度 */
  var eligC = catRows.filter(function(r){ return !catIsLegacy(r) });
  var po = eligC.filter(function(r){ return r.pOrig > 0 }).length, pm = catRows.filter(function(r){ return r.pMember > 0 }).length, pfN = catRows.filter(function(r){ return r.pFirst > 0 }).length;
  var eb = catRows.filter(function(r){ return r.early > 0 }).length;
  h += '<div class="card" style="margin:8px 0"><div style="font-size:15px;font-weight:600">③ 價格填寫進度</div><div style="font-size:13.5px;margin-top:6px;line-height:1.8">' +
    '原價已填 <b>' + po + '</b> / ' + eligC.length + ' 列（體驗價、會員價兩列的舊價格別列不算）・會員價（優惠價） <b>' + pm + '</b> 列・初次體驗價 <b>' + pfN + '</b> 列・早鳥價 <b>' + eb + '</b> 列</div></div>';
  h += catAddonCheckHtml();
  return h;
}
async function catAdopt(id){
  if (catBusy) return;
  var d = catCompare().diffs.find(function(x){ return x.row.id === id }); if (!d) return;
  if (!confirm('把「' + catKey(d.row) + '」有差異的欄位更新成試算表的內容？\n' + d.fields.map(function(f){ return f.label }).join('、'))) return;
  catBusy = true;
  try {
    var patch = { updatedAt: new Date().toISOString(), updatedBy: catBy() };
    d.fields.forEach(function(f){ patch[f.k] = d.sheet[f.k] });
    var cur = await catFb('GET', '/courseCatalog/rows/' + id + '/updatedAt');
    if ((cur || '') !== (d.row.updatedAt || '')) { alert('這一筆剛剛被別人改過了，沒有更新。請按「↻ 重新讀取」。'); return }
    await catFb('PATCH', '/courseCatalog/rows/' + id, patch);
    var after = Object.assign({}, d.row, patch);
    await catLog('adopt', after, d.row, after);
    var i = catRows.findIndex(function(r){ return r.id === id }); if (i >= 0) catRows[i] = after;
    renderCatalog();
  } catch (err) { alert('更新失敗：' + err.message) } finally { catBusy = false }
}
async function catAddMissing(){
  if (catBusy) return;
  var c = catCompare(); if (!c.onlySheet.length) return;
  if (!confirm('把試算表有、這裡還沒有的 ' + c.onlySheet.length + ' 列補進來？\n（只新增，不會改動任何已經存在的列）')) return;
  catBusy = true;
  try {
    var mx = 0; catRows.forEach(function(r){ if ((+r.ord || 0) > mx) mx = +r.ord });
    var rows = {}, t = Date.now().toString(36);
    c.onlySheet.forEach(function(s, i){ var id = 's' + t + i; rows[id] = catFromSheet(s, id, mx + (i + 1) * 10) });
    await catFb('PATCH', '/courseCatalog/rows', rows);
    await catLog('addMissing', { id: '', name: '補進試算表新增的列' }, null, { count: c.onlySheet.length });
    Object.keys(rows).forEach(function(k){ catRows.push(rows[k]) });
    catSortRows(); renderCatalog();
  } catch (err) { alert('補進來失敗：' + err.message) } finally { catBusy = false }
}

/* ══ 加購（2026-10-13）══════════════════════════════════
   每門課可以有好幾個加購項目；價格有兩種算法：固定金額（例：雙層流動 +1000），或每小時（客人選幾小時就乘幾倍）。
   規格留空＝這門課每個規格都有；填了＝只有那個規格才有（例：雙層流動依尺寸不同價）。 */
function catAddonKey(a){ return catStr(a.course) + '|' + catStr(a.spec) + '|' + catStr(a.name) }
function catAddonsFor(r){
  return (catAddons || []).filter(function(a){ return a.course === r.name && (!a.spec || a.spec === r.spec) && a.on !== false })
    .sort(function(x, y){ return (+x.sort || 99) - (+y.sort || 99) });
}
function catAddonPriceTxt(a){ return (a.unit === 'hour' ? '每小時 ' : '+') + 'NT$' + (+a.price || 0).toLocaleString() }
async function catReadAddons(){
  var url = 'https://docs.google.com/spreadsheets/d/' + CAT_SHEET_ID + '/gviz/tq?sheet=' + encodeURIComponent('加購') + '&tqx=out:json';
  var t = await (await fetch(url)).text();
  var j = JSON.parse(t.substring(t.indexOf('{'), t.lastIndexOf('}') + 1));
  if (!j.table) throw new Error('讀不到試算表「加購」分頁');
  var clean = function(x){ return String(x == null ? '' : x).replace(/\s/g, '') };
  var head = (j.table.cols || []).map(function(c){ return clean(c && (c.label || c.id)) });
  var rows = j.table.rows.map(function(r){ return (r.c || []).map(function(c){ return c ? (c.f == null ? c.v : c.f) : '' }) });
  if (head.indexOf('課程名稱') < 0 && rows.length && clean(rows[0][0]) === '課程名稱') head = rows.shift().map(clean);
  var hasSpec = head.indexOf('規格') >= 0 || head.indexOf('課程名稱') < 0;   /* 沒認出標題就當新格式（課程名稱／規格／加購名稱／價格／排序） */
  var I = hasSpec ? { c: 0, s: 1, n: 2, p: 3, o: 4 } : { c: 0, s: -1, n: 1, p: 2, o: 3 };
  var g = function(r, i){ return i >= 0 && r[i] != null ? r[i] : '' };
  var out = [];
  rows.forEach(function(r){
    var c = catStr(g(r, I.c)), n = catStr(g(r, I.n));
    if (!c || !n) return;
    out.push({ course: c, spec: catStr(g(r, I.s)), name: n, price: catNum(g(r, I.p)), sort: parseInt(g(r, I.o), 10) || 99 });
  });
  return out;
}
function catAddonCompare(){
  var pool = {};
  (catAddons || []).forEach(function(a){ var k = catAddonKey(a); (pool[k] = pool[k] || []).push(a) });
  var onlySheet = [], diffs = [], same = 0, matched = {};
  catAddonSheet.forEach(function(s2){
    var c = (pool[catAddonKey(s2)] || []).shift();
    if (!c) { onlySheet.push(s2); return }
    matched[c.id] = 1;
    if (catNum(c.price) !== catNum(s2.price)) diffs.push({ a: c, sheet: s2 }); else same++;
  });
  return { onlySheet: onlySheet, onlyHere: (catAddons || []).filter(function(a){ return !matched[a.id] }), diffs: diffs, same: same };
}
/* 從試算表「加購」複製（只新增沒有的，不改已經有的；試算表不動） */
async function catImportAddons(){
  if (catBusy) return;
  catBusy = true;
  try {
    var sheet = await catReadAddons();
    var have = {}; (catAddons || []).forEach(function(a){ have[catAddonKey(a)] = 1 });
    var add = sheet.filter(function(a){ return !have[catAddonKey(a)] });
    if (!add.length) { alert('試算表「加購」分頁的 ' + sheet.length + ' 筆，這裡都已經有了。'); return }
    if (!confirm('把試算表「加購」分頁還沒複製進來的 ' + add.length + ' 筆加購項目複製進來？\n（只新增，不會改動已經有的；試算表本身不會被改動）')) return;
    var ts = new Date().toISOString(), now = ts, by = catBy(), t = Date.now().toString(36), rows = {};
    await catFb('PUT', '/courseCatalogSnap/addons-' + ts.replace(/[.:]/g, '-'), { at: ts, by: by, count: sheet.length, rows: sheet });
    add.forEach(function(a, i){
      var id = 'a' + t + i;
      rows[id] = { id: id, course: a.course, spec: a.spec, name: a.name, price: a.price, unit: 'fixed', sort: a.sort, on: true, src: 'sheet', updatedAt: now, updatedBy: by };
    });
    await catFb('PATCH', '/courseCatalog/addons', rows);
    await catLog('addonImport', { id: '', name: '加購匯入' }, null, { count: add.length });
    Object.keys(rows).forEach(function(k){ (catAddons = catAddons || []).push(rows[k]) });
    catAddonSheet = sheet;
    renderCatalog();
    alert('已複製 ' + add.length + ' 筆加購項目。');
  } catch (err) { alert('複製加購失敗：' + err.message + '\n沒有改動任何現有資料。') } finally { catBusy = false }
}
/* 課程編輯視窗裡的「加購項目」區塊 */
function catAddonDraw(){
  var box = document.getElementById('cf-addons'); if (!box || !catEdit) return;
  var r = catEdit.orig || catEdit.row, list = catAddonsFor(r), E = catAddonEdit;
  var sty = 'padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px';
  var h = '';
  if (!list.length && !E) h += '<div class="muted" style="font-size:13px;margin-bottom:8px">這個規格目前沒有加購項目。</div>';
  list.forEach(function(a){
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;border:1px solid var(--border);border-radius:8px;padding:8px 10px;margin-bottom:6px">' +
      '<div style="flex:1 1 200px;min-width:0"><b>' + catEsc(a.name) + '</b>　' + catEsc(catAddonPriceTxt(a)) +
      '<div class="muted" style="font-size:12px">' + (a.spec ? '只有這個規格' : '這門課所有規格都有') + '</div></div>' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="catAddonOpen(\'' + a.id + '\')">編輯</button></div>';
  });
  if (E) {
    h += '<div style="background:#f6f1e7;border-radius:10px;padding:10px 12px;margin:6px 0">' +
      '<div style="font-weight:600;font-size:13.5px;margin-bottom:8px">' + (E._new ? '新增加購項目' : '編輯加購項目') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px">' +
      '<input id="ad-name" placeholder="加購名稱（例：雙層流動）" value="' + catEsc(E.name) + '" style="flex:1 1 180px;min-width:150px;' + sty + '">' +
      '<input id="ad-price" type="number" min="0" step="1" onwheel="this.blur()" placeholder="金額" value="' + catEsc(E.price || '') + '" style="width:100px;' + sty + '">' +
      '<select id="ad-unit" style="' + sty + '"><option value="fixed"' + (E.unit !== 'hour' ? ' selected' : '') + '>固定金額</option><option value="hour"' + (E.unit === 'hour' ? ' selected' : '') + '>每小時</option></select></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px"><select id="ad-scope" style="' + sty + '"><option value="all"' + (E.spec ? '' : ' selected') + '>這門課所有規格都有</option>' +
      (r.spec ? '<option value="spec"' + (E.spec ? ' selected' : '') + '>只有「' + catEsc(r.spec) + '」這個規格</option>' : '') + '</select>' +
      '<span class="muted" style="font-size:12.5px">顯示順序</span><input id="ad-sort" type="number" min="1" step="1" onwheel="this.blur()" value="' + catEsc(E.sort || '') + '" style="width:70px;' + sty + '"></div>' +
      '<div class="muted" style="font-size:12px;margin-bottom:8px">固定金額：加購一次收這個價。每小時：客人選幾小時就乘幾倍（例如地毯這種計時的課）。</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn btn-gold btn-sm" onclick="catAddonSave()">儲存這個加購</button>' +
      '<button type="button" class="btn btn-outline btn-sm" onclick="catAddonEdit=null;catAddonDraw()">取消</button>' +
      (E._new ? '' : '<button type="button" class="btn btn-outline btn-sm" style="margin-left:auto;color:#b5482b" onclick="catAddonDelete()">刪除</button>') + '</div>' +
      '<div class="muted" style="font-size:12px;margin-top:6px">加購項目是單獨存的，按「儲存這個加購」就生效，不用再按下面的課程「儲存」。</div></div>';
  } else h += '<button type="button" class="btn btn-outline btn-sm" onclick="catAddonNew()">＋ 新增加購項目</button>';
  box.innerHTML = h;
}
function catAddonNew(){ catAddonEdit = { _new: true, id: 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36), name: '', price: 0, unit: 'fixed', spec: '', sort: ((catAddonsFor(catEdit.orig || catEdit.row).length) + 1) }; catAddonDraw() }
function catAddonOpen(id){
  var a = (catAddons || []).find(function(x){ return x.id === id }); if (!a) return;
  catAddonEdit = JSON.parse(JSON.stringify(a)); catAddonDraw();
}
async function catAddonSave(){
  if (catBusy || !catAddonEdit || !catEdit) return;
  var E = catAddonEdit, r = catEdit.orig || catEdit.row, g = function(id){ var x = document.getElementById(id); return x ? x.value : '' };
  var name = catStr(g('ad-name')), price = catNum(g('ad-price'));
  if (!name) { alert('請填加購名稱'); return }
  if (!price) { alert('請填金額'); return }
  var item = { id: E.id, course: r.name, spec: g('ad-scope') === 'spec' ? r.spec : '', name: name, price: price, unit: g('ad-unit') === 'hour' ? 'hour' : 'fixed',
    sort: parseInt(g('ad-sort'), 10) || 99, on: true, src: E.src || 'new', updatedAt: new Date().toISOString(), updatedBy: catBy() };
  if ((catAddons || []).some(function(a){ return a.id !== E.id && catAddonKey(a) === catAddonKey(item) })) { alert('這門課已經有同名的加購項目了：' + name); return }
  catBusy = true;
  try {
    if (!E._new) {
      var cur = await catFb('GET', '/courseCatalog/addons/' + E.id + '/updatedAt');
      if ((cur || '') !== (E.updatedAt || '')) { alert('這個加購項目剛剛被別人改過了，沒有儲存。請關掉視窗、按「↻ 重新讀取」後再改。'); return }
    }
    await catFb('PUT', '/courseCatalog/addons/' + E.id, item);
    await catLog(E._new ? 'addonAdd' : 'addonEdit', { id: item.id, name: item.course, spec: item.spec }, E._new ? null : E, item);
    var i = (catAddons || []).findIndex(function(a){ return a.id === E.id });
    if (i >= 0) catAddons[i] = item; else (catAddons = catAddons || []).push(item);
    catAddonEdit = null; catAddonDraw(); renderCatalog();
  } catch (err) { alert('儲存失敗：' + err.message + '\n沒有改動資料，請再試一次。') } finally { catBusy = false }
}
async function catAddonDelete(){
  var E = catAddonEdit; if (!E || E._new || catBusy) return;
  if (!confirm('確定刪除加購項目「' + E.name + '」嗎？\n會留下刪除紀錄，但畫面上無法直接復原。')) return;
  catBusy = true;
  try {
    await catFb('DELETE', '/courseCatalog/addons/' + E.id);
    await catLog('addonDelete', { id: E.id, name: E.course, spec: E.spec }, E, null);
    catAddons = (catAddons || []).filter(function(a){ return a.id !== E.id });
    catAddonEdit = null; catAddonDraw(); renderCatalog();
  } catch (err) { alert('刪除失敗：' + err.message) } finally { catBusy = false }
}
/* 核對報告 ④：加購 */
function catAddonCheckHtml(){
  var h = '<div class="card" style="margin:8px 0"><div style="font-size:15px;font-weight:600">④ 加購項目' +
    '<button class="btn btn-outline btn-sm" style="margin-left:10px" onclick="catAddonSheet=null;catShowCheck()">↻ 重新讀取試算表</button></div>';
  if (!catAddons || !catAddons.length) {
    return h + '<div style="font-size:13.5px;margin-top:6px;line-height:1.8">加購項目還沒有複製進來。<button class="btn btn-gold btn-sm" style="margin-left:8px" onclick="catImportAddons()">從試算表「加購」複製</button></div></div>';
  }
  h += '<div style="font-size:13.5px;margin-top:6px;line-height:1.8">這裡共 <b>' + catAddons.length + '</b> 筆加購項目</div>';
  if (catAddonSheet) {
    var c = catAddonCompare();
    h += '<div style="font-size:13.5px;line-height:1.8">跟試算表「加購」分頁比對：完全一樣 <b style="color:#2e7d4f">' + c.same + '</b> 筆' +
      (c.diffs.length ? '・價格不同 <b style="color:#b5482b">' + c.diffs.length + '</b> 筆' : '') + (c.onlySheet.length ? '・試算表有、這裡沒有 <b style="color:#b5482b">' + c.onlySheet.length + '</b> 筆' : '') +
      (c.onlyHere.length ? '・只在這裡有 <b>' + c.onlyHere.length + '</b> 筆' : '') + '</div>';
    if (c.onlySheet.length) h += '<div style="font-size:13px;line-height:1.8;margin-top:4px">' + c.onlySheet.map(function(a){ return catEsc(a.course + (a.spec ? '（' + a.spec + '）' : '') + '・' + a.name + ' +' + a.price) }).join('<br>') +
      '<br><button class="btn btn-gold btn-sm" style="margin-top:6px" onclick="catImportAddons()">全部補進來</button></div>';
    if (c.diffs.length) h += '<div style="font-size:13px;line-height:1.8;margin-top:4px">' + c.diffs.map(function(d){ return catEsc(d.a.course + (d.a.spec ? '（' + d.a.spec + '）' : '') + '・' + d.a.name) + '：試算表 ' + d.sheet.price + ' ／ 這裡 ' + d.a.price }).join('<br>') + '</div>';
  }
  /* 加購項目找不到對應的課程 */
  var names = {}; catRows.forEach(function(r){ names[r.name] = 1 });
  var orphan = catAddons.filter(function(a){ return !names[a.course] });
  h += '<div style="font-size:13.5px;margin-top:6px;line-height:1.8">' + (orphan.length ? '<b style="color:#b5482b">' + orphan.length + '</b> 筆加購項目找不到對應的課程（可能課程改過名字）：<br>' +
    orphan.map(function(a){ return catEsc(a.course + '・' + a.name) }).join('<br>') : '每筆加購項目都找得到對應的課程 ✓') + '</div>';
  /* 說明寫了「可加購」、但沒有加購項目的課 */
  var miss = [], seen = {};
  catRows.forEach(function(r){
    if (r.on === false || !/可加購|加購/.test(String(r.desc || '') + String(r.addon || ''))) return;
    if (catAddonsFor(r).length) return;
    if (seen[r.name]) return; seen[r.name] = 1;
    miss.push(r);
  });
  if (miss.length) h += '<div style="font-size:13.5px;margin-top:8px;line-height:1.8"><b style="color:#b5482b">說明裡寫了「可加購」、但還沒有加購項目的課（' + miss.length + '）</b>：客人在預約頁看不到這些加購，只有文字說明。<br>' +
    miss.map(function(r){ return catEsc(r.name) + '　<span class="muted">' + catEsc(String(r.desc || '').replace(/^.*?(可加購)/, '$1')) + '</span>' }).join('<br>') + '</div>';
  /* 「可加購」備註文字的金額，跟實際加購價格對不上 */
  var bad = [];
  catRows.forEach(function(r){
    var m = String(r.addon || '').match(/\d+/); if (!m || r.on === false) return;
    var n = +m[0], ads = catAddonsFor(r);
    if (ads.length && !ads.some(function(a){ return catNum(a.price) === n })) bad.push(catKey(r) + '：備註寫「' + r.addon + '」，加購項目是 ' + ads.map(function(a){ return a.name + ' ' + a.price }).join('、'));
  });
  if (bad.length) h += '<div style="font-size:13.5px;margin-top:8px;line-height:1.8"><b style="color:#b5482b">「可加購」備註的金額跟加購項目對不上（' + bad.length + '）</b>：<br>' + bad.map(catEsc).join('<br>') + '</div>';
  return h + '</div>';
}

/* ── 備份 CSV（下載到自己電腦）── */
function catCsv(){
  var cols = [['cat', '分類'], ['name', '課程名稱'], ['spec', '規格'], ['desc', '說明'], ['dur', '時長'], ['price', '試算表價格'],
    ['pOrig', '原價'], ['pMember', '會員價（優惠價）'], ['pFirst', '初次體驗價'], ['early', '早鳥價'], ['earlyUntil', '早鳥截止'], ['pair', '兩人價'], ['img', '圖片網址'],
    ['on', '上架'], ['sort', '排序'], ['minAge', '最小年齡'], ['multi', '可加堂'], ['addon', '可加購'], ['seats', '佔位'], ['hourly', '計時']];
  var q = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"' };
  var lines = [cols.map(function(c){ return q(c[1]) }).join(',')];
  catRows.forEach(function(r){
    lines.push(cols.map(function(c){
      var v = r[c[0]]; if (c[0] === 'on') v = r.on === false ? 'N' : 'Y'; if (c[0] === 'multi') v = r.multi ? 'Y' : 'N'; return q(v) }).join(','));
  });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = '課程管理備份_' + catToday() + '.csv'; document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove() }, 500);
}
