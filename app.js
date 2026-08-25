const BOSS_PWD = 'Otto212707656';
const SALES_YEAR = 2026;

// ── Firebase SDK 初始化 ──────────────────────────────────
const FB_CONFIG = {
  apiKey: 'AIzaSyCQYP21uHGAeSj_i6ANMexMvp3_bciHvTw',
  databaseURL: 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: 'otto2-2026',
  appId: '1:108328085665:web:071a45a7d7c5af6b6468e0'
};
let fbApp2 = null;
let fbDb2 = null;
function initFB() {
  try {
    if (typeof firebase === 'undefined') {
      setTimeout(initFB, 100);
      return;
    }
    fbApp2 = firebase.initializeApp(FB_CONFIG, 'salaryApp_' + Date.now());
    fbDb2 = fbApp2.database();
    // FB 初始化完成後，如果頁面已載入就補抓業績
    if (document.readyState === 'complete') {
      loadFirebaseSales();
    }
  } catch(e) { console.error('FB init error:', e); }
}
initFB();

const SALES_STAFF_MAP = {
  'Ethan': ['吳忠懋-Ethan', 'Ethan'],
  '大熊': ['邱宗洲-大熊', '大熊', '邱宗洲'],
  '羊羊': ['劉映秀-羊羊', '羊羊', '劉映秀'],
  '77': ['陳亭媛-七七', '七七', '77', '陳亭媛'], // 修正：原本誤寫「林亭媛」，真實姓名應為「陳亭媛」
  '蓁蓁': ['莊宜蓁-蓁蓁', '蓁蓁', '莊宜蓁'],
  '米雪': ['劉芷喬-米雪', '米雪', '劉芷喬'],
  '米妮': ['陳尚潔-米妮', '米妮', '陳尚潔'],
};

// Returns teacher name from salary system given a sales staff string
function matchStaff(salesStaff) {
  if (!salesStaff) return null; // 空白業務姓名絕不比對（避免 a.includes('') 永遠成立而誤配到第一位老師）
  for (const [teacherName, aliases] of Object.entries(SALES_STAFF_MAP)) {
    if (aliases.some(a => salesStaff.includes(a) || a.includes(salesStaff))) {
      return teacherName;
    }
  }
  return null;
}

// Returns the SALES_STAFF_MAP key for a given salary system teacher name
function getSalesKey(teacherName) {
  // Direct match in map keys
  if (SALES_STAFF_MAP[teacherName]) return teacherName;
  // Search by alias
  for (const [key, aliases] of Object.entries(SALES_STAFF_MAP)) {
    if (aliases.some(a => teacherName.includes(a) || a.includes(teacherName))) {
      return key;
    }
  }
  return teacherName;
}

// Firebase sales data cache
let fbSalesData = {}; // { 'teacherName_month': amount }
let fbLoaded = false;
let fbUnmatched = {}; // { 'month_deptKey': { amt, staffList: Set } } — 業務姓名對不到老師、被排除在業績合計外的金額

function loadFirebaseSales() {
  const url = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app/salesData/records.json';
  fetch(url)
    .then(r => r.json())
    .then(raw => {
      if (!raw) return;
      const records = Array.isArray(raw) ? raw : Object.values(raw);
      if (!records.length) return;
      fbSalesData = {};
      fbUnmatched = {};
      records.forEach(r => {
        if (!r || r.voided) return; // 業績合計要算入所有已成立訂單，不管錢有沒有實際入帳（不排除 pending）
        const dept = r.dept || '';
        const storeKey = (dept === '國圖') ? 'guotu' : 'flagship';
        const m = parseInt(r.month) || 0;
        const d = parseInt(r.day) || 0;
        const amt = parseInt(r.amount) || 0;
        const teacherName = matchStaff(r.staff || '');
        if (!teacherName) {
          // 業務姓名沒對到「老師設定」裡任何一位老師 → 這筆錢不會進 fbSalesData，
          // 為了不讓金額憑空消失、造成報表跟會館業績系統對不起來，另外記一份未比對總表
          if (dept === '2F' || dept === '4F') {
            const uKey = m + '_' + dept;
            if (!fbUnmatched[uKey]) fbUnmatched[uKey] = { amt: 0, staffList: new Set() };
            fbUnmatched[uKey].amt += amt;
            fbUnmatched[uKey].staffList.add(r.staff || '（空白）');
          }
          return;
        }
        fbSalesData[teacherName+'_'+m+'_'+storeKey] = (fbSalesData[teacherName+'_'+m+'_'+storeKey]||0) + amt;
        fbSalesData[teacherName+'_'+m] = (fbSalesData[teacherName+'_'+m]||0) + amt;
        fbSalesData[teacherName+'_'+m+'_'+d+'_'+storeKey] = (fbSalesData[teacherName+'_'+m+'_'+d+'_'+storeKey]||0) + amt;
        fbSalesData[teacherName+'_'+m+'_'+d] = (fbSalesData[teacherName+'_'+m+'_'+d]||0) + amt;
        // 部門級別快取（區分 2F / 4F）
        if (dept === '2F' || dept === '4F') {
          fbSalesData[teacherName+'_'+m+'_'+dept] = (fbSalesData[teacherName+'_'+m+'_'+dept]||0) + amt;
          fbSalesData[teacherName+'_'+m+'_'+d+'_'+dept] = (fbSalesData[teacherName+'_'+m+'_'+d+'_'+dept]||0) + amt;
        }
      });
      fbLoaded = true;
      renderAll();
    })
    .catch(e => console.error('[FB] fetch error:', e));
}

// 取得某月某樓層「業務姓名對不到老師」而未列入業績合計的金額與業務姓名清單
function getUnmatchedSales(month, dept) {
  const key = parseInt(month) + '_' + dept;
  return fbUnmatched[key] || { amt: 0, staffList: new Set() };
}

// Get sales amount from Firebase for a teacher, month, and store
function getFBSales(teacherName, month, store) {
  if (!fbLoaded) return 0;
  // 成人每日登記：flagship 只看 4F 部門，絕不 fallback 到混合的 flagship key
  // （flagship key 是 2F+4F 加總，會把二樓業績誤植到四樓報表）
  if (store === 'flagship') {
    var key4f = teacherName + '_' + parseInt(month) + '_4F';
    return fbSalesData[key4f] || 0;
  }
  // 國圖等其他館別沒有樓層混淆問題，保留原本查法
  var key = store ? teacherName + '_' + parseInt(month) + '_' + store : teacherName + '_' + parseInt(month);
  return fbSalesData[key] || 0;
}

// Get sales amount from Firebase for a teacher, month, day, and store
function getFBSalesByDay(teacherName, month, day, store) {
  if (!fbLoaded) return 0;
  // 成人每日登記：flagship 只看 4F 部門，絕不 fallback 到混合的 flagship key
  // （flagship key 是 2F+4F 加總，會把二樓業績誤植到四樓報表，例如 6/11 Ethan 案例）
  if (store === 'flagship') {
    var key4fDay = teacherName + '_' + parseInt(month) + '_' + parseInt(day) + '_4F';
    return fbSalesData[key4fDay] || 0;
  }
  // 國圖等其他館別沒有樓層混淆問題，保留原本查法
  var key = store
    ? teacherName + '_' + parseInt(month) + '_' + parseInt(day) + '_' + store
    : teacherName + '_' + parseInt(month) + '_' + parseInt(day);
  return fbSalesData[key] || 0;
}

let S = { teachers:[], daily:{}, salaryBase:{}, consumables:{}, inventory:{}, cmBalance:{} };
let curStore = { daily:'flagship', monthly:'flagship', salary:'flagship', consumables:'4f', inventory:'flagship' };
let tabUnlocked = { salary:false, settings:false };
let pendingTab = null;
let saveTimer = null;

const STORE_NAME = { flagship:'旗艦店', guotu:'國圖店', both:'兩店皆有', flagship_cross:'旗艦跨部門' };
const TYPE_NAME  = { full:'正職', part:'兼職' };
const MODE_NAME  = { full:'完整計算', over:'超過門檻', half:'個人÷2', minni:'兼職特殊公式' };
const ROLE_NAME  = { teacher:'老師', admin:'行政', sales:'業務' };

// ── Sync ──────────────────────────────────────────────
// otto2_v7_pending：本機是否有「編輯過、但雲端還沒確認存到」的資料。
// 每次呼叫 save() 就立刻標成 '1'（不用等 800ms 防抖跑完），doSave() 真的存
// 成功才清成 '0'。loadData() 開頁時會先看這個旗標，決定要不要相信剛讀回來的
// 雲端資料——不然「雲端讀成功、但內容其實是存檔失敗前的舊版」這種情況，
// 會把本機還沒同步上去的最新編輯整批蓋掉，卻完全不會跳錯誤，非常難查。
function setSync(status, text) {
  document.getElementById('sync-dot').className = 'dot ' + status;
  const el = document.getElementById('sync-text');
  el.textContent = text;
  el.style.color = status==='ok'?'var(--green)':status==='saving'?'var(--gold)':status==='err'?'var(--red)':'var(--text3)';
  const banner = document.getElementById('sync-warn-banner');
  if (!banner) return;
  if (status==='err') {
    banner.style.display = 'block';
    banner.textContent = '⚠ ' + text + '——這台裝置的變更目前只存在本機，還沒確認同步到雲端，請勿關閉分頁，稍後會自動重試。';
  } else if (status==='ok') {
    banner.style.display = 'none';
  }
}

async function loadData() {
  if (!fbDb2) {
    // fbDb2 還沒好，等一下再試
    setTimeout(loadData, 200);
    return;
  }
  const pending = localStorage.getItem('otto2_v7_pending') === '1';
  try {
    setSync('saving','連線中...');
    const snap = await fbDb2.ref('salaryData').once('value');
    const data = snap.val();
    if (pending) {
      // 上次這台裝置存檔沒有確認成功過，雲端這份可能是存檔失敗前的舊版本。
      // 寧可先用本機備份繼續、馬上重新嘗試存一次，也不要無聲無息蓋掉還沒上雲端的編輯。
      console.warn('[Otto2] 偵測到上次可能有未同步的變更，改用本機備份並重新嘗試同步');
      try { const d = localStorage.getItem('otto2_v7'); if (d) S = JSON.parse(d); } catch(e2) {}
      setSync('err','偵測到未同步的變更，改用本機備份');
      saveNow();
    } else {
      if (data && typeof data === 'object') {
        S = Object.assign({ teachers:[], daily:{}, salaryBase:{}, cmBalance:{} }, data);
      }
      localStorage.setItem('otto2_v7', JSON.stringify(S));
      setSync('ok','已同步');
    }
    injectMayData();
    migrateFlagshipConsumablesToFloor4();
    applyCanvasTwoWeekForecast();
    migratePlanSalesDateKeys();
  } catch(e) {
    console.error('loadData error:', e);
    setSync('err','使用本機資料');
    try { const d = localStorage.getItem('otto2_v7'); if(d) S = JSON.parse(d); } catch(e2) {}
  }
  document.getElementById('loading-overlay').style.display = 'none';
  loadFirebaseSales();
  renderAll();
}


// ── 初始化歷史耗材資料 ────────────────────────────────────
function injectMayData() {
  var MAY_KEY = '2026-05_flagship';
  var MAY_VER = 'v2'; // 版本號，改這裡強制重新注入
  if (!S.consumables) S.consumables = {};
  // 已有正確版本就跳過
  if (S.consumables[MAY_KEY] && S.consumables[MAY_KEY].length > 0 && S.consumables['__may_ver'] === MAY_VER) return;
  S.consumables['__may_ver'] = MAY_VER;
  S.consumables[MAY_KEY] = [{"date": "2025-05-04", "cat": "其他", "name": "廣惠珊退費（先支出待還款）", "amount": 2000, "currency": "TWD", "origAmt": 2000, "rate": null, "source": "實體店", "note": "已廢單，待收回", "id": 1746086400000, "details": null}, {"date": "2025-05-01", "cat": "其他", "name": "供花", "amount": 350, "currency": "TWD", "origAmt": 350, "rate": null, "source": "實體店", "note": "Ethan付款", "id": 1746086401000, "details": null}, {"date": "2025-05-01", "cat": "包裝", "name": "捲筒垃圾袋、養生膠帶", "amount": 267, "currency": "TWD", "origAmt": 267, "rate": null, "source": "實體店", "note": "", "id": 1746086402000, "details": null}, {"date": "2025-05-01", "cat": "其他", "name": "拜拜用品", "amount": 946, "currency": "TWD", "origAmt": 946, "rate": null, "source": "實體店", "note": "", "id": 1746086403000, "details": null}, {"date": "2025-04-29", "cat": "其他", "name": "網頁費", "amount": 3890, "currency": "TWD", "origAmt": 3890, "rate": null, "source": "其他網路", "note": "資訊費用", "id": 1746086404000, "details": null}, {"date": "2025-05-11", "cat": "顏料", "name": "厚之漆", "amount": 1668, "currency": "TWD", "origAmt": 1668, "rate": null, "source": "實體店", "note": "", "id": 1746086405000, "details": null}, {"date": "2025-05-11", "cat": "顏料", "name": "礦石", "amount": 200, "currency": "TWD", "origAmt": 200, "rate": null, "source": "實體店", "note": "米雪付款", "id": 1746086406000, "details": null}, {"date": "2025-05-12", "cat": "顏料", "name": "油彩", "amount": 110, "currency": "TWD", "origAmt": 110, "rate": null, "source": "實體店", "note": "蓁蓁付款", "id": 1746086407000, "details": null}, {"date": "2025-05-14", "cat": "其他", "name": "石膏粉＋木螺絲釘", "amount": 213, "currency": "TWD", "origAmt": 213, "rate": null, "source": "實體店", "note": "", "id": 1746086408000, "details": null}, {"date": "2025-05-08", "cat": "樹脂", "name": "水晶碎石", "amount": 454, "currency": "TWD", "origAmt": 454, "rate": null, "source": "實體店", "note": "", "id": 1746086409000, "details": null}, {"date": "2025-05-08", "cat": "樹脂", "name": "水晶碎石", "amount": 240, "currency": "TWD", "origAmt": 240, "rate": null, "source": "實體店", "note": "", "id": 1746086410000, "details": null}, {"date": "2025-05-10", "cat": "包裝", "name": "塑膠手提袋", "amount": 255, "currency": "TWD", "origAmt": 255, "rate": null, "source": "實體店", "note": "", "id": 1746086411000, "details": null}, {"date": "2025-05-12", "cat": "其他", "name": "鏡子", "amount": 1073, "currency": "TWD", "origAmt": 1073, "rate": null, "source": "實體店", "note": "", "id": 1746086412000, "details": null}, {"date": "2025-05-12", "cat": "印刷", "name": "景印紙", "amount": 800, "currency": "TWD", "origAmt": 800, "rate": null, "source": "實體店", "note": "", "id": 1746086413000, "details": null}, {"date": "2025-05-01", "cat": "其他", "name": "商務方案＋簡訊費", "amount": 400, "currency": "TWD", "origAmt": 400, "rate": null, "source": "其他網路", "note": "系統費用", "id": 1746086414000, "details": null}, {"date": "2025-05-19", "cat": "其他", "name": "蛋糕（學員生日慶祝課贈）", "amount": 150, "currency": "TWD", "origAmt": 150, "rate": null, "source": "實體店", "note": "4F", "id": 1746086415000, "details": null}, {"date": "2025-05-07", "cat": "清潔", "name": "濕紙巾", "amount": 1232, "currency": "TWD", "origAmt": 1232, "rate": null, "source": "實體店", "note": "", "id": 1746086416000, "details": null}, {"date": "2025-05-08", "cat": "其他", "name": "台層清板、灑水盤、感應燈、毛巾、抹布", "amount": 972, "currency": "TWD", "origAmt": 972, "rate": null, "source": "實體店", "note": "", "id": 1746086417000, "details": null}, {"date": "2025-05-14", "cat": "畫布", "name": "木板", "amount": 1831, "currency": "TWD", "origAmt": 1831, "rate": null, "source": "實體店", "note": "", "id": 1746086418000, "details": null}, {"date": "2025-05-18", "cat": "包裝", "name": "塑膠袋", "amount": 697, "currency": "TWD", "origAmt": 697, "rate": null, "source": "實體店", "note": "", "id": 1746086419000, "details": null}, {"date": "2025-05-16", "cat": "其他", "name": "小鋸片", "amount": 215, "currency": "TWD", "origAmt": 215, "rate": null, "source": "實體店", "note": "", "id": 1746086420000, "details": null}, {"date": "2025-05-16", "cat": "其他", "name": "噴火槍", "amount": 130, "currency": "TWD", "origAmt": 130, "rate": null, "source": "實體店", "note": "", "id": 1746086421000, "details": null}, {"date": "2025-05-18", "cat": "其他", "name": "羊毛地毯", "amount": 1170, "currency": "TWD", "origAmt": 1170, "rate": null, "source": "實體店", "note": "", "id": 1746086422000, "details": null}, {"date": "2025-05-20", "cat": "顏料", "name": "麗花、地毯覆布、水晶碎石、拖盤、圓鑑、小書架、提袋、木板", "amount": 10956, "currency": "TWD", "origAmt": 10956, "rate": null, "source": "實體店", "note": "課程材料整批", "id": 1746086423000, "details": null}, {"date": "2025-05-19", "cat": "其他", "name": "拖盤、提袋運費", "amount": 3597, "currency": "TWD", "origAmt": 3597, "rate": null, "source": "其他網路", "note": "", "id": 1746086424000, "details": null}, {"date": "2025-05-19", "cat": "其他", "name": "停車費", "amount": 70, "currency": "TWD", "origAmt": 70, "rate": null, "source": "實體店", "note": "Ethan付款", "id": 1746086425000, "details": null}, {"date": "2025-05-19", "cat": "其他", "name": "運費", "amount": 60, "currency": "TWD", "origAmt": 60, "rate": null, "source": "其他網路", "note": "Ethan付款", "id": 1746086426000, "details": null}, {"date": "2025-05-22", "cat": "其他", "name": "支出證明單－關稅", "amount": 184, "currency": "TWD", "origAmt": 184, "rate": null, "source": "其他網路", "note": "", "id": 1746086427000, "details": null}, {"date": "2025-05-25", "cat": "顏料", "name": "指拇材料", "amount": 3180, "currency": "TWD", "origAmt": 3180, "rate": null, "source": "實體店", "note": "", "id": 1746086428000, "details": null}, {"date": "2025-05-25", "cat": "其他", "name": "碳鋅電池、螞蟻藥", "amount": 407, "currency": "TWD", "origAmt": 407, "rate": null, "source": "實體店", "note": "", "id": 1746086429000, "details": null}, {"date": "2025-05-28", "cat": "清潔", "name": "工業油污液", "amount": 224, "currency": "TWD", "origAmt": 224, "rate": null, "source": "實體店", "note": "", "id": 1746086430000, "details": null}, {"date": "2025-05-19", "cat": "樹脂", "name": "海浪膠", "amount": 1914, "currency": "TWD", "origAmt": 1914, "rate": null, "source": "實體店", "note": "", "id": 1746086431000, "details": null}, {"date": "2025-05-21", "cat": "其他", "name": "膠帶", "amount": 624, "currency": "TWD", "origAmt": 624, "rate": null, "source": "實體店", "note": "", "id": 1746086432000, "details": null}, {"date": "2025-05-26", "cat": "畫布", "name": "海洋流動木框", "amount": 534, "currency": "TWD", "origAmt": 534, "rate": null, "source": "實體店", "note": "", "id": 1746086433000, "details": null}, {"date": "2025-05-26", "cat": "其他", "name": "紙膠＋木夾", "amount": 1122, "currency": "TWD", "origAmt": 1122, "rate": null, "source": "實體店", "note": "材料+雜費", "id": 1746086434000, "details": null}, {"date": "2025-05-27", "cat": "畫布", "name": "海洋流動木框", "amount": 880, "currency": "TWD", "origAmt": 880, "rate": null, "source": "實體店", "note": "", "id": 1746086435000, "details": null}, {"date": "2025-05-27", "cat": "其他", "name": "辦公椅", "amount": 714, "currency": "TWD", "origAmt": 714, "rate": null, "source": "實體店", "note": "", "id": 1746086436000, "details": null}];
  // 直接寫入 Firebase consumables 節點
  if (fbDb2) {
    fbDb2.ref('salaryData/consumables').set(S.consumables)
      .then(function(){ console.log('[Otto2] 五月耗材資料已寫入 Firebase'); })
      .catch(function(e){ console.error('[Otto2] 寫入失敗:', e); });
  }
  console.log('[Otto2] 五月耗材資料已初始化，共 ' + S.consumables[MAY_KEY].length + ' 筆');
}

