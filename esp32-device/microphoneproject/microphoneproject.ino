#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <BluetoothA2DPSource.h>
#include <AudioFileSource.h>
#include <AudioGeneratorMP3.h>
#include <AudioOutput.h>
#include "driver/i2s_std.h"

// ================================================================
// ESP32 節點一：語音尋物與多媒體互動站
// ------------------------------------------------
// 整體流程：
// 1. 連上 Wi-Fi。
// 2. 等待 GPIO18 按鈕被按下。
// 3. 按住按鈕時持續錄音，放開按鈕後停止錄音。
// 4. 將實際錄到的音訊封裝成 WAV 格式。
// 5. 以 multipart/form-data POST 到 Vercel API URL。
//    後端 route.ts 會用 formData.get("file") 取得音訊檔。
// 6. 後端完成 STT / NLU / GAS 查詢 / MQTT LED 控制後回傳 JSON。
// 7. route.ts 回傳 audioUrl/audio_url，ESP32 端會下載 MP3 或 WAV，
//    並透過 Classic Bluetooth A2DP 串流到藍牙喇叭播放。
//
// 注意：
// - 目前播放端改用藍牙喇叭，不再使用 PAM8403 / GPIO25。
// - 後端建議回傳 MP3 URL，ESP32 會先下載到 RAM，再解碼成 PCM 給藍牙喇叭。
// - MP3 請盡量使用低 bitrate、短句，並控制在 MAX_PLAYBACK_MP3_BYTES 以內。
// ================================================================

// ===== 使用者設定區 =====
// 這裡是你最常需要改的地方：Wi-Fi 名稱、密碼、Vercel API URL。
// 程式不使用 API key，會直接把錄到的 WAV 上傳到 VOICE_API_URL。
const char *WIFI_SSID = "";
const char *WIFI_PASSWORD = "";

// 語音查詢 API：
// ESP32 會對這個 URL 發送 HTTP POST。
// Body 是 multipart/form-data，欄位名稱必須是 file。
// 對應 route.ts：
// const formData = await req.formData();
// const audioFile = formData.get("file") as File;
//
// 後端回傳 JSON，例如：
// {
//   "success": true,
//   "intent": "search",
//   "text": "我要找 Arduino",
//   "replyText": "...",
//   "audioUrl": "https://.../reply.mp3",
//   "audioFormat": "mp3"
// }
const char *VOICE_API_URL = "";

// Vercel API Bearer Token：
// 後端若需要驗證，HTTP header 會送出：
// Authorization: Bearer 
const char *API_BEARER_TOKEN = "";

// 裝置編號：
// 用在 HTTP header / JSON 裡，讓後端知道是哪一台 ESP32 發出的請求。
const char *DEVICE_ID = "ESP32_VOICE_NODE_1";

// 藍牙喇叭名稱：
// 請改成你手機/電腦掃描到的藍牙喇叭名稱，大小寫和空格都要一致。
const char *BT_SPEAKER_NAME = "T10";
const char *BT_LOCAL_NAME = "ESP32_RRC_VOICE";

// ===== NodeMCU-32S 接線設定 =====
// 錄音按鈕：
// GPIO18 -> 按鈕 -> GND
//
// 程式使用 INPUT_PULLUP：
// - 平常未按下時，GPIO18 會被內建上拉成 HIGH
// - 按下時接到 GND，讀到 LOW
// 如果你的按鈕是接 3V3，請把 pinMode 改成 INPUT_PULLDOWN，
// 並將 BUTTON_ACTIVE_LEVEL 改成 HIGH。
const int RECORD_BUTTON_PIN = 18;
const int BUTTON_ACTIVE_LEVEL = LOW;

// INMP441 I2S 麥克風：
// SD  -> GPIO34
// WS  -> GPIO32
// SCK -> GPIO14
// L/R -> 3V3
//
// INMP441 的 L/R 腳決定聲道：
// - L/R 接 GND 通常是 LEFT channel
// - L/R 接 3V3 通常是 RIGHT channel
// 你目前接 3V3，所以程式用新版 I2S 的 I2S_STD_SLOT_RIGHT 讀右聲道。
const int I2S_MIC_SD_PIN = 34;
const int I2S_MIC_WS_PIN = 32;
const int I2S_MIC_SCK_PIN = 14;

// ===== 音訊設定區 =====
// ESP32 有兩組 I2S 控制器：
// - I2S_NUM_1 用來接 INMP441 收音
// - I2S_NUM_0 不再用於播放；播放改走 Classic Bluetooth A2DP
//
// 注意：ESP32 內建 DAC 播放只能走 I2S0，所以麥克風必須避開 I2S0。
const i2s_port_t MIC_I2S_PORT = I2S_NUM_1;
i2s_chan_handle_t micRxChannel = nullptr;

// 錄音格式：
// 8000 Hz / 16-bit / mono 可以大幅降低 RAM 與 HTTPS 上傳壓力。
// Whisper/STT 仍可處理這種語音 WAV；若辨識效果不足，再改回 16000。
const uint32_t RECORD_SAMPLE_RATE = 8000;
// NodeMCU-32S 通常沒有 PSRAM，錄太長可能導致 malloc 或 TLS 連線失敗。
// 2 秒 8 kHz WAV 約 32 KB，比較適合沒有 PSRAM 且同時跑 Wi-Fi/藍牙的 ESP32。
// 若 Serial 顯示記憶體足夠，可再調高。
const uint16_t MAX_RECORD_SECONDS = 2;

// WAV 記憶體大小：
// MAX_RECORD_SAMPLE_COUNT = 最多可錄的取樣點數
// MAX_AUDIO_BYTES = 最長 PCM 原始音訊資料大小
// MAX_WAV_BYTES = 44 bytes WAV header + 最長 PCM 資料
// 實際上傳時不一定會傳滿 MAX_WAV_BYTES，而是依照放開按鈕時的實際錄音長度上傳。
const size_t MAX_RECORD_SAMPLE_COUNT = RECORD_SAMPLE_RATE * MAX_RECORD_SECONDS;
const size_t WAV_HEADER_SIZE = 44;
const size_t MAX_AUDIO_BYTES = MAX_RECORD_SAMPLE_COUNT * sizeof(int16_t);
const size_t MAX_WAV_BYTES = WAV_HEADER_SIZE + MAX_AUDIO_BYTES;

// 按鈕錄音設定：
// BUTTON_DEBOUNCE_MS：按鈕防抖時間，避免機械彈跳造成誤判。
// MIN_RECORD_MS：太短的錄音通常是誤觸，低於這個時間就不上傳。
// QUERY_COOLDOWN_MS：避免剛上傳完後立刻再次觸發。
const uint32_t BUTTON_DEBOUNCE_MS = 30;
const uint32_t MIN_RECORD_MS = 300;
const uint32_t QUERY_COOLDOWN_MS = 500;
const size_t MAX_HTTP_RESPONSE_CHARS = 3000;
const size_t BT_AUDIO_BUFFER_BYTES = 6144;
const size_t MAX_PLAYBACK_WAV_BYTES = 90000;
const size_t MAX_PLAYBACK_MP3_BYTES = 80000;
const bool PLAY_ONLY_LAST_MP3_BYTES = false;
const bool PLAY_ONLY_FIRST_MP3_BYTES = true;
const size_t MP3_HEAD_TEST_BYTES = 12000;
const size_t MP3_TAIL_TEST_BYTES = 8000;

// wavBuffer 會存完整 WAV 檔，錄完後直接拿來 POST。
// 2 秒 8 kHz 16-bit mono 約 32 KB，加上 header 後約 32044 bytes。
// lastWavBytes 會記錄這次實際錄到的 WAV 長度。
uint8_t wavBufferStorage[MAX_WAV_BYTES];
uint8_t *wavBuffer = wavBufferStorage;
size_t lastWavBytes = 0;
uint32_t lastQueryAt = 0;
uint32_t lastIdleMemNoticeAt = 0;
BluetoothA2DPSource a2dpSource;
bool bluetoothStarted = false;
uint8_t btAudioBuffer[BT_AUDIO_BUFFER_BYTES];
size_t btAudioReadPos = 0;
size_t btAudioWritePos = 0;
size_t btAudioFill = 0;
volatile uint32_t btCallbackCount = 0;
volatile uint32_t btCallbackBytesCopied = 0;
volatile uint32_t btFramesQueued = 0;
volatile uint32_t btUnderflowBytes = 0;
volatile esp_a2d_connection_state_t btLastConnectionState = ESP_A2D_CONNECTION_STATE_DISCONNECTED;
volatile esp_a2d_audio_state_t btLastAudioState = ESP_A2D_AUDIO_STATE_SUSPEND;
uint8_t btLastFrame[4] = {0, 0, 0, 0};
uint8_t btLastFrameIndex = 0;
portMUX_TYPE btAudioMux = portMUX_INITIALIZER_UNLOCKED;
struct ParsedUrl {
  bool https = true;
  String host;
  String path = "/";
  uint16_t port = 443;
};

struct PlaybackWavInfo {
  uint32_t dataSize = 0;
  uint32_t sampleRate = 44100;
  uint16_t channels = 2;
  uint16_t bitsPerSample = 16;
};

void shutdownBluetoothAudio(bool releaseMemory = true);

const char *btConnectionStateName(esp_a2d_connection_state_t state) {
  switch (state) {
    case ESP_A2D_CONNECTION_STATE_DISCONNECTED:
      return "DISCONNECTED";
    case ESP_A2D_CONNECTION_STATE_CONNECTING:
      return "CONNECTING";
    case ESP_A2D_CONNECTION_STATE_CONNECTED:
      return "CONNECTED";
    case ESP_A2D_CONNECTION_STATE_DISCONNECTING:
      return "DISCONNECTING";
    default:
      return "UNKNOWN";
  }
}

const char *btAudioStateName(esp_a2d_audio_state_t state) {
  switch (state) {
    case ESP_A2D_AUDIO_STATE_STARTED:
      return "STARTED";
    case ESP_A2D_AUDIO_STATE_SUSPEND:
      return "SUSPEND/STOPPED";
    default:
      return "UNKNOWN";
  }
}

