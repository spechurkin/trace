import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { InvestigationAssistant } from './Assistant';
import type { InvestigationNode } from './contracts';
import { auditInvestigation } from './engine';
import { emptyPlan } from './schema';
import { formatAuditTime } from './time-details';

function scenario() {
  const plan = emptyPlan();
  const nodes: InvestigationNode[] = [
    { id: 'first-node', name: 'First event', kind: 'event' },
    { id: 'next-node', name: 'Next event', kind: 'event' },
    { id: 'actor', name: 'Actor', kind: 'person' },
    { id: 'source', name: 'Source', kind: 'location' },
    { id: 'destination', name: 'Destination', kind: 'location' },
  ];
  plan.timeline = [
    {
      id: 'first-time',
      nodeId: 'first-node',
      personIds: ['actor'],
      locationId: 'source',
      period: 'Night',
      earliest: 187,
      latest: 189,
      duration: 1,
      kind: 'event',
      certainty: 'confirmed',
    },
    {
      id: 'next-time',
      nodeId: 'next-node',
      personIds: ['actor'],
      locationId: 'destination',
      period: 'Night',
      earliest: 205,
      latest: 210,
      duration: 0,
      kind: 'alibi',
      certainty: 'confirmed',
    },
  ];
  plan.travel = [{ id: 'trip', fromId: 'source', toId: 'destination', minutes: 18 }];
  const board = { characterIds: nodes.map((n) => n.id), investigation: plan };
  const audit = (locale: 'ru' | 'en' = 'en') =>
    auditInvestigation(board, nodes, locale).issues.filter((i) => i.group === 'timeline');
  return { plan, board, nodes, audit };
}

