// === GUARANTEED GLOBAL HELPERS ===
// In ES modules, function declarations inside blocks are block-scoped.
// Use globalThis assignment so helpers are truly global.
if (typeof globalThis.smoothstep !== 'function') {
  globalThis.smoothstep = function(a,b,x){
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t*t*(3 - 2*t);
  };
}
// Local alias
const smoothstep = globalThis.smoothstep;


// =======================
// === SUPABASE PERSISTENCE (inventory/world/furnace) ===

// Global decor defaults (safe)


// =======================
// === MATH / UTIL HELPERS (guarded) ===
if (typeof clamp !== "function") {
  function clamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
}
if (typeof lerp !== "function") {
  function lerp(a, b, t){ return a + (b - a) * t; }
}
if (typeof smoothstep !== "function") {
  function smoothstep(a, b, x){
    const t = clamp((x - a) / (b - a), 0, 1);
    return t*t*(3 - 2*t);
  }
}
if (typeof invLerp !== "function") {
  function invLerp(a, b, v){ return (v - a) / (b - a); }
}
if (typeof frac !== "function") {
  function frac(x){ return x - Math.floor(x); }
}
if (typeof hash2i !== "function") {
  function hash2i(x, z){
    // deterministic 32-bit hash from ints; seed mixed later if _SEED_H32 exists
    let h = (x|0) * 374761393 ^ (z|0) * 668265263 ^ (typeof _SEED_H32 === "number" ? _SEED_H32 : 0);
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177) >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
  }
}
if (typeof rand01_from_xz !== "function") {
  function rand01_from_xz(x,z){
    return (hash2i(x|0, z|0) % 1000000) / 1000000;
  }
}
var DECOR_TALL_GRASS_CHANCE = 0.08;
const WORLD_EDITS_CACHE = new Map(); // key cx,cz -> array edits

const WORLD_ID = "default";
let sessionUserId = null;

// Inventory in-memory map: code -> qty
const INV = new Map();
const MAX_STACK = 64;

function invQty(code){ return INV.get(code) || 0; }
function invSet(code, qty){
  qty = Math.max(0, qty|0);
  if (qty === 0) INV.delete(code); else INV.set(code, qty);
}
function invAdd(code, delta){
  const cur = invQty(code);
  invSet(code, cur + (delta|0));
}

async function supaUpsertInventory(code){
  if (!window.supabase || !sessionUserId) return;
  try {
    const qty = invQty(code);
    const { error } = await window.supabase.from("kidcraft_player_inventory")
      .upsert({ user_id: sessionUserId, code, qty, updated_at: new Date().toISOString() }, { onConflict: "user_id,code" });
    if (error) console.warn("[Inv] upsert failed:", error);
  } catch (err) {
    console.warn("[Inv] upsert error:", err);
  }
}
async function supaLoadInventory(){
  if (!window.supabase || !sessionUserId) return;
  const { data, error } = await window.supabase
    .from("kidcraft_player_inventory")
    .select("code,qty")
    .eq("user_id", sessionUserId);
  if (error) { console.warn("[Inv] load failed", error); return; }
  INV.clear();
  for (const row of (data||[])) invSet(row.code, row.qty);
}

function chunkCoord(v, size){ return Math.floor(v / size); }

async function supaUpsertWorldEdit(x,y,z,code){
  if (!window.supabase) return;
  try {
    const chunk_x = chunkCoord(x, CHUNK_SIZE);
    const chunk_z = chunkCoord(z, CHUNK_SIZE);
    const payload = {
      world: WORLD_ID, x, y, z, chunk_x, chunk_z, code,
      user_id: sessionUserId,
      updated_at: new Date().toISOString()
    };
    const { error } = await window.supabase.from("kidcraft_world_block_edits")
      .upsert(payload, { onConflict: "world,x,y,z" });
    if (error) console.warn("[WorldEdit] upsert failed:", error);
  } catch (err) {
    console.warn("[WorldEdit] upsert error:", err);
  }
}

async function supaLoadWorldEditsForChunk(cx, cz){
  if (!window.supabase) return [];
  const { data, error } = await window.supabase
    .from("kidcraft_world_block_edits")
    .select("x,y,z,code")
    .eq("world", WORLD_ID)
    .eq("chunk_x", cx)
    .eq("chunk_z", cz);
  if (error) { console.warn("[WorldEdits] load failed", error); return []; }
  return data || [];
}

// Furnace persistence (server-timestamped)
async function supaGetFurnace(x,y,z){
  if (!window.supabase) return null;
  const { data, error } = await window.supabase
    .from("kidcraft_furnaces")
    .select("*")
    .eq("world", WORLD_ID).eq("x", x).eq("y", y).eq("z", z)
    .maybeSingle();
  if (error) { console.warn("[Furnace] get failed", error); return null; }
  return data;
}

async function supaUpsertFurnace(state){
  if (!window.supabase) return;
  state.world = WORLD_ID;
  state.updated_at = new Date().toISOString();
  await window.supabase.from("kidcraft_furnaces")
    .upsert(state, { onConflict: "world,x,y,z" });
}

async function supaGetSmeltRecipe(inputCode){
  if (!window.supabase) return null;
  const { data, error } = await window.supabase
    .from("kidcraft_smelting_recipes")
    .select("input_code,output_code,cook_time_ms")
    .eq("input_code", inputCode)
    .maybeSingle();
  if (error) { console.warn("[Smelt] recipe lookup failed", error); return null; }
  return data;
}

function isFuel(code){
  const c = String(code||"").toLowerCase();
  return c.includes("coal") || c.includes("charcoal") || c.includes("wood") || c.includes("plank") || c.includes("log");
}
function fuelBurnMs(code){
  const c = String(code||"").toLowerCase();
  if (c.includes("coal") || c.includes("charcoal")) return 80000;
  if (c.includes("plank")) return 15000;
  if (c.includes("log") || c.includes("wood")) return 15000;
  return 8000;
}

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
const SUPABASE_URL = "https://depvgmvmqapfxjwkkhas.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRlcHZnbXZtcWFwZnhqd2traGFzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQ5NzkzNzgsImV4cCI6MjA4MDU1NTM3OH0.WLkWVbp86aVDnrWRMb-y4gHmEOs9sRpTwvT8hTmqHC0";


// =======================
// === WORLD SEED + ORIGIN SHIFT ===
const DEFAULT_WORLD_SEED = "kidcraft";
function getWorldSeed(){
  // URL ?seed=... overrides; otherwise localStorage; else default
  {const u = new URL(window.location.href);
    const s = u.searchParams.get("seed");
    if (s && s.trim()) {
      localStorage.setItem("kidcraft_seed", s.trim());
      return s.trim();
    }
  }{const ls = localStorage.getItem("kidcraft_seed");
    if (ls && ls.trim()) return ls.trim();
  }return DEFAULT_WORLD_SEED;
}
const WORLD_SEED = getWorldSeed();
let WORLD_OFFSET_X = 0; // in blocks (integer)
let WORLD_OFFSET_Z = 0; // in blocks (integer)
const ORIGIN_SHIFT_THRESHOLD = 1200; // blocks; shift when player drifts far from origin


// Hotbar state
let activeSlot = 0;

// Hotbar renderer (shim)
// Some legacy paths call renderHotbar(); keep it defined.
function renderHotbar(){
  {if (typeof renderHotbarModern === "function") return renderHotbarModern();
    if (typeof renderHotbar_LEGACY === "function") return renderHotbar_LEGACY();
  }
}


const WORLD_SLUG = "overworld"; // matches SQL seed

// Vertical world limits (Minecraft-ish feel)
const MIN_Y = -32;      // bottom "bedrock-ish" depth (unbreakable layer at MIN_Y)
const MAX_Y = 160;      // soft cap used for ore/noise math (rendered by exposure culling)

// Cave generation (client-side procedural)
const CAVE_START_Y = 8;      // below this (and down into negatives) caves can appear
const CAVE_END_Y   = 60;     // above this, caves stop (keeps surface solid)
const CAVE_FREQ    = 0.09;   // cave noise frequency
const CAVE_THRESH  = 0.16;   // lower => more caves
const CAVE_TUBE    = 0.10;   // tube strength

// If you want Guest login: enable Anonymous Sign-ins in Supabase Auth settings.
const ENABLE_GUEST_BUTTON = true;

// =======================
// SUPABASE
// =======================
async function supaLoadRecipes(){
  if (!window.supabase) return [];
  const { data: r, error: er } = await window.supabase.from("kidcraft_recipes").select("*");
  if (er) { console.warn("[Recipes] load failed", er); return []; }
  const { data: ing, error: ei } = await window.supabase.from("kidcraft_recipe_ingredients").select("*");
  if (ei) { console.warn("[Recipes] ingredients load failed", ei); return []; }
  const map = new Map();
  for (const row of r||[]) map.set(row.id, { ...row, ingredients: [] });
  for (const row of ing||[]){ const rec = map.get(row.recipe_id); if (rec) rec.ingredients.push({ code: row.code, qty: row.qty }); }
  return [...map.values()];
}

window.supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Load material list (blocks/ores) from DB to drive palette + world variety
loadMaterialsFromDB();

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
    
    console.log("[Profile] Creating profile for user:", user_id);
    console.log("[Profile] Username:", username);
    console.log("[Profile] Starting upsert...");

    // Wrap with timeout
    const upsertPromise = supabase
        .from("player_profiles")
        .upsert({ user_id, username, settings: {} }, { onConflict: "user_id" })
        .select()
        .single();
    
    const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error("Profile upsert timeout after 10 seconds")), 10000)
    );

    let data, error;
    try {
        const result = await Promise.race([upsertPromise, timeoutPromise]);
        data = result.data;
        error = result.error;
        console.log("[Profile] Upsert completed");
    } catch (timeoutError) {
        console.error("[Profile] TIMEOUT:", timeoutError.message);
        throw timeoutError;
    }

    if (error) {
        console.error("[Profile] UPSERT failed:", error);
        console.error("[Profile] Error code:", error.code);
        console.error("[Profile] Error message:", error.message);
        console.error("[Profile] Error details:", error.details);
        
        // Handle duplicate username
        if (/username|duplicate/i.test(error.message || "")) {
            console.log("[Profile] Username conflict, trying with suffix...");
            username = `${username}_${Math.random().toString(36).slice(2,6)}`;
            savePreferredUsername(username);
            
            const res2Promise = supabase
                .from("player_profiles")
                .upsert({ user_id, username, settings: {} }, { onConflict: "user_id" })
                .select()
                .single();
            
            const timeout2 = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Retry timeout")), 10000)
            );
            
            const res2 = await Promise.race([res2Promise, timeout2]);
            if (res2.error) {
                console.error("[Profile] Retry failed:", res2.error);
                throw res2.error;
            }
            console.log("[Profile] Created with suffix:", username);
            return username;
        }
        throw error;
    }
    
    console.log("[Profile] Successfully created/updated:", data);
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
  // Use a real-looking domain to satisfy Supabase email validation.
  return `${n}@kidcraft.game`;
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

// Prevent Enter key from causing page refresh
if (ui.username) {
  ui.username.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.password?.focus();
    }
  });
}

if (ui.password) {
  ui.password.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      ui.login?.click();
    }
  });
}

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

  // Guarantee: only log in after a successful account creation.
  setStatus("Creating account...");
  const res = await supabase.auth.signUp({ email: usernameToEmail(u), password: p });

  if (res?.error) {
    console.warn("[Auth] signUp error:", res.error);
    const msg = (res.error.message || "").toLowerCase();

    // If user already exists, don't log in automatically (you asked for account creation first).
    if (msg.includes("already") || msg.includes("exists") || res.error.status === 422) {
      return setStatus("Account already exists. Click Log in instead.");
    }
    return setStatus(res.error.message || "Sign up failed.");
  }

  // At this point Supabase has created the user. Now we can log in.
  setStatus("Account created. Logging in...");
  const li = await supabase.auth.signInWithPassword({ email: usernameToEmail(u), password: p });
  if (li?.error) {
    console.warn("[Auth] signIn after signup error:", li.error);
    return setStatus("Account created. Please click Log in.");
  }
  setStatus("Logged in.");
};

ui.login.onclick = async () => {
  const raw = ui.username?.value || "";
  const u = normalizeUsername(raw);
  const p = ui.password?.value || "";
  if (u.length < 3) return setStatus("Enter a valid username.");
  if (!p) return setStatus("Enter password.");
  savePreferredUsername(u);
  if (ui.username) ui.username.value = u;
  
  setStatus("Logging in...");
  const { data, error } = await supabase.auth.signInWithPassword({ 
    email: usernameToEmail(u), 
    password: p 
  });
  
  if (error) {
    console.warn("[Auth] Login error:", error);
    if (error.message.includes("Invalid login credentials")) {
      return setStatus("Wrong username or password. Check spelling or create account.");
    }
    return setStatus(error.message);
  }
  
  if (data?.session) {
    setStatus("Logged in successfully!");
  } else {
    setStatus("Login failed - no session created.");
  }
};

ui.guest.onclick = async () => {
  // Requires: Supabase Auth -> Anonymous sign-ins enabled
  const { error } = await supabase.auth.signInAnonymously();
  setStatus(error ? error.message : "Guest session started.");

  const sess = await supabase.auth.getSession();
  const uid = sess?.data?.session?.user?.id;
  if (uid) savePreferredUsername(`guest_${uid.slice(0,6)}`);
};

// =======================
// WORLD DATA STRUCTURES
// =======================
// Initialize with default seed (will be replaced with world seed)
let noise2D = createNoise2D();

function initializeNoise(seed) {
  console.log("[Noise] Initializing with seed:", seed);
  // Create PRNG from seed
  const alea = (function(seed) {
    let s0 = 0, s1 = 0, s2 = 0, c = 1;
    if (seed) {
      s0 = (seed >>> 0) * 2.3283064365386963e-10;
      seed = (seed + 1831565813) | 0;
      s1 = (seed >>> 0) * 2.3283064365386963e-10;
      seed = (seed + 1831565813) | 0;
      s2 = (seed >>> 0) * 2.3283064365386963e-10;
    }
    return function() {
      const t = 2091639 * s0 + c * 2.3283064365386963e-10;
      s0 = s1; s1 = s2;
      return s2 = t - (c = t | 0);
    };
  })(seed);
  
  // Create noise with seeded RNG
  noise2D = createNoise2D(alea);
  console.log("[Noise] Noise function initialized with seed");
}

// Simple voxel data: chunk key -> Map("x,y,z" => blockCode)
const worldEdits = new Map(); // persisted server-side in world_blocks; cached client-side too.
const chunkMeshes = new Map(); // chunkKey -> THREE.Group

