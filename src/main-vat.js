import * as THREE from "three";
import * as CANNON from "cannon-es";
import { GUI } from "three/examples/jsm/libs/lil-gui.module.min.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { SSAOPass } from "three/examples/jsm/postprocessing/SSAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { createPaper, updatePaperFrame, PAPER_DESIGNS, createUserMaterial } from "./paper.js";
import { loadVATData } from "./paper-vat.js";

// ==================================================
// シーン基本セットアップ
// ==================================================
const app = document.getElementById("app");
const info = document.getElementById("info");

const scene = new THREE.Scene();

// 配色 — GUI から変更できる
const colorSettings = {
  background: "#ff3838", // 背面の壁と背景
  floor: "#dcdad0",
};
scene.background = new THREE.Color(colorSettings.background);

// カメラ — 斜め前方から見る (GUI で調整できる)
const cameraSettings = { x: 0, y: 2.2, z: 3.6, targetY: 0.35 };
const camera = new THREE.PerspectiveCamera(
  40,
  window.innerWidth / window.innerHeight,
  0.01,
  100,
);
camera.position.set(cameraSettings.x, cameraSettings.y, cameraSettings.z);
camera.lookAt(0, cameraSettings.targetY, 0);

function applyCameraSettings() {
  camera.position.set(cameraSettings.x, cameraSettings.y, cameraSettings.z);
  camera.lookAt(0, cameraSettings.targetY, 0);
  updateOpenPose();
}

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

// 床と背面の壁
const FLOOR_VISUAL_Y = -0.1;
const WALL_Z = -1.1;

const floorMat = new THREE.MeshStandardMaterial({ color: colorSettings.floor });
const floor = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.set(0, FLOOR_VISUAL_Y, 1);
floor.receiveShadow = true;
scene.add(floor);

const wallMat = new THREE.MeshStandardMaterial({
  color: colorSettings.background,
});
const wall = new THREE.Mesh(new THREE.PlaneGeometry(16, 6), wallMat);
wall.position.set(0, FLOOR_VISUAL_Y + 3, WALL_Z);
wall.receiveShadow = true;
scene.add(wall);

// ライト
const ambient = new THREE.AmbientLight(0xffffff, 1.25);
scene.add(ambient);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.15);
dirLight.position.set(-2, 2.6, 1.4);
dirLight.castShadow = true;
dirLight.shadow.mapSize.set(2048, 2048);
dirLight.shadow.camera.left = -4;
dirLight.shadow.camera.right = 4;
dirLight.shadow.camera.top = 4;
dirLight.shadow.camera.bottom = -3;
dirLight.shadow.camera.near = 0.1;
dirLight.shadow.camera.far = 12;
dirLight.shadow.bias = -0.001;
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0);
fillLight.position.set(-2, 1, -1);
scene.add(fillLight);

// ポストプロセス — SSAO で折り目・凹みを暗くする
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const ssaoPass = new SSAOPass(
  scene,
  camera,
  window.innerWidth,
  window.innerHeight,
);
ssaoPass.kernelRadius = 0.01;
ssaoPass.minDistance = 0.0001;
ssaoPass.maxDistance = 0.08;
// 注意: SSAOPass に intensity プロパティは無い (設定しても no-op)。
// オン/オフは ssaoPass.enabled、強さの調整は kernelRadius / maxDistance で行う。
composer.addPass(ssaoPass);

// 气泡膜的网格不参与 SSAO 的法线/深度预渲染 — 否则球面会把纸团的折痕 AO 抹平。
// 渲染 SSAO 时临时隐藏气泡，主渲染（beauty pass）不受影响。
const _bubbleMeshes = [];
const _ssaoRender = ssaoPass.render.bind(ssaoPass);
ssaoPass.render = (...args) => {
  const wasVisible = [];
  for (const bubble of _bubbleMeshes) {
    if (bubble.visible) {
      bubble.visible = false;
      wasVisible.push(bubble);
    }
  }
  const result = _ssaoRender(...args);
  for (const bubble of wasVisible) bubble.visible = true;
  return result;
};

composer.addPass(new OutputPass());

// ==================================================
// GUI
// ==================================================
const MAX_PAPERS = 50;
const urlParams = new URLSearchParams(window.location.search);
// openFrame: 開いた状態で表示するフレーム。0 = 完全に開き切り、
// 少し上げるとクシャ感が残る (VAT フレームは 0 に近いほど平ら)
const animSettings = { speed: 1.5, openFrame: 4 };
// 紙の枚数 — GUI スライダーか URL パラメータ (?papers=10) で変更できる
const paperSettings = {
  count: Math.min(
    MAX_PAPERS,
    Math.max(1, parseInt(urlParams.get("papers"), 10) || 40),
  ),
};
// GUI は ?gui=on を付けた時だけ表示する
const showGui = urlParams.get("gui") === "on";

// 記事用デバッグフラグ:
//   ?frame=N        全紙を指定フレームで静止表示 (スクショ用。?papers=1 と併用推奨)
//   ?ssao=数値      SSAO 強度を上書き (例 ?ssao=0 でオフ)
//   ?debug=physics  衝突球をワイヤーフレーム表示
const debugFrameParam = urlParams.get("frame");
const debugFrame = debugFrameParam !== null ? parseFloat(debugFrameParam) : null;
const debugPhysics = urlParams.get("debug") === "physics";
const debugBubble = urlParams.get("debug") === "bubble";
const ssaoOverride = urlParams.get("ssao");
if (ssaoOverride !== null && parseFloat(ssaoOverride) <= 0) {
  ssaoPass.enabled = false;
}
const gui = new GUI();
if (!showGui) gui.hide();

const lightFolder = gui.addFolder("Lighting");
lightFolder.add(ambient, "intensity", 0, 3, 0.01).name("Ambient");
lightFolder.add(dirLight, "intensity", 0, 4, 0.01).name("Key Light");
lightFolder.add(dirLight.position, "x", -5, 5, 0.1).name("Key X");
lightFolder.add(dirLight.position, "y", 0, 5, 0.1).name("Key Y");
lightFolder.add(dirLight.position, "z", -5, 5, 0.1).name("Key Z");
lightFolder.add(fillLight, "intensity", 0, 2, 0.01).name("Fill Light");

const ssaoFolder = gui.addFolder("SSAO");
ssaoFolder.add(ssaoPass, "kernelRadius", 0.001, 0.5, 0.001).name("Radius");
ssaoFolder.add(ssaoPass, "minDistance", 0.0001, 0.01, 0.0001).name("Min Dist");
ssaoFolder.add(ssaoPass, "maxDistance", 0.01, 0.5, 0.001).name("Max Dist");
ssaoFolder.add(ssaoPass, "enabled").name("Enabled");

const shadowFolder = gui.addFolder("Shadow");
shadowFolder.add(dirLight.shadow, "bias", -0.01, 0.01, 0.0001).name("Bias");

const colorFolder = gui.addFolder("Colors");
colorFolder
  .addColor(colorSettings, "background")
  .name("Background")
  .onChange((v) => {
    scene.background.set(v);
    wallMat.color.set(v);
  });
colorFolder
  .addColor(colorSettings, "floor")
  .name("Floor")
  .onChange((v) => {
    floorMat.color.set(v);
  });

gui.add(animSettings, "speed", 0.1, 5, 0.1).name("Speed");
gui
  .add(animSettings, "openFrame", 0, 12, 0.5)
  .name("Open Frame")
  .onChange(() => {
    // 開いている紙があれば即時反映
    if (activePaper && activePaper.state === "open") {
      activePaper.frameIdx = animSettings.openFrame;
      updatePaperFrame(activePaper, animData, activePaper.frameIdx);
    } else if (activePaper && activePaper.target) {
      activePaper.target.frameIdx = animSettings.openFrame;
    }
  });
gui
  .add(paperSettings, "count", 1, MAX_PAPERS, 1)
  .name("Papers")
  .onFinishChange(syncPaperCount);

const cameraFolder = gui.addFolder("Camera");
cameraFolder
  .add(cameraSettings, "x", -4, 4, 0.05)
  .name("X")
  .onChange(applyCameraSettings);
cameraFolder
  .add(cameraSettings, "y", 0.2, 4, 0.05)
  .name("Y")
  .onChange(applyCameraSettings);
cameraFolder
  .add(cameraSettings, "z", 0.8, 7, 0.05)
  .name("Z")
  .onChange(applyCameraSettings);
cameraFolder
  .add(cameraSettings, "targetY", 0, 2, 0.05)
  .name("Target Y")
  .onChange(applyCameraSettings);
cameraFolder
  .add(camera, "fov", 10, 90, 1)
  .name("FOV")
  .onChange(() => {
    camera.updateProjectionMatrix();
    updateOpenPose();
  });

// ==================================================
// GUI: 撮影用フラグ (記事のスクショ向け)
// decode / normals はロード時に一度だけ効くので、URL を組み立ててリロードする。
// Pose Frame だけは ?frame= で起動中ならライブで反映される。
// ==================================================
const captureSettings = {
  decode: urlParams.get("decode") || "correct",
  normals: urlParams.get("normals") || "smooth",
  poseFrame: debugFrame !== null ? debugFrame : -1,
  physics: debugPhysics,
  apply() {
    const p = new URLSearchParams(window.location.search);
    p.set("gui", "on");
    p.set("papers", String(paperSettings.count));

    const setOrDelete = (key, value, defaultValue) => {
      if (value === defaultValue) p.delete(key);
      else p.set(key, value);
    };
    setOrDelete("decode", captureSettings.decode, "correct");
    setOrDelete("normals", captureSettings.normals, "smooth");
    setOrDelete("frame", String(captureSettings.poseFrame), "-1");
    if (ssaoPass.enabled) p.delete("ssao");
    else p.set("ssao", "0");
    if (captureSettings.physics) p.set("debug", "physics");
    else p.delete("debug");

    window.location.search = p.toString();
  },
};

const captureFolder = gui.addFolder("Capture (Apply でリロード)");
captureFolder
  .add(captureSettings, "decode", ["correct", "naive", "reversed", "noflip", "nomirror"])
  .name("Decode");
captureFolder
  .add(captureSettings, "normals", ["smooth", "flat"])
  .name("Normals");
captureFolder
  .add(captureSettings, "poseFrame", -1, 49, 0.5)
  .name("Pose Frame (-1=off)")
  .onChange((value) => {
    // すでに ?frame= で起動していれば、その場でフレームを差し替える
    if (debugFrame === null || value < 0 || !animData) return;
    for (const paper of papers) {
      if (paper.state !== "posed") continue;
      paper.frameIdx = Math.max(0, Math.min(value, animData.frameCount - 1));
      updatePaperFrame(paper, animData, paper.frameIdx);
    }
  });
captureFolder.add(captureSettings, "physics").name("Show Colliders");
captureFolder.add(captureSettings, "apply").name("▶ Apply & Reload");

