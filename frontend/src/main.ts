import { WebSerialManager } from './webserial';
import { SensorData } from './sensor-types';
import { WebBLEManager } from './webble';
import { SceneManager } from './scene';
import { PCBModel } from './pcb-model';
import { AccelGraph } from './graph';

class AccelerometerApp {
    private serialManager: WebSerialManager;
    private bleManager: WebBLEManager | null = null;
    private sceneManager: SceneManager;
    private pcbModel: PCBModel | null = null;
    private connectBtn: HTMLButtonElement;
    private connectBLEBtn!: HTMLButtonElement;
    private themeToggleSwitch!: HTMLInputElement;
    private statusEl: HTMLElement;
    
    private smoothingSlider: HTMLInputElement;
    private smoothingValueSpan: HTMLSpanElement;
    
    
    private modelFileInput!: HTMLInputElement;
    private modelFileButton!: HTMLButtonElement;
    private modelFileNameSpan!: HTMLSpanElement;
    private accelGraph: AccelGraph
    private gyroGraph: AccelGraph
    private fusionGraph: AccelGraph
    private gyroIntGraph: AccelGraph
    private tempGraph: AccelGraph

    // Orientation mode state
    private mode: 'accel' | 'gyro' | 'fusion' = 'accel';
    private prevDeviceTimeSec: number | null = null; // previous packet device time (seconds)
    // Separate device time for always-on integrated gyro display
    private resetGyroBtn!: HTMLButtonElement;
    private modeAccelRadio!: HTMLInputElement;
    private modeGyroRadio!: HTMLInputElement;
    private modeFusionRadio!: HTMLInputElement;
    private smoothingGroupEl!: HTMLElement;
    private msgRateEl!: HTMLElement;
    private msgTimestamps: number[] = [];
    private deviceErrorEl!: HTMLElement

    constructor() {
        this.serialManager = new WebSerialManager();
        this.sceneManager = new SceneManager();
        
        this.connectBtn = document.getElementById('connect-btn') as HTMLButtonElement;
        this.statusEl = document.getElementById('connection-status') as HTMLElement;
        this.msgRateEl = document.getElementById('message-rate') as HTMLElement;
        // Create or reference an error display under status
        this.deviceErrorEl = document.getElementById('device-error') as HTMLElement;
        const el = document.createElement('div');
        el.id = 'device-error';
        el.className = 'status disconnected';
        el.style.marginTop = '6px';
        el.style.display = 'none';
        const statusParent = this.statusEl.parentElement;
        if (statusParent) {
            statusParent.insertBefore(el, statusParent.children[statusParent.children.length - 1] || null);
        }
        this.deviceErrorEl = el;
        
        this.smoothingSlider = document.getElementById('smoothing-slider') as HTMLInputElement;
        this.smoothingValueSpan = document.getElementById('smoothing-value') as HTMLSpanElement;
        
        
        this.modelFileInput = document.getElementById('model-file') as HTMLInputElement;
        this.modelFileButton = document.getElementById('model-file-btn') as HTMLButtonElement;
        this.modelFileNameSpan = document.getElementById('model-file-name') as HTMLSpanElement;
        this.themeToggleSwitch = document.getElementById('theme-toggle-switch') as HTMLInputElement;

        // Initialize accelerometer, gyro, fusion, integrated gyro, and temperature graphs
        const accelCanvas = document.getElementById('accel-graph') as HTMLCanvasElement;
        this.accelGraph = new AccelGraph(accelCanvas, { historyLength: 360, minValue: -2, maxValue: 2, unitLabel: 'g', title: 'Accelerometer (g)', seriesLabels: ['X','Y','Z'] });
        const gyroCanvas = document.getElementById('gyro-graph') as HTMLCanvasElement;
        this.gyroGraph = new AccelGraph(gyroCanvas, { historyLength: 360, minValue: -250, maxValue: 250, unitLabel: '°/s', title: 'Gyroscope (°/s)', seriesLabels: ['X','Y','Z'] });
        const fusionCanvas = document.getElementById('fusion-graph') as HTMLCanvasElement;
        this.fusionGraph = new AccelGraph(fusionCanvas, { historyLength: 360, minValue: -180, maxValue: 180, unitLabel: '°', title: 'Fusion (°)', seriesLabels: ['Roll','Pitch','Yaw'] });
        const gyroIntCanvas = document.getElementById('gyro-int-graph') as HTMLCanvasElement;
        this.gyroIntGraph = new AccelGraph(gyroIntCanvas, { historyLength: 360, minValue: -180, maxValue: 180, unitLabel: '°', title: 'Gyro Integrated (°)', seriesLabels: ['Roll','Pitch','Yaw'] });
        const tempCanvas = document.getElementById('temp-graph') as HTMLCanvasElement;
        this.tempGraph = new AccelGraph(tempCanvas, { historyLength: 360, minValue: 15, maxValue: 30, unitLabel: '°C', title: 'Temperature (°C)', seriesLabels: ['Temp'], autoscale: true, autoscalePadding: 0.1, minSpan: 5 });

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

        window.addEventListener('resize', () => {
            this.accelGraph.resize();
            this.gyroGraph.resize();
            this.fusionGraph.resize();
            this.gyroIntGraph.resize();
            this.tempGraph.resize();
        });
        
        // Set up event listeners
        this.setupEventListeners();
        this.setupBLEIfAvailable();
        
        // Start the render loop
        this.animate();

        
    }

