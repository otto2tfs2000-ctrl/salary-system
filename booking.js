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
var LIFF_LINK = "https://liff.line.me/2010906803-FMDYktUN"; // 客人點這個連結，開一次就會自動綁定 LINE
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
  "15:00-17:00":"14:00-16:00","15:30-17:30":"16:00-18:00",
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
    return {s:"paid",way:bkDepWay(d.paidWay)||w,amt:amt,date:d.paidDate||"",by:d.by||"",last5:d.last5||""};
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
var bkSlotOpen = {}; // 今日排課裡哪些時段是展開的，key 是「日期|時段」，預設收合
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
  var out=j.table.rows.map(function(r){ return r.c.map(function(c){
    return c?(c.f==null?c.v:c.f):"" }) });
  /* 標題另外掛在陣列上（不可列舉，不影響 forEach/map），
     格式偵測（例如加購有沒有加規格欄）要靠這個判斷，不用亂猜資料形狀 */
  try{ Object.defineProperty(out,"__head",{value:(j.table.cols||[]).map(function(c){return String((c&&(c.label||c.id))||"").trim()}),enumerable:false}) }catch(e){}
  return out;
}
function bkNum(v){
  var m=String(v==null?"":v).replace(/[^\d.]/g,"");
  return m?Math.round(parseFloat(m)):0;
}
async function bkLoadCourses(){
  if(bkCourses)return;
  try{
    var rows=await bkGviz("課程");
    /* 前十一欄照位置讀（沿用舊行為）；之後新增的欄位照標題找，
       這樣你在試算表要加在哪、順序怎麼排都不會弄壞。 */
    var head={}, first=rows.length?rows[0].map(function(x){return String(x||"").trim()}):[];
    if(first[0]==="分類"){
      ["佔位","計時"].forEach(function(n){
        var i=first.indexOf(n); if(i>=0)head[n]=i });
      rows.shift();
    }
    var out=[];
    rows.forEach(function(r){
      var name=String(r[1]||"").trim();
      var on=String(r[7]||"Y").trim().toUpperCase()!=="N";
      if(!name||!on)return;
      var spec=String(r[3]||"").trim();
      out.push({cat:String(r[0]||"").trim(),name:name,spec:spec,
        dur:String(r[4]||"").trim(),price:bkNum(r[5]),
        /* 地毯這類課：一組不管幾個人都佔 3 位、按小時計價。
           客人端已經在用，後台以前讀不到，所以單價會顯示 $0。 */
        seats:head["佔位"]!=null?bkNum(r[head["佔位"]]):0,
        hourly:head["計時"]!=null?bkNum(r[head["計時"]]):0,
        label:name+(spec?"（"+spec+"）":"")});
    });
    bkCourses=out;
  }catch(e){ bkCourses=[]; }
}
/* 加購清單：跟客人端讀同一份「加購」工作表（課程名稱／規格／加購名稱／價格／排序），
   手動登記以前完全沒讀這份表，行政只能整堂課加開一列，選不到單一加購品項。
   規格留空＝不分尺寸都出現；填了＝只在選到那個規格時才出現（例如雙層流動依尺寸不同價）。 */
var bkAddons = null; // 課程名稱 -> [{name,price,sort,spec}]
async function bkLoadAddons(){
  if(bkAddons)return;
  try{
    var rows=await bkGviz("加購");
    var first=rows.length?rows[0].map(function(x){return String(x||"").trim()}):[];
    if(first[0]==="課程名稱")rows.shift();
    /* 舊格式（課程名稱／加購名稱／價格／排序）表格還沒加規格欄也不會壞——
       照標題判斷，沒有「規格」欄就當全部尺寸通用 */
    var hasSpec=!!(rows.__head&&rows.__head[1]==="規格");
    var iSpec=hasSpec?1:-1, iName=hasSpec?2:1, iPrice=hasSpec?3:2, iSort=hasSpec?4:3;
    var out={};
    rows.forEach(function(r){
      var cname=String(r[0]||"").trim(), aname=String(r[iName]||"").trim();
      var spec=iSpec>=0?String(r[iSpec]||"").trim():"";
      if(!cname||!aname)return;
      (out[cname]=out[cname]||[]).push({name:aname,price:bkNum(r[iPrice]),sort:+r[iSort]||99,spec:spec});
    });
    Object.keys(out).forEach(function(k){ out[k].sort(function(a,b){return a.sort-b.sort}) });
    bkAddons=out;
  }catch(e){ bkAddons={}; }
}
/* 同一門課不同規格，加購清單可能不一樣（小尺寸可能沒有雙層選項）。
   渲染跟點擊都要用這支拿清單，索引才會對得起來。 */
function bkAddonsFor(c){
  if(!c||!bkAddons||!bkAddons[c.name])return [];
  return bkAddons[c.name].filter(function(a){ return !a.spec||a.spec===c.spec });
}
var BK_HOUR_MIN=2, BK_HOUR_MAX=4;
/* ══ 課程下拉依分類分組 ══════════════════════════════════
   課程有五十幾門，一長串平鋪下來要滑很久，還很容易選錯規格
   （A4／A5 只差一個字）。試算表第一欄本來就有分類，讀進來也
   一直留著，只是渲染時沒用上。

   用 optgroup 分組，分類的順序照試算表由上而下，不另外排序——
   你在試算表怎麼排，下拉就怎麼出現，改順序不用動程式。
   順便把價格帶進選項，選之前就看得到，不用選完再確認。 */
function bkCourseOptions(sel){
  var order=[], byCat={};
  bkCourses.forEach(function(c,i){
    var k=c.cat||"未分類";
    if(!byCat[k]){ byCat[k]=[]; order.push(k) }
    byCat[k].push({c:c,i:i});
  });
  return order.map(function(k){
    return '<optgroup label="'+esc(k)+'">'+
      byCat[k].map(function(o){
        var tag=o.c.hourly?("　每小時 $"+o.c.hourly.toLocaleString())
                          :(o.c.price?"　$"+o.c.price.toLocaleString():"");
        return '<option value="'+o.i+'"'+(String(sel)===String(o.i)?" selected":"")+'>'+
          esc(o.c.label)+tag+'</option>';
      }).join("")+'</optgroup>';
  }).join("");
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
        值可能是數字（舊）或 {t,tPM,ev,capAM,capPM,capPM2,capEve}（上午/下午分開＋
        含晚上＋各時段手動上限），三種都原封不動收下，要用的時候再交給 bkSchedVal 正規化。
        2026-08-21 修正：這裡曾經漏轉 tPM，物件格式重建時只留了 t/ev，
        害每次重新整理，下午老師數都會被讀回跟上午一樣，等於改了也沒用——
        Firebase 裡其實一直是對的，只是這裡讀出來的時候被砍掉了。
        2026-08-27：capAM/capPM/capPM2/capEve 這幾個手動上限欄位也曾經漏轉，
        是同一種疏漏——重新整理後手動設的上限會看起來像沒設過，一起補上。 */
  try{
    var j=await (await fetch(bkf("/schedule.json"))).json();
    if(j)for(var k in j){
      var v2=j[k];
      if(v2===null||v2===undefined||v2==="")continue;
      m[String(k).replace(/-/g,"/")]=
        (typeof v2==="object")?{t:Math.max(0,+v2.t||0),
          tPM:(v2.tPM==null?Math.max(0,+v2.t||0):Math.max(0,+v2.tPM||0)),
          ev:Math.max(0,+v2.ev||0),
          capAM:v2.capAM!=null?Math.max(0,+v2.capAM||0):null,
          capPM:v2.capPM!=null?Math.max(0,+v2.capPM||0):null,
          capPM2:v2.capPM2!=null?Math.max(0,+v2.capPM2||0):null,
          capEve:v2.capEve!=null?Math.max(0,+v2.capEve||0):null}
                              :Math.max(0,+v2||0);
    }
  }catch(e){}
  bkSched=m;
}
/* 班表的值 → {t, ev}。數字就是舊格式，晚上一律當沒開。 */
/* tPM（下午老師數）2026-08-17 新增：老師常常早上有排、下午沒排，
   原本白天三個時段（10-12、14-16、16-18）共用同一個數字，沒辦法反映這種情況。
   舊資料只有 t，沒有 tPM 就直接沿用 t（等於維持舊行為：整個白天同一個數字）。 */
function bkSchedVal(d){
  var v=bkSched?bkSched[d]:null;
  if(v==null)return null;
  if(typeof v==="object")return {t:Math.max(0,+v.t||0),
    tPM:(v.tPM==null?Math.max(0,+v.t||0):Math.max(0,+v.tPM||0)),
    ev:Math.max(0,+v.ev||0),
    capAM:v.capAM!=null?Math.max(0,+v.capAM||0):null,
    capPM:v.capPM!=null?Math.max(0,+v.capPM||0):null,
    capPM2:v.capPM2!=null?Math.max(0,+v.capPM2||0):null,
    capEve:v.capEve!=null?Math.max(0,+v.capEve||0):null};
  return {t:Math.max(0,+v||0),tPM:Math.max(0,+v||0),ev:0,capAM:null,capPM:null,capPM2:null,capEve:null};
}
/* 沒特別指定的日子，看星期幾 */
function bkBaseOn(d){
  var p=String(d).split("/").map(Number);
  var w=new Date(p[0],p[1]-1,p[2]).getDay();
  return BK_BASE_WEEK[w]==null?1:BK_BASE_WEEK[w];
}
function bkTeachersOn(d){ /* 上午（10:00-12:00） */
  var v=bkSchedVal(d);
  return v?v.t:bkBaseOn(d);
}
function bkTeachersOnPM(d){ /* 下午（14:00-16:00、16:00-18:00） */
  var v=bkSchedVal(d);
  return v?v.tPM:bkBaseOn(d);
}
/* 晚上有幾位老師。沒排就是 0，代表那天晚上不開。 */
function bkEveOn(d){ var v=bkSchedVal(d); return v?v.ev:0 }
/* 老師排班算出來的「理論上限」，不受手動降上限影響——設定手動上限的畫面
   要顯示這個當參考基準，不然大熊看到的會是降過的數字，搞不清楚老師排班本身收幾位 */
function bkRawCapOf(d){ return Math.min(bkTeachersOn(d)*CAP_PER_TEACHER,SEAT_CAP) }
function bkRawCapOfPM(d){ return Math.min(bkTeachersOnPM(d)*CAP_PER_TEACHER,SEAT_CAP) }
function bkRawEveCap(d){ return Math.min(bkEveOn(d)*CAP_PER_TEACHER,SEAT_CAP) }
/* 實際生效的上限＝老師排班上限，跟大熊手動設的上限，取比較小的那個。
   手動上限是用來處理「位子還夠，但這時段已經有比較需要顧的學員，先別再排更多人」
   的情況，跟老師排班是兩件獨立的事——不會互相蓋掉對方。 */
function bkCapOf(d){ var v=bkSchedVal(d),b=bkRawCapOf(d); return (v&&v.capAM!=null)?Math.min(b,v.capAM):b }
function bkCapOfPM(d){ var v=bkSchedVal(d),b=bkRawCapOfPM(d); return (v&&v.capPM!=null)?Math.min(b,v.capPM):b }
/* 16:00-18:00 專用的手動上限，跟 14:00-16:00 的 capPM 是各自獨立的欄位，
   老師排班算出來的天花板（bkRawCapOfPM）還是共用同一套，因為兩個時段
   physically 是同一批下午老師，只有「要不要先限縮這個時段」是分開決定的。 */
function bkCapOfPM2(d){ var v=bkSchedVal(d),b=bkRawCapOfPM(d); return (v&&v.capPM2!=null)?Math.min(b,v.capPM2):b }
function bkEveCap(d){ var v=bkSchedVal(d),b=bkRawEveCap(d); return (v&&v.capEve!=null)?Math.min(b,v.capEve):b }
/* 這一天實際存在的時段。晚上有排才會多一格，白天三格維持原本一律顯示
   （容量是 0 就顯示「休」，不是把格子整個藏起來）。 */
function bkSlotsOn(d){ return bkEveOn(d)>0?SLOTS.concat([EVE_SLOT]):SLOTS.slice() }
/* ══ 一筆預約可能橫跨好幾個時段（2026-08-10）══════════════
   有人一畫就是一整天，三個時段都要佔。原本只有 slot 和 slot2
   兩個欄位，裝不下第三個。

   改成存 slots 陣列，同時保留 slot／slot2＝前兩個，
   舊的報表、行事曆、通知卡片照樣讀得到，不用一次全部改完。
   讀取端一律走這支，兩種格式都認得。 */
function bkSlotsOf(b){
  if(b&&Array.isArray(b.slots)&&b.slots.length)
    return b.slots.filter(Boolean);
  return [b&&b.slot,b&&b.slot2].filter(Boolean);
}
/* 這筆預約有沒有佔到某個表定時段 */
function bkHitsSlot(b,slot){
  return bkSlotsOf(b).some(function(x){ return x===slot||bkBase(x)===slot });
}
/* 依開始時間排序，順序亂填也不影響 */
function bkSortSlots(list){
  return list.slice().sort(function(a,b){
    var f=function(x){ var m=String(x).match(/(\d{1,2}):(\d{2})/); return m?+m[1]*60+ +m[2]:9999 };
    return f(a)-f(b);
  });
}
/* 某個時段的容量。晚上走晚上的老師數，10-12 走上午，14-16／16-18 走下午。
   slot 可能是手動登記那種加開時段（例如 09:30-11:30），先用 bkBase 對回表定時段。 */
function bkRawCapOfSlot(d,slot){
  if(slot===EVE_SLOT)return bkRawEveCap(d);
  var base=bkBase(slot)||slot;
  return base==="10:00-12:00"?bkRawCapOf(d):bkRawCapOfPM(d);
}
function bkCapOfSlot(d,slot){
  if(slot===EVE_SLOT)return bkEveCap(d);
  var base=bkBase(slot)||slot;
  if(base==="10:00-12:00")return bkCapOf(d);
  if(base==="16:00-18:00")return bkCapOfPM2(d);
  return bkCapOfPM(d);
}
/* 三個數字（上午／下午／晚上）packing成要存進 Firebase 的格式：
   上午下午一樣、晚上沒開，就存成單一數字（維持舊格式，資料乾淨）；
   其他情況才用物件存三個欄位分開。 */
