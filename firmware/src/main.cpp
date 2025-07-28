#include <Arduino.h>
#include <Wire.h>
#include <LSM6DS3.h>

// I2C pin definitions for LSM6DS3
#define I2C_SDA 7
#define I2C_SCL 15

// Create LSM6DS3 object with I2C interface
LSM6DS3 myIMU(I2C_MODE, 0x6B);


void setup() {
  // Initialize serial communication
  Serial.begin(115200);
  delay(2000);  // Give time for serial monitor to connect
  
  // Initialize I2C communication with custom pins
  Wire.begin(I2C_SDA, I2C_SCL, 100000);
  
  // Initialize the LSM6DS3 sensor using Seeed library
  if (myIMU.begin() != 0) {
    // If initialization fails, halt execution
    while(1) {
      delay(1000);
    }
  }
  
  // Brief delay to ensure sensor is ready
  delay(100);
}

void loop() {
  // Read accelerometer data (in g's)
  float accelX = myIMU.readFloatAccelX();
  float accelY = myIMU.readFloatAccelY();
  float accelZ = myIMU.readFloatAccelZ();
  
  // Read gyroscope data (in degrees per second)
  float gyroX = myIMU.readFloatGyroX();
  float gyroY = myIMU.readFloatGyroY();
  float gyroZ = myIMU.readFloatGyroZ();
  
  // Read temperature (in Celsius)
  float temperature = myIMU.readTempC();
  
  // Output JSON format for frontend parsing
  Serial.print("{\"accel\":{\"x\":");
  Serial.print(accelX, 3);
  Serial.print(",\"y\":");
  Serial.print(accelY, 3);
  Serial.print(",\"z\":");
  Serial.print(accelZ, 3);
  Serial.print("},\"gyro\":{\"x\":");
  Serial.print(gyroX, 2);
  Serial.print(",\"y\":");
  Serial.print(gyroY, 2);
  Serial.print(",\"z\":");
  Serial.print(gyroZ, 2);
  Serial.print("},\"temp\":");
  Serial.print(temperature, 1);
  Serial.println("}");
  
  // Wait 100ms before next reading (10 Hz output rate)
  delay(100);
}