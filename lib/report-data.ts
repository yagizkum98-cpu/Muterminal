import type { PersonalReport, TraceReport } from '../components/trace-model';
import { translate, type Language } from './language';

export type ReportCell = string | number | null;

export interface ReportSection {
  key: string;
  title: string;
  columns: { key: string; title: string; width: number }[];
  rows: ReportCell[][];
  note?: string;
}

export interface Report {
  language: Language;
  title: string;
  fileName: string;
  date?: string;
  sections: ReportSection[];
}

export const reportTimeZone = 'Europe/Istanbul';
const scanRequestStatus = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi', recheck: 'Ek kontrol istendi' } as const;

export interface ScanRequestRow {
  requestId: string;
  name: string;
  barcode: string;
  lot: string;
  choice: string;
  status: keyof typeof scanRequestStatus;
  time: string;
  reason: string;
  reviewReason: string | null;
}

export interface ScanActivity {
  pending: ScanRequestRow[];
  history: ScanRequestRow[];
}

const operationNames: Record<string, string> = {
  'RKS Blokaj': 'RKS blokajı', 'Delist Blokaj': 'Liste dışı ürün blokajı', 'Geçici Blokaj': 'Geçici blokaj',
  'SKT Kontrol': 'Son kullanma tarihi kontrolü', 'Depo İade': 'Depo iadesi', 'Depo Fark': 'Depo sayım farkı',
};

function reportStoreName(language: Language, name: string) {
  return name === 'Pilot Mağaza' ? translate(language, name) : name;
}

function reportDate(language: Language) {
  const format = new Intl.DateTimeFormat(language === 'tr' ? 'tr-TR' : 'en-GB', {
    dateStyle: 'medium', timeStyle: 'short', timeZone: reportTimeZone,
  });
  return (value?: string) => value && Number.isFinite(Date.parse(value)) ? format.format(new Date(value)) : null;
}

function reportSection(language: Language, key: string, title: string, columns: [string, string, number][],
  rows: ReportCell[][], note?: string): ReportSection {
  return {
    key, title: translate(language, title),
    columns: columns.map(([key, title, width]) => ({ key, title: translate(language, title), width })),
    rows, ...(note && { note: translate(language, note) }),
  };
}

interface CoreRecord {
  name: string;
  code: string;
  lot: string;
  store: string;
  department: string[];
  operation: string;
}

interface CoreHistoryRow extends CoreRecord {
  time: string;
  staff: string;
  actor?: string;
  choice: string;
  reason?: string;
  result?: string;
  destination?: string;
}

interface CoreProductRow extends CoreRecord {
  createdAt?: string;
  qty: number | null;
  status: string;
  risk?: { label: string } | null;
  pending?: boolean;
  assessment?: string;
  missingDetails?: boolean;
  fields: { label: string; type: string; value?: string | number | null }[];
}

interface DepartmentScope {
  department: string[];
  store: string | null;
}

export type CoreReportData = {
  kind: 'summary';
  byStore: boolean;
  rows: { name: string | null; entries: number; decisions: number; pending: number }[];
} | {
  kind: 'history';
  rows: CoreHistoryRow[];
} | {
  kind: 'operation';
  scope: DepartmentScope;
  operation: string;
  date?: string;
  quantityLabel: string;
  groups: { day: string; products: CoreProductRow[] }[];
} | {
  kind: 'department';
  scope: DepartmentScope;
  products: CoreProductRow[];
  history: CoreHistoryRow[];
} & ({ date?: never; scheduled?: never } | { date: string; scheduled: (CoreRecord & { label: string; value: string })[] });

const coreRecordColumns: [string, string, number][] = [
  ['product', 'Ürün', 25], ['barcode', 'Barkod', 18], ['lot', 'Lot', 16], ['store', 'Mağaza', 22],
  ['department', 'Reyon', 24], ['operation', 'Operasyon', 23],
];

