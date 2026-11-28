import {
  config, supabase, context, adminAccounts, dashboard, pendingApprovals, record, requestOptions,
  optionDirectory, editRequestOption, addRequestOption, submit, decide, setDemoRole, currentDemoRole,
  pageSize, saveOwnName, updateOwnPassword, loadOwnPhoto, saveOwnPhoto, employeeDirectory, saveEmployeeBranches,
} from './data.js';
import { statuses, services, assignments, requisitions, canDecide, nextActor, eventTitle, day, dateTime, approvalTime, prfNumber } from './model.js';
import { preparePrintImage, drawPrintImage, preparePrint, stampPrint } from './print.js';
import { enhanceSelects, focusSelect } from './search-select.js';

const app = document.querySelector('#app');
const paths = {
  list: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 9h6m-6 4h6m-6 4h4"/>',
  users: '<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2m2-15a3 3 0 0 1 0 6m4 9v-2a6 6 0 0 0-3-5"/>',
  inbox: '<path d="M4 12 7 5h10l3 7v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M4 12h5l1 3h4l1-3h5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="5.5"/><path d="m15 15 4 4"/>',
  clock: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5l3 2"/>',
  check: '<circle cx="12" cy="12" r="8"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  archive: '<rect x="4" y="5" width="16" height="4" rx="1"/><path d="M6 9v10h12V9m-8 4h4"/>',
  print: '<path d="M7 8V4h10v4M7 16H4V9h16v7h-3m-10-2h10v6H7zM16 11h1"/>',
  exit: '<path d="M10 5H5v14h5m3-3 4-4-4-4m-4 4h8"/>',
  enter: '<path d="M14 5h5v14h-5m-3-11 4 4-4 4m4-4H5"/>',
  back: '<path d="m11 6-6 6 6 6M5 12h14"/>',
  previous: '<path d="m14 6-6 6 6 6"/>',
  next: '<path d="m10 6 6 6-6 6"/>',
  open: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  compact: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M4 14h16"/>',
  edit: '<path d="m4 16-1 5 5-1L20 8l-4-4L4 16Zm9-9 4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  retry: '<path d="M4 11a8 8 0 1 1 2 6M4 5v6h6"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v2"/>',
  send: '<path d="m3 4 18 8-18 8 3-8-3-8Zm3 8h15"/>',
  image: '<rect x="4" y="4" width="16" height="16" rx="2"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 3 3 3-4 5 5"/>',
  up: '<path d="M12 20V5m-6 6 6-6 6 6"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M5 16v4h14v-4"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
};
const icon = key => `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[key]}</svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const logo = `<div class="brand"><img src="./assets/scpa-logo.png" alt="SCPA" width="106" height="42"><strong>Personnel Request</strong></div>`;
const button = (name, label, style, glyph, attrs = '') =>
  `<button class="button ${style}" type="button" data-action="${name}" ${attrs}>${icon(glyph)}${label}</button>`;
const backButton = (action, label) => button(action, label, 'secondary back', 'back');
const submitButton = (label, glyph, style = 'primary') =>
  `<button class="button ${style}" type="submit" data-mutation>${icon(glyph)}${label}</button>`;
const badge = status => `<span class="badge ${escape(status)}">${escape(statuses[status])}</span>`;
const initials = name => name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toUpperCase()).join('');

let person;
let accountUser;
let avatarUrl;
let profileReturn;
let screen = 'requests';
let result;
let detail;
let edit;
let page = 0;
let filter = '';
let inboxStatus = '';
let search = '';
let listRevision = 0;
let routeRevision = 0;
let busy = false;
let pendingId;
let paper = 'A4';
let searchTimer;
let requestListReturn;
const optionKinds = { branch: 'Branch', position: 'Position title', area: 'Assigned area' };
let optionKind = 'branch';
let optionOrigin;
const printPreview = document.getElementById('print-preview');
let printReturn;
const canCopyImage = Boolean(navigator.clipboard?.write && window.ClipboardItem);
let approvalCount = 0;
let approvalRevision = 0;
let approvalLoading = false;
const pageSizes = [pageSize, 25, 50, 100];
let rowsPerPage = pageSize;
let compact = true;
try {
  const saved = Number(localStorage.getItem('prf-rows-per-page'));
  if (pageSizes.includes(saved)) rowsPerPage = saved;
  compact = localStorage.getItem('prf-table-density') !== 'comfortable';
} catch { /* Browser preferences are optional. */ }

function saveViewPreference(key, value) {
  try { localStorage.setItem(key, value); } catch { /* Keep the setting for this session. */ }
}

const avatarImage = () => avatarUrl ? `<img alt="" src="${escape(avatarUrl)}">` : escape(initials(person.name));

function refreshProfileHeader() {
  for (const avatar of app.querySelectorAll('[data-own-avatar]')) avatar.innerHTML = avatarImage();
  for (const label of app.querySelectorAll('[data-own-name]')) label.textContent = person.name;
}

function setProfilePhoto(photo) {
  if (avatarUrl) URL.revokeObjectURL(avatarUrl);
  avatarUrl = photo ? URL.createObjectURL(photo) : undefined;
  if (person) refreshProfileHeader();
}

const adminDisplayName = () => {
  const name = accountUser?.user_metadata?.prf_display_name;
  return typeof name === 'string' && name.trim() ? name.trim().slice(0, 100) : 'PRF super admin';
};

function renderApprovalCount() {
  const badge = document.getElementById('pending-approval-count');
  if (!badge) return;
  const message = approvalCount === 1 ? '1 request awaiting your approval' : `${approvalCount} requests awaiting your approval`;
  const summary = document.getElementById('pending-approval-summary');
  if (summary.textContent === message) return;
  badge.hidden = !approvalCount;
  badge.textContent = approvalCount || '';
  summary.textContent = message;
}

function resetApprovalCount() {
  ++approvalRevision;
  approvalLoading = false;
  approvalCount = 0;
}

async function refreshApprovalCount(force = false) {
  if (document.hidden || !person?.approver || (approvalLoading && !force)) return;
  const revision = ++approvalRevision;
  approvalLoading = true;
  try {
    const count = await pendingApprovals(person.id);
    if (revision !== approvalRevision) return;
    approvalCount = count ?? 0;
    renderApprovalCount();
  } catch { /* Retry on the next scheduled refresh. */ }
  finally { if (revision === approvalRevision) approvalLoading = false; }
}

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
  app.innerHTML = `<div class="login"><div class="login-shell"><div class="login-masthead">${logo}</div><article>
    <h1>${inactive ? 'Employee access required' : 'Sign in'}</h1>
    <p class="muted">${inactive ? 'Ask your PRF administrator to activate your employee profile.' : 'Sign in with the email and password for your PRF account.'}</p>
    <div id="notice" class="notice" role="status" hidden></div>
    ${inactive ? button('signout', 'Sign out', 'secondary', 'exit', 'style="margin-top:1rem"') :
      `<form id="login-form">
        <label class="field">Email<input type="email" name="email" autocomplete="username" required></label>
        <label class="field">Password<input type="password" name="password" autocomplete="current-password" required></label>
        ${submitButton('Sign in', 'enter')}
        <p class="muted small">For account access or a password reset, contact your PRF administrator.</p>
      </form>`}
  </article></div></div>`;
  banner(message, error);
}

function renderFrame(content) {
  app.setAttribute('aria-busy', 'false');
  const section = ['detail', 'new'].includes(screen) ? screenOrigin : screen === 'options' ? optionOrigin?.mode : screen;
  const nav = (name, label, glyph) => `<button data-action="${name}" ${section === name ? 'aria-current="page"' : ''}
    ${name === 'inbox' ? 'aria-describedby="pending-approval-summary"' : ''}>${icon(glyph)}<span>${label}</span>
    ${name === 'inbox' ? '<span id="pending-approval-count" class="pending-count" aria-hidden="true" hidden></span>' : ''}
  </button>`;
  app.innerHTML = `<div class="frame"><aside class="sidebar">${logo}
    <nav class="nav" aria-label="Main navigation">${nav('requests', 'My requests', 'list')}
      ${person.approver || person.superAdmin ? nav('inbox', 'Approval inbox', 'inbox') : ''}
      ${person.superAdmin || person.canManageOptions ? nav('admin', 'Users', 'users') : ''}</nav>
    ${person.approver || person.superAdmin ? '<span id="pending-approval-summary" class="sr-only" role="status"></span>' : ''}
    <header class="page-top"><div class="account">
      ${config.demo ? `<span class="demo-tag">Demo</span><select id="demo-role" aria-label="Demo role">
        ${Object.entries({ employee: 'Employee', supervisor: 'Supervisor', hrd: 'HRD' })
          .map(([key, label]) => `<option value="${key}" ${key === currentDemoRole() ? 'selected' : ''}>${label}</option>`).join('')}
      </select>` : `<button class="button secondary profile-button" type="button" data-action="profile" aria-label="My account"
        ${screen === 'profile' ? 'aria-current="page"' : ''} title="My account">
        <span class="avatar account-avatar" data-own-avatar aria-hidden="true">${avatarImage()}</span>
        <span class="account-name" data-own-name>${escape(person.name)}</span>${icon('next')}</button>
        ${button('signout', '', 'secondary signout', 'exit', 'aria-label="Sign out" title="Sign out"')}`}
    </div></header>
  </aside><div class="page" data-density="${compact ? 'compact' : 'comfortable'}">
    <div id="notice" role="status" class="notice" tabindex="-1" hidden></div>
    ${content}
  </div>${button('scroll-top', '', 'scroll-top', 'up', 'aria-label="Back to top" title="Back to top" hidden')}</div>`;
  syncScrollTop();
  renderApprovalCount();
  enhanceSelects(app);
}

function syncScrollTop() {
  const control = app.querySelector('.scroll-top');
  if (control) control.hidden = window.scrollY < 320;
}

function openProfile() {
  ++routeRevision;
  ++listRevision;
  clearTimeout(searchTimer);
  screen = 'profile';
  const password = (name, label, autocomplete) => field(name, label,
    `<input type="password" name="${name}" autocomplete="${autocomplete}" required ${autocomplete === 'new-password' ? 'minlength="12" maxlength="72"' : ''}>`);
  renderFrame(`${backButton('close-profile', 'Back to workspace')}
    <div class="heading"><h1 tabindex="-1">My account</h1></div>
    <div class="profile-layout">
      <section class="panel panel-content profile-section"><h2>Personal details</h2>
        <div class="profile-email"><span class="muted small">Sign-in email</span><strong>${escape(accountUser.email)}</strong></div>
        <form id="profile-name" class="sheet">
          ${field('display-name', 'Display name', `<input name="display_name" value="${escape(person.name)}" maxlength="100" autocomplete="name" required>`)}
          <div class="actions">${submitButton('Save name', 'check')}</div>
        </form>
        <form id="profile-photo" class="sheet">
          <h2>Profile picture</h2>
          <div class="photo-settings">
            <span class="avatar profile-avatar" data-own-avatar aria-hidden="true">${avatarImage()}</span>
            <label class="button secondary file-picker">${icon('image')}Choose photo<input type="file" name="photo" accept="image/*" required></label>
          </div>
          <output class="small muted photo-selection" aria-live="polite"></output>
          <div class="actions">${submitButton('Save photo', 'check')}</div>
        </form>
      </section>
      <section class="panel panel-content profile-section"><h2>Change password</h2>
        <form id="profile-password" class="sheet">
          ${password('current_password', 'Current password', 'current-password')}
          ${password('new_password', 'New password', 'new-password')}
          ${password('confirm_password', 'Confirm new password', 'new-password')}
          <small class="muted">Use at least 12 characters.</small>
          <div class="actions">${submitButton('Change password', 'lock')}</div>
        </form>
      </section>
    </div>`);
  window.scrollTo(0, 0);
  app.querySelector('h1').focus({ preventScroll: true });
}

const groups = ['Total', 'In review', 'Approved', 'Returned / disapproved'];
const statusOptions = { '': 'All statuses', active: 'In review', ...statuses };
const densityButton = () => button('density', 'Compact', 'secondary density', 'compact', `aria-pressed="${compact}"`);
function pagination() {
  return `<nav class="pagination" aria-label="Request pagination" hidden>
    <label class="page-size"><span>Rows<span class="page-label-extra"> per page</span></span> <select id="rows-per-page">${pageSizes.map(size =>
      `<option value="${size}" ${rowsPerPage === size ? 'selected' : ''}>${size}</option>`).join('')}</select></label>
    <div class="page-navigation"><span id="row-range" role="status"></span>
      ${button('previous', '', 'secondary page-step', 'previous', 'aria-label="Previous page" title="Previous page" disabled')}
      ${button('next', '', 'secondary page-step', 'next', 'aria-label="Next page" title="Next page" disabled')}
    </div>
  </nav>`;
}

function listView() {
  const inbox = screen === 'inbox';
  renderFrame(`<div class="heading register-heading">
    <h1 tabindex="-1">${inbox ? 'Approval inbox' : 'My requests'}</h1>
    <div class="actions">${person.canManageOptions ? button('request-options', 'Request options', 'secondary', 'list') : ''}
      ${inbox || person.adminOnly ? '' : button('new', 'New request', 'primary', 'plus')}</div>
    </div>
    ${person.adminOnly ? `<section class="panel panel-content profile-setup">
      <h2>Set up your staff profile</h2><p>${inbox
        ? 'Add your staff profile and have requests assigned to you as an approver.'
        : 'Add your branch and two approvers to submit a request from this account.'}</p>
      ${button('manage-user', 'Set up my profile', 'primary', 'edit', `data-id="${escape(person.id)}"`)}
    </section>` : `
    ${inbox ? '' : `<dl class="stats" aria-label="Request summary">${groups.map((label, i) =>
      `<div class="stat"><dt>${label}</dt><dd id="count-${i}">–</dd></div>`).join('')}</dl>`}
    <section class="panel register ${inbox ? 'register-inbox' : ''}" aria-label="${inbox ? 'Assigned requests' : 'Request history'}">
      <header class="panel-header">
      <div class="filters"><label class="search">${icon('search')}<input id="search" type="search" maxlength="80" aria-label="Search requests" placeholder="Search requests" value="${escape(search)}"></label>
      ${inbox ? `<select id="filter" aria-label="Approval inbox view">
        <option value="">Awaiting my decision</option><option value="assigned" ${filter === 'assigned' ? 'selected' : ''}>All assigned requests</option>
      </select><select id="inbox-status" aria-label="Approval inbox status">
        <option value="">All statuses</option>${Object.entries(statuses).map(([value, label]) =>
          `<option value="${value}" ${value === inboxStatus ? 'selected' : ''}>${label}</option>`).join('')}
      </select>` : `<select id="filter" aria-label="Filter by status">${Object.entries(statusOptions).map(([v, l]) =>
        `<option value="${v}" ${v === filter ? 'selected' : ''}>${l}</option>`).join('')}</select>`}
      </div>${densityButton()}</header>
      <div id="request-list"><p class="empty" role="status">Loading requests…</p></div>
      ${pagination()}
    </section>`}`);
}

function renderList() {
  const target = document.querySelector('#request-list');
  if (!target || !result) return;
  result.counts.forEach((count, i) => {
    const el = document.getElementById(`count-${i}`);
    if (el) el.textContent = count ?? '–';
  });
  const footer = app.querySelector('.pagination');
  footer.hidden = false;
  const start = page * rowsPerPage;
  footer.querySelector('#row-range').textContent = result.rows.length
    ? `${start + 1}–${start + result.rows.length} of ${result.total}` : '0 requests';
  footer.querySelector('[data-action="previous"]').disabled = page === 0;
  footer.querySelector('[data-action="next"]').disabled = start + result.rows.length >= result.total;
  if (!result.rows.length) {
    target.innerHTML = `<p class="empty">${search || inboxStatus || (filter && filter !== 'assigned') ? 'No requests match these filters.' :
      screen === 'inbox' ? (filter === 'assigned' ? 'No requests are assigned to you.' : 'No requests are waiting for your decision.') : 'You haven’t submitted a request yet.'}</p>`;
    return;
  }
  const showRequested = screen === 'requests';
  target.innerHTML = `<table class="data-table request-table${showRequested ? ' request-table-with-submitted' : ''}" role="table" aria-label="${screen === 'inbox' ? 'Approval inbox' : 'My requests'}">
    <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">PRF number</th>
      <th scope="col" role="columnheader">Position / ${screen === 'inbox' ? 'requester' : 'assigned area'}</th>
      ${showRequested ? '<th scope="col" role="columnheader">Date requested</th>' : ''}
      <th scope="col" role="columnheader">Date needed</th><th scope="col" role="columnheader">Status</th>
      <th scope="col" role="columnheader" class="data-action">Action</th></tr></thead>
    <tbody role="rowgroup">${result.rows.map(r => `<tr class="request-row" role="row">
      <td class="record-number" role="cell">${escape(prfNumber(r))}</td>
      <td class="request-identity" role="cell"><strong>${escape(r.form.position)}</strong><small>${escape(screen === 'inbox' ? r.requester_name : r.form.area)}</small></td>
      ${showRequested ? `<td class="request-submitted" role="cell"><span class="due-label">Requested </span>${escape(approvalTime(r.submitted_at, true))}</td>` : ''}
      <td class="due" role="cell"><span class="due-label">Needed </span>${escape(day(r.form.needed))}</td>
      <td class="request-status" role="cell">${badge(r.status)}</td>
      <td class="data-action" role="cell">${button('record', 'Open', 'secondary row-button', 'open',
        `data-id="${escape(r.id)}" aria-label="Open ${r.number ? `${escape(r.number)}, ` : ''}${escape(r.form.position)}"`)}</td>
    </tr>`).join('')}</tbody></table>`;
}

async function refreshList() {
  const revision = ++listRevision;
  try {
    const next = await dashboard({ mode: screen, id: person.id, status: filter, inboxStatus, search, page, rowsPerPage });
    if (revision !== listRevision || !['inbox', 'requests'].includes(screen)) return;
    if (!next.rows.length && page > 0 && next.total > 0) {
      page = Math.floor((next.total - 1) / rowsPerPage);
      return refreshList();
    }
    if (!next.total) page = 0;
    result = next;
    renderList();
  } catch (err) {
    if (revision !== listRevision || !['inbox', 'requests'].includes(screen)) return;
    const target = document.querySelector('#request-list');
    if (target) target.innerHTML = `<div class="empty">Unable to load requests. ${button('retry-list', 'Try again', 'secondary', 'retry')}</div>`;
    const footer = app.querySelector('.pagination');
    if (footer) footer.hidden = true;
    banner(err.message, true);
  }
}

async function goList(mode = 'requests', restore = false) {
  const revision = ++routeRevision;
  ++listRevision;
  clearTimeout(searchTimer);
  screen = mode;
  const previous = restore && requestListReturn?.mode === mode ? requestListReturn : null;
  requestListReturn = null;
  page = previous?.page ?? 0;
  filter = previous?.filter ?? '';
  inboxStatus = previous?.inboxStatus ?? '';
  search = previous?.search ?? '';
  detail = null;
  listView();
  if (!previous) {
    window.scrollTo(0, 0);
    app.querySelector('h1')?.focus({ preventScroll: true });
  }
  if (!person.adminOnly) await refreshList();
  if (previous && revision === routeRevision) {
    window.scrollTo(0, previous.scroll);
    const trigger = [...app.querySelectorAll('button[data-action]')].find(node =>
      previous.id ? node.dataset.id === previous.id : node.dataset.action === 'new');
    trigger?.focus({ preventScroll: true });
  }
}

const field = (name, label, html, opts = '') =>
  `<label class="field ${opts}" id="field-${name}">${label}${html}</label>`;


let managedAccounts = [];
let adminDirectory;
let adminListPosition = 0;
let adminSearch = '';
let adminLauncher = '';
let adminDirty = false;
const roleLabels = { employee: 'Employee', supervisor: 'Supervisor', hrd: 'HRD approver', other: 'Other staff' };

function renderUserRows(term = '') {
  const matches = managedAccounts.filter(account =>
    [account.name, account.email, account.branch, roleLabels[account.role], account.superAdmin ? 'Super admin' : '']
      .filter(Boolean).join(' ').toLowerCase().includes(term.trim().toLowerCase()));
  document.getElementById('user-count').textContent = `${matches.length} ${matches.length === 1 ? 'account' : 'accounts'}`;
  document.getElementById('user-results').innerHTML = matches.length ? matches.map(account => {
    const label = account.name || (account.superAdmin ? 'Super administrator' : account.email);
    const status = account.active === null ? 'Profile pending' : account.active ? 'Active' : 'Inactive';
    if (!person.superAdmin) return `<tr class="user-row"><td><strong>${escape(label)}</strong></td>
      <td class="user-branch">${escape(account.branch)}</td>
      <td class="data-action">${button('manage-user', 'Edit branches', 'secondary row-button', 'edit',
        `data-id="${escape(account.id)}" aria-label="Edit branches for ${escape(label)}"`)}</td></tr>`;
    return `<tr class="user-row" role="row">
      <td role="cell"><span class="user-identity"><span class="avatar user-avatar" aria-hidden="true">${escape(initials(label))}</span>
        <span><strong>${escape(label)}</strong><small>${label === account.email ? '' : escape(account.email)}</small></span></span></td>
      <td class="user-role" role="cell">${account.superAdmin ? 'Super admin' : escape(roleLabels[account.role] ?? 'Unassigned')}</td>
      <td class="user-branch" role="cell">${escape(account.branch || 'No branch')}</td>
      <td class="user-status" role="cell"><span class="badge ${account.active ? 'approved' : account.active === false ? 'disapproved' : ''}">${status}</span></td>
      <td class="data-action" role="cell">${button('manage-user', 'Manage', 'secondary row-button', 'edit',
        `data-id="${escape(account.id)}" aria-label="Manage ${escape(label)}"`)}</td></tr>`;
  }).join('') : `<tr class="empty-row" role="row"><td class="empty" role="cell" colspan="${person.superAdmin ? 5 : 3}">No accounts match your search.</td></tr>`;
}

function branchCheckboxes(branches, assigned) {
  const options = branches.filter(branch => branch.active !== false || assigned.includes(branch.id));
  return `<fieldset class="branch-checklist"><legend>Assigned branches</legend>
    ${options.length ? options.map(branch => `<label class="branch-check">
      <input type="checkbox" name="branch_ids" value="${escape(branch.id)}" ${assigned.includes(branch.id) ? 'checked' : ''}>
      <span>${escape(branch.name)}${branch.active === false ? ' (inactive)' : ''}</span>
    </label>`).join('') : '<p class="muted small">No branches available.</p>'}</fieldset>`;
}

function renderEmployeeBranches(account, branches) {
  return `${backButton('admin', 'Back to users')}
    <div class="heading"><div><h1 tabindex="-1">Edit branches</h1><p>${escape(account.name)}</p></div></div>
    <section class="panel panel-content branch-editor">
      <form class="sheet" id="employee-branches-form" data-id="${escape(account.id)}">
        ${branchCheckboxes(branches, account.branch_ids)}
        <div class="actions">${submitButton('Save branches', 'check')}</div>
      </form>
    </section>`;
}

function renderAccountForm(account, approvers, branches, branchField) {
  const creating = !account;
  const current = account ?? {};
  const assigned = current.branch_ids ?? (current[branchField] ? [current[branchField]] : []);
  const selected = (key, value) => current[key] === value ? 'selected' : '';
  const approver = (name, label, role) => {
    const options = approvers.filter(p => p.account_role === role && p.id !== current.id);
    const previous = current[name] && !options.some(p => p.id === current[name])
      ? `<option value="${escape(current[name])}" selected>Current approver unavailable</option>` : '';
    return field(name, label, `<select name="${name}" data-search-select>
      <option value="">Choose an approver</option>${previous}
      ${options.map(p => `<option value="${escape(p.id)}" ${selected(name, p.id)}>${escape(p.name)}</option>`).join('')}
    </select>`);
  };
  const password = label => field('account-password', label,
    '<input type="password" name="password" autocomplete="new-password" minlength="12" maxlength="72" required><small>Use at least 12 characters. Share the password privately.</small>', 'wide');
  return `${backButton('admin', 'Back to users')}
    <div class="heading"><div><h1 tabindex="-1">${creating ? 'New user' : 'Manage account'}</h1>
      <p>${creating ? 'Create an account and its PRF profile.' : escape(account.email)}</p></div></div>
    <div class="admin-panels">
      <section class="panel panel-content admin-editor"><h2>${creating ? 'Account details' : 'PRF profile'}</h2>
      <form id="admin-form" class="sheet">
        <input type="hidden" name="action" value="${creating ? 'create' : 'save'}">
        ${creating ? '' : `<input type="hidden" name="account_id" value="${escape(account.id)}">`}
        <div class="field-grid">
          ${field('account-name', 'Full name', `<input name="name" value="${escape(current.name)}" maxlength="100" required>`)}
          ${creating ? field('account-email', 'Email', '<input type="email" name="email" maxlength="254" autocomplete="off" required>') : ''}
          <input type="hidden" name="branch_id" value="${escape(current.branch_id)}">
          ${branchCheckboxes(branches, assigned)}
          ${field('account-role', 'Role', `<select name="role" required><option value="">Choose a role</option>${Object.entries(roleLabels).map(([id, label]) => `<option value="${id}" ${selected('role', id)}>${label}</option>`).join('')}</select>`)}
          ${creating ? '' : field('account-active', 'PRF access', `<select name="active"><option value="true"${current.active !== false ? ' selected' : ''}>Active</option><option value="false"${current.active === false ? ' selected' : ''}>Inactive</option></select>`)}
          ${approver('supervisor_id', 'Assigned supervisor', 'supervisor')}
          ${approver('hrd_id', 'Assigned HRD approver', 'hrd')}
          ${creating ? password('Initial password') : ''}
        </div><div class="actions">${creating ? submitButton('Create account', 'plus') : submitButton('Save changes', 'check')}</div>
      </form></section>
      ${creating || account.superAdmin ? '' : `<section class="panel panel-content admin-editor"><h2>Password reset</h2><form id="admin-form-reset" class="sheet"><input type="hidden" name="action" value="reset"><input type="hidden" name="account_id" value="${escape(account.id)}">${password('New password')}<div class="actions">${submitButton('Reset password', 'lock', 'secondary')}</div></form></section>`}
    </div>`;
}

function renderBranchForm() {
  return `${backButton('admin', 'Back to users')}
    <div class="heading"><h1 tabindex="-1">Add branch</h1></div>
    <section class="panel panel-content admin-editor branch-editor">
      <form id="admin-form-branch" class="sheet">
        <input type="hidden" name="action" value="create-branch">
        ${field('branch-name', 'Branch name', '<input name="branch_name" maxlength="100" required>')}
        <div class="actions">${submitButton('Add branch', 'plus')}</div>
      </form>
    </section>`;
}

async function openAdmin(view = '', message = '') {
  const revision = ++routeRevision;
  screen = 'admin';
  if (!adminDirectory) {
    renderFrame('<div class="heading"><h1>Users</h1></div><p class="empty" role="status">Loading accounts…</p>');
  }
  try {
    const directory = adminDirectory ?? await (person.superAdmin ? adminAccounts() : employeeDirectory());
    if (revision !== routeRevision) return;
    const { accounts, approvers = [] } = directory;
    if (!Array.isArray(accounts) || !Array.isArray(approvers)) {
      throw new Error('The user directory is unavailable. Try again.');
    }
    // The previous function returns branch names only on existing staff profiles.
    const hasBranchDirectory = Array.isArray(directory.branches);
    const branches = hasBranchDirectory ? directory.branches
      : [...new Set(accounts.map(account => account.branch).filter(Boolean))].sort()
        .map(name => ({ id: name, name }));
    if (!person.superAdmin) {
      const names = new Map(branches.map(branch => [branch.id, branch.name]));
      accounts.forEach(account => { account.branch = account.branch_ids.map(id => names.get(id)).join(', '); });
    }
    adminDirectory = directory;
    managedAccounts = accounts.sort((a, b) => Number(b.superAdmin) - Number(a.superAdmin)
      || (a.name || a.email).localeCompare(b.name || b.email));
    const account = managedAccounts.find(a => a.id === view);
    if (!person.superAdmin && account) {
      renderFrame(renderEmployeeBranches(account, branches));
    } else if (view === 'new-branch') {
      renderFrame(renderBranchForm());
    } else if (view === 'new' || account) {
      renderFrame(renderAccountForm(account, approvers, branches, hasBranchDirectory ? 'branch_id' : 'branch'));
    } else {
      renderFrame(`<div class="heading register-heading"><h1 tabindex="-1">Users</h1>
        <div class="actions">${person.superAdmin && hasBranchDirectory ? button('new-branch', 'Add branch', 'secondary', 'plus') : ''}
          ${button('request-options', 'Request options', 'secondary', 'list')}
          ${person.superAdmin ? button('new-user', 'New user', 'primary', 'plus') : ''}</div></div>
        <section class="panel users-panel" aria-label="User accounts">
          <header class="panel-header"><h2 id="user-count" aria-live="polite">Accounts</h2>
            <label class="search user-search">${icon('search')}
              <input id="user-search" type="search" value="${escape(adminSearch)}" aria-label="Search users" placeholder="${person.superAdmin ? 'Search name, email, or branch' : 'Search name or branch'}"></label>
            ${densityButton()}</header>
          <table class="data-table user-table ${person.superAdmin ? '' : 'scoped-user-table'}" role="table" aria-label="Accounts">
            <thead role="rowgroup"><tr role="row"><th scope="col" role="columnheader">Account</th>${person.superAdmin ? '<th scope="col" role="columnheader">Role</th>' : ''}
              <th scope="col" role="columnheader">Branches</th>${person.superAdmin ? '<th scope="col" role="columnheader">PRF access</th>' : ''}
              <th scope="col" role="columnheader" class="data-action">Action</th></tr></thead>
            <tbody id="user-results" role="rowgroup"></tbody>
          </table>
        </section>`);
      renderUserRows(adminSearch);
    }
    banner(message);
    window.scrollTo(0, view ? 0 : adminListPosition);
    if (view) app.querySelector('h1')?.focus({ preventScroll: true });
    else if (adminLauncher) {
      const launcher = [...app.querySelectorAll('button[data-action]')].find(node =>
        node.dataset.id === adminLauncher || node.dataset.action === adminLauncher);
      launcher?.focus({ preventScroll: true });
    } else app.querySelector('h1')?.focus({ preventScroll: true });
  } catch (err) {
    if (revision === routeRevision) {
      renderFrame('<div class="heading"><h1>Users</h1></div>' + button('admin', 'Try again', 'secondary', 'retry'));
      banner(err.message, true);
    }
  }
}

function requestOptionField(kind, label, addLabel, names, selected) {
  const choices = [...new Set([...names, ...(config.demo && selected ? [selected] : [])])].sort((a, b) => a.localeCompare(b));
  const selectedName = choices.includes(selected) ? selected
    : choices.find(name => name.toLowerCase() === selected?.toLowerCase());
  const id = `request-option-${kind}`;
  return `<div class="request-option" data-option="${kind}">
    <label class="field" for="${id}">${label}
      <select name="${kind}" id="${id}"${kind === 'branch' ? '' : ' data-search-select'} required><option value="">Select an option</option>
        ${choices.map(name => `<option value="${escape(name)}" ${name === selectedName ? 'selected' : ''}>${escape(name)}</option>`).join('')}
      </select>
    </label>
    ${addLabel ? `<details><summary class="button secondary option-toggle">${icon('plus')}${addLabel}</summary>
      <div class="option-editor">
        <label class="field" for="${id}-name">New ${label.toLowerCase()}
          <input id="${id}-name" type="text" maxlength="100" autocomplete="off">
        </label>
        ${button('add-request-option', 'Add option', 'secondary', 'check', 'data-mutation')}
      </div>
      <p role="status" class="small option-error"></p>
    </details>` : ''}
  </div>`;
}

async function saveRequestOption(target) {
  const field = target.closest('[data-option]');
  const input = field.querySelector('.option-editor input');
  const name = input.value.trim();
  const status = field.querySelector('.option-error');
  status.textContent = '';
  if (!name) {
    status.textContent = 'Enter a name.';
    input.focus();
    return;
  }
  const confirmed = await confirmOption('add', name, target, () => addRequestOption(field.dataset.option, name));
  if (confirmed) {
    const savedName = confirmed.value;
    if (field.dataset.option === 'branch') adminDirectory = null;
    const select = field.querySelector('select');
    const options = [...select.options];
    if (!options.some(option => option.value === savedName)) {
      const next = options.slice(1).find(option => option.value.localeCompare(savedName) > 0);
      select.add(new Option(savedName), next ?? null);
    }
    select.value = savedName;
    input.value = '';
    field.querySelector('details').open = false;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    focusSelect(select);
  }
}

function requestOptionFields(options, values = {}) {
  return [
    requestOptionField('branch', 'Branch', person.superAdmin ? 'Add branch' : '', options.branch, values.branch),
    requestOptionField('position', 'Position title', 'Add position title', options.position, values.position),
    requestOptionField('area', 'Assigned area / store', 'Add assigned area', options.area, values.area),
  ].join('');
}

function formView(options) {
  const values = edit?.form ?? {};
  const val = name => escape(values[name]);
  const input = (name, label, type, options, opts) =>
    field(name, label, `<input name="${name}" type="${type}" value="${val(name)}" ${options}>`, opts);
  const select = (name, label, options) => field(name, label, `<select name="${name}" required>
    <option value="">Select an option</option>${Object.entries(options).map(([key, value]) =>
      `<option value="${key}" ${values[name] === key ? 'selected' : ''}>${value}</option>`).join('')}</select>`);
  const textarea = (name, label, max, rows = 2) =>
    field(name, label, `<textarea name="${name}" maxlength="${max}" rows="${rows}">${val(name)}</textarea>`, 'wide');

  renderFrame(`${backButton('back', 'Back to requests')}
    <div class="heading"><div><h1 tabindex="-1">${edit ? 'Revise request' : 'New request'}</h1>
      <p>${escape(person.name)}</p></div></div>
    <form id="request-form" class="sheet">
      <section class="panel form-section"><h2>Personnel needed</h2><div class="field-grid">
        ${requestOptionFields(options, { ...values, branch: edit?.branch_name ?? person.branch })}
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
      <div class="actions">${submitButton(edit ? 'Resubmit to supervisor' : 'Submit to supervisor', 'send')}
      ${button('back', 'Cancel', 'secondary', 'close')}</div>
    </form>`);
  conditionalFields();
  window.scrollTo(0, 0);
  app.querySelector('h1').focus({ preventScroll: true });
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
  renderFrame(`${backButton('back', screenOrigin === 'inbox' ? 'Back to approval inbox' : 'Back to requests')}
    <div class="heading"><div><p>${escape(prfNumber(r))}</p><h1 tabindex="-1">${escape(f.position)}</h1>
      <div class="status-line">${badge(r.status)}${next ? `<span class="muted">Next action by ${escape(next)}</span>` : ''}</div></div>
      <div class="actions"><div class="print-choice"><select id="paper" aria-label="Paper size">
        <option ${paper === 'A4' ? 'selected' : ''}>A4</option><option ${paper === 'Letter' ? 'selected' : ''}>Letter</option>
      </select>${button('export', 'Print/Export PRF', 'secondary', 'print', 'data-mutation')}</div>
      ${mayEdit ? button('revise', 'Revise request', 'primary', 'edit') : ''}</div>
    </div>
    <div class="detail-layout">
      <section class="panel panel-content"><h2>Request details</h2><dl class="details">
        ${fieldEntry('Requested by', r.requester_name)}${fieldEntry('Branch / office', r.branch_name)}
        ${fieldEntry('Assigned area / store', f.area)}${fieldEntry('Headcount', f.headcount)}
        ${fieldEntry('Date requested', approvalTime(r.submitted_at, true))}${fieldEntry('Date needed', day(f.needed))}
        ${fieldEntry('Service time frame', f.service_other || services[f.service])}
        ${fieldEntry('Work assignment', assignments[f.assignment])}
        ${fieldEntry('Requisition type', requisitions[f.requisition])}${fieldEntry('Work schedule', f.schedule)}
        ${fieldEntry('Requisition details', f.reason, true)}${fieldEntry('Qualifications', f.qualifications, true)}
        ${fieldEntry('Proposed salary', f.salary)}${fieldEntry('Allowance', f.allowance)}
        ${fieldEntry('Supervisor approved', approvalTime(r.supervisor_at))}
        ${fieldEntry('HRD approved', approvalTime(r.hrd_at))}
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
        <div class="actions">${submitButton('Record decision', 'check')}</div>
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
    app.querySelector('h1')?.focus({ preventScroll: true });
    banner(message);
  } catch (err) {
    if (token !== routeRevision) return;
    renderFrame(`${backButton('back', origin === 'inbox' ? 'Back to approval inbox' : 'Back to requests')}<h1>Request unavailable</h1>`);
    banner(err.message, true);
  }
}

