import { type CreatorLocale, messages } from './messages';
import type { InvestigationPlan } from './schema';

type TimeRow = InvestigationPlan['timeline'][number];
type Bounds = readonly [number, number];

export function formatAuditTime(minutes: number) {
  const milliseconds = Math.round(minutes * 60000);
  const day = Math.floor(milliseconds / 86400000);
  const seconds = (milliseconds - day * 86400000) / 1000;
  const hour = Math.floor(seconds / 3600);
  const minute = Math.floor((seconds % 3600) / 60);
  const second = Math.round((seconds % 60) * 1000) / 1000;
  const clock = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}${second ? `:${second < 10 ? '0' : ''}${second}` : ''}`;
  return day === 0 ? clock : `${day}/${clock}`;
}

export function timeDetails(
  plan: InvestigationPlan,
  label: (id: string) => string,
  locale: CreatorLocale,
) {
  const t = messages(locale);
  const range = (min: number, max: number, clock = false) => {
    const format = clock ? formatAuditTime : (value: number) => String(value);
    return min === max ? format(min) : `${format(min)}–${format(max)}`;
  };
  const row = (record: TimeRow, bounds: Bounds = [record.earliest, record.latest]) => {
    const details = [
      t(
        'timeDetailRow',
        label(record.id),
        range(record.earliest, record.latest, true),
        record.duration,
        range(record.earliest + record.duration, record.latest + record.duration, true),
        record.locationId ? label(record.locationId) : t('none'),
      ),
    ];
    if (bounds[0] !== record.earliest || bounds[1] !== record.latest)
      details.push(t('timeDetailBounds', label(record.id), range(...bounds, true)));
    return details;
  };
  const ordering = (order: InvestigationPlan['ordering'][number]) => {
    const before = plan.timeline.find((r) => r.id === order.beforeId);
    const after = plan.timeline.find((r) => r.id === order.afterId);
    if (!before || !after) return [];
    const expected =
      order.maxGap === null
        ? t('timeDetailAtLeast', order.minGap)
        : range(order.minGap, order.maxGap);
    const expectedStart =
      order.maxGap === null
        ? t(
          'timeDetailNotBefore',
          formatAuditTime(before.earliest + before.duration + order.minGap),
        )
        : range(
          before.earliest + before.duration + order.minGap,
          before.latest + before.duration + order.maxGap,
          true,
        );
    return [
      t(
        'timeDetailOrdering',
        label(order.id),
        expected,
        range(
          after.earliest - before.latest - before.duration,
          after.latest - before.earliest - before.duration,
        ),
      ),
      t(
        'timeDetailExpectedStart',
        label(after.id),
        expectedStart,
        range(after.earliest, after.latest, true),
      ),
    ];
  };
  return {
    row,
    ordering,
    invalidGap: (order: InvestigationPlan['ordering'][number]) => [
      t('timeDetailInvalidGap', label(order.id), order.minGap, order.maxGap ?? t('none')),
    ],
    cycle: (ids: string[]) => [
      ...plan.timeline.filter((r) => ids.includes(r.id)).flatMap((r) => row(r)),
      ...plan.ordering.filter((o) => ids.includes(o.id)).flatMap(ordering),
    ],
    presence: (
      a: TimeRow,
      b: TimeRow,
      aBounds: Bounds,
      bBounds: Bounds,
      travel: number,
      canAB: boolean,
      canBA: boolean,
    ) => {
      const direction = (
        from: TimeRow,
        to: TimeRow,
        fromBounds: Bounds,
        toBounds: Bounds,
        possible: boolean,
      ) => {
        const endMin = fromBounds[0] + from.duration;
        const endMax = fromBounds[1] + from.duration;
        const arrivalMin = endMin + travel;
        const arrivalMax = endMax + travel;
        const details = [
          t(
            'timeDetailPresenceGap',
            label(from.id),
            label(to.id),
            travel,
            range(toBounds[0] - endMax, toBounds[1] - endMin),
          ),
          t(
            'timeDetailArrival',
            range(endMin, endMax, true),
            travel,
            range(arrivalMin, arrivalMax, true),
            range(...toBounds, true),
          ),
        ];
        if (arrivalMin > toBounds[1])
          details.push(
            t(
              'timeDetailImpossibleArrival',
              formatAuditTime(arrivalMin),
              formatAuditTime(toBounds[1]),
              arrivalMin - toBounds[1],
            ),
          );
        else if (!possible) details.push(t('timeDetailOrderBlocked'));
        else
          details.push(
            t(
              'timeDetailCompatibleStart',
              label(to.id),
              range(Math.max(toBounds[0], arrivalMin), toBounds[1], true),
            ),
          );
        return details;
      };
      return [
        ...row(a, aBounds),
        ...row(b, bBounds),
        ...(!canBA || canAB ? direction(a, b, aBounds, bBounds, canAB) : []),
        ...(!canAB || canBA ? direction(b, a, bBounds, aBounds, canBA) : []),
        ...(canAB || canBA ? [t('timeDetailUncertainty')] : []),
      ];
    },
  };
}
