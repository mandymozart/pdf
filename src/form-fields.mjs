import { PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, StandardFonts } from 'pdf-lib';

const isChoice = field => field instanceof PDFDropdown || field instanceof PDFOptionList;

function describe(field) {
  const base = { name: field.getName(), required: field.isRequired(), readOnly: field.isReadOnly() };
  if (field instanceof PDFTextField && !field.isFileSelector()) {
    return { ...base, type: 'text', value: field.getText() ?? '', multiline: field.isMultiline(), maxLength: field.getMaxLength() };
  }
  if (field instanceof PDFCheckBox) return { ...base, type: 'checkbox', value: field.isChecked() };
  if (field instanceof PDFRadioGroup) return { ...base, type: 'radio', options: field.getOptions(), value: field.getSelected() ?? null };
  if (isChoice(field)) {
    const multiple = field.isMultiselect();
    const selected = field.getSelected();
    return { ...base, type: 'choice', options: field.getOptions(), multiple, value: multiple ? selected : selected[0] ?? null };
  }
  return { ...base, type: 'unsupported' };
}

export function describeForm(pdf) {
  const form = pdf.getForm();
  const xfa = form.hasXFA();
  return { xfa, fields: xfa ? [] : form.getFields().map(describe) };
}

export async function fillFields(pdf, values) {
  const entries = Object.entries(values);
  if (!entries.length) return;
  const form = pdf.getForm();
  if (form.hasXFA()) throw new Error('XFA forms are unsupported.');
  const fields = new Map(form.getFields().map(field => [field.getName(), field]));
  let font;
  for (const [name, value] of entries) {
    const field = fields.get(name);
    if (!field) throw new Error('Unknown field ' + name + '.');
    if (field.isReadOnly()) throw new Error('Field ' + name + ' is read-only.');
    try {
      if (field instanceof PDFTextField && !field.isFileSelector() && typeof value === 'string') {
        field.setText(value);
      } else if (field instanceof PDFCheckBox && typeof value === 'boolean') {
        if (value) field.check();
        else field.uncheck();
      } else if (field instanceof PDFRadioGroup && (value === null || field.getOptions().includes(value))) {
        if (value === null) field.clear();
        else field.select(value);
      } else if (isChoice(field)) {
        const selected = value === null ? [] : Array.isArray(value) ? value : [value];
        const options = field.getOptions();
        if ((!field.isMultiselect() && selected.length > 1) || selected.some(option => !options.includes(option))) {
          throw new Error('Choose from the listed options.');
        }
        if (selected.length) field.select(selected);
        else field.clear();
      } else {
        throw new Error('Use the field’s listed value type and options.');
      }
      if (field.needsAppearancesUpdate()) {
        if (field instanceof PDFCheckBox || field instanceof PDFRadioGroup) field.updateAppearances();
        else {
          font ??= await pdf.embedFont(StandardFonts.Helvetica);
          field.updateAppearances(font);
        }
      }
    } catch (error) {
      throw new Error('Field ' + name + '. ' + error.message);
    }
  }
}
