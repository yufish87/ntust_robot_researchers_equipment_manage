import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { tts } from "edge-tts";
import mqtt from "mqtt";

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL;
const IOT_BEARER_TOKEN = process.env.IOT_BEARER_TOKEN;

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

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

/** TTS: Edge TTS 主要方案 → OpenAI fallback */
async function generateTtsBase64(text: string): Promise<string> {
  try {
    const buf = await tts(text, { voice: "zh-TW-HsiaoChenNeural" });
    return buf.toString("base64");
  } catch (e) {
    console.warn("Edge TTS failed, trying OpenAI TTS:", e);
  }

  if (process.env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "tts-1", voice: "alloy", input: text }),
    });
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer()).toString("base64");
    }
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
  const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

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

使用者說：${text}`;

  const result = await model.generateContent(prompt);
  const raw = result.response.text().trim();
  const cleaned = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");

  try {
    const parsed = JSON.parse(cleaned) as { intent: string; keywords: string[] };
    if (
      parsed.intent === "search" &&
      Array.isArray(parsed.keywords) &&
      parsed.keywords.length > 0
    ) {
      return { intent: "search", keywords: parsed.keywords };
    }
    return { intent: "other", keywords: [] };
  } catch {
    console.warn("[Voice] Gemini NLU parse failed, raw:", raw);
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
        `${keyword}在${results[0].category}類別，箱子在${results[0].description}`,
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

    // 非尋物意圖
    if (intent === "other" || keywords.length === 0) {
      const replyText =
        "我只能協助您尋找社辦的器材喔，請說出您想找的器材名稱。";
      const audioBase64 = await generateTtsBase64(replyText);
      return NextResponse.json({
        success: true,
        intent: "other",
        text: userText,
        replyText,
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
      replyText: ttsText,
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
