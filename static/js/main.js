/**
 * AR Mukbang - Three.js Frontend
 * Real-time AR interaction with fruits using hand and face tracking
 */

// ============== ES MODULE IMPORTS ==============
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Brush, Evaluator, SUBTRACTION } from '/static/js/libs/three-bvh-csg.module.js';

// ============== SCENE SETUP ==============
const canvas = document.getElementById('three-canvas');
const scene = new THREE.Scene();

// Camera setup - perspective camera for 3D depth
const camera = new THREE.PerspectiveCamera(
    75,                                     // FOV
    window.innerWidth / window.innerHeight, // Aspect ratio
    0.1,                                    // Near plane
    1000                                    // Far plane
);
camera.position.z = 5;

// Renderer with transparency for overlay on video
const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0); // Transparent background

// ============== LIGHTING ==============
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0xffffff, 0.5);
pointLight.position.set(-5, 5, 5);
scene.add(pointLight);

// ============== GLOBAL STATE ==============
let score = 0;
let fruits = [];
let particles = [];
let handPosition = { x: 0.5, y: 0.5, z: 0 };
let lastHandPosition = { x: 0.5, y: 0.5, z: 0 };
let mouthPosition = { topY: 0.5, bottomY: 0.5, isOpen: false };
let isPinching = false;
let grabbedFruit = null;
let gltfLoader = new GLTFLoader();
let appleModel = null;
let bananaModel = null;
let csgEvaluator = new Evaluator();
let lastBiteTime = 0;
const BITE_COOLDOWN = 500; // ms
const MAX_BITES_PER_APPLE = 6;

// UI Elements
const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');
const connectionStatusEl = document.getElementById('connection-status');
const scoreValueEl = document.getElementById('score-value');

// Loading state tracking
let videoLoaded = false;
let socketConnected = false;

function checkAndHideLoading() {
    // Auto hide after 2 seconds regardless
    setTimeout(() => {
        loadingEl.classList.add('hidden');
        console.log('✅ Loading hidden (timeout)');
    }, 2000);
}

// Call immediately
checkAndHideLoading();

// ============== SOCKET.IO CONNECTION ==============
// Socket.IO is loaded globally via script tag
const socket = window.io ? window.io() : null;

if (!socket) {
    console.error('❌ Socket.IO not available!');
    loadingEl.innerHTML = '<div class="spinner"></div><p>Error: Socket.IO failed to load</p>';
} else {
    console.log('🔌 Socket.IO initializing...');
    
    socket.on('connect', () => {
        console.log('✅ Connected to AR Mukbang server');
        statusEl.classList.remove('disconnected');
        statusEl.classList.add('connected');
        connectionStatusEl.textContent = '🟢 Connected';
        socketConnected = true;
        loadingEl.classList.add('hidden');
    });

    socket.on('disconnect', () => {
        console.log('❌ Disconnected from server');
        statusEl.classList.remove('connected');
        statusEl.classList.add('disconnected');
        connectionStatusEl.textContent = '🔴 Disconnected';
        socketConnected = false;
    });

    socket.on('connected', (data) => {
        console.log('Server message:', data.message);
    });
}

// ============== COORDINATE MAPPING ==============

/**
 * Convert MediaPipe normalized coordinates (0-1) to Three.js world coordinates
 * MediaPipe: (0,0) = top-left, (1,1) = bottom-right
 * Three.js: (0,0) = center, positive Y up
 */
function mapToWorldCoords(normX, normY, normZ = 0) {
    // Calculate world position based on camera FOV
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = camera.position.z;
    
    // Calculate visible height/width at camera distance
    const visibleHeight = 2 * Math.tan(fovRad / 2) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    
    // Map from 0-1 to world coordinates (centered at origin)
    const worldX = (normX - 0.5) * visibleWidth;
    const worldY = -(normY - 0.5) * visibleHeight; // Flip Y axis
    const worldZ = -normZ * 3; // Scale Z for depth perception
    
    return new THREE.Vector3(worldX, worldY, worldZ);
}

// ============== FRUIT MANAGEMENT ==============

/**
 * Create a simple apple using geometry (fallback if no GLB model)
 */
