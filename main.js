// =====================================================
// KidCraft Multiplayer + Persistence + Mobile Controls
// =====================================================

// CDN-safe imports
import * as THREE from "https://unpkg.com/three@0.175.0/build/three.module.js";
import { PointerLockControls } from "https://unpkg.com/three@0.175.0/examples/jsm/controls/PointerLockControls.js";
import { createNoise2D } from "https://unpkg.com/simplex-noise@4.0.3/dist/esm/simplex-noise.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =======================
// CONFIG (YOU MUST SET)
// =======================
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY";
const WORLD_SLUG = "overworld"; // matches SQL seed

// If you want Guest login: enable Anonymous Sign-ins in Supabase Auth settings.
const ENABLE_GUEST_BUTTON = true;

// =======================
// SUPABASE
// =======================
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Username-only auth (fake email)
function normalizeUsername(u){
  return (u || "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 20);
}
function usernameToEmail(u) {
  const n = normalizeUsername(u);
  return `${n}@kidcraft.local`;
}

const ui = {
  username: document.getElementById("username"),
  password: document.getElementById("password"),
  signup: document.getElementById("signup"),
  login: document.getElementById("login"),
  guest: document.getElementById("guest"),
  status: document.getElementById("status"),
  gyro: document.getElementById("gyro"),
  hotbar: document.getElementById("hotbar"),
  hint: document.getElementById("hint"),
};

ui.guest.style.display = ENABLE_GUEST_BUTTON ? "" : "none";

function setStatus(msg){ ui.status.textContent = msg; }
function setHint(msg){ ui.hint.textContent = msg; }

ui.signup.onclick = async () => {
  const u = ui.username.value;
  const p = ui.password.value;
  if (!u || !p) return setStatus("Enter username + password.");
  const { error } = await supabase.auth.signUp({ email: usernameToEmail(u), password: p });
  setStatus(error ? error.message : "Signed up. Now log in.");
};

ui.login.onclick = async () => {
  const u = ui.username.value;
  const p = ui.password.value;
  if (!u || !p) return setStatus("Enter username + password.");
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(u), password: p });
  setStatus(error ? error.message : "Logged in.");
};

ui.guest.onclick = async () => {
  // Requires: Supabase Auth -> Anonymous sign-ins enabled
  const { error } = await supabase.auth.signInAnonymously();
  setStatus(error ? error.message : "Guest session started.");
};

// =======================
// WORLD DATA STRUCTURES
// =======================
const noise2D = createNoise2D();

// Simple voxel data: chunk key -> Map("x,y,z" => blockCode)
const worldEdits = new Map(); // persisted server-side in world_blocks; cached client-side too.
const chunkMeshes = new Map(); // chunkKey -> THREE.Group

// Material palette (minimal starter; extend to your full materials table later)
const BLOCKS = [
  { code: "grass_block", name: "Grass", color: 0x2a8f3a },
  { code: "dirt", name: "Dirt", color: 0x7a4f2a },
  { code: "stone", name: "Stone", color: 0x7a7a7a },
  { code: "sand", name: "Sand", color: 0xd7c87a },
  { code: "oak_planks", name: "Planks", color: 0xa06b2d },
];

// =======================
// THREE.JS SETUP
// =======================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);

const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1200);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.object);

const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(50, 120, 20);
scene.add(dir);

// Crosshair (desktop)
const cross = document.createElement("div");
cross.style.position="fixed"; cross.style.left="50%"; cross.style.top="50%";
cross.style.width="10px"; cross.style.height="10px"; cross.style.marginLeft="-5px"; cross.style.marginTop="-5px";
cross.style.border="2px solid rgba(255,255,255,0.65)"; cross.style.borderRadius="50%";
cross.style.zIndex="8000"; cross.style.pointerEvents="none";
document.body.appendChild(cross);

// Click to lock on desktop
document.body.addEventListener("click", () => {
  if (!isMobile()) controls.lock();
});

