/* ══════════════════════════════════════════════════════════
   📣 活動公告（2026-10-10，扭蛋活動底下的分頁）
   餐敘、展覽、看展……上傳海報、設日期，遊樂島就會：
   公告板掛海報、熱氣球拉倒數布條、進島跳一次通知、「💐 我想去」花牆、活動前幾天島上越來越多花。
   日期可以隨時改（例如 12/20 改 12/19），島上的倒數和開花進度會跟著新日期走。
   報名一律在櫃檯；「我想去」只是湊人氣，不是報名。
   資料在 otto2-booking-f9ef7 的 events/，透過伺服器 /staff/events* 讀寫。
   ══════════════════════════════════════════════════════════ */
var evData = null, evEdit = null, evShowWant = {};
async function evLoad(){ evData = await staffApi('/staff/events', {}) }
function evMd(d){ return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '' }
function evDaysTo(d){ return Math.round((Date.parse(d + 'T00:00:00+08:00') - Date.parse(evData.today + 'T00:00:00+08:00')) / 864e5) }
function evHtml(){
  if (evEdit) return evFormHtml();
  var list = Object.values(evData.list || {}).sort(function(a, b){ return String(b.date).localeCompare(String(a.date)) });
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center">活動公告' +
    '<button class="btn btn-gold btn-sm" style="margin-left:auto" onclick="evNew()">＋ 新增活動</button></div>' +
    '<div class="muted" style="font-size:12.5px;line-height:1.8;margin-bottom:10px">放上去的活動，遊樂島會自動：公告板掛海報、熱氣球拉「倒數 N 天」布條、客人進島時跳一次通知、' +
    '「💐 我想去」花牆，活動前幾天島上開始開花，越接近開越多。活動當天過完就自動收掉。<br>報名一律在櫃檯，「我想去」只是讓大家看得到人氣，不是報名。</div>';
  if (!list.length) h += '<div class="empty">還沒有活動，按右上角「＋ 新增活動」。</div>';
  list.forEach(function(e){
    var w = (evData.want || {})[e.id] || {}, ws = Object.keys(w).map(function(k){ return w[k] }).sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
    var dt = evDaysTo(e.date), st = e.on === false ? '<span style="color:var(--text3)">已關閉</span>' : dt < 0 ? '<span style="color:var(--text3)">已結束</span>' :
      (e.showFrom && evData.today < e.showFrom) ? '<span style="color:#b07a1f">' + evMd(e.showFrom) + ' 開始在島上露出</span>' : '<span style="color:#2e7d4f">島上露出中・倒數 ' + dt + ' 天</span>';
    h += '<div style="display:flex;gap:14px;border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;flex-wrap:wrap">' +
      '<div style="width:96px;height:136px;border-radius:8px;background:#eee center/cover no-repeat;flex:none' + (e.poster ? ";background-image:url('" + gcEsc(e.poster) + "')" : '') + '"></div>' +
      '<div style="flex:1 1 220px;min-width:0">' +
      '<div style="font-size:16px;font-weight:600">' + gcEsc(e.title) + '</div>' +
      '<div style="font-size:13.5px;margin:4px 0">' + gcEsc(e.date.replace(/-/g, '/')) + (e.time ? '　' + gcEsc(e.time) : '') + (e.sub ? '<br><span class="muted">' + gcEsc(e.sub) + '</span>' : '') + '</div>' +
      '<div style="font-size:13px">' + st + '</div>' +
      '<div style="font-size:13px;margin-top:6px;cursor:pointer" onclick="evShowWant[\'' + e.id + '\']=!evShowWant[\'' + e.id + '\'];renderGacha()">💐 我想去 <b>' + ws.length + '</b> 人 ' + (ws.length ? (evShowWant[e.id] ? '▴' : '▾ 點我看是誰') : '') + '</div>' +
      (evShowWant[e.id] && ws.length ? '<div style="font-size:12.5px;margin-top:6px;line-height:1.9">' + ws.map(function(x){
        return gcEsc(x.name || x.nm) + ' <span class="muted">' + gcEsc(x.phone || '（沒綁電話）') + '・' + String(x.at).slice(5, 10).replace('-', '/') + '</span>' }).join('<br>') + '</div>' : '') +
      '</div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn btn-outline btn-sm" onclick="evOpen(\'' + e.id + '\')">編輯</button></div></div>';
  });
  return h + '</div>';
}
function evNew(){ evEdit = { id:'ev' + Date.now().toString(36), title:'', sub:'', date:'', time:'', poster:'', showFrom:evData.today, bloomDays:14, on:true, _new:true }; renderGacha() }
function evOpen(id){ evEdit = JSON.parse(JSON.stringify(evData.list[id])); renderGacha() }
function evInp(id, v, type, w, ph){ return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + gcEsc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + gcEsc(ph) + '"' : '') +
  ' style="width:' + (w || 260) + 'px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px">' }
