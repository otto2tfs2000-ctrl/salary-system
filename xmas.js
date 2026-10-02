/* ══════════════════════════════════════════════════════════
   聖誕走格子分頁（2026-10-02）
   客人在預約頁玩的「11–12 月聖誕走格子」：這裡看發放狀況、改獎勵與上限。

   資料在 otto2-booking-f9ef7 的 xmas/ 底下，一律透過伺服器（/staff/xmas*）讀寫，
   瀏覽器不直接碰資料庫。紅利、票券一領就已經寫進會員資料了
   （會員分頁的明細看得到，操作者欄寫「聖誕走格子」）；這裡改設定只影響之後的領取。
   ══════════════════════════════════════════════════════════ */

var xmData = null, xmDraft = null, xmTab = 'overview', xmLoading = false;

function xmEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
var XM_TYPE = { gift:'禮物', bonus:'紅利點數', ticket:'票券' };

async function xmLoad(){
  xmLoading = true;
  try {
    xmData = await staffApi('/staff/xmas', {});
    xmDraft = JSON.parse(JSON.stringify(xmData.cfg));
  } finally { xmLoading = false }
}

async function renderXmas(){
  var el = document.getElementById('xmas-body');
  if (!el) return;
  if (!xmData) {
    el.innerHTML = '<div class="empty">載入聖誕走格子資料中…</div>';
    try { await xmLoad() } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + xmEsc(e.message) + '</div>'; return }
  }
  var tabs = [['overview','總覽'],['rewards','獎勵設定'],['pool','扭蛋機獎池'],['settings','活動設定']];
  var h = '<div class="store-tabs" style="margin-bottom:14px">' + tabs.map(function(t){
    return '<button class="store-btn' + (xmTab === t[0] ? ' active' : '') + '" onclick="xmSwitch(\'' + t[0] + '\')">' + t[1] + '</button>' }).join('') +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto" onclick="xmReload()">↻ 重新讀取</button></div>';
  if (xmData.isDefault) h += '<div class="card" style="background:#fff8e6;border-color:#e8d49a;font-size:13px;margin-bottom:14px">' +
    '目前用的是程式內建的預設設定，還沒在這裡存過。改完按「儲存」之後，就會以這裡的為準。</div>';
  h += xmTab === 'rewards' ? xmRewardsHtml() : xmTab === 'pool' ? xmPoolHtml() : xmTab === 'settings' ? xmSettingsHtml() : xmOverviewHtml();
  el.innerHTML = h;
}
function xmSwitch(t){ xmTab = t; renderXmas() }
async function xmReload(){ xmData = null; await renderXmas() }

