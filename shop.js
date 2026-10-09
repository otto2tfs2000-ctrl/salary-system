/* ══════════════════════════════════════════════════════════
   選品館分頁（2026-10-07）
   遊樂島裡的「藝享選品館」：家長用紅利點數兌換商品。商品、分類、店員臺詞都在這裡管理。
   資料在 otto2-booking-f9ef7 的 shop/ 底下，一律透過伺服器（/staff/shop*）讀寫。
   兌換＝扣紅利＋發一張兌換券（會員資料的票券）；客人來店出示時，在「兌換紀錄」按「已使用」核銷。
   ══════════════════════════════════════════════════════════ */
var shData = null, shTab = 'products', shEdit = null, shTkts = {}, shBusy = false;

function shEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function shInp(id, v, type, w, ph){
  return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + shEsc(v) + '"' + (ph ? ' placeholder="' + shEsc(ph) + '"' : '') +
    ' style="width:' + (w || 160) + 'px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px">';
}
function shRow(label, body, hint){
  return '<div style="display:flex;gap:10px;align-items:flex-start;flex-wrap:wrap;padding:9px 0;border-top:1px solid var(--border)">' +
    '<div style="width:96px;flex:none;font-size:13.5px;padding-top:7px;color:var(--text2)">' + label + '</div>' +
    '<div style="flex:1 1 220px">' + body + (hint ? '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.6">' + hint + '</div>' : '') + '</div></div>';
}
/* 現金 → 紅利點數：每 yuanPerPt 元 = 1 點，四捨五入到 ptStep 的倍數（至少 1 個級距） */
function shRate(){ var c = (shData && shData.cfg) || {}; return { y: Math.max(1, Number(c.yuanPerPt) || 7), s: [1, 5, 10].indexOf(Number(c.ptStep)) >= 0 ? Number(c.ptStep) : 5 } }
function shCashToPts(cash){
  var r = shRate(), n = Number(cash);
  if (!(n > 0)) return '';
  return Math.max(r.s, Math.round(n / r.y / r.s) * r.s);
}
function shCashFill(cashId, ptId, noteId){
  var c = document.getElementById(cashId).value, p = shCashToPts(c);
  if (p !== '') document.getElementById(ptId).value = p;
  var n = document.getElementById(noteId);
  if (n) n.textContent = p === '' ? '' : '→ 自動換算 ' + p + ' 點（可再手動改）';
}
function shCatName(id){
  var c = ((shData && shData.cfg.cats) || []).filter(function(x){ return x.id === id })[0];
  return c ? c.nm : '（未分類）';
}
async function shLoad(){
  shData = await staffApi('/staff/shop', {});
}
async function renderShop(){
  var el = document.getElementById('shop-body');
  if (!el) return;
  if (!shData) {
    el.innerHTML = '<div class="empty">載入選品館資料中…</div>';
    try { await shLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + shEsc(e.message) + '</div>'; return }
  }
  var tabs = [['products','商品'],['cfg','分類與臺詞'],['redeems','兌換紀錄']];
  var h = '<div class="store-tabs" style="margin-bottom:14px">' + tabs.map(function(t){
    return '<button class="store-btn' + (shTab === t[0] ? ' active' : '') + '" onclick="shSwitch(\'' + t[0] + '\')">' + t[1] + '</button>' }).join('') +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="shReload()">↻ 重新讀取</button></div>';
  if (shData.cfg.open === false) h += '<div class="card" style="background:#fff0f0;border-color:#e8b4b4;font-size:13px;margin-bottom:14px">⚠️ 目前是「休息中」：客人點進選品館只會看到休息的提示（到「分類與臺詞」改回營業）。</div>';
  var oa = shData.cfg.openAt;
  if (oa && oa > new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 16)) h += '<div class="card" style="background:#fff8e1;border-color:#e6cf8a;font-size:13px;margin-bottom:14px">⏳ 還沒開幕：<b>' + shEsc(oa.replace('T', ' ')) + '</b> 才開門。在這之前客人點店面只會看到「還沒開店」的店員（到「分類與臺詞」可改時間）。</div>';
  h += shTab === 'cfg' ? shCfgHtml() : shTab === 'redeems' ? shRedeemHtml() : (shEdit ? shFormHtml() : shListHtml());
  el.innerHTML = h;
  if (shTab === 'redeems') shLoadTkts();
  var cb = document.getElementById('sh-cash'), sb = document.getElementById('sh-sc');
  if (cb) cb.oninput = function(){ shCashFill('sh-cash', 'sh-price', 'sh-cashn') };
  if (sb) sb.oninput = function(){ shCashFill('sh-sc', 'sh-sp', 'sh-scn') };
}
function shSwitch(t){ shTab = t; shEdit = null; renderShop() }
async function shReload(){ shData = null; shEdit = null; await renderShop() }