function evRow(lb, inner, tip){ return '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap"><label style="width:110px;color:var(--text2);font-size:13.5px;padding-top:7px">' + lb + '</label><div style="flex:1 1 240px">' + inner +
  (tip ? '<div class="muted" style="font-size:12px;margin-top:3px">' + tip + '</div>' : '') + '</div></div>' }
function evFormHtml(){
  var e = evEdit;
  return '<div class="card"><div class="card-title">' + (e._new ? '新增活動' : '編輯活動') + '</div>' +
    (evData.cloudinary ? '' : '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px">伺服器還沒設定 Cloudinary，海報暫時不能上傳。</div>') +
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    '<div><div id="ev-pv" style="width:150px;height:212px;border-radius:10px;background:#eee center/cover no-repeat;border:1px solid var(--border)' + (e.poster ? ";background-image:url('" + gcEsc(e.poster) + "')" : '') + '"></div>' +
    '<label class="btn btn-outline btn-sm" style="margin-top:8px;display:inline-block;cursor:pointer">上傳海報<input type="file" accept="image/*" style="display:none" onchange="evPickImg(this)"></label>' +
    '<div id="ev-st" class="muted" style="font-size:12px;margin-top:4px;max-width:150px"></div></div>' +
    '<div style="flex:1 1 320px">' +
    evRow('活動名稱', evInp('ev-title', e.title, 'text', 300, '例：坐下，聊花'), '島上通知和布條會用到，短一點比較好') +
    evRow('一句話說明', evInp('ev-sub', e.sub, 'text', 300, '例：五週年藝術交流餐敘')) +
    evRow('活動日期', evInp('ev-date', e.date, 'date', 170), '改日期就改這裡，島上的倒數和開花會跟著新日期走（海報上的日期要記得換新海報）') +
    evRow('時間', evInp('ev-time', e.time, 'text', 170, '例：晚間 18:30')) +
    evRow('島上開始露出', evInp('ev-from', e.showFrom, 'date', 170), '從這天起公告板、熱氣球布條、進島通知才出現') +
    evRow('開花天數', evInp('ev-bloom', e.bloomDays, 'number', 80) + ' 天', '活動前幾天島上開始開花，越接近越多；0＝不開花') +
    evRow('開關', '<label style="font-size:14px"><input type="checkbox" id="ev-on" ' + (e.on !== false ? 'checked' : '') + '> 在島上顯示</label>') +
    '<input type="hidden" id="ev-poster" value="' + gcEsc(e.poster) + '">' +
    '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><button class="btn btn-gold" onclick="evSave()">儲存</button><button class="btn btn-outline" onclick="evEdit=null;renderGacha()">取消</button>' +
    (e._new ? '' : '<button class="btn btn-outline" style="margin-left:auto;color:#b5482b" onclick="evDel()">刪除活動</button>') + '</div>' +
    '</div></div></div>';
}
/* 海報：縮到最長邊 1400px（島上點開要看得清楚字）、轉 JPEG 再傳 Cloudinary */
function evPickImg(inp){
  var f = inp.files && inp.files[0]; if (!f) return;
  var st = document.getElementById('ev-st'); st.textContent = '處理海報中…';
  var rd = new FileReader();
  rd.onload = function(){
    var im = new Image();
    im.onload = async function(){
      var k = Math.min(1, 1400 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      try {
        st.textContent = '上傳中…';
        var j = await staffApi('/staff/events/img', { id: evEdit.id, dataUrl: cv.toDataURL('image/jpeg', .88) });
        document.getElementById('ev-poster').value = j.url;
        document.getElementById('ev-pv').style.backgroundImage = "url('" + j.url + "')";
        st.textContent = '✅ 海報已上傳，記得按「儲存」';
      } catch(e) { st.textContent = '❌ ' + e.message }
    };
    im.onerror = function(){ st.textContent = '❌ 這個檔案打不開' };
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
}
async function evSave(){
  var v = function(id){ return document.getElementById(id).value.trim() };
  var ev = { id: evEdit.id, title: v('ev-title'), sub: v('ev-sub'), date: v('ev-date'), time: v('ev-time'), showFrom: v('ev-from'),
    bloomDays: +v('ev-bloom') || 0, poster: v('ev-poster'), on: document.getElementById('ev-on').checked };
  if (!ev.title) return alert('請填活動名稱');
  if (!ev.date) return alert('請填活動日期');
  if (!ev.poster && !confirm('還沒上傳海報，島上就只會顯示文字。確定先存嗎？')) return;
  try { await staffApi('/staff/events/save', { ev: ev }); evEdit = null; evData = null; await renderGacha() }
  catch(e) { alert('儲存失敗：' + e.message) }
}
async function evDel(){
  if (!confirm('確定刪除這個活動？島上會馬上拿掉，「我想去」的名單也會一起刪掉。')) return;
  try { await staffApi('/staff/events/delete', { id: evEdit.id }); evEdit = null; evData = null; await renderGacha() }
  catch(e) { alert('刪除失敗：' + e.message) }
}
