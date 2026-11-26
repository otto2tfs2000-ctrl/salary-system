/* ══════════════════════════════════════════════════════════
   🎪 活動支出（2026-11-19，耗材記帳最右邊那顆按鈕）
   每場活動（坐下聊花餐敘、夏令營…）向公司另外提領一筆經費，支出從這筆經費獨立扣，
   不算進四樓／二樓每月的零用金結餘。活動常跨好幾個月採買，所以帳是「照活動」歸，
   畫面再照月份分組，看得出每個月各花了多少。

   收入＝活動公告「📝 報名登記」裡已繳費的金額（自動抓）＋手動登記的其他收入。
   額度（大熊 2026-11-19 定）：材料上限＝收入 × 30%、每場至少保留淨賺 10,000，
   其他（餐、場地、雜支）可花＝收入 − 材料上限 − 保留淨賺。兩個數字每場活動可以改。

   資料：S.evFund[活動id] = { target, matPct, draws:[{id,date,amt,note,by}],
     incomes:[{id,date,amt,note,by}], items:[{id,date,cat,name,amount,pay,repaid,buyer,note,by,at}] }
   pay：fund＝用活動經費付／self＝自己先墊（repaid=true 才算從經費還出去）／company＝公司直接付（不動經費）
   陣列刪除一定要先 tombstoneMark，不然存檔補缺會把雲端那筆補回來。
   Firebase 不存空陣列，讀回來的陣列欄位一律先補 []。
   ══════════════════════════════════════════════════════════ */
var EF_CATS = ['材料', '餐飲', '場地', '印刷', '交通', '雜支'];
var EF_CAT_ICON = { '材料':'🎨', '餐飲':'🍽', '場地':'🏠', '印刷':'🖨', '交通':'🚗', '雜支':'📌' };
var EF_PAY = { fund:'活動經費', self:'自己先墊', company:'公司直接付' };
var EF_DEF_TARGET = 10000, EF_DEF_MAT = 30;
var efId = null, efReg = null, efRegFor = null, efRegErr = '', efBusy = false;
try { efId = localStorage.getItem('otto2_ef_id') || null } catch(e) {}

function efEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] }) }
function efMoney(n){ n = Math.round(+n || 0); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString() }
function efMe(){ return (typeof ME !== 'undefined' && ME && ME.displayName) || '' }
function efToday(){ var d = new Date(Date.now() + 8 * 3600e3); return d.toISOString().slice(0, 10) }
function efNewId(p){ return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 5) }

function efRec(id){
  if (!S.evFund) S.evFund = {};
  if (!S.evFund[id]) S.evFund[id] = { target: EF_DEF_TARGET, matPct: EF_DEF_MAT };
  var r = S.evFund[id];
  ['draws', 'incomes', 'items'].forEach(function(k){ if (!Array.isArray(r[k])) r[k] = r[k] && typeof r[k] === 'object' ? Object.values(r[k]) : [] });
  if (r.target == null || isNaN(+r.target)) r.target = EF_DEF_TARGET;
  if (r.matPct == null || isNaN(+r.matPct)) r.matPct = EF_DEF_MAT;
  return r;
}

/* 報名應收：跟 events.js 的 regDue 同一條公式（會員本人＝活動費用數字、已含 DIY；攜伴 1200、攜伴 DIY 300） */
function efFeeNum(ev){ var m = String((ev && ev.fee) || '').replace(/,/g, '').match(/\d+/); return m ? +m[0] : 0 }
function efDue(ev, r){
  var comp = r.companion != null ? +r.companion || 0 : Math.max(0, (+r.dinner || 0) - 1);
  var diy = Math.min(comp, +r.diy || 0);
  var cf = typeof REG_COMP_FEE !== 'undefined' ? REG_COMP_FEE : 1200, df = typeof REG_DIY_FEE !== 'undefined' ? REG_DIY_FEE : 300;
  return efFeeNum(ev) + comp * cf + diy * df;
}
function efRegSum(ev){
  var o = { n:0, nPaid:0, got:0, owe:0, nOwe:0 };
  if (!efReg) return o;
  Object.values(efReg).forEach(function(r){
    if (!r) return;
    o.n++;
    var due = efDue(ev, r), paid = r.paid ? (+r.payAmt || 0) : 0;
    if (r.paid) { o.nPaid++; o.got += paid }
    var short = Math.max(0, due - paid);
    if (short > 0) { o.owe += short; o.nOwe++ }
  });
  return o;
}

