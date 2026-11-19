export const traceStages = {
  production: 'Üretim',
  processing: 'İşleme',
  storage: 'Depolama',
  logistics: 'Lojistik',
  store: 'Mağaza',
  consumer: 'Tüketici',
} as const;

export type TraceStage = keyof typeof traceStages;

export interface TraceEvent {
  id: string;
  kind: 'movement' | 'recall_opened' | 'recall_closed';
  time: string;
  actor?: string;
  note: string;
  stage: TraceStage | null;
  origin: string | null;
  location: string | null;
  quantity: number | null;
  activeRecall?: boolean;
}

export interface TraceOperation {
  id: string;
  type: string;
  status: string;
  time?: string;
  qty?: number;
  risk?: { label: string; level: string } | null;
  details?: Record<string, string | number>;
  decisions: { time: string; choice: string; result?: string; reason?: string; actor?: string; source?: string }[];
}

export interface TraceControl {
  id: string;
  actor: string;
  choice: string;
  time: string;
  note: string;
  location: string;
  checks: { rks: string; expiryDate: string | null; condition: string; expired: boolean | null; legacyChoice?: string };
  canReview: boolean;
  outcome: 'approve' | 'reject' | 'recheck' | null;
  reviewer: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  followupOf: string | null;
  hasFollowup: boolean;
}

export interface TraceLot {
  name: string;
  barcode: string;
  lot: string;
  storeId: string;
  storeName: string;
  expiryDates: string[];
  rksBlocked: boolean;
  events: TraceEvent[];
  operations: TraceOperation[];
  controls: TraceControl[];
  warehouses: { id: string; name: string }[];
}

export type PersonalReport = { personal: { controls: number; reviewed: number; pending: number } };

export interface TraceReport {
  locations: Record<string, string>;
  stores: { storeId: string; lots: number; operations: number; decisions: number; pending: number; movements: number; openRecalls: number }[];
  recalls: (TraceEvent & Pick<TraceLot, 'storeId' | 'barcode' | 'lot' | 'name'>)[];
  risks: (Pick<TraceLot, 'storeId' | 'barcode' | 'lot' | 'name'> & { risk: string })[];
  pending: (Pick<TraceLot, 'storeId' | 'barcode' | 'lot' | 'name'> & { id: string; choice: string; time: string })[];
}
