// タワーバトルのゲームエンジン本体。
// Matter.js物理・Canvas描画・ポインタ/キー入力をすべて内包する、Reactに依存しないクラス。
// 駒の位置/角度は毎フレーム変わるためReact stateにはせず、UIに関わる値(手番・勝敗・画面)
// だけをEngineStateListener経由でReact側に伝える。

import * as Matter from "matter-js";
import decomp from "poly-decomp";
import {
  AIM_TIME_LIMIT_MS,
  CANVAS_H,
  CANVAS_W,
  FALLBACK_MARGIN,
  FALLING_SPEED_THRESHOLD,
  FALL_Y,
  GROUND_W,
  GROUND_Y,
  MAX_DROP_WAIT_FRAMES,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  PHYSICS_SUBSTEPS,
  PIECE_HEIGHT,
  PIECE_MATERIAL,
  PLAYER_NAMES,
  REROLL_LIMIT,
  ROTATE_HOLD_SPEED,
  ROTATE_SMOOTHING,
  SETTLE_FRAMES_NEEDED,
  SETTLE_SPEED_EPS,
  SPAWN_CLEARANCE,
  SPAWN_Y_BASE,
  SPAWN_Y_MIN,
  TAP_MAX_DISTANCE,
  VIEW_TOP_MARGIN,
  VIEW_ZOOM_SMOOTHING,
} from "./constants";
import { loadGroundImage, type GroundAsset } from "./ground";
import { loadPieceImages, pickRandomPiece, type Piece } from "./pieces";

const { Engine, World, Bodies, Body, Composite, Common, Sleeping } = Matter;

// 写真の輪郭(凹みあり)を複数の凸パーツに自動分割するためのライブラリを登録
Common.setDecomp(decomp);

export type EnginePhase = "home" | "aiming" | "dropping" | "gameover";
export type Player = 1 | 2;

export interface EngineState {
  phase: EnginePhase;
  turnPlayer: Player;
  winner: Player | null;
  remainingSeconds: number; // 狙い中の残り時間(秒、切り上げ)。aiming以外の時は参照されない
  rerollsRemaining: number; // 今の手番のプレイヤーが、落とすキャラをランダム変更できる残り回数
  assetsReady: boolean; // 土台・駒の画像を全て読み込み終えたか(falseの間はローディング画面を出す)
  currentPieceName: string; // 今狙っている(落とそうとしている)駒の名前。駒がない時は空文字
}

export type EngineStateListener = (state: EngineState) => void;

interface PieceBody extends Matter.Body {
  plugin: { piece: Piece };
}

export class TowerBattleEngine {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private readonly engine = Engine.create({
    positionIterations: 12, // デフォルト(6)より増やし、積み重なった駒がめり込んですり抜けるのを防ぐ
    velocityIterations: 8, // デフォルトは4
  });

  private ground: Matter.Body;
  private readonly pieces: Piece[] = loadPieceImages(() => this.checkAssetsReady());
  private readonly groundAsset: GroundAsset;
  private assetsReady = false;

  private phase: EnginePhase = "home";
  private currentPlayer: Player = 1;
  private winner: Player | null = null;
  private currentBody: PieceBody | null = null;
  private settleCounter = 0;
  private dropElapsedFrames = 0;
  private hasStartedFalling = false;
  private aimElapsedMs = 0;
  private remainingSeconds = Math.ceil(AIM_TIME_LIMIT_MS / 1000);
  // 落とすキャラのランダム変更の残り回数(1試合につきプレイヤーごと)
  private rerollsRemaining: Record<Player, number> = { 1: REROLL_LIMIT, 2: REROLL_LIMIT };
  private heldDirection: -1 | 0 | 1 = 0; // -1: 左, 1: 右, 0: 停止
  private isRotating = false; // 回転ボタンを押している間だけtrue(右回りのみ)
  private aimAngle = 0;
  private displayAngle = 0;
  private viewScale = 1;
  private currentSpawnY = SPAWN_Y_BASE;
  private groundTopSurfaceY = GROUND_Y - 10; // 土台の実際の見た目の上面(輪郭確定前の仮値)