function efCalc(id){
  var ev = (evData && evData.list && evData.list[id]) || {};
  var f = efRec(id), reg = efRegSum(ev);
  var other = f.incomes.reduce(function(t, x){ return t + (+x.amt || 0) }, 0);
  var R = reg.got + other, Rfull = R + reg.owe;
  var spent = 0, mat = 0, fundOut = 0, selfOwe = 0;
  f.items.forEach(function(x){
    var a = +x.amount || 0; spent += a;
    if (x.cat === '材料') mat += a;
    if (x.pay === 'self') { if (x.repaid) fundOut += a; else selfOwe += a }
    else if (x.pay !== 'company') fundOut += a;
  });
  var drawn = f.draws.reduce(function(t, x){ return t + (+x.amt || 0) }, 0);
  var gotAmt = f.draws.reduce(function(t, x){ return t + (x.got ? (+x.amt || 0) : 0) }, 0);
  var pct = (+f.matPct || 0) / 100, tgt = +f.target || 0;
  function caps(rev){ var mc = rev * pct; return { matCap: mc, othCap: rev - mc - tgt, allLeft: rev - tgt - spent } }
  return { ev: ev, f: f, reg: reg, other: other, R: R, Rfull: Rfull, spent: spent, mat: mat, oth: spent - mat,
    drawn: drawn, gotAmt: gotAmt, fundOut: fundOut, fundLeft: drawn - fundOut, selfOwe: selfOwe, tgt: tgt, pct: pct,
    now: caps(R), full: caps(Rfull) };
}

async function efLoadReg(id){
  efReg = null; efRegErr = ''; efRegFor = id;
  try { efReg = (await staffApi('/staff/events/reg', { id: id })).reg || {} }
  catch(e) { efReg = {}; efRegErr = e.message || '讀不到' }
}

async function renderEventFund(){
  var el = document.getElementById('ef-area'); if (!el) return;
  if (typeof evData === 'undefined' || !evData) {
    el.innerHTML = '<div class="card"><div class="empty">載入活動清單中…</div></div>';
    try { await evLoad() } catch(e) { el.innerHTML = '<div class="card"><div class="empty">讀不到活動清單：' + efEsc(e.message) + '</div></div>'; return }
  }
  var list = Object.values(evData.list || {}).filter(function(e){ return e && e.id }).sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')) });
  if (efId && !evData.list[efId]) efId = null;
  if (efId && efRegFor !== efId && !efBusy) {
    efBusy = true; el.innerHTML = efPickerHtml(list) + '<div class="card"><div class="empty">讀取報名收款中…</div></div>';
    await efLoadReg(efId); efBusy = false;
  }
  el.innerHTML = efPickerHtml(list) + (efId ? efBodyHtml(efId) : '<div class="card"><div class="empty">先在上面選一個活動。<br>活動要先在「活動公告」建好（夏令營這種不對外的，建了之後把「島上顯示」關掉就好）。</div></div>');
}

function efPickerHtml(list){
  var opts = '<option value="">（選擇活動）</option>' + list.map(function(e){
    var has = S.evFund && S.evFund[e.id] ? ' ●' : '';
    return '<option value="' + efEsc(e.id) + '"' + (e.id === efId ? ' selected' : '') + '>' + efEsc((e.date || '').replace(/-/g, '/') + '　' + (e.title || '（未命名）')) + has + '</option>';
  }).join('');
  return '<div class="card"><div class="card-title">🎪 活動支出（向公司另外提領的經費，不算進每月零用金）</div>' +
    '<div class="toolbar"><select id="ef-pick" onchange="efPick(this.value)" style="min-width:260px;max-width:100%">' + opts + '</select>' +
    (efId ? '<button class="btn btn-outline btn-sm" onclick="efRefresh()">↻ 重新讀取收款</button><button class="btn btn-outline btn-sm" onclick="efExcel()">⬇ 匯出這場的明細</button><button class="btn btn-outline btn-sm" onclick="efPettyExcel()">🖨 匯出支出明細表（簽收用）</button>' : '') +
    '</div><div class="muted" style="margin-top:8px">● ＝已經有記帳的活動</div></div>';
}
function efPick(id){ efId = id || null; efRegFor = null; try { localStorage.setItem('otto2_ef_id', efId || '') } catch(e) {} renderEventFund() }
async function efRefresh(){ efRegFor = null; renderEventFund() }

