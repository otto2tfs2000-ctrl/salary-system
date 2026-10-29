/* ══════════════════════════════════════════════════════════
   🏫 包班（2026-10-29）
   接了學校、公司、社團的包班，日期、地點、對接人、金額、發票都記在這裡，不然常常忘記。
   資料在 otto2-2026 的 groupClasses/{id}，一筆一筆存（不放進 S 整包，避免舊分頁整包蓋掉）。
   會出現在：這一頁、今日排課當天最上面（booking.js 呼叫 bbDayHtml）、早安簡報（ai-post-loop 讀同一包）。
   內場包班「已確認」後，勾的時段會自動關閉線上預約（booking.js 的 bkBbApi，跟「關閉預約」同一套）；
   取消、改日期、改外派、取消勾選時，包班自己關的時段會還原。本來就關著的時段不算包班關的，不會替別人打開。
   locked 記「這筆包班實際關掉的」日期|時段，例如 "2026/11/05|10:00-12:00"。
   ══════════════════════════════════════════════════════════ */
var BB_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app';
var BB_STATUS = { talk:'洽談中', ok:'已確認', done:'已上完', cancel:'取消' };
var BB_WD = ['日','一','二','三','四','五','六'];
var bbData = null, bbEdit = null, bbBusy = false, bbLoadedAt = 0;

function bbEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] }) }
function bbToday(){ return new Date(Date.now() + 288e5).toISOString().slice(0, 10) }
function bbSlash(d){ return String(d || '').replace(/-/g, '/') }
function bbMd(d){ return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) + '（' + BB_WD[new Date(d + 'T00:00:00').getDay()] + '）' : '' }
function bbDaysTo(d){ return Math.round((Date.parse(d + 'T00:00:00') - Date.parse(bbToday() + 'T00:00:00')) / 864e5) }
function bbNum(v){ var n = parseFloat(String(v == null ? '' : v).replace(/,/g, '')); return isFinite(n) ? n : 0 }
function bbMoney(v){ return '$' + Math.round(bbNum(v)).toLocaleString('en-US') }
function bbArr(x){ return Array.isArray(x) ? x : [] }   // Firebase 不存空陣列，讀回來可能整欄不見
function bbBy(){
  try { var m = window.ME || {}; return (m.staff && (m.staff.name || m.staff.displayName)) || m.displayName || '' } catch (e) { return '' }
}
function bbPpl(r){ return bbNum(r.adults) + bbNum(r.kids) }
function bbUnpaid(r){ return Math.max(0, bbNum(r.total) - bbNum(r.paid)) }
function bbList(){ return Object.keys(bbData || {}).map(function(k){ return bbData[k] }).filter(Boolean) }

