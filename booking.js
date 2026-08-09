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
/* ══ 晚上時段（2026-08-10）══════════════════════════════
   晚上不是每天都開，週一固定、其他時候看情況加開。所以它不是
   第四個固定時段，而是「那天有排才存在」。

   班表原本一天只存一個數字（老師數），三個時段共用。要讓晚上
   能單獨開關又不影響白天，那個位置改成也能放物件：

     3                → 白天 3 位、晚上不開（舊資料長這樣）
     { t:3, ev:1 }    → 白天 3 位、晚上 1 位

   舊的純數字照樣讀得懂，不用回頭改任何一天的班表。

   晚上的老師數獨立算容量——白天排 3 位不代表晚上也有 3 位，
   共用的話晚上會顯示可收 15 人，實際只有一位老師在。 */
var EVE_SLOT = "18:30-21:00";
/* 手動登記可以選的時段比表定多。SLOTS 拿來算表定容量，不能亂加，
   所以額外開一份給下拉選單用。半點開始的那幾個是現場常見的加開。 */
var SLOTS_MANUAL = ["09:30-11:30","10:00-12:00","10:30-12:30",
                    "13:30-15:30","14:00-16:00","14:30-16:30",
                    "15:00-17:00","15:30-17:30","16:00-18:00","16:30-18:30",
                    "18:30-21:00","19:00-21:00"];
/* 加開時段歸到哪個表定時段底下。老師是照表定三個時段排的，
   9:30 進來的人一樣佔用 10:00 那一場的老師，所以人數要算在一起，
   不然表定剩幾位會算錯，一路加到爆。 */
var SLOT_BASE = {
  "09:30-11:30":"10:00-12:00","09:30-12:00":"10:00-12:00",
  "10:00-12:00":"10:00-12:00","10:30-12:30":"10:00-12:00",
  "13:30-15:30":"14:00-16:00","14:00-16:00":"14:00-16:00","14:30-16:30":"14:00-16:00",
  "15:00-17:00":"16:00-18:00","15:30-17:30":"16:00-18:00",
  "16:00-18:00":"16:00-18:00","16:30-18:30":"16:00-18:00",
  "18:30-21:00":"18:30-21:00","19:00-21:00":"18:30-21:00"
};
/* 這個時段算在哪一場。對不到就回空字串，歸「其他」 */
function bkBase(sl){ return SLOT_BASE[String(sl||"").trim()] || "" }
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
  {k:"transfer",n:"匯款",     member:false},
  /* 文化幣是政府核銷，錢不是當下進帳戶。業績照算，
     現金流那邊會獨立列在「應收」，不混進當日總收款 */
  {k:"culture", n:"文化幣",   member:false}
];
var bkf  = function(p){ return BK_URL.replace(/\/$/,"")+p };
/* 會員以電話為主鍵，+886 開頭要轉回 0 才找得到 */
function mbPhone(p){
  var d=String(p==null?"":p).replace(/\D/g,"");
  if(d.indexOf("886")===0)d="0"+d.slice(3);
  return d;
}
/* ── 訂金 ──────────────────────────────────────────────
   客人在 LIFF 預約時就選好方式了，金額固定 900，
   所以行政只要按一顆「已收」，不用再打一次金額和方式。
   收款日期預設今天，但要能改——客人昨天匯、今天才確認很常見，
   現金流必須記在錢真的進來那一天。

   儲值金扣點不是收現金，不進現金流，核銷時照常扣點，
   所以那條路線不顯示按鈕，只標示狀態。
   ───────────────────────────────────────────────────── */
