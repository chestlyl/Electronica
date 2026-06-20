import { config } from '../config.js';

/** Very small robots.txt evaluator for our own user-agent + `*`. */
export class RobotsRules {
  private disallow: string[] = [];
  private allow: string[] = [];
  loaded = false;
  fetchedOk = false;

  static async forOrigin(origin: string): Promise<RobotsRules> {
    const r = new RobotsRules();
    if (!config.crawl.respectRobots) {
      r.loaded = true;
      return r;
    }
    try {
      const res = await fetch(`${origin}/robots.txt`, {
        headers: { 'user-agent': config.crawl.userAgent },
        signal: AbortSignal.timeout(8000),
      });
      r.loaded = true;
      if (res.ok) {
        r.fetchedOk = true;
        r.parse(await res.text());
      }
    } catch {
      r.loaded = true; // treat unreachable robots.txt as "allow all"
    }
    return r;
  }

  private parse(text: string) {
    // Collect rules for matching groups: our UA token or `*`.
    const ua = config.crawl.userAgent.split('/')[0].toLowerCase();
    let active = false;
    let sawAny = false;
    for (const rawLine of text.split('\n')) {
      const line = rawLine.replace(/#.*$/, '').trim();
      if (!line) continue;
      const [keyRaw, ...rest] = line.split(':');
      const key = keyRaw.trim().toLowerCase();
      const value = rest.join(':').trim();
      if (key === 'user-agent') {
        const agent = value.toLowerCase();
        active = agent === '*' || ua.includes(agent) || agent.includes('churchintel');
        if (active) sawAny = true;
      } else if (active && key === 'disallow') {
        if (value) this.disallow.push(value);
      } else if (active && key === 'allow') {
        if (value) this.allow.push(value);
      }
    }
    if (!sawAny) {
      this.disallow = [];
      this.allow = [];
    }
  }

  private static matches(path: string, rule: string): boolean {
    // Support `*` wildcard and `$` end-anchor like Google's spec.
    const anchored = rule.endsWith('$');
    const pattern = anchored ? rule.slice(0, -1) : rule;
    const parts = pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&'));
    const re = new RegExp('^' + parts.join('.*') + (anchored ? '$' : ''));
    return re.test(path);
  }

  isAllowed(url: string): boolean {
    if (!config.crawl.respectRobots) return true;
    let path: string;
    try {
      path = new URL(url).pathname;
    } catch {
      return false;
    }
    const longestAllow = this.allow.filter((r) => RobotsRules.matches(path, r))
      .reduce((m, r) => Math.max(m, r.length), -1);
    const longestDisallow = this.disallow.filter((r) => RobotsRules.matches(path, r))
      .reduce((m, r) => Math.max(m, r.length), -1);
    if (longestDisallow === -1) return true;
    return longestAllow >= longestDisallow; // Allow wins ties (more specific or equal)
  }
}
