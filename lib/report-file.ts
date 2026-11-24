import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { SheetData } from 'write-excel-file/universal';
import { translate } from './language';
import { reportTimeZone, type Report } from './report-data';

export type ReportFormat = 'pdf' | 'xlsx' | 'json';

const colors = { title: '#12372d', header: '#e2eee7', alternate: '#f5f9f6', line: '#cbd9d1' };

function reportText(report: Report) {
  const locale = report.language === 'tr' ? 'tr-TR' : 'en-GB';
  const number = new Intl.NumberFormat(locale);
  return {
    number,
    count: (count: number) => translate(report.language, 'Kayıt sayısı: {count}', { count: number.format(count) }),
    empty: translate(report.language, 'Raporlanacak kayıt bulunamadı.'),
  };
}

function excelTextLines(text: string, width: number) {
  const lineWidth = Math.max(1, Math.floor(width * 0.85));
  return text.split(/\r\n?|\n/).reduce((lines, line) => {
    let used = 0;
    let wrapped = 1;
    for (const word of line.split(/\s+/)) {
      const remaining = used ? lineWidth - used - 1 : lineWidth;
      if (word.length > remaining && used) { wrapped++; used = 0; }
      if (word.length > lineWidth) wrapped += Math.floor((word.length - 1) / lineWidth);
      used = used ? used + 1 + word.length : (word.length - 1) % lineWidth + 1;
    }
    return lines + wrapped;
  }, 0);
}

function jsonReport(report: Report) {
  const { title, language, date, sections } = report;
  const data = { title, language, timeZone: reportTimeZone, ...(date && { date }), sections: sections.map(section => ({
    key: section.key, title: section.title,
    rowCount: section.rows.length,
    columnOrder: section.columns.map(column => column.key),
    columns: Object.fromEntries(section.columns.map(column => [column.key, column.title])),
    rows: section.rows.map(row => Object.fromEntries(section.columns.map((column, index) => [column.key, row[index] ?? null]))),
    ...(section.note && { note: section.note }),
  })) };
  return new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
}

async function excelReport(report: Report) {
  const { default: writeExcelFile } = await import('write-excel-file/universal');
  const { count, empty } = reportText(report);
  return writeExcelFile(report.sections.map(section => {
    const columnSpan = section.columns.length;
    const title = section.title === report.title ? report.title : `${report.title} · ${section.title}`;
    const rows: SheetData = section.rows.map((row, index) => {
      const backgroundColor = index % 2 ? colors.alternate : '#ffffff';
      return row.map((value, column) => {
        const style = { backgroundColor, bottomBorderStyle: 'thin', bottomBorderColor: colors.line, alignVertical: 'top' } as const;
        if (value == null) return style;
        if (typeof value === 'number') return { ...style, value, type: Number, align: 'right',
          ...(Number.isInteger(value) && { format: '#,##0' }) };
        const text = value.toWellFormed().replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
        const height = Math.min(409, 6 + 15 * excelTextLines(text, section.columns[column].width));
        return { ...style, value: text, type: String, wrap: true, height };
      });
    });
    return {
      sheet: section.title.replace(/[\\/:?*\[\]]/g, ' ').slice(0, 31).trim(),
      stickyRowsCount: 3,
      showGridLines: false,
      columns: section.columns.map(({ width }) => ({ width })),
      data: [
        [{ value: title, columnSpan, fontSize: 14, fontWeight: 'bold', height: 26, textColor: '#ffffff', backgroundColor: colors.title }],
        [{ value: count(section.rows.length), columnSpan, height: 20 }],
        section.columns.map(({ title }) => ({ value: title, fontWeight: 'bold', backgroundColor: colors.header,
          textColor: colors.title, wrap: true, alignVertical: 'center', height: 32 })),
        ...(rows.length ? rows : [[{ value: empty, columnSpan, height: 20 }]]),
        ...(section.note ? [[{ value: section.note, columnSpan, fontStyle: 'italic' as const }]] : []),
      ] satisfies SheetData,
    };
  })).toBlob();
}

async function pdfReport(report: Report) {
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'),
  ]);
  pdfMake.addVirtualFileSystem(fonts);
  const t = (text: string) => translate(report.language, text);
  const maxColumns = Math.max(...report.sections.map(section => section.columns.length));
  const large = maxColumns > 8;
  const landscape = maxColumns > 4;
  const pageWidth = large ? 1190.55 : landscape ? 841.89 : 595.28;
  const margin = 32;
  const { number, count, empty } = reportText(report);
  const content: Content[] = [{ text: report.title, fontSize: 21, bold: true, color: colors.title, margin: [0, 0, 0, 10] }];
  for (const section of report.sections) {
    content.push({ headlineLevel: 1, unbreakable: true, margin: [0, 8, 0, 6], stack: [
      ...(section.title === report.title ? [] : [{ text: section.title, fontSize: 13, bold: true, color: colors.title }]),
      { text: count(section.rows.length), fontSize: 9 },
    ] });
    const totalWidth = section.columns.reduce((sum, column) => sum + column.width, 0);
    const availableWidth = pageWidth - margin * 2 - section.columns.length * 8;
    const widths = section.columns.map(column => availableWidth * column.width / totalWidth);
    const body: TableCell[][] = section.rows.map(row => row.map((value, index) => {
      if (typeof value === 'number') return { text: number.format(value), alignment: 'right' };
      const text = value ?? '';
      const longWord = text.split(/\s+/).some(word => word.length * 8 > widths[index]);
      return { text, wordBreak: longWord ? 'break-all' : 'normal' };
    }));
    if (!body.length) body.push([{ text: empty, colSpan: section.columns.length }, ...section.columns.slice(1).map(() => '')]);
    content.push({
      layout: {
        hLineWidth: () => 0.5, hLineColor: () => colors.line, vLineWidth: () => 0,
        paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5,
        fillColor: row => row === 0 ? colors.header : row % 2 === 0 ? colors.alternate : null,
      },
      table: { headerRows: 1, keepWithHeaderRows: 1, dontBreakRows: true, widths,
        body: [section.columns.map(column => ({ text: column.title, bold: true, color: colors.title })), ...body],
      },
    });
    if (section.note) content.push({ text: section.note, italics: true, margin: [0, 4, 0, 0] });
  }
  const definition: TDocumentDefinitions = {
    info: { title: report.title },
    pageSize: large ? 'A3' : 'A4',
    pageOrientation: landscape ? 'landscape' : 'portrait',
    pageMargins: [margin, margin, margin, margin + 6],
    defaultStyle: { font: 'Roboto', fontSize: 9 },
    footer: (page, pages) => ({ text: `${t('Sayfa')} ${page} / ${pages}`, alignment: 'right', fontSize: 8, margin: [margin, 8] }),
    pageBreakBefore: (node, container) => node.headlineLevel === 1 && container.getFollowingNodesOnPage().length === 0,
    content,
  };
  return pdfMake.createPdf(definition).getBlob();
}

export function createReportFile(report: Report, format: ReportFormat): Blob | Promise<Blob> {
  for (const { key, columns, rows } of report.sections) {
    if (!columns.length || new Set(columns.map(column => column.key)).size !== columns.length ||
      rows.some(row => row.length !== columns.length)) throw new Error(`Invalid report table: ${key}`);
  }
  if (format === 'json') return jsonReport(report);
  if (format === 'xlsx') return excelReport(report);
  return pdfReport(report);
}
