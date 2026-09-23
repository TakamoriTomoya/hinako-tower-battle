import { RestartIcon } from "./icons";

interface Props {
  onRestart: () => void;
}

export function GameOverControls({ onRestart }: Props) {
  return (
    <div className="flex justify-center">
      <button
        type="button"
        className="pointer-events-auto flex h-11 w-[200px] cursor-pointer items-center justify-center gap-1.5 rounded-[18px] border-0 bg-ghost-bg font-heading text-base font-bold text-ghost-text shadow-[0_4px_0_var(--color-ghost-shadow)] transition-transform duration-100 hover:bg-ghost-hover active:scale-[0.96]"
        aria-label="もう一度あそぶ"
        onClick={onRestart}
      >
        <RestartIcon size={20} />
        <span>もう一度</span>
      </button>
    </div>
  );
}
