/**
 * ESP32 #2 邊緣庫存狀態感測站
 * Edge Inventory State Sensing Node
 *
 * 這份程式以「三個 RC522 RFID 讀卡機 + 三條 WS2812B LED 燈條」為核心。
 * ESP32 會輪詢 A/B/C 三個櫃位，將 RFID UID 轉換成 boxId，再把目前櫃位快照
 * 上傳到 Vercel / Next.js BFF API。
 *
 * 主要設計：
 * 1. 三個 RC522 共用同一組 SPI：SCK / MISO / MOSI / RST。
 * 2. 每個 RC522 使用獨立 CS 腳位，避免 SPI 匯流排衝突。
 * 3. 使用 PICC_WakeupA() 讀卡，讓已被 HALT 的卡片仍能再次被偵測。
 * 4. 使用 debounce 去抖動，連續多次讀到同一狀態才確認變更。
 * 5. 只有 confirmedState 真正改變時才 POST API，降低雲端請求量。
 * 6. LED 顯示目前櫃位狀態：有箱子亮綠色，空位熄滅，上傳時短暫亮藍色。
 *
 * 腳位（ESP32-S3-WROOM）：
 *   RC522 SCK  -> GPIO 18
 *   RC522 MISO -> GPIO 13  (避開 S3 USB_D+ GPIO19)
 *   RC522 MOSI -> GPIO 11  (S3 無 GPIO23)
 *   RC522 RST  -> GPIO 12  (S3 無 GPIO22)
 *   RC522 A CS -> GPIO 5
 *   RC522 B CS -> GPIO 16
 *   RC522 C CS -> GPIO 17
 *   LED A DIN  -> GPIO 9
 *   LED B DIN  -> GPIO 10  (S3 無 GPIO25)
 *   LED C DIN  -> GPIO 21  (S3 無 GPIO27)
 *
 * 電源注意：
 *   RC522 請接 ESP32 3.3V，不要接 5V。
 *   LED 可使用外部 5V，但 LED 電源 GND 必須和 ESP32 GND 共地。
 *
 * Arduino IDE Library Manager 需要安裝：
 *   MFRC522
 *   FastLED
 *   ArduinoJson v6.x
 */

// ============================================================================
// 0. 模式設定
// ============================================================================
// UID_SCAN_MODE = 1：
//   進入 UID 掃描模式，不連 Wi-Fi、不上傳 API。
//   用來讀取未知 RFID 卡片或磁扣的 UID，方便填入 UID_TABLE。
//
// UID_SCAN_MODE = 0：
//   正式庫存模式。讀卡、比對 UID_TABLE、更新 LED，並在狀態變化時上傳 API。
#define UID_SCAN_MODE 0

// ============================================================================
// 1. 函式庫
// ============================================================================
#include <SPI.h>
#define MFRC522_SPICLOCK (500000u)  // 降到 1 MHz，麵包板多模組並聯時訊號穩定
#include <MFRC522.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <FastLED.h>

// ============================================================================
// 2. Wi-Fi / API / 裝置識別設定
// ============================================================================
// Wi-Fi 名稱與密碼。正式交作業或放到 GitHub 前，建議改成佔位文字或 secrets。
const char* WIFI_SSID     = "yufish";
const char* WIFI_PASSWORD = "yufish666";

// Vercel BFF API endpoint。
// 這個 API 預期接收整個櫃位快照，而不是單一 slot diff。
const char* API_ENDPOINT  = "https://ntust-robot-researchers-equipment-m.vercel.app/api/iot/inventory/update";

// API Bearer Token。後端會用 Authorization: Bearer <token> 驗證硬體身分。
const char* API_TOKEN     = "RRC_IoT_Secure_Token_2026";

// 裝置 ID，建議對應 Google Sheets CabinetLayout 裡的櫃位或節點名稱。
const char* DEVICE_ID     = "ESP32_C1_L1";

// ============================================================================
// 3. 腳位定義
// ============================================================================
// ESP32-S3 SPI 腳位（非預設，手動指定）。
// S3 無 GPIO22/23，MOSI 改用 GPIO11。
#define SPI_SCK_PIN     18
#define SPI_MOSI_PIN    11

// 三個 RC522 獨立使用 RST 腳位。
#define RC522_A_RST_PIN 12  // 左側 GPIO12
#define RC522_B_RST_PIN  7  // 左側 GPIO7 (獨立 RST 避免干涉)
#define RC522_C_RST_PIN 15  // 左側 GPIO15 (獨立 RST 避免干涉)

