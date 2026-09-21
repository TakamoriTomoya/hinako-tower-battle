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
const MAX_DROP_WAIT_MS = 4000;
const FALL_Y = CANVAS_H; // これを超えたら「落下」＝タワー崩壊

const PLAYER_COLORS = { 1: "#4a90d9", 2: "#e8615d" };

// キャラクター（人物）の形状定義。
// 画像を用意したらここに imageSrc を追加して描画を差し替える。
const CHARACTER_TYPES = [
  {
    id: "square",
    label: "しかく",
    create(x, y) {
      return Bodies.rectangle(x, y, 42, 42, { chamfer: { radius: 4 } });
    },
  },
  {
    id: "circle",
    label: "まる",
    create(x, y) {
      return Bodies.circle(x, y, 23);
    },
  },
  {
    id: "tall",
    label: "のっぽ",
    create(x, y) {
      return Bodies.rectangle(x, y, 26, 66, { chamfer: { radius: 4 } });
    },
  },
  {
    id: "wide",
    label: "ワイド",
    create(x, y) {
      return Bodies.rectangle(x, y, 66, 26, { chamfer: { radius: 4 } });
    },
  },
  {
    id: "person",
    label: "ひと",
    create(x, y) {
      const headR = 14;
      const torsoW = 30;
      const torsoH = 44;
      const torso = Bodies.rectangle(x, y + headR + 2, torsoW, torsoH, {
        chamfer: { radius: 4 },
      });
      const head = Bodies.circle(x, y - torsoH / 2 - 2, headR);
      return Body.create({ parts: [torso, head] });
    },
  },
];

// ---- Matter セットアップ ----
const engine = Engine.create();
engine.gravity.y = 1;

const ground = Bodies.rectangle(CANVAS_W / 2, GROUND_Y, GROUND_W, 20, {
  isStatic: true,
});
World.add(engine.world, [ground]);

// ---- DOM ----
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
const nextCanvas = document.getElementById("nextCanvas");
const nextCtx = nextCanvas.getContext("2d");
const turnLabel = document.getElementById("turnLabel");
const heightValue = document.getElementById("heightValue");
const gameOverOverlay = document.getElementById("gameOverOverlay");
const gameOverTitle = document.getElementById("gameOverTitle");
const restartBtn = document.getElementById("restartBtn");
const leftBtn = document.getElementById("leftBtn");
const rightBtn = document.getElementById("rightBtn");
const dropBtn = document.getElementById("dropBtn");

// ---- ゲーム状態 ----
const STATE = { AIMING: "aiming", DROPPING: "dropping", GAMEOVER: "gameover" };

let state = STATE.AIMING;
let currentPlayer = 1;
let currentBody = null;
let currentType = null;
let nextType = pickRandomType();
let settleCounter = 0;
let dropStartedAt = 0;
let hasStartedFalling = false;
let heldDirection = 0; // -1 left, 1 right, 0 none

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
  drawNextPreview();
  updateTurnLabel();
}

function updateTurnLabel() {
  turnLabel.textContent = `プレイヤー${currentPlayer}の番`;
  turnLabel.style.color = PLAYER_COLORS[currentPlayer];
}

function dropPiece() {
  if (state !== STATE.AIMING || !currentBody) return;
  Body.setStatic(currentBody, false);
  state = STATE.DROPPING;
  settleCounter = 0;
  dropStartedAt = performance.now();
  hasStartedFalling = false;
}

