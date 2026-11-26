import { readFile } from 'node:fs/promises';
import { extname, isAbsolute } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PDFDocument, PDFNumber, StandardFonts } from 'pdf-lib';
import { z } from 'zod';
import { readProfile, writeCopy } from './storage.mjs';
import { describeForm, fillFields } from '../src/form-fields.mjs';
import { drawStamp, stampGeometry } from '../src/placement.mjs';

const server = new McpServer({ name: 'pdf', version: '1.0.0' });
const absolutePdf = z.string().refine(path => isAbsolute(path) && extname(path).toLowerCase() === '.pdf', 'Use an absolute PDF path.');
const date = z.iso.date();

function response(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function register(name, description, inputSchema, operation, annotations = { readOnlyHint: true }) {
  server.registerTool(name, { description, inputSchema, annotations }, async input => {
    try {
      return response(await operation(input));
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: error.message }] };
    }
  });
}

async function readPdf(path) {
  return PDFDocument.load(await readFile(path), { updateMetadata: false });
}

function visiblePage(page) {
  const crop = page.getCropBox();
  const media = page.getMediaBox();
  let left = Math.max(crop.x, media.x);
  let bottom = Math.max(crop.y, media.y);
  let right = Math.min(crop.x + crop.width, media.x + media.width);
  let top = Math.min(crop.y + crop.height, media.y + media.height);
  if (right <= left || top <= bottom) {
    ({ x: left, y: bottom } = media);
    right = left + media.width;
    top = bottom + media.height;
  }
  const unit = page.node.lookupMaybe(page.doc.context.obj('UserUnit'), PDFNumber)?.asNumber() || 1;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const turned = rotation === 90 || rotation === 270;
  const toPdf = (x, y) => {
    x /= unit;
    y /= unit;
    switch (rotation) {
      case 90: return [left + y, bottom + x];
      case 180: return [right - x, bottom + y];
      case 270: return [right - y, top - x];
      default: return [left + x, top - y];
    }
  };
  return { width: (turned ? top - bottom : right - left) * unit,
    height: (turned ? right - left : top - bottom) * unit, toPdf };
}

register('list_saved_items', 'List desktop PDF preset IDs, labels and default dimensions in points.', {}, async () => [
  { id: 'today', label: 'Today’s date', kind: 'date', width: 68, height: 17 },
  ...(await readProfile()).map(({ id, label, kind, width, height }) => ({ id, label, kind, width, height })),
]);

register('inspect_pdf', 'Get PDF page sizes in displayed orientation. Coordinates are measured from the top-left in points.', {
  path: absolutePdf,
}, async ({ path }) => (await readPdf(path)).getPages().map((page, index) => {
  const { width, height } = visiblePage(page);
  return { page: index + 1, width, height };
}));

register('list_form_fields', 'List AcroForm field names, values, types and allowed choices in a local PDF.', {
  path: absolutePdf,
}, async ({ path }) => describeForm(await readPdf(path)));

const fieldValues = z.record(z.string().min(1), z.union([z.string(), z.boolean(), z.array(z.string()), z.null()]))
  .refine(values => Object.keys(values).length > 0, 'Provide at least one field.');

register('fill_pdf_form', 'Set interactive AcroForm values and save a separate local PDF. Use booleans for checkboxes, strings for text and single choices, arrays for multiple choices, or null to clear a choice.', {
  input_path: absolutePdf,
  output_path: absolutePdf,
  values: fieldValues,
}, async ({ input_path, output_path, values }) => {
  const pdf = await readPdf(input_path);
  await fillFields(pdf, values);
  await saveOutput(output_path, pdf);
  return { path: output_path, filled: Object.keys(values).length };
}, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });

async function saveOutput(path, pdf) {
  try {
    await writeCopy(path, await pdf.save({ updateFieldAppearances: false }));
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error('Output already exists. Choose a new PDF path.');
    throw error;
  }
}

register('stamp_pdf', 'Apply saved desktop items to a local PDF and create a separate output PDF. Pass a signature preset only when the user has authorized signing this document. Coordinates are in displayed points from the top-left.', {
  input_path: absolutePdf,
  output_path: absolutePdf,
  placements: z.array(z.object({
    preset_id: z.string().min(1),
    page: z.number().int().positive(),
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive().optional(),
    date: date.optional().describe('ISO date override for the today preset. Defaults to the machine’s local date.'),
  })).min(1).max(200),
}, async ({ input_path, output_path, placements }) => {
  const [pdf, items] = await Promise.all([readPdf(input_path), readProfile()]);
  const presets = new Map(items.map(item => [item.id, item]));
  const images = new Map();
  let font;
  for (const item of placements) {
    if (item.page > pdf.getPageCount()) throw new Error('Page ' + item.page + ' does not exist.');
    const page = pdf.getPage(item.page - 1);
    const view = visiblePage(page);
    const isDate = item.preset_id === 'today';
    const preset = isDate ? { width: 68, height: 17 } : presets.get(item.preset_id);
    if (!preset) throw new Error('Unknown saved item ' + item.preset_id + '.');
    if (item.date && !isDate) throw new Error('The date override applies only to the today preset.');
    const width = item.width ?? preset.width;
    const height = preset.height * width / preset.width;
    if (item.x + width > view.width || item.y + height > view.height) {
      throw new Error('Item ' + item.preset_id + ' does not fit on page ' + item.page + '.');
    }
    const placement = { ...item, width, height };
    if (isDate) {
      font ??= await pdf.embedFont(StandardFonts.Helvetica);
      const geometry = stampGeometry(placement, view.toPdf);
      const value = item.date ?? new Intl.DateTimeFormat('sv-SE').format(new Date());
      const offset = 2 * geometry.width / 68;
      const angle = geometry.rotate.angle;
      page.drawText(value, {
        x: geometry.x + offset * (Math.cos(angle) - Math.sin(angle)),
        y: geometry.y + offset * (Math.sin(angle) + Math.cos(angle)),
        size: 12 * geometry.width / 68, rotate: geometry.rotate, font,
      });
    } else {
      if (!images.has(preset.id)) images.set(preset.id, await pdf.embedPng(preset.png));
      drawStamp(page, images.get(preset.id), placement, view.toPdf);
    }
  }
  await saveOutput(output_path, pdf);
  return { path: output_path, placed: placements.length };
}, { readOnlyHint: false, destructiveHint: false, openWorldHint: false });

await server.connect(new StdioServerTransport());

