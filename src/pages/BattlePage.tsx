import { TurnLabel } from "../components/TurnLabel";
import { TimerLabel } from "../components/TimerLabel";
import { RotateControls } from "../components/RotateControls";
import { RerollButton } from "../components/RerollButton";
import type { PageSlots } from "../components/BasePage";
import type { Player } from "../lib/engine";

interface Props {
  turnPlayer: Player;
  localPlayer: Player | null; // オンライン対戦での自分のプレイヤー(ひとりで挑戦ではnull)
  remainingSeconds: number;
  rerollsRemaining: number;
  currentPieceName: string;
  towerMoving: boolean; // 積んだ駒がまだ動いている(落とせない)間はtrue
  stackedCount: number; // 積み上げた個数
  onRotateStart: () => void;
  onRotateEnd: () => void;
  onReroll: () => void;
}

export function BattlePage({
  turnPlayer,
  localPlayer,
  remainingSeconds,
  rerollsRemaining,
  currentPieceName,
  towerMoving,
  stackedCount,
  onRotateStart,
  onRotateEnd,
  onReroll,
}: Props): PageSlots {
  return {
    header: (
      <div className="grid w-full grid-cols-[50%_40%_10%] items-center px-6">
        {/* truncateははみ出しを隠すので、縁取りの影が切れないよう内側に余白を取る */}
        <div className="min-w-0">
          <div className="truncate p-1 text-left font-heading text-sm font-bold text-white text-outline">{currentPieceName}</div>
          <div className="px-1 text-left font-heading text-sm font-bold text-white text-outline">{stackedCount}</div>
        </div>
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
            {towerMoving ? (
              <div className="text-center font-heading text-lg font-bold text-white text-outline">とまるまで まってね</div>
            ) : (
              // ひとりで挑戦には手番が無いので出さない
              localPlayer !== null && <TurnLabel player={turnPlayer} localPlayer={localPlayer} />
            )}
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
