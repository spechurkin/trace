import { tr } from './i18n';
import { z } from 'zod';
import {
  BOARD_CREATION_LIMIT,
  type Database,
  databaseSchema,
  emptyDatabase,
  type LoadResult,
} from './model';
import { folderEntries, folderKindOf, folderSubtree, withFolderAncestors } from './folders';

export const transferSchema = z
  .object({
    format: z.literal('trace-transfer'),
    version: z.literal(1),
    kind: z.enum(['stories', 'characters', 'relations']),
    data: databaseSchema,
  })
  .strict()
  .superRefine((file, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    if (file.kind === 'characters' && (file.data.clubs.length || file.data.relationTypes.length))
      issue(tr('validation.characterTransferContent'));
    if (
      file.kind === 'relations' &&
      (file.data.characters.length || file.data.folders.length || file.data.clubs.length)
    )
      issue(tr('validation.relationshipTransferContent'));
  });

export type TransferPackage = z.infer<typeof transferSchema>;
export type ImportSummary = {
  characters: number;
  folders: number;
  relationTypes: number;
  clubs: number;
  reused: number;
};
export type TransferImportResult = LoadResult & { summary: ImportSummary };

function selected<T extends { id: string }>(items: T[], ids?: string[]): T[] {
  if (!ids) return items;
  const wanted = new Set(ids);
  if ([...wanted].some((id) => !items.some((item) => item.id === id)))
    throw new Error(tr('errors.exportObjectMissing'));
  return items.filter((item) => wanted.has(item.id));
}

export function createStoriesTransfer(input: Database, clubIds?: string[]): TransferPackage {
  const source = databaseSchema.parse(input);
  const clubs = selected(source.clubs, clubIds);
  const characterIds = new Set(clubs.flatMap((club) => club.characterIds));
  const characters = source.characters.filter((character) => characterIds.has(character.id));
  const folderIds = withFolderAncestors(
    source.folders,
    characters.map((character) => character.folderId),
  );
  const typeIds = new Set(clubs.flatMap((club) => club.connections.map((edge) => edge.typeId)));
  return transferSchema.parse({
    format: 'trace-transfer',
    version: 1,
    kind: 'stories',
    data: {
      version: 4,
      clubs,
      characters,
      folders: source.folders.filter((folder) => folderIds.has(folder.id)),
      relationTypes: source.relationTypes.filter((type) => typeIds.has(type.id)),
      activeClubId: clubs.some((club) => club.id === source.activeClubId)
        ? source.activeClubId
        : clubs[0]?.id || null,
    },
  });
}

export function createCharactersTransfer(
  input: Database,
  scope: { characterIds?: string[]; folderId?: string | null } = {},
): TransferPackage {
  const source = databaseSchema.parse(input);
  if (scope.folderId && !source.folders.some((folder) => folder.id === scope.folderId))
    throw new Error(tr('errors.exportFolderMissing'));
  const subtree = scope.folderId
    ? folderSubtree(source.folders, scope.folderId)
    : new Set<string>();
  const characters = selected(source.characters, scope.characterIds).filter(
    (character) =>
      scope.folderId === undefined ||
      (scope.folderId === null
        ? character.folderId === null
        : character.folderId !== null && subtree.has(character.folderId)),
  );
  const folderIds = withFolderAncestors(source.folders, [
    ...subtree,
    ...characters.map((character) => character.folderId),
  ]);
  return transferSchema.parse({
    format: 'trace-transfer',
    version: 1,
    kind: 'characters',
    data: {
      ...emptyDatabase(),
      characters,
      folders:
        scope.characterIds === undefined && scope.folderId === undefined
          ? source.folders
          : source.folders.filter((folder) => folderIds.has(folder.id)),
    },
  });
}

// Compare content in a stable field order, independent of JSON property order.
const characterKey = (c: Database['characters'][number]) =>
  JSON.stringify([
    c.name,
    c.color,
    c.image || null,
    c.notes,
    c.folderId,
    c.kind,
    c.witness,
    c.suspect,
    Object.entries(c.answers || {}).sort(([a], [b]) => a.localeCompare(b)),
    c.portrait
      ? [
          c.portrait.source,
          c.portrait.zoom,
          c.portrait.rotation,
          c.portrait.flipX,
          c.portrait.offsetX,
          c.portrait.offsetY,
        ]
      : null,
  ]);
const relationKey = (t: Database['relationTypes'][number]) => JSON.stringify([t.name, t.color]);
const clubKey = (c: Database['clubs'][number]) =>
  JSON.stringify([
    c.name,
    c.description,
    c.characterIds,
    Object.entries(c.layout || {}).sort(([a], [b]) => a.localeCompare(b)),
    c.connections.map((e) => [e.sourceId, e.targetId, e.typeId, e.directed, e.notes]),
  ]);

