// Imports via ESM CDNs so this works as a static site (e.g. GitHub Pages)
import * as THREE from 'https://unpkg.com/three@0.175.0/build/three.module.js';
// import { OrbitControls } from 'https://unpkg.com/three@0.175.0/examples/jsm/controls/OrbitControls.js'; // Not needed
import { PointerLockControls } from 'https://unpkg.com/three@0.175.0/examples/jsm/controls/PointerLockControls.js';
import { createNoise2D } from 'https://unpkg.com/simplex-noise@4.0.3/dist/esm/simplex-noise.js';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';


// --- Supabase / Multiplayer Setup ---

// TODO: Replace with your actual Supabase project values:
const SUPABASE_URL = 'https://depvgmvmqapfxjwkkhas.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlcHZnbXZtcWFwZnhqd2traGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzkzNzgsImV4cCI6MjA4MDU1NTM3OH0.WLkWVbp86aVDnrWRMb-y4gHmEOs9sRpTwvT8hTmqHC0';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// We currently target a single world row in the DB
const WORLD_SLUG = 'overworld';
let WORLD_ID = null;

// Auth UI elements
const authOverlay = document.getElementById('auth-overlay');
const authUsername = document.getElementById('auth-username');
const authPassword = document.getElementById('auth-password');
const authSignInBtn = document.getElementById('auth-sign-in');
const authSignUpBtn = document.getElementById('auth-sign-up');
const authStatus = document.getElementById('auth-status');

let currentUser = null;

function setAuthStatus(msg) {
    if (authStatus) authStatus.textContent = msg;
}

async function refreshUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) {
        console.error('getUser error', error);
        return null;
    }
    currentUser = data.user || null;
    return currentUser;
}

function normalizeUsername(u) {
  return (u || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_\.\-]/g, '');
}

function usernameToEmail(username) {
  const u = normalizeUsername(username);
  // Synthetic email to satisfy Supabase email/password auth.
  // To make this feel username-only, disable email confirmations in Supabase Auth settings.
  return `${u}@kidcraft.local`;
}



async function handleSignUp() {
    const email = authUsername?.value.trim();
    const password = authPassword?.value.trim();
    if (!username || !password) {
        setAuthStatus('Username and password required.');
        return;
    }
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
        setAuthStatus(error.message);
        return;
    }
    setAuthStatus('Account created. You can sign in now. If email confirmations are enabled in Supabase, disable them for username-only, then sign in.');
}

async function handleSignIn() {
    const email = authUsername?.value.trim();
    const password = authPassword?.value.trim();
    if (!username || !password) {
        setAuthStatus('Username and password required.');
        return;
    }
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
        setAuthStatus(error.message);
        return;
    }
    currentUser = data.user;
    setAuthStatus('Logged in.');
    await onLoggedIn();
}

authSignUpBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    handleSignUp();
});

authSignInBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    handleSignIn();
});

// Multiplayer globals (player avatars + realtime)
let remotePlayers = new Map(); // user_id -> { mesh, lastSeen }
let realtimeChannel = null;
let lastStateSync = 0;

const remotePlayerGeometry = new THREE.BoxGeometry(0.6, 1.8, 0.6);
const remotePlayerMaterial = new THREE.MeshStandardMaterial({ color: 0x00ffcc });

async function fetchWorldIdBySlug(slug) {
    if (WORLD_ID) return WORLD_ID;
    const { data, error } = await supabase
        .from('worlds')
        .select('id')
        .eq('slug', slug)
        .single();
    if (error) {
        console.error('Failed to load world id', error);
        return null;
    }
    WORLD_ID = data.id;
    return WORLD_ID;
}

async function upsertPlayerProfile() {
    if (!currentUser) return;
    const username = currentUser.email ? currentUser.email.split('@')[0].slice(0, 16) : 'player';
    const { error } = await supabase
        .from('player_profiles')
        .upsert({ user_id: currentUser.id, username }, { onConflict: 'user_id' });
    if (error) console.error('upsertPlayerProfile error', error);
}

