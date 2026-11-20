import { useTranslate } from './LanguagePicker';
import styles from './Mobile.module.css';

export type MobileSection = 'home' | 'lookup' | 'report' | 'management';

export default function MobileNav({ current, canLookup, canManage, personal, warehouse }: {
  current: MobileSection; canLookup: boolean; canManage: boolean; personal: boolean; warehouse?: boolean;
}) {
  const t = useTranslate();
  const traceHref = warehouse ? '/trace?mobil=1&panel=depo' : '/trace?mobil=1';
  const links = [
    { page: 'home', label: 'Ana ekran', href: warehouse ? '/mobil?panel=depo' : '/mobil' },
    ...(canLookup ? [
      { page: 'lookup', label: 'Ürün tara', href: traceHref },
      { page: 'report', label: personal ? 'Kontrollerim' : 'Raporlar', href: `${traceHref}&bolum=rapor` },
    ] : []),
    ...(canManage ? [{ page: 'management', label: 'Yönetim', href: '/trace?mobil=1&bolum=yonetim' }] : []),
  ];
  return <nav className={styles.dock} aria-label={t("Mobil uygulama gezinmesi")}>
    {links.map(link => <a key={link.page} href={link.href} aria-current={current === link.page ? 'page' : undefined}>
      <span className={styles.navIcon} data-icon={link.page} aria-hidden="true" />{t(link.label)}
    </a>)}
  </nav>;
}
