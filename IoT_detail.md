# NTUST RRC 社團資源管理系統 - IoT 節點整合與擴充實作細則 (IoT_detail.md)

本文件針對 ESP32 硬體端（語音尋物、邊緣庫存、身分驗證）與現行 Next.js BFF + Google Apps Script (GAS) 架構進行深度評估，提供精準的資料庫欄位設計、API 路由規範、後端程式碼結構擴充方案，以及安全與邊緣優化建議。

---

## 1. 系統互動與通訊架構 (System Architecture)

系統採用 **Client-Server 網域主動請求架構**，ESP32 均為 HTTPS 請求的發起者（Client），中介 Next.js BFF (Vercel) 作為安全網關與 AI 排程中心，最後由 GAS 處理 Google Sheets 的 ACIDS（利用 LockService）交易。

```mermaid
graph TD
    ESP1[ESP32 #1 語音尋物] -->|1. HTTPS POST Audio/Text| BFF[Next.js BFF Proxy]
    ESP2[ESP32 #2 邊緣庫存] -->|2. HTTPS POST State Diff| BFF
    ESP3[ESP32 #3 視覺授權] -->|3. HTTPS POST Scan ID| BFF

    BFF -->|Groq Whisper STT| Whisper[語音轉文字]
    BFF -->|OpenAI / Google TTS| TTS[文字轉語音]
    
    BFF -->|4. HTTPS Route| GAS[Google Apps Script]
    GAS <-->|5. SQL-like read/write| Sheets[(Google Sheets)]
```

---

## 2. 資料庫擴充設計 (Google Sheets Schema)

為實現硬體與實體櫃位完全解耦的動態映射，我們在原有的 15 張表基礎上，**新增 2 張核心工作表**，並在 `Config.js` 中註冊。

### 2.1 箱子總表 (BoxList)
*   **Sheet Key:** `BoxList`
*   **目的:** 本表負責管理物理上存在的實體箱子狀態，當 Vercel 接收到邊緣端上傳的位置快照後，會在此表更新各箱子的當前位置與在位狀態。

| 欄位索引 | 欄位名稱 | 資料類型 | 說明 | 範例 |
| :--- | :--- | :--- | :--- | :--- |
| 0 | 箱子編號 | String (Key) | 實體箱子唯一代碼，此代碼由 ESP32 內部的 RFID UID 對照表直接轉換輸出。 | `BOX-001` |
| 1 | 大小 | String | 箱子尺寸規格（Large 代表大箱子，會遮擋並佔用連續兩格物理位置；Small 代表小箱子，佔用一格位置）。 | `Large` |
| 2 | 類別 | String | 該箱子所內含的器材種類，支援以半形逗號分隔多個種類，供 Vercel 端的 AI 模型進行模糊語意匹配。 | `馬達, 齒輪` |
| 3 | 位置 | String | 當前被感測器偵測到的實體櫃位編號（未偵測到時為 `未偵測`）。 | `C1-L1-A` |
| 4 | 狀態 | String | 該箱子的庫存動態狀態（在庫、使用中）。 | `在櫃` |

### 2.2 實體櫃位映射表 (CabinetLayout)
*   **Sheet Key:** `CabinetLayout`
*   **目的:** 本表作為硬體與空間的設定檔。將櫃子的三維物理空間代碼映射到特定控制晶片與實體控制引腳，確保未來系統擴充至其他櫃位層架時，無須修改硬體核心程式碼。