// Material palette (minimal starter; extend to your full materials table later)
const BLOCKS = [
  { code: "Grass_Block", name: "Grass", color: 0x2a8f3a },
  { code: "dirt", name: "Dirt", color: 0x7a4f2a },
  { code: "stone", name: "Stone", color: 0x7a7a7a },
  { code: "sand", name: "Sand", color: 0xd7c87a },
  { code: "oak_planks", name: "Planks", color: 0xa06b2d },
];


// =======================
// === TOOLS + HARVEST RULES (Minecraft-ish) ===
const TOOL_TIER = { hand:0, wood:1, stone:2, iron:3, diamond:4 };
const TOOL_SPEED = { hand:1.0, wood:2.0, stone:4.0, iron:6.0, diamond:8.0 };

const TOOLS = [
  { kind:"tool", code:"wooden_pickaxe", display:"Wood Pick", toolType:"pickaxe", tier:"wood" },
  { kind:"tool", code:"wooden_shovel",  display:"Wood Shovel", toolType:"shovel",  tier:"wood" },
  { kind:"tool", code:"wooden_axe",     display:"Wood Axe",    toolType:"axe",     tier:"wood" },
];

let HOTBAR_ITEMS = []; // tools + blocks
function getActiveItem(){
  return HOTBAR_ITEMS[activeSlot] || { kind:"block", code:"dirt" };
}

function requiredToolFor(code){
  const c = String(code||"");
  const lc = c.toLowerCase();
  // Prefer DB props/tags if present
  const def = (MATERIAL_DEFS && MATERIAL_DEFS.length) ? MATERIAL_DEFS.find(m=>m.code===c) : null;
  const rt = def?.props?.required_tool || def?.required_tool;
  if (rt) return rt;

  if (c === "Grass_Block" || c === "dirt" || c === "sand" || c === "gravel") return "shovel";
  if (lc.includes("log") || lc.includes("plank") || lc.includes("wood")) return "axe";
  if (lc.includes("stone") || lc.includes("cobble") || lc.includes("ore")) return "pickaxe";
  return "hand";
}

function minToolTierFor(code){
  const c = String(code||"");
  const lc = c.toLowerCase();
  const def = (MATERIAL_DEFS && MATERIAL_DEFS.length) ? MATERIAL_DEFS.find(m=>m.code===c) : null;
  const mt = def?.props?.min_tool_tier || def?.min_tool_tier;
  if (mt) return mt;

  // Minecraft-ish defaults
  if (lc.includes("diamond") || lc.includes("emerald") || lc.includes("gold")) return "iron";
  if (lc.includes("iron") || lc.includes("copper") || lc.includes("lapis") || lc.includes("redstone")) return "stone";
  if (lc.includes("ore") || c === "stone" || c === "cobblestone") return "wood";
  return "hand";
}

function dropForBlock(code){
  const c = String(code||"");
  const def = (MATERIAL_DEFS && MATERIAL_DEFS.length) ? MATERIAL_DEFS.find(m=>m.code===c) : null;
  const drop = def?.props?.drops || def?.drops;
  if (drop) return drop;

  const lc = c.toLowerCase();
  // Minecraft-ish ore drops (simplified; no fortune)
  if (lc.includes("coal_ore")) return "coal";
  if (lc.includes("iron_ore")) return "raw_iron";
  if (lc.includes("copper_ore")) return "raw_copper";
  if (lc.includes("gold_ore")) return "raw_gold";
  if (lc.includes("diamond_ore")) return "diamond";
  if (lc.includes("emerald_ore")) return "emerald";
  if (lc.includes("lapis_ore")) return "lapis_lazuli";
  if (lc.includes("redstone_ore")) return "redstone";

  if (c === "Grass_Block") return "dirt";
  if (c === "stone") return "cobblestone";
  return c;
}

function canHarvestBlock(blockCode, toolItem){
  const req = requiredToolFor(blockCode);
  const minTier = TOOL_TIER[minToolTierFor(blockCode)] ?? 0;
  const toolType = toolItem?.toolType || "hand";
  const tier = TOOL_TIER[toolItem?.tier || "hand"] ?? 0;
  if (req === "hand") return true;
  if (toolType !== req) return false;
  return tier >= minTier;
}

function toolSpeedMultiplier(blockCode, toolItem){
  // If wrong tool type, slow down a lot (but still breakable)
  const req = requiredToolFor(blockCode);
  const toolType = toolItem?.toolType || "hand";
  const tier = toolItem?.tier || "hand";
  if (req !== "hand" && toolType !== req) return 0.25;
  return TOOL_SPEED[tier] ?? 1.0;
}

// === Materials loaded from database (optional) ===
let MATERIAL_DEFS = [];           // full list of block materials from DB
let ORE_CODES = [];              // codes tagged 'ore'
let COMMON_BLOCKS = [];          // curated list for hotbar
let MATERIALS_READY = false;

function hashColor(str){
  // Deterministic color without external libs (no colorsys dependency)
  const s = String(str ?? "");
  let h = 2166136261; // FNV-1a 32-bit
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const r = 80 + (h & 0x7F);
  const g = 80 + ((h >>> 8) & 0x7F);
  const b = 80 + ((h >>> 16) & 0x7F);
  return (r << 16) | (g << 8) | b;
}

function seedHash32(str){
  const s = String(str ?? "");
  let h = 2166136261;
  for (let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
const _SEED_H32 = seedHash32(WORLD_SEED);

function hash2i(x, z){
  // deterministic 32-bit hash from ints + seed
  let h = (x|0) * 374761393 ^ (z|0) * 668265263 ^ _SEED_H32;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function rand01_from_xz(x,z){
  return (hash2i(x,z) % 1000000) / 1000000;
}


// tiny int helper (avoid Math.floor in hot path for color build)
function int(x){ return x|0; }

function pickCommonHotbar(materials){
  const want = ["Grass_Block","dirt","stone","cobblestone","sand","oak_planks","oak_log","gravel","torch"];
  const byCode = new Map(materials.map(m=>[m.code,m]));
  const out = [];
  for (const c of want){
    const v = byCode.get(c);
    if (v) out.push({ code: v.code, name: v.display_name, color: hashColor(v.code) });
  }
  // Fill remaining with other natural/wood blocks (non-ore) to 9 slots
  const fallback = materials.filter(m=>m.tags?.includes("natural") || m.tags?.includes("wood") || m.tags?.includes("solid"))
                            .filter(m=>!m.tags?.includes("ore") && m.code!=="air");
  for (const mdef of fallback){
    if (out.length>=9) break;
    if (out.some(x=>x.code===mdef.code)) continue;
    out.push({ code: mdef.code, name: mdef.display_name, color: hashColor(mdef.code) });
  }
  return out.slice(0,9);
}

async function loadMaterialsFromDB(){
  const { data, error } = await supabase
    .from("materials")
    .select("code, display_name, category, tags, hardness, props")
    .eq("category","block")
    .limit(5000);
  if (error) { console.warn("[Materials] load failed:", error.message); return; }
  MATERIAL_DEFS = (data || []).filter(m=>m.code && m.code !== "air");
  ORE_CODES = MATERIAL_DEFS.filter(m=>m.tags?.includes("ore")).map(m=>m.code);
  COMMON_BLOCKS = pickCommonHotbar(MATERIAL_DEFS);
  // If we found a decent set, replace BLOCKS used by hotbar/material palette.
  if (COMMON_BLOCKS.length >= 5){
    BLOCKS.length = 0;
    for (const b of COMMON_BLOCKS) BLOCKS.push(b);
    HOTBAR_ITEMS = [];
    invLoad();
    ensureStarterKit();
    renderHotbar();
  }
  MATERIALS_READY = true;
  console.log("[Materials] Loaded:", MATERIAL_DEFS.length, "blocks,", ORE_CODES.length, "ores");
}



// =======================
// THREE.JS SETUP
// =======================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x87ceeb, 0.0022);


const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1200);
camera.rotation.order = "YXZ";
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const gameContainer = document.getElementById('game-container');
if (!gameContainer) {
  console.error("Game container not found!");
} else {
  gameContainer.appendChild(renderer.domElement);
}

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;


const controls = new PointerLockControls(camera, gameContainer);
scene.add(controls.object);

const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.9);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffffff, 0.9);
dir.position.set(50, 120, 20);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.near = 1;
dir.shadow.camera.far = 400;
dir.shadow.camera.left = -120;
dir.shadow.camera.right = 120;
dir.shadow.camera.top = 120;
dir.shadow.camera.bottom = -120;
scene.add(dir);

// Day/Night (visual-only) - cycles lighting + sky
let timeOfDay = 0.25; // 0..1
const DAY_LENGTH_SECONDS = 10 * 60; // 10 minutes per full cycle

// tiny helper
function _lerp(a,b,t){ return a + (b-a)*t; }

// Crosshair (desktop)
const cross = document.createElement("div");
cross.style.position="fixed"; cross.style.left="50%"; cross.style.top="50%";
cross.style.width="10px"; cross.style.height="10px"; cross.style.marginLeft="-5px"; cross.style.marginTop="-5px";
cross.style.border="2px solid rgba(255,255,255,0.65)"; cross.style.borderRadius="50%";
cross.style.zIndex="8000"; cross.style.pointerEvents="none";
gameContainer.appendChild(cross);

// Click to lock on desktop
gameContainer.addEventListener("click", (e) => {
  if (isMobile()) return;
  
  // Don't lock if game container isn't visible
  if (!gameContainer.classList.contains('active')) return;
  
  // Guard: only request lock if supported and not already locked
  if (!gameContainer.requestPointerLock) return;
  if (document.pointerLockElement) return;
  
  // Request with error handling
  try {
    gameContainer.requestPointerLock();
  } catch (err) {
    console.warn("[PointerLock] Failed to request lock:", err);
  }
}, { passive: true });

// Handle pointer lock errors
document.addEventListener('pointerlockerror', () => {
  console.warn("[PointerLock] Pointer lock error - try clicking the game screen again");
});

// Handle pointer lock change
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement) {
    console.log("[PointerLock] Locked");
  } else {
    console.log("[PointerLock] Unlocked - click to lock again");
  }
});

function isMobile(){
  return matchMedia("(pointer: coarse)").matches || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}



// =======================
// === BLOCK BREAK FX (Minecraft-ish) ===
let breakTargetKey = null;
let breakProgress = 0;          // 0..1
let breaking = false;
let breakHoldStart = 0;
let crackOverlay = null;
let crackMat = null;
const BREAK_TIME_MS_BASE = 520;      // base time (ms) for dirt-ish blocks
let breakTimeMs = BREAK_TIME_MS_BASE;

function breakTimeFor(code, toolItem){
  const c = String(code||"");
  // Use DB hardness if available
  const def = (MATERIAL_DEFS && MATERIAL_DEFS.length) ? MATERIAL_DEFS.find(m=>m.code===c) : null;
  const h = def?.hardness;

  // Base time from hardness (Minecraft-ish)
  // Minecraft hardness: dirt 0.5, stone 1.5, ore 3.0; we map into ms
  let base = BREAK_TIME_MS_BASE;
  if (typeof h === "number" && isFinite(h)){
    // ~0.5 => ~380ms, 1.5 => ~900ms, 3.0 => ~1200ms, obsidian 50 => very long
    base = Math.max(220, Math.min(6500, 180 + h*480));
  } else {
    const lc = c.toLowerCase();
    if (c === "Grass_Block" || c === "dirt" || lc.includes("leaves")) base = 380;
    else if (c === "sand" || c === "gravel") base = 430;
    else if (lc.includes("log") || lc.includes("plank") || lc.includes("wood")) base = 620;
    else if (lc.includes("ore")) base = 1200;
    else if (c === "stone" || c === "cobblestone") base = 900;
    else base = BREAK_TIME_MS_BASE;
  }

  // Tool speed
  const speed = toolSpeedMultiplier(c, toolItem);
  // If wrong/too-low tool tier, still breakable but much slower (Minecraft-ish feel)
  const harvestOk = canHarvestBlock(c, toolItem);
  const tierPenalty = harvestOk ? 1.0 : 3.0;

  return Math.max(120, base / Math.max(0.1, speed)) * tierPenalty;
}

function tex_crack(stage){
  // stage 0..9
  const key = "crack_"+stage;
  return makeCanvasTexture((ctx)=>{
    ctx.clearRect(0,0,TEX_SIZE,TEX_SIZE);
    ctx.lineWidth = 1;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    // deterministic pseudo-random crack lines per stage
    for (let i=0;i<stage*2+2;i++){
      const x0 = (i*3 + stage*5) % TEX_SIZE;
      const y0 = (i*7 + stage*9) % TEX_SIZE;
      const x1 = (x0 + 6 + (i%3)*3) % TEX_SIZE;
      const y1 = (y0 + 4 + (i%4)*2) % TEX_SIZE;
      ctx.beginPath();
      ctx.moveTo(x0+0.5, y0+0.5);
      ctx.lineTo(x1+0.5, y1+0.5);
      ctx.stroke();
    }
    // sprinkle pixels
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i=0;i<stage*8;i++){
      const x = (i*11 + stage*13) % TEX_SIZE;
      const y = (i*5  + stage*17) % TEX_SIZE;
      ctx.fillRect(x,y,1,1);
    }
  }, key);
}

function ensureCrackOverlay(){
  if (crackOverlay) return;
  crackMat = texturedMat(tex_crack(0), { transparent: true, alphaTest: 0.05, side: THREE.DoubleSide });
  crackMat.depthTest = true;
  crackMat.depthWrite = false;
  crackMat.polygonOffset = true;
  crackMat.polygonOffsetFactor = -1;
  crackMat.polygonOffsetUnits = -1;

  const g = new THREE.BoxGeometry(1.02, 1.02, 1.02);
  crackOverlay = new THREE.Mesh(g, crackMat);
  crackOverlay.visible = false;
  crackOverlay.renderOrder = 999;
  scene.add(crackOverlay);
}

function setCrackStage(stage){
  ensureCrackOverlay();
  stage = Math.max(0, Math.min(9, stage|0));
  const tex = tex_crack(stage);
  crackMat.map = tex;
  crackMat.needsUpdate = true;
}

function showCrackAt(x,y,z){
  ensureCrackOverlay();
  crackOverlay.visible = true;
  crackOverlay.position.set(x+0.5, y+0.5, z+0.5);
}

function hideCrack(){
  if (!crackOverlay) return;
  crackOverlay.visible = false;
  breakTargetKey = null;
  breakProgress = 0;
  breaking = false;
}