var DEPOSIT_AMT = 900;
function bkDepWay(m){
  var s=String(m||"").toLowerCase();
  if(s.indexOf("point")>=0||s.indexOf("儲值")>=0||s.indexOf("扣點")>=0)return "points";
  if(s.indexOf("line")>=0)return "linepay";
  if(s.indexOf("transfer")>=0||s.indexOf("bank")>=0||s.indexOf("匯")>=0)return "transfer";
  if(s.indexOf("cash")>=0||s.indexOf("現金")>=0)return "cash";
  if(s.indexOf("card")>=0||s.indexOf("刷")>=0)return "card";
  return "";
}
function bkWayName(k){
  var p=PAYWAYS.filter(function(x){return x.k===k})[0];
  return p?p.n:"未指定";
}
/* 訂金狀態：none（不用收）／points（預扣點數）／wait（待收）／paid（已收） */
function bkDepState(b){
  var d=b&&b.deposit;
  if(!d)return {s:"none"};
  var w=bkDepWay(d.method||d.name);
  /* 現場登記寫的是 method:"other"、amount:0，那種不用收訂金 */
  if(!w&&!(+d.amount>0)&&d.status!=="paid")return {s:"none"};
  if(w==="points")return {s:"points"};
  var amt=(+d.amount>0)?+d.amount:DEPOSIT_AMT;
  if(d.status==="paid")
    return {s:"paid",way:bkDepWay(d.paidWay)||w,amt:amt,date:d.paidDate||"",by:d.by||""};
  return {s:"wait",way:w,amt:amt};
}
/* 已收多少訂金可以在核銷時扣抵。預扣點數那條不算，它走點數流程 */
function bkDepPaid(b){
  var d=bkDepState(b);
  return d.s==="paid"?(+d.amt||0):0;
}
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
/* 品項的售價。沒設定就回 null，核銷那邊維持手動填寫的老行為。 */
function bkMatPrice(m){
  if(!m)return null;
  var v=m.price;
  if(v==null||v==="")return null;
  v=+v;
  return isNaN(v)?null:v;
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
var CAP_PER_TEACHER = 5;          /* 每位老師可帶人數 */
var SEAT_CAP        = 13;         /* 單一時段人數天花板 */
/* 沒特別指定時，每個星期幾的預設可開課老師數（跟預約後台一致） */
var BK_BASE_WEEK = {0:0,1:2,2:2,3:2,4:2,5:2,6:3};
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
async function bkLoadSched(force){
  if(bkSched&&!force)return;
  var m={};
  /* 1) 試算表「班表」當底（第 3 欄是老師數） */
  try{
    var rows=await bkGviz("班表");
    if(rows.length&&/日期|週/.test(String(rows[0][0])))rows.shift();
    rows.forEach(function(r){
      var d=String(r[0]||"").trim().replace(/-/g,"/");
      var v=String(r[2]==null?"":r[2]).trim();
      if(d&&v!=="")m[d]=Math.max(0,bkNum(v));
    });
  }catch(e){}
  /* 2) Firebase /schedule 蓋過去（預約後台按 ＋／− 存的就是這裡）
        值可能是數字（舊）或 {t,ev}（含晚上），兩種都原封不動收下，
        要用的時候再交給 bkSchedVal 正規化。 */
  try{
    var j=await (await fetch(bkf("/schedule.json"))).json();
    if(j)for(var k in j){
      var v2=j[k];
      if(v2===null||v2===undefined||v2==="")continue;
      m[String(k).replace(/-/g,"/")]=
        (typeof v2==="object")?{t:Math.max(0,+v2.t||0),ev:Math.max(0,+v2.ev||0)}
                              :Math.max(0,+v2||0);
    }
  }catch(e){}
  bkSched=m;
}
/* 班表的值 → {t, ev}。數字就是舊格式，晚上一律當沒開。 */
function bkSchedVal(d){
  var v=bkSched?bkSched[d]:null;
  if(v==null)return null;
  if(typeof v==="object")return {t:Math.max(0,+v.t||0),ev:Math.max(0,+v.ev||0)};
  return {t:Math.max(0,+v||0),ev:0};
}
/* 沒特別指定的日子，看星期幾 */
function bkBaseOn(d){
  var p=String(d).split("/").map(Number);
  var w=new Date(p[0],p[1]-1,p[2]).getDay();
  return BK_BASE_WEEK[w]==null?1:BK_BASE_WEEK[w];
}
function bkTeachersOn(d){
  var v=bkSchedVal(d);
  return v?v.t:bkBaseOn(d);
}
/* 晚上有幾位老師。沒排就是 0，代表那天晚上不開。 */
function bkEveOn(d){ var v=bkSchedVal(d); return v?v.ev:0 }
function bkCapOf(d){ return Math.min(bkTeachersOn(d)*CAP_PER_TEACHER,SEAT_CAP) }
function bkEveCap(d){ return Math.min(bkEveOn(d)*CAP_PER_TEACHER,SEAT_CAP) }
/* 這一天實際存在的時段。晚上有排才會多一格。 */
function bkSlotsOn(d){ return bkEveOn(d)>0?SLOTS.concat([EVE_SLOT]):SLOTS.slice() }
/* 某個時段的容量。晚上走晚上的老師數，白天走白天的。 */
function bkCapOfSlot(d,slot){ return slot===EVE_SLOT?bkEveCap(d):bkCapOf(d) }
/* 改老師數：先改本地讓畫面立刻反應，再寫回 Firebase */
async function bkSetTeachers(dateStr,val){
  /* val 是數字＝只改白天，晚上維持原樣；null＝恢復預設 */
  if(!bkSched)bkSched={};
  if(val===null){ delete bkSched[dateStr] }
  else{
    var ev=bkEveOn(dateStr);
    bkSched[dateStr]= ev>0 ? {t:Math.max(0,+val||0),ev:ev} : Math.max(0,+val||0);
  }
  await bkSchedWrite(dateStr,val===null?null:bkSched[dateStr]);
}
/* 只改晚上，白天不動 */
async function bkSetEve(dateStr,ev){
  if(!bkSched)bkSched={};
  var t=bkTeachersOn(dateStr);
  ev=Math.max(0,+ev||0);
  /* 晚上關掉、白天又是星期預設值 → 整筆刪掉，格子回到「未指定」 */
  if(ev===0&&t===bkBaseOn(dateStr)&&bkSchedVal(dateStr)){
    delete bkSched[dateStr];
    await bkSchedWrite(dateStr,null);
    return;
  }
  bkSched[dateStr]= ev>0 ? {t:t,ev:ev} : t;
  await bkSchedWrite(dateStr,bkSched[dateStr]);
}
async function bkSchedWrite(dateStr,val){
  var path=bkf("/schedule/"+dateStr.replace(/\//g,"-")+".json");
  try{
    if(val===null)await fetch(path,{method:"DELETE"});
    else await fetch(path,{method:"PUT",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(val)});
  }catch(e){ alert("班表儲存失敗，請檢查網路連線") }
}
/* 那個時段還剩幾位 */
function bkSlotInfo(dateStr,slot){
  var cap=bkCapOfSlot(dateStr,slot);
  var rows=bkList.filter(function(b){
    return b.date===dateStr&&
      (bkBase(b.slot)===slot||bkBase(b.slot2)===slot||b.slot===slot||b.slot2===slot)&&
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
  /* 改成跟 Railway 要，理由同 member.js（2026-08-09） */
  var j=await staffMembers(false)||{};
  bkMembers=Object.keys(j).map(function(p){ var m=j[p]||{}; var c=m.cache||{};
    return {phone:p,name:m.name||"",points:+c.points||0,sessions:+c.sessions||0,bonus:+c.bonus||0} });
  bkIndex={};
  bkMembers.forEach(function(m){ var k=bkNorm(m.phone); if(k)bkIndex[k]=m.phone });
}
/* 只抓會員電話清單（shallow），不抓 ledger，畫面用這個判斷是不是會員 */
async function bkLoadIndex(){
  if(bkIndexReady)return;
  var j=await staffMembers(true)||{};
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
/* 一堂課值多少錢。堂數方案的單價各不相同——
   30 堂 30,000 是一堂 1,000、70 堂 60,000 是一堂約 857，
   所以要看這位客人當初買的是哪一個方案，用買的金額除以堂數。
   回傳 null 代表算不出來（舊資料匯入的沒有購買紀錄）。 */
/* ══ 夯客舊票券的方案單價對照表 ════════════════════════
   從夯客校正進來的堂數，明細裡只有堂數沒有金額。核銷時
   算不出「這一堂認列多少」，就會退而用當天的課程牌價
   （例如 1,300）當業績——對散客沒錯，對方案客人完全錯，
   人家那一堂是一次買斷攤下來的。

   夯客沒有給購買日期，但給了到期日，而效期是固定的，
   所以「到期日 − 效期」就推得出購買日，價格改版才分得開。
   高階30堂 2026 年 3 月改版：三月前 28,500、三月起 30,000。

   這張表只服務夯客帶進來的舊票券。以後在系統裡賣的方案，
   明細本來就會寫 price，走上面那條原本的路，不會進到這裡。
   ═════════════════════════════════════════════════════ */
var BK_TKT_PLAN = [
  { name:"高階30堂",      months:12, mult:1,
    rules:[ { from:"2026-03-01", qty:30, price:30000 },
            {                    qty:30, price:28500 } ] },
  { name:"高階30堂(0.5)", months:12, mult:0.5,
    rules:[ { from:"2026-03-01", qty:30, price:30000 },
            {                    qty:30, price:28500 } ] },
  { name:"高階45堂",      months:15, mult:1,
    rules:[ { qty:45, price:40500 } ] },
  { name:"高階70堂",      months:24, mult:1,
    rules:[ { qty:70, price:60000 } ] },
  { name:"高階70堂(0.5)", months:24, mult:0.5,
    rules:[ { qty:70, price:60000 } ] }
];

/* 到期日往回推效期＝推估購買日。曾經展延過效期的人會偏後，
   所以顯示的時候一定要標「推估」，不要讓人以為是夯客給的。 */
function bkTktBuyDate(expiry, months){
  if(!expiry||!months)return "";
  var p=String(expiry).split("-");
  if(p.length<3)return "";
  var d=new Date(+p[0],+p[1]-1,+p[2]);
  d.setMonth(d.getMonth()-months);
  var z=function(n){ return String(n).padStart(2,"0") };
  return d.getFullYear()+"-"+z(d.getMonth()+1)+"-"+z(d.getDate());
}
function bkTktPlanOf(name){
  for(var i=0;i<BK_TKT_PLAN.length;i++)
    if(BK_TKT_PLAN[i].name===name)return BK_TKT_PLAN[i];
  return null;
}
/* 一個人可能有好幾張票券，取到期日最晚的那張——那是最近買的，
   最能代表他現在手上的堂數是什麼價。 */
function bkTktUnit(m){
  var ts=(m&&Array.isArray(m.tickets))?m.tickets:[];
  var best=null, bestPlan=null;
  ts.forEach(function(t){
    if(!t||t.kind!=="session")return;
    var pl=bkTktPlanOf(t.name); if(!pl)return;
    if(!best||String(t.expiry||"")>String(best.expiry||"")){ best=t; bestPlan=pl }
  });
  if(!best)return null;
  var buy=bkTktBuyDate(best.expiry,bestPlan.months);
  var rule=null;
  for(var i=0;i<bestPlan.rules.length;i++){
    var r=bestPlan.rules[i];
    if(!r.from){ rule=r; break }
    if(buy&&buy>=r.from){ rule=r; break }
  }
  if(!rule)return null;
  return { unit:Math.round(rule.price/rule.qty*(bestPlan.mult||1)),
           plan:best.name, qty:rule.qty, price:rule.price,
           buy:buy, fromTicket:true };
}
/* 有票券但表上查不到價的，至少把方案名稱講出來，
   別只丟一句「查不到」讓人不知道要去補什麼。 */
function bkTktNameOnly(m){
  var ts=(m&&Array.isArray(m.tickets))?m.tickets:[];
  for(var i=0;i<ts.length;i++)
    if(ts[i]&&ts[i].kind==="session")return ts[i].name||"";
  return "";
}

function bkSessionUnit(m){
  var l=(m&&m.ledger)||{}, best=null;
  Object.keys(l).forEach(function(k){
    var r=l[k];
    if(!r||r.type!=="sessions")return;
    var d=+r.delta||0, p=+r.price||0;
    if(d<=0||p<=0)return;                    /* 消耗掉的那些是負的，跳過 */
    if(!best||String(r.at||"")>String(best.at||""))best=r;
  });
  if(!best)return bkTktUnit(m);      /* 明細沒金額，改用夯客票券的方案對照表 */
  return {unit:Math.round((+best.price)/(+best.delta)),
          plan:best.planName||"",qty:+best.delta,price:+best.price};
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
    await bkLoad(); await bkLoadIndex(); await bkLoadSched(); bkBusy=false; }
  var d=bkDate, today=ds(new Date())===ds(d);
  var dsNow=ds(d);
  var tOn=bkTeachersOn(dsNow), tSet=!!(bkSched&&bkSched[dsNow]!=null);
  var totalPeople=bkList.reduce(function(s,b){return s+(+b.people||0)},0);
  var doneCount=bkList.filter(function(b){return b.checkout}).length;
  var sum=bkList.reduce(function(s,b){return s+(b.checkout?(+b.checkout.total||0):0)},0);
  var totKid=bkList.reduce(function(s,b){ var x=bkAK(b); return s+(+x.k||0) },0);
  var pplSub=totKid?"含小孩 "+totKid:"";
  /* 有沒有哪個時段爆掉 */
  var capNow=bkCapOf(dsNow);
  var slotsNow=bkSlotsOn(dsNow), eveNow=bkEveOn(dsNow);
  var over=slotsNow.filter(function(s){
    return bkSlotInfo(dsNow,s).used>bkCapOfSlot(dsNow,s) });

  root.innerHTML=
   '<div class="bk-bar">'+
     '<button class="bk-nav" id="bkPrev">‹</button>'+
     '<div class="bk-date"><b>'+ds(d)+'</b><span>（'+WD[d.getDay()]+'）'+(today?" · 今天":"")+'</span></div>'+
     '<button class="bk-nav" id="bkNext">›</button>'+
     '<button class="bk-nav bk-tdy" id="bkToday">今天</button>'+
   '</div>'+
   '<div class="bk-stat">'+
     '<div class="bk-tcard"><b>'+
       '<button class="bk-tbtn" id="bkTMinus">−</button>'+
       '<span class="bk-tnum">'+tOn+'</span>'+
       '<button class="bk-tbtn" id="bkTPlus">＋</button></b>'+
       '<span>可開課老師・'+(tSet?"已指定":"預設")+
         (eveNow?'<br>晚上 '+eveNow+' 位':'')+'</span></div>'+
     '<div><b>'+bkList.length+'</b><span>預約組數</span></div>'+
     '<div><b>'+totalPeople+'</b><span>總人數'+(pplSub?"・"+pplSub:"")+'</span></div>'+
     '<div><b>'+doneCount+'/'+bkList.length+'</b><span>已核銷</span></div>'+
     '<div><b>$'+sum.toLocaleString()+'</b><span>本日核銷金額</span></div>'+
   '</div>'+
   (over.length?'<div class="bk-over">⚠️ '+over.join("、")+
     ' 超過表定上限（每時段 '+capNow+' 位），請確認人手。</div>':"")+
   '<button class="bk-add bk-add-top" id="bkAdd">＋ 手動登記</button>'+
   (function(){ var ci=0;
    /* 晚上沒排的日子，就算有人被登記到晚上時段也要看得到——
       所以這裡用「當天時段 ∪ 實際有預約的時段」，不會有預約被藏起來。 */
    var show=slotsNow.slice();
    if(show.indexOf(EVE_SLOT)<0&&bkList.some(function(b){
      return bkBase(b.slot)===EVE_SLOT||bkBase(b.slot2)===EVE_SLOT }))show.push(EVE_SLOT);
    return show.concat(["其他"]).map(function(sl){
      var g=bkList.filter(function(b){
        return sl==="其他"
          ? (!bkBase(b.slot)&&SLOTS.indexOf(b.slot)<0&&b.slot!==EVE_SLOT)
          : (bkBase(b.slot)===sl||bkBase(b.slot2)===sl||b.slot===sl||b.slot2===sl) });
      if(!g.length)return "";
      var cls="bk-slot c"+(ci++%2);
      var n=g.reduce(function(s,b){return s+(+b.people||0)},0);
      var capS=bkCapOfSlot(dsNow,sl);
      var full=sl!=="其他"&&n>capS;
      return '<div class="'+cls+'"><div class="bk-sh">'+sl+
        (sl===EVE_SLOT?'<span class="bk-tag t" style="margin-left:6px">晚上</span>':'')+
        '　<span'+(full?' class="bk-shfull"':'')+'>'+
        n+(sl==="其他"?"":" / "+capS)+' 位'+(full?"・超載":"")+'</span></div>'+
        g.map(bkCard).join("")+'</div>';
    }).join("");
   })()+
   (bkList.length?"":'<div class="bk-empty">這天沒有預約</div>');

  document.getElementById("bkPrev").onclick=function(){ bkDate.setDate(bkDate.getDate()-1); bkRender() };
  document.getElementById("bkNext").onclick=function(){ bkDate.setDate(bkDate.getDate()+1); bkRender() };
  document.getElementById("bkToday").onclick=function(){ bkDate=new Date(); bkRender() };
  document.getElementById("bkTMinus").onclick=function(){
    bkSetTeachers(dsNow,Math.max(0,bkTeachersOn(dsNow)-1)); bkRender() };
  document.getElementById("bkTPlus").onclick=function(){
    bkSetTeachers(dsNow,Math.min(6,bkTeachersOn(dsNow)+1)); bkRender() };
  /* 不能直接掛 bkManual：onclick 會把事件物件當成第一個參數傳進去，
     被當成「要修改的預約 id」，找不到就整個結束，按了沒反應。 */
  document.getElementById("bkAdd").onclick=function(){ bkManual() };
  root.querySelectorAll("[data-at]").forEach(function(el){ el.onclick=function(){
    bkPatch("/bookings/"+el.dataset.at+".json",{attend:el.dataset.v}).then(bkRefresh) } });
  root.querySelectorAll("[data-ed]").forEach(function(el){ el.onclick=function(){ bkManual(el.dataset.ed) } });
  root.querySelectorAll("[data-dp]").forEach(function(el){ el.onclick=function(){ bkDeposit(el.dataset.dp) } });
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
  var c=b.checkout, dp=bkDepState(b);
  var unpaid=dp.s==="wait"&&!c;
  var depPaid=dp.s==="paid"&&!c;
  var items=(b.items||[]).map(function(i){
    return esc(i.name)+(i.spec?"("+esc(i.spec)+")":"")+" ×"+(i.qty||1) }).join("、");
  /* 待收就把方式一起寫出來，行政才知道要去 LINE Pay 還是銀行對帳，不用點進去看 */
  var depTag="";
  if(dp.s==="wait")
    depTag='<span class="bk-tag w">待收 $'+dp.amt.toLocaleString()+'・'+esc(bkWayName(dp.way))+'</span>';
  else if(dp.s==="paid")
    depTag='<span class="bk-tag d">訂金 $'+dp.amt.toLocaleString()+'・'+esc(bkWayName(dp.way))+
      (dp.date?'　'+esc(dp.date.slice(5)):'')+'</span>';
  else if(dp.s==="points")
    depTag='<span class="bk-tag s">訂金・儲值金預扣</span>';
  var doneHtml="";
  if(c){
    var lines='<div class="bk-dline"><span>課程</span><b>$'+(+c.courseAmt||0).toLocaleString()+'</b></div>';
    (c.addons||[]).forEach(function(a){
      lines+='<div class="bk-dline"><span>加購・'+esc(a.name||"未命名")+'</span><b>$'+
        (+a.amt||0).toLocaleString()+'</b></div>';
    });
    if(+c.depositAmt)
      lines+='<div class="bk-dline"><span>已收訂金・'+esc(bkWayName(c.depositWay))+'</span><b>−$'+
        (+c.depositAmt).toLocaleString()+'</b></div>';
    lines+='<div class="bk-dline tot"><span>'+(+c.depositAmt?"當日應收":"合計")+'</span><b>$'+
      ((+c.depositAmt)?(+c.due||0):(+c.total||0)).toLocaleString()+'</b></div>';
    doneHtml='<div class="bk-done"><div class="bk-dhead">已核銷'+
      (c.teacher?'<span>'+esc(c.teacher)+'</span>':'')+'</div>'+lines+
      '<div class="bk-dpay">'+esc(c.summary||"")+
      (c.bonus?'　·　紅利 +'+c.bonus:'')+'</div></div>';
  }
  return '<div class="bk-card'+(c?" ok":(unpaid?" wait":(depPaid?" dep":"")))+'">'+
    '<div class="bk-who"><b>'+esc(b.customer&&b.customer.name||"—")+'</b> '+bkPplText(b)+
      (bkIsMember(b)?'<span class="bk-tag m">會員</span>':'')+
      depTag+
      (bkBase(b.slot)&&bkBase(b.slot)!==b.slot
        ?'<span class="bk-tag t">'+esc(b.slot)+'</span>':'')+
      (b.source==="manual"?'<span class="bk-tag s">現場登記</span>':'')+'</div>'+
    '<div class="bk-sub">'+esc(b.customer&&b.customer.phone||"")+(items?"　"+items:"")+'</div>'+
    (b.customer&&b.customer.note?'<div class="bk-note">備註：'+esc(b.customer.note)+'</div>':'')+
    doneHtml+
    '<div class="bk-btns">'+
      '<button class="bk-b'+(b.attend==="in"?" on":"")+'" data-at="'+b.id+'" data-v="in">已報到</button>'+
      '<button class="bk-b'+(b.attend==="no"?" no":"")+'" data-at="'+b.id+'" data-v="no">未到</button>'+
      /* 手動登記打錯很常見。核銷後就不給改了，那時金額已經寫進帳。 */
      ((!c&&b.source==="manual")
        ?'<button class="bk-b ed" data-ed="'+b.id+'">修改</button>':"")+
      /* 訂金只在還沒核銷前能改。核銷後那筆金額已經寫進扣課明細，
         這裡再動就會跟每日填寫對不起來 */
      ((!c&&(dp.s==="wait"||dp.s==="paid")&&bkCan("checkout"))
        ?'<button class="bk-b dp'+(dp.s==="paid"?" done":"")+'" data-dp="'+b.id+'">'+
          (dp.s==="paid"?"訂金 ✓":"收訂金")+'</button>':"")+
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

/* ══ 班表設定（獨立分頁・月曆）════════════════════════
   一格 = 一天。中間大字是可開課老師數，下面是該時段名額。
   沒手動指定的日子照 BK_BASE_WEEK 走，格子會淡一點。
   ════════════════════════════════════════════════════ */
var bkCalY=null, bkCalM=null;
function bk2(n){ return String(n).length<2?"0"+n:String(n) }

async function bkSchedRender(){
  var root=document.getElementById("schedRoot"); if(!root)return;
  if(bkCalY==null){ var t=new Date(); bkCalY=t.getFullYear(); bkCalM=t.getMonth()+1 }
  if(!bkSched){ root.innerHTML='<div class="bk-empty">載入班表中…</div>'; await bkLoadSched() }

  var first=new Date(bkCalY,bkCalM-1,1), days=new Date(bkCalY,bkCalM,0).getDate();
  var lead=(first.getDay()+6)%7;                  /* 月曆從週一起算 */
  var todayK=ds(new Date());
  var h='<div class="bk-cbar">'+
    '<button class="bk-nav" id="bkCPrev">‹</button>'+
    '<div class="bk-ctitle">'+bkCalY+' 年 '+bkCalM+' 月</div>'+
    '<button class="bk-nav" id="bkCNext">›</button>'+
    '<button class="bk-nav bk-tdy" id="bkCNow">本月</button></div>';
  h+='<div class="bk-cgrid">';
  ["一","二","三","四","五","六","日"].forEach(function(w){
    h+='<div class="bk-cwd">'+w+'</div>' });
  var i, seats=0, openDays=0, eveDays=0;
  for(i=0;i<lead;i++)h+='<div class="bk-mday void"></div>';
  for(i=1;i<=days;i++){
    var k=bkCalY+"/"+bk2(bkCalM)+"/"+bk2(i);
    var t2=bkTeachersOn(k), cap=bkCapOf(k);
    var ev=bkEveOn(k), evCap=bkEveCap(k);
    var set=bkSched&&bkSched[k]!=null;
    if(t2>0){ seats+=cap*SLOTS.length; openDays++ }
    if(ev>0){ seats+=evCap; eveDays++ }
    h+='<button class="bk-mday'+(t2===0&&ev===0?" off":"")+(set?" set":"")+
       (k===todayK?" now":"")+'" data-d="'+k+'">'+
       '<span class="d">'+i+'</span>'+
       '<span class="n">'+(t2===0?"休":t2)+'</span>'+
       '<span class="c">'+(t2===0?"不開課":cap+" 位")+'</span>'+
       (ev>0?'<span class="bk-eve">夜 '+evCap+'</span>':'')+'</button>';
  }
  h+='</div>';
  h+='<div class="bk-cfoot">本月開課 '+openDays+' 天・可容納 '+seats.toLocaleString()+' 人次'+
     '（白天每天 '+SLOTS.length+' 個時段'+(eveDays?'，另有 '+eveDays+' 天加開晚上':'')+'）<br>'+
     '深色外框代表你手動指定過，淺色是照星期幾的預設值。點任一天可以改。<br>'+
     '格子右下角有「夜」的，代表那天有加開 '+EVE_SLOT+'。</div>';
  root.innerHTML=h;

  document.getElementById("bkCPrev").onclick=function(){
    bkCalM--; if(bkCalM<1){ bkCalM=12; bkCalY-- } bkSchedRender() };
  document.getElementById("bkCNext").onclick=function(){
    bkCalM++; if(bkCalM>12){ bkCalM=1; bkCalY++ } bkSchedRender() };
  document.getElementById("bkCNow").onclick=function(){
    var t=new Date(); bkCalY=t.getFullYear(); bkCalM=t.getMonth()+1; bkSchedRender() };
  root.querySelectorAll("[data-d]").forEach(function(el){
    el.onclick=function(){ bkSchedPick(el.dataset.d) } });
}

/* 點某一天，跳出 休／1～6 讓你選 */
function bkSchedPick(k){
  var p=k.split("/").map(Number);
  var cur=bkTeachersOn(k), base=bkBaseOn(k), isSet=!!(bkSched&&bkSched[k]!=null);
  var h='<h3 style="margin:0 0 4px">'+k+'（'+WD[new Date(p[0],p[1]-1,p[2]).getDay()]+'）</h3>';
  h+='<div class="bk-hint" style="padding:0 2px 14px">目前 '+cur+' 位老師・每時段 '+
     bkCapOf(k)+' 位（'+(isSet?"手動指定":"星期預設")+'）</div>';
  h+='<div class="bk-nopts">';
  for(var n=0;n<=6;n++){
    var cap=Math.min(n*CAP_PER_TEACHER,SEAT_CAP);
    h+='<button class="bk-nopt'+(n===cur?" on":"")+'" data-n="'+n+'">'+
       (n===0?"休":n)+'<small>'+(n===0?"不開課":cap+" 位")+'</small></button>';
  }
  h+='</div>';
  /* 晚上時段：獨立的老師數，0 就是不開。
     跟白天分開是因為白天排 3 位不代表晚上也有 3 位。 */
  var evCur=bkEveOn(k);
  h+='<div style="margin-top:18px;padding-top:14px;border-top:1px solid #E8E3DA">'+
     '<div style="font-size:14px;font-weight:600;margin-bottom:2px">晚上時段 '+EVE_SLOT+'</div>'+
     '<div class="bk-hint" style="padding:0 0 10px">'+
     (evCur?'目前開放・'+evCur+' 位老師・可收 '+bkEveCap(k)+' 位'
           :'目前不開放，客人端不會看到這個時段')+'</div>';
  h+='<div class="bk-nopts">';
  for(var e2=0;e2<=4;e2++){
    var ecap=Math.min(e2*CAP_PER_TEACHER,SEAT_CAP);
    h+='<button class="bk-nopt'+(e2===evCur?" on":"")+'" data-ev="'+e2+'">'+
       (e2===0?"不開":e2)+'<small>'+(e2===0?"—":ecap+" 位")+'</small></button>';
  }
  h+='</div></div>';
  if(isSet)h+='<button class="bk-cancel" style="width:100%;margin-top:12px" id="bkNReset">'+
    '恢復預設（'+base+' 位）</button>';
  h+='<div class="bk-act"><button class="bk-cancel" onclick="bkClose()">關閉</button></div>';
  h+='<div class="bk-hint" style="padding:12px 2px 0">改完立即生效，客人端該日名額同步更新。'+
     '已經約進來的預約不會被取消，若因此超載，今日排課頁會顯示紅色警示。</div>';
  bkSheet(h);
  document.querySelectorAll(".bk-nopt[data-n]").forEach(function(el){
    el.onclick=async function(){
      await bkSetTeachers(k,+el.dataset.n); bkClose(); bkSchedRender();
      if(ds(bkDate)===k&&document.getElementById("bkRoot"))bkRender();
    } });
  document.querySelectorAll(".bk-nopt[data-ev]").forEach(function(el){
    el.onclick=async function(){
      var ev=+el.dataset.ev;
      /* 關掉晚上之前先確認有沒有人已經約了，不然客人會撲空 */
      if(ev===0){
        var booked=bkList.filter(function(b){
          return b.date===k&&b.status!=="cancelled"&&b.status!=="expired"&&
            (bkBase(b.slot)===EVE_SLOT||bkBase(b.slot2)===EVE_SLOT) }).length;
        if(booked&&!confirm("這天晚上已經有 "+booked+" 組預約。\n\n"+
          "關掉只會讓客人端不能再約，已經約進來的不會被取消。\n確定嗎？"))return;
      }
      await bkSetEve(k,ev); bkClose(); bkSchedRender();
      if(ds(bkDate)===k&&document.getElementById("bkRoot"))bkRender();
    } });
  var rs=document.getElementById("bkNReset");
  if(rs)rs.onclick=async function(){
    await bkSetTeachers(k,null); bkClose(); bkSchedRender();
    if(ds(bkDate)===k&&document.getElementById("bkRoot"))bkRender();
  };
}
window.bkSchedRender=bkSchedRender;

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

/* ══ 訂金登記 ══
   一顆按鈕就能收完：金額、方式都從預約單帶過來，行政通常直接按確認。
   日期可以改，因為客人昨天匯款、今天才對到帳的情況很常見，
   現金流要記在錢真的進來那天，不是行政按按鈕那天。 */
async function bkDeposit(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var dp=bkDepState(b);
  if(dp.s!=="wait"&&dp.s!=="paid")return;
  var amt=dp.amt||DEPOSIT_AMT;
  var way=dp.way||"linepay";
  var today=ds(new Date());
  var date=dp.date||today;
  var paid=dp.s==="paid";
  /* 只列真的會收到錢的方式，點數／堂數不是訂金 */
  var ways=PAYWAYS.filter(function(p){ return !p.member });

  bkSheet(
   '<h3>'+(paid?"訂金紀錄":"登記訂金")+'</h3>'+
   '<div class="bk-sh2">'+b.date+'　'+esc(b.actualTime||b.slot)+'　'+
     esc(b.customer&&b.customer.name||"")+'</div>'+
   (paid?'<div class="bk-warn">這筆已經登記過了。改完會覆蓋原本的紀錄。</div>'
        :'<div class="bk-info">客人在預約時選的是 <b>'+esc(bkWayName(dp.way))+
          '</b>，請先確認錢真的收到了再按確認。</div>')+
   '<div class="bk-f"><label>訂金金額</label>'+
     '<input id="dpAmt" inputmode="numeric" value="'+amt+'"></div>'+
   '<div class="bk-f"><label>實際收款方式</label><div class="bk-ways" id="dpWays"></div></div>'+
   '<div class="bk-f"><label>收款日期</label>'+
     '<input id="dpDate" type="date" value="'+date.replace(/\//g,"-")+'">'+
     '<div class="bk-left" style="margin-top:5px">客人哪天付的就填哪天，不是今天登記就填今天。</div></div>'+
   '<div class="bk-act">'+
     (paid?'<button class="bk-cancel" id="dpDel">取消收款</button>':'')+
     '<button class="bk-cancel" id="dpX">關閉</button>'+
     '<button class="bk-save" id="dpOK">'+(paid?"確認修改":"確認已收")+'</button></div>');

  document.getElementById("dpX").onclick=bkClose;

  function drawWays(){
    document.getElementById("dpWays").innerHTML=ways.map(function(p){
      return '<div class="bk-way'+(way===p.k?" on":"")+'" data-w="'+p.k+'">'+p.n+'</div>' }).join("");
    document.querySelectorAll("#dpWays [data-w]").forEach(function(el){
      el.onclick=function(){ way=el.dataset.w; drawWays() } });
  }
  drawWays();

  var del=document.getElementById("dpDel");
  if(del)del.onclick=async function(){
    if(!confirm("要把這筆訂金改回「待收」嗎？現金流那邊也會一起撤掉。"))return;
    this.disabled=true;
    try{
      await bkPatch("/bookings/"+id+"/deposit.json",
        {status:"wait",paidWay:null,paidDate:null,paidAt:null,by:null});
      if(b.deposit&&b.deposit.logId)
        await fetch(salf("/deposits/"+b.deposit.logId+".json"),{method:"PATCH",
          headers:{"Content-Type":"application/json"},
          body:JSON.stringify({voided:true,voidAt:new Date().toISOString()})});
      await bkPatch("/bookings/"+id+"/deposit.json",{logId:null});
      bkClose(); bkRefresh();
    }catch(e){ alert("撤銷失敗："+e.message); this.disabled=false }
  };

  document.getElementById("dpOK").onclick=async function(){
    var a=Math.round(+document.getElementById("dpAmt").value||0);
    var d=document.getElementById("dpDate").value;
    if(!(a>0)){ alert("訂金金額要大於 0"); return }
    if(!d){ alert("請填收款日期"); return }
    if(!way){ alert("請選收款方式"); return }
    var dstr=d.replace(/-/g,"/");
    if(dstr>ds(new Date())&&!confirm("收款日期比今天還晚，確定嗎？"))return;

    var btn=this; btn.disabled=true; btn.textContent="處理中…";
    var now=new Date().toISOString();
    try{
      /* 現金流要的是「哪天、用哪種方式、收到多少」，所以另外寫一筆帳，
         不能只存在預約單上——預約單會被核銷覆蓋，帳要留得住 */
      var logId=(b.deposit&&b.deposit.logId)||"";
      var log={date:dstr,bookingId:id,dept:"4F",kind:"deposit",
        customer:(b.customer&&b.customer.name)||"",
        phone:(b.customer&&b.customer.phone)||b.memberPhone||"",
        amount:a,way:way,wayName:bkWayName(way),
        classDate:b.date,slot:b.actualTime||b.slot||"",
        by:(typeof ME!=="undefined"&&ME&&ME.displayName)||"",at:now,voided:false};
      if(logId){
        await fetch(salf("/deposits/"+logId+".json"),{method:"PUT",
          headers:{"Content-Type":"application/json"},body:JSON.stringify(log)});
      }else{
        var r=await (await fetch(salf("/deposits.json"),{method:"POST",
          headers:{"Content-Type":"application/json"},body:JSON.stringify(log)})).json();
        logId=r&&r.name||"";
      }
      await bkPatch("/bookings/"+id+"/deposit.json",{
        status:"paid",amount:a,paidWay:way,paidDate:dstr,paidAt:now,
        by:(typeof ME!=="undefined"&&ME&&ME.displayName)||"",logId:logId});
      bkClose(); bkRefresh();
    }catch(e){
      alert("登記失敗："+e.message);
      btn.disabled=false; btn.textContent=paid?"確認修改":"確認已收";
    }
  };
}

/* ══ 核銷 ══ */
async function bkCheckout(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var old=b.checkout;
  var payer=null;
  /* course: 課程本身；addons: 加價項目 */
  var course={amt:old?old.courseAmt:(b.total||0), way:old?old.coursePay:""};
  /* 牌價要另外留一份。堂數扣抵時「課程費用」會歸零——那堂課的錢
     客人買方案時就付了，今天沒收現金，收了就是同一堂課收兩次。
     但業績認列還是要有個底：查得到方案單價就用單價，查不到才退回牌價，
     所以牌價不能被歸零蓋掉。切回現金或刷卡時也要能還原。 */
  var courseList=+((old?old.courseAmt:b.total)||0);
  if(course.way==="sessions"&&old&&+old.courseRev)courseList=+old.courseRev;
  var ckAmtTouched=false;   /* 行政手動改過金額就不再自動歸零 */
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
  /* 加購金額自動帶入：庫存品項上填了售價，選到就把「售價 × 數量」填進金額欄。
     行政自己動過金額的那一列就不再覆蓋——現場常有整組算便宜、
     或補差額的狀況，系統算的不該把人手改的蓋掉。
     修正核銷時載進來的舊加購一律當作手填，金額原封不動。 */
  addons.forEach(function(a){ if(a&&+a.amt>0)a.amtEdited=true });
  /* 訂金已收就從當日應收扣掉。金額還是記全額（業績），
     只有現金流那邊分成兩天——訂金記收款那天，尾款記核銷這天。 */
  var depAmt=old?(+old.depositAmt||0):bkDepPaid(b);
  var depWay=old?(old.depositWay||""):(bkDepState(b).way||"");
  /* 二選一的材料。課程用料裡標了群組的，核銷時讓老師當場選一個，
     客人不用知道規格，庫存也不會兩個都被扣。 */
  var picks=(old&&old.matPicks)?JSON.parse(JSON.stringify(old.matPicks)):{};
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
   '<div id="ckMats"></div>'+
   '<div class="bk-calc" id="ckCalc"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="ckX">取消</button>'+
     '<button class="bk-save" id="ckOK">'+(old?"確認修正":"確認核銷")+'</button></div>');

  document.getElementById("ckX").onclick=bkClose;

  /* 課程用料裡標了群組的材料，一組列一行讓老師點選。
     沒標群組的課程完全不受影響，這一區直接不出現。 */
  function drawMats(){
    var box=document.getElementById("ckMats"); if(!box)return;
    var gs=[];
    try{
      if(typeof invRecipeGroups==="function")gs=invRecipeGroups(b.items||[])||[];
    }catch(e){ gs=[] }
    if(!gs.length){ box.innerHTML=""; return }
    var h='<div class="bk-f"><label>材料選擇</label>';
    gs.forEach(function(g){
      if(picks[g.key]==null)picks[g.key]=String(g.opts[0].id);
      h+='<div class="bk-mgrp"><div class="bk-mgh">'+esc(g.grp)+
         '<span>'+esc(g.course)+'</span></div><div class="bk-ways">'+
         g.opts.map(function(o){
           return '<div class="bk-way'+(String(picks[g.key])===String(o.id)?" on":"")+
             '" data-mg="'+esc(g.key)+'" data-mo="'+esc(o.id)+'">'+esc(o.name)+'</div>' }).join("")+
         '</div></div>';
    });
    h+='<div class="bk-left">扣庫存只扣選中的那一項。</div></div>';
    box.innerHTML=h;
    box.querySelectorAll("[data-mg]").forEach(function(el){
      el.onclick=function(){ picks[el.dataset.mg]=el.dataset.mo; drawMats() } });
  }
  drawMats();

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
      el.onclick=function(){
        var prev=course.way, next=el.dataset.w;
        var amtEl=document.getElementById("ckAmt");
        if(next==="sessions"&&prev!=="sessions"){
          if(+amtEl.value>0)courseList=+amtEl.value;   /* 先把牌價收好 */
          amtEl.value=""; course.amt=0;
        }else if(prev==="sessions"&&next!=="sessions"){
          if(!(+amtEl.value>0)){ amtEl.value=courseList||""; course.amt=courseList||0 }
        }
        course.way=next; drawWays(); calc();
      } });
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
        (isOther
          ? '<div class="bk-nodeduct">手打品名，不扣庫存</div>'
          : (a.unitPrice!=null
              ? '<div class="bk-nodeduct">售價 $'+a.unitPrice.toLocaleString()+' × '+(+a.qty||1)+
                (a.amtEdited?'，金額已手動調整':'')+'</div>'
              : '<div class="bk-nodeduct">這個品項還沒設售價，到「庫存盤點 → 品項管理」填一次，之後就會自動帶</div>'))+
        '</div>' }).join("");
    document.querySelectorAll("#ckAdd .am").forEach(function(el){ el.onchange=function(){
      var a=addons[+el.dataset.i];
      if(!el.value){ a.materialId=null; a.qty=0; a.unitPrice=null; }
      else{ var m=bkMatById(el.value);
        a.materialId=m?m.id:el.value; a.name=m?m.name:"";
        if(!(+a.qty>0))a.qty=1;
        /* 換品項＝重新開始，之前手改的金額不再沿用 */
        a.unitPrice=bkMatPrice(m); a.amtEdited=false;
        if(a.unitPrice!=null)a.amt=a.unitPrice*(+a.qty||1); }
      drawAddons(); calc() } });
    document.querySelectorAll("#ckAdd .an").forEach(function(el){ el.oninput=function(){ addons[+el.dataset.i].name=el.value } });
    document.querySelectorAll("#ckAdd .aq").forEach(function(el){ el.oninput=function(){
      var a=addons[+el.dataset.i];
      a.qty=+el.value||0;
      if(a.unitPrice!=null&&!a.amtEdited){
        a.amt=a.unitPrice*a.qty;
        var av=document.querySelector('#ckAdd .av[data-i="'+el.dataset.i+'"]');
        if(av)av.value=a.amt||"";
      }
      calc() } });
    document.querySelectorAll("#ckAdd .av").forEach(function(el){ el.oninput=function(){
      var a=addons[+el.dataset.i]; a.amt=+el.value||0; a.amtEdited=true; calc() } });
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
    if(course.way==="sessions"&&course.amt>0&&!ckAmtTouched){
      /* 修正核銷時舊資料可能還帶著牌價，第一次算就歸零 */
      courseList=course.amt; course.amt=0;
      document.getElementById("ckAmt").value="";
    }
    var addTotal=addons.reduce(function(s,a){return s+(+a.amt||0)},0);
    var total=course.amt+addTotal;
    var bonus=bonusOf(course.amt), su=null; /* 加價項目不算紅利 */
    var h="課程 <b>$"+course.amt.toLocaleString()+"</b>";
    if(addTotal)h+="　加價 <b>$"+addTotal.toLocaleString()+"</b>";
    h+="　合計 <b>$"+total.toLocaleString()+"</b><br>";
    if(depAmt){
      h+="已收訂金 <b>−$"+depAmt.toLocaleString()+"</b>（"+esc(bkWayName(depWay))+"）　"+
         "當日應收 <b>$"+Math.max(0,total-depAmt).toLocaleString()+"</b><br>";
      if(total-depAmt<0)
        h+='<div class="bk-err">訂金比總金額還多，請先確認課程費用有沒有填錯</div>';
    }
    if(payer){
      var usePt=(course.way==="points"?course.amt:0)+
        addons.reduce(function(s,a){return s+(a.way==="points"?(+a.amt||0):0)},0);
      var useSe=(course.way==="sessions"?1:0);
      if(usePt){ var left=(payer.cache&&payer.cache.points||0)-usePt;
        h+="扣點數 <b>"+usePt.toLocaleString()+"</b>，剩 <b>"+left.toLocaleString()+"</b><br>";
        if(left<0)h+='<div class="bk-err">點數不足，還差 '+Math.abs(left).toLocaleString()+' 點</div>'; }
      if(useSe){ var l2=(payer.cache&&payer.cache.sessions||0)-1;
        h+="扣堂數 <b>1</b>，剩 <b>"+l2+"</b><br>";
        if(!course.amt&&courseList)
          h+='<span class="bk-cap">牌價 $'+courseList.toLocaleString()+
             ' 不另收，這堂的錢買方案時已經付過</span><br>';
        if(l2<0)h+='<div class="bk-err">堂數不足</div>';
        /* 堂數方案的一堂值多少，跟課程標價不一樣。
           業績要認列的是方案攤下來的單價，不是牌價。 */
        su=bkSessionUnit(payer);
        if(su){
          h+="這堂認列 <b>$"+su.unit.toLocaleString()+"</b>（"+
             esc(su.plan||"堂數方案")+"　"+su.qty+" 堂 $"+su.price.toLocaleString()+"）";
          h+=su.fromTicket
            ? '<span class="bk-cap">夯客票券・推估 '+esc(su.buy||"")+' 購買</span><br>'
            : "<br>";
        }else{
          var tn=bkTktNameOnly(payer);
          h+='<div class="bk-warn">'+
             (tn?("「"+esc(tn)+"」還沒有單價，"):"查不到這位客人的堂數方案，")+
             '業績先用牌價 $'+(courseList||0).toLocaleString()+' 認列。</div>';
        } }
      /* 用堂數扣的，紅利要用方案攤下來的單堂價算，不是當天的牌價。
         牌價 1,300 跟單堂 1,000 除以 500 之後差一點，是實打實的誤差。 */
      var bBase=(course.way==="sessions")?(su?su.unit:(courseList||0)):course.amt;
      bonus=bonusOf(bBase);
      h+="紅利回饋 <b>+"+bonus+"</b> 點（"+
         ((course.way==="sessions"&&su)?"單堂認列 ":"課程 ")+
         bBase.toLocaleString()+" ÷ 500，加價不計）";
    } else h+="未綁會員，不累積紅利";
    document.getElementById("ckCalc").innerHTML=h;
  }
  document.getElementById("ckAmt").oninput=function(){ ckAmtTouched=true; calc() };
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
    if(!cp||!t){ alert("付款方式和上課老師都要填"); return }
    /* 堂數扣抵本來就不收錢，0 元是正常的，其他方式才要求填金額 */
    if(course.way!=="sessions"&&!course.amt){ alert("課程費用要填"); return }
    if(cp.member&&!payer){ alert("這個付款方式需要先選會員"); return }
    addons=addons.filter(function(a){ return a.materialId||a.name||a.amt });
    for(var i=0;i<addons.length;i++){
      var ap=PAYWAYS.filter(function(p){return p.k===addons[i].way})[0];
      if(addons[i].materialId&&!(+addons[i].qty>0)){
        alert("加價項目「"+(addons[i].name||"未命名")+"」的數量要大於 0"); return }
      if(!addons[i].amt){ alert("加價項目「"+(addons[i].name||"未命名")+"」沒有填金額"); return }
      if(ap&&ap.member&&!payer){ alert("加價項目不能用點數，這筆沒有綁會員"); return }
    }
    var courseDue=Math.max(0,course.amt-depAmt);
    var usePt=(course.way==="points"?courseDue:0)+
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
      var useSe=(course.way==="sessions"?1:0);
      /* 課程實際認列的營收。堂數扣抵要用方案單價，其餘就是收的金額。
         算好存起來，之後報表不用重算，客人再買新方案也不會回頭改到舊帳。 */
      var sUnit=useSe?bkSessionUnit(payer):null;
      var courseRev=useSe?((sUnit?sUnit.unit:(courseList||course.amt))*useSe):course.amt;
      /* 紅利基準跟畫面上顯示的那個要一致，不然客人看到的跟實際入帳的會不一樣 */
      var bonus=bonusOf(useSe?(sUnit?sUnit.unit:(courseList||0)):course.amt);
      if(payer){
        if(usePt){ await bkLedger(payer.phone,{type:"points",delta:-usePt,
          reason:"扣課"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"points",-usePt); }
        if(useSe){ await bkLedger(payer.phone,{type:"sessions",delta:-useSe,
          reason:"扣課"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"sessions",-useSe); }
        if(bonus){ await bkLedger(payer.phone,{type:"bonus",delta:bonus,
          reason:"扣課回饋"+tail,bookingId:id,by:"admin",at:now}); await bkCache(payer.phone,"bonus",bonus); }
      }
      /* 拆付款：每一種方式各記一筆金額，方便每日登記分流。
         訂金不寫在這裡——它已經在收款那天記過一筆 deposits，
         寫兩次現金流就會多算一筆。 */
      var byWay={}; if(courseDue)byWay[course.way]=(byWay[course.way]||0)+courseDue;
      addons.forEach(function(a){ byWay[a.way]=(byWay[a.way]||0)+(+a.amt||0) });
      var addTotal=addons.reduce(function(s,a){return s+(+a.amt||0)},0);
      var total=course.amt+addTotal;
      var due=Math.max(0,total-depAmt);
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
        depositAmt:depAmt,depositWay:depWay,due:due,
        courseRev:courseRev,sessionUnit:sUnit?sUnit.unit:0,sessionPlan:sUnit?sUnit.plan:"",
        /* 課程排行要按課名分組，所以拆成陣列存，不要只存一串文字 */
        courses:(b.items||[]).map(function(i){
          return {name:i.name||"",spec:i.spec||"",qty:+i.qty||1} }),
        items:(b.items||[]).map(function(i){return i.name}).join("、"),
        bookingId:id,at:now,voided:false};
      var logId="";
      try{ var r=await (await fetch(salf("/deductions.json"),{method:"POST",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(log)})).json();
        logId=r&&r.name||""; }
      catch(e){ alert("扣課明細寫入每日登記失敗，但餘額已扣。請截圖告知：\n"+e.message) }

      var sumTxt=PAYWAYS.filter(function(p){return byWay[p.k]}).map(function(p){
        return p.n+" $"+byWay[p.k].toLocaleString() }).join("＋");
      if(depAmt)sumTxt=(sumTxt?sumTxt+"　·　":"")+"訂金 "+bkWayName(depWay)+" $"+depAmt.toLocaleString();
      var patch={attend:"in",status:"done",adults:nAdult,kids:nKid,people:nAdult+nKid,
        checkout:{courseAmt:course.amt,coursePay:course.way,addons:addons,addonTotal:addTotal,
          addonText:addonTxt,total:total,byWay:byWay,usePoints:usePt,useSessions:useSe,bonus:bonus,
          depositAmt:depAmt,depositWay:depWay,due:due,matPicks:picks,
          courseRev:courseRev,sessionUnit:sUnit?sUnit.unit:0,sessionPlan:sUnit?sUnit.plan:"",
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
  var bound=!!(b.line&&b.line.userId);
  if(!confirm("確定取消 "+((b.customer&&b.customer.name)||"這筆")+" 的預約？\n名額會立刻釋出。"+
     (bound?"":"\n這位客人沒綁 LINE，不會收到通知。")))return;
  var reason=prompt("取消原因（可留空，會顯示在客人的通知裡）","")||"";
  /* 現場臨時改時段、行政自己按錯這種，發通知只會讓客人緊張，所以問一句 */
  var tellHim=bound?confirm("要傳 LINE 通知告訴客人已取消嗎？\n按取消就只釋出名額，不發通知。"):false;
  await bkPatch("/bookings/"+id+".json",{status:"cancelled",cancelledAt:new Date().toISOString(),cancelReason:reason});
  if(bound&&tellHim)fetch(NOTIFY+"/notify/cancel",{method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify(Object.assign({},b,{reason:reason||undefined}))}).catch(function(){});
  bkRefresh();
}

/* ══ 手動登記（代客人預約）══ */
async function bkManual(editId){
  /* 帶 editId 就是改一筆既有的。手動登記常常打錯人數或選錯時段，
     原本只能取消重開，客人的 LINE 通知會再發一次。 */
  var eb=editId?bkList.filter(function(x){return x.id===editId})[0]:null;
  if(editId&&!eb)return;
  bkSheet('<h3>'+(eb?"修改預約":"手動登記預約")+'</h3><div class="bk-sh2">'+
   (eb?"改完會直接覆蓋，不會重發通知":"代客人預約、現場加開")+'</div>'+
   (eb?'':'<div class="bk-f"><label>找會員（電話或姓名，兩個字以上）</label>'+
     '<input id="mFind" placeholder="例：0965 或 曾亭"><div id="mHits"></div><div id="mPick"></div></div>')+
   '<div class="bk-f2"><div class="bk-f"><label>日期</label>'+
       '<input id="mDate" type="date" value="'+(eb?String(eb.date).replace(/\//g,"-"):ds(bkDate).replace(/\//g,"-"))+'"></div>'+
     '<div class="bk-f"><label>時段</label><select id="mSlot"></select>'+
       '<div class="bk-left" id="mLeft"></div></div></div>'+
   '<div class="bk-f"><label>課程</label><div id="mItems"></div>'+
     '<button type="button" id="mAddItem" class="bk-additem">＋ 再加一門課</button>'+
     '<div class="bk-left" id="mItemSum"></div></div>'+
   '<div class="bk-f2"><div class="bk-f"><label>大人 *</label>'+
       '<input id="mAdult" inputmode="numeric" value="'+(eb?(+eb.adults||0):1)+'"></div>'+
     '<div class="bk-f"><label>小孩</label>'+
       '<input id="mKid" inputmode="numeric" value="'+(eb?(+eb.kids||0):0)+'"></div>'+
     '<div class="bk-f"><label>金額</label><input id="mAmt" inputmode="numeric" value="'+(eb?(+eb.total||0):"")+'">'+
       '<div class="bk-left">選課程後自動帶入</div></div></div>'+
   '<input type="hidden" id="mPeople" value="1">'+
   '<div class="bk-f2"><div class="bk-f"><label>姓名 *</label><input id="mName" value="'+
       esc(eb&&eb.customer&&eb.customer.name||"")+'"></div>'+
     '<div class="bk-f"><label>電話</label><input id="mPhone" inputmode="tel" value="'+
       esc(eb&&eb.customer&&eb.customer.phone||"")+'"></div></div>'+
   '<div class="bk-f"><label>備註</label><textarea id="mNote" rows="2" placeholder="例：想畫自己的貓">'+
       esc(eb&&eb.customer&&eb.customer.note||"")+'</textarea></div>'+
   '<div class="bk-f" id="mNotifyBox"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="mX">取消</button>'+
     '<button class="bk-save" id="mOK">'+(eb?"儲存修改":"登記")+'</button></div>');
  document.getElementById("mX").onclick=bkClose;
  var picked=null, pickedUid=null;

  /* 時段 */
  var slotSel=document.getElementById("mSlot");
  slotSel.innerHTML=SLOTS_MANUAL.map(function(s){return "<option>"+s+"</option>"}).join("")+"<option>其他</option>";
  if(eb&&eb.slot){
    /* 舊資料的時段可能不在清單裡，補一個選項免得被改掉 */
    if(SLOTS_MANUAL.indexOf(eb.slot)<0&&eb.slot!=="其他")
      slotSel.insertAdjacentHTML("afterbegin","<option>"+esc(eb.slot)+"</option>");
    slotSel.value=eb.slot;
  }
  function showLeft(){
    var d=document.getElementById("mDate").value.replace(/-/g,"/");
    var sl=slotSel.value, el=document.getElementById("mLeft");
    var base=bkBase(sl);
    if(!base){ el.innerHTML=""; return }
    var s=bkSlotInfo(d,base), ppl=+document.getElementById("mPeople").value||1;
    /* 實際人數永遠擺第一位。老師現場可能已自行超收，
       行政若只記得表定數字會再加上去，容易一路加到爆。 */
    var line=(base!==sl?'<span class="bk-cap">加開時段，算在 '+base+' 這一場</span>':"")+
      '<span class="bk-cnt">目前已預約 <b>'+s.used+'</b> 位</span>';
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

  /* ══ 品項清單（2026-08-09）══════════════════════════════
     一組客人一起來，各上各的課——三個人來，一個畫流動畫、
     兩個做透明框，本來只能選一種課，金額和用料都對不起來。

     為什麼不拆成三筆預約：他們是同一組、同一個時段、同一支
     電話。拆開的話那個時段的「預約組數」會變成 3，跟現場
     實際狀況對不上，客人也會收到三封通知。

     資料結構本來就撐得住——items 一直是陣列，核銷的課程排行、
     用料表 invRecipeGroups、扣庫存 consumeInvForBooking
     全部都是掃整個陣列。只有這張表單以前做不出第二列而已。
     所以下游一支都不用改。

     每一列：ci＝bkCourses 的索引（空字串＝不指定）、
             qty＝這門課幾個人、amt＝這一列的小計。
     只有一列的時候 qty 自動跟著大人＋小孩走，維持舊習慣；
     加到第二列就得自己填，畫面會比對合計對不對得起來。
     ═════════════════════════════════════════════════════ */
  var mItems=[], mItemsDirty=false;
  if(eb&&eb.items&&eb.items.length){
    eb.items.forEach(function(it){
      var ci=-1;
      bkCourses.forEach(function(c,i){
        if(ci<0&&c.name===it.name&&String(c.spec||"")===String(it.spec||""))ci=i });
      var qty=+it.qty||1, price=+it.price||0;
      mItems.push({ ci: ci>=0?String(ci):"", qty:qty, amt:price*qty,
                    qtyManual:true, amtManual:false,
                    lostName: ci<0 ? (it.name||"") : "" });
    });
  }
  if(!mItems.length) mItems.push({ ci:"", qty:0, amt:0, qtyManual:false, amtManual:false, lostName:"" });
  /* 編輯既有預約時，金額以原本存的為準，不要被單價重算蓋掉 */
  if(eb) mItems.forEach(function(r){ r.amtManual=true });
  if(eb&&mItems.length===1) mItems[0].amt=+eb.total||mItems[0].amt;

  function mPplNow(){
    return (+document.getElementById("mAdult").value||0)+(+document.getElementById("mKid").value||0);
  }
  function mRowPrice(r){
    if(r.ci==="")return 0;
    var c=bkCourses[+r.ci]; return c?(+c.price||0):0;
  }
  function mRecalc(){
    var t=0; mItems.forEach(function(r){ t+=+r.amt||0 });
    var amtEl=document.getElementById("mAmt");
    if(amtEl) amtEl.value=t||"";
    var sum=document.getElementById("mItemSum"); if(!sum)return;
    var q=0, chosen=0;
    mItems.forEach(function(r){ q+=+r.qty||0; if(r.ci!=="")chosen++ });
    var ppl=mPplNow();
    if(!chosen&&mItems.length===1){ sum.innerHTML="不指定課程時，直接在右邊的金額欄手動填。"; return }
    var h="品項合計 <b>"+q+"</b> 位・<b>$"+t.toLocaleString()+"</b>";
    if(mItems.length>1){
      h+=(q===ppl)
        ? '　<span class="bk-ok">跟現場總人數 '+ppl+' 位相符</span>'
        : '　<span class="bk-full">現場總人數是 '+ppl+' 位，差 '+Math.abs(ppl-q)+' 位</span>';
    }
    sum.innerHTML=h;
  }
  function mDraw(){
    var box=document.getElementById("mItems"); if(!box)return;
    /* 只有一列而且沒手動改過人數時，人數跟著大人＋小孩走 */
    if(mItems.length===1&&!mItems[0].qtyManual){
      mItems[0].qty=mPplNow()||1;
      if(mItems[0].ci!==""&&!mItems[0].amtManual)
        mItems[0].amt=mRowPrice(mItems[0])*mItems[0].qty;
    }
    box.innerHTML=mItems.map(function(r,i){
      var c=r.ci===""?null:bkCourses[+r.ci];
      var opts='<option value="">（不指定，手動填金額）</option>'+
        (r.lostName?'<option value="" selected>'+esc(r.lostName)+'（原資料，清單裡沒有）</option>':'')+
        bkCourses.map(function(cc,j){
          return '<option value="'+j+'"'+(String(r.ci)===String(j)?" selected":"")+'>'+esc(cc.label)+'</option>' }).join("");
      return '<div class="bk-irow">'+
        '<select data-ir="'+i+'" data-f="ci">'+opts+'</select>'+
        '<input data-ir="'+i+'" data-f="qty" inputmode="numeric" value="'+(r.qty||0)+'" placeholder="位">'+
        '<input data-ir="'+i+'" data-f="amt" inputmode="numeric" value="'+(r.amt||"")+'" placeholder="小計">'+
        (mItems.length>1?'<button type="button" class="bk-idel" data-del="'+i+'">✕</button>':'<span class="bk-ipad"></span>')+
        '</div>'+
        (c?'<div class="bk-left bk-iinfo">單價 $'+(+c.price||0).toLocaleString()+
            (c.dur?"　時長 "+esc(c.dur):"")+'</div>':'');
    }).join("");

    box.querySelectorAll("select[data-f=ci]").forEach(function(el){
      el.onchange=function(){
        var r=mItems[+el.dataset.ir];
        r.ci=el.value; r.lostName=""; r.amtManual=false; mItemsDirty=true;
        if(!r.qty) r.qty=mItems.length===1?(mPplNow()||1):1;
        r.amt=mRowPrice(r)*(+r.qty||0);
        mDraw();
      };
    });
    box.querySelectorAll("input[data-f=qty]").forEach(function(el){
      el.oninput=function(){
        var r=mItems[+el.dataset.ir];
        r.qty=+el.value||0; r.qtyManual=true; mItemsDirty=true;
        if(r.ci!==""&&!r.amtManual){
          r.amt=mRowPrice(r)*r.qty;
          var ae=box.querySelector('input[data-f=amt][data-ir="'+el.dataset.ir+'"]');
          if(ae)ae.value=r.amt||"";
        }
        mRecalc();
      };
    });
    box.querySelectorAll("input[data-f=amt]").forEach(function(el){
      el.oninput=function(){
        var r=mItems[+el.dataset.ir];
        r.amt=+el.value||0; r.amtManual=true; mItemsDirty=true; mRecalc();
      };
    });
    box.querySelectorAll("[data-del]").forEach(function(el){
      el.onclick=function(){
        mItems.splice(+el.dataset.del,1); mItemsDirty=true;
        if(!mItems.length)mItems.push({ci:"",qty:mPplNow()||1,amt:0,qtyManual:false,amtManual:false,lostName:""});
        mDraw();
      };
    });
    mRecalc();
  }
  document.getElementById("mAddItem").onclick=function(){
    mItemsDirty=true;
    /* 加第二列時，第一列的人數就得定下來，不然它還會跟著總人數跑 */
    if(mItems.length===1) mItems[0].qtyManual=true;
    mItems.push({ci:"",qty:1,amt:0,qtyManual:true,amtManual:false,lostName:""});
    mDraw();
  };
  /* 大人／小孩變動時沿用原本的 fillAmt 名稱，syncPpl 不用改 */
  function fillAmt(){ mDraw() }
  function mItemsOut(){
    var out=[];
    mItems.forEach(function(r){
      if(r.ci==="")return;
      var c=bkCourses[+r.ci]; if(!c)return;
      out.push({name:c.name,spec:c.spec,qty:+r.qty||1,price:+c.price||0});
    });
    /* 沒動過品項就別把原本的資料洗掉 */
    if(!out.length&&eb&&!mItemsDirty)return eb.items||[];
    return out;
  }
  mDraw();
  showLeft();

  /* 會員搜尋 */
  await bkLoadMembers();
  if(eb)showNotify();
  var findEl=document.getElementById("mFind");
  if(findEl)findEl.oninput=function(){
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
    var ph=picked?picked.phone:(eb?(eb.memberPhone||(eb.customer&&eb.customer.phone)||""):"");
    if(!ph){
      box.innerHTML=eb?'<div class="bk-left">這筆沒有綁定會員，改完不會發通知。</div>':"";
      pickedUid=null; return;
    }
    var m=await bkMember(mbPhone(ph));
    pickedUid=(m&&m.lineUserId)||(eb&&eb.line&&eb.line.userId)||null;
    if(!pickedUid){
      box.innerHTML='<div class="bk-left">這位會員還沒綁定 LINE，'+
        (eb?"改完":"登記後")+'不會收到通知。等他自己用線上預約一次就會自動綁定。</div>';
      return;
    }
    /* 修改預設不勾。客人已經收過一次確認，再收一封一樣格式的容易以為又多訂了一筆，
       真的改了日期時間才值得通知。 */
    box.innerHTML='<label style="display:flex;align-items:center;gap:7px;font-size:14.5px;color:#333">'+
      '<input type="checkbox" id="mNotify"'+(eb?"":" checked")+' style="width:16px;height:16px"> '+
      (eb?"儲存後傳 LINE 通知告訴客人改了":"登記後傳 LINE 通知給客人")+'</label>'+
      (eb?'<div class="bk-left">通知內容跟第一次預約的確認訊息一樣，會帶新的日期時段。</div>':"");
  }

  document.getElementById("mOK").onclick=async function(){
    var g=function(id){ return document.getElementById(id).value.trim() };
    var nA=+g("mAdult")||0, nK=+g("mKid")||0;
    document.getElementById("mPeople").value=nA+nK;
    if(!g("mName")||!(nA+nK)){ alert("姓名和人數必填"); return }
    var ppl=nA+nK;
    var amt=+g("mAmt")||0;
    var outItems=mItemsOut();
    if(outItems.length>1){
      var iq=outItems.reduce(function(a,x){ return a+(+x.qty||0) },0);
      if(iq!==ppl&&!confirm("品項的人數加起來是 "+iq+" 位，但大人＋小孩填的是 "+ppl+" 位。\n\n"+
                            "核銷扣用料是照品項的人數算的，這樣會對不起來。\n確定要這樣存嗎？"))return;
    }
    var d=g("mDate").replace(/-/g,"/"), sl=g("mSlot");
    var sBase=bkBase(sl);
    if(sBase){
      var si=bkSlotInfo(d,sBase);
      if(si.cap>0&&si.left<ppl&&
         !confirm("這個時段目前已預約 "+si.used+" 位，表定上限 "+si.cap+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位，超過表定。\n確定要登記嗎？"))return;
      if(si.cap<=0&&si.used>0&&
         !confirm("這個時段班表沒排老師，目前已預約 "+si.used+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位。\n確定要登記嗎？"))return;
    }
    var rec={date:d,slot:sl,people:ppl,adults:nA,kids:nK,
      items:outItems,
      total:amt,
      customer:{name:g("mName"),phone:g("mPhone"),note:g("mNote")},
      status:"new",source:"manual",ts:new Date().toISOString()};
    if(picked)rec.memberPhone=picked.phone;
    var wantNotify=document.getElementById("mNotify");
    if(pickedUid)rec.line={userId:pickedUid};
    var btn=this; btn.disabled=true; btn.textContent=eb?"儲存中…":"登記中…";
    try{
      if(eb){
        /* 用 PATCH 不用 PUT：核銷、訂金、報到那些欄位要留著，
           這裡只改行政填的那幾格。 */
        delete rec.status; delete rec.ts;
        rec.editedAt=new Date().toISOString();
        rec.editedBy=(typeof ME!=="undefined"&&ME&&ME.displayName)||"";
        await bkPatch("/bookings/"+editId+".json",rec);
      }else
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
    }catch(e){ alert((eb?"儲存":"登記")+"失敗："+e.message);
      btn.disabled=false; btn.textContent=eb?"儲存修改":"登記" }
  };
}

/* ── 樣式 ── */
var css=document.createElement("style");
css.textContent=
"#bkRoot{--bkNavy:#1E2B4F;--bkGold:#C99A3B;--bkInk:#232936;--bkMute:#8A90A0;"+
  "--bkLine:#ECEEF2;--bkSoft:#F6F7F9;--bkOk:#12805C;--bkOkBg:#EAF6F1;--bkRed:#C9453B}"+
".bk-bar{display:flex;align-items:center;gap:8px;margin-bottom:18px}"+
".bk-nav{background:#fff;border:0;box-shadow:0 1px 2px rgba(16,24,40,.07);border-radius:10px;"+
  "width:38px;height:38px;font-size:18px;color:#5B6272;cursor:pointer;transition:.15s}"+
".bk-nav:hover{background:#F0F2F6}"+
".bk-tdy{font-size:14.5px;width:auto;padding:0 15px;color:var(--bkNavy);font-weight:600}"+
".bk-date{flex:1;text-align:center}"+
".bk-date b{font-size:19px;color:var(--bkInk);letter-spacing:.3px}"+
".bk-date span{font-size:13.5px;color:var(--bkMute);margin-left:6px}"+
".bk-stat{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:22px}"+
".bk-stat div{flex:1;min-width:84px;background:#fff;border:0;border-radius:14px;"+
  "padding:15px 10px;text-align:center;box-shadow:0 1px 3px rgba(16,24,40,.06)}"+
".bk-stat b{display:block;font-size:25px;font-weight:700;color:var(--bkNavy);line-height:1.15}"+
".bk-stat span{font-size:12.5px;color:var(--bkMute);margin-top:3px;display:block}"+
".bk-slot{margin-bottom:22px;border-radius:16px;padding:12px 12px 14px;"+
  "border-left:6px solid transparent}"+
/* 可開課老師計數卡 */
".bk-tcard>b{display:flex;align-items:center;justify-content:center;gap:9px}"+
".bk-tbtn{width:32px;height:32px;border-radius:8px;border:1px solid #D6DCE8;"+
  "background:#fff;color:#5B6272;font-size:16px;line-height:1;cursor:pointer;"+
  "font-family:inherit;transition:.15s;flex:0 0 auto;padding:0}"+
".bk-tbtn:hover{background:#EDF1FA;border-color:#9FB0CE}"+
".bk-tbtn:active{transform:scale(.94)}"+
"#bkRoot .bk-stat .bk-tcard .bk-tnum{display:block!important;min-width:50px;"+
  "text-align:center;margin-top:0!important;font-size:26px!important;"+
  "font-weight:700!important;color:var(--bkNavy)!important;line-height:1.15!important;"+
  "font-variant-numeric:tabular-nums}"+
/* 超載警示 */
".bk-over{background:#FBEAE8;color:#C9453B;border-radius:12px;padding:12px 15px;"+
  "font-size:14.5px;line-height:1.6;margin-bottom:16px;font-weight:500}"+
".bk-add-top{margin:0 0 20px}"+
".bk-shfull{color:#C9453B;font-weight:600}"+
/* 班表設定月曆 */
".bk-cbar{display:flex;align-items:center;gap:10px;margin-bottom:16px}"+
".bk-ctitle{flex:1;text-align:center;font-size:19px;font-weight:700;color:#1E2B4F}"+
".bk-cgrid{display:grid;grid-template-columns:repeat(7,1fr);gap:7px}"+
".bk-cwd{text-align:center;font-size:13.5px;color:#8A90A0;padding-bottom:4px}"+
".bk-mday{display:flex;flex-direction:column;align-items:center;justify-content:center;"+
  "gap:1px;aspect-ratio:1/1.12;border:1px solid #E3E6EC;border-radius:12px;"+
  "background:#fff;cursor:pointer;font-family:inherit;transition:.15s;padding:4px}"+
".bk-mday:hover{border-color:#9FB0CE;background:#F6F8FC}"+
".bk-mday .d{font-size:13.5px;color:#8A90A0}"+
".bk-mday .n{font-size:21px;font-weight:700;color:#1E2B4F;line-height:1.15}"+
".bk-mday .c{font-size:12px;color:#A8AEBC}"+
".bk-mday.set{border-color:#1E2B4F;border-width:2px;background:#EDF1FA}"+
".bk-mday.off{background:#F4F4F6;opacity:.6}"+
".bk-mday.off .n{color:#8A90A0;font-size:18px}"+
".bk-mday.now .d{color:#C99A3B;font-weight:700}"+
".bk-mday.void{border:1px dashed #EAECF0;background:transparent;cursor:default}"+
".bk-mday.void:hover{border-color:#EAECF0;background:transparent}"+
".bk-cfoot{margin-top:18px;font-size:13.5px;color:#8A90A0;line-height:1.8}"+
".bk-nopts{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}"+
".bk-nopt{display:flex;flex-direction:column;align-items:center;gap:2px;padding:13px 4px;"+
  "border:1px solid #E3E6EC;border-radius:11px;background:#fff;cursor:pointer;"+
  "font-size:18px;font-weight:600;color:#1E2B4F;font-family:inherit;transition:.15s}"+
".bk-nopt:hover{border-color:#9FB0CE;background:#F6F8FC}"+
".bk-nopt small{font-size:12px;font-weight:400;color:#8A90A0}"+
".bk-nopt.on{background:#1E2B4F;color:#fff;border-color:#1E2B4F}"+
".bk-nopt.on small{color:#C3CCDF}"+
"@media(max-width:560px){.bk-cgrid{gap:4px}.bk-mday .n{font-size:18px}"+
  ".bk-mday .c{font-size:11.5px}.bk-nopts{grid-template-columns:repeat(3,1fr)}}"+
".bk-slot.c0{background:#EDF1F8;border-left-color:#B4C4DC}"+
".bk-slot.c1{background:#FAF1E4;border-left-color:#E2C293}"+
".bk-sh{position:sticky;top:0;z-index:5;font-size:20px;font-weight:800;color:#1F2A44;"+
  "letter-spacing:.4px;margin:-12px -12px 6px;padding:12px 12px 12px 16px;"+
  "border:0;border-radius:16px 16px 0 0}"+
".bk-slot.c0>.bk-sh{background:#EDF1F8}"+
".bk-slot.c1>.bk-sh{background:#FAF1E4}"+
".bk-sh span{font-weight:500;letter-spacing:0;font-size:15.5px;color:#77809A}"+
".bk-card{background:#fff;border:0;border-radius:14px;padding:16px 17px;margin-top:10px;"+
  "box-shadow:0 1px 3px rgba(16,24,40,.06);transition:.15s}"+
".bk-card:hover{box-shadow:0 3px 10px rgba(16,24,40,.09)}"+
".bk-card.ok{background:#FBFDFC;box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 var(--bkOk)}"+
".bk-card.wait{box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 var(--bkGold)}"+
/* 收了訂金但還沒核銷：藍色。掃一眼就分得出誰完全還沒收到錢 */
".bk-card.dep{box-shadow:0 1px 3px rgba(16,24,40,.06),inset 3px 0 0 #4C6FB1}"+
".bk-b.ed{background:#F2F3F6;color:#5F6577}"+
".bk-b.ed:hover{background:#E8EAEF}"+
".bk-b.dp{background:#FDF4E3;color:#8A6400;font-weight:600}"+
".bk-b.dp:hover{background:#F8EBD3}"+
".bk-b.dp.done{background:var(--bkOkBg);color:var(--bkOk);font-weight:500}"+
".bk-who b{font-size:17px;color:var(--bkInk);font-weight:600}"+
".bk-tag{display:inline-block;font-size:12.5px;padding:2.5px 9px;border-radius:99px;"+
  "margin-left:6px;vertical-align:1.5px;font-weight:500}"+
".bk-tag.m{background:#EDF1FA;color:#3A4C7A}"+
".bk-tag.w{background:#FDF4E3;color:#8A6400}"+
".bk-tag.s{background:#F2F3F6;color:#767C8B}"+
/* 加開時段的實際時間。同一區裡混著 9:30 和 10:00 的人，要看得出來 */
".bk-tag.t{background:#EEF3FB;color:#3A5A96;font-variant-numeric:tabular-nums}"+
".bk-mgrp{margin-bottom:11px}"+
".bk-mgh{font-size:13.5px;font-weight:600;color:var(--bkInk);margin-bottom:6px;"+
  "display:flex;align-items:baseline;gap:7px}"+
".bk-mgh span{font-size:12.5px;font-weight:400;color:var(--bkMute)}"+
".bk-tag.d{background:var(--bkOkBg);color:var(--bkOk)}"+
".bk-sub{font-size:14.5px;color:var(--bkMute);margin-top:5px;line-height:1.6}"+
".bk-note{font-size:13.5px;color:#8A6400;margin-top:5px}"+
".bk-done{margin-top:12px;background:var(--bkOkBg);padding:11px 13px;border-radius:10px}"+
".bk-dhead{font-size:13.5px;font-weight:700;color:var(--bkOk);letter-spacing:.6px;"+
  "margin-bottom:7px;display:flex;justify-content:space-between}"+
".bk-dhead span{font-weight:500;color:#4F7A6A}"+
".bk-dline{display:flex;justify-content:space-between;font-size:14.5px;color:#3F5A50;padding:2.5px 0}"+
".bk-dline b{color:#1B5E48;font-weight:600}"+
".bk-dline.tot{border-top:1px solid #CFE6DC;margin-top:5px;padding-top:6px;font-weight:600}"+
".bk-dline.tot b{font-size:16px;color:var(--bkOk)}"+
".bk-dpay{font-size:12.5px;color:#6B8C7F;margin-top:7px}"+
".bk-btns{display:flex;gap:7px;margin-top:13px;flex-wrap:wrap}"+
".bk-b{flex:1;min-width:70px;padding:9px 4px;font-size:14.5px;background:var(--bkSoft);"+
  "border:0;border-radius:9px;color:#5B6272;cursor:pointer;transition:.15s;font-family:inherit}"+
".bk-b:hover{background:#EBEDF2}"+
".bk-b.on{background:var(--bkNavy);color:#fff;font-weight:600}"+
".bk-b.no{background:#F2F3F6;color:#A8AEBC}"+
".bk-b.ck{background:#EDF1FA;color:#3A4C7A;font-weight:600}"+
".bk-b.ck:hover{background:#E1E8F6}"+
".bk-b.cx{background:#FBF0EF;color:var(--bkRed)}"+
".bk-b.cx:hover{background:#F7E4E2}"+
".bk-add{width:100%;margin-top:18px;padding:14px;background:var(--bkNavy);color:#fff;"+
  "border:0;border-radius:12px;font-size:15.5px;font-weight:600;cursor:pointer;"+
  "font-family:inherit;transition:.15s}"+
".bk-add:hover{background:#16223F}"+
".bk-empty{text-align:center;color:#A8AEBC;padding:44px 20px;font-size:14.5px}"+
".bk-mask{position:fixed;inset:0;background:rgba(24,30,45,.42);display:none;z-index:900;"+
  "align-items:flex-end;justify-content:center;backdrop-filter:blur(2px)}"+
".bk-mask.on{display:flex}"+
".bk-sheet{background:#fff;width:100%;max-width:560px;max-height:92vh;overflow:auto;"+
  "border-radius:20px 20px 0 0;padding:24px 20px 30px;box-shadow:0 -6px 28px rgba(16,24,40,.16)}"+
".bk-sheet h3{font-size:19px;color:#232936;margin:0 0 4px;font-weight:600}"+
".bk-sh2{font-size:14.5px;color:#8A90A0;margin-bottom:18px}"+
".bk-f{margin-bottom:14px}.bk-f2{display:flex;gap:10px}.bk-f2 .bk-f{flex:1}"+
".bk-f label{display:block;font-size:13.5px;color:#8A90A0;margin-bottom:6px;font-weight:500}"+
".bk-f input,.bk-f select,.bk-f textarea,#ckFind,#mFind{width:100%;padding:11px 13px;"+
  "border:1px solid #E3E6EC;border-radius:10px;font-size:16px;font-family:inherit;"+
  "box-sizing:border-box;background:#FBFCFD;transition:.15s;color:#232936}"+
".bk-f input:focus,.bk-f select:focus,.bk-f textarea:focus,#ckFind:focus,#mFind:focus{"+
  "outline:0;border-color:#9FB0D6;background:#fff;box-shadow:0 0 0 3px rgba(62,86,145,.09)}"+
".bk-ways{display:flex;gap:8px;flex-wrap:wrap}"+
".bk-way{flex:1 1 30%;min-width:92px;text-align:center;padding:11px 5px;border:1px solid #E3E6EC;"+
  "border-radius:10px;background:#FBFCFD;font-size:14.5px;cursor:pointer;color:#5B6272;transition:.15s}"+
".bk-way:hover{border-color:#C3CCDF}"+
".bk-way.on{border-color:#3A4C7A;background:#EDF1FA;color:#1E2B4F;font-weight:600;"+
  "box-shadow:0 0 0 2px rgba(58,76,122,.1)}"+
".bk-way.dis{opacity:.3;pointer-events:none}"+
".bk-addon{display:flex;gap:6px;align-items:center;margin-bottom:8px;flex-wrap:wrap}"+
".bk-eve{position:absolute;right:5px;bottom:4px;font-size:10.5px;line-height:1;"+
  "background:var(--bkNavy,#1E2B4F);color:#fff;padding:2px 5px;border-radius:5px}"+
".bk-mday{position:relative}"+
".bk-irow{display:flex;gap:6px;align-items:center;margin-bottom:7px}"+
".bk-irow>select{flex:1;min-width:0}"+
".bk-irow>input{width:64px;text-align:right}"+
".bk-irow>input[data-f=amt]{width:86px}"+
".bk-idel{width:30px;height:36px;border:1px solid #E3D6D4;border-radius:8px;"+
  "background:#fff;color:#C25E4A;cursor:pointer;font-size:14px;flex:none}"+
".bk-ipad{width:30px;flex:none}"+
".bk-iinfo{margin:-3px 0 9px}"+
".bk-additem{border:1px dashed var(--bkGold,#C99A3B);background:transparent;"+
  "color:var(--bkGold,#C99A3B);border-radius:8px;padding:7px 12px;font-size:13.5px;"+
  "cursor:pointer;font-family:inherit;margin-bottom:6px}"+
".bk-addon .am{flex:2 1 132px}.bk-addon .an{flex:2 1 108px}.bk-addon .aq{flex:0 1 60px}"+
".bk-addon .av{flex:1 1 70px}.bk-addon .aw{flex:1 1 88px}"+
".bk-addon input,.bk-addon select{padding:8px;border:1px solid #ddd;border-radius:7px;"+
  "font-size:14.5px;box-sizing:border-box;background:#fff;font-family:inherit}"+
".bk-nodeduct{flex-basis:100%;font-size:12.5px;color:#A8AEBC;margin:-3px 0 0 2px}"+
".bk-b.vd{background:#FDF4E3;color:#8A6400}"+
".bk-b.vd:hover{background:#F8EBD3}"+
".ax{color:#C9453B;cursor:pointer;padding:0 4px;font-size:16px}"+
".bk-mini{background:#fff;border:1px dashed #999;border-radius:7px;padding:7px 12px;font-size:13.5px;cursor:pointer;width:100%}"+
".bk-info{background:#EDF1FA;border:0;border-radius:12px;padding:13px 15px;margin-bottom:14px;"+
  "font-size:14.5px;color:#3A4C7A;line-height:1.7}"+
".bk-info b{color:#1E2B4F;font-weight:600}"+
".bk-warn{background:#FDF4E3;color:#8A6400;font-size:14.5px;padding:11px 13px;"+
  "border-radius:10px;margin:9px 0;line-height:1.6}"+
".bk-err{background:#FBEAE8;color:#C9453B;font-size:14.5px;padding:10px 12px;"+
  "border-radius:10px;margin-top:8px}"+
".bk-calc{font-size:14.5px;color:#6B7180;line-height:2;margin:14px 0;background:#F6F7F9;"+
  "padding:13px 15px;border-radius:12px}"+
".bk-calc b{color:#1E2B4F;font-size:16px;font-weight:600}"+
".bk-hit{padding:11px 13px;border:1px solid #E3E6EC;border-radius:10px;margin-top:7px;"+
  "background:#fff;cursor:pointer;transition:.15s}"+
".bk-hit:hover{background:#F6F7F9;border-color:#C3CCDF}"+
".bk-hit b{color:#232936}.bk-bal{font-size:13.5px;color:#8A90A0;margin-top:3px}"+
".bk-hint{font-size:14.5px;color:#A8AEBC;padding:10px 2px}"+
".bk-left{font-size:13.5px;color:#8A90A0;margin-top:5px;line-height:1.6}"+
".bk-names{font-size:13.5px;color:#A8AEBC;margin-top:4px}"+
".bk-ok{color:#12805C;font-weight:500}.bk-full{color:#C9453B;font-weight:600}"+
".bk-cnt{display:inline-block;font-size:15.5px;color:#1E2B4F;font-weight:600;margin-right:9px}"+
".bk-cnt b{font-size:19px;color:#1E2B4F;font-weight:700;vertical-align:-1px}"+
".bk-cap{display:inline-block;font-size:13.5px;color:#8A90A0;margin-right:8px}"+
".bk-act{display:flex;gap:10px;margin-top:22px}"+
".bk-cancel{flex:1;padding:14px;background:#F2F3F6;border:0;border-radius:12px;"+
  "font-size:15.5px;cursor:pointer;color:#5B6272;font-family:inherit;transition:.15s}"+
".bk-cancel:hover{background:#E7E9EE}"+
".bk-save{flex:2;padding:14px;background:#1E2B4F;color:#fff;border:0;border-radius:12px;"+
  "font-size:15.5px;font-weight:600;cursor:pointer;font-family:inherit;transition:.15s}"+
".bk-save:hover{background:#16223F}"+
".bk-save:disabled{background:#A8AEBC;cursor:default}";
document.head.appendChild(css);

document.addEventListener("DOMContentLoaded",function(){ setTimeout(bkRender,400) });
})();
