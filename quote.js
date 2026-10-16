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

/* 報價頁分成兩個子分頁：團班報價（預設）／一般課程定價（v4 新做：價格→要來幾個人次；舊公式收在最下面的「舊版公式」） */
var qView = 'group';

function renderQuote(){
  var el = document.getElementById('quoteRoot');
  if (!el) return;
  var h = '<div class="store-tabs" id="q-view">' +
    '<button type="button" class="store-btn'+(qView==='group'?' active':'')+'" data-v="group">團班報價</button>' +
    '<button type="button" class="store-btn'+(qView==='course'?' active':'')+'" data-v="course">一般課程定價</button>' +
    '</div>' +
    '<div id="q-view-group" style="'+(qView==='group'?'':'display:none')+'">' + qgSkeleton() + '</div>' +
    '<div id="q-view-course" style="'+(qView==='course'?'':'display:none')+'">' + qcSkeleton() +
      '<div class="card"><details><summary style="cursor:pointer;font-weight:600;color:var(--gold2);font-size:14.5px">舊版公式（2026-09 版，只留著參考）</summary><div style="margin-top:16px">' + qSkeleton() + '</div></details></div></div>';
  el.innerHTML = h;
  document.getElementById('q-view').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    qView = b.dataset.v;
    this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); });
    document.getElementById('q-view-group').style.display = qView==='group' ? '' : 'none';
    document.getElementById('q-view-course').style.display = qView==='course' ? '' : 'none';
  });
  qBindEvents();
  qRecalc();
  qNewRecalc();
  qgBindEvents();
  qgRenderStaff();
  qgRenderCaps();
  qgRecalc();
  qcBindEvents();
  qcRecalc();
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

/* ══════════════════════════════════════════════════════════
   團班報價（2026-10-14 v4，大熊確認的算法）
   團班一到兩個月才一次，老師、業務、行政本來就在上班，
   所以不分攤月薪與房租，只算「這一場多花的錢」＋「這一場擠掉的錢」：
   ・成本＝材料＋人次獎金（老師、行政每教一位學生 50）＋講師費＋交通搬運＋雜支＋擠掉的營收
   ・總部抽成＝營業額的 10%（講師費另收的話也算在營業額裡）
   ・講師費獨立一條：這場付不付（外派預設付，上班時間內也可以勾）、另不另外跟客人收
     （收＝代收代付；不收＝老闆的局，講師費照付，算進每人價）
   ・場次成本（2026-10-15）：內場這一場占用教室的時間（上課時長＋準備收拾）× 每小時房租薪水成本，算進建議價；
     人越少，每人要分攤的場次成本越多，每人價就越高（外派不占用四樓教室，不算）
   ・現金底線＝只算這場多花的錢（材料、獎金、講師費、擠掉的營收…）；打平＝連場次成本都賺回來；
     建議價＝照「目標淨利率」（扣完所有成本含場次成本之後留下的比例）；新客價只當「對照」，不限制報價
   ・材料升級（比「標準材料」貴）多出來的錢照成本轉嫁（連總部 10% 一起補），不乘利潤率；新客價對照也跟著加同樣的差額
   切到「自己訂價」就用手填的每人價，系統算利潤率。
   參數（講師費等級、人頭獎金、稅、總部、保證人數）存 S.quoteParams 的 g* 欄位，跟全站一起同步。
   ══════════════════════════════════════════════════════════ */

var QG_PARAM_DEFAULTS = { gHead:50, gMaster:2000, gAssist:1500, gJunior:1000, gHq:10, gTax:5, gOutMin:20, gInTol:3,
  gFixed:135000, gAdSpend:15000, gStore:'flagship', gPayrollOv:'', gVisitsOv:'', gNewOv:'', gVisitsPlan:275, gTarget:100000, gHourCost:2577 };
var QG_OH_KEYS = ['gFixed','gAdSpend','gPayrollOv','gVisitsPlan','gTarget'];
var QG_PARAM_LABELS = [
  ['gHead','人次獎金／每位學生（老師、行政）'], ['gMaster','主教每堂'], ['gAssist','助教每堂'], ['gJunior','小老師每堂'],
  ['gHourCost','教室每小時成本（房租＋固定薪水平均；占用小時×這個，算進報價）'], ['gHq','總部管理費 %'], ['gTax','營業稅 %'], ['gOutMin','外派最低計費人數'], ['gInTol','內場容許差額（人）']
];
/* 目標淨利率固定（扣完材料、獎金、總部 10%、房租薪水分攤之後留下的比例），內場／外派分開。
   2026-10-15 大熊定：內場 33%、外派 35%（council 建議內場 30–35%、外派 35%）。不放在畫面上，避免被隨手改；要調只改這兩行 */
var QG_GM_IN = 33, QG_GM_OUT = 35;
function qgGmOf(venue){ return venue === 'out' ? QG_GM_OUT : QG_GM_IN; }
var QG_LEVELS = { master:'主教', assist:'助教', junior:'小老師' };
var QG_ROLES  = { teacher:'老師', admin:'行政', sales:'業務' };
var QG_MODES  = { head:'人頭', session:'按堂', none:'不發' };

function qgParams(){
  if (!S.quoteParams) S.quoteParams = {};
  var p = S.quoteParams;
  Object.keys(QG_PARAM_DEFAULTS).forEach(function(k){
    if (p[k]===undefined || p[k]===null || p[k]==='') p[k] = QG_PARAM_DEFAULTS[k];
  });
  return p;
}

/* 計費方式：業務不發；其他人看這場有沒有付講師費（有＝按堂，沒有＝人次獎金） */
function qgDefaultMode(role, lecOn){
  if (role === 'sales') return 'none';
  return lecOn ? 'session' : 'head';
}

function qgDefaultStaff(venue, lecOn){
  var rows = venue === 'out'
    ? [ {role:'teacher', level:'master'}, {role:'teacher', level:'assist'}, {role:'sales', level:'junior'} ]
    : [ {role:'teacher', level:'master'}, {role:'teacher', level:'assist'}, {role:'teacher', level:'assist'},
        {role:'admin', level:'junior'}, {role:'sales', level:'junior'} ];
  return rows.map(function(r){
    return { name:'', role:r.role, level:r.level, mode:qgDefaultMode(r.role, lecOn), heads:0, extra:0 };
  });
}

/* 帶課老師幾位：看人員列裡角色是「老師」的有幾列。改這個數字＝增減老師列（第一位主教，其餘助教） */
function qgTeacherCount(){
  return qgCase.staff.filter(function(r){ return r.role === 'teacher'; }).length;
}
function qgSetTeacherCount(k){
  k = Math.max(0, Math.min(20, Math.round(k)));
  var cur = qgTeacherCount();
  while (cur < k) {
    var first = !qgCase.staff.some(function(r){ return r.role === 'teacher'; });
    var row = { name:'', role:'teacher', level:first ? 'master' : 'assist', mode:qgDefaultMode('teacher', qgCase.lecOn), heads:0, extra:0 };
    var at = 0; qgCase.staff.forEach(function(r, i){ if (r.role === 'teacher') at = i + 1; });   // 插在最後一位老師後面，行政、業務維持在下面
    qgCase.staff.splice(at, 0, row); cur++;
  }
  while (cur > k) {
    for (var i = qgCase.staff.length - 1; i >= 0; i--) { if (qgCase.staff[i].role === 'teacher') { qgCase.staff.splice(i, 1); break; } }
    cur--;
  }
  qgSpreadHeads(qgCase);
}
/* 隨尺寸材料沒填的話，尺寸用量按了也不會有變化：把那一格框起來、捲過去，不要讓人以為按鈕壞了 */
function qgFlashMatVar(){
  var blank = qgCase.matVar === '' || qgCase.matVar === null || qgCase.matVar === undefined || qN(qgCase.matVar) === 0;
  var e = document.getElementById('qg-matVar'); if (!e || !blank) return;
  e.scrollIntoView({ behavior:'smooth', block:'center' });
  e.style.transition = 'box-shadow .3s'; e.style.boxShadow = '0 0 0 3px var(--gold)';
  setTimeout(function(){ e.style.boxShadow = ''; }, 1800);
}
function qgSyncTeacherCount(){
  var e = document.getElementById('qg-tcount');
  if (e && document.activeElement !== e) e.value = qgTeacherCount();
}

/* 把報名人數平均分給計費方式為「人頭」的人，餘數從第一位開始多分一位 */
function qgSpreadHeads(c){
  var heads = c.staff.filter(function(r){ return r.mode === 'head'; });
  if (!heads.length) return;
  var n = Math.max(0, Math.round(qN(c.n)));
  var base = Math.floor(n / heads.length), rest = n % heads.length;
  heads.forEach(function(r, i){ r.heads = base + (i < rest ? 1 : 0); });
}

function qgNewCase(venue){
  venue = venue || 'in';
  var lecOn = venue === 'out';   // 外派預設付講師費、也另外跟客人收；內場預設只有人次獎金。兩個都可以自己改
  var c = { venue:venue, lecOn:lecOn, lecCharge:lecOn, n:(venue==='out'?20:25), hrs:(venue==='out'?2:2.5), matFixed:'', matVar:'', sizePct:100, buffer:1, gm:qgGmOf(venue), price:1200, auto:true, course:'', anchor:'', recipeKey:'', pick:{}, sizeGrp:'', baseArea:0, baseName:'',
            trans:0, haul:0, misc:0, lost:0, staff:qgDefaultStaff(venue, lecOn) };
  qgSpreadHeads(c);
  return c;
}
var qgCase = qgNewCase('in');

/* 名字對得上「老師設定」的人，按堂講師費套用他的講師費倍率（跟薪資計算一致）；對不上就是 1 */
function qgLecRate(name){
  name = String(name||'').trim();
  if (!name || typeof S === 'undefined' || !S.teachers) return 1;
  var t = S.teachers.find(function(x){ return x.name === name; });
  if (!t || t.lecRate === undefined || t.lecRate === null || t.lecRate === '') return 1;
  var r = parseFloat(t.lecRate);
  return isFinite(r) ? r : 1;
}

function qgRowFee(r, p){
  var fee = 0;
  if (r.mode === 'head') fee = qN(r.heads) * qN(p.gHead);
  else if (r.mode === 'session') {
    var lv = r.level === 'master' ? p.gMaster : (r.level === 'assist' ? p.gAssist : p.gJunior);
    fee = qN(lv) * qgLecRate(r.name);
  }
  return Math.round(fee) + qN(r.extra);
}

/* 課程管理的資料（catalog.js 的 catRows）；舊的「體驗價／會員價」別列不列出，價格統一看「單次原價」那列 */
function qgCourseRows(){
  if (typeof catRows === 'undefined' || !catRows) return null;
  return catRows.filter(function(r){ return !(typeof catIsLegacy === 'function' && catIsLegacy(r)) && r.name; });
}
/* 一門課的新客價（含稅、每人）與來源 */
function qgAnchorOf(r, hrs){
  if (!r) return { v:0, src:'' };
  var n = function(x){ var v = parseFloat(x); return isFinite(v) && v > 0 ? v : 0; };
  if (n(r.hourly)) return { v: Math.round(n(r.hourly) * hrs), src:'每小時 ' + n(r.hourly) + ' × ' + hrs + ' 小時' };
  var today = typeof catToday === 'function' ? catToday() : '';
  if (n(r.early) && /^\d{4}-\d{2}-\d{2}$/.test(r.earlyUntil || '') && today <= r.earlyUntil) return { v:n(r.early), src:'早鳥價' };
  if (n(r.pFirst))  return { v:n(r.pFirst),  src:'初次體驗價' };
  if (n(r.pMember)) return { v:n(r.pMember), src:'優惠價（會員價）' };
  if (n(r.pOrig))   return { v:n(r.pOrig),   src:'原價（這門課沒填優惠價）' };
  return { v:n(r.price), src:'試算表價格' };
}
function qgCourseById(id){
  var rows = qgCourseRows() || [];
  return rows.find(function(r){ return r.id === id; }) || null;
}

/* 四樓每月「不管有沒有客人都要付」的錢：固定開銷＋固定薪水（底薪、固定津貼、兼職時薪）＋廣告費。
   人次獎金、講師費、業績績效是隨客人變動的，不算在這裡（人次獎金已在每人成本裡）。
   固定薪水預設從上方選的月份自動算，可手填蓋過；月人次用「預期每月人次」（正常月份），不用當月到目前為止的人次，月中才不會失真 */
