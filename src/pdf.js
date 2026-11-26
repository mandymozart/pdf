import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { PDFDocument } from 'pdf-lib';
import { drawStamp } from './placement.mjs';
import { describeForm, fillFields } from './form-fields.mjs';

GlobalWorkerOptions.workerSrc = worker;

export function openPdf(bytes) {
  const assets = new URL('pdfjs/', document.baseURI);
  return getDocument({
    data: bytes.slice(),
    cMapUrl: new URL('cmaps/', assets).href,
    cMapPacked: true,
    standardFontDataUrl: new URL('standard_fonts/', assets).href,
    wasmUrl: new URL('wasm/', assets).href,
    iccUrl: new URL('iccs/', assets).href,
    isEvalSupported: false,
  });
}

export function textStamp(value) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const lines = value.split(/\r?\n/);
  const font = '48px Arial, sans-serif';
  ctx.font = font;
  canvas.width = Math.ceil(Math.max(...lines.map(line => ctx.measureText(line).width))) + 16;
  canvas.height = 60 * lines.length + 8;
  ctx.font = font;
  ctx.fillStyle = '#171f2f';
  ctx.textBaseline = 'alphabetic';
  lines.forEach((line, index) => ctx.fillText(line, 8, 48 + 60 * index));
  return { png: canvas.toDataURL(), width: canvas.width / 4, height: canvas.height / 4 };
}

export function signatureStamp(canvas) {
  const { width, height } = canvas;
  const pixels = canvas.getContext('2d').getImageData(0, 0, width, height).data;
  let left = width, right = -1, top = height, bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pixels[(y * width + x) * 4 + 3] === 0) continue;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  if (right < left) throw new Error('Draw or import a signature first.');
  const cropped = document.createElement('canvas');
  cropped.width = right - left + 9;
  cropped.height = bottom - top + 9;
  cropped.getContext('2d').drawImage(canvas, -left + 4, -top + 4);
  const ratio = Math.min(125 / cropped.width, 52 / cropped.height);
  return { png: cropped.toDataURL(), width: cropped.width * ratio, height: cropped.height * ratio };
}

export function isoDate() {
  const local = new Date();
  return [local.getFullYear(), String(local.getMonth() + 1).padStart(2, '0'),
    String(local.getDate()).padStart(2, '0')].join('-');
}

export async function savePdf(bytes, preview, placements, values = {}) {
  const pdf = await PDFDocument.load(bytes, { updateMetadata: false });
  await fillFields(pdf, values);
  const views = new Map();
  const images = new Map();
  for (const item of placements) {
    if (!views.has(item.page)) {
      const page = await preview.getPage(item.page);
      views.set(item.page, page.getViewport({ scale: 1 }));
    }
    if (!images.has(item.png)) images.set(item.png, await pdf.embedPng(item.png));
    const view = views.get(item.page);
    drawStamp(pdf.getPage(item.page - 1), images.get(item.png), item,
      (x, y) => view.convertToPdfPoint(x, y));
  }
  return pdf.save({ updateFieldAppearances: false });
}

export async function validatePdf(bytes) {
  return describeForm(await PDFDocument.load(bytes, { updateMetadata: false }));
}
