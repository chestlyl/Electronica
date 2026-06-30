/**
 * Demo / preview data. When CIP_DEMO=1, the proxy serves these fixtures instead
 * of calling the CIP API — so the full UI renders, populated and rich, with no
 * backend, Supabase, or keys. Realistic, on-brand sample churches.
 */
import type { ChurchRow, Dossier, Job, DashboardStats, ScoredDimension } from './types';

const now = Date.now();
const ago = (mins: number) => new Date(now - mins * 60_000).toISOString();

type Seed = {
  id: string; name: string; city: string; state: string; website: string;
  denom: string; arch: string; life: string; awa: number; cov: number; conf: number; fit: number; prio: string;
};
const SEEDS: Seed[] = [
  { id: 'church_onecity', name: 'One City Church', city: 'Nashville', state: 'TN', website: 'https://theonecity.org', denom: 'Non-denominational', arch: 'Mid-Size Church', life: 'Growth', awa: 475, cov: 50, conf: 87, fit: 69, prio: 'High' },
  { id: 'church_crosspoint', name: 'Cross Point Church', city: 'Nashville', state: 'TN', website: 'https://crosspoint.tv', denom: 'Non-denominational', arch: 'Multi-Site', life: 'Established', awa: 1800, cov: 88, conf: 74, fit: 82, prio: 'Critical' },
  { id: 'church_belonging', name: 'The Belonging Co', city: 'Nashville', state: 'TN', website: 'https://thebelonging.co', denom: 'Non-denominational', arch: 'Large Church', life: 'Growth', awa: 3200, cov: 71, conf: 80, fit: 78, prio: 'High' },
  { id: 'church_lifechurch', name: 'Life.Church', city: 'Edmond', state: 'OK', website: 'https://life.church', denom: 'Evangelical', arch: 'Megachurch', life: 'Mature', awa: 85000, cov: 94, conf: 92, fit: 88, prio: 'Critical' },
  { id: 'church_cotc', name: 'Church of the City', city: 'Franklin', state: 'TN', website: 'https://www.churchofthecity.com', denom: 'Non-denominational', arch: 'Multi-Site', life: 'Growth', awa: 5000, cov: 76, conf: 79, fit: 81, prio: 'High' },
  { id: 'church_passion', name: 'Passion City Church', city: 'Atlanta', state: 'GA', website: 'https://passioncitychurch.com', denom: 'Non-denominational', arch: 'Large Church', life: 'Established', awa: 9000, cov: 83, conf: 85, fit: 76, prio: 'High' },
  { id: 'church_elevation', name: 'Elevation Church', city: 'Charlotte', state: 'NC', website: 'https://elevationchurch.org', denom: 'Baptist', arch: 'Megachurch', life: 'Mature', awa: 28000, cov: 90, conf: 88, fit: 84, prio: 'Critical' },
  { id: 'church_gateway', name: 'Gateway Church', city: 'Southlake', state: 'TX', website: 'https://gatewaypeople.com', denom: 'Non-denominational', arch: 'Megachurch', life: 'Mature', awa: 24000, cov: 81, conf: 83, fit: 70, prio: 'Medium' },
  { id: 'church_redemption', name: 'Redemption Church', city: 'Gilbert', state: 'AZ', website: 'https://redemptionaz.com', denom: 'Acts 29', arch: 'Multi-Site', life: 'Growth', awa: 4200, cov: 64, conf: 72, fit: 73, prio: 'Medium' },
  { id: 'church_citychurch', name: 'City Church', city: 'Tallahassee', state: 'FL', website: 'https://citychurchtally.com', denom: 'Non-denominational', arch: 'Mid-Size Church', life: 'Growth', awa: 1100, cov: 58, conf: 66, fit: 64, prio: 'Medium' },
  { id: 'church_hillsong', name: 'Transformation Church', city: 'Indian Land', state: 'SC', website: 'https://transformation.church', denom: 'Non-denominational', arch: 'Large Church', life: 'Growth', awa: 4000, cov: 69, conf: 75, fit: 72, prio: 'High' },
  { id: 'church_newlife', name: 'New Life Church', city: 'Colorado Springs', state: 'CO', website: 'https://newlifechurch.org', denom: 'Charismatic', arch: 'Large Church', life: 'Revitalizing', awa: 7000, cov: 73, conf: 77, fit: 61, prio: 'Low' },
];

