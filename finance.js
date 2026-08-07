/* ══════════════════════════════════════════════════════════
   財務：業績表 ＋ 現金流表（同一頁，上下排）

   這兩張表算的是不同東西，永遠不會相等，這是對的：
   ・業績＝賣了多少（含預收，錢不一定今天進來）
   ・現金流＝今天實際收到多少錢

   客人 8/1 買 15,000 方案 → 現金流 15,000、課程營收 0
   客人 8/15 用點數上課 1,800 → 課程營收 1,800、現金流 0

   資料來源
   ・otto2-2026/deductions  核銷（byWay 已按支付方式拆好）
   ・otto2-2026/deposits    訂金（收款那天記一筆，不跟核銷重複）
   ・salaryData.planSales   賣方案（預收）

   規則（2026-08 定案）
   ・預收記實付金額，贈點不計入，多出來的自然變成贈點成本
   ・堂數方案＝票券，點數方案＝儲值金
   ・折價券是贈送的，不記預收
   ・文化幣是政府核銷，不算現金，獨立列在「應收」
   ・不給「販售＋預收」的混合總數（會重複計算），夯客口徑另外用灰字附註
   ══════════════════════════════════════════════════════════ */
(function(){
"use strict";

var FN_URL = "https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app";
var fnf = function(p){ return FN_URL.replace(/\/$/,"")+p };

/* 現金流要分幾張卡就看這裡。文化幣不在內，它走應收 */
var FN_WAYS = [
  {k:"cash",    n:"現金"},
  {k:"card",    n:"信用卡"},
  {k:"linepay", n:"LINE Pay"},
  {k:"transfer",n:"匯款"}
];
var FN_CULTURE = "culture";   /* 文化幣 */
/* 這幾種是扣既有餘額，不是收錢，現金流完全不算 */
var FN_NONCASH = ["points","sessions","voucher"];

var fnMode = "day";           /* day / month */
var fnDate = new Date();
var fnDed  = null;            /* 全部核銷紀錄 */
var fnDep  = null;            /* 全部訂金紀錄 */
var fnErr  = "";

function fnPad(n){ return String(n).padStart(2,"0") }
function fnDs(d){ return d.getFullYear()+"/"+fnPad(d.getMonth()+1)+"/"+fnPad(d.getDate()) }
function fnNorm(s){ return String(s||"").replace(/-/g,"/") }
function fnEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c] }) }
function fnMoney(n){ return "$"+Math.round(+n||0).toLocaleString() }

/* 這個日期在不在目前選的範圍內 */
function fnInRange(dateStr){
  var s=fnNorm(dateStr); if(!s)return false;
  if(fnMode==="day")return s===fnDs(fnDate);
  return s.slice(0,7)===fnDs(fnDate).slice(0,7);
}
function fnRangeLabel(){
  var y=fnDate.getFullYear(), m=fnDate.getMonth()+1;
  if(fnMode==="day"){
    var wd=["日","一","二","三","四","五","六"][fnDate.getDay()];
    return y+"/"+fnPad(m)+"/"+fnPad(fnDate.getDate())+"（"+wd+"）";
  }
  return y+" 年 "+m+" 月";
}
function fnShift(step){
  if(fnMode==="day")fnDate.setDate(fnDate.getDate()+step);
  else fnDate.setMonth(fnDate.getMonth()+step);
  fnRender();
}

/* ── 讀資料 ──
   deductions 和 deposits 都整包抓下來再在前端篩。
   資料量還小，這樣寫最單純；之後筆數大了再改成按月份分片。 */
async function fnLoad(force){
  if(fnDed&&fnDep&&!force)return;
  fnErr="";
  try{
    var a=await (await fetch(fnf("/deductions.json"))).json();
    fnDed=[]; Object.keys(a||{}).forEach(function(k){
      var v=a[k]; if(!v||v.voided)return; fnDed.push(v) });
  }catch(e){ fnDed=[]; fnErr+="核銷紀錄讀取失敗："+e.message+"　" }
  try{
    var b=await (await fetch(fnf("/deposits.json"))).json();
    fnDep=[]; Object.keys(b||{}).forEach(function(k){
      var v=b[k]; if(!v||v.voided)return; fnDep.push(v) });
  }catch(e){ fnDep=[]; fnErr+="訂金紀錄讀取失敗："+e.message }
}

