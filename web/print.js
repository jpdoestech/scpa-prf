import { day } from './model.js';

const template = './assets/scpa-prf-template.png';
const svgNS = 'http://www.w3.org/2000/svg';
const printInset = 14;

function svgNode(name, attributes) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export async function preparePrint(row, paper) {
  const picture = new Image();
  picture.src = template;
  await picture.decode();
  const paperWidth = paper === 'Letter' ? 215.9 : 210;
  const paperHeight = paper === 'Letter' ? 279.4 : 297;
  document.getElementById('print-preview').style.setProperty('--paper-width', `${paperWidth}mm`);

  let rules = document.getElementById('print-paper');
  if (!rules) {
    rules = document.createElement('style');
    rules.id = 'print-paper';
    document.head.append(rules);
  }
  // Keep the inset in the document when the browser dialog uses no margins.
  rules.textContent = `@page { size: ${paper === 'Letter' ? 'Letter' : 'A4'} portrait; margin: 0; }
    @media print { #print-root { padding: ${printInset}mm; } }`;

  const f = row.form;
  const root = document.getElementById('print-root');
  const svg = svgNode('svg', { viewBox: '30 469 552 465', role: 'img', 'aria-label': 'SCPA Personnel Requisition Form' });
  svg.append(svgNode('image', { x: 30, y: 469, width: 552, height: 465, href: template }));
  const extra = document.createElement('section');
  extra.className = 'print-extra';
  root.replaceChildren(svg, extra);

  const canvas = document.createElement('canvas').getContext('2d');
  function addExtra(label, value) {
    if (!value) return;
    const line = document.createElement('p');
    const heading = document.createElement('strong');
    heading.textContent = `${label} — `;
    line.append(heading, document.createTextNode(value.replace(/\s+/g, ' ').trim()));
    extra.append(line);
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
    svg.append(svgNode('path', { d: `M${x} ${y + 1} l2 2 l4 -5`, fill: 'none',
      stroke: '#111', 'stroke-width': 1.25, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
  }

  line(row.number, 498, 516.3, 77, 'PRF number');
  line(row.branch_name, 498, 528.5, 77, 'Branch / Office');
  line(row.requester_name, 192, 586.7, 158, 'Requester');
  line(day(row.submitted_at), 436, 587, 137, 'Date requested');
  line(f.position, 192, 598.4, 158, 'Position');
  line(day(f.needed), 436, 599, 137, 'Date needed');
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
    line(day(row.supervisor_at), 393, 900.6, 179, 'Supervisor approval date');
  }
  if (row.hrd_at) {
    line(row.hrd_name, 144, 912, 207, 'Authorized HRD officer');
    line(day(row.hrd_at), 393, 912, 179, 'HRD approval date');
  }
  addExtra('Qualifications', f.qualifications);
  if (!extra.childElementCount) {
    extra.remove();
  } else {
    // Measure the notes at the selected paper width without moving the screen layout.
    const contentWidth = paperWidth - 2 * printInset;
    const noteHeight = paperHeight - 2 * printInset - contentWidth * 465 / 552 - 7;
    const measure = document.createElement('div');
    measure.className = 'measure-print';
    measure.style.width = `${contentWidth}mm`;
    document.body.append(measure);
    measure.append(extra);
    const availableHeight = noteHeight * 96 / 25.4;
    for (let size = 9; size >= 7; size -= 0.5) {
      extra.style.fontSize = `${size}pt`;
      if (extra.offsetHeight <= availableHeight) break;
    }
    if (extra.offsetHeight > availableHeight) {
      extra.classList.add('compact');
      for (let size = 9; size >= 6.5; size -= 0.5) {
        extra.style.fontSize = `${size}pt`;
        if (extra.offsetHeight <= availableHeight) break;
      }
      const notesMm = extra.offsetHeight * 25.4 / 96;
      const formHeight = paperHeight - 2 * printInset - notesMm - 12;
      svg.style.maxWidth = `${Math.min(contentWidth, formHeight * 552 / 465)}mm`;
    }
    root.append(extra);
    measure.remove();
  }
}
