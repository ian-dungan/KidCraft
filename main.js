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

/* =======================
   PROFILE + USERNAME (created in-game)
   ======================= */
function savePreferredUsername(u){
    const n = normalizeUsername(u);
    if (n) localStorage.setItem("kidcraft_username", n);
}
function getPreferredUsername(){
    return normalizeUsername(localStorage.getItem("kidcraft_username") || "");
}
function isAnonymousSession(sess){
    const u = sess?.user;
    if (!u) return false;
    const prov = u.app_metadata?.provider || (u.app_metadata?.providers && u.app_metadata.providers[0]);
    return prov === "anonymous" || !u.email;
}
async function ensurePlayerProfile(session){
    const user_id = session.user.id;
    let username = getPreferredUsername() || `player_${user_id.slice(0,8)}`;

    let { error } = await supabase
        .from("player_profiles")
        .upsert({ user_id, username, settings: {} }, { onConflict: "user_id" });

    if (error && /username|duplicate/i.test(error.message || "")) {
        username = `${username}_${Math.random().toString(36).slice(2,6)}`;
        savePreferredUsername(username);
        const res2 = await supabase
            .from("player_profiles")
            .upsert({ user_id, username, settings: {} }, { onConflict: "user_id" });
        if (res2.error) throw res2.error;
        return username;
    }
    if (error) throw error;
    savePreferredUsername(username);
    return username;
}
const usernameCache = new Map(); // user_id -> username
async function getUsernameForUserId(user_id){
    if (!user_id) return null;
    if (usernameCache.has(user_id)) return usernameCache.get(user_id);
    const { data } = await supabase
        .from("player_profiles")
        .select("username")
        .eq("user_id", user_id)
        .maybeSingle();
    const name = data?.username || null;
    if (name) usernameCache.set(user_id, name);
    return name;
}


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
  const raw = ui.username?.value || "";
  const u = normalizeUsername(raw);
  const p = ui.password?.value || "";
  if (u.length < 3) return setStatus("Username must be 3+ chars (letters/numbers/_).");
  if (p.length < 6) return setStatus("Password must be at least 6 characters.");
  savePreferredUsername(u);
  if (ui.username) ui.username.value = u;
  const { error } = await supabase.auth.signUp({ email: usernameToEmail(u), password: p });
  setStatus(error ? error.message : "Signed up. Now log in.");
};

ui.login.onclick = async () => {
  const raw = ui.username?.value || "";
  const u = normalizeUsername(raw);
  const p = ui.password?.value || "";
  if (u.length < 3) return setStatus("Enter a valid username.");
  if (!p) return setStatus("Enter password.");
  savePreferredUsername(u);
  if (ui.username) ui.username.value = u;
  const { error } = await supabase.auth.signInWithPassword({ email: usernameToEmail(u), password: p });
  setStatus(error ? error.message : "Logged in.");
};

ui.guest.onclick = async () => {
  // Requires: Supabase Auth -> Anonymous sign-ins enabled
  const { error } = await supabase.auth.signInAnonymously();
  setStatus(error ? error.message : "Guest session started.");

  try {
    const sess = await supabase.auth.getSession();
    const uid = sess?.data?.session?.user?.id;
    if (uid) savePreferredUsername(`guest_${uid.slice(0,6)}`);
  } catch {}
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
camera.rotation.order = "YXZ";
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
  if (isMobile()) return;
  // Guard: only request lock if supported and not already locked.
  if (!document.body.requestPointerLock) return;
  if (document.pointerLockElement) return;
  try { controls.lock(); } catch {}
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
addEventListener("keydown", e => { const k = (e.key||""); if(!k) return; keys[k.toLowerCase()] = true; });
addEventListener("keyup", e => { const k = (e.key||""); if(!k) return; keys[k.toLowerCase()] = false; });

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
      pitchObject.rotation.z = 0; yawObject.rotation.z = 0;
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
  camera.rotation.z = 0; yawObject.rotation.z = 0;
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
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, "air");
    if (worldId && userId()) await breakBlockServer(worldId, x,y,z);
  } else if (e.button === 2){ // place
    const hit = raycastBlock();
    if (!hit) return;
    const p = hit.point.clone().add(hit.face.normal.multiplyScalar(0.51));
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const code = getSelectedBlockCode();
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
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
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, code);
    if (worldId && userId()) await placeBlockServer(worldId, x,y,z, code);
  } else {
    // break
    const { x,y,z } = hit.object.userData;
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, "air");
    if (worldId && userId()) await breakBlockServer(worldId, x,y,z);
  }
}, { passive: true });

