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
/* 舊的寫死名單，只在「老師設定」還沒載入時當備援用 */
var TEACHERS_FALLBACK = ["大熊","羊羊","Ethan","77","蓁蓁","米雪","米妮"];
/* 老師名單一律讀「老師設定」（旗艦店＝四樓），
   這樣核銷寫進 deductions 的名字才跟每日填寫對得起來，人次才帶得進去。 */
function bkTeachers(){
  try{
    if(typeof getTeachers==="function"){
      var l=getTeachers("flagship").map(function(t){ return t.name }).filter(Boolean);
      if(l.length)return l;
    }
  }catch(e){}
  return TEACHERS_FALLBACK;
}
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
/* 權限判斷。auth.js 還沒載入時一律放行，避免整個畫面壞掉 */
function bkCan(k){ return (typeof can === "function") ? can(k) : true }
/* ── 加購項目可選的材料 ──
   直接讀「庫存盤點」旗艦店的品項，跟課程用料同一份資料，不另外維護一張表。
   顏料整類不列：那是課程本身在用的，不會單獨賣給客人。 */
function bkAddonMats(){
  try{
    var items=null;
    if(typeof getInvStoreByName==="function"){
      var st=getInvStoreByName("flagship"); items=st&&st.items;
    }
    if(!items&&typeof getInvItems==="function")items=getInvItems();
    if(!items||!items.length)return [];
    var cats=(typeof INV_CATS!=="undefined"&&INV_CATS&&INV_CATS.length)
      ?INV_CATS:["畫布","框木板","飾品配件","顏料"];
    /* 排序完全跟著「庫存盤點」那張表：先照類別、同類別內照品項自己的 order。
       所以順序要調整就去庫存盤點拖拉品項，這裡不另外排。 */
    var ordOf=(typeof getInvItemOrder==="function")
      ?getInvItemOrder:function(it){ return +it.id||0 };
    return items.filter(function(m){ return String(m.cat||"")!=="顏料" })
      .sort(function(a,b){
        var ca=cats.indexOf(a.cat); if(ca<0)ca=999;
        var cb=cats.indexOf(b.cat); if(cb<0)cb=999;
        if(ca!==cb)return ca-cb;
        return ordOf(a)-ordOf(b);
      });
  }catch(e){ return [] }
}
function bkMatById(id){
  if(id==null||id==="")return null;
  return bkAddonMats().filter(function(m){ return String(m.id)===String(id) })[0]||null;
}
/* 舊核銷紀錄的加購只存了品名，開「修正核銷」時比對一次，對得上就自動接回庫存品項 */
function bkMatByName(nm){
  var k=String(nm==null?"":nm).replace(/\s/g,"").toLowerCase();
  if(!k)return null;
  return bkAddonMats().filter(function(m){
    return String(m.name||"").replace(/\s/g,"").toLowerCase()===k })[0]||null;
}
/* 電話正規化：+886912345678 → 0912345678，去掉空白破折號 */
var bkNorm = function(p){
  var d=String(p==null?"":p).replace(/\D/g,"");
  if(d.indexOf("886")===0) d="0"+d.slice(3);
  return d;
};
var esc = function(s){ return String(s==null?"":s).replace(/[&<>"]/g,function(c){
  return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c] }) };

var bkDate = new Date(), bkList = [], bkMembers = null, bkBusy = false;
var bkIndex = {}, bkIndexReady = false;
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
function bkSlotInfo(dateStr,slot){
  var cap=(bkSched&&bkSched[dateStr]!=null?bkSched[dateStr]:1)*SEAT_CAP;
  var rows=bkList.filter(function(b){
    return b.date===dateStr&&(b.slot===slot||b.slot2===slot)&&
      b.status!=="cancelled"&&b.status!=="expired";
  });
  var used=rows.reduce(function(s,b){ return s+(+b.people||0) },0);
  return {cap:cap,used:used,left:cap-used,groups:rows.length,
    names:rows.map(function(b){ return (b.customer&&b.customer.name)||"—" })};
}
function bkLeft(dateStr,slot){ return bkSlotInfo(dateStr,slot).left }

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
  bkIndex={};
  bkMembers.forEach(function(m){ var k=bkNorm(m.phone); if(k)bkIndex[k]=m.phone });
}
/* 只抓會員電話清單（shallow），不抓 ledger，畫面用這個判斷是不是會員 */
async function bkLoadIndex(){
  if(bkIndexReady)return;
  var j=await jget(bkf("/members.json?shallow=true"))||{};
  Object.keys(j).forEach(function(p){ var k=bkNorm(p); if(k)bkIndex[k]=p });
  bkIndexReady=true;
}
/* 用任何格式的電話找出會員的主鍵電話，找不到回 "" */
async function bkFindPhone(raw){
  var k=bkNorm(raw); if(!k)return "";
  await bkLoadIndex();
  return bkIndex[k]||"";
}
function bkIsMember(b){
  if(b.memberPhone)return true;
  var k=bkNorm(b.customer&&b.customer.phone);
  return !!(k&&bkIndex[k]);
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
    await bkLoad(); await bkLoadIndex(); bkBusy=false; }
  var d=bkDate, today=ds(new Date())===ds(d);
  var totalPeople=bkList.reduce(function(s,b){return s+(+b.people||0)},0);
  var doneCount=bkList.filter(function(b){return b.checkout}).length;
  var sum=bkList.reduce(function(s,b){return s+(b.checkout?(+b.checkout.total||0):0)},0);
  var totKid=bkList.reduce(function(s,b){ var x=bkAK(b); return s+(+x.k||0) },0);
  var pplSub=totKid?"含小孩 "+totKid:"";

  root.innerHTML=
   '<div class="bk-bar">'+
     '<button class="bk-nav" id="bkPrev">‹</button>'+
     '<div class="bk-date"><b>'+ds(d)+'</b><span>（'+WD[d.getDay()]+'）'+(today?" · 今天":"")+'</span></div>'+
     '<button class="bk-nav" id="bkNext">›</button>'+
     '<button class="bk-nav bk-tdy" id="bkToday">今天</button>'+
   '</div>'+
   '<div class="bk-stat">'+
     '<div><b>'+bkList.length+'</b><span>預約組數</span></div>'+
     '<div><b>'+totalPeople+'</b><span>總人數'+(pplSub?"・"+pplSub:"")+'</span></div>'+
     '<div><b>'+doneCount+'/'+bkList.length+'</b><span>已核銷</span></div>'+
     '<div><b>$'+sum.toLocaleString()+'</b><span>本日核銷金額</span></div>'+
   '</div>'+
   (function(){ var ci=0;
    return SLOTS.concat(["其他"]).map(function(sl){
      var g=bkList.filter(function(b){
        return sl==="其他" ? SLOTS.indexOf(b.slot)<0 : (b.slot===sl||b.slot2===sl) });
      if(!g.length)return "";
      var cls="bk-slot c"+(ci++%2);
      return '<div class="'+cls+'"><div class="bk-sh">'+sl+'　<span>'+
        g.reduce(function(s,b){return s+(+b.people||0)},0)+' 位</span></div>'+
        g.map(bkCard).join("")+'</div>';
    }).join("");
   })()+
   (bkList.length?"":'<div class="bk-empty">這天沒有預約</div>')+
   '<button class="bk-add" id="bkAdd">＋ 手動登記</button>';

  document.getElementById("bkPrev").onclick=function(){ bkDate.setDate(bkDate.getDate()-1); bkRender() };
  document.getElementById("bkNext").onclick=function(){ bkDate.setDate(bkDate.getDate()+1); bkRender() };
  document.getElementById("bkToday").onclick=function(){ bkDate=new Date(); bkRender() };
  document.getElementById("bkAdd").onclick=bkManual;
  root.querySelectorAll("[data-at]").forEach(function(el){ el.onclick=function(){
    bkPatch("/bookings/"+el.dataset.at+".json",{attend:el.dataset.v}).then(bkRefresh) } });
  root.querySelectorAll("[data-ck]").forEach(function(el){ el.onclick=function(){ bkCheckout(el.dataset.ck) } });
  root.querySelectorAll("[data-vd]").forEach(function(el){ el.onclick=function(){ bkVoid(el.dataset.vd) } });
  root.querySelectorAll("[data-cx]").forEach(function(el){ el.onclick=function(){ bkCancel(el.dataset.cx) } });
}
window.bkRender=bkRender;

