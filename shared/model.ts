import type { Locale } from './i18n';
import { tr } from './i18n';
import { z } from 'zod';
import type { TransferImportResult, TransferPackage } from './transfer';
import { folderKindOf, folderSubtree, migrateFolderCategories } from './folders';
import { creatorSchema } from '../modules/investigation-creator/schema';
import { retainParents } from './investigation';

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
    victim: z.boolean().optional(),
    answers: z.record(z.string(), z.string().max(2000)).optional(),
  })
  .strict()
  .refine(
    (node) =>
      (node.kind && node.kind !== 'person') ||
      node.suspect !== false ||
      node.witness === true ||
      node.victim === true,
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
export const boardSchema = z
  .object({
    id,
    name: nameSchema,
    description: z.string().max(2000),
    characterIds: z.array(id).max(500),
    connections: z.array(connectionSchema).max(10000),
    investigation: creatorSchema.optional(),
    creatorFolderIds: z.array(id).max(500).optional(),
    layout: z
      .record(
        id,
        z
          .object({
            x: z.number().finite().min(-10000).max(10000).optional(),
            y: z.number().finite().min(-10000).max(10000).optional(),
            locked: z.boolean().optional(),
            parentId: id.optional(),
            parentIds: z.array(id).min(1).max(501).optional(),
            generated: z
              .object({
                layoutVersion: z
                  .enum(['compact-v1', 'compact-v2', 'compact-v3', 'compact-v4'])
                  .optional(),
                layoutKey: z.string().max(16).optional(),
                parentId: id,
                parentIds: z.array(id).min(1).max(501).optional(),
                x: z.number().finite().min(-10000).max(10000),
                y: z.number().finite().min(-10000).max(10000),
              })
              .strict()
              .optional(),
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
    version: z.literal(5),
    characters: z.array(characterSchema).max(5000),
    folders: z.array(characterFolderSchema).max(500),
    relationTypes: z.array(relationTypeSchema).max(200),
    boards: z.array(boardSchema).max(500),
    activeBoardId: id.nullable(),
  })
  .strict()
  .superRefine((data, ctx) => {
    const issue = (message: string) => ctx.addIssue({ code: 'custom', message });
    const unique = (values: string[]) => new Set(values).size === values.length;
    if (
      !unique(data.characters.map((c) => c.id)) ||
      !unique(data.folders.map((folder) => folder.id)) ||
      !unique(data.relationTypes.map((t) => t.id)) ||
      !unique(data.boards.map((c) => c.id))
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
    if (data.activeBoardId && !data.boards.some((c) => c.id === data.activeBoardId))
      issue(tr('validation.activeBoardMissing'));
    for (const board of data.boards) {
      const members = new Set(board.characterIds);
      if (!unique(board.characterIds) || board.characterIds.some((c) => !characters.has(c)))
        issue(tr('validation.boardMembersInvalid'));
      if (!unique(board.connections.map((c) => c.id))) issue(tr('validation.duplicateConnections'));
      for (const [nodeId, placement] of Object.entries(board.layout || {})) {
        for (const entry of [placement, placement.generated]) {
          if (
            entry?.parentIds &&
            (!unique(entry.parentIds) ||
              !entry.parentId ||
              (entry.parentId !== '__culprit__' && !entry.parentIds.includes(entry.parentId)) ||
              entry.parentIds.includes(nodeId) ||
              entry.parentIds.some((parent) => parent !== '__culprit__' && !members.has(parent)))
          )
            issue(tr('trace.invalidTree'));
        }
        if (
          !members.has(nodeId) ||
          (placement.parentId &&
            placement.parentId !== '__culprit__' &&
            !members.has(placement.parentId)) ||
          (placement.generated &&
            placement.generated.parentId !== '__culprit__' &&
            !members.has(placement.generated.parentId))
        )
          issue(tr('trace.invalidTree'));
      }
      // Backward discovery paths may form cycles. Only placement anchors form
      // a tree; they never remove or add visible discovery paths.
      const visiting = new Set<string>(),
        visited = new Set<string>();
      const visit = (nodeId: string): boolean => {
        if (nodeId === '__culprit__' || visited.has(nodeId)) return true;
        if (visiting.has(nodeId)) return false;
        visiting.add(nodeId);
        const anchor = board.layout?.[nodeId]?.parentId ?? '__culprit__';
        if (!visit(anchor)) return false;
        visiting.delete(nodeId);
        visited.add(nodeId);
        return true;
      };
      if (board.characterIds.some((nodeId) => !visit(nodeId))) issue(tr('trace.invalidTree'));
      const signatures = new Set<string>();
      for (const connection of board.connections) {
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
    ![1, 2, 3, 4].includes(input.version as number) ||
    (input.version === 1 && 'folders' in input)
  )
    return input;
  const previous = input as Record<string, unknown>;
  // Old field names are confined to migration; mixed formats remain invalid.
  if ('boards' in previous || 'activeBoardId' in previous) return input;
  const migrated: Record<string, unknown> = {
    ...previous,
    version: 5,
    ...(previous.version === 1 ? { folders: [] } : {}),
  };
  if ('circles' in previous || 'activeCircleId' in previous) {
    if (previous.version === 4 || 'clubs' in previous || 'activeClubId' in previous) return input;
    const { circles, activeCircleId, ...rest } = migrated;
    return { ...rest, boards: circles, activeBoardId: activeCircleId };
  }
  const { clubs, activeClubId, ...rest } = migrated;
  return { ...rest, boards: clubs, activeBoardId: activeClubId };
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
export type Board = z.infer<typeof boardSchema>;
export type Database = z.infer<typeof databaseSchema>;
export type LoadResult = { data: Database; path: string; warning?: string };
export type ExportFormat = 'png' | 'svg';

export interface DesktopAPI {
  getUpdateState(): Promise<import('./updates').UpdateState>;

  checkForUpdates(): Promise<import('./updates').UpdateState>;

  setUpdateInterval(days: import('./updates').UpdateInterval): Promise<void>;

  installUpdate(): Promise<void>;

  openReleases(): Promise<void>;

  onUpdateState(listener: (state: import('./updates').UpdateState) => void): () => void;

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
    version: 5,
    characters: [],
    folders: [],
    relationTypes: [],
    boards: [],
    activeBoardId: null,
  };
}

export function upsertBoard(data: Database, next: Board): Database {
  const exists = data.boards.some((board) => board.id === next.id);
  if (!exists && data.boards.length >= BOARD_CREATION_LIMIT)
    throw new Error(tr('validation.boardLimit', BOARD_CREATION_LIMIT));
  return {
    ...data,
    boards: exists
      ? data.boards.map((board) => (board.id === next.id ? next : board))
      : [...data.boards, next],
    activeBoardId: next.id,
  };
}

export function deleteCharacterFolder(data: Database, folderId: string): Database {
  const folder = data.folders.find((folder) => folder.id === folderId);
  if (!folder) return data;
  const removed = folderSubtree(data.folders, folderId);
  return {
    ...data,
    folders: data.folders.filter((folder) => !removed.has(folder.id)),
    boards: data.boards.map((board) =>
      board.creatorFolderIds
        ? { ...board, creatorFolderIds: board.creatorFolderIds.filter((id) => !removed.has(id)) }
        : board,
    ),
    characters: data.characters.map((character) =>
      character.folderId !== null && removed.has(character.folderId)
        ? { ...character, folderId: folder.parentId }
        : character,
    ),
  };
}

export function deleteCharacter(data: Database, characterId: string): Database {
  return deleteCharacters(data, [characterId]);
}

export function deleteCharacters(data: Database, characterIds: string[]): Database {
  const removed = new Set(characterIds);
  return {
    ...data,
    characters: data.characters.filter((c) => !removed.has(c.id)),
    boards: data.boards.map((board) => removeCharactersFromBoard(board, removed)),
  };
}

export function removeFromBoard(board: Board, characterId: string): Board {
  return removeCharactersFromBoard(board, new Set([characterId]));
}

function removeCharactersFromBoard(board: Board, removed: Set<string>): Board {
  const members = new Set(board.characterIds.filter((id) => !removed.has(id)));
  return {
    ...board,
    characterIds: [...members],
    connections: board.connections.filter(
      (e) => !removed.has(e.sourceId) && !removed.has(e.targetId),
    ),
    ...(board.layout
      ? {
          layout: Object.fromEntries(
            Object.entries(board.layout)
              .filter(([id]) => !removed.has(id))
              .map(([id, value]) => [id, retainParents(value, members)]),
          ),
        }
      : {}),
  };
}
