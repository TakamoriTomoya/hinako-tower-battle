import { useCallback, useEffect, useRef, useState } from "react";
import { RoomSync } from "../lib/network/roomSync";
import { RoomError, type RoomErrorReason, type RoomRole } from "../lib/network/types";

export type OnlineRoomStatus =
  | { step: "idle" }
  | { step: "matching" } // 合言葉の部屋へ接続中
  | { step: "waiting-for-peer" } // 同じ合言葉の相手を待っている
  | { step: "connected"; role: RoomRole } // 両者が揃った。以降は相手が抜けてもこのまま(peerPresentで区別)
  | { step: "error"; reason: RoomErrorReason; message: string };

// オンライン対戦の部屋(合言葉)のライフサイクルをReact側から扱うためのフック。
// RoomSync(Firebase RTDBとのやり取り)自体はrefで保持し、Reactへは状態遷移だけを公開する。
export function useOnlineRoom() {
  const [status, setStatus] = useState<OnlineRoomStatus>({ step: "idle" });
  const [peerPresent, setPeerPresent] = useState(false);
  const syncRef = useRef<RoomSync | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const clearSubscriptions = useCallback(() => {
    unsubsRef.current.forEach((off) => off());
    unsubsRef.current = [];
  }, []);

  // 同じ合言葉の相手が既に待っていればすぐ対戦、いなければ相手が来るまで待つ。
  // 一度つながった後は、相手が抜けても接続を切らずに入り直してくるのを待つ。
  const matchRoom = useCallback(async (passphrase: string) => {
    setStatus({ step: "matching" });
    try {
      const sync = await RoomSync.matchRoom(passphrase);
      syncRef.current = sync;
      setStatus(sync.role === "guest" ? { step: "connected", role: "guest" } : { step: "waiting-for-peer" });
      unsubsRef.current.push(
        sync.onPeerPresence((present) => {
          setPeerPresent(present);
          if (present) {
            setStatus((prev) => (prev.step === "connected" ? prev : { step: "connected", role: sync.role }));
          }
        }),
      );
    } catch (e) {
      const err = e instanceof RoomError ? e : new RoomError("unknown", "接続に失敗しました");
      setStatus({ step: "error", reason: err.reason, message: err.message });
    }
  }, []);

  const leaveRoom = useCallback(() => {
    clearSubscriptions();
    const sync = syncRef.current;
    syncRef.current = null;
    setStatus({ step: "idle" });
    setPeerPresent(false);
    if (sync) void sync.leave();
  }, [clearSubscriptions]);

  const reset = useCallback(() => setStatus({ step: "idle" }), []);

  // アプリごと閉じられた時などの後始末
  useEffect(() => {
    return () => {
      clearSubscriptions();
      syncRef.current?.leave();
    };
  }, [clearSubscriptions]);

  return { status, peerPresent, sync: syncRef, matchRoom, leaveRoom, reset };
}
