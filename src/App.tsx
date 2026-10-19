import { getLocale, isLocale, setLocale, subscribeLocale, tr } from '../shared/i18n';
import { version as appVersion } from '../package.json';
import { type ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle as BoardIcon,
  CircleDot as BoardDot,
  Copy,
  Download,
  Eye,
  EyeOff,
  Fingerprint,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Link2,
  LoaderCircle as LoadingIcon,
  MapPin,
  Maximize,
  MoreHorizontal,
  Pencil,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  Upload,
  Users,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type Board,
  BOARD_CREATION_LIMIT,
  type Character,
  type CharacterFolder,
  databaseSchema,
  deleteCharacter,
  deleteCharacterFolder,
  deleteCharacters,
  removeFromBoard,
  upsertBoard,
} from '../shared/model';
import {
  createCharactersTransfer,
  createStoriesTransfer,
  describeImport,
  type TransferPackage,
} from '../shared/transfer';
import { folderKindOf, folderPath, folderSubtree } from '../shared/folders';
import { Modal } from './components';
import { BoardForm, CharacterForm, FolderForm, ParticipantsForm } from './forms';
import CharacterLibrary from './CharacterLibrary';
import Diagram from './Diagram';
import { demoDatabase } from './demo';
import { storage } from './storage';
import { useLibrary } from './useLibrary';
import {
  boardEdges,
  CULPRIT,
  investigationTypes,
  kindOf,
  type NodeKind,
  retainMembers,
} from '../shared/investigation';
import { UpdateSettings, useUpdates } from './Updates';
import { BranchForm } from './InvestigationForms';
import { BoardInspector } from './BoardInspector';
import { ThemeSettings } from './themes/ThemeSettings';
import { InvestigationCreator } from './InvestigationCreator';
import { applyCreatorDiagram } from './creator-diagram';
import { messages as creatorMessages } from '../modules/investigation-creator/messages';

type View = 'boards' | 'characters' | 'evidence' | 'locations' | 'events' | 'settings';
type Editor = {
  kind: 'character' | 'folder' | 'board' | 'participants' | 'connection';
  id?: string;
  nodeKind?: NodeKind;
  sourceId?: string;
  targetId?: string;
  parentId?: string | null;
};
type Confirmation = { title: string; text: string; action: () => void };

function OrbitMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <circle cx="17" cy="17" r="12" stroke="currentColor" strokeWidth="2" />
      <path d="M26 26 L35 35" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
      <path
        d="M11 22 L16.5 14 L23 18"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <circle cx="11" cy="22" r="2.3" fill="currentColor" />
      <circle cx="16.5" cy="14" r="2.3" fill="currentColor" />
      <circle cx="23" cy="18" r="2.3" fill="currentColor" />
    </svg>
  );
}

function Count({ children }: { children: ReactNode }) {
  return <span className="count">{children}</span>;
}

