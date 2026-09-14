/* ══════════════════════════════════════════════════════════
   報價工具：包班／企業課詢價，算出「可以講出口的價格」和「不能低於的底線」
   成本參數存 S.quoteParams，跟全站薪資資料一起存檔／同步（不是獨立系統）
   公式與驗算來源：SPEC_Otto2報價系統.md（2026年1-6月教學部-4F損益表月均值）
   ══════════════════════════════════════════════════════════ */

var QUOTE_DEFAULTS = {
  pSite:99436, pStaff:219330, pAd:25544, pMisc:13982, pShare:15000,
  pHq:10, pMatRate:9.7, pDays:26, pHeads:3.5, pHours:176,
  pTeach:50, pRooms:3, pOpen:10, pUtil:30
};

var QUOTE_PARAM_LABELS = [
  ['pSite','場地費／月'], ['pStaff','人事費／月'], ['pAd','廣告費／月'], ['pMisc','其他雜支／月'],
  ['pShare','共用人力／月'], ['pHq','總部管理費分攤 %'], ['pMatRate','材料成本率 %'], ['pDays','每月營業天數'],
  ['pHeads','有效人力數'], ['pHours','每人每月工時'], ['pTeach','教學工時占比 %'], ['pRooms','教室數'],
  ['pOpen','每日營業時數'], ['pUtil','教室使用率 %']
];

var QUOTE_COURSES = [
  {name:'零基礎繪畫體驗', hrs:2.0, price:900,  mat:250},
  {name:'透明框 A5 新客價', hrs:2.5, price:1400, mat:400},
  {name:'透明框 A4 新客價', hrs:2.5, price:1600, mat:450},
  {name:'海洋流動畫',       hrs:2.5, price:1600, mat:400},
  {name:'水晶花（原價）',    hrs:2.5, price:1800, mat:450},
  {name:'樹脂複合媒材',      hrs:3.0, price:2000, mat:500}
];

/* 老師教學人次獎金：多數老師是「完整模式」每教學人次 $50（見 app.js calcSalary
   的 countBonus 邏輯），這是隨人數變動的真實現金成本，但「老師每教學小時成本」
   是固定時薪（人事費／月 ÷ 工時），完全不會隨這一團的人數變動——對一般團體，
   歷史平均已經內含這筆錢，但對人數特別多的大團，固定時薪會低估真實老師成本，
   這裡讓使用者自己選要不要疊加這筆變動成本，不預設開（不是每個老師都用完整模式）。 */
var TEACH_BONUS_PER_HEAD = 50;

var QUOTE_CASE_DEFAULTS = { n:6, hrs:2.5, mat:400, gm:30, venue:1, trans:0, teachBonus:false };
var qCase = Object.assign({}, QUOTE_CASE_DEFAULTS);

/* 新課程打平人數：預約制沒辦法事先知道單次會來幾個人，所以不猜人數、
   改成「你先抓一個候選售價（通常參考同類課程），我告訴你整個月至少要
   幾位客人才能打平」。以一個月為單位（開課次數 × 每次時長），不是單次，
   因為預約制的來客數本來就是按月累積、不是按單次可控的。
   老師成本分兩種：自家老師用共用薪資池換算出的時薪成本（跟其他工具一致）；
   外聘老師是額外的實際現金支出，跟店內薪資池無關，直接輸入每次鐘點費。
   固定用自家教室、不含交通，跟現行牌價課程的算法一致。 */
var QUOTE_NEW_DEFAULTS = { hrs:2.5, price:1500, mat:400, sessions:4, teacherMode:'inhouse', extFee:2000, teachBonus:false };
var qNew = Object.assign({}, QUOTE_NEW_DEFAULTS);

function qParams(){
  if (!S.quoteParams) S.quoteParams = {};
  var p = S.quoteParams;
  Object.keys(QUOTE_DEFAULTS).forEach(function(k){
    if (p[k]===undefined || p[k]===null || p[k]==='') p[k] = QUOTE_DEFAULTS[k];
  });
  return p;
}

