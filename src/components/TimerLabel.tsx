interface Props {
  seconds: number;
}

// ヘッダー右側に表示する残り時間。切れる直前(3秒以下)は強調色にする
export function TimerLabel({ seconds }: Props) {
  const isUrgent = seconds <= 3;
  return (
    <span className={`font-heading text-2xl font-bold ${isUrgent ? "text-primary" : "text-white"} text-outline`}>{seconds}</span>
  );
}
