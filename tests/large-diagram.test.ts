import { afterEach, expect, it } from 'vitest';
import { setLocale } from '../shared/i18n';
import { demoDatabase } from '../src/demo';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { applyCreatorDiagram } from '../src/creator-diagram';
import { diagramMetrics } from './diagram-metrics';
import { stationDatabase } from '../src/station-demo';

afterEach(() => setLocale('en'));
it('checks both real complex examples, including rendered curves', () => {
  setLocale('ru');
  const data = demoDatabase(),
    original = data.boards[0];
  const assembled = applyCreatorDiagram(
    { ...original, layout: {} },
    buildInvestigationDiagram(original.investigation!, data.characters, [], { random: () => 0.3 }),
  );
  const before = diagramMetrics(original, data.characters),
    after = diagramMetrics(assembled, data.characters);
  const station = stationDatabase('ru'),
    stationMetrics = diagramMetrics(station.boards[0], station.characters);
  expect(before.curved).toHaveLength(0);
  expect(after.nodes).toBe(32);
  expect(stationMetrics.nodes).toBe(27);
  // Bound both crossings and length; reducing contextual shortcuts must retain
  // the compact layouts and the station's independent and returning paths.
  expect(after.curved.length).toBeLessThanOrEqual(3);
  expect(stationMetrics.curved.length).toBeLessThanOrEqual(3);
  expect(after.longest).toBeLessThan(700);
  expect(stationMetrics.longest).toBeLessThan(650);
});
