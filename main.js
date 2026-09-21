// 人物タワーバトル MVP
// 物理エンジン: Matter.js
// 画像はまだ仮（図形+顔）。将来ここを画像描画に差し替える想定。

const { Engine, World, Bodies, Body, Composite } = Matter;

// ---- 設定 ----
const CANVAS_W = 380;
const CANVAS_H = 640;
const GROUND_Y = CANVAS_H - 60;
const GROUND_W = 200;
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
const MAX_FALL_SPEED = 15;
const PHYSICS_SUBSTEPS = 4; // 1描画フレームを何回に分けて物理計算するか

const PLAYER_COLORS = { 1: "#d9436b", 2: "#1e80c9" };

// 弾まない(スーパーボールのような反発をなくす)・滑りにくい、硬い手触りにする
const PIECE_MATERIAL = { restitution: 0, friction: 0.6, frictionStatic: 0.9 };

// キャラクター（人物）の形状定義。
// 画像を用意したらここに imageSrc を追加して描画を差し替える。
// 角丸め(chamfer)はMatterの多角形近似がごく僅かに左右非対称になり、
// 真下に落としても毎回同じ方向に傾いてズレる原因になるため使わない。
const CHARACTER_TYPES = [
  {
    id: "square",
    label: "しかく",
    create(x, y) {
      const body = Bodies.rectangle(x, y, 42, 42, PIECE_MATERIAL);
      body.shape = { kind: "rect", w: 42, h: 42 };
      return body;
    },
  },
  {
    id: "circle",
    label: "まる",
    create(x, y) {
      const body = Bodies.circle(x, y, 23, PIECE_MATERIAL);
      // 真円は着地時のわずかな数値誤差でも自転を始め、摩擦でそのまま
      // 転がって横に逃げてしまう。回転だけを止めて「転がる」を防ぐ
      // (四角や人型はあえて回転させて倒れる=崩壊の面白さを残す)
      Body.setInertia(body, Infinity);
      body.shape = { kind: "circle", r: 23 };
      return body;
    },
  },
  {
    id: "tall",
    label: "のっぽ",
    create(x, y) {
      const body = Bodies.rectangle(x, y, 26, 66, PIECE_MATERIAL);
      body.shape = { kind: "rect", w: 26, h: 66 };
      return body;
    },
  },
  {
    id: "wide",
    label: "ワイド",
    create(x, y) {
      const body = Bodies.rectangle(x, y, 66, 26, PIECE_MATERIAL);
      body.shape = { kind: "rect", w: 66, h: 26 };
      return body;
    },
  },
  {
    id: "person",
    label: "ひと",
    create(x, y) {
      const headR = 14;
      const torsoW = 30;
      const torsoH = 44;
      const torso = Bodies.rectangle(x, y + headR + 2, torsoW, torsoH, PIECE_MATERIAL);
      torso.shape = { kind: "rect", w: torsoW, h: torsoH };
      torso.noImage = true; // 写真は頭だけに貼り、胴体は色のまま(顔が二重に見えるのを防ぐ)
      const head = Bodies.circle(x, y - torsoH / 2 - 2, headR, PIECE_MATERIAL);
      head.shape = { kind: "circle", r: headR };
      const body = Body.create({ parts: [torso, head] });
      return body;
    },
  },
];

// ---- キャラクター画像 ----
// 読み込みが終わるまでは仮図形(色+顔)で表示し、終わったら自動的に写真へ切り替わる。
const characterImage = new Image();
let characterImageReady = false;
characterImage.onload = () => {
  characterImageReady = true;
};
characterImage.src = "images/IMG_5388.PNG";

