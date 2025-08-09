export interface SensorData {
  accel: { x: number; y: number; z: number };
  gyro: { x: number; y: number; z: number };
  temperature: number;
  euler?: { roll: number; pitch: number; yaw: number };
}


