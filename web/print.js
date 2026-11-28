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
  const height = draw({ add, text, rule, field, fields, choices });
  svg.setAttribute('viewBox', '0 0 ' + formWidth + ' ' + height);
  return { svg, height };
}

async function originalForm(row) {
  const f = row.form;
  const artwork = await embeddedImage(originalTemplate);
  const context = document.createElement('canvas').getContext('2d');
  context.font = '8.8px Arial, sans-serif';
  const marks = [];
  const continuations = new Map();

  function originalText(value, x, y) {
    const node = svgNode('text', { x, y, 'font-family': 'Arial, sans-serif', 'font-size': 8.8, fill: '#111' });
    node.textContent = value;
    return node;
  }
  function rule(x1, x2, y) {
    return svgNode('line', { x1, x2, y1: y, y2: y, stroke: '#111', 'stroke-width': .7 });
  }
  function line(value, x, y, width, cut, { extend, secondLine } = {}) {
    if (!value) return;
    const lines = wrapText(context, value, width - 1);
    const first = lines.shift();
    marks.push({ node: originalText(first, x, y), y });
    if (extend && x + context.measureText(first).width > extend.x) {
      marks.push({ node: rule(extend.x - 1, x + width, extend.y), y: extend.y });
    }
    if (secondLine && lines.length) {
      marks.push({ node: originalText(lines.shift(), secondLine.x, secondLine.y), y: secondLine.y });
    }
    if (lines.length) {
      const columns = continuations.get(cut) ?? [];
      columns.push({ x, width, lines });
      continuations.set(cut, columns);
    }
  }
  function check(x, y) {
    if (Number.isFinite(y)) {
      marks.push({ node: svgNode('rect', { x, y: y - 4.1, width: 6.4, height: 6.4, fill: '#111' }), y });
    }
  }

  line(prfNumber(row), 498, 516.3, 77, 519);
  line(row.branch_name, 498, 528.5, 77, 532);
  line(row.requester_name, 192, 586.7, 158, 591);
  line(approvalTime(row.submitted_at, true), 436, 587, 137, 591);
  line(f.position, 192, 598.4, 158, 602.5);
  line(neededDateRange(f), 436, 599, 137, 602.5);
  line(f.area, 121, 611.9, 230, 615);
  line(f.headcount, 471, 611.9, 102, 615);
  check(55, { continuous: 652.5, year: 664.3, six_months: 676.1, three_months: 687.9, other: 699.6 }[f.service]);
  check(326, { full_time: 655.8, part_time: 667.5, on_call: 679.1 }[f.assignment]);
  check(55, { new: 734.6, replacement: 746.4, additional: 781.4, other: 793.2 }[f.requisition]);
  line(f.service_other, 176, 702.4, 140, 709, { extend: { x: 255, y: 704 } });
  line(f.assignment_description, 350, 702.4, 222, 709);
  if (f.requisition === 'replacement') {
    line(f.reason, 335, 747.5, 238, 771, { secondLine: { x: 75, y: 764.9 } });
  } else if (f.requisition === 'additional') {
    line(f.reason, 265, 784.8, 307, 787.5);
  } else if (f.requisition === 'other') {
    line(f.reason, 176, 796.2, 397, 801, { extend: { x: 255, y: 798 } });
  }
  line(f.schedule, 273, 819.3, 299, 822.5, { extend: { x: 353, y: 821 } });
  line(f.salary, 188, 831, 190, 836);
  line(f.allowance, 505, 830.6, 70, 836);
  if (row.supervisor_at) {
    line(row.supervisor_name, 175.5, 900.6, 175, 905);
    line(approvalTime(row.supervisor_at), 393, 900.6, 179, 905);
  }
  if (row.hrd_at) {
    line(row.hrd_name, 144, 912, 207, 920);
    line(approvalTime(row.hrd_at), 393, 912, 179, 920);
  }

  // Open space between the original printed rows without scaling or redrawing the artwork.
  const bands = continuations.size ? [469, 628, 715, 807, 934] : [469, 934];
  const sections = [];
  for (let index = 0; index < bands.length - 1; index++) {
    const label = index ? 'Original PRF, continued' : 'SCPA Personnel Requisition Form';
    const svg = svgNode('svg', { role: 'img', 'aria-label': label, xmlns: svgNS });
    const sourceId = 'original-prf-artwork-' + index;
    const defs = svgNode('defs', {});
    defs.append(svgNode('image', { id: sourceId, x: 30, y: 469, width: 552, height: 465, href: artwork }));
    svg.append(defs);
    const start = bands[index];
    const end = bands[index + 1];
    const cuts = [...continuations.keys()].filter(cut => cut > start && cut < end).sort((a, b) => a - b);
    let from = start;
    let top = 0;
    for (const cut of [...cuts, end]) {
      const height = cut - from;
      const panel = svgNode('svg', { x: 30, y: top, width: formWidth, height, viewBox: '30 ' + from + ' ' + formWidth + ' ' + height, overflow: 'hidden' });
      panel.append(svgNode('use', { href: '#' + sourceId }), ...marks.filter(mark => mark.y >= from && mark.y < cut).map(mark => mark.node));
      svg.append(panel);
      top += height;
      const columns = continuations.get(cut) ?? [];
      for (const { x, width, lines } of columns) {
        for (const [i, text] of lines.entries()) {
          const y = top + 9 + i * 12;
          svg.append(originalText(text, x, y), rule(x, x + width, y + 2));
        }
      }
      if (columns.length) top += Math.max(...columns.map(column => column.lines.length)) * 12 + 2;
      from = cut;
    }
    svg.setAttribute('viewBox', '30 0 ' + formWidth + ' ' + top);
    sections.push({ svg, height: top });
  }
  return { sections, otherDetails: f.qualifications ? [['Qualifications', f.qualifications]] : [] };
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
    formSection(context, 'Service time frame and work assignment', ({ choices, field }) => {
      let serviceY = choices('Service time frame', services, f.service, 2, 11);
      let assignmentY = choices('Work assignment', assignments, f.assignment, 285, 11);
      if (f.service_other) serviceY = field('Specify service time frame', f.service_other, 2, serviceY, 265);
      if (f.assignment_description) assignmentY = field('Brief description', f.assignment_description, 285, assignmentY, 265);
      return Math.max(serviceY, assignmentY);
    }),
  ];
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
  return { sections, otherDetails: f.qualifications ? [['Qualifications', f.qualifications]] : [] };
}

