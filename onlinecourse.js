/* ══════════════════════════════════════════════════════════
   🎬 線上課程（2026-11-24，第一檔：微光聖誕樹四集）
   影片放 Cloudflare Stream（公司帳號），每支都鎖「要簽章網址才能播」。
   這頁做三件事：
     1. 上傳影片：選檔案就直接從這台電腦分段傳到 Cloudflare，不經過我們的伺服器，1G 也傳得動。
     2. 組課程：課程名稱＋每一集挑一支影片。
     3. 開通學員：輸入買材料包客人的電話，他從預約頁「我的線上課程」就能看。
   客人第一次在 LINE 打開會把這支電話綁到他的 LINE；換 LINE 帳號要在這裡按「解除綁定」。
   資料一律透過伺服器 /staff/oc/*（otto2-booking-f9ef7 onlineCourses/，不公開）。
   ══════════════════════════════════════════════════════════ */
var ocData = null, ocView = 'list', ocEdit = null, ocUp = {}, ocCodes = null, ocCodeQ = '';
function ocEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] }) }
function ocMd(iso){ if (!iso) return ''; var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() }
function ocVid(uid){ return (ocData.videos || []).filter(function(v){ return v.uid === uid })[0] }

async function renderOnlineCourse(){
  var el = document.getElementById('onlinecourse-body'); if (!el) return;
  if (!ocData) {
    el.innerHTML = '<div class="empty">載入線上課程中…</div>';
    try { ocData = await staffApi('/staff/oc/list', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到線上課程：' + ocEsc(e.message) + '</div>'; return }
    try { ocCodes = (await staffApi('/staff/oc/codes', {})).codes || {} } catch(e) { ocCodes = null }
  }
  el.innerHTML = ocView === 'edit' ? ocEditHtml() : ocListHtml();
}
function ocReload(){ ocData = null; renderOnlineCourse() }

/* ── 主畫面：每套課程一張卡（集數、學員）＋最下面影片庫 ── */
function ocListHtml(){
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">🎬 線上課程' +
    '<span style="margin-left:auto"></span>' +
    '<button class="btn btn-outline btn-sm" onclick="ocReload()">↻ 重新讀取</button>' +
    '<button class="btn btn-gold btn-sm" onclick="ocOpenEdit()">＋ 新增一套課程</button></div>' +
    '<div class="muted" style="font-size:var(--fs-xs);line-height:1.7">買材料包的客人在這裡用電話開通，他從官方 LINE 預約頁的「🎬 我的線上課程」就能看。' +
    '影片上會飄著客人的名字和電話末三碼，被錄下來外流也看得出是誰的。<br>填預購單的電話會自動開通；收禮的人用每盒附的「開通碼貼紙」自己開通（見下面🎟 開通碼）。</div></div>';
  if (ocData.cfErr) h += '<div class="card" style="border-color:#e0a0a0;color:#a33">⚠️ 連不到 Cloudflare：' + ocEsc(ocData.cfErr) + '</div>';
  var cs = ocData.courses || [];
  if (!cs.length) h += '<div class="card"><div class="empty">還沒有課程。先在下面「影片庫」確認影片都傳上去了，再按「＋ 新增一套課程」。</div></div>';
  cs.forEach(function(c){ h += ocCourseCard(c) });
  h += ocCodesHtml();
  h += ocVideosHtml();
  return h;
}
function ocStudents(cid){
  var out = [], en = ocData.enroll || {};
  Object.keys(en).forEach(function(p){ if (en[p] && en[p][cid]) out.push(Object.assign({ phone: p }, en[p][cid])) });
  return out.sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
}
function ocCourseCard(c){
  var st = ocStudents(c.id), bound = ocData.bound || [], watched = ocData.watched || [];
  var h = '<div class="card"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">' +
    '<div style="font-weight:800;font-size:16px">' + ocEsc(c.title) + '</div>' +
    (c.on === false ? '<span style="font-size:12px;color:#a33;border:1px solid #e0a0a0;border-radius:9px;padding:1px 8px">沒上架（只有已開通的人看得到）</span>' : '<span style="font-size:12px;color:#2f7d5b;border:1px solid #9fd0b8;border-radius:9px;padding:1px 8px">上架中</span>') +
    '<span style="margin-left:auto"></span><button class="btn btn-outline btn-sm" onclick="ocOpenEdit(\'' + c.id + '\')">✏️ 編輯課程</button></div>';
  if (c.desc) h += '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:8px">' + ocEsc(c.desc) + '</div>';
  h += '<div style="display:flex;flex-direction:column;gap:4px;margin-bottom:12px">' + (c.eps || []).map(function(e, i){
    var v = ocVid(e.uid);
    return '<div style="font-size:13px">第 ' + (i + 1) + ' 集・' + ocEsc(e.title || (v && v.name) || '') +
      (v ? '<span class="muted">（' + v.min + ' 分鐘' + (v.ready ? '' : '・<b style="color:#c98a2c">轉檔中</b>') + '）</span>' : '<span style="color:#a33">（找不到影片）</span>') + '</div>' }).join('') + '</div>';
  /* 開通 */
  h += '<div style="background:var(--bg2,#faf7f0);border-radius:10px;padding:10px 12px">' +
    '<div style="font-weight:700;margin-bottom:6px">開通學員（' + st.length + ' 位）</div>' +
    '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
    '<input id="oc-ph-' + c.id + '" type="tel" inputmode="numeric" placeholder="客人電話 09xxxxxxxx" style="flex:1;min-width:150px">' +
    '<input id="oc-nm-' + c.id + '" placeholder="名字（會員可不填）" style="width:150px">' +
    '<button class="btn btn-ok btn-sm" onclick="ocEnroll(\'' + c.id + '\',this)">開通</button></div>';
  if (st.length) h += '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr class="muted" style="text-align:left"><th>名字</th><th>電話</th><th>開通</th><th>LINE</th><th>看過</th><th></th></tr>' +
    st.map(function(s){
      var b = bound.indexOf(s.phone) >= 0, w = watched.indexOf(s.phone) >= 0;
      return '<tr style="border-top:1px solid var(--border)"><td>' + ocEsc(s.name || '—') + '</td><td>' + ocEsc(s.phone) + '</td><td>' + ocMd(s.at) + ' ' + ocEsc(s.by || '') + '</td>' +
        '<td>' + (b ? '✅ 已綁' : '<span class="muted">還沒打開</span>') + '</td><td>' + (w ? '👀' : '') + '</td>' +
        '<td style="text-align:right;white-space:nowrap">' + (b ? '<button class="btn btn-outline btn-sm" title="客人換手機或換 LINE 帳號時用" onclick="ocUnbind(\'' + s.phone + '\',this)">解除綁定</button> ' : '') +
        '<button class="btn btn-del btn-sm" onclick="ocUnenroll(\'' + c.id + '\',\'' + s.phone + '\',this)">取消</button></td></tr>' }).join('') + '</table>';
  return h + '</div></div>';
}
async function ocEnroll(cid, btn){
  var ph = document.getElementById('oc-ph-' + cid).value, nm = document.getElementById('oc-nm-' + cid).value;
  btn.disabled = true;
  try { var j = await staffApi('/staff/oc/enroll', { phone: ph, name: nm, cid: cid });
    if (!j.member && !nm) alert('這支電話不是會員，已經開通了，但沒有名字。建議補上名字（影片浮水印會用到）。');
    ocReload() } catch(e) { alert(e.message); btn.disabled = false }
}
async function ocUnenroll(cid, phone, btn){
  if (!confirm('取消 ' + phone + ' 這堂線上課程？客人就不能再看了。')) return;
  btn.disabled = true;
  try { await staffApi('/staff/oc/enroll', { phone: phone, cid: cid, on: false }); ocReload() } catch(e) { alert(e.message); btn.disabled = false }
}
async function ocUnbind(phone, btn){
  if (!confirm('解除 ' + phone + ' 綁定的 LINE？客人下次用新的 LINE 打開，輸入這支電話就能重新開通。')) return;
  btn.disabled = true;
  try { await staffApi('/staff/oc/unbind', { phone: phone }); ocReload() } catch(e) { alert(e.message); btn.disabled = false }
}

/* ── 影片庫＋上傳 ── */
function ocVideosHtml(){
  var vs = ocData.videos || [], used = {};
  (ocData.courses || []).forEach(function(c){ (c.eps || []).forEach(function(e){ used[e.uid] = c.title }) });
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">📼 影片庫（Cloudflare 上的影片 ' + vs.length + ' 支）' +
    '<span style="margin-left:auto"></span><label class="btn btn-gold btn-sm" style="cursor:pointer">⬆️ 上傳影片<input type="file" accept="video/*" multiple style="display:none" onchange="ocPick(this)"></label></div>' +
    '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:8px">檔名就是影片名稱，建議先改成「一）介紹材料.mp4」這種。上傳時這個分頁不要關、電腦不要睡；傳完 Cloudflare 還要轉檔十幾分鐘才能看。</div>';
  var ups = Object.keys(ocUp);
  if (ups.length) h += '<div id="oc-ups">' + ups.map(ocUpRow).join('') + '</div>';
  h += vs.length ? '<table style="width:100%;font-size:13px;border-collapse:collapse"><tr class="muted" style="text-align:left"><th>影片</th><th>長度</th><th>狀態</th><th>用在</th></tr>' +
    vs.map(function(v){ return '<tr style="border-top:1px solid var(--border)"><td>' + ocEsc(v.name) + '</td><td>' + v.min + ' 分</td><td>' +
      (v.ready ? '✅ 可播放' : '⏳ ' + ocEsc(v.state === 'pendingupload' ? '還沒傳完' : '轉檔中' + (v.pct ? ' ' + Math.round(+v.pct) + '%' : ''))) + (v.signed ? '' : ' <span style="color:#a33" title="放進課程存檔就會自動鎖">🔓</span>') +
      '</td><td>' + (used[v.uid] ? ocEsc(used[v.uid]) : '<span class="muted">—</span>') + '</td></tr>' }).join('') + '</table>' : '<div class="empty">還沒有影片</div>';
  return h + '</div>';
}
function ocUpRow(k){ var u = ocUp[k];
  return '<div style="margin:6px 0"><div style="font-size:13px">' + ocEsc(u.name) + '・' + (u.err ? '<b style="color:#a33">' + ocEsc(u.err) + '</b>' : u.done ? '✅ 傳完了' : Math.floor(u.pct) + '%') + '</div>' +
    '<div style="height:6px;background:#eee;border-radius:4px;overflow:hidden"><i style="display:block;height:100%;width:' + u.pct + '%;background:var(--gold)"></i></div></div>' }
function ocUpDraw(){ var el = document.getElementById('oc-ups'); if (el) el.innerHTML = Object.keys(ocUp).map(ocUpRow).join(''); else if (ocView === 'list') renderOnlineCourse() }
async function ocPick(inp){
  var files = Array.prototype.slice.call(inp.files || []); inp.value = '';
  for (var i = 0; i < files.length; i++) await ocUpload(files[i]);
  ocReload();
}
/* tus 分段上傳：每段 50MB（Cloudflare 要 256KB 的倍數），斷線重試 5 次，失敗從斷點接著傳 */
async function ocUpload(f){
  var k = 'u' + Date.now() + Math.random(); ocUp[k] = { name: f.name, pct: 0 }; ocUpDraw();
  var CH = 256 * 1024 * 200;
  try {
    var j = await staffApi('/staff/oc/upload', { size: f.size, name: f.name });
    var off = 0, tries = 0;
    while (off < f.size) {
      try {
        var r = await fetch(j.url, { method: 'PATCH', headers: { 'Tus-Resumable': '1.0.0', 'Upload-Offset': String(off), 'Content-Type': 'application/offset+octet-stream' }, body: f.slice(off, off + CH) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        off = Number(r.headers.get('Upload-Offset')) || (off + CH); tries = 0;
      } catch(e) {
        if (++tries > 5) throw e;
        await new Promise(function(ok){ setTimeout(ok, 4000 * tries) });
        try { var hr = await fetch(j.url, { method: 'HEAD', headers: { 'Tus-Resumable': '1.0.0' } }); off = Number(hr.headers.get('Upload-Offset')) || off } catch(_) {}
      }
      ocUp[k].pct = Math.min(100, off / f.size * 100); ocUpDraw();
    }
    ocUp[k].done = true;
  } catch(e) { ocUp[k].err = '上傳失敗：' + e.message }
  ocUpDraw();
}

/* ── 編輯課程 ── */
function ocOpenEdit(id){
  var c = id ? (ocData.courses || []).filter(function(x){ return x.id === id })[0] : null;
  ocEdit = c ? JSON.parse(JSON.stringify(c)) : { title: '', desc: '', on: true, order: (ocData.courses || []).length, eps: [] };
  if (!ocEdit.eps) ocEdit.eps = [];
  ocView = 'edit'; renderOnlineCourse();
}
function ocEditHtml(){
  var c = ocEdit, vs = ocData.videos || [];
  var opts = function(sel){ return '<option value="">（選影片）</option>' + vs.map(function(v){ return '<option value="' + v.uid + '"' + (v.uid === sel ? ' selected' : '') + '>' + ocEsc(v.name) + '（' + v.min + ' 分' + (v.ready ? '' : '・轉檔中') + '）</option>' }).join('') };
  var h = '<div class="card"><div class="card-title">' + (c.id ? '✏️ 編輯課程' : '＋ 新增一套課程') + '</div>' +
    '<label class="muted" style="font-size:var(--fs-xs)">課程名稱（客人看到的）</label><input id="oc-t" value="' + ocEsc(c.title) + '" placeholder="例如：微光聖誕樹 DIY" style="width:100%;margin-bottom:10px">' +
    '<label class="muted" style="font-size:var(--fs-xs)">一句說明（選填）</label><input id="oc-d" value="' + ocEsc(c.desc) + '" placeholder="例如：搭配材料包，四集跟著做" style="width:100%;margin-bottom:10px">' +
    '<label style="display:flex;align-items:center;gap:6px;margin-bottom:12px"><input type="checkbox" id="oc-on"' + (c.on !== false ? ' checked' : '') + '> 上架（沒買的人也看得到這堂課，灰色不能點）</label>' +
    '<div style="font-weight:700;margin-bottom:6px">集數</div>';
  c.eps.forEach(function(e, i){
    h += '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;flex-wrap:wrap"><b style="width:52px">第 ' + (i + 1) + ' 集</b>' +
      '<select onchange="ocEpSet(' + i + ',\'uid\',this.value)" style="flex:1;min-width:180px">' + opts(e.uid) + '</select>' +
      '<input value="' + ocEsc(e.title) + '" placeholder="這集標題（不填用影片名稱）" oninput="ocEpSet(' + i + ',\'title\',this.value)" style="flex:1;min-width:160px">' +
      '<button class="btn btn-outline btn-sm" onclick="ocEpMove(' + i + ',-1)"' + (i ? '' : ' disabled') + '>↑</button>' +
      '<button class="btn btn-del btn-sm" onclick="ocEpDel(' + i + ')">✕</button></div>' });
  h += '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:6px 0 14px"><button class="btn btn-outline btn-sm" onclick="ocEpAdd()">＋ 加一集</button>' +
    (c.eps.length ? '' : '<button class="btn btn-outline btn-sm" onclick="ocEpAuto()">把還沒用到的影片照檔名順序全部加進來</button>') + '</div>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn btn-gold" onclick="ocSave(this)">存檔</button>' +
    '<button class="btn btn-outline" onclick="ocView=\'list\';renderOnlineCourse()">取消</button>' +
    (c.id ? '<span style="margin-left:auto"></span><button class="btn btn-del" onclick="ocDel(this)">刪除這套課程</button>' : '') + '</div></div>';
  return h;
}
function ocKeep(){ var t = document.getElementById('oc-t'); if (!t) return;
  ocEdit.title = t.value; ocEdit.desc = document.getElementById('oc-d').value; ocEdit.on = document.getElementById('oc-on').checked }
function ocEpSet(i, k, v){ ocEdit.eps[i][k] = v }
function ocEpAdd(){ ocKeep(); ocEdit.eps.push({ uid: '', title: '' }); renderOnlineCourse() }
function ocEpDel(i){ ocKeep(); ocEdit.eps.splice(i, 1); renderOnlineCourse() }
function ocEpMove(i, d){ ocKeep(); var e = ocEdit.eps.splice(i, 1)[0]; ocEdit.eps.splice(i + d, 0, e); renderOnlineCourse() }
function ocEpAuto(){ ocKeep(); var used = {};
  (ocData.courses || []).forEach(function(c){ (c.eps || []).forEach(function(e){ used[e.uid] = 1 }) });
  /* 檔名「一）」「二）」這種中文數字也照順序 */
  var cn = '一二三四五六七八九十', key = function(n){ var m = String(n).match(/^\s*([一二三四五六七八九十])/); return m ? String(cn.indexOf(m[1])).padStart(2, '0') + n : n };
  (ocData.videos || []).filter(function(v){ return !used[v.uid] }).sort(function(a, b){ return key(a.name).localeCompare(key(b.name), 'zh-Hant') })
    .forEach(function(v){ ocEdit.eps.push({ uid: v.uid, title: String(v.name).replace(/^\s*[一二三四五六七八九十\d]+[）)、.]\s*/, '') }) });
  renderOnlineCourse() }
async function ocSave(btn){
  ocKeep();
  if (!ocEdit.title.trim()) return alert('請填課程名稱');
  if (ocEdit.eps.some(function(e){ return !e.uid })) return alert('有一集還沒選影片');
  btn.disabled = true;
  try { await staffApi('/staff/oc/course', ocEdit); ocView = 'list'; ocReload() } catch(e) { alert(e.message); btn.disabled = false }
}
async function ocDel(btn){
  if (!confirm('刪除「' + ocEdit.title + '」？影片本身不會刪，已開通的學員會看不到這堂課。')) return;
  btn.disabled = true;
  try { await staffApi('/staff/oc/course/del', { id: ocEdit.id }); ocView = 'list'; ocReload() } catch(e) { alert(e.message); btn.disabled = false }
}


/* ══ 🎟 開通碼（11/24）：每盒材料包貼一張，收禮的人輸入碼＋自己的姓名電話就能看。
   每組只能用一次；碼由伺服器隨機產生（XMAS- 加 5 碼、沒有 0 O 1 I L）。
   貼紙：A4 65 格（5×13，每格 38.1×21.2mm），可以微調上/左位置、跳過已經用掉的格子。 ══ */
function ocCodeList(cid){ var o = ocCodes || {}; return Object.keys(o).filter(function(k){ return o[k] && (!cid || o[k].cid === cid) }).map(function(k){ return Object.assign({ code: k }, o[k]) }) }
function ocCodesHtml(){
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">🎟 開通碼（貼在每盒材料包）</div>';
  if (!ocCodes) return h + '<div class="empty">讀不到開通碼（伺服器可能還沒更新）</div></div>';
  var cs = ocData.courses || [];
  cs.forEach(function(c){
    var all = ocCodeList(c.id); if (!all.length && c.on === false) return;
    var used = all.filter(function(x){ return x.used });
    h += '<div style="background:var(--bg2,#faf7f0);border-radius:10px;padding:10px 12px;margin-bottom:10px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><b>' + ocEsc(c.title) + '</b>' +
      '<span class="muted" style="font-size:13px">共 ' + all.length + ' 組・已用 <b style="color:#2f7d5b">' + used.length + '</b>・還沒用 ' + (all.length - used.length) + '</span>' +
      '<span style="margin-left:auto"></span>' +
      '<button class="btn btn-gold btn-sm" onclick="ocPrint(\'' + c.id + '\')"' + (all.length - used.length ? '' : ' disabled') + '>🖨 印貼紙</button>' +
      '<button class="btn btn-outline btn-sm" onclick="ocCsv(\'' + c.id + '\')"' + (all.length ? '' : ' disabled') + '>⬇ CSV</button>' +
      '<input id="oc-gn-' + c.id + '" type="number" min="1" max="1000" value="65" style="width:70px" title="要再產生幾組">' +
      '<button class="btn btn-outline btn-sm" onclick="ocGen(\'' + c.id + '\',this)">＋ 再產生</button></div>';
    if (used.length) {
      used.sort(function(a, b){ return String(b.usedAt).localeCompare(String(a.usedAt)) });
      h += '<table style="width:100%;font-size:13px;border-collapse:collapse;margin-top:8px"><tr class="muted" style="text-align:left"><th>開通碼</th><th>誰用的</th><th>電話</th><th>時間</th></tr>' +
        used.map(function(x){ return '<tr style="border-top:1px solid var(--border)"><td style="font-family:monospace">' + ocEsc(x.code) + '</td><td>' + ocEsc(x.name || '—') + '</td><td>' + ocEsc(x.phone || '') + '</td><td>' + ocMd(x.usedAt) + ' ' + (x.usedAt ? new Date(x.usedAt).toTimeString().slice(0, 5) : '') + '</td></tr>' }).join('') + '</table>';
    } else h += '<div class="muted" style="font-size:13px;margin-top:6px">還沒有人用開通碼開通。</div>';
    h += '</div>';
  });
  /* 查一組碼 */
  var q = ocCodeQ.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^XMAS/, ''), hit = q ? (ocCodes['XMAS-' + q] ? Object.assign({ code: 'XMAS-' + q }, ocCodes['XMAS-' + q]) : null) : null;
  h += '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap"><input id="oc-cq" placeholder="查一組碼，例 XMAS-7K3PQ" value="' + ocEsc(ocCodeQ) + '" style="width:200px" onkeydown="if(event.key===\'Enter\')ocCodeFind()">' +
    '<button class="btn btn-outline btn-sm" onclick="ocCodeFind()">查詢</button>' +
    (q ? '<span style="font-size:13px">' + (!hit ? '❌ 沒有這組碼' : hit.used ? '✅ 已用：' + ocEsc(hit.name || '') + ' ' + ocEsc(hit.phone || '') + '（' + ocMd(hit.usedAt) + '）' : '🟡 還沒用（' + ocEsc(hit.batch || '') + '）') + '</span>' : '') + '</div>';
  return h + '</div>';
}
function ocCodeFind(){ var el = document.getElementById('oc-cq'); ocCodeQ = el ? el.value.trim() : ''; renderOnlineCourse() }
async function ocGen(cid, btn){
  var n = Math.floor(Number((document.getElementById('oc-gn-' + cid) || {}).value) || 0);
  if (!(n >= 1 && n <= 1000)) { alert('一次 1～1000 組'); return }
  if (!confirm('要再產生 ' + n + ' 組開通碼嗎？')) return;
  btn.disabled = true;
  try { ocCodes = (await staffApi('/staff/oc/codes', { gen: true, cid: cid, n: n })).codes || {}; renderOnlineCourse() } catch(e) { alert('產生失敗：' + e.message); btn.disabled = false }
}
function ocCsv(cid){
  var c = (ocData.courses || []).filter(function(x){ return x.id === cid })[0] || {};
  var rows = [['開通碼', '課程', '批次', '狀態', '使用時間', '使用人', '電話']].concat(ocCodeList(cid).sort(function(a, b){ return a.code < b.code ? -1 : 1 }).map(function(x){
    return [x.code, c.title || cid, x.batch || '', x.used ? '已用' : '未用', x.usedAt ? new Date(x.usedAt).toLocaleString('zh-TW') : '', x.name || '', x.phone || ''] }));
  var csv = '﻿' + rows.map(function(r){ return r.map(function(v){ v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v }).join(',') }).join('\r\n');
  var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = '開通碼_' + (c.title || cid) + '_' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
}
/* 印貼紙：開一個新視窗，A4 一張 65 格；上面有微調欄位（不會印出來） */
function ocPrint(cid){
  var codes = ocCodeList(cid).filter(function(x){ return !x.used }).map(function(x){ return x.code }).sort();
  var w = window.open('', '_blank'); if (!w) { alert('瀏覽器擋了新視窗，請允許彈出視窗'); return }
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>開通碼貼紙</title><style>' +
    '@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;font-family:"PingFang TC","Microsoft JhengHei",sans-serif}' +
    '.tool{position:sticky;top:0;background:#fff8e6;border-bottom:1px solid #e0c98a;padding:8px 12px;font-size:13px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;z-index:2}' +
    '.tool input{width:56px}.tool button{font-size:14px;padding:5px 14px}' +
    '.page{width:210mm;height:297mm;position:relative;overflow:hidden;page-break-after:always;background:#fff;margin:0 auto}' +
    '.lb{position:absolute;width:38.1mm;height:21.2mm;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}' +
    '.lb i{font-style:normal;font-size:7.5pt;letter-spacing:1px;color:#555}.lb b{font-family:Menlo,Consolas,"Courier New",monospace;font-size:12.5pt;letter-spacing:.5px;margin-top:1mm;color:#111}' +
    'body.grid .lb{outline:.2mm dashed #bbb}' +
    '@media screen{body{background:#ccc}.page{margin:10px auto;box-shadow:0 2px 8px rgba(0,0,0,.2)}}@media print{.tool{display:none}}' +
    '</style></head><body class="grid"><div class="tool">' +
    '共 <b>' + codes.length + '</b> 組還沒用的碼｜上邊界 <input id="t" type="number" step="0.5" value="10.7">mm　左邊界 <input id="l" type="number" step="0.5" value="4.7">mm' +
    '　左右間距 <input id="g" type="number" step="0.1" value="2.5">mm　跳過前 <input id="sk" type="number" min="0" max="64" value="0"> 格' +
    '　<label><input id="gr" type="checkbox" checked style="width:auto"> 印格線（對位測試用）</label>' +
    '<button onclick="window.print()">🖨 列印</button><span style="color:#8a6a30">先印一張一般紙，疊在貼紙上對光看位置；印表機設定選「實際大小／100%」</span></div><div id="pp"></div>' +
    '<script>var C=' + JSON.stringify(codes) + ';function d(){var t=+T.value||0,l=+L.value||0,g=+G.value||0,sk=Math.max(0,Math.min(64,+SK.value||0)),h="",i=0,n=0;' +
    'var all=new Array(sk).fill("").concat(C);while(i<all.length){h+="<div class=\\"page\\">";for(var k=0;k<65&&i<all.length;k++,i++){var r=Math.floor(k/5),c=k%5;' +
    'h+="<div class=\\"lb\\" style=\\"top:"+(t+r*21.2)+"mm;left:"+(l+c*(38.1+g))+"mm\\">"+(all[i]?"<i>影片開通碼</i><b>"+all[i]+"</b>":"")+"</div>"}h+="</div>"}' +
    'document.getElementById("pp").innerHTML=h;document.body.className=GR.checked?"grid":""}' +
    'var T=document.getElementById("t"),L=document.getElementById("l"),G=document.getElementById("g"),SK=document.getElementById("sk"),GR=document.getElementById("gr");' +
    '[T,L,G,SK,GR].forEach(function(x){x.oninput=d;x.onchange=d});d();<\/script></body></html>');
  w.document.close();
}
