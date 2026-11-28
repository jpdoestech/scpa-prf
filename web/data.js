import { createClient } from '@supabase/supabase-js';
import { canDecide } from './model.js';

export const config = __PUBLIC_CONFIG__;
export const supabase = config.demo ? null : createClient(config.url, config.key);
export const pageSize = 10;
const demoPeople = {
  employee: { id: 'demo-employee', name: 'Mika Reyes', branch: 'Metro Manila', approver: false },
  supervisor: { id: 'demo-supervisor', name: 'Alex Garcia', branch: 'Metro Manila', approver: true },
  hrd: { id: 'demo-hrd', name: 'Jamie Santos', branch: 'Main Office', approver: true },
};
const demoNames = {
  requester_id: demoPeople.employee.id, requester_name: demoPeople.employee.name, branch_name: 'Metro Manila',
  supervisor_id: demoPeople.supervisor.id, supervisor_name: demoPeople.supervisor.name,
  hrd_id: demoPeople.hrd.id, hrd_name: demoPeople.hrd.name,
};
const sampleForm = {
  area: 'Quezon City', headcount: '1', service: 'six_months', service_other: '', assignment: 'full_time',
  requisition: 'new', reason: '', schedule: 'Monday to Saturday, 8 AM–5 PM', salary: '', allowance: '', qualifications: '',
};
const seedRows = [
  ['Warehouse Assistant', 'supervisor', '2026-12-10', '2'],
  ['Sales Promodiser', 'hrd', '2026-12-08', '3'],
  ['Store Associate', 'approved', '2026-12-03', '1'],
  ['Inventory Clerk', 'returned', '2026-12-15', '1'],
];

function seed() {
  const base = new Date('2026-11-26T02:00:00Z').getTime();
  const iso = offset => new Date(base + offset * 3_600_000).toISOString();
  return seedRows.map(([position, status, needed, headcount], i) => {
    const submitted = iso(-i * 30);
    const reviewed = iso(-i * 30 + 5);
    const final = iso(-i * 30 + 10);
    const events = [{ action: 'submitted', actor_name: demoPeople.employee.name, stage: 'requester', occurred_at: submitted }];
    if (status === 'hrd' || status === 'approved') {
      events.push({ action: 'approved', actor_name: demoPeople.supervisor.name, stage: 'supervisor', occurred_at: reviewed });
    }
    if (status === 'approved') {
      events.push({ action: 'approved', actor_name: demoPeople.hrd.name, stage: 'hrd', occurred_at: final });
    }
    if (status === 'returned') {
      events.push({ action: 'returned', actor_name: demoPeople.supervisor.name, stage: 'supervisor',
        occurred_at: reviewed, note: 'Please confirm the exact work schedule.' });
    }
    return {
      ...demoNames, id: `demo-${i + 1}`, number: status === 'approved' ? `PRF-2026-000${24 - i}` : null, status, version: events.length,
      form: { ...sampleForm, position, needed, headcount }, submitted_at: submitted,
      updated_at: events.at(-1).occurred_at, supervisor_at: ['hrd', 'approved'].includes(status) ? reviewed : null,
      hrd_at: status === 'approved' ? final : null, events,
    };
  });
}
function savedDemo() {
  try { return JSON.parse(localStorage.getItem('scpa-prf-demo-v1')) ?? seed(); }
  catch { return seed(); }
}
let demoRows = config.demo ? savedDemo() : [];
let demoRole = 'employee';
function saveDemo() {
  try { localStorage.setItem('scpa-prf-demo-v1', JSON.stringify(demoRows)); } catch {
    // The sample workflow still works in memory when browser storage is disabled.
  }
}
const mine = r => r.requester_id === demoPeople[demoRole].id;
const queue = r => canDecide(r, demoPeople[demoRole].id);

export function setDemoRole(role) {
  if (demoPeople[role]) demoRole = role;
}
export function currentDemoRole() {
  return demoRole;
}
function unwrap(result) {
  if (result.error) throw new Error(result.error.message);
  return result.data;
}
export async function context() {
  return config.demo ? demoPeople[demoRole] : unwrap(await supabase.rpc('prf_context'));
}

export async function saveOwnName(name, adminOnly) {
  if (adminOnly) {
    const { user } = unwrap(await supabase.auth.updateUser({ data: { prf_display_name: name } }));
    return user.user_metadata.prf_display_name;
  }
  return unwrap(await supabase.rpc('prf_update_own_name', { display_name: name }));
}

export async function updateOwnPassword(email, currentPassword, password) {
  unwrap(await supabase.auth.signInWithPassword({ email, password: currentPassword }));
  const { user } = unwrap(await supabase.auth.updateUser({ password }));
  return user;
}