function postApprovalSections(otherDetails, assignment) {
  const context = document.createElement('canvas').getContext('2d');
  context.font = '10px Arial, sans-serif';
  const left = otherDetails.flatMap(([label, value]) => [
    { line: label, bold: true }, ...wrapText(context, value, 400).map(line => ({ line })),
  ]);
  const right = assignment ? wrapText(context, assignment, 132) : [];
  const pageRows = 23;
  const sections = [];
  for (let start = 0; start < Math.max(left.length, right.length); start += pageRows) {
    const notes = left.slice(start, start + pageRows);
    const remarks = right.slice(start, start + pageRows);
    sections.push(formSection(context, 'Details after approval', ({ add, text }) => {
      const height = 12 + 13 * Math.max(notes.length, remarks.length + Number(Boolean(remarks.length)));
      for (const [index, { line, bold }] of notes.entries()) {
        text(line, 2, 12 + index * 13, 10, bold ? 'bold' : 'normal');
      }
      if (remarks.length) {
        add('line', { x1: 413, y1: 3, x2: 413, y2: height - 5, stroke: '#7c7c7c', 'stroke-width': .7 });
        text('Detailed work assignment', 420, 12, 9, 'bold');
        for (const [index, line] of remarks.entries()) text(line, 420, 25 + index * 13);
      }
      return height;
    }));
  }
  return sections;
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
  const { sections, otherDetails } = await (template === 'wrapped' ? wrappedForm(row) : originalForm(row));
  sections.push(...postApprovalSections(otherDetails, row.form.assignment_remarks));
  const notes = [];
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
