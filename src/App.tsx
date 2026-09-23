import { useCallback, useEffect, useState } from "react";
import { BasePage } from "./components/BasePage";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { HomePage } from "./pages/HomePage";
import { BattlePage } from "./pages/BattlePage";
import { ResultPage } from "./pages/ResultPage";
import { OnlineLobbyPage } from "./pages/OnlineLobbyPage";
import { useTowerBattleEngine } from "./hooks/useTowerBattleEngine";
import { useOnlineRoom } from "./hooks/useOnlineRoom";
import type { RoomRole } from "./lib/network/types";

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
    actions,
  } = useTowerBattleEngine();

  const room = useOnlineRoom();
  const [appMode, setAppMode] = useState<AppMode>("menu");
  const [passphrase, setPassphrase] = useState("");
  const [onlineRole, setOnlineRole] = useState<RoomRole | null>(null);

  // 部屋にホスト・ゲストが揃ったら、実際の対戦(engine)側へ接続を渡して開始する
  useEffect(() => {
    if (room.status.step !== "connected") return;
    const sync = room.sync.current;
    if (!sync) return;
    if (room.status.role === "host") {
      actions.attachOnlineHost(sync);
      actions.startBattle();
    } else {
      actions.attachOnlineGuest(sync);
    }
    setOnlineRole(room.status.role);
    setAppMode("menu");
  }, [room.status, room.sync, actions]);

  const handleStartOnline = useCallback(() => {
    setPassphrase("");
    room.reset();
    setAppMode("online-lobby");
  }, [room]);

  const handleLobbyBack = useCallback(() => {
    room.leaveRoom();
    setAppMode("menu");
  }, [room]);

  const handleCreateRoom = useCallback(() => room.createRoom(passphrase), [room, passphrase]);
  const handleJoinRoom = useCallback(() => room.joinRoom(passphrase), [room, passphrase]);

  const handleGoHome = useCallback(() => {
    if (onlineRole) {
      actions.detachOnline();
      room.leaveRoom();
      setOnlineRole(null);
    }
    actions.goHome();
  }, [onlineRole, actions, room]);

  const handleRestart = useCallback(() => {
    // オンライン対戦の再戦はホストのみが開始できる(ゲスト側は再戦ボタン自体を出さない)
    actions.startBattle();
  }, [actions]);

  // 対戦中に相手の接続が切れた場合は、フェーズに関わらず切断画面を出す
  const peerDisconnected = onlineRole !== null && room.status.step === "disconnected";

  const slots = peerDisconnected
    ? OnlineLobbyPage({
        status: room.status,
        passphrase,
        onPassphraseChange: setPassphrase,
        onCreate: handleCreateRoom,
        onJoin: handleJoinRoom,
        onBack: handleGoHome,
      })
    : appMode === "online-lobby"
      ? OnlineLobbyPage({
          status: room.status,
          passphrase,
          onPassphraseChange: setPassphrase,
          onCreate: handleCreateRoom,
          onJoin: handleJoinRoom,
          onBack: handleLobbyBack,
        })
      : phase === "home"
        ? HomePage({ onStart: actions.startBattle, onStartOnline: handleStartOnline })
        : phase === "gameover"
          ? ResultPage({
              winner,
              onHome: handleGoHome,
              onRestart: handleRestart,
              canRestart: onlineRole !== "guest",
            })
          : BattlePage({
              turnPlayer,
              remainingSeconds,
              rerollsRemaining,
              currentPieceName,
              onRotateStart: actions.startRotating,
              onRotateEnd: actions.stopRotating,
              onReroll: actions.rerollPiece,
            });

  return (
    <>
      <BasePage canvasRef={canvasRef} {...slots} />
      <LoadingOverlay ready={assetsReady} />
    </>
  );
}

export default App;
