// ゲーム全体の設定値。挙動を変えたい時はここだけを触ればよいようにまとめてある。

export const CANVAS_W = 380;
export const CANVAS_H = 640;
export const GROUND_Y = 380; // パン画像が縦長なため、下端が見切れないよう少し上に配置
export const GROUND_W = 320; // 土台の幅。高さは画像の縦横比から自動計算されるのでここだけ調整すればよい
// trueの間は土台をパン画像ではなく、まっすぐな棒にする(お試し用)。falseに戻せばパンに戻る
export const GROUND_STRAIGHT_BAR = true;
export const GROUND_BAR_THICKNESS = 10; // 棒の厚み
// 棒の下側に並べるトゲ(見た目だけで当たり判定はない)。一度ランダムに作った形をずっと使う。
// startXは棒の左端からのトゲの根元、tipXは先端の位置、heightは棒の下端から先端までの長さ
export const GROUND_SPIKES: readonly { startX: number; tipX: number; height: number }[] = [
  { startX: 0, tipX: 18, height: 11 },
  { startX: 34, tipX: 47, height: 9 },
  { startX: 67, tipX: 85, height: 16 },
  { startX: 97, tipX: 121, height: 8 },
  { startX: 138, tipX: 153, height: 14 },
  { startX: 179, tipX: 195, height: 12 },
  { startX: 211, tipX: 227, height: 16 },
  { startX: 242, tipX: 261, height: 12 },
  { startX: 277, tipX: 302, height: 14 },
];

// タワーが空の時は低い位置から、積み上がるにつれて自動でスポーン位置を上げる
export const SPAWN_Y_BASE = 250; // タワーが空の時のスポーン高さ
export const SPAWN_CLEARANCE = 100; // タワーの一番高い場所からこの分だけ上に確保する

export const MOVE_SPEED = 4.5; // px / frame
// 速度に関する値はすべてMatterの正規化単位(60fps基準の「px/フレーム」「rad/フレーム」)。
// 物理をサブステップに分けて計算しているため、body.velocity等の生の値(=1サブステップ分の移動量)で
// 比べると単位がずれる。必ずBody.getSpeed等の正規化済みの値で比べること。
export const SETTLE_FRAMES_NEEDED = 30; // 約0.5秒(60fps)
// 駒の「動きの大きさ」は、重心の速さと、回転による駒の端の速さ(角速度×半径)の大きい方で測る。
// 角速度そのもので比べると、大きな駒がゆっくり傾き始めている(端はしっかり動いている)のを見逃してしまう。
export const SETTLE_SPEED_EPS = 0.1;

// 静止した駒を固定(スリープ)する条件。Matter標準のスリープ判定は角速度の扱いがゆるく、
// 傾斜の上で倒れかけている駒まで止めてしまい「斜面にまっすぐ立つ」不自然な状態になる。
// そのため標準判定は使わず、「一定時間のあいだに実際に動いた距離」で判定する。
// 瞬間の速さで判定すると、Matterが接地中の駒に常に乗せる細かな計算上の震えに負けて、いつまでも眠れない駒が出る。
// 震えはその場で行き来するだけなので積み上がらないが、本当に倒れていく動きは距離が積み上がるので区別できる。
// 距離は重心の移動量と、回転による駒の端の移動量(角度変化×半径)の大きい方。
export const SLEEP_DISPLACEMENT_TOL = 0.3; // px
export const SLEEP_FRAMES_NEEDED = 30; // 約0.5秒(60fps)

// 何かに接触している駒の回転を、1フレームあたりこの割合だけ弱める(重力の向きに倒れていく回転は弱めない。engine.tsのdampContactRotation)。
// 完全な剛体どうしの接触ではエネルギーがほとんど失われず、細長い駒は着地の衝撃で左右の足を交互につきながら
// 長く揺れ続ける(ロッキング)。現実の物体がすぐ落ち着くのは接地面のわずかな変形やこすれで吸収されるためで、それに相当する。
// 大きくしすぎると、倒れるべき傾きの駒まで倒れにくくなる(0.08で倒れ始める傾きが理論値どおりになることを確認済み)。
export const CONTACT_ANGULAR_DAMPING = 0.08;

// 実時間(ms)ではなく実際に進んだシミュレーションフレーム数で計る。
// タブがバックグラウンドで間引かれた場合など、物理がほとんど進んでいないのに
// 実時間だけ経過してタイムアウトが誤発動する(＝まだ空中の駒を着地扱いにしてしまう)のを防ぐため。
// あくまで「万一いつまでも静止判定が出ない」場合の保険であり、通常のプレイでは
// ここに到達する前に必ずcheckSettled()側の完全静止判定で次のターンに進む想定。
export const MAX_DROP_WAIT_FRAMES = 1800; // 約30秒(60fps)相当
export const FALL_Y = CANVAS_H; // これを超えたら「落下」＝タワー崩壊

