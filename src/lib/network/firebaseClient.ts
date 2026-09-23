// Firebase Realtime Databaseの初期化。
// オンライン対戦機能を使う時だけ呼ばれるため、envが未設定の場合は分かりやすいエラーを投げる
// (パスプレイのみで使うユーザーがFirebaseプロジェクトを持っていなくても、アプリ自体は問題なく動く)。

import { initializeApp, type FirebaseApp } from "firebase/app";
import { getDatabase, type Database } from "firebase/database";

let app: FirebaseApp | null = null;
let db: Database | null = null;

function readConfig() {
  const env = import.meta.env;
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    databaseURL: env.VITE_FIREBASE_DATABASE_URL,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const missing = Object.entries(config).filter(([, v]) => !v);
  if (missing.length > 0) {
    throw new Error(
      "オンライン対戦の設定(Firebase環境変数)が見つかりません。.env.localにVITE_FIREBASE_*を設定してください。",
    );
  }
  return config;
}

export function getFirebaseDatabase(): Database {
  if (!db) {
    app = initializeApp(readConfig());
    db = getDatabase(app);
  }
  return db;
}
