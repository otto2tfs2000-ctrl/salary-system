/* ══════════════════════════════════════════════════════════
   📣 活動公告（2026-10-10，左邊「藝術家小活動」裡面的一頁）
   餐敘、展覽、看展……上傳海報、設日期，遊樂島就會：
   倒數看板（輪播）、進島跳一次通知、「💐 我想去」花牆、活動前幾天島上越來越多花；熱氣球在下面「🎈 熱氣球」另外設定。
   日期可以隨時改（例如 12/20 改 12/19），島上的倒數和開花進度會跟著新日期走。
   報名一律在櫃檯；「我想去」只是湊人氣，不是報名。
   資料在 otto2-booking-f9ef7 的 events/，透過伺服器 /staff/events* 讀寫。
   ══════════════════════════════════════════════════════════ */
var evData = null, evEdit = null, evShowWant = {};
async function evLoad(){ evData = await staffApi('/staff/events', {}) }
async function renderEvents(){
  var el = document.getElementById('events-body'); if (!el) return;
  if (!evData) {
    el.innerHTML = '<div class="empty">載入活動公告中…</div>';
    try { await evLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到活動公告：' + gcEsc(e.message) + '</div>'; return }
  }
  el.innerHTML = evHtml();
}
function evMd(d){ return d ? (+d.slice(5, 7)) + '/' + (+d.slice(8, 10)) : '' }
function evDaysTo(d){ return Math.round((Date.parse(d + 'T00:00:00+08:00') - Date.parse(evData.today + 'T00:00:00+08:00')) / 864e5) }
function evHtml(){
  if (evEdit) return evFormHtml();
  if (balEdit) return balFormHtml();
  var list = Object.values(evData.list || {}).sort(function(a, b){ return String(b.date).localeCompare(String(a.date)) });
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center">活動公告' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto;margin-right:8px" onclick="evData=null;renderEvents()">↻ 重新讀取</button>' +
    '<button class="btn btn-gold btn-sm" onclick="evNew()">＋ 新增活動</button></div>' +
    '<div class="muted" style="font-size:var(--fs-xs);line-height:1.8;margin-bottom:10px">放上去的活動，遊樂島會自動：進島後在「藝術問答」上面輪播倒數看板、客人進島時跳一次通知、' +
    '「💐 我想去」花牆，活動前幾天島上開始開花，越接近開越多。活動當天過完就自動收掉。<br>報名一律在櫃檯，「我想去」只是讓大家看得到人氣，不是報名。</div>';
  if (!list.length) h += '<div class="empty">還沒有活動，按右上角「＋ 新增活動」。</div>';
  list.forEach(function(e){
    var w = (evData.want || {})[e.id] || {}, ws = Object.keys(w).map(function(k){ return w[k] }).sort(function(a, b){ return String(b.at).localeCompare(String(a.at)) });
    var dt = evDaysTo(e.date), st = e.on === false ? '<span style="color:var(--text3)">已關閉</span>' : dt < 0 ? '<span style="color:var(--text3)">已結束</span>' :
      (e.showFrom && evData.today < e.showFrom) ? '<span style="color:var(--gold2)">' + evMd(e.showFrom) + ' 開始在島上露出</span>' : '<span style="color:var(--green2)">島上露出中・倒數 ' + dt + ' 天</span>';
    h += '<div style="display:flex;gap:14px;border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;flex-wrap:wrap">' +
      '<div style="width:96px;height:136px;border-radius:8px;background:var(--bg3) center/cover no-repeat;flex:none' + (e.poster ? ";background-image:url('" + gcEsc(e.poster) + "')" : '') + '"></div>' +
      '<div style="flex:1 1 220px;min-width:0">' +
      '<div style="font-size:16px;font-weight:600">' + gcEsc(e.title) + '</div>' +
      '<div style="font-size:var(--fs-sm);margin:4px 0">' + gcEsc(e.date.replace(/-/g, '/')) + (e.time ? '　' + gcEsc(e.time) : '') + (e.sub ? '<br><span class="muted">' + gcEsc(e.sub) + '</span>' : '') + '</div>' +
      '<div style="font-size:var(--fs-sm)">' + st + '</div>' +
      '<div style="font-size:var(--fs-sm);margin-top:6px;cursor:pointer" onclick="evShowWant[\'' + e.id + '\']=!evShowWant[\'' + e.id + '\'];renderEvents()">💐 我想去 <b>' + ws.length + '</b> 人 ' + (ws.length ? (evShowWant[e.id] ? '▴' : '▾ 點我看是誰') : '') + '</div>' +
      (evShowWant[e.id] && ws.length ? '<div style="font-size:var(--fs-xs);margin-top:6px;line-height:1.9">' + ws.map(function(x){
        return gcEsc(x.name || x.nm) + ' <span class="muted">' + gcEsc(x.phone || '（沒綁電話）') + '・' + String(x.at).slice(5, 10).replace('-', '/') + '</span>' }).join('<br>') + '</div>' : '') +
      '</div><div style="display:flex;flex-direction:column;gap:6px"><button class="btn btn-outline btn-sm" onclick="evOpen(\'' + e.id + '\')">編輯</button></div></div>';
  });
  return h + '</div>' + balListHtml();
}
function evNew(){ evEdit = { id:'ev' + Date.now().toString(36), title:'', sub:'', date:'', time:'', poster:'', poster2:'', showFrom:evData.today, bloomDays:14, bloomFrom:'', on:true, _new:true }; renderEvents() }
function evOpen(id){ evEdit = JSON.parse(JSON.stringify(evData.list[id])); renderEvents() }
function evInp(id, v, type, w, ph){ return '<input id="' + id + '" type="' + (type || 'text') + '" value="' + gcEsc(v == null ? '' : v) + '"' + (ph ? ' placeholder="' + gcEsc(ph) + '"' : '') +
  ' style="width:' + (w || 260) + 'px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-sm)">' }
function evRow(lb, inner, tip){ return '<div style="display:flex;gap:10px;align-items:flex-start;margin-bottom:10px;flex-wrap:wrap"><label style="width:110px;color:var(--text2);font-size:var(--fs-sm);padding-top:7px">' + lb + '</label><div style="flex:1 1 240px">' + inner +
  (tip ? '<div class="muted" style="font-size:var(--fs-xs);margin-top:3px">' + tip + '</div>' : '') + '</div></div>' }
function evFormHtml(){
  var e = evEdit;
  return '<div class="card"><div class="card-title">' + (e._new ? '新增活動' : '編輯活動') + '</div>' +
    (evData.cloudinary ? '' : '<div class="card" style="background:#fbf6e8;border-color:var(--gold-line);font-size:var(--fs-sm)">伺服器還沒設定 Cloudinary，海報暫時不能上傳。</div>') +
    '<div style="display:flex;gap:16px;flex-wrap:wrap">' +
    '<div><div style="display:flex;gap:10px">' +
    '<div><div class="muted" style="font-size:var(--fs-xs);margin-bottom:4px">第 1 張（先看到）</div><div id="ev-pv" style="width:150px;height:212px;border-radius:10px;background:var(--bg3) center/cover no-repeat;border:1px solid var(--border)' + (e.poster ? ";background-image:url('" + gcEsc(e.poster) + "')" : '') + '"></div>' +
    '<label class="btn btn-outline btn-sm" style="margin-top:8px;display:inline-block;cursor:pointer">上傳海報<input type="file" accept="image/*" style="display:none" onchange="evPickImg(this,1)"></label></div>' +
    '<div><div class="muted" style="font-size:var(--fs-xs);margin-bottom:4px">第 2 張（選填，左右滑）</div><div id="ev-pv2" style="width:150px;height:212px;border-radius:10px;background:var(--bg3) center/cover no-repeat;border:1px solid var(--border)' + (e.poster2 ? ";background-image:url('" + gcEsc(e.poster2) + "')" : '') + '"></div>' +
    '<label class="btn btn-outline btn-sm" style="margin-top:8px;display:inline-block;cursor:pointer">上傳第二張<input type="file" accept="image/*" style="display:none" onchange="evPickImg(this,2)"></label> ' +
    '<button type="button" class="btn btn-outline btn-sm" style="margin-top:8px" onclick="evClearPoster2()">移除</button></div></div>' +
    '<div id="ev-st" class="muted" style="font-size:var(--fs-xs);margin-top:4px;max-width:320px"></div></div>' +
    '<div style="flex:1 1 320px">' +
    evRow('活動名稱', evInp('ev-title', e.title, 'text', 300, '例：坐下，聊花'), '島上通知和布條會用到，短一點比較好') +
    evRow('一句話說明', evInp('ev-sub', e.sub, 'text', 300, '例：五週年藝術交流餐敘')) +
    evRow('費用', evInp('ev-fee', e.fee || '', 'text', 300, '例：每人 800 元（含餐點）；免費就寫「免費」'), '會用醒目的方式放在「詳細資訊」最上面') +
    evRow('地點', evInp('ev-place', e.place || '', 'text', 300, '例：Otto2 工作室')) +
    evRow('詳細說明', '<textarea id="ev-detail" rows="6" placeholder="例：流程、要帶什麼、報名截止日、退費方式…（最多 1200 字）" style="width:300px;max-width:100%;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-sm);line-height:1.6;font-family:inherit">' + gcEsc(e.detail || '') + '</textarea>', '家長在海報上按「詳細資訊」才看得到；有填任何一項，「＋1 我想去」就會放在詳細資訊裡面，讓家長先看完再按') +
    evRow('活動日期', evInp('ev-date', e.date, 'date', 170), '改日期就改這裡，島上的倒數和開花會跟著新日期走（海報上的日期要記得換新海報）') +
    evRow('時間', evInp('ev-time', e.time, 'text', 170, '例：晚間 18:30')) +
    evRow('島上開始露出', evInp('ev-from', e.showFrom, 'date', 170), '從這天起倒數看板、進島通知才出現') +
    evRow('開花開始日', evInp('ev-bloomfrom', e.bloomFrom || '', 'date', 170), '從這天起花苞開始慢慢打開，活動當天全開。填了這個就以日期為準；不填就用下面的「開花天數」') +
    evRow('開花天數', evInp('ev-bloom', e.bloomDays, 'number', 80) + ' 天', '沒填開花開始日時才用：活動前幾天開始開花（最多 60）；0＝不開花') +
    evRow('開關', '<label style="font-size:var(--fs-sm)"><input type="checkbox" id="ev-on" ' + (e.on !== false ? 'checked' : '') + '> 在島上顯示</label>') +
    '<input type="hidden" id="ev-poster" value="' + gcEsc(e.poster) + '">' +
    '<input type="hidden" id="ev-poster2" value="' + gcEsc(e.poster2 || '') + '">' +
    '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><button class="btn btn-gold" onclick="evSave()">儲存</button><button class="btn btn-outline" onclick="evEdit=null;renderEvents()">取消</button>' +
    (e._new ? '' : '<button class="btn btn-del" style="margin-left:auto" onclick="evDel()">刪除活動</button>') + '</div>' +
    '</div></div></div>';
}
/* 海報：縮到最長邊 1400px（島上點開要看得清楚字）、轉 JPEG 再傳 Cloudinary */
function evPickImg(inp, n){
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
        var j = await staffApi('/staff/events/img', { id: evEdit.id, n: n === 2 ? 2 : 1, dataUrl: cv.toDataURL('image/jpeg', .88) });
        var sfx = n === 2 ? '2' : '';
        document.getElementById('ev-poster' + sfx).value = j.url;
        document.getElementById('ev-pv' + sfx).style.backgroundImage = "url('" + j.url + "')";
        st.textContent = '✅ 第 ' + (n === 2 ? 2 : 1) + ' 張海報已上傳，記得按「儲存」';
      } catch(e) { st.textContent = '❌ ' + e.message }
    };
    im.onerror = function(){ st.textContent = '❌ 這個檔案打不開' };
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
}
function evClearPoster2(){
  document.getElementById('ev-poster2').value = '';
  document.getElementById('ev-pv2').style.backgroundImage = '';
  document.getElementById('ev-st').textContent = '第二張已移除，記得按「儲存」';
}
async function evSave(){
  var v = function(id){ return document.getElementById(id).value.trim() };
  var ev = { id: evEdit.id, title: v('ev-title'), sub: v('ev-sub'), date: v('ev-date'), time: v('ev-time'), showFrom: v('ev-from'),
    bloomDays: +v('ev-bloom') || 0, bloomFrom: v('ev-bloomfrom'), fee: v('ev-fee'), place: v('ev-place'), detail: v('ev-detail'), poster: v('ev-poster'), poster2: v('ev-poster2'), on: document.getElementById('ev-on').checked };
  if (!ev.title) return alert('請填活動名稱');
  if (!ev.date) return alert('請填活動日期');
  if (ev.bloomFrom && ev.bloomFrom > ev.date) return alert('開花開始日不能比活動日晚');
  if (!ev.poster && !confirm('還沒上傳海報，島上就只會顯示文字。確定先存嗎？')) return;
  try { await staffApi('/staff/events/save', { ev: ev }); evEdit = null; evData = null; await renderEvents() }
  catch(e) { alert('儲存失敗：' + e.message) }
}
async function evDel(){
  if (!confirm('確定刪除這個活動？島上會馬上拿掉，「我想去」的名單也會一起刪掉。')) return;
  try { await staffApi('/staff/events/delete', { id: evEdit.id }); evEdit = null; evData = null; await renderEvents() }
  catch(e) { alert('刪除失敗：' + e.message) }
}