function spawnBlockParticles(x,y,z, baseCode){
  // simple burst of small quads; purely visual, no collision
  const count = 10 + ((Math.random()*6)|0);
  const group = new THREE.Group();
  const tex = (()=>{
    if (baseCode==="Grass_Block") return tex_grass_top();
    if (baseCode==="dirt") return tex_dirt();
    if (baseCode==="sand") return tex_sand();
    if (baseCode==="stone" || baseCode==="cobblestone") return tex_stone();
    return null;
  })();
  const mat = tex ? texturedMat(tex, { transparent: true, alphaTest: 0.15, side: THREE.DoubleSide }) :
                    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, side: THREE.DoubleSide });

  const geo = new THREE.PlaneGeometry(0.14, 0.14);
  const now = performance.now();
  group.userData.birth = now;
  group.userData.parts = [];

  for (let i=0;i<count;i++){
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x+0.5, y+0.5, z+0.5);
    m.rotation.set(Math.random()*Math.PI, Math.random()*Math.PI, Math.random()*Math.PI);
    const vel = new THREE.Vector3(
      (Math.random()-0.5)*1.6,
      1.0 + Math.random()*1.6,
      (Math.random()-0.5)*1.6
    );
    group.userData.parts.push({ mesh: m, vel });
    group.add(m);
  }
  scene.add(group);

  // add to a global list for update in animate
  if (!window.__particleBursts) window.__particleBursts = [];
  window.__particleBursts.push(group);
}



// =======================
// === ITEM DROPS (entities + magnet pickup) ===
const DROP_DESPAWN_MS = 5 * 60 * 1000;   // 5 minutes like Minecraft
const DROP_PICKUP_RADIUS = 1.6;
const DROP_MERGE_RADIUS = 0.8;
const DROP_MAGNET_ACCEL = 12.0;          // how quickly items get pulled in
const drops = []; // {mesh, code, qty, vel:THREE.Vector3, born:number}

function dropColor(code){
  // simple stable color; use block color when possible
  return colorFor(code);
}

function makeDropMesh(code){
  // small billboarded quad (like an item sprite)
  const geo = new THREE.PlaneGeometry(0.35, 0.35);
  const mat = new THREE.MeshBasicMaterial({
    color: dropColor(code),
    transparent: true,
    opacity: 0.95,
    side: THREE.DoubleSide
  });
  const m = new THREE.Mesh(geo, mat);
  m.userData.kind = "drop";
  return m;
}

function spawnDrop(code, qty, x,y,z){
  if (!code || qty <= 0) return;
  // split into reasonable piles for visuals (still merges/picks up)
  let remaining = qty|0;
  while (remaining > 0){
    const pile = Math.min(remaining, 8);
    remaining -= pile;

    const mesh = makeDropMesh(code);
    mesh.position.set(x+0.5, y+0.65, z+0.5);
    mesh.rotation.y = Math.random()*Math.PI*2;

    // kick outward a bit
    const vel = new THREE.Vector3(
      (Math.random()-0.5)*1.4,
      1.6 + Math.random()*1.1,
      (Math.random()-0.5)*1.4
    );

    scene.add(mesh);
    drops.push({ mesh, code, qty: pile, vel, born: performance.now() });
  }
}

function tryMergeDrops(){
  for (let i=0;i<drops.length;i++){
    const a = drops[i];
    if (!a) continue;
    for (let j=i+1;j<drops.length;j++){
      const b = drops[j];
      if (!b) continue;
      if (a.code !== b.code) continue;
      const d = a.mesh.position.distanceTo(b.mesh.position);
      if (d < DROP_MERGE_RADIUS){
        // merge b into a
        a.qty += b.qty;
        scene.remove(b.mesh);
        drops.splice(j,1);
        j--;
      }
    }
  }
}

async function pickupDrop(idx){
  const d = drops[idx];
  if (!d) return;
  // add to inventory (unlimited qty, displayed as stacks of 64 in UI)
  invAdd(d.code, d.qty);
  // persist
  if (typeof supaUpsertInventory === "function") {
    await supaUpsertInventory(d.code);
  }
  // remove mesh
  scene.remove(d.mesh);
  drops.splice(idx,1);
  setHint(`Picked up: ${d.qty}x ${d.code}`);
  HOTBAR_ITEMS = [];
  renderHotbar();
}

function updateDrops(dt){
  if (!drops.length) return;
  const now = performance.now();

  // Occasionally merge nearby piles (cheap)
  if ((now|0) % 500 < 16) tryMergeDrops();

  const playerPos = controls?.object?.position;
  for (let i=drops.length-1;i>=0;i--){
    const d = drops[i];
    // despawn
    if (now - d.born > DROP_DESPAWN_MS){
      scene.remove(d.mesh);
      drops.splice(i,1);
      continue;
    }

    // simple physics (no collision changes): gravity + drag
    d.vel.y -= 7.5 * dt;
    d.vel.multiplyScalar(1.0 - 0.6*dt);

    // magnet pull when close
    if (playerPos){
      const toPlayer = new THREE.Vector3().subVectors(playerPos, d.mesh.position);
      const dist = toPlayer.length();
      if (dist < DROP_PICKUP_RADIUS){
        toPlayer.normalize();
        d.vel.addScaledVector(toPlayer, DROP_MAGNET_ACCEL * dt);

        // pickup when very close
        if (dist < 0.65){
          pickupDrop(i);
          continue;
        }
      }
    }

    d.mesh.position.addScaledVector(d.vel, dt);

    // float/bob & face camera
    d.mesh.position.y += Math.sin((now - d.born)/250) * 0.0006;
    if (camera) d.mesh.quaternion.copy(camera.quaternion);
  }
}

function updateParticles(dt){
  const arr = window.__particleBursts;
  if (!arr || !arr.length) return;
  for (let i=arr.length-1;i>=0;i--){
    const g = arr[i];
    const age = (performance.now() - g.userData.birth) / 1000;
    if (age > 0.7){
      scene.remove(g);
      arr.splice(i,1);
      continue;
    }
    for (const p of g.userData.parts){
      p.vel.y -= 5.5 * dt; // gravity
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += 2.0*dt;
      p.mesh.rotation.y += 1.6*dt;
      // fade out
      if (p.mesh.material && p.mesh.material.opacity !== undefined){
        p.mesh.material.opacity = Math.max(0, 0.85 - age*1.1);
      }
    }
  }
}

// =======================
// AUDIO (no external assets) + FEEDBACK
// =======================
let audioCtx = null;
let audioUnlocked = false;

function unlockAudio(){
  if (audioUnlocked) return;
  audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
  // iOS/Chrome: resume on user gesture
  audioCtx.resume?.();
  audioUnlocked = true;
}
window.addEventListener("pointerdown", unlockAudio, { once: true, passive: true });
window.addEventListener("touchstart", unlockAudio, { once: true, passive: true });

