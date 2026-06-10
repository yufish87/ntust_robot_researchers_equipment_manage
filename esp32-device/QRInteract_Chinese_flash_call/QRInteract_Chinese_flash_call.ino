#include <Arduino.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <TFT_eSPI.h>
#include <U8g2_for_TFT_eSPI.h> // Include U8g2 Wrapper for TFT_eSPI
#include "esp_camera.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"
#include "esp_heap_caps.h"
#include "quirc.h"
#include <vector>

// State Machine Definitions
enum State {
  STATE_STANDBY,
  STATE_PREVIEW,
  STATE_FETCHING,
  STATE_WAIT_CONFIRM,
  STATE_CONFIRMING,
  STATE_SUCCESS,
  STATE_ERROR
};

State currentState = STATE_STANDBY;
State lastState = (State)-1; // Used for Serial debug output
unsigned long stateTimer = 0;
unsigned long countdownTimer = 0;
unsigned long lastCarouselTimer = 0; // Carousel timer for scrolling items
int remainingSeconds = 180; // 3-minute timeout for equipment pickup
int lastPageIndex = -1; // Keep track of last page to avoid unnecessary screen flashing

// Hardware Pin Definitions
#define BUTTON_PIN 16

// WiFi Credentials
const char* ssid = "";
const char* password = "";

// BFF API Endpoints
const char* bffScanUrl = "";
const char* bffConfirmUrl = "";
const char* bffLedUrl = "";
const char* iotBearerToken = ""; // Replace with actual token

// Display and Camera Global Instances
TFT_eSPI tft = TFT_eSPI();
U8g2_for_TFT_eSPI u8f; // U8g2 wrapper instance
static struct quirc *q = NULL;

// Camera Pin Config (NodeMCU32S_CAM / AI-Thinker)
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27
#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Camera and Quirc initialization helpers
static bool camera_init();
static bool quirc_init_global();

// Data Structures
struct BorrowedItem {
  String name;
  int qty;
  String code;
  String allocatedIds;
};

String scannedReqId = "";
String applicantName = ""; // å­¸è?? (student ID)
std::vector<BorrowedItem> borrowedItems;
bool isScanning = false;

// Active Buzzer Control (Disabled)
void playBeep(int count, int durationMs, int delayMs) {
  // Buzzer disabled
}

// U8g2 UTF-8 String Drawing Wrapper with offset compensation using drawUTF8
void drawStr(String str, int x, int y, int size = 12) {
  if (size == 15) {
    u8f.setFont(u8g2_font_wqy15_t_chinese1);
    u8f.drawUTF8(x, y + 13, str.c_str());
  } else {
    u8f.setFont(u8g2_font_wqy12_t_chinese1);
    u8f.drawUTF8(x, y + 12, str.c_str());
  }
}

// Render Standby Screen (Pure Black & White, Optimized for 160x128)
void drawStandbyScreen() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("??°ç??å¤§æ????¨äºº???ç©¶ç¤¾", 20, 15, 15);
  drawStr("ç³»çµ±çµ?ç«¯æ??", 40, 40);
  
  tft.drawFastHLine(10, 60, 140, TFT_WHITE);
  
  drawStr("è«?????????????å§?...", 25, 85);
}

// Render Scanning Screen with static guide frame (Optimized for 160x128)
void drawScanningScreen() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("æ­???¨æ????? QR ç¢?", 20, 10);
  drawStr("è«?å°? QR ç¢¼å??æº?ä¸­å¤®", 8, 25);
  
  // 70x70 guiding box in center
  tft.drawRect(45, 42, 70, 70, TFT_WHITE);
  drawStr("è·???? 15-25 ??¬å??", 25, 116);
}

// Render Fetching Screen
void drawFetchingScreen() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("è®???????ç´°ä¸­", 40, 40);
  drawStr("æ­???¨é??ç·???³ä¼º??????...", 8, 70);
}

// Render Transaction Confirming Screen
void drawConfirmingScreen() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("ç¢ºè???????¨ä¸­", 40, 40);
  drawStr("æ­???¨æ?´æ?°å?²ç?©æ????????...", 8, 70);
}

