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

    private async loadGLBFile(modelPath: string) {
        const loader = new GLTFLoader();
        
        return new Promise<void>((resolve, reject) => {
            loader.load(
                modelPath,
                (gltf) => {
                    // Successfully loaded GLB file
                    this.model = gltf.scene;
                    
                    // Calculate bounding box to determine scale and center
                    const box = new THREE.Box3().setFromObject(this.model);
                    const size = box.getSize(new THREE.Vector3());
                    const center = box.getCenter(new THREE.Vector3());
                    
                    console.log('Model size:', size);
                    console.log('Model center:', center);
                    
                    // Scale the model up if it's too small (PCBs are usually measured in mm)
                    // If the largest dimension is less than 1 unit, scale it up significantly
                    const maxDimension = Math.max(size.x, size.y, size.z);
                    let scaleFactor = 1;
                    
                    if (maxDimension < 1) {
                        scaleFactor = 50; // Scale up small models (mm to a visible size)
                    } else if (maxDimension < 10) {
                        scaleFactor = 5;  // Moderate scale up
                    }
                    
                    this.model.scale.setScalar(scaleFactor);
                    
                    // Center the model at origin
                    this.model.position.sub(center.multiplyScalar(scaleFactor));
                    
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
                    const axesHelper = new THREE.AxesHelper(maxDimension * scaleFactor * 0.5);
                    this.model.add(axesHelper);
                    
                    // Add to scene
                    this.scene.add(this.model);
                    console.log(`GLB file loaded successfully - scaled by ${scaleFactor}x`);
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
        const finalQuaternion = new THREE.Quaternion();
        finalQuaternion.multiplyQuaternions(this.baseRotation, this.quaternion);
        this.model.quaternion.copy(finalQuaternion);
    }

    resetOrientation() {
        this.quaternion.set(0, 0, 0, 1);
        this.referenceQuaternion.set(0, 0, 0, 1);
        this.isCalibrated = false;
        console.log('PCB orientation reset');
    }

    setSmoothingFactor(factor: number) {
        // Factor between 0 (no smoothing) and 1 (heavy smoothing)
        this.smoothingFactor = Math.max(0, Math.min(1, factor));
        console.log(`Smoothing factor set to: ${this.smoothingFactor}`);
    }

    getModel(): THREE.Group | null {
        return this.model;
    }
}