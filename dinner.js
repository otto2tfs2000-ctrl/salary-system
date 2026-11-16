/* ══════════════════════════════════════════════════════════
   🍽 長桌晚餐（2026-11-14）
   感恩節接火雞玩完，家長挑一位村民、把臉放進去自拍，上傳後「自動」坐上作品島大樹旁的長桌。
   大熊定：不用先審核，老師在這裡看到不適合的就按「撤下」，長桌上馬上消失；撤錯了可以「放回去」。
   資料從 otto2-notify /staff/dinner、/staff/dinner/hide 來（照片在 Cloudinary otto2-dinner/）。
   ══════════════════════════════════════════════════════════ */
var dnData = null;
function dnEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function dnTime(t){ return t ? new Date(t).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }) : '' }
var DN_PAGE = 'https://otto2tfs2000-ctrl.github.io/otto2artclub-booking/dinner.html';

async function renderDinner(keep){
  var el = document.getElementById('dinner-body'); if (!el) return;
  if (!keep || !dnData) {
    el.innerHTML = '<div class="empty">載入長桌晚餐中…</div>';
    try { dnData = await staffApi('/staff/dinner', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + dnEsc(e.message) + '</div>'; return }
  }
  var list = dnData.list || [], on = list.filter(function(x){ return !x.hide }).length;
  var h = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:12px">' +
    '<div class="muted" style="font-size:var(--fs-sm);flex:1;min-width:200px">上傳就會自動坐上長桌。看到不適合的照片按「撤下」，長桌上馬上消失（約 30 秒內）。目前坐在桌上 <b>' + on + '</b> 位，共上傳 ' + list.length + ' 張。</div>' +
    '<a class="btn btn-outline btn-sm" style="flex:none" href="' + DN_PAGE + '" target="_blank" rel="noopener">看長桌</a>' +
    '<button class="btn btn-outline btn-sm" style="flex:none" onclick="renderDinner()">↻ 重新讀取</button></div>';
  var top = '<div id="dn-chars" style="margin-bottom:26px"></div><div style="font-weight:600;font-size:17px;margin-bottom:4px">🍽 坐上長桌的照片</div>';   /* 11/15 大熊：大家畫的角色放最上面 */
  if (!list.length) { el.innerHTML = top + h + '<div class="empty">還沒有人上傳。</div>'; renderCatchChars(); return }
  h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:12px">';
  list.forEach(function(x){
    h += '<div class="card" style="margin:0;padding:10px;display:flex;flex-direction:column;gap:6px;' + (x.hide ? 'opacity:.55' : '') + '">' +
      '<div style="background:#2b2116;border-radius:8px;text-align:center"><img src="' + dnEsc(x.cut) + '" alt="" style="height:170px;max-width:100%;object-fit:contain" loading="lazy"></div>' +
      '<div style="font-weight:600">' + dnEsc(x.nm || x.n || '（沒名字）') + (x.staff ? ' <span class="muted" style="font-size:var(--fs-xs)">員工</span>' : '') + '</div>' +
      '<div class="muted" style="font-size:var(--fs-xs)">' + dnEsc(x.ph || '沒綁電話') + '・' + dnEsc(x.ch) + '<br>' + dnTime(x.at) + '</div>' +
      '<div style="font-size:var(--fs-sm)">「' + dnEsc(x.msg) + '」</div>' +
      (x.hide ? '<div style="color:#c0392b;font-size:var(--fs-xs);font-weight:600">已撤下，長桌上看不到</div>' : '') +
      '<button class="btn btn-sm ' + (x.hide ? 'btn-outline' : '') + '" style="margin-top:auto" onclick="dnToggle(\'' + x.id + '\',' + (x.hide ? 'false' : 'true') + ')">' + (x.hide ? '放回長桌' : '撤下') + '</button></div>';
  });
  el.innerHTML = top + h + '</div>';
  renderCatchChars();
}
/* 2026-11-15 接火雞「別人的角色來幫忙」：玩家畫的角色會隨機跑進別人的遊戲丟金火雞（也會出現在排行榜旁）。
   不用先審核，看到不適合的按「藏起來」，別人的遊戲和排行榜就不會再出現（約 15 秒內）；藏錯了按「放回來」。 */
var ccData = null;
async function renderCatchChars(keep){
  var el = document.getElementById('dn-chars'); if (!el) return;
  if (!keep || !ccData) {
    el.innerHTML = '<div class="empty">載入接火雞角色中…</div>';
    try { ccData = await staffApi('/staff/catch-chars', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到接火雞角色：' + dnEsc(e.message) + '</div>'; return }
  }
  var list = ccData.list || [], on = list.filter(function(x){ return !x.hide && x.ch }).length, nd = 0;
  list.forEach(function(x){ nd += (x.draws || []).length });
  var h = '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px"><div style="font-weight:600;font-size:17px;flex:1">🎨 大家畫的接火雞角色</div>' +
    '<button class="btn btn-outline btn-sm" style="flex:none" onclick="renderCatchChars()">↻ 重新讀取</button></div>' +
    '<div class="muted" style="font-size:var(--fs-sm);margin-bottom:12px">每個人畫過的角色都在這裡（同一張圖重玩不會重複）。框起來的那張是「會跑進別人遊戲送金火雞」的角色（他單局帶回最多那局畫的）。看到不適合的，按那張圖下面的「藏起來」，只藏那一張；框起來那張藏了，會自動改用他其他沒藏的圖。<br>共 <b>' + list.length + '</b> 位玩家、<b>' + nd + '</b> 張角色；會跑進別人遊戲的有 <b>' + on + '</b> 位。（11/15 晚上以前只存了刷新紀錄那張）</div>';
  if (!list.length) { el.innerHTML = h + '<div class="empty">還沒有人畫角色。</div>'; return }
  /* 11/16 大熊：藏起來要一張一張藏，不是整個人藏 → 每張圖下面各自一顆「藏起來／放回來」。
     框起來那張藏了，別人遊戲裡就自動改用他其他沒藏、帶回最多的那張；全部藏光才不會出現。 */
  function ccBtn(k, h, hide){
    return '<button class="btn btn-sm ' + (hide ? '' : 'btn-outline') + '" style="margin-top:4px;padding:2px 10px;font-size:var(--fs-xs)" onclick="ccToggle(\'' + dnEsc(k) + '\',' + (hide ? 'false' : 'true') + ',\'' + dnEsc(h || '') + '\')">' + (hide ? '放回來' : '藏起來') + '</button>';
  }
  function ccPic(src, hide, label, framed, btn){
    return '<div style="flex:none;text-align:center;border-radius:10px;padding:4px;background:#f3e3c3;' + (framed ? 'border:3px solid #e2711d;' : '') + (hide ? 'opacity:.45;' : '') + '">' +
      '<img src="' + dnEsc(src) + '" alt="" style="height:120px;max-width:140px;object-fit:contain" loading="lazy">' +
      (hide ? '<div style="font-size:var(--fs-xs);color:#c0392b;font-weight:600">已藏起來</div>' : '') + label + '<div>' + btn + '</div></div>';
  }
  list.forEach(function(x){
    var pics = '', hidN = 0, ds = x.draws || [];
    var mainInDraws = ds.some(function(d){ return d.main });
    if (x.ch && !mainInDraws) pics += ccPic(x.ch, x.hide, '<div style="font-size:var(--fs-xs);color:#c0501a;font-weight:600">跑進別人遊戲的</div>', true, ccBtn(x.k, '', x.hide));
    ds.forEach(function(d){
      if (d.hide) hidN++;
      pics += ccPic(d.ch, d.hide, (d.main ? '<div style="font-size:var(--fs-xs);color:#c0501a;font-weight:600">跑進別人遊戲的</div>' : '') + '<div class="muted" style="font-size:var(--fs-xs)">' + dnTime(d.at) + '<br>玩 ' + d.n + ' 局・最多帶回 ' + d.s + ' 隻</div>', d.main, ccBtn(x.k, d.h, d.hide));
    });
    if (x.hide && !mainInDraws) hidN++;
    h += '<div class="card" style="margin:0 0 10px;padding:10px">' +
      '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><div style="flex:1;min-width:160px"><b>' + dnEsc(x.nm || x.n || '（沒名字）') + '</b>' + (x.staff ? ' <span class="muted" style="font-size:var(--fs-xs)">員工</span>' : '') +
      ' <span class="muted" style="font-size:var(--fs-xs)">' + dnEsc(x.ph || '沒綁電話') + (x.plays ? '・玩了 ' + x.plays + ' 局' : '') + '</span>' + (hidN ? ' <span style="color:#c0392b;font-size:var(--fs-xs);font-weight:600">藏了 ' + hidN + ' 張</span>' : '') + '</div></div>' +
      '<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">' + (pics || '<span class="muted">（還沒有圖）</span>') + '</div></div>';
  });
  el.innerHTML = h;
}
async function ccToggle(k, hide, h){
  try {
    await staffApi('/staff/catch-chars/hide', h ? { k: k, hide: hide, h: h } : { k: k, hide: hide });
    renderCatchChars();   // 重新讀：框起來那張被藏時，伺服器會一起改，畫面以伺服器為準
  } catch(e) { alert('沒改成功：' + e.message) }
}
async function dnToggle(id, hide){
  try {
    await staffApi('/staff/dinner/hide', { id: id, hide: hide });
    (dnData.list || []).forEach(function(x){ if (x.id === id) x.hide = hide });
    renderDinner(true);
  } catch(e) { alert('沒改成功：' + e.message) }
}
