import LanguagePicker, { useTranslate } from '../components/LanguagePicker';
import { languageFromCookie } from '../lib/language';
import Head from 'next/head';
import { useEffect, useState } from 'react';
import type { GetServerSideProps } from 'next';
import MobileNav from '../components/MobileNav';
import NotificationSettings from '../components/NotificationSettings';
import ChangePassword from '../components/ChangePassword';
import styles from '../components/Mobile.module.css';
import { traceRoles, type TraceRole } from '../components/trace-policy';
import { getSession } from '../server/application';
import { resolveTraceAccess } from '../server/trace-access';
import { scanEnabled } from '../server/features';
import { mobileStaffState, type MobileStaffState } from '../server/mobile-access';

interface Props {
  account: { role: TraceRole; name: string; canManage: boolean; corePath: string | null; canScan: boolean } | null;
  approval: MobileStaffState;
  invalidCode: boolean;
}

export const getServerSideProps: GetServerSideProps<Props> = async ({ req, res, query }) => {
  res.setHeader('Cache-Control', 'no-store');
  const session = await getSession(req, query.panel === 'depo' ? 'depo' : 'trace');
  const language = languageFromCookie(req.headers.cookie);
  if (!session) return { props: { account: null, approval: 'allowed', invalidCode: false, language } };
  const [access, approval] = await Promise.all([resolveTraceAccess(session), mobileStaffState(session)]);
  return { props: { account: {
    role: access.role, name: session.displayName ?? session.email, canManage: access.canManage,
    corePath: session.canSwitchPanels ? '/admin?mobil=1' : session.role === 'trace' ? null : `/${session.role}?mobil=1`,
    canScan: (session.role === 'staff' || session.canSwitchPanels === true) && scanEnabled(session),
  }, approval, invalidCode: query.onay === 'hata', language } };
};

export default function MobileHome({ account, approval, invalidCode }: Props) {
  const t = useTranslate();
  const [offline, setOffline] = useState(false);
  const canLookup = Boolean(account && account.role !== 'super');
  const warehouse = account?.role === 'warehouse';
  const traceHref = warehouse ? '/trace?mobil=1&panel=depo' : '/trace?mobil=1';
  const personal = account?.role === 'staff';
  const locked = account && approval !== 'allowed';

  useEffect(() => {
    const checkConnection = () => setOffline(!navigator.onLine);
    checkConnection();
    window.addEventListener('online', checkConnection);
    window.addEventListener('offline', checkConnection);
    return () => {
      window.removeEventListener('online', checkConnection);
      window.removeEventListener('offline', checkConnection);
    };
  }, []);

  return <div className={styles.shell}>
    <Head>
      <title>{t("MU TRACE Mobil | MuTerminal")}</title>
      <meta name="description" content={t("MU TRACE mobil çalışma alanı")} />
      <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" key="viewport" />
    </Head>
    <header className={styles.header}>
      <div className={styles.container}>
        <a href="/mobil"><img src="/mu-trace-logo.png" width={2172} height={724} alt="MU TRACE" /></a>
        <div className={styles.headerActions}>
          <LanguagePicker />
          {account ? <form action="/admin/logout?mobil=1" method="post"><button className={styles.headerLink}>{t("Çıkış")}</button></form>
            : <a className={styles.headerLink} href="/">MuTerminal</a>}
        </div>
      </div>
    </header>
    <main className={styles.container}>
      {account && !locked && <ChangePassword mobile signIn="/mobil" />}
      {locked ? <section className={styles.approval} aria-labelledby="mobile-approval-title">
        <h1 id="mobile-approval-title">{approval === 'unassigned' ? t("Mobil erişim kilitli") : t("Personel onay kodu")}</h1>
        <p>{account.name} · {t(traceRoles[account.role])}</p>
        {approval === 'unassigned' ? <p>{t("Mobil erişiminiz için firma admininiz veya mağaza yöneticiniz size özel bir onay kodu tanımlamalı.")}</p>
          : <form method="post" action="/api/trace/mobile/verify" className={styles.approvalForm}>
            {invalidCode && <p role="alert" className={styles.notice}>{t("Onay kodu geçersiz. Yöneticinizin size verdiği güncel kodu kullanın.")}</p>}
            <label>{t("Onay kodu")}<input name="code" required maxLength={36} autoComplete="off" autoCapitalize="characters" spellCheck={false} /></label>
            <button className={styles.approvalButton}>{t("Mobil erişimi aç")}</button>
          </form>}
      </section> : <section className={styles.hero}>
        <h1>{t("MU TRACE Mobil")}</h1>
        <p>{account ? `${account.name} · ${t(traceRoles[account.role])}` : t("Barkod okutun, lotu inceleyin ve saha kontrollerinizi kaydedin.")}</p>
        <a className={styles.primary} href={account?.role === 'super' ? `${traceHref}&bolum=yonetim` : traceHref}>
          {canLookup ? t("Barkod veya QR tara") : account ? t("Firma yönetimini aç") : t("Giriş yap")}
        </a>
      </section>}
      {offline && <p className={styles.notice} role="status">{t("Bağlantı kesildi. Ürün kayıtları ve işlemler için internet bağlantısı gerekiyor.")}</p>}
      {account && !locked && account.role !== 'super' && <NotificationSettings panel={warehouse ? 'depo' : 'trace'} mobile />}
      {account && !locked && <div className={styles.tiles}>
        {canLookup && <a href={`${traceHref}&bolum=rapor`}><strong>{personal ? t("Kontrollerim") : t("Raporlar")}</strong>
          <span>{personal ? t("Kendi taleplerinizi ve sonuçlarını görün.") : t("Riskli lotları, talepleri ve geri çağırma kayıtlarını inceleyin.")}</span></a>}
        {account.canManage && account.role !== 'super' && <a href="/trace?mobil=1&bolum=yonetim"><strong>{t("Yönetim")}</strong>
          <span>{t("Kullanıcı ve lokasyon kapsamlarını yönetin.")}</span></a>}
        {account.corePath && <a href={account.corePath}><strong>MuTerminal CORE</strong>
          <span>{t("Operasyon kayıtlarını ve MuDecision dosyalarını açın.")}</span></a>}
        {account.canScan && <a href="/staff/scan?mobil=1"><strong>MuTerminal Scan</strong>
          <span>{t("Fiziksel ürün kontrolü yapın.")}</span></a>}
      </div>}
    </main>
    {account && !locked && <MobileNav current="home" canLookup={canLookup} canManage={account.canManage} personal={personal} warehouse={warehouse} />}
  </div>;
}