function tone(freq=440, dur=0.06, type="sine", vol=0.06){
  if (!audioUnlocked || !audioCtx) return;
  const t0 = audioCtx.currentTime;
  const o = audioCtx.createOscillator();
  const g = audioCtx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

function playSfx(kind){
  // tiny "gamey" cues
  if (kind === "break") return tone(220, 0.05, "square", 0.05);
  if (kind === "place") return tone(520, 0.04, "triangle", 0.045);
  if (kind === "jump")  return tone(660, 0.06, "sine", 0.05);
  if (kind === "step")  return tone(160 + Math.random()*40, 0.03, "triangle", 0.03);
}


let lastStepTime = 0;
function surfaceCodeUnderPlayer(){
  const px = Math.floor(controls.object.position.x);
  const pz = Math.floor(controls.object.position.z);
  const py = Math.floor(controls.object.position.y - 1.1);
  return getBlockCode(px, py, pz);
}
function stepSfxNameFor(code){
  const c = String(code||"");
  const lc = c.toLowerCase();
  if (c === "Grass_Block" || lc.includes("Grass_Block")) return "step_grass";
  if (c === "dirt") return "step_dirt";
  if (c === "sand") return "step_sand";
  if (c === "gravel") return "step_gravel";
  if (lc.includes("wood") || lc.includes("plank") || lc.includes("log")) return "step_wood";
  if (lc.includes("stone") || lc.includes("cobble") || lc.includes("ore")) return "step_stone";
  return "step_generic";
}

function bumpShake(amount=0.12){
  // used by movement + block actions
  shake = Math.min(0.25, (shake || 0) + amount);
}

// =======================
// HOTBAR / INVENTORY (minimal)
// =======================
let hotbarIndex = 0;

function swingHotbar(){
  const el = document.getElementById("hotbar");
  if (!el) return;
  el.classList.remove("swing");
  // force reflow
  void el.offsetWidth;
  el.classList.add("swing");
  setTimeout(()=> el.classList.remove("swing"), 180);
}


// =======================
// === SURVIVAL INVENTORY + CRAFTING (Minecraft-ish) ===
let INV_LEGACY = {}; // code -> count
let invOpen = false;

function invStorageKey(){
  const u = (typeof loadPreferredUsername === "function" ? loadPreferredUsername() : null) || localStorage.getItem("kidcraft_username") || "guest";
  return "kidcraft_inv_" + u;
}
function invLoad(){
  const raw = localStorage.getItem(invStorageKey());
  INV_LEGACY = raw ? JSON.parse(raw) : {};
}
function invSave(){
  localStorage.setItem(invStorageKey(), JSON.stringify(INV_LEGACY));
}
function invCount(code){ return (INV_LEGACY && INV_LEGACY[code]) ? INV_LEGACY[code] : 0; }
// [DEDUP] renamed duplicate declaration of 'invAdd' at line 966 -> 'invAdd_DUP2'
function invAdd_DUP2(code, n=1){
  if (!code) return;
  INV_LEGACY[code] = (INV_LEGACY[code]||0) + n;
  if (INV_LEGACY[code] <= 0) delete INV_LEGACY[code];
  invSave();
// legacy hotbar disabled
renderHotbar_LEGACY && renderHotbar_LEGACY();

  renderInventoryPanel();
}
function invTake(code, n=1){
  const c = invCount(code);
  if (c < n) return false;
  INV_LEGACY[code] = c - n;
  if (INV_LEGACY[code] <= 0) delete INV_LEGACY[code];
  invSave();
// legacy hotbar disabled
renderHotbar();

  renderInventoryPanel();
  return true;
}
function invHas_LEGACY(inputs){
  for (const [code, n] of inputs){
    if (invCount(code) < n) return false;
  }
  return true;
}
function invConsume_LEGACY(inputs){
  if (!invHas_LEGACY(inputs)) return false;
  for (const [code,n] of inputs) invTake(code,n);
  return true;
}

// Starting kit (Minecraft-ish vibe; tweak as you like)
function ensureStarterKit(){
  if (localStorage.getItem(invStorageKey()+"_init")) return;
  invAdd("dirt", 32);
  invAdd("Grass_Block", 16);
  invAdd("cobblestone", 24);
  invAdd("oak_log", 8);
  invAdd("oak_planks", 16);
  // starter tools
  invAdd("wooden_pickaxe", 1);
  invAdd("wooden_shovel", 1);
  invAdd("wooden_axe", 1);
  localStorage.setItem(invStorageKey()+"_init","1");
}

function toolTierRank(code){
  const c = String(code||"");
  if (c.startsWith("diamond_")) return TOOL_TIER.diamond;
  if (c.startsWith("iron_")) return TOOL_TIER.iron;
  if (c.startsWith("stone_")) return TOOL_TIER.stone;
  if (c.startsWith("wooden_")) return TOOL_TIER.wood;
  return TOOL_TIER.hand;
}
function bestToolCode(toolType){
  const candidates = [
    "diamond_"+toolType,
    "iron_"+toolType,
    "stone_"+toolType,
    "wooden_"+toolType,
  ];
  for (const c of candidates){
    if (invCount(c) > 0) return c;
  }
  return null;
}

// Crafting recipes (close to Minecraft, simplified; no fuel)
const RECIPES = [
  { name:"Oak Planks (x4)", out:["oak_planks",4], in:[["oak_log",1]] },
  { name:"Sticks (x4)", out:["stick",4], in:[["oak_planks",2]] },
  { name:"Crafting Table", out:["crafting_table",1], in:[["oak_planks",4]] },

  { name:"Wood Pickaxe", out:["wooden_pickaxe",1], in:[["oak_planks",3],["stick",2]] },
  { name:"Wood Shovel",  out:["wooden_shovel",1],  in:[["oak_planks",1],["stick",2]] },
  { name:"Wood Axe",     out:["wooden_axe",1],     in:[["oak_planks",3],["stick",2]] },

  { name:"Stone Pickaxe", out:["stone_pickaxe",1], in:[["cobblestone",3],["stick",2]] },
  { name:"Stone Shovel",  out:["stone_shovel",1],  in:[["cobblestone",1],["stick",2]] },
  { name:"Stone Axe",     out:["stone_axe",1],     in:[["cobblestone",3],["stick",2]] },

  // Smelting (very simplified)
  { name:"Smelt Raw Iron → Iron Ingot", out:["iron_ingot",1], in:[["raw_iron",1]] },
  { name:"Smelt Raw Copper → Copper Ingot", out:["copper_ingot",1], in:[["raw_copper",1]] },
  { name:"Smelt Raw Gold → Gold Ingot", out:["gold_ingot",1], in:[["raw_gold",1]] },

  { name:"Iron Pickaxe", out:["iron_pickaxe",1], in:[["iron_ingot",3],["stick",2]] },
  { name:"Iron Shovel",  out:["iron_shovel",1],  in:[["iron_ingot",1],["stick",2]] },
  { name:"Iron Axe",     out:["iron_axe",1],     in:[["iron_ingot",3],["stick",2]] },

  { name:"Diamond Pickaxe", out:["diamond_pickaxe",1], in:[["diamond",3],["stick",2]] },
  { name:"Diamond Shovel",  out:["diamond_shovel",1],  in:[["diamond",1],["stick",2]] },
  { name:"Diamond Axe",     out:["diamond_axe",1],     in:[["diamond",3],["stick",2]] },
];

function ensureInventoryPanel(){
  if (document.getElementById("invPanel")) return;
  const panel = document.createElement("div");
  panel.id = "invPanel";
  panel.innerHTML = `
    <div class="inv-header">
      <div class="inv-title">Inventory & Crafting</div>
      <div class="inv-hint">Press <b>E</b> to close</div>
    </div>
    <div class="inv-body">
      <div class="inv-col">
        <div class="inv-subtitle">Items</div>
        <div id="invItems" class="inv-items"></div>
      </div>
      <div class="inv-col">
        <div class="inv-subtitle">Craft / Smelt</div>
        <div id="invRecipes" class="inv-recipes"></div>
      </div>
    </div>
  `;
  document.body.appendChild(panel);
}
function toggleInventoryPanel(force){
  ensureInventoryPanel();
  invOpen = (force !== undefined) ? !!force : !invOpen;
  const p = document.getElementById("invPanel");
  if (p) p.style.display = invOpen ? "block" : "none";
  if (invOpen) renderInventoryPanel();
}
function renderInventoryPanel(){
  const p = document.getElementById("invPanel");
  if (!p || !invOpen) return;
  const itemsEl = document.getElementById("invItems");
  const recEl = document.getElementById("invRecipes");
  if (!itemsEl || !recEl) return;

  // items list (sorted)
  const entries = Object.entries(INV_LEGACY).sort((a,b)=>a[0].localeCompare(b[0]));
  itemsEl.innerHTML = entries.length ? "" : "<div class='inv-empty'>Empty</div>";
  for (const [code,count] of entries){
    const row = document.createElement("div");
    row.className = "inv-item";
    row.innerHTML = `<span class="inv-code">${code}</span><span class="inv-count">${count}</span>`;
    itemsEl.appendChild(row);
  }

  // recipes
  recEl.innerHTML = "";
  for (const r of RECIPES){
    const ok = invHas_LEGACY(r.in);
    const btn = document.createElement("button");
    btn.className = "inv-recipe" + (ok ? "" : " disabled");
    btn.disabled = !ok;
    const req = r.in.map(([c,n])=>`${c}x${n}`).join(", ");
    btn.innerHTML = `<div class="inv-recipe-name">${r.name}</div><div class="inv-recipe-req">${req}</div>`;
    btn.onclick = ()=>{
      if (!invConsume_LEGACY(r.in)) return;
      invAdd(r.out[0], r.out[1]);
      setHint(`Crafted ${r.out[0]}x${r.out[1]}`);
      playSfx("place", 0.06);
      swingHotbar();
    };
    recEl.appendChild(btn);
  }
}

function renderHotbar_LEGACY(){
  const el = document.getElementById("hotbar");
  if (!el) return;
  el.innerHTML = "";

  // Slot layout: 0 pickaxe, 1 shovel, 2 axe, 3-8 blocks
  const blockPalette = (BLOCKS && BLOCKS.length) ? BLOCKS.slice(0, 12) : [];
  const blockSlots = [];
  for (const b of blockPalette){
    if (blockSlots.length >= 6) break;
    blockSlots.push({ kind:"block", code:b.code, name:b.name, color:b.color });
  }

  HOTBAR_ITEMS = [
    { kind:"tool", code: bestToolCode("pickaxe") || "wooden_pickaxe", display:"Pickaxe", toolType:"pickaxe", tier: (bestToolCode("pickaxe")||"wooden_pickaxe").split("_")[0] },
    { kind:"tool", code: bestToolCode("shovel")  || "wooden_shovel",  display:"Shovel",  toolType:"shovel",  tier: (bestToolCode("shovel")||"wooden_shovel").split("_")[0] },
    { kind:"tool", code: bestToolCode("axe")     || "wooden_axe",     display:"Axe",     toolType:"axe",     tier: (bestToolCode("axe")||"wooden_axe").split("_")[0] },
    ...blockSlots
  ];

  for (let i=0;i<9;i++){
    const it = HOTBAR_ITEMS[i];
    const slot = document.createElement("div");
    slot.className = "slot" + (i===activeSlot ? " active" : "");
    if (!it){
      slot.classList.add("empty");
      el.appendChild(slot);
      continue;
    }

    const icon = document.createElement("div");
    icon.className = "slot-icon";

    if (it.kind === "tool"){
      // Gray out if you don't actually have the tool
      const have = invCount(it.code) > 0;
      icon.textContent = it.code.includes("pickaxe") ? "⛏️" : it.code.includes("shovel") ? "🧹" : "🪓";
      icon.style.opacity = have ? "1" : "0.35";
      const tierTag = (it.code.split("_")[0] || "wood").toUpperCase();
      const tag = document.createElement("div");
      tag.className = "slot-count";
      tag.textContent = tierTag[0];
      slot.appendChild(tag);
    } else {
      icon.style.background = `#${(it.color ?? colorFor(it.code)).toString(16).padStart(6,"0")}`;
      const cnt = invCount(it.code);
      const countEl = document.createElement("div");
      countEl.className = "slot-count";
      countEl.textContent = cnt ? String(cnt) : "";
      slot.appendChild(countEl);
      if (!cnt) slot.style.opacity = "0.45";
    }

    const label = document.createElement("div");
    label.className = "slot-label";
    label.textContent = it.kind === "tool" ? it.display : (it.name || it.code);

    slot.appendChild(icon);
    slot.appendChild(label);
    slot.onclick = ()=>{ activeSlot=i; renderHotbar_LEGACY(); };

    el.appendChild(slot);
  }
}
// legacy hotbar disabled
renderHotbar();

addEventListener("keydown", (e)=>{
  const n = parseInt(e.key,10);
  if (n>=1 && n<=9){ hotbarIndex = n-1; renderHotbar_LEGACY(); }
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
    const res = await DeviceOrientationEvent.requestPermission();
    if (res !== "granted") { ui.gyro.checked = false; return; }
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
const CHUNK_SIZE = CHUNK; // Alias for compatibility
const VIEW_CHUNKS = 3; // radius in chunks for streaming
const BLOCK_SIZE = 1;

function chunkKey(cx, cz){ return `${cx},${cz}`; }
function worldToChunk(x,z){ return [Math.floor(x/CHUNK), Math.floor(z/CHUNK)]; }
function blockKey(x,y,z){ return `${x},${y},${z}`; }


// =======================
// TERRAIN SHAPING (plains + hills + mountains + lakes + rivers)
// =======================
const SEA_LEVEL = 24;
function abs(x){ return x < 0 ? -x : x; }

function biomeAt(x, z){
  const gx = (x|0) + (WORLD_OFFSET_X|0);
  const gz = (z|0) + (WORLD_OFFSET_Z|0);

  const temp = noise2D(gx * 0.0008, gz * 0.0008); // -1..1
  const humid = noise2D((gx+9999) * 0.0008, (gz-9999) * 0.0008);
  const m = smoothstep(0.25, 0.75, noise2D(gx * 0.0012, gz * 0.0012));

  if (m > 0.68) return "mountains";
  if (temp < -0.25) return "snow";
  if (temp > 0.35 && humid < -0.1) return "desert";
  if (humid > 0.25) return "forest";
  return "plains";
}

function riverMask(x,z){
  // Domain-warped thin bands -> rivers
  const wx = x + noise2D(x*0.0008, z*0.0008) * 26;
  const wz = z + noise2D((x+500)*0.0008, (z+500)*0.0008) * 26;
  const r = abs(noise2D(wx*0.002, wz*0.002));       // 0..1-ish
  return smoothstep(0.03, 0.0, r);                 // 0..1 (1 = river center)
}

function lakeMask(x,z){
  const m = noise2D(x*0.0010, z*0.0010);
  return smoothstep(0.55, 0.82, m);                // 0..1 (1 = lake region)
}

function terrainHeight(x,z){
  // Base: broad smoothness for big plains
  const base = noise2D(x*0.002, z*0.002) * 7.5;     // gentle
  // Hills: rolling variation
  const hills = noise2D(x*0.010, z*0.010) * 6.0;
  // Mountains: only in some regions, masked
  const mountMask = smoothstep(0.25, 0.65, noise2D(x*0.0012, z*0.0012));
  const mountains = noise2D(x*0.004, z*0.004) * 34.0 * mountMask;

  // Plains mask: flattens large regions
  const plainsMask = smoothstep(0.15, 0.55, noise2D(x*0.0015, z*0.0015));

  let h = SEA_LEVEL + base;
  h += hills * (1.0 - mountMask);
  h = lerp(h, SEA_LEVEL + base*0.8, plainsMask*0.8); // flatten
  h += mountains;

  // Lakes: shallow basins
  h -= lakeMask(x,z) * 3.0;  // Reduced from 5.5

  // Rivers: carve long channels
  h -= riverMask(x,z) * 6.0;  // Reduced from 10.0

  return clamp(Math.floor(h), 6, 120);
}



function isPlaceableBlock(code){
  const c = String(code||"");
  // quick accept for known block palette codes
  if (["dirt","Grass_Block","stone","cobblestone","sand","gravel","oak_log","oak_planks"].includes(c)) return true;
  const def = (MATERIAL_DEFS && MATERIAL_DEFS.length) ? MATERIAL_DEFS.find(m=>m.code===c) : null;
  return def ? (def.category === "block") : false;
}

function isSolidCode(code){
  return code && code !== "air" && code !== "__air__" && code !== "water";
}

function pickOreByDepth(y){
  // Depth is negative down to MIN_Y; use Minecraft-ish bands
  // We'll pick from DB-tagged ores when available, else fallback.
  const ores = (ORE_CODES && ORE_CODES.length) ? ORE_CODES : [
    "coal_ore","iron_ore","copper_ore","redstone_ore","lapis_ore","gold_ore","diamond_ore","emerald_ore"
  ];

  const depth = -y; // deeper => larger
  // weights by ore type keyword
  const weighted = [];
  for (const c of ores){
    let w = 0.0;
    const lc = c.toLowerCase();
    if (lc.includes("coal")) w = 1.0;
    else if (lc.includes("copper")) w = 0.9;
    else if (lc.includes("iron")) w = 0.75;
    else if (lc.includes("redstone")) w = depth > 12 ? 0.55 : 0.15;
    else if (lc.includes("lapis")) w = depth > 12 ? 0.35 : 0.10;
    else if (lc.includes("gold")) w = depth > 18 ? 0.25 : 0.05;
    else if (lc.includes("diamond")) w = depth > 22 ? 0.12 : 0.02;
    else if (lc.includes("emerald")) w = depth > 26 ? 0.08 : 0.01;
    else w = 0.05;
    if (w > 0) weighted.push([c,w]);
  }
  // choose
  let sum = 0; for (const [,w] of weighted) sum += w;
  let r = Math.random() * sum;
  for (const [c,w] of weighted){
    r -= w;
    if (r <= 0) return c;
  }
  return weighted[0]?.[0] || "stone";
}


function caveValue(x,y,z){
  // Approximate 3D noise using multiple 2D noise slices mixed with y offsets
  const nA = noise2D(x*CAVE_FREQ + y*0.031, z*CAVE_FREQ - y*0.027);
  const nB = noise2D(x*CAVE_FREQ*0.7 - y*0.041, z*CAVE_FREQ*0.7 + y*0.033);
  const nC = noise2D(x*CAVE_FREQ*1.3 + 100.1, z*CAVE_FREQ*1.3 - 77.7);
  // ridged/tubular feel
  const ridged = 1.0 - Math.abs(nA);
  const tubes  = 1.0 - Math.abs(nB);
  // blend
  return 0.55*ridged + 0.35*tubes + 0.10*((nC+1)/2);
}
function isCaveAir(x,y,z, surfaceY){
  // Keep a roof: don't carve too close to surface, don't carve at bedrock
  if (y <= MIN_Y + 2) return false;
  if (y >= CAVE_END_Y) return false;
  if (y <= CAVE_START_Y || y < surfaceY - 10){
    const v = caveValue(x,y,z);
    // Depth weighting: deeper => slightly more caves
    const depth = Math.max(0, -y);
    const t = CAVE_THRESH + Math.min(0.08, depth*0.0015);
    // Make occasional wider rooms
    const room = noise2D(x*0.03 + 200, z*0.03 - 200) * 0.5 + 0.5;
    const roomBoost = (room < 0.18) ? 0.07 : 0.0;
    return v < (t + roomBoost);
  }
  return false;
}

function getStoneFill(x,y,z){
  // Default fill for underground stone: sometimes ores by noise + depth.
  // Use stable noise field so it doesn't "change" every frame.
  const depth = -y;
  // ore chance rises a bit with depth but stays rare
  const baseChance = 0.02 + Math.min(0.06, depth * 0.0015); // ~2% near y=0, up to ~8% deep
  const n = noise2D(x*0.09, z*0.09) * 0.5 + noise2D(x*0.18 + y*0.03, z*0.18 - y*0.03) * 0.5;
  const v = (n + 1) / 2; // 0..1
  if (v < baseChance){
    return pickOreByDepth(y);
  }
  return "stone";
}

function getBlockCode(x,y,z){
    if (y <= MIN_Y) return "stone";
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
  if (y > h) {
    // Water fill up to sea level
    if (y <= SEA_LEVEL) return "water";
    return "air";
  }
  if (y === h) {
    const b = biomeAt(x,z);
    if (b === "desert") return "sand";
    if (b === "snow") return "snow";
    if (b === "mountains") return "stone";
    return "Grass_Block";  // Changed from grass_block to match materials table
  }
  if (y >= h-3) {
    const b = biomeAt(x,z);
    if (b === "desert") return "sand";
    return "dirt";
  }
  // Caves: carve underground air pockets/tubes
  if (isCaveAir(x,y,z,h)) return "air";
  return "stone";
}

const geom = new THREE.BoxGeometry(1,1,1);
const materialsByCode = new Map();

// =======================
// === BLOCK TEXTURES (minecraft-ish) ===
// Procedural 16x16 pixel textures (no external assets needed)
const TEX_SIZE = 16;
const textureCache = new Map(); // key -> THREE.CanvasTexture
const materialCache2 = new Map(); // code|variant -> THREE.Material or Material[]

function makeCanvasTexture(drawFn, key){
  if (textureCache.has(key)) return textureCache.get(key);
  const c = document.createElement("canvas");
  c.width = TEX_SIZE; c.height = TEX_SIZE;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  drawFn(ctx);
  const tex = new THREE.CanvasTexture(c);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  textureCache.set(key, tex);
  return tex;
}

function rand01(n){
  // deterministic hash -> 0..1
  n = (n ^ (n >>> 16)) >>> 0;
  n = Math.imul(n, 0x7feb352d) >>> 0;
  n = (n ^ (n >>> 15)) >>> 0;
  n = Math.imul(n, 0x846ca68b) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n >>> 0) / 4294967296;
}

function px(ctx,x,y,col){ ctx.fillStyle = col; ctx.fillRect(x,y,1,1); }

function tex_grass_top(){
  return makeCanvasTexture((ctx)=>{
    // base green with noise speckles
    ctx.fillStyle = "#3aa655"; ctx.fillRect(0,0,TEX_SIZE,TEX_SIZE);
    for (let i=0;i<90;i++){
      const x = (i*7)%TEX_SIZE, y = (i*11)%TEX_SIZE;
      const r = rand01(i*92821);
      px(ctx,x,y, r<0.5 ? "rgba(20,90,30,0.35)" : "rgba(90,180,100,0.25)");
    }
    // subtle bright flecks
    for (let i=0;i<24;i++){
      const x = (i*5+3)%TEX_SIZE, y=(i*9+1)%TEX_SIZE;
      px(ctx,x,y,"rgba(180,220,180,0.22)");
    }
  }, "grass_top");
}
function tex_dirt(){
  return makeCanvasTexture((ctx)=>{
    ctx.fillStyle="#8b5a2b"; ctx.fillRect(0,0,TEX_SIZE,TEX_SIZE);
    for (let i=0;i<120;i++){
      const x=(i*3)%TEX_SIZE, y=(i*13)%TEX_SIZE;
      const r=rand01(i*112233);
      px(ctx,x,y, r<0.5 ? "rgba(60,35,15,0.35)" : "rgba(150,95,45,0.25)");
    }
  }, "dirt");
}
function tex_stone(){
  return makeCanvasTexture((ctx)=>{
    ctx.fillStyle="#7a7a7a"; ctx.fillRect(0,0,TEX_SIZE,TEX_SIZE);
    for (let i=0;i<140;i++){
      const x=(i*9)%TEX_SIZE, y=(i*5)%TEX_SIZE;
      const r=rand01(i*998877);
      px(ctx,x,y, r<0.55 ? "rgba(40,40,40,0.28)" : "rgba(200,200,200,0.18)");
    }
  }, "stone");
}
function tex_sand(){
  return makeCanvasTexture((ctx)=>{
    ctx.fillStyle="#d8cf8a"; ctx.fillRect(0,0,TEX_SIZE,TEX_SIZE);
    for (let i=0;i<90;i++){
      const x=(i*4)%TEX_SIZE, y=(i*7)%TEX_SIZE;
      const r=rand01(i*445566);
      px(ctx,x,y, r<0.6 ? "rgba(170,160,90,0.22)" : "rgba(255,250,210,0.14)");
    }
  }, "sand");
}
function tex_grass_side(){
  return makeCanvasTexture((ctx)=>{
    // dirt base
    const d = tex_dirt().image;
    ctx.drawImage(d,0,0);
    // green overlay band at top with noise
    ctx.fillStyle="rgba(58,166,85,1)";
    ctx.fillRect(0,0,TEX_SIZE,6);
    for (let i=0;i<70;i++){
      const x=(i*7)%TEX_SIZE, y=(i*3)%6;
      const r=rand01(i*334455);
      px(ctx,x,y, r<0.5 ? "rgba(20,90,30,0.25)" : "rgba(120,200,130,0.18)");
    }
    // irregular edge pixels downwards
    for (let i=0;i<30;i++){
      const x=(i*5+2)%TEX_SIZE;
      const y=6 + (rand01(i*9911)*3)|0;
      px(ctx,x,y,"rgba(58,166,85,0.85)");
    }
  }, "grass_side");
}
function tex_ore(baseTexFn, speckColor, key){
  return makeCanvasTexture((ctx)=>{
    ctx.drawImage(baseTexFn().image,0,0);
    for (let i=0;i<26;i++){
      const x=(i*5+1)%TEX_SIZE, y=(i*9+3)%TEX_SIZE;
      px(ctx,x,y, speckColor);
      if (i%3===0) px(ctx,(x+1)%TEX_SIZE,y, speckColor);
    }
  }, key);
}

function tex_tall_grass(){
  return makeCanvasTexture((ctx)=>{
    ctx.clearRect(0,0,TEX_SIZE,TEX_SIZE);
    // simple pixel blades with alpha
    for (let i=0;i<28;i++){
      const x = (i*3)%TEX_SIZE;
      const h = 7 + ((rand01(i*12345)*8)|0);
      for (let y=TEX_SIZE-1; y>=TEX_SIZE-h; y--){
        const a = 0.65 - (TEX_SIZE-1-y)*0.03;
        px(ctx,x,y, `rgba(70,190,90,${Math.max(0.12,a).toFixed(3)})`);
        if (rand01(i*777+y*33) < 0.15) px(ctx,(x+1)%TEX_SIZE,y, `rgba(30,120,50,${Math.max(0.10,a-0.15).toFixed(3)})`);
      }
    }
  }, "tall_grass");
}

function texturedMat(tex, opts={}){
  const m = new THREE.MeshStandardMaterial({
    map: tex,
    transparent: !!opts.transparent,
    alphaTest: opts.alphaTest ?? (opts.transparent ? 0.35 : 0),
    side: opts.side ?? THREE.FrontSide
  });
  return m;
}

function grassMaterialArray(){
  // BoxGeometry groups are: +x, -x, +y, -y, +z, -z
  const side = texturedMat(tex_grass_side());
  const top  = texturedMat(tex_grass_top());
  const bottom = texturedMat(tex_dirt());
  return [side, side, top, bottom, side, side];
}

function oreMaterial(code){
  // Simple mapping by keyword; DB can add more later.
  const lc = (code||"").toLowerCase();
  if (lc.includes("coal")) return texturedMat(tex_ore(tex_stone, "rgba(30,30,30,1)", "ore_coal"));
  if (lc.includes("iron")) return texturedMat(tex_ore(tex_stone, "rgba(210,140,90,1)", "ore_iron"));
  if (lc.includes("copper")) return texturedMat(tex_ore(tex_stone, "rgba(220,120,70,1)", "ore_copper"));
  if (lc.includes("gold")) return texturedMat(tex_ore(tex_stone, "rgba(235,205,70,1)", "ore_gold"));
  if (lc.includes("redstone")) return texturedMat(tex_ore(tex_stone, "rgba(210,40,40,1)", "ore_redstone"));
  if (lc.includes("lapis")) return texturedMat(tex_ore(tex_stone, "rgba(60,90,210,1)", "ore_lapis"));
  if (lc.includes("diamond")) return texturedMat(tex_ore(tex_stone, "rgba(60,220,200,1)", "ore_diamond"));
  if (lc.includes("emerald")) return texturedMat(tex_ore(tex_stone, "rgba(40,200,70,1)", "ore_emerald"));
  return texturedMat(tex_ore(tex_stone, "rgba(220,220,220,1)", "ore_generic"));
}

function matFor(code){
  const key = String(code||"");
  if (materialCache2.has(key)) return materialCache2.get(key);

  let mat = null;

  if (key === "Grass_Block"){
    mat = grassMaterialArray();
  } else if (key === "dirt"){
    mat = texturedMat(tex_dirt());
  } else if (key === "stone" || key === "cobblestone"){
    mat = texturedMat(tex_stone());
  } else if (key === "sand"){
    mat = texturedMat(tex_sand());
  } else if ((key||"").toLowerCase().includes("ore")){
    mat = oreMaterial(key);
  } else {
    // Fallback: keep existing color system so DB materials still render
    // If you have a color map already, it will still be used by the rest of the code.
    mat = new THREE.MeshStandardMaterial({ color: colorFor(key) });
  }

  materialCache2.set(key, mat);
  return mat;
}


function shouldPlaceTallGrass(x, y, z){
  const chance = (typeof DECOR_TALL_GRASS_CHANCE === "number") ? DECOR_TALL_GRASS_CHANCE : 0.08;
  const gx = (x|0) + (WORLD_OFFSET_X|0);
  const gz = (z|0) + (WORLD_OFFSET_Z|0);
  return rand01_from_xz(gx, gz) < chance;
}

function makeTallGrassMesh(){
  // crossed planes (like Minecraft)
  const key = "__tall_grass_mat";
  let mat = materialCache2.get(key);
  if (!mat){
    mat = texturedMat(tex_tall_grass(), { transparent: true, alphaTest: 0.35, side: THREE.DoubleSide });
    materialCache2.set(key, mat);
  }
  const plane = new THREE.PlaneGeometry(1, 1);
  const g = new THREE.Group();
  const a = new THREE.Mesh(plane, mat);
  const b = new THREE.Mesh(plane, mat);
  a.position.y = 0.5; b.position.y = 0.5;
  a.rotation.y = Math.PI/4;
  b.rotation.y = -Math.PI/4;
  // tag as decor so interactions can treat it as plant
  a.userData.kind = "decor"; b.userData.kind="decor";
  g.userData.kind = "decor";
  g.add(a); g.add(b);
  return g;
}



function tryPlaceVillage(setBlock, getH, getBlock, x, z, biome){
  // Simple village: cluster of houses + dirt paths. Plains/forest only.
  if (!(biome === "plains" || biome === "forest")) return false;

  const gx = (x|0) + (WORLD_OFFSET_X|0);
  const gz = (z|0) + (WORLD_OFFSET_Z|0);

  // Region-based seed so it's rare but consistent
  const region = 256;
  const rx = Math.floor(gx / region);
  const rz = Math.floor(gz / region);
  const r0 = rand01_from_xz(rx * 9991, rz * 9973);

  if (r0 > 0.18) return false; // ~18% of regions have a village candidate

  // Village center inside region (deterministic)
  const ox = Math.floor((rand01_from_xz(rx*1237, rz*8911) - 0.5) * region * 0.6);
  const oz = Math.floor((rand01_from_xz(rx*7331, rz*1777) - 0.5) * region * 0.6);
  const cx = rx * region + ox;
  const cz = rz * region + oz;

  // Only place if this chunk contains the center-ish
  if (Math.abs(gx - cx) > 24 || Math.abs(gz - cz) > 24) return false;

  const cy = getH(cx, cz);
  if (cy <= SEA_LEVEL+1) return false;
  if (!isAreaMostlyFlat(getH, cx, cz, 10, 3)) return false;

  const houseCount = 3 + Math.floor(rand01_from_xz(cx+55, cz-55) * 4); // 3..6
  const spots = [
    [0,0],[12,0],[-12,0],[0,12],[0,-12],[12,12],[-12,12],[12,-12],[-12,-12]
  ];

  const path = "dirt_path";
  const floor = "oak_planks";
  const wall  = "oak_log";
  const roof  = "oak_planks";

  function carvePathLine(x0,z0,x1,z1){
    const steps = Math.max(Math.abs(x1-x0), Math.abs(z1-z0));
    for (let i=0;i<=steps;i++){
      const t = steps===0?0:i/steps;
      const px = Math.round(lerp(x0,x1,t));
      const pz = Math.round(lerp(z0,z1,t));
      const py = getH(px,pz);
      // don't path underwater
      if (py <= SEA_LEVEL) continue;
      // replace surface
      setBlock(px, py, pz, path);
      // clear tall grass
      if (getBlock(px, py+1, pz) === "tall_grass") setBlock(px, py+1, pz, "air");
    }
  }

  function placeHouse(hx,hz){
    const hy = getH(hx,hz);
    if (hy <= SEA_LEVEL+1) return false;
    if (!isAreaMostlyFlat(getH, hx,hz, 4, 2)) return false;
    const w = 7, d = 9, hh = 5;

    // floor + clear interior
    for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
      for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
        setBlock(hx+dx, hy, hz+dz, floor);
        for (let dy=1; dy<=hh+2; dy++) setBlock(hx+dx, hy+dy, hz+dz, "air");
      }
    }
    // walls
    for (let dy=1; dy<=hh; dy++){
      for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
        setBlock(hx-Math.floor(w/2), hy+dy, hz+dz, wall);
        setBlock(hx+Math.floor(w/2), hy+dy, hz+dz, wall);
      }
      for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
        setBlock(hx+dx, hy+dy, hz-Math.floor(d/2), wall);
        setBlock(hx+dx, hy+dy, hz+Math.floor(d/2), wall);
      }
    }
    // door
    setBlock(hx, hy+1, hz+Math.floor(d/2), "air");
    setBlock(hx, hy+2, hz+Math.floor(d/2), "air");

    // roof
    for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
      for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
        setBlock(hx+dx, hy+hh+1, hz+dz, roof);
      }
    }
    return true;
  }

  // Place houses and paths to center
  let placed = 0;
  for (let i=0;i<spots.length && placed<houseCount;i++){
    const sx = cx + spots[i][0];
    const sz = cz + spots[i][1];
    if (placeHouse(sx,sz)){
      carvePathLine(sx,sz,cx,cz);
      placed++;
    }
  }
  // central plaza path cross
  carvePathLine(cx-14, cz, cx+14, cz);
  carvePathLine(cx, cz-14, cx, cz+14);

  return placed > 0;
}

