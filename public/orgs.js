/* Organizations: prospect list, live likelihood scoring, and org outreach. Uses globals from app.js. */
'use strict';

const ORG_TYPES = ['U-M funding', 'Health system', 'Healthcare company', 'Foundation', 'Community club', 'Alumni employer (matching gift)', 'Local business', 'Other'];
const ORG_STATUSES = ['Not contacted', 'Contacted', 'In conversation', 'Committed', 'Declined'];
const FACTORS = [
  ['connection', 'Connection to B4P', 30],
  ['mission', 'Mission fit', 25],
  ['history', 'Giving track record', 20],
  ['access', 'Ease of asking', 15],
  ['timing', 'Timing (by Giving Tuesday)', 10],
];
const SENIOR = /\b(partner|director|founder|co-?founder|board|vp|vice president|head of|chief|principal|philanthropy|social impact|manager|owner)\b/i;

const DEFAULT_ORG_TEMPLATES = {
  org: {
    subject: '{org_name} x {their_org} this Giving Tuesday',
    body: `Hi {contact_name},

My name is {sender_name}, and I'm with {org_name}, a student-run nonprofit founded at the University of Michigan. We recover unused medical supplies from hospitals, including Michigan Medicine, and send them to clinics and hospitals in communities that need them.

This Giving Tuesday ({date}), we're raising {goal} for {cause}. We'd love for {their_org} to be part of it. What we're hoping to explore: {ask}.

Would you be open to a short call, or could you point me to the right person or application? You can also learn more and give here: {donation_link}

Thank you for your time,
{sender_name}
{org_name}`,
  },
  alum: {
    subject: 'Double your Giving Tuesday gift to {org_name} through {their_org}',
    body: `Hi {first_name},

Giving Tuesday is {date}, and {org_name} is raising {goal} for {cause}.

Since you're at {their_org}, your donation may be matched by your employer, which doubles your impact at no extra cost to you.

1. Donate here: {donation_link}
2. Submit the match through {their_org}'s employee giving portal (search "Blueprints for Pangaea").

Even a small gift goes twice as far. Thank you for staying connected to B4P!

{sender_name}
{org_name}`,
  },
};

let orgSeedInfo = null;
const picked = () => new Set(state.orgSelection || []);

/* ---------- scoring ---------- */
function kwRegex(k) {
  return new RegExp('(^|[^a-z0-9])' + k.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])', 'i');
}
function alumniFor(p) {
  const kws = (p.match || []).filter(Boolean).map(kwRegex);
  if (!kws.length) return [];
  // Count only current roles: skip segments like "Ex-McKinsey" or "former Analyst @ Morgan Stanley".
  return state.donors.filter((d) => d.org && d.org.split(/[|;,]/).some((seg) =>
    kws.some((r) => r.test(seg)) && !/\b(ex|former|formerly|previously|prev)\b/i.test(seg)));
}
function liveFactors(p) {
  const f = { ...p.factors };
  const alumni = alumniFor(p);
  const bonus = Math.min(3, alumni.length) + (alumni.some((a) => SENIOR.test(a.org)) ? 1 : 0);
  f.connection = Math.min(5, (Number(f.connection) || 0) + bonus);
  return { f, alumni, bonus };
}
function scoreOf(p) {
  const { f } = liveFactors(p);
  return Math.round(FACTORS.reduce((s, [k, , w]) => s + ((Number(f[k]) || 0) / 5) * w, 0));
}
const tier = (s) => (s >= 70 ? 'high' : s >= 50 ? 'med' : 'low');
const scoreBadge = (s) => `<span class="score ${tier(s)}" title="${tier(s) === 'high' ? 'Most likely' : tier(s) === 'med' ? 'Possible' : 'Long shot'}">${s}</span>`;

/* ---------- init / live updates ---------- */
async function loadSeed() {
  try {
    const r = await fetch('/prospects-seed.json', { cache: 'no-store' });
    return await r.json();
  } catch {
    return null;
  }
}