/* ── 業績 ── */
function fnSales(){
  var o={course:0,goods:0,voucher:0,stored:0,
         planRows:[],courseRows:0};
  (fnDed||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    o.courseRows++;
    o.course+=(+r.courseAmt||0);
    /* 加購要拆商品還是課程，看那筆有沒有標成商品。
       還沒標的一律算課程升級——換大一號畫布是課程的一部分，不是零售。 */
    (r.addons||[]).forEach(function(a){
      var amt=+a.amt||0;
      if(a.goods)o.goods+=amt; else o.course+=amt;
    });
  });
  /* 方案：堂數包算票券，純點數算儲值金。
     金額一律記實付價，贈點不加進來（那是行銷成本，不是收入）。 */
  var ps=(typeof S!=="undefined"&&S&&S.planSales)?S.planSales:{};
  Object.keys(ps||{}).forEach(function(d){
    if(!fnInRange(d))return;
    (ps[d]||[]).forEach(function(x){
      var price=+x.price||0;
      if(+x.sessions>0)o.voucher+=price; else o.stored+=price;
      o.planRows.push({date:d,name:x.name||x.phone||"",plan:x.plan||"",
        price:price,pay:x.pay||"",kind:(+x.sessions>0)?"票券":"儲值金"});
    });
  });
  o.sellSub=o.course+o.goods;
  o.preSub =o.voucher+o.stored;
  return o;
}

/* ── 現金流 ──
   結帳收款讀 deductions.byWay（訂金不在裡面，它記在收款那天）
   預收定金讀 deposits
   賣方案的錢也是實際收款，歸在「結帳收款」 */
function fnCash(){
  var o={}, cult={checkout:0,deposit:0}, note=[];
  FN_WAYS.forEach(function(w){ o[w.k]={checkout:0,deposit:0} });

  (fnDed||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    var bw=r.byWay||{};
    Object.keys(bw).forEach(function(k){
      var amt=+bw[k]||0; if(!amt)return;
      if(FN_NONCASH.indexOf(k)>=0)return;          /* 扣點扣堂不是收錢 */
      if(k===FN_CULTURE){ cult.checkout+=amt; return }
      if(o[k])o[k].checkout+=amt;
      else note.push("核銷出現沒見過的付款方式："+k);
    });
  });

  (fnDep||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    var amt=+r.amount||0; if(!amt)return;
    var k=r.way||"";
    if(FN_NONCASH.indexOf(k)>=0)return;
    if(k===FN_CULTURE){ cult.deposit+=amt; return }
    if(o[k])o[k].deposit+=amt;
    else note.push("訂金出現沒見過的付款方式："+k);
  });

  var ps=(typeof S!=="undefined"&&S&&S.planSales)?S.planSales:{};
  Object.keys(ps||{}).forEach(function(d){
    if(!fnInRange(d))return;
    (ps[d]||[]).forEach(function(x){
      var amt=+x.price||0; if(!amt)return;
      var k=x.pay||"";
      if(k===FN_CULTURE){ cult.checkout+=amt; return }
      if(o[k])o[k].checkout+=amt;
      else note.push("賣方案的付款方式對不上（"+(x.plan||"")+" "+fnMoney(amt)+"），先沒算進現金流");
    });
  });

  var sumCk=0,sumDp=0;
  FN_WAYS.forEach(function(w){ sumCk+=o[w.k].checkout; sumDp+=o[w.k].deposit });
  return {by:o,culture:cult,checkout:sumCk,deposit:sumDp,total:sumCk+sumDp,
          notes:note.filter(function(v,i,a){return a.indexOf(v)===i})};
}

