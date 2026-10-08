import { useState } from 'react';
import { BookOpen, Link2, LockKeyhole, LockKeyholeOpen, Pencil, Plus, X } from 'lucide-react';
import { type Message, tr } from '../shared/i18n';
import type { Character, Club } from '../shared/model';
import {
  boardEdges,
  BRANCH_COLORS,
  branchLabel,
  branchOf,
  CULPRIT,
  kindOf,
  questionKeys,
} from '../shared/investigation';
import { Avatar } from './components';
import { sortByName } from './sorting';

export function BoardInspector({
  board,
  nodes,
  selected,
  onSelect,
  onEdit,
  onConnect,
  onMembers,
  onNew,
  onLock,
  onRemove,
}: {
  board?: Club;
  nodes: Character[];
  selected?: string;
  onSelect: (id?: string) => void;
  onEdit: (id: string) => void;
  onConnect: () => void;
  onMembers: () => void;
  onNew: () => void;
  onLock: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [tab, setTab] = useState<'members' | 'connections' | 'story'>('members');
  const node = nodes.find((n) => n.id === selected && board?.characterIds.includes(n.id));
  const edges = board ? boardEdges(board, nodes) : [];
  const name = (id: string) =>
    id === CULPRIT ? tr('trace.culprit') : nodes.find((n) => n.id === id)?.name;
  return (
    <aside className="inspector">
      {selected === CULPRIT ? (
        <>
          <div className="inspector-title">
            <span>{tr('trace.culprit')}</span>
            <button
              className="icon-button"
              aria-label={tr('actions.clearSelection')}
              onClick={() => onSelect()}
            >
              <X size={17} />
            </button>
          </div>
          <div className="character-detail">
            <div className="culprit-avatar">?</div>
            <h2>{tr('trace.culprit')}</h2>
            <span className="pill">
              <LockKeyhole size={12} /> {tr('trace.fixed')}
            </span>
            <p className="detail-notes">{tr('trace.culpritHint')}</p>
          </div>
        </>
      ) : node && board ? (
        <>
          <div className="inspector-title">
            <span>{tr('trace.nodeDetails')}</span>
            <button
              className="icon-button"
              aria-label={tr('actions.clearSelection')}
              onClick={() => onSelect()}
            >
              <X size={17} />
            </button>
          </div>
          <div className="character-detail">
            <Avatar character={node} size={76} />
            <h2>{node.name}</h2>
            <div className="role-badges">
              {kindOf(node) === 'person' ? (
                <>
                  {node.suspect !== false && (
                    <span className="pill" style={{ color: BRANCH_COLORS.suspect }}>
                      {tr('trace.suspect')}
                    </span>
                  )}
                  {node.witness && (
                    <span className="pill" style={{ color: BRANCH_COLORS.witness }}>
                      {tr('trace.witness')}
                    </span>
                  )}
                </>
              ) : (
                <span className="pill" style={{ color: BRANCH_COLORS[branchOf(node)] }}>
                  {branchLabel(branchOf(node))}
                </span>
              )}
            </div>
            <p className="detail-notes">{node.notes || tr('characters.emptyNotes')}</p>
            <div className="button-row">
              <button className="button secondary" onClick={() => onEdit(node.id)}>
                <Pencil size={14} />
                {tr('actions.edit')}
              </button>
              <button className="button primary" onClick={onConnect}>
                <Link2 size={14} />
                {tr('actions.connect')}
              </button>
            </div>
            <button
              className={`button secondary full-width node-lock ${board.layout?.[node.id]?.locked ? 'active' : ''}`}
              onClick={() => onLock(node.id)}
              aria-pressed={!!board.layout?.[node.id]?.locked}
            >
              {board.layout?.[node.id]?.locked ? (
                <LockKeyhole size={15} />
              ) : (
                <LockKeyholeOpen size={15} />
              )}
              {tr(board.layout?.[node.id]?.locked ? 'trace.unlock' : 'trace.lock')}
            </button>
          </div>
          <div className="node-answers">
            {questionKeys[kindOf(node)].map((key) => (
              <div key={key}>
                <h3>{tr(`trace.question.${key}` as Message)}</h3>
                <p>{node.answers?.[key] || tr('trace.unanswered')}</p>
              </div>
            ))}
          </div>
          <div className="section-heading">
            <span>{tr('characters.connectionsHeading')}</span>
            <span className="count">
              {edges.filter((e) => e.sourceId === node.id || e.targetId === node.id).length}
            </span>
          </div>
          <div className="inspector-list">
            {edges
              .filter((e) => e.sourceId === node.id || e.targetId === node.id)
              .map((e) => (
                <button
                  className="connection-row"
                  key={e.id}
                  onClick={() => onSelect(e.sourceId === node.id ? e.targetId : e.sourceId)}
                >
                  <i
                    style={{ background: BRANCH_COLORS[e.typeId as keyof typeof BRANCH_COLORS] }}
                  />
                  <span>
                    <strong>{name(e.sourceId)}</strong>
                    <small>→ {name(e.targetId)}</small>
                  </span>
                </button>
              ))}
          </div>
          <div className="inspector-footer">
            <button className="text-button danger-text" onClick={() => onRemove(node.id)}>
              <X size={14} />
              {tr('members.remove')}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="inspector-tabs">
            <button className={tab === 'story' ? 'active' : ''} onClick={() => setTab('story')}>
              {tr('trace.story')}
            </button>
            <button className={tab === 'members' ? 'active' : ''} onClick={() => setTab('members')}>
              {tr('inspector.members')}
              <span className="count">{board?.characterIds.length || 0}</span>
            </button>
            <button
              className={tab === 'connections' ? 'active' : ''}
              onClick={() => setTab('connections')}
            >
              {tr('inspector.connections')}
              <span className="count">{edges.length}</span>
            </button>
          </div>
          <div className="inspector-content">
            {tab === 'story' ? (
              <div className="board-story">
                <h2>{board?.name || tr('navigation.clubs')}</h2>
                {(board?.description || tr('trace.storyEmpty'))
                  .split('\n')
                  .map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
              </div>
            ) : (
              <>
                <div className="inspector-caption">
                  <span>
                    {tr(tab === 'members' ? 'members.heading' : 'connections.inspectorHeading')}
                  </span>
                  <button
                    className="icon-button"
                    disabled={!board}
                    aria-label={tr('members.add')}
                    onClick={onMembers}
                  >
                    <Plus size={17} />
                  </button>
                </div>
                <div className="inspector-list">
                  {tab === 'members'
                    ? sortByName(nodes.filter((n) => board?.characterIds.includes(n.id))).map(
                        (n) => (
                          <div className="member-row" key={n.id}>
                            <button className="member-main" onClick={() => onSelect(n.id)}>
                              <Avatar character={n} />
                              <span>
                                <strong>{n.name}</strong>
                                <small style={{ color: BRANCH_COLORS[branchOf(n)] }}>
                                  {branchLabel(branchOf(n))}
                                </small>
                              </span>
                              {board?.layout?.[n.id]?.locked && <LockKeyhole size={13} />}
                            </button>
                          </div>
                        ),
                      )
                    : edges.map((e) => (
                        <button
                          className="connection-row"
                          key={e.id}
                          onClick={() => onSelect(e.targetId)}
                        >
                          <i
                            style={{
                              background: BRANCH_COLORS[e.typeId as keyof typeof BRANCH_COLORS],
                            }}
                          />
                          <span>
                            <strong>{name(e.targetId)}</strong>
                            <small>
                              {name(e.sourceId)} → {name(e.targetId)}
                            </small>
                          </span>
                        </button>
                      ))}
                </div>
              </>
            )}
            {board && (
              <>
                <button className="button dashed full-width" onClick={onMembers}>
                  <Plus size={16} />
                  {tr('members.fromLibrary')}
                </button>
                <button className="text-button" onClick={onNew}>
                  <Plus size={14} />
                  {tr('trace.newNode')}
                </button>
              </>
            )}
          </div>
          <div className="inspector-tip">
            <BookOpen size={19} />
            <p>
              {tr('trace.treeTitle')}
              <span>{tr('trace.treeHint')}</span>
            </p>
          </div>
        </>
      )}
    </aside>
  );
}