// ── 一次性搬移：耗材記帳「旗艦店」舊資料 → 統一併入「四樓」────────────
// 大熊確認：分樓層之前的旗艦店資料，本來就是四樓的支出，直接併過去，之後就不再有「旗艦店」這個分類
var CM_MIGRATE_VER = 'flagship_to_4f_v1';
function migrateFlagshipConsumablesToFloor4() {
  if (!S.consumables) S.consumables = {};
  if (S.consumables['__cm_migrate_ver'] === CM_MIGRATE_VER) return; // 已搬過，不重複搬
  var movedCount = 0, movedMonths = [];
  Object.keys(S.consumables).forEach(function(key){
    if (key.slice(-9) !== '_flagship') return; // 只動 "YYYY-MM_flagship" 這種格式的 key
    var monthKey = key.slice(0, -9);
    var newKey = monthKey + '_4f';
    var oldItems = S.consumables[key] || [];
    var existing = S.consumables[newKey] || [];
    S.consumables[newKey] = existing.concat(oldItems);
    movedCount += oldItems.length;
    movedMonths.push(monthKey);
    delete S.consumables[key];
  });
  // 零用金「上期餘額」紀錄也一起搬，避免下個月對不到舊的結餘
  if (S.cmBalance) {
    Object.keys(S.cmBalance).forEach(function(key){
      if (key.slice(-9) !== '_flagship') return;
      var monthKey = key.slice(0, -9);
      var newKey = monthKey + '_4f';
      if (S.cmBalance[newKey] === undefined) S.cmBalance[newKey] = S.cmBalance[key];
      delete S.cmBalance[key];
    });
  }
  S.consumables['__cm_migrate_ver'] = CM_MIGRATE_VER;
  if (movedCount > 0) {
    console.log('[Otto2] 旗艦店耗材舊資料已併入四樓，共 ' + movedCount + ' 筆（月份：' + movedMonths.join('、') + '）');
  }
  save();
}

// ── 一次性補入畫布兩週預估用量（安全庫存即兩週目標量）────────────
var INV_CANVAS_FORECAST_VER = 'canvas_2week_usage_20260706_v2';
var INV_CANVAS_TWO_WEEK_USAGE = [
  ['4F', 50], ['5F', 30], ['6F', 15], ['6P', 10],
  ['8F', 10], ['8P', 5], ['10F', 8], ['10P', 5],
  ['12F', 6], ['12P', 3], ['15F', 6], ['15P', 5],
  ['20F', 6], ['20P', 3], ['25F', 5], ['25P', 3],
  ['30F', 3], ['30P', 3], ['40F', 2], ['40P', 2],
  ['50F', 2], ['50P', 2]
];

function normalizeCanvasName(name) {
  return String(name || '').toUpperCase().replace(/\s+/g, '').replace(/畫布|畫板|號/g, '');
}

function findCanvasItemByCode(items, code) {
  var target = normalizeCanvasName(code);
  return items.find(function(it) {
    if (it.cat !== '畫布') return false;
    var n = normalizeCanvasName(it.name);
    return n === target || n === target + 'CANVAS' || n.indexOf(target) === 0;
  });
}

function applyCanvasTwoWeekForecast() {
  if (!S.inventory) S.inventory = {};
  if (S.inventory.__canvas_forecast_ver === INV_CANVAS_FORECAST_VER) return;

  var st = getInvStoreByName('flagship');
  var maxOrder = st.items.reduce(function(m, it){ return Math.max(m, getInvItemOrder(it)); }, -1);
  var changed = false;

  INV_CANVAS_TWO_WEEK_USAGE.forEach(function(row, idx) {
    var code = row[0];
    var twoWeekUsage = row[1];
    var weeklyUsage = twoWeekUsage / 2;
    var item = findCanvasItemByCode(st.items, code);

    if (item) {
      if (item.cat !== '畫布') item.cat = '畫布';
      if (!item.unit) item.unit = '張';
      if (item.safeStock !== twoWeekUsage) item.safeStock = twoWeekUsage;
      if (item.estUsage !== weeklyUsage) item.estUsage = weeklyUsage;
      item.restockCycleWeeks = 2;
      changed = true;
      return;
    }

    st.items.push({
      id: Date.now() + idx,
      cat: '畫布',
      name: code + '畫布',
      unit: '張',
      safeStock: twoWeekUsage,
      estUsage: weeklyUsage,
      restockCycleWeeks: 2,
      order: maxOrder + idx + 1
    });
    changed = true;
  });

  S.inventory.__canvas_forecast_ver = INV_CANVAS_FORECAST_VER;
  if (changed) save();
}

// ── 一次性修復：舊版 mbToday() 曾用 "/" 存 planSales 的日期 key ────────────
// Firebase key 不能包含 "/"，帶了這種 key 的裝置每次存檔都會失敗
// （紅字「儲存失敗（本機備份）」），這裡把壞掉的 key 轉成 "-" 就能修好。
var PLANSALES_KEY_MIGRATE_VER = 'plansales_slash_to_dash_v1';
function migratePlanSalesDateKeys() {
  if (S.__plansalesKeyMigrateVer === PLANSALES_KEY_MIGRATE_VER) return;
  var fixed = 0;
  if (S.planSales) {
    Object.keys(S.planSales).forEach(function(key){
      if (key.indexOf('/') === -1) return;
      var newKey = key.replace(/\//g, '-');
      var existing = S.planSales[newKey] || [];
      S.planSales[newKey] = existing.concat(S.planSales[key]);
      delete S.planSales[key];
      fixed++;
    });
  }
  S.__plansalesKeyMigrateVer = PLANSALES_KEY_MIGRATE_VER;
  if (fixed > 0) {
    console.log('[Otto2] planSales 日期 key 格式修正（"/"→"-"），共 ' + fixed + ' 個日期');
  }
  save();
}

async function doSave() {
  setSync('saving','儲存中...');
  // 進站的 saveNow() 有可能跳過 save()、直接叫這支，所以旗標也在這裡補標一次，
  // 不能只靠 save() 標——不然直接呼叫 saveNow() 那幾個地方會漏標。
  localStorage.setItem('otto2_v7_pending','1');
  localStorage.setItem('otto2_v7', JSON.stringify(S));
  if (!fbDb2) { setSync('err','Firebase 未初始化'); return false; }
  try {
    await fbDb2.ref('salaryData').set(S);
    localStorage.setItem('otto2_v7_pending','0'); // 這一輪的編輯確認存到雲端了，才清旗標
    setSync('ok','已儲存');
    return true;
  } catch(e) {
    console.error('doSave error:', e);
    setSync('err','儲存失敗（本機備份）'); // 旗標留著 '1'，下次開頁 loadData() 才不會被舊雲端資料蓋過去
    return false;
  }
}

function save() {
  // 立刻標「有未確認同步的變更」、立刻備份到本機，不等 800ms 防抖跑完——
  // 不然使用者編輯完馬上關分頁，這段空窗期發生的事，本機備份跟旗標都會漏記。
  localStorage.setItem('otto2_v7_pending','1');
  localStorage.setItem('otto2_v7', JSON.stringify(S));
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, 800);
}

/* 給「填完等不到明確結果就怕沒存到」的操作用：跳過 800ms 的背景防抖，
   立刻存、等真正的結果（true=雲端同步成功，false=只留在本機）。
   角落那顆小小的同步狀態字很容易錯過，呼叫端應該自己用回傳值把結果講清楚。 */
function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  return doSave();
}

// ── Month ──────────────────────────────────────────────
function getMonthKey() {
  return document.getElementById('selYear').value + '-' + document.getElementById('selMonth').value;
}

function getDaysInMonth(y, m) { return new Date(y, m, 0).getDate(); }

function initMonth() {
  const yEl = document.getElementById('selYear');
  const mEl = document.getElementById('selMonth');
  const now = new Date();
  for (let y=2024;y<=2030;y++) {
    const o = document.createElement('option');
    o.value = y; o.text = y + ' 年';
    if (y===now.getFullYear()) o.selected = true;
    yEl.appendChild(o);
  }
  ['01','02','03','04','05','06','07','08','09','10','11','12'].forEach((m,i) => {
    const o = document.createElement('option');
    o.value = m; o.text = (i+1) + ' 月';
    if (i===now.getMonth()) o.selected = true;
    mEl.appendChild(o);
  });
  yEl.onchange = mEl.onchange = renderAll;
}

// ── Lock ───────────────────────────────────────────────
function doUnlock() {
  const pwd = document.getElementById('lock-pwd').value;
  if (pwd === BOSS_PWD) {
    tabUnlocked[pendingTab] = true;
    document.getElementById('lock-overlay').style.display = 'none';
    document.getElementById('lock-pwd').value = '';
    document.getElementById('lock-err').textContent = '';
    doSwitchTab(pendingTab);
  } else {
    document.getElementById('lock-err').textContent = '密碼錯誤';
  }
}

// ── Tab ────────────────────────────────────────────────
function switchTab(tab) {
  const PROTECTED = ['salary','settings'];
  if (PROTECTED.includes(tab) && !tabUnlocked[tab]) {
    pendingTab = tab;
    document.getElementById('lock-overlay').style.display = 'flex';
    setTimeout(() => document.getElementById('lock-pwd').focus(), 100);
    return;
  }
  doSwitchTab(tab);
}

function doSwitchTab(tab) {
  /* 用 data-tab 對應，之後再加分頁也不會錯位 */
  document.querySelectorAll('.tab').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  if (tab==='today' && window.bkRender) bkRender();
  if (tab==='sched' && window.bkSchedRender) bkSchedRender();
  if (tab==='member') renderMember();
  if (tab==='recipe') renderRecipe();
  if (tab==='daily') renderDaily();
  if (tab==='monthly') renderMonthly();
  if (tab==='finance' && window.renderFinance) renderFinance();
  if (tab==='salary') renderSalary();
  if (tab==='consumables') renderConsumables();
  if (tab==='inventory') renderInventory();
  if (tab==='settings') renderTeacherList();
}

function switchStore(tab, store, el) {
  curStore[tab] = store;
  const container = document.getElementById('tab-' + tab);
  container.querySelectorAll('.store-btn').forEach(b => b.classList.remove('active'));
  el.classList.add('active');
  if (tab==='daily') renderDaily();
  if (tab==='monthly') renderMonthly();
  if (tab==='salary') renderSalary();
  if (tab==='consumables') renderConsumables();
  if (tab==='inventory') renderInventory();
}

function getTeachers(store) {
  return S.teachers.filter(t => t.store===store || t.store==='both' || (store==='flagship' && t.store==='flagship_cross'));
}

// ── Daily Data ─────────────────────────────────────────
function dayKey(store, mKey, day) {
  return mKey + '_' + store + '_' + String(day).padStart(2,'0');
}

function getDayEntries(store, mKey, day) {
  return S.daily[dayKey(store,mKey,day)]?.entries || [];
}

function getDayAgg(store, mKey, day) {
  const entries = getDayEntries(store, mKey, day);
  const r = { newCust:0, oldCust:0, teachers:{} };
  entries.forEach(e => {
    r.newCust += e.newCust || 0;
    r.oldCust += e.oldCust || 0;
    Object.keys(e.teachers||{}).forEach(tid => {
      if (!r.teachers[tid]) r.teachers[tid] = { count:0, outsideCount:0, campCount:0, campSessions:0, master:0, assist:0, junior:0, sales:0, hqCount:0, hqMaster:0, hqAssist:0, hqJunior:0 };
      const td = e.teachers[tid];
      // 人次/場次一律正常累計（獎金、講師費照算，不因總部代課而扣除）
      r.teachers[tid].count        += parseFloat(td.count)        || 0;
      r.teachers[tid].outsideCount += parseFloat(td.outsideCount) || 0;
      r.teachers[tid].campCount    += parseFloat(td.campCount)    || 0;
      r.teachers[tid].campSessions += parseFloat(td.campSessions) || 0;
      r.teachers[tid].master       += td.master       || 0;
      r.teachers[tid].assist       += td.assist       || 0;
      r.teachers[tid].junior       += td.junior       || 0;
      r.teachers[tid].sales        += td.sales        || 0;
      if (td.hq) {
        // 總部代課旗標：僅作日期紀錄用，不影響任何薪資計算
        r.teachers[tid].hqCount  += parseFloat(td.count) || 0;
        r.teachers[tid].hqMaster += td.master || 0;
        r.teachers[tid].hqAssist += td.assist || 0;
        r.teachers[tid].hqJunior += td.junior || 0;
      }
    });
  });
  // 獨立營隊登記（與每日課程紀錄分開儲存，這裡才合併給月報／薪資使用）
  const campDay = S.daily[dayKey(store,mKey,day)]?.camp || {};
  Object.keys(campDay).forEach(tid => {
    if (!r.teachers[tid]) r.teachers[tid] = { count:0, outsideCount:0, campCount:0, campSessions:0, master:0, assist:0, junior:0, sales:0, hqCount:0, hqMaster:0, hqAssist:0, hqJunior:0 };
    r.teachers[tid].campCount    += parseFloat(campDay[tid].count)    || 0;
    r.teachers[tid].campSessions += parseFloat(campDay[tid].sessions) || 0;
  });
  return r;
}

