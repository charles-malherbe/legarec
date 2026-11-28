import { findCompany, type CompanyRecord } from '@legarec/platform';
import { useState } from 'react';
import { Bouton } from './Bouton';
import css from './FicheSirene.module.css';

export interface FicheSireneProps {
  /** SIREN or SIRET as typed. */
  number: string;
  /** Takes what the register says; the fields stay editable. */
  onUse: (record: CompanyRecord) => void;
}

/**
 * The register entry of the company typed, read from the Sirene register (API Recherche d'entreprises) on a click only:
 * the number of a sole trader names a person, it leaves for the register when someone asks. What the register says is
 * then offered, never written by itself (DECISIONS.md, 28/11/2026).
 */
export function FicheSirene({ number, onUse }: FicheSireneProps) {
  const typed = number.replace(/\s/gu, '');
  const valid = /^(\d{9}|\d{14})$/u.test(typed);
  const [found, setFound] = useState<{ number: string; record: CompanyRecord | null } | null>(null);
  const [asking, setAsking] = useState(false);
  const ask = async () => {
    setAsking(true);
    const record = await findCompany(typed);
    setFound({ number: typed, record });
    setAsking(false);
  };
  const record = found?.number === typed ? found.record : null;
  if (!valid) return <p role="status" className={css.hidden} />;
  if (found?.number !== typed)
    return (
      <div role="status" className={css.root}>
        <span className={css.text}>Le répertoire Sirene de l’Insee peut remplir la raison sociale, la forme juridique et le siège.</span>
        <Bouton variant="secondary" size="sm" label="Chercher dans le répertoire Sirene" loading={asking} onPress={() => void ask()} />
      </div>
    );
  if (!record)
    return (
      <p role="status" className={css.root}>
        Aucune entreprise trouvée pour ce numéro dans le répertoire Sirene : vérifiez-le, ou saisissez la fiche à la main.
      </p>
    );
  return (
    <div role="status" className={css.root} data-ceased={!record.active || undefined}>
      <span className={css.text}>
        <span className={css.strong}>{record.name}</span>
        <span>
          {record.line}, {record.postalCode} {record.city} · TVA {record.vatNumber}
        </span>
        {!record.active && <span className={css.warning}>Entreprise cessée selon le répertoire Sirene.</span>}
      </span>
      <Bouton
        variant="secondary"
        size="sm"
        label="Reprendre ces informations"
        ariaLabel={`Reprendre les informations de ${record.name}`}
        onPress={() => onUse(record)}
      />
    </div>
  );
}
