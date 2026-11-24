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
var ocData = null, ocView = 'list', ocEdit = null, ocUp = {};
function ocEsc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c] }) }
function ocMd(iso){ if (!iso) return ''; var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate() }
function ocVid(uid){ return (ocData.videos || []).filter(function(v){ return v.uid === uid })[0] }

async function renderOnlineCourse(){
  var el = document.getElementById('onlinecourse-body'); if (!el) return;
  if (!ocData) {
    el.innerHTML = '<div class="empty">載入線上課程中…</div>';
    try { ocData = await staffApi('/staff/oc/list', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到線上課程：' + ocEsc(e.message) + '</div>'; return }
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
    '影片上會飄著客人的名字和電話末三碼，被錄下來外流也看得出是誰的。</div></div>';
  if (ocData.cfErr) h += '<div class="card" style="border-color:#e0a0a0;color:#a33">⚠️ 連不到 Cloudflare：' + ocEsc(ocData.cfErr) + '</div>';
  var cs = ocData.courses || [];
  if (!cs.length) h += '<div class="card"><div class="empty">還沒有課程。先在下面「影片庫」確認影片都傳上去了，再按「＋ 新增一套課程」。</div></div>';
  cs.forEach(function(c){ h += ocCourseCard(c) });
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