function efTile(lbl, val, sub, cls){
  return '<div class="stat-card' + (cls ? ' ' + cls : '') + '"><div class="lbl">' + lbl + '</div><div class="val" style="font-size:23px">' + val + '</div>' + (sub ? '<div style="font-size:var(--fs-sm);color:var(--text3);margin-top:3px;line-height:1.5">' + sub + '</div>' : '') + '</div>';
}
function efNeg(n, s){ return n < 0 ? '<span style="color:var(--red)">' + (s || efMoney(n)) + '</span>' : (s || efMoney(n)) }

function efBodyHtml(id){
  var c = efCalc(id), ev = c.ev, f = c.f, pctTxt = Math.round(c.pct * 100) + '%';
  var h = '';
  if (efRegErr) h += '<div class="info-box" style="border-color:var(--red)">⚠ 讀不到報名收款（' + efEsc(efRegErr) + '），下面的收入只算手動登記的。</div>';

  /* ── 總表 ── */
  h += '<div class="card"><div class="card-title">📊 ' + efEsc(ev.title || '') + (ev.date ? '　<span class="muted">' + efEsc(ev.date.replace(/-/g, '/')) + '</span>' : '') + '</div>';
  h += '<div class="stat-grid">' +
    efTile('收入（已收）', efMoney(c.R),
      '報名已繳 ' + c.reg.nPaid + '/' + c.reg.n + ' 人 ' + efMoney(c.reg.got) + (c.other ? '<br>其他收入 ' + efMoney(c.other) : '') +
      (c.reg.owe ? '<br><span style="color:var(--red)">還沒收 ' + efMoney(c.reg.owe) + '（' + c.reg.nOwe + ' 人）</span>' : '<br>報名的錢都收齊了')) +
    efTile('已經花了', efMoney(c.spent), '材料 ' + efMoney(c.mat) + '<br>其他 ' + efMoney(c.oth)) +
    efTile('現在還能花', efNeg(c.now.allLeft), '＝已收 − 保留淨賺 ' + efMoney(c.tgt) + ' − 已花' + (c.reg.owe ? '<br>全部收齊後：' + efNeg(c.full.allLeft) : ''), 'hi') +
    efTile('預估淨賺', efNeg(c.R - c.spent), '目標至少 ' + efMoney(c.tgt) + (c.reg.owe ? '<br>全部收齊後：' + efNeg(c.Rfull - c.spent) : '')) +
  '</div>';
  if (c.R - c.spent < c.tgt && c.R > 0 && c.full.allLeft < 0)
    h += '<div class="info-box" style="border-color:var(--red);margin-bottom:12px">⚠ 照目前的報名，就算全部收齊，這場也賺不到 ' + efMoney(c.tgt) + '。要嘛多招人，要嘛壓支出。</div>';

  /* 額度明細 */
  function bar(spent, cap){ var p = cap > 0 ? Math.min(100, spent / cap * 100) : (spent > 0 ? 100 : 0); var over = spent > cap;
    return '<div style="height:8px;background:var(--bg3);border-radius:4px;overflow:hidden;margin:4px 0"><div style="height:100%;width:' + p.toFixed(1) + '%;background:' + (over ? 'var(--red)' : 'var(--gold)') + '"></div></div>' }
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px">' +
    '<div><b>🎨 材料</b>（收入 × ' + pctTxt + '）<br>' + bar(c.mat, c.now.matCap) +
      '<span class="muted">上限 ' + efMoney(c.now.matCap) + '・已花 ' + efMoney(c.mat) + '・剩 </span>' + efNeg(c.now.matCap - c.mat) +
      (c.reg.owe ? '<div class="muted">全部收齊後上限 ' + efMoney(c.full.matCap) + '</div>' : '') + '</div>' +
    '<div><b>🍽 餐飲、場地、雜支等</b>（收入 − 材料 − 保留淨賺）<br>' + bar(c.oth, c.now.othCap) +
      '<span class="muted">上限 ' + efMoney(c.now.othCap) + '・已花 ' + efMoney(c.oth) + '・剩 </span>' + efNeg(c.now.othCap - c.oth) +
      (c.reg.owe ? '<div class="muted">全部收齊後上限 ' + efMoney(c.full.othCap) + '</div>' : '') + '</div>' +
  '</div>';
  h += '<div class="toolbar" style="margin-top:14px;font-size:var(--fs-sm);color:var(--text2)">這場的設定：保留淨賺 <input type="number" class="in-num" style="width:100px" value="' + (+f.target || 0) + '" onchange="efSet(\'target\',this.value)" onwheel="this.blur()">' +
    '　材料佔收入 <input type="number" class="in-num" style="width:64px" value="' + (+f.matPct || 0) + '" onchange="efSet(\'matPct\',this.value)" onwheel="this.blur()"> %</div>';
  h += '</div>';

  /* ── 經費 ── */
  h += '<div class="card"><div class="card-title">💰 向公司提領的經費</div><div class="stat-grid">' +
    efTile('提領合計', efMoney(c.drawn), f.draws.length + ' 次' + (c.drawn - c.gotAmt > 0 ? '<br><span style="color:var(--red)">還沒領 ' + efMoney(c.drawn - c.gotAmt) + '</span>' : (f.draws.length ? '<br>都已領取' : ''))) +
    efTile('從經費付出', efMoney(c.fundOut), '含已還的代墊') +
    efTile('經費還剩', efNeg(c.fundLeft), c.fundLeft < 0 ? '<span style="color:var(--red)">不夠了，要再提領 ' + efMoney(-c.fundLeft) + '</span>' : '活動結束後剩的要繳回', 'hi') +
    efTile('還沒還的代墊', efMoney(c.selfOwe), c.selfOwe ? '要從經費還給先墊的人' : '沒有') +
  '</div>';
  h += efMiniList('draws', f.draws, '提領');
  h += efMiniForm('draw', '提領日期', '金額', '備註（例：向會計申請第一筆）') + '</div>';

  /* ── 其他收入 ── */
  h += '<div class="card"><div class="card-title">➕ 其他收入（沒走報名登記的錢，例如營隊學費、贊助）</div>' +
    efMiniList('incomes', f.incomes, '收入') + efMiniForm('inc', '收款日期', '金額', '備註（例：夏令營 12 位學費）') + '</div>';

  /* ── 新增支出 ── */
  var buyers = {}; f.items.forEach(function(x){ if (x.buyer) buyers[x.buyer] = 1 });
  h += '<div class="card"><div class="card-title">➕ 新增活動支出</div><div class="cm-add-grid">' +
    '<div class="fg"><label>日期</label><input id="ef-date" type="date" value="' + efToday() + '"></div>' +
    '<div class="fg"><label>類別</label><select id="ef-cat">' + EF_CATS.map(function(k){ return '<option value="' + k + '">' + EF_CAT_ICON[k] + ' ' + k + '</option>' }).join('') + '</select></div>' +
    '<div class="fg"><label>品項名稱</label><input id="ef-name" placeholder="例：絲巾 40 條"></div>' +
    '<div class="fg"><label>金額</label><input id="ef-amt" type="number" min="0" placeholder="0" onwheel="this.blur()"></div>' +
    '<div class="fg"><label>誰付的錢</label><select id="ef-pay"><option value="fund">活動經費</option><option value="self">自己先墊（之後從經費還）</option><option value="company">公司直接付（不動經費）</option></select></div>' +
    '<div class="fg"><label>購買人員</label><input id="ef-buyer" list="ef-buyer-list" value="' + efEsc(efMe()) + '"></div>' +
    '<div class="fg" style="grid-column:span 2"><label>備註</label><input id="ef-note" placeholder="選填，例：比價後選蝦皮"></div>' +
    '</div><datalist id="ef-buyer-list">' + Object.keys(buyers).map(function(b){ return '<option value="' + efEsc(b) + '">' }).join('') + '</datalist>' +
    '<button class="btn btn-gold" onclick="efAddItem()">+ 記錄支出</button></div>';

  /* ── 按月份分帳 ── */
  h += '<div class="card"><div class="card-title">📋 支出明細（照月份分）</div>' + efItemsHtml(f.items, c.spent) + '</div>';
  return h;
}

