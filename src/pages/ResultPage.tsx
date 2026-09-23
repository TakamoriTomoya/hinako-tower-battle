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
}

export function ResultPage({ winner, onHome, onRestart }: Props): PageSlots {
  return {
    header: <BackButton onClick={onHome} />,
    center: winner && <CenterSlot>{playerName(winner)}の勝利</CenterSlot>,
    bottom: <GameOverControls onRestart={onRestart} />,
  };
}
