# 動態預算 V1

React + TypeScript + Vite 前端、Cloudflare Worker API、純 TypeScript 預算 Engine、Google 直接登入與 Supabase PostgreSQL。資金規則以 [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) 為準，開發順序見 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)。

App 版本為 **0.7.0**，以根目錄 `package.json` 的 `version` 為唯一來源。設定頁顯示版本；建置產生 `/version.json` 和 HTML `app-version` metadata，API `/health` 也回傳相同版本。後續功能更新增加次版本、修正增加修訂版本，並同步 App workspace 版本及 [CHANGELOG.md](CHANGELOG.md)。

## 目前可用的範圍

- Google 登入後，首次設定分三步：每月固定收入與選填累積存款、具名固定支出（可月繳或年繳，年繳需選月份）、本期到下次重置前的淨可用預算與每月重置日。每個固定支出分類可新增自訂項目。首期從今天開始分配；固定支出模板從下一個完整週期生效，首次固定存款為 0，累積存款未填為 0、填入時作為生活預算以外的期初存款。
- Worker 驗證 Google ID token 的簽章與受眾，以 Google `sub` 對應本站使用者，再簽發本站 session JWT；前端以 `Authorization: Bearer` 呼叫 API。所有資金命令在單一 PostgreSQL transaction 內處理。`command_id`、使用者列鎖、狀態版本、收據與資金事件流水防止重複及部分寫入。
- Engine 支援開期、每日配額、一般支出 `A → P → F → S`、從累積存款支付、跨日 50/50、期末轉存、額外收入與分期金額拆分。支出超過可用資金仍記完整名義金額，四桶不為負。
- 首期從設定當天開始，到下一個排定週期起始日前一天；首期剩餘金額與 recurring 目標分開保存。已結算期補登只影響目前累積存款，不重播舊週期。
- 導覽為「記帳｜紀錄｜數據｜設定」。紀錄包含月曆、同頁日期篩選、每日入池金額及全部花費降冪分頁；數據包含完整本期分類摘要、分類明細與存款事件。快速記帳為大字金額、七類圖示卡片、用途細項、選填商家及最近商家，次要設定收合，底部儲存配合可視區域。
- 手機首頁顯示今日可用預算、支出及額外收入入口、兩欄存款摘要與今天的全部花費。交易列含短日期、星期、分類圖示及商家／備註；記帳與紀錄可左滑顯示黃色編輯／紅色刪除，亦支援點擊及鍵盤展開。
- 設定可校正目前累積存款並留調整紀錄；固定支出可新增、編輯、停用及恢復，預設下期生效，也可立即套用（增額沿用支出順序，實際退款入存款池，首期只調整新增差額）。分類可改名、排序、停用及恢復，舊交易保留原名。外觀有系統／淺色／深色與三種主題色。
- 日常與固定分類獨立管理，分類及用途細項支援新增、改名、排序、隱藏與恢復；歷史名稱與關聯保留。快速記帳可從細項「其他」後方的「＋」直接新增目前分類的細項，成功後自動選取並保留支出草稿。商家 `description` 與真正備註 `note` 分開。
- 分期已接通建立與後續認列：餘額在第一期，2–60 期，只使用生活預算與本期日期。第一期立即套用，後續開期預留並認列一次，按各期金額統計。
- 固定收入可在固定支出上方編輯每月金額，預設下期生效，也可立即套用本期差額。首次淨預算與月收入基準分開，避免重複加入收入；固定存款模板編輯及完整對帳仍屬後續里程碑。

## 本機設定

