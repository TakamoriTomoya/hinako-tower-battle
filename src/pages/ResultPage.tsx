import { playerName } from "../lib/engine";
import type { Player } from "../lib/engine";
import { CenterSlot } from "../components/CenterSlot";
import { GameOverControls } from "../components/GameOverControls";
import { BackButton } from "../components/BackButton";
import type { PageSlots } from "../components/BasePage";

interface Props {
  winner: Player | null;
  onHome: () => void;
  onRestart: () => void;
  canRestart?: boolean; // オンライン対戦のゲスト側では、再戦はホストのみが行える
}

export function ResultPage({ winner, onHome, onRestart, canRestart = true }: Props): PageSlots {
  return {
    header: <BackButton onClick={onHome} />,
    center: winner && <CenterSlot>{playerName(winner)}の勝利</CenterSlot>,
    bottom: canRestart ? <GameOverControls onRestart={onRestart} /> : null,
  };
}