function createAppleGeometry() {
    const group = new THREE.Group();
    
    // Apple body
    const appleGeometry = new THREE.SphereGeometry(0.3, 32, 32);
    const appleMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        roughness: 0.3,
        metalness: 0.1
    });
    const apple = new THREE.Mesh(appleGeometry, appleMaterial);
    
    // Slightly squash the apple
    apple.scale.y = 0.9;
    group.add(apple);
    
    // Stem
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.03, 0.15, 8);
    const stemMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a2f00,
        roughness: 0.8
    });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = 0.3;
    group.add(stem);
    
    // Leaf
    const leafShape = new THREE.Shape();
    leafShape.moveTo(0, 0);
    leafShape.quadraticCurveTo(0.1, 0.05, 0.15, 0);
    leafShape.quadraticCurveTo(0.1, -0.05, 0, 0);
    
    const leafGeometry = new THREE.ShapeGeometry(leafShape);
    const leafMaterial = new THREE.MeshStandardMaterial({
        color: 0x228b22,
        side: THREE.DoubleSide
    });
    const leaf = new THREE.Mesh(leafGeometry, leafMaterial);
    leaf.position.set(0.05, 0.32, 0);
    leaf.rotation.z = Math.PI / 4;
    group.add(leaf);
    
    return group;
}

/**
 * Spawn a fruit at the given normalized coordinates
 */
function spawnFruit(normX, normY) {
    console.log(`🍎 Spawning fruit at (${normX.toFixed(2)}, ${normY.toFixed(2)})`);
    
    const worldPos = mapToWorldCoords(normX, normY, 0);
    
    let fruit;
    
    if (appleModel) {
        // Clone the loaded GLB model
        fruit = appleModel.clone();
        
        // Set target scale for Group only
        const targetScale = 0.005;
        fruit.userData.originalScale = new THREE.Vector3(targetScale, targetScale, targetScale);
        
        // Start with scale 0 for spawn animation
        fruit.scale.set(0, 0, 0);
        
        console.log('🍎 Fruit will animate to scale:', targetScale);
    } else {
        // Use procedural geometry
        fruit = createAppleGeometry();
        fruit.userData.originalScale = new THREE.Vector3(0.5, 0.5, 0.5);
        fruit.scale.set(0, 0, 0);
    }
    
    fruit.position.copy(worldPos);
    
    // Fruit data
    fruit.userData.type = 'apple';
    fruit.userData.biteCount = 0;
    fruit.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        0
    );
    fruit.userData.spawnTime = Date.now();
    fruit.userData.floatAmplitude = 0.05 + Math.random() * 0.05;
    fruit.userData.floatSpeed = 0.5 + Math.random() * 0.5;
    fruit.userData.floatOffset = Math.random() * Math.PI * 2;
    fruit.userData.rotationSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01
    );
    fruit.userData.isGrabbed = false;
    fruit.userData.lastRotation = new THREE.Euler(0, 0, 0);
    fruit.userData.basePosition = worldPos.clone();
    
    // Random initial rotation
    fruit.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    
    scene.add(fruit);
    fruits.push(fruit);
    
    // Spawn animation
    animateSpawn(fruit);
}

/**
 * Spawn a banana at the given normalized coordinates
 */
function spawnBanana(normX, normY) {
    console.log(`🍌 Spawning banana at (${normX.toFixed(2)}, ${normY.toFixed(2)})`);
    
    const worldPos = mapToWorldCoords(normX, normY, 0);
    
    let fruit;
    
    if (bananaModel) {
        // Clone the loaded GLB model
        fruit = bananaModel.clone();
        
        // Set target scale for Group only - banana needs to be 60x bigger
        const targetScale = 0.22;
        fruit.userData.originalScale = new THREE.Vector3(targetScale, targetScale, targetScale);
        
        // Start with scale 0 for spawn animation
        fruit.scale.set(0, 0, 0);
        
        console.log('🍌 Banana will animate to scale:', targetScale);
    } else {
        // Fallback: Create yellow cylinder as banana
        const geometry = new THREE.CapsuleGeometry(0.2, 1, 8, 16);
        const material = new THREE.MeshStandardMaterial({
            color: 0xffe633,
            roughness: 0.4,
            metalness: 0.0
        });
        fruit = new THREE.Mesh(geometry, material);
        fruit.userData.originalScale = new THREE.Vector3(0.5, 0.5, 0.5);
        fruit.scale.set(0, 0, 0);
    }
    
    fruit.position.copy(worldPos);
    
    // Banana data
    fruit.userData.type = 'banana';
    fruit.userData.biteCount = 0;
    fruit.userData.velocity = new THREE.Vector3(
        (Math.random() - 0.5) * 0.02,
        (Math.random() - 0.5) * 0.02,
        0
    );
    fruit.userData.spawnTime = Date.now();
    fruit.userData.floatAmplitude = 0.05 + Math.random() * 0.05;
    fruit.userData.floatSpeed = 0.5 + Math.random() * 0.5;
    fruit.userData.floatOffset = Math.random() * Math.PI * 2;
    fruit.userData.rotationSpeed = new THREE.Vector3(
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01,
        (Math.random() - 0.5) * 0.01
    );
    fruit.userData.isGrabbed = false;
    fruit.userData.lastRotation = new THREE.Euler(0, 0, 0);
    fruit.userData.basePosition = worldPos.clone();
    
    // Random initial rotation
    fruit.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    
    scene.add(fruit);
    fruits.push(fruit);
    
    // Spawn animation
    animateSpawn(fruit);
}

