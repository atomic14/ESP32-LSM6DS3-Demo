export interface SensorData {
  accel: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  gyroInt: { roll: number; pitch: number; yaw: number };
  fusion: { roll: number; pitch: number; yaw: number };
  temperature: number;
  t: number; // absolute device time in seconds since boot (from firmware)
}