function coreRecordCells(row: CoreRecord, language: Language): ReportCell[] {
  return [row.name, row.code, row.lot, reportStoreName(language, row.store), row.department.map(name => translate(language, name)).join(' · '),
    reportOperationName(language, row.operation)];
}

function reportOperationName(language: Language, operation: string) {
  return translate(language, Object.hasOwn(operationNames, operation) ? operationNames[operation] : operation);
}

function coreHistorySection(rows: CoreHistoryRow[], language: Language): ReportSection {
  const t = (text: string) => translate(language, text);
  const date = reportDate(language);
  return reportSection(language, 'history', 'Karar kayıtları', [
    ['date', 'Tarih ve saat', 22], ...coreRecordColumns, ['staff', 'Personel', 28],
    ['actor', 'İşlemi yapan', 28], ['decision', 'Karar', 25], ['reason', 'Gerekçe', 37],
    ['result', 'Sonuç', 24], ['destination', 'Varış noktası', 24],
  ], rows.map(row => [date(row.time), ...coreRecordCells(row, language), row.staff, row.actor ?? null,
    t(row.choice === 'Blokaj devam' ? 'Blokajı sürdür' : row.choice), row.reason ?? null,
    row.result ? t(row.result === 'Blokaj devam' ? 'Blokaj sürüyor' : row.result) : null, row.destination ?? null]));
}

function reportFileStem(language: Language, parts: string[]) {
  return parts.join('-').toLocaleLowerCase(language).normalize('NFD')
    .replace(/\p{M}/gu, '').replaceAll('ı', 'i').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
}

function scopeNames(language: Language, scope: DepartmentScope) {
  return [scope.department.map(name => translate(language, name)).join(' · '),
    scope.store ? reportStoreName(language, scope.store) : translate(language, 'Tüm mağazalar')];
}

function calendarDateValue(language: Language) {
  const locale = language === 'tr' ? 'tr-TR' : 'en-GB';
  const localDate = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const localDateTime = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' });
  // Calendar dates and Türkiye wall-clock times are stored without an offset.
  return (value: string, withTime = false) => {
    const instant = Date.parse(withTime ? `${value}Z` : value);
    return Number.isFinite(instant) ? (withTime ? localDateTime : localDate).format(instant) : value;
  };
}

function productTable(language: Language, quantityLabel: string, includeDecisionStatus = false) {
  const t = (text: string) => translate(language, text);
  const date = reportDate(language);
  const calendarValue = calendarDateValue(language);
  const number = new Intl.NumberFormat(language === 'tr' ? 'tr-TR' : 'en-GB');
  const detailValue = ({ value, type }: CoreProductRow['fields'][number]) => {
    if (typeof value === 'number') return number.format(value);
    if (typeof value !== 'string') return '';
    return type === 'date' || type === 'datetime-local' ? calendarValue(value, type === 'datetime-local') : value;
  };
  const columns: [string, string, number][] = [
    ['date', 'Kayıt tarihi', 22], ...coreRecordColumns, ['quantity', quantityLabel, 16],
    ['status', 'Durum', 24], ['risk', 'Risk', 25], ['details', 'Operasyon bilgileri', 40],
  ];
  return (key: string, title: string, rows: CoreProductRow[]) => reportSection(language, key, title, columns, rows.map(row => {
    const status = [t(row.status)];
    if (includeDecisionStatus) {
      if (row.pending && row.status !== 'Onay bekliyor') status.push(t('Onay bekliyor'));
      if (row.assessment) status.push(`MuDecision · ${t(row.assessment)}`);
    }
    const details = row.fields.filter(field => field.value != null && field.value !== '')
      .map(field => `${t(field.label)} · ${detailValue(field)}`).join('\n');
    return [date(row.createdAt), ...coreRecordCells(row, language), row.qty, status.join('\n'), row.risk ? t(row.risk.label) : null,
      details || (includeDecisionStatus && row.missingDetails ? t('Operasyon bilgileri eksik') : null)];
  }));
}

