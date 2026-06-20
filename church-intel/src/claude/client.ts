import Anthropic from '@anthropic-ai/sdk';
import { z, type ZodType } from 'zod';
import { config, assertClaudeConfigured } from '../config.js';

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  costEstimate: number;
  model: string;
}

export interface LlmResult<T> {
  data: T;
  usage: LlmUsage;
  raw: string;
}

export interface ExtractOptions<T> {
  system: string;
  user: string;
  schema?: ZodType<T>;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  extractJson<T>(opts: ExtractOptions<T>): Promise<LlmResult<T>>;
}

/** Pull the first balanced JSON object/array out of a model response. */
export function parseJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error(`No JSON found in model output: ${text.slice(0, 200)}`);
  // Walk to the matching close brace/bracket.
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1));
    }
  }
  throw new Error('Unbalanced JSON in model output');
}

export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  readonly model: string;
  private client: Anthropic;

  constructor(model = config.claude.model) {
    assertClaudeConfigured();
    this.model = model;
    this.client = new Anthropic({
      apiKey: config.claude.apiKey,
      baseURL: config.claude.baseUrl,
    });
  }

  private cost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * config.claude.inputCostPerMTok +
      (outputTokens / 1_000_000) * config.claude.outputCostPerMTok
    );
  }

  async extractJson<T>(opts: ExtractOptions<T>): Promise<LlmResult<T>> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: opts.maxTokens ?? 1500,
      system:
        opts.system +
        '\n\nRespond with a single valid JSON object and nothing else. ' +
        'Do not include markdown fences or commentary.',
      messages: [{ role: 'user', content: opts.user }],
    });
    const raw = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');

    const parsed = parseJsonLoose(raw);
    const data = (opts.schema ? opts.schema.parse(parsed) : parsed) as T;
    const inputTokens = res.usage.input_tokens;
    const outputTokens = res.usage.output_tokens;
    return {
      data,
      raw,
      usage: {
        inputTokens,
        outputTokens,
        costEstimate: this.cost(inputTokens, outputTokens),
        model: this.model,
      },
    };
  }
}

/**
 * Deterministic mock provider for the offline demo & tests.
 * `responder` returns the object the model would have produced for a given call.
 */
export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-claude';
  constructor(
    private responder: (opts: ExtractOptions<unknown>) => unknown,
  ) {}

  async extractJson<T>(opts: ExtractOptions<T>): Promise<LlmResult<T>> {
    const obj = this.responder(opts as ExtractOptions<unknown>);
    const data = (opts.schema ? opts.schema.parse(obj) : obj) as T;
    const raw = JSON.stringify(obj);
    const inputTokens = Math.ceil((opts.system.length + opts.user.length) / 4);
    const outputTokens = Math.ceil(raw.length / 4);
    return {
      data,
      raw,
      usage: { inputTokens, outputTokens, costEstimate: 0, model: this.model },
    };
  }
}

export { z };
