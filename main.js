// ひなこタワーバトル MVP
// 物理エンジン: Matter.js
// 駒はプレイヤーごとの実写切り抜き画像をそのまま使う(図形描画・トリミングなし)。

const { Engine, World, Bodies, Body, Composite } = Matter;

// 写真の輪郭(凹みあり)を複数の凸パーツに自動分割するためのライブラリを登録
Matter.Common.setDecomp(decomp);

// ---- 設定 ----
const CANVAS_W = 380;
const CANVAS_H = 640;
const GROUND_Y = 520; // パン画像が縦長なため、下端が見切れないよう少し上に配置
const GROUND_W = CANVAS_W; // ホーム画面の土台(幅100%=画面幅いっぱい)と大きさを揃える
// タワーが空の時は低い位置から、積み上がるにつれて自動でスポーン位置を上げる
const SPAWN_Y_BASE = 350; // タワーが空の時のスポーン高さ
const SPAWN_CLEARANCE = 140; // タワーの一番高い場所からこの分だけ上に確保する
const SPAWN_Y_MIN = 60; // どれだけ積み上がっても、これより上にはスポーンさせない
const MOVE_SPEED = 4.5; // px / frame
const SETTLE_FRAMES_NEEDED = 30; // 約0.5秒(60fps)
const SETTLE_SPEED_EPS = 0.05;
// 実時間(ms)ではなく実際に進んだシミュレーションフレーム数で計る。
// タブがバックグラウンドで間引かれた場合など、物理がほとんど進んでいないのに
// 実時間だけ経過してタイムアウトが誤発動する(＝まだ空中の駒を着地扱いにしてしまう)のを防ぐため。
const MAX_DROP_WAIT_FRAMES = 240; // 約4秒(60fps)相当
const FALL_Y = CANVAS_H; // これを超えたら「落下」＝タワー崩壊
// 高い位置から落ちるほど衝突時の速度が上がり、めり込み量が増えて
// 補正で押し戻される瞬間が「跳ねた」ように見えてしまう。速度に上限をつけて防ぐ。
const MAX_FALL_SPEED = 8;
const PHYSICS_SUBSTEPS = 4; // 1描画フレームを何回に分けて物理計算するか

// 弾まない(スーパーボールのような反発をなくす)・滑りにくい、硬い手触りにする。
// mass/densityはあえて指定しない → 駒の重さは各写真の実際の輪郭の面積から
// Matterが自動計算する(図形が大きい/太い駒ほど重くなり、倒れにくく・相手を倒しやすくなる)。
const PIECE_MATERIAL = { restitution: 0, friction: 0.6, frictionStatic: 0.9 };

// ---- 駒に使う画像(images/配下の写真を毎回ランダムに使う) ----
// 新しい画像ファイルを追加したら、ここに{file, sizeScale}を追記する。
// sizeScaleは基準の高さ(PIECE_HEIGHT)に対する倍率で、キャラごとに固定。
const PIECE_IMAGE_FILES = [
  { file: "IMG_5388.PNG", sizeScale: 0.8 },
  { file: "IMG_5389.PNG", sizeScale: 1.0 },
  { file: "IMG_5390.PNG", sizeScale: 0.9 },
  { file: "IMG_5420.PNG", sizeScale: 0.9 },
  { file: "2C60643C-D607-450C-896E-B01BE80B8D9C.PNG", sizeScale: 0.85 },
  { file: "79608400-2234-43CE-8C43-8D6843DE2461.PNG", sizeScale: 1.35 },
  { file: "D4C9D14C-5D68-4006-8C7C-54A66E659A9D.PNG", sizeScale: 1.2 },
  { file: "F78FC116-C52B-4EA9-81AB-190E46281DD6.PNG", sizeScale: 1.25 },
];

// ---- 土台の画像 ----
const groundImage = new Image();
let groundImageReady = false;
groundImage.onload = () => {
  prepareGroundOutline();
  groundImageReady = true;
  replaceGroundBodyWithOutline();
};
groundImage.src = "土台/74ADF095-B515-4049-880D-3EBD290C653F.PNG";

