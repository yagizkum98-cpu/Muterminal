import LanguagePicker, { useTranslate } from '../components/LanguagePicker';
import { languageFromCookie } from '../lib/language';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import ProductJourney from '../components/ProductJourney';
import { createChallenge, type IssuedChallenge } from '../server/challenge';
import LoginChallenge from '../components/LoginChallenge';
import { isPanel, loginTitles, type PanelRole } from '../server/panels';

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

interface Props { role: PanelRole; loginTitle: string; error: string | null; passwordChanged: boolean; challenge: IssuedChallenge | null; handoff: string | null; mobile: boolean; apkUrl: string | null }

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
  return { props: { role, loginTitle: loginTitles[role], error, passwordChanged: query.password === 'changed', challenge, handoff, mobile: query.mobil === '1', apkUrl: androidApkUrl(), language: languageFromCookie(req.headers.cookie) } };
};

export default function Landing({ role, loginTitle, error, passwordChanged, challenge, handoff, mobile, apkUrl }: Props) {
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
      <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    </a>
    <nav className="login-links" aria-label={t("Panel girişleri")}>
      <LanguagePicker />
      <a className="button" href="/?panel=admin#admin-giris">{t("Admin girişi")}</a>
      <a className="button" href="/?panel=manager#admin-giris">{t("Yönetici girişi")}</a>
      <a className="button" href="/?panel=staff#admin-giris">{t("Personel girişi")}</a>
    </nav>
  </header>
  <main>
    <div className="hero-surface">
      <div className="wrap hero">
        <p className="eyebrow">{t("Mağaza operasyonları")}</p>
        <h1>{t("Operasyon kayıtları ve ürün kararları tek yerde")}</h1>
        <p>{t("MuTerminal, mağaza ekiplerinin ürün ve lot bazında operasyonları takip etmesini, manuel kararları gerekçeleriyle kaydetmesini ve karar geçmişini incelemesini sağlar.")}</p>
        <a className="button hero-journey" href="#urun-akisi">{t("Ürün akışını izle")}</a>
        {' '}<a className="button hero-journey" href="/trace">MU TRACE</a>
        {apkUrl && !mobile && <>{' '}<a className="button hero-journey" href={apkUrl} download="muterminal.apk">{t("Android APK indir")}</a></>}
      </div>
    </div>
    <div className="wrap modules-overview">
      <section aria-labelledby="core-title">
        <h2 id="core-title"><img className="module-brand" src="/muterminal-core-logo.png" width="2172" height="724" alt="MuTerminal Core" /></h2>
        <p>{t("Mağazanın günlük ürün ve stok operasyonlarını takip etmek için kullanılan çalışma alanı.")}</p>
        <ul>
          <li>{t("RKS, delist ve geçici blokaj takibi")}</li>
          <li>{t("Lot ve son kullanma tarihi kontrolü")}</li>
          <li>{t("Depo iadesi, sayım farkı ve Cross-Dock değerlendirmesi")}</li>
        </ul>
      </section>
      <section aria-labelledby="decision-title">
        <h2 id="decision-title"><img className="module-brand" src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" /></h2>
        <p>{t("MuDecision Engine, her ürün için ayrı bir dijital karar dosyası oluşturur.")}</p>
        <ul>
          <li>{t("Ürün ve lot bilgileriyle birlikte kararın değerlendirilmesi")}</li>
          <li>{t("Yetkili personelin karar ve gerekçesinin kaydı")}</li>
          <li>{t("Karar geçmişinin ürün ve lot bazında incelenmesi")}</li>
        </ul>
      </section>
    </div>
    <ProductJourney />
    <section className="wrap login-section" id="admin-giris" aria-labelledby="login-title">
      <div className="login-card">
        <h2 id="login-title">{t(loginTitle)}</h2>
        {handoff && <p role="status">{t("MuScan talebini incelemek için yönetici hesabınızla giriş yapın.") + " "}<a href="/staff/scan#islem-gecmisim">{t("Personel işlem geçmişine dön")}</a></p>}
        <nav className="login-panel-options" aria-label={t("Giriş paneli seçimi")}>
          <a aria-current={role === 'admin' ? 'true' : undefined} href={`/?panel=admin${mobileParam}#admin-giris`}>Admin</a>
          <a aria-current={role === 'manager' ? 'true' : undefined} href={`/?panel=manager${mobileParam}#admin-giris`}>{t("Yönetici")}</a>
          <a aria-current={role === 'staff' ? 'true' : undefined} href={`/?panel=staff${mobileParam}#admin-giris`}>{t("Personel")}</a>
        </nav>
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
    </section>
  </main>
  <footer className="wrap site-footer">
    <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    <span>{t("Pilot uygulama")}</span>
  </footer>

  </>;
}
