// 凹んだ輪郭を、当たり判定に使える凸多角形の集まりに分割する。
//
// Matter.jsの標準(Bodies.fromVertices内部のpoly-decompのquickDecomp)は、特定の形の多角形で
// 警告も出さずにほぼ空の結果を返すことがある(例: もうふひなこの輪郭で、面積の99.9%が消えて駒がすり抜けた)。
// そのため分割結果の面積を元の輪郭と照らし合わせ、合わなければ始点をずらしてやり直し、
// それでもだめなら必ず成功する三角形分割(耳切り法)に切り替える。

import decomp from "poly-decomp";
import type { Point } from "./geometry";

const AREA_TOLERANCE = 0.001; // 分割後の面積の合計が、元の面積とこの割合以内で一致すれば成功とみなす(0.1%)
const MAX_ROTATION_ATTEMPTS = 8;

type Vec = [number, number];

function signedArea(poly: Vec[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

function toPoints(poly: Vec[]): Point[] {
  return poly.map(([x, y]) => ({ x, y }));
}

export function decomposeToConvex(outline: Point[]): Point[][] {
  const base: Vec[] = outline.map((p) => [p.x, p.y]);
  decomp.makeCCW(base);
  decomp.removeCollinearPoints(base, 0.01);
  decomp.removeDuplicatePoints(base, 0.01);
  const totalArea = Math.abs(signedArea(base));
  if (base.length < 3 || totalArea === 0) return [outline];

  for (let attempt = 0; attempt < MAX_ROTATION_ATTEMPTS; attempt++) {
    // 始点をずらす(quickDecompの結果は始点によって変わる)
    const shift = Math.floor((attempt * base.length) / MAX_ROTATION_ATTEMPTS);
    const rotated = base.slice(shift).concat(base.slice(0, shift)).map((p) => [p[0], p[1]] as Vec);
    const parts = decomp.quickDecomp(rotated) as Vec[][];
    const partsArea = parts.reduce((sum, part) => sum + Math.abs(signedArea(part)), 0);
    if (parts.length > 0 && Math.abs(partsArea - totalArea) <= totalArea * AREA_TOLERANCE) {
      return parts.map(toPoints);
    }
  }
  return earClip(base).map(toPoints);
}

// 耳切り法による三角形分割。単純多角形(自己交差なし)なら必ず全面積を覆う。base は反時計回りが前提。
function earClip(base: Vec[]): Vec[][] {
  const pts = base.slice();
  const triangles: Vec[][] = [];
  const cross = (a: Vec, b: Vec, c: Vec) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (p: Vec, a: Vec, b: Vec, c: Vec) => cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;
  // makeCCWはy軸下向きの画面座標でも「符号付き面積が正」に揃えるので、耳の判定もその向きで行う
  const orientation = Math.sign(signedArea(pts)) || 1;

  let guard = pts.length * pts.length;
  while (pts.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (cross(a, b, c) * orientation <= 0) continue; // 凹んだ頂点は耳にならない
      const [oa, ob, oc] = orientation > 0 ? [a, b, c] : [c, b, a];
      const blocked = pts.some((p) => p !== a && p !== b && p !== c && inside(p, oa, ob, oc));
      if (blocked) continue;
      triangles.push([a, b, c]);
      pts.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // 数値誤差などで耳が見つからない場合は、残りをそのまま1つの多角形として扱う
  }
  if (pts.length >= 3) triangles.push(pts);
  return triangles.filter((t) => Math.abs(signedArea(t)) > 1e-9);
}
