import { Combobox, Input, NativeSelect, Textarea, TextInput, useCombobox } from '@mantine/core';
import { useId, useState, type ChangeEvent, type HTMLInputAutoCompleteAttribute, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { Icone } from './Icone';
import css from './Champ.module.css';
import type { LayoutProps } from './types';

type Option = string | { value: string; label: string };
/** A proposal under the field: picked with the arrows and Entrée, or with a click. */
export interface Suggestion {
  value: string;
  label: string;
  hint?: string;
}
export interface ChampProps extends LayoutProps {
  label: string;
  type?: 'text' | 'email' | 'tel' | 'password' | 'number' | 'search' | 'date' | 'time' | 'url' | 'select' | 'textarea';
  value: string;
  placeholder?: string;
  help?: string;
  error?: string;
  options?: Option[];
  required?: boolean;
  optional?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  mono?: boolean;
  size?: 'md' | 'lg';
  prefix?: string;
  suffix?: string;
  /** Control drawn inside the field, at its end: the button that shows a password. */
  action?: ReactNode;
  rows?: number;
  hideLabel?: boolean;
  fieldId?: string;
  autocomplete?: HTMLInputAutoCompleteAttribute;
  inputMode?: InputHTMLAttributes<HTMLInputElement>['inputMode'];
  maxLength?: number;
  spellCheck?: boolean;
  autoFocus?: boolean;
  /** Says « Majuscules activées » while Caps Lock is on; by default for a password, even while it is shown. */
  capsLockWarning?: boolean;
  /** Proposals while typing (an address of the Base Adresse Nationale…); typing anything else stays possible. */
  suggestions?: { items: Suggestion[]; label: string; onPick: (value: string) => void };
  onChange?: (value: string) => void;
  onBlur?: () => void;
}

export function Champ(props: ChampProps) {
  const auto = useId();
  const id = props.fieldId ?? auto;
  const { label, type = 'text', value, help, error, prefix, suffix, size = 'md' } = props;
  const [capsLock, setCapsLock] = useState(false);
  const combobox = useCombobox({ onDropdownClose: () => combobox.resetSelectedOption() });
  const proposals = props.suggestions?.items ?? [];
  const watchCaps = props.capsLockWarning ?? type === 'password';
  const describedBy =
    [error ? `${id}-err` : help ? `${id}-help` : undefined, watchCaps && capsLock ? `${id}-caps` : undefined].filter(Boolean).join(' ') || undefined;
  // Read on every key, Caps Lock included: no event says it changed while the field had no focus.
  const readCaps = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState('CapsLock'));
  const shared = {
    id,
    value,
    disabled: props.disabled,
    required: props.required,
    error: error ? true : undefined,
    onBlur: () => {
      setCapsLock(false);
      props.onBlur?.();
    },
    'aria-label': props.hideLabel ? label : undefined,

    'aria-describedby': describedBy,
    unstyled: true,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => props.onChange?.(event.currentTarget.value),
    classNames: { input: css.input, wrapper: css.wrapper, root: css.wrapper },
    attributes: {
      input: {
        'data-invalid': error ? true : undefined,
        'data-autofocus': props.autoFocus || undefined,
        'aria-describedby': describedBy,
        'data-mono': props.mono || undefined,
        'data-size': size,
        'data-readonly': props.readOnly || undefined,
        'data-action': props.action ? true : undefined,
      },
    },
  };
  return (
    <div className={css.root} style={props.layout}>
      {!props.hideLabel && (
        <Input.Label unstyled htmlFor={id} className={css.label}>
          {label}
          {props.required && (
            <span aria-hidden className={css.required}>
              {' '}
              *
            </span>
          )}
          {props.optional && !props.required && <span className={css.optional}> (facultatif)</span>}
        </Input.Label>
      )}
      <div className={css.row}>
        {prefix && <span className={css.affix}>{prefix}</span>}
        {type === 'select' ? (
          <NativeSelect
            {...shared}
            rightSection={<span hidden />}
            data={(props.options ?? []).map((option) => (typeof option === 'string' ? { value: option, label: option } : option))}
          />
        ) : type === 'textarea' ? (
          <Textarea
            {...shared}
            rows={props.rows ?? 4}
            placeholder={props.placeholder}
            readOnly={props.readOnly}
            maxLength={props.maxLength}
            spellCheck={props.spellCheck}
            data-area
          />
        ) : props.suggestions ? (
          <Combobox
            store={combobox}
            unstyled
            withinPortal={false}
            transitionProps={{ duration: 0 }}
            hideDetached={false}
            onOptionSubmit={(picked) => {
              props.suggestions?.onPick(picked);
              combobox.closeDropdown();
            }}
          >
            <Combobox.Target>
              <TextInput
                {...shared}
                type={type}
                placeholder={props.placeholder}
                readOnly={props.readOnly}
                maxLength={props.maxLength}
                // The browser would cover the proposals with its own.
                autoComplete="off"
                inputMode={props.inputMode}
                spellCheck={props.spellCheck}
                onChange={(event) => {
                  props.onChange?.(event.currentTarget.value);
                  combobox.openDropdown();
                  combobox.updateSelectedOptionIndex();
                }}
                onFocus={() => combobox.openDropdown()}
                onBlur={() => {
                  combobox.closeDropdown();
                  props.onBlur?.();
                }}
              />
            </Combobox.Target>
            <Combobox.Dropdown hidden={proposals.length === 0} className={css.dropdown}>
              <Combobox.Options aria-label={props.suggestions.label}>
                {proposals.map((item) => (
                  <Combobox.Option key={item.value} value={item.value} className={css.option}>
                    <span>{item.label}</span>
                    {item.hint && <span className={css.optionHint}> {item.hint}</span>}
                  </Combobox.Option>
                ))}
              </Combobox.Options>
            </Combobox.Dropdown>
          </Combobox>
        ) : (
          <TextInput
            {...shared}
            type={type}
            placeholder={props.placeholder}
            readOnly={props.readOnly}
            maxLength={props.maxLength}
            autoComplete={props.autocomplete}
            inputMode={props.inputMode}
            spellCheck={props.spellCheck}
            onKeyDown={watchCaps ? readCaps : undefined}
            onKeyUp={watchCaps ? readCaps : undefined}
          />
        )}
        {props.action && <span className={css.action}>{props.action}</span>}
        {suffix && <span className={css.affix}>{suffix}</span>}
      </div>
      {watchCaps && (
        // Present but empty while Caps Lock is off: a live region is announced only if it exists before its text changes.
        <span id={`${id}-caps`} aria-live="polite" className={css.caps}>
          {capsLock && (
            <>
              <Icone icon="alert" size={14} />
              Majuscules activées
            </>
          )}
        </span>
      )}
      {help && !error && (
        <span id={`${id}-help`} className={css.help}>
          {help}
        </span>
      )}
      {error && (
        <span id={`${id}-err`} role="alert" className={css.error}>
          <Icone icon="alert" size={14} />
          {error}
        </span>
      )}
    </div>
  );
}
