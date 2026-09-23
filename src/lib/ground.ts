import {
  ALPHA_THRESHOLD,
  GROUND_IMAGE_SRC,
  GROUND_MASK_GRID_STEP,
  GROUND_SIMPLIFY_EPSILON,
  GROUND_W,
} from "./constants";
import { decomposeToConvex } from "./decompose";
import { extractOutline, polygonCentroid, type Point } from "./geometry";

export interface GroundOutline {
  outlineLocal: Point[]; // ゲーム内サイズに縮小済みの輪郭(重心を原点に補正する前)
  convexParts: Point[][]; // 当たり判定用に凸多角形へ分割したもの
  imageOffsetX: number;
  imageOffsetY: number;
}

export interface GroundAsset {
  image: HTMLImageElement;
  ready: boolean;
  outline: GroundOutline | null;
}

// 土台の輪郭(フランスパンの実際の形。両端の尖りも含む)を画像から求める
export function prepareGroundOutline(image: HTMLImageElement): GroundOutline | null {
  const outline = extractOutline(image, {
    gridStep: GROUND_MASK_GRID_STEP,
    alphaThreshold: ALPHA_THRESHOLD,
    simplifyEpsilon: GROUND_SIMPLIFY_EPSILON,
  });
  if (!outline) return null;

  // 土台の幅(GROUND_W)に合わせて縮小する(縦横比は変えない)
  const scale = GROUND_W / image.naturalWidth;
  const outlineLocal = outline.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  const centroid = polygonCentroid(outlineLocal);
  return {
    outlineLocal,
    convexParts: decomposeToConvex(outlineLocal),
    imageOffsetX: -centroid.x,
    imageOffsetY: -centroid.y,
  };
}

export function loadGroundImage(onReady: (asset: GroundAsset) => void): GroundAsset {
  const asset: GroundAsset = { image: new Image(), ready: false, outline: null };
  asset.image.onload = () => {
    asset.outline = prepareGroundOutline(asset.image);
    asset.ready = true;
    onReady(asset);
  };
  asset.image.src = GROUND_IMAGE_SRC;
  return asset;
}
