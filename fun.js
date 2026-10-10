/* ══════════════════════════════════════════════════════════
   🎪 藝術家小活動（2026-10-10）
   大熊要左邊只留一個入口，點進去再選扭蛋、走格子、選品館、活動公告……之後新的小活動也加在這裡：
   在 FUN_ITEMS 加一行，index.html 加一個 <div id="tab-xxx" class="page"><div class="fun-nav"></div>…</div>，
   再把 xxx 加進左邊那顆的 data-sub。各頁原本的程式（gacha.js、xmas.js、shop.js、events.js）都沒動。
   ══════════════════════════════════════════════════════════ */
var FUN_ITEMS = [
  { tab:'gacha',  ic:'🎰', nm:'畢卡索扭扭樂', d:'扭蛋機：總覽、中獎紀錄與核銷、獎品、小遊戲、黃金扭蛋' },
  { tab:'xmas',   ic:'🎄', nm:'聖誕走格子',   d:'11 月起的走格子遊戲設定' },
  { tab:'shop',   ic:'🏪', nm:'藝享選品館',   d:'紅利商店：商品、分類、店員臺詞' },
  { tab:'events', ic:'📣', nm:'活動公告',     d:'餐敘、展覽、看展：上傳海報、改日期，看誰按了「我想去」' }
];
function renderFun(){
  var el = document.getElementById('fun-body'); if (!el) return;
  el.innerHTML = '<div class="muted" style="font-size:13px;margin:-6px 0 14px">客人在遊樂島玩的東西都在這裡。點一個進去設定。</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px">' + FUN_ITEMS.map(function(x){
      return '<div class="card" style="margin:0;cursor:pointer;padding:18px" onclick="switchTab(\'' + x.tab + '\')">' +
        '<div style="font-size:30px;line-height:1">' + x.ic + '</div>' +
        '<div style="font-size:17px;font-weight:600;margin:10px 0 4px">' + x.nm + '</div>' +
        '<div class="muted" style="font-size:12.5px;line-height:1.6">' + x.d + '</div></div>' }).join('') + '</div>';
}
/* 每個小活動頁最上面：「← 藝術家小活動」＋切到其他小活動的按鈕 */
function funNav(cur){
  var on = FUN_ITEMS.some(function(x){ return x.tab === cur }); if (!on) return;
  var box = document.querySelector('#tab-' + cur + ' .fun-nav'); if (!box) return;
  box.innerHTML = '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:14px">' +
    '<button class="btn btn-outline btn-sm" onclick="switchTab(\'fun\')">← 藝術家小活動</button>' +
    FUN_ITEMS.map(function(x){ return '<button class="store-btn' + (x.tab === cur ? ' active' : '') + '" style="padding:6px 12px;font-size:13px" onclick="switchTab(\'' + x.tab + '\')">' + x.ic + ' ' + x.nm + '</button>' }).join('') + '</div>';
}