const PIECE_HEIGHT = 100; // ゲーム内での基準の高さ(px)。写真ごとに幅はここから縦横比で決まる
const MASK_GRID_STEP = 16; // 輪郭抽出用グリッドの間隔(元画像のpx単位) : 小さいほど輪郭が精細だが重くなる
const ALPHA_THRESHOLD = 24; // これより不透明なピクセルだけを「駒の中身」とみなす
const SIMPLIFY_EPSILON = 5; // 輪郭の単純化の強さ(グリッド単位)。大きいほど頂点が減って軽く安定するが、細部は失われる

// 点群から凸包(すべての点を囲む、とがった角だけを結んだ輪郭)を求める。
// 輪郭抽出に失敗した場合の非常用フォールバックとしてのみ使う。
function convexHull(points) {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

// 2値グリッドから輪郭を抽出する。
// 各塗りセルの「背景と接する辺」をすべて集め、端点が一致する辺同士をつないで
// 1周のループにする(セルからセルへ辿る方式よりも確実に一周できる)。
function traceContour(grid, gridW, gridH) {
  const isFilled = (x, y) => x >= 0 && y >= 0 && x < gridW && y < gridH && grid[y][x] === 1;

  const edges = [];
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!isFilled(gx, gy)) continue;
      if (!isFilled(gx, gy - 1)) edges.push({ from: { x: gx, y: gy }, to: { x: gx + 1, y: gy } }); // 上辺
      if (!isFilled(gx + 1, gy)) edges.push({ from: { x: gx + 1, y: gy }, to: { x: gx + 1, y: gy + 1 } }); // 右辺
      if (!isFilled(gx, gy + 1)) edges.push({ from: { x: gx + 1, y: gy + 1 }, to: { x: gx, y: gy + 1 } }); // 下辺
      if (!isFilled(gx - 1, gy)) edges.push({ from: { x: gx, y: gy + 1 }, to: { x: gx, y: gy } }); // 左辺
    }
  }
  if (edges.length === 0) return [];

  const key = (p) => `${p.x},${p.y}`;
  const byStart = new Map();
  edges.forEach((e) => {
    const k = key(e.from);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(e);
  });

  const used = new Set();
  let bestLoop = [];
  edges.forEach((startEdge) => {
    if (used.has(startEdge)) return;
    const loop = [];
    let current = startEdge;
    let guard = edges.length + 4;
    while (current && !used.has(current) && guard-- > 0) {
      used.add(current);
      loop.push(current.from);
      const candidates = byStart.get(key(current.to)) || [];
      current = candidates.find((c) => !used.has(c));
    }
    if (loop.length > bestLoop.length) bestLoop = loop;
  });
  return bestLoop;
}

// Douglas-Peucker法で折れ線(閉じたループ)の頂点数を間引く
function simplifyPolygon(points, epsilon) {
  if (points.length < 3) return points;
  const perpDist = (p, a, b) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  };
  const dp = (pts) => {
    if (pts.length < 3) return pts;
    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      const left = dp(pts.slice(0, index + 1));
      const right = dp(pts.slice(index));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  };
  return dp(points);
}

// 多角形の面積重心(頂点の単純平均ではなく、面積で重み付けした正しい重心)
function polygonCentroid(pts) {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    area += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const sum = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / pts.length, y: sum.y / pts.length };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

