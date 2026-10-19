import { expect, it } from 'vitest';
import type { Connection } from '../shared/model';
import { CULPRIT } from '../shared/investigation';
import { edgeGeometry, type Point } from '../src/geometry';
import { type EdgePath, obstacleHits, routeEdges, straightGeometry } from '../src/edge-routing';
import { pathCrossings } from './diagram-metrics';

const edge = (id: string, sourceId = 'a', targetId = 'b'): Connection => ({
  id,
  sourceId,
  targetId,
  directed: true,
  typeId: 'evidence',
  notes: '',
});
const positions = (other: Point) =>
  new Map([
    ['a', { x: -240, y: 0 }],
    ['b', { x: 240, y: 0 }],
    ['obstacle', other],
  ]);
const bent: EdgePath = {
  path: 'M -201 0 Q 0 -200 192 0',
  label: { x: 0, y: -100 },
  samples: [
    { x: -201, y: 0 },
    { x: 0, y: -100 },
    { x: 192, y: 0 },
  ],
};

it('uses a straight route through free space and clips the arrow at node borders', () => {
  const e = edge('open');
  const path = edgeGeometry(e, [e], positions({ x: 0, y: 160 }));
  expect(path.path).toBe('M -201 0 L 192 0');
  expect(path.label).toEqual({ x: -4.5, y: 0 });
});

it('does not bend around empty space below a caption', () => {
  const e = edge('below-caption');
  // The caption ends at y=-5; the former 74px box blocked this clear route.
  const path = edgeGeometry(e, [e], positions({ x: 0, y: -70 }));
  expect(path.path).toBe('M -201 0 L 192 0');
});

it.each([
  { x: 0, y: 0 },
  { x: 0, y: -54 },
  { x: 73, y: -54 },
])('keeps detours around a node or caption at %j', (obstacle) => {
  const e = edge(`blocked-${obstacle.x}-${obstacle.y}`),
    p = positions(obstacle);
  expect(obstacleHits(e, straightGeometry(e, p), p)).toBe(1);
  const path = edgeGeometry(e, [e], p);
  expect(path.path).not.toBe(straightGeometry(e, p).path);
  expect(obstacleHits(e, path, p)).toBe(0);
});

it('checks the whole segment even when the obstacle falls between widely spaced endpoints', () => {
  const e = edge('long');
  const p = new Map([
    ['a', { x: -4000, y: 0 }],
    ['b', { x: 4000, y: 0 }],
    ['obstacle', { x: 125, y: 0 }],
  ]);
  expect(obstacleHits(e, straightGeometry(e, p), p)).toBe(1);
});

it('straightens a conflict-free detour after routing', () => {
  const e = edge('relax'),
    p = positions({ x: 0, y: 160 });
  const paths = routeEdges([e], p, new Map([[e.id, bent]]));
  expect(paths.get(e.id)?.path).toBe('M -201 0 L 192 0');
});

it('uses the displayed caption width and invalidates cached geometry when the text changes', () => {
  const e = edge('caption-width'),
    p = new Map([
      ['a', { x: -240, y: -100 }],
      ['b', { x: 240, y: 100 }],
      ['obstacle', { x: 60, y: -54 }],
    ]);
  const narrow = new Map([['obstacle', 30]]),
    wide = new Map([['obstacle', 90]]);
  const direct = straightGeometry(e, p);
  expect(obstacleHits(e, direct, p, narrow)).toBe(0);
  expect(obstacleHits(e, direct, p, wide)).toBe(1);
  expect(edgeGeometry(e, [e], p, narrow).path).toBe(direct.path);
  expect(edgeGeometry(e, [e], p, wide).path).not.toBe(direct.path);
  expect(edgeGeometry(e, [e], p, narrow).path).toBe(direct.path);
});

it('keeps a detour when straightening it would cross another route', () => {
  const a = edge('horizontal'),
    b = edge('vertical', 'c', 'd');
  const p = new Map([
    ['a', { x: -240, y: 0 }],
    ['b', { x: 240, y: 0 }],
    ['c', { x: 0, y: -180 }],
    ['d', { x: 0, y: 180 }],
  ]);
  const detour: EdgePath = {
    path: 'detour',
    label: { x: 0, y: -260 },
    samples: [
      { x: -201, y: 0 },
      { x: -150, y: -260 },
      { x: 150, y: -260 },
      { x: 192, y: 0 },
    ],
  };
  const paths = routeEdges(
    [a, b],
    p,
    new Map([
      [a.id, detour],
      [b.id, straightGeometry(b, p)],
    ]),
  );
  expect(paths.get(a.id)).toBe(detour);
  expect(pathCrossings([a, b].map((e) => ({ ...e, ...paths.get(e.id)! })))).toBe(0);
});

it('retains separate lanes for parallel and reversed arrows', () => {
  const a = edge('forward'),
    b = edge('back', 'b', 'a');
  const p = positions({ x: 0, y: 160 });
  expect(edgeGeometry(a, [a, b], p).path).toContain('Q');
  expect(edgeGeometry(b, [a, b], p).path).toContain('Q');
  expect(edgeGeometry(a, [a, b], p).label.y).not.toBe(edgeGeometry(b, [a, b], p).label.y);
});

it('leaves clearance for the central culprit and its lower caption', () => {
  const e = edge('culprit-caption'),
    p = new Map([
      ['a', { x: -240, y: 77 }],
      ['b', { x: 240, y: 77 }],
      [CULPRIT, { x: 0, y: 0 }],
    ]);
  expect(obstacleHits(e, straightGeometry(e, p), p)).toBe(1);
});
