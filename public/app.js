/* Giving Tuesday Tracker — front end (no dependencies). */
'use strict';

const GROUPS = ['Alumni', 'Past officers', 'Current members', 'Gala attendees', 'Past sponsors', 'Other'];

const DEFAULT_TEMPLATES = {
  pre: {
    subject: "Giving Tuesday is coming: here's what {org_name} is raising for",
    body: `Hi {first_name},

Giving Tuesday is on {date}, and this year {org_name} is raising {goal} for {cause}.

You've been part of what makes {org_name} work, and we'd love to have you with us again. Keep an eye on your inbox: on Giving Tuesday we'll send you one easy link to give.

If you'd like to get a head start, you can donate any time here: {donation_link}

Thank you for being part of this community.

{sender_name}
{org_name}`,
  },
  dayOf: {
    subject: "It's Giving Tuesday: help {org_name} reach {goal}",
    body: `Hi {first_name},

Today is Giving Tuesday! We're raising {goal} for {cause}, and every gift gets us closer.

Donate here (it takes about a minute): {donation_link}

Any amount helps, whether it's $10 or $100. If you can't give today, forwarding this email to a friend helps just as much.

Thank you!

{sender_name}
{org_name}`,
  },
};

function defaultState() {
  return {
    version: 1,
    campaign: {
      orgName: 'Blueprints for Pangaea',
      senderName: '',
      date: '2026-12-01', // Giving Tuesday 2026
      goal: '',
      cause: '',
      donationLink: '',
    },
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
    donors: [],
  };
}

let state = defaultState();

/* ---------- helpers ---------- */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const today = () => new Date().toISOString().slice(0, 10);
const normEmail = (e) => String(e || '').trim().toLowerCase();
const normName = (n) => String(n || '').trim().toLowerCase().replace(/\s+/g, ' ');
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const money = (n) => (n === '' || n == null || isNaN(n) ? '' : '$' + Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 }));
const fullName = (d) => [d.firstName, d.lastName].filter(Boolean).join(' ');

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('show'), 2200);
}

function prettyDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

function downloadFile(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

/* ---------- persistence ---------- */
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try {
      state.updatedAt = Date.now();
      const r = await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(state) });
      if (!r.ok) throw new Error();
    } catch {
      toast('Could not save. Is the server still running?');
    }
  }, 300);
}

async function load() {
  try {
    const r = await fetch('/api/state');
    const data = await r.json();
    if (data && Array.isArray(data.donors)) {
      const base = defaultState();
      state = { ...base, ...data, campaign: { ...base.campaign, ...data.campaign }, templates: { ...base.templates, ...data.templates } };
    }
  } catch {
    toast('Could not load saved data.');
  }
}

/* ---------- CSV ---------- */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ''));
}

function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }).join(',')).join('\r\n');
}

/* ---------- XLSX (reads .xlsx with the browser's built-in unzip) ---------- */
async function inflateRaw(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzip(buf) {
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a valid .xlsx file');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = {};
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true);
    const size = dv.getUint32(p + 20, true);
    const nameLen = dv.getUint16(p + 28, true);
    const extraLen = dv.getUint16(p + 30, true);
    const commentLen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
    files[name] = { method, size, local };
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    has: (name) => name in files,
    async text(name) {
      const f = files[name];
      if (!f) return null;
      const start = f.local + 30 + dv.getUint16(f.local + 26, true) + dv.getUint16(f.local + 28, true);
      const raw = u8.subarray(start, start + f.size);
      return dec.decode(f.method === 0 ? raw : await inflateRaw(raw));
    },
  };
}