/**
 * Animate fruit spawn with scale-up effect
 */
function animateSpawn(fruit) {
    const duration = 300;
    const startTime = Date.now();
    const targetScale = fruit.userData.originalScale || new THREE.Vector3(1, 1, 1);
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
        // Ease-out bounce
        const eased = 1 - Math.pow(1 - progress, 3);
        
        fruit.scale.set(
            eased * targetScale.x,
            eased * targetScale.y,
            eased * targetScale.z
        );
        
        if (progress < 1) {
            requestAnimationFrame(animate);
        }
    }
    
    animate();
}

// ============== PARTICLE EXPLOSION ==============

/**
 * Create explosion particles when fruit is eaten
 */
function createExplosion(position) {
    const particleCount = 50;
    const colors = [0xff0000, 0xff4444, 0xff6666, 0xffaaaa, 0x4a2f00];
    
    for (let i = 0; i < particleCount; i++) {
        // Random triangle/shard geometry
        const size = 0.05 + Math.random() * 0.1;
        const geometry = new THREE.TetrahedronGeometry(size);
        const material = new THREE.MeshStandardMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            transparent: true,
            opacity: 1
        });
        
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        
        // Random rotation
        particle.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        
        // Random velocity (explode outward)
        const speed = 0.05 + Math.random() * 0.1;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        
        particle.userData = {
            velocity: {
                x: Math.sin(phi) * Math.cos(theta) * speed,
                y: Math.sin(phi) * Math.sin(theta) * speed + 0.02, // Slight upward bias
                z: Math.cos(phi) * speed
            },
            rotationSpeed: {
                x: (Math.random() - 0.5) * 0.3,
                y: (Math.random() - 0.5) * 0.3,
                z: (Math.random() - 0.5) * 0.3
            },
            createdAt: Date.now(),
            lifetime: 1000 + Math.random() * 500
        };
        
        scene.add(particle);
        particles.push(particle);
    }
}

/**
 * Create bite mark on apple using CSG
 */
