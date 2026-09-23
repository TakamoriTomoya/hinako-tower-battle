import { playerName } from "../lib/engine";
import type { Player } from "../lib/engine";

interface Props {
  player: Player;
}

export function TurnLabel({ player }: Props) {
  return <div className="text-center font-heading text-lg font-bold text-white">{playerName(player)}の番！</div>;
}