export const CHURCHES: ChurchRow[] = SEEDS.map((s, i) => ({
  church_id: s.id, name: s.name, city: s.city, state: s.state, website: s.website, verified: true,
  denomination: s.denom, archetype: s.arch, lifecycle: s.life, awa: s.awa, attendance_source: s.awa > 2000 ? 'reported' : 'inferred',
  coverage_percent: s.cov, research_confidence: s.conf, engagement_fit: s.fit, priority: s.prio,
  last_researched_at: ago(i * 37 + 12), created_at: ago(i * 37 + 4000), updated_at: ago(i * 37 + 12),
}));

export const JOBS: Job[] = [
  { job_id: 'job_run_belonging', status: 'running', stage: 'extraction', progress: 42, started_at: ago(3), completed_at: null, error: null, church_id: 'church_belonging', result: null },
  { job_id: 'job_run_redemption', status: 'running', stage: 'scoring', progress: 78, started_at: ago(2), completed_at: null, error: null, church_id: 'church_redemption', result: null },
  { job_id: 'job_q_dfw', status: 'queued', stage: 'queued', progress: 0, started_at: null, completed_at: null, error: null, church_id: null, result: null },
  { job_id: 'job_done_onecity', status: 'complete', stage: 'complete', progress: 100, started_at: ago(28), completed_at: ago(24), error: null, church_id: 'church_onecity', result: { church_id: 'church_onecity', dossier_id: 'dossier_onecity' } },
  { job_id: 'job_done_crosspoint', status: 'complete', stage: 'complete', progress: 100, started_at: ago(70), completed_at: ago(64), error: null, church_id: 'church_crosspoint', result: { church_id: 'church_crosspoint', dossier_id: 'dossier_crosspoint' } },
  { job_id: 'job_fail_x', status: 'failed', stage: 'failed', progress: 35, started_at: ago(120), completed_at: ago(118), error: 'Official site DOM not retrievable (403) — confidence capped, dossier skipped', church_id: null, result: null },
];

const TZ = (n: number): 'Strong' | 'Moderate' | 'Weak' => (n >= 80 ? 'Strong' : n >= 60 ? 'Moderate' : 'Weak');
void TZ;

function score(dimension: string, value: number, pos: [string, number][], neg: string[] = [], notInv: string[] = []): ScoredDimension {
  return {
    dimension, score: value, band: value >= 76 ? 'strong' : value >= 51 ? 'capable' : value >= 26 ? 'emerging' : 'weak',
    confidence: Math.min(90, 60 + Math.round(value / 5)),
    positive_factors: pos.map(([label, points]) => ({ label, points })),
    negative_factors: neg.map((label) => ({ label, points: -3 })),
    not_investigated: notInv.map((label) => ({ label, points: 0 })),
  };
}

