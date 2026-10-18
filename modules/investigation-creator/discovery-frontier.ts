// A method's prerequisites include context as well as immediate leads. Retain
// only its latest leads on the diagram, without editing the logical AND rule.
// Reduce each method separately: an independent OR route must keep its edge.
export function discoveryFrontier(
  methods: Map<string, string[][]>,
  sources: Map<string, (string | null)[]>,
): Map<string, string[]> {
  const outgoing = new Map([...sources.keys()].map((id) => [id, new Set<string>()]));
  for (const [target, incoming] of sources)
    for (const source of incoming) if (source !== null) outgoing.get(source)?.add(target);
  const reachable = new Map<string, Set<string>>();
  const reaches = (from: string, to: string) => {
    let found = reachable.get(from);
    if (!found) {
      found = new Set<string>();
      const pending = [from];
      while (pending.length) {
        const current = pending.pop()!;
        for (const next of outgoing.get(current) || [])
          if (!found.has(next)) {
            found.add(next);
            pending.push(next);
          }
      }
      reachable.set(from, found);
    }
    return found.has(to);
  };
  return new Map(
    [...methods].map(([target, alternatives]) => [
      target,
      [
        ...new Set(
          alternatives.flatMap((required) =>
            required.filter(
              (earlier) =>
                !required.some(
                  (later) =>
                    earlier !== later &&
                    reaches(earlier, later) &&
                    !reaches(later, earlier) &&
                    // Never use a return through the target to justify removing an entry
                    // into its cycle. Cyclic prerequisites are not an established order.
                    !reaches(target, later),
                ),
            ),
          ),
        ),
      ].sort(),
    ]),
  );
}
