/* ══════════════════════════════════════════════════════════
   Otto2 今日排課 ＋ 核銷
   資料來源：otto2-booking-f9ef7（預約、會員）
   寫出去：otto2-2026 的 deductions（每日登記讀得到）
   所有識別字加 bk 前綴，避免跟 app / consumables / inventory 撞名
   ══════════════════════════════════════════════════════════ */
(function(){
"use strict";

var BK_URL   = "https://otto2-booking-f9ef7-default-rtdb.asia-southeast1.firebasedatabase.app";
var SAL_URL  = "https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app";
var NOTIFY   = "https://otto2-notify-production.up.railway.app";
var SLOTS    = ["10:00-12:00","14:00-16:00","16:00-18:00"];
var TEACHERS = ["大熊","羊羊","Ethan","77","蓁蓁","米雪","米妮"];
var PAYWAYS  = [
  {k:"points",  n:"點數扣抵", member:true },
  {k:"sessions",n:"堂數扣抵", member:true },
  {k:"cash",    n:"現金",     member:false},
  {k:"linepay", n:"LINE Pay", member:false},
  {k:"card",    n:"刷卡",     member:false},
  {k:"transfer",n:"匯款",     member:false}
];
var bkf  = function(p){ return BK_URL.replace(/\/$/,"")+p };
var salf = function(p){ return SAL_URL.replace(/\/$/,"")+p };
var bonusOf = function(a){ return Math.floor((+a||0)/500) };
var esc = function(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] }) };

var bkDate = new Date(), bkList = [], bkMembers = null, bkBusy = false;
var SHEET_ID = "1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M";
var SEAT_CAP = 5;                 /* 每位老師可帶人數 */
var bkCourses = null, bkSched = null;

/* 讀 Google 試算表（跟客人端同一份資料） */
async function bkGviz(sheet){
  var url="https://docs.google.com/spreadsheets/d/"+SHEET_ID+
    "/gviz/tq?sheet="+encodeURIComponent(sheet)+"&tqx=out:json";
  var t=await (await fetch(url)).text();
  var a=t.indexOf("{"), b=t.lastIndexOf("}");
  var j=JSON.parse(t.substring(a,b+1));
  if(!j.table)throw new Error("找不到工作表「"+sheet+"」");
  return j.table.rows.map(function(r){ return r.c.map(function(c){
    return c?(c.f==null?c.v:c.f):"" }) });
}
function bkNum(v){
  var m=String(v==null?"":v).replace(/[^\d.]/g,"");
  return m?Math.round(parseFloat(m)):0;
}
async function bkLoadCourses(){
  if(bkCourses)return;
  try{
    var rows=await bkGviz("課程");
    if(rows.length&&String(rows[0][0]).trim()==="分類")rows.shift();
    var out=[];
    rows.forEach(function(r){
      var name=String(r[1]||"").trim();
      var on=String(r[7]||"Y").trim().toUpperCase()!=="N";
      if(!name||!on)return;
      var spec=String(r[3]||"").trim();
      out.push({cat:String(r[0]||"").trim(),name:name,spec:spec,
        dur:String(r[4]||"").trim(),price:bkNum(r[5]),
        label:name+(spec?"（"+spec+"）":"")});
    });
    bkCourses=out;
  }catch(e){ bkCourses=[]; }
}
async function bkLoadSched(){
  if(bkSched)return;
  try{
    var rows=await bkGviz("班表");
    if(rows.length&&/日期|週/.test(String(rows[0][0])))rows.shift();
    var m={};
    rows.forEach(function(r){
      var d=String(r[0]||"").trim().replace(/-/g,"/");
      if(d)m[d]=bkNum(r[1]);
    });
    bkSched=m;
  }catch(e){ bkSched={}; }
}
/* 那個時段還剩幾位 */
function bkLeft(dateStr,slot){
  var cap=(bkSched&&bkSched[dateStr]!=null?bkSched[dateStr]:1)*SEAT_CAP;
  var used=bkList.filter(function(b){
    return b.date===dateStr&&(b.slot===slot||b.slot2===slot)&&
      b.status!=="cancelled"&&b.status!=="expired";
  }).reduce(function(s,b){ return s+(+b.people||0) },0);
  return cap-used;
}

function ds(d){ var p=function(n){return String(n).padStart(2,"0")};
  return d.getFullYear()+"/"+p(d.getMonth()+1)+"/"+p(d.getDate()) }
var WD=["日","一","二","三","四","五","六"];

async function jget(u){ try{ var r=await (await fetch(u)).json(); return (r&&r.error)?null:r }catch(e){ return null } }

