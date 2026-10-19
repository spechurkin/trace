import type { InvestigationNode } from './contracts';
import { type CreatorLocale, type CreatorMessage, messages } from './messages';
import type { InvestigationPlan } from './schema';

export function auditLabels(
  plan: InvestigationPlan,
  nodes: InvestigationNode[],
  locale: CreatorLocale,
) {
  const t = messages(locale);
  const labels = new Map(nodes.map((node) => [node.id, node.name.trim() || t('auditUnnamed')]));
  for (const conclusion of plan.conclusions)
    labels.set(conclusion.id, conclusion.text.trim() || t('auditUnnamed'));
  const nodeLabel = (id: string) => labels.get(id) || t('auditMissing');
  plan.timeline.forEach((row, index) =>
    labels.set(
      row.id,
      t('auditTimeLabel', nodeLabel(row.nodeId), index + 1, row.period || t('none')),
    ),
  );
  plan.ordering.forEach((row, index) =>
    labels.set(
      row.id,
      t('auditOrderLabel', index + 1, nodeLabel(row.beforeId), nodeLabel(row.afterId)),
    ),
  );
  const collections: [CreatorMessage, { id: string }[]][] = [
    ['evidence', plan.evidence],
    ['access', plan.access],
    ['travel', plan.travel],
    ['versionRows', plan.versions],
  ];
  for (const [key, rows] of collections)
    rows.forEach((row, index) => {
      if (!labels.has(row.id)) labels.set(row.id, t('auditRecordLabel', t(key), index + 1));
    });
  return nodeLabel;
}