// ==================================================
// データロード → 紙メッシュ作成（3枚）
// ==================================================
const papers = [];
let animData = null;
let activePaper = null;

const PAPER_OFFSETS = [
  [-1.25, 0.02, -0.1],
  [0, 0.02, 0.12],
  [1.25, 0.02, -0.06],
];

// 開いた紙: カメラ正面 OPEN_DISTANCE 先に、画面高さの90%で正対表示する
// (ステージ上のどの紙玉よりもカメラに近い距離にして、必ず最前面に見えるようにする)
const OPEN_SCREEN_RATIO = 0.9;
const OPEN_DISTANCE = 1.5;
const CLOSED_SCALE = 0.82;

const flatSize = { width: 1, depth: 1.4 };

// 紙玉が動ける床の範囲 (壁と画面から決めた固定ステージ)
const STAGE_BOUNDS = { minX: -2.4, maxX: 2.4, minZ: WALL_Z, maxZ: 1.7 };
const OPEN_DURATION = 1.15;
// 打开动画分两段：前段纸团保持揉皱飞到面前，后段到位后才"拨开"
const OPEN_FLY_RATIO = 0.42;
const DISCARD_DURATION = 1.25;
const ROLL_LINEAR_RESISTANCE = 2.6;
const ROLL_ANGULAR_RESISTANCE = 4.5;
const ROLL_SETTLE_SPEED = 0.018;
const PHYSICS_STEP = 1 / 60;
const PAPER_MASS = 0.16;

// 掴んで投げる操作
const GRAB_LIFT = 0.5;
const GRAB_STIFFNESS = 14;
const GRAB_MAX_SPEED = 4.5;
const THROW_MAX_SPEED = 3.2;
const CLICK_DRAG_THRESHOLD_PX = 6;

// くしゃくしゃ状態の衝突球・回転中心 — VAT ロード後に実測値で上書きする
let collisionRadius = 0.25;
let restCenterY = FLOOR_VISUAL_Y + 0.25; // 静止時の紙玉中心の高さ
let restMeshY = 0.02; // 静止時のメッシュ原点の高さ
const crumpleCenter = new THREE.Vector3(0, 0.2, 0);

// ==================================================
// 簡易物理 — 丸まった紙だけ球体剛体として扱う
// ==================================================
const physicsWorld = new CANNON.World({
  gravity: new CANNON.Vec3(0, -7.0, 0),
});
physicsWorld.allowSleep = false;
physicsWorld.defaultContactMaterial.friction = 0.8;
physicsWorld.defaultContactMaterial.restitution = 0.15;

const paperMaterial = new CANNON.Material("paper");
const floorPhysicsMaterial = new CANNON.Material("floor");
physicsWorld.addContactMaterial(
  new CANNON.ContactMaterial(paperMaterial, floorPhysicsMaterial, {
    friction: 1.0,
    restitution: 0.12,
  }),
);
// 紙同士 — 軽く弾む
physicsWorld.addContactMaterial(
  new CANNON.ContactMaterial(paperMaterial, paperMaterial, {
    friction: 0.6,
    restitution: 0.3,
  }),
);

const floorBody = new CANNON.Body({
  mass: 0,
  material: floorPhysicsMaterial,
  shape: new CANNON.Plane(),
  position: new CANNON.Vec3(0, FLOOR_VISUAL_Y, 0),
  quaternion: new CANNON.Quaternion().setFromEuler(-Math.PI / 2, 0, 0),
});
physicsWorld.addBody(floorBody);

// メッシュ原点は紙玉の底付近にあるため、剛体の中心(=紙玉の中心)との間で
// crumpleCenter ぶんのオフセットを行き来させる。
const _crumpleOffset = new THREE.Vector3();
function crumpleWorldOffset(scale, quaternion) {
  return _crumpleOffset
    .copy(crumpleCenter)
    .multiplyScalar(scale)
    .applyQuaternion(quaternion);
}

function createPaperBody(paper) {
  const off = crumpleWorldOffset(CLOSED_SCALE, paper.mesh.quaternion);
  const body = new CANNON.Body({
    mass: PAPER_MASS,
    material: paperMaterial,
    shape: new CANNON.Sphere(collisionRadius),
    linearDamping: 0.15,
    angularDamping: 0.35,
    position: new CANNON.Vec3(
      paper.mesh.position.x + off.x,
      paper.mesh.position.y + off.y,
      paper.mesh.position.z + off.z,
    ),
  });
  body.quaternion.set(
    paper.mesh.quaternion.x,
    paper.mesh.quaternion.y,
    paper.mesh.quaternion.z,
    paper.mesh.quaternion.w,
  );
  physicsWorld.addBody(body);
  return body;
}

function setPaperBodyDynamic(paper, enabled) {
  const body = paper.body;
  body.type = enabled ? CANNON.Body.DYNAMIC : CANNON.Body.KINEMATIC;
  body.mass = enabled ? PAPER_MASS : 0;
  body.collisionFilterGroup = enabled ? 1 : 0;
  body.collisionFilterMask = enabled ? 1 : 0;
  if (!enabled) {
    body.velocity.set(0, 0, 0);
    body.angularVelocity.set(0, 0, 0);
    body.force.set(0, 0, 0);
    body.torque.set(0, 0, 0);
  }
  body.updateMassProperties();
  body.wakeUp();
}

function syncBodyToMesh(paper) {
  const off = crumpleWorldOffset(paper.mesh.scale.x, paper.mesh.quaternion);
  paper.body.position.set(
    paper.mesh.position.x + off.x,
    paper.mesh.position.y + off.y,
    paper.mesh.position.z + off.z,
  );
  paper.body.quaternion.set(
    paper.mesh.quaternion.x,
    paper.mesh.quaternion.y,
    paper.mesh.quaternion.z,
    paper.mesh.quaternion.w,
  );
}

function syncMeshToBody(paper, scale = CLOSED_SCALE) {
  paper.mesh.quaternion.set(
    paper.body.quaternion.x,
    paper.body.quaternion.y,
    paper.body.quaternion.z,
    paper.body.quaternion.w,
  );
  const off = crumpleWorldOffset(scale, paper.mesh.quaternion);
  paper.mesh.position.set(
    paper.body.position.x - off.x,
    paper.body.position.y - off.y,
    paper.body.position.z - off.z,
  );
  paper.mesh.scale.setScalar(scale);
}

function isOnGround(body) {
  return body.position.y <= restCenterY + 0.05;
}

function applyRollingResistance(body, dt) {
  const linearDecay = Math.exp(-ROLL_LINEAR_RESISTANCE * dt);
  const angularDecay = Math.exp(-ROLL_ANGULAR_RESISTANCE * dt);
  body.velocity.x *= linearDecay;
  body.velocity.z *= linearDecay;
  body.angularVelocity.x *= angularDecay;
  body.angularVelocity.y *= angularDecay;
  body.angularVelocity.z *= angularDecay;
}

function finishRollingPaper(paper, maxFrame) {
  paper.state = "closed";
  paper.time = 0;
  paper.homePosition.copy(paper.mesh.position);
  paper.homeRotation.copy(paper.mesh.rotation);
  paper.frameIdx = maxFrame;
  updatePaperFrame(paper, animData, paper.frameIdx);
  syncBodyToMesh(paper);
  syncMeshToBody(paper);
}

const BOUNDS_PULL = 3.0;

function applyPhysicsBounds(dt) {
  const bounds = getThrowBounds();
  const minX = bounds.minX + collisionRadius;
  const maxX = bounds.maxX - collisionRadius;
  const minZ = bounds.minZ + collisionRadius;
  const maxZ = bounds.maxZ - collisionRadius;

  for (const paper of papers) {
    if (!paper.body || paper.body.type !== CANNON.Body.DYNAMIC) continue;

    // 範囲外では外向き速度を反射し、ゆるやかに内側へ引き戻す
    // (位置を瞬間移動させると捨てた直後などに見た目が飛ぶため)
    const body = paper.body;
    if (body.position.x < minX) {
      if (body.velocity.x < 0) {
        body.velocity.x = Math.abs(body.velocity.x) * 0.42;
      }
      body.velocity.x += BOUNDS_PULL * dt;
    } else if (body.position.x > maxX) {
      if (body.velocity.x > 0) {
        body.velocity.x = -Math.abs(body.velocity.x) * 0.42;
      }
      body.velocity.x -= BOUNDS_PULL * dt;
    }

    if (body.position.z < minZ) {
      if (body.velocity.z < 0) {
        body.velocity.z = Math.abs(body.velocity.z) * 0.42;
      }
      body.velocity.z += BOUNDS_PULL * dt;
    } else if (body.position.z > maxZ) {
      if (body.velocity.z > 0) {
        body.velocity.z = -Math.abs(body.velocity.z) * 0.42;
      }
      body.velocity.z -= BOUNDS_PULL * dt;
    }
  }
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeOutQuart(t) {
  return 1 - Math.pow(1 - t, 4);
}

function easeInCubic(t) {
  return t * t * t;
}

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function randomRange(min, max) {
  return min + Math.random() * (max - min);
}

function captureTransform(paper) {
  return {
    position: paper.mesh.position.clone(),
    quaternion: paper.mesh.quaternion.clone(),
    scale: paper.mesh.scale.x,
    frameIdx: paper.frameIdx,
  };
}

function getThrowBounds() {
  return STAGE_BOUNDS;
}

const _viewDir = new THREE.Vector3();
// 动画抖动用的临时对象（避免每帧分配）
const _wobbleQ = new THREE.Quaternion();
const _wobbleE = new THREE.Euler();
function computeOpenPose() {
  camera.getWorldDirection(_viewDir);
  const position = camera.position
    .clone()
    .addScaledVector(_viewDir, OPEN_DISTANCE);

  // 紙の法線(+Y)をカメラへ向け、紙の上端(+Z)を画面の上方向に揃える
  const yAxis = _viewDir.clone().negate();
  const zAxis = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis),
  );

  // 画面高さの 90% に合わせる (幅がはみ出す場合は幅で制限)
  const viewH =
    2 * Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5)) * OPEN_DISTANCE;
  const viewW = viewH * camera.aspect;
  const scale = Math.min(
    (viewH * OPEN_SCREEN_RATIO) / flatSize.depth,
    (viewW * OPEN_SCREEN_RATIO) / flatSize.width,
  );

  return { position, quaternion, scale };
}

// カメラや画面が変わった時、開いている紙を追従させる
function updateOpenPose() {
  if (!activePaper) return;
  if (activePaper.state === "opening" && activePaper.target) {
    const pose = computeOpenPose();
    activePaper.target.position.copy(pose.position);
    activePaper.target.quaternion.copy(pose.quaternion);
    activePaper.target.scale = pose.scale;
  } else if (activePaper.state === "open") {
    const pose = computeOpenPose();
    activePaper.mesh.position.copy(pose.position);
    activePaper.mesh.quaternion.copy(pose.quaternion);
    activePaper.mesh.scale.setScalar(pose.scale);
  }
}