function addEntry(store, mKey, day, entry) {
  const k = dayKey(store, mKey, day);
  if (!S.daily[k]) S.daily[k] = { entries:[] };
  if (!S.daily[k].entries) S.daily[k].entries = [];
  S.daily[k].entries.push(entry);
  save();
}

function delEntry(store, mKey, day, idx) {
  const k = dayKey(store, mKey, day);
  if (S.daily[k]?.entries) {
    S.daily[k].entries.splice(idx, 1);
    save();
    renderDaily();
  }
}

function openEditEntry(store, mKey, day, idx) {
  var entries = getDayEntries(store, mKey, day);
  var entry = entries[idx];
  var teachers = getTeachers(store);
  if (!entry) return;

  // 建立編輯彈窗
  var existing = document.getElementById('edit-entry-modal');
  if (existing) existing.remove();

  var tRows = '';
  teachers.forEach(function(t) {
    var td = entry.teachers?.[t.id] || {};
    var lec = (td.master||0)*2000+(td.assist||0)*1500+(td.junior||0)*1000;
    tRows += '<tr>' +
      '<td><strong>' + t.name + '</strong></td>' +
      '<td><input type="number" class="in-num" id="ee_c_' + t.id + '" value="' + (td.count||0) + '" min="0" step="0.5" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="ee_o_' + t.id + '" value="' + (td.outsideCount||0) + '" min="0" step="0.5" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="ee_p_' + t.id + '" value="' + (td.campCount||0) + '" min="0" step="0.5" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="ee_m_' + t.id + '" value="' + (td.master||0) + '" min="0" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="ee_a_' + t.id + '" value="' + (td.assist||0) + '" min="0" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="ee_j_' + t.id + '" value="' + (td.junior||0) + '" min="0" onwheel="this.blur()"></td>' +
      '<td><input type="text" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;width:90px;font-size:13.5px;outline:none;font-family:inherit" id="ee_n_' + t.id + '" value="' + (td.note||'') + '"></td>' +
      (store==='guotu' ? '<td style="text-align:center"><input type="checkbox" id="ee_hq_' + t.id + '"' + (td.hq?' checked':'') + ' style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>' : '') +
      '</tr>';
  });

  var modal = document.createElement('div');
  modal.id = 'edit-entry-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:400;display:flex;align-items:center;justify-content:center;padding:20px';
  modal.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border);border-radius:14px;padding:24px;max-width:900px;width:100%;max-height:85vh;overflow-y:auto">' +
    '<div style="font-size:16px;font-weight:600;color:var(--gold2);margin-bottom:16px">✏️ 編輯紀錄 — ' + day + ' 日 ' + (entry.time||'') + '</div>' +
    '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">' +
    '<div class="day-meta-item"><label>新客</label><input type="number" class="in-num md" id="ee_nc" value="' + (entry.newCust||0) + '" min="0" onwheel="this.blur()"></div>' +
    '<div class="day-meta-item"><label>舊客</label><input type="number" class="in-num md" id="ee_oc" value="' + (entry.oldCust||0) + '" min="0" onwheel="this.blur()"></div>' +
    '<div class="day-meta-item"><label>備註</label><input type="text" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:14.5px;outline:none;font-family:inherit;width:150px" id="ee_note" value="' + (entry.note||'') + '"></div>' +
    '</div>' +
    '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>老師</th><th>一般人次</th><th>外派人次</th><th>營隊人次<br><span style="font-size:12px;color:var(--text3)">舊資料修正用</span></th><th>主教場</th><th>助教場</th><th>小老師場</th><th>備註</th>' + (store==='guotu'?'<th>總部代課</th>':'') + '</tr></thead>' +
    '<tbody>' + tRows + '</tbody></table></div>' +
    '<div style="display:flex;gap:10px;margin-top:16px">' +
    '<button class="btn btn-gold" onclick="saveEditEntry(\'' + store + '\',\'' + mKey + '\',' + day + ',' + idx + ')">✓ 儲存修改</button>' +
    '<button class="btn btn-outline" onclick="document.getElementById(\'edit-entry-modal\').remove()">取消</button>' +
    '</div></div>';
  document.body.appendChild(modal);
}

function saveEditEntry(store, mKey, day, idx) {
  var entries = getDayEntries(store, mKey, day);
  var entry = entries[idx];
  var teachers = getTeachers(store);
  if (!entry) return;

  var selM_edit = parseInt(document.getElementById('selMonth').value);
  entry.newCust = parseInt(document.getElementById('ee_nc')?.value) || 0;
  entry.oldCust = parseInt(document.getElementById('ee_oc')?.value) || 0;
  entry.note = document.getElementById('ee_note')?.value || '';
  entry.teachers = {};

  teachers.forEach(function(t) {
    var c = parseFloat(document.getElementById('ee_c_' + t.id)?.value) || 0;
    var o = parseFloat(document.getElementById('ee_o_' + t.id)?.value) || 0;
    var p = parseFloat(document.getElementById('ee_p_' + t.id)?.value) || 0;
    var m = parseInt(document.getElementById('ee_m_' + t.id)?.value) || 0;
    var a = parseInt(document.getElementById('ee_a_' + t.id)?.value) || 0;
    var j = parseInt(document.getElementById('ee_j_' + t.id)?.value) || 0;
    var n = document.getElementById('ee_n_' + t.id)?.value || '';
    var s = getFBSalesByDay(getSalesKey(t.name), selM_edit, day, store);
    if (c||o||p||m||a||j) {
      var prev = entry.teachers?.[t.id] || {};
      var hq = document.getElementById('ee_hq_' + t.id) ? (document.getElementById('ee_hq_' + t.id).checked ? 1 : 0) : (prev.hq || 0);
      entry.teachers[t.id] = {count:c, outsideCount:o, campCount:p, master:m, assist:a, junior:j, note:n, sales:s, trainingFee:prev.trainingFee||0, hq:hq};
    }
  });

  var k = dayKey(store, mKey, day);
  S.daily[k].entries[idx] = entry;
  save();
  document.getElementById('edit-entry-modal').remove();
  renderDayForm();
}

function saveCamp(store, mKey, day) {
  var k = dayKey(store, mKey, day);
  if (!S.daily[k]) S.daily[k] = { entries:[] };
  var teachers = getTeachers(store);
  var camp = {};
  teachers.forEach(function(t) {
    var c = parseFloat(document.getElementById('cmp_p_' + t.id)?.value) || 0;
    var s = parseFloat(document.getElementById('cmp_s_' + t.id)?.value) || 0;
    if (c || s) camp[t.id] = { count:c, sessions:s };
  });
  S.daily[k].camp = camp;
  save();
  renderDayForm();
  alert(Object.keys(camp).length ? '營隊登記已儲存' : '營隊登記已清空');
}

function setSupHours(store, mKey, day, field, val) {
  const k = dayKey(store, mKey, day);
  if (!S.daily[k]) S.daily[k] = { entries:[] };
  S.daily[k][field] = val;
  save();
}

// ── Render Daily ───────────────────────────────────────
function renderDaily() {
  const mKey = getMonthKey();
  const store = curStore.daily;
  const teachers = getTeachers(store);
  const el = document.getElementById('daily-content');
  const now = new Date();
  const selY = parseInt(document.getElementById('selYear').value);
  const selM = parseInt(document.getElementById('selMonth').value);
  const days = getDaysInMonth(selY, selM);
  const todayDay = (selY===now.getFullYear() && selM===now.getMonth()+1) ? now.getDate() : 1;

  if (!teachers.length) {
    el.innerHTML = '<div class="card"><div class="empty">此分店尚無老師，請店長至「老師設定」新增。</div></div>';
    return;
  }

  let opts = '';
  for (let d=1;d<=days;d++) {
    const dd = new Date(selY,selM-1,d);
    const wd = ['日','一','二','三','四','五','六'][dd.getDay()];
    const entries = getDayEntries(store, mKey, d);
    const hasMark = entries.length > 0 ? ' ✓' : '';
    opts += '<option value="' + d + '"' + (d===todayDay?' selected':'') + '>' + d + ' 日（週' + wd + ')' + hasMark + '</option>';
  }

  el.innerHTML = '<div class="card"><div class="card-title" style="justify-content:space-between">'+
    '<span>📅 選擇日期</span>' +
    '<button class="btn btn-outline btn-sm" onclick="loadData()">重新讀取</button>' +
    '</div>' +
    '<div style="display:flex;align-items:center;gap:12px">' +
    '<button onclick="shiftDay(-1)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:8px 12px;border-radius:7px;font-size:17px;cursor:pointer;line-height:1" title="前一天">‹</button>' +
    '<select id="day-sel" onchange="renderDayForm()" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:8px 14px;border-radius:7px;font-size:15.5px;outline:none;font-family:inherit">' + opts + '</select>' +
    '<button onclick="shiftDay(+1)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:8px 12px;border-radius:7px;font-size:17px;cursor:pointer;line-height:1" title="後一天">›</button>' +
    '<span style="font-size:13.5px;color:var(--text3)">✓ 表示已有紀錄</span>' +
    '</div></div>' +
    '<div id="day-form-area"></div>';

  renderDayForm();
}

/* ══════════════════════════════════════════════════════════
   今日核銷帶入：讀 otto2-2026 的 deductions，
   把當天核銷的人次與業績填進下方老師欄位，行政再確認或調整。
   ══════════════════════════════════════════════════════════ */
var DED_URL = 'https://otto2-2026-default-rtdb.asia-southeast1.firebasedatabase.app';
var dedCache = {};   // 'YYYY/MM/DD' -> [紀錄]
var dedLoading = {};

function dedDateStr(y, m, d) {
  return y + '/' + String(m).padStart(2,'0') + '/' + String(d).padStart(2,'0');
}

/* 核銷紀錄要不要算進「目前這個分店」的每日登記。
   deductions 的 dept 是「今日排課」核銷時寫的（旗艦固定寫 4F），
   跟業績系統 salesData 用的 dept（國圖／2F／4F）同一套判法：
   dept 是「國圖」才算國圖，其他一律算旗艦——
   不然切到國圖分頁，會把旗艦核銷的課全部当成國圖的人次帶進去。 */
function dedStoreOf(dept) { return dept === '國圖' ? 'guotu' : 'flagship'; }

async function loadDeductions(dateStr) {
  if (dedCache[dateStr] || dedLoading[dateStr]) return;
  dedLoading[dateStr] = true;
  try {
    var r = await fetch(DED_URL + '/deductions.json');
    var j = await r.json() || {};
    var out = [];
    Object.keys(j).forEach(function(k){
      var v = j[k];
      if (!v || v.voided) return;
      if (String(v.date||'').replace(/-/g,'/') !== dateStr) return;
      out.push(Object.assign({ _id:k }, v));
    });
    out.sort(function(a,b){ return String(a.at||'') < String(b.at||'') ? -1 : 1 });
    dedCache[dateStr] = out;
  } catch(e) { dedCache[dateStr] = []; }
  dedLoading[dateStr] = false;
  /* 資料到齊後整塊重畫一次，數字就會直接出現在欄位裡（不靠事後補填） */
  if (document.getElementById('ded-box')) renderDayForm();
}

/* 刪除一筆核銷紀錄。只清掉每日登記的這筆帳，
   會員點數與材料不會退——那要在「今日排課」用修正核銷或取消預約處理。 */
async function delDeduction(logId, dateStr) {
  if (!logId) return;
  if (!confirm('確定刪除這筆核銷紀錄？\n\n只會從每日登記移除，客人的點數和已扣的材料不會退回。\n如果要連點數一起還原，請到「今日排課」用「修正核銷」或「取消預約」。')) return;
  try {
    await fetch(DED_URL + '/deductions/' + logId + '.json', { method: 'DELETE' });
  } catch(e) { alert('刪除失敗：' + e.message); return; }
  dedRefresh(dateStr);
}

/* 重新抓一次核銷資料（核銷完、或想還原被改掉的數字時用） */
function dedRefresh(dateStr) {
  delete dedCache[dateStr];
  renderDayForm();
}

function buildDedHtml(dateStr) {
  var all = dedCache[dateStr];
  if (!all) return '<div class="muted" style="font-size:13.5px">讀取核銷紀錄中…</div>';
  var list = all.filter(function(r){ return dedStoreOf(r.dept) === curStore.daily });
  if (!list.length) return '<div class="muted" style="font-size:13.5px">這天還沒有核銷紀錄。核銷後這裡會列出來，可以一鍵帶入下方欄位。</div>';

  var teachers = getTeachers(curStore.daily);
  var known = {}, unknown = [];
  teachers.forEach(function(t){ known[t.name] = t; });

  var totalPpl = 0, totalAmt = 0;
  var rows = '';
  list.forEach(function(r){
    var ppl = +r.people || 0, amt = +r.total || 0;
    totalPpl += ppl; totalAmt += amt;
    var tName = r.teacher || '';
    /* 兩位小孩分別給不同老師教，核銷時本來就可以複選老師，
       存成 teachers[] 陣列（tName 只是給人看的頓號字串，永遠比對不到）。
       要照 teachers[] 逐一比對，兩個老師都查得到才不算「找不到」。 */
    var names = (r.teachers && r.teachers.length) ? r.teachers : (tName ? [tName] : []);
    var badNames = names.filter(function(n){ return n && !known[n] });
    var bad = badNames.length > 0;
    badNames.forEach(function(n){ if (unknown.indexOf(n) < 0) unknown.push(n) });
    var ak = [];
    if (r.adults) ak.push('大人' + r.adults);
    if (r.kids) ak.push('小孩' + r.kids);
    rows += '<tr>' +
      '<td style="font-size:13.5px">' + (r.customer || '—') + '</td>' +
      '<td style="font-size:13.5px;color:var(--text3)">' + ppl + ' 位' + (ak.length ? '（' + ak.join('・') + '）' : '') + '</td>' +
      '<td style="font-size:13.5px;color:var(--text3)">' + (r.items || '—') + (r.addonText ? '<br><span style="color:var(--gold2)">＋' + r.addonText + '</span>' : '') + '</td>' +
      '<td style="font-size:13.5px' + (bad ? ';color:var(--red)' : '') + '">' + (tName || '<span style="color:var(--red)">未指定</span>') + (bad ? ' ⚠' : '') + '</td>' +
      '<td style="text-align:right;font-size:13.5px">$' + amt.toLocaleString() + '</td>' +
      '<td><button class="btn btn-del btn-sm" onclick="delDeduction(\'' + r._id + '\',\'' + dateStr + '\')">刪除</button></td>' +
      '</tr>';
  });

  var h = '';
  h += '<div style="overflow-x:auto"><table><thead><tr>' +
       '<th>客人</th><th style="width:110px">人數</th><th>課程</th><th style="width:90px">老師</th><th style="width:80px">金額</th><th style="width:60px"></th>' +
       '</tr></thead><tbody>' + rows + '</tbody></table></div>';
  h += '<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:10px;font-size:14.5px">' +
       '<span>合計 <strong style="color:var(--gold2)">' + totalPpl + '</strong> 人次</span>' +
       '<span>核銷金額 <strong style="color:var(--gold2)">$' + totalAmt.toLocaleString() + '</strong></span>' +
       '</div>';
  if (unknown.length) {
    h += '<div class="info-box" style="margin-top:10px;border-color:var(--red)">' +
         '⚠ 這些老師名字在「老師設定」裡找不到：<strong>' + unknown.join('、') + '</strong>。' +
         '這幾筆人次帶不進去，請先到老師設定新增，或用「修正核銷」改成正確的名字。</div>';
  }
  h += '<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">' +
       '<span class="muted" style="font-size:13.5px">人次與營收已自動填入下方欄位，' +
       '確認後按「新增本次紀錄」與「儲存當日營收」存檔。</span>' +
       '<button class="btn btn-outline btn-sm" onclick="dedRefresh(\'' + dateStr + '\')">重新讀取</button>' +
       '</div>';
  return h;
}


/* 直接算出某天核銷的合計，供畫面組裝時就把數字寫進欄位（不靠事後補填） */
function dedTotals(dateStr) {
  var out = { byTeacher: {}, revenue: 0, skipped: 0, has: false };
  var all = dedCache[dateStr];
  if (!all || !all.length) return out;
  var list = all.filter(function(r){ return dedStoreOf(r.dept) === curStore.daily });
  if (!list.length) return out;
  out.has = true;
  var byName = {};
  getTeachers(curStore.daily).forEach(function(t){ byName[t.name] = t; });
  list.forEach(function(r){
    out.revenue += (+r.total || 0);
    /* 兩位小孩分別給不同老師教，這筆的人次要照人數平分給每個老師，
       不能整包算給一個人，也不能因為找不到單一 teacher 字串就整筆跳過。 */
    var names = (r.teachers && r.teachers.length) ? r.teachers : (r.teacher ? [r.teacher] : []);
    if (!names.length) { out.skipped++; return; }
    var per = (+r.people || 0) / names.length;
    var matched = false;
    names.forEach(function(n){
      var t = byName[n];
      if (!t) return;
      matched = true;
      out.byTeacher[t.id] = (out.byTeacher[t.id] || 0) + per;
    });
    if (!matched) out.skipped++;
  });
  return out;
}

