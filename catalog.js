/* ══════════════════════════════════════════════════════════
   📚 課程管理（2026-10-13，第一階段：只整理、只核對，不連動）

   目標：把「課程／價格（優惠價、原價、早鳥價）／用料」放在同一個畫面管理，
   之後預約頁、會員扣點、LINE 預約、核銷都改讀這一份，不再各讀各的。

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
   pOrig 原價（課程卡片先顯示）／pMember 優惠價（第一次上這門課的客人、會員）／early 早鳥價＋earlyUntil 早鳥截止（含當天，YYYY-MM-DD，所有人）／
   pair 兩人價／img 圖片網址／on 上架／sort 排序／minAge 最小年齡／multi 可加堂／addon 可加購／
   seats 佔位／hourly 計時／ord 試算表原本的先後／src sheet 或 new／updatedAt／updatedBy
   ══════════════════════════════════════════════════════════ */

var CAT_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app';
var CAT_SHEET_ID = '1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M';
var catRows = null, catMeta = null, catSheet = null;
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
    pMember: 0, pOrig: 0, early: s.early, earlyUntil: s.earlyUntil, pair: s.pair, img: s.img, on: s.on,
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
    '<button class="btn btn-outline btn-sm" onclick="catRows=null;catSheet=null;renderCatalog()">↻ 重新讀取</button>' +
    '<button class="btn btn-gold btn-sm" onclick="catNew()">＋ 新增課程</button></div>';
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
    '<button class="btn btn-outline btn-sm" style="white-space:nowrap" title="把還沒填原價的課，原價先帶入試算表的價格（只填空的）" onclick="catFillAllOrig()">原價先帶入試算表價格</button></div>';
  var list = catRows.filter(function(r){
    if (catCatFilter && r.cat !== catCatFilter) return false;
    if (catOnFilter === '1' && r.on === false) return false;
    if (catOnFilter === '0' && r.on !== false) return false;
    if (catFilter && (r.name + r.spec + r.cat).indexOf(catFilter) < 0) return false;
    return true;
  });
  var elig = catRows.filter(function(r){ return !catIsTier(r) }), done = elig.filter(function(r){ return r.pOrig > 0 }).length;
  var tierN = catRows.length - elig.length;
  h += '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:8px">' +
    '<b>原價</b>：課程卡片上先顯示的價格。<b>優惠價</b>：第一次上這門課的客人、會員付的價格（留空＝沒有優惠）。<b>早鳥價</b>：特定課程的限時價，所有人都適用，到截止日自動結束。<br>' +
    '這三個價格現在還沒有任何系統在用，可以慢慢填。灰色小字是試算表原本的價格，預約頁現在還是收那個。<br>' +
    '已填原價 <b>' + done + '</b> / ' + elig.length + ' 列' + (tierN ? '（選圖繪畫等「體驗價／會員價／單次原價」分三列的課，共 ' + tierN + ' 列，先不用填）' : '') + '</div>';
  h += '<div style="overflow-x:auto"><table><thead><tr><th>課程</th><th style="width:84px">原價</th><th style="width:84px">優惠價</th>' +
    '<th style="width:96px">早鳥價</th><th style="width:56px">上架</th><th style="width:76px">用料</th><th style="width:76px"></th></tr></thead><tbody>';
  var last = null, cnt = {};
  list.forEach(function(r){ cnt[r.cat || ''] = (cnt[r.cat || ''] || 0) + 1 });
  list.forEach(function(r){
    /* 有在搜尋的時候一律展開，不然搜到的東西會藏在收起來的分類裡 */
    var closed = !!catClosed[r.cat || ''] && !catFilter;
    if (r.cat !== last) {
      last = r.cat;
      h += '<tr style="cursor:pointer" onclick="catToggleCat(\'' + encodeURIComponent(r.cat || '') + '\')"><td colspan="7" style="background:var(--bg2,#f6f1e7);font-weight:600;font-size:13.5px;user-select:none">' +
        '<span style="display:inline-block;width:18px;color:var(--gold2)">' + (closed ? '▶' : '▼') + '</span>' + catEsc(r.cat || '（沒分類）') +
        ' <span class="muted" style="font-weight:400;font-size:12.5px">' + cnt[r.cat || ''] + ' 列</span></td></tr>';
    }
    if (closed) return;
    var n = catRecipeCount(r), off = r.on === false;
    h += '<tr' + (off ? ' style="opacity:.55"' : '') + '><td>' + catEsc(r.name) + (r.spec ? '<span class="muted" style="font-size:13px">（' + catEsc(r.spec) + '）</span>' : '') +
      (r.src === 'new' ? ' <span style="font-size:11px;color:#b07a1f">新增</span>' : '') + '</td>' +
      '<td style="text-align:right">' + (r.pOrig ? r.pOrig.toLocaleString() :
        (r.price ? '<span class="muted" style="font-size:12px" title="試算表原本的價格，預約頁現在還是收這個">試算表 ' + r.price.toLocaleString() + '</span>' : '<span class="muted">—</span>')) + '</td>' +
      '<td style="text-align:right">' + (r.pMember ? r.pMember.toLocaleString() : '<span class="muted">—</span>') + '</td>' +
      '<td style="text-align:right;font-size:13px">' + catEarlyState(r) + '</td>' +
      '<td style="text-align:center">' + (off ? '<span class="muted">下架</span>' : '✓') + '</td>' +
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
    row: { cat: catCatFilter || '', name: '', spec: '', desc: '', dur: '', price: 0, pMember: 0, pOrig: 0, early: 0, earlyUntil: '',
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
function catDrawModal(){
  var e = catEdit, r = e.row, locked = !e._new && catRecipeCount(e.orig) > 0;
  var cats = []; catRows.forEach(function(x){ if (cats.indexOf(x.cat) < 0) cats.push(x.cat) });
  var h = '<h3 style="margin:0 0 4px">' + (e._new ? '新增課程' : catEsc(r.name) + (r.spec ? '（' + catEsc(r.spec) + '）' : '')) + '</h3>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:12px">第一階段：存在這裡不會影響預約頁和扣點。</div>';
  h += catFld('分類', catIn('cf-cat', r.cat, 'text', 240) + '<datalist id="cf-cats">' + cats.map(function(c){ return '<option value="' + catEsc(c) + '">' }).join('') + '</datalist>');
  h += catFld('課程名稱', catIn('cf-name', r.name, 'text', 300, locked), locked ? '這門課已經建了用料，名稱和規格先鎖住（改了會跟用料對不上）。需要改請先跟我說。' : '');
  h += catFld('規格', catIn('cf-spec', r.spec, 'text', 300, locked), '例：A5透明框、30x30cm畫布；單一規格留空');
  h += catFld('說明', '<textarea id="cf-desc" rows="2" style="width:300px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px;font-family:inherit">' + catEsc(r.desc) + '</textarea>');
  h += catFld('時長', catIn('cf-dur', r.dur, 'text', 160, false, '例：2-2.5小時'));
  h += '<div style="border-top:1px solid var(--border);margin:12px 0 10px;padding-top:10px;font-size:13.5px;font-weight:600">價格</div>';
  if (!e._new && catIsTier(r)) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;line-height:1.7;margin-bottom:10px">這一列的規格是價格別（' + catEsc(r.spec) + '），一門課拆成幾列、各收各的價。先不用填原價和優惠價，等我們決定這幾門課怎麼轉換再處理。</div>';
  h += catFld('原價', catIn('cf-po', r.pOrig || '', 'number', 120) +
    (r.price > 0 ? ' <button type="button" class="btn btn-outline btn-sm" style="white-space:nowrap" onclick="catFillOrig()">帶入試算表價格 ' + r.price.toLocaleString() + '</button>' : ''),
    '課程卡片上先顯示的價格。單次、或來很多次的非會員，付這個價。');
  h += catFld('優惠價', catIn('cf-pm', r.pMember || '', 'number', 120), '第一次上這門課的客人、會員付這個價。留空＝沒有優惠，大家都付原價。');
  h += '<div style="margin:12px 0 8px;font-size:13px;color:var(--text2)">早鳥活動（選填，只有特定課程才填）</div>';
  h += catFld('早鳥價', catIn('cf-early', r.early || '', 'number', 120), '截止日前預約的所有人（含會員）都付這個價。');
  h += catFld('早鳥截止', catIn('cf-until', r.earlyUntil, 'date', 170), '最後一天，含當天。過了自動恢復成原價／優惠價。');
  h += '<div style="margin:12px 0 8px;font-size:13px;color:var(--text2)">同行優惠（選填）</div>';
  h += catFld('兩人價', catIn('cf-pair', r.pair || '', 'number', 120), '兩人同行的總價；留空＝沒有優惠。');
  h += '<div id="cf-preview" style="background:#f6f1e7;border-radius:10px;padding:10px 12px;font-size:13.5px;line-height:1.9;margin:10px 0"></div>';
  if (!e._new) h += '<div class="muted" style="font-size:12.5px;margin-bottom:6px">試算表原本的價格（舊價格，只當對照）：<b>' + (r.price ? 'NT$' + r.price.toLocaleString() : '—') + '</b>　預約頁現在還是收這個。</div>';
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
  var ci = document.getElementById('cf-cat'); if (ci) ci.setAttribute('list', 'cf-cats');
  ['cf-po', 'cf-pm', 'cf-early', 'cf-until', 'cf-pair'].forEach(function(id){ var x = document.getElementById(id); if (x) { x.oninput = catPreview; x.onchange = catPreview } });
  catPreview();
  document.getElementById('cat-modal').style.display = 'block';
}
function catFillOrig(){
  var e = catEdit; if (!e || !(e.row.price > 0)) return;
  document.getElementById('cf-po').value = e.row.price; catPreview();
}
/* 編輯視窗裡的「家長會看到什麼」：邊填邊更新，不用自己想像 */
function catPreview(){
  var el = document.getElementById('cf-preview'); if (!el) return;
  var v = function(id){ var x = document.getElementById(id); return x ? x.value : '' };
  var po = catNum(v('cf-po')), pm = catNum(v('cf-pm')), eb = catNum(v('cf-early')), un = catDay(v('cf-until')), pr = catNum(v('cf-pair'));
  var f = function(n){ return '<b>NT$' + n.toLocaleString() + '</b>' }, bad = function(t){ return '<span style="color:var(--red)">' + t + '</span>' }, L = [];
  L.push('<div style="font-weight:600;margin-bottom:2px">家長會看到：</div>');
  L.push(po ? '・課程卡片先顯示：' + f(po) + '（原價）' : '・' + bad('還沒填原價'));
  if (po && pm) L.push('・第一次上這門課的客人、會員：' + f(pm) + (pm < po ? '（省 ' + (po - pm).toLocaleString() + '）' : '　' + bad('優惠價沒有比原價低')));
  else if (po) L.push('・沒有優惠價：所有人都付原價');
  if (eb && un) {
    L.push('・早鳥期間（到 ' + catMd(un) + '）：所有人 ' + f(eb) + '，過了自動恢復' + (po && eb >= po ? '　' + bad('早鳥價沒有比原價低') : '') +
      (pm && eb > pm ? '　' + bad('早鳥價比優惠價還高，會員早鳥期間反而付比較多') : ''));
  } else if (eb || un) L.push('・' + bad('早鳥價和截止日要一起填'));
  if (pr) L.push('・兩人同行：2 位 ' + f(pr));
  el.innerHTML = L[0] + L.slice(1).join('<br>');
}
function catFormGet(){
  var g = function(id){ var x = document.getElementById(id); return x ? x.value : '' };
  return { cat: catStr(g('cf-cat')), name: catStr(g('cf-name')), spec: catStr(g('cf-spec')), desc: catStr(g('cf-desc')), dur: catStr(g('cf-dur')),
    pMember: catNum(g('cf-pm')), pOrig: catNum(g('cf-po')), early: catNum(g('cf-early')),
    earlyUntil: catDay(g('cf-until')), pair: catNum(g('cf-pair')), img: catStr(g('cf-img')),
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
  if (v.pMember && !v.pOrig) { alert('有填優惠價，請先填原價（課程卡片要先顯示原價）'); return }
  if (v.pOrig && v.pMember && v.pMember >= v.pOrig && !confirm('優惠價（' + v.pMember + '）沒有比原價（' + v.pOrig + '）低，確定嗎？')) return;
  if (v.pOrig && v.early && v.early >= v.pOrig && !confirm('早鳥價（' + v.early + '）沒有比原價（' + v.pOrig + '）低，確定嗎？')) return;
  if (v.pMember && v.early && v.early > v.pMember && !confirm('早鳥價（' + v.early + '）比優惠價（' + v.pMember + '）還高：早鳥期間會員反而要付比較多。確定嗎？')) return;
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

/* ── 原價先帶入試算表價格（只填空的；價格別那幾列不處理）── */
async function catFillAllOrig(){
  if (catBusy) return;
  var todo = catRows.filter(function(r){ return !catIsTier(r) && !r.pOrig && r.price > 0 });
  if (!todo.length) { alert('沒有需要帶入的課：不是已經填了原價，就是沒有試算表價格。'); return }
  if (!confirm('把 ' + todo.length + ' 列「還沒填原價」的課，原價先帶入試算表的價格？\n\n・只填空的，已經填過的不會動\n・體驗價／會員價／單次原價那幾列不處理\n・帶入之後還是可以一列一列改')) return;
  catBusy = true;
  try {
    await catLoad();   /* 先重讀一次，只補現在還是空的 */
    var fresh = catRows.filter(function(r){ return !catIsTier(r) && !r.pOrig && r.price > 0 });
    var now = new Date().toISOString(), by = catBy();
    for (var i = 0; i < fresh.length; i += 10) {
      await Promise.all(fresh.slice(i, i + 10).map(function(r){
        return catFb('PATCH', '/courseCatalog/rows/' + r.id, { pOrig: r.price, updatedAt: now, updatedBy: by });
      }));
    }
    fresh.forEach(function(r){ r.pOrig = r.price; r.updatedAt = now; r.updatedBy = by });
    await catLog('fillOrig', { id: '', name: '原價帶入試算表價格' }, null, { count: fresh.length, ids: fresh.map(function(r){ return r.id }) });
    renderCatalog();
    alert('已帶入 ' + fresh.length + ' 列。');
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
    '<button class="btn btn-outline btn-sm" style="margin-left:10px" onclick="catSheet=null;catShowCheck()">↻ 重新讀取試算表</button></div>' +
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
  var eligC = catRows.filter(function(r){ return !catIsTier(r) });
  var po = eligC.filter(function(r){ return r.pOrig > 0 }).length, pm = catRows.filter(function(r){ return r.pMember > 0 }).length;
  var eb = catRows.filter(function(r){ return r.early > 0 }).length;
  h += '<div class="card" style="margin:8px 0"><div style="font-size:15px;font-weight:600">③ 價格填寫進度</div><div style="font-size:13.5px;margin-top:6px;line-height:1.8">' +
    '原價已填 <b>' + po + '</b> / ' + eligC.length + ' 列（三列式課程不算）・優惠價 <b>' + pm + '</b> 列・早鳥價 <b>' + eb + '</b> 列</div></div>';
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

/* ── 備份 CSV（下載到自己電腦）── */
function catCsv(){
  var cols = [['cat', '分類'], ['name', '課程名稱'], ['spec', '規格'], ['desc', '說明'], ['dur', '時長'], ['price', '試算表價格'],
    ['pOrig', '原價'], ['pMember', '優惠價'], ['early', '早鳥價'], ['earlyUntil', '早鳥截止'], ['pair', '兩人價'], ['img', '圖片網址'],
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
