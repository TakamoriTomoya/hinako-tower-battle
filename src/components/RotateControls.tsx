import { RotateIcon } from "./icons";

interface Props {
  onRotateStart: () => void;
  onRotateEnd: () => void;
}

// 右回りのみ・押している間ずっと回転し続ける単一ボタン
export function RotateControls({ onRotateStart, onRotateEnd }: Props) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        className="pointer-events-auto flex h-11 w-[200px] touch-none select-none items-center justify-center gap-1.5 rounded-[18px] border-0 bg-ghost-bg font-heading text-base font-bold text-ghost-text shadow-[0_4px_0_var(--color-ghost-shadow)] transition-transform duration-100 hover:bg-ghost-hover active:scale-[0.96]"
        onPointerDown={onRotateStart}
        onPointerUp={onRotateEnd}
        onPointerCancel={onRotateEnd}
        onPointerLeave={onRotateEnd}
        onContextMenu={(e) => e.preventDefault()}
      >
        <RotateIcon size={20} />
        <span>回転</span>
      </button>
    </div>
  );
}