function qN(v){ var n = parseFloat(v); return isFinite(n) ? n : 0; }
function qFmt(v){ return Math.round(v).toLocaleString('en-US'); }

function qModel(){
  var p = qParams();
  var fixed = qN(p.pSite) + qN(p.pStaff) + qN(p.pAd) + qN(p.pMisc) + qN(p.pShare);
  var hqRate = qN(p.pHq) / 100, matRate = qN(p.pMatRate) / 100;
  var varRate = hqRate + matRate;
  var breakevenRev = fixed / (1 - varRate);
  var overheadRate = (qN(p.pAd) + qN(p.pMisc)) / breakevenRev;
  var keep = 1 - hqRate - overheadRate;
  var teacherHr = qN(p.pStaff) / qN(p.pHeads) / qN(p.pHours) / (qN(p.pTeach) / 100);
  var roomHr = qN(p.pSite) / (qN(p.pRooms) * qN(p.pOpen) * qN(p.pDays) * (qN(p.pUtil) / 100));
  return {
    fixed: fixed, breakevenRev: breakevenRev, dailyBE: breakevenRev / qN(p.pDays),
    teacherHr: teacherHr, roomHr: roomHr, keep: keep
  };
}

function renderQuote(){
  var el = document.getElementById('quoteRoot');
  if (!el) return;
  el.innerHTML = qSkeleton();
  qBindEvents();
  qRecalc();
  qNewRecalc();
}

