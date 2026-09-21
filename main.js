// 人物タワーバトル MVP
// 物理エンジン: Matter.js
// 駒はプレイヤーごとの実写切り抜き画像をそのまま使う(図形描画・トリミングなし)。

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

// 弾まない(スーパーボールのような反発をなくす)・滑りにくい、硬い手触りにする
const PIECE_MATERIAL = { restitution: 0, friction: 0.6, frictionStatic: 0.9 };

// ---- プレイヤーごとの駒(写真をそのまま使用) ----
// 当たり判定は写真の縦横比に合わせた長方形。見た目は図形に切り抜かず画像をそのまま描画する。
const PIECE_HEIGHT = 100;
const PLAYER_PIECES = {
  1: { src: "images/IMG_5388.PNG", naturalW: 1359, naturalH: 2103, img: new Image(), ready: false },
  2: { src: "images/IMG_5389.PNG", naturalW: 1354, naturalH: 2427, img: new Image(), ready: false },
};
Object.values(PLAYER_PIECES).forEach((piece) => {
  piece.h = PIECE_HEIGHT;
  piece.w = PIECE_HEIGHT * (piece.naturalW / piece.naturalH);
  piece.img.onload = () => {
    piece.ready = true;
  };
  piece.img.src = piece.src;
});

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
let settleCounter = 0;
let dropElapsedFrames = 0;
let hasStartedFalling = false;
let heldDirection = 0; // -1 left, 1 right, 0 none
let aimAngle = 0; // 照準中の駒の回転角(ラジアン)

const ROTATE_STEP = Math.PI / 4; // 1回押しで45度

const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

function spawnPiece() {
  const piece = PLAYER_PIECES[currentPlayer];
  const body = Bodies.rectangle(CANVAS_W / 2, SPAWN_Y, piece.w, piece.h, PIECE_MATERIAL);
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
    context.drawImage(piece.img, -piece.w / 2, -piece.h / 2, piece.w, piece.h);
  } else {
    // 画像の読み込みが終わるまでの仮表示
    context.fillStyle = "rgba(74, 66, 55, 0.15)";
    context.fillRect(-piece.w / 2, -piece.h / 2, piece.w, piece.h);
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
