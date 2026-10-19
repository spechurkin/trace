import { folderSubtree } from '../shared/folders';
import type { Character, CharacterFolder } from '../shared/model';

export function nodesFromFolders(
  nodes: Character[],
  folders: CharacterFolder[],
  selected: string[],
): Character[] {
  const included = new Set<string>();
  for (const id of selected) {
    if (!folders.some((folder) => folder.id === id)) continue;
    for (const descendant of folderSubtree(folders, id)) included.add(descendant);
  }
  return nodes.filter((node) => node.folderId !== null && included.has(node.folderId));
}
