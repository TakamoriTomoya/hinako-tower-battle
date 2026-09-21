// 人物タワーバトル MVP
// 物理エンジン: Matter.js
// 駒はプレイヤーごとの実写切り抜き画像をそのまま使う(図形描画・トリミングなし)。

const { Engine, World, Bodies, Body, Composite } = Matter;

// 写真の輪郭(凹みあり)を複数の凸パーツに自動分割するためのライブラリを登録
Matter.Common.setDecomp(decomp);

// ---- 設定 ----
const CANVAS_W = 380;
const CANVAS_H = 640;
const GROUND_Y = CANVAS_H - 60;
const GROUND_W = 300;
const SPAWN_Y = 70;
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
// 新しい画像ファイルを追加したら、ここにファイル名を追記する。
const PIECE_IMAGE_FILES = [
  "IMG_5388.PNG",
  "IMG_5389.PNG",
  "IMG_5390.PNG",
  "2C60643C-D607-450C-896E-B01BE80B8D9C.PNG",
];

const PIECE_HEIGHT = 100; // ゲーム内でのおおよその高さ(px)。写真ごとに幅はここから縦横比で決まる
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

  const scale = PIECE_HEIGHT / img.naturalHeight;
  piece.w = img.naturalWidth * scale;
  piece.h = img.naturalHeight * scale;

  piece.hullLocal = outline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const centroid = polygonCentroid(piece.hullLocal);
  // 描画時、画像の左上をこの分だけずらせば「輪郭の重心(=Matterが置く駒の中心)」と
  // 「写真の見た目」がぴったり一致する
  piece.imageOffsetX = -centroid.x;
  piece.imageOffsetY = -centroid.y;
}

const pieceImages = PIECE_IMAGE_FILES.map((file) => {
  const piece = { src: `images/${file}`, img: new Image(), ready: false };
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

// 見た目は薄い土台だが、物理判定用の当たり判定は厚みを持たせて
// 勢いよく積まれた時にすり抜ける(トンネリング)のを防ぐ
const GROUND_SURFACE_Y = GROUND_Y - 10;
const GROUND_BODY_THICKNESS = 300;
const ground = Bodies.rectangle(
  CANVAS_W / 2,
  GROUND_SURFACE_Y + GROUND_BODY_THICKNESS / 2,
  GROUND_W,
  GROUND_BODY_THICKNESS,
  { isStatic: true }
);
World.add(engine.world, [ground]);

// ---- DOM ----
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const homeScreen = document.getElementById("homeScreen");
const battleScreen = document.getElementById("battleScreen");
const turnLabel = document.getElementById("turnLabel");
const chipP1 = document.getElementById("chipP1");
const chipP2 = document.getElementById("chipP2");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverTitle = document.getElementById("gameOverTitle");
const startBtn = document.getElementById("startBtn");
const restartBtn = document.getElementById("restartBtn");
const homeBtn = document.getElementById("homeBtn");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");
const dropBtn = document.getElementById("dropBtn");
const rotateLeftBtn = document.getElementById("rotateLeftBtn");
const rotateRightBtn = document.getElementById("rotateRightBtn");

// ---- ゲーム状態 ----
const STATE = { HOME: "home", AIMING: "aiming", DROPPING: "dropping", GAMEOVER: "gameover" };

let state = STATE.HOME;
let currentPlayer = 1;
let currentBody = null;
let settleCounter = 0;
let dropElapsedFrames = 0;
let hasStartedFalling = false;
let heldDirection = 0; // -1 left, 1 right, 0 none
let aimAngle = 0; // 照準中の駒の回転角(ラジアン)

const ROTATE_STEP = Math.PI / 4; // 1回押しで45度

const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

function spawnPiece() {
  const piece = pickRandomPiece();
  let body;
  if (piece.hullLocal) {
    // 写真の不透明部分を包む凸包を当たり判定にする(見えない四角の余白をなくす)
    body = Bodies.fromVertices(CANVAS_W / 2, SPAWN_Y, [piece.hullLocal], PIECE_MATERIAL, true);
  } else {
    // 画像の読み込み・輪郭計算がまだ終わっていない場合の一時的なフォールバック
    body = Bodies.rectangle(CANVAS_W / 2, SPAWN_Y, PIECE_HEIGHT * 0.6, PIECE_HEIGHT, PIECE_MATERIAL);
  }
  Body.setStatic(body, true);
  body.plugin = { piece };
  World.add(engine.world, body);
  currentBody = body;
  aimAngle = 0;
  updateTurnLabel();
}

function rotateAim(direction) {
  if (state !== STATE.AIMING || !currentBody) return;
  aimAngle += direction * ROTATE_STEP;
  Body.setAngle(currentBody, aimAngle);
}

function updateTurnLabel() {
  turnLabel.textContent = `プレイヤー${currentPlayer}の番！`;
  chipP1.classList.toggle("active", currentPlayer === 1);
  chipP1.classList.toggle("inactive", currentPlayer !== 1);
  chipP2.classList.toggle("active", currentPlayer === 2);
  chipP2.classList.toggle("inactive", currentPlayer !== 2);
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
  gameOverTitle.textContent = `プレイヤー${winner}の勝ち！🎉`;
  gameOverOverlay.hidden = false;
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
  currentPlayer = 1;
  gameOverOverlay.hidden = true;
  homeScreen.hidden = true;
  battleScreen.hidden = false;
  state = STATE.AIMING;
  spawnPiece();
}

function goHome() {
  clearWorld();
  state = STATE.HOME;
  gameOverOverlay.hidden = true;
  battleScreen.hidden = true;
  homeScreen.hidden = false;
}

// ---- 入力 ----
leftBtn.addEventListener("pointerdown", () => (heldDirection = -1));
rightBtn.addEventListener("pointerdown", () => (heldDirection = 1));
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => {
  leftBtn.addEventListener(ev, () => (heldDirection = 0));
  rightBtn.addEventListener(ev, () => (heldDirection = 0));
});
dropBtn.addEventListener("click", dropPiece);
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
  ctx.fillStyle = "#e0b98c";
  ctx.fillRect(CANVAS_W / 2 - GROUND_W / 2, GROUND_Y - 10, GROUND_W, 20);

  // 落下ライン(目安)
  ctx.strokeStyle = "rgba(255,111,145,0.4)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, FALL_Y - 1);
  ctx.lineTo(CANVAS_W, FALL_Y - 1);
  ctx.stroke();
  ctx.setLineDash([]);

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
      x = Math.max(30, Math.min(CANVAS_W - 30, x));
      Body.setPosition(currentBody, { x, y: SPAWN_Y });
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
requestAnimationFrame(loop);
