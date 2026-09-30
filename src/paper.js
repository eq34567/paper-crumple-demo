import * as THREE from "three";

// ==================================================
// 紙面デザイン — 方眼紙に手書きフォントで title / サムネイル / url を配置
// サムネイルは各サイトの OGP 画像 (public/ に配置)
// ==================================================
// 架空ブランド (記事公開用に著作権フリーの自作データ)。
// URL は RFC 2606 で予約された .example TLD なので実在しない。
// サムネイルは public/data/ の自作 SVG (1200×630 = OGP と同じ比率)。
export const PAPER_DESIGNS = [
  {
    title: "PAPER PROTOCOL",
    url: "https://paper-protocol.example",
    image: "data/paper-protocol.svg",
  },
  {
    title: "CRUMPLE LAB",
    url: "https://crumple-lab.example",
    image: "data/crumple-lab.svg",
  },
  {
    title: "FOLD & TOSS",
    url: "https://fold-toss.example",
    image: "data/fold-toss.svg",
  },
  {
    title: "ORIGAMI ENGINE",
    url: "https://origami-engine.example",
    image: "data/origami-engine.svg",
  },
  {
    title: "WASTEBASKET CLUB",
    url: "https://wastebasket.example",
    image: "data/wastebasket-club.svg",
  },
  {
    title: "GRID PAPER WORKS",
    url: "https://gridpaper.example",
    image: "data/grid-paper-works.svg",
  },
  {
    title: "THROWAWAY STUDIO",
    url: "https://throwaway.example",
    image: "data/throwaway-studio.svg",
  },
];

const TEX_W = 1024;
const TEX_H = 1400;
// 英数字は Caveat、日本語は手書き風の Yomogi にフォールバックする
const HAND_FONT = '"Caveat", "Yomogi", "Comic Sans MS", cursive';
const INK_COLOR = "#1d1d1b";
// サムネイルは 16:9
const IMAGE_RECT = {
  x: Math.round(TEX_W * 0.11),
  y: Math.round(TEX_H * 0.33),
  w: Math.round(TEX_W * 0.78),
  h: Math.round((TEX_W * 0.78 * 9) / 16),
};

// デザインごとの共有ステート (canvas / texture / material / video)
const designStates = [];

function drawStaticLayer(ctx, design) {
  // 方眼紙の下地
  ctx.fillStyle = "#eae8e1";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = "rgba(130, 150, 135, 0.3)";
  ctx.lineWidth = 2;
  const cell = 64;
  ctx.beginPath();
  for (let x = cell / 2; x <= TEX_W; x += cell) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX_H);
  }
  for (let y = cell / 2; y <= TEX_H; y += cell) {
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_W, y);
  }
  ctx.stroke();

  // タイトル (幅に収まらなければ縮小 → それでも収まらなければ2行に折り返し)
  ctx.fillStyle = INK_COLOR;
  ctx.textBaseline = "alphabetic";
  drawTitle(ctx, design.title);

  // サムネイルエリア (画像ロードまでのプレースホルダ + 枠線)
  ctx.fillStyle = "#d9d7d0";
  ctx.fillRect(IMAGE_RECT.x, IMAGE_RECT.y, IMAGE_RECT.w, IMAGE_RECT.h);
  ctx.strokeStyle = "#3a3a38";
  ctx.lineWidth = 3;
  ctx.strokeRect(IMAGE_RECT.x, IMAGE_RECT.y, IMAGE_RECT.w, IMAGE_RECT.h);

  // URL (サムネイル枠のすぐ下)
  ctx.fillStyle = INK_COLOR;
  ctx.font = `62px ${HAND_FONT}`;
  ctx.fillText(design.url, TEX_W * 0.11, IMAGE_RECT.y + IMAGE_RECT.h + 95);

  applyPaperGrain(ctx);
  applyCreaseShading(ctx);
}

// 纸纤维颗粒 — 随机深浅斑点打破均匀色块，是"纸"而非"布"的关键
function applyPaperGrain(ctx) {
  for (let i = 0; i < 2600; i++) {
    const a = Math.random() * 0.055;
    ctx.fillStyle = `rgba(115, 95, 65, ${a})`;
    ctx.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 1.5 + Math.random() * 2.5, 1);
  }
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = `rgba(255, 255, 255, ${Math.random() * 0.1})`;
    ctx.fillRect(Math.random() * TEX_W, Math.random() * TEX_H, 1 + Math.random() * 2, 1);
  }
}

