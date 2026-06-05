/**
 * ESP32 #2 邊緣庫存狀態感測站（含 MQTT 語音尋物亮燈）
 * Edge Inventory State Sensing Node with MQTT Voice-Search LED
 *
 * 在 RFID_WS2812.ino 基礎上新增：
 *   - MQTT 訂閱 topic: rrc/led/{DEVICE_ID}
 *   - 收到亮燈命令後，指定燈條亮黃色 LED_VOICE_DURATION_MS 秒
 *   - 時間到後自動恢復 RFID 庫存狀態燈
 *
 * 腳位（ESP32-S3-WROOM）：
 *   RC522 SCK  -> GPIO 18
 *   RC522 MISO -> GPIO 13
 *   RC522 MOSI -> GPIO 11
 *   RC522 RST  -> GPIO 12
 *   RC522 A CS -> GPIO 5
 *   RC522 B CS -> GPIO 16
 *   RC522 C CS -> GPIO 17
 *   LED A DIN  -> GPIO 21
 *   LED B DIN  -> GPIO 9
 *   LED C DIN  -> GPIO 10
 *
 * Arduino IDE Library Manager 需安裝：
 *   MFRC522
 *   FastLED
 *   ArduinoJson v6.x
 *   PubSubClient
 */

// ============================================================================
// 0. 模式設定
// ============================================================================
#define UID_SCAN_MODE 0

// ============================================================================
// 1. 函式庫
// ============================================================================
#include <SPI.h>
#define MFRC522_SPICLOCK (1000000u)  // 降到 1 MHz，麵包板多模組並聯時訊號穩定
#include <MFRC522.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>
#include <PubSubClient.h>

// ============================================================================
// 2. Wi-Fi / API / 裝置識別設定
// ============================================================================
const char* WIFI_SSID     = "DaShaBiNoIphone";
const char* WIFI_PASSWORD = "Yang0608";

const char* API_ENDPOINT  = "https://ntust-robot-researchers-equipment-m.vercel.app/api/iot/inventory/update";
const char* API_TOKEN     = "RRC_IoT_Secure_Token_2026";
const char* DEVICE_ID     = "ESP32_C1_L1";

// ============================================================================
// 3. MQTT 設定
// ============================================================================
// HiveMQ Cloud 連線資訊（TLS port 8883）
#define MQTT_BROKER   "51e7e72c197b4ba39dd0ba059a9e0b9e.s1.eu.hivemq.cloud"
#define MQTT_PORT     8883
#define MQTT_USERNAME "NTUST-RRC-esp32_C1_L1"
#define MQTT_PASSWORD "NTUST-RRC-esp32_C1_L1"
#define MQTT_CLIENT_ID "esp32-c1-l1"

// ESP32 訂閱的 topic，格式為 rrc/led/{DEVICE_ID}
// route.ts 發布的 topic 也是這個
#define MQTT_TOPIC_LED "rrc/led/ESP32_C1_L1"

// ============================================================================
// 4. 腳位定義
// ============================================================================
#define SPI_SCK_PIN     18
#define SPI_MOSI_PIN    11

#define RC522_A_RST_PIN 12  // 左側 GPIO12
#define RC522_B_RST_PIN  7  // 左側 GPIO7 (獨立 RST 避免干涉)
#define RC522_C_RST_PIN 15  // 左側 GPIO15 (獨立 RST 避免干涉)

#define RC522_A_CS_PIN   5
#define RC522_B_CS_PIN   4  // 改用左側 GPIO4 (避開 JTAG/PSRAM/Strap 衝突)
#define RC522_C_CS_PIN   6  // 改用左側 GPIO6 (避開 JTAG/PSRAM/Strap 衝突)

// 三個 RC522 獨立使用 MISO 腳位，解決 cheap 模組 MISO 不釋放的硬體 bug (Tri-state issue)
#define RC522_A_MISO_PIN 13  // 左側 GPIO13
#define RC522_B_MISO_PIN 14  // 左側下方 GPIO14
#define RC522_C_MISO_PIN  8  // 左側中間 GPIO8

// S3 無 GPIO25/27，改用 GPIO9/GPIO10/GPIO21
#define LED_A_PIN       21
#define LED_B_PIN        9
#define LED_C_PIN       10

// ============================================================================
// 5. LED 設定
// ============================================================================
#define NUM_LEDS    24
#define BRIGHTNESS  60
#define LED_TYPE    WS2812B
#define CLR_ORDER   GRB

