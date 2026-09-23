// オンライン対戦(ホスト権威モデル)で端末間をやり取りするメッセージの型定義。
// engine.tsはこのファイルの型にだけ依存し、Firebaseの詳細はroomSync.ts側に閉じ込める。

import type { EnginePhase, Player } from "../engine";

export type RoomRole = "host" | "guest";

// ホスト→ゲスト: 現在のワールド状態のスナップショット。
// ゲストはこれをそのまま描画するだけで、自前の物理演算は一切行わない。
export interface SnapshotBody {
  id: number; // spawnPiece/rerollPieceのたびに払い出す駒ごとの安定ID
  src: string; // Piece.src。ゲスト側でローカルのpieces一覧から画像を引く
  x: number;
  y: number;
  angle: number;
}

export interface Snapshot {
  seq: number;
  phase: EnginePhase;
  turnPlayer: Player;
  winner: Player | null;
  remainingSeconds: number;
  rerollsRemaining: number;
  rerollsByPlayer: { p1: number; p2: number }; // ホストが抜けて入り直した時に両者の残り回数を復元するため
  currentPieceName: string;
  towerMoving?: boolean; // 積んだ駒がまだ動いているか(trueの間はゲストも落とせない)。古いホストは送らないので省略可
  currentBodyId: number | null; // 狙い中の駒のID(aiming以外はnull)。ゲストが手元で動かす駒の特定に使う
  bodies: SnapshotBody[]; // 土台は含めない(ゲストはローカルの土台画像をそのまま描く)
}

// ゲスト→ホスト: 自分の手番の間の操作。
// 狙い中の駒はゲストが手元で動かし(操作の遅延をなくすため)、ホストには結果の位置・角度だけを送る。
// idはどの駒に対する操作かを示し、キャラ変更などで駒が入れ替わった後に届いた古い操作をホストが無視できるようにする。
// (RemoteInputEvent = RemoteInputPayload & { seq: number }とせずunion自体にseqを持たせているのは、
//  TypeScript組み込みのOmitがunionに対して分配されずdir等の判別フィールドを消してしまうため。
//  送信側はseqを持たないRemoteInputPayloadを使い、RoomSync側でseqを付与する)
export type RemoteInputPayload =
  | { type: "aim"; id: number; x: number; angle: number }
  | { type: "drop"; id: number; x: number; angle: number }
  | { type: "reroll" }
  | { type: "restart" }; // 決着後、ゲストが「もう一度」を押した(ホストも押していれば次の対戦が始まる)

export type RemoteInputEvent = RemoteInputPayload & { seq: number };

export type RoomErrorReason =
  | "full" // 同じ合言葉で既に2人が揃っている
  | "unknown";

export class RoomError extends Error {
  readonly reason: RoomErrorReason;

  constructor(reason: RoomErrorReason, message: string) {
    super(message);
    this.name = "RoomError";
    this.reason = reason;
  }
}