function createBiteMark(fruit, mouthWorldPos) {
    const now = Date.now();
    if (now - lastBiteTime < BITE_COOLDOWN) return false;
    
    // Check if apple has reached max bites
    if (fruit.userData.biteCount >= MAX_BITES_PER_APPLE) {
        return 'destroy';
    }
    
    try {
        // Find the fruit mesh (works for both apple and banana)
        let fruitMesh = fruit;
        if (fruit.type === 'Group') {
            fruit.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    fruitMesh = child;
                }
            });
        }
        
        if (!fruitMesh.geometry) {
            console.warn('❌ Fruit has no geometry, using simple bite count');
            fruit.userData.biteCount++;
            createBiteParticles(mouthWorldPos);
            return true;
        }
        
        // Check if geometry has required attributes for CSG
        if (!fruitMesh.geometry.attributes || !fruitMesh.geometry.attributes.position) {
            console.warn('❌ Fruit geometry missing position attribute, using simple bite count');
            fruit.userData.biteCount++;
            createBiteParticles(mouthWorldPos);
            return true;
        }
        
        // Store original geometry on first bite
        if (!fruit.userData.originalGeometry) {
            fruit.userData.originalGeometry = fruitMesh.geometry.clone();
        }
        
        // Create brush from current fruit geometry
        const fruitBrush = new Brush(fruitMesh.geometry, fruitMesh.material);
        fruitBrush.position.copy(fruitMesh.position);
        fruitBrush.rotation.copy(fruitMesh.rotation);
        fruitBrush.scale.copy(fruitMesh.scale);
        fruitBrush.updateMatrixWorld();
        
        // Calculate bite size based on mouth opening
        const mouthOpenAmount = mouthPosition.bottomY - mouthPosition.topY;
        const biteRadius = Math.max(0.15, mouthOpenAmount * 5);
        
        // Create bite sphere
        const biteGeometry = new THREE.SphereGeometry(biteRadius, 16, 16);
        const biteMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const biteBrush = new Brush(biteGeometry, biteMaterial);
        
        // Position bite at mouth (convert from world to local space)
        const localMouthPos = fruit.worldToLocal(mouthWorldPos.clone());
        biteBrush.position.copy(localMouthPos);
        biteBrush.updateMatrixWorld();
        
        // Perform CSG subtraction
        const result = csgEvaluator.evaluate(fruitBrush, biteBrush, SUBTRACTION);
        
        // Update geometry
        if (result && result.geometry) {
            fruitMesh.geometry.dispose();
            fruitMesh.geometry = result.geometry;
            
            fruit.userData.biteCount++;
            lastBiteTime = now;
            
            // Create small particle burst at bite location
            createBiteParticles(mouthWorldPos);
            
            console.log(`🍎 Bite ${fruit.userData.biteCount}/${MAX_BITES_PER_APPLE}`);
            return true;
        }
    } catch (error) {
        console.warn('CSG operation failed:', error);
        // Fallback: just increment bite count
        fruit.userData.biteCount++;
        createBiteParticles(mouthWorldPos);
        return true;
    }
    
    return false;
}

/**
 * Create small particle burst for bite effect
 */
function createBiteParticles(position) {
    const particleCount = 15;
    const colors = [0xff0000, 0xff6666, 0xffeeee];
    
    for (let i = 0; i < particleCount; i++) {
        const size = 0.02 + Math.random() * 0.03;
        const geometry = new THREE.SphereGeometry(size, 8, 8);
        const material = new THREE.MeshBasicMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            transparent: true,
            opacity: 1
        });
        
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        
        const speed = 0.02 + Math.random() * 0.03;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        
        particle.userData = {
            velocity: {
                x: Math.sin(phi) * Math.cos(theta) * speed,
                y: Math.sin(phi) * Math.sin(theta) * speed,
                z: Math.cos(phi) * speed
            },
            rotationSpeed: {
                x: (Math.random() - 0.5) * 0.2,
                y: (Math.random() - 0.5) * 0.2,
                z: (Math.random() - 0.5) * 0.2
            },
            createdAt: Date.now(),
            lifetime: 500 + Math.random() * 300
        };
        
        scene.add(particle);
        particles.push(particle);
    }
}

/**
 * Update particles (movement and fade)
 */
function updateParticles() {
    const now = Date.now();
    const gravity = -0.002;
    
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        const data = particle.userData;
        const age = now - data.createdAt;
        
        if (age > data.lifetime) {
            // Remove old particles
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            particles.splice(i, 1);
            continue;
        }
        
        // Apply velocity
        particle.position.x += data.velocity.x;
        particle.position.y += data.velocity.y;
        particle.position.z += data.velocity.z;
        
        // Apply gravity
        data.velocity.y += gravity;
        
        // Apply rotation
        particle.rotation.x += data.rotationSpeed.x;
        particle.rotation.y += data.rotationSpeed.y;
        particle.rotation.z += data.rotationSpeed.z;
        
        // Fade out
        const lifeProgress = age / data.lifetime;
        particle.material.opacity = 1 - lifeProgress;
        
        // Shrink
        const scale = 1 - lifeProgress * 0.5;
        particle.scale.set(scale, scale, scale);
    }
}

// ============== HAND INDICATOR ==============

// Visual hand cursor
const handCursorGeometry = new THREE.RingGeometry(0.1, 0.15, 32);
const handCursorMaterial = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    transparent: true,
    opacity: 0.7,
    side: THREE.DoubleSide
});
const handCursor = new THREE.Mesh(handCursorGeometry, handCursorMaterial);
handCursor.visible = false;
scene.add(handCursor);

