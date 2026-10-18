export interface DiagramFootprint {
  radius: number;
  labelWidth: number;
  labelTop: number;
  labelBottom: number;
}

export interface Point {
  x: number;
  y: number;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface DiagramEdge {
  id: string;
  parentId: string | null;
  a: Point;
  b: Point;
}

export function footprintBoxes(p: Point, size: DiagramFootprint): Rect[] {
  return [
    {
      left: p.x - size.radius,
      right: p.x + size.radius,
      top: p.y - size.radius,
      bottom: p.y + size.radius,
    },
    {
      left: p.x - size.labelWidth / 2,
      right: p.x + size.labelWidth / 2,
      top: p.y + size.labelTop,
      bottom: p.y + size.labelBottom,
    },
  ];
}

export function footprintsOverlap(a: Point, as: DiagramFootprint, b: Point, bs: DiagramFootprint) {
  return footprintBoxes(a, as).some((x) =>
    footprintBoxes(b, bs).some(
      (y) => x.left < y.right && x.right > y.left && x.top < y.bottom && x.bottom > y.top,
    ),
  );
}

const cross = (a: Point, b: Point, c: Point) =>
  (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
const between = (a: Point, b: Point, p: Point) =>
  p.x >= Math.min(a.x, b.x) - 1e-7 &&
  p.x <= Math.max(a.x, b.x) + 1e-7 &&
  p.y >= Math.min(a.y, b.y) - 1e-7 &&
  p.y <= Math.max(a.y, b.y) + 1e-7;

export function segmentsIntersect(a: Point, b: Point, c: Point, d: Point) {
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (
    (Math.abs(abC) < 1e-7 && between(a, b, c)) ||
    (Math.abs(abD) < 1e-7 && between(a, b, d)) ||
    (Math.abs(cdA) < 1e-7 && between(c, d, a)) ||
    (Math.abs(cdB) < 1e-7 && between(c, d, b))
  );
}

export function edgesCross(a: DiagramEdge, b: DiagramEdge) {
  const shared = [a.id, a.parentId].find((id) => id === b.id || id === b.parentId);
  if (shared !== undefined) {
    const origin = shared === a.id ? a.b : a.a;
    const endA = shared === a.id ? a.a : a.b,
      endB = shared === b.id ? b.a : b.b;
    // Incident edges may meet at their parent, but may not run along the same ray.
    return (
      Math.abs(cross(origin, endA, endB)) < 1e-7 &&
      (endA.x - origin.x) * (endB.x - origin.x) + (endA.y - origin.y) * (endB.y - origin.y) > 0
    );
  }
  return segmentsIntersect(a.a, a.b, b.a, b.b);
}

export function edgeHitsFootprint(edge: DiagramEdge, point: Point, size: DiagramFootprint) {
  return footprintBoxes(point, size).some((r) => {
    const inside = (p: Point) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
    const tl = { x: r.left, y: r.top },
      tr = { x: r.right, y: r.top };
    const bl = { x: r.left, y: r.bottom },
      br = { x: r.right, y: r.bottom };
    return (
      inside(edge.a) ||
      inside(edge.b) ||
      segmentsIntersect(edge.a, edge.b, tl, tr) ||
      segmentsIntersect(edge.a, edge.b, tr, br) ||
      segmentsIntersect(edge.a, edge.b, br, bl) ||
      segmentsIntersect(edge.a, edge.b, bl, tl)
    );
  });
}
