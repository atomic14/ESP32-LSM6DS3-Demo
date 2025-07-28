# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an ESP32S3-based accelerometer demo project that combines embedded firmware with a web frontend. The system reads LSM6DS3 accelerometer/gyroscope data and visualizes it through a 3D web interface using WebSerial.

## Architecture

The project consists of two main components:

1. **Firmware** (`firmware/`): ESP32S3 Arduino code that interfaces with LSM6DS3 sensor via I2C
   - Uses Seeed Studio LSM6DS3 library
   - Configured for I2C communication on GPIO7 (SDA) and GPIO15 (SCL)
   - Outputs sensor data over serial at 115200 baud, 10Hz update rate
   - Includes I2C device scanning and detailed troubleshooting output

2. **Frontend** (`frontend/`): Three.js + TypeScript web-based 3D visualization
   - Uses WebSerial API to connect to ESP32S3 and parse sensor data
   - Real-time 3D PCB orientation visualization based on accelerometer data
   - GLB/GLTF model loading for accurate PCB representation (converted from STEP)
   - Responsive UI with live sensor data display

## Development Commands

### Firmware Development

All firmware commands should be run from the `firmware/` directory:

```bash
cd firmware

# Build the firmware
pio run

# Upload to ESP32S3
pio run --target upload

# Monitor serial output
pio device monitor

# Build and upload in one command
pio run --target upload && pio device monitor

# Clean build files
pio run --target clean
```

### Hardware Configuration

- **Board**: ESP32-S3-DevKitC-1
- **Sensor**: LSM6DS3 accelerometer/gyroscope
- **I2C Address**: 0x6B (SDO connected to VCC)
- **Wiring**: SDA→GPIO7, SCL→GPIO15, VCC→3.3V, GND→GND
- **Serial**: 115200 baud rate, JSON format data output
- **Data Format**: `{"accel":{"x":0.123,"y":0.456,"z":0.789},"gyro":{"x":1.23,"y":4.56,"z":7.89},"temp":25.4}`

### Frontend Development

All frontend commands should be run from the `frontend/` directory:

```bash
cd frontend

# Install dependencies
npm install

# Start development server (runs on localhost:5173)
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview

# Type check
npm run type-check

# Lint code
npm run lint
```

**Important**: The WebSerial API requires HTTPS or localhost to function. The dev server runs on HTTP by default, but WebSerial will work on localhost.

## Key Files

- `firmware/src/main.cpp`: Main firmware code with sensor initialization and data reading
- `firmware/platformio.ini`: PlatformIO configuration for ESP32S3
- `frontend/src/main.ts`: Main frontend application entry point
- `frontend/src/webserial.ts`: WebSerial API integration for ESP32S3 communication
- `frontend/src/pcb-model.ts`: 3D PCB model with GLB file loading and orientation updates
- `frontend/src/scene.ts`: Three.js scene management with lighting and controls
- `frontend/pcb.glb`: 3D GLB model file converted from STEP for optimized web loading
- `frontend/pcb.step`: Original 3D STEP model file
- `frontend/package.json`: Frontend dependencies including Three.js