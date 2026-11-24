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
  sections: ReportSection[];
}

export const reportTimeZone = 'Europe/Istanbul';
const scanRequestStatus = { pending: 'Onay bekliyor', approved: 'Onaylandı', rejected: 'Reddedildi' } as const;

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

export type CoreReportData = {
  kind: 'summary';
  byStore: boolean;
  rows: { name: string | null; entries: number; decisions: number; pending: number }[];
} | {
  kind: 'history';
  rows: {
    time: string; name: string; code: string; lot: string; store: string; department: string[];
    operation: string; staff: string; actor?: string; choice: string; reason?: string; result?: string; destination?: string;
  }[];
};

export function coreReport(data: CoreReportData, language: Language): Report {
  const t = (text: string) => translate(language, text);
  const date = reportDate(language);
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
    sections: [reportSection(language, 'history', 'Karar kayıtları', [
      ['date', 'Tarih ve saat', 22], ['product', 'Ürün', 25], ['barcode', 'Barkod', 18], ['lot', 'Lot', 16],
      ['store', 'Mağaza', 22], ['department', 'Reyon', 24], ['operation', 'Operasyon', 23], ['staff', 'Personel', 28],
      ['actor', 'İşlemi yapan', 28], ['decision', 'Karar', 25], ['reason', 'Gerekçe', 37],
      ['result', 'Sonuç', 24], ['destination', 'Varış noktası', 24],
    ], data.rows.map(row => [date(row.time), row.name, row.code, row.lot, reportStoreName(language, row.store), row.department.map(t).join(' · '),
      t(Object.hasOwn(operationNames, row.operation) ? operationNames[row.operation] : row.operation), row.staff, row.actor ?? null,
      t(row.choice === 'Blokaj devam' ? 'Blokajı sürdür' : row.choice), row.reason ?? null,
      row.result ? t(row.result === 'Blokaj devam' ? 'Blokaj sürüyor' : row.result) : null, row.destination ?? null]))],
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