function renderDayForm() {
  const mKey = getMonthKey();
  const store = curStore.daily;
  const teachers = getTeachers(store);
  const day = parseInt(document.getElementById('day-sel')?.value || 1);
  const entries = getDayEntries(store, mKey, day);
  const agg = getDayAgg(store, mKey, day);
  const el = document.getElementById('day-form-area');
  if (!el) return;

  // Teacher input rows
  let tRows = '';
  var selM_daily = parseInt(document.getElementById('selMonth').value);
  var selY_daily = parseInt(document.getElementById('selYear').value);
  var dedDate = dedDateStr(selY_daily, selM_daily, day);
  var DT = dedTotals(dedDate);
  teachers.forEach(function(t) {
    var fbAmt = getFBSalesByDay(getSalesKey(t.name), selM_daily, day, store);
    var salesCell;
    if (fbAmt > 0) {
      salesCell = '<td>' +
        '<span class="auto-val" style="font-size:15.5px;font-weight:600">$' + fbAmt.toLocaleString() + '</span>' +
        '<br><span style="font-size:12px;color:var(--green)">● 業績系統</span>' +
        '</td>';
    } else if (fbLoaded) {
      salesCell = '<td><span class="zero-val" style="font-size:13.5px">— <span style="font-size:12px;color:var(--text3)">無紀錄</span></span></td>';
    } else {
      salesCell = '<td><span style="font-size:12.5px;color:var(--text3)">載入中...</span></td>';
    }
    tRows += '<tr>' +
      '<td><strong>' + t.name + '</strong><br><span class="muted">' + TYPE_NAME[t.type] + '</span></td>' +
      '<td><input type="number" class="in-num" id="inp_c_' + t.id + '" value="' + (DT.byTeacher[t.id] || 0) + '" min="0" step="0.5" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="inp_o_' + t.id + '" value="0" min="0" step="0.5" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="inp_m_' + t.id + '" value="0" min="0" onchange="updateFee(\'' + t.id + '\')" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="inp_a_' + t.id + '" value="0" min="0" onchange="updateFee(\'' + t.id + '\')" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num" id="inp_j_' + t.id + '" value="0" min="0" onchange="updateFee(\'' + t.id + '\')" onwheel="this.blur()"></td>' +
      '<td><input type="number" class="in-num lg" id="inp_tf_' + t.id + '" value="0" min="0" placeholder="0" onwheel="this.blur()"></td>' +
      salesCell +
      '<td><input type="text" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:5px 8px;border-radius:5px;width:100px;font-size:13.5px;outline:none;font-family:inherit" id="inp_n_' + t.id + '"></td>' +
      (store==='guotu' ? '<td style="text-align:center"><input type="checkbox" id="inp_hq_' + t.id + '" style="width:16px;height:16px;accent-color:var(--gold);cursor:pointer"></td>' : '') +
      '</tr>';
  });

  // Entry log
  let logHtml = '';
  if (entries.length === 0) {
    logHtml = '<tr><td colspan="5"><div class="empty" style="padding:20px">今日尚無紀錄</div></td></tr>';
  } else {
    entries.forEach(function(entry, idx) {
      var nc = entry.newCust || 0;
      var oc = entry.oldCust || 0;
      var summary = [];
      Object.keys(entry.teachers||{}).forEach(function(tid) {
        var t = teachers.find(function(x){ return x.id===tid; });
        var td = entry.teachers[tid];
        var parts = [];
        if (td.count) parts.push(td.count + '人次' + (td.hq?'（總部代課）':''));
        if (td.outsideCount) parts.push('外派' + td.outsideCount);
        if (td.campCount) parts.push('營隊' + td.campCount);
        if (td.campSessions) parts.push('營隊' + td.campSessions + '堂');
        var lec = (td.master||0)*2000+(td.assist||0)*1500+(td.junior||0)*1000;
        if (lec) parts.push('講師費$' + lec.toLocaleString());
        if (td.sales) parts.push('業績$' + td.sales.toLocaleString());
        if (parts.length && t) summary.push(t.name + ': ' + parts.join('、'));
      });
      logHtml += '<tr>' +
        '<td style="color:var(--text3);font-size:13.5px;white-space:nowrap">' + (entry.time||'—') + '</td>' +
        '<td style="font-size:13.5px">' + (nc?'新客'+nc:'') + (oc?' 舊客'+oc:'') + ((!nc&&!oc)?'—':'') + '</td>' +
        '<td style="font-size:13.5px">' + (summary.join(' ｜ ')||'—') + '</td>' +
        '<td style="font-size:13.5px;color:var(--text3)">' + (entry.note||'') + '</td>' +
        '<td style="display:flex;gap:6px">' +
        '<button class="btn btn-outline btn-sm" onclick="openEditEntry(\'' + store + '\',\'' + mKey + '\',' + day + ',' + idx + ')">編輯</button>' +
        '<button class="btn btn-del btn-sm" onclick="delEntry(\'' + store + '\',\'' + mKey + '\',' + day + ',' + idx + ')">刪除</button>' +
        '</td>' +
        '</tr>';
    });
  }

  // Today aggregate summary
  var aggHtml = '';
  if (entries.length > 0) {
    var aggParts = [];
    if (agg.newCust) aggParts.push('新客 <strong style="color:var(--gold2)">' + agg.newCust + '</strong>');
    if (agg.oldCust) aggParts.push('舊客 <strong style="color:var(--gold2)">' + agg.oldCust + '</strong>');
    teachers.forEach(function(t) {
      var td = agg.teachers[t.id];
      if (td && td.count) aggParts.push(t.name + ' <strong style="color:var(--gold2)">' + td.count + '</strong>人次');
    });
    if (aggParts.length) {
      aggHtml = '<div class="entry-log"><div style="color:var(--text3);font-size:12.5px;margin-bottom:6px">今日合計</div>' +
        '<div style="display:flex;gap:16px;flex-wrap:wrap;font-size:14.5px">' + aggParts.join(' ') + '</div></div>';
    }
  }

  var html = '<div class="card">' +
    '<div class="card-title">🧾 今日核銷 — ' + day + ' 日</div>' +
    '<div id="ded-box">' + buildDedHtml(dedDate) + '</div>' +
    '</div>' +
    '<div class="card">' +
    '<div class="card-title">✏️ 新增本次紀錄 — ' + day + ' 日</div>' +
    '<div class="info-box">填入這次的數據，按「新增本次紀錄」後資料儲存，欄位自動歸零。</div>' +
    '<div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">' +
    '<div class="day-meta-item"><label>新客人數（本次）</label><input type="number" class="in-num md" id="inp_nc" value="0" min="0" onwheel="this.blur()"></div>' +
    '<div class="day-meta-item"><label>舊客人數（本次）</label><input type="number" class="in-num md" id="inp_oc" value="0" min="0" onwheel="this.blur()"></div>' +
    '<div class="day-meta-item"><label>備註</label><input type="text" style="background:var(--bg3);border:1px solid var(--border);color:var(--text);padding:6px 10px;border-radius:6px;font-size:14.5px;outline:none;font-family:inherit;width:150px" id="inp_en" placeholder="選填"></div>' +

    '</div>' +
    '<div style="overflow-x:auto"><table>' +
    '<thead><tr>' +
    '<th>老師</th>' +
    '<th>一般人次<br><span style="font-size:12px;color:var(--green)">計獎金</span></th>' +
    '<th>外派人次<br><span style="font-size:12px;color:var(--text3)">不計獎金</span></th>' +
    '<th>主教場<br><span style="font-size:12px;color:var(--text3)">$2,000</span></th>' +
    '<th>助教場<br><span style="font-size:12px;color:var(--text3)">$1,500</span></th>' +
    '<th>小老師場<br><span style="font-size:12px;color:var(--text3)">$1,000</span></th>' +
    '<th>外派培訓費<br><span style="font-size:12px;color:var(--text3)">記錄用</span></th>' +
    '<th>當日業績<br><span style="font-size:12px;color:var(--green)">自動帶入</span></th>' +
    '<th>備註</th>' +
    (store==='guotu' ? '<th>總部代課<br><span style="font-size:12px;color:var(--text3)">勾＝總部計薪</span></th>' : '') +
    '</tr></thead>' +
    '<tbody>' + tRows + '</tbody></table></div>' +
    '<div style="margin-top:16px;display:flex;gap:10px;align-items:center">' +
    '<button class="btn btn-gold" onclick="submitEntry(\'' + store + '\',\'' + mKey + '\',' + day + ')">✚ 新增本次紀錄</button>' +
    '<span style="font-size:13.5px;color:var(--text3)">按下後儲存，欄位自動歸零</span>' +
    '</div></div>';

  // 獨立當日營收區塊
  var dayRec = S.daily[dayKey(store, mKey, day)] || {};
  var existRev = +dayRec.revenue || 0;
  var existExtra = (dayRec.revenueExtra != null) ? (+dayRec.revenueExtra || 0)
                 : Math.max(0, existRev - (DT.revenue || 0));   /* 舊資料沒有這欄，用差額推回去 */
  var revTotal = (DT.revenue || 0) + existExtra;
  html += '<div class="card" style="border:1px solid var(--gold);margin-top:8px">' +
    '<div class="card-title" style="color:var(--gold2)">💰 當日營收（可單獨儲存）</div>' +
    '<div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">' +
    '<div class="day-meta-item"><label>核銷營收（自動）</label>' +
    '<div style="width:130px;padding:8px 12px;font-size:16px;color:var(--gold2);font-weight:700">$' + (DT.revenue||0).toLocaleString() + '</div>' +
    '</div>' +
    '<div style="font-size:18px;color:var(--text3)">＋</div>' +
    '<div class="day-meta-item"><label style="color:var(--gold2)">其他收入（手動填）</label>' +
    '<input type="number" id="inp_rev_extra" placeholder="0" min="0" value="' + (existExtra||'') + '" style="width:130px;background:var(--bg3);border:1px solid var(--gold);color:var(--text);padding:8px 12px;border-radius:6px;font-size:16px;outline:none;font-family:inherit" onwheel="this.blur()" oninput="updateRevTotal(' + (DT.revenue||0) + ')">' +
    '</div>' +
    '<div style="font-size:18px;color:var(--text3)">＝</div>' +
    '<div class="day-meta-item"><label>當日營收</label>' +
    '<div id="rev-total" style="width:130px;padding:8px 12px;font-size:18px;font-weight:700">$' + revTotal.toLocaleString() + '</div>' +
    '</div>' +
    '<button class="btn" style="background:var(--gold);color:#000;font-weight:700" onclick="saveRevOnly(\'' + store + '\',\'' + mKey + '\',' + day + ',' + (DT.revenue||0) + ')">💾 儲存當日營收</button>' +
    '</div>' +
    '<div style="font-size:12.5px;color:var(--text3);margin-top:8px" id="rev-hint">' +
      '「其他收入」填純賣材料、雜項這種沒有走核銷的收入。核銷那格會自己算，不用動。' +
      (existRev && existRev !== revTotal ? '<br><span style="color:var(--red)">已儲存的是 $' + existRev.toLocaleString() + '，與目前算出來的 $' + revTotal.toLocaleString() + ' 不同，記得重新儲存</span>' : '') +
    '</div>' +
    '</div>';

  // 獨立營隊登記區塊（與課程紀錄完全分開）
  var campDay = S.daily[dayKey(store, mKey, day)]?.camp || {};
  var campHasData = Object.keys(campDay).length > 0;
  var campRows = teachers.map(function(t) {
    var cd = campDay[t.id] || {};
    var cntCell = (t.type === 'part')
      ? '<td style="text-align:center;color:var(--text3);font-size:13.5px">—</td>'
      : '<td><input type="number" class="in-num md" id="cmp_p_' + t.id + '" value="' + (cd.count||'') + '" min="0" step="0.5" placeholder="0" onwheel="this.blur()"></td>';
    var sesCell = (t.type === 'part')
      ? '<td><input type="number" class="in-num md" id="cmp_s_' + t.id + '" value="' + (cd.sessions||'') + '" min="0" step="0.5" placeholder="0" onwheel="this.blur()"></td>'
      : '<td style="text-align:center;color:var(--text3);font-size:13.5px">—</td>';
    var rate = parseFloat(t.campRate) || 0;
    var fee = rate ? (t.type==='part' ? (parseFloat(cd.sessions)||0)*rate : (parseFloat(cd.count)||0)*rate) : 0;
    return '<tr><td><strong>' + t.name + '</strong></td>' +
      '<td class="muted">' + TYPE_NAME[t.type] + '</td>' +
      cntCell + sesCell +
      '<td style="font-size:13.5px;color:var(--text3)">' + (rate ? ('$' + rate.toLocaleString() + (t.type==='part'?'/堂':'/人次')) : '<span style="color:var(--red,#e74c3c)">未設定費率</span>') + '</td>' +
      '<td class="' + (fee?'auto-val':'zero-val') + '">' + (fee ? '$' + fee.toLocaleString() : '—') + '</td></tr>';
  }).join('');

  html += '<div class="card" style="border:1px solid var(--green);margin-top:8px">' +
    '<div class="card-title" style="color:var(--green)">🏕️ 營隊登記（獨立計費，可單獨儲存）</div>' +
    '<div class="info-box">這區跟上面的課程紀錄完全分開存放，同一位老師教營隊、教一般課不會互相影響。正職填人次、兼職填堂數，填完按下方按鈕儲存（會覆蓋當日營隊資料）。' + (campHasData ? '<br><strong style="color:var(--green)">● 本日已有營隊紀錄</strong>' : '') + '</div>' +
    '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>老師</th><th>職別</th>' +
    '<th>營隊人次<br><span style="font-size:12px;color:var(--text3)">正職計費</span></th>' +
    '<th>營隊堂數<br><span style="font-size:12px;color:var(--text3)">兼職計費</span></th>' +
    '<th>費率</th><th>本日營隊費</th></tr></thead>' +
    '<tbody>' + campRows + '</tbody></table></div>' +
    '<div style="margin-top:14px;display:flex;gap:10px;align-items:center">' +
    '<button class="btn" style="background:var(--green);color:#000;font-weight:700" onclick="saveCamp(\'' + store + '\',\'' + mKey + '\',' + day + ')">💾 儲存營隊登記</button>' +
    '<span style="font-size:13.5px;color:var(--text3)">沒有營隊的日子不用填，留空即可</span>' +
    '</div></div>';

  html += '<div class="card">' +
    '<div class="card-title">📋 今日累計紀錄 — ' + day + ' 日 <span style="font-size:13.5px;color:var(--text3);font-weight:400">共 ' + entries.length + ' 筆</span></div>' +
    aggHtml +
    '<div style="overflow-x:auto"><table>' +
    '<thead><tr><th>時間</th><th>新舊客</th><th>老師紀錄</th><th>備註</th><th></th></tr></thead>' +
    '<tbody>' + logHtml + '</tbody></table></div></div>';

  // Mixue support for flagship
  if (store === 'flagship') {
    var mixue = teachers.find(function(t){ return t.name==='米雪'; });
    if (mixue) {
      var k = dayKey(store, mKey, day);
      var supH = S.daily[k]?.supHours || 0;
      var supR = S.daily[k]?.supRate  || 0;
      html += '<div class="card">' +
        '<div class="card-title">🔄 米雪旗艦支援時數 — ' + day + ' 日</div>' +
        '<div class="day-meta">' +
        '<div class="day-meta-item"><label>支援時數</label>' +
        '<input type="number" class="in-num md" value="' + supH + '" onchange="setSupHours(\'' + store + '\',\'' + mKey + '\',' + day + ',\'supHours\',+this.value)" onwheel="this.blur()"></div>' +
        '<div class="day-meta-item"><label>時薪（元）</label>' +
        '<input type="number" class="in-num md" value="' + supR + '" onchange="setSupHours(\'' + store + '\',\'' + mKey + '\',' + day + ',\'supRate\',+this.value)" onwheel="this.blur()"></div>' +
        '</div></div>';
    }
  }

  el.innerHTML = html;
  loadDeductions(dedDate);
}

function shiftDay(delta) {
  var sel = document.getElementById('day-sel');
  if (!sel) return;
  var cur = parseInt(sel.value) || 1;
  var next = cur + delta;
  if (next < 1 || next > sel.options.length) return;
  sel.value = next;
  renderDayForm();
}

