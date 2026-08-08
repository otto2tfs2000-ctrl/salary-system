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

/* 手動補登可以選的類別。前兩個算販售，後兩個算預收 */
/* 補登的類別。預收（賣方案）不在這裡——那不是當日營業收入，只進現金流 */
var FN_CATS = [
  {k:"course", n:"課程營收"},
  {k:"goods",  n:"商品營收"},
  {k:"plan",   n:"賣方案（只進現金流）"}
];
/* 補登的收款方式。多了「不進現金流」給點數扣抵、贈送那種用 */
var FN_MWAYS = FN_WAYS.concat([
  {k:FN_CULTURE,n:"文化幣"},
  {k:"none",    n:"不進現金流"}
]);

var fnMode = "day";           /* day / month */
var fnDate = new Date();
var fnDed  = null;            /* 全部核銷紀錄 */
var fnDep  = null;            /* 全部訂金紀錄 */
var fnMan  = null;            /* 手動補登 */
var fnOpen = "";              /* 課程排行展開中的那一門 */
var fnErr  = "";

function fnPad(n){ return String(n).padStart(2,"0") }
function fnDs(d){ return d.getFullYear()+"/"+fnPad(d.getMonth()+1)+"/"+fnPad(d.getDate()) }
function fnNorm(s){ return String(s||"").replace(/-/g,"/") }
function fnEsc(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;"}[c] }) }
function fnMoney(n){ return "$"+Math.round(+n||0).toLocaleString() }
var FN_PAYNAME={points:"點數",sessions:"堂數",cash:"現金",card:"刷卡",
  linepay:"LINE Pay",transfer:"匯款",culture:"文化幣"};
function fnWayName(k){ return FN_PAYNAME[k]||k||"—" }

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
  if(fnDed&&fnDep&&fnMan&&!force)return;
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
  }catch(e){ fnDep=[]; fnErr+="訂金紀錄讀取失敗："+e.message+"　" }
  try{
    var c=await (await fetch(fnf("/manual.json"))).json();
    fnMan=[]; Object.keys(c||{}).forEach(function(k){
      var v=c[k]; if(!v||v.voided)return; fnMan.push(Object.assign({_id:k},v)) });
    fnMan.sort(function(x,y){ return String(x.date)<String(y.date)?-1:1 });
  }catch(e){ fnMan=[]; fnErr+="補登紀錄讀取失敗："+e.message }
}

/* ── 業績（當日營業扣課收入）──
   這裡算的是「今天實際上了多少課、值多少錢」，不是收到多少現金。

   ・現金／刷卡／LINE Pay 付的 → 收多少算多少
   ・點數扣抵 → 扣多少點算多少（1 點 1 元。優惠在賣方案時就給掉了）
   ・堂數扣抵 → 用那個人買的方案攤下來的單價
       30 堂 30,000 → 一堂 1,000　　70 堂 60,000 → 一堂約 857
   ・訂金已收的部分也算在核銷這天。課程 1,600 收訂金 900、當天再收 700，
     這天的營業收入就是 1,600。

   賣方案的錢不在這裡，那是預收，只出現在現金流。
   ── */
