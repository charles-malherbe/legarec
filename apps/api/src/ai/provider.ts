import type { Config } from '../platform/config/config';

export interface Completion {
  text: string;
  inputTokens: number;
  outputTokens: number;
}
export interface CompletionRequest {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
}
/** The single interface of the providers (docs/ia.md): the rest of the API knows none of them. */
export interface AiProvider {
  complete(request: CompletionRequest, key: string): Promise<Completion>;
}
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
}

const TIMEOUT_MS = 60_000;
async function post(url: string, headers: Record<string, string>, body: unknown): Promise<unknown> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // Neither the body nor the key is ever quoted: only the status.
  if (!response.ok) throw new ProviderError(`status ${response.status}`);
  return response.json();
}

export class AnthropicProvider implements AiProvider {
  async complete({ model, system, user, maxTokens }: CompletionRequest, key: string): Promise<Completion> {
    const answer = (await post(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: 'user', content: user }],
      },
    )) as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number } };
    return {
      text: (answer.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join(''),
      inputTokens: answer.usage?.input_tokens ?? 0,
      outputTokens: answer.usage?.output_tokens ?? 0,
    };
  }
}

export class OpenAiCompatibleProvider implements AiProvider {
  constructor(private readonly base: string) {}

  async complete({ model, system, user, maxTokens }: CompletionRequest, key: string): Promise<Completion> {
    const answer = (await post(
      new URL('chat/completions', this.base.endsWith('/') ? this.base : `${this.base}/`).toString(),
      { authorization: `Bearer ${key}` },
      {
        model,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      },
    )) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    return {
      text: answer.choices?.[0]?.message?.content ?? '',
      inputTokens: answer.usage?.prompt_tokens ?? 0,
      outputTokens: answer.usage?.completion_tokens ?? 0,
    };
  }
}

/** Development and tests: answers from what it was given, without any network. */
export class SimulatedProvider implements AiProvider {
  constructor(private readonly answer: (request: CompletionRequest) => string) {}

  async complete(request: CompletionRequest): Promise<Completion> {
    return { text: this.answer(request), inputTokens: Math.ceil(request.user.length / 4), outputTokens: 120 };
  }
}

/** Development without a provider: a summary that says it is simulated. */
const simulatedSummary = () =>
  JSON.stringify({
    lines: ['Situation', 'Promesses', 'Dernier contact', 'Blocage', 'Suggestion'].map((k) => ({
      k,
      v: 'Synthèse simulée en développement : aucun fournisseur d’IA n’est appelé.',
    })),
  });

export interface AiSetup {
  provider: AiProvider;
  advanced: string;
  fast: string;
  /** Euros per million tokens. */
  price: { input: number; output: number };
}
type AiConfig = Pick<
  Config,
  'AI_ENABLED' | 'IA_MODELE_RAPIDE' | 'IA_MODELE_AVANCE' | 'AI_PROVIDER' | 'AI_BASE_URL' | 'AI_PRICE_INPUT' | 'AI_PRICE_OUTPUT' | 'NODE_ENV'
>;
/** Null, the AI is off: every value must be there, the switch of the server first. */
export function aiSetup(config: AiConfig, simulated?: SimulatedProvider): AiSetup | null {
  const { AI_ENABLED, IA_MODELE_RAPIDE, IA_MODELE_AVANCE, AI_PROVIDER, AI_BASE_URL, AI_PRICE_INPUT, AI_PRICE_OUTPUT } = config;
  if (AI_ENABLED !== 'true' || !IA_MODELE_AVANCE || !IA_MODELE_RAPIDE || !AI_PROVIDER || AI_PRICE_INPUT === undefined || AI_PRICE_OUTPUT === undefined)
    return null;
  const provider =
    AI_PROVIDER === 'anthropic'
      ? new AnthropicProvider()
      : AI_PROVIDER === 'openai-compatible'
        ? AI_BASE_URL?.startsWith('https://')
          ? new OpenAiCompatibleProvider(AI_BASE_URL)
          : null
        : config.NODE_ENV === 'production'
          ? null
          : (simulated ?? new SimulatedProvider(simulatedSummary));
  return provider && { provider, advanced: IA_MODELE_AVANCE, fast: IA_MODELE_RAPIDE, price: { input: AI_PRICE_INPUT, output: AI_PRICE_OUTPUT } };
}

/** In millionths of a euro. */
export const costOf = (price: AiSetup['price'], completion: Completion) =>
  Math.ceil(completion.inputTokens * price.input + completion.outputTokens * price.output);
