// === KidCraft FULL RELEASE MAIN ===

// CDN-safe imports
import * as THREE from "https://unpkg.com/three@0.175.0/build/three.module.js";
import { PointerLockControls } from "https://unpkg.com/three@0.175.0/examples/jsm/controls/PointerLockControls.js";
import { createNoise2D } from "https://unpkg.com/simplex-noise@4.0.3/dist/esm/simplex-noise.js";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// =======================
// SUPABASE SETUP
// =======================
const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_KEY = "YOUR_SUPABASE_ANON_KEY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// Username-only auth (fake email)
function usernameToEmail(u) {
  return `${u.toLowerCase()}@kidcraft.local`;
}

const statusEl = document.getElementById("status");
document.getElementById("signup").onclick = async () => {
  const u = username.value.trim();
  const p = password.value;
  if (!u || !p) return statusEl.textContent = "Enter username and password";
  const { error } = await supabase.auth.signUp({
    email: usernameToEmail(u),
    password: p
  });
  statusEl.textContent = error ? error.message : "Signed up!";
};

document.getElementById("login").onclick = async () => {
  const u = username.value.trim();
  const p = password.value;
  const { error } = await supabase.auth.signInWithPassword({
    email: usernameToEmail(u),
    password: p
  });
  statusEl.textContent = error ? error.message : "Logged in!";
};

// =======================
// THREE.JS SETUP
// =======================
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth/innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const controls = new PointerLockControls(camera, document.body);
scene.add(controls.object); // NEW API

const light = new THREE.HemisphereLight(0xffffff, 0x444444);
scene.add(light);

const floor = new THREE.Mesh(
  new THREE.PlaneGeometry(100,100),
  new THREE.MeshStandardMaterial({ color: 0x228822 })
);
floor.rotation.x = -Math.PI/2;
scene.add(floor);

// =======================
// INPUT (PC + MOBILE)
// =======================
const keys = {};
addEventListener("keydown", e => keys[e.key.toLowerCase()] = true);
addEventListener("keyup", e => keys[e.key.toLowerCase()] = false);

// Mobile touch state
let touchForward = 0;
let touchStrafe = 0;

function clamp(v,a,b){return Math.max(a,Math.min(b,v));}

function setupTouch() {
  const left = document.getElementById("touch-left");
  const right = document.getElementById("touch-right");
  let sx=0, sy=0;

  left.addEventListener("touchstart", e => {
    const t=e.touches[0]; sx=t.clientX; sy=t.clientY;
  }, {passive:false});

  left.addEventListener("touchmove", e => {
    const t=e.touches[0];
    touchStrafe = clamp((t.clientX-sx)/60, -1, 1);
    touchForward = clamp(-(t.clientY-sy)/60, -1, 1);
    e.preventDefault();
  }, {passive:false});

  left.addEventListener("touchend", ()=>{touchStrafe=0;touchForward=0;});

  right.addEventListener("touchmove", e => {
    const t=e.touches[0];
    controls.object.rotation.y -= (t.movementX||0)*0.002;
    camera.rotation.x = clamp(camera.rotation.x-(t.movementY||0)*0.002, -Math.PI/2, Math.PI/2);
    e.preventDefault();
  }, {passive:false});
}
setupTouch();

// =======================
// GAME LOOP
// =======================
camera.position.y = 2;

function animate() {
  requestAnimationFrame(animate);

  const speed = 0.1;
  let f = (keys["w"]?1:0) + (keys["s"]?-1:0) + touchForward;
  let s = (keys["d"]?1:0) + (keys["a"]?-1:0) + touchStrafe;
  const l = Math.hypot(f,s); if (l>1){f/=l;s/=l;}

  if (f) controls.object.translateZ(-f*speed);
  if (s) controls.object.translateX(s*speed);

  renderer.render(scene,camera);
}
animate();

addEventListener("resize", ()=>{
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth,innerHeight);
});
