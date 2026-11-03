/* ══════════════════════════════════════════════════════════
   🎧 講堂收聽紀錄（2026-11-03）
   大熊要看「畫框背後」到底有多少人在聽，再決定要不要收費。2026-11-03 才開始記，之前的資料沒有。
   員工不算。「聽完」＝一集實際播過 90% 以上。資料在 otto2-booking-f9ef7 的 hallPlays，透過伺服器（/staff/hall-stats）讀。
   ══════════════════════════════════════════════════════════ */
var HS_ROOMS = { vangogh:'梵谷', monet:'莫內', klimt:'克林姆', rembrandt:'林布蘭', davinci:'達文西', hokusai:'葛飾北齋' };

function hsEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function hsEp(ep){ return ep === 'guide' ? '總導覽' : ep.toUpperCase() }
function hsCard(n, label){
  return '<div class="card" style="margin:0;padding:14px;text-align:center"><div style="font-size:26px;font-weight:600">' + n + '</div>' +
    '<div class="muted" style="font-size:var(--fs-xs)">' + label + '</div></div>';
}

async function renderHallStats(){
  var el = document.getElementById('hallstats-body');
  if (!el) return;
  el.innerHTML = '<div class="empty">載入收聽紀錄中…</div>';
  var d;
  try { d = await staffApi('/staff/hall-stats', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + hsEsc(e.message) + '</div>'; return }
  var enterRooms = Object.keys(d.rooms).reduce(function(t, r){ return t + (d.rooms[r].enter || 0) }, 0);
  var h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div class="muted" style="font-size:var(--fs-sm)">2026-11-03 起開始記，之前的資料沒有。員工不算（目前略過 ' + (d.staffSkipped || 0) + ' 位）。</div>' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto;flex:none" onclick="renderHallStats()">↻ 重新讀取</button></div>';
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:16px">' +
    hsCard(d.hallEnter, '進過大廳') + hsCard(enterRooms, '進展間（人次：每人每位藝術家算一次）') + hsCard(d.listened, '聽過至少一集') + hsCard(d.finished, '聽完至少一集') + hsCard(d.members, '其中是會員') + hsCard(d.anon, '沒登入的訪客') + '</div>';

  var rooms = Object.keys(d.rooms);
  if (!rooms.length) h += '<div class="empty">還沒有人聽過。</div>';
  rooms.forEach(function(r){
    var R = d.rooms[r], eps = Object.keys(R.eps).sort(function(a, b){ return a === 'guide' ? -1 : b === 'guide' ? 1 : a.localeCompare(b) });
    h += '<div class="card" style="margin:0 0 12px"><div style="font-weight:600;margin-bottom:8px">' + hsEsc(HS_ROOMS[r] || r) + '　<span class="muted" style="font-weight:400;font-size:var(--fs-sm)">進展間 ' + (R.enter || 0) + ' 人</span></div>';
    h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm);white-space:nowrap"><tr class="muted"><th style="text-align:left;padding:5px">集數</th><th>聽的人</th><th>聽到 50%</th><th>聽完</th><th>播放次數</th></tr>';
    eps.forEach(function(ep){ var E = R.eps[ep];
      h += '<tr style="border-top:1px solid var(--line,#eee);text-align:center"><td style="text-align:left;padding:5px">' + hsEp(ep) + '</td><td>' + E.people + '</td><td>' + E.p50 + '</td><td>' + E.done + '</td><td>' + E.plays + '</td></tr>' });
    h += '</table></div></div>';
  });

  var list = d.list || [];
  h += '<div class="card" style="margin:0"><div style="font-weight:600;margin-bottom:8px">誰在聽（' + list.length + ' 位，聽完多的排前面）</div>';
  if (!list.length) h += '<div class="muted" style="font-size:var(--fs-sm)">還沒有資料。</div>';
  else h += '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm);white-space:nowrap"><tr class="muted"><th style="text-align:left;padding:5px">名字</th><th>身分</th><th>聽過</th><th>聽完</th><th>最後來的時間</th></tr>' +
    list.map(function(p){
      var who = p.anon ? '訪客' : (p.name || '未綁電話'), tag = p.anon ? '未登入' : p.member ? '會員' : '非會員';
      var last = p.last ? new Date(p.last).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }) : '';
      return '<tr style="border-top:1px solid var(--line,#eee);text-align:center"><td style="text-align:left;padding:5px">' + hsEsc(who) + '</td><td>' + tag + '</td><td>' + p.heard + ' 集</td><td>' + p.done + ' 集</td><td>' + hsEsc(last) + '</td></tr>';
    }).join('') + '</table></div>';
  h += '</div>';
  el.innerHTML = h;
}
