import * as THREE from 'three';
// import { OrbitControls } from 'three/addons/controls/OrbitControls.js'; // Not needed
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { createNoise2D } from 'simplex-noise';

// --- Constants ---
const CHUNK_SIZE = 16; // Size of a chunk (blocks wide/deep)
const RENDER_DISTANCE = 4; // Chunks to load around the player (4 means 9x9 chunks)
const TEXTURE_SIZE = 16; // Small texture size for pixelated look
const BLOCK_TYPES = { AIR: 'air', DIRT: 'dirt', GRASS: 'grass', STONE: 'stone', LOG: 'log', LEAF: 'leaf', PLANKS: 'planks' };
const PLAYER_HEIGHT = 1.7;
const GRAVITY = 0.01;
const JUMP_FORCE = 0.15;
const MOVE_SPEED = 0.1;
const INTERACTION_DISTANCE = 5;

// --- Procedural Texture Generation (Simplified for brevity) ---
function generateTexture(size, color, noiseAmount = 0.1) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = color;
    context.fillRect(0, 0, size, size);
    // Basic noise (same as before)
    const imageData = context.getImageData(0, 0, size, size);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const noise = (Math.random() - 0.5) * 255 * noiseAmount;
        data[i] = Math.max(0, Math.min(255, data[i] + noise));
        data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
        data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
    }
    context.putImageData(imageData, 0, 0);
    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    return texture;
}

const dirtTexture = generateTexture(TEXTURE_SIZE, '#8B4513');
const grassTopTexture = generateTexture(TEXTURE_SIZE, '#228B22', 0.05);
const grassSideTexture = generateTexture(TEXTURE_SIZE, '#A0522D');
const stoneTexture = generateTexture(TEXTURE_SIZE, '#808080', 0.15);
const logTexture = generateTexture(TEXTURE_SIZE, '#654321', 0.08);
const leafTexture = generateTexture(TEXTURE_SIZE, '#006400', 0.2);
const plankTexture = generateTexture(TEXTURE_SIZE, '#DEB887', 0.03);
// --- Add simple lines for plank texture ---
const plankCanvas = plankTexture.image;
const plankCtx = plankCanvas.getContext('2d');
plankCtx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
plankCtx.lineWidth = Math.max(1, Math.floor(TEXTURE_SIZE / 8));
for (let i = 0; i <= TEXTURE_SIZE; i += Math.floor(TEXTURE_SIZE / 4)) {
    plankCtx.beginPath();
    plankCtx.moveTo(i, 0);
    plankCtx.lineTo(i, TEXTURE_SIZE);
    plankCtx.stroke();
}
plankTexture.needsUpdate = true;

// --- Materials ---
// Store materials by type for easy lookup
const materials = {
    [BLOCK_TYPES.DIRT]: new THREE.MeshStandardMaterial({ map: dirtTexture }),
    [BLOCK_TYPES.STONE]: new THREE.MeshStandardMaterial({ map: stoneTexture }),
    [BLOCK_TYPES.LOG]: new THREE.MeshStandardMaterial({ map: logTexture }),
    [BLOCK_TYPES.LEAF]: new THREE.MeshStandardMaterial({ map: leafTexture, transparent: true, alphaTest: 0.1 }), // Use alphaTest for better leaf edges
    [BLOCK_TYPES.PLANKS]: new THREE.MeshStandardMaterial({ map: plankTexture }),
    [BLOCK_TYPES.GRASS]: [ // Order: +x, -x, +y (top), -y (bottom), +z, -z
        new THREE.MeshStandardMaterial({ map: grassSideTexture }),
        new THREE.MeshStandardMaterial({ map: grassSideTexture }),
        new THREE.MeshStandardMaterial({ map: grassTopTexture }),
        new THREE.MeshStandardMaterial({ map: dirtTexture }),
        new THREE.MeshStandardMaterial({ map: grassSideTexture }),
        new THREE.MeshStandardMaterial({ map: grassSideTexture })
    ]
};

// --- Geometry (create once and reuse) ---
const blockGeometry = new THREE.BoxGeometry(1, 1, 1);

