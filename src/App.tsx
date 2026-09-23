import { BasePage } from "./components/BasePage";
import { LoadingOverlay } from "./components/LoadingOverlay";
import { HomePage } from "./pages/HomePage";
import { BattlePage } from "./pages/BattlePage";
import { ResultPage } from "./pages/ResultPage";
import { useTowerBattleEngine } from "./hooks/useTowerBattleEngine";

function App() {
  const { canvasRef, phase, turnPlayer, winner, remainingSeconds, rerollsRemaining, assetsReady, actions } =
    useTowerBattleEngine();

  const slots =
    phase === "home"
      ? HomePage({ onStart: actions.startBattle })
      : phase === "gameover"
        ? ResultPage({ winner, onHome: actions.goHome, onRestart: actions.startBattle })
        : BattlePage({
            turnPlayer,
            remainingSeconds,
            rerollsRemaining,
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
