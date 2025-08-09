import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class PCBModel {
    private scene: THREE.Scene;
    private model: THREE.Group | null = null;
    private quaternion = new THREE.Quaternion();
    // Exponential smoothing time constant in milliseconds. Larger = smoother.
    private smoothingTimeConstantMs = 300;
    // Separate quaternion that integrates gyro rates for display regardless of mode
    private integratedGyroQuaternion = new THREE.Quaternion();
    // Fixed basis transform mapping sensor frame (Xs, Ys, Zs) to Three.js model frame (Xm, Ym, Zm)
    // Mapping used throughout: Xm = Xs, Ym = Zs, Zm = -Ys  => rotation Rx(-90°)
    private sensorToModel = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        // Start with identity orientation
        this.quaternion.identity();
        this.integratedGyroQuaternion.identity();
    }

    async load(modelPath: string) {
        try {
            console.log('Loading GLB file:', modelPath);
            
            // Load the GLB file using Three.js GLTFLoader
            await this.loadGLBFile(modelPath);
            
        } catch (error) {
            console.error('Failed to load GLB file, falling back to placeholder:', error);
            this.createPlaceholderPCB();
        }
    }

    async loadFromFile(file: File) {
        const url = URL.createObjectURL(file);
        try {
            console.log('Loading GLB file from user upload:', file.name);
            await this.loadGLBFile(url);
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    private async loadGLBFile(modelPath: string) {
        const loader = new GLTFLoader();
        
        return new Promise<void>((resolve, reject) => {
            loader.load(
                modelPath,
                (gltf) => {
                    // Remove and dispose old model if present
                    if (this.model) {
                        this.scene.remove(this.model);
                        this.disposeObject3D(this.model);
                        this.model = null;
                    }
                    // Successfully loaded GLB file
                    this.model = gltf.scene;
                    
                    // Calculate bounding box to determine scale and center
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());
                    
                    console.log('Model size:', size);
                    console.log('Model center:', center);
                    
                    // Auto-scale any model to fit a target size so users can load arbitrary models
                    const maxDimension = Math.max(size.x, size.y, size.z);
                    const targetMaxDimension = 4; // units to fit within
                    const scaleFactor = maxDimension > 0 ? targetMaxDimension / maxDimension : 1;
                    this.model.scale.setScalar(scaleFactor);
                    
                    // Center the model at origin
                    this.model.position.sub(center.multiplyScalar(scaleFactor));

                    // Ensure the entire model is within a comfortable camera distance
                    const fittedSize = new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3());
                    const fittedMax = Math.max(fittedSize.x, fittedSize.y, fittedSize.z);
                    const radius = Math.max(1, fittedMax);
                    // If camera exists, place it at a distance proportional to model size once on load
                    // Consumers may override via orbit controls
                    const defaultDistance = radius * 2.5;
                    // Best-effort: move camera if present (scene manager sets lookAt 0,0,0)
                    const win = window as unknown as { __sceneCamera?: THREE.PerspectiveCamera };
                    if (win.__sceneCamera) {
                        const cam = win.__sceneCamera;
                        const dir = new THREE.Vector3(1, 1, 1).normalize();
                        cam.position.copy(dir.multiplyScalar(defaultDistance));
                    }
                    
                    // Enable shadows and enhance materials for better lighting
                    this.model.traverse((child) => {
                        if (child instanceof THREE.Mesh) {
                            child.castShadow = true;
                            child.receiveShadow = true;
                            
                            // Enhance materials for better specular response
                            if (child.material instanceof THREE.MeshLambertMaterial) {
                                // Convert Lambert to Phong for specular highlights
                                const oldMaterial = child.material;
                                child.material = new THREE.MeshPhongMaterial({
                                    color: oldMaterial.color,
                                    shininess: 30,
                                    specular: 0x222222,
                                });
                            } else if (child.material instanceof THREE.MeshStandardMaterial) {
                                // Enhance standard material properties
                                child.material.metalness = 0.1;
                                child.material.roughness = 0.4;
                            }
                            
                            if (child.material instanceof THREE.Material) {
                                child.material.needsUpdate = true;
                            }
                        }
                    });
                    
                    // Add coordinate system indicators scaled appropriately
                    const axesHelper = new THREE.AxesHelper(Math.max(0.5, maxDimension * scaleFactor * 0.5));
                    this.model.add(axesHelper);
                    
                    // Add to scene
                    this.scene.add(this.model);
                    console.log(`GLB file loaded successfully - scaled by ${scaleFactor}x`);
                    // Apply current quaternion so it is visible even before data
                    this.applyRotationToModel();
                    resolve();
                },
                (progress) => {
                    if (progress.total) {
                        const pct = (progress.loaded / progress.total) * 100;
                        console.log(`Loading progress: ${pct.toFixed(0)}%`);
                    }
                },
                (error) => {
                    console.error('Error loading GLB file:', error);
                    reject(error);
                }
            );
        });
    }


    private createPlaceholderPCB() {
        this.model = new THREE.Group();

        // Create PCB board (green rectangle) with specular material
        const boardGeometry = new THREE.BoxGeometry(4, 0.1, 2.5);
        const boardMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x2d5016,
            shininess: 20,
            specular: 0x111111
        });
        const board = new THREE.Mesh(boardGeometry, boardMaterial);
        board.castShadow = true;
        board.receiveShadow = true;
        this.model.add(board);

        // Create ESP32S3 chip (black rectangle) with specular material
        const chipGeometry = new THREE.BoxGeometry(1.5, 0.2, 1);
        const chipMaterial = new THREE.MeshPhongMaterial({ 
            color: 0x1a1a1a,
            shininess: 50,
            specular: 0x333333
        });
        const chip = new THREE.Mesh(chipGeometry, chipMaterial);
        chip.position.set(-0.5, 0.15, 0);
        chip.castShadow = true;
        this.model.add(chip);

        // Create LSM6DS3 sensor (small silver cube) with high specular
        const sensorGeometry = new THREE.BoxGeometry(0.3, 0.15, 0.3);
        const sensorMaterial = new THREE.MeshPhongMaterial({ 
            color: 0xc0c0c0,
            shininess: 100,
            specular: 0x888888
        });
        const sensor = new THREE.Mesh(sensorGeometry, sensorMaterial);
        sensor.position.set(1, 0.125, 0.5);
        sensor.castShadow = true;
        this.model.add(sensor);

        // Add some components (capacitors, resistors as small cylinders) with specular
        for (let i = 0; i < 8; i++) {
            const componentGeometry = new THREE.CylinderGeometry(0.05, 0.05, 0.1);
            const componentColor = Math.random() > 0.5 ? 0x8B4513 : 0x4169E1;
            const componentMaterial = new THREE.MeshPhongMaterial({ 
                color: componentColor,
                shininess: 40,
                specular: 0x222222
            });
            const component = new THREE.Mesh(componentGeometry, componentMaterial);
            
            component.position.set(
                (Math.random() - 0.5) * 3,
                0.1,
                (Math.random() - 0.5) * 2
            );
            component.castShadow = true;
            this.model.add(component);
        }

        // Add coordinate system indicators on the PCB
        const axesHelper = new THREE.AxesHelper(1);
        axesHelper.position.set(1, 0.2, 0.5); // Position at sensor location
        this.model.add(axesHelper);

        this.scene.add(this.model);
        // Apply current quaternion so it is visible even before data
        this.applyRotationToModel();
    }

    // Absolute orientation from accelerometer tilt (pitch/roll)
    updateOrientationFromAccel(accel: { x: number; y: number; z: number }, dtSeconds: number) {
        if (!this.model) return;

        // Calculate pitch and roll from accelerometer data
        const pitch = Math.atan2(accel.y, Math.sqrt(accel.x * accel.x + accel.z * accel.z));
        const roll = Math.atan2(accel.x, accel.z);
        
        // Create target quaternion from accelerometer data
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromEuler(new THREE.Euler(pitch, 0, roll, 'XYZ'));
        
        // Smoothly interpolate toward the absolute target orientation using time-constant based alpha
        const alpha = this.computeAlpha(dtSeconds);
        this.quaternion.slerp(targetQuaternion, alpha);

        // Apply rotation to model
        this.applyRotationToModel();
    }

    // Incremental orientation update by integrating gyro rates over dt (seconds)
    updateOrientationFromGyro(gyroDegPerSec: { x: number; y: number; z: number }, dtSeconds: number) {
        if (!this.model) return;
        if (dtSeconds <= 0 || !isFinite(dtSeconds)) return;

        // Convert degrees/sec to radians/sec
        const gx = gyroDegPerSec.x * Math.PI / 180;
        const gy = gyroDegPerSec.y * Math.PI / 180;
        const gz = gyroDegPerSec.z * Math.PI / 180;

        // Angular rate magnitude
        const omegaMagnitude = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (omegaMagnitude === 0) {
            return; // no rotation needed
        }

        // Rotation over dt: axis = omega/|omega|, angle = |omega| * dt
        const angle = omegaMagnitude * dtSeconds;
        const axisX = gx / omegaMagnitude;
        const axisY = gy / omegaMagnitude;
        const axisZ = gz / omegaMagnitude;

        const deltaQuaternion = new THREE.Quaternion();
        deltaQuaternion.setFromAxisAngle(new THREE.Vector3(axisX, axisZ, -axisY), angle);

        // Directly apply integrated rotation without smoothing for gyro mode
        this.quaternion.multiply(deltaQuaternion).normalize();

        this.applyRotationToModel();
    }

    // Always-on integration of gyro for display (independent from current mode)
    integrateGyroForDisplay(gyroDegPerSec: { x: number; y: number; z: number }, dtSeconds: number) {
        if (dtSeconds <= 0 || !isFinite(dtSeconds)) return;
        const gx = gyroDegPerSec.x * Math.PI / 180;
        const gy = gyroDegPerSec.y * Math.PI / 180;
        const gz = gyroDegPerSec.z * Math.PI / 180;
        const omegaMagnitude = Math.sqrt(gx * gx + gy * gy + gz * gz);
        if (omegaMagnitude === 0) return;
        const angle = omegaMagnitude * dtSeconds;
        const axisX = gx / omegaMagnitude;
        const axisY = gy / omegaMagnitude;
        const axisZ = gz / omegaMagnitude;
        const deltaQuaternion = new THREE.Quaternion();
        // Match axis mapping used elsewhere
        deltaQuaternion.setFromAxisAngle(new THREE.Vector3(axisX, axisZ, -axisY), angle);
        this.integratedGyroQuaternion.multiply(deltaQuaternion).normalize();
    }

    // Absolute orientation from Fusion Euler angles (degrees)
    updateOrientationFromFusionEuler(eulerDeg: { roll: number; pitch: number; yaw: number }, _dtSeconds: number) {
        if (!this.model) return;
        // Unwrap angles to avoid sudden flips at ±180° boundaries
        const rollDeg = this.unwrapToPrev(eulerDeg.roll, this.prevEuler?.roll ?? eulerDeg.roll);
        const pitchDeg = this.unwrapToPrev(eulerDeg.pitch, this.prevEuler?.pitch ?? eulerDeg.pitch);
        const yawDeg = this.unwrapToPrev(eulerDeg.yaw, this.prevEuler?.yaw ?? eulerDeg.yaw);

        // Reconstruct sensor quaternion using the same Euler convention as the library (ZYX)
        const qSensor = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(this.degToRad(rollDeg), this.degToRad(pitchDeg), this.degToRad(yawDeg), 'ZYX')
        );

        // Map sensor quaternion into model frame via conjugation by the fixed basis transform Rx(-90°)
        const qTarget = this.sensorToModel.clone().multiply(qSensor).multiply(this.sensorToModel.clone().invert());

        // For fusion mode, apply AHRS output directly without additional smoothing
        this.quaternion.copy(qTarget);
        this.applyRotationToModel();
        this.prevEuler = { roll: rollDeg, pitch: pitchDeg, yaw: yawDeg };
    }

    private prevEuler: { roll: number; pitch: number; yaw: number } | null = null;
    private unwrapToPrev(currentDeg: number, prevDeg: number): number {
        const delta = currentDeg - prevDeg;
        if (delta > 180) currentDeg -= 360;
        else if (delta < -180) currentDeg += 360;
        return currentDeg;
    }
    private degToRad(d: number) { return d * Math.PI / 180; }
    // radToDeg no longer used; keep degToRad only

    setSmoothingTimeConstantMs(ms: number) {
        // Clamp to non-negative range
        this.smoothingTimeConstantMs = Math.max(0, ms);
        console.log(`Smoothing time constant set to: ${this.smoothingTimeConstantMs} ms`);
    }

    getModel(): THREE.Group | null {
        return this.model;
    }

    resetOrientation() {
        // Backward-compat: keep as integrated gyro reset
        this.integratedGyroQuaternion.identity();
    }

    // Explicitly reset only the integrated gyro (for display)
    resetIntegratedGyro() {
        this.integratedGyroQuaternion.identity();
    }

    // Explicitly reset the model orientation quaternion to identity
    resetModelOrientation() {
        this.quaternion.identity();
        this.applyRotationToModel();
    }

    private applyRotationToModel() {
        if (!this.model) return;
        this.model.quaternion.copy(this.quaternion);
    }

    private computeAlpha(dtSeconds: number): number {
        // Map time-constant (tau) to per-sample EMA alpha: alpha = 1 - exp(-dt / tau)
        const tau = this.smoothingTimeConstantMs / 1000;
        if (!isFinite(dtSeconds) || dtSeconds <= 0) return 0; // no update this frame
        if (tau <= 0) return 1; // immediate tracking when tau is zero
        const alpha = 1 - Math.exp(-dtSeconds / tau);
        return Math.min(1, Math.max(0, alpha));
    }

    private disposeObject3D(object: THREE.Object3D) {
        object.traverse((child) => {
            const mesh = child as THREE.Mesh & { isMesh?: boolean };
            if (mesh.isMesh) {
                if (mesh.geometry) mesh.geometry.dispose();
                const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
                if (Array.isArray(material)) {
                    material.forEach((m) => m && m.dispose());
                } else if (material) {
                    material.dispose();
                }
            }
        });
    }

    // Current model orientation as Euler degrees using ZYX order
    getEulerDegreesZYX(): { roll: number; pitch: number; yaw: number } {
        const e = new THREE.Euler().setFromQuaternion(this.quaternion, 'ZYX');
        const radToDeg = (r: number) => r * 180 / Math.PI;
        return { roll: radToDeg(e.x), pitch: radToDeg(e.y), yaw: radToDeg(e.z) };
    }

    // Integrated gyro-only orientation as Euler degrees using ZYX order
    getIntegratedGyroEulerDegreesZYX(): { roll: number; pitch: number; yaw: number } {
        const e = new THREE.Euler().setFromQuaternion(this.integratedGyroQuaternion, 'ZYX');
        const radToDeg = (r: number) => r * 180 / Math.PI;
        return { roll: radToDeg(e.x), pitch: radToDeg(e.y), yaw: radToDeg(e.z) };
    }
}