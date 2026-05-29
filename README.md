# 臺科大機器人研究社 社團網站

歡迎來到臺科大機器人研究社 (Robot Researchers Club) 的社團網站專案。
本系統旨在協助社團管理器材租借、財務報帳、機器使用申請、競賽意願調查等日常行政事務，並且提供宣傳平台。

## 專案結構

本儲存庫包含以下主要部分：

```
ntust_rrc_website/
├── frontend/          # Next.js 16 前端應用程式
├── gas-backend/       # Google Apps Script 後端代碼 (由 clasp 管理)
├── .clasp.json        # clasp 設定檔（GAS 部署用）
├── .gitignore
├── LICENSE            # MIT License
├── NOTICE.md          # 第三方套件授權聲明
└── README.md
```

詳細的前端開發說明與安裝步驟，請參閱 [前端目錄說明](frontend/README.md)。

## 技術架構

### 前端技術棧

| 分類      | 技術                        |
| --------- | --------------------------- |
| 框架      | Next.js 16.1.6 (App Router) |
| 語言      | TypeScript                  |
| 打包器    | Turbopack                   |
| 樣式      | Tailwind CSS 4 + PostCSS    |
| UI 元件庫 | Shadcn/UI (Radix UI)        |
| 狀態管理  | Zustand                     |
| 表單      | React Hook Form + Zod       |
| API 請求  | TanStack Query + Axios      |
| 通知      | Sonner                      |
| 日期處理  | date-fns                    |
| 輪播      | Embla Carousel              |

### 後端技術棧

| 分類     | 技術                          |
| -------- | ----------------------------- |
| 平台     | Google Apps Script            |
| 語言     | JavaScript                    |
| 架構     | Controller-Service-Repository |
| 資料庫   | Google Sheets                 |
| 部署工具 | clasp                         |

### 後端模組

```
gas-backend/
├── Config.js          # 環境設定 (Sheet ID 等)
├── Main.js            # 進入點 & 路由分發
├── database/
│   └── SheetDB.js     # Sheet 資料存取基底
├── lib/
│   ├── FileService.js # 檔案上傳服務
│   ├── Response.js    # 統一回應格式
│   ├── Router.js      # 路由器
│   └── Utils.js       # 通用工具
└── modules/
    ├── admin/         # 後台管理
    ├── auth/          # 認證 (登入/註冊)
    ├── course/        # 課程管理
    ├── equipment/     # 器材租借
    ├── finance/       # 財務報帳
    ├── machine/       # 機器使用申請 (3D列印/雷切)
    ├── upload/        # 檔案上傳
    └── user/          # 用戶管理
```

## 核心功能

### 用戶認證與授權

- 社員註冊（驗證碼機制）和登入
- 登入記錄追蹤

### 課程管理

- 課程列表和詳情瀏覽
- 公開 / 社員限定課程
- 課程新增、講義與錄影上傳

### 器材租借系統

- 器材庫存瀏覽與分類
- 線上借用申請
- 申請審核、器材簽出 / 歸還追蹤
- 器材盤點與狀態管理
- 借用歷史記錄

### 機器使用申請

- 3D 印表機使用申請
- 雷射切割機使用申請
- 申請審核與時間管理

### 財務報帳系統

- 線上報帳申請表
- 發票 / 收據上傳
- 申請狀態追蹤與審核流程
- 發票簽收與撥款管理

### 公告系統

- 社團公告發布與分類
- 支援附件下載與圖文內容

### 競賽意願 (尚未開發完成)

- 競賽意願調查

### 許願池 (尚未開發完成)

- 匿名意見提交

### 後台管理

- 管理員儀表板
- 用戶與權限管理
- 各項申請審核 (器材/財務/機器)
- 器材盤點作業
- 系統與公告設定

## 快速開始

前端開發環境設定、環境變數、安裝步驟請參閱 [前端開發說明](frontend/README.md)。

### 後端部署

Google Apps Script 後端使用 clasp 進行版本管理：

1. 安裝 clasp：`npm install -g @google/clasp`
2. 登入 Google 帳號：`clasp login`
3. 在 `Config.js` 中設定 Google Sheet ID
4. 推送程式碼：`clasp push`
5. 部署為 Web App

## 授權

本專案採用 MIT License，詳細內容請參閱 [LICENSE](LICENSE) 文件。
第三方套件授權聲明請參閱 [NOTICE.md](NOTICE.md) 文件。
