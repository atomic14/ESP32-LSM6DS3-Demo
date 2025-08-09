//
// ESP32-S3 + LSM6DS3 firmware: stream accelerometer/gyro/temp as JSON over USB CDC
//

#include <Arduino.h>
#include <Wire.h>
#include <LSM6DS3.h>
#include "Fusion.h"

// Hardware constants
#define I2C_SDA 7
#define I2C_SCL 15
// LSM6DS3 I2C address - choose between 0x6A and 0x6B - most boards use 0x6A
#define LSM6DS3_I2C_ADDR 0x6B

#define I2C_FREQUENCY_HZ 400000
#define SERIAL_BAUD 115200

// Sensor instance (I2C)
LSM6DS3 imu(I2C_MODE, LSM6DS3_I2C_ADDR);

// Fusion AHRS
static FusionAhrs g_ahrs;
static FusionOffset offset;

static uint32_t g_lastUpdateMicros = 0;

static inline void printSensorJson(float ax, float ay, float az,
                                   float gx, float gy, float gz,
                                   float temperatureC,
                                   float rollDeg, float pitchDeg, float yawDeg) {
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

  // Initialise Fusion AHRS
  FusionAhrsInitialise(&g_ahrs);
  const FusionAhrsSettings settings = {
      .convention = FusionConventionNwu,
      .gain = 0.5f,
      .gyroscopeRange = 2000.0f,           // deg/s (set to your gyro full-scale)
      .accelerationRejection = 10.0f,      // degrees
      .magneticRejection = 0.0f,           // no magnetometer in use
      .recoveryTriggerPeriod = 500u        // samples (about ~5 s @ 100 Hz)
  };
  FusionAhrsSetSettings(&g_ahrs, &settings);

  // TODO - what is the actual sample rate - it's probably something around this
  FusionOffsetInitialise(&offset, 100);

  g_lastUpdateMicros = micros();

  delay(100);
}

void loop() {
  // Accelerometer in g, gyro in deg/s, temperature in °C
  const float accelX = imu.readFloatAccelX();
  const float accelY = imu.readFloatAccelY();
  const float accelZ = imu.readFloatAccelZ();

  const float gyroX = imu.readFloatGyroX();
  const float gyroY = imu.readFloatGyroY();
  const float gyroZ = imu.readFloatGyroZ();

  const float temperatureC = imu.readTempC();

  // Delta time for AHRS update (seconds)
  const uint32_t now = micros();
  float deltaTime = (now - g_lastUpdateMicros) / 1e6f;
  g_lastUpdateMicros = now;
  if (deltaTime <= 0.0f || deltaTime > 0.1f) {
    // Guard against unreasonable dt (e.g., on startup or USB stall)
    deltaTime = 0.01f;
  }

  // Update AHRS (no magnetometer)
  FusionVector gyroscope;      // deg/s
  gyroscope.axis.x = gyroX;
  gyroscope.axis.y = gyroY;
  gyroscope.axis.z = gyroZ;


  // Update gyroscope offset correction algorithm
  gyroscope = FusionOffsetUpdate(&offset, gyroscope);

  FusionVector accelerometer;  // g
  accelerometer.axis.x = accelX;
  accelerometer.axis.y = accelY;
  accelerometer.axis.z = accelZ;

  FusionAhrsUpdateNoMagnetometer(&g_ahrs, gyroscope, accelerometer, deltaTime);

  const FusionEuler euler = FusionQuaternionToEuler(FusionAhrsGetQuaternion(&g_ahrs));

  // Emit one JSON object per line for the frontend to parse
  printSensorJson(accelX, accelY, accelZ, gyroX, gyroY, gyroZ, temperatureC,
                  euler.angle.roll, euler.angle.pitch, euler.angle.yaw);
}