/* ── 載入 ── */
async function bkLoad(){
  var all=await jget(bkf("/bookings.json"))||{};
  var d=ds(bkDate);
  bkList=Object.keys(all).map(function(k){ var o=all[k]; o.id=k; return o })
    .filter(function(b){ return b.date===d && b.status!=="cancelled" && b.status!=="expired" })
    .sort(function(a,b){ return String(a.slot).localeCompare(String(b.slot)) });
}
async function bkLoadMembers(){
  if(bkMembers)return;
  var j=await jget(bkf("/members.json"))||{};
  bkMembers=Object.keys(j).map(function(p){ var m=j[p]||{}; var c=m.cache||{};
    return {phone:p,name:m.name||"",points:+c.points||0,sessions:+c.sessions||0,bonus:+c.bonus||0} });
}
function bkSearch(q){
  if(!bkMembers||!q||q.trim().length<2)return[];
  var s=q.trim(), d=s.replace(/\D/g,"");
  return bkMembers.filter(function(m){
    return (d.length>=3&&m.phone.indexOf(d)>=0)||(m.name&&m.name.indexOf(s)>=0) }).slice(0,8);
}
async function bkMember(phone){
  if(!phone)return null;
  var m=await jget(bkf("/members/"+phone+".json"));
  if(m)m.phone=phone;
  return m;
}

/* ── 畫面 ── */
async function bkRender(){
  var root=document.getElementById("bkRoot"); if(!root)return;
  if(!bkBusy){ bkBusy=true; root.innerHTML='<div class="bk-empty">載入中…</div>';
    await bkLoad(); bkBusy=false; }
  var d=bkDate, today=ds(new Date())===ds(d);
  var totalPeople=bkList.reduce(function(s,b){return s+(+b.people||0)},0);
  var doneCount=bkList.filter(function(b){return b.checkout}).length;
  var sum=bkList.reduce(function(s,b){return s+(b.checkout?(+b.checkout.total||0):0)},0);

  root.innerHTML=
   '<div class="bk-bar">'+
     '<button class="bk-nav" id="bkPrev">‹</button>'+
     '<div class="bk-date"><b>'+ds(d)+'</b><span>（'+WD[d.getDay()]+'）'+(today?" · 今天":"")+'</span></div>'+
     '<button class="bk-nav" id="bkNext">›</button>'+
     '<button class="bk-nav bk-tdy" id="bkToday">今天</button>'+
   '</div>'+
   '<div class="bk-stat">'+
     '<div><b>'+bkList.length+'</b><span>預約組數</span></div>'+
     '<div><b>'+totalPeople+'</b><span>總人數</span></div>'+
     '<div><b>'+doneCount+'/'+bkList.length+'</b><span>已核銷</span></div>'+
     '<div><b>$'+sum.toLocaleString()+'</b><span>本日核銷金額</span></div>'+
   '</div>'+
   SLOTS.concat(["其他"]).map(function(sl){
      var g=bkList.filter(function(b){
        return sl==="其他" ? SLOTS.indexOf(b.slot)<0 : (b.slot===sl||b.slot2===sl) });
      if(!g.length)return "";
      return '<div class="bk-slot"><div class="bk-sh">'+sl+'　<span>'+
        g.reduce(function(s,b){return s+(+b.people||0)},0)+' 位</span></div>'+
        g.map(bkCard).join("")+'</div>';
   }).join("")+
   (bkList.length?"":'<div class="bk-empty">這天沒有預約</div>')+
   '<button class="bk-add" id="bkAdd">＋ 手動登記</button>';

  document.getElementById("bkPrev").onclick=function(){ bkDate.setDate(bkDate.getDate()-1); bkRender() };
  document.getElementById("bkNext").onclick=function(){ bkDate.setDate(bkDate.getDate()+1); bkRender() };
  document.getElementById("bkToday").onclick=function(){ bkDate=new Date(); bkRender() };
  document.getElementById("bkAdd").onclick=bkManual;
  root.querySelectorAll("[data-at]").forEach(function(el){ el.onclick=function(){
    bkPatch("/bookings/"+el.dataset.at+".json",{attend:el.dataset.v}).then(bkRefresh) } });
  root.querySelectorAll("[data-ck]").forEach(function(el){ el.onclick=function(){ bkCheckout(el.dataset.ck) } });
  root.querySelectorAll("[data-cx]").forEach(function(el){ el.onclick=function(){ bkCancel(el.dataset.cx) } });
}
window.bkRender=bkRender;

function bkCard(b){
  var c=b.checkout, unpaid=b.deposit&&b.deposit.status!=="paid"&&!c;
  var items=(b.items||[]).map(function(i){
    return esc(i.name)+(i.spec?"("+esc(i.spec)+")":"")+" ×"+(i.qty||1) }).join("、");
  return '<div class="bk-card'+(c?" ok":(unpaid?" wait":""))+'">'+
    '<div class="bk-who"><b>'+esc(b.customer&&b.customer.name||"—")+'</b> '+(b.people||1)+'位'+
      (b.memberPhone?'<span class="bk-tag m">會員</span>':'')+
      (unpaid?'<span class="bk-tag w">待付訂金</span>':'')+
      (b.source==="manual"?'<span class="bk-tag s">現場登記</span>':'')+'</div>'+
    '<div class="bk-sub">'+esc(b.customer&&b.customer.phone||"")+(items?"　"+items:"")+'</div>'+
    (b.customer&&b.customer.note?'<div class="bk-note">備註：'+esc(b.customer.note)+'</div>':'')+
    (c?'<div class="bk-done">已核銷　'+esc(c.summary||"")+'　<b>$'+(+c.total||0).toLocaleString()+
        '</b>　'+esc(c.teacher||"")+'</div>':'')+
    '<div class="bk-btns">'+
      '<button class="bk-b'+(b.attend==="in"?" on":"")+'" data-at="'+b.id+'" data-v="in">已報到</button>'+
      '<button class="bk-b'+(b.attend==="no"?" no":"")+'" data-at="'+b.id+'" data-v="no">未到</button>'+
      '<button class="bk-b ck" data-ck="'+b.id+'">'+(c?"修正核銷":"核銷")+'</button>'+
      '<button class="bk-b cx" data-cx="'+b.id+'">取消</button>'+
    '</div></div>';
}

