import { expect, it } from 'vitest';
import { canFillCrimeRole, type InvestigationNode } from './contracts';
import { reconcileCrimeRoles } from './crime-roles';
import { emptyPlan } from './schema';

const nodes: InvestigationNode[] = [
  { id: 'legacy', name: 'Legacy suspect' },
  { id: 'suspect', name: 'Suspect', kind: 'person', suspect: true },
  { id: 'witness', name: 'Witness', kind: 'person', suspect: false, witness: true },
  { id: 'victim', name: 'Victim', kind: 'person', suspect: false, victim: true },
  { id: 'both', name: 'Victim and suspect', kind: 'person', suspect: true, victim: true },
  {
    id: 'victimWitness',
    name: 'Victim and witness',
    kind: 'person',
    suspect: false,
    witness: true,
    victim: true,
  },
  { id: 'evidence', name: 'Evidence', kind: 'evidence', suspect: true, victim: true },
];

it('allows all witnesses and suspects to be responsible, but excludes victim-only people', () => {
  expect(nodes.filter((n) => canFillCrimeRole(n, 'victimId')).map((n) => n.id)).toEqual([
    'victim',
    'both',
    'victimWitness',
  ]);
  expect(nodes.filter((n) => canFillCrimeRole(n, 'culpritIds')).map((n) => n.id)).toEqual([
    'legacy',
    'suspect',
    'witness',
    'both',
    'victimWitness',
  ]);
});

it('removes incompatible saved choices after role changes without changing other plan content', () => {
  const plan = emptyPlan();
  plan.crime = {
    ...plan.crime,
    victimId: 'witness',
    culpritIds: nodes.map((n) => n.id),
    motive: 'Keep this',
  };
  const result = reconcileCrimeRoles(plan, nodes);
  expect(result.crime).toEqual({
    ...plan.crime,
    victimId: null,
    culpritIds: ['legacy', 'suspect', 'witness', 'both', 'victimWitness'],
  });
  expect(result.conclusions).toBe(plan.conclusions);
  expect(plan.crime.victimId).toBe('witness');
  result.crime.victimId = 'victim';
  expect(reconcileCrimeRoles(result, nodes)).toBe(result);
  const changed = nodes.map((n) =>
    n.id === 'suspect' ? { ...n, victim: true } : n.id === 'victim' ? { ...n, victim: false } : n,
  );
  expect(reconcileCrimeRoles(result, changed).crime).toEqual({
    ...result.crime,
    victimId: null,
    culpritIds: ['legacy', 'suspect', 'witness', 'both', 'victimWitness'],
  });
  const withoutSuspect = changed.map((n) => (n.id === 'suspect' ? { ...n, suspect: false } : n));
  expect(reconcileCrimeRoles(result, withoutSuspect).crime.culpritIds).toEqual([
    'legacy',
    'witness',
    'both',
    'victimWitness',
  ]);
});
