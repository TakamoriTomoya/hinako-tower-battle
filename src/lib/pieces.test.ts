import { describe, expect, it } from "vitest";
import { PieceBag, pickRandomPiece, type Piece } from "./pieces";

function makePiece(overrides: Partial<Piece>): Piece {
  return {
    src: "dummy.png",
    name: "dummy",
    img: {} as HTMLImageElement,
    sizeScale: 1,
    ready: false,
    hullLocal: null,
    convexParts: null,
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

describe("PieceBag", () => {
  const pieces = ["a", "b", "c", "d"].map((src) => makePiece({ src, ready: true, hullLocal: [{ x: 0, y: 0 }] }));

  it("一通り出し切るまで同じ駒を出さず、袋をまたいでも連続しない", () => {
    const bag = new PieceBag();
    let last: string | undefined;
    for (let round = 0; round < 50; round++) {
      const seen = new Set<string>();
      for (let i = 0; i < pieces.length; i++) {
        const p = bag.next(pieces, last);
        expect(p.src).not.toBe(last);
        seen.add(p.src);
        last = p.src;
      }
      expect(seen.size).toBe(pieces.length);
    }
  });

  it("選べる駒が1種類だけならそれを返す", () => {
    const bag = new PieceBag();
    expect(bag.next([pieces[0]], "a")).toBe(pieces[0]);
  });
});
