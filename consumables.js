// ── Consumables ─────────────────────────────────────────

const CM_CATS = ['顏料','畫布','紙張','筆刷','樹脂','溶劑','包裝','清潔','印刷','其他'];
const CM_CAT_ICONS = {'顏料':'🎨','畫布':'🖼','紙張':'📄','筆刷':'🖌','樹脂':'💎','溶劑':'🧪','包裝':'📦','清潔':'🧹','印刷':'🖨','其他':'📌','雜費':'📌','餐食':'🍱','上課材料':'🎨'};
const CM_CAT_COLORS = {'顏料':'b-gold','畫布':'b-blue','紙張':'b-gray','筆刷':'b-purple','樹脂':'b-blue','溶劑':'b-gray','包裝':'b-green','清潔':'b-green','印刷':'b-gray','其他':'b-gray','雜費':'b-gray','餐食':'b-green','上課材料':'b-gold'};

// 營隊支出只用三種分類，跟耗材完全分開
const CM_CAMP_CATS = ['雜費','餐食','上課材料'];
function getCMCats() {
  return curStore.consumables === 'camp' ? CM_CAMP_CATS : CM_CATS;
}

// 耗材記帳的店別/樓層名稱對照（只影響耗材記帳，不影響每日/月結/薪資/庫存）
// flagship 為「分樓層之前」的舊資料，獨立保留，不會被自動分配到四樓/二樓，避免資料張冠李戴
const CM_STORE_NAMES = { '4f':'四樓', '2f':'二樓', 'guotu':'國圖', 'hq':'總部', 'camp':'營隊支出' };
const CM_STORE_DEPT = { '4f':'旗艦館(4F)Otto2 ART CLUB', '2f':'旗艦館(2F)Otto2 ART CLUB', 'guotu':'國圖店Otto2 ART CLUB', 'hq':'總部Otto2 ART CLUB', 'camp':'旗艦館(4F)Otto2 ART CLUB－營隊' };

function getCMMonthKey() {
  var yEl = document.getElementById('cm-selYear');
  var mEl = document.getElementById('cm-selMonth');
  if (yEl && mEl && yEl.value && mEl.value) {
    return yEl.value + '-' + mEl.value;
  }
  return getMonthKey(); // fallback 用全域月份
}

function getCMKey() {
  return getCMMonthKey() + '_' + curStore.consumables;
}

// ── 零用金結餘（上期餘額自動帶入）────────────────────────
function getPrevCMMonthKey(monthKey) {
  var parts = monthKey.split('-');
  var y = parseInt(parts[0],10), m = parseInt(parts[1],10);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return y + '-' + String(m).padStart(2,'0');
}

function getCMOpeningBalance(monthKey, store) {
  var prevKey = getPrevCMMonthKey(monthKey) + '_' + store;
  if (S.cmBalance && S.cmBalance[prevKey] !== undefined && S.cmBalance[prevKey] !== null && S.cmBalance[prevKey] !== '') {
    return S.cmBalance[prevKey];
  }
  return null;
}

function setCMBalance(val) {
  var k = getCMKey();
  if (!S.cmBalance) S.cmBalance = {};
  if (val === '' || val === null || isNaN(parseFloat(val))) {
    delete S.cmBalance[k];
  } else {
    S.cmBalance[k] = parseFloat(val);
  }
  save();
  renderConsumables();
}

function getConsumables() {
  var k = getCMKey();
  if (!S.consumables) S.consumables = {};
  if (!S.consumables[k]) S.consumables[k] = [];
  return S.consumables[k];
}

// 匯率預設值
var CM_RATES = { TWD: 1, CNY: 4.4, USD: 32, JPY: 0.22 };

var cmDetailCount = 0;
function addCMDetailRow(name, amt, currency, rate, containerId) {
  cmDetailCount++;
  var id = 'cmdr_' + cmDetailCount;
  var wrap = document.getElementById(containerId || 'cm-detail-rows');
  if (!wrap) return;

  var div = document.createElement('div');
  div.id = id;
  div.style.cssText = 'display:grid;grid-template-columns:1fr 100px 80px 80px 80px auto;gap:8px;margin-bottom:8px;align-items:center';

  // 品項名稱
  var nameInp = document.createElement('input');
  nameInp.type = 'text';
  nameInp.placeholder = '品項名稱（例：生褐170ml）';
  nameInp.value = name || '';
  nameInp.className = 'cmdr-name';
  nameInp.style.cssText = 'background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 10px;border-radius:6px;font-size:14.5px;outline:none;font-family:inherit';

  // 金額
  var amtInp = document.createElement('input');
  amtInp.type = 'number';
  amtInp.placeholder = '金額';
  amtInp.value = amt || '';
  amtInp.min = '0';
  amtInp.step = '0.01';
  amtInp.className = 'cmdr-amt';
  amtInp.style.cssText = 'background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 8px;border-radius:6px;font-size:14.5px;outline:none;font-family:inherit;text-align:right';
  amtInp.addEventListener('wheel', function(){ this.blur(); });
  amtInp.addEventListener('input', function(){ calcDetailTWD(this); });

  // 幣別
  var curSel = document.createElement('select');
  curSel.className = 'cmdr-cur';
  curSel.style.cssText = 'background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 6px;border-radius:6px;font-size:13.5px;outline:none;font-family:inherit';
  [['TWD','NT$'],['CNY','¥人民幣'],['USD','$美元'],['JPY','¥日圓']].forEach(function(opt){
    var o = document.createElement('option');
    o.value = opt[0]; o.textContent = opt[1];
    if ((currency||'CNY') === opt[0]) o.selected = true;
    curSel.appendChild(o);
  });
  curSel.addEventListener('change', function(){ calcDetailTWD(div.querySelector('.cmdr-amt')); });

  // 匯率
  var rateInp = document.createElement('input');
  rateInp.type = 'number';
  rateInp.placeholder = '匯率';
  rateInp.value = rate || CM_RATES['CNY'];
  rateInp.step = '0.01';
  rateInp.className = 'cmdr-rate';
  rateInp.style.cssText = 'background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:7px 8px;border-radius:6px;font-size:13.5px;outline:none;font-family:inherit;text-align:right';
  rateInp.addEventListener('wheel', function(){ this.blur(); });
  rateInp.addEventListener('input', function(){ calcDetailTWD(div.querySelector('.cmdr-amt')); });

  // 台幣預覽
  var twdDiv = document.createElement('div');
  twdDiv.className = 'cmdr-twd';
  twdDiv.style.cssText = 'background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);color:var(--gold2);padding:7px 8px;border-radius:6px;font-size:13.5px;font-weight:600;text-align:right;white-space:nowrap';
  twdDiv.textContent = '—';

  // 刪除按鈕
  var delBtn = document.createElement('button');
  delBtn.textContent = '✕';
  delBtn.style.cssText = 'background:transparent;border:1px solid #553;color:#a88;padding:6px 10px;border-radius:5px;cursor:pointer;font-size:13.5px';
  delBtn.addEventListener('click', function(){ div.remove(); });

  div.appendChild(nameInp);
  div.appendChild(amtInp);
  div.appendChild(curSel);
  div.appendChild(rateInp);
  div.appendChild(twdDiv);
  div.appendChild(delBtn);
  wrap.appendChild(div);

  if (amt) calcDetailTWD(amtInp);
}

