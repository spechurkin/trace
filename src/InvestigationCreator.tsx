import { useMemo } from 'react';
import { InvestigationAssistant } from '../modules/investigation-creator/Assistant';
import { messages } from '../modules/investigation-creator/messages';
import type { InvestigationPlan } from '../modules/investigation-creator/schema';
import type { Board, Character, CharacterFolder } from '../shared/model';
import type { Locale } from '../shared/i18n';
import { folderEntries, folderKindOf, folderSubtree } from '../shared/folders';
import { nodesFromFolders } from './creator-sources';
import { creatorFootprints, creatorPlacements } from './creator-diagram';
import type { InvestigationDiagram } from '../modules/investigation-creator/contracts';
import { CENTER } from './geometry';
import { CharacterForm } from './forms';

// Host-only adapter: module UI never imports application forms or persistence.
export function InvestigationCreator({
                                       board,
                                       nodes,
                                       folders,
                                       locale,
                                       audit,
                                       onSave,
                                       onClose,
                                       onFoldersChange,
                                     }: {
  board: Board;
  nodes: Character[];
  folders: CharacterFolder[];
  locale: Locale;
  audit: boolean;
  onSave: (
    plan: InvestigationPlan,
    nodes: Character[],
    close: boolean,
    diagram?: InvestigationDiagram,
  ) => void;
  onClose: () => void;
  onFoldersChange: (ids: string[]) => void;
}) {
  const t = messages(locale);
  const selected = board.creatorFolderIds || [];
  const sourceNodes = useMemo(
    () => nodesFromFolders(nodes, folders, board.creatorFolderIds || []),
    [nodes, folders, board.creatorFolderIds],
  );
  return (
    <section className="investigation-creator-mode" aria-label={t(audit ? 'auditTitle' : 'title')}>
      <div className="creator-mode-heading">
        <h2>{t(audit ? 'auditTitle' : 'title')}</h2>
        <p>{board.name}</p>
      </div>
      <div className="investigation-assistant">
        <section className="ic-section" aria-label={t('sourceFolders')}>
          <h3>{t('sourceFolders')}</h3>
          <p className="ic-guidance">{t('sourceFoldersHint')}</p>
          <div className="ic-fields">
            {(['person', 'evidence', 'location', 'event'] as const).map((kind) => (
              <fieldset className="ic-field ic-choices" key={kind}>
                <legend>{t(kind === 'evidence' ? 'evidenceNode' : kind)}</legend>
                {folderEntries(folders.filter((folder) => folderKindOf(folder) === kind)).map(
                  ({ folder, path }) => {
                    const subtree = folderSubtree(folders, folder.id);
                    const count = nodes.filter(
                      (node) => node.folderId && subtree.has(node.folderId),
                    ).length;
                    return (
                      <label key={folder.id}>
                        <input
                          type="checkbox"
                          checked={selected.includes(folder.id)}
                          onChange={(event) =>
                            onFoldersChange(
                              event.target.checked
                                ? [...selected, folder.id]
                                : selected.filter((id) => id !== folder.id),
                            )
                          }
                        />
                        {path} ({count})
                      </label>
                    );
                  },
                )}
                {!folders.some((folder) => folderKindOf(folder) === kind) && (
                  <small>{t('none')}</small>
                )}
              </fieldset>
            ))}
          </div>
        </section>
      </div>
      <InvestigationAssistant
        board={{
          ...board,
          diagram: creatorPlacements(board),
          diagramFootprints: creatorFootprints,
          diagramBounds: {
            minX: -10000 - CENTER.x,
            maxX: 10000 - CENTER.x,
            minY: -10000 - CENTER.y,
            maxY: 10000 - CENTER.y,
          },
        }}
        nodes={nodes}
        sourceNodes={sourceNodes}
        locale={locale}
        initialStep={audit ? 'completeness' : 'crime'}
        mode={audit ? 'audit' : 'create'}
        onSave={onSave}
        onClose={onClose}
        renderNodeEditor={(node, kind, save, cancel) => (
          <CharacterForm
            character={node}
            initialKind={kind}
            folders={folders}
            canAddToBoard={false}
            onClose={cancel}
            onSave={(character) => save(character)}
          />
        )}
      />
    </section>
  );
}