// =======================
// MULTIPLAYER: PLAYER VISIBILITY
// =======================

/* =======================
   NAME TAGS (Sprite labels)
   ======================= */
function roundRect(ctx, x, y, w, h, r, fill, stroke) {
    if (w < 2 * r) r = w / 2;
    if (h < 2 * r) r = h / 2;
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.arcTo(x+w, y,   x+w, y+h, r);
    ctx.arcTo(x+w, y+h, x,   y+h, r);
    ctx.arcTo(x,   y+h, x,   y,   r);
    ctx.arcTo(x,   y,   x+w, y,   r);
    ctx.closePath();
    if (fill) ctx.fill();
    if (stroke) ctx.stroke();
}

function makeNameTag(text){
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    canvas.width = 256;
    canvas.height = 64;

    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, 8, 8, 240, 48, 10, true, false);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width/2, canvas.height/2 + 2);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(2.6, 0.65, 1);
    sprite.position.set(0, 1.8, 0);
    sprite.userData._tagCanvas = canvas;
    sprite.userData._tagCtx = ctx;
    sprite.userData._tagTexture = texture;
    return sprite;
}

function updateNameTag(sprite, text){
    const canvas = sprite.userData._tagCanvas;
    const ctx = sprite.userData._tagCtx;
    if (!canvas || !ctx) return;
    ctx.clearRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    roundRect(ctx, 8, 8, 240, 48, 10, true, false);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 26px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, canvas.width/2, canvas.height/2 + 2);
    sprite.userData._tagTexture.needsUpdate = true;
}

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
        const tag = makeNameTag('...');
        mesh.add(tag);
        mesh.userData.nameTag = tag;
    otherPlayers.set(uid, mesh);
    scene.add(mesh);
  }
  mesh.position.set(x, y, z);
  mesh.rotation.y = rotY || 0;
  (async ()=>{
    const name = await getUsernameForUserId(uid);
    if (name && mesh.userData.nameTag) updateNameTag(mesh.userData.nameTag, name);
  })();
}

// =======================
// DATABASE INTEGRATION (world_id + realtime)
// =======================
let worldId = null;
let worldSlug = (localStorage.getItem('kidcraft_world') || 'overworld');
let isGuest = false;
let selfUsername = null;
let selfRole = 'player';
let mutedUntil = null;
let realtimeChannels = [];

/* =======================
   SPAWN PROTECTION
   ======================= */
const SPAWN_X = 0;
const SPAWN_Z = 0;
const SPAWN_PROTECT_RADIUS = 10; // blocks
const SPAWN_PROTECT_SECONDS = 20; // seconds after login
let spawnProtectUntil = 0;

function inSpawnProtection(x, z){
    const dx = x - SPAWN_X;
    const dz = z - SPAWN_Z;
    return (dx*dx + dz*dz) <= (SPAWN_PROTECT_RADIUS*SPAWN_PROTECT_RADIUS);
}

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
  if (now - lastStatePush < 250) return; // ~4 updates/sec (free-tier friendly)
  lastStatePush = now;

  
  // Only send if changed meaningfully
  if (!pushPlayerState._lastSent) pushPlayerState._lastSent = {x:0,y:0,z:0,r:0};
  const ls = pushPlayerState._lastSent;
  const p = controls.object.position;
  const r = controls.object.rotation.y;
  const moved = Math.hypot(p.x-ls.x, p.y-ls.y, p.z-ls.z) > 0.05;
  const turned = Math.abs(r-ls.r) > 0.01;
  if (!moved && !turned) return;
  ls.x=p.x; ls.y=p.y; ls.z=p.z; ls.r=r;
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


/* =======================
   CHAT (Realtime)
   ======================= */