function xmStat(n, label, sub){
  return '<div class="card" style="flex:1;min-width:130px;text-align:center"><div style="font-size:26px;font-weight:700;color:var(--gold,#b8860b)">' + n +
    '</div><div style="font-size:13px">' + label + '</div>' + (sub ? '<div class="muted" style="font-size:12px">' + sub + '</div>' : '') + '</div>';
}
function xmOverviewHtml(){
  var d = xmData, c = d.cfg, lights = (d.tree && d.tree.lights) || 0, L = c.layers || [], done = L.filter(function(t){ return lights >= t }).length;
  var h = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">' +
    xmStat(d.stats.players, '玩過的會員', '') +
    xmStat(lights.toLocaleString(), '聖誕樹燈數', '目標 ' + (L[4] || 0).toLocaleString() + '，已亮 ' + done + ' / 5 層') +
    xmStat(d.stats.trees, '森林裡的樹', '上限 ' + (c.forestMax || 251)) +
    xmStat(d.stats.lots, '被認領的小屋', '共 ' + ((c.lotIdx || []).length) + ' 間') +
    xmStat(d.stats.pts, '已發出的紅利', '每人上限 ' + c.pointCap + ' 點') + '</div>';
  var rows = (d.players || []).map(function(p){
    return '<tr><td>' + xmEsc(p.name || '—') + '</td><td>' + xmEsc(p.phone.slice(0,4) + '-***-' + p.phone.slice(7)) + '</td>' +
      '<td style="text-align:center">' + p.lights + '</td><td style="text-align:center">' + p.gifts + '</td>' +
      '<td style="text-align:center">' + (p.tree ? 'Lv' + p.tree : '—') + '</td><td style="text-align:center">' + (p.lot != null ? '有' : '—') + '</td>' +
      '<td style="text-align:center">' + p.layers + '</td><td style="text-align:center">' + p.pts + '</td><td style="text-align:center">' + p.tickets + '</td></tr>';
  }).join('');
  h += '<div class="card"><div class="card-title">玩家（依領到的紅利排序，最多 300 位）</div>' +
    (rows ? '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:13px"><tr style="text-align:center;color:var(--text2)"><th style="text-align:left">姓名</th><th style="text-align:left">電話</th><th>點燈</th><th>禮物</th><th>樹</th><th>小屋</th><th>領樹層</th><th>紅利</th><th>票券</th></tr>' + rows + '</table></div>' : '<div class="empty">還沒有人玩</div>') + '</div>';
  var st = d.stock || {};
  if (Object.keys(st).length) h += '<div class="card"><div class="card-title">限量票券已送出</div>' + Object.keys(st).map(function(k){ return xmEsc(k) + '：' + st[k] + ' 張' }).join('　') + '</div>';
  return h;
}

function xmInp(path, v, type, w){
  return '<input ' + (type ? 'type="' + type + '" ' : '') + 'value="' + xmEsc(v == null ? '' : v) + '" style="width:' + (w || 90) + 'px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="xmSet(\'' + path + '\',this.value)">';
}
function xmRow(label, html, note){
  return '<div style="display:grid;grid-template-columns:150px 1fr;gap:10px;align-items:start;margin:10px 0;font-size:13.5px">' +
    '<label style="color:var(--text2);padding-top:6px">' + label + '</label><div>' + html +
    (note ? '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.6">' + note + '</div>' : '') + '</div></div>';
}
function xmSet(path, v){
  var p = path.split('.'), o = xmDraft;
  for (var i = 0; i < p.length - 1; i++) o = o[p[i]] = o[p[i]] != null ? o[p[i]] : (isNaN(+p[i+1]) ? {} : []);
  var k = p[p.length - 1];
  if (k === 'testPhones') v = String(v).split(/[\n,，\s]+/).map(function(x){ return x.replace(/\D/g, '') }).filter(Boolean);
  else if (typeof v === 'string' && v !== '' && !isNaN(+v) && ['start','end','expiry','nm','kind','id','type'].indexOf(k) < 0) v = +v;
  o[k] = v;
}
function xmSaveBar(){
  return '<div style="display:flex;gap:10px;justify-content:flex-end;margin:16px 0 20px"><button class="btn btn-outline btn-sm" onclick="xmDraft=JSON.parse(JSON.stringify(xmData.cfg));renderXmas()">放棄修改</button>' +
    '<button class="btn btn-gold" onclick="xmSave()">💾 儲存</button></div>';
}

