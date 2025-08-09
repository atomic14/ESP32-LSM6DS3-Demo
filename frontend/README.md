# Accelerometer Frontend

Real-time 3D visualization of ESP32S3 accelerometer and gyroscope data using Three.js and the WebSerial API.

## Features

- **Real-time 3D Visualization**: Live PCB orientation tracking
- **WebSerial Integration**: Direct connection to ESP32S3 via WebSerial API
- **GLB Model Support**: Displays actual PCB 3D model (you will need to convert your model to GLB)
- **Orientation Modes**: Accelerometer (absolute tilt), Gyro (integrated) or Fusion (AHRS) - see this [repo](https://github.com/xioTechnologies/Fusion/tree/main) for details
- **Adjustable Smoothing (Accel only)**: Fine-tune responsiveness vs stability
- **Charts**: Separate live charts for accelerometer (g), gyroscope (°/s) and fusion (°)
- **Lighting**: Specular lighting with realistic material reflections

## Requirements

- **Modern Browser**: Chrome/Edge with WebSerial API support
- **HTTPS/Localhost**: WebSerial requires secure context
- **ESP32S3 Device**: Running compatible firmware with JSON output

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Start Development Server**
   ```bash
   npm run dev
   ```

3. **Open Application**
   - Navigate to `http://localhost:5173`
   - Click "Connect to ESP32S3"
   - Select your ESP32S3 serial port

4. Optional: **Load a custom GLB model** from the UI to replace the default PCB

## Usage

### Connection
- **Connect Button**: Establishes WebSerial connection to ESP32S3
- **Status Indicator**: Shows connection state (Connected/Disconnected)

### 3D Visualization & Controls
- **Orientation Mode**: Choose between `Accelerometer (abs)`, `Gyro (integrated)` or `Fusion (AHRS)`
  - In Gyro mode, orientation integrates angular rate with no smoothing (for accuracy)
  - In Accel mode, orientation uses absolute tilt (pitch/roll) with optional smoothing
  - In Fusion mode, orientation uses accelerometer and gyroscope data to estimate orientation - see this [repo](https://github.com/xioTechnologies/Fusion/tree/main) for details
- **Smoothing**: Slider enabled in Accel mode; disabled in Gyro mode
- **Reset**: Resets the gyro integration (in Gyro mode)
- **Mouse Drag**: Rotate camera around PCB
- **Mouse Wheel**: Zoom in/out
- **Real-time Updates**: PCB orientation matches physical device

## Data Format

The frontend expects JSON data from the ESP32S3:
```json
{
  // Accelerometer data in g
  "accel": { "x": 0.123, "y": 0.456, "z": 0.789 },
  // Gyroscope data in deg/s
  "gyro": { "x": 1.23, "y": 4.56, "z": 7.89 },
  // Euler angles in degrees (from Fusion AHRS)
  "euler": { "roll": 10.0, "pitch": 20.0, "yaw": 30.0 },
  // Temperature in °C
  "temp": 25.4
}
```

## Charts

- Two overlaid charts are rendered:
  - **Accelerometer (g)**: X/Y/Z in ±2g by default
  - **Gyroscope (°/s)**: X/Y/Z in ±500°/s by default
  - **Fusion (°)**: Roll/Pitch/Yaw in degrees (from Fusion AHRS)

## Build Commands

```bash
# Development server
npm run dev

# Production build  
npm run build

# Preview production build
npm run preview

# Type checking
npm run type-check

# Linting
npm run lint
```

## Technology Stack

- **Three.js**: 3D graphics and rendering
- **TypeScript**: Type-safe JavaScript
- **Vite**: Build tool and dev server
- **WebSerial API**: Direct browser-to-device communication
- **GLTFLoader**: 3D model loading
- **Sensor Fusion (AHRS)**: Orientation from the embedded firmware uses the Fusion library by xioTechnologies: [xioTechnologies/Fusion](https://github.com/xioTechnologies/Fusion/tree/main)

## Project Structure

```
src/
├── main.ts           # Application entry point
├── scene.ts          # Three.js scene setup and lighting
├── pcb-model.ts      # PCB 3D model and orientation logic
├── webserial.ts      # WebSerial communication manager
├── graph.ts          # Lightweight graph overlay for accel/gyro X/Y/Z
└── types.d.ts        # Type definitions

public/
└── pcb.glb          # 3D PCB model file
```

## Browser Compatibility

- ✅ Chrome 89+
- ✅ Edge 89+  
- ❌ Firefox (no WebSerial support)
- ❌ Safari (no WebSerial support)

## Troubleshooting

### Connection Issues
- Ensure ESP32S3 is connected and running firmware
- Check that browser supports WebSerial API
- Verify HTTPS or localhost URL

### Model Display Issues
- Check that `pcb.glb` file exists in public folder
- Verify GLB file was properly converted from STEP
- Check browser console for loading errors

### Orientation Issues
- Calibrate with PCB flat on stable surface
- Adjust smoothing if movement is jittery
- Ensure firmware outputs proper JSON format

## Development Notes

- **Hot Reload**: Vite provides instant updates during development
- **Type Safety**: Full TypeScript support with strict mode
- **ES Modules**: Modern module system throughout
- **Tree Shaking**: Optimized production builds