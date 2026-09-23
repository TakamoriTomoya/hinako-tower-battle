import {
  ALPHA_THRESHOLD,
  MASK_GRID_STEP,
  PIECE_HEIGHT,
  SIMPLIFY_EPSILON,
  pieceImageSrc,
} from "./constants";
import { decomposeToConvex } from "./decompose";
import { extractOutline, polygonCentroid, type Point } from "./geometry";
import { PIECE_IMAGE_FILES } from "./pieceCatalog";

export interface Piece {
  src: string;
  name: string;
  img: HTMLImageElement;
  sizeScale: number;
  ready: boolean;
  hullLocal: Point[] | null;
  convexParts: Point[][] | null; // hullLocalを当たり判定用に凸多角形へ分割したもの(読み込み時に1回だけ計算)
  w: number;
  h: number;
  imageOffsetX: number;
  imageOffsetY: number;
}

// 画像の輪郭からゲーム内サイズのhullを作り、描画オフセットを求める。
// (当たり判定の重心と写真の見た目をぴったり一致させるためのオフセット)
function prepareHull(piece: Piece): void {
  const outline = extractOutline(piece.img, {
    gridStep: MASK_GRID_STEP,
    alphaThreshold: ALPHA_THRESHOLD,
    simplifyEpsilon: SIMPLIFY_EPSILON,
  }) ?? [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 0, y: 1 },
  ];

  const scale = (PIECE_HEIGHT * piece.sizeScale) / piece.img.naturalHeight;
  piece.w = piece.img.naturalWidth * scale;
  piece.h = piece.img.naturalHeight * scale;

  piece.hullLocal = outline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  piece.convexParts = decomposeToConvex(piece.hullLocal);
  const centroid = polygonCentroid(piece.hullLocal);
  piece.imageOffsetX = -centroid.x;
  piece.imageOffsetY = -centroid.y;
}

export function loadPieceImages(onEachLoad: () => void): Piece[] {
  return PIECE_IMAGE_FILES.map(({ file, name, sizeScale }) => {
    const src = pieceImageSrc(file);
    const piece: Piece = {
      src,
      name,
      img: new Image(),
      sizeScale,
      ready: false,
      hullLocal: null,
      convexParts: null,
      w: 0,
      h: 0,
      imageOffsetX: 0,
      imageOffsetY: 0,
    };
    piece.img.onload = () => {
      prepareHull(piece);
      piece.ready = true;
      onEachLoad();
    };
    piece.img.src = src;
    return piece;
  });
}

export function pickRandomPiece(pieces: Piece[]): Piece {
  const ready = pieces.filter((p) => p.ready && p.hullLocal);
  const pool = ready.length > 0 ? ready : pieces;
  return pool[Math.floor(Math.random() * pool.length)];
}

// 「袋」方式で駒を選ぶ: 全種類を1回ずつ袋に入れてシャッフルし、上から順に出す。空になったら詰め直す。
// 毎回独立にランダムで選ぶと同じキャラが続きやすいため、一通り出るまでは同じキャラが出ないようにする。
// 袋の詰め直しをまたいでも、avoidSrc(直前のキャラ)は先頭に来ないよう後ろへ回す。
export class PieceBag {
  private bag: Piece[] = [];

  next(pieces: Piece[], avoidSrc?: string): Piece {
    const ready = pieces.filter((p) => p.ready && p.hullLocal);
    const pool = ready.length > 0 ? ready : pieces;
    // 袋に残っているうち、今使えるものだけを対象にする(読み込み中だった駒は次の詰め直しで入る)
    this.bag = this.bag.filter((p) => pool.includes(p));
    if (this.bag.length === 0) this.bag = shuffle([...pool]);
    let index = this.bag.findIndex((p) => p.src !== avoidSrc);
    if (index < 0) {
      // 袋の残りが避けたいキャラだけなら、詰め直した新しい袋から選ぶ
      this.bag = [...this.bag, ...shuffle(pool.filter((p) => !this.bag.includes(p)))];
      index = this.bag.findIndex((p) => p.src !== avoidSrc);
      if (index < 0) index = 0; // 選べるキャラが1種類しかない
    }
    return this.bag.splice(index, 1)[0];
  }
}

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
