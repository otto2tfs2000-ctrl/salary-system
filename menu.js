/* ══════════════════════════════════════════════════════════
   ⚙️ 整理選單（2026-10-29）
   左邊分頁的順序：管理員排好，全店一起用，存在 otto2-2026 /menuLayout {order:[分頁 key], by, at}。
   每個人另外可以藏掉自己用不到的分頁，存在這台裝置（localStorage），換手機要重藏一次。
   藏起來只是收進選單，權限沒變；沒權限的分頁（auth.js 設 display:none）不會出現在清單裡。
   新加的分頁如果還沒排過，會放在程式預設位置的前一個分頁後面，不會跑到最底下。
   ══════════════════════════════════════════════════════════ */
var MN_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app/menuLayout.json';
var MN_HIDE_KEY = 'otto2_menu_hide';
var mnDefault = [], mnShared = null, mnDraft = null;

function mnEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function mnTabs(){ return [].slice.call(document.querySelectorAll('.tabs .tab[data-tab]')) }
function mnTab(k){ return document.querySelector('.tabs .tab[data-tab="' + k + '"]') }
function mnName(k){ var t = mnTab(k); return t ? t.textContent.replace(/\s+/g, ' ').trim() : k }
function mnHidden(){ try { var a = JSON.parse(localStorage.getItem(MN_HIDE_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] } }
function mnSetHidden(a){ try { localStorage.setItem(MN_HIDE_KEY, JSON.stringify(a)) } catch (e) {} }
function mnIsOwner(){ return !!(window.ME && ME.staff && ME.staff.role === 'owner') }

/* 存的順序＋沒排過的新分頁 → 完整順序 */
function mnFullOrder(saved){
  var out = (saved || []).filter(function(k){ return mnDefault.indexOf(k) >= 0 });
  out = out.filter(function(k, i){ return out.indexOf(k) === i });
  mnDefault.forEach(function(k, i){
    if (out.indexOf(k) >= 0) return;
    var prev = i ? mnDefault[i - 1] : null, at = prev ? out.indexOf(prev) : -1;
    out.splice(at + 1, 0, k);
  });
  return out;
}
function mnApply(){
  var box = document.querySelector('.tabs'); if (!box) return;
  var order = mnFullOrder(mnShared), hide = mnHidden(), btn = document.getElementById('mn-open');
  order.forEach(function(k){ var t = mnTab(k); if (t) box.insertBefore(t, btn) });
  mnTabs().forEach(function(t){
    /* 正在看的那頁不藏，免得畫面上找不到自己在哪 */
    t.classList.toggle('mn-hide', hide.indexOf(t.dataset.tab) >= 0 && !t.classList.contains('active'));
  });
}

function mnOpen(){
  document.body.classList.remove('side-open');
  var hide = mnHidden();
  mnDraft = { order:mnFullOrder(mnShared).filter(function(k){ var t = mnTab(k); return t && t.style.display !== 'none' }),
    hide:hide.slice() };
  mnDraw();
}
function mnDraw(){
  var m = document.getElementById('mn-mask');
  if (!m){
    m = document.createElement('div'); m.id = 'mn-mask'; m.className = 'mn-mask';
    m.onclick = function(e){ if (e.target === m) mnClose() };
    document.body.appendChild(m);
  }
  var own = mnIsOwner(), d = mnDraft;
  m.innerHTML = '<div class="mn-sheet"><div class="card-title" style="margin-bottom:6px">⚙️ 整理選單</div>' +
    '<div class="hint" style="margin-bottom:12px">' + (own ? '用 ▲▼ 排順序，排好全店都會一樣。' : '順序由管理員排。') +
      '取消勾選＝只在你這台手機／電腦藏起來，別人看不到你的設定，權限也不會變。</div>' +
    d.order.map(function(k, i){
      return '<div class="mn-row">' +
        '<label class="mn-chk"><input type="checkbox" data-mnk="' + mnEsc(k) + '"' + (d.hide.indexOf(k) < 0 ? ' checked' : '') + '> ' + mnEsc(mnName(k)) + '</label>' +
        (own ? '<button class="btn btn-outline btn-sm" data-mnup="' + i + '"' + (i ? '' : ' disabled') + '>▲</button>' +
               '<button class="btn btn-outline btn-sm" data-mndn="' + i + '"' + (i < d.order.length - 1 ? '' : ' disabled') + '>▼</button>' : '') +
        '</div>';
    }).join('') +
    '<div class="toolbar" style="margin-top:14px"><button class="btn btn-gold" id="mn-save">儲存</button>' +
      '<button class="btn btn-outline" id="mn-x">取消</button>' +
      '<button class="btn btn-outline" id="mn-reset" style="margin-left:auto">回到預設</button></div></div>';
  m.classList.add('on');
  m.querySelectorAll('[data-mnk]').forEach(function(x){ x.onchange = function(){
    var k = x.dataset.mnk, i = d.hide.indexOf(k);
    if (x.checked && i >= 0) d.hide.splice(i, 1);
    if (!x.checked && i < 0) d.hide.push(k);
  } });
  function mv(i, j){ var t = d.order[i]; d.order[i] = d.order[j]; d.order[j] = t; mnDraw() }
  m.querySelectorAll('[data-mnup]').forEach(function(b){ b.onclick = function(){ var i = +b.dataset.mnup; mv(i, i - 1) } });
  m.querySelectorAll('[data-mndn]').forEach(function(b){ b.onclick = function(){ var i = +b.dataset.mndn; mv(i, i + 1) } });
  document.getElementById('mn-x').onclick = mnClose;
  document.getElementById('mn-reset').onclick = function(){
    if (!confirm(own ? '回到程式原本的順序，全店都會變回來；你自己藏起來的分頁也全部打開。' : '你藏起來的分頁全部打開。')) return;
    d.hide = []; if (own) d.order = mnDefault.filter(function(k){ return d.order.indexOf(k) >= 0 });
    mnSave(own ? 'reset' : false);
  };
  document.getElementById('mn-save').onclick = function(){ mnSave(own) };
}
function mnClose(){ var m = document.getElementById('mn-mask'); if (m) m.classList.remove('on') }
async function mnSave(shared){
  var d = mnDraft;
  if (d.order.every(function(k){ return d.hide.indexOf(k) >= 0 })) return alert('至少要留一個分頁');
  if (shared){
    /* 沒權限看的分頁不在清單裡，照原本的相對位置補回去，不要被這次存檔弄丟 */
    var order = shared === 'reset' ? null : mnFullOrder(d.order);
    try {
      var r = await fetch(MN_URL, { method:order ? 'PUT' : 'DELETE', headers:{'Content-Type':'application/json'},
        body:order ? JSON.stringify({ order:order, by:(window.ME && ME.displayName) || '', at:new Date(Date.now() + 288e5).toISOString().slice(0, 16) }) : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      mnShared = order;
    } catch (e) { return alert('順序存檔失敗：' + e.message + '\n請檢查網路後再按一次。') }
  }
  mnSetHidden(d.hide);
  mnClose(); mnApply();
}

async function mnBoot(){
  var box = document.querySelector('.tabs'); if (!box) return;
  mnDefault = mnTabs().map(function(t){ return t.dataset.tab });
  var b = document.createElement('div');
  b.id = 'mn-open'; b.className = 'mn-open'; b.textContent = '⚙️ 整理選單';   // 不用 .tab，不然 auth.js 會把它當成沒權限的分頁藏掉
  b.onclick = mnOpen;
  box.appendChild(b);
  mnApply();
  try { var j = await (await fetch(MN_URL)).json(); if (j && Array.isArray(j.order)) mnShared = j.order } catch (e) {}
  mnApply();
}
mnBoot();
