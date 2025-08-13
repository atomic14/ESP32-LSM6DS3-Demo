[![Firmware CI](https://github.com/atomic14/ESP32-LSM6DS3-Demo/actions/workflows/firmware.yml/badge.svg)](https://github.com/atomic14/ESP32-LSM6DS3-Demo/actions/workflows/firmware.yml)
[![Frontend CI](https://github.com/atomic14/ESP32-LSM6DS3-Demo/actions/workflows/frontend.yml/badge.svg)](https://github.com/atomic14/ESP32-LSM6DS3-Demo/actions/workflows/frontend.yml)

# ESP32S3 IMU (Accelerometer + Gyroscope) Demo

<iframe width="560" height="315" src="https://www.youtube.com/embed/6vpdAXEQaoQ?si=FPIHsByv4Kcjpzi-" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

A complete hardware + software solution for real-time 3D IMU visualization. This project combines an ESP32S3 microcontroller with the LSM6DS3 accelerometer/gyroscope and a web-based 3D visualization frontend.

If you find this project useful, please consider [supporting me on Patreon](https://www.patreon.com/atomic14).

![Demo](images/demo.png)

Demo site: https://lsm6ds3.atomic14.com/

## Overview

- **Hardware**: ESP32S3 + LSM6DS3 accelerometer/gyroscope over I2C
- **Firmware**: JSON sensor stream over USB Serial (115200) and Bluetooth LE GATT
- **Frontend**: Three.js web app with WebSerial and Web Bluetooth support
- **Visualization**: Real-time 3D PCB orientation tracking with GLB model support

## Project Structure

```
├── firmware/           # ESP32S3 Arduino firmware
│   ├── src/main.cpp   # Main firmware code
│   └── platformio.ini # PlatformIO configuration
├── frontend/          # Three.js web application
│   ├── src/           # TypeScript source code
│   ├── public/        # Static assets served by Vite
│   │   └── pcb.glb    # 3D PCB model file
│   └── package.json   # Dependencies and scripts
├── CLAUDE.md          # Development guidance
└── README.md          # This file
```

## Quick Start

### 1. Hardware Setup
- **Board**: ESP32-S3 Custom PCB
- **Sensor**: LSM6DS3 accelerometer/gyroscope
- **Wiring**:
  - SDA → GPIO7
  - SCL → GPIO15
  - VCC → 3.3V
  - GND → GND
  - I2C speed: 400 kHz
  - Default I2C address: 0x6B (settable to 0x6A)

### 2. Firmware Upload
```bash
cd firmware
pio run --target upload
pio device monitor  # Monitor serial output
```

### 3. Frontend Development
```bash
cd frontend
npm install
npm run dev         # Start development server
```

### 4. Connect & Visualize
1. Open `http://localhost:5173` in Chrome/Edge
2. Connect via either path:
   - WebSerial: Click "Connect via WebSerial" and choose the ESP32S3 port
   - WebBluetooth: Click "Connect via WebBLE" and select a device named `ESP32IMU_v1`
3. Choose an orientation mode:
   - `Accelerometer (abs)`: absolute tilt (pitch/roll) with optional smoothing
   - `Gyro (integrated)`: integrates angular rate to track orientation; use "Reset Gyro" to re-zero
   - `Fusion (AHRS)`: accelerometer + gyroscope via Fusion AHRS
4. Optional: load a custom GLB model from the UI
5. Tilt/rotate the PCB to see real-time 3D visualization

## Features

### Hardware
- **I2C Communication**: LSM6DS3 accelerometer/gyroscope - you can adjust the pins and I2C address in `main.cpp`
- **JSON Output**: Clean, parseable data format output over serial
- **BLE GATT**: Notify characteristic for real-time data

### Frontend
- **WebSerial & WebBluetooth**: Connect over USB Serial or BLE GATT
- **3D PCB Model**: GLB file support with optional custom model loading
- **Orientation Modes**: Accelerometer (absolute tilt), Gyro (integrated), Fusion (AHRS)
- **Adjustable Smoothing (Accel only)**: Fine-tune responsiveness vs stability
- **Charts**: Live accelerometer, gyroscope, and fusion Euler angle charts
- **Message Rate**: Real-time device messages/second readout
- **Lighting**: Specular reflections and realistic materials
- **Mouse Controls**: Orbit camera, zoom, and inspect the model

## Data Format

The firmware outputs one JSON object per line on USB Serial when BLE is not connected. Fields:

```json
{
  "accel": { "x": 0.123, "y": 0.456, "z": 0.789 },      // g
  "gyro": { "x": 1.23, "y": 4.56, "z": 7.89 },         // deg/s
  "temp": 25.4,                                            // °C
  "fusion": { "roll": 10.0, "pitch": 20.0, "yaw": 30.0 }, // deg, AHRS
  "gyroInt": { "roll": 9.8, "pitch": 19.9, "yaw": 29.7 }, // deg, integrated gyro
  "t": 123.456789                                          // device time in seconds
}
```

## Browser Requirements

- ✅ Chrome/Edge 89+ (WebSerial and Web Bluetooth; requires HTTPS or localhost)
- ❌ Firefox (no WebSerial/Web Bluetooth)
- ❌ Safari (no WebSerial)

## Development Commands

### Firmware (PlatformIO)
```bash
cd firmware
pio run                    # Build firmware
pio run --target upload    # Upload to ESP32S3
pio device monitor         # Monitor serial output
pio run --target clean     # Clean build files
```

### Frontend (Node.js)
```bash
cd frontend
npm install               # Install dependencies
npm run dev              # Development server
npm run build            # Production build
npm run type-check       # TypeScript checking
npm run lint             # Code linting
```

## Troubleshooting

### Hardware Issues
- **No I2C device found**: Check wiring and power supply
- **Sensor initialization failed**: Verify LSM6DS3 address (0x6B with SDO→VCC)
- **No serial output**: Check USB cable and ESP32S3 connection

### Frontend Issues
- **Connection failed**: Ensure Chrome/Edge browser and HTTPS/localhost
- **No data received**: Verify firmware is outputting JSON format
- **Model not loading**: Check that `pcb.glb` exists in public folder

## Technical Details

- **Accelerometer Range**: ±2g, ±4g, ±8g, ±16g (configurable)
- **Gyroscope Range**: ±125°/s, ±250°/s, ±500°/s, ±1000°/s, ±2000°/s
- **I2C Speed**: 400 kHz
- **Serial Baud Rate**: 115200
- **Update Rate**: dependent on loop timing; see UI "Msgs/s"

## Sensor Fusion (AHRS)

- Orientation fusion is provided by the xioTechnologies Fusion AHRS library. See the repository for details: [xioTechnologies/Fusion](https://github.com/xioTechnologies/Fusion/tree/main).
- Configuration: NWU earth-frame convention; Euler angles extracted using ZYX; magnetometer disabled.

## Bluetooth LE

- Device name: `ESP32IMU_v1`
- Service UUID: `9c2a8b2a-6c7a-4b8b-bf3c-7f6b1f7f0001`
- Characteristics:
  - Packet (notify, little-endian float32[14]):
    `[ax, ay, az, gx, gy, gz, gyroIntRoll, gyroIntPitch, gyroIntYaw, fusionRoll, fusionPitch, fusionYaw, tempC, timeSec]`
  - Control (write or write without response): ASCII commands, e.g. `RESET_GYRO\n`

LEDs and battery pins (active-low):
- Red LED solid while charging (not yet charged)
- Green LED solid when charged
- Blue LED blinks when not BLE-connected; solid when connected

## License

This project is open source. See individual component licenses for details.