function calcDetailTWDFromSel(selEl) {
  var row = selEl.closest('div[id^="cmdr_"]');
  if (!row) return;
  calcDetailTWD(row.querySelector('.cmdr-amt'));
}

function calcDetailTWDFromRate(rateEl) {
  var row = rateEl.closest('div[id^="cmdr_"]');
  if (!row) return;
  calcDetailTWD(row.querySelector('.cmdr-amt'));
}

function calcDetailTWD(amtEl) {
  var row = amtEl.closest('div[id^="cmdr_"]');
  if (!row) return;
  var amt = parseFloat(amtEl.value) || 0;
  var cur = row.querySelector('.cmdr-cur').value;
  var rate = parseFloat(row.querySelector('.cmdr-rate').value) || CM_RATES[cur] || 1;
  var twdEl = row.querySelector('.cmdr-twd');
  if (cur === 'TWD') {
    twdEl.textContent = amt > 0 ? 'NT$'+Math.round(amt).toLocaleString() : '—';
  } else {
    twdEl.textContent = amt > 0 ? 'NT$'+Math.round(amt*rate).toLocaleString() : '—';
  }
}

function getCMDetails(containerId) {
  var rows = document.querySelectorAll('#'+(containerId || 'cm-detail-rows')+' div[id^="cmdr_"]');
  var result = [];
  rows.forEach(function(row) {
    var name = row.querySelector('.cmdr-name').value.trim();
    var amt = parseFloat(row.querySelector('.cmdr-amt').value) || 0;
    var cur = row.querySelector('.cmdr-cur').value;
    var rate = parseFloat(row.querySelector('.cmdr-rate').value) || CM_RATES[cur] || 1;
    var twd = cur === 'TWD' ? amt : Math.round(amt * rate);
    if (name || amt) result.push({ name: name, origAmt: amt, currency: cur, rate: rate, twd: twd });
  });
  return result;
}

function addInlineDetailRow(itemId) {
  addCMDetailRow(null, null, null, null, 'cme-detail-rows-' + itemId);
}

function addConsumable() {
  var dateVal = document.getElementById('cm-date').value;
  var cat = document.getElementById('cm-cat').value;
  var name = document.getElementById('cm-name').value.trim();
  var buyer = document.getElementById('cm-buyer').value.trim();
  var amount = parseFloat(document.getElementById('cm-amount').value) || 0;
  var source = document.getElementById('cm-source').value;
  var note = document.getElementById('cm-note').value.trim();
  var details = getCMDetails();

  if (!name) { alert('請填入品項名稱'); return; }
  if (!amount) { alert('請填入金額'); return; }

  var item = {
    id: Date.now(),
    date: dateVal || getCMMonthKey() + '-01',
    cat: cat,
    name: name,
    buyer: buyer,
    currency: 'TWD',
    origAmt: Math.round(amount),
    rate: null,
    amount: Math.round(amount),
    source: source,
    note: note,
    details: details.length > 0 ? details : null
  };

  var k = getCMKey();
  if (!S.consumables) S.consumables = {};
  if (!S.consumables[k]) S.consumables[k] = [];
  S.consumables[k].push(item);
  save();

  // 清空輸入
  document.getElementById('cm-name').value = '';
  document.getElementById('cm-buyer').value = '';
  document.getElementById('cm-amount').value = '';
  document.getElementById('cm-note').value = '';
  document.getElementById('cm-detail-rows').innerHTML = '';
  cmDetailCount = 0;

  renderConsumables();
}

