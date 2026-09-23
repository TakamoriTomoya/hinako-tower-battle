import type { Player } from "../lib/engine";
import { CenterSlot } from "../components/CenterSlot";
import { GameOverControls } from "../components/GameOverControls";
import { BackButton } from "../components/BackButton";
import type { PageSlots } from "../components/BasePage";

interface Props {
  winner: Player | null;
  onHome: () => void;
  onRestart: () => void;
  localPlayer: Player | null; // オンライン対戦での自分のプレイヤー(ひとりで挑戦ではnull)
}

// ひとりで挑戦は勝ち負けが無いので「おわり」、オンライン対戦は自分から見た勝ち負けを出す
function resultText(winner: Player, localPlayer: Player | null): string {
  if (localPlayer === null) return "おわり";
  return winner === localPlayer ? "あなたの勝ち！" : "あなたの負け…";
}

export function ResultPage({ winner, onHome, onRestart, localPlayer }: Props): PageSlots {
  return {
    header: <BackButton onClick={onHome} />,
    center: winner && <CenterSlot>{resultText(winner, localPlayer)}</CenterSlot>,
    bottom: <GameOverControls onRestart={onRestart} />,
  };
}
