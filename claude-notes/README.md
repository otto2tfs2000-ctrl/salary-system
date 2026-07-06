# Otto2 ARTCLUB 每日登記系統 — 架構說明（給 Claude 的小抄）

> 改功能之前先讀這份，就不用整包程式碼全部讀進來。

## 系統是什麼

美術教室的營運後台，單頁應用（無框架、純 vanilla JS），資料存 Firebase Realtime Database。
涵蓋兩間店：**旗艦（4F 成人）** 與 **國圖**。功能分四大塊：每日登記／薪資、耗材記帳、庫存盤點、老師設定。

## 檔案分工（要改什麼就只讀那個檔）

| 檔案 | 內容 | 大小 |
|---|---|---|
| `index.html` | 純 HTML 骨架：所有 tab 的畫面結構、表格容器、Modal | 22 KB |
| `styles.css` | 全部樣式 | 8 KB |
| `app.js` | Firebase 初始化與同步、月份切換、tab 密碼鎖、**每日登記**、**月報彙整**、**薪資計算**、老師設定、Excel 下載 | 97 KB |
| `consumables.js` | **耗材記帳**：四店分類（四樓/二樓/國圖/總部）、零用金結餘、購買人彙整對帳、AI 照片辨識耗材 | 47 KB |
| `inventory.js` | **庫存盤點**：週期 key（以週一為代表）、品項管理、進貨登記、拖移排序、建議訂購量、統計警示、Claude 影像辨識、OCR 備援 | 89 KB |
| `init.js` | 啟動流程：`renderAll()` + `initMonth()` + `loadData()`（DOMContentLoaded 後延遲 300ms） | 1 KB |
| `images/` | 54 張顏料罐照片 `paint-01.jpg` ~ `paint-54.jpg`（原本是 base64 塞在 HTML 裡） | 823 KB |

載入順序固定：`app.js → consumables.js → inventory.js → init.js`，全域共用 scope，不能亂調。

## 關鍵常數與規則

- `BOSS_PWD = 'Otto212707656'`（薪資/設定 tab 解鎖密碼，定義在 app.js 開頭）
- `SALES_YEAR = 2026`
- Firebase 用 compat SDK（10.12.2），realtime database
- 薪資規則複雜（大熊 = 人數÷2×50；蓁蓁/米雪 = 超過 20 人門檻×50；米妮特殊公式；國圖有米雪/米妮代課的總部/店端拆帳）——全部在 app.js 的 Salary 區塊
- 耗材 Excel 匯出格式 = 美林藝術文創零用金表單

## 圖片處理注意事項（拆檔後的行為差異）

1. `inventory.js` 裡的 `PAINT_JAR_PHOTOS` 和一次性批次匯入，原本存 base64，現在存相對路徑 `images/paint-XX.jpg`。
2. **Firebase 裡既有的品項圖片仍是 base64**（之前套用過的），照常顯示，不受影響。
3. 如果**重新執行** `applyPaintJarPhotos()` 或批次匯入，Firebase 會改存路徑字串 → 圖片要正常顯示，網站必須連同 `images/` 資料夾一起部署（GitHub Pages / Netlify 都沒問題），**直接雙擊本機 index.html 也能顯示**（相對路徑）。
4. 使用者自己上傳的品項照片仍走 base64 存 Firebase，那是另一條路，沒改。

## 改功能的最短路徑

- 改薪資公式、每日登記欄位、月報 → 只讀 `app.js`（必要時搭 `index.html` 對應區塊）
- 改耗材匯出、零用金、購買人 → 只讀 `consumables.js`
- 改盤點、進貨、品項、警示 → 只讀 `inventory.js`
- 改畫面樣式 → `styles.css`
- 加新 tab 或改版面結構 → `index.html` + 對應的 js
