// 駒の画像ごとの大きさ設定。
// sizeScaleは基準の高さ(PIECE_HEIGHT)に対する倍率。画像から自動計算はできないので、
// 見た目のバランスを見ながらここで手動調整する。
// 新しい画像ファイルを追加したら、ここに{file, sizeScale}を追記する。

export interface PieceImageDef {
  file: string;
  sizeScale: number;
}

export const PIECE_IMAGE_FILES: PieceImageDef[] = [
  { file: "IMG_5388.PNG", sizeScale: 0.8 },
  { file: "IMG_5389.PNG", sizeScale: 1.0 },
  { file: "IMG_5390.PNG", sizeScale: 0.9 },
  { file: "IMG_5420.PNG", sizeScale: 0.9 },
  { file: "2C60643C-D607-450C-896E-B01BE80B8D9C.PNG", sizeScale: 0.85 },
  { file: "79608400-2234-43CE-8C43-8D6843DE2461.PNG", sizeScale: 1.35 },
  { file: "D4C9D14C-5D68-4006-8C7C-54A66E659A9D.PNG", sizeScale: 1.2 },
  { file: "F78FC116-C52B-4EA9-81AB-190E46281DD6.PNG", sizeScale: 1.25 },
];
