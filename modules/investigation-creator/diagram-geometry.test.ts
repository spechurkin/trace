import { expect, it } from 'vitest';
import { edgeHitsFootprint, edgesCross, footprintsOverlap, segmentsIntersect } from './diagram-geometry';

it('detects crossings, touching segments and collinear overlaps, while permitting separate segments', () => {
  expect(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
  ).toBe(true);
  expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 0 }, { x: 15, y: 0 })).toBe(
    true,
  );
  expect(
    segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }),
  ).toBe(true);
  expect(segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 1 }, { x: 10, y: 1 })).toBe(
    false,
  );
});
it('allows incident tree edges to meet and rejects coincident rays', () => {
  const edge = { id: 'a', parentId: null, a: { x: 0, y: 0 }, b: { x: 10, y: 0 } };
  expect(edgesCross(edge, { id: 'b', parentId: null, a: edge.a, b: { x: 0, y: 10 } })).toBe(false);
  expect(edgesCross(edge, { id: 'b', parentId: null, a: edge.a, b: { x: 20, y: 0 } })).toBe(true);
  expect(edgesCross(edge, { id: 'b', parentId: 'a', a: edge.b, b: { x: 20, y: 0 } })).toBe(false);
});
it('checks captions separately from bodies and catches lines passing only through a caption', () => {
  const size = { radius: 40, labelWidth: 140, labelTop: 45, labelBottom: 65 };
  expect(footprintsOverlap({ x: 0, y: 0 }, size, { x: 115, y: 50 }, size)).toBe(false);
  expect(footprintsOverlap({ x: 0, y: 0 }, size, { x: 100, y: 50 }, size)).toBe(true);
  expect(
    edgeHitsFootprint(
      { id: 'a', parentId: 'b', a: { x: -100, y: 55 }, b: { x: 100, y: 55 } },
      { x: 0, y: 0 },
      size,
    ),
  ).toBe(true);
  expect(
    edgeHitsFootprint(
      { id: 'a', parentId: 'b', a: { x: -100, y: 80 }, b: { x: 100, y: 80 } },
      { x: 0, y: 0 },
      size,
    ),
  ).toBe(false);
});