// 語音尋物亮燈持續時間（毫秒）
#define LED_VOICE_DURATION_MS  10000

// ============================================================================
// 6. 輪詢與去抖動設定
// ============================================================================
#define DEBOUNCE_THRESHOLD          3
#define POLL_INTERVAL_MS          300
#define WIFI_RECONNECT_INTERVAL_MS 5000
#define WIFI_READY_BLUE_MS        3000
#define REGISTERED_RFID_GREEN_MS  5000
#define UNKNOWN_RFID_BLINK_MS      300

// ============================================================================
// 7. UID 對照表
// ============================================================================
struct UidEntry {
    uint8_t     uid[7];
    uint8_t     length;
    const char* boxId;
};

UidEntry UID_TABLE[] = {
    {{0x23, 0xF3, 0x9D, 0xA5}, 4, "BOX-001"},
    {{0xD3, 0xC4, 0x4B, 0x00}, 4, "BOX-002"},
    {{0x55, 0x66, 0x77, 0x88}, 4, "BOX-003"},
};
const int UID_TABLE_SIZE = sizeof(UID_TABLE) / sizeof(UidEntry);

// ============================================================================
// 8. 全域物件與狀態
// ============================================================================
#define SLOT_COUNT 3

MFRC522 rfidA(RC522_A_CS_PIN, RC522_A_RST_PIN);
MFRC522 rfidB(RC522_B_CS_PIN, RC522_B_RST_PIN);
MFRC522 rfidC(RC522_C_CS_PIN, RC522_C_RST_PIN);

MFRC522*    READERS[SLOT_COUNT]    = {&rfidA, &rfidB, &rfidC};
const char* SLOT_NAMES[SLOT_COUNT] = {"A", "B", "C"};

CRGB ledsA[NUM_LEDS];
CRGB ledsB[NUM_LEDS];
CRGB ledsC[NUM_LEDS];
CRGB* STRIPS[SLOT_COUNT] = {ledsA, ledsB, ledsC};

// LED 腳位陣列，用來做 pin → strip index 映射
const int LED_PINS[SLOT_COUNT] = {LED_A_PIN, LED_B_PIN, LED_C_PIN};

String confirmedState[SLOT_COUNT];
String pendingState[SLOT_COUNT];
int    debounceCount[SLOT_COUNT];
unsigned long confirmedStateChangedAt[SLOT_COUNT];

// 語音尋物亮燈狀態
bool          voiceSearchActive[SLOT_COUNT]  = {false, false, false};
unsigned long voiceSearchEndTime[SLOT_COUNT] = {0, 0, 0};

// MQTT 客戶端（使用 TLS）
WiFiClientSecure wifiSecure;
PubSubClient     mqttClient(wifiSecure);

// ============================================================================
// 9. 函式宣告
// ============================================================================
void   initStates();
void   wifiSetup();
bool   ensureWifiConnected();
void   beginWifiReconnect();
void   showWifiDisconnectedBreathing();
void   showWifiReadyBlue();
void   mqttCallback(char* topic, byte* payload, unsigned int length);
void   reconnectMqtt();
String pollSlot(int idx);
String uidToBoxId(MFRC522& reader);
bool   confirmDebounce(int idx, const String& raw);
void   pushSnapshot();
void   setStrip(int idx, CRGB color);
void   setAllStrips(CRGB color);
void   refreshLeds();
bool   isUnknownRfidState(const String& state);
int    pinToStripIndex(int gpioPin);
void   runScanMode();
void   printStateTable();

// ============================================================================
// 9.5. SPI MISO 動態切換
// ============================================================================
void selectReaderMiso(int idx) {
    SPI.end();
    delayMicroseconds(10);
    if (idx == 0) {
        SPI.begin(SPI_SCK_PIN, RC522_A_MISO_PIN, SPI_MOSI_PIN, -1);
    } else if (idx == 1) {
        SPI.begin(SPI_SCK_PIN, RC522_B_MISO_PIN, SPI_MOSI_PIN, -1);
    } else if (idx == 2) {
        SPI.begin(SPI_SCK_PIN, RC522_C_MISO_PIN, SPI_MOSI_PIN, -1);
    }
    delayMicroseconds(50); // 給予矩陣切換穩定的極短時間
}