// Render Success Screen
void drawSuccessScreen() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("?????¨æ?????", 50, 30, 15);
  drawStr("?????¨ç?³è??å·²ç¢ºèª?ï¼?", 20, 65);
  drawStr("è«????èµ°æ????§å?¨æ??", 26, 85);
}

// Render Error Screen
void drawErrorScreen(String message) {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  
  drawStr("??¼ç????¯èª¤ï¼?", 45, 20, 15);
  
  tft.drawFastHLine(10, 50, 140, TFT_WHITE);
  
  // Truncate long error messages to fit 160px width
  String shortMsg = message;
  if (message.length() > 24) {
    shortMsg = message.substring(0, 24) + "..";
  }
  drawStr(shortMsg, 20, 65);
  drawStr("3ç§?å¾?è¿????å¾?æ©?...", 15, 95);
}

// Measure actual pixel width using U8g2 font metrics (accurate)
int strPixelWidth(const String& s) {
  u8f.setFont(u8g2_font_wqy12_t_chinese1);
  return (int)u8f.getUTF8Width(s.c_str());
}

// Returns byte count of the longest prefix of s that fits within maxPixels
int fitPixels(const String& s, int maxPixels) {
  u8f.setFont(u8g2_font_wqy12_t_chinese1);
  int i = 0;
  while (i < (int)s.length()) {
    uint8_t c = (uint8_t)s[i];
    int cl = (c < 0x80) ? 1 : ((c & 0xF0) == 0xE0) ? 3 : 2;
    if ((int)u8f.getUTF8Width(s.substring(0, i + cl).c_str()) > maxPixels) break;
    i += cl;
  }
  return i;
}

// Render Borrowing Details Static Background & Header
void drawBorrowDetailsStatic() {
  tft.fillScreen(TFT_BLACK);
  tft.setTextColor(TFT_WHITE);

  // Navigation Bar
  tft.drawFastHLine(0, 18, 160, TFT_WHITE);
  drawStr(scannedReqId, 0, 4);

  // Applicant info
  drawStr("å­¸è??: " + applicantName, 8, 24);
  tft.drawFastHLine(8, 36, 144, TFT_WHITE);

  // Equipment List Header
  drawStr("?????¨å?¨æ??:", 8, 43);

  // Bottom separator
  tft.drawFastHLine(8, 109, 144, TFT_WHITE);
}

// Render Borrowing Details Items Area & Page Number
void drawBorrowDetailsItemsArea(int pageIndex, int totalPages, int startIdx, int endIdx, const int lineCount[]) {
  // Clear items area (y=60 to 108)
  tft.fillRect(0, 60, 160, 49, TFT_BLACK);
  
  // Clear page number area (x=120 to 160, y=0 to 17)
  tft.fillRect(130, 0, 40, 17, TFT_BLACK);

  tft.setTextColor(TFT_WHITE);
  if (totalPages > 1) {
    drawStr(String(pageIndex + 1) + "/" + String(totalPages), 130, 4);
  }

  int yOffset = 65;
  const int maxW     = 136;
  const int lineH    = 15;
  const int itemGap  = 3;

  for (int i = startIdx; i < endIdx; i++) {
    const auto& item = borrowedItems[i];
    String suffix = " x" + String(item.qty);
    String line1  = "- " + item.name + suffix;
    int lc        = lineCount[i];

    if (lc == 1) {
      drawStr(line1, 12, yOffset);
      yOffset += lineH + itemGap;
    } else if (lc == 2) {
      String nameLine = "- " + item.name;
      if (strPixelWidth(nameLine) <= maxW) {
        drawStr(nameLine, 12, yOffset);
        drawStr("  x" + String(item.qty), 12, yOffset + lineH);
      } else {
        int split   = fitPixels(item.name, maxW - 12);
        drawStr("- " + item.name.substring(0, split), 12, yOffset);
        String rest = item.name.substring(split) + suffix;
        int rFit    = fitPixels(rest, maxW - 12);
        drawStr("  " + rest.substring(0, rFit), 12, yOffset + lineH);
      }
      yOffset += lineH * 2 + itemGap;
    } else {
      // lc == 3: split name across 3 lines
      int split1  = fitPixels(item.name, maxW - 12);
      drawStr("- " + item.name.substring(0, split1), 12, yOffset);
      String rest1 = item.name.substring(split1) + suffix;
      int split2   = fitPixels(rest1, maxW - 12);
      drawStr("  " + rest1.substring(0, split2), 12, yOffset + lineH);
      String rest2 = rest1.substring(split2);
      int rFit3    = fitPixels(rest2, maxW - 12);
      drawStr("  " + rest2.substring(0, rFit3), 12, yOffset + lineH * 2);
      yOffset += lineH * 3 + itemGap;
    }
  }
}

