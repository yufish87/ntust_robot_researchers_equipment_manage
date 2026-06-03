/*
  NTUST RRC IoT - Node #2 Edge RFID Inventory Synchronization Node
  Board: NodeMCU-32S / ESP32
  Function:
    - Poll 3 RC522 RFID readers on a shared SPI bus
    - Each RC522 represents one physical slot: A, B, C
    - Convert RFID UID to BOX ID
    - Detect stable slot-state changes using State Diff + Debounce
    - Send snapshot to Vercel BFF API via HTTPS POST
    - Control 3 WS2812B LED strips as local visual feedback

  Required libraries:
    - MFRC522 by GithubCommunity / miguelbalboa
    - ArduinoJson by Benoit Blanchon
    - Adafruit NeoPixel by Adafruit

  Notes:
    - RC522 must use 3.3V.
    - WS2812B should use external 5V power.
    - ESP32 GND, RC522 GND, and LED power GND must be connected together.
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>
#include <Adafruit_NeoPixel.h>

// ======================================================
// 1. USER CONFIGURATION AREA
//    Modify this section first when maintaining the system.
// ======================================================

// ---------- Wi-Fi ----------
const char* WIFI_SSID     = "yufish";
const char* WIFI_PASSWORD = "yufish666";

// ---------- API ----------
const char* API_ENDPOINT = "https://ntust-robot-researchers-equipment-m.vercel.app/api/iot/inventory/update";
const char* API_BEARER_TOKEN = "RRC_IoT_Secure_Token_2026";

// Device ID must match the CabinetLayout / backend definition.
const char* DEVICE_ID = "ESP32_C1_L1";

// ---------- Behavior ----------
const unsigned long SCAN_INTERVAL_MS      = 500;   // RFID polling interval
const unsigned long DEBOUNCE_MS           = 3000;  // state must remain stable for this long
const unsigned long WIFI_RETRY_INTERVAL_MS = 5000;
const unsigned long API_TIMEOUT_MS         = 8000;
const unsigned long ERROR_BLINK_MS         = 120;

// How many scan failures are required before declaring a slot empty.
// Prevents temporary RF reading drops from triggering immediate empty states.
const int EMPTY_CONFIRM_COUNT = 10;

// Settle time in ms after selecting an RC522 reader to stabilize SPI/RF communications.
const unsigned long READER_SETTLE_MS = 80;

// If true, unknown UID will be sent as "UNKNOWN:<uid>".
// If false, unknown UID is treated as EMPTY.
const bool REPORT_UNKNOWN_UID = true;

// ---------- Debug ----------
const bool DEBUG_LOG = true;

// ======================================================
// 2. PIN CONFIGURATION
// ======================================================

// Shared SPI pins for RC522
#define RFID_SCK   18
#define RFID_MISO  19
#define RFID_MOSI  23
#define RFID_RST   22

// Independent CS/SDA pins for each RC522
#define RFID_SS_A  21
#define RFID_SS_B  16
#define RFID_SS_C  17

// WS2812B data pins
#define LED_PIN_A  25
#define LED_PIN_B  26
#define LED_PIN_C  27

// Number of LEDs in each strip.
// Change these based on your physical LED strip length.
#define LED_COUNT_A  24
#define LED_COUNT_B  24
#define LED_COUNT_C  24

// LED brightness: 0~255.
// Keep it low for demo to reduce current draw.
#define LED_BRIGHTNESS  30

// ======================================================
// 3. SLOT / READER CONFIGURATION
// ======================================================

enum SlotIndex {
  SLOT_A = 0,
  SLOT_B = 1,
  SLOT_C = 2,
  SLOT_COUNT = 3
};

const char* SLOT_NAMES[SLOT_COUNT] = {"A", "B", "C"};

MFRC522 rfidA(RFID_SS_A, RFID_RST);
MFRC522 rfidB(RFID_SS_B, RFID_RST);
MFRC522 rfidC(RFID_SS_C, RFID_RST);

MFRC522* readers[SLOT_COUNT] = {&rfidA, &rfidB, &rfidC};

// Independent CS/SDA pin mapped array.
// Pulling non-active readers SS HIGH prevents SPI bus conflicts on start.
const int RFID_SS_PINS[SLOT_COUNT] = {RFID_SS_A, RFID_SS_B, RFID_SS_C};

Adafruit_NeoPixel ledA(LED_COUNT_A, LED_PIN_A, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel ledB(LED_COUNT_B, LED_PIN_B, NEO_GRB + NEO_KHZ800);
Adafruit_NeoPixel ledC(LED_COUNT_C, LED_PIN_C, NEO_GRB + NEO_KHZ800);

Adafruit_NeoPixel* strips[SLOT_COUNT] = {&ledA, &ledB, &ledC};

// ======================================================
// 4. UID TO BOX MAPPING
//    Step 1: Upload this code.
//    Step 2: Open Serial Monitor.
//    Step 3: Tap each RFID card.
//    Step 4: Copy UID and fill it into this table.
// ======================================================

struct UidBoxMap {
  const char* uid;
  const char* boxId;
};

// UID format in this program is uppercase hex without spaces.
// Example: "A1B2C3D4"
UidBoxMap UID_BOX_MAP[] = {
  {"23F39DA5", "BOX-001"},
  {"D3C44B00", "BOX-002"},
  {"55667788", "BOX-003"}
};

const int UID_BOX_MAP_SIZE = sizeof(UID_BOX_MAP) / sizeof(UID_BOX_MAP[0]);

// ======================================================
// 5. RUNTIME STATE
// ======================================================

// rawSlots: Stores raw readings from the latest polling scan.
// currentSlots: Stable filtered states after emptyMissCount filtering.
// stableSlots: State that has been verified and successfully posted to backend.
// pendingSlots: Candidate change state currently undergoing debouncing.
String rawSlots[SLOT_COUNT]        = {"EMPTY", "EMPTY", "EMPTY"};
String currentSlots[SLOT_COUNT]    = {"EMPTY", "EMPTY", "EMPTY"};
String stableSlots[SLOT_COUNT]     = {"EMPTY", "EMPTY", "EMPTY"};
String pendingSlots[SLOT_COUNT]    = {"EMPTY", "EMPTY", "EMPTY"};

// Miss counter for empty detection on each slot.
// Requires consecutive misses matching EMPTY_CONFIRM_COUNT to declare state as EMPTY.
int emptyMissCount[SLOT_COUNT] = {0, 0, 0};

bool pendingChange = false;
unsigned long pendingStartMs = 0;
unsigned long lastScanMs = 0;
unsigned long lastWifiRetryMs = 0;
bool simulateMode = false; // Simulation mode flag to allow manual serial testing

// ======================================================
// 6. UTILITY FUNCTIONS
// ======================================================

void logLine(const String& msg) {
  if (DEBUG_LOG) {
    Serial.println(msg);
  }
}

void logState(const char* title, String slots[SLOT_COUNT]) {
  if (!DEBUG_LOG) return;

  Serial.print(title);
  Serial.print(" | A=");
  Serial.print(slots[SLOT_A]);
  Serial.print(" B=");
  Serial.print(slots[SLOT_B]);
  Serial.print(" C=");
  Serial.println(slots[SLOT_C]);
}

bool slotsEqual(String a[SLOT_COUNT], String b[SLOT_COUNT]) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (a[i] != b[i]) return false;
  }
  return true;
}

void copySlots(String dest[SLOT_COUNT], String src[SLOT_COUNT]) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    dest[i] = src[i];
  }
}

String uidToString(MFRC522::Uid *uid) {
  String result = "";
  for (byte i = 0; i < uid->size; i++) {
    if (uid->uidByte[i] < 0x10) result += "0";
    result += String(uid->uidByte[i], HEX);
  }
  result.toUpperCase();
  return result;
}

String mapUidToBoxId(const String& uid) {
  for (int i = 0; i < UID_BOX_MAP_SIZE; i++) {
    if (uid == UID_BOX_MAP[i].uid) {
      return String(UID_BOX_MAP[i].boxId);
    }
  }

  if (REPORT_UNKNOWN_UID) {
    return "UNKNOWN:" + uid;
  }

  return "EMPTY";
}

// ======================================================
// 7. LED FEEDBACK
// ======================================================

void setStripColor(int slot, uint8_t r, uint8_t g, uint8_t b) {
  Adafruit_NeoPixel* strip = strips[slot];
  for (uint16_t i = 0; i < strip->numPixels(); i++) {
    strip->setPixelColor(i, strip->Color(r, g, b));
  }
  strip->show();
}

void clearAllLeds() {
  for (int s = 0; s < SLOT_COUNT; s++) {
    setStripColor(s, 0, 0, 0);
  }
}

void showSlotOccupied(int slot) {
  // Green: known box is present
  setStripColor(slot, 0, 80, 0);
}

void showSlotEmpty(int slot) {
  // Off: empty
  setStripColor(slot, 0, 0, 0);
}

void showSlotUnknown(int slot) {
  // Yellow: card detected but UID is not registered
  setStripColor(slot, 80, 50, 0);
}

void showUploading() {
  // Blue pulse-like static indicator while posting
  for (int s = 0; s < SLOT_COUNT; s++) {
    setStripColor(s, 0, 0, 60);
  }
}

void showUploadSuccess() {
  // Short green confirmation
  for (int s = 0; s < SLOT_COUNT; s++) {
    setStripColor(s, 0, 80, 0);
  }
  delay(200);
}

void showErrorBlink() {
  for (int k = 0; k < 3; k++) {
    for (int s = 0; s < SLOT_COUNT; s++) setStripColor(s, 80, 0, 0);
    delay(ERROR_BLINK_MS);
    clearAllLeds();
    delay(ERROR_BLINK_MS);
  }
}

void updateLedByStableSlots() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    if (stableSlots[i] == "EMPTY") {
      showSlotEmpty(i);
    } else if (stableSlots[i].startsWith("UNKNOWN:")) {
      showSlotUnknown(i);
    } else {
      showSlotOccupied(i);
    }
  }
}

// ======================================================
// 8. WIFI
// ======================================================

void connectWiFi() {
  if (WiFi.status() == WL_CONNECTED) return;

  unsigned long now = millis();
  if (now - lastWifiRetryMs < WIFI_RETRY_INTERVAL_MS) return;
  lastWifiRetryMs = now;

  logLine("[WiFi] Connecting...");
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 8000) {
    delay(300);
    if (DEBUG_LOG) Serial.print(".");
  }
  if (DEBUG_LOG) Serial.println();

  if (WiFi.status() == WL_CONNECTED) {
    logLine("[WiFi] Connected. IP: " + WiFi.localIP().toString());
  } else {
    logLine("[WiFi] Connection failed.");
  }
}

// Select a single RFID reader by pulling its CS line LOW, disabling others.
// Prevents cross-talk and bus contention on SPI lines.
void selectReader(int index) {
  for (int i = 0; i < SLOT_COUNT; i++) {
    digitalWrite(RFID_SS_PINS[i], HIGH);
  }
  delayMicroseconds(50);
  digitalWrite(RFID_SS_PINS[index], LOW);
  delayMicroseconds(50);
}

// Deselect all reader nodes.
void deselectAllReaders() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    digitalWrite(RFID_SS_PINS[i], HIGH);
  }
}

// ======================================================
// 9. RFID READING
// ======================================================

// Read raw box status from a single RC522 reader.
// Selects the reader via selectReader, turns on antenna, checks for new card, 
// and maps the UID to a Box ID if present.
String readSingleReader(int index) {
  MFRC522* reader = readers[index];

  selectReader(index);

  // Re-enable RF field to query card.
  reader->PCD_AntennaOn();

  // Look for new card.
  bool detected = reader->PICC_IsNewCardPresent();

  if (!detected) {
    byte bufferATQA[2];
    byte bufferSize = sizeof(bufferATQA);
    MFRC522::StatusCode status = reader->PICC_WakeupA(bufferATQA, &bufferSize);
    detected = (status == MFRC522::STATUS_OK);
  }

  if (!detected) {
    deselectAllReaders();
    return "EMPTY";
  }

  // Read card serial.
  if (!reader->PICC_ReadCardSerial()) {
    deselectAllReaders();
    return "EMPTY";
  }

  String uid = uidToString(&(reader->uid));
  String boxId = mapUidToBoxId(uid);

  reader->PICC_HaltA();
  reader->PCD_StopCrypto1();

  deselectAllReaders();
  return boxId;
}

// Poll slots A, B, and C sequentially.
// rawSlots stores raw hardware outputs, currentSlots filters hardware noise.
void scanAllSlots() {
  if (simulateMode) {
    // In simulation mode, skip hardware reading to preserve serial manual inputs
    return;
  }
  for (int i = 0; i < SLOT_COUNT; i++) {
    rawSlots[i] = readSingleReader(i);

    if (rawSlots[i] != "EMPTY") {
      currentSlots[i] = rawSlots[i];
      emptyMissCount[i] = 0;
    } else {
      if (currentSlots[i] != "EMPTY") {
        emptyMissCount[i]++;

        // Log miss events for debugging RF fluctuations.
        if (DEBUG_LOG) {
          Serial.print("[Miss] ");
          Serial.print(SLOT_NAMES[i]);
          Serial.print(" miss ");
          Serial.print(emptyMissCount[i]);
          Serial.print("/");
          Serial.println(EMPTY_CONFIRM_COUNT);
        }

        if (emptyMissCount[i] >= EMPTY_CONFIRM_COUNT) {
          currentSlots[i] = "EMPTY";
          emptyMissCount[i] = 0;
        }
      } else {
        currentSlots[i] = "EMPTY";
        emptyMissCount[i] = 0;
      }
    }

    delay(READER_SETTLE_MS);
  }
}

// ======================================================
// 10. JSON / API
// ======================================================

String buildSnapshotJson(String slots[SLOT_COUNT]) {
  StaticJsonDocument<512> doc;
  doc["device_id"] = DEVICE_ID;

  JsonObject slotsObj = doc.createNestedObject("slots");
  for (int i = 0; i < SLOT_COUNT; i++) {
    slotsObj[SLOT_NAMES[i]] = slots[i];
  }

  String output;
  serializeJson(doc, output);
  return output;
}

bool postSnapshot(String slots[SLOT_COUNT]) {
  if (WiFi.status() != WL_CONNECTED) {
    logLine("[API] WiFi not connected. Skip POST.");
    return false;
  }

  String json = buildSnapshotJson(slots);
  logLine("[API] POST payload:");
  logLine(json);

  WiFiClientSecure client;
  client.setInsecure(); 

  HTTPClient http;
  http.setTimeout(API_TIMEOUT_MS);

  if (!http.begin(client, API_ENDPOINT)) {
    logLine("[API] http.begin failed.");
    return false;
  }

  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", String("Bearer ") + API_BEARER_TOKEN);

  int statusCode = http.POST(json);
  String response = http.getString();

  logLine("[API] HTTP status: " + String(statusCode));
  logLine("[API] Response: " + response);

  http.end();

  return statusCode >= 200 && statusCode < 300;
}

// ======================================================
// 10-1. MANUAL DEBUG COMMANDS
// ======================================================
// Input control bytes to Serial Monitor for testing:
//   j: Dump current filtered slots as JSON.
//   p: Force post current slots to trigger state diff sync.
//   r: Clear stableSlots to empty for test triggering.
//   s: Toggle simulation mode (pauses hardware scan).
//   [A/B/C][0/1/2/3]: Set simulated slot value (e.g. A1, B0) when simulation is enabled.
void handleSerialCommands() {
  if (!Serial.available()) return;

  char cmd = Serial.read();

  // Toggle simulation mode
  if (cmd == 's' || cmd == 'S') {
    simulateMode = !simulateMode;
    Serial.print("[Manual] Simulation Mode: ");
    Serial.println(simulateMode ? "ENABLED (Hardware reading paused)" : "DISABLED (Hardware reading resumed)");
    return;
  }

  // Set slot value in simulation mode
  if (simulateMode && (cmd == 'a' || cmd == 'A' || cmd == 'b' || cmd == 'B' || cmd == 'c' || cmd == 'C')) {
    unsigned long start = millis();
    while (!Serial.available() && millis() - start < 1000) {
      delay(10);
    }
    if (Serial.available()) {
      char val = Serial.read();
      int slot = (cmd == 'a' || cmd == 'A') ? SLOT_A : ((cmd == 'b' || cmd == 'B') ? SLOT_B : SLOT_C);
      String newBox = "EMPTY";
      if (val == '1') newBox = "BOX-001";
      else if (val == '2') newBox = "BOX-002";
      else if (val == '3') newBox = "BOX-003";

      currentSlots[slot] = newBox;
      rawSlots[slot] = newBox;
      Serial.printf("[Manual] Simulated Slot %s -> %s\n", SLOT_NAMES[slot], newBox.c_str());
    }
    return;
  }

  if (cmd == 'j' || cmd == 'J') {
    logLine("[Manual] Current Filtered JSON:");
    logLine(buildSnapshotJson(currentSlots));
  }

  if (cmd == 'p' || cmd == 'P') {
    logLine("[Manual] Force POST current Filtered slots.");
    bool ok = postSnapshot(currentSlots);

    if (ok) {
      logLine("[Manual] Force POST success. Copy currentSlots to stableSlots.");
      copySlots(stableSlots, currentSlots);
      updateLedByStableSlots();
    } else {
      logLine("[Manual] Force POST failed.");
      showErrorBlink();
      updateLedByStableSlots();
    }
  }

  if (cmd == 'r' || cmd == 'R') {
    logLine("[Manual] Reset stableSlots to EMPTY.");
    for (int i = 0; i < SLOT_COUNT; i++) {
      stableSlots[i] = "EMPTY";
      pendingSlots[i] = "EMPTY";
    }
    pendingChange = false;
    logState("[Manual] stableSlots", stableSlots);
    updateLedByStableSlots();
  }
}

// ======================================================
// 11. STATE DIFF + DEBOUNCE
// ======================================================

void handleStateMachine() {
  if (slotsEqual(currentSlots, stableSlots)) {
    pendingChange = false;
    return;
  }

  if (!pendingChange) {
    pendingChange = true;
    pendingStartMs = millis();
    copySlots(pendingSlots, currentSlots);

    logState("[State] Candidate change detected", pendingSlots);
    return;
  }

  if (!slotsEqual(currentSlots, pendingSlots)) {
    pendingStartMs = millis();
    copySlots(pendingSlots, currentSlots);

    logState("[State] Candidate changed, debounce restarted", pendingSlots);
    return;
  }

  // Candidate state is debouncing. Print elapsed time.
  if (DEBUG_LOG) {
    Serial.print("[State] Debouncing ");
    Serial.print(millis() - pendingStartMs);
    Serial.print("/");
    Serial.println(DEBOUNCE_MS);
  }

  if (millis() - pendingStartMs >= DEBOUNCE_MS) {
    logState("[State] Stable change confirmed", pendingSlots);

    showUploading();

    bool ok = postSnapshot(pendingSlots);
    if (ok) {
      copySlots(stableSlots, pendingSlots);
      showUploadSuccess();
      updateLedByStableSlots();
      logState("[State] Stable state updated", stableSlots);
    } else {
      showErrorBlink();
      updateLedByStableSlots();
      logLine("[State] POST failed. Stable state not updated. Will retry if state remains changed.");
    }

    pendingChange = false;
  }
}

// ======================================================
// 12. SETUP / LOOP
// ======================================================

void setupReaders() {
  // Configure CS/SS pins as OUTPUT and set HIGH to disable all readers initially.
  // Only the actively selected reader should have its CS line pulled LOW.
  pinMode(RFID_SS_A, OUTPUT);
  pinMode(RFID_SS_B, OUTPUT);
  pinMode(RFID_SS_C, OUTPUT);
  digitalWrite(RFID_SS_A, HIGH);
  digitalWrite(RFID_SS_B, HIGH);
  digitalWrite(RFID_SS_C, HIGH);

  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, -1);

  for (int i = 0; i < SLOT_COUNT; i++) {
    readers[i]->PCD_Init();
    delay(120);
  }

  logLine("[RFID] All RC522 readers initialized.");

  if (DEBUG_LOG) {
    for (int i = 0; i < SLOT_COUNT; i++) {
      Serial.print("[RFID] Reader ");
      Serial.print(SLOT_NAMES[i]);
      Serial.print(" version: 0x");
      Serial.println(readers[i]->PCD_ReadRegister(MFRC522::VersionReg), HEX);
    }
  }
}

void setupLeds() {
  for (int i = 0; i < SLOT_COUNT; i++) {
    strips[i]->begin();
    strips[i]->setBrightness(LED_BRIGHTNESS);
    strips[i]->show();
  }

  clearAllLeds();
  logLine("[LED] LED strips initialized.");
}

void setup() {
  Serial.begin(115200);
  delay(1000);

  logLine("");
  logLine("==========================================");
  logLine("NTUST RRC IoT Node #2 - RFID Inventory Node");
  logLine("==========================================");

  setupLeds();
  setupReaders();

  connectWiFi();

  // Initial scan and sync baseline.
  scanAllSlots();
  copySlots(stableSlots, currentSlots);
  logState("[Init] Initial stable state", stableSlots);
  updateLedByStableSlots();
}

void loop() {
  connectWiFi();
  handleSerialCommands();

  unsigned long now = millis();
  if (now - lastScanMs >= SCAN_INTERVAL_MS) {
    lastScanMs = now;

    scanAllSlots();

    // Read raw states, apply empty filter, and then print states.
    logState("[Raw Scan]", rawSlots);
    logState("[Filtered]", currentSlots);

    handleStateMachine();
  }
}
