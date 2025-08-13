#pragma once

#include "Emitter.h"
#include "IMUProcessor.h"
#include <NimBLEDevice.h>


#define BLE_SERVICE_UUID "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f0001"
#define BLE_PACKET_UUID "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f2001" // combined packet
#define BLE_CONTROL_UUID "9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f1001" // control write (commands)

class BluetoothEmitter : public Emitter, NimBLECharacteristicCallbacks {
private:
  NimBLEServer *bleServer = nullptr;
  NimBLECharacteristic *blePacketCharacteristic;
  NimBLECharacteristic *bleControlCharacteristic;

public:
  BluetoothEmitter(IMUProcessor *imuProcessor): Emitter(imuProcessor, "BluetoothEmitter") {
  }

  void begin() override {
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

    bleServer = NimBLEDevice::createServer();
    NimBLEService *service = bleServer->createService(BLE_SERVICE_UUID);

    // Combined packet characteristic for efficient streaming
    blePacketCharacteristic = service->createCharacteristic(
        BLE_PACKET_UUID, NIMBLE_PROPERTY::READ | NIMBLE_PROPERTY::NOTIFY);

    // Control characteristic for receiving commands (e.g., RESET_GYRO)
    bleControlCharacteristic = service->createCharacteristic(
        BLE_CONTROL_UUID,
        NIMBLE_PROPERTY::WRITE | NIMBLE_PROPERTY::WRITE_NR);
    bleControlCharacteristic->setCallbacks(this);

    service->start();

    NimBLEAdvertising *advertising = NimBLEDevice::getAdvertising();
    advertising->setName("ESP32IMU_v1");
    advertising->addServiceUUID(BLE_SERVICE_UUID);
    advertising->enableScanResponse(true);
    advertising->start();

    Emitter::begin();
  }

  bool isConnected() {
    return bleServer && bleServer->getConnectedCount() > 0;
  }
  void send() override {
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
    if (blePacketCharacteristic) {
      blePacketCharacteristic->setValue(
          reinterpret_cast<const uint8_t *>(packet), sizeof(packet));
      blePacketCharacteristic->notify();
    }
  }

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
      imuProcessor->resetGyroIntegration();
    }
  }
};