// ============================================================================
// 10. setup()
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(300);

    Serial.println(F("\n========================================"));
    Serial.println(F(" ESP32 #2 Edge Inventory + MQTT LED"));
    Serial.println(F("========================================\n"));

    // CS 腳位在 SPI.begin() 之前先拉高，避免 floating CS 干擾 bus
    pinMode(RC522_A_CS_PIN, OUTPUT); digitalWrite(RC522_A_CS_PIN, HIGH);
    pinMode(RC522_B_CS_PIN, OUTPUT); digitalWrite(RC522_B_CS_PIN, HIGH);
    pinMode(RC522_C_CS_PIN, OUTPUT); digitalWrite(RC522_C_CS_PIN, HIGH);

    // 獨立 RST 腳位預設拉低，避免未啟動模組對匯流排造成電氣干擾
    pinMode(RC522_A_RST_PIN, OUTPUT); digitalWrite(RC522_A_RST_PIN, LOW);
    pinMode(RC522_B_RST_PIN, OUTPUT); digitalWrite(RC522_B_RST_PIN, LOW);
    pinMode(RC522_C_RST_PIN, OUTPUT); digitalWrite(RC522_C_RST_PIN, LOW);

    // 預初始化所有 MISO 腳位為帶上拉輸入，避免浮空
    pinMode(RC522_A_MISO_PIN, INPUT_PULLUP);
    pinMode(RC522_B_MISO_PIN, INPUT_PULLUP);
    pinMode(RC522_C_MISO_PIN, INPUT_PULLUP);

    Serial.println(F("[SPI] GPIO18(SCK)/11(MOSI) initialized with dynamic MISO"));

    for (int i = 0; i < SLOT_COUNT; i++) {
        selectReaderMiso(i);
        READERS[i]->PCD_Init();
        byte ver = READERS[i]->PCD_ReadRegister(MFRC522::VersionReg);
        Serial.printf("[RC522 %s] Version: 0x%02X", SLOT_NAMES[i], ver);
        if (ver == 0x00 || ver == 0xFF) {
            Serial.print(F("  <-- check wiring, power, RST, or CS pin"));
        }
        Serial.println();
    }

    FastLED.addLeds<LED_TYPE, LED_A_PIN, CLR_ORDER>(ledsA, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.addLeds<LED_TYPE, LED_B_PIN, CLR_ORDER>(ledsB, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.addLeds<LED_TYPE, LED_C_PIN, CLR_ORDER>(ledsC, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.setBrightness(BRIGHTNESS);
    FastLED.clear(true);
    Serial.println(F("[LED] GPIO21/9/10 WS2812B initialized"));

    for (int i = 0; i < NUM_LEDS; i++) {
        for (int s = 0; s < SLOT_COUNT; s++) STRIPS[s][i] = CRGB::Blue;
        FastLED.show();
        delay(40);
    }
    FastLED.clear(true);

    initStates();

#if UID_SCAN_MODE
    Serial.println(F("\n[SCAN] UID scan mode enabled (UID_SCAN_MODE=1)"));
    Serial.println(F("[SCAN] Put RFID cards/tags on readers to print UID_TABLE entries.\n"));
    return;
#endif

    wifiSetup();

    // MQTT 初始化
    // setInsecure() 略過憑證驗證，適合開發階段的自簽 / 私有 CA
    // 正式環境建議改用 wifiSecure.setCACert(hivemq_root_ca)
    wifiSecure.setInsecure();
    mqttClient.setServer(MQTT_BROKER, MQTT_PORT);
    mqttClient.setCallback(mqttCallback);
    mqttClient.setBufferSize(512);
    reconnectMqtt();

    Serial.println(F("\n[RUN] Start inventory polling...\n"));
}

// ============================================================================
// 11. loop()
// ============================================================================
void loop() {
#if UID_SCAN_MODE
    runScanMode();
    return;
#endif

    if (!ensureWifiConnected()) {
        return;
    }

    // MQTT keepalive 與自動重連
    if (!mqttClient.connected()) {
        reconnectMqtt();
    }
    mqttClient.loop();

    bool anyChanged = false;

    for (int i = 0; i < SLOT_COUNT; i++) {
        String raw      = pollSlot(i);
        String oldState = confirmedState[i];

        if (confirmDebounce(i, raw)) {
            anyChanged = true;
            Serial.printf("[CHANGE] Slot %s: \"%s\" -> \"%s\"\n",
                          SLOT_NAMES[i],
                          oldState.c_str(),
                          confirmedState[i].c_str());
            if (isUnknownRfidState(confirmedState[i])) {
                Serial.printf("[WARN] Slot %s detected unregistered RFID: %s\n",
                              SLOT_NAMES[i],
                              confirmedState[i].c_str());
            }
        }
    }

    refreshLeds();

    if (anyChanged) {
        printStateTable();
        pushSnapshot();
    }

    delay(POLL_INTERVAL_MS);
}

// ============================================================================
// 12. 狀態初始化
// ============================================================================
void initStates() {
    for (int i = 0; i < SLOT_COUNT; i++) {
        confirmedState[i] = "EMPTY";
        pendingState[i]   = "EMPTY";
        debounceCount[i]  = 0;
        confirmedStateChangedAt[i] = millis();
        voiceSearchActive[i]  = false;
        voiceSearchEndTime[i] = 0;
    }
}

// ============================================================================
// 13. Wi-Fi
// ============================================================================
void wifiSetup() {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

    Serial.printf("[WiFi] Connecting to '%s'", WIFI_SSID);
    for (int i = 0; i < 20 && WiFi.status() != WL_CONNECTED; i++) {
        delay(500);
        Serial.print(".");
    }

    if (WiFi.status() == WL_CONNECTED) {
        Serial.printf("\n[WiFi] Connected, IP: %s\n", WiFi.localIP().toString().c_str());
        showWifiReadyBlue();
    } else {
        Serial.println(F("\n[WiFi] Connect failed. RFID polling is paused until Wi-Fi is connected."));
        ensureWifiConnected();
    }
}

bool ensureWifiConnected() {
    if (WiFi.status() == WL_CONNECTED) return true;

    Serial.println(F("[WiFi] Disconnected. RFID polling paused; waiting for network..."));

    unsigned long lastReconnectMs = 0;
    while (WiFi.status() != WL_CONNECTED) {
        showWifiDisconnectedBreathing();

        unsigned long now = millis();
        if (now - lastReconnectMs >= WIFI_RECONNECT_INTERVAL_MS) {
            Serial.println(F("[WiFi] Reconnecting..."));
            beginWifiReconnect();
            lastReconnectMs = now;
        }
        delay(20);
    }

    Serial.printf("[WiFi] Reconnected, IP: %s\n", WiFi.localIP().toString().c_str());
    showWifiReadyBlue();
    return true;
}

void beginWifiReconnect() {
    WiFi.disconnect(false);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void showWifiDisconnectedBreathing() {
    float wave = (sin(millis() / 450.0) + 1.0) * 0.5;
    uint8_t value = 10 + (uint8_t)(wave * 120);
    setAllStrips(CRGB(value, 0, 0));
    FastLED.show();
}

void showWifiReadyBlue() {
    setAllStrips(CRGB::Blue);
    FastLED.show();
    delay(WIFI_READY_BLUE_MS);
    FastLED.clear(true);
}

// ============================================================================
// 14. MQTT
// ============================================================================
/**
 * MQTT 訊息回呼
 * 預期 payload: {"pins":[21,9],"duration":10000}
 * pins 陣列中的數字是 LED 燈條對應的 GPIO 腳位
 */
void mqttCallback(char* topic, byte* payload, unsigned int length) {
    Serial.printf("[MQTT] Message on topic: %s\n", topic);

    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload, length);
    if (err) {
        Serial.printf("[MQTT] JSON parse error: %s\n", err.c_str());
        return;
    }

    JsonArray pins     = doc["pins"].as<JsonArray>();
    int       duration = doc["duration"] | LED_VOICE_DURATION_MS;
    unsigned long endTime = millis() + (unsigned long)duration;

    for (JsonVariant pinVal : pins) {
        int gpioPin = pinVal.as<int>();
        int idx     = pinToStripIndex(gpioPin);
        if (idx >= 0) {
            if (duration == 0) {
                // 立即熄燈（確認領取 / 逾期）
                voiceSearchActive[idx] = false;
                voiceSearchEndTime[idx] = 0;
                Serial.printf("[MQTT] Strip %s (GPIO%d) voice LED OFF (duration=0)\n",
                              SLOT_NAMES[idx], gpioPin);
            } else {
                voiceSearchActive[idx]  = true;
                voiceSearchEndTime[idx] = endTime;
                Serial.printf("[MQTT] Strip %s (GPIO%d) voice LED on for %dms\n",
                              SLOT_NAMES[idx], gpioPin, duration);
            }
        } else {
            Serial.printf("[MQTT] Unknown GPIO pin in command: %d\n", gpioPin);
        }
    }
}

/**
 * MQTT 重連（最多嘗試 3 次，每次間隔 2 秒）
 */
void reconnectMqtt() {
    if (WiFi.status() != WL_CONNECTED) return;

    int attempts = 0;
    while (!mqttClient.connected() && attempts < 3) {
        Serial.print(F("[MQTT] Connecting..."));
        if (mqttClient.connect(MQTT_CLIENT_ID, MQTT_USERNAME, MQTT_PASSWORD)) {
            Serial.println(F(" connected"));
            mqttClient.subscribe(MQTT_TOPIC_LED);
            Serial.printf("[MQTT] Subscribed to: %s\n", MQTT_TOPIC_LED);
        } else {
            Serial.printf(" failed (rc=%d), retry in 2s\n", mqttClient.state());
            delay(2000);
        }
        attempts++;
    }
}

// ============================================================================
// 15. GPIO → Strip Index 映射
// ============================================================================
/**
 * 將 GPIO 腳位號對應成燈條陣列索引 (0=A, 1=B, 2=C)
 * 若 GPIO 不在 LED_PINS 中回傳 -1
 */
int pinToStripIndex(int gpioPin) {
    for (int i = 0; i < SLOT_COUNT; i++) {
        if (LED_PINS[i] == gpioPin) return i;
    }
    return -1;
}

// ============================================================================
// 16. RFID 輪詢
// ============================================================================
String pollSlot(int idx) {
    selectReaderMiso(idx);
    MFRC522& reader = *READERS[idx];

    byte atqa[2];
    byte atqaSize = sizeof(atqa);

    MFRC522::StatusCode s = reader.PICC_WakeupA(atqa, &atqaSize);
    if (s != MFRC522::STATUS_OK && s != MFRC522::STATUS_COLLISION) {
        return "EMPTY";
    }

    if (!reader.PICC_ReadCardSerial()) {
        reader.PICC_HaltA();
        return "EMPTY";
    }

    String boxId = uidToBoxId(reader);
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
    return boxId;
}

// ============================================================================
// 17. UID 轉 Box ID
// ============================================================================
String uidToBoxId(MFRC522& reader) {
    for (int i = 0; i < UID_TABLE_SIZE; i++) {
        if (reader.uid.size != UID_TABLE[i].length) continue;

        bool match = true;
        for (int j = 0; j < UID_TABLE[i].length; j++) {
            if (reader.uid.uidByte[j] != UID_TABLE[i].uid[j]) {
                match = false;
                break;
            }
        }
        if (match) return String(UID_TABLE[i].boxId);
    }

    String uid = "UID-";
    for (byte k = 0; k < reader.uid.size; k++) {
        if (reader.uid.uidByte[k] < 0x10) uid += "0";
        uid += String(reader.uid.uidByte[k], HEX);
    }
    uid.toUpperCase();
    Serial.printf("[UID] %s is not in UID_TABLE. Please register it if needed.\n", uid.c_str());
    return uid;
}

// ============================================================================
// 18. 去抖動
// ============================================================================
bool confirmDebounce(int idx, const String& raw) {
    if (raw == pendingState[idx]) {
        debounceCount[idx]++;
    } else {
        pendingState[idx]  = raw;
        debounceCount[idx] = 1;
    }

    if (debounceCount[idx] >= DEBOUNCE_THRESHOLD &&
        pendingState[idx]  != confirmedState[idx]) {
        confirmedState[idx] = pendingState[idx];
        confirmedStateChangedAt[idx] = millis();
        debounceCount[idx]  = 0;
        return true;
    }
    return false;
}

// ============================================================================
// 19. API 上傳
// ============================================================================
void pushSnapshot() {
    if (WiFi.status() != WL_CONNECTED) {
        Serial.println(F("[HTTP] Wi-Fi disconnected, skip upload."));
        return;
    }

    StaticJsonDocument<256> doc;
    doc["device_id"] = DEVICE_ID;

    JsonObject slots = doc.createNestedObject("slots");
    for (int i = 0; i < SLOT_COUNT; i++) {
        slots[SLOT_NAMES[i]] = confirmedState[i];
    }

    String payload;
    serializeJson(doc, payload);

    setAllStrips(CRGB::Blue);
    FastLED.show();

    HTTPClient http;
    http.begin(API_ENDPOINT);
    http.addHeader("Content-Type",  "application/json");
    http.addHeader("Authorization", "Bearer " + String(API_TOKEN));
    http.setTimeout(8000);

    Serial.print(F("[HTTP] POST "));
    Serial.println(payload);

    int code = http.POST(payload);
    if (code > 0) {
        Serial.printf("[HTTP] %d  %s\n", code, http.getString().c_str());
    } else {
        Serial.printf("[HTTP] Error: %s\n", http.errorToString(code).c_str());
    }
    http.end();

    for (int i = 0; i < SLOT_COUNT; i++) {
        if (confirmedState[i] != "EMPTY" && !isUnknownRfidState(confirmedState[i])) {
            confirmedStateChangedAt[i] = millis();
        }
    }

    refreshLeds();
}

// ============================================================================
// 20. LED 控制
// ============================================================================
void setStrip(int idx, CRGB color) {
    fill_solid(STRIPS[idx], NUM_LEDS, color);
}

void setAllStrips(CRGB color) {
    for (int s = 0; s < SLOT_COUNT; s++) setStrip(s, color);
}

/**
 * 根據狀態優先順序更新 LED：
 *   1. 語音尋物中 → 黃色閃爍（最高優先）
 *   2. 未登記 RFID → 紅色閃爍
 *   3. 已登記箱子（5 秒內）→ 綠色
 *   4. 空位 → 熄滅
 */
void refreshLeds() {
    unsigned long now    = millis();
    bool blinkOn  = (now / UNKNOWN_RFID_BLINK_MS) % 2 == 0;
    bool voiceBlink = (now / 500) % 2 == 0;  // 語音尋物慢速閃爍

    for (int i = 0; i < SLOT_COUNT; i++) {
        // 語音尋物模式：黃色閃爍
        if (voiceSearchActive[i]) {
            if (now < voiceSearchEndTime[i]) {
                setStrip(i, voiceBlink ? CRGB::Yellow : CRGB(80, 80, 0));
                continue;
            } else {
                // 計時結束，關閉語音尋物模式
                voiceSearchActive[i] = false;
                Serial.printf("[LED] Strip %s voice LED expired\n", SLOT_NAMES[i]);
            }
        }

        // 一般 RFID 庫存狀態
        if (isUnknownRfidState(confirmedState[i])) {
            setStrip(i, blinkOn ? CRGB::Red : CRGB::Black);
        } else if (confirmedState[i] != "EMPTY" &&
                   now - confirmedStateChangedAt[i] <= REGISTERED_RFID_GREEN_MS) {
            setStrip(i, CRGB::Green);
        } else {
            setStrip(i, CRGB::Black);
        }
    }
    FastLED.show();
}

bool isUnknownRfidState(const String& state) {
    return state.startsWith("UID-");
}

// ============================================================================
// 21. UID 掃描模式
// ============================================================================
void runScanMode() {
    static unsigned long lastMs = 0;
    if (millis() - lastMs < 500) return;
    lastMs = millis();

    for (int i = 0; i < SLOT_COUNT; i++) {
        selectReaderMiso(i);
        MFRC522& r = *READERS[i];
        byte atqa[2];
        byte sz = 2;

        if (r.PICC_WakeupA(atqa, &sz) != MFRC522::STATUS_OK) continue;
        if (!r.PICC_ReadCardSerial()) {
            r.PICC_HaltA();
            continue;
        }

        Serial.printf("\n[SCAN] Slot %s card detected\n", SLOT_NAMES[i]);
        Serial.printf("  UID length: %d bytes\n", r.uid.size);
        Serial.print(F("  UID hex: "));
        for (byte k = 0; k < r.uid.size; k++) {
            Serial.printf("0x%02X", r.uid.uidByte[k]);
            if (k < r.uid.size - 1) Serial.print(", ");
        }
        Serial.println();

        Serial.print(F("  Paste into UID_TABLE:\n    {{"));
        for (byte k = 0; k < r.uid.size; k++) {
            Serial.printf("0x%02X", r.uid.uidByte[k]);
            if (k < r.uid.size - 1) Serial.print(", ");
        }
        Serial.printf("}, %d, \"BOX-XXX\"},\n", r.uid.size);

        setStrip(i, CRGB::Yellow);
        FastLED.show();
        delay(300);
        setStrip(i, CRGB::Black);
        FastLED.show();

        r.PICC_HaltA();
        r.PCD_StopCrypto1();
    }
}

// ============================================================================
// 22. Serial 狀態表
// ============================================================================
void printStateTable() {
    Serial.println(F("+----------+------------------+"));
    Serial.println(F("| Slot     | State            |"));
    Serial.println(F("+----------+------------------+"));
    for (int i = 0; i < SLOT_COUNT; i++) {
        Serial.printf("| %-8s | %-16s |\n",
                      SLOT_NAMES[i], confirmedState[i].c_str());
    }
    Serial.println(F("+----------+------------------+"));
}
