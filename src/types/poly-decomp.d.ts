declare module "poly-decomp" {
  type Polygon = [number, number][];
  const decomp: {
    makeCCW(polygon: Polygon): boolean;
    removeCollinearPoints(polygon: Polygon, thresholdAngle?: number): number;
    removeDuplicatePoints(polygon: Polygon, precision?: number): void;
    quickDecomp(polygon: Polygon): Polygon[];
  };
  export default decomp;
}
