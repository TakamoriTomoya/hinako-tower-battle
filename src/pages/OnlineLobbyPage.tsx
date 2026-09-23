import { CloseIcon } from "../components/icons";
import type { PageSlots } from "../components/BasePage";
import type { OnlineRoomStatus } from "../hooks/useOnlineRoom";

interface Props {
  status: OnlineRoomStatus;
  passphrase: string;
  history: string[]; // 直近に使った合言葉(新しい順)
  onPassphraseChange: (value: string) => void;
  onMatch: () => void;
  onBack: () => void; // 入力前の状態でホームへ戻る/やり直す
}

const panelClass =
  "pointer-events-auto absolute top-1/2 left-1/2 w-[280px] -translate-x-1/2 -translate-y-1/2 rounded-[24px] bg-bg-cream/95 px-6 py-7 text-center shadow-[0_6px_0_rgba(0,0,0,0.08)]";

const closeButtonClass =
  "absolute top-3 right-3 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-text-light transition-transform duration-100 hover:bg-black/5 active:scale-[0.9]";

const inputClass =
  "w-full rounded-[14px] border-2 border-frame-yellow bg-white px-4 py-3 text-center font-body text-base text-text-dark outline-none focus:border-secondary";

const primaryButtonClass =
  "w-full cursor-pointer rounded-[18px] border-0 bg-green px-4 py-3 font-heading text-base font-bold text-white shadow-[0_4px_0_var(--color-green-shadow)] transition-transform duration-100 hover:bg-green-hover active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50";

const historyChipClass =
  "max-w-full cursor-pointer truncate rounded-full border-2 border-frame-yellow bg-white px-3 py-1 font-body text-sm text-text-dark transition-transform duration-100 active:scale-[0.95]";

export function OnlineLobbyPage(props: Props): PageSlots {
  return {
    center: (
      <div className={panelClass}>
        {/* ばつボタン: 部屋を抜けてホームへ戻る */}
        <button type="button" className={closeButtonClass} aria-label="とじる" onClick={props.onBack}>
          <CloseIcon size={18} />
        </button>
        {renderBody(props)}
      </div>
    ),
  };
}

function renderBody({ status, passphrase, history, onPassphraseChange, onMatch, onBack }: Props) {
  switch (status.step) {
    case "connected":
      return <StatusMessage title="つながりました！" />;
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
          <button type="button" className={primaryButtonClass} onClick={onMatch} disabled={!passphrase.trim()}>
            対戦する
          </button>
          {history.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-xs text-text-light">最近の合言葉</p>
              <div className="flex flex-wrap justify-center gap-2">
                {history.map((p) => (
                  <button key={p} type="button" className={historyChipClass} onClick={() => onPassphraseChange(p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      );
  }
}

function StatusMessage({ title }: { title: string }) {
  return <p className="font-heading text-lg font-bold text-text-dark">{title}</p>;
}