// ==================================================
// 烘焙进颜色贴图的"永久折痕" — 揉过再展开的纸必然留下痕迹。
// bumpMap 只在小尺度起伏；这一层在大尺度上画受光/背光的明暗带和
// 成对出现的折线（亮棱+暗谷），揉皱时与几何叠在一起增强纸感，
// 展开后也是一张"揉过的纸"而不是新纸。
// rect 传矩形时只在该区域内画（用于图片区重绘后补画）。
// ==================================================
function applyCreaseShading(ctx, rect = null) {
  ctx.save();
  if (rect) {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
  }

  // 大尺度的明暗起伏 — 纸面被揉后形成的柔和受光/背光区
  for (let i = 0; i < 14; i++) {
    const bright = Math.random() < 0.5;
    const a = 0.045 + Math.random() * 0.05;
    ctx.save();
    ctx.filter = "blur(14px)";
    ctx.strokeStyle = bright
      ? `rgba(255,255,255,${a})`
      : `rgba(60,50,35,${a})`;
    ctx.lineWidth = 40 + Math.random() * 70;
    ctx.beginPath();
    let x = -100 + Math.random() * (TEX_W + 200);
    let y = -100 + Math.random() * (TEX_H + 200);
    let angle = Math.random() * Math.PI * 2;
    ctx.moveTo(x, y);
    for (let s = 0; s < 3; s++) {
      angle += randomRangeSym(Math.PI * 0.4);
      x += Math.cos(angle) * (200 + Math.random() * 300);
      y += Math.sin(angle) * (200 + Math.random() * 300);
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // 明确的折线 — 每条折痕都是亮棱+暗谷成对、错位 1~2px
  for (let i = 0; i < 26; i++) {
    const a = 0.05 + Math.random() * 0.08;
    ctx.save();
    ctx.filter = "blur(0.6px)";
    let x = Math.random() * TEX_W;
    let y = Math.random() * TEX_H;
    let angle = Math.random() * Math.PI * 2;
    const segs = [];
    const segCount = 3 + Math.floor(Math.random() * 3);
    for (let s = 0; s < segCount; s++) {
      angle += randomRangeSym(Math.PI * 0.45);
      const len = 120 + Math.random() * 260;
      const nx = x + Math.cos(angle) * len;
      const ny = y + Math.sin(angle) * len;
      segs.push([x, y, nx, ny]);
      x = nx;
      y = ny;
    }
    const nx = Math.cos(angle + Math.PI / 2) * 1.6;
    const ny = Math.sin(angle + Math.PI / 2) * 1.6;
    ctx.lineWidth = 1 + Math.random() * 1.2;
    ctx.strokeStyle = `rgba(255,255,255,${a})`;
    ctx.beginPath();
    for (const [sx, sy, ex, ey] of segs) {
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
    }
    ctx.stroke();
    ctx.strokeStyle = `rgba(60,50,35,${a * 0.9})`;
    ctx.beginPath();
    for (const [sx, sy, ex, ey] of segs) {
      ctx.moveTo(sx + nx, sy + ny);
      ctx.lineTo(ex + nx, ey + ny);
    }
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ==================================================
// 细密折痕凹凸贴图 — 逐像素的褶皱细节，与网格顶点数无关。
// 网格只有 140 个顶点，VAT 法线又被平滑处理，单靠几何怎么调都是"软布"感；
// 真正的纸感来自满布纸面的细碎折痕在光照下的明暗起伏，用 bumpMap 补上。
// 每次调用生成全新的一张 —— 每张纸的折痕都不重样。
// ==================================================
function createCreaseBumpMap() {
  const W = 384, H = 528;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  // 中性灰 = 平整；亮 = 凸棱，暗 = 凹谷
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, W, H);

  // 折痕 = 随机游走的折线，一段折纸上会同时有凸棱和凹谷
  const drawCreases = (blur, count) => {
    ctx.save();
    if (blur) ctx.filter = `blur(${blur}px)`;
    for (let i = 0; i < count; i++) {
      const bright = Math.random() < 0.5;
      const alpha = 0.18 + Math.random() * 0.22;
      ctx.strokeStyle = bright
        ? `rgba(255,255,255,${alpha})`
        : `rgba(0,0,0,${alpha})`;
      ctx.lineWidth = (blur ? 2.2 : 1) + Math.random() * 1.8;
      ctx.beginPath();
      let x = Math.random() * W;
      let y = Math.random() * H;
      let angle = Math.random() * Math.PI * 2;
      ctx.moveTo(x, y);
      const segments = 3 + Math.floor(Math.random() * 4);
      for (let s = 0; s < segments; s++) {
        angle += randomRangeSym(Math.PI * 0.55);
        const len = 40 + Math.random() * 100;
        x += Math.cos(angle) * len;
        y += Math.sin(angle) * len;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  };
  // 先画一层宽而虚的（大折痕的柔和起伏），再画一层细而实的（碎折痕）
  drawCreases(2.2, 40);
  drawCreases(0, 70);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // bump map 必须保持线性色彩空间，不能设 SRGB
  return texture;
}

function randomRangeSym(max) {
  return (Math.random() * 2 - 1) * max;
}

// 设计模板共用的折痕贴图（每个纸团会克隆材质并换成自己的折痕）
let templateBump = null;
function getTemplateBump() {
  if (!templateBump) templateBump = createCreaseBumpMap();
  return templateBump;
}

// 纸张材质：轻微反光 (roughness 0.78) + 折痕凹凸 + 平直着色
// 140 顶点的网格用平滑法线只会是"软布球"；flatShading 按三角面取法线，
// 揉皱时呈现一块块小平面和明确的折棱转折，这才是纸团的光影。
function applyPaperFeel(material) {
  material.bumpScale = 0.95;
  material.roughness = 0.78;
  material.flatShading = true;
}

function drawTitle(ctx, title) {
  const maxW = TEX_W * 0.78;
  const x = TEX_W * 0.11;

  // まず1行で収まるか (100px までは縮小を許容)
  let size = 170;
  ctx.font = `${size}px ${HAND_FONT}`;
  while (ctx.measureText(title).width > maxW && size > 100) {
    size -= 6;
    ctx.font = `${size}px ${HAND_FONT}`;
  }
  const words = title.split(" ");
  if (ctx.measureText(title).width <= maxW || words.length < 2) {
    // 1単語で収まらない場合はさらに縮小
    while (ctx.measureText(title).width > maxW && size > 60) {
      size -= 6;
      ctx.font = `${size}px ${HAND_FONT}`;
    }
    ctx.fillText(title, x, TEX_H * 0.245);
    return;
  }

  // 2行に折り返し (行幅が最も揃う分割位置を選ぶ)
  let best = null;
  for (let i = 1; i < words.length; i++) {
    const line1 = words.slice(0, i).join(" ");
    const line2 = words.slice(i).join(" ");
    const width = Math.max(
      ctx.measureText(line1).width,
      ctx.measureText(line2).width,
    );
    if (!best || width < best.width) best = { line1, line2, width };
  }
  size = 120;
  ctx.font = `${size}px ${HAND_FONT}`;
  while (
    Math.max(
      ctx.measureText(best.line1).width,
      ctx.measureText(best.line2).width,
    ) > maxW &&
    size > 60
  ) {
    size -= 6;
    ctx.font = `${size}px ${HAND_FONT}`;
  }
  ctx.fillText(best.line1, x, TEX_H * 0.16);
  ctx.fillText(best.line2, x, TEX_H * 0.255);
}

// OGP 画像を cover フィットで枠内に描き込む
function drawDesignImage(state) {
  const { ctx, image } = state;
  if (!image.complete || !image.naturalWidth) return;

  const scale = Math.max(
    IMAGE_RECT.w / image.naturalWidth,
    IMAGE_RECT.h / image.naturalHeight,
  );
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(IMAGE_RECT.x, IMAGE_RECT.y, IMAGE_RECT.w, IMAGE_RECT.h);
  ctx.clip();
  ctx.drawImage(
    image,
    IMAGE_RECT.x + (IMAGE_RECT.w - dw) / 2,
    IMAGE_RECT.y + (IMAGE_RECT.h - dh) / 2,
    dw,
    dh,
  );
  ctx.restore();
  ctx.strokeStyle = "#3a3a38";
  ctx.lineWidth = 3;
  ctx.strokeRect(IMAGE_RECT.x, IMAGE_RECT.y, IMAGE_RECT.w, IMAGE_RECT.h);
  applyCreaseShading(ctx, IMAGE_RECT);
  state.texture.needsUpdate = true;
}

// 手書きフォントのロード完了後に静的レイヤーを描き直す
if (document.fonts) {
  Promise.all([
    document.fonts.load('100px "Caveat"'),
    document.fonts.load('100px "Yomogi"', "一歩の冒険"),
  ]).then(() => {
    for (const state of designStates) {
      if (!state) continue;
      drawStaticLayer(state.ctx, state.design);
      drawDesignImage(state);
      state.texture.needsUpdate = true;
    }
  });
}

function getDesignMaterial(designIndex) {
  const idx = designIndex % PAPER_DESIGNS.length;
  if (designStates[idx]) return designStates[idx].material;

  const design = PAPER_DESIGNS[idx];
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  drawStaticLayer(ctx, design);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.rotation = Math.PI; // UVに合わせて回転
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, -1); // UVに合わせて反転

  // 両面表示（紙は薄いので裏も見えてほしい）
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyPaperFeel(material);
  material.bumpMap = getTemplateBump();

  const image = new Image();
  const state = { design, canvas, ctx, texture, material, image };
  image.onload = () => drawDesignImage(state);
  // このファイル (src/) の1つ上の階層にある data/ を参照する
  image.src = import.meta.url.replace(/[^/]*$/, "") + "../" + design.image;

  designStates[idx] = state;
  return material;
}

// ==================================================
// 用户手写纸条 — 把输入的文字直接画到纸面纹理上
// ==================================================
const NOTE_FONT = '"Caveat", "Yomogi", "Microsoft YaHei", sans-serif';
const NOTE_INK = "#3d3a33";
// 正文最多行数，超出部分截断加省略号
const NOTE_MAX_LINES = 11;

function wrapNoteLines(ctx, text, maxW, maxLines = NOTE_MAX_LINES) {
  const lines = [];
  for (const paragraph of text.split("\n")) {
    if (paragraph === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const ch of paragraph) {
      // 中英文混排都按单字宽度断行，中文没有空格分词
      const next = current + ch;
      if (ctx.measureText(next).width > maxW && current) {
        lines.push(current);
        current = ch;
      } else {
        current = next;
      }
    }
    if (current) lines.push(current);
  }
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = lines[maxLines - 1].replace(/…?$/, "…");
  }
  return lines;
}

// 便签风的暖色底 + 方格 + 顶部撕纸红线
function drawNoteBackground(ctx) {
  ctx.fillStyle = "#f8f2df";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.strokeStyle = "rgba(180, 160, 120, 0.35)";
  ctx.lineWidth = 2;
  const cell = 64;
  ctx.beginPath();
  for (let x = cell / 2; x <= TEX_W; x += cell) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, TEX_H);
  }
  for (let y = cell / 2; y <= TEX_H; y += cell) {
    ctx.moveTo(0, y);
    ctx.lineTo(TEX_W, y);
  }
  ctx.stroke();

  ctx.strokeStyle = "#d95f4b";
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(TEX_W * 0.09, TEX_H * 0.075);
  ctx.lineTo(TEX_W * 0.91, TEX_H * 0.075);
  ctx.stroke();
}

// 图片 cover 模式画进矩形框（等比缩放居中裁切）
function drawCover(ctx, image, rect) {
  const scale = Math.max(rect.w / image.naturalWidth, rect.h / image.naturalHeight);
  const dw = image.naturalWidth * scale;
  const dh = image.naturalHeight * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(
    image,
    rect.x + (rect.w - dw) / 2,
    rect.y + (rect.h - dh) / 2,
    dw,
    dh,
  );
  ctx.restore();
  ctx.strokeStyle = "#3a3a38";
  ctx.lineWidth = 3;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
}

// 用户纸条排版：有图时文字挤到上方 5 行，图占剩余区域；无图时文字满页
function drawUserPaper(ctx, text, image) {
  drawNoteBackground(ctx);

  ctx.fillStyle = NOTE_INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = `72px ${NOTE_FONT}`;

  const hasImage = image && image.complete && image.naturalWidth;
  const maxLines = hasImage ? 5 : NOTE_MAX_LINES;
  const lineH = 96;
  const lines = text ? wrapNoteLines(ctx, text, TEX_W * 0.82, maxLines) : [];
  let y = TEX_H * 0.16;
  for (const line of lines) {
    ctx.fillText(line, TEX_W * 0.09, y);
    y += lineH;
  }

  if (hasImage) {
    const imgY = lines.length ? y - lineH + 48 : TEX_H * 0.14;
    drawCover(ctx, image, {
      x: TEX_W * 0.09,
      y: imgY,
      w: TEX_W * 0.82,
      h: TEX_H * 0.92 - imgY,
    });
  }

  applyPaperGrain(ctx);
  applyCreaseShading(ctx);
}

/**
 * 为用户输入的文字 / 图片生成一张纸面材质（每条纸团独享一张 canvas 纹理）
 * 文字和图片可以同时传：文字在上，图片在下方剩余区域
 */
export function createUserMaterial(text, imageUrl = null) {
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");

  const image = imageUrl ? new Image() : null;

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.rotation = Math.PI; // 与现有纸面相同：UV 旋转 + 翻转对齐
  texture.center.set(0.5, 0.5);
  texture.repeat.set(1, -1);

  const redraw = () => {
    drawUserPaper(ctx, text, image);
    texture.needsUpdate = true;
  };

  redraw(); // 图片未加载完时先画占位，onload 后重画

  if (image) {
    image.onload = redraw;
    image.src = imageUrl;
  }
  // 手写字体若晚于首绘才加载完成，重画一遍
  if (document.fonts) {
    document.fonts.ready.then(redraw);
  }

  const material = new THREE.MeshStandardMaterial({
    map: texture,
    roughness: 0.9,
    metalness: 0.0,
    side: THREE.DoubleSide,
  });
  applyPaperFeel(material);
  material.bumpMap = createCreaseBumpMap(); // 便签也有自己独一无二的折痕
  material.userData.ownMap = texture; // 纹理独享，随纸团一起销毁
  return material;
}

/**
 * animation.json のデータから Three.js のメッシュを作る
 * designIndex で紙面デザイン (PAPER_DESIGNS) を選ぶ
 * materialOverride を渡すとその材質をそのまま使う（ユーザー手書き紙用）
 * 戻り値: { mesh, positionAttr, normalAttr }
 */
export function createPaper(animData, designIndex = 0, materialOverride = null) {
  const { vertexCount, indices, uvs, positions, normals } = animData;

  const geometry = new THREE.BufferGeometry();

  // ===== 頂点位置（最初のフレームで初期化）=====
  // 毎フレーム書き換える前提なので Float32Array を直接持つ
  const positionArray = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) {
    positionArray[i] = positions[i]; // フレーム0
  }
  const positionAttr = new THREE.BufferAttribute(positionArray, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage); // 頻繁に更新される
  geometry.setAttribute("position", positionAttr);

  // ===== 法線 =====
  const normalArray = new Float32Array(vertexCount * 3);
  for (let i = 0; i < vertexCount * 3; i++) {
    normalArray[i] = normals[i];
  }
  const normalAttr = new THREE.BufferAttribute(normalArray, 3);
  normalAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("normal", normalAttr);

  // ===== UV =====
  const uvArray = new Float32Array(uvs.length);
  for (let i = 0; i < uvs.length; i++) {
    uvArray[i] = uvs[i];
  }
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvArray, 2));

  // ===== インデックス =====
  // 140頂点なので Uint16 で十分
  const indexArray = new Uint16Array(indices);
  geometry.setIndex(new THREE.BufferAttribute(indexArray, 1));

  // 每张纸独立折痕：克隆共享材质，换上专属的折痕凹凸贴图
  let material;
  if (materialOverride) {
    material = materialOverride; // 用户便签材质本身独享（含独立折痕）
  } else {
    material = getDesignMaterial(designIndex).clone();
    material.bumpMap = createCreaseBumpMap();
  }
  const mesh = new THREE.Mesh(geometry, material);

  return {
    mesh,
    positionAttr,
    normalAttr,
    ownMaterial: material,
  };
}

