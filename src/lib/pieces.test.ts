import { describe, expect, it } from "vitest";
import { pickRandomPiece, type Piece } from "./pieces";

function makePiece(overrides: Partial<Piece>): Piece {
  return {
    src: "dummy.png",
    name: "dummy",
    img: {} as HTMLImageElement,
    sizeScale: 1,
    ready: false,
    hullLocal: null,
    w: 0,
    h: 0,
    imageOffsetX: 0,
    imageOffsetY: 0,
    ...overrides,
  };
}

describe("pickRandomPiece", () => {
  it("読み込み済み(ready かつ hullLocal あり)の駒だけから選ぶ", () => {
    const notReady = makePiece({ name: "not-ready", ready: false });
    const readyA = makePiece({ name: "ready-a", ready: true, hullLocal: [{ x: 0, y: 0 }] });
    const readyB = makePiece({ name: "ready-b", ready: true, hullLocal: [{ x: 0, y: 0 }] });

    for (let i = 0; i < 20; i++) {
      const picked = pickRandomPiece([notReady, readyA, readyB]);
      expect(picked).not.toBe(notReady);
    }
  });

  it("readyな駒が1つもなければ全体から選ぶ(フォールバック)", () => {
    const a = makePiece({ name: "a", ready: false });
    const b = makePiece({ name: "b", ready: false });

    const picked = pickRandomPiece([a, b]);
    expect([a, b]).toContain(picked);
  });

  it("readyでもhullLocalがnullなら選ばれない", () => {
    const readyNoHull = makePiece({ name: "ready-no-hull", ready: true, hullLocal: null });
    const readyWithHull = makePiece({ name: "ready-with-hull", ready: true, hullLocal: [{ x: 0, y: 0 }] });

    for (let i = 0; i < 20; i++) {
      expect(pickRandomPiece([readyNoHull, readyWithHull])).toBe(readyWithHull);
    }
  });
});
