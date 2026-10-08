import { getLocale, type Message, tr } from '../shared/i18n';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ImagePlus, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { type Character, type CharacterFolder, type Club, type Portrait } from '../shared/model';
import { Avatar, EmptyHint, Field } from './components';
import { defaultPortraitTransform, readPortrait } from './portrait';
import { PortraitEditor } from './PortraitEditor';
import { folderEntries, folderKindOf, folderSubtree } from '../shared/folders';
import { sortByName } from './sorting';
import {
  BRANCH_COLORS,
  kindOf,
  type NodeKind,
  nodeLabel,
  questionKeys,
} from '../shared/investigation';

type Actions = { onClose: () => void };

function FormError({ error }: { error: string }) {
  return error ? (
    <p className="form-error" role="alert">
      {error}
    </p>
  ) : null;
}

function Footer({
  onClose,
  label = tr('actions.save'),
  disabled,
}: Actions & { label?: string; disabled?: boolean }) {
  return (
    <div className="modal-footer">
      <button type="button" className="button secondary" onClick={onClose}>
        {tr('actions.cancel')}
      </button>
      <button className="button primary" disabled={disabled} type="submit">
        {label}
      </button>
    </div>
  );
}

export function CharacterForm({
  character,
  onSave,
  onClose,
  canAddToClub,
  folders,
  initialFolderId = null,
  initialKind = 'person',
}: Actions & {
  character?: Character;
  onSave: (character: Character, add: boolean) => void;
  canAddToClub: boolean;
  folders: CharacterFolder[];
  initialFolderId?: string | null;
  initialKind?: NodeKind;
}) {
  const [kind, setKind] = useState<NodeKind>(character ? kindOf(character) : initialKind);
  const [witness, setWitness] = useState(character?.witness || false);
  const [suspect, setSuspect] = useState(character?.suspect !== false);
  const [answers, setAnswers] = useState(character?.answers || {});
  const [name, setName] = useState(character?.name || '');
  const color = BRANCH_COLORS[kind === 'person' ? (suspect ? 'suspect' : 'witness') : kind];
  const [image, setImage] = useState(character?.image);
  const [portrait, setPortrait] = useState(character?.portrait);
  const [editingPortrait, setEditingPortrait] = useState<Portrait | null>(null);
  const [notes, setNotes] = useState(character?.notes || '');
  const [folderId, setFolderId] = useState<string | null>(
    character
      ? character.folderId
      : folders.some(
            (folder) => folder.id === initialFolderId && folderKindOf(folder) === initialKind,
          )
        ? initialFolderId
        : null,
  );
  const [add, setAdd] = useState(canAddToClub && !character);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const wasEditingPortrait = useRef(false);
  useEffect(() => {
    if (wasEditingPortrait.current && !editingPortrait)
      (
        form.current?.querySelector<HTMLElement>('[data-edit-portrait]') ||
        form.current?.querySelector<HTMLElement>('input[type="file"]')
      )?.focus();
    wasEditingPortrait.current = !!editingPortrait;
  }, [editingPortrait]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (reading) return;
    if (kind === 'person' && !witness && !suspect) {
      setError(tr('trace.rolesRequired'));
      return;
    }
    if (!name.trim()) {
      setError(tr('validation.characterNameRequired'));
      return;
    }
    onSave(
      {
        id: character?.id || crypto.randomUUID(),
        name: name.trim(),
        color: BRANCH_COLORS[kind === 'person' ? (suspect ? 'suspect' : 'witness') : kind],
        kind,
        witness,
        suspect,
        answers,
        image,
        portrait,
        notes: notes.trim(),
        folderId,
      },
      add,
    );
  };
  if (editingPortrait)
    return (
      <PortraitEditor
        portrait={editingPortrait}
        onCancel={() => setEditingPortrait(null)}
        onApply={(image, portrait) => {
          setImage(image);
          setPortrait(portrait);
          setEditingPortrait(null);
          setError('');
        }}
      />
    );
  return (
    <form ref={form} onSubmit={submit}>
      <Field label={tr('trace.kind')}>
        <select
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as NodeKind);
            setFolderId(null);
          }}
        >
          {(['person', 'evidence', 'location', 'event'] as NodeKind[]).map((k) => (
            <option key={k} value={k}>
              {nodeLabel(k)}
            </option>
          ))}
        </select>
      </Field>
      {kind === 'person' && (
        <div className="field">
          <span className="field-label">{tr('trace.roles')}</span>
          <div className="role-switches">
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={witness}
                onChange={(e) => setWitness(e.target.checked)}
              />
              {tr('trace.witness')}
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={suspect}
                onChange={(e) => setSuspect(e.target.checked)}
              />
              {tr('trace.suspect')}
            </label>
          </div>
          <p className="field-hint">{tr('trace.rolesHint')}</p>
        </div>
      )}
      <div className="portrait-editor">
        <Avatar character={{ name: name || '?', color, image }} size={84} />
        <div>
          <label className="button secondary upload-button">
            <ImagePlus size={16} />
            {image ? tr('portrait.replace') : tr('portrait.upload')}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={tr('portrait.upload')}
              disabled={reading}
              onChange={async (e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                setReading(true);
                setError('');
                try {
                  setEditingPortrait({
                    source: await readPortrait(file),
                    ...defaultPortraitTransform(),
                  });
                } catch (error) {
                  setError(error instanceof Error ? error.message : tr('errors.image'));
                } finally {
                  setReading(false);
                  input.value = '';
                }
              }}
            />
          </label>
          {image ? (
            <div className="portrait-actions">
              <button
                type="button"
                className="text-button"
                data-edit-portrait=""
                disabled={reading}
                onClick={() =>
                  setEditingPortrait(portrait || { source: image, ...defaultPortraitTransform() })
                }
              >
                <Pencil size={13} />
                {tr('portrait.edit')}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={reading}
                onClick={() => {
                  setImage(undefined);
                  setPortrait(undefined);
                }}
              >
                <X size={13} />
                {tr('portrait.remove')}
              </button>
            </div>
          ) : (
            <p className="muted tiny">{tr('portrait.fileHint')}</p>
          )}
        </div>
      </div>
      <Field label={tr('characters.nameLabel')}>
        <input
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr('characters.namePlaceholder')}
          required
        />
      </Field>
      <Field label={tr('characters.folderLabel')}>
        <select
          aria-label={tr('characters.folderLabel')}
          value={folderId || ''}
          onChange={(e) => setFolderId(e.target.value || null)}
        >
          <option value="">{tr('folders.unfiled')}</option>
          {folderEntries(folders.filter((folder) => folderKindOf(folder) === kind)).map(
            ({ folder, path }) => (
              <option key={folder.id} value={folder.id}>
                {path}
              </option>
            ),
          )}
        </select>
      </Field>
      <div className="question-heading">
        <strong>{tr('trace.questions')}</strong>
        <p className="field-hint">{tr('trace.questionsHint')}</p>
      </div>
      {questionKeys[kind].map((key) => (
        <Field key={key} label={tr(`trace.question.${key}` as Message)}>
          <textarea
            maxLength={2000}
            rows={2}
            value={answers[key] || ''}
            onChange={(e) => setAnswers({ ...answers, [key]: e.target.value })}
          />
        </Field>
      ))}
      <Field label={tr('forms.notesLabel')} hint={tr('characters.notesHint')}>
        <textarea
          maxLength={2000}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={tr('characters.notesPlaceholder')}
          rows={3}
        />
      </Field>
      {!character && canAddToClub && (
        <label className="checkbox-row">
          <input type="checkbox" checked={add} onChange={(e) => setAdd(e.target.checked)} />
          <span>{tr('characters.addImmediately')}</span>
        </label>
      )}
      <FormError error={error} />
      <Footer
        onClose={onClose}
        disabled={reading}
        label={character ? tr('actions.saveChanges') : tr('characters.create')}
      />
    </form>
  );
}