// --- Noise Setup ---
const noise2D = createNoise2D();
const noiseFrequency = 0.05;
const noiseAmplitude = 10; // Increased amplitude for more variation
const baseLevel = -10; // Lower base level
const stoneDepth = 5; // How deep stone goes below dirt/grass

// --- Scene Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, RENDER_DISTANCE * CHUNK_SIZE * 0.5, RENDER_DISTANCE * CHUNK_SIZE); // Add fog based on render distance

// --- Camera ---
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, RENDER_DISTANCE * CHUNK_SIZE * 1.2); // Adjust far plane based on render distance
camera.position.set(CHUNK_SIZE / 2, baseLevel + noiseAmplitude + 10, CHUNK_SIZE / 2); // Start above potential terrain height

// --- Renderer ---
const renderer = new THREE.WebGLRenderer({ antialias: true }); // Antialias can be false for more pixelated look
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// --- Controls ---
const controls = new PointerLockControls(camera, document.body);
const instructions = document.getElementById('instructions'); // Make sure you have this element in HTML
document.body.addEventListener('click', () => { controls.lock(); });
controls.addEventListener('lock', () => { if(instructions) instructions.style.display = 'none'; });
controls.addEventListener('unlock', () => { if(instructions) instructions.style.display = 'block'; });
scene.add(controls.object); // Add camera controller to scene

// --- Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);
const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
directionalLight.position.set(CHUNK_SIZE * 0.5, 50, CHUNK_SIZE * 0.5); // Position light relative to chunk size
directionalLight.castShadow = false; // Disable shadows for now for performance
scene.add(directionalLight);

// --- Chunk Management ---
const chunks = new Map(); // Map<string, { group: THREE.Group, instancedMeshes: Map<string, THREE.InstancedMesh> }>
let currentChunkX = Infinity;
let currentChunkZ = Infinity;

function getChunkKey(cx, cz) {
    return `${cx},${cz}`;
}

// --- Player State & Input ---
const keys = { w: false, a: false, s: false, d: false, space: false };
// ------------------------------
// Mobile touch controls (invisible zones)
// Left bottom: move  (virtual stick)
// Right bottom: look (drag to rotate)
// ------------------------------
const touchState = {
    move: { id: null, startX: 0, startY: 0, x: 0, y: 0, active: false },
    look: { id: null, lastX: 0, lastY: 0, active: false }
};

let touchMoveForward = 0; // [-1..1]
let touchMoveStrafe  = 0; // [-1..1]

function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }

