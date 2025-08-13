#pragma once

#include <Arduino.h>
#include <LSM6DS3.h>

struct IMUData {
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
};

class IMUProcessor {
private:
  LSM6DS3 *imu;
  static float wrapAngle(float angle) {
    while (angle < -180.0f)
      angle += 360.0f;
    while (angle > 180.0f)
      angle -= 360.0f;
    return angle;
  }

  // Integrate gyroscope (deg/s) over deltaTime (s) into persistent quaternion
  // and output Euler angles (deg)
  void updateGyroIntegration(const FusionVector gyroscopeDegPerSec,
                                    const float deltaTime) {
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
      gyroQuaternion = FusionQuaternionMultiply(gyroQuaternion, delta);
      gyroQuaternion = FusionQuaternionNormalise(gyroQuaternion);
    }

    const FusionEuler gyroEuler = FusionQuaternionToEuler(gyroQuaternion);
    accumulatedGyroX = wrapAngle(gyroEuler.angle.roll);
    accumulatedGyroY = wrapAngle(gyroEuler.angle.pitch);
    accumulatedGyroZ = wrapAngle(gyroEuler.angle.yaw);
  }

public:
  FusionAhrs g_ahrs;
  FusionEuler fusionEuler;
  FusionOffset offset;
  FusionQuaternion gyroQuaternion;
  FusionVector gyroscopeDegPerSec;
  FusionVector accelerometer;
  float temperatureC;
  float accumulatedGyroX;
  float accumulatedGyroY;
  float accumulatedGyroZ;
  uint32_t lastUpdateMicros = 0;

  IMUProcessor(LSM6DS3 *imu) {
    this->imu = imu;
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
    gyroQuaternion = FUSION_IDENTITY_QUATERNION;
  }

  void resetGyroIntegration() { 
    gyroQuaternion = FUSION_IDENTITY_QUATERNION;
    accumulatedGyroX = 0.0f;
    accumulatedGyroY = 0.0f;
    accumulatedGyroZ = 0.0f;
  }

  void update() {
    // Proceed with sensor sampling
    temperatureC = imu->readTempC();

    FusionVector gyroscope; // deg/s
    gyroscope.axis.x = imu->readFloatGyroX();
    gyroscope.axis.y = imu->readFloatGyroY();
    gyroscope.axis.z = imu->readFloatGyroZ();

    accelerometer.axis.x = imu->readFloatAccelX();
    accelerometer.axis.y = imu->readFloatAccelY();
    accelerometer.axis.z = imu->readFloatAccelZ();

    // Delta time for AHRS update (seconds)
    const uint32_t now = micros();
    float deltaTime = (now - lastUpdateMicros) / 1e6f;
    lastUpdateMicros = now;
    if (deltaTime <= 0.0f || deltaTime > 0.1f) {
      // Guard against unreasonable dt (e.g., on startup or USB stall)
      deltaTime = 0.01f;
    }

    // Update gyroscope offset correction algorithm
    gyroscopeDegPerSec = FusionOffsetUpdate(&offset, gyroscope);

    // update the AHRS
    FusionAhrsUpdateNoMagnetometer(&g_ahrs, gyroscopeDegPerSec, accelerometer,
                                   deltaTime);

    // Convert the quaternion to euler angles
    fusionEuler =
        FusionQuaternionToEuler(FusionAhrsGetQuaternion(&g_ahrs));

    updateGyroIntegration(gyroscopeDegPerSec, deltaTime);
  }

  IMUData getData() {
    IMUData data;
    data.ax = accelerometer.axis.x;
    data.ay = accelerometer.axis.y;
    data.az = accelerometer.axis.z;
    data.gx = gyroscopeDegPerSec.axis.x;
    data.gy = gyroscopeDegPerSec.axis.y;
    data.gz = gyroscopeDegPerSec.axis.z;
    data.accumulatedGyroX = accumulatedGyroX;
    data.accumulatedGyroY = accumulatedGyroY;
    data.accumulatedGyroZ = accumulatedGyroZ;
    data.fusionRoll = fusionEuler.angle.roll;
    data.fusionPitch = fusionEuler.angle.pitch;
    data.fusionYaw = fusionEuler.angle.yaw;
    data.temperatureC = temperatureC;
    data.timeSec = lastUpdateMicros / 1e6f;
    return data;
  }
};