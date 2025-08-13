#pragma once

#include <Arduino.h>
#include <freertos/FreeRTOS.h>
#include <functional>
#include "IMUProcessor.h"

class Transport {
protected:
  // should this be sending?
  bool active = false;
  IMUData data;
  // dirty flag
  bool dirty = false;
  std::string name;
  SemaphoreHandle_t dataLock;
  using ResetGyroHandler = std::function<void()>;
  ResetGyroHandler onResetGyro;

  static void task(void *pvParameter) {
    Transport *transport = static_cast<Transport *>(pvParameter);
    while(true) {
      if (!transport->active) {
        vTaskDelay(100 / portTICK_PERIOD_MS);
        continue;
      }
      uint32_t start = millis();
      xSemaphoreTake(transport->dataLock, portMAX_DELAY);
      if (transport->dirty) {
        transport->dirty = false;
        transport->transmit();
      }
      xSemaphoreGive(transport->dataLock);
      int32_t elapsed = millis() - start;
      int32_t requiredDelay = max(1, 10 - elapsed);
      // we're aiming for around 100 updates per second - way over the top!
      vTaskDelay(requiredDelay / portTICK_PERIOD_MS);
    }
  }
  public:
    Transport(std::string name, ResetGyroHandler onResetGyro) {
      this->onResetGyro = onResetGyro;
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
    virtual void update(IMUData data) {
      xSemaphoreTake(dataLock, portMAX_DELAY);
      this->data = data;
      this->dirty = true;
      xSemaphoreGive(dataLock);
    }

    void processCommand(std::string cmd) {
      if (cmd == "RESET_GYRO") {
        if (onResetGyro) onResetGyro();
      }
    }
    virtual void transmit() = 0;
};