import { useTranslate } from './LanguagePicker';
import styles from './Mobile.module.css';

export type MobileSection = 'home' | 'lookup' | 'report' | 'management';

export default function MobileNav({ current, canLookup, canManage, personal }: {
  current: MobileSection; canLookup: boolean; canManage: boolean; personal: boolean;
}) {
  const t = useTranslate();
  const links = [
    { page: 'home', label: 'Ana ekran', href: '/mobil' },
    ...(canLookup ? [
      { page: 'lookup', label: 'Ürün tara', href: '/trace?mobil=1' },
      { page: 'report', label: personal ? 'Kontrollerim' : 'Raporlar', href: '/trace?mobil=1&bolum=rapor' },
    ] : []),
    ...(canManage ? [{ page: 'management', label: 'Yönetim', href: '/trace?mobil=1&bolum=yonetim' }] : []),
  ];
  return <nav className={styles.dock} aria-label={t("Mobil uygulama gezinmesi")}>
    {links.map(link => <a key={link.page} href={link.href} aria-current={current === link.page ? 'page' : undefined}>
      <span className={styles.navIcon} data-icon={link.page} aria-hidden="true" />{t(link.label)}
    </a>)}
  </nav>;
}
