import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { tts } from "edge-tts";
import mqtt from "mqtt";

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;
const IOT_BEARER_TOKEN = process.env.IOT_BEARER_TOKEN;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });

// 社辦現有器材列表，供 Gemini 做名稱校正與模糊對應
const EQUIPMENT_LIST = [
  "Arduino Uno (附線)",
  "Arduino Mega (附線)",
  "Raspberry Pi 3",
  "1080P 攝影機",
  "超音波傳感器",
  "HDMI 3進1出 切換器",
  "小麵包版",
  "SG90 伺服馬達",
  "MG90S 伺服馬達",
  "步進馬達控制器",
  "大金屬麥克納姆輪 (4個1組)",
  "小塑膠麥克納姆輪 (4個1組)",
  "氣缸 16*75",
  "氣缸 16*100",
  "氣缸 40*75",
  "USB2.0 延長線 3M",
  "USB3.0 to Type-C 傳輸線 3M (有螺絲)",
  "USB3.0 to Type-C 傳輸線 5M (有螺絲)",
  "USB3.0 to Type-C 傳輸線 3M (無螺絲)",
  "DB37 傳輸線 公公 1.5M",
  "DB37 傳輸線 公公 3M",
  "80mm環形LED燈",
  "單點式測距光達8公尺",
  "TT130馬達 帶AB相編碼器 5V",
  "1~10mm近接開關",
  "2mm 電容式近接開關",
  "RS232 傳輸線 公公 3m",
  "氣壓電磁閥 五孔二位 三個一組",
  "氣壓電磁閥 五孔二位 單組",
  "氣源過濾器",
  "大流量真空產生器",
  "直套式真空產生器 6mm",
  "線性襯套 6mm 附70mm螺栓",
  "DB37 端子台 母頭",
  "D型 9P 端子台 母頭",
  "24V 電源供應器",
  "220V 接線插頭",
  "20mm 按鈕 1A1B",
  "USB3.0 網路卡",
  "環形電容式光電開關 PNP",
  "18650電池 2600mAh",
  "TT130馬達 1:48 5V",
  "L298N 馬達驅動模組",
  "18650電池盒 兩入串聯",
].join("\n");

// ────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────

interface NluResult {
  intent: "search" | "other";
  keywords: string[]; // 空陣列代表 other 或解析失敗
}

interface GasSearchResult {
  boxId: string;
  category: string;
  location: string;
  description: string;
  deviceId: string;
  ledPin: string;
  status: string;
}

interface KeywordSearchResult {
  keyword: string;
  results: GasSearchResult[];
}

// ────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────

/**
 * MQTT: 將語音搜尋結果的亮燈命令發布給對應 ESP32 #2
 * 依 deviceId 分組，每台 ESP32 收一條訊息
 * 失敗時只 warn，不中斷語音回應
 */
async function publishLedCommands(
  searches: KeywordSearchResult[],
): Promise<void> {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  const port = parseInt(process.env.MQTT_PORT || "8883", 10);

  if (!brokerUrl || !username || !password) {
    console.warn("[MQTT] Missing broker config, skipping LED publish");
    return;
  }

  // 收集 deviceId → LED pins（去重）
  const devicePins: Record<string, Set<number>> = {};
  for (const { results } of searches) {
    for (const r of results) {
      if (!r.deviceId || !r.ledPin) continue;
      const pin = parseInt(r.ledPin, 10);
      if (isNaN(pin)) continue;
      if (!devicePins[r.deviceId]) devicePins[r.deviceId] = new Set();
      devicePins[r.deviceId].add(pin);
    }
  }

  if (Object.keys(devicePins).length === 0) return;

  return new Promise<void>((resolve) => {
    const client = mqtt.connect(`mqtts://${brokerUrl}`, {
      port,
      username,
      password,
      clientId: `rrc-server-${Date.now()}`,
      connectTimeout: 5000,
    });

    client.on("connect", () => {
      const publishes = Object.entries(devicePins).map(
        ([deviceId, pins]) =>
          new Promise<void>((res, rej) => {
            const topic = `rrc/led/${deviceId}`;
            const msg = JSON.stringify({ pins: [...pins], duration: 10000 });
            client.publish(topic, msg, { qos: 1 }, (err) =>
              err ? rej(err) : res(),
            );
          }),
      );

      Promise.allSettled(publishes).then((results) => {
        results.forEach((r) => {
          if (r.status === "rejected")
            console.error("[MQTT] Publish error:", r.reason);
        });
        client.end();
        resolve();
      });
    });

    client.on("error", (err) => {
      console.error("[MQTT] Connection error:", err.message);
      client.end();
      resolve(); // 不因 MQTT 失敗而中斷語音回應
    });
  });
}

