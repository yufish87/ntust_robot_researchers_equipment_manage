#include <Arduino.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <AudioFileSource.h>
#include <AudioFileSourceBuffer.h>
#include <AudioGeneratorMP3.h>
#include <AudioOutputI2S.h>
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
// 7. route.ts 回傳 audioUrl/audio_url，ESP32 端會串流下載 MP3，
//    並用內建 DAC 從 GPIO25 輸出到 PAM8403 播放。
//
// 注意：
// - PAM8403 是類比音訊放大器，不是 I2S 放大器。
//   所以此程式用 ESP32 內建 DAC1，也就是 GPIO25，輸出類比聲音。
// - route.ts 建議回傳 MP3 音檔 URL，ESP32 會串流播放，避免 base64 佔 RAM。
// ================================================================

// ===== 使用者設定區 =====
// 這裡是你最常需要改的地方：Wi-Fi 名稱、密碼、Vercel API URL。
// 程式不使用 API key，會直接把錄到的 WAV 上傳到 VOICE_API_URL。
const char *WIFI_SSID = "[NTUST_IoT]";
const char *WIFI_PASSWORD = "[PASSWORD]";

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
const char *VOICE_API_URL = "https://ntust-robot-researchers-equipment-m.vercel.app/api/iot/voice";

// Vercel API Bearer Token：
// 後端若需要驗證，HTTP header 會送出：
// Authorization: Bearer RRC_IoT_Secure_Token_2026
const char *API_BEARER_TOKEN = "RRC_IoT_Secure_Token_2026";

// 裝置編號：
// 用在 HTTP header / JSON 裡，讓後端知道是哪一台 ESP32 發出的請求。
const char *DEVICE_ID = "ESP32_VOICE_NODE_1";

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

// PAM8403 音訊輸入：
// GPIO25 是 ESP32 的 DAC1，可輸出類比電壓波形。
// 請接到 PAM8403 的 R input，並且 ESP32 GND 要和 PAM8403 GND 共地。
const int PAM8403_RIGHT_DAC_PIN = 25;

// ===== 音訊設定區 =====
// ESP32 有兩組 I2S 控制器：
// - I2S_NUM_1 用來接 INMP441 收音
// - I2S_NUM_0 留給內建 DAC 播放 MP3
//
// 注意：ESP32 內建 DAC 播放只能走 I2S0，所以麥克風必須避開 I2S0。
const i2s_port_t MIC_I2S_PORT = I2S_NUM_1;
i2s_chan_handle_t micRxChannel = nullptr;

// 錄音格式：
// 16000 Hz / 16-bit / mono 是語音辨識常見格式，資料量也比較適合 ESP32。
const uint32_t RECORD_SAMPLE_RATE = 16000;
// NodeMCU-32S 通常沒有 PSRAM，錄太長可能導致 malloc 失敗。
// 3 秒 16 kHz WAV 約 96 KB，比較適合沒有 PSRAM 的 ESP32。
// 若 Serial 顯示記憶體足夠，可再調高。
const uint16_t MAX_RECORD_SECONDS = 3;

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
const size_t MAX_HTTP_RESPONSE_CHARS = 6000;

// wavBuffer 會存完整 WAV 檔，錄完後直接拿來 POST。
// 3 秒 16 kHz 16-bit mono 約 96 KB，加上 header 後約 96044 bytes。
// lastWavBytes 會記錄這次實際錄到的 WAV 長度。
uint8_t *wavBuffer = nullptr;
size_t lastWavBytes = 0;
uint32_t lastQueryAt = 0;
struct ParsedUrl {
  bool https = true;
  String host;
  String path = "/";
  uint16_t port = 443;
};

class HTTPSAudioFileSource : public AudioFileSource {
public:
  HTTPSAudioFileSource() : stream(nullptr), pos(0), size(-1), opened(false) {}

  ~HTTPSAudioFileSource() override {
    close();
  }

  bool open(const char *url) override {
    close();
    secureClient.setInsecure();
    if (!http.begin(secureClient, url)) {
      return false;
    }
    http.setFollowRedirects(HTTPC_FORCE_FOLLOW_REDIRECTS);
    int code = http.GET();
    if (code != HTTP_CODE_OK) {
      Serial.printf("[AUDIO] Audio URL HTTP status: %d\n", code);
      http.end();
      return false;
    }
    stream = http.getStreamPtr();
    pos = 0;
    size = http.getSize();
    opened = true;
    Serial.printf("[AUDIO] Audio stream opened, size=%d\n", size);
    return true;
  }

