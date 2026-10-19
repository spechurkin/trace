import { canFillCrimeRole, type InvestigationNode } from './contracts';
import type { InvestigationPlan } from './schema';

// Role edits must also remove selections that no longer belong in either list.
export function reconcileCrimeRoles(
  plan: InvestigationPlan,
  nodes: InvestigationNode[],
): InvestigationPlan {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const eligible = (id: string, role: 'victimId' | 'culpritIds') => {
    const node = byId.get(id);
    return !!node && canFillCrimeRole(node, role);
  };
  const victimId =
    plan.crime.victimId && eligible(plan.crime.victimId, 'victimId') ? plan.crime.victimId : null;
  const culpritIds = plan.crime.culpritIds.filter((id) => eligible(id, 'culpritIds'));
  if (victimId === plan.crime.victimId && culpritIds.length === plan.crime.culpritIds.length)
    return plan;
  return { ...plan, crime: { ...plan.crime, victimId, culpritIds } };
}