export function FolderForm({
  folder,
  folders,
  initialParentId = null,
  initialKind = 'person',
  onSave,
  onClose,
}: Actions & {
  folder?: CharacterFolder;
  folders: CharacterFolder[];
  initialParentId?: string | null;
  initialKind?: NodeKind;
  onSave: (folder: CharacterFolder) => void;
}) {
  const kind = folder ? folderKindOf(folder) : initialKind;
  const categoryFolders = folders.filter((item) => folderKindOf(item) === kind);
  const [name, setName] = useState(folder?.name || '');
  const [parentId, setParentId] = useState<string | null>(
    folder ? folder.parentId : initialParentId,
  );
  const excluded = folder ? folderSubtree(folders, folder.id) : new Set<string>();
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const trimmed = name.trim();
        if (!trimmed) {
          setError(tr('validation.folderNameRequired'));
          return;
        }
        if (
          folders.some(
            (item) =>
              item.id !== folder?.id &&
              folderKindOf(item) === kind &&
              item.parentId === parentId &&
              item.name.toLocaleLowerCase('ru') === trimmed.toLocaleLowerCase('ru'),
          )
        ) {
          setError(tr('validation.folderNameExists'));
          return;
        }
        if (!folder && folders.length >= 500) {
          setError(tr('validation.folderLimit'));
          return;
        }
        if (
          parentId !== null &&
          (excluded.has(parentId) || !categoryFolders.some((item) => item.id === parentId))
        ) {
          setError(tr('validation.folderParentInvalid'));
          return;
        }
        onSave({ id: folder?.id || crypto.randomUUID(), name: trimmed, parentId, kind });
      }}
    >
      <Field label={tr('folders.nameLabel')}>
        <input
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={tr('folders.namePlaceholder')}
          required
        />
      </Field>
      <Field label={tr('folders.parentLabel')}>
        <select
          aria-label={tr('folders.parentLabel')}
          value={parentId || ''}
          onChange={(event) => setParentId(event.target.value || null)}
        >
          <option value="">{tr('folders.libraryRoot')}</option>
          {folderEntries(categoryFolders)
            .filter(({ folder }) => !excluded.has(folder.id))
            .map(({ folder, path }) => (
              <option key={folder.id} value={folder.id}>
                {path}
              </option>
            ))}
        </select>
      </Field>
      <p className="field-hint">{tr('folders.reparentHint')}</p>
      <FormError error={error} />
      <Footer onClose={onClose} label={folder ? tr('actions.saveChanges') : tr('folders.create')} />
    </form>
  );
}