  private isDraggingPiece = false;
  private dragStartClientX = 0;
  private dragStartPieceX = 0;
  private dragMoved = 0;

  // ホーム画面も「ゲーム画面(土台+駒)」をそのまま流用して表示する(見た目の実装を二重に持たない)。
  // 物理演算はさせず、ただの静止した飾りとして両脇に積む。

  // ---- 画面サイズ対応 ----
  // 物理演算・駒の座標は常にCANVAS_W×CANVAS_Hの論理座標系で行い、
  // 実機の画面サイズには「描画時にどれだけ拡大縮小・平行移動するか」だけを対応させる。
  // これにより「積みやすさ」などのゲームバランスを一切変えずに、あらゆる画面幅で
  // 横幅いっぱいに表示できる(object-fit等のCSS任せの暗黙スケーリングに頼らない)。
  private renderScale = 1; // 論理1pxが実際に何CSS pxになるか
  private offsetX = 0; // 左右中央寄せのための平行移動(CSS px)
  private offsetY = 0; // 土台を画面下端に揃えるための平行移動(CSS px)
  private dpr = 1;
  private lastCssW = 0;
  private lastCssH = 0;

  private rafId: number | null = null;
  private lastTime = 0;
  private disposed = false;

  private readonly listener: EngineStateListener;

  constructor(listener: EngineStateListener) {
    this.listener = listener;
    this.engine.gravity.y = 0.5; // 落下速度をゆっくりめにする
    // ほぼ止まった駒は完全に固定(スリープ)させる。これがないと着地後も
    // 計算誤差レベルのごく僅かな揺れが収束しきらず、駒がじわじわにじみ続けてしまう。
    this.engine.enableSleeping = true;

    // 画像の輪郭が用意できるまでの仮の当たり判定(四角、厚みを持たせてすり抜け防止)
    const groundSurfaceY = GROUND_Y - 10;
    const groundBodyThickness = 300;
    this.ground = Bodies.rectangle(
      CANVAS_W / 2,
      groundSurfaceY + groundBodyThickness / 2,
      GROUND_W,
      groundBodyThickness,
      { isStatic: true },
    );
    World.add(this.engine.world, [this.ground]);

    this.groundAsset = loadGroundImage(() => {
      this.replaceGroundBodyWithOutline();
      this.checkAssetsReady();
    });
  }

  init(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.attachInput();
    this.lastTime = performance.now();
    this.rafId = requestAnimationFrame(this.loop);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.detachInput();
  }

  // ResizeObserver等の「通知が来るのを待つ」方式は、通知が実際に届くタイミングが
  // 環境によってまちまちで、一瞬でもサイズがずれたコマを描いてしまう恐れがある。
  // 毎フレーム自前で実サイズを測って必要な時だけ張り直す方式にすることで、
  // どんな環境・タイミングでも常に「今の実サイズ」に同期させる。
  private syncSizeToContainer(): void {
    const canvas = this.canvas;
    const container = canvas?.parentElement;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    if (rect.width === this.lastCssW && rect.height === this.lastCssH) return;
    this.lastCssW = rect.width;
    this.lastCssH = rect.height;
    this.applySize(rect.width, rect.height);
  }

