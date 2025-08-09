export interface SensorData {
    accel: { x: number; y: number; z: number };
    gyro: { x: number; y: number; z: number };
    temperature: number;
    euler?: { roll: number; pitch: number; yaw: number };
}

interface WebSerialEvents {
    connected: () => void;
    disconnected: () => void;
    data: (data: SensorData) => void;
    error: (error: Error) => void;
}

export class WebSerialManager {
    constructor() {
        // Listen for device unplug/reset events so UI updates when connection is lost unexpectedly
        if (WebSerialManager.isSupported()) {
            try {
                (navigator as any).serial.addEventListener('disconnect', (event: any) => {
                    // Only react if the disconnected port is the one we are using
                    if (this.port && event?.port === this.port) {
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
    private buffer = '';
    private eventListeners: { [K in keyof WebSerialEvents]?: WebSerialEvents[K][] } = {};

    get isConnected(): boolean {
        return this.port !== null && this.port.readable !== null;
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
                baudRate: 115200,
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
                    this.processLine(line.trim());
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
                try { await this.reader.cancel(); } catch {}
                try { this.reader.releaseLock(); } catch {}
                this.reader = null;
            }
        } catch {}
        try {
            if (this.port) {
                try { await this.port.close(); } catch {}
                this.port = null;
            }
        } catch {}
        if (forceEmit || hadResources) {
            this.emit('disconnected');
        }
    }

    private processLine(line: string) {
        // Parse ESP32S3 JSON sensor output format:
        // {"accel":{"x":0.123,"y":0.456,"z":0.789},"gyro":{"x":1.23,"y":4.56,"z":7.89},"temp":25.4}
        
        // Skip empty lines or lines that don't look like JSON
        if (!line.trim() || !line.includes('{') || !line.includes('}')) {
            return;
        }

        try {
            const jsonData = JSON.parse(line.trim());
            
            // Validate JSON structure
            if (jsonData.accel && jsonData.gyro && typeof jsonData.temp === 'number') {
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
                    temperature: jsonData.temp,
                    euler: jsonData.euler
                };

                this.emit('data', sensorData);
            } else {
                console.warn('Invalid JSON structure:', jsonData);
            }
        } catch {
            // Silently ignore non-JSON lines (could be debug output during startup)
            // console.warn('Failed to parse JSON sensor data:', error, 'Line:', line);
        }
    }
}