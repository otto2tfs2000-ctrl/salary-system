/* ══════════════════════════════════════════════════════════
   🎪 藝術家小活動（2026-10-10）
   大熊要左邊只留一個入口，點進去再選扭蛋、走格子、選品館、活動公告……之後新的小活動也加在這裡：
   在 FUN_ITEMS 加一行，index.html 加一個 <div id="tab-xxx" class="page"><div class="fun-nav"></div>…</div>，
   再把 xxx 加進左邊那顆的 data-sub。各頁原本的程式（gacha.js、xmas.js、shop.js、events.js）都沒動。
   ══════════════════════════════════════════════════════════ */
var FUN_ITEMS = [
  { tab:'gacha',  ic:'🎰', nm:'扭扭樂（扭蛋機）', d:'10 月畢卡索、11/1 起聖誕扭扭樂：總覽、中獎紀錄與核銷、獎品、小遊戲、黃金扭蛋' },
  { tab:'xmas',   ic:'🎄', nm:'聖誕走格子',   d:'11 月起的走格子遊戲設定' },
  { tab:'shop',   ic:'🏪', nm:'藝享選品館',   d:'紅利商店：商品、分類、店員臺詞' },
  { tab:'events', ic:'📣', nm:'活動公告',     d:'餐敘、展覽、看展：現場報名收費，和遊樂島上的倒數、開花、熱氣球，同一場活動一起看' },
  { tab:'pets',   ic:'🐹', nm:'寵物離家出走', d:'作品小屋的天竺鼠／青蛙：誰的寵物離家、LINE 推播、明信片照片' },
  { tab:'hallstats', ic:'🎧', nm:'講堂收聽紀錄', d:'畫框背後：多少人進來、聽了哪一集、有沒有聽完' }
];
/* 誰看得到「藝術家小活動」：管理員、行政／業務一律看得到；老師要在「員工帳號」勾「藝術家小活動」（整組）或單項（扭蛋活動、聖誕走格子、選品館、活動公告）。
   2026-10-12 修：10/10 把四頁收成一個入口後，入口的 data-tab 是 fun，舊的帳號權限只有 gacha／xmas／shop，沒人勾得到 fun，非管理員的入口整個被藏掉 */
/* 2026-11-11 員工帳號的勾選改成跟左邊選單一樣：小活動只有一格「藝術家小活動」（整組），獨立到左邊的項目（例如活動公告）才有自己的一格。
   用新視窗存過的帳號 tabs 裡會帶 '_v2'，之後完全照勾選；還沒存過的舊帳號照舊規則（行政一律看得到、勾整組或單項都算），才不會一上線就有人少了分頁。
   funCanIn＝從小活動裡面進去看不看得到；funCanLeft＝左邊獨立的那顆看不看得到 */
function funPerm(t, left){
  var st = window.ME && ME.staff; if (!st) return true;
  if (st.role === 'owner') return true;
  var a = Array.isArray(st.tabs) ? st.tabs : [];
  if (a.indexOf('_v2') >= 0) return a.indexOf(left ? t : 'fun') >= 0;
  if (st.role === 'admin') return true;
  return a.indexOf('fun') >= 0 || a.indexOf(t) >= 0;
}
function funCanIn(t){ return funPerm(t, false) }
function funCanLeft(t){ return funPerm(t, true) }
function funCan(t){ return funCanIn(t) || funCanLeft(t) }
/* 2026-11-10 管理員在「整理選單」勾了獨立放到左邊的項目（menu.js mnSolo），這裡的卡片和切換鈕就不再列 */
function funSolo(t){ return Array.isArray(window.mnSolo) && mnSolo.indexOf(t) >= 0 && !(Array.isArray(window.mnBoth) && mnBoth.indexOf(t) >= 0) }   /* 兩邊都放的不算 */
/* 2026-11-11 活動公告「兩邊都放」時兩邊看到的不一樣：左邊那顆只看現場（報名、繳費），從小活動進來只看島上那一面（events.js evMode）。
   funGo＝從小活動這邊進去；左邊那顆在 menu.js 設 live */
function funGo(t){ if (t === 'events' && window.evGo) evGo('park'); switchTab(t) }
function funEvPark(t){ return t === 'events' && window.evMode && evMode() === 'park' }
/* 從小活動進活動公告時，左邊該亮的是「藝術家小活動」不是「活動公告」 */
function funLight(cur){
  if (cur !== 'events' || !window.evMode || evMode() === 'all') return;
  var park = evMode() === 'park';
  document.querySelectorAll('.tab').forEach(function(t){
    if (t.dataset.tab === 'events') t.classList.toggle('active', !park);
    if (t.dataset.tab === 'fun') t.classList.toggle('active', park);
  });
}
function funItems(){ return FUN_ITEMS.filter(function(x){ return funCanIn(x.tab) && !funSolo(x.tab) }) }
function renderFun(){
  var el = document.getElementById('fun-body'); if (!el) return;
  if (!funItems().length) { el.innerHTML = '<div class="muted" style="font-size:var(--fs-sm)">這裡的項目都已經獨立放到左邊選單了。要收回來請到左下角「⚙️ 整理選單」取消勾選。</div>'; return }
  el.innerHTML = '<div class="muted" style="font-size:var(--fs-sm);margin:-6px 0 14px">客人在遊樂島玩的東西都在這裡。點一個進去設定。</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px">' + funItems().map(function(x){
      var d = x.tab === 'events' && window.evMode && evMode() !== 'all' ? '島上跟著活動動的那一面：倒數看板、「我想去」花牆、開花、熱氣球。報名和繳費在左邊「活動公告」' : x.d;
      return '<div class="card" style="margin:0;cursor:pointer;padding:18px" onclick="funGo(\'' + x.tab + '\')">' +
        '<div style="font-size:30px;line-height:1">' + x.ic + '</div>' +
        '<div style="font-size:17px;font-weight:600;margin:10px 0 4px">' + x.nm + '</div>' +
        '<div class="muted" style="font-size:var(--fs-xs);line-height:1.6">' + d + '</div></div>' }).join('') + '</div>';
}
/* 每個小活動頁最上面：「← 藝術家小活動」＋切到其他小活動的按鈕 */
function funNav(cur){
  var on = FUN_ITEMS.some(function(x){ return x.tab === cur }); if (!on) return;
  var box = document.querySelector('#tab-' + cur + ' .fun-nav'); if (!box) return;
  funLight(cur);
  if (funSolo(cur) || (cur === 'events' && window.evMode && evMode() === 'live')) { box.innerHTML = ''; return }   /* 已經是左邊獨立的分頁，不用「← 藝術家小活動」 */
  box.innerHTML = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
    '<button class="btn btn-outline btn-sm" onclick="switchTab(\'fun\')">← 藝術家小活動</button>' +
    funItems().map(function(x){ return '<button class="store-btn' + (x.tab === cur ? ' active' : '') + '" style="padding:6px 12px;font-size:var(--fs-sm)" onclick="funGo(\'' + x.tab + '\')">' + x.ic + ' ' + x.nm + '</button>' }).join('') + '</div>';
}