function updateFee(tid) {
  var m = parseInt(document.getElementById('inp_m_' + tid)?.value) || 0;
  var a = parseInt(document.getElementById('inp_a_' + tid)?.value) || 0;
  var j = parseInt(document.getElementById('inp_j_' + tid)?.value) || 0;
  var fee = m*2000 + a*1500 + j*1000;
  var el = document.getElementById('fee_' + tid);
  if (el) { el.textContent = fee ? '$'+fee.toLocaleString() : '—'; el.className = fee?'auto-val':'zero-val'; }
}

// ── 獨立儲存當日營收 ────────────────────────────────────
function updateRevTotal(dedRev) {
  var extra = parseInt(document.getElementById('inp_rev_extra')?.value) || 0;
  var el = document.getElementById('rev-total');
  if (el) el.textContent = '$' + ((+dedRev || 0) + extra).toLocaleString();
}

function saveRevOnly(store, mKey, day, dedRev) {
  var extra = parseInt(document.getElementById('inp_rev_extra')?.value) || 0;
  var rev = (+dedRev || 0) + extra;
  /* 0 也要能存進去。核銷作廢或當天業績記錯時，得有辦法把數字清乾淨，
     否則舊的快照會一直留在每日明細跟月報上。 */
  var rk = dayKey(store, mKey, day);
  var had = +(S.daily[rk] && S.daily[rk].revenue) || 0;
  if (!rev && had && !confirm('要把這天的營收清成 $0 嗎？\n\n目前記錄是 $' + had.toLocaleString() +
      '，清掉之後月報與薪資也會跟著變。')) return;
  if (!rev && !had) { alert('這天本來就沒有營收紀錄，不用儲存'); return; }
  if (!S.daily[rk]) S.daily[rk] = { entries:[] };
  S.daily[rk].revenue = rev;          /* 總額，月報與薪資讀這個 */
  S.daily[rk].revenueExtra = extra;   /* 手動填的部分，重算時才知道要留多少 */
  save();
  renderDayForm();
  // 顯示成功提示
  var btn = document.querySelector('[onclick*="saveRevOnly"]');
  if (btn) { var orig = btn.textContent; btn.textContent = '✅ 已儲存 $' + rev.toLocaleString(); btn.style.background='var(--green)'; setTimeout(function(){ btn.textContent=orig; btn.style.background='var(--gold)'; }, 2000); }
}

/* 作廢核銷之後，把那天已經存檔的營收快照重算一次。
   每日明細與月報讀的是 S.daily[].revenue，不是 deductions，
   所以核銷作廢了但這個數字不會自己變，得主動改。 */
async function recalcDayRevenue(dateStr) {
  try {
    var p = String(dateStr || '').split('/');
    if (p.length !== 3) return;
    var y = +p[0], m = +p[1], d = +p[2];
    var mKey = y + '-' + String(m).padStart(2, '0');
    var rk = dayKey('flagship', mKey, d);
    var rec = S.daily[rk];
    if (!rec || rec.revenue == null) return;      /* 那天根本沒存過營收就不用動 */
    dedRefresh(dateStr);                          /* 先把核銷快取清掉重讀 */
    var r = await fetch(DED_URL + '/deductions.json');
    var j = (await r.json()) || {};
    var dedRev = 0;
    Object.keys(j).forEach(function(k){
      var v = j[k];
      if (!v || v.voided) return;
      if (String(v.date) !== dateStr) return;
      dedRev += (+v.total || 0);
    });
    var extra = (rec.revenueExtra != null) ? (+rec.revenueExtra || 0)
              : Math.max(0, (+rec.revenue || 0) - dedRev);
    rec.revenue = dedRev + extra;
    rec.revenueExtra = extra;
    save();
    if (typeof renderDaily === 'function') renderDaily();
  } catch(e) {}
}

function submitEntry(store, mKey, day) {
  var teachers = getTeachers(store);
  var now = new Date();
  var time = now.getHours().toString().padStart(2,'0') + ':' + now.getMinutes().toString().padStart(2,'0');
  var entry = {
    time: time,
    newCust: parseInt(document.getElementById('inp_nc')?.value) || 0,
    oldCust: parseInt(document.getElementById('inp_oc')?.value) || 0,
    note: document.getElementById('inp_en')?.value || '',
    teachers: {}
  };
  var hasData = entry.newCust || entry.oldCust;
  var selM_submit = parseInt(document.getElementById('selMonth').value);
  teachers.forEach(function(t) {
    var c = parseFloat(document.getElementById('inp_c_' + t.id)?.value) || 0;
    var o = parseFloat(document.getElementById('inp_o_' + t.id)?.value) || 0;
    var p = 0;
    var m = parseInt(document.getElementById('inp_m_' + t.id)?.value) || 0;
    var a = parseInt(document.getElementById('inp_a_' + t.id)?.value) || 0;
    var j = parseInt(document.getElementById('inp_j_' + t.id)?.value) || 0;
    var n = document.getElementById('inp_n_' + t.id)?.value || '';
    var s = getFBSalesByDay(getSalesKey(t.name), selM_submit, day, store);
    var tf = parseInt(document.getElementById('inp_tf_' + t.id)?.value) || 0;
    var hq = document.getElementById('inp_hq_' + t.id)?.checked ? 1 : 0;
    if (c||o||m||a||j||tf) { hasData = true; entry.teachers[t.id] = {count:c,outsideCount:o,campCount:0,master:m,assist:a,junior:j,note:n,sales:s,trainingFee:tf,hq:hq}; }
  });
  if (!hasData) { alert('請至少填入一筆資料'); return; }
  addEntry(store, mKey, day, entry);
  renderDayForm();
}

// ── Monthly Aggregation ─────────────────────────────────
function aggregateMonth(store, mKey) {
  var selY = parseInt(document.getElementById('selYear').value);
  var selM = parseInt(document.getElementById('selMonth').value);
  var days = getDaysInMonth(selY, selM);
  var teachers = getTeachers(store);
  var totals = { newCust:0, oldCust:0, teachers:{} };
  teachers.forEach(function(t) {
    totals.teachers[t.id] = { count:0, outsideCount:0, campCount:0, campSessions:0, master:0, assist:0, junior:0, sales:0, supHours:0, supRate:0, trainingFee:0, hqCount:0, hqMaster:0, hqAssist:0, hqJunior:0 };
  });
  for (var d=1; d<=days; d++) {
    var agg = getDayAgg(store, mKey, d);
    totals.newCust += agg.newCust;
    totals.oldCust += agg.oldCust;
    teachers.forEach(function(t) {
      var td = agg.teachers[t.id] || {};
      totals.teachers[t.id].count        += parseFloat(td.count)        || 0;
      totals.teachers[t.id].outsideCount += parseFloat(td.outsideCount) || 0;
      totals.teachers[t.id].campCount    += parseFloat(td.campCount)    || 0;
      totals.teachers[t.id].campSessions += parseFloat(td.campSessions) || 0;
      totals.teachers[t.id].master       += td.master       || 0;
      totals.teachers[t.id].assist       += td.assist       || 0;
      totals.teachers[t.id].junior       += td.junior       || 0;
      totals.teachers[t.id].sales        += td.sales        || 0;
      totals.teachers[t.id].trainingFee  += td.trainingFee  || 0;
      totals.teachers[t.id].hqCount      += parseFloat(td.hqCount) || 0;
      totals.teachers[t.id].hqMaster     += td.hqMaster || 0;
      totals.teachers[t.id].hqAssist     += td.hqAssist || 0;
      totals.teachers[t.id].hqJunior     += td.hqJunior || 0;
    });
    // Mixue support hours stored at day level
    var mixue = teachers.find(function(t){ return t.name==='米雪'; });
    if (mixue) {
      var k = dayKey(store, mKey, d);
      totals.teachers[mixue.id].supHours += S.daily[k]?.supHours || 0;
      if (S.daily[k]?.supRate) totals.teachers[mixue.id].supRate = S.daily[k].supRate;
    }
  }
  return totals;
}

