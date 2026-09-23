// タワーバトルのゲームエンジン本体。
// Matter.js物理・Canvas描画・ポインタ/キー入力をすべて内包する、Reactに依存しないクラス。
// 駒の位置/角度は毎フレーム変わるためReact stateにはせず、UIに関わる値(手番・勝敗・画面)
// だけをEngineStateListener経由でReact側に伝える。
//
// オンライン対戦(ホスト権威モデル):
// - ホスト(プレイヤー1)側のこのクラスだけが実際にMatter.jsを実行し、結果を一定間隔で配信する。
// - ゲスト(プレイヤー2)側のこのクラスはMatter.jsのworldを一切更新せず、受信したスナップショットを
//   そのまま描画するだけの「ミラー」になる(環境によって結果がずれうる物理演算を2重に走らせない)。
// - 自分の手番でない間はローカル入力を無視し、ゲストは自分の手番の入力をネットワーク経由でホストへ送る。
//   ホストはそれを、ローカル入力ハンドラが更新するのと同じ内部状態(heldDirection等)に適用する。

import * as Matter from "matter-js";
import decomp from "poly-decomp";
import {
  AIM_TIME_LIMIT_MS,
  CANVAS_H,
  CANVAS_W,
  FALLBACK_MARGIN,
  FALLING_SPEED_THRESHOLD,
  FALL_Y,
  GROUND_BAR_THICKNESS,
  GROUND_SPIKES,
  GROUND_STRAIGHT_BAR,
  GROUND_W,
  GROUND_Y,
  CONTACT_ANGULAR_DAMPING,
  MAX_ANGULAR_SPEED,
  MAX_DROP_WAIT_FRAMES,
  MAX_FALL_SPEED,
  MOVE_SPEED,
  NETWORK_BROADCAST_INTERVAL_MS,
  PHYSICS_SUBSTEPS,
  PHYSICS_TICK_MS,
  PIECE_HEIGHT,
  PIECE_INERTIA_SCALE,
  PIECE_MATERIAL,
  PLAYER_NAMES,
  REMOTE_AIM_SMOOTHING,
  REROLL_LIMIT,
  RESOLVER_RESTING_THRESH,
  ROTATE_HOLD_SPEED,
  ROTATE_SMOOTHING,
  SETTLE_FRAMES_NEEDED,
  SETTLE_SPEED_EPS,
  SLEEP_DISPLACEMENT_TOL,
  SLEEP_FRAMES_NEEDED,
  SPAWN_CLEARANCE,
  SPAWN_Y_BASE,
  TAP_MAX_DISTANCE,
  VIEW_PAN_SMOOTHING,
  VIEW_TOP_MARGIN,
} from "./constants";
import { decomposeToConvex } from "./decompose";
import type { Point } from "./geometry";
import { loadGroundImage, type GroundAsset } from "./ground";
import type { RoomSync } from "./network/roomSync";
import type { RemoteInputEvent, RemoteInputPayload, RoomRole, Snapshot, SnapshotBody } from "./network/types";
import { loadPieceImages, PieceBag, type Piece } from "./pieces";

const { Engine, World, Bodies, Body, Composite, Common, Sleeping, Vertices } = Matter;

// 写真の輪郭(凹みあり)を複数の凸パーツに自動分割するためのライブラリを登録
Common.setDecomp(decomp);

// Matterは「一定以上の速さでぶつかった接触」を、接触点ごとに順番に1回きりの押し返しで処理する。
// 駒は複数の凸パーツの集まりなので、両足で同時に着地しても先に処理された側だけが強く押し返され、
// 真っすぐ落としても回転が生まれて左右に揺れ続けていた。しきい値を十分大きくし、
// 全ての接触を「押し返しを積み上げて釣り合わせる」通常の方式で解く(反発係数0なので弾みは失われない)。
(Matter as unknown as { Resolver: { _restingThresh: number } }).Resolver._restingThresh = RESOLVER_RESTING_THRESH;

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
  towerMoving: boolean; // 積んだ駒がまだ動いているか(trueの間は次の駒を落とせない)
  stackedCount: number; // この対戦で積み上げた駒の個数(オンライン対戦では2人の合計)
}

export type EngineStateListener = (state: EngineState) => void;

// URLに?debugを付けると当たり判定の形を画面に重ねて表示する(見た目とのずれの確認用)
const DEBUG_SHOW_COLLISION = typeof location !== "undefined" && new URLSearchParams(location.search).has("debug");

interface PieceBody extends Matter.Body {
  plugin: { piece: Piece; id: number };
}

// 分割済みの凸多角形の集まりから、形を保ったまま複合ボディを作り、重心を(x, y)に置く。
// Bodies.fromVertices に凸多角形を複数渡すと、各パーツが自分の中心を(x, y)に合わせて置かれてしまい、
// 全パーツが中央に重なった崩れた当たり判定になる(土台の中央に出っ張りができ、両脇の当たり判定が消える等)。
function bodyFromConvexParts(x: number, y: number, convexParts: Point[][], options: Matter.IBodyDefinition): Matter.Body {
  const parts = convexParts
    .map((part) => Vertices.clockwiseSort(part.map((p) => ({ x: p.x, y: p.y })) as Matter.Vector[]))
    .filter((verts) => verts.length >= 3 && Vertices.area(verts, false) > 1e-6)
    .map((verts) => Body.create({ ...options, position: Vertices.centre(verts), vertices: verts }));
  const body = parts.length === 1 ? parts[0] : Body.create({ ...options, parts });
  Body.setPosition(body, { x, y });
  return body;
}

// トゲ付きの棒(土台)を、トゲ1本ごとの縦の帯に切った凸多角形の集まりとして当たり判定にする。
// 各帯は「棒の部分 + その下のトゲ」の五角形で、両端の帯は上の角から先端へ斜めに下ろす(描画と同じ形)
function createSpikedBarBody(): Matter.Body {
  const left = CANVAS_W / 2 - GROUND_W / 2;
  const top = GROUND_Y - 10;
  const bottom = top + GROUND_BAR_THICKNESS;
  const last = GROUND_SPIKES.length - 1;
  const convexParts: Point[][] = GROUND_SPIKES.map((spike, i) => {
    const startX = left + spike.startX;
    const endX = left + (i < last ? GROUND_SPIKES[i + 1].startX : GROUND_W);
    const tip = { x: left + spike.tipX, y: bottom + spike.height };
    return [
      { x: startX, y: top },
      { x: endX, y: top },
      ...(i < last ? [{ x: endX, y: bottom }] : []),
      tip,
      ...(i > 0 ? [{ x: startX, y: bottom }] : []),
    ];
  });

  // bodyFromConvexPartsは重心を指定位置に置くので、面積で重み付けした重心を求めて渡す
  let area = 0;
  let cx = 0;
  let cy = 0;
  convexParts.forEach((part) => {
    const verts = part as Matter.Vector[];
    const a = Vertices.area(verts, false);
    const c = Vertices.centre(verts);
    area += a;
    cx += c.x * a;
    cy += c.y * a;
  });
  // isStaticは作成後に設定する(replaceGroundBodyWithOutlineと同じ理由)
  const body = bodyFromConvexParts(cx / area, cy / area, convexParts, PIECE_MATERIAL);
  Body.setStatic(body, true);
  return body;
}