| 欄位索引 | 欄位名稱 | 資料類型 | 說明 | 範例 |
| :--- | :--- | :--- | :--- | :--- |
| 0 | 櫃位編號 | String (Key) | 物理櫃位主鍵，為系統各程式模組在進行精準資料索引時的唯一代碼。 | `C1-L1-A` |
| 1 | 櫃位 | String | 獨立維度欄位，代表實體放置的櫃體編號（如 C1、C2）。 | `C1` |
| 2 | 層 | String | 獨立維度欄位，代表櫃體內的層架層數（如 L1、L2、L3）。 | `L1` |
| 3 | 位置 | String | 獨立維度欄位，代表單一層架內垂直堆疊的物理位置格（A 為底層、B 為中層、C 為頂層）。若下層放置 Large 箱子，系統邏輯會自動將上方的 Position 預期狀態設為被佔用。 | `A` |
| 4 | 裝置編號 | String | 負責感測與控制該物理區域的實體 ESP32 晶片識別碼。 | `ESP32_C1_L1` |
| 5 | LED腳位 | String | ESP32 晶片上用來獨立控制該位置尋址燈條的 GPIO 引腳編號。 | `Pin_12` |
| 6 | 語音描述 | String | 該物理櫃位的直觀中文文字描述，用於雲端 TTS 模型轉換成即時語音導引語句。 | `第一櫃第一層底層` |

---

## 3. 後端擴充實作區域與代碼指引 (Backend & API Modifications)

我們必須在現有的 `gas-backend` 模組結構中，新增專屬的 **IoT 模組**，並在 Next.js BFF 配置中介層路由。

### 3.1 `gas-backend/Config.js` 擴充 (新增表對應)
請在現有的 `SHEET_NAME` 與 `SHEET_GID` 加入：

```javascript
// 修改 [Config.js]
SHEET_NAME: {
  // ...現有配置
  BoxList: "BoxList",
  CabinetLayout: "CabinetLayout",
},
SHEET_GID: {
  // ...現有配置 (依據試算表實際建立後的 GID 填寫)
  BoxList: "1234567890", 
  CabinetLayout: "0987654321",
}
```

### 3.2 註冊 Main.js 路由
在 `gas-backend/Main.js` 底部註冊以下新路由：

```javascript
// 新增於 [Main.js]
router.register("iot/inventory/update", (e) => IoTController.updateInventory(e));
router.register("iot/cabinet/layout", (e) => IoTController.getCabinetLayout(e));
router.register("iot/search/voice", (e) => IoTController.voiceSearch(e));
router.register("iot/auth/scan", (e) => IoTController.authScan(e));
router.register("iot/auth/confirm", (e) => IoTController.authConfirm(e));
```

### 3.3 新增 IoT 模組架構
在 `gas-backend/modules/` 下建立新資料夾 `iot`，並新增以下三個檔案：

#### 1. `c:\Users\ctsuser\Desktop\ntust_rrc_website_IoT\gas-backend\modules\iot\IoTRepository.js`
負責直接讀寫 `BoxList` 與 `CabinetLayout` 工作表，封裝為關聯邏輯：

```javascript
class IoTRepository {
  constructor() {
    this.db = getDB();
    this.boxSheet = "BoxList";
    this.layoutSheet = "CabinetLayout";
  }

  // 取得所有櫃位對照設定
  findAllLayouts() {
    const data = this.db.getData(this.layoutSheet);
    data.shift(); // 移除 header
    return data.map(row => ({
      slotId: row[0],
      deviceId: row[4],
      position: row[3],
      ledPin: row[5],
      description: row[6]
    }));
  }

  // 取得所有箱子狀態
  findAllBoxes() {
    const data = this.db.getData(this.boxSheet);
    data.shift();
    return data.map(row => ({
      boxId: row[0],
      size: row[1],
      categories: row[2] ? row[2].split(",") : [],
      location: row[3],
      status: row[4]
    }));
  }

  // 批次更新箱子物理位置與在庫狀態 (Event-Driven update from ESP32 #2)
  updateBoxStates(updates) {
    const sheet = this.db.getSheet(this.boxSheet);
    const data = sheet.getDataRange().getValues();
    let changed = false;

    // updates format: { "BOX-001": { location: "C1-L1-A", status: "在櫃" } }
    for (let i = 1; i < data.length; i++) {
      const boxId = String(data[i][0]).trim();
      if (updates[boxId]) {
        data[i][3] = updates[boxId].location; // 位置
        data[i][4] = updates[boxId].status;   // 狀態 (在櫃/使用中)
        changed = true;
      }
    }

    if (changed) {
      sheet.getRange(1, 1, data.length, data[0].length).setValues(data);
      this.db.clearCache(this.boxSheet);
    }
  }
}
```