/**
 * 指定フレーム（小数可）の positions と normals でジオメトリを更新する。
 * 小数の場合は隣接フレーム間を線形補間する。
 */
export function updatePaperFrame(paper, animData, frameIdx) {
  const { vertexCount, frameCount, positions, normals } = animData;
  const { positionAttr, normalAttr } = paper;

  const len = vertexCount * 3;
  const f0 = Math.floor(frameIdx);
  const t = frameIdx - f0;

  const off0 = f0 * len;

  const posArray = positionAttr.array;
  const nrmArray = normalAttr.array;

  if (t < 1e-6) {
    // 整数フレーム — コピーだけ
    for (let i = 0; i < len; i++) {
      posArray[i] = positions[off0 + i];
      nrmArray[i] = normals[off0 + i];
    }
  } else {
    // 小数フレーム — lerp
    const f1 = (f0 + 1) % frameCount;
    const off1 = f1 * len;
    const s = 1 - t;
    for (let i = 0; i < len; i++) {
      posArray[i] = positions[off0 + i] * s + positions[off1 + i] * t;
      nrmArray[i] = normals[off0 + i] * s + normals[off1 + i] * t;
    }
  }

  positionAttr.needsUpdate = true;
  normalAttr.needsUpdate = true;

  paper.mesh.geometry.computeBoundingSphere();
  paper.mesh.geometry.computeBoundingBox();
}
