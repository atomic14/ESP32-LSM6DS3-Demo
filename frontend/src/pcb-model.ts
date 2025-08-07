import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export class PCBModel {
    private scene: THREE.Scene;
    private model: THREE.Group | null = null;
    private quaternion = new THREE.Quaternion();
    private referenceQuaternion = new THREE.Quaternion();
    private baseRotation = new THREE.Quaternion(); // 90° CW rotation offset
    private isCalibrated = false;
    private smoothingFactor = 0.1; // For exponential smoothing

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        // Set up 90-degree clockwise rotation offset
        this.baseRotation.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
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
                    try {
                        // Best-effort: move camera if present (scene manager sets lookAt 0,0,0)
                        // We cannot import SceneManager here; users can still reposition with mouse.
                        // @ts-ignore
                        const anyWindow = window as any;
                        if (anyWindow && anyWindow.__sceneCamera instanceof THREE.PerspectiveCamera) {
                            const cam: THREE.PerspectiveCamera = anyWindow.__sceneCamera;
                            const dir = new THREE.Vector3(1, 1, 1).normalize();
                            cam.position.copy(dir.multiplyScalar(defaultDistance));
                        }
                    } catch {
                        // ignore
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
                    // Apply current base + current quaternion so it is visible even before data
                    this.applyRotationToModel();
                    resolve();
                },
                (progress) => {
                    console.log('Loading progress:', (progress.loaded / progress.total * 100) + '%');
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
        // Apply current base + current quaternion so it is visible even before data
        this.applyRotationToModel();
    }


    calibrateReference(accel: { x: number; y: number; z: number }) {
        // Set reference orientation based on current accelerometer reading
        const pitch = Math.atan2(accel.y, Math.sqrt(accel.x * accel.x + accel.z * accel.z));
        const roll = Math.atan2(accel.x, accel.z);
        
        const euler = new THREE.Euler(pitch, 0, roll, 'XYZ');
        this.referenceQuaternion.setFromEuler(euler);
        this.quaternion.copy(this.referenceQuaternion);
        this.isCalibrated = true;
        
        console.log('PCB orientation calibrated - reference set');
        this.applyRotationToModel();
    }

    updateOrientation(accel: { x: number; y: number; z: number }) {
        if (!this.model) return;

        // Calculate pitch and roll from accelerometer data
        const pitch = Math.atan2(accel.y, Math.sqrt(accel.x * accel.x + accel.z * accel.z));
        const roll = Math.atan2(accel.x, accel.z);
        
        // Create target quaternion from accelerometer data
        const targetQuaternion = new THREE.Quaternion();
        targetQuaternion.setFromEuler(new THREE.Euler(pitch, 0, roll, 'XYZ'));
        
        if (!this.isCalibrated) {
            // Without calibration, show absolute orientation with smoothing
            this.quaternion.slerp(targetQuaternion, this.smoothingFactor);
        } else {
            // With calibration, show relative to reference orientation
            const relativeQuaternion = new THREE.Quaternion();
            relativeQuaternion.multiplyQuaternions(targetQuaternion, this.referenceQuaternion.clone().invert());
            
            // Apply smoothing
            this.quaternion.slerp(relativeQuaternion, this.smoothingFactor);
        }

        // Apply rotation to model with base rotation offset
        this.applyRotationToModel();
    }

    resetOrientation() {
        this.quaternion.set(0, 0, 0, 1);
        this.referenceQuaternion.set(0, 0, 0, 1);
        this.isCalibrated = false;
        console.log('PCB orientation reset');
        this.applyRotationToModel();
    }

    setSmoothingFactor(factor: number) {
        // Factor between 0 (no smoothing) and 1 (heavy smoothing)
        this.smoothingFactor = Math.max(0, Math.min(1, factor));
        console.log(`Smoothing factor set to: ${this.smoothingFactor}`);
    }

    getModel(): THREE.Group | null {
        return this.model;
    }

    /**
     * Sets the static base rotation (model alignment) in degrees for X/Y/Z.
     * Positive angles follow Three.js convention and Euler order 'XYZ'.
     */
    setBaseRotationDegrees(xDeg: number, yDeg: number, zDeg: number) {
        const xRad = (xDeg * Math.PI) / 180;
        const yRad = (yDeg * Math.PI) / 180;
        const zRad = (zDeg * Math.PI) / 180;
        const euler = new THREE.Euler(xRad, yRad, zRad, 'XYZ');
        this.baseRotation.setFromEuler(euler);
        console.log(`Base rotation set to (deg): X=${xDeg.toFixed(1)} Y=${yDeg.toFixed(1)} Z=${zDeg.toFixed(1)}`);
        this.applyRotationToModel();
    }

    /** Returns the current base rotation as degrees for X/Y/Z. */
    getBaseRotationDegrees(): { x: number; y: number; z: number } {
        const euler = new THREE.Euler().setFromQuaternion(this.baseRotation, 'XYZ');
        return {
            x: (euler.x * 180) / Math.PI,
            y: (euler.y * 180) / Math.PI,
            z: (euler.z * 180) / Math.PI,
        };
    }

    private applyRotationToModel() {
        if (!this.model) return;
        const finalQuaternion = new THREE.Quaternion();
        finalQuaternion.multiplyQuaternions(this.baseRotation, this.quaternion);
        this.model.quaternion.copy(finalQuaternion);
    }

    private disposeObject3D(object: THREE.Object3D) {
        object.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if ((mesh as any).isMesh) {
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
}