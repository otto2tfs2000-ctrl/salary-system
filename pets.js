/* ══════════════════════════════════════════════════════════
   寵物離家出走分頁（2026-10-24，認養天竺鼠強化規格 v3 第 5、14 節）
   作品小屋認養的天竺鼠／青蛙：主人 3 天沒來牠會餓（推 LINE 一則）、5 天跑去別人家作客（不推）、
   14 天去旅行寄明信片（推 LINE 一則，附這裡上傳的教室角落照片＋當期課程）。
   這裡看誰的寵物離家、本月推了幾則、改天數與文案、上傳明信片照片。
   資料在 otto2-booking-f9ef7 的 island/petcfg，一律透過伺服器（/staff/pets*）讀寫。
   ══════════════════════════════════════════════════════════ */

var ptData = null, ptDraft = null, ptTab = 'overview';

function ptEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
var PT_AWAY = { home:'在家', hungry:'肚子餓', visit:'去作客', trip:'去旅行' };

async function ptLoad(){
  ptData = await staffApi('/staff/pets', {});
  ptDraft = JSON.parse(JSON.stringify(ptData.cfg));
}

async function renderPets(){
  var el = document.getElementById('pets-body');
  if (!el) return;
  if (!ptData) {
    el.innerHTML = '<div class="empty">載入寵物資料中…</div>';
    try { await ptLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + ptEsc(e.message) + '</div>'; return }
  }
  var tabs = [['overview','總覽'],['postcard','明信片'],['settings','天數與文案']];
  var h = '<div class="store-tabs" style="margin-bottom:14px">' + tabs.map(function(t){
    return '<button class="store-btn' + (ptTab === t[0] ? ' active' : '') + '" onclick="ptSwitch(\'' + t[0] + '\')">' + t[1] + '</button>' }).join('') +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="ptReload()">↻ 重新讀取</button></div>';
  if (ptData.isDefault) h += '<div class="card" style="background:#fbf6e8;border-color:var(--gold-line);font-size:var(--fs-sm);margin-bottom:14px">' +
    '目前用的是程式內建的預設設定，還沒在這裡存過。改完按「儲存」之後，就會以這裡的為準。</div>';
  h += ptTab === 'postcard' ? ptPostcardHtml() : ptTab === 'settings' ? ptSettingsHtml() : ptOverviewHtml();
  el.innerHTML = h;
}
function ptSwitch(t){ ptTab = t; renderPets() }
async function ptReload(){ ptData = null; await renderPets() }