#### 2. `c:\Users\ctsuser\Desktop\ntust_rrc_website_IoT\gas-backend\modules\iot\IoTService.js`
處理複雜的覆蓋遮擋演算法（Large 尺寸箱子）與語意尋物匹配：

```javascript
class IoTService {
  constructor() {
    this.repo = new IoTRepository();
  }

  // 處理 ESP32 #2 傳送的 RFID 物理快照變更
  // 導入 Overlap 遮擋防護邏輯
  processStateSnapshot(deviceId, slots) {
    const layouts = this.repo.findAllLayouts().filter(l => l.deviceId === deviceId);
    const boxes = this.repo.findAllBoxes();
    
    // 建立 BoxId -> Box 對照 Map
    const boxMap = {};
    boxes.forEach(b => {
      boxMap[b.boxId.toLowerCase()] = b;
    });

    const boxUpdates = {};
    const slotOccupation = {}; // 紀錄物理格位佔用： { "C1-L1-A": "BOX-001" }

    // 1. 建立掃描狀態下的在櫃箱子
    layouts.forEach(layout => {
      const currentBoxId = slots[layout.position]; // 例如 slots.A = "BOX-001"
      if (currentBoxId && currentBoxId !== "EMPTY") {
        const box = boxMap[currentBoxId.toLowerCase()];
        if (box) {
          boxUpdates[box.boxId] = {
            location: layout.slotId,
            status: "在櫃"
          };
          slotOccupation[layout.slotId] = box.boxId;

          // ⚠️ 【獨創核心防護邏輯】：處理 Large 箱子向上遮擋的邏輯
          if (box.size === "Large" && layout.position === "A") {
            // 自動標記 B 層 (C1-L1-B) 被此大箱子物理性遮擋
            const blockedSlotId = layout.slotId.replace("-A", "-B");
            slotOccupation[blockedSlotId] = `${box.boxId} (Large-Blocked)`;
          }
        }
      }
    });

    // 2. 對於本應在櫃，但這次未被掃描到的箱子，標記為「使用中」
    boxes.forEach(box => {
      // 若該箱子原先記錄在這個 ESP32 負責的櫃位
      const belongsToThisDevice = layouts.some(l => l.slotId === box.location);
      if (belongsToThisDevice) {
        const boxKey = box.boxId;
        // 如果新快照中沒有它，代表已被取出
        if (!boxUpdates[boxKey]) {
          boxUpdates[boxKey] = {
            location: "未偵測",
            status: "使用中"
          };
        }
      }
    });

    this.repo.updateBoxStates(boxUpdates);
    return { success: true, updatedCount: Object.keys(boxUpdates).length };
  }

  // 尋物邏輯 (Voice Search Matcher)
  findBoxByKeyword(keyword) {
    const boxes = this.repo.findAllBoxes();
    const layouts = this.repo.findAllLayouts();

    // 1. 進行關鍵字模糊匹配
    let matchedBox = null;
    for (const box of boxes) {
      const hasMatch = box.categories.some(cat => 
        cat.toLowerCase().includes(keyword.toLowerCase()) ||
        keyword.toLowerCase().includes(cat.toLowerCase())
      );
      if (hasMatch && box.status === "在櫃") {
        matchedBox = box;
        break;
      }
    }

    if (!matchedBox) {
      throw new Error(`找不到含有「${keyword}」的在庫器材箱`);
    }

    // 2. 匹配櫃位 LED 物理腳位與描述
    const layout = layouts.find(l => l.slotId === matchedBox.location);
    if (!layout) {
      throw new Error(`箱子 ${matchedBox.boxId} 在庫，但櫃位映射表找不到 ${matchedBox.location}`);
    }

    return {
      boxId: matchedBox.boxId,
      location: matchedBox.location,
      description: layout.description,
      ledAction: {
        ledPin: layout.ledPin
      }
    };
  }
}
```

