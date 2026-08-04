# Otto2 ARTCLUB 內部系統

台中市南屯區干城街 328 號 4F 成人藝術課程工作室。這份文件給 AI 助手看，說明系統怎麼組成、規則是什麼、還有哪些事沒做完。

目標：**2026 年 9 月全面取代第三方平台「夯客」。**

---

## 一、系統組成

### 主系統（行政日常唯一入口）
`https://otto2tfs2000-ctrl.github.io/salary-system/`
GitHub repo：`otto2tfs2000-ctrl/salary-system`

| 檔案 | 負責 |
|---|---|
| `index.html` | 分頁框架、載入所有 js（**改 js 要同步改版本號**） |
| `app.js` | 每日填寫、月報、薪資、分頁切換 |
| `booking.js` | 今日排課、核銷、手動登記 |
| `member.js` | 會員查詢、方案設定、賣方案 |
| `inventory.js` | 庫存盤點、進貨、自動耗用 |
| `consumables.js` | 耗材記帳 |
| `recipe.js` | 課程用料與毛利 |
| `init.js` | 啟動 |

九個分頁：今日排課、每日填寫、會員、月報總覽、耗材記帳、庫存盤點、課程用料、本月薪資、老師設定。

### 客人端
`https://liff.line.me/2010906803-FMDYktUN`
repo：`otto2tfs2000-ctrl/otto2artclub-booking`（`index.html`、`otto2-admin.html`）

`otto2-admin.html` 是**舊後台**，功能不完整且會造成重複扣點，不要給行政用，也不要在上面加功能。

### 推播
repo `otto2-notify`，Railway `otto2-notify-production.up.railway.app`

---

## 二、資料存在哪

### Firebase A — 預約與會員
`otto2-booking-f9ef7`（Realtime Database，非 Firestore，區域 asia-southeast1）

```
bookings/{id}
members/{電話}
  ├ name, phone, note, createdAt
  ├ cache: { points, sessions, bonus, voucher }   ← 算好的餘額
  └ ledger/{key}: { at, by, delta, reason, type, expiry?, planName?, price?, pay? }
```

**電話是唯一主鍵。** 餘額一律是 ledger 加總，`cache` 只是算好的結果，兩邊必須一起寫。
`type` 有四種：`points`、`sessions`、`bonus`、`voucher`（表框折價金）。

### Firebase B — 營運資料
`otto2-2026`

```
salaryData/           ← 主系統的 S 物件，含 teachers/daily/inventory/recipes/plans/planSales
salesData/records
deductions/{id}       ← 核銷紀錄，每日填寫讀這個
```

### Google 試算表
ID `1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M`
分頁：課程、班表、使用說明、說明、訂金

「課程」分頁欄位：A 分類｜B 課程名稱｜C 說明｜D 規格｜E 時長｜F 價格｜G 圖片網址｜H 上架 Y/N｜I 排序｜**J 最小年齡**｜K 可加堂

---

## 三、規則（不要違反）

**會員只有一個家。** 一律是 `otto2-booking-f9ef7/members`。不要在 `otto2-2026` 另存一份會員，介面放哪裡都可以，資料一定寫回這裡。

**餘額不能直接改。** 要加減一律寫一筆 ledger，再重算 cache。

**堂數方案單價不同**（30 堂 30,000、70 堂 60,000），不能設全域單價，各建一筆方案。

**方案不刪除，只停用。** 已賣出的紀錄要對得回來。

**老師名單以「老師設定」為準**，不要在程式裡寫死名字。歷史資料的名字若對不上（例如夯客舊資料的 `ETHAN` 全大寫），業績會落空，要用修正核銷改掉。

**年齡分級**：大人 16 歲以上、兒童 5-7 / 8-12 / 13-15。試算表 J 欄只能填 5 / 8 / 13 / 16，填其他數字會篩錯（系統用級距下限比對）。

**改任何 js 檔，`index.html` 的 `?v=` 版本號要一起改**，否則瀏覽器會用快取的舊檔。

---

## 四、核心流程

### 核銷（`booking.js` 的 `bkCheckout`）
1. 找付款會員：先看 `memberPhone`，沒有就拿 `customer.phone` 正規化後比對（`+886` 開頭要轉成 `0`）
2. 課程費用 + 加購項目，各自可選付款方式
3. 點數／堂數扣抵 → 寫負的 ledger + 更新 cache
4. 紅利回饋：課程金額每 500 元 1 點（加購不計）
5. 材料自動扣庫存 → 依「課程用料」寫進 `inventory.autoUsed`
6. 寫一筆 `deductions` → 每日填寫讀得到
7. 修正核銷會先沖銷舊的再寫新的，材料也會先退再扣

### 每日填寫自動帶入（`app.js`）
`renderDayForm` 先算 `dedTotals(日期)`，把人次與營收**在組裝畫面時就寫進 value**。
不要改回「畫完再補填」的做法——那頁會重畫多次，補填會被洗掉。

當日營收 = 核銷營收（自動）＋ 其他收入（手動，純賣材料那種）。存進 `revenue` 的是總額，`revenueExtra` 記手動的部分。

### 庫存
沒有「目前庫存」這個欄位，是算出來的：
**最近一次盤點的實際數量 − 之後各週的用掉量 − 核銷自動耗用 ＋ 期間進貨**

週一盤點填實際數量後，會跟帳面比對，差額標紅（⚠ 實際少 N），用來查有沒有人拿了沒登記。

---

## 五、還沒做的事（依優先順序）

1. **Firebase 安全規則** — 1,087 筆客戶通訊錄目前完全開放，任何人拿到網址就能整包下載。上線前必做。
2. **後台密碼鎖** — 目前誰知道網址都能扣點。
3. **點數效期自動失效** — 效期只有記錄，時間到不會歸零。規則：過期扣除贈送點數與剩餘折價券，課程改以原價計算。要能分辨哪些點數是買的、哪些是送的。
4. **表框折價金不能在核銷時使用** — 存得進去，但核銷的付款方式沒有這個選項。
5. **方案收入沒接進月報與當日營收** — 目前只寫進 `S.planSales`。
6. **加購項目的材料不會扣庫存** — 加購是自由打字，對不到品項。
7. **班表設定還在舊後台**，要搬進主系統。
8. **材料清單建置**（大熊整理中）— 沒建材料表的課程，核銷時不扣料。
9. **LINE Pay 串接** — 卡在 Railway 需 Pro 方案的固定 IP。
10. **夯客舊資料 `ETHAN` 大小寫問題** — 一到五月業績可能未計入，薪資要回頭查。

---

## 六、風格

繁體中文、台灣用語。註解說明「為什麼」而不是「做了什麼」。
不要用「首先、其次、最後」這類連接詞。
提出問題時給具體選項，不要空泛地問「你想怎麼做」。
使用者質疑但沒有提出新證據時，堅持原本立場並說明理由。