describe('numerical time diagnostics', () => {
  it.each(['en', 'ru'] as const)(
    'explains compatible uncertain ranges as information in %s',
    (locale) => {
      const s = scenario();
      const original = structuredClone(s.plan);
      const issues = s.audit(locale);
      expect(issues.filter((i) => i.severity !== 'info')).toEqual([]);
      const issue = issues.find((i) => i.code === 'timeAmbiguous')!;
      expect(issue.severity).toBe('info');
      const details = issue.details!.join('\n');
      for (const expected of [
        '03:07–03:09',
        '03:08–03:10',
        '03:25–03:30',
        '18',
        '15–22',
        '03:26–03:28',
        '03:26–03:30',
      ])
        expect(details).toContain(expected);
      expect(details).toContain(locale === 'ru' ? '\u043c\u043e\u0436\u043d\u043e \u043f\u043e\u0434\u043e\u0436\u0434\u0430\u0442\u044c' : 'Waiting');
      for (const id of ['first-node', 'next-node', 'first-time', 'next-time', 'trip'])
        expect(details).not.toContain(id);
      expect(s.plan).toEqual(original);
    },
  );

  it('reports a real travel contradiction with the missing minutes', () => {
    const s = scenario();
    s.plan.timeline[1].latest = 205;
    const issue = s.audit('ru').find((i) => i.code === 'alibiConflict')!;
    expect(issue.severity).toBe('error');
    expect(issue.details!.join('\n')).toContain(
      '\u0441\u0430\u043c\u043e\u0435 \u0440\u0430\u043d\u043d\u0435\u0435 \u043f\u0440\u0438\u0431\u044b\u0442\u0438\u0435 03:26 \u043f\u043e\u0437\u0436\u0435 \u0441\u0430\u043c\u043e\u0433\u043e \u043f\u043e\u0437\u0434\u043d\u0435\u0433\u043e \u043d\u0430\u0447\u0430\u043b\u0430 03:25 \u043d\u0430 1 \u043c\u0438\u043d',
    );
  });

  it('carries the end time and travel across midnight', () => {
    const s = scenario();
    Object.assign(s.plan.timeline[0], { earliest: 1437, latest: 1439, duration: 2 });
    Object.assign(s.plan.timeline[1], { earliest: 1443, latest: 1448 });
    s.plan.travel[0].minutes = 5;
    const details = s
      .audit()
      .find((i) => i.code === 'timeAmbiguous')!
      .details!.join('\n');
    expect(details).toContain('23:59–1/00:01');
    expect(details).toContain('1/00:04–1/00:06');
    expect(details).toContain('1/00:03–1/00:08');
  });

  it('shows required and actual gaps for an impossible ordering constraint', () => {
    const s = scenario();
    s.plan.ordering = [
      { id: 'order', beforeId: 'first-time', afterId: 'next-time', minGap: 1, maxGap: 2 },
    ];
    const details = s
      .audit('ru')
      .find((i) => i.code === 'temporalCycle')!
      .details!.join('\n');
    expect(details).toContain('\u0422\u0440\u0435\u0431\u0443\u0435\u0442\u0441\u044f \u043f\u0440\u043e\u043c\u0435\u0436\u0443\u0442\u043e\u043a \u043f\u043e\u0441\u043b\u0435 \u043e\u043a\u043e\u043d\u0447\u0430\u043d\u0438\u044f: 1–2 \u043c\u0438\u043d');
    expect(details).toContain('\u043f\u0440\u043e\u043c\u0435\u0436\u0443\u0442\u043e\u043a \u0441\u043e\u0441\u0442\u0430\u0432\u043b\u044f\u0435\u0442 15–22 \u043c\u0438\u043d');
    expect(details).toContain('03:09–03:12');
    expect(details).toContain('\u0424\u0430\u043a\u0442\u0438\u0447\u0435\u0441\u043a\u0438 \u0437\u0430\u0434\u0430\u043d\u043d\u043e\u0435 \u043d\u0430\u0447\u0430\u043b\u043e: 03:25–03:30');
  });

  it('describes overlapping records and each impossible direction', () => {
    const s = scenario();
    for (const row of s.plan.timeline) {
      row.earliest = 0;
      row.latest = 0;
      row.duration = 30;
    }
    const details = s
      .audit()
      .find((i) => i.code === 'alibiConflict')!
      .details!.join('\n');
    expect(details).toContain('available gap of -30 min');
    expect(details.match(/Even the earliest arrival/g)).toHaveLength(2);
  });

  it('uses bounds tightened by ordering and does not claim a correlated conflict is a travel shortfall', () => {
    const s = scenario();
    for (const row of s.plan.timeline) {
      row.earliest = 0;
      row.latest = 60;
      row.duration = 30;
    }
    s.plan.ordering = [
      { id: 'same-start', beforeId: 'first-time', afterId: 'next-time', minGap: -30, maxGap: -30 },
    ];
    const details = s
      .audit()
      .find((i) => i.code === 'alibiConflict')!
      .details!.join('\n');
    expect(details).toContain('impossible together with the other temporal constraints');
    expect(details).not.toContain('Even the earliest arrival');
    s.plan.ordering = [
      { id: 'sequential', beforeId: 'first-time', afterId: 'next-time', minGap: 18, maxGap: null },
    ];
    expect(
      s
        .audit()
        .find((i) => i.code === 'timeAmbiguous')!
        .details!.join('\n'),
    ).toContain('Ordering constraints narrow');
  });

  it('shows actual reversed bounds for invalid time and gap ranges', () => {
    const s = scenario();
    s.plan.timeline[0].earliest = 200;
    s.plan.ordering = [
      { id: 'invalid-order', beforeId: 'first-time', afterId: 'next-time', minGap: 10, maxGap: 5 },
    ];
    const issues = s.audit('ru').filter((i) => i.code === 'timeRange');
    expect(issues).toHaveLength(2);
    expect(issues.flatMap((i) => i.details!).join('\n')).toContain('03:20–03:09');
    expect(issues.flatMap((i) => i.details!).join('\n')).toContain(
      '\u043c\u0438\u043d\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 \u043f\u0440\u043e\u043c\u0435\u0436\u0443\u0442\u043e\u043a 10 \u043c\u0438\u043d, \u043c\u0430\u043a\u0441\u0438\u043c\u0430\u043b\u044c\u043d\u044b\u0439 5 \u043c\u0438\u043d',
    );
  });

  it.each(['ru', 'en'] as const)('renders calculation details in the report in %s', (locale) => {
    const s = scenario();
    const html = renderToStaticMarkup(
      createElement(InvestigationAssistant, {
        board: s.board,
        nodes: s.nodes,
        locale,
        initialStep: 'timeline',
        mode: 'audit',
        onSave: () => {
        },
        onClose: () => {
        },
      }),
    );
    expect(html).toContain('ic-time-details');
    expect(html).toContain('03:26–03:28');
    expect(html).toContain('15–22');
  });

  it.each([
    [1450, '1/00:10'],
    [-10, '-1/23:50'],
    [1.5, '00:01:30'],
    [1 / 120, '00:00:00.5'],
  ] as const)('formats day offsets and fractional minutes: %s', (value, expected) => {
    expect(formatAuditTime(value)).toBe(expected);
  });
});