1. `npm install`
2. 在 Google Cloud 建立「網頁應用程式」OAuth Client ID。將 `http://127.0.0.1:5173` 加入「已授權的 JavaScript 來源」，正式站上線時再加入其 HTTPS origin。本站使用 Google Identity Services 的 JavaScript callback，**不使用重新導向 URI，也不需 Supabase Google provider 或 Client Secret**。
3. 在 Supabase 建立 PostgreSQL 專案。使用 `npx supabase login`、`npx supabase link --project-ref <project-ref>`、`npx supabase db push --dry-run` 預覽，再執行 `npx supabase db push` 依序套用 `supabase/migrations` 的七版 migration（最新 `202610080003`）。不要直接在遠端 SQL Editor 貼上 migration，以免略過 CLI 的 migration 歷史。
4. 複製 `apps/web/.env.example` 為 `apps/web/.env.local`，填入 Worker API URL。前端不需要 Supabase URL／publishable key，也不能放資料庫密碼、session 簽章密鑰或 Hyperdrive 憑證。
5. 複製 `apps/api/.dev.vars.example` 為 `apps/api/.dev.vars`，填入 Google Web Client ID、至少 32 bytes 的隨機 `APP_JWT_SECRET`、允許的前端 origin 及 `DATABASE_URL`。本機連線比照運動紀錄，使用 Supabase **Connect → Session pooler** 的 URI（shared pooler、port 5432）；將資料庫密碼填入 URI，特殊字元須做百分比編碼。正式 Worker 仍透過 Hyperdrive 連到 Supabase PostgreSQL。
6. 執行 `npm run db:check -w @budget/api` 檢查本機 Session pooler 連線；只顯示結果或錯誤碼，不顯示連線字串或密碼。確認成功後執行 `npm run dev -w @budget/api` 與 `npm run dev -w @budget/web`。本機前端與 API 都使用 `127.0.0.1`；`FRONTEND_ORIGIN` 必須與實際前端網址相符。

## Cloudflare 部署設定

- Pages：使用 Direct Upload 專案 `dynamic-budget-web`（預覽網址 `https://dynamic-budget-web.pages.dev`），從本機以 `VITE_API_URL=https://api.td.etontw.com` 建置 domain 與 web，再執行 `npx wrangler pages deploy apps/web/dist --project-name dynamic-budget-web --branch main`。`td.etontw.com` 已加入 Pages Custom domains；Cloudflare DNS 的 `td` CNAME 指向 `dynamic-budget-web.pages.dev`，正式網址 `https://td.etontw.com` 已回傳 HTTP 200。前端將本站 session JWT 保存在 `localStorage`，跨網域呼叫 API 時以 Bearer header 傳送。
- Worker：`wrangler.production.jsonc` 使用 Wrangler `custom_domain` 設定 `api.td.etontw.com`；`FRONTEND_ORIGIN=https://td.etontw.com` 與公開的 `GOOGLE_CLIENT_ID` 已寫在此檔，`keep_vars` 保留在 Dashboard 新增的公開變數。記帳專用 Hyperdrive `dynamic-budget-db` 已建立、關閉快取並綁定；Worker 已部署，`https://api.td.etontw.com/health` 回傳 HTTP 200。正式 Worker 已建立獨立隨機 `APP_JWT_SECRET` secret。`nodejs_compat` 已啟用。本機 `wrangler.jsonc` 不綁定 Hyperdrive，使用 `.dev.vars` 中的 `DATABASE_URL`。
- 在 Google Cloud 將 `https://td.etontw.com` 加入 OAuth Client ID 的「已授權的 JavaScript 來源」。部署前為 `/v1/auth/google` 設定 Cloudflare rate limiting，並以真實 Google 帳號驗證 ID token、Bearer session、RLS、重試、並發與資料庫回滾。Supabase Auth 的 Site URL、redirect allowlist 與 Google provider 不參與本站登入。

## 檢查

```text
npm test
npm run typecheck
npm run build
npm run release:check
```

**v0.3.0 已於 2026-10-08 部署至正式站。** 快速記帳、分類／細項、獨立商家、最近商家、其他設定收合及完整分期已實作。分期餘額放第一期（10,000／3 → 3,334、3,333、3,333），後續按收入週期預留並認列，避免雙重扣款。v0.2.2 本月固定支出總額及 v0.2.1 視窗置中修正保留。

`202610080001_quick_expenses.sql` 已通過空資料庫及舊資料的隔離 PostgreSQL 測試，並套用正式資料庫；五版遠端 migration 紀錄已核對一致。既有交易的細項和商家為 null、分類名稱與 ID 保留，資金狀態不變；原正式資料庫沒有分期計畫。Worker 和 Pages 已依序更新，前端使用正式 `VITE_API_URL=https://api.td.etontw.com` 建置。