function ptStat(n, label, sub){
  return '<div class="card" style="flex:1;min-width:130px;text-align:center"><div style="font-size:26px;font-weight:700;color:var(--gold,#b8860b)">' + n +
    '</div><div style="font-size:var(--fs-sm)">' + label + '</div>' + (sub ? '<div class="muted" style="font-size:var(--fs-xs)">' + sub + '</div>' : '') + '</div>';
}
function ptOverviewHtml(){
  var d = ptData, c = d.cfg, P = d.pets || [];
  var cnt = function(s){ return P.filter(function(p){ return p.away === s }).length };
  var h = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
    ptStat(P.length, '認養的小屋', '') +
    ptStat(cnt('hungry'), '肚子餓', c.hungry + ' 天沒來') +
    ptStat(cnt('visit'), '去作客', c.visit + ' 天沒來') +
    ptStat(cnt('trip'), '去旅行', c.trip + ' 天沒來') +
    ptStat(d.count + ' / ' + c.max, d.month.replace('-', ' 年 ') + ' 月推播', '用到 ' + c.hungryStop + ' 則先停「餓了」') + '</div>';
  var rows = P.map(function(p){
    var tag = p.away === 'home' ? '<span class="muted">在家</span>' : '<b>' + PT_AWAY[p.away] + '</b>' + (p.at ? '（' + ptEsc(p.at) + '家）' : '');
    var sent = p.pushed ? [p.pushed.h3 ? '餓了 ✓' : '', p.pushed.post ? '明信片 ✓' : ''].filter(Boolean).join('、') : '';
    return '<tr><td>' + ptEsc(p.house) + '</td><td>' + ptEsc(p.pets) + '</td><td style="text-align:center">' + ptEsc(p.seen.slice(5).replace('-', '/')) + '</td>' +
      '<td style="text-align:center">' + p.days + '</td><td>' + tag + '</td><td style="text-align:center">' + (p.notify ? '開' : '<span class="muted">關</span>') + '</td>' +
      '<td class="muted" style="font-size:var(--fs-xs)">' + sent + '</td></tr>';
  }).join('');
  h += '<div class="card"><h3 style="margin:0 0 8px">每隻寵物的狀況</h3>' +
    '<div class="muted" style="font-size:var(--fs-xs);margin-bottom:8px">「最後有來」＝主人最後一次摸摸、餵食、帶去玩、轉扭蛋或擲骰子的日子（只打開頁面不算）。「推過」是這次離家已經寄出的 LINE。</div>' +
    (P.length ? '<div style="overflow-x:auto"><table class="tbl" style="width:100%"><thead><tr><th>小屋</th><th>寵物</th><th>最後有來</th><th>幾天</th><th>現在</th><th>LINE 通知</th><th>推過</th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="empty">還沒有人認養寵物</div>') + '</div>';
  var L = d.last;
  if (L) {
    var line = function(x){ return ptEsc(x.name) + '・' + ptEsc(x.pets) + '（' + x.days + ' 天，' + (x.kind === 'post' ? '明信片' : '餓了') + (x.why ? '：' + ptEsc(x.why) : '') + '）' };
    h += '<div class="card"><h3 style="margin:0 0 8px">最近一次自動推播（' + ptEsc(L.today) + '）</h3>' +
      '<div style="font-size:var(--fs-sm);line-height:1.8">推出 ' + (L.sent || []).length + ' 則' + ((L.sent || []).length ? '：' + L.sent.map(line).join('、') : '') +
      ((L.held || []).length ? '<br><span class="muted">沒推：' + L.held.map(line).join('、') + '</span>' : '') +
      ((L.failed || []).length ? '<br><span style="color:#b33">失敗：' + L.failed.map(line).join('、') + '</span>' : '') + '</div></div>';
  }
  h += '<div class="card"><h3 style="margin:0 0 8px">先看看</h3><div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<button class="btn btn-outline btn-sm" onclick="ptPreview(false)">今天會推給誰（不會真的推）</button>' +
    '<button class="btn btn-outline btn-sm" onclick="ptPreview(true)">把兩種訊息試發給我自己</button></div><div id="pt-pv" style="font-size:var(--fs-sm);margin-top:10px;line-height:1.8"></div></div>';
  return h;
}
async function ptPreview(send){
  var el = document.getElementById('pt-pv'); el.textContent = send ? '試發中…' : '計算中…';
  try {
    var j = await staffApi('/staff/pets/preview', { send: !!send });
    var line = function(x){ return ptEsc(x.name) + '・' + ptEsc(x.pets) + '（' + x.days + ' 天，' + (x.kind === 'post' ? '明信片' : '餓了') + (x.why ? '：' + ptEsc(x.why) : '') + '）' };
    var h = '今天如果跑排程，會推 ' + j.sent.length + ' 則' + (j.sent.length ? '：' + j.sent.map(line).join('、') : '') +
      (j.held.length ? '<br><span class="muted">不會推：' + j.held.map(line).join('、') + '</span>' : '');
    if (send) h += '<br>' + (j.sample ? '✅ 已經把「肚子餓」和「明信片」各一則試發到你的 LINE（名字用「麻糬」當範例）' : '❌ ' + ptEsc(j.sampleErr || '試發失敗'));
    el.innerHTML = h;
  } catch(e) { el.textContent = '❌ ' + e.message }
}

