/* ══════════════════════════════════════════════════════════
   扭蛋活動分頁（2026-09-30）
   客人在預約頁玩的「十月黑熊扭蛋」，這裡看數字、改獎品、核銷票券。

   資料都在 otto2-booking-f9ef7 的 gacha/ 底下，一律透過伺服器
   （/staff/gacha*）讀寫，瀏覽器不直接碰資料庫：
   - 抽獎、送紅利、送票券都是伺服器做的，這裡只能改「設定」
   - 票券核銷是把那張券的數量改成 0，記下誰、什麼時候核銷的

   ⚠ 紅利跟票券一抽到就已經寫進會員資料了（會員分頁的明細看得到，
     原因欄寫「十月黑熊扭蛋・紅利 N 點」）。這裡改設定只影響之後的抽獎。
   ══════════════════════════════════════════════════════════ */

var gcData = null, gcLoading = false, gcTab = 'overview', gcQuery = '', gcOnlyTkt = false;
var gcTkts = {}, gcDraft = null, gcLotteryPick = null;

function gcEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
var GC_WHO = { all:'所有人', mem:'只有會員', new:'只有新客' };
var GC_TYPE = { bonus:'紅利', ticket:'票券／贈品', none:'銘謝惠顧' };
var GC_WHY = { daily:'每日', 'class':'上課加碼', book:'預約加碼', double:'加碼日', milestone:'集章保底', quiz:'問答加碼', memory:'翻牌加碼', collect:'圖鑑集滿', test:'測試' };
var gcQuiz = null;
var GC_KIND = { cash:'現金抵用', goods:'實體贈品', bundle:'贈課券', other:'其他' };

async function gcLoad(){
  gcLoading = true;
  try {
    gcData = await staffApi('/staff/gacha', {});
    gcDraft = JSON.parse(JSON.stringify(gcData.cfg));
    gcQuiz = JSON.parse(JSON.stringify(gcData.quiz || []));
  } finally { gcLoading = false }
}