    private setupEventListeners() {
        this.connectBtn.addEventListener('click', () => this.handleConnect());
        if (this.themeToggleSwitch) {
            const icon = document.getElementById('theme-icon');
            // Default to dark mode visually and in scene
            this.themeToggleSwitch.checked = false;
            this.sceneManager.setSkyEnabled(false);
            if (icon) icon.textContent = '🌙';
            this.themeToggleSwitch.addEventListener('change', () => {
                const enabled = this.themeToggleSwitch.checked;
                this.sceneManager.setSkyEnabled(enabled);
                if (icon) icon.textContent = enabled ? '☀️' : '🌙';
            });
        }
        
        this.smoothingSlider.addEventListener('input', () => this.handleSmoothingChange());
        
        
        this.modelFileInput.addEventListener('change', (e) => this.handleModelFileChange(e));
        this.modelFileButton.addEventListener('click', () => this.modelFileInput.click());

        // Mode radio buttons
        this.modeAccelRadio = document.getElementById('mode-accel') as HTMLInputElement;
        this.modeGyroRadio = document.getElementById('mode-gyro') as HTMLInputElement;
        this.resetGyroBtn = document.getElementById('reset-gyro') as HTMLButtonElement;
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
                    this.prevDeviceTimeSec = null;
                    // Disable smoothing UI in gyro mode
                    this.smoothingSlider.disabled = true;
                    if (this.smoothingGroupEl) this.smoothingGroupEl.style.opacity = '0.5';
                }
            });
        }
        this.modeFusionRadio = document.getElementById('mode-fusion') as HTMLInputElement;
        if (this.modeFusionRadio) {
            this.modeFusionRadio.addEventListener('change', () => {
                if (this.modeFusionRadio.checked) {
                    this.mode = 'fusion';
                    // Disable smoothing UI in fusion mode (handled by AHRS)
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
        this.resetGyroBtn.addEventListener('click', () => {
            this.prevDeviceTimeSec = null;
            if (!this.pcbModel) return;
            // Always reset the integrated gyro orientation (display)
            // TODO this.pcbModel.resetIntegratedGyro();
            // If in gyro mode, also reset the model orientation to identity
            if (this.mode === 'gyro') {
                this.pcbModel.resetModelOrientation();
            }
            // Send RESET_GYRO to device over whichever transport is connected
            void (async () => {
                try {
                    if (this.serialManager.isConnected) {
                        await this.serialManager.sendCommand('RESET_GYRO');
                    }
                    if (this.bleManager && this.bleManager.isConnected) {
                        await this.bleManager.sendCommand('RESET_GYRO');
                    }
                } catch (e) {
                    console.warn('Failed to send RESET_GYRO:', e);
                }
            })();
        });
        
        this.serialManager.on('connected', () => {
            this.statusEl.textContent = 'Connected';
            this.statusEl.className = 'status connected';
            this.connectBtn.textContent = 'Disconnect';
            // Reset message rate window on new connection
            this.msgTimestamps = [];
            if (this.msgRateEl) this.msgRateEl.textContent = 'Msgs/s: 0';
            if (this.deviceErrorEl) {
                this.deviceErrorEl.style.display = 'none';
                this.deviceErrorEl.textContent = '';
            }
            // Reset timing so first dt is sane
            this.prevDeviceTimeSec = null;
            
        });
        
        this.serialManager.on('disconnected', () => {
            this.statusEl.textContent = 'Disconnected';
            this.statusEl.className = 'status disconnected';
            this.connectBtn.textContent = 'Connect via WebSerial';
            // Clear message rate on disconnect
            this.msgTimestamps = [];
            if (this.msgRateEl) this.msgRateEl.textContent = 'Msgs/s: 0';
            if (this.deviceErrorEl) {
                this.deviceErrorEl.style.display = 'none';
                this.deviceErrorEl.textContent = '';
            }
            
            this.accelGraph.clear();
            this.gyroGraph.clear();
            this.fusionGraph.clear();
            this.gyroIntGraph.clear();
            this.tempGraph.clear();
            // Avoid large integration step on next connect
            this.prevDeviceTimeSec = null;
        });
        
        this.serialManager.on('data', (data: SensorData) => {
            this.handleSensorData(data);
        });
        this.serialManager.on('rawLine', () => {
            // ignore raw lines
        });
        this.serialManager.on('deviceError', (message: string) => {
            if (this.deviceErrorEl) {
                this.deviceErrorEl.textContent = `Device error: ${message}`;
                this.deviceErrorEl.style.display = 'block';
                this.deviceErrorEl.className = 'status disconnected';
            }
        });
        
        this.serialManager.on('error', (error: Error) => {
            console.error('Serial error:', error);
            this.statusEl.textContent = `Error: ${error.message}`;
            this.statusEl.className = 'status disconnected';
        });
    }

    private setupBLEIfAvailable() {
        const btn = document.getElementById('connect-ble-btn') as HTMLButtonElement | null;
        if (!btn) return;
        this.connectBLEBtn = btn;
        if (!WebBLEManager.isSupported()) {
            this.connectBLEBtn.disabled = true;
            this.connectBLEBtn.textContent = 'WebBLE not supported';
            return;
        }
        this.bleManager = new WebBLEManager();
        this.connectBLEBtn.addEventListener('click', () => this.handleBLEConnect());
        this.bleManager.on('connected', () => {
            this.statusEl.textContent = 'Connected (BLE)';
            this.statusEl.className = 'status connected';
            this.connectBLEBtn.textContent = 'Disconnect BLE';
            this.msgTimestamps = [];
            this.msgRateEl.textContent = 'Msgs/s: 0';
            this.deviceErrorEl.style.display = 'none';
            this.deviceErrorEl.textContent = '';
            // Notifications are used for higher throughput; no polling needed
            // Reset timing so first dt is sane
            this.prevDeviceTimeSec = null;
        });
        this.bleManager.on('disconnected', () => {
            this.statusEl.textContent = 'Disconnected';
            this.statusEl.className = 'status disconnected';
            this.connectBLEBtn.textContent = 'Connect via WebBLE';
            this.msgTimestamps = [];
            this.msgRateEl.textContent = 'Msgs/s: 0';
            this.accelGraph.clear();
            this.gyroGraph.clear();
            this.fusionGraph.clear();
            this.gyroIntGraph.clear();
            this.tempGraph.clear();
            this.prevDeviceTimeSec = null;
        });
        this.bleManager.on('data', (data: SensorData) => this.handleSensorData(data));
        this.bleManager.on('error', (error: Error) => {
            console.error('BLE error:', error);
            this.statusEl.textContent = `Error: ${error.message}`;
            this.statusEl.className = 'status disconnected';
        });
    }

    private blePollTimer: number | null = null;

    private async handleBLEConnect() {
        if (!this.bleManager) return;
        if (this.bleManager.isConnected) {
            if (this.blePollTimer !== null) {
                window.clearInterval(this.blePollTimer);
                this.blePollTimer = null;
            }
            await this.bleManager.disconnect();
        } else {
            await this.bleManager.connect();
        }
    }

    private async handleConnect() {
        if (this.serialManager.isConnected) {
            await this.serialManager.disconnect();
        } else {
            await this.serialManager.connect();
        }
    }

    

    private handleSmoothingChange() {
        // Map slider 0..100 to time constant in ms on a log scale ~ [5 ms, 2000 ms]
        const slider = parseInt(this.smoothingSlider.value, 10);
        const minMs = 5;
        const maxMs = 2000;
        const t = slider / 100; // 0..1
        const tauMs = Math.round(minMs * Math.pow(maxMs / minMs, t));
        this.smoothingValueSpan.textContent = `~${tauMs} ms`;
        if (this.pcbModel) {
            this.pcbModel.setSmoothingTimeConstantMs(tauMs);
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
        // Update message rate using a 1s sliding window based on device time
        const nowSec = isFinite(data.t) ? data.t : (this.msgTimestamps.length ? this.msgTimestamps[this.msgTimestamps.length - 1] : 0);
        this.msgTimestamps.push(nowSec);
        const oneSecondAgo = nowSec - 1;
        // Remove old timestamps
        while (this.msgTimestamps.length && this.msgTimestamps[0] < oneSecondAgo) {
            this.msgTimestamps.shift();
        }
        if (this.msgRateEl) {
            this.msgRateEl.textContent = `Msgs/s: ${this.msgTimestamps.length.toString()}`;
        }

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
            // Compute dt strictly from device absolute time
            const prev = this.prevDeviceTimeSec;
            this.prevDeviceTimeSec = isFinite(data.t) ? data.t : null;
            const dt = prev != null && isFinite(data.t) ? Math.max(0, data.t - prev) : 0;
            if (this.mode === 'accel') {
                this.pcbModel.updateOrientationFromAccel(data.accel, dt);
            } else if (this.mode === 'gyro') {
                this.pcbModel.updateOrientationFromEuler(data.gyroInt, dt);
            } else if (this.mode === 'fusion') {
                if (data.fusion) {
                    this.pcbModel.updateOrientationFromEuler(data.fusion, dt);
                }
            }
        }

        // Feed graphs
        this.accelGraph.addPoint(data.accel);
        this.gyroGraph.addPoint(data.gyro);
        // Always integrate gyro for a separate display regardless of mode
        if (data.gyroInt) {
            const r = document.getElementById('gyro-int-roll');
            const p = document.getElementById('gyro-int-pitch');
            const y = document.getElementById('gyro-int-yaw');
            const ir = this.normalize180(data.gyroInt.roll);
            const ip = this.normalize180(data.gyroInt.pitch);
            const iy = this.normalize180(data.gyroInt.yaw);
            if (r && p && y) {
                r.textContent = ir.toFixed(1);
                p.textContent = ip.toFixed(1);
                y.textContent = iy.toFixed(1);
            }
            this.gyroIntGraph.addPoint({ x: ir, y: ip, z: iy });
        }
        // Temperature (raw)
        document.getElementById('temperature')!.textContent = data.temperature.toFixed(1);
        this.tempGraph.addPoint({ x: data.temperature, y: 0, z: 0 });
        if (data.fusion) {
            const r = data.fusion.roll;
            const p = data.fusion.pitch;
            const y = data.fusion.yaw;
            // Graph expects values within [-180, 180); normalize so X/Z are not pegged at range limits
            const gr = this.normalize180(r);
            const gp = this.normalize180(p);
            const gy = this.normalize180(y);
            this.fusionGraph?.addPoint({ x: gr, y: gp, z: gy });
            const fr = document.getElementById('fusion-roll');
            const fp = document.getElementById('fusion-pitch');
            const fy = document.getElementById('fusion-yaw');
            if (fr && fp && fy) {
                fr.textContent = gr.toFixed(1);
                fp.textContent = gp.toFixed(1);
                fy.textContent = gy.toFixed(1);
            }
        }
    }

    private normalize180(deg: number): number {
        const x = (deg + 180) % 360;
        return x < 0 ? x + 360 - 180 : x - 180;
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