`npm run release:check` 已確認 `td.etontw.com` 與 `api.td.etontw.com/health` 回傳 200、版本均為 0.3.0、正式 JS／CSS 的 SHA-256 與本次建置一致、CORS 預檢 204，匿名摘要請求 401。Pages deployment 為 `91366d22`，Worker version ID 為 `1c39b274-8ead-4450-8b39-9b0418804b09`。

v0.3.0 發布時 55 項自動測試通過（24 Domain、29 API／認證／PostgreSQL、2 Web 元件），完整型別檢查與建置通過。Playwright 使用 iPhone WebKit 與隔離交易資料走完「150 → 餐飲 → 午餐 → 最近使用全家 → 儲存」；驗證細項切換清除、商家／細項／備註選填、零元拒絕、分期預覽、失敗草稿與同 ID 重試、雙層管理、深色模式，以及 320×568、402×390、1440×900 的視窗和底部操作。iOS 實機 PWA 的系統鍵盤仍需裝置驗證；目前以 numeric input、明確焦點、visualViewport、捲動及 safe area 處理。瀏覽器測試沒有讀寫正式帳戶；正式資料庫角色／並發測試與其餘 V1 里程碑仍待完成。

**v0.4.0 已於 2026-10-08 部署至正式站。** 單筆支出（含分期總額）最多 10 位數，上限 9,999,999,999 元；輸入、表單及 API 一致驗證。記帳與紀錄每筆可編輯／確認刪除，包含收入；紀錄可切換花費與收入。更正僅影響目前資金，刪除軟隱藏並保留原交易與前後快照，報表與最近商家排除已刪除交易。資金來源或收入週期改動會先撤回原實際影響再重新套用，舊結算不重播；分期只修改所選期，刪除可勾選取消尚未入帳期數。

第六版 `202610080002_transaction_corrections.sql` 已通過空資料庫及舊資料測試並正式套用，六版遠端 migration 一致。74 項測試（30 Domain、40 API／認證／PostgreSQL、4 Web）、型別與建置通過。Playwright WebKit 以手機尺寸驗證十位鍵入／貼上、窄螢幕完整金額、既有欄位帶入、支出與收入在兩頁編輯／刪除、來源／日期切換、取消確認、失敗同 ID 重試，以及單期修改／取消未入帳期數。瀏覽器使用隔離 fixtures，資金規則另由真實 PostgreSQL 執行整合測試；未在正式帳戶寫入測試交易。

正式檢查確認前端與 API 均為 0.4.0、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `4cadf6c2`，Worker version ID 為 `2c8c37be-3476-4231-9c30-bebbce5df23d`。

**v0.4.1 已於 2026-10-08 部署至正式站。** 本日交易與數據明細的手機日期獨立一行，與項目增加留白；桌面日期欄距增加至 24px。長金額在手機交易列及數據總額換行，避免超出畫面。Playwright WebKit 以隔離資料驗證 320px、393px、1440px 與深色模式，包含既有超長金額；本次僅修改樣式及版本資訊，建置通過，無資料庫 migration。

正式檢查確認前端與 API 均為 0.4.1、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `76e10a38`，Worker version ID 為 `6754ab21-3afe-46dc-8cac-30c69d061391`。

**v0.5.0 已於 2026-10-08 部署至正式站。** 設定的固定支出上方加入固定收入編輯，可選下期或立即生效；首次使用可選填生活預算以外的累積存款，未填為 0。收入基準與首期淨預算分開凍結，立即套用只處理差額，避免模板變更後重複計入月薪。生活支出退款依原帳務日期：當日回每日預算、本期其他日期回存款池、已結算期回現在的累積存款；存款支付仍只退累積存款，未實扣部分不退款。

第七版 `202610080003_fixed_income.sql` 已驗證舊資料升級不改資金並正式套用，七版 migration 一致。92 項測試（35 Domain、51 API／認證／PostgreSQL、6 Web）、完整型別與建置通過。Playwright WebKit 以 393px 與 320px 實測首次填入／略過存款、固定收入下期及立即生效、失敗同 ID 重試、當日／本期舊日期／已結算期的編輯刪除，以及存款來源退款與深色窄螢幕。瀏覽器資料使用打包的純 Domain Engine 計算，SQL 原子保存另由隔離 PostgreSQL 整合測試驗證；未在正式帳戶建立測試交易。