function efMiniList(kind, arr, word){
  if (!arr.length) return '<div class="muted" style="margin-bottom:10px">還沒有' + word + '紀錄</div>';
  return '<div style="margin-bottom:12px">' + arr.slice().sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) }).map(function(x){
    return '<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
      '<span style="width:86px">' + efEsc(String(x.date || '').replace(/-/g, '/')) + '</span><b style="width:90px">' + efMoney(x.amt) + '</b>' +
      '<span style="flex:1 1 140px;color:var(--text2)">' + efEsc(x.note || '') + (x.by ? ' <span class="muted">· ' + efEsc(x.by) + '</span>' : '') +
        (kind === 'draws' ? ' ' + (x.got ? '<span class="badge b-green">已領取' + (x.gotAt ? ' ' + efEsc(efMd(x.gotAt)) : '') + (x.gotBy ? ' · ' + efEsc(x.gotBy) : '') + '</span>' : '<span class="badge b-red">還沒領</span>') : '') + '</span>' +
      (kind === 'draws' ? '<button class="btn btn-outline btn-sm" onclick="efGot(\'' + efEsc(x.id) + '\')">' + (x.got ? '改回未領' : '已領取') + '</button>' : '') +
      '<button class="btn btn-outline btn-sm" onclick="efDelMini(\'' + kind + '\',\'' + efEsc(x.id) + '\')">刪除</button></div>';
  }).join('') + '</div>';
}
function efMiniForm(p, dl, al, nl){
  return '<div class="toolbar"><input id="ef-' + p + '-date" type="date" value="' + efToday() + '" title="' + dl + '">' +
    '<input id="ef-' + p + '-amt" type="number" min="0" placeholder="' + al + '" style="width:120px" onwheel="this.blur()">' +
    '<input id="ef-' + p + '-note" placeholder="' + nl + '" style="flex:1 1 200px">' +
    '<button class="btn btn-gold btn-sm" onclick="efAddMini(\'' + p + '\')">+ 記一筆</button></div>';
}

