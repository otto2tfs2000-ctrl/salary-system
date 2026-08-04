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
               ledger: m.ledger || {}, createdAt: m.createdAt || '' };
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

/* ══ 畫面 ══════════════════════════════════════════════ */
async function renderMember(){
  var el = document.getElementById('member-body');
  if (!el) return;
  if (!mbList) { el.innerHTML = '<div class="empty">載入會員資料中…</div>'; await mbLoad(); }

  var h = '';
  h += '<div class="store-tabs" style="margin-bottom:14px">' +
       '<button class="store-btn' + (mbTab === 'members' ? ' active' : '') + '" onclick="mbSwitch(\'members\')">會員查詢</button>' +
       '<button class="store-btn' + (mbTab === 'plans' ? ' active' : '') + '" onclick="mbSwitch(\'plans\')">方案設定</button>' +
       '</div>';
  h += (mbTab === 'plans') ? mbPlansHtml() : mbMembersHtml();
  el.innerHTML = h;

  var sb = document.getElementById('mb-search');
  if (sb) { sb.oninput = function(){ mbQuery = this.value; mbDrawHits(); }; }
  mbDrawHits();
}

function mbSwitch(t){ mbTab = t; mbOpenPhone = null; renderMember(); }

/* ── 會員查詢 ──────────────────────────────────────────── */
function mbMembersHtml(){
  var total = mbList ? mbList.length : 0;
  var withPts = mbList ? mbList.filter(function(m){ return m.points > 0 || m.sessions > 0 }).length : 0;
  var h = '';
  h += '<div class="card" style="margin-bottom:14px"><div class="row" style="gap:20px;flex-wrap:wrap">' +
       '<div><div class="muted" style="font-size:12px">會員總數</div><div style="font-size:20px;color:var(--gold2)">' + total + '</div></div>' +
       '<div><div class="muted" style="font-size:12px">有餘額</div><div style="font-size:20px;color:var(--gold2)">' + withPts + '</div></div>' +
       '<div style="margin-left:auto;display:flex;gap:8px;align-items:center">' +
       '<button class="btn btn-outline btn-sm" onclick="mbLoad(1).then(renderMember)">重新讀取</button>' +
       '<button class="btn btn-gold" onclick="mbNewMember()">＋ 新增會員</button>' +
       '</div></div></div>';
  h += '<div class="card">' +
       '<div class="card-title">🔍 找會員</div>' +
       '<input id="mb-search" placeholder="輸入電話或姓名（兩個字以上）" value="' + mbEsc(mbQuery) + '" ' +
       'style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:8px;font-size:15px;outline:none;font-family:inherit">' +
       '<div id="mb-hits" style="margin-top:10px"></div>' +
       '</div>';
  return h;
}

