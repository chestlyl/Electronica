import Anthropic from '@anthropic-ai/sdk';
import { mkdirSync, writeFileSync } from 'node:fs';
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
  // ZodType<T, any, any> so preprocess/effects schemas (input type unknown) are allowed.
  schema?: ZodType<T, z.ZodTypeDef, any>;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  extractJson<T>(opts: ExtractOptions<T>): Promise<LlmResult<T>>;
}

/** Strip a markdown code fence (handles a fence with no closing ```). */
export function stripFences(text: string): string {
  const open = text.indexOf('```');
  if (open === -1) return text;
  let s = text.slice(open + 3).replace(/^[a-zA-Z]*\r?\n/, ''); // drop ```json language tag
  const close = s.indexOf('```');
  return close === -1 ? s : s.slice(0, close);
}

/**
 * Extract the first JSON object/array substring, ignoring leading/trailing prose
 * and any text after the first complete value. If the value is truncated, return
 * the slice from the opening brace to EOF (repairJson closes it).
 */
export function extractJsonCandidate(text: string): string {
  const body = stripFences(text);
  const start = body.search(/[[{]/);
  if (start === -1) return body.trim();
  const open = body[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0) return body.slice(start, i + 1); }
  }
  return body.slice(start); // truncated — closed by repairJson
}

/** Close dangling strings/keys/structures of a (possibly truncated) JSON string. */
function closeJson(s: string): string {
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') stack.pop();
  }
  let out = inStr ? s + '"' : s;     // close a dangling string
  out = out.replace(/\\+$/, '');     // drop a trailing lone backslash
  out = out.replace(/,\s*$/, '');    // drop a trailing comma
  if (/:\s*$/.test(out)) out += 'null'; // a key with no value → null
  for (let i = stack.length - 1; i >= 0; i--) out += stack[i] === '{' ? '}' : ']';
  return out;
}

/**
 * Best-effort repair of a truncated JSON string. Closes open structures and, if
 * that still doesn't parse, trims back to the last complete element (comma /
 * opening bracket) and retries — so a half-written final key/value is dropped
 * rather than corrupting the whole object.
 */
export function repairJson(input: string): string {
  let s = input.trim();
  for (let attempt = 0; attempt < 500 && s.length > 0; attempt++) {
    const candidate = closeJson(s);
    try { JSON.parse(candidate); return candidate; } catch { /* trim & retry */ }
    const cut = Math.max(s.lastIndexOf(','), s.lastIndexOf('{'), s.lastIndexOf('['));
    if (cut <= 0) break;
    s = s.slice(0, cut);
  }
  return closeJson(input.trim()); // last resort (may still be invalid → caller throws)
}

/**
 * Resilient JSON extraction: tolerant of markdown fences, leading/trailing prose,
 * multiple objects (first wins), and truncated output. Tries a single repair pass
 * before throwing.
 */
export function parseJsonLoose(text: string): unknown {
  const candidate = extractJsonCandidate(text);
  try {
    return JSON.parse(candidate);
  } catch {
    /* fall through to repair */
  }
  const repaired = repairJson(candidate);
  try {
    return JSON.parse(repaired);
  } catch (e) {
    throw new Error(
      `Could not parse JSON from model output after repair: ${(e as Error).message}. ` +
        `First 200 chars of candidate: ${candidate.slice(0, 200)}`,
    );
  }
}

/** Write the raw model response for debugging (best-effort). */
function writeClaudeDebug(raw: string): void {
  try {
    mkdirSync('data/debug', { recursive: true });
    writeFileSync('data/debug/last-claude-response.txt', raw);
  } catch {
    /* ignore */
  }
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

    // Capture the raw model response before any JSON extraction (when enabled).
    if (config.claude.debug) writeClaudeDebug(raw);

    let parsed: unknown;
    try {
      parsed = parseJsonLoose(raw);
    } catch (err) {
      // Always capture the offending response so it can be inspected/replayed.
      writeClaudeDebug(raw);
      throw new Error(`${(err as Error).message} (raw response saved to data/debug/last-claude-response.txt)`);
    }
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