// Render Countdown & Progress Bar Area
void drawCountdownArea() {
  // Clear countdown text area (y=110 to 121)
  tft.fillRect(8, 110, 144, 12, TFT_BLACK);
  tft.setTextColor(TFT_WHITE);
  drawStr("ç¢ºè????©é????????: " + String(remainingSeconds) + "s", 8, 112);

  // Clear progress bar area (y=123 to 127)
  tft.fillRect(8, 123, 144, 5, TFT_BLACK);
  int barWidth = (remainingSeconds * 144) / 180;
  if (barWidth < 0) barWidth = 0;
  if (barWidth > 144) barWidth = 144;
  tft.drawRect(8, 123, 144, 4, TFT_WHITE);
  tft.fillRect(8, 123, barWidth, 4, TFT_WHITE);
}

// Parse JSON Payload from BFF
bool parseBffScanResponse(String jsonStr) {
  DynamicJsonDocument doc(4096);
  DeserializationError error = deserializeJson(doc, jsonStr);
  if (error) {
    Serial.println("JSON parse failed");
    return false;
  }
  
  bool success = doc["success"] | false;
  if (!success) {
    return false;
  }
  
  applicantName = doc["data"]["applicantId"].as<String>(); // å­¸è??
  scannedReqId = doc["data"]["reqId"].as<String>();
  
  JsonArray itemsArr = doc["data"]["itemsDetail"].as<JsonArray>();
  
  borrowedItems.clear();
  for (JsonObject item : itemsArr) {
    BorrowedItem bItem;
    bItem.code = item["code"].as<String>();
    bItem.name = item["name"].as<String>();
    bItem.qty = item["qty"].as<int>();
    bItem.allocatedIds = "";
    borrowedItems.push_back(bItem);
  }
  return true;
}

// Send HTTPS POST to BFF Scan API
String sendScanRequest(String reqId) {
  if (WiFi.status() != WL_CONNECTED) {
    return "{\"success\":false,\"message\":\"WiFi disconnected\"}";
  }
  
  WiFiClientSecure client;
  client.setInsecure(); // Skip Vercel SSL validation for dev phase
  
  HTTPClient http;
  http.begin(client, bffScanUrl);
  http.setTimeout(30000); // 30 seconds timeout for GAS response
  http.addHeader("Content-Type", "application/json");
  
  String tokenHeader = "Bearer " + String(iotBearerToken);
  http.addHeader("Authorization", tokenHeader.c_str());
  
  DynamicJsonDocument doc(128);
  doc["reqId"] = reqId;
  String requestBody;
  serializeJson(doc, requestBody);
  
  Serial.println("--> Sending scan request to BFF...");
  int httpResponseCode = http.POST(requestBody);
  String response = "{\"success\":false,\"message\":\"HTTP error\"}";
  
  if (httpResponseCode > 0) {
    response = http.getString();
    Serial.println("Scan Response JSON:");
    Serial.println(response);
  } else {
    Serial.printf("HTTP Client Error: %s\n", http.errorToString(httpResponseCode).c_str());
  }
  
  http.end();
  return response;
}

