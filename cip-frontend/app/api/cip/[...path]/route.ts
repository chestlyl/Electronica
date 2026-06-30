import { type NextRequest } from 'next/server';

/**
 * Server-side proxy to the CIP API. The browser talks to /api/cip/* and this
 * handler forwards to the CIP backend with the bearer key — so CIP_API_KEY is
 * NEVER exposed to the client. Config: CIP_API_BASE + CIP_API_KEY (.env.local).
 */
const API_BASE = (process.env.CIP_API_BASE ?? 'http://localhost:4100').replace(/\/+$/, '');
const API_KEY = process.env.CIP_API_KEY ?? '';

async function forward(req: NextRequest, path: string[]): Promise<Response> {
  const url = `${API_BASE}/${path.join('/')}${req.nextUrl.search}`;
  const init: RequestInit = {
    method: req.method,
    headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
    cache: 'no-store',
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const body = await req.text();
    if (body) init.body = body;
  }
  try {
    const res = await fetch(url, init);
    const text = await res.text();
    return new Response(text || '{}', {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: `CIP API unreachable at ${API_BASE}: ${(e as Error).message}` }), {
      status: 502, headers: { 'content-type': 'application/json' },
    });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };
export async function GET(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function POST(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function PUT(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return forward(req, (await ctx.params).path); }