async function renderGacha(){
  var el = document.getElementById('gacha-body');
  if (!el) return;
  if (!gcData) {
    el.innerHTML = '<div class="empty">載入扭蛋資料中…</div>';
    try { await gcLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到扭蛋資料：' + gcEsc(e.message) + '</div>'; return }
  }
  var tabs = [['overview','總覽'],['log','中獎紀錄・核銷'],['prizes','獎品設定'],['games','小遊戲'],['settings','活動設定']];
  var h = '<div class="store-tabs" style="margin-bottom:14px">' + tabs.map(function(t){
    return '<button class="store-btn' + (gcTab === t[0] ? ' active' : '') + '" onclick="gcSwitch(\'' + t[0] + '\')">' + t[1] + '</button>' }).join('') +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="gcReload()">↻ 重新讀取</button></div>';
  if (gcData.isDefault) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;margin-bottom:14px">' +
    '目前用的是程式內建的預設設定，還沒在這裡存過。改完獎品或活動設定按「儲存」之後，就會以這裡的為準。</div>';
  h += gcTab === 'log' ? gcLogHtml() : gcTab === 'prizes' ? gcPrizesHtml() : gcTab === 'games' ? gcGamesHtml() : gcTab === 'settings' ? gcSettingsHtml() : gcOverviewHtml();
  el.innerHTML = h;
  if (gcTab === 'log') {
    var sb = document.getElementById('gc-search');
    if (sb) sb.oninput = function(){ gcQuery = this.value; gcDrawLog() };
    gcDrawLog();
    gcFetchTickets();
  }
}
function gcSwitch(t){ gcTab = t; renderGacha() }
async function gcReload(){ gcData = null; gcTkts = {}; await renderGacha() }

function gcLogList(){
  var l = gcData.log || {};
  return Object.keys(l).map(function(k){ return Object.assign({ _k:k }, l[k]) })
    .filter(function(x){ return x && x.at })
    .sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
}
function gcStat(n, label, sub){
  return '<div class="card" style="flex:1 1 150px;margin:0;padding:14px 16px">' +
    '<div class="muted" style="font-size:12.5px">' + label + '</div>' +
    '<div style="font-size:24px;font-weight:600;color:var(--gold2);font-variant-numeric:tabular-nums">' + n + '</div>' +
    (sub ? '<div class="muted" style="font-size:12px">' + sub + '</div>' : '') + '</div>';
}

/* ── 總覽 ── */
function gcOverviewHtml(){
  var cfg = gcData.cfg, today = gcData.today, all = gcLogList();
  var real = all.filter(function(x){ return !x.test });
  var spins = real.filter(function(x){ return x.why !== 'milestone' });
  var todaySpins = spins.filter(function(x){ return x.date === today });
  var uniq = function(a){ var s = {}; a.forEach(function(x){ s[x.phone] = 1 }); return Object.keys(s).length };
  var bonus = real.filter(function(x){ return x.type === 'bonus' }).reduce(function(s, x){ return s + (+x.v || 0) }, 0);
  var tkt = real.filter(function(x){ return x.type === 'ticket' }).length;
  var status = today < cfg.start ? '還沒開始（' + cfg.start.slice(5).replace('-', '/') + ' 開始）' : today > cfg.end ? '已結束' : '進行中';

  var h = '<div class="card"><div class="card-title">' + gcEsc(cfg.title) + '　<span style="font-size:13px;color:var(--text2);font-weight:400">' +
    cfg.start.replace(/-/g, '/') + '～' + cfg.end.slice(5).replace('-', '/') + '・' + status + '</span></div>' +
    '<div style="display:flex;flex-wrap:wrap;gap:10px">' +
    gcStat(uniq(todaySpins), '今天玩的人', '轉了 ' + todaySpins.length + ' 次') +
    gcStat(Object.keys(gcData.players || {}).length, '參加過的人', '綁好電話的 LINE 帳號') +
    gcStat(spins.length, '累計轉了幾次', '') +
    gcStat(bonus, '累計送出紅利', '含集章保底') +
    gcStat(tkt, '累計送出票券', '') +
    '</div>';
  var pls = gcData.players || {}, qN = 0, qOk = 0, memN = 0, colN = 0;
  Object.keys(pls).forEach(function(ph){
    var d = ((pls[ph] || {}).days || {})[today] || {};
    if (d.quiz) { qN++; if (d.quiz.ok) qOk++ }
    if (d.memory) memN++;
    if ((pls[ph] || {}).collected) colN++;
  });
  h += '<div style="display:flex;flex-wrap:wrap;gap:10px;margin-top:10px">' +
    gcStat(qN, '今天答題的人', '答對 ' + qOk + ' 人') +
    gcStat(memN, '今天翻牌過關', '') +
    gcStat(colN, '黑熊圖鑑集滿', '集滿禮已送 ' + (+(gcData.stock || {}).collect || 0) + '／' + (gcData.cfg.collectLimit == null ? 5 : gcData.cfg.collectLimit)) + '</div>';
  if (all.some(function(x){ return x.test })) h += '<div class="muted" style="font-size:12px;margin-top:10px">上面數字不含活動開始前測試名單玩的紀錄。</div>';
  h += '</div>';

  /* 每天幾個人玩 */
  var byDay = {};
  spins.forEach(function(x){ (byDay[x.date] = byDay[x.date] || {})[x.phone] = 1 });
  var days = Object.keys(byDay).sort().reverse().slice(0, 31);
  if (days.length) {
    var max = Math.max.apply(null, days.map(function(d){ return Object.keys(byDay[d]).length }));
    h += '<div class="card"><div class="card-title">每天幾個人玩</div>' + days.map(function(d){
      var n = Object.keys(byDay[d]).length;
      return '<div style="display:flex;align-items:center;gap:10px;font-size:13px;margin:4px 0">' +
        '<span style="width:52px;color:var(--text2)">' + d.slice(5).replace('-', '/') + '</span>' +
        '<span style="flex:1;background:var(--bg3,#f3f0e8);border-radius:4px;height:14px;overflow:hidden">' +
        '<i style="display:block;height:100%;width:' + (n / max * 100) + '%;background:var(--gold)"></i></span>' +
        '<span style="width:40px;text-align:right;font-variant-numeric:tabular-nums">' + n + '</span></div>';
    }).join('') + '</div>';
  }

  /* 獎品送出狀況 */
  var sent = {};
  real.forEach(function(x){ sent[x.pid] = (sent[x.pid] || 0) + 1 });
  h += '<div class="card"><div class="card-title">獎品送出狀況</div><table class="tbl" style="width:100%;font-size:13px;border-collapse:collapse">' +
    '<tr style="text-align:left;color:var(--text2)"><th style="padding:6px 4px">獎品</th><th>誰能抽</th><th style="text-align:right">送出</th><th style="text-align:right">限量</th><th style="text-align:right">剩餘</th></tr>' +
    cfg.prizes.map(function(p){
      var used = +(gcData.stock || {})[p.id] || 0;
      return '<tr style="border-top:1px solid var(--border)"><td style="padding:6px 4px">' + gcEsc(p.ic + ' ' + p.nm) + '</td><td>' + GC_WHO[p.who] + '</td>' +
        '<td style="text-align:right">' + (sent[p.id] || 0) + '</td><td style="text-align:right">' + (p.qty != null ? p.qty : '不限') + '</td>' +
        '<td style="text-align:right;' + (p.qty != null && p.qty - used <= 0 ? 'color:var(--red)' : '') + '">' + (p.qty != null ? Math.max(0, p.qty - used) : '—') + '</td></tr>';
    }).join('') + '</table></div>';

  /* 月底大抽獎 */
  var lot = [];
  var pl = gcData.players || {};
  Object.keys(pl).forEach(function(ph){ var n = +pl[ph].lottery || 0; if (n > 0) lot.push({ phone:ph, name:pl[ph].name || '', n:n }) });
  lot.sort(function(a, b){ return b.n - a.n });
  var totalLot = lot.reduce(function(s, x){ return s + x.n }, 0);
  h += '<div class="card"><div class="card-title">' + gcEsc(cfg.lotteryName || '月底大抽獎券') + '</div>' +
    '<div style="font-size:13px;color:var(--text2);margin-bottom:10px;line-height:1.7">紅利領滿 ' + cfg.cap + ' 點之後，原本會中紅利的那幾次改送抽獎券。' +
    '目前 ' + lot.length + ' 個人、共 ' + totalLot + ' 張。抽獎券越多張，被抽中的機會越大。</div>';
  if (lot.length) {
    h += '<div style="font-size:13px;line-height:1.9;margin-bottom:10px">' + lot.slice(0, 50).map(function(x){
      return gcEsc(x.name || '（未填姓名）') + ' <span class="muted">' + x.phone + '</span>　<b>' + x.n + '</b> 張' }).join('<br>') + '</div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span style="font-size:13px">抽出</span>' +
      '<input id="gc-lot-n" type="number" min="1" value="3" style="width:64px;padding:6px 8px;border:1px solid var(--border);border-radius:6px">' +
      '<span style="font-size:13px">位</span><button class="btn btn-gold btn-sm" onclick="gcDrawLottery()">🎲 抽獎</button></div>';
    if (gcLotteryPick) h += '<div style="margin-top:12px;padding:12px;background:#fff8e6;border-radius:8px;font-size:14px;line-height:1.9">🎉 ' +
      gcLotteryPick.map(function(x, i){ return (i + 1) + '. ' + gcEsc(x.name || '（未填姓名）') + '　' + x.phone }).join('<br>') +
      '<div class="muted" style="font-size:12px;margin-top:6px">這個結果沒有存起來，請截圖或記下來。重按會重新抽。</div></div>';
  }
  h += '</div>';
  return h;
}
function gcDrawLottery(){
  var n = Math.max(1, +document.getElementById('gc-lot-n').value || 1);
  var pl = gcData.players || {}, pool = [];
  Object.keys(pl).forEach(function(ph){ for (var i = 0; i < (+pl[ph].lottery || 0); i++) pool.push(ph) });
  var picked = [];
  while (picked.length < n && pool.length) {
    var ph = pool[Math.floor(Math.random() * pool.length)];
    picked.push({ phone:ph, name:pl[ph].name || '' });
    pool = pool.filter(function(x){ return x !== ph });
  }
  gcLotteryPick = picked;
  renderGacha();
}

/* ── 中獎紀錄・核銷 ── */
function gcLogHtml(){
  return '<div class="card"><div class="card-title">中獎紀錄</div>' +
    '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px">' +
    '<input id="gc-search" placeholder="搜尋姓名或電話" value="' + gcEsc(gcQuery) + '" style="flex:1 1 200px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px">' +
    '<label style="font-size:13px;display:flex;align-items:center;gap:6px"><input type="checkbox" ' + (gcOnlyTkt ? 'checked' : '') +
    ' onchange="gcOnlyTkt=this.checked;gcDrawLog()"> 只看票券</label></div>' +
    '<div class="muted" style="font-size:12px;margin-bottom:8px;line-height:1.7">客人拿抽到的券來用時，找到那一筆按「已使用」。按錯可以按「復原」。</div>' +
    '<div id="gc-log"></div></div>';
}
function gcDrawLog(){
  var box = document.getElementById('gc-log'); if (!box) return;
  var q = gcQuery.trim(), qd = q.replace(/\D/g, '');
  var list = gcLogList().filter(function(x){
    if (gcOnlyTkt && x.type !== 'ticket') return false;
    if (!q) return true;
    return (x.name && x.name.indexOf(q) >= 0) || (qd.length >= 3 && String(x.phone).indexOf(qd) >= 0);
  }).slice(0, 300);
  if (!list.length) { box.innerHTML = '<div class="empty">沒有符合的紀錄</div>'; return }
  box.innerHTML = list.map(function(x){
    var t = String(x.at).slice(5, 16).replace('T', ' ').replace('-', '/');
    var h = '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px;flex-wrap:wrap">' +
      '<span style="width:84px;color:var(--text3);font-size:12px">' + t + '</span>' +
      '<span style="flex:1 1 140px"><b>' + gcEsc(x.name || '（未填姓名）') + '</b> <span class="muted" style="font-size:12px">' + gcEsc(x.phone) + '</span></span>' +
      '<span style="flex:1 1 160px">' + gcEsc((x.ic || '') + ' ' + x.nm) +
      ' <span style="font-size:11px;background:#f0ece2;border-radius:10px;padding:1px 7px;color:var(--text2)">' + (GC_WHY[x.why] || x.why || '') + '</span>' +
      (x.test ? ' <span style="font-size:11px;background:#e7ecf7;border-radius:10px;padding:1px 7px">測試</span>' : '') + '</span>';
    if (x.type === 'ticket') {
      var gid = x.why === 'milestone' ? null : x._k;
      var tk = gcFindTkt(x.phone, x.why === 'milestone' ? null : x._k, x);
      if (!tk) h += '<span class="muted" style="font-size:12px;width:150px;text-align:right">讀取中…</span>';
      else if (+tk.qty > 0) h += '<span style="width:150px;text-align:right"><span style="font-size:12px;color:#2e7d4f;margin-right:6px">未使用</span>' +
        '<button class="btn btn-gold btn-sm" onclick="gcRedeem(\'' + x.phone + '\',\'' + tk.gid + '\',false)">已使用</button></span>';
      else h += '<span style="width:150px;text-align:right;font-size:12px;color:var(--text3)">' + gcEsc((tk.usedBy || '') + ' ' + String(tk.usedAt || '').slice(5, 10).replace('-', '/')) +
        ' 已使用 <a style="cursor:pointer;text-decoration:underline" onclick="gcRedeem(\'' + x.phone + '\',\'' + tk.gid + '\',true)">復原</a></span>';
    }
    return h + '</div>';
  }).join('');
}
/* 一般抽到的票券用抽獎紀錄編號對；集章保底的票券編號是「那一次抽獎編號-ms」 */
function gcFindTkt(phone, gid, x){
  var list = gcTkts[phone]; if (!list) return null;
  if (gid) return list.filter(function(t){ return t.gid === gid })[0] || { gid:gid, qty:0, usedBy:'（找不到這張券）' };
  var same = gcLogList().filter(function(y){ return y.phone === x.phone && y.date === x.date && y.why !== 'milestone' });
  var base = same.length ? same[same.length - 1]._k : '';
  return list.filter(function(t){ return t.gid === base + '-ms' })[0] || list.filter(function(t){ return /-ms$/.test(t.gid || '') && t.name === x.nm.replace(/^集章 \d+ 天・/, '') })[0] || null;
}
async function gcFetchTickets(){
  var phones = {};
  gcLogList().forEach(function(x){ if (x.type === 'ticket' && !gcTkts[x.phone]) phones[x.phone] = 1 });
  var list = Object.keys(phones);
  if (!list.length) return;
  try {
    var j = await staffApi('/staff/gacha/tickets', { phones:list });
    Object.assign(gcTkts, j.tickets || {});
    list.forEach(function(p){ if (!gcTkts[p]) gcTkts[p] = [] });
  } catch(e) { console.error(e) }
  gcDrawLog();
}
async function gcRedeem(phone, gid, undo){
  if (!undo && !confirm('確定這張券已經使用了嗎？')) return;
  try {
    await staffApi('/staff/gacha/redeem', { phone:phone, gid:gid, undo:!!undo });
    delete gcTkts[phone];
    await gcFetchTickets();
  } catch(e) { alert('核銷失敗：' + e.message) }
}

/* ── 獎品設定 ── */
function gcPct(p, who){
  if (!(p.who === 'all' || p.who === who)) return null;
  var st = gcData.stock || {};
  var out = function(x){ return x.qty != null && x.qty !== '' && (+st[x.id] || 0) >= +x.qty };
  if (out(p)) return 0;
  var tot = gcDraft.prizes.filter(function(x){ return (x.who === 'all' || x.who === who) && !out(x) })
    .reduce(function(s, x){ return s + (+x.w || 0) }, 0);
  return tot ? (+p.w || 0) / tot * 100 : 0;
}
function gcPrizesHtml(){
  var inp = function(i, k, v, w, type){
    return '<input ' + (type ? 'type="' + type + '" ' : '') + 'value="' + gcEsc(v == null ? '' : v) + '" style="width:' + w + 'px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px" ' +
      'onchange="gcSetP(' + i + ',\'' + k + '\',this.value)">';
  };
  var sel = function(i, k, v, opts){
    return '<select style="padding:5px;border:1px solid var(--border);border-radius:6px;font-size:13px" onchange="gcSetP(' + i + ',\'' + k + '\',this.value)">' +
      Object.keys(opts).map(function(o){ return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + opts[o] + '</option>' }).join('') + '</select>';
  };
  var h = '<div class="card"><div class="card-title">獎品設定</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:12px">' +
    '「權重」越大越容易抽到，右邊的百分比是實際機率，會員跟新客分開算。「限量」空白代表不限；「每人上限」空白代表同一個人可以一直中。<br>' +
    '改完要按最下面的「儲存」才會生效。已經送出去的紅利、票券不會因為改設定而收回。</div>' +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;min-width:980px">' +
    '<tr style="text-align:left;color:var(--text2)"><th style="padding:6px 4px">圖示</th><th>名稱</th><th>說明</th><th>誰能抽</th><th>類型</th><th>送幾點</th><th>票券性質</th><th>權重</th><th>限量</th><th>每人上限</th><th>已送</th><th>會員機率</th><th>新客機率</th><th></th></tr>';
  gcDraft.prizes.forEach(function(p, i){
    var pm = gcPct(p, 'mem'), pn = gcPct(p, 'new');
    h += '<tr style="border-top:1px solid var(--border)">' +
      '<td style="padding:6px 4px">' + inp(i, 'ic', p.ic, 40) + '</td>' +
      '<td>' + inp(i, 'nm', p.nm, 130) + '</td><td>' + inp(i, 'sub', p.sub, 130) + '</td>' +
      '<td>' + sel(i, 'who', p.who, GC_WHO) + '</td><td>' + sel(i, 'type', p.type, GC_TYPE) + '</td>' +
      '<td>' + (p.type === 'bonus' ? inp(i, 'v', p.v, 48, 'number') : '<span class="muted">—</span>') + '</td>' +
      '<td>' + (p.type === 'ticket' ? sel(i, 'kind', p.kind || 'goods', GC_KIND) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + inp(i, 'w', p.w, 56, 'number') + '</td><td>' + inp(i, 'qty', p.qty, 56, 'number') + '</td><td>' + inp(i, 'per', p.per, 48, 'number') + '</td>' +
      '<td style="text-align:right;padding-right:6px">' + (+(gcData.stock || {})[p.id] || 0) + '</td>' +
      '<td style="text-align:right;font-variant-numeric:tabular-nums">' + (pm == null ? '<span class="muted">—</span>' : pm.toFixed(1) + '%') + '</td>' +
      '<td style="text-align:right;font-variant-numeric:tabular-nums">' + (pn == null ? '<span class="muted">—</span>' : pn.toFixed(1) + '%') + '</td>' +
      '<td><button class="btn btn-del btn-sm" onclick="gcDelP(' + i + ')">刪除</button></td></tr>';
  });
  h += '</table></div>' +
    '<div style="display:flex;gap:10px;margin-top:14px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" onclick="gcAddP()">＋ 新增獎品</button>' +
    '<span style="flex:1"></span><button class="btn btn-outline btn-sm" onclick="gcResetDraft()">放棄修改</button>' +
    '<button class="btn btn-gold" onclick="gcSave()">💾 儲存</button></div></div>';
  return h;
}
function gcSetP(i, k, v){
  var p = gcDraft.prizes[i]; if (!p) return;
  if (k === 'w' || k === 'v') v = v === '' ? 0 : +v;
  if (k === 'qty' || k === 'per') v = v === '' ? null : +v;
  if (v === null) delete p[k]; else p[k] = v;
  if (k === 'type' && v === 'ticket' && !p.kind) p.kind = 'goods';
  if (k === 'type' && v === 'bonus' && !p.v) p.v = 1;
  renderGacha();
}
function gcDelP(i){
  var p = gcDraft.prizes[i];
  if (!confirm('要刪除「' + p.nm + '」嗎？（按儲存才會生效）')) return;
  gcDraft.prizes.splice(i, 1); renderGacha();
}
function gcAddP(){
  gcDraft.prizes.push({ id:'p' + Date.now().toString(36), ic:'🎁', nm:'新獎品', sub:'', who:'all', type:'ticket', kind:'goods', w:5, qty:10, per:1 });
  renderGacha();
}
function gcResetDraft(){ gcDraft = JSON.parse(JSON.stringify(gcData.cfg)); renderGacha() }
async function gcSave(){
  if (!confirm('儲存之後，客人下一次轉扭蛋就會用新的設定。確定嗎？')) return;
  try {
    var j = await staffApi('/staff/gacha/config', { cfg:gcDraft });
    gcData.cfg = j.cfg; gcData.isDefault = false; gcDraft = JSON.parse(JSON.stringify(j.cfg));
    alert('已儲存');
    renderGacha();
  } catch(e) { alert('儲存失敗：' + e.message) }
}

/* ── 活動設定 ── */
function gcSettingsHtml(){
  var c = gcDraft;
  var row = function(label, html, note){
    return '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:start;margin:10px 0;font-size:13.5px">' +
      '<label style="color:var(--text2);padding-top:6px">' + label + '</label><div>' + html +
      (note ? '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.6">' + note + '</div>' : '') + '</div></div>';
  };
  var inp = function(k, v, type, w){
    return '<input ' + (type ? 'type="' + type + '" ' : '') + 'value="' + gcEsc(v == null ? '' : v) + '" style="width:' + (w || 180) + 'px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'' + k + '\',this.value)">';
  };
  var h = '<div class="card"><div class="card-title">活動設定</div>' +
    row('活動名稱', inp('title', c.title, '', 220)) +
    row('開始日期', inp('start', c.start, 'date'), '這天之前，只有下面「測試電話」可以玩') +
    row('結束日期', inp('end', c.end, 'date')) +
    row('紅利上限', inp('cap', c.cap, 'number', 90) + ' 點', '每個人整個活動期間，每日扭蛋最多拿幾點。集章保底另外算。拿滿之後改送抽獎券') +
    row('每天最多轉', inp('maxDaily', c.maxDaily == null ? 5 : c.maxDaily, 'number', 90) + ' 次', '不管拿到幾種加碼（上課、預約、問答、翻牌、加碼日），一天最多轉幾次') +
    row('每天最多中紅利', inp('bonusDaily', c.bonusDaily == null ? 2 : c.bonusDaily, 'number', 90) + ' 次', '中滿之後，當天剩下的扭蛋不會再出紅利，改送造型小黑熊') +
    row('票券期限', inp('expiry', c.expiry, 'date'), '抽到的票券到哪天前要用掉') +
    row('抽獎券名稱', inp('lotteryName', c.lotteryName, '', 220)) +
    row('加碼日', '<input value="' + gcEsc((c.doubleDays || []).join(', ')) + '" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'doubleDays\',this.value)">',
        '這幾天每個人多一次機會，而且每一次都一定中。多個日期用逗號隔開，格式 2026-10-31') +
    row('測試電話', '<textarea rows="3" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'testPhones\',this.value)">' +
        gcEsc((c.testPhones || []).join('\n')) + '</textarea>',
        '一行一支。活動開始前，這些電話綁定的 LINE 可以先測試。<b>員工名單裡的人不用加</b>，用自己的 LINE 打開預約頁就自動是測試模式') +
    '</div>';

  if (gcData.today < c.start) h += '<div class="card"><div class="card-title">活動開始前的測試</div>' +
    '<div style="font-size:13px;color:var(--text2);line-height:1.8;margin-bottom:12px">' +
    '活動開始前，員工和上面的測試電話可以<b>無限次</b>玩，每轉一次算集滿一天（方便測到集章保底）。<br>' +
    '測試期間抽到的紅利、票券<b>都不會入帳</b>，也不會扣限量獎品的數量。<br>' +
    '正式開始前按下面這顆，把所有測試紀錄清掉（綁好的電話會留著）。</div>' +
    '<button class="btn btn-del" onclick="gcResetTest()">🧹 清空所有測試紀錄</button></div>';

  h += '<div class="card"><div class="card-title">集章保底</div>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px">累積玩滿幾天（不用連續）就自動送，不算在紅利上限裡。</div>';
  (c.milestones || []).forEach(function(m, i){
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px">' +
      '累積 <input type="number" value="' + (m.d || '') + '" style="width:56px;padding:5px;border:1px solid var(--border);border-radius:6px" onchange="gcSetM(' + i + ',\'d\',this.value)"> 天　送' +
      '<select style="padding:5px;border:1px solid var(--border);border-radius:6px" onchange="gcSetM(' + i + ',\'type\',this.value)">' +
      '<option value="bonus"' + (m.type === 'bonus' ? ' selected' : '') + '>紅利</option><option value="ticket"' + (m.type === 'ticket' ? ' selected' : '') + '>票券／贈品</option></select>' +
      (m.type === 'bonus' ? '<input type="number" value="' + (m.v || '') + '" style="width:56px;padding:5px;border:1px solid var(--border);border-radius:6px" onchange="gcSetM(' + i + ',\'v\',this.value)"> 點' : '') +
      '　名稱 <input value="' + gcEsc(m.nm) + '" style="width:180px;padding:5px;border:1px solid var(--border);border-radius:6px" onchange="gcSetM(' + i + ',\'nm\',this.value)">' +
      '<button class="btn btn-del btn-sm" onclick="gcDraft.milestones.splice(' + i + ',1);renderGacha()">刪除</button></div>';
  });
  h += '<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="gcDraft.milestones=gcDraft.milestones||[];gcDraft.milestones.push({d:28,type:\'ticket\',kind:\'goods\',nm:\'新保底獎\'});renderGacha()">＋ 新增一格</button></div>';
  h += '<div style="display:flex;gap:10px;justify-content:flex-end;margin-bottom:20px"><button class="btn btn-outline btn-sm" onclick="gcResetDraft()">放棄修改</button>' +
    '<button class="btn btn-gold" onclick="gcSave()">💾 儲存</button></div>';
  return h;
}
function gcSetC(k, v){
  if (k === 'cap' || k === 'maxDaily' || k === 'bonusDaily') v = +v || 0;
  if (k === 'doubleDays') v = String(v).split(/[,，\s]+/).map(function(x){ return x.trim().replace(/\//g, '-') }).filter(Boolean);
  if (k === 'testPhones') v = String(v).split(/[\n,，\s]+/).map(function(x){ return x.replace(/\D/g, '') }).filter(Boolean);
  gcDraft[k] = v;
}
function gcSetM(i, k, v){
  var m = gcDraft.milestones[i]; if (!m) return;
  if (k === 'd' || k === 'v') v = +v || 0;
  m[k] = v;
  if (k === 'type') { if (v === 'bonus' && !m.v) m.v = 3; if (v === 'ticket' && !m.kind) m.kind = 'goods'; renderGacha() }
}

async function gcResetTest(){
  if (!confirm('要清空所有測試紀錄嗎？\n\n會清掉：測試遊玩紀錄、中獎紀錄、限量獎品的已送出數量、活動開始前玩過的次數。\n不會動：綁好的電話、已經寫進會員明細的紅利。')) return;
  try {
    var j = await staffApi('/staff/gacha/reset-test', {});
    alert('已清空：' + j.players + ' 位玩家的次數、' + j.logs + ' 筆測試紀錄');
    await gcReload();
  } catch(e) { alert('清空失敗：' + e.message) }
}

/* ── 小遊戲：開關、題庫 ── */
function gcGamesHtml(){
  var g = gcDraft.games || (gcDraft.games = { quiz:true, memory:true, collect:true });
  var sw = function(k, label, note){
    return '<label style="display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-top:1px solid var(--border);font-size:13.5px;cursor:pointer">' +
      '<input type="checkbox" ' + (g[k] ? 'checked' : '') + ' onchange="gcDraft.games.' + k + '=this.checked" style="margin-top:3px">' +
      '<span><b>' + label + '</b><br><span class="muted" style="font-size:12.5px;line-height:1.7">' + note + '</span></span></label>';
  };
  var cr = gcDraft.collectReward || (gcDraft.collectReward = { type:'ticket', kind:'goods', nm:'23cm 流動熊（圖鑑集滿禮）' });
  var h = '<div class="card"><div class="card-title">小遊戲開關</div>' +
    sw('quiz', '🎨 每日藝術小問答', '每天一題（大家同一題），答對當天多一次扭蛋。題目在下面題庫改') +
    sw('memory', '🃏 翻牌配對', '60 秒內配完 6 對小黑熊，當天多一次扭蛋（一天只算一次）') +
    sw('collect', '📖 黑熊圖鑑', '每轉一次扭蛋另外送一隻造型小黑熊，一共 ' + (gcDraft.bears || []).length + ' 款，集滿送下面的圖鑑禮') +
    '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:center;margin-top:12px;font-size:13.5px">' +
    '<label style="color:var(--text2)">圖鑑集滿禮</label><input value="' + gcEsc(cr.nm) + '" style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcDraft.collectReward.nm=this.value">' +
    '<label style="color:var(--text2)">集滿禮限量</label><div><input type="number" min="0" value="' + (gcDraft.collectLimit == null ? 5 : gcDraft.collectLimit) + '" style="width:80px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcDraft.collectLimit=+this.value||0"> 名　' +
    '<span class="muted" style="font-size:12px">已送出 ' + (+(gcData.stock || {}).collect || 0) + ' 名（0＝不限）</span></div>' +
    '<label style="color:var(--text2)">萬聖節造型日期</label><input value="' + gcEsc((gcDraft.halloweenDays || []).join(', ')) + '" style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" ' +
    'onchange="gcDraft.halloweenDays=this.value.split(/[,，\\s]+/).map(function(x){return x.trim().replace(/\\//g,\'-\')}).filter(Boolean)"></div>' +
    '<div class="muted" style="font-size:12px;margin-top:6px;line-height:1.7">萬聖節那天扭蛋機換成橘紫色、小黑熊戴南瓜帽，南瓜熊比較容易抽到。多個日期用逗號隔開，格式 2026-10-31</div>' +
    '<div style="text-align:right;margin-top:12px"><button class="btn btn-gold" onclick="gcSave()">💾 儲存開關</button></div></div>';

  h += '<div class="card"><div class="card-title">藝術小問答題庫（' + gcQuiz.length + ' 題）</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">每天照順序輪一題。點選項前面的圓圈設定正確答案。' +
    (gcData.quizDefault ? '<br>目前是內建的預設題庫，存過一次之後就以這裡為準。' : '') + '</div>';
  gcQuiz.forEach(function(q, i){
    h += '<div style="border-top:1px solid var(--border);padding:10px 0">' +
      '<div style="display:flex;gap:8px;align-items:center"><b style="width:28px;color:var(--text3)">' + (i + 1) + '</b>' +
      '<input value="' + gcEsc(q.q) + '" placeholder="題目" style="flex:1;padding:6px 8px;border:1px solid var(--border);border-radius:6px;font-size:13.5px" onchange="gcQuiz[' + i + '].q=this.value">' +
      '<button class="btn btn-del btn-sm" onclick="gcQuiz.splice(' + i + ',1);renderGacha()">刪除</button></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 0 0 36px">' +
      [0,1,2,3].map(function(k){
        return '<label style="display:flex;gap:6px;align-items:center;font-size:13px"><input type="radio" name="gcqa' + i + '" ' + (+q.a === k ? 'checked' : '') +
          ' onchange="gcQuiz[' + i + '].a=' + k + '"><input value="' + gcEsc((q.o || [])[k] || '') + '" placeholder="選項 ' + "ABCD"[k] + '" style="flex:1;padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-size:13px' +
          (+q.a === k ? ';background:#e3f4ea' : '') + '" onchange="gcQuiz[' + i + '].o[' + k + ']=this.value"></label>';
      }).join('') + '</div>' +
      '<input value="' + gcEsc(q.t || '') + '" placeholder="答完顯示的小知識（選填）" style="margin:6px 0 0 36px;width:calc(100% - 36px);padding:5px 7px;border:1px solid var(--border);border-radius:6px;font-size:12.5px" onchange="gcQuiz[' + i + '].t=this.value"></div>';
  });
  h += '<div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-outline btn-sm" onclick="gcQuiz.push({q:\'\',o:[\'\',\'\',\'\',\'\'],a:0,t:\'\'});renderGacha()">＋ 新增一題</button>' +
    '<span style="flex:1"></span><button class="btn btn-outline btn-sm" onclick="gcQuiz=JSON.parse(JSON.stringify(gcData.quiz||[]));renderGacha()">放棄修改</button>' +
    '<button class="btn btn-gold" onclick="gcSaveQuiz()">💾 儲存題庫</button></div></div>';
  return h;
}
async function gcSaveQuiz(){
  if (!confirm('儲存題庫？每天會照這份的順序輪流出題。')) return;
  try {
    var j = await staffApi('/staff/gacha/quiz', { quiz:gcQuiz });
    gcData.quiz = j.quiz; gcData.quizDefault = false; gcQuiz = JSON.parse(JSON.stringify(j.quiz));
    alert('題庫已儲存（' + j.quiz.length + ' 題）');
    renderGacha();
  } catch(e) { alert('儲存失敗：' + e.message) }
}