// 画像の不透明部分から輪郭(腕と脚の間などの凹みも含む)を抽出し、
// 単純化してゲーム内サイズに縮小しておく。poly-decompが複数の凸パーツに自動分割する。
function prepareHull(piece) {
  const img = piece.img;
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);
  const { data } = octx.getImageData(0, 0, off.width, off.height);
  const w = off.width;
  const h = off.height;

  const gridW = Math.ceil(w / MASK_GRID_STEP);
  const gridH = Math.ceil(h / MASK_GRID_STEP);
  const grid = [];
  for (let gy = 0; gy < gridH; gy++) {
    const row = new Array(gridW).fill(0);
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.min(w - 1, gx * MASK_GRID_STEP + (MASK_GRID_STEP >> 1));
      const py = Math.min(h - 1, gy * MASK_GRID_STEP + (MASK_GRID_STEP >> 1));
      row[gx] = data[(py * w + px) * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
    }
    grid.push(row);
  }

  const traced = traceContour(grid, gridW, gridH);
  let outline = null;
  if (traced.length >= 3) {
    const simplified = simplifyPolygon(traced, SIMPLIFY_EPSILON);
    if (simplified.length >= 3) {
      // traceContourはセルの「角」の座標を返すので、そのままグリッド間隔倍すればよい
      outline = simplified.map((p) => ({
        x: p.x * MASK_GRID_STEP,
        y: p.y * MASK_GRID_STEP,
      }));
    }
  }
  if (!outline) {
    // 輪郭抽出に失敗した場合は凸包にフォールバック
    const points = [];
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy][gx]) points.push({ x: gx * MASK_GRID_STEP, y: gy * MASK_GRID_STEP });
      }
    }
    outline = points.length >= 3 ? convexHull(points) : [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }];
  }

  const scale = (PIECE_HEIGHT * piece.sizeScale) / img.naturalHeight;
  piece.w = img.naturalWidth * scale;
  piece.h = img.naturalHeight * scale;

  piece.hullLocal = outline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const centroid = polygonCentroid(piece.hullLocal);
  // 描画時、画像の左上をこの分だけずらせば「輪郭の重心(=Matterが置く駒の中心)」と
  // 「写真の見た目」がぴったり一致する
  piece.imageOffsetX = -centroid.x;
  piece.imageOffsetY = -centroid.y;
}

// ---- 土台の輪郭(フランスパンの実際の形。両端の尖りも含む) ----
let groundOutlineLocal = null; // ゲーム内サイズに縮小済みの輪郭(重心が原点になるよう調整前)
let groundImageOffsetX = 0;
let groundImageOffsetY = 0;

function prepareGroundOutline() {
  const img = groundImage;
  const off = document.createElement("canvas");
  off.width = img.naturalWidth;
  off.height = img.naturalHeight;
  const octx = off.getContext("2d");
  octx.drawImage(img, 0, 0);
  const { data } = octx.getImageData(0, 0, off.width, off.height);
  const w = off.width;
  const h = off.height;

  const gridW = Math.ceil(w / MASK_GRID_STEP);
  const gridH = Math.ceil(h / MASK_GRID_STEP);
  const grid = [];
  for (let gy = 0; gy < gridH; gy++) {
    const row = new Array(gridW).fill(0);
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.min(w - 1, gx * MASK_GRID_STEP + (MASK_GRID_STEP >> 1));
      const py = Math.min(h - 1, gy * MASK_GRID_STEP + (MASK_GRID_STEP >> 1));
      row[gx] = data[(py * w + px) * 4 + 3] > ALPHA_THRESHOLD ? 1 : 0;
    }
    grid.push(row);
  }

  const traced = traceContour(grid, gridW, gridH);
  let outline = null;
  if (traced.length >= 3) {
    const simplified = simplifyPolygon(traced, SIMPLIFY_EPSILON);
    if (simplified.length >= 3) {
      outline = simplified.map((p) => ({ x: p.x * MASK_GRID_STEP, y: p.y * MASK_GRID_STEP }));
    }
  }
  if (!outline) {
    const points = [];
    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        if (grid[gy][gx]) points.push({ x: gx * MASK_GRID_STEP, y: gy * MASK_GRID_STEP });
      }
    }
    outline = points.length >= 3 ? convexHull(points) : null;
  }
  if (!outline) return; // 抽出できなければ従来の四角い当たり判定のまま

  // 土台の幅(GROUND_W)に合わせて縮小する(縦横比は変えない)
  const scale = GROUND_W / img.naturalWidth;
  groundOutlineLocal = outline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const centroid = polygonCentroid(groundOutlineLocal);
  groundImageOffsetX = -centroid.x;
  groundImageOffsetY = -centroid.y;
}

const pieceImages = PIECE_IMAGE_FILES.map(({ file, sizeScale }) => {
  const piece = { src: `images/${file}`, img: new Image(), ready: false, sizeScale };
  piece.img.onload = () => {
    prepareHull(piece);
    piece.ready = true;
  };
  piece.img.src = piece.src;
  return piece;
});

