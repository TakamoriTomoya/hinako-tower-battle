import { CenterSlot } from "../components/CenterSlot";
import { VersionLabel } from "../components/VersionLabel";
import type { PageSlots } from "../components/BasePage";

interface Props {
  onStart: () => void;
  onStartOnline: () => void;
}

// pages/ はマウント/アンマウントされる画面コンポーネントではなく、
// 「このフェーズならBasePageの3スロットに何を入れるか」を決める関数。
// canvasはBasePage側に1つだけ存在し続けるので、画面切り替えで再生成されない。
export function HomePage({ onStart, onStartOnline }: Props): PageSlots {
  return {
    header: (
      <div className="grid w-full grid-cols-[30%_60%_10%] items-center px-6">
        <div aria-hidden="true" />
        <div aria-hidden="true" />
        <div className="flex justify-center">
          <VersionLabel />
        </div>
      </div>
    ),
    center: (
      <CenterSlot>
        ひなこ
        <br />
        タワーバトル
      </CenterSlot>
    ),
    bottom: (
      <div className="flex w-full -translate-y-12 flex-col items-center gap-4 px-6">
        <button
          type="button"
          className="pointer-events-auto w-full max-w-[280px] cursor-pointer rounded-full border-0 bg-primary py-4 font-heading text-lg font-bold text-white shadow-[0_4px_0_var(--color-primary-shadow)] transition-transform duration-100 hover:bg-primary-hover active:scale-[0.96]"
          onClick={onStart}
        >
          ローカルで対戦
        </button>
        <button
          type="button"
          className="pointer-events-auto w-full max-w-[280px] cursor-pointer rounded-full border-0 bg-secondary py-4 font-heading text-lg font-bold text-text-dark shadow-[0_4px_0_var(--color-secondary-shadow)] transition-transform duration-100 hover:bg-secondary-hover active:scale-[0.96]"
          onClick={onStartOnline}
        >
          オンラインで対戦
        </button>
      </div>
    ),
  };
}
