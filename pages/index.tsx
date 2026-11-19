import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import ProductJourney from '../components/ProductJourney';
import { createChallenge } from '../server/challenge';
import { ensurePilotAccounts } from '../server/application';
import { scanEnabled } from '../server/features';
import { isPanel, loginTitles, type PanelRole } from '../server/panels';

const errors: Record<string, string> = {
  dogrulama: 'Doğrulama kodu hatalı veya süresi dolmuş. Yeni görseldeki harfleri girin.',
  bilgi: 'Kullanıcı adı veya şifre hatalı.',
  yetki: 'Bu hesap seçilen panele erişemiyor.',
};

interface Props { role: PanelRole; loginTitle: string; error: string | null; passwordChanged: boolean; challengeId: string | null; handoff: string | null; }

export const getServerSideProps: GetServerSideProps<Props> = async ({ query, res }) => {
  const role = isPanel(query.panel) ? query.panel : 'admin';
  const error = typeof query.giris === 'string' && Object.hasOwn(errors, query.giris) ? errors[query.giris] : null;
  const handoff = scanEnabled() && role === 'manager' && typeof query.talep === 'string' && /^[a-f0-9]{24}$/.test(query.talep) ? query.talep : null;
  res.setHeader('Cache-Control', 'no-store');
  let challengeId: string | null = null;
  try {
    await ensurePilotAccounts();
    challengeId = await createChallenge();
  }
  catch (error) { console.error('Login challenge:', error); }
  return { props: { role, loginTitle: loginTitles[role], error, passwordChanged: query.password === 'changed', challengeId, handoff } };
};

export default function Landing({ role, loginTitle, error, passwordChanged, challengeId, handoff }: Props) {
  return <>
    <Head>
      <title>MuTerminal | Mağaza operasyonları ve ürün kararları</title>
      <meta name="description" content="MuTerminal, mağaza operasyonlarını ve ürün kararlarını tek bir çalışma alanında bir araya getirir." />
      <link rel="stylesheet" href="/public.css" />
    </Head>
  <header className="site-header wrap">
    <a className="brand" href="/" aria-label="MuTerminal ana sayfa">
      <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    </a>
    <nav className="login-links" aria-label="Panel girişleri">
      <a className="button" href="/?panel=admin#admin-giris">Admin girişi</a>
      <a className="button" href="/?panel=manager#admin-giris">Yönetici girişi</a>
      <a className="button" href="/?panel=staff#admin-giris">Personel girişi</a>
    </nav>
  </header>
  <main>
    <div className="hero-surface">
      <div className="wrap hero">
        <p className="eyebrow">Mağaza operasyonları</p>
        <h1>Operasyon kayıtları ve ürün kararları tek yerde</h1>
        <p>MuTerminal, mağaza ekiplerinin ürün ve lot bazında operasyonları takip etmesini, manuel kararları gerekçeleriyle kaydetmesini ve karar geçmişini incelemesini sağlar.</p>
        <a className="button hero-journey" href="#urun-akisi">Ürün akışını izle</a>
        {' '}<a className="button hero-journey" href="/trace">MU TRACE</a>
      </div>
    </div>
    <div className="wrap modules-overview">
      <section aria-labelledby="core-title">
        <h2 id="core-title"><img className="module-brand" src="/muterminal-core-logo.png" width="2172" height="724" alt="MuTerminal Core" /></h2>
        <p>Mağazanın günlük ürün ve stok operasyonlarını takip etmek için kullanılan çalışma alanı.</p>
        <ul>
          <li>RKS, delist ve geçici blokaj takibi</li>
          <li>Lot ve son kullanma tarihi kontrolü</li>
          <li>Depo iadesi, sayım farkı ve Cross-Dock değerlendirmesi</li>
        </ul>
      </section>
      <section aria-labelledby="decision-title">
        <h2 id="decision-title"><img className="module-brand" src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" /></h2>
        <p>MuDecision Engine, her ürün için ayrı bir dijital karar dosyası oluşturur.</p>
        <ul>
          <li>Ürün ve lot bilgileriyle birlikte kararın değerlendirilmesi</li>
          <li>Yetkili personelin karar ve gerekçesinin kaydı</li>
          <li>Karar geçmişinin ürün ve lot bazında incelenmesi</li>
        </ul>
      </section>
    </div>
    <ProductJourney />
    <section className="wrap login-section" id="admin-giris" aria-labelledby="login-title">
      <div className="login-card">
        <h2 id="login-title">{loginTitle}</h2>
        {handoff && <p role="status">MuScan talebini incelemek için yönetici hesabınızla giriş yapın. <a href="/staff/scan#islem-gecmisim">Personel işlem geçmişine dön</a></p>}
        <nav className="login-panel-options" aria-label="Giriş paneli seçimi">
          <a aria-current={role === 'admin' ? 'true' : undefined} href="/?panel=admin#admin-giris">Admin</a>
          <a aria-current={role === 'manager' ? 'true' : undefined} href="/?panel=manager#admin-giris">Yönetici</a>
          <a aria-current={role === 'staff' ? 'true' : undefined} href="/?panel=staff#admin-giris">Personel</a>
        </nav>
        {error && <p className="login-error" role="alert">{error}</p>}
        {passwordChanged && <p role="status">Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.</p>}
        {challengeId ? <form method="post" action="/admin/login">
          <input type="hidden" name="role" value={role} />
          {handoff && <input type="hidden" name="talep" value={handoff} />}
          <label htmlFor="email">Kullanıcı adı veya e-posta</label>
          <input id="email" name="email" type="text" maxLength={100} autoComplete="username" autoCapitalize="none" spellCheck="false" required />
          <label htmlFor="password">Şifre</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required />
          <label htmlFor="challenge-answer">Görseldeki beş harfi yazın</label>
          <div className="login-challenge">
            <img src={`/admin/challenge/${challengeId}.bmp`} width="160" height="48" alt="Beş harfli doğrulama görseli" />
            <a href={`/admin/login?panel=${role}${handoff ? `&talep=${handoff}` : ''}`}>Harfleri yenile</a>
          </div>
          <input type="hidden" name="challengeId" value={challengeId} />
          <input id="challenge-answer" name="challengeAnswer" type="text" autoComplete="off" spellCheck="false" autoCapitalize="characters" pattern="[A-Za-z]{5}" maxLength={5} required />
          <button className="button" type="submit">Giriş yap</button>
        </form> : <p role="status">Veritabanı bağlantısı kurulamadı. Giriş için bağlantıyı kontrol edin.</p>}
      </div>
    </section>
  </main>
  <footer className="wrap site-footer">
    <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    <span>Pilot uygulama</span>
  </footer>

  </>;
}