/**
 * TTS 主要方案: Edge TTS (MP3) → Google Translate TTS fallback
 * 回傳 base64 MP3，用於 POST /api/iot/voice 的 audioBase64 欄位
 */
async function generateTtsBase64(text: string): Promise<string> {
  // 1. Edge TTS
  try {
    const buf = await tts(text, { voice: "zh-TW-HsiaoChenNeural" });
    return buf.toString("base64");
  } catch (e) {
    console.warn("Edge TTS failed, trying Google TTS:", e);
  }

  // 2. Google Translate TTS (Vercel 雲端備用)
  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=zh-TW&client=tw-ob`;
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
    });
    if (res.ok) return Buffer.from(await res.arrayBuffer()).toString("base64");
    console.warn("Google TTS status:", res.status);
  } catch (e) {
    console.warn("Google TTS failed:", e);
  }

  throw new Error("All TTS engines failed");
}

/**
 * Gemini NLU：
 * - 判斷是否為尋物意圖
 * - 支援同時搜尋多樣器材
 * - 對照器材列表校正名稱（修正語音辨識誤字 / 模糊詞對應）
 */
async function detectIntent(text: string): Promise<NluResult> {
  const prompt = `你是社辦器材管理系統的語音助理。

以下是社辦現有的器材列表：
${EQUIPMENT_LIST}

根據使用者的指令，做兩件事：
1. 判斷使用者是否要「尋找器材」？
2. 如果是，從上方器材列表中找出最接近使用者描述的器材名稱。
   - 可以同時搜尋多樣器材（例如「我要找Arduino Uno與超音波傳感器」）
   - 若使用者說的名稱與列表有些許差異（語音辨識誤字、別名、簡稱），請自動對應到列表中最接近的名稱
   - 若無法對應到列表中任何器材，使用使用者原本說的關鍵字

只輸出 JSON，不要 markdown 圍欄，不要其他文字：
搜尋一樣器材：{"intent":"search","keywords":["器材名稱"]}
搜尋多樣器材：{"intent":"search","keywords":["器材名稱A","器材名稱B"]}
非尋物意圖：{"intent":"other","keywords":[]}

使用者說：${text}，如果是簡體中文，將文字轉成繁體中文後再處理`;

  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
      model: "llama-3.1-8b-instant",
      temperature: 0.1,
      response_format: { type: "json_object" },
    });
    const raw = chatCompletion.choices[0]?.message?.content?.trim() || "";
    const parsed = JSON.parse(raw) as { intent: string; keywords: string[] };
    if (
      parsed.intent === "search" &&
      Array.isArray(parsed.keywords) &&
      parsed.keywords.length > 0
    ) {
      return { intent: "search", keywords: parsed.keywords };
    }
    return { intent: "other", keywords: [] };
  } catch (err) {
    console.warn("[Voice] Groq NLU parse failed:", err);
    return { intent: "other", keywords: [] };
  }
}

/** 對單一關鍵字呼叫 GAS 搜尋 API */
async function searchGas(keyword: string): Promise<GasSearchResult[]> {
  const url = `${GAS_API_URL}?route=iot/search/voice&keyword=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!data.success) return [];
  return (data.data?.results ?? []) as GasSearchResult[];
}

