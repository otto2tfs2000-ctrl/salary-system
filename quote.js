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

/* 報價頁分成兩個子分頁：團班報價（預設）／一般課程定價（舊公式，原樣保留，下一階段再改） */
var qView = 'group';

function renderQuote(){
  var el = document.getElementById('quoteRoot');
  if (!el) return;
  var h = '<div class="store-tabs" id="q-view">' +
    '<button type="button" class="store-btn'+(qView==='group'?' active':'')+'" data-v="group">團班報價</button>' +
    '<button type="button" class="store-btn'+(qView==='course'?' active':'')+'" data-v="course">一般課程定價</button>' +
    '</div>' +
    '<div id="q-view-group" style="'+(qView==='group'?'':'display:none')+'">' + qgSkeleton() + '</div>' +
    '<div id="q-view-course" style="'+(qView==='course'?'':'display:none')+'">' + qSkeleton() + '</div>';
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
  qgRecalc();
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
   團班報價（v2，規格：SPEC_Otto2報價系統_團班.md）
   團班一到兩個月才一次，老師、業務、行政本來就在上班，
   所以不分攤月薪與房租，只算「這一場多花的錢」＋「這一場擠掉的錢」。
   預設「自動」：有選課程（或填了新客價）就用「新客價 × 團班折數」，含稅取整到 50；
   新客價＝早鳥價（期間內）＞初次體驗價＞會員價（優惠價）＞原價，跟課程管理同一份資料。
   沒有新客價（全新、還沒定價的課）才退回照目標利潤率從成本往上算。
   切到「自己訂價」才用手填的每人價，系統只負責守底線、算利潤率。
   參數（講師費等級、人頭獎金、稅、總部、保證人數）存 S.quoteParams 的 g* 欄位，跟全站一起同步。
   ══════════════════════════════════════════════════════════ */

var QG_PARAM_DEFAULTS = { gHead:50, gMaster:2000, gAssist:1500, gJunior:1000, gHq:10, gTax:5, gOutMin:20, gInTol:3 };
var QG_PARAM_LABELS = [
  ['gHead','人頭獎金／每位學生'], ['gMaster','主教每堂'], ['gAssist','助教每堂'], ['gJunior','小老師每堂'],
  ['gHq','總部管理費 %'], ['gTax','營業稅 %'], ['gOutMin','外派最低計費人數'], ['gInTol','內場容許差額（人）']
];
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

function qgDefaultMode(role, venue){
  if (role === 'sales') return 'none';
  return venue === 'out' ? 'session' : 'head';
}

function qgDefaultStaff(venue){
  var rows = venue === 'out'
    ? [ {role:'teacher', level:'master'}, {role:'teacher', level:'assist'}, {role:'sales', level:'junior'} ]
    : [ {role:'teacher', level:'master'}, {role:'teacher', level:'assist'}, {role:'teacher', level:'assist'},
        {role:'admin', level:'junior'}, {role:'sales', level:'junior'} ];
  return rows.map(function(r){
    return { name:'', role:r.role, level:r.level, mode:qgDefaultMode(r.role, venue), heads:0, extra:0 };
  });
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
  var c = { venue:venue||'in', n:(venue==='out'?20:25), hrs:(venue==='out'?2:2.5), mat:'', gm:30, price:1200, auto:true, course:'', anchor:'', disc:85,
            trans:0, haul:0, misc:0, lost:0, staff:qgDefaultStaff(venue||'in') };
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

/* 純計算：不碰畫面，方便驗算 */
function qgCompute(c, p){
  var n = Math.max(1, qN(c.n)), hrs = Math.max(0.5, qN(c.hrs));
  var hq = qN(p.gHq) / 100, tax = qN(p.gTax) / 100, gm = qN(c.gm) / 100;
  var isOut = c.venue === 'out';
  var mat = n * qN(c.mat);
  var fees = c.staff.reduce(function(s, r){ return s + qgRowFee(r, p); }, 0);
  var trans = isOut ? qN(c.trans) : 0, haul = isOut ? qN(c.haul) : 0;
  var misc = qN(c.misc), lost = qN(c.lost);
  var cost = mat + fees + trans + haul + misc + lost;
  var be = cost / (1 - hq);
  var tgtDen = 1 - hq - gm;
  var tgt = tgtDen > 0 ? cost / tgtDen : Infinity;
  /* 自動：目標價換成每人含稅價，往上取整到 50（報給家長好聽），再倒算回未稅 */
  var price = qN(c.price), anchor = qN(c.anchor), disc = qN(c.disc) / 100;
  var useAnchor = !!c.auto && anchor > 0 && disc > 0;
  if (useAnchor) price = Math.ceil(anchor * disc / 50) * 50 / (1 + tax);
  else if (c.auto) price = isFinite(tgt) ? Math.ceil(tgt * (1 + tax) / n / 50) * 50 / (1 + tax) : 0;
  var rev = price * n;
  var hqFee = rev * hq;
  var profit = rev - hqFee - cost;
  var guarantee = isOut ? Math.max(n, qN(p.gOutMin)) : Math.max(1, n - qN(p.gInTol));
  var headSum = c.staff.filter(function(r){ return r.mode === 'head'; })
                       .reduce(function(s, r){ return s + qN(r.heads); }, 0);
  return {
    n:n, hrs:hrs, tax:tax, gm:gm, isOut:isOut, auto:!!c.auto, useAnchor:useAnchor, anchor:anchor, disc:disc, price:price, perTax:price*(1+tax),
    mat:mat, fees:fees, trans:trans, haul:haul, misc:misc, lost:lost, cost:cost,
    rev:rev, revTax:rev*(1+tax), hqFee:hqFee, profit:profit, margin: rev > 0 ? profit/rev : 0,
    be:be, beTax:be*(1+tax), tgt:tgt, tgtTax:tgt*(1+tax),
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
  h +=   '<div style="font-size:14px;color:var(--text2)">利潤率 <span id="qg-margin">—</span>｜淨賺 NT$ <span id="qg-profit">—</span>｜未稅每人 <span id="qg-perNet">—</span></div>';
  h +=   '<div class="stat-grid" style="margin-top:14px;margin-bottom:0">';
  h +=     '<div class="stat-card"><div class="lbl">報價總額（未稅）</div><div class="val" style="font-size:19px" id="qg-rev">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">報價總額（含稅）</div><div class="val" style="font-size:19px" id="qg-revTax">—</div></div>';
  h +=     '<div class="stat-card"><div class="lbl">保證計費人數</div><div class="val" style="font-size:19px" id="qg-guar">—</div></div>';
  h +=   '</div>';
  h +=   '<div id="qg-warn" style="margin-top:14px;font-size:14px;line-height:1.7"></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">團班條件（改這裡）</div>';
  h +=   '<div class="fg" style="margin-bottom:14px"><label>上課地點</label><div class="store-tabs" id="qg-venue" style="margin-bottom:0">';
  h +=     '<button type="button" class="store-btn'+(c.venue==='in'?' active':'')+'" data-v="in">內場（四樓）</button>';
  h +=     '<button type="button" class="store-btn'+(c.venue==='out'?' active':'')+'" data-v="out">外派</button>';
  h +=   '</div></div>';
  h +=   '<div class="form-grid" style="margin-bottom:6px">';
  h +=     '<div class="fg" style="grid-column:span 2"><label>上什麼課（從課程管理帶入新客價，可不選）</label>' +
           '<select id="qg-course"><option value="">— 不選，自己填新客價 —</option></select>' +
           '<div class="muted" style="font-size:12px;margin-top:4px;line-height:1.5" id="qg-courseHint"></div></div>';
  h +=     qgField('qg-anchor', '這門課新客價（含稅／每人）', c.anchor, 50, '平常第一次來的客人付多少。全新的課還沒定價就留空');
  h +=     qgField('qg-disc', '團班打幾折 %', c.disc, 5, '85＝打 85 折');
  h +=   '</div>';
  h +=   '<div class="form-grid">';
  h +=     qgField('qg-n', '報名人數', c.n, 1);
  h +=     qgField('qg-hrs', '上課時長（小時）', c.hrs, 0.5, '一堂＝這個時數，按小時報價時用來換算');
  h +=     qgField('qg-mat', '材料成本／人（必填）', c.mat, 10);
  h +=     qgField('qg-gm', '目標利潤率 %', c.gm, 5, '有新客價時用來檢查；沒有新客價時，自動報價照這個算');
  h +=     qgField('qg-price', '報價每人（未稅）', c.price, 50, '<span id="qg-priceHint"></span>');
  h +=   '</div>';
  h +=   '<div class="fg" style="margin-top:4px"><label>報價方式</label><div class="store-tabs" id="qg-pmode" style="margin-bottom:0">';
  h +=     '<button type="button" class="store-btn'+(c.auto?' active':'')+'" data-v="auto">自動（新客價打折）</button>';
  h +=     '<button type="button" class="store-btn'+(!c.auto?' active':'')+'" data-v="manual">自己訂價</button>';
  h +=   '</div></div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">帶課人員（老師、行政、業務都會下場，每一位列一行）</div>';
  h +=   '<div id="qg-staff"></div>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">';
  h +=     '<button class="btn btn-outline" id="qg-addStaff">新增帶課人員</button>';
  h +=     '<button class="btn btn-outline" id="qg-spread">把人數平均分給按人頭的人</button>';
  h +=   '</div>';
  h +=   '<p class="muted" style="margin-top:10px">姓名對得上「老師設定」裡的人，按堂講師費會自動乘上他的講師費倍率。業務預設不發人頭獎金。</p>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">其他成本</div>';
  h +=   '<div class="form-grid">';
  h +=     qgField('qg-trans', '交通費', c.trans, 100);
  h +=     qgField('qg-haul', '搬運／車資', c.haul, 100);
  h +=     qgField('qg-misc', '其他雜支', c.misc, 100, '布置、清潔、包材等');
  h +=     qgField('qg-lost', '當天被擠掉的四樓營收', c.lost, 500, '這場占掉的時段，原本預估能收多少。平日或週六包場、週六外派時填；週日與晚上通常是 0');
  h +=   '</div>';
  h += '</div>';

  h += '<div class="card">';
  h +=   '<div class="card-title">三檔對照（客人要按小時報，看「每小時」那欄）</div>';
  h +=   '<div style="overflow-x:auto"><table><thead><tr><th></th><th>總價（未稅）</th><th>總價（含稅）</th><th>每人（未稅）</th><th>每小時（未稅）</th></tr></thead><tbody id="qg-tiers"></tbody></table></div>';
  h +=   '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px">';
  h +=     '<button class="btn btn-gold" id="qg-copy">複製報價文字</button>';
  h +=     '<button class="btn btn-outline" id="qg-reset">回到預設條件</button>';
  h +=   '</div>';
  h += '</div>';

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
  h +=   '<p class="muted">付給老師一律按堂算（主教／助教／小老師三級，跟薪資的外派講師費同一套數字）。改這裡會自動存檔、全店同步。</p>';
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
    h +=   '<div class="form-grid">';
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
  var map = { 'qg-disc':'disc', 'qg-n':'n', 'qg-hrs':'hrs', 'qg-price':'price', 'qg-gm':'gm', 'qg-trans':'trans', 'qg-haul':'haul', 'qg-misc':'misc', 'qg-lost':'lost' };
  Object.keys(map).forEach(function(id){
    document.getElementById(id).addEventListener('input', function(){
      qgCase[map[id]] = qN(this.value);
      if (id === 'qg-n') { qgSpreadHeads(qgCase); qgRenderStaff(); }
      qgRecalc();
    });
  });
  document.getElementById('qg-anchor').addEventListener('input', function(){
    qgCase.anchor = this.value === '' ? '' : qN(this.value);
    if (qgCase.course) { qgCase.course = ''; var sel = document.getElementById('qg-course'); if (sel) sel.value = ''; }  // 手改就不算那門課了
    qgRecalc();
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
    qgCase.auto = false; qgCase.price = qN(this.value);
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
  document.getElementById('qg-mat').addEventListener('input', function(){
    qgCase.mat = this.value === '' ? '' : qN(this.value); qgRecalc();
  });

  var venueWrap = document.getElementById('qg-venue');
  venueWrap.addEventListener('click', function(e){
    var b = e.target.closest('button'); if (!b) return;
    if (qgCase.venue === b.dataset.v) return;
    qgCase.venue = b.dataset.v;
    venueWrap.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', x===b); });
    qgCase.staff.forEach(function(r){ r.mode = qgDefaultMode(r.role, qgCase.venue); });
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgRecalc();
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
      if (k === 'role') row.mode = qgDefaultMode(row.role, qgCase.venue);
      if (k === 'role' || k === 'mode') qgSpreadHeads(qgCase);
    }
    qgRenderStaff();   // 姓名改完重畫一次，倍率標示才會跟上
    qgRecalc();
  });
  box.addEventListener('click', function(e){
    var b = e.target.closest('[data-del]'); if (!b) return;
    qgCase.staff.splice(+b.dataset.del, 1);
    qgSpreadHeads(qgCase);
    qgRenderStaff();
    qgRecalc();
  });

  document.getElementById('qg-addStaff').addEventListener('click', function(){
    qgCase.staff.push({ name:'', role:'teacher', level:'assist', mode:qgDefaultMode('teacher', qgCase.venue), heads:0, extra:0 });
    qgSpreadHeads(qgCase);
    qgRenderStaff();
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

/* 帶入課程：新客價寫進欄位；setHrs＝第一次選這門課時，順便把時長帶成課程時長 */
function qgApplyCourse(setHrs){
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
  qSetText('qg-courseHint', a.v ? '帶入的是「' + a.src + '」' + qFmt(a.v) + ' 元' : '這門課在課程管理沒有價格，請自己填新客價');
}
async function qgFillCourses(){
  var sel = document.getElementById('qg-course'); if (!sel) return;
  if (!qgCourseRows() && typeof catLoad === 'function') {
    sel.disabled = true; sel.options[0].text = '課程讀取中…';
    try { await catLoad(); } catch (e) { sel.options[0].text = '讀不到課程管理，請自己填新客價'; return; }
    sel = document.getElementById('qg-course'); if (!sel) return;   // 讀的時候可能換過分頁
    sel.disabled = false; sel.options[0].text = '— 不選，自己填新客價 —';
  }
  var rows = qgCourseRows() || [], h = '<option value="">— 不選，自己填新客價 —</option>', cat = null;
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

function qgSyncPmode(){
  var w = document.getElementById('qg-pmode'); if (!w) return;
  w.querySelectorAll('button').forEach(function(x){ x.classList.toggle('active', (x.dataset.v === 'auto') === !!qgCase.auto); });
}

function qgRecalc(){
  var c = qgCase, p = qgParams();
  var r = qgCompute(c, p);
  var matMissing = c.mat === '' || c.mat === null || c.mat === undefined;
  var dash = function(v){ return matMissing ? '—' : qFmt(v); };

  // 自動模式：每人價由系統填，欄位變唯讀樣式；點進去就切成自己訂價
  var pi = document.getElementById('qg-price');
  if (pi && c.auto) pi.value = matMissing ? '' : Math.round(r.price);
  if (pi) { pi.readOnly = !!c.auto; pi.style.opacity = c.auto ? '0.75' : ''; }
  qSetText('qg-priceHint', c.auto ? '系統算的，點一下就能自己改' : '自己填的，想回到建議價按「自動」');
  qSetText('qg-heroLbl', !c.auto ? '跟家長報每人（含稅）｜自己訂的價'
    : r.useAnchor ? '跟家長報每人（含稅）｜新客價 ' + qFmt(r.anchor) + ' 打 ' + Math.round(r.disc*100) + ' 折'
    : '跟家長報每人（含稅）｜還沒有新客價，先照目標利潤率 ' + Math.round(r.gm*100) + '% 從成本算');
  qSetText('qg-per', matMissing ? '先填材料成本' : qFmt(r.perTax));
  qSetText('qg-perNet', dash(r.price));

  // 換行時保留輸入中的焦點：只更新費用文字，不重畫人員列
  document.querySelectorAll('#qg-staff .qg-row').forEach(function(el){
    var row = c.staff[+el.dataset.i]; var f = el.querySelector('.qg-fee');
    if (row && f) f.textContent = qFmt(qgRowFee(row, p));
  });

  ['qg-trans-wrap','qg-haul-wrap'].forEach(function(id){
    var w = document.getElementById(id); if (w) w.style.display = r.isOut ? '' : 'none';
  });

  qSetText('qg-margin', matMissing ? '—' : (Math.round(r.margin * 1000) / 10).toFixed(1) + '%');
  qSetText('qg-profit', dash(r.profit));
  qSetText('qg-rev', qFmt(r.rev));
  qSetText('qg-revTax', qFmt(r.revTax));
  qSetText('qg-guar', r.guarantee + ' 人');

  var tierRow = function(label, total, totalTax, always){
    var show = function(v){ return !isFinite(v) ? '—' : (always ? qFmt(v) : dash(v)); };
    return '<tr'+(always?' style="font-weight:600"':'')+'><td>'+label+'</td>' +
      '<td>'+show(total)+'</td><td>'+show(totalTax)+'</td>' +
      '<td>'+show(total / r.n)+'</td><td>'+show(total / r.hrs)+'</td></tr>';
  };
  var tiers = document.getElementById('qg-tiers');
  if (tiers) tiers.innerHTML =
    tierRow('打平　低於這個就倒貼', r.be, r.beTax) +
    tierRow('目標　照 '+Math.round(r.gm*100)+'% 利潤率', r.tgt, r.tgtTax) +
    tierRow(!c.auto ? '目前報價' : r.useAnchor ? '建議報價　新客價打 ' + Math.round(r.disc*100) + ' 折' : '建議報價　含稅取整到 50', r.rev, r.revTax, true);

  var bd = document.getElementById('qg-breakdown');
  if (bd) {
    bd.innerHTML = matMissing ? '<p class="muted">填了材料成本才會出現拆解。</p>' :
      qRow('材料　' + r.n + ' 人 × ' + qFmt(qN(c.mat)), r.mat) +
      qRow('講師費與人頭獎金', r.fees) +
      (r.isOut ? qRow('交通＋搬運', r.trans + r.haul) : '') +
      qRow('其他雜支', r.misc) +
      qRow('當天被擠掉的四樓營收', r.lost) +
      qRow('總部管理費　' + qN(p.gHq) + '%', r.hqFee) +
      '<div style="display:flex;justify-content:space-between;padding:10px 0 0;margin-top:4px;font-weight:600"><span>淨賺</span><span>' + qFmt(r.profit) + '</span></div>' +
      '<p class="muted" style="margin-top:10px">營業稅 ' + qN(p.gTax) + '% 是代收，加在未稅價上面，不算進成本也不算進利潤。</p>';
  }

  var warns = [];
  if (matMissing) warns.push(['var(--gold2)', '材料成本還沒填，每門課不一樣，填了才算得出底線和利潤率。']);
  else {
    if (r.rev < r.be) warns.push(['var(--red)', '這個價格會倒貼，差 ' + qFmt(r.be - r.rev) + ' 元。']);
    else if (r.margin < r.gm) warns.push(['var(--gold2)', '低於目標利潤率 ' + Math.round(r.gm*100) + '%，確定要接再送出。']);
    else if (c.auto && !r.useAnchor) warns.push(['var(--gold2)', '這門課還沒有新客價，這個價是從成本往上算的，通常偏低。先參考同類課程的新客價填進去再報。']);
    else if (c.auto) warns.push(['var(--green)', '直接報每人 ' + qFmt(r.perTax) + ' 元（含稅）。最低可以讓到每人 ' + qFmt(r.beTax / r.n) + '（含稅），再低就倒貼。']);
    else warns.push(['var(--green)', '可以接。這個價格淨賺 ' + qFmt(r.profit) + '，讓到 ' + qFmt(r.be) + '（每人 ' + qFmt(r.be / r.n) + '）就是白做工。']);
  }
  if (!r.isOut && r.n > 25) warns.push(['var(--gold2)', '超過外場團班容量（25 人），需加開小教室並多配一位老師。']);
  if (r.hasHead && r.headSum !== Math.round(r.n)) warns.push(['var(--gold2)', '人頭獎金分配的人數（' + r.headSum + '）跟報名人數（' + r.n + '）不符。']);
  if (r.isOut && r.n < qN(p.gOutMin)) warns.push(['var(--gold2)', '外派未滿 ' + qN(p.gOutMin) + ' 人，將按 ' + r.guarantee + ' 人收費。']);
  if (c.staff.length) warns.push(['var(--text3)', '帶課配比：每位帶課者平均帶 ' + r.perStaff.toFixed(1) + ' 人。']);

  var w = document.getElementById('qg-warn');
  if (w) w.innerHTML = warns.map(function(x){ return '<div style="color:'+x[0]+'">'+x[1]+'</div>'; }).join('');
  var hero = document.getElementById('qg-hero');
  if (hero) hero.style.borderLeftColor = warns.length ? warns[0][0] : 'var(--gold)';
}

function qgCopyText(){
  var c = qgCase, p = qgParams(), r = qgCompute(c, p);
  var perTax = r.perTax;
  var txt = 'Otto2 ARTCLUB藝術工作室　團班課程報價\n' +
    '人數：' + r.n + ' 人\n' +
    '時長：' + r.hrs + ' 小時\n' +
    '地點：' + (r.isOut ? '貴單位場地（老師到府授課）' : '本工作室四樓') + '\n' +
    '每人：NT$ ' + qFmt(perTax) + '（含稅）\n' +
    '總價：NT$ ' + qFmt(r.revTax) + '（含 ' + qN(p.gTax) + '% 營業稅，未稅 NT$ ' + qFmt(r.rev) + '）\n' +
    '含材料、教具與全程教學指導。\n' +
    (r.isOut ? '最低以 ' + qN(p.gOutMin) + ' 人計費。' : '實到少於 ' + r.guarantee + ' 人仍以 ' + r.guarantee + ' 人計費。');
  if (navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(txt).then(function(){ alert('已複製，貼給對方即可') },
      function(){ alert('複製失敗，請手動選取') });
  } else {
    alert('複製失敗，請手動選取');
  }
}