function qgOverhead(p){
  var st = p.gStore || 'flagship', mKey = '', payA = 0, visA = 0, ok = false;
  try {
    if (typeof getMonthKey === 'function' && typeof aggregateMonth === 'function' && document.getElementById('selYear')) {
      mKey = getMonthKey();
      var tot = aggregateMonth(st, mKey), bk = mKey + '_' + st;
      visA = qN(tot.newCust) + qN(tot.oldCust);
      (typeof getTeachers === 'function' ? getTeachers(st) : []).forEach(function(t){
        var c = calcSalary(t, st, mKey);
        payA += qN(getBaseSalary(t, bk)) + qN(c && c.adminAmt) + qN(c && c.supFee) + qN(c && c.ptBasePay);
      });
      ok = true;
    }
  } catch (e) { console.warn('報價：自動抓固定薪水失敗', e); }
  var pay = qN(p.gPayrollOv) > 0 ? qN(p.gPayrollOv) : payA;
  var visits = qN(p.gVisitsPlan) > 0 ? qN(p.gVisitsPlan) : visA;
  var fixed = qN(p.gFixed), ad = qN(p.gAdSpend), target = qN(p.gTarget);
  return { mKey:mKey, ok:ok, payA:Math.round(payA), visA:visA, payroll:pay, visits:visits,
    fixed:fixed, ad:ad, target:target, monthly: fixed + pay + ad };
}

/* 純計算：不碰畫面，方便驗算 */
function qgCompute(c, p){
  var n = Math.max(1, qN(c.n)), hrs = Math.max(0.5, qN(c.hrs));
  var hq = qN(p.gHq) / 100, tax = qN(p.gTax) / 100, gm = qgGmOf(c.venue) / 100;   // 淨利率固定（內場／外派各一個），不吃畫面上的值
  var isOut = c.venue === 'out';
  /* 材料＝固定材料（畫布五號以下同價，不隨尺寸變）＋隨尺寸材料（膠、水晶、金箔、顏料…）× 用量比例。
     基準尺寸＝用量比例 100% 那一款；換尺寸只改用量比例，價差照成本轉嫁 */
  var matFixed = qN(c.matFixed), matVar = qN(c.matVar);
  var sizePct = (c.sizePct === '' || c.sizePct === null || c.sizePct === undefined) ? 100 : qN(c.sizePct);
  var matPer = matFixed + matVar * sizePct / 100, stdMat = matFixed + matVar;
  var mat = n * matPer;
  var lecFees = 0, headFees = 0;
  c.staff.forEach(function(r){
    var f = qgRowFee(r, p), ex = qN(r.extra);
    if (r.mode === 'session') lecFees += f;            // 按堂講師費（含加發）
    else { headFees += f - ex; lecFees += ex; }       // 人次獎金；加發算講師費那一類
  });
  /* 人次獎金＝每教一位學生 50，總額跟「老師有幾位、每位帶幾個」無關；有人按人頭計費就一定照報名人數算，
     不然人頭欄位漏填（或被改成 0）價格會偏低。每位分到幾個只影響各自的費用顯示 */
  if (c.staff.some(function(r){ return r.mode === 'head'; })) headFees = Math.round(n) * qN(p.gHead);
  var fees = lecFees + headFees;
  var trans = isOut ? qN(c.trans) : 0, haul = isOut ? qN(c.haul) : 0;
  var misc = qN(c.misc), lost = qN(c.lost);
  var cost = mat + fees + trans + haul + misc + lost;
  /* 場次成本：內場這場占用教室的時間（上課＋準備收拾）× 每小時房租薪水成本。外派不占用四樓教室，不算 */
  var buffer = (c.buffer === '' || c.buffer === null || c.buffer === undefined) ? 1 : qN(c.buffer);
  var occHrs = isOut ? 0 : hrs + buffer;
  var occ = occHrs * qN(p.gHourCost);
  var costFull = cost + occ;
  /* 講師費另外跟客人收＝代收代付（總部 10% 照營業額算，所以講師費那一塊會被抽 10%）；沒另外收就得從每人價裡賺回來 */
  var lecRev = (c.lecCharge && lecFees > 0) ? lecFees : 0;
  var at = function(R){
    var rv = R + lecRev, pr = rv * (1 - hq) - cost, nt = pr - occ;
    return { R:R, perTax:R * (1 + tax) / n, perHr:R / hrs, profit:pr, net:nt, margin: rv > 0 ? nt / rv : 0 };
  };
  /* 材料比「標準材料」貴（客人升級）多出來的錢＝轉嫁成本：先拿標準材料算目標利潤，再把差額連總部 10% 一起補上去，
     這樣材料升級不會被乘上利潤率（以前材料多 200，每人價會漲 700）。新客價對照也加同樣的差額 */
  var matDiffPer = matPer - stdMat, matDiff = n * matDiffPer;
  var costStd = costFull - matDiff, pass = matDiff / (1 - hq);
  var Rcash = Math.max(0, cost / (1 - hq) - lecRev);        // 現金底線：只算這場多花的錢
  var Rbe = Math.max(0, costFull / (1 - hq) - lecRev);      // 打平：連場次成本（房租薪水分攤）都賺回來
  var tgtDen = 1 - hq - gm;
  var Rtgt = tgtDen > 0 ? Math.max(Rbe, costStd / tgtDen - lecRev + pass) : Rbe;
  var gmHi = Math.min(0.8, gm + 0.2), hiDen = 1 - hq - gmHi;
  var Rhi = hiDen > 0 ? Math.max(Rtgt, costStd / hiDen - lecRev + pass) : Rtgt;
  var anchorRaw = qN(c.anchor);
  var anchorNet = anchorRaw > 0 ? anchorRaw / (1 + tax) + matDiffPer / (1 - hq) : 0;
  var anchor = anchorRaw > 0 ? anchorNet * (1 + tax) : 0;
  var recPerTax = Math.ceil(Rtgt * (1 + tax) / n / 50 - 1e-9) * 50;   // 報給家長好聽：含稅往上取整到 50
  var price = c.auto ? recPerTax / (1 + tax) : qN(c.price);
  var R = price * n, rev = R + lecRev, hqFee = rev * hq, profit = rev - hqFee - cost, net = profit - occ;
  var guarantee = isOut ? Math.max(n, qN(p.gOutMin)) : Math.max(1, n - qN(p.gInTol));
  var headSum = c.staff.filter(function(r){ return r.mode === 'head'; })
                       .reduce(function(s, r){ return s + qN(r.heads); }, 0);
  return {
    n:n, hrs:hrs, tax:tax, hq:hq, gm:gm, gmHi:gmHi, isOut:isOut, auto:!!c.auto, anchor:anchor, anchorRaw:anchorRaw, anchorNet:anchorNet, matDiffPer:matDiffPer, stdMat:stdMat, matPer:matPer, matFixed:matFixed, matVar:matVar, sizePct:sizePct,
    price:price, perTax:price*(1+tax), recPerTax:recPerTax,
    mat:mat, fees:fees, lecFees:lecFees, headFees:headFees, trans:trans, haul:haul, misc:misc, lost:lost, cost:cost,
    lecRev:lecRev, lecRevTax:lecRev*(1+tax), R:R, rev:rev, revTax:rev*(1+tax), hqFee:hqFee, profit:profit, net:net, margin: rev > 0 ? net/rev : 0,
    buffer:buffer, occHrs:occHrs, occ:occ, costFull:costFull,
    cash:at(Rcash), be:at(Rbe), tgt:at(Rtgt), hi:at(Rhi), cur:at(R),
    guarantee:guarantee, headSum:headSum, hasHead:headSum > 0 || c.staff.some(function(r){ return r.mode==='head'; }),
    perStaff: c.staff.length ? n / c.staff.length : 0
  };
}

function qgField(id, label, val, step, hint){
  return '<div class="fg" id="'+id+'-wrap"><label>'+label+'</label>' +
    '<input type="number" id="'+id+'" value="'+val+'" min="0" step="'+(step||1)+'" onwheel="this.blur()">' +
    (hint ? '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.5">'+hint+'</div>' : '') + '</div>';
}

