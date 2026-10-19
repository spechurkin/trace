import { afterEach, expect, it } from 'vitest';
import { setLocale } from '../shared/i18n';
import { demoDatabase } from '../src/demo';
import { buildInvestigationDiagram } from '../modules/investigation-creator/diagram';
import { applyCreatorDiagram } from '../src/creator-diagram';
import { diagramMetrics } from './diagram-metrics';

afterEach(() => setLocale('en'));
it('checks the dead witness example, including rendered curves', () => {
  setLocale('ru');
  const data = demoDatabase(),
    original = data.boards[0];
  const assembled = applyCreatorDiagram(
    { ...original, layout: {} },
    buildInvestigationDiagram(original.investigation!, data.characters, [], { random: () => 0.3 }),
  );
  const before = diagramMetrics(original, data.characters),
    after = diagramMetrics(assembled, data.characters);
  expect(before.curved).toHaveLength(0);
  expect(after.nodes).toBe(32);
  // Bound both crossings and length to retain a compact assembled layout.
  expect(after.curved.length).toBeLessThanOrEqual(3);
  expect(after.longest).toBeLessThan(700);
});
