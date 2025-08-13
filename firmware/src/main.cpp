//
// ESP32-S3 + LSM6DS3 firmware: stream accelerometer/gyro/temp as JSON over USB
// CDC
//

#include "Fusion.h"
#include <Arduino.h>
#include <LSM6DS3.h>
#include <NimBLEDevice.h>
#include <Wire.h>

// Hardware constants
#define I2C_SDA 7
#define I2C_SCL 15
// LSM6DS3 I2C address - choose between 0x6A and 0x6B - most boards use 0x6A
#define LSM6DS3_I2C_ADDR 0x6B

#define I2C_FREQUENCY_HZ 400000
#define SERIAL_BAUD 115200

// Battery status inputs
#define PIN_BATT_CHARGING 16 // input, active-low: LOW = charging
#define PIN_BATT_CHARGED 17  // input, active-low: LOW = charged

// Active-low LEDs
#define PIN_LED_RED 4   // output, active-low: LOW = on
#define PIN_LED_GREEN 6 // output, active-low: LOW = on
#define PIN_LED_BLUE 5  // output, active-low: LOW = on

// Sensor instance (I2C)
LSM6DS3 imu(I2C_MODE, LSM6DS3_I2C_ADDR);

// Fusion AHRS
static FusionAhrs g_ahrs;
static FusionOffset offset;
// Quaternion for pure gyroscope integration (sensor frame)
static FusionQuaternion g_gyroQuaternion = FUSION_IDENTITY_QUATERNION;

static uint32_t lastUpdateMicros = 0;

// BLE (NimBLE) - custom GATT service and characteristics
static NimBLEServer *g_bleServer = nullptr;
static NimBLECharacteristic *g_blePacketCharacteristic =
    nullptr; // combined packet notify
static NimBLECharacteristic *g_bleControlCharacteristic = nullptr; // control write (commands)

static const char *BLE_SERVICE_UUID = "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f0001";
static const char *BLE_PACKET_UUID =
    "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f2001"; // combined packet
static const char *BLE_CONTROL_UUID =
    "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f1001"; // control write (commands)

// Simple helpers for active-low LEDs
// LED dimming via PWM (LEDC)
// Note: LEDs are active-low, so duty controls proportion of HIGH level.
// To achieve a perceived brightness B (0.0..1.0) where 1.0 is fully on (LOW),
// we set dutyNormalized = 1 - B.
#define LED_PWM_FREQ_HZ 5000
#define LED_PWM_RES_BITS 8
#define LED_PWM_MAX_DUTY ((1 << LED_PWM_RES_BITS) - 1)
// Global brightness when an LED is considered "on" (0.0..1.0). Adjust to taste.
static const float LED_BRIGHTNESS = 0.10f; // 10% brightness
const uint32_t LED_BLINK_PERIOD_MS = 500;  // 1 Hz blink

enum LedcChannelIndices {
  LEDC_CHANNEL_RED = 0,
  LEDC_CHANNEL_GREEN = 1,
  LEDC_CHANNEL_BLUE = 2,
};

