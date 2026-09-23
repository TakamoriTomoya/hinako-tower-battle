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
  onRotateStart: () => void;
  onRotateEnd: () => void;
  onReroll: () => void;
}

export function BattlePage({
  turnPlayer,
  remainingSeconds,
  rerollsRemaining,
  onRotateStart,
  onRotateEnd,
  onReroll,
}: Props): PageSlots {
  return {
    header: (
      <div className="grid w-full grid-cols-[10%_1fr_10%] items-center px-4">
        <div />
        <TurnLabel player={turnPlayer} />
        <div className="flex justify-center">
          <TimerLabel seconds={remainingSeconds} />
        </div>
      </div>
    ),
    bottom: (
      <div className="grid w-full grid-cols-[20%_1fr_20%] items-center px-4">
        <div className="h-11 w-[60px]" aria-hidden="true" />
        <RotateControls onRotateStart={onRotateStart} onRotateEnd={onRotateEnd} />
        <div className="flex justify-center">
          {rerollsRemaining > 0 && (
            <RerollButton remaining={rerollsRemaining} onClick={onReroll} />
          )}
        </div>
      </div>
    ),
  };
}
