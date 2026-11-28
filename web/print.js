import { approvalTime, day, eventTitle, prfNumber } from './model.js';

const template = './assets/scpa-prf-template.png';
const svgNS = 'http://www.w3.org/2000/svg';
const printInset = 14;
const pxPerMm = 96 / 25.4;

function svgNode(name, attributes) {
  const node = document.createElementNS(svgNS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

export async function preparePrint(row, paper, events) {
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
    if (Number.isFinite(y)) {
      svg.append(svgNode('rect', { x, y: y - 4.1, width: 6.4, height: 6.4, fill: '#111' }));
    }
  }

  line(prfNumber(row), 498, 516.3, 77, 'PRF number');
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
    line(approvalTime(row.supervisor_at), 393, 900.6, 179, 'Supervisor approval time');
  }
  if (row.hrd_at) {
    line(row.hrd_name, 144, 912, 207, 'Authorized HRD officer');
    line(approvalTime(row.hrd_at), 393, 912, 179, 'HRD approval time');
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
  const supplement = document.createElement('section');
  supplement.className = 'print-supplement';
  const paragraph = text => {
    const node = document.createElement('p');
    node.textContent = text;
    return node;
  };
  const stamp = paragraph(exportStamp('Prepared for print'));
  const heading = document.createElement('h2');
  heading.textContent = 'Request timeline';
  supplement.append(paragraph('Notice: This form was generated by the PRF system. Approvals are recorded electronically. No handwritten signature is required.'), stamp, heading);
  for (const event of events) {
    const note = event.note?.trim();
    supplement.append(paragraph(`${approvalTime(event.occurred_at)} PHT · ${eventTitle(event)} · ${event.actor_name}${note ? ` — ${note}` : ''}`));
  }
  root.append(supplement);
  return { picture, svg, extra, supplement, stamp, paperWidth, paperHeight };
}

function exportStamp(action) {
  return `${action} · ${approvalTime(new Date())} PHT`;
}

export function stampPrint(prepared) {
  prepared.stamp.textContent = exportStamp('Printed');
}

export async function preparePrintImage(svg) {
  const overlay = svg.cloneNode(true);
  overlay.querySelector('image').remove();
  overlay.removeAttribute('style');
  overlay.setAttribute('width', '552');
  overlay.setAttribute('height', '465');
  // Draw the template separately so the SVG used by canvas has no external resources.
  const layer = new Image();
  layer.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(overlay))}`;
  await layer.decode();
  return layer;
}

export function drawPrintImage({ picture, svg, extra, supplement, stamp, paperWidth, paperHeight }, layer, action) {
  const currentStamp = exportStamp(action);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const pageWidth = paperWidth * pxPerMm;
  const inset = printInset * pxPerMm;
  const contentWidth = pageWidth - 2 * inset;
  const formWidth = Math.min(contentWidth, (parseFloat(svg.style.maxWidth) || paperWidth) * pxPerMm);
  const formHeight = formWidth * 465 / 552;
  const noteInset = 2 * pxPerMm;
  const noteWidth = contentWidth - 2 * noteInset;
  const notes = [...extra.children].map(line => line.textContent);
  const noteFont = `${(parseFloat(extra.style.fontSize) || 9) * 4 / 3}px Arial`;
  const paragraphs = (extra.classList.contains('compact') ? [notes.join('  •  ')] : notes)
    .map(text => ({ text, font: noteFont }));
  paragraphs.push(...[...supplement.children].map(node => ({
    text: node === stamp ? currentStamp : node.textContent,
    font: node.tagName === 'H2' ? 'bold 13px Arial' : '12px Arial',
  })));
  const lines = [];
  let y = inset + formHeight + 4 * pxPerMm;
  for (const { text: paragraph, font } of paragraphs) {
    ctx.font = font;
    const wrapped = [];
    let line = '';
    for (const word of paragraph.split(/\s+/)) {
      const joined = line ? `${line} ${word}` : word;
      if (ctx.measureText(joined).width <= noteWidth) {
        line = joined;
        continue;
      }
      if (line) wrapped.push(line);
      line = '';
      if (ctx.measureText(word).width <= noteWidth) {
        line = word;
        continue;
      }
      for (const character of word) {
        if (line && ctx.measureText(line + character).width > noteWidth) {
          wrapped.push(line);
          line = '';
        }
        line += character;
      }
    }
    for (const text of [...wrapped, line]) {
      lines.push({ text, y, font });
      y += parseFloat(font.replace('bold ', '')) * 1.32;
    }
    y += 1.2 * pxPerMm;
  }

  const imageHeight = Math.max(paperHeight * pxPerMm, y + inset);
  const scale = Math.min(2.5, Math.sqrt(12_000_000 / (pageWidth * imageHeight)), 8192 / imageHeight);
  canvas.width = Math.round(pageWidth * scale);
  canvas.height = Math.round(imageHeight * scale);
  ctx.scale(scale, scale);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width / scale, canvas.height / scale);
  const x = (pageWidth - formWidth) / 2;
  ctx.drawImage(picture, x, inset, formWidth, formHeight);
  ctx.drawImage(layer, x, inset, formWidth, formHeight);
  ctx.fillStyle = '#111';
  ctx.textBaseline = 'top';
  for (const line of lines) {
    ctx.font = line.font;
    ctx.fillText(line.text, inset + noteInset, line.y);
  }
  return canvas;
}
