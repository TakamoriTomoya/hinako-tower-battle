import { ArrowLeftIcon } from "./icons";

interface Props {
  onClick: () => void;
}

// ヘッダーに置く「前画面へ戻る」アイコンのみのボタン
export function BackButton({ onClick }: Props) {
  return (
    <button
      type="button"
      className="pointer-events-auto absolute left-4 top-1/2 flex h-11 w-11 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border-0 bg-ghost-bg text-xl font-bold text-ghost-text shadow-[0_4px_0_var(--color-ghost-shadow)] transition-transform duration-100 hover:bg-ghost-hover active:scale-[0.96]"
      aria-label="ホームへ戻る"
      onClick={onClick}
    >
      <ArrowLeftIcon />
    </button>
  );
}
