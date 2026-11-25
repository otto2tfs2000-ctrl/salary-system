/* ══════════════════════════════════════════════════════════
   🛍️ 商品預購（2026-11-24，第一檔：微光聖誕樹 DIY 居家創作材料包 xmas-mini）
   客人用連結自己填（預約頁 preorder.html?p=商品代號），員工也可以在這裡幫客人登記。
   這頁彙整：誰買幾盒、寄 7-11 哪家門市或郵局哪個地址、付了沒（末五碼＋截圖）、寄了沒（託運單號）。
   資料在 otto2-2026 preorders/，一律透過伺服器 /staff/preorder* 讀寫（有個資，不直連資料庫）。
   ══════════════════════════════════════════════════════════ */
var poP = 'xmas-mini', poData = null, poView = 'list', poEditing = null, poFilter = 'all', poQ = '', poCfgDraft = null;
var PO_LINK_BASE = 'https://otto2tfs2000-ctrl.github.io/otto2artclub-booking/preorder.html?p=';
/* 給客人的短網址（TinyURL，11/24 建；導到上面那串＋商品代號）。新商品沒有短網址就給長的 */
var PO_SHORT = { 'xmas-mini': 'https://tinyurl.com/otto2xmas' };
var PO_ST = {
  new:     { n:'待確認付款', c:'#c98a2c' },
  paid:    { n:'已付款・待寄', c:'#2f7d5b' },
  shipped: { n:'已寄出', c:'#3a6ea5' },
  done:    { n:'已完成', c:'#888' },
  cancel:  { n:'取消', c:'#b5b5b5' }
};
function poEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] }) }
function poMoney(n){ return 'NT$' + Number(n || 0).toLocaleString('en-US') }
function poMd(iso){ if (!iso) return ''; var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() + ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') }

async function poLoad(){ poData = await staffApi('/staff/preorder/list', { p: poP }) }
async function renderPreorder(){
  var el = document.getElementById('preorder-body'); if (!el) return;
  if (!poData) {
    el.innerHTML = '<div class="empty">載入預購資料中…</div>';
    try { await poLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到預購資料：' + poEsc(e.message) + '</div>'; return }
  }
  el.innerHTML = poView === 'edit' ? poFormHtml() : poView === 'cfg' ? poCfgHtml() : poListHtml();
}
function poOrders(){ return Object.values(poData.orders || {}).sort(function(a, b){ return String(b.createdAt).localeCompare(String(a.createdAt)) }) }
function poDest(o){ return o.way === 'seven' ? o.store : o.way === 'post' ? ((o.zip ? o.zip + ' ' : '') + o.address) : '到店自取' }

/* ── 清單 ── */
function poListHtml(){
  var c = poData.cfg || {}, all = poOrders(), live = all.filter(function(o){ return o.status !== 'cancel' });
  var sum = function(list){ return list.reduce(function(s, o){ return s + (+o.qty || 0) }, 0) };
  var paid = live.filter(function(o){ return o.status !== 'new' });
  var toShip = live.filter(function(o){ return o.status === 'paid' });
  var unpaid = live.filter(function(o){ return o.status === 'new' });
  var ways = {}; live.forEach(function(o){ ways[o.way] = (ways[o.way] || 0) + (+o.qty || 0) });
  /* 加贈要準備幾份：從每筆的「木盤材料包 ×2」把數字加起來 */
  var gifts = {}; live.forEach(function(o){ if (!o.gift) return; var m = String(o.gift).match(/^(.*?)\s*[×x]\s*(\d+)$/);
    var k = m ? m[1] : o.gift; gifts[k] = (gifts[k] || 0) + (m ? +m[2] : 1) });
  var link = PO_SHORT[poP] || (PO_LINK_BASE + encodeURIComponent(poP));
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">🛍️ 商品預購' +
    ((poData.products || []).length > 1 ? '<select onchange="poP=this.value;poData=null;renderPreorder()" style="margin-left:6px">' +
      poData.products.map(function(x){ return '<option value="' + poEsc(x.p) + '"' + (x.p === poP ? ' selected' : '') + '>' + poEsc(x.title) + '</option>' }).join('') + '</select>' : '') +
    '<span style="margin-left:auto"></span>' +
    '<button class="btn btn-outline btn-sm" onclick="poData=null;renderPreorder()">↻ 重新讀取</button>' +
    '<button class="btn btn-outline btn-sm" onclick="poOpenCfg()">⚙️ 商品設定</button>' +
    '<button class="btn btn-gold btn-sm" onclick="poOpenEdit()">＋ 員工幫客人登記</button></div>';
  h += '<div style="display:flex;gap:14px;align-items:center;margin-bottom:12px;flex-wrap:wrap">' +
    (c.img ? '<img src="' + poEsc(c.img) + '" style="width:72px;height:72px;object-fit:cover;border-radius:10px">' : '') +
    '<div style="flex:1;min-width:220px"><div style="font-weight:700">' + poEsc(c.title) + '</div>' +
    '<div class="muted" style="font-size:var(--fs-xs)">每盒 ' + (c.price ? poMoney(c.price) : '<b style="color:#c94d4d">還沒設價格，請按「⚙️ 商品設定」</b>') +
    '・' + (c.open === false ? '<b style="color:#c94d4d">已關閉預購</b>' : '開放預購中') + (c.deadline ? '・截止 ' + poEsc(c.deadline) : '') +
    (c.promoText && c.promoUntil ? '<br>🎁 ' + poEsc(c.promoUntil) + '（含）前下單送' + (c.promoPer === 'box' ? '每盒' : '每筆') + '一份「' + poEsc(c.promoText) + '」' +
      (poToday() > c.promoUntil ? '<b style="color:#c94d4d">（已過期，新單不會再送）</b>' : '') : '') + '</div>' +
    '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap"><input readonly value="' + poEsc(link) + '" style="flex:1;min-width:200px;font-size:12px" onclick="this.select()">' +
    '<button class="btn btn-ok btn-sm" onclick="poCopy(\'' + poEsc(link) + '\',this)">複製客人連結</button>' +
    '<a class="btn btn-outline btn-sm" href="' + poEsc(link) + '" target="_blank">打開看看 ↗</a></div></div></div>';
  /* 四格統計 */
  var box = function(t, v, sub, col){ return '<div style="flex:1;min-width:120px;border:1px solid var(--border);border-radius:10px;padding:10px 12px">' +
    '<div class="muted" style="font-size:var(--fs-xs)">' + t + '</div><div style="font-size:22px;font-weight:800;color:' + (col || 'inherit') + '">' + v + '</div>' +
    '<div class="muted" style="font-size:var(--fs-xs)">' + sub + '</div></div>' };
  h += '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">' +
    box('總共', sum(live) + ' 盒', live.length + ' 筆訂單') +
    box('待確認付款', sum(unpaid) + ' 盒', unpaid.length + ' 筆', '#c98a2c') +
    box('已付款待寄', sum(toShip) + ' 盒', toShip.length + ' 筆', '#2f7d5b') +
    box('已收金額', poMoney(paid.reduce(function(s, o){ return s + (+o.total || 0) }, 0)), '未收 ' + poMoney(unpaid.reduce(function(s, o){ return s + (+o.total || 0) }, 0))) +
    '</div>';
  h += '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:10px">寄送方式：' +
    (Object.keys(ways).map(function(k){ return poEsc((poData.ways || {})[k] || k) + ' ' + ways[k] + ' 盒' }).join('・') || '—') +
    (Object.keys(gifts).length ? '<br><b style="color:#2f7d5b">🎁 加贈要準備：' + Object.keys(gifts).map(function(k){ return poEsc(k) + ' ' + gifts[k] + ' 份' }).join('・') + '</b>' : '') + '</div>';
  /* 篩選＋搜尋 */
  var fl = [['all', '全部'], ['new', '待確認付款'], ['paid', '待寄'], ['shipped', '已寄出'], ['cancel', '取消']];
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:10px">' +
    fl.map(function(f){ return '<button class="btn btn-sm ' + (poFilter === f[0] ? 'btn-gold' : 'btn-outline') + '" onclick="poFilter=\'' + f[0] + '\';renderPreorder()">' + f[1] + '</button>' }).join('') +
    '<input id="po-q" placeholder="搜尋姓名／電話／單號／門市" value="' + poEsc(poQ) + '" oninput="poQ=this.value;poDrawRows()" style="flex:1;min-width:160px">' +
    '<button class="btn btn-outline btn-sm" onclick="poCsv()">⬇ 下載寄件清單</button></div>';
  h += '<div id="po-rows">' + poRowsHtml() + '</div></div>';
  return h;
}
function poDrawRows(){ var el = document.getElementById('po-rows'); if (el) el.innerHTML = poRowsHtml() }
function poShown(){
  var q = poQ.trim().toLowerCase();
  return poOrders().filter(function(o){
    if (poFilter !== 'all' && o.status !== poFilter && !(poFilter === 'shipped' && o.status === 'done')) return false;
    if (poFilter === 'all' && o.status === 'cancel') return false;
    if (!q) return true;
    return [o.name, o.phone, o.oid, o.store, o.address, o.trackingNo, o.last5, o.gift].join(' ').toLowerCase().indexOf(q) >= 0;
  });
}
function poRowsHtml(){
  var list = poShown();
  if (!list.length) return '<div class="empty">' + (poOrders().length ? '沒有符合的訂單' : '還沒有人預購。把上面的連結傳給客人，或按「＋ 員工幫客人登記」。') + '</div>';
  return list.map(function(o){
    var st = PO_ST[o.status] || PO_ST.new;
    return '<div style="border:1px solid var(--border);border-left:4px solid ' + st.c + ';border-radius:10px;padding:10px 12px;margin-bottom:8px;' + (o.status === 'cancel' ? 'opacity:.55' : '') + '">' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
        '<b style="font-size:16px">' + poEsc(o.name) + '</b><span>' + poEsc(o.phone) + '</span>' +
        '<span style="background:#fff1ef;color:#a8262b;border-radius:10px;padding:1px 9px;font-weight:800">' + o.qty + ' 盒</span>' +
        (o.gift ? '<span style="background:#e6f4ec;color:#2f7d5b;border-radius:10px;padding:1px 9px;font-weight:800">🎁 要附 ' + poEsc(o.gift) + '</span>' : '') +
        '<span class="muted" style="font-size:var(--fs-xs)">' + poEsc(o.oid) + '・' + poMd(o.createdAt) + '・' + (o.src === 'web' ? '客人自己填' : '員工登記：' + poEsc(o.createdBy)) + '</span>' +
        '<select style="margin-left:auto;color:' + st.c + ';font-weight:700" onchange="poSetStatus(\'' + o.oid + '\',this.value)">' +
          Object.keys(PO_ST).map(function(k){ return '<option value="' + k + '"' + (k === o.status ? ' selected' : '') + '>' + PO_ST[k].n + '</option>' }).join('') + '</select></div>' +
      '<div style="font-size:var(--fs-sm);line-height:1.8;margin-top:4px">' +
        '📦 ' + poEsc((poData.ways || {})[o.way] || o.way) + '：<b>' + poEsc(poDest(o)) + '</b><br>' +
        '💳 ' + poEsc((poData.pays || {})[o.payWay] || '未選付款方式') + (o.last5 ? '・末五碼 <b>' + poEsc(o.last5) + '</b>' : '') +
        (o.proofImg ? '・<a href="' + poEsc(o.proofImg) + '" target="_blank">看付款截圖</a>' : '') +
        '・合計 <b>' + poMoney(o.total) + '</b>' + (o.fee ? '<span class="muted">（含運費 ' + poMoney(o.fee) + '）</span>' : '') +
        (o.paidBy ? '<span class="muted">・' + poEsc(o.paidBy) + ' 確認收款</span>' : '') +
        (o.pointsUsed ? '<br>💎 已從 <b>' + poEsc(o.pointsPhone || o.phone) + '</b> 的儲值點數扣 <b>' + o.pointsUsed + ' 點</b><span class="muted">（' + poEsc(o.pointsBy) + ' ' + poMd(o.pointsAt) + '）</span>' : '') +
        (o.pointsBackAt ? '<br><span class="muted">💎 點數已退回（' + poEsc(o.pointsBackBy) + ' ' + poMd(o.pointsBackAt) + '）</span>' : '') +
        (o.trackingNo ? '<br>🚚 託運單號 <b>' + poEsc(o.trackingNo) + '</b>' + (o.shippedBy ? '<span class="muted">（' + poEsc(o.shippedBy) + ' ' + poMd(o.shippedAt) + '）</span>' : '') : '') +
        (o.note ? '<br>📝 客人備註：' + poEsc(o.note) : '') +
        (o.staffNote ? '<br>🔒 內部備註：' + poEsc(o.staffNote) : '') + '</div>' +
      '<div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">' +
        (o.status === 'paid' ? '<button class="btn btn-ok btn-sm" onclick="poShip(\'' + o.oid + '\')">🚚 已寄出（填單號）</button>' : '') +
        (!o.pointsUsed && o.status !== 'cancel' && (o.status === 'new' || o.payWay === 'points') ? '<button class="btn btn-sm ' + (o.payWay === 'points' ? 'btn-gold' : 'btn-outline') + '" onclick="poPtOpen(\'' + o.oid + '\')">💎 用儲值點數扣</button>' : '') +
        (o.pointsUsed ? '<button class="btn btn-outline btn-sm" style="color:#c94d4d" onclick="poPtBack(\'' + o.oid + '\',this)">退回點數</button>' : '') +
        '<button class="btn btn-outline btn-sm" onclick="poCopy(\'' + poEsc(poShipText(o)).replace(/'/g, '&#39;') + '\',this)">複製寄件資料</button>' +
        '<button class="btn btn-outline btn-sm" onclick="poOpenEdit(\'' + o.oid + '\')">編輯</button></div>' +
        (poPt && poPt.oid === o.oid ? poPtHtml(o) : '') + '</div>';
  }).join('');
}
/* 💎 用儲值點數扣（2026-11-25）：先查付款人剩多少點，確認後由伺服器寫進會員明細（跟核銷扣點同一套） */
var poPt = null;   /* { oid, phone, amt, info:{member,name,points} | 'load' | 'err' , msg } */
function poPtOpen(oid){
  var o = poData.orders[oid];
  poPt = { oid: oid, phone: o.phone, amt: o.total, info: 'load', msg: '' };
  poDrawRows(); poPtLookup();
}
async function poPtLookup(){
  var p = poPt; p.info = 'load'; poDrawRows();
  try { var j = await staffApi('/staff/preorder/balance', { phone: p.phone }); if (poPt === p) p.info = j }
  catch(e) { if (poPt === p) { p.info = 'err'; p.msg = e.message } }
  if (poPt === p) poDrawRows();
}
function poPtHtml(o){
  var p = poPt, i = p.info, enough = i && i.points != null && i.points >= (+p.amt || 0);
  var st = i === 'load' ? '<span class="muted">查點數中…</span>' : i === 'err' ? '<span style="color:#c94d4d">' + poEsc(p.msg) + '</span>' :
    (!i.member ? '<span style="color:#c94d4d">這支電話不是會員，沒有儲值點數</span>' :
     poEsc(i.name || '') + ' 剩 <b style="color:' + (enough ? '#2f7d5b' : '#c94d4d') + '">' + i.points + ' 點</b>' + (enough ? '' : '・<b style="color:#c94d4d">不夠扣</b>'));
  return '<div style="margin-top:8px;padding:10px 12px;border:1.5px solid #c99a3c;border-radius:10px;background:#fffaf0;font-size:var(--fs-sm)">' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">付款人電話 <input id="po-pt-ph" value="' + poEsc(p.phone) + '" style="width:130px" inputmode="numeric">' +
    '<button class="btn btn-outline btn-sm" onclick="poPt.phone=document.getElementById(\'po-pt-ph\').value.trim();poPt.amt=document.getElementById(\'po-pt-amt\').value;poPtLookup()">查點數</button>' +
    '扣 <input id="po-pt-amt" type="number" value="' + poEsc(p.amt) + '" style="width:90px"> 點</div>' +
    '<div style="margin:6px 0">' + st + '</div><div class="muted" style="font-size:var(--fs-xs);margin-bottom:6px">1 點＝1 元，扣完會出現在會員明細「預購・…」。要用家人的點數就改上面的電話再按查點數。只扣一部分的話，剩下的錢收到後再自己把狀態改成已付款。</div>' +
    (p.msg && i !== 'err' ? '<div style="color:#c94d4d;margin-bottom:6px">' + poEsc(p.msg) + '</div>' : '') +
    '<button class="btn btn-gold btn-sm"' + (i && i.member && enough ? '' : ' disabled') + ' onclick="poPtGo(this)">確定扣點</button> ' +
    '<button class="btn btn-outline btn-sm" onclick="poPt=null;poDrawRows()">取消</button></div>';
}
async function poPtGo(btn){
  var p = poPt, ph = document.getElementById('po-pt-ph').value.trim(), amt = +document.getElementById('po-pt-amt').value;
  if (ph !== p.phone) { p.phone = ph; p.amt = amt; return poPtLookup() }   /* 改了電話還沒查，先查 */
  btn.disabled = true; p.msg = '';
  try {
    var j = await staffApi('/staff/preorder/points', { p: poP, oid: p.oid, payer: ph, amt: amt });
    poData.orders[p.oid] = j.o; poPt = null; renderPreorder();
  } catch(e) { p.amt = amt; p.msg = '扣點失敗：' + e.message; poDrawRows() }
}
async function poPtBack(oid, btn){
  var o = poData.orders[oid];
  if (!confirm('把 ' + o.pointsUsed + ' 點退回給 ' + (o.pointsPhone || o.phone) + '？\n會在會員明細加一筆「退回預購點數」。')) return;
  btn.disabled = true;
  try { var j = await staffApi('/staff/preorder/points', { p: poP, oid: oid, undo: true }); poData.orders[oid] = j.o; renderPreorder() }
  catch(e) { alert('退回失敗：' + e.message); btn.disabled = false }
}
function poShipText(o){ return o.name + ' ' + o.phone + ' ' + poDest(o) + ' ' + o.qty + '盒' + (o.gift ? '＋' + o.gift : '') }
function poToday(){ return new Date(Date.now() + 288e5).toISOString().slice(0, 10) }
function poCopy(t, btn){
  var ok = function(){ var o = btn.textContent; btn.textContent = '已複製 ✓'; setTimeout(function(){ btn.textContent = o }, 1500) };
  if (navigator.clipboard) navigator.clipboard.writeText(t).then(ok, function(){ prompt('複製這段', t) }); else prompt('複製這段', t);
}
async function poSaveOrder(o){
  var j = await staffApi('/staff/preorder/save', { p: poP, o: o });
  poData.orders = poData.orders || {}; poData.orders[j.o.oid] = j.o;
  return j.o;
}
async function poSetStatus(oid, st){
  var o = Object.assign({}, poData.orders[oid], { status: st });
  try { await poSaveOrder(o) } catch(e) { alert('存不進去：' + e.message) }
  renderPreorder();
}
async function poShip(oid){
  var no = prompt('託運單號（沒有可以留空）', poData.orders[oid].trackingNo || '');
  if (no === null) return;
  var o = Object.assign({}, poData.orders[oid], { status: 'shipped', trackingNo: no.trim() });
  try { await poSaveOrder(o) } catch(e) { alert('存不進去：' + e.message) }
  renderPreorder();
}
/* 寄件清單：Excel 打得開的 CSV（前面加 BOM 中文才不會亂碼），照目前的篩選 */
function poCsv(){
  var q = function(v){ return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"' };
  var lines = [['單號', '狀態', '姓名', '電話', '盒數', '加贈', '寄送方式', '門市／地址', '付款方式', '末五碼', '合計', '託運單號', '客人備註', '內部備註', '填單時間'].map(q).join(',')];
  poShown().forEach(function(o){
    lines.push([o.oid, (PO_ST[o.status] || {}).n, o.name, "'" + o.phone, o.qty, o.gift || '', (poData.ways || {})[o.way], poDest(o), (poData.pays || {})[o.payWay] || '', o.last5,
      o.total, o.trackingNo, o.note, o.staffNote, poMd(o.createdAt)].map(q).join(','));
  });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  a.download = String((poData.cfg || {}).title || '預購').replace(/[\\/:*?"<>|，, ]/g, '') + '_寄件清單.csv'; a.click();
}

/* ── 新增／編輯一筆 ── */
function poOpenEdit(oid){
  var c = poData.cfg || {}, firstWay = Object.keys(c.ways || {}).filter(function(k){ return c.ways[k].on })[0] || 'seven';
  poEditing = oid ? Object.assign({}, poData.orders[oid]) : { qty:1, way:firstWay, payWay:'', status:'new',
    gift: poAutoGift(1) };
  if (poEditing.gift == null) poEditing.gift = '';
  poView = 'edit'; renderPreorder();
}
/* 今天下單會送什麼：11/30 前才有；每盒送就照盒數 */
function poAutoGift(qty){
  var c = (poData && poData.cfg) || {};
  if (!c.promoText || !c.promoUntil || poToday() > c.promoUntil) return '';
  return c.promoText + ' ×' + (c.promoPer === 'box' ? Math.max(1, +qty || 1) : 1);
}
/* 員工改盒數時，加贈欄如果還是自動帶的那個值，就跟著盒數改；手動改過就不動 */
function poQtyChanged(el){
  var g = document.getElementById('po-f-gift'); if (!g || poEditing.oid && !poEditing._new) return;
  if (g.value === poEditing._autoGift || g.value === poAutoGift(1) || g.value === '') { g.value = poAutoGift(el.value); poEditing._autoGift = g.value }
}
function poFormHtml(){
  var o = poEditing, c = poData.cfg || {}, isNew = !o.oid;
  var fld = function(label, html){ return '<div style="margin-bottom:10px"><div class="muted" style="font-size:var(--fs-xs);margin-bottom:3px">' + label + '</div>' + html + '</div>' };
  var inp = function(k, ph, type){ return '<input id="po-f-' + k + '" type="' + (type || 'text') + '" value="' + poEsc(o[k] == null ? '' : o[k]) + '" placeholder="' + (ph || '') + '" style="width:100%">' };
  var sel = function(k, map, extra){ return '<select id="po-f-' + k + '" style="width:100%" ' + (extra || '') + '>' + Object.keys(map).map(function(x){ return '<option value="' + x + '"' + (o[k] === x ? ' selected' : '') + '>' + poEsc(map[x].n || map[x]) + '</option>' }).join('') + '</select>' };
  var pays = Object.assign({ '': '還沒付／未選' }, poData.pays || {});
  return '<div class="card" style="max-width:620px"><div class="card-title">' + (isNew ? '＋ 員工幫客人登記' : '編輯預購 ' + poEsc(o.oid)) + '</div>' +
    fld('盒數', inp('qty', '', 'number').replace('<input ', '<input oninput="poQtyChanged(this)" ')) +
    '<div style="display:flex;gap:10px"><div style="flex:1">' + fld('姓名', inp('name', '收件人姓名')) + '</div><div style="flex:1">' + fld('電話', inp('phone', '09xxxxxxxx', 'tel')) + '</div></div>' +
    fld('寄送方式', sel('way', poData.ways || {}, 'onchange="poEditing.way=this.value;poKeepForm();renderPreorder()"')) +
    (o.way === 'seven' ? fld('7-11 門市（店名或店號）', inp('store', '例如：南屯門市')) : '') +
    (o.way === 'post' ? fld('郵寄地址', inp('address', '縣市＋區＋路名門牌')) : '') +
    '<div style="display:flex;gap:10px"><div style="flex:1">' + fld('付款方式', sel('payWay', pays)) + '</div><div style="flex:1">' + fld('匯款末五碼', inp('last5', '5 位數字', 'tel')) + '</div></div>' +
    fld('付款截圖', (o.proofImg ? '<a href="' + poEsc(o.proofImg) + '" target="_blank"><img src="' + poEsc(o.proofImg) + '" style="height:70px;border-radius:6px;vertical-align:middle;margin-right:8px"></a>' : '') +
      '<input type="file" accept="image/*" onchange="poUpProof(this)">' + '<span id="po-up-st" class="muted" style="font-size:var(--fs-xs);margin-left:6px"></span>') +
    '<div style="display:flex;gap:10px"><div style="flex:1">' + fld('狀態', sel('status', PO_ST)) + '</div><div style="flex:1">' + fld('託運單號', inp('trackingNo', '寄出後填')) + '</div></div>' +
    fld('🎁 加贈（' + (c.promoUntil ? poEsc(c.promoUntil) + ' 前下單才送，' : '') + '沒送就清空；每盒送的話數字自己改）', inp('gift', '例如：木盤材料包 ×1')) +
    fld('合計金額（留空＝自動算：' + (c.price ? '每盒 ' + poMoney(o.price || c.price) + '＋運費' : '還沒設價格') + '）', inp('total', '自動', 'number')) +
    fld('客人備註', inp('note', '')) + fld('內部備註（客人看不到）', inp('staffNote', '')) +
    '<div id="po-f-err" style="color:#c94d4d;font-size:var(--fs-sm);margin-bottom:8px"></div>' +
    '<div style="display:flex;gap:8px"><button class="btn btn-gold" onclick="poSubmitForm(this)">存檔</button>' +
    '<button class="btn btn-outline" onclick="poView=\'list\';renderPreorder()">取消</button>' +
    (isNew ? '' : '<button class="btn btn-outline" style="margin-left:auto;color:#c94d4d" onclick="poDelete()">刪除這筆</button>') + '</div></div>';
}
function poKeepForm(){
  ['qty', 'name', 'phone', 'store', 'address', 'payWay', 'last5', 'status', 'trackingNo', 'gift', 'total', 'note', 'staffNote'].forEach(function(k){
    var el = document.getElementById('po-f-' + k); if (el) poEditing[k] = el.value;
  });
}
function poShrink(file, max){
  return new Promise(function(ok, bad){ var u = URL.createObjectURL(file), im = new Image();
    im.onload = function(){ var s = Math.min(1, max / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * s); cv.height = Math.round(im.height * s); cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      URL.revokeObjectURL(u); ok(cv.toDataURL('image/jpeg', .82)) };
    im.onerror = function(){ URL.revokeObjectURL(u); bad(new Error('這張圖讀不到')) }; im.src = u });
}
async function poUpProof(inp){
  var f = inp.files && inp.files[0]; if (!f) return;
  var st = document.getElementById('po-up-st'); st.textContent = '上傳中…';
  try {
    poKeepForm();
    if (!poEditing.oid) { poEditing.oid = 'P' + Date.now().toString(36).toUpperCase(); poEditing._new = true }
    var j = await staffApi('/staff/preorder/img', { p: poP, oid: poEditing.oid, dataUrl: await poShrink(f, 1400) });
    poEditing.proofImg = j.url; renderPreorder();
  } catch(e) { st.textContent = '上傳失敗：' + e.message }
}
async function poSubmitForm(btn){
  poKeepForm();
  var o = Object.assign({}, poEditing), err = document.getElementById('po-f-err');
  delete o._autoGift;
  if (o._new) { delete o.oid; delete o._new }   /* 先傳截圖時借的單號不算數，存檔時伺服器重新給一個 */
  btn.disabled = true; err.textContent = '';
  try { await poSaveOrder(o); poView = 'list'; poEditing = null; renderPreorder() }
  catch(e) { err.textContent = e.message; btn.disabled = false }
}
async function poDelete(){
  if (!confirm('確定刪除 ' + poEditing.name + ' 這筆預購？刪了就找不回來。\n（客人只是不要了，建議改成「取消」就好）')) return;
  try { await staffApi('/staff/preorder/delete', { p: poP, oid: poEditing.oid }); delete poData.orders[poEditing.oid]; poView = 'list'; renderPreorder() }
  catch(e) { alert('刪不掉：' + e.message) }
}

/* ── 商品設定 ── */
function poOpenCfg(){ poCfgDraft = JSON.parse(JSON.stringify(poData.cfg || {})); poCfgDraft.ways = poCfgDraft.ways || {}; poView = 'cfg'; renderPreorder() }
function poCfgHtml(){
  var c = poCfgDraft;
  var fld = function(label, html, tip){ return '<div style="margin-bottom:12px"><div class="muted" style="font-size:var(--fs-xs);margin-bottom:3px">' + label + '</div>' + html +
    (tip ? '<div class="muted" style="font-size:var(--fs-xs);margin-top:3px">' + tip + '</div>' : '') + '</div>' };
  var inp = function(k, type, ph){ return '<input id="po-c-' + k + '" type="' + (type || 'text') + '" value="' + poEsc(c[k] == null ? '' : c[k]) + '" placeholder="' + (ph || '') + '" style="width:100%">' };
  var ta = function(k, ph){ return '<textarea id="po-c-' + k + '" rows="3" placeholder="' + (ph || '') + '" style="width:100%">' + poEsc(c[k] || '') + '</textarea>' };
  var ways = Object.keys(poData.ways || {}).map(function(k){ var w = c.ways[k] || {};
    return '<label style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><input type="checkbox" id="po-cw-' + k + '"' + (w.on ? ' checked' : '') + '> ' +
      '<span style="width:110px">' + poEsc(poData.ways[k]) + '</span>運費 <input id="po-cf-' + k + '" type="number" value="' + (w.fee || 0) + '" style="width:90px"> 元</label>' }).join('');
  return '<div class="card" style="max-width:640px"><div class="card-title">⚙️ 商品設定（' + poEsc(poP) + '）</div>' +
    '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:12px">這裡改完，客人那頁重新整理就會看到。已經下單的人金額不會跟著變。</div>' +
    fld('商品名稱', inp('title')) + fld('一句話介紹', ta('desc')) +
    fld('商品圖（海報）', (c.img ? '<img src="' + poEsc(c.img) + '" style="height:110px;border-radius:8px;display:block;margin-bottom:6px">' : '') +
      '<input type="file" accept="image/*" onchange="poUpCover(this)"><span id="po-cv-st" class="muted" style="font-size:var(--fs-xs);margin-left:6px"></span>') +
    '<div style="display:flex;gap:10px"><div style="flex:1">' + fld('每盒價格', inp('price', 'number')) + '</div><div style="flex:1">' + fld('一人最多幾盒', inp('maxQty', 'number')) + '</div></div>' +
    fld('寄送方式（打勾的才會給客人選）', ways) +
    fld('匯款帳號（客人頁會照這段顯示）', ta('bank', '戶名、銀行、代碼、帳號')) +
    fld('LINE Pay 說明', inp('linePay')) + fld('LINE Pay 付款連結', inp('linePayUrl', 'url', 'https://…')) +
    '<div style="display:flex;gap:10px;flex-wrap:wrap"><div style="flex:2;min-width:180px">' + fld('🎁 限時加贈（選填）', inp('promoText', 'text', '例如：木盤材料包')) + '</div>' +
    '<div style="flex:1;min-width:140px">' + fld('送到哪天（含）', inp('promoUntil', 'date')) + '</div>' +
    '<div style="flex:1;min-width:140px">' + fld('送幾份', '<select id="po-c-promoPer" style="width:100%"><option value="order"' + (c.promoPer !== 'box' ? ' selected' : '') +
      '>每筆訂單送 1 份</option><option value="box"' + (c.promoPer === 'box' ? ' selected' : '') + '>每盒送 1 份</option></select>') + '</div></div>' +
    fld('給客人的注意事項（選填）', ta('note', '例如：12/10 統一寄出')) +
    '<div style="display:flex;gap:10px;align-items:flex-end"><div style="flex:1">' + fld('預購截止日（選填，過了自動關）', inp('deadline', 'date')) + '</div>' +
    '<label style="flex:1;margin-bottom:16px"><input type="checkbox" id="po-c-open"' + (c.open !== false ? ' checked' : '') + '> 開放預購</label></div>' +
    '<div id="po-c-err" style="color:#c94d4d;font-size:var(--fs-sm);margin-bottom:8px"></div>' +
    '<div style="display:flex;gap:8px"><button class="btn btn-gold" onclick="poSaveCfg(this)">存檔</button><button class="btn btn-outline" onclick="poView=\'list\';renderPreorder()">取消</button></div></div>';
}
function poKeepCfg(){
  var c = poCfgDraft;
  ['title', 'desc', 'price', 'maxQty', 'bank', 'linePay', 'linePayUrl', 'promoText', 'promoUntil', 'promoPer', 'note', 'deadline'].forEach(function(k){ var el = document.getElementById('po-c-' + k); if (el) c[k] = el.value });
  var op = document.getElementById('po-c-open'); if (op) c.open = op.checked;
  Object.keys(poData.ways || {}).forEach(function(k){ var on = document.getElementById('po-cw-' + k), fee = document.getElementById('po-cf-' + k);
    if (on) c.ways[k] = { on: on.checked, fee: +fee.value || 0 } });
}
async function poUpCover(inp){
  var f = inp.files && inp.files[0]; if (!f) return;
  var st = document.getElementById('po-cv-st'); st.textContent = '上傳中…';
  try { poKeepCfg(); var j = await staffApi('/staff/preorder/img', { p: poP, dataUrl: await poShrink(f, 1400) }); poCfgDraft.img = j.url; renderPreorder() }
  catch(e) { st.textContent = '上傳失敗：' + e.message }
}
async function poSaveCfg(btn){
  poKeepCfg(); btn.disabled = true;
  try { var j = await staffApi('/staff/preorder/cfg', { p: poP, cfg: poCfgDraft }); poData.cfg = j.cfg; poView = 'list'; renderPreorder() }
  catch(e) { document.getElementById('po-c-err').textContent = e.message; btn.disabled = false }
}
