/* ══════════════════════════════════════════════════════════
   ⚙️ 整理選單（2026-10-29）
   左邊分頁的順序：管理員排好，全店一起用，存在 otto2-2026 /menuLayout {order:[分頁 key], by, at}。
   每個人另外可以藏掉自己用不到的分頁，存在這台裝置（localStorage），換手機要重藏一次。
   藏起來只是收進選單，權限沒變；沒權限的分頁（auth.js 設 display:none）不會出現在清單裡。
   新加的分頁如果還沒排過，會放在程式預設位置的前一個分頁後面，不會跑到最底下。
   2026-11-05 管理員可以改分頁名字，全店一起換，存在同一筆 /menuLayout 的 names:{分頁 key:名字}；
   只改左邊選單顯示的字，分頁 key、權限、裡面的頁面標題都不動。今日排課的紅色數字是子元素，不能整個 textContent 蓋掉。
   2026-11-10 「藝術家小活動」裡的每一項（fun.js FUN_ITEMS）可以由管理員勾「獨立放到左邊」，全店一樣，
   存在同一筆 /menuLayout 的 solo:[分頁 key]。六項在左邊都先建好分頁（data-solo），沒勾的用 mn-off 藏著；
   勾了的從「藝術家小活動」卡片和上方切換鈕拿掉（fun.js funSolo），入口的 data-sub 也跟著少一項，才不會兩顆一起亮。
   權限沒變：照 funCan，原本看不到的人拉出來也看不到。全部拉出來時入口自己收起來。
   2026-11-10 晚 加「兩邊都放」：大熊說活動是同一件事的兩面（現場真的辦＋島上跟著開花），兩個地方都要進得去。
   solo＝左邊有分頁的全部項目，both＝其中小活動卡片也留著的；存檔一律帶 soloSet:true，
   沒存過（或回到預設）時用 MN_SOLO_DEF／MN_BOTH_DEF：活動公告兩邊都放。Firebase 不存空陣列，所以要靠 soloSet 分辨「全部取消」和「沒設過」。
   ══════════════════════════════════════════════════════════ */
var MN_SOLO_DEF = ['events'], MN_BOTH_DEF = ['events'];
var MN_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app/menuLayout.json';
var MN_HIDE_KEY = 'otto2_menu_hide';
var mnDefault = [], mnShared = null, mnNames = {}, mnOrigNames = {}, mnDraft = null, mnSolo = MN_SOLO_DEF.slice(), mnBoth = MN_BOTH_DEF.slice(), mnFunSub = '';

function mnEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function mnTabs(){ return [].slice.call(document.querySelectorAll('.tabs .tab[data-tab]')) }
function mnTab(k){ return document.querySelector('.tabs .tab[data-tab="' + k + '"]') }
/* 分頁自己的字（不含今日排課的紅色數字） */
function mnTextNodes(t){ return [].slice.call(t.childNodes).filter(function(n){ return n.nodeType === 3 }) }
function mnName(k){
  var t = mnTab(k); if (!t) return k;
  return mnTextNodes(t).map(function(n){ return n.nodeValue }).join('').replace(/\s+/g, ' ').trim();
}
function mnSetName(k, name){
  var t = mnTab(k); if (!t) return;
  var nodes = mnTextNodes(t);
  if (!nodes.length) { t.insertBefore(document.createTextNode(name), t.firstChild); return }
  nodes[0].nodeValue = name;
  nodes.slice(1).forEach(function(n){ n.nodeValue = '' });
}
function mnHidden(){ try { var a = JSON.parse(localStorage.getItem(MN_HIDE_KEY) || '[]'); return Array.isArray(a) ? a : [] } catch (e) { return [] } }
function mnSetHidden(a){ try { localStorage.setItem(MN_HIDE_KEY, JSON.stringify(a)) } catch (e) {} }
function mnIsOwner(){ return !!(window.ME && ME.staff && ME.staff.role === 'owner') }