void onBtConnectionStateChanged(esp_a2d_connection_state_t state, void *obj) {
  (void)obj;
  btLastConnectionState = state;
  Serial.printf("[BT STATE] connection=%s (%d), freeHeap=%u\n",
                btConnectionStateName(state),
                (int)state,
                (unsigned int)ESP.getFreeHeap());
}

void onBtAudioStateChanged(esp_a2d_audio_state_t state, void *obj) {
  (void)obj;
  btLastAudioState = state;
  Serial.printf("[BT STATE] audio=%s (%d), callbacks=%u, buffered=%u, freeHeap=%u\n",
                btAudioStateName(state),
                (int)state,
                (unsigned int)btCallbackCount,
                (unsigned int)btAudioFill,
                (unsigned int)ESP.getFreeHeap());
}

void clearBtAudioBuffer() {
  portENTER_CRITICAL(&btAudioMux);
  btAudioReadPos = 0;
  btAudioWritePos = 0;
  btAudioFill = 0;
  btLastFrameIndex = 0;
  portEXIT_CRITICAL(&btAudioMux);
}

size_t writeBtAudioBuffer(const uint8_t *data, size_t len, uint32_t timeoutMs = 200) {
  size_t written = 0;
  uint32_t startedAt = millis();

  while (written < len) {
    bool wroteOne = false;
    portENTER_CRITICAL(&btAudioMux);
    if (btAudioFill < BT_AUDIO_BUFFER_BYTES) {
      btAudioBuffer[btAudioWritePos] = data[written++];
      btAudioWritePos = (btAudioWritePos + 1) % BT_AUDIO_BUFFER_BYTES;
      btAudioFill++;
      wroteOne = true;
    }
    portEXIT_CRITICAL(&btAudioMux);

    if (!wroteOne) {
      if (millis() - startedAt >= timeoutMs) {
        break;
      }
      delay(1);
    }
  }

  return written;
}

int32_t btAudioDataCallback(uint8_t *data, int32_t len) {
  // ESP32-A2DP 會持續呼叫這個 callback 取 PCM bytes。
  // 如果 buffer 暫時沒資料，就補 0，避免藍牙喇叭爆音。
  int32_t copied = 0;
  int32_t copiedFromBuffer = 0;
  btCallbackCount++;

  portENTER_CRITICAL(&btAudioMux);
  while (copied < len && btAudioFill > 0) {
    uint8_t value = btAudioBuffer[btAudioReadPos];
    data[copied++] = value;
    btLastFrame[btLastFrameIndex] = value;
    btLastFrameIndex = (btLastFrameIndex + 1) & 0x03;
    copiedFromBuffer++;
    btAudioReadPos = (btAudioReadPos + 1) % BT_AUDIO_BUFFER_BYTES;
    btAudioFill--;
  }
  portEXIT_CRITICAL(&btAudioMux);

  while (copied < len) {
    data[copied++] = btLastFrame[btLastFrameIndex];
    btLastFrameIndex = (btLastFrameIndex + 1) & 0x03;
  }

  btCallbackBytesCopied += copiedFromBuffer;
  btUnderflowBytes += (len - copiedFromBuffer);
  return len;
}