// Pinch indicator (inner circle)
const pinchIndicatorGeometry = new THREE.CircleGeometry(0.08, 32);
const pinchIndicatorMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0
});
const pinchIndicator = new THREE.Mesh(pinchIndicatorGeometry, pinchIndicatorMaterial);
handCursor.add(pinchIndicator);

// ============== MOUTH INDICATOR ==============

const mouthIndicatorGeometry = new THREE.RingGeometry(0.15, 0.2, 32);
const mouthIndicatorMaterial = new THREE.MeshBasicMaterial({
    color: 0xff69b4,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide
});
const mouthIndicator = new THREE.Mesh(mouthIndicatorGeometry, mouthIndicatorMaterial);
mouthIndicator.visible = false;
scene.add(mouthIndicator);

// ============== SOCKET EVENT HANDLERS ==============

if (socket) {
    socket.on('update_data', (data) => {
        // Update hand tracking
        if (data.hand) {
            handPosition = {
                x: data.hand.x,
                y: data.hand.y,
                z: data.hand.z
            };
            isPinching = data.hand.is_pinching;
            
            // Update hand cursor position
            const worldPos = mapToWorldCoords(data.hand.x, data.hand.y, data.hand.z);
            handCursor.position.set(worldPos.x, worldPos.y, worldPos.z + 0.5);
            handCursor.visible = true;
            
            // Update pinch indicator
            if (isPinching) {
                handCursorMaterial.color.setHex(0xffff00);
                pinchIndicatorMaterial.opacity = 0.8;
            } else {
                handCursorMaterial.color.setHex(0x00ff00);
                pinchIndicatorMaterial.opacity = 0;
            }
            
            // Handle grabbing logic
            handleGrabbing(worldPos);
        } else {
            handCursor.visible = false;
            if (grabbedFruit) {
                grabbedFruit.userData.isGrabbed = false;
                grabbedFruit = null;
            }
        }
        
        // Update mouth tracking
        if (data.mouth) {
            mouthPosition = {
                topY: data.mouth.top_y,
                bottomY: data.mouth.bottom_y,
                topX: data.mouth.top_x,
                bottomX: data.mouth.bottom_x,
                isOpen: data.mouth.is_open
            };
            
            // Calculate mouth center position
            const mouthCenterX = (data.mouth.top_x + data.mouth.bottom_x) / 2;
            const mouthCenterY = (data.mouth.top_y + data.mouth.bottom_y) / 2;
            const mouthWorldPos = mapToWorldCoords(mouthCenterX, mouthCenterY, 0);
            
            mouthIndicator.position.set(mouthWorldPos.x, mouthWorldPos.y, mouthWorldPos.z + 0.3);
            mouthIndicator.visible = true;
            
            // Change color based on mouth open state
            if (data.mouth.is_open) {
                mouthIndicatorMaterial.color.setHex(0xff0000);
                mouthIndicatorMaterial.opacity = 0.8;
            } else {
                mouthIndicatorMaterial.color.setHex(0xff69b4);
                mouthIndicatorMaterial.opacity = 0.5;
            }
            
            // Check for eating
            handleEating(mouthWorldPos);
        } else {
            mouthIndicator.visible = false;
        }
    });

    socket.on('spawn_fruit', (data) => {
        console.log('📦 Spawn fruit event received:', data);
        spawnFruit(data.x, data.y);
    });
    
    socket.on('spawn_banana', (data) => {
        console.log('🍌 Spawn banana event received:', data);
        spawnBanana(data.x, data.y);
    });
}

// ============== INTERACTION LOGIC ==============

/**
 * Handle grabbing fruits with pinch gesture
 */
