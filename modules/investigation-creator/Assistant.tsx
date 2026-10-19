import { type ReactNode, useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react';
import { creatorSchema, emptyPlan, type InvestigationPlan } from './schema';
import { buildInvestigationDiagram, DiagramPlacementError } from './diagram';
import type { InvestigationDiagram } from './contracts';
import {
  canFillCrimeRole,
  type CrimeRole,
  type InvestigationBoard,
  type InvestigationNode,
  kindOf,
  type NodeKind,
} from './contracts';
import { type AuditGroup, auditInvestigation, suggestVersions } from './engine';
import { reconcileCrimeRoles } from './crime-roles';
import { type CreatorLocale, type CreatorMessage, messages } from './messages';
import './assistant.css';

const steps: AuditGroup[] = [
  'crime',
  'matrix',
  'timeline',
  'reachability',
  'deadEnds',
  'versions',
  'completeness',
];
type Option = { id: string; name: string };
type Spec = {
  key: string;
  label: CreatorMessage;
  type?: 'text' | 'number' | 'nullableNumber' | 'select' | 'multi' | 'check' | 'clock';
  options?: Option[];
};
type Row = Record<string, unknown> & { id: string };
type Translator = ReturnType<typeof messages>;

export function formatTime(value: number) {
  const day = Math.floor(value / 1440),
    remainder = value - day * 1440;
  const clock = `${String(Math.floor(remainder / 60)).padStart(2, '0')}:${String(remainder % 60).padStart(2, '0')}`;
  return day === 0 ? clock : `${day}/${clock}`;
}

export function parseTime(value: string): number | null {
  const match = /^\s*(?:(-?\d+)\/)?(\d{1,2}):(\d{2})\s*$/.exec(value);
  if (!match || Number(match[2]) > 23 || Number(match[3]) > 59) return null;
  const result = Number(match[1] || 0) * 1440 + Number(match[2]) * 60 + Number(match[3]);
  return Math.abs(result) <= 100000000 ? result : null;
}

function Clock({
                 id,
                 value,
                 onChange,
                 t,
               }: {
  value: number;
  id: string;
  onChange: (v: number) => void;
  t: Translator;
}) {
  const [input, setInput] = useState(formatTime(value));
  const valid = parseTime(input) !== null;
  return (
    <>
      <input
        id={id}
        value={input}
        aria-invalid={!valid}
        onChange={(e) => {
          setInput(e.target.value);
          const result = parseTime(e.target.value);
          if (result !== null) onChange(result);
        }}
        onBlur={() => {
          if (valid) setInput(formatTime(value));
        }}
      />
      {!valid && <small role="alert">{t('timeError')}</small>}
    </>
  );
}

function Fields({
                  specs,
                  row,
                  onChange,
                  t,
                }: {
  specs: Spec[];
  row: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  t: Translator;
}) {
  const fieldId = useId();
  return (
    <div className="ic-fields">
      {specs.map((spec) => {
        const value = row[spec.key],
          options = spec.options || [],
          id = `${fieldId}-${spec.key}`;
        if (spec.type === 'multi')
          return (
            <fieldset key={spec.key} className="ic-field ic-choices">
              <legend>{t(spec.label)}</legend>
              {options.length ? (
                options.map((o) => (
                  <label key={o.id}>
                    <input
                      type="checkbox"
                      checked={(value as string[]).includes(o.id)}
                      onChange={(e) =>
                        onChange(
                          spec.key,
                          e.target.checked
                            ? [...(value as string[]), o.id]
                            : (value as string[]).filter((id) => id !== o.id),
                        )
                      }
                    />
                    {o.name}
                  </label>
                ))
              ) : (
                <small>{t('none')}</small>
              )}
              {(value as string[])
                .filter((id) => !options.some((o) => o.id === id))
                .map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked
                      onChange={() =>
                        onChange(
                          spec.key,
                          (value as string[]).filter((v) => v !== id),
                        )
                      }
                    />
                    {id}
                  </label>
                ))}
            </fieldset>
          );
        return (
          <fieldset className="ic-field" key={spec.key}>
            <legend>
              <label htmlFor={id}>{t(spec.label)}</label>
            </legend>
            {spec.type === 'check' ? (
              <input
                id={id}
                type="checkbox"
                checked={!!value}
                onChange={(e) => onChange(spec.key, e.target.checked)}
              />
            ) : spec.type === 'select' ? (
              <select
                id={id}
                value={String(value ?? '')}
                onChange={(e) =>
                  onChange(
                    spec.key,
                    e.target.value ||
                    (['eventId', 'victimId', 'locationId', 'suspectId'].includes(spec.key) ||
                    (spec.key === 'conclusionId' && 'title' in row)
                      ? null
                      : ''),
                  )
                }
              >
                {!['truth', 'effect', 'certainty', 'kind'].includes(spec.key) && (
                  <option value="">{t('none')}</option>
                )}
                {options.map((o) => (
                  <option value={o.id} key={o.id}>
                    {o.name}
                  </option>
                ))}
                {value && !options.some((o) => o.id === value) ? (
                  <option value={String(value)}>{String(value)}</option>
                ) : null}
              </select>
            ) : spec.type === 'clock' ? (
              <Clock
                id={id}
                value={value as number}
                onChange={(v) => onChange(spec.key, v)}
                t={t}
              />
            ) : spec.type === 'number' || spec.type === 'nullableNumber' ? (
              <input
                id={id}
                type="number"
                value={(value as number) ?? ''}
                onChange={(e) =>
                  onChange(
                    spec.key,
                    spec.type === 'nullableNumber' && e.target.value === ''
                      ? null
                      : e.target.value === ''
                        ? NaN
                        : Number(e.target.value),
                  )
                }
              />
            ) : (
              <textarea
                id={id}
                aria-label={t(spec.label)}
                rows={2}
                maxLength={spec.key === 'period' ? 80 : 2000}
                value={String(value ?? '')}
                onChange={(e) => onChange(spec.key, e.target.value)}
              />
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

function Collection({
                      title,
                      rows,
                      specs,
                      create,
                      onChange,
                      t,
                    }: {
  title: CreatorMessage;
  rows: Row[];
  specs: Spec[];
  create: () => Row;
  onChange: (rows: Row[]) => void;
  t: Translator;
}) {
  const [expanded, setExpanded] = useState<string>();
  const display = (r: Row) =>
    String(
      r.text ||
      r.title ||
      specs.flatMap((s) => s.options || []).find((o) => o.id === r.nodeId || o.id === r.targetId)
        ?.name ||
      t(title),
    );
  return (
    <section className="ic-section">
      <div className="ic-section-heading">
        <h3>
          {t(title)} <span>{rows.length}</span>
        </h3>
        <button
          type="button"
          onClick={() => {
            const row = create();
            onChange([...rows, row]);
            setExpanded(row.id);
          }}
        >
          {t('add')}
        </button>
      </div>
      {rows.map((row, index) => (
        <details key={row.id} open={expanded === row.id}>
          <summary
            onClick={(e) => {
              e.preventDefault();
              setExpanded(expanded === row.id ? undefined : row.id);
            }}
          >
            {index + 1}. {display(row)}
          </summary>
          <Fields
            specs={specs}
            row={row}
            onChange={(key, value) =>
              onChange(rows.map((r) => (r.id === row.id ? { ...r, [key]: value } : r)))
            }
            t={t}
          />
          <button
            type="button"
            className="ic-remove"
            onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
          >
            {t('remove')}
          </button>
        </details>
      ))}
    </section>
  );
}

export interface AssistantProps<T extends InvestigationNode> {
  board: InvestigationBoard;
  nodes: T[];
  sourceNodes?: T[];
  locale: CreatorLocale;
  initialStep?: AuditGroup;
  mode?: 'create' | 'audit';
  onSave: (
    plan: InvestigationPlan,
    nodes: T[],
    close: boolean,
    diagram?: InvestigationDiagram,
  ) => void;
  onClose: () => void;
  renderNodeEditor?: (
    node: T | undefined,
    kind: NodeKind,
    save: (node: T) => void,
    cancel: () => void,
  ) => ReactNode;
}

export function InvestigationAssistant<T extends InvestigationNode>({
                                                                      board,
                                                                      nodes: initialNodes,
                                                                      sourceNodes,
                                                                      locale,
                                                                      initialStep = 'crime',
                                                                      mode = 'create',
                                                                      onSave,
                                                                      onClose,
                                                                      renderNodeEditor,
                                                                    }: AssistantProps<T>) {
  const t = messages(locale);
  const [step, setStep] = useState(steps.indexOf(initialStep));
  const [plan, setPlan] = useState(() =>
    reconcileCrimeRoles(
      structuredClone(board.investigation || emptyPlan()),
      initialNodes.filter((n) => board.characterIds.includes(n.id)),
    ),
  );
  const [nodes, setNodes] = useState(() =>
    initialNodes.filter((n) => board.characterIds.includes(n.id)),
  );
  const [editing, setEditing] = useState<{ node?: T; kind: NodeKind; locationId?: string }>();
  const [error, setError] = useState('');
  const [replaceManual, setReplaceManual] = useState(false);
  const report = useMemo(
    () =>
      auditInvestigation({ characterIds: nodes.map((n) => n.id), investigation: plan }, nodes, locale),
    [plan, nodes, locale],
  );
  const suggestions = useMemo(() => suggestVersions(plan, nodes), [plan, nodes]);
  const active = steps[step];
  const options = (kind?: NodeKind): Option[] =>
    nodes.filter((n) => !kind || kindOf(n) === kind).map((n) => ({ id: n.id, name: n.name }));
  const conclusions = plan.conclusions.map((c) => ({
    id: c.id,
    name: c.text || t('conclusionId'),
  }));
  const times = plan.timeline.map((r) => ({
    id: r.id,
    name: `${nodes.find((n) => n.id === r.nodeId)?.name || t('nodeId')} · ${r.period} · ${formatTime(r.earliest)}`,
  }));
  const enums = (...keys: CreatorMessage[]) => keys.map((id) => ({ id, name: t(id) }));
  const nodeSpec = (key: string, label: CreatorMessage, kind?: NodeKind, multi = false): Spec => ({
    key,
    label,
    type: multi ? 'multi' : 'select',
    options: options(kind),
  });
  const crimeRoleSpec = (role: CrimeRole): Spec => ({
    key: role,
    label: role,
    type: role === 'culpritIds' ? 'multi' : 'select',
    options: nodes
      .filter((node) => canFillCrimeRole(node, role))
      .map((node) => ({ id: node.id, name: node.name })),
  });
  const enumSpec = (key: string, label: CreatorMessage, ...keys: CreatorMessage[]): Spec => ({
    key,
    label,
    type: 'select',
    options: enums(...keys),
  });
  const patch = <K extends keyof InvestigationPlan>(key: K, value: InvestigationPlan[K]) =>
    setPlan((p) => ({ ...p, [key]: value }));
  const save = (close = false, assemble = false) => {
    if (document.querySelector('.investigation-assistant [aria-invalid="true"]')) {
      setError(t('timeError'));
      return false;
    }
    const parsed = creatorSchema.safeParse(reconcileCrimeRoles(plan, nodes));
    if (!parsed.success) {
      setError(
        `${t('saveError')} ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
      );
      return false;
    }
    try {
      const diagram = assemble
        ? buildInvestigationDiagram(parsed.data, nodes, board.diagram, {
          replaceManual,
          bounds: board.diagramBounds,
          footprints: board.diagramFootprints?.(nodes),
        })
        : undefined;
      onSave(parsed.data, nodes, close, diagram);
      setError('');
      return true;
    } catch (e) {
      setError(
        e instanceof DiagramPlacementError
          ? t('diagramSpaceError')
          : e instanceof Error
            ? e.message
            : t('saveError'),
      );
      return false;
    }
  };
  const lastDraft = useRef({ plan, nodes });
  const autoSave = useEffectEvent(() => save());
  const includeSources = useEffectEvent(() => {
    const existing = new Set(nodes.map((node) => node.id));
    const additions = (sourceNodes || []).filter((node) => {
      if (existing.has(node.id)) return false;
      existing.add(node.id);
      return true;
    });
    if (nodes.length + additions.length > 500) {
      setError(t('sourceLimit'));
      return;
    }
    setError((previous) => (previous === t('sourceLimit') ? '' : previous));
    if (!additions.length) return;
    const next = [...nodes, ...additions];
    setNodes(next);
    setPlan((previous) => reconcileCrimeRoles(previous, next));
  });
  useEffect(() => {
    includeSources();
  }, [sourceNodes]);
  useEffect(() => {
    // Only draft edits trigger saving; host save-status updates must not start another save.
    if (lastDraft.current.plan === plan && lastDraft.current.nodes === nodes) return;
    lastDraft.current = { plan, nodes };
    autoSave();
  }, [plan, nodes]);
  const collection = <
    K extends 'conclusions' | 'evidence' | 'access' | 'timeline' | 'ordering' | 'travel' | 'versions',
  >(
    key: K,
    title: CreatorMessage,
    specs: Spec[],
    create: () => InvestigationPlan[K][number],
  ) => (
    <Collection
      title={title}
      rows={plan[key]}
      specs={specs}
      create={() => create()}
      onChange={(rows) => patch(key, rows as InvestigationPlan[K])}
      t={t}
    />
  );
  const issues = report.issues.filter(
    (i) =>
      active === 'completeness' ||
      i.group === active ||
      (active === 'matrix' && i.code === 'threeClues'),
  );
  const reportView = (
    <section className="ic-section ic-report" aria-label={t('report')}>
      <h3>{t('report')}</h3>
      <div className="ic-stats">
        <span>
          {t('errors')} <b>{report.errors}</b>
        </span>
        <span>
          {t('warnings')} <b>{report.warnings}</b>
        </span>
        <span>
          {t('reached')}{' '}
          <b>
            {report.reached.size}/{nodes.length}
          </b>
        </span>
      </div>
      {issues.length ? (
        <ul>
          {issues.map((issue, i) => (
            <li key={i} className={`ic-issue ${issue.severity}`}>
              <strong>
                {issue.severity === 'error'
                  ? t('errors')
                  : issue.severity === 'warning'
                    ? t('warnings')
                    : t('recommendations')}
              </strong>
              <p>{t(`issue_${issue.code}` as CreatorMessage, ...issue.args)}</p>
              {issue.details && issue.details.length > 0 && (
                <ul className="ic-time-details">
                  {issue.details.map((detail, index) => <li key={index}>{detail}</li>)}
                </ul>
              )}
              <div className="ic-issue-actions">
                <button
                  type="button"
                  onClick={() =>
                    setStep(steps.indexOf(issue.code === 'threeClues' ? 'matrix' : issue.group))
                  }
                >
                  {t('edit')} · {t(issue.code === 'threeClues' ? 'matrix' : issue.group)}
                </button>
                {issue.code === 'threeClues' && renderNodeEditor && (
                  <button
                    type="button"
                    disabled={nodes.length >= 500}
                    onClick={() => setEditing({ kind: 'evidence', locationId: issue.ids[0] })}
                  >
                    {t('newNode')} · {t('evidenceNode')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p>{t('clean')}</p>
      )}
    </section>
  );
  if (editing && renderNodeEditor)
    return (
      <div className="investigation-assistant ic-node-editor">
        <h3>{t('newNode')}</h3>
        {renderNodeEditor(
          editing.node,
          editing.kind,
          (node) => {
            const nextNodes = nodes.some((n) => n.id === node.id)
              ? nodes.map((n) => (n.id === node.id ? node : n))
              : [...nodes, node];
            setNodes(nextNodes);
            setPlan((previous) => reconcileCrimeRoles(previous, nextNodes));
            if (editing.locationId)
              setPlan((previous) => ({
                ...previous,
                evidence: [
                  ...previous.evidence,
                  {
                    id: crypto.randomUUID(),
                    nodeId: node.id,
                    locationId: editing.locationId!,
                    conclusionId: '',
                    effect: 'supports',
                    certainty: 'confirmed',
                    explanation: node.answers?.meaning || '',
                  },
                ],
                access: [
                  ...previous.access,
                  {
                    id: crypto.randomUUID(),
                    targetId: node.id,
                    requires: [editing.locationId!],
                    conclusions: [],
                    method: node.answers?.found || '',
                  },
                ],
              }));
            setEditing(undefined);
          },
          () => setEditing(undefined),
        )}
      </div>
    );
  return (
    <div className="investigation-assistant">
      <p className="ic-scope">{t('scope')}</p>
      <nav className="ic-steps" aria-label={t(mode === 'audit' ? 'auditTitle' : 'title')}>
        {steps.map((s, i) => (
          <button
            key={s}
            type="button"
            aria-current={step === i ? 'step' : undefined}
            onClick={() => {
              if (save()) setStep(i);
            }}
          >
            {mode === 'create' && <span>{i + 1}</span>}
            {t(s)}
          </button>
        ))}
      </nav>
      <h2>
        {mode === 'create' ? `${step + 1}. ` : ''}
        {t(active)}
      </h2>
      <p className="ic-guidance">{t(`${active}Hint`)}</p>
      {mode === 'audit' && active === 'completeness' && reportView}
      {(active === 'crime' ||
          active === 'matrix' ||
          active === 'timeline' ||
          active === 'reachability') &&
        renderNodeEditor && (
          <section className="ic-section">
            <h3>{t('nodes')}</h3>
            <div className="ic-node-buttons">
              {(['person', 'evidence', 'location', 'event'] as const).map((kind) => (
                <button
                  type="button"
                  key={kind}
                  disabled={nodes.length >= 500}
                  onClick={() => setEditing({ kind })}
                >
                  {t('newNode')} · {t(kind === 'evidence' ? 'evidenceNode' : kind)}
                </button>
              ))}
            </div>
            <details>
              <summary>
                {t('nodes')} ({nodes.length})
              </summary>
              <div className="ic-node-buttons">
                {nodes.map((node) => (
                  <button
                    type="button"
                    key={node.id}
                    onClick={() => setEditing({ node, kind: kindOf(node) })}
                  >
                    {node.name}
                  </button>
                ))}
              </div>
            </details>
          </section>
        )}
      {active === 'crime' && (
        <>
          <Fields
            t={t}
            row={plan.crime}
            specs={[
              nodeSpec('eventId', 'eventId', 'event'),
              crimeRoleSpec('victimId'),
              crimeRoleSpec('culpritIds'),
              { key: 'motive', label: 'motive' },
              { key: 'method', label: 'method' },
              { key: 'circumstances', label: 'circumstances' },
            ]}
            onChange={(key, value) => patch('crime', { ...plan.crime, [key]: value })}
          />
        </>
      )}
      {active === 'matrix' && (
        <>
          <p className="ic-guidance">{t('clueAdvice')}</p>
          <Fields
            t={t}
            row={plan}
            specs={[nodeSpec('clueLocations', 'clueLocations', 'location', true)]}
            onChange={(_, value) => patch('clueLocations', value as string[])}
          />
          {collection(
            'conclusions',
            'conclusions',
            [
              { key: 'text', label: 'text' },
              nodeSpec('subjectIds', 'subjectIds', undefined, true),
              enumSpec('truth', 'truth', 'true', 'false', 'unknown'),
              { key: 'required', label: 'required', type: 'check' },
              { key: 'threshold', label: 'threshold', type: 'number' },
            ],
            () => ({
              id: crypto.randomUUID(),
              text: '',
              subjectIds: [],
              truth: 'unknown',
              required: false,
              threshold: 1,
            }),
          )}
          {collection(
            'evidence',
            'evidence',
            [
              nodeSpec('nodeId', 'nodeId', 'evidence'),
              nodeSpec('locationId', 'locationId', 'location'),
              { key: 'conclusionId', label: 'conclusionId', type: 'select', options: conclusions },
              enumSpec('effect', 'effect', 'supports', 'refutes'),
              enumSpec('certainty', 'certainty', 'confirmed', 'disputed'),
              { key: 'explanation', label: 'explanation' },
            ],
            () => ({
              id: crypto.randomUUID(),
              nodeId: options('evidence')[0]?.id || '',
              locationId: null,
              conclusionId: conclusions[0]?.id || '',
              effect: 'supports',
              certainty: 'confirmed',
              explanation: '',
            }),
          )}
          <div className="ic-table-wrap">
            <table>
              <caption>{t('matrix')}</caption>
              <thead>
              <tr>
                <th>{t('evidenceNode')}</th>
                {plan.conclusions.map((c) => (
                  <th key={c.id}>{c.text}</th>
                ))}
              </tr>
              </thead>
              <tbody>
              {nodes
                .filter((n) => kindOf(n) === 'evidence')
                .map((n) => (
                  <tr key={n.id}>
                    <th>{n.name}</th>
                    {plan.conclusions.map((c) => (
                      <td key={c.id}>
                        {plan.evidence
                          .filter((e) => e.nodeId === n.id && e.conclusionId === c.id)
                          .map((e) => (
                            <span key={e.id} title={e.explanation}>
                                {t(e.effect)}
                              {e.certainty === 'disputed' ? ` (${t('disputed')})` : ''}
                              <br />
                              </span>
                          ))}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {active === 'timeline' && (
        <>
          {collection(
            'timeline',
            'timelineRows',
            [
              nodeSpec('nodeId', 'nodeId'),
              nodeSpec('personIds', 'personIds', 'person', true),
              nodeSpec('locationId', 'locationId', 'location'),
              { key: 'period', label: 'period' },
              { key: 'earliest', label: 'earliest', type: 'clock' },
              { key: 'latest', label: 'latest', type: 'clock' },
              { key: 'duration', label: 'duration', type: 'number' },
              enumSpec('kind', 'kind', 'event', 'alibi'),
              enumSpec('certainty', 'certainty', 'confirmed', 'disputed'),
            ],
            () => ({
              id: crypto.randomUUID(),
              nodeId: options('event')[0]?.id || options()[0]?.id || '',
              personIds: [],
              locationId: null,
              period: '',
              earliest: 0,
              latest: 0,
              duration: 0,
              kind: 'event',
              certainty: 'confirmed',
            }),
          )}
          {collection(
            'ordering',
            'ordering',
            [
              { key: 'beforeId', label: 'beforeId', type: 'select', options: times },
              { key: 'afterId', label: 'afterId', type: 'select', options: times },
              { key: 'minGap', label: 'minGap', type: 'number' },
              { key: 'maxGap', label: 'maxGap', type: 'nullableNumber' },
            ],
            () => ({
              id: crypto.randomUUID(),
              beforeId: times[0]?.id || '',
              afterId: times[1]?.id || '',
              minGap: 0,
              maxGap: null,
            }),
          )}
          {collection(
            'travel',
            'travel',
            [
              nodeSpec('fromId', 'fromId', 'location'),
              nodeSpec('toId', 'toId', 'location'),
              { key: 'minutes', label: 'minutes', type: 'number' },
            ],
            () => ({
              id: crypto.randomUUID(),
              fromId: options('location')[0]?.id || '',
              toId: options('location')[1]?.id || '',
              minutes: 0,
            }),
          )}
        </>
      )}
      {active === 'reachability' && (
        <>
          <Fields
            t={t}
            row={plan}
            specs={[
              nodeSpec('entries', 'entries', undefined, true),
              nodeSpec('endings', 'endings', undefined, true),
            ]}
            onChange={(key, value) => patch(key as 'entries' | 'endings', value as string[])}
          />
          {collection(
            'access',
            'access',
            [
              nodeSpec('targetId', 'targetId'),
              nodeSpec('requires', 'requires', undefined, true),
              {
                key: 'conclusions',
                label: 'conclusionRequirements',
                type: 'multi',
                options: conclusions,
              },
              { key: 'method', label: 'method' },
            ],
            () => ({
              id: crypto.randomUUID(),
              targetId: options()[0]?.id || '',
              requires: [],
              conclusions: [],
              method: '',
            }),
          )}
        </>
      )}
      {(active === 'reachability' || active === 'deadEnds') && (
        <div className="ic-table-wrap">
          <table>
            <caption>{t('route')}</caption>
            <thead>
            <tr>
              <th>{t('nodeId')}</th>
              <th>{t('route')}</th>
            </tr>
            </thead>
            <tbody>
            {nodes.map((n) => (
              <tr key={n.id}>
                <th>{n.name}</th>
                <td>
                  {report.proofs.get(n.id) === 'entry'
                    ? t('entry')
                    : plan.access.find((r) => r.id === report.proofs.get(n.id))?.method ||
                    t('unavailable')}
                </td>
              </tr>
            ))}
            </tbody>
          </table>
        </div>
      )}
      {active === 'versions' && (
        <>
          <section className="ic-section">
            <h3>{t('suggestions')}</h3>
            {suggestions.length ? (
              suggestions.map((s) => (
                <article className="ic-suggestion" key={`${s.suspectId}-${s.conclusionId}`}>
                  <strong>{s.title}</strong>
                  <p>{s.motive}</p>
                  <p>{s.explanation}</p>
                  <button
                    type="button"
                    onClick={() => {
                      const { score: _, ...version } = s;
                      patch('versions', [
                        ...plan.versions,
                        { ...version, id: crypto.randomUUID() },
                      ]);
                    }}
                  >
                    {t('useSuggestion')}
                  </button>
                </article>
              ))
            ) : (
              <p>{t('noSuggestions')}</p>
            )}
          </section>
          {collection(
            'versions',
            'versionRows',
            [
              { key: 'title', label: 'versionTitle' },
              nodeSpec('suspectId', 'suspectId', 'person'),
              {
                key: 'conclusionId',
                label: 'conclusionId',
                type: 'select',
                options: conclusions.filter(
                  (c) => plan.conclusions.find((row) => row.id === c.id)?.truth === 'false',
                ),
              },
              { key: 'motive', label: 'motive' },
              { key: 'explanation', label: 'explanation' },
            ],
            () => ({
              id: crypto.randomUUID(),
              title: '',
              suspectId: null,
              conclusionId: null,
              motive: '',
              explanation: '',
            }),
          )}
        </>
      )}
      {(active === 'matrix' || active === 'completeness') && (
        <div className="ic-table-wrap">
          <table>
            <caption>{t('evidenceState')}</caption>
            <thead>
            <tr>
              <th>{t('text')}</th>
              <th>{t('truth')}</th>
              <th>{t('evidenceState')}</th>
              <th>{t('supports')}</th>
              <th>{t('refutes')}</th>
            </tr>
            </thead>
            <tbody>
            {plan.conclusions.map((c) => {
              const k = report.knowledge.get(c.id)!;
              return (
                <tr key={c.id}>
                  <th>{c.text}</th>
                  <td>{t(c.truth)}</td>
                  <td>{t(k.state)}</td>
                  <td>
                    {k.supports.map((id) => nodes.find((n) => n.id === id)?.name).join(', ')}
                  </td>
                  <td>
                    {k.refutes.map((id) => nodes.find((n) => n.id === id)?.name).join(', ')}
                  </td>
                </tr>
              );
            })}
            </tbody>
          </table>
        </div>
      )}
      {!(mode === 'audit' && active === 'completeness') && reportView}
      {error && (
        <p className="ic-error" role="alert">
          {error}
        </p>
      )}
      <footer className="ic-footer">
        <button type="button" onClick={() => save(true)}>
          {t('backToBoard')}
        </button>
        {mode === 'create' && (
          <button
            type="button"
            disabled={step === 0}
            onClick={() => {
              if (save()) setStep(step - 1);
            }}
          >
            {t('previous')}
          </button>
        )}
        <button type="button" onClick={() => save()}>
          {t('save')}
        </button>
        {mode === 'create' && step < steps.length - 1 ? (
          <button
            type="button"
            className="ic-primary"
            onClick={() => {
              if (save()) setStep(step + 1);
            }}
          >
            {t('next')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="ic-primary"
              title={t('assembleHint')}
              onClick={() => save(true, true)}
            >
              {t('assemble')}
            </button>
            <label title={t('assemblePreservation')}>
              <input
                type="checkbox"
                checked={replaceManual}
                onChange={(event) => setReplaceManual(event.target.checked)}
              />{' '}
              {t('replaceManual')}
            </label>
          </>
        )}
      </footer>
    </div>
  );
}
