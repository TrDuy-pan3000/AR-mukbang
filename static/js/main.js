

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Brush, Evaluator, SUBTRACTION } from '/static/js/libs/three-bvh-csg.module.js';

const canvas = document.getElementById('three-canvas');
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    75,
    window.innerWidth / window.innerHeight,
    0.1,
    1000
);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    alpha: true,
    antialias: true
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setClearColor(0x000000, 0);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 5, 5);
scene.add(directionalLight);

const pointLight = new THREE.PointLight(0xffffff, 0.5);
pointLight.position.set(-5, 5, 5);
scene.add(pointLight);

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
const BITE_COOLDOWN = 500;
const MAX_BITES_PER_APPLE = 6;

const loadingEl = document.getElementById('loading');
const statusEl = document.getElementById('status');
const connectionStatusEl = document.getElementById('connection-status');
const scoreValueEl = document.getElementById('score-value');

let videoLoaded = false;
let socketConnected = false;

function checkAndHideLoading() {
    setTimeout(() => {
        loadingEl.classList.add('hidden');
        console.log('✅ Loading hidden (timeout)');
    }, 2000);
}

checkAndHideLoading();

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



function mapToWorldCoords(normX, normY, normZ = 0) {
    const fovRad = (camera.fov * Math.PI) / 180;
    const distance = camera.position.z;
    
    const visibleHeight = 2 * Math.tan(fovRad / 2) * distance;
    const visibleWidth = visibleHeight * camera.aspect;
    
    const worldX = (normX - 0.5) * visibleWidth;
    const worldY = -(normY - 0.5) * visibleHeight;
    const worldZ = -normZ * 3;
    
    return new THREE.Vector3(worldX, worldY, worldZ);
}



function createAppleGeometry() {
    const group = new THREE.Group();
    
    const appleGeometry = new THREE.SphereGeometry(0.3, 32, 32);
    const appleMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        roughness: 0.3,
        metalness: 0.1
    });
    const apple = new THREE.Mesh(appleGeometry, appleMaterial);
    
    apple.scale.y = 0.9;
    group.add(apple);
    
    const stemGeometry = new THREE.CylinderGeometry(0.02, 0.03, 0.15, 8);
    const stemMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a2f00,
        roughness: 0.8
    });
    const stem = new THREE.Mesh(stemGeometry, stemMaterial);
    stem.position.y = 0.3;
    group.add(stem);
    
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


function spawnFruit(normX, normY) {
    console.log(`🍎 Spawning fruit at (${normX.toFixed(2)}, ${normY.toFixed(2)})`);
    
    const worldPos = mapToWorldCoords(normX, normY, 0);
    
    let fruit;
    
    if (appleModel) {
        fruit = appleModel.clone();
        
        const targetScale = 0.005;
        fruit.userData.originalScale = new THREE.Vector3(targetScale, targetScale, targetScale);
        
        fruit.scale.set(0, 0, 0);
        
        console.log('🍎 Fruit will animate to scale:', targetScale);
    } else {
        fruit = createAppleGeometry();
        fruit.userData.originalScale = new THREE.Vector3(0.5, 0.5, 0.5);
        fruit.scale.set(0, 0, 0);
    }
    
    fruit.position.copy(worldPos);
    
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
    
    fruit.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    
    scene.add(fruit);
    fruits.push(fruit);
    
    animateSpawn(fruit);
}


function spawnBanana(normX, normY) {
    console.log(`🍌 Spawning banana at (${normX.toFixed(2)}, ${normY.toFixed(2)})`);
    
    const worldPos = mapToWorldCoords(normX, normY, 0);
    
    let fruit;
    
    if (bananaModel) {
        fruit = bananaModel.clone();
        
        const targetScale = 0.22;
        fruit.userData.originalScale = new THREE.Vector3(targetScale, targetScale, targetScale);
        
        fruit.scale.set(0, 0, 0);
        
        console.log('🍌 Banana will animate to scale:', targetScale);
    } else {
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
    
    fruit.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
    );
    
    scene.add(fruit);
    fruits.push(fruit);
    
    animateSpawn(fruit);
}