function makeDossier(c: ChurchRow): Dossier {
  const multi = /Multi-Site|Megachurch/.test(c.archetype ?? '');
  const fit = c.engagement_fit ?? 60;
  return {
    church_id: c.church_id, dossier_id: `dossier_${c.church_id}`,
    identity: { official_website: c.website, website_verified: c.verified, denomination: c.denomination, address: `${c.city}, ${c.state}`, lifecycle: (c.lifecycle ?? '').toLowerCase(), archetype: c.archetype, known_church_verified: true, identity_confidence: 100 },
    coverage: {
      coveragePercent: c.coverage_percent,
      complete: ['homepage', 'giving', 'technology', 'social', 'groups'],
      partial: ['sermons/media', 'campuses'],
      missing: ['staff', 'contact', 'ministries'],
      categories: [],
    },
    size: {
      awa: c.awa, attendance_confidence: c.attendance_source === 'reported' ? 85 : 55, attendance_source: c.attendance_source,
      range: { min: Math.round((c.awa ?? 0) * 0.7), max: Math.round((c.awa ?? 0) * 1.4) },
      reasoning: c.attendance_source === 'reported' ? 'Reported weekend attendance from authoritative source.' : 'Inferred via staff + role patterns, service times, and platform usage — pattern estimate, not exact.',
      staff_count: Math.max(5, Math.round((c.awa ?? 100) / 90)), campuses: multi ? Math.max(2, Math.round((c.awa ?? 0) / 2500)) : 1,
    },
    leadership_access: c.church_id === 'church_onecity'
      ? [{ role: 'Lead Pastor', name: 'Hollis Thomas', title: 'Senior Pastor', email: null, source_url: 'https://www.theonecity.org/ourleaders', confidence: 70 }]
      : [
          { role: 'Lead Pastor', name: 'Pastor (detected)', title: 'Lead Pastor', email: `pastor@${(c.website ?? '').replace(/^https?:\/\/(www\.)?/, '')}`.replace(/\/$/, ''), source_url: c.website ?? '', confidence: 72 },
          { role: 'Executive Pastor', name: 'Exec (detected)', title: 'Executive Pastor', email: null, source_url: c.website ?? '', confidence: 60 },
        ],
    staff_emails: {
      primary_email: c.church_id === 'church_onecity' ? 'business@theonecity.org' : `info@${(c.website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}`,
      primary_phone: c.church_id === 'church_onecity' ? null : '(615) 555-0142',
      church_emails: c.church_id === 'church_onecity' ? [] : [{ value: `info@${(c.website ?? '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}` }],
      role_emails: c.church_id === 'church_onecity' ? [] : [{ value: 'giving@church.org' }, { value: 'connect@church.org' }],
      person_emails: [], unassigned_emails: c.church_id === 'church_onecity' ? [{ value: 'business@theonecity.org' }] : [],
      departments: [], contact_forms: [], campus_contacts: [], phones: c.church_id === 'church_onecity' ? [] : [{ value: '(615) 555-0142' }],
    },
    technology_stack: c.church_id === 'church_onecity'
      ? [
          { platform_name: 'Squarespace', category: 'Website', confidence: 88 },
          { platform_name: 'Church Center / Planning Center', category: 'ChMS', confidence: 95 },
          { platform_name: 'Pushpay', category: 'Giving', confidence: 90 },
          { platform_name: 'YouTube', category: 'Streaming', confidence: 80 },
        ]
      : [
          { platform_name: 'Planning Center', category: 'ChMS', confidence: 92 },
          { platform_name: 'Subsplash', category: 'Mobile App', confidence: 88 },
          { platform_name: 'Pushpay', category: 'Giving', confidence: 90 },
          { platform_name: 'Resi', category: 'Streaming', confidence: 84 },
        ],
    strategic_signals: [
      { category: 'livestream_video', confidence: 85 }, { category: 'giving', confidence: 90 },
      { category: 'groups', confidence: 70 }, { category: 'church_management', confidence: 90 },
      { category: 'social_media', confidence: 85 }, ...(multi ? [{ category: 'multi_site' as const, confidence: 88 }] : []),
      ...(fit > 75 ? [{ category: 'jobs_hiring' as const, confidence: 70 }] : []),
    ],
    strategic_scores: {
      digital_maturity: score('digital_maturity', Math.min(95, fit + 14), [['ChMS platform: Planning Center', 18], ['online giving: Pushpay', 14], ['website platform: Squarespace', 8], ['livestream/video', 12], ['social channels', 6]], ['no email platform'], ['no podcast']),
      growth_orientation: score('growth_orientation', Math.min(92, fit + 4), [['lifecycle momentum: growing', 22], ['hiring/job postings', 18], ['media reach', 6], ['modern platform adoption', 6]], ['no residency/internship'], ['no school/academy']),
      organizational_capacity: score('organizational_capacity', Math.max(40, fit - 7), [['lift capacity — established size', 28], ['staff infrastructure', 10], ['operational ChMS backbone', 6]], []),
      contactability: score('contactability', Math.min(88, fit + 1), [['lead pastor reachable', 35], ['office email channel', 14], ['social channels', 6]], ['no office phone']),
    },
    recommendations: {
      engagement_fit: { value: fit }, engagement_priority: { value: c.priority },
      recommended_first_conversation: { value: fit > 75 ? 'Leadership Pipeline / Staffing' : 'Strengthen contactability' },
      recommended_entry_point: { value: 'Lead Pastor' },
      likely_growth_constraints: { value: ['Staffing depth for the lift'] }, likely_pain_points: { value: ['Fragmented digital systems'] },
      recommended_product_fit: { value: multi ? ['Multi-Campus Platform', 'Digital Modernization (at scale)'] : ['Multiplication Lab', 'Optimize existing platform (not transformation)'] },
      partnership_probability: { value: Math.min(90, fit + 10) }, confidence: 95,
    },
    outreach_intelligence: {
      best_first_contact: { name: c.church_id === 'church_onecity' ? 'Hollis Thomas' : 'Lead Pastor', role: 'Lead Pastor' },
      message_angle: fit > 75 ? 'Leadership pipeline / multiplication support for a multiplying church.' : 'Discipleship / engagement systems aligned to current ministry priorities.',
      supporting_evidence: [`growth_orientation ${Math.min(92, fit + 4)}`, `lifecycle ${(c.lifecycle ?? '').toLowerCase()}`],
      risks: ['Attendance is INFERRED — do not cite a specific number as fact.'],
      do_not_lead_with: ['Comms/marketing as the owner — the initiative must be carried by senior leadership.'],
    },
    raw_evidence: [
      { id: 'raw_1', source_type: 'official_site', source_url: c.website ?? '', page_category: 'home', text_excerpt: `${c.name} | ${c.city}, ${c.state}. Love God, Love People, Make a Difference.`, fetched: true, access_level: 'live_official_site' },
      { id: 'raw_2', source_type: 'official_site', source_url: `${c.website}/give`, page_category: 'giving', text_excerpt: 'Give online. Generosity fuels life-changing ministry…', fetched: true, access_level: 'live_official_site' },
      { id: 'raw_3', source_type: 'official_site', source_url: `${c.website}/groups`, page_category: 'groups', text_excerpt: 'Join a Community Group today.', fetched: true, access_level: 'live_official_site' },
      { id: 'raw_4', source_type: 'search', source_url: 'https://www.youtube.com/@church', page_category: 'sermons', text_excerpt: 'Sermons and weekend services on YouTube.', fetched: false, access_level: 'search_snippets' },
    ],
    markdown: `# Research Dossier — ${c.name}\n_${c.city}, ${c.state}_\n\n## Strategic Scores\n- Digital Maturity: ${Math.min(95, fit + 14)}\n- Growth Orientation: ${Math.min(92, fit + 4)}\n- Engagement Fit: ${fit}\n\n## Leadership\n- Lead Pastor (verified from the official site)\n\n## Technology Stack\nPlanning Center · Pushpay · YouTube\n`,
  };
}

