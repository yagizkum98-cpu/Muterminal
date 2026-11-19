import LanguagePicker, { useTranslate } from '../components/LanguagePicker';
import ChangePassword from '../components/ChangePassword';
import { languageFromCookie } from '../lib/language';
import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Script from 'next/script';
import { getSession } from '../server/application';
import { scanEnabled } from '../server/features';
import { isPanel, panelTitles, type PanelRole } from '../server/panels';
import { mobileStaffState } from '../server/mobile-access';

interface Props { title: string; role: PanelRole; showScan: boolean; mobile: boolean }

export const getServerSideProps: GetServerSideProps<Props> = async ({ params, query, req, res }) => {
  const panel = params?.panel;
  if (!isPanel(panel)) return { notFound: true };
  res.setHeader('Cache-Control', 'no-store');
  const session = await getSession(req);
  const showScan = scanEnabled();
  const mobile = query.mobil === '1' || session?.mobile === true;
  if (session && mobile && await mobileStaffState(session) !== 'allowed') {
    return { redirect: { destination: '/mobil', permanent: false } };
  }
  const mobileParam = mobile ? '&mobil=1' : '';
  const handoff = showScan && panel === 'manager' && typeof query.talep === 'string' && /^[a-f0-9]{24}$/.test(query.talep) ? query.talep : null;
  const destination = session?.role === panel ? null : handoff ? `/?panel=manager&talep=${handoff}${mobileParam}#admin-giris`
    : !session ? `/?panel=${panel}${mobileParam}#admin-giris` : mobile ? '/mobil' : `/${session.role}`;
  if (destination) return { redirect: { destination, permanent: false } };
  return { props: { title: panelTitles[panel], role: panel, showScan, mobile, language: languageFromCookie(req.headers.cookie) } };
};