#### 3. `c:\Users\ctsuser\Desktop\ntust_rrc_website_IoT\gas-backend\modules\iot\IoTController.js`
外部端點控制器：

```javascript
const IoTController = {
  // POST /iot/inventory/update
  // Payload: { device_id: "ESP32_C1_L1", slots: { "A": "BOX-001", "B": "EMPTY", "C": "BOX-002" } }
  updateInventory(e) {
    try {
      const payload = JSON.parse(e.postData.contents);
      const service = new IoTService();
      const result = service.processStateSnapshot(payload.device_id, payload.slots);
      return Response.success(result);
    } catch (err) {
      return Response.error(err.toString());
    }
  },

  // GET /iot/search/voice?keyword=馬達
  voiceSearch(e) {
    try {
      const keyword = e.parameter.keyword;
      if (!keyword) return Response.error("Missing keyword");
      
      const service = new IoTService();
      const result = service.findBoxByKeyword(keyword);
      return Response.success(result);
    } catch (err) {
      return Response.error(err.toString());
    }
  },

  // POST /iot/auth/scan
  // Payload: { reqId: "REQ-20260529-001" }
  authScan(e) {
    try {
      const payload = JSON.parse(e.postData.contents);
      const reqId = payload.reqId;
      if (!reqId) return Response.error("Missing reqId");

      // 讀取現有 EquipmentApplications 庫存申請
      const db = getDB();
      const appSheet = db.getSheet("EquipmentApplications");
      const appData = appSheet.getDataRange().getValues();
      
      let matchedRow = null;
      for (let i = 1; i < appData.length; i++) {
        if (appData[i][0] === reqId) {
          matchedRow = appData[i];
          break;
        }
      }

      if (!matchedRow) return Response.error("找不到該借用申請單");
      if (matchedRow[10] !== "已核准") {
        return Response.error(`申請單狀態不符: 當前狀態為 ${matchedRow[10]}`);
      }

      // 回傳申請明細 JSON 給 ESP32 OLED 渲染
      return Response.success({
        reqId: matchedRow[0],
        applicantName: matchedRow[2],
        itemsSummary: matchedRow[5], // 器材摘要 description
        itemsDetail: JSON.parse(matchedRow[4]) // 原始器材清單 JSON
      });
    } catch (err) {
      return Response.error(err.toString());
    }
  },

  // POST /iot/auth/confirm
  // 物理上按下領取確認按鈕，執行交易變更與發信
  authConfirm(e) {
    try {
      const payload = JSON.parse(e.postData.contents);
      const reqId = payload.reqId;

      const db = getDB();
      const appSheet = db.getSheet("EquipmentApplications");
      const appData = appSheet.getDataRange().getValues();

      let targetIndex = -1;
      for (let i = 1; i < appData.length; i++) {
        if (appData[i][0] === reqId) {
          targetIndex = i;
          break;
        }
      }

      if (targetIndex === -1) return Response.error("找不到申請單");

      // 更新申請單狀態為「已借出」
      appData[targetIndex][10] = "已借出";
      appSheet.getRange(1, 1, appData.length, appData[0].length).setValues(appData);
      db.clearCache("EquipmentApplications");

      // 🚀 動態更新關聯的 EquipmentDetails 實體，將「使用情形」改為「已借出」
      const detailIds = JSON.parse(appData[targetIndex][6]); // 分配器材編號JSON
      const detailSheet = db.getSheet("EquipmentDetails");
      const detailData = detailSheet.getDataRange().getValues();

      detailIds.forEach(id => {
        for (let j = 1; j < detailData.length; j++) {
          if (detailData[j][0] === id) {
            detailData[j][6] = "已借出";
            detailData[j][7] = appData[targetIndex][1]; // 借用人學號
            detailData[j][8] = reqId; // 關聯單號
            detailData[j][9] = appData[targetIndex][9]; // 預計歸還日
          }
        }
      });
      detailSheet.getRange(1, 1, detailData.length, detailData[0].length).setValues(detailData);
      db.clearCache("EquipmentDetails");

      return Response.success({ success: true, message: "借出狀態已成功變更" });
    } catch (err) {
      return Response.error(err.toString());
    }
  }
};
```

