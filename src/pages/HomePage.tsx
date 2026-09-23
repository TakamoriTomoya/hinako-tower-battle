import { CenterSlot } from "../components/CenterSlot";
import { StartButton } from "../components/StartButton";
import type { PageSlots } from "../components/BasePage";

interface Props {
  onStart: () => void;
}

// pages/ はマウント/アンマウントされる画面コンポーネントではなく、
// 「このフェーズならBasePageの3スロットに何を入れるか」を決める関数。
// canvasはBasePage側に1つだけ存在し続けるので、画面切り替えで再生成されない。
export function HomePage({ onStart }: Props): PageSlots {
  return {
    center: (
      <CenterSlot>
        ひなこ
        <br />
        タワーバトル
      </CenterSlot>
    ),
    bottom: <StartButton onStart={onStart} />,
  };
}
