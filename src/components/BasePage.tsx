import type { ReactNode, RefObject } from "react";
import { GameCanvas } from "./GameCanvas";

// 各画面(pages/)が埋める3つのスロット。中身が無いスロットはundefinedのままでよい。
export interface PageSlots {
  header?: ReactNode; // ヘッダーエリア: canvasの上に置く小さな帯(例: ターン表示)
  center?: ReactNode; // 中心エリア: canvasの中央に重ねるメッセージ(例: タイトル/勝者名)
  bottom?: ReactNode; // ボトムメニューエリア: canvasの下に置く操作ボタン
}

interface Props extends PageSlots {
  canvasRef: RefObject<HTMLCanvasElement | null>;
}

// 全フェーズ共通の1つのベース画面。青空の背景・土台と駒を描く共有canvasは
// 常にこの1箇所だけに存在し、画面が切り替わっても再マウントされない。
// 各pageはこのスロットに何を入れるかを決めるだけ。
export function BasePage({ canvasRef, header, center, bottom }: Props) {
  return (
    <div className="relative h-dvh w-full overflow-hidden bg-play-sky">
      <GameCanvas canvasRef={canvasRef}>{center}</GameCanvas>
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-[15%] items-center justify-center pt-[max(1rem,env(safe-area-inset-top))]">
        {header}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-[15%] items-center justify-center pb-[max(1rem,env(safe-area-inset-bottom))]">
        {bottom}
      </div>
    </div>
  );
}