// 複合ボディの慣性モーメントを、各パーツの重心からのずれ(平行軸の定理)も含めて計算し直す。
// (Matter標準の計算にはこの項が抜けている。詳しくはconstants.tsのPIECE_INERTIA_SCALE)
function applyCompoundInertia(body: Matter.Body): void {
  const parts = body.parts.length > 1 ? body.parts.slice(1) : [body];
  let inertia = 0;
  for (const part of parts) {
    const local = part.vertices.map((v) => ({ x: v.x - part.position.x, y: v.y - part.position.y }));
    const dx = part.position.x - body.position.x;
    const dy = part.position.y - body.position.y;
    inertia += Vertices.inertia(local as Matter.Vector[], part.mass) + part.mass * (dx * dx + dy * dy);
  }
  Body.setInertia(body, inertia * PIECE_INERTIA_SCALE);
}

// 駒の中心から一番遠い頂点までの距離(回転した時に端がどれだけ動くかの計算用)。形は変わらないのでキャッシュする
const bodyRadiusCache = new WeakMap<Matter.Body, number>();
function bodyRadius(body: Matter.Body): number {
  let r = bodyRadiusCache.get(body);
  if (r === undefined) {
    r = 0;
    for (const part of body.parts) {
      for (const v of part.vertices) {
        r = Math.max(r, Math.hypot(v.x - body.position.x, v.y - body.position.y));
      }
    }
    bodyRadiusCache.set(body, r);
  }
  return r;
}

// 駒の動きの大きさ(正規化単位)。重心の速さと、回転による駒の端の速さの大きい方
function bodyMotion(body: Matter.Body): number {
  return Math.max(Body.getSpeed(body), Body.getAngularSpeed(body) * bodyRadius(body));
}

