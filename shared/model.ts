import type { Locale } from './i18n';
import { tr } from './i18n';
import { z } from 'zod';
import type { TransferImportResult, TransferPackage } from './transfer';
import { folderKindOf, folderSubtree, migrateFolderCategories } from './folders';

// Keep older libraries readable; this limit applies to adding new boards.
export const BOARD_CREATION_LIMIT = 100;

const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
const nameSchema = z
  .string()
  .trim()
  .min(1, { error: () => tr('validation.nameRequired') })
  .max(80);
const color = z.string().regex(/^#[\da-fA-F]{6}$/, { error: () => tr('validation.invalidColor') });
const image = z
  .string()
  .max(7_000_000)
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/);
export const portraitSchema = z
  .object({
    source: image,
    zoom: z.number().min(1).max(4),
    rotation: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
    flipX: z.boolean(),
    offsetX: z.number().finite(),
    offsetY: z.number().finite(),
  })
  .strict();
export const characterSchema = z
  .object({
    id: id.refine((value) => value !== '__culprit__', { error: () => tr('trace.invalidTree') }),
    name: nameSchema,
    color,
    image: image.optional(),
    portrait: portraitSchema.optional(),
    notes: z.string().max(2000),
    folderId: id.nullable().default(null),
    kind: z.enum(['person', 'evidence', 'location', 'event']).optional(),
    witness: z.boolean().optional(),
    suspect: z.boolean().optional(),
    answers: z.record(z.string(), z.string().max(2000)).optional(),
  })
  .strict()
  .refine(
    (node) =>
      (node.kind && node.kind !== 'person') || node.suspect !== false || node.witness === true,
    { error: () => tr('trace.rolesRequired') },
  );
export const characterFolderSchema = z
  .object({
    id,
    name: nameSchema,
    parentId: id.nullable().default(null),
    kind: z.enum(['person', 'evidence', 'location', 'event']).optional(),
  })
  .strict();
export const relationTypeSchema = z.object({ id, name: nameSchema, color }).strict();
export const connectionSchema = z
  .object({
    id,
    sourceId: id,
    targetId: id,
    typeId: id,
    directed: z.boolean(),
    notes: z.string().max(2000),
  })
  .strict();
export const clubSchema = z
  .object({
    id,
    name: nameSchema,
    description: z.string().max(2000),
    characterIds: z.array(id).max(500),
    connections: z.array(connectionSchema).max(10000),
    layout: z
      .record(
        id,
        z
          .object({
            x: z.number().finite().min(-10000).max(10000).optional(),
            y: z.number().finite().min(-10000).max(10000).optional(),
            locked: z.boolean().optional(),
            parentId: id.optional(),
          })
          .strict()
          .refine((entry) => (entry.x === undefined) === (entry.y === undefined), {
            error: () => tr('trace.invalidTree'),
          }),
      )
      .optional(),
  })
  .strict();
const currentDatabaseSchema = z
  .object({
    version: z.literal(4),
    characters: z.array(characterSchema).max(5000),
    folders: z.array(characterFolderSchema).max(500),
    relationTypes: z.array(relationTypeSchema).max(200),
    clubs: z.array(clubSchema).max(500),
    activeClubId: id.nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (
      !unique(data.characters.map((c) => c.id)) ||
      !unique(data.folders.map((folder) => folder.id)) ||
      !unique(data.relationTypes.map((t) => t.id)) ||
      !unique(data.clubs.map((c) => c.id))
    )
      issue(tr('validation.duplicateIds'));
    const characters = new Set(data.characters.map((c) => c.id));
    const folders = new Set(data.folders.map((folder) => folder.id));
    const foldersById = new Map(data.folders.map((folder) => [folder.id, folder]));
    if (
      data.characters.some(
        (character) => character.folderId !== null && !folders.has(character.folderId),
      )
    )
      issue(tr('validation.characterFolderMissing'));
    if (
      data.characters.some((node) => {
        const folder = node.folderId === null ? undefined : foldersById.get(node.folderId);
        return folder && folderKindOf(folder) !== (node.kind || 'person');
      })
    )
      issue(tr('validation.folderCategoryMismatch'));
    if (
      !unique(
        data.folders.map((folder) =>
          JSON.stringify([
            folderKindOf(folder),
            folder.parentId,
            folder.name.toLocaleLowerCase('ru'),
          ]),
        ),
      )
    )
      issue(tr('validation.duplicateFolderName'));
    const parents = new Map(data.folders.map((folder) => [folder.id, folder.parentId]));
    for (const folder of data.folders) {
      if (folder.parentId !== null && !folders.has(folder.parentId))
        issue(tr('validation.parentFolderMissing'));
      const parentFolder = folder.parentId === null ? undefined : foldersById.get(folder.parentId);
      if (parentFolder && folderKindOf(parentFolder) !== folderKindOf(folder))
        issue(tr('validation.folderCategoryMismatch'));
      const visited = new Set([folder.id]);
      let parent = folder.parentId;
      while (parent !== null && parents.has(parent)) {
        if (visited.has(parent)) {
          issue(tr('validation.folderCycle'));
          break;
        }
        visited.add(parent);
        parent = parents.get(parent)!;
      }
    }
    const types = new Set(data.relationTypes.map((t) => t.id));
    if (data.activeClubId && !data.clubs.some((c) => c.id === data.activeClubId))
      issue(tr('validation.activeClubMissing'));
    for (const club of data.clubs) {
      const members = new Set(club.characterIds);
      if (!unique(club.characterIds) || club.characterIds.some((c) => !characters.has(c)))
        issue(tr('validation.clubMembersInvalid'));
      if (!unique(club.connections.map((c) => c.id))) issue(tr('validation.duplicateConnections'));
      for (const [nodeId, placement] of Object.entries(club.layout || {})) {
        if (
          !members.has(nodeId) ||
          (placement.parentId &&
            placement.parentId !== '__culprit__' &&
            !members.has(placement.parentId))
        )
          issue(tr('trace.invalidTree'));
        const visited = new Set([nodeId]);
        let parent = placement.parentId;
        while (parent && parent !== '__culprit__') {
          if (visited.has(parent)) {
            issue(tr('trace.invalidTree'));
            break;
          }
          visited.add(parent);
          parent = club.layout?.[parent]?.parentId;
        }
      }
      const signatures = new Set<string>();
      for (const connection of club.connections) {
        if (
          !members.has(connection.sourceId) ||
          !members.has(connection.targetId) ||
          !types.has(connection.typeId) ||
          connection.sourceId === connection.targetId
        )
          issue(tr('validation.connectionInvalid'));
        const endpoints = connection.directed
          ? [connection.sourceId, connection.targetId]
          : [connection.sourceId, connection.targetId].sort();
        const signature = JSON.stringify([connection.typeId, connection.directed, ...endpoints]);
        if (signatures.has(signature)) issue(tr('validation.connectionExists'));
        signatures.add(signature);
      }
    }
  });

