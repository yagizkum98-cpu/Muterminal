import type { GetServerSideProps } from 'next';
import Head from 'next/head';
import Script from 'next/script';
import { getSession } from '../server/application';
import { scanEnabled } from '../server/features';
import { isPanel, panelTitles, type PanelRole } from '../server/panels';

interface Props { title: string; role: PanelRole; showScan: boolean }

export const getServerSideProps: GetServerSideProps<Props> = async ({ params, query, req, res }) => {
  const panel = params?.panel;
  if (!isPanel(panel)) return { notFound: true };
  res.setHeader('Cache-Control', 'no-store');
  const session = await getSession(req);
  const showScan = scanEnabled();
  const handoff = showScan && panel === 'manager' && typeof query.talep === 'string' && /^[a-f0-9]{24}$/.test(query.talep) ? query.talep : null;
  const destination = session?.role === panel ? null : handoff ? `/?panel=manager&talep=${handoff}#admin-giris`
    : !session ? `/?panel=${panel}#admin-giris` : `/${session.role}`;
  if (destination) return { redirect: { destination, permanent: false } };
  return { props: { title: panelTitles[panel], role: panel, showScan } };
};

export default function Panel({ title, role, showScan }: Props) {
  return <>
    <Head><title>{title} | MuTerminal Core</title><link rel="stylesheet" href="/panel.css" /></Head>
    <Script src="/app.js" strategy="afterInteractive" />
  <header className="admin-header">
    <div>
      <h1><img src="/muterminal-core-logo.png" width="2172" height="724" alt="MuTerminal Core" /></h1>
      <p id="panel-role"></p>
      <p id="panel-account"></p>
    </div>
    <form method="post" action="/admin/logout">
      <button type="submit" className="secondary">Oturumu kapat</button>
    </form>
  </header>
  <main>
    <p><a className="scan-link" href="/trace">MU TRACE · Ürün izlenebilirliği</a></p>
    {role === 'staff' && (showScan
      ? <p><a className="scan-link" href="/staff/scan">MuTerminal Scan · Barkodla kontrol</a></p>
      : <aside className="scan-notice" id="muscan-durum" aria-labelledby="muscan-durum-title">
        <h2 id="muscan-durum-title">MuScan geliştirilmekte</h2>
        <p>Gerekli prosedürler tamamlandıktan sonra kullanıma açılacak.</p>
      </aside>)}
    <nav id="modules" className="modules" aria-label="MuTerminal modülleri">
      <button type="button" className="decision-module-tab" data-module="mudecision" aria-pressed="true">
        <img src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" />
      </button>
    </nav>
    <section className="department-picker" aria-labelledby="departments-title">
      <h2 id="departments-title">Reyonlar</h2>
      <div id="store-filter-field" hidden><label htmlFor="store-filter">Mağaza</label><select id="store-filter"></select></div>
      <nav id="departments" className="modules" aria-labelledby="departments-title">
        <button type="button" data-department-group="" aria-pressed="true">Tüm reyonlar</button>
      </nav>
      <div id="subdepartment-section" className="subdepartment-section" hidden>
        <h3 id="subdepartments-title">Alt reyonlar</h3>
        <nav id="subdepartments" className="modules" aria-labelledby="subdepartments-title"></nav>
        <p id="subdepartments-empty" hidden>Alt reyonlar daha sonra tanımlanacak.</p>
      </div>
    </section>
    <p id="sync-status" role="status">Kayıtlar yükleniyor…</p>
    <section id="decision-files-panel" aria-labelledby="decision-files-title">
      <h2 id="decision-files-title"><img src="/mudecision-logo.png" width="2172" height="724" alt="MuDecision" /></h2>
      <p>MuTerminal Core’a girilen operasyonları ürün ve lot bazında inceleyin, ilgili kayda gidin ve kararınızı gerekçesiyle kaydedin.</p>
      <div className="toolbar">
        <input id="decision-search" type="search" placeholder="Ürün, barkod veya lot ara" aria-label="Karar dosyalarında ara" />
      </div>
      <p id="decision-file-status" className="status" role="status"></p>
      <div id="decision-files"></div>
    </section>
    <div className="cards" id="stats" hidden></div>
    <section id="dashboard-panel" hidden>
      <h2>Operasyon dashboardu</h2>
      <h3 id="bekleyen-onaylar">Bekleyen onaylar</h3>
      <p id="review-status" className="status" role="status"></p>
      <div id="approval-list"></div>
      <h3 id="report-title">Operasyon raporu</h3>
      <div className="scroll"><table aria-labelledby="report-title"><thead><tr>
        <th id="report-group">Mağaza</th><th>Kontrol kayıtları</th><th>Karar işlemleri</th><th>Bekleyen talepler</th>
      </tr></thead><tbody id="report-rows"></tbody></table></div>
      <p><button type="button" id="download-report" disabled>Raporu JSON olarak indir</button></p>
    </section>
    <section id="management-panel" hidden>
      <h2>Sistem yönetimi</h2>
      <p id="management-status" className="status" role="status"></p>
      <h3>Mağazalar</h3>
      <ul id="managed-stores"></ul>
      <form id="store-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="store-name">Mağaza adı</label><input id="store-name" name="name" maxLength={100} required /></div>
          <div><label htmlFor="store-code">Mağaza kodu</label><input id="store-code" name="id" pattern="[a-z0-9\-]+" maxLength={50} required /></div>
        </div>
        <p><button type="submit">Mağaza ekle</button></p>
      </form>
      <h3>Reyon tanımları</h3>
      <ul id="managed-departments" className="managed-departments"></ul>
      <form id="department-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="department-parent">Ana reyon</label><select id="department-parent" name="parentId" required></select></div>
          <div><label htmlFor="subdepartment-name">Alt reyon adı</label><input id="subdepartment-name" name="name" maxLength={80} required /></div>
        </div>
        <p><button type="submit">Alt reyon ekle</button></p>
      </form>
      <h3>Personel ve yönetici hesapları</h3>
      <ul id="managed-users"></ul>
      <form id="user-form" className="management-form">
        <div className="fields">
          <div id="user-name-field"><label htmlFor="user-name">Ad soyad</label><input id="user-name" name="displayName" maxLength={100} required /></div>
          <div><label htmlFor="user-email">Kullanıcı adı veya e-posta</label><input id="user-email" name="email" maxLength={100} required /></div>
          <div id="user-password-field"><label htmlFor="user-password">Şifre</label><input id="user-password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
          <div><label htmlFor="user-role">Rol</label><select id="user-role" name="role"><option value="staff">Personel</option><option value="manager">Yönetici</option><option value="admin">Admin</option></select></div>
          <div id="user-job-title-field"><label htmlFor="user-job-title">İş unvanı</label><select id="user-job-title" name="staffDepartment" required><option value="">İş unvanı seçin</option></select></div>
          <div><label htmlFor="user-store">Mağaza</label><select id="user-store" name="storeId" required></select></div>
        </div>
        <label id="user-approval" hidden><input type="checkbox" name="canApprove" /> Admin karar ve depo farkı onaylayabilir</label>
        <p><button type="submit" id="save-user">Kullanıcı oluştur</button> <button type="button" className="secondary" id="cancel-user-edit" hidden>Vazgeç</button></p>
      </form>
      <h3>Veri kaynakları, kontrol kuralları ve entegrasyonlar</h3>
      <form id="settings-form" className="management-form">
        <div className="fields">
          <div><label htmlFor="product-source">Ürün veri kaynağı</label><input id="product-source" name="productSource" maxLength={300} required /></div>
          <div><label htmlFor="expiry-warning">SKT uyarı süresi (gün)</label><input id="expiry-warning" name="expiryWarningDays" type="number" min="0" max="90" required /></div>
          <div><label htmlFor="erp-endpoint">ERP adresi</label><input id="erp-endpoint" name="erpEndpoint" type="url" maxLength={500} /></div>
          <div><label htmlFor="wms-endpoint">WMS adresi</label><input id="wms-endpoint" name="wmsEndpoint" type="url" maxLength={500} /></div>
        </div>
        <label><input id="rks-scope" type="checkbox" name="blockRksAcrossLots" /> Açık RKS blokajını aynı mağazadaki diğer lotlara da uygula</label>
        <p><button type="submit">Ayarları kaydet</button></p>
        <p className="safety">RKS blokajının kaldırılması, satışa açma ve resmî stok düzeltmesi yetkili ERP/WMS süreçlerinde yapılır.</p>
      </form>
    </section>
    <section id="staff-management-panel" hidden>
      <h2>Personel yönetimi</h2>
      <p id="team-status" className="status" role="status"></p>
      <ul id="team-members"></ul>
      <form id="team-create" className="management-form">
        <h3>Personel ekle</h3>
        <div className="fields">
          <div><label htmlFor="member-name">Ad soyad</label><input id="member-name" name="displayName" maxLength={100} required /></div>
          <div><label htmlFor="member-username">Kullanıcı adı veya e-posta</label><input id="member-username" name="email" maxLength={100} required /></div>
          <div><label htmlFor="member-department">İş unvanı</label><select id="member-department" name="staffDepartment" required><option value="">İş unvanı seçin</option></select></div>
          <div><label htmlFor="member-password">Başlangıç şifresi</label><input id="member-password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" aria-describedby="member-password-note" /></div>
        </div>
        <p id="member-password-note">Şifreyi boş bırakırsanız başlangıç şifresi 1234567890 olur.</p>
        <p><button type="submit">Personel ekle</button></p>
      </form>
      <form id="team-password" className="management-form" hidden>
        <h3>Personel şifresini değiştir</h3>
        <p id="team-password-target"></p>
        <input id="team-password-user" name="email" type="hidden" />
        <label htmlFor="team-password-new">Yeni şifre</label>
        <input id="team-password-new" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required />
        <p><button type="submit">Personel şifresini kaydet</button> <button type="button" id="cancel-team-password" className="secondary">Vazgeç</button></p>
      </form>
      <form id="manager-password" className="management-form" hidden>
        <h3>Kendi şifremi değiştir</h3>
        <div className="fields">
          <div><label htmlFor="manager-current-password">Mevcut şifre</label><input id="manager-current-password" name="currentPassword" type="password" maxLength={128} autoComplete="current-password" required /></div>
          <div><label htmlFor="manager-new-password">Yeni şifre</label><input id="manager-new-password" name="password" type="password" minLength={8} maxLength={128} autoComplete="new-password" required /></div>
        </div>
        <p><button type="submit">Kendi şifremi kaydet</button></p>
      </form>
    </section>
    <section id="module-header" className="module-header" aria-labelledby="module-title" hidden>
      <small id="module-feature"></small>
      <h2 id="module-title">Operasyon modülleri</h2>
      <p id="module-description"></p>
      <p className="safety">Satış ön onayı yalnızca MuTerminal’de kayda geçer. RKS blokajının kaldırılması, SKT uygunluğu ve stok hareketleri yetkili sistemlerde ayrıca doğrulanmalıdır.</p>
    </section>
    <section id="entry-panel" hidden>
      <h2 id="entry-title">Manuel ürün kaydı</h2>
      <form id="product-form">
        <div className="fields">
          <div><label htmlFor="name">Ürün adı</label><input id="name" name="name" maxLength={150} required /></div>
          <div><label htmlFor="code">Barkod</label><input id="code" name="code" maxLength={80} required /></div>
          <div><label htmlFor="lot">Lot</label><input id="lot" name="lot" maxLength={80} required /></div>
          <div id="department-field"><label htmlFor="department">Reyon</label><select id="department" name="department" required></select></div>
          <div id="entry-store-field" hidden><label htmlFor="entry-store">Mağaza</label><select id="entry-store" name="storeId" disabled></select></div>
          <div id="quantity-field"><label htmlFor="qty" id="quantity-label">Adet</label><input id="qty" name="qty" type="number" min="1" step="1" required /></div>
        </div>
        <div className="fields" id="operation-fields"></div>
        <p id="stock-preview" role="status" hidden></p>
        <label id="expired-field"><input id="expired" name="expired" type="checkbox" /> Son kullanma tarihi geçmiş</label>
        <p><button type="submit" id="save-product">Ürünü kaydet</button> <button type="button" className="secondary" id="cancel-edit" hidden>Vazgeç</button></p>
        <p id="product-status" className="status" role="status"></p>
      </form>
    </section>
    <section id="records-panel" hidden>
      <h2>Operasyon kayıtları</h2>
      <div className="toolbar">
        <input id="search" placeholder="Ürün, barkod, lot ara" aria-label="Ürün, barkod, lot ara" />
      </div>
      <p id="records-status" className="status" role="status"></p>
      <div className="scroll">
        <table>
          <thead><tr><th>Ürün</th><th>Barkod / Lot</th><th id="quantity-column">Adet</th><th>Operasyon bilgisi</th><th>Durum ve risk</th><th>İşlem</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
    </section>
    <section id="decision" hidden>
      <h2 id="decision-title">Operasyon kararı</h2>
      <p id="selected"></p>
      <form id="decision-form">
        <label htmlFor="staff">Yetkili personel</label>
        <input id="staff" name="staff" maxLength={100} required />
        <label htmlFor="choice">Karar</label>
        <select id="choice" name="choice" required></select>
        <div id="destination-field" hidden>
          <label htmlFor="destination">Varış noktası</label>
          <input id="destination" name="destination" maxLength={150} disabled />
        </div>
        <label htmlFor="reason">Karar gerekçesi</label>
        <textarea id="reason" name="reason" placeholder="Kontrol sonucu ve gerekçe" maxLength={1000} required></textarea>
        <label id="proposal-field" hidden><input id="submit-as-proposal" type="checkbox" /> Onaya gönder</label>
        <p><button type="submit">Kararı kaydet</button> <small>Karar kayıtları ERP stok durumunu değiştirmez.</small></p>
        <p id="decision-status" className="status" role="status"></p>
      </form>
    </section>
    <section id="history-panel" hidden>
      <h2>Karar kayıtları</h2>
      <div className="toolbar">
        <input id="history-search" placeholder="Ürün, lot, personel, sonuç ara" aria-label="Karar geçmişinde ara" />
        <input id="history-date" type="date" aria-label="Karar tarihi" />
        <select id="history-operation" aria-label="Kararların operasyonu"></select>
        <button id="clear-lot" type="button" className="secondary" hidden>Lot filtresini kaldır</button>
        <button id="export" type="button" disabled>JSON dışa aktar</button>
      </div>
      <p id="lot-filter" hidden></p>
      <div className="scroll">
        <table>
          <thead><tr><th>Tarih</th><th>Ürün / Lot</th><th>Operasyon</th><th>Personel</th><th>Karar ve gerekçe</th><th>Sonuç</th></tr></thead>
          <tbody id="history"></tbody>
        </table>
      </div>
    </section>
  </main>
  <footer>
    <img src="/muterminal-logo.png" width="2172" height="724" alt="MuTerminal" />
    <span>Pilot uygulama</span>
  </footer>

  </>;
}