function isAreaMostlyFlat(getH, cx, cz, radius, maxDelta){
  let minH = 1e9, maxH = -1e9;
  for (let dz=-radius; dz<=radius; dz++){
    for (let dx=-radius; dx<=radius; dx++){
      const h = getH(cx+dx, cz+dz);
      minH = Math.min(minH, h);
      maxH = Math.max(maxH, h);
      if (maxH - minH > maxDelta) return false;
    }
  }
  return true;
}

function tryPlaceTree(setBlock, x, y, z, biome){
  // Biome-aware tree distribution (Minecraft-ish)
  const gx = (x|0) + (WORLD_OFFSET_X|0);
  const gz = (z|0) + (WORLD_OFFSET_Z|0);

  let density = 0.0;
  if (biome === "forest") density = 0.10;
  else if (biome === "plains") density = 0.025;
  else if (biome === "snow") density = 0.04;
  else density = 0.0;

  if (density <= 0) return false;
  if (rand01_from_xz(gx, gz) > density) return false;

  // Type selection: birch in forest sometimes, spruce in snow, oak otherwise
  let trunk = "oak_log", leaves = "oak_leaves";
  if (biome === "snow") { trunk = "spruce_log"; leaves = "spruce_leaves"; }
  else if (biome === "forest" && rand01_from_xz(gx+31, gz-31) < 0.35) { trunk = "birch_log"; leaves = "birch_leaves"; }

  const h = (biome === "snow" ? 6 : 5) + Math.floor(rand01_from_xz(gx+17, gz-17) * 3); // 5..7 (snow 6..8)
  for (let i=1; i<=h; i++) setBlock(x, y+i, z, trunk);

  const top = y + h;
  const radius = (biome === "snow") ? 3 : 2;
  for (let dy=-radius; dy<=radius; dy++){
    for (let dz=-radius; dz<=radius; dz++){
      for (let dx=-radius; dx<=radius; dx++){
        const d = Math.abs(dx) + Math.abs(dz) + Math.abs(dy);
        if (d > (radius*2 + 1)) continue;
        if (dy === radius && (Math.abs(dx) === radius || Math.abs(dz) === radius)) continue;
        setBlock(x+dx, top+dy, z+dz, leaves);
      }
    }
  }
  return true;
}

