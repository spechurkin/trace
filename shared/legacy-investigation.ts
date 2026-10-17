// Compatibility data from the former investigation creator. Retain it through saves and exports.
import { z } from 'zod';

const ref = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().max(2000);
const draftRef = z.union([ref, z.literal('')]);
const refs = z.array(ref).max(500);
const minutes = z.number().finite().min(-100000000).max(100000000);
const certainty = z.enum(['confirmed', 'disputed']);

// Board-local authoring data. Empty fields are valid drafts and are audited, not discarded.
export const legacyInvestigationSchema = z
  .object({
    crime: z
      .object({
        eventId: ref.nullable(),
        victimId: ref.nullable(),
        culpritIds: refs,
        motive: text,
        method: text,
        circumstances: text,
      })
      .strict(),
    conclusions: z
      .array(
        z
          .object({
            id: ref,
            text,
            truth: z.enum(['true', 'false', 'unknown']),
            subjectIds: refs,
            required: z.boolean(),
            threshold: z.number().int().min(1).max(500),
          })
          .strict(),
      )
      .max(500),
    evidence: z
      .array(
        z
          .object({
            id: ref,
            nodeId: draftRef,
            conclusionId: draftRef,
            locationId: ref.nullable(),
            effect: z.enum(['supports', 'refutes']),
            certainty,
            explanation: text,
          })
          .strict(),
      )
      .max(10000),
    entries: refs,
    clueLocations: refs,
    endings: refs,
    access: z
      .array(
        z
          .object({
            id: ref,
            targetId: draftRef,
            requires: refs,
            conclusions: refs,
            method: text,
          })
          .strict(),
      )
      .max(10000),
    timeline: z
      .array(
        z
          .object({
            id: ref,
            nodeId: draftRef,
            personIds: refs,
            locationId: ref.nullable(),
            period: z.string().max(80),
            earliest: minutes,
            latest: minutes,
            duration: z.number().finite().min(0).max(100000000),
            kind: z.enum(['event', 'alibi']),
            certainty,
          })
          .strict(),
      )
      .max(1000),
    ordering: z
      .array(
        z
          .object({
            id: ref,
            beforeId: draftRef,
            afterId: draftRef,
            minGap: minutes,
            maxGap: minutes.nullable(),
          })
          .strict(),
      )
      .max(10000),
    travel: z
      .array(
        z
          .object({
            id: ref,
            fromId: draftRef,
            toId: draftRef,
            minutes: z.number().finite().min(0).max(100000000),
          })
          .strict(),
      )
      .max(1000),
    versions: z
      .array(
        z
          .object({
            id: ref,
            title: text,
            suspectId: ref.nullable(),
            conclusionId: ref.nullable(),
            motive: text,
            explanation: text,
          })
          .strict(),
      )
      .max(500),
  })
  .strict();

export type LegacyInvestigation = z.infer<typeof legacyInvestigationSchema>;

export function emptyPlan(): LegacyInvestigation {
  return {
    crime: {
      eventId: null,
      victimId: null,
      culpritIds: [],
      motive: '',
      method: '',
      circumstances: '',
    },
    conclusions: [],
    evidence: [],
    entries: [],
    clueLocations: [],
    endings: [],
    access: [],
    timeline: [],
    ordering: [],
    travel: [],
    versions: [],
  };
}

// IDs are remapped on transfer, including every prerequisite and timeline participant.
export function remapLegacyInvestigation(
  p: LegacyInvestigation,
  map: (id: string) => string,
): LegacyInvestigation {
  const optional = (id: string | null) => (id === null ? null : map(id));
  return {
    ...p,
    conclusions: p.conclusions.map((c) => ({ ...c, subjectIds: c.subjectIds.map(map) })),
    crime: {
      ...p.crime,
      eventId: optional(p.crime.eventId),
      victimId: optional(p.crime.victimId),
      culpritIds: p.crime.culpritIds.map(map),
    },
    entries: p.entries.map(map),
    endings: p.endings.map(map),
    clueLocations: p.clueLocations.map(map),
    access: p.access.map((r) => ({
      ...r,
      targetId: map(r.targetId),
      requires: r.requires.map(map),
    })),
    evidence: p.evidence.map((e) => ({
      ...e,
      nodeId: map(e.nodeId),
      locationId: optional(e.locationId),
    })),
    timeline: p.timeline.map((t) => ({
      ...t,
      nodeId: map(t.nodeId),
      personIds: t.personIds.map(map),
      locationId: optional(t.locationId),
    })),
    travel: p.travel.map((t) => ({ ...t, fromId: map(t.fromId), toId: map(t.toId) })),
    versions: p.versions.map((v) => ({ ...v, suspectId: optional(v.suspectId) })),
  };
}