function escAttr(s) {
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

var CM_SOURCE_LIST = ['實體店','蝦皮','淘寶','拼多多','PChome','Amazon','其他網路'];

// 本月明細：點「編輯」一律原地展開成完整編輯區，不會跳回上方表單
function editConsumable(id) {
  renderConsumables(); // 先還原成乾淨狀態，避免同時有多個編輯中的列
  var k = getCMKey();
  var items = (S.consumables && S.consumables[k]) ? S.consumables[k] : [];
  var x = items.find(function(it){ return it.id === id; });
  if (!x) { alert('找不到這筆紀錄'); return; }

  var row = document.getElementById('cm-row-'+id);
  if (!row) return;

  var catOpts = getCMCats().map(function(c){
    return '<option value="'+c+'"'+(c===x.cat?' selected':'')+'>'+CM_CAT_ICONS[c]+' '+c+'</option>';
  }).join('');
  var srcOpts = CM_SOURCE_LIST.map(function(s){
    return '<option value="'+s+'"'+(s===x.source?' selected':'')+'>'+s+'</option>';
  }).join('');
  var curOpts = [['TWD','台幣 NT$'],['CNY','人民幣 ¥'],['USD','美元 $'],['JPY','日圓 ¥']].map(function(c){
    return '<option value="'+c[0]+'"'+((x.currency||'TWD')===c[0]?' selected':'')+'>'+c[1]+'</option>';
  }).join('');
  var isForeign = !!(x.currency && x.currency !== 'TWD');

  var td = document.createElement('td');
  td.colSpan = 9;
  td.innerHTML =
    '<div class="form-grid" style="margin-bottom:10px">'+
      '<div class="fg"><label>日期</label><input id="cme-date-'+id+'" type="date" value="'+x.date+'"></div>'+
      '<div class="fg"><label>類別</label><select id="cme-cat-'+id+'">'+catOpts+'</select></div>'+
      '<div class="fg"><label>品項名稱</label><input id="cme-name-'+id+'" value="'+escAttr(x.name)+'"></div>'+
      '<div class="fg"><label>幣別</label><select id="cme-currency-'+id+'" onchange="updateInlinePreview('+id+')">'+curOpts+'</select></div>'+
      '<div class="fg"><label>金額（原幣）</label><input id="cme-amount-'+id+'" type="number" value="'+x.origAmt+'" min="0" onwheel="this.blur()" oninput="updateInlinePreview('+id+')"></div>'+
      '<div class="fg" id="cme-rate-wrap-'+id+'" style="display:'+(isForeign?'':'none')+'"><label>匯率（×台幣）</label><input id="cme-rate-'+id+'" type="number" value="'+(x.rate||'')+'" step="0.01" min="0" onwheel="this.blur()" oninput="updateInlinePreview('+id+')"></div>'+
      '<div class="fg" id="cme-twd-wrap-'+id+'" style="display:'+(isForeign?'':'none')+'"><label>換算台幣</label><div id="cme-twd-preview-'+id+'" style="background:var(--bg3);border:1px solid rgba(201,168,76,0.3);color:var(--gold2);padding:8px 11px;border-radius:7px;font-size:15.5px;font-weight:600">'+(isForeign?('NT$'+x.amount.toLocaleString()):'—')+'</div></div>'+
      '<div class="fg"><label>購買來源</label><select id="cme-source-'+id+'">'+srcOpts+'</select></div>'+
      '<div class="fg"><label>購買人</label><input id="cme-buyer-'+id+'" list="cm-buyer-list" value="'+escAttr(x.buyer)+'" placeholder="例：大熊老師"></div>'+
      '<div class="fg"><label>零用金是否撥款</label><select id="cme-paid-'+id+'"><option value="paid"'+(x.paid!==false?' selected':'')+'>已撥款</option><option value="unpaid"'+(x.paid===false?' selected':'')+'>未撥款（代墊中）</option></select></div>'+
      '<div class="fg"><label>用途/備註</label><input id="cme-note-'+id+'" value="'+escAttr(x.note)+'"></div>'+
    '</div>'+
    '<div style="margin-bottom:12px">'+
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'+
        '<span style="font-size:14.5px;color:var(--text2)">📎 明細備註（一筆訂單含多品項時使用）</span>'+
        '<button class="btn btn-outline btn-sm" onclick="addInlineDetailRow('+id+')">＋ 新增明細行</button>'+
      '</div>'+
      '<div id="cme-detail-rows-'+id+'"></div>'+
    '</div>'+
    '<div style="display:flex;gap:10px">'+
      '<button class="btn btn-gold" onclick="saveInlineEdit('+id+')">💾 儲存修改</button>'+
      '<button class="btn btn-outline" onclick="renderConsumables()">✕ 取消</button>'+
    '</div>';

  row.innerHTML = '';
  row.appendChild(td);

  // 還原多筆明細
  if (x.details && x.details.length > 0) {
    x.details.forEach(function(d){ addCMDetailRow(d.name, d.origAmt, d.currency, d.rate, 'cme-detail-rows-'+id); });
  }
}

function updateInlinePreview(id) {
  var currency = document.getElementById('cme-currency-'+id).value;
  var rateWrap = document.getElementById('cme-rate-wrap-'+id);
  var twdWrap = document.getElementById('cme-twd-wrap-'+id);
  var rateEl = document.getElementById('cme-rate-'+id);
  var preview = document.getElementById('cme-twd-preview-'+id);
  var amt = parseFloat(document.getElementById('cme-amount-'+id).value) || 0;

  if (currency === 'TWD') {
    rateWrap.style.display = 'none';
    twdWrap.style.display = 'none';
    preview.textContent = '—';
    return;
  }
  rateWrap.style.display = '';
  twdWrap.style.display = '';
  if (!rateEl.value) rateEl.value = CM_RATES[currency] || 1;
  var rate = parseFloat(rateEl.value) || CM_RATES[currency] || 1;
  var twd = Math.round(amt * rate);
  preview.textContent = twd > 0 ? 'NT$' + twd.toLocaleString() : '—';
}

function saveInlineEdit(id) {
  var k = getCMKey();
  if (!S.consumables || !S.consumables[k]) return;
  var idx = S.consumables[k].findIndex(function(x){ return x.id === id; });
  if (idx === -1) { alert('找不到原始紀錄'); renderConsumables(); return; }

  var dateVal = document.getElementById('cme-date-'+id).value;
  var cat = document.getElementById('cme-cat-'+id).value;
  var name = document.getElementById('cme-name-'+id).value.trim();
  var currency = document.getElementById('cme-currency-'+id).value;
  var origAmt = parseFloat(document.getElementById('cme-amount-'+id).value) || 0;
  var rateEl = document.getElementById('cme-rate-'+id);
  var rate = parseFloat(rateEl && rateEl.value) || CM_RATES[currency] || 1;
  var source = document.getElementById('cme-source-'+id).value;
  var buyer = document.getElementById('cme-buyer-'+id).value.trim();
  var paid = document.getElementById('cme-paid-'+id).value !== 'unpaid';
  var note = document.getElementById('cme-note-'+id).value.trim();
  var details = getCMDetails('cme-detail-rows-'+id);

  if (!name) { alert('請填入品項名稱'); return; }
  if (!origAmt) { alert('請填入金額'); return; }

  var twdAmt = currency === 'TWD' ? Math.round(origAmt) : Math.round(origAmt * rate);

  var x = S.consumables[k][idx];
  x.date = dateVal || x.date;
  x.cat = cat;
  x.name = name;
  x.currency = currency;
  x.origAmt = origAmt;
  x.rate = currency !== 'TWD' ? rate : null;
  x.amount = twdAmt;
  x.source = source;
  x.buyer = buyer;
  x.paid = paid;
  x.note = note;
  x.details = details.length > 0 ? details : null;

  save();
  renderConsumables();
}

function setPaidStatus(id, val) {
  var k = getCMKey();
  if (!S.consumables || !S.consumables[k]) return;
  var x = S.consumables[k].find(function(it){ return it.id === id; });
  if (!x) return;
  x.paid = (val !== 'unpaid');
  save();
  renderConsumables();
}

function delConsumable(id) {
  var k = getCMKey();
  if (!S.consumables || !S.consumables[k]) return;
  S.consumables[k] = S.consumables[k].filter(function(x){ return x.id !== id; });
  save();
  renderConsumables();
}


function renderConsumables() {
  var items = getConsumables();
  var mKey = getCMMonthKey();
  var store = curStore.consumables;

  // 零用金結餘區塊
  var openBal = getCMOpeningBalance(mKey, store);
  var obEl = document.getElementById('cm-opening-balance');
  if (obEl) obEl.textContent = (openBal !== null) ? ('NT$ '+openBal.toLocaleString()) : '無資料（請依紙本核對後填寫）';
  var biEl = document.getElementById('cm-balance-input');
  if (biEl) {
    var balKey = getCMKey();
    var savedBal = (S.cmBalance && S.cmBalance[balKey] !== undefined) ? S.cmBalance[balKey] : '';
    if (document.activeElement !== biEl) biEl.value = savedBal;
  }
  
  // DEBUG 顯示
  var debugEl = document.getElementById('cm-debug');
  if (debugEl) {
    var allKeys = S.consumables ? Object.keys(S.consumables).filter(function(k){ return k !== '__may_ver' && k !== '__cm_migrate_ver'; }) : [];
    var curKey = getCMKey();
    debugEl.style.display = 'block';
    debugEl.innerHTML = '<span style="color:#686460;font-size:12.5px">查詢key: <b style="color:#c9a84c">' + curKey + '</b> &nbsp;|&nbsp; Firebase有: <b style="color:#c9a84c">' + (allKeys.length ? allKeys.join(', ') : '無') + '</b> &nbsp;|&nbsp; 筆數: <b style="color:#4caf7d">' + items.length + '</b></span>';
  }

  // 更新月份總計
  var totalEl = document.getElementById('cm-month-total');
  if (totalEl) {
    var t = items.reduce(function(s,x){ return s+x.amount; }, 0);
    totalEl.textContent = t > 0 ? '本月共 NT$' + t.toLocaleString() : '';
  }

  var addTitleEl = document.getElementById('cm-add-title');
  if (addTitleEl) addTitleEl.textContent = (store === 'camp') ? '➕ 新增營隊支出' : '➕ 新增耗材支出';

  // 類別下拉依分頁重建（營隊只有三種）
  var catSel = document.getElementById('cm-cat');
  if (catSel) {
    var wantCats = getCMCats();
    var curCats = Array.prototype.map.call(catSel.options, function(o){ return o.value; }).join(',');
    if (curCats !== wantCats.join(',')) {
      var keep = catSel.value;
      catSel.innerHTML = wantCats.map(function(c){
        return '<option value="'+c+'">'+(CM_CAT_ICONS[c]||'📌')+' '+c+'</option>';
      }).join('');
      if (wantCats.indexOf(keep) >= 0) catSel.value = keep;
    }
  }

  // 設定日期預設值
  var dateEl = document.getElementById('cm-date');
  if (dateEl && !dateEl.value) {
    var now = new Date();
    var y = now.getFullYear();
    var m = now.getMonth()+1;
    var d = now.getDate();
    dateEl.value = y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0');
  }

  // 統計
  var total = 0;
  var byCat = {};
  getCMCats().forEach(function(c){ byCat[c] = 0; });
  items.forEach(function(x){ total += x.amount; byCat[x.cat] = (byCat[x.cat]||0)+x.amount; });

  // 找出最高類別
  var topCat = '—', topAmt = 0;
  getCMCats().forEach(function(c){ if(byCat[c]>topAmt){ topAmt=byCat[c]; topCat=c; } });

  // 分析：超過 30% 的類別才提醒
  var alerts = [];
  if (total > 0) {
    getCMCats().forEach(function(c){
      var pct = byCat[c]/total*100;
      if (pct >= 30) alerts.push(CM_CAT_ICONS[c]+' '+c+'（'+pct.toFixed(0)+'%，$'+byCat[c].toLocaleString()+'）');
    });
  }

  // 月份比較（和上個月）
  var selY = parseInt(document.getElementById('selYear').value);
  var selM = parseInt(document.getElementById('selMonth').value);
  var prevM = selM===1 ? 12 : selM-1;
  var prevY = selM===1 ? selY-1 : selY;
  var prevKey = prevY+'-'+String(prevM).padStart(2,'0')+'_'+store;
  var prevItems = (S.consumables && S.consumables[prevKey]) ? S.consumables[prevKey] : [];
  var prevTotal = prevItems.reduce(function(s,x){ return s+x.amount; }, 0);
  var diffHtml = '';
  if (prevTotal > 0) {
    var diff = total - prevTotal;
    var diffPct = (diff/prevTotal*100).toFixed(1);
    var color = diff > 0 ? 'var(--red)' : 'var(--green)';
    var sign = diff > 0 ? '+' : '';
    diffHtml = '<span style="color:'+color+';font-size:14.5px;margin-left:8px">'+sign+'$'+diff.toLocaleString()+'（'+sign+diffPct+'%）vs 上月</span>';
  }

  // 渲染統計卡片
  var statsHtml = '<div class="card"><div class="card-title">📊 ' + (store==='camp' ? '本月營隊支出概況' : '本月耗材概況') + ' — '+mKey+' '+(CM_STORE_NAMES[store]||store)+'</div>';
  statsHtml += '<div class="stat-grid">';
  statsHtml += '<div class="stat-card"><div class="lbl">本月總支出</div><div class="val">$'+total.toLocaleString()+'</div>'+diffHtml+'</div>';
  statsHtml += '<div class="stat-card"><div class="lbl">筆數</div><div class="val">'+items.length+'</div></div>';
  statsHtml += '<div class="stat-card"><div class="lbl">最高類別</div><div class="val" style="font-size:17px">'+CM_CAT_ICONS[topCat]+' '+topCat+'</div><div style="font-size:13.5px;color:var(--text3)">$'+topAmt.toLocaleString()+'</div></div>';
  statsHtml += '</div>';

  // 類別分解條
  if (total > 0) {
    statsHtml += '<div style="margin-bottom:16px">';
    statsHtml += '<div style="font-size:13.5px;color:var(--text3);margin-bottom:8px">支出分布</div>';
    statsHtml += '<div style="display:flex;height:12px;border-radius:6px;overflow:hidden;margin-bottom:10px">';
    var barColors = ['#c9a84c','#80c0f0','#aaa','#c0a0f0','#80c0f0','#888','#70e0a8','#70e0a8','#aaa','#666'];
    getCMCats().forEach(function(c,i){
      var pct = byCat[c]/total*100;
      if (pct > 0) statsHtml += '<div style="width:'+pct.toFixed(1)+'%;background:'+barColors[i]+'" title="'+c+': $'+byCat[c].toLocaleString()+'"></div>';
    });
    statsHtml += '</div>';
    statsHtml += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    getCMCats().forEach(function(c,i){
      if (byCat[c] > 0) {
        var pct = (byCat[c]/total*100).toFixed(0);
        statsHtml += '<span style="font-size:13.5px;display:flex;align-items:center;gap:4px"><span style="width:8px;height:8px;border-radius:50%;background:'+barColors[i]+';display:inline-block"></span>'+CM_CAT_ICONS[c]+' '+c+' '+pct+'%</span>';
      }
    });
    statsHtml += '</div></div>';
  }

  // 智慧提醒
  if (alerts.length > 0 || (prevTotal > 0 && total > prevTotal * 1.2)) {
    statsHtml += '<div class="info-box">⚠️ 注意事項：';
    if (alerts.length > 0) statsHtml += '單一類別佔比偏高：'+alerts.join('、')+'。';
    if (prevTotal > 0 && total > prevTotal * 1.2) statsHtml += ' 本月比上月多出 '+(((total-prevTotal)/prevTotal)*100).toFixed(0)+'%，建議檢查是否有採購異常。';
    statsHtml += '</div>';
  }

  statsHtml += '</div>';
  document.getElementById('cm-stats-area').innerHTML = statsHtml;

  renderCMBuyerSummary(items);

  // 購買人 datalist（從老師名單彙整，供快速選取，仍可自行輸入其他名字）
  var buyerListEl = document.getElementById('cm-buyer-list');
  if (buyerListEl) {
    var names = Array.from(new Set((S.teachers||[]).map(function(t){ return t.name; }).filter(Boolean)));
    buyerListEl.innerHTML = names.map(function(n){ return '<option value="'+n+'">'; }).join('');
  }

  // 渲染明細表
  var listEl = document.getElementById('cm-list-area');
  if (items.length === 0) {
    listEl.innerHTML = '<div class="empty">本月尚無耗材紀錄，點上方「新增耗材支出」開始記帳。</div>';
    return;
  }

  // 「只顯示未撥款」只影響這張明細表跟匯出，上面的統計卡片still算整個月，
  // 不然勾了之後「本月總支出」突然變小，行政會以為資料不見了。
  var unpaidOnlyEl = document.getElementById('cm-unpaid-only');
  var unpaidOnly = !!(unpaidOnlyEl && unpaidOnlyEl.checked);
  var listItems = unpaidOnly ? items.filter(function(x){ return x.paid === false; }) : items;
  if (unpaidOnly && listItems.length === 0) {
    listEl.innerHTML = '<div class="empty">這個月份已經沒有「未撥款」的項目了，都處理完了。</div>';
    return;
  }

  // 依日期排序（新→舊）
  var sorted = listItems.slice().sort(function(a,b){ return b.date.localeCompare(a.date) || b.id-a.id; });

  var rows = sorted.map(function(x){
    var icon = CM_CAT_ICONS[x.cat]||'📌';
    var badgeClass = CM_CAT_COLORS[x.cat]||'b-gray';
    var isPaid = x.paid !== false;
    var paidSelectCss = isPaid
      ? 'background:rgba(76,175,125,0.12);color:var(--green);border:1px solid rgba(76,175,125,0.3)'
      : 'background:rgba(224,85,85,0.1);color:var(--red);border:1px solid rgba(224,85,85,0.3)';
    var paidSelect = '<select onchange="setPaidStatus('+x.id+',this.value)" style="'+paidSelectCss+';padding:4px 8px;border-radius:20px;font-size:12.5px;font-weight:500;font-family:inherit;outline:none;cursor:pointer">'+
      '<option value="paid"'+(isPaid?' selected':'')+'>已撥款</option>'+
      '<option value="unpaid"'+(!isPaid?' selected':'')+'>未撥款</option>'+
      '</select>';
    return '<tr id="cm-row-'+x.id+'">'+
      '<td style="font-size:13.5px;color:var(--text3)">'+x.date.slice(5)+'</td>'+
      '<td><span class="badge '+badgeClass+'">'+icon+' '+x.cat+'</span></td>'+
      '<td style="font-weight:500">'+x.name+'</td>'+
      '<td style="color:var(--gold2);font-weight:600">$'+x.amount.toLocaleString()+'</td>'+
      '<td style="font-size:13.5px;color:var(--text3)">'+x.source+'</td>'+
      '<td style="font-size:13.5px;color:var(--text2)">'+(x.buyer||'—')+'</td>'+
      '<td>'+paidSelect+'</td>'+
      '<td style="font-size:13.5px;color:var(--text3)">'+(x.note||'')+'</td>'+
      '<td style="white-space:nowrap"><button class="btn btn-outline btn-sm" onclick="editConsumable('+x.id+')">編輯</button> <button class="btn btn-del btn-sm" onclick="delConsumable('+x.id+')">刪除</button></td>'+
      '</tr>';
  }).join('');

  listEl.innerHTML = '<table><thead><tr>'+
    '<th>日期</th><th>類別</th><th>品項</th><th>金額</th><th>來源</th><th>購買人</th><th>零用金</th><th>備註</th><th></th>'+
    '</tr></thead><tbody>'+rows+'</tbody></table>';
}

// ── 購買人彙整（點名字看明細，方便對帳撥款）────────────────────
var cmBuyerExpanded = {}; // { 購買人名字: true/false } 記住展開狀態，重新渲染不會收合

function toggleCMBuyer(name) {
  cmBuyerExpanded[name] = !cmBuyerExpanded[name];
  renderConsumables();
}

function renderCMBuyerSummary(items) {
  var areaEl = document.getElementById('cm-buyer-summary-area');
  if (!areaEl) return;

  if (!items || items.length === 0) {
    areaEl.innerHTML = '<div class="empty">本月尚無耗材紀錄。</div>';
    return;
  }

  // 依購買人分組
  var groups = {};
  items.forEach(function(x){
    var name = (x.buyer||'').trim() || '未填寫購買人';
    if (!groups[name]) groups[name] = { items: [], total: 0, unpaid: 0 };
    groups[name].items.push(x);
    groups[name].total += x.amount;
    if (x.paid === false) groups[name].unpaid += x.amount;
  });

  var names = Object.keys(groups).sort(function(a,b){ return groups[b].total - groups[a].total; });

  var html = '<div style="display:flex;flex-direction:column;gap:8px">';
  names.forEach(function(name){
    var g = groups[name];
    var isOpen = !!cmBuyerExpanded[name];
    var unpaidBadge = g.unpaid > 0
      ? '<span style="font-size:12.5px;color:var(--red);background:rgba(224,85,85,0.1);border:1px solid rgba(224,85,85,0.3);padding:2px 8px;border-radius:20px">未撥款 $'+g.unpaid.toLocaleString()+'</span>'
      : '<span style="font-size:12.5px;color:var(--green);background:rgba(76,175,125,0.1);border:1px solid rgba(76,175,125,0.3);padding:2px 8px;border-radius:20px">已全數撥款</span>';

    html += '<div style="border:1px solid var(--border);border-radius:8px;overflow:hidden">';
    html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;cursor:pointer;background:var(--bg3)" onclick="toggleCMBuyer(\''+escAttr(name).replace(/'/g,"\\'")+'\')">';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += '<span style="font-size:14.5px;color:var(--text3);width:14px;display:inline-block">'+(isOpen?'▾':'▸')+'</span>';
    html += '<span style="font-weight:600">'+escAttr(name)+'</span>';
    html += '<span style="font-size:13.5px;color:var(--text3)">共 '+g.items.length+' 筆</span>';
    html += '</div>';
    html += '<div style="display:flex;align-items:center;gap:10px">';
    html += unpaidBadge;
    html += '<span style="color:var(--gold2);font-weight:700;font-size:16px">$'+g.total.toLocaleString()+'</span>';
    html += '</div></div>';

    if (isOpen) {
      var sortedItems = g.items.slice().sort(function(a,b){ return b.date.localeCompare(a.date) || b.id-a.id; });
      var detailRows = sortedItems.map(function(x){
        var icon = CM_CAT_ICONS[x.cat]||'📌';
        var paidTxt = x.paid === false
          ? '<span style="color:var(--red)">未撥款</span>'
          : '<span style="color:var(--green)">已撥款</span>';
        return '<tr>'+
          '<td style="font-size:13.5px;color:var(--text3)">'+x.date.slice(5)+'</td>'+
          '<td style="font-size:13.5px">'+icon+' '+x.cat+'</td>'+
          '<td style="font-weight:500">'+x.name+'</td>'+
          '<td style="color:var(--gold2);font-weight:600">$'+x.amount.toLocaleString()+'</td>'+
          '<td style="font-size:13.5px;color:var(--text3)">'+x.source+'</td>'+
          '<td style="font-size:13.5px">'+paidTxt+'</td>'+
          '</tr>';
      }).join('');
      html += '<div style="padding:0 14px 12px 14px;background:var(--bg2)">';
      html += '<table><thead><tr><th>日期</th><th>類別</th><th>品項</th><th>金額</th><th>來源</th><th>撥款狀態</th></tr></thead><tbody>'+detailRows+'</tbody></table>';
      html += '</div>';
    }
    html += '</div>';
  });
  html += '</div>';

  areaEl.innerHTML = html;
}



// ── AI 照片辨識耗材 ────────────────────────────────────────

var cmAIItems = []; // 暫存辨識結果

function handleCMPhotos(input) {
  var files = Array.from(input.files);
  if (!files.length) return;

  // 預覽
  var previewEl = document.getElementById('cm-photo-preview');
  previewEl.innerHTML = '';
  files.forEach(function(file) {
    var url = URL.createObjectURL(file);
    var img = document.createElement('img');
    img.src = url;
    img.style.cssText = 'width:80px;height:80px;object-fit:cover;border-radius:6px;border:1px solid var(--border)';
    previewEl.appendChild(img);
  });

  // 開始辨識
  setAIStatus('loading', '🔍 AI 辨識中，請稍候...');
  document.getElementById('cm-ai-results').style.display = 'none';
  cmAIItems = [];

  // 轉 base64（先縮圖再上傳，省流量也加速辨識）
  var promises = files.map(function(file) { return fileToOCRBase64(file, 1568); });

  Promise.all(promises).then(function(base64List) {
    return recognizeImages(base64List);
  }).then(function(items) {
    cmAIItems = items;
    renderAIResults(items);
    setAIStatus('ok', '✅ 辨識完成，共 ' + items.length + ' 筆，請確認後匯入。');
    document.getElementById('cm-ai-results').style.display = 'block';
  }).catch(function(err) {
    console.error('AI error:', err);
    setAIStatus('err', '❌ 辨識失敗：' + err.message);
  });
}

function setAIStatus(type, msg) {
  var el = document.getElementById('cm-ai-status');
  el.style.display = 'block';
  var colors = { loading: 'var(--gold)', ok: 'var(--green)', err: 'var(--red)' };
  el.style.color = colors[type] || 'var(--text2)';
  el.style.fontSize = '13px';
  el.style.marginBottom = '10px';
  el.textContent = msg;
}

async function recognizeImages(base64List) {
  var mKey = getCMMonthKey();

  // 1) 主力：Claude AI 辨識（Railway 後端）。收據、簡體字截圖、手寫都可以。
  try {
    setAIStatus('loading', '🤖 Claude AI 辨識中（共 ' + base64List.length + ' 張，約 10~30 秒）...');
    var res = await claudeOCR(base64List, 'receipt');
    var aiItems = (res.items || []).map(function(x) {
      var currency = (x.currency || 'TWD').toUpperCase();
      if (['TWD','CNY','USD','JPY'].indexOf(currency) === -1) currency = 'TWD';
      var rate = currency === 'CNY' ? 4.4 : 1;
      var amt = parseFloat(x.amount) || 0;
      var name = (x.name || '').trim() || '照片辨識項目';
      return {
        date: (x.date && /^\d{4}-\d{2}-\d{2}$/.test(x.date)) ? x.date : (mKey + '-01'),
        cat: guessCMCategory(name),
        name: name,
        origAmt: amt,
        currency: currency,
        rate: rate,
        twd: currency === 'TWD' ? Math.round(amt) : Math.round(amt * rate),
        source: (x.source || 'AI辨識'),
        note: 'Claude AI 辨識，請確認'
      };
    }).filter(function(x){ return x.origAmt > 0; });
    if (!aiItems.length) throw new Error('AI 沒有在照片裡找到金額');
    return aiItems.slice(0, 30);
  } catch (aiErr) {
    console.warn('Claude OCR 失敗，改用備援 Tesseract：', aiErr);
    setAIStatus('loading', '⚠️ AI 服務暫時連不上（' + aiErr.message + '），改用備援辨識（準確度較低）...');
  }

  // 2) 備援：Tesseract 純前端 OCR
  await loadTesseractScript();
  var texts = [];
  for (var i = 0; i < base64List.length; i++) {
    setAIStatus('loading', '🔍 備援 OCR 辨識中（第 ' + (i+1) + '/' + base64List.length + ' 張）...');
    var result = await window.Tesseract.recognize('data:image/jpeg;base64,' + base64List[i], 'chi_tra+eng');
    texts.push((result && result.data && result.data.text) || '');
  }
  var items = parseConsumableOCRText(texts.join('\n'), mKey);
  if (!items.length) throw new Error('有讀到文字，但沒有抓到金額。請確認照片清楚，或先手動輸入這筆支出。');

  // 計算台幣金額
  items.forEach(function(x) {
    var rate = parseFloat(x.rate) || (x.currency === 'CNY' ? 4.4 : 1);
    x.rate = rate;
    x.twd = x.currency === 'TWD' ? Math.round(x.origAmt) : Math.round(x.origAmt * rate);
    if (!x.date) x.date = mKey + '-01';
  });

  return items;
}

function guessCMCategory(name) {
  var s = (name || '').toLowerCase();
  if (curStore.consumables === 'camp') {
    if (/便當|餐|飯|麵|飲|水|茶|點心|零食|冰|果|奶|披薩|漢堡|外送/.test(s)) return '餐食';
    if (/顏料|paint|壓克力|水彩|畫布|canvas|畫框|木框|紙|素描|筆|刷|畫刀|樹脂|uv|膠|材料|黏土|石膏|珠|布/.test(s)) return '上課材料';
    return '雜費';
  }
  if (/顏料|paint|壓克力|油畫|水彩|色粉/.test(s)) return '顏料';
  if (/畫布|canvas|畫框|木框|框|f號|p號/.test(s)) return '畫布';
  if (/紙|素描|卡紙|影印|列印/.test(s)) return '紙張';
  if (/筆|刷|排刷|畫刀/.test(s)) return '筆刷';
  if (/樹脂|uv|膠|ab膠|滴膠/.test(s)) return '樹脂';
  if (/松節油|調和油|溶劑|酒精/.test(s)) return '溶劑';
  if (/袋|盒|包裝|膠帶|氣泡/.test(s)) return '包裝';
  if (/清潔|抹布|拖把|垃圾袋|衛生紙/.test(s)) return '清潔';
  if (/印刷|海報|貼紙|名片/.test(s)) return '印刷';
  return '其他';
}

function parseConsumableOCRText(text, mKey) {
  var lines = (text || '').split(/\n+/).map(function(l){ return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  var year = mKey.slice(0,4);
  var defaultDate = mKey + '-01';
  var foundDate = defaultDate;
  var items = [];

  lines.forEach(function(line) {
    var dm = line.match(/(20\d{2})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/) || line.match(/(\d{1,2})[\/\-.月](\d{1,2})/);
    if (dm) {
      if (dm.length === 4) foundDate = dm[1] + '-' + String(parseInt(dm[2],10)).padStart(2,'0') + '-' + String(parseInt(dm[3],10)).padStart(2,'0');
      else foundDate = year + '-' + String(parseInt(dm[1],10)).padStart(2,'0') + '-' + String(parseInt(dm[2],10)).padStart(2,'0');
    }
  });

  lines.forEach(function(line) {
    if (/合計|總計|小計|找零|稅額|刷卡|付款|應收|實收|發票|統編/i.test(line)) return;
    var currency = /¥|￥|RMB|CNY|人民幣|淘寶|淘宝|1688/i.test(line) ? 'CNY' : 'TWD';
    var matches = line.match(/(?:NT\$|TWD|\$|¥|￥)?\s*-?\d{1,6}(?:,\d{3})*(?:\.\d{1,2})?/g);
    if (!matches || !matches.length) return;
    var rawAmt = matches[matches.length - 1].replace(/[^\d.-]/g, '');
    var amt = parseFloat(rawAmt);
    if (!amt || amt <= 0) return;
    var name = line.replace(matches[matches.length - 1], '').replace(/^[\d\-\.\s]+/, '').trim();
    name = name.replace(/(NT\$|TWD|RMB|CNY|人民幣|¥|￥|\$)/gi, '').trim();
    if (!name || name.length < 2) name = '照片辨識項目';
    items.push({
      date: foundDate,
      cat: guessCMCategory(name),
      name: name,
      origAmt: amt,
      currency: currency,
      rate: currency === 'CNY' ? 4.4 : 1,
      source: /淘寶|淘宝|1688/i.test(line + text) ? '淘寶' : '照片辨識',
      note: 'OCR辨識，請確認'
    });
  });

  return items.slice(0, 30);
}

function renderAIResults(items) {
  var el = document.getElementById('cm-ai-rows');
  if (!items.length) { el.innerHTML = '<div class="empty">未辨識到任何品項</div>'; return; }

  var CUR_OPTS = [['TWD','NT$台幣'],['CNY','¥人民幣'],['USD','$美元'],['JPY','¥日圓']];
  var CAT_OPTS = getCMCats();

  el.innerHTML = '';
  items.forEach(function(item, i) {
    var row = document.createElement('div');
    row.id = 'airow_' + i;
    row.style.cssText = 'background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:8px;display:grid;grid-template-columns:100px 1fr 70px 80px 70px 70px 70px auto;gap:8px;align-items:center';

    // 日期
    var dateInp = document.createElement('input');
    dateInp.type = 'date'; dateInp.value = item.date || '';
    dateInp.className = 'ai-date';
    dateInp.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 7px;border-radius:5px;font-size:13.5px;outline:none;font-family:inherit;width:100%';

    // 品項
    var nameInp = document.createElement('input');
    nameInp.type = 'text'; nameInp.value = item.name || '';
    nameInp.className = 'ai-name';
    nameInp.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;font-size:14.5px;outline:none;font-family:inherit;width:100%';

    // 類別
    var catSel = document.createElement('select');
    catSel.className = 'ai-cat';
    catSel.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 6px;border-radius:5px;font-size:13.5px;outline:none;font-family:inherit';
    CAT_OPTS.forEach(function(c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      if (c === item.cat) o.selected = true;
      catSel.appendChild(o);
    });

    // 原幣金額
    var amtInp = document.createElement('input');
    amtInp.type = 'number'; amtInp.value = item.origAmt || 0;
    amtInp.className = 'ai-amt'; amtInp.step = '0.01'; amtInp.min = '0';
    amtInp.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 7px;border-radius:5px;font-size:14.5px;outline:none;font-family:inherit;text-align:right;width:100%';
    amtInp.addEventListener('wheel', function(){ this.blur(); });
    amtInp.addEventListener('input', function(){ recalcAIRow(i); });

    // 幣別
    var curSel = document.createElement('select');
    curSel.className = 'ai-cur';
    curSel.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 4px;border-radius:5px;font-size:12.5px;outline:none;font-family:inherit';
    CUR_OPTS.forEach(function(opt) {
      var o = document.createElement('option');
      o.value = opt[0]; o.textContent = opt[1];
      if (opt[0] === (item.currency||'TWD')) o.selected = true;
      curSel.appendChild(o);
    });
    curSel.addEventListener('change', function(){ recalcAIRow(i); });

    // 匯率
    var rateInp = document.createElement('input');
    rateInp.type = 'number'; rateInp.value = item.rate || 1;
    rateInp.className = 'ai-rate'; rateInp.step = '0.01'; rateInp.min = '0';
    rateInp.style.cssText = 'background:var(--bg);border:1px solid var(--border);color:var(--text);padding:5px 7px;border-radius:5px;font-size:13.5px;outline:none;font-family:inherit;text-align:right;width:100%';
    rateInp.addEventListener('wheel', function(){ this.blur(); });
    rateInp.addEventListener('input', function(){ recalcAIRow(i); });

    // 台幣顯示
    var twdDiv = document.createElement('div');
    twdDiv.id = 'aitwd_' + i;
    twdDiv.style.cssText = 'color:var(--gold2);font-weight:600;font-size:14.5px;text-align:right;white-space:nowrap';
    twdDiv.textContent = 'NT$' + (item.twd||0).toLocaleString();

    // 刪除
    var delBtn = document.createElement('button');
    delBtn.textContent = '✕';
    delBtn.style.cssText = 'background:transparent;border:1px solid #553;color:#a88;padding:5px 9px;border-radius:5px;cursor:pointer;font-size:13.5px';
    delBtn.addEventListener('click', function(){ row.remove(); });

    row.appendChild(dateInp);
    row.appendChild(nameInp);
    row.appendChild(catSel);
    row.appendChild(amtInp);
    row.appendChild(curSel);
    row.appendChild(rateInp);
    row.appendChild(twdDiv);
    row.appendChild(delBtn);
    el.appendChild(row);
  });

  // 欄位標題
  var header = document.createElement('div');
  header.style.cssText = 'display:grid;grid-template-columns:100px 1fr 70px 80px 70px 70px 70px auto;gap:8px;padding:0 14px;margin-bottom:4px';
  ['日期','品項','類別','金額','幣別','匯率','台幣',''].forEach(function(t) {
    var span = document.createElement('span');
    span.style.cssText = 'font-size:12.5px;color:var(--text3);text-transform:uppercase;letter-spacing:0.5px';
    span.textContent = t;
    header.appendChild(span);
  });
  el.insertBefore(header, el.firstChild);
}

function recalcAIRow(i) {
  var row = document.getElementById('airow_' + i);
  if (!row) return;
  var amt = parseFloat(row.querySelector('.ai-amt').value) || 0;
  var cur = row.querySelector('.ai-cur').value;
  var rate = parseFloat(row.querySelector('.ai-rate').value) || 1;
  var twd = cur === 'TWD' ? Math.round(amt) : Math.round(amt * rate);
  var twdEl = document.getElementById('aitwd_' + i);
  if (twdEl) twdEl.textContent = 'NT$' + twd.toLocaleString();
}

function importAIResults() {
  var rows = document.querySelectorAll('#cm-ai-rows div[id^="airow_"]');
  if (!rows.length) { alert('沒有可匯入的項目'); return; }

  var k = getCMKey();
  if (!S.consumables) S.consumables = {};
  if (!S.consumables[k]) S.consumables[k] = [];
  var mKey = getCMMonthKey();
  var count = 0;

  rows.forEach(function(row) {
    var name = row.querySelector('.ai-name').value.trim();
    if (!name) return;
    var origAmt = parseFloat(row.querySelector('.ai-amt').value) || 0;
    var cur = row.querySelector('.ai-cur').value;
    var rate = parseFloat(row.querySelector('.ai-rate').value) || 1;
    var twd = cur === 'TWD' ? Math.round(origAmt) : Math.round(origAmt * rate);
    var dateVal = row.querySelector('.ai-date').value || getCMMonthKey() + '-01';
    var cat = row.querySelector('.ai-cat').value;

    S.consumables[k].push({
      id: Date.now() + count,
      date: dateVal,
      cat: cat,
      name: name,
      currency: cur,
      origAmt: origAmt,
      rate: cur !== 'TWD' ? rate : null,
      amount: twd,
      source: '—',
      note: '',
      details: null
    });
    count++;
  });

  save();
  clearAIResults();
  renderConsumables();
  setAIStatus('ok', '✅ 已匯入 ' + count + ' 筆耗材紀錄。');
}

function clearAIResults() {
  document.getElementById('cm-ai-results').style.display = 'none';
  document.getElementById('cm-ai-rows').innerHTML = '';
  document.getElementById('cm-photo-preview').innerHTML = '';
  document.getElementById('cm-photo-input').value = '';
  cmAIItems = [];
  var statusEl = document.getElementById('cm-ai-status');
  statusEl.style.display = 'none';
}

function toggleDetail(id) {
  var el = document.getElementById(id);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

function dlConsumableExcel() {
  var items = getConsumables();
  var mKey = getCMMonthKey();
  var store = curStore.consumables;
  var storeName = CM_STORE_NAMES[store] || store;
  var deptName = CM_STORE_DEPT[store] || (storeName + 'Otto2 ART CLUB');
  var CUR_NAMES = { TWD:'台幣', CNY:'人民幣', USD:'美元', JPY:'日圓' };

  var ym = mKey.split('-');
  var y = parseInt(ym[0],10), m = parseInt(ym[1],10);
  var lastDay = getDaysInMonth(y, m);
  var mm = String(m).padStart(2,'0');
  var periodStr = y+'年'+mm+'月01日　～　'+y+'年'+mm+'月'+String(lastDay).padStart(2,'0')+'日';

  var openBal = getCMOpeningBalance(mKey, store);
  var openBalStr = (openBal !== null) ? openBal.toLocaleString() : '';

  // 匯出跟畫面上的「只顯示未撥款」勾選狀態一致：勾了就只匯出還沒處理的，
  // 已經撥款過的那批不會又被匯出一次。
  var unpaidOnlyEl = document.getElementById('cm-unpaid-only');
  var unpaidOnly = !!(unpaidOnlyEl && unpaidOnlyEl.checked);
  var exportItems = unpaidOnly ? items.filter(function(x){ return x.paid === false; }) : items;
  var sorted = exportItems.slice().sort(function(a,b){ return a.date.localeCompare(b.date) || a.id-b.id; });
  var totalExpense = exportItems.reduce(function(s,x){ return s+x.amount; }, 0);

  // 把幣別換算 / 多明細 / 備註 / 購買管道 / 撥款狀態等資訊，整合進「品明細項」描述，避免資料遺失
  function buildDesc(x) {
    var parts = [x.name];
    if (x.currency && x.currency !== 'TWD') {
      parts.push((CUR_NAMES[x.currency]||x.currency)+' '+x.origAmt+' ×'+x.rate);
    }
    if (x.details && x.details.length > 0) {
      parts.push(x.details.map(function(d){
        var dOrig = (d.currency && d.currency !== 'TWD') ? d.origAmt+'('+d.currency+'×'+d.rate+')=NT$'+d.twd : 'NT$'+d.twd;
        return d.name+':'+dOrig;
      }).join('、'));
    }
    // 有填購買人時，付款人欄改顯示購買人，購買管道改放進這裡避免遺失
    if (x.buyer && x.source) parts.push('購買管道:'+x.source);
    if (x.paid === false) parts.push('⚠零用金尚未撥款，代墊中');
    if (x.note) parts.push(x.note);
    return parts.join('｜');
  }

  var rIdx = {
    title:0, period:1, dept:2, balanceBox:3, header:4,
    dataStart:5
  };
  var dataCount = sorted.length;
  rIdx.total   = rIdx.dataStart + dataCount;
  rIdx.blank1  = rIdx.total + 1;
  rIdx.apply   = rIdx.blank1 + 1;
  rIdx.acct    = rIdx.apply + 1;
  rIdx.blank2  = rIdx.acct + 1;
  rIdx.sign    = rIdx.blank2 + 1;

  var rows = [];
  rows.push(['美林藝術文創(股)公司','','','','','','']);
  rows.push([periodStr,'','','','','','']);
  rows.push(['部門-'+deptName,'','','','','','']);
  rows.push(['上期餘額：'+openBalStr,'','','撥入金額：','','','']);
  rows.push(['日期','類別','品明細項','撥入金額','支出金額','付款人','領款人簽名']);
  sorted.forEach(function(x){
    var payerCell = x.buyer || x.source || '';
    rows.push([x.date, x.cat, buildDesc(x), '', x.amount, payerCell, '']);
  });
  rows.push(['','','合計','', totalExpense, '', '']);
  rows.push(['','','','','','','']);
  rows.push(['本次申請撥補金額：','','','','','','']);
  rows.push(['本次撥補金額(會計填)：','','','','','','']);
  rows.push(['','','','','','','']);
  rows.push(['執行長：　　　會簽單位：　　　單位主管：　　　會計：　　　申請人：','','','','','','']);

  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:10},{wch:34},{wch:10},{wch:10},{wch:10},{wch:12}];
  ws['!merges'] = [
    {s:{r:rIdx.title,c:0}, e:{r:rIdx.title,c:6}},
    {s:{r:rIdx.period,c:0}, e:{r:rIdx.period,c:6}},
    {s:{r:rIdx.dept,c:0}, e:{r:rIdx.dept,c:6}},
    {s:{r:rIdx.balanceBox,c:0}, e:{r:rIdx.balanceBox,c:2}},
    {s:{r:rIdx.balanceBox,c:3}, e:{r:rIdx.balanceBox,c:6}},
    {s:{r:rIdx.apply,c:0}, e:{r:rIdx.apply,c:6}},
    {s:{r:rIdx.acct,c:0}, e:{r:rIdx.acct,c:6}},
    {s:{r:rIdx.sign,c:0}, e:{r:rIdx.sign,c:6}}
  ];

  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '零用金支出明細表');
  XLSX.writeFile(wb, 'Otto2_'+storeName+'_零用金支出明細表_'+mKey+'.xlsx');
}


// ══════════════════════════════════════════════════════════
// 庫存盤點系統
// ══════════════════════════════════════════════════════════
const INV_CATS = ['畫布','框木板','飾品配件','顏料','紙張','筆刷','樹脂','溶劑','包裝','清潔','印刷','其他'];
const INV_CAT_ICONS = {'畫布':'🖼','框木板':'🪞','飾品配件':'⏰','顏料':'🎨','紙張':'📄','筆刷':'🖌','樹脂':'💎','溶劑':'🧪','包裝':'📦','清潔':'🧹','印刷':'🖨','其他':'📌'};
// 品項清單從空白開始，不自動帶入任何預設品項，請在「管理品項清單」自行新增。
