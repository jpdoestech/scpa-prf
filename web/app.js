import { config, supabase, context, adminAccounts, dashboard, record, submit, decide, setDemoRole, currentDemoRole, pageSize } from './data.js';
import { statuses, services, assignments, requisitions, canDecide, nextActor, eventTitle, day, dateTime } from './model.js';
import { preparePrint } from './print.js';

const app = document.querySelector('#app');
const paths = {
  list: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6m-6 4h6m-6 4h4"/>',
  inbox: '<path d="M4 12 7 5h10l3 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 12h5l1 3h4l1-3h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  archive: '<rect x="4" y="5" width="16" height="4" rx="1"/><path d="M6 9v10h12V9m-8 4h4"/>',
  print: '<path d="M7 8V4h10v4M7 16H4V9h16v7h-3m-10-2h10v6H7zM16 11h1"/>',
  exit: '<path d="M10 5H5v14h5m3-3 4-4-4-4m-4 4h8"/>',
};
const icon = key => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const logo = `<div class="brand"><img src="./assets/scpa-logo.png" alt="SCPA" width="67" height="27"><div><strong>Personnel Requests</strong><small>Human Resources</small></div></div>`;
const button = (name, label, style = 'secondary', glyph = '', attrs = '') =>
  `<button class="button ${style}" type="button" data-action="${name}" ${attrs}>${glyph ? icon(glyph) : ''}${label}</button>`;
const badge = status => `<span class="badge ${escape(status)}">${escape(statuses[status])}</span>`;
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');

let person;
let screen = 'requests';
let result;
let detail;
let edit;
let page = 0;
let filter = '';
let search = '';
let listRevision = 0;
let routeRevision = 0;
let busy = false;
let pendingId;
let paper = 'A4';
let searchTimer;

function banner(message = '', error = false) {
  const region = document.querySelector('#notice');
  if (!region) return;
  region.textContent = message;
  region.className = `notice${error ? ' error' : ''}`;
  region.hidden = !message;
}
function markBusy(value) {
  busy = value;
  for (const node of app.querySelectorAll('[data-mutation]')) node.disabled = value;
}

function renderLogin(message = '', error = false, inactive = false) {
  app.setAttribute('aria-busy', 'false');
  app.innerHTML = `<div class="login"><article class="panel">
    ${logo}
    <h1>${inactive ? 'Employee access required' : 'Sign in'}</h1>
    <p class="muted">${inactive ? 'Ask your PRF administrator to activate your employee profile.' : 'Sign in with the email and password for your PRF account.'}</p>
    <div id="notice" class="notice" role="status" hidden></div>
    ${inactive ? button('signout', 'Sign out', 'secondary', 'exit', 'style="margin-top:1rem"') :
      `<form id="login-form">
        <label class="field">Email<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
        <button class="button primary" data-mutation>Sign in</button>
        <p class="muted small">For account access or a password reset, contact your PRF administrator.</p>
      </form>`}
  </article></div>`;
  banner(message, error);
}

function renderFrame(content) {
  app.setAttribute('aria-busy', 'false');
  const nav = (name, label, glyph) => `<button data-action="${name}" ${screen === name ? 'aria-current="page"' : ''}>${icon(glyph)}${label}</button>`;
  app.innerHTML = `<div class="frame"><aside class="sidebar">${logo}
    <nav class="nav" aria-label="Main navigation">${person.adminOnly ? '' : `${nav('requests', 'My requests', 'list')}
      ${person.approver ? nav('inbox', 'Approval inbox', 'inbox') : ''}
      ${nav('new', 'New request', 'plus')}`}
      ${person.superAdmin ? nav('admin', 'User administration', 'list') : ''}</nav>
  </aside><div class="page">
    <header class="page-top"><div class="account">
      ${config.demo ? `<span class="demo-tag">Demo</span><select id="demo-role" aria-label="Demo role">
        ${Object.entries({ employee: 'Employee view', supervisor: 'Supervisor view', hrd: 'HRD view' })
          .map(([key, label]) => `<option value="${key}" ${key === currentDemoRole() ? 'selected' : ''}>${label}</option>`).join('')}
      </select>` : `<span class="avatar" aria-hidden="true">${escape(initials(person.name))}</span>
        <span>${escape(person.name)}</span>${button('signout', 'Sign out', 'ghost', 'exit')}`}
    </div></header>
    <div id="notice" role="status" class="notice" hidden></div>
    ${content}
  </div></div>`;
}

