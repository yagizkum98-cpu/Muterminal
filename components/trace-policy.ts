import type { TraceStage } from './trace-model';

export const traceRoles = {
  super: 'Süper Admin',
  company: 'Firma Admini',
  manager: 'Mağaza Yöneticisi',
  warehouse: 'Depo / Lojistik Yetkilisi',
  staff: 'Personel — Operasyon Kullanıcısı',
  auditor: 'Denetçi — Salt Okunur Kullanıcı',
} as const;

export type TraceRole = keyof typeof traceRoles;

export const traceRoleSummaries: Record<TraceRole, string> = {
  super: 'Firma, firma admini ve platform ayarları.',
  company: 'Firma kullanıcıları, lokasyonlar, depo hareketleri, geçmiş ve raporlar. Kontrol ve onay ayrı yetkilerdir.',
  manager: 'Kendi mağazasındaki personel, kontroller, onaylar, mağaza hareketleri ve raporlar.',
  warehouse: 'Atanmış depo lotları, depo ve lojistik hareketleri, teslim kontrolü onayları ve depo raporu.',
  staff: 'Atanmış mağazada ürün sorgusu, kontrol, karar talebi ve kendi kontrol özeti.',
  auditor: 'Seçilen mağaza veya firmada ürün, karar, işlem geçmişi ve raporları okuma.',
};

export interface TraceAccess {
  role: TraceRole;
  tenantId: string | null;
  storeIds: string[];
  warehouseId: string | null;
  canControl: boolean;
  canReview: boolean;
  canRecall: boolean;
  canManage: boolean;
  stages: TraceStage[];
}

export const traceChoices = ['İncelemeye sevk', 'Satılamaz', 'Depo iade incelemesi', 'Depo teslim kontrolü'] as const;
export const warehouseChoice = 'Depo teslim kontrolü';