function qgSkeleton(){
  var c = qgCase, p = qgParams();
  var h = '';

  h += '<div class="card" id="qg-hero" style="border-left:4px solid var(--gold)">';
  h +=   '<div style="font-size:13px;color:var(--text3)" id="qg-heroLbl">跟家長報每人（含稅）</div>';
  h +=   '<div style="font-family:var(--serif);font-size:42px;font-weight:400;color:var(--text);margin:2px 0 6px">NT$ <span id="qg-per">—</span></div>';
  h +=   '<div style="font-size:14px;color:var(--text2)">利潤率 <span id="qg-margin">—</span>｜扣掉教室占用成本後實際賺 NT$ <span id="qg-profit">—</span>｜還沒扣教室成本前 NT$ <span id="qg-contrib">—</span></div>';
  h +=   '<div id="qg-lecLine" style="font-size:14px;color:var(--text2);margin-top:6px"></div>';
  h +=   '<div class="stat-grid" style="margin-top:14px;margin-bottom:0">';
  h +=     '<div class="stat-card"><div class="lbl">報價總額（含稅，開發票金額）</div><div class="val" style="font-size:19px" id="qg-revTax">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">每小時（含稅）</div><div class="val" style="font-size:19px" id="qg-perHr">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">保證計費人數</div><div class="val" style="font-size:19px" id="qg-guar">—</div></div>';
  h +=   '</div>';
  h +=   '<div id="qg-why" style="margin-top:14px;font-size:14px;line-height:1.8;padding:12px 14px;border-radius:10px;background:var(--bg2,rgba(0,0,0,.03))"></div>';
  h +=   '<div id="qg-warn" style="margin-top:14px;font-size:14px;line-height:1.7"></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">團班條件（改這裡）</div>';
  h +=   '<div class="fg" style="margin-bottom:10px"><label>上課地點</label><div class="store-tabs" id="qg-venue" style="margin-bottom:0">';
  h +=     '<button type="button" class="store-btn'+(c.venue==='in'?' active':'')+'" data-v="in">內場（四樓）</button>';
  h +=     '<button type="button" class="store-btn'+(c.venue==='out'?' active':'')+'" data-v="out">外派</button>';
  h +=   '</div></div>';
  h +=   '<label class="chk top" style="margin-bottom:6px"><input type="checkbox" id="qg-lecOn"'+(c.lecOn?' checked':'')+'>' +
         '<span>這場要付講師費給老師（非上班時間、晚上、週日一定要；上班時間內的外派自己決定。沒勾＝只有每位學生 50 元的人次獎金）</span></label>';
  h +=   '<label class="chk top" id="qg-lecChargeWrap" style="margin-bottom:14px;'+(c.lecOn?'':'display:none')+'"><input type="checkbox" id="qg-lecCharge"'+(c.lecCharge?' checked':'')+'>' +
         '<span>講師費另外跟客人收（老闆的局收不到就不要勾：講師費照付，但要從每人價裡賺回來）</span></label>';
  h +=   '<div class="qg-sec">課程</div>';
  h +=   '<div class="qg-grid">';
  h +=     '<div class="fg qg-span3"><label>上什麼課</label>' +
           '<select id="qg-course"><option value="">— 不選，自己填體驗價 —</option></select>' +
           '<div class="qg-hint" id="qg-courseHint">從課程管理帶入體驗價與材料，可不選</div></div>';
  h +=     '<div class="qg-span3" id="qg-picks"></div>';
  h +=     qgField('qg-anchor', '體驗價（含稅／人）', c.anchor, 50, '一個人自己來要付多少，只拿來對照');
  h +=   '</div>';
  h +=   '<div class="qg-sec">場次</div>';
  h +=   '<div class="qg-grid">';
  h +=     qgField('qg-n', '報名人數', c.n, 1);
  h +=     qgField('qg-hrs', '上課時長（小時）', c.hrs, 0.5, '按小時報價時用來換算');
  h +=     qgField('qg-tcount', '帶課老師（位）', qgTeacherCount(), 1, '主教1位，其餘助教；細節在下面「帶課人員」');
  h +=     qgField('qg-buffer', '準備＋收拾（小時）', c.buffer, 0.5, '教室被占用但沒收錢的時間，只有內場算');
  h +=   '</div>';
  h +=   '<div class="qg-sec">材料（每人）</div>';
  h +=   '<div class="qg-grid">';
  h +=     qgField('qg-matFixed', '基底材與包裝（每人）', c.matFixed, 10, '畫布、厚畫布、鏡子、包裝：選哪個尺寸就是哪個價，不受用量 % 影響');
  h +=     qgField('qg-matVar', '耗材（每人）', c.matVar, 10, '膠、水晶、金箔、顏料：尺寸縮小會變少，填基準尺寸那款的合計');
  h +=     '<div class="fg"><label>耗材用量 %（尺寸縮小就調低）</label>' +
           '<input type="number" id="qg-sizePct" value="'+c.sizePct+'" min="0" step="5" onwheel="this.blur()">' +
           '<div class="qg-pills" id="qg-sizeBtns"><button type="button" data-p="100">100</button><button type="button" data-p="90">90</button><button type="button" data-p="80">80</button><button type="button" data-p="70">70</button><button type="button" data-p="60">60</button></div></div>';
  h +=   '</div>';
  h +=   '<div class="qg-note" id="qg-sizeNote"></div>';
  h +=   '<div class="qg-sec">報價</div>';
  h +=   '<div class="qg-grid">';
  h +=     qgField('qg-price', '報價每人（含稅）', Math.round(c.price * (1 + qN(p.gTax) / 100)), 50, '<span id="qg-priceHint"></span>');
  h +=     '<div class="fg qg-span2"><label>報價方式</label><div class="store-tabs" id="qg-pmode" style="margin-bottom:0">';
  h +=       '<button type="button" class="store-btn'+(c.auto?' active':'')+'" data-v="auto">自動（系統建議）</button>';
  h +=       '<button type="button" class="store-btn'+(!c.auto?' active':'')+'" data-v="manual">自己訂價</button>';
  h +=     '</div><div class="qg-hint" id="qg-gmHint"></div></div>';
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">帶課人員（老師、行政、業務都會下場，每一位列一行）</div>';
  h +=   '<div id="qg-staff"></div>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">';
  h +=     '<button class="btn btn-outline" id="qg-addStaff">新增帶課人員</button>';
  h +=     '<button class="btn btn-outline" id="qg-spread">把人數平均分給按人頭的人</button>';
  h +=   '</div>';
  h +=   '<p class="muted" style="margin-top:10px">姓名對得上「老師設定」裡的人，按堂講師費會自動乘上他的講師費倍率。業務預設不發。每一位的計費方式都可以單獨改。</p>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">其他成本</div>';
  h +=   '<div class="qg-grid">';
  h +=     qgField('qg-trans', '交通費', c.trans, 100);
  h +=     qgField('qg-haul', '搬運／車資', c.haul, 100);
  h +=     qgField('qg-misc', '其他雜支', c.misc, 100, '布置、清潔、包材等');
  h +=     qgField('qg-lost', '當天被擠掉的四樓營收', c.lost, 500, '這場占掉的時段，原本預估能收多少（這時段平常大約賺多少）。週日與晚上通常是 0');
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">價格落差：最低可接價（現金底線）→ 回收教室成本價 → 建議價 → 開價（客人要按小時報，看「每小時」那欄）</div>';
  h +=   '<div style="overflow-x:auto"><table><thead><tr><th></th><th>課程費（含稅）</th><th>每人（含稅）</th><th>每小時（含稅）</th><th>利潤率</th><th>實際賺到（已扣教室成本）</th><th>還沒扣教室成本前</th></tr></thead><tbody id="qg-tiers"></tbody></table></div>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">';
  h +=     '<button class="btn btn-gold" id="qg-copy">複製報價文字</button>';
  h +=     '<button class="btn btn-outline" id="qg-reset">回到預設條件</button>';
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">人數對照：同一門課、同樣條件，人數不同價格差多少（每人含稅）</div>';
  h +=   '<div style="overflow-x:auto"><table><thead><tr><th>人數</th><th id="qg-byN-h1">最低可接價</th><th>建議價</th><th>整場建議價</th><th>比體驗價</th><th>這場現金多賺</th><th>扣教室成本後利潤率</th><th>基底材尺寸上限</th></tr></thead><tbody id="qg-byN"></tbody></table></div>';
  h +=   '<div class="qg-hint" style="margin-top:8px">每一格都是用上面填的課程、材料、時長、老師人數重新算的；價格往上取整（最低可接價取整到 10、建議價取整到 50）。最低可接價只算這場多花的現金（材料、獎金、總部、交通…），房租和固定薪水不管有沒有這團都要付，所以不算進去；若這個時段原本會有現金客人，請填上面「當天被擠掉的四樓營收」。建議價最高封頂在體驗價（團班不會比一個人自己來貴）。人數少時教室成本分不掉，所以看「這場現金多賺」。老師人數是照上面設定，人數多到要加老師，請自己先把「帶課老師」改好。外派如果講師費另外跟客人收，這裡是課程費，講師費另計。</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">預算入口：對方說預算，哪些「尺寸 × 人數」做得到</div>';
  h +=   '<div class="qg-grid">' + qgField('qg-budget', '對方預算（每人，含稅）', c.budget || '', 50, '填了就會標出哪些做得到；沒填就只列價格') + '</div>';
  h +=   '<div id="qg-budgetOut" style="margin-top:6px"></div>';
  h += '</div>';

  h += '<div class="card" id="qg-caps"></div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">成本拆解（錢花去哪裡）</div>';
  h +=   '<div id="qg-breakdown"></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<details><summary style="cursor:pointer;font-weight:600;color:var(--gold2);font-size:14.5px">講師費、稅與成團保證設定</summary>';
  h +=   '<div class="form-grid" style="margin-top:16px">';
  QG_PARAM_LABELS.forEach(function(pair){
    h += '<div class="fg"><label>'+pair[1]+'</label><input type="number" id="qg-'+pair[0]+'" value="'+p[pair[0]]+'" min="0" step="1" onwheel="this.blur()"></div>';
  });
  h +=   '</div>';
  h +=   '<p class="muted">付給老師的講師費一律按堂算（主教／助教／小老師三級，跟薪資的外派講師費同一套數字）。改這裡會自動存檔、全店同步。</p>';
  h +=   '</details>';
  h += '</div>';

  return h;
}

function qgEsc(s){ return String(s==null?'':s).replace(/[&<>"]/g, function(ch){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]; }); }

function qgOpts(map, cur){
  return Object.keys(map).map(function(k){ return '<option value="'+k+'"'+(k===cur?' selected':'')+'>'+map[k]+'</option>'; }).join('');
}

function qgRenderStaff(){
  var box = document.getElementById('qg-staff'); if (!box) return;
  var p = qgParams();
  var names = (typeof S !== 'undefined' && S.teachers) ? S.teachers.map(function(t){ return t.name; }) : [];
  var h = '<datalist id="qg-names">' + names.map(function(nm){ return '<option value="'+qgEsc(nm)+'">'; }).join('') + '</datalist>';
  qgCase.staff.forEach(function(r, i){
    var rate = qgLecRate(r.name);
    h += '<div class="qg-row" data-i="'+i+'" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:10px">';
    h +=   '<div class="qg-grid qg-five">';
    h +=     '<div class="fg"><label>姓名</label><input type="text" data-k="name" list="qg-names" value="'+qgEsc(r.name)+'" placeholder="可留白"></div>';
    h +=     '<div class="fg"><label>角色</label><select data-k="role">'+qgOpts(QG_ROLES, r.role)+'</select></div>';
    h +=     '<div class="fg"><label>計費方式</label><select data-k="mode">'+qgOpts(QG_MODES, r.mode)+'</select></div>';
    if (r.mode === 'session')
      h +=   '<div class="fg"><label>等級'+(rate!==1?'（倍率 ×'+rate+'）':'')+'</label><select data-k="level">'+qgOpts(QG_LEVELS, r.level)+'</select></div>';
    if (r.mode === 'head')
      h +=   '<div class="fg"><label>帶幾位學生</label><input type="number" data-k="heads" value="'+r.heads+'" min="0" step="1" onwheel="this.blur()"></div>';
    h +=     '<div class="fg"><label>加發</label><input type="number" data-k="extra" value="'+r.extra+'" min="0" step="100" onwheel="this.blur()"></div>';
    h +=   '</div>';
    h +=   '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:14px">';
    h +=     '<span style="color:var(--text3)">這位的費用 NT$ <span class="qg-fee">'+qFmt(qgRowFee(r, p))+'</span></span>';
    h +=     '<button type="button" class="btn btn-outline" data-del="'+i+'" style="padding:4px 12px">刪除這位</button>';
    h +=   '</div>';
    h += '</div>';
  });
  if (!qgCase.staff.length) h += '<p class="muted">還沒有帶課人員。</p>';
  box.innerHTML = h;
}

function qgBindEvents(){
  var map = { 'qg-n':'n', 'qg-hrs':'hrs', 'qg-price':'price', 'qg-buffer':'buffer', 'qg-sizePct':'sizePct', 'qg-trans':'trans', 'qg-haul':'haul', 'qg-misc':'misc', 'qg-lost':'lost', 'qg-budget':'budget' };
  Object.keys(map).forEach(function(id){
    document.getElementById(id).addEventListener('input', function(){
      qgCase[map[id]] = (id === 'qg-sizePct' && this.value === '') ? '' : (id === 'qg-price' ? qN(this.value) / (1 + qN(qgParams().gTax) / 100) : qN(this.value));   // 用量比例留空＝100；報價每人填含稅，內部換成未稅算
      if (id === 'qg-n') { qgSpreadHeads(qgCase); qgRenderStaff(); }
      qgRecalc();
    });
  });
  document.getElementById('qg-tcount').addEventListener('input', function(){
    if (this.value === '') return;
    qgSetTeacherCount(qN(this.value)); qgRenderStaff(); qgRecalc();
  });
  document.getElementById('qg-sizeBtns').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    qgCase.sizePct = qN(b.dataset.p);
    document.getElementById('qg-sizePct').value = qgCase.sizePct;
    qgRecalc();
    qgFlashMatVar();
  });
  document.getElementById('qg-anchor').addEventListener('input', function(){
    qgCase.anchor = this.value === '' ? '' : qN(this.value);
    if (qgCase.course) { qgCase.course = ''; var sel = document.getElementById('qg-course'); if (sel) sel.value = ''; }  // 手改就不算那門課了
    qgRenderCaps();
    qgRecalc();
  });
  document.getElementById('qg-picks').addEventListener('change', function(e){
    var t = e.target; if (!t || t.tagName !== 'SELECT') return;
    qgPickChange(parseInt(t.dataset.gi, 10), t.value);
  });
  var capBox = document.getElementById('qg-caps');
  capBox.addEventListener('input', function(e){
    var t = e.target, row = t.closest('[data-id]'); if (!row || !t.dataset.k) return;
    var rule = qgCapsAll()[row.dataset.id]; if (!rule) return;
    rule[t.dataset.k] = t.dataset.k === 'minN' ? qN(t.value) : t.value.trim();
    var hint = row.querySelector('[data-hint]'); if (hint) hint.textContent = qgCapHint(rule.size);
    save();
    qgRecalc();
  });
  capBox.addEventListener('click', function(e){
    var add = e.target.closest('[data-capadd]'), del = e.target.closest('[data-capdel]');
    if (add) {
      var name = qgCourseName(); if (!name) return;
      var rules = qgCapRules(name), last = rules.length ? rules[rules.length - 1].minN : 0;
      qgCapsAll()['k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)] = { course:name, minN:last ? last + 5 : 13, size:'' };
      save(); qgRenderCaps(); qgRecalc();
    } else if (del) {
      var id = del.dataset.capdel;
      if (typeof tombstonePath === 'function') tombstonePath('quoteSizeCaps.' + id);   // 物件裡刪一條：不記墓碑的話，下次存檔會從雲端補回來
      delete qgCapsAll()[id];
      save(); qgRenderCaps(); qgRecalc();
    }
  });
  document.getElementById('qg-course').addEventListener('change', function(){
    qgCase.course = this.value;
    qgApplyCourse(true);
    qgRecalc();
  });
  document.getElementById('qg-hrs').addEventListener('input', function(){
    var r = qgCourseById(qgCase.course);
    if (r && parseFloat(r.hourly) > 0) { qgApplyCourse(false); qgRecalc(); }   // 計時課：時長一改，新客價跟著變
  });
  qgFillCourses();
  document.getElementById('qg-price').addEventListener('focus', function(){
    if (!qgCase.auto) return;
    qgCase.auto = false; qgCase.price = qN(this.value) / (1 + qN(qgParams().gTax) / 100);
    qgSyncPmode(); qgRecalc();
  });
  document.getElementById('qg-pmode').addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    var auto = b.dataset.v === 'auto';
    if (qgCase.auto === auto) return;
    if (!auto) qgCase.price = Math.round(qgCompute(qgCase, qgParams()).price);  // 從建議價開始改
    qgCase.auto = auto;
    qgSyncPmode(); qgRecalc();
  });
  ['qg-matFixed','qg-matVar'].forEach(function(id){
    document.getElementById(id).addEventListener('input', function(){
      qgCase[id.slice(3)] = this.value === '' ? '' : qN(this.value); qgRecalc();
    });
  });

  var venueWrap = document.getElementById('qg-venue');
  venueWrap.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (qgCase.venue === b.dataset.v) return;
    qgCase.venue = b.dataset.v;
    venueWrap.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); });
    // 換地點：講師費／另收的預設跟著換（外派預設付＋另收，內場預設不付），人員列也換成對應的計費方式；之後兩個勾勾都還能自己改
    qgCase.lecOn = qgCase.venue === 'out'; qgCase.lecCharge = qgCase.lecOn;
    qgSyncLec();
    qgCase.staff.forEach(function(r){ r.mode = qgDefaultMode(r.role, qgCase.lecOn); });
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgRecalc();
  });

  document.getElementById('qg-lecOn').addEventListener('change', function(){
    qgCase.lecOn = this.checked;
    if (!qgCase.lecOn) qgCase.lecCharge = false;
    qgSyncLec();
    qgCase.staff.forEach(function(r){ r.mode = qgDefaultMode(r.role, qgCase.lecOn); });
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgRecalc();
  });
  document.getElementById('qg-lecCharge').addEventListener('change', function(){
    qgCase.lecCharge = this.checked; qgRecalc();
  });

  var box = document.getElementById('qg-staff');
  box.addEventListener('input', function(e){
    var t = e.target, k = t.dataset.k; if (!k || t.tagName === 'SELECT') return;
    var row = qgCase.staff[+t.closest('.qg-row').dataset.i];
    row[k] = k === 'name' ? t.value : qN(t.value);
    qgRecalc();
  });
  box.addEventListener('change', function(e){
    var t = e.target, k = t.dataset.k; if (!k) return;
    var row = qgCase.staff[+t.closest('.qg-row').dataset.i];
    if (t.tagName === 'SELECT') {
      row[k] = t.value;
      if (k === 'role') row.mode = qgDefaultMode(row.role, qgCase.lecOn);
      if (k === 'role' || k === 'mode') qgSpreadHeads(qgCase);
    }
    qgRenderStaff();   // 姓名改完重畫一次，倍率標示才會跟上
    qgSyncTeacherCount();
    qgRecalc();
  });
  box.addEventListener('click', function(e){
    var b = e.target.closest('[data-del]'); if (!b) return;
    qgCase.staff.splice(+b.dataset.del, 1);
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgSyncTeacherCount();
    qgRecalc();
  });

  document.getElementById('qg-addStaff').addEventListener('click', function(){
    qgCase.staff.push({ name:'', role:'teacher', level:'assist', mode:qgDefaultMode('teacher', qgCase.lecOn), heads:0, extra:0 });
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgSyncTeacherCount();
    qgRecalc();
  });
  document.getElementById('qg-spread').addEventListener('click', function(){
    qgSpreadHeads(qgCase); qgRenderStaff(); qgRecalc();
  });

  QG_PARAM_LABELS.forEach(function(pair){
    document.getElementById('qg-'+pair[0]).addEventListener('input', function(){
      qgParams()[pair[0]] = qN(this.value);
      save();
      qgRenderStaff();
      qgRecalc();
    });
  });

  document.getElementById('qg-copy').addEventListener('click', qgCopyText);
  document.getElementById('qg-reset').addEventListener('click', function(){
    qgCase = qgNewCase(qgCase.venue);
    renderQuote();
  });
}