function handleGrabbing(handWorldPos) {
    const grabDistance = 0.5;
    
    if (isPinching) {
        if (grabbedFruit) {
            // Move grabbed fruit with hand
            grabbedFruit.position.set(
                handWorldPos.x,
                handWorldPos.y,
                handWorldPos.z
            );
            
            // XOAY TÁO THEO TAY: Tính delta movement
            const deltaX = handPosition.x - lastHandPosition.x;
            const deltaY = handPosition.y - lastHandPosition.y;
            
            // Convert hand movement to rotation
            // Horizontal movement = Y-axis rotation
            // Vertical movement = X-axis rotation
            grabbedFruit.rotation.y += deltaX * 10; // Scale factor for sensitivity
            grabbedFruit.rotation.x += deltaY * 10;
            
        } else {
            // Try to grab nearest fruit
            for (const fruit of fruits) {
                if (fruit.userData.isGrabbed) continue;
                
                const distance = fruit.position.distanceTo(
                    new THREE.Vector3(handWorldPos.x, handWorldPos.y, handWorldPos.z)
                );
                
                if (distance < grabDistance) {
                    grabbedFruit = fruit;
                    fruit.userData.isGrabbed = true;
                    console.log('🤏 Grabbed fruit!');
                    break;
                }
            }
        }
    } else {
        // Release grabbed fruit
        if (grabbedFruit) {
            grabbedFruit.userData.isGrabbed = false;
            grabbedFruit = null;
            console.log('✋ Released fruit');
        }
    }
    
    // Update last hand position for next frame
    lastHandPosition.x = handPosition.x;
    lastHandPosition.y = handPosition.y;
    lastHandPosition.z = handPosition.z;
}

/**
 * Handle eating fruits when near mouth (with bite marks)
 */
function handleEating(mouthWorldPos) {
    const eatDistance = 0.4;
    const mouthOpenThreshold = 0.02;
    
    // Check if mouth is open enough
    const mouthOpenAmount = mouthPosition.bottomY - mouthPosition.topY;
    if (mouthOpenAmount < mouthOpenThreshold) return;
    
    // Check each fruit
    for (let i = fruits.length - 1; i >= 0; i--) {
        const fruit = fruits[i];
        
        const distance = fruit.position.distanceTo(
            new THREE.Vector3(mouthWorldPos.x, mouthWorldPos.y, mouthWorldPos.z)
        );
        
        if (distance < eatDistance) {
            // Create bite mark!
            const biteResult = createBiteMark(fruit, mouthWorldPos);
            
            if (biteResult === 'destroy' || fruit.userData.biteCount >= MAX_BITES_PER_APPLE) {
                // Apple is fully eaten!
                console.log('😋 Apple fully eaten!');
                
                // Create explosion at fruit position
                createExplosion(fruit.position.clone());
                
                // Remove fruit
                scene.remove(fruit);
                if (fruit.userData.originalGeometry) {
                    fruit.userData.originalGeometry.dispose();
                }
                fruits.splice(i, 1);
                
                // Release if this was grabbed fruit
                if (grabbedFruit === fruit) {
                    grabbedFruit = null;
                }
                
                // Update score (bonus for finishing apple)
                score += 50;
                scoreValueEl.textContent = score;
                
                // Notify server
                if (socket) {
                    socket.emit('eaten', {
                        score: score,
                        timestamp: Date.now()
                    });
                }
            } else if (biteResult) {
                // Partial bite - small score
                score += 5;
                scoreValueEl.textContent = score;
            }
        }
    }
}

// ============== VIDEO BACKGROUND SETUP ==============

// Setup video element to check when it loads
const videoBackground = document.getElementById('video-background');
if (videoBackground) {
    videoBackground.onload = () => {
        console.log('✅ Video stream loaded!');
        videoLoaded = true;
    };
}

// ============== GLTF LOADER SETUP ==============

// Try to load apple.glb model
function loadModels() {
    gltfLoader.load(
        '/static/models/apple.glb',
        (gltf) => {
            console.log('✅ Apple model loaded!');
            appleModel = gltf.scene;
            
            // Don't scale the template - we'll scale each instance when spawned
            
            // Check and enhance materials
            appleModel.traverse((child) => {
                if (child.isMesh) {
                    // Ensure proper rendering
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // If no material or texture, apply red material
                    if (!child.material || !child.material.map) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xff0000,
                            roughness: 0.3,
                            metalness: 0.1
                        });
                        console.log('⚠️ Applied fallback red material');
                    }
                }
            });
        },
        (progress) => {
            if (progress.total > 0) {
                console.log('Loading model...', (progress.loaded / progress.total * 100).toFixed(1) + '%');
            }
        },
        (error) => {
            console.log('ℹ️ No apple.glb found, using procedural geometry');
            // Will use procedural apple geometry as fallback
        }
    );
    
    // Load banana model
    gltfLoader.load(
        '/static/models/banana.glb',
        (gltf) => {
            console.log('✅ Banana model loaded!');
            bananaModel = gltf.scene;
            
            // Check and enhance materials
            bananaModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
                    // If no material, apply yellow material
                    if (!child.material) {
                        child.material = new THREE.MeshStandardMaterial({
                            color: 0xffe633,
                            roughness: 0.4,
                            metalness: 0.0
                        });
                        console.log('⚠️ Applied fallback yellow material');
                    }
                }
            });
        },
        (progress) => {
            if (progress.total > 0) {
                console.log('Loading banana model...', (progress.loaded / progress.total * 100).toFixed(1) + '%');
            }
        },
        (error) => {
            console.log('ℹ️ No banana.glb found, using procedural geometry');
        }
    );
}