function operationReport(data: Extract<CoreReportData, { kind: 'operation' }>, language: Language): Report {
  const t = (text: string) => translate(language, text);
  const calendarValue = calendarDateValue(language);
  const names = [t('Operasyon kayıtları'), reportOperationName(language, data.operation), ...scopeNames(language, data.scope)];
  const fileName = reportFileStem(language, names);
  const section = productTable(language, data.quantityLabel, true);
  const sections = data.groups.map(({ day, products }) => section(day || 'undated',
    day ? calendarValue(day) : 'Kayıt tarihi bilinmiyor', products));
  return {
    language,
    title: names.join(' · '),
    fileName: ['muterminal', fileName.slice(0, 150), ...(data.date ? [data.date] : []), language].join('-'),
    ...(data.date && { date: data.date }),
    sections: sections.length ? sections : [section('operations', 'Operasyon kayıtları', [])],
  };
}

function departmentReport(data: Extract<CoreReportData, { kind: 'department' }>, language: Language): Report {
  const names = [translate(language, 'Reyon raporu'), ...scopeNames(language, data.scope)];
  const fileName = reportFileStem(language, names);
  const calendarValue = calendarDateValue(language);
  return {
    language,
    title: [...names, ...(data.date ? [calendarValue(data.date)] : [])].join(' · '),
    fileName: ['muterminal', fileName.slice(0, 150), ...(data.date ? [data.date] : []), language].join('-'),
    ...(data.date && { date: data.date }),
    sections: [
      productTable(language, 'Adet / Sayım farkı')('products', 'Ürün kayıtları', data.products),
      coreHistorySection(data.history, language),
      ...(data.scheduled ? [reportSection(language, 'scheduled', 'Planlanan tarihler', [
        ['date', 'Tarih ve saat', 22], ...coreRecordColumns, ['event', 'Takvim kaydı', 30],
      ], data.scheduled.map(row => [calendarValue(row.value, row.value.includes('T')), ...coreRecordCells(row, language), translate(language, row.label)]))] : []),
    ],
  };
}

export function coreReport(data: CoreReportData, language: Language): Report {
  const t = (text: string) => translate(language, text);
  if (data.kind === 'department') return departmentReport(data, language);
  if (data.kind === 'operation') return operationReport(data, language);
  if (data.kind === 'summary') {
    const title = data.byStore ? 'Mağaza raporları' : 'Personel performansı';
    const rows = data.rows.map(row => [row.name === null ? t('Önceki kayıtlar') : reportStoreName(language, row.name), row.entries, row.decisions, row.pending]);
    rows.sort((a, b) => String(a[0]).localeCompare(String(b[0]), language));
    return { language, title: t(title), fileName: language === 'tr' ? 'muterminal-operasyon-raporu' : 'muterminal-operations-report',
      sections: [reportSection(language, 'operations', title, [
        ['name', data.byStore ? 'Mağaza' : 'Personel', 34], ['entries', 'Kontrol kayıtları', 22],
        ['decisions', 'Karar işlemleri', 22], ['pending', 'Bekleyen talepler', 22],
      ], rows)],
    };
  }

  return { language, title: t('Karar geçmişi raporu'), fileName: language === 'tr' ? 'muterminal-karar-gecmisi' : 'muterminal-decision-history',
    sections: [coreHistorySection(data.rows, language)],
  };
}