/* 人數對照表、預算入口共用的人數檔：內場 8／12（小教室滿）／15／20／25（大教室滿）；外派從最低計費人數起每 5 人一檔 */
function qgNs(isOut, p){ return isOut ? [qN(p.gOutMin), qN(p.gOutMin) + 5, qN(p.gOutMin) + 10] : [8, 12, 15, 20, 25]; }

/* 預算入口的「列」：這門課有基底材尺寸下拉就一款一列（照面積由大到小），每列用配方重算材料；沒有就退而求其次列耗材用量 % */
function qgBudgetRows(){
  var c = qgCase, gs = c.recipeKey ? qgRecipeGroups(c.recipeKey) : [], sg = qgSizeGroup(gs);
  if (sg && typeof rcParts === 'function') {
    return sg.opts.slice().sort(function(a, b){ return (b.area - a.area) || (b.cost - a.cost); }).map(function(o){
      var pick = Object.assign({}, c.pick); pick[sg.grp] = o.id;
      if (o.area) gs.forEach(function(g){ if (g.grp === sg.grp) return; var m = qgNearestOpt(g, o.area, 0.05); if (m) pick[g.grp] = m.id; });
      var pp = rcParts(c.recipeKey, pick);
      return { label:o.name, area:o.area, over:{ matFixed:Math.round(pp.fixedW), matVar:pp.scalW > 0 ? Math.round(pp.scalW) : '', sizePct:(c.baseArea && o.area) ? Math.round(o.area / c.baseArea * 100) : 100 } };
    });
  }
  return [100, 90, 80, 70, 60].map(function(pc){ return { label:'耗材用量 ' + pc + '%', area:0, over:{ sizePct:pc } }; });
}
function qgRenderBudget(r, matMissing){
  var out = document.getElementById('qg-budgetOut'); if (!out) return;
  if (matMissing) { out.innerHTML = '<p class="muted">先填材料成本（或上面選一門有配方的課），才算得出各尺寸的價格。</p>'; return; }
  var c = qgCase, p = qgParams(), B = qN(c.budget), ns = qgNs(r.isOut, p), rows = qgBudgetRows(), name = qgCourseName();
  var up = function(v, step){ return Math.ceil(v / step - 1e-9) * step; };
  var grid = rows.map(function(row){
    return ns.map(function(nn){
      var x = qgCompute(Object.assign({}, c, row.over, { n:nn, auto:true }), p);
      var lo = up(x.cash.perTax, 10), mid = (x.anchor > 0 && x.recPerTax > x.anchor) ? x.anchor : x.recPerTax, cap = qgCapFor(name, nn);
      return { lo:lo, mid:mid, over:!!(cap && row.area && row.area > cap.area * 1.02), st: !B ? '' : (mid <= B ? 'ok' : (lo <= B ? 'low' : 'no')) };
    });
  });
  var mark = { ok:['✓', 'var(--green)'], low:['△', 'var(--gold2)'], no:['✕', 'var(--red)'] };
  var h = '<div style="overflow-x:auto"><table><thead><tr><th>' + (rows[0] && rows[0].area ? '基底材尺寸' : '材料用量') + '</th>' +
    ns.map(function(nn){ return '<th>' + nn + ' 人</th>'; }).join('') + '</tr></thead><tbody>';
  rows.forEach(function(row, i){
    h += '<tr><td>' + qgEsc(row.label) + '</td>';
    ns.forEach(function(nn, j){
      var g = grid[i][j], m = mark[g.st];
      h += '<td' + (g.over ? ' style="opacity:.55"' : '') + '>建議 ' + qFmt(g.mid) + (m ? ' <b style="color:' + m[1] + '">' + m[0] + '</b>' : '') +
        '<div class="muted" style="font-size:12px">最低 ' + qFmt(g.lo) + (g.over ? '　<span style="color:var(--gold2)">超過尺寸上限</span>' : '') + '</div></td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (B) {
    h += '<div style="margin-top:12px;line-height:1.9">';
    ns.forEach(function(nn, j){
      var best = null, low = null;
      rows.forEach(function(row, i){ var g = grid[i][j]; if (g.over) return; if (!best && g.st === 'ok') best = { row:row, g:g }; if (!low && g.st === 'low') low = { row:row, g:g }; });
      var t;
      if (best) t = '基底材最大可以做「' + qgEsc(best.row.label) + '」，建議價 ' + qFmt(best.g.mid) + '，在預算內';
      else if (low) t = '預算比建議價低，但高於現金底線 ' + qFmt(low.g.lo) + '，「' + qgEsc(low.row.label) + '」可以接，只是利潤比較薄';
      else { var lastG = grid[rows.length - 1][j]; t = '預算不夠，連最小的「' + qgEsc(rows[rows.length - 1].label) + '」最低也要 ' + qFmt(lastG.lo); }
      h += '<div><b>' + nn + ' 人</b>：' + t + '</div>';
    });
    h += '</div>';
  }
  h += '<div class="qg-hint" style="margin-top:8px">✓ 建議價在預算內　△ 預算比建議價低，但高於現金底線，可以接、利潤較薄　✕ 連現金底線都不夠。每一格都用這門課的配方重新算材料，不看你上面手改的材料數字；價格往上取整。' +
    (rows[0] && rows[0].area ? '' : '這門課沒有基底材尺寸下拉，這裡只能列耗材用量；要換小一號的基底材，請改選小尺寸那門課。') + '</div>';
  out.innerHTML = h;
}

/* ── 尺寸上限（依現場空間，大熊自己訂）──────────────────────────
   S.quoteSizeCaps = { 流水號: { course:課程名, minN:人數門檻, size:'8號' } }：這門課「幾個人以上，基底材最大做到多大」。
   用物件不用陣列：陣列存檔時會跟雲端取聯集，刪掉的又會跑回來。尺寸寫法跟配方一樣（8號、6F、20*20），用 qgSizeArea 換成面積比大小。
   只提醒、不改價格 */
function qgCapsAll(){ if (!S.quoteSizeCaps || typeof S.quoteSizeCaps !== 'object') S.quoteSizeCaps = {}; return S.quoteSizeCaps; }
function qgCourseName(){ var r = qgCourseById(qgCase.course); return r ? String(r.name || '').trim() : ''; }
function qgCapRules(name){
  var all = qgCapsAll();
  return Object.keys(all).filter(function(k){ return all[k] && all[k].course === name; }).map(function(k){
    return { id:k, minN:qN(all[k].minN), size:String(all[k].size || ''), area:qgSizeArea(all[k].size) };
  }).sort(function(a, b){ return a.minN - b.minN; });
}
/* 這個人數適用哪一條：人數門檻 ≤ 人數 裡最大的那條；尺寸看不懂的不算 */
function qgCapFor(name, n){
  var best = null;
  if (name) qgCapRules(name).forEach(function(x){ if (x.area > 0 && n >= x.minN) best = x; });
  return best;
}
function qgCapHint(size){
  if (!String(size || '').trim()) return '';
  var a = qgSizeArea(size);
  return a ? '看得懂（約 ' + qFmt(a) + ' 平方公分）' : '看不懂這個尺寸，請寫「8號」「6F」「20*20」這類';
}
/* 現在選的基底材尺寸：有尺寸下拉就用選的那款，否則用課程規格的尺寸；都抓不到面積就是 0 */
function qgCurSize(){
  var gs = qgCase.recipeKey ? qgRecipeGroups(qgCase.recipeKey) : [], sg = qgSizeGroup(gs);
  if (sg) { var o = qgPickOpt(sg, qgCase.pick[sg.grp]); if (o && o.area) return { area:o.area, name:o.name }; }
  var r = qgCourseById(qgCase.course), a = r ? qgSizeArea(r.spec) : 0;
  return a ? { area:a, name:String(r.spec) } : { area:0, name:'' };
}
function qgRenderCaps(){
  var box = document.getElementById('qg-caps'); if (!box) return;
  var name = qgCourseName();
  var h = '<div class="card-title">尺寸上限：幾個人以上，基底材最大做到多大（依現場空間，自己訂）</div>';
  if (!name) { box.innerHTML = h + '<p class="muted">先在上面「上什麼課」選一門課，再幫這門課設定。</p>'; return; }
  var gs = qgCase.recipeKey ? qgRecipeGroups(qgCase.recipeKey) : [], sg = qgSizeGroup(gs);
  if (sg) h += '<datalist id="qg-capOpts">' + sg.opts.map(function(o){ return '<option value="' + qgEsc(o.name) + '">'; }).join('') + '</datalist>';
  h += '<div class="muted" style="margin-bottom:10px">設定的課程：<b>' + qgEsc(name) + '</b>（這門課所有規格共用）。超過上限只會在上面跳提醒，不會改價格。</div>';
  var rules = qgCapRules(name);
  rules.forEach(function(x){
    h += '<div data-id="' + x.id + '" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px">人數 ≥ ' +
      '<input type="number" data-k="minN" min="1" step="1" value="' + x.minN + '" style="width:72px" onwheel="this.blur()"> 人時，基底材最大 ' +
      '<input type="text" data-k="size" list="qg-capOpts" value="' + qgEsc(x.size) + '" placeholder="例：8號、6F、20*20" style="width:170px"> ' +
      '<span class="muted" data-hint style="font-size:12.5px">' + qgCapHint(x.size) + '</span>' +
      '<button type="button" class="btn-del btn-sm" data-capdel="' + x.id + '">✕</button></div>';
  });
  if (!rules.length) h += '<p class="muted">這門課還沒設定，沒有上限。</p>';
  h += '<button type="button" class="btn btn-outline" data-capadd="1">新增一條</button>';
  box.innerHTML = h;
}

/* ── 畫布／框尺寸連動 ─────────────────────────────────────────
   課程用料裡同一個「群組」的材料＝擇一（畫布 4F、3F、20*20 方…）。報價頁選了課之後，每個群組多一個下拉，
   選哪一款，固定材料就換成那一款的成本；畫布那組還會照面積換算「隨尺寸材料」的用量 % */
var QG_CANVAS = {
  F:{0:[18,14],1:[22.7,15.8],2:[24.2,19],3:[27.3,22],4:[33.3,24.2],5:[35,27.3],6:[40.9,31.8],8:[45.5,38],10:[53,45.5],12:[60.6,50],15:[65.2,53],20:[72.7,60.6],25:[80.3,65.2],30:[91,72.7],40:[100,80.3],50:[116.7,91]},
  P:{6:[40.9,27.3],8:[45.5,33.3],10:[53,41],12:[60.6,45.5],15:[65.2,50],20:[72.7,53],25:[80.3,60.6],30:[91,65.2]}
};
/* 從名字抓面積（平方公分）：「20*20方畫布」＝20×20；「4F畫布」「6P」「4號」查標準尺寸表。抓不到回 0 */
function qgSizeArea(name){
  var t = String(name || ''), m = t.match(/(\d+(?:\.\d+)?)\s*[*×xX]\s*(\d+(?:\.\d+)?)/);
  if (m) return Math.round(parseFloat(m[1]) * parseFloat(m[2]));
  m = t.match(/(\d+)\s*([FfPp])(?![A-Za-z])/);
  if (m) { var d = QG_CANVAS[m[2].toUpperCase()][parseInt(m[1], 10)]; return d ? Math.round(d[0] * d[1]) : 0; }
  m = t.match(/(\d+)\s*號/);
  if (m) { var d2 = QG_CANVAS.F[parseInt(m[1], 10)]; return d2 ? Math.round(d2[0] * d2[1]) : 0; }
  return 0;
}
/* 這份配方裡有幾個「擇一」群組（至少兩款才算），每款的成本含損耗 */
function qgRecipeGroups(key){
  var rec = S.recipes && S.recipes[key]; if (!rec || !rec.items) return [];
  var k = 1 + Math.max(0, +rec.waste || 0) / 100, by = {}, order = [];
  rec.items.forEach(function(x){
    var g = String(x.grp || '').trim(), m = typeof rcMat === 'function' ? rcMat(x.id) : null;
    if (!g || !m) return;
    if (!by[g]) { by[g] = { grp:g, opts:[] }; order.push(g); }
    if (by[g].opts.some(function(o){ return String(o.id) === String(x.id); })) return;
    by[g].opts.push({ id:x.id, name:m.name, cost:Math.round((+m.cost || 0) * (+x.qty || 0) * k), area:qgSizeArea(m.name) });
  });
  return order.map(function(g){ return by[g]; }).filter(function(g){ return g.opts.length >= 2; });
}
/* 面積最接近的那一款，差超過 tol（比例）就當沒有。規格寫 35x24cm、框叫 33*24、畫布是 4F（33.3×24.2），差不多大就算同一款 */
function qgNearestOpt(g, area, tol){
  if (!area) return null;
  var best = null, bd = 1e9;
  g.opts.forEach(function(o){
    if (!o.area) return;
    var d = Math.abs(o.area - area) / area;
    if (d < bd) { bd = d; best = o; }
  });
  return best && bd <= tol ? best : null;
}
/* 預設選哪一款：尺寸跟課程規格最接近的那款；對不上就第一款 */
function qgDefaultPick(gs, spec){
  var sa = qgSizeArea(spec), pick = {};
  gs.forEach(function(g){
    pick[g.grp] = (qgNearestOpt(g, sa, 0.1) || g.opts[0]).id;
  });
  return pick;
}
/* 用面積換算用量％的那一組：優先名字有「畫布」，其次第一個每款都算得出面積的 */
function qgSizeGroup(gs){
  var ok = gs.filter(function(g){ return g.opts.every(function(o){ return o.area > 0; }); });
  return ok.find(function(g){ return /畫布|基底/.test(g.grp); }) || ok[0] || null;
}
function qgPickOpt(g, id){ return g.opts.find(function(o){ return String(o.id) === String(id); }) || g.opts[0]; }

/* 配方裡的群組名稱（畫布、框、鏡子…）在報價頁一律叫「基底材」；同一門課有兩組以上才附上原名分辨 */
function qgGrpLabel(g, gs){
  var isBase = function(x){ return /畫布|框|鏡|基底/.test(x.grp); };
  if (!isBase(g)) return qgEsc(g.grp);
  var many = gs.filter(isBase).length > 1;
  return '基底材' + (many && g.grp !== '基底材' ? '｜' + qgEsc(g.grp) : '');
}
function qgRenderPicks(){
  var box = document.getElementById('qg-picks'); if (!box) return;
  var gs = qgCase.recipeKey ? qgRecipeGroups(qgCase.recipeKey) : [];
  if (!gs.length) { box.innerHTML = ''; return; }
  var h = '<div class="qg-grid">';
  gs.forEach(function(g, gi){
    var cur = qgPickOpt(g, qgCase.pick[g.grp]);
    h += '<div class="fg"><label>' + qgGrpLabel(g, gs) + '（選尺寸）</label><select data-gi="' + gi + '">';
    g.opts.forEach(function(o){
      h += '<option value="' + qgEsc(String(o.id)) + '"' + (String(o.id) === String(cur.id) ? ' selected' : '') + '>' + qgEsc(o.name) + '　' + qFmt(o.cost) + '</option>';
    });
    h += '</select></div>';
  });
  h += '</div><div class="qg-hint" id="qg-picksHint" style="margin-bottom:8px"></div>';
  box.innerHTML = h;
  qgPicksHint(gs);
}
function qgPicksHint(gs){
  var e = document.getElementById('qg-picksHint'); if (!e) return;
  var sg = qgSizeGroup(gs), t = '換尺寸時，基底材與包裝會換成選的那一款的成本';
  if (sg && qgCase.baseArea) t += '；耗材（膠、水晶、顏料）以「' + qgEsc(qgCase.baseName) + '」為基準，照面積比例換算成下面的用量 %（估算，可以再改）';
  else if (sg === null) t += '；這組的名字看不出尺寸，用量 % 請自己填';
  e.innerHTML = t + '。';
}
/* 選了尺寸：固定材料、隨尺寸材料、用量 % 一起更新，再重算價格 */
function qgPickChange(gi, id){
  var gs = qgRecipeGroups(qgCase.recipeKey), g = gs[gi]; if (!g) return;
  qgCase.pick[g.grp] = id;
  var sg = qgSizeGroup(gs);
  if (sg && sg.grp === g.grp) {   // 畫布換了：其他組（框）有同尺寸的一款就跟著換，沒有就維持原選
    var a = qgPickOpt(g, id).area;
    gs.forEach(function(o){
      if (o.grp === g.grp) return;
      var m = qgNearestOpt(o, a, 0.05);
      if (m) qgCase.pick[o.grp] = m.id;
    });
    if (qgCase.baseArea) qgCase.sizePct = Math.round(a / qgCase.baseArea * 100);
  }
  var pp = rcParts(qgCase.recipeKey, qgCase.pick);
  qgCase.matFixed = Math.round(pp.fixedW);
  qgCase.matVar = pp.scalW > 0 ? Math.round(pp.scalW) : '';
  ['qg-matFixed','qg-matVar','qg-sizePct'].forEach(function(i){ var e = document.getElementById(i); if (e) e.value = qgCase[i.slice(3)]; });
  qgRenderPicks();
  qgRecalc();
}

/* 從「課程用料」配方找這門課＋規格的底座成本（畫布、框、托盤…，庫存盤點裡的單位成本×數量）。
   配方的 key 是「課程名|規格」；課程管理的規格尾巴可能帶「（單次原價）」，所以去掉再比，比不到再用開頭比對 */
function qgRecipeBase(r){
  try {
    if (typeof rcCost !== 'function' || !S.recipes || !r) return null;
    var spec = String(r.spec || '').replace(/（?單次原價）?/, '').trim();
    var keys = [r.name + '|' + String(r.spec || '').trim(), r.name + '|' + spec];
    var key = keys.find(function(k){ return S.recipes[k] && S.recipes[k].items && S.recipes[k].items.length; });
    if (!key) {
      var pre = r.name + '|' + spec;
      key = Object.keys(S.recipes).find(function(k){ return k.indexOf(pre) === 0 && S.recipes[k].items && S.recipes[k].items.length; });
    }
    if (!key) return null;
    var gs = qgRecipeGroups(key), pick = gs.length ? qgDefaultPick(gs, r.spec) : null;   // 畫布、框有分群組：先照課程規格挑一款當預設，不要把每一款都加進去
    var pp = typeof rcParts === 'function' ? rcParts(key, pick) : null;
    return pp ? { key:key, pick:pick || {}, fixed:Math.round(pp.fixedW), scal:Math.round(pp.scalW), cost:Math.round((pp.fixed + pp.scal) * (1 + pp.waste / 100)) } : { key:key, pick:{}, fixed:Math.round(rcCost(key)), scal:0, cost:Math.round(rcCost(key)) };
  } catch (e) { return null; }
}

/* 帶入課程：新客價寫進欄位；setHrs＝第一次選這門課時，順便把時長帶成課程時長 */
function qgApplyCourse(setHrs){
  qgRenderCaps();
  var r = qgCourseById(qgCase.course), ai = document.getElementById('qg-anchor');
  if (!r) { qSetText('qg-courseHint', ''); return; }
  if (setHrs) {
    var h = parseFloat(String(r.dur || '').replace(/[^\d.]/g, ''));
    if (/分/.test(r.dur || '') && h) h = h / 60;
    if (h > 0 && h <= 8 && !(parseFloat(r.hourly) > 0)) { qgCase.hrs = Math.round(h * 2) / 2; var hi = document.getElementById('qg-hrs'); if (hi) hi.value = qgCase.hrs; }
  }
  var a = qgAnchorOf(r, Math.max(0.5, qN(qgCase.hrs)));
  qgCase.anchor = a.v || '';
  if (ai) ai.value = qgCase.anchor;
  var base = setHrs ? qgRecipeBase(r) : null;   // 第一次選課才帶底座成本，之後你手改的不會被蓋掉
  if (setHrs) {   // 沒有配方就清空，不要留著上一門課的數字；有配方就把「固定」和「隨尺寸」兩塊分別帶入，尺寸用量歸 100
    qgCase.matFixed = base ? base.fixed : '';
    qgCase.matVar = base && base.scal ? base.scal : '';
    qgCase.sizePct = 100;
    qgCase.recipeKey = base ? base.key : ''; qgCase.pick = base ? base.pick : {}; qgCase.baseArea = 0; qgCase.baseName = '';
    var gs0 = base ? qgRecipeGroups(base.key) : [], sg0 = qgSizeGroup(gs0);
    if (sg0) { var bo = qgPickOpt(sg0, qgCase.pick[sg0.grp]); qgCase.baseArea = bo.area; qgCase.baseName = bo.name; }
    ['qg-matFixed','qg-matVar','qg-sizePct'].forEach(function(id){ var e = document.getElementById(id); if (e) e.value = qgCase[id.slice(3)]; });
  }
  qgRenderPicks();
  qSetText('qg-courseHint', (a.v ? '帶入的是「' + a.src + '」' + qFmt(a.v) + ' 元' : '這門課在課程管理沒有價格，請自己填體驗價') +
    (base ? '　｜材料從課程用料「' + base.key + '」帶入：基底材與包裝 ' + qFmt(base.fixed) + '、耗材 ' + qFmt(base.scal) + (base.scal ? '' : '（這份配方還沒有膠、水晶、金箔、顏料，請到課程用料補，或直接填下面「耗材」）') : (setHrs ? '　｜這門課在「課程用料」還沒有配方，基底材與包裝請自己填' : '')));
  if (setHrs) qgRecalc();
}
async function qgFillCourses(){
  var sel = document.getElementById('qg-course'); if (!sel) return;
  if (!qgCourseRows() && typeof catLoad === 'function') {
    sel.disabled = true; sel.options[0].text = '課程讀取中…';
    try { await catLoad(); } catch (e) { sel.options[0].text = '讀不到課程管理，請自己填體驗價'; return; }
    sel = document.getElementById('qg-course'); if (!sel) return;   // 讀的時候可能換過分頁
    sel.disabled = false; sel.options[0].text = '— 不選，自己填體驗價 —';
  }
  var rows = qgCourseRows() || [], h = '<option value="">— 不選，自己填體驗價 —</option>', cat = null;
  rows.forEach(function(r){
    if (r.cat !== cat) { if (cat !== null) h += '</optgroup>'; cat = r.cat; h += '<optgroup label="' + qgEsc(cat || '未分類') + '">'; }
    var a = qgAnchorOf(r, Math.max(0.5, qN(qgCase.hrs)));
    var spec = String(r.spec || '').replace(/（?單次原價）?/, '').trim();
    h += '<option value="' + qgEsc(r.id) + '"' + (r.id === qgCase.course ? ' selected' : '') + '>' +
         qgEsc(r.name + (spec ? '（' + spec + '）' : '')) + (a.v ? '　' + qFmt(a.v) : '') + (r.on === false ? '　〔下架〕' : '') + '</option>';
  });
  if (cat !== null) h += '</optgroup>';
  sel.innerHTML = h;
  if (qgCase.course) qgApplyCourse(false);
}

function qgSyncLec(){
  var on = document.getElementById('qg-lecOn'), ch = document.getElementById('qg-lecCharge'), w = document.getElementById('qg-lecChargeWrap');
  if (on) on.checked = !!qgCase.lecOn;
  if (ch) ch.checked = !!qgCase.lecCharge;
  if (w) w.style.display = qgCase.lecOn ? '' : 'none';
}

function qgSyncPmode(){
  var w = document.getElementById('qg-pmode'); if (!w) return;
  w.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', (x.dataset.v === 'auto') === !!qgCase.auto); });
}

function qgRecalc(){
  var c = qgCase, p = qgParams();
  var r = qgCompute(c, p);
  var blank = function(v){ return v === '' || v === null || v === undefined; };
  var matMissing = blank(c.matFixed) && blank(c.matVar);
  var dash = function(v){ return matMissing ? '—' : qFmt(v); };
  var pct = function(v){ return (Math.round(v * 1000) / 10).toFixed(1) + '%'; };

  // 自動模式：每人價由系統填，欄位變唯讀樣式；點進去就切成自己訂價
  var pi = document.getElementById('qg-price');
  if (pi && c.auto) pi.value = matMissing ? '' : Math.round(r.perTax);
  if (pi) { pi.readOnly = !!c.auto; pi.style.opacity = c.auto ? '0.75' : ''; }
  qSetText('qg-priceHint', c.auto ? '系統算的，點一下就能自己改' : '自己填的，想回到建議價按「自動」');
  qSetText('qg-heroLbl', (c.auto ? '系統建議：跟家長報每人（含稅）' : '跟家長報每人（含稅）｜自己訂的價') + (r.lecRev ? '｜課程費，講師費另計' : ''));

  var lec = document.getElementById('qg-lecLine');
  if (lec) lec.innerHTML = r.lecRev
    ? '另收講師費 <b>NT$ ' + qFmt(r.lecRevTax) + '</b>（含稅，代收後全數給老師，不算進每人價）'
    : (r.lecFees > 0 ? '<span style="color:var(--gold2)">講師費 NT$ ' + qFmt(r.lecFees) + ' 沒另外收，已經算進每人價裡</span>' : '');

  var why = document.getElementById('qg-why');
  if (why) {
    var L = [];
    if (matMissing) L.push('先填材料成本，才算得出建議價。');
    else {
      var costParts = ['材料 ' + qFmt(r.mat) + '（每人 ' + qFmt(r.matPer) + '）', '人次獎金 ' + qFmt(r.headFees)];
      if (r.lecFees) costParts.push('講師費 ' + qFmt(r.lecFees));
      if (r.trans + r.haul) costParts.push('交通搬運 ' + qFmt(r.trans + r.haul));
      if (r.misc) costParts.push('雜支 ' + qFmt(r.misc));
      if (r.lost) costParts.push('擠掉的營收 ' + qFmt(r.lost));
      L.push('這場多花的成本 <b>' + qFmt(r.cost) + '</b>（' + costParts.join('＋') + '）。');
      var tN = c.staff.filter(function(x){ return x.role === 'teacher'; }).length, aN = c.staff.filter(function(x){ return x.role === 'admin'; }).length, sN = c.staff.filter(function(x){ return x.role === 'sales'; }).length;
      L.push('帶課人員：老師 <b>' + tN + '</b> 位' + (aN ? '、行政 ' + aN + ' 位' : '') + (sN ? '、業務 ' + sN + ' 位' : '') + '｜' +
        (r.hasHead ? '人次獎金 ' + qFmt(r.headFees) + '（' + r.n + ' 人 × ' + qN(p.gHead) + '，不管幾位老師分，總額一樣）' : '這場沒有人次獎金') +
        (r.lecFees ? '｜講師費 ' + qFmt(r.lecFees) + '（按堂，每多一位老師就多一份）' : '') + '。');
      if (!r.isOut) L.push('教室占用成本：占用教室 <b>' + r.occHrs + '</b> 小時（上課 ' + r.hrs + '＋準備收拾 ' + r.buffer + '）× 每小時 ' + qFmt(qN(p.gHourCost)) + ' ＝ <b>' + qFmt(r.occ) + '</b>，平均每人 ' + qFmt(r.occ / r.n) + '（人越少每人分攤越多）。');
      var T = function(x){ return qFmt(x.perTax); };
      L.push('每人（含稅）：最低可接價（現金底線） <b>' + T(r.cash) + '</b>｜回收教室成本價 ' + T(r.be) + '｜建議價（淨利 ' + Math.round(r.gm * 100) + '%） <b>' + T(r.tgt) + '</b>' +
        (r.anchor > 0 ? '｜體驗價 ' + qFmt(r.anchorRaw) + (r.matDiffPer ? '（材料換成這場的 ' + qFmt(r.matPer) + ' 後，同等級約 <b>' + qFmt(r.anchor) + '</b>）' : '') + '，團班建議價是它的 ' + Math.round(r.recPerTax / r.anchor * 100) + '%' : ''));
      if (r.matDiffPer) L.push('這次耗材用量 ' + Math.round(r.sizePct) + '%：每人材料 ' + qFmt(r.matPer) + '（基準尺寸 ' + qFmt(r.stdMat) + '，' + (r.matDiffPer >= 0 ? '多' : '少') + ' ' + qFmt(Math.abs(r.matDiffPer)) + '），這一段照成本轉嫁、不乘利潤率。');
      if (!c.auto) L.push('你自己訂的是每人 <b>' + qFmt(r.perTax) + '</b>，系統建議 ' + qFmt(r.recPerTax) + '。');
    }
    why.innerHTML = L.map(function(x){ return '<div>' + x + '</div>'; }).join('');
  }
  qSetText('qg-per', matMissing ? '先填材料成本' : qFmt(r.perTax));
  var gh = document.getElementById('qg-gmHint');
  if (gh) gh.textContent = (r.isOut ? '外派' : '內場') + '目標利潤率固定 ' + Math.round(r.gm * 100) + '%（扣掉材料、獎金、總部、教室占用成本後留下的比例），不能在這裡改';

  // 尺寸用量的效果：跟 100% 比，每人材料和報價差多少
  var sn = document.getElementById('qg-sizeNote');
  if (sn) {
    var b100 = qgCompute(Object.assign({}, c, { sizePct:100 }), p);
    var dMat = r.matPer - b100.matPer, dPrice = r.recPerTax - b100.recPerTax, dExact = r.tgt.perTax - b100.tgt.perTax;
    var sg = function(v){ return (v > 0 ? '+' : (v < 0 ? '－' : '±')) + qFmt(Math.abs(v)); };
    var tx;
    var varZero = blank(c.matVar) || qN(c.matVar) === 0;
    sn.style.background = varZero && r.sizePct !== 100 ? 'rgba(201,168,76,.18)' : '';
    if (varZero) tx = '<b>耗材用量現在動不了價格：</b>「耗材」是空的（或 0）。用量 % 只會縮那一格——膠、水晶、金箔、顏料這類會隨尺寸變多變少的材料，請把基準尺寸那一款的合計填進去。基底材、包裝選哪個尺寸就是哪個價，不受這個 % 影響；要換小一號的基底材，請用上面的「基底材（選尺寸）」下拉，或改選小尺寸的那門課。';
    else if (r.sizePct === 100) tx = '目前是基準尺寸。要做小一點：按 90／80／70，或直接填 %（只會縮「耗材」這 ' + qFmt(r.matVar) + '）。' + (qgCase.recipeKey && qgRecipeGroups(qgCase.recipeKey).length ? '基底材換尺寸，請用上面課程下方的尺寸下拉。' : '基底材換小一號，請到上面「上什麼課」改選小尺寸那門課。');
    else tx = '<b>尺寸 ' + Math.round(r.sizePct) + '%</b>：每人材料 ' + qFmt(b100.matPer) + ' → <b>' + qFmt(r.matPer) + '</b>（' + sg(dMat) + '）｜建議每人報價 ' + qFmt(b100.recPerTax) + ' → <b>' + qFmt(r.recPerTax) + '</b>（' + sg(dPrice) + '，精算差 ' + sg(Math.round(dExact)) + '，報價取整到 50）。' +
      (c.auto ? '' : '<span style="color:var(--gold2)">　你現在是「自己訂價」，不會跟著變；切回「自動」才會連動。</span>');
    sn.innerHTML = tx;
  }

  // 換行時保留輸入中的焦點：只更新費用文字，不重畫人員列
  document.querySelectorAll('#qg-staff .qg-row').forEach(function(el){
    var row = c.staff[+el.dataset.i]; var f = el.querySelector('.qg-fee');
    if (row && f) f.textContent = qFmt(qgRowFee(row, p));
  });

  ['qg-trans-wrap','qg-haul-wrap'].forEach(function(id){
    var w = document.getElementById(id); if (w) w.style.display = r.isOut ? '' : 'none';
  });
  var bw = document.getElementById('qg-buffer-wrap'); if (bw) bw.style.display = r.isOut ? 'none' : '';

  qSetText('qg-margin', matMissing ? '—' : pct(r.margin));
  qSetText('qg-profit', dash(r.net));
  qSetText('qg-contrib', dash(r.profit));
  qSetText('qg-perHr', dash(r.R * (1 + r.tax) / r.hrs));
  qSetText('qg-revTax', qFmt(r.revTax));
  qSetText('qg-guar', r.guarantee + ' 人');

  var tierRow = function(label, x, always){
    var show = function(v){ return always || !matMissing ? v : '—'; };
    return '<tr'+(always?' style="font-weight:600"':'')+'><td>'+label+'</td>' +
      '<td>'+show(qFmt(x.R * (1 + r.tax)))+'</td><td>'+show(qFmt(x.perTax))+'</td><td>'+show(qFmt(x.perHr * (1 + r.tax)))+'</td>' +
      '<td>'+show(pct(x.margin))+'</td><td>'+show(qFmt(x.net))+'</td><td>'+show(qFmt(x.profit))+'</td></tr>';
  };
  var anchorX = null;
  if (r.anchor > 0) {
    var rvA = r.anchorNet * r.n + r.lecRev, prA = rvA * (1 - r.hq) - r.cost;
    anchorX = { R:r.anchorNet * r.n, perTax:r.anchor, perHr:r.anchorNet * r.n / r.hrs, profit:prA, net:prA - r.occ, margin: rvA > 0 ? (prA - r.occ) / rvA : 0 };
  }
  var tiers = document.getElementById('qg-tiers');
  if (tiers) tiers.innerHTML =
    tierRow('最低可接價　現金底線，再低就倒貼現金', r.cash) +
    (r.isOut ? '' : tierRow('回收教室成本價　連教室占用成本也賺回來', r.be)) +
    tierRow('建議價　淨利 ' + Math.round(r.gm * 100) + '%（一般客戶）', r.tgt) +
    tierRow('開價　淨利 ' + Math.round(r.gmHi * 100) + '%（留讓價空間）', r.hi) +
    (anchorX ? tierRow('體驗價（一個人來要付，對照用）', anchorX) : '') +
    tierRow(c.auto ? '系統建議（取整）' : '目前報價', r.cur, true);

  // 人數對照表：同樣條件換人數重算。內場 8／12（小教室滿）／15／20／25（大教室滿）；外派從最低計費人數起每 5 人一檔
  var byN = document.getElementById('qg-byN');
  if (byN) {
    var h1 = document.getElementById('qg-byN-h1'); if (h1) h1.textContent = '最低可接價（現金底線，再低倒貼）';
    if (matMissing) byN.innerHTML = '<tr><td colspan="8" class="muted">先填材料成本，才算得出各人數的價格。</td></tr>';
    else {
      var ns = qgNs(r.isOut, p);
      var up = function(v, step){ return Math.ceil(v / step - 1e-9) * step; };
      var capName = qgCourseName(), curSz2 = qgCurSize();
      var rowsN = ns.map(function(nn){
        var x = qgCompute(Object.assign({}, c, { n:nn, auto:true }), p);
        var lo = up(x.cash.perTax, 10), be = up(x.be.perTax, 10), formula = x.recPerTax;
        /* 最低可接價＝現金底線（房租和固定薪水不管有沒有這團都要付，不算）。體驗價是天花板：團班不會比一個人自己來還貴 */
        var ceil = x.anchor > 0 ? x.anchor : 0, noGo = ceil > 0 && lo > ceil, capped = ceil > 0 && formula > ceil && !noGo;
        var mid = capped ? ceil : formula;
        var y = qgCompute(Object.assign({}, c, { n:nn, auto:false, price: mid / (1 + x.tax) }), p);
        var room = r.isOut ? '' : (nn <= 12 ? '（小教室）' : '（大教室）');
        var cur = Math.round(nn) === Math.round(r.n), capRow = qgCapFor(capName, nn);
        var loNote = r.isOut ? '' : '<div class="muted" style="font-size:12px">連教室成本也回收：' + qFmt(be) + '</div>';
        var note = noGo ? '<div style="font-size:12px;color:var(--red)">連最低可接價都比一個人自己來還貴，不適合團班</div>'
          : (capped ? '<div class="muted" style="font-size:12px">公式算 ' + qFmt(formula) + '，團班不會比體驗價貴，先封頂。想給優惠，請在最低可接價和體驗價之間自己訂</div>' : '');
        return '<tr' + (cur ? ' style="font-weight:600"' : '') + '><td>' + nn + ' 人' + room + (cur ? '　← 現在填的' : '') + '</td>' +
          '<td>' + qFmt(lo) + loNote + '</td>' +
          (noGo ? '<td>—' + note + '</td><td>—</td><td>—</td><td>—</td><td>—</td>'
                : '<td>' + qFmt(mid) + note + '</td><td>' + qFmt(mid * nn) + '</td>' +
                  '<td>' + (ceil > 0 ? Math.round(mid / ceil * 100) + '%' : '—') + '</td><td>' + qFmt(y.profit) + '</td><td>' + pct(y.margin) + '</td>') +
          '<td>' + (capRow ? qgEsc(capRow.size) + (curSz2.area > capRow.area * 1.02 ? '　<span style="color:var(--gold2)">現在選的超過</span>' : '') : '—') + '</td></tr>';
      });
      byN.innerHTML = rowsN.join('');
    }
  }
  qgRenderBudget(r, matMissing);

  var bd = document.getElementById('qg-breakdown');
  if (bd) {
    bd.innerHTML = matMissing ? '<p class="muted">填了材料成本才會出現拆解。</p>' :
      qRow('開給客人的發票金額（含稅）', r.revTax) +
      qRow('扣營業稅 ' + qN(p.gTax) + '%（代收，不是你的錢）', -(r.revTax - r.rev)) +
      qRow('材料　' + r.n + ' 人 × ' + qFmt(r.matPer) + '（基底材與包裝 ' + qFmt(r.matFixed) + '＋耗材 ' + qFmt(r.matVar) + '×' + Math.round(r.sizePct) + '%）', r.mat) +
      qRow('人次獎金（老師、行政每教一位 ' + qN(p.gHead) + '）', r.headFees) +
      qRow('講師費' + (r.lecFees ? (r.lecRev ? '（另收，代收代付）' : '（沒另外收）') : '（這場沒有）'), r.lecFees) +
      (r.isOut ? qRow('交通＋搬運', r.trans + r.haul) : '') +
      qRow('其他雜支', r.misc) +
      qRow('當天被擠掉的四樓營收', r.lost) +
      qRow('總部管理費　營業額 ' + qN(p.gHq) + '%', r.hqFee) +
      '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:600"><span>扣掉材料、獎金、總部後剩下（還沒扣教室成本）</span><span>' + qFmt(r.profit) + '</span></div>' +
      (r.isOut ? '' : qRow('教室占用成本　占用 ' + r.occHrs + ' 小時 × ' + qFmt(qN(p.gHourCost)), r.occ) +
        '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:600"><span>實際賺到（已扣教室占用成本）</span><span>' + qFmt(r.net) + '</span></div>') +
      '<p class="muted" style="margin-top:10px">總部 ' + qN(p.gHq) + '% 是照扣掉營業稅後的營業額算。</p>';
  }

  var warns = [];
  if (matMissing) warns.push(['var(--gold2)', '材料成本還沒填，每門課不一樣，填了才算得出底線和利潤率。']);
  else {
    if (r.profit < -1) warns.push(['var(--red)', '這個價格連這場多花的現金都收不回來，倒貼 ' + qFmt(-r.profit) + ' 元（至少要報每人 ' + qFmt(r.cash.perTax) + '，含稅）。']);
    else if (r.net < -1) warns.push(['var(--gold2)', '現金有進帳 ' + qFmt(r.profit) + '（扣完材料、獎金、總部）。教室成本（' + qFmt(r.occ) + '）不管有沒有這團都會花，這團只是少分攤了 ' + qFmt(-r.net) + '；要連教室成本也回收，要報到每人 ' + qFmt(r.be.perTax) + '（含稅）。']);
    else warns.push(['var(--green)', '可以接，扣掉教室占用成本後利潤率 ' + pct(r.margin) + '、實際賺 ' + qFmt(r.net) + '。真的要讓價，最低可守到每人 ' + qFmt(r.cash.perTax) + '（含稅，現金底線，再低就倒貼）。']);
    if (r.lecFees > 0 && !r.lecRev) warns.push(['var(--gold2)', '講師費 ' + qFmt(r.lecFees) + ' 沒另外跟客人收：已經算進每人價。報得比建議低，這筆就是你自己扛。']);
    if (r.anchor > 0 && r.perTax > r.anchor + 1) warns.push(['var(--gold2)', '比同等材料的體驗價（' + qFmt(r.anchor) + '）還貴，家長一比會覺得團班沒優惠。' + (r.n < 15 && !r.isOut ? '這團人數少，場次成本分攤不掉，建議設最低人數，或跟客人收低消、併到別的班。' : '')]);
  }
  if (!r.isOut && r.n > 25) warns.push(['var(--gold2)', '超過外場團班容量（25 人），需加開小教室並多配一位老師。']);
  if (r.hasHead && r.headSum !== Math.round(r.n)) warns.push(['var(--gold2)', '下面「帶幾位學生」加起來是 ' + r.headSum + '，跟報名人數 ' + r.n + ' 不符（價格已照報名人數算，按「把人數平均分給按人頭的人」可以對齊）。']);
  var teachers = c.staff.filter(function(x){ return x.role === 'teacher'; });
  if (!teachers.length) warns.push(['var(--red)', '還沒有帶課老師。「帶課老師」填幾位，講師費／人次獎金才算得準。']);
  else if (r.lecFees > 0 && teachers.some(function(x){ return !String(x.name || '').trim(); })) warns.push(['var(--gold2)', '有老師還沒填姓名：講師費先按標準費率算。老師有個人倍率的，填了姓名才會套用，價格會有些差。']);
  if (r.isOut && r.n < qN(p.gOutMin)) warns.push(['var(--gold2)', '外派未滿 ' + qN(p.gOutMin) + ' 人，將按 ' + r.guarantee + ' 人收費。']);
  var capN = qgCapFor(qgCourseName(), r.n), curSz = qgCurSize();
  if (capN && curSz.area) {
    if (curSz.area > capN.area * 1.02) warns.push(['var(--gold2)', r.n + ' 人時你設定基底材最大「' + capN.size + '」，現在選的是「' + curSz.name + '」，場地會擠。建議改小一號（上面「基底材」下拉，或改選小尺寸那門課）。']);
    else warns.push(['var(--text3)', r.n + ' 人時基底材上限「' + capN.size + '」，現在選的尺寸沒超過。']);
  }
  if (c.staff.length) warns.push(['var(--text3)', '帶課配比：每位帶課者平均帶 ' + r.perStaff.toFixed(1) + ' 人。']);

  var w = document.getElementById('qg-warn');
  if (w) w.innerHTML = warns.map(function(x){ return '<div style="color:'+x[0]+'">'+x[1]+'</div>'; }).join('');
  var hero = document.getElementById('qg-hero');
  if (hero) hero.style.borderLeftColor = warns.length ? warns[0][0] : 'var(--gold)';
}

function qgCopyText(){
  var c = qgCase, p = qgParams(), r = qgCompute(c, p);
  var txt = 'Otto2 ARTCLUB藝術工作室　團班課程報價\n' +
    '人數：' + r.n + ' 人\n' +
    '時長：' + r.hrs + ' 小時\n' +
    '地點：' + (r.isOut ? '貴單位場地（老師到府授課）' : '本工作室四樓') + '\n' +
    '每人：NT$ ' + qFmt(r.perTax) + '（含稅）' + (r.lecRev ? '，課程費' : '') + '\n' +
    (r.lecRev ? '講師費：NT$ ' + qFmt(r.lecRevTax) + '（含稅）\n' : '') +
    '總價：NT$ ' + qFmt(r.revTax) + '（含 ' + qN(p.gTax) + '% 營業稅）\n' +
    '含材料、教具與全程教學指導。\n' +
    (r.isOut ? '最低以 ' + qN(p.gOutMin) + ' 人計費。' : '實到少於 ' + r.guarantee + ' 人仍以 ' + r.guarantee + ' 人計費。');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ alert('已複製，貼給對方即可') },
      function(){ alert('複製失敗，請手動選取') });
  } else {
    alert('複製失敗，請手動選取');
  }
}

