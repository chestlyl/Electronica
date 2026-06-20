/**
 * Generates the committed SAMPLE calibration report from the offline Cornerstone
 * dossier vs the Claude baseline vs an ILLUSTRATIVE ground-truth fixture.
 *
 *   npm run calibration-demo
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { buildCornerstoneOffline } from './researchDemo.js';
import { compareCalibration, loadFieldMap, toolFieldsFromBuild } from './research/calibration.js';
import { renderCalibrationMarkdown } from './research/calibrationMarkdown.js';

async function main() {
  const { target, build } = await buildCornerstoneOffline();
  const tool = toolFieldsFromBuild(target, build);
  const claude = loadFieldMap('docs/calibration/claude_baseline_cornerstone.json');
  const truth = loadFieldMap('docs/calibration/cornerstone_ground_truth.SAMPLE.json');

  const report = compareCalibration(tool, claude, truth, build.accessLevel);
  report.conflicts = build.conflicts.map((c) => ({
    field: c.field_name, a: c.value_a ?? '', b: c.value_b ?? '',
    recommended: c.recommended_value ?? '', confidence: c.confidence,
  }));

  const md =
    '<!-- ILLUSTRATIVE: ground truth is sample data, not verified with the church. -->\n\n' +
    renderCalibrationMarkdown(target.name + ' (SAMPLE / illustrative ground truth)', report);

  mkdirSync('docs/calibration', { recursive: true });
  writeFileSync('docs/calibration/SAMPLE_calibration_cornerstone.md', md);
  console.log(md);
  console.log('\nWrote docs/calibration/SAMPLE_calibration_cornerstone.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
