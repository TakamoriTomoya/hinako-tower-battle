import { useCallback, useEffect, useRef, useState } from "react";
import { RoomSync } from "../lib/network/roomSync";
import { RoomError, type RoomErrorReason, type RoomRole } from "../lib/network/types";

export type OnlineRoomStatus =
  | { step: "idle" }
  | { step: "creating" }
  | { step: "joining" }
  | { step: "waiting-for-guest" } // ホスト: ゲストの入室待ち
  | { step: "connected"; role: RoomRole } // 両者が揃った。対戦開始できる
  | { step: "disconnected" } // 対戦中に相手の接続が切れた
  | { step: "error"; reason: RoomErrorReason; message: string };

// オンライン対戦の部屋(合言葉)のライフサイクルをReact側から扱うためのフック。
// RoomSync(Firebase RTDBとのやり取り)自体はrefで保持し、Reactへは状態遷移だけを公開する。
export function useOnlineRoom() {
  const [status, setStatus] = useState<OnlineRoomStatus>({ step: "idle" });
  const syncRef = useRef<RoomSync | null>(null);
  const unsubsRef = useRef<Array<() => void>>([]);

  const clearSubscriptions = useCallback(() => {
    unsubsRef.current.forEach((off) => off());
    unsubsRef.current = [];
  }, []);

  const watchPeerLeft = useCallback((sync: RoomSync) => {
    unsubsRef.current.push(
      sync.onPeerLeft(() => {
        setStatus({ step: "disconnected" });
      }),
    );
  }, []);

  const createRoom = useCallback(
    async (passphrase: string) => {
      setStatus({ step: "creating" });
      try {
        const sync = await RoomSync.createRoom(passphrase);
        syncRef.current = sync;
        setStatus({ step: "waiting-for-guest" });
        watchPeerLeft(sync);
        unsubsRef.current.push(
          sync.onGuestJoined(() => {
            setStatus({ step: "connected", role: "host" });
          }),
        );
      } catch (e) {
        const err = e instanceof RoomError ? e : new RoomError("unknown", "部屋の作成に失敗しました");
        setStatus({ step: "error", reason: err.reason, message: err.message });
      }
    },
    [watchPeerLeft],
  );

  const joinRoom = useCallback(
    async (passphrase: string) => {
      setStatus({ step: "joining" });
      try {
        const sync = await RoomSync.joinRoom(passphrase);
        syncRef.current = sync;
        setStatus({ step: "connected", role: "guest" });
        watchPeerLeft(sync);
      } catch (e) {
        const err = e instanceof RoomError ? e : new RoomError("unknown", "部屋への参加に失敗しました");
        setStatus({ step: "error", reason: err.reason, message: err.message });
      }
    },
    [watchPeerLeft],
  );

  const leaveRoom = useCallback(() => {
    clearSubscriptions();
    const sync = syncRef.current;
    syncRef.current = null;
    setStatus({ step: "idle" });
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

  return { status, sync: syncRef, createRoom, joinRoom, leaveRoom, reset };
}