function qSkeleton(){
  var c = qCase, p = qParams();
  var h = '';

  h += '<div class="card" id="q-hero" style="border-left:4px solid var(--gold)">';
  h +=   '<div style="font-size:13px;color:var(--text3)">建議報價</div>';
  h +=   '<div style="font-family:var(--serif);font-size:42px;font-weight:400;color:var(--text);margin:2px 0 6px">NT$ <span id="q-total">—</span></div>';
  h +=   '<div style="font-size:14px;color:var(--text2)">每人 NT$ <span id="q-per">—</span></div>';
  h +=   '<div class="stat-grid" style="margin-top:14px;margin-bottom:0">';
  h +=     '<div class="stat-card"><div class="lbl">打平總價</div><div class="val" style="font-size:19px" id="q-be">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">打平每人</div><div class="val" style="font-size:19px" id="q-beper">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">這筆賺</div><div class="val" style="font-size:19px" id="q-profit">—</div></div>';
  h +=   '</div>';
  h +=   '<p id="q-verdict" style="margin-top:14px;font-size:14px;line-height:1.6"></p>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">案件條件（改這裡）</div>';
  h +=   '<div class="form-grid">';
  h +=     '<div class="fg"><label>人數</label><input type="number" id="q-n" value="'+c.n+'" min="1" step="1" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>課程時長（小時）</label><input type="number" id="q-hrs" value="'+c.hrs+'" min="0.5" step="0.5" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>材料成本／人</label><input type="number" id="q-mat" value="'+c.mat+'" min="0" step="10" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>目標毛利率 %</label><input type="number" id="q-gm" value="'+c.gm+'" min="0" max="80" step="5" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>交通／外派加給</label><input type="number" id="q-trans" value="'+c.trans+'" min="0" step="100" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>上課地點</label><div class="store-tabs" id="q-venue" style="margin-bottom:0">';
  h +=       '<button type="button" class="store-btn'+(c.venue?' active':'')+'" data-v="1">四樓教室</button>';
  h +=       '<button type="button" class="store-btn'+(c.venue?'':' active')+'" data-v="0">對方場地</button>';
  h +=     '</div></div>';
  h +=   '</div>';
  h +=   '<label class="chk top" style="margin-top:14px"><input type="checkbox" id="q-teachBonus"'+(c.teachBonus?' checked':'')+'>' +
         '<span>疊加老師教學人次獎金 每人 '+TEACH_BONUS_PER_HEAD+' 元（多數老師適用，人數多的大團建議勾，讓報價更準）</span></label>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">三檔報價（談判時往下讓，不要往上加）</div>';
  h +=   '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr)">';
  h +=     '<div class="stat-card"><div class="lbl">底線　不能再低</div><div class="val" id="q-t0">—</div><div class="muted" id="q-t0p" style="margin-top:2px"></div></div>';
  h +=     '<div class="stat-card hi"><div class="lbl">建議　照目標毛利</div><div class="val" id="q-t1">—</div><div class="muted" id="q-t1p" style="margin-top:2px"></div></div>';
  h +=     '<div class="stat-card"><div class="lbl">開價　留殺價空間</div><div class="val" id="q-t2">—</div><div class="muted" id="q-t2p" style="margin-top:2px"></div></div>';
  h +=   '</div>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">';
  h +=     '<button class="btn btn-gold" id="q-copy">複製報價文字</button>';
  h +=     '<button class="btn btn-outline" id="q-reset">回到預設條件</button>';
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">成本拆解（錢花去哪裡）</div>';
  h +=   '<div id="q-breakdown"></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">單堂課最低人數（照現行牌價，至少要坐幾個人）</div>';
  h +=   '<table><thead><tr><th>課程</th><th>時長</th><th>單價</th><th>材料</th><th>最低人數</th></tr></thead><tbody id="q-courses"></tbody></table>';
  h +=   '<p class="muted" style="margin-top:10px">最低人數＝地板成本 ÷（單價 × 留存率 － 材料）。小數一律進位：3.2 人代表要 4 人才不虧。</p>';
  h += '</div>';

  h += '<div class="card" id="qn-card" style="border-left:4px solid var(--gold2)">';
  h +=   '<div class="card-title">新課程打平人數（研發階段，這堂課開下去要幾位客人才夠本）</div>';
  h +=   '<p class="muted" style="margin-top:-8px;margin-bottom:16px">預約制沒辦法事先知道單次會來幾個人，所以反過來算：你抓一個候選售價（通常參考同類課程），這裡告訴你整個月至少要幾位客人才能打平老師＋教室的固定成本。以一個月為單位，不是單次。固定用自家教室、不含交通。</p>';
  h +=   '<div class="form-grid">';
  h +=     '<div class="fg"><label>每次上課時長（小時）</label><input type="number" id="qn-hrs" value="'+qNew.hrs+'" min="0.5" step="0.5" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>候選售價／人</label><input type="number" id="qn-price" value="'+qNew.price+'" min="0" step="50" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>材料成本／人</label><input type="number" id="qn-mat" value="'+qNew.mat+'" min="0" step="10" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>每月開課次數</label><input type="number" id="qn-sessions" value="'+qNew.sessions+'" min="1" step="1" onwheel="this.blur()"></div>';
  h +=     '<div class="fg"><label>老師來源</label><div class="store-tabs" id="qn-teacher" style="margin-bottom:0">';
  h +=       '<button type="button" class="store-btn'+(qNew.teacherMode==='inhouse'?' active':'')+'" data-v="inhouse">自家老師</button>';
  h +=       '<button type="button" class="store-btn'+(qNew.teacherMode==='external'?' active':'')+'" data-v="external">外聘老師</button>';
  h +=     '</div></div>';
  h +=     '<div class="fg" id="qn-extFeeWrap" style="'+(qNew.teacherMode==='external'?'':'display:none')+'"><label>外聘老師每次費用</label><input type="number" id="qn-extFee" value="'+qNew.extFee+'" min="0" step="100" onwheel="this.blur()"></div>';
  h +=   '</div>';
  h +=   '<div id="qn-teachBonusWrap" style="'+(qNew.teacherMode==='external'?'display:none':'')+';margin-top:14px">';
  h +=     '<label class="chk top"><input type="checkbox" id="qn-teachBonus"'+(qNew.teachBonus?' checked':'')+'>' +
           '<span>疊加老師教學人次獎金 每人 '+TEACH_BONUS_PER_HEAD+' 元（外聘老師的鐘點費另計，不適用這筆）</span></label>';
  h +=   '</div>';
  h +=   '<div class="stat-grid" style="grid-template-columns:repeat(3,1fr);margin-top:4px">';
  h +=     '<div class="stat-card"><div class="lbl">這堂課每月固定成本</div><div class="val" style="font-size:19px" id="qn-fixedMonthly">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">每人貢獻額</div><div class="val" style="font-size:19px" id="qn-contrib">—</div></div>';
  h +=     '<div class="stat-card hi"><div class="lbl">整月最低打平人數</div><div class="val" style="font-size:19px" id="qn-minN">—</div></div>';
  h +=   '</div>';
  h +=   '<p id="qn-verdict" style="margin-top:12px;font-size:14px;line-height:1.6"></p>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:4px">';
  h +=     '<button class="btn btn-outline" id="qn-reset">回到預設條件</button>';
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<details><summary style="cursor:pointer;font-weight:600;color:var(--gold2);font-size:14.5px">成本參數</summary>';
  h +=   '<div class="form-grid" style="margin-top:16px">';
  QUOTE_PARAM_LABELS.forEach(function(pair){
    var id = pair[0], label = pair[1];
    h += '<div class="fg"><label>'+label+'</label><input type="number" id="q-'+id+'" value="'+p[id]+'" step="'+(id==='pMatRate'?'0.1':'1')+'" onwheel="this.blur()"></div>';
  });
  h +=   '</div>';
  h +=   '<div class="stat-grid" id="q-derived" style="margin-top:16px"></div>';
  h +=   '<p class="muted">參數來源：2026 年 1–6 月教學部-4F 損益表月均值（場地費＝租金＋水電＋管理費，活動費與結算分潤金視為特殊項目未列入）。改任何一格，上面所有報價立刻重算，並自動存檔到雲端，全店裝置都會同步。</p>';
  h +=   '</details>';
  h += '</div>';

  return h;
}

