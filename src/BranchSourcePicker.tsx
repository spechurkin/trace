import { useState } from 'react';
import { Search } from 'lucide-react';
import { getLocale, tr } from '../shared/i18n';
import type { Character } from '../shared/model';
import { CULPRIT } from '../shared/investigation';
import { Avatar, EmptyHint } from './components';

// Copied from Clubs' ParticipantsForm (src/forms.tsx), then adapted to select
// incoming graph sources rather than change the board's participant list.
export function BranchSourcePicker({
                                     nodes,
                                     selected,
                                     onChange,
                                   }: {
  nodes: Character[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
}) {
  const [search, setSearch] = useState('');
  const characters = [
    { id: CULPRIT, name: tr('trace.culprit'), color: '#173EA5', notes: '', folderId: null },
    ...nodes,
  ];
  const filtered = characters.filter((c) =>
    c.name.toLocaleLowerCase(getLocale()).includes(search.toLocaleLowerCase(getLocale())),
  );
  return (
    <>
      <div className="search-input">
        <Search size={16} />
        <input
          aria-label={tr('members.searchLabel')}
          placeholder={tr('members.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div className="participant-picker branch-source-list">
        {filtered.map((character) => (
          <label
            key={character.id}
            className={`picker-row ${selected.has(character.id) ? 'selected' : ''}`}
          >
            <input
              type="checkbox"
              aria-label={character.name}
              checked={selected.has(character.id)}
              onChange={(e) => {
                const next = new Set(selected);
                if (e.target.checked) {
                  next.add(character.id);
                  if (character.id !== CULPRIT) next.delete(CULPRIT);
                } else next.delete(character.id);
                onChange(next);
              }}
            />
            {character.id === CULPRIT ? (
              <span className="avatar">?</span>
            ) : (
              <Avatar character={character} />
            )}
            <span>
              <strong>{character.name}</strong>
              <small>{character.notes || tr('members.libraryCharacter')}</small>
            </span>
          </label>
        ))}
        {!filtered.length && <EmptyHint>{tr('members.noSearchResults')}</EmptyHint>}
      </div>
    </>
  );
}
