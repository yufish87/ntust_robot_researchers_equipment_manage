/**
 * POST /api/iot/led
 * QR 掃描後亮燈 / 確認領取後熄燈
 *
 * Body:
 *   { "items": [{"name": "Arduino Uno (附線)", "code": "EQ00001"}, ...],
 *     "duration": 180000,
 *     "action": "on" | "off" }
 *
 * on  → 依 code 或 name 查詢 GAS，MQTT publish 亮燈
 * off → MQTT publish duration=0 立即熄燈
 */
import { NextRequest, NextResponse } from "next/server";
import mqtt from "mqtt";

export const dynamic = "force-dynamic";

const GAS_API_URL = process.env.NEXT_PUBLIC_GAS_API_URL ?? "";

// ── MQTT helper（與 voice/route.ts 相同架構）──────────────────────────────
function mqttPublishBatch(
  devicePins: Record<string, Set<number>>,
  duration: number,
): Promise<void> {
  const brokerUrl = process.env.MQTT_BROKER_URL;
  const username = process.env.MQTT_USERNAME;
  const password = process.env.MQTT_PASSWORD;
  const port = parseInt(process.env.MQTT_PORT || "8883", 10);

  if (!brokerUrl || !username || !password) return Promise.resolve();
  if (Object.keys(devicePins).length === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    const client = mqtt.connect(`mqtts://${brokerUrl}`, {
      port,
      username,
      password,
      clientId: `rrc-led-${Date.now()}`,
      connectTimeout: 5000,
    });

    client.on("connect", () => {
      const publishes = Object.entries(devicePins).map(
        ([deviceId, pins]) =>
          new Promise<void>((res, rej) => {
            const msg = JSON.stringify({ pins: [...pins], duration });
            client.publish(`rrc/led/${deviceId}`, msg, { qos: 1 }, (err) =>
              err ? rej(err) : res(),
            );
          }),
      );

      Promise.allSettled(publishes).then((results) => {
        results.forEach((r) => {
          if (r.status === "rejected")
            console.error("[LED API] MQTT publish error:", r.reason);
        });
        client.end();
        resolve();
      });
    });

    client.on("error", (err) => {
      console.error("[LED API] MQTT connection error:", err.message);
      client.end();
      resolve();
    });
  });
}

// ── GAS 查詢 helper ───────────────────────────────────────────────────────
interface LedTarget {
  deviceId: string;
  ledPin: string;
}

async function searchByCode(code: string): Promise<LedTarget[]> {
  const url = `${GAS_API_URL}?route=iot/search/code&code=${encodeURIComponent(code)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!data.success) return [];
    return (data.data?.results ?? []) as LedTarget[];
  } catch {
    return [];
  }
}

async function searchByName(name: string): Promise<LedTarget[]> {
  const url = `${GAS_API_URL}?route=iot/search/voice&keyword=${encodeURIComponent(name)}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    const data = await res.json();
    if (!data.success) return [];
    return (data.data?.results ?? []) as LedTarget[];
  } catch {
    return [];
  }
}

// ── 收集所有目標 deviceId → pins ────────────────────────────────────────
async function collectDevicePins(
  items: { name?: string; code?: string }[],
): Promise<Record<string, Set<number>>> {
  const devicePins: Record<string, Set<number>> = {};

  const addTargets = (targets: LedTarget[]) => {
    for (const t of targets) {
      if (!t.deviceId || !t.ledPin) continue;
      const pin = parseInt(t.ledPin, 10);
      if (isNaN(pin)) continue;
      if (!devicePins[t.deviceId]) devicePins[t.deviceId] = new Set();
      devicePins[t.deviceId].add(pin);
    }
  };

  // 並行查詢所有 items
  await Promise.all(
    items.map(async (item) => {
      if (item.code) {
        addTargets(await searchByCode(item.code));
      } else if (item.name) {
        addTargets(await searchByName(item.name));
      }
    }),
  );

  return devicePins;
}

// ── 熄燈：對所有已知 deviceId 發 duration=0 ──────────────────────────────
const KNOWN_DEVICE_IDS = ["ESP32_C1_L1"]; // 擴充時加入

function buildOffPayload(): Record<string, Set<number>> {
  const ALL_PINS = [21, 9, 10]; // LED A/B/C GPIO
  const devicePins: Record<string, Set<number>> = {};
  for (const id of KNOWN_DEVICE_IDS) {
    devicePins[id] = new Set(ALL_PINS);
  }
  return devicePins;
}

// ── Route Handler ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { items = [], duration = 10000, action = "on" } = body;

    if (action === "off") {
      await mqttPublishBatch(buildOffPayload(), 0);
      return NextResponse.json({ success: true, action: "off" });
    }

    // action === "on"
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { success: false, error: "items is required for action=on" },
        { status: 400 },
      );
    }

    const devicePins = await collectDevicePins(items);
    await mqttPublishBatch(devicePins, duration);

    const activated = Object.entries(devicePins).map(([deviceId, pins]) => ({
      deviceId,
      pins: [...pins],
    }));

    return NextResponse.json({ success: true, action: "on", activated, duration });
  } catch (err) {
    console.error("[LED API] Error:", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
