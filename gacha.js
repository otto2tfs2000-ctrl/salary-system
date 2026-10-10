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
var gcgData = null, gcgDraft = null, gcgCoinQ = '';

function gcEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
var GC_WHO = { all:'所有人', mem:'只有會員', new:'只有新客' };
var GC_TYPE = { bonus:'紅利', ticket:'票券／贈品', none:'銘謝惠顧' };
var GC_WHY = { gold:'黃金扭蛋', daily:'每日', 'class':'上課加碼', book:'預約加碼', double:'加碼日', milestone:'集章保底', quiz:'問答加碼', memory:'翻牌加碼', collect:'圖鑑集滿', test:'測試' };
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
  var tabs = [['overview','總覽'],['log','中獎紀錄・核銷'],['prizes','獎品設定'],['games','小遊戲'],['settings','活動設定'],['gold','🪙 黃金扭蛋']];
  var h = '<div class="store-tabs" style="margin-bottom:14px">' + tabs.map(function(t){
    return '<button class="store-btn' + (gcTab === t[0] ? ' active' : '') + '" onclick="gcSwitch(\'' + t[0] + '\')">' + t[1] + '</button>' }).join('') +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="gcReload()">↻ 重新讀取</button></div>';
  if (gcData.isDefault && gcTab !== 'gold') h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;margin-bottom:14px">' +
    '目前用的是程式內建的預設設定，還沒在這裡存過。改完獎品或活動設定按「儲存」之後，就會以這裡的為準。</div>';
  if (gcTab === 'gold' && !gcgData) {
    el.innerHTML = h + '<div class="empty">載入黃金扭蛋設定中…</div>';
    try { await gcgLoad() } catch(e) { el.innerHTML = h + '<div class="empty">讀不到黃金扭蛋設定：' + gcEsc(e.message) + '</div>'; return }
  }
  h += gcTab === 'gold' ? gcgHtml() : gcTab === 'log' ? gcLogHtml() : gcTab === 'prizes' ? gcPrizesHtml() : gcTab === 'games' ? gcGamesHtml() : gcTab === 'settings' ? gcSettingsHtml() : gcOverviewHtml();
  el.innerHTML = h;
  if (gcTab === 'log') {
    var sb = document.getElementById('gc-search');
    if (sb) sb.oninput = function(){ gcQuery = this.value; gcDrawLog() };
    gcDrawLog();
    gcFetchTickets();
  }
}
function gcSwitch(t){ gcTab = t; renderGacha() }
async function gcReload(){ gcData = null; gcgData = null; gcTkts = {}; await renderGacha() }

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
  var spins = real.filter(function(x){ return x.why !== 'milestone' && x.why !== 'gold' });
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
    /* 先拿雲端最新的設定，只把「這個畫面上真的有改」的欄位蓋上去。
       避免頁面開很久沒重整，存檔時把別人（或程式）後來改的設定整包蓋回舊的。 */
    var base = (gcData && gcData.cfg) || {};
    var latest = (await staffApi('/staff/gacha', {})).cfg || {};
    var out = JSON.parse(JSON.stringify(latest));
    Object.keys(gcDraft).forEach(function(k){
      if (JSON.stringify(gcDraft[k]) !== JSON.stringify(base[k])) out[k] = gcDraft[k];
    });
    var j = await staffApi('/staff/gacha/config', { cfg:out });
    if (!gcData) gcData = { cfg:j.cfg, players:{}, log:{}, stock:{} };
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
    row('紅利上限', inp('cap', c.cap, 'number', 90) + ' 點', '會員整個活動期間，扭蛋最多拿幾點。集章保底另外算。拿滿之後改送抽獎券') +
    row('每天最多轉', inp('maxDaily', c.maxDaily == null ? 5 : c.maxDaily, 'number', 90) + ' 次', '不管拿到幾種加碼（上課、預約、問答、翻牌、加碼日），一天最多轉幾次') +
    row('每天最多中紅利', inp('bonusDaily', c.bonusDaily == null ? 2 : c.bonusDaily, 'number', 90) + ' 次（會員）　' +
        inp('bonusDailyNew', c.bonusDailyNew == null ? 1 : c.bonusDailyNew, 'number', 70) + ' 次（新朋友）', '中滿之後，當天剩下的扭蛋不會再出紅利，改送造型小黑熊') +
    row('新朋友紅利上限', inp('capNew', c.capNew == null ? 15 : c.capNew, 'number', 90) + ' 點', '沒有方案的新朋友，整個活動期間扭蛋最多拿幾點（上面的「紅利上限」是會員的）') +
    row('票券期限', inp('expiry', c.expiry, 'date'), '抽到的票券到哪天前要用掉') +
    row('抽獎券名稱', inp('lotteryName', c.lotteryName, '', 220)) +
    row('加碼日', '<input value="' + gcEsc((c.doubleDays || []).join(', ')) + '" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'doubleDays\',this.value)">',
        '這幾天每個人多一次機會，而且每一次都一定中。多個日期用逗號隔開，格式 2026-10-31') +
    row('測試電話', '<textarea rows="3" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'testPhones\',this.value)">' +
        gcEsc((c.testPhones || []).join('\n')) + '</textarea>',
        '一行一支。活動開始前，這些電話綁定的 LINE 可以先測試。<b>員工名單裡的人不用加</b>，用自己的 LINE 打開預約頁就自動是測試模式') +
    row('示範人員', '<label style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><input type="checkbox"' + (c.demoStaff !== false ? ' checked' : '') + ' onchange="gcSetC(\'demoStaff\',this.checked)"> 員工名單裡的人自動無限次</label>' +
        '<textarea rows="3" placeholder="其他要無限次的電話，一行一支" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcSetC(\'demoPhones\',this.value)">' +
        gcEsc((c.demoPhones || []).join('\n')) + '</textarea>',
        '<b>活動期間</b>給老師示範用：可以一直轉，抽到的紅利、票券<b>都不會入帳</b>，也不會扣限量獎品，紀錄跟「測試紀錄」放一起。不是員工但要示範的人，把他綁定的電話加在這裡') +
    '</div>';

  h += '<div class="card"><div class="card-title">測試紀錄</div>' +
    '<div style="font-size:13px;color:var(--text2);line-height:1.8;margin-bottom:12px">' +
    '活動開始前，員工和上面的測試電話可以<b>無限次</b>玩，每轉一次算集滿一天（方便測到集章保底）。<br>' +
    '測試期間抽到的紅利、票券<b>都不會入帳</b>，也不會扣限量獎品的數量。<br>' +
    '正式開始前按下面這顆，把所有測試紀錄清掉（綁好的電話會留著）。活動開始後也可以按，只會清測試的紀錄，不會動到正式玩家。</div>' +
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
  if (k === 'cap' || k === 'maxDaily' || k === 'bonusDaily' || k === 'bonusDailyNew' || k === 'capNew') v = +v || 0;
  if (k === 'doubleDays') v = String(v).split(/[,，\s]+/).map(function(x){ return x.trim().replace(/\//g, '-') }).filter(Boolean);
  if (k === 'testPhones' || k === 'demoPhones') v = String(v).split(/[\n,，\s]+/).map(function(x){ return x.replace(/\D/g, '') }).filter(Boolean);
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

  var lvN = [0,0,0,0,0]; gcQuiz.forEach(function(q){ lvN[+q.lv || 1]++ });
  var pct = function(n){ return gcQuiz.length ? Math.round(n / gcQuiz.length * 100) + '%' : '0%' };
  h += '<div class="card"><div class="card-title">藝術小問答題庫（' + gcQuiz.length + ' 題）</div>' +
    '<div style="font-size:13px;margin-bottom:8px">簡單 <b>' + lvN[1] + '</b>（' + pct(lvN[1]) + '）・中等 <b>' + lvN[2] + '</b>（' + pct(lvN[2]) + '）・有難度 <b>' + lvN[3] + '</b>（' + pct(lvN[3]) + '）・超難 <b>' + lvN[4] + '</b>（' + pct(lvN[4]) + '）</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">每個人每天隨機抽一題，抽過的不會再出現；選項順序會自動打亂。點選項前面的圓圈設定正確答案。' +
    (gcData.quizDefault ? '<br>目前是內建的預設題庫，存過一次之後就以這裡為準。' : '') + '</div>';
  gcQuiz.forEach(function(q, i){
    h += '<div style="border-top:1px solid var(--border);padding:10px 0">' +
      '<div style="display:flex;gap:8px;align-items:center"><b style="width:28px;color:var(--text3)">' + (i + 1) + '</b>' +
      '<select style="padding:5px;border:1px solid var(--border);border-radius:6px;font-size:12.5px" onchange="gcQuiz[' + i + '].lv=+this.value;renderGacha()">' +
      [[1,'簡單'],[2,'中等'],[3,'有難度'],[4,'超難']].map(function(o){ return '<option value="' + o[0] + '"' + ((+q.lv || 1) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') + '</select>' +
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
  h += '<div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-outline btn-sm" onclick="gcQuiz.push({lv:1,q:\'\',o:[\'\',\'\',\'\',\'\'],a:0,t:\'\'});renderGacha()">＋ 新增一題</button>' +
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


/* ══════════════════════════════════════════════════════════
   🪙 黃金扭蛋（2026-10-09）
   買方案送金幣，一枚金幣抽一次黃金扭蛋。這一頁管：
   - 方案等級：登記的方案金額一模一樣才算進那一級（例如 11000、15000 是一級，18000、22000 是二級）
   - 獎品清單：全部等級共用一份（A、B、C…），每個獎品「每一級各自填中獎機率」，每級加起來要 100%
   - 試抽：用目前填的機率模擬抽很多次，看實際分布；也能輸入方案金額看會落在哪一級
   - 手動補發金幣、金幣紀錄、收回還沒抽的金幣
   資料在 gacha/gold、gacha/goldcoins，一樣透過 /staff/gacha/gold* 讀寫。
   賣方案時（會員頁「賣方案」）會依方案金額自動發金幣；客人在遊樂島按金幣抽，中獎寫進「中獎紀錄・核銷」
   （原因欄寫「黃金扭蛋」，票券到時候按「已使用」）。
   ══════════════════════════════════════════════════════════ */
var gcgSim = null, gcgSimSel = { t:'', n:10000 };
var gcgWin = { prize:'', st:'', q:'' };
async function gcgLoad(){
  gcgData = await staffApi('/staff/gacha/gold', {});
  gcgDraft = JSON.parse(JSON.stringify(gcgData.gold));
  gcgFill();
}
/* 第一次打開（還沒存過）先擺好兩級、十格空的獎品，照大熊講的金額分級；名稱和機率要他自己填 */
function gcgFill(){
  var g = gcgDraft;
  if (!g.tiers) g.tiers = [];
  if (!g.prizes) g.prizes = [];
  if (!g.tiers.length && !g.prizes.length) {
    g.tiers = [{ id:'t1', nm:'一級', plans:[11000, 15000], coins:1 }, { id:'t2', nm:'二級', plans:[18000, 22000], coins:1 }];
    for (var i = 0; i < 10; i++) g.prizes.push({ id:'g' + (i + 1), ic:'🎁', nm:'', sub:'', type:'ticket', kind:'goods', w:{} });
  }
}
var GCG_TYPE = { bonus:'紅利點數', ticket:'票券／贈品', none:'銘謝惠顧' };
function gcgInp(v, w, oc, type, ph){
  return '<input ' + (type ? 'type="' + type + '" ' : '') + (ph ? 'placeholder="' + ph + '" ' : '') + (type === 'number' ? 'step="any" ' : '') + 'value="' + gcEsc(v == null ? '' : v) +
    '" style="width:' + w + 'px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px" onchange="' + oc + '">';
}
function gcgLetter(i){ return i < 26 ? String.fromCharCode(65 + i) : String(i + 1) }
function gcgSum(tid){ return Math.round(gcgDraft.prizes.reduce(function(s, p){ return s + (+((p.w || {})[tid]) || 0) }, 0) * 100) / 100 }
/* 上線檢查：用「已經存到雲端」的設定檢查有沒有漏填，並列出方案設定裡每個方案賣出時會送哪一級（金額要一模一樣） */
function gcgCheckHtml(){
  var sv = gcgData.gold || {}, tiers = sv.tiers || [], prizes = sv.prizes || [], bad = [];
  var dirty = JSON.stringify(gcgDraft) !== JSON.stringify(gcgData.gold || { enabled:false, expiry:'', tiers:[], prizes:[] });
  var chk = function(ok, text, fix){ return '<div style="display:flex;gap:8px;font-size:13.5px;line-height:1.7;margin:3px 0"><span style="width:20px;color:' + (ok ? '#2e7d4f' : 'var(--red)') + '">' + (ok ? '✓' : '✗') + '</span><span>' + text + (!ok && fix ? '<span class="muted">　' + fix + '</span>' : '') + '</span></div>' };
  var h = '<div class="card"><div class="card-title">上線檢查</div>';
  if (dirty) h += '<div style="background:#fff8e6;border:1px solid #e8d49a;border-radius:8px;padding:8px 10px;font-size:13px;margin-bottom:8px">畫面上有還沒儲存的修改，下面檢查的是<b>上次儲存</b>的內容。</div>';
  var names = prizes.length && prizes.every(function(p){ return p.nm });
  var sumsOk = tiers.length && prizes.length && tiers.every(function(t){ return Math.abs(prizes.reduce(function(a, p){ return a + (+((p.w || {})[t.id]) || 0) }, 0) - 100) < 0.01 });
  var plansOk = tiers.length && tiers.every(function(t){ return (t.plans || []).length });
  h += chk(tiers.length > 0 && prizes.length > 0, '已經儲存過等級和獎品（' + tiers.length + ' 級、' + prizes.length + ' 個獎品）', '請先按下面的儲存')
    + chk(names, '每個獎品都有名稱')
    + chk(sumsOk, '每一級的機率加起來都是 100%')
    + chk(plansOk, '每一級都填了方案金額')
    + chk(!!sv.enabled, '「開放黃金扭蛋」已打開', '沒打開之前客人看不到金幣、不能抽（金幣照常發）')
    + chk(!sv.expiry || sv.expiry >= gcgData.today, sv.expiry ? '金幣期限 ' + sv.expiry + ' 還沒過' : '金幣沒有設期限', '期限已經過了，客人抽不到');
  /* 方案對照 */
  if (typeof mbActivePlans === 'function') {
    var plans = []; try { plans = mbActivePlans() } catch(e) {}
    var rows = plans.map(function(p){
      var price = Math.round(+p.price || 0);
      var t = tiers.filter(function(x){ return (x.plans || []).indexOf(price) >= 0 })[0];
      return { nm: p.name || '（沒名稱）', price: price, t: t };
    });
    var near = function(price){
      var all = []; tiers.forEach(function(t){ (t.plans || []).forEach(function(a){ all.push(a) }) });
      return all.filter(function(a){ return price > 0 && Math.abs(a - price) <= Math.max(1000, a * 0.1) && a !== price })[0];
    };
    h += '<div style="margin-top:12px;font-weight:600;font-size:13.5px">方案設定裡的方案，賣出時會送什麼</div>' +
      '<div class="muted" style="font-size:12px;margin:2px 0 6px">金額要跟等級裡填的一模一樣才會發金幣（賣方案時用的是方案設定的「價格」）。沒送金幣的方案如果本來該送，請檢查價格或等級的方案金額。</div>' +
      (rows.length ? '<table style="border-collapse:collapse;font-size:13px;width:100%;max-width:560px">' + rows.map(function(r){
        var n = r.t ? '' : near(r.price);
        return '<tr style="border-top:1px solid var(--border)"><td style="padding:5px 4px">' + gcEsc(r.nm) + '</td><td style="text-align:right;padding:5px 8px;font-variant-numeric:tabular-nums">$' + r.price.toLocaleString() + '</td>' +
          '<td style="padding:5px 4px;color:' + (r.t ? '#2e7d4f' : 'var(--text3)') + '">' + (r.t ? '🪙 ' + gcEsc(r.t.nm) + '，送 ' + (r.t.coins || 1) + ' 枚' : '不送金幣') +
          (n ? ' <span style="color:var(--red)">（接近 ' + n.toLocaleString() + '，是不是價格差一點？）</span>' : '') + '</td></tr>';
      }).join('') + '</table>' : '<div class="muted" style="font-size:13px">這個畫面讀不到方案清單（可能還沒載入），到「會員」頁看一下方案再回來。</div>');
  }
  return h + '</div>';
}
function gcgHtml(){
  var g = gcgDraft, tiers = g.tiers, prizes = g.prizes;
  var h = '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;line-height:1.8">' +
    '<b>怎麼運作：</b>賣方案時，金額一模一樣落在某一級，系統就自動送那一級的金幣；金幣會出現在客人遊樂島左下角，按下去轉。' +
    '<b>「開放」沒打開之前，客人看不到金幣、也不能抽</b>（金幣照常發，先放著）。抽到的紅利直接入帳，票券和贈品會出現在「中獎紀錄・核銷」，客人來領的時候按「已使用」。</div>';

  h += gcgCheckHtml();

  h += '<div class="card"><div class="card-title">🪙 黃金扭蛋</div>' +
    '<label style="display:flex;gap:8px;align-items:center;font-size:14px;margin:6px 0"><input type="checkbox"' + (g.enabled ? ' checked' : '') + ' onchange="gcgDraft.enabled=this.checked"> 開放黃金扭蛋</label>' +
    '<div style="display:grid;grid-template-columns:140px 1fr;gap:10px;align-items:center;margin-top:10px;font-size:13.5px">' +
    '<label style="color:var(--text2)">金幣使用期限</label><div><input type="date" value="' + gcEsc(g.expiry || '') + '" style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="gcgDraft.expiry=this.value"> ' +
    '<span class="muted" style="font-size:12px">空白＝不限期限</span></div></div></div>';

  /* 方案等級 */
  h += '<div class="card"><div class="card-title">方案等級</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">填「登記方案時的金額」，一模一樣才算進那一級，用逗號隔開，一個金額只能放在一級。買到那一級的方案就送那一級的金幣數。</div>';
  tiers.forEach(function(t, ti){
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px">' +
      gcgInp(t.nm, 90, 'gcgSetT(' + ti + ',\'nm\',this.value)', '', '等級名稱') + ' 方案金額 ' +
      '<input value="' + gcEsc((t.plans || []).join(', ')) + '" placeholder="例如 11000, 15000" style="width:200px;padding:5px 6px;border:1px solid var(--border);border-radius:6px;font-size:13px" onchange="gcgSetT(' + ti + ',\'plans\',this.value)"> 元，送 ' +
      gcgInp(t.coins, 52, 'gcgSetT(' + ti + ',\'coins\',this.value)', 'number') + ' 枚金幣' +
      '<button class="btn btn-del btn-sm" onclick="gcgDelT(' + ti + ')">刪除</button></div>';
  });
  h += '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px"><button class="btn btn-outline btn-sm" onclick="gcgAddT()">＋ 新增等級</button>' +
    '<span style="flex:1"></span><span style="font-size:13px">查方案金額 ' + '<input id="gcg-amt" type="number" placeholder="例如 15000" style="width:100px;padding:5px 6px;border:1px solid var(--border);border-radius:6px" oninput="gcgWhich()"> → <b id="gcg-which">—</b></span></div></div>';

  /* 獎品表：每級一欄機率 */
  h += '<div class="card"><div class="card-title">獎品與各級中獎機率</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:12px">獎品是大家共用的同一份清單。右邊每一級各填一欄「中獎機率 %」，想讓某一級比較容易抽到某個獎品，就把那一格填大一點；<b>每一級那一欄加起來要剛好 100%</b>。' +
    '機率填 0 代表那一級抽不到這個獎品。限量、每人上限是所有等級合計，空白代表不限。' +
    '<br>填好每個獎品的<b>「商品金額」和「限量」</b>，按<b>「🪄 依金額自動配機率」</b>，系統會幫每一級算好機率：數量多的、便宜的比較容易抽到，貴的比較難；越高級的等級，抽到貴獎品的機會越大。算完還是可以自己改。</div>' +
    '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;min-width:' + (790 + tiers.length * 90) + 'px">' +
    '<tr style="text-align:left;color:var(--text2)"><th style="padding:6px 4px;width:30px"></th><th>圖示</th><th>名稱</th><th>說明</th><th>類型</th><th>點數／性質</th><th>限量</th><th>每人上限</th><th>商品金額</th>' +
    tiers.map(function(t){ return '<th style="color:var(--gold2)">' + gcEsc(t.nm) + ' %</th>' }).join('') + '<th></th></tr>';
  prizes.forEach(function(p, pi){
    var f = 'gcgSetP(' + pi + ',';
    var sel = function(k, v, opts){
      return '<select style="padding:5px;border:1px solid var(--border);border-radius:6px;font-size:13px" onchange="' + f + '\'' + k + '\',this.value)">' +
        Object.keys(opts).map(function(o){ return '<option value="' + o + '"' + (o === v ? ' selected' : '') + '>' + opts[o] + '</option>' }).join('') + '</select>';
    };
    h += '<tr class="gcg-prow" style="border-top:1px solid var(--border)">' +
      '<td title="按住拖移調整順序" style="padding:6px 4px;font-weight:600;color:var(--gold2);cursor:grab;user-select:none;-webkit-user-select:none;touch-action:none;white-space:nowrap" onpointerdown="gcgDragStart(event,' + pi + ')"><span style="color:var(--text3);font-size:15px">⠿</span> ' + gcgLetter(pi) + '</td>' +
      '<td>' + gcgInp(p.ic, 40, f + '\'ic\',this.value)') + '</td>' +
      '<td>' + gcgInp(p.nm, 130, f + '\'nm\',this.value)', '', '獎品名稱') + '</td><td>' + gcgInp(p.sub, 130, f + '\'sub\',this.value)') + '</td>' +
      '<td>' + sel('type', p.type, GCG_TYPE) + '</td><td>' +
      (p.type === 'bonus' ? gcgInp(p.v, 52, f + '\'v\',this.value)', 'number') + ' 點' : p.type === 'ticket' ? sel('kind', p.kind || 'goods', GC_KIND) : '<span class="muted">—</span>') + '</td>' +
      '<td>' + gcgInp(p.qty, 52, f + '\'qty\',this.value)', 'number') + '</td><td>' + gcgInp(p.per, 52, f + '\'per\',this.value)', 'number') + '</td>' +
      '<td style="white-space:nowrap">' + gcgInp(p.cost, 64, f + '\'cost\',this.value)', 'number', '元') + '</td>' +
      tiers.map(function(t){ return '<td>' + gcgInp((p.w || {})[t.id], 64, 'gcgSetW(' + pi + ',\'' + t.id + '\',this.value)', 'number') + '</td>' }).join('') +
      '<td><button class="btn btn-del btn-sm" onclick="gcgDelP(' + pi + ')">刪除</button></td></tr>';
  });
  h += '<tr style="border-top:2px solid var(--border);font-weight:600"><td colspan="9" style="padding:8px 4px;text-align:right">合計（要 100%）</td>' +
    tiers.map(function(t){ var s = gcgSum(t.id), ok = Math.abs(s - 100) < 0.01;
      return '<td style="color:' + (ok ? '#2e7d4f' : 'var(--red)') + '">' + s + '%' + (ok ? ' ✓' : '') + '</td>' }).join('') + '<td></td></tr>' +
    (prizes.some(function(p){ return +p.cost > 0 }) ? '<tr style="font-size:12.5px;color:var(--text2)"><td colspan="9" style="padding:4px;text-align:right">平均每枚金幣送出（照商品金額算）</td>' +
      tiers.map(function(t){ var v = prizes.reduce(function(a, p){ return a + (+((p.w || {})[t.id]) || 0) * (+p.cost || 0) / 100 }, 0);
        return '<td style="white-space:nowrap">約 ' + Math.round(v) + ' 元</td>' }).join('') + '<td></td></tr>' : '') +
    '</table></div>' +
    '<div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap"><button class="btn btn-outline btn-sm" onclick="gcgAddP()">＋ 新增獎品</button>' +
    '<button class="btn btn-outline btn-sm" onclick="gcgAuto()">🪄 依金額自動配機率</button>' +
    '<span style="flex:1"></span><button class="btn btn-outline btn-sm" onclick="gcgUndo()">放棄修改</button>' +
    '<button class="btn btn-gold" onclick="gcgSave()">💾 儲存黃金扭蛋設定</button></div>';
  if (gcgData.gold && gcgData.gold.updatedAt) h += '<div class="muted" style="font-size:12px;margin-top:8px;text-align:right">上次儲存：' +
    gcEsc(String(gcgData.gold.updatedAt).slice(0, 16).replace('T', ' ')) + ' ' + gcEsc(gcgData.gold.updatedBy || '') + '</div>';
  h += '</div>';

  h += gcgWinnersHtml();

  /* 試抽 */
  h += '<div class="card"><div class="card-title">試抽看分布（電腦模擬，不會真的發獎）</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">機率填好之後，想知道「假如有 1000 個客人來抽，大概會抽出幾個絲巾、幾個畫架」，選等級和次數按「試抽」，電腦會照上面<b>現在畫面上填的機率</b>假裝抽一遍給你看（不用先儲存）。' +
    '<b>不會發獎、不扣限量、不扣任何人的金幣</b>，純粹讓你檢查機率合不合理。</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13.5px"><select id="gcg-simtier" style="padding:7px;border:1px solid var(--border);border-radius:6px">' +
    tiers.map(function(t){ return '<option value="' + gcEsc(t.id) + '"' + (gcgSimSel.t === t.id ? ' selected' : '') + '>' + gcEsc(t.nm) + '</option>' }).join('') + '</select>' +
    '<select id="gcg-simn" style="padding:7px;border:1px solid var(--border);border-radius:6px">' + [100, 1000, 10000, 100000].map(function(n){ return '<option' + (gcgSimSel.n === n ? ' selected' : '') + '>' + n + '</option>' }).join('') + '</select> 次' +
    '<button class="btn btn-gold btn-sm" onclick="gcgRunSim()">🎲 試抽</button></div>';
  if (gcgSim) {
    h += '<div style="margin-top:12px;font-size:13px"><b>' + gcEsc(gcgSim.tier) + '</b>　抽了 ' + gcgSim.n + ' 次</div>' +
      '<table style="border-collapse:collapse;font-size:13px;margin-top:6px"><tr style="text-align:left;color:var(--text2)"><th style="padding:4px 8px 4px 0"></th><th style="padding-right:12px">獎品</th><th style="padding-right:12px;text-align:right">設定</th><th style="padding-right:12px;text-align:right">實際</th><th style="text-align:right">次數</th></tr>' +
      gcgSim.rows.map(function(r){ return '<tr style="border-top:1px solid var(--border)"><td style="padding:4px 8px 4px 0;font-weight:600;color:var(--gold2)">' + r.l + '</td><td style="padding-right:12px">' + gcEsc(r.nm) +
        '</td><td style="padding-right:12px;text-align:right">' + r.set + '%</td><td style="padding-right:12px;text-align:right">' + r.act + '%</td><td style="text-align:right">' + r.c + '</td></tr>' }).join('') + '</table>';
  }
  h += '</div>';

  /* 手動補發 */
  var saved = (gcgData.gold && gcgData.gold.tiers) || [];
  h += '<div class="card"><div class="card-title">手動補發金幣</div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">等級要先儲存才選得到。補發的金幣會記在下面的金幣紀錄裡。</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:13.5px">' +
    '<input id="gcg-phone" placeholder="會員電話" style="width:130px;padding:7px 8px;border:1px solid var(--border);border-radius:6px">' +
    '<select id="gcg-tier" style="padding:7px;border:1px solid var(--border);border-radius:6px">' +
    (saved.length ? saved.map(function(t){ return '<option value="' + gcEsc(t.id) + '">' + gcEsc(t.nm) + '</option>' }).join('') : '<option value="">（還沒有等級）</option>') + '</select>' +
    '<input id="gcg-n" type="number" min="1" max="20" value="1" style="width:56px;padding:7px 8px;border:1px solid var(--border);border-radius:6px"> 枚' +
    '<input id="gcg-note" placeholder="備註（選填）" style="width:180px;padding:7px 8px;border:1px solid var(--border);border-radius:6px">' +
    '<button class="btn btn-gold btn-sm" onclick="gcgGrant()">補發</button></div></div>';

  /* 金幣紀錄 */
  var coins = gcgData.coins || {};
  var list = Object.keys(coins).map(function(k){ return Object.assign({ _k:k }, coins[k]) }).filter(function(x){ return x && x.at })
    .sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
  var q = gcgCoinQ.trim(), qd = q.replace(/\D/g, '');
  var shown = list.filter(function(x){ return !q || (x.name && x.name.indexOf(q) >= 0) || (qd.length >= 3 && String(x.phone).indexOf(qd) >= 0) }).slice(0, 200);
  var unused = list.filter(function(x){ return !x.used }).length;
  h += '<div class="card"><div class="card-title">金幣紀錄　<span style="font-size:13px;color:var(--text2);font-weight:400">共 ' + list.length + ' 枚・還沒抽 ' + unused + ' 枚</span></div>' +
    '<input placeholder="搜尋姓名或電話" value="' + gcEsc(gcgCoinQ) + '" onchange="gcgCoinQ=this.value;renderGacha()" style="width:100%;max-width:300px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;font-size:14px;margin-bottom:10px">';
  if (!shown.length) h += '<div class="empty">還沒有金幣紀錄</div>';
  else h += shown.map(function(x){
    var t = String(x.at).slice(5, 16).replace('T', ' ').replace('-', '/');
    return '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px;flex-wrap:wrap">' +
      '<span style="width:84px;color:var(--text3);font-size:12px">' + t + '</span>' +
      '<span style="flex:1 1 150px"><b>' + gcEsc(x.name || '（未填姓名）') + '</b> <span class="muted" style="font-size:12px">' + gcEsc(x.phone) + '</span></span>' +
      '<span style="flex:1 1 150px">🪙 ' + gcEsc(x.tierNm || '') + ' <span style="font-size:11px;background:#f0ece2;border-radius:10px;padding:1px 7px;color:var(--text2)">' + (x.src === 'manual' ? '手動補發' : '買方案') + '</span>' +
      (x.src === 'plan' && x.planNm ? ' <span class="muted" style="font-size:12px">' + gcEsc(x.planNm) + '</span>' : '') +
      (x.note ? ' <span class="muted" style="font-size:12px">' + gcEsc(x.note) + '</span>' : '') + '</span>' +
      '<span style="width:130px;text-align:right;font-size:12px">' + (x.used
        ? '<span style="color:var(--text3)">已抽' + (x.prizeNm ? '：' + gcEsc(x.prizeNm) : '') + '</span> <a style="cursor:pointer;text-decoration:underline;color:var(--red)" onclick="gcgUndoDraw(\'' + x._k + '\')">收回獎項</a>'
        : '<span style="color:#2e7d4f;margin-right:6px">未抽</span><a style="cursor:pointer;text-decoration:underline;color:var(--red)" onclick="gcgRevoke(\'' + x._k + '\')">收回</a>') + '</span></div>';
  }).join('');
  return h + '</div>';
}
/* ── 得獎統計與領取確認單 ──
   資料是每枚已抽的金幣（gacha/goldcoins）：誰、什麼時候、抽到什麼、領了沒。
   紅利抽到就入帳，不用領；票券／贈品要來店領，領的時候按「已領取」（會同步把會員那張券標成已使用）。 */
function gcgWinners(){
  var sv = gcgData.gold || {}, pz = {}, out = [];
  (sv.prizes || []).forEach(function(p){ pz[p.id] = p });
  var coins = gcgData.coins || {};
  Object.keys(coins).forEach(function(k){
    var c = coins[k]; if (!c || !c.used) return;
    var p = pz[c.prizeId] || {};
    out.push({ id:k, at:c.usedAt || c.at, name:c.name || '', phone:c.phone || k.split('|')[0], prizeId:c.prizeId, nm:c.prizeNm || p.nm || '（已刪除的獎品）',
      ic:c.prizeIc || p.ic || '', type:c.prizeType || p.type || 'ticket', v:c.prizeV || p.v || 0, tier:c.tierNm || '', taken:!!c.taken, takenBy:c.takenBy || '', takenAt:c.takenAt || '' });
  });
  return out.sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
}
function gcgWinnersHtml(){
  var sv = gcgData.gold || {}, prizes = sv.prizes || [], list = gcgWinners(), stock = gcgData.stock || {};
  var h = '<div class="card"><div class="card-title">得獎統計與領取確認</div>';
  if (!prizes.length) return h + '<div class="muted" style="font-size:13px">儲存獎品之後，這裡會顯示每個獎品送出幾個、誰拿走。</div></div>';
  /* 各獎品統計 */
  h += '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;min-width:560px;width:100%"><tr style="text-align:left;color:var(--text2)"><th style="padding:6px 4px"></th><th>獎品</th><th>類型</th><th style="text-align:right">限量</th><th style="text-align:right">已送出</th><th style="text-align:right">剩餘</th><th style="text-align:right">已領取</th><th style="text-align:right">還沒領</th></tr>';
  prizes.forEach(function(p, i){
    var mine = list.filter(function(w){ return w.prizeId === p.id }), sent = Math.max(mine.length, +stock[p.id] || 0);
    var need = p.type === 'ticket', taken = mine.filter(function(w){ return w.taken }).length;
    var left = p.qty == null ? '不限' : Math.max(0, p.qty - sent);
    h += '<tr style="border-top:1px solid var(--border)"><td style="padding:6px 4px;font-weight:600;color:var(--gold2)">' + gcgLetter(i) + '</td><td>' + gcEsc((p.ic || '') + ' ' + p.nm) + '</td><td>' + GCG_TYPE[p.type] + '</td>' +
      '<td style="text-align:right">' + (p.qty == null ? '不限' : p.qty) + '</td><td style="text-align:right"><b>' + sent + '</b></td>' +
      '<td style="text-align:right;' + (left === 0 ? 'color:var(--red)' : '') + '">' + left + '</td>' +
      '<td style="text-align:right">' + (need ? taken : '—') + '</td><td style="text-align:right;' + (need && mine.length - taken > 0 ? 'color:var(--red);font-weight:600' : '') + '">' + (need ? mine.length - taken : '—') + '</td></tr>';
  });
  h += '</table></div>';
  /* 確認單 */
  var q = gcgWin.q.trim(), qd = q.replace(/\D/g, '');
  var rows = list.filter(function(w){
    if (gcgWin.prize && w.prizeId !== gcgWin.prize) return false;
    if (gcgWin.st === 'todo' && !(w.type === 'ticket' && !w.taken)) return false;
    if (gcgWin.st === 'done' && !(w.type === 'ticket' && w.taken)) return false;
    if (!q) return true;
    return (w.name && w.name.indexOf(q) >= 0) || (qd.length >= 3 && String(w.phone).indexOf(qd) >= 0);
  });
  var opt = function(v, t, cur){ return '<option value="' + gcEsc(v) + '"' + (cur === v ? ' selected' : '') + '>' + gcEsc(t) + '</option>' };
  h += '<div style="margin-top:16px;font-weight:600;font-size:14px">領取確認單</div>' +
    '<div class="muted" style="font-size:12px;margin:2px 0 8px">客人來店領獎品時，找到他那一筆按「已領取」。按錯可以「復原」。紅利抽到就已經入帳，不用領。</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:8px;font-size:13px">' +
    '<select onchange="gcgWin.prize=this.value;renderGacha()" style="padding:6px;border:1px solid var(--border);border-radius:6px">' + opt('', '全部獎品', gcgWin.prize) +
    prizes.map(function(p, i){ return opt(p.id, gcgLetter(i) + ' ' + p.nm, gcgWin.prize) }).join('') + '</select>' +
    '<select onchange="gcgWin.st=this.value;renderGacha()" style="padding:6px;border:1px solid var(--border);border-radius:6px">' + opt('', '全部', gcgWin.st) + opt('todo', '還沒領取', gcgWin.st) + opt('done', '已領取', gcgWin.st) + '</select>' +
    '<input placeholder="搜尋姓名或電話" value="' + gcEsc(gcgWin.q) + '" onchange="gcgWin.q=this.value;renderGacha()" style="padding:6px 8px;border:1px solid var(--border);border-radius:6px;width:150px">' +
    '<span style="flex:1"></span><button class="btn btn-outline btn-sm" onclick="gcgPrintSheet()">🖨 列印確認單</button></div>';
  if (!rows.length) return h + '<div class="empty">還沒有符合的得獎紀錄</div></div>';
  h += rows.slice(0, 300).map(function(w){
    var t = String(w.at).slice(5, 16).replace('T', ' ').replace('-', '/');
    var act = w.type === 'bonus' ? '<span style="color:#2e7d4f">紅利 ' + w.v + ' 點已入帳</span>' : w.type === 'none' ? '<span class="muted">銘謝惠顧</span>' :
      (w.taken ? '<span style="color:#2e7d4f">✓ 已領取</span> <span class="muted" style="font-size:11.5px">' + gcEsc(w.takenBy) + ' ' + gcEsc(String(w.takenAt).slice(5, 10).replace('-', '/')) + '</span> <a style="cursor:pointer;text-decoration:underline;font-size:12px" onclick="gcgTaken(\'' + w.id + '\',true)">復原</a>' :
        '<span style="color:var(--red);margin-right:6px">還沒領</span><button class="btn btn-gold btn-sm" onclick="gcgTaken(\'' + w.id + '\',false)">已領取</button>');
    return '<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px;flex-wrap:wrap">' +
      '<span style="width:84px;color:var(--text3);font-size:12px">' + t + '</span>' +
      '<span style="flex:1 1 150px"><b>' + gcEsc(w.name || '（未填姓名）') + '</b> <span class="muted" style="font-size:12px">' + gcEsc(w.phone) + '</span></span>' +
      '<span style="flex:1 1 170px">' + gcEsc((w.ic || '') + ' ' + w.nm) + ' <span style="font-size:11px;background:#f0ece2;border-radius:10px;padding:1px 7px;color:var(--text2)">' + gcEsc(w.tier) + '</span></span>' +
      '<span style="flex:0 1 270px;text-align:right">' + act + ' <a style="cursor:pointer;text-decoration:underline;font-size:12px;color:var(--red);margin-left:6px" onclick="gcgUndoDraw(\'' + w.id + '\')">收回獎項</a></span></div>';
  }).join('');
  return h + '</div>';
}
async function gcgUndoDraw(id){
  var c = (gcgData.coins || {})[id] || {};
  var sv = gcgData.gold || {}, pz = (sv.prizes || []).filter(function(p){ return p.id === c.prizeId })[0] || {};
  var type = c.prizeType || pz.type || 'ticket', v = c.prizeV || pz.v || 0;
  var what = type === 'bonus' ? '會扣回紅利 ' + v + ' 點（會員明細會留一筆「作廢」反向紀錄）' : type === 'ticket' ? '會把他帳上那張券拿掉' : '（銘謝惠顧，沒有東西要收）';
  if (!confirm('要收回「' + (c.name || c.phone) + '」抽到的「' + (c.prizeNm || '') + '」嗎？\n\n' + what + '，限量數量和中獎紀錄也會還原。')) return;
  var delCoin = confirm('這枚金幣要怎麼處理？\n\n【確定】金幣一併收回（測試資料用這個）\n【取消】金幣還給客人，他可以再抽一次');
  try {
    var j = await staffApi('/staff/gacha/gold/undo-draw', { id:id, deleteCoin:delCoin });
    alert('已收回：\n' + (j.done || []).join('\n'));
    await gcgLoad(); gcData = null; renderGacha();
  } catch(e) { alert('收回失敗：' + e.message) }
}
async function gcgTaken(id, undo){
  if (!undo && !confirm('確定客人已經把獎品拿走了嗎？')) return;
  try {
    await staffApi('/staff/gacha/gold/taken', { id:id, undo:!!undo });
    await gcgLoad(); renderGacha();
  } catch(e) { alert('更新失敗：' + e.message) }
}
/* 列印確認單：開新視窗，照目前的篩選列出，最後一欄留空白給客人簽收 */
function gcgPrintSheet(){
  var list = gcgWinners().filter(function(w){
    if (w.type === 'none') return false;
    if (gcgWin.prize && w.prizeId !== gcgWin.prize) return false;
    if (gcgWin.st === 'todo' && !(w.type === 'ticket' && !w.taken)) return false;
    if (gcgWin.st === 'done' && !(w.type === 'ticket' && w.taken)) return false;
    return true;
  });
  var w = window.open('', '_blank');
  if (!w) { alert('瀏覽器擋住了新視窗，請允許彈出視窗再試一次'); return }
  var rows = list.map(function(x){
    return '<tr><td>' + gcEsc(String(x.at).slice(5, 16).replace('T', ' ').replace('-', '/')) + '</td><td>' + gcEsc(x.name || '') + '</td><td>' + gcEsc(x.phone) + '</td><td>' + gcEsc(x.nm) + '</td><td>' +
      (x.type === 'bonus' ? '紅利 ' + x.v + ' 點已入帳' : x.taken ? '已領取 ' + gcEsc(x.takenBy) : '') + '</td><td></td></tr>';
  }).join('');
  w.document.write('<!doctype html><meta charset="utf-8"><title>黃金扭蛋領取確認單</title><style>body{font-family:sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:8px;font-size:14px;text-align:left}th{background:#eee}td:last-child{width:130px}</style>' +
    '<h2>黃金扭蛋領取確認單</h2><p>列印日期：' + new Date().toLocaleDateString('zh-TW') + '　共 ' + list.length + ' 筆</p>' +
    '<table><tr><th>抽中時間</th><th>姓名</th><th>電話</th><th>獎品</th><th>狀態</th><th>簽收</th></tr>' + rows + '</table>');
  w.document.close();
}
function gcgSetT(ti, k, v){
  var t = gcgDraft.tiers[ti]; if (!t) return;
  if (k === 'coins') v = Math.max(1, Math.round(+v || 1));
  if (k === 'plans') v = String(v).split(/[,，\s]+/).map(function(x){ return Math.round(+x.replace(/[^\d.]/g, '') || 0) }).filter(function(x){ return x > 0 });
  t[k] = v;
  if (k === 'nm' || k === 'plans') renderGacha();
}
function gcgSetP(pi, k, v){
  var p = gcgDraft.prizes[pi]; if (!p) return;
  if (k === 'v') v = Math.max(1, Math.round(+v || 1));
  if (k === 'qty' || k === 'per' || k === 'cost') v = v === '' ? null : Math.max(0, +v || 0);
  if (v === null) delete p[k]; else p[k] = v;
  if (k === 'type' && v === 'ticket' && !p.kind) p.kind = 'goods';
  if (k === 'type' && v === 'bonus' && !p.v) p.v = 1;
  renderGacha();
}
function gcgSetW(pi, tid, v){
  var p = gcgDraft.prizes[pi]; if (!p) return;
  p.w = p.w || {};
  p.w[tid] = v === '' ? 0 : Math.max(0, +v || 0);
  renderGacha();
}
function gcgAddT(){
  gcgDraft.tiers.push({ id:'t' + Date.now().toString(36), nm:'新等級', plans:[], coins:1 });
  renderGacha();
}
function gcgDelT(ti){
  if (!confirm('要刪除「' + gcgDraft.tiers[ti].nm + '」這一級嗎？（按儲存才會生效）')) return;
  gcgDraft.tiers.splice(ti, 1); renderGacha();
}
function gcgAddP(){
  gcgDraft.prizes.push({ id:'g' + Date.now().toString(36), ic:'🎁', nm:'', sub:'', type:'ticket', kind:'goods', w:{} });
  renderGacha();
}
function gcgDelP(pi){
  var p = gcgDraft.prizes[pi];
  if (!confirm('要刪除獎品 ' + gcgLetter(pi) + (p.nm ? '「' + p.nm + '」' : '') + ' 嗎？（按儲存才會生效）')) return;
  gcgDraft.prizes.splice(pi, 1); renderGacha();
}
/* 拖移調整獎品順序：按住左邊 ⠿ 那格拖（滑鼠、平板都可以） */
var gcgDrag = null;
function gcgDragStart(e, pi){
  if (e.button > 0) return;
  e.preventDefault();
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  var rows = [].slice.call(document.querySelectorAll('tr.gcg-prow'));
  if (!rows[pi]) return;
  gcgDrag = { from:pi, to:pi, rows:rows };
  rows[pi].style.opacity = '.45'; rows[pi].style.background = '#fff8e6';
  document.body.style.cursor = 'grabbing';
  document.addEventListener('pointermove', gcgDragMove);
  document.addEventListener('pointerup', gcgDragEnd);
  document.addEventListener('pointercancel', gcgDragEnd);
}
function gcgDragMove(e){
  var d = gcgDrag; if (!d) return;
  e.preventDefault();
  var to = d.rows.length - 1;
  for (var i = 0; i < d.rows.length; i++) {
    var r = d.rows[i].getBoundingClientRect();
    if (e.clientY < r.top + r.height / 2) { to = i > d.from ? i - 1 : i; break }
  }
  d.to = to;
  d.rows.forEach(function(tr, i){
    tr.style.boxShadow = i !== to || to === d.from ? '' : (to > d.from ? 'inset 0 -3px 0 var(--gold2)' : 'inset 0 3px 0 var(--gold2)');
  });
}
function gcgDragEnd(){
  var d = gcgDrag; gcgDrag = null;
  document.removeEventListener('pointermove', gcgDragMove);
  document.removeEventListener('pointerup', gcgDragEnd);
  document.removeEventListener('pointercancel', gcgDragEnd);
  document.body.style.cursor = '';
  if (!d) return;
  if (d.to !== d.from) { var ps = gcgDraft.prizes; ps.splice(d.to, 0, ps.splice(d.from, 1)[0]) }
  renderGacha();
}
/* 依商品金額＋限量自動配機率：權重＝限量 ×（最便宜金額／這個金額）^a，等級越高 a 越小（貴的比較容易出） */
function gcgAuto(){
  var g = gcgDraft, ps = g.prizes, tiers = g.tiers;
  if (!tiers.length || !ps.length) return alert('要先有等級和獎品');
  var miss = [];
  ps.forEach(function(p, i){ if (!(+p.cost > 0)) miss.push(gcgLetter(i) + (p.nm ? ' ' + p.nm : '')) });
  if (miss.length) return alert('這些獎品還沒填「商品金額」：\n' + miss.join('\n') + '\n\n填好再按一次。');
  var qs = ps.map(function(p){ return +p.qty > 0 ? +p.qty : null });
  var qMax = Math.max.apply(null, qs.filter(function(x){ return x }).concat([10]));
  if (ps.some(function(p){ return p.qty != null && +p.qty === 0 })) { if (!confirm('有獎品限量填 0，那個獎品會配 0%。要繼續嗎？')) return }
  if (!confirm('會把每一級的機率全部重新算過、蓋掉現在填的數字（按儲存才會生效）。要繼續嗎？')) return;
  var minC = Math.min.apply(null, ps.map(function(p){ return +p.cost }));
  tiers.forEach(function(t, ti){
    var a = tiers.length === 1 ? 0.5 : 0.7 - 0.5 * ti / (tiers.length - 1);
    var raw = ps.map(function(p, i){
      var q = p.qty != null && +p.qty === 0 ? 0 : (qs[i] || qMax);
      return q * Math.pow(minC / +p.cost, a);
    });
    var tot = raw.reduce(function(x, y){ return x + y }, 0) || 1;
    var pct = raw.map(function(r){ return Math.round(r / tot * 1000) / 10 });
    var diff = Math.round((100 - pct.reduce(function(x, y){ return x + y }, 0)) * 10) / 10;
    var big = pct.indexOf(Math.max.apply(null, pct));
    pct[big] = Math.round((pct[big] + diff) * 10) / 10;
    ps.forEach(function(p, i){ p.w = p.w || {}; p.w[t.id] = pct[i] });
  });
  gcgSim = null; renderGacha();
}
function gcgUndo(){
  gcgDraft = JSON.parse(JSON.stringify(gcgData.gold)); gcgFill(); gcgSim = null; renderGacha();
}
function gcgWhich(){
  var a = Math.round(+document.getElementById('gcg-amt').value || 0), el = document.getElementById('gcg-which');
  if (!a) { el.textContent = '—'; return }
  var t = gcgDraft.tiers.filter(function(x){ return (x.plans || []).indexOf(a) >= 0 })[0];
  el.textContent = t ? t.nm + '，送 ' + t.coins + ' 枚金幣' : '不在任何一級（不送金幣）';
}
function gcgRunSim(){
  var tid = document.getElementById('gcg-simtier').value, n = +document.getElementById('gcg-simn').value || 1000;
  gcgSimSel = { t:tid, n:n };
  var t = gcgDraft.tiers.filter(function(x){ return x.id === tid })[0], ps = gcgDraft.prizes;
  var tot = ps.reduce(function(s, p){ return s + (+((p.w || {})[tid]) || 0) }, 0);
  if (!t || !tot) { alert('這一級還沒填任何機率'); return }
  var cnt = ps.map(function(){ return 0 });
  for (var i = 0; i < n; i++) {
    var r = Math.random() * tot, k = 0;
    for (; k < ps.length; k++) { r -= (+((ps[k].w || {})[tid]) || 0); if (r < 0) break }
    cnt[Math.min(k, ps.length - 1)]++;
  }
  gcgSim = { tier:t.nm, n:n, rows:ps.map(function(p, k){
    return { l:gcgLetter(k), nm:p.nm || '（還沒取名）', set:Math.round((+((p.w || {})[tid]) || 0) / tot * 10000) / 100, act:Math.round(cnt[k] / n * 10000) / 100, c:cnt[k] };
  }) };
  renderGacha();
}
async function gcgSave(){
  if (!confirm('儲存黃金扭蛋設定？')) return;
  try {
    var j = await staffApi('/staff/gacha/gold/config', { gold:gcgDraft });
    gcgData.gold = j.gold; gcgData.isDefault = false; gcgDraft = JSON.parse(JSON.stringify(j.gold));
    alert('已儲存');
    renderGacha();
  } catch(e) { alert('儲存失敗：' + e.message) }
}
async function gcgGrant(){
  var phone = document.getElementById('gcg-phone').value.replace(/\D/g, ''), tier = document.getElementById('gcg-tier').value,
      n = +document.getElementById('gcg-n').value || 0, note = document.getElementById('gcg-note').value;
  if (!phone) { alert('請填會員電話'); return }
  if (!tier) { alert('請先新增並儲存一個等級'); return }
  var tn = ((gcgData.gold.tiers || []).filter(function(t){ return t.id === tier })[0] || {}).nm || '';
  if (!confirm('補發 ' + n + ' 枚「' + tn + '」金幣給 ' + phone + '？')) return;
  try {
    var j = await staffApi('/staff/gacha/gold/grant', { phone:phone, tier:tier, n:n, note:note });
    alert('已補發 ' + j.granted + ' 枚給 ' + (j.name || phone));
    await gcgLoad(); renderGacha();
  } catch(e) { alert('補發失敗：' + e.message) }
}
async function gcgRevoke(key){
  if (!confirm('要收回這枚還沒抽的金幣嗎？')) return;
  try {
    await staffApi('/staff/gacha/gold/revoke', { key:key });
    await gcgLoad(); renderGacha();
  } catch(e) { alert('收回失敗：' + e.message) }
}