function pickRandomPiece() {
  const ready = pieceImages.filter((p) => p.ready && p.hullLocal);
  const pool = ready.length > 0 ? ready : pieceImages;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ---- Matter セットアップ ----
const engine = Engine.create({
  positionIterations: 12, // デフォルト(6)より増やし、積み重なった駒がめり込んですり抜けるのを防ぐ
  velocityIterations: 8, // デフォルトは4
});
engine.gravity.y = 0.5; // 落下速度をゆっくりめにする
// ほぼ止まった駒は完全に固定(スリープ)させる。これがないと着地後も
// 計算誤差レベルのごく僅かな揺れが収束しきらず、駒がじわじわにじみ続けてしまう。
engine.enableSleeping = true;

// 画像の輪郭が用意できるまでの仮の当たり判定(四角、厚みを持たせてすり抜け防止)
const GROUND_SURFACE_Y = GROUND_Y - 10;
const GROUND_BODY_THICKNESS = 300;
let ground = Bodies.rectangle(
  CANVAS_W / 2,
  GROUND_SURFACE_Y + GROUND_BODY_THICKNESS / 2,
  GROUND_W,
  GROUND_BODY_THICKNESS,
  { isStatic: true }
);
World.add(engine.world, [ground]);

// フランスパンの輪郭が準備できたら、四角い仮の当たり判定を実際の形に差し替える
function replaceGroundBodyWithOutline() {
  if (!groundOutlineLocal) return;
  const groundX = CANVAS_W / 2 - GROUND_W / 2;
  const groundBarY = GROUND_Y - 10;
  const worldX = groundX - groundImageOffsetX;
  const worldY = groundBarY - groundImageOffsetY;

  const outlineBody = Bodies.fromVertices(worldX, worldY, [groundOutlineLocal], {}, true);
  // 輪郭は丸みを帯びているため、駒がそのまま乗ると側面に重なって見えてしまう。
  // 見た目には影響しない「平らな支え」を頂上に足して、駒がぴったり乗るようにする。
  const topY = outlineBody.bounds.min.y;
  const flatTop = Bodies.rectangle(worldX, topY + 5, GROUND_W * 0.7, 10);
  const outlineParts = outlineBody.parts.length > 1 ? outlineBody.parts.slice(1) : [outlineBody];
  const shapedGround = Body.create({ parts: [...outlineParts, flatTop], isStatic: true });

  World.remove(engine.world, ground);
  World.add(engine.world, shapedGround);
  ground = shapedGround;
}

// ---- DOM ----
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const homeScreen = document.getElementById("homeScreen");
const previewStackLeft = document.getElementById("previewStackLeft");
const previewStackRight = document.getElementById("previewStackRight");
const battleScreen = document.getElementById("battleScreen");
const turnLabel = document.getElementById("turnLabel");
const gameOverTitle = document.getElementById("gameOverTitle");
const rotateControls = document.getElementById("rotateControls");
const gameOverControls = document.getElementById("gameOverControls");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const homeBtn = document.getElementById("homeBtn");
const rotateLeftBtn = document.getElementById("rotateLeftBtn");
const rotateRightBtn = document.getElementById("rotateRightBtn");

// ---- ゲーム状態 ----
const STATE = { HOME: "home", AIMING: "aiming", DROPPING: "dropping", GAMEOVER: "gameover" };
const PLAYER_NAMES = { 1: "ともや", 2: "ひなこ" };

let state = STATE.HOME;
let currentPlayer = 1;
let currentBody = null;
let settleCounter = 0;
let dropElapsedFrames = 0;
let hasStartedFalling = false;
let heldDirection = 0; // -1 left, 1 right, 0 none
let aimAngle = 0; // 照準中の駒の目標回転角(ラジアン)
let displayAngle = 0; // 実際に描画/物理に反映している回転角(目標角へ滑らかに近づける)

const ROTATE_STEP = Math.PI / 6; // 1回押しで30度
const ROTATE_SMOOTHING = 0.25; // 目標角に近づく速さ(大きいほど素早く追いつく)

const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

let currentSpawnY = SPAWN_Y_BASE;

// タワーの一番高い場所に合わせてスポーン位置を決める(タワーが空ならSPAWN_Y_BASE)
function computeSpawnY() {
  const bodies = Composite.allBodies(engine.world).filter((b) => b !== ground);
  if (bodies.length === 0) return SPAWN_Y_BASE;
  const towerTopY = Math.min(...bodies.map((b) => b.bounds.min.y));
  return Math.max(SPAWN_Y_MIN, Math.min(SPAWN_Y_BASE, towerTopY - SPAWN_CLEARANCE));
}

function spawnPiece() {
  currentSpawnY = computeSpawnY();
  const piece = pickRandomPiece();
  let body;
  if (piece.hullLocal) {
    // 写真の不透明部分を包む凸包を当たり判定にする(見えない四角の余白をなくす)
    body = Bodies.fromVertices(CANVAS_W / 2, currentSpawnY, [piece.hullLocal], PIECE_MATERIAL, true);
  } else {
    // 画像の読み込み・輪郭計算がまだ終わっていない場合の一時的なフォールバック
    const fallbackHeight = PIECE_HEIGHT * piece.sizeScale;
    body = Bodies.rectangle(CANVAS_W / 2, currentSpawnY, fallbackHeight * 0.6, fallbackHeight, PIECE_MATERIAL);
  }
  Body.setStatic(body, true);
  body.plugin = { piece };
  World.add(engine.world, body);
  currentBody = body;
  aimAngle = 0;
  displayAngle = 0;
  updateTurnLabel();
}

function rotateAim(direction) {
  if (state !== STATE.AIMING || !currentBody) return;
  aimAngle += direction * ROTATE_STEP;
}

function updateTurnLabel() {
  turnLabel.textContent = `${PLAYER_NAMES[currentPlayer]}の番！`;
}

function dropPiece() {
  if (state !== STATE.AIMING || !currentBody) return;
  Body.setStatic(currentBody, false);
  // isStatic=trueの間についた「スリープ」扱いが残ると重力すら効かなくなるため、
  // 動的に戻したタイミングで明示的に起こす
  Matter.Sleeping.set(currentBody, false);
  state = STATE.DROPPING;
  settleCounter = 0;
  dropElapsedFrames = 0;
  hasStartedFalling = false;
}

function getDynamicBodies() {
  return Composite.allBodies(engine.world).filter((b) => !b.isStatic);
}

function capFallSpeed() {
  getDynamicBodies().forEach((b) => {
    if (b.velocity.y > MAX_FALL_SPEED) {
      Body.setVelocity(b, { x: b.velocity.x, y: MAX_FALL_SPEED });
    }
  });
}

function checkFallen() {
  return getDynamicBodies().some((b) => b.position.y > FALL_Y);
}

function maxBodySpeed() {
  return getDynamicBodies().reduce((max, b) => {
    const speed = Math.max(Math.abs(b.velocity.x), Math.abs(b.velocity.y), Math.abs(b.angularVelocity));
    return Math.max(max, speed);
  }, 0);
}

function checkSettled() {
  return maxBodySpeed() < SETTLE_SPEED_EPS;
}

function endGame(loserPlayer) {
  state = STATE.GAMEOVER;
  const winner = loserPlayer === 1 ? 2 : 1;
  gameOverTitle.textContent = `${PLAYER_NAMES[winner]}の勝利`;
  gameOverTitle.hidden = false;
  turnLabel.hidden = true;
  rotateControls.hidden = true;
  gameOverControls.hidden = false;
}

function nextTurn() {
  currentPlayer = currentPlayer === 1 ? 2 : 1;
  state = STATE.AIMING;
  spawnPiece();
}

function clearWorld() {
  const bodies = Composite.allBodies(engine.world).filter((b) => b !== ground);
  bodies.forEach((b) => World.remove(engine.world, b));
}

function startBattle() {
  clearWorld();
  currentPlayer = Math.random() < 0.5 ? 1 : 2; // 先攻/後攻は毎回ランダム
  gameOverTitle.hidden = true;
  gameOverControls.hidden = true;
  turnLabel.hidden = false;
  rotateControls.hidden = false;
  homeScreen.hidden = true;
  battleScreen.hidden = false;
  state = STATE.AIMING;
  spawnPiece();
}

// ホーム画面の土台の上に、駒画像をランダムに3つずつ左右に積んだ見た目を作る
function renderHomePreview() {
  [previewStackLeft, previewStackRight].forEach((container) => {
    container.innerHTML = "";
    for (let i = 0; i < 3; i++) {
      const { file } = PIECE_IMAGE_FILES[Math.floor(Math.random() * PIECE_IMAGE_FILES.length)];
      const img = document.createElement("img");
      img.className = "preview-piece";
      img.src = `images/${file}`;
      img.alt = "";
      container.appendChild(img);
    }
  });
}

function goHome() {
  clearWorld();
  state = STATE.HOME;
  gameOverTitle.hidden = true;
  gameOverControls.hidden = true;
  battleScreen.hidden = true;
  homeScreen.hidden = false;
  renderHomePreview();
}

// ---- 入力 ----
// キャンバスを左右にドラッグして照準中の駒を直接動かす(◀▶ボタンと併用可)。
// ほとんど動かさずに離した場合は「タップ」とみなしてそのまま落とす。
let isDraggingPiece = false;
let dragStartClientX = 0;
let dragStartPieceX = 0;
let dragMoved = 0;
const TAP_MAX_DISTANCE = 6; // これ以下の移動量ならタップ扱い(px)

function canvasScale() {
  const rect = canvas.getBoundingClientRect();
  return rect.width > 0 ? CANVAS_W / rect.width : 1;
}

const FALLBACK_MARGIN = 30; // 画像未準備時の当たり判定サイズが未確定なための暫定値

// キャラ画像は駒ごと(sizeScale)に描画サイズが大きく異なり、かつ回転もするため、
// 「中心からキャンバス端までの固定30px」では大きい・回転した駒がキャンバス外にはみ出て見切れる。
// 現在の回転角での実際の画像バウンディングボックスから、中心～端に必要な余白を都度計算する。
function pieceHorizontalMargin(body) {
  const piece = body.plugin && body.plugin.piece;
  if (!piece || !piece.ready) return FALLBACK_MARGIN;
  const { imageOffsetX: left, imageOffsetY: top, w, h } = piece;
  const corners = [
    { x: left, y: top },
    { x: left + w, y: top },
    { x: left, y: top + h },
    { x: left + w, y: top + h },
  ];
  const cos = Math.cos(body.angle);
  const sin = Math.sin(body.angle);
  let maxAbsX = 0;
  corners.forEach((c) => {
    const rx = c.x * cos - c.y * sin;
    maxAbsX = Math.max(maxAbsX, Math.abs(rx));
  });
  return maxAbsX;
}

canvas.addEventListener("pointerdown", (e) => {
  if (state !== STATE.AIMING || !currentBody) return;
  isDraggingPiece = true;
  dragStartClientX = e.clientX;
  dragStartPieceX = currentBody.position.x;
  dragMoved = 0;
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  if (!isDraggingPiece || state !== STATE.AIMING || !currentBody) return;
  const deltaX = (e.clientX - dragStartClientX) * canvasScale();
  dragMoved = Math.max(dragMoved, Math.abs(e.clientX - dragStartClientX));
  let x = dragStartPieceX + deltaX;
  const margin = pieceHorizontalMargin(currentBody);
  x = Math.max(margin, Math.min(CANVAS_W - margin, x));
  Body.setPosition(currentBody, { x, y: currentSpawnY });
});
canvas.addEventListener("pointerup", () => {
  if (isDraggingPiece && dragMoved <= TAP_MAX_DISTANCE) dropPiece();
  isDraggingPiece = false;
});
["pointercancel", "pointerleave"].forEach((ev) => {
  canvas.addEventListener(ev, () => {
    isDraggingPiece = false;
  });
});

rotateLeftBtn.addEventListener("click", () => rotateAim(-1));
rotateRightBtn.addEventListener("click", () => rotateAim(1));
startBtn.addEventListener("click", startBattle);
restartBtn.addEventListener("click", startBattle);
homeBtn.addEventListener("click", goHome);

window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft") heldDirection = -1;
  if (e.code === "ArrowRight") heldDirection = 1;
  if (e.code === "Space" || e.code === "ArrowDown") {
    e.preventDefault();
    dropPiece();
  }
  if (e.code === "KeyQ") rotateAim(-1);
  if (e.code === "KeyE") rotateAim(1);
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" && heldDirection === -1) heldDirection = 0;
  if (e.code === "ArrowRight" && heldDirection === 1) heldDirection = 0;
});