/* ── 畫面 ── */
function fnBar(pct,cls){
  return '<div class="fn-bar"><i class="'+cls+'" style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div>';
}
function fnRow(label,amt,base,cls){
  var pct=base?(amt/base*100):0;
  return '<div class="fn-row"><div class="fn-rl">'+fnEsc(label)+'</div>'+
    '<div class="fn-rb">'+fnBar(pct,cls)+'</div>'+
    '<div class="fn-rp">'+(base?pct.toFixed(1)+"%":"—")+'</div>'+
    '<div class="fn-ra">'+fnMoney(amt)+'</div></div>';
}

function fnRender(){
  var root=document.getElementById("fnRoot"); if(!root)return;
  if(!fnDed||!fnDep){
    root.innerHTML='<div class="fn-load">讀取中…</div>';
    fnLoad().then(fnRender); return;
  }
  var s=fnSales(), c=fnCash();
  var sellBase=s.sellSub||1, preBase=s.preSub||1;
  var h="";

  h+='<div class="fn-head">'+
     '<div class="fn-seg">'+
       '<button class="fn-sg'+(fnMode==="day"?" on":"")+'" id="fnDay">每日</button>'+
       '<button class="fn-sg'+(fnMode==="month"?" on":"")+'" id="fnMon">每月</button>'+
     '</div>'+
     '<div class="fn-nav"><button id="fnPrev">‹</button>'+
       '<b>'+fnRangeLabel()+'</b>'+
       '<button id="fnNext">›</button>'+
       '<button class="fn-today" id="fnNow">今天</button></div>'+
     '<button class="fn-re" id="fnRe">重新讀取</button></div>';

  if(fnErr)h+='<div class="fn-warn">'+fnEsc(fnErr)+'</div>';

  /* ── 業績 ── */
  h+='<div class="fn-sec"><div class="fn-st">業績'+
     '<span>含預收，不等於實際入帳</span></div>';
  h+='<div class="fn-grid">'+
     '<div class="fn-kpi"><span>販售小計</span><b>'+fnMoney(s.sellSub)+'</b>'+
       '<i>當下就認列的營收</i></div>'+
     '<div class="fn-kpi"><span>預收小計</span><b>'+fnMoney(s.preSub)+'</b>'+
       '<i>收了錢，課還沒上</i></div></div>';

  h+='<div class="fn-block"><div class="fn-bt">販售</div>'+
     fnRow("課程營收",s.course,sellBase,"c1")+
     fnRow("商品營收",s.goods,sellBase,"c2")+
     '<div class="fn-sub"><span>販售小計</span><b>'+fnMoney(s.sellSub)+'</b></div></div>';

  h+='<div class="fn-block"><div class="fn-bt">預收</div>'+
     fnRow("票券販售（堂數方案）",s.voucher,preBase,"c3")+
     fnRow("方案販售（點數方案）",s.stored,preBase,"c4")+
     '<div class="fn-sub"><span>預收小計</span><b>'+fnMoney(s.preSub)+'</b></div></div>';

  h+='<div class="fn-foot">夯客口徑合計 '+fnMoney(s.sellSub+s.preSub)+
     '　·　這個數字會重複計算（賣方案算一次，之後扣點上課再算一次），只供比對舊資料</div>';
  if(!s.goods)h+='<div class="fn-hint">商品營收目前是 0：加購項目還沒有「算商品」的標記，'+
     '全部歸在課程營收。標記功能做好之後這裡才會分開。</div>';
  h+='</div>';

  /* ── 現金流 ── */
  h+='<div class="fn-sec"><div class="fn-st">現金流'+
     '<span>'+(fnMode==="day"?"這天":"這個月")+'實際收到的錢</span></div>';
  h+='<div class="fn-total"><span>總收款</span><b>'+fnMoney(c.total)+'</b></div>';
  h+='<div class="fn-grid">'+
     '<div class="fn-kpi"><span>來自結帳收款</span><b>'+fnMoney(c.checkout)+'</b>'+
       '<i>核銷與賣方案</i></div>'+
     '<div class="fn-kpi"><span>預收定金</span><b>'+fnMoney(c.deposit)+'</b>'+
       '<i>預約時先收的訂金</i></div></div>';

  FN_WAYS.forEach(function(w){
    var v=c.by[w.k], t=v.checkout+v.deposit;
    h+='<div class="fn-block'+(t?"":" off")+'"><div class="fn-bt">'+w.n+'</div>'+
       '<div class="fn-line"><span>來自結帳收款</span><b>'+fnMoney(v.checkout)+'</b></div>'+
       '<div class="fn-line"><span>預收定金</span><b>'+fnMoney(v.deposit)+'</b></div>'+
       '<div class="fn-sub"><span>合計</span><b>'+fnMoney(t)+'</b></div></div>';
  });

  var ct=c.culture.checkout+c.culture.deposit;
  h+='<div class="fn-block cult"><div class="fn-bt">文化幣<span>應收，尚未入帳</span></div>'+
     '<div class="fn-line"><span>來自結帳收款</span><b>'+fnMoney(c.culture.checkout)+'</b></div>'+
     '<div class="fn-line"><span>預收定金</span><b>'+fnMoney(c.culture.deposit)+'</b></div>'+
     '<div class="fn-sub"><span>合計</span><b>'+fnMoney(ct)+'</b></div>'+
     '<div class="fn-note">政府核銷後才會撥款，沒有算進上面的總收款。</div></div>';

  if(c.notes.length)
    h+='<div class="fn-warn">'+c.notes.map(fnEsc).join("<br>")+'</div>';
  h+='</div>';

  root.innerHTML=h;
  document.getElementById("fnDay").onclick=function(){ fnMode="day"; fnRender() };
  document.getElementById("fnMon").onclick=function(){ fnMode="month"; fnRender() };
  document.getElementById("fnPrev").onclick=function(){ fnShift(-1) };
  document.getElementById("fnNext").onclick=function(){ fnShift(1) };
  document.getElementById("fnNow").onclick=function(){ fnDate=new Date(); fnRender() };
  document.getElementById("fnRe").onclick=function(){
    fnDed=null; fnDep=null; fnRender() };
}
window.renderFinance=fnRender;

