import { describe, expect, it } from "vitest";
import { decomposeToConvex } from "./decompose";
import type { Point } from "./geometry";

function area(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

describe("decomposeToConvex", () => {
  it("凹んだ多角形(U字)を、面積を失わずに分割する", () => {
    const u: Point[] = [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 30 }, { x: 20, y: 30 }, { x: 20, y: 0 },
      { x: 30, y: 0 }, { x: 30, y: 40 }, { x: 0, y: 40 },
    ];
    const parts = decomposeToConvex(u);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.reduce((s, p) => s + area(p), 0)).toBeCloseTo(area(u), 6);
  });
});