  uint32_t read(void *data, uint32_t len) override {
    return readInternal(data, len, false);
  }

  uint32_t readNonBlock(void *data, uint32_t len) override {
    return readInternal(data, len, true);
  }

  bool seek(int32_t pos, int dir) override {
    (void)pos;
    (void)dir;
    return false;
  }

  bool close() override {
    if (opened) {
      http.end();
    }
    stream = nullptr;
    pos = 0;
    size = -1;
    opened = false;
    return true;
  }

  bool isOpen() override {
    return opened && http.connected();
  }

  uint32_t getSize() override {
    return size > 0 ? (uint32_t)size : 0;
  }

  uint32_t getPos() override {
    return pos;
  }

private:
  uint32_t readInternal(void *data, uint32_t len, bool nonBlock) {
    if (!opened || stream == nullptr || data == nullptr) {
      return 0;
    }
    if (size > 0 && pos >= (uint32_t)size) {
      return 0;
    }

    uint32_t startedAt = millis();
    while (!stream->available()) {
      if (!http.connected()) {
        return 0;
      }
      if (nonBlock || millis() - startedAt > 1000) {
        return 0;
      }
      delay(1);
    }

    size_t available = stream->available();
    if (available < len) {
      len = available;
    }
    if (size > 0 && pos + len > (uint32_t)size) {
      len = (uint32_t)size - pos;
    }

    int readBytes = stream->read((uint8_t *)data, len);
    if (readBytes <= 0) {
      return 0;
    }
    pos += readBytes;
    return readBytes;
  }

  WiFiClientSecure secureClient;
  HTTPClient http;
  Client *stream;
  uint32_t pos;
  int size;
  bool opened;
};

void printStage(const char *message) {
  // 統一的階段提示格式。
  // Serial Monitor 看到 [STAGE] 就代表目前流程進度。
  Serial.print("[STAGE] ");
  Serial.println(message);
}