function fnSales(){
  var o={course:0,goods:0,rows:[],est:0};
  var byCourse={};
  (fnDed||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    /* courseRev 是核銷當下算好的認列金額，舊資料沒有就退回課程費用 */
    var rev=(r.courseRev!=null)?(+r.courseRev||0):(+r.courseAmt||0);
    var estimated=(r.coursePay==="sessions"&&!(+r.sessionUnit));
    if(estimated)o.est++;
    o.course+=rev;
    /* 加購都是商品。畫布、公仔這些課程費用之外另計的東西 */
    (r.addons||[]).forEach(function(a){ o.goods+=(+a.amt||0) });

    var cs=r.courses&&r.courses.length
      ? r.courses
      : String(r.items||"").split("、").filter(Boolean).map(function(n){ return {name:n,qty:1} });
    if(!cs.length)cs=[{name:"（未指定課程）",qty:1}];
    /* 一張單有兩堂課的話金額平分，不然排行會重複計算 */
    var share=rev/cs.length;
    cs.forEach(function(c){
      var k=c.name||"（未指定課程）";
      if(!byCourse[k])byCourse[k]={name:k,amt:0,times:0,people:0,specs:{},logs:[]};
      var g=byCourse[k];
      g.amt+=share; g.times++; g.people+=(+c.qty||1);
      var sp=c.spec||"—";
      g.specs[sp]=(g.specs[sp]||0)+1;
      g.logs.push({date:r.date,name:r.customer||"",amt:Math.round(share),
        pay:r.coursePay||"",spec:c.spec||"",teacher:r.teacher||""});
    });
  });
  o.rows=Object.keys(byCourse).map(function(k){ return byCourse[k] })
    .sort(function(a,b){ return b.amt-a.amt });
  /* 手動補登也算進來 */
  (fnMan||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    var amt=+r.amount||0; if(!amt)return;
    if(r.cat==="course")o.course+=amt;
    else if(r.cat==="goods")o.goods+=amt;
    /* cat==="plan" 是賣方案，屬於預收，不算當日營業收入 */
  });
  o.total=o.course+o.goods;
  o.manual=(fnMan||[]).filter(function(r){ return fnInRange(r.date) });
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

  (fnMan||[]).forEach(function(r){
    if(!fnInRange(r.date))return;
    var amt=+r.amount||0; if(!amt)return;
    var k=r.way||"none";
    if(k==="none"||FN_NONCASH.indexOf(k)>=0)return;
    if(k===FN_CULTURE){ cult.checkout+=amt; return }
    if(o[k])o[k].checkout+=amt;
  });

  var sumCk=0,sumDp=0;
  FN_WAYS.forEach(function(w){ sumCk+=o[w.k].checkout; sumDp+=o[w.k].deposit });
  return {by:o,culture:cult,checkout:sumCk,deposit:sumDp,total:sumCk+sumDp,
          notes:note.filter(function(v,i,a){return a.indexOf(v)===i})};
}

/* ── 手動補登 ──
   兩個用途：夯客時期的舊帳補回來、純賣材料那種沒有預約單的收入。
   一筆同時餵兩張表：類別決定算哪種業績，收款方式決定進哪個現金流欄位。
   點數扣抵、贈送那種選「不進現金流」，業績算、錢不算。 */
function fnManBox(list){
  var h='<div class="fn-sec"><div class="fn-st">手動補登'+
        '<span>夯客舊帳、賣材料等沒有預約單的收入</span></div>';
  h+='<div class="fn-block"><div class="fn-mf">'+
     '<div class="fn-mi"><label>日期</label><input type="date" id="fnMDate"></div>'+
     '<div class="fn-mi"><label>類別</label><select id="fnMCat">'+
       FN_CATS.map(function(c){ return '<option value="'+c.k+'">'+c.n+'</option>' }).join("")+
     '</select></div>'+
     '<div class="fn-mi"><label>金額</label><input id="fnMAmt" inputmode="numeric" placeholder="0"></div>'+
     '<div class="fn-mi"><label>收款方式</label><select id="fnMWay">'+
       FN_MWAYS.map(function(w){ return '<option value="'+w.k+'">'+w.n+'</option>' }).join("")+
     '</select></div>'+
     '<div class="fn-mi wide"><label>備註</label>'+
       '<input id="fnMNote" placeholder="例：夯客 8/3 營收、賣顏料一罐"></div>'+
     '<div class="fn-mi"><label>&nbsp;</label>'+
       '<button class="fn-add" id="fnMAdd">新增一筆</button></div>'+
     '</div>';
  if(!list.length)
    h+='<div class="fn-none">這個範圍還沒有補登紀錄</div>';
  else{
    var sum=list.reduce(function(s,r){ return s+(+r.amount||0) },0);
    h+='<div class="fn-mlist">';
    list.forEach(function(r){
      var cat=FN_CATS.filter(function(c){return c.k===r.cat})[0];
      var way=FN_MWAYS.filter(function(w){return w.k===r.way})[0];
      h+='<div class="fn-mrow"><span class="d">'+fnEsc(String(r.date).slice(5))+'</span>'+
         '<span class="c">'+fnEsc(cat?cat.n:r.cat||"")+'</span>'+
         '<span class="w">'+fnEsc(way?way.n:r.way||"")+'</span>'+
         '<span class="n">'+fnEsc(r.note||"")+'</span>'+
         '<span class="a">'+fnMoney(r.amount)+'</span>'+
         '<button class="fn-del" data-del="'+fnEsc(r._id)+'">✕</button></div>';
    });
    h+='<div class="fn-sub"><span>補登小計</span><b>'+fnMoney(sum)+'</b></div></div>';
  }
  h+='</div></div>';
  return h;
}

