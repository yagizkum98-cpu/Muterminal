export const notificationCategories = {
  control: 'Anlık kontrol',
  expiry: 'SKT takibi',
  operation: 'Önemli operasyonlar',
  warehouse: 'Depo yönetimi',
} as const;

export type NotificationCategory = keyof typeof notificationCategories;