function qBindEvents(){
  ['n','hrs','mat','gm','trans'].forEach(function(id){
    var input = document.getElementById('q-'+id);
    input.addEventListener('input', function(){ qCase[id] = qN(this.value); qRecalc(); });
  });

  var venueWrap = document.getElementById('q-venue');
  venueWrap.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    qCase.venue = +b.dataset.v;
    venueWrap.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); });
    qRecalc();
  });

  document.getElementById('q-teachBonus').addEventListener('change', function(){ qCase.teachBonus = this.checked; qRecalc(); });

  document.getElementById('q-copy').addEventListener('click', qCopyText);

  document.getElementById('q-reset').addEventListener('click', function(){
    qCase = Object.assign({}, QUOTE_CASE_DEFAULTS);
    renderQuote();
  });

  QUOTE_PARAM_LABELS.forEach(function(pair){
    var id = pair[0];
    var input = document.getElementById('q-'+id);
    input.addEventListener('input', function(){
      qParams()[id] = qN(this.value);
      save();
      qRecalc();
      qNewRecalc();
    });
  });

  ['hrs','price','mat','sessions','extFee'].forEach(function(id){
    var input = document.getElementById('qn-'+id);
    input.addEventListener('input', function(){ qNew[id] = qN(this.value); qNewRecalc(); });
  });

  var teacherWrap = document.getElementById('qn-teacher');
  teacherWrap.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    qNew.teacherMode = b.dataset.v;
    teacherWrap.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); });
    document.getElementById('qn-extFeeWrap').style.display = qNew.teacherMode === 'external' ? '' : 'none';
    document.getElementById('qn-teachBonusWrap').style.display = qNew.teacherMode === 'external' ? 'none' : '';
    qNewRecalc();
  });

  document.getElementById('qn-teachBonus').addEventListener('change', function(){ qNew.teachBonus = this.checked; qNewRecalc(); });

  document.getElementById('qn-reset').addEventListener('click', function(){
    qNew = Object.assign({}, QUOTE_NEW_DEFAULTS);
    renderQuote();
  });
}

