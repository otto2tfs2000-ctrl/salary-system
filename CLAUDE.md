# Otto2 系統開發交接（2026-08-11）

給接手的人：這份是 2026-08-09 到 08-11 的開發紀錄。
最重要的是「踩過的坑」那一節，那幾個錯誤浪費了整整幾個小時。

---

## 一、系統長什麼樣

三個 GitHub 倉庫，一個 Railway 服務，資料在 Firebase 和 Google 試算表。

| 倉庫 | 用途 | 上線位置 |
|---|---|---|
| `salary-system` | **後台**（老師與行政用）。index.html 只是外殼，功能都在那十支 .js | GitHub Pages |
| `otto2artclub-booking` | **客人端預約頁**。整支程式都在 `index.html` 裡 | GitHub Pages |
| `otto2-notify` | **Railway 後端**。LINE 推播、行事曆資料、客人端讀取端點 | Railway 自動部署 |

**Railway 服務網址**
`https://otto2-notify-production.up.railway.app`
改完 server.js 一定要打 `/health` 確認 `version` 變成新的，才算真的部署上去。

**Firebase**
- `otto2-booking-f9ef7`：members（會員、明細、票券）、bookings（預約）、schedule（班表）、lineIndex、liffProfiles
  - `https://otto2-booking-f9ef7-default-rtdb.asia-southeast1.firebasedatabase.app`
- `otto2-2026`：salaryData（薪資、業績、方案設定、庫存、用料）、deductions

**Google 試算表**（課程、班表、方案、加購都在這裡，老闆自己維護）
ID `1QjiDwmPcwbmdhmNv9cz1A6veC_BbC75m1VJG85P3Q6M`

分頁與欄位：
- **課程**：A 分類／B 課程名稱／C 說明／D 規格／E 時長／F 價格／G 圖片網址／H 上架／I 排序／J 最小年齡／K 可加堂／L 可加購／**M 佔位**／**N 計時**
  - 前 11 欄照位置讀（不可插欄），M、N 之後的新欄位照標題找
  - 佔位：填 3 代表一組佔 3 個名額（地毯課）
  - 計時：填 700 代表每小時 700，客人自選 2–4 小時
- **加購**：課程名稱／加購名稱／價格／排序。客人端會自動顯示可複選的加購
- **舊方案單價**（可能還沒建）：票券名稱／總價／堂數／效期月數／生效日起／單堂價／備註

**LIFF**
LIFF ID `2010906803-FMDYktUN`，網址 `https://liff.line.me/2010906803-FMDYktUN`
LINE 圖文選單已經指向這個網址（08-09 修正）。

---

## 二、踩過的坑（最重要，請先看這節）

### 1. 改錯檔案，三輪工作白做
`otto2artclub-booking` 裡有 `index.html` 和 `liff-index.html` 兩支。
**GitHub Pages 服務的是 `index.html`**，但連續三輪都在改 `liff-index.html`，
客人端從頭到尾沒生效，中間還測了好幾次都以為是別的問題。

- `liff-index.html` 已經沒用了，**建議直接刪掉**（`salary-system` 裡也有一份舊的，一起刪）
- 動客人端之前，先確認 GitHub Pages 到底服務哪一支

### 2. 版本號沒跳，等於沒上線
`salary-system/index.html` 裡每支 .js 後面都有 `?v=日期`。
**改了 .js 就一定要跳版本號**，不然瀏覽器讀快取的舊檔。
曾經整晚四支檔案的版本號都沒跳，開發者硬重整看得到新功能，
其他同事開後台讀到的全是舊版。

### 3. 拿舊檔改，差點洗掉別人的工作
曾經拿使用者手上的舊 `server.js` 疊修改，
差點把當天早上做好的 `/staff/list` 整段洗掉。
**動任何檔案前，先確認手上這份是不是線上正在跑的那份。**
server.js 可以用 `/health` 的 `version` 比對。

### 4. gviz 的標題列不在資料裡
`liff-index.html` 用 `j.table.rows`，Google **已經把標題列抽到 `j.table.cols`**，
所以 `rows[0]` 是第一筆資料不是標題。
`booking.js` 則是自己 `rows.shift()` 砍標題。兩支行為不同，照抄會出錯。

### 5. 客人端有 localStorage 快取
`SHEET_CACHE_KEY`（目前 `otto2_liff_sheets_v3`）。
改了解析邏輯要把這個鍵往下跳，否則所有客人讀的還是舊格式的暫存。

---

## 三、這三天完成的事

### 後端 `server.js`（現行版本 `2026-08-10-multislot`）
`/health` 應該回傳這五個旗標，缺一個就代表部署有問題：
`hasStaffList` `hasLiffRead` `hasCalendarFeed` `hasSeats`（外加 version）

新增的端點：
- `/notify/plan` — 賣方案後推 LINE 卡片（方案內容、點數拆三行、到期日、目前餘額）
- `/liff/me`、`/liff/slots`、`/liff/member`、`/liff/ledger` — **客人端改走這裡，不再直讀 Firebase**
- `/cron/bookings` — 給 Google Apps Script 同步行事曆用（CRON_KEY 保護）

`/liff/slots` 的名額計算已支援：`seats`（佔位）、`slots[]`（多時段）、`slot2`（連堂）、跳過 cancelled/expired。

### 客人端 `otto2artclub-booking/index.html`（v4.8a）
- 五處直讀 Firebase 全部改走 Railway（原本 `/bookings.json` 公開可讀，含所有客人姓名電話）
- 晚上時段 18:30–21:00（班表有排才出現）
- 佔位（地毯一組佔 3 位）與計時課（每小時 700、2–4 小時）
- 連堂不跨越白天／晚上的斷點