const chat = {
  root: document.getElementById("chat"),
  messages: document.getElementById("chat-messages"),
  form: document.getElementById("chat-form"),
  input: document.getElementById("chat-input"),
};
function escapeHtml(s){
  return (s||"").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function addChatLine(username, msg, ts){
  if (!chat.messages) return;
  const line = document.createElement("div");
  line.className = "chat-line";
  const time = ts ? new Date(ts).toLocaleTimeString([], {hour:"2-digit", minute:"2-digit"}) : "";
  line.innerHTML = `<div class="chat-meta">${escapeHtml(username||"player")} • ${escapeHtml(time)}</div><div>${escapeHtml(msg)}</div>`;
  chat.messages.appendChild(line);
  chat.messages.scrollTop = chat.messages.scrollHeight;
}
async function loadRecentChat(){
  if (!worldId) return;
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, world_id, user_id, message, created_at")
    .eq("world_id", worldId)
    .order("created_at", { ascending: true })
    .limit(40);
  if (error) { console.warn("chat load:", error.message); return; }
  chat.messages.innerHTML = "";
  for (const row of data){
    const name = await getUsernameForUserId(row.user_id) || "player";
    addChatLine(name, row.message, row.created_at);
  }
}
async function handleCommand(raw){
  const parts = raw.trim().slice(1).split(/\s+/);
  const cmd = (parts.shift()||"").toLowerCase();
  if (cmd === "help"){
    addChatLine("system", "Commands: /help, /whoami, /mute <username> <minutes> [reason], /admin promote <username> <mod|admin>, /admin demote <username>", new Date().toISOString());
    return true;
  }
  if (cmd === "whoami"){
    await refreshSelfProfile();
      startMobTickerIfAllowed();
    addChatLine("system", `You are ${selfUsername||"player"} (${selfRole})${isGuest ? " [guest]" : ""}.`, new Date().toISOString());
    return true;
  }
  if (cmd === "mute"){
    if (roleRank(selfRole) < 1) { addChatLine("system","You are not a moderator.", new Date().toISOString()); return true; }
    const target = parts.shift();
    const mins = parseInt(parts.shift()||"0",10);
    const reason = parts.join(" ").slice(0,120);
    if (!target || !mins) { addChatLine("system","Usage: /mute <username> <minutes> [reason]", new Date().toISOString()); return true; }
    const { data, error } = await supabase.rpc("rpc_mute_user", { target_username: target, minutes: mins, reason });
    if (error) addChatLine("system", "Mute failed: " + error.message, new Date().toISOString());
    else addChatLine("system", data?.message || "Muted.", new Date().toISOString());
    return true;
  }
  if (cmd === "admin"){
    if (roleRank(selfRole) < 2) { addChatLine("system","You are not an admin.", new Date().toISOString()); return true; }
    const sub = (parts.shift()||"").toLowerCase();
    const target = parts.shift();
    const role = (parts.shift()||"").toLowerCase();
    if (sub === "promote"){
      if (!target || !["mod","admin"].includes(role)) { addChatLine("system","Usage: /admin promote <username> <mod|admin>", new Date().toISOString()); return true; }
      const { data, error } = await supabase.rpc("rpc_set_role", { target_username: target, new_role: role });
      if (error) addChatLine("system","Promote failed: " + error.message, new Date().toISOString());
      else addChatLine("system", data?.message || "Role updated.", new Date().toISOString());
      return true;
    }
    if (sub === "demote"){
      if (!target) { addChatLine("system","Usage: /admin demote <username>", new Date().toISOString()); return true; }
      const { data, error } = await supabase.rpc("rpc_set_role", { target_username: target, new_role: "player" });
      if (error) addChatLine("system","Demote failed: " + error.message, new Date().toISOString());
      else addChatLine("system", data?.message || "Role updated.", new Date().toISOString());
      return true;
    }
    addChatLine("system","Admin commands: /admin promote|demote ...", new Date().toISOString());
    return true;
  }
  addChatLine("system", "Unknown command. Try /help", new Date().toISOString());
  return true;
}

async function sendChat(message){
  if (!worldId || !userId()) return;
  const msg = (message||"").trim();
  if (msg.startsWith('/')) return await handleCommand(msg);
  if (isMutedNow()){ setHint('You are muted.'); return; }
  if (!msg) return;
  // Guests can chat (allowed)
  const { error } = await supabase.from("chat_messages").insert({
    world_id: worldId,
    user_id: userId(),
    message: msg
  });
  if (error) console.warn("chat send:", error.message);
}

if (chat.form){
  chat.form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const msg = chat.input.value;
    chat.input.value = "";
    await sendChat(msg);
  });
}