// ── Render Monthly ──────────────────────────────────────
function renderMonthly() {
  var mKey = getMonthKey();
  var store = curStore.monthly;
  var teachers = getTeachers(store);
  var el = document.getElementById('monthly-content');

  if (!teachers.length) { el.innerHTML = '<div class="card"><div class="empty">此分店尚無老師。</div></div>'; return; }

  var totals = aggregateMonth(store, mKey);
  var reloadBar = '<div class="card" style="display:flex;justify-content:flex-end;padding:10px 14px">' +
    '<button class="btn btn-outline btn-sm" onclick="loadData()">重新讀取</button></div>';
  var tCount=0, tOutside=0, tCamp=0, tLec=0, tSales=0;
  var selM_monthly = parseInt(document.getElementById('selMonth').value);
  teachers.forEach(function(t) {
    var tt = totals.teachers[t.id];
    var tLecRate = (t.lecRate !== undefined && t.lecRate !== null && t.lecRate !== '') ? parseFloat(t.lecRate) : 1;
    tCount   += tt.count;
    tOutside += tt.outsideCount;
    tCamp    += tt.campCount || 0;
    tLec     += Math.round((tt.master*2000 + tt.assist*1500 + tt.junior*1000) * tLecRate);
    var fbAmt = getFBSales(getSalesKey(t.name), selM_monthly, store);
    tSales   += fbAmt > 0 ? fbAmt : (tt.sales||0);
  });

  var statHtml = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="lbl">教學人次</div><div class="val">' + tCount + '</div></div>' +
    '<div class="stat-card"><div class="lbl">外派人次</div><div class="val">' + (tOutside||'—') + '</div></div>' +
    '<div class="stat-card"><div class="lbl">營隊人次</div><div class="val">' + (tCamp||'—') + '</div></div>' +
    '<div class="stat-card"><div class="lbl">講師費合計</div><div class="val">$' + tLec.toLocaleString() + '</div></div>' +
    '<div class="stat-card"><div class="lbl">新客</div><div class="val">' + totals.newCust + '</div></div>' +
    '<div class="stat-card"><div class="lbl">舊客</div><div class="val">' + totals.oldCust + '</div></div>' +
    '<div class="stat-card"><div class="lbl">業績合計</div><div class="val">$' + tSales.toLocaleString() + '</div></div>' +
    (function(){
      var deptForUnmatched = (store==='flagship') ? '4F' : null;
      if (!deptForUnmatched) return '';
      var um = getUnmatchedSales(selM_monthly, deptForUnmatched);
      if (!um.amt) return '';
      var names = Array.from(um.staffList).join('、');
      return '<div class="stat-card hi" style="background:rgba(192,57,43,.05);border-color:rgba(192,57,43,.32)"><div class="lbl" style="color:var(--red,#c0392b)">⚠️ 未列入合計</div><div class="val" style="color:var(--red,#c0392b);font-size:17px">$' + um.amt.toLocaleString() + '</div><div style="font-size:12.5px;color:var(--text3);margin-top:4px">業務姓名「' + names + '」對不到老師設定，這筆錢在會館業績系統裡有算，但這裡沒列入業績合計</div></div>';
    })() +
    (function(){ var _y=parseInt(document.getElementById('selYear').value); var _m=parseInt(document.getElementById('selMonth').value); var totalRev=0; for(var dd=1;dd<=getDaysInMonth(_y,_m);dd++){totalRev+=(S.daily[dayKey(store,mKey,dd)]?.revenue||0);} return '<div class="stat-card hi"><div class="lbl" style="color:var(--gold2)">月營收合計</div><div class="val" style="color:var(--gold2)">$' + totalRev.toLocaleString() + '</div></div>'; })() +
    '</div>';

  var tRows = '';
  teachers.forEach(function(t) {
    var tt = totals.teachers[t.id];
    var tLecRate2 = (t.lecRate !== undefined && t.lecRate !== null && t.lecRate !== '') ? parseFloat(t.lecRate) : 1;
    var lec = Math.round((tt.master*2000 + tt.assist*1500 + tt.junior*1000) * tLecRate2);
    tRows += '<tr>' +
      '<td><strong>' + t.name + '</strong><br><span class="muted">' + TYPE_NAME[t.type] + '</span></td>' +
      '<td><span class="badge ' + (t.role==='sales'?'b-purple':t.role==='admin'?'b-blue':'b-gray') + '">' + ROLE_NAME[t.role||'teacher'] + '</span></td>' +
      '<td>' + tt.count + '</td>' +
      '<td class="' + (tt.outsideCount?'auto-val':'zero-val') + '">' + (tt.outsideCount||'—') + '</td>' +
      '<td class="' + (tt.campCount?'auto-val':'zero-val') + '">' + (tt.campCount||'—') + '</td>' +
      '<td>' + (tt.master||'—') + '</td>' +
      '<td>' + (tt.assist||'—') + '</td>' +
      '<td>' + (tt.junior||'—') + '</td>' +
      '<td class="' + (lec?'auto-val':'zero-val') + '">' + (lec?'$'+lec.toLocaleString():'—') + '</td>' +
      '<td class="' + (tt.trainingFee?'auto-val':'zero-val') + '">' + (tt.trainingFee?'$'+tt.trainingFee.toLocaleString():'—') + '</td>' +
      (function(){
        var fbAmt2 = getFBSales(getSalesKey(t.name), selM_monthly, store);
        var dispAmt = fbAmt2 > 0 ? fbAmt2 : (tt.sales||0);
        var fbTag = fbAmt2 > 0 ? ' <span style="font-size:12px;color:var(--green)">●FB</span>' : '';
        return '<td class="' + (dispAmt?'auto-val':'zero-val') + '">' + (dispAmt?'$'+dispAmt.toLocaleString()+fbTag:'—') + '</td>';
      })() +
      (store==='flagship'?'<td class="' + (tt.supHours?'auto-val':'zero-val') + '">' + (tt.supHours||'—') + '</td>':'') +
      '</tr>';
  });
  tRows += '<tr class="total-row">' +
    '<td>合計</td><td>—</td>' +
    '<td>' + tCount + '</td>' +
    '<td>' + (tOutside||'—') + '</td>' +
    '<td>' + (tCamp||'—') + '</td>' +
    '<td>—</td><td>—</td><td>—</td>' +
    '<td>$' + tLec.toLocaleString() + '</td>' +
    '<td>' + (teachers.reduce(function(s,t){return s+(totals.teachers[t.id]?.trainingFee||0);},0)?'$'+teachers.reduce(function(s,t){return s+(totals.teachers[t.id]?.trainingFee||0);},0).toLocaleString():'—') + '</td>' +
    '<td>$' + tSales.toLocaleString() + '</td>' +
    (store==='flagship'?'<td>—</td>':'') +
    '</tr>';

  // Part-time hours section
  var ptTeachers = teachers.filter(function(t){ return t.type==='part'; });
  var ptHtml = '';
  if (ptTeachers.length) {
    var ptKey = 'pt_' + mKey + '_' + store;
    if (!S.salaryBase) S.salaryBase = {};
    if (!S.salaryBase[ptKey]) S.salaryBase[ptKey] = {};
    var ptKeyHQ = 'pthq_' + mKey + '_' + store;
    if (!S.salaryBase[ptKeyHQ]) S.salaryBase[ptKeyHQ] = {};
    var ptKeyCamp = 'ptcamp_' + mKey + '_' + store;
    if (!S.salaryBase[ptKeyCamp]) S.salaryBase[ptKeyCamp] = {};
    var ptRows = ptTeachers.map(function(t) {
      var hrs = S.salaryBase[ptKey][t.id] || 0;
      var iconId = 'ptSaved_' + ptKey + '_' + t.id;
      if (store === 'guotu') {
        var hqHrs = parseFloat(S.salaryBase[ptKeyHQ][t.id]) || 0;
        var gtHrs = Math.max(0, hrs - hqHrs);
        return '<tr><td><strong>' + t.name + '</strong></td><td>兼職</td>' +
          '<td><input type="number" class="in-num md" id="pts_hq_' + t.id + '" value="' + hqHrs + '" min="0" step="0.5" onchange="setPTSplit(\'' + ptKey + '\',\'' + ptKeyHQ + '\',\'' + t.id + '\',\'' + iconId + '\')" placeholder="0" onwheel="this.blur()"></td>' +
          '<td><input type="number" class="in-num md" id="pts_gt_' + t.id + '" value="' + gtHrs + '" min="0" step="0.5" onchange="setPTSplit(\'' + ptKey + '\',\'' + ptKeyHQ + '\',\'' + t.id + '\',\'' + iconId + '\')" placeholder="0" onwheel="this.blur()"></td>' +
          '<td><span id="pts_total_' + t.id + '" style="font-weight:600;color:var(--gold2)">' + hrs + ' 小時</span> <span id="' + iconId + '" style="color:var(--green,#2ecc71);font-weight:700;opacity:0;transition:opacity .3s">✓ 已儲存</span></td>' +
          '<td><span style="font-weight:600;color:var(--gold2)">' + ((totals.teachers[t.id]?.campSessions)||0) + ' 堂</span></td>' +
          '<td style="color:var(--text3);font-size:13.5px">獎金依總時數計算；總部時數的時薪費由總部支付；營隊堂數由「營隊登記」區自動加總，依每堂費用另計，不含在總時數內</td></tr>';
      }
      return '<tr><td><strong>' + t.name + '</strong></td><td>兼職</td>' +
        '<td style="display:flex;align-items:center;gap:8px">' +
        '<input type="number" class="in-num md" value="' + hrs + '" onchange="setPTHours(\'' + ptKey + '\',\'' + t.id + '\',+this.value,\'' + iconId + '\')" placeholder="0" onwheel="this.blur()">' +
        '<span id="' + iconId + '" style="color:var(--green,#2ecc71);font-weight:700;opacity:0;transition:opacity .3s">✓ 已儲存</span>' +
        '</td>' +
        '<td><span style="font-weight:600;color:var(--gold2)">' + ((totals.teachers[t.id]?.campSessions)||0) + ' 堂</span></td>' +
        '<td style="color:var(--text3);font-size:13.5px">填入後薪資頁自動計算；營隊堂數由「營隊登記」區自動加總，依每堂費用另計，不含在本月時數內</td></tr>';
    }).join('');
    ptHtml = '<div class="card"><div class="card-title">⏱️ 兼職時數登記 — ' + mKey + '</div>' +
      '<div class="info-box">每月填入一次即可，薪資頁自動帶入計算。</div>' +
      '<table><thead><tr><th>姓名</th><th>職別</th>' + (store==='guotu' ? '<th>總部支出時數</th><th>國圖支出時數</th><th>本月總時數<br><span style="font-size:12px;color:var(--text3)">自動加總</span></th>' : '<th>本月時數（小時）</th>') + '<th>營隊堂數<br><span style="font-size:12px;color:var(--green)">營隊登記自動加總</span></th><th>說明</th></tr></thead>' +
      '<tbody>' + ptRows + '</tbody></table></div>';
  }

  // Daily breakdown
  var selY = parseInt(document.getElementById('selYear').value);
  var selM = parseInt(document.getElementById('selMonth').value);
  var days = getDaysInMonth(selY, selM);
  var dailyRows = '';
  var dNewSum=0, dOldSum=0, dCountSum=0, dOutsideSum=0, dCampSum=0, dLecSum=0, dSalesSum=0;

  for (var d=1; d<=days; d++) {
    var agg2 = getDayAgg(store, mKey, d);
    var dd = new Date(selY,selM-1,d);
    var wd = ['日','一','二','三','四','五','六'][dd.getDay()];
    var isWkend = dd.getDay()===0||dd.getDay()===6;
    var dc=0, do2=0, dp=0, dl=0, ds=0;
    teachers.forEach(function(t) {
      var td = agg2.teachers[t.id]||{};
      dc += parseFloat(td.count)||0; do2 += parseFloat(td.outsideCount)||0; dp += parseFloat(td.campCount)||0;
      var dLecRate = (t.lecRate !== undefined && t.lecRate !== null && t.lecRate !== '') ? parseFloat(t.lecRate) : 1;
      dl += Math.round(((td.master||0)*2000+(td.assist||0)*1500+(td.junior||0)*1000) * dLecRate);
      var fbDayAmt = getFBSalesByDay(getSalesKey(t.name), selM, d, store);
      ds += fbDayAmt > 0 ? fbDayAmt : (td.sales||0);
    });
    dNewSum+=agg2.newCust; dOldSum+=agg2.oldCust;
    dCountSum+=dc; dOutsideSum+=do2; dCampSum+=dp; dLecSum+=dl; dSalesSum+=ds;

    var entries2 = getDayEntries(store, mKey, d);
    var detHtml = '';
    teachers.forEach(function(t) {
      var td = agg2.teachers[t.id]||{};
      var dLecRate2 = (t.lecRate !== undefined && t.lecRate !== null && t.lecRate !== '') ? parseFloat(t.lecRate) : 1;
      var tl = Math.round(((td.master||0)*2000+(td.assist||0)*1500+(td.junior||0)*1000) * dLecRate2);
      var fbDayAmt2 = getFBSalesByDay(getSalesKey(t.name), selM, d, store);
      var dayDispSales = fbDayAmt2 > 0 ? fbDayAmt2 : (td.sales||0);
      if (td.count||td.outsideCount||td.campCount||tl||dayDispSales) {
        detHtml += '<tr style="background:rgba(0,0,0,0.015)">' +
          '<td style="padding-left:28px;color:var(--text2);font-size:13.5px">└ ' + t.name + '</td>' +
          '<td></td><td></td>' +
          '<td style="font-size:13.5px;color:var(--text2)">' + (td.count||'—') + '</td>' +
          '<td style="font-size:13.5px;color:var(--text2)">' + (td.outsideCount||'—') + '</td>' +
          '<td style="font-size:13.5px;color:var(--text2)">' + (td.campCount||'—') + '</td>' +
          '<td style="font-size:13.5px;color:var(--text2)">' + (tl?'$'+tl.toLocaleString():'—') + '</td>' +
          '<td style="font-size:13.5px;color:var(--text2)">' + (dayDispSales?'$'+dayDispSales.toLocaleString():'—') + '</td>' +
          '</tr>';
      }
    });

    var rowId = 'dr_' + store + '_' + d;
    dailyRows += '<tr style="background:' + (isWkend?'rgba(201,168,76,0.03)':'') + ';' + (detHtml?'cursor:pointer':'') + '"' +
      (detHtml?' onclick="toggleRow(\'' + rowId + '\',\'arr_' + store + '_' + d + '\')"':'') + '>' +
      '<td><strong style="font-size:14.5px">' + d + '</strong><span style="color:var(--text3);font-size:12.5px;margin-left:5px">週' + wd + '</span>' +
      (detHtml?'<span id="arr_' + store + '_' + d + '" style="color:var(--text3);font-size:12px;margin-left:6px">▶</span>':'') +
      (entries2.length?'<span style="color:var(--green);font-size:12px;margin-left:4px">✓</span>':'') + '</td>' +
      '<td>' + (agg2.newCust||0) + '</td>' +
      '<td>' + (agg2.oldCust||0) + '</td>' +
      '<td class="' + (dc?'auto-val':'zero-val') + '">' + (dc||'—') + '</td>' +
      '<td class="' + (do2?'auto-val':'zero-val') + '">' + (do2||'—') + '</td>' +
      '<td class="' + (dp?'auto-val':'zero-val') + '">' + (dp||'—') + '</td>' +
      '<td class="' + (dl?'auto-val':'zero-val') + '">' + (dl?'$'+dl.toLocaleString():'—') + '</td>' +
      '<td class="' + (ds?'auto-val':'zero-val') + '">' + (ds?'$'+ds.toLocaleString():'—') + '</td>' +
      (function(){ var rv = S.daily[dayKey(store,mKey,d)]?.revenue||0; return '<td class="' + (rv?'auto-val':'zero-val') + '" style="color:var(--gold2)">' + (rv?'$'+rv.toLocaleString():'—') + '</td>'; })() +
      '</tr>';
    if (detHtml) {
      dailyRows += '<tr id="' + rowId + '" style="display:none"><td colspan="9" style="padding:0">' +
        '<table style="width:100%;border-collapse:collapse">' + detHtml + '</table></td></tr>';
    }
  }
  dailyRows += '<tr class="total-row"><td>合計</td>' +
    '<td>' + dNewSum + '</td><td>' + dOldSum + '</td>' +
    '<td>' + dCountSum + '</td>' +
    '<td>' + (dOutsideSum||'—') + '</td>' +
    '<td>' + (dCampSum||'—') + '</td>' +
    '<td>' + (dLecSum?'$'+dLecSum.toLocaleString():'—') + '</td>' +
    '<td>' + (dSalesSum?'$'+dSalesSum.toLocaleString():'—') + '</td>' +
    (function(){ var _y2=parseInt(document.getElementById('selYear').value); var _m2=parseInt(document.getElementById('selMonth').value); var totalRev2=0; for(var dd=1;dd<=getDaysInMonth(_y2,_m2);dd++){totalRev2+=(S.daily[dayKey(store,mKey,dd)]?.revenue||0);} return '<td style="color:var(--gold2)">' + (totalRev2?'$'+totalRev2.toLocaleString():'—') + '</td>'; })() +
    '</tr>';

  var summaryTable = '<div class="card">' +
    '<div class="card-title" style="justify-content:space-between"><span>📊 ' + STORE_NAME[store] + ' 月報 — ' + mKey + '</span>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn btn-outline btn-sm" onclick="fbSalesData={};fbLoaded=false;loadFirebaseSales();" style="border-color:var(--green);color:var(--green)">↺ 重新整理業績</button>' +
    '<button class="btn btn-dl btn-sm" onclick="dlExcel(\'' + store + '\',\'' + mKey + '\')">⬇ Excel</button>' +
    '<button class="btn btn-dl btn-sm" onclick="dlPDF(\'' + store + '\',\'' + mKey + '\')">⬇ PDF</button>' +
    '</div></div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>老師</th><th>職位</th><th>一般人次</th><th>外派人次</th><th>營隊人次</th>' +
    '<th>外派主教</th><th>外派助教</th><th>小老師場</th>' +
    '<th>講師費</th><th>外派培訓費</th><th>業績金額</th>' +
    (store==='flagship'?'<th>米雪支援時數</th>':'') +
    '</tr></thead><tbody>' + tRows + '</tbody></table></div></div>';

  var dailyTable = '<div class="card">' +
    '<div class="card-title">📆 每日明細 <span style="font-size:12.5px;color:var(--text3);font-weight:400">有 ▶ 可點開看老師明細</span></div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>日期</th><th>新客</th><th>舊客</th><th>教學人次</th><th>外派人次</th><th>營隊人次</th><th>講師費</th><th>業績</th><th style="color:var(--gold2)">營收</th>' +
    '</tr></thead><tbody>' + dailyRows + '</tbody></table></div></div>';

  el.innerHTML = reloadBar + statHtml + ptHtml + summaryTable + dailyTable;
}

function toggleRow(rowId, arrId) {
  var row = document.getElementById(rowId);
  var arr = document.getElementById(arrId);
  if (!row) return;
  var hidden = row.style.display === 'none';
  row.style.display = hidden ? 'table-row' : 'none';
  if (arr) arr.textContent = hidden ? '▼' : '▶';
}

// 國圖兼職：總部時數＋國圖時數 兩欄輸入，總時數自動加總儲存
function setPTSplit(ptKey, ptKeyHQ, tid, iconId) {
  if (!S.salaryBase) S.salaryBase = {};
  if (!S.salaryBase[ptKey]) S.salaryBase[ptKey] = {};
  if (!S.salaryBase[ptKeyHQ]) S.salaryBase[ptKeyHQ] = {};
  var hq = parseFloat(document.getElementById('pts_hq_' + tid)?.value) || 0;
  var gt = parseFloat(document.getElementById('pts_gt_' + tid)?.value) || 0;
  S.salaryBase[ptKeyHQ][tid] = hq;
  S.salaryBase[ptKey][tid] = hq + gt;
  save();
  var totalEl = document.getElementById('pts_total_' + tid);
  if (totalEl) totalEl.textContent = (hq + gt) + ' 小時';
  var icon = document.getElementById(iconId);
  if (icon) {
    icon.style.opacity = '1';
    setTimeout(function(){ icon.style.opacity = '0'; }, 1500);
  }
}

function setPTHours(ptKey, tid, val, iconId) {
  if (!S.salaryBase) S.salaryBase = {};
  if (!S.salaryBase[ptKey]) S.salaryBase[ptKey] = {};
  S.salaryBase[ptKey][tid] = val;
  save();
  if (iconId) {
    var icon = document.getElementById(iconId);
    if (icon) {
      icon.style.opacity = '1';
      setTimeout(function(){ icon.style.opacity = '0'; }, 1500);
    }
  }
}

// ── Salary ──────────────────────────────────────────────
// 底薪取值：本月手動填過「有效數字」才用本月的，否則（空白/0/從沒填過）一律帶「老師設定」的底薪
function getBaseSalary(t, bk) {
  if (t.type !== 'full') return 0;
  var v = S.salaryBase?.[bk]?.[t.id];
  var n = parseInt(v);
  if (v === undefined || v === null || v === '' || isNaN(n) || n <= 0) return parseInt(t.base) || 0;
  return n;
}

function calcSalary(t, store, mKey) {
  var totals = aggregateMonth(store, mKey);
  var tt = totals.teachers[t.id] || {};
  var adminAmt = store==='flagship' ? (t.adminF||0) : (t.adminG||0);
  var ptKey = 'pt_' + mKey + '_' + store;
  var ptHours = t.type==='part' ? (S.salaryBase?.[ptKey]?.[t.id] || 0) : 0;
  // 營隊費：正職＝營隊人次×每人次費用；兼職＝營隊堂數×每堂費用（堂數在每日登記逐日填，不看營隊人次）
  var campRate  = parseFloat(t.campRate) || 0;
  var campSess  = t.type==='part' ? (parseFloat(tt.campSessions) || 0) : 0;
  var campFee   = t.type==='part'
    ? Math.round(campSess * campRate)
    : Math.round((parseFloat(tt.campCount)||0) * campRate);

  var countBonus = 0;
  if (t.mode === 'minni') {
    var base = Math.max(0, ptHours/2 - 3);
    countBonus = Math.max(0, Math.round(((parseFloat(tt.count)||0) - base) * 50));
  } else if (t.mode === 'half') {
    countBonus = Math.round((parseFloat(tt.count)||0)/2) * 50;
  } else if (t.mode === 'over') {
    countBonus = Math.max(0, (parseFloat(tt.count)||0) - (t.threshold||0)) * 50;
  } else {
    countBonus = (parseFloat(tt.count)||0) * 50;
  }

  var lecRate = (t.lecRate !== undefined && t.lecRate !== null && t.lecRate !== '') ? parseFloat(t.lecRate) : 1;
  var lectureFee = Math.round(((tt.master||0)*2000 + (tt.assist||0)*1500 + (tt.junior||0)*1000) * lecRate);
  // Use Firebase sales data if loaded, otherwise use manually entered data
  var selM = parseInt(document.getElementById('selMonth').value);
  var fbAmt = getFBSales(getSalesKey(t.name), selM, store);
  var salesAmt = fbAmt > 0 ? fbAmt : (tt.sales||0);
  var salesPerf  = t.role !== 'sales' ? Math.round(salesAmt*0.02) : 0;
  // 參考顯示用：個人業績總和 + 個人績效（=業績×2%，不併入總薪資）；業務角色連參考數字都不顯示，避免誤會
  var personalTotal = salesAmt;
  var personalBonus = t.role !== 'sales' ? Math.round(salesAmt*0.02) : 0;
  var supFee     = (t.name==='米雪' && store==='flagship') ? (tt.supHours||0)*(tt.supRate||0) : 0;
  // 國圖兼職：總部支付時數（如米雪特休、米妮代班的星期二）由總部出錢，店內只付剩餘時數
  // 注意：人次獎金上面已用「總時數＋總人次」算完，不受此拆分影響
  var hqHours = 0;
  if (t.type==='part' && store==='guotu') {
    hqHours = S.salaryBase?.['pthq_' + mKey + '_' + store]?.[t.id] || 0;
    if (hqHours > ptHours) hqHours = ptHours;
  }
  var hqPay      = t.type==='part' ? Math.round((t.base||0)*hqHours) : 0;
  var ptBasePay  = t.type==='part' ? Math.round((t.base||0)*(ptHours-hqHours)) : 0;
  var sub = countBonus + lectureFee + salesPerf + adminAmt + supFee + ptBasePay + campFee;

  return { countBonus, lectureFee, salesPerf, adminAmt, supFee, ptBasePay, ptHours, hqHours, hqPay, sub, personalTotal, personalBonus, campFee, campSess };
}