function xmRewardsHtml(){
  var c = xmDraft, h = '<div class="card"><div class="card-title">聖誕樹每一層亮起</div>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:8px">全體點燈累積到門檻，參與過（至少點過一盞燈）的會員各領紅利。一層只能領一次。</div>';
  (c.layers || []).forEach(function(t, i){
    h += '<div style="display:flex;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--border);font-size:13.5px">第 ' + (i + 1) + ' 層　累積 ' +
      xmInp('layers.' + i, t, 'number', 90) + ' 盞　每人領 ' + xmInp('treePts.' + i, c.treePts[i], 'number', 60) + ' 點紅利</div>';
  });
  var tot = (c.treePts || []).reduce(function(a, b){ return a + (+b || 0) }, 0);
  h += '<div class="muted" style="font-size:12.5px;margin-top:8px">五層全部領滿，每人共 <b>' + tot + '</b> 點。</div></div>';
  h += '<div class="card"><div class="card-title">集滿 4 個吊飾（三選一）</div>' +
    xmRow('選禮物', xmInp('ornGift', c.ornGift, 'number', 70) + ' 個禮物', '遊戲裡的禮物，不是真實獎勵，可以一直領') +
    xmRow('選紅利', xmInp('ornPoint', c.ornPoint, 'number', 70) + ' 點', '每人整個活動只能領一次真獎勵（紅利或票券擇一）；之後再集滿只能換禮物') +
    xmRow('選票券', xmInp('ornTicket.nm', (c.ornTicket || {}).nm, '', 160), '會寫進會員的票券，期限看「活動設定」的票券期限') + '</div>';
  h += '<div class="card"><div class="card-title">每人上限</div>' +
    xmRow('紅利總上限', xmInp('pointCap', c.pointCap, 'number', 80) + ' 點', '一個會員整個活動從走格子拿到的紅利最多幾點（樹、吊飾、扭蛋機加起來）。拿滿就改送禮物。') +
    xmRow('每天扭蛋機次數', xmInp('gachaDayMax', c.gachaDayMax, 'number', 70) + ' 次　其中真獎勵最多 ' + xmInp('gachaRealDay', c.gachaRealDay, 'number', 60) + ' 次', '真獎勵＝紅利、票券；超過就改抽禮物') + '</div>';
  return h + xmSaveBar();
}

function xmPoolHtml(){
  var c = xmDraft, tot = (c.gachaPool || []).reduce(function(a, p){ return a + (+p.w || 0) }, 0);
  var h = '<div class="card"><div class="card-title">扭蛋機格獎池</div>' +
    '<div class="muted" style="font-size:12.5px;margin-bottom:10px">玩家踩到 3 個扭蛋機格時抽一次。紅利和票券是真獎勵，受上面的每人上限、每天次數限制；不符合條件時改抽禮物。「機率」填權重，下面會顯示百分比。</div>';
  (c.gachaPool || []).forEach(function(p, i){
    var pct = tot ? Math.round((+p.w || 0) / tot * 1000) / 10 : 0;
    h += '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 0;border-top:1px solid var(--border);font-size:13.5px">' +
      '<select style="padding:5px;border:1px solid var(--border);border-radius:6px" onchange="xmPoolType(' + i + ',this.value)">' +
      ['gift','bonus','ticket'].map(function(t){ return '<option value="' + t + '"' + (p.type === t ? ' selected' : '') + '>' + XM_TYPE[t] + '</option>' }).join('') + '</select>' +
      '名稱 ' + xmInp('gachaPool.' + i + '.nm', p.nm, '', 150) +
      (p.type === 'gift' ? ' 數量 ' + xmInp('gachaPool.' + i + '.n', p.n, 'number', 60) : '') +
      (p.type === 'bonus' ? ' 點數 ' + xmInp('gachaPool.' + i + '.v', p.v, 'number', 60) : '') +
      (p.type === 'ticket' ? ' 限量 ' + xmInp('gachaPool.' + i + '.qty', p.qty == null ? '' : p.qty, 'number', 70) + ' 張' : '') +
      ' 機率 ' + xmInp('gachaPool.' + i + '.w', p.w, 'number', 70) + ' <span class="muted">(' + pct + '%)</span>' +
      '<button class="btn btn-del btn-sm" onclick="xmDraft.gachaPool.splice(' + i + ',1);renderXmas()">刪除</button></div>';
  });
  h += '<button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="xmDraft.gachaPool.push({id:\'x\'+Date.now().toString(36),nm:\'新獎品\',type:\'gift\',n:1,w:10});renderXmas()">＋ 新增獎品</button></div>';
  return h + xmSaveBar();
}
function xmPoolType(i, t){
  var p = xmDraft.gachaPool[i]; p.type = t;
  if (t === 'gift' && !p.n) p.n = 1; if (t === 'bonus' && !p.v) p.v = 1; if (t === 'ticket' && !p.kind) p.kind = 'upgrade';
  renderXmas();
}

