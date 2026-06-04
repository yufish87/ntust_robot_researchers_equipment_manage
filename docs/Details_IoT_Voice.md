# 節點一：語音尋物與多媒體互動站 (ESP32 #1) 實作開發細則

本文件針對 **節點一 (ESP32 #1) 語音尋物站** 的完整實作規格，涵蓋硬體腳位、韌體狀態機、Next.js BFF 語音處理端點（含 STT / NLU / TTS 管線）、GAS 後端尋物 API，以及 ESP32 #2 亮燈觸發機制。

---

## 1. 硬體架構與腳位配置

| 元件 | 型號 | 介面 | ESP32 GPIO | 備註 |
| :--- | :--- | :--- | :--- | :--- |
| 麥克風 | INMP441 | I2S | WS=25, SCK=26, SD=22 | 單聲道，L/R 腳接 GND 選左聲道 |
| 功放 + 喇叭 | MAX98357A | I2S | BCLK=27, LRC=25, DIN=26 | 與 INMP441 共享 WS/BCK，播放時切換 |
| PTT 按鈕 | 普通按鈕 | GPIO | GPIO=34 | 按下開始錄音，放開停止錄音並發送 |
| 狀態 LED | 單色 LED | GPIO | GPIO=2 | 錄音中閃爍 / 回應中常亮 / 待機熄滅 |

> **注意：** INMP441 與 MAX98357A 共用 I2S 匯流排，韌體需在錄音與播放之間切換 I2S 驅動的模式（`I2S_MODE_RX` ↔ `I2S_MODE_TX`），不可同時開啟。

---

## 2. 韌體狀態機 (ESP32 #1 Firmware FSM)

```
IDLE ──(按下PTT)──> RECORDING ──(放開PTT)──> UPLOADING ──(HTTP回應)──> PLAYING
 ^                                                                          |
 └──────────────────────────────────────────────────────────────────────────┘
                         (播放完畢或HTTP錯誤時回到 IDLE)
```

### 狀態說明

| 狀態 | LED | I2S 模式 | 說明 |
| :--- | :--- | :--- | :--- |
| `IDLE` | 熄滅 | 關閉 | 等待 PTT 按鈕被按下 |
| `RECORDING` | 快閃(500ms) | RX (麥克風) | 持續讀取 INMP441 並寫入記憶體緩衝 |
| `UPLOADING` | 常亮 | 關閉 | 對 `/api/iot/voice` 發送 HTTP POST |
| `PLAYING` | 慢閃(1000ms) | TX (喇叭) | 解碼 Base64 音訊，串流輸出至 MAX98357A |
| `ERROR` | 連閃3次後熄滅 | 關閉 | HTTP 失敗或 API 錯誤，3秒後回到 IDLE |

### 錄音規格
- **取樣率：** 16000 Hz（Whisper 最佳化）
- **位元深度：** 16-bit
- **聲道：** 單聲道
- **最大錄音長度：** 10 秒（超時自動停止）
- **緩衝大小：** 512 bytes × 4 DMA 緩衝

---

## 3. HTTP 通訊格式 (ESP32 #1 → Vercel BFF)

### 3.1 Request

```
POST /api/iot/voice HTTP/1.1
Authorization: Bearer <IOT_BEARER_TOKEN>
Content-Type: multipart/form-data

file: <PCM 音訊二進制，MIME type = audio/wav>
```

> **格式說明：** ESP32 端在 PCM raw buffer 前加上標準 WAV header（44 bytes）再以 multipart/form-data 上傳，讓 Groq SDK 可直接辨識格式。

### 3.2 Response（成功）

```json
{
  "success": true,
  "text": "幫我找步進馬達",
  "intent": "search",
  "keyword": "步進馬達",
  "results": [
    {
      "boxId": "BOX-002",
      "category": "單晶片",
      "location": "C1-L1-C",
      "description": "第一櫃第一層頂層",
      "deviceId": "ESP32_C1_L1",
      "ledPin": "Pin_14"
    }
  ],
  "audioBase64": "<Base64 MP3>",
  "audioFormat": "mp3"
}
```

### 3.3 Response（非尋物意圖）

```json
{
  "success": true,
  "intent": "other",
  "text": "今天天氣很好",
  "audioBase64": "<Base64 MP3，內容為：「我只能協助您尋找器材喔。」>",
  "audioFormat": "mp3"
}
```

### 3.4 Response（查無器材）

```json
{
  "success": true,
  "intent": "search",
  "keyword": "電容",
  "results": [],
  "audioBase64": "<Base64 MP3，內容為：「找不到相關器材，請確認器材名稱。」>",
  "audioFormat": "mp3"
}
```

---

## 4. Next.js BFF 語音處理端點 (route.ts)

**路徑：** `frontend/src/app/api/iot/voice/route.ts`

### 4.1 完整處理管線

```
ESP32上傳音訊
     │
     ▼
[Step 0] Bearer Token 驗證
     │
     ▼
[Step 1] Groq Whisper-large-v3 STT → userText
     │
     ▼
[Step 2] Gemini 1.5 Flash NLU
         └─ intent: "search" | "other"
         └─ keyword: string (僅在 intent=search 時)
     │
     ├─── intent = "other" ──> TTS 生成回覆語音 → 直接回傳
     │
     ▼
[Step 3] 呼叫 GAS GET /iot/search/voice?keyword=...
         └─ 取得 results[]，每筆含 boxId, category, location, description, deviceId, ledPin
     │
     ├─── results 為空 ──> TTS 生成「找不到」語音 → 回傳
     │
     ▼
[Step 4] 組合導引文字 ttsText
         例：「找到了。步進馬達在單晶片類別，箱子在第一櫃第一層頂層，已為您點亮指示燈。」
     │
     ▼
[Step 5] Edge TTS (microsoft/edge-tts) 生成中文語音 → MP3 Buffer → Base64
     │
     ▼
[Step 6] 並行呼叫 ESP32 #2 亮燈 (fire-and-forget)
         POST <ESP32_C1_L1_URL>/led/on  body: { pin: "Pin_14", effect: "breathing" }
     │
     ▼
[Step 7] 回傳整合 JSON 給 ESP32 #1
```

### 4.2 各步驟實作規格

#### Step 1：STT（Groq Whisper）
- 使用 `groq.audio.transcriptions.create()`
- `model: "whisper-large-v3"`（比 turbo 版對中文更精準）
- `language: "zh"`

#### Step 2：NLU（Gemini 1.5 Flash）
使用 `@google/generative-ai` SDK，呼叫 `gemini-1.5-flash` 模型。

**System Prompt：**
```
你是一個器材管理系統的語音助手。根據使用者的指令，判斷：
1. 使用者是否要「尋找器材」？
2. 如果是，要尋找的器材名稱（關鍵字）是什麼？

請以 JSON 格式回應，不要輸出任何其他文字：
{"intent": "search", "keyword": "器材名稱"}
或
{"intent": "other"}
```

**User prompt：** 直接傳入 `userText`

**解析：** 對 Gemini 回應使用 `JSON.parse()`，需加 try/catch，若格式錯誤則 fallback 為 `intent: "other"`。

#### Step 3：GAS 查詢
```
GET ${GAS_API_URL}?route=iot/search/voice&keyword=<encoded_keyword>
```
GAS 端回傳格式見下方第 5 節。

#### Step 4：TTS 文字組合邏輯

```typescript
// 單一結果
"找到了。${keyword}在${results[0].category}類別，箱子在${results[0].description}，已為您點亮指示燈。"

// 多個結果（取前2個）
"找到了。${keyword}共有${count}個箱子。第一個在${results[0].description}，第二個在${results[1].description}，已為您點亮指示燈。"

// 查無結果
"抱歉，找不到${keyword}相關的器材，請確認器材名稱。"

// 非尋物意圖
"我只能協助您尋找社辦的器材喔，請說出您想找的器材名稱。"
```

#### Step 5：Edge TTS
使用 `edge-tts` npm 套件（無需 API Key，免費使用微軟 TTS 引擎）。

```typescript
import { MsEdgeTTS, OUTPUT_FORMAT } from "edge-tts";

const tts = new MsEdgeTTS();
await tts.setMetadata("zh-TW-HsiaoChenNeural", OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
const { audioStream } = await tts.toStream(ttsText);
// 收集 stream → Buffer → base64
```

**語音選擇：** `zh-TW-HsiaoChenNeural`（台灣中文女聲，自然度最高）

**Fallback 順序：**
1. `edge-tts`（主要，無 Key）
2. OpenAI TTS `tts-1`（有 `OPENAI_API_KEY` 時）
3. Google Translate TTS（最後備案，穩定性較差）

#### Step 6：ESP32 #2 亮燈（Fire-and-Forget）

> **注意：** 此為非同步觸發，不等待回應，不影響回傳給 ESP32 #1 的時間。

```typescript
// 對每個 result 中的 deviceId 對應的 ESP32 #2 發送亮燈指令
const esp32Urls = getEsp32UrlFromDeviceId(result.deviceId); // 從 env 取得 URL
results.forEach(result => {
  fetch(`${esp32Urls[result.deviceId]}/led/on`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: result.ledPin, effect: "breathing" }),
    signal: AbortSignal.timeout(3000),
  }).catch(e => console.warn(`ESP32 #2 LED trigger failed for ${result.deviceId}:`, e));
});
```

**ESP32 #2 的 URL 配置方式：** 在 `.env.local` 中添加：
```
ESP32_C1_L1_URL=http://192.168.x.x
ESP32_C2_L3_URL=http://192.168.x.x
```
並透過 `deviceId` 動態取得對應 URL。

### 4.3 環境變數需求

| 變數名稱 | 用途 | 必要 |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | Groq Whisper STT | ✅ |
| `GEMINI_API_KEY` | Gemini 1.5 Flash NLU | ✅ |
| `IOT_BEARER_TOKEN` | 硬體鑑權 | ✅ |
| `NEXT_PUBLIC_GAS_API_URL` | GAS 後端 URL | ✅ |
| `OPENAI_API_KEY` | OpenAI TTS（Fallback） | ❌ 選用 |
| `ESP32_C1_L1_URL` | ESP32 #2 亮燈觸發 URL | ❌ 初期可略過 |

---

## 5. GAS 後端 API：語意尋物 (`GET /iot/search/voice`)

**路徑：** `gas-backend/modules/iot/IoTController.js` → `IoTService.js`

### 5.1 Request 格式

```
GET ?route=iot/search/voice&keyword=步進馬達
```

### 5.2 處理邏輯

1. 讀取 `BoxList` 工作表所有資料
2. 針對每一行的 `類別` 欄位（index 2）做模糊比對：
   - 將類別字串以 `,` 分割為陣列
   - 對每個類別，若包含 `keyword`（或 `keyword` 包含該類別）則視為命中
   - 篩選 `狀態 === "在櫃"` 的結果
3. 對命中的箱子，以其 `位置`（index 3）關聯 `CabinetLayout` 工作表
4. 組合回傳資料

### 5.3 Response 格式

```json
{
  "success": true,
  "data": {
    "keyword": "步進馬達",
    "results": [
      {
        "boxId": "BOX-002",
        "category": "單晶片",
        "location": "C1-L1-C",
        "description": "第一櫃第一層頂層",
        "deviceId": "ESP32_C1_L1",
        "ledPin": "Pin_14",
        "status": "在櫃"
      }
    ]
  }
}
```

> 若查無結果，`results` 回傳空陣列 `[]`，`success` 仍為 `true`。

### 5.4 現有 GAS 端點狀態

目前 `IoTController.js` 已有 `searchVoice` 函數框架，但回傳資料結構為舊版（只回傳單一 `boxId` 和 `description`），需更新為上述多結果陣列格式，並加入 `category`、`deviceId`、`ledPin` 欄位。

---

## 6. ESP32 #2 亮燈端點設計

ESP32 #2 需在韌體中實現一個輕量 HTTP Server（使用 `WebServer.h`）。

### 6.1 亮燈端點

```
POST /led/on
Content-Type: application/json

