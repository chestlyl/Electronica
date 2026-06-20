import type { CalibrationReport, FieldComparison } from './calibration.js';

function v(x: { value: unknown; confidence: number | null }): string {
  const val = x.value === null || x.value === undefined || x.value === '' ? '—' : String(x.value);
  return x.confidence == null ? val : `${val} _(${Math.round(x.confidence)})_`;
}
const icon = (c: FieldComparison) =>
  c.status === 'correct' ? (c.overconfident ? '✓' : c.cappedAtCeiling ? '✓◔' : '✓')
    : c.status === 'wrong' ? (c.overconfident ? '✗‼' : '✗')
    : c.status === 'missing' ? '○' : '·';

export function renderCalibrationMarkdown(name: string, r: CalibrationReport): string {
  const L: string[] = [];
  L.push(`# Calibration report — ${name}`);
  L.push(`_generated ${new Date().toISOString()} · evidence access: **${r.accessLevel}** (confidence cap **${r.cap}**)_`);
  L.push('');
  if (!r.hasGroundTruth) {
    L.push('> ⚠️ No ground-truth values provided — correctness columns are blank. Fill the ground-truth file and re-run.');
    L.push('');
  }

  const scored = r.comparisons.filter((c) => c.status !== 'unverified');
  L.push('## Scorecard');
  L.push(`- correct: **${r.correct.length}** · wrong: **${r.wrong.length}** · missing: **${r.missing.length}** (of ${scored.length} ground-truthed)`);
  L.push(`- overconfident: **${r.overconfident.length}** · underconfident: **${r.underconfident.length}**`);
  L.push(`- tool closer to truth: ${r.toolCloser.length} · Claude closer: ${r.claudeCloser.length}`);
  L.push(`- confidence-cap violations: **${r.capViolations.length}**${r.capViolations.length ? ' — ' + r.capViolations.join(', ') : ' (none — cap respected)'}`);
  L.push('');

  L.push('## Field-by-field (tool vs Claude vs ground truth)');
  L.push('| | field | tool _(conf)_ | Claude _(conf)_ | ground truth | status | closer |');
  L.push('|---|---|---|---|---|---|---|');
  for (const c of r.comparisons) {
    L.push(`| ${icon(c)} | ${c.label} | ${v(c.tool)} | ${v(c.claude)} | ${v(c.truth)} | ${c.status}${c.overconfident ? ' (overconf)' : ''}${c.underconfident ? ' (underconf)' : ''} | ${c.closerToTruth} |`);
  }
  L.push('');

  const list = (title: string, keys: string[], note?: string) => {
    L.push(`## ${title} (${keys.length})`);
    if (note) L.push(`_${note}_`);
    if (!keys.length) L.push('- none');
    for (const k of keys) {
      const c = r.comparisons.find((x) => x.key === k)!;
      L.push(`- **${c.label}**: tool=${v(c.tool)} · truth=${v(c.truth)} · Claude=${v(c.claude)}`);
    }
    L.push('');
  };

  list('Correct fields', r.correct);
  list('Wrong fields', r.wrong);
  list('Overconfident fields', r.overconfident, 'wrong, yet asserted with confidence ≥ 60 — the dangerous quadrant');
  list('Underconfident fields', r.underconfident, 'correct, but confidence < 50');
  list('Missing fields', r.missing, 'ground truth exists but the tool produced no estimate — candidates for new extraction');

  L.push(`## Conflicts preserved (${r.conflicts.length})`);
  if (!r.conflicts.length) L.push('- none');
  for (const c of r.conflicts) {
    L.push(`- **${c.field}**: "${c.a}" vs "${c.b}" → recommended **${c.recommended}** _(conf ${c.confidence ?? '—'})_ — preserved, not resolved silently`);
  }
  L.push('');

  L.push('## Confidence-cap behavior');
  L.push(`- Access level **${r.accessLevel}** caps every tool confidence at **${r.cap}**.`);
  L.push(`- Cap violations: **${r.capViolations.length}** ${r.capViolations.length ? '(' + r.capViolations.join(', ') + ')' : '— cap correctly enforced'}.`);
  L.push(`- Correct fields pinned at the cap ceiling: ${r.cappedButCorrect.length ? r.cappedButCorrect.join(', ') : 'none'}.`);
  L.push(`- Capping cost (correct, but ≥15 below Claude's confidence — the price of honesty): ${r.capCost.length ? r.capCost.join(', ') : 'none'}.`);
  L.push('');

  L.push('## Where the tool under-performed Claude');
  if (!r.claudeCloser.length) L.push('- nowhere on ground-truthed fields 🎉');
  for (const k of r.claudeCloser) {
    const c = r.comparisons.find((x) => x.key === k)!;
    L.push(`- **${c.label}**: Claude=${v(c.claude)} was closer than tool=${v(c.tool)} (truth=${v(c.truth)})`);
  }
  L.push('');

  return L.join('\n');
}
