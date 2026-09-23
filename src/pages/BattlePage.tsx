import { TurnLabel } from "../components/TurnLabel";
import { TimerLabel } from "../components/TimerLabel";
import { RotateControls } from "../components/RotateControls";
import { RerollButton } from "../components/RerollButton";
import type { PageSlots } from "../components/BasePage";
import type { Player } from "../lib/engine";

interface Props {
  turnPlayer: Player;
  remainingSeconds: number;
  rerollsRemaining: number;
  currentPieceName: string;
  onRotateStart: () => void;
  onRotateEnd: () => void;
  onReroll: () => void;
}

export function BattlePage({
  turnPlayer,
  remainingSeconds,
  rerollsRemaining,
  currentPieceName,
  onRotateStart,
  onRotateEnd,
  onReroll,
}: Props): PageSlots {
  return {
    header: (
      <div className="grid w-full grid-cols-[30%_60%_10%] items-center px-6">
        <div className="truncate text-left font-heading text-sm font-bold text-white">{currentPieceName}</div>
        <div aria-hidden="true" />
        <div className="flex justify-center">
          <TimerLabel seconds={remainingSeconds} />
        </div>
      </div>
    ),
    bottom: (
      <div className="grid w-full grid-cols-[20%_1fr_20%] items-center px-6">
        <div className="h-11 w-[60px]" aria-hidden="true" />
        <div className="relative flex justify-center">
          <div className="pointer-events-none absolute bottom-full mb-2 whitespace-nowrap">
            <TurnLabel player={turnPlayer} />
          </div>
          <RotateControls onRotateStart={onRotateStart} onRotateEnd={onRotateEnd} />
        </div>
        <div className="flex justify-center">
          {rerollsRemaining > 0 && (
            <RerollButton remaining={rerollsRemaining} onClick={onReroll} />
          )}
        </div>
      </div>
    ),
  };
}