function efItemsHtml(items, total){
  if (!items.length) return '<div class="empty">還沒有支出</div>';
  var byM = {};
  items.forEach(function(x){ var m = String(x.date || '').slice(0, 7) || '未填日期'; (byM[m] = byM[m] || []).push(x) });
  var months = Object.keys(byM).sort();
  var h = '<div class="toolbar" style="margin-bottom:12px">' + months.map(function(m){
    var s = byM[m].reduce(function(t, x){ return t + (+x.amount || 0) }, 0);
    return '<span class="badge b-gold" style="font-size:var(--fs-sm)">' + efEsc(efMonthName(m)) + ' ' + efMoney(s) + '</span>';
  }).join('') + '<span style="font-size:var(--fs-sm)">合計 <b>' + efMoney(total) + '</b></span></div>';
  months.forEach(function(m){
    var rows = byM[m].slice().sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) });
    var s = rows.reduce(function(t, x){ return t + (+x.amount || 0) }, 0);
    h += '<div style="margin-top:14px"><div style="display:flex;justify-content:space-between;font-weight:600;border-bottom:2px solid var(--gold);padding-bottom:4px;margin-bottom:4px"><span>' + efEsc(efMonthName(m)) + '</span><span>' + efMoney(s) + '（' + rows.length + ' 筆）</span></div>';
    rows.forEach(function(x){
      var payTag = x.pay === 'self' ? (x.repaid ? '<span class="badge b-green">代墊已還</span>' : '<span class="badge b-red">' + efEsc(x.buyer || '') + ' 先墊，未還</span>')
        : x.pay === 'company' ? '<span class="badge b-gray">公司直接付</span>' : '';
      h += '<div style="display:flex;gap:10px;align-items:center;padding:7px 0;border-bottom:1px solid var(--border);flex-wrap:wrap">' +
        '<span style="width:52px;color:var(--text3)">' + efEsc(efMd(x.date)) + '</span>' +
        '<span style="width:66px">' + (EF_CAT_ICON[x.cat] || '📌') + ' ' + efEsc(x.cat || '') + '</span>' +
        '<span style="flex:1 1 160px">' + efEsc(x.name || '') + (x.note ? ' <span class="muted">（' + efEsc(x.note) + '）</span>' : '') + ' ' + payTag +
          (x.buyer && !(x.pay === 'self' && !x.repaid) ? ' <span class="muted">· ' + efEsc(x.buyer) + '</span>' : '') + '</span>' +
        '<b style="width:84px;text-align:right">' + efMoney(x.amount) + '</b>' +
        '<span class="toolbar">' +
          (x.pay === 'self' ? '<button class="btn btn-outline btn-sm" onclick="efRepaid(\'' + efEsc(x.id) + '\')">' + (x.repaid ? '改回未還' : '標記已還') + '</button>' : '') +
          '<button class="btn btn-outline btn-sm" onclick="efEditItem(\'' + efEsc(x.id) + '\')">修改</button>' +
          '<button class="btn btn-outline btn-sm" onclick="efDelItem(\'' + efEsc(x.id) + '\')">刪除</button></span></div>';
    });
    h += '</div>';
  });
  return h;
}
function efMonthName(m){ var p = String(m).split('-'); return p.length === 2 ? p[0] + ' 年 ' + (+p[1]) + ' 月' : m }
function efMd(d){ d = String(d || ''); return d.length >= 10 ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : d }
function efVal(id){ var e = document.getElementById(id); return e ? String(e.value || '').trim() : '' }