function renderSalary() {
  var mKey = getMonthKey();
  var store = curStore.salary;
  var teachers = getTeachers(store);
  var el = document.getElementById('salary-content');
  var isFlagship = store==='flagship';

  if (!teachers.length) { el.innerHTML='<div class="card"><div class="empty">此分店尚無老師。</div></div>'; return; }

  var bk = mKey + '_' + store;
  if (!S.salaryBase) S.salaryBase = {};
  if (!S.salaryBase[bk]) S.salaryBase[bk] = {};

  var tCB=0,tLF=0,tSP=0,tAD=0,tSU=0,tPTB=0,tSUB=0,tBASE=0,tGRAND=0,tPTOT=0,tPBON=0,tCNT=0,tCAMPF=0;
  var monthTotals = aggregateMonth(store, mKey);
  var rows = teachers.map(function(t) {
    var c = calcSalary(t, store, mKey);
    var count = parseFloat(monthTotals.teachers[t.id]?.count) || 0;
    // 全薪：本月填過有效數字才用本月的，空白/0/沒填過一律自動帶「老師設定」的全薪
    var baseVal = getBaseSalary(t, bk);
    var base = t.type==='full' ? (baseVal || '') : 0;
    var grand = c.sub + baseVal;
    tCB+=c.countBonus; tLF+=c.lectureFee; tSP+=c.salesPerf;
    tAD+=c.adminAmt; tSU+=c.supFee; tPTB+=c.ptBasePay; tSUB+=c.sub; tBASE+=baseVal; tGRAND+=grand; tCAMPF+=c.campFee||0;
    tPTOT+=c.personalTotal; tPBON+=c.personalBonus; tCNT+=count;
    return { t, c, base, baseVal, grand, count };
  });

  var statHtml = '<div class="stat-grid">' +
    '<div class="stat-card"><div class="lbl">人次獎金合計</div><div class="val">$' + tCB.toLocaleString() + '</div></div>' +
    '<div class="stat-card"><div class="lbl">講師費合計</div><div class="val">$' + tLF.toLocaleString() + '</div></div>' +
    '<div class="stat-card"><div class="lbl">營隊費合計</div><div class="val">$' + tCAMPF.toLocaleString() + '</div></div>' +
    '<div class="stat-card"><div class="lbl">績效合計</div><div class="val">$' + (tSP+tAD).toLocaleString() + '</div></div>' +
    '<div class="stat-card"><div class="lbl">總薪資合計</div><div class="val">$' + tGRAND.toLocaleString() + '</div></div>' +
    '</div>';

  var tRows = rows.map(function(row) {
    var t=row.t, c=row.c, base=row.base, baseVal=row.baseVal, grand=row.grand;
    return '<tr>' +
      '<td><strong>' + t.name + '</strong><br><span class="badge ' + (t.type==='full'?'b-green':'b-gray') + '">' + TYPE_NAME[t.type] + '</span></td>' +
      '<td>' + (t.type==='full'?'<input type="number" class="in-num salary lg" value="' + base + '" placeholder="填入全薪" onchange="setSalaryBase(\'' + bk + '\',\'' + t.id + '\',+this.value)" onwheel="this.blur()">':'<span class="muted" style="font-size:12.5px">時薪制</span>') + '</td>' +
      '<td class="' + (row.count?'auto-val':'zero-val') + '">' + row.count.toLocaleString() + '</td>' +
      '<td class="' + (c.countBonus?'auto-val':'zero-val') + '">$' + c.countBonus.toLocaleString() + '</td>' +
      '<td class="' + (c.lectureFee?'auto-val':'zero-val') + '">$' + c.lectureFee.toLocaleString() + '</td>' +
      '<td class="' + (c.campFee?'auto-val':'zero-val') + '">' + (c.campFee?'$'+c.campFee.toLocaleString()+(t.type==='part'?'<br><span style="font-size:12px;color:var(--text3)">'+c.campSess+'堂×$'+(parseFloat(t.campRate)||0)+'</span>':''):'—') + '</td>' +
      '<td style="color:var(--text3)" class="' + (c.personalTotal?'auto-val':'zero-val') + '">$' + c.personalTotal.toLocaleString() + '</td>' +
      '<td class="' + (c.salesPerf?'auto-val':'zero-val') + '">$' + c.salesPerf.toLocaleString() + '</td>' +
      '<td class="' + (c.adminAmt?'auto-val':'zero-val') + '">' + (c.adminAmt?'$'+c.adminAmt.toLocaleString():'—') + '</td>' +
      (isFlagship?'<td class="' + (c.supFee?'auto-val':'zero-val') + '">' + (c.supFee?'$'+c.supFee.toLocaleString():'—') + '</td>':'') +
      '<td class="' + (c.ptBasePay?'auto-val':'zero-val') + '">' + (c.ptBasePay?'$'+c.ptBasePay.toLocaleString()+' ('+(c.ptHours-c.hqHours)+'h)':'—') + (c.hqPay?'<br><span style="font-size:12px;color:var(--text3)">總部另付 $'+c.hqPay.toLocaleString()+' ('+c.hqHours+'h)</span>':'') + '</td>' +
      '<td style="color:var(--gold2);font-weight:600;font-size:16px">$' + grand.toLocaleString() + '</td>' +
      '</tr>';
  }).join('');

  tRows += '<tr class="total-row">' +
    '<td>合計</td>' +
    '<td>$' + tBASE.toLocaleString() + '</td>' +
    '<td>' + tCNT.toLocaleString() + '</td>' +
    '<td>$' + tCB.toLocaleString() + '</td>' +
    '<td>$' + tLF.toLocaleString() + '</td>' +
    '<td>$' + tCAMPF.toLocaleString() + '</td>' +
    '<td>$' + tPTOT.toLocaleString() + '</td>' +
    '<td>$' + tSP.toLocaleString() + '</td>' +
    '<td>$' + tAD.toLocaleString() + '</td>' +
    (isFlagship?'<td>$' + tSU.toLocaleString() + '</td>':'') +
    '<td>$' + tPTB.toLocaleString() + '</td>' +
    '<td>$' + tGRAND.toLocaleString() + '</td>' +
    '</tr>';

  el.innerHTML = statHtml + '<div class="card">' +
    '<div class="card-title" style="justify-content:space-between"><span>💰 ' + STORE_NAME[store] + ' 薪資明細 — ' + mKey + '</span>' +
    '<div style="display:flex;gap:8px"><button class="btn btn-dl btn-sm" onclick="dlSalaryExcel(\'' + store + '\',\'' + mKey + '\')">⬇ Excel（兩店合併）</button>' +
    '<button class="btn btn-dl btn-sm" onclick="dlSalaryPDF(\'' + store + '\',\'' + mKey + '\')">⬇ PDF</button></div></div>' +
    '<div class="info-box">全薪已自動帶入「老師設定」的全薪，僅正職人員顯示；若本月要調整，直接改這欄即可（只會覆蓋當月，不影響老師設定的預設值）。兼職依時薪×時數自動計算。營隊費另計：正職＝營隊人次×老師設定的「每人次費用」；兼職＝營隊登記的營隊堂數×「每堂費用」，兼職不計營隊人次。營隊資料在每日登記頁的獨立區塊填寫，與一般課程紀錄分開。「個人業績總和」為參考欄，不算進總薪；「個人績效」（業績×2%）會算進總薪，業務角色不計。</div>' +
    '<div style="overflow-x:auto"><table><thead><tr>' +
    '<th>人員</th><th style="color:var(--gold)">全薪（正職填）</th><th>當月人次</th><th>人次獎金</th><th>講師費</th>' +
    '<th>營隊費<br><span style="font-weight:400;font-size:12px">正職:人次×費率<br>兼職:堂數×費率</span></th>' +
    '<th style="color:var(--text3)">個人業績總和<br><span style="font-weight:400;font-size:12px">（參考）</span></th>' +
    '<th>個人績效<br><span style="font-weight:400;font-size:12px">（=業績×2%）</span></th>' +
    '<th>行政績效</th>' +
    (isFlagship?'<th>米雪支援費</th>':'') +
    '<th>兼職時薪費</th><th style="color:var(--gold2)">總薪</th>' +
    '</tr></thead><tbody>' + tRows + '</tbody></table></div></div>';

  // 國圖：總部支付薪資結算（時數×時薪）＋代課日期紀錄
  if (store === 'guotu') {
    var hqPayRows = rows.filter(function(r){ return r.c.hqPay > 0; });
    var hqRecs = collectHQRecords(store, mKey);
    if (hqPayRows.length) {
      var hqPaySum = 0;
      var payRowsHtml = hqPayRows.map(function(r) {
        hqPaySum += r.c.hqPay;
        return '<tr><td><strong>' + r.t.name + '</strong></td><td>' + r.c.hqHours + ' 小時</td>' +
          '<td>$' + (r.t.base||0).toLocaleString() + '/時</td>' +
          '<td style="color:var(--gold2);font-weight:600">$' + r.c.hqPay.toLocaleString() + '</td></tr>';
      }).join('');
      payRowsHtml += '<tr class="total-row"><td>合計</td><td></td><td></td><td>$' + hqPaySum.toLocaleString() + '</td></tr>';
      el.innerHTML += '<div class="card" style="border:1px dashed var(--gold)">' +
        '<div class="card-title" style="color:var(--gold2)">🏢 總部支付薪資 — ' + mKey + '</div>' +
        '<div class="info-box">總部支付時數的時薪費（未列入上方店內薪資）。人次獎金不受影響，仍依當月總時數與總人次計算。</div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>老師</th><th>總部支付時數</th><th>時薪</th><th>總部支付金額</th></tr></thead>' +
        '<tbody>' + payRowsHtml + '</tbody></table></div></div>';
    }
    if (hqRecs.length) {
      var hqRows = hqRecs.map(function(r) {
        var lots = [];
        if (r.master) lots.push('主教×' + r.master);
        if (r.assist) lots.push('助教×' + r.assist);
        if (r.junior) lots.push('小老師×' + r.junior);
        return '<tr><td>' + r.day + ' 日</td><td><strong>' + r.name + '</strong></td>' +
          '<td>' + (r.count||0) + '</td><td>' + (lots.join('、')||'—') + '</td>' +
          '<td style="color:var(--text3);font-size:13.5px">' + (r.note||'') + '</td></tr>';
      }).join('');
      el.innerHTML += '<div class="card" style="border:1px dashed var(--gold)">' +
        '<div class="card-title" style="color:var(--gold2)">📋 總部代課日期紀錄 — ' + mKey + '</div>' +
        '<div class="info-box">每日登記勾選「總部代課」的日期明細，供回報總部核對用。這些人次已正常計入上方人次獎金，不會扣除。</div>' +
        '<div style="overflow-x:auto"><table><thead><tr><th>日期</th><th>老師</th><th>人次</th><th>場次</th><th>備註</th></tr></thead>' +
        '<tbody>' + hqRows + '</tbody></table></div></div>';
    }
  }
}

// 收集當月總部代課明細（日期、老師、人次、場次、備註）
function collectHQRecords(store, mKey) {
  var selY = parseInt(document.getElementById('selYear').value);
  var selM = parseInt(document.getElementById('selMonth').value);
  var teachers = getTeachers(store);
  var recs = [];
  for (var d=1; d<=getDaysInMonth(selY,selM); d++) {
    getDayEntries(store, mKey, d).forEach(function(e) {
      Object.keys(e.teachers||{}).forEach(function(tid) {
        var td = e.teachers[tid];
        if (!td.hq) return;
        var t = teachers.find(function(x){ return x.id===tid; });
        recs.push({ day:d, name:t?t.name:tid, count:parseFloat(td.count)||0,
          master:td.master||0, assist:td.assist||0, junior:td.junior||0, note:td.note||'' });
      });
    });
  }
  return recs;
}

function setSalaryBase(bk, tid, val) {
  if (!S.salaryBase) S.salaryBase = {};
  if (!S.salaryBase[bk]) S.salaryBase[bk] = {};
  S.salaryBase[bk][tid] = val;
  save(); renderSalary();
}

// ── Teacher Settings ────────────────────────────────────
function addTeacher() {
  var name = document.getElementById('f-name').value.trim();
  if (!name) { alert('請填入姓名'); return; }
  S.teachers.push({
    id: Date.now().toString(), name,
    store: document.getElementById('f-store').value,
    type:  document.getElementById('f-type').value,
    role:  document.getElementById('f-role').value,
    base:  parseInt(document.getElementById('f-base').value)||0,
    mode:  document.getElementById('f-mode').value,
    threshold: parseInt(document.getElementById('f-threshold').value)||0,
    adminF: parseInt(document.getElementById('f-adminF').value)||0,
    adminG: parseInt(document.getElementById('f-adminG').value)||0,
    lecRate: parseFloat(document.getElementById('f-lecRate').value)||1,
    campRate: parseFloat(document.getElementById('f-campRate')?.value)||0,
    note: document.getElementById('f-note').value.trim(),
  });
  save();
  ['f-name','f-base','f-note','f-threshold','f-adminF','f-adminG','f-lecRate'].forEach(function(id){ document.getElementById(id).value=''; });
  renderTeacherList();
}

function delTeacher(id) {
  if (!confirm('確定要刪除？')) return;
  S.teachers = S.teachers.filter(function(t){ return t.id!==id; });
  save(); renderTeacherList();
}

function editTeacher(id) {
  document.querySelectorAll('[id^="erow_"]').forEach(function(r){ r.style.display='none'; });
  var row = document.getElementById('erow_' + id);
  if (row) row.style.display = 'table-row';
}

function cancelEdit(id) {
  var row = document.getElementById('erow_' + id);
  if (row) row.style.display = 'none';
}

function saveTeacher(id) {
  var t = S.teachers.find(function(x){ return x.id===id; });
  if (!t) return;
  t.name      = document.getElementById('en_' + id).value.trim() || t.name;
  t.store     = document.getElementById('es_' + id).value;
  t.type      = document.getElementById('et_' + id).value;
  t.role      = document.getElementById('er_' + id).value;
  t.base      = parseInt(document.getElementById('eb_' + id).value)||0;
  t.mode      = document.getElementById('em_' + id).value;
  t.threshold = parseInt(document.getElementById('eth_' + id).value)||0;
  t.adminF    = parseInt(document.getElementById('eaf_' + id).value)||0;
  t.adminG    = parseInt(document.getElementById('eag_' + id).value)||0;
  t.lecRate   = parseFloat(document.getElementById('elr_' + id).value)||1;
  t.campRate  = parseFloat(document.getElementById('ecr_' + id)?.value)||0;
  t.note      = document.getElementById('eno_' + id).value.trim();
  save(); renderTeacherList();
}

var dragSrcId = null;

function dragStart(e) {
  dragSrcId = e.currentTarget.dataset.id;
  e.currentTarget.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
}

function dragOver(e) {
  e.preventDefault();
  var row = e.currentTarget;
  if (row.dataset.id !== dragSrcId) {
    document.querySelectorAll('#teacher-tbody tr').forEach(function(r){ r.classList.remove('drag-over'); });
    row.classList.add('drag-over');
  }
}

function dragLeave(e) { e.currentTarget.classList.remove('drag-over'); }

function dragDrop(e) {
  e.preventDefault();
  var targetId = e.currentTarget.dataset.id;
  if (!targetId || targetId===dragSrcId) {
    document.querySelectorAll('#teacher-tbody tr').forEach(function(r){ r.classList.remove('dragging','drag-over'); });
    return;
  }
  var srcIdx = S.teachers.findIndex(function(t){ return t.id===dragSrcId; });
  var tgtIdx = S.teachers.findIndex(function(t){ return t.id===targetId; });
  if (srcIdx!==-1 && tgtIdx!==-1) {
    var moved = S.teachers.splice(srcIdx,1)[0];
    S.teachers.splice(tgtIdx,0,moved);
    save(); renderTeacherList();
  }
}

