import { useState } from 'react';
import { tr } from '../shared/i18n';
import type { Board, Character } from '../shared/model';
import { canParent, CULPRIT, parentsOf, setParents } from '../shared/investigation';
import { Field } from './components';
import { sortByName } from './sorting';
import { BranchSourcePicker } from './BranchSourcePicker';

export function BranchForm({
  board,
  nodes,
  childId,
  parentId,
  onSave,
  onClose,
}: {
  board: Board;
  nodes: Character[];
  childId?: string;
  parentId?: string;
  onSave: (board: Board) => void;
  onClose: () => void;
}) {
  const [child, setChild] = useState(
    childId && board.characterIds.includes(childId) ? childId : board.characterIds[0] || '',
  );
  const [parents, setParentChoices] = useState(() => {
    const current = parentsOf(board, child);
    return parentId && !current.includes(parentId)
      ? [...current.filter((id) => id !== CULPRIT), parentId]
      : current;
  });
  const [error, setError] = useState('');
  const members = sortByName(nodes.filter((n) => board.characterIds.includes(n.id)));
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        try {
          onSave(setParents(board, child, parents.length ? parents : [CULPRIT]));
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
            setParentChoices(parentsOf(board, e.target.value));
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
      <fieldset className="branch-sources">
        <legend className="field-label">{tr('trace.parent')}</legend>
        <p className="field-hint">{tr('trace.branchHint')}</p>
        <BranchSourcePicker
          key={child}
          nodes={members.filter((node) => canParent(board, child, node.id))}
          selected={new Set(parents)}
          onChange={(selected) => {
            setParentChoices([...selected]);
            setError('');
          }}
        />
      </fieldset>
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
          disabled={!child || !parents.every((parent) => canParent(board, child, parent))}
        >
          {tr('actions.connect')}
        </button>
      </div>
    </form>
  );
}
