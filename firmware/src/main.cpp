//
// ESP32-S3 + LSM6DS3 firmware: stream accelerometer/gyro/temp as JSON over USB CDC
//

#include <Arduino.h>
#include <Wire.h>
#include <LSM6DS3.h>

// Hardware constants
#define I2C_SDA 7
#define I2C_SCL 15
#define I2C_FREQUENCY_HZ 400000
#define SERIAL_BAUD 115200
#define LSM6DS3_I2C_ADDR 0x6B

// Sensor instance (I2C)
LSM6DS3 imu(I2C_MODE, LSM6DS3_I2C_ADDR);

static inline void printSensorJson(float ax, float ay, float az,
                                   float gx, float gy, float gz,
                                   float temperatureC) {
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
  Serial.println("}");
}

void setup() {
  // USB serial
  Serial.begin(SERIAL_BAUD);
  delay(2000); // Allow time for the host to open the port

  // I2C on specified pins
  Wire.begin(I2C_SDA, I2C_SCL, I2C_FREQUENCY_HZ);

  // Initialize sensor
  if (imu.begin() != 0) {
    // Halt on failure
    while (true) {
      delay(1000);
    }
  }

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

  // Emit one JSON object per line for the frontend to parse
  printSensorJson(accelX, accelY, accelZ, gyroX, gyroY, gyroZ, temperatureC);
}