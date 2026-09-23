import { version } from "../../package.json";

// ホーム画面ヘッダー右側に表示する、現在のアプリバージョン(package.jsonから取得)
export function VersionLabel() {
  return <span className="font-heading text-xs text-white/70">v{version}</span>;
}