function qRow(label, val){
  return '<div style="display:flex;justify-content:space-between;gap:16px;padding:8px 0;border-bottom:1px solid var(--border);font-size:14px">' +
    '<span style="color:var(--text3)">'+label+'</span><span>'+qFmt(val)+'</span></div>';
}
function qStat(label, val){
  return '<div class="stat-card"><div class="lbl">'+label+'</div><div class="val" style="font-size:18px">'+val+'</div></div>';
}
function qSetText(id, txt){ var el = document.getElementById(id); if (el) el.textContent = txt; }

function qRecalc(){
  var m = qModel();
  var c = qCase;
  var n = Math.max(1, qN(c.n)), hrs = qN(c.hrs), mat = qN(c.mat);
  var gm = Math.min(0.79, qN(c.gm) / 100), trans = qN(c.trans);

  var teacher = m.teacherHr * hrs;
  var room = m.roomHr * hrs * c.venue;
  var floor = teacher + room + trans;
  var matTotal = mat * n;
  var bonusTotal = c.teachBonus ? n * TEACH_BONUS_PER_HEAD : 0;
  var be = (floor + matTotal + bonusTotal) / m.keep;
  var rec = be / (1 - gm);
  var ask = be / (1 - Math.min(0.79, gm + 0.15));
  var profit = rec - be;

  qSetText('q-total', qFmt(rec));
  qSetText('q-per', qFmt(rec / n));
  qSetText('q-be', qFmt(be));
  qSetText('q-beper', qFmt(be / n));
  qSetText('q-profit', qFmt(profit));

  qSetText('q-t0', qFmt(be));  qSetText('q-t0p', '每人 ' + qFmt(be / n));
  qSetText('q-t1', qFmt(rec)); qSetText('q-t1p', '每人 ' + qFmt(rec / n));
  qSetText('q-t2', qFmt(ask)); qSetText('q-t2p', '每人 ' + qFmt(ask / n));

  var hero = document.getElementById('q-hero'), verdict = document.getElementById('q-verdict');
  var perHead = be / n;
  var color, text;
  if (n < 4 && c.venue === 1){
    color = 'var(--gold2)';
    text = n + ' 人撐不住一個老師的成本。按六人低消報價，或把這團併到其他時段。';
  } else if (perHead > 2200){
    color = 'var(--red)';
    text = '打平每人已經 ' + qFmt(perHead) + '，超過四樓一般客人的心理價。降材料或加人數，不要硬報。';
  } else {
    color = 'var(--green)';
    text = '這個條件可以接。報 ' + qFmt(rec) + ' 有 ' + Math.round(gm * 100) + '% 毛利，讓到 ' + qFmt(be) + ' 就是白做工。';
  }
  if (hero) hero.style.borderLeftColor = color;
  if (verdict) { verdict.style.color = color; verdict.textContent = text; }

  var bd = document.getElementById('q-breakdown');
  if (bd) {
    bd.innerHTML =
      qRow('老師工時　' + hrs + ' 小時 × ' + qFmt(m.teacherHr), teacher) +
      qRow(c.venue ? ('教室占用　' + hrs + ' 小時 × ' + qFmt(m.roomHr)) : '教室占用　用對方場地', room) +
      qRow('交通／外派', trans) +
      qRow('材料　' + n + ' 人 × ' + qFmt(mat), matTotal) +
      (c.teachBonus ? qRow('老師教學人次獎金　' + n + ' 人 × ' + TEACH_BONUS_PER_HEAD, bonusTotal) : '') +
      qRow('總部分攤＋廣告雜支　' + (100 - m.keep * 100).toFixed(1) + '%', rec - (floor + matTotal + bonusTotal) - profit) +
      '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:600"><span>建議報價</span><span>' + qFmt(rec) + '</span></div>';
  }

  var courseBody = document.getElementById('q-courses');
  if (courseBody) {
    courseBody.innerHTML = QUOTE_COURSES.map(function(cs){
      var fl = (m.teacherHr + m.roomHr) * cs.hrs;
      var contrib = cs.price * m.keep - cs.mat;
      var raw = contrib > 0 ? fl / contrib : Infinity;
      var need = isFinite(raw) ? Math.ceil(raw - 1e-9) : null;
      var cls = need===null ? 'b-red' : (need<=3 ? 'b-green' : (need<=4 ? 'b-gold' : 'b-red'));
      var txt = need===null ? '不可能打平' : (need + ' 人');
      return '<tr><td>'+cs.name+'</td><td>'+cs.hrs+'</td><td>'+qFmt(cs.price)+'</td><td>'+qFmt(cs.mat)+
        '</td><td><span class="badge '+cls+'">'+txt+'</span></td></tr>';
    }).join('');
  }

  var derived = document.getElementById('q-derived');
  if (derived) {
    derived.innerHTML =
      qStat('每月固定成本', qFmt(m.fixed)) +
      qStat('每月打平營收', qFmt(m.breakevenRev)) +
      qStat('每日打平營收', qFmt(m.dailyBE)) +
      qStat('老師每教學小時成本', qFmt(m.teacherHr)) +
      qStat('教室每小時成本', qFmt(m.roomHr)) +
      qStat('每收100元留下', (m.keep * 100).toFixed(1) + ' 元');
  }
}