/* ══════════════════════════════════════════════════════════
   一般課程定價（2026-10-14 v4，大熊確認的算法）
   價格是你自己定的（原價、優惠價、新客價、早鳥價），不會因為人數不同。要回答的是：
   「這個價賣出去，每個月要來幾個人次，才補得完每個月本來就要付的錢（打平）、才賺到我要的淨利（目標）」。
   ・每人貢獻＝價格 ÷（1＋稅）×（1－總部 10%）－ 材料 － 人次獎金 50
   ・每月要先賺到＝固定開銷＋固定薪水（底薪、固定津貼）＋廣告費；目標＝再加上月目標淨利
   ・需要人次＝每月金額 ÷ 每人貢獻（假設這個月所有客人都付這個價）
   ・反過來：照預期每月人次，每人平均要付多少才打平／才達標
   ・材料自己列、自己填價錢（庫存大多還沒有單位成本）；不含業務績效 2%
   ══════════════════════════════════════════════════════════ */
function qcNew(){ return { course:'', hrs:2.5, mats:[{name:'', cost:''}], pOrig:'', pMember:'', pFirst:'', pEarly:'', pCand:'' }; }
var qcCase = qcNew();
var QC_TIERS = [['pOrig','原價'], ['pMember','優惠價（會員價）'], ['pFirst','新客價（初次體驗）'], ['pEarly','早鳥價'], ['pCand','候選價（新課程自己訂）']];