// 狙い中の駒を動かせる横の範囲。駒の端が台の端に届くところまでではなく、
// 駒全体が台の外に出るところまで動かせるので、台の外側からも落とせる
function clampAimX(x: number, margin: number): number {
  const groundLeft = CANVAS_W / 2 - GROUND_W / 2;
  const groundRight = CANVAS_W / 2 + GROUND_W / 2;
  return Math.max(groundLeft - margin, Math.min(groundRight + margin, x));
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
  private readonly pieceBag = new PieceBag();
  private lastSpawnedSrc: string | undefined; // 直前に出したキャラ(袋の詰め直しをまたいで連続しないようにする)
  private readonly groundAsset: GroundAsset;
  private assetsReady = false;

  private phase: EnginePhase = "home";
  private currentPlayer: Player = 1;
  private winner: Player | null = null;
  private stackedCount = 0;
  private currentBody: PieceBody | null = null;
  private settleCounter = 0;
  private dropElapsedFrames = 0;
  private hasStartedFalling = false;
  private aimElapsedMs = 0;
  private remainingSeconds = Math.ceil(AIM_TIME_LIMIT_MS / 1000);
  // 落とすキャラのランダム変更の残り回数(1試合につきプレイヤーごと)
  private rerollsRemaining: Record<Player, number> = { 1: REROLL_LIMIT, 2: REROLL_LIMIT };
  private heldDirection: -1 | 0 | 1 = 0; // -1: 左, 1: 右, 0: 停止
  private isRotating = false; // 回転操作中か
  private aimAngle = 0;
  private displayAngle = 0;
  private cameraOffsetY = 0; // タワーが高くなった分だけ画面全体を下にずらす(=カメラが上にスライドする)量
  private currentSpawnY = SPAWN_Y_BASE;
  private nextBodyId = 1; // 駒ごとの安定ID(オンライン対戦のスナップショット同期用)

  private isDraggingPiece = false;
  private dragStartClientX = 0;
  private dragStartPieceX = 0;
  private dragMoved = 0;

  // ---- オンライン対戦 ----
  private network: { role: RoomRole; sync: RoomSync } | null = null;
  private readonly networkUnsubs: Array<() => void> = [];
  private lastBroadcastAt = 0;
  // ゲスト側: ホストから届いた最新/直前のスナップショット(補間描画・UI表示に使う)
  private guestDisplay: {
    phase: EnginePhase;
    turnPlayer: Player;
    winner: Player | null;
    remainingSeconds: number;
    rerollsRemaining: number;
    currentPieceName: string;
    towerMoving: boolean;
    stackedCount: number;
  } | null = null;
  private guestPrevBodies: SnapshotBody[] = [];
  private guestLatestBodies: SnapshotBody[] = [];
  private guestLatestAt = 0;
  // ゲスト側: 自分の手番で狙っている駒。ホストの応答を待たず手元で動かし(往復の遅延をなくすため)、
  // 位置・角度だけをホストへ送る。角度はaimAngle/displayAngleをホストと同じ使い方で流用する。
  private guestAim: { id: number; src: string; x: number; y: number; dropped: boolean } | null = null;
  private lastAimSentAt = 0;
  private lastAimSent: { x: number; angle: number } | null = null;
  // ホスト側: ゲストから届いた狙い位置。currentBodyはここへ毎フレーム少しずつ寄せる
  private remoteAimTarget: { x: number; angle: number } | null = null;
  // 相手が在室しているか。ホストは不在の間ゲストの手番の制限時間を止めて入り直しを待つ
  private peerPresent = true;
  // ホスト側: 決着後に「もう一度」を押したプレイヤー。両者が揃ったら次の対戦を始める
  private rematchReady: Record<Player, boolean> = { 1: false, 2: false };

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
  private physicsAccumulatorMs = 0;
  private towerMoving = false; // 狙い中に、積んだ駒がまだ動いているか(EngineState.towerMoving)
  // ホスト側: 駒が動いている間に届いたゲストの「落とす」。止まった時点で実行する
  private pendingRemoteDrop: { x: number; angle: number } | null = null; // 描画フレームの経過時間のうち、まだ物理に反映していない分
  private disposed = false;

  private readonly listener: EngineStateListener;

  constructor(listener: EngineStateListener) {
    this.listener = listener;
    if (DEBUG_SHOW_COLLISION) (window as unknown as { towerEngine?: TowerBattleEngine }).towerEngine = this;
    this.engine.gravity.y = 0.3; // 落下速度をゆっくりめにする
    // ほぼ止まった駒は完全に固定(スリープ)させる。これがないと着地後も
    // 計算誤差レベルのごく僅かな揺れが収束しきらず、駒がじわじわにじみ続けてしまう。
    this.engine.enableSleeping = true;

    // 棒の場合は下側のトゲまで含めた形で当たり判定を作る。
    // パンの場合は画像の輪郭が用意できるまでの仮の当たり判定(四角、厚みを持たせてすり抜け防止)
    const groundSurfaceY = GROUND_Y - 10;
    this.ground = GROUND_STRAIGHT_BAR
      ? createSpikedBarBody()
      : Bodies.rectangle(CANVAS_W / 2, groundSurfaceY + 150, GROUND_W, 300, { ...PIECE_MATERIAL, isStatic: true });
    World.add(this.engine.world, [this.ground]);

    this.groundAsset = loadGroundImage(() => {
      if (!GROUND_STRAIGHT_BAR) this.replaceGroundBodyWithOutline();
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
    this.detachOnline();
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
    this.rematchReady = { 1: false, 2: false };
    // オンライン対戦は先攻/後攻を毎回ランダムに。ひとりで挑戦はプレイヤー1だけで続ける
    this.currentPlayer = this.network ? (Math.random() < 0.5 ? 1 : 2) : 1;
    this.winner = null;
    this.stackedCount = 0;
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
    if (this.network) {
      if (!this.isMyLocalTurn()) return;
      if (this.network.role === "guest") {
        if (this.guestAim && !this.guestAim.dropped) this.isRotating = true;
        return;
      }
    }
    this.doStartRotating();
  }

  stopRotating(): void {
    if (this.network?.role === "guest") {
      this.isRotating = false;
      return;
    }
    if (this.network && !this.isMyLocalTurn()) return;
    this.doStopRotating();
  }

  // 落とすキャラをランダムに変更する(今の手番プレイヤーが持つ残り回数の分だけ)
  rerollPiece(): void {
    if (this.network) {
      if (!this.isMyLocalTurn()) return;
      if (this.network.role === "guest") {
        this.sendGuestInput({ type: "reroll" });
        return;
      }
    }
    this.doReroll();
  }

  // オンライン対戦の決着後に「もう一度」を押した。相手も押すまで待ち、揃ったらホストが次の対戦を始める
  // (ゲストは押したことをホストに伝えるだけで、開始後の状態はスナップショットで届く)
  requestRematch(): void {
    if (!this.network || this.phase !== "gameover") return;
    if (this.network.role === "guest") {
      this.sendGuestInput({ type: "restart" });
      return;
    }
    this.markRematchReady(1);
  }

  // ホスト専用
  private markRematchReady(player: Player): void {
    this.rematchReady[player] = true;
    if (this.rematchReady[1] && this.rematchReady[2]) this.startBattle();
  }

  dropPiece(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    // 積んだ駒がまだ動いている間は落とせない(制限時間切れの自動落下も、止まるまで待つ)
    if (this.towerMoving) return;
    this.pendingRemoteDrop = null;
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

  // ---- オンライン対戦: 接続の開始/終了 ----

  // ホストとして接続する。以降、自分の(ローカルの)Matter.js演算結果を定期的に配信し、
  // ゲストからの入力を受け付ける。対戦の開始自体はこれまで通りstartBattle()を呼ぶ。
  attachOnlineHost(sync: RoomSync): void {
    this.detachOnline();
    this.network = { role: "host", sync };
    this.rematchReady = { 1: false, 2: false };
    this.networkUnsubs.push(sync.onRemoteInput((event) => this.applyRemoteInput(event)));
  }

  // ホストとして途中の対戦に入り直す。抜ける直前に配信していたスナップショットからワールドを組み立て直す。
  // (速度などは失われるが、スナップショットは止まった状態のタワーがほとんどなので見た目上の差は小さい)
  restoreOnlineHost(sync: RoomSync, snapshot: Snapshot): void {
    this.attachOnlineHost(sync);
    this.clearWorld();
    this.currentBody = null;
    for (const b of snapshot.bodies ?? []) {
      const piece = this.pieces.find((p) => p.src === b.src);
      if (!piece) continue;
      const isAiming = snapshot.phase === "aiming" && b.id === snapshot.currentBodyId;
      const body = this.createPieceBody(piece, b.id, b.x, b.y, b.angle);
      if (isAiming) {
        this.currentBody = body;
        this.currentSpawnY = b.y;
        this.aimAngle = b.angle;
        this.displayAngle = b.angle;
      } else {
        Body.setStatic(body, false);
        // 積み終わった駒は、置き直した瞬間の微小なずれで揺れないよう触れられるまで眠らせておく
        // (落下中の駒まで眠らせると空中で止まってしまうので、落下中に抜けた場合は起こしたままにする)
        Sleeping.set(body, snapshot.phase !== "dropping");
      }
      this.nextBodyId = Math.max(this.nextBodyId, b.id + 1);
    }
    this.currentPlayer = snapshot.turnPlayer;
    this.winner = snapshot.winner;
    this.stackedCount = snapshot.stackedCount ?? 0;
    this.rerollsRemaining = snapshot.rerollsByPlayer
      ? { 1: snapshot.rerollsByPlayer.p1, 2: snapshot.rerollsByPlayer.p2 }
      : { 1: REROLL_LIMIT, 2: REROLL_LIMIT };
    this.isRotating = false;
    this.heldDirection = 0;
    if (snapshot.phase === "gameover") {
      this.phase = "gameover";
      this.emit();
    } else if (snapshot.phase === "aiming" && this.currentBody) {
      this.phase = "aiming";
      this.aimElapsedMs = 0;
      this.remainingSeconds = Math.ceil(AIM_TIME_LIMIT_MS / 1000);
      this.emit();
    } else {
      // 落下中に抜けた/狙い中の駒を復元できなかった場合は、駒が落ち着くのを待ってから次の手番へ
      this.phase = "dropping";
      this.settleCounter = 0;
      this.dropElapsedFrames = 0;
      this.hasStartedFalling = true;
      this.emit();
    }
  }

  // 相手の在室状況を受け取る
  setPeerPresent(present: boolean): void {
    // ゲスト: ホストが抜けている間の操作(落とした等)はホストに届いていないため、
    // 入り直してきたら手元の狙いを捨て、届いたスナップショットの状態から狙い直す
    if (this.network?.role === "guest" && present && !this.peerPresent) this.guestAim = null;
    // ホスト: 抜けたゲストが押していた「もう一度」は無効にする(入り直したゲストは結果画面から押し直す)
    if (this.network?.role === "host" && !present) this.rematchReady[2] = false;
    this.peerPresent = present;
  }

  // ゲストとして接続する。以降、自前のMatter.js演算は行わず、ホストからのスナップショットを
  // 描画するだけになる。自分の手番の入力はホストへ送信する。
  attachOnlineGuest(sync: RoomSync): void {
    this.detachOnline();
    this.network = { role: "guest", sync };
    this.phase = "aiming";
    this.currentPlayer = 2;
    this.networkUnsubs.push(sync.onSnapshot((snapshot) => this.applySnapshot(snapshot)));
    this.emit();
  }

  // オンライン接続を切る(部屋そのものの退室処理はRoomSync側の責務)
  detachOnline(): void {
    this.networkUnsubs.forEach((off) => off());
    this.networkUnsubs.length = 0;
    this.network = null;
    this.guestDisplay = null;
    this.guestPrevBodies = [];
    this.guestLatestBodies = [];
    this.guestAim = null;
    this.lastAimSent = null;
    this.remoteAimTarget = null;
    this.peerPresent = true;
  }

  // ---- 内部: オンライン対戦 ----

  private localPlayer(): Player | null {
    if (!this.network) return null;
    return this.network.role === "host" ? 1 : 2;
  }

  private isMyLocalTurn(): boolean {
    const lp = this.localPlayer();
    return lp === null ? true : this.currentPlayer === lp;
  }

  private sendGuestInput(event: RemoteInputPayload): void {
    this.network?.sync.sendInput(event);
  }

  // ホスト専用: ゲストから届いた入力を、ローカル入力ハンドラが更新するのと同じ内部状態に適用する
  private applyRemoteInput(event: RemoteInputEvent): void {
    if (!this.network || this.network.role !== "host") return;
    switch (event.type) {
      case "aim":
        if (!this.isRemoteAimFor(event.id)) return;
        this.remoteAimTarget = { x: event.x, angle: event.angle };
        break;
      case "drop":
        if (!this.isRemoteAimFor(event.id) || !this.currentBody) return;
        // ゲストはスナップショットを見て、駒が動いている間は落とさない。ただし配信の遅れで行き違うことがあるので、
        // その場合は捨てずに預かっておき、止まった時点で落とす(ゲスト側はもう落とした扱いで操作を止めているため)
        this.pendingRemoteDrop = { x: event.x, angle: event.angle };
        this.applyPendingRemoteDrop();
        break;
      case "reroll":
        this.doReroll();
        break;
      case "restart":
        if (this.phase === "gameover") this.markRematchReady(2);
        break;
    }
  }

  // ホスト専用: 預かっているゲストの「落とす」を、ゲストの画面で狙っていた位置・角度ちょうどから実行する
  // (補間途中の位置で落とさない)。駒がまだ動いていれば何もせず、次のフレームで再度試す。
  private applyPendingRemoteDrop(): void {
    const drop = this.pendingRemoteDrop;
    if (!drop || !this.currentBody || this.towerMoving) return;
    Body.setPosition(this.currentBody, { x: drop.x, y: this.currentSpawnY });
    this.aimAngle = drop.angle;
    this.displayAngle = drop.angle;
    Body.setAngle(this.currentBody, drop.angle);
    this.dropPiece();
  }

  // ホスト専用: ゲストの手番で、いま狙い中の駒に対する操作か(駒の入れ替え前に送られた古い操作は捨てる)
  private isRemoteAimFor(id: number): boolean {
    return this.phase === "aiming" && this.currentPlayer === 2 && this.currentBody?.plugin.id === id;
  }

  // ホスト専用: ゲストの手番の間、狙い中の駒をゲストから届いた位置・角度へ滑らかに寄せる
  private followRemoteAim(body: PieceBody): void {
    const target = this.remoteAimTarget;
    if (!target) return;
    const x = body.position.x + (target.x - body.position.x) * REMOTE_AIM_SMOOTHING;
    Body.setPosition(body, { x, y: this.currentSpawnY });
    this.displayAngle += (target.angle - this.displayAngle) * REMOTE_AIM_SMOOTHING;
    this.aimAngle = this.displayAngle;
    Body.setAngle(body, this.displayAngle);
  }

  // ホスト専用: 一定間隔でワールドの状態をゲストへ配信する
  private broadcastIfDue(now: number): void {
    if (!this.network || this.network.role !== "host") return;
    if (now - this.lastBroadcastAt < NETWORK_BROADCAST_INTERVAL_MS) return;
    this.lastBroadcastAt = now;

    const bodies: SnapshotBody[] = Composite.allBodies(this.engine.world)
      .filter((b): b is PieceBody => b !== this.ground)
      .map((b) => ({ id: b.plugin.id, src: b.plugin.piece.src, x: b.position.x, y: b.position.y, angle: b.angle }));

    this.network.sync.sendSnapshot({
      phase: this.phase,
      turnPlayer: this.currentPlayer,
      winner: this.winner,
      remainingSeconds: this.remainingSeconds,
      rerollsRemaining: this.rerollsRemaining[this.currentPlayer],
      rerollsByPlayer: { p1: this.rerollsRemaining[1], p2: this.rerollsRemaining[2] },
      currentPieceName: this.currentBody?.plugin.piece.name ?? "",
      towerMoving: this.towerMoving,
      stackedCount: this.stackedCount,
      currentBodyId: this.phase === "aiming" ? (this.currentBody?.plugin.id ?? null) : null,
      bodies,
    });
  }

  // ゲスト専用: 受信したスナップショットを表示用状態に反映する
  private applySnapshot(snapshot: Snapshot): void {
    this.guestDisplay = {
      phase: snapshot.phase,
      turnPlayer: snapshot.turnPlayer,
      winner: snapshot.winner,
      remainingSeconds: snapshot.remainingSeconds,
      rerollsRemaining: snapshot.rerollsRemaining,
      currentPieceName: snapshot.currentPieceName,
      towerMoving: snapshot.towerMoving ?? false,
      stackedCount: snapshot.stackedCount ?? 0,
    };
    this.phase = snapshot.phase;
    this.currentPlayer = snapshot.turnPlayer;
    this.winner = snapshot.winner;

    this.guestPrevBodies = this.guestLatestBodies;
    this.guestLatestBodies = snapshot.bodies;
    this.guestLatestAt = performance.now();
    this.syncGuestAim(snapshot);
    this.emit();
  }

  // ゲスト専用: 自分の手番で新しい駒が来たら、手元で動かす狙いの状態をその駒で初期化する。
  // 同じ駒の間はホストから届く(自分が送った分だけ遅れた)位置で上書きしない。
  private syncGuestAim(snapshot: Snapshot): void {
    const id = snapshot.phase === "aiming" && snapshot.turnPlayer === 2 ? snapshot.currentBodyId : null;
    if (id === null) {
      this.guestAim = null;
      this.isRotating = false;
      this.heldDirection = 0;
      this.isDraggingPiece = false;
      return;
    }
    if (this.guestAim?.id === id) return;
    const body = snapshot.bodies.find((b) => b.id === id);
    if (!body) return;
    this.guestAim = { id, src: body.src, x: body.x, y: body.y, dropped: false };
    this.aimAngle = body.angle;
    this.displayAngle = body.angle;
    this.isDraggingPiece = false;
    this.lastAimSent = null;
  }

  // ゲスト専用: 手元の狙いを毎フレーム進め、一定間隔でホストへ送る
  private updateGuestAim(now: number): void {
    const aim = this.guestAim;
    if (!aim || aim.dropped) return;
    if (this.isRotating) this.aimAngle += ROTATE_HOLD_SPEED;
    this.displayAngle += (this.aimAngle - this.displayAngle) * ROTATE_SMOOTHING;
    if (Math.abs(this.aimAngle - this.displayAngle) < 0.001) this.displayAngle = this.aimAngle;
    aim.x = this.clampGuestAimX(aim.x + this.heldDirection * MOVE_SPEED);

    if (now - this.lastAimSentAt < NETWORK_BROADCAST_INTERVAL_MS) return;
    if (this.lastAimSent && this.lastAimSent.x === aim.x && this.lastAimSent.angle === this.displayAngle) return;
    this.lastAimSentAt = now;
    this.lastAimSent = { x: aim.x, angle: this.displayAngle };
    this.sendGuestInput({ type: "aim", id: aim.id, x: aim.x, angle: this.displayAngle });
  }

  private clampGuestAimX(x: number): number {
    const piece = this.guestAim && this.pieces.find((p) => p.src === this.guestAim?.src);
    const margin = piece ? this.pieceHorizontalMarginFor(piece, this.displayAngle) : FALLBACK_MARGIN;
    return clampAimX(x, margin);
  }

  // ゲスト専用: 手元で狙っていた位置・角度をそのまま添えて落とす
  private guestDrop(): void {
    const aim = this.guestAim;
    if (!aim || aim.dropped) return;
    if (this.guestDisplay?.towerMoving) return; // 積んだ駒がまだ動いている間は落とせない
    aim.dropped = true;
    this.isRotating = false;
    this.heldDirection = 0;
    this.sendGuestInput({ type: "drop", id: aim.id, x: aim.x, angle: this.displayAngle });
  }

  // ゲスト専用: 直近2回分のスナップショットの間を補間した位置を返す(20Hz更新でも滑らかに見せるため)
  private guestInterpolatedBodies(): SnapshotBody[] {
    const t = Math.max(0, Math.min(1, (performance.now() - this.guestLatestAt) / NETWORK_BROADCAST_INTERVAL_MS));
    const prevById = new Map(this.guestPrevBodies.map((b) => [b.id, b] as const));
    const aim = this.guestAim;
    return this.guestLatestBodies.map((cur) => {
      const prev = prevById.get(cur.id);
      // 自分が狙い中の駒は、ホストからの(遅れた)位置ではなく手元の狙いで描く
      if (aim && cur.id === aim.id) return { id: cur.id, src: cur.src, x: aim.x, y: aim.y, angle: this.displayAngle };
      if (!prev) return cur; // 直前のスナップショットに無い(=新しく出現した)駒はそのまま表示
      return {
        id: cur.id,
        src: cur.src,
        x: prev.x + (cur.x - prev.x) * t,
        y: prev.y + (cur.y - prev.y) * t,
        angle: prev.angle + (cur.angle - prev.angle) * t,
      };
    });
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
    if (this.network?.role === "guest" && this.guestDisplay) {
      this.listener({ ...this.guestDisplay, assetsReady: this.assetsReady });
      return;
    }
    this.listener({
      phase: this.phase,
      turnPlayer: this.currentPlayer,
      winner: this.winner,
      remainingSeconds: this.remainingSeconds,
      rerollsRemaining: this.rerollsRemaining[this.currentPlayer],
      assetsReady: this.assetsReady,
      currentPieceName: this.currentBody?.plugin.piece.name ?? "",
      towerMoving: this.towerMoving,
      stackedCount: this.stackedCount,
    });
  }

  // ---- 内部: ワールド操作 ----

  private clearWorld(): void {
    const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
    bodies.forEach((b) => World.remove(this.engine.world, b));
    this.cameraOffsetY = 0; // 新しいタワーの開始時だけカメラを土台の位置に戻す
  }

  private replaceGroundBodyWithOutline(): void {
    const outline = this.groundAsset.outline;
    if (!outline) return;
    const groundX = CANVAS_W / 2 - GROUND_W / 2;
    const groundBarY = GROUND_Y - 10;
    const worldX = groundX - outline.imageOffsetX;
    const worldY = groundBarY - outline.imageOffsetY;

    // 輪郭どおりの当たり判定にする。
    // isStaticは作成後に設定する: 最初から静的にすると、Matterが複合ボディの中心を面積で重み付けせずに
    // 求めてしまい、当たり判定が描画(面積重心基準)から約2pxずれる。
    const shapedGround = bodyFromConvexParts(worldX, worldY, outline.convexParts, PIECE_MATERIAL);
    Body.setStatic(shapedGround, true);
    World.remove(this.engine.world, this.ground);
    World.add(this.engine.world, shapedGround);
    this.ground = shapedGround;
  }

  // タワーの一番高い場所に合わせてスポーン位置を決める(タワーが空ならSPAWN_Y_BASE)。
  // 上限を設けず青天井で上げる: これより上には出さないという下限クランプを入れると、
  // タワーがそれを追い越した時にスポーン位置と山が画面上で重なってしまう。
  // 代わりに、画面に収まらなくなった分はcomputeTargetViewScaleが自動でズームアウトして吸収する。
  private computeSpawnY(): number {
    const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
    if (bodies.length === 0) return SPAWN_Y_BASE;
    const towerTopY = Math.min(...bodies.map((b) => b.bounds.min.y));
    return Math.min(SPAWN_Y_BASE, towerTopY - SPAWN_CLEARANCE);
  }

  // 駒の物理ボディを(静止状態で)作ってワールドに追加する
  private createPieceBody(piece: Piece, id: number, x: number, y: number, angle = 0): PieceBody {
    let body: Matter.Body;
    if (piece.hullLocal) {
      // 写真の不透明部分を包む凸包を当たり判定にする(見えない四角の余白をなくす)
      // 分割済みの凸多角形から作る(Matter標準の分割は形によって失敗するため。decompose.ts参照)
      body = bodyFromConvexParts(x, y, piece.convexParts ?? decomposeToConvex(piece.hullLocal), PIECE_MATERIAL);
      // setStatic(true)が元の慣性モーメントを退避するので、それより前に直しておく
      applyCompoundInertia(body);
    } else {
      // 画像の読み込み・輪郭計算がまだ終わっていない場合の一時的なフォールバック
      const fallbackHeight = PIECE_HEIGHT * piece.sizeScale;
      body = Bodies.rectangle(x, y, fallbackHeight * 0.6, fallbackHeight, PIECE_MATERIAL);
    }
    if (angle !== 0) Body.setAngle(body, angle);
    // Matter標準の自動スリープは使わない(sleepThreshold=0で無効化)。代わりにupdateSleeping()で眠らせる。
    // 眠っている駒が他の駒に触れられた時に起きる処理(Matter側)はそのまま効く。
    body.sleepThreshold = 0;
    Body.setStatic(body, true);
    body.plugin = { piece, id };
    World.add(this.engine.world, body);
    return body as PieceBody;
  }

  private spawnPiece(): void {
    this.currentSpawnY = this.computeSpawnY();
    const piece = this.pieceBag.next(this.pieces, this.lastSpawnedSrc);
    this.lastSpawnedSrc = piece.src;
    this.currentBody = this.createPieceBody(piece, this.nextBodyId++, CANVAS_W / 2, this.currentSpawnY);
    this.aimAngle = 0;
    this.displayAngle = 0;
    this.isRotating = false;
    this.remoteAimTarget = null;
    this.pendingRemoteDrop = null;
    this.towerMoving = false; // 次の刻みでupdateTowerMovingが改めて判定する
    this.aimElapsedMs = 0;
    this.remainingSeconds = Math.ceil(AIM_TIME_LIMIT_MS / 1000);
    this.emit();
  }

  // 落とした駒が落ち着いた(=積めた)時に呼ばれる
  private nextTurn(): void {
    this.stackedCount++;
    if (this.network) this.currentPlayer = this.currentPlayer === 1 ? 2 : 1;
    this.phase = "aiming";
    this.spawnPiece();
  }

  private endGame(loserPlayer: Player): void {
    this.phase = "gameover";
    this.winner = loserPlayer === 1 ? 2 : 1;
    this.emit();
  }

  private doStartRotating(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    this.isRotating = true;
  }

  private doStopRotating(): void {
    this.isRotating = false;
  }

  private doReroll(): void {
    if (this.phase !== "aiming" || !this.currentBody) return;
    if (this.rerollsRemaining[this.currentPlayer] <= 0) return;

    const previousSrc = this.currentBody.plugin.piece.src;
    const x = this.currentBody.position.x;
    World.remove(this.engine.world, this.currentBody);

    // 変更前と同じキャラは引き直さない
    const piece = this.pieceBag.next(this.pieces, previousSrc);
    this.lastSpawnedSrc = piece.src;

    this.currentBody = this.createPieceBody(piece, this.nextBodyId++, x, this.currentSpawnY);
    this.aimAngle = 0;
    this.displayAngle = 0;
    this.remoteAimTarget = null;
    this.pendingRemoteDrop = null;

    // キャラごとに横幅が違うため、変更後の駒を動かせる範囲の中へ収め直す
    const margin = this.pieceHorizontalMargin(this.currentBody);
    const clampedX = clampAimX(x, margin);
    Body.setPosition(this.currentBody, { x: clampedX, y: this.currentSpawnY });

    this.rerollsRemaining[this.currentPlayer]--;
    this.emit();
  }

  // ---- 内部: 物理ヘルパー ----

  private getDynamicBodies(): Matter.Body[] {
    return Composite.allBodies(this.engine.world).filter((b) => !b.isStatic);
  }

  // 生のbody.velocityは1サブステップ分の移動量なので、必ず正規化済みの値で読み書きする
  private capFallSpeed(): void {
    this.getDynamicBodies().forEach((b) => {
      const v = Body.getVelocity(b);
      if (v.y > MAX_FALL_SPEED) {
        Body.setVelocity(b, { x: v.x, y: MAX_FALL_SPEED });
      }
      const w = Body.getAngularVelocity(b);
      if (Math.abs(w) > MAX_ANGULAR_SPEED) {
        Body.setAngularVelocity(b, Math.sign(w) * MAX_ANGULAR_SPEED);
      }
    });
  }

  // 接触中の駒の回転を少し弱める(サブステップごとに呼ぶ。詳しくはconstants.tsのCONTACT_ANGULAR_DAMPING)
  // 弱めるのは「重力に逆らって起き上がる向き」に回っている時と、重心が接地点の範囲の真上にある時だけ。
  // 重心が支えからはみ出して重力の向きに倒れていく回転まで弱めると、倒れる動きがスローモーションのようになる。
  private readonly contactDampingPerSubstep = Math.pow(1 - CONTACT_ANGULAR_DAMPING, 1 / PHYSICS_SUBSTEPS);
  private dampContactRotation(): void {
    // 駒ごとの、今触れている接地点の左右の範囲
    const supports = new Map<Matter.Body, { minX: number; maxX: number }>();
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue;
      for (const body of [pair.bodyA.parent, pair.bodyB.parent]) {
        if (body.isStatic || body.isSleeping) continue;
        let range = supports.get(body);
        if (!range) {
          range = { minX: Infinity, maxX: -Infinity };
          supports.set(body, range);
        }
        for (let i = 0; i < pair.contactCount; i++) {
          const x = pair.contacts[i].vertex.x;
          if (x < range.minX) range.minX = x;
          if (x > range.maxX) range.maxX = x;
        }
      }
    }
    supports.forEach((range, b) => {
      // 重力が駒を回そうとする向き(画面座標はy下向きなので、重心が支点より右なら時計回り=正)
      const gravityTurn = b.position.x > range.maxX ? 1 : b.position.x < range.minX ? -1 : 0;
      const w = Body.getAngularVelocity(b);
      if (gravityTurn * w > 0) return; // 重力の向きに倒れていく途中
      Body.setAngularVelocity(b, w * this.contactDampingPerSubstep);
    });
  }

  // 一定時間ほとんど動いていない駒だけを眠らせる(物理の1刻みごとに1回呼ぶ)。
  // 基準の姿勢から一定距離以上動いたら、そこを新しい基準にして数え直す。
  // さらに、重心が「その間に触れていた接地点の左右の範囲」の真上にある時だけ眠らせる。
  // 片足で着地して倒れ始める直前は、ほとんど動かない瞬間があるため動いた距離だけでは見分けられず、
  // 本来は倒れるはずの傾きのまま固定されてしまう。重心が支えからはみ出していれば、放っておけば必ず倒れる。
  // 接地点は1刻みごとに1点になったり2点になったりちらつくので、見守っている間の全刻みの分をまとめて範囲をとる。
  private readonly sleepTrackers = new WeakMap<
    Matter.Body,
    { x: number; y: number; angle: number; frames: number; supportMinX: number; supportMaxX: number }
  >();
  private updateSleeping(): void {
    const bodies = this.getDynamicBodies();
    // 見守りをやり直した刻みの接地点は範囲に入れない(着地の瞬間などに一瞬だけ触れた点まで支えとみなしてしまうため)
    const justReset = new Set<Matter.Body>();
    for (const b of bodies) {
      if (b.isSleeping) {
        // 他の駒に当たって起こされた時に、眠る前の記録のまま即座に眠り直さないよう消しておく
        this.sleepTrackers.delete(b);
        continue;
      }
      const t = this.sleepTrackers.get(b);
      const moved = t
        ? Math.max(Math.hypot(b.position.x - t.x, b.position.y - t.y), Math.abs(b.angle - t.angle) * bodyRadius(b))
        : Infinity;
      if (!t || moved > SLEEP_DISPLACEMENT_TOL) {
        this.sleepTrackers.set(b, {
          x: b.position.x,
          y: b.position.y,
          angle: b.angle,
          frames: 0,
          supportMinX: Infinity,
          supportMaxX: -Infinity,
        });
        justReset.add(b);
      }
    }

    // 見守り中の駒ごとに、今触れている接地点の左右の範囲を広げる
    for (const pair of this.engine.pairs.list) {
      if (!pair.isActive) continue;
      for (const body of [pair.bodyA.parent, pair.bodyB.parent]) {
        const t = this.sleepTrackers.get(body);
        if (!t || body.isSleeping || justReset.has(body)) continue;
        for (let i = 0; i < pair.contactCount; i++) {
          const x = pair.contacts[i].vertex.x;
          if (x < t.supportMinX) t.supportMinX = x;
          if (x > t.supportMaxX) t.supportMaxX = x;
        }
      }
    }

    for (const b of bodies) {
      const t = this.sleepTrackers.get(b);
      if (!t || b.isSleeping || justReset.has(b)) continue;
      t.frames++;
      if (t.frames < SLEEP_FRAMES_NEEDED) continue;
      if (b.position.x >= t.supportMinX && b.position.x <= t.supportMaxX) {
        Sleeping.set(b, true);
      } else {
        // 重心が支えの外にある: 倒れ始めの途中なので眠らせず、見守りをやり直す
        this.sleepTrackers.delete(b);
      }
    }
  }

  private checkFallen(): boolean {
    return this.getDynamicBodies().some((b) => b.position.y > FALL_Y);
  }

  private maxBodySpeed(): number {
    return this.getDynamicBodies().reduce((max, b) => Math.max(max, bodyMotion(b)), 0);
  }

  private checkSettled(): boolean {
    return this.maxBodySpeed() < SETTLE_SPEED_EPS;
  }

  // 狙い中に、積んだ駒が動いているかを更新する(変わった時だけ画面へ通知)。
  // 着地後に一度止まったタワーが、時間差で傾き始めたり崩れ始めたりすることがあるため毎刻み見る。
  // 動き出したらすぐに止めるが、止まった判定はしばらく静止が続いてから(しきい値付近で表示がちらつかないように)。
  private towerStillTicks = 0;
  private updateTowerMoving(): void {
    const settled = this.phase !== "aiming" || this.checkSettled();
    this.towerStillTicks = settled ? this.towerStillTicks + 1 : 0;
    const moving = this.towerMoving ? this.towerStillTicks < SETTLE_FRAMES_NEEDED : !settled;
    if (moving === this.towerMoving) return;
    this.towerMoving = moving;
    this.emit();
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
    if (!piece) return FALLBACK_MARGIN;
    return this.pieceHorizontalMarginFor(piece, body.angle);
  }

  private pieceHorizontalMarginFor(piece: Piece, angle: number): number {
    if (!piece.ready) return FALLBACK_MARGIN;
    const { imageOffsetX: left, imageOffsetY: top, w, h } = piece;
    const corners = [
      { x: left, y: top },
      { x: left + w, y: top },
      { x: left, y: top + h },
      { x: left + w, y: top + h },
    ];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    let maxAbsX = 0;
    corners.forEach((c) => {
      const rx = c.x * cos - c.y * sin;
      maxAbsX = Math.max(maxAbsX, Math.abs(rx));
    });
    return maxAbsX;
  }

  private handlePointerDown = (e: PointerEvent): void => {
    if (this.network?.role === "guest") return this.guestHandlePointerDown(e);
    if (this.network && !this.isMyLocalTurn()) return;
    if (this.phase !== "aiming" || !this.currentBody || !this.canvas) return;
    this.isDraggingPiece = true;
    this.dragStartClientX = e.clientX;
    this.dragStartPieceX = this.currentBody.position.x;
    this.dragMoved = 0;
    this.canvas.setPointerCapture(e.pointerId);
  };

  private handlePointerMove = (e: PointerEvent): void => {
    if (this.network?.role === "guest") return this.guestHandlePointerMove(e);
    if (this.network && !this.isMyLocalTurn()) return;
    if (!this.isDraggingPiece || this.phase !== "aiming" || !this.currentBody) return;
    const deltaX = (e.clientX - this.dragStartClientX) * this.canvasScale();
    this.dragMoved = Math.max(this.dragMoved, Math.abs(e.clientX - this.dragStartClientX));
    let x = this.dragStartPieceX + deltaX;
    const margin = this.pieceHorizontalMargin(this.currentBody);
    x = clampAimX(x, margin);
    Body.setPosition(this.currentBody, { x, y: this.currentSpawnY });
  };

  private handlePointerUp = (): void => {
    if (this.network?.role === "guest") return this.guestHandlePointerUp();
    if (this.network && !this.isMyLocalTurn()) {
      this.isDraggingPiece = false;
      return;
    }
    if (this.isDraggingPiece && this.dragMoved <= TAP_MAX_DISTANCE) this.dropPiece();
    this.isDraggingPiece = false;
  };

  private handlePointerCancel = (): void => {
    this.isDraggingPiece = false;
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (this.network?.role === "guest") return this.guestHandleKeyDown(e);
    if (this.network && !this.isMyLocalTurn()) return;
    if (e.code === "ArrowLeft") this.heldDirection = -1;
    if (e.code === "ArrowRight") this.heldDirection = 1;
    if (e.code === "Space" || e.code === "ArrowDown") {
      e.preventDefault();
      this.dropPiece();
    }
    if (e.code === "KeyE") this.startRotating();
  };

  private handleKeyUp = (e: KeyboardEvent): void => {
    if (this.network?.role === "guest") return this.guestHandleKeyUp(e);
    if (this.network && !this.isMyLocalTurn()) return;
    if (e.code === "ArrowLeft" && this.heldDirection === -1) this.heldDirection = 0;
    if (e.code === "ArrowRight" && this.heldDirection === 1) this.heldDirection = 0;
    if (e.code === "KeyE") this.stopRotating();
  };

  // ---- 内部: 入力(ゲスト側。狙い中の駒を手元で動かし、結果はupdateGuestAimがホストへ送る) ----

  private guestHandlePointerDown(e: PointerEvent): void {
    if (!this.guestAim || this.guestAim.dropped || !this.canvas) return;
    this.isDraggingPiece = true;
    this.dragStartClientX = e.clientX;
    this.dragStartPieceX = this.guestAim.x;
    this.dragMoved = 0;
    this.canvas.setPointerCapture(e.pointerId);
  }

  private guestHandlePointerMove(e: PointerEvent): void {
    if (!this.isDraggingPiece || !this.guestAim || this.guestAim.dropped) return;
    const deltaX = (e.clientX - this.dragStartClientX) * this.canvasScale();
    this.dragMoved = Math.max(this.dragMoved, Math.abs(e.clientX - this.dragStartClientX));
    this.guestAim.x = this.clampGuestAimX(this.dragStartPieceX + deltaX);
  }

  private guestHandlePointerUp(): void {
    if (!this.isDraggingPiece) return;
    this.isDraggingPiece = false;
    if (this.dragMoved <= TAP_MAX_DISTANCE) this.guestDrop();
  }

  private guestHandleKeyDown(e: KeyboardEvent): void {
    if (!this.guestAim || this.guestAim.dropped) return;
    if (e.code === "ArrowLeft") this.heldDirection = -1;
    if (e.code === "ArrowRight") this.heldDirection = 1;
    if (e.code === "Space" || e.code === "ArrowDown") {
      e.preventDefault();
      this.guestDrop();
    }
    if (e.code === "KeyE") this.startRotating();
  }

  private guestHandleKeyUp(e: KeyboardEvent): void {
    if (e.code === "ArrowLeft" && this.heldDirection === -1) this.heldDirection = 0;
    if (e.code === "ArrowRight" && this.heldDirection === 1) this.heldDirection = 0;
    if (e.code === "KeyE") this.stopRotating();
  }

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
  // キャンバス上端(y=0)より外に出そうな分だけ画面全体を下にずらす量(=カメラを上にスライドさせる量)を求める。
  // 縮小はせず平行移動だけなので、タワーが高くなるほど土台は画面下から見切れていってよい。
  private computeTargetCameraOffsetY(): number {
    let minY = Infinity;
    if (this.network?.role === "guest") {
      // ゲスト側はMatter bodyを持たないため、受信済みの座標(中心y)から近似する
      this.guestLatestBodies.forEach((b) => {
        if (b.y < minY) minY = b.y;
      });
    } else {
      const bodies = Composite.allBodies(this.engine.world).filter((b) => b !== this.ground);
      bodies.forEach((b) => {
        if (b.bounds.min.y < minY) minY = b.bounds.min.y;
      });
      if (this.currentBody && this.currentBody.bounds.min.y < minY) minY = this.currentBody.bounds.min.y;
    }
    if (!isFinite(minY)) return 0;

    return Math.max(0, VIEW_TOP_MARGIN - minY);
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

  // ゲスト側: 受信したスナップショットの1駒分を描画する(drawBodyのMatter.Body版に相当)
  private drawGuestBody(b: SnapshotBody): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const piece = this.pieces.find((p) => p.src === b.src);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.angle);

    if (piece?.ready) {
      ctx.drawImage(piece.img, piece.imageOffsetX, piece.imageOffsetY, piece.w, piece.h);
    } else {
      ctx.fillStyle = "rgba(74, 66, 55, 0.15)";
      ctx.fillRect(-PIECE_HEIGHT * 0.3, -PIECE_HEIGHT / 2, PIECE_HEIGHT * 0.6, PIECE_HEIGHT);
    }

    ctx.restore();
  }

  private drawGround(ctx: CanvasRenderingContext2D): void {
    const groundX = CANVAS_W / 2 - GROUND_W / 2;
    const groundBarY = GROUND_Y - 10;
    const groundImage = this.groundAsset.image;
    if (GROUND_STRAIGHT_BAR) {
      // 上面は平らなまま、下側だけトゲトゲにした一筆書きの形で塗る。
      // 両端は棒の側面を作らず、上の角から直接トゲの先端へ斜めに下ろして三角形にする
      const barBottomY = groundBarY + GROUND_BAR_THICKNESS;
      ctx.fillStyle = "#f07d1a";
      ctx.beginPath();
      ctx.moveTo(groundX, groundBarY);
      ctx.lineTo(groundX + GROUND_W, groundBarY);
      for (let i = GROUND_SPIKES.length - 1; i >= 0; i--) {
        const spike = GROUND_SPIKES[i];
        ctx.lineTo(groundX + spike.tipX, barBottomY + spike.height);
        if (i > 0) ctx.lineTo(groundX + spike.startX, barBottomY);
      }
      ctx.closePath(); // 左端のトゲの先端から左上の角へ戻る
      ctx.fill();
    } else if (this.groundAsset.ready && this.groundAsset.outline) {
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
      ctx.fillStyle = "#f07d1a";
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

    // タワーが上端に近づいたら、その分だけカメラを上にスライドさせる(土台は下に見切れてよい)。
    // 一度上げたカメラは、駒が倒れて一時的にタワーの最高点が下がった時などにも
    // 下に戻さない(片道): 新しいタワーを始める時はclearWorld側でリセットする。
    const targetOffsetY = Math.max(this.cameraOffsetY, this.computeTargetCameraOffsetY());
    this.cameraOffsetY += (targetOffsetY - this.cameraOffsetY) * VIEW_PAN_SMOOTHING;
    if (Math.abs(targetOffsetY - this.cameraOffsetY) < 0.001) this.cameraOffsetY = targetOffsetY;

    ctx.save();
    ctx.translate(0, this.cameraOffsetY);

    this.drawGround(ctx);

    if (this.phase !== "home") {
      if (this.network?.role === "guest") {
        this.guestInterpolatedBodies().forEach((b) => this.drawGuestBody(b));
      } else {
        Composite.allBodies(this.engine.world)
          .filter((b): b is PieceBody => b !== this.ground)
          .forEach((b) => this.drawBody(b));
      }
    }

    if (DEBUG_SHOW_COLLISION && this.network?.role !== "guest") this.drawCollisionShapes(ctx);

    ctx.restore();
  }

  // デバッグ用(URLに?debugを付けた時だけ): 当たり判定の形(分割後の各凸形)を線で重ねて描く
  private drawCollisionShapes(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.lineWidth = 0.6;
    Composite.allBodies(this.engine.world).forEach((b) => {
      const parts = b.parts.length > 1 ? b.parts.slice(1) : [b];
      ctx.strokeStyle = b.isSleeping ? "rgba(255,160,0,0.9)" : "rgba(0,200,255,0.9)";
      parts.forEach((part) => {
        ctx.beginPath();
        part.vertices.forEach((v, i) => (i === 0 ? ctx.moveTo(v.x, v.y) : ctx.lineTo(v.x, v.y)));
        ctx.closePath();
        ctx.stroke();
      });
      ctx.fillStyle = "red";
      ctx.fillRect(b.position.x - 1, b.position.y - 1, 2, 2); // 重心
    });
    ctx.restore();
  }

  // 物理を1刻み(PHYSICS_TICK_MS)だけ進め、落下・着地の判定をする
  private stepPhysicsTick(): void {
    // 1刻み分をまとめて1回で計算すると、高速で落ちた駒が着地の瞬間に
    // 大きくめり込んでから補正で戻る=「少し沈む」ように見える。
    // 同じ時間を細かく分けて計算することで、見た目の速さは変えずにめり込みを防ぐ。
    const substepDelta = PHYSICS_TICK_MS / PHYSICS_SUBSTEPS;
    for (let i = 0; i < PHYSICS_SUBSTEPS; i++) {
      Engine.update(this.engine, substepDelta);
      this.capFallSpeed();
      this.dampContactRotation();
    }
    this.updateSleeping();

    this.updateTowerMoving();
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

  // ---- メインループ ----

  private loop = (now: number): void => {
    if (this.disposed) return;
    const delta = Math.min(33, now - this.lastTime);
    this.lastTime = now;

    if (this.network?.role === "guest") {
      // ゲストは物理演算を一切行わない。自分の狙い中の駒だけ手元で動かし、残りは受信済みのスナップショットを描画する。
      this.updateGuestAim(now);
      this.render();
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    if (this.phase === "aiming" || this.phase === "dropping") {
      if (this.phase === "aiming" && this.currentBody) {
        if (this.network?.role === "host" && this.currentPlayer === 2) {
          // ゲストの手番: 駒はゲストの手元で動いているので、届いた位置・角度に追従させるだけ。
          // 「落とす」を預かっている間は、駒が止まるのを待って落とす
          if (this.pendingRemoteDrop) this.applyPendingRemoteDrop();
          else this.followRemoteAim(this.currentBody);
        } else {
          let x = this.currentBody.position.x + this.heldDirection * MOVE_SPEED;
          const margin = this.pieceHorizontalMargin(this.currentBody);
          x = clampAimX(x, margin);
          Body.setPosition(this.currentBody, { x, y: this.currentSpawnY });

          if (this.isRotating) this.aimAngle += ROTATE_HOLD_SPEED;

          // 目標角へ少しずつ近づけて回転を滑らかにする
          this.displayAngle += (this.aimAngle - this.displayAngle) * ROTATE_SMOOTHING;
          if (Math.abs(this.aimAngle - this.displayAngle) < 0.001) this.displayAngle = this.aimAngle;
          Body.setAngle(this.currentBody, this.displayAngle);
        }

        // 制限時間の消化。表示は秒単位(切り上げ)だが、値が変わった時だけemitしてReactの再描画を抑える。
        // オンラインでゲストが抜けている間のゲストの手番は、入り直してくるまで時間を止める。
        const waitingForGuest = this.network?.role === "host" && this.currentPlayer === 2 && !this.peerPresent;
        if (!waitingForGuest) this.aimElapsedMs += delta;
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

      // 物理は描画のフレームレートに関係なく、常に60fps相当の一定の時間刻みで進める。
      // 経過時間から刻みを決めると、30fps以下の端末では1回の刻みが倍以上になって接地の計算が荒くなり、
      // 真っすぐ落とした駒が左右の足を交互につきながら横へ歩き続けてしまう(止まらずに土台から落ちる)。
      this.physicsAccumulatorMs += delta;
      while (this.physicsAccumulatorMs >= PHYSICS_TICK_MS && (this.phase === "aiming" || this.phase === "dropping")) {
        this.physicsAccumulatorMs -= PHYSICS_TICK_MS;
        this.stepPhysicsTick();
      }
    } else {
      this.physicsAccumulatorMs = 0;
    }

    this.render();
    this.broadcastIfDue(now);
    this.rafId = requestAnimationFrame(this.loop);
  };
}

export function playerName(player: Player): string {
  return PLAYER_NAMES[player];
}