// Send HTTPS POST to BFF Confirm API
bool sendConfirmRequest(String reqId) {
  if (WiFi.status() != WL_CONNECTED) {
    return false;
  }
  
  WiFiClientSecure client;
  client.setInsecure();
  
  HTTPClient http;
  http.begin(client, bffConfirmUrl);
  http.setTimeout(30000); // 30 seconds timeout for GAS write transactions
  http.addHeader("Content-Type", "application/json");
  
  String tokenHeader = "Bearer " + String(iotBearerToken);
  http.addHeader("Authorization", tokenHeader.c_str());
  
  DynamicJsonDocument doc(128);
  doc["reqId"] = reqId;
  String requestBody;
  serializeJson(doc, requestBody);
  
  Serial.println("--> Sending confirm request to BFF...");
  int httpResponseCode = http.POST(requestBody);
  bool success = false;
  
  if (httpResponseCode == 200) {
    String response = http.getString();
    Serial.println("Confirm Response JSON:");
    Serial.println(response);
    DynamicJsonDocument respDoc(512);
    deserializeJson(respDoc, response);
    success = respDoc["success"] | false;
  } else {
    Serial.printf("HTTP Client Error: %d\n", httpResponseCode);
    if (httpResponseCode > 0) {
      Serial.println(http.getString());
    }
  }
  
  http.end();
  return success;
}

/**
 * ??¼å?? /api/iot/ledï¼?äº®ç???????????
 * action: "on" ??? "off"
 * durationMs: äº®ç?????çº???????ï¼?æ¯«ç??ï¼?ï¼?????????? 0
 */
void callLedApi(const char* action, int durationMs) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[LED API] Wi-Fi disconnected, skip.");
    return;
  }

  // çµ???? items JSON ??????ï¼?å¾? borrowedItems ?????? codeï¼?
  String itemsJson = "[";
  for (int i = 0; i < (int)borrowedItems.size(); i++) {
    if (i > 0) itemsJson += ",";
    itemsJson += "{\"code\":\"" + borrowedItems[i].code + "\",\"name\":\"" + borrowedItems[i].name + "\"}";
  }
  itemsJson += "]";

  String body = "{\"items\":" + itemsJson +
                ",\"duration\":" + String(durationMs) +
                ",\"action\":\"" + String(action) + "\"}";

  WiFiClientSecure client;
  client.setInsecure();

  HTTPClient http;
  http.begin(client, bffLedUrl);
  http.setTimeout(15000);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + String(iotBearerToken));

  Serial.printf("[LED API] %s duration=%dms\n", action, durationMs);
  int code = http.POST(body);
  if (code > 0) {
    Serial.printf("[LED API] Response %d: %s\n", code, http.getString().c_str());
  } else {
    Serial.printf("[LED API] Error: %s\n", http.errorToString(code).c_str());
  }
  http.end();
}

// ===== Camera init =====
static bool camera_init() {
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer   = LEDC_TIMER_0;
  config.pin_d0       = Y2_GPIO_NUM;
  config.pin_d1       = Y3_GPIO_NUM;
  config.pin_d2       = Y4_GPIO_NUM;
  config.pin_d3       = Y5_GPIO_NUM;
  config.pin_d4       = Y6_GPIO_NUM;
  config.pin_d5       = Y7_GPIO_NUM;
  config.pin_d6       = Y8_GPIO_NUM;
  config.pin_d7       = Y9_GPIO_NUM;
  config.pin_xclk     = XCLK_GPIO_NUM;
  config.pin_pclk     = PCLK_GPIO_NUM;
  config.pin_vsync    = VSYNC_GPIO_NUM;
  config.pin_href     = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn     = PWDN_GPIO_NUM;
  config.pin_reset    = RESET_GPIO_NUM;

  // GRAYSCALE: 1 byte/pixel directly, bypassing all JPEG decoding overhead
  config.xclk_freq_hz = 10000000;
  config.pixel_format = PIXFORMAT_GRAYSCALE;
  config.jpeg_quality = 10;
  config.fb_count     = 1;
  config.grab_mode    = CAMERA_GRAB_WHEN_EMPTY;

  if (psramFound()) {
    config.frame_size   = FRAMESIZE_QVGA;   // 320x240
    config.fb_location  = CAMERA_FB_IN_PSRAM;
  } else {
    config.frame_size   = FRAMESIZE_QQVGA;  // 160x120
    config.fb_location  = CAMERA_FB_IN_DRAM;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed: 0x%x\n", err);
    return false;
  }

  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    s->set_contrast(s, 2);
    s->set_sharpness(s, 2);
    s->set_brightness(s, 0);
    s->set_saturation(s, -2);
    s->set_exposure_ctrl(s, 1);
    s->set_aec2(s, 1);
    s->set_ae_level(s, 0);
    s->set_whitebal(s, 1);
    s->set_awb_gain(s, 1);
    s->set_gainceiling(s, GAINCEILING_2X);
  }

  return true;
}