// 三個 RC522 各自使用不同 CS/SDA 腳位。
// 避免使用 GPIO16/17 (與 ESP32-S3 WROOM-1 N16R8 的 PSRAM 腳位衝突)
#define RC522_A_CS_PIN   5
#define RC522_B_CS_PIN   4  // 改用左側 GPIO4 (避開 JTAG/PSRAM/Strap 衝突)
#define RC522_C_CS_PIN   6  // 改用左側 GPIO6 (避開 JTAG/PSRAM/Strap 衝突)

// 三個 RC522 獨立使用 MISO 腳位，解決 cheap 模組 MISO 不釋放的硬體 bug (Tri-state issue)
#define RC522_A_MISO_PIN 13  // 左側 GPIO13
#define RC522_B_MISO_PIN 14  // 左側下方 GPIO14
#define RC522_C_MISO_PIN  8  // 左側中間 GPIO8

// 三條 LED 燈條的資料輸入腳位。
// S3 無 GPIO25/27，改用 GPIO9/GPIO10/GPIO21。
#define LED_A_PIN        9
#define LED_B_PIN       10
#define LED_C_PIN       21

// ============================================================================
// 4. LED 設定
// ============================================================================
// 每一條 LED 燈條的 LED 數量。若你的燈條不是 24 顆，改這個值即可。
#define NUM_LEDS    24

// 亮度範圍 0-255。外部 5V 電源不足時不要開太高，避免重啟或顏色異常。
#define BRIGHTNESS  60

// WS2812B 通常使用 GRB 色彩順序；若顏色顯示錯誤，可改成 RGB 測試。
#define LED_TYPE    WS2812B
#define CLR_ORDER   GRB

// ============================================================================
// 5. 輪詢與去抖動設定
// ============================================================================
// 需要連續讀到同一個 raw state 幾次，才承認它是新的穩定狀態。
// 數值越大越穩，但反應越慢。
#define DEBOUNCE_THRESHOLD  3

// 每輪掃描 A/B/C 三個 slot 之後等待的時間。
// 太短可能造成讀卡不穩，太長會讓狀態反應變慢。
#define POLL_INTERVAL_MS  300

// Wi-Fi 沒連上時，多久重新啟動一次 Wi-Fi 連線流程。
#define WIFI_RECONNECT_INTERVAL_MS  5000

// Wi-Fi 連線成功後，藍燈亮多久再開始 RFID 掃描。
#define WIFI_READY_BLUE_MS  3000

// 已註冊 RFID 被確認後，綠燈只維持顯示多久。
#define REGISTERED_RFID_GREEN_MS  5000

// 未登記 RFID 的紅燈閃爍週期。
#define UNKNOWN_RFID_BLINK_MS  300

// ============================================================================
// 6. UID 對照表
// ============================================================================
// UID_TABLE 的用途：
//   把實際 RFID UID 對應成後端認得的箱子 ID，例如 BOX-001。
//
// 若 UID 不在表裡，程式會回傳 "UID-XXXXXXXX" 這種暫時名稱，
// 並在 Serial Monitor 印出提示，方便你把它加入 UID_TABLE。
struct UidEntry {
    uint8_t     uid[7];   // UID bytes。MIFARE Classic 1K 通常是 4 bytes，也可能有 7 bytes。
    uint8_t     length;   // UID 長度。
    const char* boxId;    // 對應的箱子 ID，應和後端 BoxList 或資料庫一致。
};

UidEntry UID_TABLE[] = {
    // uid bytes                         長度  箱子 ID
    {{0x17, 0xBE, 0xF5, 0xD7},            4,   "BOX-001"},
    {{0x5B, 0xDB, 0x12, 0x07},            4,   "BOX-002"},
    {{0x23, 0x44, 0x17, 0x0D},            4,   "BOX-003"},
};
const int UID_TABLE_SIZE = sizeof(UID_TABLE) / sizeof(UidEntry);

// ============================================================================
// 7. 全域物件與狀態
// ============================================================================
#define SLOT_COUNT 3

// 建立三個 RC522 讀卡機物件。
// MFRC522 建構子參數為：CS pin, RST pin。
MFRC522 rfidA(RC522_A_CS_PIN, RC522_A_RST_PIN);
MFRC522 rfidB(RC522_B_CS_PIN, RC522_B_RST_PIN);
MFRC522 rfidC(RC522_C_CS_PIN, RC522_C_RST_PIN);

// 用陣列管理三個 reader，後續可用 for loop 統一處理 A/B/C。
MFRC522*    READERS[SLOT_COUNT]    = {&rfidA, &rfidB, &rfidC};
const char* SLOT_NAMES[SLOT_COUNT] = {"A", "B", "C"};

