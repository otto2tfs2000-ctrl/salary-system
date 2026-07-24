// ── 週期 key 工具：用「該週週一」的 YYYY-MM-DD 當代表 ──────
function invMonday(d) {
  var dt = new Date(d);
  var day = dt.getDay(); // 0=Sun..6=Sat
  var diff = (day === 0 ? -6 : 1) - day; // 移到週一
  dt.setDate(dt.getDate() + diff);
  dt.setHours(0,0,0,0);
  return dt;
}
function invFmtDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}
function invWeekKey(d) { return invFmtDate(invMonday(d)); }
function invWeekLabel(weekKey) {
  var mon = new Date(weekKey + 'T00:00:00');
  var sun = new Date(mon); sun.setDate(mon.getDate()+6);
  var fmt = function(d){ return (d.getMonth()+1)+'/'+d.getDate(); };
  return fmt(mon) + ' ～ ' + fmt(sun);
}

let invCurWeek = invWeekKey(new Date());
var invGroupClosed = {}; // 分類收合狀態
function toggleInvGroup(key) {
  invGroupClosed[key] = !invGroupClosed[key];
  renderInvWeekTable();
}

function invShiftWeek(dir) {
  var d = new Date(invCurWeek + 'T00:00:00');
  d.setDate(d.getDate() + dir*7);
  invCurWeek = invWeekKey(d);
  renderInventory();
}
function invGoToday() {
  invCurWeek = invWeekKey(new Date());
  renderInventory();
}

// ── 資料存取 ────────────────────────────────────────────
function getInvStore() {
  if (!S.inventory) S.inventory = {};
  var store = curStore.inventory;
  if (!S.inventory[store]) S.inventory[store] = { items: [], weeks: {} };
  if (!S.inventory[store].items) S.inventory[store].items = [];
  if (!S.inventory[store].weeks) S.inventory[store].weeks = {};
  if (!S.inventory[store].restocks) S.inventory[store].restocks = {}; // 進貨登記，獨立於 weeks，不影響既有盤點資料
  return S.inventory[store];
}

function getInvItems() {
  return getInvStore().items;
}

// 不依賴目前選的店，直接指定店別取資料（給跨店操作用）
function getInvStoreByName(store) {
  if (!S.inventory) S.inventory = {};
  if (!S.inventory[store]) S.inventory[store] = { items: [], weeks: {} };
  if (!S.inventory[store].items) S.inventory[store].items = [];
  if (!S.inventory[store].weeks) S.inventory[store].weeks = {};
  if (!S.inventory[store].restocks) S.inventory[store].restocks = {};
  return S.inventory[store];
}

// 一次性把「旗艦店」的品項清單複製一份到「國圖店」，方便國圖店開始第一次盤點。
// 只複製類別／名稱／單位／圖片／排序，不複製任何盤點紀錄；
// 安全庫存重設為 0，由國圖店依自己現場狀況填寫，不直接套用旗艦店的數字。
// 國圖店已有同名品項的會自動跳過，重複點擊不會造成重複新增。
function copyFlagshipItemsToGuotu() {
  var src = getInvStoreByName('flagship');
  if (src.items.length === 0) {
    alert('旗艦店目前沒有品項可複製。');
    return;
  }
  var dest = getInvStoreByName('guotu');
  var existNames = dest.items.map(function(it){ return it.name; });

  if (!confirm('確定要把「旗艦店」目前的 ' + src.items.length + ' 個品項清單，複製一份到「國圖店」嗎？\n只會複製類別／名稱／單位／圖片，不會複製盤點紀錄；安全庫存量會重設為 0，請依國圖店現場狀況自行填寫。\n（國圖店已有同名品項的會自動跳過，不會重複新增）')) return;

  var added = 0;
  src.items.forEach(function(it, idx) {
    if (existNames.indexOf(it.name) !== -1) return;
    dest.items.push({
      id: Date.now() + idx,
      cat: it.cat,
      name: it.name,
      unit: it.unit,
      safeStock: 0,
      order: typeof it.order === 'number' ? it.order : idx,
      image: it.image || ''
    });
    added++;
  });

  save();
  if (curStore.inventory === 'guotu') {
    renderInvItemList();
    renderInventory();
  }
  alert(added > 0
    ? '已複製 ' + added + ' 個品項到國圖店。記得切換到國圖店，把每個品項的安全庫存填好，就可以開始第一次盤點了。'
    : '國圖店已經有相同名稱的品項了，沒有新增任何項目。');
}

// 取得某品項在某週的紀錄；若無則回傳 null
function getInvWeekRecord(itemId, weekKey) {
  var st = getInvStore();
  if (!st.weeks[weekKey]) return null;
  return st.weeks[weekKey][itemId] || null;
}

// 取得某品項「最近一筆有實際盤點值」的週（在指定週之前，含指定週）
function getInvLatestStockBefore(itemId, weekKey) {
  var st = getInvStore();
  var keys = Object.keys(st.weeks).filter(function(k){ return k <= weekKey; }).sort();
  for (var i = keys.length - 1; i >= 0; i--) {
    var rec = st.weeks[keys[i]][itemId];
    if (rec && typeof rec.stock === 'number') return { week: keys[i], stock: rec.stock };
  }
  return null;
}

// ── 進貨登記 ────────────────────────────────────────────
// 跟「週盤點」完全分開存放，存在 st.restocks，格式：{ "2026-06-25": [{itemId, qty, note, savedAt}, ...], ... }
// 任何一天到貨都能即時記錄，不用等到下週一盤點才回補，computeCurrentStock 會在算庫存時把它加回去。
function getInvRestockDateKey(d) {
  var dt = (d instanceof Date) ? d : new Date(d + 'T00:00:00');
  return invFmtDate(dt);
}

function addInvRestock(itemId, qty, dateStr, note) {
  if (!qty || qty <= 0) return false;
  var st = getInvStore();
  var dateKey = dateStr || invFmtDate(new Date());
  if (!st.restocks[dateKey]) st.restocks[dateKey] = [];
  st.restocks[dateKey].push({
    itemId: itemId,
    qty: parseFloat(qty),
    note: note || '',
    savedAt: Date.now()
  });
  save();
  return true;
}

function deleteInvRestock(dateKey, idx) {
  var st = getInvStore();
  if (!st.restocks[dateKey]) return;
  st.restocks[dateKey].splice(idx, 1);
  if (st.restocks[dateKey].length === 0) delete st.restocks[dateKey];
  save();
}

// 取得某品項在「某個時間點之後」登記的進貨總量（給「盤點完後又有新到貨」這種情境用）
// toDateKeyExclusive 選填：只算到某個日期之前（不含），沒填就算到現在為止全部
function getInvRestockQtyAfterTimestamp(itemId, sinceTimestamp, toDateKeyExclusive) {
  var st = getInvStore();
  var total = 0;
  Object.keys(st.restocks).forEach(function(dateKey) {
    if (toDateKeyExclusive && dateKey >= toDateKeyExclusive) return;
    st.restocks[dateKey].forEach(function(r) {
      if (String(r.itemId) === String(itemId) && (r.savedAt || 0) > (sinceTimestamp || 0)) total += r.qty;
    });
  });
  return total;
}

// 取得某品項在「某週一」到「下一個週一前一天」這段區間內，總共進貨多少
// rangeStartMonday：含；exclusiveEndMonday：不含（即下一週的週一）
function getInvRestockQtyInRange(itemId, rangeStartMonday, exclusiveEndMonday) {
  var st = getInvStore();
  var total = 0;
  Object.keys(st.restocks).forEach(function(dateKey) {
    if (dateKey < rangeStartMonday || dateKey >= exclusiveEndMonday) return;
    st.restocks[dateKey].forEach(function(r) {
      if (String(r.itemId) === String(itemId)) total += r.qty;
    });
  });
  return total;
}

// 列出某段日期區間內的所有進貨明細（給 UI 顯示用，依日期新到舊排序）
function listInvRestocks(fromDateKey, toDateKey) {
  var st = getInvStore();
  var out = [];
  Object.keys(st.restocks).forEach(function(dateKey) {
    if (fromDateKey && dateKey < fromDateKey) return;
    if (toDateKey && dateKey > toDateKey) return;
    st.restocks[dateKey].forEach(function(r, idx) {
      out.push({ dateKey: dateKey, idx: idx, itemId: r.itemId, qty: r.qty, note: r.note, savedAt: r.savedAt });
    });
  });
  out.sort(function(a,b){ return a.dateKey < b.dateKey ? 1 : (a.dateKey > b.dateKey ? -1 : b.savedAt - a.savedAt); });
  return out;
}

// 計算某品項目前的「庫存量」。
// 統一邏輯：找到「目標週或之前，最近一筆有實際盤點值」當基準（含 savedAt 時間戳記），
// 之後依時間序往前滾算：
//   - 每一週若有填「用掉量」，扣掉；若中途又出現新的盤點實際值，直接校準取代基準。
//   - 同時，任何「在基準 savedAt 之後、且發生時間落在目標週週日之前」的進貨，全部加回去——
//     不分是哪一週、不論該週有沒有填寫盤點資料，只看時間先後，避免重複或漏算。
function computeCurrentStock(itemId, weekKey) {
  var st = getInvStore();
  var targetMonday = new Date(weekKey + 'T00:00:00');
  var targetNextMonday = new Date(targetMonday); targetNextMonday.setDate(targetNextMonday.getDate()+7);
  var targetBoundary = invFmtDate(targetNextMonday); // 目標週週日24:00（=下週一00:00）之前都算

  var rec = getInvWeekRecord(itemId, weekKey);
  if (rec && typeof rec.stock === 'number') {
    // 目標週本身就有盤點實際值：採用該值，再加上盤點完成之後（同一週內）新登記的進貨
    return rec.stock + getInvRestockQtyAfterTimestamp(itemId, rec.savedAt || 0, targetBoundary);
  }

  var anchor = getInvLatestStockBefore(itemId, weekKey);
  if (!anchor) {
    // 從未盤點過，但若已經有進貨登記，至少能呈現「目前累積進貨量」，比完全沒有資料好
    var totalRestock = getInvRestockQtyAfterTimestamp(itemId, 0, targetBoundary);
    return totalRestock > 0 ? totalRestock : null;
  }
  var anchorRec = getInvWeekRecord(itemId, anchor.week);
  var anchorSavedAt = (anchorRec && anchorRec.savedAt) || 0;

  var stock = anchor.stock;
  var cursor = new Date(anchor.week + 'T00:00:00');
  var target = new Date(weekKey + 'T00:00:00');
  cursor.setDate(cursor.getDate() + 7); // 從盤點基準週的下一週開始累減「用掉量」

  // 記錄目前滾算到哪一個時間點了，用來界定「下一段要加回去的進貨」範圍（避免重複計算）
  var lastSavedAt = anchorSavedAt;

  while (cursor <= target) {
    var ck = invWeekKey(cursor);
    var crec = st.weeks[ck] ? st.weeks[ck][itemId] : null;
    if (crec && typeof crec.stock === 'number') {
      stock = crec.stock; // 中途有盤點實際值，重新校準（取代累減，不需再疊加進貨）
      lastSavedAt = crec.savedAt || lastSavedAt;
    } else if (crec && typeof crec.used === 'number') {
      stock = Math.max(0, stock - crec.used);
    }
    cursor.setDate(cursor.getDate() + 7);
  }

  // 把「lastSavedAt 之後、目標週週日之前」登記的所有進貨，一次性加回去——
  // 不論落在哪一週，時間軸上只算一次，不會跟前面任何一段重疊。
  stock += getInvRestockQtyAfterTimestamp(itemId, lastSavedAt, targetBoundary);
  return stock;
}