loadModels();

// ============== WINDOW RESIZE ==============

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ============== ANIMATION LOOP ==============

function animate() {
    requestAnimationFrame(animate);
    
    // Update particles
    updateParticles();
    
    const time = Date.now() * 0.001; // seconds
    
    // Floating animation for fruits
    for (const fruit of fruits) {
        if (!fruit.userData.isGrabbed) {
            const data = fruit.userData;
            
            // Store base position if not exists
            if (!data.basePosition) {
                data.basePosition = fruit.position.clone();
            }
            
            // Floating motion (sine wave)
            const floatY = Math.sin(time * data.floatSpeed + data.floatOffset) * data.floatAmplitude;
            const floatX = Math.cos(time * data.floatSpeed * 0.7 + data.floatOffset) * data.floatAmplitude * 0.5;
            
            // Apply to base position (not current position)
            fruit.position.x = data.basePosition.x + floatX;
            fruit.position.y = data.basePosition.y + floatY;
            fruit.position.z = data.basePosition.z;
            
            // Slow rotation on multiple axes
            fruit.rotation.x += data.rotationSpeed.x;
            fruit.rotation.y += data.rotationSpeed.y;
            fruit.rotation.z += data.rotationSpeed.z;
        } else {
            // When grabbed, update base position to current position
            if (fruit.userData.basePosition) {
                fruit.userData.basePosition.copy(fruit.position);
            }
        }
    }
    
    // Make hand cursor face camera
    handCursor.lookAt(camera.position);
    mouthIndicator.lookAt(camera.position);
    
    renderer.render(scene, camera);
}

// Start animation
animate();

// ============== DEBUG HELPERS ==============

// Press 'D' to spawn a test fruit
document.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') {
        console.log('🧪 Debug: Spawning test fruit locally');
        spawnFruit(0.5, 0.5);
        // Also emit to server to test Socket.IO
        if (socket && socket.connected) {
            console.log('🧪 Debug: Emitting test_spawn to server');
            socket.emit('test_spawn');
        } else {
            console.warn('⚠️ Socket not connected, cannot emit test_spawn');
        }
    }
    
    if (event.key === 'b' || event.key === 'B') {
        console.log('🧪 Debug: Spawning test banana');
        spawnBanana(0.3, 0.5);
        // Also emit to server
        if (socket && socket.connected) {
            console.log('🧪 Debug: Emitting test_spawn_banana to server');
            socket.emit('test_spawn_banana');
        }
    }
    
    if (event.key === 'c' || event.key === 'C') {
        console.log('🧪 Debug: Clearing all fruits');
        for (const fruit of fruits) {
            scene.remove(fruit);
        }
        fruits = [];
    }
    
    if (event.key === 's' || event.key === 'S') {
        console.log('🧪 Debug: Socket status:', socket ? (socket.connected ? 'Connected' : 'Disconnected') : 'Not initialized');
        console.log('🧪 Debug: Video loaded:', videoLoaded);
        console.log('🧪 Debug: Socket connected:', socketConnected);
        console.log('🧪 Debug: Apple model loaded:', appleModel !== null);
        console.log('🧪 Debug: Banana model loaded:', bananaModel !== null);
        console.log('🧪 Debug: Fruits count:', fruits.length);
    }
});

console.log('🍎 AR Mukbang initialized!');
console.log('Press D to spawn test fruit, C to clear all fruits, S to check status');