static inline void initLeds() {
#ifdef PIN_LED_RED
  ledcSetup(LEDC_CHANNEL_RED, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
  ledcAttachPin(PIN_LED_RED, LEDC_CHANNEL_RED);
#endif
#ifdef PIN_LED_GREEN
  ledcSetup(LEDC_CHANNEL_GREEN, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
  ledcAttachPin(PIN_LED_GREEN, LEDC_CHANNEL_GREEN);
#endif
#ifdef PIN_LED_BLUE
  ledcSetup(LEDC_CHANNEL_BLUE, LED_PWM_FREQ_HZ, LED_PWM_RES_BITS);
  ledcAttachPin(PIN_LED_BLUE, LEDC_CHANNEL_BLUE);
#endif
}

static inline void writeLedOnState(uint8_t channel, bool on) {
  const uint32_t dutyWhenOn =
      (uint32_t)(LED_PWM_MAX_DUTY * (1.0f - LED_BRIGHTNESS) + 0.5f);
  const uint32_t duty =
      on ? dutyWhenOn : LED_PWM_MAX_DUTY; // active-low: HIGH (max duty) = off
  ledcWrite(channel, duty);
}

static inline void setRedLed(bool on) {
#ifdef PIN_LED_RED
  writeLedOnState(LEDC_CHANNEL_RED, on);
#endif
}
static inline void setGreenLed(bool on) {
#ifdef PIN_LED_GREEN
  writeLedOnState(LEDC_CHANNEL_GREEN, on);
#endif
}
static inline void setBlueLed(bool on) {
#ifdef PIN_LED_BLUE
  writeLedOnState(LEDC_CHANNEL_BLUE, on);
#endif
}

static inline void resetGyroIntegration() {
  g_gyroQuaternion = FUSION_IDENTITY_QUATERNION;
}

// BLE control characteristic write callback
class ControlCallbacks : public NimBLECharacteristicCallbacks {
  void onWrite (NimBLECharacteristic *pCharacteristic, NimBLEConnInfo &connInfo) override {
    std::string value = pCharacteristic->getValue();
    // Accept ASCII commands, case-insensitive, trim whitespace
    // Look for RESET_GYRO
    auto isSpace = [](char c) { return c == '\r' || c == '\n' || c == '\t' || c == ' '; };
    size_t start = 0, end = value.size();
    while (start < end && isSpace(value[start])) start++;
    while (end > start && isSpace(value[end - 1])) end--;
    std::string cmd = value.substr(start, end - start);
    // Uppercase
    for (char &c : cmd) c = (char)toupper((unsigned char)c);
    if (cmd == "RESET_GYRO") {
      resetGyroIntegration();
    }
  }
};

static void initialiseBle() {
  NimBLEDevice::init("ESP32IMU_v1");
  // Increase TX power for stability and request low connection interval for
  // throughput
  NimBLEDevice::setPower(ESP_PWR_LVL_P9);
  // 7.5 ms min, 25 ms max (values are in 1.25 ms units)
  // NimBLEDevice::setMinPreferred(0x06);
  // NimBLEDevice::setMaxPreferred(0x12);
  // Increase the MTU to reduce GATT overhead (central will negotiate down if
  // needed)
  NimBLEDevice::setMTU(185);

  g_bleServer = NimBLEDevice::createServer();
  NimBLEService *service = g_bleServer->createService(BLE_SERVICE_UUID);

  // Combined packet characteristic for efficient streaming
  g_blePacketCharacteristic = service->createCharacteristic(
      BLE_PACKET_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

  // Control characteristic for receiving commands (e.g., RESET_GYRO)
  g_bleControlCharacteristic = service->createCharacteristic(
      BLE_CONTROL_UUID,
      NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
  static ControlCallbacks controlCallbacks; // static to ensure lifetime
  g_bleControlCharacteristic->setCallbacks(&controlCallbacks);

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName("ESP32IMU_v1");
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->enableScanResponse(true);
  advertising->start();
}

static inline void printSensorJson(float ax, float ay, float az, float gx,
                                   float gy, float gz, float accumulatedGyroX,
                                   float accumulatedGyroY,
                                   float accumulatedGyroZ, float fusionRoll,
                                   float fusionPitch, float fusionYaw,
                                   float temperatureC, float timeSec) {
  Serial.print("{\"accel\":{\"x\":");
  Serial.print(ax, 3);
  Serial.print(",\"y\":");
  Serial.print(ay, 3);
  Serial.print(",\"z\":");
  Serial.print(az, 3);
  Serial.print("},\"gyro\":{\"x\":");
  Serial.print(gx, 2);
  Serial.print(",\"y\":");
  Serial.print(gy, 2);
  Serial.print(",\"z\":");
  Serial.print(gz, 2);
  Serial.print("},\"temp\":");
  Serial.print(temperatureC, 1);
  Serial.print(",\"fusion\":{\"roll\":");
  Serial.print(fusionRoll, 1);
  Serial.print(",\"pitch\":");
  Serial.print(fusionPitch, 1);
  Serial.print(",\"yaw\":");
  Serial.print(fusionYaw, 1);
  Serial.print("},\"gyroInt\":{\"roll\":");
  Serial.print(accumulatedGyroX, 1);
  Serial.print(",\"pitch\":");
  Serial.print(accumulatedGyroY, 1);
  Serial.print(",\"yaw\":");
  Serial.print(accumulatedGyroZ, 1);
  Serial.print("},\"t\":");
  Serial.print(timeSec, 6);
  Serial.println("}");
  Serial.flush();
}

static void sendBLEPacket(float ax, float ay, float az, float gx, float gy,
                          float gz, float accumulatedGyroX,
                          float accumulatedGyroY, float accumulatedGyroZ,
                          float fusionRoll, float fusionPitch, float fusionYaw,
                          float temperatureC, float timeSec) {
  float packet[14] = {ax,
                      ay,
                      az,
                      gx,
                      gy,
                      gz,
                      accumulatedGyroX,
                      accumulatedGyroY,
                      accumulatedGyroZ,
                      fusionRoll,
                      fusionPitch,
                      fusionYaw,
                      temperatureC,
                      timeSec};
  if (g_blePacketCharacteristic) {
    g_blePacketCharacteristic->setValue(
        reinterpret_cast<const uint8_t *>(packet), sizeof(packet));
    g_blePacketCharacteristic->notify();
  }
}

float wrapAngle(float angle) {
  while (angle < -180.0f)
    angle += 360.0f;
  while (angle > 180.0f)
    angle -= 360.0f;
  return angle;
}

// Integrate gyroscope (deg/s) over deltaTime (s) into persistent quaternion
// and output Euler angles (deg)
static void updateGyroIntegration(const FusionVector gyroscopeDegPerSec,
                                  const float deltaTime, float &outRollDeg,
                                  float &outPitchDeg, float &outYawDeg) {
  // Convert deg/s to rad/s
  const float wx = FusionDegreesToRadians(gyroscopeDegPerSec.axis.x);
  const float wy = FusionDegreesToRadians(gyroscopeDegPerSec.axis.y);
  const float wz = FusionDegreesToRadians(gyroscopeDegPerSec.axis.z);
  const float omegaMag = sqrtf(wx * wx + wy * wy + wz * wz);
  if (omegaMag > 0.0f && deltaTime > 0.0f) {
    const float angle = omegaMag * deltaTime; // radians
    const float halfAngle = 0.5f * angle;
    const float s = sinf(halfAngle) / omegaMag; // safe because omegaMag>0
    const float c = cosf(halfAngle);
    const FusionQuaternion delta = {.element = {
                                        .w = c,
                                        .x = wx * s,
                                        .y = wy * s,
                                        .z = wz * s,
                                    }};
    // q = q * delta
    g_gyroQuaternion = FusionQuaternionMultiply(g_gyroQuaternion, delta);
    g_gyroQuaternion = FusionQuaternionNormalise(g_gyroQuaternion);
  }

  const FusionEuler gyroEuler = FusionQuaternionToEuler(g_gyroQuaternion);
  outRollDeg = wrapAngle(gyroEuler.angle.roll);
  outPitchDeg = wrapAngle(gyroEuler.angle.pitch);
  outYawDeg = wrapAngle(gyroEuler.angle.yaw);
}

void setup() {
  // USB serial
  Serial.begin(SERIAL_BAUD);

  // I2C on specified pins
  Wire.begin(I2C_SDA, I2C_SCL, I2C_FREQUENCY_HZ);

  // Initialize sensor

  if (imu.begin() != 0) {
    // Halt on failure
    while (true) {
      Serial.println("{ \"error\": \"Failed to initialize LSM6DS3\" }");
      delay(1000);
    }
  }

// GPIO configuration: battery status inputs and LEDs (active-low)
#ifdef PIN_BATT_CHARGING
  pinMode(PIN_BATT_CHARGING, INPUT_PULLUP);
  pinMode(PIN_BATT_CHARGED, INPUT_PULLUP);
#endif
  initLeds();
  // Ensure LEDs off on boot
  setRedLed(false);
  setGreenLed(false);
  setBlueLed(false);

  // Initialise Fusion AHRS
  FusionAhrsInitialise(&g_ahrs);
  const FusionAhrsSettings settings = {
      .convention = FusionConventionNwu,
      .gain = 0.5f,
      .gyroscopeRange = 2000.0f,      // deg/s (set to your gyro full-scale)
      .accelerationRejection = 10.0f, // degrees
      .magneticRejection = 0.0f,      // no magnetometer in use
      .recoveryTriggerPeriod = 1000u  // samples (about ~5 s @ 200 Hz)
  };
  FusionAhrsSetSettings(&g_ahrs, &settings);

  // you can look in the frontend to see the actual sample rate that messages
  // are sent at
  FusionOffsetInitialise(&offset, 200);

  lastUpdateMicros = micros();

  // Reset pure gyro integrator orientation to identity
  g_gyroQuaternion = FUSION_IDENTITY_QUATERNION;

  // BLE GATT server
  initialiseBle();
}

void loop() {
  static uint32_t lastBlueBlinkMs = 0;
  static bool blueBlinkOn = false;

  // Battery LED logic
  const bool isCharging = (digitalRead(PIN_BATT_CHARGING) == LOW);
  const bool isCharged = (digitalRead(PIN_BATT_CHARGED) == LOW);

  // RED: solid during charging (and not yet charged), off otherwise
  setRedLed(isCharging && !isCharged);

  // GREEN: solid when charged, off otherwise
  setGreenLed(isCharged);

  // Read in the values from the sensor
  // First, handle any incoming Serial commands (non-blocking)
  static String serialCmdBuffer;
  while (Serial.available() > 0) {
    int b = Serial.read();
    if (b < 0) break;
    char c = (char)b;
    if (c == '\n' || c == '\r') {
      String line = serialCmdBuffer;
      serialCmdBuffer = "";
      line.trim();
      line.toUpperCase();
      if (line == "RESET_GYRO") {
        resetGyroIntegration();
      }
    } else {
      // Avoid unbounded growth
      if (serialCmdBuffer.length() < 128) {
        serialCmdBuffer += c;
      } else {
        // Reset buffer if too long without newline
        serialCmdBuffer = "";
      }
    }
  }

  // Proceed with sensor sampling
  const float temperatureC = imu.readTempC();

  FusionVector gyroscope; // deg/s
  gyroscope.axis.x = imu.readFloatGyroX();
  gyroscope.axis.y = imu.readFloatGyroY();
  gyroscope.axis.z = imu.readFloatGyroZ();

  FusionVector accelerometer; // g
  accelerometer.axis.x = imu.readFloatAccelX();
  accelerometer.axis.y = imu.readFloatAccelY();
  accelerometer.axis.z = imu.readFloatAccelZ();

  // Delta time for AHRS update (seconds)
  const uint32_t now = micros();
  float deltaTime = (now - lastUpdateMicros) / 1e6f;
  lastUpdateMicros = now;
  if (deltaTime <= 0.0f || deltaTime > 0.1f) {
    // Guard against unreasonable dt (e.g., on startup or USB stall)
    deltaTime = 0.01f;
  }

  // Update gyroscope offset correction algorithm
  gyroscope = FusionOffsetUpdate(&offset, gyroscope);

  // update the AHRS
  FusionAhrsUpdateNoMagnetometer(&g_ahrs, gyroscope, accelerometer, deltaTime);

  // Convert the quaternion to euler angles
  const FusionEuler fusionEuler =
      FusionQuaternionToEuler(FusionAhrsGetQuaternion(&g_ahrs));

  // Integrate gyroscope into quaternion (axis-angle), then expose as Euler
  // degrees
  float accumulatedGyroX = 0.0f;
  float accumulatedGyroY = 0.0f;
  float accumulatedGyroZ = 0.0f;
  updateGyroIntegration(gyroscope, deltaTime, accumulatedGyroX,
                        accumulatedGyroY, accumulatedGyroZ);

  // Print the sensor data to the serial port
  // Emit one JSON object per line for the frontend to parse (only when BLE is
  // not connected)
  if (!(g_bleServer && g_bleServer->getConnectedCount() > 0)) {
    printSensorJson(accelerometer.axis.x, accelerometer.axis.y,
                    accelerometer.axis.z, gyroscope.axis.x, gyroscope.axis.y,
                    gyroscope.axis.z, accumulatedGyroX, accumulatedGyroY,
                    accumulatedGyroZ, fusionEuler.angle.roll,
                    fusionEuler.angle.pitch, fusionEuler.angle.yaw,
                    temperatureC, now / 1e6f);
  }

  // Update BLE combined characteristic and notify if connected
  if (g_bleServer && g_bleServer->getConnectedCount() > 0) {
    sendBLEPacket(accelerometer.axis.x, accelerometer.axis.y,
                  accelerometer.axis.z, gyroscope.axis.x, gyroscope.axis.y,
                  gyroscope.axis.z, accumulatedGyroX, accumulatedGyroY,
                  accumulatedGyroZ, fusionEuler.angle.roll,
                  fusionEuler.angle.pitch, fusionEuler.angle.yaw, temperatureC,
                  now / 1e6f);
    // no need to blink the blue LED when connected
    blueBlinkOn = false;
    setBlueLed(true);
  } else {
    const uint32_t nowMs = millis();
    // blink the blue LED when not connected
    if (nowMs - lastBlueBlinkMs >= LED_BLINK_PERIOD_MS) {
      lastBlueBlinkMs = nowMs;
      blueBlinkOn = !blueBlinkOn;
      setBlueLed(blueBlinkOn);
    }
  }
}