async function fnManAdd(){
  var d=document.getElementById("fnMDate").value;
  var cat=document.getElementById("fnMCat").value;
  var amt=Math.round(+document.getElementById("fnMAmt").value||0);
  var way=document.getElementById("fnMWay").value;
  var note=document.getElementById("fnMNote").value.trim();
  if(!d){ alert("請選日期"); return }
  if(!(amt>0)){ alert("金額要大於 0"); return }
  var btn=document.getElementById("fnMAdd");
  btn.disabled=true; btn.textContent="存檔中…";
  try{
    await fetch(fnf("/manual.json"),{method:"POST",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({date:d.replace(/-/g,"/"),cat:cat,amount:amt,way:way,
        note:note,dept:"4F",
        by:(typeof ME!=="undefined"&&ME&&ME.displayName)||"",
        at:new Date().toISOString(),voided:false})});
    fnMan=null; await fnLoad(true); fnRender();
  }catch(e){
    alert("存檔失敗："+e.message);
    btn.disabled=false; btn.textContent="新增一筆";
  }
}
async function fnManDel(id){
  if(!confirm("刪掉這筆補登？兩張表的數字都會跟著變。"))return;
  try{
    await fetch(fnf("/manual/"+id+".json"),{method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({voided:true,voidAt:new Date().toISOString()})});
    fnMan=null; await fnLoad(true); fnRender();
  }catch(e){ alert("刪除失敗："+e.message) }
}

/* ── 畫面 ── */
function fnBar(pct,cls){
  return '<div class="fn-bar"><i class="'+cls+'" style="width:'+Math.max(0,Math.min(100,pct))+'%"></i></div>';
}

