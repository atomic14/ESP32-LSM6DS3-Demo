#pragma once

#include "Transport.h"
#include <sstream>

class SerialTransport : public Transport {
public:
  SerialTransport(Transport::ResetGyroHandler onResetGyro): Transport("SerialTransport", onResetGyro) {
  }
  void transmit() override {
    std::stringstream ss;
    ss << "{\"accel\":{\"x\":";
    ss << data.ax;
    ss << ",\"y\":";
    ss << data.ay;
    ss << ",\"z\":";
    ss << data.az;
    ss << "},\"gyro\":{\"x\":";
    ss << data.gx;
    ss << ",\"y\":";
    ss << data.gy;
    ss << ",\"z\":";
    ss << data.gz;
    ss << "},\"temp\":";
    ss << data.temperatureC;
    ss << ",\"fusion\":{\"roll\":";
    ss << data.fusionRoll;
    ss << ",\"pitch\":";
    ss << data.fusionPitch;
    ss << ",\"yaw\":";
    ss << data.fusionYaw;
    ss << "},\"gyroInt\":{\"roll\":";
    ss << data.accumulatedGyroX;
    ss << ",\"pitch\":";
    ss << data.accumulatedGyroY;
    ss << ",\"yaw\":";
    ss << data.accumulatedGyroZ;
    ss << "},\"t\":";
    ss << data.timeSec;
    ss << "}";
    std::string s = ss.str();
    Serial.println(s.c_str());
    Serial.flush();

    
    // check for any serial commands
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
        processCommand(line.c_str());
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
  }
};