export default function App() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale);
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = tr('app.name');
  }, [locale]);
  const library = useLibrary();
  const updateState = useUpdates();
  const { data, commit } = library;
  const [view, setView] = useState<View>('boards');
  const activeKind: NodeKind =
    view === 'evidence'
      ? 'evidence'
      : view === 'locations'
        ? 'location'
        : view === 'events'
          ? 'event'
          : 'person';
  const [editor, setEditor] = useState<Editor | null>(null);
  const [creator, setCreator] = useState<'create' | 'audit' | null>(null);
  const [createUsingAssistant, setCreateUsingAssistant] = useState(false);
  const creatorText = creatorMessages(locale);
  const closeCreator = useCallback(() => setCreator(null), []);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [selectedCharacter, setSelectedCharacter] = useState<string>();
  const [selectedEdge, setSelectedEdge] = useState<string>();
  const [search, setSearch] = useState('');
  const [activeFolders, setActiveFolders] = useState<Partial<Record<NodeKind, string>>>({});
  const activeFolder = activeFolders[activeKind] || '';
  const setActiveFolder = (id: string) =>
    setActiveFolders((previous) => ({ ...previous, [activeKind]: id }));
  const [hiddenTypes, setHiddenTypes] = useState(new Set<string>());
  const [labels, setLabels] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const attachDiagramWheel = useCallback((viewport: HTMLDivElement | null) => {
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const deltaX =
        event.deltaX *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientWidth
            : 1);
      const deltaY =
        event.deltaY *
        (event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? viewport.clientHeight
            : 1);
      if (event.ctrlKey || event.metaKey) {
        setZoom((current) => Math.max(0.5, Math.min(2.5, current * Math.exp(-deltaY * 0.002))));
        return;
      }
      const horizontal = event.shiftKey && deltaX === 0;
      setPan((current) => ({
        x: current.x - (horizontal ? deltaY : deltaX),
        y: current.y - (horizontal ? 0 : deltaY),
      }));
    };
    // Cancel native scrolling and browser zoom only over the diagram.
    viewport.addEventListener('wheel', wheel, { passive: false });
    return () => viewport.removeEventListener('wheel', wheel);
  }, []);
  const [linking, setLinking] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [boardMenu, setBoardMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const board = data?.boards.find((c) => c.id === data.activeBoardId) || data?.boards[0];
  const closeEditor = useCallback(() => {
    setEditor(null);
    setCreateUsingAssistant(false);
  }, []);
  const clearSelection = () => {
    setSelectedCharacter(undefined);
    setSelectedEdge(undefined);
  };
  const notify = (message: string) => setToast(message);

  useEffect(() => {
    clearSelection();
    setHiddenTypes(new Set());
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setLinking(false);
    setBoardMenu(false);
  }, [board?.id]);
  useEffect(() => {
    if (
      data &&
      activeFolder &&
      activeFolder !== ':unfiled' &&
      !data.folders.some(
        (folder) => folder.id === activeFolder && folderKindOf(folder) === activeKind,
      )
    ) {
      setActiveFolder('');
    }
  }, [data?.folders, activeFolder, activeKind]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(''), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSelection();
        setLinking(false);
        setExportMenu(false);
        setBoardMenu(false);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        void library
          .flush()
          .then(() => notify(tr('notifications.librarySaved')))
          .catch((error) => notify(String(error)));
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [library.flush]);

  const updateBoard = (update: (board: Board) => Board) => {
    if (board)
      commit((data) => ({
        ...data,
        boards: data.boards.map((c) => (c.id === board.id ? update(c) : c)),
      }));
  };
  const changeView = (next: View) => {
    setCreator(null);
    setView(next);
    setSearch('');
    setExportMenu(false);
    setBoardMenu(false);
  };
  const libraryView = ['characters', 'evidence', 'locations', 'events'].includes(view);
  const [roleFilter, setRoleFilter] = useState<'all' | 'witness' | 'suspect' | 'victim'>('all');
  const newCharacter = () => setEditor({ kind: 'character', nodeKind: activeKind });
  const newFolder = () =>
    setEditor({
      kind: 'folder',
      parentId: activeFolder && activeFolder !== ':unfiled' ? activeFolder : null,
    });
  const newConnection = () => {
    if (!board || board.characterIds.length < 1) {
      setEditor({ kind: 'participants' });
      return;
    }
    setEditor({ kind: 'connection', sourceId: selectedCharacter });
  };
  const saveCharacter = (character: Character, add: boolean) => {
    commit((data) => ({
      ...data,
      characters: data.characters.some((c) => c.id === character.id)
        ? data.characters.map((c) => (c.id === character.id ? character : c))
        : [...data.characters, character],
      boards:
        add && board
          ? data.boards.map((c) =>
              c.id === board.id && !c.characterIds.includes(character.id)
                ? { ...c, characterIds: [...c.characterIds, character.id] }
                : c,
            )
          : data.boards,
    }));
    closeEditor();
    notify(tr('notifications.characterSaved'));
  };
  const saveFolder = (folder: CharacterFolder) => {
    commit((data) => ({
      ...data,
      folders: data.folders.some((item) => item.id === folder.id)
        ? data.folders.map((item) => (item.id === folder.id ? folder : item))
        : [...data.folders, folder],
    }));
    setActiveFolder(folder.id);
    closeEditor();
    notify(tr('notifications.folderSaved'));
  };
  const askDeleteFolder = (folder: CharacterFolder) => {
    if (!data) return;
    const removed = folderSubtree(data.folders, folder.id);
    const destination = folder.parentId
      ? folderPath(data.folders, folder.parentId)
      : tr('folders.unfiled');
    setConfirmation({
      title: removed.size > 1 ? tr('folders.deleteBranchTitle') : tr('folders.deleteTitle'),
      text: tr(
        'folders.deleteMessage',
        folderPath(data.folders, folder.id),
        removed.size > 1
          ? tr('folders.deleteBranchSuffix', removed.size - 1)
          : tr('folders.deleteSingleSuffix'),
        destination,
      ),
      action: () => {
        commit((data) => deleteCharacterFolder(data, folder.id));
        if (removed.has(activeFolder)) setActiveFolder(folder.parentId || ':unfiled');
      },
    });
  };
  const saveBoard = (next: Board) => {
    try {
      commit((data) => upsertBoard(data, next));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : tr('validation.boardLimit', BOARD_CREATION_LIMIT),
      );
      return;
    }
    setView('boards');
    closeEditor();
    if (createUsingAssistant) {
      setCreator('create');
      setCreateUsingAssistant(false);
    }
  };
  const askDeleteCharacter = (character: Character) =>
    setConfirmation({
      title: tr('characters.deleteTitle'),
      text: tr('characters.deleteMessage', character.name),
      action: () => {
        commit((data) => deleteCharacter(data, character.id));
        clearSelection();
      },
    });
  const askDeleteCharacters = (characterIds: string[]) => {
    if (!characterIds.length) return;
    setConfirmation({
      title: tr('characters.deleteSelectedTitle'),
      text: tr('characters.deleteSelectedMessage', characterIds.length),
      action: () => {
        commit((data) => deleteCharacters(data, characterIds));
        clearSelection();
      },
    });
  };
  const importBackup = async () => {
    setBusy(true);
    try {
      await library.flush();
      const result = await storage.importBackup();
      if (result) {
        library.adopt(result);
        clearSelection();
        notify(tr('notifications.libraryImported'));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('errors.libraryImport'));
    } finally {
      setBusy(false);
    }
  };
  const exportJSON = async (file: TransferPackage, name: string) => {
    setExportMenu(false);
    setBusy(true);
    try {
      if (await storage.exportTransfer(file, name)) notify(tr('notifications.jsonSaved'));
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('errors.dataExport'));
    } finally {
      setBusy(false);
    }
  };
  const importJSON = async () => {
    setExportMenu(false);
    setBusy(true);
    try {
      await library.flush();
      const result = await storage.importTransfer();
      if (result) {
        library.adopt(result);
        clearSelection();
        notify(describeImport(result.summary));
      }
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('errors.dataImport'));
    } finally {
      setBusy(false);
    }
  };
  const makeExport = async (format: 'png' | 'svg') => {
    if (!data || !board) return;
    setExportMenu(false);
    setBusy(true);
    try {
      const { exportDiagram } = await import('./export');
      if (await exportDiagram(data, board, format, labels))
        notify(tr('notifications.diagramSaved', format.toUpperCase()));
    } catch (error) {
      notify(error instanceof Error ? error.message : tr('errors.diagramExport'));
    } finally {
      setBusy(false);
    }
  };
  const pickCharacter = (id: string) => {
    if (id === CULPRIT && !linking) {
      setCreator(board?.characterIds.length ? 'audit' : 'create');
      clearSelection();
      return;
    }
    if (linking && selectedCharacter && selectedCharacter !== id) {
      setEditor({ kind: 'connection', sourceId: selectedCharacter, targetId: id });
      setLinking(false);
    }
    setSelectedCharacter(id);
    setSelectedEdge(undefined);
  };
  if (!data)
    return (
      <div className="loading-screen">
        <OrbitMark size={54} />
        <h1>{tr('app.name')}</h1>
        {library.status === 'loading' ? (
          <>
            <LoadingIcon className="spin" size={24} />
            <p>{tr('library.opening')}</p>
          </>
        ) : (
          <>
            <p className="form-error">{library.error}</p>
            <div className="button-row">
              <button className="button secondary" onClick={() => void library.load()}>
                {tr('actions.tryAgain')}
              </button>
              <button className="button primary" onClick={() => void importBackup()}>
                {tr('actions.importBackup')}
              </button>
            </div>
          </>
        )}
      </div>
    );

  const relationTypes = investigationTypes();
  const connections = board ? boardEdges(board, data.characters) : [];
  const title =
    view === 'boards'
      ? board?.name || tr('boards.emptyTitle')
      : view === 'characters'
        ? tr('characters.libraryTitle')
        : libraryView
          ? tr(
              view === 'evidence'
                ? 'trace.evidenceTab'
                : view === 'locations'
                  ? 'trace.locations'
                  : 'trace.events',
            )
          : tr('settings.title');
  const subtitle =
    view === 'boards'
      ? board?.description || tr('boards.subtitle')
      : view === 'characters'
        ? tr('characters.subtitle')
        : libraryView
          ? tr(
              view === 'evidence'
                ? 'trace.evidenceSubtitle'
                : view === 'locations'
                  ? 'trace.locationSubtitle'
                  : 'trace.eventSubtitle',
            )
          : tr('settings.subtitle');

  return (
    <div className="app-shell">
      <nav className="rail" aria-label={tr('navigation.mainLabel')}>
        <button
          className="brand-mark"
          aria-label={tr('app.name')}
          onClick={() => changeView('boards')}
        >
          <OrbitMark size={36} />
        </button>
        <div className="rail-links">
          {(
            [
              ['boards', BoardDot, tr('navigation.boards')],
              ['characters', Users, tr('navigation.characters')],
              ['evidence', Fingerprint, tr('trace.evidenceTab')],
              ['locations', MapPin, tr('trace.locations')],
              ['events', CalendarDays, tr('trace.events')],
            ] as const
          ).map(([id, Icon, label]) => (
            <button
              key={id}
              className={`rail-button ${view === id ? 'active' : ''}`}
              onClick={() => changeView(id)}
              aria-label={label}
              title={label}
            >
              <Icon size={21} />
              <span>{label}</span>
            </button>
          ))}
        </div>
        <div className="rail-bottom">
          <button
            className={`rail-button ${view === 'settings' ? 'active' : ''}`}
            aria-label={tr('navigation.settings')}
            title={tr('settings.title')}
            onClick={() => changeView('settings')}
          >
            <Settings2 size={21} />
            <span>{tr('navigation.settings')}</span>
          </button>
          <span className="version">v{appVersion}</span>
        </div>
      </nav>

      <aside className="sidebar">
        <div className="sidebar-brand">
          <span className="wordmark">
            {tr('app.name')}
            <span>.</span>
          </span>
          <span className="brand-caption">{tr('app.tagline')}</span>
        </div>
        <div className="section-heading">
          <span>{tr('boards.sidebarHeading')}</span>
          <Count>{data.boards.length}</Count>
        </div>
        <button
          className="button new-board new-club"
          disabled={data.boards.length >= BOARD_CREATION_LIMIT}
          title={
            data.boards.length >= BOARD_CREATION_LIMIT
              ? tr('validation.boardLimit', BOARD_CREATION_LIMIT)
              : undefined
          }
          onClick={() => setEditor({ kind: 'board' })}
        >
          <Plus size={17} />
          {tr('boards.new')}
        </button>
        {data.boards.length >= BOARD_CREATION_LIMIT && (
          <p className="sidebar-hint">{tr('validation.boardLimit', BOARD_CREATION_LIMIT)}</p>
        )}
        <div className="board-list club-list">
          {data.boards.map((c) => (
            <button
              className={`board-list-item club-list-item ${c.id === board?.id && view === 'boards' ? 'active' : ''}`}
              key={c.id}
              onClick={() => {
                commit((data) => ({ ...data, activeBoardId: c.id }));
                changeView('boards');
              }}
            >
              <BoardIcon size={17} />
              <span>
                <strong>{c.name}</strong>
                <small>
                  {c.characterIds.length}
                  {tr('counts.charactersSeparator')}
                  {boardEdges(c, data.characters).length}
                  {tr('counts.connectionsSuffix')}
                </small>
              </span>
              {c.id === board?.id && view === 'boards' && <ChevronRight size={15} />}
            </button>
          ))}
          {!data.boards.length && <p className="sidebar-hint">{tr('boards.sidebarHint')}</p>}
        </div>
        <div className="sidebar-relations">
          <div className="section-heading">
            <span>{tr('relationships.heading')}</span>
          </div>
          {relationTypes.map((type) => (
            <div
              className={`legend-row ${hiddenTypes.has(type.id) ? 'is-hidden' : ''}`}
              key={type.id}
            >
              <span className="legend-name">
                <i style={{ background: type.color }} />
                <span>{type.name}</span>
              </span>
              <button
                className="icon-button"
                aria-label={tr(
                  'relationships.toggleVisibilityLabel',
                  hiddenTypes.has(type.id) ? tr('actions.show') : tr('actions.hide'),
                  type.name,
                )}
                onClick={() =>
                  setHiddenTypes((previous) => {
                    const next = new Set(previous);
                    if (next.has(type.id)) next.delete(type.id);
                    else next.add(type.id);
                    return next;
                  })
                }
              >
                {hiddenTypes.has(type.id) ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          ))}
          <p className="sidebar-hint">{tr('trace.branchHint')}</p>
        </div>
        <div className="local-badge">
          <span className="status-dot" />
          <div>
            <strong>{tr('app.localOnly')}</strong>
            <small>{window.desktop ? tr('app.offline') : tr('app.browserStorage')}</small>
          </div>
          <HardDrive size={17} />
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="page-heading">
            <div className="breadcrumb">
              {tr('navigation.workspaceHeading')}
              <span>/</span>
              {view === 'boards'
                ? tr('navigation.boardsHeading')
                : view === 'characters'
                  ? tr('navigation.charactersHeading')
                  : libraryView
                    ? title
                    : tr('navigation.settingsHeading')}
            </div>
            <h1>{title}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="header-actions">
            {view === 'boards' && board && !creator && (
              <>
                <div className="dropdown-wrap">
                  <button
                    className="icon-button more-board"
                    aria-label={tr('boards.actionsLabel')}
                    onClick={() => setBoardMenu(!boardMenu)}
                  >
                    <MoreHorizontal size={22} />
                  </button>
                  {boardMenu && (
                    <div className="dropdown">
                      <button
                        onClick={() => {
                          setEditor({ kind: 'board', id: board.id });
                          setBoardMenu(false);
                        }}
                      >
                        <Pencil size={15} />
                        {tr('boards.edit')}
                      </button>
                      <button
                        disabled={data.boards.length >= BOARD_CREATION_LIMIT}
                        title={
                          data.boards.length >= BOARD_CREATION_LIMIT
                            ? tr('validation.boardLimit', BOARD_CREATION_LIMIT)
                            : undefined
                        }
                        onClick={() => {
                          const copy = {
                            ...board,
                            id: crypto.randomUUID(),
                            name: tr('boards.copyName', board.name.slice(0, 70)),
                            characterIds: [...board.characterIds],
                            connections: board.connections.map((e) => ({
                              ...e,
                              id: crypto.randomUUID(),
                            })),
                          };
                          saveBoard(copy);
                          setBoardMenu(false);
                        }}
                      >
                        <Copy size={15} />
                        {tr('actions.duplicate')}
                      </button>
                      <button
                        className="danger-text"
                        onClick={() => {
                          setConfirmation({
                            title: tr('boards.deleteTitle'),
                            text: tr('boards.deleteMessage', board.name),
                            action: () => {
                              commit((data) => {
                                const boards = data.boards.filter((c) => c.id !== board.id);
                                return { ...data, boards, activeBoardId: boards[0]?.id || null };
                              });
                              clearSelection();
                            },
                          });
                          setBoardMenu(false);
                        }}
                      >
                        <Trash2 size={15} />
                        {tr('boards.delete')}
                      </button>
                    </div>
                  )}
                </div>
                <div className="dropdown-wrap">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setExportMenu(!exportMenu)}
                  >
                    <Download size={16} />
                    {tr('actions.export')}
                    <ChevronDown size={13} />
                  </button>
                  {exportMenu && (
                    <div className="dropdown export-dropdown">
                      <button
                        onClick={() =>
                          void exportJSON(
                            createStoriesTransfer(data, [board.id]),
                            tr('filenames.story', board.name),
                          )
                        }
                      >
                        <BookOpen size={15} />
                        <span>
                          {tr('transfer.story')}
                          <small>{tr('transfer.storyHint')}</small>
                        </span>
                      </button>
                      <button
                        onClick={() =>
                          void exportJSON(createStoriesTransfer(data), tr('filenames.allStories'))
                        }
                      >
                        <Copy size={15} />
                        <span>
                          {tr('transfer.allStories')}
                          <small>{tr('transfer.allStoriesHint')}</small>
                        </span>
                      </button>
                      <button onClick={() => void importJSON()}>
                        <Upload size={15} />
                        <span>
                          {tr('transfer.import')}
                          <small>{tr('transfer.importHint')}</small>
                        </span>
                      </button>
                      <button onClick={() => void makeExport('png')}>
                        <Download size={15} />
                        <span>
                          {tr('export.png')}
                          <small>{tr('export.pngHint')}</small>
                        </span>
                      </button>
                      <button onClick={() => void makeExport('svg')}>
                        <Download size={15} />
                        <span>
                          {tr('export.svg')}
                          <small>{tr('export.svgHint')}</small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                <button className="button primary" onClick={newConnection}>
                  <Plus size={17} />
                  {tr('connections.add')}
                </button>
              </>
            )}
            {libraryView && (
              <>
                <div className="dropdown-wrap">
                  <button
                    className="button secondary"
                    disabled={busy}
                    onClick={() => setExportMenu(!exportMenu)}
                  >
                    <Download size={16} />
                    {tr('transfer.export')}
                    <ChevronDown size={13} />
                  </button>
                  {exportMenu && (
                    <div className="dropdown export-dropdown">
                      <button
                        onClick={() =>
                          void exportJSON(
                            createCharactersTransfer(data),
                            tr('filenames.allCharacters'),
                          )
                        }
                      >
                        <Users size={15} />
                        <span>
                          {tr('transfer.allCharacters')}
                          <small>{tr('transfer.charactersHint')}</small>
                        </span>
                      </button>
                      <button
                        disabled={!activeFolder}
                        onClick={() =>
                          void exportJSON(
                            createCharactersTransfer(data, {
                              folderId: activeFolder === ':unfiled' ? null : activeFolder,
                            }),
                            tr(
                              'filenames.characters',
                              data.folders.find((folder) => folder.id === activeFolder)?.name ||
                                tr('folders.unfiled'),
                            ),
                          )
                        }
                      >
                        <FolderOpen size={15} />
                        <span>
                          {tr('transfer.currentFolder')}
                          <small>
                            {activeFolder
                              ? tr('transfer.folderHint')
                              : tr('transfer.selectFolderHint')}
                          </small>
                        </span>
                      </button>
                      <button onClick={() => void importJSON()}>
                        <Upload size={15} />
                        <span>
                          {tr('transfer.import')}
                          <small>{tr('transfer.addToLibrary')}</small>
                        </span>
                      </button>
                    </div>
                  )}
                </div>
                <button className="button secondary" onClick={newFolder}>
                  <FolderPlus size={17} />
                  {tr('folders.new')}
                </button>
                <button className="button primary" onClick={newCharacter}>
                  <Plus size={17} />
                  {tr(
                    activeKind === 'evidence'
                      ? 'trace.evidenceNew'
                      : activeKind === 'location'
                        ? 'trace.locationNew'
                        : activeKind === 'event'
                          ? 'trace.eventNew'
                          : 'characters.new',
                  )}
                </button>
              </>
            )}
          </div>
        </header>

        {(library.error || library.warning) && (
          <div className="save-alert" role="alert">
            <span>{library.error || library.warning}</span>
            {library.error && (
              <button className="text-button" onClick={library.retry}>
                {tr('actions.retrySave')}
              </button>
            )}
          </div>
        )}

        {view === 'boards' && !creator && (
          <div className="editor-layout">
            <section
              className={`canvas ${linking ? 'linking' : ''}`}
              aria-label={tr('diagram.editorLabel')}
            >
              {board ? (
                <>
                  <div className="canvas-top">
                    <div className="canvas-meta">
                      <span className="status-dot" />
                      {tr('diagram.heading')}
                      <span className="meta-divider">/</span>
                      {board.characterIds.length}
                      {tr('counts.membersSuffix')}
                    </div>
                    <button
                      className={`button canvas-tool ${linking ? 'active' : ''}`}
                      onClick={() => {
                        setLinking(!linking);
                        clearSelection();
                      }}
                      title={tr('diagram.connectHint')}
                    >
                      <Link2 size={15} />
                      {tr('diagram.connect')}
                    </button>
                  </div>
                  <div
                    className="diagram-viewport"
                    ref={attachDiagramWheel}
                    onPointerDown={(e) => {
                      if (
                        e.button !== 0 ||
                        (e.target as Element).closest('.diagram-node, .diagram-edge')
                      )
                        return;
                      e.preventDefault();
                      const origin = { x: e.clientX, y: e.clientY },
                        previous = pan;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      const viewport = e.currentTarget;
                      const move = (event: PointerEvent) =>
                        setPan({
                          x: previous.x + event.clientX - origin.x,
                          y: previous.y + event.clientY - origin.y,
                        });
                      const up = () => {
                        viewport.removeEventListener('pointermove', move);
                        viewport.removeEventListener('pointerup', up);
                        viewport.removeEventListener('pointercancel', up);
                      };
                      viewport.addEventListener('pointermove', move);
                      viewport.addEventListener('pointerup', up);
                      viewport.addEventListener('pointercancel', up);
                    }}
                  >
                    <div
                      className="diagram-transform"
                      style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
                    >
                      <Diagram
                        board={board}
                        characters={data.characters}
                        types={relationTypes}
                        onMove={(id, position) =>
                          updateBoard((c) => ({
                            ...c,
                            layout: { ...c.layout, [id]: { ...c.layout?.[id], ...position } },
                          }))
                        }
                        selectedCharacter={selectedCharacter}
                        selectedEdge={selectedEdge}
                        hiddenTypes={hiddenTypes}
                        showLabels={labels}
                        onCharacter={pickCharacter}
                        onEdge={(id) => {
                          const edge = connections.find((edge) => edge.id === id);
                          if (edge) pickCharacter(edge.targetId);
                        }}
                        onBackground={() => {
                          if (!linking) clearSelection();
                        }}
                      />
                    </div>
                  </div>
                  <div className="canvas-bottom">
                    <p>
                      {linking
                        ? selectedCharacter
                          ? tr('diagram.selectSecond')
                          : tr('diagram.selectFirst')
                        : tr('diagram.selectionHint')}
                    </p>
                    <div className="zoom-controls">
                      <button
                        className="icon-button"
                        aria-label={tr('diagram.zoomOut')}
                        onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(1)))}
                        disabled={zoom <= 0.5}
                      >
                        <ZoomOut size={17} />
                      </button>
                      <span>{Math.round(zoom * 100)}%</span>
                      <button
                        className="icon-button"
                        aria-label={tr('diagram.zoomIn')}
                        onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(1)))}
                        disabled={zoom >= 2.5}
                      >
                        <ZoomIn size={17} />
                      </button>
                      <i />
                      <button
                        className="icon-button"
                        aria-label={tr('diagram.center')}
                        onClick={() => {
                          setZoom(1);
                          setPan({ x: 0, y: 0 });
                        }}
                      >
                        <Maximize size={16} />
                      </button>
                    </div>
                    <button
                      className={`label-toggle ${labels ? 'active' : ''}`}
                      onClick={() => setLabels(!labels)}
                    >
                      <Tag size={15} />
                      {tr('diagram.labels')}
                    </button>
                  </div>
                </>
              ) : (
                <div className="canvas-empty">
                  <div className="empty-orbit">
                    <OrbitMark size={120} />
                  </div>
                  <span className="eyebrow">{tr('boards.emptyEyebrow')}</span>
                  <h2>{board ? tr('boards.noMembersHeading') : tr('boards.emptyHeading')}</h2>
                  <p>{board ? tr('boards.noMembersDescription') : tr('boards.emptyDescription')}</p>
                  <button
                    className="button primary"
                    onClick={() => setEditor({ kind: board ? 'participants' : 'board' })}
                  >
                    <Plus size={17} />
                    {board ? tr('characters.add') : tr('boards.createFirst')}
                  </button>
                  {!board && !data.characters.length && (
                    <button
                      className="text-button demo-button"
                      onClick={() => {
                        commit(() => demoDatabase());
                        notify(tr('notifications.exampleAdded'));
                      }}
                    >
                      <Sparkles size={15} />
                      {tr('demo.explore')}
                    </button>
                  )}
                  {!board && (
                    <button
                      className="button secondary"
                      disabled={data.boards.length >= BOARD_CREATION_LIMIT}
                      onClick={() => {
                        setCreateUsingAssistant(true);
                        setEditor({ kind: 'board' });
                      }}
                    >
                      {creatorText('title')}
                    </button>
                  )}
                  <div className="onboarding-steps">
                    <span>
                      <b>01</b>
                      {tr('navigation.characters')}
                    </span>
                    <i />
                    <span>
                      <b>02</b>
                      {tr('trace.evidenceTab')}
                    </span>
                    <i />
                    <span>
                      <b>03</b>
                      {tr('boards.defaultName')}
                    </span>
                  </div>
                </div>
              )}
            </section>

            <BoardInspector
              board={board}
              nodes={data.characters}
              selected={selectedCharacter}
              onSelect={(id) => {
                setSelectedCharacter(id);
                setSelectedEdge(undefined);
              }}
              onEdit={(id) => setEditor({ kind: 'character', id })}
              onConnect={newConnection}
              onMembers={() => setEditor({ kind: 'participants' })}
              onNew={newCharacter}
              onLock={(id) =>
                updateBoard((c) => ({
                  ...c,
                  layout: {
                    ...c.layout,
                    [id]: { ...c.layout?.[id], locked: !c.layout?.[id]?.locked },
                  },
                }))
              }
              onRemove={(id) =>
                setConfirmation({
                  title: tr('members.removeTitle'),
                  text: tr('members.removeMessage', data.characters.find((n) => n.id === id)?.name),
                  action: () => {
                    updateBoard((c) => removeFromBoard(c, id));
                    clearSelection();
                  },
                })
              }
            />
          </div>
        )}

        {creator && board && view === 'boards' && (
          <InvestigationCreator
            key={board.id}
            board={board}
            nodes={data.characters}
            folders={data.folders}
            locale={locale}
            audit={creator === 'audit'}
            onClose={closeCreator}
            onFoldersChange={(creatorFolderIds) =>
              commit((current) => ({
                ...current,
                boards: current.boards.map((item) =>
                  item.id === board.id ? { ...item, creatorFolderIds } : item,
                ),
              }))
            }
            onSave={(plan, members, close, diagram) => {
              commit((current) => {
                const updated = new Map(members.map((n) => [n.id, n]));
                const existing = new Set(current.characters.map((n) => n.id));
                return databaseSchema.parse({
                  ...current,
                  characters: [
                    ...current.characters.map((n) => updated.get(n.id) || n),
                    ...members.filter((n) => !existing.has(n.id)),
                  ],
                  boards: current.boards.map((c) =>
                    c.id === board.id
                      ? applyCreatorDiagram(
                        { ...c, characterIds: members.map((n) => n.id), investigation: plan },
                        diagram || { nodes: [] },
                      )
                      : c,
                  ),
                });
              });
              if (close) closeCreator();
            }}
          />
        )}

        {libraryView && (
          <>
            <div className="library-role-toolbar">
              {activeKind === 'person' ? (
                <div className="role-filter" role="group" aria-label={tr('trace.roles')}>
                  {(['all', 'witness', 'suspect', 'victim'] as const).map((role) => (
                    <button
                      key={role}
                      className={roleFilter === role ? 'active' : ''}
                      aria-pressed={roleFilter === role}
                      onClick={() => setRoleFilter(role)}
                    >
                      {tr(
                        role === 'all'
                          ? 'trace.allRoles'
                          : role === 'witness'
                            ? 'trace.filterWitness'
                            : role === 'victim'
                              ? 'trace.filterVictim'
                              : 'trace.filterSuspect',
                      )}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">{tr('trace.libraryHint')}</p>
              )}
            </div>
            <CharacterLibrary
              key={`${activeKind}:${roleFilter}`}
              data={{
                ...data,
                folders: data.folders.filter((folder) => folderKindOf(folder) === activeKind),
                characters: data.characters.filter(
                  (n) =>
                    kindOf(n) === activeKind &&
                    (activeKind !== 'person' ||
                      roleFilter === 'all' ||
                      (roleFilter === 'witness'
                        ? n.witness
                        : roleFilter === 'victim'
                          ? n.victim
                          : n.suspect !== false)),
                ),
              }}
              search={search}
              onSearch={setSearch}
              activeFolder={activeFolder}
              onSelectFolder={setActiveFolder}
              onNewFolder={newFolder}
              onNewSubfolder={(folder) => setEditor({ kind: 'folder', parentId: folder.id })}
              onEditFolder={(folder) => setEditor({ kind: 'folder', id: folder.id })}
              onDeleteFolder={askDeleteFolder}
              onNewCharacter={newCharacter}
              onEditCharacter={(character) => setEditor({ kind: 'character', id: character.id })}
              onDeleteCharacter={askDeleteCharacter}
              onDeleteCharacters={askDeleteCharacters}
              onExportCharacter={(character) =>
                void exportJSON(
                  createCharactersTransfer(data, { characterIds: [character.id] }),
                  tr('filenames.character', character.name),
                )
              }
              exporting={busy}
            />
          </>
        )}

        {view === 'settings' && (
          <section className="settings-page">
            <UpdateSettings state={updateState} flush={library.flush} />
            <ThemeSettings />
            <div className="settings-card compact">
              <h2>{tr('settings.language')}</h2>
              <label className="field">
                <select
                  aria-label={tr('settings.language')}
                  value={locale}
                  disabled={busy}
                  onChange={async (event) => {
                    const next = event.target.value;
                    if (!isLocale(next)) return;
                    setBusy(true);
                    try {
                      await library.flush();
                      await storage.setLanguage(next);
                      setLocale(next);
                      setToast('');
                      await library.load();
                    } catch (error) {
                      notify(String(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <option value="ru">{tr('language.russian')}</option>
                  <option value="en">{tr('language.english')}</option>
                </select>
              </label>
              <p className="field-hint">{tr('settings.languageHint')}</p>
            </div>
            <div className="settings-card">
              <div className="settings-card-heading">
                <ShieldCheck size={25} />
                <div>
                  <h2>{tr('settings.ownershipTitle')}</h2>
                  <p>{tr('settings.ownershipHint')}</p>
                </div>
              </div>
              <div className="stats-row">
                <div>
                  <strong>{data.characters.length}</strong>
                  <span>{tr('counts.characters')}</span>
                </div>
                <div>
                  <strong>{data.boards.length}</strong>
                  <span>{tr('counts.boards')}</span>
                </div>
                <div>
                  <strong>
                    {data.boards.reduce((sum, c) => sum + boardEdges(c, data.characters).length, 0)}
                  </strong>
                  <span>{tr('counts.relationships')}</span>
                </div>
              </div>
              <div className="data-path">
                <HardDrive size={16} />
                <code>{library.path}</code>
              </div>
              {window.desktop && (
                <button
                  className="button secondary"
                  onClick={() => void storage.showDataFolder().catch((e) => notify(String(e)))}
                >
                  <FolderOpen size={16} />
                  {tr('data.openFolder')}
                </button>
              )}
            </div>
            <div className="settings-card">
              <h2>{tr('transfer.title')}</h2>
              <p>{tr('transfer.description')}</p>
              <div className="transfer-actions">
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void exportJSON(createStoriesTransfer(data), tr('filenames.allStories'))
                  }
                >
                  <BookOpen size={16} />
                  {tr('transfer.allStories')}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() =>
                    void exportJSON(createCharactersTransfer(data), tr('filenames.allCharacters'))
                  }
                >
                  <Users size={16} />
                  {tr('transfer.allCharacters')}
                </button>

                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void importJSON()}
                >
                  <Upload size={16} />
                  {tr('transfer.import')}
                </button>
              </div>
              <p className="field-hint">{tr('transfer.mergeHint')}</p>
            </div>
            <div className="settings-card">
              <h2>{tr('backup.title')}</h2>
              <p>{tr('backup.description')}</p>
              <div className="button-row">
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await library.flush();
                      if (await storage.exportBackup(data)) notify(tr('notifications.backupSaved'));
                    } catch (error) {
                      notify(String(error));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <Download size={16} />
                  {tr('backup.save')}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void importBackup()}
                >
                  <Upload size={16} />
                  {tr('actions.import')}
                </button>
              </div>
              <p className="field-hint">{tr('backup.replaceHint')}</p>
            </div>
            <div className="settings-card compact">
              <h2>{tr('help.title')}</h2>
              <div className="help-steps">
                <p>
                  <b>1</b>
                  <span>{tr('help.relationshipStep')}</span>
                </p>
                <p>
                  <b>2</b>
                  <span>{tr('help.characterStep')}</span>
                </p>
                <p>
                  <b>3</b>
                  <span>{tr('help.boardStep')}</span>
                </p>
              </div>
              <p className="field-hint">{tr('help.shortcuts')}</p>
            </div>
          </section>
        )}

        <footer className="statusbar">
          {updateState.status === 'ready' && (
            <button className="button secondary" onClick={() => changeView('settings')}>
              {tr('updates.readyNotice', updateState.version)}
            </button>
          )}
          <span className={`save-status ${library.status === 'error' ? 'error' : ''}`}>
            {library.status === 'saving' ? (
              <LoadingIcon size={12} className="spin" />
            ) : (
              <Check size={12} />
            )}
            {library.status === 'saving'
              ? tr('save.saving')
              : library.status === 'error'
                ? tr('save.error')
                : tr('save.saved')}
          </span>
          <span>
            {view === 'boards' && board
              ? tr('counts.diagramSummary', connections.length, board.characterIds.length)
              : tr('app.footer')}
          </span>
        </footer>
      </main>

      {editor && (
        <Modal
          title={
            editor.kind === 'character'
              ? tr(editor.id ? 'characters.edit' : 'characters.new')
              : editor.kind === 'folder'
                ? tr(editor.id ? 'folders.edit' : 'folders.new')
                : editor.kind === 'board'
                  ? tr(editor.id ? 'boards.edit' : 'boards.new')
                  : editor.kind === 'participants'
                    ? tr('members.title')
                    : tr('connections.new')
          }
          subtitle={editor.kind === 'character' ? tr('characters.formHint') : undefined}
          onClose={closeEditor}
          wide={editor.kind === 'connection'}
        >
          {editor.kind === 'character' && (
            <CharacterForm
              character={data.characters.find((c) => c.id === editor.id)}
              onSave={saveCharacter}
              onClose={closeEditor}
              initialKind={editor.nodeKind}
              canAddToBoard={view === 'boards' && !!board}
              folders={data.folders}
              initialFolderId={
                libraryView && activeFolder && activeFolder !== ':unfiled' ? activeFolder : null
              }
            />
          )}
          {editor.kind === 'folder' && (
            <FolderForm
              folder={data.folders.find((folder) => folder.id === editor.id)}
              folders={data.folders}
              initialParentId={editor.parentId}
              initialKind={activeKind}
              onSave={saveFolder}
              onClose={closeEditor}
            />
          )}
          {editor.kind === 'board' && (
            <BoardForm
              board={data.boards.find((c) => c.id === editor.id)}
              onSave={saveBoard}
              onClose={closeEditor}
            />
          )}
          {editor.kind === 'connection' && board && (
            <BranchForm
              board={board}
              nodes={data.characters}
              childId={editor.targetId || editor.sourceId}
              parentId={editor.targetId ? editor.sourceId : undefined}
              onClose={closeEditor}
              onSave={(next) => {
                updateBoard(() => next);
                closeEditor();
                notify(tr('notifications.connectionSaved'));
              }}
            />
          )}
          {editor.kind === 'participants' && board && (
            <ParticipantsForm
              board={board}
              characters={data.characters}
              folders={data.folders}
              onClose={closeEditor}
              onNewCharacter={newCharacter}
              onSave={(ids) => {
                updateBoard((c) => retainMembers(c, ids));
                closeEditor();
                clearSelection();
              }}
            />
          )}
        </Modal>
      )}

      {confirmation && (
        <Modal title={confirmation.title} onClose={() => setConfirmation(null)}>
          <p className="confirm-text">{confirmation.text}</p>
          <div className="modal-footer">
            <button className="button secondary" onClick={() => setConfirmation(null)}>
              {tr('actions.cancel')}
            </button>
            <button
              className="button danger"
              onClick={() => {
                confirmation.action();
                setConfirmation(null);
              }}
            >
              {tr('actions.delete')}
            </button>
          </div>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label={tr('notifications.dismissLabel')}
            onClick={() => setToast('')}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