function qNewRecalc(){
  var m = qModel();
  var hrs = qN(qNew.hrs), price = qN(qNew.price), mat = qN(qNew.mat);
  var sessions = Math.max(1, qN(qNew.sessions));

  var teacherMonthly = qNew.teacherMode === 'external'
    ? qN(qNew.extFee) * sessions
    : m.teacherHr * hrs * sessions;
  var roomMonthly = m.roomHr * hrs * sessions;
  var fixedMonthly = teacherMonthly + roomMonthly;

  /* 每人貢獻額：這個售價扣掉材料、扣掉總部抽成＋廣告雜支之後，
     剩下多少錢可以拿去攤提「這堂課每月固定成本」。自家老師且勾選教學人次
     獎金時，每多一人老師就多領 50 元，這筆也要從貢獻額扣掉，才是真的淨貢獻。 */
  var bonusPerHead = (qNew.teacherMode !== 'external' && qNew.teachBonus) ? TEACH_BONUS_PER_HEAD : 0;
  var contrib = price * m.keep - mat - bonusPerHead;
  var minN = contrib > 0 ? Math.ceil(fixedMonthly / contrib - 1e-9) : null;

  qSetText('qn-fixedMonthly', qFmt(fixedMonthly));
  qSetText('qn-contrib', qFmt(contrib));
  qSetText('qn-minN', minN === null ? '—' : (minN + ' 人'));

  var verdict = document.getElementById('qn-verdict');
  if (verdict) {
    if (contrib <= 0) {
      verdict.style.color = 'var(--red)';
      verdict.textContent = '這個售價扣掉材料、總部抽成、廣告雜支之後是負的——賣一個人就虧一個人，不管每月開幾次、來幾位客人都打不平，先調高售價或降材料成本。';
    } else {
      var perSession = minN / sessions;
      verdict.style.color = 'var(--green)';
      verdict.textContent = '這堂課定 ' + qFmt(price) + ' 元、每月開 ' + sessions + ' 次，整個月至少要 ' + minN + ' 位客人（平均每次約 ' + perSession.toFixed(1) + ' 人）才能打平老師＋教室的固定成本，超過這個人數才開始賺。';
    }
  }
}

function qCopyText(){
  var c = qCase, n = Math.max(1, qN(c.n));
  var txt = 'Otto2 ARTCLUB藝術工作室　課程報價\n' +
    '人數：' + n + ' 人\n' +
    '時長：' + qN(c.hrs) + ' 小時\n' +
    '地點：' + (c.venue ? '本工作室四樓教室' : '貴單位場地') + '\n' +
    '報價：NT$ ' + document.getElementById('q-total').textContent + '（每人 NT$ ' + document.getElementById('q-per').textContent + '）\n' +
    '含材料、教具與全程教學指導，成品當天帶回。\n' +
    '六人以上成團，需提前 7 天預約。';
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ alert('已複製，貼給對方即可') },
      function(){ alert('複製失敗，請手動選取') });
  } else {
    alert('複製失敗，請手動選取');
  }
}
