import { approvalTime, assignments, correctionHistory, eventTitle, neededDateRange, prfNumber, requisitions, services } from './model.js';

const logo = './assets/scpa-logo.png';
const originalTemplate = './assets/scpa-prf-template.png';
const svgNS = 'http://www.w3.org/2000/svg';
const formWidth = 552;
const printInset = 14;
const pxPerMm = 96 / 25.4;

function svgNode(name, attributes) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function wrapText(context, value, width) {
  const lines = [];
  for (const paragraph of String(value ?? '').split(/\r\n?|\n/)) {
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const joined = line ? line + ' ' + word : word;
      if (context.measureText(joined).width <= width) {
        line = joined;
        continue;
      }
      if (line) lines.push(line);
      line = '';
      for (const character of word) {
        if (line && context.measureText(line + character).width > width) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

async function embeddedImage(asset) {
  const picture = new Image();
  picture.src = asset;
  await picture.decode();
  const canvas = document.createElement('canvas');
  canvas.width = picture.naturalWidth;
  canvas.height = picture.naturalHeight;
  canvas.getContext('2d').drawImage(picture, 0, 0);
  return canvas.toDataURL();
}

function formSection(context, name, draw) {
  const svg = svgNode('svg', { role: 'img', 'aria-label': name, xmlns: svgNS });
  const add = (kind, attributes) => {
    const node = svgNode(kind, attributes);
    svg.append(node);
    return node;
  };
  function text(value, x, y, size = 10, weight = 'normal', fill = '#111') {
    add('text', { x, y, fill, 'font-family': 'Arial, sans-serif', 'font-size': size, 'font-weight': weight })
      .textContent = value;
  }
  function rule(x, y, width, stroke = '#7c7c7c') {
    add('line', { x1: x, x2: x + width, y1: y, y2: y, stroke, 'stroke-width': .7 });
  }
  function field(label, value, x, y, width) {
    text(label, x, y, 9, 'bold');
    context.font = '11px Arial, sans-serif';
    for (const line of wrapText(context, value, width - 2)) {
      y += 16;
      text(line, x, y, 11);
      rule(x, y + 4, width);
    }
    return y + 15;
  }
  function fields(y, left, right) {
    if (!right) return field(...left, 2, y, formWidth - 4);
    return Math.max(field(...left, 2, y, 265), field(...right, 285, y, 265));
  }
  function choices(label, options, value, x, y) {
    text(label, x, y, 11, 'bold');
    for (const [key, optionLabel] of Object.entries(options)) {
      y += 14;
      add('rect', { x, y: y - 7, width: 6.4, height: 6.4, fill: value === key ? '#111' : 'none', stroke: '#111', 'stroke-width': .7 });
      text(optionLabel, x + 12, y);
    }
    return y + 19;
  }
  const height = draw({ add, text, rule, fields, choices });
  svg.setAttribute('viewBox', '0 0 ' + formWidth + ' ' + height);
  return { svg, height };
}

async function originalForm(row) {
  const f = row.form;
  const svg = svgNode('svg', { viewBox: '30 469 552 465', role: 'img', 'aria-label': 'SCPA Personnel Requisition Form' });
  svg.append(svgNode('image', { x: 30, y: 469, width: 552, height: 465, href: await embeddedImage(originalTemplate) }));
  const notes = [];

  const canvas = document.createElement('canvas').getContext('2d');
  function addExtra(label, value) {
    if (!value) return;
    const line = document.createElement('p');
    const heading = document.createElement('strong');
    heading.textContent = `${label} — `;
    line.append(heading, document.createTextNode(value.trim()));
    notes.push(line);
  }
  function line(value, x, y, width, label, secondLine) {
    if (!value) return;
    const original = value;
    let text = value.replace(/\s+/g, ' ').trim();
    const size = 8.8;
    canvas.font = `${size}px Arial`;
    if (canvas.measureText(text).width > width && secondLine) {
      const words = text.split(' ');
      let first = words.shift();
      while (words.length && canvas.measureText(`${first} ${words[0]}`).width <= width) first += ` ${words.shift()}`;
      const rest = words.join(' ');
      if (canvas.measureText(first).width <= width && rest &&
        canvas.measureText(rest).width <= secondLine.width) {
        line(first, x, y, width, label);
        line(rest, secondLine.x, secondLine.y, secondLine.width, label);
        return;
      }
    }
    if (canvas.measureText(text).width > width) {
      addExtra(label, original);
      while (text && canvas.measureText(`${text}…`).width > width) text = text.slice(0, -1);
      text += '…';
    }
    const node = svgNode('text', { x, y, 'font-family': 'Arial, sans-serif', 'font-size': size, fill: '#111' });
    node.textContent = text;
    svg.append(node);
  }
  function check(x, y) {
    if (Number.isFinite(y)) {
      svg.append(svgNode('rect', { x, y: y - 4.1, width: 6.4, height: 6.4, fill: '#111' }));
    }
  }

  line(prfNumber(row), 498, 516.3, 77, 'PRF number');
  line(row.branch_name, 498, 528.5, 77, 'Branch / Office');
  line(row.requester_name, 192, 586.7, 158, 'Requester');
  line(approvalTime(row.submitted_at, true), 436, 587, 137, 'Date requested');
  line(f.position, 192, 598.4, 158, 'Position');
  line(neededDateRange(f), 436, 599, 137, 'Date needed');
  line(f.area, 121, 611.9, 230, 'Assigned area / store');
  line(f.headcount, 471, 611.9, 102, 'Headcount');
  check(55, { continuous: 652.5, year: 664.3, six_months: 676.1, three_months: 687.9, other: 699.6 }[f.service]);
  check(326, { full_time: 655.8, part_time: 667.5, on_call: 679.1 }[f.assignment]);
  check(55, { new: 734.6, replacement: 746.4, additional: 781.4, other: 793.2 }[f.requisition]);
  line(f.service_other, 176, 702.4, 77, 'Other service time frame');
  if (f.requisition === 'replacement') {
    line(f.reason, 335, 747.5, 238, 'Replacement details', { x: 75, y: 764.9, width: 497 });
  } else if (f.requisition === 'additional') {
    line(f.reason, 265, 784.8, 307, 'Reason for additional personnel');
  } else if (f.requisition === 'other') {
    line(f.reason, 176, 796.2, 77, 'Other requisition details');
  }
  line(f.schedule, 273, 819.3, 298, 'Work schedule');
  line(f.salary, 188, 831, 190, 'Proposed salary');
  line(f.allowance, 505, 830.6, 70, 'Allowance');
  if (row.supervisor_at) {
    line(row.supervisor_name, 175.5, 900.6, 175, 'Supervisor');
    line(approvalTime(row.supervisor_at), 393, 900.6, 179, 'Supervisor approval time');
  }
  if (row.hrd_at) {
    line(row.hrd_name, 144, 912, 207, 'Authorized HRD officer');
    line(approvalTime(row.hrd_at), 393, 912, 179, 'HRD approval time');
  }
  addExtra('Work assignment description', f.assignment_description);
  addExtra('Work assignment remarks', f.assignment_remarks);
  addExtra('Qualifications', f.qualifications);
  return { sections: [{ svg, height: 465 }], notes };
}

async function wrappedForm(row) {
  const f = row.form;
  const picture = await embeddedImage(logo);
  const context = document.createElement('canvas').getContext('2d');
  const sections = [
    formSection(context, 'SCPA Personnel Requisition Form', ({ add, text, rule, fields }) => {
      add('image', { href: picture, x: 2, y: 0, width: 84, height: 32, preserveAspectRatio: 'xMinYMid meet' });
      text('PERSONNEL REQUISITION FORM (Agency)', 2, 48, 16, 'bold');
      text('Human Resources and Development', 2, 64, 11, 'normal', '#555');
      rule(2, 71, formWidth - 4);
      text('INSTRUCTIONS', 2, 86, 9, 'bold');
      text('Complete this form and submit it for Supervisor and HRD review.', 77, 86, 10);
      return fields(105, ['PRF number', prfNumber(row)], ['Branch / office', row.branch_name]);
    }),
    formSection(context, 'Personnel needed', ({ fields }) => {
      let y = fields(12, ['Requester', row.requester_name], ['Date requested', approvalTime(row.submitted_at, true)]);
      y = fields(y, ['Requested personnel position title', f.position], ['Date needed', neededDateRange(f)]);
      return fields(y, ['Assigned area / store', f.area], ['No. of personnel requested', f.headcount]);
    }),
    formSection(context, 'Service time frame and work assignment', ({ choices }) =>
      Math.max(choices('Service time frame', services, f.service, 2, 11),
        choices('Work assignment', assignments, f.assignment, 285, 11))),
  ];
  for (const [label, value] of [
    ['Other service time frame', f.service_other],
    ['Work assignment description', f.assignment_description],
    ['Work assignment remarks', f.assignment_remarks],
  ]) {
    if (value) sections.push(formSection(context, label, ({ fields }) => fields(11, [label, value])));
  }
  sections.push(formSection(context, 'Requisition type', ({ choices }) => choices('Requisition type', requisitions, f.requisition, 2, 11)));
  if (f.reason) sections.push(formSection(context, 'Requisition details', ({ fields }) => fields(11, ['Requisition details', f.reason])));
  sections.push(formSection(context, 'Work terms', ({ fields }) => {
    const y = fields(11, ['Work schedule', f.schedule]);
    return fields(y, ['Proposed monthly / daily salary', f.salary], ['Allowance, if applicable', f.allowance]);
  }));
  sections.push(formSection(context, 'Approval', ({ add, text, fields }) => {
    add('rect', { x: 0, y: 0, width: formWidth, height: 20, fill: '#656565' });
    text('APPROVAL', 7, 14, 11, 'bold', '#fff');
    text('Approvers confirm that the request accurately represents the position.', 2, 34);
    let y = fields(51, ['Supervisor', row.supervisor_at ? row.supervisor_name : ''], ['Date', approvalTime(row.supervisor_at)]);
    y = fields(y, ['Authorized HRD officer', row.hrd_at ? row.hrd_name : ''], ['Date', approvalTime(row.hrd_at)]);
    return y;
  }));
  if (f.qualifications) sections.push(formSection(context, 'Qualifications', ({ fields }) => fields(11, ['Qualifications', f.qualifications])));

  return { sections, notes: [] };
}

function paginatePrint(sections, notes, paperWidth, paperHeight) {
  const root = document.getElementById('print-root');
  const measure = document.createElement('div');
  measure.className = 'print-measure';
  measure.style.width = (paperWidth - 2 * printInset) + 'mm';
  const items = [...sections.map(({ svg }) => svg), ...notes];
  measure.append(...items);
  document.body.append(measure);
  const heights = items.map(item => item.getBoundingClientRect().height);
  const limit = (paperHeight - 2 * printInset - 1) * pxPerMm;
  const pages = [];
  let sheet, used;
  for (const [index, item] of items.entries()) {
    const height = heights[index];
    const groupHeight = height + (item.tagName === 'H2' ? heights[index + 1] ?? 0 : 0);
    if (!sheet || (used && used + groupHeight > limit)) {
      sheet = document.createElement('div');
      sheet.className = 'print-sheet';
      used = 0;
      pages.push(sheet);
    }
    sheet.append(item);
    used += height;
  }
  measure.remove();
  root.replaceChildren(...pages);
}

export async function preparePrint(row, paper, events, template = 'original') {
  const paperWidth = paper === 'Letter' ? 215.9 : 210;
  const paperHeight = paper === 'Letter' ? 279.4 : 297;
  const { sections, notes } = await (template === 'wrapped' ? wrappedForm(row) : originalForm(row));
  document.getElementById('print-preview').style.setProperty('--paper-width', paperWidth + 'mm');
  let rules = document.getElementById('print-paper');
  if (!rules) {
    rules = document.createElement('style');
    rules.id = 'print-paper';
    document.head.append(rules);
  }
  // Each sheet supplies its own inset even if the browser's margins are disabled.
  rules.textContent = '@page { size: ' + (paper === 'Letter' ? 'Letter' : 'A4') + ' portrait; margin: 0; }';
  document.getElementById('print-root').style.setProperty('--print-inset', printInset + 'mm');
  const paragraph = text => {
    const node = document.createElement('p');
    node.textContent = text;
    return node;
  };
  const stamp = paragraph(exportStamp('Prepared for print'));
  const heading = document.createElement('h2');
  heading.textContent = 'Request timeline';
  notes.push(paragraph('Notice: This form was generated by the PRF system. Approvals are recorded electronically. No handwritten signature is required.'), stamp, heading);
  for (const event of events) {
    const note = event.note?.trim();
    notes.push(paragraph([approvalTime(event.occurred_at) + ' PHT', eventTitle(event), event.actor_name].join(' · ') + (note ? ' — ' + note : '')));
    for (const { label, from, to } of correctionHistory(event)) {
      notes.push(paragraph(label + '\nFrom  ' + from + '\nTo  ' + to));
    }
  }
  for (const node of notes) node.classList.add('print-note');
  paginatePrint(sections, notes, paperWidth, paperHeight);
  return { sections, notes, stamp, paperWidth, paperHeight };
}

function exportStamp(action) {
  return action + ' · ' + approvalTime(new Date()) + ' PHT';
}

export function stampPrint(prepared) {
  prepared.stamp.textContent = exportStamp('Printed');
}

export function preparePrintImage(sections) {
  return Promise.all(sections.map(async ({ svg, height }) => {
    const copy = svg.cloneNode(true);
    copy.setAttribute('width', formWidth);
    copy.setAttribute('height', height);
    const layer = new Image();
    layer.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(copy));
    await layer.decode();
    return layer;
  }));
}

export function drawPrintImage({ sections, notes, stamp, paperWidth, paperHeight }, layers, action) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const pageWidth = paperWidth * pxPerMm;
  const inset = printInset * pxPerMm;
  const contentWidth = pageWidth - 2 * inset;
  const sectionScale = contentWidth / formWidth;
  const textInset = 2 * pxPerMm;
  const lines = [];
  let y = inset + sections.reduce((sum, section) => sum + section.height * sectionScale, 0) + 3 * pxPerMm;
  for (const node of notes) {
    const font = node.tagName === 'H2' ? 'bold 13px Arial, sans-serif' : '12px Arial, sans-serif';
    context.font = font;
    const text = node === stamp ? exportStamp(action) : node.textContent;
    for (const line of wrapText(context, text, contentWidth - 2 * textInset)) {
      lines.push({ line, y, font });
      y += 16;
    }
    y += 4;
  }
  const imageHeight = Math.max(paperHeight * pxPerMm, y + inset);
  const scale = Math.min(2.5, Math.sqrt(12_000_000 / (pageWidth * imageHeight)), 8192 / imageHeight);
  canvas.width = Math.round(pageWidth * scale);
  canvas.height = Math.round(imageHeight * scale);
  context.scale(scale, scale);
  context.fillStyle = '#fff';
  context.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
  let sectionTop = inset;
  for (const [index, layer] of layers.entries()) {
    const height = sections[index].height * sectionScale;
    context.drawImage(layer, inset, sectionTop, contentWidth, height);
    sectionTop += height;
  }
  context.fillStyle = '#111';
  context.textBaseline = 'top';
  for (const { line, y, font } of lines) {
    context.font = font;
    context.fillText(line, inset + textInset, y);
  }
  return canvas;
}