function getDynamicBodies() {
  return Composite.allBodies(engine.world).filter((b) => !b.isStatic);
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

function currentHeight() {
  const bodies = getDynamicBodies();
  if (bodies.length === 0) return 0;
  let minY = Infinity;
  bodies.forEach((b) => {
    (b.parts.length > 1 ? b.parts.slice(1) : [b]).forEach((part) => {
      const topY = part.circleRadius
        ? part.position.y - part.circleRadius
        : Math.min(...part.vertices.map((v) => v.y));
      if (topY < minY) minY = topY;
    });
  });
  return Math.max(0, Math.round(GROUND_Y - minY));
}

function endGame(loserPlayer) {
  state = STATE.GAMEOVER;
  const winner = loserPlayer === 1 ? 2 : 1;
  gameOverTitle.textContent = `プレイヤー${winner}の勝ち！`;
  gameOverTitle.style.color = PLAYER_COLORS[winner];
  gameOverOverlay.hidden = false;
}

function nextTurn() {
  currentPlayer = currentPlayer === 1 ? 2 : 1;
  state = STATE.AIMING;
  spawnPiece();
}

function restartGame() {
  const bodies = Composite.allBodies(engine.world).filter((b) => b !== ground);
  bodies.forEach((b) => World.remove(engine.world, b));
  currentPlayer = 1;
  nextType = pickRandomType();
  gameOverOverlay.hidden = true;
  state = STATE.AIMING;
  spawnPiece();
}

// ---- 入力 ----
leftBtn.addEventListener("pointerdown", () => (heldDirection = -1));
rightBtn.addEventListener("pointerdown", () => (heldDirection = 1));
["pointerup", "pointerleave", "pointercancel"].forEach((ev) => {
  leftBtn.addEventListener(ev, () => (heldDirection = 0));
  rightBtn.addEventListener(ev, () => (heldDirection = 0));
});
dropBtn.addEventListener("click", dropPiece);
restartBtn.addEventListener("click", restartGame);

window.addEventListener("keydown", (e) => {
  if (e.code === "ArrowLeft") heldDirection = -1;
  if (e.code === "ArrowRight") heldDirection = 1;
  if (e.code === "Space" || e.code === "ArrowDown") {
    e.preventDefault();
    dropPiece();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "ArrowLeft" && heldDirection === -1) heldDirection = 0;
  if (e.code === "ArrowRight" && heldDirection === 1) heldDirection = 0;
});

// ---- 描画 ----
function drawBody(context, body) {
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  const color = (body.plugin && body.plugin.color) || "#999";

  parts.forEach((part) => {
    context.beginPath();
    if (part.circleRadius) {
      context.arc(part.position.x, part.position.y, part.circleRadius, 0, Math.PI * 2);
    } else {
      const verts = part.vertices;
      context.moveTo(verts[0].x, verts[0].y);
      for (let i = 1; i < verts.length; i++) context.lineTo(verts[i].x, verts[i].y);
      context.closePath();
    }
    context.fillStyle = color;
    context.fill();
    context.lineWidth = 2;
    context.strokeStyle = "rgba(0,0,0,0.25)";
    context.stroke();
  });

  // 顔は「頭」パーツ（円）があればそこに、なければ本体中心に描く
  const headPart = parts.find((p) => p.circleRadius) || body;
  drawFace(context, headPart.position, body.angle, headPart.circleRadius || 14);
}

function drawFace(context, pos, angle, scale) {
  const s = Math.max(0.5, scale / 16);
  context.save();
  context.translate(pos.x, pos.y);
  context.rotate(angle);
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
  context.restore();
}

function render() {
  ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

  // 土台
  ctx.fillStyle = "#7a8a99";
  ctx.fillRect(CANVAS_W / 2 - GROUND_W / 2, GROUND_Y - 10, GROUND_W, 20);

  // 落下ライン(目安)
  ctx.strokeStyle = "rgba(232,97,93,0.4)";
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(0, FALL_Y - 1);
  ctx.lineTo(CANVAS_W, FALL_Y - 1);
  ctx.stroke();
  ctx.setLineDash([]);

  Composite.allBodies(engine.world)
    .filter((b) => b !== ground)
    .forEach((b) => drawBody(ctx, b));

  heightValue.textContent = currentHeight();
}

function drawNextPreview() {
  nextCtx.clearRect(0, 0, 60, 60);
  const dummy = nextType.create(30, 30);
  dummy.plugin = { color: PLAYER_COLORS[currentPlayer === 1 ? 2 : 1] };
  drawBody(nextCtx, dummy);
}

// ---- メインループ ----
let lastTime = performance.now();
function loop(now) {
  const delta = Math.min(33, now - lastTime);
  lastTime = now;

  if (state !== STATE.GAMEOVER) {
    if (state === STATE.AIMING && currentBody) {
      let x = currentBody.position.x + heldDirection * MOVE_SPEED;
      x = Math.max(30, Math.min(CANVAS_W - 30, x));
      Body.setPosition(currentBody, { x, y: SPAWN_Y });
    }

    Engine.update(engine, delta);

    if (checkFallen()) {
      endGame(currentPlayer);
    } else if (state === STATE.DROPPING) {
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
        if (now - dropStartedAt > MAX_DROP_WAIT_MS) {
          nextTurn();
        }
      }
    }
  }

  render();
  requestAnimationFrame(loop);
}

// ---- 起動 ----
spawnPiece();
requestAnimationFrame(loop);