/** 組合多關鍵字搜尋結果的 TTS 文字 */
function buildTtsText(searches: KeywordSearchResult[]): string {
  const found = searches.filter((s) => s.results.length > 0);
  const notFound = searches.filter((s) => s.results.length === 0);

  if (found.length === 0) {
    const names = notFound.map((s) => s.keyword).join("與");
    return `抱歉，找不到${names}相關的器材，請確認器材名稱。`;
  }

  const parts: string[] = [];

  for (const { keyword, results } of found) {
    if (results.length === 1) {
      parts.push(
        `${keyword}在貼著【${results[0].category}】的箱子裡，位置在${results[0].description}`,
      );
    } else {
      const locs = results
        .slice(0, 2)
        .map((r, i) => `第${i === 0 ? "一" : "二"}個在${r.description}`)
        .join("，");
      parts.push(`${keyword}共有${results.length}個箱子，${locs}`);
    }
  }

  let text = `找到了。${parts.join("；")}，已為您點亮指示燈。`;

  if (notFound.length > 0) {
    const names = notFound.map((s) => s.keyword).join("與");
    text += `另外，找不到${names}，請確認名稱。`;
  }

  return text;
}

function buildReplyText(searches: KeywordSearchResult[]): string {
  const found = searches.filter((s) => s.results.length > 0);
  const notFound = searches.filter((s) => s.results.length === 0);

  if (found.length === 0) {
    const names = notFound.map((s) => s.keyword).join("與");
    return `抱歉，目前在庫中找不到「${names}」相關的器材箱，可能已借出或尚未入庫。`;
  }

  const lines: string[] = [];
  for (const { keyword, results } of found) {
    const boxes = results
      .map((r) => `【${r.category}】在 ${r.description}（${r.boxId}）`)
      .join("；");
    lines.push(`「${keyword}」→ ${boxes}`);
  }

  if (notFound.length > 0) {
    const nfNames = notFound.map((s) => s.keyword).join("、");
    lines.push(`「${nfNames}」目前庫中找不到，請確認是否已借出。`);
  }

  return lines.join("\n");
}

// ────────────────────────────────────────────────
// Route Handler
// ────────────────────────────────────────────────

/**
 * POST /api/iot/voice
 *
 * Pipeline: Bearer Auth → Groq STT → Gemini NLU (多關鍵字 + 名稱校正)
 *           → GAS Search (parallel) → Edge TTS → Response
 */