// 三條 WS2812B LED 燈條的 pixel buffer。
CRGB ledsA[NUM_LEDS];
CRGB ledsB[NUM_LEDS];
CRGB ledsC[NUM_LEDS];
CRGB* STRIPS[SLOT_COUNT] = {ledsA, ledsB, ledsC};

// confirmedState：
//   已確認、穩定、會送到 API 的狀態。值可能是 "EMPTY"、"BOX-001" 或 "UID-XXXXXXXX"。
//
// pendingState：
//   目前正在觀察中的候選狀態，還沒通過 debounce。
//
// debounceCount：
//   pendingState 連續出現的次數。
String confirmedState[SLOT_COUNT];
String pendingState[SLOT_COUNT];
int    debounceCount[SLOT_COUNT];

// 每個 slot 最近一次 confirmedState 變更的時間。
// 用來讓已註冊 RFID 的綠燈只亮 REGISTERED_RFID_GREEN_MS。
unsigned long confirmedStateChangedAt[SLOT_COUNT];

// ============================================================================
// 8. 函式宣告
// ============================================================================
void   initStates();
void   wifiSetup();
bool   ensureWifiConnected();
void   beginWifiReconnect();
void   showWifiDisconnectedBreathing();
void   showWifiReadyBlue();
String pollSlot(int idx);
String uidToBoxId(MFRC522& reader);
bool   confirmDebounce(int idx, const String& raw);
void   pushSnapshot();
void   setStrip(int idx, CRGB color);
void   setAllStrips(CRGB color);
void   refreshLeds();
bool   isUnknownRfidState(const String& state);
void   runScanMode();
void   printStateTable();

