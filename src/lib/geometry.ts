// 画像の輪郭抽出まわりの純粋関数群。
// 駒(pieces.ts)と土台(ground.ts)の両方から使われる共通ロジック。

export interface Point {
  x: number;
  y: number;
}

// 点群から凸包(すべての点を囲む、とがった角だけを結んだ輪郭)を求める。
// 輪郭抽出に失敗した場合の非常用フォールバックとしてのみ使う。
export function convexHull(points: Point[]): Point[] {
  const pts = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

interface Edge {
  from: Point;
  to: Point;
}

// 2値グリッドから輪郭を抽出する。
// 各塗りセルの「背景と接する辺」をすべて集め、端点が一致する辺同士をつないで
// 1周のループにする(セルからセルへ辿る方式よりも確実に一周できる)。
export function traceContour(grid: number[][], gridW: number, gridH: number): Point[] {
  const isFilled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < gridW && y < gridH && grid[y][x] === 1;

  const edges: Edge[] = [];
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (!isFilled(gx, gy)) continue;
      if (!isFilled(gx, gy - 1)) edges.push({ from: { x: gx, y: gy }, to: { x: gx + 1, y: gy } }); // 上辺
      if (!isFilled(gx + 1, gy)) edges.push({ from: { x: gx + 1, y: gy }, to: { x: gx + 1, y: gy + 1 } }); // 右辺
      if (!isFilled(gx, gy + 1)) edges.push({ from: { x: gx + 1, y: gy + 1 }, to: { x: gx, y: gy + 1 } }); // 下辺
      if (!isFilled(gx - 1, gy)) edges.push({ from: { x: gx, y: gy + 1 }, to: { x: gx, y: gy } }); // 左辺
    }
  }
  if (edges.length === 0) return [];

  const key = (p: Point) => `${p.x},${p.y}`;
  const byStart = new Map<string, Edge[]>();
  edges.forEach((e) => {
    const k = key(e.from);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k)!.push(e);
  });

  const used = new Set<Edge>();
  let bestLoop: Point[] = [];
  edges.forEach((startEdge) => {
    if (used.has(startEdge)) return;
    const loop: Point[] = [];
    let current: Edge | undefined = startEdge;
    let guard = edges.length + 4;
    while (current && !used.has(current) && guard-- > 0) {
      used.add(current);
      loop.push(current.from);
      const candidates: Edge[] = byStart.get(key(current.to)) ?? [];
      current = candidates.find((c: Edge) => !used.has(c));
    }
    if (loop.length > bestLoop.length) bestLoop = loop;
  });
  return bestLoop;
}

// Douglas-Peucker法で折れ線(閉じたループ)の頂点数を間引く
export function simplifyPolygon(points: Point[], epsilon: number): Point[] {
  if (points.length < 3) return points;
  const perpDist = (p: Point, a: Point, b: Point) => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
    return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
  };
  const dp = (pts: Point[]): Point[] => {
    if (pts.length < 3) return pts;
    let maxDist = 0;
    let index = 0;
    for (let i = 1; i < pts.length - 1; i++) {
      const d = perpDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > maxDist) {
        maxDist = d;
        index = i;
      }
    }
    if (maxDist > epsilon) {
      const left = dp(pts.slice(0, index + 1));
      const right = dp(pts.slice(index));
      return left.slice(0, -1).concat(right);
    }
    return [pts[0], pts[pts.length - 1]];
  };
  return dp(points);
}

// 多角形の面積重心(頂点の単純平均ではなく、面積で重み付けした正しい重心)
export function polygonCentroid(pts: Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p0 = pts[i];
    const p1 = pts[(i + 1) % pts.length];
    const cross = p0.x * p1.y - p1.x * p0.y;
    area += cross;
    cx += (p0.x + p1.x) * cross;
    cy += (p0.y + p1.y) * cross;
  }
  area *= 0.5;
  if (Math.abs(area) < 1e-6) {
    const sum = pts.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / pts.length, y: sum.y / pts.length };
  }
  return { x: cx / (6 * area), y: cy / (6 * area) };
}

export interface ExtractOutlineOptions {
  gridStep: number;
  alphaThreshold: number;
  simplifyEpsilon: number;
}

// 画像の不透明部分から輪郭(凹みも含む)を抽出する。
// 1. アルファ値をグリッド化して2値マスクにする
// 2. traceContourで輪郭をたどる
// 3. simplifyPolygonで頂点数を間引く
// 4. 失敗した場合は塗りセルの凸包にフォールバックする
// 戻り値は元画像のピクセル座標系(グリッド単位を掛け戻した値)。
export function extractOutline(image: HTMLImageElement, options: ExtractOutlineOptions): Point[] | null {
  const { gridStep, alphaThreshold, simplifyEpsilon } = options;
  const off = document.createElement("canvas");
  off.width = image.naturalWidth;
  off.height = image.naturalHeight;
  const octx = off.getContext("2d")!;
  octx.drawImage(image, 0, 0);
  const { data } = octx.getImageData(0, 0, off.width, off.height);
  const w = off.width;
  const h = off.height;

  const gridW = Math.ceil(w / gridStep);
  const gridH = Math.ceil(h / gridStep);
  const grid: number[][] = [];
  for (let gy = 0; gy < gridH; gy++) {
    const row = new Array(gridW).fill(0);
    for (let gx = 0; gx < gridW; gx++) {
      const px = Math.min(w - 1, gx * gridStep + (gridStep >> 1));
      const py = Math.min(h - 1, gy * gridStep + (gridStep >> 1));
      row[gx] = data[(py * w + px) * 4 + 3] > alphaThreshold ? 1 : 0;
    }
    grid.push(row);
  }

  const traced = traceContour(grid, gridW, gridH);
  if (traced.length >= 3) {
    const simplified = simplifyPolygon(traced, simplifyEpsilon);
    if (simplified.length >= 3) {
      // traceContourはセルの「角」の座標を返すので、そのままグリッド間隔倍すればよい
      return simplified.map((p) => ({ x: p.x * gridStep, y: p.y * gridStep }));
    }
  }

  // 輪郭抽出に失敗した場合は凸包にフォールバック
  const points: Point[] = [];
  for (let gy = 0; gy < gridH; gy++) {
    for (let gx = 0; gx < gridW; gx++) {
      if (grid[gy][gx]) points.push({ x: gx * gridStep, y: gy * gridStep });
    }
  }
  if (points.length < 3) return null;
  return convexHull(points).map((p) => ({ x: p.x, y: p.y }));
}