  // 実際に使える幅・高さ(CSS px)から、論理座標系(CANVAS_W×CANVAS_H)を
  // どう拡大縮小・配置するかを計算し、canvasの描画バッファ自体もそれに合わせて張り直す。
  // 常に「横幅いっぱいに収まる倍率」と「縦がはみ出ない倍率」のうち小さい方を採るため、
  // 横は必ずできる限り画面いっぱいに広がり、かつキャラが画面外に見切れることもない。
  private applySize(cssW: number, cssH: number): void {
    if (!this.canvas || cssW <= 0 || cssH <= 0) return;

    const scale = Math.min(cssW / CANVAS_W, cssH / CANVAS_H);
    this.renderScale = scale;
    const displayW = CANVAS_W * scale;
    const displayH = CANVAS_H * scale;
    this.offsetX = (cssW - displayW) / 2;
    this.offsetY = cssH - displayH; // 土台側(下端)を基準に揃える

    this.dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.round(cssW * this.dpr);
    this.canvas.height = Math.round(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
  }

  // ---- 公開操作 ----

  startBattle(): void {
    this.clearWorld();
    this.currentPlayer = Math.random() < 0.5 ? 1 : 2; // 先攻/後攻は毎回ランダム
    this.winner = null;
    this.rerollsRemaining = { 1: REROLL_LIMIT, 2: REROLL_LIMIT };
    this.phase = "aiming";
    this.spawnPiece();
  }

  goHome(): void {
    this.clearWorld();
    this.phase = "home";
    this.winner = null;
    this.currentBody = null;
    this.emit();
  }

  startRotating(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    this.isRotating = true;
  }

  stopRotating(): void {
    this.isRotating = false;
  }

  // 落とすキャラをランダムに変更する(今の手番プレイヤーが持つ残り回数の分だけ)
  rerollPiece(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    if (this.rerollsRemaining[this.currentPlayer] <= 0) return;

    const previousSrc = this.currentBody.plugin.piece.src;
    const x = this.currentBody.position.x;
    World.remove(this.engine.world, this.currentBody);

    const readyCount = this.pieces.filter((p) => p.ready && p.hullLocal).length;
    let piece = pickRandomPiece(this.pieces);
    // 選択肢が2種類以上ある時は、変更前と同じキャラを引き直さないようにする
    for (let attempts = 0; attempts < 20 && readyCount > 1 && piece.src === previousSrc; attempts++) {
      piece = pickRandomPiece(this.pieces);
    }

    let body: Matter.Body;
    if (piece.hullLocal) {
      body = Bodies.fromVertices(x, this.currentSpawnY, [piece.hullLocal], PIECE_MATERIAL, true);
    } else {
      const fallbackHeight = PIECE_HEIGHT * piece.sizeScale;
      body = Bodies.rectangle(x, this.currentSpawnY, fallbackHeight * 0.6, fallbackHeight, PIECE_MATERIAL);
    }
    Body.setStatic(body, true);
    body.plugin = { piece };
    World.add(this.engine.world, body);
    this.currentBody = body as PieceBody;
    this.aimAngle = 0;
    this.displayAngle = 0;

    // キャラごとに横幅が違うため、変更後の駒がキャンバス外にはみ出さない位置へ収め直す
    const margin = this.pieceHorizontalMargin(this.currentBody);
    const clampedX = Math.max(margin, Math.min(CANVAS_W - margin, x));
    Body.setPosition(this.currentBody, { x: clampedX, y: this.currentSpawnY });

    this.rerollsRemaining[this.currentPlayer]--;
    this.emit();
  }

  dropPiece(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    Body.setStatic(this.currentBody, false);
    // isStatic=trueの間についた「スリープ」扱いが残ると重力すら効かなくなるため、
    // 動的に戻したタイミングで明示的に起こす
    Sleeping.set(this.currentBody, false);
    this.phase = "dropping";
    this.settleCounter = 0;
    this.dropElapsedFrames = 0;
    this.hasStartedFalling = false;
    this.emit();
  }

  // ---- 内部: 状態通知 ----

  // 土台・駒の画像が全部揃うまでローディング画面を出すためのチェック。
  // 各画像のonloadから毎回呼ばれ、揃った瞬間だけ状態を通知する。
  private checkAssetsReady(): void {
    if (this.assetsReady) return;
    if (this.pieces.every((p) => p.ready) && this.groundAsset.ready) {
      this.assetsReady = true;
      this.emit();
    }
  }

  private emit(): void {
    if (this.disposed) return;
    this.listener({
      phase: this.phase,
      turnPlayer: this.currentPlayer,
      winner: this.winner,
      remainingSeconds: this.remainingSeconds,
      rerollsRemaining: this.rerollsRemaining[this.currentPlayer],
      assetsReady: this.assetsReady,
      currentPieceName: this.currentBody?.plugin.piece.name ?? "",
    });
  }

  // ---- 内部: ワールド操作 ----

  private clearWorld(): void {
    const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
    bodies.forEach((b) => World.remove(this.engine.world, b));
  }

  private replaceGroundBodyWithOutline(): void {
    const outline = this.groundAsset.outline;
    if (!outline) return;
    const groundX = CANVAS_W / 2 - GROUND_W / 2;
    const groundBarY = GROUND_Y - 10;
    const worldX = groundX - outline.imageOffsetX;
    const worldY = groundBarY - outline.imageOffsetY;

    const outlineBody = Bodies.fromVertices(worldX, worldY, [outline.outlineLocal], {}, true);
    // 輪郭は丸みを帯びているため、駒がそのまま乗ると側面に重なって見えてしまう。
    // 見た目には影響しない「平らな支え」を頂上に足して、駒がぴったり乗るようにする。
    const topY = outlineBody.bounds.min.y;
    const flatTop = Bodies.rectangle(worldX, topY + 5, GROUND_W * 0.7, 10);
    const outlineParts = outlineBody.parts.length > 1 ? outlineBody.parts.slice(1) : [outlineBody];
    const shapedGround = Body.create({ parts: [...outlineParts, flatTop], isStatic: true });
    this.groundTopSurfaceY = topY;

    World.remove(this.engine.world, this.ground);
    World.add(this.engine.world, shapedGround);
    this.ground = shapedGround;
  }

  // タワーの一番高い場所に合わせてスポーン位置を決める(タワーが空ならSPAWN_Y_BASE)
  private computeSpawnY(): number {
    const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
    if (bodies.length === 0) return SPAWN_Y_BASE;
    const towerTopY = Math.min(...bodies.map((b) => b.bounds.min.y));
    return Math.max(SPAWN_Y_MIN, Math.min(SPAWN_Y_BASE, towerTopY - SPAWN_CLEARANCE));
  }

  private spawnPiece(): void {
    this.currentSpawnY = this.computeSpawnY();
    const piece = pickRandomPiece(this.pieces);
    let body: Matter.Body;
    if (piece.hullLocal) {
      // 写真の不透明部分を包む凸包を当たり判定にする(見えない四角の余白をなくす)
      body = Bodies.fromVertices(CANVAS_W / 2, this.currentSpawnY, [piece.hullLocal], PIECE_MATERIAL, true);
    } else {
      // 画像の読み込み・輪郭計算がまだ終わっていない場合の一時的なフォールバック
      const fallbackHeight = PIECE_HEIGHT * piece.sizeScale;
      body = Bodies.rectangle(CANVAS_W / 2, this.currentSpawnY, fallbackHeight * 0.6, fallbackHeight, PIECE_MATERIAL);
    }
    Body.setStatic(body, true);
    body.plugin = { piece };
    World.add(this.engine.world, body);
    this.currentBody = body as PieceBody;
    this.aimAngle = 0;
    this.displayAngle = 0;
    this.isRotating = false;
    this.aimElapsedMs = 0;
    this.remainingSeconds = Math.ceil(AIM_TIME_LIMIT_MS / 1000);
    this.emit();
  }

  private nextTurn(): void {
    this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.phase = "aiming";
    this.spawnPiece();
  }

  private endGame(loserPlayer: Player): void {
    this.phase = "gameover";
    this.winner = loserPlayer === 1 ? 2 : 1;
    this.emit();
  }

  // ---- 内部: 物理ヘルパー ----

  private getDynamicBodies(): Matter.Body[] {
    return Composite.allBodies(this.engine.world).filter((b) => !b.isStatic);
  }

  private capFallSpeed(): void {
    this.getDynamicBodies().forEach((b) => {
      if (b.velocity.y > MAX_FALL_SPEED) {
        Body.setVelocity(b, { x: b.velocity.x, y: MAX_FALL_SPEED });
      }
    });
  }

  private checkFallen(): boolean {
    return this.getDynamicBodies().some((b) => b.position.y > FALL_Y);
  }

  private maxBodySpeed(): number {
    return this.getDynamicBodies().reduce((max, b) => {
      const speed = Math.max(Math.abs(b.velocity.x), Math.abs(b.velocity.y), Math.abs(b.angularVelocity));
      return Math.max(max, speed);
    }, 0);
  }

  private checkSettled(): boolean {
    return this.maxBodySpeed() < SETTLE_SPEED_EPS;
  }

  // ---- 内部: 入力 ----

  private canvasScale(): number {
    return this.renderScale > 0 ? 1 / this.renderScale : 1;
  }

  // キャラ画像は駒ごと(sizeScale)に描画サイズが大きく異なり、かつ回転もするため、
  // 「中心からキャンバス端までの固定30px」では大きい・回転した駒がキャンバス外にはみ出て見切れる。
  // 現在の回転角での実際の画像バウンディングボックスから、中心～端に必要な余白を都度計算する。
  private pieceHorizontalMargin(body: PieceBody): number {
    const piece = body.plugin?.piece;
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

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.phase !== "aiming" || !this.currentBody || !this.canvas) return;
    this.isDraggingPiece = true;
    this.dragStartClientX = e.clientX;
    this.dragStartPieceX = this.currentBody.position.x;
    this.dragMoved = 0;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (!this.isDraggingPiece || this.phase !== "aiming" || !this.currentBody) return;
    // 画面がviewScaleで縮小表示されている間は、指の移動量(見た目上の量)に対して
    // 駒の実座標(ワールド座標)はより大きく動かさないと、見た目の追従が遅くなってしまう
    const deltaX = ((e.clientX - this.dragStartClientX) * this.canvasScale()) / this.viewScale;
    this.dragMoved = Math.max(this.dragMoved, Math.abs(e.clientX - this.dragStartClientX));
    let x = this.dragStartPieceX + deltaX;
    const margin = this.pieceHorizontalMargin(this.currentBody);
    x = Math.max(margin, Math.min(CANVAS_W - margin, x));
    Body.setPosition(this.currentBody, { x, y: this.currentSpawnY });
  };