async function readXlsx(buf) {
  const zip = await unzip(buf);
  const xml = (s) => new DOMParser().parseFromString(s, 'application/xml');
  const byTag = (el, tag) => [...el.getElementsByTagNameNS('*', tag)];

  const shared = [];
  const ssText = await zip.text('xl/sharedStrings.xml');
  if (ssText) {
    for (const si of byTag(xml(ssText), 'si')) {
      shared.push(byTag(si, 't').filter((t) => t.parentNode.localName !== 'rPh').map((t) => t.textContent).join(''));
    }
  }
  const wb = xml(await zip.text('xl/workbook.xml'));
  const rels = xml(await zip.text('xl/_rels/workbook.xml.rels'));
  const relMap = {};
  for (const r of byTag(rels, 'Relationship')) relMap[r.getAttribute('Id')] = r.getAttribute('Target');

  const colIndex = (ref) => {
    let n = 0;
    for (const ch of ref.match(/^[A-Z]+/)[0]) n = n * 26 + ch.charCodeAt(0) - 64;
    return n - 1;
  };

  const sheets = [];
  for (const sh of byTag(wb, 'sheet')) {
    const rid = sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sh.getAttribute('r:id');
    let target = relMap[rid] || '';
    target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
    const text = await zip.text(target);
    if (!text) continue;
    const rows = [];
    for (const rowEl of byTag(xml(text), 'row')) {
      const row = [];
      for (const c of byTag(rowEl, 'c')) {
        const ref = c.getAttribute('r');
        const idx = ref ? colIndex(ref) : row.length;
        const t = c.getAttribute('t');
        const v = byTag(c, 'v')[0];
        let val = '';
        if (t === 's' && v) val = shared[Number(v.textContent)] ?? '';
        else if (t === 'inlineStr') val = byTag(c, 't').map((x) => x.textContent).join('');
        else if (v) {
          val = v.textContent;
          if (t !== 'str' && /^-?\d+(\.0+)?$/.test(val)) val = String(parseInt(val, 10));
        }
        row[idx] = val;
      }
      for (let i = 0; i < row.length; i++) if (row[i] == null) row[i] = '';
      if (row.some((x) => String(x).trim() !== '')) rows.push(row);
    }
    sheets.push({ name: sh.getAttribute('name'), rows });
  }
  return sheets;
}

/* ---------- import + merge ---------- */
const FIELDS = [
  ['skip', '(ignore)'],
  ['fullName', 'Full name'],
  ['firstName', 'First name'],
  ['lastName', 'Last name'],
  ['email', 'Email'],
  ['altEmail', 'Other email(s)'],
  ['phone', 'Phone'],
  ['org', 'Organization / company'],
  ['gradYear', 'Grad year'],
  ['linkedin', 'LinkedIn URL'],
  ['bounced', 'Bounced flag'],
  ['notes', 'Notes'],
];

function guessField(header, used) {
  const h = String(header).toLowerCase().replace(/[^a-z]/g, '');
  const pick = (f) => (used.has(f) ? 'skip' : (used.add(f), f));
  if (!h) return 'skip';
  if (h.includes('bounce')) return pick('bounced');
  if (h.includes('linkedin')) return pick('linkedin');
  if (h.includes('email') || h.includes('mail') && !h.includes('merge')) {
    if (/other|alt|secondary|personal/.test(h) || used.has('email')) return pick('altEmail');
    return pick('email');
  }
  if (h.includes('firstname') || h === 'first' || h === 'fname' || h === 'givenname') return pick('firstName');
  if (h.includes('lastname') || h === 'last' || h === 'lname' || h === 'surname') return pick('lastName');
  if (h === 'name' || h.includes('fullname') || h === 'contact' || h === 'contactname') return pick('fullName');
  if (h.includes('phone') || h.includes('mobile')) return pick('phone');
  if (h.includes('company') || h.includes('organization') || h.includes('employer') || h === 'org' || h.includes('sponsor')) return pick('org');
  if (h.includes('yeargrad') || h.includes('gradyear') || h.includes('yeargraduated') || h === 'year' || h === 'class') return pick('gradYear');
  return 'skip';
}

let pending = null; // { rows, headers, sheets? }