{ "pin": "Pin_14", "effect": "breathing" }
```

**回應：**
```json
{ "success": true, "pin": "Pin_14", "effect": "breathing" }
```

### 6.2 熄燈端點

```
POST /led/off
Content-Type: application/json

{ "pin": "Pin_14" }
```

### 6.3 效果定義

| `effect` | 說明 |
| :--- | :--- |
| `breathing` | 呼吸燈效果（PWM，週期 2 秒），預設值 |
| `solid` | 常亮 |
| `blink` | 快閃（500ms 間隔） |

> **自動熄燈：** 亮燈後 30 秒若無新指令，自動熄滅（韌體 timer 控制）。

---

## 7. npm 套件需求

```bash
# 在 frontend/ 目錄下安裝
npm install edge-tts @google/generative-ai groq-sdk
```

| 套件 | 版本 | 用途 |
| :--- | :--- | :--- |
| `groq-sdk` | ^0.x | 已安裝（Whisper STT） |
| `@google/generative-ai` | ^0.x | Gemini 1.5 Flash NLU |
| `edge-tts` | ^3.x | 微軟 Edge TTS（無 Key） |

---

## 8. 實作順序建議

### Phase 1：STT + NLU 驗證（無需硬體）
1. 安裝 `@google/generative-ai`、`edge-tts`
2. 更新 `route.ts`：加入 Gemini NLU 步驟（Step 2）
3. 用 Postman 上傳音訊檔測試 STT → NLU 輸出
4. 驗證 Gemini 能正確區分「尋物」vs「其他」意圖

### Phase 2：GAS 尋物 API 更新
1. 更新 `IoTService.js` 的 `searchVoice` 函數，改為多結果格式
2. 加入 `BoxList` ↔ `CabinetLayout` 關聯查詢
3. 用 Postman 測試 `GET ?route=iot/search/voice&keyword=馬達`

### Phase 3：TTS 整合
1. 在 `route.ts` 加入 `edge-tts` Step 5
2. 測試中文語音輸出，確認 Base64 格式正確

### Phase 4：ESP32 #1 韌體
1. 實作 WAV header 生成函數
2. 實作 PTT 按鈕中斷 + I2S 錄音
3. 實作 multipart/form-data HTTP POST
4. 實作 Base64 → PCM 解碼 + I2S 播放

### Phase 5：ESP32 #2 亮燈整合
1. 在 ESP32 #2 韌體加入 HTTP Server 與 `/led/on` 端點
2. 在 `route.ts` Step 6 加入亮燈呼叫
3. 在 `.env.local` 配置 ESP32 #2 的 IP

---

## 9. 已知限制與注意事項

1. **Edge TTS 的 Vercel 相容性：** `edge-tts` 套件需確認在 Vercel Serverless 環境下可運作。若遭遇 `ECONNREFUSED` 或 stream 問題，改用 OpenAI TTS 作為主要引擎。
2. **Vercel 逾時限制：** Vercel Hobby 方案 Serverless Function 上限為 10 秒，Pro 方案為 60 秒。STT + NLU + TTS 串行執行可能接近上限，可考慮 `Promise.all()` 並行化 STT 與其他準備工作。
3. **ESP32 #2 固定 IP：** ESP32 #2 需設定 Wi-Fi 靜態 IP 或透過路由器 DHCP 綁定 MAC，才能在 `.env.local` 中穩定配置 URL。
4. **Gemini JSON 格式：** Gemini 有時會在 JSON 前後輸出 markdown 的 `` ```json `` 圍欄，需先用 regex 清理再 `JSON.parse()`。
5. **INMP441 音量增益：** INMP441 原始輸出音量較小，韌體端需對 PCM 樣本做數位增益（乘以 4~8 倍），再加 WAV header 上傳。