function bkSchedPack(tAM,tPM,ev,capAM,capPM,capEve,capPM2){
  tAM=Math.max(0,+tAM||0); tPM=Math.max(0,+tPM||0); ev=Math.max(0,+ev||0);
  var hasCap=capAM!=null||capPM!=null||capEve!=null||capPM2!=null;
  if(tAM===tPM&&ev===0&&!hasCap)return tAM;
  var o={t:tAM,tPM:tPM,ev:ev};
  if(capAM!=null)o.capAM=capAM;
  if(capPM!=null)o.capPM=capPM;
  if(capPM2!=null)o.capPM2=capPM2;
  if(capEve!=null)o.capEve=capEve;
  return o;
}
/* 改上午老師數：先改本地讓畫面立刻反應，再寫回 Firebase */
async function bkSetTeachers(dateStr,val){
  if(!bkSched)bkSched={};
  if(val===null){ delete bkSched[dateStr] }
  else{
    var cur0=bkSchedVal(dateStr)||{};
    bkSched[dateStr]=bkSchedPack(val,bkTeachersOnPM(dateStr),bkEveOn(dateStr),cur0.capAM,cur0.capPM,cur0.capEve,cur0.capPM2);
  }
  await bkSchedWrite(dateStr,val===null?null:bkSched[dateStr]);
}
/* 改下午老師數，上午跟晚上不動 */
async function bkSetTeachersPM(dateStr,val){
  if(!bkSched)bkSched={};
  var cur1=bkSchedVal(dateStr)||{};
  var packed=bkSchedPack(bkTeachersOn(dateStr),val,bkEveOn(dateStr),cur1.capAM,cur1.capPM,cur1.capEve,cur1.capPM2);
  /* 三個都跟星期預設一樣、又沒設手動上限 → 整筆刪掉，格子回到「未指定」 */
  if(typeof packed==="number"&&packed===bkBaseOn(dateStr)&&bkSchedVal(dateStr)){
    delete bkSched[dateStr];
    await bkSchedWrite(dateStr,null);
    return;
  }
  bkSched[dateStr]=packed;
  await bkSchedWrite(dateStr,packed);
}
/* 只改晚上，上午下午不動 */
async function bkSetEve(dateStr,ev){
  if(!bkSched)bkSched={};
  var cur2=bkSchedVal(dateStr)||{};
  var packed=bkSchedPack(bkTeachersOn(dateStr),bkTeachersOnPM(dateStr),ev,cur2.capAM,cur2.capPM,cur2.capEve,cur2.capPM2);
  /* 晚上關掉、上午下午又都是星期預設值、又沒設手動上限 → 整筆刪掉，格子回到「未指定」 */
  if(typeof packed==="number"&&packed===bkBaseOn(dateStr)&&bkSchedVal(dateStr)){
    delete bkSched[dateStr];
    await bkSchedWrite(dateStr,null);
    return;
  }
  bkSched[dateStr]=packed;
  await bkSchedWrite(dateStr,packed);
}
async function bkSchedWrite(dateStr,val){
  var path=bkf("/schedule/"+dateStr.replace(/\//g,"-")+".json");
  try{
    if(val===null)await fetch(path,{method:"DELETE"});
    else await fetch(path,{method:"PUT",
      headers:{"Content-Type":"application/json"},body:JSON.stringify(val)});
  }catch(e){ alert("班表儲存失敗，請檢查網路連線") }
}
/* 這個時段（10:00-12:00／14:00-16:00／16:00-18:00／晚上）對到 bkSchedVal
   裡哪一個手動上限欄位。14:00-16:00 跟 16:00-18:00 以前共用 capPM，
   2026-08-27 拆開成 capPM／capPM2，兩個時段的手動上限才能各自獨立設定
   （老師排班本身還是共用同一個下午老師數，這裡只拆手動上限這一層）。 */
function bkCapKind(slot){
  if(slot===EVE_SLOT)return "capEve";
  var base=bkBase(slot)||slot;
  if(base==="10:00-12:00")return "capAM";
  if(base==="16:00-18:00")return "capPM2";
  return "capPM";
}
/* 手動限某個時段最多收幾位，跟老師排班算出來的上限互相取較小值。
   用來處理「位子還夠，但這個時段已經有比較需要顧的學員，先別再排更多人進來」，
   跟老師人數是兩件獨立的事，不會互相蓋掉。這份資料跟客人線上預約共用同一個
   /schedule 節點，改了之後客人那邊看到的名額會馬上跟著變少。
   val 傳 null ＝清除這個時段的手動上限，恢復照老師排班算。 */
async function bkSetCap(dateStr,slot,val){
  if(!bkSched)bkSched={};
  var cur=bkSchedVal(dateStr)||{t:bkBaseOn(dateStr),tPM:bkBaseOn(dateStr),ev:0,capAM:null,capPM:null,capPM2:null,capEve:null};
  var kind=bkCapKind(slot);
  var capAM=kind==="capAM"?val:cur.capAM;
  var capPM=kind==="capPM"?val:cur.capPM;
  var capPM2=kind==="capPM2"?val:cur.capPM2;
  var capEve=kind==="capEve"?val:cur.capEve;
  var packed=bkSchedPack(cur.t,cur.tPM,cur.ev,capAM,capPM,capEve,capPM2);
  if(typeof packed==="number"&&packed===bkBaseOn(dateStr)&&bkSchedVal(dateStr)){
    delete bkSched[dateStr];
    await bkSchedWrite(dateStr,null);
    return;
  }
  bkSched[dateStr]=packed;
  await bkSchedWrite(dateStr,packed);
}
function bkCapOpen(dsNow,sl){
  var kind=bkCapKind(sl);
  var cur=bkSchedVal(dsNow);
  var curCap=cur?cur[kind]:null;
  var rawCap=kind==="capEve"?bkRawEveCap(dsNow):(kind==="capAM"?bkRawCapOf(dsNow):bkRawCapOfPM(dsNow));
  bkSheet('<h3 style="margin:0 0 4px">'+esc(sl)+'　手動限人數</h3>'+
    '<div class="bk-hint" style="padding:0 2px 14px">老師排班算出來可收 '+rawCap+' 位。'+
    (curCap!=null
      ?(curCap<rawCap
        ?'目前手動限到 <b>'+curCap+'</b> 位，比排班上限少，正在生效中。'
        :'目前存的數字是 '+curCap+'，跟排班上限一樣多，等於沒有實際限制。')
      :'目前沒有額外限制。')+
    '<br>要打的數字要比 '+rawCap+' 小才會真的擋住新預約，例如已經約了幾位就先打幾位。'+
    '設定後這個時段的客人線上預約名額會馬上跟著變少，老師排班不受影響，'+
    '純粹是「這個時段先不要再排更多人進來」。</div>'+
    '<div class="bk-f"><label>手動上限（留空＝不限制，照老師排班的 '+rawCap+' 位）</label>'+
      '<input id="bkCapVal" inputmode="numeric" placeholder="例如 3" value="'+(curCap!=null?curCap:"")+'"></div>'+
    '<div class="bk-act"><button class="bk-cancel" id="bkCapX">取消</button>'+
      '<button class="bk-save" id="bkCapOK">儲存</button></div>');
  document.getElementById("bkCapX").onclick=bkClose;
  document.getElementById("bkCapOK").onclick=async function(){
    var raw=document.getElementById("bkCapVal").value.trim();
    var val=raw===""?null:Math.max(0,+raw||0);
    await bkSetCap(dsNow,sl,val);
    bkClose(); bkRender();
  };
}
/* 那個時段還剩幾位 */
function bkSlotInfo(dateStr,slot,excludeId){
  var cap=bkCapOfSlot(dateStr,slot);
  var rows=bkList.filter(function(b){
    return b.date===dateStr&&
      bkHitsSlot(b,slot)&&
      b.status!=="cancelled"&&b.status!=="expired"&&
      b.id!==excludeId;
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
  var arr=Object.keys(all).map(function(k){ var o=all[k]; o.id=k; return o })
    .filter(function(b){ return b.status!=="cancelled" && b.status!=="expired" });
  /* 每一天有幾組幾位。反正整包都抓回來了，順手算一算，
     日期月曆才有東西可以顯示，不用再跑一次資料庫。 */
  bkByDate={};
  arr.forEach(function(b){
    var k=String(b.date||""); if(!k)return;
    if(!bkByDate[k])bkByDate[k]={groups:0,people:0,done:0};
    bkByDate[k].groups++;
    bkByDate[k].people+=(+b.people||0);
    if(b.checkout)bkByDate[k].done++;
  });
  bkList=arr.filter(function(b){ return b.date===d })
    .sort(function(a,b){ return String(a.slot).localeCompare(String(b.slot)) });
  bkAllWeb=arr.filter(function(b){ return b.source==="web" });
  bkUpdateNewBadge();
  bkStartLiveWatch();
}

/* ══ 客人自己用 LINE 預約的提醒紅點 ══════════════════════
   老闆不想收 LINE 個人／群組推播，改成後台這裡直接顯示：
   距離上次點開「已讀」，客人自己送出的新預約（source==="web"，
   手動登記的 source==="manual" 不算，那些是自己打的，不用提醒自己）
   有幾筆。用 ts（送出時間的 ISO 字串）比字典序就能判斷先後，
   不用額外存 id 對照表。 */
var bkAllWeb=[];
var BK_SEEN_KEY="otto2_bk_lastSeenTs";
function bkIsNewWeb(b){
  return !!(b&&(b.source==="web"||b.source==="ai-chat")&&String(b.ts||"")>(localStorage.getItem(BK_SEEN_KEY)||""));
}
function bkUpdateNewBadge(){
  var badge=document.getElementById("bk-new-badge"); if(!badge)return;
  var lastSeen=localStorage.getItem(BK_SEEN_KEY)||"";
  var n=bkAllWeb.filter(function(b){ return String(b.ts||"")>lastSeen }).length;
  if(n>0){ badge.textContent=n>99?"99+":n; badge.style.display="inline-block" }
  else badge.style.display="none";
}
function bkClearNewBadge(){
  var maxTs=bkAllWeb.reduce(function(m,b){ return String(b.ts||"")>m?String(b.ts):m },
    localStorage.getItem(BK_SEEN_KEY)||"");
  localStorage.setItem(BK_SEEN_KEY,maxTs);
  bkUpdateNewBadge();
  bkRender(); /* 讓卡片上的 NEW 標籤跟著消失 */
}
window.bkClearNewBadge=bkClearNewBadge;

/* ══ 即時監聽：後台開著就馬上跳提醒 ══════════════════════
   原本紅點只有在手動整理頁面時才會更新，等於還是要自己想到要看。
   這裡改用 Firebase REST 的即時串流（帶 Accept:text/event-stream
   的 GET 請求會變成 SSE），瀏覽器原生 EventSource 就能接，
   不用另外載入完整的 Firebase SDK。斷線瀏覽器會自動重連，不用自己處理。
   跟公開網址、跟現有的 bkf("/bookings.json") 是同一份資料，
   不用額外的後端或密鑰。 */
var bkSSE=null;
function bkStartLiveWatch(){
  if(bkSSE||typeof EventSource==="undefined")return;
  try{
    bkSSE=new EventSource(bkf("/bookings.json"));
    bkSSE.addEventListener("put",bkHandleSSE);
    bkSSE.addEventListener("patch",bkHandleSSE);
  }catch(e){ console.warn("即時監聽新預約失敗：",e&&e.message); }
}
function bkHandleSSE(e){
  var msg; try{ msg=JSON.parse(e.data); }catch(err){ return }
  var path=msg.path, data=msg.data;
  var fresh=[];
  if(path==="/"){
    /* 剛連上線，Firebase 會先送整包現有資料當基準 */
    Object.keys(data||{}).forEach(function(k){ var b=data[k]; if(b){ b=Object.assign({},b,{id:k}); fresh.push(b) } });
  }else{
    /* 之後只會送有變動的那一小段，path 類似 "/-Nabc123"（整筆新增/覆蓋）
       或 "/-Nabc123/checkout"（只改了子欄位）。只有整筆那一層才算「新增一筆預約」，
       只改子欄位（例如核銷、報到）不算新預約，不用再跳一次提醒。 */
    var parts=path.replace(/^\//,"").split("/");
    if(parts.length===1&&parts[0]&&data&&typeof data==="object"){
      fresh.push(Object.assign({},data,{id:parts[0]}));
    }
  }
  /* 客人自己取消（/liff/cancelBooking 寫的 cancelledBy:"customer"）跟「新預約」
     是不同的事件，不能塞進下面 freshWeb 那條——那條只認整包完整預約物件、
     而且要 source==="web" 且 ts 比上次看到的新，客人取消時 patch 進來的
     data 通常只有 status/cancelledAt/cancelledBy 這幾個欄位，沒有 source/ts，
     會被那條的條件擋掉，行政永遠不會知道客人自己把預約取消了。 */
  if(data&&typeof data==="object"&&data.cancelledBy==="customer"){
    var cancelId=path.replace(/^\//,"").split("/")[0]||"";
    var known=bkList.filter(function(x){ return x.id===cancelId })[0];
    var nm=(known&&known.customer&&known.customer.name)||"客人";
    var when=known?(known.date+"　"+(known.actualTime||known.slot)):"";
    bkList=bkList.filter(function(x){ return x.id!==cancelId });
    bkNotifyCancelDesktop(nm,when);
    var todayTab2=document.querySelector('.tab[data-tab="today"]');
    if(todayTab2&&todayTab2.classList.contains("active")&&!bkBusy)bkRender();
  }
  var lastSeen=localStorage.getItem(BK_SEEN_KEY)||"";
  var freshWeb=fresh.filter(function(b){
    return b&&b.source==="web"&&b.status!=="cancelled"&&b.status!=="expired"&&String(b.ts||"")>lastSeen; });
  if(!freshWeb.length)return;
  var today=ds(bkDate);
  freshWeb.forEach(function(b){
    if(!bkAllWeb.some(function(x){ return x.id===b.id }))bkAllWeb.push(b);
    /* 直接把 SSE 推來的這筆併進目前看的清單，不用整頁重新讀取——
       如果剛好碰到另一次 bkRender() 還沒讀完（bkBusy），
       整頁重畫會被那次的忙碌鎖擋掉、悄悄漏接這筆，所以不能只靠呼叫 bkRender() 了事。 */
    if(b.date===today&&!bkList.some(function(x){ return x.id===b.id })){
      bkList.push(b);
      bkList.sort(function(a,c){ return String(a.slot).localeCompare(String(c.slot)) });
    }
    var dk=String(b.date||"");
    if(dk){
      if(!bkByDate[dk])bkByDate[dk]={groups:0,people:0,done:0};
      bkByDate[dk].groups++;
      bkByDate[dk].people+=(+b.people||0);
    }
  });
  bkUpdateNewBadge();
  bkNotifyDesktop(freshWeb);
  /* 如果現在正好停在「今日排課」，直接重畫一次，新卡片跟 NEW 標籤馬上跳出來，
     不用手動按重新讀取；已經有其他 bkRender() 在跑的話就不用重複觸發，
     等那次跑完自然就會用上面剛併好的資料畫出來。 */
  var todayTab=document.querySelector('.tab[data-tab="today"]');
  if(todayTab&&todayTab.classList.contains("active")&&!bkBusy)bkRender();
}

/* ══ 桌面通知 ══════════════════════════════════════════
   要瀏覽器授權過才能跳系統通知，第一次用要點一下「開啟」按鈕
   （不能頁面一載入就自己彈權限視窗，Chrome 會擋，體驗也不好）。
   使用者按「✕」關掉提示的話記住起來，不會每次開後台都再問一次。 */
var BK_NOTIF_DISMISS_KEY="otto2_bk_notifDismissed";
function bkNotifDismissed(){ return !!localStorage.getItem(BK_NOTIF_DISMISS_KEY) }
function bkNotifBannerHtml(){
  if(typeof Notification==="undefined")return "";
  if(Notification.permission!=="default"||bkNotifDismissed())return "";
  return '<div class="bk-notifbar"><span>🔔 開啟桌面通知，有新預約後台開著就會馬上跳提醒</span>'+
    '<button class="bk-notifbtn" id="bkNotifOn">開啟</button>'+
    '<button class="bk-notifx" id="bkNotifX">✕</button></div>';
}
function bkNotifyDesktop(list){
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
  try{
    if(list.length===1){
      var b=list[0], nm=(b.customer&&b.customer.name)||"客人";
      new Notification("新預約："+nm,{body:(b.date||"")+"　"+(b.slot||"")+"　"+(b.people||"?")+" 位"});
    }else{
      new Notification("有 "+list.length+" 筆新預約",{body:"點開後台「今日排課」查看"});
    }
  }catch(e){}
}
/* 客人自己取消預約，行政不能完全不知道，不然材料人力還是照舊準備 */
function bkNotifyCancelDesktop(name,when){
  if(typeof Notification==="undefined"||Notification.permission!=="granted")return;
  try{
    new Notification("客人自己取消了預約："+name,{body:when||"點開今日排課確認"});
  }catch(e){}
}
var bkByDate={};

/* ══ 日期月曆（2026-08-10）══════════════════════════════
   原本只能一天一天按 ‹ ›，要看月底得按二十幾次。
   點日期就攤開整個月，每一格顯示那天幾組幾位，直接跳過去。

   數字是 bkLoad 順手算的，不另外查資料庫。 */
function bkDatePick(){
  var cur=new Date(bkDate.getTime());
  function draw(){
    var y=cur.getFullYear(), m=cur.getMonth();
    var first=new Date(y,m,1), pad=(first.getDay()+6)%7, days=new Date(y,m+1,0).getDate();
    var todayK=ds(new Date()), selK=ds(bkDate);
    var h='<div class="bk-sheet-h"><b>選日期</b>'+
      '<button class="bk-x" id="dpX">✕</button></div>'+
      '<div class="bk-cbar">'+
        '<button class="bk-nav" id="dpPrev">‹</button>'+
        '<div class="bk-ctitle">'+y+' 年 '+(m+1)+' 月</div>'+
        '<button class="bk-nav" id="dpNext">›</button>'+
        '<button class="bk-nav bk-tdy" id="dpToday">今天</button>'+
      '</div><div class="bk-cgrid">';
    ["一","二","三","四","五","六","日"].forEach(function(w){
      h+='<div class="bk-cwd">'+w+'</div>' });
    for(var i=0;i<pad;i++)h+='<div class="bk-mday void"></div>';
    for(var i2=1;i2<=days;i2++){
      var k=y+"/"+String(m+1).padStart(2,"0")+"/"+String(i2).padStart(2,"0");
      var st=bkByDate[k];
      var cls="bk-mday"+(k===todayK?" now":"")+(k===selK?" set":"")+(st?"":" off");
      h+='<button class="'+cls+'" data-d="'+k+'">'+
         '<span class="d">'+i2+'</span>'+
         (st?'<span class="n">'+st.groups+'</span><span class="c">'+st.people+' 位</span>'
            :'<span class="n">·</span><span class="c">—</span>')+
         '</button>';
    }
    h+='</div><div class="bk-cfoot">數字是「幾組・幾位」。點任一天直接跳過去。</div>';
    bkSheet(h);
    document.getElementById("dpX").onclick=bkClose;
    document.getElementById("dpPrev").onclick=function(){ cur.setMonth(cur.getMonth()-1); draw() };
    document.getElementById("dpNext").onclick=function(){ cur.setMonth(cur.getMonth()+1); draw() };
    document.getElementById("dpToday").onclick=function(){ cur=new Date(); draw() };
    document.querySelectorAll(".bk-cgrid .bk-mday[data-d]").forEach(function(el){
      el.onclick=function(){
        var p2=el.dataset.d.split("/");
        bkDate=new Date(+p2[0],+p2[1]-1,+p2[2]);
        bkClose(); bkRender();
      } });
  }
  draw();
}
/* 之前有 if(bkMembers)return，一整個分頁只抓一次、之後全部吃快取。
   問題是：姓名搜尋（bkSearch）只查這份快取，電話查會員（bkMember）卻是
   每次都直接打伺服器。行政開著同一頁很久，中途才新建檔的會員，
   用姓名搜尋會查不到（快取裡沒有這個人），改用電話查卻查得到、
   名字也顯示得出來——兩條路徑一個吃快取一個不吃，才會對不起來。
   這裡改成每次呼叫都重新抓，讓姓名搜尋跟電話查詢看到的是同一份最新名單。 */
async function bkLoadMembers(){
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
/* 這筆預約真正對得到會員資料庫的電話：優先用手動登記時already配對好的
   memberPhone，沒有的話就正規化客人自己填的電話去比對索引，
   兩邊都沒有就傳回客人填的原始電話（讓 bkMember 自己去查，查不到就查不到）。 */
function bkResolvedPhone(b){
  if(b.memberPhone)return b.memberPhone;
  var k=bkNorm(b.customer&&b.customer.phone);
  if(k&&bkIndex[k])return bkIndex[k];
  return (b.customer&&b.customer.phone)||"";
}
/* 點客人姓名看目前餘額，不用切去會員分頁或等核銷完才看得到 */
async function bkShowBalance(phone,name){
  if(!phone){ alert("這筆沒有留可對應的電話，查不到會員資料。"); return }
  bkSheet('<h3 style="margin:0 0 2px">查詢中…</h3>');
  var m=await bkMember(phone);
  if(!m){
    bkSheet('<h3 style="margin:0 0 2px">'+esc(name||"")+'</h3>'+
      '<div class="bk-info">'+esc(phone)+'　查無會員資料，可能還沒建檔。</div>'+
      '<div class="bk-act"><button class="bk-cancel" id="bkBalX">關閉</button></div>');
    document.getElementById("bkBalX").onclick=bkClose;
    return;
  }
  var c=m.cache||{};
  /* 防止行政休假時老闆代發點數、隔天行政沒看到標記又重發一次：
     一點進名字就把入會時間、上次發放點數時間攤在最上面，36小時內發過的用紅字警示。 */
  var lastSell=(typeof mbLastSell==="function")?mbLastSell(m):null;
  var noteLine="";
  if(m.createdAt)noteLine+="入會 "+mbFmtAt(m.createdAt);
  if(lastSell){
    var hrs=mbHoursSince(lastSell.at);
    noteLine+=(noteLine?"　・　":"")+
      (hrs<=36
        ?'<span style="color:var(--red);font-weight:700">⚠ '+Math.round(hrs)+' 小時前發過點數</span>'
        :"上次發放 "+mbFmtAt(lastSell.at))+
      "・"+esc(lastSell.by||"");
  }
  bkSheet('<h3 style="margin:0 0 2px">'+esc(m.name||name||"")+'</h3>'+
    '<div class="bk-sh2">'+esc(phone)+'</div>'+
    (noteLine?'<div class="muted" style="font-size:12.5px;margin-top:2px">'+noteLine+'</div>':'')+
    '<div class="bk-stat" style="margin:14px 0">'+
      '<div><b>'+(+c.points||0).toLocaleString()+'</b><span>點數</span></div>'+
      '<div><b>'+(+c.sessions||0)+'</b><span>堂數</span></div>'+
      '<div><b>'+(+c.bonus||0).toLocaleString()+'</b><span>紅利</span></div>'+
    '</div>'+
    '<div class="bk-act">'+
      (bkCan("sellPlan")?'<button class="bk-save" id="bkBalSell">賣方案</button>':'')+
      '<button class="bk-cancel" id="bkBalX">關閉</button></div>');
  document.getElementById("bkBalX").onclick=bkClose;
  var sellBtn=document.getElementById("bkBalSell");
  if(sellBtn)sellBtn.onclick=async function(){ await bkSellPlanFor(phone) };
}
/* 銷課旁邊的「賣方案」快捷鈕，直接借用會員分頁那套介面，
   member.js 沒有另外包 IIFE，這裡可以直接呼叫 mbSell。
   注意：mbSell 只認 mbList 裡已經存在的會員，找不到就直接 return、完全沒反應——
   新客（預約卡片上有 NEW 標籤）通常還沒建過會員檔，按這顆鈕會像沒反應一樣，
   容易被誤會成系統壞掉。這裡改成找不到會員就先用預約單上的姓名電話幫他建一筆，
   跟手動走「新增會員」再賣方案的結果完全一樣，只是省掉多開一個表單重打一次電話姓名。 */
async function bkSellPlanFor(phone,name){
  if(!phone){ alert("這筆沒有留可對應的電話，沒辦法賣方案，請先在「修改」裡幫客人補電話。"); return }
  if(typeof mbLoad==="function")await mbLoad();
  if(typeof mbSell!=="function"){ alert("會員模組還沒載入，請重新整理頁面再試一次。"); return }
  var p=mbNorm(phone);
  if(!mbList.some(function(m){return m.phone===p})){
    var rec={phone:p,name:name||"",note:"",createdAt:mbNow(),cache:{points:0,sessions:0,bonus:0}};
    try{
      await fetch(mbf("/members/"+p+".json"),{method:"PUT",
        headers:{"Content-Type":"application/json"},body:JSON.stringify(rec)});
    }catch(e){ alert("這位客人還沒有會員資料，系統想幫他自動建立但失敗了，沒辦法賣方案：\n"+e.message); return }
    mbList.push({phone:p,name:name||"",note:"",points:0,sessions:0,bonus:0,ledger:{},createdAt:rec.createdAt});
  }
  bkClose();
  mbSell(p);
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
/* 內建值只是備援。試算表有「舊方案單價」這個分頁就以那邊為準——
   價格會隨著查證陸續修正（45 堂原本以為 40,500，實際是 42,000），
   每次都要改程式太慢，而且改錯了你也看不出來。 */
var BK_TKT_PLAN_BUILTIN = [
  { name:"高階30堂",      months:12, mult:1,
    rules:[ { from:"2026-03-01", qty:30, price:30000 },
            {                    qty:30, price:28500 } ] },
  { name:"高階30堂(0.5)", months:12, mult:0.5,
    rules:[ { from:"2026-03-01", qty:30, price:30000 },
            {                    qty:30, price:28500 } ] },
  { name:"高階45堂",      months:15, mult:1,
    rules:[ { qty:45, price:42000 } ] },
  { name:"高階70堂",      months:24, mult:1,
    rules:[ { qty:70, price:60000 } ] },
  { name:"高階70堂(0.5)", months:24, mult:0.5,
    rules:[ { qty:70, price:60000 } ] }
];
var BK_TKT_PLAN = BK_TKT_PLAN_BUILTIN;
var bkTktPlanSrc = "內建";

/* ══ 從試算表讀舊方案單價 ══════════════════════════════
   分頁名稱：舊方案單價
   欄位（順序固定，標題列會自動略過）：
     A 票券名稱   ← 要跟夯客票券上的名稱一字不差
     B 總價       ← 這個方案賣多少
     C 堂數       ← 總共幾堂
     D 效期月數   ← 用來從到期日回推購買日
     E 生效日起   ← 空白＝一直有效；填 2026-03-01 代表那天起改這個價
     F 單堂價     ← 填了就直接用，不再拿總價除堂數（處理除不盡的狀況）
     G 備註       ← 給人看的，程式不讀

   同一個方案改過價，就多寫一列、填不同的生效日。
   系統會挑「生效日 ≤ 推估購買日」裡最晚的那一條。

   名稱帶 (0.5) 的自動當成半堂，單價自動對半，不用另外填。 */
async function bkLoadTktPlans(){
  var rows=[];
  try{ rows=await bkGviz("舊方案單價") }catch(e){ return }   /* 分頁不存在就沿用內建 */
  if(!rows.length)return;
  if(String(rows[0][0]||"").indexOf("票券")>=0||String(rows[0][0]||"").indexOf("名稱")>=0)rows.shift();

  var byName={}, order=[];
  rows.forEach(function(r){
    var name=String(r[0]||"").trim();
    if(!name)return;
    var price=bkNum(r[1]), qty=bkNum(r[2]);
    var unit=bkNum(r[5]);
    if(!qty&&!unit)return;                       /* 兩個都沒有就算不出單價 */
    if(!byName[name]){
      byName[name]={ name:name, months:bkNum(r[3])||0,
                     mult:/\(0?\.5\)/.test(name)?0.5:1, rules:[] };
      order.push(name);
    }
    if(!byName[name].months&&bkNum(r[3]))byName[name].months=bkNum(r[3]);
    byName[name].rules.push({
      from:String(r[4]||"").trim().replace(/\//g,"-"),
      qty:qty||1, price:price, unit:unit||0 });
  });
  if(!order.length)return;

  /* 生效日晚的排前面，比對時由上往下取第一個符合的 */
  order.forEach(function(n){
    byName[n].rules.sort(function(a,b){ return String(b.from||"").localeCompare(String(a.from||"")) });
  });
  BK_TKT_PLAN=order.map(function(n){ return byName[n] });
  bkTktPlanSrc="試算表";
}

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
  if(!best){
    /* 有堂數票券但完全不在對照表裡的，直接用堂數去方案設定比對 */
    var any=null;
    ts.forEach(function(t){ if(!any&&t&&t.kind==="session"&&/\d+\s*堂/.test(t.name||""))any=t });
    return any?bkPlanBySessions(any.name):null;
  }
  var buy=bkTktBuyDate(best.expiry,bestPlan.months);
  var rule=null;
  for(var i=0;i<bestPlan.rules.length;i++){
    var r=bestPlan.rules[i];
    if(!r.from){ rule=r; break }
    if(buy&&buy>=r.from){ rule=r; break }
  }
  if(!rule){
    /* 對照表沒這個方案 → 用堂數去方案設定找 */
    var byS=bkPlanBySessions(best.name);
    if(byS){ byS.buy=buy; return byS }
    return null;
  }
  /* 有填單堂價就直接用——42,000 ÷ 45 = 933.33，除不盡的自己指定比較準 */
  var unit=rule.unit?rule.unit:(rule.price/rule.qty);
  return { unit:Math.round(unit*(bestPlan.mult||1)),
           plan:best.name, qty:rule.qty, price:rule.price,
           buy:buy, src:bkTktPlanSrc, fromTicket:true };
}
/* ══ 用堂數去比對「方案設定」裡的方案 ══════════════════
   夯客的票券叫「高階45堂」，你在方案設定建的叫「純繪畫45堂」，
   名稱對不起來，但堂數是同一個數字。

   票券名稱裡的數字就是堂數，拿它去方案設定找堂數相同的方案，
   找到就用那個方案的售價算單堂。這樣你在方案設定維護價格，
   舊票券自動跟著走，不用再維護第二份對照表。

   只在「明細沒金額、試算表也沒填」的時候才會走到這裡。
   同一個堂數有好幾個方案（例如改過價各留一筆）就取售價最高的——
   寧可認列高一點被你發現去修，也不要默默少算。 */
function bkPlanBySessions(name){
  var m=String(name||"").match(/(\d+(?:\.\d+)?)\s*堂/);
  if(!m)return null;
  var want=+m[1];
  if(!want)return null;
  var half=/\(0?\.5\)/.test(String(name));
  var list=[];
  try{
    if(typeof mbPlans==="function")list=mbPlans()||[];
    else if(typeof S==="object"&&S&&S.plans)list=S.plans;
  }catch(e){ return null }
  var best=null;
  list.forEach(function(p){
    if(!p||p.active===false)return;
    if((+p.sessions||0)!==want)return;
    if(!(+p.price>0))return;
    if(!best||+p.price>+best.price)best=p;
  });
  if(!best)return null;
  return { unit:Math.round((+best.price)/want*(half?0.5:1)),
           plan:best.name||("方案 "+want+" 堂"), qty:want, price:+best.price,
           src:"方案設定", fromTicket:true, buy:"" };
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
  var tOn=bkTeachersOn(dsNow), tOnPM=bkTeachersOnPM(dsNow), tSet=!!(bkSched&&bkSched[dsNow]!=null);
  var totalPeople=bkList.reduce(function(s,b){return s+(+b.people||0)},0);
  var doneCount=bkList.filter(function(b){return b.checkout}).length;
  var sum=bkList.reduce(function(s,b){return s+(b.checkout?(+b.checkout.total||0):0)},0);
  var totKid=bkList.reduce(function(s,b){ var x=bkAK(b); return s+(+x.k||0) },0);
  var pplSub=totKid?"含小孩 "+totKid:"";
  /* 有沒有哪個時段爆掉。上午下午容量可能不一樣了，訊息裡把每個爆掉的
     時段各自的上限列出來，不能再用單一個 capNow 帶過。 */
  var slotsNow=bkSlotsOn(dsNow), eveNow=bkEveOn(dsNow);
  var overDetail=slotsNow.filter(function(s){
    return bkSlotInfo(dsNow,s).used>bkCapOfSlot(dsNow,s);
  }).map(function(s){ return s+"（上限"+bkCapOfSlot(dsNow,s)+"）" });

  root.innerHTML=
   bkNotifBannerHtml()+
   '<div class="bk-bar">'+
     '<button class="bk-nav" id="bkPrev">‹</button>'+
     '<div class="bk-date" id="bkDatePick" style="cursor:pointer" title="點一下開整個月"><b>'+ds(d)+'</b>'+
       '<span>（'+WD[d.getDay()]+'）'+(today?" · 今天":"")+' ▾</span></div>'+
     '<button class="bk-nav" id="bkNext">›</button>'+
     '<button class="bk-nav bk-tdy" id="bkToday">今天</button>'+
     '<button class="bk-nav bk-tdy" id="bkReload">重新讀取</button>'+
   '</div>'+
   '<div id="bkShortageBanner"></div>'+
   '<div class="bk-stat">'+
     '<div class="bk-tcard"><b>'+
       '<button class="bk-tbtn" id="bkTMinusAM">−</button>'+
       '<span class="bk-tnum">'+tOn+'</span>'+
       '<button class="bk-tbtn" id="bkTPlusAM">＋</button></b>'+
       '<span>上午老師・'+(tSet?"已指定":"預設")+'</span></div>'+
     '<div class="bk-tcard"><b>'+
       '<button class="bk-tbtn" id="bkTMinusPM">−</button>'+
       '<span class="bk-tnum">'+tOnPM+'</span>'+
       '<button class="bk-tbtn" id="bkTPlusPM">＋</button></b>'+
       '<span>下午老師・'+(tSet?"已指定":"預設")+
         (eveNow?'<br>晚上 '+eveNow+' 位':'')+'</span></div>'+
     '<div><b>'+bkList.length+'</b><span>預約組數</span></div>'+
     '<div><b>'+totalPeople+'</b><span>總人數'+(pplSub?"・"+pplSub:"")+'</span></div>'+
     '<div><b>'+doneCount+'/'+bkList.length+'</b><span>已核銷</span></div>'+
     '<div><b>$'+sum.toLocaleString()+'</b><span>本日核銷金額</span></div>'+
   '</div>'+
   (overDetail.length?'<div class="bk-over">⚠️ '+overDetail.join("、")+
     ' 超過表定上限，請確認人手。</div>':"")+
   '<button class="bk-add bk-add-top" id="bkAdd">＋ 手動登記</button>'+
   (function(){ var ci=0;
    /* 晚上沒排的日子，就算有人被登記到晚上時段也要看得到——
       所以這裡用「當天時段 ∪ 實際有預約的時段」，不會有預約被藏起來。 */
    var show=slotsNow.slice();
    if(show.indexOf(EVE_SLOT)<0&&bkList.some(function(b){
      return bkHitsSlot(b,EVE_SLOT) }))show.push(EVE_SLOT);
    return show.concat(["其他"]).map(function(sl){
      var g=bkList.filter(function(b){
        return sl==="其他"
          ? (!bkBase(b.slot)&&SLOTS.indexOf(b.slot)<0&&b.slot!==EVE_SLOT)
          : bkHitsSlot(b,sl) });
      if(!g.length)return "";
      var cls="bk-slot c"+(ci++%2);
      var n=g.reduce(function(s,b){return s+(+b.people||0)},0);
      var capS=bkCapOfSlot(dsNow,sl);
      var full=sl!=="其他"&&n>capS;
      /* 大人／小孩合計：跟 bkPplText 同一套算法，湊出這個時段的組成 */
      var aSum=0,kSum=0,akKnown=false;
      g.forEach(function(b){ var x=bkAK(b); if(x.a!=null||x.k!=null){akKnown=true; aSum+=(+x.a||0); kSum+=(+x.k||0)} });
      var akText=akKnown?("（大人 "+aSum+(kSum?"・小孩 "+kSum:"")+"）"):"";
      /* 每個時段預設收合，只看標題就知道這個時段人數夠不夠，
         點開才看到每一組客人的細節，安排位子時滑一輪比較快 */
      var slKey=dsNow+"|"+sl;
      var open=!!bkSlotOpen[slKey];
      var svNow=sl!=="其他"?bkSchedVal(dsNow):null;
      /* 存過手動上限不代表真的有限制到——設的數字如果跟老師排班算出來的
         上限一樣大，其實完全沒有生效，不該顯示🔒讓人誤會「已經鎖住了」 */
      var capIsSet=sl!=="其他"&&svNow&&svNow[bkCapKind(sl)]!=null&&svNow[bkCapKind(sl)]<bkRawCapOfSlot(dsNow,sl);
      return '<div class="'+cls+'"><div class="bk-sh" data-slk="'+esc(slKey)+'" style="cursor:pointer;user-select:none">'+
        '<span style="display:inline-block;width:14px">'+(open?"▼":"▶")+'</span>'+sl+
        (sl===EVE_SLOT?'<span class="bk-tag t" style="margin-left:6px">晚上</span>':'')+
        '　<span'+(full?' class="bk-shfull"':'')+'>'+
        n+(sl==="其他"?"":" / "+capS)+' 位'+(capIsSet?'🔒':'')+akText+(full?"・超載":"")+'</span>'+
        (sl!=="其他"?'<span class="bk-capbtn" data-capbtn="'+esc(slKey)+'">'+(capIsSet?"改上限":"設上限")+'</span>':'')+
        '</div>'+
        /* 座位區域方塊（吧台/畫架/教室/臨時桌）只要時段本身展開就一直看得到，
           下面整串學員登記卡片（含所有按鈕）才用三角形另外收合，
           掃一眼位子還夠不夠不用被一堆卡片內容擋住畫面 */
        (open?((sl!=="其他"?bkSeatBoardHtml(dsNow,sl,g):"")+
          (sl==="其他"||bkSeatDetailOpen[slKey]?g.map(bkCard).join(""):"")):"")+'</div>';
    }).join("");
   })()+
   (bkList.length?"":'<div class="bk-empty">這天沒有預約</div>');

  var nOn=document.getElementById("bkNotifOn");
  if(nOn)nOn.onclick=function(){ Notification.requestPermission().then(function(){ bkRender() }) };
  var nX=document.getElementById("bkNotifX");
  if(nX)nX.onclick=function(){ localStorage.setItem(BK_NOTIF_DISMISS_KEY,"1"); bkRender() };
  var dpEl=document.getElementById("bkDatePick");
  if(dpEl)dpEl.onclick=bkDatePick;
  document.getElementById("bkPrev").onclick=function(){ bkDate.setDate(bkDate.getDate()-1); bkRender() };
  document.getElementById("bkNext").onclick=function(){ bkDate.setDate(bkDate.getDate()+1); bkRender() };
  document.getElementById("bkToday").onclick=function(){ bkDate=new Date(); bkRender() };
  document.getElementById("bkReload").onclick=function(){ bkRefresh() };
  document.getElementById("bkTMinusAM").onclick=function(){
    bkSetTeachers(dsNow,Math.max(0,bkTeachersOn(dsNow)-1)); bkRender() };
  document.getElementById("bkTPlusAM").onclick=function(){
    bkSetTeachers(dsNow,Math.min(6,bkTeachersOn(dsNow)+1)); bkRender() };
  document.getElementById("bkTMinusPM").onclick=function(){
    bkSetTeachersPM(dsNow,Math.max(0,bkTeachersOnPM(dsNow)-1)); bkRender() };
  document.getElementById("bkTPlusPM").onclick=function(){
    bkSetTeachersPM(dsNow,Math.min(6,bkTeachersOnPM(dsNow)+1)); bkRender() };
  /* 不能直接掛 bkManual：onclick 會把事件物件當成第一個參數傳進去，
     被當成「要修改的預約 id」，找不到就整個結束，按了沒反應。 */
  document.getElementById("bkAdd").onclick=function(){ bkManual() };
  root.querySelectorAll("[data-slk]").forEach(function(el){ el.onclick=function(){
    bkSlotOpen[el.dataset.slk]=!bkSlotOpen[el.dataset.slk]; bkRender() } });
  root.querySelectorAll("[data-capbtn]").forEach(function(el){ el.onclick=function(e){
    e.stopPropagation(); /* 不要連帶觸發外層時段展開/收合 */
    var slk=el.dataset.capbtn, i=slk.indexOf("|");
    bkCapOpen(slk.slice(0,i),slk.slice(i+1));
  } });
  bkSeatBind(root);
  root.querySelectorAll("[data-at]").forEach(function(el){ el.onclick=function(){
    /* 再點一次已經亮著的那顆，變回「都沒標」，方便誤按了可以直接清掉，
       不用被迫選另一個將就。 */
    var cur=bkList.filter(function(x){return x.id===el.dataset.at})[0];
    var next=(cur&&cur.attend===el.dataset.v)?null:el.dataset.v;
    bkPatch("/bookings/"+el.dataset.at+".json",{attend:next}).then(bkRefresh) } });
  root.querySelectorAll("[data-ed]").forEach(function(el){ el.onclick=function(){ bkManual(el.dataset.ed) } });
  root.querySelectorAll("[data-dp]").forEach(function(el){ el.onclick=function(){ bkDeposit(el.dataset.dp) } });
  root.querySelectorAll("[data-ck]").forEach(function(el){ el.onclick=function(){ bkCheckout(el.dataset.ck) } });
  root.querySelectorAll("[data-vd]").forEach(function(el){ el.onclick=function(){ bkVoid(el.dataset.vd) } });
  root.querySelectorAll("[data-cx]").forEach(function(el){ el.onclick=function(){ bkCancel(el.dataset.cx) } });
  root.querySelectorAll("[data-sp]").forEach(function(el){ el.onclick=function(){
    var b=bkList.filter(function(x){return x.id===el.dataset.sp})[0]; if(!b)return;
    bkSellPlanFor(bkResolvedPhone(b),b.customer&&b.customer.name);
  } });
  root.querySelectorAll(".bk-nm").forEach(function(el){ el.onclick=function(){
    var b=bkList.filter(function(x){return x.id===el.dataset.bid})[0]; if(!b)return;
    bkShowBalance(bkResolvedPhone(b),(b.customer&&b.customer.name)||"");
  } });
  bkRenderShortageBanner();
}
window.bkRender=bkRender;

/* 未來備料預警的精簡版，放在今日排課最上面每次開頁都看得到（不用特地跑去庫存盤點分頁）。
   實際的加總/比對邏輯在 inventory.js 的 computeUpcomingShortages，這裡只負責顯示摘要，
   不重複算一次——不然公式改了要記得兩邊一起改，之前容量公式就在三個檔案重複實作吃過虧。 */
var BK_SHORTAGE_DAYS=7;
async function bkRenderShortageBanner(){
  var box=document.getElementById("bkShortageBanner"); if(!box)return;
  if(typeof computeUpcomingShortages!=="function")return; /* inventory.js 還沒載入/沒有材料配方功能 */
  var r=await computeUpcomingShortages(BK_SHORTAGE_DAYS);
  box=document.getElementById("bkShortageBanner"); if(!box)return; /* 等待期間可能已經切頁或換日期 */
  if(!r||r.error||!r.shortages||!r.shortages.length){ box.innerHTML=""; return; }
  var names=r.shortages.slice(0,4).map(function(x){return x.name+"差"+x.short+x.unit}).join("、");
  var more=r.shortages.length>4?" 等 "+r.shortages.length+" 項":"";
  box.innerHTML='<div class="bk-over" style="cursor:pointer" id="bkShortageGo">'+
    '📦 未來 '+BK_SHORTAGE_DAYS+' 天備料可能不夠：'+names+more+'，點這裡看詳細 →</div>';
  var go=document.getElementById("bkShortageGo");
  if(go)go.onclick=function(){ if(typeof switchTab==="function")switchTab("inventory") };
}

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

/* ══ 座位表（2026-08-14）══════════════════════════════════
   每個時段各自一張，人不會跨時段撞位子。
   規則：預設都排吧台，滿了才輪到畫架，畫架也滿了才輪到臨時桌；
   5-7 歲小朋友上選圖，不管吧台滿不滿都優先排吧台方便照顧
   （這只是建議值，畫面上還是能整個拖去別區）。
   手動登記沒有存 kidBands，這條規則只會對客人自己填的預約生效。
   指定過的位子存在 booking.seatArea，之後都以這個為準，
   不會因為別人異動又被重新建議洗掉。 */
/* 順位就是排滿的優先順序：吧台→畫架→教室滿了，才會用到臨時桌那 1 個位子。
   臨時桌只有 1 位、聽起來像應急用的，放在最後一順位比較合理；
   如果實際上你希望的排法不一樣，跟我說一聲就能調整順序。 */
var SEAT_AREAS=[{k:"吧台",cap:7},{k:"畫架",cap:5},{k:"教室",cap:5},{k:"臨時桌",cap:1}];
function bkSeatItemsName(b){
  return (b.items||[]).map(function(i){ return i.name||"" }).join("、");
}
/* 回傳 {byId:{bookingId:area}, counts:{area:人數}}。
   g 要是同一個時段裡的預約清單，順序就是畫面上排的順序。 */
/* 一組預約可能不只一位（例如媽媽帶兩個小孩一起訂），要佔掉的是
   「這麼多張椅子」，不是「這一筆預約」，所以人數要照 people 算，
   不能每筆都當成佔 1 個名額——不然兩位的預約看起來只佔一張椅子，
   吧台明明滿了畫面卻還說有空位。 */
function bkSeatPpl(b){
  var x=bkAK(b);
  return (x.a!=null||x.k!=null)?Math.max(1,(+x.a||0)+(+x.k||0)):Math.max(1,+b.people||1);
}
/* placements: {bookingId:[{area,n}, ...]}。平常一筆預約只會有一個 {area,n}，
   n＝整組人數；只有手動拆過位（seatSplit）的預約才會有 2 筆以上，
   同一張卡片會分別出現在好幾個區塊裡，各自只顯示那個區塊分到的人數。 */
function bkSeatAssign(g){
  var counts={}; SEAT_AREAS.forEach(function(a){ counts[a.k]=0 });
  var placements={};
  /* 先算已經手動指定過的（含拆位），佔掉名額 */
  g.forEach(function(b){
    if(b.seatSplit){
      var arr=[];
      SEAT_AREAS.forEach(function(a){
        var n=+b.seatSplit[a.k]||0;
        if(n>0){ arr.push({area:a.k,n:n}); counts[a.k]+=n }
      });
      if(arr.length){ placements[b.id]=arr; return }
    }
    if(b.seatArea&&counts[b.seatArea]!=null){
      var ppl0=bkSeatPpl(b);
      placements[b.id]=[{area:b.seatArea,n:ppl0}]; counts[b.seatArea]+=ppl0;
    }
  });
  /* 剩下的才自動建議 */
  g.forEach(function(b){
    if(placements[b.id])return;
    var ppl=bkSeatPpl(b);
    var bands=bkAK(b).bands||"";
    var isYoungPick=bands.indexOf("5-7 歲")>=0&&/選圖/.test(bkSeatItemsName(b));
    var area;
    if(isYoungPick){ area="吧台" }
    else{
      /* 整組人要坐在一起，所以挑「這組人塞得下」的區，不是隨便有一張空椅子就塞——
         不然兩位的預約可能被拆成一位吧台、一位畫架，變成拆散一組人。
         真的需要拆開坐，用卡片上的✂️手動拆位，不是靠自動建議去拆。 */
      var open=SEAT_AREAS.filter(function(a){ return counts[a.k]+ppl<=a.cap })[0]
        ||SEAT_AREAS.filter(function(a){ return counts[a.k]<a.cap })[0];
      area=open?open.k:"臨時桌";
    }
    placements[b.id]=[{area:area,n:ppl}]; counts[area]=(counts[area]||0)+ppl;
  });
  return {placements:placements,counts:counts};
}
async function bkSeatSet(id,area){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  b.seatArea=area;
  delete b.seatSplit; /* 用一般搬移（不是拆位）指定整組去某一區，之前拆過的就取消 */
  try{ await bkPatch("/bookings/"+id+".json",{seatArea:area,seatSplit:null}) }
  catch(e){ alert("座位存檔失敗，重新整理後再拖一次："+e.message) }
}
/* 把同一組人拆到不同區。split：{區名:人數}，總和要等於這組總人數。
   總和不符、或只剩一區有人（等於沒拆），呼叫端要自己擋掉，這裡只負責存檔。 */
async function bkSeatSplitSave(id,split){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var areas=Object.keys(split);
  if(areas.length<2){
    b.seatArea=areas[0]||b.seatArea; delete b.seatSplit;
    try{ await bkPatch("/bookings/"+id+".json",{seatArea:b.seatArea,seatSplit:null}) }
    catch(e){ alert("座位存檔失敗，重新整理後再試："+e.message) }
    return;
  }
  b.seatSplit=split;
  try{ await bkPatch("/bookings/"+id+".json",{seatSplit:split}) }
  catch(e){ alert("座位存檔失敗，重新整理後再試："+e.message) }
}
async function bkSeatSplitClear(id){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  delete b.seatSplit;
  try{ await bkPatch("/bookings/"+id+".json",{seatSplit:null}) }
  catch(e){ alert("座位存檔失敗，重新整理後再試："+e.message) }
}
function bkSeatSplitOpen(id,slk2){
  var b=bkList.filter(function(x){return x.id===id})[0]; if(!b)return;
  var total=bkSeatPpl(b);
  var cur=b.seatSplit||null;
  var rowsHtml=SEAT_AREAS.map(function(a){
    var v=cur?(+cur[a.k]||0):(b.seatArea===a.k?total:0);
    return '<div class="bk-split-row"><span>'+esc(a.k)+'</span>'+
      '<input class="bk-split-n" data-area="'+esc(a.k)+'" type="number" min="0" inputmode="numeric" value="'+v+'"></div>';
  }).join("");
  bkSheet('<h3 style="margin:0 0 10px">拆分座位　'+esc(b.customer&&b.customer.name||"")+'</h3>'+
    '<div class="muted" style="margin-bottom:6px;font-size:13px">這組共 '+total+' 位，把人數分配到不同區，總和要等於 '+total+'</div>'+
    rowsHtml+
    '<div id="bkSplitSum" style="margin-top:8px;font-size:13px"></div>'+
    '<div class="bk-act">'+
      (cur?'<button class="bk-cancel" id="bkSplitClear">取消拆位</button>':'<button class="bk-cancel" id="bkSplitX">取消</button>')+
      '<button class="bk-save" id="bkSplitSave">儲存</button></div>');
  function sumNow(){
    var s=0; document.querySelectorAll(".bk-split-n").forEach(function(el){ s+=(+el.value||0) });
    var el=document.getElementById("bkSplitSum");
    el.textContent="目前總和："+s+" / "+total;
    el.style.color=(s===total)?"#3d9b6a":"#d64545";
    return s;
  }
  sumNow();
  document.querySelectorAll(".bk-split-n").forEach(function(el){ el.oninput=sumNow });
  var xBtn=document.getElementById("bkSplitX"); if(xBtn)xBtn.onclick=bkClose;
  var clearBtn=document.getElementById("bkSplitClear");
  if(clearBtn)clearBtn.onclick=async function(){ await bkSeatSplitClear(id); bkClose(); bkSeatRefresh(slk2) };
  document.getElementById("bkSplitSave").onclick=async function(){
    var s=sumNow();
    if(s!==total){ alert("總和要等於 "+total+" 人，目前是 "+s+"，請調整後再存。"); return }
    var split={};
    document.querySelectorAll(".bk-split-n").forEach(function(el){
      var n=+el.value||0; if(n>0)split[el.dataset.area]=n;
    });
    await bkSeatSplitSave(id,split);
    bkClose(); bkSeatRefresh(slk2);
  };
}
/* 原本做拖曳（pointer events＋setPointerCapture），實測在老闆的手機上
   按下去完全拖不動、放開也沒反應——拖曳這件事在不同手機瀏覽器上的
   相容性本來就不穩，猜了兩輪都沒猜中是哪裡不相容，與其繼續猜，
   改成「點兩下」：先點要搬的卡片，卡片會亮起來，再點要搬去的那一區，
   就搬過去存檔。全部用最普通的 click 事件，手機、電腦、什麼瀏覽器
   都是同一套行為，沒有觸控手勢辨識、沒有 pointer capture，不會有
   「這台裝置不支援」的問題。 */
var bkSeatPicked=null; // 目前選取、準備搬動的預約 id
/* 座位表明細展開狀態，key 是 日期|時段。預設收合（false）：只看得到每區的
   人數（吧台 3/7 這種），不會被每張卡片的姓名、課程細節塞滿畫面。
   只是要掃一眼哪一區還有空位時很好用，需要看是誰、要不要拖位子的時候，
   點小三角形展開就好，收合期間拖位子的功能也先不能用（反正看不到卡片）。 */
var bkSeatDetailOpen={};
function bkSeatBoardHtml(dsNow,sl,g){
  if(!g.length)return "";
  var r=bkSeatAssign(g);
  var byArea={}; SEAT_AREAS.forEach(function(a){ byArea[a.k]=[] });
  /* 拆過位的預約會有 2 筆以上 placement，同一張卡片因此會分別出現在
     好幾個區塊裡，各自只顯示那個區塊分到的人數（不是整組人數）。 */
  g.forEach(function(b){
    (r.placements[b.id]||[]).forEach(function(p){ byArea[p.area].push({b:b,n:p.n}) });
  });
  var key=dsNow+"|"+sl;
  var detailOpen=!!bkSeatDetailOpen[key];
  return '<div class="bk-seat" data-slk2="'+esc(key)+'">'+
    '<div class="bk-seat-toggle" data-seat-toggle="'+esc(key)+'">'+
      '<span style="display:inline-block;width:12px">'+(detailOpen?"▼":"▶")+'</span>'+
      (detailOpen?"收合學員預約詳細資料":"展開學員預約詳細資料（誰坐哪、拖位子）")+
    '</div>'+
    SEAT_AREAS.map(function(a){
      var n=r.counts[a.k]||0, over=n>a.cap;
      return '<div class="bk-seat-col" data-area="'+esc(a.k)+'">'+
        '<div class="bk-seat-h'+(over?" over":"")+'">'+esc(a.k)+'<span>'+n+'/'+a.cap+'</span></div>'+
        (detailOpen?
        '<div class="bk-seat-list" data-area="'+esc(a.k)+'">'+
        (byArea[a.k]||[]).map(function(x){
          var b=x.b, ppl=x.n;
          var totalPpl=bkSeatPpl(b);
          var isSplit=totalPpl!==ppl||b.seatSplit;
          var picked=bkSeatPicked===b.id;
          return '<div class="bk-seat-chip'+(picked?" picked":"")+(isSplit?" split":"")+'" data-bid="'+esc(b.id)+'">'+
            '<span class="bk-seat-split" data-bid="'+esc(b.id)+'" title="拆分座位">✂️</span>'+
            esc(b.customer&&b.customer.name||"—")+
            (b.customer&&b.customer.childName?'（'+esc(b.customer.childName)+'）':'')+
            '　<b class="bk-seat-ppl">'+ppl+(isSplit?'/'+totalPpl:'')+'位</b>'+
            '<small>'+esc(bkSeatItemsName(b))+'</small></div>';
        }).join("")+
        '</div>':'')+
        '</div>';
    }).join("")+
    (detailOpen?'<div class="bk-seat-note">'+(bkSeatPicked
      ?'已選取，點要搬去的區塊完成搬移（會取消拆位），或點同一張卡片取消。'
      :'點一下卡片，再點要搬去的區塊，就能整組換位子；點卡片上的✂️可以把同一組人拆到不同區坐。')+'</div>':'')+
    '</div>';
}
/* 找出這個節點所在的座位表區塊是哪個「日期｜時段」，換位子時只重畫這一小塊，
   不用整頁重新讀資料、重新畫——之前點一下卡片畫面就整個閃一下，
   就是因為原本呼叫的 bkRender() 會先蓋成「載入中…」再重抓一次全部資料。 */
function bkSeatBoardKey(el){
  var board=el.closest(".bk-seat");
  return board?board.dataset.slk2:null;
}
function bkSeatRefresh(slk2){
  if(!slk2)return bkRender(); /* 保底：真的找不到脈絡才整頁重畫 */
  var i=slk2.indexOf("|"), dsNow=slk2.slice(0,i), sl=slk2.slice(i+1);
  var board=document.querySelector('.bk-seat[data-slk2="'+CSS.escape(slk2)+'"]');
  if(!board)return bkRender();
  var g=bkList.filter(function(b){
    return sl==="其他"
      ? (!bkBase(b.slot)&&SLOTS.indexOf(b.slot)<0&&b.slot!==EVE_SLOT)
      : bkHitsSlot(b,sl) });
  var tmp=document.createElement("div"); tmp.innerHTML=bkSeatBoardHtml(dsNow,sl,g);
  var newBoard=tmp.firstChild;
  board.replaceWith(newBoard);
  bkSeatBind(newBoard);
}
function bkSeatMove(id,area,slk2){
  bkSeatPicked=null;
  bkSeatSet(id,area); /* 不等網路存檔完成，本地資料已經先改好了，畫面立刻更新 */
  bkSeatRefresh(slk2);
}
function bkSeatBind(root){
  root.querySelectorAll("[data-seat-toggle]").forEach(function(el){
    el.onclick=function(e){
      e.stopPropagation();
      var key=el.dataset.seatToggle;
      bkSeatDetailOpen[key]=!bkSeatDetailOpen[key];
      bkSeatPicked=null; /* 收合/展開時順便清掉選取狀態，避免收合後留著一個看不到的選取卡片 */
      /* 這個開關現在還連帶控制座位表下面那整串學員登記卡片要不要顯示，
         卡片在座位表的 DOM 外面，只重畫座位表那一小塊(bkSeatRefresh)不會動到，
         這裡要整頁重畫才能讓卡片跟著收合/展開 */
      bkRender();
    };
  });
  root.querySelectorAll(".bk-seat-split").forEach(function(icon){
    icon.onclick=function(e){
      e.stopPropagation();
      bkSeatSplitOpen(icon.dataset.bid,bkSeatBoardKey(icon));
    };
  });
  root.querySelectorAll(".bk-seat-chip").forEach(function(chip){
    chip.onclick=function(e){
      e.stopPropagation();
      if(e.target.closest(".bk-seat-split"))return; /* ✂️ 自己的 onclick 已經處理過 */
      var id=chip.dataset.bid, slk2=bkSeatBoardKey(chip);
      if(bkSeatPicked===id){ bkSeatPicked=null; bkSeatRefresh(slk2); return } /* 再點一次＝取消 */
      if(!bkSeatPicked){ bkSeatPicked=id; bkSeatRefresh(slk2); return } /* 第一次點＝選取 */
      /* 已經選好一張要搬的了，這次點到別張卡片＝搬去這張卡片所在的區 */
      var col=chip.closest(".bk-seat-col");
      if(col&&col.dataset.area)bkSeatMove(bkSeatPicked,col.dataset.area,slk2);
      else{ bkSeatPicked=null; bkSeatRefresh(slk2) }
    };
  });
  root.querySelectorAll(".bk-seat-col").forEach(function(col){
    col.onclick=function(e){
      if(!bkSeatPicked)return;
      if(e.target.closest(".bk-seat-chip"))return; /* 卡片自己的 onclick 已經處理過 */
      bkSeatMove(bkSeatPicked,col.dataset.area,bkSeatBoardKey(col));
    };
  });
}
function bkCard(b){
  var c=b.checkout, dp=bkDepState(b);
  var unpaid=dp.s==="wait"&&!c;
  var depPaid=dp.s==="paid"&&!c;
  var items=(b.items||[]).map(function(i){
    var ad=(i.addons||[]).map(function(a){return a.name}).join("、");
    return esc(i.name)+(i.spec?"("+esc(i.spec)+")":"")+" ×"+(i.qty||1)+(ad?"　加購："+esc(ad):"") }).join("、");
  /* 待收就把方式一起寫出來，行政才知道要去 LINE Pay 還是銀行對帳，不用點進去看 */
  var depTag="";
  if(dp.s==="wait")
    depTag='<span class="bk-tag w">待收 $'+dp.amt.toLocaleString()+'・'+esc(bkWayName(dp.way))+'</span>';
  else if(dp.s==="paid")
    depTag='<span class="bk-tag d">訂金 $'+dp.amt.toLocaleString()+'・'+esc(bkWayName(dp.way))+
      (dp.last5?'・末'+esc(dp.last5):'')+
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
    '<div class="bk-who"><b class="bk-nm" data-bid="'+b.id+'" title="點一下看目前餘額">'+
      esc(b.customer&&b.customer.name||"—")+'</b>'+
      (b.customer&&b.customer.childName?'<span class="bk-childname">・小朋友 '+esc(b.customer.childName)+'</span>':'')+
      ' '+bkPplText(b)+
      (bkIsNewWeb(b)?'<span class="bk-tag new">NEW</span>':'')+
      (bkIsMember(b)?'<span class="bk-tag m">會員</span>':'')+
      depTag+
      (bkBase(b.slot)&&bkBase(b.slot)!==b.slot
        ?'<span class="bk-tag t">'+esc(b.slot)+'</span>':'')+
      (b.source==="manual"?'<span class="bk-tag s">現場登記</span>':'')+
      (b.source==="ai-chat"?'<span class="bk-tag ai">AI待確認</span>':'')+'</div>'+
    '<div class="bk-sub">'+esc(b.customer&&b.customer.phone||"")+(items?"　"+items:"")+'</div>'+
    (b.customer&&b.customer.note?'<div class="bk-note">備註：'+esc(b.customer.note)+'</div>':'')+
    doneHtml+
    '<div class="bk-btns">'+
      '<button class="bk-b'+(b.attend==="in"?" on":"")+'" data-at="'+b.id+'" data-v="in">已報到</button>'+
      '<button class="bk-b'+(b.attend==="no"?" no":"")+'" data-at="'+b.id+'" data-v="no">未到</button>'+
      /* 手動登記打錯很常見，客人自己訂的也可能訂錯要幫忙改。
         核銷後就不給改了，那時金額已經寫進帳。 */
      (!c
        ?'<button class="bk-b ed" data-ed="'+b.id+'">修改</button>':"")+
      /* 訂金只在還沒核銷前能改。核銷後那筆金額已經寫進扣課明細，
         這裡再動就會跟每日填寫對不起來。
         現場登記預設是「不用收」（none），但口頭約、電話約的客人
         行政也常常會請對方先付訂金，所以 none 也要能補登，
         不然只能寫在備註欄，錢收了卻沒進帳、核銷時也不會自動扣抵。 */
      ((!c&&(dp.s==="wait"||dp.s==="paid"||dp.s==="none")&&bkCan("checkout"))
        ?'<button class="bk-b dp'+(dp.s==="paid"?" done":"")+'" data-dp="'+b.id+'">'+
          (dp.s==="paid"?"訂金 ✓":"收訂金")+'</button>':"")+
      /* 核銷會扣點數、作廢會退帳，沒有權限的人不顯示這兩顆 */
      (bkCan("checkout")?'<button class="bk-b ck" data-ck="'+b.id+'">'+(c?"修正核銷":"核銷")+'</button>':"")+
      /* 核銷前後都可能想順手賣方案（核銷前先加點折抵、核銷後續約），不綁核銷狀態 */
      (bkCan("sellPlan")?'<button class="bk-b sp" data-sp="'+b.id+'">賣方案</button>':"")+
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
    var t2=bkTeachersOn(k), tPM2=bkTeachersOnPM(k), cap=bkCapOf(k), capPM=bkCapOfPM(k);
    var ev=bkEveOn(k), evCap=bkEveCap(k);
    var set=bkSched&&bkSched[k]!=null;
    var same=t2===tPM2;
    /* 上午一個時段、下午兩個時段，容量不一樣了不能再用 cap*3 概算 */
    if(t2>0||tPM2>0){ seats+=cap*1+capPM*2; openDays++ }
    if(ev>0){ seats+=evCap; eveDays++ }
    h+='<button class="bk-mday'+(t2===0&&tPM2===0&&ev===0?" off":"")+(set?" set":"")+
       (k===todayK?" now":"")+'" data-d="'+k+'">'+
       '<span class="d">'+i+'</span>'+
       '<span class="n">'+(t2===0&&tPM2===0?"休":(same?String(t2):t2+"/"+tPM2))+'</span>'+
       '<span class="c">'+(t2===0&&tPM2===0?"不開課":(same?cap+" 位":cap+"・"+capPM+" 位"))+'</span>'+
       (ev>0?'<span class="bk-eve">夜 '+evCap+'</span>':'')+'</button>';
  }
  h+='</div>';
  h+='<div class="bk-cfoot">本月開課 '+openDays+' 天・可容納 '+seats.toLocaleString()+' 人次'+
     '（白天每天 '+SLOTS.length+' 個時段'+(eveDays?'，另有 '+eveDays+' 天加開晚上':'')+'）<br>'+
     '中間數字「上午/下午」不一樣才會分開顯示，一樣就只顯示一個。<br>'+
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

/* 點某一天，跳出 休／1～6 讓你選。上午下午分開設定（2026-08-17），
   老師常常早上有排、下午沒排，原本白天共用一個數字反映不出來。 */
function bkSchedPick(k){
  var p=k.split("/").map(Number);
  var cur=bkTeachersOn(k), curPM=bkTeachersOnPM(k), base=bkBaseOn(k), isSet=!!(bkSched&&bkSched[k]!=null);
  var h='<h3 style="margin:0 0 4px">'+k+'（'+WD[new Date(p[0],p[1]-1,p[2]).getDay()]+'）</h3>';
  h+='<div class="bk-hint" style="padding:0 2px 14px">上午下午分開設定'+(isSet?"（已手動指定）":"（目前照星期預設）")+'。</div>';

  h+='<div style="font-size:14px;font-weight:600;margin-bottom:2px">上午時段 10:00-12:00</div>';
  h+='<div class="bk-hint" style="padding:0 0 10px">目前 '+cur+' 位老師・可收 '+bkCapOf(k)+' 位</div>';
  h+='<div class="bk-nopts">';
  for(var n=0;n<=6;n++){
    var cap=Math.min(n*CAP_PER_TEACHER,SEAT_CAP);
    h+='<button class="bk-nopt'+(n===cur?" on":"")+'" data-n="'+n+'">'+
       (n===0?"休":n)+'<small>'+(n===0?"不開課":cap+" 位")+'</small></button>';
  }
  h+='</div>';

  h+='<div style="margin-top:18px;padding-top:14px;border-top:1px solid #E8E3DA">'+
     '<div style="font-size:14px;font-weight:600;margin-bottom:2px">下午時段 14:00-16:00、16:00-18:00</div>'+
     '<div class="bk-hint" style="padding:0 0 10px">目前 '+curPM+' 位老師・可收 '+bkCapOfPM(k)+' 位</div>';
  h+='<div class="bk-nopts">';
  for(var n2=0;n2<=6;n2++){
    var cap2=Math.min(n2*CAP_PER_TEACHER,SEAT_CAP);
    h+='<button class="bk-nopt'+(n2===curPM?" on":"")+'" data-npm="'+n2+'">'+
       (n2===0?"休":n2)+'<small>'+(n2===0?"不開課":cap2+" 位")+'</small></button>';
  }
  h+='</div></div>';

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
    '恢復全部預設（'+base+' 位）</button>';
  h+='<div class="bk-act"><button class="bk-cancel" onclick="bkClose()">關閉</button></div>';
  h+='<div class="bk-hint" style="padding:12px 2px 0">改完立即生效，客人端該日名額同步更新。'+
     '已經約進來的預約不會被取消，若因此超載，今日排課頁會顯示紅色警示。</div>';
  bkSheet(h);
  document.querySelectorAll(".bk-nopt[data-n]").forEach(function(el){
    el.onclick=async function(){
      await bkSetTeachers(k,+el.dataset.n); bkClose(); bkSchedRender();
      if(ds(bkDate)===k&&document.getElementById("bkRoot"))bkRender();
    } });
  document.querySelectorAll(".bk-nopt[data-npm]").forEach(function(el){
    el.onclick=async function(){
      await bkSetTeachersPM(k,+el.dataset.npm); bkClose(); bkSchedRender();
      if(ds(bkDate)===k&&document.getElementById("bkRoot"))bkRender();
    } });
  document.querySelectorAll(".bk-nopt[data-ev]").forEach(function(el){
    el.onclick=async function(){
      var ev=+el.dataset.ev;
      /* 關掉晚上之前先確認有沒有人已經約了，不然客人會撲空 */
      if(ev===0){
        var booked=bkList.filter(function(b){
          return b.date===k&&b.status!=="cancelled"&&b.status!=="expired"&&
            bkHitsSlot(b,EVE_SLOT) }).length;
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
    /* 點外面關閉，要「按下」跟「放開」都真的在遮罩上才算數。
       以前只看放開那一刻的位置，在表單裡拖曳選字、滑鼠稍微滑出邊界
       再放開，就會被誤判成「點了外面」，整份還沒存的資料直接關掉消失。 */
    var downOnMask=false;
    m.onmousedown=function(e){ downOnMask=(e.target===m) };
    m.onclick=function(e){ if(e.target===m&&downOnMask)bkClose(); downOnMask=false }; }
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
  if(dp.s!=="wait"&&dp.s!=="paid"&&dp.s!=="none")return;
  var amt=dp.amt||DEPOSIT_AMT;
  var way=dp.way||"linepay";
  var last5=dp.last5||"";
  var today=ds(new Date());
  var date=dp.date||today;
  var paid=dp.s==="paid";
  /* 只列真的會收到錢的方式，點數／堂數不是訂金 */
  var ways=PAYWAYS.filter(function(p){ return !p.member });
  /* LINE Pay、匯款這兩種要另外填末五碼，才有辦法跟明細對帳；
     現金、刷卡、文化幣當面收就知道是誰，不用再填 */
  function needsLast5(w){ return w==="linepay"||w==="transfer" }

  bkSheet(
   '<h3>'+(paid?"訂金紀錄":"登記訂金")+'</h3>'+
   '<div class="bk-sh2">'+b.date+'　'+esc(b.actualTime||b.slot)+'　'+
     esc(b.customer&&b.customer.name||"")+'</div>'+
   (paid?'<div class="bk-warn">這筆已經登記過了。改完會覆蓋原本的紀錄。</div>'
        :dp.s==="wait"
        ?'<div class="bk-info">客人在預約時選的是 <b>'+esc(bkWayName(dp.way))+
          '</b>，請先確認錢真的收到了再按確認。</div>'
        :'<div class="bk-info">這筆還沒有登記訂金，口頭約或電話約的客人也可以在這裡補登，'+
          '金額與方式請填實際收到的。</div>')+
   '<div class="bk-f"><label>訂金金額</label>'+
     '<input id="dpAmt" inputmode="numeric" value="'+amt+'"></div>'+
   '<div class="bk-f"><label>實際收款方式</label><div class="bk-ways" id="dpWays"></div></div>'+
   '<div class="bk-f" id="dpLast5Wrap" style="display:none"><label id="dpLast5Label">末五碼</label>'+
     '<input id="dpLast5" inputmode="numeric" maxlength="5" placeholder="例如 12345" value="'+esc(last5)+'">'+
     '<div class="bk-left" style="margin-top:5px">方便之後對帳用，沒有的話可以先空著。</div></div>'+
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
    var wrap=document.getElementById("dpLast5Wrap");
    if(needsLast5(way)){
      wrap.style.display="block";
      document.getElementById("dpLast5Label").textContent=bkWayName(way)+" 末五碼";
    }else wrap.style.display="none";
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
    var l5=needsLast5(way)?String(document.getElementById("dpLast5").value||"").trim():"";
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
        amount:a,way:way,wayName:bkWayName(way),last5:l5,
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
        status:"paid",amount:a,paidWay:way,paidDate:dstr,paidAt:now,last5:l5,
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
  /* 核銷現在可以改課程，所以要先有課表。
     以前不需要——課程是預約時就選好的，核銷只照著結帳。
     少了這一行，沒先開過手動登記的人一按核銷就會整個視窗開不起來。 */
  await bkLoadCourses(); await bkLoadTktPlans();
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
  /* ══ 老師可以複選（2026-08-10）══════════════════════════
     兩個人一起來不一定同一位老師帶。以前只存一位，另一位的
     人次就不見了——薪資是按人次算的，等於少算一場。

     存法：teachers 存陣列，teacher 仍然存一個字串（用頓號串起來）。
     舊的報表、卡片、每日登記都還在讀 teacher，不動它們就不會壞；
     要細算的時候讀 teachers 那個陣列。 */
  var teachers=(old&&Array.isArray(old.teachers)&&old.teachers.length)
    ?old.teachers.slice()
    :((old&&old.teacher)?String(old.teacher).split(/[、,／\/]/).map(function(x){return x.trim()}).filter(Boolean):[]);

  /* ══ 核銷時可以改課程與扣堂數（2026-08-10）══════════════
     兩個問題同源。

     一、扣堂數本來寫死 1，不管幾個人。兩個人一起上、都用堂數扣，
         系統只扣一堂、只認列一堂的營收。少扣的堂數客人賺到，
         少認的營收月報看不到，而且完全沒有跡象。
         改成預設跟著人數走，並且獨立成一個欄位讓人能改——
         兩個人來但只有一個人用堂數，這種狀況現場很常見。

     二、課程項目以前只能在「修改預約」改。可是客人是上課當下才
         改主意的，核銷才是那個當下。逼人先跳去修改預約再回來核銷，
         等於同一件事做兩遍。

     課程一改，用料表和庫存扣帳都要跟著改，所以下面 drawMats、
     consumeInvForBooking 全部改讀這份即時的品項，不再讀預約單。 */
  var ckItems=[], ckItemsDirty=false;
  (b.items||[]).forEach(function(it){
    var ci=-1;
    bkCourses.forEach(function(c,i){
      if(ci<0&&c.name===it.name&&String(c.spec||"")===String(it.spec||""))ci=i });
    ckItems.push({ ci: ci>=0?String(ci):"", qty:+it.qty||1,
                   lostName: ci<0?(it.name||""):"" });
  });
  if(!ckItems.length)ckItems.push({ci:"",qty:0,lostName:""});
  /* 這次要扣幾堂。修正核銷時沿用原本扣的，新核銷預設等於人數。 */
  var useSeN=(old&&old.useSessions!=null)?(+old.useSessions||0):0;
  var seTouched=!!(old&&old.useSessions!=null);
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
   '<div class="bk-f"><label>課程項目</label><div id="ckItems"></div>'+
     '<button type="button" class="bk-mini" id="ckItemAdd">＋ 再加一門課</button>'+
     '<div class="bk-left" id="ckItemSum"></div></div>'+
   '<div class="bk-f"><label>課程費用</label><input id="ckAmt" inputmode="numeric" value="'+(course.amt||"")+'"></div>'+
   '<div class="bk-f"><label>課程付款方式</label><div class="bk-ways" id="ckWays"></div></div>'+
   '<div class="bk-f" id="ckSeBox" style="display:none"><label>這次扣幾堂</label>'+
     '<input id="ckSe" inputmode="decimal" value=""><div class="bk-left" id="ckSeHint"></div></div>'+
   '<div class="bk-f"><label>加價項目（畫布、公仔等）</label><div id="ckAdd"></div>'+
     '<button class="bk-mini" id="ckAddNew">＋ 新增一項</button><div id="ckAddWarn"></div></div>'+
   '<div class="bk-f"><label style="display:flex;align-items:center;gap:7px">'+
     '<input type="checkbox" id="ckProxy" style="width:16px;height:16px"> 用其他會員的點數（朋友代扣）</label>'+
     '<div id="ckProxyBox"></div></div>'+
   '<div class="bk-f"><label>上課老師（可複選）</label><div class="bk-ways" id="ckTs"></div>'+
     '<div class="bk-left" id="ckTHint"></div></div>'+
   '<div id="ckMats"></div>'+
   '<div class="bk-calc" id="ckCalc"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="ckX">取消</button>'+
     '<button class="bk-save" id="ckOK">'+(old?"確認修正":"確認核銷")+'</button></div>');

  document.getElementById("ckX").onclick=bkClose;

  function ckItemsOut(){
    var out=[];
    ckItems.forEach(function(r){
      if(r.ci===""){
        /* 課表上找不到的舊品項，原樣留著，不要因為核銷就把它弄丟 */
        if(r.lostName)out.push({name:r.lostName,spec:"",qty:+r.qty||1,price:0});
        return;
      }
      var c=bkCourses[+r.ci]; if(!c)return;
      out.push({name:c.name,spec:c.spec,qty:+r.qty||1,price:+c.price||0});
    });
    return out;
  }
  function ckItemsQty(){
    return ckItems.reduce(function(s,r){ return s+(r.ci===""&&!r.lostName?0:(+r.qty||0)) },0);
  }
  function ckDrawItems(){
    var box=document.getElementById("ckItems"); if(!box)return;
    box.innerHTML=ckItems.map(function(r,i){
      var c=r.ci===""?null:bkCourses[+r.ci];
      var opts='<option value="">（不指定）</option>'+
        (r.lostName?'<option value="" selected>'+esc(r.lostName)+'（原資料，課表裡沒有）</option>':'')+
        bkCourseOptions(r.ci);
      return '<div class="bk-irow">'+
        '<select data-cr="'+i+'" data-cf="ci">'+opts+'</select>'+
        '<input data-cr="'+i+'" data-cf="qty" inputmode="numeric" value="'+(r.qty||0)+'" placeholder="位">'+
        (ckItems.length>1?'<button type="button" class="bk-idel" data-cdel="'+i+'">✕</button>'
                         :'<span class="bk-ipad"></span>')+
        '</div>'+
        (c?'<div class="bk-left bk-iinfo">單價 $'+(+c.price||0).toLocaleString()+
            (c.dur?"　時長 "+esc(c.dur):"")+'</div>':'');
    }).join("");
    box.querySelectorAll("select[data-cf=ci]").forEach(function(el){
      el.onchange=function(){
        var r=ckItems[+el.dataset.cr];
        r.ci=el.value; r.lostName=""; ckItemsDirty=true;
        if(!(+r.qty>0))r.qty=1;
        ckDrawItems(); drawMats(); calc();
      } });
    box.querySelectorAll("input[data-cf=qty]").forEach(function(el){
      el.oninput=function(){
        ckItems[+el.dataset.cr].qty=+el.value||0; ckItemsDirty=true; calc();
      } });
    box.querySelectorAll("[data-cdel]").forEach(function(el){
      el.onclick=function(){
        ckItems.splice(+el.dataset.cdel,1); ckItemsDirty=true;
        if(!ckItems.length)ckItems.push({ci:"",qty:0,lostName:""});
        ckDrawItems(); drawMats(); calc();
      } });
  }
  document.getElementById("ckItemAdd").onclick=function(){
    ckItemsDirty=true;
    ckItems.push({ci:"",qty:1,lostName:""});
    ckDrawItems(); drawMats(); calc();
  };
  ckDrawItems();

  /* 課程用料裡標了群組的材料，一組列一行讓老師點選。
     沒標群組的課程完全不受影響，這一區直接不出現。 */
  function drawMats(){
    var box=document.getElementById("ckMats"); if(!box)return;
    var gs=[];
    try{
      if(typeof invRecipeGroups==="function")gs=invRecipeGroups(ckItemsOut())||[];
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

  /* 這次要扣幾堂。人沒動過就跟著人數走，動過就聽人的。 */
  function ckSeNow(){
    if(!seTouched){
      var n=ckItemsQty()||(nAdult+nKid)||1;
      useSeN=n;
      var el=document.getElementById("ckSe");
      if(el&&String(el.value)!==String(n))el.value=n;
    }
    return Math.max(0,+useSeN||0);
  }
  function drawSe(){
    var box=document.getElementById("ckSeBox"); if(!box)return;
    var on=(course.way==="sessions");
    box.style.display=on?"":"none";
    if(!on)return;
    var n=ckSeNow();
    var hint=document.getElementById("ckSeHint");
    if(hint)hint.innerHTML=seTouched
      ? "手動指定 "+n+" 堂"
      : "跟著課程人數走（目前 "+n+" 位）。只有部分人用堂數扣的話，直接改這格。";
  }

  function calc(){
    course.amt=+document.getElementById("ckAmt").value||0;
    drawSe();
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
      var useSe=(course.way==="sessions")?ckSeNow():0;
      /* 修正核銷時，payer.cache 是「上一次核銷扣完」的餘額，存檔當下
         會先把舊的扣法加回去、再扣新的（沖銷再重扣），淨影響通常只有
         差額。但這裡預覽算的時候如果直接拿目前餘額去減新數字，畫面
         看起來會像是「又要扣一次」，行政會誤以為是重複扣款的 bug。
         同一個付款人才能加回去，換人付就不能算在這個人頭上。 */
      var oldSamePayer=old&&payer&&old.payerPhone===payer.phone;
      var refundPt=oldSamePayer?(+old.usePoints||0):0;
      var refundSe=oldSamePayer?(+old.useSessions||0):0;
      if(usePt){ var left=(payer.cache&&payer.cache.points||0)+refundPt-usePt;
        h+="扣點數 <b>"+usePt.toLocaleString()+"</b>，剩 <b>"+left.toLocaleString()+"</b>"+
          (refundPt?'　<span class="bk-cap">（已扣回原本 '+refundPt.toLocaleString()+' 點，這是修正後的淨餘額）</span>':"")+"<br>";
        if(left<0)h+='<div class="bk-err">點數不足，還差 '+Math.abs(left).toLocaleString()+' 點</div>'; }
      if(useSe){ var l2=(payer.cache&&payer.cache.sessions||0)+refundSe-useSe;
        h+="扣堂數 <b>"+useSe+"</b>，剩 <b>"+l2+"</b>"+
          (refundSe?'　<span class="bk-cap">（已扣回原本 '+refundSe+' 堂，這是修正後的淨餘額）</span>':"")+"<br>";
        if(!course.amt&&courseList)
          h+='<span class="bk-cap">牌價 $'+courseList.toLocaleString()+
             ' 不另收，這堂的錢買方案時已經付過</span><br>';
        if(l2<0)h+='<div class="bk-err">堂數不足</div>';
        /* 堂數方案的一堂值多少，跟課程標價不一樣。
           業績要認列的是方案攤下來的單價，不是牌價。 */
        su=bkSessionUnit(payer);
        if(su){
          h+=(useSe>1?"認列 <b>$"+(su.unit*useSe).toLocaleString()+"</b>（單堂 $"+
                      su.unit.toLocaleString()+" × "+useSe+" 堂・"
              :"這堂認列 <b>$"+su.unit.toLocaleString()+"</b>（")+
             esc(su.plan||"堂數方案")+"　"+su.qty+" 堂 $"+su.price.toLocaleString()+"）";
          h+=su.fromTicket
            ? '<span class="bk-cap">夯客票券・推估 '+esc(su.buy||"")+' 購買・單價來自'+
              esc(su.src||"內建")+'</span><br>'
            : "<br>";
        }else{
          var tn=bkTktNameOnly(payer);
          h+='<div class="bk-warn">'+
             (tn?("「"+esc(tn)+"」還沒有單價，"):"查不到這位客人的堂數方案，")+
             '業績先用牌價 $'+(courseList||0).toLocaleString()+' 認列。'+
             '<br><span class="bk-cap">補法二選一：方案設定建一個堂數相同的方案，'+
             '或在試算表「舊方案單價」分頁填一列。（票券單價來源：'+esc(bkTktPlanSrc)+'）</span></div>';
        } }
      /* 堂數扣抵是用會員自己的堂數卡上課，不是這次花新的錢，不算紅利。
         紅利只在真的收到錢（現金／點數／LINE Pay 等）時才給。 */
      if(course.way==="sessions"){
        bonus=0;
        h+="堂數扣抵不累積紅利";
      }else{
        bonus=bonusOf(course.amt);
        h+="紅利回饋 <b>+"+bonus+"</b> 點（課程 "+course.amt.toLocaleString()+" ÷ 500，加價不計）";
      }
    } else h+="未綁會員，不累積紅利";
    document.getElementById("ckCalc").innerHTML=h;
  }
  document.getElementById("ckAmt").oninput=function(){ ckAmtTouched=true; calc() };
  document.getElementById("ckSe").oninput=function(){
    seTouched=true; useSeN=+this.value||0; calc() };
  function drawTeachers(){
    var box=document.getElementById("ckTs"); if(!box)return;
    box.innerHTML=bkTeachers().map(function(t){
      return '<div class="bk-way'+(teachers.indexOf(t)>=0?" on":"")+'" data-t="'+esc(t)+'">'+
        esc(t)+'</div>' }).join("");
    box.querySelectorAll("[data-t]").forEach(function(el){
      el.onclick=function(){
        var t=el.dataset.t, i=teachers.indexOf(t);
        if(i>=0)teachers.splice(i,1); else teachers.push(t);
        drawTeachers();
      } });
    var hint=document.getElementById("ckTHint");
    if(hint)hint.textContent=teachers.length>1
      ? "這場算 "+teachers.length+" 位老師的人次"
      : (teachers.length?"":"點一下選取，可以複選");
  }
  drawTeachers();

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
    var t=teachers.join("、");
    var cp=PAYWAYS.filter(function(p){return p.k===course.way})[0];
    if(!cp||!teachers.length){ alert("付款方式和上課老師都要填"); return }
    /* 堂數扣抵本來就不收錢，0 元是正常的，其他方式才要求填金額 */
    if(course.way!=="sessions"&&!course.amt){ alert("課程費用要填"); return }
    if(cp.member&&!payer){ alert("這個付款方式需要先選會員"); return }
    if(course.way==="sessions"){
      var seN=ckSeNow();
      if(!seN){ alert("堂數扣抵要大於 0，可以填 0.5 這種半堂"); return }
      var q=ckItemsQty();
      if(q&&seN!==q&&!confirm("課程項目合計 "+q+" 位，但這次只扣 "+seN+" 堂。\n\n"+
        "確定嗎？（部分人用堂數、其他人付現的話這樣是對的）"))return;
    }
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
      var useSe=(course.way==="sessions")?ckSeNow():0;
      var outItems=ckItemsOut();
      /* 課程實際認列的營收。堂數扣抵要用方案單價，其餘就是收的金額。
         算好存起來，之後報表不用重算，客人再買新方案也不會回頭改到舊帳。 */
      var sUnit=useSe?bkSessionUnit(payer):null;
      /* 查得到方案單價就「單堂 × 堂數」；查不到才退回牌價——
         牌價本來就是整筆的總價，不能再乘一次堂數。 */
      var courseRev=useSe
        ?(sUnit?sUnit.unit*useSe:(courseList||course.amt))
        :course.amt;
      /* 堂數扣抵不算紅利（用堂數卡上課，沒有新收錢），跟畫面預覽算法要一致，
         不然客人看到的跟實際入帳的會不一樣 */
      var bonus=useSe?0:bonusOf(course.amt);
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
        payerPhone:payer?payer.phone:"",teacher:t,teachers:teachers.slice(),
        people:nAdult+nKid,adults:nAdult,kids:nKid,
        courseAmt:course.amt,coursePay:course.way,
        addons:addons,addonTotal:addTotal,addonText:addonTxt,
        total:total,byWay:byWay,bonus:bonus,
        depositAmt:depAmt,depositWay:depWay,due:due,
        courseRev:courseRev,sessionUnit:sUnit?sUnit.unit:0,sessionPlan:sUnit?sUnit.plan:"",
        /* 課程排行要按課名分組，所以拆成陣列存，不要只存一串文字 */
        courses:outItems.map(function(i){
          return {name:i.name||"",spec:i.spec||"",qty:+i.qty||1} }),
        items:outItems.map(function(i){return i.name}).join("、"),
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
        /* 核銷時改過課程就寫回預約單，卡片、月報、用料才會一致 */
        items:outItems,
        checkout:{courseAmt:course.amt,coursePay:course.way,addons:addons,addonTotal:addTotal,
          addonText:addonTxt,total:total,byWay:byWay,usePoints:usePt,useSessions:useSe,bonus:bonus,
          depositAmt:depAmt,depositWay:depWay,due:due,matPicks:picks,
          courseRev:courseRev,sessionUnit:sUnit?sUnit.unit:0,sessionPlan:sUnit?sUnit.plan:"",
          adults:nAdult,kids:nKid,
          teacher:t,teachers:teachers.slice(),
          payerPhone:payer?payer.phone:"",summary:sumTxt,logId:logId,at:now}};
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
        /* 加購裡如果已經有畫布類的品項（例如客人升級大尺寸畫布另外收費），
           表示規格內附的那張畫布沒被用到，課程用料就不要重複扣同一類。 */
        var skipCats=addons.map(function(a){
          var m=a.materialId&&typeof bkMatById==="function"?bkMatById(a.materialId):null;
          return m&&m.cat }).filter(Boolean);
        var r1=(typeof consumeInvForBooking==="function")
          ?consumeInvForBooking(id,b.date,outItems,null,skipCats):{ok:[],miss:[]};
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
     '<div class="bk-f"><label>時段（可複選，畫一整天就多選幾個）</label>'+
       '<div class="bk-ways" id="mSlots"></div>'+
       '<div class="bk-f" id="mSlotOtherBox" style="display:none;margin-top:8px">'+
         '<input id="mSlotOther" placeholder="自訂時段，例如 09:00-13:00"></div>'+
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
   '<div class="bk-f" id="mChildNameBox" style="display:'+((eb?(+eb.kids||0):0)>0?"":"none")+'">'+
     '<label>小朋友姓名（選填）</label><input id="mChildName" placeholder="方便老師點名、稱呼小朋友" value="'+
       esc(eb&&eb.customer&&eb.customer.childName||"")+'"></div>'+
   '<div class="bk-f"><label>備註</label><textarea id="mNote" rows="2" placeholder="例：想畫自己的貓">'+
       esc(eb&&eb.customer&&eb.customer.note||"")+'</textarea></div>'+
   '<div class="bk-f" id="mNotifyBox"></div>'+
   '<div class="bk-act"><button class="bk-cancel" id="mX">取消</button>'+
     '<button class="bk-save" id="mOK">'+(eb?"儲存修改":"登記")+'</button></div>');
  document.getElementById("mX").onclick=bkClose;
  var picked=null, pickedUid=null;

  /* 時段：可複選。有人一畫就是一整天，三個時段都要佔。 */
  var mSlots=eb?bkSlotsOf(eb):[];
  var extraSlots=mSlots.filter(function(x){ return SLOTS_MANUAL.indexOf(x)<0 });
  /* 編輯時如果真的改了日期或時段，「通知客人」預設不勾就太危險了——
     客人會像這次一樣，直到前一天提醒才第一次看到改過的時間，
     搞不清楚哪個才對。改動當下自動幫忙勾起來，備註、金額這種
     不影響時間的修改則不動，維持原本「不用每次都發通知」的設計。 */
  function mScheduleChanged(){
    if(!eb)return false;
    var d=(document.getElementById("mDate").value||"").replace(/-/g,"/");
    if(d&&d!==eb.date)return true;
    var orig=bkSortSlots(bkSlotsOf(eb)).join(",");
    var now=bkSortSlots(mSlots).join(",");
    return orig!==now;
  }
  function syncNotifyDefault(){
    var cb=document.getElementById("mNotify");
    if(cb&&mScheduleChanged())cb.checked=true;
  }
  function drawSlots(){
    var box=document.getElementById("mSlots"); if(!box)return;
    var all=SLOTS_MANUAL.concat(extraSlots.filter(function(x){ return SLOTS_MANUAL.indexOf(x)<0 }));
    box.innerHTML=all.map(function(sl){
      return '<div class="bk-way'+(mSlots.indexOf(sl)>=0?" on":"")+'" data-sl="'+esc(sl)+'">'+
        esc(sl)+'</div>' }).join("")+
      '<div class="bk-way" data-slother="1">其他…</div>';
    box.querySelectorAll("[data-sl]").forEach(function(el){
      el.onclick=function(){
        var sl=el.dataset.sl, i=mSlots.indexOf(sl);
        if(i>=0)mSlots.splice(i,1); else mSlots.push(sl);
        mSlots=bkSortSlots(mSlots);
        drawSlots(); showLeft(); syncNotifyDefault();
      } });
    box.querySelector("[data-slother]").onclick=function(){
      var b=document.getElementById("mSlotOtherBox");
      b.style.display=b.style.display==="none"?"":"none";
      if(b.style.display==="")document.getElementById("mSlotOther").focus();
    };
  }
  document.getElementById("mSlotOther").onchange=function(){
    var v=this.value.trim();
    if(!v)return;
    if(mSlots.indexOf(v)<0){ mSlots.push(v); mSlots=bkSortSlots(mSlots);
      extraSlots.push(v); }
    this.value="";
    document.getElementById("mSlotOtherBox").style.display="none";
    drawSlots(); showLeft(); syncNotifyDefault();
  };
  drawSlots();
  function showLeft(){
    var d=document.getElementById("mDate").value.replace(/-/g,"/");
    var el=document.getElementById("mLeft");
    if(!mSlots.length){ el.innerHTML='<span class="bk-cap">還沒選時段</span>'; return }
    var ppl=+document.getElementById("mPeople").value||1;
    /* 每個選到的時段各看一次。一整天的預約在每個時段都要佔位，
       只看第一格會以為還有空位。 */
    var seen={}, out=[];
    mSlots.forEach(function(sl){
      var base=bkBase(sl)||sl;
      if(seen[base])return; seen[base]=1;
      var s=bkSlotInfo(d,base,editId);
      /* 實際人數永遠擺第一位。老師現場可能已自行超收，
         行政若只記得表定數字會再加上去，容易一路加到爆。 */
      var line='<div style="margin-top:4px"><b>'+esc(base)+'</b>　'+
        (base!==sl?'<span class="bk-cap">（'+esc(sl)+' 加開，算這一場）</span>':"")+
        '<span class="bk-cnt">已預約 <b>'+s.used+'</b> 位</span>';
      if(s.cap>0){
        line+='<span class="bk-cap">上限 '+s.cap+'</span>';
        if(s.left<0)        line+='<span class="bk-full">超過 '+Math.abs(s.left)+' 位</span>';
        else if(s.left===0) line+='<span class="bk-full">已達上限，仍可加開</span>';
        else if(s.left<ppl) line+='<span class="bk-full">剩 '+s.left+' 位，這筆要 '+ppl+' 位</span>';
        else                line+='<span class="bk-ok">剩 '+s.left+' 位</span>';
      }else{
        line+='<span class="bk-cap">班表沒排老師，無上限</span>';
      }
      if(s.names.length)line+='<div class="bk-names">已約：'+s.names.map(esc).join("、")+'</div>';
      out.push(line+'</div>');
    });
    el.innerHTML=out.join("");
  }
  document.getElementById("mDate").onchange=async function(){
    /* 換日期要重抓那天的預約才算得準 */
    var keep=bkDate; bkDate=new Date(this.value+"T00:00:00");
    await bkLoad(); bkDate=keep; showLeft(); syncNotifyDefault();
  };
  function syncPpl(){
    var a=+document.getElementById("mAdult").value||0;
    var k=+document.getElementById("mKid").value||0;
    document.getElementById("mPeople").value=(a+k)||0;
    /* 沒有小孩就不用問小朋友姓名，隱藏起來畫面比較乾淨；
       欄位本身還留在畫面上（只是藏起來），存檔讀值不會撲空。 */
    var box=document.getElementById("mChildNameBox");
    if(box)box.style.display=k>0?"":"none";
    showLeft(); fillAmt();
  }
  document.getElementById("mAdult").oninput=syncPpl;
  document.getElementById("mKid").oninput=syncPpl;
  /* 直接手動打電話（沒有走「找會員」搜尋）離開欄位時也查一次，
     不然這個客人就算早就綁過 LINE，系統也查不到。 */
  document.getElementById("mPhone").onchange=function(){ if(!picked)showNotify() };

  /* 課程 */
  await bkLoadCourses(); await bkLoadSched(); await bkLoadTktPlans(); await bkLoadAddons();

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
                    hours:+it.hours||0,
                    qtyManual:true, amtManual:false,
                    lostName: ci<0 ? (it.name||"") : "",
                    addons:(it.addons||[]).map(function(a){return {name:a.name,price:+a.price||0}}) });
    });
  }
  if(!mItems.length) mItems.push({ ci:"", qty:0, amt:0, qtyManual:false, amtManual:false, lostName:"", addons:[] });
  /* 編輯既有預約時，金額以原本存的為準，不要被單價重算蓋掉 */
  if(eb) mItems.forEach(function(r){ r.amtManual=true });
  if(eb&&mItems.length===1) mItems[0].amt=+eb.total||mItems[0].amt;

  function mPplNow(){
    return (+document.getElementById("mAdult").value||0)+(+document.getElementById("mKid").value||0);
  }
  function mRowPrice(r){
    if(r.ci==="")return 0;
    var c=bkCourses[+r.ci]; if(!c)return 0;
    /* 計時課的單價＝每小時 × 時數 */
    if(+c.hourly>0)return (+c.hourly)*(+r.hours||BK_HOUR_MIN);
    return +c.price||0;
  }
  /* 加購是一組客人加一次（不管幾位），不隨件數倍增，跟客人端算法一致 */
  function mAddonsTotal(r){
    return (r.addons||[]).reduce(function(s,a){return s+(+a.price||0)},0);
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
    /* 這個數字是「件數」不是「人數」。一個人畫一整天做三件作品
       就該填 3，用料也是照件數扣的。所以只有「件數比人數少」才
       值得提醒——那通常是漏填；件數多於人數是正常的。 */
    var h="品項合計 <b>"+q+"</b> 件・<b>$"+t.toLocaleString()+"</b>";
    if(mItems.length>1||q!==ppl){
      if(q<ppl)
        h+='　<span class="bk-full">現場有 '+ppl+' 位，但只填了 '+q+' 件，'+
           '少的那 '+(ppl-q)+' 位不會扣到用料</span>';
      else if(q>ppl)
        h+='　<span class="bk-cap">'+ppl+' 位做 '+q+' 件（用料扣 '+q+' 份）</span>';
      else
        h+='　<span class="bk-ok">'+ppl+' 位各一件</span>';
    }
    sum.innerHTML=h;
  }
  function mDraw(){
    var box=document.getElementById("mItems"); if(!box)return;
    /* 只有一列而且沒手動改過人數時，人數跟著大人＋小孩走 */
    if(mItems.length===1&&!mItems[0].qtyManual){
      mItems[0].qty=mPplNow()||1;
      if(mItems[0].ci!==""&&!mItems[0].amtManual)
        mItems[0].amt=mRowPrice(mItems[0])*mItems[0].qty+mAddonsTotal(mItems[0]);
    }
    box.innerHTML=mItems.map(function(r,i){
      var c=r.ci===""?null:bkCourses[+r.ci];
      var opts='<option value="">（不指定，手動填金額）</option>'+
        (r.lostName?'<option value="" selected>'+esc(r.lostName)+'（原資料，清單裡沒有）</option>':'')+
        bkCourseOptions(r.ci);
      return '<div class="bk-irow">'+
        '<select data-ir="'+i+'" data-f="ci">'+opts+'</select>'+
        '<input data-ir="'+i+'" data-f="qty" inputmode="numeric" value="'+(r.qty||0)+'" placeholder="件">'+
        '<input data-ir="'+i+'" data-f="amt" inputmode="numeric" value="'+(r.amt||"")+'" placeholder="小計">'+
        (mItems.length>1?'<button type="button" class="bk-idel" data-del="'+i+'">✕</button>':'<span class="bk-ipad"></span>')+
        '</div>'+
        /* 計時課才出現時數欄。金額＝每小時 × 時數 × 件數 */
        (c&&+c.hourly>0
          ? '<div class="bk-left bk-iinfo">上幾小時：'+
            '<input data-ir="'+i+'" data-f="hours" inputmode="numeric" style="width:64px;margin:0 6px" '+
            'value="'+(+r.hours||BK_HOUR_MIN)+'">小時　每小時 $'+(+c.hourly).toLocaleString()+
            '　佔 '+(+c.seats||1)+' 個位子</div>'
          : "")+
        (c?'<div class="bk-left bk-iinfo">單價 $'+mRowPrice(r).toLocaleString()+
            (c.dur?"　時長 "+esc(c.dur):"")+
            (+c.seats>0&&!(+c.hourly>0)?"　佔 "+(+c.seats)+" 個位子":"")+'</div>':'')+
        /* 加購：跟試算表「加購」分頁對到這門課的品項，複選，價格一次性加進小計，
           不跟著件數乘（跟客人端 LIFF 算法一致）。畫布、公仔這類都是靠這裡選，
           不是再開一列課程。 */
        (c&&bkAddonsFor(c).length
          ? '<div class="bk-left bk-iinfo" style="margin-top:6px">加購（可複選）：'+
            '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:5px">'+
            bkAddonsFor(c).map(function(a,ai){
              var on=(r.addons||[]).some(function(x){return x.name===a.name});
              return '<button type="button" class="bk-way'+(on?' on':'')+
                '" data-addon-i="'+i+'" data-addon-ai="'+ai+'" style="font-size:12.5px;padding:5px 10px">'+
                esc(a.name)+'　+$'+a.price.toLocaleString()+'</button>';
            }).join("")+
            '</div></div>'
          : '');
    }).join("");

    box.querySelectorAll("select[data-f=ci]").forEach(function(el){
      el.onchange=function(){
        var r=mItems[+el.dataset.ir];
        r.ci=el.value; r.lostName=""; r.amtManual=false; mItemsDirty=true;
        r.addons=[]; /* 換課程，舊課程的加購清單對不上了 */
        if(!r.qty) r.qty=mItems.length===1?(mPplNow()||1):1;
        r.amt=mRowPrice(r)*(+r.qty||0)+mAddonsTotal(r);
        mDraw();
      };
    });
    box.querySelectorAll("input[data-f=hours]").forEach(function(el){
      el.oninput=function(){
        var r=mItems[+el.dataset.ir];
        r.hours=Math.max(BK_HOUR_MIN,Math.min(BK_HOUR_MAX,+el.value||BK_HOUR_MIN));
        if(!r.amtManual)r.amt=mRowPrice(r)*(+r.qty||0)+mAddonsTotal(r);
        mItemsDirty=true; mRecalc();
        var ae=box.querySelector('input[data-f=amt][data-ir="'+el.dataset.ir+'"]');
        if(ae&&!r.amtManual)ae.value=r.amt||"";
      };
      el.onblur=function(){ mDraw() };
    });
    box.querySelectorAll("input[data-f=qty]").forEach(function(el){
      el.oninput=function(){
        var r=mItems[+el.dataset.ir];
        r.qty=+el.value||0; r.qtyManual=true; mItemsDirty=true;
        if(r.ci!==""&&!r.amtManual){
          r.amt=mRowPrice(r)*r.qty+mAddonsTotal(r);
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
    box.querySelectorAll("[data-addon-i]").forEach(function(el){
      el.onclick=function(){
        var r=mItems[+el.dataset.addonI];
        var c=bkCourses[+r.ci];
        var a=bkAddonsFor(c)[+el.dataset.addonAi];
        r.addons=r.addons||[];
        var idx=r.addons.findIndex(function(x){return x.name===a.name});
        if(idx>=0)r.addons.splice(idx,1); else r.addons.push({name:a.name,price:a.price});
        mItemsDirty=true;
        if(!r.amtManual)r.amt=mRowPrice(r)*(+r.qty||0)+mAddonsTotal(r);
        mDraw();
      };
    });
    box.querySelectorAll("[data-del]").forEach(function(el){
      el.onclick=function(){
        mItems.splice(+el.dataset.del,1); mItemsDirty=true;
        if(!mItems.length)mItems.push({ci:"",qty:mPplNow()||1,amt:0,qtyManual:false,amtManual:false,lostName:"",addons:[]});
        mDraw();
      };
    });
    mRecalc();
  }
  document.getElementById("mAddItem").onclick=function(){
    mItemsDirty=true;
    /* 加第二列時，第一列的人數就得定下來，不然它還會跟著總人數跑 */
    if(mItems.length===1) mItems[0].qtyManual=true;
    mItems.push({ci:"",qty:1,amt:0,qtyManual:true,amtManual:false,lostName:"",addons:[]});
    mDraw();
  };
  /* 大人／小孩變動時沿用原本的 fillAmt 名稱，syncPpl 不用改 */
  function fillAmt(){ mDraw() }
  function mItemsOut(){
    var out=[];
    mItems.forEach(function(r){
      if(r.ci==="")return;
      var c=bkCourses[+r.ci]; if(!c)return;
      var row={name:c.name,spec:c.spec,qty:+r.qty||1,price:mRowPrice(r)};
      if(+c.hourly>0)row.hours=+r.hours||BK_HOUR_MIN;
      if(+c.seats>0)row.seats=+c.seats;
      if(r.addons&&r.addons.length)row.addons=r.addons.map(function(a){return {name:a.name,price:a.price}});
      out.push(row);
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
    /* 沒透過「找會員」點選、直接手動打電話的情況，以前完全不會查 LINE 綁定，
       這裡補上：沒有 picked 也沒有 eb 的話，就拿手動填的電話去查。 */
    var typedPhone=(document.getElementById("mPhone").value||"").trim();
    var ph=picked?picked.phone:(eb?(eb.memberPhone||(eb.customer&&eb.customer.phone)||""):typedPhone);
    if(!ph){
      box.innerHTML=eb?'<div class="bk-left">這筆沒有綁定會員，改完不會發通知。</div>':"";
      pickedUid=null; return;
    }
    var m=await bkMember(mbPhone(ph));
    pickedUid=(m&&m.lineUserId)||(eb&&eb.line&&eb.line.userId)||null;
    if(!pickedUid){
      box.innerHTML='<div class="bk-warn">⚠ 這位會員還沒綁定 LINE，'+
        (eb?"改完":"登記後")+'不會收到通知。現場可以請他點下面的連結開一次就會自動綁定：'+
        '<div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">'+
        '<code style="font-size:12px;word-break:break-all">'+LIFF_LINK+'</code>'+
        '<button type="button" class="bk-cancel" style="padding:5px 10px;font-size:12.5px" '+
        'onclick="stCopy(\''+LIFF_LINK+'\')">複製連結</button>'+
        '</div></div>';
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
      /* 件數多於人數是正常的（一個人做好幾件），少於才可疑 */
      if(iq<ppl&&!confirm("現場有 "+ppl+" 位，但品項只填了 "+iq+" 件。\n\n"+
                          "用料是照件數扣的，少的那 "+(ppl-iq)+" 位不會扣到材料。\n確定要這樣存嗎？"))return;
    }
    var d=g("mDate").replace(/-/g,"/");
    if(!mSlots.length){ alert("請選時段"); return }
    var useSlots=bkSortSlots(mSlots);
    /* 每個時段都要檢查，一整天的預約在每一格都會佔位 */
    var warned={}, stop=false;
    useSlots.forEach(function(sl){
      if(stop)return;
      var sBase=bkBase(sl); if(!sBase||warned[sBase])return;
      warned[sBase]=1;
      var si=bkSlotInfo(d,sBase,editId);
      if(si.cap>0&&si.left<ppl&&
         !confirm(sBase+" 目前已預約 "+si.used+" 位，表定上限 "+si.cap+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位，超過表定。\n確定要登記嗎？"))stop=true;
      else if(si.cap<=0&&si.used>0&&
         !confirm(sBase+" 班表沒排老師，目前已預約 "+si.used+" 位。\n"+
                  "登記這筆 "+ppl+" 位之後會變成 "+(si.used+ppl)+" 位。\n確定要登記嗎？"))stop=true;
    });
    if(stop)return;
    /* 佔位＝同一時刻佔掉多少空間，跟件數是兩件事。
       一個人畫一整天做三件，他在每個時段還是只佔一個位子。

       有標「佔位」的課用它的數字（一組不管幾個人）；
       剩下沒被那些課涵蓋的人，一人一位。
         地毯1件・1人          → 3
         地毯1件＋繪畫1件・2人  → 3 +(2-1) = 4
         繪畫3件・1人          → 0 + 1    = 1 */
    var seatSum=0, seatQty=0;
    outItems.forEach(function(it){
      if(+it.seats>0){ seatSum += +it.seats; seatQty += (+it.qty||0) }
    });
    var seats = seatSum + Math.max(0, ppl - seatQty);
    if(!seats)seats=ppl;
    var recHours=0;
    outItems.forEach(function(it){ if(+it.hours>recHours)recHours=+it.hours });

    var rec={date:d,
      /* slots 是完整清單；slot／slot2 保留前兩個，
         讓還沒改的報表、行事曆、通知卡片照樣讀得到 */
      slots:useSlots, slot:useSlots[0], slot2:useSlots[1]||"",
      people:ppl,adults:nA,kids:nK,seats:seats,hours:recHours,
      items:outItems,
      total:amt,
      customer:{name:g("mName"),phone:g("mPhone"),note:g("mNote"),childName:g("mChildName")},
      status:"new",source:"manual",ts:new Date().toISOString()};
    /* 現場登記常常是全新客人，不是每次都會從「找會員」點選既有會員。
       picked 是 null 的時候以前完全不會處理會員檔案——預約存進去了，
       但 /members/{phone} 從頭到尾沒建過，這個人等於不存在於會員系統，
       之後不管是客人自己用 LIFF 查點數/預約、還是行政再次搜尋，都會撲空。
       這裡用手動填的電話去查一次索引：查得到就接到既有會員身上，
       查不到、且電話格式看起來是合法手機號碼，就順手建一筆新會員。
       格式看起來不對（例如漏一碼）寧可不建，避免又製造一筆髒資料。 */
    var newMemberPhone=null;
    if(picked){
      rec.memberPhone=picked.phone;
    }else{
      var typedKey=bkNorm(g("mPhone"));
      if(/^09\d{8}$/.test(typedKey)){
        var existingKey=await bkFindPhone(typedKey);
        if(existingKey)rec.memberPhone=existingKey;
        else{ rec.memberPhone=typedKey; newMemberPhone=typedKey }
      }
    }
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
        /* 客人自己在網頁上約的那筆，原本存了 actualTime（實際上課時間，
           跟 slot 分開存是為了處理提早到館這種情況）。行政在這裡真的改了
           日期或時段，如果沒有順便清掉舊的 actualTime，它會一直卡著改之前
           的時間——確認通知跟前一天提醒兩邊讀時段都是 actualTime||slot 優先，
           畫面就會一直顯示改之前的舊時間，跟這次改的新時段對不起來，
           客人會搞不清楚哪個才是真的。日期或時段真的變了才清，
           只是改備註、金額這種不影響時間的，不動 actualTime。 */
        if(d!==eb.date||useSlots.join(",")!==bkSortSlots(bkSlotsOf(eb)).join(","))
          rec.actualTime=null;
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
      /* 這裡失敗不能直接丟給外層 catch——預約本身已經存成功了，
         不該讓行政以為整筆登記失敗。失敗只代表會員檔案沒補上姓名，
         要單獨警告，不然又會變成沒人知道的靜默失敗（跟以前 salaryData
         沒寫進 Firebase 同一種坑）。成功的話順便更新本機快取的
         picked.name，同一次頁面內馬上再搜這個人就找得到姓名。 */
      if(picked&&!picked.name&&g("mName")){
        try{
          var nameRes=await bkPatch("/members/"+picked.phone+".json",{name:g("mName")});
          if(!nameRes.ok)throw new Error("HTTP "+nameRes.status);
          picked.name=g("mName");
        }catch(nameErr){
          alert("預約已經登記成功，但姓名補寫回會員檔案失敗（"+nameErr.message+"）。\n"+
                "這位會員（電話 "+picked.phone+"）之後可能搜不到姓名，"+
                "請到「會員」分頁手動補上姓名：「"+g("mName")+"」。");
        }
      }
      /* 全新客人（沒有從「找會員」點選）：補建一筆會員檔案，
         欄位照抄 member.js 的 mbNewMember／mbSaveMember，
         這樣客人自己用 LIFF 查點數/預約、行政下次搜尋才找得到人。 */
      if(newMemberPhone&&g("mName")){
        try{
          var newRec={phone:newMemberPhone,name:g("mName"),note:"",
            createdAt:new Date().toISOString(),cache:{points:0,sessions:0,bonus:0}};
          var mkRes=await bkPatch("/members/"+newMemberPhone+".json",newRec);
          if(!mkRes.ok)throw new Error("HTTP "+mkRes.status);
          bkIndex[bkNorm(newMemberPhone)]=newMemberPhone;
          if(bkMembers)bkMembers.push({phone:newMemberPhone,name:g("mName"),points:0,sessions:0,bonus:0});
        }catch(mkErr){
          alert("預約已經登記成功，但幫這位新客人建會員檔案失敗（"+mkErr.message+"）。\n"+
                "這位客人（電話 "+newMemberPhone+"、姓名「"+g("mName")+"」）之後可能查不到自己的預約，"+
                "請到「會員」分頁用「＋新增會員」手動補建一筆。");
        }
      }
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
/* 新預約標籤、桌面通知授權提示 */
".bk-tag.new{background:#C9453B;color:#fff;font-weight:700}"+
".bk-tag.ai{background:#F1EBFB;color:#6B4EA6;font-weight:700}"+
".bk-notifbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;"+
  "background:#EEF3FB;color:#3A5A96;border-radius:12px;padding:11px 15px;"+
  "font-size:13.5px;line-height:1.5;margin-bottom:16px}"+
".bk-notifbar span{flex:1;min-width:180px}"+
".bk-notifbtn{background:var(--bkNavy);color:#fff;border:0;border-radius:8px;"+
  "padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}"+
".bk-notifx{background:none;border:0;color:#8A90A0;font-size:15px;cursor:pointer;padding:0 4px}"+
".bk-shfull{color:#C9453B;font-weight:600}"+
".bk-capbtn{float:right;font-size:12.5px;font-weight:500;color:#8A90A0;"+
  "border:1px solid #E3E6EC;border-radius:99px;padding:2px 10px;cursor:pointer}"+
".bk-capbtn:hover{color:#5F6577;border-color:#C7CEDB}"+
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
".bk-seat{display:flex;gap:8px;margin-top:2px;flex-wrap:wrap;position:relative}"+
".bk-seat-toggle{width:100%;font-size:12.5px;color:#8A90A0;cursor:pointer;user-select:none;"+
  "display:flex;align-items:center;gap:4px;padding:2px 0 4px}"+
".bk-seat-toggle:hover{color:#5F6577}"+
".bk-seat-col{flex:1;min-width:110px;background:#fff;border-radius:12px;padding:9px;"+
  "box-shadow:0 1px 3px rgba(16,24,40,.06)}"+
".bk-seat-h{font-size:13.5px;font-weight:700;color:#1F2A44;display:flex;justify-content:space-between;"+
  "margin-bottom:7px;padding-bottom:6px;border-bottom:1px solid #EEF0F4}"+
".bk-seat-h span{font-weight:500;color:#8A90A0}"+
".bk-seat-h.over span{color:#C9453B;font-weight:700}"+
".bk-seat-list{min-height:40px;display:flex;flex-direction:column;gap:6px}"+
".bk-seat-chip{background:#F5F7FA;border:1.5px solid #E3E6EC;border-radius:9px;padding:6px 9px;"+
  "font-size:13px;font-weight:600;color:#2A2E38;cursor:pointer;user-select:none;transition:.12s}"+
".bk-seat-chip:hover{border-color:#C7CEDB}"+
".bk-seat-chip small{display:block;font-weight:400;color:#8A90A0;font-size:11.5px;margin-top:1px}"+
".bk-seat-ppl{color:#C9453B;font-size:12px}"+
".bk-seat-chip.picked{border-color:var(--bkNavy,#1F2A44);background:#EDF1FA;"+
  "box-shadow:0 0 0 2px rgba(31,42,68,.15)}"+
".bk-seat-col{cursor:default}"+
".bk-seat-note{width:100%;font-size:11.5px;color:#A8AEBC;margin-top:2px}"+
".bk-seat-chip.split{border-style:dashed}"+
".bk-seat-split{float:right;cursor:pointer;opacity:.55;font-size:12px}"+
".bk-seat-split:hover{opacity:1}"+
".bk-split-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 0;border-bottom:1px solid #EEF0F4}"+
".bk-split-row span{font-size:14px;color:#2A2E38}"+
".bk-split-n{width:70px;padding:7px;border:1px solid #E3E6EC;border-radius:8px;font-size:14px;text-align:center}"+
".bk-b.ed{background:#F2F3F6;color:#5F6577}"+
".bk-b.ed:hover{background:#E8EAEF}"+
".bk-b.dp{background:#FDF4E3;color:#8A6400;font-weight:600}"+
".bk-b.dp:hover{background:#F8EBD3}"+
".bk-b.dp.done{background:var(--bkOkBg);color:var(--bkOk);font-weight:500}"+
".bk-b.sp{background:#FBF3E3;color:var(--bkGold);font-weight:600}"+
".bk-b.sp:hover{background:#F5E9CC}"+
".bk-who b{font-size:17px;color:var(--bkInk);font-weight:600}"+
".bk-who b.bk-nm{cursor:pointer}"+
".bk-who b.bk-nm:hover{text-decoration:underline}"+
".bk-childname{font-size:13.5px;color:var(--bkMute);font-weight:500;margin-left:2px}"+
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
