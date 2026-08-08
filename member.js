/* ══════════════════════════════════════════════════════════
   會員分頁：方案設定、會員查詢、新增會員、賣方案（加點／加堂數）
   會員資料在 otto2-booking-f9ef7 的 members（與客人端 LIFF 同一份）
   方案定義存在 otto2-2026 的 salaryData.plans（跟著主系統一起存）
   餘額一律是 ledger 加總，cache 只是算好的結果，兩邊一起寫
   ══════════════════════════════════════════════════════════ */

var MB_URL = 'https://otto2-booking-f9ef7-default-rtdb.asia-southeast1.firebasedatabase.app';
var mbList = null, mbLoading = false, mbQuery = '', mbOpenPhone = null, mbTab = 'members';

var mbf = function(p){ return MB_URL.replace(/\/$/, '') + p };
function mbEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function mbNorm(p){
  var d = String(p == null ? '' : p).replace(/\D/g, '');
  if (d.indexOf('886') === 0) d = '0' + d.slice(3);
  return d;
}
function mbNow(){ return new Date().toISOString() }
/* 賣方案一按就是幾萬塊入帳，沒權限的人不顯示這顆 */
function mbCan(k){ return (typeof can === "function") ? can(k) : true }
function mbToday(){
  var d = new Date();
  return d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
}

/* ── 方案定義（存在主系統，跟薪資同一份資料）────────────── */
function mbPlans(){
  if (!S.plans) S.plans = [];
  return S.plans;
}
function mbActivePlans(){
  return mbPlans().filter(function(p){ return p.active !== false });
}

/* ── 會員資料 ──────────────────────────────────────────── */
async function mbLoad(force){
  if (mbLoading) return;
  if (mbList && !force) return;
  mbLoading = true;
  try {
    var j = await (await fetch(mbf('/members.json'))).json() || {};
    mbList = Object.keys(j).map(function(phone){
      var m = j[phone] || {}, c = m.cache || {};
      return { phone: phone, name: m.name || '', note: m.note || '',
               points: +c.points || 0, sessions: +c.sessions || 0, bonus: +c.bonus || 0,
               ledger: m.ledger || {}, createdAt: m.createdAt || '',
               archived: m.archived || null };
    });
  } catch(e) { mbList = []; }
  mbLoading = false;
}

function mbFind(q){
  if (!mbList || !q) return [];
  var s = String(q).trim();
  if (s.length < 2) return [];
  var digits = s.replace(/\D/g, '');
  return mbList.filter(function(m){
    /* 封存的不出現在一般搜尋，除非打完整電話把它找出來 */
    if (m.archived && mbNorm(m.phone) !== digits) return false;
    return (digits.length >= 3 && mbNorm(m.phone).indexOf(digits) >= 0) ||
           (m.name && m.name.indexOf(s) >= 0);
  }).slice(0, 20);
}

/* ledger 加總，回傳 {points, sessions, bonus, voucher} */
function mbSum(ledger){
  var out = { points: 0, sessions: 0, bonus: 0, voucher: 0 };
  Object.keys(ledger || {}).forEach(function(k){
    var r = ledger[k]; if (!r) return;
    var t = r.type, d = +r.delta || 0;
    if (t === 'points') out.points += d;
    else if (t === 'sessions') out.sessions += d;
    else if (t === 'bonus') out.bonus += d;
    else if (t === 'voucher') out.voucher += d;
  });
  return out;
}

/* 判斷是新客還是續約：ledger 裡有沒有買過方案 */
function mbIsRenewal(m){
  var l = m.ledger || {};
  return Object.keys(l).some(function(k){ return l[k] && l[k].planName });
}

/* 依方案效期算到期日 */
function mbExpiry(months){
  if (!months) return '';
  var d = new Date();
  d.setMonth(d.getMonth() + (+months || 0));
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

/* ══ 經營數字 ══════════════════════════════════════════
   全部從 members 的 ledger 算出來，不新增任何欄位。
   ledger 每筆有 at（時間）、type、delta、planName、price。
   ── 未交付負債：客人已經付錢、課還沒上，這是負債不是營收。
   ── 最後活動日：ledger 裡最新的一筆時間。有買方案沒來上課的人，
      最後活動日就是購買日，這正是我們要抓出來的人。 */
function mbLastAt(m){
  var last = '';
  var l = m.ledger || {};
  Object.keys(l).forEach(function(k){
    var at = l[k] && l[k].at;
    if (at && String(at) > last) last = String(at);
  });
  return last || m.createdAt || '';
}
function mbDaysSince(iso){
  if (!iso) return 9999;
  var t = Date.parse(iso);
  if (isNaN(t)) return 9999;
  return Math.floor((Date.now() - t) / 86400000);
}
function mbMonthKey(d){
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}
/* 這個月與上個月的 YYYY-MM */
function mbThisMonth(){ return mbMonthKey(new Date()) }
function mbLastMonth(){
  var d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1);
  return mbMonthKey(d);
}
/* 一次算完首頁要的所有數字，只掃一次 mbList */
function mbStats(){
  var s = { total: 0, withBal: 0, liability: 0, sessionsLeft: 0,
            newThis: 0, newLast: 0, saleThis: 0, saleLast: 0,
            sleeping: [], sleepAmt: 0, nearlyEmpty: [], expiring: [] };
  if (!mbList) return s;
  var tm = mbThisMonth(), lm = mbLastMonth();
  /* 一堂課抓 800，餘額低於這個數字代表下次來就得續購 */
  var ONE_CLASS = 800;
  mbList.forEach(function(m){
    if (m.archived) return;          /* 封存的不算進統計與待辦 */
    s.total++;
    var pts = +m.points || 0, ses = +m.sessions || 0;
    if (pts > 0 || ses > 0){
      s.withBal++;
      if (pts > 0) s.liability += pts;   /* 1 點 = 1 元 */
      if (ses > 0) s.sessionsLeft += ses;
    }
    var cm = String(m.createdAt || '').slice(0, 7);
    if (cm === tm) s.newThis++; else if (cm === lm) s.newLast++;

    /* 方案收入：同一次售出會寫好幾筆 ledger，用 sell_<時間戳> 去重，只算一次 price */
    var seen = {};
    var l = m.ledger || {};
    Object.keys(l).forEach(function(k){
      var r = l[k]; if (!r || !r.planName || !(+r.price)) return;
      var stamp = String(k).replace(/^(sell_\d+)_.*$/, '$1');
      if (seen[stamp]) return;
      seen[stamp] = 1;
      var mk = String(r.at || '').slice(0, 7);
      if (mk === tm) s.saleThis += +r.price;
      else if (mk === lm) s.saleLast += +r.price;
      /* 效期到期日已經寫在 ledger 上，30 天內到期就撈出來 */
      if (r.expiry && (pts > 0 || ses > 0)){
        var left = Math.floor((Date.parse(r.expiry + 'T23:59:59') - Date.now()) / 86400000);
        if (left >= 0 && left <= 30) s.expiring.push({ m: m, expiry: r.expiry, left: left });
      }
    });

    if (pts > 0 || ses > 0){
      var d = mbDaysSince(mbLastAt(m));
      if (d >= 90){ s.sleeping.push({ m: m, days: d }); s.sleepAmt += pts; }
      else if (ses === 0 && pts > 0 && pts < ONE_CLASS) s.nearlyEmpty.push({ m: m, days: d });
      else if (ses === 1) s.nearlyEmpty.push({ m: m, days: d });
    }
  });
  s.sleeping.sort(function(a, b){ return b.days - a.days });
  s.nearlyEmpty.sort(function(a, b){ return a.days - b.days });
  s.expiring.sort(function(a, b){ return a.left - b.left });
  return s;
}

/* ══ 畫面 ══════════════════════════════════════════════ */
async function renderMember(){
  var el = document.getElementById('member-body');
  if (!el) return;
  if (!mbList) { el.innerHTML = '<div class="empty">載入會員資料中…</div>'; await mbLoad(); }

  var h = '';
  h += '<div class="store-tabs" style="margin-bottom:14px">' +
       '<button class="store-btn' + (mbTab === 'members' ? ' active' : '') + '" onclick="mbSwitch(\'members\')">會員查詢</button>' +
       '<button class="store-btn' + (mbTab === 'plans' ? ' active' : '') + '" onclick="mbSwitch(\'plans\')">方案設定</button>' +
       (mbCan('sellPlan') ? '<button class="store-btn' + (mbTab === 'import' ? ' active' : '') + '" onclick="mbSwitch(\'import\')">批次匯入</button>' : '') +
       '</div>';
  h += (mbTab === 'plans') ? mbPlansHtml() : (mbTab === 'import' ? mbImportHtml() : mbMembersHtml());
  el.innerHTML = h;

  var sb = document.getElementById('mb-search');
  if (sb) { sb.oninput = function(){ mbQuery = this.value; mbDrawHits(); }; }
  mbDrawHits();
}

function mbSwitch(t){ mbTab = t; mbOpenPhone = null; renderMember(); }

/* ── 會員查詢 ──────────────────────────────────────────── */
function mbMembersHtml(){
  var s = mbStats();
  var money = function(n){ return '$' + Math.round(n).toLocaleString() };
  var delta = function(now, prev, isMoney){
    if (!prev) return '<span class="muted" style="font-size:12.5px">上月 ' + (isMoney ? money(prev) : prev) + '</span>';
    var up = now >= prev;
    return '<span style="font-size:12.5px;color:' + (up ? 'var(--green)' : '#C25E4A') + '">' +
           (up ? '↑' : '↓') + ' 上月 ' + (isMoney ? money(prev) : prev) + '</span>';
  };
  var h = '';

  /* 三個一眼要看到的數字。會員總數不放大——知道總數不會讓人做任何事 */
  h += '<div class="stat-grid" style="margin-bottom:16px">';
  h += '<div class="stat-card"><div class="lbl">未交付課程（負債）</div>' +
       '<div class="val">' + money(s.liability) + '</div>' +
       '<div class="muted" style="font-size:12.5px;margin-top:5px">' + s.withBal + ' 位有餘額' +
       (s.sessionsLeft ? '　另有 ' + s.sessionsLeft + ' 堂' : '') + '</div></div>';
  h += '<div class="stat-card"><div class="lbl">本月新增會員</div>' +
       '<div class="val">' + s.newThis + '</div>' +
       '<div style="margin-top:5px">' + delta(s.newThis, s.newLast, false) + '</div></div>';
  h += '<div class="stat-card"><div class="lbl">本月售出方案</div>' +
       '<div class="val">' + money(s.saleThis) + '</div>' +
       '<div style="margin-top:5px">' + delta(s.saleThis, s.saleLast, true) + '</div></div>';
  h += '</div>';

  /* 最常用的動作放最上面：找人、重讀、建檔 */
  h += '<div class="card" style="margin-bottom:16px">' +
       '<div class="row" style="display:flex;gap:8px;align-items:center;margin-bottom:11px">' +
       '<div class="card-title" style="margin:0">🔍 找會員</div>' +
       '<span style="margin-left:auto;display:flex;gap:8px;align-items:center">' +
       '<span class="muted" style="font-size:13.5px">共 ' + s.total + ' 位</span>' +
       '<button class="btn btn-outline btn-sm" onclick="mbLoad(1).then(renderMember)">重新讀取</button>' +
       '<button class="btn btn-gold btn-sm" onclick="mbNewMember()">＋ 新增會員</button>' +
       '</span></div>' +
       '<input id="mb-search" placeholder="輸入電話或姓名（兩個字以上）" value="' + mbEsc(mbQuery) + '" ' +
       'style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:16px;outline:none;font-family:inherit">' +
       '<div id="mb-hits" style="margin-top:10px"></div>' +
       '</div>';

  /* 每份名單都接得上一個動作，這才是這頁的價值 */
  h += '<div class="card" style="margin-bottom:16px">';
  h += '<div class="card-title">📋 該聯絡的名單</div>';
  h += mbTodoRow('餘額還在，超過 90 天沒來',
        s.sleepAmt ? '帳上共 ' + money(s.sleepAmt) + '，錢已經收了，最好打' : '錢已經收了，最好打',
        s.sleeping.length, 'sleeping', s.sleeping.length ? 'var(--gold2)' : 'var(--text3)');
  h += mbTodoRow('點數 30 天內到期',
        '到期就歸零，先通知比較好收尾', s.expiring.length, 'expiring',
        s.expiring.length ? '#C25E4A' : 'var(--text3)');
  h += mbTodoRow('餘額剩不到一堂課',
        '下次來上課就是續購的時機', s.nearlyEmpty.length, 'nearly',
        s.nearlyEmpty.length ? 'var(--gold2)' : 'var(--text3)');
  h += '</div>';

  return h;
}