function setupTouchZones() {
    const left = document.getElementById('touch-left');
    const right = document.getElementById('touch-right');
    if (!left || !right) return;

    const DEADZONE = 10;     // px
    const MAX_DIST = 70;     // px (full tilt)
    const LOOK_SENS = 0.003; // radians per px

    // MOVE ZONE
    left.addEventListener('touchstart', (e) => {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        touchState.move.id = t.identifier;
        touchState.move.startX = t.clientX;
        touchState.move.startY = t.clientY;
        touchState.move.x = t.clientX;
        touchState.move.y = t.clientY;
        touchState.move.active = true;
    }, { passive: false });

    left.addEventListener('touchmove', (e) => {
        if (!touchState.move.active) return;
        for (const t of e.changedTouches) {
            if (t.identifier !== touchState.move.id) continue;
            touchState.move.x = t.clientX;
            touchState.move.y = t.clientY;

            const dx = t.clientX - touchState.move.startX;
            const dy = t.clientY - touchState.move.startY;

            const adx = Math.abs(dx), ady = Math.abs(dy);
            let nx = 0, ny = 0;
            if (adx > DEADZONE) nx = dx / MAX_DIST;
            if (ady > DEADZONE) ny = dy / MAX_DIST;

            touchMoveStrafe  = clamp(nx, -1, 1);
            touchMoveForward = clamp(-ny, -1, 1); // up = forward
            e.preventDefault();
            break;
        }
    }, { passive: false });

    function endMove(e){
        for (const t of e.changedTouches || []) {
            if (t.identifier !== touchState.move.id) continue;
            touchState.move.active = false;
            touchState.move.id = null;
            touchMoveForward = 0;
            touchMoveStrafe = 0;
            break;
        }
    }
    left.addEventListener('touchend', endMove, { passive: false });
    left.addEventListener('touchcancel', endMove, { passive: false });

    // LOOK ZONE
    right.addEventListener('touchstart', (e) => {
        if (!e.changedTouches || e.changedTouches.length === 0) return;
        const t = e.changedTouches[0];
        touchState.look.id = t.identifier;
        touchState.look.lastX = t.clientX;
        touchState.look.lastY = t.clientY;
        touchState.look.active = true;
    }, { passive: false });

    right.addEventListener('touchmove', (e) => {
        if (!touchState.look.active) return;

        const yawObject = controls.getObject();
        const pitchObject = yawObject && yawObject.children ? yawObject.children[0] : null;

        for (const t of e.changedTouches) {
            if (t.identifier !== touchState.look.id) continue;

            const dx = t.clientX - touchState.look.lastX;
            const dy = t.clientY - touchState.look.lastY;
            touchState.look.lastX = t.clientX;
            touchState.look.lastY = t.clientY;

            if (yawObject) yawObject.rotation.y -= dx * LOOK_SENS;
            if (pitchObject) {
                pitchObject.rotation.x -= dy * LOOK_SENS;
                pitchObject.rotation.x = clamp(pitchObject.rotation.x, -Math.PI/2, Math.PI/2);
            }

            e.preventDefault();
            break;
        }
    }, { passive: false });

    function endLook(e){
        for (const t of e.changedTouches || []) {
            if (t.identifier !== touchState.look.id) continue;
            touchState.look.active = false;
            touchState.look.id = null;
            break;
        }
    }
    right.addEventListener('touchend', endLook, { passive: false });
    right.addEventListener('touchcancel', endLook, { passive: false });
}

window.addEventListener('load', () => {
    try { setupTouchZones(); } catch (e) { console.warn('[Touch] setup failed', e); }
});

let playerVelocityY = 0;
let onGround = false;
let selectedBlockType = BLOCK_TYPES.PLANKS; // Start with planks

document.addEventListener('keydown', (event) => {
    if (!controls.isLocked) return;
    switch (event.code) {
        case 'KeyW': keys.w = true; break;
        case 'KeyA': keys.a = true; break;
        case 'KeyS': keys.s = true; break;
        case 'KeyD': keys.d = true; break;
        case 'Space': if (onGround) { playerVelocityY = JUMP_FORCE; onGround = false; } break; // Jump only if on ground
        case 'Digit1': selectedBlockType = BLOCK_TYPES.STONE; updateSelectedBlockUI(); break;
        case 'Digit2': selectedBlockType = BLOCK_TYPES.DIRT; updateSelectedBlockUI(); break;
        case 'Digit3': selectedBlockType = BLOCK_TYPES.GRASS; updateSelectedBlockUI(); break;
        case 'Digit4': selectedBlockType = BLOCK_TYPES.LOG; updateSelectedBlockUI(); break;
        case 'Digit5': selectedBlockType = BLOCK_TYPES.LEAF; updateSelectedBlockUI(); break;
        case 'Digit6': selectedBlockType = BLOCK_TYPES.PLANKS; updateSelectedBlockUI(); break;
    }
});
document.addEventListener('keyup', (event) => {
    switch (event.code) {
        case 'KeyW': keys.w = false; break;
        case 'KeyA': keys.a = false; break;
        case 'KeyS': keys.s = false; break;
        case 'KeyD': keys.d = false; break;
        case 'Space': keys.space = false; break;
    }
});

function updateSelectedBlockUI() {
    const selectedBlockElement = document.getElementById('selected-block-ui'); // Needs corresponding HTML element
    if (selectedBlockElement) {
        selectedBlockElement.textContent = `Selected: ${selectedBlockType.charAt(0).toUpperCase() + selectedBlockType.slice(1)}`;
    }
    console.log("Selected:", selectedBlockType);
}