function isMobile(){
  return matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

// =======================
// HOTBAR / INVENTORY (minimal)
// =======================
let hotbarIndex = 0;
function renderHotbar(){
  ui.hotbar.innerHTML = "";
  for (let i=0;i<9;i++){
    const slot = document.createElement("div");
    slot.className = "slot" + (i===hotbarIndex ? " active":"");
    const b = BLOCKS[i % BLOCKS.length];
    slot.textContent = b ? b.name : "";
    ui.hotbar.appendChild(slot);
  }
}
renderHotbar();

addEventListener("keydown", (e)=>{
  const n = parseInt(e.key,10);
  if (n>=1 && n<=9){ hotbarIndex = n-1; renderHotbar(); }
});

// =======================
// INPUT (PC + MOBILE)
// =======================
const keys = {};
addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// Mobile touch controls (invisible zones)
const touchState = {
  move: { id: null, startX:0, startY:0, active:false },
  look: { id: null, lastX:0, lastY:0, active:false }
};
let touchMoveForward = 0;
let touchMoveStrafe = 0;
function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }

function setupTouchZones(){
  const left = document.getElementById("touch-left");
  const right = document.getElementById("touch-right");
  if (!left || !right) return;

  const DEADZONE = 10;
  const MAX_DIST = 70;
  const LOOK_SENS = 0.003;

  left.addEventListener("touchstart", (e)=>{
    const t = e.changedTouches[0]; if (!t) return;
    touchState.move.id = t.identifier;
    touchState.move.startX = t.clientX;
    touchState.move.startY = t.clientY;
    touchState.move.active = true;
  }, {passive:false});

  left.addEventListener("touchmove", (e)=>{
    if (!touchState.move.active) return;
    for (const t of e.changedTouches){
      if (t.identifier !== touchState.move.id) continue;
      const dx = t.clientX - touchState.move.startX;
      const dy = t.clientY - touchState.move.startY;
      let nx = 0, ny = 0;
      if (Math.abs(dx) > DEADZONE) nx = dx / MAX_DIST;
      if (Math.abs(dy) > DEADZONE) ny = dy / MAX_DIST;
      touchMoveStrafe = clamp(nx, -1, 1);
      touchMoveForward = clamp(-ny, -1, 1);
      e.preventDefault();
      break;
    }
  }, {passive:false});

  const endMove = (e)=>{
    for (const t of (e.changedTouches||[])){
      if (t.identifier !== touchState.move.id) continue;
      touchState.move.active = false;
      touchState.move.id = null;
      touchMoveForward = 0;
      touchMoveStrafe = 0;
      break;
    }
  };
  left.addEventListener("touchend", endMove, {passive:false});
  left.addEventListener("touchcancel", endMove, {passive:false});

  right.addEventListener("touchstart", (e)=>{
    const t = e.changedTouches[0]; if (!t) return;
    touchState.look.id = t.identifier;
    touchState.look.lastX = t.clientX;
    touchState.look.lastY = t.clientY;
    touchState.look.active = true;
  }, {passive:false});

  right.addEventListener("touchmove", (e)=>{
    if (!touchState.look.active) return;
    const yawObject = controls.object;
    const pitchObject = camera;

    for (const t of e.changedTouches){
      if (t.identifier !== touchState.look.id) continue;
      const dx = t.clientX - touchState.look.lastX;
      const dy = t.clientY - touchState.look.lastY;
      touchState.look.lastX = t.clientX;
      touchState.look.lastY = t.clientY;
      yawObject.rotation.y -= dx * LOOK_SENS;
      pitchObject.rotation.x = clamp(pitchObject.rotation.x - dy * LOOK_SENS, -Math.PI/2, Math.PI/2);
      e.preventDefault();
      break;
    }
  }, {passive:false});

  const endLook = (e)=>{
    for (const t of (e.changedTouches||[])){
      if (t.identifier !== touchState.look.id) continue;
      touchState.look.active = false;
      touchState.look.id = null;
      break;
    }
  };
  right.addEventListener("touchend", endLook, {passive:false});
  right.addEventListener("touchcancel", endLook, {passive:false});
}
setupTouchZones();