// ===== Quirc init =====
static bool quirc_init_global() {
  q = quirc_new();
  if (!q) {
    Serial.println("quirc_new() failed");
    return false;
  }
  int w = psramFound() ? 320 : 160;
  int h = psramFound() ? 240 : 120;
  if (quirc_resize(q, w, h) < 0) {
    Serial.println("quirc_resize() failed");
    quirc_destroy(q);
    q = NULL;
    return false;
  }
  Serial.printf("quirc ready: %dx%d\n", w, h);
  return true;
}

// FreeRTOS Task for QR Decoding on Core 1
void onQrCodeTask(void *pvParameters) {
  Serial.printf("QR scan task started on core %d\n", xPortGetCoreID());
  while (true) {
    if (currentState == STATE_PREVIEW && isScanning) {
      if (!q) { vTaskDelay(pdMS_TO_TICKS(100)); continue; }

      camera_fb_t *fb = esp_camera_fb_get();
      if (!fb) {
        Serial.println("fb_get failed");
        vTaskDelay(pdMS_TO_TICKS(50));
        continue;
      }

      int qw = 0, qh = 0;
      uint8_t *image = quirc_begin(q, &qw, &qh);
      if (!image || qw == 0 || qh == 0) {
        esp_camera_fb_return(fb);
        vTaskDelay(pdMS_TO_TICKS(50));
        continue;
      }

      int pixels = qw * qh;
      memcpy(image, fb->buf, pixels);

      uint8_t lo = 255, hi = 0;
      for (int i = 0; i < pixels; i++) {
        if (image[i] < lo) lo = image[i];
        if (image[i] > hi) hi = image[i];
      }
      if (hi > lo + 10) {
        int range = hi - lo;
        for (int i = 0; i < pixels; i++) {
          int v = ((int)(image[i] - lo) * 255) / range;
          image[i] = (uint8_t)(v < 0 ? 0 : (v > 255 ? 255 : v));
        }
      }

      esp_camera_fb_return(fb);
      fb = NULL;

      quirc_end(q);

      int count = quirc_count(q);
      if (count > 0) {
        struct quirc_code code;
        struct quirc_data data;

        quirc_extract(q, 0, &code);
        quirc_decode_error_t err = quirc_decode(&code, &data);

        if (err == QUIRC_SUCCESS) {
          scannedReqId = String((const char *)data.payload);
          Serial.println("=== QR Decoded ===");
          Serial.printf("Version : %d\n", data.version);
          Serial.printf("ECC     : %c\n", "MLHQ"[data.ecc_level]);
          Serial.printf("Length  : %d\n", data.payload_len);
          Serial.printf("Payload : %s\n", scannedReqId.c_str());
          Serial.println("==================");

          isScanning = false;
          playBeep(1, 100, 0);
        }
      }
    }
    vTaskDelay(pdMS_TO_TICKS(100));
  }
}

