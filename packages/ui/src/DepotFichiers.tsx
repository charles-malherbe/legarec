import { Dropzone } from '@mantine/dropzone';
import { useId, useRef, useState } from 'react';
import { Bouton } from './Bouton';
import css from './DepotFichiers.module.css';
import { Icone } from './Icone';

export interface DepotFichiersProps {
  label: string;
  hint?: string;
  accept: string;
  multiple?: boolean;
  maxMb?: number;
  files: File[];
  onChange: (files: File[]) => void;
}

/**
 * Drag-and-drop and file picker, on the dropzone of Mantine: a file dropped beside the zone never opens in the tab. The
 * files are only listed here: the API reads and checks them (real type, ClamAV).
 */
export function DepotFichiers({ label, hint, accept, multiple, maxMb = 10, files, onChange }: DepotFichiersProps) {
  const open = useRef<() => void>(null);
  const [error, setError] = useState('');
  const hintId = useId();
  const extensions = accept.split(',').map((item) => item.trim().toLowerCase());
  const add = (picked: File[]) => {
    const allowed = picked.filter((file) => extensions.some((ext) => file.name.toLowerCase().endsWith(ext)) && file.size <= maxMb * 1_000_000);
    setError(allowed.length < picked.length ? `Fichier refusé : ${extensions.map((ext) => ext.slice(1).toUpperCase()).join(', ')}, ${maxMb} Mo maximum.` : '');
    if (allowed.length > 0) onChange(multiple ? [...files, ...allowed] : allowed.slice(0, 1));
  };
  return (
    <div className={css.root}>
      <Dropzone
        unstyled
        className={css.drop}
        openRef={open}
        multiple={multiple}
        // The extension and the size are checked here, to say why a file is refused; the picker opens with the button.
        onDrop={add}
        onReject={(rejected) => add(rejected.map((item) => item.file))}
        activateOnClick={false}
        activateOnKeyboard={false}
        useFsAccessApi={false}
        inputProps={{ accept, 'aria-label': label, 'aria-describedby': hint ? hintId : undefined }}
      >
        <Icone icon="upload" size={22} />
        <span className={css.label}>{label}</span>
        {hint && (
          <span id={hintId} className={css.hint}>
            {hint}
          </span>
        )}
        <Bouton variant="secondary" size="sm" label="Choisir un fichier" onPress={() => open.current?.()} />
      </Dropzone>
      {error && (
        <p role="alert" className={css.error}>
          {error}
        </p>
      )}
      {files.length > 0 && (
        <ul className={css.files} aria-label="Fichiers choisis">
          {files.map((file, index) => (
            <li key={`${file.name}-${index}`}>
              <Icone icon="file" size={16} />
              <span className={css.name}>{file.name}</span>
              <span className={css.hint}>{Math.max(1, Math.round(file.size / 1000)).toLocaleString('fr-FR')} Ko</span>
              <Bouton
                variant="ghost"
                size="xs"
                icon="x"
                iconOnly
                label={`Retirer ${file.name}`}
                onPress={() => onChange(files.filter((_item, position) => position !== index))}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
