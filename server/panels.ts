export const panelTitles = {
  admin: 'MuTerminal Admin',
  manager: 'MuTerminal Manager',
  staff: 'MuTerminal Staff',
} as const;

export type PanelRole = keyof typeof panelTitles;

export const loginTitles: Record<PanelRole, string> = {
  admin: 'Admin girişi',
  manager: 'Yönetici girişi',
  staff: 'Personel girişi',
};

export function isPanel(value: unknown): value is PanelRole {
  return typeof value === 'string' && Object.hasOwn(panelTitles, value);
}