// ---- Matter セットアップ ----
const engine = Engine.create({
  positionIterations: 12, // デフォルト(6)より増やし、積み重なった駒がめり込んですり抜けるのを防ぐ
  velocityIterations: 8, // デフォルトは4
});
engine.gravity.y = 1;
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
let currentType = null;
let nextType = pickRandomType();
let settleCounter = 0;
let dropElapsedFrames = 0;
let hasStartedFalling = false;
let heldDirection = 0; // -1 left, 1 right, 0 none
let aimAngle = 0; // 照準中の駒の回転角(ラジアン)

const ROTATE_STEP = Math.PI / 4; // 1回押しで45度

const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

function pickRandomType() {
  return CHARACTER_TYPES[Math.floor(Math.random() * CHARACTER_TYPES.length)];
}

function spawnPiece() {
  currentType = nextType;
  nextType = pickRandomType();
  const body = currentType.create(CANVAS_W / 2, SPAWN_Y);
  Body.setStatic(body, true);
  body.plugin = { color: PLAYER_COLORS[currentPlayer], typeId: currentType.id };
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
  nextType = pickRandomType();
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
// 写真をどの部分を中心に切り抜くか(元画像に対する割合。顔が写っている位置)
const IMAGE_FOCUS_X = 0.26;
const IMAGE_FOCUS_Y = 0.1;

function drawCoverImage(context, img, boxW, boxH) {
  const scale = Math.max(boxW / img.width, boxH / img.height);
  const scaledW = img.width * scale;
  const scaledH = img.height * scale;
  let offsetX = boxW / 2 - IMAGE_FOCUS_X * scaledW;
  let offsetY = boxH / 2 - IMAGE_FOCUS_Y * scaledH;
  offsetX = Math.min(0, Math.max(boxW - scaledW, offsetX));
  offsetY = Math.min(0, Math.max(boxH - scaledH, offsetY));
  context.drawImage(img, offsetX, offsetY, scaledW, scaledH);
}

function drawFaceLocal(context, refSize) {
  const s = Math.max(0.5, refSize / 16);
  context.fillStyle = "rgba(30,30,30,0.85)";
  context.beginPath();
  context.arc(-4 * s, -2 * s, 1.8 * s, 0, Math.PI * 2);
  context.arc(4 * s, -2 * s, 1.8 * s, 0, Math.PI * 2);
  context.fill();
  context.beginPath();
  context.arc(0, 3 * s, 4 * s, 0, Math.PI, false);
  context.strokeStyle = "rgba(30,30,30,0.85)";
  context.lineWidth = 1.5;
  context.stroke();
}

function drawPart(context, body, part, color, drawFaceHere) {
  const shape = part.shape || { kind: "circle", r: part.circleRadius || 20 };
  const boxW = shape.kind === "circle" ? shape.r * 2 : shape.w;
  const boxH = shape.kind === "circle" ? shape.r * 2 : shape.h;

  context.save();
  context.translate(part.position.x, part.position.y);
  context.rotate(body.angle);

  context.beginPath();
  if (shape.kind === "circle") {
    context.arc(0, 0, shape.r, 0, Math.PI * 2);
  } else {
    context.rect(-boxW / 2, -boxH / 2, boxW, boxH);
  }
  context.closePath();

  if (characterImageReady && !part.noImage) {
    context.save();
    context.clip();
    context.translate(-boxW / 2, -boxH / 2);
    drawCoverImage(context, characterImage, boxW, boxH);
    context.restore();
    context.lineWidth = 3;
    context.strokeStyle = color;
    context.stroke();
  } else {
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(0,0,0,0.25)";
    context.stroke();
    if (drawFaceHere) drawFaceLocal(context, Math.min(boxW, boxH) / 2);
  }

  context.restore();
}

function drawBody(context, body) {
  const isCompound = body.parts.length > 1;
  const parts = isCompound ? body.parts.slice(1) : [body];
  const color = (body.plugin && body.plugin.color) || "#999";

  parts.forEach((part) => {
    const drawFaceHere = !isCompound || (part.shape && part.shape.kind === "circle");
    drawPart(context, body, part, color, drawFaceHere);
  });
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