// --- Raycasting Setup ---
const interactionRaycaster = new THREE.Raycaster();
const groundCheckRaycaster = new THREE.Raycaster();
const downVector = new THREE.Vector3(0, -1, 0);
interactionRaycaster.far = INTERACTION_DISTANCE; // Set max distance for interaction raycaster
groundCheckRaycaster.far = PLAYER_HEIGHT + 0.2; // Max distance slightly more than player height for ground check

// --- Helper for Block Placement ---
const worldObjects = []; // Includes chunk groups and manually placed blocks

// --- World Generation Functions ---

// Calculates block data for a chunk without creating meshes
function generateChunkData(chunkX, chunkZ) {
    const blocks = new Map(); // Map<string, BLOCK_TYPES> key: "x,y,z"
    const startWorldX = chunkX * CHUNK_SIZE;
    const startWorldZ = chunkZ * CHUNK_SIZE;

    for (let x = 0; x < CHUNK_SIZE; x++) {
        for (let z = 0; z < CHUNK_SIZE; z++) {
            const worldX = startWorldX + x;
            const worldZ = startWorldZ + z;

            const noiseVal = noise2D(worldX * noiseFrequency, worldZ * noiseFrequency);
            const heightVariation = (noiseVal + 1) / 2 * noiseAmplitude;
            const topY = Math.floor(baseLevel + heightVariation);

            for (let y = baseLevel - stoneDepth * 2; y <= topY; y++) { // Generate deeper to ensure no gaps
                 const blockPosKey = `${x},${y},${z}`;
                 if (y < baseLevel - stoneDepth) continue; // Skip very deep areas initially if needed

                 let blockType = BLOCK_TYPES.STONE;
                 if (y === topY) {
                     blockType = BLOCK_TYPES.GRASS;
                 } else if (y >= topY - 2) {
                     blockType = BLOCK_TYPES.DIRT;
                 }
                 blocks.set(blockPosKey, blockType);

                 // Basic Tree Generation (only on the top grass block)
                 if (blockType === BLOCK_TYPES.GRASS && y === topY && Math.random() < 0.008) { // Lower tree chance
                     const trunkHeight = Math.floor(Math.random() * 3) + 4;
                     // Trunk
                     for (let ty = 1; ty <= trunkHeight; ty++) {
                         blocks.set(`${x},${y + ty},${z}`, BLOCK_TYPES.LOG);
                     }
                     // Leaves (Simplified cube)
                     const leafStartY = y + trunkHeight - 1;
                     const leafSize = 2;
                     for (let lx = -leafSize; lx <= leafSize; lx++) {
                         for (let ly = 0; ly <= leafSize; ly++) {
                             for (let lz = -leafSize; lz <= leafSize; lz++) {
                                 if (lx === 0 && lz === 0 && ly < leafSize) continue; // Space for trunk
                                 const leafX = x + lx;
                                 const leafZ = z + lz;
                                 // Ensure leaves are within the chunk boundary for simplicity,
                                 // or handle cross-chunk trees if needed (more complex)
                                 if (leafX >= 0 && leafX < CHUNK_SIZE && leafZ >= 0 && leafZ < CHUNK_SIZE) {
                                      // Only place if the spot is currently empty (or replace air)
                                      if (!blocks.has(`${leafX},${leafStartY + ly},${leafZ}`)) {
                                          blocks.set(`${leafX},${leafStartY + ly},${leafZ}`, BLOCK_TYPES.LEAF);
                                      }
                                 }
                             }
                         }
                     }
                 }
            }
        }
    }
    return blocks;
}

