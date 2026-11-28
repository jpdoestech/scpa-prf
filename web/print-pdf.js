import { PDFDocument } from 'pdf-lib';
import { drawPrintImage } from './print.js';

export async function createPrintPdf(prepared, layers) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('SCPA Personnel Requisition Form');
  const width = prepared.paperWidth * 72 / 25.4;
  const height = prepared.paperHeight * 72 / 25.4;
  for (const [index, sections] of prepared.pageSections.entries()) {
    const last = index === prepared.pageSections.length - 1;
    const canvas = drawPrintImage(prepared, layers, 'Downloaded', sections, last);
    const image = await pdf.embedJpg(canvas.toDataURL('image/jpeg', .96));
    canvas.width = canvas.height = 0;
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height });
  }
  return new Blob([await pdf.save()], { type: 'application/pdf' });
}
