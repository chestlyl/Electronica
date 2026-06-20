const $ = (s) => document.querySelector(s);
const api = (p, opts) => fetch(p, opts).then((r) => r.json());

// ── tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('nav button').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
    const tab = b.dataset.tab;
    $('#tab-churches').hidden = tab !== 'churches';
    $('#tab-review').hidden = tab !== 'review';
    if (tab === 'review') loadReview();
  }),
);

api('/api/meta').then((m) => ($('#mode').textContent = m.mode));

// ── churches ────────────────────────────────────────────────────────────────
function pill(text, kind) { return `<span class="pill ${kind}">${text}</span>`; }
function statusPill(s) {
  if (!s) return pill('unverified', 'warn');
  if (s === 'Verified Active') return pill(s, 'good');
  if (s === 'Closed' || s === 'Merged') return pill(s, 'bad');
  return pill(s, 'warn');
}

async function loadChurches() {
  const params = new URLSearchParams();
  const search = $('#search').value.trim();
  if (search) params.set('search', search);
  if ($('#activeStatus').value) params.set('activeStatus', $('#activeStatus').value);
  if ($('#missingWebsite').checked) params.set('missingWebsite', 'true');
  if ($('#missingEmail').checked) params.set('missingEmail', 'true');
  if ($('#missingPastor').checked) params.set('missingPastor', 'true');
  if ($('#minMmcFit').value) params.set('minMmcFit', $('#minMmcFit').value);

  const rows = await api('/api/churches?' + params.toString());
  const list = $('#list');
  list.innerHTML = rows.map((c) => `
    <div class="row" data-id="${c.id}">
      <div class="name">${esc(c.name) || '(no name)'} ${statusPill(c.active_status)}</div>
      <div class="sub">${esc(c.city) || ''}, ${esc(c.state) || ''} ·
        MMC <b class="score">${fmt(c.mmc_fit_score)}</b> ·
        Infl <span class="score">${fmt(c.influence_score)}</span></div>
    </div>`).join('') || '<p class="muted" style="padding:1rem">No matches.</p>';

  list.querySelectorAll('.row').forEach((el) =>
    el.addEventListener('click', () => {
      list.querySelectorAll('.row').forEach((x) => x.classList.remove('active'));
      el.classList.add('active');
      loadDetail(el.dataset.id);
    }),
  );
}

async function loadDetail(id) {
  const { church: c, evidence } = await api('/api/churches/' + id);
  const F = (k, v) => `<div class="field"><span class="k">${k}</span><span>${v ?? '—'}</span></div>`;
  const byField = {};
  for (const e of evidence) (byField[e.field_name] ||= []).push(e);

  $('#detail').innerHTML = `
    <h2>${esc(c.name) || '(no name)'} ${statusPill(c.active_status)}</h2>
    <div class="muted">${esc(c.address) || ''} · ${esc(c.city) || ''}, ${esc(c.state) || ''} ${esc(c.zip) || ''}</div>
    <div class="fields">
      ${F('Website (verified)', linkOr(c.website_verified, c.website_original))}
      ${F('Email (verified)', c.email_verified || `<span class="muted">orig: ${esc(c.email_original) || '—'}</span>`)}
      ${F('Phone (verified)', c.phone_verified || `<span class="muted">orig: ${esc(c.phone_original) || '—'}</span>`)}
      ${F('Lead pastor', esc(c.lead_pastor))}
      ${F('Denomination', esc(c.denomination))}
      ${F('Network', esc(c.network_affiliation))}
      ${F('Attendance', c.attendance_estimate ? `${c.attendance_estimate} [${c.attendance_min}–${c.attendance_max}] · ${c.attendance_confidence_tier}` : '—')}
      ${F('Staff / Campuses / Services', `${c.staff_count ?? '—'} / ${c.campus_count ?? '—'} / ${c.weekend_services_count ?? '—'}`)}
      ${F('Influence', fmt(c.influence_score))}
      ${F('MMC fit', fmt(c.mmc_fit_score))}
      ${F('Multiplication', fmt(c.multiplication_score))}
      ${F('Verification score', fmt(c.verification_score))}
      ${F('Last checked', c.last_checked_at ? new Date(c.last_checked_at).toLocaleString() : '—')}
    </div>
    <div class="evidence">
      <h3>Evidence (${evidence.length})</h3>
      ${Object.entries(byField).map(([field, evs]) => `
        <div><b>${field}</b></div>
        ${evs.map((e) => `
          <div class="ev">
            <div>${esc(e.proposed_value) || ''} — ${esc(e.evidence_text) || ''}</div>
            <div class="meta">
              <span>conf ${fmt(e.confidence_score)}</span>
              <span>${esc(e.source_type) || ''}</span>
              ${e.source_url ? `<a href="${esc(e.source_url)}" target="_blank">${esc(e.source_url)}</a>` : ''}
            </div>
          </div>`).join('')}
      `).join('') || '<p class="muted">No evidence recorded yet.</p>'}
    </div>`;
}

// ── review queue ─────────────────────────────────────────────────────────────
async function loadReview() {
  const status = $('#reviewStatus').value;
  const items = await api('/api/review-queue?status=' + status);
  $('#reviewList').innerHTML = items.map((it) => `
    <div class="review" data-id="${it.id}">
      <div class="head">
        <b>${it.field_name}</b>
        <span class="pill ${it.confidence_score >= 75 ? 'good' : 'warn'}">conf ${fmt(it.confidence_score)}</span>
      </div>
      <div class="change">current <code>${esc(it.current_value) || '—'}</code> → proposed <code>${esc(it.proposed_value)}</code></div>
      <div class="muted">${esc(it.evidence_summary) || ''}</div>
      <div class="muted">${(it.source_urls || []).map((u) => `<a href="${esc(u)}" target="_blank">${esc(u)}</a>`).join(' · ')}</div>
      ${status === 'pending' ? `<div class="actions">
        <button class="btn-good" data-act="approved">Approve</button>
        <button class="btn-bad" data-act="rejected">Reject</button>
        <button class="btn-more" data-act="needs_more_research">Needs research</button>
      </div>` : ''}
    </div>`).join('') || '<p class="muted">Queue is empty.</p>';

  $('#reviewList').querySelectorAll('.review').forEach((el) => {
    el.querySelectorAll('button').forEach((btn) =>
      btn.addEventListener('click', async () => {
        await api('/api/review/' + el.dataset.id, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ status: btn.dataset.act }),
        });
        loadReview();
      }),
    );
  });
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fmt(n) { return n == null ? '—' : (Math.round(Number(n) * 10) / 10); }
function esc(s) { return s == null ? '' : String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
function linkOr(v, orig) {
  if (v) return `<a href="${esc(v)}" target="_blank">${esc(v)}</a>`;
  return orig ? `<span class="muted">orig: ${esc(orig)}</span>` : '—';
}

$('#apply').addEventListener('click', loadChurches);
$('#search').addEventListener('keydown', (e) => e.key === 'Enter' && loadChurches());
$('#reloadReview').addEventListener('click', loadReview);
$('#reviewStatus').addEventListener('change', loadReview);
loadChurches();