function mergeSeed(seed, { onlyNew = true } = {}) {
  let added = 0;
  state.prospects ||= [];
  for (const sp of seed.prospects) {
    const cur = state.prospects.find((p) => p.id === sp.id);
    if (!cur) {
      state.prospects.push({ ...JSON.parse(JSON.stringify(sp)), status: 'Not contacted', notes: '', contactedOn: '', researchedOn: seed.researchedOn });
      added++;
    } else if (!onlyNew) {
      // refresh researched fields, keep the user's status, notes and factor edits
      Object.assign(cur, { why: sp.why, sources: sp.sources, researchedOn: seed.researchedOn });
      for (const k of Object.keys(sp.contact)) if (!cur.contact[k] && sp.contact[k]) cur.contact[k] = sp.contact[k];
    }
  }
  return added;
}

window.initOrgs = async function () {
  state.orgTemplates ||= JSON.parse(JSON.stringify(DEFAULT_ORG_TEMPLATES));
  state.orgSelection ||= [];
  orgSeedInfo = await loadSeed();
  if (orgSeedInfo) {
    const added = mergeSeed(orgSeedInfo, { onlyNew: true });
    if (added) save();
  }
  bindOrgs();
  startLivePolling();
};

let lastSeen = 0;
function startLivePolling() {
  lastSeen = state.updatedAt || 0;
  setInterval(async () => {
    if (document.hidden || $('dialog[open]') || ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
    try {
      const data = await (await fetch('/api/state', { cache: 'no-store' })).json();
      if (data && data.updatedAt && data.updatedAt > (state.updatedAt || 0)) {
        Object.assign(state, data);
        renderAll();
        toast('List updated.');
      }
      const seed = await loadSeed();
      if (seed && seed.researchedOn !== orgSeedInfo?.researchedOn) {
        orgSeedInfo = seed;
        const added = mergeSeed(seed, { onlyNew: false });
        save();
        renderAll();
        toast(`Research refreshed${added ? `: ${added} new organization${added === 1 ? '' : 's'}` : ''}.`);
      }
    } catch { /* server briefly unavailable */ }
  }, 15000);
}

/* ---------- Organizations tab ---------- */
function fillSelect(sel, items, allLabel) {
  const cur = sel.value;
  sel.innerHTML = (allLabel ? `<option value="">${allLabel}</option>` : '') + items.map((t) => `<option>${esc(t)}</option>`).join('');
  sel.value = cur;
}

function sortedProspects() {
  return [...(state.prospects || [])].map((p) => ({ p, s: scoreOf(p) })).sort((a, b) => b.s - a.s || a.p.name.localeCompare(b.p.name));
}

function contactCell(p) {
  const c = p.contact || {};
  const who = [c.name, c.title].filter(Boolean).join(', ');
  const parts = [];
  if (who) parts.push(`<div>${esc(who)}</div>`);
  if (c.email) parts.push(`<div><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></div>`);
  if (c.phone) parts.push(`<div class="muted small">${esc(c.phone)}</div>`);
  if (c.url) parts.push(`<div><a href="${esc(c.url)}" target="_blank" rel="noopener" class="small">${esc(c.method || 'Website')} ↗</a></div>`);
  else if (c.method) parts.push(`<div class="muted small">${esc(c.method)}</div>`);
  return parts.join('') || '<span class="muted">–</span>';
}

function renderOrgTable() {
  if (!$('#org-rows')) return;
  fillSelect($('#org-type'), ORG_TYPES, 'All types');
  fillSelect($('#org-status-filter'), ORG_STATUSES, 'Any status');
  const q = $('#org-search').value.trim().toLowerCase();
  const t = $('#org-type').value;
  const st = $('#org-status-filter').value;
  const rows = sortedProspects()
    .filter(({ p }) => !t || p.type === t)
    .filter(({ p }) => !st || p.status === st)
    .filter(({ p }) => !q || [p.name, p.type, p.connection, p.why, p.ask, p.contact?.name].join(' ').toLowerCase().includes(q));
  $('#org-count').textContent = (state.prospects || []).length;
  $('#org-rows').innerHTML = rows.map(({ p, s }) => {
    const { alumni } = liveFactors(p);
    return `<tr class="clickable" data-org="${esc(p.id)}">
      <td>${scoreBadge(s)}</td>
      <td><b>${esc(p.name)}</b><div class="muted small">${esc(p.type)}</div></td>
      <td>${alumni.length ? `<span class="tag">${alumni.length} alum${alumni.length === 1 ? '' : 's'}</span> ` : ''}<span class="small">${esc(p.connection)}</span></td>
      <td class="small">${esc(p.ask)}</td>
      <td class="small">${contactCell(p)}</td>
      <td><span class="tag">${esc(p.status || 'Not contacted')}</span></td>
    </tr>`;
  }).join('');
  const linked = (state.prospects || []).reduce((n, p) => n + alumniFor(p).length, 0);
  $('#org-live').textContent = `Scores update live from your donor list (${state.donors.length} contacts, ${linked} alumni linked to these organizations).` +
    (orgSeedInfo ? ` Research last refreshed ${orgSeedInfo.researchedOn}.` : '') + ' Checks for changes every 15 seconds.';
}

let editingOrg = null;
function openOrg(id) {
  const p = (state.prospects || []).find((x) => x.id === id);
  editingOrg = id;
  const f = $('#org-form');
  fillSelect($('#org-dialog-type'), ORG_TYPES);
  fillSelect($('#org-dialog-status'), ORG_STATUSES);
  const c = p?.contact || {};
  f.name.value = p?.name || '';
  f.type.value = p?.type || 'Other';
  f.status.value = p?.status || 'Not contacted';
  f.ask.value = p?.ask || '';
  f.connection.value = p?.connection || '';
  f.why.value = p?.why || '';
  f.match.value = (p?.match || []).join(', ');
  f.cname.value = c.name || '';
  f.ctitle.value = c.title || '';
  f.cemail.value = c.email || '';
  f.cphone.value = c.phone || '';
  f.curl.value = c.url || '';
  f.cmethod.value = c.method || '';
  f.notes.value = p?.notes || '';
  $('#org-dialog-title').textContent = p ? 'Organization' : 'Add organization';
  $('#org-delete').classList.toggle('hidden', !p);

  const draft = { factors: { ...(p?.factors || { connection: 1, mission: 3, history: 3, access: 3, timing: 2 }) }, match: p?.match || [] };
  const update = () => {
    draft.match = f.match.value.split(',').map((s) => s.trim()).filter(Boolean);
    const { f: live, alumni, bonus } = liveFactors(draft);
    $('#org-dialog-score').innerHTML = scoreBadge(scoreOf(draft));
    for (const [k] of FACTORS) {
      const out = $(`[data-out="${k}"]`);
      if (out) out.textContent = live[k];
    }
    $('#org-bonus').textContent = bonus ? `(+${bonus} from alumni)` : '';
    $('#org-alumni').innerHTML = alumni.length
      ? alumni.map((a) => `<div class="alum"><b>${esc(fullName(a))}</b> · ${esc(a.org)}${a.email ? ` · <a href="mailto:${esc(a.email)}">${esc(a.email)}</a>` : ''}${a.linkedin ? ` · <a href="${esc(a.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>` : ''}</div>`).join('')
      : '<span class="muted">No alumni matched yet. Import the alumni sheet on the Donor list tab, or adjust the keywords below.</span>';
  };
  $('#org-factors').innerHTML = FACTORS.map(([k, label, w]) => `
    <div class="factor"><span>${label} <span class="muted small">${w}%</span>${k === 'connection' ? ' <span class="muted small" id="org-bonus"></span>' : ''}</span>
      <input type="range" min="0" max="5" step="1" data-factor="${k}" value="${Number(draft.factors[k]) || 0}">
      <b data-out="${k}"></b></div>`).join('');
  $$('[data-factor]').forEach((r) => r.addEventListener('input', () => { draft.factors[r.dataset.factor] = Number(r.value); update(); }));
  f.match.oninput = update;
  $('#org-sources').innerHTML = p?.sources?.length
    ? '<b>Sources:</b> ' + p.sources.map((s) => `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join(' · ') + (p.researchedOn ? ` <span class="muted">(researched ${esc(p.researchedOn)})</span>` : '')
    : '';
  f._draft = draft;
  update();
  $('#org-dialog').showModal();
}

function saveOrg() {
  const f = $('#org-form');
  state.prospects ||= [];
  let p = state.prospects.find((x) => x.id === editingOrg);
  if (!p) {
    p = { id: uid(), sources: [], contactedOn: '', researchedOn: '' };
    state.prospects.push(p);
  }
  const prevStatus = p.status;
  Object.assign(p, {
    name: f.name.value.trim(),
    type: f.type.value,
    status: f.status.value,
    ask: f.ask.value.trim(),
    connection: f.connection.value.trim(),
    why: f.why.value.trim(),
    match: f._draft.match,
    factors: { ...f._draft.factors },
    notes: f.notes.value.trim(),
    contact: { name: f.cname.value.trim(), title: f.ctitle.value.trim(), email: f.cemail.value.trim(), phone: f.cphone.value.trim(), url: f.curl.value.trim(), method: f.cmethod.value.trim() },
  });
  if (p.status === 'Contacted' && prevStatus !== 'Contacted') p.contactedOn = today();
  save();
  renderAll();
  toast('Saved.');
}

/* ---------- Org outreach tab ---------- */
function orgFill(text, p, alum) {
  const c = p?.contact || {};
  const firstContact = (c.name || '').split(/\s+/)[0];
  const extra = {
    their_org: (p?.name || '').replace(/\s*\(.*\)\s*$/, ''),
    contact_name: firstContact || 'there',
    ask: (p?.ask || '').replace(/^./, (m) => m.toLowerCase()),
  };
  const withOrg = String(text).replace(/\{(their_org|contact_name|ask)\}/g, (m, k) => extra[k]);
  return fill(withOrg, alum || null);
}

const isMatchType = (p) => p.type === 'Alumni employer (matching gift)';

// One entry per email to send: { p, to, name, alum, subject, body }
function messagesFor(p) {
  const out = [];
  if (isMatchType(p)) {
    for (const a of alumniFor(p).filter(sendable)) {
      const t = state.orgTemplates.alum;
      out.push({ p, to: a.email, name: fullName(a), alum: a, subject: orgFill(t.subject, p, a), body: orgFill(t.body, p, a) });
    }
  } else if (p.contact?.email) {
    const t = state.orgTemplates.org;
    out.push({ p, to: p.contact.email, name: p.contact.name || p.name, alum: null, subject: orgFill(t.subject, p), body: orgFill(t.body, p) });
  }
  return out;
}

function gmailLink(m) {
  return 'https://mail.google.com/mail/?' + new URLSearchParams({ view: 'cm', fs: '1', to: m.to, su: m.subject, body: m.body }).toString();
}

let orgPreviewId = null;
function ooVisible() {
  const t = $('#oo-type').value;
  const min = Number($('#oo-min').value) || 0;
  const st = $('#oo-status').value;
  return sortedProspects()
    .filter(({ p }) => !t || p.type === t)
    .filter(({ s }) => s >= min)
    .filter(({ p }) => !st || (st === 'Not contacted' ? (p.status || 'Not contacted') === 'Not contacted' : p.status !== 'Not contacted'));
}

function renderOrgOutreach() {
  if (!$('#oo-list')) return;
  fillSelect($('#oo-type'), ORG_TYPES, 'All types');
  for (const [id, key, part] of [['#ot-org-subject', 'org', 'subject'], ['#ot-org-body', 'org', 'body'], ['#ot-alum-subject', 'alum', 'subject'], ['#ot-alum-body', 'alum', 'body']]) {
    if (document.activeElement !== $(id)) $(id).value = state.orgTemplates[key][part];
  }
  const sel = picked();
  const vis = ooVisible();
  $('#oo-list').innerHTML = vis.map(({ p, s }) => {
    const msgs = messagesFor(p);
    const reach = msgs.length
      ? `${msgs.length} email${msgs.length === 1 ? '' : 's'}${isMatchType(p) ? ' to alumni' : ''}`
      : p.contact?.url ? 'No email: use their form' : isMatchType(p) ? 'No alumni with email yet' : 'No contact yet';
    return `<li class="${sel.has(p.id) ? 'picked' : ''} ${p.id === orgPreviewId ? 'active' : ''}" data-oo="${esc(p.id)}">
      <label class="check"><input type="checkbox" data-pick="${esc(p.id)}" ${sel.has(p.id) ? 'checked' : ''}></label>
      <div style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted small">${esc(p.status || 'Not contacted')} · ${reach}</div></div>
      ${scoreBadge(s)}
    </li>`;
  }).join('') || '<li class="muted">No organizations match these filters.</li>';

  const chosen = (state.prospects || []).filter((p) => sel.has(p.id));
  const msgs = chosen.flatMap(messagesFor);
  const formOnly = chosen.filter((p) => !messagesFor(p).length);
  $('#oo-selected-count').textContent = `${chosen.length} selected`;
  $('#oo-summary').textContent = chosen.length
    ? `${chosen.length} organization${chosen.length === 1 ? '' : 's'} selected → ${msgs.length} email${msgs.length === 1 ? '' : 's'}.` +
      (formOnly.length ? ` ${formOnly.length} have no email (${formOnly.map((p) => p.name).slice(0, 3).join(', ')}${formOnly.length > 3 ? '…' : ''}), so use their application form or website.` : '')
    : 'Tick organizations on the left to send to them.';

  const p = (state.prospects || []).find((x) => x.id === orgPreviewId) || chosen[0] || vis[0]?.p;
  const m = p && messagesFor(p)[0];
  const t = p && isMatchType(p) ? state.orgTemplates.alum : state.orgTemplates.org;
  $('#oo-preview-for').textContent = p ? (m ? `To ${m.name} <${m.to}> · ${p.name}` : `${p.name}: no email address yet, so this is the text to paste into their form.`) : '';
  $('#oo-preview-subject').textContent = p ? (m ? m.subject : orgFill(t.subject, p)) : '';
  $('#oo-preview-body').textContent = p ? (m ? m.body : orgFill(t.body, p)) : '';
  $('#oo-preview-actions').innerHTML = p
    ? (m ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${esc(gmailLink(m))}">Open in Gmail</a>` : '') +
      (p.contact?.url ? `<a class="btn ghost small" target="_blank" rel="noopener" href="${esc(p.contact.url)}">Open their page ↗</a>` : '') +
      `<button class="ghost small" id="oo-copy-preview">Copy text</button>`
    : '';
  $('#oo-copy-preview')?.addEventListener('click', async () => {
    await copyText($('#oo-preview-subject').textContent + '\n\n' + $('#oo-preview-body').textContent);
    toast('Copied.');
  });
}

window.renderOrgs = function () {
  renderOrgTable();
  renderOrgOutreach();
};

function setPicked(ids, on) {
  const s = picked();
  for (const id of ids) on ? s.add(id) : s.delete(id);
  state.orgSelection = [...s];
  save();
  renderOrgOutreach();
}

function bindOrgs() {
  for (const id of ['#org-search']) $(id).addEventListener('input', renderOrgTable);
  for (const id of ['#org-type', '#org-status-filter']) $(id).addEventListener('change', renderOrgTable);
  $('#org-rows').addEventListener('click', (e) => {
    if (e.target.closest('a')) return;
    const tr = e.target.closest('[data-org]');
    if (tr) openOrg(tr.dataset.org);
  });
  $('#org-add').addEventListener('click', () => openOrg(null));
  $('#org-form').addEventListener('submit', (e) => { if (e.submitter?.value === 'save') saveOrg(); });
  $('#org-delete').addEventListener('click', () => {
    const p = state.prospects.find((x) => x.id === editingOrg);
    if (p && confirm(`Remove ${p.name} from the list?`)) {
      state.prospects = state.prospects.filter((x) => x.id !== editingOrg);
      state.orgSelection = (state.orgSelection || []).filter((x) => x !== editingOrg);
      $('#org-dialog').close();
      save();
      renderAll();
    }
  });
  $('#org-export').addEventListener('click', () => {
    const rows = [['Score', 'Organization', 'Type', 'Status', 'Ask', 'Connection', 'Alumni linked', 'Why', 'Contact name', 'Contact title', 'Email', 'Phone', 'Page', 'How to reach', 'Sources', 'Notes']];
    for (const { p, s } of sortedProspects()) {
      const c = p.contact || {};
      rows.push([s, p.name, p.type, p.status, p.ask, p.connection, alumniFor(p).length, p.why, c.name, c.title, c.email, c.phone, c.url, c.method, (p.sources || []).map((x) => x.url).join(' '), p.notes]);
    }
    downloadFile('giving-tuesday-organizations.csv', toCSV(rows));
  });

  for (const [id, key, part] of [['#ot-org-subject', 'org', 'subject'], ['#ot-org-body', 'org', 'body'], ['#ot-alum-subject', 'alum', 'subject'], ['#ot-alum-body', 'alum', 'body']]) {
    $(id).addEventListener('input', (e) => {
      state.orgTemplates[key][part] = e.target.value;
      save();
      clearTimeout(bindOrgs._t);
      bindOrgs._t = setTimeout(renderOrgOutreach, 250);
    });
  }
  $('#ot-reset').addEventListener('click', () => {
    if (!confirm('Replace both organization emails with the default wording?')) return;
    state.orgTemplates = JSON.parse(JSON.stringify(DEFAULT_ORG_TEMPLATES));
    save();
    renderOrgOutreach();
  });
  for (const id of ['#oo-type', '#oo-status']) $(id).addEventListener('change', renderOrgOutreach);
  $('#oo-min').addEventListener('input', renderOrgOutreach);
  $('#oo-list').addEventListener('click', (e) => {
    const box = e.target.closest('[data-pick]');
    if (box) return setPicked([box.dataset.pick], box.checked);
    const li = e.target.closest('[data-oo]');
    if (li && !e.target.closest('label')) { orgPreviewId = li.dataset.oo; renderOrgOutreach(); }
  });
  $('#oo-all').addEventListener('click', () => setPicked(ooVisible().map(({ p }) => p.id), true));
  $('#oo-none').addEventListener('click', () => { state.orgSelection = []; save(); renderOrgOutreach(); });
  $('#oo-csv').addEventListener('click', () => {
    const msgs = (state.prospects || []).filter((p) => picked().has(p.id)).flatMap(messagesFor);
    if (!msgs.length) return toast('No emails for the selected organizations.');
    const rows = [['Email', 'Name', 'Organization', 'Subject', 'Body']];
    for (const m of msgs) rows.push([m.to, m.name, m.p.name, m.subject, m.body]);
    downloadFile('org-outreach-mail-merge.csv', toCSV(rows));
  });
  $('#oo-copy').addEventListener('click', async () => {
    const emails = [...new Set((state.prospects || []).filter((p) => picked().has(p.id)).flatMap(messagesFor).map((m) => m.to))];
    if (!emails.length) return toast('No emails for the selected organizations.');
    await copyText(emails.join(', '));
    toast(`Copied ${emails.length} email address${emails.length === 1 ? '' : 'es'}.`);
  });
  $('#oo-mark').addEventListener('click', () => {
    const chosen = (state.prospects || []).filter((p) => picked().has(p.id));
    if (!chosen.length) return toast('Select organizations first.');
    if (!confirm(`Mark ${chosen.length} organization${chosen.length === 1 ? '' : 's'} as contacted?`)) return;
    for (const p of chosen) { p.status = 'Contacted'; p.contactedOn = today(); }
    save();
    renderAll();
  });
}