const avatars = 'prf-avatars';
const avatarPath = id => `${id}/avatar.jpg`;

export async function loadOwnPhoto(id) {
  const result = await supabase.storage.from(avatars).download(avatarPath(id));
  return result.error ? null : result.data;
}

export async function saveOwnPhoto(id, file) {
  if (!file?.size || file.size > 12 * 1024 * 1024) throw new Error('Choose a photo under 12 MB.');
  const supported = file.type ? /^image\/(jpeg|png|webp|avif|heic|heif)$/i.test(file.type)
    : /\.(jpe?g|png|webp|avif|heic|heif)$/i.test(file.name);
  if (!supported) throw new Error('Choose a JPEG, PNG, WebP, AVIF, or HEIC photo.');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    try { await image.decode(); } catch { throw new Error('Choose a photo your browser can open.'); }
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 384;
    const ctx = canvas.getContext('2d');
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 384, 384);
    ctx.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 384, 384);
    const photo = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
    if (!photo || photo.type !== 'image/jpeg' || photo.size > 262144) throw new Error('Could not prepare this photo.');
    unwrap(await supabase.storage.from(avatars).upload(avatarPath(id), photo, {
      contentType: 'image/jpeg', upsert: true, cacheControl: '0',
    }));
    return photo;
  } finally {
    URL.revokeObjectURL(source);
  }
}

const demoOptionsKey = 'scpa-prf-demo-options-v1';
const demoOptions = { branch: ['Main Office', 'Metro Manila'], position: seedRows.map(([name]) => name), area: [sampleForm.area] };

export async function requestOptions() {
  if (!config.demo) return unwrap(await supabase.rpc('prf_request_options'));
  try { Object.assign(demoOptions, JSON.parse(localStorage.getItem(demoOptionsKey))); } catch {
    // The demo remains usable without browser storage.
  }
  return demoOptions;
}

export async function optionDirectory(kind) {
  return unwrap(await supabase.rpc('prf_option_directory', { option_kind: kind }));
}

export async function editRequestOption(kind, id, action, name = null) {
  unwrap(await supabase.rpc('prf_edit_request_option', {
    option_kind: kind, option_id: id, option_action: action, option_name: name,
  }));
}

export async function addRequestOption(kind, name) {
  if (!config.demo) return unwrap(await supabase.rpc('prf_add_request_option', {
    option_kind: kind, option_name: name,
  }));
  const names = demoOptions[kind];
  const existing = names.find(value => value.toLowerCase() === name.toLowerCase());
  if (existing) return existing;
  names.push(name);
  try { localStorage.setItem(demoOptionsKey, JSON.stringify(demoOptions)); } catch {
    // Keep the option available in memory.
  }
  return name;
}

export async function adminAccounts(values) {
  const result = await supabase.functions.invoke('prf-admin', values
    ? { method: 'POST', body: values }
    : { method: 'GET' });
  if (result.error?.context instanceof Response) {
    const body = await result.error.context.json().catch(() => null);
    if (body?.error) throw new Error(body.error);
  }
  return unwrap(result);
}

export async function employeeDirectory() {
  return unwrap(await supabase.rpc('prf_employee_directory'));
}

export async function saveEmployeeBranches(id, branches) {
  return unwrap(await supabase.rpc('prf_save_employee_branches', { employee_id: id, branch_ids: branches }));
}

function approvalScope(query, id, assigned = false) {
  return query.or(assigned
    ? `supervisor_id.eq.${id},hrd_id.eq.${id}`
    : `and(status.eq.supervisor,supervisor_id.eq.${id}),and(status.eq.hrd,hrd_id.eq.${id})`);
}

export async function pendingApprovals(id) {
  if (config.demo) return demoRows.filter(queue).length;
  const result = await approvalScope(supabase.from('requests').select('id', { count: 'exact', head: true }), id);
  unwrap(result);
  return result.count;
}