async function startRequest(row = null) {
  clearTimeout(searchTimer);
  screen = 'new';
  edit = row;
  pendingId = row?.id ?? crypto.randomUUID();
  await loadRequestOptions(backButton('back', 'Back to requests'), 'retry-request', formView);
}

const optionActions = {
  add: { label: 'Add', icon: 'plus', message: 'The option will be available in the dropdown.' },
  rename: { label: 'Rename', icon: 'edit', message: 'The new name will appear in the dropdown. Existing requests keep their saved values.' },
  activate: { label: 'Activate', icon: 'check', message: 'The option will be available in the dropdown again.' },
  deactivate: { label: 'Deactivate', icon: 'archive', message: 'The option will be hidden from the dropdown. Existing requests keep their saved values.' },
  delete: { label: 'Delete', icon: 'close', message: 'This permanently removes the option from the directory. Existing requests keep their saved values.' },
};

function optionDialog(title, content, launcher, { sheet = false, save } = {}) {
  const dialog = document.createElement('dialog');
  dialog.className = `option-dialog${sheet ? ' option-action-sheet' : ''}`;
  dialog.setAttribute('aria-labelledby', 'option-dialog-title');
  if (save) {
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-describedby', 'option-dialog-description');
  }
  dialog.innerHTML = `<form method="dialog"><h2 id="option-dialog-title">${escape(title)}</h2>
    ${content}<p class="option-dialog-error small" role="alert"></p></form>`;
  const form = dialog.querySelector('form');
  const cancel = dialog.querySelector('[data-action="dismiss-option-dialog"]');
  cancel.addEventListener('click', () => dialog.close());
  const viewport = window.visualViewport;
  const renameFields = form.querySelector('.option-rename-fields');
  const nameInput = renameFields?.querySelector('input');
  if (renameFields) dialog.classList.add('option-rename-dialog');
  const fit = () => {
    const height = viewport?.height || window.innerHeight;
    dialog.style.setProperty('--option-height', `${height}px`);
    dialog.style.setProperty('--option-center', `${(viewport?.offsetTop ?? 0) + height / 2}px`);
    if (!renameFields) return;
    dialog.classList.toggle('option-rename-short', height < 320);
    if (!dialog.open || document.activeElement !== nameInput) return;
    // Reveal the field inside the dialog without scrolling the page behind it.
    const field = nameInput.getBoundingClientRect();
    const visible = renameFields.getBoundingClientRect();
    if (field.bottom > visible.bottom - 4) renameFields.scrollTop += field.bottom - visible.bottom + 4;
    else if (field.top < visible.top + 4) renameFields.scrollTop -= visible.top - field.top + 4;
  };
  dialog.addEventListener('focusin', fit);
  let saving = false;
  let savedValue;
  if (save) {
    const submit = form.querySelector('button[type="submit"]');
    const error = form.querySelector('[role="alert"]');
    dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (saving) return;
      saving = submit.disabled = cancel.disabled = true;
      error.textContent = '';
      form.setAttribute('aria-busy', 'true');
      try {
        savedValue = await save();
        dialog.close('saved');
      } catch (err) {
        error.textContent = err.message;
      } finally {
        saving = submit.disabled = cancel.disabled = false;
        form.removeAttribute('aria-busy');
      }
    });
  }
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      viewport?.removeEventListener('resize', fit);
      viewport?.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
      const action = dialog.returnValue;
      const value = save ? savedValue : form.elements.name?.value;
      dialog.remove();
      launcher?.focus({ preventScroll: true });
      resolve(action ? { action, value } : null);
    }, { once: true });
    document.body.append(dialog);
    fit();
    viewport?.addEventListener('resize', fit);
    viewport?.addEventListener('scroll', fit);
    window.addEventListener('resize', fit);
    dialog.showModal();
  });
}