function qcMatSum(){ return qcCase.mats.reduce(function(s, m){ return s + qN(m.cost); }, 0); }

function qcSkeleton(){
  var c = qcCase, p = qgParams();
  var h = '';

  h += '<div class="card" id="qc-hero" style="border-left:4px solid var(--gold)">';
  h +=   '<div style="font-size:13px;color:var(--text3)">照你預期的每月人次，每位客人平均要付（含稅）</div>';
  h +=   '<div class="stat-grid" style="margin-top:10px;margin-bottom:0">';
  h +=     '<div class="stat-card"><div class="lbl">打平</div><div class="val" style="font-size:26px" id="qc-beP">—</div></div>';
  h +=     '<div class="stat-card hi"><div class="lbl">達到月目標淨利</div><div class="val" style="font-size:26px" id="qc-tgP">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">每月要先賺到</div><div class="val" style="font-size:19px" id="qc-month">—</div></div>';
  h +=   '</div>';
  h +=   '<div id="qc-sum" style="margin-top:14px;font-size:14px;line-height:1.8;padding:12px 14px;border-radius:10px;background:var(--bg2,rgba(0,0,0,.03))"></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">這門課（改這裡）</div>';
  h +=   '<div class="form-grid" style="margin-bottom:6px">';
  h +=     '<div class="fg" style="grid-column:span 2"><label>從課程管理帶入價格（新課程就不選，下面填「候選價」）</label>' +
           '<select id="qc-course"><option value="">— 不選，自己填價格 —</option></select>' +
           '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.5" id="qc-courseHint"></div></div>';
  h +=     qgField('qc-hrs', '上課時長（小時）', c.hrs, 0.5, '按小時計價的課，價格會跟著時長變');
  h +=   '</div>';
  h +=   '<div class="fg"><label>這一堂的材料（每人用多少，自己填價錢）</label><div id="qc-mats"></div>';
  h +=     '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px"><button class="btn btn-outline" id="qc-addMat">新增一項材料</button>';
  h +=     '<span style="font-size:14px">每人材料合計 NT$ <b id="qc-matSum">0</b></span></div></div>';
  h +=   '<div class="form-grid" style="margin-top:14px">';
  QC_TIERS.forEach(function(t){ h += qgField('qc-' + t[0], t[1] + '（含稅）', c[t[0]], 50); });
  h +=   '</div>';
  h +=   '<p class="muted" style="margin-top:8px">有填的價格都會各算一列；沒有的留空。</p>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">每個價格，要來幾個人次才夠</div>';
  h +=   '<div style="overflow-x:auto"><table><thead><tr><th>價格</th><th>含稅</th><th>每人留下</th><th>打平：每月人次</th><th>每營業日</th><th>達標：每月人次</th><th>每營業日</th></tr></thead><tbody id="qc-tiers"></tbody></table></div>';
  h +=   '<p class="muted" style="margin-top:10px">「每人留下」＝價格拿掉稅、總部 ' + qN(p.gHq) + '%、材料、人次獎金後剩的錢。人次是「假設這個月所有客人都付這個價」；每月人次紅色＝超過你預期的月人次，光靠這個價撐不起來。不含業務績效 2%。</p>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">四樓每月本來就要付的錢（改這裡）</div>';
  h +=   '<div class="form-grid">';
  h +=     qgField('qc-gFixed', '每月固定開銷', p.gFixed, 1000, '房租 10 萬＋水電雜項＋共用人力四樓那一半');
  h +=     qgField('qc-gPayrollOv', '四樓每月固定薪水', p.gPayrollOv, 1000, '<span id="qc-payHint"></span>');
  h +=     qgField('qc-gAdSpend', '每月廣告費（四樓）', p.gAdSpend || '', 1000, 'Meta 後台一個月花多少');
  h +=     qgField('qc-gVisitsPlan', '預期每月人次（正常月份）', p.gVisitsPlan, 10, '<span id="qc-visHint"></span>');
  h +=     qgField('qc-gTarget', '月目標淨利', p.gTarget, 10000, '扣完所有成本之後，你想這個月留下多少');
  h +=   '</div>';
  h +=   '<p class="muted" style="margin-top:8px">固定薪水＝底薪＋固定津貼＋兼職時薪（隨客人變動的人次獎金、講師費、績效不算，人次獎金已在每人成本裡）。留空就自動抓最上面選的月份；填了就用你填的。改這裡會存檔、全店同步。</p>';
  h += '</div>';
  return h;
}