function renderTeacherList() {
  var el = document.getElementById('teacher-list');
  if (!S.teachers.length) { el.innerHTML='<div class="empty">尚未新增老師。</div>'; return; }

  var rows = S.teachers.map(function(t) {
    var storeBadge = t.store==='flagship'?'b-gold':t.store==='guotu'?'b-blue':t.store==='flagship_cross'?'b-green':'b-purple';
    var editRow = '<tr id="erow_' + t.id + '" style="display:none;background:var(--bg3)">' +
      '<td></td><td colspan="11" style="padding:14px">' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:12px">' +
      '<div class="fg"><label>姓名</label><input id="en_' + t.id + '" value="' + t.name + '"></div>' +
      '<div class="fg"><label>分店</label><select id="es_' + t.id + '">' +
        '<option value="flagship"' + (t.store==='flagship'?' selected':'') + '>旗艦店</option>' +
        '<option value="guotu"' + (t.store==='guotu'?' selected':'') + '>國圖店</option>' +
                '<option value="flagship_cross"' + (t.store==='flagship_cross'?' selected':'') + '>旗艦跨部門</option>' +
      '</select></div>' +
      '<div class="fg"><label>職別</label><select id="et_' + t.id + '">' +
        '<option value="full"' + (t.type==='full'?' selected':'') + '>正職</option>' +
        '<option value="part"' + (t.type==='part'?' selected':'') + '>兼職</option>' +
      '</select></div>' +
      '<div class="fg"><label>職位</label><select id="er_' + t.id + '">' +
        '<option value="teacher"' + ((t.role||'teacher')==='teacher'?' selected':'') + '>老師</option>' +
        '<option value="admin"' + (t.role==='admin'?' selected':'') + '>行政</option>' +
        '<option value="sales"' + (t.role==='sales'?' selected':'') + '>業務</option>' +
      '</select></div>' +
      '<div class="fg"><label>全薪/時薪</label><input type="number" id="eb_' + t.id + '" value="' + (t.base||'') + '" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>人次計算</label><select id="em_' + t.id + '">' +
        '<option value="full"' + (t.mode==='full'?' selected':'') + '>完整（每人次×50）</option>' +
        '<option value="over"' + (t.mode==='over'?' selected':'') + '>超過門檻才計算</option>' +
        '<option value="half"' + (t.mode==='half'?' selected':'') + '>個人÷2（大熊用）</option>' +
        '<option value="minni"' + (t.mode==='minni'?' selected':'') + '>兼職特殊公式</option>' +
      '</select></div>' +
      '<div class="fg"><label>門檻</label><input type="number" id="eth_' + t.id + '" value="' + (t.threshold||'') + '" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>行政績效(旗)</label><input type="number" id="eaf_' + t.id + '" value="' + (t.adminF||'') + '" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>行政績效(圖)</label><input type="number" id="eag_' + t.id + '" value="' + (t.adminG||'') + '" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>講師費倍率</label><input type="number" step="0.1" min="0" max="1" id="elr_' + t.id + '" value="' + (t.lecRate!==undefined?t.lecRate:1) + '" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>營隊費率<br><span style="font-size:11.5px;text-transform:none">正職:元/人次｜兼職:元/堂</span></label><input type="number" id="ecr_' + t.id + '" value="' + (t.campRate||'') + '" placeholder="0" onwheel="this.blur()"></div>' +
      '<div class="fg"><label>備註</label><input id="eno_' + t.id + '" value="' + (t.note||'') + '"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-gold btn-sm" onclick="saveTeacher(\'' + t.id + '\')">儲存</button>' +
      '<button class="btn btn-outline btn-sm" onclick="cancelEdit(\'' + t.id + '\')">取消</button>' +
      '</div></td></tr>';

    var mainRow = '<tr draggable="true" data-id="' + t.id + '"' +
      ' ondragstart="dragStart(event)" ondragover="dragOver(event)" ondragleave="dragLeave(event)" ondrop="dragDrop(event)">' +
      '<td style="color:var(--text3);cursor:grab;font-size:17px;text-align:center">⠿</td>' +
      '<td><strong>' + t.name + '</strong></td>' +
      '<td><span class="badge ' + storeBadge + '">' + STORE_NAME[t.store] + '</span></td>' +
      '<td><span class="badge ' + (t.type==='full'?'b-green':'b-gray') + '">' + TYPE_NAME[t.type] + '</span></td>' +
      '<td><span class="badge ' + (t.role==='sales'?'b-purple':t.role==='admin'?'b-blue':'b-gray') + '">' + ROLE_NAME[t.role||'teacher'] + '</span></td>' +
      '<td class="muted">' + MODE_NAME[t.mode] + '</td>' +
      '<td class="muted">' + (t.threshold||'—') + '</td>' +
      '<td class="muted">' + (t.adminF?'$'+t.adminF.toLocaleString():'—') + '</td>' +
      '<td class="muted">' + (t.adminG?'$'+t.adminG.toLocaleString():'—') + '</td>' +
      '<td class="muted">' + (t.base?'$'+t.base.toLocaleString():'—') + '</td>' +
      '<td class="muted">' + (t.campRate?'$'+parseFloat(t.campRate).toLocaleString():'—') + '</td>' +
      '<td style="display:flex;gap:6px">' +
      '<button class="btn btn-outline btn-sm" onclick="editTeacher(\'' + t.id + '\')">編輯</button>' +
      '<button class="btn btn-del btn-sm" onclick="delTeacher(\'' + t.id + '\')">刪除</button>' +
      '</td></tr>';

    return mainRow + editRow;
  }).join('');

  el.innerHTML = '<table><thead><tr>' +
    '<th style="width:30px"></th><th>姓名</th><th>分店</th><th>職別</th><th>職位</th>' +
    '<th>人次計算</th><th>門檻</th><th>行政績效(旗)</th><th>行政績效(圖)</th><th>全薪/時薪</th><th>營隊費率</th><th></th>' +
    '</tr></thead><tbody id="teacher-tbody">' + rows + '</tbody></table>';
}

// ── Download ────────────────────────────────────────────
function dlExcel(store, mKey) {
  var teachers = getTeachers(store);
  var totals = aggregateMonth(store, mKey);
  var selY = parseInt(document.getElementById('selYear').value);
  var selM = parseInt(document.getElementById('selMonth').value);
  var days = getDaysInMonth(selY, selM);
  var wb = XLSX.utils.book_new();
  var sumData = [['Otto2 ARTCLUB ' + STORE_NAME[store] + ' 月報 - ' + mKey],[],
    ['姓名','職位','一般人次','外派人次','營隊人次','外派主教','外派助教','小老師','講師費','業績金額']];
  teachers.forEach(function(t) {
    var tt = totals.teachers[t.id]||{};
    var lec = (tt.master||0)*2000+(tt.assist||0)*1500+(tt.junior||0)*1000;
    sumData.push([t.name,ROLE_NAME[t.role||'teacher'],tt.count||0,tt.outsideCount||0,tt.campCount||0,tt.master||0,tt.assist||0,tt.junior||0,lec,tt.sales||0]);
  });
  sumData.push([],['新客',totals.newCust,'舊客',totals.oldCust]);
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumData), '月報');
  var hdr = ['日期','新客','舊客'];
  teachers.forEach(function(t){ hdr.push(t.name+'人次',t.name+'外派',t.name+'營隊',t.name+'業績'); });
  var dailyData = [hdr];
  for (var d=1;d<=days;d++) {
    var agg = getDayAgg(store, mKey, d);
    var row = [mKey+'-'+String(d).padStart(2,'0'), agg.newCust||0, agg.oldCust||0];
    teachers.forEach(function(t){ var td=agg.teachers[t.id]||{}; row.push(td.count||0,td.outsideCount||0,td.campCount||0,td.sales||0); });
    dailyData.push(row);
  }
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(dailyData), '每日明細');
  XLSX.writeFile(wb, 'Otto2_' + STORE_NAME[store] + '_月報_' + mKey + '.xlsx');
}

function dlSalaryExcel(store, mKey) {
  // 不管目前停在哪個分店，一律一次匯出兩間店：旗艦在上、國圖在下，排版照手工報表格式
  if (typeof ExcelJS === 'undefined') { alert('樣式函式庫尚未載入，請確認網路連線後重新整理再試'); return; }
  var wb = new ExcelJS.Workbook();
  var ws = wb.addWorksheet('薪資明細');
  ws.columns = [8,15,12,15,8,18,15,11,14,11,11,11,12,32,12].map(function(w){ return { width:w }; });

  var C_FLAG='FFF08080', C_GUOTU='FFFFEB3B', C_LABEL='FFF2CE8F', C_PINK='FFF48FB1';
  var thin = { style:'thin', color:{argb:'FFBFBFBF'} };
  function styleRow(row, fill, bold) {
    for (var i=1; i<=15; i++) {
      var cell = row.getCell(i);
      if (fill) cell.fill = { type:'pattern', pattern:'solid', fgColor:{argb:fill} };
      cell.border = { top:thin, left:thin, bottom:thin, right:thin };
      cell.font = { name:'Microsoft JhengHei', size:11, bold:!!bold };
    }
  }
  function numFmt(row, cols) { cols.forEach(function(c){ row.getCell(c).numFmt='#,##0'; }); }

  function addStoreSection(storeKey) {
    var teachers = getTeachers(storeKey);
    if (!teachers.length) return;
    var bk = mKey + '_' + storeKey;
    var totals = aggregateMonth(storeKey, mKey);
    var selY = parseInt(document.getElementById('selYear').value);
    var selM = parseInt(document.getElementById('selMonth').value);
    var totalRev=0, totalCount=0;
    for (var d=1; d<=getDaysInMonth(selY,selM); d++) totalRev += (S.daily[dayKey(storeKey,mKey,d)]?.revenue || 0);
    teachers.forEach(function(t){ totalCount += parseFloat(totals.teachers[t.id]?.count) || 0; });

    // 區段總覽列（旗艦紅／國圖黃）；現收、團體業績系統沒有這兩個數字，留白給你自己填
    var hr = ws.addRow([STORE_NAME[storeKey].replace('店',''), '獎金計算區', '現收', '', '營收', totalRev, '人次', totalCount, '團體業績', '', '', '', '', '備註', '小計']);
    styleRow(hr, storeKey==='flagship' ? C_FLAG : C_GUOTU, true);
    numFmt(hr, [6]);

    var infos = teachers.map(function(t) {
      var c = calcSalary(t, storeKey, mKey);
      var base = getBaseSalary(t, bk);
      return { t:t, c:c, tt:(totals.teachers[t.id]||{}), base:base, grand:c.sub+base };
    });
    var grandSum = infos.reduce(function(s,i){ return s+i.grand; }, 0);

    infos.forEach(function(info, idx) {
      var t=info.t, c=info.c, tt=info.tt;
      var isPart = t.type === 'part';
      var bonusLabel = (t.mode==='over' && t.threshold) ? ('人次獎金（已扣'+t.threshold+'人次）') : '人次獎金';
      var lr = ws.addRow(['', (isPart && c.hqPay>0) ? '姓名（付款方）' : '姓名',
        isPart ? '累積時數' : '全薪',
        isPart ? ('薪資總和（'+(t.base||0)+'）') : '加班時數',
        '人次', bonusLabel, '講師、客訂費用', '營隊費', '個人業績總額', '個人績效', '團體績效', '行政績效', '總薪', '', '']);
      styleRow(lr, C_LABEL, false);

      var note = c.supFee ? ('含支援費 $' + c.supFee.toLocaleString()) : '';
      var dr;
      if (isPart && c.hqPay > 0) {
        // 有總部代課的兼職：拆成兩列，誰付錢就是誰一列，會計照列付款
        dr = ws.addRow(['', t.name + '（國圖支付）',
          (c.ptHours - c.hqHours), c.ptBasePay||'',
          parseFloat(tt.count)||0, c.countBonus||'', c.lectureFee||'', c.campFee||'', c.personalTotal||'', c.salesPerf||'', '', c.adminAmt||'', info.grand,
          note ? note : '國圖支付：國圖時數時薪費＋獎金＋講師費', '']);
        styleRow(dr, null, false);
        dr.getCell(3).numFmt = '#,##0.##';
        numFmt(dr, [4,6,7,8,9,10,11,12,13]);
        var hr2 = ws.addRow(['', t.name + '（總部支付）',
          c.hqHours, c.hqPay, '', '', '', '', '', '', '', '', c.hqPay,
          '總部支付：僅代課時數 ' + c.hqHours + ' 小時 × $' + (t.base||0) + '/時，不含獎金與講師費', '']);
        styleRow(hr2, 'FFFDE7EF', false);
        hr2.getCell(3).numFmt = '#,##0.##';
        numFmt(hr2, [4,13]);
      } else {
        dr = ws.addRow(['', t.name,
          isPart ? (c.ptHours||0) : (info.base||''),
          isPart ? (c.ptBasePay||'') : '',
          parseFloat(tt.count)||0, c.countBonus||'', c.lectureFee||'', c.campFee||'', c.personalTotal||'', c.salesPerf||'', '', c.adminAmt||'', info.grand, note, '']);
        styleRow(dr, null, false);
        // 第3欄（累積時數/全薪）允許小數顯示，避免 29.5 被顯示成 30
        dr.getCell(3).numFmt = '#,##0.##';
        numFmt(dr, [4,6,7,8,9,10,11,12,13]);
      }

      // 每區最後一位老師那列，小計欄放整店總薪合計（粉紅底）＝店內應付，不含總部
      if (idx === infos.length - 1) {
        var sc = dr.getCell(15);
        sc.value = grandSum;
        sc.numFmt = '#,##0';
        sc.fill = { type:'pattern', pattern:'solid', fgColor:{argb:C_PINK} };
        sc.font = { name:'Microsoft JhengHei', size:11, bold:true };
      }
    });
  }

  addStoreSection('flagship');
  addStoreSection('guotu');

  // 國圖總部支付薪資摘要＋代課日期紀錄
  var hqTeachers = getTeachers('guotu').filter(function(t){ return t.type==='part'; });
  var hqSum = 0, hqLines = [];
  hqTeachers.forEach(function(t) {
    var c2 = calcSalary(t, 'guotu', mKey);
    if (c2.hqPay > 0) { hqSum += c2.hqPay; hqLines.push({name:t.name, hours:c2.hqHours, rate:t.base||0, pay:c2.hqPay}); }
  });
  if (hqLines.length) {
    hqLines.forEach(function(l, i) {
      var row = ws.addRow(['', i===0?'總部支付薪資':'', l.name, l.hours + ' 小時', '$' + l.rate + '/時', l.pay, '', '', '', '', '', '', '', '總部支付時數之時薪費，未列入店內薪資', '']);
      styleRow(row, 'FFFDE7EF', false);
      row.getCell(6).numFmt = '#,##0';
    });
    var sumRow = ws.addRow(['', '', '', '', '總部支付合計', hqSum, '', '', '', '', '', '', '', '']);
    styleRow(sumRow, 'FFFDE7EF', true);
    sumRow.getCell(6).numFmt = '#,##0';
  }
  var hqRecs = (typeof collectHQRecords==='function') ? collectHQRecords('guotu', mKey) : [];
  if (hqRecs.length) {
    hqRecs.forEach(function(r, i) {
      var lots = [];
      if (r.master) lots.push('主教×' + r.master);
      if (r.assist) lots.push('助教×' + r.assist);
      if (r.junior) lots.push('小老師×' + r.junior);
      var row = ws.addRow(['', i===0?'代課日期紀錄':'', r.day + ' 日', r.name, r.count||0, lots.join('、'), '', '', '', '', '', '', '', '人次已計入獎金；僅供總部核對日期' + (r.note?('；'+r.note):''), '']);
      styleRow(row, 'FFFDF3F6', false);
    });
  }

  wb.xlsx.writeBuffer().then(function(buf) {
    var blob = new Blob([buf], { type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'Otto2_薪資_兩店_' + mKey + '.xlsx';
    a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); }, 3000);
  }).catch(function(e){ alert('匯出失敗：' + e.message); });
}

function dlPDF(store, mKey) {
  var teachers = getTeachers(store);
  var totals = aggregateMonth(store, mKey);
  var rows = teachers.map(function(t) {
    var tt = totals.teachers[t.id]||{};
    var lec = (tt.master||0)*2000+(tt.assist||0)*1500+(tt.junior||0)*1000;
    return '<tr><td>'+t.name+'</td><td>'+ROLE_NAME[t.role||'teacher']+'</td><td>'+(tt.count||0)+'</td><td>'+(tt.outsideCount||0)+'</td><td>'+(tt.campCount||0)+'</td><td>$'+lec.toLocaleString()+'</td><td>$'+(tt.sales||0).toLocaleString()+'</td></tr>';
  }).join('');
  var w = window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:14.5px}th,td{border:1px solid #ccc;padding:8px}th{background:#f5f5f5}</style></head><body>'+
    '<h2>Otto2 ' + STORE_NAME[store] + ' 月報 — ' + mKey + '</h2>'+
    '<p>新客：'+totals.newCust+' ｜ 舊客：'+totals.oldCust+'</p>'+
    '<table><thead><tr><th>姓名</th><th>職位</th><th>人次</th><th>外派</th><th>營隊</th><th>講師費</th><th>業績</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<script>window.onload=function(){window.print();window.close()}<\/script></body></html>');
  w.document.close();
}

function dlSalaryPDF(store, mKey) {
  var teachers = getTeachers(store);
  var bk = mKey+'_'+store;
  var isFlagship = store==='flagship';
  var rows = teachers.map(function(t) {
    var c = calcSalary(t,store,mKey);
    var base = getBaseSalary(t, bk);
    return '<tr><td>'+t.name+'</td><td>$'+c.countBonus.toLocaleString()+'</td><td>$'+c.lectureFee.toLocaleString()+'</td><td>$'+(c.campFee||0).toLocaleString()+'</td><td>$'+c.salesPerf.toLocaleString()+'</td><td>$'+c.adminAmt.toLocaleString()+'</td>'+(isFlagship?'<td>$'+c.supFee.toLocaleString()+'</td>':'')+'<td>$'+c.ptBasePay.toLocaleString()+'</td><td>$'+c.sub.toLocaleString()+'</td><td>$'+base.toLocaleString()+'</td><td><strong>$'+(c.sub+base).toLocaleString()+'</strong></td></tr>';
  }).join('');
  var w = window.open('','_blank');
  w.document.write('<!DOCTYPE html><html><head><meta charset="UTF-8"><style>body{font-family:sans-serif;padding:20px}table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid #ccc;padding:7px}th{background:#f5f5f5}</style></head><body>'+
    '<h2>Otto2 '+STORE_NAME[store]+' 薪資 — '+mKey+'</h2>'+
    '<table><thead><tr><th>姓名</th><th>人次獎金</th><th>講師費</th><th>營隊費</th><th>業績績效</th><th>行政績效</th>'+(isFlagship?'<th>支援費</th>':'')+'<th>時薪費</th><th>小計</th><th>全薪</th><th>總薪</th></tr></thead><tbody>'+rows+'</tbody></table>'+
    '<script>window.onload=function(){window.print();window.close()}<\/script></body></html>');
  w.document.close();
}