// Creates the InstancedMeshes for a chunk based on generated data
function createChunkMesh(chunkX, chunkZ, chunkData) {
    const chunkGroup = new THREE.Group();
    chunkGroup.position.set(chunkX * CHUNK_SIZE, 0, chunkZ * CHUNK_SIZE); // Position the group
    scene.add(chunkGroup);
    worldObjects.push(chunkGroup); // Add chunk group to raycast targets

    const instances = {}; // { [blockType]: { material: Material, positions: Vector3[] } }

    // Group positions by block type
    for (const [posKey, blockType] of chunkData.entries()) {
        if (blockType === BLOCK_TYPES.AIR) continue; // Skip air

        const [x, y, z] = posKey.split(',').map(Number);
        const position = new THREE.Vector3(x + 0.5, y + 0.5, z + 0.5); // Center the block visually

        if (!instances[blockType]) {
            instances[blockType] = {
                material: materials[blockType],
                positions: [],
            };
        }
        instances[blockType].positions.push(position);
    }

    const instancedMeshes = new Map(); // Map<string, THREE.InstancedMesh>

    // Create InstancedMesh for each block type
    const dummy = new THREE.Object3D(); // Used for setting matrix
    for (const blockType in instances) {
        const data = instances[blockType];
        if (!data.material || data.positions.length === 0) continue;

        const instancedMesh = new THREE.InstancedMesh(blockGeometry, data.material, data.positions.length);
        instancedMesh.userData.blockType = blockType; // Store type for potential use
        instancedMesh.userData.isChunkMesh = true; // Flag for interaction logic
        instancedMesh.userData.chunkKey = getChunkKey(chunkX, chunkZ); // Store chunk key

        let instanceIndex = 0;
        for (const pos of data.positions) {
            dummy.position.copy(pos);
            dummy.updateMatrix();
            instancedMesh.setMatrixAt(instanceIndex++, dummy.matrix);
        }
        instancedMesh.instanceMatrix.needsUpdate = true;
        chunkGroup.add(instancedMesh);
        instancedMeshes.set(blockType, instancedMesh); // Store mesh by type
    }

    return { group: chunkGroup, instancedMeshes: instancedMeshes };
}

// --- Chunk Loading/Unloading Logic ---
function updateChunks() {
    const playerPos = controls.getObject().position;
    const playerChunkX = Math.floor(playerPos.x / CHUNK_SIZE);
    const playerChunkZ = Math.floor(playerPos.z / CHUNK_SIZE);

    // Only update if player changed chunks
    if (playerChunkX === currentChunkX && playerChunkZ === currentChunkZ) {
        return;
    }

    const previousChunkX = currentChunkX;
    const previousChunkZ = currentChunkZ;
    currentChunkX = playerChunkX;
    currentChunkZ = playerChunkZ;

    const chunksToRemove = new Set();
    chunks.forEach((_, key) => chunksToRemove.add(key)); // Mark all for potential removal

    // Load/Keep chunks around player
    for (let cx = currentChunkX - RENDER_DISTANCE; cx <= currentChunkX + RENDER_DISTANCE; cx++) {
        for (let cz = currentChunkZ - RENDER_DISTANCE; cz <= currentChunkZ + RENDER_DISTANCE; cz++) {
            const key = getChunkKey(cx, cz);
            chunksToRemove.delete(key); // This chunk should stay/be loaded

            if (!chunks.has(key)) {
                // Generate data and create mesh for new chunk
                console.log(`Loading chunk: ${key}`);
                const chunkData = generateChunkData(cx, cz);
                const chunkMeshInfo = createChunkMesh(cx, cz, chunkData);
                chunks.set(key, chunkMeshInfo);
            }
        }
    }

    // Unload chunks that are too far
    chunksToRemove.forEach(key => {
        console.log(`Unloading chunk: ${key}`);
        const chunkInfo = chunks.get(key);
        if (chunkInfo) {
            // Remove from scene
            scene.remove(chunkInfo.group);

            // Remove from raycast targets
            const index = worldObjects.indexOf(chunkInfo.group);
            if (index > -1) {
                worldObjects.splice(index, 1);
            }

            // Dispose geometry and materials OF INSTANCED MESHES
            chunkInfo.instancedMeshes.forEach(mesh => {
                // Geometry is shared (blockGeometry), DO NOT dispose here
                // Materials are potentially shared, be careful. If unique per chunk, dispose.
                // For this setup, materials are shared, so DO NOT dispose materials here.
                mesh.dispose(); // Dispose the InstancedMesh itself
            });
            chunkInfo.group.clear(); // Remove children references
        }
        chunks.delete(key);
    });

     // Update fog distance maybe? (Optional)
     // scene.fog.near = RENDER_DISTANCE * CHUNK_SIZE * 0.2;
     // scene.fog.far = RENDER_DISTANCE * CHUNK_SIZE;
     // camera.far = RENDER_DISTANCE * CHUNK_SIZE * 1.2;
     // camera.updateProjectionMatrix();

    console.log("Loaded chunks:", chunks.size);
}