function qcRenderMats(){
  var box = document.getElementById('qc-mats'); if (!box) return;
  box.innerHTML = qcCase.mats.map(function(m, i){
    return '<div class="qc-mat" data-i="'+i+'" style="display:flex;gap:8px;margin-bottom:8px;align-items:center">' +
      '<input type="text" data-k="name" value="'+qgEsc(m.name)+'" placeholder="材料名稱（例如 水晶膠、畫布）" style="flex:2;min-width:0">' +
      '<input type="number" data-k="cost" value="'+m.cost+'" min="0" step="5" placeholder="每人多少錢" onwheel="this.blur()" style="flex:1;min-width:0">' +
      '<button type="button" class="btn btn-outline" data-del="'+i+'" style="padding:4px 12px">刪</button></div>';
  }).join('');
}

function qcBindEvents(){
  qcRenderMats();
  var box = document.getElementById('qc-mats');
  box.addEventListener('input', function(e){
    var t = e.target, k = t.dataset.k; if (!k) return;
    qcCase.mats[+t.closest('.qc-mat').dataset.i][k] = k === 'name' ? t.value : (t.value === '' ? '' : qN(t.value));
    qcRecalc();
  });
  box.addEventListener('click', function(e){
    var b = e.target.closest('[data-del]'); if (!b) return;
    qcCase.mats.splice(+b.dataset.del, 1);
    if (!qcCase.mats.length) qcCase.mats.push({ name:'', cost:'' });
    qcRenderMats(); qcRecalc();
  });
  document.getElementById('qc-addMat').addEventListener('click', function(){
    qcCase.mats.push({ name:'', cost:'' }); qcRenderMats(); qcRecalc();
  });
  QC_TIERS.forEach(function(t){
    document.getElementById('qc-' + t[0]).addEventListener('input', function(){
      qcCase[t[0]] = this.value === '' ? '' : qN(this.value);
      if (qcCase.course) { qcCase.course = ''; var sel = document.getElementById('qc-course'); if (sel) sel.value = ''; }
      qcRecalc();
    });
  });
  document.getElementById('qc-hrs').addEventListener('input', function(){
    qcCase.hrs = qN(this.value);
    var r = qgCourseById(qcCase.course);
    if (r && parseFloat(r.hourly) > 0) qcApplyCourse(false);   // 計時課：時長一改，價格跟著變
    qcRecalc();
  });
  document.getElementById('qc-course').addEventListener('change', function(){
    qcCase.course = this.value; qcApplyCourse(true); qcRecalc();
  });
  qcFillCourses();
  QG_OH_KEYS.forEach(function(k){
    document.getElementById('qc-' + k).addEventListener('input', function(){
      qgParams()[k] = this.value === '' ? '' : qN(this.value);
      save();
      qcRecalc();
    });
  });
}

