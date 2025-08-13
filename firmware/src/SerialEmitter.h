#pragma once

#include "Emitter.h"
#include <sstream>

class SerialEmitter : public Emitter {
public:
  SerialEmitter(IMUProcessor *imuProcessor): Emitter(imuProcessor, "SerialEmitter") {
  }
  void send() override {
    std::stringstream ss;
    ss << "{\"accel\":{\"x\":";
    ss << ax;
    ss << ",\"y\":";
    ss << ay;
    ss << ",\"z\":";
    ss << az;
    ss << "},\"gyro\":{\"x\":";
    ss << gx;
    ss << ",\"y\":";
    ss << gy;
    ss << ",\"z\":";
    ss << gz;
    ss << "},\"temp\":";
    ss << temperatureC;
    ss << ",\"fusion\":{\"roll\":";
    ss << fusionRoll;
    ss << ",\"pitch\":";
    ss << fusionPitch;
    ss << ",\"yaw\":";
    ss << fusionYaw;
    ss << "},\"gyroInt\":{\"roll\":";
    ss << accumulatedGyroX;
    ss << ",\"pitch\":";
    ss << accumulatedGyroY;
    ss << ",\"yaw\":";
    ss << accumulatedGyroZ;
    ss << "},\"t\":";
    ss << timeSec;
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
        if (line == "RESET_GYRO") {
          imuProcessor->resetGyroIntegration();
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
  }
};