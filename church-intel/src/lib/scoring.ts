import type { Church } from '../types.js';

/**
 * All scoring helpers produce 0..100 numbers. Inputs are normalized to 0..100
 * sub-scores first, then combined with the weighted formulas from the spec.
 */

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Attendance -> 0..100 on a log curve (1k attendance ~ 75, 10k+ ~ 100). */
export function attendanceSubScore(attendance: number | null): number {
  if (!attendance || attendance <= 0) return 0;
  // log10(50)=1.7 -> ~25 ; log10(1000)=3 -> ~75 ; log10(10000)=4 -> 100
  const s = ((Math.log10(attendance) - 1) / 3) * 100;
  return clamp(s);
}

/** Structural complexity from campuses / services / staff. */
export function complexitySubScore(c: Pick<Church,
  'campus_count' | 'weekend_services_count' | 'staff_count'>): number {
  const campus = c.campus_count ?? 1;
  const services = c.weekend_services_count ?? 1;
  const staff = c.staff_count ?? 0;
  const campusS = clamp(((campus - 1) / 4) * 100);      // 5+ campuses -> 100
  const servicesS = clamp(((services - 1) / 4) * 100);   // 5+ services -> 100
  const staffS = clamp((staff / 50) * 100);              // 50+ staff -> 100
  return clamp(campusS * 0.4 + servicesS * 0.25 + staffS * 0.35);
}

/** Denomination/network influence heuristic (large/known networks score higher). */
export function networkInfluenceSubScore(denomination: string | null,
  network: string | null): number {
  const text = `${denomination ?? ''} ${network ?? ''}`.toLowerCase();
  if (!text.trim() || text.includes('unknown')) return 20;
  const major = [
    'sbc', 'southern baptist', 'assemblies of god', 'nazarene', 'methodist',
    'presbyterian', 'lutheran', 'acts 29', 'arc', 'send network', 'newthing',
    'converge', 'efca', 'foursquare', 'vineyard', 'exponential', 'cmn',
  ];
  const hit = major.some((m) => text.includes(m));
  if (hit) return 75;
  if (text.includes('independent') || text.includes('non-denominational')) return 45;
  return 50;
}

export interface InfluenceInputs {
  church: Church;
  digitalReachScore: number;          // 0..100
  leadershipDevelopmentScore: number; // 0..100
}

/**
 * Influence Score:
 *   30% attendance estimate
 *   20% staff/campus/service complexity
 *   20% digital reach
 *   15% network/denominational influence
 *   15% leadership development / multiplication evidence
 */
export function influenceScore(i: InfluenceInputs): number {
  const { church } = i;
  const attendance = attendanceSubScore(church.attendance_estimate);
  const complexity = complexitySubScore(church);
  const digital = clamp(i.digitalReachScore);
  const network = networkInfluenceSubScore(church.denomination, church.network_affiliation);
  const leadership = clamp(i.leadershipDevelopmentScore);
  return round1(
    attendance * 0.3 +
      complexity * 0.2 +
      digital * 0.2 +
      network * 0.15 +
      leadership * 0.15,
  );
}

export interface MmcFitInputs {
  multiplicationLanguage: number;  // 0..100
  churchPlantingActivity: number;  // 0..100
  leadershipDevelopment: number;   // 0..100
  kingdomCollaboration: number;    // 0..100
  innovationOpenness: number;      // 0..100
}

/**
 * MMC Fit Score:
 *   30% multiplication language
 *   25% church planting activity
 *   20% leadership development
 *   15% kingdom collaboration
 *   10% openness/innovation indicators
 */
export function mmcFitScore(i: MmcFitInputs): number {
  return round1(
    clamp(i.multiplicationLanguage) * 0.3 +
      clamp(i.churchPlantingActivity) * 0.25 +
      clamp(i.leadershipDevelopment) * 0.2 +
      clamp(i.kingdomCollaboration) * 0.15 +
      clamp(i.innovationOpenness) * 0.1,
  );
}

/** Overall multiplication orientation: blends the multiplication-relevant signals. */
export function multiplicationScore(i: MmcFitInputs): number {
  return round1(
    clamp(i.multiplicationLanguage) * 0.35 +
      clamp(i.churchPlantingActivity) * 0.35 +
      clamp(i.leadershipDevelopment) * 0.2 +
      clamp(i.innovationOpenness) * 0.1,
  );
}