function efSet(k, v){
  var f = efRec(efId), n = parseFloat(v);
  if (isNaN(n) || n < 0) { alert('請填數字'); renderEventFund(); return }
  if (k === 'matPct' && n > 100) { alert('材料比例最多 100%'); renderEventFund(); return }
  f[k] = n; save(); renderEventFund();
}
function efAddMini(p){
  var amt = parseFloat(efVal('ef-' + p + '-amt')), date = efVal('ef-' + p + '-date');
  if (!date) { alert('請填日期'); return }
  if (!(amt > 0)) { alert('請填金額'); return }
  var f = efRec(efId), arr = p === 'draw' ? f.draws : f.incomes;
  arr.push({ id: efNewId(p === 'draw' ? 'd' : 'i'), date: date, amt: amt, note: efVal('ef-' + p + '-note'), by: efMe() });
  save(); renderEventFund();
}
/* 2026-11-26 提領經費「已領取」：向會計申請後，錢真的拿到手再按 */
function efGot(id){
  var f = efRec(efId), x = f.draws.find(function(it){ return it.id === id });
  if (!x) return;
  x.got = !x.got;
  if (x.got) { x.gotAt = efToday(); x.gotBy = efMe() } else { x.gotAt = null; x.gotBy = null }
  save(); renderEventFund();
}
function efDelMini(kind, id){
  var f = efRec(efId), x = f[kind].find(function(it){ return it.id === id });
  if (!x || !confirm('刪除這筆 ' + efMoney(x.amt) + '？')) return;
  tombstoneMark('evFund.' + efId + '.' + kind, { id: id });
  f[kind] = f[kind].filter(function(it){ return it.id !== id });
  save(); renderEventFund();
}
function efAddItem(){
  var amt = parseFloat(efVal('ef-amt')), name = efVal('ef-name'), date = efVal('ef-date');
  if (!date) { alert('請填日期'); return }
  if (!name) { alert('請填品項名稱'); return }
  if (!(amt > 0)) { alert('請填金額'); return }
  var pay = efVal('ef-pay') || 'fund', f = efRec(efId);
  f.items.push({ id: efNewId('x'), date: date, cat: efVal('ef-cat') || '雜支', name: name, amount: amt, pay: pay, repaid: false,
    buyer: efVal('ef-buyer'), note: efVal('ef-note'), by: efMe(), at: new Date().toISOString() });
  save(); renderEventFund();
}
function efRepaid(id){
  var x = efRec(efId).items.find(function(it){ return it.id === id }); if (!x) return;
  x.repaid = !x.repaid; if (x.repaid) { x.repaidAt = efToday(); x.repaidBy = efMe() }
  save(); renderEventFund();
}
function efDelItem(id){
  var f = efRec(efId), x = f.items.find(function(it){ return it.id === id });
  if (!x || !confirm('刪除「' + (x.name || '') + '」' + efMoney(x.amount) + '？')) return;
  tombstoneMark('evFund.' + efId + '.items', { id: id });
  f.items = f.items.filter(function(it){ return it.id !== id });
  save(); renderEventFund();
}
function efEditItem(id){
  var x = efRec(efId).items.find(function(it){ return it.id === id }); if (!x) return;
  var amt = prompt('金額', x.amount); if (amt === null) return;
  amt = parseFloat(amt); if (!(amt > 0)) { alert('金額要大於 0'); return }
  var name = prompt('品項名稱', x.name || ''); if (name === null) return;
  var date = prompt('日期（例：2026-11-19）', x.date || ''); if (date === null) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { alert('日期格式要像 2026-11-19'); return }
  var cat = prompt('類別：' + EF_CATS.join('／'), x.cat || ''); if (cat === null) return;
  cat = cat.trim(); if (EF_CATS.indexOf(cat) < 0) { alert('類別只能是：' + EF_CATS.join('、')); return }
  x.amount = amt; x.name = name.trim(); x.date = date.trim(); x.cat = cat; x.editBy = efMe(); x.editAt = new Date().toISOString();
  save(); renderEventFund();
}

