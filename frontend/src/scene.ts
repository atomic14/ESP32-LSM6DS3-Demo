import * as THREE from 'three';

export class SceneManager {
    public scene: THREE.Scene;
    public camera: THREE.PerspectiveCamera;
    public renderer: THREE.WebGLRenderer;
    private container: HTMLElement;

    constructor() {
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera();
        this.renderer = new THREE.WebGLRenderer();
        this.container = document.getElementById('canvas-container')!;
    }

    async init() {
        // Set up scene with lighter background
        this.scene.background = new THREE.Color(0x333333);
        
        // Set up camera
        this.camera = new THREE.PerspectiveCamera(
            75,
            window.innerWidth / window.innerHeight,
            0.01,  // Closer near plane for better close-up viewing
            1000
        );
        this.camera.position.set(2, 2, 2);  // Start closer to the model for better initial zoom
        this.camera.lookAt(0, 0, 0);

        // Set up renderer
        this.renderer = new THREE.WebGLRenderer({ 
            antialias: true,
            alpha: true 
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        
        this.container.appendChild(this.renderer.domElement);

        // Add lights
        this.setupLighting();

        // Add coordinate axes helper
        const axesHelper = new THREE.AxesHelper(5);
        this.scene.add(axesHelper);

        // Add grid - smaller grid for PCB scale
        const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x444444);
        this.scene.add(gridHelper);

        // Handle window resize
        window.addEventListener('resize', () => this.onWindowResize());

        // Add basic orbit controls with mouse
        this.setupMouseControls();
    }

    private setupLighting() {
        // Moderate ambient light for overall illumination
        const ambientLight = new THREE.AmbientLight(0x404040, 1.0);
        this.scene.add(ambientLight);

        // Main directional light (key light with specular)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.3);
        directionalLight.position.set(10, 10, 5);
        directionalLight.castShadow = true;
        directionalLight.shadow.mapSize.width = 2048;
        directionalLight.shadow.mapSize.height = 2048;
        directionalLight.shadow.camera.near = 0.1;
        directionalLight.shadow.camera.far = 50;
        directionalLight.shadow.camera.left = -10;
        directionalLight.shadow.camera.right = 10;
        directionalLight.shadow.camera.top = 10;
        directionalLight.shadow.camera.bottom = -10;
        this.scene.add(directionalLight);

        // Moderate fill light from opposite side
        const fillLight = new THREE.DirectionalLight(0xffffff, 0.7);
        fillLight.position.set(-5, 0, -5);
        this.scene.add(fillLight);

        // Moderate top light for better visibility
        const topLight = new THREE.DirectionalLight(0xffffff, 0.6);
        topLight.position.set(0, 15, 0);
        this.scene.add(topLight);

        // Moderate hemisphere light for more natural lighting
        const hemisphereLight = new THREE.HemisphereLight(
            0xffffff, // sky color
            0x444444, // moderate ground color  
            0.4
        );
        this.scene.add(hemisphereLight);

        // Add point lights for specular highlights (keep these for shine)
        const specularLight1 = new THREE.PointLight(0xffffff, 0.5, 50);
        specularLight1.position.set(5, 8, 3);
        this.scene.add(specularLight1);

        const specularLight2 = new THREE.PointLight(0xffffff, 0.4, 50);
        specularLight2.position.set(-3, 6, -2);
        this.scene.add(specularLight2);

        // Add a rim light for edge definition (reduced)
        const rimLight = new THREE.DirectionalLight(0xffffff, 0.5);
        rimLight.position.set(-10, 5, -10);
        this.scene.add(rimLight);
    }

    private setupMouseControls() {
        let isMouseDown = false;
        let mouseX = 0;
        let mouseY = 0;
        let targetX = 0;
        let targetY = 0;

        this.renderer.domElement.addEventListener('mousedown', (event) => {
            isMouseDown = true;
            mouseX = event.clientX;
            mouseY = event.clientY;
        });

        this.renderer.domElement.addEventListener('mousemove', (event) => {
            if (!isMouseDown) return;

            const deltaX = event.clientX - mouseX;
            const deltaY = event.clientY - mouseY;

            targetX += deltaX * 0.01;
            targetY += deltaY * 0.01;
            
            // Clamp vertical rotation to prevent flipping
            targetY = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, targetY));

            mouseX = event.clientX;
            mouseY = event.clientY;
        });

        this.renderer.domElement.addEventListener('mouseup', () => {
            isMouseDown = false;
        });

        this.renderer.domElement.addEventListener('wheel', (event) => {
            event.preventDefault();
            const distance = this.camera.position.length();
            const zoomSpeed = distance * 0.1; // Dynamic zoom speed based on distance
            const newDistance = distance + event.deltaY * zoomSpeed * 0.001;
            const normalizedPosition = this.camera.position.clone().normalize();
            // Allow much closer zoom (0.1) and farther zoom (100)
            this.camera.position.copy(normalizedPosition.multiplyScalar(Math.max(0.1, Math.min(100, newDistance))));
        });

        // Update camera position based on mouse interaction
        const updateCamera = () => {
            const radius = this.camera.position.length();
            this.camera.position.x = radius * Math.cos(targetY) * Math.cos(targetX);
            this.camera.position.y = radius * Math.sin(targetY);
            this.camera.position.z = radius * Math.cos(targetY) * Math.sin(targetX);
            this.camera.lookAt(0, 0, 0);
            requestAnimationFrame(updateCamera);
        };
        updateCamera();
    }

    private onWindowResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    render() {
        this.renderer.render(this.scene, this.camera);
    }
}