function optionDialogFooter(action, label, glyph, destructive = false, focusCancel = true) {
  return `<div class="actions option-dialog-footer">
    ${button('dismiss-option-dialog', 'Cancel', 'secondary', 'close', focusCancel ? 'autofocus' : '')}
    <button class="button ${destructive ? 'option-confirm-delete' : 'primary'}" type="submit" value="${action}">${icon(glyph)}${label}</button>
  </div>`;
}

function confirmOption(action, name, launcher, save, updatedName) {
  const { label, icon: glyph, message } = optionActions[action];
  const subject = updatedName === undefined ? `“${name}”` : `“${name}” to “${updatedName}”`;
  return optionDialog(`${label} this option?`, `<p id="option-dialog-description">
    <strong>${escape(subject)}</strong> ${message}</p>${optionDialogFooter(action, label, glyph, action === 'delete')}`, launcher, { save });
}

async function manageOption(target, option) {
  const kind = optionKind;
  let action = target.dataset.optionAction;
  if (!action) {
    const choices = ['rename', option.active ? 'deactivate' : 'activate', 'delete'];
    const selected = await optionDialog(option.name, `<div class="option-sheet-actions">${choices.map(key => {
      const { label, icon: glyph } = optionActions[key];
      return `<button class="button secondary ${key === 'delete' ? 'option-delete' : ''}" type="submit" value="${key}">${icon(glyph)}${label}</button>`;
    }).join('')}</div>${button('dismiss-option-dialog', 'Cancel', 'secondary', 'close', 'autofocus')}`, target, { sheet: true });
    if (!selected) return;
    action = selected.action;
  }
  let newName;
  do {
    if (action === 'rename') {
      const input = await optionDialog('Rename option', `<div class="option-rename-fields">${field('rename-option-name', 'New name',
        `<input name="name" value="${escape(newName ?? option.name)}" maxlength="100" required autofocus pattern=".*\\S.*">`)}</div>
        ${optionDialogFooter('continue', 'Continue', 'next', false, false)}`, target);
      if (!input) return;
      newName = input.value.trim();
    }
    const result = await confirmOption(action, option.name, target,
      () => editRequestOption(kind, option.id, action, newName ?? null), newName);
    if (result) {
      adminDirectory = null;
      await openRequestOptions(`Option ${action === 'rename' ? 'renamed' : `${action}d`}.`);
      return;
    }
  } while (action === 'rename');
}

