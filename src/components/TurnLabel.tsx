import { playerName } from "../lib/engine";
import type { Player } from "../lib/engine";

interface Props {
  player: Player;
  localPlayer?: Player | null; // null(ひとりで挑戦)では「プレイヤー1の番」、オンライン対戦では「あなたの番」「あいての番」と出す
}

export function TurnLabel({ player, localPlayer = null }: Props) {
  const name = localPlayer === null ? playerName(player) : player === localPlayer ? "あなた" : "あいて";
  return <div className="text-center font-heading text-lg font-bold text-white text-outline">{name}の番！</div>;
}