export default function Panel({ title, role, showScan, mobile }: Props) {
  const t = useTranslate();
  return <>
    <Head><title>{title} | MuTerminal Core</title><link rel="stylesheet" href="/panel.css" /></Head>
    <Script src="/app.js" strategy="afterInteractive" />
  <header className="admin-header">
    <div>
      <h1><img src="/muterminal-core-logo.png" width="2172" height="724" alt="MuTerminal Core" /></h1>
      <p id="panel-role"></p>
      <p id="panel-account"></p>
    </div>
    <div className="actions"><LanguagePicker /><form method="post" action={mobile ? '/admin/logout?mobil=1' : '/admin/logout'}>
      <button type="submit" className="secondary">{t("Oturumu kapat")}</button>
    </form></div>
  </header>
  <main>
    <ChangePassword mobile={mobile} signIn={`/?panel=${role}&password=changed${mobile ? '&mobil=1' : ''}#admin-giris`} />
    {mobile && <p><a className="scan-link" href="/mobil">{t("Mobil ana ekran")}</a></p>}
    <p><a className="scan-link" href={mobile ? '/trace?mobil=1' : '/trace'}>{t("MU TRACE · Ürün izlenebilirliği")}</a></p>
    {role === 'staff' && (showScan
      ? <p><a className="scan-link" href={mobile ? '/staff/scan?mobil=1' : '/staff/scan'}>{t("MuTerminal Scan · Barkodla kontrol")}</a></p>
      : <aside className="scan-notice" id="muscan-durum" aria-labelledby="muscan-durum-title">
        <h2 id="muscan-durum-title">{t("MuScan geliştirilmekte")}</h2>
        <p>{t("Gerekli prosedürler tamamlandıktan sonra kullanıma açılacak.")}</p>
      </aside>)}
    <nav id="modules" className="modules" aria-label={t("MuTerminal modülleri")}>
      <button type="button" className="decision-module-tab" data-module="mudecision" aria-pressed="true">
        <img src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" />
      </button>
    </nav>
    <section className="department-picker" aria-labelledby="departments-title">
      <h2 id="departments-title">{t("Reyonlar")}</h2>
      <div id="store-filter-field" hidden><label htmlFor="store-filter">{t("Mağaza")}</label><select id="store-filter"></select></div>
      <nav id="departments" className="modules" aria-labelledby="departments-title">
        <button type="button" data-department-group="" aria-pressed="true">{t("Tüm reyonlar")}</button>
      </nav>
      <div id="subdepartment-section" className="subdepartment-section" hidden>
        <h3 id="subdepartments-title">{t("Alt reyonlar")}</h3>
        <nav id="subdepartments" className="modules" aria-labelledby="subdepartments-title"></nav>
        <p id="subdepartments-empty" hidden>{t("Alt reyonlar daha sonra tanımlanacak.")}</p>
      </div>
    </section>
    <p id="sync-status" role="status">{t("Kayıtlar yükleniyor…")}</p>
    <section id="decision-files-panel" aria-labelledby="decision-files-title">
      <h2 id="decision-files-title"><img src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" /></h2>
      <p>{t("MuTerminal Core’a girilen operasyonları ürün ve lot bazında inceleyin, ilgili kayda gidin ve kararınızı gerekçesiyle kaydedin.")}</p>
      <div className="toolbar">
        <input id="decision-search" type="search" placeholder={t("Ürün, barkod veya lot ara")} aria-label={t("Karar dosyalarında ara")} />
      </div>
      <p id="decision-file-status" className="status" role="status"></p>
      <div id="decision-files"></div>
    </section>
    <div className="cards" id="stats" hidden></div>
    <section id="dashboard-panel" hidden>
      <h2>{t("Operasyon dashboardu")}</h2>
      <h3 id="bekleyen-onaylar">{t("Bekleyen onaylar")}</h3>
      <p id="review-status" className="status" role="status"></p>
      <div id="approval-list"></div>
      <h3 id="report-title">{t("Operasyon raporu")}</h3>
      <div className="scroll"><table aria-labelledby="report-title"><thead><tr>
        <th id="report-group">{t("Mağaza")}</th><th>{t("Kontrol kayıtları")}</th><th>{t("Karar işlemleri")}</th><th>{t("Bekleyen talepler")}</th>
      </tr></thead><tbody id="report-rows"></tbody></table></div>
      <p><button type="button" id="download-report" disabled>{t("Raporu JSON olarak indir")}</button></p>
    </section>
    <section id="management-panel" hidden>
      <h2>{t("Sistem yönetimi")}</h2>
      <p id="management-status" className="status" role="status"></p>
      <h3>{t("Mağazalar")}</h3>
      <ul id="managed-stores"></ul>
      <form id="store-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="store-chain">{t("Market zinciri")}</label><select id="store-chain" name="tenantId" required></select></div>
          <div><label htmlFor="store-name">{t("Mağaza adı")}</label><input id="store-name" name="name" maxLength={100} required /></div>
          <div><label htmlFor="store-code">{t("Mağaza kodu")}</label><input id="store-code" name="id" pattern="[A-Za-z0-9\-]+" maxLength={50} required /></div>
          <div><label htmlFor="store-province">{t("İl")}</label><input id="store-province" name="province" maxLength={50} /></div>
          <div><label htmlFor="store-district">{t("İlçe")}</label><input id="store-district" name="district" maxLength={100} /></div>
        </div>
        <p><button type="submit">{t("Mağaza ekle")}</button></p>
      </form>
      <h3>{t("Market zincirleri")}</h3>
      <form id="chain-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="chain-name">{t("Zincir adı")}</label><input id="chain-name" name="name" maxLength={100} required /></div>
          <div><label htmlFor="chain-code">{t("Zincir kodu")}</label><input id="chain-code" name="id" pattern="[A-Za-z0-9][A-Za-z0-9\-]*" maxLength={50} required /></div>
        </div>
        <p><button type="submit">{t("Zincir ekle")}</button></p>
      </form>
      <h3>{t("Reyon tanımları")}</h3>
      <ul id="managed-departments" className="managed-departments"></ul>
      <form id="department-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="department-parent">{t("Ana reyon")}</label><select id="department-parent" name="parentId" required></select></div>
          <div><label htmlFor="subdepartment-name">{t("Alt reyon adı")}</label><input id="subdepartment-name" name="name" maxLength={80} required /></div>
        </div>
        <p><button type="submit">{t("Alt reyon ekle")}</button></p>
      </form>
      <h3>{t("Personel ve yönetici hesapları")}</h3>
      <ul id="managed-users"></ul>
      <form id="user-form" className="management-form">
        <div className="fields">
          <div id="user-name-field"><label htmlFor="user-name">{t("Ad soyad")}</label><input id="user-name" name="displayName" maxLength={100} required /></div>
          <div><label htmlFor="user-email">{t("Kullanıcı adı veya e-posta")}</label><input id="user-email" name="email" maxLength={100} required /></div>
          <div id="user-password-field"><label htmlFor="user-password">{t("Şifre")}</label><input id="user-password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
          <div><label htmlFor="user-role">{t("Rol")}</label><select id="user-role" name="role"><option value="staff">{t("Personel")}</option><option value="manager">{t("Yönetici")}</option><option value="admin">Admin</option></select></div>
          <div id="user-job-title-field"><label htmlFor="user-job-title">{t("İş unvanı")}</label><select id="user-job-title" name="staffDepartment" required><option value="">{t("İş unvanı seçin")}</option></select></div>
          <div><label htmlFor="user-store">{t("Mağaza")}</label><select id="user-store" name="storeId" required></select></div>
        </div>
        <label id="user-approval" hidden><input type="checkbox" name="canApprove" />{" " + t("Admin karar ve depo farkı onaylayabilir")}</label>
        <p><button type="submit" id="save-user">{t("Kullanıcı oluştur")}</button> <button type="button" className="secondary" id="cancel-user-edit" hidden>{t("Vazgeç")}</button></p>
      </form>
      <h3>{t("Veri kaynakları, kontrol kuralları ve entegrasyonlar")}</h3>
      <form id="settings-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="product-source">{t("Ürün veri kaynağı")}</label><input id="product-source" name="productSource" maxLength={300} required /></div>
          <div><label htmlFor="expiry-warning">{t("SKT uyarı süresi (gün)")}</label><input id="expiry-warning" name="expiryWarningDays" type="number" min="0" max="90" required /></div>
          <div><label htmlFor="erp-endpoint">{t("ERP adresi")}</label><input id="erp-endpoint" name="erpEndpoint" type="url" maxLength={500} /></div>
          <div><label htmlFor="wms-endpoint">{t("WMS adresi")}</label><input id="wms-endpoint" name="wmsEndpoint" type="url" maxLength={500} /></div>
        </div>
        <label><input id="rks-scope" type="checkbox" name="blockRksAcrossLots" />{" " + t("Açık RKS blokajını aynı mağazadaki diğer lotlara da uygula")}</label>
        <p><button type="submit">{t("Ayarları kaydet")}</button></p>
        <p className="safety">{t("RKS blokajının kaldırılması, satışa açma ve resmî stok düzeltmesi yetkili ERP/WMS süreçlerinde yapılır.")}</p>
      </form>
    </section>
    <section id="staff-management-panel" hidden>
      <h2>{t("Personel yönetimi")}</h2>
      <p id="team-status" className="status" role="status"></p>
      <ul id="team-members"></ul>
      <form id="team-create" className="management-form">
        <h3>{t("Personel ekle")}</h3>
        <div className="fields">
          <div><label htmlFor="member-name">{t("Ad soyad")}</label><input id="member-name" name="displayName" maxLength={100} required /></div>
          <div><label htmlFor="member-username">{t("Kullanıcı adı veya e-posta")}</label><input id="member-username" name="email" maxLength={100} required /></div>
          <div><label htmlFor="member-department">{t("İş unvanı")}</label><select id="member-department" name="staffDepartment" required><option value="">{t("İş unvanı seçin")}</option></select></div>
          <div><label htmlFor="member-password">{t("Başlangıç şifresi")}</label><input id="member-password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="member-password-note" /></div>
        </div>
        <p id="member-password-note">{t("Şifreyi boş bırakırsanız başlangıç şifresi 1234567890 olur.")}</p>
        <p><button type="submit">{t("Personel ekle")}</button></p>
      </form>
      <form id="team-password" className="management-form" hidden>
        <h3>{t("Personel şifresini değiştir")}</h3>
        <p id="team-password-target"></p>
        <input id="team-password-user" name="email" type="hidden" />
        <label htmlFor="team-password-new">{t("Yeni şifre")}</label>
        <input id="team-password-new" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
        <p><button type="submit">{t("Personel şifresini kaydet")}</button> <button type="button" id="cancel-team-password" className="secondary">{t("Vazgeç")}</button></p>
      </form>
    </section>
    <section id="module-header" className="module-header" aria-labelledby="module-title" hidden>
      <small id="module-feature"></small>
      <h2 id="module-title">{t("Operasyon modülleri")}</h2>
      <p id="module-description"></p>
      <p className="safety">{t("Satış ön onayı yalnızca MuTerminal’de kayda geçer. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.")}</p>
    </section>
    <section id="entry-panel" hidden>
      <h2 id="entry-title">{t("Manuel ürün kaydı")}</h2>
      <form id="product-form">
        <div className="fields">
          <div><label htmlFor="name">{t("Ürün adı")}</label><input id="name" name="name" maxLength={150} required /></div>
          <div><label htmlFor="code">{t("Barkod")}</label><input id="code" name="code" maxLength={80} required /></div>
          <div><label htmlFor="lot">{t("Lot")}</label><input id="lot" name="lot" maxLength={80} required /></div>
          <div id="department-field"><label htmlFor="department">{t("Reyon")}</label><select id="department" name="department" required></select></div>
          <div id="entry-store-field" hidden><label htmlFor="entry-store">{t("Mağaza")}</label><select id="entry-store" name="storeId" disabled></select></div>
          <div id="quantity-field"><label htmlFor="qty" id="quantity-label">{t("Adet")}</label><input id="qty" name="qty" type="number" min="1" step="1" required /></div>
        </div>
        <div className="fields" id="operation-fields"></div>
        <p id="stock-preview" role="status" hidden></p>
        <label id="expired-field"><input id="expired" name="expired" type="checkbox" />{" " + t("Son kullanma tarihi geçmiş")}</label>
        <p><button type="submit" id="save-product">{t("Ürünü kaydet")}</button> <button type="button" className="secondary" id="cancel-edit" hidden>{t("Vazgeç")}</button></p>
        <p id="product-status" className="status" role="status"></p>
      </form>
    </section>
    <section id="records-panel" hidden>
      <h2>{t("Operasyon kayıtları")}</h2>
      <div className="toolbar">
        <input id="search" placeholder={t("Ürün, barkod, lot ara")} aria-label={t("Ürün, barkod, lot ara")} />
      </div>
      <p id="records-status" className="status" role="status"></p>
      <div className="scroll">
        <table>
          <thead><tr><th>{t("Ürün")}</th><th>{t("Barkod / Lot")}</th><th id="quantity-column">{t("Adet")}</th><th>{t("Operasyon bilgisi")}</th><th>{t("Durum ve risk")}</th><th>{t("İşlem")}</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </section>
    <section id="decision" hidden>
      <h2 id="decision-title">{t("Operasyon kararı")}</h2>
      <p id="selected"></p>
      <form id="decision-form">
        <label htmlFor="staff">{t("Yetkili personel")}</label>
        <input id="staff" name="staff" maxLength={100} required />
        <label htmlFor="choice">{t("Karar")}</label>
        <select id="choice" name="choice" required></select>
        <div id="destination-field" hidden>
          <label htmlFor="destination">{t("Varış noktası")}</label>
          <input id="destination" name="destination" maxLength={150} disabled />
        </div>
        <label htmlFor="reason">{t("Karar gerekçesi")}</label>
        <textarea id="reason" name="reason" placeholder={t("Kontrol sonucu ve gerekçe")} maxLength={1000} required></textarea>
        <label id="proposal-field" hidden><input id="submit-as-proposal" type="checkbox" />{" " + t("Onaya gönder")}</label>
        <p><button type="submit">{t("Kararı kaydet")}</button> <small>{t("Karar kayıtları ERP stok durumunu değiştirmez.")}</small></p>
        <p id="decision-status" className="status" role="status"></p>
      </form>
    </section>
    <section id="history-panel" hidden>
      <h2>{t("Karar kayıtları")}</h2>
      <div className="toolbar">
        <input id="history-search" placeholder={t("Ürün, lot, personel, sonuç ara")} aria-label={t("Karar geçmişinde ara")} />
        <input id="history-date" type="date" aria-label={t("Karar tarihi")} />
        <select id="history-operation" aria-label={t("Kararların operasyonu")}></select>
        <button id="clear-lot" type="button" className="secondary" hidden>{t("Lot filtresini kaldır")}</button>
        <button id="export" type="button" disabled>{t("JSON dışa aktar")}</button>
      </div>
      <p id="lot-filter" hidden></p>
      <div className="scroll">
        <table>
          <thead><tr><th>{t("Tarih")}</th><th>{t("Ürün / Lot")}</th><th>{t("Operasyon")}</th><th>{t("Personel")}</th><th>{t("Karar ve gerekçe")}</th><th>{t("Sonuç")}</th></tr></thead>
          <tbody id="history"></tbody>
        </table>
      </div>
    </section>
  </main>
  <footer>
    <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    <span>{t("Pilot uygulama")}</span>
  </footer>

  </>;
}
