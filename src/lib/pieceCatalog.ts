// 駒の画像ごとの設定。
// sizeScaleは基準の高さ(PIECE_HEIGHT)に対する倍率。画像から自動計算はできないので、
// 見た目のバランスを見ながらここで手動調整する。
// nameはゲーム画面ヘッダーに表示する駒の名前(仮名。好きな名前に書き換えてよい)。
// 新しい画像ファイルを追加したら、ここに{file, name, sizeScale}を追記する。

export interface PieceImageDef {
  file: string;
  name: string;
  sizeScale: number;
}

export const PIECE_IMAGE_FILES: PieceImageDef[] = [
  { file: "boy-hinako.PNG", name: "しょうねんひなこ", sizeScale: 1.2 },
  { file: "dance-hinako.PNG", name: "だんすひなこ", sizeScale: 1.1 },
  { file: "gassho-hinako.PNG", name: "がっしょうひなこ", sizeScale: 1.0 },
  // { file: "goo-hinako.PNG", name: "ぐぅーひなこ", sizeScale: 0.6 },
  { file: "gorori-hinako.PNG", name: "ごろりひなこ", sizeScale: 1.0 },
  { file: "gyaku-hinako.PNG", name: "ぎゃくぅひなこ", sizeScale: 1.6 },
  { file: "lego-hinako.PNG", name: "れごひなこ", sizeScale: 1.4 },
  { file: "mouhu-hinako.PNG", name: "もうふひなこ", sizeScale: 0.8 },
  { file: "neko-hinako.PNG", name: "ねこひなこ", sizeScale: 0.7 },
  // { file: "panpan-hinako.PNG", name: "ぱんぱんひなこ", sizeScale: 1.2 },
  { file: "perm-hinako.PNG", name: "ぱーまひなこ", sizeScale: 1.0 },
  // { file: "red-hinako.PNG", name: "あかひなこ", sizeScale: 1.2 },
  { file: "sit-hinako.PNG", name: "おすわりひなこ", sizeScale: 0.8 },
  // { file: "sorori-hinako.PNG", name: "そろりひなこ", sizeScale: 1.2 },
  { file: "tako-hinako.PNG", name: "たこひなこ", sizeScale: 1.0 },
  // { file: "yazirusi-hinako.PNG", name: "やじるしひなこ", sizeScale: 1.4 },
];
