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
  h += shTab === 'cfg' ? shCfgHtml() : shTab === 'redeems' ? shRedeemHtml() : (shEdit ? shFormHtml() : shListHtml());
  el.innerHTML = h;
  if (shTab === 'redeems') shLoadTkts();
}
function shSwitch(t){ shTab = t; shEdit = null; renderShop() }
async function shReload(){ shData = null; shEdit = null; await renderShop() }

/* ── 商品清單 ── */
function shPriceTxt(p){
  var sl = p.sale, t = (shData && shData.today) || '';
  var on = sl && sl.from && sl.to && sl.from <= t && t <= sl.to;
  return on ? '<s style="color:#999">' + p.price + '</s> <b style="color:#d6453b">' + sl.price + '</b> 點（優惠到 ' + sl.to.slice(5).replace('-','/') + '）'
    : '<b>' + p.price + '</b> 點' + (sl && sl.from ? '<span class="muted" style="font-size:12px">　優惠 ' + sl.price + ' 點：' + sl.from.slice(5).replace('-','/') + '～' + sl.to.slice(5).replace('-','/') + '</span>' : '');
}
function shListHtml(){
  var list = shData.products || [];
  var h = '<div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;flex-wrap:wrap">' +
    '<button class="btn btn-gold" onclick="shNew()">＋ 新增商品</button>' +
    '<span class="muted" style="font-size:12.5px">共 ' + list.length + ' 項。「排序」數字小的排前面；沒勾「上架」客人看不到。</span></div>';
  if (!shData.cloudinary) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;margin-bottom:10px">伺服器還沒設定 Cloudinary，商品照片暫時不能上傳（可以先用圖片網址）。</div>';
  if (!list.length) return h + '<div class="empty">還沒有商品。按上面「＋ 新增商品」開始上架。</div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px">';
  list.forEach(function(p){
    h += '<div class="card" style="display:flex;gap:12px;align-items:flex-start;' + (p.active === false ? 'opacity:.55' : '') + '">' +
      '<div style="width:78px;height:78px;flex:none;border-radius:10px;background:#efe8d8 center/cover no-repeat;' + (p.img ? "background-image:url('" + shEsc(p.img) + "')" : '') + '">' + (p.img ? '' : '<div style="text-align:center;line-height:78px;font-size:26px">🎁</div>') + '</div>' +
      '<div style="flex:1;min-width:0"><div style="font-weight:700;font-size:15px">' + shEsc(p.nm) + (p.active === false ? ' <span class="muted" style="font-size:12px">（已下架）</span>' : '') + '</div>' +
      '<div class="muted" style="font-size:12px;margin:2px 0">' + shEsc(shCatName(p.cat)) + '</div>' +
      '<div style="font-size:13.5px">' + shPriceTxt(p) + '</div>' +
      '<div class="muted" style="font-size:12px;margin-top:2px">庫存 ' + (p.stock == null ? '不限' : p.stock) + '　每人限兌 ' + (p.perPerson ? p.perPerson + ' 次' : '不限') + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:6px"><button class="btn btn-outline btn-sm" onclick="shOpen(\'' + p.id + '\')">編輯</button>' +
      '<button class="btn btn-outline btn-sm" onclick="shToggle(\'' + p.id + '\')">' + (p.active === false ? '重新上架' : '下架') + '</button></div></div></div>';
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
    shRow('原價紅利', shInp('sh-price', p.price, 'number', 90) + ' 點') +
    shRow('限時優惠', '優惠價 ' + shInp('sh-sp', sl.price == null ? '' : sl.price, 'number', 80) + ' 點　<br style="display:none">從 ' + shInp('sh-sf', sl.from || '', 'date', 150) + ' 到 ' + shInp('sh-st2', sl.to || '', 'date', 150),
      '三格都填才會生效；期間過了自動恢復原價。不要優惠就全部留空。') +
    shRow('庫存', shInp('sh-stock', p.stock == null ? '' : p.stock, 'number', 90) + ' 件', '空白＝不限量。每兌換一次自動減 1，減到 0 客人看到「換完了」。') +
    shRow('每人限兌', shInp('sh-pp', p.perPerson || 0, 'number', 80) + ' 次', '0＝不限。') +
    shRow('排序', shInp('sh-order', p.order, 'number', 80), '數字小的排前面。') +
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
  p.price = g('sh-price').value; p.stock = g('sh-stock').value === '' ? null : g('sh-stock').value;
  p.perPerson = g('sh-pp').value; p.order = g('sh-order').value; p.active = g('sh-act').checked;
  var sp = g('sh-sp').value, sf = g('sh-sf').value, st = g('sh-st2').value;
  p.sale = (sp === '' && !sf && !st) ? null : { price: sp, from: sf, to: st };
}
async function shSaveProduct(){
  if (shBusy) return;
  shCollect();
  var p = shEdit;
  if (!p.nm) { alert('請填商品名稱'); return }
  if (p.price === '' || isNaN(+p.price)) { alert('請填原價紅利（數字）'); return }
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
    shRow('營業中', '<label style="display:flex;gap:6px;align-items:center"><input id="shc-open" type="checkbox"' + (c.open !== false ? ' checked' : '') + '> 勾選＝營業；取消＝客人看到「暫時休息中」</label>') + '</div>';
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
