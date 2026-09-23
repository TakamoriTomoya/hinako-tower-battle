// オンライン対戦の部屋(合言葉)まわりを扱うクラス。
// Firebase Realtime Databaseの詳細をここに閉じ込め、engine.ts/Reactフック側は
// RemoteInputEvent/Snapshotのやり取りだけを意識すればよいようにする。
//
// データ構造:
//   rooms/{roomId}/hostPresent  : boolean
//   rooms/{roomId}/guestPresent : boolean
//   rooms/{roomId}/createdAt    : number
//   rooms/{roomId}/hostToGuest  : Snapshot (ホストが書く。ゲストが購読)
//   rooms/{roomId}/guestToHost  : RemoteInputEvent (ゲストが書く。ホストが購読)

import {
  child,
  onDisconnect,
  onValue,
  ref,
  remove,
  runTransaction,
  set,
  type DatabaseReference,
} from "firebase/database";
import { getFirebaseDatabase } from "./firebaseClient";
import { RoomError, type RemoteInputEvent, type RemoteInputPayload, type RoomRole, type Snapshot } from "./types";

function normalizePassphrase(passphrase: string): string {
  return passphrase.trim().toLowerCase();
}

// 合言葉(任意の文字列)をRTDBのキーとして使える形(英数字+ハイフンのみ)に変換する。
// FNV-1a系のハッシュを2種類かけ合わせて衝突しにくくしている(暗号目的ではない)。
function hashPassphrase(passphrase: string): string {
  const normalized = normalizePassphrase(passphrase);
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193;
  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x85ebca6b) >>> 0;
  }
  return `room-${h1.toString(16)}${h2.toString(16)}`;
}

interface RoomRecord {
  hostPresent?: boolean;
  guestPresent?: boolean;
  createdAt?: number;
}

export class RoomSync {
  readonly roomId: string;
  readonly role: RoomRole;
  private readonly roomRef: DatabaseReference;
  private readonly hostPresentRef: DatabaseReference;
  private readonly guestPresentRef: DatabaseReference;
  private readonly hostToGuestRef: DatabaseReference;
  private readonly guestToHostRef: DatabaseReference;
  private outSeq = 0;
  private disposed = false;

  private constructor(roomId: string, role: RoomRole) {
    const db = getFirebaseDatabase();
    this.roomId = roomId;
    this.role = role;
    this.roomRef = ref(db, `rooms/${roomId}`);
    this.hostPresentRef = child(this.roomRef, "hostPresent");
    this.guestPresentRef = child(this.roomRef, "guestPresent");
    this.hostToGuestRef = child(this.roomRef, "hostToGuest");
    this.guestToHostRef = child(this.roomRef, "guestToHost");
  }

  // 合言葉の部屋を新規に作る(ホストになる)。同じ合言葉の部屋が既に稼働中なら失敗する。
  static async createRoom(passphrase: string): Promise<RoomSync> {
    const roomId = hashPassphrase(passphrase);
    const db = getFirebaseDatabase();
    const roomRef = ref(db, `rooms/${roomId}`);
    const result = await runTransaction(roomRef, (current: RoomRecord | null) => {
      if (current && current.hostPresent) return undefined; // 既に稼働中 → 中断
      return { hostPresent: true, guestPresent: false, createdAt: Date.now() };
    });
    if (!result.committed) {
      throw new RoomError("already-exists", "この合言葉の部屋はすでに使われています");
    }
    const sync = new RoomSync(roomId, "host");
    onDisconnect(sync.hostPresentRef).set(false);
    return sync;
  }

  // 合言葉の部屋に入る(ゲストになる)。部屋が無い/満室なら失敗する。
  static async joinRoom(passphrase: string): Promise<RoomSync> {
    const roomId = hashPassphrase(passphrase);
    const db = getFirebaseDatabase();
    const roomRef = ref(db, `rooms/${roomId}`);
    const result = await runTransaction(roomRef, (current: RoomRecord | null) => {
      // 初回はサーバー値が未取得のためnullで呼ばれることがある。
      // ここで中断すると実在する部屋も「見つからない」になるので、nullをそのまま返して
      // サーバー値での再実行に任せる(本当に部屋が無ければnullのままコミットされる)。
      if (current === null) return null;
      if (!current.hostPresent) return undefined; // ホスト不在 → 中断
      if (current.guestPresent) return undefined; // 満室 → 中断
      return { ...current, guestPresent: true };
    });
    const val = result.snapshot.val() as RoomRecord | null;
    if (!result.committed || !val) {
      if (!val || !val.hostPresent) {
        throw new RoomError("not-found", "その合言葉の部屋が見つかりません");
      }
      throw new RoomError("full", "その部屋にはすでに2人います");
    }
    const sync = new RoomSync(roomId, "guest");
    onDisconnect(sync.guestPresentRef).set(false);
    return sync;
  }

  // ホスト側: ゲストが入室してきたら一度だけ呼ばれる
  onGuestJoined(handler: () => void): () => void {
    const off = onValue(this.guestPresentRef, (snap) => {
      if (snap.val() === true) handler();
    });
    return () => off();
  }

  // 相手の接続が切れた(一度は確認できていたpresenceがfalseに変わった)時に呼ばれる
  onPeerLeft(handler: () => void): () => void {
    const presenceRef = this.role === "host" ? this.guestPresentRef : this.hostPresentRef;
    let hasSeenPeer = false;
    const off = onValue(presenceRef, (snap) => {
      const present = snap.val() === true;
      if (present) hasSeenPeer = true;
      else if (hasSeenPeer) handler();
    });
    return () => off();
  }

  // ホスト専用: 物理演算結果のスナップショットを配信する
  sendSnapshot(snapshot: Omit<Snapshot, "seq">): void {
    this.outSeq++;
    void set(this.hostToGuestRef, { ...snapshot, seq: this.outSeq });
  }

  // ゲスト専用: ホストからのスナップショットを購読する
  onSnapshot(handler: (snapshot: Snapshot) => void): () => void {
    let lastSeq = -1;
    const off = onValue(this.hostToGuestRef, (snap) => {
      const val = snap.val() as Snapshot | null;
      if (!val || val.seq === lastSeq) return;
      lastSeq = val.seq;
      handler(val);
    });
    return () => off();
  }

  // ゲスト専用: 自分の手番の入力をホストへ送る
  sendInput(event: RemoteInputPayload): void {
    this.outSeq++;
    void set(this.guestToHostRef, { ...event, seq: this.outSeq });
  }

  // ホスト専用: ゲストからの入力を購読する
  onRemoteInput(handler: (event: RemoteInputEvent) => void): () => void {
    let lastSeq = -1;
    const off = onValue(this.guestToHostRef, (snap) => {
      const val = snap.val() as RemoteInputEvent | null;
      if (!val || val.seq === lastSeq) return;
      lastSeq = val.seq;
      handler(val);
    });
    return () => off();
  }

  // 部屋から退出する。ホストは部屋ごと消し、ゲストは自分のpresenceだけ落とす。
  async leave(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.role === "host") {
      await onDisconnect(this.hostPresentRef).cancel();
      await remove(this.roomRef);
    } else {
      await onDisconnect(this.guestPresentRef).cancel();
      await set(this.guestPresentRef, false);
      await remove(this.guestToHostRef);
    }
  }
}
