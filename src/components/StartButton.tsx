interface Props {
  onStart: () => void;
}

export function StartButton({ onStart }: Props) {
  return (
    <div className="flex justify-center">
      <button
        className="pointer-events-auto flex h-[72px] w-[72px] cursor-pointer items-center justify-center rounded-full border-0 bg-primary pl-1 text-3xl text-white shadow-[0_4px_0_var(--color-primary-shadow)] transition-transform duration-100 hover:bg-primary-hover active:scale-[0.96]"
        aria-label="はじめる"
        onClick={onStart}
      >
        ▶
      </button>
    </div>
  );
}
