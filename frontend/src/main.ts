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
    
    private smoothingSlider: HTMLInputElement;
    private smoothingValueSpan: HTMLSpanElement;
    
    private modelFileInput!: HTMLInputElement;
    private modelFileButton!: HTMLButtonElement;
    private modelFileNameSpan!: HTMLSpanElement;
    private accelGraph: AccelGraph | null = null;
    private gyroGraph: AccelGraph | null = null;

    // Orientation mode state
    private mode: 'accel' | 'gyro' = 'accel';
    private lastTimestampMs: number | null = null;
    private resetBtn!: HTMLButtonElement;
    private modeAccelRadio!: HTMLInputElement;
    private modeGyroRadio!: HTMLInputElement;
    private smoothingGroupEl!: HTMLElement;

    constructor() {
        this.serialManager = new WebSerialManager();
        this.sceneManager = new SceneManager();
        
        this.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
        this.statusEl = document.getElementById('connection-status') as HTMLElement;
        
        this.smoothingSlider = document.getElementById('smoothing-slider') as HTMLInputElement;
        this.smoothingValueSpan = document.getElementById('smoothing-value') as HTMLSpanElement;
        
        this.modelFileInput = document.getElementById('model-file') as HTMLInputElement;
        this.modelFileButton = document.getElementById('model-file-btn') as HTMLButtonElement;
        this.modelFileNameSpan = document.getElementById('model-file-name') as HTMLSpanElement;

        this.init();
    }

    private async init() {
        // Initialize the 3D scene
        await this.sceneManager.init();
        
        // Load the PCB model
        this.pcbModel = new PCBModel(this.sceneManager.scene);
        await this.pcbModel.load('/pcb.glb');

        // Initialize smoothing UI/model linkage
        this.handleSmoothingChange();

        // Initialize accelerometer and gyro graphs
        const accelCanvas = document.getElementById('accel-graph') as HTMLCanvasElement | null;
        if (accelCanvas) {
            this.accelGraph = new AccelGraph(accelCanvas, { historyLength: 360, minValue: -2, maxValue: 2, unitLabel: 'g', title: 'Accelerometer (g)' });
        }
        const gyroCanvas = document.getElementById('gyro-graph') as HTMLCanvasElement | null;
        if (gyroCanvas) {
            this.gyroGraph = new AccelGraph(gyroCanvas, { historyLength: 360, minValue: -500, maxValue: 500, unitLabel: '°/s', title: 'Gyroscope (°/s)' });
        }
        window.addEventListener('resize', () => {
            this.accelGraph?.resize();
            this.gyroGraph?.resize();
        });
        
        // Set up event listeners
        this.setupEventListeners();
        
        // Start the render loop
        this.animate();

        
    }

    private setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        
        this.smoothingSlider.addEventListener('input', () => this.handleSmoothingChange());
        
        this.modelFileInput.addEventListener('change', (e) => this.handleModelFileChange(e));
        this.modelFileButton.addEventListener('click', () => this.modelFileInput.click());

        // Mode radio buttons
        this.modeAccelRadio = document.getElementById('mode-accel') as HTMLInputElement;
        this.modeGyroRadio = document.getElementById('mode-gyro') as HTMLInputElement;
        const resetBtn = document.getElementById('reset-orientation') as HTMLButtonElement | null;
        if (resetBtn) this.resetBtn = resetBtn;
        this.smoothingGroupEl = document.getElementById('smoothing-group') as HTMLElement;
        
        if (this.modeAccelRadio) {
            this.modeAccelRadio.addEventListener('change', () => {
                if (this.modeAccelRadio.checked) {
                    this.mode = 'accel';
                    // Enable smoothing UI in accel mode
                    this.smoothingSlider.disabled = false;
                    if (this.smoothingGroupEl) this.smoothingGroupEl.style.opacity = '1';
                    this.handleSmoothingChange();
                }
            });
        }
        if (this.modeGyroRadio) {
            this.modeGyroRadio.addEventListener('change', () => {
                if (this.modeGyroRadio.checked) {
                    this.mode = 'gyro';
                    // Reset timing so first dt is not huge
                    this.lastTimestampMs = null;
                    // Disable smoothing UI in gyro mode
                    this.smoothingSlider.disabled = true;
                    if (this.smoothingGroupEl) this.smoothingGroupEl.style.opacity = '0.5';
                }
            });
        }
        // Initialize smoothing UI state based on initially selected mode
        if (this.modeGyroRadio && this.modeGyroRadio.checked) {
            this.smoothingSlider.disabled = true;
            if (this.smoothingGroupEl) this.smoothingGroupEl.style.opacity = '0.5';
        } else {
            this.smoothingSlider.disabled = false;
            if (this.smoothingGroupEl) this.smoothingGroupEl.style.opacity = '1';
        }
        if (this.resetBtn) {
            this.resetBtn.addEventListener('click', () => {
                this.lastTimestampMs = null;
                this.pcbModel?.resetOrientation();
            });
        }
        
        this.serialManager.on('connected', () => {
            this.statusEl.textContent = 'Connected';
            this.statusEl.className = 'status connected';
            this.connectBtn.textContent = 'Disconnect';
            
        });
        
        this.serialManager.on('disconnected', () => {
            this.statusEl.textContent = 'Disconnected';
            this.statusEl.className = 'status disconnected';
            this.connectBtn.textContent = 'Connect to ESP32S3';
            
            this.accelGraph?.clear();
            this.gyroGraph?.clear();
            // Avoid large integration step on next connect
            this.lastTimestampMs = null;
        });
        
        this.serialManager.on('data', (data: SensorData) => {
            this.handleSensorData(data);
        });
        
        this.serialManager.on('error', (error: Error) => {
            console.error('Serial error:', error);
            this.statusEl.textContent = `Error: ${error.message}`;
            this.statusEl.className = 'status disconnected';
        });
    }

    private async handleConnect() {
        if (this.serialManager.isConnected) {
            await this.serialManager.disconnect();
        } else {
            await this.serialManager.connect();
        }
    }

    

    private handleSmoothingChange() {
        const value = parseInt(this.smoothingSlider.value, 10) / 100; // Convert 0-50 to 0-0.5
        this.smoothingValueSpan.textContent = value.toFixed(2);
        if (this.pcbModel) {
            this.pcbModel.setSmoothingFactor(value);
        }
    }

    

    private async handleModelFileChange(event: Event) {
        const input = event.target as HTMLInputElement;
        const file = input.files && input.files[0];
        if (!file) return;
        if (!this.pcbModel) return;
        try {
            await this.pcbModel.loadFromFile(file);
            this.modelFileNameSpan.textContent = file.name;
        } catch (err) {
            console.error('Failed to load custom model:', err);
        }
    }

    private handleSensorData(data: SensorData) {
        // Update UI elements
        document.getElementById('accel-x')!.textContent = data.accel.x.toFixed(3);
        document.getElementById('accel-y')!.textContent = data.accel.y.toFixed(3);
        document.getElementById('accel-z')!.textContent = data.accel.z.toFixed(3);
        
        document.getElementById('gyro-x')!.textContent = data.gyro.x.toFixed(2);
        document.getElementById('gyro-y')!.textContent = data.gyro.y.toFixed(2);
        document.getElementById('gyro-z')!.textContent = data.gyro.z.toFixed(2);
        
        document.getElementById('temperature')!.textContent = data.temperature.toFixed(1);
        
        // Update 3D model orientation based on selected mode
        if (this.pcbModel) {
            if (this.mode === 'accel') {
                this.pcbModel.updateOrientationFromAccel(data.accel);
                // Reset dt anchor so switching back to gyro doesn't integrate a large gap
                this.lastTimestampMs = performance.now();
            } else {
                const now = performance.now();
                const dt = this.lastTimestampMs == null ? 0 : (now - this.lastTimestampMs) / 1000;
                this.lastTimestampMs = now;
                this.pcbModel.updateOrientationFromGyro(data.gyro, dt);
            }
        }

        // Feed graphs
        this.accelGraph?.addPoint(data.accel);
        this.gyroGraph?.addPoint(data.gyro);
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