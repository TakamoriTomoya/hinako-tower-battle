import { BackButton } from "../components/BackButton";
import type { PageSlots } from "../components/BasePage";
import type { OnlineRoomStatus } from "../hooks/useOnlineRoom";

interface Props {
  status: OnlineRoomStatus;
  passphrase: string;
  onPassphraseChange: (value: string) => void;
  onCreate: () => void;
  onJoin: () => void;
  onBack: () => void; // 入力前の状態でホームへ戻る/やり直す
}

const panelClass =
  "pointer-events-auto absolute top-1/2 left-1/2 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-bg-cream/95 px-6 py-7 text-center shadow-[0_6px_0_rgba(0,0,0,0.08)]";

const inputClass =
  "w-full rounded-[14px] border-2 border-frame-yellow bg-white px-4 py-3 text-center font-body text-base text-text-dark outline-none focus:border-secondary";

const primaryButtonClass =
  "w-full cursor-pointer rounded-[18px] border-0 bg-primary px-4 py-3 font-heading text-base font-bold text-white shadow-[0_4px_0_var(--color-primary-shadow)] transition-transform duration-100 hover:bg-primary-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClass =
  "w-full cursor-pointer rounded-[18px] border-0 bg-ghost-bg px-4 py-3 font-heading text-base font-bold text-ghost-text shadow-[0_4px_0_var(--color-ghost-shadow)] transition-transform duration-100 hover:bg-ghost-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

export function OnlineLobbyPage({ status, passphrase, onPassphraseChange, onCreate, onJoin, onBack }: Props): PageSlots {
  return {
    header: <BackButton onClick={onBack} />,
    center: <div className={panelClass}>{renderBody(status, passphrase, onPassphraseChange, onCreate, onJoin, onBack)}</div>,
  };
}

function renderBody(
  status: OnlineRoomStatus,
  passphrase: string,
  onPassphraseChange: (value: string) => void,
  onCreate: () => void,
  onJoin: () => void,
  onBack: () => void,
) {
  switch (status.step) {
    case "creating":
      return <StatusMessage title="部屋を作っています…" />;
    case "joining":
      return <StatusMessage title="部屋に入っています…" />;
    case "connected":
      return <StatusMessage title="つながりました！" />;
    case "waiting-for-guest":
      return (
        <>
          <p className="mb-2 font-heading text-lg font-bold text-text-dark">相手の入室を待っています…</p>
          <p className="mb-5 text-sm text-text-light">合言葉「{passphrase}」を相手に伝えてください</p>
          <button type="button" className={secondaryButtonClass} onClick={onBack}>
            やめる
          </button>
        </>
      );
    case "disconnected":
      return (
        <>
          <p className="mb-5 font-heading text-base font-bold text-text-dark">相手との接続が切れました</p>
          <button type="button" className={primaryButtonClass} onClick={onBack}>
            ホームへ戻る
          </button>
        </>
      );
    case "error":
      return (
        <>
          <p className="mb-5 font-heading text-base font-bold text-text-dark">{status.message}</p>
          <button type="button" className={primaryButtonClass} onClick={onBack}>
            やり直す
          </button>
        </>
      );
    case "idle":
    default:
      return (
        <>
          <p className="mb-4 font-heading text-lg font-bold text-text-dark">合言葉で対戦</p>
          <input
            className={`${inputClass} mb-4`}
            type="text"
            inputMode="text"
            placeholder="合言葉を入力"
            value={passphrase}
            onChange={(e) => onPassphraseChange(e.target.value)}
            maxLength={30}
          />
          <div className="flex flex-col gap-3">
            <button type="button" className={primaryButtonClass} onClick={onCreate} disabled={!passphrase.trim()}>
              部屋を作る
            </button>
            <button type="button" className={secondaryButtonClass} onClick={onJoin} disabled={!passphrase.trim()}>
              部屋に入る
            </button>
          </div>
        </>
      );
  }
}

function StatusMessage({ title }: { title: string }) {
  return <p className="font-heading text-lg font-bold text-text-dark">{title}</p>;
}