export async function POST(req: NextRequest) {
  try {
    // ── Step 0: 驗證硬體 Bearer Token ──
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

    // ── Step 1: 取得音訊檔案 ──
    const formData = await req.formData();
    const audioFile = formData.get("file") as File;
    if (!audioFile) {
      return NextResponse.json(
        { success: false, error: "Missing audio file" },
        { status: 400 },
      );
    }

    if (!process.env.GROQ_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing GROQ_API_KEY" },
        { status: 500 },
      );
    }
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { success: false, error: "Missing GEMINI_API_KEY" },
        { status: 500 },
      );
    }

    // ── Step 2: Groq Whisper STT ──
    const transcription = await groq.audio.transcriptions.create({
      file: audioFile,
      model: "whisper-large-v3",
      language: "zh",
    });
    const userText = transcription.text.trim();
    console.log("[Voice] STT result:", userText);

    // ── Step 3: Gemini NLU 意圖識別 + 名稱校正 ──
    const { intent, keywords } = await detectIntent(userText);
    console.log("[Voice] Intent:", intent, "Keywords:", keywords);

    const host = req.headers.get("host") || "localhost:3000";
    const protocol = req.headers.get("x-forwarded-proto") || "http";

    // 非尋物意圖
    if (intent === "other" || keywords.length === 0) {
      const replyText =
        "我只能協助您尋找社辦的器材喔，請說出您想找的器材名稱。";
      const audioBase64 = await generateTtsBase64(replyText);
      const audioUrl = `${protocol}://${host}/api/iot/voice/tts?text=${encodeURIComponent(replyText)}`;
      return NextResponse.json({
        success: true,
        intent: "other",
        text: userText,
        replyText,
        audioUrl,
        audioBase64,
        audioFormat: "mp3",
      });
    }

    // ── Step 4: 並行呼叫 GAS 搜尋（每個關鍵字獨立查詢）──
    const searchResults = await Promise.all(
      keywords.map(async (kw): Promise<KeywordSearchResult> => ({
        keyword: kw,
        results: await searchGas(kw),
      })),
    );
    console.log("[Voice] Search results:", JSON.stringify(searchResults));

    // ── Step 5: 組合 TTS 文字 ──
    const ttsText = buildTtsText(searchResults);

    // ── Step 6: TTS 生成 ──
    const audioBase64 = await generateTtsBase64(ttsText);
    const audioUrl = `${protocol}://${host}/api/iot/voice/tts?text=${encodeURIComponent(ttsText)}`;

    // ── Step 6.5: 發布 MQTT 亮燈命令（non-blocking，失敗不影響回應）──
    publishLedCommands(searchResults).catch((e) =>
      console.error("[MQTT] Unexpected error:", e),
    );

    // ── Step 7: 回傳整合 JSON ──
    return NextResponse.json({
      success: true,
      intent: "search",
      text: userText,
      keywords,
      searches: searchResults,
      replyText: buildReplyText(searchResults),
      audioUrl,
      audioBase64,
      audioFormat: "mp3",
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[Voice] Error:", message);
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}

/**
 * GET /api/iot/voice/tts
 *
 * 參數:
 *   ?text=xxx          必填，要合成的文字
 *   &format=pcm        回傳 raw 24kHz/16-bit/mono PCM (供 NodeMCU A2DP 直接導入)
 *   &format=wav        回傳 WAV 檔 (RIFF header + PCM)
 *   &format=mp3        預設，回傳 MP3
 *
 * ESP32-A2DP 建議使用 format=pcm：
 *   - 資料率: 24000 Hz
 *   - 聲道: 1 (mono)
 *   - 位元深度: 16-bit signed PCM
 *   - NodeMCU 經 HTTP chunked streaming 接收後，直接送進 A2DP callback
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const text = searchParams.get("text");
    const format = (searchParams.get("format") ?? "mp3").toLowerCase();

    if (!text) {
      return NextResponse.json(
        { success: false, error: "Missing text parameter" },
        { status: 400 },
      );
    }

    // ── PCM / WAV 格式: Edge TTS 直接輸出原始 PCM 或 WAV ──
    // Edge TTS 支援的格式:
    //   raw-24khz-16bit-mono-pcm  → 純 PCM byte stream
    //   riff-24khz-16bit-mono-pcm → WAV 檔 (RIFF header + PCM)
    if (format === "pcm" || format === "wav") {
      const outputFormat =
        format === "pcm"
          ? "raw-24khz-16bit-mono-pcm"
          : "riff-24khz-16bit-mono-pcm";
      const contentType =
        format === "pcm" ? "audio/L16;rate=24000;channels=1" : "audio/wav";

      try {
        const buf = await tts(text, {
          voice: "zh-TW-HsiaoChenNeural",
          // @ts-expect-error edge-tts 套件型別宣告未完全涉及 outputFormat
          outputFormat,
        });
        const uint8Array = new Uint8Array(buf);
        return new NextResponse(uint8Array, {
          headers: {
            "Content-Type": contentType,
            "Content-Length": uint8Array.byteLength.toString(),
            // 讓 NodeMCU 知道哪處開始撷 WAV header
            "X-Audio-SampleRate": "24000",
            "X-Audio-Channels": "1",
            "X-Audio-BitDepth": "16",
          },
        });
      } catch (e) {
        console.warn("[Voice GET] Edge TTS PCM failed:", e);
        return NextResponse.json(
          { success: false, error: "Edge TTS PCM failed, only Edge TTS supports raw PCM" },
          { status: 502 },
        );
      }
    }

    // ── MP3 格式: Edge TTS → Google TTS fallback ──
    try {
      const buf = await tts(text, { voice: "zh-TW-HsiaoChenNeural" });
      const uint8Array = new Uint8Array(buf);
      return new NextResponse(uint8Array, {
        headers: {
          "Content-Type": "audio/mpeg",
          "Content-Length": uint8Array.byteLength.toString(),
        },
      });
    } catch (e) {
      console.warn("[Voice GET] Edge TTS failed, trying Google TTS:", e);
    }

    try {
      const googleTtsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=zh-TW&client=tw-ob`;
      const res = await fetch(googleTtsUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/100.0.0.0 Safari/537.36",
        },
      });
      if (res.ok) {
        const arrayBuffer = await res.arrayBuffer();
        return new NextResponse(arrayBuffer, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Content-Length": arrayBuffer.byteLength.toString(),
          },
        });
      }
    } catch (e) {
      console.warn("[Voice GET] Google TTS failed:", e);
    }

    return NextResponse.json(
      { success: false, error: "All TTS engines failed" },
      { status: 500 },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