/* ── 寫入小工具 ── */
function bkPatch(path,data){ return fetch(bkf(path),{method:"PATCH",
  headers:{"Content-Type":"application/json"},body:JSON.stringify(data)}) }
function bkLedger(phone,e){ return fetch(bkf("/members/"+phone+"/ledger.json"),{method:"POST",
  headers:{"Content-Type":"application/json"},body:JSON.stringify(e)}) }
async function bkCache(phone,type,delta){
  var m=await bkMember(phone); if(!m)return;
  var c=Object.assign({points:0,sessions:0,bonus:0},m.cache||{});
  c[type]=(+c[type]||0)+delta;
  await bkPatch("/members/"+phone+"/cache.json",c);
}
async function bkRefresh(){ bkMembers=null; await bkLoad(); bkRender() }

/* ── 彈窗 ── */
function bkSheet(html){
  var m=document.getElementById("bkMask");
  if(!m){ m=document.createElement("div"); m.id="bkMask"; m.className="bk-mask";
    m.innerHTML='<div class="bk-sheet" id="bkSheet"></div>'; document.body.appendChild(m);
    m.onclick=function(e){ if(e.target===m)bkClose() }; }
  document.getElementById("bkSheet").innerHTML=html;
  m.classList.add("on");
}
function bkClose(){ var m=document.getElementById("bkMask"); if(m)m.classList.remove("on") }