bool ensureWavBuffer() {
  // 配置錄音用 RAM。
  // 若配置失敗，會印出目前可用 heap 和需要的空間，方便判斷是否要降低 MAX_RECORD_SECONDS。
  if (wavBuffer != nullptr) {
    return true;
  }

  Serial.printf("[MEM] Free heap before audio buffer: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  Serial.printf("[MEM] Need WAV buffer: %u bytes\n", (unsigned int)MAX_WAV_BYTES);

  wavBuffer = (uint8_t *)ps_malloc(MAX_WAV_BYTES);
  if (wavBuffer == nullptr) {
    wavBuffer = (uint8_t *)malloc(MAX_WAV_BYTES);
  }

  if (wavBuffer == nullptr) {
    printStage("錄音記憶體不足，請降低 MAX_RECORD_SECONDS");
    Serial.println("Not enough memory for WAV buffer.");
    return false;
  }

  Serial.printf("[MEM] WAV buffer allocated. Free heap now: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  return true;
}

void releaseWavBuffer() {
  // 上傳完成後，錄音 WAV buffer 已不再需要。
  // 先釋放 RAM，留給後續 HTTP 音檔串流與 MP3 解碼使用。
  if (wavBuffer != nullptr) {
    free(wavBuffer);
    wavBuffer = nullptr;
    lastWavBytes = 0;
    Serial.printf("[MEM] WAV buffer released. Free heap now: %u bytes\n", (unsigned int)ESP.getFreeHeap());
  }
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

void playMp3FromUrl(const char *audioUrl) {
  // 使用 ESP8266Audio library 直接從音檔 URL 串流解碼 MP3。
  // INTERNAL_DAC 會使用 ESP32 內建 DAC，GPIO25/GPIO26 輸出類比音訊。
  // 你的 PAM8403 R 接 GPIO25，因此會從 GPIO25 聽到聲音。
  if (audioUrl == nullptr || strlen(audioUrl) == 0) {
    printStage("音檔 URL 為空，略過播放");
    return;
  }

  printStage("正在開啟音檔 URL 串流...");
  Serial.print("[AUDIO URL] ");
  Serial.println(audioUrl);
  Serial.printf("[AUDIO] URL length: %u\n", (unsigned int)strlen(audioUrl));

  HTTPSAudioFileSource *source = new HTTPSAudioFileSource();
  if (source == nullptr) {
    printStage("MP3 串流音源物件建立失敗");
    return;
  }

  if (!source->open(audioUrl)) {
    printStage("音檔 URL 開啟失敗");
    delete source;
    return;
  }

  AudioFileSourceBuffer *buffered = new AudioFileSourceBuffer(source, 4096);
  AudioOutputI2S *output = new AudioOutputI2S(0, AudioOutputI2S::INTERNAL_DAC);
  AudioGeneratorMP3 *mp3 = new AudioGeneratorMP3();

  if (buffered == nullptr || output == nullptr || mp3 == nullptr) {
    printStage("MP3 串流播放物件建立失敗");
    source->close();
    delete mp3;
    delete output;
    delete buffered;
    delete source;
    return;
  }

  output->SetOutputModeMono(true);

  if (!mp3->begin(buffered, output)) {
    printStage("MP3 串流解碼器啟動失敗");
    source->close();
    delete mp3;
    delete output;
    delete buffered;
    delete source;
    return;
  }

  printStage("正在用 GPIO25 串流播放 API 回覆語音...");
  while (mp3->isRunning()) {
    if (!mp3->loop()) {
      mp3->stop();
    }
    delay(1);
  }

  printStage("API 回覆語音播放完成");

  source->close();
  delete mp3;
  delete output;
  delete buffered;
  delete source;
}

void writeLE16(uint8_t *p, uint16_t value) {
  // WAV 檔案格式使用 little-endian。
  // 也就是低位元組放前面，高位元組放後面。
  p[0] = value & 0xFF;
  p[1] = (value >> 8) & 0xFF;
}

void writeLE32(uint8_t *p, uint32_t value) {
  // 將 32-bit 整數拆成 4 個 byte，寫入 WAV header。
  p[0] = value & 0xFF;
  p[1] = (value >> 8) & 0xFF;
  p[2] = (value >> 16) & 0xFF;
  p[3] = (value >> 24) & 0xFF;
}

uint16_t readLE16(const uint8_t *p) {
  // 從 WAV header 讀回 16-bit little-endian 數值。
  return p[0] | (p[1] << 8);
}

uint32_t readLE32(const uint8_t *p) {
  // 從 WAV header 讀回 32-bit little-endian 數值。
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
  // 確保錄音用的 WAV buffer 已配置。
  // 優先使用 ps_malloc，若板子有 PSRAM 可降低主記憶體壓力。
  // NodeMCU-32S 多數沒有 PSRAM，所以失敗時會退回一般 malloc。
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
    client = &secureClient;
  } else {
    client = &plainClient;
  }

  printStage("正在建立 Voice API 連線...");
  if (!client->connect(url.host.c_str(), url.port)) {
    printStage("Voice API 連線建立失敗");
    return false;
  }

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
  client->print(String("Content-Type: multipart/form-data; boundary=") + boundary + "\r\n");
  client->print(String("Content-Length: ") + String(contentLength) + "\r\n\r\n");

  bool uploadOk =
      writeAll(*client, (const uint8_t *)multipartHead.c_str(), multipartHead.length(), "multipart head") &&
      writeAll(*client, wavBuffer, lastWavBytes, "voice.wav") &&
      writeAll(*client, (const uint8_t *)multipartTail.c_str(), multipartTail.length(), "multipart tail");

  if (!uploadOk) {
    printStage("音訊資料未完整送出，取消等待後端回應");
    client->stop();
    return false;
  }

  client->flush();
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
    printStage("後端已回傳音檔 URL，準備串流播放");
    responsePreview = "";
    playMp3FromUrl(audioUrl.c_str());
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

  // 預先配置錄音 buffer。
  // 如果這裡失敗，recordWavWhileButtonHeld() 仍會再嘗試一次並顯示錯誤。
  ensureWavBuffer();

  // 啟動 INMP441 收音。
  setupMicrophoneI2S();
  printStage("INMP441 麥克風初始化完成");

  // 連上 Wi-Fi。若第一次失敗，loop() 會繼續重試。
  // 這裡先不強制連線，避免 Wi-Fi/TLS 佔用太多 RAM 造成錄音 buffer 配置失敗。
  // 真正要上傳前，loop() 會再檢查並連線。
  printStage("待機中：按住 GPIO18 開始錄音，放開後上傳");
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
    }
  }
}
