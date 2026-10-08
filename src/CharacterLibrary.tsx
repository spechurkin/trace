import { formatClubCount, getLocale, tr } from '../shared/i18n';
import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Trash2,
  Users,
} from 'lucide-react';
import { Avatar, EmptyHint } from './components';
import type { Character, CharacterFolder, Database } from '../shared/model';
import { folderEntries, folderSubtree, folderTrail } from '../shared/folders';
import { sortByName } from './sorting';

type Props = {
  data: Database;
  search: string;
  onSearch: (value: string) => void;
  activeFolder: string;
  onSelectFolder: (id: string) => void;
  onNewFolder: () => void;
  onNewSubfolder: (folder: CharacterFolder) => void;
  onEditFolder: (folder: CharacterFolder) => void;
  onDeleteFolder: (folder: CharacterFolder) => void;
  onNewCharacter: () => void;
  onEditCharacter: (character: Character) => void;
  onDeleteCharacter: (character: Character) => void;
  onExportCharacter: (character: Character) => void;
  exporting: boolean;
};

export default function CharacterLibrary({
  data,
  search,
  onSearch,
  activeFolder,
  onSelectFolder,
  onNewFolder,
  onNewSubfolder,
  onEditFolder,
  onDeleteFolder,
  onNewCharacter,
  onEditCharacter,
  onDeleteCharacter,
  onExportCharacter,
  exporting,
}: Props) {
  const [collapsed, setCollapsed] = useState(new Set<string>());
  const entries = folderEntries(data.folders);
  const trail =
    activeFolder && activeFolder !== ':unfiled' ? folderTrail(data.folders, activeFolder) : [];
  useEffect(() => {
    const ancestors = new Set(
      folderTrail(data.folders, activeFolder)
        .slice(0, -1)
        .map((folder) => folder.id),
    );
    setCollapsed((previous) => {
      if (![...previous].some((id) => ancestors.has(id))) return previous;
      return new Set([...previous].filter((id) => !ancestors.has(id)));
    });
  }, [activeFolder, data.folders]);
  const hiddenFolders = new Set<string>();
  for (const id of collapsed)
    for (const child of folderSubtree(data.folders, id)) if (child !== id) hiddenFolders.add(child);
  const selectedBranch =
    activeFolder && activeFolder !== ':unfiled'
      ? folderSubtree(data.folders, activeFolder)
      : new Set<string>();
  const branchCounts = new Map(
    entries.map(({ folder }) => {
      const subtree = folderSubtree(data.folders, folder.id);
      return [
        folder.id,
        data.characters.filter(
          (character) => character.folderId !== null && subtree.has(character.folderId),
        ).length,
      ];
    }),
  );
  const unfiled = data.characters.filter((character) => character.folderId === null);
  const groups = [
    ...entries.map(({ folder, path }) => ({ ...folder, name: path })),
    { id: ':unfiled', name: tr('folders.unfiled') },
  ].map((folder) => ({
    ...folder,
    characters: sortByName(
      data.characters.filter(
        (character) => character.folderId === (folder.id === ':unfiled' ? null : folder.id),
      ),
    ),
  }));
  const visibleGroups = groups
    .filter(
      (group) =>
        !activeFolder ||
        (activeFolder === ':unfiled' ? group.id === ':unfiled' : selectedBranch.has(group.id)),
    )
    .map((group) => ({
      ...group,
      matches: group.characters.filter((character) =>
        character.name
          .toLocaleLowerCase(getLocale())
          .includes(search.toLocaleLowerCase(getLocale())),
      ),
    }));
  const total = visibleGroups.reduce((sum, group) => sum + group.characters.length, 0);
  const matches = visibleGroups.reduce((sum, group) => sum + group.matches.length, 0);
  const selectedFolder = groups.find((group) => group.id === activeFolder);

  return (
    <section className="library-page character-library">
      <aside className="folder-panel" aria-label={tr('folders.panelLabel')}>
        <div className="section-heading">
          <span>{tr('folders.heading')}</span>
          <button
            className="icon-button"
            aria-label={tr('folders.createCharacterFolder')}
            onClick={onNewFolder}
          >
            <FolderPlus size={17} />
          </button>
        </div>
        <button
          className={`folder-navigation ${!activeFolder ? 'active' : ''}`}
          onClick={() => onSelectFolder('')}
        >
          <Users size={16} />
          <span>{tr('characters.all')}</span>
          <span className="count">{data.characters.length}</span>
        </button>
        <button
          className={`folder-navigation ${activeFolder === ':unfiled' ? 'active' : ''}`}
          onClick={() => onSelectFolder(':unfiled')}
        >
          <FolderOpen size={16} />
          <span>{tr('folders.unfiled')}</span>
          <span className="count">{unfiled.length}</span>
        </button>
        <div className="folder-list">
          {entries
            .filter(({ folder }) => !hiddenFolders.has(folder.id))
            .map(({ folder, depth, path }) => (
              <div
                className={`folder-row ${activeFolder === folder.id ? 'active' : ''}`}
                key={folder.id}
              >
                <div className="folder-row-header" style={{ paddingLeft: Math.min(depth, 6) * 10 }}>
                  {data.folders.some((child) => child.parentId === folder.id) ? (
                    <button
                      className="folder-toggle"
                      aria-label={tr(
                        'folders.toggleLabel',
                        collapsed.has(folder.id) ? tr('actions.expand') : tr('actions.collapse'),
                        path,
                      )}
                      aria-expanded={!collapsed.has(folder.id)}
                      onClick={() => {
                        const closing = !collapsed.has(folder.id);
                        setCollapsed((previous) => {
                          const next = new Set(previous);
                          if (closing) next.add(folder.id);
                          else next.delete(folder.id);
                          return next;
                        });
                        if (
                          closing &&
                          activeFolder !== folder.id &&
                          folderSubtree(data.folders, folder.id).has(activeFolder)
                        )
                          onSelectFolder(folder.id);
                      }}
                    >
                      {collapsed.has(folder.id) ? (
                        <ChevronRight size={14} />
                      ) : (
                        <ChevronDown size={14} />
                      )}
                    </button>
                  ) : (
                    <span className="folder-toggle-spacer" />
                  )}
                  <button
                    className="folder-navigation"
                    aria-label={tr(
                      'folders.characterCountLabel',
                      path,
                      branchCounts.get(folder.id) || 0,
                    )}
                    onClick={() => onSelectFolder(folder.id)}
                    title={path}
                  >
                    <Folder size={16} />
                    <span>{folder.name}</span>
                    <span className="count">{branchCounts.get(folder.id) || 0}</span>
                  </button>
                </div>
                <div className="folder-actions">
                  <button
                    className="icon-button"
                    aria-label={tr('folders.createSubfolderLabel', path)}
                    title={tr('folders.createSubfolder')}
                    onClick={() => onNewSubfolder(folder)}
                  >
                    <FolderPlus size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={tr('folders.renameLabel', path)}
                    title={tr('folders.editLocationHint')}
                    onClick={() => onEditFolder(folder)}
                  >
                    <Pencil size={13} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={tr('folders.deleteLabel', path)}
                    onClick={() => onDeleteFolder(folder)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
        </div>
        <button className="text-button" onClick={onNewFolder}>
          <FolderPlus size={15} />
          {tr('folders.new')}
        </button>
        <p className="folder-help">{tr('folders.nestingHint')}</p>
      </aside>

      <div className="folder-content">
        {activeFolder && (
          <nav className="folder-breadcrumbs" aria-label={tr('folders.pathLabel')}>
            <button onClick={() => onSelectFolder('')}>{tr('characters.all')}</button>
            {trail.map((folder, index) => (
              <span key={folder.id}>
                <ChevronRight size={12} />
                <button
                  aria-current={index === trail.length - 1 ? 'page' : undefined}
                  onClick={() => onSelectFolder(folder.id)}
                >
                  {folder.name}
                </button>
              </span>
            ))}
            {activeFolder === ':unfiled' && (
              <span>
                <ChevronRight size={12} />
                {tr('folders.unfiled')}
              </span>
            )}
          </nav>
        )}
        <div className="page-toolbar">
          <div className="search-input">
            <Search size={17} />
            <input
              placeholder={tr('characters.searchPlaceholder')}
              aria-label={tr('characters.searchLabel')}
              value={search}
              onChange={(event) => onSearch(event.target.value)}
            />
          </div>
          <span className="muted">
            {search
              ? tr('characters.searchResults', matches, total)
              : tr('counts.charactersWithValue', total)}
          </span>
        </div>
        {visibleGroups
          .filter((group) => group.matches.length)
          .map((group) => (
            <section
              className="character-folder-group"
              key={group.id}
              aria-label={tr('folders.groupLabel', group.name)}
            >
              <div className="folder-group-heading">
                <FolderOpen size={17} />
                <h2>{group.name}</h2>
                <span className="count">{group.matches.length}</span>
              </div>
              <div className="character-grid">
                {group.matches.map((character) => (
                  <article className="character-card" key={character.id}>
                    <div className="card-top">
                      <Avatar character={character} size={62} />
                      <div className="card-actions">
                        <button
                          className="icon-button"
                          aria-label={tr('characters.editLabel', character.name)}
                          title={tr('characters.edit')}
                          onClick={() => onEditCharacter(character)}
                        >
                          <Pencil size={15} />
                        </button>
                        <button
                          className="icon-button"
                          aria-label={tr('characters.deleteLabel', character.name)}
                          onClick={() => onDeleteCharacter(character)}
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </div>
                    <h2>{character.name}</h2>
                    <p>{character.notes || tr('characters.defaultNotes')}</p>
                    <div className="card-bottom">
                      <span>
                        {formatClubCount(
                          data.clubs.filter((club) => club.characterIds.includes(character.id))
                            .length,
                        )}
                      </span>
                      <button
                        className="text-button"
                        disabled={exporting}
                        aria-label={tr('characters.exportLabel', character.name)}
                        title={tr('characters.exportHint')}
                        onClick={() => onExportCharacter(character)}
                      >
                        {tr('actions.download')}
                        <Download size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!group.matches.length && <EmptyHint>{tr('folders.noCharactersHint')}</EmptyHint>}
            </section>
          ))}
        {!total && !search && (
          <div className="page-empty">
            <div className="page-empty-icon">
              {activeFolder ? <FolderOpen size={38} /> : <Users size={38} />}
            </div>
            <h2>{activeFolder ? tr('folders.emptyHeading') : tr('characters.emptyHeading')}</h2>
            <p>
              {activeFolder
                ? tr('folders.emptyDescription', selectedFolder?.name || tr('folders.unfiled'))
                : tr('characters.emptyDescription')}
            </p>
            <button className="button primary" onClick={onNewCharacter}>
              <Users size={16} />
              {tr('characters.create')}
            </button>
          </div>
        )}
        {search && !matches && <EmptyHint>{tr('characters.noSearchResults')}</EmptyHint>}
      </div>
    </section>
  );
}
