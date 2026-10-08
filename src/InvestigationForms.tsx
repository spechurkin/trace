import { useState } from 'react';
import { tr } from '../shared/i18n';
import type { Character, Club } from '../shared/model';
import { canParent, CULPRIT, parentOf, setParent } from '../shared/investigation';
import { Field } from './components';
import { sortByName } from './sorting';

export function BranchForm({
  board,
  nodes,
  childId,
  parentId,
  onSave,
  onClose,
}: {
  board: Club;
  nodes: Character[];
  childId?: string;
  parentId?: string;
  onSave: (board: Club) => void;
  onClose: () => void;
}) {
  const [child, setChild] = useState(
    childId && board.characterIds.includes(childId) ? childId : board.characterIds[0] || '',
  );
  const [parent, setParentChoice] = useState(parentId || parentOf(board, child));
  const [error, setError] = useState('');
  const members = sortByName(nodes.filter((n) => board.characterIds.includes(n.id)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(setParent(board, child, parent));
        } catch (e) {
          setError(String(e));
        }
      }}
    >
      <Field label={tr('trace.child')}>
        <select
          value={child}
          onChange={(e) => {
            setChild(e.target.value);
            setParentChoice(parentOf(board, e.target.value));
            setError('');
          }}
        >
          {members.map((n) => (
            <option key={n.id} value={n.id}>
              {n.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('trace.parent')} hint={tr('trace.branchHint')}>
        <select value={parent} onChange={(e) => setParentChoice(e.target.value)}>
          <option value={CULPRIT}>{tr('trace.culprit')}</option>
          {members
            .filter((n) => canParent(board, child, n.id))
            .map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
        </select>
      </Field>
      <p className="field-hint">{tr('trace.treeHint')}</p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="modal-footer">
        <button type="button" className="button secondary" onClick={onClose}>
          {tr('actions.cancel')}
        </button>
        <button
          type="submit"
          className="button primary"
          disabled={!child || !canParent(board, child, parent)}
        >
          {tr('actions.connect')}
        </button>
      </div>
    </form>
  );
}
