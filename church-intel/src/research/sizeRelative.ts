import type { StrategicScores } from './strategicScoring.js';

/**
 * Capability-vs-size lens. The five scores measure capability/posture; AWA
 * measures size. The strategically valuable signal is the DIVERGENCE between
 * them: a small church with big-church capability is punching above its weight
 * (high potential / early adopter); a large church with thin capability is
 * under-developed for its size (a strong modernization opportunity).
 *
 * Additive only — does NOT change the raw scores. organizational_capacity is
 * intentionally excluded (it is largely a size measure itself, so comparing it
 * to a size expectation is circular).
 */

export type DevelopmentPosture = 'punching_above_weight' | 'on_par' | 'underdeveloped_for_size' | 'unknown';
export type RelRead = 'over' | 'on_par' | 'under';

export interface SizeRelativeRead { dimension: string; score: number; expected: number; delta: number; read: RelRead; }

export interface SizeRelativeProfile {
  awa: number | null;
  size_expectation: number;            // expected capability (0..100) at this AWA
  reads: SizeRelativeRead[];
  posture: DevelopmentPosture;
  modernization_opportunity: boolean;  // large church + under-developed digital
  above_weight: boolean;               // small church + over-developed capability
  summary: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Expected capability (0..100) at a given AWA — larger churches have more
 * resources, so more is expected. Coarse, log-scaled, intentionally humble.
 */
export function sizeExpectation(awa: number): number {
  return Math.round(clamp(15 + 20 * Math.log10(Math.max(awa, 30)), 25, 92));
}

// resource/investment-scaling capability dims (NOT contactability, NOT org capacity).
const REL_DIMS = ['digital_maturity', 'growth_orientation'] as const;

export function computeSizeRelative(awa: number | null, scores: StrategicScores): SizeRelativeProfile {
  if (awa == null) {
    return { awa: null, size_expectation: 0, reads: [], posture: 'unknown', modernization_opportunity: false, above_weight: false, summary: 'attendance unknown — capability-vs-size not assessed' };
  }
  const expected = sizeExpectation(awa);
  const reads: SizeRelativeRead[] = REL_DIMS.map((d) => {
    const score = scores[d].score;
    const delta = score - expected;
    const read: RelRead = delta >= 15 ? 'over' : delta <= -15 ? 'under' : 'on_par';
    return { dimension: d, score, expected, delta, read };
  });
  const digital = reads.find((r) => r.dimension === 'digital_maturity')!;
  const avgDelta = reads.reduce((s, r) => s + r.delta, 0) / reads.length;
  const posture: DevelopmentPosture = avgDelta >= 15 ? 'punching_above_weight' : avgDelta <= -15 ? 'underdeveloped_for_size' : 'on_par';
  const modernization_opportunity = awa >= 800 && digital.read === 'under';
  const above_weight = awa < 500 && reads.some((r) => r.read === 'over');
  const summary = `AWA ~${awa} (expected capability ~${expected}) · digital ${digital.score} (${digital.read}) · posture: ${posture.replace(/_/g, ' ')}`;
  return { awa, size_expectation: expected, reads, posture, modernization_opportunity, above_weight, summary };
}