async function openRequestOptions(message = '', focusTab = false) {
  const revision = ++routeRevision;
  clearTimeout(searchTimer);
  screen = 'options';
  const label = optionKinds[optionKind];
  const back = backButton('close-options', optionOrigin?.mode === 'admin' ? 'Back to users'
    : optionOrigin?.mode === 'inbox' ? 'Back to approval inbox' : 'Back to requests');
  const heading = `${back}<div class="heading"><h1 tabindex="-1">Request options</h1></div>
    <div class="option-kinds" role="tablist" aria-label="Option categories">${Object.entries(optionKinds)
      .filter(([kind]) => kind !== 'branch' || person.superAdmin).map(([kind, title]) =>
      button('option-kind', title, 'option-tab', 'list', `data-id="${kind}" id="option-tab-${kind}" role="tab"
        aria-controls="option-panel" aria-selected="${kind === optionKind}" tabindex="${kind === optionKind ? 0 : -1}"`)).join('')}</div>`;
  const scroll = message ? window.scrollY : 0;
  const panelAttrs = `id="option-panel" role="tabpanel" aria-labelledby="option-tab-${optionKind}"`;
  renderFrame(`${heading}<div ${panelAttrs}><p class="empty" role="status">Loading request options…</p></div>`);
  try {
    const options = await optionDirectory(optionKind);
    if (revision !== routeRevision) return;
    renderFrame(`${heading}<section ${panelAttrs} class="panel panel-content option-directory">
      <form id="add-directory-option" class="option-edit-row">
        ${field('new-directory-option', `New ${label.toLowerCase()}`, '<input name="name" maxlength="100" required>')}
        ${submitButton(`Add ${label.toLowerCase()}`, 'plus')}
      </form>
      ${options.length ? `<ul class="option-rows">${options.map(option => {
        const id = escape(option.id);
        const name = escape(option.name);
        return `<li class="option-entry" data-id="${id}" data-name="${name}" data-active="${option.active}">
          <div class="option-entry-heading"><strong>${name}</strong><span class="badge ${option.active ? 'approved' : 'disapproved'}">${option.active ? 'Active' : 'Inactive'}</span></div>
          ${button('edit-option', 'Actions', 'secondary option-mobile-actions', 'more', `aria-label="Actions for ${name}" aria-haspopup="dialog"`)}
          <div class="actions option-desktop-actions">${button('edit-option', 'Rename', 'secondary', 'edit', 'data-option-action="rename" aria-haspopup="dialog"')}
          ${button('edit-option', option.active ? 'Deactivate' : 'Activate', 'secondary',
            option.active ? 'archive' : 'check', `data-option-action="${option.active ? 'deactivate' : 'activate'}" aria-haspopup="dialog"`)}
          ${button('edit-option', 'Delete', 'secondary option-delete', 'close',
            'data-option-action="delete" aria-haspopup="dialog"')}</div>
        </li>`;
      }).join('')}</ul>` : '<p class="empty">No options yet.</p>'}
    </section>`);
    banner(message);
    window.scrollTo(0, scroll);
    app.querySelector(message ? '#notice' : focusTab ? '[role="tab"][aria-selected="true"]' : 'h1')?.focus({ preventScroll: true });
  } catch (err) {
    if (revision !== routeRevision) return;
    renderFrame(`${heading}<div ${panelAttrs}>${button('request-options', 'Try again', 'secondary', 'retry')}</div>`);
    banner(err.message, true);
  }
}

