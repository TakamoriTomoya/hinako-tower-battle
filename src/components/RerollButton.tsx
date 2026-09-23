interface Props {
  remaining: number;
  onClick: () => void;
}

// 落とすキャラをランダムに変更するボタン。1試合につき残り回数が0になったら呼び出し側が非表示にする
export function RerollButton({ remaining, onClick }: Props) {
  return (
    <button
      type="button"
      className="pointer-events-auto flex h-11 w-[60px] cursor-pointer items-center justify-center gap-1 rounded-[18px] border-0 bg-ghost-bg font-heading text-base font-bold text-ghost-text shadow-[0_4px_0_var(--color-ghost-shadow)] transition-transform duration-100 hover:bg-ghost-hover active:scale-[0.96]"
      aria-label="落とすキャラをランダムに変更"
      onClick={onClick}
    >
      <span className="text-xl leading-none">⇄</span>
      <span>{remaining}</span>
    </button>
  );
}
