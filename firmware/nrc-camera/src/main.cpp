#include "esp_camera.h"
#include "Arduino.h"
#include "FS.h"
#include "SD_MMC.h"
#include "soc/soc.h"
#include "soc/rtc_cntl_reg.h"

// ==========================================
// CAMERA PIN MAPPINGS (AI-Thinker Board)
// ==========================================
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

// ==========================================
// STATUS LED PIN MAPPING
// ==========================================
#define RED_LED_PIN       33  // Built-in small red LED on back of ESP32-CAM (Active LOW)
#define FLASH_LED_PIN      4  // Built-in bright white flash LED

// ==========================================
// CONFIGURATION VARIABLES
// ==========================================
String recDirectory = "";
uint32_t frameCount = 0;

void setup() {
  // Disable brownout detector to prevent sudden resets during SD Card writes or camera init
  WRITE_PERI_REG(RTC_CNTL_BROWN_OUT_REG, 0);

  Serial.begin(115200);
  Serial.println("\n[ESP32-CAM] Autonomous Camera Starting...");

  // Initialize LEDs
  pinMode(RED_LED_PIN, OUTPUT);
  pinMode(FLASH_LED_PIN, OUTPUT);
  digitalWrite(RED_LED_PIN, HIGH);  // Turn off red LED (Active LOW)
  digitalWrite(FLASH_LED_PIN, LOW); // Turn off bright flash LED

  // Configure Camera Settings
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sccb_sda = SIOD_GPIO_NUM;
  config.pin_sccb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;

  // Use SVGA (800x600) or VGA (640x480) for optimal balance of write speed and clarity
  config.frame_size = FRAMESIZE_SVGA; 
  config.jpeg_quality = 12; // 0-63, lower means higher quality (10-15 is excellent)
  config.fb_count = 2;      // Use double buffering to allow capture while writing to SD

  // Initialize Camera
  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("[ESP32-CAM] Camera init failed with error 0x%x\n", err);
    // Rapidly blink red LED to signal failure
    while (true) {
      digitalWrite(RED_LED_PIN, LOW);
      delay(100);
      digitalWrite(RED_LED_PIN, HIGH);
      delay(100);
    }
  }
  Serial.println("[ESP32-CAM] Camera initialized successfully");

  // Initialize SD Card in 1-bit or 4-bit native SDMMC mode
  // The ESP32-CAM board connects the MicroSD card to hardware SDMMC pins
  if (!SD_MMC.begin()) {
    Serial.println("[ESP32-CAM] MicroSD Card Mount Failed");
    // Blink red LED to signal SD failure
    while (true) {
      digitalWrite(RED_LED_PIN, LOW);
      delay(300);
      digitalWrite(RED_LED_PIN, HIGH);
      delay(300);
    }
  }
  
  uint8_t cardType = SD_MMC.cardType();
  if (cardType == CARD_NONE) {
    Serial.println("[ESP32-CAM] No MicroSD Card attached");
    while (true) {
      digitalWrite(RED_LED_PIN, LOW);
      delay(500);
      digitalWrite(RED_LED_PIN, HIGH);
      delay(500);
    }
  }
  Serial.println("[ESP32-CAM] MicroSD Card initialized");

  // Create a new recording directory to separate different launches/power cycles
  int recNum = 1;
  while (true) {
    String candidateDir = "/rec_" + String(recNum);
    if (!SD_MMC.exists(candidateDir)) {
      recDirectory = candidateDir;
      SD_MMC.mkdir(recDirectory);
      break;
    }
    recNum++;
  }
  Serial.printf("[ESP32-CAM] Recording folder created: %s\n", recDirectory.c_str());
  
  // Solid red LED indicates active setup complete, ready to record
  digitalWrite(RED_LED_PIN, LOW);
  delay(1000);
  digitalWrite(RED_LED_PIN, HIGH); // Turn off before starting loop
}

void loop() {
  // Capture a frame from the camera buffer
  camera_fb_t * fb = esp_camera_fb_get();
  if (!fb) {
    Serial.println("[ESP32-CAM] Camera capture failed");
    return;
  }

  // Construct frame path: e.g., "/rec_003/frame_00142.jpg"
  char framePath[64];
  sprintf(framePath, "%s/frame_%05d.jpg", recDirectory.c_str(), frameCount);

  // Turn on status LED briefly to indicate active write
  digitalWrite(RED_LED_PIN, LOW); 

  // Write JPEG frame to SD card
  File file = SD_MMC.open(framePath, FILE_WRITE);
  if (!file) {
    Serial.printf("[ESP32-CAM] Failed to open file for write: %s\n", framePath);
  } else {
    size_t written = file.write(fb->buf, fb->len);
    file.close(); // Close immediately to prevent corruption on power loss!
    
    if (written == fb->len) {
      Serial.printf("[REC] Saved: %s (%d bytes)\n", framePath, fb->len);
      frameCount++;
    } else {
      Serial.printf("[ESP32-CAM] File write incomplete: only %d of %d written\n", written, fb->len);
    }
  }

  // Return the frame buffer to be reused
  esp_camera_fb_return(fb);

  // Turn off status LED
  digitalWrite(RED_LED_PIN, HIGH);

  // Small delay to control frame rate (no delay runs at max speed, ~15-20 fps depending on write speed)
  delay(30); 
}
