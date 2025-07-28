# Accelerometer Frontend

A real-time 3D visualization web application for ESP32S3 accelerometer data using Three.js and WebSerial API.

## Features

- **Real-time 3D Visualization**: Live PCB orientation tracking based on accelerometer data
- **WebSerial Integration**: Direct connection to ESP32S3 via WebSerial API
- **GLB Model Support**: Displays actual PCB 3D model converted from STEP files
- **Orientation Calibration**: Set reference orientation with PCB flat on table
- **Adjustable Smoothing**: Fine-tune responsiveness vs stability
- **Professional Lighting**: Specular lighting with realistic material reflections

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

4. **Calibrate Orientation**
   - Place PCB flat on table
   - Click "Calibrate (Set Reference)"
   - Now tilting shows relative to flat position

## Usage

### Connection
- **Connect Button**: Establishes WebSerial connection to ESP32S3
- **Status Indicator**: Shows connection state (Connected/Disconnected)

### Orientation Control
- **Calibrate Button**: Sets current position as reference (0,0,0)
- **Reset Button**: Resets to identity orientation
- **Smoothing Slider**: Adjusts filtering (0-50%, default 10%)

### 3D Visualization
- **Mouse Drag**: Rotate camera around PCB
- **Mouse Wheel**: Zoom in/out
- **Real-time Updates**: PCB orientation matches physical device

## Data Format

The frontend expects JSON data from the ESP32S3:
```json
{"accel":{"x":0.123,"y":0.456,"z":0.789},"gyro":{"x":1.23,"y":4.56,"z":7.89},"temp":25.4}
```

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

## Project Structure

```
src/
├── main.ts           # Application entry point
├── scene.ts          # Three.js scene setup and lighting
├── pcb-model.ts      # PCB 3D model and orientation logic
├── webserial.ts      # WebSerial communication manager
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