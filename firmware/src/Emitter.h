#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include "IMUProcessor.h"

class Emitter {
protected:
  IMUProcessor *imuProcessor;
  // should this be sending?
  bool active = false;
  // accelerometer data - g
  float ax;
  float ay;
  float az;
  // gyro data - deg/s
  float gx;
  float gy;
  float gz;
  // accumulated gyro data - deg
  float accumulatedGyroX;
  float accumulatedGyroY;
  float accumulatedGyroZ;
  // fusion data - deg
  float fusionRoll;
  float fusionPitch;
  float fusionYaw;
  // temperature - C
  float temperatureC;
  // time - seconds
  float timeSec;
  // dirty flag
  bool dirty = false;
  std::string name;
  SemaphoreHandle_t dataLock;

  static void task(void *pvParameter) {
    Emitter *emitter = static_cast<Emitter *>(pvParameter);
    while(true) {
      if (!emitter->active) {
        vTaskDelay(100 / portTICK_PERIOD_MS);
        continue;
      }
      uint32_t start = millis();
      xSemaphoreTake(emitter->dataLock, portMAX_DELAY);
      if (emitter->dirty) {
        emitter->dirty = false;
        emitter->send();
      }
      xSemaphoreGive(emitter->dataLock);
      int32_t elapsed = millis() - start;
      int32_t requiredDelay = max(1, 10 - elapsed);
      // we're aiming for around 100 updates per second - way over the top!
      vTaskDelay(requiredDelay / portTICK_PERIOD_MS);
    }
  }
public:
    Emitter(IMUProcessor *imuProcessor, std::string name) {
      this->imuProcessor = imuProcessor;
      this->dataLock = xSemaphoreCreateMutex();
    }
    virtual void begin() {
      active = true;
      // Some weir dbehaviour here - if we don't pin to core 1, the serial output is corrupted
      xTaskCreatePinnedToCore(
        task,
        name.c_str(),
        8192,
        this,
        0,
        nullptr,
        1);
    }
    virtual void end() {
      active = false;
    }
    virtual void setActive(bool active) {
      this->active = active;
    }
    virtual void update() {
      xSemaphoreTake(dataLock, portMAX_DELAY);
      this->ax = imuProcessor->accelerometer.axis.x;
      this->ay = imuProcessor->accelerometer.axis.y;
      this->az = imuProcessor->accelerometer.axis.z;
      this->gx = imuProcessor->gyroscopeDegPerSec.axis.x;
      this->gy = imuProcessor->gyroscopeDegPerSec.axis.y;
      this->gz = imuProcessor->gyroscopeDegPerSec.axis.z;
      this->accumulatedGyroX = imuProcessor->accumulatedGyroX;
      this->accumulatedGyroY = imuProcessor->accumulatedGyroY;
      this->accumulatedGyroZ = imuProcessor->accumulatedGyroZ;
      this->fusionRoll = imuProcessor->fusionEuler.angle.roll;
      this->fusionPitch = imuProcessor->fusionEuler.angle.pitch;
      this->fusionYaw = imuProcessor->fusionEuler.angle.yaw;
      this->temperatureC = imuProcessor->temperatureC;
      this->timeSec = imuProcessor->lastUpdateMicros / 1e6f;
      this->dirty = true;
      xSemaphoreGive(dataLock);
    }
    virtual void send() = 0;
};