import { describe, expect, it } from "vitest";
import { convexHull, polygonCentroid, simplifyPolygon, traceContour } from "./geometry";

describe("convexHull", () => {
  it("囲む点だけを残し、内側の点は除外する", () => {
    const hull = convexHull([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
      { x: 2, y: 2 }, // 内側の点
    ]);

    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual({ x: 2, y: 2 });
  });
});

describe("traceContour", () => {
  it("2x2の塗りつぶしグリッドから外周を1周たどる", () => {
    const grid = [
      [1, 1],
      [1, 1],
    ];
    const loop = traceContour(grid, 2, 2);
    expect(loop.length).toBeGreaterThanOrEqual(4);
  });

  it("塗りセルがなければ空配列を返す", () => {
    const grid = [
      [0, 0],
      [0, 0],
    ];
    expect(traceContour(grid, 2, 2)).toEqual([]);
  });
});

describe("simplifyPolygon", () => {
  it("直線上に近い点を間引く", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 1, y: 0.01 },
      { x: 2, y: 0 },
    ];
    const simplified = simplifyPolygon(points, 1);
    expect(simplified).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("3点未満はそのまま返す", () => {
    const points = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(simplifyPolygon(points, 1)).toEqual(points);
  });
});

describe("polygonCentroid", () => {
  it("正方形の重心は中心になる", () => {
    const centroid = polygonCentroid([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
    ]);
    expect(centroid.x).toBeCloseTo(1);
    expect(centroid.y).toBeCloseTo(1);
  });
});