void setupBluetoothAudio() {
  if (bluetoothStarted) {
    return;
  }

  printStage("正在啟動藍牙 A2DP Source...");
  Serial.print("[BT] Target speaker: ");
  Serial.println(BT_SPEAKER_NAME);
  Serial.printf("[MEM] Free heap before BT start: %u bytes\n", (unsigned int)ESP.getFreeHeap());

  clearBtAudioBuffer();
  btCallbackCount = 0;
  btCallbackBytesCopied = 0;
  btFramesQueued = 0;
  btUnderflowBytes = 0;
  btLastConnectionState = ESP_A2D_CONNECTION_STATE_DISCONNECTED;
  btLastAudioState = ESP_A2D_AUDIO_STATE_SUSPEND;
  a2dpSource.set_local_name(BT_LOCAL_NAME);
  a2dpSource.set_on_connection_state_changed(onBtConnectionStateChanged);
  a2dpSource.set_on_audio_state_changed(onBtAudioStateChanged);
  a2dpSource.set_on_audio_state_changed_post(onBtAudioStateChanged);
  a2dpSource.set_event_queue_size(8);
  a2dpSource.set_event_stack_size(2048);
  a2dpSource.set_auto_reconnect(false);
  a2dpSource.set_volume(105);
  a2dpSource.start_raw(BT_SPEAKER_NAME, btAudioDataCallback);

  bluetoothStarted = true;
  Serial.printf("[MEM] Free heap after BT start: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  printStage("藍牙 A2DP 已啟動，等待喇叭連線");
}

bool waitForBluetoothSpeaker(uint32_t timeoutMs = 25000) {
  setupBluetoothAudio();

  if (a2dpSource.is_connected()) {
    Serial.printf("[BT STATE] already connected, audio=%s, callbacks=%u\n",
                  btAudioStateName(a2dpSource.get_audio_state()),
                  (unsigned int)btCallbackCount);
    return true;
  }

  printStage("等待藍牙喇叭連線...");
  uint32_t startedAt = millis();
  uint32_t lastNoticeAt = startedAt;
  while (!a2dpSource.is_connected() && millis() - startedAt < timeoutMs) {
    if (millis() - lastNoticeAt >= 5000) {
      Serial.printf("[BT] Waiting... %lu/%lu ms, free heap=%u bytes\n",
                    (unsigned long)(millis() - startedAt),
                    (unsigned long)timeoutMs,
                    (unsigned int)ESP.getFreeHeap());
      lastNoticeAt = millis();
    }
    delay(250);
  }

  if (!a2dpSource.is_connected()) {
    printStage("藍牙喇叭尚未連線，無法播放");
    shutdownBluetoothAudio();
    return false;
  }

  printStage("藍牙喇叭已連線");
  Serial.printf("[BT STATE] connected, audio=%s, callbacks=%u\n",
                btAudioStateName(a2dpSource.get_audio_state()),
                (unsigned int)btCallbackCount);
  return true;
}

bool waitForBluetoothAudioCallback(uint32_t timeoutMs = 12000) {
  if (btCallbackCount > 0) {
    Serial.printf("[BT STATE] A2DP callback already active: callbacks=%u, audio=%s\n",
                  (unsigned int)btCallbackCount,
                  btAudioStateName(a2dpSource.get_audio_state()));
    return true;
  }

  printStage("等待藍牙 A2DP 音訊串流啟動...");
  uint32_t startedAt = millis();
  uint32_t lastNoticeAt = startedAt;
  while (btCallbackCount == 0 && millis() - startedAt < timeoutMs) {
    if (millis() - lastNoticeAt >= 2000) {
      Serial.printf("[BT STATE] waiting audio callback... %lu/%lu ms, conn=%s, audio=%s, freeHeap=%u\n",
                    (unsigned long)(millis() - startedAt),
                    (unsigned long)timeoutMs,
                    btConnectionStateName(a2dpSource.get_connection_state()),
                    btAudioStateName(a2dpSource.get_audio_state()),
                    (unsigned int)ESP.getFreeHeap());
      lastNoticeAt = millis();
    }
    delay(50);
  }

  if (btCallbackCount == 0) {
    printStage("藍牙已連線，但 A2DP 沒有開始取音訊資料");
    Serial.println("[BT] callbacks=0 means the speaker connection exists, but media streaming did not start.");
    Serial.println("[BT] Try turning the speaker off/on, clearing old pairing, or testing another A2DP speaker.");
    return false;
  }

  printStage("藍牙 A2DP 音訊串流已啟動");
  Serial.printf("[BT STATE] callback active: callbacks=%u, audio=%s\n",
                (unsigned int)btCallbackCount,
                btAudioStateName(a2dpSource.get_audio_state()));
  return true;
}

void shutdownBluetoothAudio(bool releaseMemory) {
  if (!bluetoothStarted) {
    return;
  }

  printStage(releaseMemory ? "正在關閉藍牙以釋放記憶體..." : "正在保守停止藍牙播放...");
  clearBtAudioBuffer();
  delay(200);
  a2dpSource.end(releaseMemory);
  bluetoothStarted = false;
  clearBtAudioBuffer();
  delay(releaseMemory ? 600 : 300);
  Serial.printf("[MEM] Free heap after BT end: %u bytes\n", (unsigned int)ESP.getFreeHeap());
}

void printStage(const char *message) {
  // 統一的階段提示格式。
  // Serial Monitor 看到 [STAGE] 就代表目前流程進度。
  Serial.print("[STAGE] ");
  Serial.println(message);
}

bool ensureWavBuffer() {
  // 錄音 buffer 改成固定全域陣列，避免反覆 malloc/free 後 heap 碎片化。
  wavBuffer = wavBufferStorage;
  Serial.printf("[MEM] Free heap before recording: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  Serial.printf("[MEM] Static WAV buffer ready: %u bytes\n", (unsigned int)MAX_WAV_BYTES);
  return true;
}

void releaseWavBuffer() {
  // wavBufferStorage 是固定全域陣列，不能 free；只清掉本次錄音長度。
  wavBuffer = wavBufferStorage;
  lastWavBytes = 0;
  Serial.printf("[MEM] Static WAV buffer marked reusable. Free heap now: %u bytes\n", (unsigned int)ESP.getFreeHeap());
}

String bearerAuthorizationHeader() {
  // Vercel 後端常見驗證格式：
  // Authorization: Bearer <token>
  return String("Bearer ") + API_BEARER_TOKEN;
}

bool parseHttpUrl(const char *url, ParsedUrl &parsed) {
  // 將 https://domain/path 拆成 host、path、port，方便用 WiFiClient 手動送 multipart。
  String value(url);
  int schemeEnd = value.indexOf("://");
  if (schemeEnd < 0) {
    return false;
  }

  String scheme = value.substring(0, schemeEnd);
  parsed.https = scheme == "https";
  parsed.port = parsed.https ? 443 : 80;

  int hostStart = schemeEnd + 3;
  int pathStart = value.indexOf('/', hostStart);
  String hostPort = pathStart >= 0 ? value.substring(hostStart, pathStart) : value.substring(hostStart);
  parsed.path = pathStart >= 0 ? value.substring(pathStart) : "/";

  int colon = hostPort.indexOf(':');
  if (colon >= 0) {
    parsed.host = hostPort.substring(0, colon);
    parsed.port = hostPort.substring(colon + 1).toInt();
  } else {
    parsed.host = hostPort;
  }

  return parsed.host.length() > 0;
}

String readHttpLine(Client &client, uint32_t timeoutMs = 60000) {
  String line;
  uint32_t startedAt = millis();
  uint32_t lastNoticeAt = startedAt;
  while (millis() - startedAt < timeoutMs) {
    while (client.available()) {
      char c = (char)client.read();
      line += c;
      if (c == '\n') {
        return line;
      }
    }
    if (!client.connected() && !client.available()) {
      break;
    }
    if (timeoutMs >= 30000 && line.length() == 0 && millis() - lastNoticeAt >= 5000) {
      Serial.printf("[HTTP] Still waiting... %lu/%lu ms, free heap=%u bytes\n",
                    (unsigned long)(millis() - startedAt),
                    (unsigned long)timeoutMs,
                    (unsigned int)ESP.getFreeHeap());
      lastNoticeAt = millis();
    }
    delay(1);
  }
  return line;
}

bool writeAll(Client &client, const uint8_t *data, size_t length, const char *label) {
  // WiFiClientSecure::write(buffer, len) 不保證一次會把整包資料送完。
  // 若只送出部分 bytes，Vercel 會一直等待 Content-Length 剩餘資料，
  // ESP32 這邊就會卡在等 HTTP status line。
  const size_t CHUNK_SIZE = 1024;
  size_t sent = 0;
  uint32_t lastNoticeAt = millis();

  while (sent < length) {
    if (!client.connected()) {
      Serial.printf("[UPLOAD] %s failed: connection closed at %u/%u bytes\n",
                    label,
                    (unsigned int)sent,
                    (unsigned int)length);
      return false;
    }

    size_t toWrite = min(CHUNK_SIZE, length - sent);
    size_t written = client.write(data + sent, toWrite);
    if (written == 0) {
      delay(5);
      continue;
    }

    sent += written;

    if (millis() - lastNoticeAt >= 1000) {
      Serial.printf("[UPLOAD] %s %u/%u bytes\n",
                    label,
                    (unsigned int)sent,
                    (unsigned int)length);
      lastNoticeAt = millis();
    }
  }

  Serial.printf("[UPLOAD] %s done: %u bytes\n", label, (unsigned int)sent);
  return true;
}

String readHttpBodyPreview(Client &client, int contentLength, bool chunked, size_t maxChars = 2500) {
  // route.ts 現在只需要回傳 audioUrl/audio_url，JSON 會很小。
  // 這裡仍保留上限，避免後端意外回傳過大的內容。
  String body;
  body.reserve(maxChars + 32);

  if (chunked) {
    while (client.connected() || client.available()) {
      String sizeLine = readHttpLine(client);
      sizeLine.trim();
      if (sizeLine.length() == 0) {
        continue;
      }

      int chunkSize = (int)strtol(sizeLine.c_str(), nullptr, 16);
      if (chunkSize <= 0) {
        readHttpLine(client);
        break;
      }

      for (int i = 0; i < chunkSize; i++) {
        uint32_t startedAt = millis();
        while (!client.available() && millis() - startedAt < 10000) {
          delay(1);
        }
        if (!client.available()) {
          break;
        }
        char c = (char)client.read();
        if (body.length() < maxChars) {
          body += c;
        }
      }

      // chunk 後面會有 CRLF。
      readHttpLine(client);
      if (body.length() >= maxChars) {
        break;
      }
    }
    return body;
  }

  int readCount = 0;
  while ((contentLength < 0 || readCount < contentLength) && (client.connected() || client.available())) {
    if (!client.available()) {
      delay(1);
      continue;
    }
    char c = (char)client.read();
    readCount++;
    if (body.length() < maxChars) {
      body += c;
    }
    if (body.length() >= maxChars) {
      break;
    }
  }

  return body;
}

String extractJsonStringPreview(const String &json, const char *key) {
  // 從回應預覽中抓簡單字串欄位，讓 Serial 可看到 STT / replyText。
  // 這不是完整 JSON parser，只用於顯示 route.ts 回傳摘要。
  String pattern = String("\"") + key + "\":";
  int keyPos = json.indexOf(pattern);
  if (keyPos < 0) {
    return "";
  }

  int quoteStart = json.indexOf('"', keyPos + pattern.length());
  if (quoteStart < 0) {
    return "";
  }

  String value;
  bool escaping = false;
  for (int i = quoteStart + 1; i < json.length(); i++) {
    char c = json[i];
    if (escaping) {
      if (c == 'n') {
        value += '\n';
      } else {
        value += c;
      }
      escaping = false;
      continue;
    }
    if (c == '\\') {
      escaping = true;
      continue;
    }
    if (c == '"') {
      break;
    }
    value += c;
  }
  return value;
}

bool readExact(Stream *stream, uint8_t *buffer, size_t len) {
  size_t got = 0;
  uint32_t startedAt = millis();
  while (got < len && millis() - startedAt < 5000) {
    if (stream->available()) {
      int c = stream->read();
      if (c >= 0) {
        buffer[got++] = (uint8_t)c;
      }
    } else {
      delay(1);
    }
  }
  return got == len;
}

bool skipStreamBytes(Stream *stream, uint32_t len) {
  uint8_t scratch[64];
  while (len > 0) {
    size_t n = min((uint32_t)sizeof(scratch), len);
    if (!readExact(stream, scratch, n)) {
      return false;
    }
    len -= n;
  }
  return true;
}

bool parsePlaybackWavHeader(Stream *stream, PlaybackWavInfo &info) {
  uint8_t header[12];
  if (!readExact(stream, header, sizeof(header))) {
    return false;
  }
  if (memcmp(header, "RIFF", 4) != 0 || memcmp(header + 8, "WAVE", 4) != 0) {
    Serial.println("[AUDIO] Not a RIFF/WAVE file.");
    return false;
  }

  bool foundFmt = false;
  bool foundData = false;

  while (!foundData) {
    uint8_t chunkHeader[8];
    if (!readExact(stream, chunkHeader, sizeof(chunkHeader))) {
      return false;
    }

    uint32_t chunkSize = readLE32(chunkHeader + 4);

    if (memcmp(chunkHeader, "fmt ", 4) == 0) {
      uint8_t fmt[32] = {0};
      uint32_t toRead = min(chunkSize, (uint32_t)sizeof(fmt));
      if (!readExact(stream, fmt, toRead)) {
        return false;
      }

      uint16_t audioFormat = readLE16(fmt + 0);
      info.channels = readLE16(fmt + 2);
      info.sampleRate = readLE32(fmt + 4);
      info.bitsPerSample = readLE16(fmt + 14);
      foundFmt = audioFormat == 1;

      if (chunkSize > toRead && !skipStreamBytes(stream, chunkSize - toRead)) {
        return false;
      }
    } else if (memcmp(chunkHeader, "data", 4) == 0) {
      info.dataSize = chunkSize;
      foundData = true;
    } else {
      if (!skipStreamBytes(stream, chunkSize)) {
        return false;
      }
    }

    if (chunkSize % 2 == 1 && !skipStreamBytes(stream, 1)) {
      return false;
    }
  }

  if (!foundFmt || info.bitsPerSample != 16 || info.channels < 1 || info.channels > 2) {
    Serial.printf("[AUDIO] Unsupported WAV. channels=%u bits=%u sampleRate=%lu\n",
                  info.channels,
                  info.bitsPerSample,
                  (unsigned long)info.sampleRate);
    return false;
  }

  Serial.printf("[AUDIO] WAV: %lu Hz, %u channel(s), %u-bit, data=%lu bytes\n",
                (unsigned long)info.sampleRate,
                info.channels,
                info.bitsPerSample,
                (unsigned long)info.dataSize);

  if (info.sampleRate != 44100) {
    Serial.println("[AUDIO] Sample rate is not 44100 Hz. ESP32 will resample it for A2DP playback.");
  }

  return true;
}

bool readPlaybackPcmData(Stream *stream, uint8_t *buffer, size_t len) {
  size_t got = 0;
  uint32_t lastDataAt = millis();
  uint32_t lastNoticeAt = millis();

  while (got < len && millis() - lastDataAt < 15000) {
    int availableBytes = stream->available();
    if (availableBytes <= 0) {
      delay(1);
      continue;
    }

    size_t toRead = min((size_t)availableBytes, len - got);
    size_t readCount = stream->readBytes(buffer + got, toRead);
    if (readCount == 0) {
      delay(1);
      continue;
    }

    got += readCount;
    lastDataAt = millis();

    if (millis() - lastNoticeAt >= 1000) {
      Serial.printf("[AUDIO] Downloaded PCM %u/%u bytes\n",
                    (unsigned int)got,
                    (unsigned int)len);
      lastNoticeAt = millis();
    }
  }

  Serial.printf("[AUDIO] PCM download complete: %u/%u bytes\n",
                (unsigned int)got,
                (unsigned int)len);
  return got == len;
}

size_t btAudioBufferedBytes() {
  size_t fill = 0;
  portENTER_CRITICAL(&btAudioMux);
  fill = btAudioFill;
  portEXIT_CRITICAL(&btAudioMux);
  return fill;
}

size_t btAudioFreeBytes() {
  return BT_AUDIO_BUFFER_BYTES - btAudioBufferedBytes();
}

void prefillBluetoothSilence(size_t bytes) {
  static const uint8_t silenceFrame[4] = {0, 0, 0, 0};
  size_t frames = bytes / sizeof(silenceFrame);
  for (size_t i = 0; i < frames; i++) {
    if (btAudioFreeBytes() < sizeof(silenceFrame)) {
      break;
    }
    writeBtAudioBuffer(silenceFrame, sizeof(silenceFrame), 1);
  }
}

bool writeStereoFrameToBluetooth(int16_t left, int16_t right) {
  uint8_t frame[4] = {
    (uint8_t)(left & 0xFF),
    (uint8_t)((left >> 8) & 0xFF),
    (uint8_t)(right & 0xFF),
    (uint8_t)((right >> 8) & 0xFF),
  };

  size_t written = 0;
  uint32_t startedAt = millis();
  while (written < sizeof(frame)) {
    if (!a2dpSource.is_connected()) {
      return false;
    }

    if (written == 0 && btAudioFreeBytes() < sizeof(frame)) {
      if (millis() - startedAt > 120) {
        return false;
      }
      delay(1);
      continue;
    }

    if (millis() - startedAt > 120) {
      return false;
    }

    written += writeBtAudioBuffer(frame + written, sizeof(frame) - written, 20);
    if (written < sizeof(frame)) {
      delay(1);
    }
  }

  btFramesQueued++;
  return true;
}

void printBtAudioStats(const char *label) {
  Serial.printf("[BT AUDIO] %s callbacks=%u copied=%u queuedFrames=%u buffered=%u underflow=%u freeHeap=%u\n",
                label,
                (unsigned int)btCallbackCount,
                (unsigned int)btCallbackBytesCopied,
                (unsigned int)btFramesQueued,
                (unsigned int)btAudioBufferedBytes(),
                (unsigned int)btUnderflowBytes,
                (unsigned int)ESP.getFreeHeap());
}

void playBluetoothTestTone(uint32_t durationMs = 1000) {
  clearBtAudioBuffer();
  btCallbackCount = 0;
  btCallbackBytesCopied = 0;
  btFramesQueued = 0;

  printStage("播放藍牙測試音...");
  const uint32_t sampleRate = 44100;
  const uint32_t totalFrames = (sampleRate * durationMs) / 1000;
  uint32_t phase = 0;
  const uint32_t phaseStep = (uint32_t)((440.0f * 4294967296.0f) / sampleRate);

  for (uint32_t i = 0; i < totalFrames; i++) {
    phase += phaseStep;
    float s = sinf((phase / 4294967296.0f) * 2.0f * PI);
    int16_t sample = (int16_t)(s * 9000);
    writeStereoFrameToBluetooth(sample, sample);
    if ((i % 256) == 0) {
      delay(1);
    }
  }

  delay(durationMs + 300);
  printBtAudioStats("after test tone");
}

class MemoryAudioFileSource : public AudioFileSource {
public:
  MemoryAudioFileSource(const uint8_t *data, uint32_t size) : data_(data), size_(size) {}

  bool open(const char *filename) override {
    (void)filename;
    pos_ = 0;
    opened_ = data_ != nullptr && size_ > 0;
    return opened_;
  }

  uint32_t read(void *data, uint32_t len) override {
    if (!opened_ || data == nullptr || pos_ >= size_) {
      return 0;
    }

    uint32_t toRead = min(len, size_ - pos_);
    memcpy(data, data_ + pos_, toRead);
    pos_ += toRead;
    return toRead;
  }

  uint32_t readNonBlock(void *data, uint32_t len) override {
    return read(data, len);
  }

  bool seek(int32_t pos, int dir) override {
    int32_t next = 0;
    if (dir == 0) {
      next = pos;
    } else if (dir == 1) {
      next = (int32_t)pos_ + pos;
    } else if (dir == 2) {
      next = (int32_t)size_ + pos;
    } else {
      return false;
    }

    if (next < 0 || next > (int32_t)size_) {
      return false;
    }

    pos_ = (uint32_t)next;
    return true;
  }

  bool close() override {
    opened_ = false;
    return true;
  }

  bool isOpen() override {
    return opened_;
  }

  uint32_t getSize() override {
    return size_;
  }

  uint32_t getPos() override {
    return pos_;
  }

private:
  const uint8_t *data_ = nullptr;
  uint32_t size_ = 0;
  uint32_t pos_ = 0;
  bool opened_ = false;
};

class A2DPBluetoothOutput : public AudioOutput {
public:
  A2DPBluetoothOutput() {
    hertz = 44100;
    channels = 2;
    SetGain(0.8f);
  }

  bool SetRate(int hz) override {
    if (hz <= 0) {
      return false;
    }
    hertz = hz;
    resampleCarry_ = 0;
    Serial.printf("[MP3] Decoder sample rate: %u Hz\n", hertz);
    return true;
  }

  bool SetChannels(int chan) override {
    if (chan < 1 || chan > 2) {
      return false;
    }
    channels = chan;
    Serial.printf("[MP3] Decoder channels: %u\n", channels);
    return true;
  }

  bool begin() override {
    clearBtAudioBuffer();
    resampleCarry_ = 0;
    return a2dpSource.is_connected();
  }

  bool ConsumeSample(int16_t sample[2]) override {
    if (!a2dpSource.is_connected()) {
      return false;
    }

    int16_t left = Amplify(sample[LEFTCHANNEL]);
    int16_t right = channels == 1 ? left : Amplify(sample[RIGHTCHANNEL]);

    uint32_t inputRate = hertz > 0 ? hertz : A2DP_SAMPLE_RATE;
    resampleCarry_ += A2DP_SAMPLE_RATE;
    uint8_t outputFrames = 0;
    while (resampleCarry_ >= inputRate) {
      resampleCarry_ -= inputRate;
      outputFrames++;
    }

    if (outputFrames == 0) {
      return true;
    }

    for (uint8_t i = 0; i < outputFrames; i++) {
      if (btAudioBufferedBytes() > BT_AUDIO_BUFFER_BYTES - 128) {
        delay(1);
      }
      if (!writeStereoFrameToBluetooth(left, right)) {
        return false;
      }
    }

    return true;
  }

  bool stop() override {
    flush();
    return true;
  }

  void flush() override {
    uint32_t startedAt = millis();
    while (btAudioBufferedBytes() > 0 && millis() - startedAt < 5000) {
      delay(20);
    }
  }

private:
  static const uint32_t A2DP_SAMPLE_RATE = 44100;
  uint32_t resampleCarry_ = 0;
};

bool playWavPcmBufferToBluetooth(const uint8_t *pcmData, const PlaybackWavInfo &info) {
  if (pcmData == nullptr || info.dataSize == 0 || info.sampleRate == 0) {
    printStage("音檔資料為空，無法播放");
    return false;
  }

  clearBtAudioBuffer();
  printStage("正在透過藍牙喇叭播放回覆語音...");

  const uint32_t A2DP_SAMPLE_RATE = 44100;
  const uint32_t inputFrameBytes = info.channels * sizeof(int16_t);
  const uint32_t inputFrames = info.dataSize / inputFrameBytes;
  const uint32_t outputFrames =
      (uint32_t)(((uint64_t)inputFrames * A2DP_SAMPLE_RATE) / info.sampleRate);

  if (inputFrames == 0 || outputFrames == 0) {
    printStage("音檔 frame 數量為 0，無法播放");
    return false;
  }

  Serial.printf("[AUDIO] Playback frames: input=%lu output=%lu\n",
                (unsigned long)inputFrames,
                (unsigned long)outputFrames);

  for (uint32_t outFrame = 0; outFrame < outputFrames; outFrame++) {
    uint32_t srcFrame = (uint32_t)(((uint64_t)outFrame * info.sampleRate) / A2DP_SAMPLE_RATE);
    if (srcFrame >= inputFrames) {
      srcFrame = inputFrames - 1;
    }

    const uint8_t *src = pcmData + srcFrame * inputFrameBytes;
    int16_t left = (int16_t)(src[0] | (src[1] << 8));
    int16_t right = left;
    if (info.channels == 2) {
      right = (int16_t)(src[2] | (src[3] << 8));
    }

    if (!writeStereoFrameToBluetooth(left, right)) {
      printStage("藍牙喇叭連線中斷，停止播放");
      return false;
    }
  }

  uint32_t drainStartedAt = millis();
  while (btAudioBufferedBytes() > 0 && millis() - drainStartedAt < 5000) {
    delay(20);
  }
  delay(250);

  printStage("回覆語音播放完成");
  return true;
}

void playWavFromUrl(const char *audioUrl) {
  if (audioUrl == nullptr || strlen(audioUrl) == 0) {
    printStage("音檔 URL 是空的，略過播放");
    return;
  }

  shutdownBluetoothAudio();
  printStage("正在開啟音檔 URL 並下載到記憶體...");
  Serial.print("[AUDIO URL] ");
  Serial.println(audioUrl);
  Serial.printf("[AUDIO] URL length: %u\n", (unsigned int)strlen(audioUrl));
  Serial.printf("[MEM] Free heap before audio download: %u bytes\n", (unsigned int)ESP.getFreeHeap());

  WiFiClientSecure secureClient;
  HTTPClient http;
  secureClient.setInsecure();
  secureClient.setTimeout(30000);
  if (!http.begin(secureClient, audioUrl)) {
    printStage("音檔 URL HTTP begin 失敗");
    return;
  }
  http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
  http.setTimeout(30000);
  http.useHTTP10(true);
  const char *audioHeaderKeys[] = {"Content-Type"};
  http.collectHeaders(audioHeaderKeys, 1);
  http.addHeader("Authorization", bearerAuthorizationHeader());
  http.addHeader("X-Device-ID", DEVICE_ID);

  int status = http.GET();
  if (status != HTTP_CODE_OK) {
    Serial.printf("[AUDIO] Audio URL HTTP status: %d (%s)\n",
                  status,
                  http.errorToString(status).c_str());
    printStage("音檔 URL 開啟失敗");
    http.end();
    return;
  }

  PlaybackWavInfo wavInfo;
  Stream *audioStream = http.getStreamPtr();
  if (!parsePlaybackWavHeader(audioStream, wavInfo)) {
    printStage("音檔不是支援的 PCM WAV，無法播放");
    http.end();
    return;
  }

  if (wavInfo.dataSize == 0 || wavInfo.dataSize > MAX_PLAYBACK_WAV_BYTES) {
    Serial.printf("[AUDIO] WAV data too large: %lu bytes, limit=%u bytes\n",
                  (unsigned long)wavInfo.dataSize,
                  (unsigned int)MAX_PLAYBACK_WAV_BYTES);
    printStage("音檔太大，ESP32 記憶體不足，請讓後端回傳更短的 WAV");
    http.end();
    return;
  }

  uint8_t *pcmData = (uint8_t *)malloc(wavInfo.dataSize);
  if (pcmData == nullptr) {
    Serial.printf("[MEM] malloc playback PCM failed. Need %lu bytes, free heap=%u bytes\n",
                  (unsigned long)wavInfo.dataSize,
                  (unsigned int)ESP.getFreeHeap());
    printStage("播放音檔記憶體配置失敗");
    http.end();
    return;
  }

  Serial.printf("[MEM] Playback PCM allocated: %lu bytes. Free heap now: %u bytes\n",
                (unsigned long)wavInfo.dataSize,
                (unsigned int)ESP.getFreeHeap());

  bool downloadOk = readPlaybackPcmData(audioStream, pcmData, wavInfo.dataSize);
  http.end();

  if (!downloadOk) {
    printStage("音檔下載不完整，取消播放");
    free(pcmData);
    return;
  }

  printStage("音檔已下載，準備釋放 Wi-Fi 後啟動藍牙");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(300);
  Serial.printf("[MEM] Free heap before BT playback: %u bytes\n", (unsigned int)ESP.getFreeHeap());

  if (waitForBluetoothSpeaker()) {
    playWavPcmBufferToBluetooth(pcmData, wavInfo);
  }

  shutdownBluetoothAudio();
  free(pcmData);
  Serial.printf("[MEM] Playback PCM released. Free heap now: %u bytes\n", (unsigned int)ESP.getFreeHeap());
}

void keepOnlyMp3TailForTest(uint8_t **mp3Data, size_t *mp3Bytes) {
  if (!PLAY_ONLY_LAST_MP3_BYTES || mp3Data == nullptr || *mp3Data == nullptr || mp3Bytes == nullptr) {
    return;
  }

  if (*mp3Bytes < MP3_TAIL_TEST_BYTES) {
    Serial.printf("[MP3 TEST] MP3 is only %u bytes, play full file.\n", (unsigned int)*mp3Bytes);
    return;
  }

  uint8_t *tail = *mp3Data + (*mp3Bytes - MP3_TAIL_TEST_BYTES);
  size_t tailBytes = MP3_TAIL_TEST_BYTES;
  size_t syncOffset = 0;
  bool foundSync = false;

  for (size_t i = 0; i + 1 < tailBytes; i++) {
    if (tail[i] == 0xFF && (tail[i + 1] & 0xE0) == 0xE0) {
      syncOffset = i;
      foundSync = true;
      break;
    }
  }

  if (foundSync) {
    tail += syncOffset;
    tailBytes -= syncOffset;
    Serial.printf("[MP3 TEST] Keep last %u bytes, MP3 sync at +%u, play %u bytes.\n",
                  (unsigned int)MP3_TAIL_TEST_BYTES,
                  (unsigned int)syncOffset,
                  (unsigned int)tailBytes);
  } else {
    Serial.printf("[MP3 TEST] Keep last %u bytes, no MP3 sync found. Decoder will try anyway.\n",
                  (unsigned int)MP3_TAIL_TEST_BYTES);
  }

  memmove(*mp3Data, tail, tailBytes);
  uint8_t *smaller = (uint8_t *)realloc(*mp3Data, tailBytes);
  if (smaller != nullptr) {
    *mp3Data = smaller;
  }
  *mp3Bytes = tailBytes;
}

void trimMp3TailToLastFrameSync(uint8_t **mp3Data, size_t *mp3Bytes) {
  if (mp3Data == nullptr || *mp3Data == nullptr || mp3Bytes == nullptr || *mp3Bytes < 4) {
    return;
  }

  int lastSync = -1;
  for (size_t i = 0; i + 1 < *mp3Bytes; i++) {
    if ((*mp3Data)[i] == 0xFF && (((*mp3Data)[i + 1] & 0xE0) == 0xE0)) {
      lastSync = (int)i;
    }
  }

  if (lastSync > 0 && (*mp3Bytes - (size_t)lastSync) < 2048) {
    Serial.printf("[MP3] Trim tail from %u to %d bytes to avoid partial-frame noise.\n",
                  (unsigned int)*mp3Bytes,
                  lastSync);
    *mp3Bytes = (size_t)lastSync;
    uint8_t *smaller = (uint8_t *)realloc(*mp3Data, *mp3Bytes);
    if (smaller != nullptr) {
      *mp3Data = smaller;
    }
  }
}

bool downloadAudioUrlToMemory(const char *audioUrl, uint8_t **outData, size_t *outBytes, size_t maxBytes, const char *label) {
  *outData = nullptr;
  *outBytes = 0;

  if (audioUrl == nullptr || strlen(audioUrl) == 0) {
    printStage("音檔 URL 是空的，無法下載");
    return false;
  }

  String effectiveAudioUrl(audioUrl);
  if (effectiveAudioUrl.indexOf("/api/iot/voice/tts?") >= 0) {
    effectiveAudioUrl.replace("/api/iot/voice/tts?", "/api/iot/voice?");
    Serial.println("[AUDIO] 修正 TTS URL：目前後端 GET 路由是 /api/iot/voice?text=...");
    Serial.print("[AUDIO FIXED URL] ");
    Serial.println(effectiveAudioUrl);
  }

  ParsedUrl url;
  if (!parseHttpUrl(effectiveAudioUrl.c_str(), url)) {
    printStage("音檔 URL 格式錯誤");
    return false;
  }

  bool isMp3 = strcmp(label, "MP3") == 0;
  bool keepHeadOnly = isMp3 && PLAY_ONLY_FIRST_MP3_BYTES;
  bool keepTailOnly = isMp3 && !keepHeadOnly && PLAY_ONLY_LAST_MP3_BYTES;

  shutdownBluetoothAudio();
  Serial.print("[AUDIO URL] ");
  Serial.println(effectiveAudioUrl);
  Serial.printf("[AUDIO] URL length: %u\n", (unsigned int)effectiveAudioUrl.length());
  Serial.printf("[AUDIO] GET host=%s port=%u path length=%u\n",
                url.host.c_str(),
                url.port,
                (unsigned int)url.path.length());
  Serial.printf("[MEM] Free heap before %s download: %u bytes\n", label, (unsigned int)ESP.getFreeHeap());

  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  Client *client = nullptr;
  if (url.https) {
    secureClient.setInsecure();
    secureClient.setTimeout(30000);
    client = &secureClient;
  } else {
    plainClient.setTimeout(30000);
    client = &plainClient;
  }

  printStage("正在建立音檔 URL 連線...");
  if (!client->connect(url.host.c_str(), url.port)) {
    printStage("音檔 URL 連線失敗");
    Serial.printf("[MEM] Free heap after audio connect fail: %u bytes\n", (unsigned int)ESP.getFreeHeap());
    return false;
  }

  client->print(String("GET ") + url.path + " HTTP/1.1\r\n");
  client->print(String("Host: ") + url.host + "\r\n");
  client->print("User-Agent: ESP32-RRC-VoiceNode/1.0\r\n");
  client->print("Accept: audio/mpeg,*/*\r\n");
  client->print("Connection: close\r\n");
  client->print(String("Authorization: ") + bearerAuthorizationHeader() + "\r\n");
  client->print(String("X-Device-ID: ") + DEVICE_ID + "\r\n\r\n");

  String statusLine = readHttpLine(*client, 30000);
  statusLine.trim();
  Serial.print("[AUDIO HTTP] ");
  Serial.println(statusLine);

  if (statusLine.length() == 0) {
    printStage("音檔 URL 沒有 HTTP 回應");
    client->stop();
    return false;
  }

  int status = 0;
  int firstSpace = statusLine.indexOf(' ');
  if (firstSpace >= 0 && statusLine.length() >= firstSpace + 4) {
    status = statusLine.substring(firstSpace + 1, firstSpace + 4).toInt();
  }

  int contentLength = -1;
  bool chunked = false;
  String contentType;
  while (true) {
    String header = readHttpLine(*client, 10000);
    if (header == "\r\n" || header == "\n" || header.length() == 0) {
      break;
    }

    String lower = header;
    lower.toLowerCase();
    lower.trim();
    if (lower.startsWith("content-length:")) {
      contentLength = lower.substring(String("content-length:").length()).toInt();
    } else if (lower.startsWith("transfer-encoding:") && lower.indexOf("chunked") >= 0) {
      chunked = true;
    } else if (lower.startsWith("content-type:")) {
      contentType = header.substring(header.indexOf(':') + 1);
      contentType.trim();
    } else if (lower.startsWith("location:")) {
      String location = header.substring(header.indexOf(':') + 1);
      location.trim();
      Serial.print("[AUDIO] Redirect location: ");
      Serial.println(location);
    }
  }

  if (contentType.length() > 0) {
    Serial.print("[AUDIO] Content-Type: ");
    Serial.println(contentType);
  }
  if (contentLength >= 0) {
    Serial.printf("[AUDIO] %s Content-Length: %d bytes\n", label, contentLength);
  }
  Serial.printf("[AUDIO] chunked=%s\n", chunked ? "true" : "false");

  if (status < 200 || status >= 300) {
    printStage("音檔 URL 回應不是成功狀態");
    String preview = readHttpBodyPreview(*client, contentLength, chunked, 512);
    Serial.println("[AUDIO BODY PREVIEW]");
    Serial.println(preview);
    client->stop();
    return false;
  }

  size_t capacity = maxBytes;
  if (keepHeadOnly) {
    capacity = MP3_HEAD_TEST_BYTES;
  } else if (keepTailOnly) {
    capacity = MP3_TAIL_TEST_BYTES;
  } else if (contentLength > 0) {
    capacity = (size_t)contentLength;
  }

  if (!keepHeadOnly && !keepTailOnly && contentLength > 0 && (size_t)contentLength > maxBytes) {
    Serial.printf("[AUDIO] %s too large: %d bytes, limit=%u bytes\n",
                  label,
                  contentLength,
                  (unsigned int)maxBytes);
    printStage("音檔太大，ESP32 記憶體不足，請讓後端回傳更短或更低 bitrate 的 MP3");
    client->stop();
    return false;
  }

  uint8_t *buffer = (uint8_t *)malloc(capacity);
  if (buffer == nullptr) {
    Serial.printf("[MEM] malloc %s failed. Need %u bytes, free heap=%u bytes\n",
                  label,
                  (unsigned int)capacity,
                  (unsigned int)ESP.getFreeHeap());
    printStage("音檔記憶體配置失敗");
    client->stop();
    return false;
  }

  if (keepHeadOnly) {
    Serial.printf("[MP3 TEST] Head mode enabled. Only downloading first %u bytes.\n",
                  (unsigned int)MP3_HEAD_TEST_BYTES);
  } else if (keepTailOnly) {
    Serial.printf("[MP3 TEST] Tail mode enabled. Only keeping last %u bytes while downloading.\n",
                  (unsigned int)MP3_TAIL_TEST_BYTES);
  }

  size_t got = 0;
  size_t totalDownloaded = 0;
  uint32_t lastDataAt = millis();
  uint32_t lastNoticeAt = millis();
  uint8_t scratch[512];

  auto consumeBytes = [&](const uint8_t *data, size_t len) -> bool {
    if (keepHeadOnly) {
      size_t space = capacity - got;
      size_t toCopy = min(space, len);
      if (toCopy > 0) {
        memcpy(buffer + got, data, toCopy);
        got += toCopy;
      }
      totalDownloaded += len;
      return true;
    }

    if (keepTailOnly) {
      if (len >= capacity) {
        memcpy(buffer, data + len - capacity, capacity);
        got = capacity;
      } else if (got + len <= capacity) {
        memcpy(buffer + got, data, len);
        got += len;
      } else {
        size_t overflow = got + len - capacity;
        memmove(buffer, buffer + overflow, got - overflow);
        got -= overflow;
        memcpy(buffer + got, data, len);
        got += len;
      }
      totalDownloaded += len;
      return true;
    }

    if (got + len > capacity) {
      return false;
    }
    memcpy(buffer + got, data, len);
    got += len;
    totalDownloaded += len;
    return true;
  };

  if (chunked) {
    while (client->connected() || client->available()) {
      String sizeLine = readHttpLine(*client, 15000);
      sizeLine.trim();
      if (sizeLine.length() == 0) {
        continue;
      }

      int chunkSize = (int)strtol(sizeLine.c_str(), nullptr, 16);
      if (chunkSize <= 0) {
        readHttpLine(*client, 1000);
        break;
      }

      int remaining = chunkSize;
      while (remaining > 0) {
        size_t toRead = min((size_t)remaining, sizeof(scratch));
        size_t readCount = client->readBytes(scratch, toRead);
        if (readCount == 0) {
          delay(1);
          continue;
        }
        remaining -= readCount;
        lastDataAt = millis();
        if (!consumeBytes(scratch, readCount)) {
          printStage("音檔超過 ESP32 可用緩衝區，取消播放");
          free(buffer);
          client->stop();
          return false;
        }
        if (keepHeadOnly && got >= capacity) {
          break;
        }
      }
      readHttpLine(*client, 1000);
      if (keepHeadOnly && got >= capacity) {
        Serial.printf("[MP3 TEST] Got first %u bytes, stop downloading early.\n", (unsigned int)got);
        break;
      }
    }
  } else {
    while ((contentLength < 0 || (int)totalDownloaded < contentLength) && (client->connected() || client->available())) {
      int availableBytes = client->available();
      if (availableBytes <= 0) {
        if (millis() - lastDataAt > 15000) {
          break;
        }
        delay(1);
        continue;
      }

      size_t toRead = min((size_t)availableBytes, sizeof(scratch));
      if (contentLength >= 0) {
        toRead = min(toRead, (size_t)(contentLength - (int)totalDownloaded));
      }

      size_t readCount = client->readBytes(scratch, toRead);
      if (readCount == 0) {
        delay(1);
        continue;
      }

      lastDataAt = millis();
      if (!consumeBytes(scratch, readCount)) {
        printStage("音檔超過 ESP32 可用緩衝區，取消播放");
        free(buffer);
        client->stop();
        return false;
      }

      if (keepHeadOnly && got >= capacity) {
        Serial.printf("[MP3 TEST] Got first %u bytes, stop downloading early.\n", (unsigned int)got);
        break;
      }

      if (millis() - lastNoticeAt >= 1000) {
        Serial.printf("[AUDIO] Downloaded %s total=%u kept=%u bytes\n",
                      label,
                      (unsigned int)totalDownloaded,
                      (unsigned int)got);
        lastNoticeAt = millis();
      }
    }
  }

  client->stop();

  if (!keepHeadOnly && !keepTailOnly && contentLength > 0 && totalDownloaded != (size_t)contentLength) {
    Serial.printf("[AUDIO] %s download incomplete: %u/%d bytes\n",
                  label,
                  (unsigned int)totalDownloaded,
                  contentLength);
    printStage("音檔下載不完整，取消播放");
    free(buffer);
    return false;
  }

  if (got == 0) {
    printStage("音檔下載後是空的，取消播放");
    free(buffer);
    return false;
  }

  if (got < capacity) {
    uint8_t *smaller = (uint8_t *)realloc(buffer, got);
    if (smaller != nullptr) {
      buffer = smaller;
    }
  }

  *outData = buffer;
  *outBytes = got;
  if (keepHeadOnly) {
    Serial.printf("[AUDIO] %s download complete: total=%u kept head=%u bytes\n",
                  label,
                  (unsigned int)totalDownloaded,
                  (unsigned int)got);
  } else if (keepTailOnly) {
    Serial.printf("[AUDIO] %s download complete: total=%u kept tail=%u bytes\n",
                  label,
                  (unsigned int)totalDownloaded,
                  (unsigned int)got);
  } else {
    Serial.printf("[AUDIO] %s download complete: %u bytes\n", label, (unsigned int)got);
  }
  Serial.printf("[MEM] Free heap after %s download: %u bytes\n", label, (unsigned int)ESP.getFreeHeap());
  return true;
}
void playMp3FromUrl(const char *audioUrl) {
  printStage("正在下載 MP3 音檔...");

  uint8_t *mp3Data = nullptr;
  size_t mp3Bytes = 0;
  if (!downloadAudioUrlToMemory(audioUrl, &mp3Data, &mp3Bytes, MAX_PLAYBACK_MP3_BYTES, "MP3")) {
    return;
  }

  keepOnlyMp3TailForTest(&mp3Data, &mp3Bytes);
  if (mp3Bytes < 1024) {
    Serial.print("[MP3] Small response text preview: ");
    for (size_t i = 0; i < mp3Bytes; i++) {
      char c = (char)mp3Data[i];
      if (c >= 32 && c <= 126) {
        Serial.print(c);
      } else if (c == '\r' || c == '\n') {
        Serial.print(' ');
      } else {
        Serial.print('.');
      }
    }
    Serial.println();
  }

  Serial.print("[MP3] First bytes:");
  for (size_t i = 0; i < min((size_t)12, mp3Bytes); i++) {
    Serial.printf(" %02X", mp3Data[i]);
  }
  Serial.println();

  int firstSync = -1;
  for (size_t i = 0; i + 1 < mp3Bytes; i++) {
    if (mp3Data[i] == 0xFF && (mp3Data[i + 1] & 0xE0) == 0xE0) {
      firstSync = (int)i;
      break;
    }
  }
  Serial.printf("[MP3] First frame sync offset: %d\n", firstSync);
  if (firstSync < 0) {
    printStage("下載內容找不到 MP3 frame sync，可能後端回的不是 MP3");
    free(mp3Data);
    return;
  }
  trimMp3TailToLastFrameSync(&mp3Data, &mp3Bytes);
  Serial.printf("[MP3] Bytes sent to decoder: %u\n", (unsigned int)mp3Bytes);

  printStage("MP3 已下載，準備釋放 Wi-Fi 後啟動藍牙");
  WiFi.disconnect(true);
  WiFi.mode(WIFI_OFF);
  delay(300);
  Serial.printf("[MEM] Free heap before MP3 BT playback: %u bytes\n", (unsigned int)ESP.getFreeHeap());

  if (!waitForBluetoothSpeaker()) {
    shutdownBluetoothAudio();
    free(mp3Data);
    return;
  }

  if (!waitForBluetoothAudioCallback()) {
    shutdownBluetoothAudio();
    free(mp3Data);
    return;
  }

  clearBtAudioBuffer();
  prefillBluetoothSilence(BT_AUDIO_BUFFER_BYTES / 2);
  btCallbackBytesCopied = 0;
  btFramesQueued = 0;
  btUnderflowBytes = 0;
  printBtAudioStats("before mp3 decode");

  MemoryAudioFileSource mp3Source(mp3Data, (uint32_t)mp3Bytes);
  mp3Source.open(nullptr);
  A2DPBluetoothOutput btOutput;
  AudioGeneratorMP3 mp3(wavBufferStorage, MAX_WAV_BYTES);

  printStage("正在解碼 MP3 並透過藍牙喇叭播放...");
  uint32_t heapBeforeDecoder = ESP.getFreeHeap();
  int mp3DecoderNeed = AudioGeneratorMP3::preAllocSize();
  Serial.printf("[MEM] Free heap before MP3 decoder begin: %u bytes\n", (unsigned int)heapBeforeDecoder);
  Serial.printf("[MP3] Decoder preAllocSize hint: %d bytes, using static WAV buffer: %u bytes\n",
                mp3DecoderNeed,
                (unsigned int)MAX_WAV_BYTES);
  if (mp3DecoderNeed > (int)MAX_WAV_BYTES) {
    printStage("固定 WAV buffer 太小，無法作為 MP3 decoder 預配置記憶體");
    mp3Source.close();
    free(mp3Data);
    return;
  }

  if (!mp3.begin(&mp3Source, &btOutput)) {
    printStage("MP3 解碼器啟動失敗");
    mp3Source.close();
    Serial.println("[BT] Keep A2DP state unchanged after decoder begin failure to avoid end() panic.");
    free(mp3Data);
    return;
  }

  uint32_t startedAt = millis();
  uint32_t lastMp3NoticeAt = startedAt;
  uint16_t mp3LoopCount = 0;
  while (mp3.isRunning() && millis() - startedAt < 60000) {
    if (!mp3.loop()) {
      if (mp3.isRunning()) {
        mp3.stop();
      }
      break;
    }
    if (millis() - lastMp3NoticeAt >= 1000) {
      Serial.printf("[MP3] Playing... %lu ms\n", (unsigned long)(millis() - startedAt));
      printBtAudioStats("during mp3");
      lastMp3NoticeAt = millis();
    }
    if (btAudioBufferedBytes() > BT_AUDIO_BUFFER_BYTES - 768) {
      delay(1);
    } else if ((++mp3LoopCount & 0x1F) == 0) {
      yield();
    }
  }

  if (mp3.isRunning()) {
    printStage("MP3 播放逾時，停止播放");
    mp3.stop();
  }

  printStage("MP3 回覆語音播放完成");
  printBtAudioStats("after mp3 decode");
  shutdownBluetoothAudio();
  free(mp3Data);
  Serial.printf("[MEM] MP3 buffer released. Free heap now: %u bytes\n", (unsigned int)ESP.getFreeHeap());
}
void writeLE16(uint8_t *p, uint16_t value) {
  p[0] = value & 0xFF;
  p[1] = (value >> 8) & 0xFF;
}

void writeLE32(uint8_t *p, uint32_t value) {
  p[0] = value & 0xFF;
  p[1] = (value >> 8) & 0xFF;
  p[2] = (value >> 16) & 0xFF;
  p[3] = (value >> 24) & 0xFF;
}

uint16_t readLE16(const uint8_t *p) {
  return p[0] | (p[1] << 8);
}

uint32_t readLE32(const uint8_t *p) {
  return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
void makeWavHeader(uint8_t *buffer, uint32_t sampleRate, uint16_t bitsPerSample, uint16_t channels, uint32_t dataBytes) {
  // 建立標準 PCM WAV header。
  // 後端收到 audio/wav 時，就能直接知道這段音訊的取樣率、聲道、位元深度。
  //
  // WAV header 基本結構：
  // RIFF chunk -> 表示這是一個 RIFF 容器
  // WAVE       -> 表示內容是 WAV 音訊
  // fmt chunk  -> 描述音訊格式
  // data chunk -> 後面接真正的 PCM 音訊資料
  memcpy(buffer + 0, "RIFF", 4);
  writeLE32(buffer + 4, 36 + dataBytes);
  memcpy(buffer + 8, "WAVE", 4);
  memcpy(buffer + 12, "fmt ", 4);
  writeLE32(buffer + 16, 16);
  writeLE16(buffer + 20, 1);
  writeLE16(buffer + 22, channels);
  writeLE32(buffer + 24, sampleRate);
  writeLE32(buffer + 28, sampleRate * channels * bitsPerSample / 8);
  writeLE16(buffer + 32, channels * bitsPerSample / 8);
  writeLE16(buffer + 34, bitsPerSample);
  memcpy(buffer + 36, "data", 4);
  writeLE32(buffer + 40, dataBytes);
}

void connectWiFi() {
  // 如果已經連上 Wi-Fi，就不重複連線。
  // loop() 會持續呼叫這個函式，所以 Wi-Fi 斷線後也會自動嘗試重連。
  if (WiFi.status() == WL_CONNECTED) {
    return;
  }

  printStage("正在連接 Wi-Fi...");
  Serial.printf("Connecting to Wi-Fi: %s\n", WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  uint32_t startAt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAt < 20000) {
    // 最多等 20 秒。
    // 若沒有成功，先回到 loop()，下一輪再重試，避免整個程式永久卡住。
    delay(500);
    Serial.print(".");
  }
  Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    printStage("Wi-Fi 已連線");
    Serial.print("Wi-Fi connected. IP: ");
    Serial.println(WiFi.localIP());
  } else {
    printStage("Wi-Fi 連線失敗，稍後重試");
    Serial.println("Wi-Fi connection failed. Will retry in loop.");
  }
}

void setupMicrophoneI2S() {
  // 設定 I2S 收音端。
  // INMP441 不是類比麥克風，而是 I2S 數位麥克風：
  // - ESP32 輸出 SCK/BCLK 給麥克風
  // - ESP32 輸出 WS/LRCLK 告訴麥克風目前是哪個聲道
  // - 麥克風從 SD 腳送出數位音訊資料
  //
  // 這裡使用 ESP32 core 3.x 的新版 I2S driver。
  // 不能再用舊版 driver/i2s.h，否則會和 ESP8266Audio 的新版 I2S 播放衝突。
  if (micRxChannel != nullptr) {
    return;
  }

  i2s_chan_config_t chanConfig = I2S_CHANNEL_DEFAULT_CONFIG(MIC_I2S_PORT, I2S_ROLE_MASTER);
  chanConfig.dma_desc_num = 8;
  chanConfig.dma_frame_num = 256;
  ESP_ERROR_CHECK(i2s_new_channel(&chanConfig, nullptr, &micRxChannel));

  i2s_std_slot_config_t slotConfig =
      I2S_STD_PHILIPS_SLOT_DEFAULT_CONFIG(I2S_DATA_BIT_WIDTH_32BIT, I2S_SLOT_MODE_MONO);
  slotConfig.slot_mask = I2S_STD_SLOT_RIGHT;

  i2s_std_config_t stdConfig = {
    .clk_cfg = I2S_STD_CLK_DEFAULT_CONFIG(RECORD_SAMPLE_RATE),
    .slot_cfg = slotConfig,
    .gpio_cfg = {
      .mclk = I2S_GPIO_UNUSED,
      .bclk = (gpio_num_t)I2S_MIC_SCK_PIN,
      .ws = (gpio_num_t)I2S_MIC_WS_PIN,
      .dout = I2S_GPIO_UNUSED,
      .din = (gpio_num_t)I2S_MIC_SD_PIN,
      .invert_flags = {
        .mclk_inv = false,
        .bclk_inv = false,
        .ws_inv = false,
      },
    },
  };

  ESP_ERROR_CHECK(i2s_channel_init_std_mode(micRxChannel, &stdConfig));
  ESP_ERROR_CHECK(i2s_channel_enable(micRxChannel));
}

void flushMicrophoneI2S() {
  // 新版 I2S 沒有 legacy 的 i2s_zero_dma_buffer。
  // 錄音前讀掉幾批資料，等效清掉按鈕按下前殘留在 DMA 裡的舊音訊。
  if (micRxChannel == nullptr) {
    return;
  }

  int32_t discard[128];
  for (int i = 0; i < 4; i++) {
    size_t bytesRead = 0;
    i2s_channel_read(micRxChannel, discard, sizeof(discard), &bytesRead, 20);
  }
}

bool isRecordButtonPressed() {
  // 按鈕使用 INPUT_PULLUP 時：
  // - 未按下：HIGH
  // - 按下：LOW
  return digitalRead(RECORD_BUTTON_PIN) == BUTTON_ACTIVE_LEVEL;
}

bool waitForRecordButtonPress() {
  // 等待按鈕被按下。
  // 為了避免按鈕接點彈跳，第一次讀到按下後會等 BUTTON_DEBOUNCE_MS 再確認一次。
  if (millis() - lastQueryAt < QUERY_COOLDOWN_MS) {
    delay(10);
    return false;
  }

  if (!isRecordButtonPressed()) {
    if (millis() - lastIdleMemNoticeAt >= 5000) {
      Serial.printf("[MEM] Idle free heap: %u bytes\n", (unsigned int)ESP.getFreeHeap());
      lastIdleMemNoticeAt = millis();
    }
    delay(10);
    return false;
  }

  delay(BUTTON_DEBOUNCE_MS);
  if (!isRecordButtonPressed()) {
    return false;
  }

  printStage("按鈕已按下，開始錄音");
  Serial.println("Record button pressed. Start recording...");
  return true;
}

void waitForRecordButtonRelease() {
  // 如果達到最長錄音時間時按鈕仍然按著，
  // 等使用者放開後再回到待機，避免下一輪 loop() 立刻又開始錄音。
  while (isRecordButtonPressed()) {
    delay(10);
  }
  delay(BUTTON_DEBOUNCE_MS);
}

bool recordWavWhileButtonHeld() {
  // 確保錄音用的固定 WAV buffer 可用。
  // 這裡不再 malloc，避免多輪詢問後 heap 碎片化造成明明 free heap 足夠卻配置失敗。
  if (!ensureWavBuffer()) {
    waitForRecordButtonRelease();
    return false;
  }

  // 先保留 WAV header 的空間。
  // 因為這次錄音長度取決於按鈕放開時間，所以 header 會等錄完後再依實際長度寫入。
  int16_t *pcm = (int16_t *)(wavBuffer + WAV_HEADER_SIZE);

  // 開始錄音前清空 DMA buffer，避免把按下按鈕前殘留的舊音訊一起錄進去。
  flushMicrophoneI2S();

  printStage("正在錄音...");
  Serial.println("Recording while button is held...");
  size_t recorded = 0;
  int32_t rawSamples[256];
  uint32_t startedAt = millis();
  uint32_t lastRecordingNoticeAt = startedAt;
  uint32_t releaseStartedAt = 0;

  while (recorded < MAX_RECORD_SAMPLE_COUNT) {
    if (millis() - lastRecordingNoticeAt >= 1000) {
      Serial.printf("[STAGE] 正在錄音... %lu ms\n", (unsigned long)(millis() - startedAt));
      lastRecordingNoticeAt = millis();
    }

    // 按鈕放開時不要立刻停止，先確認它連續放開超過防抖時間。
    // 這可以避免按鈕彈跳讓錄音被切得太短。
    if (!isRecordButtonPressed()) {
      if (releaseStartedAt == 0) {
        printStage("偵測到按鈕放開，準備結束錄音");
        releaseStartedAt = millis();
      }
      if (millis() - releaseStartedAt >= BUTTON_DEBOUNCE_MS) {
        break;
      }
    } else {
      releaseStartedAt = 0;
    }

    // 從 INMP441 讀一批 32-bit 原始音訊資料。
    size_t bytesRead = 0;
    esp_err_t result = i2s_channel_read(micRxChannel, rawSamples, sizeof(rawSamples), &bytesRead, 1000);
    if (result != ESP_OK || bytesRead == 0) {
      Serial.println("I2S read failed while recording.");
      return false;
    }

    size_t rawCount = bytesRead / sizeof(int32_t);
    for (size_t i = 0; i < rawCount && recorded < MAX_RECORD_SAMPLE_COUNT; i++) {
      // 將 INMP441 32-bit 原始值縮成 16-bit PCM。
      // constrain 避免超過 int16_t 範圍造成爆音或數值回繞。
      int32_t sample = rawSamples[i] >> 14;
      sample = constrain(sample, -32768, 32767);
      pcm[recorded++] = (int16_t)sample;
    }
  }

  if (recorded >= MAX_RECORD_SAMPLE_COUNT) {
    printStage("達到最大錄音時間，停止錄音");
    Serial.println("Reached max recording length.");
    waitForRecordButtonRelease();
  }

  uint32_t recordedMs = millis() - startedAt;
  size_t audioBytes = recorded * sizeof(int16_t);
  lastWavBytes = WAV_HEADER_SIZE + audioBytes;

  if (recordedMs < MIN_RECORD_MS || recorded == 0) {
    printStage("錄音時間太短，取消上傳");
    Serial.println("Recording too short. Skip upload.");
    lastWavBytes = 0;
    return false;
  }

  // 錄完後才寫入正確 WAV header。
  // 這樣後端收到的檔案長度會和實際錄音長度一致。
  makeWavHeader(wavBuffer, RECORD_SAMPLE_RATE, 16, 1, audioBytes);

  printStage("結束錄音，已封裝成 WAV");
  Serial.printf("Recording complete. Duration=%lu ms, WAV bytes=%u\n",
                (unsigned long)recordedMs,
                (unsigned int)lastWavBytes);
  return true;
}

bool sendVoiceQueryAndHandleResponse() {
  // 將 recordWavWhileButtonHeld() 產生的 wavBuffer 上傳到 Vercel 語音 API。
  // route.ts 使用 req.formData()，所以這裡必須用 multipart/form-data，
  // 且音訊欄位名稱必須是 file。
  ParsedUrl url;
  WiFiClientSecure secureClient;
  WiFiClient plainClient;
  Client *client = nullptr;

  printStage("準備上傳音訊到 Vercel...");

  if (!parseHttpUrl(VOICE_API_URL, url)) {
    printStage("Voice API URL 格式錯誤");
    return false;
  }

  if (lastWavBytes == 0) {
    printStage("沒有可上傳的錄音資料");
    Serial.println("No recorded WAV data to upload.");
    return false;
  }

  if (url.https) {
    secureClient.setInsecure();
    secureClient.setTimeout(20000);
    client = &secureClient;
  } else {
    client = &plainClient;
  }

  printStage("正在建立 Voice API 連線...");
  Serial.printf("[HTTP] Host=%s Port=%u Path=%s\n", url.host.c_str(), url.port, url.path.c_str());
  Serial.printf("[MEM] Free heap before Voice API connect: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  if (!client->connect(url.host.c_str(), url.port)) {
    printStage("Voice API 連線建立失敗");
    Serial.printf("[MEM] Free heap after failed connect: %u bytes\n", (unsigned int)ESP.getFreeHeap());
    releaseWavBuffer();
    return false;
  }
  Serial.printf("[MEM] Free heap after Voice API connect: %u bytes\n", (unsigned int)ESP.getFreeHeap());

  const String boundary = "----RRCESP32VoiceBoundary";
  const String multipartHead =
      "--" + boundary + "\r\n"
      "Content-Disposition: form-data; name=\"file\"; filename=\"voice.wav\"\r\n"
      "Content-Type: audio/wav\r\n\r\n";
  const String multipartTail = "\r\n--" + boundary + "--\r\n";
  const size_t contentLength = multipartHead.length() + lastWavBytes + multipartTail.length();

  printStage("正在上傳 multipart/form-data 音訊...");
  Serial.printf("Uploading multipart WAV. file bytes=%u, total body bytes=%u\n",
                (unsigned int)lastWavBytes,
                (unsigned int)contentLength);

  client->print(String("POST ") + url.path + " HTTP/1.1\r\n");
  client->print(String("Host: ") + url.host + "\r\n");
  client->print("User-Agent: ESP32-RRC-VoiceNode/1.0\r\n");
  client->print("Accept: application/json\r\n");
  client->print("Connection: close\r\n");
  client->print(String("Authorization: ") + bearerAuthorizationHeader() + "\r\n");
  client->print(String("X-Device-ID: ") + DEVICE_ID + "\r\n");
  client->print(String("X-Sample-Rate: ") + String(RECORD_SAMPLE_RATE) + "\r\n");
  client->print("X-Audio-Format: mp3\r\n");
  client->print("X-Return-Audio-Base64: false\r\n");
  client->print("X-Return-Audio-Url-Only: true\r\n");
  client->print(String("Content-Type: multipart/form-data; boundary=") + boundary + "\r\n");
  client->print(String("Content-Length: ") + String(contentLength) + "\r\n\r\n");

  bool uploadOk =
      writeAll(*client, (const uint8_t *)multipartHead.c_str(), multipartHead.length(), "multipart head") &&
      writeAll(*client, wavBuffer, lastWavBytes, "voice.wav") &&
      writeAll(*client, (const uint8_t *)multipartTail.c_str(), multipartTail.length(), "multipart tail");

  if (!uploadOk) {
    printStage("音訊資料未完整送出，取消等待後端回應");
    client->stop();
    releaseWavBuffer();
    return false;
  }

  releaseWavBuffer();

  printStage("上傳完成，正在讀取後端回應...");
  Serial.println("[HTTP] Waiting for Vercel response, this can take up to 90 seconds...");

  String statusLine = readHttpLine(*client, 90000);
  statusLine.trim();
  Serial.print("[HTTP] ");
  Serial.println(statusLine);

  if (statusLine.length() == 0) {
    printStage("沒有收到 HTTP 狀態列，可能是 Vercel 還在等資料或連線被中斷");
    client->stop();
    return false;
  }

  int status = 0;
  int firstSpace = statusLine.indexOf(' ');
  if (firstSpace >= 0 && statusLine.length() >= firstSpace + 4) {
    status = statusLine.substring(firstSpace + 1, firstSpace + 4).toInt();
  }

  int contentLen = -1;
  bool chunked = false;
  while (true) {
    String header = readHttpLine(*client);
    if (header == "\r\n" || header == "\n" || header.length() == 0) {
      break;
    }
    String lower = header;
    lower.toLowerCase();
    lower.trim();
    if (lower.startsWith("content-length:")) {
      contentLen = lower.substring(String("content-length:").length()).toInt();
    } else if (lower.startsWith("transfer-encoding:") && lower.indexOf("chunked") >= 0) {
      chunked = true;
    }
  }

  String responsePreview = readHttpBodyPreview(*client, contentLen, chunked, MAX_HTTP_RESPONSE_CHARS);
  client->stop();

  if (status < 200 || status >= 300) {
    printStage("Voice API 回應失敗");
    Serial.println("[HTTP BODY PREVIEW]");
    Serial.println(responsePreview);
    return false;
  }

  printStage("Voice API 回應成功");

  if (responsePreview.indexOf("\"success\":false") >= 0) {
    printStage("後端回傳 success=false");
  } else if (responsePreview.indexOf("\"success\":true") >= 0) {
    printStage("後端處理成功");
  }

  String sttText = extractJsonStringPreview(responsePreview, "text");
  if (sttText.length() > 0) {
    Serial.print("[VOICE TEXT] ");
    Serial.println(sttText);
  }

  String replyText = extractJsonStringPreview(responsePreview, "replyText");
  if (replyText.length() > 0) {
    Serial.println("[REPLY TEXT]");
    Serial.println(replyText);
  }

  String audioUrl = extractJsonStringPreview(responsePreview, "audioUrl");
  if (audioUrl.length() == 0) {
    audioUrl = extractJsonStringPreview(responsePreview, "audio_url");
  }

  String audioFormat = extractJsonStringPreview(responsePreview, "audioFormat");
  if (audioFormat.length() > 0) {
    Serial.print("[AUDIO FORMAT] ");
    Serial.println(audioFormat);
  }

  if (audioUrl.length() > 0) {
    printStage("後端已回傳音檔 URL，準備播放");
    responsePreview = "";
    String audioFormatLower = audioFormat;
    String audioUrlLower = audioUrl;
    audioFormatLower.toLowerCase();
    audioUrlLower.toLowerCase();

    if (audioFormatLower == "wav" || audioUrlLower.indexOf(".wav") >= 0) {
      playWavFromUrl(audioUrl.c_str());
    } else {
      playMp3FromUrl(audioUrl.c_str());
    }
  } else {
    printStage("後端沒有回傳 audioUrl/audio_url，略過語音播放");
  }

  printStage("本次語音指令流程完成，回到待機");
  return true;
}

void setup() {
  // Arduino 啟動後只會執行一次 setup()。
  // 這裡負責初始化序列埠、記憶體、I2S 麥克風和 Wi-Fi。
  Serial.begin(115200);
  delay(500);

  Serial.println();
  Serial.println("ESP32 node 1 voice finder booting...");
  printStage("系統啟動中...");

  // 設定錄音按鈕。
  // INPUT_PULLUP 對應接線：GPIO18 -> 按鈕 -> GND。
  pinMode(RECORD_BUTTON_PIN, INPUT_PULLUP);

  // 啟動 INMP441 收音。
  setupMicrophoneI2S();
  printStage("INMP441 麥克風初始化完成");

  // 連上 Wi-Fi。若第一次失敗，loop() 會繼續重試。
  // 這裡先不強制連線，避免 Wi-Fi/TLS 佔用太多 RAM 造成錄音 buffer 配置失敗。
  // 真正要上傳前，loop() 會再檢查並連線。
  printStage("待機中：按住 GPIO18 開始錄音，放開後上傳；播放前才會啟動藍牙");
  Serial.println("Ready. Hold GPIO18 button to record, release to upload.");
}

void loop() {
  // Arduino 會一直重複執行 loop()。
  // 這裡就是節點一的主要工作循環。

  // 1. 等待 GPIO18 按鈕按下，沒有按就直接回到下一輪 loop()。
  if (!waitForRecordButtonPress()) {
    return;
  }

  // 2. 偵測到按鈕後，記錄觸發時間，避免短時間連續觸發。
  lastQueryAt = millis();

  // 3. 按住時錄音，放開後封裝成 WAV。
  // 4. 錄音完成後才連 Wi-Fi 並 POST 到 Vercel。
  // 5. 處理回傳 JSON，可能包含點燈和播放語音。
  if (recordWavWhileButtonHeld()) {
    connectWiFi();
    if (WiFi.status() == WL_CONNECTED) {
      sendVoiceQueryAndHandleResponse();
    } else {
      printStage("沒有 Wi-Fi，錄音完成但無法上傳");
      releaseWavBuffer();
    }
  }
}