// 高い位置から落ちるほど衝突時の速度が上がり、めり込み量が増えて
// 補正で押し戻される瞬間が「跳ねた」ように見えてしまう。速度に上限をつけて防ぐ。
export const MAX_FALL_SPEED = 14;
export const MAX_ANGULAR_SPEED = 0.4; // 着地時に勢いよく回転して跳ねたり、転がる速さが速すぎたりするのを防ぐための角速度の上限
export const PHYSICS_TICK_MS = 1000 / 60; // 物理を進める1刻みの時間。描画のフレームレートに関係なく常にこの刻みで進める
export const PHYSICS_SUBSTEPS = 4; // 1描画フレームを何回に分けて物理計算するか

// 駒の慣性モーメント(回りにくさ)を、物理的に正しい値(各パーツの重心からのずれも含めて自前で計算)の何倍にするか。
// 1だとMatterの接触計算が不安定で、真っすぐ落としても着地の衝撃で倒れてしまうことがある。
// 大きすぎると倒れる駒の動きが重くなる。2が安定性と自然な倒れ方の両立点(シミュレーションで全キャラ確認済み)。
export const PIECE_INERTIA_SCALE = 2;

// Matterが「速い衝突」として特別扱いする接触の速さのしきい値(標準は2)。詳しくはengine.tsの設定箇所
export const RESOLVER_RESTING_THRESH = 1000;

// 弾まない(スーパーボールのような反発をなくす)・滑りにくい、硬い手触りにする。
// mass/densityはあえて指定しない → 駒の重さは各写真の実際の輪郭の面積から
// Matterが自動計算する(図形が大きい/太い駒ほど重くなり、倒れにくく・相手を倒しやすくなる)。
export const PIECE_MATERIAL = {
  restitution: 0,
  friction: 0.6,
  frictionStatic: 0.9,
};

export const PIECE_HEIGHT = 100; // ゲーム内での基準の高さ(px)。写真ごとに幅はここから縦横比で決まる
// 駒の輪郭(当たり判定)の細かさ。元画像1px≒ゲーム内0.1px程度(画像約1500px高を100〜160pxに縮めるため)。
// この設定で外側の輪郭と見た目のずれは平均0.1〜0.3px・最大約2px(以前の8/6では最大約8px)。
// 輪郭の内側に閉じた透明部分(腕と体の間など)は当たり判定に含まれないが、他の駒が入り込めない場所なので影響しない。
export const MASK_GRID_STEP = 2; // 輪郭抽出用グリッドの間隔(元画像のpx単位) : 小さいほど輪郭が精細だが重くなる
export const ALPHA_THRESHOLD = 24; // これより不透明なピクセルだけを「駒の中身」とみなす
export const SIMPLIFY_EPSILON = 2; // 輪郭の単純化の強さ(グリッド単位)。大きいほど頂点が減って軽く安定するが、細部は失われる

// 土台(パン)の輪郭は駒より細かく取る。駒が乗る面なので、見た目とのずれがそのまま「浮いて見える/めり込んで見える」になる。
// 画像は約2172px幅をGROUND_W(320px)に縮めるので、元画像1px≒ゲーム内0.15px。
// この設定で、上面の見た目とのずれはゲーム内で最大約0.3px(駒と同じ設定だと最大約6px)。
export const GROUND_MASK_GRID_STEP = 1;
export const GROUND_SIMPLIFY_EPSILON = 1.5;

export const VIEW_TOP_MARGIN = 24; // タワー最上部の駒の、さらに上に残す余白
export const VIEW_PAN_SMOOTHING = 0.1; // カメラが上下にスライドする滑らかさ(大きいほど素早く追いつく)

export const ROTATE_HOLD_SPEED = Math.PI / 45; // 回転ボタンを押している間、1フレームあたりに回転する角度(4度/フレーム)
export const ROTATE_SMOOTHING = 0.25; // 目標角に近づく速さ(大きいほど素早く追いつく)

export const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

export const AIM_TIME_LIMIT_MS = 10000; // 狙いを定められる制限時間。切れると今の位置・角度のまま自動で落下する

export const REROLL_LIMIT = 2; // 落とすキャラのランダム変更、1試合あたりプレイヤー1人につき使える回数

export const FALLBACK_MARGIN = 30; // 画像未準備時の当たり判定サイズが未確定なための暫定値
export const TAP_MAX_DISTANCE = 6; // これ以下の移動量ならタップ扱い(px)

export const PLAYER_NAMES: Record<1 | 2, string> = { 1: "プレイヤー1", 2: "プレイヤー2" };

// オンライン対戦: ホストが物理演算のスナップショットをゲストへ配信する間隔(ms)。
// 短くするほど滑らかだがFirebaseへの書き込み回数が増える。20Hz程度で見た目には十分滑らか。
export const NETWORK_BROADCAST_INTERVAL_MS = 50;

// オンライン対戦: ホスト側で、ゲストから届いた狙い位置へ毎フレーム近づける割合。
// 受信は20Hz程度なのでそのまま反映するとカクつく。大きいほど素早く追いつく。
export const REMOTE_AIM_SMOOTHING = 0.35;

export const GROUND_IMAGE_SRC =
  "/ground/74ADF095-B515-4049-880D-3EBD290C653F.PNG";

// 駒に使う画像・名前・大きさ(sizeScale)の一覧は pieceCatalog.ts に外出ししてある。
// (images/配下の写真を毎回ランダムに使う)

export function pieceImageSrc(file: string): string {
  return `/images/${file}`;
}