function subscribeRealtime(){
  if (!worldId) return;

  // Player state updates
  const ch1 = supabase.channel(`kidcraft_state_${worldId}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "player_state", filter: `world_id=eq.${worldId}` },
      (payload)=>{
        const row = payload.new || payload.old;
        if (!row) return;
        upsertOtherPlayer(row.user_id, row.pos_x, row.pos_y, row.pos_z, row.rot_y);
      })
    .subscribe();

  // Block updates (authoritative for edits here)
  const ch2 = supabase.channel(`kidcraft_blocks_${worldId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "block_updates", filter: `world_id=eq.${worldId}` },
      (payload)=>{
        const row = payload.new;
        if (!row || row.world_id !== worldId) return;
        const code = row.action === "break" ? "air" : (row.block_type || "stone");
        applyEditLocal(worldId, row.x, row.y, row.z, code);
      })
    .subscribe();


  // Chat messages
  const ch3 = supabase.channel(`kidcraft_chat_${worldId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `world_id=eq.${worldId}` },
      async (payload)=>{
        const row = payload.new;
        if (!row) return;
        const name = await getUsernameForUserId(row.user_id) || "player";
        addChatLine(name, row.message, row.created_at);
      })
    .subscribe();


  // Mobs
  const ch4 = supabase.channel(`kidcraft_mobs_${worldId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "mobs", filter: `world_id=eq.${worldId}` },
      (payload)=>{
        const row = payload.new || payload.old;
        if (!row) return;
        if (payload.eventType === "DELETE"){
          const mesh = mobs.get(row.id);
          if (mesh){ scene.remove(mesh); mobs.delete(row.id); }
          return;
        }
        upsertMob(row);
      })
    .subscribe();

  realtimeChannels.push(ch1, ch2, ch3, ch4);
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
  isGuest = isAnonymousSession(sess);
  spawnProtectUntil = performance.now() + (SPAWN_PROTECT_SECONDS * 1000);
  if (sess?.user?.id){
    setStatus("Auth OK. Creating profile...");
    try { selfUsername = await ensurePlayerProfile(sess);
      await refreshSelfProfile();
      startMobTickerIfAllowed(); } catch(e){ setStatus("Profile error: " + (e.message||e)); return; }
    setStatus("Joining world...");
    await ensureWorld();
    if (!worldId){
      setStatus("World missing. Run SQL setup in Supabase.");
      return;
    }
    setStatus("World joined. Spawning...");
    const sy = terrainHeight(SPAWN_X, SPAWN_Z) + 3;
    controls.object.position.set(SPAWN_X + 0.5, sy, SPAWN_Z + 0.5);
    setStatus("Loading...");
    loadCachedEdits(worldId);
    subscribeRealtime();
    setHint((isGuest ? "Guest is read-only. " : "") + (isMobile()
      ? "Left: move • Right: look • Tap: break • Double-tap: place"
      : "WASD move • Mouse look (click to lock) • Left click: break • Right click: place"));

    // Hide auth panel after login
    document.getElementById("auth").style.display = "none";
  } else {
    clearRealtime();
    document.getElementById("auth").style.display = "";
    if (chat.root) chat.root.style.display = "none";
    if (chat.messages) chat.messages.innerHTML = "";
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

  camera.rotation.z = 0;
  controls.object.rotation.z = 0;
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


function getSelectedWorldSlug(){
  const sel = document.getElementById('world-select');
  const slug = (sel?.value || worldSlug || 'overworld');
  worldSlug = slug;
  localStorage.setItem('kidcraft_world', slug);
  return slug;
}


async function refreshSelfProfile(){
  if (!userId()) return;
  const { data, error } = await supabase
    .from("player_profiles")
    .select("username, role, muted_until")
    .eq("user_id", userId())
    .maybeSingle();
  if (error) return;
  if (data?.username) selfUsername = data.username;
  if (data?.role) selfRole = data.role;
  mutedUntil = data?.muted_until || null;
}
function isMutedNow(){
  if (!mutedUntil) return false;
  const t = new Date(mutedUntil).getTime();
  return Date.now() < t;
}
function roleRank(r){
  return r === 'admin' ? 2 : (r === 'mod' ? 1 : 0);
}


/********************
 * CRAFTING (RPC)
 ********************/
const craftingUI = {
  toggle: document.getElementById("crafting-toggle"),
  panel: document.getElementById("crafting"),
  close: document.getElementById("crafting-close"),
  list: document.getElementById("crafting-list"),
};

function setCraftingVisible(v){
  if (!craftingUI.panel) return;
  craftingUI.panel.style.display = v ? "" : "none";
}
if (craftingUI.toggle) craftingUI.toggle.addEventListener("click", ()=>{
  const open = craftingUI.panel && craftingUI.panel.style.display !== "none";
  setCraftingVisible(!open);
});
if (craftingUI.close) craftingUI.close.addEventListener("click", ()=> setCraftingVisible(false));

async function loadRecipes(){
  if (!craftingUI.list) return;
  // Fetch recipes + ingredients (simple, small)
  const { data, error } = await supabase
    .from("recipes")
    .select("code, name, output_material_code, output_qty, ingredients:recipe_ingredients(material_code, qty)")
    .order("name", { ascending: true })
    .limit(200);
  if (error) { craftingUI.list.innerHTML = `<div>Recipes unavailable: ${escapeHtml(error.message)}</div>`; return; }

  craftingUI.list.innerHTML = "";
  for (const r of (data||[])){
    const div = document.createElement("div");
    div.className = "recipe";
    const ings = (r.ingredients||[]).map(i => `${i.material_code}×${i.qty}`).join(", ");
    div.innerHTML = `
      <div class="recipe-head">
        <div>
          <div class="recipe-name">${escapeHtml(r.name)}</div>
          <div class="recipe-ings">${escapeHtml(ings || "")}</div>
        </div>
        <button data-recipe="${escapeHtml(r.code)}">Craft</button>
      </div>`;
    div.querySelector("button").addEventListener("click", async ()=>{
      if (!userId()) return;
      const { data, error } = await supabase.rpc("rpc_craft", { recipe_code: r.code, craft_qty: 1, in_world_id: worldId });
      if (error) return setHint("Craft failed: " + error.message);
      setHint(data?.message || "Crafted!");
    });
    craftingUI.list.appendChild(div);
  }
}


/********************
 * MOBS (server-ticked, low frequency)
 ********************/
const mobs = new Map(); // mob_id -> mesh
function mobMesh(type){
  const geom = new THREE.BoxGeometry(0.9,0.9,0.9);
  const mat = new THREE.MeshStandardMaterial({ color: type === "slime" ? 0x44ff66 : 0x66ccff });
  const m = new THREE.Mesh(geom, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
function upsertMob(row){
  let mesh = mobs.get(row.id);
  if (!mesh){
    mesh = mobMesh(row.type);
    scene.add(mesh);
    mobs.set(row.id, mesh);
  }
  mesh.position.set(row.x, row.y, row.z);
  mesh.rotation.y = row.yaw || 0;
}
async function loadMobs(){
  if (!worldId) return;
  // ensure baseline mobs exist
  await supabase.rpc("rpc_ensure_mobs", { in_world_id: worldId });
  const { data, error } = await supabase.from("mobs")
    .select("id, world_id, type, x,y,z,yaw,hp, updated_at")
    .eq("world_id", worldId)
    .limit(200);
  if (error) return;
  for (const row of (data||[])) upsertMob(row);
}
let mobTickTimer = null;
function startMobTickerIfAllowed(){
  if (mobTickTimer) clearInterval(mobTickTimer);
  mobTickTimer = null;
  // Only mods/admins, non-guest, to avoid multiple tickers on free tier.
  if (isGuest) return;
  if (roleRank(selfRole) < 1) return;
  mobTickTimer = setInterval(async ()=>{
    if (!worldId) return;
    await supabase.rpc("rpc_mob_tick", { in_world_id: worldId });
  }, 1000);
}

// Pointer lock errors can happen if user cancels quickly; avoid noisy console.
document.addEventListener("pointerlockerror", () => {
  if (!isMobile()) setHint("Click to lock mouse. (If it fails, try clicking again.)");
});