async function upsertPlayerState(initialPosition) {
    if (!currentUser) return;
    const worldId = await fetchWorldIdBySlug(WORLD_SLUG);
    if (!worldId) return;

    const playerObject = controls.getObject();
    const pos = initialPosition || playerObject.position;

    const { error } = await supabase
        .from('player_state')
        .upsert({
            user_id: currentUser.id,
            world_id: worldId,
            pos_x: pos.x,
            pos_y: pos.y,
            pos_z: pos.z,
            rot_y: 0,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error) console.error('upsertPlayerState error', error);
}

function spawnOrUpdateRemotePlayer(userId, stateRow) {
    if (currentUser && userId === currentUser.id) return; // don't render self

    let entry = remotePlayers.get(userId);
    if (!entry) {
        const mesh = new THREE.Mesh(remotePlayerGeometry, remotePlayerMaterial);
        mesh.position.set(stateRow.pos_x, stateRow.pos_y, stateRow.pos_z);
        scene.add(mesh);
        entry = { mesh, lastSeen: Date.now() };
        remotePlayers.set(userId, entry);
    } else {
        entry.mesh.position.set(stateRow.pos_x, stateRow.pos_y, stateRow.pos_z);
        entry.lastSeen = Date.now();
    }
}

function removeRemotePlayer(userId) {
    const entry = remotePlayers.get(userId);
    if (entry) {
        scene.remove(entry.mesh);
        remotePlayers.delete(userId);
    }
}

function applyWorldBlockOverride(row) {
    // Placeholder: for now we rely on procedural terrain + realtime edits.
    // You can extend this to fully reconcile DB overrides into your chunk data.
    console.log('World override from DB (not yet applied to meshes):', row);
}

function applyBlockUpdate(row) {
    // Ignore our own events; we've already applied them locally.
    if (currentUser && row.user_id === currentUser.id) {
        return;
    }

    const worldX = row.x;
    const worldY = row.y;
    const worldZ = row.z;

    if (row.action === 'place') {
        const blockType = row.block_type || BLOCK_TYPES.PLANKS;
        const blockMaterial = Array.isArray(materials[blockType])
            ? materials[blockType]
            : materials[blockType].clone();

        const newBlock = new THREE.Mesh(blockGeometry, blockMaterial);
        newBlock.position.set(worldX + 0.5, worldY + 0.5, worldZ + 0.5);
        newBlock.userData.blockType = blockType;
        newBlock.userData.isPlacedBlock = true;
        scene.add(newBlock);
        worldObjects.push(newBlock);
    } else if (row.action === 'break') {
        // Look for a placed block at this coordinate
        const target = worldObjects.find(obj =>
            obj.userData &&
            obj.userData.isPlacedBlock &&
            Math.abs(obj.position.x - (worldX + 0.5)) < 0.01 &&
            Math.abs(obj.position.y - (worldY + 0.5)) < 0.01 &&
            Math.abs(obj.position.z - (worldZ + 0.5)) < 0.01
        );
        if (target) {
            scene.remove(target);
            const idx = worldObjects.indexOf(target);
            if (idx !== -1) worldObjects.splice(idx, 1);
        }
    }
}

async function setupRealtime() {
    if (!currentUser) return;
    const worldId = await fetchWorldIdBySlug(WORLD_SLUG);
    if (!worldId) return;

    if (realtimeChannel) {
        await supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase.channel('grovecraft-realtime')
        // Player state updates
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'player_state',
            filter: `world_id=eq.${worldId}`
        }, payload => {
            spawnOrUpdateRemotePlayer(payload.new.user_id, payload.new);
        })
        .on('postgres_changes', {
            event: 'UPDATE',
            schema: 'public',
            table: 'player_state',
            filter: `world_id=eq.${worldId}`
        }, payload => {
            spawnOrUpdateRemotePlayer(payload.new.user_id, payload.new);
        })
        // Block updates (placed/broken blocks)
        .on('postgres_changes', {
            event: 'INSERT',
            schema: 'public',
            table: 'block_updates',
            filter: `world_id=eq.${worldId}`
        }, payload => {
            applyBlockUpdate(payload.new);
        })
        .subscribe((status) => {
            console.log('Realtime status', status);
        });

    // Initial load: other players in this world
    const { data: states, error } = await supabase
        .from('player_state')
        .select('*')
        .eq('world_id', worldId);
    if (!error && states) {
        for (const row of states) {
            spawnOrUpdateRemotePlayer(row.user_id, row);
        }
    }

    // Initial load: world overrides
    const { data: overrides, error: ovErr } = await supabase
        .from('world_blocks')
        .select('*')
        .eq('world_id', worldId);
    if (!ovErr && overrides) {
        for (const row of overrides) {
            applyWorldBlockOverride(row);
        }
    }
}

async function recordBlockUpdate(x, y, z, action, blockType) {
    if (!currentUser) return;
    const worldId = await fetchWorldIdBySlug(WORLD_SLUG);
    if (!worldId) return;

    const payload = {
        world_id: worldId,
        user_id: currentUser.id,
        x,
        y,
        z,
        action,
        block_type: blockType || null
    };

    const { error } = await supabase
        .from('block_updates')
        .insert(payload);

    if (error) console.error('recordBlockUpdate error', error);
}

