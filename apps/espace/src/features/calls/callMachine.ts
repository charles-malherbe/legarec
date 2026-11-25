import type { CallOutcome } from '@legarec/contracts';

export const ACW_SECONDS = 60;
export const PREVIEW_SECONDS = 5;
export interface CallState {
  index: number;
  inCall: boolean;
  secs: number;
  acw: number;
  muted: boolean;
  hold: boolean;
  holdSecs: number;
  announced: boolean;
  transfer: { to: string; pending: boolean } | null;
  preview: number;
  previewPaused: boolean;
  outcome: CallOutcome | null;
  ai: 'proposed' | 'applied' | 'ignored';
}
export type CallEvent =
  | { type: 'tick' }
  | { type: 'toggleCall' }
  | { type: 'mute' }
  | { type: 'hold' }
  | { type: 'announce' }
  | { type: 'outcome'; outcome: CallOutcome }
  | { type: 'pick'; index: number }
  | { type: 'saved'; next: number }
  | { type: 'previewNow' }
  | { type: 'previewPause' }
  | { type: 'previewSkip'; next: number }
  | { type: 'transfer'; to: string; mode: 'announced' | 'direct' }
  | { type: 'transferFinish' }
  | { type: 'transferCancel' }
  | { type: 'ai'; status: CallState['ai'] }
  | { type: 'restore'; state: CallState }
  | { type: 'dial' };

export const idle = (index = 0): CallState => ({
  index,
  inCall: false,
  secs: 0,
  acw: 0,
  muted: false,
  hold: false,
  holdSecs: 0,
  announced: false,
  transfer: null,
  preview: 0,
  previewPaused: false,
  outcome: null,
  ai: 'proposed',
});

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case 'tick':
      if (state.preview > 0) {
        if (state.previewPaused) return state;
        return state.preview <= 1 ? { ...state, preview: 0, inCall: true, secs: 0, acw: 0, announced: false } : { ...state, preview: state.preview - 1 };
      }
      if (state.inCall) return state.hold ? { ...state, holdSecs: state.holdSecs + 1 } : { ...state, secs: state.secs + 1 };
      return state.secs > 0 ? { ...state, acw: state.acw + 1 } : state;
    case 'toggleCall':
      return state.inCall
        ? { ...state, inCall: false, muted: false, hold: false, acw: 0 }
        : { ...state, inCall: true, secs: 0, acw: 0, announced: false, preview: 0 };
    case 'dial':
      return { ...state, inCall: true, secs: 0, acw: 0, announced: false, preview: 0 };
    case 'mute':
      return state.inCall ? { ...state, muted: !state.muted } : state;
    case 'hold':
      return state.inCall ? { ...state, hold: !state.hold, holdSecs: 0 } : state;
    case 'announce':
      return { ...state, announced: !state.announced };
    case 'outcome':
      return { ...state, outcome: event.outcome };
    case 'pick':
      return idle(event.index);
    case 'saved':
      return { ...idle(event.next), preview: PREVIEW_SECONDS };
    case 'previewNow':
      return { ...state, preview: 0, inCall: true, secs: 0, acw: 0, announced: false };
    case 'previewPause':
      return { ...state, previewPaused: !state.previewPaused };
    case 'previewSkip':
      return { ...idle(event.next), preview: PREVIEW_SECONDS };
    case 'transfer':
      return event.mode === 'direct'
        ? { ...state, transfer: { to: event.to, pending: false }, inCall: false, hold: false, acw: 0 }
        : { ...state, transfer: { to: event.to, pending: true }, hold: true, holdSecs: 0 };
    case 'transferFinish':
      return { ...state, transfer: state.transfer && { ...state.transfer, pending: false }, inCall: false, hold: false, acw: 0 };
    case 'transferCancel':
      return { ...state, transfer: null, hold: false, holdSecs: 0 };
    case 'ai':
      return { ...state, ai: event.status };
    case 'restore':
      return event.state;
  }
}
export const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
export const acwText = (seconds: number) =>
  seconds <= ACW_SECONDS ? `reste ${clock(ACW_SECONDS - seconds)}` : `temps dépassé de ${clock(seconds - ACW_SECONDS)}`;

export interface QualificationDraft {
  promise: number | null;
  invoices: string[];
  paymentReference: string;
  editing: boolean;
}
/** Everything that prevents the file from being saved. */
export function qualificationErrors(state: CallState, draft: QualificationDraft): string[] {
  const errors: string[] = [];
  if (!state.outcome) errors.push('choisir un résultat d’appel (touches 1 à 8)');
  if (state.outcome === 'PROMISE_TO_PAY') {
    if (!draft.promise || draft.promise <= 0) errors.push('indiquer le montant promis');
    if (draft.invoices.length === 0) errors.push('cocher au moins une facture concernée');
  }
  if (state.outcome === 'ALREADY_PAID' && !draft.paymentReference.trim()) errors.push('indiquer la référence du paiement annoncé');
  if (draft.editing) errors.push('terminer ou annuler la modification des coordonnées en cours');
  if (state.secs > 0 && !state.announced) errors.push('confirmer que l’annonce de l’enregistrement a été faite');
  return errors;
}