function tryPlaceHouse(setBlock, getH, x, z, biome){
  if (biome !== "plains") return false;
  // rare per chunk cell
  const gx = x + WORLD_OFFSET_X;
  const gz = z + WORLD_OFFSET_Z;
  if (rand01_from_xz(gx*3, gz*3) > 0.002) return false; // ~1 per 500 blocks^2

  // choose center and check flatness
  const y = getH(x, z);
  if (y < SEA_LEVEL+1) return false;
  if (!isAreaMostlyFlat(getH, x, z, 4, 2)) return false;

  const w = 7, d = 9, h = 5;
  const floor = "oak_planks";
  const wall = "oak_log";
  const roof = "oak_planks";
  const air = "air";

  // floor + clear
  for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
    for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
      setBlock(x+dx, y, z+dz, floor);
      for (let dy=1; dy<=h+1; dy++){
        setBlock(x+dx, y+dy, z+dz, air);
      }
    }
  }
  // walls
  for (let dy=1; dy<=h; dy++){
    for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
      setBlock(x-Math.floor(w/2), y+dy, z+dz, wall);
      setBlock(x+Math.floor(w/2), y+dy, z+dz, wall);
    }
    for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
      setBlock(x+dx, y+dy, z-Math.floor(d/2), wall);
      setBlock(x+dx, y+dy, z+Math.floor(d/2), wall);
    }
  }
  // door opening on south wall
  setBlock(x, y+1, z+Math.floor(d/2), air);
  setBlock(x, y+2, z+Math.floor(d/2), air);

  // roof (simple flat)
  for (let dz=-Math.floor(d/2); dz<=Math.floor(d/2); dz++){
    for (let dx=-Math.floor(w/2); dx<=Math.floor(w/2); dx++){
      setBlock(x+dx, y+h+1, z+dz, roof);
    }
  }
  return true;
}

function buildChunk(cx, cz){
  const k = chunkKey(cx, cz);
  if (chunkMeshes.has(k)) return;

  const group = new THREE.Group();
  group.userData = { cx, cz };
  const map = worldEdits.get(k) || new Map();
  worldEdits.set(k, map);

  const created = new Set(); // track rendered blocks so edits don't double-spawn
  const baseX = cx * CHUNK;
  const baseZ = cz * CHUNK;

  // Base terrain (procedural + edits) - render ONLY exposed blocks (performance)
  for (let x=0;x<CHUNK;x++){
    for (let z=0;z<CHUNK;z++){
      const wx = baseX + x;
      const wz = baseZ + z;
      const h = terrainHeight(wx, wz);
      // render down to MIN_Y, but cull interior blocks
      for (let y=MIN_Y; y<=h; y++){
        const code = getBlockCode(wx,y,wz);
        if (code === "air") continue;

        // exposure culling: only render if any neighbor is air
        const exposed =
          getBlockCode(wx+1,y,wz) === "air" ||
          getBlockCode(wx-1,y,wz) === "air" ||
          getBlockCode(wx,y+1,wz) === "air" ||
          getBlockCode(wx,y-1,wz) === "air" ||
          getBlockCode(wx,y,wz+1) === "air" ||
          getBlockCode(wx,y,wz-1) === "air";

        if (!exposed) continue;

        const mesh = new THREE.Mesh(geom, matFor(code));
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.position.set(wx+0.5, y+0.5, wz+0.5);
        mesh.userData = { x:wx, y, z:wz, code };
        group.add(mesh);
        created.add(blockKey(wx,y,wz));

        // Decorations: tall grass on exposed grass tops (no collision, harvestable)
        if (code === "Grass_Block" && getBlockCode(wx,y+1,wz) === "air" && shouldPlaceTallGrass(wx,y,wz)){
          const plant = makeTallGrassMesh();
          plant.position.set(wx+0.5, y+1.0, wz+0.5);
          // subtle random rotation
          plant.rotation.y = rand01((wx*31 ^ wz*17)>>>0) * Math.PI;
          group.add(plant);
        }
      }
    }
  }

  // Render edits ABOVE terrain height (this is what enables building "new" blocks in the air)
  for (const [bk, v] of map.entries()){
    if (!v || v === "__air__") continue;
    if (created.has(bk)) continue;

    const parts = bk.split(",").map(Number);
    if (parts.length !== 3) continue;
    const [x,y,z] = parts;

    // Only render edits that belong to this chunk
    const [ecx, ecz] = worldToChunk(x, z);
    if (ecx !== cx || ecz !== cz) continue;

    const mesh = new THREE.Mesh(geom, matFor(v));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.set(x+0.5, y+0.5, z+0.5);
    mesh.userData = { x, y, z, code: v };
    group.add(mesh);
    created.add(bk);
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
  return (BLOCKS[hotbarIndex] || BLOCKS[0]).code;
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
  // Validate coordinates
  if (x === undefined || y === undefined || z === undefined) {
    console.error(`[Block] Invalid coordinates: (${x},${y},${z})`);
    return;
  }
  
  // Use world_blocks table (UUID world_id, integer material_id)
  // Fallback: grass_block -> grass if not found
  let material = MATERIAL_DEFS.find(m => m.code === code);
  if (!material && code === "Grass_Block") {
    material = MATERIAL_DEFS.find(m => m.code === "Grass_Block");
  }
  
  const material_id = material?.id || null;
  
  if (!material_id) {
    console.warn(`[Block] Unknown material code: ${code}`);
    return;
  }
  
  console.log(`[Block] Placing ${code} at (${x},${y},${z}) material_id: ${material_id}`);
  
  const { error } = await supabase.from("world_blocks").upsert({ 
    world_id, 
    x, y, z, 
    material_id 
  }, { onConflict: "world_id,x,y,z" });
  
  if (error) {
    console.error("[Block] Place failed:", error);
  }
}

async function breakBlockServer(world_id, x,y,z){
  // Validate coordinates
  if (x === undefined || y === undefined || z === undefined) {
    console.error(`[Block] Invalid break coordinates: (${x},${y},${z})`);
    return;
  }
  
  console.log(`[Block] Breaking block at (${x},${y},${z})`);
  
  // Delete from world_blocks (sets to air/null)
  const { error } = await supabase.from("world_blocks")
    .delete()
    .eq("world_id", world_id)
    .eq("x", x)
    .eq("y", y)
    .eq("z", z);
  
  if (error) {
    console.error("[Block] Break failed:", error);
  }
}

// We'll store user id from session
// sessionUserId already declared (deduped)

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
    if (y <= MIN_Y) { setHint("Too deep - unbreakable layer."); return; }
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, "air");
    bumpShake(0.10);
    playSfx("break");
    if (worldId && userId()) await breakBlockServer(worldId, x,y,z);
  } else if (e.button === 2){ // place
    const hit = raycastBlock();
    if (!hit) return;
    const p = hit.point.clone().add(hit.face.normal.multiplyScalar(0.51));
    const x = Math.floor(p.x), y = Math.floor(p.y), z = Math.floor(p.z);
    const code = getSelectedBlockCode();
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, code);
    bumpShake(0.08);
    swingHotbar();
    playSfx("place");
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
    bumpShake(0.08);
    swingHotbar();
    playSfx("place");
    if (worldId && userId()) await placeBlockServer(worldId, x,y,z, code);
  } else {
    // break
    const { x,y,z } = hit.object.userData;
    if (inSpawnProtection(x,z)) { setHint("Spawn protected."); return; }
    applyEditLocal(worldId, x,y,z, "air");
    bumpShake(0.10);
    playSfx("break");
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
const SPAWN_X = 100;
const SPAWN_Z = 100;
const SPAWN_PROTECT_RADIUS = 10; // blocks
const SPAWN_PROTECT_SECONDS = 20; // seconds after login
let spawnProtectUntil = 0;

function inSpawnProtection(x, z){
    const dx = x - SPAWN_X;
    const dz = z - SPAWN_Z;
    return (dx*dx + dz*dz) <= (SPAWN_PROTECT_RADIUS*SPAWN_PROTECT_RADIUS);
}

let lastStatePush = 0;

let worldSeed = null;

async function ensureWorld(){
  try {
    const slug = getSelectedWorldSlug();
    const { data, error } = await supabase
      .from("worlds")
      .select("id,slug,seed")  // Also fetch seed!
      .eq("slug", slug)
      .maybeSingle();
    if (error) { 
      console.warn("[World] Failed to fetch world:", error); 
      return null; 
    }
    worldId = data?.id || null;
    worldSeed = data?.seed || 12345; // Default seed if missing
    
    if (worldId) {
      console.log(`[World] Joined world: ${slug} (id: ${worldId}, seed: ${worldSeed})`);
      
      // Reinitialize noise with world seed
      initializeNoise(worldSeed);
      
      // Clear any existing chunks and rebuild with correct seed
      for (const [k, group] of chunkMeshes.entries()) {
        scene.remove(group);
        group.traverse(o => {
          if (o.isMesh) o.geometry.dispose?.();
        });
      }
      chunkMeshes.clear();
      console.log("[World] Chunks cleared for regeneration with correct seed");
      
    } else {
      console.warn(`[World] World not found: ${slug}`);
    }
    return worldId;
  } catch (err) {
    console.error("[World] ensureWorld error:", err);
    return null;
  }
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
  
  try {
    const { error } = await supabase.from("player_state").upsert({
      user_id: userId(),
      world_id: worldId,
      pos_x: p.x, pos_y: p.y, pos_z: p.z,
      rot_y: controls.object.rotation.y,
      updated_at: new Date().toISOString()
    });
    if (error) console.warn("[PlayerState] Update failed:", error);
  } catch (err) {
    console.warn("[PlayerState] Update error:", err);
  }
}

async function pullNearbyWorldBlocks(){
  // Minimal: pull edits around player into client cache. (Your SQL stores material_id; we store block_type via block_updates currently.)
  // This is a placeholder for your full material_id mapping (materials table).
  // We'll still cache by listening to block_updates realtime.
}

function clearRealtime(){
  for (const ch of realtimeChannels){
    ch.unsubscribe();
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

  // Cap + fade older lines (keeps UI clean)
  const lines = [...chat.messages.querySelectorAll(".chat-line")];
  const MAX = 60;
  if (lines.length > MAX){
    for (let i=0;i<lines.length-MAX;i++) lines[i].remove();
  }
  const lines2 = [...chat.messages.querySelectorAll(".chat-line")];
  const fadeStart = Math.max(0, lines2.length - 10);
  lines2.forEach((el, i)=>{
    if (i < fadeStart) el.style.opacity = "0.35";
    else el.style.opacity = "1";
  });

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
  if (!worldId || !userId()) {
    console.warn("[Chat] Cannot send - worldId or userId missing");
    return;
  }
  const msg = (message||"").trim();
  if (msg.startsWith('/')) return await handleCommand(msg);
  if (isMutedNow()){ 
    setHint('You are muted.'); 
    console.warn("[Chat] User is muted");
    return; 
  }
  if (!msg) return;
  
  console.log("[Chat] Sending message:", msg);
  
  // Insert message
  const { data, error } = await supabase.from("chat_messages").insert({
    world_id: worldId,
    user_id: userId(),
    message: msg
  }).select().single();
  
  if (error) {
    console.error("[Chat] Send failed:", error);
    console.error("[Chat] Error code:", error.code);
    console.error("[Chat] Error message:", error.message);
    setHint('Chat failed: ' + error.message);
  } else {
    console.log("[Chat] Message sent successfully:", data);
  }
}

if (chat.form){
  chat.form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    const msg = chat.input.value;
    chat.input.value = "";
    await sendChat(msg);
  });
  
  // Mobile fix: ensure input can receive focus
  if (chat.input) {
    // Prevent pointer lock from interfering with chat input
    chat.input.addEventListener("focus", () => {
      console.log("[Chat] Input focused");
      // Exit pointer lock when focusing chat
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
    });
    
    chat.input.addEventListener("blur", () => {
      console.log("[Chat] Input blurred");
    });
    
    // Mobile: tap on chat input should focus it
    chat.input.addEventListener("touchstart", (e) => {
      e.stopPropagation(); // Prevent touch handlers from interfering
      console.log("[Chat] Touch on input");
      chat.input.focus();
    }, { passive: true });
  }
}

