import type { Character, CharacterFolder } from './model';
import type { NodeKind } from './investigation';

export const folderKindOf = (folder: CharacterFolder): NodeKind => folder.kind || 'person';

// Old libraries used one folder tree for every node category. Split only those
// legacy trees, preserving node IDs, board layouts and empty folders.
export function migrateFolderCategories(folders: CharacterFolder[], characters: Character[]) {
  if (!folders.length || folders.some((folder) => folder.kind !== undefined))
    return { folders, characters };
  const entries = folderEntries(folders);
  if (
    entries.length !== folders.length ||
    new Set(folders.map((f) => f.id)).size !== folders.length
  )
    return { folders, characters }; // Let schema validation report invalid hierarchies.
  const kinds: NodeKind[] = ['person', 'evidence', 'location', 'event'];
  const owners = new Map(folders.map((folder) => [folder.id, new Set<NodeKind>()]));
  for (const node of characters)
    for (const id of withFolderAncestors(folders, [node.folderId]))
      owners.get(id)!.add(node.kind || 'person');
  for (const { folder } of entries) {
    if (owners.get(folder.id)!.size) continue;
    const parentKinds = folder.parentId ? owners.get(folder.parentId)! : new Set<NodeKind>();
    const kind = kinds.find((kind) => parentKinds.has(kind)) || 'person';
    for (const id of withFolderAncestors(folders, [folder.id])) owners.get(id)!.add(kind);
  }
  const used = new Set(folders.map((folder) => folder.id));
  const ids = new Map<string, Map<NodeKind, string>>();
  for (const folder of folders) {
    const mapping = new Map<NodeKind, string>();
    for (const kind of kinds.filter((kind) => owners.get(folder.id)!.has(kind))) {
      let id = folder.id;
      if (mapping.size) {
        const base = `${folder.id.slice(0, 60)}-${kind}`;
        id = base;
        let suffix = 1;
        while (used.has(id)) id = `${base}-${suffix++}`;
        used.add(id);
      }
      mapping.set(kind, id);
    }
    ids.set(folder.id, mapping);
  }
  return {
    folders: folders.flatMap((folder) =>
      [...ids.get(folder.id)!].map(([kind, id]) => ({
        ...folder,
        id,
        ...(kind === 'person' ? {} : { kind }),
        parentId: folder.parentId === null ? null : ids.get(folder.parentId)!.get(kind)!,
      })),
    ),
    characters: characters.map((node) => ({
      ...node,
      folderId:
        node.folderId === null
          ? null
          : ids.get(node.folderId)?.get(node.kind || 'person') || node.folderId,
    })),
  };
}

export type FolderEntry = { folder: CharacterFolder; depth: number; path: string };

export function folderEntries(folders: CharacterFolder[]): FolderEntry[] {
  const children = new Map<string | null, CharacterFolder[]>();
  for (const folder of folders) {
    const siblings = children.get(folder.parentId) || [];
    siblings.push(folder);
    children.set(folder.parentId, siblings);
  }
  const result: FolderEntry[] = [];
  const visited = new Set<string>();
  const visit = (parentId: string | null, depth: number, names: string[]) => {
    for (const folder of children.get(parentId) || []) {
      if (visited.has(folder.id)) continue;
      visited.add(folder.id);
      const trail = [...names, folder.name];
      result.push({ folder, depth, path: trail.join(' / ') });
      visit(folder.id, depth + 1, trail);
    }
  };
  visit(null, 0, []);
  return result;
}

export function folderTrail(folders: CharacterFolder[], id: string): CharacterFolder[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const result: CharacterFolder[] = [];
  const visited = new Set<string>();
  let current: string | null = id;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    const folder = byId.get(current);
    if (!folder) break;
    result.unshift(folder);
    current = folder.parentId;
  }
  return result;
}

export function folderPath(folders: CharacterFolder[], id: string): string {
  return folderTrail(folders, id)
    .map((folder) => folder.name)
    .join(' / ');
}

export function folderSubtree(folders: CharacterFolder[], id: string): Set<string> {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    if (folder.parentId === null) continue;
    const siblings = children.get(folder.parentId) || [];
    siblings.push(folder.id);
    children.set(folder.parentId, siblings);
  }
  const result = new Set<string>();
  const pending = [id];
  while (pending.length) {
    const current = pending.pop()!;
    if (result.has(current)) continue;
    result.add(current);
    pending.push(...(children.get(current) || []));
  }
  return result;
}

export function withFolderAncestors(
  folders: CharacterFolder[],
  ids: Iterable<string | null>,
): Set<string> {
  const result = new Set<string>();
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  for (const id of ids) {
    let current = id;
    while (current !== null && !result.has(current)) {
      const folder = byId.get(current);
      if (!folder) break;
      result.add(current);
      current = folder.parentId;
    }
  }
  return result;
}
