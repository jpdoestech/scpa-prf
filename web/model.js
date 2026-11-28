export const statuses = {
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
export function approvalTime(value, spaceBeforePeriod = false) {
  if (!value) return '';
  const date = new Date(value);
  const parts = Object.fromEntries(approvalClock.formatToParts(date).map(({ type, value }) => [type, value]));
  return `${day(date)} | ${parts.hour}:${parts.minute}${spaceBeforePeriod ? ' ' : ''}${parts.dayPeriod.toLowerCase()}`;
}
export const prfNumber = row => row.number ?? 'Not yet issued';
export const canDecide = (r, id) =>
  (r.status === 'supervisor' && r.supervisor_id === id) || (r.status === 'hrd' && r.hrd_id === id);
export const nextActor = r => ({
  supervisor: r.supervisor_name, hrd: r.hrd_name, returned: r.requester_name,
})[r.status] ?? '';
export const eventTitle = e => {
  if (e.action === 'submitted') return 'Request submitted';
  if (e.action === 'resubmitted') return 'Request resubmitted';
  return `${e.stage === 'hrd' ? 'HRD' : 'Supervisor'} ${e.action === 'returned' ? 'returned for correction' : e.action}`;
};

const correctionFields = {
  requester_name: 'Requested by', branch_name: 'Branch / office', position: 'Position title',
  area: 'Assigned area / store', needed: 'Date needed', headcount: 'Headcount',
  service: 'Service time frame', service_other: 'Service time frame details', assignment: 'Work assignment',
  schedule: 'Work schedule', requisition: 'Requisition type', reason: 'Requisition details',
  qualifications: 'Qualifications', salary: 'Proposed salary', allowance: 'Allowance',
};
const correctionChoices = { service: services, assignment: assignments, requisition: requisitions };

export function correctionHistory(event) {
  const format = (key, value) => {
    if (!value) return 'Not entered';
    if (key === 'needed') return day(value);
    return correctionChoices[key]?.[value] ?? value;
  };
  return Object.entries(correctionFields).flatMap(([key, label]) => {
    const change = event.changes?.[key];
    return change ? [{ label, from: format(key, change.from), to: format(key, change.to) }] : [];
  });
}