const groups = [['Total requests', 'list'], ['In review', 'clock'], ['Approved', 'check'], ['Returned / disapproved', 'archive']];
const statusOptions = { '': 'All statuses', active: 'In review', ...statuses };
function listView() {
  const inbox = screen === 'inbox';
  renderFrame(`<div class="heading">
    <div><h1>${inbox ? 'Approval inbox' : 'My requests'}</h1>
      <p>${inbox ? 'Review requests waiting for your decision.' : 'Submit and track your personnel requisitions.'}</p></div>
    ${button('new', 'New request', 'primary', 'plus')}
    </div>
    ${inbox ? '' : `<section class="stats" aria-label="Request summary">${groups.map(([label, glyph], i) =>
      `<div class="stat"><span class="stat-icon">${icon(glyph)}</span><strong id="count-${i}">–</strong><span>${label}</span></div>`).join('')}</section>`}
    <section class="panel" aria-labelledby="requests-heading">
      <header class="panel-header"><h2 id="requests-heading">${inbox ? 'Assigned requests' : 'Request history'}</h2>
      <div class="filters"><label class="search">${icon('search')}<input id="search" type="search" maxlength="80" aria-label="Search requests" placeholder="Search requests" value="${escape(search)}"></label>
      ${inbox ? `<select id="filter" aria-label="Approval inbox view">
        <option value="">Awaiting my decision</option><option value="assigned">All assigned requests</option>
      </select>` : `<select id="filter" aria-label="Filter by status">${Object.entries(statusOptions).map(([v, l]) =>
        `<option value="${v}" ${v === filter ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      </div></header>
      <div id="request-list" aria-live="polite"><p class="empty">Loading requests…</p></div>
    </section>`);
}

function renderList() {
  const target = document.querySelector('#request-list');
  if (!target || !result) return;
  result.counts.forEach((count, i) => {
    const el = document.getElementById(`count-${i}`);
    if (el) el.textContent = count ?? '–';
  });
  if (!result.rows.length) {
    target.innerHTML = `<p class="empty">${search || (filter && filter !== 'assigned') ? 'No requests match these filters.' :
      screen === 'inbox' ? (filter === 'assigned' ? 'No requests are assigned to you.' : 'No requests are waiting for your decision.') : 'You haven’t submitted a request yet.'}</p>`;
    return;
  }
  target.innerHTML = `<div class="list-head" aria-hidden="true"><span>PRF number</span><span>Position</span><span>Date needed</span><span>Status</span></div>
    <ul class="requests">${result.rows.map(r => `<li><button type="button" class="request-row" data-action="record" data-id="${escape(r.id)}">
      <span class="record-number">${escape(r.number)}</span>
      <span><strong>${escape(r.form.position)}</strong><span class="muted small">${escape(screen === 'inbox' ? r.requester_name : r.form.area)}</span></span>
      <span class="due">${escape(day(r.form.needed))}</span>${badge(r.status)}
    </button></li>`).join('')}</ul>
    ${result.total > pageSize ? `<div class="pagination"><span class="muted small">Showing ${page * pageSize + 1}–${page * pageSize + result.rows.length} of ${result.total}</span>
      <div class="actions">${button('previous', 'Previous', 'secondary', '', page === 0 ? 'disabled' : '')}
      ${button('next', 'Next', 'secondary', '', (page + 1) * pageSize >= result.total ? 'disabled' : '')}</div></div>` : ''}`;
}

async function refreshList() {
  const revision = ++listRevision;
  try {
    const next = await dashboard({ mode: screen, id: person.id, status: filter, search, page });
    if (revision !== listRevision || !['inbox', 'requests'].includes(screen)) return;
    if (!next.rows.length && page > 0 && next.total > 0) {
      page = Math.floor((next.total - 1) / pageSize);
      return refreshList();
    }
    result = next;
    renderList();
  } catch (err) {
    if (revision !== listRevision) return;
    const target = document.querySelector('#request-list');
    if (target) target.innerHTML = '<p class="empty">Unable to load requests.</p>';
    banner(err.message, true);
  }
}

function goList(mode = 'requests') {
  ++routeRevision;
  clearTimeout(searchTimer);
  screen = mode;
  page = 0;
  filter = '';
  search = '';
  detail = null;
  listView();
  window.scrollTo(0, 0);
  return refreshList();
}

const field = (name, label, html, opts = '') =>
  `<label class="field ${opts}" id="field-${name}">${label}${html}</label>`;

async function openAdmin() {
  const revision = ++routeRevision;
  screen = 'admin';
  renderFrame('<div class="heading"><h1>User administration</h1></div><p role="status">Loading approvers…</p>');
  try {
    const { approvers } = await adminAccounts();
    if (revision !== routeRevision) return;
    const approver = (name, label, role) => field(name, label, `<select name="${name}">
      <option value="">Choose an approver</option>
      ${approvers.filter(p => p.account_role === role).map(p =>
        `<option value="${escape(p.id)}">${escape(p.name)}</option>`).join('')}
    </select>`);
    renderFrame(`<div class="heading"><div><h1>User administration</h1>
      <p>Create the supervisor and HRD accounts first, then assign them to employees.</p></div></div>
      <section class="panel panel-content"><h2>Create account</h2>
      <form id="admin-form" class="sheet"><div class="field-grid">
        ${field('account-name', 'Full name', '<input name="name" maxlength="100" required>')}
        ${field('account-email', 'Email', '<input type="email" name="email" maxlength="254" autocomplete="off" required>')}
        ${field('account-branch', 'Branch or office', '<input name="branch" maxlength="100" required>')}
        ${field('account-role', 'Role', `<select name="role" required>
          <option value="">Choose a role</option><option value="supervisor">Supervisor</option>
          <option value="hrd">HRD approver</option><option value="employee">Employee</option>
          <option value="other">Other staff</option></select>`)}
        ${approver('supervisor_id', 'Assigned supervisor', 'supervisor')}
        ${approver('hrd_id', 'Assigned HRD approver', 'hrd')}
        ${field('account-password', 'Initial password', '<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="72" required><small>Use at least 12 characters. Give this password to the user privately.</small>', 'wide')}
      </div><div class="actions"><button class="button primary" data-mutation>Create account</button></div></form></section>`);
  } catch (err) {
    if (revision === routeRevision) {
      renderFrame('<div class="heading"><h1>User administration</h1></div>' + button('admin', 'Try again'));
      banner(err.message, true);
    }
  }
}

function formView() {
  const values = edit?.form ?? {};
  const val = name => escape(values[name]);
  const input = (name, label, type, options, opts) =>
    field(name, label, `<input name="${name}" type="${type}" value="${val(name)}" ${options}>`, opts);
  const select = (name, label, options) => field(name, label, `<select name="${name}" required>
    <option value="">Select an option</option>${Object.entries(options).map(([key, value]) =>
      `<option value="${key}" ${values[name] === key ? 'selected' : ''}>${value}</option>`).join('')}</select>`);
  const textarea = (name, label, max, rows = 2) =>
    field(name, label, `<textarea name="${name}" maxlength="${max}" rows="${rows}">${val(name)}</textarea>`, 'wide');

  renderFrame(`${button('back', 'Back to requests', 'ghost back')}
    <div class="heading"><div><h1>${edit ? 'Revise request' : 'New request'}</h1>
      <p>${escape(person.name)} · ${escape(edit?.branch_name ?? person.branch)}</p></div></div>
    <form id="request-form" class="sheet">
      <section class="panel form-section"><h2>Personnel needed</h2><div class="field-grid">
        ${input('position', 'Position title', 'text', 'maxlength="100" required')}
        ${input('area', 'Assigned area / store', 'text', 'maxlength="100" required')}
        ${input('needed', 'Date needed', 'date', 'required')}
        ${input('headcount', 'Number of personnel', 'number', 'inputmode="numeric" min="1" max="9999" step="1" required')}
      </div></section>
      <section class="panel form-section"><h2>Assignment</h2><div class="field-grid">
        ${select('service', 'Service time frame', services)}
        ${select('assignment', 'Work assignment', assignments)}
        ${input('service_other', 'Specify service time frame', 'text', 'maxlength="120"', 'wide')}
        ${input('schedule', 'Work schedule', 'text', 'maxlength="120" placeholder="e.g., Monday to Saturday, 8 AM–5 PM" required', 'wide')}
      </div></section>
      <section class="panel form-section"><h2>Requisition details</h2><div class="field-grid">
        ${select('requisition', 'Requisition type', requisitions)}
        ${textarea('reason', '<span id="reason-label">Reason / details</span>', 500)}
        ${textarea('qualifications', 'Qualifications (optional)', 650)}
        ${input('salary', 'Proposed monthly / daily salary (optional)', 'text', 'maxlength="36" placeholder="e.g., ₱18,000 / month"')}
        ${input('allowance', 'Allowance (optional)', 'text', 'maxlength="40"')}
      </div></section>
      <div class="actions"><button class="button primary" data-mutation>${edit ? 'Resubmit to supervisor' : 'Submit to supervisor'}</button>
      ${button('back', 'Cancel')}</div>
    </form>`);
  conditionalFields();
  window.scrollTo(0, 0);
}

function conditionalFields() {
  const form = document.getElementById('request-form');
  if (!form) return;
  const isOther = form.elements.service.value === 'other';
  document.getElementById('field-service_other').hidden = !isOther;
  form.elements.service_other.required = isOther;
  form.elements.service_other.disabled = !isOther;
  const reasonLabel = {
    replacement: 'Employee to be replaced and reason',
    additional: 'Reason for additional personnel',
    other: 'Specify requisition details',
  }[form.elements.requisition.value];
  document.getElementById('field-reason').hidden = !reasonLabel;
  document.getElementById('reason-label').textContent = reasonLabel ?? '';
  form.elements.reason.required = Boolean(reasonLabel);
  form.elements.reason.disabled = !reasonLabel;
}

function detailView() {
  const { row: r, events } = detail;
  const f = r.form;
  const fieldEntry = (label, value, wide = false) => value ?
    `<div ${wide ? 'class="wide"' : ''}><dt>${label}</dt><dd>${escape(value)}</dd></div>` : '';
  const next = nextActor(r);
  const decision = canDecide(r, person.id);
  const mayEdit = r.requester_id === person.id && r.status === 'returned';
  renderFrame(`${button('back', screenOrigin === 'inbox' ? 'Back to approval inbox' : 'Back to requests', 'ghost back')}
    <div class="heading"><div><p>${escape(r.number)}</p><h1>${escape(f.position)}</h1>
      <div class="status-line">${badge(r.status)}${next ? `<span class="muted">Next action by ${escape(next)}</span>` : ''}</div></div>
      <div class="actions"><div class="print-choice"><select id="paper" aria-label="Paper size">
        <option ${paper === 'A4' ? 'selected' : ''}>A4</option><option ${paper === 'Letter' ? 'selected' : ''}>Letter</option>
      </select>${button('print', 'Print PRF', 'secondary', 'print', 'data-mutation')}</div>
      ${mayEdit ? button('revise', 'Revise request', 'primary') : ''}</div>
    </div>
    <div class="detail-layout">
      <section class="panel panel-content"><h2>Request details</h2><dl class="details">
        ${fieldEntry('Requested by', r.requester_name)}${fieldEntry('Branch / office', r.branch_name)}
        ${fieldEntry('Assigned area / store', f.area)}${fieldEntry('Headcount', f.headcount)}
        ${fieldEntry('Date requested', day(r.submitted_at))}${fieldEntry('Date needed', day(f.needed))}
        ${fieldEntry('Service time frame', f.service_other || services[f.service])}
        ${fieldEntry('Work assignment', assignments[f.assignment])}
        ${fieldEntry('Requisition type', requisitions[f.requisition])}${fieldEntry('Work schedule', f.schedule)}
        ${fieldEntry('Requisition details', f.reason, true)}${fieldEntry('Qualifications', f.qualifications, true)}
        ${fieldEntry('Proposed salary', f.salary)}${fieldEntry('Allowance', f.allowance)}
      </dl></section>
      <section class="panel panel-content"><h2>Request timeline</h2>
      <ol class="timeline">${events.map(e => `<li><strong>${escape(eventTitle(e))}</strong>
        <p class="muted small">${escape(e.actor_name)} · ${escape(dateTime(e.occurred_at))}</p>
        ${e.note ? `<p>${escape(e.note)}</p>` : ''}</li>`).join('')}</ol></section>
    </div>
    ${decision ? `<section class="panel panel-content decision"><h2>Review request</h2>
      <form id="decision-form" class="decision">
        <div class="field-grid"><label class="field">Decision<select name="decision" required>
          <option value="">Choose a decision</option><option value="approve">Approve</option>
          <option value="return">Return for correction</option><option value="disapprove">Disapprove</option>
        </select></label>
        <label class="field wide">Comments<textarea name="note" maxlength="800" rows="3"></textarea>
          <small>Enter a reason when returning or disapproving the request.</small></label></div>
        <div class="actions"><button class="button primary" data-mutation>Record decision</button></div>
      </form></section>` : ''}`);
}

let screenOrigin = 'requests';
async function openRecord(id, origin = screenOrigin, message = '') {
  const token = ++routeRevision;
  clearTimeout(searchTimer);
  screen = 'detail';
  screenOrigin = origin;
  if (!detail || detail.row.id !== id) {
    renderFrame('<p class="empty" role="status">Loading request…</p>');
    window.scrollTo(0, 0);
  }
  try {
    const next = await record(id);
    if (token !== routeRevision) return;
    detail = next;
    detailView();
    banner(message);
  } catch (err) {
    if (token !== routeRevision) return;
    renderFrame(`${button('back', 'Back to requests', 'ghost back')}<h1>Request unavailable</h1>`);
    banner(err.message, true);
  }
}

function startRequest(row = null) {
  ++routeRevision;
  clearTimeout(searchTimer);
  screen = 'new';
  edit = row;
  pendingId = row?.id ?? crypto.randomUUID();
  formView();
}

async function start() {
  if (supabase) {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      renderLogin(error?.message, Boolean(error));
      return;
    }
  }
  try {
    const profile = await context();
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    const superAdmin = Boolean(user?.email_confirmed_at && user.app_metadata.prf_super_admin === true);
    person = profile ? { ...profile, superAdmin } : superAdmin
      ? { id: user.id, name: 'PRF super admin', superAdmin, adminOnly: true } : null;
    if (!person) return renderLogin('', false, true);
    if (person.adminOnly) return openAdmin();
    const id = new URL(location.href).searchParams.get('request');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) await openRecord(id, 'requests');
    else await goList();
  } catch (err) {
    renderLogin(err.message, true, true);
  }
}

