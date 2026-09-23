// 直近に使った合言葉をlocalStorageに保存し、ロビーで選び直せるようにする。
// プライベートブラウズ等でlocalStorageが使えなくても動作に支障が出ないよう、失敗は握りつぶす。

const STORAGE_KEY = "hinako-tower-battle:passphrase-history";
const MAX_ENTRIES = 5;

export function loadPassphraseHistory(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, MAX_ENTRIES) : [];
  } catch {
    return [];
  }
}

// 使った合言葉を先頭に追加する(重複は前の方を消す)。更新後の一覧を返す。
export function savePassphraseToHistory(passphrase: string): string[] {
  const value = passphrase.trim();
  const next = [value, ...loadPassphraseHistory().filter((p) => p !== value)].slice(0, MAX_ENTRIES);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // 保存できなくても対戦自体は続行できる
  }
  return next;
}