async function loadRequestOptions(back, retry, render) {
  const revision = ++routeRevision;
  renderFrame(`${back}<p class="empty" role="status">Loading request options…</p>`);
  window.scrollTo(0, 0);
  try {
    const options = await requestOptions();
    if (revision === routeRevision) render(options);
  } catch (err) {
    if (revision !== routeRevision) return;
    renderFrame(`${back}<div class="heading"><h1>Request options unavailable</h1></div>
      ${button(retry, 'Try again', 'secondary', 'retry')}`);
    banner(err.message, true);
  }
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
    accountUser = user;
    const superAdmin = Boolean(user?.email_confirmed_at && user.app_metadata.prf_super_admin === true);
    person = profile ? { ...profile, superAdmin } : superAdmin
      ? { id: user.id, name: adminDisplayName(), superAdmin, adminOnly: true } : null;
    if (!person) return renderLogin('', false, true);
    if (user) void loadOwnPhoto(user.id).then(photo => {
      if (photo && accountUser?.id === user.id && !avatarUrl) setProfilePhoto(photo);
    }).catch(() => { /* Initials stay visible if the photo cannot be loaded. */ });
    void refreshApprovalCount();
    if (person.adminOnly) return openAdmin();
    const id = new URL(location.href).searchParams.get('request');
    if (id && /^[0-9a-f-]{36}$/i.test(id)) await openRecord(id, 'requests');
    else if (person.superAdmin) await openAdmin();
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
    resetApprovalCount();
    void refreshApprovalCount();
    await goList(person.approver ? 'inbox' : 'requests');
  } else if (target.id === 'filter' || target.id === 'inbox-status') {
    if (target.id === 'filter') {
      filter = target.value;
      if (screen === 'inbox' && !filter) {
        inboxStatus = '';
        document.getElementById('inbox-status').value = '';
      }
    } else {
      inboxStatus = target.value;
      if (inboxStatus) {
        filter = 'assigned';
        document.getElementById('filter').value = filter;
      }
    }
    page = 0;
    clearTimeout(searchTimer);
    await refreshList();
  } else if (target.id === 'rows-per-page' && pageSizes.includes(Number(target.value))) {
    rowsPerPage = Number(target.value);
    saveViewPreference('prf-rows-per-page', String(rowsPerPage));
    page = 0;
    clearTimeout(searchTimer);
    await refreshList();
  } else if (target.id === 'paper') {
    paper = target.value;
  } else if (target.form?.id === 'profile-photo') {
    target.form.querySelector('output').textContent = target.files[0]?.name ?? '';
  } else if (target.name === 'service' || target.name === 'requisition') {
    conditionalFields();
  } else if (target.name === 'decision') {
    target.form.elements.note.required = ['return', 'disapprove'].includes(target.value);
  }
});
app.addEventListener('input', e => {
  if (e.target.form?.id.match(/^(admin-form|employee-branches-form)/) && !e.target.matches('.search-select input')) adminDirty = true;
  if (e.target.id === 'user-search') {
    adminSearch = e.target.value;
    return renderUserRows(adminSearch);
  }
  if (e.target.id !== 'search') return;
  search = e.target.value.trim();
  page = 0;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshList, 220);
});
app.addEventListener('keydown', e => {
  if (e.target.matches('[role="tab"]') && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
    const tabs = [...e.target.parentElement.querySelectorAll('[role="tab"]')];
    const index = tabs.indexOf(e.target);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1
      : (index + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[next].click();
    return;
  }
  if (e.key !== 'Enter' || e.isComposing || !e.target.matches('.option-editor input')) return;
  e.preventDefault();
  e.target.closest('.option-editor').querySelector('button').click();
});
app.addEventListener('click', async e => {
  const target = e.target.closest('button[data-action]')
    ?? (window.getSelection()?.isCollapsed ? e.target.closest('.request-row')?.querySelector('[data-action="record"]') : null);
  if (!target || busy) return;
  const { action, id } = target.dataset;
  if (adminDirty && !window.confirm('Discard unsaved account changes?')) return;
  adminDirty = false;
  if (action === 'density') {
    compact = !compact;
    const density = compact ? 'compact' : 'comfortable';
    app.querySelector('.page').dataset.density = density;
    target.setAttribute('aria-pressed', String(compact));
    saveViewPreference('prf-table-density', density);
  } else if (action === 'scroll-top') {
    const heading = app.querySelector('.page h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  } else if (action === 'profile' && accountUser && screen !== 'profile') {
    profileReturn = { mode: screen, id: detail?.row.id, page, filter, inboxStatus, search, scroll: window.scrollY };
    openProfile();
  } else if (action === 'close-profile') {
    const previous = profileReturn;
    profileReturn = null;
    if (previous?.mode === 'detail') await openRecord(previous.id);
    else if (previous?.mode === 'options') await openRequestOptions();
    else if (previous?.mode === 'admin' || person.adminOnly) await openAdmin();
    else {
      requestListReturn = previous;
      await goList(previous?.mode === 'inbox' ? 'inbox' : 'requests', true);
    }
  } else if (action === 'add-request-option') {
    await saveRequestOption(target);
  } else if (action === 'admin' && (person?.superAdmin || person?.canManageOptions)) {
    await openAdmin();
  } else if (action === 'request-options' && (person?.superAdmin || person?.canManageOptions)) {
    if (screen !== 'options') {
      optionOrigin = { mode: screen, page, filter, inboxStatus, search, scroll: window.scrollY };
      optionKind = person.superAdmin ? 'branch' : 'position';
    }
    await openRequestOptions();
  } else if (action === 'option-kind' && Object.hasOwn(optionKinds, id) && (id !== 'branch' || person.superAdmin)) {
    optionKind = id;
    await openRequestOptions('', true);
  } else if (action === 'close-options') {
    const previous = optionOrigin;
    optionOrigin = null;
    if (previous?.mode === 'admin') await openAdmin();
    else {
      requestListReturn = previous;
      await goList(previous?.mode === 'inbox' ? 'inbox' : 'requests', true);
    }
  } else if (action === 'edit-option') {
    const row = target.closest('.option-entry').dataset;
    await manageOption(target, { id: row.id, name: row.name, active: row.active === 'true' });
  } else if (action === 'new-user' && person?.superAdmin) {
    adminListPosition = window.scrollY;
    adminLauncher = 'new-user';
    adminDirectory = null;
    await openAdmin('new');
  } else if (action === 'new-branch' && person?.superAdmin) {
    adminListPosition = window.scrollY;
    adminLauncher = 'new-branch';
    await openAdmin('new-branch');
  } else if (action === 'manage-user' && (person?.superAdmin || person?.canManageOptions)) {
    adminListPosition = window.scrollY;
    adminLauncher = id;
    adminDirectory = null;
    await openAdmin(id);
  } else if (action === 'requests' || action === 'inbox') {
    if (action === 'requests' || person?.approver || person?.superAdmin) await goList(action);
  } else if (action === 'retry-list') {
    banner();
    await refreshList();
  } else if (action === 'new' && !person?.adminOnly) {
    requestListReturn = { mode: screen, page, filter, inboxStatus, search, scroll: window.scrollY };
    screenOrigin = 'requests';
    await startRequest();
  } else if (action === 'revise') {
    await startRequest(detail.row);
  } else if (action === 'retry-request') {
    await startRequest(edit);
  } else if (action === 'back') {
    if (screen === 'new' && edit) await openRecord(edit.id);
    else await goList(screenOrigin, true);
  } else if (action === 'record') {
    requestListReturn = { mode: screen, id, page, filter, inboxStatus, search, scroll: window.scrollY };
    await openRecord(id, screen);
  } else if (action === 'previous' || action === 'next') {
    const footer = target.closest('.pagination');
    footer.querySelectorAll('.page-step').forEach(step => { step.disabled = true; });
    page = Math.max(0, page + (action === 'next' ? 1 : -1));
    clearTimeout(searchTimer);
    await refreshList();
    if (footer.isConnected && !footer.hidden && [document.body, target].includes(document.activeElement)) {
      const step = target.disabled ? footer.querySelector('.page-step:not(:disabled)') : target;
      if (step) step.focus({ preventScroll: true });
      else focusSelect(footer.querySelector('select'));
    }
  } else if (action === 'signout') {
    const { error } = await supabase.auth.signOut({ scope: 'local' });
    if (error) return banner(error.message, true);
    ++routeRevision;
    ++listRevision;
    clearTimeout(searchTimer);
    requestListReturn = null;
    resetApprovalCount();
    person = null;
    accountUser = null;
    profileReturn = null;
    optionOrigin = null;
    setProfilePhoto(null);
    managedAccounts = [];
    adminDirectory = null;
    adminSearch = '';
    adminListPosition = 0;
    adminLauncher = '';
    detail = null;
    edit = null;
    renderLogin();
  } else if (action === 'export') {
    try {
      markBusy(true);
      const row = detail.row;
      const prepared = await preparePrint(row, paper, detail.events);
      const preview = printReturn = { button: target, scroll: window.scrollY, prepared,
        filename: `${row.number ?? `PRF-pending-${row.id.slice(0, 8)}`}.png` };
      app.hidden = true;
      printPreview.hidden = false;
      window.scrollTo(0, 0);
      const printButton = printPreview.querySelector('[data-action="send-to-printer"]');
      printButton.focus({ preventScroll: true });
      void preparePrintImage(prepared.svg).then(layer => {
        if (printReturn !== preview) return;
        preview.layer = layer;
        printDownload.disabled = false;
        if (canCopyImage) copyImageButton.disabled = false;
        if (document.activeElement === printButton && window.matchMedia('(pointer: fine)').matches) printDownload.focus({ preventScroll: true });
      }).catch(() => {
        if (printReturn === preview) printStatus.textContent = 'Could not create the PNG. Printing is still available.';
      });
    } catch (err) {
      banner(`Could not prepare the printout. ${err.message}`, true);
    } finally {
      markBusy(false);
    }
  }
});
printPreview.querySelector('.print-controls').innerHTML = `<div class="actions">
  ${backButton('close-print', 'Back to request')}
  ${button('send-to-printer', 'Print', 'primary', 'print')}
  ${button('download-print', 'Download PNG', 'secondary', 'download', 'disabled')}
  ${button('copy-print', 'Copy image', 'secondary', 'copy', `disabled ${canCopyImage ? '' : 'hidden'}`)}
  </div><p class="print-phone-help muted small">You can also use your browser’s Share menu and choose Print.</p>
  <p class="print-export-status small" role="status"></p>`;
const printDownload = printPreview.querySelector('[data-action="download-print"]');
const copyImageButton = printPreview.querySelector('[data-action="copy-print"]');
const printStatus = printPreview.querySelector('.print-export-status');
printPreview.addEventListener('click', async event => {
  const action = event.target.closest('button')?.dataset.action;
  if (action === 'send-to-printer') {
    stampPrint(printReturn.prepared);
    window.print();
  } else if (action === 'download-print' && printReturn?.layer) {
    try {
      const preview = printReturn;
      const canvas = drawPrintImage(preview.prepared, preview.layer, 'Downloaded');
      // Encode within the tap so the native download retains user activation.
      const data = canvas.toDataURL('image/png').split(',')[1];
      if (!data) throw new Error('Image unavailable.');
      const bytes = Uint8Array.from(atob(data), value => value.charCodeAt(0));
      if (preview.url) URL.revokeObjectURL(preview.url);
      preview.url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
      const link = document.createElement('a');
      link.href = preview.url;
      link.download = preview.filename;
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      printStatus.textContent = 'Could not download the PNG. Printing is still available.';
    }
  } else if (action === 'copy-print' && printReturn?.layer) {
    const preview = printReturn;
    try {
      const canvas = drawPrintImage(preview.prepared, preview.layer, 'Copied');
      const image = new Promise((resolve, reject) => canvas.toBlob(blob => {
        if (blob) resolve(blob);
        else reject(new Error('Image unavailable.'));
      }, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
      if (printReturn === preview) printStatus.textContent = 'PRF image copied.';
    } catch {
      if (printReturn === preview) printStatus.textContent = 'Could not copy the image. Use Download PNG instead.';
    }
  } else if (action === 'close-print') {
    printPreview.hidden = true;
    app.hidden = false;
    document.getElementById('print-root').replaceChildren();
    document.getElementById('print-paper')?.remove();
    printReturn.button.focus({ preventScroll: true });
    window.scrollTo(0, printReturn.scroll);
    if (printReturn.url) URL.revokeObjectURL(printReturn.url);
    printDownload.disabled = true;
    copyImageButton.disabled = true;
    printStatus.textContent = '';
    printReturn = null;
  }
});
window.addEventListener('beforeprint', () => {
  if (printReturn) stampPrint(printReturn.prepared);
});
app.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const form = event.target;
  const formData = new FormData(form);
  const values = Object.fromEntries(formData);
  if (form.id === 'add-directory-option' || (form.id === 'admin-form-branch' && person?.superAdmin)) {
    const fromUsers = form.id === 'admin-form-branch';
    const name = (fromUsers ? values.branch_name : values.name).trim();
    if (!name) return banner('Enter an option name.', true);
    const confirmed = await confirmOption('add', name, event.submitter,
      () => fromUsers ? adminAccounts(values) : addRequestOption(optionKind, name));
    if (!confirmed) return;
    adminDirectory = null;
    if (fromUsers) {
      adminDirty = false;
      await openAdmin('', `Added branch ${confirmed.value.branch.name}.`);
    } else await openRequestOptions('Option added.');
    return;
  }
  markBusy(true);
  banner();
  try {
    if (form.id === 'login-form') {
      const email = values.email.trim().toLowerCase();
      const { error } = await supabase.auth.signInWithPassword({ email, password: values.password });
      if (error) throw error;
      await start();
    } else if (form.id === 'profile-name' && accountUser) {
      const name = values.display_name.trim();
      if (!name || name.length > 100) throw new Error('Enter a display name of 1 to 100 characters.');
      person.name = await saveOwnName(name, person.adminOnly);
      if (person.adminOnly) accountUser.user_metadata.prf_display_name = person.name;
      form.elements.display_name.value = person.name;
      adminDirectory = null;
      refreshProfileHeader();
      banner('Display name saved.');
    } else if (form.id === 'profile-photo' && accountUser) {
      setProfilePhoto(await saveOwnPhoto(accountUser.id, values.photo));
      form.reset();
      form.querySelector('output').textContent = '';
      banner('Profile picture saved.');
    } else if (form.id === 'profile-password' && accountUser) {
      if (values.new_password !== values.confirm_password) throw new Error('The new passwords do not match.');
      if (values.new_password === values.current_password) throw new Error('Choose a password different from your current one.');
      if (values.new_password.length < 12 || new TextEncoder().encode(values.new_password).length > 72) {
        throw new Error('Use a password of at least 12 characters and no more than 72 bytes.');
      }
      accountUser = await updateOwnPassword(accountUser.email, values.current_password, values.new_password);
      form.reset();
      banner('Password changed.');
    } else if (form.id === 'employee-branches-form' && person?.canManageOptions && !person.superAdmin) {
      await saveEmployeeBranches(form.dataset.id, formData.getAll('branch_ids'));
      adminDirectory = null;
      adminDirty = false;
      await openAdmin('', 'Employee branches saved.');
    } else if (['admin-form', 'admin-form-reset'].includes(form.id) && person?.superAdmin) {
      if (form.id === 'admin-form') {
        values.branch_ids = formData.getAll('branch_ids');
        if (!values.branch_ids.length) throw new Error('Choose at least one branch.');
      }
      const account = await adminAccounts(values);
      adminDirty = false;
      if (values.action !== 'reset') adminDirectory = null;
      if (values.action === 'save' && values.account_id === person.id) {
        const profile = await context();
        person = profile ? { ...profile, superAdmin: true }
          : { id: person.id, name: adminDisplayName(), superAdmin: true, adminOnly: true };
        resetApprovalCount();
        void refreshApprovalCount();
      }
      if (values.action === 'create') await openAdmin('', `Account created for ${account.email}.`);
      else if (values.action === 'reset') await openAdmin(values.account_id, 'Password reset.');
      else await openAdmin(values.account_id, 'PRF profile saved.');
    } else if (form.id === 'request-form') {
      const row = await submit({ id: pendingId, form: values, version: edit?.version });
      await openRecord(row.id, screenOrigin, edit ? 'Request resubmitted to the supervisor.' : 'Request submitted to the supervisor.');
    } else if (form.id === 'decision-form') {
      const row = await decide({ id: detail.row.id, version: detail.row.version, decision: values.decision, note: values.note });
      void refreshApprovalCount(true);
      await openRecord(row.id, screenOrigin, 'Decision recorded.');
    }
  } catch (err) {
    banner(err.message, true);
    document.getElementById('notice')?.scrollIntoView({ block: 'nearest' });
  } finally {
    markBusy(false);
  }
});

document.addEventListener('visibilitychange', () => { void refreshApprovalCount(); });
window.addEventListener('scroll', syncScrollTop, { passive: true });
window.addEventListener('focus', () => { void refreshApprovalCount(); });
setInterval(refreshApprovalCount, 45_000);
start();
