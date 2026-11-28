import { communesOf, suggestAddresses, type AddressHit } from '@legarec/platform';
import { useDebouncedValue } from '@mantine/hooks';
import { useEffect, useRef, useState } from 'react';
import { Champ } from './Champ';

export interface Adresse {
  address: string;
  postalCode: string;
  city: string;
}
export interface ChampAdresseProps {
  value: Adresse;
  onChange: (next: Adresse) => void;
  errors?: Partial<Record<keyof Adresse, string>>;
  required?: boolean;
  /** Label of the first line: « Adresse », « Adresse du siège »… */
  label?: string;
  disabled?: boolean;
}

/**
 * Postal address of France, as the post delivers it: the Base Adresse Nationale proposes the exact address while it is
 * typed and fills the postal code and the commune; a postal code typed by hand proposes its communes (API Géo). Out of
 * reach, or for an address abroad, every field is typed by hand (DECISIONS.md, 28/11/2026).
 */
export function ChampAdresse({ value, onChange, errors = {}, required, label = 'Adresse', disabled }: ChampAdresseProps) {
  const [typed, setTyped] = useState(false);
  const [query] = useDebouncedValue(typed ? value.address : '', 250);
  // Each answer is kept with what it answers: an answer to an older text or code is never shown.
  const [answer, setAnswer] = useState<{ query: string; hits: AddressHit[] }>({ query: '', hits: [] });
  const [served, setServed] = useState<{ code: string; communes: string[] }>({ code: '', communes: [] });
  // The city follows a postal code just typed, never one emptied on purpose.
  const follow = useRef(false);

  useEffect(() => {
    const stop = new AbortController();
    if (query.trim().length >= 3)
      void suggestAddresses(query, stop.signal).then((hits) => {
        if (!stop.signal.aborted) setAnswer({ query, hits });
      });
    return () => stop.abort();
  }, [query]);
  const hits = answer.query === query ? answer.hits : [];

  const { postalCode } = value;
  useEffect(() => {
    const stop = new AbortController();
    if (/^\d{5}$/u.test(postalCode))
      void communesOf(postalCode, stop.signal).then((communes) => {
        if (!stop.signal.aborted) setServed({ code: postalCode, communes });
      });
    return () => stop.abort();
  }, [postalCode]);
  const communes = served.code === postalCode ? served.communes : [];

  // One commune for this code: it is the one. Several: the person chooses, unless the one typed is among them.
  const only = communes.length === 1 ? communes[0] : undefined;
  useEffect(() => {
    if (!only || !follow.current) return;
    follow.current = false;
    if (!value.city.trim()) onChange({ ...value, city: only });
  }, [only, value, onChange]);
  const choose = communes.length > 1;

  return (
    <>
      <Champ
        label={label}
        value={value.address}
        required={required}
        disabled={disabled}
        error={errors.address}
        help="Numéro et voie : l’adresse exacte vous est proposée pendant la saisie."
        suggestions={{
          label: 'Propositions de la Base Adresse Nationale',
          items: hits.map((hit) => ({ value: hit.label, label: hit.line, hint: `${hit.postalCode} ${hit.city}` })),
          onPick: (picked) => {
            const hit = hits.find((item) => item.label === picked);
            if (!hit) return;
            setTyped(false);
            onChange({ address: hit.line, postalCode: hit.postalCode, city: hit.city });
          },
        }}
        onChange={(address) => {
          setTyped(true);
          onChange({ ...value, address });
        }}
      />
      <Champ
        label="Code postal"
        value={value.postalCode}
        required={required}
        disabled={disabled}
        error={errors.postalCode}
        inputMode="numeric"
        maxLength={5}
        autocomplete="off"
        onChange={(code) => {
          const digits = code.replace(/\D/gu, '');
          follow.current = digits.length === 5;
          onChange({ ...value, postalCode: digits, city: digits === value.postalCode ? value.city : '' });
        }}
      />
      {choose ? (
        <Champ
          label="Ville"
          type="select"
          value={communes.includes(value.city) ? value.city : ''}
          required={required}
          disabled={disabled}
          error={errors.city}
          help={`${communes.length} communes pour ce code postal`}
          options={[{ value: '', label: 'Choisissez la commune' }, ...communes]}
          onChange={(city) => onChange({ ...value, city })}
        />
      ) : (
        <Champ
          label="Ville"
          value={value.city}
          required={required}
          disabled={disabled}
          error={errors.city}
          autocomplete="off"
          onChange={(city) => onChange({ ...value, city })}
        />
      )}
    </>
  );
}
