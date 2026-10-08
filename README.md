# 動態預算 V1

React + TypeScript + Vite 前端、Cloudflare Worker API、純 TypeScript 預算 Engine、Google 直接登入與 Supabase PostgreSQL。資金規則以 [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md) 為準，開發順序見 [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md)。

App 版本為 **0.9.0**，以根目錄 `package.json` 的 `version` 為唯一來源。設定頁顯示版本；建置產生 `/version.json` 和 HTML `app-version` metadata，API `/health` 也回傳相同版本。後續功能更新增加次版本、修正增加修訂版本，並同步 App workspace 版本及 [CHANGELOG.md](CHANGELOG.md)。

## 目前可用的範圍

- Google 登入後，首次設定分三步：每月固定收入與選填累積存款、具名固定支出（可月繳或年繳，年繳需選月份）、本期到下次重置前的淨可用預算與每月重置日。每個固定支出分類可新增自訂項目。首期從今天開始分配；固定支出模板從下一個完整週期生效，首次固定存款為 0，累積存款未填為 0、填入時作為生活預算以外的期初存款。
- Worker 驗證 Google ID token 的簽章與受眾，以 Google `sub` 對應本站使用者，再簽發本站 session JWT；前端以 `Authorization: Bearer` 呼叫 API。所有資金命令在單一 PostgreSQL transaction 內處理。`command_id`、使用者列鎖、狀態版本、收據與資金事件流水防止重複及部分寫入。
- Engine 支援開期、每日配額、一般支出 `A → P → F → S`、從累積存款支付、跨日 50/50、期末轉存、額外收入與分期金額拆分。支出超過可用資金仍記完整名義金額，四桶不為負。
- 首期從設定當天開始，到下一個排定週期起始日前一天；首期剩餘金額與 recurring 目標分開保存。已結算期補登只影響目前累積存款，不重播舊週期。
- 導覽為「記帳｜紀錄｜數據｜設定」。紀錄包含月曆、點擊月份標題快速選擇年月、同頁日期篩選、每日入池金額及全部花費降冪分頁；數據包含完整本期分類摘要、分類明細與存款事件。快速記帳為大字金額、七類圖示卡片、用途細項、選填商家及最近商家，次要設定收合，底部儲存配合可視區域。
- 手機首頁顯示今日可用預算、支出及額外收入入口、本期存款池與本月可用預算摘要，以及今天的全部花費。「本月可用預算」沿用本期生活預算總額；「查看歷史紀錄」開啟紀錄頁。交易列含短日期、星期、分類圖示及商家／備註；記帳與紀錄可左滑顯示黃色編輯／紅色刪除，亦支援點擊及鍵盤展開。
- 設定可校正目前累積存款並留調整紀錄；固定支出下方可編輯本月可用預算，首頁同額度亦可點擊。輸入本期預算總額，差額只均分到今天及剩餘日期，存款池／累積存款不變；每日額度不足以減額時整筆拒絕，不影響過去結算或下期模板。固定支出可新增、編輯、停用及恢復，預設下期生效，也可立即套用（增額沿用支出順序，實際退款入存款池，首期只調整新增差額）。分類可改名、排序、停用及恢復，舊交易保留原名。外觀有系統／淺色／深色與三種主題色。
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

在專案根目錄安裝依賴（`npm install`）後，可執行以下指令：

| 指令 | 用途 |
| --- | --- |
| `npm test` | 執行 Domain、API 與 Web 的自動化測試。 |
| `npm run typecheck` | 檢查 TypeScript 型別是否正確。 |
| `npm run build` | 建置 Domain、API 與 Web，確認專案可正常編譯。 |
| `npm run release:check` | 檢查正式站前端、API 版本與部署資產等發布狀態；需可連線正式環境。 |

建議先執行測試、型別檢查與建置；部署後再執行發布檢查。

## 版本更新

目前版本：**v0.9.0**。各版本功能變更、修正項目及測試／部署紀錄，請參閱 [CHANGELOG.md](CHANGELOG.md)。