function mbDrawHits(){
  var box = document.getElementById('mb-hits');
  if (!box) return;
  if (!mbQuery || mbQuery.trim().length < 2) {
    box.innerHTML = '<div class="muted" style="font-size:12.5px;padding:8px 2px">打電話或姓名開始搜尋。電話至少 3 碼，姓名至少 2 個字。</div>';
    return;
  }
  var r = mbFind(mbQuery);
  if (!r.length) {
    box.innerHTML = '<div class="muted" style="font-size:12.5px;padding:8px 2px">查無此人。' +
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
        '<button class="btn btn-sm btn-gold" onclick="mbSell(\'' + m.phone + '\')">賣方案</button>' +
      '</td></tr>';
  });
  h += '</tbody></table>';
  if (r.length >= 20) h += '<div class="muted" style="font-size:12px;margin-top:6px">只顯示前 20 筆，請再輸入詳細一點</div>';
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
    '<div class="muted" style="font-size:12.5px;margin-bottom:14px">' + m.phone + (m.note ? '　' + mbEsc(m.note) : '') + '</div>';

  h += '<div class="card" style="margin-bottom:14px"><div class="row" style="gap:20px;flex-wrap:wrap">' +
    '<div><div class="muted" style="font-size:12px">可用點數</div><div style="font-size:20px;color:var(--gold2)">' + sum.points.toLocaleString() + '</div></div>' +
    '<div><div class="muted" style="font-size:12px">堂數</div><div style="font-size:20px">' + sum.sessions + '</div></div>' +
    '<div><div class="muted" style="font-size:12px">紅利</div><div style="font-size:20px">' + sum.bonus + '</div></div>' +
    (sum.voucher ? '<div><div class="muted" style="font-size:12px">表框折價金</div><div style="font-size:20px">$' + sum.voucher.toLocaleString() + '</div></div>' : '') +
    '</div>';
  if (sum.points !== m.points || sum.sessions !== m.sessions || sum.bonus !== m.bonus) {
    h += '<div class="info-box" style="margin-top:10px;border-color:var(--red)">' +
      '⚠ 明細加總與系統顯示的餘額不同（顯示 ' + m.points + ' 點／明細 ' + sum.points + ' 點）。' +
      '<button class="btn btn-sm" style="margin-left:8px" onclick="mbFixCache(\'' + phone + '\')">用明細重算</button></div>';
  }
  h += '</div>';

  h += '<div style="max-height:46vh;overflow:auto"><table><thead><tr>' +
       '<th style="width:120px">時間</th><th style="width:60px">類型</th><th style="width:80px">增減</th><th>原因</th><th style="width:70px">經手</th>' +
       '</tr></thead><tbody>';
  if (!rows.length) h += '<tr><td colspan="5"><div class="empty" style="padding:16px">還沒有任何紀錄</div></td></tr>';
  rows.forEach(function(r){
    var d = +r.delta || 0;
    h += '<tr>' +
      '<td class="muted" style="font-size:11.5px">' + String(r.at || '').slice(0, 16).replace('T', ' ') + '</td>' +
      '<td style="font-size:12px">' + (TYPE[r.type] || r.type || '—') + '</td>' +
      '<td style="text-align:right;font-weight:600;color:' + (d >= 0 ? 'var(--green)' : 'var(--red)') + '">' + (d > 0 ? '+' : '') + d.toLocaleString() + '</td>' +
      '<td style="font-size:12.5px">' + mbEsc(r.reason || '') +
        (r.expiry ? '<br><span class="muted" style="font-size:11px">效期至 ' + r.expiry + '</span>' : '') + '</td>' +
      '<td class="muted" style="font-size:11.5px">' + mbEsc(r.by || '') + '</td>' +
      '</tr>';
  });
  h += '</tbody></table></div>';
  h += '<div class="row" style="margin-top:14px;gap:8px">' +
       '<button class="btn btn-gold" style="flex:1" onclick="mbSell(\'' + phone + '\')">賣方案／加點</button>' +
       '<button class="btn" style="flex:1" onclick="mbClose()">關閉</button></div>';
  mbModal(h);
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
    '<div class="muted" style="font-size:12.5px;margin-bottom:14px">電話是唯一識別，存進去客人打開 LINE 就查得到自己的餘額。</div>' +
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
    '<div class="muted" style="font-size:12.5px;margin-bottom:14px">' + mbEsc(m.name || '（未填姓名）') + '　' + m.phone +
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
  h += '<div class="card" id="mb-s-prev" style="margin-top:6px"><div class="muted" style="font-size:12.5px">選了方案會顯示明細</div></div>';
  h += '<div class="row" style="margin-top:14px;gap:8px">' +
       '<button class="btn" style="flex:1" onclick="mbClose()">取消</button>' +
       '<button class="btn btn-gold" style="flex:2" id="mb-s-ok" onclick="mbSellSave(\'' + phone + '\')">確認售出</button></div>';
  mbModal(h);
}

