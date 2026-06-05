/**
 * POST /api/iot/search/text
 * 網頁文字版器材搜尋（跳過 STT/TTS）
 *
 * Body: { "query": "我要找Arduino Uno" }
 * Response: { success, keywords, searches, replyText }
 */
import { NextRequest, NextResponse } from "next/server";
import Groq from "groq-sdk";
import mqtt from "mqtt";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY || "" });

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL ?? "";

// 複用 voice/route.ts 的設備清單（同步更新）
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
];

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

// ── Groq NLU ────────────────────────────────────────────────────────────
async function extractKeywords(query: string): Promise<string[]> {
  const prompt = `
你是一個實驗室器材管理系統的 NLU 模組。
器材庫存清單：${EQUIPMENT_LIST.join("、")}

使用者輸入：「${query}」

請從上方器材庫存清單中，找出使用者想尋找的器材名稱（可以多個）。
請只輸出 JSON 物件，格式如下：
{
  "keywords": ["Arduino Uno", "超音波傳感器"]
}
如果找不到對應器材，回傳：
{
  "keywords": []
}
`.trim();

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
    const parsed = JSON.parse(raw) as { keywords: string[] };
    return Array.isArray(parsed.keywords) ? parsed.keywords : [];
  } catch (err) {
    console.error("[Text Search] Groq NLU error:", err);
    return [];
  }
}

// ── GAS 搜尋 ───────────────────────────────────────────────────────────────
async function searchGas(keyword: string): Promise<GasSearchResult[]> {
  const url = `${GAS_API_URL}?route=iot/search/voice&keyword=${encodeURIComponent(keyword)}`;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!data.success) return [];
  return (data.data?.results ?? []) as GasSearchResult[];
}

// ── 回覆文字組合 ───────────────────────────────────────────────────────────
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
      .map((r) => `在貼著「${r.category}」的箱子裡，位置在 ${r.description}（ID: ${r.boxId}）`)
      .join("；");
    lines.push(`「${keyword}」 ${boxes}`);
  }

  if (notFound.length > 0) {
    const nfNames = notFound.map((s) => s.keyword).join("、");
    lines.push(`「${nfNames}」目前庫中找不到，請確認是否已借出。`);
  }

  return lines.join("\n");
}

// ── MQTT 亮燈（複用 voice route 的邏輯）──────────────────────────────────
async function publishLedCommands(searches: KeywordSearchResult[]): Promise<void> {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  const port = parseInt(process.env.MQTT_PORT || "8883", 10);

  if (!brokerUrl || !username || !password) return;

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
      clientId: `rrc-text-${Date.now()}`,
      connectTimeout: 5000,
    });

    client.on("connect", () => {
      const publishes = Object.entries(devicePins).map(
        ([deviceId, pins]) =>
          new Promise<void>((res, rej) => {
            const msg = JSON.stringify({ pins: [...pins], duration: 10000 });
            client.publish(`rrc/led/${deviceId}`, msg, { qos: 1 }, (err) =>
              err ? rej(err) : res(),
            );
          }),
      );

      Promise.allSettled(publishes).then(() => {
        client.end();
        resolve();
      });
    });

    client.on("error", () => {
      client.end();
      resolve();
    });
  });
}

// ── Route Handler ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const { query } = await req.json();
    if (!query?.trim()) {
      return NextResponse.json(
        { success: false, error: "query is required" },
        { status: 400 },
      );
    }

    // Step 1: Gemini NLU
    const keywords = await extractKeywords(query.trim());
    if (keywords.length === 0) {
      return NextResponse.json({
        success: true,
        keywords: [],
        searches: [],
        replyText: "我不太確定您在找什麼器材，可以說得更具體嗎？（例如：「我要找Arduino」）",
      });
    }

    // Step 2: GAS 搜尋
    const searchResults: KeywordSearchResult[] = await Promise.all(
      keywords.map(async (kw) => ({
        keyword: kw,
        results: await searchGas(kw),
      })),
    );

    // Step 3: 組合回覆文字
    const replyText = buildReplyText(searchResults);

    // Step 4: MQTT 亮燈（non-blocking）
    publishLedCommands(searchResults).catch((e) =>
      console.error("[Text Search] MQTT error:", e),
    );

    return NextResponse.json({
      success: true,
      keywords,
      searches: searchResults,
      replyText,
    });
  } catch (err) {
    console.error("[Text Search] Error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