/* 人數組成：2 位（大人 1・小孩 1）；沒填過就只顯示總數 */
function bkAK(b){
  var c=b.checkout||{}, p=b.party||{};
  var a=(c.adults!=null)?c.adults:(b.adults!=null?b.adults:(p.adults!=null?p.adults:null));
  var k=(c.kids  !=null)?c.kids  :(b.kids  !=null?b.kids  :(p.kids  !=null?p.kids  :null));
  return {a:a,k:k,bands:(p.kidBands||[]).join("、")};
}
function bkPplText(b){
  var x=bkAK(b);
  var n=(x.a!=null||x.k!=null)?((+x.a||0)+(+x.k||0)):(+b.people||1);
  if(x.a==null&&x.k==null)return n+" 位";
  var parts=[];
  if(+x.a)parts.push("大人 "+(+x.a));
  if(+x.k)parts.push("小孩 "+(+x.k)+(x.bands?"・"+x.bands:""));
  return n+" 位"+(parts.length?"（"+parts.join("・")+"）":"");
}
function bkCard(b){
  var c=b.checkout, unpaid=b.deposit&&b.deposit.status!=="paid"&&!c;
  var items=(b.items||[]).map(function(i){
    return esc(i.name)+(i.spec?"("+esc(i.spec)+")":"")+" ×"+(i.qty||1) }).join("、");
  var doneHtml="";
  if(c){
    var lines='<div class="bk-dline"><span>課程</span><b>$'+(+c.courseAmt||0).toLocaleString()+'</b></div>';
    (c.addons||[]).forEach(function(a){
      lines+='<div class="bk-dline"><span>加購・'+esc(a.name||"未命名")+'</span><b>$'+
        (+a.amt||0).toLocaleString()+'</b></div>';
    });
    lines+='<div class="bk-dline tot"><span>合計</span><b>$'+(+c.total||0).toLocaleString()+'</b></div>';
    doneHtml='<div class="bk-done"><div class="bk-dhead">已核銷'+
      (c.teacher?'<span>'+esc(c.teacher)+'</span>':'')+'</div>'+lines+
      '<div class="bk-dpay">'+esc(c.summary||"")+
      (c.bonus?'　·　紅利 +'+c.bonus:'')+'</div></div>';
  }
  return '<div class="bk-card'+(c?" ok":(unpaid?" wait":""))+'">'+
    '<div class="bk-who"><b>'+esc(b.customer&&b.customer.name||"—")+'</b> '+bkPplText(b)+
      (bkIsMember(b)?'<span class="bk-tag m">會員</span>':'')+
      (unpaid?'<span class="bk-tag w">待付訂金</span>':'')+
      (b.source==="manual"?'<span class="bk-tag s">現場登記</span>':'')+'</div>'+
    '<div class="bk-sub">'+esc(b.customer&&b.customer.phone||"")+(items?"　"+items:"")+'</div>'+
    (b.customer&&b.customer.note?'<div class="bk-note">備註：'+esc(b.customer.note)+'</div>':'')+
    doneHtml+
    '<div class="bk-btns">'+
      '<button class="bk-b'+(b.attend==="in"?" on":"")+'" data-at="'+b.id+'" data-v="in">已報到</button>'+
      '<button class="bk-b'+(b.attend==="no"?" no":"")+'" data-at="'+b.id+'" data-v="no">未到</button>'+
      /* 核銷會扣點數、作廢會退帳，沒有權限的人不顯示這兩顆 */
      (bkCan("checkout")?'<button class="bk-b ck" data-ck="'+b.id+'">'+(c?"修正核銷":"核銷")+'</button>':"")+
      (c&&bkCan("void")?'<button class="bk-b vd" data-vd="'+b.id+'">作廢</button>':"")+
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
  /* 舊紀錄沒有 materialId，用品名回頭比對庫存品項，對得上就補回去，行政在畫面上看得到 */
  addons.forEach(function(a){
    if(!a)return;
    if(a.materialId==null&&a.name){
      var m=bkMatByName(a.name);
      if(m){ a.materialId=m.id; a.name=m.name; }
    }
    if(a.materialId&&!(+a.qty>0))a.qty=1;
  });
  var teacher=old?old.teacher:"";
  var autoMatched=false;
  var ppl=+b.people||1;
  var _ak=bkAK(b);
  var nKid=(old&&old.kids!=null)?+old.kids:(_ak.k!=null?+_ak.k:0);
  var nAdult=(old&&old.adults!=null)?+old.adults:(_ak.a!=null?+_ak.a:Math.max(0,ppl-nKid));

  bkSheet(
   '<h3>'+(old?"修正核銷":"核銷")+'</h3>'+
   '<div class="bk-sh2">'+b.date+'　'+esc(b.actualTime||b.slot)+'　'+esc(b.customer&&b.customer.name||"")+'　'+(b.people||1)+' 位</div>'+
   (old?'<div class="bk-warn">這筆已核銷過。按確認會先沖銷原本那筆，再寫入新的，原始紀錄不會消失。</div>':'')+
   '<div id="ckWho"></div>'+
   '<div class="bk-f2"><div class="bk-f"><label>大人</label>'+
       '<input id="ckAdult" inputmode="numeric" value="'+nAdult+'"></div>'+
     '<div class="bk-f"><label>小孩</label>'+
       '<input id="ckKid" inputmode="numeric" value="'+nKid+'"></div></div>'+
   '<div class="bk-left" id="ckPplHint" style="margin:-6px 0 11px"></div>'+
   '<div class="bk-f"><label>課程費用</label><input id="ckAmt" inputmode="numeric" value="'+(course.amt||"")+'"></div>'+
   '<div class="bk-f"><label>課程付款方式</label><div class="bk-ways" id="ckWays"></div></div>'+
   '<div class="bk-f"><label>加價項目（畫布、公仔等）</label><div id="ckAdd"></div>'+
     '<button class="bk-mini" id="ckAddNew">＋ 新增一項</button><div id="ckAddWarn"></div></div>'+
   '<div class="bk-f"><label style="display:flex;align-items:center;gap:7px">'+
     '<input type="checkbox" id="ckProxy" style="width:16px;height:16px"> 用其他會員的點數（朋友代扣）</label>'+
     '<div id="ckProxyBox"></div></div>'+
   '<div class="bk-f"><label>上課老師</label><select id="ckT"><option value="">請選擇</option>'+
     bkTeachers().map(function(t){return '<option'+(teacher===t?" selected":"")+'>'+esc(t)+'</option>'}).join("")+'</select></div>'+
   '<div class="bk-calc" id="ckCalc"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="ckX">取消</button>'+
     '<button class="bk-save" id="ckOK">'+(old?"確認修正":"確認核銷")+'</button></div>');

  document.getElementById("ckX").onclick=bkClose;

  function drawWho(){
    var w=document.getElementById("ckWho");
    if(!payer){ w.innerHTML='<div class="bk-warn">這支電話在會員檔案裡找不到，只能用現金類付款。要用朋友的點數請勾選下方。</div>'; }
    else{ var c=payer.cache||{};
      w.innerHTML='<div class="bk-info"><b>'+esc(payer.name||"（未填姓名）")+'</b> '+payer.phone+
        (autoMatched?'<span class="bk-tag m" style="margin-left:6px">電話自動比對</span>':'')+
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
    var mats=bkAddonMats();
    /* 每一列各自組一次選項，選中的那項直接標 selected，不用事後再設值 */
    function optsFor(sel){
      var s='<option value=""'+(sel?"":" selected")+'>其他（不扣庫存）</option>';
      var lastCat=null;
      mats.forEach(function(m){
        if(m.cat!==lastCat){ if(lastCat!==null)s+="</optgroup>";
          s+='<optgroup label="'+esc(m.cat||"未分類")+'">'; lastCat=m.cat }
        s+='<option value="'+esc(m.id)+'"'+(String(sel)===String(m.id)?" selected":"")+'>'+
           esc(m.name)+(m.unit?"（"+esc(m.unit)+"）":"")+'</option>';
      });
      if(lastCat!==null)s+="</optgroup>";
      return s;
    }
    document.getElementById("ckAdd").innerHTML=addons.map(function(a,i){
      var isOther=!a.materialId;
      return '<div class="bk-addon">'+
        '<select class="am" data-i="'+i+'">'+optsFor(a.materialId)+'</select>'+
        (isOther
          ? '<input class="an" data-i="'+i+'" placeholder="品名" value="'+esc(a.name||"")+'">'
          : '<input class="aq" data-i="'+i+'" inputmode="numeric" placeholder="數量" value="'+(a.qty||1)+'">')+
        '<input class="av" data-i="'+i+'" inputmode="numeric" placeholder="金額" value="'+(a.amt||"")+'">'+
        '<select class="aw" data-i="'+i+'">'+PAYWAYS.map(function(p){
          return '<option value="'+p.k+'"'+(a.way===p.k?" selected":"")+
            (p.member&&!payer?" disabled":"")+'>'+p.n+'</option>' }).join("")+'</select>'+
        '<span class="ax" data-i="'+i+'">✕</span>'+
        (isOther?'<div class="bk-nodeduct">手打品名，不扣庫存</div>':"")+
        '</div>' }).join("");
    document.querySelectorAll("#ckAdd .am").forEach(function(el){ el.onchange=function(){
      var a=addons[+el.dataset.i];
      if(!el.value){ a.materialId=null; a.qty=0; }
      else{ var m=bkMatById(el.value);
        a.materialId=m?m.id:el.value; a.name=m?m.name:"";
        if(!(+a.qty>0))a.qty=1; }
      drawAddons(); calc() } });
    document.querySelectorAll("#ckAdd .an").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].name=el.value } });
    document.querySelectorAll("#ckAdd .aq").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].qty=+el.value||0 } });
    document.querySelectorAll("#ckAdd .av").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].amt=+el.value||0; calc() } });
    document.querySelectorAll("#ckAdd .aw").forEach(function(el){ el.onchange=function(){ addons[+el.dataset.i].way=el.value; calc() } });
    document.querySelectorAll("#ckAdd .ax").forEach(function(el){ el.onclick=function(){ addons.splice(+el.dataset.i,1); drawAddons(); calc() } });
    var w=document.getElementById("ckAddWarn");
    if(w)w.innerHTML=mats.length?"":
      '<div class="bk-warn">庫存盤點還沒有品項（顏料不列入加購），現在加價只能手打品名，不會扣庫存。</div>';
  }
  document.getElementById("ckAddNew").onclick=function(){
    addons.push({materialId:null,name:"",qty:0,amt:0,way:payer?"points":"cash"}); drawAddons(); calc() };

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

  function pplHint(){
    nAdult=+document.getElementById("ckAdult").value||0;
    nKid=+document.getElementById("ckKid").value||0;
    var s=nAdult+nKid, el=document.getElementById("ckPplHint");
    el.innerHTML = s===ppl
      ? "合計 "+s+" 位，與預約人數相同"
      : '<span class="bk-full">合計 '+s+' 位，預約時是 '+ppl+' 位，確認是否有變動</span>';
  }
  document.getElementById("ckAdult").oninput=pplHint;
  document.getElementById("ckKid").oninput=pplHint;
  pplHint();

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
  /* 預約單沒綁會員時，用客人填的電話回頭比對一次（主鍵就是電話） */
  var ownPhone=b.memberPhone||"";
  if(!ownPhone){
    ownPhone=await bkFindPhone(b.customer&&b.customer.phone);
    if(ownPhone)autoMatched=true;
  }
  await setPayer(ownPhone);
  if(old&&old.payerPhone&&old.payerPhone!==ownPhone){
    document.getElementById("ckProxy").checked=true;
    document.getElementById("ckProxy").dispatchEvent(new Event("change"));
    await setPayer(old.payerPhone);
  }

  document.getElementById("ckOK").onclick=async function(){
    calc(); pplHint();
    if(!(nAdult+nKid)){ alert("大人和小孩不能都是 0"); return }
    var t=document.getElementById("ckT").value;
    var cp=PAYWAYS.filter(function(p){return p.k===course.way})[0];
    if(!course.amt||!cp||!t){ alert("課程費用、付款方式、上課老師都要填"); return }
    if(cp.member&&!payer){ alert("這個付款方式需要先選會員"); return }
    addons=addons.filter(function(a){ return a.materialId||a.name||a.amt });
    for(var i=0;i<addons.length;i++){
      var ap=PAYWAYS.filter(function(p){return p.k===addons[i].way})[0];
      if(addons[i].materialId&&!(+addons[i].qty>0)){
        alert("加價項目「"+(addons[i].name||"未命名")+"」的數量要大於 0"); return }
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
      var addonTxt=addons.map(function(a){
        return (a.name||"未命名")+" $"+(+a.amt||0).toLocaleString() }).join("、");
      var log={date:b.date,month:dt.getMonth()+1,day:dt.getDate(),dept:"4F",
        customer:(b.customer&&b.customer.name)||"",phone:ownPhone||b.memberPhone||"",
        payerPhone:payer?payer.phone:"",teacher:t,
        people:nAdult+nKid,adults:nAdult,kids:nKid,
        courseAmt:course.amt,coursePay:course.way,
        addons:addons,addonTotal:addTotal,addonText:addonTxt,
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
      var patch={attend:"in",status:"done",adults:nAdult,kids:nKid,people:nAdult+nKid,
        checkout:{courseAmt:course.amt,coursePay:course.way,addons:addons,addonTotal:addTotal,
          addonText:addonTxt,total:total,byWay:byWay,usePoints:usePt,useSessions:useSe,bonus:bonus,
          adults:nAdult,kids:nKid,
          teacher:t,payerPhone:payer?payer.phone:"",summary:sumTxt,logId:logId,at:now}};
      /* 自動比對到的會員，順手綁回預約單，下次不用再找 */
      if(autoMatched&&ownPhone)patch.memberPhone=ownPhone;
      await bkPatch("/bookings/"+id+".json",patch);
      /* ── 扣材料庫存 ──
         先把這筆預約的舊耗用整筆撤掉（修正核銷會重跑一次），
         再依「課程用料」扣課程材料、依加購項目扣加購材料。兩段都寫進 autoUsed，
         庫存盤點當天就會反映，不用等週一。 */
      var invMsg="";
      try{
        if(typeof releaseInvAutoUse==="function")releaseInvAutoUse(id);
        var r1=(typeof consumeInvForBooking==="function")
          ?consumeInvForBooking(id,b.date,b.items||[]):{ok:[],miss:[]};
        var r2=(typeof consumeInvForAddons==="function")
          ?consumeInvForAddons(id,b.date,addons):{ok:[],skip:[]};
        if(typeof save==="function")save();
        if(r1&&r1.miss&&r1.miss.length)
          invMsg+="這些課還沒建材料表，沒扣料："+r1.miss.join("、")+"\n";
        if(r2&&r2.skip&&r2.skip.length)
          invMsg+="這些加購是手打品名，沒扣庫存："+r2.skip.join("、")+"\n";
      }catch(e){ invMsg+="材料扣帳出錯："+e.message+"\n" }
      if(typeof renderInventory==="function")try{ renderInventory() }catch(e){}
      bkClose(); bkRefresh();
      if(window.renderDaily)try{ renderDaily() }catch(e){}
      if(invMsg)alert(invMsg.trim());
    }catch(e){
      alert("核銷失敗："+e.message+"\n請重新整理後確認餘額是否已變動。");
      btn.disabled=false; btn.textContent="確認核銷";
    }
  };
}