// Gyro aiming (optional)
let gyroEnabled = false;
let lastAlpha = null, lastBeta = null;
ui.gyro.addEventListener("change", async () => {
  if (!ui.gyro.checked) { gyroEnabled = false; lastAlpha = lastBeta = null; return; }
  // iOS requires user gesture + permission request
  if (typeof DeviceOrientationEvent !== "undefined" && typeof DeviceOrientationEvent.requestPermission === "function") {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== "granted") { ui.gyro.checked = false; return; }
    } catch {
      ui.gyro.checked = false;
      return;
    }
  }
  gyroEnabled = true;
});
window.addEventListener("deviceorientation", (e)=>{
  if (!gyroEnabled) return;
  if (e.alpha == null || e.beta == null) return;
  // Alpha = compass-ish yaw, beta = pitch
  if (lastAlpha == null) { lastAlpha = e.alpha; lastBeta = e.beta; return; }
  const da = (e.alpha - lastAlpha);
  const db = (e.beta - lastBeta);
  lastAlpha = e.alpha; lastBeta = e.beta;

  // Scale to radians
  const yawObject = controls.object;
  yawObject.rotation.y -= (da * Math.PI/180) * 0.5;
  camera.rotation.x = clamp(camera.rotation.x - (db * Math.PI/180) * 0.5, -Math.PI/2, Math.PI/2);
}, true);

// =======================
// PLAYER
// =======================
const player = {
  velocityY: 0,
  grounded: false,
  speed: 6.0,
  jump: 7.0,
};
controls.object.position.set(0, 20, 0);
camera.rotation.x = 0;

const raycaster = new THREE.Raycaster();
const tempVec = new THREE.Vector3();

// =======================
// VOXEL WORLD (simple procedural + server edits)
// =======================
const CHUNK = 16;
const VIEW_CHUNKS = 3; // radius in chunks for streaming
const BLOCK_SIZE = 1;

function chunkKey(cx, cz){ return `${cx},${cz}`; }
function worldToChunk(x,z){ return [Math.floor(x/CHUNK), Math.floor(z/CHUNK)]; }
function blockKey(x,y,z){ return `${x},${y},${z}`; }

function terrainHeight(x,z){
  // Simple noise-based terrain (0..64)
  const n = noise2D(x*0.03, z*0.03);
  const h = 18 + Math.floor((n+1)*10);
  return h;
}

function getBlockCode(x,y,z){
  // server/client edits override
  const [cx, cz] = worldToChunk(x,z);
  const k = chunkKey(cx, cz);
  const map = worldEdits.get(k);
  if (map){
    const v = map.get(blockKey(x,y,z));
    if (v === "__air__") return "air";
    if (v) return v;
  }

  const h = terrainHeight(x,z);
  if (y > h) return "air";
  if (y === h) return "grass_block";
  if (y >= h-3) return "dirt";
  return "stone";
}

const geom = new THREE.BoxGeometry(1,1,1);
const materialsByCode = new Map();
function matFor(code){
  if (materialsByCode.has(code)) return materialsByCode.get(code);
  const def = BLOCKS.find(b=>b.code===code) || { color: 0xaaaaaa };
  const m = new THREE.MeshStandardMaterial({ color: def.color });
  materialsByCode.set(code, m);
  return m;
}

function buildChunk(cx, cz){
  const k = chunkKey(cx, cz);
  if (chunkMeshes.has(k)) return;

  const group = new THREE.Group();
  group.userData = { cx, cz };
  const map = worldEdits.get(k) || new Map();
  worldEdits.set(k, map);

  const baseX = cx * CHUNK;
  const baseZ = cz * CHUNK;

  for (let x=0;x<CHUNK;x++){
    for (let z=0;z<CHUNK;z++){
      const wx = baseX + x;
      const wz = baseZ + z;
      const h = terrainHeight(wx, wz);
      for (let y=0;y<=h;y++){
        const code = getBlockCode(wx,y,wz);
        if (code === "air") continue;
        const mesh = new THREE.Mesh(geom, matFor(code));
        mesh.position.set(wx+0.5, y+0.5, wz+0.5);
        mesh.userData = { x:wx, y, z:wz, code };
        group.add(mesh);
      }
    }
  }

  chunkMeshes.set(k, group);
  scene.add(group);
}