正式版本與資產檢查均通過：前端與 API 為 0.5.0、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `0638dd15`，Worker version ID 為 `04256069-2544-48bd-b585-7137049c4cbe`。

**v0.5.1 已於 2026-10-08 部署至正式站。** 手機 PWA 使用固定頁框與獨立內容捲動區，底部導覽不隨頁面移動；以標準 standalone 媒體查詢及 iPhone 主畫面模式辨識啟用。彈窗開啟時鎖住背景、關閉後保留位置，並處理安全區與觸控裝置橫向版面。

6 項前端測試與完整建置通過。WebKit 以隔離資料模擬 iPhone standalone，檢查 393×852、320×568、852×393 四分頁的頂底位置、導覽可操作性、彈窗背景鎖定與短視窗儲存；一般瀏覽器、標準 standalone 辨識、首次設定及登出解除鎖定亦通過。本次無資料庫 migration；瀏覽器模擬不等同實體 iPhone 的回彈手勢測試。

正式版本與資產檢查均通過：前端與 API 為 0.5.1、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `2c24a94d`，Worker version ID 為 `6a777af2-121b-4c65-a76f-151742f9ead9`。

**v0.6.0 已於 2026-10-08 部署至正式站。** 手機首頁依參考圖重新安排日期、可用金額、支出按鈕與兩欄存款摘要，額外收入按鈕保留在主按鈕下方。首頁只顯示今天的全部花費；交易列增加星期、分類圖示與商家／備註。記帳及紀錄左滑顯示黃色編輯與紅色刪除，操作沿用既有視窗與確認；右滑、捲動及其他列操作收起，沒有全滑直接刪除。

14 項前端測試、型別與完整建置通過。WebKit 以 iPhone standalone 隔離資料驗證左／右滑、垂直捲動、單列展開、鍵盤操作、編輯與刪除取消、分組與指定日期紀錄，以及額外收入入口開啟／取消；320／393／1280px 的 10 位數及舊超長金額無橫向溢位或欄位重疊。本次無資料庫 migration，未在正式帳戶寫入測試交易；實體 iOS 觸控與 VoiceOver 尚需裝置驗證。

正式版本與資產檢查均通過：前端與 API 為 0.6.0、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `d65209de`，Worker version ID 為 `619e0597-befc-4f9f-983d-0a602fe974e7`。

**v0.6.1 已於 2026-10-08 部署至正式站。** 移除頂部成功操作提示及其狀態、樣式，新增／修改／刪除後仍刷新資料並關閉視窗；失敗與資料刷新錯誤提示保留。14 項前端測試與完整建置通過，WebKit iPhone 隔離流程確認新增、刪除後清單更新且無成功 banner，模擬儲存失敗仍顯示錯誤並保留表單。本次無資料庫 migration。

正式版本與資產檢查均通過：前端與 API 為 0.6.1、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `7732985b`，Worker version ID 為 `bed6e423-6147-41f9-88b1-16a08b4018a7`。

**v0.6.2 已於 2026-10-08 部署至正式站。** 設定的「新增固定支出」與起始設定共用分類及常見項目選單，每個分類都可新增自訂項目。選擇後帶入名稱與分類，月繳／年繳、生效時間與既有編輯／停用流程保留；取消新增返回選單，儲存成功返回清單。100 項測試（35 Domain、51 API、14 Web）、完整型別與正式建置通過。Chromium 隔離資料驗證選單一致、預設及自訂年繳、失敗同 ID 重試、起始設定新增／修改／移除，以及 320／390px 與深色模式。本次無資料庫 migration。

正式版本與資產檢查均通過：前端與 API 為 0.6.2、HTTP 200、JS／CSS SHA-256 一致、CORS 預檢 204、匿名摘要 401。Pages deployment 為 `8aed0966`，Worker version ID 為 `3f15d1de-4c94-48f3-bc16-0f5f3e925c3d`。