export function traceReport(data: TraceReport | PersonalReport, language: Language): Report {
  const t = (text: string) => translate(language, text);
  const date = reportDate(language);
  if ('personal' in data) {
    return { language, title: t('Kişisel kontrol raporu'), fileName: language === 'tr' ? 'mu-trace-kisisel-kontrol-raporu' : 'mu-trace-personal-check-report',
      sections: [reportSection(language, 'personal', 'Kontrol özeti', [
        ['controls', 'Toplam kontrol', 22], ['reviewed', 'İncelenen kontroller', 26], ['pending', 'Onay bekleyen kontroller', 30],
      ], [[data.personal.controls, data.personal.reviewed, data.personal.pending]])],
    };
  }

  const storeName = (id: string) => reportStoreName(language, Object.hasOwn(data.locations, id) ? data.locations[id] : id);
  const lotColumns: [string, string, number][] = [
    ['store', 'Mağaza', 23], ['product', 'Ürün', 28], ['barcode', 'Barkod', 18], ['lot', 'Lot', 16],
  ];
  const lotCells = (lot: Pick<TraceReport['risks'][number], 'storeId' | 'name' | 'barcode' | 'lot'>): ReportCell[] =>
    [storeName(lot.storeId), lot.name, lot.barcode, lot.lot];
  return { language, title: t('MU TRACE izlenebilirlik raporu'), fileName: language === 'tr' ? 'mu-trace-izlenebilirlik-raporu' : 'mu-trace-traceability-report',
    sections: [
      reportSection(language, 'stores', 'Mağaza bazında operasyon özeti', [
        ['store', 'Mağaza', 27], ['lots', 'Lot sayısı', 14], ['operations', 'Operasyon sayısı', 19], ['decisions', 'Karar sayısı', 16],
        ['pending', 'Bekleyen talepler', 20], ['movements', 'Hareket sayısı', 18], ['openRecalls', 'Açık geri çağırmalar', 23],
      ], data.stores.map(store => [storeName(store.storeId), store.lots, store.operations, store.decisions, store.pending, store.movements, store.openRecalls])),
      reportSection(language, 'pending', 'Onay bekleyen talepler', [...lotColumns,
        ['decision', 'Talep', 26], ['date', 'Tarih ve saat', 22],
      ], data.pending.map(item => [...lotCells(item), t(item.choice), date(item.time)]),
      data.pending.length === 100 ? 'Son 100 talep gösteriliyor.' : undefined),
      reportSection(language, 'recalls', 'Açık geri çağırmalar', [...lotColumns,
        ['date', 'Tarih ve saat', 22], ['note', 'Geri çağırma notu', 38],
      ], data.recalls.map(item => [...lotCells(item), date(item.time), item.note])),
      reportSection(language, 'risks', 'Kontrol gerektiren lotlar', [...lotColumns, ['risk', 'Risk', 28]],
        data.risks.map(item => [...lotCells(item), t(item.risk === 'SKT geçmiş' ? 'Son kullanma tarihi geçmiş'
          : item.risk === 'SKT yaklaşıyor' ? 'Son kullanma tarihi yaklaşıyor' : item.risk)]),
        data.risks.length === 100 ? 'İlk 100 risk kaydı gösteriliyor.' : undefined),
    ],
  };
}

export function scanReport(activity: ScanActivity, language: Language): Report {
  const t = (text: string) => translate(language, text);
  const date = reportDate(language);
  const columns: [string, string, number][] = [
    ['date', 'Tarih ve saat', 22], ['product', 'Ürün', 27], ['barcode', 'Barkod', 18], ['lot', 'Lot', 16],
    ['decision', 'Karar', 25], ['status', 'Durum', 19], ['reason', 'Gerekçe', 44],
  ];
  const cells = (item: ScanRequestRow): ReportCell[] => [date(item.time), item.name, item.barcode, item.lot,
    t(item.choice), t(scanRequestStatus[item.status]), item.reason];

  return {
    language, title: t('MuTerminal Scan işlem geçmişi'),
    fileName: language === 'tr' ? 'muterminal-scan-islem-gecmisi' : 'muterminal-scan-activity-history',
    sections: [
      reportSection(language, 'pending', 'Onay bekleyen talepler', columns, activity.pending.map(cells)),
      reportSection(language, 'resolved', 'Sonuçlanan talepler', [...columns, ['reviewReason', 'Yönetici gerekçesi', 44]],
        activity.history.filter(item => item.status !== 'pending').map(item => [...cells(item), item.reviewReason]),
        activity.history.length === 50 ? 'Sonuçlanan talepler, en son 50 işlem arasından gösteriliyor.' : undefined),
    ],
  };
}