/* ── 樣式 ── */
(function(){
  var css=
  "#fnRoot{--fnNavy:#1E2B4F;--fnInk:#232936;--fnMute:#8A90A0;--fnLine:#ECEEF2;"+
    "--fnSoft:#F6F7F9;--fnOk:#12805C;--fnGold:#C99A3B;color:var(--fnInk)}"+
  "#fnRoot *{box-sizing:border-box}"+
  ".fn-load{padding:40px 0;text-align:center;color:#8A90A0;font-size:14px}"+
  ".fn-head{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:20px}"+
  ".fn-seg{display:flex;background:#F2F3F6;border-radius:10px;padding:3px}"+
  ".fn-sg{border:0;background:transparent;padding:7px 15px;border-radius:8px;font-size:13px;"+
    "color:#5F6577;cursor:pointer;font-family:inherit}"+
  ".fn-sg.on{background:#fff;color:var(--fnNavy);font-weight:600;box-shadow:0 1px 2px rgba(16,24,40,.08)}"+
  ".fn-nav{display:flex;align-items:center;gap:6px}"+
  ".fn-nav button{width:32px;height:32px;border:1px solid #E3E6EC;background:#fff;border-radius:9px;"+
    "font-size:16px;color:#5F6577;cursor:pointer;line-height:1;font-family:inherit}"+
  ".fn-nav b{font-size:15px;min-width:150px;text-align:center;color:var(--fnInk)}"+
  ".fn-nav .fn-today{width:auto;padding:0 13px;font-size:13px;color:var(--fnNavy);font-weight:600}"+
  ".fn-re{margin-left:auto;border:1px solid #E3E6EC;background:#fff;border-radius:9px;"+
    "padding:7px 13px;font-size:12.5px;color:#5F6577;cursor:pointer;font-family:inherit}"+
  ".fn-sec{margin-bottom:30px}"+
  ".fn-st{font-size:17px;font-weight:600;color:var(--fnInk);margin-bottom:14px;"+
    "display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}"+
  ".fn-st span{font-size:12.5px;font-weight:400;color:var(--fnMute)}"+
  ".fn-grid{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px}"+
  ".fn-kpi{flex:1;min-width:150px;background:#fff;border-radius:14px;padding:15px 16px;"+
    "box-shadow:0 1px 3px rgba(16,24,40,.06)}"+
  ".fn-kpi span{display:block;font-size:12px;color:var(--fnMute)}"+
  ".fn-kpi b{display:block;font-size:24px;font-weight:700;color:var(--fnNavy);"+
    "line-height:1.2;margin-top:4px;font-variant-numeric:tabular-nums}"+
  ".fn-kpi i{display:block;font-size:11.5px;color:var(--fnMute);font-style:normal;margin-top:3px}"+
  ".fn-total{background:var(--fnNavy);border-radius:14px;padding:16px 18px;margin-bottom:12px;"+
    "display:flex;align-items:baseline;justify-content:space-between}"+
  ".fn-total span{font-size:13px;color:#C3CBDD}"+
  ".fn-total b{font-size:28px;color:#fff;font-weight:700;font-variant-numeric:tabular-nums}"+
  ".fn-block{background:#fff;border-radius:14px;padding:14px 16px;margin-bottom:10px;"+
    "box-shadow:0 1px 3px rgba(16,24,40,.06)}"+
  ".fn-block.off{opacity:.55}"+
  ".fn-block.cult{box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 var(--fnGold)}"+
  ".fn-bt{font-size:14px;font-weight:600;margin-bottom:10px;display:flex;align-items:baseline;gap:8px}"+
  ".fn-bt span{font-size:11.5px;font-weight:400;color:var(--fnGold)}"+
  ".fn-row{display:flex;align-items:center;gap:10px;padding:7px 0}"+
  ".fn-rl{flex:0 0 auto;min-width:150px;font-size:13.5px}"+
  ".fn-rb{flex:1;min-width:60px}"+
  ".fn-rp{flex:0 0 52px;text-align:right;font-size:12.5px;color:var(--fnMute);"+
    "font-variant-numeric:tabular-nums}"+
  ".fn-ra{flex:0 0 92px;text-align:right;font-size:14px;font-weight:600;"+
    "font-variant-numeric:tabular-nums}"+
  ".fn-bar{height:7px;background:#F0F1F4;border-radius:99px;overflow:hidden}"+
  ".fn-bar i{display:block;height:100%;border-radius:99px}"+
  ".fn-bar .c1{background:#4C6FB1}.fn-bar .c2{background:#3FA694}"+
  ".fn-bar .c3{background:#E0A93C}.fn-bar .c4{background:#8A7BC8}"+
  ".fn-line{display:flex;justify-content:space-between;padding:6px 0;font-size:13.5px}"+
  ".fn-line span{color:#5F6577}"+
  ".fn-line b{font-weight:500;font-variant-numeric:tabular-nums}"+
  ".fn-sub{display:flex;justify-content:space-between;padding:9px 0 0;margin-top:5px;"+
    "border-top:1px solid var(--fnLine);font-size:13.5px}"+
  ".fn-sub span{color:var(--fnNavy);font-weight:600}"+
  ".fn-sub b{color:var(--fnNavy);font-weight:700;font-variant-numeric:tabular-nums}"+
  ".fn-foot{font-size:12px;color:var(--fnMute);margin-top:8px;line-height:1.7}"+
  ".fn-hint{font-size:12.5px;color:var(--fnMute);margin-top:8px;line-height:1.7;"+
    "background:var(--fnSoft);border-radius:10px;padding:10px 13px}"+
  ".fn-note{font-size:11.5px;color:var(--fnMute);margin-top:8px;line-height:1.6}"+
  ".fn-warn{background:#FDF4E3;color:#8A6400;font-size:12.5px;padding:11px 13px;"+
    "border-radius:10px;margin-bottom:12px;line-height:1.7}"+
  "@media(max-width:640px){.fn-rl{min-width:104px;font-size:12.5px}"+
    ".fn-ra{flex-basis:80px;font-size:13px}.fn-rp{flex-basis:44px}"+
    ".fn-nav b{min-width:110px;font-size:14px}}";
  var st=document.createElement("style");
  st.textContent=css; document.head.appendChild(st);
})();

})();
