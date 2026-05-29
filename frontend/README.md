# NTUST RRC Website Frontend

這是 NTUST RRC 社團管理系統的前端專案，採用 Next.js 16 (App Router) 建構，並使用 Google Apps Script (GAS) 作為後端 API。本文件提供詳細的開發說明與安裝指南。

## 技術棧

### 核心框架

- **Framework**: [Next.js 16.1.6](https://nextjs.org/) (App Router)
- **打包器**: Turbopack (快速構建)
- **語言**: TypeScript

### 前端技術

- **樣式系統**: [Tailwind CSS](https://tailwindcss.com/) + PostCSS
- **UI 組件庫**: [Shadcn/UI](https://ui.shadcn.com/) (基於 Radix UI)
- **圖示庫**: [Lucide React](https://lucide.dev/)

### 狀態與表單管理

- **狀態管理**: [Zustand](https://github.com/pmndrs/zustand)
- **表單處理**: [React Hook Form](https://react-hook-form.com/)
- **表單驗證**: [Zod](https://zod.dev/)

### API 與通訊

- **HTTP 客戶端**: Axios
- **後端**: Google Apps Script (GAS)

## 快速開始

### 1. 前置條件

- Node.js 18+
- npm 或 yarn
- 後端 Google Apps Script 已部署

### 2. 環境變數設定

在專案根目錄建立 `.env.local` 檔案：

```bash
# 後端 API 地址 (Google Apps Script Web App URL)
NEXT_PUBLIC_GAS_API_URL=https://script.google.com/macros/s/YOUR_ID/exec

# 其他可選設定
NEXT_PUBLIC_API_TIMEOUT=30000
```

### 3. 安裝依賴

```bash
npm install
```

如果遇到套件版本問題，可使用：

```bash
npm install --legacy-peer-deps
```

### 4. 啟動開發伺服器

```bash
npm run dev
```

開啟瀏覽器訪問 http://localhost:3000

### 5. 生產環境構建

```bash
npm run build
npm start
```

## 專案結構詳解

```
frontend/
├── src/
│   ├── app/                    # Next.js App Router (主應用)
│   │   ├── page.tsx            # 首頁
│   │   ├── layout.tsx          # 根佈局
│   │   ├── globals.css         # 全域樣式
│   │   │
│   │   ├── api/                # BFF Proxy 層 (Backend For Frontend)
│   │   │   ├── [...path]/      # 通用 GAS 反向代理
│   │   │   ├── auth/           # 認證接口
│   │   │   │   └── logout/     # 登出 (清除加密 Session Cookie)
│   │   │   ├── courses/        # 課程接口
│   │   │   ├── applications/   # 申請相關接口
│   │   │   ├── machine/        # 機器接口
│   │   │   ├── storage/        # 儲存接口
│   │   │   └── upload/         # 上傳接口
│   │   │
│   │   ├── auth/               # 認證頁面
│   │   │   ├── login/
│   │   │   └── register/
│   │   │
│   │   ├── dashboard/          # 用戶儀表板
│   │   │   ├── page.tsx
│   │   │   ├── layout.tsx
│   │   │   ├── announcements/  # 公告
│   │   │   ├── applications/   # 申請紀錄
│   │   │   ├── competitions/   # 競賽
│   │   │   ├── courses/        # 課程
│   │   │   ├── equipment/      # 器材租借
│   │   │   ├── finance/        # 財務報帳
│   │   │   ├── machine/        # 機器申請
│   │   │   ├── settings/       # 設定
│   │   │   └── wishlist/       # 願望清單
│   │   │
│   │   └── admin/              # 管理員頁面
│   │       ├── page.tsx
│   │       ├── layout.tsx
│   │       ├── announcements/
│   │       ├── courses/
│   │       ├── equipment/
│   │       ├── finance/
│   │       ├── machine/
│   │       ├── members/
│   │       └── users/
│   │
│   ├── components/             # React 組件庫
│   │   ├── ui/                 # Shadcn 基礎組件
│   │   ├── auth/               # 認證相關組件
│   │   ├── course/             # 課程相關組件
│   │   ├── equipment/          # 器材相關組件
│   │   ├── finance/            # 財務相關組件
│   │   ├── home/               # 首頁組件
│   │   ├── layout/             # 佈局組件
│   │   └── admin/              # 管理組件
│   │
│   ├── lib/                    # 工具函式庫
│   │   ├── api.ts              # API 呼叫封裝
│   │   ├── session.ts          # Session Cookie 加解密 (AES-256-GCM)
│   │   ├── utils.ts            # 通用工具函式
│   │   ├── api/                # API 模組
│   │   └── types/              # TypeScript 類型定義
│   │
│   ├── store/                  # Zustand 狀態管理
│   │   ├── useAuthStore.ts     # 認證狀態
│   │   └── useCartStore.ts     # 購物車狀態
│   │
│   ├── hooks/                  # 自訂 React Hooks
│   │   └── use-toast.ts        # 吐司通知 Hook
│   │
│   ├── config/                 # 組態設定
│   │
│   └── proxy.ts                # 代理設定
│
├── public/                     # 靜態資源
│   └── image/
│       └── Carousel/
│
├── .next/                      # Next.js 建置輸出 (自動生成)
├── .gitignore
├── .env.local                  # 環境變數 (本機)
├── components.json             # Shadcn 組態
├── eslint.config.mjs           # ESLint 設定
├── next.config.ts              # Next.js 組態
├── postcss.config.mjs          # PostCSS 設定
├── tsconfig.json               # TypeScript 設定
├── package.json
└── README.md
```

## 主要功能模組

### 認證系統 (Authentication)

- 社員註冊與登入
- Session Cookie 加密管理 (AES-256-GCM, HttpOnly)
- Token 由 BFF Proxy 攔截加密，Client 不持有 Token

**相關檔案**:

- [src/components/auth/](src/components/auth/)
- [src/app/auth/](src/app/auth/)
- [src/store/useAuthStore.ts](src/store/useAuthStore.ts)

### 課程管理 (Courses)

- 課程列表瀏覽
- 課程詳情頁面
- 課程搜尋與篩選
- 公開課程發布

**相關檔案**:

- [src/app/dashboard/courses/](src/app/dashboard/courses/)
- [src/components/course/](src/components/course/)

### 器材租借 (Equipment)

- 器材目錄瀏覽
- 購物車功能
- 借用申請流程
- 申請狀態追蹤

**相關檔案**:

- [src/app/dashboard/equipment/](src/app/dashboard/equipment/)
- [src/components/equipment/](src/components/equipment/)
- [src/store/useCartStore.ts](src/store/useCartStore.ts)

### 機器使用申請 (Machine)

- 3D 印表機申請
- 雷射切割機申請
- 使用時段管理
- 申請歷史記錄

**相關檔案**:

- [src/app/dashboard/machine/](src/app/dashboard/machine/)

### 財務報帳 (Finance)

- 報帳申請表
- 費用明細動態新增
- 發票/憑證上傳
- 申請審核追蹤

**相關檔案**:

- [src/app/dashboard/finance/](src/app/dashboard/finance/)
- [src/components/finance/](src/components/finance/)

### 後台管理 (Admin)

- 用戶帳號管理
- 申請審核核准
- 系統設定與統計

**相關檔案**:

- [src/app/admin/](src/app/admin/)

## 開發指南

### 新增 UI 組件

使用 Shadcn CLI 新增組件：

```bash
npx shadcn@latest add button
npx shadcn@latest add input
npx shadcn@latest add dialog
```

### API 整合開發流程

1. **在 `@/lib/api` 中定義 API 呼叫**

   ```typescript
   // lib/api/courses.ts
   export const fetchCourses = async () => {
     const response = await api.get("/api/courses");
     return response.data;
   };
   ```

2. **在 `@/app/api` 建立 Proxy Route**

   ```typescript
   // app/api/courses/route.ts
   export async function GET() {
     const data = await fetchCourses();
     return Response.json(data);
   }
   ```

3. **在組件中使用**

   ```typescript
   const { data } = await fetch("/api/courses").then((r) => r.json());
   ```

### 狀態管理開發流程

使用 Zustand 管理全域狀態：

```typescript
// store/useAppStore.ts
import { create } from "zustand";

interface AppState {
  user: User | null;
  setUser: (user: User) => void;
}

export const useAppStore = create<AppState>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));
```

在組件中使用：

```typescript
const { user, setUser } = useAppStore();
```

### 表單開發最佳實踐

結合 React Hook Form 與 Zod：

```typescript
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

export function LoginForm() {
  const { register, handleSubmit } = useForm({
    resolver: zodResolver(schema),
  });

  return <form onSubmit={handleSubmit(onSubmit)}>...</form>;
}
```

### 類型定義最佳實踐

在 `@/lib/types` 中集中管理類型：

```typescript
// lib/types/course.ts
export interface Course {
  id: string;
  name: string;
  description: string;
  instructor: string;
}
```

## 常用命令

| 命令                 | 說明                                   |
| -------------------- | -------------------------------------- |
| `npm run dev`        | 啟動開發伺服器 (http://localhost:3000) |
| `npm run build`      | 構建生產版本                           |
| `npm run start`      | 啟動生產伺服器                         |
| `npm run lint`       | 執行 ESLint 檢查                       |
| `npm run type-check` | TypeScript 類型檢查                    |

## 效能最佳實踐

- 使用 Next.js Image 組件優化圖片
- 實施代碼分割 (Code Splitting)
- 預先載入關鍵資源
- 使用 Static Generation (SSG) 預渲染靜態頁面

## 安全性注意事項

- 敏感資訊不要提交到版本控制 (使用 .env.local)
- 驗證所有用戶輸入
- 使用 HTTPS 傳輸
- 實施 CORS 安全設定

## 故障排除

### Port 3000 已被佔用

```bash
# Windows
netstat -ano | findstr :3000

# 或使用不同的 port
npm run dev -- -p 3001
```

### 構建失敗

清除快取重新構建：

```bash
rm -rf .next node_modules
npm install
npm run build
```

### TypeScript 錯誤

確保類型定義完整：

```bash
npm run type-check
```

## 相關文件

- [Next.js 官方文件](https://nextjs.org/docs)
- [Shadcn/UI 文件](https://ui.shadcn.com/)
- [Tailwind CSS 文件](https://tailwindcss.com/docs)
- [Zustand 文件](https://github.com/pmndrs/zustand)

## 支援與貢獻

如有問題或建議，請提交 Issue 或 Pull Request。
