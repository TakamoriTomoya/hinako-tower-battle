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

const PLAYER_COLORS = { 1: "#4a90d9", 2: "#e8615d" };

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
      return Bodies.rectangle(x, y, 42, 42, PIECE_MATERIAL);
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
      return body;
    },
  },
  {
    id: "tall",
    label: "のっぽ",
    create(x, y) {
      return Bodies.rectangle(x, y, 26, 66, PIECE_MATERIAL);
    },
  },
  {
    id: "wide",
    label: "ワイド",
    create(x, y) {
      return Bodies.rectangle(x, y, 66, 26, PIECE_MATERIAL);
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
      const head = Bodies.circle(x, y - torsoH / 2 - 2, headR, PIECE_MATERIAL);
      return Body.create({ parts: [torso, head] });
    },
  },
];

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
let dropElapsedFrames = 0;
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
    capFallSpeed();

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

  render();
  requestAnimationFrame(loop);
}

// ---- 起動 ----
spawnPiece();
requestAnimationFrame(loop);