function fnRender(){
  var root=document.getElementById("fnRoot"); if(!root)return;
  if(!fnDed||!fnDep||!fnMan){
    root.innerHTML='<div class="fn-load">讀取中…</div>';
    fnLoad().then(fnRender); return;
  }
  var s=fnSales(), c=fnCash();
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
  h+='<div class="fn-sec"><div class="fn-st">營業收入'+
     '<span>'+(fnMode==="day"?"這天":"這個月")+'實際上課與販售的金額，不是收到的現金</span></div>';
  h+='<div class="fn-total"><span>營業收入</span><b>'+fnMoney(s.total)+'</b></div>';
  h+='<div class="fn-grid">'+
     '<div class="fn-kpi"><span>課程營收</span><b>'+fnMoney(s.course)+'</b>'+
       '<i>核銷扣課，含點數與堂數折算</i></div>'+
     '<div class="fn-kpi"><span>商品營收</span><b>'+fnMoney(s.goods)+'</b>'+
       '<i>畫布、公仔等加購</i></div></div>';
  if(s.est)
    h+='<div class="fn-warn">有 '+s.est+' 筆堂數扣課查不到方案單價，先用課程費用認列。'+
       '那幾位多半是舊資料匯進來的，沒有購買紀錄可以回推。</div>';

  /* ── 課程排行 ── */
  h+='<div class="fn-block"><div class="fn-bt">課程排行'+
     '<span style="color:var(--fnMute)">點課名看明細</span></div>';
  if(!s.rows.length)h+='<div class="fn-none">這個範圍還沒有核銷紀錄</div>';
  else{
    var base=s.rows[0].amt||1;
    s.rows.forEach(function(g,i){
      var open=fnOpen===g.name;
      h+='<div class="fn-crow'+(open?" on":"")+'" data-c="'+fnEsc(g.name)+'">'+
         '<span class="i">'+(i+1)+'</span>'+
         '<span class="n">'+fnEsc(g.name)+'</span>'+
         '<span class="b">'+fnBar(g.amt/base*100,"c1")+'</span>'+
         '<span class="t">'+g.times+' 堂・'+g.people+' 人</span>'+
         '<span class="a">'+fnMoney(g.amt)+'</span></div>';
      if(open){
        h+='<div class="fn-cdet">';
        var sp=Object.keys(g.specs);
        if(sp.length>1||(sp.length===1&&sp[0]!=="—"))
          h+='<div class="fn-cspec">規格：'+sp.map(function(k){
            return fnEsc(k)+' ×'+g.specs[k] }).join('　')+'</div>';
        h+='<table class="fn-ct"><thead><tr><th>日期</th><th>客人</th><th>付款</th>'+
           '<th>老師</th><th style="text-align:right">金額</th></tr></thead><tbody>';
        g.logs.slice().sort(function(x,y){ return x.date<y.date?-1:1 }).forEach(function(l){
          h+='<tr><td>'+fnEsc(String(l.date).slice(5))+'</td>'+
             '<td>'+fnEsc(l.name||"—")+'</td>'+
             '<td>'+fnEsc(fnWayName(l.pay))+'</td>'+
             '<td>'+fnEsc(l.teacher||"—")+'</td>'+
             '<td style="text-align:right">'+fnMoney(l.amt)+'</td></tr>';
        });
        h+='</tbody></table></div>';
      }
    });
    var tt=s.rows.reduce(function(a2,g){ return a2+g.times },0);
    var pp=s.rows.reduce(function(a2,g){ return a2+g.people },0);
    h+='<div class="fn-sub"><span>合計 '+tt+' 堂・'+pp+' 人</span><b>'+
       fnMoney(s.rows.reduce(function(a2,g){ return a2+g.amt },0))+'</b></div>';
  }
  h+='</div></div>';

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

  h+=fnManBox(s.manual||[]);

  root.innerHTML=h;
  root.querySelectorAll("[data-c]").forEach(function(el){
    el.onclick=function(){ fnOpen=(fnOpen===el.dataset.c)?"":el.dataset.c; fnRender() } });
  var md=document.getElementById("fnMDate");
  if(md)md.value=(fnMode==="day"?fnDs(fnDate):fnDs(new Date())).replace(/\//g,"-");
  var ma=document.getElementById("fnMAdd");
  if(ma)ma.onclick=fnManAdd;
  root.querySelectorAll("[data-del]").forEach(function(el){
    el.onclick=function(){ fnManDel(el.dataset.del) } });
  document.getElementById("fnDay").onclick=function(){ fnMode="day"; fnRender() };
  document.getElementById("fnMon").onclick=function(){ fnMode="month"; fnRender() };
  document.getElementById("fnPrev").onclick=function(){ fnShift(-1) };
  document.getElementById("fnNext").onclick=function(){ fnShift(1) };
  document.getElementById("fnNow").onclick=function(){ fnDate=new Date(); fnRender() };
  document.getElementById("fnRe").onclick=function(){
    fnDed=null; fnDep=null; fnMan=null; fnRender() };
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
  ".fn-crow{display:flex;align-items:center;gap:10px;padding:9px 0;cursor:pointer;"+
    "border-bottom:1px solid #F4F5F8}"+
  ".fn-crow:hover{background:#FAFBFC}"+
  ".fn-crow.on{background:#F7F9FC}"+
  ".fn-crow .i{flex:0 0 20px;font-size:12px;color:var(--fnMute);text-align:center}"+
  ".fn-crow .n{flex:0 0 190px;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
  ".fn-crow .b{flex:1;min-width:50px}"+
  ".fn-crow .t{flex:0 0 92px;text-align:right;font-size:12px;color:var(--fnMute)}"+
  ".fn-crow .a{flex:0 0 92px;text-align:right;font-size:14px;font-weight:600;"+
    "font-variant-numeric:tabular-nums}"+
  ".fn-cdet{background:#F7F9FC;border-radius:10px;padding:12px 14px;margin:2px 0 10px}"+
  ".fn-cspec{font-size:12.5px;color:var(--fnMute);margin-bottom:9px}"+
  ".fn-ct{width:100%;border-collapse:collapse;font-size:12.5px}"+
  ".fn-ct th{text-align:left;color:var(--fnMute);font-weight:400;padding:4px 6px;"+
    "border-bottom:1px solid #E6E9EF}"+
  ".fn-ct td{padding:5px 6px;border-bottom:1px solid #EDF0F4}"+
  ".fn-mf{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;"+
    "align-items:end;margin-bottom:4px}"+
  ".fn-mi.wide{grid-column:span 2}"+
  ".fn-mi label{display:block;font-size:11.5px;color:var(--fnMute);margin-bottom:4px}"+
  ".fn-mi input,.fn-mi select{width:100%;height:38px;padding:0 10px;border:1px solid #E3E6EC;"+
    "border-radius:9px;font-size:13.5px;font-family:inherit;background:#fff;color:var(--fnInk)}"+
  ".fn-add{width:100%;height:38px;border:0;border-radius:9px;background:var(--fnNavy);"+
    "color:#fff;font-size:13.5px;font-weight:600;cursor:pointer;font-family:inherit}"+
  ".fn-add:disabled{opacity:.6;cursor:default}"+
  ".fn-none{font-size:12.5px;color:var(--fnMute);padding:14px 0 2px}"+
  ".fn-mlist{margin-top:14px;border-top:1px solid var(--fnLine);padding-top:6px}"+
  ".fn-mrow{display:flex;align-items:center;gap:10px;padding:8px 0;font-size:13px;"+
    "border-bottom:1px solid #F4F5F8}"+
  ".fn-mrow .d{flex:0 0 44px;color:var(--fnMute);font-variant-numeric:tabular-nums}"+
  ".fn-mrow .c{flex:0 0 84px}"+
  ".fn-mrow .w{flex:0 0 72px;color:var(--fnMute);font-size:12.5px}"+
  ".fn-mrow .n{flex:1;min-width:0;color:var(--fnMute);font-size:12.5px;"+
    "overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"+
  ".fn-mrow .a{flex:0 0 84px;text-align:right;font-weight:600;font-variant-numeric:tabular-nums}"+
  ".fn-del{flex:0 0 auto;width:26px;height:26px;border:0;border-radius:7px;background:#FBF0EF;"+
    "color:#C9453B;font-size:12px;cursor:pointer;font-family:inherit;line-height:1}"+
  "@media(max-width:640px){.fn-rl{min-width:104px;font-size:12.5px}"+
    ".fn-ra{flex-basis:80px;font-size:13px}.fn-rp{flex-basis:44px}"+
    ".fn-nav b{min-width:110px;font-size:14px}"+
    ".fn-crow .n{flex-basis:110px;font-size:12.5px}.fn-crow .b{display:none}"+
    ".fn-crow .t{flex-basis:72px;font-size:11.5px}.fn-crow .a{flex-basis:78px;font-size:13px}"+
    ".fn-mf{grid-template-columns:1fr 1fr}.fn-mi.wide{grid-column:span 2}"+
    ".fn-mrow{flex-wrap:wrap;gap:6px 10px}.fn-mrow .n{flex:1 0 100%;order:9}}";
  var st=document.createElement("style");
  st.textContent=css; document.head.appendChild(st);
})();

})();
