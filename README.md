# 臺科大機器人研究社 社團網站 - 智慧 IoT 整合與自動化管理系統

本專案為臺科大機器人研究社 (Robot Researchers Club) 社團網站的擴充作業，基於原有的 ntust_robot_researchers_website 儲存庫進行二次開發。

本系統旨在社團原有網站行政功能的基礎上，深度整合物聯網 (IoT) 邊緣硬體節點，透過 ESP32 聯網硬體與 Next.js BFF 中介層、Google Sheets 資料庫進行雙向互動，實現無人化自主器材借還、LED 燈光視覺導引、語音語意尋物與 RFID 快照庫存盤點，建構完整的社團智慧空間自動化解決方案。

---

## 專案結構

本儲存庫包含以下主要部分：

```
ntust_rrc_website_IoT/
├── frontend/          # Next.js 16 前端應用程式 (BFF 代理與 IoT API)
├── gas-backend/       # Google Apps Script 後端代碼 (由 clasp 管理)
├── docs/
│   ├── detail.md      # 原系統詳細設計文檔
│   └── IoT_detail.md  # 智慧 IoT 整合與擴充實作細則文檔
├── README_IoT         # IoT 硬體規格與自動化節點架構書
├── .clasp.json        # clasp 設定檔 (GAS 後端部署用)
├── .gitignore
├── LICENSE            # MIT License
├── NOTICE.md          # 第三方套件授權聲明
└── README.md          # 本說明文件
```

關於 IoT 節點的完整設計細節與 API 規範，請參閱 [docs/IoT_detail.md](docs/IoT_detail.md)。
關於前端開發說明與安裝步驟，請參閱 [frontend/README.md](frontend/README.md)。

---

## 作業目標與 IoT 節點架構

本專案引進三個高度解耦的實體 ESP32 硬體節點，與社團網站進行串接：

### 1. 語音尋物與多媒體互動站 (ESP32 #1)
*   **硬體配置：** ESP32 + INMP441 (I2S 麥克風) + MAX98357A (I2S 音訊放大器) + 小喇叭 + WS2812B LED 燈條
*   **功能描述：** 採集使用者語音搜尋請求，經 Next.js BFF 調度 OpenAI Whisper 進行中文語音識別 (STT)，與資料庫模糊比對出位置後，使用 OpenAI TTS 合成語音引導串流回傳給硬體播放，並透過指定 GPIO 點亮對應位置的 LED 指示燈。

### 2. 邊緣庫存狀態感測站 (ESP32 #2)
*   **硬體配置：** ESP32 + RC522 (RFID 讀卡機群，共用 SPI 匯流排，CS 獨立輪詢)
*   **功能描述：** 高頻率輪詢實體櫃位上的 RFID 卡片狀態。於邊緣端實現狀態差分比對 (State Diff) 與去抖動驗證，僅在狀態發生變動時，打 API 將新狀態同步更新至試算表資料庫中，極小化雲端請求頻率。

### 3. 身分授權與視覺終端 (ESP32-S3 WROOM)
*   **硬體配置：** ESP32-S3 + OV2640 鏡頭 + I2C OLED 顯示器 + 實體按鈕
*   **功能描述：** 使用者按下按鈕後開啟鏡頭掃描系統生成的 QR Code 憑證。驗證成功後，解析並於 OLED 渲染呈現借用人姓名與器材明細。使用者按下實體按鈕確認領取後，打 API 更新借用狀態，並觸發系統信件發送。

---

## 技術架構

本專案無縫擴充了原本 ntust_robot_researchers_website 的技術架構：

### 邊緣硬體與通訊
*   **核心晶片：** ESP32 / ESP32-S3 WROOM
*   **語言與環境：** C++ (Arduino IDE / PlatformIO)
*   **通訊協定：** HTTPS Client (對外主動請求 Vercel BFF 端點)
*   **硬體週邊：** I2S 音訊驅動、SPI 總線輪詢、I2C 顯示屏控制、OV2640 圖像識別

### 前端 BFF (Vercel)
*   **框架：** Next.js 16 (App Router) / TypeScript
*   **AI 整合：** OpenAI Whisper (STT) + OpenAI TTS 語音合成
*   **安全防護：** API Header Bearer Token 驗證機制 (防篡改)

### 後端與資料庫 (Google Apps Script)
*   **後端服務：** Google Apps Script Web App / 統一 Controller-Service-Repository 架構
*   **資料儲存：** Google Sheets 試算表關聯式資料庫 (新增 BoxList 箱子總表、CabinetLayout 櫃位映射表)
*   **併發防護：** 寫入操作強制使用 LockService 避免庫存衝突

---

## 網站原版核心功能 (繼承自 ntust_robot_researchers_website)

本專案保留並完全相容於原有的社團行政模組：

*   **用戶認證與授權：** 基於 JWT 與 HttpOnly cookie 的學號註冊登入系統。
*   **器材租借系統：** 線上器材瀏覽、多筆購物車申請、審核狀態追蹤、盤點與歷史記錄。
*   **機器使用申請：** 3D 列印機與雷射切割機的線上預約排程與切片截圖上傳。
*   **財務報帳系統：** 報帳費用明細編輯、Google Drive 發票與憑證上傳、管理員多級審核撥款流程。
*   **公告與課程系統：** 公告管理、學期課程講義下載與權限分級錄影瀏覽。
*   **管理員儀表板：** 完整的後台介面，用於審核所有申請、調整用戶角色與執行盤點。

---

## 快速開始

### 前端與 BFF 執行
1. 進入前端目錄：`cd frontend`
2. 安裝套件：`npm install --legacy-peer-deps`
3. 配置 `.env.local` 環境變數 (需包含 `NEXT_PUBLIC_GAS_API_URL` 與 `OPENAI_API_KEY`)
4. 啟動開發伺服器：`npm run dev`

### 後端 GAS 部署
1. 安裝 clasp：`npm install -g @google/clasp`
2. 登入 Google 帳號：`clasp login`
3. 修改 `gas-backend/Config.js` 中對應的試算表 ID。
4. 推送代碼至 Google Apps Script：`clasp push`
5. 在 Apps Script 介面中將其部署為 Web 應用程式 (Web App)，並將生成的網址配置於前端環境變數中。

---

## 授權聲明

本專案採用 MIT License，詳細內容請參閱 [LICENSE](LICENSE) 文件。
原儲存庫 ntust_robot_researchers_website 及其第三方元件授權聲明請參閱 [NOTICE.md](NOTICE.md) 文件。