function mbTodoRow(title, sub, n, kind, color){
  return '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;' +
    'padding:13px 0;border-bottom:1px solid var(--border)">' +
    '<div><div style="font-size:14.5px">' + title + '</div>' +
    '<div class="muted" style="font-size:12.5px;margin-top:2px">' + sub + '</div></div>' +
    '<div style="display:flex;align-items:center;gap:13px;flex-shrink:0">' +
    '<span style="font-size:21px;color:' + color + ';font-variant-numeric:tabular-nums">' + n + '</span>' +
    (n ? '<button class="btn btn-outline btn-sm" onclick="mbShowList(\'' + kind + '\')">看名單</button>'
       : '<span class="muted" style="font-size:13.5px">—</span>') +
    '</div></div>';
}

/* 名單彈窗。點姓名直接開明細，行政不用再回去搜尋一次 */
function mbShowList(kind){
  var s = mbStats(), rows, title, note;
  if (kind === 'sleeping'){
    rows = s.sleeping; title = '餘額還在，超過 90 天沒來';
    note = '依最久沒來排序。這些人的錢已經在我們這裡，回訪成本最低。';
  } else if (kind === 'expiring'){
    rows = s.expiring; title = '點數 30 天內到期';
    note = '依到期日排序。到期日來自賣方案時寫入的效期。';
  } else {
    rows = s.nearlyEmpty; title = '餘額剩不到一堂課';
    note = '依最近來過排序。這些人下次進門就是開口續購的時機。';
  }
  var h = '<h3 style="margin:0 0 3px">' + title + '　<span style="color:var(--text3);font-weight:400">' + rows.length + ' 位</span></h3>';
  h += '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' + note + '</div>';
  h += '<table><thead><tr><th>姓名</th><th style="width:112px">電話</th>' +
       '<th style="width:78px">點數</th><th style="width:56px">堂數</th>' +
       '<th style="width:96px">' + (kind === 'expiring' ? '到期日' : '最後活動') + '</th>' +
       '<th style="width:66px"></th></tr></thead><tbody>';
  rows.slice(0, 200).forEach(function(r){
    var m = r.m;
    var right = (kind === 'expiring')
      ? '<span style="color:' + (r.left <= 7 ? '#C25E4A' : 'var(--text2)') + '">' + r.expiry + '<br><span class="muted" style="font-size:12.5px">剩 ' + r.left + ' 天</span></span>'
      : '<span class="muted">' + (r.days >= 9999 ? '無紀錄' : r.days + ' 天前') + '</span>';
    h += '<tr>' +
      '<td>' + mbEsc(m.name || '（未填姓名）') + '</td>' +
      '<td class="muted">' + m.phone + '</td>' +
      '<td style="text-align:right;color:var(--gold2)">' + (+m.points || 0).toLocaleString() + '</td>' +
      '<td style="text-align:right">' + (+m.sessions || 0) + '</td>' +
      '<td style="font-size:13.5px">' + right + '</td>' +
      '<td><button class="btn btn-outline btn-sm" onclick="mbDetail(\'' + m.phone + '\')">明細</button></td>' +
      '</tr>';
  });
  h += '</tbody></table>';
  if (rows.length > 200) h += '<div class="muted" style="font-size:13.5px;margin-top:8px">只顯示前 200 筆</div>';
  if (!rows.length) h += '<div class="empty">目前沒有人在這份名單裡</div>';
  h += '<div class="row" style="margin-top:16px;display:flex;gap:8px">' +
       '<button class="btn btn-outline" onclick="mbCopyList(\'' + kind + '\')">複製電話清單</button>' +
       '<button class="btn btn-gold" style="margin-left:auto" onclick="mbClose()">關閉</button></div>';
  mbModal(h);
}

/* 電話一次複製起來，貼到 LINE 群發或簡訊都好用 */
function mbCopyList(kind){
  var s = mbStats();
  var rows = kind === 'sleeping' ? s.sleeping : (kind === 'expiring' ? s.expiring : s.nearlyEmpty);
  var txt = rows.map(function(r){ return r.m.phone + ' ' + (r.m.name || '') }).join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ alert('已複製 ' + rows.length + ' 筆') },
      function(){ prompt('手動複製：', txt) });
  } else prompt('手動複製：', txt);
}

function mbDrawHits(){
  var box = document.getElementById('mb-hits');
  if (!box) return;
  if (!mbQuery || mbQuery.trim().length < 2) {
    box.innerHTML = '<div class="muted" style="font-size:13.5px;padding:8px 2px">打電話或姓名開始搜尋。電話至少 3 碼，姓名至少 2 個字。</div>';
    return;
  }
  var r = mbFind(mbQuery);
  if (!r.length) {
    box.innerHTML = '<div class="muted" style="font-size:13.5px;padding:8px 2px">查無此人。' +
      '<button class="btn btn-outline btn-sm" style="margin-left:8px" onclick="mbNewMember()">＋ 新增會員</button></div>';
    return;
  }
  var h = '<table><thead><tr><th>姓名</th><th style="width:120px">電話</th>' +
          '<th style="width:80px">點數</th><th style="width:70px">堂數</th><th style="width:70px">紅利</th>' +
          '<th style="width:150px"></th></tr></thead><tbody>';
  r.forEach(function(m){
    h += '<tr>' +
      '<td>' + mbEsc(m.name || '（未填姓名）') + '</td>' +
      '<td class="muted">' + m.phone + '</td>' +
      '<td style="text-align:right;color:' + (m.points > 0 ? 'var(--gold2)' : 'var(--text3)') + '">' + m.points.toLocaleString() + '</td>' +
      '<td style="text-align:right">' + m.sessions + '</td>' +
      '<td style="text-align:right">' + m.bonus + '</td>' +
      '<td style="display:flex;gap:6px">' +
        '<button class="btn btn-outline btn-sm" onclick="mbDetail(\'' + m.phone + '\')">明細</button>' +
        (mbCan('sellPlan') ? '<button class="btn btn-sm btn-gold" onclick="mbSell(\'' + m.phone + '\')">賣方案</button>' : '') +
      '</td></tr>';
  });
  h += '</tbody></table>';
  if (r.length >= 20) h += '<div class="muted" style="font-size:13.5px;margin-top:6px">只顯示前 20 筆，請再輸入詳細一點</div>';
  box.innerHTML = h;
}