  private handlePointerUp = (): void => {
    if (this.isDraggingPiece && this.dragMoved <= TAP_MAX_DISTANCE) this.dropPiece();
    this.isDraggingPiece = false;
  };

  private handlePointerCancel = (): void => {
    this.isDraggingPiece = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft") this.heldDirection = -1;
    if (e.code === "ArrowRight") this.heldDirection = 1;
    if (e.code === "Space" || e.code === "ArrowDown") {
      e.preventDefault();
      this.dropPiece();
    }
    if (e.code === "KeyE") this.startRotating();
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (e.code === "ArrowLeft" && this.heldDirection === -1) this.heldDirection = 0;
    if (e.code === "ArrowRight" && this.heldDirection === 1) this.heldDirection = 0;
    if (e.code === "KeyE") this.stopRotating();
  };

  private attachInput(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    canvas.addEventListener("pointerdown", this.handlePointerDown);
    canvas.addEventListener("pointermove", this.handlePointerMove);
    canvas.addEventListener("pointerup", this.handlePointerUp);
    canvas.addEventListener("pointercancel", this.handlePointerCancel);
    canvas.addEventListener("pointerleave", this.handlePointerCancel);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
  }

  private detachInput(): void {
    const canvas = this.canvas;
    if (canvas) {
      canvas.removeEventListener("pointerdown", this.handlePointerDown);
      canvas.removeEventListener("pointermove", this.handlePointerMove);
      canvas.removeEventListener("pointerup", this.handlePointerUp);
      canvas.removeEventListener("pointercancel", this.handlePointerCancel);
      canvas.removeEventListener("pointerleave", this.handlePointerCancel);
    }
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
  }

