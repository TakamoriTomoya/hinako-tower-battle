import type { PropsWithChildren, RefObject } from "react";

interface Props {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

// ホーム画面もバトル画面も、この同じcanvas(土台+駒の描画)をそのまま共有する。
// 画面ごとの違いは、この上に重ねるchildren(タイトル/勝敗表示など)だけ。
export function GameCanvas({ canvasRef, children }: PropsWithChildren<Props>) {
  return (
    <div className="absolute inset-0 overflow-hidden">
      {/*
        widthやheight・CSSでの拡大縮小はJS側(TowerBattleEngine)に一任する。
        描画バッファの実サイズは毎フレームこの要素の実測サイズに合わせて張り直すため、
        object-fit等の暗黙スケーリングには頼らない。
      */}
      <canvas id="gameCanvas" className="absolute inset-0 touch-none bg-transparent" ref={canvasRef} />
      {children}
    </div>
  );
}
