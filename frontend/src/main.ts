import { WebSerialManager, SensorData } from './webserial';
import { SceneManager } from './scene';
import { PCBModel } from './pcb-model';
import { AccelGraph } from './graph';

class AccelerometerApp {
    private serialManager: WebSerialManager;
    private sceneManager: SceneManager;
    private pcbModel: PCBModel | null = null;
    private connectBtn: HTMLButtonElement;
    private statusEl: HTMLElement;
    private calibrateBtn: HTMLButtonElement;
    private resetBtn: HTMLButtonElement;
    private smoothingSlider: HTMLInputElement;
    private smoothingValueSpan: HTMLSpanElement;
    private baseRotXSlider!: HTMLInputElement;
    private baseRotYSlider!: HTMLInputElement;
    private baseRotZSlider!: HTMLInputElement;
    private baseRotXValue!: HTMLSpanElement;
    private baseRotYValue!: HTMLSpanElement;
    private baseRotZValue!: HTMLSpanElement;
    private latestSensorData: SensorData | null = null;
    private accelGraph: AccelGraph | null = null;

    constructor() {
        this.serialManager = new WebSerialManager();
        this.sceneManager = new SceneManager();
        
        this.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
        this.statusEl = document.getElementById('connection-status') as HTMLElement;
        this.calibrateBtn = document.getElementById('calibrate-btn') as HTMLButtonElement;
        this.resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
        this.smoothingSlider = document.getElementById('smoothing-slider') as HTMLInputElement;
        this.smoothingValueSpan = document.getElementById('smoothing-value') as HTMLSpanElement;
        this.baseRotXSlider = document.getElementById('base-rot-x') as HTMLInputElement;
        this.baseRotYSlider = document.getElementById('base-rot-y') as HTMLInputElement;
        this.baseRotZSlider = document.getElementById('base-rot-z') as HTMLInputElement;
        this.baseRotXValue = document.getElementById('base-rot-x-value') as HTMLSpanElement;
        this.baseRotYValue = document.getElementById('base-rot-y-value') as HTMLSpanElement;
        this.baseRotZValue = document.getElementById('base-rot-z-value') as HTMLSpanElement;

        this.init();
    }

    private async init() {
        // Initialize the 3D scene
        await this.sceneManager.init();
        
        // Load the PCB model
        this.pcbModel = new PCBModel(this.sceneManager.scene);
        await this.pcbModel.load('/pcb.glb');

        // Initialize accelerometer graph
        const graphCanvas = document.getElementById('accel-graph') as HTMLCanvasElement | null;
        if (graphCanvas) {
            this.accelGraph = new AccelGraph(graphCanvas, { historyLength: 360, minG: -2, maxG: 2 });
            window.addEventListener('resize', () => this.accelGraph?.resize());
        }
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Start the render loop
        this.animate();

        // Restore persisted base rotation after model is ready
        this.restoreBaseRotation();
    }

    private setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        this.calibrateBtn.addEventListener('click', () => this.handleCalibrate());
        this.resetBtn.addEventListener('click', () => this.handleReset());
        this.smoothingSlider.addEventListener('input', () => this.handleSmoothingChange());
        this.baseRotXSlider.addEventListener('input', () => this.handleBaseRotationChange());
        this.baseRotYSlider.addEventListener('input', () => this.handleBaseRotationChange());
        this.baseRotZSlider.addEventListener('input', () => this.handleBaseRotationChange());
        
        this.serialManager.on('connected', () => {
            this.statusEl.textContent = 'Connected';
            this.statusEl.className = 'status connected';
            this.connectBtn.textContent = 'Disconnect';
            this.calibrateBtn.disabled = false;
        });
        
        this.serialManager.on('disconnected', () => {
            this.statusEl.textContent = 'Disconnected';
            this.statusEl.className = 'status disconnected';
            this.connectBtn.textContent = 'Connect to ESP32S3';
            this.calibrateBtn.disabled = true;
            this.accelGraph?.clear();
        });
        
        this.serialManager.on('data', (data: SensorData) => {
            this.handleSensorData(data);
        });
        
        this.serialManager.on('error', (error: Error) => {
            console.error('Serial error:', error);
            this.statusEl.textContent = `Error: ${error.message}`;
            this.statusEl.className = 'status disconnected';
            this.calibrateBtn.disabled = true;
        });
    }

    private async handleConnect() {
        if (this.serialManager.isConnected) {
            await this.serialManager.disconnect();
        } else {
            await this.serialManager.connect();
        }
    }

    private handleCalibrate() {
        if (this.pcbModel && this.latestSensorData) {
            this.pcbModel.calibrateReference(this.latestSensorData.accel);
        }
    }

    private handleReset() {
        if (this.pcbModel) {
            this.pcbModel.resetOrientation();
        }
    }

    private handleSmoothingChange() {
        const value = parseInt(this.smoothingSlider.value) / 100; // Convert 0-50 to 0-0.5
        this.smoothingValueSpan.textContent = value.toFixed(2);
        if (this.pcbModel) {
            this.pcbModel.setSmoothingFactor(value);
        }
    }

    private handleBaseRotationChange() {
        // Quantize to 90° steps to avoid drift and ensure orthogonal base
        const quantize = (v: number) => Math.round(v / 90) * 90;
        const x = quantize(parseInt(this.baseRotXSlider.value) || 0);
        const y = quantize(parseInt(this.baseRotYSlider.value) || 0);
        const z = quantize(parseInt(this.baseRotZSlider.value) || 0);
        // Reflect quantized values to sliders to snap UI
        this.baseRotXSlider.value = String(x);
        this.baseRotYSlider.value = String(y);
        this.baseRotZSlider.value = String(z);
        this.baseRotXValue.textContent = `${x}°`;
        this.baseRotYValue.textContent = `${y}°`;
        this.baseRotZValue.textContent = `${z}°`;
        if (this.pcbModel) {
            this.pcbModel.setBaseRotationDegrees(x, y, z);
        }
        localStorage.setItem('baseRotation', JSON.stringify({ x, y, z }));
    }

    private restoreBaseRotation() {
        try {
            const saved = localStorage.getItem('baseRotation');
            if (!saved) return;
            const { x, y, z } = JSON.parse(saved);
            this.baseRotXSlider.value = String(Math.round(x));
            this.baseRotYSlider.value = String(Math.round(y));
            this.baseRotZSlider.value = String(Math.round(z));
            this.handleBaseRotationChange();
        } catch {
            // ignore
        }
    }

    private handleSensorData(data: SensorData) {
        // Store latest sensor data for calibration
        this.latestSensorData = data;
        
        // Update UI elements
        document.getElementById('accel-x')!.textContent = data.accel.x.toFixed(3);
        document.getElementById('accel-y')!.textContent = data.accel.y.toFixed(3);
        document.getElementById('accel-z')!.textContent = data.accel.z.toFixed(3);
        
        document.getElementById('gyro-x')!.textContent = data.gyro.x.toFixed(2);
        document.getElementById('gyro-y')!.textContent = data.gyro.y.toFixed(2);
        document.getElementById('gyro-z')!.textContent = data.gyro.z.toFixed(2);
        
        document.getElementById('temperature')!.textContent = data.temperature.toFixed(1);
        
        // Update 3D model orientation with accelerometer data only
        if (this.pcbModel) {
            this.pcbModel.updateOrientation(data.accel);
        }

        // Feed graph
        this.accelGraph?.addPoint(data.accel);
    }

    private animate() {
        requestAnimationFrame(() => this.animate());
        this.sceneManager.render();
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AccelerometerApp();
});