/* ── 商品清單 ── */
function shPriceTxt(p){
  var sl = p.sale, t = (shData && shData.today) || '';
  var on = sl && sl.from && sl.to && sl.from <= t && t <= sl.to;
  return on ? '<s style="color:#999">' + p.price + '</s> <b style="color:#d6453b">' + sl.price + '</b> 點（優惠到 ' + sl.to.slice(5).replace('-','/') + '）'
    : '<b>' + p.price + '</b> 點' + (p.cash ? '<span class="muted" style="font-size:12px">（現金 ' + p.cash + ' 元）</span>' : '') + (sl && sl.from ? '<span class="muted" style="font-size:12px">　優惠 ' + sl.price + ' 點：' + sl.from.slice(5).replace('-','/') + '～' + sl.to.slice(5).replace('-','/') + '</span>' : '');
}
/* ── 商品順序：拖曳卡片（電腦）或按 ▲▼（手機也行）。順序就是客人在選品館看到的順序 ── */
var shCatF = '', shDragId = '';
function shSorted(){ return (shData.products || []).slice().sort(function(a, b){ return (Number(a.order) || 0) - (Number(b.order) || 0) }) }
async function shSaveOrder(ids){
  /* 先在畫面上改好（馬上看到），再通知伺服器；失敗就重新讀 */
  ids.forEach(function(id, i){ var p = (shData.products || []).filter(function(x){ return x.id === id })[0]; if (p) p.order = (i + 1) * 10 });
  shData.products = shSorted(); renderShop();
  try { await staffApi('/staff/shop/reorder', { ids: ids }) } catch(e) { alert('順序沒存成功：' + e.message); shReload() }
}
function shMove(id, dir){
  var all = shSorted().map(function(p){ return p.id });
  var sub = shSorted().filter(function(p){ return !shCatF || p.cat === shCatF }).map(function(p){ return p.id });
  var i = sub.indexOf(id), j = i + dir; if (i < 0 || j < 0 || j >= sub.length) return;
  var a = all.indexOf(id), b = all.indexOf(sub[j]); all[a] = sub[j]; all[b] = id;
  shSaveOrder(all);
}
function shMoveTop(id){
  var all = shSorted().map(function(p){ return p.id });
  var sub = shSorted().filter(function(p){ return !shCatF || p.cat === shCatF }).map(function(p){ return p.id });
  if (!sub.length || sub[0] === id) return;
  all.splice(all.indexOf(id), 1); all.splice(all.indexOf(sub[0]), 0, id);
  shSaveOrder(all);
}
function shDrop(targetId){
  var d = shDragId; shDragId = '';
  if (!d || d === targetId) return;
  var all = shSorted().map(function(p){ return p.id });
  all.splice(all.indexOf(d), 1); all.splice(all.indexOf(targetId), 0, d);
  shSaveOrder(all);
}
function shListHtml(){
  var list = shSorted();
  var rank = {}; list.forEach(function(p, i){ rank[p.id] = i + 1 });
  var cats = shData.cfg.cats || [];
  if (shCatF) list = list.filter(function(p){ return p.cat === shCatF });
  var h = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">' +
    '<button class="btn btn-gold" onclick="shNew()">＋ 新增商品</button>' +
    '<span class="muted" style="font-size:12.5px">共 ' + list.length + ' 項。<b>拖曳卡片</b>或按 <b>▲▼</b> 調整順序，客人看到的順序就是這裡的順序；沒勾「上架」客人看不到。</span></div>' +
    (cats.length ? '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">' + [{ id:'', nm:'全部' }].concat(cats).map(function(c){ return '<button class="btn ' + (shCatF === c.id ? 'btn-gold' : 'btn-outline') + ' btn-sm" onclick="shCatF=\'' + c.id + '\';renderShop()">' + shEsc(c.nm) + '</button>' }).join('') + '</div>' : '');
  if (!shData.cloudinary) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;margin-bottom:10px">伺服器還沒設定 Cloudinary，商品照片暫時不能上傳（可以先用圖片網址）。</div>';
  if (!list.length) return h + '<div class="empty">還沒有商品。按上面「＋ 新增商品」開始上架。</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">';
  list.forEach(function(p){
    h += '<div class="card" draggable="true" ondragstart="shDragId=\'' + p.id + '\'" ondragover="event.preventDefault()" ondrop="event.preventDefault();shDrop(\'' + p.id + '\')" style="display:flex;gap:12px;align-items:flex-start;cursor:grab;' + (p.active === false ? 'opacity:.55' : '') + '">' +
      '<div style="width:78px;height:78px;flex:none;border-radius:10px;background:#efe8d8 center/cover no-repeat;' + (p.img ? "background-image:url('" + shEsc(p.img) + "')" : '') + '">' + (p.img ? '' : '<div style="text-align:center;line-height:78px;font-size:26px">🎁</div>') + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px"><span style="display:inline-block;min-width:22px;text-align:center;font-size:12px;background:#f0ece2;color:var(--text2);border-radius:10px;padding:0 6px;margin-right:6px;vertical-align:1px">' + rank[p.id] + '</span>' + shEsc(p.nm) + (p.active === false ? ' <span class="muted" style="font-size:12px">（已下架）</span>' : '') + '</div>' +
      '<div class="muted" style="font-size:12px;margin:2px 0">' + shEsc(shCatName(p.cat)) + '</div>' +
      '<div style="font-size:13.5px">' + shPriceTxt(p) + '</div>' +
      '<div class="muted" style="font-size:12px;margin-top:2px">庫存 ' + (p.stock == null ? '不限' : p.stock) + '　每人限兌 ' + (p.perPerson ? p.perPerson + ' 次' : '不限') + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:6px"><button class="btn btn-outline btn-sm" onclick="shOpen(\'' + p.id + '\')">編輯</button>' +
      '<button class="btn btn-outline btn-sm" onclick="shToggle(\'' + p.id + '\')">' + (p.active === false ? '重新上架' : '下架') + '</button></div>' +
      '<div style="margin-top:6px;display:flex;gap:6px;align-items:center"><button class="btn btn-outline btn-sm" title="往前" onclick="shMove(\'' + p.id + '\',-1)">▲</button><button class="btn btn-outline btn-sm" title="往後" onclick="shMove(\'' + p.id + '\',1)">▼</button><button class="btn btn-outline btn-sm" onclick="shMoveTop(\'' + p.id + '\')">移到最前</button></div></div></div>';
  });
  return h + '</div>';
}
function shNew(){
  shEdit = { id: 'p' + Date.now().toString(36), nm: '', cat: ((shData.cfg.cats || [])[0] || {}).id || '', img: '', desc: '', price: '', sale: null, stock: null, perPerson: 0, active: true, order: ((shData.products || []).length + 1) * 10, isNew: true };
  renderShop();
}
function shOpen(id){
  var p = (shData.products || []).filter(function(x){ return x.id === id })[0];
  if (!p) return;
  shEdit = JSON.parse(JSON.stringify(p)); renderShop();
}
async function shToggle(id){
  var p = (shData.products || []).filter(function(x){ return x.id === id })[0];
  if (!p) return;
  try { await staffApi('/staff/shop/product', { product: Object.assign({}, p, { active: p.active === false }) }); await shReload() } catch(e) { alert('失敗：' + e.message) }
}

/* ── 商品表單 ── */
function shFormHtml(){
  var p = shEdit, sl = p.sale || {};
  var cats = (shData.cfg.cats || []).map(function(c){ return '<option value="' + shEsc(c.id) + '"' + (p.cat === c.id ? ' selected' : '') + '>' + shEsc(c.nm) + '</option>' }).join('');
  var h = '<div class="card"><div class="card-title">' + (p.isNew ? '新增商品' : '編輯商品') + '</div>' +
    shRow('名稱', shInp('sh-nm', p.nm, 'text', 260, '例：陶瓷杯')) +
    shRow('分類', '<select id="sh-cat" style="padding:7px;border:1px solid var(--border);border-radius:6px;font-size:14px">' + (cats || '<option value="">（先到「分類與臺詞」新增分類）</option>') + '</select>') +
    shRow('照片', '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div id="sh-pv" style="width:96px;height:96px;border-radius:12px;background:#efe8d8 center/cover no-repeat;' + (p.img ? "background-image:url('" + shEsc(p.img) + "')" : '') + '"></div>' +
      '<div><input id="sh-file" type="file" accept="image/*" onchange="shPickImg(this)"><div id="sh-st" class="muted" style="font-size:12px;margin-top:4px"></div></div></div>' +
      '<div style="margin-top:6px">或貼圖片網址：' + shInp('sh-img', p.img, 'text', 300, 'https://…') + '</div>', '照片會自動縮小、傳到 Cloudinary。正方形的圖最好看。') +
    shRow('說明', shInp('sh-desc', p.desc, 'text', 320, '（選填，短短一句）')) +
    shRow('現金售價', shInp('sh-cash', p.cash || '', 'number', 90) + ' 元 <span id="sh-cashn" class="muted" style="font-size:12.5px"></span>',
      '輸入這項商品的現金價格，下面的兌換點數會自動算出來（目前公式：每 <b>' + shRate().y + '</b> 元 = 1 點，進位到 ' + shRate().s + ' 的倍數；到「分類與臺詞」可以改）。') +
    shRow('兌換點數', shInp('sh-price', p.price, 'number', 90) + ' 點', '客人實際要付的紅利點數。自動算出來後想調整可以直接改數字。') +
    shRow('限時優惠', '優惠現金價 ' + shInp('sh-sc', sl.cash || '', 'number', 80) + ' 元 → 優惠點數 ' + shInp('sh-sp', sl.price == null ? '' : sl.price, 'number', 80) + ' 點 <span id="sh-scn" class="muted" style="font-size:12.5px"></span><br>從 ' + shInp('sh-sf', sl.from || '', 'date', 150) + ' 到 ' + shInp('sh-st2', sl.to || '', 'date', 150),
      '三格都填才會生效；期間過了自動恢復原價。不要優惠就全部留空。') +
    shRow('庫存', shInp('sh-stock', p.stock == null ? '' : p.stock, 'number', 90) + ' 件', '空白＝不限量。每兌換一次自動減 1，減到 0 客人看到「換完了」。') +
    shRow('每人限兌', shInp('sh-pp', p.perPerson || 0, 'number', 80) + ' 次', '0＝不限。') +
    shRow('排序', shInp('sh-order', p.order, 'number', 80), '數字小的排前面。平常不用改這格，回商品列表拖曳或按 ▲▼ 就好。') +
    shRow('上架', '<label style="display:flex;gap:6px;align-items:center"><input id="sh-act" type="checkbox"' + (p.active !== false ? ' checked' : '') + '> 客人看得到、可以兌換</label>') +
    '</div><div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">' +
    '<button class="btn btn-gold" onclick="shSaveProduct()">💾 儲存</button>' +
    '<button class="btn btn-outline" onclick="shEdit=null;renderShop()">取消</button>' +
    (p.isNew ? '' : '<button class="btn btn-del" style="margin-left:auto" onclick="shDelProduct()">刪除商品</button>') + '</div>';
  return h;
}
function shCollect(){
  var g = function(i){ return document.getElementById(i) };
  var p = shEdit;
  p.nm = g('sh-nm').value.trim(); p.cat = g('sh-cat').value; p.img = g('sh-img').value.trim(); p.desc = g('sh-desc').value.trim();
  p.cash = g('sh-cash').value; p.price = g('sh-price').value; p.stock = g('sh-stock').value === '' ? null : g('sh-stock').value;
  p.perPerson = g('sh-pp').value; p.order = g('sh-order').value; p.active = g('sh-act').checked;
  var sp = g('sh-sp').value, sf = g('sh-sf').value, st = g('sh-st2').value;
  p.sale = (sp === '' && !sf && !st) ? null : { price: sp, from: sf, to: st, cash: g('sh-sc').value };
}
async function shSaveProduct(){
  if (shBusy) return;
  shCollect();
  var p = shEdit;
  if (!p.nm) { alert('請填商品名稱'); return }
  if (p.price === '' || isNaN(+p.price)) { alert('請填現金售價或兌換點數（數字）'); return }
  if (p.sale && (p.sale.price === '' || !p.sale.from || !p.sale.to)) { alert('限時優惠要把「優惠價、開始日、結束日」三格都填，或全部清空'); return }
  shBusy = true;
  try {
    var out = Object.assign({}, p); delete out.isNew;
    await staffApi('/staff/shop/product', { product: out });
    shEdit = null; shData = null; await renderShop();
  } catch(e) { alert('儲存失敗：' + e.message) }
  shBusy = false;
}
async function shDelProduct(){
  var p = shEdit;
  if (!confirm('確定刪除「' + p.nm + '」？\n\n已兌換出去的券不受影響。想暫時不賣的話，改「下架」就好。')) return;
  try { await staffApi('/staff/shop/delete', { id: p.id }); shEdit = null; shData = null; await renderShop() } catch(e) { alert('刪除失敗：' + e.message) }
}
/* 選照片：縮到最長邊 900px、轉 JPEG，再傳伺服器放 Cloudinary */
function shPickImg(inp){
  var f = inp.files && inp.files[0]; if (!f) return;
  var st = document.getElementById('sh-st'); st.textContent = '處理照片中…';
  var rd = new FileReader();
  rd.onload = function(){
    var im = new Image();
    im.onload = async function(){
      var k = Math.min(1, 900 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      var url = cv.toDataURL('image/jpeg', .86);
      try {
        st.textContent = '上傳中…';
        var j = await staffApi('/staff/shop/img', { id: shEdit.id, dataUrl: url });
        document.getElementById('sh-img').value = j.url;
        document.getElementById('sh-pv').style.backgroundImage = "url('" + j.url + "')";
        st.textContent = '✅ 照片已上傳（記得按下面「儲存」）';
      } catch(e) { st.textContent = '❌ ' + e.message }
    };
    im.onerror = function(){ st.textContent = '❌ 這個檔案打不開' };
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
}

/* ── 分類與臺詞 ── */
function shCfgHtml(){
  var c = shData.cfg;
  var h = '<div class="card"><div class="card-title">店面與店員臺詞</div>' +
    shRow('店名', shInp('shc-name', c.name, 'text', 220)) +
    shRow('副標', shInp('shc-sub', c.sub, 'text', 320), '商品頁標題下面那行小字。') +
    shRow('店員說', shInp('shc-gr', c.greeting, 'text', 220), '客人點店面，店員對話框的大字。') +
    shRow('店員補一句', shInp('shc-gs', c.greetingSub, 'text', 320), '對話框的小字，可以換成活動訊息（例：十月限定，全館優惠中）。') +
    shRow('兌換券期限', shInp('shc-exp', c.expiryDays, 'number', 80) + ' 天', '客人兌換後，這張券幾天內要來店領取。') +
    shRow('開幕時間', shInp('shc-openat', c.openAt || '', 'datetime-local', 220) + ' <button class="btn btn-outline btn-sm" type="button" onclick="document.getElementById(\'shc-openat\').value=\'\'">清除（馬上開）</button>',
      '設定後，<b>到這個時間之前</b>客人點店面，會看到另一位店員說「還沒開店」，進不了商品頁；時間一到自動開門，不用再回來改。留空＝不限（照下面「營業中」）。') +
    shRow('沒開店時說', shInp('shc-cl', c.closedLine, 'text', 220), '店員對話框的大字。') +
    shRow('沒開店補一句', shInp('shc-cs', c.closedSub, 'text', 320), '小字。寫 <b>{openAt}</b> 會自動換成上面設定的開幕時間（例：10月16日 上午10:00）。') +
    shRow('營業中', '<label style="display:flex;gap:6px;align-items:center"><input id="shc-open" type="checkbox"' + (c.open !== false ? ' checked' : '') + '> 勾選＝營業；取消＝客人看到「暫時休息中」</label>') + '</div>';
  var r = shRate();
  h += '<div class="card"><div class="card-title">兌換點數換算公式</div>' +
    shRow('換算比例', '每 ' + shInp('shc-yen', r.y, 'number', 70) + ' 元 = 1 點　點數進位到 <select id="shc-step" style="padding:7px;border:1px solid var(--border);border-radius:6px;font-size:14px">' +
      [1, 5, 10].map(function(n){ return '<option value="' + n + '"' + (r.s === n ? ' selected' : '') + '>' + n + '</option>' }).join('') + '</select> 的倍數',
      '新增／編輯商品時，輸入現金售價就會用這個公式自動算兌換點數。<b>只影響後台填表，已上架的商品點數不會被改。</b><br>' +
      '範例：' + [99, 199, 299, 599].map(function(n){ return n + ' 元 → <b>' + shCashToPts(n) + '</b> 點' }).join('　') +
      '<br>（遊戲紅利是免費送的，每人每月大約最多 30 點，所以 20～30 點的商品玩家一個月內換得到；定越高越要靠真實消費累積。）') + '</div>';
  h += '<div class="card"><div class="card-title">商品分類</div><div class="muted" style="font-size:12.5px;margin-bottom:8px">客人在商品頁看到的分類標籤（前面固定有「全部」）。刪除分類不會刪商品，商品會變成「未分類」，只在「全部」裡看得到。</div>';
  (c.cats || []).forEach(function(x, i){
    h += '<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid var(--border)">' +
      '<span class="muted" style="width:20px">' + (i + 1) + '</span>' + shInp('shc-cat-' + i, x.nm, 'text', 180) +
      '<button class="btn btn-outline btn-sm" onclick="shCatMove(' + i + ',-1)">↑</button><button class="btn btn-outline btn-sm" onclick="shCatMove(' + i + ',1)">↓</button>' +
      '<button class="btn btn-del btn-sm" onclick="shCatDel(' + i + ')">刪除</button></div>';
  });
  h += '<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="shCatAdd()">＋ 新增分類</button></div>' +
    '<div style="margin-top:12px"><button class="btn btn-gold" onclick="shSaveCfg()">💾 儲存</button></div>';
  return h;
}
function shCfgCollect(){
  var g = function(i){ return document.getElementById(i) }, c = shData.cfg;
  if (!g('shc-name')) return;
  c.name = g('shc-name').value; c.sub = g('shc-sub').value; c.greeting = g('shc-gr').value; c.greetingSub = g('shc-gs').value;
  c.expiryDays = g('shc-exp').value; c.open = g('shc-open').checked;
  c.yuanPerPt = g('shc-yen').value; c.ptStep = g('shc-step').value;
  c.openAt = g('shc-openat').value; c.closedLine = g('shc-cl').value; c.closedSub = g('shc-cs').value;
  (c.cats || []).forEach(function(x, i){ var e = g('shc-cat-' + i); if (e) x.nm = e.value });
}
function shCatAdd(){ shCfgCollect(); shData.cfg.cats = (shData.cfg.cats || []).concat([{ id: 'c' + Date.now().toString(36), nm: '新分類' }]); renderShop() }
function shCatDel(i){ shCfgCollect(); shData.cfg.cats.splice(i, 1); renderShop() }
function shCatMove(i, d){ shCfgCollect(); var a = shData.cfg.cats, j = i + d; if (j < 0 || j >= a.length) return; var t = a[i]; a[i] = a[j]; a[j] = t; renderShop() }
async function shSaveCfg(){
  shCfgCollect();
  try { await staffApi('/staff/shop/cfg', { cfg: shData.cfg }); shData = null; await renderShop(); alert('已儲存') } catch(e) { alert('儲存失敗：' + e.message) }
}

/* ── 兌換紀錄＋核銷 ── */
function shRedeemHtml(){
  var list = shData.redeems || [];
  if (!list.length) return '<div class="card"><div class="empty">還沒有人兌換。</div></div>';
  var h = '<div class="card"><div class="card-title">兌換紀錄（最近 ' + list.length + ' 筆）</div>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:8px;line-height:1.7">客人拿兌換券來店時，找到那一筆按「已使用」。按錯可以按「復原」。紅利在兌換當下已經扣掉。</div>';
  list.forEach(function(x){
    var t = String(x.at || '').slice(5, 16).replace('T', ' ').replace('-', '/'), tk = (shTkts[x.phone] || {})[x.gid];
    var act;
    if (!tk) act = '<span class="muted" style="font-size:12px">讀取中…</span>';
    else if (+tk.qty > 0) act = '<span style="font-size:12px;color:#2e7d4f;margin-right:6px">未使用　期限 ' + shEsc(String(tk.expiry || '').slice(5).replace('-', '/')) + '</span><button class="btn btn-gold btn-sm" onclick="shRedeem(\'' + x.phone + '\',\'' + x.gid + '\',false)">已使用</button>';
    else act = '<span style="font-size:12px;color:var(--text3)">' + shEsc((tk.usedBy || '') + ' ' + String(tk.usedAt || '').slice(5, 10).replace('-', '/')) + ' 已使用 <a style="cursor:pointer;text-decoration:underline" onclick="shRedeem(\'' + x.phone + '\',\'' + x.gid + '\',true)">復原</a></span>';
    h += '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px;flex-wrap:wrap">' +
      '<span style="width:84px;color:var(--text3);font-size:12px">' + t + '</span>' +
      '<span style="flex:1 1 150px"><b>' + shEsc(x.name || '（未填姓名）') + '</b> <span class="muted" style="font-size:12px">' + shEsc(x.phone) + '</span></span>' +
      '<span style="flex:1 1 150px">' + shEsc(x.nm) + ' <span class="muted" style="font-size:12px">' + x.price + ' 點' + (x.onSale ? '・優惠價' : '') + '</span></span>' +
      '<span style="text-align:right">' + act + '</span></div>';
  });
  return h + '</div>';
}
async function shLoadTkts(){
  var phones = {}; (shData.redeems || []).forEach(function(x){ phones[x.phone] = 1 });
  var ps = Object.keys(phones).filter(function(p){ return !shTkts[p] });
  if (!ps.length) return;
  try {
    var j = await staffApi('/staff/gacha/tickets', { phones: ps });
    ps.forEach(function(p){ shTkts[p] = {}; (j.tickets[p] || []).forEach(function(t){ shTkts[p][t.gid] = t }) });
    if (shTab === 'redeems') renderShop();
  } catch(e) { /* 讀不到就維持「讀取中」 */ }
}
async function shRedeem(phone, gid, undo){
  try {
    var j = await staffApi('/staff/gacha/redeem', { phone: phone, gid: gid, undo: !!undo });
    shTkts[phone] = shTkts[phone] || {}; shTkts[phone][gid] = Object.assign({}, shTkts[phone][gid] || {}, j.ticket);
    renderShop();
  } catch(e) { alert('失敗：' + e.message) }
}
window.renderShop = renderShop;