export function ClubForm({
  club,
  onSave,
  onClose,
}: Actions & { club?: Club; onSave: (club: Club) => void }) {
  const [name, setName] = useState(club?.name || '');
  const [description, setDescription] = useState(club?.description || '');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim())
          onSave({
            id: club?.id || crypto.randomUUID(),
            name: name.trim(),
            description: description.trim(),
            characterIds: club?.characterIds || [],
            connections: club?.connections || [],
            layout: club?.layout || {},
          });
      }}
    >
      <Field label={tr('clubs.nameLabel')}>
        <input
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={tr('clubs.namePlaceholder')}
          required
        />
      </Field>
      <Field label={tr('forms.descriptionLabel')} hint={tr('clubs.descriptionHint')}>
        <textarea
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder={tr('clubs.descriptionPlaceholder')}
          rows={3}
        />
      </Field>
      <Footer onClose={onClose} label={club ? tr('actions.saveChanges') : tr('clubs.create')} />
    </form>
  );
}

export function ParticipantsForm({
  club,
  characters,
  folders,
  onSave,
  onClose,
  onNewCharacter,
}: Actions & {
  club: Club;
  characters: Character[];
  folders: CharacterFolder[];
  onSave: (ids: string[]) => void;
  onNewCharacter: () => void;
}) {
  const [selected, setSelected] = useState(new Set(club.characterIds));
  const [search, setSearch] = useState('');
  const [folderFilter, setFolderFilter] = useState('');
  const subtree =
    folderFilter && folderFilter !== ':unfiled'
      ? folderSubtree(folders, folderFilter)
      : new Set<string>();
  const filtered = sortByName(
    characters.filter(
      (c) =>
        c.name.toLocaleLowerCase(getLocale()).includes(search.toLocaleLowerCase(getLocale())) &&
        (!folderFilter ||
          (folderFilter === ':unfiled'
            ? c.folderId === null
            : c.folderId !== null && subtree.has(c.folderId))),
    ),
  );
  const groups = [
    ...folderEntries(folders).map(({ folder, path }) => ({ ...folder, name: path })),
    { id: ':unfiled', name: tr('folders.unfiled') },
  ]
    .map((folder) => ({
      ...folder,
      characters: filtered.filter(
        (character) => character.folderId === (folder.id === ':unfiled' ? null : folder.id),
      ),
    }))
    .filter((group) => group.characters.length > 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSave([
          ...club.characterIds.filter((id) => selected.has(id)),
          ...characters
            .filter((c) => selected.has(c.id) && !club.characterIds.includes(c.id))
            .map((c) => c.id),
        ]);
      }}
    >
      <div className="search-input">
        <Search size={16} />
        <input
          aria-label={tr('members.searchLabel')}
          placeholder={tr('members.searchPlaceholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <div style={{ marginTop: 16 }}>
        <Field label={tr('members.folderLabel')}>
          <select
            aria-label={tr('members.folderLabel')}
            value={folderFilter}
            onChange={(event) => setFolderFilter(event.target.value)}
          >
            <option value="">{tr('folders.all')}</option>
            <option value=":unfiled">{tr('folders.unfiled')}</option>
            {folderEntries(folders).map(({ folder, path }) => (
              <option key={folder.id} value={folder.id}>
                {path}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div className="participant-picker">
        {groups.map((group) => (
          <div className="picker-group" key={group.id}>
            <h3>
              {group.name}
              <span>{group.characters.length}</span>
            </h3>
            {group.characters.map((character) => (
              <label
                key={character.id}
                className={`picker-row ${selected.has(character.id) ? 'selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={selected.has(character.id)}
                  onChange={(e) =>
                    setSelected((previous) => {
                      const next = new Set(previous);
                      if (e.target.checked) next.add(character.id);
                      else next.delete(character.id);
                      return next;
                    })
                  }
                />
                <Avatar character={character} />
                <span>
                  <strong>{character.name}</strong>
                  <small>{character.notes || tr('members.libraryCharacter')}</small>
                </span>
              </label>
            ))}
          </div>
        ))}
        {!filtered.length && (
          <EmptyHint>
            {characters.length
              ? tr('members.noSearchResults')
              : tr('characters.noLibraryCharacters')}
          </EmptyHint>
        )}
      </div>
      <button className="text-button" type="button" onClick={onNewCharacter}>
        <Plus size={16} />
        {tr('characters.createNew')}
      </button>
      {club.characterIds.some((id) => !selected.has(id)) && (
        <p className="field-hint">
          <Trash2 size={12} />
          {tr('members.removalHint')}
        </p>
      )}
      <Footer
        onClose={onClose}
        label={tr('members.applySelection', selected.size)}
        disabled={selected.size > 500}
      />
    </form>
  );
}
