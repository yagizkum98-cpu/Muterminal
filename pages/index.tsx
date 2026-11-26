import LanguagePicker, { useTranslate } from '../components/LanguagePicker';
import { languageFromCookie } from '../lib/language';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import ProductJourney from '../components/ProductJourney';
import ModuleRoadmap from '../components/ModuleRoadmap';
import { createChallenge, type IssuedChallenge } from '../server/challenge';
import LoginChallenge from '../components/LoginChallenge';
import { isPanel, loginTitles, type PanelRole } from '../server/panels';
import { crossDockEnabled, scanEnabled } from '../server/features';

const errors: Record<string, string> = {
  dogrulama: 'Doğrulama kodu hatalı veya süresi dolmuş. Yeni görseldeki harfleri girin.',
  bilgi: 'Kullanıcı adı veya şifre hatalı.',
  yetki: 'Bu hesap seçilen panele erişemiyor.',
  limit: 'Çok fazla giriş denemesi yapıldı. Birkaç dakika sonra tekrar deneyin.',
};

function androidApkUrl() {
  const configured = process.env.MUTERMINAL_ANDROID_APK_URL?.trim();
  if (configured === '/mobil/muterminal.apk') return configured;
  if (!configured) return null;

  try {
    const url = new URL(configured);
    if (url.protocol === 'https:' && !url.username && !url.password && /\.apk$/i.test(url.pathname)) return url.href;
  } catch {
    return null;
  }
  return null;
}

interface Props { role: PanelRole; loginTitle: string; error: string | null; passwordChanged: boolean; challenge: IssuedChallenge | null; handoff: string | null; mobile: boolean; apkUrl: string | null; dockAvailable: boolean; scanAvailable: boolean }

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, req, res }) => {
  const role = isPanel(query.panel) ? query.panel : 'admin';
  let error = typeof query.giris === 'string' && Object.hasOwn(errors, query.giris) ? errors[query.giris] : null;
  const handoff = role === 'manager' && typeof query.talep === 'string' && /^[a-f0-9]{24}$/.test(query.talep) ? query.talep : null;
  res.setHeader('Cache-Control', 'no-store');
  let challenge: IssuedChallenge | null = null;
  try {
    challenge = await createChallenge(req);
    if (!challenge) error = errors.limit;
  }
  catch (error) { console.error('Login challenge:', error); }
  return { props: { role, loginTitle: loginTitles[role], error, passwordChanged: query.password === 'changed', challenge,
    handoff, mobile: query.mobil === '1', apkUrl: androidApkUrl(), dockAvailable: crossDockEnabled(),
    scanAvailable: scanEnabled(), language: languageFromCookie(req.headers.cookie) } };
};

