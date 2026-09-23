import { useEffect, useState } from "react";

interface Props {
  ready: boolean; // 土台・駒の画像読み込みが完了したらtrue
}

const FADE_OUT_MS = 500;

// 読み込み完了(ready)になった瞬間に消すと唐突なので、
// 透明度を下げてフェードアウトさせてからDOMから取り除く
export function LoadingOverlay({ ready }: Props) {
  const [mounted, setMounted] = useState(true);

  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setMounted(false), FADE_OUT_MS);
    return () => clearTimeout(timer);
  }, [ready]);

  if (!mounted) return null;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-play-sky transition-opacity ease-out ${
        ready ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
      style={{ transitionDuration: `${FADE_OUT_MS}ms` }}
    >
      <span className="animate-pulse font-heading text-lg font-bold text-white">よみこみちゅう…</span>
    </div>
  );
}