function mnFunItems(){ return window.FUN_ITEMS || [] }
function mnIsFunItem(k){ return mnFunItems().some(function(x){ return x.tab === k }) }
function mnFunCan(k){ return window.funCan ? funCan(k) : true }
/* 這個人的選單上該不該有這一顆（solo＝目前或草稿裡左邊有分頁的項目，both＝其中小活動裡也留著的） */
function mnShown(k, solo, both){
  var t = mnTab(k); if (!t || t.style.display === 'none') return false;
  if (mnIsFunItem(k)) return solo.indexOf(k) >= 0 && mnFunCan(k);
  if (k === 'fun') return mnFunItems().some(function(x){ return (solo.indexOf(x.tab) < 0 || both.indexOf(x.tab) >= 0) && mnFunCan(x.tab) });
  return true;
}
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
  mnDefault.forEach(function(k){ var w = mnNames[k] || mnOrigNames[k]; if (w && w !== mnName(k)) mnSetName(k, w) });
  var fun = mnTab('fun');
  if (fun) fun.dataset.sub = mnFunSub.split(' ').filter(function(k){ return k && mnSolo.indexOf(k) < 0 }).join(' ');
  mnTabs().forEach(function(t){
    var k = t.dataset.tab;
    if (k === 'fun' || mnIsFunItem(k)) t.classList.toggle('mn-off', t.style.display !== 'none' && !mnShown(k, mnSolo, mnBoth));
    /* 正在看的那頁不藏，免得畫面上找不到自己在哪 */
    t.classList.toggle('mn-hide', hide.indexOf(t.dataset.tab) >= 0 && !t.classList.contains('active'));
  });
}

function mnOpen(){
  document.body.classList.remove('side-open');
  var hide = mnHidden();
  mnDraft = { order:mnFullOrder(mnShared), hide:hide.slice(), names:Object.assign({}, mnNames), solo:mnSolo.slice(), both:mnBoth.slice() };
  mnDraw();
}
function mnDraw(){
  var m = document.getElementById('mn-mask');
  if (!m){
    m = document.createElement('div'); m.id = 'mn-mask'; m.className = 'mn-mask';
    m.onclick = function(e){ if (e.target === m) mnClose() };
    document.body.appendChild(m);
  }
  var own = mnIsOwner(), d = mnDraft, old = m.querySelector('.mn-sheet'), top = old ? old.scrollTop : 0;
  var rows = d.order.filter(function(k){ return mnShown(k, d.solo, d.both) });
  m.innerHTML = '<div class="mn-sheet"><div class="card-title" style="margin-bottom:6px">⚙️ 整理選單</div>' +
    '<div class="hint" style="margin-bottom:12px">' + (own ? '直接點名字可以改，按住右邊的 ☰ 上下拖曳排順序，按儲存後全店都會一樣。' : '名字和順序由管理員設定。') +
      '取消勾選＝只在你這台手機／電腦藏起來，別人看不到你的設定，權限也不會變。</div>' +
    rows.map(function(k, i){
      return '<div class="mn-row" data-mnrow="' + mnEsc(k) + '">' +
        '<label class="mn-chk"><input type="checkbox" data-mnk="' + mnEsc(k) + '"' + (d.hide.indexOf(k) < 0 ? ' checked' : '') + '>' + (own ? '' : ' ' + mnEsc(mnName(k))) + '</label>' +
        (own ? '<input class="mn-name" maxlength="20" data-mnname="' + mnEsc(k) + '" value="' + mnEsc(d.names[k] || mnOrigNames[k] || k) + '" aria-label="分頁名字">' : '') +
        (own ? '<span class="mn-drag" data-mndrag title="按住上下拖曳">☰</span>' : '') +
        '</div>';
    }).join('') +
    (own && mnFunItems().length ? '<div class="mn-sec">🎪 藝術家小活動裡的項目</div>' +
      '<div class="hint" style="margin-bottom:6px">每一項可以選放哪裡。選到左邊的，上面就會多一列可以排順序、改名字。全店都一樣。</div>' +
      mnFunItems().map(function(x){
        var v = d.solo.indexOf(x.tab) < 0 ? 'in' : d.both.indexOf(x.tab) >= 0 ? 'both' : 'solo';
        return '<div class="mn-row"><span class="mn-chk" style="cursor:default">' + mnEsc(x.ic + ' ' + x.nm) + '</span>' +
          '<select class="mn-sel" data-mnsolo="' + mnEsc(x.tab) + '" aria-label="放哪裡">' +
          [['in', '收在小活動裡'], ['solo', '只放左邊選單'], ['both', '兩邊都放']].map(function(o){ return '<option value="' + o[0] + '"' + (o[0] === v ? ' selected' : '') + '>' + o[1] + '</option>' }).join('') +
          '</select></div>';
      }).join('') : '') +
    '<div class="toolbar" style="margin-top:14px"><button class="btn btn-gold" id="mn-save">儲存</button>' +
      '<button class="btn btn-outline" id="mn-x">取消</button>' +
      '<button class="btn btn-outline" id="mn-reset" style="margin-left:auto">回到預設</button></div></div>';
  m.classList.add('on');
  m.querySelector('.mn-sheet').scrollTop = top;
  m.querySelectorAll('[data-mnsolo]').forEach(function(x){ x.onchange = function(){
    var k = x.dataset.mnsolo, no = function(y){ return y !== k };
    d.solo = d.solo.filter(no); d.both = d.both.filter(no);
    if (x.value !== 'in') d.solo.push(k);
    if (x.value === 'both') d.both.push(k);
    mnDraw();
  } });
  m.querySelectorAll('[data-mnk]').forEach(function(x){ x.onchange = function(){
    var k = x.dataset.mnk, i = d.hide.indexOf(k);
    if (x.checked && i >= 0) d.hide.splice(i, 1);
    if (!x.checked && i < 0) d.hide.push(k);
  } });
  m.querySelectorAll('[data-mnname]').forEach(function(x){ x.oninput = function(){ d.names[x.dataset.mnname] = x.value } });
  m.querySelectorAll('[data-mndrag]').forEach(function(h){ h.onpointerdown = function(e){ mnDragStart(e, h, m, d) } });
  document.getElementById('mn-x').onclick = mnClose;
  document.getElementById('mn-reset').onclick = function(){
    if (!confirm(own ? '回到程式原本的名字和順序，小活動放哪裡也回到預設，全店都會變回來；你自己藏起來的分頁也全部打開。' : '你藏起來的分頁全部打開。')) return;
    d.hide = []; d.names = {}; if (own) { d.order = mnDefault.slice(); d.solo = MN_SOLO_DEF.slice(); d.both = MN_BOTH_DEF.slice() }
    mnSave(own ? 'reset' : false);
  };
  document.getElementById('mn-save').onclick = function(){ mnSave(own) };
}
/* 按住 ☰ 拖曳。手機手指在拖動時，被按住的那一列不能離開畫面結構，不然瀏覽器會中斷這次觸控，
   所以一律是把「旁邊那列」搬到另一邊，被拖的那列自己不動。放開才寫回 d.order，存檔要按儲存。 */
