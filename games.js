/* ══════════════════════════════════════════════════════════
   🎮 小遊戲成績（2026-11-12）
   大熊：做完的每一款遊戲／活動，都要能在「藝術家小活動」看到所有資訊。
   一款遊戲一張卡：什麼時候、規則、獎品、送了什麼、玩家人數、排行榜（全名＋電話）、特別獎得主、每個人玩幾局。
   資料從伺服器 /staff/minigames 來；以後新增小遊戲是在 otto2-notify server.js 的 MG_GAMES 加一筆，這頁不用改。
   ══════════════════════════════════════════════════════════ */
function mgEsc(s){ return String(s == null ? '' : s).replace(/[&<>"]/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c] }) }
function mgTime(t){ return t ? new Date(t).toLocaleString('zh-TW', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit', hour12:false }) : '' }
function mgNum(n, label){
  return '<div class="card" style="margin:0;padding:12px;text-align:center"><div style="font-size:24px;font-weight:600">' + n + '</div>' +
    '<div class="muted" style="font-size:var(--fs-xs)">' + label + '</div></div>';
}
function mgTable(head, rows){
  if (!rows.length) return '<div class="muted" style="font-size:var(--fs-sm)">還沒有資料。</div>';
  return '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:var(--fs-sm);white-space:nowrap"><tr class="muted">' +
    head.map(function(h, i){ return '<th style="padding:5px;text-align:' + (i ? 'center' : 'left') + '">' + h + '</th>' }).join('') + '</tr>' +
    rows.map(function(r){ return '<tr style="border-top:1px solid var(--line,#eee);text-align:center">' + r.map(function(c, i){ return '<td style="padding:5px;' + (i ? '' : 'text-align:left') + '">' + c + '</td>' }).join('') + '</tr>' }).join('') + '</table></div>';
}
var MG_ST = { live:['🟢 進行中','#1f8a4c'], soon:['⏳ 還沒開始','#b7791f'], done:['已結束','#888'], off:['沒開放','#888'] };
var mgOpen = {};
function mgToggle(id){ mgOpen[id] = !mgOpen[id]; renderGames(true) }
var mgData = null;

async function renderGames(keep){
  var el = document.getElementById('games-body'); if (!el) return;
  if (!keep || !mgData) {
    el.innerHTML = '<div class="empty">載入小遊戲成績中…</div>';
    try { mgData = await staffApi('/staff/minigames', {}) } catch(e) { el.innerHTML = '<div class="empty">讀不到資料：' + mgEsc(e.message) + '</div>'; return }
  }
  var d = mgData, h = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><div class="muted" style="font-size:var(--fs-sm)">每一款小遊戲的規則、獎品、誰玩了、排行榜都在這裡。員工／老闆帳號是示範模式，不會算進來。</div>' +
    '<button class="btn btn-outline btn-sm" style="margin-left:auto;flex:none" onclick="renderGames()">↻ 重新讀取</button></div>';
  (d.games || []).forEach(function(g, gi){
    var st = MG_ST[g.status] || MG_ST.done, open = mgOpen[g.id] != null ? mgOpen[g.id] : gi === 0;
    h += '<div class="card" style="margin:0 0 14px">';
    h += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;cursor:pointer" onclick="mgToggle(\'' + g.id + '\')">' +
      '<span style="font-size:26px">' + g.ic + '</span><div style="flex:1;min-width:0"><div style="font-size:17px;font-weight:600">' + mgEsc(g.nm) + '</div>' +
      '<div class="muted" style="font-size:var(--fs-xs)">' + mgEsc(g.day) + (g.time ? '　' + mgEsc(g.time) : '') + (g.off ? '　' + mgEsc(g.off) : '') + '　玩家 ' + g.stats.players + ' 人・' + g.stats.plays + ' 局</div></div>' +
      '<span style="font-size:var(--fs-sm);font-weight:600;color:' + st[1] + '">' + st[0] + '</span><span class="muted">' + (open ? '▲' : '▼') + '</span></div>';
    if (!open) { h += '</div>'; return }
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(100px,1fr));gap:8px;margin:14px 0">' +
      mgNum(g.stats.players, '玩過的人') + mgNum(g.stats.plays, '總共玩了幾局') + mgNum(g.stats.board, '送上排行榜') +
      mgNum(g.stats.gifts, '送出走格子禮物') + mgNum(g.stats.bonus, '送出紅利點數') +
      (g.special ? mgNum(g.special.winners.length + ' / ' + g.special.slots, '特別獎得主') : '') + '</div>';
    h += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px;font-size:var(--fs-sm);line-height:1.7">' +
      '<div><b>玩法</b><ul style="margin:4px 0;padding-left:18px">' + g.rules.map(function(x){ return '<li>' + mgEsc(x) + '</li>' }).join('') + '</ul></div>' +
      '<div><b>獎品</b><ul style="margin:4px 0;padding-left:18px">' + g.prizes.map(function(x){ return '<li>' + mgEsc(x) + '</li>' }).join('') + '</ul>' +
      '<b>玩完送什麼</b><ul style="margin:4px 0;padding-left:18px">' + g.give.map(function(x){ return '<li>' + mgEsc(x) + '</li>' }).join('') + '</ul></div></div>';
    if (g.special) {
      h += '<div style="font-weight:600;margin:6px 0">✨ 特別獎（一局 ' + g.special.n + ' 個禮物，前 ' + g.special.slots + ' 位會員）</div>' +
        mgTable(['順序','名字','電話','分數','時間','獎品選擇'], g.special.winners.map(function(w, i){
          var c = w.choice ? (w.choice.c === 'pts' ? '✅ 入儲值點 1111（' + mgEsc(w.choice.exp) + ' 前用）' + (w.choice.auto ? '・逾期自動' : '') : '✅ 展延 5 個月（' + mgEsc(w.choice.from) + ' → ' + mgEsc(w.choice.to) + '）')
            : w.notified === 'noLine' ? '⚠️ 沒有 LINE，要手動聯絡' : w.notified === 'fail' ? '⚠️ LINE 傳送失敗，要手動聯絡' : w.notified ? '已傳 LINE，等他選' : '明早 9 點傳 LINE';
          return [(i + 1), mgEsc(w.nm || '（沒有名字）'), mgEsc(w.ph), w.s, mgTime(w.at), c] }));
      var miss = g.special.reached.filter(function(r){ return !g.special.winners.some(function(w){ return w.ph === r.ph }) });
      if (miss.length) h += '<div class="muted" style="font-size:var(--fs-xs);margin:8px 0 4px">也達成但沒拿到（非會員或名額滿了）：</div>' +
        mgTable(['名字','電話','分數','會員','時間'], miss.map(function(r){ return [mgEsc(r.nm || '（沒有名字）'), mgEsc(r.ph), r.s, r.mem ? '是' : '否', mgTime(r.at)] }));
      h += '<div style="height:14px"></div>';
    }
    h += '<div style="font-weight:600;margin:6px 0">🏆 排行榜（' + g.stats.board + ' 人上榜，前 30 名）</div>' +
      mgTable(['名次','名字','電話','禮物','送出時間'], g.rank.map(function(r, i){ return [(r.sp ? '✨ 特別獎' : r.pl ? ['🥇','🥈','🥉'][r.pl - 1] : i + 1), mgEsc(r.nm || '（沒有名字）'), mgEsc(r.ph), r.s, mgTime(r.at)] })) + (g.special ? '<div class="muted" style="font-size:var(--fs-xs);margin-top:4px">✨＝特別獎得主，不列入前三名，🥇🥈🥉往下遞補</div>' : '');
    h += '<div style="font-weight:600;margin:16px 0 6px">👥 每個人玩的情形（' + g.list.length + ' 人，最好的一局排前面）</div>' +
      mgTable(['名字','電話','玩了幾局','最好一局','拿到禮物','拿到紅利'], g.list.map(function(p){ return [mgEsc(p.nm || '（沒有名字）'), mgEsc(p.ph), p.plays, p.hi, p.best, p.bbest] }));
    h += '</div>';
  });
  if (!(d.games || []).length) h += '<div class="empty">還沒有小遊戲。</div>';
  el.innerHTML = h;
}