function animateSpawn(fruit) {
    const duration = 300;
    const startTime = Date.now();
    const targetScale = fruit.userData.originalScale || new THREE.Vector3(1, 1, 1);
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        
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



function createExplosion(position) {
    const particleCount = 50;
    const colors = [0xff0000, 0xff4444, 0xff6666, 0xffaaaa, 0x4a2f00];
    
    for (let i = 0; i < particleCount; i++) {
        const size = 0.05 + Math.random() * 0.1;
        const geometry = new THREE.TetrahedronGeometry(size);
        const material = new THREE.MeshStandardMaterial({
            color: colors[Math.floor(Math.random() * colors.length)],
            transparent: true,
            opacity: 1
        });
        
        const particle = new THREE.Mesh(geometry, material);
        particle.position.copy(position);
        
        particle.rotation.set(
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2,
            Math.random() * Math.PI * 2
        );
        
        const speed = 0.05 + Math.random() * 0.1;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.random() * Math.PI;
        
        particle.userData = {
            velocity: {
                x: Math.sin(phi) * Math.cos(theta) * speed,
                y: Math.sin(phi) * Math.sin(theta) * speed + 0.02,
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


function createBiteMark(fruit, mouthWorldPos) {
    const now = Date.now();
    if (now - lastBiteTime < BITE_COOLDOWN) return false;
    
    if (fruit.userData.biteCount >= MAX_BITES_PER_APPLE) {
        return 'destroy';
    }
    
    try {
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
        
        if (!fruitMesh.geometry.attributes || !fruitMesh.geometry.attributes.position) {
            console.warn('❌ Fruit geometry missing position attribute, using simple bite count');
            fruit.userData.biteCount++;
            createBiteParticles(mouthWorldPos);
            return true;
        }
        
        if (!fruit.userData.originalGeometry) {
            fruit.userData.originalGeometry = fruitMesh.geometry.clone();
        }
        
        const fruitBrush = new Brush(fruitMesh.geometry, fruitMesh.material);
        fruitBrush.position.copy(fruitMesh.position);
        fruitBrush.rotation.copy(fruitMesh.rotation);
        fruitBrush.scale.copy(fruitMesh.scale);
        fruitBrush.updateMatrixWorld();
        
        const mouthOpenAmount = mouthPosition.bottomY - mouthPosition.topY;
        const biteRadius = Math.max(0.15, mouthOpenAmount * 5);
        
        const biteGeometry = new THREE.SphereGeometry(biteRadius, 16, 16);
        const biteMaterial = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const biteBrush = new Brush(biteGeometry, biteMaterial);
        
        const localMouthPos = fruit.worldToLocal(mouthWorldPos.clone());
        biteBrush.position.copy(localMouthPos);
        biteBrush.updateMatrixWorld();
        
        const result = csgEvaluator.evaluate(fruitBrush, biteBrush, SUBTRACTION);
        
        if (result && result.geometry) {
            fruitMesh.geometry.dispose();
            fruitMesh.geometry = result.geometry;
            
            fruit.userData.biteCount++;
            lastBiteTime = now;
            
            createBiteParticles(mouthWorldPos);
            
            console.log(`🍎 Bite ${fruit.userData.biteCount}/${MAX_BITES_PER_APPLE}`);
            return true;
        }
    } catch (error) {
        console.warn('CSG operation failed:', error);
        fruit.userData.biteCount++;
        createBiteParticles(mouthWorldPos);
        return true;
    }
    
    return false;
}


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


function updateParticles() {
    const now = Date.now();
    const gravity = -0.002;
    
    for (let i = particles.length - 1; i >= 0; i--) {
        const particle = particles[i];
        const data = particle.userData;
        const age = now - data.createdAt;
        
        if (age > data.lifetime) {
            scene.remove(particle);
            particle.geometry.dispose();
            particle.material.dispose();
            particles.splice(i, 1);
            continue;
        }
        
        particle.position.x += data.velocity.x;
        particle.position.y += data.velocity.y;
        particle.position.z += data.velocity.z;
        
        data.velocity.y += gravity;
        
        particle.rotation.x += data.rotationSpeed.x;
        particle.rotation.y += data.rotationSpeed.y;
        particle.rotation.z += data.rotationSpeed.z;
        
        const lifeProgress = age / data.lifetime;
        particle.material.opacity = 1 - lifeProgress;
        
        const scale = 1 - lifeProgress * 0.5;
        particle.scale.set(scale, scale, scale);
    }
}


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

const pinchIndicatorGeometry = new THREE.CircleGeometry(0.08, 32);
const pinchIndicatorMaterial = new THREE.MeshBasicMaterial({
    color: 0xffff00,
    transparent: true,
    opacity: 0
});
const pinchIndicator = new THREE.Mesh(pinchIndicatorGeometry, pinchIndicatorMaterial);
handCursor.add(pinchIndicator);


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


if (socket) {
    socket.on('update_data', (data) => {
        if (data.hand) {
            handPosition = {
                x: data.hand.x,
                y: data.hand.y,
                z: data.hand.z
            };
            isPinching = data.hand.is_pinching;
            
            const worldPos = mapToWorldCoords(data.hand.x, data.hand.y, data.hand.z);
            handCursor.position.set(worldPos.x, worldPos.y, worldPos.z + 0.5);
            handCursor.visible = true;
            
            if (isPinching) {
                handCursorMaterial.color.setHex(0xffff00);
                pinchIndicatorMaterial.opacity = 0.8;
            } else {
                handCursorMaterial.color.setHex(0x00ff00);
                pinchIndicatorMaterial.opacity = 0;
            }
            
            handleGrabbing(worldPos);
        } else {
            handCursor.visible = false;
            if (grabbedFruit) {
                grabbedFruit.userData.isGrabbed = false;
                grabbedFruit = null;
            }
        }
        
        if (data.mouth) {
            mouthPosition = {
                topY: data.mouth.top_y,
                bottomY: data.mouth.bottom_y,
                topX: data.mouth.top_x,
                bottomX: data.mouth.bottom_x,
                isOpen: data.mouth.is_open
            };
            
            const mouthCenterX = (data.mouth.top_x + data.mouth.bottom_x) / 2;
            const mouthCenterY = (data.mouth.top_y + data.mouth.bottom_y) / 2;
            const mouthWorldPos = mapToWorldCoords(mouthCenterX, mouthCenterY, 0);
            
            mouthIndicator.position.set(mouthWorldPos.x, mouthWorldPos.y, mouthWorldPos.z + 0.3);
            mouthIndicator.visible = true;
            
            if (data.mouth.is_open) {
                mouthIndicatorMaterial.color.setHex(0xff0000);
                mouthIndicatorMaterial.opacity = 0.8;
            } else {
                mouthIndicatorMaterial.color.setHex(0xff69b4);
                mouthIndicatorMaterial.opacity = 0.5;
            }
            
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



function handleGrabbing(handWorldPos) {
    const grabDistance = 0.5;
    
    if (isPinching) {
        if (grabbedFruit) {
            grabbedFruit.position.set(
                handWorldPos.x,
                handWorldPos.y,
                handWorldPos.z
            );
            
            const deltaX = handPosition.x - lastHandPosition.x;
            const deltaY = handPosition.y - lastHandPosition.y;
            
            grabbedFruit.rotation.y += deltaX * 10;
            grabbedFruit.rotation.x += deltaY * 10;
            
        } else {
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
        if (grabbedFruit) {
            grabbedFruit.userData.isGrabbed = false;
            grabbedFruit = null;
            console.log('✋ Released fruit');
        }
    }
    
    lastHandPosition.x = handPosition.x;
    lastHandPosition.y = handPosition.y;
    lastHandPosition.z = handPosition.z;
}


function handleEating(mouthWorldPos) {
    const eatDistance = 0.4;
    const mouthOpenThreshold = 0.02;
    
    const mouthOpenAmount = mouthPosition.bottomY - mouthPosition.topY;
    if (mouthOpenAmount < mouthOpenThreshold) return;
    
    for (let i = fruits.length - 1; i >= 0; i--) {
        const fruit = fruits[i];
        
        const distance = fruit.position.distanceTo(
            new THREE.Vector3(mouthWorldPos.x, mouthWorldPos.y, mouthWorldPos.z)
        );
        
        if (distance < eatDistance) {
            const biteResult = createBiteMark(fruit, mouthWorldPos);
            
            if (biteResult === 'destroy' || fruit.userData.biteCount >= MAX_BITES_PER_APPLE) {
                console.log('😋 Apple fully eaten!');
                
                createExplosion(fruit.position.clone());
                
                scene.remove(fruit);
                if (fruit.userData.originalGeometry) {
                    fruit.userData.originalGeometry.dispose();
                }
                fruits.splice(i, 1);
                
                if (grabbedFruit === fruit) {
                    grabbedFruit = null;
                }
                
                score += 50;
                scoreValueEl.textContent = score;
                
                if (socket) {
                    socket.emit('eaten', {
                        score: score,
                        timestamp: Date.now()
                    });
                }
            } else if (biteResult) {
                score += 5;
                scoreValueEl.textContent = score;
            }
        }
    }
}


const videoBackground = document.getElementById('video-background');
if (videoBackground) {
    videoBackground.onload = () => {
        console.log('✅ Video stream loaded!');
        videoLoaded = true;
    };
}


function loadModels() {
    gltfLoader.load(
        '/static/models/apple.glb',
        (gltf) => {
            console.log('✅ Apple model loaded!');
            appleModel = gltf.scene;
            
            
            appleModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
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
        }
    );
    
    gltfLoader.load(
        '/static/models/banana.glb',
        (gltf) => {
            console.log('✅ Banana model loaded!');
            bananaModel = gltf.scene;
            
            bananaModel.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                    
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


window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});


function animate() {
    requestAnimationFrame(animate);
    
    updateParticles();
    
    const time = Date.now() * 0.001;
    
    for (const fruit of fruits) {
        if (!fruit.userData.isGrabbed) {
            const data = fruit.userData;
            
            if (!data.basePosition) {
                data.basePosition = fruit.position.clone();
            }
            
            const floatY = Math.sin(time * data.floatSpeed + data.floatOffset) * data.floatAmplitude;
            const floatX = Math.cos(time * data.floatSpeed * 0.7 + data.floatOffset) * data.floatAmplitude * 0.5;
            
            fruit.position.x = data.basePosition.x + floatX;
            fruit.position.y = data.basePosition.y + floatY;
            fruit.position.z = data.basePosition.z;
            
            fruit.rotation.x += data.rotationSpeed.x;
            fruit.rotation.y += data.rotationSpeed.y;
            fruit.rotation.z += data.rotationSpeed.z;
        } else {
            if (fruit.userData.basePosition) {
                fruit.userData.basePosition.copy(fruit.position);
            }
        }
    }
    
    handCursor.lookAt(camera.position);
    mouthIndicator.lookAt(camera.position);
    
    renderer.render(scene, camera);
}

animate();


document.addEventListener('keydown', (event) => {
    if (event.key === 'd' || event.key === 'D') {
        console.log('🧪 Debug: Spawning test fruit locally');
        spawnFruit(0.5, 0.5);
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