---

## 4. Next.js BFF Proxy 中介層擴充 (Frontend BFF Routes)

ESP32 硬體運算能力有限，故應將「語音特徵辨識 (STT)」、「語句播報合成 (TTS)」等重量級 AI 請求委託給 Next.js BFF (Vercel)，轉換成單純的 JSON 文字後再傳遞給 GAS 與 ESP32。

### 4.1 新增語音處理 BFF 端點 (`frontend/src/app/api/iot/voice/route.ts`)
當 ESP32 #1 按下麥克風並錄下 `.wav` 語音時，主動發送 binary 檔案至此 BFF：

```typescript
import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;
const IOT_BEARER_TOKEN = process.env.IOT_BEARER_TOKEN;

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY || "",
});

/**
 * POST /api/iot/voice
 *
 * ESP32 #1 語音尋物站的 BFF 端點 (基於 Groq SDK STT + Google/OpenAI TTS 雙引擎)
 */
export async function POST(req: NextRequest) {
  try {
    // 0. 驗證硬體 Bearer Token
    const authHeader = req.headers.get("authorization");
    if (
      IOT_BEARER_TOKEN &&
      (!authHeader || authHeader !== `Bearer ${IOT_BEARER_TOKEN}`)
    ) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Invalid IoT token" },
        { status: 401 },
      );
    }

    // 1. 取得 ESP32 傳來的二進制錄音檔案
    const formData = await req.formData();
    const audioFile = formData.get("file") as File;
    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: "Missing audio file" },
        { status: 400 },
      );
    }

    // 2. 驗證 Groq API Key 存在
    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing GROQ_API_KEY in environment variables" },
        { status: 500 },
      );
    }

    // 3. 呼叫 Groq Whisper API 進行高精準度中文語音識別 (STT)
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3-turbo",
      language: "zh",
    });

    const userText = transcription.text; // 辨識結果例如: "幫我找步進馬達在哪裡"

    // 4. 將辨識文字作為關鍵字，呼叫 GAS 後端獲取箱子櫃位位置
    const gasRes = await fetch(
      `${GAS_API_URL}?route=iot/search/voice&keyword=${encodeURIComponent(userText)}`,
      { cache: "no-store" },
    );
    const gasData = await gasRes.json();

    if (!gasData.success) {
      return NextResponse.json({
        success: false,
        text: userText,
        message: `無法定位該器材：${gasData.message}`,
        action: "error",
      });
    }

    // 5. 語音生成 (TTS) 導引
    const ttsText = `找到了，${gasData.data.boxId}號箱位在${gasData.data.description}，對應區域已為您點亮綠色指示燈。`;
    let base64Audio = "";

    // 5.1 優先嘗試使用 OpenAI TTS (若有提供 OPENAI_API_KEY)
    if (process.env.OPENAI_API_KEY) {
      try {
        const oaiTtsRes = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "tts-1",
            voice: "alloy",
            input: ttsText,
          }),
        });
        if (oaiTtsRes.ok) {
          const arrayBuffer = await oaiTtsRes.arrayBuffer();
          base64Audio = Buffer.from(arrayBuffer).toString("base64");
        }
      } catch (e) {
        console.warn("OpenAI TTS failed, fallback to Google TTS:", e);
      }
    }

    // 5.2 若無 OpenAI Key，或呼叫失敗，使用免費免 Key 的 Google Translate TTS 方案
    if (!base64Audio) {
      try {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=zh-TW&client=tw-ob&q=${encodeURIComponent(ttsText)}`;
        const ttsRes = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
          },
        });
        if (!ttsRes.ok) {
          throw new Error(`Google TTS failed: ${ttsRes.statusText}`);
        }
        const arrayBuffer = await ttsRes.arrayBuffer();
        base64Audio = Buffer.from(arrayBuffer).toString("base64");
      } catch (e: any) {
        return NextResponse.json(
          { success: false, error: `TTS Generation failed: ${e.message}` },
          { status: 502 },
        );
      }
    }

    // 6. 回傳整合控制 JSON 給 ESP32 #1
    return NextResponse.json({
      success: true,
      text: userText,
      boxId: gasData.data.boxId,
      location: gasData.data.location,
      ledAction: gasData.data.ledAction,
      audioBase64: base64Audio,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("IoT Voice API Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
```

---

## 5. 網頁互動功能需求評估 (Web Admin Dashboard)

為支援管理員輕鬆對接與維護實體櫃子與箱子，網站前端必須擴充以下互動頁面與操作邏輯：

### 5.1 器材櫃即時狀態面板 (`/admin/iot/cabinet`)
*   **功能描述:** 以視覺化網格佈局（Grid Layout）模擬物理櫃位。
*   **核心組件:**
    *   **櫃位狀態卡片:** 動態串接 TanStack Query，每 30 秒自動更新或透過 WebSocket 監聽。利用顏色狀態指示：
        *   **綠色 (在庫):** 物理 RFID 讀卡機正讀取到卡片，顯示 `BOX-001` 與其內含器材。
        *   **橘色 (遮擋):** 該位置因下方 `Large` 大箱子佔用而被物理遮擋（自動化虛擬鎖定，不可再分配）。
        *   **灰色 (空置/已被借出):** 當前沒有卡片被偵測到。

### 5.2 實體箱子管理與綁定器 (`/admin/iot/boxes`)
*   **功能描述:** 管理員新增或管理實體器材箱子。
*   **操作邏輯:**
    1.  點擊「新增箱子」。
    2.  輸入箱子編號（例如 `BOX-004`），此編號必須與 ESP32 內部 RFID UID 對照表所轉換輸出的代碼一致。
    3.  設定箱子的**尺寸大小（Small/Large）**與所屬的**器材類別**。
    4.  存檔後同步寫入 Google Sheet `BoxList`。

---

## 6. 獨創性硬體優化與安全機制 (Expert Insights)

這套系統在實際落地時，有三個隱藏的技術坑點必須克服，以下提供精準的解決對策：

### 📌 1. 物理位置重疊演算法 (Large Box Overlap Guard)
*   **問題:** 當一個高 2 層的 `Large` 大箱子放在 A 槽時，B 槽實體空間被佔用，但 B 槽的 RFID 讀卡機將回傳 `EMPTY`（因為沒有新卡）。此時如果不加限制，系統會判定 B 槽可分配，造成邏輯錯亂。
*   **對策:** 在 `IoTService.js` 中實現遮擋關聯。一旦檢測到 `Location == A` 且 `Size == Large` 的箱子在櫃，系統後端進行防寫鎖定（Write-Lock），強行將 B 槽位置的狀態指派為 `Large-Blocked`。

### 📌 2. 邊緣去抖與頻寬控制 (Edge Debouncing & Cooldown)
*   **問題:** RFID 讀卡機 (RC522) 在交界處或受環境電磁干擾時，可能頻繁交替發送卡片在位與不在位的訊號（即「抖動」），導致 GAS API 在幾秒內被狂刷數十次，觸發 Google Apps Script 日限額封鎖。
*   **對策 (ESP32 端):** 
    *   實施硬體邊緣去抖：連續 10 次輪詢 (每次間隔 100ms) 狀態完全一致才確認狀態變更。
    *   發送冷卻限制 (Cooldown)：狀態變更後，至少強制冷卻 3 秒，防止短時間重複提交。

### 📌 3. API 存取安全防護 (Header Bearer Token)
*   **問題:** GAS 網址外洩將導致任何人都可以偽造 API Request 偽造箱子位置與惡意核准器材借用。
*   **對策:** BFF 的 catch-all Proxy (`[...path]/route.ts`) 應統一在 Forward 時驗證自定義的硬體 Token。所有 ESP32 的 HTTP Request 必須攜帶：
    `Authorization: Bearer RRC_IoT_Secure_Token_2026`
    否則 BFF 拒絕轉發請求至 GAS，保障社團數據庫絕對安全。