// 計算品項過去 N 週的平均消耗量。
// 做法：用 computeCurrentStock 算出每一週「週末庫存」，
// 再取相鄰兩週的差值當作該週消耗量（若中途有手動填 used，直接採用該值，更準確）。
// 注意：若某週內有登記「進貨」，這週直接跳過不納入平均，避免進貨量混進消耗速度，
// 導致未來「建議訂購量」被低估或亂跳。
function computeAvgWeeklyUsage(itemId, uptoWeekKey, lookbackWeeks) {
  var st = getInvStore();
  var allWeeks = Object.keys(st.weeks).filter(function(k){ return k <= uptoWeekKey; }).sort();
  if (allWeeks.length === 0) return null;
  var n = lookbackWeeks || 6;
  var recent = allWeeks.slice(-1 * n);

  var usages = [];
  var prevWeekStock = null;
  var prevWeekKeyVal = null;
  recent.forEach(function(wk) {
    var rec = st.weeks[wk][itemId];
    if (!rec) return;
    var prevMon = new Date(wk + 'T00:00:00'); prevMon.setDate(prevMon.getDate()-7);
    var hadRestockThisWeek = getInvRestockQtyInRange(itemId, invFmtDate(prevMon), wk) > 0;
    if (hadRestockThisWeek) {
      // 這週有進貨，消耗量無法單純用差值或 used 推算得乾淨，跳過、但仍更新 prevWeekStock 當下一週的基準
      var sSkip = computeCurrentStock(itemId, wk);
      if (sSkip !== null) { prevWeekStock = sSkip; prevWeekKeyVal = wk; }
      return;
    }
    if (typeof rec.used === 'number' && rec.used >= 0) {
      usages.push(rec.used);
    } else if (prevWeekStock !== null) {
      var stockNow = computeCurrentStock(itemId, wk);
      if (stockNow !== null) {
        var diff = prevWeekStock - stockNow;
        if (diff >= 0) usages.push(diff);
      }
    }
    var sNow = computeCurrentStock(itemId, wk);
    if (sNow !== null) { prevWeekStock = sNow; prevWeekKeyVal = wk; }
  });
  if (usages.length === 0) return null;
  var sum = usages.reduce(function(a,b){ return a+b; }, 0);
  return sum / usages.length;
}

// 統一的品項顯示順序：依 order 欄位排序（小到大），整張表當一條序列，不受分類限制。
// 若品項是舊資料、還沒有 order 欄位，fallback 用「分類順序+id」算一個初始值，避免突然排序錯亂。
function getInvItemOrder(it) {
  if (typeof it.order === 'number') return it.order;
  var ca = INV_CATS.indexOf(it.cat); if (ca === -1) ca = 999;
  return ca * 1e15 + it.id;
}
// 從品項名稱提取前面的數字（例如 "10F畫布" → 10, "20*20方畫布" → 2020）
function extractLeadingNum(name) {
  var m = name.match(/^(\d+)\*?(\d*)/);
  if (!m) return 99999;
  return parseInt(m[1]) * 100 + (m[2] ? parseInt(m[2]) : 0);
}
function sortInvItems(items) {
  return items.slice().sort(function(a, b) {
    return getInvItemOrder(a) - getInvItemOrder(b);
  });
}

// ── 品項管理 ────────────────────────────────────────────
function openInvItemModal() {
  document.getElementById('inv-item-modal').style.display = 'block';
  document.getElementById('inv-modal-store').textContent = {'flagship':'旗艦店','guotu':'國圖店'}[curStore.inventory];
  renderInvItemList();
}
function closeInvItemModal() {
  document.getElementById('inv-item-modal').style.display = 'none';
}

// 重置本店庫存資料：清空品項清單與所有週次盤點記錄。
// 三重確認避免誤觸（這個動作無法復原）。
function resetInvStoreData() {
  var store = curStore.inventory;
  var storeName = {'flagship':'旗艦店','guotu':'國圖店'}[store];
  if (!confirm('⚠️ 警告：這會刪除「' + storeName + '」的【所有品項】和【所有週次盤點記錄】，無法復原！\n\n如果只想清除本週數字，請按「清除本週盤點」。\n\n確定要繼續嗎？')) return;
  var typed = prompt('最後確認：請輸入「' + storeName + '」以執行重置：');
  if (typed !== storeName) {
    if (typed !== null) alert('輸入不符，已取消重置。');
    return;
  }
  S.inventory[store] = { items: [], weeks: {} };
  save();
  closeInvItemModal();
  renderInventory();
  alert(storeName + ' 庫存資料已清空，請重新新增品項。');
}


// ── 一次性套用顏料罐照片（依品項名稱開頭數字對應）──────────
var PAINT_JAR_PHOTOS = {
  1:'images/paint-01.jpg',
  2:'images/paint-02.jpg',
  3:'images/paint-03.jpg',
  4:'images/paint-04.jpg',
  5:'images/paint-05.jpg',
  6:'images/paint-06.jpg',
  7:'images/paint-07.jpg',
  8:'images/paint-08.jpg',
  9:'images/paint-09.jpg',
  10:'images/paint-10.jpg',
  11:'images/paint-11.jpg',
  12:'images/paint-12.jpg',
  13:'images/paint-13.jpg',
  14:'images/paint-14.jpg',
  15:'images/paint-15.jpg',
  16:'images/paint-16.jpg',
  17:'images/paint-17.jpg',
  18:'images/paint-18.jpg',
  19:'images/paint-19.jpg',
  20:'images/paint-20.jpg',
  21:'images/paint-21.jpg',
  22:'images/paint-22.jpg',
  23:'images/paint-23.jpg',
  24:'images/paint-24.jpg',
  25:'images/paint-25.jpg',
  26:'images/paint-26.jpg',
  27:'images/paint-27.jpg',
  28:'images/paint-28.jpg',
  29:'images/paint-29.jpg',
  30:'images/paint-30.jpg',
  31:'images/paint-31.jpg',
  32:'images/paint-32.jpg',
  33:'images/paint-33.jpg',
  34:'images/paint-34.jpg',
  35:'images/paint-35.jpg',
  36:'images/paint-36.jpg',
  37:'images/paint-37.jpg',
  38:'images/paint-38.jpg',
  39:'images/paint-39.jpg',
  40:'images/paint-40.jpg',
  41:'images/paint-41.jpg',
  42:'images/paint-42.jpg',
  43:'images/paint-43.jpg',
  44:'images/paint-44.jpg',
  45:'images/paint-45.jpg',
  46:'images/paint-46.jpg',
  47:'images/paint-47.jpg',
  48:'images/paint-48.jpg',
  49:'images/paint-49.jpg',
  50:'images/paint-50.jpg',
  51:'images/paint-51.jpg',
  52:'images/paint-52.jpg',
  53:'images/paint-53.jpg',
  54:'images/paint-54.jpg'
};
function applyPaintJarPhotos() {
  var st = getInvStore();
  var targets = st.items.filter(function(it){
    if (it.cat !== '顏料') return false;
    var m = it.name.match(/^(\d+)/);
    if (!m) return false;
    return !!PAINT_JAR_PHOTOS[parseInt(m[1])];
  });
  if (targets.length === 0) {
    alert('沒有找到名稱開頭數字對應 1~54 的顏料品項。');
    return;
  }
  if (!confirm('確定要將 ' + targets.length + ' 個顏料品項的圖片，依名稱開頭數字套用對應的顏料罐照片嗎？\n（會覆蓋目前的圖片，無法復原）')) return;
  targets.forEach(function(it){
    var num = parseInt(it.name.match(/^(\d+)/)[1]);
    it.image = PAINT_JAR_PHOTOS[num];
  });
  save();
  renderInvItemList();
  renderInventory();
  alert('已為 ' + targets.length + ' 個顏料品項套用對應的顏料罐照片。');
}

// ── 一次性批次匯入品項（恢復用）──────────────────────
function batchImportItems() {
  var store = curStore.inventory;
  var storeName = {'flagship':'旗艦店','guotu':'國圖店'}[store];
  var st = getInvStore();
  if (st.items.length > 0) {
    if (!confirm(storeName + ' 已有 ' + st.items.length + ' 個品項，確定要再匯入預設清單？（不會刪除現有品項）')) return;
  }
  var batch = [
    // 畫布
    {cat:'畫布',name:'2F畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'3F畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'4F畫布',unit:'張',safeStock:10},
    {cat:'畫布',name:'5F畫布',unit:'張',safeStock:8},
    {cat:'畫布',name:'6F畫布',unit:'張',safeStock:6},
    {cat:'畫布',name:'6P畫布',unit:'張',safeStock:5},
    {cat:'畫布',name:'8F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'8P畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'10F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'10P畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'12F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'15F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'20F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'20P畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'25F畫布',unit:'張',safeStock:3},
    {cat:'畫布',name:'30F畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'30P畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'40F畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'50F畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'20*20方畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'20*20含框畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'30*30圓畫布',unit:'張',safeStock:0},
    {cat:'畫布',name:'40*40圓畫布',unit:'張',safeStock:0},
    // 框木板
    {cat:'框木板',name:'30*30厚框方型',unit:'個',safeStock:0},
    {cat:'框木板',name:'40*40厚框方型',unit:'個',safeStock:0},
    {cat:'框木板',name:'透明框A4',unit:'個',safeStock:3},
    {cat:'框木板',name:'透明框A5',unit:'個',safeStock:3},
    {cat:'框木板',name:'圓鏡(流動鏡)',unit:'個',safeStock:3},
    {cat:'框木板',name:'時鐘(流動鐘)',unit:'個',safeStock:3},
    {cat:'框木板',name:'30*30方木板',unit:'個',safeStock:0},
    {cat:'框木板',name:'40*40方木板',unit:'個',safeStock:0},
    {cat:'框木板',name:'20*20圓木板(厚)',unit:'個',safeStock:0},
    {cat:'框木板',name:'20*20圓木板(薄)',unit:'個',safeStock:0},
    {cat:'框木板',name:'30*30圓木板(薄)',unit:'個',safeStock:0},
    {cat:'框木板',name:'圓托盤',unit:'個',safeStock:3},
    {cat:'框木板',name:'40cm圓鏡子',unit:'個',safeStock:0},
    // 飾品配件
    {cat:'飾品配件',name:'23cm流動熊',unit:'個',safeStock:0},
    {cat:'飾品配件',name:'33cm流動熊',unit:'個',safeStock:0},
    // 顏料
    {cat:'顏料',name:'1號顏料',unit:'罐',safeStock:4,image:'images/paint-01.jpg'},
    {cat:'顏料',name:'2號顏料',unit:'罐',safeStock:1,image:'images/paint-02.jpg'},
    {cat:'顏料',name:'3號顏料',unit:'罐',safeStock:1,image:'images/paint-03.jpg'},
    {cat:'顏料',name:'4號顏料',unit:'罐',safeStock:1,image:'images/paint-04.jpg'},
    {cat:'顏料',name:'5號顏料',unit:'罐',safeStock:1,image:'images/paint-05.jpg'},
    {cat:'顏料',name:'6號顏料',unit:'罐',safeStock:1,image:'images/paint-06.jpg'},
    {cat:'顏料',name:'7號顏料',unit:'罐',safeStock:1,image:'images/paint-07.jpg'},
    {cat:'顏料',name:'8號顏料',unit:'罐',safeStock:1,image:'images/paint-08.jpg'},
    {cat:'顏料',name:'9號顏料',unit:'罐',safeStock:1,image:'images/paint-09.jpg'},
    {cat:'顏料',name:'10號顏料',unit:'罐',safeStock:1,image:'images/paint-10.jpg'},
    {cat:'顏料',name:'11號顏料',unit:'罐',safeStock:1,image:'images/paint-11.jpg'},
    {cat:'顏料',name:'12號顏料',unit:'罐',safeStock:1,image:'images/paint-12.jpg'},
    {cat:'顏料',name:'13號顏料',unit:'罐',safeStock:2,image:'images/paint-13.jpg'},
    {cat:'顏料',name:'14號顏料',unit:'罐',safeStock:1,image:'images/paint-14.jpg'},
    {cat:'顏料',name:'15號顏料',unit:'罐',safeStock:1,image:'images/paint-15.jpg'},
    {cat:'顏料',name:'16號顏料',unit:'罐',safeStock:1,image:'images/paint-16.jpg'},
    {cat:'顏料',name:'17號顏料',unit:'罐',safeStock:1,image:'images/paint-17.jpg'},
    {cat:'顏料',name:'18號顏料',unit:'罐',safeStock:1,image:'images/paint-18.jpg'},
    {cat:'顏料',name:'19號顏料',unit:'罐',safeStock:1,image:'images/paint-19.jpg'},
    {cat:'顏料',name:'20號顏料',unit:'罐',safeStock:1,image:'images/paint-20.jpg'},
    {cat:'顏料',name:'21號顏料',unit:'罐',safeStock:1,image:'images/paint-21.jpg'},
    {cat:'顏料',name:'22號顏料',unit:'罐',safeStock:1,image:'images/paint-22.jpg'},
    {cat:'顏料',name:'23號顏料',unit:'罐',safeStock:1,image:'images/paint-23.jpg'},
    {cat:'顏料',name:'24號顏料',unit:'罐',safeStock:1,image:'images/paint-24.jpg'},
    {cat:'顏料',name:'25號顏料',unit:'罐',safeStock:1,image:'images/paint-25.jpg'},
    {cat:'顏料',name:'26號顏料',unit:'罐',safeStock:1,image:'images/paint-26.jpg'},
    {cat:'顏料',name:'27號顏料',unit:'罐',safeStock:1,image:'images/paint-27.jpg'},
    {cat:'顏料',name:'28號顏料',unit:'罐',safeStock:1,image:'images/paint-28.jpg'},
    {cat:'顏料',name:'29號顏料',unit:'罐',safeStock:1,image:'images/paint-29.jpg'},
    {cat:'顏料',name:'30號顏料',unit:'罐',safeStock:1,image:'images/paint-30.jpg'},
    {cat:'顏料',name:'31號顏料',unit:'罐',safeStock:1,image:'images/paint-31.jpg'},
    {cat:'顏料',name:'32號顏料',unit:'罐',safeStock:1,image:'images/paint-32.jpg'},
    {cat:'顏料',name:'33號顏料',unit:'罐',safeStock:1,image:'images/paint-33.jpg'},
    {cat:'顏料',name:'34號顏料',unit:'罐',safeStock:1,image:'images/paint-34.jpg'},
    {cat:'顏料',name:'35號顏料',unit:'罐',safeStock:1,image:'images/paint-35.jpg'},
    {cat:'顏料',name:'36號顏料',unit:'罐',safeStock:1,image:'images/paint-36.jpg'},
    {cat:'顏料',name:'37號顏料',unit:'罐',safeStock:1,image:'images/paint-37.jpg'},
    {cat:'顏料',name:'38號顏料',unit:'罐',safeStock:1,image:'images/paint-38.jpg'},
    {cat:'顏料',name:'39號顏料',unit:'罐',safeStock:1,image:'images/paint-39.jpg'},
    {cat:'顏料',name:'40號顏料',unit:'罐',safeStock:2,image:'images/paint-40.jpg'},
    {cat:'顏料',name:'41號顏料',unit:'罐',safeStock:1,image:'images/paint-41.jpg'},
    {cat:'顏料',name:'42號顏料',unit:'罐',safeStock:1,image:'images/paint-42.jpg'},
    {cat:'顏料',name:'43號顏料',unit:'罐',safeStock:1,image:'images/paint-43.jpg'},
    {cat:'顏料',name:'44號顏料',unit:'罐',safeStock:1,image:'images/paint-44.jpg'},
    {cat:'顏料',name:'45號顏料',unit:'罐',safeStock:1,image:'images/paint-45.jpg'},
    {cat:'顏料',name:'46號顏料',unit:'罐',safeStock:1,image:'images/paint-46.jpg'},
    {cat:'顏料',name:'47號顏料',unit:'罐',safeStock:1,image:'images/paint-47.jpg'},
    {cat:'顏料',name:'48號顏料',unit:'罐',safeStock:1,image:'images/paint-48.jpg'},
    {cat:'顏料',name:'49號顏料',unit:'罐',safeStock:1,image:'images/paint-49.jpg'},
    {cat:'顏料',name:'50號顏料',unit:'罐',safeStock:1,image:'images/paint-50.jpg'},
    {cat:'顏料',name:'51號顏料',unit:'罐',safeStock:1,image:'images/paint-51.jpg'},
    {cat:'顏料',name:'52號顏料',unit:'罐',safeStock:1,image:'images/paint-52.jpg'},
    {cat:'顏料',name:'53號顏料',unit:'罐',safeStock:1,image:'images/paint-53.jpg'},
    {cat:'顏料',name:'54號顏料',unit:'罐',safeStock:1,image:'images/paint-54.jpg'}
  ];
  var added = 0;
  var existNames = st.items.map(function(it){ return it.name; });
  batch.forEach(function(b, idx) {
    if (existNames.indexOf(b.name) !== -1) return; // 跳過已存在
    st.items.push({ id: Date.now() + idx, cat: b.cat, name: b.name, unit: b.unit, safeStock: b.safeStock, order: idx });
    added++;
  });
  save();
  renderInvItemList();
  renderInventory();
  alert('已匯入 ' + added + ' 個品項到「' + storeName + '」');
}

