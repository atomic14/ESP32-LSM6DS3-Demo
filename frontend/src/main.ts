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

        
    }

    private setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        
        this.smoothingSlider.addEventListener('input', () => this.handleSmoothingChange());
        
        this.modelFileInput.addEventListener('change', (e) => this.handleModelFileChange(e));
        this.modelFileButton.addEventListener('click', () => this.modelFileInput.click());
        
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
        const value = parseInt(this.smoothingSlider.value) / 100; // Convert 0-50 to 0-0.5
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