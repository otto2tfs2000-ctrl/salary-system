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
  if (!list.length) { el.innerHTML = h + '<div class="empty">還沒有人上傳。</div>'; return }
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
  el.innerHTML = h + '</div>';
}
async function dnToggle(id, hide){
  try {
    await staffApi('/staff/dinner/hide', { id: id, hide: hide });
    (dnData.list || []).forEach(function(x){ if (x.id === id) x.hide = hide });
    renderDinner(true);
  } catch(e) { alert('沒改成功：' + e.message) }
}