// ============================================================================
// 8.5. SPI MISO 動態切換
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
// 9. setup()
// ============================================================================
void setup() {
    Serial.begin(115200);
    delay(300);

    Serial.println(F("\n========================================"));
    Serial.println(F(" ESP32 #2 Edge Inventory RFID Node"));
    Serial.println(F("========================================\n"));

    // 初始化 SPI bus。
    // 在 SPI.begin() 之前先把所有 CS 腳位拉高，避免 floating CS 干擾 bus。
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

    // 初始化三個 RC522。
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

    // 初始化三條 LED 燈條。
    FastLED.addLeds<LED_TYPE, LED_A_PIN, CLR_ORDER>(ledsA, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.addLeds<LED_TYPE, LED_B_PIN, CLR_ORDER>(ledsB, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.addLeds<LED_TYPE, LED_C_PIN, CLR_ORDER>(ledsC, NUM_LEDS)
           .setCorrection(TypicalLEDStrip);
    FastLED.setBrightness(BRIGHTNESS);
    FastLED.clear(true);
    Serial.println(F("[LED] GPIO21/9/10 WS2812B initialized"));

    // 開機跑一個藍色流水燈，表示程式已啟動且 LED 可控制。
    for (int i = 0; i < NUM_LEDS; i++) {
        for (int s = 0; s < SLOT_COUNT; s++) STRIPS[s][i] = CRGB::Blue;
        FastLED.show();
        delay(40);
    }
    FastLED.clear(true);

    // 初始化 A/B/C 三個 slot 的庫存狀態。
    initStates();

    // UID 掃描模式只負責讀 UID，不需要 Wi-Fi 和 API。
#if UID_SCAN_MODE
    Serial.println(F("\n[SCAN] UID scan mode enabled (UID_SCAN_MODE=1)"));
    Serial.println(F("[SCAN] Put RFID cards/tags on readers to print UID_TABLE entries.\n"));
    return;
#endif

    // 正式模式才連 Wi-Fi。
    wifiSetup();

    Serial.println(F("\n[RUN] Start inventory polling...\n"));
}

// ============================================================================
// 10. loop()
// ============================================================================
void loop() {
    // UID 掃描模式：反覆掃描卡片 UID，印出可貼進 UID_TABLE 的格式。
#if UID_SCAN_MODE
    runScanMode();
    return;
#endif

    // Wi-Fi 是正式掃描的必要條件。
    // 如果斷線，就停在紅色呼吸燈與重連流程，不做離線 RFID 偵測。
    if (!ensureWifiConnected()) {
        return;
    }

    bool anyChanged = false;

    // Step 1：輪詢 A/B/C 三個 RFID 讀卡機。
    for (int i = 0; i < SLOT_COUNT; i++) {
        String raw      = pollSlot(i);
        String oldState = confirmedState[i];

        // Step 2：對 raw state 做 debounce。
        // 只有狀態連續穩定達 DEBOUNCE_THRESHOLD 次，confirmedState 才會更新。
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

    // Step 3：每輪都刷新 LED，讓顯示和 confirmedState 保持一致。
    refreshLeds();

    // Step 4：只要任一 slot 狀態改變，就印表格並上傳整份快照。
    if (anyChanged) {
        printStateTable();
        pushSnapshot();
    }

    delay(POLL_INTERVAL_MS);
}

// ============================================================================
// 11. 狀態初始化
// ============================================================================
/**
 * 初始化三個 slot 的狀態。
 *
 * confirmedState 一開始設為 EMPTY：
 *   代表系統剛開機時先假設櫃位是空的。
 *
 * 注意：
 *   這份程式不會在開機時主動送出初始快照，只有狀態變化時才送。
 *   若後端需要開機校正，可之後再加上 pushSnapshot()。
 */
void initStates() {
    for (int i = 0; i < SLOT_COUNT; i++) {
        confirmedState[i] = "EMPTY";
        pendingState[i]   = "EMPTY";
        debounceCount[i]  = 0;
        confirmedStateChangedAt[i] = millis();
    }
}

// ============================================================================
// 12. Wi-Fi 初始化
// ============================================================================
/**
 * 連線 Wi-Fi，並用 LED 顯示連線結果。
 *
 * 成功：
 *   全部 LED 燈條亮藍色 3 秒。
 *
 * 失敗：
 *   全部 LED 燈條進入紅色呼吸燈，直到 Wi-Fi 連上。
 */
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

/**
 * 確保 Wi-Fi 已連線。
 *
 * 只要 Wi-Fi 沒連上，就停在紅色呼吸燈並定期重啟連線流程。
 * 這段 while 不會回到 loop()，因此 RFID 掃描會被完全暫停。
 */
bool ensureWifiConnected() {
    if (WiFi.status() == WL_CONNECTED) {
        return true;
    }

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

/**
 * 重新啟動 Wi-Fi 連線流程。
 * 先 disconnect 再 begin，避免 ESP32 還在 connecting 時一直噴錯。
 */
void beginWifiReconnect() {
    WiFi.disconnect(false);
    delay(100);
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

/**
 * 全部燈條紅色呼吸燈。
 */
void showWifiDisconnectedBreathing() {
    float wave = (sin(millis() / 450.0) + 1.0) * 0.5;
    uint8_t value = 10 + (uint8_t)(wave * 120);
    setAllStrips(CRGB(value, 0, 0));
    FastLED.show();
}

/**
 * Wi-Fi 連線成功提示：全部燈條亮藍色 3 秒。
 */
void showWifiReadyBlue() {
    setAllStrips(CRGB::Blue);
    FastLED.show();
    delay(WIFI_READY_BLUE_MS);
    FastLED.clear(true);
}

// ============================================================================
// 13. RFID 輪詢
// ============================================================================
/**
 * 輪詢單一 slot 的 RFID 讀卡機。
 *
 * 回傳值：
 *   "EMPTY"      代表沒有讀到卡。
 *   "BOX-001"    代表讀到 UID_TABLE 中已登錄的箱子。
 *   "UID-XXXXXX" 代表讀到卡，但 UID_TABLE 尚未登錄。
 *
 * 為什麼使用 PICC_WakeupA()：
 *   PICC_IsNewCardPresent() 底層偏向 REQA，對剛被 Halt 的卡片可能不夠穩。
 *   PICC_WakeupA() 使用 WUPA，能叫醒 IDLE/HALT 狀態的卡，適合固定放在櫃位上的標籤。
 */
String pollSlot(int idx) {
    selectReaderMiso(idx);
    MFRC522& reader = *READERS[idx];

    byte atqa[2];
    byte atqaSize = sizeof(atqa);

    // 先用 WUPA 嘗試偵測卡片。
    // STATUS_COLLISION 也表示場上可能有卡，所以不直接視為完全沒有卡。
    MFRC522::StatusCode s = reader.PICC_WakeupA(atqa, &atqaSize);
    if (s != MFRC522::STATUS_OK && s != MFRC522::STATUS_COLLISION) {
        return "EMPTY";
    }

    // 讀取 UID。若讀取失敗，將卡片 Halt 後回報 EMPTY。
    if (!reader.PICC_ReadCardSerial()) {
        reader.PICC_HaltA();
        return "EMPTY";
    }

    String boxId = uidToBoxId(reader);

    // 讀完後清理 RFID 通訊狀態，避免下一輪讀卡受影響。
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();

    return boxId;
}

// ============================================================================
// 14. UID 轉 Box ID
// ============================================================================
/**
 * 將 MFRC522 讀到的 UID 和 UID_TABLE 比對。
 *
 * 若找到：
 *   回傳 UID_TABLE 裡設定的 boxId，例如 BOX-001。
 *
 * 若找不到：
 *   回傳 UID-XXXXXXXX，並在 Serial 印出提醒。
 *   這樣即使新卡片還沒登錄，系統仍能知道「某個未知 UID」出現在櫃位上。
 */
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

    // 未登錄 UID：組成可讀的 UID-HEX 字串。
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
// 15. 去抖動
// ============================================================================
/**
 * 將單次 RFID 讀值 raw 轉換成穩定狀態 confirmedState。
 *
 * raw 可能因為距離、角度、干擾、供電不穩而短暫跳成 EMPTY。
 * 所以不應該讀一次就立刻改狀態，而是要求同一 raw 連續出現多次。
 *
 * 回傳 true：
 *   confirmedState[idx] 已經改變，外層 loop 應該上傳快照。
 *
 * 回傳 false：
 *   狀態還沒穩定，或穩定後和原本 confirmedState 一樣。
 */
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
// 16. API 上傳
// ============================================================================
/**
 * 將目前三個 slot 的 confirmedState 打包成 JSON，POST 到 Vercel BFF API。
 *
 * payload 格式：
 * {
 *   "device_id": "ESP32_C1_L1",
 *   "slots": {
 *     "A": "BOX-001",
 *     "B": "EMPTY",
 *     "C": "BOX-002"
 *   }
 * }
 *
 * 這種 snapshot 格式的優點：
 *   後端可以一次取得整個節點目前狀態，不需要自己重建所有 diff。
 */
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

    // 上傳期間全部 LED 亮藍色，讓現場可以看出正在同步。
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

    // 上傳後才開始計算已登記 RFID 的綠燈顯示時間，
    // 避免 HTTP 請求期間的藍燈吃掉 5 秒綠燈時間。
    for (int i = 0; i < SLOT_COUNT; i++) {
        if (confirmedState[i] != "EMPTY" && !isUnknownRfidState(confirmedState[i])) {
            confirmedStateChangedAt[i] = millis();
        }
    }

    // 上傳後回到庫存狀態顯示。
    refreshLeds();
}

// ============================================================================
// 17. LED 控制
// ============================================================================
/**
 * 將指定 slot 的整條 LED 填成同一種顏色。
 */
void setStrip(int idx, CRGB color) {
    fill_solid(STRIPS[idx], NUM_LEDS, color);
}

/**
 * 將全部已設定的 LED 燈條填成同一種顏色。
 *
 * 用途：
 *   Wi-Fi 連線、斷線、上傳中、初始化提示這類「系統狀態」。
 */
void setAllStrips(CRGB color) {
    for (int s = 0; s < SLOT_COUNT; s++) {
        setStrip(s, color);
    }
}

/**
 * 根據 confirmedState 更新 LED。
 *
 *   已登記箱子：對應燈條亮綠色 5 秒
 *   未登記 RFID：對應燈條紅色閃爍，直到拿走
 *   空位：熄滅
 *
 * 注意：
 *   這裡是「個別箱子狀態」，所以只改對應 slot 的燈條。
 *   Wi-Fi / API / 初始化 這種全域狀態請使用 setAllStrips()。
 */
void refreshLeds() {
    bool blinkOn = (millis() / UNKNOWN_RFID_BLINK_MS) % 2 == 0;

    for (int i = 0; i < SLOT_COUNT; i++) {
        if (isUnknownRfidState(confirmedState[i])) {
            setStrip(i, blinkOn ? CRGB::Red : CRGB::Black);
        } else if (confirmedState[i] != "EMPTY" &&
                   millis() - confirmedStateChangedAt[i] <= REGISTERED_RFID_GREEN_MS) {
            setStrip(i, CRGB::Green);
        } else {
            setStrip(i, CRGB::Black);
        }
    }
    FastLED.show();
}

/**
 * uidToBoxId() 找不到 UID_TABLE 對應時，會回傳 UID-XXXXXXXX。
 */
bool isUnknownRfidState(const String& state) {
    return state.startsWith("UID-");
}

// ============================================================================
// 18. UID 掃描模式
// ============================================================================
/**
 * UID_SCAN_MODE=1 時執行。
 *
 * 用途：
 *   將 RFID 卡片放到任一讀卡機上，Serial Monitor 會印出 UID bytes。
 *   你可以直接把輸出的格式貼進 UID_TABLE。
 */
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
// 19. Serial 狀態表
// ============================================================================
/**
 * 將目前 confirmedState 印成表格，方便你在 Serial Monitor 檢查。
 */
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