/* ══════════════════════════════════════════════════════════
   🎈 熱氣球（2026-10-12）：A／B／C 三款，填好存檔就出現在遊樂島、吉祥物島、作品小屋；到期自動收掉。
   A 大氣球（主標＋副標）／B 直式飄帶（日期＋活動名＋倒數）／C 單色大字球（一句話）；三款都可以綁活動，在島後面的天空
   同時最多 3 顆（開始日早的先上）。資料在 balloons/list/，跟活動清單一起讀。
   2026-10-13 改成「先填內容、再挑款式」：內容＝綁活動／自己寫字／放圖（用活動海報或自己上傳），款式 A／B／C 只是外觀；
   位置可以指定（上排／中排 × 左／中／右，共 6 格），不指定就自動挑不會被標題蓋住的位置。
   ══════════════════════════════════════════════════════════ */
var balEdit = null;
var BAL_COL = { pink:'#e8708f', blue:'#3d9bd0', orange:'#f2a04a', green:'#8cc152', yellow:'#f6cf4a', purple:'#9b7fd0' };
var BAL_COL_DK = { pink:'#c93f66', blue:'#226a97', orange:'#b8651a', green:'#4d7f1f', yellow:'#9a7608', purple:'#5e43a0' };
var BAL_COL_NM = { pink:'粉紅', blue:'天藍', orange:'橘', green:'草綠', yellow:'黃', purple:'紫' };
var BAL_ST = { A:'A 款・大氣球', B:'B 款・直式飄帶', C:'C 款・單色大字球', S:'S 款・聖誕雪橇布條' };
var BAL_ST_TIP = { A:'大字牌氣球：活動名超大、底下寫日期＋還有幾天（最好讀）', B:'彩條氣球底下垂一條直的飄帶：日期＋活動名＋倒數', C:'單色大氣球，只放一句大字（例：歡迎新同學）', S:'11/1～12/25 聖誕老公公拖著這條布條飛過扭蛋島；點布條會打開綁定的活動。不佔熱氣球的 3 顆名額，最多 3 條輪流掛' };
var BAL_POS_NM = { TL:'左上', TM:'中上', TR:'右上', ML:'左中', MM:'正中', MR:'右中' };
/* 氣球上的圖：用活動海報（綁了活動才有）／自己上傳／不放 */
function evPosterOf(b){ var e = b.eventId && evData && evData.list ? evData.list[b.eventId] : null; return e && e.poster ? e.poster : '' }
function balImgOf(b){ return b.useEvImg ? evPosterOf(b) : (b.img || '') }
function balMode(b){ return b.useEvImg ? 'ev' : (b.img || b._own) ? 'own' : 'none' }
function balStatus(b){
  var t = evData.today, live = evData.live || [];
  if (b.on === false) return '<span style="color:var(--text3)">已關閉</span>';
  if (b.style === 'S' && t < '2026-11-01' && !(b.to && t > b.to)) return '<span style="color:var(--gold2)">11/1 聖誕老公公出現後才會飛</span>';
  if (b.to && t > b.to) return '<span style="color:var(--text3)">已結束</span>';
  if (b.from && t < b.from) return '<span style="color:var(--gold2)">' + evMd(b.from) + ' 開始出現</span>';
  if (live.indexOf(b.id) >= 0) return '<span style="color:var(--green2)">島上出現中</span>';
  if (b.eventId) return '<span style="color:var(--text3)">綁定的活動已結束或關閉</span>';
  return '<span style="color:var(--gold2)">已經有 3 顆在島上，排隊中</span>';
}
function evTitleOf(b){ return b.eventId && evData && evData.list && evData.list[b.eventId] ? (evData.list[b.eventId].title || '') : '' }
function balUrl(u){ return "url('" + String(u).replace(/'/g, '%27') + "')" }
/* 預覽：字依長度縮小、不被圓形切掉；A 跟遊戲裡一樣是「純色氣球＋奶油白大字牌」；有圖就換成圖 */
function balPreview(b){
  var c = BAL_COL[b.color] || BAL_COL.pink, raw = b.title || evTitleOf(b) || b.evTitle || (b.eventId ? '活動名' : '文字'), t = gcEsc(raw), sub = gcEsc(b.sub || (b.eventId ? '日期・倒數' : ''));
  var im = b._img != null ? b._img : balImgOf(b), dk = BAL_COL_DK[b.color] || '#c93f66';
  var len = Array.from(String(raw)).length, fs = len <= 3 ? 17 : len <= 5 ? 14 : len <= 8 ? 11 : 9;
  if (b.style === 'S') {
    return '<div style="width:150px;display:flex;align-items:center;gap:2px"><div style="font-size:22px;line-height:1">🛷</div><div style="flex:1;min-width:0;height:30px;border-radius:6px;border:2px solid ' + dk + ';background:#fff6e4;display:flex;align-items:center;gap:4px;padding:0 4px;box-sizing:border-box;overflow:hidden">' +
      (im ? '<div style="width:22px;height:22px;flex:none;border-radius:3px;background:#eee center/cover no-repeat ' + balUrl(im) + '"></div>' : '') +
      '<div style="flex:1;min-width:0;text-align:center;color:' + dk + ';font-weight:900;font-size:11px;line-height:1.1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + t + (sub ? '<div style="font-size:8px;color:#1e2b4f">' + sub + '</div>' : '') + '</div></div><div style="font-size:16px">🦌</div></div>';
  }
  if (b.style === 'B') {
    var chars = Array.from(String(raw)).slice(0, im ? 3 : 6).map(function(ch){ return '<div>' + gcEsc(ch) + '</div>' }).join('');
    return '<div style="width:70px;text-align:center"><div style="width:44px;height:52px;margin:0 auto;border-radius:50% 50% 46% 46%;background:repeating-linear-gradient(90deg,' + c + ' 0 6px,#fff6e4 6px 12px)"></div>' +
      '<div style="width:26px;margin:-2px auto 0;background:' + c + ';color:#fff;font-size:11px;font-weight:800;line-height:1.2;padding:4px 0;border-radius:2px">' +
      (im ? '<div style="width:20px;height:26px;margin:0 auto 3px;border-radius:2px;background:#fff6e4 center/cover no-repeat ' + balUrl(im) + '"></div>' : '') + chars + '</div></div>';
  }
  if (im) {
    return '<div style="width:70px;height:78px;border-radius:50% 50% 46% 46%;background:' + c + ';display:flex;align-items:center;justify-content:center;box-sizing:border-box;overflow:hidden">' +
      '<div style="width:40px;height:54px;border-radius:6px;border:2px solid ' + (b.style === 'C' ? '#fff' : dk) + ';background:#fff6e4 center/cover no-repeat ' + balUrl(im) + '"></div></div>';
  }
  if (b.style === 'C') return '<div style="width:70px;height:78px;border-radius:50% 50% 46% 46%;background:' + c + ';color:#fff;font-weight:800;font-size:' + fs + 'px;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;text-align:center;padding:0 10px;box-sizing:border-box;overflow:hidden;word-break:break-all">' + t + (sub ? '<small style="font-size:9px;opacity:.9">' + sub + '</small>' : '') + '</div>';
  return '<div style="width:70px;height:78px;border-radius:50% 50% 46% 46%;background:' + c + ';display:flex;align-items:center;justify-content:center;box-sizing:border-box;overflow:hidden">' +
    '<div style="width:46px;background:#fff6e4;border-radius:8px;padding:4px 2px;text-align:center;color:' + dk + ';font-weight:900;font-size:' + Math.min(fs, 14) + 'px;line-height:1.1;word-break:break-all">' + t +
    (sub ? '<div style="font-size:8px;color:#1e2b4f;margin-top:2px">' + sub + '</div>' : '') + '</div></div>';
}
function balListHtml(){
  var list = Object.values(evData.bal || {}).sort(function(a, b){ return String(b.from || '').localeCompare(String(a.from || '')) });
  var h = '<div class="card"><div class="card-title" style="display:flex;align-items:center">🎈 熱氣球' +
    '<button class="btn btn-gold btn-sm" style="margin-left:auto" onclick="balNew()">＋ 新增熱氣球</button></div>' +
    '<div class="muted" style="font-size:var(--fs-xs);line-height:1.8;margin-bottom:10px">做法：先填內容（綁活動、自己寫字，或放圖），再挑款式（A／B／C 熱氣球，或 S 聖誕雪橇布條），最後可以指定它在天空的哪個位置。' +
    '填好存檔，遊樂島、吉祥物島、作品小屋就會出現；過了「結束日」自動收掉。<b>同時最多 3 顆</b>（開始日早的先上）。沒指定位置的會自動挑不會被標題蓋住的位置。</div>';
  if (!list.length) h += '<div class="empty">還沒有熱氣球，按右上角「＋ 新增熱氣球」。</div>';
  list.forEach(function(b){
    h += '<div style="display:flex;gap:14px;border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:10px;flex-wrap:wrap;align-items:center">' +
      '<div style="flex:none;width:76px;display:flex;justify-content:center">' + balPreview(b) + '</div>' +
      '<div style="flex:1 1 200px;min-width:0"><div style="font-size:var(--fs-md);font-weight:600">' + gcEsc(BAL_ST[b.style] || b.style) + '</div>' +
      '<div style="font-size:var(--fs-sm);margin:3px 0">' + gcEsc(b.title || (b.eventId && evData.list && evData.list[b.eventId] ? '（跟著活動：' + evData.list[b.eventId].title + '）' : '')) + (b.sub ? '<span class="muted">　' + gcEsc(b.sub) + '</span>' : '') + '</div>' +
      '<div style="font-size:var(--fs-xs)" class="muted">' + (b.from ? evMd(b.from) : '馬上') + ' ～ ' + (b.to ? evMd(b.to) : '不設結束日') +
      '　位置：' + (b.style === 'S' ? '跟著雪橇飛' : (BAL_POS_NM[b.pos] || '自動')) + (balImgOf(b) ? '　🖼 有圖' : '') + '</div>' +
      '<div style="font-size:var(--fs-sm);margin-top:3px">' + balStatus(b) + '</div></div>' +
      '<button class="btn btn-outline btn-sm" onclick="balOpen(\'' + b.id + '\')">編輯</button></div>';
  });
  return h + '</div>';
}
function balNew(){ balEdit = { id:'bl' + Date.now().toString(36), style:'A', title:'', sub:'', color:'pink', eventId:'', from:evData.today, to:'', on:true, pos:'', img:'', useEvImg:false, _new:true }; renderEvents() }
function balOpen(id){ balEdit = JSON.parse(JSON.stringify(evData.bal[id])); balEdit.pos = balEdit.pos || ''; balEdit.img = balEdit.img || ''; balEdit.useEvImg = !!balEdit.useEvImg; renderEvents() }
function balSync(){
  var g = function(id){ var e = document.getElementById(id); return e ? e.value.trim() : '' };
  balEdit.title = g('bl-title'); balEdit.sub = g('bl-sub'); balEdit.from = g('bl-from'); balEdit.to = g('bl-to');
  var ev = document.getElementById('bl-ev'); if (ev) { balEdit.eventId = ev.value; if (!ev.value) balEdit.useEvImg = false }
  var on = document.getElementById('bl-on'); if (on) balEdit.on = on.checked;
}
function balSet(k, v){ balSync(); balEdit[k] = v; renderEvents() }
function balSetMode(m){
  balSync();
  if (m === 'ev') { balEdit.useEvImg = true }
  else if (m === 'own') { balEdit.useEvImg = false; balEdit._own = true }
  else { balEdit.useEvImg = false; balEdit.img = ''; balEdit._own = false }
  renderEvents();
}
/* 自己的圖：縮到最長邊 1000px、轉 JPEG 傳 Cloudinary（氣球上很小，不用太大） */
function balPickImg(inp){
  var f = inp.files && inp.files[0]; if (!f) return;
  var st = document.getElementById('bl-st'); st.textContent = '處理圖片中…';
  var rd = new FileReader();
  rd.onload = function(){
    var im = new Image();
    im.onload = async function(){
      var k = Math.min(1, 1000 / Math.max(im.width, im.height)), cv = document.createElement('canvas');
      cv.width = Math.round(im.width * k); cv.height = Math.round(im.height * k);
      cv.getContext('2d').drawImage(im, 0, 0, cv.width, cv.height);
      try {
        st.textContent = '上傳中…';
        var j = await staffApi('/staff/balloons/img', { id: balEdit.id, dataUrl: cv.toDataURL('image/jpeg', .88) });
        balSync(); balEdit.img = j.url; balEdit.useEvImg = false; balEdit._own = true; renderEvents();
      } catch(e) { st.textContent = '❌ ' + e.message }
    };
    im.onerror = function(){ st.textContent = '❌ 這個檔案打不開' };
    im.src = rd.result;
  };
  rd.readAsDataURL(f);
}
/* 位置：畫面上方天空的 6 格。手機直式時左上、中上會被大標題蓋住，所以格子上有提醒 */
function balPosPicker(b){
  var used = {};
  Object.values(evData.bal || {}).forEach(function(o){ if (o.id !== b.id && o.pos && o.on !== false) used[o.pos] = o.style });
  var cell = function(k){
    var on = b.pos === k, u = used[k], warn = k === 'TL' || k === 'TM';
    return '<div onclick="balSet(\'pos\',\'' + k + '\')" style="cursor:pointer;flex:1 1 0;min-width:70px;text-align:center;padding:10px 4px;border-radius:10px;border:2px solid ' + (on ? 'var(--gold)' : 'var(--border)') + ';background:' + (on ? '#fbf6e8' : '#fff') + '">' +
      '<div style="font-weight:600;font-size:var(--fs-sm)">' + BAL_POS_NM[k] + '</div>' +
      (u ? '<div style="font-size:var(--fs-xs);color:var(--gold2)">已有 ' + u + ' 款</div>' : warn ? '<div style="font-size:var(--fs-xs)" class="muted">手機會被標題蓋</div>' : '<div style="font-size:var(--fs-xs)" class="muted">&nbsp;</div>') + '</div>';
  };
  var auto = '<div onclick="balSet(\'pos\',\'\')" style="cursor:pointer;padding:8px 12px;border-radius:10px;border:2px solid ' + (!b.pos ? 'var(--gold)' : 'var(--border)') + ';background:' + (!b.pos ? '#fbf6e8' : '#fff') + ';display:inline-block;margin-bottom:8px;font-size:var(--fs-sm);font-weight:600">自動（系統挑不會被蓋住的位置）</div>';
  return auto + '<div style="max-width:420px;background:#dff0fb;border-radius:12px;padding:8px">' +
    '<div style="display:flex;gap:6px;margin-bottom:6px">' + ['TL', 'TM', 'TR'].map(cell).join('') + '</div>' +
    '<div style="display:flex;gap:6px">' + ['ML', 'MM', 'MR'].map(cell).join('') + '</div>' +
    '<div class="muted" style="font-size:var(--fs-xs);text-align:center;margin-top:6px">↑ 遊樂島畫面上方的天空（上排最靠近標題，中排在雲上面）</div></div>';
}
function balFormHtml(){
  var b = balEdit, st = b.style, mode = balMode(b), evPost = evPosterOf(b), curImg = balImgOf(b);
  var styleBtns = ['A', 'B', 'C', 'S'].map(function(k){
    var on = st === k;
    return '<div onclick="balSet(\'style\',\'' + k + '\')" style="cursor:pointer;flex:1 1 150px;border:2px solid ' + (on ? 'var(--gold)' : 'var(--border)') + ';background:' + (on ? '#fbf6e8' : '#fff') + ';border-radius:12px;padding:10px;text-align:center">' +
      '<div style="display:flex;justify-content:center;margin-bottom:6px">' + balPreview({ style:k, color:b.color, title:b.title, sub:b.sub, eventId:b.eventId, evTitle:evTitleOf(b), _img:curImg }) + '</div>' +
      '<div style="font-weight:600;font-size:var(--fs-sm)">' + BAL_ST[k] + '</div><div class="muted" style="font-size:var(--fs-xs);line-height:1.5;margin-top:3px">' + BAL_ST_TIP[k] + '</div></div>';
  }).join('');
  var cols = Object.keys(BAL_COL).map(function(k){
    var on = b.color === k;
    return '<span onclick="balSet(\'color\',\'' + k + '\')" title="' + BAL_COL_NM[k] + '" style="cursor:pointer;display:inline-block;width:34px;height:34px;border-radius:50%;background:' + BAL_COL[k] + ';border:3px solid ' + (on ? '#1e2b4f' : '#fff') + ';box-shadow:0 0 0 1px var(--border);margin-right:8px"></span>';
  }).join('');
  var evOpts = '<option value="">不綁活動（自己寫字）</option>' + Object.values(evData.list || {}).sort(function(a, c){ return String(a.date).localeCompare(String(c.date)) }).map(function(e){
    return '<option value="' + gcEsc(e.id) + '"' + (b.eventId === e.id ? ' selected' : '') + '>' + evMd(e.date) + ' ' + gcEsc(e.title) + '</option>' }).join('');
  var titleLb = st === 'A' ? '主標（最多 12 字）' : '氣球上的字（最多 10 字）';
  var mBtn = function(m, lb, dis){
    var on = mode === m;
    return '<button type="button" ' + (dis ? 'disabled title="要先綁一個有海報的活動"' : 'onclick="balSetMode(\'' + m + '\')"') + ' class="btn ' + (on ? 'btn-gold' : 'btn-outline') + ' btn-sm" style="margin-right:6px' + (dis ? ';opacity:.45' : '') + '">' + lb + '</button>';
  };
  var imgRow = mBtn('none', '不放圖') + mBtn('ev', '用活動海報', !(b.eventId && evPost)) + mBtn('own', '自己上傳') +
    (mode === 'own' ? '<div style="margin-top:8px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
      '<div style="width:54px;height:72px;border-radius:8px;background:var(--bg3) center/cover no-repeat;border:1px solid var(--border)' + (b.img ? ';background-image:' + balUrl(b.img) : '') + '"></div>' +
      '<label class="btn btn-outline btn-sm" style="cursor:pointer">' + (b.img ? '換一張' : '選擇圖片') + '<input type="file" accept="image/*" style="display:none" onchange="balPickImg(this)"></label>' +
      '<span id="bl-st" class="muted" style="font-size:var(--fs-xs)">' + (b.img ? '' : '還沒有圖片') + '</span></div>' : '') +
    (mode === 'ev' ? '<div class="muted" style="font-size:var(--fs-xs);margin-top:6px">會直接用這個活動第一張海報，活動公告改海報，氣球跟著換。</div>' : '');
  var sec = function(n, t){ return '<div style="font-weight:600;font-size:var(--fs-md);margin:16px 0 8px;padding-top:12px;border-top:1px solid var(--border)">' + n + ' ' + t + '</div>' };
  return '<div class="card"><div class="card-title">' + (b._new ? '新增熱氣球' : '編輯熱氣球') + '</div>' +
    '<div style="font-weight:600;font-size:var(--fs-md);margin-bottom:8px">① 氣球上要放什麼內容</div>' +
    evRow('綁定活動', '<select id="bl-ev" onchange="balSync();renderEvents()" style="padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:var(--fs-sm);max-width:100%">' + evOpts + '</select>', '綁了之後氣球自動寫「活動名＋日期＋倒數」，活動結束氣球跟著收') +
    (b.eventId ? '' : evRow(titleLb, evInp('bl-title', b.title, 'text', 300, '例：歡迎新同學'), '用圖片的話可以不填')) +
    (b.eventId ? '' : evRow(st === 'A' ? '副標（最多 16 字）' : '小字（最多 16 字，可不填）', evInp('bl-sub', b.sub, 'text', 300, st === 'A' ? '例：12/20 18:30' : ''))) +
    evRow('氣球上的圖', imgRow, '選填。放圖的話，氣球上會貼一張圖（A／C 款貼在字牌位置，B 款貼在飄帶上）') +
    sec('②', '挑款式（下面四張都是用上面的內容做的預覽，點一張就換）') +
    '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:6px">' + styleBtns + '</div>' +
    evRow('顏色', cols) +
    sec('③', '放在天空的哪裡') + (st === 'S' ? '<div class="muted" style="font-size:var(--fs-sm)">雪橇會從扭蛋島上方左右飛過，不用選位置。</div>' : balPosPicker(b)) +
    sec('④', '什麼時候出現') +
    evRow('開始出現', evInp('bl-from', b.from, 'date', 170), '這天起島上才出現') +
    evRow('結束日', evInp('bl-to', b.to, 'date', 170), '過了這天自動收掉；不填＝一直掛著，要自己關') +
    evRow('開關', '<label style="font-size:var(--fs-sm)"><input type="checkbox" id="bl-on" ' + (b.on !== false ? 'checked' : '') + '> 在島上顯示</label>') +
    '<div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap"><button class="btn btn-gold" onclick="balSave()">儲存</button><button class="btn btn-outline" onclick="balEdit=null;renderEvents()">取消</button>' +
    (b._new ? '' : '<button class="btn btn-del" style="margin-left:auto" onclick="balDel()">刪除</button>') + '</div></div>';
}
async function balSave(){
  balSync();
  var b = balEdit;
  if (!b.eventId && !b.title && !balImgOf(b)) return alert('請填氣球上的字、選一個要綁的活動，或放一張圖');
  if (b.useEvImg && !evPosterOf(b)) return alert('這個活動還沒有上傳海報，沒辦法用活動海報。請改選「自己上傳」或「不放圖」');
  if (!b.useEvImg && balMode(b) === 'own' && !b.img && !b.eventId && !b.title) return alert('選了「自己上傳」但還沒有圖片');
  try {
    await staffApi('/staff/balloons/save', { b: { id:b.id, style:b.style, title:b.title, sub:b.sub, color:b.color, eventId:b.eventId, from:b.from, to:b.to, on:b.on !== false,
      pos:b.pos || '', img:b.useEvImg ? '' : (b.img || ''), useEvImg:!!b.useEvImg } });
    balEdit = null; evData = null; await renderEvents();
  } catch(e) { alert('儲存失敗：' + e.message) }
}
async function balDel(){
  if (!confirm('確定刪除這顆熱氣球？島上會馬上拿掉。')) return;
  try { await staffApi('/staff/balloons/delete', { id: balEdit.id }); balEdit = null; evData = null; await renderEvents() }
  catch(e) { alert('刪除失敗：' + e.message) }
}