function subscribeRealtime(){
  if (!worldId) {
    console.warn("[Realtime] Cannot subscribe - worldId is null");
    return;
  }
  
  console.log(`[Realtime] Subscribing to channels for world: ${worldId}`);

  // Player state updates
  const ch1 = supabase.channel(`kidcraft_state_${worldId}`)
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "player_state", filter: `world_id=eq.${worldId}` },
      (payload)=>{
        const row = payload.new || payload.old;
        if (!row) return;
        console.log("[Realtime] Player update:", row.user_id);
        upsertOtherPlayer(row.user_id, row.pos_x, row.pos_y, row.pos_z, row.rot_y);
      })
    .subscribe((status) => {
      console.log(`[Realtime] Player state channel: ${status}`);
    });

  // Block updates (listen to world_blocks table)
  const ch2 = supabase.channel(`kidcraft_blocks_${worldId}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "world_blocks", filter: `world_id=eq.${worldId}` },
      (payload)=>{
        console.log("[Realtime] Block update:", payload.eventType, payload);
        const row = payload.new || payload.old;
        if (!row || row.world_id !== worldId) return;
        
        // Convert material_id to code
        let code = "air";
        if (payload.eventType === "DELETE" || !row.material_id) {
          code = "air";
        } else {
          const material = MATERIAL_DEFS.find(m => m.id === row.material_id);
          code = material?.code || "stone";
        }
        
        console.log(`[Realtime] Applying block: ${code} at (${row.x},${row.y},${row.z})`);
        applyEditLocal(worldId, row.x, row.y, row.z, code);
      })
    .subscribe((status) => {
      console.log(`[Realtime] Blocks channel: ${status}`);
    });


  // Chat messages
  const ch3 = supabase.channel(`kidcraft_chat_${worldId}`)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "chat_messages", filter: `world_id=eq.${worldId}` },
      async (payload)=>{
        console.log("[Chat] Realtime message received:", payload);
        const row = payload.new;
        if (!row) {
          console.warn("[Chat] No data in payload");
          return;
        }
        const name = await getUsernameForUserId(row.user_id) || "player";
        console.log("[Chat] Adding line from:", name, "message:", row.message);
        addChatLine(name, row.message, row.created_at);
      })
    .subscribe((status) => {
      console.log(`[Realtime] Chat channel: ${status}`);
    });


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
const CACHE_VERSION = 2; // Increment to invalidate old caches after bug fixes

function cacheKey(world_id){ return `kidcraft_edits_v${CACHE_VERSION}_${world_id}`; }

function loadCachedEdits(world_id){
  // Clear old version caches
  for (let i = 0; i < CACHE_VERSION; i++) {
    const oldKey = `kidcraft_edits_v${i}_${world_id}`;
    if (localStorage.getItem(oldKey)) {
      console.log(`[Cache] Clearing old cache version ${i}`);
      localStorage.removeItem(oldKey);
    }
  }
  
  const raw = localStorage.getItem(cacheKey(world_id));
  if (!raw) return;
  
  try {
    const obj = JSON.parse(raw);
    for (const k in obj){
      const { x,y,z, code } = obj[k];
      if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
        console.warn(`[Cache] Invalid cached block:`, k);
        continue;
      }
      const [cx, cz] = worldToChunk(x,z);
      const ck = chunkKey(cx, cz);
      const map = worldEdits.get(ck) || new Map();
      worldEdits.set(ck, map);
      map.set(blockKey(x,y,z), code === "air" ? "__air__" : code);
    }
    console.log(`[Cache] Loaded ${Object.keys(obj).length} cached edits`);
  } catch (err) {
    console.warn("[Cache] Failed to load cache:", err);
    localStorage.removeItem(cacheKey(world_id));
  }
}

function cacheEdit(world_id, x,y,z, code){
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
}

// Global helper for debugging/resetting world
window.resetWorld = async function() {
  console.log("[Reset] Clearing all world data...");
  
  // Clear all localStorage
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.includes('kidcraft')) {
      localStorage.removeItem(key);
    }
  }
  
  // Clear in-memory world edits
  worldEdits.clear();
  
  // Clear chunk meshes
  for (const [k, group] of chunkMeshes.entries()) {
    scene.remove(group);
  }
  chunkMeshes.clear();
  
  console.log("[Reset] World reset complete. Refresh the page to start fresh.");
  alert("World data cleared! Refresh the page (F5) to start with a clean world.");
};

// Global helper to clear DATABASE corrupted blocks
window.clearDatabaseBlocks = async function() {
  if (!window.supabase) {
    console.error("[ClearDB] Supabase not available");
    return;
  }
  
  console.log("[ClearDB] WARNING: This will delete ALL block edits from database!");
  const confirm1 = prompt("Type 'DELETE ALL' to confirm:");
  if (confirm1 !== 'DELETE ALL') {
    console.log("[ClearDB] Cancelled");
    return;
  }
  
  console.log("[ClearDB] Deleting all world block edits...");
  const { error } = await window.supabase
    .from("kidcraft_world_block_edits")
    .delete()
    .neq("world", "impossible_value"); // Deletes all rows
  
  if (error) {
    console.error("[ClearDB] Failed to delete:", error);
    alert("Failed to clear database: " + error.message);
  } else {
    console.log("[ClearDB] Database blocks cleared!");
    alert("Database cleared! Now run: localStorage.clear() then refresh.");
  }
};

// =======================
// LOGIN FLOW BOOTSTRAP
// =======================
supabase.auth.onAuthStateChange(async (_event, sess) => {
  setSessionUserId(sess);
  isGuest = isAnonymousSession(sess);
  spawnProtectUntil = performance.now() + (SPAWN_PROTECT_SECONDS * 1000);
  if (sess?.user?.id){
    setStatus("Auth OK. Creating profile...");
    try {
      // Create profile if doesn't exist
      selfUsername = await ensurePlayerProfile(sess);
      console.log("[Profile] Username:", selfUsername);
      
      // Then refresh to get role and mute status
      await refreshSelfProfile();
    } catch (err) {
      console.error("[Profile] Failed to create profile:", err);
      setStatus("Profile creation failed: " + err.message);
      return;
    }
    
    startMobTickerIfAllowed();
    
    setStatus("Joining world...");
    await ensureWorld(); // CRITICAL: Get worldId for multiplayer
    
    setStatus("World joined. Generating spawn...");
    
    // Force initial chunk generation around spawn FIRST
    const [spawnCx, spawnCz] = worldToChunk(SPAWN_X, SPAWN_Z);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dz = -1; dz <= 1; dz++) {
        buildChunk(spawnCx + dx, spawnCz + dz);
      }
    }
    
    console.log(`[Spawn] Chunks built, looking for ground at (${SPAWN_X}, ${SPAWN_Z})`);
    
    // NOW find solid ground by scanning down
    let sy = 80; // Start high
    let foundGround = false;
    
    for (let y = 80; y >= MIN_Y; y--) {
      const code = getBlockCode(SPAWN_X, y, SPAWN_Z);
      if (code && code !== "air" && code !== "water") {
        sy = y + 2; // Spawn 2 blocks above solid ground
        foundGround = true;
        console.log(`[Spawn] Found ground: ${code} at Y=${y}, spawning at Y=${sy}`);
        break;
      }
    }
    
    // Fallback if no ground found
    if (!foundGround) {
      console.warn("[Spawn] No ground found after scanning, using default Y=35");
      sy = 35;
    }
    
    controls.object.position.set(SPAWN_X + 0.5, sy, SPAWN_Z + 0.5);
    
    setStatus("Loading...");
    loadCachedEdits(worldId);
    
    subscribeRealtime(); // Now worldId is set, multiplayer will work
    setHint((isGuest ? "Guest session. " : "") + (isMobile()
      ? "Left: move • Right: look • Tap: break • Double-tap: place"
      : "WASD move • Mouse look (click to lock) • Left click: break • Right click: place") + " | Console: resetWorld() to clear corrupted data");

    // Hide auth panel after login, show game
    const authPanel = document.getElementById("auth");
    const gameContainer = document.getElementById("game-container");
    
    if (authPanel) {
      authPanel.classList.add('hidden');
      console.log("[Auth] Auth panel hidden - user logged in");
    } else {
      console.error("[Auth] Cannot find auth panel element!");
    }
    
    if (gameContainer) {
      gameContainer.classList.add('active');
      console.log("[Auth] Game container visible");
    } else {
      console.error("[Auth] Cannot find game container!");
    }
    
    if (chat.root) chat.root.style.display = "";
  } else {
    // Not logged in - show auth, hide game
    clearRealtime();
    
    const authPanel = document.getElementById("auth");
    const gameContainer = document.getElementById("game-container");
    
    if (authPanel) authPanel.classList.remove('hidden');
    if (gameContainer) gameContainer.classList.remove('active');
    
    if (chat.root) chat.root.style.display = "none";
    if (chat.messages) chat.messages.innerHTML = "";
  }
});

// =======================
// SIMPLE PHYSICS
// =======================
function groundHeightAt(x,z){
  // Find the highest solid block beneath the player in this column, respecting edits.
  // Prevents "teleport back to surface" when you dig out a deep shaft.
  const wx = Math.floor(x);
  const wz = Math.floor(z);
  // start scan near player's current feet height
  const startY = Math.floor(controls.object.position.y);
  for (let y = startY; y >= MIN_Y; y--){
    const code = getBlockCode(wx, y, wz);
    // Only count actually solid blocks (not air, water, or undefined)
    if (code && isSolidCode(code)){
      return y + 1.0;
    }
  }
  return MIN_Y + 1.0;
}

// =======================
// ANIMATION LOOP (polished feel)
// =======================
let lastT = performance.now();

// horizontal velocity (world space)
player.vx = 0;
player.vz = 0;

// jump buffering / coyote time
let jumpQueuedUntil = 0;
let coyoteUntil = 0;

// camera polish
let shake = 0;
let shakeX = 0, shakeY = 0;
let stepAccum = 0;

addEventListener("keydown", (e)=>{
  if ((e.key||"").toLowerCase() === " "){
    // buffer jump for a short window
    jumpQueuedUntil = performance.now() + 140;
  }
});

function lerp(a,b,t){ return a + (b-a)*t; }


function maybePlayFootsteps(){
  // Only when moving on ground
  const now = performance.now();
  const pos = controls.object.position;
  const groundY = groundHeightAt(pos.x, pos.z);
  const onGround = Math.abs(pos.y - groundY) < 0.25;
  // Estimate horizontal motion by using velocity if present, else use keys state
  const vx = (window.__velX ?? 0);
  const vz = (window.__velZ ?? 0);
  const speed = Math.hypot(vx, vz);
  if (!onGround || speed < 0.6) return;
  const sprinting = !!keys["ShiftLeft"] || !!keys["ShiftRight"];
  const interval = sprinting ? 240 : 320;
  if (now - lastStepTime < interval) return;
  lastStepTime = now;
  const code = surfaceCodeUnderPlayer();
  playSfx(stepSfxNameFor(code), 0.08);
}


function maybeOriginShift(){
  if (!controls || !controls.object) return;
  const px = controls.object.position.x;
  const pz = controls.object.position.z;
  if (Math.abs(px) < ORIGIN_SHIFT_THRESHOLD && Math.abs(pz) < ORIGIN_SHIFT_THRESHOLD) return;

  const sx = Math.trunc(px);
  const sz = Math.trunc(pz);
  WORLD_OFFSET_X += sx;
  WORLD_OFFSET_Z += sz;

  // shift player back near origin
  controls.object.position.x -= sx;
  controls.object.position.z -= sz;

  // shift world meshes
  for (const g of (typeof chunkMeshes !== 'undefined' ? chunkMeshes.values() : [])){
    if (g && g.position) {
      g.position.x -= sx;
      g.position.z -= sz;
    }
  }
}

function animate(){
  requestAnimationFrame(animate);
  const now = performance.now();
  const dt = Math.min(0.05, (now-lastT)/1000);

  // Update block particles
  updateParticles(dt);
  updateDrops(dt);
  maybePlayFootsteps();

  // Update breaking progress (hold-to-break)
  if (breaking && breakTargetKey && crackOverlay && crackOverlay.visible){
    // derive position from overlay
    const bx = Math.floor(crackOverlay.position.x - 0.5);
    const by = Math.floor(crackOverlay.position.y - 0.5);
    const bz = Math.floor(crackOverlay.position.z - 0.5);

    breakProgress = Math.min(1, breakProgress + (dt*1000) / breakTimeMs);
    const stage = Math.min(9, Math.floor(breakProgress * 10));
    setCrackStage(stage);

    if (breakProgress >= 1){
      // Actually remove block now
      const code = getBlockCode(bx,by,bz);
      // Don't break air or unbreakable
      if (code !== "air" && by > MIN_Y){
        const tool = getActiveItem();
        const harvestOk = canHarvestBlock(code, tool);
        const dropped = harvestOk ? dropForBlock(code) : null;
        setBlockEdit(bx,by,bz,"air");
        swingHotbar();
        playSfx("break", 0.14);
        bumpShake(0.06);
        spawnBlockParticles(bx,by,bz, code);
        if (!harvestOk){
          setHint(`Need ${requiredToolFor(code)} (tier ${minToolTierFor(code)}+) - dropped nothing.`);
        } else {
          setHint(`Picked up: ${dropped}`);
        }

        rebuildChunkAt(bx,bz);
        // also rebuild neighbors
        rebuildChunkAt(bx+1,bz);
        rebuildChunkAt(bx-1,bz);
        rebuildChunkAt(bx,bz+1);
        rebuildChunkAt(bx,bz-1);
      }
      hideCrack();
    }
  } else {
    // If not holding, ensure we aren't showing stale crack overlay
    // (mouseup handler also hides)
  }
  lastT = now;

  // Day/Night visual cycle
  timeOfDay = (timeOfDay + dt / DAY_LENGTH_SECONDS) % 1;
  // sun angle: midnight at 0, noon at 0.5
  const sun = Math.sin(timeOfDay * Math.PI * 2) * 0.5 + 0.5; // 0..1
  const sunH = lerp(0.12, 1.0, Math.max(0, Math.min(1, (sun - 0.15) / 0.85)));
  dir.intensity = lerp(0.15, 1.0, sunH);
  hemi.intensity = lerp(0.35, 0.95, sunH);
  dir.position.set(
    Math.cos(timeOfDay * Math.PI * 2) * 120,
    lerp(18, 140, sunH),
    Math.sin(timeOfDay * Math.PI * 2) * 120
  );
  // sky + fog color
  const daySky = new THREE.Color(0x87ceeb);
  const duskSky = new THREE.Color(0xffc27a);
  const nightSky = new THREE.Color(0x061126);
  let sky = daySky.clone();
  if (sunH < 0.25){
    sky = nightSky.clone().lerp(duskSky, sunH / 0.25);
  } else if (sunH < 0.55){
    sky = duskSky.clone().lerp(daySky, (sunH-0.25)/0.30);
  } else {
    sky = daySky;
  }
  scene.background = sky;
  if (scene.fog) scene.fog.color.copy(sky);

  // Movement input
  let forwardInput = (keys.w ? 1 : 0) + (keys.s ? -1 : 0) + touchMoveForward;
  let strafeInput  = (keys.d ? 1 : 0) + (keys.a ? -1 : 0) + touchMoveStrafe;
  const len = Math.hypot(forwardInput, strafeInput);
  if (len > 1){ forwardInput/=len; strafeInput/=len; }

  const sprint = !!keys.shift;
  const targetSpeed = (sprint ? 9.0 : player.speed);

  // direction in world space (based on yaw only)
  const yaw = controls.object.rotation.y;
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  const dirX = (-sin * forwardInput) + (cos * strafeInput);
  const dirZ = (-cos * forwardInput) + (-sin * strafeInput);

  // acceleration / friction
  const accel = 32;
  const friction = 18;
  const moving = (Math.abs(dirX) + Math.abs(dirZ)) > 0.001;

  if (moving){
    const tx = dirX * targetSpeed;
    const tz = dirZ * targetSpeed;
    player.vx = lerp(player.vx, tx, 1 - Math.exp(-accel * dt));
    player.vz = lerp(player.vz, tz, 1 - Math.exp(-accel * dt));
  } else {
    player.vx = lerp(player.vx, 0, 1 - Math.exp(-friction * dt));
    player.vz = lerp(player.vz, 0, 1 - Math.exp(-friction * dt));
  }

  // Apply horizontal movement
  const pos = controls.object.position;
  pos.x += player.vx * dt;
  pos.z += player.vz * dt;

  // Gravity + ground (simple terrain collision)
  const gh = groundHeightAt(pos.x, pos.z);
  const baseEye = gh + 1.0;

  // coyote window
  if (player.grounded) coyoteUntil = now + 120;

  player.velocityY -= 25 * dt;
  pos.y += player.velocityY * dt;

  // Only snap to ground if we're close and moving down
  // This prevents teleporting when digging or touching blocks
  if (pos.y < baseEye && player.velocityY <= 0){
    const distToGround = baseEye - pos.y;
    // Only snap if within reasonable distance (not huge teleport)
    if (distToGround < 3.0) {
      pos.y = baseEye;
      player.velocityY = 0;
      player.grounded = true;
    }
  } else {
    player.grounded = false;
  }

  // Jump execute
  const wantsJump = now < jumpQueuedUntil;
  if (wantsJump && (player.grounded || now < coyoteUntil)){
    jumpQueuedUntil = 0;
    player.velocityY = player.jump;
    player.grounded = false;
    bumpShake(0.14);
    swingHotbar();
    playSfx("jump");
  }

  // Head bob + FOV sprint kick
  const speed = Math.hypot(player.vx, player.vz);
  const bobAmt = player.grounded ? Math.min(1, speed / 6) : 0;
  const bob = Math.sin(now * 0.018) * 0.06 * bobAmt;
  // camera is the control object here; apply bob as a small additive offset
  pos.y += bob;

  const baseFov = 75;
  const sprintFov = 82;
  camera.fov = lerp(camera.fov, sprint ? sprintFov : baseFov, 1 - Math.exp(-8 * dt));
  camera.updateProjectionMatrix();

  // Footsteps (synthetic)
  if (player.grounded && speed > 0.8){
    stepAccum += speed * dt;
    if (stepAccum > 0.55){
      stepAccum = 0;
      playSfx("step");
    }
  } else {
    stepAccum = 0;
  }

  // Camera shake (very subtle)
  if (shake > 0){
    shake -= dt * 1.6;
    const s = Math.max(0, shake);
    shakeX = (Math.random()*2-1) * s;
    shakeY = (Math.random()*2-1) * s;
    // apply to camera rotation a touch
    camera.rotation.z = shakeX * 0.02;
  } else {
    camera.rotation.z = 0;
  }

  // Chunk streaming
  streamChunksAround(pos.x, pos.z);

  // Multiplayer state push
  pushPlayerState();

  controls.object.rotation.z = 0;
  
  // Chunk loading: Build chunks around player as they move
  if (controls && controls.object) {
    const px = controls.object.position.x;
    const pz = controls.object.position.z;
    const [playerCx, playerCz] = worldToChunk(Math.floor(px), Math.floor(pz));
    
    // Build chunks in radius around player
    const loadRadius = 4; // Load 4 chunks in each direction
    for (let dx = -loadRadius; dx <= loadRadius; dx++) {
      for (let dz = -loadRadius; dz <= loadRadius; dz++) {
        const cx = playerCx + dx;
        const cz = playerCz + dz;
        buildChunk(cx, cz);
      }
    }
    
    // Unload far chunks (optional - saves memory)
    const unloadRadius = 6;
    for (const [k, group] of chunkMeshes.entries()) {
      const [cx, cz] = k.split(',').map(Number);
      const dist = Math.max(Math.abs(cx - playerCx), Math.abs(cz - playerCz));
      if (dist > unloadRadius) {
        scene.remove(group);
        group.traverse(o => {
          if (o.isMesh) o.geometry.dispose?.();
        });
        chunkMeshes.delete(k);
      }
    }
  }

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
    .from("kidcraft_recipes")
    .select("code, name, output_material_code, output_qty, ingredients:kidcraft_recipe_ingredients(material_code, qty)")
    .order("name", { ascending: true })
    .limit(200);
  if (error) { craftingUI.list.innerHTML = `<div>Recipes unavailable: ${escapeHtml(error.message)}</div>`; return; }

  craftingUI.list.innerHTML = "";
  for (const r of (data||[])){
    const div = document.createElement("div");
    div.className = "recipe";
    const ings = (r.ingredients||[]).map(i => `${i.material_code}x${i.qty}`).join(", ");
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

function colorFor(code){
  const h = [...String(code)].reduce((a,c)=> (a*31 + c.charCodeAt(0))>>>0, 7);
  const r = 60 + (h & 127);
  const g = 60 + ((h>>>7) & 127);
  const b = 60 + ((h>>>14) & 127);
  return (r<<16) | (g<<8) | b;
}

window.addEventListener("mouseup", (e)=>{ if (e.button===0){ breaking=false; hideCrack(); } });

window.addEventListener("keydown", (e)=>{
  if (e.code === "KeyE"){
    const ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    toggleInventoryPanel();
  }
});


// =======================
// === Furnace UI + server-timestamped smelting ===
let openFurnacePos = null;

function qs(id){ return document.getElementById(id); }
function showModal(id, show){
  const el = qs(id);
  if (!el) return;
  el.classList.toggle("hidden", !show);
}
function setFurnaceStatus(msg){ const el = qs("furnaceStatus"); if (el) el.textContent = msg || ""; }

async function openFurnaceUI(x,y,z){
  openFurnacePos = {x,y,z};
  showModal("furnaceModal", true);
  setFurnaceStatus("Loading…");
  const st = await supaGetFurnace(x,y,z) || { world: WORLD_ID, x,y,z, input_code:null, input_qty:0, fuel_code:null, fuel_qty:0, output_code:null, output_qty:0, is_burning:false };
  qs("f_in_code").value = st.input_code || "";
  qs("f_in_qty").value = st.input_qty || 0;
  qs("f_fuel_code").value = st.fuel_code || "";
  qs("f_fuel_qty").value = st.fuel_qty || 0;
  qs("f_out_code").value = st.output_code || "";
  qs("f_out_qty").value = st.output_qty || 0;

  // compute remaining timers client-side from server timestamps
  const now = Date.now();
  const burnEnds = st.burn_ends_at ? Date.parse(st.burn_ends_at) : null;
  const smeltEnds = st.smelt_ends_at ? Date.parse(st.smelt_ends_at) : null;
  if (burnEnds && burnEnds > now) setFurnaceStatus(`Burning… ${(burnEnds-now)/1000|0}s left`);
  else if (smeltEnds && smeltEnds > now) setFurnaceStatus(`Smelting… ${(smeltEnds-now)/1000|0}s left`);
  else setFurnaceStatus("Ready.");
}

async function startFurnaceFromUI(){
  if (!openFurnacePos) return;
  const {x,y,z} = openFurnacePos;
  const input_code = qs("f_in_code").value.trim() || null;
  const input_qty = parseInt(qs("f_in_qty").value||"0",10) || 0;
  const fuel_code = qs("f_fuel_code").value.trim() || null;
  const fuel_qty = parseInt(qs("f_fuel_qty").value||"0",10) || 0;

  if (!input_code || input_qty <= 0){ setFurnaceStatus("Need input."); return; }
  if (!fuel_code || fuel_qty <= 0 || !isFuel(fuel_code)){ setFurnaceStatus("Need valid fuel."); return; }

  const recipe = await supaGetSmeltRecipe(input_code);
  if (!recipe){ setFurnaceStatus("No smelting recipe for that input."); return; }

  // Server-timestamped schedule
  const now = new Date();
  const burnMs = fuelBurnMs(fuel_code);
  const cookMs = recipe.cook_time_ms || 10000;
  const burnEnds = new Date(now.getTime() + burnMs);
  const smeltEnds = new Date(now.getTime() + cookMs);

  const state = {
    world: WORLD_ID, x,y,z,
    input_code, input_qty,
    fuel_code, fuel_qty: fuel_qty - 1,
    output_code: recipe.output_code,
    output_qty: 0,
    is_burning: true,
    burn_started_at: now.toISOString(),
    burn_ends_at: burnEnds.toISOString(),
    smelt_started_at: now.toISOString(),
    smelt_ends_at: smeltEnds.toISOString()
  };
  await supaUpsertFurnace(state);
  setFurnaceStatus(`Started: output in ${(cookMs/1000)|0}s`);
}

async function tickFurnaceIfReady(){
  if (!openFurnacePos) return;
  const {x,y,z} = openFurnacePos;
  const st = await supaGetFurnace(x,y,z);
  if (!st) return;
  const now = Date.now();
  const smeltEnds = st.smelt_ends_at ? Date.parse(st.smelt_ends_at) : 0;
  if (st.is_burning && smeltEnds && smeltEnds <= now){
    // complete one smelt unit
    const input_qty = Math.max(0, (st.input_qty||0) - 1);
    const output_qty = (st.output_qty||0) + 1;
    let is_burning = false;
    let burn_ends_at = st.burn_ends_at;
    let burn_started_at = st.burn_started_at;
    let smelt_started_at = null;
    let smelt_ends_at = null;

    // if still has input and fuel time remaining and fuel available, schedule next
    const burnEnds = st.burn_ends_at ? Date.parse(st.burn_ends_at) : 0;
    const burnRemaining = burnEnds - now;
    if (input_qty > 0){
      const recipe = await supaGetSmeltRecipe(st.input_code);
      if (recipe){
        const cookMs = recipe.cook_time_ms || 10000;
        if (burnRemaining >= cookMs){
          is_burning = true;
          const ns = new Date();
          smelt_started_at = ns.toISOString();
          smelt_ends_at = new Date(ns.getTime()+cookMs).toISOString();
        } else if ((st.fuel_qty||0) > 0 && isFuel(st.fuel_code)){
          // consume another fuel to extend burn
          const add = fuelBurnMs(st.fuel_code);
          burn_started_at = new Date().toISOString();
          burn_ends_at = new Date(now + add).toISOString();
          is_burning = true;
          const ns = new Date();
          smelt_started_at = ns.toISOString();
          smelt_ends_at = new Date(ns.getTime()+cookMs).toISOString();
          st.fuel_qty = (st.fuel_qty||0) - 1;
        }
      }
    }

    await supaUpsertFurnace({
      world: WORLD_ID, x,y,z,
      input_code: st.input_code, input_qty,
      fuel_code: st.fuel_code, fuel_qty: st.fuel_qty||0,
      output_code: st.output_code, output_qty,
      is_burning,
      burn_started_at,
      burn_ends_at,
      smelt_started_at,
      smelt_ends_at
    });

    qs("f_in_qty").value = input_qty;
    qs("f_out_code").value = st.output_code || "";
    qs("f_out_qty").value = output_qty;
    setFurnaceStatus("Smelted 1 item.");
  }
}

async function takeFurnaceOutput(){
  if (!openFurnacePos) return;
  await tickFurnaceIfReady();
  const {x,y,z} = openFurnacePos;
  const st = await supaGetFurnace(x,y,z);
  if (!st || (st.output_qty||0) <= 0){ setFurnaceStatus("No output."); return; }
  const code = st.output_code;
  const qty = st.output_qty|0;
  // add to inventory (stacking)
  invAdd(code, qty);
  await supaUpsertInventory(code);
  // clear output
  await supaUpsertFurnace({ world: WORLD_ID, x,y,z, output_code: st.output_code, output_qty: 0 });
  qs("f_out_qty").value = 0;
  setFurnaceStatus(`Took ${qty}x ${code}`);
  HOTBAR_ITEMS = [];
  renderHotbar();
}

let furnaceTickTimer = null;

function initFurnaceUI(){
  const close = ()=>{ 
    openFurnacePos=null; 
    showModal("furnaceModal", false); 
  };
  qs("furnaceCloseBtn")?.addEventListener("click", close);
  qs("furnaceStartBtn")?.addEventListener("click", startFurnaceFromUI);
  qs("furnaceTakeBtn")?.addEventListener("click", takeFurnaceOutput);
  
  // tick while open - only create one timer
  if (furnaceTickTimer) clearInterval(furnaceTickTimer);
  furnaceTickTimer = setInterval(()=>{ 
    if (openFurnacePos) {
      tickFurnaceIfReady().catch(err => console.warn("[Furnace] tick error:", err));
    }
  }, 800);
}

// Initialize furnace UI
initFurnaceUI();
// ============================================================
// DEBUG EXPORTS - For console testing
// ============================================================
window.DEBUG = {
  terrainHeight,
  noise2D: () => noise2D,
  getBlockCode,
  worldId: () => worldId,
  camera,
  SEA_LEVEL,
  CHUNK_SIZE,
  MIN_Y,
  player: () => player,
  worldEdits: () => worldEdits,
  chunkMeshes: () => chunkMeshes,
  rebuildChunk,
  applyEditLocal,
  MATERIAL_DEFS,
  // Check player position
  whereAmI: () => {
    const pos = camera.position;
    const x = Math.floor(pos.x);
    const y = Math.floor(pos.y);
    const z = Math.floor(pos.z);
    console.log("=== YOUR POSITION ===");
    console.log(`X: ${x}, Y: ${y}, Z: ${z}`);
    console.log(`Block at feet: ${getBlockCode(x, y-2, z)}`);
    console.log(`Block below: ${getBlockCode(x, y-3, z)}`);
    console.log(`Terrain height here: ${terrainHeight(x, z)}`);
    if (y < MIN_Y + 5) {
      console.warn("⚠️ You're near the bottom of the world!");
    }
    if (y > 100) {
      console.warn("⚠️ You're very high up!");
    }
    return { x, y, z };
  },
  // Test noise function
  testNoise: () => {
    console.log("=== NOISE DIAGNOSTIC ===");
    console.log("Noise (0, 0):", noise2D(0, 0));
    console.log("Noise (1, 0):", noise2D(1, 0));
    console.log("Noise (0, 1):", noise2D(0, 1));
    console.log("Noise (10, 10):", noise2D(10, 10));
    console.log("Noise (100, 100):", noise2D(100, 100));
    console.log("Noise (0.002, 0.002):", noise2D(0.002, 0.002));
    
    // Test with terrain scale
    console.log("\n=== TERRAIN SCALE NOISE ===");
    console.log("At (0,0) x0.002:", noise2D(0*0.002, 0*0.002));
    console.log("At (10,0) x0.002:", noise2D(10*0.002, 0*0.002));
    console.log("At (100,0) x0.002:", noise2D(100*0.002, 0*0.002));
  },
  // Re-initialize noise with new seed
  reinitNoise: (seed) => {
    console.log(`[Debug] Reinitializing noise with seed: ${seed}`);
    initializeNoise(seed);
    console.log("[Debug] Noise reinitialized. Testing...");
    window.DEBUG.testNoise();
  },
  // Test terrain at a position
  testTerrain: (x, z) => {
    const h = terrainHeight(x, z);
    const block = getBlockCode(x, h, z);
    const blockAbove = getBlockCode(x, h+1, z);
    const blockBelow = getBlockCode(x, h-1, z);
    console.log(`=== Terrain at (${x}, ${z}) ===`);
    console.log(`Height: ${h}`);
    console.log(`Surface block: ${block}`);
    console.log(`Block above (+1): ${blockAbove}`);
    console.log(`Block below (-1): ${blockBelow}`);
    console.log(`Noise value: ${noise2D(x*0.002, z*0.002)}`);
    return { height: h, surface: block, above: blockAbove, below: blockBelow };
  },
  // Test multiple positions
  testArea: () => {
    console.log("=== AREA TEST (5x5 around origin) ===");
    for (let z = -2; z <= 2; z++) {
      let row = "";
      for (let x = -2; x <= 2; x++) {
        const h = terrainHeight(x, z);
        row += h.toString().padStart(3) + " ";
      }
      console.log(row);
    }
  }
};

console.log("[Debug] DEBUG tools available via window.DEBUG");
console.log("[Debug] Try: DEBUG.whereAmI() - Check your position");
console.log("[Debug] Try: DEBUG.testNoise() - Test noise function");
console.log("[Debug] Try: DEBUG.testTerrain(x, z) - Check terrain");
console.log("[Debug] Try: DEBUG.testArea() - View 5x5 height map");
