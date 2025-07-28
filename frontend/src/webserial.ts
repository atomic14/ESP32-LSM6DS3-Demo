export interface SensorData {
    accel: { x: number; y: number; z: number };
    gyro: { x: number; y: number; z: number };
    temperature: number;
}

export class WebSerialManager {
    private port: SerialPort | null = null;
    private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
    private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
    private decoder = new TextDecoder();
    private buffer = '';
    private eventListeners: { [key: string]: Function[] } = {};

    get isConnected(): boolean {
        return this.port !== null && this.port.readable !== null;
    }

    on(event: string, callback: Function) {
        if (!this.eventListeners[event]) {
            this.eventListeners[event] = [];
        }
        this.eventListeners[event].push(callback);
    }

    private emit(event: string, data?: any) {
        if (this.eventListeners[event]) {
            this.eventListeners[event].forEach(callback => callback(data));
        }
    }

    async connect() {
        try {
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
            this.writer = this.port.writable!.getWriter();

            this.emit('connected');
            this.startReading();
            
        } catch (error) {
            console.error('Failed to connect:', error);
            this.emit('error', error);
        }
    }

    async disconnect() {
        try {
            if (this.reader) {
                await this.reader.cancel();
                this.reader.releaseLock();
                this.reader = null;
            }

            if (this.writer) {
                this.writer.releaseLock();
                this.writer = null;
            }

            if (this.port) {
                await this.port.close();
                this.port = null;
            }

            this.emit('disconnected');
        } catch (error) {
            console.error('Failed to disconnect:', error);
            this.emit('error', error);
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
            this.emit('error', error);
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
                    temperature: jsonData.temp
                };

                this.emit('data', sensorData);
            } else {
                console.warn('Invalid JSON structure:', jsonData);
            }
        } catch (error) {
            // Silently ignore non-JSON lines (could be debug output during startup)
            // console.warn('Failed to parse JSON sensor data:', error, 'Line:', line);
        }
    }
}