/* ── 會員明細 ──────────────────────────────────────────── */
function mbDetail(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var sum = mbSum(m.ledger);
  var rows = Object.keys(m.ledger || {}).map(function(k){
    return Object.assign({ _k: k }, m.ledger[k]);
  }).sort(function(a, b){ return String(b.at || '') < String(a.at || '') ? -1 : 1 });

  var TYPE = { points: '點數', sessions: '堂數', bonus: '紅利', voucher: '折價金' };
  var h = '<h3 style="margin:0 0 2px">' + mbEsc(m.name || '（未填姓名）') + '</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' + m.phone + (m.note ? '　' + mbEsc(m.note) : '') + '</div>';

  h += '<div class="card" style="margin-bottom:14px"><div class="row" style="gap:20px;flex-wrap:wrap">' +
    '<div><div class="muted" style="font-size:13.5px">可用點數</div><div style="font-size:20px;color:var(--gold2)">' + sum.points.toLocaleString() + '</div></div>' +
    '<div><div class="muted" style="font-size:13.5px">堂數</div><div style="font-size:20px">' + sum.sessions + '</div></div>' +
    '<div><div class="muted" style="font-size:13.5px">紅利</div><div style="font-size:20px">' + sum.bonus + '</div></div>' +
    (sum.voucher ? '<div><div class="muted" style="font-size:13.5px">表框折價金</div><div style="font-size:20px">$' + sum.voucher.toLocaleString() + '</div></div>' : '') +
    '</div>';
  if (sum.points !== m.points || sum.sessions !== m.sessions || sum.bonus !== m.bonus) {
    h += '<div class="info-box" style="margin-top:10px;border-color:var(--red)">' +
      '⚠ 明細加總與系統顯示的餘額不同（顯示 ' + m.points + ' 點／明細 ' + sum.points + ' 點）。' +
      '<button class="btn btn-sm" style="margin-left:8px" onclick="mbFixCache(\'' + phone + '\')">用明細重算</button></div>';
  }
  h += '</div>';

  h += '<div style="max-height:46vh;overflow:auto"><table><thead><tr>' +
       '<th style="width:120px">時間</th><th style="width:60px">類型</th><th style="width:80px">增減</th><th>原因</th><th style="width:70px">經手</th><th style="width:40px"></th>' +
       '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="6"><div class="empty" style="padding:16px">還沒有任何紀錄</div></td></tr>';
  rows.forEach(function(r){
    var d = +r.delta || 0;
    h += '<tr' + (r.manual ? ' style="background:var(--bg3)"' : '') + '>' +
      '<td class="muted" style="font-size:12.5px">' + String(r.at || '').slice(0, 16).replace('T', ' ') + '</td>' +
      '<td style="font-size:13.5px">' + (TYPE[r.type] || r.type || '—') + '</td>' +
      '<td style="text-align:right;font-weight:600;color:' + (d >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (d > 0 ? '+' : '') + d.toLocaleString() + '</td>' +
      '<td style="font-size:13.5px">' +
        (r.manual ? '<span style="font-size:11.5px;background:var(--gold);color:#000;padding:1px 6px;border-radius:99px;margin-right:6px">手動</span>' : '') +
        mbEsc(r.reason || '') +
        (r.expiryNew
          ? '<br><span class="muted" style="font-size:12.5px">效期至 ' + r.expiryNew + '（原 ' + (r.expiry || '—') + '，已延 ' + ((r.extends || []).length) + ' 次）</span>'
          : (r.expiry ? '<br><span class="muted" style="font-size:12.5px">效期至 ' + r.expiry + '</span>' : '')) + '</td>' +
      '<td class="muted" style="font-size:12.5px">' + mbEsc(r.by || '') + '</td>' +
      '<td style="text-align:center"><button class="btn btn-sm" style="padding:2px 7px;color:var(--red);border-color:#EBD3D0" onclick="mbDelLedger(\'' + phone + '\',\'' + r._k + '\')">✕</button></td>' +
      '</tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="row" style="margin-top:14px;gap:8px;flex-wrap:wrap">' +
       (mbCan('sellPlan') ? '<button class="btn btn-gold" style="flex:1;min-width:130px" onclick="mbSell(\'' + phone + '\')">賣方案／加點</button>' : '') +
       '<button class="btn" style="flex:1;min-width:100px" onclick="mbAdjust(\'' + phone + '\')">調整餘額</button>' +
       '<button class="btn" style="flex:1;min-width:100px" onclick="mbEditInfo(\'' + phone + '\')">編輯資料</button>' +
       '<button class="btn" style="flex:1;min-width:100px" onclick="mbExtend(\'' + phone + '\')">展延效期</button>' +
       '<button class="btn" style="flex:1;min-width:80px" onclick="mbClose()">關閉</button></div>';
  h += '<div style="margin-top:18px;padding-top:14px;border-top:1px solid var(--border);text-align:right">' +
       '<button class="btn btn-sm" style="color:var(--red);border-color:#EBD3D0" ' +
       'onclick="mbAskDelete(\'' + phone + '\')">刪除這位會員</button></div>';
  mbModal(h);
}

/* ══ 刪除會員 ═══════════════════════════════════════════
   ledger 是帳，客人的消費紀錄都串在上面。有紀錄或有餘額的
   會員直接砍掉，那些歷史消費就變成沒有對應的人，月報也對
   不起來。所以分兩種：
     ・完全乾淨的（沒餘額、沒紀錄）→ 可以真的刪掉
     ・有紀錄或有餘額的            → 只能封存，資料留著
   兩種都要打電話號碼確認，避免手滑。
   ═════════════════════════════════════════════════════ */
function mbAskDelete(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var sum    = mbSum(m.ledger);
  var nLog   = Object.keys(m.ledger || {}).length;
  var hasBal = (sum.points > 0 || sum.sessions > 0 || sum.bonus > 0 || sum.voucher > 0);
  var clean  = (!nLog && !hasBal);

  var h = '<h3 style="margin:0 0 2px;color:var(--red)">刪除會員</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:16px">' +
    mbEsc(m.name || '（未填姓名）') + '　' + m.phone + '</div>';

  if (hasBal){
    h += '<div class="info-box" style="border-color:var(--red);margin-bottom:14px;line-height:1.8">' +
      '<b>這位會員還有餘額：</b><br>' +
      (sum.points   > 0 ? '・可用點數 ' + sum.points.toLocaleString() + ' 點<br>' : '') +
      (sum.sessions > 0 ? '・剩餘堂數 ' + sum.sessions + ' 堂<br>' : '') +
      (sum.bonus    > 0 ? '・紅利 ' + sum.bonus + ' 點<br>' : '') +
      (sum.voucher  > 0 ? '・表框折價金 $' + sum.voucher.toLocaleString() + '<br>' : '') +
      '錢已經收了，刪掉等於帳上憑空少一筆。建議先把餘額處理完再說。</div>';
  }
  if (nLog){
    h += '<div class="info-box" style="margin-bottom:14px;line-height:1.8">' +
      '這位會員有 <b>' + nLog + '</b> 筆消費／儲值紀錄。<br>' +
      '這些是月報和業績的來源，刪掉之後<b>救不回來</b>。</div>';
  }
  if (clean){
    h += '<div class="info-box" style="margin-bottom:14px;line-height:1.8">' +
      '這筆資料完全乾淨，沒有餘額也沒有任何紀錄，可以安全刪除。<br>' +
      '常見於電話打錯或重複建檔。</div>';
  } else {
    h += '<div class="info-box" style="margin-bottom:14px;line-height:1.8">' +
      '<b>建議改用「封存」：</b>會員從名單和待辦提醒上消失，但資料和紀錄都留著，' +
      '月報不受影響，之後想找回來也還在。</div>';
  }

  h += '<div class="fg" style="margin-bottom:14px"><label>請輸入這位會員的完整電話以確認</label>' +
       '<input id="mb-del-c" inputmode="numeric" placeholder="' + m.phone + '" autocomplete="off"></div>' +
       '<div id="mb-del-err" style="color:var(--red);font-size:13.5px;margin-bottom:12px"></div>';

  h += '<div class="row" style="gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn" style="flex:1" onclick="mbDoDelete(\'' + phone + '\',0)">封存</button>' +
       (clean ? '<button class="btn" style="flex:1;color:var(--red);border-color:#EBD3D0" onclick="mbDoDelete(\'' + phone + '\',1)">永久刪除</button>' : '') +
       '</div>';
  if (!clean){
    h += '<div class="muted" style="font-size:12.5px;margin-top:12px;line-height:1.7">' +
         '有餘額或有紀錄的會員不提供永久刪除。真的要清掉，請先把餘額歸零、' +
         '確認紀錄結算過，再回來操作。</div>';
  }
  mbModal(h);
  setTimeout(function(){ var el = document.getElementById('mb-del-c'); if (el) el.focus() }, 60);
}

async function mbDoDelete(phone, hard){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var err   = document.getElementById('mb-del-err');
  var typed = (document.getElementById('mb-del-c') || {}).value || '';
  if (mbNorm(typed) !== phone){
    if (err) err.textContent = '電話號碼不符，請完整輸入 ' + phone + ' 再試一次。';
    return;
  }
  if (err) err.textContent = '處理中…';
  try {
    if (hard){
      await fetch(mbf('/members/' + phone + '.json'), { method:'DELETE' });
      /* LINE 綁定一起清掉，不然客人端還會對應到這支電話 */
      try {
        var idx = await (await fetch(mbf('/lineIndex.json'))).json() || {};
        for (var uid in idx){
          if (idx[uid] === phone) await fetch(mbf('/lineIndex/' + uid + '.json'), { method:'DELETE' });
        }
      } catch(e){}
      mbList = mbList.filter(function(x){ return x.phone !== phone });
    } else {
      var rec = { at: mbNow(), by: (typeof ME !== 'undefined' && ME ? (ME.displayName || '') : '') };
      await fetch(mbf('/members/' + phone + '/archived.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) });
      m.archived = rec;
    }
  } catch(e){
    if (err) err.textContent = '操作失敗，請檢查網路連線。';
    return;
  }
  mbClose();
  mbOpenPhone = null;
  renderMember();
}

/* 用 ledger 重算 cache，修掉對不起來的餘額 */
async function mbFixCache(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var sum = mbSum(m.ledger);
  if (!confirm('要把餘額重算成明細的加總嗎？\n\n點數 ' + sum.points + '　堂數 ' + sum.sessions + '　紅利 ' + sum.bonus)) return;
  try {
    await fetch(mbf('/members/' + phone + '/cache.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(sum) });
  } catch(e) { alert('重算失敗：' + e.message); return; }
  m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
  mbDetail(phone); mbDrawHits();
}

/* ── 新增會員 ──────────────────────────────────────────── */
function mbNewMember(){
  var h = '<h3 style="margin:0 0 2px">新增會員</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">電話是唯一識別，存進去客人打開 LINE 就查得到自己的餘額。</div>' +
    '<div class="fg"><label>手機 *</label><input id="mb-n-phone" inputmode="tel" placeholder="09xxxxxxxx"></div>' +
    '<div class="fg"><label>姓名 *</label><input id="mb-n-name" placeholder="客人的稱呼"></div>' +
    '<div class="fg"><label>備註</label><input id="mb-n-note" placeholder="選填，例：從 IG 來的"></div>' +
    '<div class="row" style="margin-top:14px;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
    '<button class="btn btn-gold" style="flex:2" id="mb-n-ok" onclick="mbSaveMember()">建立會員</button></div>';
  mbModal(h);
  setTimeout(function(){ var e = document.getElementById('mb-n-phone'); if (e) e.focus() }, 80);
}

async function mbSaveMember(){
  var phone = mbNorm(document.getElementById('mb-n-phone').value);
  var name = document.getElementById('mb-n-name').value.trim();
  var note = document.getElementById('mb-n-note').value.trim();
  if (!phone || phone.length < 8) { alert('請填正確的手機號碼'); return; }
  if (!name) { alert('請填姓名'); return; }
  if (mbList.some(function(m){ return m.phone === phone })) {
    alert('這支電話已經有會員了：' + (mbList.find(function(m){ return m.phone === phone }).name || '未填姓名'));
    return;
  }
  var btn = document.getElementById('mb-n-ok');
  if (btn) { btn.disabled = true; btn.textContent = '建立中…'; }
  var rec = { phone: phone, name: name, note: note, createdAt: mbNow(),
              cache: { points: 0, sessions: 0, bonus: 0 } };
  try {
    await fetch(mbf('/members/' + phone + '.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) });
  } catch(e) { alert('建立失敗：' + e.message); if (btn) { btn.disabled = false; btn.textContent = '建立會員' } return; }
  mbList.push({ phone: phone, name: name, note: note, points: 0, sessions: 0, bonus: 0,
                ledger: {}, createdAt: rec.createdAt });
  mbClose();
  mbQuery = phone;
  renderMember();
  setTimeout(function(){ mbSell(phone) }, 150);
}

/* ── 賣方案／加點 ──────────────────────────────────────── */
function mbSell(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var plans = mbActivePlans();
  var h = '<h3 style="margin:0 0 2px">賣方案</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' + mbEsc(m.name || '（未填姓名）') + '　' + m.phone +
    '　目前 <strong style="color:var(--gold2)">' + m.points.toLocaleString() + '</strong> 點・' + m.sessions + ' 堂</div>';

  if (!plans.length) {
    h += '<div class="info-box" style="border-color:var(--red)">還沒有建立任何方案。請先切到「方案設定」把方案建好，賣的時候才不用手打金額。</div>' +
         '<div class="row" style="margin-top:14px"><button class="btn" style="flex:1" onclick="mbClose()">關閉</button></div>';
    mbModal(h); return;
  }

  h += '<div class="fg"><label>方案 *</label><select id="mb-s-plan" onchange="mbSellPreview(\'' + phone + '\')">' +
       '<option value="">請選擇</option>' +
       plans.map(function(p, i){
         var give = [];
         if (p.points) give.push(p.points.toLocaleString() + ' 點');
         if (p.bonusPoints) give.push('送 ' + p.bonusPoints.toLocaleString());
         if (p.sessions) give.push(p.sessions + ' 堂');
         return '<option value="' + i + '">' + mbEsc(p.name) + '　$' + (+p.price || 0).toLocaleString() +
                (give.length ? '　→ ' + give.join('、') : '') + '</option>';
       }).join('') + '</select></div>';
  h += '<div class="fg"><label>付款方式</label><select id="mb-s-pay">' +
       ['現金','LINE Pay','刷卡','匯款'].map(function(w){ return '<option>' + w + '</option>' }).join('') +
       '</select></div>';
  h += '<div class="fg"><label>備註</label><input id="mb-s-note" placeholder="選填，例：生日優惠"></div>';
  h += '<div class="card" id="mb-s-prev" style="margin-top:6px"><div class="muted" style="font-size:13.5px">選了方案會顯示明細</div></div>';
  h += '<div class="row" style="margin-top:14px;gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="flex:2" id="mb-s-ok" onclick="mbSellSave(\'' + phone + '\')">確認售出</button></div>';
  mbModal(h);
}

function mbSellPreview(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  var i = document.getElementById('mb-s-plan').value;
  var box = document.getElementById('mb-s-prev');
  if (i === '' || !m) { box.innerHTML = '<div class="muted" style="font-size:13.5px">選了方案會顯示明細</div>'; return; }
  var p = mbActivePlans()[+i];
  var renew = mbIsRenewal(m);
  var giftPts = renew ? (+p.renewBonus || 0) : (+p.newBonus || 0);
  var addPts = (+p.points || 0) + (+p.bonusPoints || 0) + giftPts;
  var addSes = +p.sessions || 0, addVou = +p.voucher || 0;
  var exp = mbExpiry(p.months);

  var h = '<div style="font-size:14.5px;line-height:2">';
  h += '<span style="background:' + (renew ? 'var(--bg3)' : 'var(--gold)') + ';color:' + (renew ? 'var(--text2)' : '#000') +
       ';padding:2px 10px;border-radius:99px;font-size:12.5px;font-weight:700">' + (renew ? '續約會員' : '新客首購') + '</span>';
  h += '<br>售價 <strong>$' + (+p.price || 0).toLocaleString() + '</strong>';
  if (+p.points) h += '<br>基本點數 +' + (+p.points).toLocaleString();
  if (+p.bonusPoints) h += '<br>創作回饋 +' + (+p.bonusPoints).toLocaleString();
  if (giftPts) h += '<br>' + (renew ? '續約回饋' : '首次入會回饋') + ' <span style="color:var(--gold2)">+' + giftPts.toLocaleString() + '</span>';
  if (addSes) h += '<br>堂數 +' + addSes;
  if (addVou) h += '<br>表框折價金 +$' + addVou.toLocaleString();
  if (p.gift) h += '<br><span class="muted">好禮：' + mbEsc(p.gift) + '（現場給，系統不計點）</span>';
  if (exp) h += '<br><span class="muted">會員效期至 ' + exp + '（' + p.months + ' 個月）</span>';
  h += '<hr style="border:0;border-top:1px solid var(--border);margin:8px 0">';
  h += '售出後：<strong style="color:var(--gold2)">' + (m.points + addPts).toLocaleString() + '</strong> 點';
  if (addSes || m.sessions) h += '　<strong>' + (m.sessions + addSes) + '</strong> 堂';
  h += '</div>';
  box.innerHTML = h;
}

async function mbSellSave(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  var i = document.getElementById('mb-s-plan').value;
  if (i === '' || !m) { alert('請先選擇方案'); return; }
  var p = mbActivePlans()[+i];
  var pay = document.getElementById('mb-s-pay').value;
  var note = document.getElementById('mb-s-note').value.trim();
  var renew = mbIsRenewal(m);
  var giftPts = renew ? (+p.renewBonus || 0) : (+p.newBonus || 0);
  var addSes = +p.sessions || 0, addVou = +p.voucher || 0;
  var exp = mbExpiry(p.months);

  if (!confirm('確認售出？\n\n' + p.name + '　$' + (+p.price || 0).toLocaleString() + '（' + pay + '）\n' +
      (renew ? '身分：續約會員' : '身分：新客首購') + '\n' +
      (+p.points ? '基本點數 +' + (+p.points).toLocaleString() + '\n' : '') +
      (+p.bonusPoints ? '創作回饋 +' + (+p.bonusPoints).toLocaleString() + '\n' : '') +
      (giftPts ? (renew ? '續約回饋 +' : '首次入會回饋 +') + giftPts.toLocaleString() + '\n' : '') +
      (addSes ? '堂數 +' + addSes + '\n' : '') +
      (addVou ? '表框折價金 +$' + addVou.toLocaleString() + '\n' : '') +
      (exp ? '效期至 ' + exp + '\n' : '') +
      (p.gift ? '好禮：' + p.gift + '（記得現場給）\n' : ''))) return;

  var btn = document.getElementById('mb-s-ok');
  if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }

  var now = mbNow();
  var stamp = now.replace(/[-:.TZ]/g, '').slice(0, 14);
  var by = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) ? CURRENT_USER : 'admin';
  var reason = p.name + '（' + pay + '）' + (note ? '・' + note : '');
  var base = { at: now, by: by, planName: p.name, pay: pay };
  if (exp) base.expiry = exp;
  var writes = [];
  var mk = function(suffix, delta, type, why, extra){
    writes.push({ key: 'sell_' + stamp + '_' + suffix,
      body: Object.assign({}, base, { delta: delta, type: type, reason: why }, extra || {}) });
  };

  if (+p.points)      mk('p',  +p.points,      'points',   reason, { price: +p.price || 0 });
  if (+p.bonusPoints) mk('pb', +p.bonusPoints, 'points',   p.name + '・創作回饋');
  if (giftPts)        mk('pg', giftPts,        'points',   p.name + (renew ? '・續約回饋' : '・首次入會回饋'));
  if (addSes)         mk('s',  addSes,         'sessions', reason, { price: +p.price || 0 });
  if (addVou)         mk('v',  addVou,         'voucher',  p.name + '・表框折價金');

  if (!writes.length) { alert('這個方案沒有設定點數或堂數，請先到方案設定補上'); if (btn) { btn.disabled = false; btn.textContent = '確認售出' } return; }

  try {
    for (var w = 0; w < writes.length; w++) {
      await fetch(mbf('/members/' + phone + '/ledger/' + writes[w].key + '.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(writes[w].body) });
      m.ledger[writes[w].key] = writes[w].body;
    }
    var sum = mbSum(m.ledger);
    await fetch(mbf('/members/' + phone + '/cache.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(sum) });
    m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
  } catch(e) {
    alert('寫入失敗：' + e.message + '\n請重新確認會員餘額是否正確');
    if (btn) { btn.disabled = false; btn.textContent = '確認售出' }
    return;
  }

  /* 方案收入記進當天業績，月報看得到 */
  mbLogSale(p, pay, m);

  mbClose();
  renderMember();
  alert('已售出：' + p.name + '\n' + (m.name || m.phone) + ' 目前 ' + m.points.toLocaleString() + ' 點・' + m.sessions + ' 堂');
}

/* 把方案收入寫進 salesData，月報與當日營收讀得到 */
function mbLogSale(p, pay, m){
  try {
    if (!S.planSales) S.planSales = {};
    var d = mbToday();
    if (!S.planSales[d]) S.planSales[d] = [];
    S.planSales[d].push({ at: mbNow(), phone: m.phone, name: m.name,
      plan: p.name, price: +p.price || 0, pay: pay,
      points: (+p.points || 0) + (+p.bonusPoints || 0), sessions: +p.sessions || 0,
      voucher: +p.voucher || 0, months: +p.months || 0 });
    save();
  } catch(e) {}
}

/* ── 方案設定 ──────────────────────────────────────────── */
/* 方案表上的六個方案，按一次全部建好 */
var MB_PRESET = [
  { name:'入門創作家',   price:11000, points:11000, bonusPoints:700,  sessions:0,  months:12, newBonus:150,  renewBonus:300,  voucher:0,    gift:'', active:true },
  { name:'創意實踐家',   price:15000, points:15000, bonusPoints:1600, sessions:0,  months:15, newBonus:400,  renewBonus:800,  voucher:0,    gift:'', active:true },
  { name:'藝術探索家',   price:18000, points:18000, bonusPoints:4000, sessions:0,  months:18, newBonus:800,  renewBonus:1600, voucher:0,    gift:'', active:true },
  { name:'藝術生活家',   price:22000, points:22000, bonusPoints:5000, sessions:0,  months:20, newBonus:1200, renewBonus:2400, voucher:0,    gift:'', active:true },
  { name:'純繪畫 30 堂', price:30000, points:1000,  bonusPoints:0,    sessions:30, months:12, newBonus:0,    renewBonus:0,    voucher:1000, gift:'', active:true },
  { name:'純繪畫 70 堂', price:60000, points:3000,  bonusPoints:0,    sessions:70, months:24, newBonus:0,    renewBonus:0,    voucher:3000, gift:'專屬咖啡／茶包禮品兩組', active:true }
];

function mbImportPreset(){
  var plans = mbPlans();
  var exist = {};
  plans.forEach(function(p){ exist[p.name] = true });
  var add = MB_PRESET.filter(function(p){ return !exist[p.name] });
  if (!add.length) { alert('這六個方案都已經建好了，沒有需要新增的。'); return; }
  if (!confirm('要建立以下 ' + add.length + ' 個方案嗎？\n\n' +
      add.map(function(p){ return '・' + p.name + '　$' + p.price.toLocaleString() }).join('\n') +
      '\n\n建好後可以自己編輯，價格或回饋有調整就直接改。')) return;
  add.forEach(function(p){ plans.push(JSON.parse(JSON.stringify(p))) });
  save();
  renderMember();
  alert('已建立 ' + add.length + ' 個方案。請對照你的方案表確認一次數字，有出入直接按「編輯」修改。');
}

function mbPlansHtml(){
  var plans = mbPlans();
  var h = '';
  h += '<div class="card" style="margin-bottom:14px">' +
       '<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
       '<div class="muted" style="font-size:13.5px">建好方案，賣的時候用選的，行政不用手打金額。舊方案改成「停用」就好，不要刪除——已經賣掉的紀錄要對得回來。</div>' +
       '<div style="display:flex;gap:8px">' +
       (plans.length ? '' : '<button class="btn" onclick="mbImportPreset()">📋 匯入現有方案</button>') +
       '<button class="btn btn-gold" onclick="mbPlanEdit(-1)">＋ 新增方案</button></div></div>' +
       (plans.length ? '<div style="margin-top:10px"><button class="btn btn-outline btn-sm" onclick="mbImportPreset()">📋 補上缺少的預設方案</button></div>' : '') +
       '</div>';
  h += '<table><thead><tr><th>方案名稱</th><th style="width:80px">售價</th><th style="width:80px">點數</th>' +
       '<th style="width:80px">創作回饋</th><th style="width:60px">堂數</th><th style="width:60px">效期</th>' +
       '<th style="width:120px">新客／續約回饋</th><th style="width:70px">狀態</th><th style="width:110px"></th></tr></thead><tbody>';
  if (!plans.length) h += '<tr><td colspan="9"><div class="empty" style="padding:20px">還沒有方案，按右上角新增</div></td></tr>';
  plans.forEach(function(p, i){
    var off = p.active === false;
    h += '<tr' + (off ? ' style="opacity:.45"' : '') + '>' +
      '<td>' + mbEsc(p.name) + '</td>' +
      '<td style="text-align:right">$' + (+p.price || 0).toLocaleString() + '</td>' +
      '<td style="text-align:right">' + (p.points ? (+p.points).toLocaleString() : '—') + '</td>' +
      '<td style="text-align:right;color:var(--gold2)">' + (p.bonusPoints ? '+' + (+p.bonusPoints).toLocaleString() : '—') + '</td>' +
      '<td style="text-align:right">' + (p.sessions || '—') + (p.voucher ? '<br><span class="muted" style="font-size:12px">折價$' + (+p.voucher).toLocaleString() + '</span>' : '') + '</td>' +
      '<td style="text-align:right">' + (p.months ? p.months + '月' : '—') + '</td>' +
      '<td style="text-align:right;font-size:13.5px">' + ((p.newBonus || p.renewBonus) ? (+p.newBonus||0).toLocaleString() + ' / ' + (+p.renewBonus||0).toLocaleString() : '—') + '</td>' +
      '<td style="font-size:13.5px;color:' + (off ? 'var(--text3)' : 'var(--green)') + '">' + (off ? '已停用' : '啟用中') + '</td>' +
      '<td style="display:flex;gap:6px">' +
        '<button class="btn btn-outline btn-sm" onclick="mbPlanEdit(' + i + ')">編輯</button>' +
        '<button class="btn btn-sm" onclick="mbPlanToggle(' + i + ')">' + (off ? '啟用' : '停用') + '</button>' +
      '</td></tr>';
  });
  h += '</tbody></table>';
  h += '<div class="info-box" style="margin-top:14px">' +
       '<strong>對照你的方案表：</strong><br>' +
       '創意實踐家 → 售價 15000、基本點數 15000、創作回饋 1600、效期 15、新客回饋 400、續約回饋 800<br>' +
       '30 堂方案 → 售價 30000、堂數 30、基本點數 1000、表框折價金 1000、效期 12<br>' +
       '70 堂方案 → 售價 60000、堂數 70、基本點數 3000、表框折價金 3000、效期 24、好禮填「專屬咖啡／茶包禮品兩組」<br>' +
       '兩種堂數方案單價不同，所以各建一筆，不要設全域單價。</div>';
  return h;
}

function mbPlanEdit(idx){
  var plans = mbPlans();
  var p = idx >= 0 ? plans[idx] : { name:'', price:'', points:'', bonusPoints:'', sessions:'',
    months:'', newBonus:'', renewBonus:'', voucher:'', gift:'', active:true };
  var h = '<h3 style="margin:0 0 4px">' + (idx >= 0 ? '編輯方案' : '新增方案') + '</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">用不到的欄位留空就好，系統會自動略過。</div>' +
    '<div class="fg"><label>方案名稱 *</label><input id="mb-p-name" value="' + mbEsc(p.name) + '" placeholder="例：創意實踐家"></div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>售價 *</label><input id="mb-p-price" type="number" min="0" value="' + (p.price || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>會員效期（月）</label><input id="mb-p-months" type="number" min="0" value="' + (p.months || '') + '" placeholder="12"></div>' +
    '</div>' +
    '<div style="font-size:13.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">點數方案</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>基本點數</label><input id="mb-p-points" type="number" min="0" value="' + (p.points || '') + '" placeholder="同售價"></div>' +
      '<div class="fg" style="flex:1"><label>創作回饋點數</label><input id="mb-p-bonus" type="number" min="0" value="' + (p.bonusPoints || '') + '"></div>' +
    '</div>' +
    '<div style="font-size:13.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">堂數方案</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>堂數</label><input id="mb-p-ses" type="number" min="0" value="' + (p.sessions || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>表框折價金</label><input id="mb-p-voucher" type="number" min="0" value="' + (p.voucher || '') + '"></div>' +
    '</div>' +
    '<div style="font-size:13.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">本月好禮（擇一自動套用）</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>新客首次入會回饋</label><input id="mb-p-newb" type="number" min="0" value="' + (p.newBonus || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>會員續約回饋</label><input id="mb-p-renb" type="number" min="0" value="' + (p.renewBonus || '') + '"></div>' +
    '</div>' +
    '<div class="fg"><label>入會好禮（文字，只記錄不加點）</label><input id="mb-p-gift" value="' + mbEsc(p.gift || '') + '" placeholder="例：專屬咖啡／茶包禮品兩組"></div>' +
    '<div class="muted" style="font-size:13.5px;line-height:1.7;margin-top:6px">' +
      '賣的時候系統會自己判斷這位是新客還是續約（看有沒有買過方案），套用對應的回饋，行政不用選。</div>' +
    '<div class="row" style="margin-top:14px;gap:8px">' +
    '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
    '<button class="btn btn-gold" style="flex:2" onclick="mbPlanSave(' + idx + ')">儲存</button></div>';
  mbModal(h);
}

function mbPlanSave(idx){
  var g = function(id){ return parseInt(document.getElementById(id).value) || 0 };
  var name = document.getElementById('mb-p-name').value.trim();
  var gift = document.getElementById('mb-p-gift').value.trim();
  var price = g('mb-p-price');
  var points = g('mb-p-points'), bonus = g('mb-p-bonus'), ses = g('mb-p-ses');
  var months = g('mb-p-months'), newB = g('mb-p-newb'), renB = g('mb-p-renb'), vou = g('mb-p-voucher');
  if (!name) { alert('請填方案名稱'); return; }
  if (!price) { alert('請填售價'); return; }
  if (!points && !ses) { alert('基本點數和堂數至少要填一個，不然賣出去什麼都不會加'); return; }
  var plans = mbPlans();
  var rec = { name:name, price:price, points:points, bonusPoints:bonus, sessions:ses,
              months:months, newBonus:newB, renewBonus:renB, voucher:vou, gift:gift, active:true };
  if (idx >= 0) { rec.active = plans[idx].active !== false; plans[idx] = rec; }
  else plans.push(rec);
  save();
  mbClose(); renderMember();
}

function mbPlanToggle(idx){
  var plans = mbPlans();
  plans[idx].active = (plans[idx].active === false);
  save(); renderMember();
}

/* ── 彈窗 ──────────────────────────────────────────────── */
function mbModal(html){
  var mk = document.getElementById('mb-modal');
  if (!mk) return;
  document.getElementById('mb-modal-body').innerHTML = html;
  mk.style.display = 'block';
}
function mbClose(){
  var mk = document.getElementById('mb-modal');
  if (mk) mk.style.display = 'none';
}

/* ── 保險：自己掛上分頁事件 ─────────────────────────────
   即使 app.js 的 doSwitchTab 沒接上這一頁，點分頁一樣會渲染。 */
(function(){
  function hook(){
    document.addEventListener('click', function(e){
      var t = e.target;
      while (t && t !== document) {
        if (t.classList && t.classList.contains('tab') && t.dataset && t.dataset.tab === 'member') {
          setTimeout(function(){
            var el = document.getElementById('member-body');
            if (el && !el.innerHTML.trim()) renderMember();
          }, 50);
          return;
        }
        t = t.parentNode;
      }
    }, true);
    /* 重新整理時若停在會員分頁，也要畫出來 */
    setTimeout(function(){
      var pg = document.getElementById('tab-member');
      var el = document.getElementById('member-body');
      if (pg && pg.classList.contains('active') && el && !el.innerHTML.trim()) renderMember();
    }, 600);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', hook);
  else hook();
})();

/* ══════════════════════════════════════════════════════════
   批次匯入：把舊平台的餘額補進來

   為什麼要防重複：餘額是 ledger 加總算出來的，多寫一筆就永遠多一筆，
   不會自己修正。同一批資料貼兩次＝餘額變兩倍，而且很難查回去。
   所以每一筆的 ledger key 都由「批次名稱＋電話＋類型」算出來，
   同一批同一個人同一種餘額，key 一定一樣，第二次寫就是覆蓋不是新增。

   為什麼先預覽：寫進去容易，退出來很難。預覽會分四類——
   新增、金額相同（跳過）、金額不同（覆蓋）、找不到會員（不寫）。
   ══════════════════════════════════════════════════════════ */
var mbImpBatch = '', mbImpRaw = '', mbImpType = 'sessions', mbImpRows = null, mbImpBusy = false;
/* set＝以夯客為準，校正成那個數字；add＝在現有餘額上加。
   轉換期資料還不準，預設用校正。 */
var mbImpMode = 'set';

var MB_IMP_TYPES = [
  { k:'sessions', n:'堂數',      unit:'堂' },
  { k:'points',   n:'點數',      unit:'點' },
  { k:'bonus',    n:'紅利',      unit:'點' },
  { k:'voucher',  n:'表框折價金', unit:'元' }
];
function mbImpUnit(){
  var t = MB_IMP_TYPES.filter(function(x){ return x.k === mbImpType })[0];
  return t ? t.unit : '';
}

/* 一行一筆：電話 逗號或 Tab 或空白 數量。姓名那一欄有也沒關係，會忽略。 */
function mbImpParse(raw){
  var out = [];
  String(raw || '').split(/\r?\n/).forEach(function(line, i){
    var t = line.trim();
    if (!t) return;
    var cells = t.split(/[\t,，]|\s{2,}/).map(function(c){ return c.trim() }).filter(function(c){ return c !== '' });
    if (cells.length < 2) cells = t.split(/\s+/);
    if (cells.length < 2) { out.push({ line:i+1, raw:t, err:'這行只有一個欄位' }); return }
    /* 電話取第一個看起來像號碼的欄位，數量取最後一個純數字 */
    var phone = '', qty = null;
    cells.forEach(function(c){
      var d = c.replace(/\D/g, '');
      if (!phone && d.length >= 8) phone = mbNorm(c);
    });
    for (var j = cells.length - 1; j >= 0; j--){
      if (/^-?\d+(\.\d+)?$/.test(cells[j])) { qty = parseFloat(cells[j]); break }
    }
    if (!phone) { out.push({ line:i+1, raw:t, err:'看不出電話' }); return }
    if (qty == null) { out.push({ line:i+1, raw:t, err:'看不出數量' }); return }
    out.push({ line:i+1, raw:t, phone:phone, qty:qty });
  });
  return out;
}

/* 同一批＋同一人＋同一型別 → 固定同一個 key，重貼只會覆蓋 */
function mbImpKey(batch, type){
  var slug = String(batch).replace(/[^0-9A-Za-z\u4e00-\u9fa5]/g, '').slice(0, 24) || 'imp';
  return 'imp_' + slug + '_' + type;
}

function mbImpAnalyze(){
  var rows = mbImpParse(mbImpRaw);
  var key = mbImpKey(mbImpBatch, mbImpType);
  var seen = {};
  rows.forEach(function(r){
    if (r.err) { r.state = 'bad'; return }
    if (seen[r.phone]) { r.state = 'dup'; r.err = '同一支電話在這批出現兩次'; return }
    seen[r.phone] = true;
    var m = mbList.filter(function(x){ return x.phone === r.phone })[0];
    if (!m) { r.state = 'nomember'; r.err = '名單裡沒有這支電話'; return }
    r.name = m.name || '';
    r.now  = mbSum(m.ledger)[mbImpType] || 0;
    var prev = m.ledger && m.ledger[key];
    r.prev = prev ? (+prev.delta || 0) : null;
    if (mbImpMode === 'set') {
      /* 這批以外的紀錄加起來是多少，差額就是這次要補的。
         算出來的 delta 可能是負的——本來就比夯客多的話要扣回去。 */
      r.others = r.now - (r.prev || 0);
      r.delta  = r.qty - r.others;
      r.after  = r.qty;
      if (r.prev != null && r.prev === r.delta) { r.state = 'same'; return }
      if (r.prev == null && r.delta === 0) { r.state = 'same'; return }
      r.state = (r.prev == null) ? 'new' : 'change';
      return;
    }
    r.delta = r.qty;
    r.after = (r.now - (r.prev || 0)) + r.qty;
    if (r.prev != null && r.prev === r.qty) { r.state = 'same'; return }
    r.state = (r.prev == null) ? 'new' : 'change';
  });
  mbImpRows = rows;
  renderMember();
}

async function mbImpRun(){
  if (mbImpBusy) return;
  var rows = (mbImpRows || []).filter(function(r){ return r.state === 'new' || r.state === 'change' });
  if (!rows.length) { alert('沒有要寫入的資料'); return }
  var tn = MB_IMP_TYPES.filter(function(x){ return x.k === mbImpType })[0].n;
  if (!confirm('這批「' + mbImpBatch + '」會處理 ' + rows.length + ' 位會員的' + tn + '。\n' +
               (mbImpMode === 'set'
                 ? '模式：校正——處理完他們的' + tn + '會剛好等於你貼上的數字。\n'
                 : '模式：累加——在現有餘額上加。\n') +
               '已經處理過而且結果一樣的會跳過。\n確定要執行嗎？')) return;

  mbImpBusy = true; renderMember();
  var key = mbImpKey(mbImpBatch, mbImpType), now = mbNow();
  var by = (typeof ME !== 'undefined' && ME && ME.displayName) ? ME.displayName : 'admin';
  var okN = 0, failN = 0, failMsg = '';
  for (var i = 0; i < rows.length; i++){
    var r = rows[i], m = mbList.filter(function(x){ return x.phone === r.phone })[0];
    if (!m) continue;
    try {
      var body = { at:now, by:by, delta:r.delta, type:mbImpType,
                   reason:(mbImpMode === 'set' ? '校正為夯客餘額・' : '舊資料匯入・') + mbImpBatch,
                   batch:mbImpBatch, imported:true,
                   target:(mbImpMode === 'set' ? r.qty : undefined) };
      await fetch(mbf('/members/' + r.phone + '/ledger/' + key + '.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) });
      m.ledger[key] = body;
      var sum = mbSum(m.ledger);
      await fetch(mbf('/members/' + r.phone + '/cache.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(sum) });
      m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
      okN++;
    } catch(e){
      failN++;
      if (!failMsg) failMsg = r.phone + '：' + e.message;
    }
    if (i % 10 === 9) { var el = document.getElementById('mb-imp-prog');
      if (el) el.textContent = '寫入中… ' + (i+1) + ' / ' + rows.length; }
  }
  mbImpBusy = false;
  await mbLoad(1);
  mbImpAnalyze();
  alert('完成：成功 ' + okN + ' 筆' + (failN ? ('，失敗 ' + failN + ' 筆\n' + failMsg) : '') +
        '\n\n同一批再貼一次不會重複加，可以放心核對。');
}

/* 撤銷整批：把這批寫的 ledger 全刪掉再重算餘額 */
async function mbImpUndo(){
  if (!mbImpBatch) { alert('請先填批次名稱'); return }
  var key = mbImpKey(mbImpBatch, mbImpType);
  var hit = mbList.filter(function(m){ return m.ledger && m.ledger[key] });
  if (!hit.length) { alert('找不到這批的紀錄（批次名稱和類型要跟當初一樣）'); return }
  if (!confirm('要撤銷「' + mbImpBatch + '」這批的' +
               MB_IMP_TYPES.filter(function(x){ return x.k === mbImpType })[0].n +
               '嗎？\n會影響 ' + hit.length + ' 位會員，餘額跟著扣回去。')) return;
  mbImpBusy = true; renderMember();
  var n = 0;
  for (var i = 0; i < hit.length; i++){
    var m = hit[i];
    try {
      await fetch(mbf('/members/' + m.phone + '/ledger/' + key + '.json'), { method:'DELETE' });
      delete m.ledger[key];
      var sum = mbSum(m.ledger);
      await fetch(mbf('/members/' + m.phone + '/cache.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body:JSON.stringify(sum) });
      m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
      n++;
    } catch(e){}
  }
  mbImpBusy = false;
  await mbLoad(1); mbImpAnalyze();
  alert('已撤銷 ' + n + ' 筆');
}

function mbImpSetBatch(v){ mbImpBatch = v.trim() }
function mbImpSetType(v){ mbImpType = v; mbImpRows = null; renderMember() }

function mbImportHtml(){
  var h = mbNewBatchHtml() + mbNoteBatchHtml();
  var tn = MB_IMP_TYPES.filter(function(x){ return x.k === mbImpType })[0];

  h += '<div class="card" style="margin-bottom:16px">';
  h += '<div class="card-title">📥 批次匯入餘額</div>';
  h += '<div class="muted" style="font-size:13.5px;line-height:1.8;margin-bottom:14px">' +
       '把舊平台的堂數、點數補進來。只加餘額，不會動到會員的其他資料。<br>' +
       '同一個批次名稱貼第二次不會重複加——數字一樣的直接跳過，數字改了才覆蓋。' +
       '所以核對時可以放心重貼。</div>';

  h += '<div class="form-grid" style="margin-bottom:12px">';
  h += '<div class="fg"><label>批次名稱</label>' +
       '<input id="mb-imp-batch" placeholder="例：夯客堂數20260808" value="' + mbEsc(mbImpBatch) + '"></div>';
  h += '<div class="fg"><label>要匯入哪一種</label><select id="mb-imp-type">' +
       MB_IMP_TYPES.map(function(t){
         return '<option value="' + t.k + '"' + (mbImpType === t.k ? ' selected' : '') + '>' + t.n + '</option>' }).join('') +
       '</select></div>';
  h += '<div class="fg"><label>怎麼算</label><select id="mb-imp-mode">' +
       '<option value="set"' + (mbImpMode === 'set' ? ' selected' : '') + '>以這份資料為準（校正）</option>' +
       '<option value="add"' + (mbImpMode === 'add' ? ' selected' : '') + '>在現有餘額上加</option>' +
       '</select></div>';
  h += '</div>';
  h += '<div style="background:' + (mbImpMode === 'set' ? 'rgba(201,168,76,.08)' : 'var(--bg3)') +
       ';border-radius:9px;padding:11px 13px;font-size:13.5px;line-height:1.8;margin-bottom:12px">' +
       (mbImpMode === 'set'
         ? '<b>校正模式</b>：匯完之後，每位會員的' + tn.n + '會<b>剛好等於</b>你貼上的數字。' +
           '系統會自己算出差額補一筆，多的扣回去、少的補上來。' +
           '重跑幾次結果都一樣，適合現在資料還不準、以夯客為準的階段。<br>' +
           '<span style="color:var(--red,#c0392b)">要注意</span>：' +
           '如果有人在新系統賣過方案或核銷扣過' + tn.n + '，那些變動也會被一起抹平。' +
           '所以校正要趕在當天營業前做，不要做到一半才跑。'
         : '<b>累加模式</b>：在會員現有的' + tn.n + '上面加。' +
           '同一個批次名稱重貼不會加兩次，但底下原本就有的紀錄會留著。') +
       '</div>';
  h += '<div class="muted" style="font-size:12.5px;margin-bottom:10px;line-height:1.7">' +
       '批次名稱要能認得出是哪一批，之後要撤銷或重跑都靠它。取過的名字不要重複用在不同資料上。</div>';

  h += '<div class="fg"><label>貼上資料（一行一位：電話、' + tn.n + '）</label>' +
       '<textarea id="mb-imp-raw" rows="8" placeholder="0912345678,30&#10;0987654321,10&#10;&#10;直接從 Excel 複製兩欄貼上也可以">' +
       mbEsc(mbImpRaw) + '</textarea></div>';
  h += '<div class="muted" style="font-size:12.5px;margin:6px 0 12px;line-height:1.7">' +
       '中間用逗號、Tab 或空白隔開都可以。有姓名那一欄也沒關係，系統只認電話和數字。' +
       '電話會自動去掉 +886 和符號。</div>';

  h += '<div class="row" style="display:flex;gap:8px;flex-wrap:wrap">' +
       '<button class="btn btn-gold" onclick="mbImpGo()"' + (mbImpBusy ? ' disabled' : '') + '>檢查資料</button>' +
       '<button class="btn btn-outline btn-sm" onclick="mbImpUndo()"' + (mbImpBusy ? ' disabled' : '') + '>撤銷這一批</button>' +
       '</div>';
  h += '</div>';

  if (mbImpBusy) {
    h += '<div class="card"><div id="mb-imp-prog" style="font-size:15.5px">寫入中，請不要關掉這一頁…</div></div>';
    return h;
  }
  if (!mbImpRows) return h;

  var g = { 'new':[], change:[], same:[], nomember:[], bad:[], dup:[] };
  mbImpRows.forEach(function(r){ (g[r.state] || g.bad).push(r) });
  var willWrite = g['new'].length + g.change.length;

  h += '<div class="card" style="margin-bottom:16px">';
  h += '<div class="card-title">檢查結果</div>';
  h += '<div class="stat-grid" style="margin-bottom:14px">';
  h += '<div class="stat-card"><div class="lbl">會新增</div><div class="val">' + g['new'].length + '</div></div>';
  h += '<div class="stat-card"><div class="lbl">會覆蓋</div><div class="val">' + g.change.length + '</div></div>';
  h += '<div class="stat-card"><div class="lbl">跳過（已匯過）</div><div class="val">' + g.same.length + '</div></div>';
  h += '<div class="stat-card"><div class="lbl">有問題</div><div class="val" style="color:' +
       ((g.nomember.length + g.bad.length + g.dup.length) ? 'var(--red,#c0392b)' : 'var(--text)') + '">' +
       (g.nomember.length + g.bad.length + g.dup.length) + '</div></div>';
  h += '</div>';

  var bad = g.nomember.concat(g.bad, g.dup);
  if (bad.length) {
    h += '<div style="background:rgba(192,57,43,.06);border:1px solid rgba(192,57,43,.25);' +
         'border-radius:10px;padding:12px 14px;margin-bottom:14px">' +
         '<div style="font-size:14.5px;font-weight:600;color:var(--red,#c0392b);margin-bottom:8px">' +
         '這 ' + bad.length + ' 筆不會寫入</div>';
    bad.slice(0, 40).forEach(function(r){
      h += '<div style="font-size:13.5px;line-height:1.9">第 ' + r.line + ' 行　' +
           mbEsc(r.raw.slice(0, 40)) + '　<span class="muted">' + mbEsc(r.err) + '</span></div>';
    });
    if (bad.length > 40) h += '<div class="muted" style="font-size:13.5px">…另外還有 ' + (bad.length - 40) + ' 筆</div>';
    h += '<div class="muted" style="font-size:12.5px;margin-top:8px;line-height:1.7">' +
         '找不到電話的，多半是這位客人還沒建檔，或是電話格式不同。' +
         '可以先到會員查詢建檔，再回來重貼一次。</div>';
    h += '</div>';
  }

  if (willWrite) {
    h += '<table><thead><tr><th>電話</th><th>姓名</th><th style="width:80px">目前' + tn.n + '</th>' +
         '<th style="width:90px">' + (mbImpMode === 'set' ? '差額調整' : '這批要加') + '</th>' +
         '<th style="width:100px">' + (mbImpMode === 'set' ? '校正後' : '加完會變') + '</th></tr></thead><tbody>';
    g['new'].concat(g.change).slice(0, 300).forEach(function(r){
      var d = r.delta, sign = d > 0 ? '+' : '';
      h += '<tr><td>' + mbEsc(r.phone) + '</td><td>' + mbEsc(r.name || '—') + '</td>' +
           '<td style="text-align:right">' + r.now + '</td>' +
           '<td style="text-align:right;color:' + (d < 0 ? 'var(--red,#c0392b)' : 'var(--text2)') + '">' +
             sign + d + '</td>' +
           '<td style="text-align:right;color:var(--gold2);font-weight:600">' + r.after + ' ' + tn.unit + '</td></tr>';
    });
    h += '</tbody></table>';
    var minus = g['new'].concat(g.change).filter(function(r){ return r.delta < 0 });
    if (minus.length) h += '<div class="muted" style="font-size:13.5px;margin-top:8px;line-height:1.7">' +
      '其中 ' + minus.length + ' 位是往下扣的——他們目前的' + tn.n + '比這份資料多。' +
      '如果那是新系統剛賣出的方案，扣掉就不見了，執行前先確認。</div>';
    if (willWrite > 300) h += '<div class="muted" style="font-size:13.5px;margin-top:6px">畫面只列前 300 筆，執行時會全部寫入。</div>';
    h += '<div class="row" style="margin-top:14px">' +
         '<button class="btn btn-gold" onclick="mbImpRun()">確認寫入 ' + willWrite + ' 筆</button></div>';
  } else {
    h += '<div class="muted" style="font-size:14.5px">沒有需要寫入的資料。' +
         (g.same.length ? '這批已經匯過了，數字都一樣。' : '') + '</div>';
  }
  h += '</div>';
  return h;
}

function mbImpGo(){
  var b = document.getElementById('mb-imp-batch');
  var r = document.getElementById('mb-imp-raw');
  var t = document.getElementById('mb-imp-type');
  if (t) mbImpType = t.value;
  var md = document.getElementById('mb-imp-mode');
  if (md) mbImpMode = md.value;
  mbImpBatch = b ? b.value.trim() : '';
  mbImpRaw   = r ? r.value : '';
  if (!mbImpBatch) { alert('請先填批次名稱，之後要撤銷或重跑都靠它'); return }
  if (!mbImpRaw.trim()) { alert('請貼上資料'); return }
  mbImpAnalyze();
}
/* ══════════════════════════════════════════════════════════
   會員編輯：改資料、調餘額、展延效期、刪紀錄
   直接接在 member.js 後面（同一個檔案的尾端），共用 mbList /
   mbf / mbSum / mbModal / mbNorm / mbEsc / mbNow。

   原則跟原本一樣：餘額不直接覆寫，一律寫 ledger 再重算 cache。
   手動動的紀錄都帶 manual:true，明細頁上跟系統自動產生的分開顯示。
   ══════════════════════════════════════════════════════════ */

/* 誰能動：改資料 admin 以上，動錢 owner。沒有 can() 就全開（本機測試用） */
function mbCanEdit(){ return (typeof can === 'function') ? can('sellPlan') : true }
function mbCanMoney(){ return (typeof can === 'function') ? (can('owner') || can('sellPlan')) : true }
function mbWho(){
  if (typeof ME !== 'undefined' && ME && ME.displayName) return ME.displayName;
  if (typeof CURRENT_USER !== 'undefined' && CURRENT_USER) return CURRENT_USER;
  return 'admin';
}
function mbStamp(){ return mbNow().replace(/[-:.TZ]/g, '').slice(0, 14) }

/* ══ 1. 編輯基本資料（姓名／備註／電話）════════════════════
   電話是主鍵，改電話＝把整包資料搬到新的 key，再刪掉舊的。
   LINE 綁定也要一起搬，不然客人端 LIFF 會查不到自己。 */
function mbEditInfo(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  if (!mbCanEdit()) { alert('沒有編輯權限'); return }

  var h = '<h3 style="margin:0 0 2px">編輯會員資料</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' + m.phone + '</div>';

  h += '<div class="fg" style="margin-bottom:12px"><label>姓名</label>' +
       '<input id="mb-e-name" value="' + mbEsc(m.name || '') + '"></div>';
  h += '<div class="fg" style="margin-bottom:12px"><label>備註</label>' +
       '<input id="mb-e-note" value="' + mbEsc(m.note || '') + '"></div>';

  h += '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">' +
       '<div class="fg"><label>換手機號碼（客人換號才填，平常留空）</label>' +
       '<input id="mb-e-phone" inputmode="numeric" placeholder="留空＝不換號" autocomplete="off"></div>' +
       '<div class="muted" style="font-size:12.5px;margin-top:8px;line-height:1.7">' +
       '換號會把餘額、消費紀錄、LINE 綁定整包搬到新號碼，舊號碼從名單消失。' +
       '新號碼不能是別人已經在用的。</div></div>';

  h += '<div id="mb-e-err" style="color:var(--red);font-size:13.5px;margin:12px 0 0"></div>';
  h += '<div class="row" style="margin-top:14px;gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="flex:2" id="mb-e-ok" onclick="mbSaveInfo(\'' + phone + '\')">儲存</button></div>';
  mbModal(h);
}

async function mbSaveInfo(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var err  = document.getElementById('mb-e-err');
  var name = (document.getElementById('mb-e-name') || {}).value || '';
  var note = (document.getElementById('mb-e-note') || {}).value || '';
  var np   = mbNorm((document.getElementById('mb-e-phone') || {}).value || '');
  name = name.trim(); note = note.trim();

  if (np){
    if (np.length < 8) { err.textContent = '新手機號碼看起來不完整。'; return }
    if (np === phone)  { err.textContent = '新號碼跟原本一樣，不用換。'; return }
    if (mbList.some(function(x){ return x.phone === np })){
      var o = mbList.find(function(x){ return x.phone === np });
      err.textContent = '這支號碼已經是會員了：' + (o.name || '未填姓名') + '，請先確認是不是同一個人。';
      return;
    }
    if (!confirm('確定把 ' + phone + ' 換成 ' + np + ' 嗎？\n\n' +
                 '餘額、' + Object.keys(m.ledger || {}).length + ' 筆消費紀錄和 LINE 綁定會一起搬過去，' +
                 '舊號碼會被刪除。')) return;
  }

  var btn = document.getElementById('mb-e-ok');
  if (btn) { btn.disabled = true; btn.textContent = '儲存中…'; }

  try {
    if (!np){
      await fetch(mbf('/members/' + phone + '/name.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(name) });
      await fetch(mbf('/members/' + phone + '/note.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(note) });
      m.name = name; m.note = note;
    } else {
      /* 整包搬家：先把原始資料抓下來，改掉 phone，寫到新 key */
      var full = await (await fetch(mbf('/members/' + phone + '.json'))).json() || {};
      full.phone = np; full.name = name; full.note = note;
      full.phoneHistory = (full.phoneHistory || []).concat([
        { from: phone, to: np, at: mbNow(), by: mbWho() }
      ]);
      await fetch(mbf('/members/' + np + '.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(full) });

      /* LINE 綁定改指到新號碼 */
      try {
        var idx = await (await fetch(mbf('/lineIndex.json'))).json() || {};
        for (var uid in idx){
          if (idx[uid] === phone){
            await fetch(mbf('/lineIndex/' + uid + '.json'), { method:'PUT',
              headers:{'Content-Type':'application/json'}, body: JSON.stringify(np) });
          }
        }
      } catch(e){}

      await fetch(mbf('/members/' + phone + '.json'), { method:'DELETE' });
      m.phone = np; m.name = name; m.note = note;
      mbOpenPhone = np;
    }
  } catch(e){
    if (err) err.textContent = '儲存失敗：' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '儲存' }
    return;
  }
  mbClose();
  await mbLoad(1);
  renderMember();
}

/* ══ 2. 調整餘額 ════════════════════════════════════════
   跟紙本對不起來、核銷扣錯、匯入有落差都走這裡。
   寫成獨立一筆 ledger，原因必填，加總自動生效。 */
var MB_ADJ_TYPES = [
  { k:'points',   n:'點數',      u:'點' },
  { k:'sessions', n:'堂數',      u:'堂' },
  { k:'bonus',    n:'紅利',      u:'點' },
  { k:'voucher',  n:'表框折價金', u:'元' }
];

function mbAdjust(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  if (!mbCanMoney()) { alert('沒有調整餘額的權限'); return }
  var sum = mbSum(m.ledger);

  var h = '<h3 style="margin:0 0 2px">調整餘額</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' +
    mbEsc(m.name || '（未填姓名）') + '　' + m.phone + '</div>';

  h += '<div class="card" style="margin-bottom:14px"><div class="row" style="gap:20px;flex-wrap:wrap">' +
    '<div><div class="muted" style="font-size:13.5px">點數</div><div style="font-size:18px">' + sum.points.toLocaleString() + '</div></div>' +
    '<div><div class="muted" style="font-size:13.5px">堂數</div><div style="font-size:18px">' + sum.sessions + '</div></div>' +
    '<div><div class="muted" style="font-size:13.5px">紅利</div><div style="font-size:18px">' + sum.bonus + '</div></div>' +
    '<div><div class="muted" style="font-size:13.5px">折價金</div><div style="font-size:18px">' + sum.voucher.toLocaleString() + '</div></div>' +
    '</div></div>';

  h += '<div class="form-grid" style="margin-bottom:12px">';
  h += '<div class="fg"><label>調整哪一種</label><select id="mb-a-type" onchange="mbAdjPreview(\'' + phone + '\')">' +
       MB_ADJ_TYPES.map(function(t){ return '<option value="' + t.k + '">' + t.n + '</option>' }).join('') +
       '</select></div>';
  h += '<div class="fg"><label>怎麼填</label><select id="mb-a-mode" onchange="mbAdjPreview(\'' + phone + '\')">' +
       '<option value="delta">增減（填 -520 就是扣 520）</option>' +
       '<option value="target">改成這個數字（系統自動算差額）</option>' +
       '</select></div>';
  h += '<div class="fg"><label>數字</label>' +
       '<input id="mb-a-qty" type="number" step="0.5" placeholder="可填小數與負數" oninput="mbAdjPreview(\'' + phone + '\')"></div>';
  h += '</div>';

  h += '<div class="fg" style="margin-bottom:12px"><label>原因（必填，會留在明細上）</label>' +
       '<input id="mb-a-why" placeholder="例：與紙本核對，8/5 核銷多扣一堂"></div>';

  h += '<div id="mb-a-prev" class="info-box" style="margin-bottom:12px">填了數字會顯示結果</div>';
  h += '<div id="mb-a-err" style="color:var(--red);font-size:13.5px;margin-bottom:10px"></div>';
  h += '<div class="row" style="gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="flex:2" id="mb-a-ok" onclick="mbAdjSave(\'' + phone + '\')">確認調整</button></div>';
  mbModal(h);
}

function mbAdjCalc(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  var t = (document.getElementById('mb-a-type') || {}).value || 'points';
  var mode = (document.getElementById('mb-a-mode') || {}).value || 'delta';
  var raw = (document.getElementById('mb-a-qty') || {}).value;
  var now = mbSum(m.ledger)[t] || 0;
  if (raw === '' || raw == null || isNaN(+raw)) return null;
  var q = +raw;
  var delta = (mode === 'target') ? (q - now) : q;
  var info = MB_ADJ_TYPES.filter(function(x){ return x.k === t })[0];
  return { type:t, unit:info.u, label:info.n, now:now, delta:delta, after:now + delta };
}

function mbAdjPreview(phone){
  var box = document.getElementById('mb-a-prev');
  if (!box) return;
  var c = mbAdjCalc(phone);
  if (!c) { box.innerHTML = '填了數字會顯示結果'; return }
  if (c.delta === 0) { box.innerHTML = '數字沒有變化，不會寫入任何紀錄。'; return }
  box.innerHTML = c.label + '：<b>' + c.now.toLocaleString() + '</b> → <b style="color:var(--gold2)">' +
    c.after.toLocaleString() + '</b> ' + c.unit +
    '<br><span class="muted" style="font-size:13px">這次寫入 ' +
    (c.delta > 0 ? '+' : '') + c.delta.toLocaleString() + ' ' + c.unit + '</span>' +
    (c.after < 0 ? '<br><span style="color:var(--gold2);font-size:13px">調整後是負的——如果客人真的用超過了，這樣是對的。</span>' : '');
}

async function mbAdjSave(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var err = document.getElementById('mb-a-err');
  var c = mbAdjCalc(phone);
  if (!c) { err.textContent = '請填數字。'; return }
  if (c.delta === 0) { err.textContent = '數字沒有變化，不用調整。'; return }
  var why = ((document.getElementById('mb-a-why') || {}).value || '').trim();
  if (!why) { err.textContent = '請填原因，這筆會留在明細上給之後的人看。'; return }

  /* 金額大的多問一次，避免手滑多打一個零 */
  var big = (c.type === 'points' || c.type === 'voucher') ? 3000 : 10;
  if (Math.abs(c.delta) >= big){
    if (!confirm('這是一筆比較大的調整：\n\n' + c.label + ' ' +
                 (c.delta > 0 ? '+' : '') + c.delta.toLocaleString() + ' ' + c.unit + '\n' +
                 c.now.toLocaleString() + ' → ' + c.after.toLocaleString() + '\n\n原因：' + why +
                 '\n\n確定嗎？')) return;
  }

  var btn = document.getElementById('mb-a-ok');
  if (btn) { btn.disabled = true; btn.textContent = '寫入中…'; }

  var key = 'adj_' + mbStamp() + '_' + c.type;
  var body = { at: mbNow(), by: mbWho(), delta: c.delta, type: c.type,
               reason: why, manual: true };
  try {
    await fetch(mbf('/members/' + phone + '/ledger/' + key + '.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    m.ledger[key] = body;
    var sum = mbSum(m.ledger);
    await fetch(mbf('/members/' + phone + '/cache.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(sum) });
    m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
  } catch(e){
    if (err) err.textContent = '寫入失敗：' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '確認調整' }
    return;
  }
  mbDetail(phone);
  if (typeof mbDrawHits === 'function') mbDrawHits();
}

/* ══ 3. 展延效期 ════════════════════════════════════════
   效期寫在賣方案那筆 ledger 的 expiry 上。展延不覆蓋原本的，
   另外寫 expiryNew，並把每次展延累加在 extends 裡，看得出延過幾次。 */
function mbExtend(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  if (!mbCanEdit()) { alert('沒有展延權限'); return }

  var rows = Object.keys(m.ledger || {}).map(function(k){
    return Object.assign({ _k: k }, m.ledger[k]);
  }).filter(function(r){ return r.expiry || r.expiryNew });
  if (!rows.length){ alert('這位會員沒有帶效期的紀錄，不用展延。'); return }
  rows.sort(function(a, b){ return String(b.at || '') < String(a.at || '') ? -1 : 1 });

  var h = '<h3 style="margin:0 0 2px">展延效期</h3>' +
    '<div class="muted" style="font-size:13.5px;margin-bottom:14px">' +
    mbEsc(m.name || '（未填姓名）') + '　' + m.phone + '</div>';

  h += '<div class="fg" style="margin-bottom:12px"><label>要延哪一筆</label><select id="mb-x-key">';
  rows.forEach(function(r){
    var cur = r.expiryNew || r.expiry;
    var n = (r.extends || []).length;
    h += '<option value="' + r._k + '">' + mbEsc(r.planName || r.reason || '方案') +
         '　到期 ' + cur + (n ? '（已延 ' + n + ' 次）' : '') + '</option>';
  });
  h += '</select></div>';

  h += '<div class="form-grid" style="margin-bottom:12px">' +
       '<div class="fg"><label>延長幾個月</label><input id="mb-x-mon" type="number" min="1" step="1" value="3"></div>' +
       '<div class="fg"><label>或直接指定到期日</label><input id="mb-x-date" type="date" placeholder="填了就以這個為準"></div>' +
       '</div>';
  h += '<div class="fg" style="margin-bottom:12px"><label>原因（必填）</label>' +
       '<input id="mb-x-why" placeholder="例：客人懷孕停課三個月"></div>';
  h += '<div id="mb-x-err" style="color:var(--red);font-size:13.5px;margin-bottom:10px"></div>';
  h += '<div class="row" style="gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="flex:2" id="mb-x-ok" onclick="mbExtendSave(\'' + phone + '\')">確認展延</button></div>';
  mbModal(h);
}

async function mbExtendSave(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m) return;
  var err = document.getElementById('mb-x-err');
  var k   = (document.getElementById('mb-x-key') || {}).value;
  var mon = +((document.getElementById('mb-x-mon') || {}).value || 0);
  var fix = (document.getElementById('mb-x-date') || {}).value || '';
  var why = ((document.getElementById('mb-x-why') || {}).value || '').trim();
  var r = m.ledger[k];
  if (!r) { err.textContent = '找不到這筆紀錄。'; return }
  if (!why) { err.textContent = '請填展延原因。'; return }

  var cur = r.expiryNew || r.expiry;
  var next;
  if (fix) next = fix;
  else {
    if (!mon || mon < 1) { err.textContent = '請填要延幾個月，或直接指定到期日。'; return }
    var d = new Date(cur + 'T00:00:00');
    if (isNaN(d.getTime())) { err.textContent = '原本的到期日格式怪怪的（' + cur + '），請直接指定新日期。'; return }
    d.setMonth(d.getMonth() + mon);
    next = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  }
  if (next <= cur){ err.textContent = '新的到期日要比原本的 ' + cur + ' 晚。'; return }

  var log = (r.extends || []).concat([{ from: cur, to: next, at: mbNow(), by: mbWho(), reason: why }]);
  if (!confirm('確認展延？\n\n' + (r.planName || r.reason || '方案') + '\n' +
               cur + ' → ' + next + '\n這是第 ' + log.length + ' 次展延\n\n原因：' + why)) return;

  var btn = document.getElementById('mb-x-ok');
  if (btn) { btn.disabled = true; btn.textContent = '處理中…'; }
  try {
    await fetch(mbf('/members/' + phone + '/ledger/' + k + '/expiryNew.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(next) });
    await fetch(mbf('/members/' + phone + '/ledger/' + k + '/extends.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(log) });
    r.expiryNew = next; r.extends = log;
  } catch(e){
    if (err) err.textContent = '展延失敗：' + e.message;
    if (btn) { btn.disabled = false; btn.textContent = '確認展延' }
    return;
  }
  mbDetail(phone);
}

/* ══ 4. 刪掉單筆紀錄 ════════════════════════════════════
   誤登、重複登記用這個。刪掉之後餘額跟著變，所以要再確認一次。
   刪除本身也留一筆 log 在 members/{phone}/deletedLog。 */
async function mbDelLedger(phone, key){
  var m = mbList.find(function(x){ return x.phone === phone });
  if (!m || !m.ledger[key]) return;
  if (!mbCanMoney()) { alert('沒有刪除紀錄的權限'); return }
  var r = m.ledger[key];
  var TYPE = { points:'點數', sessions:'堂數', bonus:'紅利', voucher:'折價金' };
  var d = +r.delta || 0;
  if (!confirm('要刪掉這一筆嗎？\n\n' + (TYPE[r.type] || r.type) + ' ' + (d > 0 ? '+' : '') + d.toLocaleString() +
               '\n' + (r.reason || '') + '\n' + String(r.at || '').slice(0,16).replace('T',' ') +
               '\n\n刪掉後餘額會跟著變，這個動作不能復原。')) return;
  try {
    var log = await (await fetch(mbf('/members/' + phone + '/deletedLog.json'))).json() || [];
    log = (Array.isArray(log) ? log : []).concat([
      { key: key, body: r, deletedAt: mbNow(), deletedBy: mbWho() }
    ]);
    await fetch(mbf('/members/' + phone + '/deletedLog.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(log) });
    await fetch(mbf('/members/' + phone + '/ledger/' + key + '.json'), { method:'DELETE' });
    delete m.ledger[key];
    var sum = mbSum(m.ledger);
    await fetch(mbf('/members/' + phone + '/cache.json'), { method:'PUT',
      headers:{'Content-Type':'application/json'}, body: JSON.stringify(sum) });
    m.points = sum.points; m.sessions = sum.sessions; m.bonus = sum.bonus;
  } catch(e){ alert('刪除失敗：' + e.message); return }
  mbDetail(phone);
  if (typeof mbDrawHits === 'function') mbDrawHits();
}

/* ══════════════════════════════════════════════════════════
   批次建立會員
   批次匯入餘額只認得已經存在的會員，名單裡沒有的會被跳過。
   舊平台有 1,400 多位，系統裡只有 1,000 多位，中間的差額要
   先建起來，餘額才貼得進去。

   只建立不存在的：已經有的原封不動，姓名餘額都不碰。
   所以整份名單重貼幾次都沒關係，第二次會全部顯示「已存在」。
   ══════════════════════════════════════════════════════════ */
var mbNewRaw = '', mbNewRows = null, mbNewBusy = false;

/* 一行一筆：電話 [Tab／逗號] 姓名。姓名可以空白。
   跟餘額匯入不同——這裡第二欄是姓名不是數量，所以不抓數字。 */
function mbNewParse(raw){
  var out = [];
  String(raw || '').split(/\r?\n/).forEach(function(line, i){
    var t = line.trim();
    if (!t) return;
    var cells = t.split(/[\t,，]|\s{2,}/).map(function(c){ return c.trim() });
    var phone = mbNorm(cells[0] || '');
    /* 姓名取第二欄；如果第二欄是純數字（貼到餘額檔了）就當作沒填 */
    var name = (cells[1] || '').trim();
    if (/^-?\d+(\.\d+)?$/.test(name)) name = '';
    if (!phone || phone.length < 8){ out.push({ line:i+1, raw:t, state:'bad', err:'電話看不出來' }); return }
    out.push({ line:i+1, phone:phone, name:name });
  });
  return out;
}

function mbNewAnalyze(){
  var rows = mbNewParse(mbNewRaw), seen = {};
  rows.forEach(function(r){
    if (r.state === 'bad') return;
    if (seen[r.phone]) { r.state = 'dup'; r.err = '這批裡重複出現'; return }
    seen[r.phone] = true;
    var m = mbList.filter(function(x){ return x.phone === r.phone })[0];
    if (m) { r.state = 'exists'; r.name = m.name || r.name; return }
    r.state = 'new';
  });
  mbNewRows = rows;
  renderMember();
}

async function mbNewRun(){
  if (mbNewBusy) return;
  var rows = (mbNewRows || []).filter(function(r){ return r.state === 'new' });
  if (!rows.length) { alert('沒有要建立的會員'); return }
  if (!confirm('要建立 ' + rows.length + ' 位新會員嗎？\n\n' +
               '已經存在的不會被動到，餘額也不會有任何變化。\n' +
               '建好之後再回來貼餘額，就不會有人被跳過了。')) return;

  mbNewBusy = true; renderMember();
  var now = mbNow(), okN = 0, failN = 0, failMsg = '';
  for (var i = 0; i < rows.length; i++){
    var r = rows[i];
    var rec = { phone: r.phone, name: r.name || '', note: '', createdAt: now,
                importedMember: true,
                cache: { points: 0, sessions: 0, bonus: 0, voucher: 0 } };
    try {
      await fetch(mbf('/members/' + r.phone + '.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(rec) });
      mbList.push({ phone: r.phone, name: rec.name, note: '', points: 0, sessions: 0,
                    bonus: 0, ledger: {}, createdAt: now });
      okN++;
    } catch(e){
      failN++;
      if (!failMsg) failMsg = r.phone + '：' + e.message;
    }
    if (i % 20 === 19){
      var el = document.getElementById('mb-new-prog');
      if (el) el.textContent = '建立中… ' + (i+1) + ' / ' + rows.length;
    }
  }
  mbNewBusy = false;
  await mbLoad(1);
  mbNewAnalyze();
  alert('完成：成功 ' + okN + ' 位' + (failN ? ('，失敗 ' + failN + ' 位\n' + failMsg) : '') +
        '\n\n接下來就可以回上面貼餘額了。');
}

function mbNewGo(){
  var r = document.getElementById('mb-new-raw');
  mbNewRaw = r ? r.value : '';
  if (!mbNewRaw.trim()) { alert('請先貼上名單'); return }
  mbNewAnalyze();
}
function mbNewClear(){ mbNewRaw = ''; mbNewRows = null; renderMember() }

function mbNewBatchHtml(){
  var h = '<div class="card" style="margin-bottom:16px">';
  h += '<div class="card-title">👥 批次建立會員</div>';
  h += '<div class="muted" style="font-size:13.5px;line-height:1.8;margin-bottom:14px">' +
       '下面的餘額匯入只認得已經建檔的人，名單外的會直接跳過。' +
       '舊平台的人比系統裡多，先用這裡把缺的補起來。<br>' +
       '<b>只建立不存在的</b>——已經有的完全不動，姓名和餘額都不會被覆蓋，' +
       '所以整份名單重貼幾次結果都一樣。</div>';

  h += '<div class="fg" style="margin-bottom:10px"><label>貼上名單（一行一位：電話　姓名，姓名可留空）</label>' +
       '<textarea id="mb-new-raw" rows="6" style="width:100%;font-family:monospace;font-size:13px" ' +
       'placeholder="0912345678&#9;王小明&#10;0922333444&#9;陳美美">' + mbEsc(mbNewRaw) + '</textarea></div>';

  h += '<div class="row" style="gap:8px;margin-bottom:6px">' +
       '<button class="btn btn-gold" onclick="mbNewGo()"' + (mbNewBusy ? ' disabled' : '') + '>檢查名單</button>' +
       '<button class="btn btn-outline btn-sm" onclick="mbNewClear()">清空</button>' +
       '<span id="mb-new-prog" class="muted" style="font-size:13px;align-self:center"></span></div>';

  if (mbNewRows){
    var g = { new:[], exists:[], dup:[], bad:[] };
    mbNewRows.forEach(function(r){ (g[r.state] || g.bad).push(r) });
    h += '<div style="background:var(--bg3);border-radius:9px;padding:11px 13px;font-size:14px;line-height:1.9;margin-top:12px">' +
         '要建立 <b style="color:var(--gold2)">' + g.new.length + '</b> 位' +
         '　已經存在 <b>' + g.exists.length + '</b> 位' +
         (g.dup.length ? '　名單內重複 <b>' + g.dup.length + '</b> 筆' : '') +
         (g.bad.length ? '　<span style="color:var(--red)">看不懂 ' + g.bad.length + ' 行</span>' : '') +
         '</div>';

    if (g.bad.length){
      h += '<div class="muted" style="font-size:13px;margin-top:8px">看不懂的行：' +
           g.bad.slice(0, 8).map(function(r){ return '第 ' + r.line + ' 行' }).join('、') +
           (g.bad.length > 8 ? ' …等' : '') + '</div>';
    }

    if (g.new.length){
      h += '<div style="max-height:34vh;overflow:auto;margin-top:12px"><table><thead><tr>' +
           '<th style="width:130px">電話</th><th>姓名</th></tr></thead><tbody>';
      g.new.slice(0, 300).forEach(function(r){
        h += '<tr><td style="font-family:monospace;font-size:13px">' + r.phone + '</td>' +
             '<td style="font-size:13.5px">' + (r.name ? mbEsc(r.name) : '<span class="muted">（未填）</span>') + '</td></tr>';
      });
      h += '</tbody></table></div>';
      if (g.new.length > 300) h += '<div class="muted" style="font-size:13px;margin-top:6px">畫面只列前 300 筆，執行時會全部建立。</div>';
      h += '<div class="row" style="margin-top:14px">' +
           '<button class="btn btn-gold" onclick="mbNewRun()"' + (mbNewBusy ? ' disabled' : '') +
           '>確認建立 ' + g.new.length + ' 位</button></div>';
    } else {
      h += '<div class="muted" style="font-size:14.5px;margin-top:12px">沒有要建立的人，這份名單裡的會員都已經在系統裡了。</div>';
    }
  }
  h += '</div>';
  return h;
}

/* ══════════════════════════════════════════════════════════
   批次寫備註
   堂數在系統裡只是一個數字，看不出是哪張票來的。
   把舊平台的票券名稱、張數、到期日寫進會員備註，
   點開客人就看得到「這 17 堂是高階30堂，2027-06-30 到期」。

   備註是純文字欄位，不影響餘額計算。
   預設「接在後面」，本來就有備註的不會被蓋掉。
   ══════════════════════════════════════════════════════════ */
var mbNoteRaw = '', mbNoteRows = null, mbNoteBusy = false, mbNoteMode = 'append';

/* 一行一筆：電話 [Tab] 備註文字。備註裡可以有逗號空白，只用第一個 Tab 切。 */
function mbNoteParse(raw){
  var out = [];
  String(raw || '').split(/\r?\n/).forEach(function(line, i){
    var t = line.replace(/\s+$/, '');
    if (!t.trim()) return;
    var cut = t.indexOf('\t');
    if (cut < 0) cut = t.search(/\s{2,}/);
    if (cut < 0) { out.push({ line:i+1, state:'bad', err:'找不到電話跟備註的分隔' }); return }
    var phone = mbNorm(t.slice(0, cut));
    var note  = t.slice(cut).trim();
    if (!phone || phone.length < 8) { out.push({ line:i+1, state:'bad', err:'電話看不出來' }); return }
    if (!note) { out.push({ line:i+1, state:'bad', err:'備註是空的' }); return }
    out.push({ line:i+1, phone:phone, note:note });
  });
  return out;
}

function mbNoteAnalyze(){
  var rows = mbNoteParse(mbNoteRaw), seen = {};
  rows.forEach(function(r){
    if (r.state === 'bad') return;
    if (seen[r.phone]) { r.state = 'dup'; r.err = '這批裡重複出現'; return }
    seen[r.phone] = true;
    var m = mbList.filter(function(x){ return x.phone === r.phone })[0];
    if (!m) { r.state = 'nomember'; r.err = '名單裡沒有這支電話'; return }
    r.name = m.name || '';
    r.old  = m.note || '';
    /* 已經寫過同一段就不重複接，重貼幾次結果都一樣 */
    if (r.old.indexOf(r.note) >= 0) { r.state = 'same'; r.next = r.old; return }
    r.next = (mbNoteMode === 'replace' || !r.old) ? r.note : (r.old + '　' + r.note);
    r.state = r.old ? 'change' : 'new';
  });
  mbNoteRows = rows;
  renderMember();
}

async function mbNoteRun(){
  if (mbNoteBusy) return;
  var rows = (mbNoteRows || []).filter(function(r){ return r.state === 'new' || r.state === 'change' });
  if (!rows.length) { alert('沒有要寫入的備註'); return }
  var over = rows.filter(function(r){ return r.state === 'change' }).length;
  if (!confirm('要寫入 ' + rows.length + ' 位會員的備註嗎？\n' +
               (over ? ('其中 ' + over + ' 位本來就有備註，' +
                        (mbNoteMode === 'replace' ? '會被整段換掉。\n' : '新的會接在後面。\n')) : '') +
               '\n備註只是文字，不會影響任何餘額。')) return;

  mbNoteBusy = true; renderMember();
  var okN = 0, failN = 0, failMsg = '';
  for (var i = 0; i < rows.length; i++){
    var r = rows[i];
    try {
      await fetch(mbf('/members/' + r.phone + '/note.json'), { method:'PUT',
        headers:{'Content-Type':'application/json'}, body: JSON.stringify(r.next) });
      var m = mbList.filter(function(x){ return x.phone === r.phone })[0];
      if (m) m.note = r.next;
      okN++;
    } catch(e){
      failN++;
      if (!failMsg) failMsg = r.phone + '：' + e.message;
    }
    if (i % 10 === 9){
      var el = document.getElementById('mb-note-prog');
      if (el) el.textContent = '寫入中… ' + (i+1) + ' / ' + rows.length;
    }
  }
  mbNoteBusy = false;
  await mbLoad(1);
  mbNoteAnalyze();
  alert('完成：成功 ' + okN + ' 位' + (failN ? ('，失敗 ' + failN + ' 位\n' + failMsg) : ''));
}

function mbNoteGo(){
  var r = document.getElementById('mb-note-raw');
  var md = document.getElementById('mb-note-mode');
  if (md) mbNoteMode = md.value;
  mbNoteRaw = r ? r.value : '';
  if (!mbNoteRaw.trim()) { alert('請先貼上資料'); return }
  mbNoteAnalyze();
}
function mbNoteClear(){ mbNoteRaw = ''; mbNoteRows = null; renderMember() }

function mbNoteBatchHtml(){
  var h = '<div class="card" style="margin-bottom:16px">';
  h += '<div class="card-title">📝 批次寫備註</div>';
  h += '<div class="muted" style="font-size:13.5px;line-height:1.8;margin-bottom:14px">' +
       '堂數在系統裡只是一個數字，看不出是哪張票來的。' +
       '把票券名稱、張數、到期日寫進備註，點開客人就一目瞭然。<br>' +
       '備註是純文字，<b>不會影響任何餘額</b>。同一段文字重貼不會接兩次。</div>';

  h += '<div class="fg" style="margin-bottom:10px;max-width:280px"><label>本來就有備註的怎麼辦</label>' +
       '<select id="mb-note-mode" onchange="mbNoteGo()">' +
       '<option value="append"' + (mbNoteMode === 'append' ? ' selected' : '') + '>接在後面（保留原本的）</option>' +
       '<option value="replace"' + (mbNoteMode === 'replace' ? ' selected' : '') + '>整段換掉</option>' +
       '</select></div>';

  h += '<div class="fg" style="margin-bottom:10px"><label>貼上資料（一行一位：電話　備註文字）</label>' +
       '<textarea id="mb-note-raw" rows="6" style="width:100%;font-family:monospace;font-size:13px" ' +
       'placeholder="0912345678&#9;夯客票券：高階30堂 28(到期2027-07-22)">' + mbEsc(mbNoteRaw) + '</textarea></div>';

  h += '<div class="row" style="gap:8px;margin-bottom:6px">' +
       '<button class="btn btn-gold" onclick="mbNoteGo()"' + (mbNoteBusy ? ' disabled' : '') + '>檢查資料</button>' +
       '<button class="btn btn-outline btn-sm" onclick="mbNoteClear()">清空</button>' +
       '<span id="mb-note-prog" class="muted" style="font-size:13px;align-self:center"></span></div>';

  if (mbNoteRows){
    var g = { new:[], change:[], same:[], nomember:[], dup:[], bad:[] };
    mbNoteRows.forEach(function(r){ (g[r.state] || g.bad).push(r) });
    var will = g.new.length + g.change.length;
    h += '<div style="background:var(--bg3);border-radius:9px;padding:11px 13px;font-size:14px;line-height:1.9;margin-top:12px">' +
         '會寫入 <b style="color:var(--gold2)">' + will + '</b> 位' +
         (g.change.length ? '（其中 ' + g.change.length + ' 位本來就有備註）' : '') +
         (g.same.length ? '　已經寫過 <b>' + g.same.length + '</b> 位' : '') +
         (g.nomember.length ? '　<span style="color:var(--red)">查無此人 ' + g.nomember.length + ' 位</span>' : '') +
         (g.dup.length ? '　重複 ' + g.dup.length + ' 筆' : '') +
         (g.bad.length ? '　<span style="color:var(--red)">看不懂 ' + g.bad.length + ' 行</span>' : '') +
         '</div>';

    if (will){
      h += '<div style="max-height:34vh;overflow:auto;margin-top:12px"><table><thead><tr>' +
           '<th style="width:120px">電話</th><th style="width:110px">姓名</th><th>備註會變成</th>' +
           '</tr></thead><tbody>';
      g.new.concat(g.change).slice(0, 300).forEach(function(r){
        h += '<tr><td style="font-family:monospace;font-size:13px">' + r.phone + '</td>' +
             '<td style="font-size:13.5px">' + (r.name ? mbEsc(r.name) : '<span class="muted">（未填）</span>') + '</td>' +
             '<td style="font-size:13px;line-height:1.7">' + mbEsc(r.next) + '</td></tr>';
      });
      h += '</tbody></table></div>';
      h += '<div class="row" style="margin-top:14px">' +
           '<button class="btn btn-gold" onclick="mbNoteRun()"' + (mbNoteBusy ? ' disabled' : '') +
           '>確認寫入 ' + will + ' 位</button></div>';
    } else {
      h += '<div class="muted" style="font-size:14.5px;margin-top:12px">沒有要寫入的備註。' +
           (g.same.length ? '這批已經寫過了。' : '') + '</div>';
    }
  }
  h += '</div>';
  return h;
}