function rebuildChunk(cx, cz){
  const k = chunkKey(cx, cz);
  const old = chunkMeshes.get(k);
  if (old){
    scene.remove(old);
    old.traverse(o=>{
      if (o.isMesh){
        o.geometry.dispose?.();
        // shared materials; don't dispose
      }
    });
    chunkMeshes.delete(k);
  }
  buildChunk(cx, cz);
}

function streamChunksAround(px, pz){
  const [pcx, pcz] = worldToChunk(px, pz);
  // build needed
  for (let dx=-VIEW_CHUNKS; dx<=VIEW_CHUNKS; dx++){
    for (let dz=-VIEW_CHUNKS; dz<=VIEW_CHUNKS; dz++){
      buildChunk(pcx+dx, pcz+dz);
    }
  }
  // cull far
  for (const k of chunkMeshes.keys()){
    const [cx, cz] = k.split(",").map(Number);
    if (Math.abs(cx-pcx) > VIEW_CHUNKS+1 || Math.abs(cz-pcz) > VIEW_CHUNKS+1){
      const g = chunkMeshes.get(k);
      scene.remove(g);
      chunkMeshes.delete(k);
    }
  }
}

// =======================
// BLOCK PLACING / BREAKING
// =======================
function raycastBlock(){
  // Cast from camera center
  raycaster.setFromCamera(new THREE.Vector2(0,0), camera);
  const intersects = raycaster.intersectObjects([...chunkMeshes.values()], true);
  const hit = intersects.find(i => i.object?.isMesh);
  if (!hit) return null;
  return hit;
}

function getSelectedBlockCode(){
  return BLOCKS[hotbarIndex % BLOCKS.length].code;
}

// Right-click / tap to place, left-click to break (desktop)
// On mobile: use two-finger tap to place, one-finger tap to break (simple)
let lastTapTime = 0;

function applyEditLocal(world_id, x,y,z, code){
  const [cx, cz] = worldToChunk(x,z);
  const k = chunkKey(cx, cz);
  const map = worldEdits.get(k) || new Map();
  worldEdits.set(k, map);
  map.set(blockKey(x,y,z), code === "air" ? "__air__" : code);
  cacheEdit(world_id, x,y,z, code);
  rebuildChunk(cx, cz);
}

async function placeBlockServer(world_id, x,y,z, code){
  // Writes to world_blocks (authoritative) + logs block_updates
  await supabase.from("world_blocks").upsert({ world_id, x, y, z, material_id: null }, { onConflict: "world_id,x,y,z" });
  await supabase.from("block_updates").insert({ world_id, user_id: currentUserId(), x,y,z, action:"place", block_type: code });
}

async function breakBlockServer(world_id, x,y,z){
  await supabase.from("world_blocks").upsert({ world_id, x,y,z, material_id: null }, { onConflict: "world_id,x,y,z" });
  await supabase.from("block_updates").insert({ world_id, user_id: currentUserId(), x,y,z, action:"break", block_type: "air" });
}

function currentUserId(){
  return (supabase.auth.getUser && supabase.auth.getUser()) ? null : null;
}

// We'll store user id from session
let sessionUserId = null;
function setSessionUserId(s){
  sessionUserId = s?.user?.id || null;
}
function userId(){ return sessionUserId; }

// Desktop mouse controls
window.addEventListener("contextmenu", e=>e.preventDefault());
window.addEventListener("mousedown", async (e)=>{
  if (isMobile()) return;
  if (e.button === 0){ // break
    const hit = raycastBlock();
    if (!hit) return;
    const { x,y,z } = hit.object.userData;
    applyEditLocal(worldId, x,y,z, "air");
    if (worldId && userId()) await breakBlockServer(worldId, x,y,z);
  } else if (e.button === 2){ // place
    const hit = raycastBlock();
    if (!hit) return;
    const p = hit.point.clone().add(hit.face.normal.multiplyScalar(0.51));
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const code = getSelectedBlockCode();
    applyEditLocal(worldId, x,y,z, code);
    if (worldId && userId()) await placeBlockServer(worldId, x,y,z, code);
  }
});

