import { useCallback, useEffect, useState } from "react";
import { BasePage } from "./components/BasePage";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { HomePage } from "./pages/HomePage";
import { BattlePage } from "./pages/BattlePage";
import { ResultPage } from "./pages/ResultPage";
import { OnlineLobbyPage } from "./pages/OnlineLobbyPage";
import { OnlineWaitingPage } from "./pages/OnlineWaitingPage";
import { PeerAwayNotice } from "./components/PeerAwayNotice";
import { useTowerBattleEngine } from "./hooks/useTowerBattleEngine";
import { useOnlineRoom } from "./hooks/useOnlineRoom";
import type { RoomRole } from "./lib/network/types";
import { loadPassphraseHistory, savePassphraseToHistory } from "./lib/passphraseHistory";

type AppMode = "menu" | "online-lobby";

function App() {
  const {
    canvasRef,
    phase,
    turnPlayer,
    winner,
    remainingSeconds,
    rerollsRemaining,
    assetsReady,
    currentPieceName,
    towerMoving,
    stackedCount,
    actions,
  } = useTowerBattleEngine();

  const room = useOnlineRoom();
  const [appMode, setAppMode] = useState<AppMode>("menu");
  const [passphrase, setPassphrase] = useState("");
  const [passphraseHistory, setPassphraseHistory] = useState<string[]>(loadPassphraseHistory);
  const [onlineRole, setOnlineRole] = useState<RoomRole | null>(null);
  // オンライン対戦の決着後に自分が「もう一度」を押し、相手が押すのを待っている間true
  const [rematchWaiting, setRematchWaiting] = useState(false);

  // 部屋にホスト・ゲストが揃ったら、実際の対戦(engine)側へ接続を渡して開始する
  useEffect(() => {
    if (room.status.step !== "connected") return;
    const sync = room.sync.current;
    if (!sync) return;
    if (room.status.role === "host") {
      if (sync.restoredSnapshot) {
        // 対戦の途中で抜けたホストが入り直した: 抜ける直前の状態から再開する
        actions.restoreOnlineHost(sync, sync.restoredSnapshot);
      } else {
        actions.attachOnlineHost(sync);
        actions.startBattle();
      }
    } else {
      actions.attachOnlineGuest(sync);
    }
    setOnlineRole(room.status.role);
    setAppMode("menu");
  }, [room.status, room.sync, actions]);

  // 相手が抜けても対戦は続け、入り直してくるのを待つ(ホストは相手の手番の制限時間を止める)
  useEffect(() => {
    actions.setPeerPresent(room.peerPresent);
  }, [room.peerPresent, actions]);

  // 次の対戦が始まった(またはホームへ戻った)ら待機を終える
  useEffect(() => {
    if (phase !== "gameover") setRematchWaiting(false);
  }, [phase]);

  // ゲスト: 待っている間にホストが抜けて入り直すと押したことが消えるので、戻ってきたら伝え直す
  useEffect(() => {
    if (rematchWaiting && onlineRole === "guest" && room.peerPresent) actions.requestRematch();
  }, [rematchWaiting, onlineRole, room.peerPresent, actions]);

  const handleStartOnline = useCallback(() => {
    // 直近に使った合言葉を初期値にして、同じ相手とすぐ遊び直せるようにする
    setPassphrase(passphraseHistory[0] ?? "");
    room.reset();
    setAppMode("online-lobby");
  }, [room, passphraseHistory]);

  const handleLobbyBack = useCallback(() => {
    room.leaveRoom();
    setAppMode("menu");
  }, [room]);

  const handleMatchRoom = useCallback(() => {
    setPassphraseHistory(savePassphraseToHistory(passphrase));
    void room.matchRoom(passphrase);
  }, [room, passphrase]);

  const handleGoHome = useCallback(() => {
    if (onlineRole) {
      actions.detachOnline();
      room.leaveRoom();
      setOnlineRole(null);
    }
    actions.goHome();
  }, [onlineRole, actions, room]);

  const handleRestart = useCallback(() => {
    if (onlineRole === null) {
      actions.startBattle();
      return;
    }
    // オンライン対戦は、部屋に入った時と同じく相手も押すまで待ってから始める
    actions.requestRematch();
    setRematchWaiting(true);
  }, [onlineRole, actions]);

  const peerAway = onlineRole !== null && !room.peerPresent;
  const localPlayer = onlineRole === null ? null : onlineRole === "host" ? 1 : 2;

  const isWaitingForPeer = room.status.step === "matching" || room.status.step === "waiting-for-peer";

  const slots =
    appMode === "online-lobby" && isWaitingForPeer
      ? OnlineWaitingPage({
          message: `合言葉「${passphrase}」で相手を待っています`,
          onBack: handleLobbyBack,
        })
      : appMode === "online-lobby"
        ? OnlineLobbyPage({
            status: room.status,
            passphrase,
            history: passphraseHistory,
            onPassphraseChange: setPassphrase,
            onMatch: handleMatchRoom,
            onBack: handleLobbyBack,
          })
        : phase === "home"
          ? HomePage({
              onStart: actions.startBattle,
              onStartOnline: handleStartOnline,
            })
          : phase === "gameover" && rematchWaiting
            ? OnlineWaitingPage({
                message: "相手が「もう一度」を押すのを待っています",
                onBack: handleGoHome,
              })
            : phase === "gameover"
              ? ResultPage({
                  winner,
                  onHome: handleGoHome,
                  onRestart: handleRestart,
                  localPlayer,
                })
              : BattlePage({
                  turnPlayer,
                  localPlayer,
                  remainingSeconds,
                  rerollsRemaining,
                  currentPieceName,
                  towerMoving,
                  stackedCount,
                  onRotateStart: actions.startRotating,
                  onRotateEnd: actions.stopRotating,
                  onReroll: actions.rerollPiece,
                });

  return (
    <>
      <BasePage
        canvasRef={canvasRef}
        {...slots}
        center={
          <>
            {slots.center}
            {peerAway && <PeerAwayNotice />}
          </>
        }
      />
      <LoadingOverlay ready={assetsReady} />
    </>
  );
}

export default App;