// --- Block Interaction ---
window.addEventListener('mousedown', (event) => {
    if (!controls.isLocked) return;

    // Use camera direction for raycasting in pointer lock
    interactionRaycaster.setFromCamera({ x: 0, y: 0 }, camera); // Center of screen
    const intersects = interactionRaycaster.intersectObjects(worldObjects, true); // Check children (InstancedMesh within Groups)

    if (intersects.length > 0) {
        const intersection = intersects[0];
        const obj = intersection.object;

        // --- Breaking Blocks ---
        if (event.button === 0) { // Left click
            if (obj.userData.isChunkMesh && intersection.instanceId !== undefined) {
                // Hide the instance by scaling its matrix to zero
                const mesh = obj; // The InstancedMesh
                const instanceId = intersection.instanceId;
                const matrix = new THREE.Matrix4();
                mesh.getMatrixAt(instanceId, matrix); // Get current matrix
                matrix.scale(new THREE.Vector3(0, 0, 0)); // Scale to zero
                mesh.setMatrixAt(instanceId, matrix); // Set updated matrix
                mesh.instanceMatrix.needsUpdate = true; // IMPORTANT: Tell Three.js to update
                console.log(`Hid instance ${instanceId} in chunk ${mesh.userData.chunkKey}`);

                // TODO: Update underlying chunk data structure if needed for saving/persistence
            }
            else if (!obj.userData.isChunkMesh && obj.userData.isPlacedBlock) {
                 // It's a manually placed block (individual Mesh)
                 scene.remove(obj);
                 const index = worldObjects.indexOf(obj);
                 if(index > -1) worldObjects.splice(index, 1);
                 // Optional: Dispose geometry/material if not shared
                 // obj.geometry.dispose();
                 // obj.material.dispose();
                 console.log("Removed placed block");
            }
        }
        // --- Placing Blocks ---
        else if (event.button === 2) { // Right click
            if (!intersection.face) return; // Need face info

            const faceNormal = intersection.face.normal;
            let placePosition = new THREE.Vector3();

            if (obj.userData.isChunkMesh && intersection.instanceId !== undefined) {
                // Get position of the hit instance
                const hitMatrix = new THREE.Matrix4();
                obj.getMatrixAt(intersection.instanceId, hitMatrix);
                const hitPosition = new THREE.Vector3().setFromMatrixPosition(hitMatrix);
                // Calculate position relative to the chunk group's origin
                const chunkGroup = obj.parent;
                hitPosition.add(chunkGroup.position); // Add chunk offset to get world position

                placePosition.copy(hitPosition).add(faceNormal);

            } else if (obj.position) { // It's likely an individual mesh (like a previously placed block)
                placePosition.copy(obj.position).add(faceNormal);
            } else {
                return; // Cannot determine placement position
            }

            // Round to nearest block center
            placePosition.floor().addScalar(0.5);

            // --- Collision Check: Prevent placing block inside player ---
            const playerPos = controls.getObject().position;
            const playerFeetVoxelCenter = playerPos.clone().floor().addScalar(0.5);
            const playerHeadVoxelCenter = playerPos.clone().setY(playerPos.y + 1).floor().addScalar(0.5);

            if (placePosition.distanceTo(playerFeetVoxelCenter) < 0.1 ||
                placePosition.distanceTo(playerHeadVoxelCenter) < 0.1) {
                console.log("Cannot place block inside player.");
                return;
            }

            // --- Add the new block as an INDIVIDUAL MESH ---
            // This avoids the complexity of modifying InstancedMesh for now.
            const blockMaterial = Array.isArray(materials[selectedBlockType])
                ? materials[selectedBlockType] // Use array for grass
                : materials[selectedBlockType].clone(); // Clone simple materials if needed? Maybe not necessary if not modified.

            const newBlock = new THREE.Mesh(blockGeometry, blockMaterial);
            newBlock.position.copy(placePosition);
            newBlock.userData.blockType = selectedBlockType;
            newBlock.userData.isPlacedBlock = true; // Mark as manually placed
            scene.add(newBlock);
            worldObjects.push(newBlock); // Add to raycast targets
            console.log(`Placed ${selectedBlockType} block at ${placePosition.x}, ${placePosition.y}, ${placePosition.z}`);
        }
    }
});