### 後台 `salary-system`
**booking.js（`20260810i`）**
- 班表可逐日加開晚上時段，晚上老師數獨立算容量
- 手動登記時段**可複選**（畫一整天選三格），存 `slots[]`，同時保留 `slot`/`slot2` 相容
- 課程下拉依分類分組，顯示價格
- 核銷可以改課程項目、可以改扣堂數
- **修了會賠錢的 bug**：扣堂數原本寫死 1，兩個人堂數扣抵只扣一堂、只認列一堂營收
- 老師可複選（`teachers[]` 陣列，同時存頓號字串相容）
- 舊方案單價改從試算表讀，第三順位用堂數比對「方案設定」
- 日期標題可點開整月月曆，每天顯示幾組幾位

**member.js（`20260809h`）** — 明細單筆可編輯、來源標記、票券匯入、賣方案 LINE 通知、新舊客手動切換
**app.js（`20260810a`）** — 每日登記認得多老師，人次按老師數平分
**inventory.js（`20260809a`）** — 品項多了「售價」欄（跟成本分開）
**recipe.js（`20260811a`）** — 材料清單自然排序（2F 排在 10F 前面），分類順序跟著庫存盤點的拖曳順序

### Google Apps Script（專案名「Otto2 上課提醒」）
兩支函式，都設了觸發器：
- `remind()` — 每天早上 9–10 點推前一日上課提醒
- `syncCalendar()` — 每小時同步預約到「Otto2 預約」行事曆（活動說明裡的 `[otto2:預約編號]` 是同步依據，不可刪）

---

## 四、還沒收尾的事（按急迫度）

### 高
1. **「儲存失敗（本機備份）」紅字沒查**
   `salaryData` 沒寫進 Firebase，只留在瀏覽器。會員餘額有進雲端、業績只在本機，
   **兩邊會靜默對不起來**。要在 Console 看實際錯誤訊息（大概是 PERMISSION_DENIED）。

2. **27 筆手機格式壞掉的會員**，身上掛著約四萬儲值金。
   LIFF 是用電話當 key 寫 `lineUserId` 的，格式不一致會寫到別的節點。

3. **鎖 Firebase `.read`**
   客人端已經不直讀了，`bookings` 和 `members` 的 `.read` 可以關掉。
   關之前確認：預約頁能看名額、我的點數頁能看餘額與使用紀錄。
   `schedule` 沒有個資可以留著。

### 中
4. **賣方案沒記業務人員**：`planSales` 缺 `by` 欄位，月報算不出業績歸屬。
   要加「業務」下拉（預設登入者、可改）。
   **卡在一個決策**：會館流水帳系統是把賣方案當月營收，還是逐次認列？
   兩邊都當營收就會重複計算。老闆要跟行政確認。

5. **多人堂數扣抵的舊核銷要補正**：`useSe` 修好之前，
   凡是「付款方式＝堂數扣抵」且「人數 > 1」的核銷都少扣了堂數、少認了營收。
   重新核銷會自動沖銷再寫入。要先查出清單。

6. **32 筆票券沒有單價**、63 筆票券備註還沒匯入。
   單價現在可以自己在「舊方案單價」分頁補，不用改程式。

7. **地毯課的用料**：合併成同一門課之後，加購（例如加背景）的材料不會被扣。
   庫存會慢慢失準。

8. **庫存幾乎全部沒填單位成本**，所以用料成本、毛利率整片是空的。

### 低
9. 客人端開頁面有一到三秒空白（gviz 抓課程資料，第一次進來沒快取）
10. 邱宗洲、劉芷蕎的測試點數要歸零（用「調整餘額」補反向，不要刪明細）
11. 八月資料補登

---

## 五、老闆的工作習慣

- **一次做一件事，做完確認再下一件。** 不要一次丟三個改動。
- **要完整檔案，不要 diff。** 他是下載檔案手動上傳 GitHub（現在要改用 Code 直接改）
- 直接、講重點，不要客套。專業術語要翻成白話。
- **他質疑你的時候，如果沒有提出新證據或新邏輯，不要改口。** 說明理由並堅持。
- 講「好了」通常是指上一步做完了，但不一定驗證過——**要主動要求他確認具體的畫面或數字**。

---

## 六、接手後的第一件事

先跑一次現況檢查，不要直接開始改：

1. 開 `https://otto2-notify-production.up.railway.app/health`，確認五個旗標都在
2. 確認 `otto2artclub-booking/index.html` 是不是 v4.8a（右上角有版本標記）
3. 確認 `salary-system/index.html` 裡每支 .js 的版本號跟檔案更新時間對得上
4. 問老闆「儲存失敗」那個紅字還在不在

第 4 點是目前最該處理的，因為它會讓帳目靜默地對不起來。

---

## 七、這份文件取代舊版

這份是 2026-08-11 的最新狀態，**取代先前那份 CLAUDE.md**。
如果你讀到的資訊跟這份衝突，以這份為準。特別是這三點常被搞錯：

- `otto2artclub-booking/liff-index.html` **不是 index.html 的複本**，
  它停留在舊版且已廢棄，客人端讀的是 `index.html`。建議刪除。
- `otto2-notify/server.js` **有二十幾個端點**，不是三個。
  完整清單以檔案內容為準，不要照 README 判斷。
- 使用者手上的 ZIP 可能不是最新的。動任何檔案前，
  先用 `/health` 的 version 或 GitHub 的更新時間確認。