// Mobile tap controls
window.addEventListener("touchend", async (e)=>{
  if (!isMobile()) return;
  const now = performance.now();
  const twoFinger = e.touches && e.touches.length >= 2;
  const doubleTap = (now - lastTapTime) < 260;
  lastTapTime = now;

  const hit = raycastBlock();
  if (!hit) return;

  if (doubleTap || twoFinger){
    // place adjacent
    const p = hit.point.clone().add(hit.face.normal.multiplyScalar(0.51));
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const code = getSelectedBlockCode();
    applyEditLocal(worldId, x,y,z, code);
    if (worldId && userId()) await placeBlockServer(worldId, x,y,z, code);
  } else {
    // break
    const { x,y,z } = hit.object.userData;
    applyEditLocal(worldId, x,y,z, "air");
    if (worldId && userId()) await breakBlockServer(worldId, x,y,z);
  }
}, { passive: true });

// =======================
// MULTIPLAYER: PLAYER VISIBILITY
// =======================
const otherPlayers = new Map(); // user_id -> mesh
function playerMesh(color=0x55aaff){
  const m = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.35, 1.0, 6, 10),
    new THREE.MeshStandardMaterial({ color })
  );
  m.castShadow = false;
  m.receiveShadow = false;
  return m;
}

function upsertOtherPlayer(uid, x,y,z, rotY){
  if (!uid || uid === userId()) return;
  let mesh = otherPlayers.get(uid);
  if (!mesh){
    mesh = playerMesh(0xffaa55);
    otherPlayers.set(uid, mesh);
    scene.add(mesh);
  }
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY || 0;
}

// =======================
// DATABASE INTEGRATION (world_id + realtime)
// =======================
let worldId = null;
let realtimeChannels = [];
let lastStatePush = 0;

async function ensureWorld(){
  const { data, error } = await supabase.from("worlds").select("id,slug").eq("slug", WORLD_SLUG).maybeSingle();
  if (error) { console.warn(error); return null; }
  worldId = data?.id || null;
  return worldId;
}

async function pushPlayerState(){
  if (!worldId || !userId()) return;
  const now = performance.now();
  if (now - lastStatePush < 120) return; // ~8 updates/sec
  lastStatePush = now;

  const p = controls.object.position;
  await supabase.from("player_state").upsert({
    user_id: userId(),
    world_id: worldId,
    pos_x: p.x, pos_y: p.y, pos_z: p.z,
    rot_y: controls.object.rotation.y,
    updated_at: new Date().toISOString()
  });
}

async function pullNearbyWorldBlocks(){
  // Minimal: pull edits around player into client cache. (Your SQL stores material_id; we store block_type via block_updates currently.)
  // This is a placeholder for your full material_id mapping (materials table).
  // We'll still cache by listening to block_updates realtime.
}

function clearRealtime(){
  for (const ch of realtimeChannels){
    try { supabase.removeChannel(ch); } catch {}
  }
  realtimeChannels = [];
}

function subscribeRealtime(){
  if (!worldId) return;

  // Player state updates
  const ch1 = supabase.channel(`kidcraft_state_${worldId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "player_state" },
      (payload)=>{
        const row = payload.new || payload.old;
        if (!row) return;
        upsertOtherPlayer(row.user_id, row.pos_x, row.pos_y, row.pos_z, row.rot_y);
      })
    .subscribe();

  // Block updates (authoritative for edits here)
  const ch2 = supabase.channel(`kidcraft_blocks_${worldId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "block_updates" },
      (payload)=>{
        const row = payload.new;
        if (!row || row.world_id !== worldId) return;
        const code = row.action === "break" ? "air" : (row.block_type || "stone");
        applyEditLocal(worldId, row.x, row.y, row.z, code);
      })
    .subscribe();

  realtimeChannels.push(ch1, ch2);
}

// =======================
// OFFLINE CACHING (simple localStorage)
// =======================
function cacheKey(world_id){ return `kidcraft_edits_${world_id}`; }