const archetypeTally = () => {
  const m = new Map<string, number>();
  for (const c of CHURCHES) m.set(c.archetype ?? 'Unknown', (m.get(c.archetype ?? 'Unknown') ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};
const stateTally = () => {
  const m = new Map<string, number>();
  for (const c of CHURCHES) m.set(c.state ?? 'Unknown', (m.get(c.state ?? 'Unknown') ?? 0) + 1);
  return [...m.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
};

export const DASHBOARD: DashboardStats = {
  total_churches: CHURCHES.length, jobs_queued: 1, jobs_running: 2, jobs_completed: 31, jobs_failed: 1,
  avg_engagement_fit: Math.round(CHURCHES.reduce((a, c) => a + (c.engagement_fit ?? 0), 0) / CHURCHES.length),
  recent_dossiers: CHURCHES.slice(0, 6),
  top_opportunities: [...CHURCHES].sort((a, b) => (b.engagement_fit ?? 0) - (a.engagement_fit ?? 0)).slice(0, 6),
  churches_by_archetype: archetypeTally(), churches_by_state: stateTally(), recent_activity: JOBS,
};

/** Resolve a demo response for a proxied path (or undefined if unmatched). */
export function demoResponse(method: string, path: string[], search: string): unknown | undefined {
  const p = path.join('/');
  const params = new URLSearchParams(search);
  if (method === 'POST') {
    if (p === 'research/known-church') return { job_id: 'job_demo_new', church_id: 'church_onecity', status: 'queued', message: 'Known church research started' };
    if (p === 'research/discovery-query') return { job_id: 'job_demo_disc', status: 'queued', message: 'Discovery job started' };
    if (p.startsWith('research/jobs/') && path[2]) return { ...(JOBS.find((j) => j.job_id === path[2]) ?? JOBS[0]), status: 'running', stage: 'discovery', progress: 5 };
    return undefined;
  }
  if (p === 'health') return { ok: true };
  if (p === 'dashboard/stats') return DASHBOARD;
  if (p === 'research/jobs') {
    const status = params.get('status');
    const jobs = status ? JOBS.filter((j) => j.status === status) : JOBS;
    return { jobs, total: jobs.length };
  }
  if (p.startsWith('research/jobs/') && path[2]) return JOBS.find((j) => j.job_id === path[2]) ?? JOBS[0];
  if (p === 'churches') {
    let rows = [...CHURCHES];
    const q = params.get('q'); const st = params.get('state'); const arch = params.get('archetype'); const prio = params.get('priority');
    if (q) rows = rows.filter((c) => (c.name ?? '').toLowerCase().includes(q.toLowerCase()));
    if (st) rows = rows.filter((c) => (c.state ?? '').toLowerCase() === st.toLowerCase());
    if (arch) rows = rows.filter((c) => (c.archetype ?? '').toLowerCase().includes(arch.toLowerCase()));
    if (prio) rows = rows.filter((c) => (c.priority ?? '').toLowerCase() === prio.toLowerCase());
    return { churches: rows, total: rows.length };
  }
  if (p.startsWith('churches/') && p.endsWith('/dossier')) {
    const c = CHURCHES.find((x) => x.church_id === path[1]) ?? CHURCHES[0];
    return makeDossier(c);
  }
  if (p.startsWith('churches/') && path[1]) return CHURCHES.find((c) => c.church_id === path[1]) ?? CHURCHES[0];
  return undefined;
}
