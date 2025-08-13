import { SensorData } from "./sensor-types";

interface WebSerialEvents {
    connected: () => void;
    disconnected: () => void;
    data: (data: SensorData) => void;
    deviceError: (message: string) => void;
    rawLine: (line: string) => void;
    error: (error: Error) => void;
}

export class WebSerialManager {
    constructor() {
        // Listen for device unplug/reset events so UI updates when connection is lost unexpectedly
        if (WebSerialManager.isSupported()) {
            try {
                (navigator as unknown as { serial: { addEventListener: (type: string, listener: (e: unknown) => void) => void } }).serial.addEventListener('disconnect', (event: unknown) => {
                    const evt = event as { port?: SerialPort } | undefined;
                    // Only react if the disconnected port is the one we are using
                    if (this.port && evt?.port === this.port) {
                        // Perform cleanup and notify listeners
                        void this.cleanUpAndEmitDisconnectedIfNeeded();
                    }
                });
            } catch {
                // Best-effort; older browsers may not support the event
            }
        }
    }
    static isSupported(): boolean {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }

    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private decoder = new TextDecoder();
    private encoder = new TextEncoder();
    private buffer = '';
    private eventListeners: { [K in keyof WebSerialEvents]?: WebSerialEvents[K][] } = {};

    get isConnected(): boolean {
        return this.port !== null && this.port.readable !== null;
    }

    async sendCommand(command: string): Promise<void> {
        try {
            if (!this.isConnected || !this.port?.writable) {
                throw new Error('Serial port not connected');
            }
            const writer = this.port.writable.getWriter();
            try {
                const payload = this.encoder.encode(`${command}\n`);
                await writer.write(payload);
            } finally {
                writer.releaseLock();
            }
        } catch (error) {
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    on<K extends keyof WebSerialEvents>(event: K, callback: WebSerialEvents[K]) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event]!.push(callback);
    }

    private emit<K extends keyof WebSerialEvents>(event: K, ...args: Parameters<WebSerialEvents[K]>) {
        if (this.eventListeners[event]) {
            this.eventListeners[event]!.forEach(callback => {
                (callback as (...args: Parameters<WebSerialEvents[K]>) => void)(...args);
            });
        }
    }

    async connect() {
        try {
            if (!WebSerialManager.isSupported()) {
                throw new Error('WebSerial API not supported in this browser. Use Chrome or Edge over HTTPS/localhost.');
            }

            if (this.isConnected) {
                return; // already connected
            }

            // Request access to serial port
            this.port = await navigator.serial.requestPort();
            
            // Open the port with ESP32S3 settings
            await this.port.open({ 
                baudRate: 460800,
                dataBits: 8,
                stopBits: 1,
                parity: 'none'
            });

            this.reader = this.port.readable!.getReader();

            this.emit('connected');
            this.startReading();
            
        } catch (error) {
            console.error('Failed to connect:', error);
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    async disconnect() {
        try {
            await this.cleanUpAndEmitDisconnectedIfNeeded(true);
        } catch (error) {
            console.error('Failed to disconnect:', error);
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        }
    }

    private async startReading() {
        try {
            while (this.reader && this.isConnected) {
                const { value, done } = await this.reader.read();
                
                if (done) break;
                
                // Convert bytes to string and add to buffer
                const chunk = this.decoder.decode(value, { stream: true });
                this.buffer += chunk;
                
                // Process complete lines
                const lines = this.buffer.split('\n');
                this.buffer = lines.pop() || ''; // Keep incomplete line in buffer
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) continue;
                    this.emit('rawLine', trimmed);
                    this.processLine(trimmed);
                }
            }
        } catch (error) {
            console.error('Reading error:', error);
            this.emit('error', error instanceof Error ? error : new Error(String(error)));
        } finally {
            // If the stream closed or errored unexpectedly, ensure cleanup and UI update
            await this.cleanUpAndEmitDisconnectedIfNeeded();
        }
    }

    private async cleanUpAndEmitDisconnectedIfNeeded(forceEmit: boolean = false) {
        const hadResources = this.reader !== null || this.port !== null;
        try {
            if (this.reader) {
                try { await this.reader.cancel(); } catch { /* ignore cancel errors */ }
                try { this.reader.releaseLock(); } catch { /* ignore release errors */ }
                this.reader = null;
            }
        } catch { /* ignore cleanup errors */ }
        try {
            if (this.port) {
                try { await this.port.close(); } catch { /* ignore close errors */ }
                this.port = null;
            }
        } catch { /* ignore cleanup errors */ }
        if (forceEmit || hadResources) {
            this.emit('disconnected');
        }
    }

    private processLine(line: string) {
            // Parse ESP32S3 JSON sensor output format:
            // {"accel":{"x":0.123,"y":0.456,"z":0.789},"gyro":{"x":1.23,"y":4.56,"z":7.89},"temp":25.4,"euler":{"roll":..,"pitch":..,"yaw":..},"t":123.456}
        
        // Skip empty lines or lines that don't look like JSON
        if (!line.trim() || !line.includes('{') || !line.includes('}')) {
            return;
        }

            try {
            const jsonData = JSON.parse(line.trim());
            
            // Validate JSON structure
            if (jsonData.accel && jsonData.gyro && jsonData.gyroInt && jsonData.fusion && typeof jsonData.temp === 'number') {
                const sensorData: SensorData = {
                    accel: {
                        x: jsonData.accel.x,
                        y: jsonData.accel.y,
                        z: jsonData.accel.z
                    },
                    gyro: {
                        x: jsonData.gyro.x,
                        y: jsonData.gyro.y,
                        z: jsonData.gyro.z
                    },
                    gyroInt: {
                        roll: jsonData.gyroInt.roll,
                        pitch: jsonData.gyroInt.pitch,
                        yaw: jsonData.gyroInt.yaw
                    },
                    fusion: {
                        roll: jsonData.fusion.roll,
                        pitch: jsonData.fusion.pitch,
                        yaw: jsonData.fusion.yaw
                    },
                    temperature: jsonData.temp,
                    t: jsonData.t
                };
                this.emit('data', sensorData);
            } else if (typeof jsonData.error === 'string') {
                // Valid JSON error object: {"error":"..."}
                this.emit('deviceError', jsonData.error);
            } else {
                console.warn('Invalid JSON structure:', jsonData);
            }
        } catch {
            console.log("Non-JSON line:", line);
        }
    }
}