async function init() {
  info.textContent = "loading VAT data...";

  // VAT ファイル (FBX + EXR) からアニメーションデータを構築。
  // パスはこのファイル (src/) の1つ上の階層基準 — vite の開発サーバーでも、
  // docs/ をそのまま静的配信した場合でも同じ場所に解決される。
  // (new URL(リテラル, import.meta.url) は vite に書き換えられるため文字列で組む)
  const moduleDir = import.meta.url.replace(/[^/]*$/, "");
  animData = await loadVATData(moduleDir + "../vat/");

  // 開いた紙の実寸 — 画面比率に合わせたスケール計算に使う
  flatSize.width = animData.flat.width;
  flatSize.depth = animData.flat.depth;

  // くしゃくしゃメッシュの実測値で衝突球と回転中心を設定
  // 紙玉の底が見た目の床 (FLOOR_VISUAL_Y) に接するようにする
  crumpleCenter.fromArray(animData.crumple.center);
  collisionRadius = animData.crumple.radius * CLOSED_SCALE;
  // 半径は90パーセンタイル値なので、はみ出た角がめり込まないよう少し余裕を持たせる
  restCenterY = FLOOR_VISUAL_Y + collisionRadius * 1.08;
  restMeshY = restCenterY - crumpleCenter.y * CLOSED_SCALE;
  floorBody.position.y = restCenterY - collisionRadius;
  console.log(
    "[VAT] physics: collisionRadius =", collisionRadius.toFixed(3),
    "restCenterY =", restCenterY.toFixed(3),
  );

  if (debugFrame !== null) {
    // 記事用: 指定フレームで静止させてスクショを撮るモード (?frame=N)
    for (let i = 0; i < paperSettings.count; i++) {
      const position =
        paperSettings.count === 1
          ? new THREE.Vector3(0, restMeshY, 0.2) // 1枚なら中央に置く
          : initialPaperPosition(i);
      const paper = spawnPaper(position, false);
      setPaperBodyDynamic(paper, false);
      paper.state = "posed"; // どの状態分岐にも入らない = 物理もアニメも動かない
      paper.frameIdx = Math.max(0, Math.min(debugFrame, animData.frameCount - 1));
      updatePaperFrame(paper, animData, paper.frameIdx);
    }
  } else {
    // ロード演出 — 紙屑を時間差で上からパラパラと降らせる
    for (let i = 0; i < paperSettings.count; i++) {
      const delay = i * 45 + randomRange(0, 90);
      setTimeout(() => {
        spawnPaper(initialPaperPosition(i), true, randomRange(4.2, 8.2));
      }, delay);
    }
    // デバッグ用 (?bubbles=N): 最初の N 枚を自動で泡に包む
    const autoBubbles = parseInt(urlParams.get("bubbles"), 10) || 0;
    if (autoBubbles > 0) {
      setTimeout(() => {
        let n = 0;
        for (const p of papers) {
          if (n >= autoBubbles) break;
          if (isGrabbable(p)) {
            bubbleize(p);
            n++;
          }
        }
      }, 2500);
    }
  }

  info.textContent = "";
}

function initialPaperPosition(i) {
  if (i < PAPER_OFFSETS.length) {
    return new THREE.Vector3(PAPER_OFFSETS[i][0], restMeshY, PAPER_OFFSETS[i][2]);
  }
  return randomSpawnPosition();
}

function randomSpawnPosition() {
  const bounds = getThrowBounds();
  const margin = collisionRadius * 1.3;
  const pos = new THREE.Vector3(0, restMeshY, 0);
  // 既存の紙と重ならない位置を探す (見つからなければ最後の候補で妥協)
  for (let attempt = 0; attempt < 40; attempt++) {
    //pos.x = randomRange(bounds.minX + margin, bounds.maxX - margin);
    //pos.z = randomRange(bounds.minZ + margin, bounds.maxZ - margin);
    const clear = papers.every((p) => {
      const dx = p.body.position.x - pos.x;
      const dz = p.body.position.z - pos.z;
      return dx * dx + dz * dz > (collisionRadius * 2.4) ** 2;
    });
    if (clear) break;
  }
  return pos;
}

let spawnCounter = 0;

// ==================================================
// 气泡模式 — 右键纸团 → 裹进气泡并漂浮；按住气泡可拖动；
// 两个气泡相碰后合并成一个更大的泡泡（纸团全裹在一起）。
// 膜用纯 ShaderMaterial：菲涅尔 + 薄膜干涉彩虹 + 假高光，不做 PBR 环境反射
// （掠射角反射暗环境是黑边根源），顶点着色器叠加低频液膜晃动。
// 每个气泡是一个 cluster：成员纸团是 kinematic，每帧手动驱动
// （悬浮/呼吸/慢自转），合并与拖拽用 CPU 球心距离判断，不走物理引擎。
// ==================================================
let bubbleGeometry = null;

function ensureBubbleAssets() {
  // 细分 5 级（约 1 万顶点）：细分低了轮廓会呈多边形，气泡边缘不圆
  if (!bubbleGeometry) bubbleGeometry = new THREE.IcosahedronGeometry(1, 5);
}