/* 2026-11-26 跟耗材記帳「⬇ 匯出零用金支出明細表」同一個公司格式（領款人簽名欄＋最下面簽核列），
   印出來給會計／簽收用。提領經費寫在「撥入金額」欄，支出寫在「支出金額」欄。 */
function efPettyExcel(){
  if (!efId) return;
  if (typeof XLSX === 'undefined') { alert('Excel 工具還沒載入，請稍等再按一次'); return }
  var c = efCalc(efId), f = c.f, title = c.ev.title || efId;
  var lines = [];
  f.draws.forEach(function(x){ lines.push({ date: x.date || '', k: 0, cat: '提領經費', desc: '向公司提領活動經費' + (x.note ? '｜' + x.note : '') + (x.got ? '' : '｜⚠還沒領'), inAmt: +x.amt || 0, out: '', payer: x.by || '' }) });
  f.items.forEach(function(x){
    var d = [x.name || ''];
    if (x.pay === 'self') d.push(x.repaid ? '代墊已還' : '⚠' + (x.buyer || '') + '先墊，尚未還');
    if (x.pay === 'company') d.push('公司直接付（不動活動經費）');
    if (x.note) d.push(x.note);
    lines.push({ date: x.date || '', k: 1, cat: x.cat || '', desc: d.join('｜'), inAmt: '', out: +x.amount || 0, payer: x.buyer || '' });
  });
  lines.sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) || a.k - b.k });
  var dates = lines.map(function(x){ return x.date }).filter(Boolean).sort();
  function zh(d){ var p = String(d || '').split('-'); return p.length === 3 ? p[0] + '年' + p[1] + '月' + p[2] + '日' : '' }
  var periodStr = dates.length ? zh(dates[0]) + '　～　' + zh(dates[dates.length - 1]) : '';
  var rows = [];
  rows.push(['美林藝術文創(股)公司', '', '', '', '', '', '']);
  rows.push([periodStr, '', '', '', '', '', '']);
  rows.push(['活動經費-' + title, '', '', '', '', '', '']);
  rows.push(['提領經費合計：' + c.drawn.toLocaleString() + '（已領取 ' + c.gotAmt.toLocaleString() + '）', '', '', '經費還剩：' + c.fundLeft.toLocaleString(), '', '', '']);
  rows.push(['日期', '類別', '品明細項', '撥入金額', '支出金額', '付款人', '領款人簽名']);
  var r0 = rows.length;
  lines.forEach(function(x){ rows.push([x.date, x.cat, x.desc, x.inAmt, x.out, x.payer, '']) });
  rows.push(['', '', '合計', c.drawn, c.spent, '', '']);
  rows.push(['', '', '', '', '', '', '']);
  rows.push(['本次申請撥補金額：', '', '', '', '', '', '']);
  rows.push(['本次撥補金額(會計填)：', '', '', '', '', '', '']);
  rows.push(['', '', '', '', '', '', '']);
  rows.push(['執行長：　　　會簽單位：　　　單位主管：　　　會計：　　　申請人：', '', '', '', '', '', '']);
  var n = rows.length, sign = n - 1, acct = n - 3, apply = n - 4;
  var ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{wch:12},{wch:10},{wch:34},{wch:10},{wch:10},{wch:10},{wch:12}];
  ws['!merges'] = [
    {s:{r:0,c:0}, e:{r:0,c:6}}, {s:{r:1,c:0}, e:{r:1,c:6}}, {s:{r:2,c:0}, e:{r:2,c:6}},
    {s:{r:3,c:0}, e:{r:3,c:2}}, {s:{r:3,c:3}, e:{r:3,c:6}},
    {s:{r:apply,c:0}, e:{r:apply,c:6}}, {s:{r:acct,c:0}, e:{r:acct,c:6}}, {s:{r:sign,c:0}, e:{r:sign,c:6}}
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '活動支出明細表');
  XLSX.writeFile(wb, 'Otto2_活動支出明細表_' + String(title).replace(/[\\/:*?"<>|]/g, '') + '_' + efToday() + '.xlsx');
}

function efExcel(){
  if (!efId) return;
  var c = efCalc(efId), f = c.f, title = c.ev.title || efId;
  var rows = [[title + '　活動收支明細'], ['匯出日期', efToday()], [],
    ['收入（已收）', c.R], ['　報名已繳', c.reg.got], ['　其他收入', c.other], ['還沒收', c.reg.owe],
    ['支出合計', c.spent], ['　材料', c.mat], ['　其他', c.oth], ['預估淨賺（目前）', c.R - c.spent], ['預估淨賺（全部收齊）', c.Rfull - c.spent],
    ['保留淨賺目標', c.tgt], ['材料比例', Math.round(c.pct * 100) + '%'], [],
    ['提領經費合計', c.drawn], ['從經費付出', c.fundOut], ['經費還剩', c.fundLeft], ['還沒還的代墊', c.selfOwe], [],
    ['日期', '月份', '類別', '品項', '金額', '誰付的錢', '購買人', '備註']];
  var byM = {};
  f.items.slice().sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) }).forEach(function(x){
    var m = String(x.date || '').slice(0, 7); byM[m] = (byM[m] || 0) + (+x.amount || 0);
    rows.push([x.date, efMonthName(m), x.cat, x.name, +x.amount || 0, EF_PAY[x.pay] + (x.pay === 'self' ? (x.repaid ? '（已還）' : '（未還）') : ''), x.buyer || '', x.note || '']);
  });
  rows.push([], ['各月小計']);
  Object.keys(byM).sort().forEach(function(m){ rows.push([efMonthName(m), byM[m]]) });
  rows.push([], ['提領紀錄']); f.draws.forEach(function(x){ rows.push([x.date, x.amt, x.note || '', x.got ? '已領取' + (x.gotAt ? ' ' + x.gotAt : '') : '還沒領']) });
  if (f.incomes.length) { rows.push([], ['其他收入']); f.incomes.forEach(function(x){ rows.push([x.date, x.amt, x.note || '']) }) }
  var ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{wch:16},{wch:14},{wch:8},{wch:30},{wch:10},{wch:18},{wch:10},{wch:24}];
  var wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, '活動收支');
  XLSX.writeFile(wb, 'Otto2_活動收支_' + String(title).replace(/[\\/:*?"<>|，,\s]/g, '') + '_' + efToday() + '.xlsx');
}