/* ══ 核銷 ══ */
async function bkCheckout(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var old=b.checkout;
  var payer=null;
  /* course: 課程本身；addons: 加價項目 */
  var course={amt:old?old.courseAmt:(b.total||0), way:old?old.coursePay:""};
  var addons=old&&old.addons?JSON.parse(JSON.stringify(old.addons)):[];
  var teacher=old?old.teacher:"";

  bkSheet(
   '<h3>'+(old?"修正核銷":"核銷")+'</h3>'+
   '<div class="bk-sh2">'+b.date+'　'+esc(b.actualTime||b.slot)+'　'+esc(b.customer&&b.customer.name||"")+'　'+(b.people||1)+' 位</div>'+
   (old?'<div class="bk-warn">這筆已核銷過。按確認會先沖銷原本那筆，再寫入新的，原始紀錄不會消失。</div>':'')+
   '<div id="ckWho"></div>'+
   '<div class="bk-f"><label>課程費用</label><input id="ckAmt" inputmode="numeric" value="'+(course.amt||"")+'"></div>'+
   '<div class="bk-f"><label>課程付款方式</label><div class="bk-ways" id="ckWays"></div></div>'+
   '<div class="bk-f"><label>加價項目（畫布、公仔等）</label><div id="ckAdd"></div>'+
     '<button class="bk-mini" id="ckAddNew">＋ 新增一項</button></div>'+
   '<div class="bk-f"><label style="display:flex;align-items:center;gap:7px">'+
     '<input type="checkbox" id="ckProxy" style="width:16px;height:16px"> 用其他會員的點數（朋友代扣）</label>'+
     '<div id="ckProxyBox"></div></div>'+
   '<div class="bk-f"><label>上課老師</label><select id="ckT"><option value="">請選擇</option>'+
     TEACHERS.map(function(t){return '<option'+(teacher===t?" selected":"")+'>'+t+'</option>'}).join("")+'</select></div>'+
   '<div class="bk-calc" id="ckCalc"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="ckX">取消</button>'+
     '<button class="bk-save" id="ckOK">'+(old?"確認修正":"確認核銷")+'</button></div>');

  document.getElementById("ckX").onclick=bkClose;

  function drawWho(){
    var w=document.getElementById("ckWho");
    if(!payer){ w.innerHTML='<div class="bk-warn">這筆沒有綁定會員，只能用現金類付款。需要用朋友的點數請勾選下方。</div>'; }
    else{ var c=payer.cache||{};
      w.innerHTML='<div class="bk-info"><b>'+esc(payer.name||"（未填姓名）")+'</b> '+payer.phone+
        '<div>可用點數 <b>'+(+c.points||0).toLocaleString()+'</b>　堂數 <b>'+(+c.sessions||0)+
        '</b>　紅利 <b>'+(+c.bonus||0)+'</b></div></div>'; }
  }
  function drawWays(){
    document.getElementById("ckWays").innerHTML=PAYWAYS.map(function(p){
      return '<div class="bk-way'+(course.way===p.k?" on":"")+(p.member&&!payer?" dis":"")+
        '" data-w="'+p.k+'">'+p.n+'</div>' }).join("");
    document.querySelectorAll("#ckWays [data-w]").forEach(function(el){
      el.onclick=function(){ course.way=el.dataset.w; drawWays(); calc() } });
  }
  function drawAddons(){
    document.getElementById("ckAdd").innerHTML=addons.map(function(a,i){
      return '<div class="bk-addon">'+
        '<input class="an" data-i="'+i+'" placeholder="品名（例：8F 畫布）" value="'+esc(a.name||"")+'">'+
        '<input class="av" data-i="'+i+'" inputmode="numeric" placeholder="金額" value="'+(a.amt||"")+'">'+
        '<select class="aw" data-i="'+i+'">'+PAYWAYS.map(function(p){
          return '<option value="'+p.k+'"'+(a.way===p.k?" selected":"")+
            (p.member&&!payer?" disabled":"")+'>'+p.n+'</option>' }).join("")+'</select>'+
        '<span class="ax" data-i="'+i+'">✕</span></div>' }).join("");
    document.querySelectorAll(".an").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].name=el.value } });
    document.querySelectorAll(".av").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].amt=+el.value||0; calc() } });
    document.querySelectorAll(".aw").forEach(function(el){ el.onchange=function(){ addons[+el.dataset.i].way=el.value; calc() } });
    document.querySelectorAll(".ax").forEach(function(el){ el.onclick=function(){ addons.splice(+el.dataset.i,1); drawAddons(); calc() } });
  }
  document.getElementById("ckAddNew").onclick=function(){
    addons.push({name:"",amt:0,way:payer?"points":"cash"}); drawAddons(); calc() };

  function calc(){
    course.amt=+document.getElementById("ckAmt").value||0;
    var addTotal=addons.reduce(function(s,a){return s+(+a.amt||0)},0);
    var total=course.amt+addTotal;
    var bonus=bonusOf(course.amt);          /* 加價項目不算紅利 */
    var h="課程 <b>$"+course.amt.toLocaleString()+"</b>";
    if(addTotal)h+="　加價 <b>$"+addTotal.toLocaleString()+"</b>";
    h+="　合計 <b>$"+total.toLocaleString()+"</b><br>";
    if(payer){
      var usePt=(course.way==="points"?course.amt:0)+
        addons.reduce(function(s,a){return s+(a.way==="points"?(+a.amt||0):0)},0);
      var useSe=(course.way==="sessions"?1:0);
      if(usePt){ var left=(payer.cache&&payer.cache.points||0)-usePt;
        h+="扣點數 <b>"+usePt.toLocaleString()+"</b>，剩 <b>"+left.toLocaleString()+"</b><br>";
        if(left<0)h+='<div class="bk-err">點數不足，還差 '+Math.abs(left).toLocaleString()+' 點</div>'; }
      if(useSe){ var l2=(payer.cache&&payer.cache.sessions||0)-1;
        h+="扣堂數 <b>1</b>，剩 <b>"+l2+"</b><br>";
        if(l2<0)h+='<div class="bk-err">堂數不足</div>'; }
      h+="紅利回饋 <b>+"+bonus+"</b> 點（課程 "+course.amt.toLocaleString()+" ÷ 500，加價不計）";
    } else h+="未綁會員，不累積紅利";
    document.getElementById("ckCalc").innerHTML=h;
  }
  document.getElementById("ckAmt").oninput=calc;
  document.getElementById("ckT").onchange=function(){ teacher=this.value };

  async function setPayer(phone){
    payer=phone?await bkMember(phone):null;
    drawWho(); drawWays(); drawAddons(); calc();
  }
  document.getElementById("ckProxy").onchange=async function(){
    var box=document.getElementById("ckProxyBox");
    if(!this.checked){ box.innerHTML=""; await setPayer(b.memberPhone||""); return; }
    await bkLoadMembers();
    box.innerHTML='<input id="ckFind" placeholder="打電話或姓名找朋友的帳號"><div id="ckHits"></div>';
    document.getElementById("ckFind").oninput=function(){
      var r=bkSearch(this.value), h=document.getElementById("ckHits");
      if(this.value.trim().length<2){ h.innerHTML=""; return }
      h.innerHTML=r.length?r.map(function(m,i){
        return '<div class="bk-hit" data-pi="'+i+'"><b>'+esc(m.name||"（未填姓名）")+'</b> '+m.phone+
          '<div class="bk-bal">點數 '+m.points.toLocaleString()+'　堂數 '+m.sessions+'</div></div>' }).join("")
        :'<div class="bk-hint">查無此人</div>';
      h.querySelectorAll("[data-pi]").forEach(function(el){ el.onclick=async function(){
        h.innerHTML=""; document.getElementById("ckFind").value="";
        await setPayer(r[+el.dataset.pi].phone) } });
    };
  };
  await setPayer(b.memberPhone||"");
  if(old&&old.payerPhone&&old.payerPhone!==b.memberPhone){
    document.getElementById("ckProxy").checked=true;
    document.getElementById("ckProxy").dispatchEvent(new Event("change"));
    await setPayer(old.payerPhone);
  }

  document.getElementById("ckOK").onclick=async function(){
    calc();
    var t=document.getElementById("ckT").value;
    var cp=PAYWAYS.filter(function(p){return p.k===course.way})[0];
    if(!course.amt||!cp||!t){ alert("課程費用、付款方式、上課老師都要填"); return }
    if(cp.member&&!payer){ alert("這個付款方式需要先選會員"); return }
    addons=addons.filter(function(a){ return a.name||a.amt });
    for(var i=0;i<addons.length;i++){
      var ap=PAYWAYS.filter(function(p){return p.k===addons[i].way})[0];
      if(!addons[i].amt){ alert("加價項目「"+(addons[i].name||"未命名")+"」沒有填金額"); return }
      if(ap&&ap.member&&!payer){ alert("加價項目不能用點數，這筆沒有綁會員"); return }
    }
    var usePt=(course.way==="points"?course.amt:0)+
      addons.reduce(function(s,a){return s+(a.way==="points"?(+a.amt||0):0)},0);
    if(payer&&usePt>(payer.cache&&payer.cache.points||0)&&
       !confirm("點數不足，扣完會變成負數。確定嗎？"))return;

    var btn=this; btn.disabled=true; btn.textContent="處理中…";
    try{
      var now=new Date().toISOString();
      /* 修正：先沖銷 */
      if(old){
        if(old.payerPhone){
          if(old.usePoints){ await bkLedger(old.payerPhone,{type:"points",delta:old.usePoints,
            reason:"核銷修正沖銷",bookingId:id,by:"admin",at:now}); await bkCache(old.payerPhone,"points",old.usePoints); }
          if(old.useSessions){ await bkLedger(old.payerPhone,{type:"sessions",delta:old.useSessions,
            reason:"核銷修正沖銷",bookingId:id,by:"admin",at:now}); await bkCache(old.payerPhone,"sessions",old.useSessions); }
          if(old.bonus){ await bkLedger(old.payerPhone,{type:"bonus",delta:-old.bonus,
            reason:"核銷修正沖銷",bookingId:id,by:"admin",at:now}); await bkCache(old.payerPhone,"bonus",-old.bonus); }
        }
        if(old.logId)await fetch(salf("/deductions/"+old.logId+".json"),{method:"PATCH",
          headers:{"Content-Type":"application/json"},body:JSON.stringify({voided:true,voidAt:now})});
      }
      var proxy=payer&&b.memberPhone&&payer.phone!==b.memberPhone;
      var tail=proxy?"（代 "+(b.customer&&b.customer.name||"")+" 扣課）":"";
      var useSe=(course.way==="sessions"?1:0), bonus=bonusOf(course.amt);
      if(payer){
        if(usePt){ await bkLedger(payer.phone,{type:"points",delta:-usePt,
          reason:"扣課"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"points",-usePt); }
        if(useSe){ await bkLedger(payer.phone,{type:"sessions",delta:-useSe,
          reason:"扣課"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"sessions",-useSe); }
        if(bonus){ await bkLedger(payer.phone,{type:"bonus",delta:bonus,
          reason:"扣課回饋"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"bonus",bonus); }
      }
      /* 拆付款：每一種方式各記一筆金額，方便每日登記分流 */
      var byWay={}; byWay[course.way]=(byWay[course.way]||0)+course.amt;
      addons.forEach(function(a){ byWay[a.way]=(byWay[a.way]||0)+(+a.amt||0) });
      var addTotal=addons.reduce(function(s,a){return s+(+a.amt||0)},0);
      var total=course.amt+addTotal;
      var dt=new Date(b.date.replace(/\//g,"-")+"T00:00:00");
      var log={date:b.date,month:dt.getMonth()+1,day:dt.getDate(),dept:"4F",
        customer:(b.customer&&b.customer.name)||"",phone:b.memberPhone||"",
        payerPhone:payer?payer.phone:"",teacher:t,people:b.people||1,
        courseAmt:course.amt,coursePay:course.way,addons:addons,addonTotal:addTotal,
        total:total,byWay:byWay,bonus:bonus,
        items:(b.items||[]).map(function(i){return i.name}).join("、"),
        bookingId:id,at:now,voided:false};
      var logId="";
      try{ var r=await (await fetch(salf("/deductions.json"),{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(log)})).json();
        logId=r&&r.name||""; }
      catch(e){ alert("扣課明細寫入每日登記失敗，但餘額已扣。請截圖告知：\n"+e.message) }

      var sumTxt=PAYWAYS.filter(function(p){return byWay[p.k]}).map(function(p){
        return p.n+" $"+byWay[p.k].toLocaleString() }).join("＋");
      await bkPatch("/bookings/"+id+".json",{attend:"in",status:"done",
        checkout:{courseAmt:course.amt,coursePay:course.way,addons:addons,addonTotal:addTotal,
          total:total,byWay:byWay,usePoints:usePt,useSessions:useSe,bonus:bonus,
          teacher:t,payerPhone:payer?payer.phone:"",summary:sumTxt,logId:logId,at:now}});
      bkClose(); bkRefresh();
      if(window.renderDaily)try{ renderDaily() }catch(e){}
    }catch(e){
      alert("核銷失敗："+e.message+"\n請重新整理後確認餘額是否已變動。");
      btn.disabled=false; btn.textContent="確認核銷";
    }
  };
}

/* ══ 取消 ══ */
async function bkCancel(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  if(b.checkout&&!confirm("這筆已經核銷過，取消預約不會自動退還點數。\n請先用「修正核銷」處理餘額。仍要取消嗎？"))return;
  if(!confirm("確定取消 "+((b.customer&&b.customer.name)||"這筆")+" 的預約？\n名額會立刻釋出，客人會收到 LINE 通知。"))return;
  var reason=prompt("取消原因（可留空，會顯示在客人的通知裡）","")||"";
  await bkPatch("/bookings/"+id+".json",{status:"cancelled",cancelledAt:new Date().toISOString(),cancelReason:reason});
  if(b.line&&b.line.userId)fetch(NOTIFY+"/notify/cancel",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(Object.assign({},b,{reason:reason||undefined}))}).catch(function(){});
  bkRefresh();
}

/* ══ 手動登記（代客人預約）══ */
async function bkManual(){
  bkSheet('<h3>手動登記預約</h3><div class="bk-sh2">代客人預約、現場加開</div>'+
   '<div class="bk-f"><label>找會員（電話或姓名，兩個字以上）</label>'+
     '<input id="mFind" placeholder="例：0965 或 曾亭"><div id="mHits"></div><div id="mPick"></div></div>'+
   '<div class="bk-f2"><div class="bk-f"><label>日期</label>'+
       '<input id="mDate" type="date" value="'+ds(bkDate).replace(/\//g,"-")+'"></div>'+
     '<div class="bk-f"><label>時段</label><select id="mSlot"></select>'+
       '<div class="bk-left" id="mLeft"></div></div></div>'+
   '<div class="bk-f"><label>課程</label><select id="mCourse"><option value="">載入中…</option></select>'+
     '<div class="bk-left" id="mCInfo"></div></div>'+
   '<div class="bk-f2"><div class="bk-f"><label>人數 *</label>'+
       '<input id="mPeople" inputmode="numeric" value="1"></div>'+
     '<div class="bk-f"><label>金額</label><input id="mAmt" inputmode="numeric">'+
       '<div class="bk-left">選課程後自動帶入，可修改</div></div></div>'+
   '<div class="bk-f2"><div class="bk-f"><label>姓名 *</label><input id="mName"></div>'+
     '<div class="bk-f"><label>電話</label><input id="mPhone" inputmode="tel"></div></div>'+
   '<div class="bk-f"><label>備註</label><textarea id="mNote" rows="2" placeholder="例：想畫自己的貓"></textarea></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="mX">取消</button>'+
     '<button class="bk-save" id="mOK">登記</button></div>');
  document.getElementById("mX").onclick=bkClose;
  var picked=null;

  /* 時段 */
  var slotSel=document.getElementById("mSlot");
  slotSel.innerHTML=SLOTS.map(function(s){return "<option>"+s+"</option>"}).join("")+"<option>其他</option>";
  function showLeft(){
    var d=document.getElementById("mDate").value.replace(/-/g,"/");
    var sl=slotSel.value, el=document.getElementById("mLeft");
    if(sl==="其他"){ el.innerHTML=""; return }
    var n=bkLeft(d,sl), ppl=+document.getElementById("mPeople").value||1;
    el.innerHTML = n<=0
      ? '<span class="bk-full">已額滿，仍可加開</span>'
      : (n<ppl ? '<span class="bk-full">剩 '+n+' 位，不足 '+ppl+' 位</span>'
               : '<span class="bk-ok">剩 '+n+' 位</span>');
  }
  slotSel.onchange=showLeft;
  document.getElementById("mDate").onchange=async function(){
    /* 換日期要重抓那天的預約才算得準 */
    var keep=bkDate; bkDate=new Date(this.value+"T00:00:00");
    await bkLoad(); bkDate=keep; showLeft();
  };
  document.getElementById("mPeople").oninput=function(){ showLeft(); fillAmt() };

  /* 課程 */
  await bkLoadCourses(); await bkLoadSched();
  var cSel=document.getElementById("mCourse");
  cSel.innerHTML='<option value="">（不指定，手動填金額）</option>'+
    bkCourses.map(function(c,i){ return '<option value="'+i+'">'+esc(c.label)+'</option>' }).join("");
  function fillAmt(){
    var i=cSel.value, info=document.getElementById("mCInfo");
    if(i===""){ info.innerHTML=""; return }
    var c=bkCourses[+i], ppl=+document.getElementById("mPeople").value||1;
    document.getElementById("mAmt").value=c.price*ppl;
    info.innerHTML="單價 $"+c.price.toLocaleString()+(c.dur?"　時長 "+esc(c.dur):"");
  }
  cSel.onchange=fillAmt;
  showLeft();

  /* 會員搜尋 */
  await bkLoadMembers();
  document.getElementById("mFind").oninput=function(){
    picked=null; document.getElementById("mPick").innerHTML="";
    var r=bkSearch(this.value), h=document.getElementById("mHits");
    if(this.value.trim().length<2){ h.innerHTML=""; return }
    h.innerHTML=r.length?r.map(function(m,i){
      return '<div class="bk-hit" data-i="'+i+'"><b>'+esc(m.name||"（未填姓名）")+'</b> '+m.phone+
        '<div class="bk-bal">點數 '+m.points.toLocaleString()+'　堂數 '+m.sessions+'　紅利 '+m.bonus+'</div></div>' }).join("")
      :'<div class="bk-hint">查無此人，可直接在下方手動填寫</div>';
    h.querySelectorAll("[data-i]").forEach(function(el){ el.onclick=function(){
      picked=r[+el.dataset.i];
      document.getElementById("mName").value=picked.name;
      document.getElementById("mPhone").value=picked.phone;
      document.getElementById("mFind").value=""; h.innerHTML="";
      document.getElementById("mPick").innerHTML='<div class="bk-info"><b>'+esc(picked.name||"（未填姓名）")+
        '</b> '+picked.phone+'<div>可用點數 <b>'+picked.points.toLocaleString()+'</b>　堂數 <b>'+picked.sessions+
        '</b>　紅利 <b>'+picked.bonus+'</b></div>'+
        (picked.name?"":'<div class="bk-warn">這位會員沒有姓名，請在下方補填，登記後會寫回會員檔案。</div>')+'</div>';
    } });
  };

  document.getElementById("mOK").onclick=async function(){
    var g=function(id){ return document.getElementById(id).value.trim() };
    if(!g("mName")||!(+g("mPeople"))){ alert("姓名和人數必填"); return }
    var ppl=+g("mPeople"), ci=cSel.value;
    var c=ci===""?null:bkCourses[+ci];
    var amt=+g("mAmt")||0;
    var d=g("mDate").replace(/-/g,"/"), sl=g("mSlot");
    if(sl!=="其他"&&bkLeft(d,sl)<ppl&&
       !confirm("這個時段名額不足，登記後會超收。確定嗎？"))return;
    var rec={date:d,slot:sl,people:ppl,
      items:c?[{name:c.name,spec:c.spec,qty:ppl,price:c.price}]
             :(g("mNote")?[]:[]),
      total:amt,
      customer:{name:g("mName"),phone:g("mPhone"),note:g("mNote")},
      status:"new",source:"manual",ts:new Date().toISOString()};
    if(picked)rec.memberPhone=picked.phone;
    var btn=this; btn.disabled=true; btn.textContent="登記中…";
    try{
      await fetch(bkf("/bookings.json"),{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(rec)});
      if(picked&&!picked.name&&g("mName"))
        bkPatch("/members/"+picked.phone+".json",{name:g("mName")}).catch(function(){});
      bkClose();
      bkDate=new Date(d.replace(/\//g,"-")+"T00:00:00");
      bkRefresh();
    }catch(e){ alert("登記失敗："+e.message); btn.disabled=false; btn.textContent="登記" }
  };
}

/* ── 樣式 ── */
var css=document.createElement("style");
css.textContent=
".bk-bar{display:flex;align-items:center;gap:8px;margin-bottom:12px}"+
".bk-nav{background:#fff;border:1px solid #ddd;border-radius:8px;padding:7px 13px;font-size:15px;cursor:pointer}"+
".bk-tdy{font-size:13px}"+
".bk-date{flex:1;text-align:center}.bk-date b{font-size:16px}.bk-date span{font-size:12px;color:#888;margin-left:5px}"+
".bk-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}"+
".bk-stat div{flex:1;min-width:78px;background:#fff;border:1px solid #eee;border-radius:9px;padding:9px;text-align:center}"+
".bk-stat b{display:block;font-size:19px;color:#1E2B4F}.bk-stat span{font-size:11px;color:#999}"+
".bk-slot{margin-bottom:16px}"+
".bk-sh{font-size:13px;font-weight:700;color:#1E2B4F;padding:6px 0;border-bottom:2px solid #E3B34C}"+
".bk-sh span{font-weight:400;color:#999}"+
".bk-card{background:#fff;border:1px solid #eee;border-radius:10px;padding:11px 13px;margin-top:9px}"+
".bk-card.ok{background:#F4FAF6;border-color:#B8DCC6}"+
".bk-card.wait{background:#FFFBF0;border-left:3px solid #E3B34C}"+
".bk-who b{font-size:15px;color:#1E2B4F}"+
".bk-tag{display:inline-block;font-size:10.5px;padding:1px 7px;border-radius:99px;margin-left:5px;vertical-align:2px}"+
".bk-tag.m{background:#EEF2FA;color:#1E2B4F}.bk-tag.w{background:#FDF3DC;color:#8A6400}.bk-tag.s{background:#F0F0F0;color:#777}"+
".bk-sub{font-size:12.5px;color:#777;margin-top:3px}"+
".bk-note{font-size:12px;color:#8A6400;margin-top:3px}"+
".bk-done{font-size:12.5px;color:#2E7D4F;margin-top:6px;background:#E8F3EC;padding:5px 9px;border-radius:6px}"+
".bk-btns{display:flex;gap:6px;margin-top:9px;flex-wrap:wrap}"+
".bk-b{flex:1;min-width:66px;padding:7px 4px;font-size:12.5px;background:#fff;border:1px solid #ddd;border-radius:7px;cursor:pointer}"+
".bk-b.on{background:#1E2B4F;color:#fff;border-color:#1E2B4F}"+
".bk-b.no{background:#F0F0F0;color:#888}"+
".bk-b.ck{border-color:#1E2B4F;color:#1E2B4F;font-weight:700}"+
".bk-b.cx{border-color:#C9453B;color:#C9453B}"+
".bk-add{width:100%;margin-top:14px;padding:12px;background:#1E2B4F;color:#fff;border:0;border-radius:9px;font-size:14px;cursor:pointer}"+
".bk-empty{text-align:center;color:#aaa;padding:30px;font-size:13px}"+
".bk-mask{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;z-index:900;align-items:flex-end;justify-content:center}"+
".bk-mask.on{display:flex}"+
".bk-sheet{background:#F7F5F0;width:100%;max-width:560px;max-height:92vh;overflow:auto;border-radius:16px 16px 0 0;padding:18px 16px 26px}"+
".bk-sheet h3{font-size:16px;color:#1E2B4F;margin:0 0 3px}"+
".bk-sh2{font-size:12.5px;color:#888;margin-bottom:12px}"+
".bk-f{margin-bottom:11px}.bk-f2{display:flex;gap:10px}.bk-f2 .bk-f{flex:1}"+
".bk-f label{display:block;font-size:12px;color:#888;margin-bottom:4px}"+
".bk-f input,.bk-f select,.bk-f textarea,#ckFind,#mFind{width:100%;padding:9px 11px;border:1px solid #ddd;border-radius:8px;font-size:14px;font-family:inherit;box-sizing:border-box}"+
".bk-ways{display:flex;gap:7px;flex-wrap:wrap}"+
".bk-way{flex:1 1 30%;min-width:88px;text-align:center;padding:9px 5px;border:1px solid #ddd;border-radius:8px;background:#fff;font-size:13px;cursor:pointer}"+
".bk-way.on{border-color:#1E2B4F;background:#EEF2FA;color:#1E2B4F;font-weight:700}"+
".bk-way.dis{opacity:.35;pointer-events:none}"+
".bk-addon{display:flex;gap:6px;align-items:center;margin-bottom:6px}"+
".bk-addon .an{flex:2}.bk-addon .av{flex:1;min-width:70px}.bk-addon .aw{flex:1;min-width:88px}"+
".bk-addon input,.bk-addon select{padding:8px;border:1px solid #ddd;border-radius:7px;font-size:13px;box-sizing:border-box}"+
".ax{color:#C9453B;cursor:pointer;padding:0 4px;font-size:15px}"+
".bk-mini{background:#fff;border:1px dashed #999;border-radius:7px;padding:7px 12px;font-size:12.5px;cursor:pointer;width:100%}"+
".bk-info{background:#F4F7FD;border:1px solid #C9D6EE;border-radius:9px;padding:10px 12px;margin-bottom:11px;font-size:13px;color:#1E2B4F}"+
".bk-info b{color:#1E2B4F}"+
".bk-warn{background:#FDF3DC;color:#8A6400;font-size:12.5px;padding:8px 10px;border-radius:7px;margin:7px 0}"+
".bk-err{background:#FBEAE8;color:#C9453B;font-size:12.5px;padding:7px 10px;border-radius:7px;margin-top:6px}"+
".bk-calc{font-size:12.5px;color:#777;line-height:1.9;margin:10px 0}.bk-calc b{color:#1E2B4F;font-size:14px}"+
".bk-hit{padding:9px 11px;border:1px solid #ddd;border-radius:8px;margin-top:6px;background:#fff;cursor:pointer}"+
".bk-hit b{color:#1E2B4F}.bk-bal{font-size:12px;color:#888;margin-top:2px}"+
".bk-hint{font-size:12.5px;color:#999;padding:8px 2px}"+
".bk-left{font-size:12px;color:#888;margin-top:4px}"+
".bk-ok{color:#2E7D4F}.bk-full{color:#C9453B;font-weight:700}"+
".bk-act{display:flex;gap:10px;margin-top:16px}"+
".bk-cancel{flex:1;padding:12px;background:#fff;border:1px solid #ccc;border-radius:9px;font-size:14px;cursor:pointer}"+
".bk-save{flex:2;padding:12px;background:#1E2B4F;color:#fff;border:0;border-radius:9px;font-size:14px;font-weight:600;cursor:pointer}";
document.head.appendChild(css);

document.addEventListener("DOMContentLoaded",function(){ setTimeout(bkRender,400) });
})();