function showMapping() {
  const box = $('#mapping');
  if (!pending) { box.classList.add('hidden'); return; }
  const { headers, rows, sheets, sheetIndex } = pending;
  const used = new Set();
  pending.map = headers.map((h) => guessField(h, used));
  const sample = rows.slice(1, 4);
  box.innerHTML = `
    ${sheets ? `<label class="field">Spreadsheet tab
      <select id="sheet-pick">${sheets.map((s, i) => `<option value="${i}" ${i === sheetIndex ? 'selected' : ''}>${esc(s.name)} (${Math.max(0, s.rows.length - 1)} rows)</option>`).join('')}</select>
    </label>` : ''}
    <p class="muted">Check what each column is. I've guessed from the headers. <b>${rows.length - 1}</b> rows found.</p>
    <div class="table-wrap"><table class="mapping-table">
      <thead><tr>${headers.map((h, i) => `<th><div class="col-head">${esc(h) || `<span class="muted">Column ${i + 1}</span>`}</div>
        <select data-col="${i}">${FIELDS.map(([v, l]) => `<option value="${v}" ${pending.map[i] === v ? 'selected' : ''}>${l}</option>`).join('')}</select></th>`).join('')}</tr></thead>
      <tbody>${sample.map((r) => `<tr>${headers.map((_, i) => `<td>${esc(String(r[i] ?? '').slice(0, 40))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    <div class="row">
      <button id="do-import">Import ${rows.length - 1} rows as “${esc($('#import-group').value)}”</button>
      <button class="ghost" id="cancel-import">Cancel</button>
    </div>`;
  box.classList.remove('hidden');
  $$('select[data-col]', box).forEach((s) => s.addEventListener('change', () => { pending.map[Number(s.dataset.col)] = s.value; }));
  $('#sheet-pick', box)?.addEventListener('change', (e) => {
    const i = Number(e.target.value);
    setPending(sheets[i].rows, sheets, i);
  });
  $('#do-import', box).addEventListener('click', runImport);
  $('#cancel-import', box).addEventListener('click', () => { pending = null; showMapping(); $('#import-file').value = ''; });
}

function setPending(rows, sheets = null, sheetIndex = 0) {
  if (!rows.length) {
    pending = sheets ? { headers: [], rows: [[]], sheets, sheetIndex } : null;
    if (!sheets) toast('That file looks empty.');
  } else {
    const width = Math.max(...rows.slice(0, 50).map((r) => r.length));
    const headers = Array.from({ length: width }, (_, i) => rows[0][i] ?? '');
    pending = { headers, rows, sheets, sheetIndex };
  }
  showMapping();
}

function splitEmails(v) {
  return String(v || '').split(/[\s,;/]+/).map(normEmail).filter(isEmail);
}

function truthy(v) {
  const s = String(v ?? '').trim().toLowerCase();
  return s !== '' && !['no', 'n', 'false', '0', 'fale'].includes(s);
}

function findDonor(emails, name) {
  if (emails.length) {
    const hit = state.donors.find((d) => [d.email, ...(d.altEmails || [])].some((e) => emails.includes(normEmail(e))));
    if (hit) return hit;
  }
  if (name) return state.donors.find((d) => normName(fullName(d)) === name);
  return null;
}

function pickPrimary(d) {
  const all = [d.email, ...(d.altEmails || [])].filter(Boolean);
  const good = all.find((e) => !(d.bounced || []).includes(e));
  if (good && good !== d.email) {
    d.altEmails = all.filter((e) => e !== good);
    d.email = good;
  }
}

function runImport() {
  const group = $('#import-group').value;
  const { rows, map } = pending;
  let added = 0, merged = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const rec = { fullName: '', firstName: '', lastName: '', email: '', altEmail: '', phone: '', org: '', gradYear: '', linkedin: '', bounced: '', notes: '' };
    map.forEach((f, i) => { if (f !== 'skip') rec[f] = rec[f] ? rec[f] + ' ' + String(r[i] ?? '').trim() : String(r[i] ?? '').trim(); });
    let first = rec.firstName, last = rec.lastName;
    if (rec.fullName && !last) {
      const parts = rec.fullName.trim().split(/\s+/);
      if (!first) first = parts[0] || '';
      last = parts.length > 1 && normName(parts[0]) === normName(first) ? parts.slice(1).join(' ') : (parts.length > 1 ? parts.slice(1).join(' ') : '');
    }
    const primary = splitEmails(rec.email);
    const emails = [...new Set([...primary, ...splitEmails(rec.altEmail)])];
    const name = normName([first, last].filter(Boolean).join(' '));
    if (!emails.length && !name) { skipped++; continue; }
    const bounced = truthy(rec.bounced) ? primary.slice(0, 1) : [];

    let d = findDonor(emails, name);
    if (d) {
      merged++;
      if (!d.tags.includes(group)) d.tags.push(group);
      d.firstName ||= first;
      d.lastName ||= last;
      d.phone ||= rec.phone;
      d.org ||= rec.org;
      d.gradYear ||= rec.gradYear;
      d.linkedin ||= rec.linkedin;
      if (rec.notes && !d.notes.includes(rec.notes)) d.notes = [d.notes, rec.notes].filter(Boolean).join('\n');
      const known = [d.email, ...d.altEmails].map(normEmail);
      for (const e of emails) {
        if (!known.includes(e)) { if (!d.email) d.email = e; else d.altEmails.push(e); }
      }
    } else {
      added++;
      d = {
        id: uid(), firstName: first, lastName: last,
        email: emails[0] || '', altEmails: emails.slice(1), bounced: [],
        phone: rec.phone, org: rec.org, gradYear: rec.gradYear, linkedin: rec.linkedin, notes: rec.notes,
        tags: [group], optOut: false,
        sent: { pre: '', dayOf: '' }, donation: { amount: '', date: '' },
      };
      state.donors.push(d);
    }
    for (const b of bounced) if (!d.bounced.includes(b)) d.bounced.push(b);
    pickPrimary(d);
  }
  pending = null;
  $('#import-file').value = '';
  $('#import-paste').value = '';
  showMapping();
  save();
  renderAll();
  toast(`Imported: ${added} new, ${merged} merged with existing${skipped ? `, ${skipped} empty rows skipped` : ''}.`);
}

/* ---------- templates ---------- */
function fill(text, d) {
  const c = state.campaign;
  const vals = {
    first_name: d?.firstName || 'there',
    last_name: d?.lastName || '',
    org_name: c.orgName || '[organization name]',
    cause: c.cause || '[what we’re raising for]',
    goal: c.goal ? money(c.goal) : '[goal]',
    date: c.date ? prettyDate(c.date) : '[date]',
    donation_link: c.donationLink || '[donation link]',
    sender_name: c.senderName || '[your name]',
  };
  return String(text).replace(/\{(\w+)\}/g, (m, k) => (k in vals ? vals[k] : m));
}

function sendable(d) {
  return !d.optOut && d.email && isEmail(d.email) && !(d.bounced || []).includes(d.email);
}

/* ---------- rendering ---------- */
function renderGroupSelects() {
  $('#import-group').innerHTML = GROUPS.map((g) => `<option>${g}</option>`).join('');
  const opts = `<option value="">All groups</option>` + GROUPS.map((g) => `<option>${g}</option>`).join('');
  for (const id of ['#donor-filter', '#o-group']) {
    const cur = $(id).value;
    $(id).innerHTML = opts;
    $(id).value = cur;
  }
}

function renderOverview() {
  const ds = state.donors;
  const reachable = ds.filter(sendable);
  const pre = ds.filter((d) => d.sent.pre).length;
  const day = ds.filter((d) => d.sent.dayOf).length;
  const givers = ds.filter((d) => Number(d.donation.amount) > 0);
  const raised = givers.reduce((s, d) => s + Number(d.donation.amount), 0);
  const stat = (label, value, note = '') => `<div class="card stat"><div class="label">${label}</div><div class="value">${value}</div>${note ? `<div class="muted small">${note}</div>` : ''}</div>`;
  $('#stats').innerHTML =
    stat('Contacts', ds.length, `${reachable.length} can be emailed`) +
    stat('Heads-up sent', pre, reachable.length ? `${Math.round((pre / reachable.length) * 100)}% of reachable` : '') +
    stat('Donate-today sent', day, reachable.length ? `${Math.round((day / reachable.length) * 100)}% of reachable` : '') +
    stat('Raised', money(raised) || '$0', `${givers.length} donor${givers.length === 1 ? '' : 's'}`);

  const goal = Number(state.campaign.goal) || 0;
  const pct = goal ? Math.min(100, (raised / goal) * 100) : 0;
  $('#progress').innerHTML = goal
    ? `<div class="bar"><div class="fill" style="width:${pct}%"></div></div><p><b>${money(raised) || '$0'}</b> of ${money(goal)} (${Math.round(pct)}%)</p>`
    : `<p class="muted">Set a goal on the Campaign tab to see progress.</p>`;

  const max = Math.max(1, ...GROUPS.map((g) => ds.filter((d) => d.tags.includes(g)).length));
  $('#by-group').innerHTML = GROUPS.map((g) => {
    const n = ds.filter((d) => d.tags.includes(g)).length;
    return `<div class="hbar"><span>${g}</span><div class="track"><div class="fill" style="width:${(n / max) * 100}%"></div></div><b>${n}</b></div>`;
  }).join('');

  const c = state.campaign;
  const items = [
    [ds.length > 0, 'Build the donor list: import alumni, officers, members, gala attendees and sponsors'],
    [!!(c.cause && c.goal && c.donationLink && c.senderName), 'Fill in campaign details: cause, goal, donation link, your name'],
    [reachable.length > 0 && pre >= reachable.length, `Send the heads-up email a few days before (${pre}/${reachable.length})`],
    [reachable.length > 0 && day >= reachable.length, `Send the donate-today email (${day}/${reachable.length})`],
    [givers.length > 0, 'Record donations as they come in'],
  ];
  $('#checklist').innerHTML = items.map(([done, t]) => `<li class="${done ? 'done' : ''}">${esc(t)}</li>`).join('');

  const days = c.date ? Math.ceil((new Date(c.date + 'T00:00:00') - new Date(today() + 'T00:00:00')) / 86400000) : null;
  $('#countdown').textContent = days == null ? '' : days > 0 ? `${prettyDate(c.date)} · ${days} day${days === 1 ? '' : 's'} to go` : days === 0 ? 'Today is Giving Tuesday!' : `${prettyDate(c.date)} · finished`;
}

function renderDonors() {
  const q = $('#donor-search').value.trim().toLowerCase();
  const g = $('#donor-filter').value;
  const list = state.donors
    .filter((d) => !g || d.tags.includes(g))
    .filter((d) => !q || [fullName(d), d.email, ...(d.altEmails || []), d.org, d.notes].join(' ').toLowerCase().includes(q))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
  $('#donor-count').textContent = state.donors.length;
  $('#donor-empty').classList.toggle('hidden', state.donors.length > 0);
  const tick = (v) => (v ? `<span class="ok" title="${esc(v)}">✓</span>` : '<span class="muted">–</span>');
  $('#donor-rows').innerHTML = list.map((d) => `
    <tr class="${d.optOut ? 'dim' : ''}">
      <td>${esc(fullName(d)) || '<span class="muted">(no name)</span>'}${d.gradYear ? ` <span class="muted small">’${esc(String(d.gradYear).slice(-2))}</span>` : ''}</td>
      <td>${d.email ? esc(d.email) : '<span class="warn">no email</span>'}${(d.bounced || []).includes(d.email) ? ' <span class="warn small">bounced</span>' : ''}${d.optOut ? ' <span class="warn small">opted out</span>' : ''}</td>
      <td>${d.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join(' ')}</td>
      <td>${tick(d.sent.pre)}</td>
      <td>${tick(d.sent.dayOf)}</td>
      <td>${money(d.donation.amount)}</td>
      <td><button class="link" data-edit="${d.id}">Edit</button></td>
    </tr>`).join('');
}

function renderCampaign() {
  for (const k of Object.keys(state.campaign)) {
    const el = $('#c-' + k);
    if (el && document.activeElement !== el) el.value = state.campaign[k];
  }
  for (const card of $$('[data-template]')) {
    const t = state.templates[card.dataset.template];
    const s = $('.t-subject', card), b = $('.t-body', card);
    if (document.activeElement !== s) s.value = t.subject;
    if (document.activeElement !== b) b.value = t.body;
  }
}

let previewId = null;
function outreachList() {
  const key = $('#o-template').value;
  const g = $('#o-group').value;
  const st = $('#o-status').value;
  return state.donors
    .filter(sendable)
    .filter((d) => !g || d.tags.includes(g))
    .filter((d) => (st === 'all' ? true : st === 'sent' ? !!d.sent[key] : !d.sent[key]))
    .sort((a, b) => fullName(a).localeCompare(fullName(b)));
}

function gmailUrl(d, key) {
  const t = state.templates[key];
  const p = new URLSearchParams({ view: 'cm', fs: '1', to: d.email, su: fill(t.subject, d), body: fill(t.body, d) });
  return 'https://mail.google.com/mail/?' + p.toString();
}

function renderOutreach() {
  const key = $('#o-template').value;
  const list = outreachList();
  const all = state.donors.filter(sendable);
  const unreachable = state.donors.length - all.length;
  $('#o-count').textContent = list.length;
  $('#o-summary').textContent = `${all.filter((d) => d.sent[key]).length} of ${all.length} reachable contacts have been sent this email.` +
    (unreachable ? ` ${unreachable} contact${unreachable === 1 ? '' : 's'} skipped (no email, bounced or opted out).` : '');
  $('#o-list').innerHTML = list.length ? list.map((d) => `
    <li class="${d.id === previewId ? 'active' : ''}" data-preview="${d.id}">
      <div><b>${esc(fullName(d)) || esc(d.email)}</b><div class="muted small">${esc(d.email)}</div></div>
      <div class="row">
        <a class="btn ghost small" href="${esc(gmailUrl(d, key))}" target="_blank" rel="noopener">Open in Gmail</a>
        <label class="check small"><input type="checkbox" data-sent="${d.id}" ${d.sent[key] ? 'checked' : ''}> Sent</label>
      </div>
    </li>`).join('') : '<li class="muted">Nobody here. Try another group or filter.</li>';

  const d = state.donors.find((x) => x.id === previewId) || null;
  const t = state.templates[key];
  $('#o-preview-for').textContent = d ? `For ${fullName(d) || d.email}` : 'Generic version (uses “Hi there”). Click a person to personalize.';
  $('#o-preview-subject').textContent = fill(t.subject, d);
  $('#o-preview-body').textContent = fill(t.body, d);
}

function renderAll() {
  renderOverview();
  renderDonors();
  renderCampaign();
  renderOutreach();
  window.renderOrgs?.();
}

/* ---------- donor dialog ---------- */
let editingId = null;
function openDonor(id) {
  const dlg = $('#donor-dialog');
  const f = $('#donor-form');
  const d = id ? state.donors.find((x) => x.id === id) : null;
  editingId = id;
  $('#donor-dialog-title').textContent = d ? 'Edit contact' : 'Add contact';
  $('#donor-delete').classList.toggle('hidden', !d);
  f.firstName.value = d?.firstName || '';
  f.lastName.value = d?.lastName || '';
  f.email.value = d?.email || '';
  f.phone.value = d?.phone || '';
  f.org.value = d?.org || '';
  f.preSent.value = d?.sent.pre || '';
  f.dayOfSent.value = d?.sent.dayOf || '';
  f.donationAmount.value = d?.donation.amount || '';
  f.donationDate.value = d?.donation.date || '';
  f.notes.value = [d?.notes, d?.altEmails?.length ? `Other emails: ${d.altEmails.join(', ')}` : ''].filter(Boolean).join('\n').trim();
  f.notes.dataset.alt = d?.altEmails?.length ? `Other emails: ${d.altEmails.join(', ')}` : '';
  f.optOut.checked = !!d?.optOut;
  $('#dialog-tags').innerHTML = GROUPS.map((g) => `<label class="check"><input type="checkbox" value="${g}" ${d?.tags.includes(g) ? 'checked' : ''}> ${g}</label>`).join('');
  dlg.showModal();
}

function saveDonor() {
  const f = $('#donor-form');
  let d = state.donors.find((x) => x.id === editingId);
  if (!d) {
    d = { id: uid(), altEmails: [], bounced: [], gradYear: '', tags: [], sent: { pre: '', dayOf: '' }, donation: { amount: '', date: '' } };
    state.donors.push(d);
  }
  const altLine = f.notes.dataset.alt;
  d.firstName = f.firstName.value.trim();
  d.lastName = f.lastName.value.trim();
  const newEmail = normEmail(f.email.value);
  if (newEmail !== d.email) d.bounced = (d.bounced || []).filter((e) => e !== newEmail);
  d.email = newEmail;
  d.altEmails = (d.altEmails || []).filter((e) => e !== newEmail);
  d.phone = f.phone.value.trim();
  d.org = f.org.value.trim();
  d.sent.pre = f.preSent.value;
  d.sent.dayOf = f.dayOfSent.value;
  d.donation.amount = f.donationAmount.value;
  d.donation.date = f.donationDate.value || (f.donationAmount.value && !d.donation.date ? today() : d.donation.date);
  d.notes = (altLine ? f.notes.value.replace(altLine, '') : f.notes.value).trim();
  d.optOut = f.optOut.checked;
  d.tags = $$('#dialog-tags input:checked').map((i) => i.value);
  save();
  renderAll();
  toast('Saved.');
}

/* ---------- events ---------- */
function bind() {
  $$('.tabs button').forEach((b) => b.addEventListener('click', () => {
    $$('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
    $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + b.dataset.tab));
    renderAll();
  }));

  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      if (/\.xlsx$/i.test(file.name)) {
        const sheets = (await readXlsx(await file.arrayBuffer())).filter((s) => s.rows.length);
        if (!sheets.length) return toast('No data found in that spreadsheet.');
        setPending(sheets[0].rows, sheets, 0);
      } else {
        setPending(parseCSV(await file.text()));
      }
    } catch (err) {
      console.error(err);
      toast('Could not read that file. Try saving it as CSV.');
    }
  });
  $('#paste-toggle').addEventListener('click', () => $('#import-paste').classList.toggle('hidden'));
  $('#import-paste').addEventListener('input', (e) => {
    clearTimeout(bind._p);
    bind._p = setTimeout(() => e.target.value.trim() && setPending(parseCSV(e.target.value)), 400);
  });
  $('#import-group').addEventListener('change', () => pending && showMapping());

  $('#donor-search').addEventListener('input', renderDonors);
  $('#donor-filter').addEventListener('change', renderDonors);
  $('#add-donor').addEventListener('click', () => openDonor(null));
  $('#donor-rows').addEventListener('click', (e) => {
    const id = e.target.dataset.edit;
    if (id) openDonor(id);
  });
  $('#donor-form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'save') saveDonor();
  });
  $('#donor-delete').addEventListener('click', () => {
    const d = state.donors.find((x) => x.id === editingId);
    if (d && confirm(`Delete ${fullName(d) || d.email}? This can't be undone.`)) {
      state.donors = state.donors.filter((x) => x.id !== editingId);
      $('#donor-dialog').close();
      save();
      renderAll();
    }
  });
  $('#export-csv').addEventListener('click', () => {
    const rows = [['First Name', 'Last Name', 'Email', 'Other Emails', 'Groups', 'Grad Year', 'Organization', 'Phone', 'Heads-up Sent', 'Donate-today Sent', 'Donation Amount', 'Donation Date', 'Opted Out', 'Bounced Emails', 'Notes']];
    for (const d of state.donors) rows.push([d.firstName, d.lastName, d.email, (d.altEmails || []).join('; '), d.tags.join('; '), d.gradYear, d.org, d.phone, d.sent.pre, d.sent.dayOf, d.donation.amount, d.donation.date, d.optOut ? 'yes' : '', (d.bounced || []).join('; '), d.notes]);
    downloadFile('giving-tuesday-donor-list.csv', toCSV(rows));
  });

  for (const k of Object.keys(state.campaign)) {
    $('#c-' + k)?.addEventListener('input', (e) => { state.campaign[k] = e.target.value; save(); renderOverview(); });
  }
  for (const card of $$('[data-template]')) {
    const key = card.dataset.template;
    $('.t-subject', card).addEventListener('input', (e) => { state.templates[key].subject = e.target.value; save(); });
    $('.t-body', card).addEventListener('input', (e) => { state.templates[key].body = e.target.value; save(); });
  }
  $('#reset-templates').addEventListener('click', () => {
    if (!confirm('Replace both emails with the default wording?')) return;
    state.templates = JSON.parse(JSON.stringify(DEFAULT_TEMPLATES));
    save();
    renderCampaign();
  });

  for (const id of ['#o-template', '#o-group', '#o-status']) $(id).addEventListener('change', renderOutreach);
  $('#o-list').addEventListener('click', (e) => {
    const box = e.target.closest('[data-sent]');
    if (box) {
      const d = state.donors.find((x) => x.id === box.dataset.sent);
      d.sent[$('#o-template').value] = box.checked ? today() : '';
      save();
      renderOverview();
      renderDonors();
      return;
    }
    if (e.target.closest('a')) return;
    const li = e.target.closest('[data-preview]');
    if (li) { previewId = li.dataset.preview; renderOutreach(); }
  });
  $('#o-copy-bcc').addEventListener('click', async () => {
    const list = outreachList();
    if (!list.length) return toast('No recipients to copy.');
    await copyText(list.map((d) => d.email).join(', '));
    toast(`Copied ${list.length} email address${list.length === 1 ? '' : 'es'}. Paste them into BCC.`);
  });
  $('#o-mailmerge').addEventListener('click', () => {
    const key = $('#o-template').value;
    const t = state.templates[key];
    const list = outreachList();
    if (!list.length) return toast('No recipients to export.');
    const rows = [['Email', 'First Name', 'Last Name', 'Groups', 'Subject', 'Body']];
    for (const d of list) rows.push([d.email, d.firstName || 'there', d.lastName, d.tags.join('; '), fill(t.subject, d), fill(t.body, d)]);
    downloadFile(`mail-merge-${key === 'pre' ? 'heads-up' : 'donate-today'}.csv`, toCSV(rows));
  });
  $('#o-mark-all').addEventListener('click', () => {
    const key = $('#o-template').value;
    const list = outreachList().filter((d) => !d.sent[key]);
    if (!list.length) return toast('Everyone shown is already marked as sent.');
    if (!confirm(`Mark ${list.length} people as sent for this email?`)) return;
    for (const d of list) d.sent[key] = today();
    save();
    renderAll();
  });
  $('#o-copy-preview').addEventListener('click', async () => {
    await copyText($('#o-preview-subject').textContent + '\n\n' + $('#o-preview-body').textContent);
    toast('Copied subject and body.');
  });
}

(async function init() {
  renderGroupSelects();
  await load();
  await window.initOrgs?.();
  bind();
  renderAll();
})();
