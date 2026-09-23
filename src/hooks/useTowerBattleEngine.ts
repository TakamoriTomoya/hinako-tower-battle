import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { TowerBattleEngine, type EngineState, type Player } from "../lib/engine";
import { AIM_TIME_LIMIT_MS, REROLL_LIMIT } from "../lib/constants";
import type { RoomSync } from "../lib/network/roomSync";

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
  const attachOnlineHost = useCallback((sync: RoomSync) => engineRef.current?.attachOnlineHost(sync), []);
  const attachOnlineGuest = useCallback((sync: RoomSync) => engineRef.current?.attachOnlineGuest(sync), []);
  const detachOnline = useCallback(() => engineRef.current?.detachOnline(), []);

  // useEffect依存配列でactions全体を使えるよう、参照を安定させる(各関数自体は常にstableなので依存配列は空でよい)
  const actions = useMemo(
    () => ({
      startBattle,
      goHome,
      startRotating,
      stopRotating,
      rerollPiece,
      attachOnlineHost,
      attachOnlineGuest,
      detachOnline,
    }),
    [startBattle, goHome, startRotating, stopRotating, rerollPiece, attachOnlineHost, attachOnlineGuest, detachOnline],
  );

  return {
    canvasRef,
    phase: state.phase,
    turnPlayer: state.turnPlayer as Player,
    winner: state.winner,
    remainingSeconds: state.remainingSeconds,
    rerollsRemaining: state.rerollsRemaining,
    assetsReady: state.assetsReady,
    currentPieceName: state.currentPieceName,
    actions,
  };
}
