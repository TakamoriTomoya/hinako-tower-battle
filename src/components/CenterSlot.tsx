import type { ReactNode } from "react";

interface Props {
  children: ReactNode;
}

// 中心エリアの中身(タイトル/勝者名など)を、決まった位置に表示する
export function CenterSlot({ children }: Props) {
  return (
    <div className="text-outline pointer-events-none absolute top-[30%] left-1/2 w-max -translate-x-1/2 -translate-y-1/2 text-center font-heading text-[34px] leading-[1.15] font-extrabold text-white">
      {children}
    </div>
  );
}