function ptPostcardHtml(){
  var c = ptDraft, ph = c.photos || [];
  var h = '<div class="card"><h3 style="margin:0 0 6px">明信片照片</h3>' +
    '<div class="muted" style="font-size:var(--fs-sm);margin-bottom:10px;line-height:1.7">寵物去旅行（' + c.trip + ' 天沒來）時，寄給主人的 LINE 明信片會從這裡隨機挑一張。建議拍教室的角落（畫架、顏料櫃、窗邊、作品牆），橫的照片最好看，每個月換一批。沒有照片的話，明信片只有文字。</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:10px">' +
    ph.map(function(u, i){ return '<div style="position:relative"><div style="aspect-ratio:4/3;border-radius:10px;background:#eee center/cover;background-image:url(\'' + ptEsc(u) + '\')"></div>' +
      '<button class="btn btn-outline btn-sm" style="position:absolute;right:6px;top:6px;padding:2px 8px" onclick="ptDelPhoto(' + i + ')">刪除</button></div>' }).join('') + '</div>' +
    '<label class="btn btn-outline btn-sm" style="cursor:pointer">＋ 上傳照片<input type="file" accept="image/*" multiple style="display:none" onchange="ptPickPhotos(this)"></label> <span id="pt-up" class="muted" style="font-size:var(--fs-sm)"></span></div>';
  h += '<div class="card"><h3 style="margin:0 0 6px">當期課程</h3>' +
    '<label style="display:block;font-size:var(--fs-sm);margin-bottom:4px">明信片上的課程介紹（例如：11 月新課「聖誕流體熊」，週末還有位子）</label>' +
    '<textarea id="pt-course" rows="2" style="width:100%;box-sizing:border-box" oninput="ptDraft.course=this.value">' + ptEsc(c.course || '') + '</textarea>' +
    '<label style="display:block;font-size:var(--fs-sm);margin:10px 0 4px">「預約上課」按鈕的網址（留空＝直接開預約頁）</label>' +
    '<input type="text" id="pt-curl" style="width:100%;box-sizing:border-box" placeholder="https://..." value="' + ptEsc(c.courseUrl || '') + '" oninput="ptDraft.courseUrl=this.value.trim()"></div>';
  h += ptSaveBar();
  return h;
}
function ptPickPhotos(inp){
  var files = Array.prototype.slice.call(inp.files || []), st = document.getElementById('pt-up');
  if (!files.length) return;
  var i = 0;
  var next = function(){
    if (i >= files.length) { st.textContent = '✅ 上傳好了，記得按「儲存」'; renderPets(); return }
    var f = files[i++], rd = new FileReader();
    st.textContent = '上傳第 ' + i + ' / ' + files.length + ' 張…';
    rd.onload = function(){
      var im = new Image();
      im.onload = async function(){
        var k = Math.min(1, 1400 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
        cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
        cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
        try {
          var j = await staffApi('/staff/pets/img', { dataUrl: cv.toDataURL('image/jpeg', .86) });
          ptDraft.photos = (ptDraft.photos || []).concat(j.url);
        } catch(e) { st.textContent = '❌ ' + e.message; return }
        next();
      };
      im.onerror = function(){ st.textContent = '❌ 第 ' + i + ' 張打不開'; next() };
      im.src = rd.result;
    };
    rd.readAsDataURL(f);
  };
  next();
}
function ptDelPhoto(i){ ptDraft.photos.splice(i, 1); renderPets() }

function ptSettingsHtml(){
  var c = ptDraft;
  var num = function(k, label, sub){ return '<label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:var(--fs-sm)"><span style="min-width:150px">' + label + '</span>' +
    '<input type="number" min="0" style="width:90px" value="' + ptEsc(c[k]) + '" oninput="ptDraft.' + k + '=Number(this.value)"><span class="muted" style="font-size:var(--fs-xs)">' + (sub || '') + '</span></label>' };
  var chk = function(k, label){ return '<label style="display:flex;gap:8px;align-items:center;margin:6px 0;font-size:var(--fs-sm)"><input type="checkbox"' + (c[k] !== false ? ' checked' : '') +
    ' onchange="ptDraft.' + k + '=this.checked">' + label + '</label>' };
  var txt = function(k, label){ return '<label style="display:block;font-size:var(--fs-sm);margin:10px 0 4px">' + label + '</label>' +
    '<textarea rows="3" style="width:100%;box-sizing:border-box" oninput="ptDraft.' + k + '=this.value">' + ptEsc(c[k] || '') + '</textarea>' };
  return '<div class="card"><h3 style="margin:0 0 6px">幾天沒來會怎樣</h3>' +
    num('hungry', '肚子餓（推 LINE）', '天') + num('visit', '去別人家作客（不推）', '天') + num('trip', '去旅行、寄明信片（推 LINE）', '天') +
    num('gift', '回家伴手禮', '點親密度（離家回來時送）') + '</div>' +
    '<div class="card"><h3 style="margin:0 0 6px">推播</h3>' +
    chk('hungryOn', '推「肚子餓」') + chk('postcardOn', '推「明信片」') +
    num('max', '每月最多推幾則', '官方帳號每月 6,000 則，其他通知也要用') + num('hungryStop', '推到幾則先停「餓了」', '之後只推明信片') +
    '<div class="muted" style="font-size:var(--fs-xs);margin-top:6px">文案裡 {name} 會換成寵物的名字、{days} 換成幾天沒來。每次離家，兩種訊息各只寄一次；家長自己可以在作品小屋「我的寵物」關掉。</div>' +
    txt('hungryText', '「肚子餓」的文字') + txt('postcardText', '「明信片」的文字') + '</div>' + ptSaveBar();
}
function ptSaveBar(){
  return '<div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="btn" onclick="ptSave()">儲存</button>' +
    '<span id="pt-st" class="muted" style="font-size:var(--fs-sm)">' + (ptData.cfg.at ? '上次儲存：' + ptEsc(String(ptData.cfg.at).slice(0, 16).replace('T', ' ')) + (ptData.cfg.by ? '（' + ptEsc(ptData.cfg.by) + '）' : '') : '') + '</span></div>';
}
async function ptSave(){
  var st = document.getElementById('pt-st'); st.textContent = '儲存中…';
  try {
    var j = await staffApi('/staff/pets/config', { cfg: ptDraft });
    ptData.cfg = j.cfg; ptData.isDefault = false; ptDraft = JSON.parse(JSON.stringify(j.cfg));
    renderPets();
    var s2 = document.getElementById('pt-st'); if (s2) s2.textContent = '✅ 已儲存';
  } catch(e) { st.textContent = '❌ ' + e.message }
}