void setup() {
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);  // disable brownout
  Serial.begin(115200);
  Serial.println("Starting Node 3 visual terminal...");
  
  pinMode(BUTTON_PIN, INPUT_PULLUP);
  
  // Initialize TFT Display
  tft.init();
  tft.setRotation(1); // Landscape mode
  tft.fillScreen(TFT_BLACK);

  // Initialize U8g2 For TFT_eSPI (Chinese fonts support)
  u8f.begin(tft);
  u8f.setFontMode(0); // Non-transparent mode (solid background) to avoid overlapping
  u8f.setFontDirection(0);
  u8f.setForegroundColor(TFT_WHITE);
  u8f.setBackgroundColor(TFT_BLACK);
  u8f.setFont(u8g2_font_wqy12_t_chinese1); // default 12px font
  
  // Initialize Camera
  if (!camera_init()) {
    Serial.println("Camera init failed, halt.");
    while (1) delay(1000);
  }
  Serial.println("Camera ready.");

  // Initialize Quirc
  if (!quirc_init_global()) {
    Serial.println("Quirc init failed, halt.");
    while (1) delay(1000);
  }
  
  xTaskCreatePinnedToCore(onQrCodeTask, "onQrCodeTask", 20000, NULL, 4, NULL, 1);
  
  // WiFi Connection Setup
  drawStr("æ­???¨é??ç·???³ç¶²è·?...", 10, 10);
  
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected.");
  drawStr("ç¶²è·¯???ç·???????ï¼?", 10, 25);
  
  delay(1000);
  drawStandbyScreen();
  currentState = STATE_STANDBY;
}