// --- Animation Loop ---
const clock = new THREE.Clock();
let fpsLastUpdateTime = 0;
let frameCount = 0;
const fpsDisplayElement = document.getElementById('fps-display'); // Needs HTML element

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    const elapsedTime = clock.getElapsedTime();

    // --- FPS Calculation ---
    frameCount++;
    if (elapsedTime - fpsLastUpdateTime >= 1.0) {
        const fps = Math.round(frameCount / (elapsedTime - fpsLastUpdateTime));
        if(fpsDisplayElement) fpsDisplayElement.textContent = `FPS: ${fps}`;
        frameCount = 0;
        fpsLastUpdateTime = elapsedTime;
    }

    // --- Update Chunks ---
    updateChunks(); // Load/unload chunks based on player position

    // --- Player Movement & Physics ---
    if (controls.isLocked) {
        const moveSpeedActual = MOVE_SPEED * delta * 60; // Frame-rate independent speed
        const playerObject = controls.getObject();

        // Horizontal movement (keyboard + touch analog)
        let forwardInput = (keys.w ? 1 : 0) + (keys.s ? -1 : 0) + touchMoveForward;
        let strafeInput  = (keys.d ? 1 : 0) + (keys.a ? -1 : 0) + touchMoveStrafe;

        // Normalize diagonal input so speed stays consistent
        const len = Math.hypot(forwardInput, strafeInput);
        if (len > 1) { forwardInput /= len; strafeInput /= len; }

        if (forwardInput !== 0) playerObject.translateZ(-moveSpeedActual * forwardInput);
        if (strafeInput !== 0)  playerObject.translateX(moveSpeedActual * strafeInput);

        // Vertical movement (Gravity)
        const playerPosition = playerObject.position;

        // Apply gravity
        playerVelocityY -= GRAVITY * delta * 60;

        // Check for ground collision
        groundCheckRaycaster.set(playerPosition, downVector);
        const groundIntersects = groundCheckRaycaster.intersectObjects(worldObjects, true); // Check all world objects
        const onSolidGround = groundIntersects.length > 0 && groundIntersects[0].distance <= PLAYER_HEIGHT + 0.01; // Small buffer

        if (onSolidGround) {
            // Snap to ground if falling onto it
            if (playerVelocityY <= 0) {
                 playerVelocityY = 0;
                 // Adjust position precisely to avoid sinking/floating slightly
                 playerPosition.y = groundIntersects[0].point.y + PLAYER_HEIGHT;
                 onGround = true;
            }
        } else {
             onGround = false; // Not on ground if raycast doesn't hit or hit is too far
        }

        // Apply vertical velocity
        playerPosition.y += playerVelocityY * delta * 60;

        // Prevent falling through world (safety net)
        if (playerPosition.y < baseLevel - stoneDepth * 3) {
            playerPosition.set(currentChunkX * CHUNK_SIZE + CHUNK_SIZE/2, baseLevel + noiseAmplitude + 5, currentChunkZ * CHUNK_SIZE + CHUNK_SIZE/2);
            playerVelocityY = 0;
        }
    }

    // --- Render ---
    renderer.render(scene, camera);
}

// --- Initial Setup ---
updateSelectedBlockUI();
// Initial chunk load around starting position (optional, updateChunks will handle it)
// const startChunkX = Math.floor(camera.position.x / CHUNK_SIZE);
// const startChunkZ = Math.floor(camera.position.z / CHUNK_SIZE);
// currentChunkX = startChunkX + 1; // Force initial load
// currentChunkZ = startChunkZ + 1;
updateChunks(); // Perform initial chunk load based on camera start

console.log("Starting animation loop...");
animate();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});