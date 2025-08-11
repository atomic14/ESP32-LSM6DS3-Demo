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

static uint32_t g_lastUpdateMicros = 0;

// BLE (NimBLE) - custom GATT service and characteristics
static NimBLEServer *g_bleServer = nullptr;
static NimBLECharacteristic *g_blePacketCharacteristic =
    nullptr; // combined packet notify

static const char *BLE_SERVICE_UUID = "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f0001";
static const char *BLE_PACKET_UUID =
    "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f2001"; // combined packet


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

  service->start();

  NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
  advertising->setName("ESP32IMU_v1");
  advertising->addServiceUUID(BLE_SERVICE_UUID);
  advertising->enableScanResponse(true);
  advertising->start();
}

static inline void printSensorJson(float ax, float ay, float az, float gx,
                                   float gy, float gz, float temperatureC,
                                   float rollDeg, float pitchDeg,
                                   float yawDeg) {
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
  Serial.print(",\"euler\":{\"roll\":");
  Serial.print(rollDeg, 1);
  Serial.print(",\"pitch\":");
  Serial.print(pitchDeg, 1);
  Serial.print(",\"yaw\":");
  Serial.print(yawDeg, 1);
  Serial.println("}}");
  Serial.flush();
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
      .recoveryTriggerPeriod = 1000u    // samples (about ~5 s @ 200 Hz)
  };
  FusionAhrsSetSettings(&g_ahrs, &settings);

  // you can look in the frontend to see the actual sample rate that messages
  // are sent at
  FusionOffsetInitialise(&offset, 200);

  g_lastUpdateMicros = micros();

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
  const float temperatureC = imu.readTempC();

  FusionVector gyroscope; // deg/s
  gyroscope.axis.x = imu.readFloatGyroX();
  gyroscope.axis.y = imu.readFloatGyroY();
  gyroscope.axis.z = imu.readFloatGyroZ();

  FusionVector accelerometer; // g
  accelerometer.axis.x = imu.readFloatAccelX();
  accelerometer.axis.y = imu.readFloatAccelY();
  accelerometer.axis.z = imu.readFloatAccelZ();

  // Update gyroscope offset correction algorithm
  gyroscope = FusionOffsetUpdate(&offset, gyroscope);

  // Delta time for AHRS update (seconds)
  const uint32_t now = micros();
  float deltaTime = (now - g_lastUpdateMicros) / 1e6f;
  g_lastUpdateMicros = now;
  if (deltaTime <= 0.0f || deltaTime > 0.1f) {
    // Guard against unreasonable dt (e.g., on startup or USB stall)
    deltaTime = 0.01f;
  }
  // update the AHRS
  FusionAhrsUpdateNoMagnetometer(&g_ahrs, gyroscope, accelerometer, deltaTime);

  // Convert the quaternion to euler angles
  const FusionEuler euler =
      FusionQuaternionToEuler(FusionAhrsGetQuaternion(&g_ahrs));

  // Print the sensor data to the serial port
  // Emit one JSON object per line for the frontend to parse (only when BLE is
  // not connected)
  if (!(g_bleServer && g_bleServer->getConnectedCount() > 0)) {
    printSensorJson(accelerometer.axis.x, accelerometer.axis.y,
                    accelerometer.axis.z, gyroscope.axis.x, gyroscope.axis.y,
                    gyroscope.axis.z, temperatureC, euler.angle.roll,
                    euler.angle.pitch, euler.angle.yaw);
  }

  // Update BLE combined characteristic and notify if connected
  if (g_bleServer && g_bleServer->getConnectedCount() > 0) {
    // Packet layout (little-endian float32):
    // [ax, ay, az, gx, gy, gz, temperatureC, rollDeg, pitchDeg, yawDeg]
    float packet[10] = {accelerometer.axis.x, accelerometer.axis.y,
                        accelerometer.axis.z, gyroscope.axis.x,
                        gyroscope.axis.y,     gyroscope.axis.z,
                        temperatureC,         euler.angle.roll,
                        euler.angle.pitch,    euler.angle.yaw};
    if (g_blePacketCharacteristic) {
      g_blePacketCharacteristic->setValue(
          reinterpret_cast<const uint8_t *>(packet), sizeof(packet));
      g_blePacketCharacteristic->notify();
    }
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