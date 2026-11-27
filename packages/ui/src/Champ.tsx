import { Input, NativeSelect, Textarea, TextInput } from '@mantine/core';
import { useId, type ChangeEvent, type HTMLInputAutoCompleteAttribute, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icone } from './Icone';
import css from './Champ.module.css';
import type { LayoutProps } from './types';

type Option = string | { value: string; label: string };
export interface ChampProps extends LayoutProps {
  label: string;
  type?: 'text' | 'email' | 'tel' | 'password' | 'number' | 'search' | 'date' | 'url' | 'select' | 'textarea';
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
  onChange?: (value: string) => void;
  onBlur?: () => void;
}

export function Champ(props: ChampProps) {
  const auto = useId();
  const id = props.fieldId ?? auto;
  const { label, type = 'text', value, help, error, prefix, suffix, size = 'md' } = props;
  const describedBy = error ? `${id}-err` : help ? `${id}-help` : undefined;
  const shared = {
    id,
    value,
    disabled: props.disabled,
    required: props.required,
    error: error ? true : undefined,
    onBlur: props.onBlur,
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
          />
        )}
        {props.action && <span className={css.action}>{props.action}</span>}
        {suffix && <span className={css.affix}>{suffix}</span>}
      </div>
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
