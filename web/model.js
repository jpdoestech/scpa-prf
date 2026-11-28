export const statuses = {
  officer: 'Officer/Agent review',
  supervisor: 'Supervisor review',
  hrd: 'HRD review',
  returned: 'Returned',
  approved: 'Approved',
  disapproved: 'Disapproved',
};

export const services = {
  continuous: 'Continuous', year: '1 year', six_months: '6 months', three_months: '3 months', other: 'Other',
};
export const assignments = {
  full_time: 'Full-time (30+ hours/week)', part_time: 'Part-time (less than 29 hours/week)', on_call: 'On-call',
};
export const requisitions = {
  new: 'New position', replacement: 'Vacancy replacement', additional: 'Additional personnel', other: 'Other',
};

const clock = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila',
});
const calendar = new Intl.DateTimeFormat('en-PH', {
  dateStyle: 'medium', timeZone: 'Asia/Manila',
});
const approvalClock = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Manila',
});
export const dateTime = value => value ? clock.format(new Date(value)) : '';
export const day = value => value ? calendar.format(new Date(value)) : '';
const rangeDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const rangeDate = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export function neededDateRange({ needed, needed_to: end = needed }) {
  if (!needed) return '';
  const first = new Date(`${needed}T00:00:00Z`);
  const last = new Date(`${end || needed}T00:00:00Z`);
  const finish = rangeDate.format(last);
  if (+first === +last) return finish;
  const start = first.getUTCFullYear() === last.getUTCFullYear() ? rangeDay : rangeDate;
  return `${start.format(first)} – ${finish}`;
}
export function approvalTime(value, spaceBeforePeriod = false) {
  if (!value) return '';
  const date = new Date(value);
  const parts = Object.fromEntries(approvalClock.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${day(date)} | ${parts.hour}:${parts.minute}${spaceBeforePeriod ? ' ' : ''}${parts.dayPeriod.toLowerCase()}`;
}
export const prfNumber = row => row.number ?? 'Not yet issued';
const hasApprover = (r, stage, id) => r[`${stage}_ids`]?.includes(id) ?? (r[`${stage}_id`] === id);
export const canDecide = (r, id) =>
  ['officer', 'supervisor', 'hrd'].includes(r.status) && hasApprover(r, r.status, id);
export const skippedApproval = (r, id) => {
  if (r.requester_id === id) return '';
  if (hasApprover(r, 'supervisor', id) && ['supervisor', 'hrd'].includes(r.status)) return 'HRD';
  if (hasApprover(r, 'hrd', id) && r.status === 'supervisor') return 'Supervisor';
  return '';
};
export const nextActor = r => ({
  officer: r.officer_name,
  supervisor: r.supervisor_ids?.length > 1 ? `one of ${r.supervisor_ids.length} assigned supervisors` : r.supervisor_name,
  hrd: r.hrd_ids?.length > 1 ? `one of ${r.hrd_ids.length} assigned HRD approvers` : r.hrd_name,
  returned: r.requester_name,
})[r.status] ?? '';
export const eventTitle = e => {
  if (e.action === 'submitted') return 'Request submitted';
  if (e.action === 'resubmitted') return 'Request resubmitted';
  if (e.stage === 'officer' && e.action === 'auto_approved') return 'Officer/Agent step auto-approved';
  if (e.action === 'approval_override') return e.stage === 'hrd'
    ? 'HRD approved with override (Supervisor step skipped)'
    : 'Supervisor approved with override (HRD step skipped)';
  const stage = { officer: 'Officer/Agent', supervisor: 'Supervisor', hrd: 'HRD' }[e.stage];
  return `${stage} ${e.action === 'returned' ? 'returned for correction' : e.action}`;
};

const correctionFields = {
  requester_name: 'Requested by', branch_name: 'Branch / office', position: 'Position title',
  area: 'Assigned area / store', needed: 'Date needed from', needed_to: 'Date needed to', headcount: 'Headcount',
  service: 'Service time frame', service_other: 'Service time frame details', assignment: 'Work assignment',
  assignment_description: 'Brief description', assignment_remarks: 'Detailed work assignment',
  schedule: 'Work schedule', requisition: 'Requisition type', reason: 'Requisition details',
  qualifications: 'Qualifications', salary: 'Proposed salary', allowance: 'Allowance',
};
const correctionChoices = { service: services, assignment: assignments, requisition: requisitions };

export function correctionHistory(event) {
  const format = (key, value) => {
    if (!value) return 'Not entered';
    if (key === 'needed' || key === 'needed_to') return day(value);
    return correctionChoices[key]?.[value] ?? value;
  };
  return Object.entries(correctionFields).flatMap(([key, label]) => {
    const change = event.changes?.[key];
    return change ? [{ label, from: format(key, change.from), to: format(key, change.to) }] : [];
  });
}
