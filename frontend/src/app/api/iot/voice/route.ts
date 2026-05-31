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
