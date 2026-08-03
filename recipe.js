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
function rcMaterials(){
  if (!S.inventory || !S.inventory[RC_STORE] || !S.inventory[RC_STORE].items) return [];
  return S.inventory[RC_STORE].items.slice().sort(function(a,b){
    return (a.cat||'').localeCompare(b.cat||'') || (a.name||'').localeCompare(b.name||'');
  });
}
function rcMat(id){
  return rcMaterials().find(function(m){ return String(m.id) === String(id) }) || null;
}
function rcCost(key){
  var r = rcData()[key];
  if (!r || !r.items) return 0;
  return r.items.reduce(function(s, x){
    var m = rcMat(x.id);
    return s + (m ? (+m.cost || 0) * (+x.qty || 0) : 0);
  }, 0);
}

async function rcLoadCourses(){
  if (rcCourses) return;
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
  h += '<div><div class="muted" style="font-size:12px">已建材料清單</div><div style="font-size:20px;color:var(--gold2)">' + done + ' / ' + rcCourses.length + '</div></div>';
  h += '<div><div class="muted" style="font-size:12px">可用材料</div><div style="font-size:20px;color:var(--gold2)">' + mats.length + '</div></div>';
  if (noCost) h += '<div><div class="muted" style="font-size:12px">尚未填成本</div><div style="font-size:20px;color:var(--red)">' + noCost + '</div></div>';
  h += '</div>';
  if (!mats.length) h += '<div class="muted" style="margin-top:10px;font-size:12.5px">請先到「庫存盤點」建立材料品項，並填寫單位成本。</div>';
  else if (noCost) h += '<div class="muted" style="margin-top:10px;font-size:12.5px">有 ' + noCost + ' 項材料還沒填單位成本，算出來的成本會偏低。</div>';
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
    h += '<td>' + c.name + (c.spec ? '<span class="muted" style="font-size:12px">（' + c.spec + '）</span>' : '') + '</td>';
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

function rcDrawModal(c, r){
  var mats = rcMaterials(), cost = rcCost(rcKey(c));
  var gross = c.price - cost, rate = c.price ? Math.round(gross / c.price * 100) : 0;
  var h = '';
  h += '<h3 style="margin:0 0 2px">' + c.name + (c.spec ? '（' + c.spec + '）' : '') + '</h3>';
  h += '<div class="muted" style="font-size:12.5px;margin-bottom:14px">售價 $' + c.price.toLocaleString() + '</div>';

  h += '<table><thead><tr><th>材料</th><th style="width:80px">用量</th><th style="width:70px">單位成本</th><th style="width:70px">小計</th><th style="width:44px"></th></tr></thead><tbody>';
  (r.items || []).forEach(function(x, i){
    var m = rcMat(x.id);
    var sub = m ? (+m.cost || 0) * (+x.qty || 0) : 0;
    h += '<tr><td>' + (m ? m.name + '<span class="muted" style="font-size:11.5px">（' + (m.unit || '') + '）</span>' : '<span style="color:var(--red)">材料已刪除</span>') + '</td>';
    h += '<td><input class="in-num" type="number" min="0" step="any" style="width:70px" value="' + (x.qty || 0) +
         '" onwheel="this.blur()" onchange="rcSetQty(' + i + ',this.value)"></td>';
    h += '<td style="text-align:right">' + (m ? (+m.cost || 0).toLocaleString() : '—') + '</td>';
    h += '<td style="text-align:right">' + Math.round(sub).toLocaleString() + '</td>';
    h += '<td><button class="btn-del btn-sm" onclick="rcDel(' + i + ')">✕</button></td></tr>';
  });
  h += '</tbody></table>';
  if (!(r.items || []).length) h += '<div class="empty" style="padding:14px">還沒有材料，從下方加入</div>';

  h += '<div class="row" style="margin-top:12px;gap:8px">';
  h += '<select id="rc-add" style="flex:1"><option value="">＋ 加入材料</option>';
  var lastCat = '';
  mats.forEach(function(m){
    if (m.cat !== lastCat) { if (lastCat) h += '</optgroup>'; h += '<optgroup label="' + (m.cat || '未分類') + '">'; lastCat = m.cat; }
    h += '<option value="' + m.id + '">' + m.name + (m.cost ? '　$' + m.cost : '　未填成本') + '</option>';
  });
  if (lastCat) h += '</optgroup>';
  h += '</select></div>';

  h += '<div class="row" style="margin-top:14px;gap:8px;align-items:center">';
  h += '<select id="rc-copy" style="flex:1"><option value="">從其他課程複製材料…</option>';
  (rcCourses || []).forEach(function(o){
    var k = rcKey(o), rr = rcData()[k];
    if (k === rcKey(c) || !rr || !rr.items || !rr.items.length) return;
    h += '<option value="' + encodeURIComponent(k) + '">' + o.name + (o.spec ? '（' + o.spec + '）' : '') + '　' + rr.items.length + ' 項</option>';
  });
  h += '</select></div>';

  h += '<div class="card" style="margin-top:16px">';
  h += '<div class="row" style="gap:18px;flex-wrap:wrap">';
  h += '<div><div class="muted" style="font-size:12px">材料成本</div><div style="font-size:19px">$' + Math.round(cost).toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:12px">毛利</div><div style="font-size:19px;color:var(--gold2)">$' + gross.toLocaleString() + '</div></div>';
  h += '<div><div class="muted" style="font-size:12px">毛利率</div><div style="font-size:19px;color:' + (rate < 50 ? 'var(--red)' : 'var(--gold2)') + '">' + (c.price ? rate + '%' : '—') + '</div></div>';
  h += '</div>';
  h += '<div class="muted" style="font-size:11.5px;margin-top:8px">只算材料，不含人事與場地。</div>';
  h += '</div>';

  h += '<div class="fg" style="margin-top:14px"><label>備註</label>' +
       '<textarea id="rc-note" rows="2" placeholder="例：畫布另購，不含在成本內">' + (r.note || '') + '</textarea></div>';
  h += '<div class="row" style="margin-top:14px"><button class="btn" onclick="rcCloseModal()" style="flex:1">完成</button></div>';

  document.getElementById('rc-modal-body').innerHTML = h;

  var add = document.getElementById('rc-add');
  add.onchange = function(){
    if (!this.value) return;
    var r2 = rcData()[rcOpen];
    if (r2.items.some(function(x){ return String(x.id) === String(this.value) }, this)) { alert('已經加過這項材料了'); this.value = ''; return; }
    r2.items.push({ id: this.value, qty: 1 });
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
  r.items.splice(i, 1); save();
  var c = rcCourses.find(function(x){ return rcKey(x) === rcOpen });
  if (c) rcDrawModal(c, r);
}