/* ══ 作廢核銷 ══
   把整筆核銷退回「未核銷」：點數／堂數回補、紅利收回、每日登記那筆標作廢、
   材料庫存整筆撤掉。預約本身留著，不會消失，隨時可以重新核銷。
   ledger 用反向沖銷留軌跡，不刪舊紀錄。 */
async function bkVoid(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var c=b.checkout;
  if(!c){ alert("這筆還沒核銷，不用作廢。"); return }
  var lines=["確定作廢這筆核銷？","",
    b.date+"　"+esc(b.customer&&b.customer.name||"—")+"　$"+(+c.total||0).toLocaleString()];
  if(c.payerPhone){
    if(+c.usePoints)  lines.push("・回補點數 "+(+c.usePoints).toLocaleString());
    if(+c.useSessions)lines.push("・回補堂數 "+(+c.useSessions));
    if(+c.bonus)      lines.push("・收回紅利 "+(+c.bonus));
  }
  lines.push("・已扣的材料整筆退回庫存");
  lines.push("・每日登記那筆標成作廢，不再計入營收與人次");
  lines.push("","預約單會保留，可以重新核銷。");
  if(!confirm(lines.join("\n")))return;
  try{
    var now=new Date().toISOString();
    if(c.payerPhone){
      if(+c.usePoints){ await bkLedger(c.payerPhone,{type:"points",delta:+c.usePoints,
        reason:"核銷作廢",bookingId:id,by:"admin",at:now});
        await bkCache(c.payerPhone,"points",+c.usePoints) }
      if(+c.useSessions){ await bkLedger(c.payerPhone,{type:"sessions",delta:+c.useSessions,
        reason:"核銷作廢",bookingId:id,by:"admin",at:now});
        await bkCache(c.payerPhone,"sessions",+c.useSessions) }
      if(+c.bonus){ await bkLedger(c.payerPhone,{type:"bonus",delta:-c.bonus,
        reason:"核銷作廢",bookingId:id,by:"admin",at:now});
        await bkCache(c.payerPhone,"bonus",-c.bonus) }
    }
    if(c.logId)await fetch(salf("/deductions/"+c.logId+".json"),{method:"PATCH",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({voided:true,voidAt:now,voidReason:"作廢核銷"})});
    try{
      if(typeof releaseInvAutoUse==="function"){
        releaseInvAutoUse(id);
        if(typeof save==="function")save();
        if(typeof renderInventory==="function")renderInventory();
      }
    }catch(e){}
    await bkPatch("/bookings/"+id+".json",
      {status:"new",checkout:null,voidedCheckout:Object.assign({},c,{voidedAt:now})});
    /* 每日明細與月報讀的是存檔過的當日營收快照，不是 deductions，
       所以作廢之後要主動叫它重算，否則數字會一直停在原地 */
    if(typeof recalcDayRevenue==="function")await recalcDayRevenue(b.date);
    bkRefresh();
    if(window.renderDaily)try{ renderDaily() }catch(e){}
  }catch(e){
    alert("作廢失敗："+e.message+"\n請重新整理後確認餘額是否已變動。");
  }
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
   '<div class="bk-f2"><div class="bk-f"><label>大人 *</label>'+
       '<input id="mAdult" inputmode="numeric" value="1"></div>'+
     '<div class="bk-f"><label>小孩</label>'+
       '<input id="mKid" inputmode="numeric" value="0"></div>'+
     '<div class="bk-f"><label>金額</label><input id="mAmt" inputmode="numeric">'+
       '<div class="bk-left">選課程後自動帶入</div></div></div>'+
   '<input type="hidden" id="mPeople" value="1">'+
   '<div class="bk-f2"><div class="bk-f"><label>姓名 *</label><input id="mName"></div>'+
     '<div class="bk-f"><label>電話</label><input id="mPhone" inputmode="tel"></div></div>'+
   '<div class="bk-f"><label>備註</label><textarea id="mNote" rows="2" placeholder="例：想畫自己的貓"></textarea></div>'+
   '<div class="bk-f" id="mNotifyBox"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="mX">取消</button>'+
     '<button class="bk-save" id="mOK">登記</button></div>');
  document.getElementById("mX").onclick=bkClose;
  var picked=null, pickedUid=null;

  /* 時段 */
  var slotSel=document.getElementById("mSlot");
  slotSel.innerHTML=SLOTS.map(function(s){return "<option>"+s+"</option>"}).join("")+"<option>其他</option>";
  function showLeft(){
    var d=document.getElementById("mDate").value.replace(/-/g,"/");
    var sl=slotSel.value, el=document.getElementById("mLeft");
    if(sl==="其他"){ el.innerHTML=""; return }
    var s=bkSlotInfo(d,sl), ppl=+document.getElementById("mPeople").value||1;
    /* 實際人數永遠擺第一位。老師現場可能已自行超收，
       行政若只記得表定數字會再加上去，容易一路加到爆。 */
    var line='<span class="bk-cnt">目前已預約 <b>'+s.used+'</b> 位</span>';
    if(s.cap>0){
      line+='<span class="bk-cap">表定上限 '+s.cap+' 位</span>';
      if(s.left<0)        line+='<span class="bk-full">已超過表定 '+Math.abs(s.left)+' 位</span>';
      else if(s.left===0) line+='<span class="bk-full">已達表定上限，仍可加開</span>';
      else if(s.left<ppl) line+='<span class="bk-full">表定剩 '+s.left+' 位，這筆要 '+ppl+' 位</span>';
      else                line+='<span class="bk-ok">表定剩 '+s.left+' 位</span>';
    }else{
      line+='<span class="bk-cap">班表這天沒排老師，沒有表定上限</span>';
    }
    if(s.names.length)line+='<div class="bk-names">已約：'+s.names.map(esc).join("、")+'</div>';
    el.innerHTML=line;
  }
  slotSel.onchange=showLeft;
  document.getElementById("mDate").onchange=async function(){
    /* 換日期要重抓那天的預約才算得準 */
    var keep=bkDate; bkDate=new Date(this.value+"T00:00:00");
    await bkLoad(); bkDate=keep; showLeft();
  };
  function syncPpl(){
    var a=+document.getElementById("mAdult").value||0;
    var k=+document.getElementById("mKid").value||0;
    document.getElementById("mPeople").value=(a+k)||0;
    showLeft(); fillAmt();
  }
  document.getElementById("mAdult").oninput=syncPpl;
  document.getElementById("mKid").oninput=syncPpl;

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
      showNotify();
    } });
  };
  async function showNotify(){
    var box=document.getElementById("mNotifyBox");
    if(!picked){ box.innerHTML=""; pickedUid=null; return }
    var m=await bkMember(picked.phone);
    pickedUid=m&&m.lineUserId||null;
    box.innerHTML = pickedUid
      ? '<label style="display:flex;align-items:center;gap:7px;font-size:13px;color:#333">'+
        '<input type="checkbox" id="mNotify" checked style="width:16px;height:16px"> 登記後傳 LINE 通知給客人</label>'
      : '<div class="bk-left">這位會員還沒綁定 LINE，登記後不會收到通知。等他自己用線上預約一次就會自動綁定。</div>';
  }

  document.getElementById("mOK").onclick=async function(){
    var g=function(id){ return document.getElementById(id).value.trim() };
    var nA=+g("mAdult")||0, nK=+g("mKid")||0;
    document.getElementById("mPeople").value=nA+nK;
    if(!g("mName")||!(nA+nK)){ alert("姓名和人數必填"); return }
    var ppl=nA+nK, ci=cSel.value;
    var c=ci===""?null:bkCourses[+ci];
    var amt=+g("mAmt")||0;
    var d=g("mDate").replace(/-/g,"/"), sl=g("mSlot");
    if(sl!=="其他"){
      var si=bkSlotInfo(d,sl);
      if(si.cap>0&&si.left<ppl&&
         !confirm("這個時段目前已預約 "+si.used+" 位，表定上限 "+si.cap+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位，超過表定。\n確定要登記嗎？"))return;
      if(si.cap<=0&&si.used>0&&
         !confirm("這個時段班表沒排老師，目前已預約 "+si.used+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位。\n確定要登記嗎？"))return;
    }
    var rec={date:d,slot:sl,people:ppl,adults:nA,kids:nK,
      items:c?[{name:c.name,spec:c.spec,qty:ppl,price:c.price}]
             :(g("mNote")?[]:[]),
      total:amt,
      customer:{name:g("mName"),phone:g("mPhone"),note:g("mNote")},
      status:"new",source:"manual",ts:new Date().toISOString()};
    if(picked)rec.memberPhone=picked.phone;
    var wantNotify=document.getElementById("mNotify");
    if(pickedUid)rec.line={userId:pickedUid};
    var btn=this; btn.disabled=true; btn.textContent="登記中…";
    try{
      await fetch(bkf("/bookings.json"),{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(rec)});
      if(pickedUid&&wantNotify&&wantNotify.checked){
        fetch(NOTIFY+"/notify/booking",{method:"POST",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify(Object.assign({},rec,{
            total:amt,
            deposit:{method:"other",name:"由小編為你登記",amount:0}
          }))}).catch(function(){});
      }
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
"#bkRoot{--bkNavy:#1E2B4F;--bkGold:#C99A3B;--bkInk:#232936;--bkMute:#8A90A0;"+
  "--bkLine:#ECEEF2;--bkSoft:#F6F7F9;--bkOk:#12805C;--bkOkBg:#EAF6F1;--bkRed:#C9453B}"+
".bk-bar{display:flex;align-items:center;gap:8px;margin-bottom:18px}"+
".bk-nav{background:#fff;border:0;box-shadow:0 1px 2px rgba(16,24,40,.07);border-radius:10px;"+
  "width:38px;height:38px;font-size:17px;color:#5B6272;cursor:pointer;transition:.15s}"+
".bk-nav:hover{background:#F0F2F6}"+
".bk-tdy{font-size:13px;width:auto;padding:0 15px;color:var(--bkNavy);font-weight:600}"+
".bk-date{flex:1;text-align:center}"+
".bk-date b{font-size:19px;color:var(--bkInk);letter-spacing:.3px}"+
".bk-date span{font-size:12.5px;color:var(--bkMute);margin-left:6px}"+
".bk-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}"+
".bk-stat div{flex:1;min-width:84px;background:#fff;border:0;border-radius:14px;"+
  "padding:15px 10px;text-align:center;box-shadow:0 1px 3px rgba(16,24,40,.06)}"+
".bk-stat b{display:block;font-size:25px;font-weight:700;color:var(--bkNavy);line-height:1.15}"+
".bk-stat span{font-size:11.5px;color:var(--bkMute);margin-top:3px;display:block}"+
".bk-slot{margin-bottom:22px;border-radius:16px;padding:12px 12px 14px;"+
  "border-left:6px solid transparent}"+
".bk-slot.c0{background:#EDF1F8;border-left-color:#B4C4DC}"+
".bk-slot.c1{background:#FAF1E4;border-left-color:#E2C293}"+
".bk-sh{position:sticky;top:0;z-index:5;font-size:20px;font-weight:800;color:#1F2A44;"+
  "letter-spacing:.4px;margin:-12px -12px 6px;padding:12px 12px 12px 16px;"+
  "border:0;border-radius:16px 16px 0 0}"+
".bk-slot.c0>.bk-sh{background:#EDF1F8}"+
".bk-slot.c1>.bk-sh{background:#FAF1E4}"+
".bk-sh span{font-weight:500;letter-spacing:0;font-size:14px;color:#77809A}"+
".bk-card{background:#fff;border:0;border-radius:14px;padding:16px 17px;margin-top:10px;"+
  "box-shadow:0 1px 3px rgba(16,24,40,.06);transition:.15s}"+
".bk-card:hover{box-shadow:0 3px 10px rgba(16,24,40,.09)}"+
".bk-card.ok{background:#FBFDFC;box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 var(--bkOk)}"+
".bk-card.wait{box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 var(--bkGold)}"+
".bk-who b{font-size:16px;color:var(--bkInk);font-weight:600}"+
".bk-tag{display:inline-block;font-size:11px;padding:2.5px 9px;border-radius:99px;"+
  "margin-left:6px;vertical-align:1.5px;font-weight:500}"+
".bk-tag.m{background:#EDF1FA;color:#3A4C7A}"+
".bk-tag.w{background:#FDF4E3;color:#8A6400}"+
".bk-tag.s{background:#F2F3F6;color:#767C8B}"+
".bk-sub{font-size:13px;color:var(--bkMute);margin-top:5px;line-height:1.6}"+
".bk-note{font-size:12.5px;color:#8A6400;margin-top:5px}"+
".bk-done{margin-top:12px;background:var(--bkOkBg);padding:11px 13px;border-radius:10px}"+
".bk-dhead{font-size:12px;font-weight:700;color:var(--bkOk);letter-spacing:.6px;"+
  "margin-bottom:7px;display:flex;justify-content:space-between}"+
".bk-dhead span{font-weight:500;color:#4F7A6A}"+
".bk-dline{display:flex;justify-content:space-between;font-size:13px;color:#3F5A50;padding:2.5px 0}"+
".bk-dline b{color:#1B5E48;font-weight:600}"+
".bk-dline.tot{border-top:1px solid #CFE6DC;margin-top:5px;padding-top:6px;font-weight:600}"+
".bk-dline.tot b{font-size:15px;color:var(--bkOk)}"+
".bk-dpay{font-size:11.5px;color:#6B8C7F;margin-top:7px}"+
".bk-btns{display:flex;gap:7px;margin-top:13px;flex-wrap:wrap}"+
".bk-b{flex:1;min-width:70px;padding:9px 4px;font-size:13px;background:var(--bkSoft);"+
  "border:0;border-radius:9px;color:#5B6272;cursor:pointer;transition:.15s;font-family:inherit}"+
".bk-b:hover{background:#EBEDF2}"+
".bk-b.on{background:var(--bkNavy);color:#fff;font-weight:600}"+
".bk-b.no{background:#F2F3F6;color:#A8AEBC}"+
".bk-b.ck{background:#EDF1FA;color:#3A4C7A;font-weight:600}"+
".bk-b.ck:hover{background:#E1E8F6}"+
".bk-b.cx{background:#FBF0EF;color:var(--bkRed)}"+
".bk-b.cx:hover{background:#F7E4E2}"+
".bk-add{width:100%;margin-top:18px;padding:14px;background:var(--bkNavy);color:#fff;"+
  "border:0;border-radius:12px;font-size:14.5px;font-weight:600;cursor:pointer;"+
  "font-family:inherit;transition:.15s}"+
".bk-add:hover{background:#16223F}"+
".bk-empty{text-align:center;color:#A8AEBC;padding:44px 20px;font-size:13.5px}"+
".bk-mask{position:fixed;inset:0;background:rgba(24,30,45,.42);display:none;z-index:900;"+
  "align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}"+
".bk-mask.on{display:flex}"+
".bk-sheet{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;"+
  "border-radius:20px 20px 0 0;padding:24px 20px 30px;box-shadow:0 -6px 28px rgba(16,24,40,.16)}"+
".bk-sheet h3{font-size:19px;color:#232936;margin:0 0 4px;font-weight:600}"+
".bk-sh2{font-size:13px;color:#8A90A0;margin-bottom:18px}"+
".bk-f{margin-bottom:14px}.bk-f2{display:flex;gap:10px}.bk-f2 .bk-f{flex:1}"+
".bk-f label{display:block;font-size:12.5px;color:#8A90A0;margin-bottom:6px;font-weight:500}"+
".bk-f input,.bk-f select,.bk-f textarea,#ckFind,#mFind{width:100%;padding:11px 13px;"+
  "border:1px solid #E3E6EC;border-radius:10px;font-size:15px;font-family:inherit;"+
  "box-sizing:border-box;background:#FBFCFD;transition:.15s;color:#232936}"+
".bk-f input:focus,.bk-f select:focus,.bk-f textarea:focus,#ckFind:focus,#mFind:focus{"+
  "outline:0;border-color:#9FB0D6;background:#fff;box-shadow:0 0 0 3px rgba(62,86,145,.09)}"+
".bk-ways{display:flex;gap:8px;flex-wrap:wrap}"+
".bk-way{flex:1 1 30%;min-width:92px;text-align:center;padding:11px 5px;border:1px solid #E3E6EC;"+
  "border-radius:10px;background:#FBFCFD;font-size:13.5px;cursor:pointer;color:#5B6272;transition:.15s}"+
".bk-way:hover{border-color:#C3CCDF}"+
".bk-way.on{border-color:#3A4C7A;background:#EDF1FA;color:#1E2B4F;font-weight:600;"+
  "box-shadow:0 0 0 2px rgba(58,76,122,.1)}"+
".bk-way.dis{opacity:.3;pointer-events:none}"+
".bk-addon{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}"+
".bk-addon .am{flex:2 1 132px}.bk-addon .an{flex:2 1 108px}.bk-addon .aq{flex:0 1 60px}"+
".bk-addon .av{flex:1 1 70px}.bk-addon .aw{flex:1 1 88px}"+
".bk-addon input,.bk-addon select{padding:8px;border:1px solid #ddd;border-radius:7px;"+
  "font-size:13px;box-sizing:border-box;background:#fff;font-family:inherit}"+
".bk-nodeduct{flex-basis:100%;font-size:11.5px;color:#A8AEBC;margin:-3px 0 0 2px}"+
".bk-b.vd{background:#FDF4E3;color:#8A6400}"+
".bk-b.vd:hover{background:#F8EBD3}"+
".ax{color:#C9453B;cursor:pointer;padding:0 4px;font-size:15px}"+
".bk-mini{background:#fff;border:1px dashed #999;border-radius:7px;padding:7px 12px;font-size:12.5px;cursor:pointer;width:100%}"+
".bk-info{background:#EDF1FA;border:0;border-radius:12px;padding:13px 15px;margin-bottom:14px;"+
  "font-size:13.5px;color:#3A4C7A;line-height:1.7}"+
".bk-info b{color:#1E2B4F;font-weight:600}"+
".bk-warn{background:#FDF4E3;color:#8A6400;font-size:13px;padding:11px 13px;"+
  "border-radius:10px;margin:9px 0;line-height:1.6}"+
".bk-err{background:#FBEAE8;color:#C9453B;font-size:13px;padding:10px 12px;"+
  "border-radius:10px;margin-top:8px}"+
".bk-calc{font-size:13px;color:#6B7180;line-height:2;margin:14px 0;background:#F6F7F9;"+
  "padding:13px 15px;border-radius:12px}"+
".bk-calc b{color:#1E2B4F;font-size:15px;font-weight:600}"+
".bk-hit{padding:11px 13px;border:1px solid #E3E6EC;border-radius:10px;margin-top:7px;"+
  "background:#fff;cursor:pointer;transition:.15s}"+
".bk-hit:hover{background:#F6F7F9;border-color:#C3CCDF}"+
".bk-hit b{color:#232936}.bk-bal{font-size:12.5px;color:#8A90A0;margin-top:3px}"+
".bk-hint{font-size:13px;color:#A8AEBC;padding:10px 2px}"+
".bk-left{font-size:12.5px;color:#8A90A0;margin-top:5px;line-height:1.6}"+
".bk-names{font-size:12px;color:#A8AEBC;margin-top:4px}"+
".bk-ok{color:#12805C;font-weight:500}.bk-full{color:#C9453B;font-weight:600}"+
".bk-cnt{display:inline-block;font-size:14px;color:#1E2B4F;font-weight:600;margin-right:9px}"+
".bk-cnt b{font-size:19px;color:#1E2B4F;font-weight:700;vertical-align:-1px}"+
".bk-cap{display:inline-block;font-size:12.5px;color:#8A90A0;margin-right:8px}"+
".bk-act{display:flex;gap:10px;margin-top:22px}"+
".bk-cancel{flex:1;padding:14px;background:#F2F3F6;border:0;border-radius:12px;"+
  "font-size:14.5px;cursor:pointer;color:#5B6272;font-family:inherit;transition:.15s}"+
".bk-cancel:hover{background:#E7E9EE}"+
".bk-save{flex:2;padding:14px;background:#1E2B4F;color:#fff;border:0;border-radius:12px;"+
  "font-size:14.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}"+
".bk-save:hover{background:#16223F}"+
".bk-save:disabled{background:#A8AEBC;cursor:default}";
document.head.appendChild(css);

document.addEventListener("DOMContentLoaded",function(){ setTimeout(bkRender,400) });
})();
<div id="rc-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:900;overflow:auto;padding:20px 12px">
  <div class="card" style="max-width:560px;margin:0 auto"><div id="rc-modal-body"></div></div>
</div>

<div id="tab-daily" class="page">
  <div class="store-tabs">
    <button class="store-btn active" onclick="switchStore('daily','flagship',this)">旗艦店</button>
    <button class="store-btn" onclick="switchStore('daily','guotu',this)">國圖店</button>
  </div>
  <div id="daily-content"></div>
</div>

<div id="tab-member" class="page">
  <h2>會員與方案</h2>
  <p class="muted" style="font-size:12.5px;margin-bottom:12px">會員資料與客人端 LINE 預約共用同一份，這裡改完客人立刻看得到。餘額是消費明細加總，不是可以直接改的欄位。</p>
  <div id="member-body"></div>
</div>

<div id="mb-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:900;overflow:auto;padding:20px 12px">
  <div class="card" style="max-width:620px;margin:0 auto"><div id="mb-modal-body"></div></div>
</div>

<div id="tab-monthly" class="page">
  <div class="store-tabs">
    <button class="store-btn active" onclick="switchStore('monthly','flagship',this)">旗艦店</button>
    <button class="store-btn" onclick="switchStore('monthly','guotu',this)">國圖店</button>
  </div>
  <div id="monthly-content"></div>
</div>

<div id="tab-salary" class="page">
  <div class="store-tabs">
    <button class="store-btn active" onclick="switchStore('salary','flagship',this)">旗艦店</button>
    <button class="store-btn" onclick="switchStore('salary','guotu',this)">國圖店</button>
  </div>
  <div id="salary-content"></div>
</div>

<div id="tab-consumables" class="page">
  <!-- 耗材專用月份切換 -->
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
    <span style="font-size:12px;color:var(--text3)">查看月份</span>
    <select id="cm-selYear" onchange="renderConsumables()" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:13px;cursor:pointer;outline:none;font-family:inherit">
      <option value="2024">2024 年</option>
      <option value="2025">2025 年</option>
      <option value="2026" selected>2026 年</option>
      <option value="2027">2027 年</option>
    </select>
    <select id="cm-selMonth" onchange="renderConsumables()" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:13px;cursor:pointer;outline:none;font-family:inherit">
      <option value="01">1 月</option>
      <option value="02">2 月</option>
      <option value="03">3 月</option>
      <option value="04">4 月</option>
      <option value="05">5 月</option>
      <option value="06" selected>6 月</option>
      <option value="07">7 月</option>
      <option value="08">8 月</option>
      <option value="09">9 月</option>
      <option value="10">10 月</option>
      <option value="11">11 月</option>
      <option value="12">12 月</option>
    </select>
    <span style="font-size:12px;color:var(--gold2);font-weight:500" id="cm-month-total"></span>
  </div>

  <div class="store-tabs">
    <button class="store-btn active" onclick="switchStore('consumables','4f',this)">四樓</button>
    <button class="store-btn" onclick="switchStore('consumables','2f',this)">二樓</button>
    <button class="store-btn" onclick="switchStore('consumables','guotu',this)">國圖</button>
    <button class="store-btn" onclick="switchStore('consumables','hq',this)">總部</button>
    <button class="store-btn" onclick="switchStore('consumables','camp',this)" style="border-color:var(--green);color:var(--green)">🏕️ 營隊支出</button>
  </div>

  <!-- AI 照片辨識區塊 -->
  <div class="card" id="cm-ai-card">
    <div class="card-title">📷 上傳憑證照片（AI 自動辨識）</div>
    <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin-bottom:14px">
      <label for="cm-photo-input" style="display:inline-flex;align-items:center;gap:8px;background:var(--bg3);border:1px solid var(--border2);color:var(--text2);padding:10px 18px;border-radius:8px;cursor:pointer;font-size:13px;transition:all 0.15s" onmouseover="this.style.borderColor='var(--gold)';this.style.color='var(--gold)'" onmouseout="this.style.borderColor='var(--border2)';this.style.color='var(--text2)'">
        📎 選擇照片（可多張）
      </label>
      <input type="file" id="cm-photo-input" accept="image/*" multiple style="display:none" onchange="handleCMPhotos(this)">
      <span style="font-size:12px;color:var(--text3)">支援淘寶截圖、手寫請款單、任何收據</span>
    </div>
    <div id="cm-photo-preview" style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px"></div>
    <div id="cm-ai-status" style="display:none"></div>
    <div id="cm-ai-results" style="display:none">
      <div style="font-size:13px;color:var(--text2);margin-bottom:10px">✅ 辨識結果，確認後匯入：</div>
      <div id="cm-ai-rows"></div>
      <div style="display:flex;gap:10px;margin-top:14px">
        <button class="btn btn-gold" onclick="importAIResults()">⬇ 全部匯入</button>
        <button class="btn btn-outline" onclick="clearAIResults()">✕ 清除</button>
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title" id="cm-add-title">➕ 新增耗材支出</div>
    <div class="cm-add-grid">
      <div class="fg"><label>日期</label><input id="cm-date" type="date"></div>
      <div class="fg"><label>類別</label>
        <select id="cm-cat">
          <option value="顏料">🎨 顏料</option>
          <option value="畫布">🖼 畫布/畫板</option>
          <option value="紙張">📄 紙張/素描本</option>
          <option value="筆刷">🖌 筆刷/工具</option>
          <option value="樹脂">💎 樹脂/UV膠</option>
          <option value="溶劑">🧪 溶劑/調和油</option>
          <option value="包裝">📦 包裝材料</option>
          <option value="清潔">🧹 清潔用品</option>
          <option value="印刷">🖨 印刷/文件</option>
          <option value="其他">📌 其他</option>
        </select>
      </div>
      <div class="fg"><label>品項名稱</label><input id="cm-name" placeholder="例：白色壓克力顏料"></div>
      <div class="fg"><label>購買人員</label><input id="cm-buyer" list="cm-buyer-list" placeholder="例：大熊老師"></div>
      <div class="fg"><label>金額</label><input id="cm-amount" type="number" placeholder="0" min="0" onwheel="this.blur()"></div>
      <div class="fg"><label>購買來源</label>
        <select id="cm-source">
          <option value="實體店">實體店</option>
          <option value="蝦皮">蝦皮</option>
          <option value="淘寶">淘寶</option>
          <option value="拼多多">拼多多</option>
          <option value="PChome">PChome</option>
          <option value="Amazon">Amazon</option>
          <option value="其他網路">其他網路</option>
        </select>
      </div>
      <div class="fg"><label>用途/備註</label><input id="cm-note" placeholder="選填，例：水彩課消耗"></div>
    </div>
    <datalist id="cm-buyer-list"></datalist>
    <!-- 多筆明細區塊 -->
    <div style="margin-top:14px;margin-bottom:14px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
        <span style="font-size:13px;color:var(--text2)">📎 明細備註（選填，適合一張訂單含多種品項）</span>
        <button class="btn btn-outline btn-sm" onclick="addCMDetailRow()">＋ 新增明細行</button>
      </div>
      <div id="cm-detail-rows"></div>
    </div>
    <button class="btn btn-gold" onclick="addConsumable()">+ 記錄支出</button>
  </div>
  <div id="cm-stats-area"></div>
  <div class="card">
    <div class="card-title">👤 購買人彙整（點名字看明細，方便對帳撥款）</div>
    <div id="cm-buyer-summary-area"></div>
  </div>
  <div class="card">
    <div class="card-title">💰 零用金結餘登記</div>
    <div style="font-size:12px;color:var(--text3);margin-bottom:12px">本期結算後填寫「本期結餘」，下個月匯出時會自動帶入「上期餘額」。</div>
    <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap">
      <div style="font-size:13px;color:var(--text2)">上期餘額（自動帶入）：<span id="cm-opening-balance" class="auto-val">—</span></div>
      <div style="display:flex;align-items:center;gap:8px">
        <label style="font-size:12px;color:var(--text3)">本期結餘</label>
        <input id="cm-balance-input" type="number" class="in-num lg" placeholder="0" onwheel="this.blur()" onchange="setCMBalance(this.value)">
      </div>
    </div>
  </div>
  <div class="card">
    <div class="card-title" style="justify-content:space-between">
      <span>📋 本月明細</span>
      <button class="btn btn-outline btn-sm" onclick="dlConsumableExcel()">⬇ 匯出零用金支出明細表</button>
    </div>
    <div id="cm-debug" style="margin-bottom:10px;padding:6px 8px;background:var(--bg3);border-radius:6px"></div>
    <div id="cm-list-area"></div>
  </div>
</div>

<div id="tab-inventory" class="page">
  <div class="store-tabs">
    <button class="store-btn active" onclick="switchStore('inventory','flagship',this)">旗艦店</button>
    <button class="store-btn" onclick="switchStore('inventory','guotu',this)">國圖店</button>
  </div>

  <div class="info-box">
    📅 <b>週一順序：先盤點，再讓行政動系統。</b> 盤點填「本週盤點實際庫存」最準，有填就以它為準，「本週用掉」不會再重複扣一次（用掉量只拿去算消耗速度與建議訂購量）。<br>
    🚚 <b>材料中途到貨不用等下週一</b>，直接在上方「進貨登記」記一筆，左邊「目前庫存」立刻加上去，底下還會攤開給你看是怎麼算的。<br>
    📆 <b>進貨日期一律填「貨實際到的那天」</b>，不是填登記那天。行政週一補週六到的貨，日期就寫週六。<br>
    ↩️ 行政要補「上週用掉多少」，請先按上面的「← 上週」切到那一週再填，不要填在本週，否則消耗速度會整整晚一週。
  </div>

  <div id="inv-summary-bar"></div>

  <div id="inv-alert-area"></div>

  <div class="card">
    <div class="card-title" style="justify-content:space-between">
      <span>🚚 進貨登記（材料到貨當天就能記，不用等下週一盤點）</span>
      <button class="btn-sm btn-outline" onclick="toggleInvRestockLog()"><span id="inv-restock-toggle-label">隱藏進貨明細</span></button>
    </div>
    <div class="form-grid">
      <div class="fg"><label>品項</label>
        <select id="inv-restock-item"></select>
      </div>
      <div class="fg"><label>進貨日期</label>
        <input id="inv-restock-date" type="date">
      </div>
      <div class="fg"><label>進貨數量</label>
        <input id="inv-restock-qty" type="number" min="0" step="any" placeholder="例：12" onwheel="this.blur()">
      </div>
      <div class="fg"><label>備註（選填）</label>
        <input id="inv-restock-note" placeholder="例：廠商A / 訂單編號">
      </div>
    </div>
    <button class="btn btn-gold" onclick="submitInvRestock()">+ 登記進貨</button>
    <span id="inv-restock-hint" style="font-size:12px;color:var(--text3);margin-left:10px"></span>
    <div id="inv-restock-log" style="margin-top:16px"></div>
  </div>

  <div class="card">
    <div class="card-title" style="justify-content:space-between">
      <span>📋 批次登記（貼上文字 / 上傳截圖，一次處理多筆）</span>
      <button class="btn-sm btn-outline" onclick="toggleBatchRestockBox()"><span id="batch-restock-toggle-label">展開</span></button>
    </div>
    <div id="batch-restock-box" style="display:none">
      <div class="info-box">
        貼上像 LINE 對話那種一整段訂貨明細（例如「4F-20張」「30P-3張」），或上傳截圖讓系統嘗試自動辨識文字。<br>
        ⚠️ 截圖辨識用的是瀏覽器端 OCR，中文小字辨識不一定 100% 準確，辨識完一定會先讓你檢查、修改，確認無誤才會送出，不會自動寫入庫存。
      </div>
      <div class="form-grid" style="grid-template-columns:1fr">
        <div class="fg">
          <label>📷 上傳截圖（自動辨識文字到下方文字框，僅供參考）</label>
          <input type="file" id="batch-restock-img" accept="image/*" onchange="handleBatchRestockImage(event)">
          <div id="batch-ocr-status" style="font-size:12px;color:var(--text3);margin-top:6px"></div>
        </div>
      </div>
      <div class="fg">
        <label>📝 貼上文字（每行一項，例：4F-20張）</label>
        <textarea id="batch-restock-text" rows="6" style="width:100%;background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:7px;font-size:13px;outline:none;font-family:inherit;resize:vertical" placeholder="60*30厚3,木框要五個&#10;4F-20張&#10;30F-3張&#10;30P-3張"></textarea>
      </div>
      <div style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <button class="btn btn-gold" onclick="parseBatchRestockText()">🔍 解析文字</button>
        <div class="fg" style="margin:0">
          <input id="batch-restock-date" type="date" style="width:auto">
        </div>
        <span class="muted">↑ 這個日期會套用到下方所有解析出來的項目（可個別調整）</span>
      </div>
      <div id="batch-restock-preview" style="margin-top:16px"></div>
    </div>
  </div>

  <div class="card">
    <div class="card-title" style="justify-content:space-between">
      <span>📝 本週盤點（<span id="inv-week-label"></span>）</span>
      <div style="display:flex;gap:8px;align-items:center">
        <button class="btn-sm btn-outline" onclick="invShiftWeek(-1)">← 上週</button>
        <button class="btn-sm btn-outline" onclick="invShiftWeek(1)">下週 →</button>
        <button class="btn-sm btn-outline" onclick="invGoToday()">回到本週</button>
      </div>
    </div>
    <div id="inv-week-table"></div>
    <div id="inv-save-bar" style="position:sticky;bottom:0;z-index:100;background:rgba(20,20,20,0.95);border-top:1px solid var(--gold);padding:12px 20px;display:flex;gap:10px;align-items:center;margin:0 -22px -20px -22px;border-radius:0 0 12px 12px">
      <button class="btn btn-gold" onclick="saveInvWeek()">💾 儲存本週盤點</button>
      <button class="btn btn-outline btn-sm" onclick="printInvBlankSheet()">🖨 印空白表</button>
      <label class="btn btn-outline btn-sm" for="inv-count-photo" style="display:inline-flex;align-items:center;cursor:pointer">📷 上傳盤點照片</label>
      <input id="inv-count-photo" type="file" accept="image/*" style="display:none" onchange="handleInvCountPhoto(event)">
      <button class="btn btn-del btn-sm" onclick="clearInvWeek()">🗑 清除本週盤點</button>
      <span id="inv-save-hint" style="font-size:12px;color:var(--text3)"></span>
      <div style="flex:1"></div>
      <button class="btn btn-outline" onclick="openInvItemModal()">⚙️ 管理品項清單</button>
    </div>
    <div id="inv-count-ocr-area" style="margin-top:16px"></div>
  </div>

  <div class="card" id="inv-item-modal" style="display:none">
    <div class="card-title" style="justify-content:space-between">
      <span>⚙️ 品項清單管理（<span id="inv-modal-store"></span>）</span>
      <button class="btn-sm btn-outline" onclick="closeInvItemModal()">✕ 關閉</button>
    </div>
    <div class="form-grid">
      <div class="fg"><label>類別</label>
        <select id="inv-new-cat">
          <option value="畫布">🖼 畫布(F/P號)</option>
          <option value="框木板">🪞 框/木板</option>
          <option value="飾品配件">⏰ 飾品配件</option>
          <option value="顏料">🎨 顏料</option>
          <option value="紙張">📄 紙張/素描本</option>
          <option value="筆刷">🖌 筆刷/工具</option>
          <option value="樹脂">💎 樹脂/UV膠</option>
          <option value="溶劑">🧪 溶劑/調和油</option>
          <option value="包裝">📦 包裝材料</option>
          <option value="清潔">🧹 清潔用品</option>
          <option value="印刷">🖨 印刷/文件</option>
          <option value="其他">📌 其他</option>
        </select>
      </div>
      <div class="fg"><label>品項名稱</label><input id="inv-new-name" placeholder="例：白色壓克力顏料"></div>
      <div class="fg"><label>單位</label><input id="inv-new-unit" placeholder="例：瓶、包、捲、張" value="個"></div>
      <div class="fg"><label>安全庫存量</label><input id="inv-new-safe" type="number" min="0" placeholder="低於此數警示" onwheel="this.blur()"></div>
      <div class="fg"><label>單位成本</label><input id="inv-new-cost" type="number" min="0" step="any" placeholder="一個多少錢" onwheel="this.blur()"></div>
    </div>
    <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <button class="btn btn-gold" onclick="addInvItem()">+ 新增品項</button>
      <button class="btn btn-outline" onclick="batchImportItems()">📥 匯入預設品項清單</button>
      <button class="btn btn-outline" onclick="copyFlagshipItemsToGuotu()">📋 從旗艦店複製品項清單到國圖店</button>
      <div style="flex:1"></div>
      <button class="btn-sm" style="background:transparent;border:1px solid rgba(201,168,76,0.4);color:var(--gold2)" onclick="applyPaintJarPhotos()">📸 套用顏料罐照片（依編號）</button>
      <button class="btn-sm" style="background:transparent;border:1px solid rgba(224,85,85,0.4);color:var(--red)" onclick="resetInvStoreData()">🗑️ 重置本店庫存資料</button>
    </div>
    <div style="margin-top:16px" id="inv-item-list"></div>
  </div>

  <div class="card">
    <div class="card-title" style="justify-content:space-between">
      <span>📊 庫存統計與消耗趨勢</span>
      <button class="btn btn-outline btn-sm" onclick="dlInventoryExcel()">⬇ 匯出 Excel</button>
    </div>
    <div id="inv-stats-area"></div>
  </div>
</div>

<div id="tab-settings" class="page">
  <div id="staff-body"></div>
  <div class="card">
    <div class="card-title">新增老師</div>
    <div class="form-grid">
      <div class="fg"><label>姓名／暱稱</label><input id="f-name" placeholder="例：蓁蓁"></div>
      <div class="fg"><label>所屬分店</label>
        <select id="f-store">
          <option value="flagship">旗艦店</option>
          <option value="guotu">國圖店</option>
          <option value="flagship_cross">旗艦跨部門</option>
        </select>
      </div>
      <div class="fg"><label>職別</label>
        <select id="f-type"><option value="full">正職</option><option value="part">兼職</option></select>
      </div>
      <div class="fg"><label>職位</label>
        <select id="f-role">
          <option value="teacher">老師</option>
          <option value="admin">行政</option>
          <option value="sales">業務</option>
        </select>
      </div>
      <div class="fg"><label>全薪／時薪（元）</label><input id="f-base" type="number" placeholder="正職全薪，兼職時薪" onwheel="this.blur()"></div>
      <div class="fg"><label>人次計算方式</label>
        <select id="f-mode">
          <option value="full">完整（每人次×50）</option>
          <option value="over">超過門檻才計算</option>
          <option value="half">個人人次÷2（大熊用）</option>
          <option value="minni">兼職特殊公式（米妮用）</option>
        </select>
      </div>
      <div class="fg"><label>基礎人次門檻</label><input id="f-threshold" type="number" placeholder="例：20" onwheel="this.blur()"></div>
      <div class="fg"><label>行政績效—旗艦（元）</label><input id="f-adminF" type="number" placeholder="0" onwheel="this.blur()"></div>
      <div class="fg"><label>行政績效—國圖（元）</label><input id="f-adminG" type="number" placeholder="0" onwheel="this.blur()"></div>
      <div class="fg"><label>講師費倍率</label><input id="f-lecRate" type="number" placeholder="預設1，減半填0.5" step="0.1" min="0" max="1" onwheel="this.blur()"></div>
      <div class="fg"><label>備註</label><input id="f-note" placeholder="選填"></div>
    </div>
    <button class="btn btn-gold" onclick="addTeacher()">+ 新增老師</button>
  </div>
  <div class="card">
    <div class="card-title">目前老師列表</div>
    <div id="teacher-list"></div>
  </div>
</div>

<script src="auth.js?v=20260805p"></script>
<script src="app.js?v=20260805p"></script>
<script src="consumables.js?v=20260805p"></script>
<script src="inventory.js?v=20260805p"></script>
<script src="booking.js?v=20260805q"></script>
<script src="member.js?v=20260805p"></script>
<script src="recipe.js?v=20260805p"></script>
<script src="init.js?v=20260805p"></script>
<script src="staff.js?v=20260805p"></script>
<script>
/* 手機上點完分頁就把側欄收起來，不然選單會一直擋住內容 */
document.querySelectorAll('.tabs .tab').forEach(function(el){
  el.addEventListener('click', function(){ document.body.classList.remove('side-open') });
});
</script>
</body>
</html>