  // ---- 内部: 描画 ----

  // タワー(＋今照準中の駒)が一番高くなっている場所を元に、
  // キャンバス上端(y=0)より外に出そうな分だけ画面全体を縮小する倍率を求める。
  // これをしないと、キャンバスは固定サイズ(380x640)の描画バッファなので、
  // タワーが積み上がってy<0の領域に達した駒はCSSの調整に関係なく単純に描画されず「見切れる」。
  private computeTargetViewScale(): number {
    const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
    let minY = Infinity;
    bodies.forEach((b) => {
      if (b.bounds.min.y < minY) minY = b.bounds.min.y;
    });
    if (this.currentBody && this.currentBody.bounds.min.y < minY) minY = this.currentBody.bounds.min.y;
    if (!isFinite(minY)) return 1;

    const visibleTop = minY - VIEW_TOP_MARGIN;
    if (visibleTop >= 0) return 1;
    // 下端(y=CANVAS_H)を基準に、visibleTopがちょうどy'=0に収まるまで縮小する
    return CANVAS_H / (CANVAS_H - visibleTop);
  }

  private drawBody(body: PieceBody): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const piece = body.plugin.piece;
    ctx.save();
    ctx.translate(body.position.x, body.position.y);
    ctx.rotate(body.angle);

    if (piece.ready) {
      // imageOffsetX/Yで「当たり判定(凸包)の重心」と「写真の見た目」の位置を一致させる
      ctx.drawImage(piece.img, piece.imageOffsetX, piece.imageOffsetY, piece.w, piece.h);
    } else {
      // 画像の読み込みが終わるまでの仮表示
      ctx.fillStyle = "rgba(74, 66, 55, 0.15)";
      ctx.fillRect(-PIECE_HEIGHT * 0.3, -PIECE_HEIGHT / 2, PIECE_HEIGHT * 0.6, PIECE_HEIGHT);
    }

    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const groundX = CANVAS_W / 2 - GROUND_W / 2;
    const groundBarY = GROUND_Y - 10;
    const groundImage = this.groundAsset.image;
    if (this.groundAsset.ready && this.groundAsset.outline) {
      // 実際の当たり判定(パンの輪郭)の位置に合わせて画像を描画する
      const groundImgH = GROUND_W * (groundImage.naturalHeight / groundImage.naturalWidth);
      ctx.save();
      ctx.translate(this.ground.position.x, this.ground.position.y);
      ctx.drawImage(groundImage, this.groundAsset.outline.imageOffsetX, this.groundAsset.outline.imageOffsetY, GROUND_W, groundImgH);
      ctx.restore();
    } else if (this.groundAsset.ready) {
      // 輪郭抽出がまだの場合の仮表示(縦横比は変えず、上端をgroundBarYに合わせる)
      const groundImgH = GROUND_W * (groundImage.naturalHeight / groundImage.naturalWidth);
      ctx.drawImage(groundImage, groundX, groundBarY, GROUND_W, groundImgH);
    } else {
      ctx.fillStyle = "#e0b98c";
      ctx.fillRect(groundX, groundBarY, GROUND_W, 20);
    }
  }

  private render(): void {
    this.syncSizeToContainer();

    const ctx = this.ctx;
    const canvas = this.canvas;
    if (!ctx || !canvas) return;

    // 描画バッファ全体(実機px)をクリアしてから、
    // 論理座標系(CANVAS_W×CANVAS_H)を実機の表示サイズに合わせる変換をかける。
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, this.dpr * this.offsetX, this.dpr * this.offsetY);
    ctx.scale(this.renderScale, this.renderScale);

    // タワーが上端に近づいたら、下端(土台)を基準に画面全体を縮小して全体を収める
    const targetScale = this.computeTargetViewScale();
    this.viewScale += (targetScale - this.viewScale) * VIEW_ZOOM_SMOOTHING;
    if (Math.abs(targetScale - this.viewScale) < 0.001) this.viewScale = targetScale;

    ctx.save();
    if (this.viewScale < 1) {
      ctx.translate(CANVAS_W / 2, CANVAS_H);
      ctx.scale(this.viewScale, this.viewScale);
      ctx.translate(-CANVAS_W / 2, -CANVAS_H);
    }

    this.drawGround(ctx);

    if (this.phase !== "home") {
      Composite.allBodies(this.engine.world)
        .filter((b): b is PieceBody => b !== this.ground)
        .forEach((b) => this.drawBody(b));
    }

    ctx.restore();
  }

  // ---- メインループ ----

  private loop = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(33, now - this.lastTime);
    this.lastTime = now;

    if (this.phase === "aiming" || this.phase === "dropping") {
      if (this.phase === "aiming" && this.currentBody) {
        let x = this.currentBody.position.x + this.heldDirection * MOVE_SPEED;
        const margin = this.pieceHorizontalMargin(this.currentBody);
        x = Math.max(margin, Math.min(CANVAS_W - margin, x));
        Body.setPosition(this.currentBody, { x, y: this.currentSpawnY });

        if (this.isRotating) this.aimAngle += ROTATE_HOLD_SPEED;

        // 目標角へ少しずつ近づけて回転を滑らかにする
        this.displayAngle += (this.aimAngle - this.displayAngle) * ROTATE_SMOOTHING;
        if (Math.abs(this.aimAngle - this.displayAngle) < 0.001) this.displayAngle = this.aimAngle;
        Body.setAngle(this.currentBody, this.displayAngle);

        // 制限時間の消化。表示は秒単位(切り上げ)だが、値が変わった時だけemitしてReactの再描画を抑える
        this.aimElapsedMs += delta;
        const nextRemainingSeconds = Math.max(0, Math.ceil((AIM_TIME_LIMIT_MS - this.aimElapsedMs) / 1000));
        if (nextRemainingSeconds !== this.remainingSeconds) {
          this.remainingSeconds = nextRemainingSeconds;
          this.emit();
        }
        if (this.aimElapsedMs >= AIM_TIME_LIMIT_MS) {
          // 制限時間切れ: 今の位置・角度のまま自動で落とす
          this.dropPiece();
        }
      }

      // 1フレーム分をまとめて1回で計算すると、高速で落ちた駒が着地の瞬間に
      // 大きくめり込んでから補正で戻る=「少し沈む」ように見える。
      // 同じ時間を細かく分けて計算することで、見た目の速さは変えずにめり込みを防ぐ。
      const substepDelta = delta / PHYSICS_SUBSTEPS;
      for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
        Engine.update(this.engine, substepDelta);
        this.capFallSpeed();
      }

      if (this.checkFallen()) {
        this.endGame(this.currentPlayer);
      } else if (this.phase === "dropping") {
        this.dropElapsedFrames++;
        if (!this.hasStartedFalling && this.maxBodySpeed() > FALLING_SPEED_THRESHOLD) {
          this.hasStartedFalling = true;
        }
        if (this.hasStartedFalling && this.checkSettled()) {
          this.settleCounter++;
          if (this.settleCounter >= SETTLE_FRAMES_NEEDED) {
            this.nextTurn();
          }
        } else {
          this.settleCounter = 0;
          if (this.dropElapsedFrames > MAX_DROP_WAIT_FRAMES) {
            this.nextTurn();
          }
        }
      }
    }

    this.render();
    this.rafId = requestAnimationFrame(this.loop);
  };
}

export function playerName(player: Player): string {
  return PLAYER_NAMES[player];
}
