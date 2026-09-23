// ゲーム全体の設定値。挙動を変えたい時はここだけを触ればよいようにまとめてある。

export const CANVAS_W = 380;
export const CANVAS_H = 640;
export const GROUND_Y = 380; // パン画像が縦長なため、下端が見切れないよう少し上に配置
export const GROUND_W = 320; // 土台の幅。高さは画像の縦横比から自動計算されるのでここだけ調整すればよい

// タワーが空の時は低い位置から、積み上がるにつれて自動でスポーン位置を上げる
export const SPAWN_Y_BASE = 250; // タワーが空の時のスポーン高さ
export const SPAWN_CLEARANCE = 100; // タワーの一番高い場所からこの分だけ上に確保する

export const MOVE_SPEED = 4.5; // px / frame
export const SETTLE_FRAMES_NEEDED = 30; // 約0.5秒(60fps)
export const SETTLE_SPEED_EPS = 0.05;

// 実時間(ms)ではなく実際に進んだシミュレーションフレーム数で計る。
// タブがバックグラウンドで間引かれた場合など、物理がほとんど進んでいないのに
// 実時間だけ経過してタイムアウトが誤発動する(＝まだ空中の駒を着地扱いにしてしまう)のを防ぐため。
// あくまで「万一いつまでも静止判定が出ない」場合の保険であり、通常のプレイでは
// ここに到達する前に必ずcheckSettled()側の完全静止判定で次のターンに進む想定。
export const MAX_DROP_WAIT_FRAMES = 1800; // 約30秒(60fps)相当
export const FALL_Y = CANVAS_H; // これを超えたら「落下」＝タワー崩壊

// 高い位置から落ちるほど衝突時の速度が上がり、めり込み量が増えて
// 補正で押し戻される瞬間が「跳ねた」ように見えてしまう。速度に上限をつけて防ぐ。
export const MAX_FALL_SPEED = 3.5;
export const MAX_ANGULAR_SPEED = 0.1; // 着地時に勢いよく回転して跳ねたり、転がる速さが速すぎたりするのを防ぐための角速度の上限
export const PHYSICS_SUBSTEPS = 4; // 1描画フレームを何回に分けて物理計算するか

// 弾まない(スーパーボールのような反発をなくす)・滑りにくい、硬い手触りにする。
// mass/densityはあえて指定しない → 駒の重さは各写真の実際の輪郭の面積から
// Matterが自動計算する(図形が大きい/太い駒ほど重くなり、倒れにくく・相手を倒しやすくなる)。
export const PIECE_MATERIAL = {
  restitution: 0,
  friction: 0.6,
  frictionStatic: 0.9,
};

export const PIECE_HEIGHT = 100; // ゲーム内での基準の高さ(px)。写真ごとに幅はここから縦横比で決まる
export const MASK_GRID_STEP = 8; // 輪郭抽出用グリッドの間隔(元画像のpx単位) : 小さいほど輪郭が精細だが重くなる
export const ALPHA_THRESHOLD = 24; // これより不透明なピクセルだけを「駒の中身」とみなす
export const SIMPLIFY_EPSILON = 6; // 輪郭の単純化の強さ(グリッド単位)。大きいほど頂点が減って軽く安定するが、細部は失われる

export const VIEW_TOP_MARGIN = 24; // タワー最上部の駒の、さらに上に残す余白
export const VIEW_PAN_SMOOTHING = 0.1; // カメラが上下にスライドする滑らかさ(大きいほど素早く追いつく)

export const ROTATE_HOLD_SPEED = Math.PI / 45; // 回転ボタンを押している間、1フレームあたりに回転する角度(4度/フレーム)
export const ROTATE_SMOOTHING = 0.25; // 目標角に近づく速さ(大きいほど素早く追いつく)

export const FALLING_SPEED_THRESHOLD = 1.2; // これを一度でも超えたら「本当に落下し始めた」とみなす

export const AIM_TIME_LIMIT_MS = 10000; // 狙いを定められる制限時間。切れると今の位置・角度のまま自動で落下する

export const REROLL_LIMIT = 2; // 落とすキャラのランダム変更、1試合あたりプレイヤー1人につき使える回数

export const FALLBACK_MARGIN = 30; // 画像未準備時の当たり判定サイズが未確定なための暫定値
export const TAP_MAX_DISTANCE = 6; // これ以下の移動量ならタップ扱い(px)

export const PLAYER_NAMES: Record<1 | 2, string> = { 1: "ともや", 2: "ひなこ" };

// オンライン対戦: ホストが物理演算のスナップショットをゲストへ配信する間隔(ms)。
// 短くするほど滑らかだがFirebaseへの書き込み回数が増える。20Hz程度で見た目には十分滑らか。
export const NETWORK_BROADCAST_INTERVAL_MS = 50;

// オンライン対戦: ゲスト側のドラッグ操作を左右移動の方向に変換する際の不感帯(px)。
// タップ判定(TAP_MAX_DISTANCE)よりわずかに大きくし、タップのブレで誤って移動扱いにしない。
export const GUEST_DRAG_DEAD_ZONE = 10;

export const GROUND_IMAGE_SRC =
  "/ground/74ADF095-B515-4049-880D-3EBD290C653F.PNG";

// 駒に使う画像・名前・大きさ(sizeScale)の一覧は pieceCatalog.ts に外出ししてある。
// (images/配下の写真を毎回ランダムに使う)

export function pieceImageSrc(file: string): string {
  return `/images/${file}`;
}