function xmSettingsHtml(){
  var c = xmDraft;
  var h = '<div class="card"><div class="card-title">活動設定</div>' +
    xmRow('開始日期', xmInp('start', c.start, 'date', 160), '這天之前，只有員工和測試電話可以玩') +
    xmRow('結束日期', xmInp('end', c.end, 'date', 160)) +
    xmRow('票券期限', xmInp('expiry', c.expiry, 'date', 160), '吊飾、扭蛋機送的票券到哪天前要用掉') +
    xmRow('每天擲骰', '第一層 ' + xmInp('daily.0', (c.daily || [1,1])[0], 'number', 60) + ' 次　第二層（有預約） ' + xmInp('daily.1', (c.daily || [1,1])[1], 'number', 60) + ' 次') +
    xmRow('每天禮物上限', xmInp('giftGainDay', c.giftGainDay, 'number', 70) + ' 個', '每人每天最多靠遊戲增加幾個禮物（防止亂改）') +
    xmRow('每天點燈上限', xmInp('lightsDay', c.lightsDay, 'number', 70) + ' 盞', '每人每天最多幫聖誕樹點幾盞') +
    xmRow('種樹／拜訪', '每天種樹 ' + xmInp('plantDayMax', c.plantDayMax, 'number', 60) + ' 次　拜訪每天最多拿 ' + xmInp('visitDayMax', c.visitDayMax, 'number', 60) + ' 個禮物') +
    xmRow('測試電話', '<textarea rows="3" style="width:260px;padding:7px 8px;border:1px solid var(--border);border-radius:6px;font-size:14px" onchange="xmSet(\'testPhones\',this.value)">' + xmEsc((c.testPhones || []).join('\n')) + '</textarea>',
      '一行一支。這些電話綁定的 LINE 會進示範模式：次數不限、獎勵不入帳。<b>員工名單裡的人不用加</b>。') +
    xmRow('員工示範', '<label style="display:flex;gap:6px;align-items:center"><input type="checkbox"' + (c.demoStaff !== false ? ' checked' : '') + ' onchange="xmSet(\'demoStaff\',this.checked)"> 員工名單裡的人自動是示範模式</label>') +
    '</div>';
  h += '<div class="card"><div class="card-title">示範資料</div>' +
    '<div style="font-size:13px;color:var(--text2);line-height:1.8;margin-bottom:12px">員工示範玩的進度、森林、小屋都放在另一個資料夾，跟正式會員完全分開。按下面這顆清空示範資料，<b>正式玩家、正式的樹／森林／小屋、已發出的紅利都不會動</b>。</div>' +
    '<button class="btn btn-del" onclick="xmResetTest()">🧹 清空示範資料</button></div>';
  return h + xmSaveBar();
}

async function xmSave(){
  try {
    var latest = (await staffApi('/staff/xmas', {})).cfg || {};
    var out = JSON.parse(JSON.stringify(xmDraft));
    /* 後台以外的欄位（例如之後程式新增的）保留雲端的 */
    Object.keys(latest).forEach(function(k){ if (!(k in out)) out[k] = latest[k] });
    var j = await staffApi('/staff/xmas/config', { cfg: out });
    xmData = null; await renderXmas();
    alert('已儲存');
  } catch(e) { alert('儲存失敗：' + e.message) }
}
async function xmResetTest(){
  if (!confirm('要清空示範資料嗎？\n\n會清掉員工示範玩的進度、示範森林和小屋。\n不會動：正式會員的進度、正式的樹／森林／小屋、已發出的紅利。')) return;
  try { await staffApi('/staff/xmas/reset-test', {}); alert('已清空示範資料') } catch(e) { alert('清空失敗：' + e.message) }
}
window.renderXmas = renderXmas;