function mbSellPreview(phone){
  var m = mbList.find(function(x){ return x.phone === phone });
  var i = document.getElementById('mb-s-plan').value;
  var box = document.getElementById('mb-s-prev');
  if (i === '' || !m) { box.innerHTML = '<div class="muted" style="font-size:12.5px">選了方案會顯示明細</div>'; return; }
  var p = mbActivePlans()[+i];
  var renew = mbIsRenewal(m);
  var giftPts = renew ? (+p.renewBonus || 0) : (+p.newBonus || 0);
  var addPts = (+p.points || 0) + (+p.bonusPoints || 0) + giftPts;
  var addSes = +p.sessions || 0, addVou = +p.voucher || 0;
  var exp = mbExpiry(p.months);

  var h = '<div style="font-size:13px;line-height:2">';
  h += '<span style="background:' + (renew ? 'var(--bg3)' : 'var(--gold)') + ';color:' + (renew ? 'var(--text2)' : '#000') +
       ';padding:2px 10px;border-radius:99px;font-size:11.5px;font-weight:700">' + (renew ? '續約會員' : '新客首購') + '</span>';
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
function mbPlansHtml(){
  var plans = mbPlans();
  var h = '';
  h += '<div class="card" style="margin-bottom:14px">' +
       '<div class="row" style="justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">' +
       '<div class="muted" style="font-size:12.5px">建好方案，賣的時候用選的，行政不用手打金額。舊方案改成「停用」就好，不要刪除——已經賣掉的紀錄要對得回來。</div>' +
       '<button class="btn btn-gold" onclick="mbPlanEdit(-1)">＋ 新增方案</button></div></div>';
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
      '<td style="text-align:right">' + (p.sessions || '—') + (p.voucher ? '<br><span class="muted" style="font-size:10.5px">折價$' + (+p.voucher).toLocaleString() + '</span>' : '') + '</td>' +
      '<td style="text-align:right">' + (p.months ? p.months + '月' : '—') + '</td>' +
      '<td style="text-align:right;font-size:12px">' + ((p.newBonus || p.renewBonus) ? (+p.newBonus||0).toLocaleString() + ' / ' + (+p.renewBonus||0).toLocaleString() : '—') + '</td>' +
      '<td style="font-size:12px;color:' + (off ? 'var(--text3)' : 'var(--green)') + '">' + (off ? '已停用' : '啟用中') + '</td>' +
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
    '<div class="muted" style="font-size:12px;margin-bottom:14px">用不到的欄位留空就好，系統會自動略過。</div>' +
    '<div class="fg"><label>方案名稱 *</label><input id="mb-p-name" value="' + mbEsc(p.name) + '" placeholder="例：創意實踐家"></div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>售價 *</label><input id="mb-p-price" type="number" min="0" value="' + (p.price || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>會員效期（月）</label><input id="mb-p-months" type="number" min="0" value="' + (p.months || '') + '" placeholder="12"></div>' +
    '</div>' +
    '<div style="font-size:12.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">點數方案</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>基本點數</label><input id="mb-p-points" type="number" min="0" value="' + (p.points || '') + '" placeholder="同售價"></div>' +
      '<div class="fg" style="flex:1"><label>創作回饋點數</label><input id="mb-p-bonus" type="number" min="0" value="' + (p.bonusPoints || '') + '"></div>' +
    '</div>' +
    '<div style="font-size:12.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">堂數方案</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>堂數</label><input id="mb-p-ses" type="number" min="0" value="' + (p.sessions || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>表框折價金</label><input id="mb-p-voucher" type="number" min="0" value="' + (p.voucher || '') + '"></div>' +
    '</div>' +
    '<div style="font-size:12.5px;color:var(--gold2);font-weight:600;margin:14px 0 8px">本月好禮（擇一自動套用）</div>' +
    '<div class="row" style="gap:10px">' +
      '<div class="fg" style="flex:1"><label>新客首次入會回饋</label><input id="mb-p-newb" type="number" min="0" value="' + (p.newBonus || '') + '"></div>' +
      '<div class="fg" style="flex:1"><label>會員續約回饋</label><input id="mb-p-renb" type="number" min="0" value="' + (p.renewBonus || '') + '"></div>' +
    '</div>' +
    '<div class="fg"><label>入會好禮（文字，只記錄不加點）</label><input id="mb-p-gift" value="' + mbEsc(p.gift || '') + '" placeholder="例：專屬咖啡／茶包禮品兩組"></div>' +
    '<div class="muted" style="font-size:12px;line-height:1.7;margin-top:6px">' +
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