/* 帶入課程：各種價格寫進欄位。計時課（每小時多少）就只有一個「原價」＝每小時 × 時長 */
function qcApplyCourse(setHrs){
  var r = qgCourseById(qcCase.course);
  if (!r) { qSetText('qc-courseHint', ''); return; }
  if (setHrs) {
    var h = parseFloat(String(r.dur || '').replace(/[^\d.]/g, ''));
    if (/分/.test(r.dur || '') && h) h = h / 60;
    if (h > 0 && h <= 8 && !(parseFloat(r.hourly) > 0)) { qcCase.hrs = Math.round(h * 2) / 2; var hi = document.getElementById('qc-hrs'); if (hi) hi.value = qcCase.hrs; }
  }
  var n = function(x){ var v = parseFloat(x); return isFinite(v) && v > 0 ? v : ''; };
  var today = typeof catToday === 'function' ? catToday() : '';
  var earlyOk = n(r.early) && /^\d{4}-\d{2}-\d{2}$/.test(r.earlyUntil || '') && today <= r.earlyUntil;
  if (n(r.hourly)) { qcCase.pOrig = Math.round(n(r.hourly) * Math.max(0.5, qN(qcCase.hrs))); qcCase.pMember = ''; qcCase.pFirst = ''; qcCase.pEarly = ''; }
  else { qcCase.pOrig = n(r.pOrig) || n(r.price); qcCase.pMember = n(r.pMember); qcCase.pFirst = n(r.pFirst); qcCase.pEarly = earlyOk ? n(r.early) : ''; }
  qcCase.pCand = '';
  QC_TIERS.forEach(function(t){ var el = document.getElementById('qc-' + t[0]); if (el) el.value = qcCase[t[0]]; });
  qSetText('qc-courseHint', n(r.hourly) ? '這門課按小時計價：每小時 ' + qFmt(n(r.hourly)) + ' × ' + qcCase.hrs + ' 小時' : '價格從課程管理帶入，可以再改');
}
async function qcFillCourses(){
  var sel = document.getElementById('qc-course'); if (!sel) return;
  if (!qgCourseRows() && typeof catLoad === 'function') {
    sel.disabled = true; sel.options[0].text = '課程讀取中…';
    try { await catLoad(); } catch (e) { sel.options[0].text = '讀不到課程管理，請自己填價格'; return; }
    sel = document.getElementById('qc-course'); if (!sel) return;
    sel.disabled = false; sel.options[0].text = '— 不選，自己填價格 —';
  }
  var rows = qgCourseRows() || [], h = '<option value="">— 不選，自己填價格 —</option>', cat = null;
  rows.forEach(function(r){
    if (r.cat !== cat) { if (cat !== null) h += '</optgroup>'; cat = r.cat; h += '<optgroup label="' + qgEsc(cat || '未分類') + '">'; }
    var spec = String(r.spec || '').replace(/（?單次原價）?/, '').trim();
    h += '<option value="' + qgEsc(r.id) + '"' + (r.id === qcCase.course ? ' selected' : '') + '>' +
         qgEsc(r.name + (spec ? '（' + spec + '）' : '')) + (r.on === false ? '　〔下架〕' : '') + '</option>';
  });
  if (cat !== null) h += '</optgroup>';
  sel.innerHTML = h;
}

function qcRecalc(){
  var c = qcCase, p = qgParams(), oh = qgOverhead(p);
  var tax = qN(p.gTax) / 100, hq = qN(p.gHq) / 100, head = qN(p.gHead);
  var mat = qcMatSum(), M = oh.monthly, T = oh.target, V = oh.visits;
  var days = Math.max(1, qN(qParams().pDays));
  var k = (1 - hq) / (1 + tax);          // 客人付的含稅價，扣掉稅和總部之後留下的比例
  var vp = mat + head;                   // 每多一位客人，多花的材料＋人次獎金
  var up50 = function(x){ return Math.ceil(x / 50 - 1e-9) * 50; };

  qSetText('qc-matSum', qFmt(mat));
  qSetText('qc-payHint', oh.ok ? '留空＝自動 ' + qFmt(oh.payA) + '（' + oh.mKey + ' 底薪＋固定津貼）' : '讀不到薪資資料，請手填');
  qSetText('qc-visHint', oh.ok ? '你說正常約 250–300。' + oh.mKey + ' 目前登記 ' + oh.visA + ' 人次（月中會偏少）' : '');
  qSetText('qc-month', qFmt(M));

  var beP = V > 0 ? (M / V + vp) / k : null, tgP = V > 0 ? ((M + T) / V + vp) / k : null;
  qSetText('qc-beP', beP === null ? '—' : qFmt(up50(beP)));
  qSetText('qc-tgP', tgP === null ? '—' : qFmt(up50(tgP)));
  var sum = document.getElementById('qc-sum');
  if (sum) sum.innerHTML =
    '每月要先賺到 <b>' + qFmt(M) + '</b>（固定開銷 ' + qFmt(oh.fixed) + '＋固定薪水 ' + qFmt(oh.payroll) + '＋廣告費 ' + qFmt(oh.ad) + '）；' +
    '想再留下淨利 <b>' + qFmt(T) + '</b>，合計 <b>' + qFmt(M + T) + '</b>。<br>' +
    (V > 0 ? '照你預期每月 <b>' + V + '</b> 人次，每人次要扛固定成本 ' + qFmt(M / V) + '，再加材料 ' + qFmt(mat) + '、人次獎金 ' + qFmt(head) + '，拿掉稅 ' + qN(p.gTax) + '% 和總部 ' + qN(p.gHq) + '% → 每位客人平均要付 <b>' + qFmt(up50(beP)) + '</b> 才打平、<b>' + qFmt(up50(tgP)) + '</b> 才達標。' : '填「預期每月人次」才算得出每人平均要付多少。') +
    (mat === 0 ? '<br><span style="color:var(--gold2)">材料還沒填，上面的數字沒有算材料，會偏低。</span>' : '');

  var rows = QC_TIERS.map(function(t){
    var P = qN(c[t[0]]); if (!(P > 0)) return '';
    var keep = P * k - vp;
    if (keep <= 0) return '<tr><td>' + t[1] + '</td><td>' + qFmt(P) + '</td><td>' + qFmt(keep) + '</td><td colspan="4" style="color:var(--red)">賣一位就虧，打不平（調高價格或降材料）</td></tr>';
    var nb = Math.ceil(M / keep - 1e-9), nt = Math.ceil((M + T) / keep - 1e-9);
    var cell = function(n){
      var over = V > 0 && n > V;
      return '<td' + (over ? ' style="color:var(--red)"' : '') + '><b>' + n + '</b>' + (V > 0 ? ' <span class="muted">(' + Math.round(n / V * 100) + '%)</span>' : '') + '</td>';
    };
    return '<tr><td>' + t[1] + '</td><td>' + qFmt(P) + '</td><td>' + qFmt(keep) + '</td>' +
      cell(nb) + '<td>' + (nb / days).toFixed(1) + '</td>' + cell(nt) + '<td>' + (nt / days).toFixed(1) + '</td></tr>';
  }).join('');
  var tb = document.getElementById('qc-tiers');
  if (tb) tb.innerHTML = rows || '<tr><td colspan="7" class="muted">先填至少一個價格，或從課程管理選一門課。</td></tr>';

  var hero = document.getElementById('qc-hero');
  if (hero) hero.style.borderLeftColor = 'var(--gold)';
}
