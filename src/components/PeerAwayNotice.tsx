// オンライン対戦中に相手が抜けている間だけ出す案内。対戦画面の操作の邪魔にならないよう上寄りに小さく置く。
export function PeerAwayNotice() {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-[18%] flex justify-center px-4">
      <p className="rounded-full bg-bg-cream/95 px-4 py-2 text-center font-heading text-sm font-bold text-text-dark shadow-[0_4px_0_rgba(0,0,0,0.08)]">
        相手が抜けました。同じ合言葉で入り直すと再開できます
      </p>
    </div>
  );
}