// ---- 描画 ----
function drawBody(context, body) {
  const piece = body.plugin.piece;
  context.save();
  context.translate(body.position.x, body.position.y);
  context.rotate(body.angle);

  if (piece.ready) {
    // imageOffsetX/Yで「当たり判定(凸包)の重心」と「写真の見た目」の位置を一致させる
    context.drawImage(piece.img, piece.imageOffsetX, piece.imageOffsetY, piece.w, piece.h);
  } else {
    // 画像の読み込みが終わるまでの仮表示
    context.fillStyle = "rgba(74, 66, 55, 0.15)";
    context.fillRect(-PIECE_HEIGHT * 0.3, -PIECE_HEIGHT / 2, PIECE_HEIGHT * 0.6, PIECE_HEIGHT);
  }

  context.restore();
}

function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 土台
  const groundX = CANVAS_W / 2 - GROUND_W / 2;
  const groundBarY = GROUND_Y - 10;
  if (groundImageReady && groundOutlineLocal) {
    // 実際の当たり判定(パンの輪郭)の位置に合わせて画像を描画する
    const groundImgH = GROUND_W * (groundImage.naturalHeight / groundImage.naturalWidth);
    ctx.save();
    ctx.translate(ground.position.x, ground.position.y);
    ctx.drawImage(groundImage, groundImageOffsetX, groundImageOffsetY, GROUND_W, groundImgH);
    ctx.restore();
  } else if (groundImageReady) {
    // 輪郭抽出がまだの場合の仮表示(縦横比は変えず、上端をgroundBarYに合わせる)
    const groundImgH = GROUND_W * (groundImage.naturalHeight / groundImage.naturalWidth);
    ctx.drawImage(groundImage, groundX, groundBarY, GROUND_W, groundImgH);
  } else {
    ctx.fillStyle = "#e0b98c";
    ctx.fillRect(groundX, groundBarY, GROUND_W, 20);
  }

  Composite.allBodies(engine.world)
    .filter((b) => b !== ground)
    .forEach((b) => drawBody(ctx, b));
}