function mnDragStart(e, handle, mask, d){
  e.preventDefault();
  var row = handle.closest('.mn-row'), sheet = mask.querySelector('.mn-sheet'), y = e.clientY, id = e.pointerId, raf = 0;
  row.classList.add('mn-dragging');
  function step(){
    var box = sheet.getBoundingClientRect();
    if (y < box.top + 48) sheet.scrollTop -= 8;       // 清單比螢幕長時，拖到上下邊會自己捲
    else if (y > box.bottom - 48) sheet.scrollTop += 8;
    place();
    raf = requestAnimationFrame(step);
  }
  function place(){
    var p = row.previousElementSibling, n = row.nextElementSibling, r;
    while (p && p.classList.contains('mn-row') && (r = p.getBoundingClientRect()) && y < r.top + r.height / 2) {
      row.after(p); p = row.previousElementSibling;
    }
    while (n && n.classList.contains('mn-row') && (r = n.getBoundingClientRect()) && y > r.top + r.height / 2) {
      row.before(n); n = row.nextElementSibling;
    }
  }
  function move(ev){ if (ev.pointerId === id) y = ev.clientY }
  function end(ev){
    if (ev.pointerId !== id) return;
    cancelAnimationFrame(raf);
    y = ev.clientY; place();
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', end);
    window.removeEventListener('pointercancel', end);
    row.classList.remove('mn-dragging');
    /* 畫面上沒列出來的（沒權限、還收在小活動裡的）照原本的相對位置補回去 */
    d.order = mnFullOrder([].map.call(mask.querySelectorAll('[data-mnrow]'), function(x){ return x.dataset.mnrow }));
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', end);
  window.addEventListener('pointercancel', end);
  raf = requestAnimationFrame(step);
}
function mnClose(){ var m = document.getElementById('mn-mask'); if (m) m.classList.remove('on') }
async function mnSave(shared){
  var d = mnDraft;
  var solo = shared === 'reset' ? MN_SOLO_DEF.filter(mnIsFunItem) : shared ? d.solo.filter(mnIsFunItem) : mnSolo;
  var both = shared === 'reset' ? MN_BOTH_DEF.filter(mnIsFunItem) : shared ? d.both.filter(function(k){ return solo.indexOf(k) >= 0 }) : mnBoth;
  if (d.order.filter(function(k){ return mnShown(k, solo, both) }).every(function(k){ return d.hide.indexOf(k) >= 0 })) return alert('至少要留一個分頁');
  if (shared){
    /* 沒權限看的分頁不在清單裡，照原本的相對位置補回去，不要被這次存檔弄丟 */
    var order = shared === 'reset' ? null : mnFullOrder(d.order);
    /* 留空或跟原本一樣的就不存，之後程式改預設名字才跟得上 */
    var names = {};
    if (order) Object.keys(d.names).forEach(function(k){
      var w = String(d.names[k] || '').replace(/\s+/g, ' ').trim();
      if (w && w !== mnOrigNames[k]) names[k] = w;
    });
    try {
      var r = await fetch(MN_URL, { method:order ? 'PUT' : 'DELETE', headers:{'Content-Type':'application/json'},
        body:order ? JSON.stringify({ order:order, names:names, solo:solo, both:both, soloSet:true, by:(window.ME && ME.displayName) || '', at:new Date(Date.now() + 288e5).toISOString().slice(0, 16) }) : undefined });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      mnShared = order; mnNames = names; mnSolo = solo; mnBoth = both;
    } catch (e) { return alert('順序存檔失敗：' + e.message + '\n請檢查網路後再按一次。') }
  }
  mnSetHidden(d.hide);
  mnClose(); mnApply(); mnFunRefresh();
}
/* 獨立出來的項目變了：小活動卡片和目前這頁上方的切換鈕重畫 */
function mnFunRefresh(){
  if (window.renderFun) renderFun();
  var cur = document.querySelector('.page.active'), k = cur ? String(cur.id).replace('tab-', '') : '';
  if (window.funNav && mnIsFunItem(k)) funNav(k);
  /* 哪一顆該亮跟 app.js doSwitchTab 同一條規則：入口的 data-sub 剛變過，重算一次 */
  if (k) mnTabs().forEach(function(t){ t.classList.toggle('active', t.dataset.tab === k || (t.dataset.sub || '').split(' ').indexOf(k) >= 0) });
  mnApply();
}

async function mnBoot(){
  var box = document.querySelector('.tabs'); if (!box) return;
  /* 小活動每一項先在入口後面建好一顆分頁，沒獨立出來的藏著 */
  var fun = mnTab('fun');
  if (fun){
    mnFunSub = fun.dataset.sub || '';
    var after = fun;
    mnFunItems().forEach(function(x){
      if (mnTab(x.tab)) return;
      var t = document.createElement('div');
      t.className = 'tab mn-off'; t.dataset.tab = x.tab; t.dataset.solo = '1'; t.textContent = x.ic + ' ' + x.nm;
      t.onclick = function(){ switchTab(x.tab) };
      after.after(t); after = t;
    });
  }
  mnDefault = mnTabs().map(function(t){ return t.dataset.tab });
  mnDefault.forEach(function(k){ mnOrigNames[k] = mnName(k) });
  var b = document.createElement('div');
  b.id = 'mn-open'; b.className = 'mn-open'; b.textContent = '⚙️ 整理選單';   // 不用 .tab，不然 auth.js 會把它當成沒權限的分頁藏掉
  b.onclick = mnOpen;
  box.appendChild(b);
  mnApply();
  try { var j = await (await fetch(MN_URL)).json(); if (j && Array.isArray(j.order)) mnShared = j.order; if (j && j.names) mnNames = j.names;
    if (j && (j.soloSet || Array.isArray(j.solo))) {
      mnSolo = (Array.isArray(j.solo) ? j.solo : []).filter(mnIsFunItem);
      mnBoth = (Array.isArray(j.both) ? j.both : []).filter(function(k){ return mnSolo.indexOf(k) >= 0 });
    } } catch (e) {}
  mnApply(); mnFunRefresh();
}
mnBoot();