export default function Landing({ role, loginTitle, error, passwordChanged, challenge, handoff, mobile, apkUrl, dockAvailable, scanAvailable }: Props) {
  const t = useTranslate();
  const mobileParam = mobile ? '&mobil=1' : '';
  return <>
    <Head>
      <title>{t("MuTerminal | Mağaza operasyonları ve ürün kararları")}</title>
      <meta name="description" content={t("MuTerminal, mağaza operasyonlarını ve ürün kararlarını tek bir çalışma alanında bir araya getirir.")} />
      <link rel="stylesheet" href="/public.css" />
    </Head>
  <header className="site-header wrap">
    <a className="brand" href="/" aria-label={t("MuTerminal ana sayfa")}>
      <img src="/muterminal-app-icon.png" width="44" height="44" alt="" />
      <span>MuTerminal</span>
    </a>
    <nav className="login-links" aria-label={t("Panel girişleri")}>
      <a className="header-link" href={`/?panel=admin${mobileParam}#admin-giris`}>{t("Admin girişi")}</a>
      <a className="header-link" href={`/?panel=manager${mobileParam}#admin-giris`}>{t("Yönetici girişi")}</a>
      <a className="button" href={`/?panel=staff${mobileParam}#admin-giris`}>{t("Personel girişi")}</a>
    </nav>
    <div className="header-language"><LanguagePicker /></div>
  </header>
  <main>
    <section className="hero-surface" aria-labelledby="hero-title">
      <div className="wrap hero">
        <div className="hero-copy">
          <p className="eyebrow">{t("Mağaza operasyonları")}</p>
          <h1 id="hero-title">{t("Operasyon kayıtları ve ürün kararları tek yerde")}</h1>
          <p className="hero-lead">{t("MuTerminal, mağaza ekiplerinin ürün ve lot bazında operasyonları takip etmesini, manuel kararları gerekçeleriyle kaydetmesini ve karar geçmişini incelemesini sağlar.")}</p>
          <div className="hero-actions">
            <a className="button hero-primary" href="#admin-giris">{t("Panel girişi")}<span aria-hidden="true">↓</span></a>
            <a className="button hero-secondary" href="#urun-akisi">{t("Ürün akışını izle")}</a>
          </div>
          <div className="hero-links">
            <a href="#moduller">{t('Ürün yol haritası')} <span aria-hidden="true">↓</span></a>
            <a href={mobile ? '/trace?mobil=1' : '/trace'}>MU TRACE <span aria-hidden="true">↗</span></a>
            {apkUrl && !mobile && <a href={apkUrl} download="muterminal.apk">{t("Android APK indir")} <span aria-hidden="true">↓</span></a>}
          </div>
        </div>
        <div className="hero-visual">
          <img className="hero-image" src="/landing-stockroom.webp" alt="" width="960" height="1200" fetchPriority="high" />
          <ol className="hero-workflow" aria-label={t("Dijital işlem akışı")}>
            <li>{t("Kontrol")}</li><li>{t("Karar")}</li><li>{t("Kayıt")}</li>
          </ol>
        </div>
      </div>
    </section>
    <ModuleRoadmap scanAvailable={scanAvailable} dockAvailable={dockAvailable} mobile={mobile} />
    <ProductJourney />
    <section className="wrap login-section" id="admin-giris" aria-labelledby="login-title">
      <div className="login-card">
        <div className="login-side">
          <p>{t("Panel girişi")}</p>
          <nav className="login-panel-options" aria-label={t("Giriş paneli seçimi")}>
            <a aria-current={role === 'admin' ? 'true' : undefined} href={`/?panel=admin${mobileParam}#admin-giris`}>Admin</a>
            <a aria-current={role === 'manager' ? 'true' : undefined} href={`/?panel=manager${mobileParam}#admin-giris`}>{t("Yönetici")}</a>
            <a aria-current={role === 'staff' ? 'true' : undefined} href={`/?panel=staff${mobileParam}#admin-giris`}>{t("Personel")}</a>
          </nav>
        </div>
        <div className="login-content">
          <h2 id="login-title">{t(loginTitle)}</h2>
          {handoff && <p role="status">{t("MuScan talebini incelemek için yönetici hesabınızla giriş yapın.") + " "}
            <a href={mobile ? '/staff/scan?mobil=1#islem-gecmisim' : '/staff/scan#islem-gecmisim'}>{t("Personel işlem geçmişine dön")}</a>
          </p>}
          {error && <p className="login-error" role="alert">{t(error)}</p>}
          {passwordChanged && <p role="status">{t("Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.")}</p>}
          {challenge ? <form method="post" action="/admin/login">
            <input type="hidden" name="role" value={role} />
            {mobile && <input type="hidden" name="mobil" value="1" />}
            {handoff && <input type="hidden" name="talep" value={handoff} />}
            <label htmlFor="email">{t("Kullanıcı adı veya e-posta")}</label>
            <input id="email" name="email" type="text" maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck="false" required />
            <label htmlFor="password">{t("Şifre")}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" maxLength={128} required />
            <LoginChallenge key={challenge.id} initial={challenge} imageClassName="login-challenge"
              refreshHref={`/admin/login?panel=${role}${mobileParam}${handoff ? `&talep=${handoff}` : ''}`} />
            <button className="button" type="submit">{t("Giriş yap")}</button>
          </form> : error !== errors.limit && <p role="status">{t("Veritabanı bağlantısı kurulamadı. Giriş için bağlantıyı kontrol edin.")}</p>}
        </div>
      </div>
    </section>
  </main>
  <footer className="wrap site-footer">
    <strong>MuTerminal</strong>
    <span>{t("Pilot uygulama")}</span>
  </footer>

  </>;
}