// ---- メインループ ----
let lastTime = performance.now();
function loop(now) {
  const delta = Math.min(33, now - lastTime);
  lastTime = now;

  if (state === STATE.AIMING || state === STATE.DROPPING) {
    if (state === STATE.AIMING && currentBody) {
      let x = currentBody.position.x + heldDirection * MOVE_SPEED;
      const margin = pieceHorizontalMargin(currentBody);
      x = Math.max(margin, Math.min(CANVAS_W - margin, x));
      Body.setPosition(currentBody, { x, y: currentSpawnY });

      // 目標角へ少しずつ近づけて回転を滑らかにする
      displayAngle += (aimAngle - displayAngle) * ROTATE_SMOOTHING;
      if (Math.abs(aimAngle - displayAngle) < 0.001) displayAngle = aimAngle;
      Body.setAngle(currentBody, displayAngle);
    }

    // 1フレーム分をまとめて1回で計算すると、高速で落ちた駒が着地の瞬間に
    // 大きくめり込んでから補正で戻る=「少し沈む」ように見える。
    // 同じ時間を細かく分けて計算することで、見た目の速さは変えずにめり込みを防ぐ。
    const substepDelta = delta / PHYSICS_SUBSTEPS;
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
      Engine.update(engine, substepDelta);
      capFallSpeed();
    }

    if (checkFallen()) {
      endGame(currentPlayer);
    } else if (state === STATE.DROPPING) {
      dropElapsedFrames++;
      if (!hasStartedFalling && maxBodySpeed() > FALLING_SPEED_THRESHOLD) {
        hasStartedFalling = true;
      }
      if (hasStartedFalling && checkSettled()) {
        settleCounter++;
        if (settleCounter >= SETTLE_FRAMES_NEEDED) {
          nextTurn();
        }
      } else {
        settleCounter = 0;
        if (dropElapsedFrames > MAX_DROP_WAIT_FRAMES) {
          nextTurn();
        }
      }
    }
  }

  if (state !== STATE.HOME) {
    render();
  }
  requestAnimationFrame(loop);
}

// ---- 起動 ----
renderHomePreview();
requestAnimationFrame(loop);