async function bbLoad(){
  var r = await fetch(BB_URL + '/groupClasses.json');
  if (!r.ok) throw new Error('HTTP ' + r.status);
  var j = await r.json() || {};
  Object.keys(j).forEach(function(k){ if (j[k]) j[k].id = k });
  bbData = j; bbLoadedAt = Date.now();
}
async function bbPut(rec){
  var o = JSON.parse(JSON.stringify(rec)); delete o._new;
  var r = await fetch(BB_URL + '/groupClasses/' + rec.id + '.json', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(o) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  bbData[rec.id] = o;
}

/* ── 擋名額 ── */
function bbWants(r){ return r && r.venue === 'in' && (r.status === 'ok' || r.status === 'done') && r.date && r.date >= bbToday() }
function bbWantKeys(r){ return bbWants(r) ? bbArr(r.blockSlots).map(function(sl){ return bbSlash(r.date) + '|' + sl }) : [] }
/* 今日排課用：這個時段是不是哪一筆包班擋的 */
function bbSlotOwner(dateStr, sl){
  var key = dateStr + '|' + sl;
  return bbList().filter(function(r){ return r.status !== 'cancel' && bbArr(r.locked).indexOf(key) >= 0 })[0] || null;
}
function bbHm(t){ var m = String(t || '').match(/(\d{1,2}):(\d{2})/); return m ? (+m[1]) * 60 + (+m[2]) : null }
/* 包班時間跟哪些表定時段重疊 → 預設勾這些 */
function bbOverlap(slots, start, end){
  var a = bbHm(start), b = bbHm(end); if (a == null || b == null || b <= a) return [];
  return slots.filter(function(sl){ var p = sl.split('-'); return a < bbHm(p[1]) && b > bbHm(p[0]) });
}
/* 照這筆現在的設定，把該關的關、該開的開。回傳要給人看的訊息 */
async function bbSyncLock(rec){
  var api = window.bkBbApi; if (!api) return [];
  var want = bbWantKeys(rec), had = bbArr(rec.locked), keep = [], msgs = [];
  for (var i = 0; i < had.length; i++){
    var k = had[i];
    if (want.indexOf(k) >= 0){ keep.push(k); continue }
    var p = k.split('|');
    if (p[0] < bbSlash(bbToday())) continue;   // 過去的日子不用還原
    /* 別的包班也要這個時段 → 交給它，不要打開 */
    var other = bbList().filter(function(o){ return o.id !== rec.id && bbWantKeys(o).indexOf(k) >= 0 })[0];
    if (other){
      other.locked = bbArr(other.locked).concat([k]);
      try { await bbPut(other) } catch (e) {}
      continue;
    }
    if (await api.reopen(p[0], p[1])) msgs.push('已重新開放 ' + p[0] + ' ' + p[1] + ' 線上預約');
    else { keep.push(k); msgs.push('⚠️ ' + p[0] + ' ' + p[1] + ' 重新開放失敗，請到今日排課手動按「重新開放」') }
  }
  for (var j = 0; j < want.length; j++){
    if (keep.indexOf(want[j]) >= 0) continue;
    var q = want[j].split('|'), res = await api.close(q[0], q[1]);
    if (res === 'closed'){ keep.push(want[j]); msgs.push('已關閉 ' + q[0] + ' ' + q[1] + ' 線上預約') }
    else if (res === 'already'){
      /* 另一筆包班已經擋了＝一樣算有擋；不是包班擋的（行政手動關的）就不記，之後不替別人打開 */
      if (!bbSlotOwner(q[0], q[1])) msgs.push(q[0] + ' ' + q[1] + ' 本來就關閉預約了');
    }
    else msgs.push('⚠️ ' + q[0] + ' ' + q[1] + ' 關閉預約失敗，請到今日排課手動按「關閉預約」');
  }
  rec.locked = keep;
  return msgs;
}

/* ── 頁面 ── */
async function renderBaoban(){
  var el = document.getElementById('bbRoot'); if (!el) return;
  if (!bbData || Date.now() - bbLoadedAt > 60000){
    if (!bbData) el.innerHTML = '<div class="empty">載入包班中…</div>';
    try { await bbLoad() } catch (e) { if (!bbData){ el.innerHTML = '<div class="empty">讀不到包班資料：' + bbEsc(e.message) + '</div>'; return } }
  }
  el.innerHTML = bbEdit ? bbFormHtml() : bbListHtml();
  if (bbEdit) bbBindForm();
}

function bbFlags(r){
  var f = [], dt = r.date ? bbDaysTo(r.date) : null;
  if (r.status === 'cancel') return f;
  if (r.finalBy && !r.finalDone && r.finalBy <= bbToday() && dt != null && dt >= 0) f.push(['b-red', '要確認最終人數']);
  if (dt != null && dt >= 0 && dt <= 3 && !r.prepMat) f.push(['b-red', '還沒備料']);
  if (dt != null && dt < 0 || r.status === 'done'){
    if (bbUnpaid(r) > 0) f.push(['b-red', '還有 ' + bbMoney(bbUnpaid(r)) + ' 沒收']);
    if (r.invNeed !== false && !r.invDone) f.push(['b-red', '發票還沒開']);
  } else if (r.payDue && r.payDue < bbToday() && bbUnpaid(r) > 0) f.push(['b-red', '過付款期限']);
  return f;
}
function bbCardHtml(r){
  var dt = r.date ? bbDaysTo(r.date) : null;
  var when = r.date ? bbMd(r.date) + (r.start ? ' ' + bbEsc(r.start) + (r.end ? '–' + bbEsc(r.end) : '') : '') : '日期未定';
  var tagSt = '<span class="badge ' + (r.status === 'ok' ? 'b-green' : r.status === 'cancel' ? 'b-gray' : 'b-gold') + '">' + (BB_STATUS[r.status] || '洽談中') + '</span>';
  var soon = dt == null || r.status === 'cancel' ? '' : dt === 0 ? '<b style="color:var(--red2)">今天</b>' : dt === 1 ? '<b style="color:var(--red2)">明天</b>' : dt > 0 ? '還有 ' + dt + ' 天' : '';
  var locked = bbArr(r.locked).filter(function(k){ return k.indexOf(bbSlash(r.date) + '|') === 0 }).map(function(k){ return k.split('|')[1] });
  return '<div class="bb-card" onclick="bbOpen(\'' + bbEsc(r.id) + '\')">' +
    '<div class="bb-when">' + when + (soon ? '<span class="bb-soon">' + soon + '</span>' : '') + '</div>' +
    '<div class="bb-org">' + bbEsc(r.org || '（未填單位）') + ' ' + tagSt +
      ' <span class="badge b-gray">' + (r.venue === 'out' ? '外派' : '內場') + '</span>' +
      (r.sessionTotal > 1 ? ' <span class="badge b-gray">第 ' + bbEsc(r.sessionNo || 1) + '／' + bbEsc(r.sessionTotal) + ' 堂</span>' : '') + '</div>' +
    '<div class="bb-sub">' + [bbPpl(r) ? bbPpl(r) + ' 人' : '', r.course, r.teacher ? '老師 ' + r.teacher : '', r.venue === 'out' ? r.place : '', bbNum(r.total) ? bbMoney(r.total) : '']
      .filter(Boolean).map(bbEsc).join('・') + '</div>' +
    (locked.length ? '<div class="bb-sub">🔒 已擋線上預約：' + bbEsc(locked.join('、')) + '</div>' : '') +
    (bbFlags(r).length ? '<div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap">' + bbFlags(r).map(function(f){ return '<span class="badge ' + f[0] + '">' + bbEsc(f[1]) + '</span>' }).join('') + '</div>' : '') +
    '</div>';
}
function bbListHtml(){
  var all = bbList(), t = bbToday();
  var up = all.filter(function(r){ return r.status !== 'cancel' && (!r.date || r.date >= t) })
    .sort(function(a, b){ return String(a.date || '9999').localeCompare(String(b.date || '9999')) || String(a.start || '').localeCompare(String(b.start || '')) });
  var past = all.filter(function(r){ return up.indexOf(r) < 0 }).sort(function(a, b){ return String(b.date || '').localeCompare(String(a.date || '')) });
  var todo = past.filter(function(r){ return bbFlags(r).length });
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">包班' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="bbData=null;renderBaoban()">↻ 重新讀取</button>' +
    '<button class="btn btn-gold btn-sm" onclick="bbNew()">＋ 新增包班</button></div>' +
    '<div class="hint" style="margin-bottom:12px">接到包班就先建一筆，日期、單位、人數、地點填了就能存，其他之後再補。' +
    '內場包班改成「已確認」後，勾選的時段會自動關閉客人線上預約。當天會出現在今日排課最上面，早安簡報也會提前提醒。</div>';
  h += '<div class="sec-label">接下來的包班（' + up.length + '）</div>';
  h += up.length ? up.map(bbCardHtml).join('') : '<div class="empty" style="padding:24px">目前沒有排定的包班</div>';
  if (todo.length) h += '<div class="sec-label" style="margin-top:18px;color:var(--red2)">上完了還有事沒做完（' + todo.length + '）</div>' + todo.map(bbCardHtml).join('');
  var rest = past.filter(function(r){ return todo.indexOf(r) < 0 });
  if (rest.length) h += '<details class="tools-box"><summary><span class="t">過去和取消的包班（' + rest.length + '）</span></summary><div style="padding:0 14px 14px">' + rest.map(bbCardHtml).join('') + '</div></details>';
  return h + '</div>';
}

/* ── 表單 ── */
function bbNewRec(o){
  return Object.assign({ id:'bb' + Date.now().toString(36), _new:true, status:'talk', venue:'in', date:'', start:'', end:'', sessionNo:1, sessionTotal:1,
    org:'', contact:'', phone:'', contactLine:'', contactEmail:'', siteContact:'', sitePhone:'',
    place:'', address:'', parking:'', equip:'',
    adults:'', kids:'', ages:'', finalBy:'', finalDone:false,
    course:'', size:'', pieces:'', materials:'', special:'',
    teacher:'', assistants:'', teacherFee:'', travelFee:'',
    pricePer:'', total:'', taxIncl:true, paid:'', payWay:'', payDue:'', payNote:'',
    invNeed:true, invDone:false, invTitle:'', taxId:'', invNo:'', invDate:'', invEmail:'', receiptNote:'',
    prepMat:false, prepPack:false, prepCar:false, links:'',
    photoDone:false, feedback:'', revisit:'', note:'', blockSlots:[], locked:[] }, o || {});
}
/* 今日排課的「🏫 包班」按鈕會帶當天日期過來 */
function bbNew(date){
  bbEdit = bbNewRec(date ? { date:date } : null);
  if (!document.getElementById('tab-baoban').classList.contains('active')) doSwitchTab('baoban'); else renderBaoban();
  window.scrollTo(0, 0);
}
function bbOpen(id){
  if (!bbData || !bbData[id]) return;
  bbEdit = bbNewRec(JSON.parse(JSON.stringify(bbData[id]))); delete bbEdit._new;
  if (window.doSwitchTab && !document.getElementById('tab-baoban').classList.contains('active')) doSwitchTab('baoban');
  else renderBaoban();
  window.scrollTo(0, 0);
}
/* 團班報價按「轉成包班」 */
function bbFromQuote(q){
  bbEdit = bbNewRec({ venue:q.venue === 'out' ? 'out' : 'in', adults:q.n || '', course:q.course || '', pricePer:q.per ? Math.round(q.per) : '',
    total:q.total ? Math.round(q.total) : '', note:q.note || '' });
  doSwitchTab('baoban'); window.scrollTo(0, 0);
}

function bbF(key, label, o){
  o = o || {}; var v = bbEdit[key], ty = o.type || 'text';
  var inp = ty === 'area' ? '<textarea id="bb-' + key + '" rows="' + (o.rows || 2) + '" placeholder="' + bbEsc(o.ph || '') + '">' + bbEsc(v) + '</textarea>'
    : '<input id="bb-' + key + '" type="' + ty + '"' + (o.num ? ' inputmode="numeric"' : '') + ' value="' + bbEsc(v) + '" placeholder="' + bbEsc(o.ph || '') + '">';
  return '<div class="fg' + (o.wide ? ' bb-wide' : '') + '"><label>' + label + '</label>' + inp + '</div>';
}
function bbChk(key, label){ return '<label class="bb-chk"><input type="checkbox" id="bb-' + key + '"' + (bbEdit[key] ? ' checked' : '') + '> ' + label + '</label>' }
function bbSec(title, body, open){ return '<details class="tools-box"' + (open ? ' open' : '') + '><summary><span class="t">' + title + '</span></summary><div class="bb-sec">' + body + '</div></details>' }
function bbFormHtml(){
  var e = bbEdit;
  var st = Object.keys(BB_STATUS).map(function(k){ return '<button type="button" class="store-btn' + (e.status === k ? ' active' : '') + '" data-st="' + k + '">' + BB_STATUS[k] + '</button>' }).join('');
  var vn = [['in', '內場（在教室）'], ['out', '外派（去對方那裡）']].map(function(x){ return '<button type="button" class="store-btn' + (e.venue === x[0] ? ' active' : '') + '" data-vn="' + x[0] + '">' + x[1] + '</button>' }).join('');
  return '<div class="card"><div class="card-title">' + (e._new ? '新增包班' : '編輯包班：' + bbEsc(e.org)) + '</div>' +
    '<div class="sec-label">狀態</div><div class="store-tabs" id="bb-st">' + st + '</div>' +
    '<div class="sec-label">上課地點</div><div class="store-tabs" id="bb-vn">' + vn + '</div>' +
    '<div class="form-grid">' +
      bbF('date', '日期 *', { type:'date' }) + bbF('start', '開始', { type:'time' }) + bbF('end', '結束', { type:'time' }) +
      bbF('org', '對接單位 *', { ph:'例：○○國小、○○公司福委會' }) +
      bbF('adults', '大人人數', { num:1 }) + bbF('kids', '小孩人數', { num:1 }) +
      bbF('course', '上課內容 *', { ph:'例：流動畫杯墊' }) + bbF('teacher', '上課老師') + bbF('total', '總金額', { num:1, ph:'整場' }) +
    '</div>' +
    '<div id="bb-slots"></div>' +
    bbSec('📍 地點', '<div class="form-grid">' + bbF('place', '上課地點', { ph:'外派填對方地點名稱' }) + bbF('address', '地址', { wide:1 }) +
      bbF('parking', '停車／進場方式', { wide:1 }) + bbF('equip', '現場設備', { wide:1, ph:'桌子、水源、投影…' }) + '</div>', e.venue === 'out') +
    bbSec('☎️ 聯絡人', '<div class="form-grid">' + bbF('contact', '單位對接人') + bbF('phone', '電話', { type:'tel' }) + bbF('contactLine', 'LINE') + bbF('contactEmail', 'Email', { type:'email' }) +
      bbF('siteContact', '當天現場聯絡人') + bbF('sitePhone', '現場聯絡電話', { type:'tel' }) + '</div>', !e.contact && !e.phone) +
    bbSec('🎨 課程與人數', '<div class="form-grid">' + bbF('ages', '年齡層', { ph:'例：國小三年級' }) + bbF('size', '尺寸') + bbF('pieces', '每人做幾件', { num:1 }) +
      bbF('sessionNo', '第幾堂', { num:1 }) + bbF('sessionTotal', '共幾堂', { num:1, ph:'系列課才填' }) + bbF('finalBy', '最終人數確認期限', { type:'date' }) +
      bbF('materials', '用料／要準備的東西', { type:'area', wide:1 }) + bbF('special', '特殊需求', { type:'area', wide:1, ph:'過敏、行動不便、要不要圍裙…' }) + '</div>' +
      bbChk('finalDone', '最終人數已確認')) +
    bbSec('👩‍🏫 人員', '<div class="form-grid">' + bbF('assistants', '助教') + bbF('teacherFee', '講師費', { num:1 }) + bbF('travelFee', '車馬費', { num:1 }) + '</div>') +
    bbSec('💰 收款', '<div class="form-grid">' + bbF('pricePer', '每人價', { num:1 }) + bbF('paid', '已收金額', { num:1, ph:'訂金＋尾款累計' }) +
      bbF('payWay', '付款方式', { ph:'匯款、現金、對方核銷流程…' }) + bbF('payDue', '付款期限', { type:'date' }) + bbF('payNote', '收款備註', { wide:1 }) + '</div>' +
      bbChk('taxIncl', '總金額含稅') + '<div class="hint" id="bb-unpaid"></div>') +
    bbSec('🧾 發票', bbChk('invNeed', '要開發票') + ' ' + bbChk('invDone', '發票已開') +
      '<div class="form-grid" style="margin-top:10px">' + bbF('invTitle', '發票抬頭') + bbF('taxId', '統編', { num:1 }) + bbF('invNo', '發票號碼') + bbF('invDate', '開立日期', { type:'date' }) +
      bbF('invEmail', '發票寄送 Email', { type:'email' }) + bbF('receiptNote', '收據／領據／匯款資料需求', { wide:1 }) + '</div>') +
    bbSec('📦 準備', bbChk('prepMat', '材料備齊') + ' ' + bbChk('prepPack', '打包完成') + ' ' + bbChk('prepCar', '出車安排好（外派）') +
      '<div class="form-grid" style="margin-top:10px">' + bbF('links', '相關連結', { type:'area', wide:1, ph:'報價單、合約、公文、採購單的雲端連結' }) + '</div>') +
    bbSec('✅ 結案', bbChk('photoDone', '作品已拍照') + '<div class="form-grid" style="margin-top:10px">' + bbF('feedback', '對方回饋', { type:'area', wide:1 }) + bbF('revisit', '回訪提醒日', { type:'date' }) + '</div>') +
    '<div class="form-grid" style="margin-top:14px">' + bbF('note', '備註', { type:'area', wide:1, rows:3 }) + '</div>' +
    '<div class="toolbar" style="margin-top:6px"><button class="btn btn-gold" id="bb-save">儲存</button><button class="btn btn-outline" id="bb-back">返回列表</button>' +
      (e._new ? '' : '<button class="btn btn-del" id="bb-del" style="margin-left:auto">刪除</button>') + '</div>' +
    (e.by ? '<div class="hint" style="margin-top:8px">' + bbEsc(e.by) + ' 建立' + (e.updatedBy ? '・最後由 ' + bbEsc(e.updatedBy) + ' 修改 ' + bbEsc(String(e.updatedAt || '').slice(0, 16).replace('T', ' ')) : '') + '</div>' : '') +
    '</div>';
}
var BB_TEXT = ['date','start','end','org','adults','kids','course','teacher','total','place','address','parking','equip','contact','phone','contactLine','contactEmail','siteContact','sitePhone',
  'ages','size','pieces','sessionNo','sessionTotal','finalBy','materials','special','assistants','teacherFee','travelFee','pricePer','paid','payWay','payDue','payNote',
  'invTitle','taxId','invNo','invDate','invEmail','receiptNote','links','feedback','revisit','note'];
var BB_CHK = ['finalDone','taxIncl','invNeed','invDone','prepMat','prepPack','prepCar','photoDone'];
function bbReadForm(){
  BB_TEXT.forEach(function(k){ var x = document.getElementById('bb-' + k); if (x) bbEdit[k] = x.value.trim() });
  BB_CHK.forEach(function(k){ var x = document.getElementById('bb-' + k); if (x) bbEdit[k] = x.checked });
  bbEdit.blockSlots = [].map.call(document.querySelectorAll('#bb-slots input[data-sl]:checked'), function(x){ return x.dataset.sl });
}
/* 內場：列出那天的時段給人勾，預設勾跟上課時間重疊的 */
var bbSlotsTouched = false;
async function bbDrawSlots(){
  var box = document.getElementById('bb-slots'); if (!box) return;
  var e = bbEdit;
  if (e.venue !== 'in' || !e.date || !window.bkBbApi){ box.innerHTML = ''; return }
  var d = bbSlash(e.date), slots = await window.bkBbApi.slotsOn(d);
  if (!bbEdit || bbEdit !== e) return;
  var sel = bbArr(e.blockSlots);
  if (!bbSlotsTouched && !sel.length) sel = bbOverlap(slots, e.start, e.end);
  box.innerHTML = '<div class="bb-slotbox"><div class="sec-label" style="margin-bottom:6px">要擋掉哪些時段的線上預約</div>' +
    slots.map(function(sl){ return '<label class="bb-chk"><input type="checkbox" data-sl="' + bbEsc(sl) + '"' + (sel.indexOf(sl) >= 0 ? ' checked' : '') + '> ' + bbEsc(sl) + '</label>' }).join(' ') +
    '<div class="hint">' + (e.status === 'ok' || e.status === 'done' ? '存檔後這些時段客人就約不到了（已經約好的人不受影響）。'
      : '現在是「' + (BB_STATUS[e.status] || '') + '」，' + (e.status === 'cancel' ? '不會擋，之前擋的會還原。' : '改成「已確認」存檔後才會真的擋。')) + '</div></div>';
  box.querySelectorAll('input[data-sl]').forEach(function(x){ x.onchange = function(){ bbSlotsTouched = true } });
}
function bbBindForm(){
  bbSlotsTouched = bbArr(bbEdit.blockSlots).length > 0;
  function tabs(id, attr, key){
    document.getElementById(id).onclick = function(ev){
      var b = ev.target.closest('button'); if (!b) return;
      bbReadForm(); bbEdit[key] = b.dataset[attr];
      this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x === b) });
      bbDrawSlots();
    };
  }
  tabs('bb-st', 'st', 'status'); tabs('bb-vn', 'vn', 'venue');
  ['date', 'start', 'end'].forEach(function(k){ document.getElementById('bb-' + k).addEventListener('change', function(){
    bbReadForm(); if (!bbSlotsTouched) bbEdit.blockSlots = [];
    bbDrawSlots() }) });
  function unpaid(){
    var t = bbNum(document.getElementById('bb-total').value), p = bbNum(document.getElementById('bb-paid').value);
    document.getElementById('bb-unpaid').textContent = t ? (t - p > 0 ? '還沒收：' + bbMoney(t - p) : '已收齊') : '';
  }
  ['bb-total', 'bb-paid'].forEach(function(id){ document.getElementById(id).addEventListener('input', unpaid) }); unpaid();
  document.getElementById('bb-back').onclick = function(){ bbEdit = null; renderBaoban() };
  document.getElementById('bb-save').onclick = bbSave;
  var del = document.getElementById('bb-del'); if (del) del.onclick = bbDelete;
  bbDrawSlots();
}
async function bbSave(){
  if (bbBusy) return;
  bbReadForm();
  var e = bbEdit;
  if (!e.date && e.status !== 'talk') return alert('請填日期');
  if (!e.org) return alert('請填對接單位');
  if (e.venue === 'in' && (e.status === 'ok' || e.status === 'done') && e.date >= bbToday() && !bbArr(e.blockSlots).length && window.bkBbApi &&
      !confirm('內場包班沒有勾要擋的時段，客人還是可以線上約這天。確定這樣存？')) return;
  /* 新擋的時段如果已經有客人約了，先提醒 */
  if (window.bkBbApi && bbWants(e)){
    var had = bbArr((bbData[e.id] || {}).locked), warn = [];
    for (var i = 0; i < e.blockSlots.length; i++){
      var sl = e.blockSlots[i]; if (had.indexOf(bbSlash(e.date) + '|' + sl) >= 0) continue;
      try { var bk = await window.bkBbApi.booked(bbSlash(e.date), sl);
        if (bk.length) warn.push(sl + '：' + bk.map(function(b){ return b.name + ' ' + b.people + '位' }).join('、')) } catch (x) {}
    }
    if (warn.length && !confirm('這些時段已經有客人約了，擋掉之後他們還是會來：\n\n' + warn.join('\n') + '\n\n確定要包班擋這些時段嗎？（記得跟客人改時間）')) return;
  }
  bbBusy = true; var btn = document.getElementById('bb-save'); btn.disabled = true; btn.textContent = '儲存中…';
  try {
    var now = new Date(Date.now() + 288e5).toISOString().slice(0, 16);
    if (e._new){ e.by = bbBy(); e.createdAt = now } else { e.updatedBy = bbBy(); e.updatedAt = now }
    /* locked 以雲端為準，別的分頁可能剛改過 */
    try { var fr = await (await fetch(BB_URL + '/groupClasses/' + e.id + '/locked.json')).json(); e.locked = bbArr(fr) } catch (x) {}
    await bbPut(e);                       // 先存資料，擋名額失敗也不會丟掉填的東西
    var msgs = await bbSyncLock(e);
    await bbPut(e);
    bbEdit = null; renderBaoban();
    if (window.bkBbApi) window.bkBbApi.render();
    if (msgs.length) alert('已儲存。\n\n' + msgs.join('\n'));
  } catch (x) {
    alert('儲存失敗：' + x.message + '\n請檢查網路後再按一次。');
  } finally { bbBusy = false; if (document.getElementById('bb-save')){ btn.disabled = false; btn.textContent = '儲存' } }
}
async function bbDelete(){
  var e = bbEdit;
  if (!confirm('刪除「' + (e.org || '這筆包班') + '」？刪了就找不回來。\n只是沒成交的話，改成「取消」比較好，之後還查得到。')) return;
  bbBusy = true;
  try {
    e.status = 'cancel';
    var msgs = await bbSyncLock(e);       // 先把擋掉的時段還原
    var r = await fetch(BB_URL + '/groupClasses/' + e.id + '.json', { method:'DELETE' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    delete bbData[e.id]; bbEdit = null; renderBaoban();
    if (window.bkBbApi) window.bkBbApi.render();
    if (msgs.length) alert(msgs.join('\n'));
  } catch (x) { alert('刪除失敗：' + x.message) } finally { bbBusy = false }
}

/* ── 今日排課最上面：這一天的包班；看今天的話順便列接下來 7 天 ── */
function bbDayHtml(dateStr, isToday){
  if (!bbData) return '';
  var d = String(dateStr).replace(/\//g, '-'), t = bbToday();
  var on = bbList().filter(function(r){ return r.status !== 'cancel' && r.date === d })
    .sort(function(a, b){ return String(a.start || '').localeCompare(String(b.start || '')) });
  var next = isToday ? bbList().filter(function(r){ var x = r.date ? bbDaysTo(r.date) : -1; return r.status !== 'cancel' && r.date > t && x <= 7 })
    .sort(function(a, b){ return String(a.date).localeCompare(String(b.date)) }) : [];
  if (!on.length && !next.length) return '';
  /* 彈窗外也會用到，顏色寫死不用 --bk 變數 */
  return '<div style="background:#F4EEDD;border:1px solid #D9C48A;border-radius:12px;padding:10px 14px;margin-bottom:10px">' +
    (on.length ? '<div style="font-weight:700;color:#7A5A12;margin-bottom:4px">🏫 這天有包班</div>' + on.map(function(r){
      return '<div style="padding:6px 0;border-top:1px dashed #E2D4AA;cursor:pointer" onclick="bbOpen(\'' + bbEsc(r.id) + '\')">' +
        '<b>' + bbEsc((r.start || '') + (r.end ? '–' + r.end : '')) + ' ' + bbEsc(r.org) + '</b>　' + (r.venue === 'out' ? '外派' : '內場') + '・' + bbPpl(r) + ' 人' +
        '<div style="font-size:13px;color:#6b665e">' + [r.course, r.teacher ? '老師 ' + r.teacher : '', r.venue === 'out' ? (r.place || r.address) : '',
          r.siteContact ? '現場 ' + r.siteContact + ' ' + (r.sitePhone || '') : (r.contact ? '對接 ' + r.contact + ' ' + (r.phone || '') : ''),
          r.prepMat ? '已備料' : '⚠️ 還沒備料'].filter(Boolean).map(bbEsc).join('・') + '</div></div>';
    }).join('') : '') +
    (next.length ? '<div style="font-size:13px;color:#7A5A12;margin-top:' + (on.length ? 8 : 0) + 'px"><b>接下來 7 天包班：</b>' + next.map(function(r){
      return '<span style="cursor:pointer;text-decoration:underline" onclick="bbOpen(\'' + bbEsc(r.id) + '\')">' + bbEsc(bbMd(r.date) + ' ' + r.org + ' ' + bbPpl(r) + '人') + '</span>' }).join('、') + '</div>' : '') +
    '</div>';
}

/* 開頁先讀一次，今日排課才畫得出包班；之後每 5 分鐘更新 */
async function bbBoot(){
  try { await bbLoad(); if (window.bkBbApi) window.bkBbApi.render() } catch (e) {}
}
bbBoot();
setInterval(function(){ if (!bbEdit) bbBoot() }, 5 * 60000);
