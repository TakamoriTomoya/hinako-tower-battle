import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { TowerBattleEngine, type EngineState, type Player } from "../lib/engine";
import { AIM_TIME_LIMIT_MS, REROLL_LIMIT } from "../lib/constants";

export function useTowerBattleEngine() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<TowerBattleEngine | null>(null);
  const [state, setState] = useState<EngineState>({
    phase: "home",
    turnPlayer: 1,
    winner: null,
    remainingSeconds: Math.ceil(AIM_TIME_LIMIT_MS / 1000),
    rerollsRemaining: REROLL_LIMIT,
    assetsReady: false,
    currentPieceName: "",
  });

  // useEffectだとブラウザが一度ペイントした後に実行されるため、
  // 初期状態(canvasの初期サイズ300x150)がごく一瞬見えてしまうことがある。
  // useLayoutEffectでペイント前に実サイズへ張り直す。
  useLayoutEffect(() => {
    const engine = new TowerBattleEngine(setState);
    engineRef.current = engine;
    if (canvasRef.current) engine.init(canvasRef.current);
    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const startBattle = useCallback(() => engineRef.current?.startBattle(), []);
  const goHome = useCallback(() => engineRef.current?.goHome(), []);
  const startRotating = useCallback(() => engineRef.current?.startRotating(), []);
  const stopRotating = useCallback(() => engineRef.current?.stopRotating(), []);
  const rerollPiece = useCallback(() => engineRef.current?.rerollPiece(), []);

  return {
    canvasRef,
    phase: state.phase,
    turnPlayer: state.turnPlayer as Player,
    winner: state.winner,
    remainingSeconds: state.remainingSeconds,
    rerollsRemaining: state.rerollsRemaining,
    assetsReady: state.assetsReady,
    currentPieceName: state.currentPieceName,
    actions: { startBattle, goHome, startRotating, stopRotating, rerollPiece },
  };
}