export function mergeTransfer(
  input: Database,
  file: unknown,
): { data: Database; summary: ImportSummary } {
  const data = databaseSchema.parse(input);
  const parsed = transferSchema.safeParse(file);
  if (!parsed.success) {
    const reason = parsed.error.issues.find((issue) => issue.code === 'custom')?.message;
    throw new Error(tr('errors.transferFileInvalid', reason || tr('transfer.invalidFileHint')));
  }
  const incoming = parsed.data.data;
  const summary: ImportSummary = {
    characters: 0,
    folders: 0,
    relationTypes: 0,
    clubs: 0,
    reused: 0,
  };
  const folderMap = new Map<string, string>();
  for (const { folder } of folderEntries(incoming.folders)) {
    const parentId = folder.parentId === null ? null : folderMap.get(folder.parentId)!;
    const existing = data.folders.find(
      (item) =>
        item.parentId === parentId &&
        folderKindOf(item) === folderKindOf(folder) &&
        item.name.toLocaleLowerCase('ru') === folder.name.toLocaleLowerCase('ru'),
    );
    if (existing) {
      folderMap.set(folder.id, existing.id);
      summary.reused++;
    } else {
      const id = availableId(folder.id, data.folders);
      data.folders.push({ ...folder, id, parentId });
      folderMap.set(folder.id, id);
      summary.folders++;
    }
  }

  function mergeItems<T extends { id: string }>(
    current: T[],
    imported: T[],
    key: (item: T) => string,
    count: 'characters' | 'relationTypes' | 'clubs',
  ) {
    const map = new Map<string, string>();
    const claimed = new Set<string>();
    const byId = new Map(current.map((item) => [item.id, item]));
    const keys = new Map(current.map((item) => [item.id, key(item)]));
    const byContent = new Map<string, T[]>();
    for (const item of current) {
      const content = keys.get(item.id)!;
      const bucket = byContent.get(content) || [];
      bucket.push(item);
      byContent.set(content, bucket);
    }
    for (const item of imported) {
      const content = key(item);
      const sameId =
        !claimed.has(item.id) && keys.get(item.id) === content ? byId.get(item.id) : undefined;
      const existing =
        sameId || byContent.get(content)?.find((existing) => !claimed.has(existing.id));
      let id = existing?.id || item.id;
      if (!existing) while (byId.has(id)) id = crypto.randomUUID();
      if (existing) summary.reused++;
      else {
        const added = { ...item, id };
        current.push(added);
        byId.set(id, added);
        keys.set(id, content);
        const bucket = byContent.get(content) || [];
        bucket.push(added);
        byContent.set(content, bucket);
        summary[count]++;
      }
      // Distinct imported identities must not collapse into one participant/type/story.
      claimed.add(id);
      map.set(item.id, id);
    }
    return map;
  }

  const characterMap = mergeItems(
    data.characters,
    incoming.characters.map((character) => ({
      ...character,
      folderId: character.folderId === null ? null : folderMap.get(character.folderId)!,
    })),
    characterKey,
    'characters',
  );
  const typeMap = mergeItems(
    data.relationTypes,
    incoming.relationTypes,
    relationKey,
    'relationTypes',
  );
  const clubMap = mergeItems(
    data.clubs,
    incoming.clubs.map((club) => ({
      ...club,
      characterIds: club.characterIds.map((id) => characterMap.get(id)!),
      ...(club.layout
        ? {
            layout: Object.fromEntries(
              Object.entries(club.layout).map(([id, entry]) => [
                characterMap.get(id)!,
                {
                  ...entry,
                  ...(entry.parentId
                    ? {
                        parentId:
                          entry.parentId === '__culprit__'
                            ? entry.parentId
                            : characterMap.get(entry.parentId)!,
                      }
                    : {}),
                },
              ]),
            ),
          }
        : {}),
      connections: club.connections.map((edge) => ({
        ...edge,
        sourceId: characterMap.get(edge.sourceId)!,
        targetId: characterMap.get(edge.targetId)!,
        typeId: typeMap.get(edge.typeId)!,
      })),
    })),
    clubKey,
    'clubs',
  );
  if (summary.clubs > 0 && data.clubs.length > BOARD_CREATION_LIMIT)
    throw new Error(tr('validation.boardLimit', BOARD_CREATION_LIMIT));
  if (!data.activeClubId)
    data.activeClubId =
      (incoming.activeClubId && clubMap.get(incoming.activeClubId)) || data.clubs[0]?.id || null;
  const merged = databaseSchema.safeParse(data);
  if (!merged.success) throw new Error(tr('errors.mergedLibraryInvalid'));
  return { data: merged.data, summary };
}

function availableId(id: string, items: { id: string }[]): string {
  const used = new Set(items.map((item) => item.id));
  let result = id;
  while (used.has(result)) result = crypto.randomUUID();
  return result;
}

export function describeImport(summary: ImportSummary): string {
  return tr(
    'transfer.importSummary',
    summary.clubs,
    summary.characters,
    summary.folders,
    summary.relationTypes,
    summary.reused,
  );
}
