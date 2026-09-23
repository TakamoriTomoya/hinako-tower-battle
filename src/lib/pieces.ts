import {
  ALPHA_THRESHOLD,
  MASK_GRID_STEP,
  PIECE_HEIGHT,
  SIMPLIFY_EPSILON,
  pieceImageSrc,
} from "./constants";
import { extractOutline, polygonCentroid, type Point } from "./geometry";
import { PIECE_IMAGE_FILES } from "./pieceSizes";

export interface Piece {
  src: string;
  img: HTMLImageElement;
  sizeScale: number;
  ready: boolean;
  hullLocal: Point[] | null;
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
  const centroid = polygonCentroid(piece.hullLocal);
  piece.imageOffsetX = -centroid.x;
  piece.imageOffsetY = -centroid.y;
}

export function loadPieceImages(onEachLoad: () => void): Piece[] {
  return PIECE_IMAGE_FILES.map(({ file, sizeScale }) => {
    const src = pieceImageSrc(file);
    const piece: Piece = {
      src,
      img: new Image(),
      sizeScale,
      ready: false,
      hullLocal: null,
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