async function syncMyPlayerStateIfNeeded(elapsedTime) {
    if (!currentUser) return;
    const now = elapsedTime;
    if (now - lastStateSync < 0.2) return; // ~5 times per second
    lastStateSync = now;

    const worldId = await fetchWorldIdBySlug(WORLD_SLUG);
    if (!worldId) return;

    const playerObject = controls.getObject();
    const pos = playerObject.position;
    const rotY = camera.rotation.y;

    const { error } = await supabase
        .from('player_state')
        .upsert({
            user_id: currentUser.id,
            world_id: worldId,
            pos_x: pos.x,
            pos_y: pos.y,
            pos_z: pos.z,
            rot_y: rotY,
            updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id' });

    if (error) console.error('syncMyPlayerStateIfNeeded error', error);
}

async function onLoggedIn() {
    await refreshUser();
    if (!currentUser) return;

    if (authOverlay) authOverlay.style.display = 'none';

    await fetchWorldIdBySlug(WORLD_SLUG);
    await upsertPlayerProfile();
    await upsertPlayerState();
    await setupRealtime();
}

// Check for existing session when the module loads
refreshUser().then(user => {
    if (user) {
        onLoggedIn();
    }
});

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
                 const blockPos = obj.position;
                 const blockX = Math.floor(blockPos.x);
                 const blockY = Math.floor(blockPos.y);
                 const blockZ = Math.floor(blockPos.z);

                 scene.remove(obj);
                 const index = worldObjects.indexOf(obj);
                 if (index > -1) worldObjects.splice(index, 1);

                 // Notify backend so other players can remove this block
                 recordBlockUpdate(blockX, blockY, blockZ, 'break', obj.userData.blockType || null);

                 // Optional: Dispose geometry/material if not shared
                 // obj.geometry.dispose();
                 // obj.material.dispose();
                 console.log("Removed placed block at", blockX, blockY, blockZ);
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

            // Notify backend so other players can place this block
            const blockX = Math.floor(placePosition.x);
            const blockY = Math.floor(placePosition.y);
            const blockZ = Math.floor(placePosition.z);
            recordBlockUpdate(blockX, blockY, blockZ, 'place', selectedBlockType);

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
        if (fpsDisplayElement) fpsDisplayElement.textContent = `FPS: ${fps}`;
        frameCount = 0;
        fpsLastUpdateTime = elapsedTime;
    }

    // --- Update Chunks ---
    updateChunks(); // Load/unload chunks based on player position

    // --- Player Movement & Physics ---
    if (controls.isLocked) {
        const moveSpeedActual = MOVE_SPEED * delta * 60; // Frame-rate independent speed
        const playerObject = controls.getObject();

        // Horizontal movement
        if (keys.w) playerObject.translateZ(-moveSpeedActual);
        if (keys.s) playerObject.translateZ(moveSpeedActual);
        if (keys.a) playerObject.translateX(-moveSpeedActual);
        if (keys.d) playerObject.translateX(moveSpeedActual);

        // Vertical movement (Gravity)
        const playerPosition = playerObject.position;

        // Apply gravity
        playerVelocityY -= GRAVITY * delta * 60;

        // Apply vertical velocity
        playerPosition.y += playerVelocityY * delta * 60;

        // Ground collision check
        groundCheckRaycaster.set(playerPosition, downVector);
        const groundIntersects = groundCheckRaycaster.intersectObjects(worldObjects, true); // Check all world objects

        if (groundIntersects.length > 0) {
            const dist = groundIntersects[0].distance;
            if (dist <= PLAYER_HEIGHT + 0.1 && playerVelocityY <= 0) {
                // Snap to ground if falling onto it
                playerPosition.y = groundIntersects[0].point.y + PLAYER_HEIGHT;
                playerVelocityY = 0;
                onGround = true;
            } else if (dist > PLAYER_HEIGHT + 0.1) {
                onGround = false;
            }
        } else {
            onGround = false;
        }

        // Prevent falling through world (safety net)
        const minY = baseLevel - stoneDepth * 3;
        if (playerPosition.y < minY) {
            const safeX = currentChunkX * CHUNK_SIZE + CHUNK_SIZE / 2;
            const safeZ = currentChunkZ * CHUNK_SIZE + CHUNK_SIZE / 2;
            playerPosition.set(safeX, baseLevel + noiseAmplitude + 5, safeZ);
            playerVelocityY = 0;
        }
    }

    // --- Multiplayer sync ---
    syncMyPlayerStateIfNeeded(elapsedTime);

    // --- Render ---
    renderer.render(scene, camera);
}

// --- Initial Setup ---
updateSelectedBlockUI();
updateChunks(); // Perform initial chunk load based on camera start

console.log("Starting animation loop...");
animate();

// Handle window resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