app.addEventListener('change', async e => {
  const target = e.target;
  if (target.id === 'demo-role') {
    setDemoRole(target.value);
    person = await context();
    await goList(person.approver ? 'inbox' : 'requests');
  } else if (target.id === 'filter') {
    filter = target.value;
    page = 0;
    await refreshList();
  } else if (target.id === 'paper') {
    paper = target.value;
  } else if (target.name === 'service' || target.name === 'requisition') {
    conditionalFields();
  } else if (target.name === 'decision') {
    target.form.elements.note.required = ['return', 'disapprove'].includes(target.value);
  } else if (target.name === 'role' && target.form?.id === 'admin-form') {
    target.form.elements.supervisor_id.required = target.value === 'employee';
    target.form.elements.hrd_id.required = target.value === 'employee';
  }
});
app.addEventListener('input', e => {
  if (e.target.id !== 'search') return;
  search = e.target.value.trim();
  page = 0;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshList, 220);
});
app.addEventListener('click', async e => {
  const target = e.target.closest('button[data-action]');
  if (!target || busy) return;
  const { action, id } = target.dataset;
  if (action === 'admin' && person?.superAdmin) {
    await openAdmin();
  } else if (action === 'requests' || action === 'inbox') {
    await goList(action);
  } else if (action === 'new') {
    screenOrigin = screen === 'inbox' ? 'inbox' : 'requests';
    startRequest();
  } else if (action === 'revise') {
    startRequest(detail.row);
  } else if (action === 'back') {
    if (screen === 'new' && edit) await openRecord(edit.id);
    else await goList(screenOrigin === 'inbox' && person.approver ? 'inbox' : 'requests');
  } else if (action === 'record') {
    await openRecord(id, screen);
  } else if (action === 'previous' || action === 'next') {
    page = Math.max(0, page + (action === 'next' ? 1 : -1));
    await refreshList();
  } else if (action === 'signout') {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return banner(error.message, true);
    ++routeRevision;
    person = null;
    detail = null;
    edit = null;
    renderLogin();
  } else if (action === 'print') {
    try {
      markBusy(true);
      await preparePrint(detail.row, paper);
      window.print();
    } catch (err) {
      banner(`Could not prepare the printout. ${err.message}`, true);
    } finally {
      markBusy(false);
    }
  }
});
window.addEventListener('afterprint', () => {
  document.body.classList.remove('print-ready');
  document.querySelector('#print-root').replaceChildren();
});
app.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const values = Object.fromEntries(new FormData(form));
  markBusy(true);
  banner();
  try {
    if (form.id === 'login-form') {
      const email = values.email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email, password: values.password });
      if (error) throw error;
      await start();
    } else if (form.id === 'admin-form' && person?.superAdmin) {
      const account = await adminAccounts(values);
      await openAdmin();
      banner(`Account created for ${account.email}.`);
    } else if (form.id === 'request-form') {
      const row = await submit({ id: pendingId, form: values, version: edit?.version });
      await openRecord(row.id, screenOrigin, edit ? 'Request resubmitted to the supervisor.' : 'Request submitted to the supervisor.');
    } else if (form.id === 'decision-form') {
      const row = await decide({ id: detail.row.id, version: detail.row.version, decision: values.decision, note: values.note });
      await openRecord(row.id, screenOrigin, 'Decision recorded.');
    }
  } catch (err) {
    banner(err.message, true);
    document.getElementById('notice')?.scrollIntoView({ block: 'nearest' });
  } finally {
    markBusy(false);
  }
});

start();