function loadCachedEdits(world_id){
  try{
    const raw = localStorage.getItem(cacheKey(world_id));
    if (!raw) return;
    const obj = JSON.parse(raw);
    for (const k in obj){
      const { x,y,z, code } = obj[k];
      const [cx, cz] = worldToChunk(x,z);
      const ck = chunkKey(cx, cz);
      const map = worldEdits.get(ck) || new Map();
      worldEdits.set(ck, map);
      map.set(blockKey(x,y,z), code === "air" ? "__air__" : code);
    }
  }catch{}
}

function cacheEdit(world_id, x,y,z, code){
  try{
    const key = cacheKey(world_id);
    const raw = localStorage.getItem(key);
    const obj = raw ? JSON.parse(raw) : {};
    obj[blockKey(x,y,z)] = { x,y,z, code };
    // keep from exploding: cap entries
    const keys = Object.keys(obj);
    if (keys.length > 5000){
      // drop oldest-ish by deleting first 500
      for (let i=0;i<500;i++) delete obj[keys[i]];
    }
    localStorage.setItem(key, JSON.stringify(obj));
  }catch{}
}

// =======================
// LOGIN FLOW BOOTSTRAP
// =======================
supabase.auth.onAuthStateChange(async (_event, sess) => {
  setSessionUserId(sess);
  if (sess?.user?.id){
    setStatus("Auth OK. Joining world...");
    await ensureWorld();
    if (!worldId){
      setStatus("World missing. Run SQL setup in Supabase.");
      return;
    }
    setStatus("World joined. Loading...");
    loadCachedEdits(worldId);
    subscribeRealtime();
    setHint(isMobile()
      ? "Left: move • Right: look • Tap: break • Double-tap: place"
      : "WASD move • Mouse look (click to lock) • Left click: break • Right click: place");

    // Hide auth panel after login
    document.getElementById("auth").style.display = "none";
  } else {
    clearRealtime();
    document.getElementById("auth").style.display = "";
  }
});

// =======================
// SIMPLE PHYSICS
// =======================
function groundHeightAt(x,z){
  // approximate: the terrain height at this position + 1.7 camera height offset handled separately
  return terrainHeight(Math.floor(x), Math.floor(z)) + 1.0;
}

// =======================
// ANIMATION LOOP
// =======================
let lastT = performance.now();
function animate(){
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now-lastT)/1000);
  lastT = now;

  // Movement input
  let forwardInput = (keys.w ? 1 : 0) + (keys.s ? -1 : 0) + touchMoveForward;
  let strafeInput  = (keys.d ? 1 : 0) + (keys.a ? -1 : 0) + touchMoveStrafe;
  const len = Math.hypot(forwardInput, strafeInput);
  if (len > 1){ forwardInput/=len; strafeInput/=len; }

  const moveSpeed = player.speed * dt;
  if (forwardInput) controls.object.translateZ(-moveSpeed * forwardInput);
  if (strafeInput)  controls.object.translateX(moveSpeed * strafeInput);

  // Gravity + ground
  const pos = controls.object.position;
  const gh = groundHeightAt(pos.x, pos.z);
  const desiredY = gh + 1.0; // player eye-ish
  player.velocityY -= 25 * dt;
  pos.y += player.velocityY * dt;

  if (pos.y < desiredY){
    pos.y = desiredY;
    player.velocityY = 0;
    player.grounded = true;
  } else {
    player.grounded = false;
  }

  // Jump (space or mobile "quick upward swipe" not implemented)
  if (keys[" "] && player.grounded){
    player.velocityY = player.jump;
    player.grounded = false;
  }

  // Chunk streaming
  streamChunksAround(pos.x, pos.z);

  // Multiplayer state push
  pushPlayerState();

  renderer.render(scene, camera);
}
animate();

addEventListener("resize", ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Helpful debug if Supabase keys are unset
if (SUPABASE_URL.startsWith("YOUR_") || SUPABASE_KEY.startsWith("YOUR_")){
  setStatus("Set SUPABASE_URL and SUPABASE_ANON_KEY in main.js");
}