void loop() {
  if (currentState != lastState) {
    Serial.print("[State Change] ");
    switch (currentState) {
      case STATE_STANDBY:      Serial.println("STATE_STANDBY"); break;
      case STATE_PREVIEW:      Serial.println("STATE_PREVIEW (Scanning...)"); break;
      case STATE_FETCHING:     Serial.println("STATE_FETCHING (Requesting BFF Scan API...)"); break;
      case STATE_WAIT_CONFIRM: Serial.println("STATE_WAIT_CONFIRM (Waiting for user confirmation...)"); break;
      case STATE_CONFIRMING:   Serial.println("STATE_CONFIRMING (Sending BFF Confirm API...)"); break;
      case STATE_SUCCESS:      Serial.println("STATE_SUCCESS"); break;
      case STATE_ERROR:        Serial.println("STATE_ERROR"); break;
    }
    lastState = currentState;
  }

  // Simple button debounce
  bool buttonPressed = (digitalRead(BUTTON_PIN) == LOW);
  if (buttonPressed) {
    delay(50);
    buttonPressed = (digitalRead(BUTTON_PIN) == LOW);
    if (buttonPressed) {
      Serial.println("[Button] Pressed!");
    }
  }
  
  switch (currentState) {
    case STATE_STANDBY:
      if (buttonPressed) {
        currentState = STATE_PREVIEW;
        isScanning = true;
        stateTimer = millis();
        drawScanningScreen();
        playBeep(1, 80, 0);
        delay(300); // Debounce delay
      }
      break;
      
    case STATE_PREVIEW:
      if (!isScanning && scannedReqId != "") {
        currentState = STATE_FETCHING;
        drawFetchingScreen();
      }
      else if (millis() - stateTimer > 15000) {
        isScanning = false;
        currentState = STATE_STANDBY;
        drawStandbyScreen();
        playBeep(2, 50, 50);
      }
      break;
      
    case STATE_FETCHING: {
      String jsonResponse = sendScanRequest(scannedReqId);
      if (parseBffScanResponse(jsonResponse)) {
        currentState = STATE_WAIT_CONFIRM;
        remainingSeconds = 180;
        countdownTimer = millis();
        lastCarouselTimer = millis(); // Initialize carousel timer
        
        // Initial drawing of static and dynamic areas
        drawBorrowDetailsStatic();
        lastPageIndex = -1; // Force drawBorrowDetailsItemsArea to run on first loop
        drawCountdownArea();
        
        // äº®ç??ï¼?ä¾??????¨å?¨æ??é»?äº®å?????ç®±å??ä½?ç½®ï?????çº? remainingSeconds
        callLedApi("on", remainingSeconds * 1000);
        
        playBeep(1, 150, 0);
      } else {
        DynamicJsonDocument errDoc(512);
        deserializeJson(errDoc, jsonResponse);
        String errMsg = errDoc["message"].as<String>();
        if (errMsg == "") errMsg = "Application not found or unauthorized";
        
        currentState = STATE_ERROR;
        drawErrorScreen(errMsg);
        playBeep(1, 1500, 0);
        stateTimer = millis();
      }
      break;
    }
      
    case STATE_WAIT_CONFIRM: {
      // Countdown handler (1 second intervals) - updates only the countdown area
      if (millis() - countdownTimer >= 1000) {
        remainingSeconds--;
        countdownTimer = millis();
        drawCountdownArea();
      }
      
      // Calculate layout dynamically
      const int maxW     = 136;
      const int lineH    = 15;
      const int itemGap  = 3;
      const int maxLines = 3;
      int nItems = (int)borrowedItems.size();
      const int MAX_ITEMS = 30;

      int lineCount[MAX_ITEMS];
      for (int i = 0; i < nItems && i < MAX_ITEMS; i++) {
        const auto& item = borrowedItems[i];
        String suffix = " x" + String(item.qty);
        String full   = "- " + item.name + suffix;
        if (strPixelWidth(full) <= maxW) {
          lineCount[i] = 1;
        } else {
          String nameLine = "- " + item.name;
          if (strPixelWidth(nameLine) <= maxW) {
            lineCount[i] = 2;
          } else {
            int split = fitPixels(item.name, maxW - 12);
            String rest = item.name.substring(split) + suffix;
            lineCount[i] = (strPixelWidth("  " + rest) <= maxW) ? 2 : 3;
          }
        }
      }

      const int MAX_PAGES = 20;
      int pageStarts[MAX_PAGES];
      int numPages = 0;
      pageStarts[numPages++] = 0;
      int usedLines = 0;
      for (int i = 0; i < nItems && i < MAX_ITEMS; i++) {
        int lc = lineCount[i];
        if (i > pageStarts[numPages - 1] && usedLines + lc > maxLines) {
          if (numPages < MAX_PAGES) pageStarts[numPages++] = i;
          usedLines = 0;
        }
        usedLines += lc;
      }

      int totalPages = numPages;
      int pageIndex  = (totalPages > 1) ? (int)((millis() / 2000) % totalPages) : 0;

      // Only refresh the items area and page indicator when pageIndex changes (every 2s)
      if (pageIndex != lastPageIndex) {
        lastPageIndex = pageIndex;
        int startIdx   = pageStarts[pageIndex];
        int endIdx     = (pageIndex + 1 < totalPages) ? pageStarts[pageIndex + 1] : nItems;
        drawBorrowDetailsItemsArea(pageIndex, totalPages, startIdx, endIdx, lineCount);
      }
      
      // Confirm checkout transaction
      if (buttonPressed) {
        currentState = STATE_CONFIRMING;
        drawConfirmingScreen();
        playBeep(1, 80, 0);
        delay(300);
      }
      else if (remainingSeconds <= 0) {
        callLedApi("off", 0); // ??¾æ????????
        currentState = STATE_ERROR;
        drawErrorScreen("????????????å·²é?¾æ??");
        stateTimer = millis();
      }
      break;
    }
      
    case STATE_CONFIRMING:
      if (sendConfirmRequest(scannedReqId)) {
        callLedApi("off", 0); // ç¢ºè????????å¾???????
        currentState = STATE_SUCCESS;
        drawSuccessScreen();
        playBeep(2, 100, 100);
        stateTimer = millis();
      } else {
        currentState = STATE_ERROR;
        drawErrorScreen("Transaction failed! Check internet.");
        playBeep(1, 1500, 0);
        stateTimer = millis();
      }
      break;
      
    case STATE_SUCCESS:
      if (millis() - stateTimer > 3000) {
        scannedReqId = "";
        currentState = STATE_STANDBY;
        drawStandbyScreen();
      }
      break;
      
    case STATE_ERROR:
      if (millis() - stateTimer > 3000) {
        scannedReqId = "";
        currentState = STATE_STANDBY;
        drawStandbyScreen();
      }
      break;
  }
  
  delay(10);
}
