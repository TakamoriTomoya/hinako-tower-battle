import { version } from "../../package.json";

// ホーム画面ヘッダー右側に表示する、現在のアプリバージョン(package.jsonから取得)
export function VersionLabel() {
  return <span className="font-heading text-sm text-white text-outline">v{version}</span>;
}
