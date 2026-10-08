import { InvestigationAssistant } from '../modules/investigation-creator/Assistant';
import { messages } from '../modules/investigation-creator/messages';
import type { InvestigationPlan } from '../modules/investigation-creator/schema';
import type { Character, CharacterFolder, Club } from '../shared/model';
import type { Locale } from '../shared/i18n';
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
                                     }: {
  board: Club;
  nodes: Character[];
  folders: CharacterFolder[];
  locale: Locale;
  audit: boolean;
  onSave: (plan: InvestigationPlan, nodes: Character[], close: boolean) => void;
  onClose: () => void;
}) {
  const t = messages(locale);
  return (
    <section className="investigation-creator-mode" aria-label={t(audit ? 'auditTitle' : 'title')}>
      <div className="creator-mode-heading">
        <h2>{t(audit ? 'auditTitle' : 'title')}</h2>
        <p>{board.name}</p>
      </div>
      <InvestigationAssistant
        board={board}
        nodes={nodes}
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
            canAddToClub={false}
            onClose={cancel}
            onSave={(character) => save(character)}
          />
        )}
      />
    </section>
  );
}