function createBubbleMaterial() {
  // 纯 ShaderMaterial 肥皂膜：颜色完全由 shader 计算（菲涅尔 + 薄膜干涉
  // + 两颗高光），不走 PBR 光照/环境反射 —— MeshPhysicalMaterial 在掠射角
  // 反射环境暗部产生的黑边从原理上消失。透明混合、不写深度，边缘只有亮彩虹。
  const uniforms = {
    uTime: { value: 0 },
    uPhase: { value: Math.random() * Math.PI * 2 },
    uAmp: { value: 0.03 },
    uRimStrength: { value: 0.7 },
    // 破裂：0=完整，0→1 洞口从 uPopDir 处张开到吞掉整个球
    uPop: { value: 0 },
    uPopDir: { value: new THREE.Vector3(0, 0, 1) },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      uniform float uAmp;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vBubblePos;
      void main() {
        vBubblePos = position;
        // 液膜晃动：多个不同频率/方向的慢波叠加，低振幅 + 慢速才不会像果冻
        float wobble =
            sin(position.y * 5.0 + uTime * 1.4 + uPhase)
          * sin(position.x * 4.0 - uTime * 1.1 + uPhase * 1.7)
          + 0.6 * sin(position.z * 7.0 + uTime * 2.1 + uPhase)
          * sin(position.y * 6.0 + uTime * 1.7 + uPhase * 2.3)
          + 0.35 * sin(dot(position, vec3(9.0, 11.0, 8.0)) + uTime * 3.1 + uPhase);
        vec3 displaced = position + normalize(position) * wobble * uAmp * 0.5;
        vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
        vNormalV = normalize(normalMatrix * normalize(position));
        vViewDir = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uPhase;
      uniform float uRimStrength;
      uniform float uPop;
      uniform vec3 uPopDir;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying vec3 vBubblePos;
      void main() {
        vec3 N = normalize(vNormalV);
        vec3 V = normalize(vViewDir);
        float ndv = clamp(dot(N, V), 0.0, 1.0);
        float fres = pow(1.0 - ndv, 2.2);

        // 薄膜干涉斑纹：膜厚随位置和时间缓慢流动（重力下拉 + 对流漂移）
        vec3 p = vBubblePos;
        float filmField =
            p.y * 6.0
          + sin(p.x * 5.0 + uTime * 0.35 + uPhase) * 1.4
          + sin(p.z * 4.0 - uTime * 0.27 + uPhase * 1.3) * 1.2
          + sin((p.x + p.y) * 7.0 + uTime * 0.55) * 0.7
          + sin(length(p.xz) * 9.0 - uTime * 0.4 + uPhase * 2.1) * 0.8;

        // 视角色 + 膜厚场 → 光谱色，cos 调色板走青→品红→金的肥皂膜色相
        float hueT = filmField * 0.11 + fres * 0.55 + uPhase * 0.05;
        vec3 film = 0.55 + 0.45 * cos(6.28318 * (hueT + vec3(0.0, 0.33, 0.67)));

        // 两颗假高光（主光尖锐小点 + 辅光宽泛弱斑），模拟环境光源在膜面的反射
        vec3 R = reflect(-V, N);
        float s1 = pow(max(dot(R, normalize(vec3(0.45, 0.75, 0.55))), 0.0), 220.0) * 1.3;
        float s2 = pow(max(dot(R, normalize(vec3(-0.6, 0.35, 0.45))), 0.0), 60.0) * 0.35;

        // 正对视线的膜面近乎全透明，只有淡淡流动彩斑；彩虹集中在掠射边缘
        float bodyAmount = 0.06 + 0.05 * sin(filmField + uTime * 0.5);
        vec3 col = film * (bodyAmount + fres * uRimStrength);
        // 极边缘膜最薄 → 干涉消失，剩一道接近透明的亮线
        col += vec3(1.0) * smoothstep(0.93, 1.0, fres) * 0.35;
        col += vec3(s1 + s2);

        float alpha = clamp(0.05 + fres * 0.6 + s1 + s2, 0.0, 0.92);

        // 破裂：洞口从 uPopDir 处张开（真实泡膜从一点破开、裂口飞速扩大），
        // 洞内的膜直接丢弃；洞缘是回缩的膜卷边 — 亮彩虹环
        if (uPop > 0.001) {
          float ang = acos(clamp(dot(normalize(vBubblePos), normalize(uPopDir)), -1.0, 1.0));
          float holeR = uPop * 3.14159;
          if (ang < holeR) discard;
          float lip = 1.0 - smoothstep(holeR, holeR + 0.15, ang);
          col += (film * 1.1 + vec3(0.55)) * lip;
          alpha = max(alpha, lip * 0.95);
        }

        gl_FragColor = vec4(col, alpha);
      }`,
  });
  material.userData.bubbleUniforms = uniforms;
  return material;
}

// 气泡集群注册表 — 一个集群 = 一个气泡 + 里面裹着的所有纸团
const clusters = new Set();

// デバッグ (?debug=bubble): 第一个气泡的屏幕坐标（供自动化测试定位）
if (debugBubble) {
  window.__bubbleScreenPos = (i = 0) => {
    const c = [...clusters][i];
    if (!c) return null;
    const v = c.center.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      r: c.visR,
      members: c.members.length,
    };
  };
  // 第 i 个未被气泡包裹的纸团的屏幕坐标（供自动化测试精准右击）
  window.__paperScreenPos = (i = 0) => {
    const free = papers.filter(p => !p.bubble);
    const p = free[i];
    if (!p) return null;
    const v = p.mesh.position.clone().project(camera);
    return {
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
    };
  };
  // 所有 cluster 的成员世界坐标（供自动化验证泡内碰撞：成员最小间距）
  window.__clusterInfo = () =>
    [...clusters].map((c) => ({
      members: c.members.map((m) => [
        +m.body.position.x.toFixed(3),
        +m.body.position.y.toFixed(3),
        +m.body.position.z.toFixed(3),
      ]),
      center: [+c.center.x.toFixed(3), +c.center.y.toFixed(3), +c.center.z.toFixed(3)],
      visR: +c.visR.toFixed(3),
    }));
}

function attachBubble(cluster) {
  ensureBubbleAssets();
  const mesh = new THREE.Mesh(bubbleGeometry, createBubbleMaterial());
  mesh.renderOrder = 10;
  mesh.userData.paper = cluster.host;
  scene.add(mesh);
  _bubbleMeshes.push(mesh);
  cluster.bubble = mesh;
}

function disposeClusterBubble(cluster) {
  disposeDroplets(cluster);
  if (!cluster.bubble) return;
  scene.remove(cluster.bubble);
  const i = _bubbleMeshes.indexOf(cluster.bubble);
  if (i !== -1) _bubbleMeshes.splice(i, 1);
  cluster.bubble.material.dispose();
  cluster.bubble = null;
}

// 破裂喷出的小水珠 + 碎膜雾化微粒 — 膜从一点破开，水珠沿膜面法线向外飞溅，
// 雾化的膜屑（Points）慢速扩散、快速消散，像肥皂泡破掉时那层轻烟
let dropletGeometry = null;

function spawnDroplets(cluster) {
  if (!dropletGeometry) dropletGeometry = new THREE.IcosahedronGeometry(1, 1);
  cluster.drops = [];
  // 水珠：数量多、尺寸差异大（0.006~0.024），小的飞得快、大的飞得慢
  const n = 22 + Math.floor(Math.random() * 10);
  for (let i = 0; i < n; i++) {
    const u = randomRange(-1, 1);
    const theta = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(rr * Math.cos(theta), rr * Math.sin(theta), u);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xeaf7ff,
      transparent: true,
      opacity: 0.9,
    });
    const mesh = new THREE.Mesh(dropletGeometry, mat);
    mesh.position.copy(cluster.center).addScaledVector(dir, cluster.visR * randomRange(0.85, 1.0));
    const baseScale = randomRange(0.006, 0.024);
    mesh.scale.setScalar(baseScale);
    scene.add(mesh);
    // 越小越快（动量相近），主方向沿膜法线向外 + 少量切向扰动 + 一点上浮
    const speed = (1.6 + Math.random() * 1.6) * (0.02 / (baseScale + 0.008));
    const vel = dir.clone().multiplyScalar(speed);
    vel.x += randomRange(-0.3, 0.3);
    vel.y += randomRange(0.1, 0.5);
    vel.z += randomRange(-0.3, 0.3);
    cluster.drops.push({ mesh, baseScale, vel, life: 0 });
  }

  // 雾化膜屑：一片微小光点，慢速向外扩散、很快消散（像破泡时的轻烟）。
  // 顶点色上粉彩彩虹 — 碎掉的膜屑还带着薄膜干涉的颜色
  const mistCount = 90;
  const positions = new Float32Array(mistCount * 3);
  const colors = new Float32Array(mistCount * 3);
  const vels = [];
  for (let i = 0; i < mistCount; i++) {
    const u = randomRange(-1, 1);
    const theta = Math.random() * Math.PI * 2;
    const rr = Math.sqrt(1 - u * u);
    const dir = new THREE.Vector3(rr * Math.cos(theta), rr * Math.sin(theta), u);
    positions[i * 3] = cluster.center.x + dir.x * cluster.visR * randomRange(0.7, 1.05);
    positions[i * 3 + 1] = cluster.center.y + dir.y * cluster.visR * randomRange(0.7, 1.05);
    positions[i * 3 + 2] = cluster.center.z + dir.z * cluster.visR * randomRange(0.7, 1.05);
    vels.push(dir.multiplyScalar(randomRange(0.5, 1.4)));
    // 粉彩色：高亮度随机色相（与泡膜的 cos 调色板同族）
    const hue = Math.random();
    colors[i * 3] = 0.72 + 0.28 * Math.cos(6.28318 * hue);
    colors[i * 3 + 1] = 0.72 + 0.28 * Math.cos(6.28318 * (hue + 0.33));
    colors[i * 3 + 2] = 0.72 + 0.28 * Math.cos(6.28318 * (hue + 0.67));
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 0.014,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true,
  });
  const points = new THREE.Points(geo, mat);
  points.renderOrder = 11;
  scene.add(points);
  cluster.mist = { points, vels, life: 0 };
}

const _dropDir = new THREE.Vector3();
const _dropUp = new THREE.Vector3(0, 1, 0);

function updateDroplets(cluster, dt) {
  if (cluster.drops) {
    for (const d of cluster.drops) {
      d.life += dt;
      d.vel.y -= 4.5 * dt; // 水珠受重力
      d.mesh.position.addScaledVector(d.vel, dt);
      // 落地即消失 — 水珠不会穿透地面
      if (d.mesh.position.y < 0.02) {
        d.mesh.visible = false;
        d.life = 1e9;
        continue;
      }
      // 飞行中沿速度方向拉长（表面张力把液滴拉成梭形），越慢越圆
      const speed = d.vel.length();
      const stretch = Math.min(1 + speed * 0.55, 2.6);
      _dropDir.copy(d.vel).normalize();
      d.mesh.quaternion.setFromUnitVectors(_dropUp, _dropDir);
      const k = Math.max(0, 1 - d.life / 0.6);
      d.mesh.scale.set(d.baseScale, d.baseScale * stretch * (0.4 + 0.6 * k), d.baseScale);
      d.mesh.material.opacity = 0.9 * k;
      d.mesh.visible = k > 0;
    }
  }
  if (cluster.mist) {
    const m = cluster.mist;
    m.life += dt;
    const pos = m.points.geometry.attributes.position;
    for (let i = 0; i < m.vels.length; i++) {
      const v = m.vels[i];
      // 雾滴有空气阻力，逐渐减速
      v.multiplyScalar(1 - 2.2 * dt);
      pos.array[i * 3] += v.x * dt;
      pos.array[i * 3 + 1] += v.y * dt + 0.15 * dt; // 轻微上扬
      pos.array[i * 3 + 2] += v.z * dt;
    }
    pos.needsUpdate = true;
    const k = Math.max(0, 1 - m.life / 0.45);
    m.points.material.opacity = 0.55 * k;
    m.points.visible = k > 0;
  }
}

function disposeDroplets(cluster) {
  if (cluster.drops) {
    for (const d of cluster.drops) {
      scene.remove(d.mesh);
      d.mesh.material.dispose();
    }
    cluster.drops = null;
  }
  if (cluster.mist) {
    scene.remove(cluster.mist.points);
    cluster.mist.points.geometry.dispose();
    cluster.mist.points.material.dispose();
    cluster.mist = null;
  }
}

// 按成员数排槽位：单个居中，多个用黄金螺旋均匀分布在球内
function layoutCluster(cluster) {
  const n = cluster.members.length;
  // 合成气泡别太大：基数压到 1.32、每多一个成员只涨 0.5，封顶 2.6
  const base = collisionRadius * 1.32;
  cluster.radius = Math.min(base * (1 + 0.5 * (n - 1)), base * 2.6);
  cluster.slots = [];
  for (let i = 0; i < n; i++) {
    if (n === 1) {
      cluster.slots.push(new THREE.Vector3(0, 0, 0));
      continue;
    }
    const k = i + 0.5;
    const phi = Math.acos(1 - (2 * k) / n);
    const theta = Math.PI * (1 + Math.sqrt(5)) * k;
    const r = cluster.radius * 0.34;
    cluster.slots.push(
      new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ),
    );
  }
}

// 右键纸团 → 裹进气泡并漂浮
function bubbleize(paper) {
  if (paper.mode === "bubble") return;
  paper.mode = "bubble";
  paper.state = "bubble";
  setPaperBodyDynamic(paper, false);
  if (pointerState && pointerState.paper === paper) pointerState = null;

  const off = crumpleWorldOffset(paper.mesh.scale.x, paper.mesh.quaternion);
  const center = new THREE.Vector3(
    paper.mesh.position.x + off.x,
    paper.mesh.position.y + off.y,
    paper.mesh.position.z + off.z,
  );
  const cluster = {
    members: [paper],
    host: paper,
    center,
    // 上一帧的中心 — 用来把中心位移刚性传导给成员（纸团贴着泡走）
    prevCenter: center.clone(),
    hoverY: restCenterY + 1.0 + randomRange(0, 0.3),
    formT: 0,
    popping: false,
    popT: 0,
    drops: null,
    phase: Math.random() * Math.PI * 2,
    dragging: false,
    dragTarget: new THREE.Vector3(),
    bubble: null,
    radius: 0,
    // 初始就裹住纸团（膜从贴住纸团的尺寸开始鼓起，而不是从 0 长大），
    // 否则生成初期纸团会露出膜外
    visR: collisionRadius * 1.1,
    slots: [],
  };
  paper.cluster = cluster;
  layoutCluster(cluster);
  attachBubble(cluster);
  clusters.add(cluster);
  playBlowSound();
}

// 破泡音效：WebAudio 现场合成，无素材文件。
// 真泡破裂声 = 膜面张力释放的短促气压脉冲 —— 一个快速下滑的正弦"啵"
// （约 550→180Hz，80ms）+ 一点点滤波噪声模拟膜碎的嘶声。
let audioCtx = null;

function playPopSound(cluster) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;

    // 大气泡共振峰低、音量大 — 音高随泡径缩放（泡越大越低沉）
    const k = cluster ? Math.min(Math.max(0.32 / cluster.visR, 0.55), 1.5) : 1;

    // "啵"：正弦音高快速下滑 + 指数衰减
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime((550 + Math.random() * 100) * k, t);
    osc.frequency.exponentialRampToValueAtTime(170 * k, t + 0.08);
    gain.gain.setValueAtTime(0.22 * (0.7 + 0.5 / k), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.11);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.12);

    // 膜碎嘶声：短噪声冲激过带通
    const noiseLen = Math.floor(audioCtx.sampleRate * 0.05);
    const buf = audioCtx.createBuffer(1, noiseLen, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / noiseLen);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buf;
    const bp = audioCtx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2600;
    bp.Q.value = 0.8;
    const ng = audioCtx.createGain();
    ng.gain.setValueAtTime(0.06, t);
    noise.connect(bp).connect(ng).connect(audioCtx.destination);
    noise.start(t);
  } catch (e) {
    /* 音频不可用时静默跳过 */
  }
}

// 合并音效：两个气泡融合成更大的泡 —— 低沉湿润的"啵噜"，
// 正弦从低频上滑（大气泡共振峰更低）+ 一点呼吸感的音量起伏
function playMergeSound(cluster) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    // 合成后的大泡共振峰更低
    const k = cluster ? Math.min(Math.max(0.32 / cluster.visR, 0.55), 1.5) : 1;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime((160 + Math.random() * 30) * k, t);
    osc.frequency.exponentialRampToValueAtTime(320 * k, t + 0.1);
    osc.frequency.exponentialRampToValueAtTime(140 * k, t + 0.22);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.16, t + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.26);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.28);
  } catch (e) {
    /* 音频不可用时静默跳过 */
  }
}

// 裹泡音效：吹泡泡那一声短促的"噗" —— 滤波噪声喷气 + 音高上滑的正弦
function playBlowSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(230, t);
    osc.frequency.exponentialRampToValueAtTime(430, t + 0.12);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.1, t + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.18);
  } catch (e) {
    /* 音频不可用时静默跳过 */
  }
}

// 破泡：成员全部落回桌面继续滚动
function popCluster(cluster) {
  if (cluster.popping) return;
  cluster.popping = true;
  cluster.popT = 0;
  cluster.dragging = false;
  playPopSound(cluster);
  if (pointerState && pointerState.cluster === cluster) pointerState = null;
  for (const m of cluster.members) {
    m.mode = "paper";
    m.cluster = null;
    m.state = "rolling";
    m.time = 0;
    m.throw = { settleTimer: 0 };
    setPaperBodyDynamic(m, true);
    syncBodyToMesh(m);
    // 继承泡内的惯性速度，再沿"泡心→纸团"方向被破裂气流向外吹开
    const bv = m.bubbleVel;
    let ox = m.body.position.x - cluster.center.x;
    let oy = m.body.position.y - cluster.center.y;
    let oz = m.body.position.z - cluster.center.z;
    const ol = Math.hypot(ox, oy, oz);
    if (ol > 1e-4) { ox /= ol; oy /= ol; oz /= ol; } else { ox = 0; oy = 1; oz = 0; }
    const blow = randomRange(0.35, 0.85);
    m.body.velocity.set(
      (bv ? bv.x : 0) + ox * blow + randomRange(-0.15, 0.15),
      (bv ? bv.y : 0) + oy * blow * 0.5 + randomRange(0.1, 0.4),
      (bv ? bv.z : 0) + oz * blow + randomRange(-0.15, 0.15),
    );
    m.bubbleVel = null;
    m.body.angularVelocity.set(
      randomRange(-3, 3),
      randomRange(-1, 1),
      randomRange(-3, 3),
    );
  }
  cluster.members = [];
  // 洞口从朝相机的一侧张开 — 用户"戳破"的那一面先破
  if (cluster.bubble) {
    const uni = cluster.bubble.material.userData.bubbleUniforms;
    uni.uPopDir.value.copy(camera.position).sub(cluster.center);
    uni.uPop.value = 0;
  }
}

function clampClusterCenter(cluster) {
  const bounds = getThrowBounds();
  const m = cluster.radius * 0.6;
  cluster.center.x = Math.min(
    Math.max(cluster.center.x, bounds.minX + m),
    bounds.maxX - m,
  );
  cluster.center.z = Math.min(
    Math.max(cluster.center.z, bounds.minZ + m),
    bounds.maxZ - m,
  );
  cluster.center.y = Math.min(
    Math.max(cluster.center.y, restCenterY + 0.45),
    restCenterY + 2.4,
  );
}

const _slotTarget = new THREE.Vector3();
const _spinQ = new THREE.Quaternion();
const _spinAxis = new THREE.Vector3();
const _spinCq = new CANNON.Quaternion();

function updateBubbles(dt, now) {
  for (const cluster of clusters) {
    const bubble = cluster.bubble;

    // 破裂三段式：①0.09s 失稳鼓包 → ②洞口从朝相机处张开、0.22s 吞掉整层膜
    // → ③水珠飞溅坠落 + 雾化膜屑扩散消散
    if (cluster.popping) {
      cluster.popT += dt;
      const p = cluster.popT;
      if (bubble && bubble.visible) {
        const uni = bubble.material.userData.bubbleUniforms;
        uni.uTime.value = now;
        if (p < 0.09) {
          // 失稳：膜抖得越来越厉害、微微鼓大
          const q = p / 0.09;
          cluster.visR = cluster.radius * (1 + 0.08 * q);
          bubble.scale.setScalar(cluster.visR);
          uni.uAmp.value = 0.035 + 0.16 * q;
        } else if (p < 0.31) {
          // 洞口张开（缓入加速，真实破裂是表面张力驱动的加速回缩）
          const q = (p - 0.09) / 0.22;
          uni.uPop.value = q * q * 1.05;
          uni.uAmp.value = 0.05;
        } else {
          bubble.visible = false; // 膜没了，只剩水珠和雾
          if (!cluster.drops) spawnDroplets(cluster);
        }
      }
      updateDroplets(cluster, dt);
      if (p > 0.85) {
        disposeClusterBubble(cluster);
        clusters.delete(cluster);
      }
      continue;
    }

    if (bubble) {
      const uni = bubble.material.userData.bubbleUniforms;
      uni.uTime.value = now;
    }

    // 成型动画（0→1）：快速鼓起带 7% 过冲，随后安定
    cluster.formT = Math.min(cluster.formT + dt / 0.65, 1);
    const form = 1 - Math.pow(1 - cluster.formT, 2.4);
    const life = form * (1 + Math.sin(cluster.formT * Math.PI) * 0.07);

    // 成员惯性模拟 — 纸团不再刚性贴泡，而是泡在液体里的有质量物体：
    // 弹簧收拢到槽位 + 速度阻尼 + 膜壁拖拽（泡动带纸团）+ 轻微下沉，
    // 最后做泡壁碰撞约束。快速晃动气泡时纸团因惯性滞后、撞壁反弹。
    // 注意：泡中心和成员必须用同一个钳制步长 sdt，否则掉帧/后台标签页里
    // dt 很大时两者积分尺度不一致，纸团会被甩出膜外。
    const sdt = Math.min(Math.max(dt, 1e-4), 0.05);

    // 中心运动：拖拽时跟指针；松手后按释放速度惯性滑行（空气阻力衰减 +
    // 浮力托回悬浮高度），滑停了才回到缓慢悬浮漂移
    if (cluster.dragging) {
      cluster.center.lerp(cluster.dragTarget, 1 - Math.exp(-14 * sdt));
    } else if (cluster.releaseVel) {
      const rv = cluster.releaseVel;
      cluster.center.addScaledVector(rv, sdt);
      rv.multiplyScalar(Math.exp(-2.4 * sdt)); // 空气阻力
      rv.y += (cluster.hoverY - cluster.center.y) * 1.6 * sdt; // 浮力回正
      if (rv.length() < 0.08) cluster.releaseVel = null;
    } else {
      cluster.center.y +=
        (cluster.hoverY - cluster.center.y) * (1 - Math.exp(-2.2 * sdt));
      cluster.center.x += Math.sin(now * 0.4 + cluster.phase) * 0.04 * sdt;
      cluster.center.z += Math.cos(now * 0.33 + cluster.phase * 1.3) * 0.03 * sdt;
    }
    clampClusterCenter(cluster);

    // 泡中心这帧的速度 — 膜壁对内部纸团的拖拽力来源；
    // 拖拽中顺便记下来，松手时作为惯性滑行的初速度
    const cvx = (cluster.center.x - cluster.prevCenter.x) / sdt;
    const cvy = (cluster.center.y - cluster.prevCenter.y) / sdt;
    const cvz = (cluster.center.z - cluster.prevCenter.z) / sdt;
    if (cluster.dragging) {
      if (!cluster.lastVel) cluster.lastVel = new THREE.Vector3();
      cluster.lastVel.set(cvx, cvy, cvz);
    }

    // 运动响应膜面：气泡移动越快，液膜晃动越剧烈、彩虹边缘越亮
    // （惯性搅动膜面）；静止时回落到成型期的基础摆动
    if (bubble) {
      const uni = bubble.material.userData.bubbleUniforms;
      const spd = Math.hypot(cvx, cvy, cvz);
      const baseAmp = 0.035 + 0.09 * Math.pow(1 - cluster.formT, 1.6);
      const targetAmp = baseAmp + Math.min(spd * 0.05, 0.1);
      uni.uAmp.value += (targetAmp - uni.uAmp.value) * Math.min(dt * 8, 1);
      uni.uRimStrength.value = 0.7 + Math.min(spd * 0.2, 0.45);
    }
    const SPRING_K = 3.5;   // 向槽位收拢的弹性（软一点，晃动时纸团才会甩）
    const DRAG = 1.4;       // 膜内液体对纸团的粘滞拖拽
    const DAMP = 1.6;       // 速度阻尼
    const SINK = 0.22;      // 纸团比膜重，缓慢往下沉
    const MAX_V = 3.5;
    for (let i = 0; i < cluster.members.length; i++) {
      const m = cluster.members[i];
      if (!m.bubbleVel) m.bubbleVel = new THREE.Vector3();
      const v = m.bubbleVel;
      const slot = cluster.slots[i];
      _slotTarget.copy(cluster.center).addScaledVector(slot, form);
      _slotTarget.y += Math.sin(now * 1.6 + cluster.phase + i * 1.7) * 0.03;
      const b = m.body.position;

      v.x += ((_slotTarget.x - b.x) * SPRING_K + (cvx - v.x) * DRAG - v.x * DAMP) * sdt;
      v.y += ((_slotTarget.y - b.y) * SPRING_K + (cvy - v.y) * DRAG - v.y * DAMP - SINK) * sdt;
      v.z += ((_slotTarget.z - b.z) * SPRING_K + (cvz - v.z) * DRAG - v.z * DAMP) * sdt;
      const spd = v.length();
      if (spd > MAX_V) v.multiplyScalar(MAX_V / spd);
      b.x += v.x * sdt;
      b.y += v.y * sdt;
      b.z += v.z * sdt;

      // 泡壁碰撞：纸团撞到膜内侧就停下并轻微弹回。
      // 壁半径 = 膜半径收一点 - 纸团自身半径，保证纸团视觉上始终在膜内；
      // 成型初期膜很小，下限取接近 0（纸团本来就该收拢在中心）。
      const wallR = Math.max(cluster.visR * 0.86 - collisionRadius, 0.01);
      const dx = b.x - cluster.center.x;
      const dy = b.y - cluster.center.y;
      const dz = b.z - cluster.center.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > wallR && dist > 1e-6) {
        const nx = dx / dist, ny = dy / dist, nz = dz / dist;
        b.x = cluster.center.x + nx * wallR;
        b.y = cluster.center.y + ny * wallR;
        b.z = cluster.center.z + nz * wallR;
        const vn = v.x * nx + v.y * ny + v.z * nz;
        if (vn > 0) {
          // 法向速度反弹（很软，膜会变形吸能）
          v.x -= vn * 1.35 * nx;
          v.y -= vn * 1.35 * ny;
          v.z -= vn * 1.35 * nz;
        }
      }

      _spinAxis.copy(m.spinAxis);
      _spinQ.setFromAxisAngle(_spinAxis, m.spinSpeed * dt);
      _spinCq.set(_spinQ.x, _spinQ.y, _spinQ.z, _spinQ.w);
      m.body.quaternion.mult(_spinCq, m.body.quaternion);
      syncMeshToBody(m, m.mesh.scale.x);
      // デバッグ (?debug=bubble): 泡とメンバーの位置関係を #info に出す
      if (debugBubble && i === 0) {
        window.__dbg = window.__dbg || [];
        if (window.__dbg.length < 400 && (window.__dbg.length === 0 || now - window.__dbg[window.__dbg.length - 1].t > 0.1)) {
          window.__dbg.push({
            t: +now.toFixed(2),
            cx: +cluster.center.x.toFixed(3),
            cy: +cluster.center.y.toFixed(3),
            bx: +b.x.toFixed(3),
            by: +b.y.toFixed(3),
            vy: +v.y.toFixed(3),
            visR: +cluster.visR.toFixed(3),
          });
        }
      }
    }

    // 纸团之间的碰撞（泡内多成员时）：等质量球-球碰撞 —
    // 重叠时先把两者沿法线各推开一半（位置修正），再交换法向速度分量，
    // 恢复系数 0.45 的软碰撞（纸团不是台球，碰撞会吸能）。
    // 槽位分布半径通常大于 2*碰撞半径，稳态不接触；只有晃动甩动时才撞。
    const members = cluster.members;
    if (members.length > 1) {
      const MIN_D = collisionRadius * 1.9; // 略小于两半径和，留一点视觉间隙
      const REST = 0.45;
      for (let i = 0; i < members.length; i++) {
        for (let j = i + 1; j < members.length; j++) {
          const A = members[i], B = members[j];
          const pa = A.body.position, pb = B.body.position;
          let dx = pb.x - pa.x, dy = pb.y - pa.y, dz = pb.z - pa.z;
          let d = Math.hypot(dx, dy, dz);
          if (d >= MIN_D) continue;
          if (d < 1e-6) { dx = 1; dy = 0; dz = 0; d = 1; } // 完全重合时随便挑个方向
          const nx = dx / d, ny = dy / d, nz = dz / d;
          // 位置修正：各退一半重叠量
          const push = (MIN_D - d) * 0.5;
          pa.x -= nx * push; pa.y -= ny * push; pa.z -= nz * push;
          pb.x += nx * push; pb.y += ny * push; pb.z += nz * push;
          // 法向相对速度：只有相互接近时才施加冲量
          const va = A.bubbleVel, vb = B.bubbleVel;
          const rvn = (vb.x - va.x) * nx + (vb.y - va.y) * ny + (vb.z - va.z) * nz;
          if (rvn < 0) {
            const jn = -(1 + REST) * rvn * 0.5; // 等质量，冲量平分
            va.x -= jn * nx; va.y -= jn * ny; va.z -= jn * nz;
            vb.x += jn * nx; vb.y += jn * ny; vb.z += jn * nz;
          }
        }
      }
      // 碰撞改动了位置，重新同步网格再进下一帧
      for (const m of members) syncMeshToBody(m, m.mesh.scale.x);
    }
    cluster.prevCenter.copy(cluster.center);

    if (bubble) {
      bubble.visible = true;
      bubble.position.copy(cluster.center);
      const breathe = 1 + Math.sin(now * 1.8 + cluster.phase) * 0.02;
      // 成型中也保证膜半径始终罩得住纸团
      const minCover = collisionRadius * 1.1;
      const targetR = Math.max(cluster.radius * life * breathe, minCover);
      cluster.visR += (targetR - cluster.visR) * (1 - Math.exp(-8 * dt));
      bubble.scale.setScalar(Math.max(cluster.visR, 0.0001));
    }
  }

  // 气泡相碰 → 合并成一个更大的泡泡（中心更新完之后统一判定）
  const list = [...clusters].filter((c) => !c.popping);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (!clusters.has(a) || !clusters.has(b)) continue; // 已被合并
      const sumR = a.radius + b.radius;
      const dAB = a.center.distanceTo(b.center);
      if (dAB < sumR * 0.75) {
        const big = a.members.length >= b.members.length ? a : b;
        const small = big === a ? b : a;
        for (const m of small.members) {
          m.cluster = big;
          big.members.push(m);
        }
        big.center.add(small.center).multiplyScalar(0.5);
        big.hoverY = Math.max(big.hoverY, small.hoverY) + 0.06;
        // 中心被重置，同步基准点避免成员被一帧位移甩出泡外
        big.prevCenter.copy(big.center);
        small.members = [];
        disposeClusterBubble(small);
        clusters.delete(small);
        layoutCluster(big);
        // 正在拖的如果是被吸收的一方，把指针状态改挂到大气泡上，否则拖拽会悬空
        if (pointerState && pointerState.cluster === small) {
          pointerState.cluster = big;
        }
        // 半成型状态：槽位收拢/泡泡变大有个过渡，而不是瞬间跳变
        big.formT = Math.max(big.formT, 0.6);
        playMergeSound(big);
      } else if (dAB < sumR && dAB > 1e-4) {
        // 膜面弹性互斥：轻触时两个气泡像真泡一样互相弹开一点，
        // 不再互相穿透一大截才合并；用力怼进去（越过 0.75 阈值）才融合
        const push = (sumR - dAB) * Math.min(dt * 6, 0.5) * 0.5;
        const nx = (b.center.x - a.center.x) / dAB;
        const ny = (b.center.y - a.center.y) / dAB;
        const nz = (b.center.z - a.center.z) / dAB;
        a.center.x -= nx * push; a.center.y -= ny * push; a.center.z -= nz * push;
        b.center.x += nx * push; b.center.y += ny * push; b.center.z += nz * push;
      }
    }
  }
}

function spawnPaper(position, dropIn, dropHeight = randomRange(0.8, 1.2), customMaterial = null) {
  const maxFrame = animData.frameCount - 1;
  // カスタム材質（ユーザー手書き紙）があればそれを使い、なければデザインを交互に割り当てる
  const base = customMaterial
    ? createPaper(animData, 0, customMaterial)
    : createPaper(animData, spawnCounter++ % PAPER_DESIGNS.length);
  base.mesh.castShadow = true;
  base.mesh.rotation.set(
    0,
    Math.PI + randomRange(-0.25, 0.25),
    randomRange(-0.18, 0.18),
  );
  base.mesh.position.copy(position);
  base.mesh.scale.setScalar(CLOSED_SCALE);
  scene.add(base.mesh);
  const body = createPaperBody(base);

  const paper = {
    ...base,
    body,
    frameIdx: maxFrame,
    state: "closed",
    mode: "paper", // "paper" = 普通纸团；"bubble" = 被气泡裹着漂浮
    cluster: null,
    spinAxis: new THREE.Vector3(
      randomRange(-1, 1),
      randomRange(-1, 1),
      randomRange(-1, 1),
    ).normalize(),
    spinSpeed: randomRange(0.35, 0.95),
    time: 0,
    homePosition: base.mesh.position.clone(),
    homeRotation: base.mesh.rotation.clone(),
    start: null,
    target: null,
    throw: null,
  };
  updatePaperFrame(paper, animData, maxFrame);
  papers.push(paper);

  // 記事用 (?debug=physics): 衝突球をワイヤーフレームで可視化
  if (debugPhysics) {
    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(collisionRadius, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x00b566, wireframe: true }),
    );
    scene.add(wire);
    paper.debugSphere = wire;
  }

  if (dropIn) {
    // 上から落として登場させる
    paper.state = "rolling";
    paper.throw = { settleTimer: 0 };
    body.position.y += dropHeight;
    body.angularVelocity.set(
      randomRange(-1.5, 1.5),
      randomRange(-0.5, 0.5),
      randomRange(-1.5, 1.5),
    );
    syncMeshToBody(paper);
  }
  return paper;
}

function removeOnePaper() {
  // 開いている・掴んでいる・アニメ中の紙は消さない
  let idx = -1;
  for (let i = papers.length - 1; i >= 0; i--) {
    const p = papers[i];
    if (
      p === activePaper ||
      p.state === "grabbed" ||
      p.state === "opening" ||
      p.state === "open" ||
      p.state === "discarding"
    ) {
      continue;
    }
    idx = i;
    break;
  }
  if (idx === -1) {
    for (let i = papers.length - 1; i >= 0; i--) {
      if (papers[i].state === "grabbed") continue;
      idx = i;
      break;
    }
  }
  if (idx === -1) return false;

  const p = papers[idx];
  if (p === activePaper) activePaper = null;
  if (pointerState && pointerState.paper === p) pointerState.paper = null;
  if (pointerState && pointerState.cluster && p.cluster === pointerState.cluster) {
    pointerState = null;
  }
  if (p.debugSphere) scene.remove(p.debugSphere);
  // 从所属气泡集群里摘除；空了就清掉泡泡，否则重排槽位
  if (p.cluster) {
    const cluster = p.cluster;
    const mi = cluster.members.indexOf(p);
    if (mi !== -1) cluster.members.splice(mi, 1);
    p.cluster = null;
    if (cluster.members.length === 0) {
      disposeClusterBubble(cluster);
      clusters.delete(cluster);
    } else {
      if (cluster.host === p) {
        cluster.host = cluster.members[0];
        if (cluster.bubble) cluster.bubble.userData.paper = cluster.host;
      }
      layoutCluster(cluster);
    }
  }
  scene.remove(p.mesh);
  p.mesh.geometry.dispose();
  // 克隆出来的材质与专属折痕贴图一并回收（共享的设计纹理不动）
  if (p.ownMaterial) {
    if (p.ownMaterial.userData.ownMap) p.ownMaterial.userData.ownMap.dispose();
    if (p.ownMaterial.bumpMap) p.ownMaterial.bumpMap.dispose();
    p.ownMaterial.dispose();
  }
  physicsWorld.removeBody(p.body);
  papers.splice(idx, 1);
  return true;
}

function syncPaperCount() {
  if (!animData) return;
  const target = Math.round(paperSettings.count);
  while (papers.length > target && removeOnePaper()) {
    // removeOnePaper が false を返したら打ち切り
  }
  while (papers.length < target) {
    spawnPaper(randomSpawnPosition(), true);
  }
}

// ==================================================
// ユーザー手書きメモ — 入力した文章 / 画像を紙面に描いて投げ入れる
// パネルは ✍ ボタンで開閉（開けっぱなしは紙玉操作の邪魔になる）
// ==================================================
const noteFab = document.getElementById("note-fab");
const notePanel = document.getElementById("note-panel");
const noteText = document.getElementById("note-text");
const noteSubmit = document.getElementById("note-submit");
const noteImageInput = document.getElementById("note-image");
const imgName = document.getElementById("img-name");
let noteImageUrl = null;

function closeNotePanel() {
  notePanel.classList.add("hidden");
}

noteFab.addEventListener("click", () => {
  const willOpen = notePanel.classList.contains("hidden");
  notePanel.classList.toggle("hidden");
  if (willOpen) noteText.focus();
});

noteImageInput.addEventListener("change", () => {
  const file = noteImageInput.files && noteImageInput.files[0];
  if (!file) {
    noteImageUrl = null;
    imgName.textContent = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    noteImageUrl = reader.result;
    imgName.textContent = `🖼 ${file.name}`;
  };
  reader.readAsDataURL(file);
});

function throwUserNote() {
  if (!animData) return;
  const text = noteText.value.trim();
  if (!text && !noteImageUrl) return;

  // 上限に達していたら古い紙を1枚減らしてから追加
  if (papers.length >= MAX_PAPERS) removeOnePaper();

  // ステージ中央のやや手前上空に落とす
  const position = new THREE.Vector3(
    randomRange(-0.4, 0.4),
    restMeshY,
    randomRange(-0.2, 0.5),
  );
  spawnPaper(position, true, randomRange(1.4, 2.0), createUserMaterial(text, noteImageUrl));

  noteText.value = "";
  noteImageUrl = null;
  noteImageInput.value = "";
  imgName.textContent = "";
  closeNotePanel();
}

noteSubmit.addEventListener("click", throwUserNote);
noteText.addEventListener("keydown", (e) => {
  // Ctrl/Cmd + Enter でも投稿できる（通常 Enter は改行）
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
    e.preventDefault();
    throwUserNote();
  }
});

// ==================================================
// ポインタ操作 — クリックで開閉 / ドラッグで掴んで投げる
// ==================================================
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const grabPlane = new THREE.Plane();
const grabHitPoint = new THREE.Vector3();
let pointerState = null;

renderer.domElement.style.touchAction = "none";

function updatePointer(e) {
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
}

function pickPaper(e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  // 气泡膜比纸团大一圈，看起来点在泡上、实际射线可能从纸面网格旁穿过。
  // 把可见的气泡也纳入检测，命中气泡即视为命中它裹住的那张纸。
  const targets = [];
  for (const p of papers) {
    targets.push(p.mesh);
  }
  // 气泡挂在集群上而不是单个纸团上，这里统一把可见的泡泡纳入检测，
  // 命中泡泡即视为命中它裹住的纸团（userData.paper 指向集群代表）。
  for (const c of clusters) {
    if (c.bubble && c.bubble.visible && !c.popping) targets.push(c.bubble);
  }
  const hit = raycaster.intersectObjects(targets);
  if (hit.length === 0) return null;
  const obj = hit[0].object;
  return obj.userData.paper || papers.find((p) => p.mesh === obj) || null;
}

function isGrabbable(paper) {
  return paper.state === "closed" || paper.state === "rolling";
}

renderer.domElement.addEventListener("pointerdown", (e) => {
  if (!animData || pointerState) return;

  // 右键：托住气泡 — 在面向相机的平面里上下左右拖动，拖动中滚轮前后推拉；
  // 几乎没移动的右击保持原语义（气泡→戳破 / 普通纸团→裹进气泡），在 pointerup 判定
  if (e.button === 2) {
    const p = pickPaper(e);
    if (debugBubble) window.__rightDown = { x: e.clientX, y: e.clientY, hit: p ? p.mode : null };
    if (!p) return;
    if (p.mode === "bubble" && p.cluster) {
      const plane = new THREE.Plane();
      const dir = camera.getWorldDirection(new THREE.Vector3());
      plane.setFromNormalAndCoplanarPoint(dir, p.cluster.center);
      p.cluster.dragging = true;
      p.cluster.releaseVel = null; // 抓住即停下滑行
      p.cluster.dragTarget.copy(p.cluster.center);
      pointerState = {
        type: "cluster",
        cluster: p.cluster,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        plane,
        rightButton: true,
        depth: 0, // 滚轮累计的前后偏移（沿视线方向，正 = 远离相机）
        anchor: p.cluster.center.clone(),
      };
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events, etc. where pointerId is not valid are ignored
      }
    } else if (isGrabbable(p)) {
      pointerState = {
        type: "rightTap",
        paper: p,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
      try {
        renderer.domElement.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events, etc. where pointerId is not valid are ignored
      }
    }
    return;
  }
  if (e.button !== 0) return; // Middle button etc. are unused
  const p = pickPaper(e);

  // Bubbles: holding it drags the entire bubble (including the paper balls inside)
  if (p && p.mode === "bubble" && p.cluster) {
    const plane = new THREE.Plane();
    // 拖拽映射用固定高度的水平面：指针在"桌面"上的落点决定气泡的 x/z。
    // 与抓纸团的手感一致；若用面向相机的平面，气泡深度在拖拽中不变，
    // 两个深浅不同的泡泡在屏幕上重叠也碰不到一起，无法合并。
    plane.setFromNormalAndCoplanarPoint(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(0, restCenterY + 1.2, 0),
    );
    p.cluster.dragging = true;
    p.cluster.releaseVel = null; // 抓住即停下滑行
    p.cluster.dragTarget.copy(p.cluster.center);
    pointerState = {
      type: "cluster",
      cluster: p.cluster,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      plane,
    };
    try {
      renderer.domElement.setPointerCapture(e.pointerId);
    } catch {
      // Synthetic events, etc. where pointerId is not valid are ignored
    }
    return;
  }

  pointerState = {
    type: "paper",
    paper: p,
    pointerId: e.pointerId,
    startX: e.clientX,
    startY: e.clientY,
    grabbing: false,
  };
  try {
    renderer.domElement.setPointerCapture(e.pointerId);
  } catch {
    // Synthetic events, etc. where pointerId is not valid are ignored
  }

  // Papers that are rolling can be caught immediately
  if (p && p.state === "rolling") beginGrab(p, e);
});

renderer.domElement.addEventListener("pointermove", (e) => {
  if (!pointerState) {
    updateHoverCursor(e);
    return;
  }
  if (e.pointerId !== pointerState.pointerId) return;

  // 拖气泡：把指针在按下时那张面向相机平面上的位置作为集群目标
  if (pointerState.type === "cluster") {
    updateClusterDragTarget(pointerState.cluster, e);
    return;
  }

  // 右键按住普通纸团：只记录轨迹，不做任何拖拽（留给 pointerup 判定右击）
  if (pointerState.type === "rightTap") return;

  if (!pointerState.grabbing) {
    const p = pointerState.paper;
    const moved = Math.hypot(
      e.clientX - pointerState.startX,
      e.clientY - pointerState.startY,
    );
    if (p && isGrabbable(p) && moved > CLICK_DRAG_THRESHOLD_PX) {
      beginGrab(p, e);
    }
  }
  if (pointerState.grabbing) updateGrabTarget(pointerState.paper, e);
});

renderer.domElement.addEventListener("pointerup", (e) => {
  if (!pointerState || e.pointerId !== pointerState.pointerId) return;
  // 气泡：拖动结束停在原地；几乎没移动的单击 = 戳破
  if (pointerState.type === "cluster") {
    const cluster = pointerState.cluster;
    const moved = Math.hypot(
      e.clientX - pointerState.startX,
      e.clientY - pointerState.startY,
    );
    cluster.dragging = false;
    // 松手惯性：把拖拽末段的速度交给气泡，让它滑出去慢慢停
    if (cluster.lastVel) {
      const sp = cluster.lastVel.length();
      const cap = 2.8; // 甩得再快也有上限，防止飞出视野
      cluster.releaseVel = sp > 0.15
        ? cluster.lastVel.clone().multiplyScalar(Math.min(1, cap / sp))
        : null;
    }
    if (moved <= CLICK_DRAG_THRESHOLD_PX && clusters.has(cluster)) {
      popCluster(cluster);
    }
    pointerState = null;
    return;
  }
  // 右击普通纸团（几乎没移动）= 裹进气泡
  if (pointerState.type === "rightTap") {
    const moved = Math.hypot(
      e.clientX - pointerState.startX,
      e.clientY - pointerState.startY,
    );
    const p = pointerState.paper;
    if (moved <= CLICK_DRAG_THRESHOLD_PX && p && isGrabbable(p)) {
      bubbleize(p);
    }
    pointerState = null;
    return;
  }
  if (pointerState.grabbing) {
    releaseGrab(pointerState.paper, true);
  } else {
    handleClick(e);
  }
  pointerState = null;
});

renderer.domElement.addEventListener("pointercancel", (e) => {
  if (!pointerState || e.pointerId !== pointerState.pointerId) return;
  if (pointerState.type === "cluster") {
    pointerState.cluster.dragging = false;
  } else if (pointerState.grabbing) {
    releaseGrab(pointerState.paper, false);
  }
  pointerState = null;
});

// contextmenu 只负责禁止系统菜单 — 右击/右拖的逻辑都在 pointerdown/up 里
renderer.domElement.addEventListener("contextmenu", (e) => {
  e.preventDefault();
});

// 右键托举气泡时滚轮前后推拉（沿视线方向平移拖拽平面）
renderer.domElement.addEventListener(
  "wheel",
  (e) => {
    if (!pointerState || pointerState.type !== "cluster" || !pointerState.rightButton) {
      return;
    }
    e.preventDefault();
    // 上滚 = 推远，下滚 = 拉近
    pointerState.depth += (e.deltaY > 0 ? -1 : 1) * 0.12;
    pointerState.depth = Math.min(Math.max(pointerState.depth, -1.2), 1.6);
    const dir = camera.getWorldDirection(new THREE.Vector3());
    const point = pointerState.anchor
      .clone()
      .addScaledVector(dir, pointerState.depth);
    pointerState.plane.setFromNormalAndCoplanarPoint(dir, point);
    // 立即把气泡送往新深度，不等指针移动
    pointerState.cluster.dragTarget.copy(point);
  },
  { passive: false },
);

function updateHoverCursor(e) {
  if (!animData) return;
  const p = pickPaper(e);
  let cursor = "";
  if (p) {
    cursor = p.mode === "bubble" || isGrabbable(p) ? "grab" : "pointer";
  }
  renderer.domElement.style.cursor = cursor;
}

function handleClick(e) {
  const p = pickPaper(e);
  if (!p) return;

  const previousActive = activePaper;
  if (previousActive) {
    startDiscard(previousActive);
    activePaper = null;
  }

  if (previousActive === p || p.state !== "closed") return;

  startOpen(p);
  activePaper = p;
}

function beginGrab(paper, e) {
  pointerState.grabbing = true;
  paper.state = "grabbed";
  paper.time = 0;

  const body = paper.body;
  body.type = CANNON.Body.KINEMATIC;
  body.mass = 0;
  body.updateMassProperties();
  body.velocity.set(0, 0, 0);
  body.angularVelocity.set(0, 0, 0);
  // 掴んでいる間も他の紙玉を押しのけられるよう衝突は有効のまま
  body.collisionFilterGroup = 1;
  body.collisionFilterMask = 1;
  body.wakeUp();

  paper.grab = {
    target: new THREE.Vector3(
      body.position.x,
      restCenterY + GRAB_LIFT,
      body.position.z,
    ),
  };
  updateGrabTarget(paper, e);
  renderer.domElement.style.cursor = "grabbing";
}

function updateGrabTarget(paper, e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  grabPlane.normal.set(0, 1, 0);
  grabPlane.constant = -(restCenterY + GRAB_LIFT);
  if (!raycaster.ray.intersectPlane(grabPlane, grabHitPoint)) return;

  const bounds = getThrowBounds();
  paper.grab.target.set(
    Math.min(
      Math.max(grabHitPoint.x, bounds.minX + collisionRadius),
      bounds.maxX - collisionRadius,
    ),
    restCenterY + GRAB_LIFT,
    Math.min(
      Math.max(grabHitPoint.z, bounds.minZ + collisionRadius),
      bounds.maxZ - collisionRadius,
    ),
  );
}

// 拖气泡时把指针位置换算成集群中心的目标点
// （平面是 pointerdown 时建立的固定高度水平面）
function updateClusterDragTarget(cluster, e) {
  updatePointer(e);
  raycaster.setFromCamera(pointer, camera);
  if (!pointerState.plane) return;
  if (!raycaster.ray.intersectPlane(pointerState.plane, grabHitPoint)) return;
  if (pointerState.rightButton) {
    // 右键托举：面向相机的平面，x/y/z 全部跟随指针（上下左右都能动）
    cluster.dragTarget.copy(grabHitPoint);
    if (debugBubble) window.__dragT = cluster.dragTarget.toArray().map((n) => +n.toFixed(2));
  } else {
    // x/z 跟随指针在桌面上的落点；高度保持当前值（松手后回归悬浮高度）
    cluster.dragTarget.set(grabHitPoint.x, cluster.center.y, grabHitPoint.z);
  }
}

function releaseGrab(paper, withThrow) {
  const body = paper.body;
  let vx = withThrow ? body.velocity.x : 0;
  let vz = withThrow ? body.velocity.z : 0;
  const speed = Math.hypot(vx, vz);
  if (speed > THROW_MAX_SPEED) {
    const k = THROW_MAX_SPEED / speed;
    vx *= k;
    vz *= k;
  }

  body.type = CANNON.Body.DYNAMIC;
  body.mass = PAPER_MASS;
  body.updateMassProperties();
  body.velocity.set(vx, 0, vz);
  // 進行方向に転がる向きの回転を付ける
  body.angularVelocity.set(
    (vz / collisionRadius) * 0.6,
    0,
    (-vx / collisionRadius) * 0.6,
  );
  body.wakeUp();

  paper.state = "rolling";
  paper.time = 0;
  paper.throw = { settleTimer: 0 };
  renderer.domElement.style.cursor = "grab";
}

function startOpen(paper) {
  setPaperBodyDynamic(paper, false);
  syncMeshToBody(paper);
  paper.state = "opening";
  paper.time = 0;
  paper.start = captureTransform(paper);
  const pose = computeOpenPose();
  paper.target = {
    position: pose.position,
    quaternion: pose.quaternion,
    scale: pose.scale,
    frameIdx: animSettings.openFrame,
  };
}

function startDiscard(paper) {
  if (paper.state === "discarding" || paper.state === "rolling") return;

  // 開いた紙はカメラ手前にあるので、必ず奥(ステージ側)へ向けて捨てる
  const dir = new THREE.Vector3(
    randomRange(-1, 1),
    0,
    randomRange(-1.3, -0.45),
  );
  dir.normalize();

  paper.state = "discarding";
  paper.time = 0;
  paper.start = captureTransform(paper);
  setPaperBodyDynamic(paper, true);
  syncBodyToMesh(paper);
  paper.body.velocity.set(
    dir.x * randomRange(1.4, 2.0),
    randomRange(0.5, 0.9),
    dir.z * randomRange(1.4, 2.0),
  );
  paper.body.angularVelocity.set(
    randomRange(-2.4, 2.4),
    randomRange(-0.8, 0.8),
    randomRange(-2.4, 2.4),
  );
  paper.throw = {
    settleTimer: 0,
  };
}

// ==================================================
// アニメーション再生
// ==================================================
const FPS = 24;
const FRAME_DURATION = 1.0 / FPS;
let prevTime = null;

function startAnimation() {
  prevTime = performance.now() / 1000;
  renderer.setAnimationLoop(tick);
}

function tick() {
  const now = performance.now() / 1000;
  const dt = now - prevTime;
  prevTime = now;

  if (!animData) return;

  physicsWorld.step(PHYSICS_STEP, Math.min(dt, 0.05), 3);
  applyPhysicsBounds(dt);

  for (const p of papers) {
    updatePaperMotion(p, dt);
  }

  if (debugPhysics) {
    for (const p of papers) {
      if (!p.debugSphere) continue;
      p.debugSphere.position.set(
        p.body.position.x,
        p.body.position.y,
        p.body.position.z,
      );
    }
  }

  updateBubbles(dt, now);

  composer.render();
}

function updatePaperMotion(paper, dt) {
  const maxFrame = animData.frameCount - 1;

  if (paper.state === "opening") {
    paper.time += dt * animSettings.speed;
    const t = clamp01(paper.time / OPEN_DURATION);

    if (t < OPEN_FLY_RATIO) {
      // 阶段一：纸团保持揉皱状态飞向镜头前 — 到达之前不展开
      const e = easeOutCubic(t / OPEN_FLY_RATIO);
      paper.mesh.position.lerpVectors(
        paper.start.position,
        paper.target.position,
        e,
      );
      paper.mesh.quaternion.slerpQuaternions(
        paper.start.quaternion,
        paper.target.quaternion,
        e,
      );
      // 飞行中纸团翻滚晃动 + 轻微挤压变形 — 像被抛起的纸球而不是匀速滑块
      // 两端都归零，保证与静止姿态和阶段二无缝衔接
      const wob = Math.sin(t * Math.PI * 4.4) * 0.13 * (1 - e);
      _wobbleQ.setFromEuler(_wobbleE.set(wob * 0.6, wob, wob * 0.35));
      paper.mesh.quaternion.multiply(_wobbleQ);
      const squish = 1 + Math.sin(t * Math.PI * 5.2) * 0.05 * (1 - e);
      paper.mesh.scale.set(
        paper.start.scale * squish,
        paper.start.scale * (2 - squish),
        paper.start.scale,
      );
      paper.frameIdx = maxFrame;
    } else {
      // 阶段二：到位后从中心"拨开" — 褶皱快速松开，纸面带弹性展开到位
      const u = (t - OPEN_FLY_RATIO) / (1 - OPEN_FLY_RATIO);
      const e = easeOutQuart(u);
      const decay = 1 - u;
      const s0 = lerp(paper.start.scale, paper.target.scale, e);
      paper.mesh.position.copy(paper.target.position);
      // 纸的张紧回弹：三个轴的过冲相位错开，纸面是"拧"着展开的，
      // 而不是均匀缩放的气球充气
      paper.mesh.scale.set(
        s0 * (1 + Math.sin(u * Math.PI * 2.4) * 0.06 * decay),
        s0 * (1 + Math.sin(u * Math.PI * 2.4 + 1.15) * 0.075 * decay),
        s0 * (1 + Math.sin(u * Math.PI * 2.4 + 2.3) * 0.05 * decay),
      );
      // 展开不是匀速的：中途略微回折一下再张开 — 纸的阻尼感
      const refold = Math.sin(u * Math.PI * 2.6) * 0.05 * decay;
      paper.frameIdx =
        lerp(maxFrame, paper.target.frameIdx, e) +
        refold * (maxFrame - paper.target.frameIdx);
      paper.frameIdx = Math.min(
        maxFrame,
        Math.max(paper.target.frameIdx, paper.frameIdx),
      );
      paper.mesh.quaternion.copy(paper.target.quaternion);
      // 展开收尾时在纸面内小幅"挣动"一下再停稳
      _wobbleQ.setFromEuler(
        _wobbleE.set(0, Math.sin(u * Math.PI * 2.2) * 0.05 * decay, 0),
      );
      paper.mesh.quaternion.multiply(_wobbleQ);
    }
    updatePaperFrame(paper, animData, paper.frameIdx);

    if (t >= 1) {
      paper.state = "open";
      paper.frameIdx = paper.target.frameIdx;
      paper.mesh.position.copy(paper.target.position);
      paper.mesh.quaternion.copy(paper.target.quaternion);
      paper.mesh.scale.setScalar(paper.target.scale);
      syncBodyToMesh(paper);
      updatePaperFrame(paper, animData, paper.frameIdx);
    }
    return;
  }

  if (paper.state === "discarding") {
    paper.time += dt * animSettings.speed;
    const t = clamp01(paper.time / DISCARD_DURATION);
    const closeEase = easeOutCubic(t);
    const scale = lerp(paper.start.scale, CLOSED_SCALE, closeEase);

    paper.frameIdx = lerp(paper.start.frameIdx, maxFrame, closeEase);
    syncMeshToBody(paper, scale);
    updatePaperFrame(paper, animData, paper.frameIdx);

    if (t >= 1) {
      paper.state = "rolling";
      paper.time = 0;
      paper.frameIdx = maxFrame;
      updatePaperFrame(paper, animData, paper.frameIdx);
    }
    return;
  }

  if (paper.state === "grabbed") {
    const body = paper.body;
    const target = paper.grab.target;
    // ポインタ位置へバネ状に追従する速度を与える (KINEMATIC なので
    // step() が速度から位置を積分し、他の紙玉も自然に押しのけられる)
    let vx = (target.x - body.position.x) * GRAB_STIFFNESS;
    let vy = (target.y - body.position.y) * GRAB_STIFFNESS;
    let vz = (target.z - body.position.z) * GRAB_STIFFNESS;
    const speed = Math.hypot(vx, vy, vz);
    if (speed > GRAB_MAX_SPEED) {
      const k = GRAB_MAX_SPEED / speed;
      vx *= k;
      vy *= k;
      vz *= k;
    }
    body.velocity.set(vx, vy, vz);
    syncMeshToBody(paper);
    return;
  }

  if (paper.state === "rolling") {
    paper.time += dt;
    const grounded = isOnGround(paper.body);
    // 転がり抵抗は接地中のみ — 空中では自然に飛ぶ
    if (grounded) applyRollingResistance(paper.body, dt);
    syncMeshToBody(paper);
    const speed =
      paper.body.velocity.lengthSquared() +
      paper.body.angularVelocity.lengthSquared() * 0.02;
    paper.throw.settleTimer = grounded && speed < ROLL_SETTLE_SPEED
      ? paper.throw.settleTimer + dt
      : 0;

    if (paper.throw.settleTimer > 0.35) {
      finishRollingPaper(paper, maxFrame);
    }
    return;
  }

  if (paper.state === "closed") {
    if (isOnGround(paper.body)) applyRollingResistance(paper.body, dt);
    syncMeshToBody(paper);
  }
}

// ==================================================
// リサイズ対応
// ==================================================
window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  updateOpenPose();
});

// レンダーループを先に開始（データロード中も背景を描画）
startAnimation();

init().catch((err) => {
  console.error(err);
  info.textContent = "ERROR: " + err.message;
});