// ── 品項圖片 ──────────────────────────────────────────
function uploadInvImage(itemId, input) {
  if (!input.files || !input.files[0]) return;
  var file = input.files[0];
  if (file.size > 5 * 1024 * 1024) { alert('圖片太大，請選擇 5MB 以下的檔案'); return; }
  var reader = new FileReader();
  reader.onload = function(e) {
    // 壓縮圖片
    var img = new Image();
    img.onload = function() {
      var canvas = document.createElement('canvas');
      var maxW = 400, maxH = 400;
      var w = img.width, h = img.height;
      if (w > maxW || h > maxH) {
        var ratio = Math.min(maxW / w, maxH / h);
        w = Math.round(w * ratio); h = Math.round(h * ratio);
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      var compressed = canvas.toDataURL('image/jpeg', 0.7);
      updateInvItemField(itemId, 'image', compressed);
      renderInvItemList();
      renderInventory();
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
}
function removeInvImage(itemId) {
  updateInvItemField(itemId, 'image', '');
  renderInvItemList();
  renderInventory();
}
function showInvImage(itemId) {
  var items = getInvItems();
  var it = items.find(function(x){ return x.id === itemId; });
  if (!it || !it.image) return;
  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;cursor:pointer';
  overlay.onclick = function(){ document.body.removeChild(overlay); };
  var title = document.createElement('div');
  title.style.cssText = 'color:var(--gold);font-size:16px;font-weight:600';
  title.textContent = it.name;
  var img = document.createElement('img');
  img.src = it.image;
  img.style.cssText = 'max-width:90vw;max-height:80vh;border-radius:8px;border:2px solid var(--gold)';
  var hint = document.createElement('div');
  hint.style.cssText = 'color:var(--text3);font-size:12px';
  hint.textContent = '點擊任意處關閉';
  overlay.appendChild(title);
  overlay.appendChild(img);
  overlay.appendChild(hint);
  document.body.appendChild(overlay);
}

function addInvItem() {
  var cat = document.getElementById('inv-new-cat').value;
  var name = document.getElementById('inv-new-name').value.trim();
  var unit = document.getElementById('inv-new-unit').value.trim() || '個';
  var safe = parseFloat(document.getElementById('inv-new-safe').value) || 0;
  if (!name) { alert('請填入品項名稱'); return; }
  var st = getInvStore();
  // 重複偵測
  var dup = st.items.find(function(it){ return it.name === name; });
  if (dup) {
    alert('⚠️ 品項「' + name + '」已經存在（類別：' + dup.cat + '），請勿重複登入！');
    return;
  }
  var sorted = sortInvItems(st.items);

  // 智慧插入：找到名稱最相近的品項，放在它後面
  var smartIdx = findSmartInsertPosition(name, cat, sorted);
  var newOrder;
  if (smartIdx >= 0 && sorted.length > 0) {
    var nearItem = sorted[smartIdx];
    var nearOrder = getInvItemOrder(nearItem);
    // 放在相近品項後面
    var nextOrder = (smartIdx + 1 < sorted.length) ? getInvItemOrder(sorted[smartIdx + 1]) : nearOrder + 2;
    newOrder = nearOrder + (nextOrder - nearOrder) / 2;
  } else {
    var maxOrder = st.items.reduce(function(m, it){ return Math.max(m, getInvItemOrder(it)); }, -1);
    newOrder = maxOrder + 1;
  }
  st.items.push({ id: Date.now(), cat: cat, name: name, unit: unit, safeStock: safe, order: newOrder });
  save();
  document.getElementById('inv-new-name').value = '';
  document.getElementById('inv-new-safe').value = '';
  renderInvItemList();
  renderInventory();
}

// 拖拉排序完成後呼叫：傳入拖放後「完整、依序排列」的 id 陣列，
// 重新分配連續的 order 值（0,1,2...），整張表當一條序列、不受分類限制。
function reorderInvItems(orderedIds) {
  var st = getInvStore();
  var byId = {};
  st.items.forEach(function(it){ byId[it.id] = it; });
  orderedIds.forEach(function(id, idx) {
    if (byId[id]) byId[id].order = idx;
  });
  save();
  renderInvItemList();
  renderInventory();
}

// 品項排序上移/下移：跟序列中相鄰的品項互換 order 值，整張表當一條序列、不受分類限制。
function moveInvItem(id, dir) {
  var st = getInvStore();
  var sorted = sortInvItems(st.items);
  var idx = sorted.findIndex(function(x){ return x.id === id; });
  if (idx === -1) return;
  var targetIdx = idx + dir;
  if (targetIdx < 0 || targetIdx >= sorted.length) return; // 已經在頂端/底端

  var cur = sorted[idx];
  var target = sorted[targetIdx];
  var curOrder = getInvItemOrder(cur);
  var targetOrder = getInvItemOrder(target);

  // 確保兩者都有明確的 order 欄位（避免 fallback 值重複造成排序不穩定）
  cur.order = targetOrder;
  target.order = curOrder;
  save();
  renderInvItemList();
  renderInventory();
}

function delInvItem(id) {
  if (!confirm('刪除這個品項？歷史盤點紀錄會保留但不再顯示。')) return;
  var st = getInvStore();
  st.items = st.items.filter(function(x){ return x.id !== id; });
  save();
  renderInvItemList();
  renderInventory();
}

function updateInvItemField(id, field, value) {
  var st = getInvStore();
  var item = st.items.find(function(x){ return x.id === id; });
  if (!item) return;
  if (field === 'safeStock') item[field] = parseFloat(value) || 0;
  else if (field === 'estUsage') item[field] = value === '' ? null : (parseFloat(value) || 0);
  else item[field] = value;
  save();
  renderInventory();
}

let invDragId = null;

function invHandleDragStart(e, id) {
  invDragId = id;
  e.dataTransfer.effectAllowed = 'move';
  // 拖曳時讓整列半透明，視覺回饋
  e.currentTarget.style.opacity = '0.4';
}
function invHandleDragEnd(e) {
  e.currentTarget.style.opacity = '1';
  document.querySelectorAll('#inv-item-list tr.drag-over').forEach(function(tr){ tr.classList.remove('drag-over'); });
  invDragId = null;
}
function invHandleDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  var tr = e.currentTarget;
  document.querySelectorAll('#inv-item-list tr.drag-over').forEach(function(x){ if (x!==tr) x.classList.remove('drag-over'); });
  tr.classList.add('drag-over');
}
function invHandleDrop(e, targetId) {
  e.preventDefault();
  e.currentTarget.classList.remove('drag-over');
  if (invDragId === null || invDragId === targetId) return;

  var items = getInvItems();
  var sorted = sortInvItems(items);
  var ids = sorted.map(function(it){ return it.id; });

  var fromIdx = ids.indexOf(invDragId);
  var toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  ids.splice(fromIdx, 1);
  var insertAt = ids.indexOf(targetId);
  ids.splice(insertAt, 0, invDragId);

  reorderInvItems(ids);
}

// ── 觸控拖移支援（手機用）──────────────────────────────
var touchDragEl = null, touchDragId = null, touchClone = null, touchStartY = 0;
function initTouchDrag(container) {
  if (!container) return;
  container.addEventListener('touchstart', function(e) {
    var tr = e.target.closest('tr[draggable]');
    if (!tr) return;
    touchDragId = parseInt(tr.dataset.invId);
    if (!touchDragId) return;
    touchDragEl = tr;
    touchStartY = e.touches[0].clientY;
    touchClone = tr.cloneNode(true);
    touchClone.style.cssText = 'position:fixed;z-index:999;opacity:0.85;pointer-events:none;background:var(--bg2);border:1px solid var(--gold);width:'+tr.offsetWidth+'px;left:'+tr.getBoundingClientRect().left+'px;top:'+tr.getBoundingClientRect().top+'px';
    document.body.appendChild(touchClone);
    tr.style.opacity = '0.3';
  }, {passive:true});
  container.addEventListener('touchmove', function(e) {
    if (!touchClone) return;
    e.preventDefault();
    var y = e.touches[0].clientY;
    touchClone.style.top = (y - 20) + 'px';
    var rows = container.querySelectorAll('tr[draggable]');
    rows.forEach(function(r){ r.classList.remove('drag-over'); });
    var target = document.elementFromPoint(e.touches[0].clientX, y);
    if (target) { var tr = target.closest('tr[draggable]'); if (tr && tr !== touchDragEl) tr.classList.add('drag-over'); }
  }, {passive:false});
  container.addEventListener('touchend', function(e) {
    if (!touchClone) return;
    if (touchClone.parentNode) touchClone.parentNode.removeChild(touchClone);
    if (touchDragEl) touchDragEl.style.opacity = '1';
    var rows = container.querySelectorAll('tr[draggable]');
    var targetId = null;
    rows.forEach(function(r){ if (r.classList.contains('drag-over')) { targetId = parseInt(r.dataset.invId); r.classList.remove('drag-over'); } });
    if (targetId && touchDragId && targetId !== touchDragId) {
      var items = getInvItems();
      var sorted = sortInvItems(items);
      var ids = sorted.map(function(it){ return it.id; });
      var fromIdx = ids.indexOf(touchDragId);
      var toIdx = ids.indexOf(targetId);
      if (fromIdx !== -1 && toIdx !== -1) { ids.splice(fromIdx, 1); ids.splice(ids.indexOf(targetId), 0, touchDragId); reorderInvItems(ids); }
    }
    touchDragEl = null; touchDragId = null; touchClone = null;
  }, {passive:true});
}

// ── 智慧插入：新品項自動找到名稱最接近的品項，放在它旁邊 ──
function findSmartInsertPosition(newName, newCat, sortedItems) {
  if (sortedItems.length === 0) return -1;
  // 把名稱拆成字元，計算相似度
  function similarity(a, b) {
    a = a.toLowerCase(); b = b.toLowerCase();
    // 共同字元數 + 類別相同加分
    var common = 0;
    var shorter = a.length < b.length ? a : b;
    var longer = a.length < b.length ? b : a;
    for (var i = 0; i < shorter.length; i++) {
      if (longer.indexOf(shorter[i]) !== -1) common++;
    }
    // 前綴匹配額外加分（例如 6P畫布 vs 6F畫布，前面的數字一樣）
    var prefixMatch = 0;
    for (var j = 0; j < Math.min(a.length, b.length); j++) {
      if (a[j] === b[j]) prefixMatch++; else break;
    }
    return common + prefixMatch * 2;
  }
  var bestIdx = -1, bestScore = 0;
  sortedItems.forEach(function(it, idx) {
    var catBonus = (it.cat === newCat) ? 5 : 0;
    var score = similarity(newName, it.name) + catBonus;
    if (score > bestScore) { bestScore = score; bestIdx = idx; }
  });
  return bestIdx;
}

function renderInvItemList() {
  var el = document.getElementById('inv-item-list');
  var items = getInvItems();
  if (items.length === 0) { el.innerHTML = '<div class="empty">尚無品項，請於上方新增</div>'; return; }
  var sorted = sortInvItems(items);
  var html = '<div class="muted" style="margin-bottom:8px;font-size:12px">🖐 直接按住每一列左側的「⠿」拖曳，可任意調整順序（不限分類）</div>';
  html += '<table><thead><tr><th style="width:36px"></th><th>類別</th><th>品項名稱</th><th>圖片</th><th>單位</th><th>安全庫存量</th><th>預估週消耗</th><th></th></tr></thead><tbody id="inv-item-tbody">';
  sorted.forEach(function(it) {
    html += '<tr draggable="true" data-inv-id="'+it.id+'" '+
      'ondragstart="invHandleDragStart(event,'+it.id+')" '+
      'ondragend="invHandleDragEnd(event)" '+
      'ondragover="invHandleDragOver(event)" '+
      'ondrop="invHandleDrop(event,'+it.id+')" '+
      'style="cursor:grab">';
    html += '<td style="text-align:center;color:var(--text2);font-size:16px;user-select:none">⠿</td>';
    var catSel = '<select style="background:var(--bg3);border:1px solid var(--border);color:var(--gold2);padding:3px 6px;border-radius:5px;font-size:12px;cursor:pointer;outline:none;font-family:inherit" onchange="updateInvItemField('+it.id+',\'cat\',this.value)">';
    INV_CATS.forEach(function(c){
      catSel += '<option value="'+c+'"'+(it.cat===c?' selected':'')+'>'+(INV_CAT_ICONS[c]||'📌')+' '+c+'</option>';
    });
    catSel += '</select>';
    html += '<td>'+catSel+'</td>';
    html += '<td><input class="in-num" style="width:100%;text-align:left" value="'+it.name.replace(/"/g,'&quot;')+'" onchange="updateInvItemField('+it.id+',\'name\',this.value)"></td>';
    // 圖片欄
    var imgHtml = '<label style="cursor:pointer;display:inline-flex;align-items:center;gap:4px">';
    if (it.image) {
      imgHtml += '<img src="'+it.image+'" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--border)" onclick="event.preventDefault();showInvImage('+it.id+')">';
      imgHtml += '<input type="file" accept="image/*" style="display:none" onchange="uploadInvImage('+it.id+',this)">';
      imgHtml += '</label>';
      imgHtml += ' <button class="btn-sm" style="font-size:10px;padding:2px 6px;background:transparent;border:1px solid rgba(224,85,85,0.3);color:var(--red)" onclick="removeInvImage('+it.id+')">✕</button>';
    } else {
      imgHtml += '<span style="font-size:18px">📷</span>';
      imgHtml += '<input type="file" accept="image/*" style="display:none" onchange="uploadInvImage('+it.id+',this)">';
      imgHtml += '</label>';
    }
    html += '<td>'+imgHtml+'</td>';
    html += '<td><input class="in-num" style="width:60px" value="'+it.unit+'" onchange="updateInvItemField('+it.id+',\'unit\',this.value)"></td>';
    html += '<td><input class="in-num" type="number" min="0" style="width:70px" value="'+it.safeStock+'" onwheel="this.blur()" onchange="updateInvItemField('+it.id+',\'safeStock\',this.value)"></td>';
    html += '<td><input class="in-num" type="number" min="0" step="any" style="width:70px" placeholder="選填" value="'+(it.estUsage != null && it.estUsage !== '' ? it.estUsage : '')+'" onwheel="this.blur()" onchange="updateInvItemField('+it.id+',\'estUsage\',this.value)" title="還沒累積夠盤點資料前，先用這個數字算建議訂購量；累積滿 '+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+' 週實際資料後自動改用真實消耗速度"></td>';
    html += '<td><button class="btn-del btn-sm" onclick="delInvItem('+it.id+')">刪除</button></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
  // 初始化觸控拖移
  var itemTbody = document.getElementById('inv-item-tbody');
  if (itemTbody) initTouchDrag(itemTbody);
}

// ── 建議訂購量 ──────────────────────────────────────────
// 邏輯：訂完之後庫存要能撐過「安全庫存」+「未來4週預估消耗」。
// 未來4週預估消耗 = 近6週平均週消耗 × 4。
// 若消耗資料不足（從未盤點過消耗速度），則只補到安全庫存，並標註資料不足。
const INV_LOOKAHEAD_WEEKS = 4;
const INV_MIN_USAGE_SAMPLES_FOR_FORECAST = 4;

function computeWeeklyUsageStats(itemId, uptoWeekKey, lookbackWeeks) {
  var st = getInvStore();
  var allWeeks = Object.keys(st.weeks).filter(function(k){ return k <= uptoWeekKey; }).sort();
  if (allWeeks.length === 0) return { avg: null, samples: 0, values: [] };
  var n = lookbackWeeks || 6;
  var recent = allWeeks.slice(-1 * n);

  var usages = [];
  var prevWeekStock = null;
  recent.forEach(function(wk) {
    var rec = st.weeks[wk][itemId];
    if (!rec) return;
    var prevMon = new Date(wk + 'T00:00:00'); prevMon.setDate(prevMon.getDate()-7);
    var hadRestockThisWeek = getInvRestockQtyInRange(itemId, invFmtDate(prevMon), wk) > 0;
    if (hadRestockThisWeek) {
      var sSkip = computeCurrentStock(itemId, wk);
      if (sSkip !== null) prevWeekStock = sSkip;
      return;
    }
    if (typeof rec.used === 'number' && rec.used >= 0) {
      usages.push(rec.used);
    } else if (prevWeekStock !== null) {
      var stockNow = computeCurrentStock(itemId, wk);
      if (stockNow !== null) {
        var diff = prevWeekStock - stockNow;
        if (diff >= 0) usages.push(diff);
      }
    }
    var sNow = computeCurrentStock(itemId, wk);
    if (sNow !== null) prevWeekStock = sNow;
  });
  if (usages.length === 0) return { avg: null, samples: 0, values: [] };
  var sum = usages.reduce(function(a,b){ return a+b; }, 0);
  return { avg: sum / usages.length, samples: usages.length, values: usages };
}

function computeInvRestockStats(itemId, uptoWeekKey) {
  var end = new Date(uptoWeekKey + 'T00:00:00');
  end.setDate(end.getDate() + 7);
  var start = new Date(end);
  start.setDate(start.getDate() - 90);
  var fromKey = invFmtDate(start);
  var toKey = invFmtDate(end);
  var rows = listInvRestocks(fromKey, toKey).filter(function(r){ return String(r.itemId) === String(itemId); });
  var qtys = rows.map(function(r){ return r.qty; }).filter(function(q){ return q > 0; });
  if (qtys.length === 0) return { count90: 0, avgQty: null, monthlyCalls: 0 };
  var total = qtys.reduce(function(a,b){ return a+b; }, 0);
  return { count90: qtys.length, avgQty: total / qtys.length, monthlyCalls: qtys.length / 3 };
}

function computeOrderQty(itemId, weekKey, safeStock) {
  var curStock = computeCurrentStock(itemId, weekKey);
  var usageStats = computeWeeklyUsageStats(itemId, weekKey, 6);
  var avgUsage = usageStats.avg;
  var restockStats = computeInvRestockStats(itemId, weekKey);

  // 人工預估週消耗：實際盤點資料還沒累積夠之前的過渡值。
  // 累積滿 INV_MIN_USAGE_SAMPLES_FOR_FORECAST 週真實資料後，這個值自動退場，改用真實消耗速度。
  var itemRec = getInvItems().find(function(x){ return String(x.id) === String(itemId); });
  var estUsage = (itemRec && itemRec.estUsage != null && parseFloat(itemRec.estUsage) > 0) ? parseFloat(itemRec.estUsage) : null;
  var restockCycleWeeks = (itemRec && parseFloat(itemRec.restockCycleWeeks) > 0) ? parseFloat(itemRec.restockCycleWeeks) : null;

  if (curStock === null) {
    // 從未盤點過，無法判斷，不建議數字
    return { qty: null, basis: 'none', curStock: null };
  }
  if (restockCycleWeeks) {
    // 例如畫布：兩週訂一次，目標就是維持兩週庫存量，不再額外疊加 4 週預估。
    var cycleUsage = (usageStats.samples >= INV_MIN_USAGE_SAMPLES_FOR_FORECAST && avgUsage && avgUsage > 0) ? avgUsage : estUsage;
    var cycleTarget = cycleUsage ? (cycleUsage * restockCycleWeeks) : safeStock;
    var cycleQty = Math.max(0, Math.ceil(cycleTarget - curStock));
    return {
      qty: cycleQty,
      basis: cycleUsage ? (usageStats.samples >= INV_MIN_USAGE_SAMPLES_FOR_FORECAST ? 'forecast' : 'estimate') : 'safe-only',
      avgUsage: cycleUsage,
      samples: usageStats.samples,
      curStock: curStock,
      restockStats: restockStats
    };
  }
  if (usageStats.samples < INV_MIN_USAGE_SAMPLES_FOR_FORECAST && estUsage) {
    // 資料不足但老闆有填預估週消耗 → 先照預估值算，邏輯跟正式預測一樣
    var targetE = safeStock + estUsage * INV_LOOKAHEAD_WEEKS;
    var qtyE = Math.max(0, Math.ceil(targetE - curStock));
    return { qty: qtyE, basis: 'estimate', avgUsage: estUsage, samples: usageStats.samples, curStock: curStock, restockStats: restockStats };
  }
  if (usageStats.samples > 0 && usageStats.samples < INV_MIN_USAGE_SAMPLES_FOR_FORECAST) {
    var qtyLearn = Math.max(0, safeStock - curStock);
    return { qty: qtyLearn, basis: 'learning', avgUsage: avgUsage, samples: usageStats.samples, curStock: curStock, restockStats: restockStats };
  }
  if (!avgUsage || avgUsage <= 0) {
    // 沒有消耗速度資料，只補到安全庫存
    var qtySafe = Math.max(0, safeStock - curStock);
    return { qty: qtySafe, basis: 'safe-only', curStock: curStock, samples: usageStats.samples, restockStats: restockStats };
  }
  var target = safeStock + avgUsage * INV_LOOKAHEAD_WEEKS;
  var qty = Math.max(0, Math.ceil(target - curStock));
  return { qty: qty, basis: 'forecast', avgUsage: avgUsage, samples: usageStats.samples, curStock: curStock, restockStats: restockStats };
}

// ── 本週盤點表 ──────────────────────────────────────────
function renderInvWeekTable() {
  var items = getInvItems();
  var weekKey = invCurWeek;
  document.getElementById('inv-week-label').textContent = invWeekLabel(weekKey);
  var el = document.getElementById('inv-week-table');
  if (items.length === 0) {
    el.innerHTML = '<div class="empty">尚無品項，請先點「管理品項清單」新增</div>';
    return;
  }
  // 四大分類群組
  var INV_GROUPS = [
    { key: 'canvas', label: '🖼 畫布', cats: ['畫布'] },
    { key: 'board', label: '🪞 木板／玻璃', cats: ['框木板'] },
    { key: 'paint', label: '🎨 顏料', cats: ['顏料'] },
    { key: 'parts', label: '⚙️ 配件', cats: ['飾品配件'] },
    { key: 'gel', label: '💎 膠體', cats: ['樹脂','溶劑'] },
    { key: 'other', label: '📌 其他', cats: ['紙張','筆刷','包裝','清潔','印刷','其他'] }
  ];
  var sorted = sortInvItems(items);
  var html = '';

  INV_GROUPS.forEach(function(grp) {
    var grpItems = sorted.filter(function(it){ return grp.cats.indexOf(it.cat) !== -1; });
    if (grpItems.length === 0) return;

    // 群組展開狀態（預設展開）
    var isOpen = !invGroupClosed[grp.key];
    var arrow = isOpen ? '▼' : '▶';

    html += '<div style="margin-bottom:12px">';
    html += '<div onclick="toggleInvGroup(\''+grp.key+'\')" style="cursor:pointer;padding:10px 14px;background:rgba(201,168,76,0.08);border:1px solid rgba(201,168,76,0.2);border-radius:8px;display:flex;align-items:center;gap:10px;user-select:none">';
    html += '<span style="font-size:13px;color:var(--gold2)">'+arrow+'</span>';
    html += '<span style="font-size:15px;font-weight:600;color:var(--gold)">'+grp.label+'</span>';
    html += '<span style="font-size:12px;color:var(--text3);margin-left:4px">('+grpItems.length+' 項)</span>';
    html += '</div>';

    if (isOpen) {
      html += '<table style="table-layout:fixed;width:100%;margin-top:4px"><thead><tr>';
      html += '<th style="width:18%">品項</th><th style="width:44px">圖片</th><th style="width:50px">單位</th><th style="width:70px">安全庫存</th><th style="width:70px">上週結餘</th><th style="width:100px">本週用掉</th><th style="width:120px">本週盤點實際庫存</th><th>本週建議訂購量</th>';
      html += '</tr></thead><tbody>';

      grpItems.forEach(function(it) {
        var rec = getInvWeekRecord(it.id, weekKey) || {};
        var prevMonday = new Date(weekKey + 'T00:00:00'); prevMonday.setDate(prevMonday.getDate()-7);
        var prevKey = invWeekKey(prevMonday);
        var prevStockObj = getInvLatestStockBefore(it.id, prevKey);
        var prevStock = prevStockObj ? prevStockObj.stock : null;

        var order = computeOrderQty(it.id, weekKey, it.safeStock);
        var orderHtml = buildOrderStatusHtml(order, it);

        html += '<tr>';
        var imgInline = it.image ? '<img src="'+it.image+'" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:pointer" onclick="showInvImage('+it.id+')">' : '<span class="muted">—</span>';
        html += '<td>'+it.name+'</td>';
        html += '<td style="text-align:center">'+imgInline+'</td>';
        html += '<td class="muted">'+it.unit+'</td>';
        html += '<td class="muted">'+it.safeStock+'</td>';
        html += '<td class="muted">'+(prevStock !== null ? prevStock : '—')+'</td>';
        html += '<td><input class="in-num" type="number" min="0" id="inv-used-'+it.id+'" value="'+(typeof rec.used==='number'?rec.used:'')+'" onwheel="this.blur()" onchange="autoSaveInvItem('+it.id+')"></td>';
        html += '<td><input class="in-num" type="number" min="0" id="inv-stock-'+it.id+'" value="'+(typeof rec.stock==='number'?rec.stock:'')+'" onwheel="this.blur()" onchange="autoSaveInvItem('+it.id+')"></td>';
        html += '<td id="inv-status-'+it.id+'">'+orderHtml+'</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
    html += '</div>';
  });

  el.innerHTML = html;
}

// ── 清除本週盤點資料（只清數字，品項不動）──────────────
function clearInvWeek() {
  var weekKey = invCurWeek;
  var label = invWeekLabel(weekKey);
  if (!confirm('確定要清除「' + label + '」填入的用量和實際庫存數字？\n（品項清單不受影響）')) return;
  var st = getInvStore();
  if (st.weeks[weekKey]) {
    // 只清除每個品項的 used 和 stock，保留其他結構
    delete st.weeks[weekKey];
  }
  save();
  renderInventory();
  alert(label + ' 的盤點數字已歸零，品項清單不受影響。');
}

// ── 單品項自動儲存（填完即存）──────────────────────────
// 統一產生「本週建議訂購量」徽章：紅(要訂)/黃(注意)/綠(無需訂購)/灰(尚未盤點)
// renderInvWeekTable、autoSaveInvItem、renderInvStats 都呼叫這個，避免三色邏輯散落各處。
function buildOrderStatusHtml(order, it) {
  if (order.basis !== 'safe-only' && order.basis !== 'forecast' && order.basis !== 'learning' && order.basis !== 'estimate') {
    return '<span class="muted">尚未盤點</span>';
  }
  if (order.qty > 0) {
    var usageNote = order.basis === 'forecast' ? ' <span class="muted">(週耗≈'+order.avgUsage.toFixed(1)+')</span>' : '';
    if (order.basis === 'estimate') usageNote = ' <span class="muted">(人工預估週耗 '+order.avgUsage+')</span>';
    if (order.basis === 'learning') usageNote = ' <span class="muted">(累積中 '+order.samples+'/'+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+')</span>';
    return '<span class="badge" style="background:rgba(224,85,85,0.15);color:var(--red);border:1px solid rgba(224,85,85,0.3)">訂 '+order.qty+' '+it.unit+'</span>'+usageNote;
  }
  if (order.basis === 'learning') {
    return '<span class="badge b-gray">先累積資料</span> <span class="muted">('+order.samples+'/'+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+')</span>';
  }
  var cautionLine = getInvCautionLine(it.safeStock);
  if (order.curStock !== null && order.curStock > it.safeStock && order.curStock <= cautionLine) {
    return '<span class="badge" style="background:rgba(224,158,77,0.15);color:#e09e4d;border:1px solid rgba(224,158,77,0.35)">⚠ 注意（注意線 '+cautionLine+' '+it.unit+'）</span>';
  }
  return '<span class="badge b-green">✓ 無需訂購</span>';
}

function autoSaveInvItem(itemId) {
  var weekKey = invCurWeek;
  var st = getInvStore();
  if (!st.weeks[weekKey]) st.weeks[weekKey] = {};
  var usedEl = document.getElementById('inv-used-'+itemId);
  var stockEl = document.getElementById('inv-stock-'+itemId);
  var used = usedEl && usedEl.value !== '' ? parseFloat(usedEl.value) : null;
  var stock = stockEl && stockEl.value !== '' ? parseFloat(stockEl.value) : null;
  if (used === null && stock === null) {
    // 兩欄都清空時刪除該筆記錄
    delete st.weeks[weekKey][itemId];
  } else {
    st.weeks[weekKey][itemId] = { used: used, stock: stock, savedAt: Date.now() };
  }
  save();
  // 即時更新建議訂購量
  var items = getInvItems();
  var it = items.find(function(x){ return x.id === itemId; });
  if (it) {
    var order = computeOrderQty(itemId, weekKey, it.safeStock);
    var statusEl = document.getElementById('inv-status-'+itemId);
    if (statusEl) {
      statusEl.innerHTML = buildOrderStatusHtml(order, it);
    }
  }
  // 提示已存
  var hint = document.getElementById('inv-save-hint');
  if (hint) { hint.textContent = '✓ 已自動儲存'; hint.style.color = 'var(--green)'; setTimeout(function(){ hint.textContent = ''; }, 2000); }
}

function saveInvWeek() {
  var items = getInvItems();
  var weekKey = invCurWeek;
  var st = getInvStore();
  if (!st.weeks[weekKey]) st.weeks[weekKey] = {};
  var savedCount = 0;
  items.forEach(function(it) {
    var usedEl = document.getElementById('inv-used-'+it.id);
    var stockEl = document.getElementById('inv-stock-'+it.id);
    var used = usedEl && usedEl.value !== '' ? parseFloat(usedEl.value) : null;
    var stock = stockEl && stockEl.value !== '' ? parseFloat(stockEl.value) : null;
    if (used === null && stock === null) return;
    st.weeks[weekKey][it.id] = {
      used: used,
      stock: stock,
      savedAt: Date.now()
    };
    savedCount++;
  });
  save();
  renderInventory();
  alert('已儲存 ' + savedCount + ' 筆本週盤點紀錄');
}

var invCountOCRRows = [];

function printInvBlankSheet() {
  var items = sortInvItems(getInvItems());
  if (items.length === 0) { alert('尚無品項，請先新增品項。'); return; }
  var storeName = {'flagship':'旗艦店','guotu':'國圖店'}[curStore.inventory];
  var weekKey = invCurWeek;

  var ROWS = 24;              // 每一欄的列數
  var PER_PAGE = ROWS * 2;    // 一張 A4 兩大欄

  function row(it, no) {
    if (!it) return '<tr><td class="no"></td><td class="cat"></td><td class="nm"></td><td class="un"></td><td></td></tr>';
    return '<tr><td class="no">'+no+'</td><td class="cat">'+escAttr(it.cat)+'</td>'+
           '<td class="nm">'+escAttr(it.name)+'</td><td class="un">'+escAttr(it.unit)+'</td><td></td></tr>';
  }

  function block(list, startNo, pad) {
    var body = '';
    for (var i = 0; i < list.length; i++) body += row(list[i], startNo + i);
    for (var j = 0; j < pad; j++) body += row(null, '');
    return '<table><colgroup><col class="c1"><col class="c2"><col class="c3"><col class="c4"><col class="c5"></colgroup>'+
      '<thead><tr><th>編號</th><th>類別</th><th>品項</th><th>單位</th><th>實際庫存</th></tr></thead>'+
      '<tbody>'+body+'</tbody></table>';
  }

  var pagesHtml = '';
  for (var p = 0; p * PER_PAGE < items.length; p++) {
    var chunk = items.slice(p * PER_PAGE, (p + 1) * PER_PAGE);
    var half = Math.min(ROWS, Math.ceil(chunk.length / 2));
    var left = chunk.slice(0, half);
    var right = chunk.slice(half);
    var isLast = (p + 1) * PER_PAGE >= items.length;
    var padL = isLast ? 0 : ROWS - left.length;
    var padR = isLast ? 2 : ROWS - right.length;   // 最後一頁多留 2 列給臨時品項
    var base = p * PER_PAGE;
    pagesHtml += '<div class="sheet">'+
      '<div class="head"><h1>Otto2 ARTCLUB '+storeName+' 庫存盤點</h1>'+
      '<div class="meta">週次 '+invWeekLabel(weekKey)+'　盤點人 ＿＿＿＿＿　日期 ＿＿＿＿＿'+
      (p > 0 ? '　（第 '+(p+1)+' 頁）' : '')+'</div></div>'+
      '<div class="cols">'+block(left, base + 1, padL)+block(right, base + left.length + 1, padR)+'</div>'+
      '</div>';
  }

  var css = '@page{size:A4 portrait;margin:11mm 9mm}'+
    '*{box-sizing:border-box}'+
    'body{font-family:"PingFang TC","Noto Sans TC","Microsoft JhengHei",sans-serif;color:#111;background:#fff;margin:0;padding:16px}'+
    '.sheet{page-break-after:always}.sheet:last-child{page-break-after:auto}'+
    '.head{border-bottom:2.5px solid #111;padding-bottom:5px;margin-bottom:9px;display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}'+
    'h1{font-size:18px;margin:0;letter-spacing:1px}'+
    '.meta{font-size:12px;color:#444}'+
    '.cols{display:flex;gap:7mm;align-items:flex-start}'+
    'table{width:100%;border-collapse:collapse;table-layout:fixed}'+
    'th,td{border:1px solid #444;text-align:center;overflow:hidden}'+
    'th{background:#ebebeb;font-size:11px;font-weight:600;padding:5px 0}'+
    'td{height:26px;font-size:12.5px}'+
    'tbody tr:nth-child(even) td{background:#f6f6f6}'+
    '.c1{width:12%}.c2{width:19%}.c3{width:37%}.c4{width:12%}.c5{width:20%}'+
    '.no{color:#555;font-size:11px}'+
    '.cat{color:#555;font-size:10.5px}'+
    '.nm{font-weight:600;font-size:12.5px;border-right:2px solid #111;white-space:nowrap;text-overflow:ellipsis;padding:0 3px}'+
    '.un{color:#555;font-size:10.5px}'+
    '@media print{.noprint{display:none}body{padding:0}}';

  var html = '<!doctype html><html><head><meta charset="utf-8"><title>庫存盤點空白表</title>'+
    '<style>'+css+'</style></head><body>'+
    '<button class="noprint" onclick="window.print()" style="margin-bottom:12px;padding:8px 14px">列印</button>'+
    pagesHtml+'</body></html>';

  var w = window.open('', '_blank');
  if (!w) { alert('瀏覽器阻擋了列印視窗，請允許彈出視窗後再試一次。'); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
}

function parseInvCountOCRText(text) {
  var items = sortInvItems(getInvItems());
  var rows = [];
  var lines = (text || '').split(/\n+/).map(function(l){ return l.replace(/\s+/g, ' ').trim(); }).filter(Boolean);
  lines.forEach(function(line) {
    var nums = line.match(/\d+(?:\.\d+)?/g);
    if (!nums || nums.length < 2) return;
    var code = parseInt(nums[0], 10);
    if (!code || code < 1 || code > items.length) return;
    var item = items[code - 1];
    var stock = parseFloat(nums[1]);
    var used = nums.length >= 3 ? parseFloat(nums[2]) : null;
    rows.push({ code: code, itemId: item.id, itemName: item.name, unit: item.unit, stock: stock, used: used, include: true, raw: line });
  });
  return rows;
}

function handleInvCountPhoto(event) {
  var file = event.target.files && event.target.files[0];
  var area = document.getElementById('inv-count-ocr-area');
  if (!file || !area) return;
  area.innerHTML = '<div class="info-box">🤖 Claude AI 讀取手寫盤點表中（約 10~20 秒）。數字會先進預覽表，確認後才回填。</div>';

  var items = sortInvItems(getInvItems());

  fileToOCRBase64(file, 1568).then(function(b64) {
    return claudeOCR([b64], 'countsheet');
  }).then(function(res) {
    var rows = [];
    (res.rows || []).forEach(function(r) {
      var code = parseInt(r.code, 10);
      if (!code || code < 1 || code > items.length) return;
      var stock = (r.stock === null || r.stock === undefined || r.stock === '') ? null : parseFloat(r.stock);
      var used = (r.used === null || r.used === undefined || r.used === '') ? null : parseFloat(r.used);
      if (stock === null && used === null) return; // 整列空白就跳過
      if (stock !== null && isNaN(stock)) stock = null;
      if (used !== null && isNaN(used)) used = null;
      if (stock === null && used === null) return;
      var item = items[code - 1];
      rows.push({ code: code, itemId: item.id, itemName: item.name, unit: item.unit,
        stock: stock !== null ? stock : 0, used: used, include: true,
        raw: 'AI讀到：編號'+code+'／庫存 '+(stock!==null?stock:'—')+'／用掉 '+(used!==null?used:'—') });
    });
    invCountOCRRows = rows;
    renderInvCountOCRPreview('（Claude AI 直接讀出結構化數字，無原始文字）');
  }).catch(function(aiErr) {
    // 備援：Tesseract（印刷體勉強可以，手寫成功率低）
    console.warn('Claude 盤點辨識失敗，改用備援 Tesseract：', aiErr);
    area.innerHTML = '<div class="info-box">⚠️ AI 服務暫時連不上（'+escAttr(aiErr.message)+'），改用備援辨識，準確度較低...</div>';
    return loadTesseractScript().then(function() {
      return window.Tesseract.recognize(file, 'chi_tra+eng');
    }).then(function(result) {
      var text = (result && result.data && result.data.text) || '';
      invCountOCRRows = parseInvCountOCRText(text);
      renderInvCountOCRPreview(text);
    }).catch(function(err) {
      area.innerHTML = '<div class="info-box" style="color:var(--red)">✗ 盤點照片辨識失敗：'+escAttr(err.message)+'。可以先印空白表，填寫時把「編號」和「實際庫存」的數字寫清楚再拍一次。</div>';
    });
  }).finally(function() {
    event.target.value = '';
  });
}

function renderInvCountOCRPreview(rawText) {
  var area = document.getElementById('inv-count-ocr-area');
  if (!area) return;
  if (!invCountOCRRows.length) {
    area.innerHTML = '<div class="info-box" style="color:var(--red)">沒有讀到可回填的盤點數字。建議列印空白表後，在每列寫清楚「編號」和「實際庫存」再拍照。</div>'+
      '<details style="font-size:12px;color:var(--text3)"><summary>查看讀到的文字</summary><pre style="white-space:pre-wrap">'+escAttr(rawText || '')+'</pre></details>';
    return;
  }
  var html = '<div class="info-box">已讀到 '+invCountOCRRows.length+' 筆。請檢查數字，取消勾選的列不會回填。</div>';
  html += '<table><thead><tr><th style="width:34px"></th><th>編號</th><th>品項</th><th style="width:110px">目前實際庫存</th><th style="width:110px">本週用掉</th><th>原始文字</th></tr></thead><tbody>';
  invCountOCRRows.forEach(function(r, idx) {
    html += '<tr>';
    html += '<td><input type="checkbox" '+(r.include?'checked':'')+' onchange="invCountOCRRows['+idx+'].include=this.checked"></td>';
    html += '<td>'+r.code+'</td><td>'+escAttr(r.itemName)+' <span class="muted">('+escAttr(r.unit)+')</span></td>';
    html += '<td><input class="in-num" type="number" min="0" step="any" value="'+r.stock+'" oninput="invCountOCRRows['+idx+'].stock=this.value!==\'\'?parseFloat(this.value):null"></td>';
    html += '<td><input class="in-num" type="number" min="0" step="any" value="'+(r.used!==null?r.used:'')+'" oninput="invCountOCRRows['+idx+'].used=this.value!==\'\'?parseFloat(this.value):null"></td>';
    html += '<td class="muted">'+escAttr(r.raw)+'</td></tr>';
  });
  html += '</tbody></table><div style="display:flex;gap:10px;margin-top:12px"><button class="btn btn-gold" onclick="applyInvCountOCRRows()">✓ 確認回填盤點表</button><button class="btn btn-outline btn-sm" onclick="document.getElementById(\'inv-count-ocr-area\').innerHTML=\'\';invCountOCRRows=[]">清除</button></div>';
  area.innerHTML = html;
}

function applyInvCountOCRRows() {
  var count = 0;
  invCountOCRRows.forEach(function(r) {
    if (!r.include || r.stock === null || isNaN(r.stock)) return;
    var stockEl = document.getElementById('inv-stock-'+r.itemId);
    var usedEl = document.getElementById('inv-used-'+r.itemId);
    if (stockEl) stockEl.value = r.stock;
    if (usedEl && r.used !== null && !isNaN(r.used)) usedEl.value = r.used;
    autoSaveInvItem(r.itemId);
    count++;
  });
  document.getElementById('inv-count-ocr-area').innerHTML = '';
  invCountOCRRows = [];
  renderInventory();
  alert('已回填並儲存 '+count+' 筆盤點資料。');
}

// ── 進貨登記 UI ─────────────────────────────────────────
var invRestockLogOpen = false;

function toggleInvRestockLog() {
  invRestockLogOpen = !invRestockLogOpen;
  renderInvRestockLog();
}

function renderInvRestockItemSelect() {
  var sel = document.getElementById('inv-restock-item');
  if (!sel) return;
  var items = sortInvItems(getInvItems());
  var keepVal = sel.value;
  if (items.length === 0) {
    sel.innerHTML = '<option value="">請先到「管理品項清單」新增品項</option>';
    return;
  }
  sel.innerHTML = items.map(function(it){
    return '<option value="'+it.id+'">'+(INV_CAT_ICONS[it.cat]||'📌')+' '+it.name+'（'+it.unit+'）</option>';
  }).join('');
  if (keepVal && items.some(function(it){ return String(it.id) === keepVal; })) sel.value = keepVal;
}

function submitInvRestock() {
  var sel = document.getElementById('inv-restock-item');
  var dateEl = document.getElementById('inv-restock-date');
  var qtyEl = document.getElementById('inv-restock-qty');
  var noteEl = document.getElementById('inv-restock-note');
  var hint = document.getElementById('inv-restock-hint');

  var itemId = sel ? sel.value : '';
  var qty = qtyEl && qtyEl.value !== '' ? parseFloat(qtyEl.value) : null;
  var dateStr = dateEl && dateEl.value ? dateEl.value : invFmtDate(new Date());

  if (!itemId) { if (hint){ hint.textContent = '請先選品項'; hint.style.color = 'var(--red)'; } return; }
  if (!qty || qty <= 0) { if (hint){ hint.textContent = '請輸入大於 0 的進貨數量'; hint.style.color = 'var(--red)'; } return; }

  var items = getInvItems();
  var it = items.find(function(x){ return String(x.id) === String(itemId); });

  addInvRestock(itemId, qty, dateStr, noteEl ? noteEl.value : '');

  if (qtyEl) qtyEl.value = '';
  if (noteEl) noteEl.value = '';
  if (hint) {
    hint.textContent = '✓ 已登記：'+(it?it.name:'')+' +'+qty+(it?it.unit:'')+'（'+dateStr+'）目前庫存已更新';
    hint.style.color = 'var(--green)';
    setTimeout(function(){ hint.textContent = ''; }, 3000);
  }

  renderInventory(); // 目前庫存、警示燈、建議訂購量立刻反映這筆進貨
  if (invRestockLogOpen) renderInvRestockLog();
}

function removeInvRestock(dateKey, idx) {
  if (!confirm('確定要刪除這筆進貨紀錄嗎？這不會動到任何盤點資料。')) return;
  deleteInvRestock(dateKey, idx);
  renderInventory();
  renderInvRestockLog();
}

function renderInvRestockLog() {
  var wrap = document.getElementById('inv-restock-log');
  var toggleLabel = document.getElementById('inv-restock-toggle-label');
  if (!wrap) return;
  if (!invRestockLogOpen) {
    wrap.style.display = 'none';
    if (toggleLabel) toggleLabel.textContent = '顯示最近進貨明細';
    return;
  }
  wrap.style.display = 'block';
  if (toggleLabel) toggleLabel.textContent = '隱藏進貨明細';

  var items = getInvItems();
  var list = listInvRestocks(); // 全部明細，新到舊
  if (list.length === 0) {
    wrap.innerHTML = '<div class="empty">尚無進貨紀錄</div>';
    return;
  }
  var html = '<table><thead><tr><th>日期</th><th>品項</th><th>進貨數量</th><th>備註</th><th></th></tr></thead><tbody>';
  list.slice(0, 50).forEach(function(r) {
    var it = items.find(function(x){ return String(x.id) === String(r.itemId); });
    html += '<tr>';
    html += '<td>'+r.dateKey+'</td>';
    html += '<td>'+(it?it.name:'(已刪除品項#'+r.itemId+')')+'</td>';
    html += '<td><span style="color:var(--green);font-weight:600">+'+r.qty+(it?(' '+it.unit):'')+'</span></td>';
    html += '<td class="muted">'+(r.note||'—')+'</td>';
    html += '<td><button class="btn-sm btn-del" onclick="removeInvRestock(\''+r.dateKey+'\','+r.idx+')">刪除</button></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  if (list.length > 50) html += '<div class="muted" style="margin-top:8px">僅顯示最近 50 筆，完整紀錄已全部保存在資料庫中。</div>';
  wrap.innerHTML = html;
}

// ── 批次登記：文字解析 ──────────────────────────────────
var batchRestockOpen = false;
var batchParsedRows = []; // {raw, code, qty, unit, matchedItemId, dateKey}

function toggleBatchRestockBox() {
  batchRestockOpen = !batchRestockOpen;
  var box = document.getElementById('batch-restock-box');
  var label = document.getElementById('batch-restock-toggle-label');
  if (box) box.style.display = batchRestockOpen ? 'block' : 'none';
  if (label) label.textContent = batchRestockOpen ? '收合' : '展開';
  var dateEl = document.getElementById('batch-restock-date');
  if (dateEl && !dateEl.value) dateEl.value = invFmtDate(new Date());
}

// 中文數字（一～九十九）轉阿拉伯數字，給「木框要五個」這種沒寫阿拉伯數字的格式用
var CN_NUM_MAP = {'零':0,'〇':0,'一':1,'二':2,'兩':2,'三':3,'四':4,'五':5,'六':6,'七':7,'八':8,'九':9};
function cnNumToInt(s) {
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if (s.length === 1 && CN_NUM_MAP[s] !== undefined) return CN_NUM_MAP[s];
  if (s === '十') return 10;
  var m = s.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/);
  if (m) {
    var tens = m[1] ? CN_NUM_MAP[m[1]] : 1;
    var ones = m[2] ? CN_NUM_MAP[m[2]] : 0;
    return tens*10 + ones;
  }
  return null;
}

// 解析單行文字，回傳 {raw, code, qty, unit}；qty 解析不出來時為 null（需人工填）
function parseRestockLine(line) {
  line = line.trim();
  if (!line) return null;

  // 格式A：代號-數量單位，例如「4F-20張」「30P-3張」
  var mA = line.match(/^([A-Za-z0-9]+)[\s\-－:：—]+(\d+(?:\.\d+)?)\s*([\u4e00-\u9fa5A-Za-z]{0,4})\s*$/);
  if (mA) {
    return { raw: line, code: mA[1], qty: parseFloat(mA[2]), unit: mA[3] || '' };
  }

  // 格式B：自由文字＋中文或阿拉伯數字＋單位，例如「木框要五個」「白色顏料3瓶」
  var mB = line.match(/([一二三四五六七八九十]+|\d+(?:\.\d+)?)\s*(個|支|片|塊|組|份|張|瓶|包|捲|盒|台|罐|條)/);
  if (mB) {
    var qty = cnNumToInt(mB[1]);
    if (qty !== null) {
      var codeGuess = line.replace(mB[0], '').replace(/[,，。.]/g, ' ').trim();
      return { raw: line, code: codeGuess || line, qty: qty, unit: mB[2] };
    }
  }

  return { raw: line, code: line, qty: null, unit: '' };
}

// 用代號去比對現有品項清單：先試完全比對（去空白/底線/破折號後相同），再試互相包含
function normalizeCodeStr(s) {
  return (s || '').toUpperCase().replace(/[\s\-－_]/g, '');
}
function matchItemByCode(items, code) {
  var nc = normalizeCodeStr(code);
  if (!nc) return null;
  var exact = items.find(function(it){ return normalizeCodeStr(it.name) === nc; });
  if (exact) return exact;
  var sub = items.find(function(it){
    var nn = normalizeCodeStr(it.name);
    return nn.indexOf(nc) !== -1 || nc.indexOf(nn) !== -1;
  });
  return sub || null;
}

function parseBatchRestockText() {
  var textEl = document.getElementById('batch-restock-text');
  var dateEl = document.getElementById('batch-restock-date');
  var text = textEl ? textEl.value : '';
  var defaultDate = (dateEl && dateEl.value) ? dateEl.value : invFmtDate(new Date());
  var items = getInvItems();

  var lines = text.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l; });
  if (lines.length === 0) {
    alert('請先貼上文字內容');
    return;
  }

  batchParsedRows = lines.map(function(line) {
    var parsed = parseRestockLine(line);
    if (!parsed) return null;
    var matched = matchItemByCode(items, parsed.code);
    return {
      raw: parsed.raw,
      codeGuess: parsed.code,
      qty: parsed.qty,
      unit: parsed.unit,
      matchedItemId: matched ? matched.id : '',
      dateKey: defaultDate,
      include: true
    };
  }).filter(Boolean);

  renderBatchRestockPreview();
}

function renderBatchRestockPreview() {
  var wrap = document.getElementById('batch-restock-preview');
  if (!wrap) return;
  if (batchParsedRows.length === 0) {
    wrap.innerHTML = '';
    return;
  }
  var items = sortInvItems(getInvItems());
  var itemOptions = '<option value="">— 未對應，請手動選 —</option>' + items.map(function(it){
    return '<option value="'+it.id+'">'+(INV_CAT_ICONS[it.cat]||'📌')+' '+it.name+'（'+it.unit+'）</option>';
  }).join('');

  var html = '<div class="info-box">請檢查每一行解析結果，品項對不對、數量對不對，確認沒問題再按下方「確認登記」。沒被勾選的行不會被登記。</div>';
  html += '<table><thead><tr><th style="width:34px"></th><th>原始文字</th><th style="width:220px">對應品項</th><th style="width:90px">數量</th><th style="width:120px">日期</th></tr></thead><tbody>';
  batchParsedRows.forEach(function(row, idx) {
    html += '<tr>';
    html += '<td><input type="checkbox" '+(row.include?'checked':'')+' onchange="batchParsedRows['+idx+'].include=this.checked"></td>';
    html += '<td class="muted">'+row.raw+'</td>';
    html += '<td><select onchange="batchParsedRows['+idx+'].matchedItemId=this.value">' +
      itemOptions.replace('value="'+row.matchedItemId+'"', 'value="'+row.matchedItemId+'" selected') + '</select></td>';
    html += '<td><input type="number" class="in-num" value="'+(row.qty!==null?row.qty:'')+'" min="0" step="any" onwheel="this.blur()" oninput="batchParsedRows['+idx+'].qty=this.value!==\'\'?parseFloat(this.value):null"></td>';
    html += '<td><input type="date" value="'+row.dateKey+'" onchange="batchParsedRows['+idx+'].dateKey=this.value"></td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  html += '<button class="btn btn-gold" style="margin-top:14px" onclick="confirmBatchRestock()">✓ 確認登記以上項目</button>';
  wrap.innerHTML = html;
}

function confirmBatchRestock() {
  var toSave = batchParsedRows.filter(function(r){ return r.include; });
  var problems = toSave.filter(function(r){ return !r.matchedItemId || !r.qty || r.qty <= 0; });
  if (problems.length > 0) {
    if (!confirm('有 '+problems.length+' 行沒選品項或數量無效，這些行會被跳過，其他正常的行繼續登記，確定要送出嗎？')) return;
  }
  var savedCount = 0;
  toSave.forEach(function(r) {
    if (!r.matchedItemId || !r.qty || r.qty <= 0) return;
    addInvRestock(r.matchedItemId, r.qty, r.dateKey, '批次登記：'+r.raw);
    savedCount++;
  });
  batchParsedRows = [];
  document.getElementById('batch-restock-text').value = '';
  document.getElementById('batch-restock-preview').innerHTML = '';
  renderInventory();
  if (invRestockLogOpen) renderInvRestockLog();
  alert('已登記 '+savedCount+' 筆進貨紀錄');
}

// ── Claude AI 影像辨識（主力）────────────────────────────
// 走 Railway 上的 LINE Bot 後端 /api/ocr，用 Claude 視覺模型讀照片，
// 收據、淘寶截圖（簡體字）、手寫盤點表都讀得懂。
// Tesseract 降級為備援：AI 服務連不上時才啟用。
var OCR_API_URL = 'https://line-ai-helper-production.up.railway.app/api/ocr';

// 照片先在瀏覽器端縮到長邊 1568px、JPEG 85%，
// 上傳量從好幾 MB 降到幾百 KB，辨識速度快、也不會撞到 API 的圖片大小上限。
function fileToOCRBase64(file, maxSide) {
  maxSide = maxSide || 1568;
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onerror = function(){ reject(new Error('照片讀取失敗')); };
    reader.onload = function(e) {
      var img = new Image();
      img.onerror = function(){ reject(new Error('照片格式無法解析')); };
      img.onload = function() {
        var w = img.width, h = img.height;
        if (w > maxSide || h > maxSide) {
          var ratio = Math.min(maxSide / w, maxSide / h);
          w = Math.round(w * ratio); h = Math.round(h * ratio);
        }
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// mode: 'receipt'（記帳收據/購物截圖）或 'countsheet'（手寫盤點表）
function claudeOCR(base64List, mode) {
  var ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
  var timer = ctl ? setTimeout(function(){ ctl.abort(); }, 90000) : null;
  return fetch(OCR_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode: mode, images: base64List }),
    signal: ctl ? ctl.signal : undefined
  }).then(function(r) {
    if (timer) clearTimeout(timer);
    if (!r.ok) throw new Error('AI 服務回應 ' + r.status);
    return r.json();
  }).then(function(j) {
    if (j.error) throw new Error(j.error);
    return j;
  }).catch(function(err) {
    if (timer) clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('AI 辨識逾時（90秒）');
    throw err;
  });
}

// ── 截圖 OCR（瀏覽器端備援，無需金鑰）─────────────────
var tesseractLoaded = false;
function loadTesseractScript() {
  return new Promise(function(resolve, reject) {
    if (tesseractLoaded && window.Tesseract) { resolve(); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = function(){ tesseractLoaded = true; resolve(); };
    s.onerror = function(){ reject(new Error('OCR 函式庫載入失敗，請檢查網路連線')); };
    document.head.appendChild(s);
  });
}

function handleBatchRestockImage(event) {
  var file = event.target.files && event.target.files[0];
  var statusEl = document.getElementById('batch-ocr-status');
  if (!file) return;
  if (statusEl) { statusEl.textContent = '⏳ 載入辨識引擎中（第一次使用會比較久）...'; statusEl.style.color = 'var(--gold2)'; }

  loadTesseractScript().then(function() {
    if (statusEl) statusEl.textContent = '⏳ 辨識中，請稍候...';
    return window.Tesseract.recognize(file, 'chi_tra+eng');
  }).then(function(result) {
    var text = (result && result.data && result.data.text) || '';
    var textEl = document.getElementById('batch-restock-text');
    if (textEl) {
      textEl.value = (textEl.value ? textEl.value + '\n' : '') + text.trim();
    }
    if (statusEl) {
      statusEl.textContent = '✓ 辨識完成，請務必檢查下方文字是否正確（OCR 不保證 100% 準確），確認無誤再按「解析文字」';
      statusEl.style.color = 'var(--green)';
    }
  }).catch(function(err) {
    if (statusEl) { statusEl.textContent = '✗ 辨識失敗：' + err.message + '（你仍可以直接手動把文字打進下面的文字框）'; statusEl.style.color = 'var(--red)'; }
  });
}

// ── 統計與警示 ──────────────────────────────────────────
// 安全庫存的「注意」緩衝線：安全庫存的1.3倍（無條件捨去）。
// 用捨去而不是進位，是因為安全庫存很小（1~3）時，30%緩衝根本不到1罐，
// 這種小數量品項就不該有注意區間，直接維持「夠/不夠」二分就好；
// 安全庫存較大時（例如20），才會出現有意義的緩衝區間。
function getInvCautionLine(safeStock) {
  return Math.floor(safeStock * 1.3);
}

// 把所有品項依目前庫存狀況分成三層，回傳 {lowStock, caution, runningOut}
// 這是共用邏輯：renderInvSummaryBar（大字摘要）跟 renderInvAlerts（詳細清單）都呼叫這個，
// 確保兩處顯示的數字永遠一致，不會出現「摘要寫3項要訂貨，下面清單卻列出4項」這種對不上的情況。
function classifyInvItems() {
  var items = getInvItems();
  var weekKey = invCurWeek;
  var lowStock = [];
  var caution = [];
  var runningOut = [];

  items.forEach(function(it) {
    var curStock = computeCurrentStock(it.id, weekKey);
    if (curStock === null) return;
    var order = computeOrderQty(it.id, weekKey, it.safeStock);

    if (curStock <= it.safeStock) {
      if (order.qty !== null && order.qty > 0) lowStock.push({ item: it, stock: curStock, order: order });
      return;
    }
    if (order.qty !== null && order.qty > 0) {
      runningOut.push({ item: it, stock: curStock, order: order });
      return;
    }
    var cautionLine = getInvCautionLine(it.safeStock);
    if (curStock <= cautionLine) {
      caution.push({ item: it, stock: curStock, cautionLine: cautionLine });
    }
  });

  return { lowStock: lowStock, caution: caution, runningOut: runningOut };
}

// 大字摘要列：放在頁面最上面，平時也會顯示（包含全部是0的時候），
// 讓人三秒內確認「現在有沒有事要處理」，不用往下捲去看清單。
function renderInvSummaryBar() {
  var el = document.getElementById('inv-summary-bar');
  if (!el) return;
  var c = classifyInvItems();
  var items = getInvItems();

  function block(label, count, colorVar) {
    var color = count > 0 ? colorVar : 'var(--text3)';
    return '<div style="flex:1;min-width:110px;background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;text-align:center">' +
      '<div style="font-size:28px;font-weight:700;color:'+color+'">'+count+'</div>' +
      '<div style="font-size:12px;color:var(--text3);margin-top:2px">'+label+'</div>' +
      '</div>';
  }

  var html = '<div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px">';
  html += block('🚨 要訂貨', c.lowStock.length, 'var(--red)');
  html += block('⚠️ 注意', c.caution.length, 'var(--gold2)');
  html += block('📉 建議訂購', c.runningOut.length, 'var(--gold2)');
  html += block('📦 在管品項', items.length, 'var(--text2)');
  html += '</div>';
  el.innerHTML = html;
}

function renderInvAlerts() {
  var c = classifyInvItems();
  var items = getInvItems();
  var lowStock = c.lowStock, caution = c.caution, runningOut = c.runningOut;

  var el = document.getElementById('inv-alert-area');
  if (lowStock.length === 0 && caution.length === 0 && runningOut.length === 0) {
    el.innerHTML = '';
    return;
  }

  // 依類別排序（照畫布→框木板→...的固定順序），同類別放一起，訂貨時照分類處理比較順手
  function byCat(a, b) {
    var ca = INV_CATS.indexOf(a.item.cat); if (ca === -1) ca = 999;
    var cb = INV_CATS.indexOf(b.item.cat); if (cb === -1) cb = 999;
    return ca - cb;
  }
  lowStock.sort(byCat);
  caution.sort(byCat);
  runningOut.sort(byCat);

  // 同一層級的清單依類別分段，每段前面放一個類別小標題，段內只放精簡的一行文字
  function renderGroupedList(list, badgeStyle, lineFn) {
    var out = '';
    var lastCat = null;
    list.forEach(function(x) {
      if (x.item.cat !== lastCat) {
        if (lastCat !== null) out += '</div>';
        lastCat = x.item.cat;
        out += '<div style="margin:10px 0 6px;font-size:12px;color:var(--text3)">'+(INV_CAT_ICONS[lastCat]||'📌')+' '+lastCat+'</div>';
        out += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
      }
      out += '<span class="badge" style="'+badgeStyle+'">'+lineFn(x)+'</span>';
    });
    if (lastCat !== null) out += '</div>';
    return out;
  }

  var html = '<div class="card" style="border-color:rgba(224,85,85,0.3)">';
  html += '<div class="card-title" style="color:var(--red)">🚨 庫存要注意</div>';

  if (lowStock.length > 0) {
    html += '<div style="margin-bottom:0;font-size:13px;color:var(--text2)">已低於安全庫存，本週要訂貨：</div>';
    html += renderGroupedList(lowStock, 'background:rgba(224,85,85,0.15);color:var(--red);border:1px solid rgba(224,85,85,0.3)', function(x) {
      return x.item.name+'：剩 '+x.stock+' '+x.item.unit+' → 建議訂 '+x.order.qty+' '+x.item.unit;
    });
  }

  if (caution.length > 0) {
    html += '<div style="margin:14px 0 0;font-size:13px;color:var(--text2)">還沒低於安全庫存，但已經逼近，可以提早留意：</div>';
    html += renderGroupedList(caution, 'background:rgba(224,158,77,0.15);color:#e09e4d;border:1px solid rgba(224,158,77,0.35)', function(x) {
      return x.item.name+'：剩 '+x.stock+' '+x.item.unit+'（安全庫存 '+x.item.safeStock+'，注意線 '+x.cautionLine+'）';
    });
  }

  if (runningOut.length > 0) {
    html += '<div style="margin:14px 0 0;font-size:13px;color:var(--text2)">目前還在安全庫存之上，但照消耗速度，建議這週順便訂一些：</div>';
    html += renderGroupedList(runningOut, 'background:rgba(201,168,76,0.12);color:var(--gold2);border:1px solid rgba(201,168,76,0.25)', function(x) {
      return x.item.name+'：剩 '+x.stock+' '+x.item.unit+' → 建議訂 '+x.order.qty+' '+x.item.unit;
    });
  }

  html += '</div>';
  el.innerHTML = html;
}

function renderInvStats() {
  var items = getInvItems();
  var weekKey = invCurWeek;
  var st = getInvStore();
  var allWeeks = Object.keys(st.weeks).sort();

  var el = document.getElementById('inv-stats-area');
  if (items.length === 0) { el.innerHTML = '<div class="empty">尚無品項資料</div>'; return; }

  var totalItems = items.length;
  var lowCount = 0, cautionCount = 0;
  items.forEach(function(it){
    var s = computeCurrentStock(it.id, weekKey);
    if (s === null) return;
    if (s <= it.safeStock) lowCount++;
    else if (s <= getInvCautionLine(it.safeStock)) cautionCount++;
  });

  var html = '<div class="stat-grid">';
  html += '<div class="stat-card"><div class="lbl">品項總數</div><div class="val">'+totalItems+'</div></div>';
  html += '<div class="stat-card"><div class="lbl">已累積盤點週數</div><div class="val">'+allWeeks.length+'</div></div>';
  html += '<div class="stat-card"><div class="lbl">目前低於安全庫存</div><div class="val" style="color:'+(lowCount>0?'var(--red)':'var(--gold2)')+'">'+lowCount+'</div></div>';
  html += '<div class="stat-card"><div class="lbl">目前需要注意</div><div class="val" style="color:'+(cautionCount>0?'#e09e4d':'var(--gold2)')+'">'+cautionCount+'</div></div>';
  html += '</div>';

  // 各品項消耗趨勢表
  html += '<table><thead><tr><th>類別</th><th>品項</th><th style="width:44px">圖片</th><th>目前庫存</th><th>安全庫存</th><th>近6週平均週消耗</th><th>近90天叫貨</th><th>預估還能撐</th><th>本週建議訂購量</th></tr></thead><tbody>';
  sortInvItems(items).forEach(function(it) {
    var curStock = computeCurrentStock(it.id, weekKey);
    var usageStats = computeWeeklyUsageStats(it.id, weekKey, 6);
    var avgUsage = usageStats.avg;
    var restockStats = computeInvRestockStats(it.id, weekKey);
    var estU = (it.estUsage != null && parseFloat(it.estUsage) > 0) ? parseFloat(it.estUsage) : null;
    var weeksLeftStr = '—';
    if (curStock !== null && avgUsage && avgUsage > 0) {
      weeksLeftStr = (curStock / avgUsage).toFixed(1) + ' 週';
    } else if (curStock !== null && estU && usageStats.samples < INV_MIN_USAGE_SAMPLES_FOR_FORECAST) {
      weeksLeftStr = (curStock / estU).toFixed(1) + ' 週 <span class="muted">(預估)</span>';
    }
    var order = computeOrderQty(it.id, weekKey, it.safeStock);
    var orderStr = '<span class="muted">—</span>';
    if (order.qty !== null) {
      if (order.basis === 'estimate') {
        orderStr = order.qty > 0
          ? '<span style="color:var(--red);font-weight:600">'+order.qty+' '+it.unit+'</span> <span class="muted">依人工預估，實際資料 '+order.samples+'/'+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+'</span>'
          : '<span style="color:var(--green)">0</span> <span class="muted">依人工預估</span>';
      } else if (order.basis === 'learning') {
        orderStr = order.qty > 0
          ? '<span style="color:var(--red);font-weight:600">'+order.qty+' '+it.unit+'</span> <span class="muted">先補安全庫存，累積中 '+order.samples+'/'+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+'</span>'
          : '<span class="muted">先累積資料 '+order.samples+'/'+INV_MIN_USAGE_SAMPLES_FOR_FORECAST+'</span>';
      } else if (order.qty > 0) {
        orderStr = '<span style="color:var(--red);font-weight:600">'+order.qty+' '+it.unit+'</span>';
      } else {
        var cautionLine2 = getInvCautionLine(it.safeStock);
        orderStr = (order.curStock !== null && order.curStock > it.safeStock && order.curStock <= cautionLine2)
          ? '<span style="color:#e09e4d;font-weight:600">0（注意線 '+cautionLine2+'）</span>'
          : '<span style="color:var(--green)">0</span>';
      }
    }
    html += '<tr>';
    html += '<td><span class="badge b-gold">'+(INV_CAT_ICONS[it.cat]||'📌')+' '+it.cat+'</span></td>';
    var imgInline2 = it.image ? '<img src="'+it.image+'" style="width:32px;height:32px;object-fit:cover;border-radius:4px;border:1px solid var(--border);cursor:pointer" onclick="showInvImage('+it.id+')">' : '<span class="muted">—</span>';
    html += '<td>'+it.name+'</td>';
    html += '<td style="text-align:center">'+imgInline2+'</td>';
    html += '<td>'+(curStock !== null ? curStock+' '+it.unit : '<span class="muted">未盤點</span>')+'</td>';
    html += '<td class="muted">'+it.safeStock+'</td>';
    var usageCell;
    if (avgUsage !== null) usageCell = avgUsage.toFixed(1)+' '+it.unit+' <span class="muted">('+usageStats.samples+'筆)</span>';
    else if (estU) usageCell = '<span style="color:var(--gold2)">'+estU+' '+it.unit+'</span> <span class="muted">(人工預估)</span>';
    else usageCell = '<span class="muted">資料不足</span>';
    html += '<td>'+usageCell+'</td>';
    html += '<td>'+(restockStats.count90 > 0 ? restockStats.monthlyCalls.toFixed(1)+' 次/月，均 '+restockStats.avgQty.toFixed(1)+' '+it.unit : '<span class="muted">尚無</span>')+'</td>';
    html += '<td>'+weeksLeftStr+'</td>';
    html += '<td>'+orderStr+'</td>';
    html += '</tr>';
  });
  html += '</tbody></table>';
  el.innerHTML = html;
}

function renderInventory() {
  renderInvSummaryBar();
  renderInvAlerts();
  renderInvRestockItemSelect();
  renderInvWeekTable();
  renderInvStats();
  if (invRestockLogOpen) renderInvRestockLog();
}

function dlInventoryExcel() {
  var items = getInvItems();
  var st = getInvStore();
  var storeName = {'flagship':'旗艦店','guotu':'國圖店'}[curStore.inventory];
  var weekKey = invCurWeek;
  var wb = XLSX.utils.book_new();

  // 本週盤點工作表
  var sheet1 = [['Otto2 ARTCLUB '+storeName+' 庫存盤點 '+invWeekLabel(weekKey)],[],
    ['類別','品項','單位','安全庫存','目前庫存','近6週平均週消耗','預估還能撐(週)','本週建議訂購量']];
  sortInvItems(items).forEach(function(it) {
    var curStock = computeCurrentStock(it.id, weekKey);
    var avgUsage = computeAvgWeeklyUsage(it.id, weekKey, 6);
    var weeksLeft = (curStock !== null && avgUsage) ? (curStock/avgUsage).toFixed(1) : '';
    var order = computeOrderQty(it.id, weekKey, it.safeStock);
    sheet1.push([it.cat, it.name, it.unit, it.safeStock, curStock !== null ? curStock : '', avgUsage !== null ? avgUsage.toFixed(1) : '', weeksLeft, order.qty !== null ? order.qty : '']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet1), '本週庫存狀態');

  // 歷史盤點明細
  var allWeeks = Object.keys(st.weeks).sort();
  var sheet2 = [['歷史盤點紀錄 — '+storeName],[],['週次','品項','本週用掉','盤點實際庫存']];
  allWeeks.forEach(function(wk) {
    Object.keys(st.weeks[wk]).forEach(function(itemId) {
      var item = items.find(function(x){ return String(x.id) === String(itemId); });
      var rec = st.weeks[wk][itemId];
      sheet2.push([invWeekLabel(wk), item ? item.name : ('(已刪除#'+itemId+')'), rec.used !== null && rec.used !== undefined ? rec.used : '', rec.stock !== null && rec.stock !== undefined ? rec.stock : '']);
    });
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet2), '歷史盤點明細');

  // 進貨明細
  var sheet3 = [['進貨登記明細 — '+storeName],[],['日期','品項','進貨數量','單位','備註']];
  listInvRestocks().forEach(function(r) {
    var item = items.find(function(x){ return String(x.id) === String(r.itemId); });
    sheet3.push([r.dateKey, item ? item.name : ('(已刪除#'+r.itemId+')'), r.qty, item ? item.unit : '', r.note || '']);
  });
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet3), '進貨明細');

  XLSX.writeFile(wb, 'Otto2_庫存盤點_'+storeName+'_'+weekKey+'.xlsx');
}