// Normalize previous library formats in every load/import path.
const legacyDatabaseSchema = z.preprocess((input) => {
  if (
    typeof input !== 'object' ||
    input === null ||
    !('version' in input) ||
    ![1, 2, 3].includes(input.version as number) ||
    (input.version === 1 && 'folders' in input)
  )
    return input;
  const previous = input as Record<string, unknown>;
  const migrated: Record<string, unknown> = {
    ...previous,
    version: 4,
    ...(previous.version === 1 ? { folders: [] } : {}),
  };
  // Legacy field names are accepted only here; mixed formats remain invalid.
  if ('circles' in previous || 'activeCircleId' in previous) {
    if ('clubs' in previous || 'activeClubId' in previous) return input;
    const { circles, activeCircleId, ...rest } = migrated;
    return { ...rest, clubs: circles, activeClubId: activeCircleId };
  }
  return migrated;
}, currentDatabaseSchema);

export const databaseSchema = z.preprocess((input) => {
  if (typeof input !== 'object' || input === null) return input;
  const data = input as Record<string, unknown>;
  const folders = z.array(characterFolderSchema).safeParse(data.folders);
  const characters = z.array(characterSchema).safeParse(data.characters);
  if (!folders.success || !characters.success) return input;
  return { ...data, ...migrateFolderCategories(folders.data, characters.data) };
}, legacyDatabaseSchema);

export type Character = z.infer<typeof characterSchema>;
export type Portrait = z.infer<typeof portraitSchema>;
export type CharacterFolder = z.infer<typeof characterFolderSchema>;
export type RelationType = z.infer<typeof relationTypeSchema>;
export type Connection = z.infer<typeof connectionSchema>;
export type Club = z.infer<typeof clubSchema>;
export type Database = z.infer<typeof databaseSchema>;
export type LoadResult = { data: Database; path: string; warning?: string };
export type ExportFormat = 'png' | 'svg';

export interface DesktopAPI {
  getLanguage(): Promise<Locale>;

  setLanguage(locale: Locale): Promise<void>;

  load(): Promise<LoadResult>;

  save(data: Database): Promise<void>;

  exportBackup(data: Database): Promise<boolean>;

  importBackup(): Promise<LoadResult | null>;

  exportTransfer(file: TransferPackage, name: string): Promise<boolean>;

  importTransfer(): Promise<TransferImportResult | null>;

  exportDiagram(name: string, format: ExportFormat, content: string): Promise<boolean>;

  showDataFolder(): Promise<void>;
}

export function emptyDatabase(): Database {
  return {
    version: 4,
    characters: [],
    folders: [],
    relationTypes: [],
    clubs: [],
    activeClubId: null,
  };
}

export function upsertClub(data: Database, next: Club): Database {
  const exists = data.clubs.some((club) => club.id === next.id);
  if (!exists && data.clubs.length >= BOARD_CREATION_LIMIT)
    throw new Error(tr('validation.boardLimit', BOARD_CREATION_LIMIT));
  return {
    ...data,
    clubs: exists
      ? data.clubs.map((club) => (club.id === next.id ? next : club))
      : [...data.clubs, next],
    activeClubId: next.id,
  };
}

export function deleteCharacterFolder(data: Database, folderId: string): Database {
  const folder = data.folders.find((folder) => folder.id === folderId);
  if (!folder) return data;
  const removed = folderSubtree(data.folders, folderId);
  return {
    ...data,
    folders: data.folders.filter((folder) => !removed.has(folder.id)),
    characters: data.characters.map((character) =>
      character.folderId !== null && removed.has(character.folderId)
        ? { ...character, folderId: folder.parentId }
        : character,
    ),
  };
}

export function deleteCharacter(data: Database, characterId: string): Database {
  return {
    ...data,
    characters: data.characters.filter((c) => c.id !== characterId),
    clubs: data.clubs.map((c) => removeFromClub(c, characterId)),
  };
}

export function removeFromClub(club: Club, characterId: string): Club {
  return {
    ...club,
    characterIds: club.characterIds.filter((id) => id !== characterId),
    connections: club.connections.filter(
      (e) => e.sourceId !== characterId && e.targetId !== characterId,
    ),
    ...(club.layout
      ? {
          layout: Object.fromEntries(
            Object.entries(club.layout)
              .filter(([id]) => id !== characterId)
              .map(([id, value]) => [
                id,
                value.parentId === characterId ? { ...value, parentId: '__culprit__' } : value,
              ]),
          ),
        }
      : {}),
  };
}
