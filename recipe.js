/* ══════════════════════════════════════════════════════════
   課程用料：每個課程用掉哪些材料、成本多少、毛利多少
   材料來源：庫存盤點的品項（含單位成本）
   課程來源：Google 試算表「課程」分頁
   存放：salaryData.recipes[課程key] = { items:[{id,qty}], note }
   ══════════════════════════════════════════════════════════ */

var RC_STORE = 'flagship';
var rcCourses = null, rcFilter = '', rcOpen = null;

function rcKey(c){ return c.name + (c.spec ? '|' + c.spec : ''); }
function rcData(){
  if (!S.recipes) S.recipes = {};
  return S.recipes;
}
/* 把名稱切成「文字段」和「數字段」，數字當數字比。
   純字串比對會把 2F 排到 25P 後面——因為它比的是第一個字元，
   「2」小於「2」再看第二個，「F」大於「5」。看起來就像亂排。
   切開之後：2F、2P、3F、4F、10F、12F、15F、20F、25F… */
function rcNatKey(s){
  return String(s || '').match(/\d+(?:\.\d+)?|\D+/g) || [];
}
function rcNatCmp(a, b){
  var x = rcNatKey(a), y = rcNatKey(b);
  for (var i = 0; i < Math.max(x.length, y.length); i++){
    var p = x[i], q = y[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    var pn = /^\d/.test(p), qn = /^\d/.test(q);
    if (pn && qn){
      var d = parseFloat(p) - parseFloat(q);
      if (d) return d;
    } else {
      var c = p.localeCompare(q, 'zh-Hant');
      if (c) return c;
    }
  }
  return 0;
}

function rcMaterials(){
  if (!S.inventory || !S.inventory[RC_STORE] || !S.inventory[RC_STORE].items) return [];
  var items = S.inventory[RC_STORE].items;
  /* 分類的先後照庫存盤點裡的排列走——你在那邊拖曳排好的順序，
     這裡照著用，不要再按筆劃重排一次。 */
  var catOrder = {}, n = 0;
  items.forEach(function(m){
    var k = m.cat || '';
    if (catOrder[k] === undefined) catOrder[k] = n++;
  });
  return items.slice().sort(function(a, b){
    var ca = catOrder[a.cat || ''], cb = catOrder[b.cat || ''];
    if (ca !== cb) return ca - cb;
    return rcNatCmp(a.name, b.name);
  });
}
function rcMat(id){
  return rcMaterials().find(function(m){ return String(m.id) === String(id) }) || null;
}
/* 這些分類的材料，尺寸一變用量就跟著變（膠、水晶、金箔、顏料…）；畫布、框、托盤、隱性耗材不隨尺寸變。
   加進配方時預設勾「隨尺寸」，可以自己改 */
var RC_SCALE_CATS = ['顏料','膠體','水晶','金箔','熱熔膠','樹脂','溶劑'];

/* 一份配方拆成：固定材料（不隨尺寸）、隨尺寸材料，再各自加損耗。成本不含損耗的小計也一併回傳 */
function rcParts(key){
  var r = rcData()[key], out = { fixed:0, scal:0, waste:0, raw:0 };
  if (!r || !r.items) return out;
  out.waste = Math.max(0, +r.waste || 0);
  r.items.forEach(function(x){
    var m = rcMat(x.id); if (!m) return;
    var sub = (+m.cost || 0) * (+x.qty || 0);
    out.raw += sub;
    if (x.scale) out.scal += sub; else out.fixed += sub;
  });
  var k = 1 + out.waste / 100;
  out.fixedW = out.fixed * k; out.scalW = out.scal * k;
  return out;
}

function rcCost(key){
  var p = rcParts(key);
  return p.raw * (1 + p.waste / 100);   // 含損耗
}

async function rcLoadCourses(){
  if (rcCourses) return;
  /* 課程管理開著就讀它（key 一樣是「課程名|規格」，用料不用搬）；沒開或讀不到就照舊讀試算表 */
  try {
    var cat = window.bkCatalogFetch ? await bkCatalogFetch() : null;
    if (cat) {
      rcCourses = bkCatEntries(cat).map(function(c){ return { cat: c.cat, name: c.name, spec: c.spec, price: c.tiers ? c.tiers.member : c.price } });
      return;
    }
  } catch (e) {}
  try {
    var url = 'https://docs.google.com/spreadsheets/d/1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M' +
      '/gviz/tq?sheet=' + encodeURIComponent('課程') + '&tqx=out:json';
    var t = await (await fetch(url)).text();
    var j = JSON.parse(t.substring(t.indexOf('{'), t.lastIndexOf('}') + 1));
    var rows = j.table.rows.map(function(r){
      return r.c.map(function(c){ return c ? (c.f == null ? c.v : c.f) : '' });
    });
    if (rows.length && String(rows[0][0]).trim() === '分類') rows.shift();
    var out = [];
    rows.forEach(function(r){
      var name = String(r[1] || '').trim();
      if (!name) return;
      if (String(r[7] || 'Y').trim().toUpperCase() === 'N') return;
      var price = String(r[5] == null ? '' : r[5]).replace(/[^\d.]/g, '');
      out.push({
        cat: String(r[0] || '').trim(), name: name,
        spec: String(r[3] || '').trim(),
        price: price ? Math.round(parseFloat(price)) : 0
      });
    });
    rcCourses = out;
  } catch (e) { rcCourses = []; }
}

async function renderRecipe(){
  var el = document.getElementById('recipe-body');
  if (!el) return;
  if (!rcCourses) { el.innerHTML = '<div class="empty">載入課程中…</div>'; await rcLoadCourses(); }
  var mats = rcMaterials();
  var noCost = mats.filter(function(m){ return !(+m.cost) }).length;

  if (!rcCourses.length){
    el.innerHTML = '<div class="empty">讀不到課程資料，請確認試算表「課程」分頁可以存取</div>';
    return;
  }

  var list = rcCourses.filter(function(c){
    if (!rcFilter) return true;
    return (c.name + c.spec + c.cat).indexOf(rcFilter) >= 0;
  });
  var done = rcCourses.filter(function(c){
    var r = rcData()[rcKey(c)]; return r && r.items && r.items.length;
  }).length;

  var h = '';
  h += '<div class="card" style="margin-bottom:14px">';
  h += '<div class="row" style="gap:16px;flex-wrap:wrap">';
  h += '<div><div class="muted" style="font-size:13.5px">已建材料清單</div><div style="font-size:20px;color:var(--gold2)">' + done + ' / ' + rcCourses.length + '</div></div>';
  h += '<div><div class="muted" style="font-size:13.5px">可用材料</div><div style="font-size:20px;color:var(--gold2)">' + mats.length + '</div></div>';
  if (noCost) h += '<div><div class="muted" style="font-size:13.5px">尚未填成本</div><div style="font-size:20px;color:var(--red)">' + noCost + '</div></div>';
  h += '</div>';
  if (!mats.length) h += '<div class="muted" style="margin-top:10px;font-size:13.5px">請先到「庫存盤點」建立材料品項，並填寫單位成本。</div>';
  else if (noCost) h += '<div class="muted" style="margin-top:10px;font-size:13.5px">有 ' + noCost + ' 項材料還沒填單位成本，算出來的成本會偏低。</div>';
  h += '</div>';

  h += '<div class="row" style="margin-bottom:10px"><input id="rc-search" placeholder="搜尋課程名稱" value="' +
       String(rcFilter).replace(/"/g, '&quot;') + '" style="flex:1"></div>';

  h += '<table><thead><tr><th>課程</th><th style="width:70px">售價</th><th style="width:70px">成本</th>' +
       '<th style="width:70px">毛利</th><th style="width:70px">毛利率</th><th style="width:120px">材料</th></tr></thead><tbody>';
  list.forEach(function(c){
    var k = rcKey(c), r = rcData()[k], cost = rcCost(k);
    var n = r && r.items ? r.items.length : 0;
    var gross = c.price - cost, rate = c.price ? Math.round(gross / c.price * 100) : 0;
    h += '<tr>';
    h += '<td>' + c.name + (c.spec ? '<span class="muted" style="font-size:13.5px">（' + c.spec + '）</span>' : '') + '</td>';
    h += '<td style="text-align:right">' + (c.price ? c.price.toLocaleString() : '—') + '</td>';
    h += '<td style="text-align:right">' + (n ? Math.round(cost).toLocaleString() : '—') + '</td>';
    h += '<td style="text-align:right">' + (n && c.price ? gross.toLocaleString() : '—') + '</td>';
    h += '<td style="text-align:right;color:' + (n && c.price ? (rate < 50 ? 'var(--red)' : 'var(--gold2)') : 'var(--text2)') + '">' +
         (n && c.price ? rate + '%' : '—') + '</td>';
    h += '<td><button class="btn-sm" onclick="rcEdit(\'' + encodeURIComponent(k) + '\')">' +
         (n ? n + ' 項材料' : '＋ 建立') + '</button></td>';
    h += '</tr>';
  });
  h += '</tbody></table>';
  if (!list.length) h += '<div class="empty">找不到符合的課程</div>';
  el.innerHTML = h;

  var sb = document.getElementById('rc-search');
  if (sb) sb.oninput = function(){ rcFilter = this.value.trim(); renderRecipe(); };
}

function rcEdit(encKey){
  var key = decodeURIComponent(encKey);
  var c = rcCourses.find(function(x){ return rcKey(x) === key });
  if (!c) return;
  rcOpen = key;
  var r = rcData()[key] || { items: [], note: '' };
  if (!rcData()[key]) rcData()[key] = r;
  rcDrawModal(c, r);
  document.getElementById('rc-modal').style.display = 'block';
}
function rcCloseModal(){
  document.getElementById('rc-modal').style.display = 'none';
  rcOpen = null; save(); renderRecipe();
}

/* 「加入材料」下拉的選項：有打字就只留名稱或分類對得上的 */
function rcAddOpts(mats, q){
  q = String(q || '').trim().toLowerCase();
  var h = '<option value="">＋ 加入材料' + (q ? '（符合的在下面）' : '') + '</option>', lastCat = null, n = 0;
  mats.forEach(function(m){
    if (q && (m.name + (m.cat || '')).toLowerCase().indexOf(q) < 0) return;
    if (m.cat !== lastCat) { if (lastCat !== null) h += '</optgroup>'; h += '<optgroup label="' + (m.cat || '未分類') + '">'; lastCat = m.cat; }
    h += '<option value="' + m.id + '">' + m.name + (m.cost ? '　$' + m.cost : '　未填成本') + '</option>';
    n++;
  });
  if (lastCat !== null) h += '</optgroup>';
  if (q && !n) h = '<option value="">找不到「' + q + '」，請先到庫存盤點新增這個材料</option>';
  return h;
}

function rcDrawModal(c, r){
  var mats = rcMaterials(), cost = rcCost(rcKey(c));
  var gross = c.price - cost, rate = c.price ? Math.round(gross / c.price * 100) : 0;
  var h = '';
  h += '<h3 style="margin:0 0 2px">' + c.name + (c.spec ? '（' + c.spec + '）' : '') + '</h3>';
  h += '<div class="muted" style="font-size:13.5px;margin-bottom:14px">售價 $' + c.price.toLocaleString() + '</div>';

  h += '<div style="overflow-x:auto"><table style="min-width:520px"><thead><tr><th style="min-width:130px">材料</th><th style="width:84px" title="同名＝核銷時擇一扣">二選一群組</th><th style="width:66px">用量</th><th style="width:56px" title="勾了：尺寸變小，用量跟著變少">隨尺寸</th><th style="width:60px">單位成本</th><th style="width:60px">小計</th><th style="width:40px"></th></tr></thead><tbody>';
  (r.items || []).forEach(function(x, i){
    var m = rcMat(x.id);
    var sub = m ? (+m.cost || 0) * (+x.qty || 0) : 0;
    h += '<tr><td>' + (m ? m.name + '<span class="muted" style="font-size:12.5px">（' + (m.unit || '') + '）</span>' : '<span style="color:var(--red)">材料已刪除</span>') + '</td>';
    h += '<td><input style="width:76px;font-size:13.5px" placeholder="—" value="' + String(x.grp || '').replace(/"/g,'&quot;') +
         '" onchange="rcSetGrp(' + i + ',this.value)"></td>';
    h += '<td><input class="in-num" type="number" min="0" step="any" style="width:62px" value="' + (x.qty || 0) +
         '" onwheel="this.blur()" onchange="rcSetQty(' + i + ',this.value)"></td>';
    h += '<td style="text-align:center"><input type="checkbox"' + (x.scale ? ' checked' : '') + ' onchange="rcSetScale(' + i + ',this.checked)"></td>';
    h += '<td style="text-align:right">' + (m ? (+m.cost || 0).toLocaleString() : '—') + '</td>';
    h += '<td style="text-align:right">' + Math.round(sub).toLocaleString() + '</td>';
    h += '<td><button class="btn-del btn-sm" onclick="rcDel(' + i + ')">✕</button></td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="muted" style="font-size:13.5px;margin-top:6px;line-height:1.7">'
    + '<b>隨尺寸</b>：勾了代表尺寸變小時這項用量跟著變少（膠、水晶、金箔、顏料）；畫布、框、托盤不勾。<br>'
    + '同一個群組名稱的材料，核銷時只會扣其中一個，由老師當場選。'
    + '例如畫布填「畫布」，20cm方和4F各一列，核銷時二選一。留空的照舊每次都扣。</div>';
  if (!(r.items || []).length) h += '<div class="empty" style="padding:14px">還沒有材料，從下方加入</div>';

  h += '<div style="margin-top:12px">';
  h += '<input id="rc-addq" placeholder="🔍 搜尋要加入的材料（例：環氧、水晶、5F、銅箔）" style="width:100%;font-size:16px;padding:9px 12px;box-sizing:border-box">';
  h += '<select id="rc-add" style="width:100%;margin-top:6px;font-size:16px;padding:9px 10px">' + rcAddOpts(mats, '') + '</select></div>';

  h += '<div class="row" style="margin-top:14px;gap:8px;align-items:center">';
  h += '<select id="rc-copy" style="flex:1;font-size:16px;padding:9px 10px"><option value="">從其他課程複製材料…</option>';
  (rcCourses || []).forEach(function(o){
    var k = rcKey(o), rr = rcData()[k];
    if (k === rcKey(c) || !rr || !rr.items || !rr.items.length) return;
    h += '<option value="' + encodeURIComponent(k) + '">' + o.name + (o.spec ? '（' + o.spec + '）' : '') + '　' + rr.items.length + ' 項</option>';
  });
  h += '</select></div>';

  h += '<div class="row" style="margin-top:12px;gap:10px;align-items:center;flex-wrap:wrap">';
  h += '<label style="font-size:14px">損耗 %</label><input id="rc-waste" class="in-num" type="number" min="0" step="1" style="width:70px" placeholder="例：7" value="' + (r.waste || '') + '" onwheel="this.blur()">';
  h += '<span class="muted" style="font-size:13px">潑灑、試色、失敗重做。整份配方統一加，建議 5–10</span></div>';

  var pp = rcParts(rcKey(c));
  h += '<div class="card" style="margin-top:16px">';
  h += '<div class="row" style="gap:18px;flex-wrap:wrap">';
  h += '<div><div class="muted" style="font-size:13.5px">固定材料</div><div style="font-size:17px">$' + Math.round(pp.fixedW).toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:13.5px">隨尺寸材料</div><div style="font-size:17px">$' + Math.round(pp.scalW).toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:13.5px">材料成本</div><div style="font-size:19px">$' + Math.round(cost).toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:13.5px">毛利</div><div style="font-size:19px;color:var(--gold2)">$' + gross.toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:13.5px">毛利率</div><div style="font-size:19px;color:' + (rate < 50 ? 'var(--red)' : 'var(--gold2)') + '">' + (c.price ? rate + '%' : '—') + '</div></div>';
  h += '</div>';
  h += '<div class="muted" style="font-size:12.5px;margin-top:8px">只算材料，不含人事與場地。</div>';
  h += '</div>';

  h += '<div class="fg" style="margin-top:14px"><label>備註</label>' +
       '<textarea id="rc-note" rows="2" placeholder="例：畫布另購，不含在成本內">' + (r.note || '') + '</textarea></div>';
  h += '<div class="row" style="margin-top:14px"><button class="btn" onclick="rcCloseModal()" style="flex:1">完成</button></div>';

  document.getElementById('rc-modal-body').innerHTML = h;

  var add = document.getElementById('rc-add');
  var addq = document.getElementById('rc-addq');
  if (addq) addq.oninput = function(){
    add.innerHTML = rcAddOpts(mats, this.value);
    add.size = this.value.trim() ? Math.min(9, add.options.length) : 1;   // 有打字就把符合的整排攤開，不用再點開小小的下拉
  };
  add.onchange = function(){
    if (!this.value) return;
    var r2 = rcData()[rcOpen];
    if (r2.items.some(function(x){ return String(x.id) === String(this.value) }, this)) { alert('已經加過這項材料了'); this.value = ''; return; }
    var mm = rcMat(this.value);
    r2.items.push({ id: this.value, qty: 1, scale: !!(mm && RC_SCALE_CATS.indexOf(mm.cat) >= 0) });
    save(); rcDrawModal(c, r2);
  };
  var cp = document.getElementById('rc-copy');
  cp.onchange = function(){
    if (!this.value) return;
    var src = rcData()[decodeURIComponent(this.value)];
    if (!src) return;
    if (!confirm('要用這個課程的材料覆蓋目前的清單嗎？')) { this.value = ''; return; }
    var r2 = rcData()[rcOpen];
    r2.items = JSON.parse(JSON.stringify(src.items));
    save(); rcDrawModal(c, r2);
  };
  var nt = document.getElementById('rc-note');
  nt.onchange = function(){ rcData()[rcOpen].note = this.value; save(); };
  var ws = document.getElementById('rc-waste');
  if (ws) ws.onchange = function(){ rcData()[rcOpen].waste = Math.max(0, parseFloat(this.value) || 0); save(); rcDrawModal(c, rcData()[rcOpen]); };
}

/* 群組名稱。同一課程裡填一樣名稱的材料＝核銷時擇一扣，
   不是每次都扣。畫布尺寸、框的規格這種用得到。 */
function rcSetGrp(i, v){
  var r = rcData()[rcOpen]; if (!r) return;
  r.items[i].grp = String(v || '').trim();
  save();
  var c = rcCourses.find(function(x){ return rcKey(x) === rcOpen });
  if (c) rcDrawModal(c, r);
}

function rcSetScale(i, on){
  var r = rcData()[rcOpen]; if (!r) return;
  r.items[i].scale = !!on;
  save();
  var c = rcCourses.find(function(x){ return rcKey(x) === rcOpen });
  if (c) rcDrawModal(c, r);
}

function rcSetQty(i, v){
  var r = rcData()[rcOpen]; if (!r) return;
  r.items[i].qty = parseFloat(v) || 0;
  save();
  var c = rcCourses.find(function(x){ return rcKey(x) === rcOpen });
  if (c) rcDrawModal(c, r);
}
function rcDel(i){
  var r = rcData()[rcOpen]; if (!r) return;
  var removed = r.items[i];
  if (removed) tombstoneMark('recipes.' + rcOpen + '.items', removed);
  r.items.splice(i, 1); save();
  var c = rcCourses.find(function(x){ return rcKey(x) === rcOpen });
  if (c) rcDrawModal(c, r);
}