export async function dashboard({ mode, id, status, search, page, rowsPerPage = pageSize, inboxStatus = '' }) {
  const filters = ['', 'active', 'approved', 'closed'];
  if (config.demo) {
    const demoId = demoPeople[demoRole].id;
    const assigned = r => [r.supervisor_id, r.hrd_id].includes(demoId);
    const candidates = demoRows.filter(mode === 'inbox' ? (status === 'assigned' ? assigned : queue) : mine);
    const matches = (r, s) => !s || s === 'assigned' || r.status === s ||
      (s === 'active' && ['supervisor', 'hrd'].includes(r.status)) ||
      (s === 'closed' && ['returned', 'disapproved'].includes(r.status));
    const visible = candidates.filter(r => matches(r, status) && (mode !== 'inbox' || !inboxStatus || r.status === inboxStatus) &&
      [r.number, r.form.position, r.form.area, r.requester_name].join(' ').toLowerCase().includes(search.toLowerCase()))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at) || a.id.localeCompare(b.id));
    return {
      rows: visible.slice(page * rowsPerPage, (page + 1) * rowsPerPage),
      total: visible.length, counts: filters.map(s => candidates.filter(r => matches(r, s)).length),
    };
  }

  function query(s, term = '', head = false) {
    let q = supabase.from('requests').select(
      head ? 'id' : 'id,number,requester_name,form,status,updated_at',
      { count: 'exact', head },
    );
    q = mode === 'inbox'
      ? approvalScope(q, id, s === 'assigned')
      : q.eq('requester_id', id);
    if (s === 'active') q = q.in('status', ['supervisor', 'hrd']);
    else if (s === 'closed') q = q.in('status', ['returned', 'disapproved']);
    else if (s && s !== 'assigned') q = q.eq('status', s);
    if (mode === 'inbox' && inboxStatus) q = q.eq('status', inboxStatus);
    if (term) q = q.ilike('search_text', `%${term.replace(/[\\%_]/g, '\\$&')}%`);
    return q;
  }

  const [result, ...counts] = await Promise.all([
    query(status, search).order('submitted_at', { ascending: false }).order('id')
      .range(page * rowsPerPage, (page + 1) * rowsPerPage - 1),
    ...(mode === 'inbox' ? [] : filters.map(s => query(s, '', true))),
  ]);
  return {
    rows: unwrap(result), total: result.count,
    counts: counts.map(value => { unwrap(value); return value.count; }),
  };
}

export async function record(id) {
  if (config.demo) {
    const row = demoRows.find(r => r.id === id);
    if (!row || ![row.requester_id, row.supervisor_id, row.hrd_id].includes(demoPeople[demoRole].id)) {
      throw new Error('Request unavailable.');
    }
    return { row, events: row.events };
  }
  const row = unwrap(await supabase.from('requests').select('*').eq('id', id).maybeSingle());
  if (!row) throw new Error('Request unavailable.');
  const events = [];
  for (let offset = 0; ; offset += 250) {
    const batch = unwrap(await supabase.from('request_events').select('*').eq('request_id', id)
      .order('id').range(offset, offset + 249));
    events.push(...batch);
    if (batch.length < 250) break;
  }
  return { row, events };
}

export async function submit({ id, form, version }) {
  if (!config.demo) return unwrap(await supabase.rpc('prf_submit', {
    request_id: id, input: form, expected_version: version ?? null,
  }));
  let row = demoRows.find(r => r.id === id);
  const at = new Date().toISOString();
  const action = row ? 'resubmitted' : 'submitted';
  if (!row && demoRole !== 'employee') throw new Error('Switch to the employee role to submit a sample request.');
  if (row && (!mine(row) || row.version !== version || row.status !== 'returned')) {
    throw new Error('This request has changed. Refresh it before submitting.');
  }
  if (!row) {
    row = { ...demoNames, id, number: null,
      submitted_at: at, version: 0, events: [] };
    demoRows.unshift(row);
  }
  const { branch, ...details } = form;
  if (branch) row.branch_name = branch;
  Object.assign(row, { form: details, status: 'supervisor', version: row.version + 1, updated_at: at, supervisor_at: null, hrd_at: null });
  row.events.push({ action, actor_name: demoPeople[demoRole].name, stage: 'requester', occurred_at: at });
  saveDemo();
  return row;
}

export async function decide({ id, version, decision, note }) {
  if (!config.demo) return unwrap(await supabase.rpc('prf_decide', {
    request_id: id, expected_version: version, decision, remark: note,
  }));
  const row = demoRows.find(r => r.id === id);
  if (!row || !queue(row) || version !== row.version) throw new Error('This request is no longer awaiting your decision.');
  const stage = row.status;
  const at = new Date().toISOString();
  if (decision === 'approve') {
    row[stage === 'supervisor' ? 'supervisor_at' : 'hrd_at'] = at;
    row.status = stage === 'supervisor' ? 'hrd' : 'approved';
    if (row.status === 'approved' && row.number === null) {
      const year = new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: 'Asia/Manila' }).format(new Date(at));
      const last = Math.max(24, ...demoRows.map(item => Number(item.number?.split('-').at(-1)) || 0));
      row.number = `PRF-${year}-${String(last + 1).padStart(5, '0')}`;
    }
  } else {
    row.status = decision === 'return' ? 'returned' : 'disapproved';
  }
  row.updated_at = at;
  row.version += 1;
  row.events.push({ stage, occurred_at: at, actor_name: demoPeople[demoRole].name, note,
    action: { approve: 'approved', return: 'returned', disapprove: 'disapproved' }[decision] });
  saveDemo();
  return row;
}
