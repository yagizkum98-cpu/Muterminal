const $ = id => document.getElementById(id);
const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const timeZone = 'Europe/Istanbul';
const english = document.documentElement.lang === 'en';
let messages = {};
const t = (text, values) => {
  if (english && typeof text === 'string' && !Object.hasOwn(messages, text)) {
    const expiry = text.match(/^SKT’ye (\d+) gün$/);
    if (expiry) return t('SKT’ye {days} gün', { days: expiry[1] });
    const discrepancy = text.match(/^Sayım farkı ([+-]\d+)$/);
    if (discrepancy) return t('Sayım farkı {delta}', { delta: discrepancy[1] });
    const status = text.match(/^(Aynı lot|Onaylandı|Onay bekliyor) · (.+)$/);
    if (status) {
      const field = status[1] === 'Aynı lot' ? 'risk' : 'status';
      return t(`${status[1]} · {${field}}`, { [field]: t(status[2]) });
    }
  }
  const message = english && Object.hasOwn(messages, text) ? messages[text] : text;
  return values ? message.replace(/\{(\w+)\}/g, (placeholder, key) => Object.hasOwn(values, key) ? String(values[key]) : placeholder) : message;
};
const dateFormat = new Intl.DateTimeFormat(english ? 'en-GB' : 'tr-TR', { timeZone, dateStyle: 'short', timeStyle: 'medium' });
const dayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone, dateStyle: 'short' });
const calendarLocale = english ? 'en-GB' : 'tr-TR';
const calendarDateFormat = new Intl.DateTimeFormat(calendarLocale, { timeZone: 'UTC', dateStyle: 'full' });
const detailDateFormat = new Intl.DateTimeFormat(calendarLocale, { timeZone: 'UTC', dateStyle: 'medium' });
const detailDateTimeFormat = new Intl.DateTimeFormat(calendarLocale, { timeZone: 'UTC', dateStyle: 'medium', timeStyle: 'short' });
const calendarMonthFormat = new Intl.DateTimeFormat(calendarLocale, { timeZone: 'UTC', month: 'long', year: 'numeric' });
const weekdayFormat = new Intl.DateTimeFormat(calendarLocale, { timeZone: 'UTC', weekday: 'short' });
const calendarTimeFormat = new Intl.DateTimeFormat('sv-SE', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const historyModule = 'history';
const decisionModule = 'mudecision';
const dashboardModule = 'dashboard';
const approvalModule = 'approval-lite';
const scanModule = 'scan-lite';
const managementModule = 'management';
const staffManagementModule = 'staff-management';
const unassignedDepartment = 'unassigned';
const roleNames = { admin: 'Admin', manager: 'Yönetici', staff: 'Personel' };
const handoffId = new URLSearchParams(window.location.search).get('talep');

let operations = {};
let departmentGroups = [];
let departmentCatalog = new Map();
let panel;
let activeStore = '';
let handoffFocused = false;
let managedUsers = [];
let activeDepartmentGroup = '';
let activeDepartment = '';
let calendarDay = '';
let calendarMonth = dayFormat.format(new Date()).slice(0, 7);
let calendarEntries = new Map();
let activeModule = decisionModule;
let lotFilter;
let barcodeHistory;
let editingId;
let entryRevision = 0;
let products = [];
let logs = [];
let currentId = null;
let decisionKind;
let refreshId = 0;
let lastState;

function showStatus(id, message, error = false) {
  $(id).textContent = t(message);
  $(id).classList.toggle('error', error);
}

function signed(number) {
  return number > 0 ? `+${number}` : String(number);
}

function inDepartment(record) {
  if (activeStore && record.storeId !== activeStore) return false;
  if (!activeDepartmentGroup) return true;
  if (activeDepartmentGroup === unassignedDepartment) return record.department == null;
  if (activeDepartment) return record.department === activeDepartment;
  return departmentCatalog.get(record.department)?.group.id === activeDepartmentGroup;
}

function rawStoreName(id) {
  return panel.stores.find(store => store.id === id)?.name ?? id;
}

function storeName(id) {
  return t(rawStoreName(id));
}

function departmentNames(department) {
  const item = departmentCatalog.get(department);
  if (!item) return ['Reyon atanmamış'];
  return item.id === item.group.id ? [item.name] : [item.group.name, item.name];
}

function departmentLabel(department) {
  return departmentNames(department).map(name => t(name)).join(' · ');
}

function departmentReportScope() {
  const storeId = panel.role === 'admin' ? activeStore : panel.storeId;
  return {
    department: activeDepartmentGroup ? departmentNames(activeDepartment || activeDepartmentGroup) : ['Tüm reyonlar'],
    store: storeId ? rawStoreName(storeId) : null,
  };
}

function renderDepartmentReportScope() {
  const { department, store } = departmentReportScope();
  $('department-report-scope').textContent = [...department.map(name => t(name)), store ? t(store) : t('Tüm mağazalar'),
    calendarDay ? calendarDateFormat.format(new Date(calendarDay)) : t('Tüm tarihler')].join(' · ');
}

function indexCalendar() {
  const entries = new Map();
  function add(day, item) {
    if (!entries.has(day)) entries.set(day, []);
    entries.get(day).push(item);
  }
  function addActivity(value, kind, record, label) {
    const instant = Date.parse(value);
    if (Number.isFinite(instant)) add(dayFormat.format(instant), { kind, record, label, time: calendarTimeFormat.format(instant) });
  }
  for (const product of products.filter(inDepartment)) {
    addActivity(product.createdAt, 'products', product, 'Ürün kaydı');
    if (!canExportProduct(product)) continue;
    for (const field of operations[product.type]?.fields ?? []) {
      if (field.type !== 'date' && field.type !== 'datetime-local') continue;
      const value = product.details?.[field.name];
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value)) continue;
      const [day, time] = value.split('T');
      add(day, { kind: 'scheduled', record: product, label: field.label, time, value });
    }
  }
  for (const log of logs.filter(inDepartment)) {
    if (log.choice !== 'Kontrol kaydı oluşturuldu') addActivity(log.time, 'history', log, log.choice);
  }
  return entries;
}

function calendarItems(day) {
  const items = calendarEntries.get(day) ?? [];
  return Object.hasOwn(operations, activeModule)
    ? items.filter(item => item.record.type === activeModule)
    : items.filter(item => item.kind !== 'products' || canExportProduct(item.record));
}

function renderCalendar() {
  const first = new Date(`${calendarMonth}-01`);
  const next = new Date(first);
  next.setUTCMonth(next.getUTCMonth() + 1, 0);
  const monthTitle = calendarMonthFormat.format(first);
  if ($('calendar-month').textContent !== monthTitle) $('calendar-month').textContent = monthTitle;
  $('calendar-previous').disabled = calendarMonth === '0001-01';
  $('calendar-next').disabled = calendarMonth === '9999-12';
  const weekdays = Array.from({ length: 7 }, (_, day) => `<span>${escapeHtml(weekdayFormat.format(Date.UTC(2024, 0, day + 1)))}</span>`);
  const blanks = '<span aria-hidden="true"></span>'.repeat((first.getUTCDay() + 6) % 7);
  const today = dayFormat.format(new Date());
  const days = Array.from({ length: next.getUTCDate() }, (_, index) => {
    const day = `${calendarMonth}-${String(index + 1).padStart(2, '0')}`;
    const count = calendarItems(day).length;
    const label = calendarDateFormat.format(new Date(day));
    return `<button type="button" class="secondary" data-day="${day}" aria-pressed="${day === calendarDay}"
      ${day === today ? 'aria-current="date"' : ''} ${count ? 'data-events' : ''}
      aria-label="${escapeHtml(count ? `${label} · ${t('{count} kayıt', { count })}` : label)}">${index + 1}${count ? `<small>${count}</small>` : ''}</button>`;
  });
  const grid = $('calendar-days');
  const focusedDay = grid.contains(document.activeElement) ? document.activeElement.dataset.day : null;
  grid.innerHTML = weekdays.join('') + blanks + days.join('');
  if (focusedDay) grid.querySelector(`[data-day="${focusedDay}"]`)?.focus({ preventScroll: true });

  const items = calendarItems(calendarDay).sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
  const agendaTitle = calendarDay ? calendarDateFormat.format(new Date(calendarDay)) : t('Günlük kayıtlar');
  if ($('calendar-agenda-title').textContent !== agendaTitle) $('calendar-agenda-title').textContent = agendaTitle;
  const agendaStatus = $('calendar-agenda-status');
  agendaStatus.hidden = Boolean(items.length);
  agendaStatus.textContent = t(calendarDay ? 'Bu gün için kayıt bulunamadı.' : 'Kayıtları görmek için bir gün seçin.');
  const agenda = $('calendar-agenda');
  agenda.hidden = !items.length;
  agenda.innerHTML = items.map(({ record, kind, label, time }) => {
    const operation = operations[record.type]?.title ?? record.type;
    const context = [t(operation), storeName(record.storeId), departmentLabel(record.department), `${t('Lot')} ${record.lot}`];
    const description = kind === 'history' ? `${t('Karar')} · ${t(label)}` : t(label);
    return `<li><div><strong>${escapeHtml(record.name)}</strong>${time ? `<time datetime="${time}">${time}</time>` : ''}</div>
      <span>${escapeHtml(description)}</span><small>${escapeHtml(context.join(' · '))}</small></li>`;
  }).join('');
}

function selectCalendarDay(day) {
  calendarDay = day;
  if (day) calendarMonth = day.slice(0, 7);
  $('calendar-date').value = day;
  $('calendar-all').setAttribute('aria-pressed', String(!day));
  $('records-date').value = day;
  $('records-all-dates').setAttribute('aria-pressed', String(!day));
  renderDepartmentReportScope();
  renderCalendar();
  if (Object.hasOwn(operations, activeModule)) renderRows();
}

function moveCalendarMonth(offset) {
  const month = new Date(`${calendarMonth}-01`);
  month.setUTCMonth(month.getUTCMonth() + offset);
  calendarMonth = month.toISOString().slice(0, 7);
  renderCalendar();
}

function departmentOptions() {
  return ("<option value=\"\">" + escapeHtml(t("Reyon seçin")) + "</option>") + departmentGroups.map(group => `
    <optgroup label="${escapeHtml(t(group.name))}">
      <option value="${escapeHtml(group.id)}">${escapeHtml(t(group.name))}${group.children.length ? ' ' + escapeHtml(t('(genel)')) : ''}</option>
      ${group.children.map(child => `<option value="${escapeHtml(child.id)}">${escapeHtml(t(child.name))}</option>`).join('')}
    </optgroup>`).join('');
}

function defaultDepartment() {
  return activeDepartment || (departmentCatalog.has(activeDepartmentGroup) ? activeDepartmentGroup : '');
}

function renderSubdepartments() {
  const group = departmentGroups.find(item => item.id === activeDepartmentGroup);
  $('subdepartment-section').hidden = !group;
  if (!group) return;
  $('subdepartments-title').textContent = t('{department} alt reyonları', { department: t(group.name) });
  $('subdepartments-empty').hidden = Boolean(group.children.length);
  $('subdepartments').hidden = !group.children.length;
  const children = [{ id: '', name: 'Tümü' }, ...group.children];
  $('subdepartments').innerHTML = group.children.length ? children.map(({ id, name }) => (
    `<button type="button" data-department="${escapeHtml(id)}" aria-pressed="${id === activeDepartment}">${escapeHtml(t(name))}</button>`
  )).join('') : '';
}

function configureDepartments(groups) {
  departmentGroups = groups;
  departmentCatalog = new Map(groups.flatMap(group => [group, ...group.children].map(item => [item.id, { ...item, group }])));
  const filters = [{ id: '', name: 'Tüm reyonlar' }, ...groups, { id: unassignedDepartment, name: 'Reyon atanmamış' }];
  $('departments').innerHTML = filters.map(({ id, name }) => (
    `<button type="button" data-department-group="${escapeHtml(id)}" aria-pressed="${id === activeDepartmentGroup}">${escapeHtml(t(name))}</button>`
  )).join('');
  renderSubdepartments();
  renderDepartmentReportScope();
  const field = $('department');
  const previous = field.value;
  field.innerHTML = departmentOptions();
  field.value = departmentCatalog.has(previous) ? previous : defaultDepartment();
  const parent = $('department-parent');
  const previousParent = parent.value;
  parent.innerHTML = ("<option value=\"\">" + escapeHtml(t("Ana reyon seçin")) + "</option>") + groups.map(({ id, name }) => (
    `<option value="${escapeHtml(id)}">${escapeHtml(t(name))}</option>`
  )).join('');
  parent.value = previousParent;
  $('managed-departments').innerHTML = groups.map(group => (
    `<li><strong>${escapeHtml(t(group.name))}</strong> · ${group.children.length
      ? group.children.map(child => escapeHtml(t(child.name))).join(', ') : t("Alt reyon tanımlanmadı")}</li>`
  )).join('');
}

function renderDetails(product) {
  if (!product.details) return ("<small>" + escapeHtml(t("Operasyon bilgileri eksik")) + "</small>");
  const values = operations[product.type].fields.map(field => {
    const value = product.details[field.name];
    const hasTime = field.type === 'datetime-local';
    const date = typeof value === 'string' && (hasTime || field.type === 'date') ? Date.parse(hasTime ? `${value}Z` : value) : NaN;
    const formatted = Number.isFinite(date) ? (hasTime ? detailDateTimeFormat : detailDateFormat).format(date) : value;
    return [field.label, formatted ?? '—'];
  });
  if (product.details.destination) values.push(['Varış noktası', product.details.destination]);
  return values.map(([label, value]) => `<small>${escapeHtml(t(label))}</small><br>${escapeHtml(value)}<br>`).join('');
}

function deleteButton(product) {
  return `<button type="button" class="delete-product" data-action="delete" data-id="${escapeHtml(product.id)}"><span aria-hidden="true">🗑️</span> ${escapeHtml(t("Sil"))}</button>`;
}

function traceLink(product) {
  const params = new URLSearchParams({ code: product.code, lot: product.lot, store: product.storeId });
  return `<a class="trace-record-link" href="/trace?${escapeHtml(params.toString())}">MU TRACE</a>`;
}

function evidenceLink(productId, evidence) {
  if (!evidence) return '';
  const params = new URLSearchParams({ panel: panel.role });
  if ($('core-panel').dataset.mobile === '1') params.set('mobil', '1');
  const url = `/api/products/${encodeURIComponent(productId)}/evidence/${encodeURIComponent(evidence.id)}?${params}`;
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(t(evidence.category))} · ${escapeHtml(t('Fotoğrafı aç'))}</a>`;
}

function rowActions(product) {
  const id = escapeHtml(product.id);
  const actions = [];
  if (!operations[product.type].disabled && !product.details && (panel.role !== 'staff' || product.createdBy === panel.email)) {
    actions.push(`<button type="button" data-action="edit" data-id="${id}">${escapeHtml(t("Bilgileri tamamla"))}</button>`);
  } else if (panel.canApprove && product.type === 'Geçici Blokaj' && product.locked && !product.proposal) {
    const available = product.actions.some(action => action.releaseTemporary);
    const disabled = available ? '' : (" disabled title=\"" + escapeHtml(t("Blokaj bitiş zamanı henüz dolmadı")) + "\"");
    actions.push(`<button type="button" data-action="release" data-id="${id}"${disabled}>${escapeHtml(t("Blokajı kaldır"))}</button>`);
  } else if (!product.proposal && product.actions.length) {
    actions.push(`<button type="button" data-action="decide" data-id="${id}">${panel.canApprove ? t("Operasyon kararı") : t("Operasyon talebi")}</button>`);
  }
  if (!product.proposal && product.assessmentActions.length) actions.push(`<button type="button" class="secondary" data-action="assessment" data-id="${id}">${panel.canApprove ? t("MuDecision kararı") : t("MuDecision önerisi")}</button>`);
  actions.push(
    `<button type="button" class="secondary" data-action="trace" data-id="${id}">${escapeHtml(t("Lot geçmişi"))}</button>`,
    traceLink(product),
  );
  if (panel.role === 'admin' && !operations[product.type].disabled) actions.push(deleteButton(product));
  return actions.join('');
}

function renderProductStatus(product) {
  return `<span class="tag">${escapeHtml(t(product.status))}</span>
    ${product.proposal && product.status !== 'Onay bekliyor' ? ("<small class=\"risk tag warn\">" + escapeHtml(t("Onay bekliyor")) + "</small>") : ''}
    ${product.assessment ? `<small class="risk">MuDecision · ${escapeHtml(t(product.assessment))}</small>` : ''}
    ${product.risk ? `<small class="risk tag ${escapeHtml(product.risk.level)}">${escapeHtml(t(product.risk.label))}</small>` : ''}`;
}

function renderDecisionFiles() {
  const query = $('decision-search').value.trim().toLocaleLowerCase('tr');
  const files = new Map();
  for (const product of products.filter(inDepartment)) {
    const key = JSON.stringify([product.storeId, product.code, product.lot]);
    if (!files.has(key)) files.set(key, []);
    files.get(key).push(product);
  }
  const matching = [...files.values()].filter(file => file.some(product => (
    [product.name, product.code, product.lot].join(' ').toLocaleLowerCase('tr').includes(query)
  )));
  $('decision-files').innerHTML = matching.map(file => {
    const [product] = file;
    return `<article class="decision-file" aria-labelledby="file-${escapeHtml(product.id)}">
      <div class="decision-file-heading">
        <div>
          <h3 id="file-${escapeHtml(product.id)}">${escapeHtml(product.name)}</h3>
          <small>${escapeHtml(storeName(product.storeId))} · Barkod ${escapeHtml(product.code)} · Lot ${escapeHtml(product.lot)}</small>
        </div>
        <div class="actions"><button type="button" class="secondary" data-action="trace" data-id="${escapeHtml(product.id)}">${escapeHtml(t("Lot geçmişi"))}</button>${traceLink(product)}</div>
      </div>
      <div class="scroll">
        <table>
          <thead><tr><th scope="col">${escapeHtml(t("Operasyon"))}</th><th scope="col">${escapeHtml(t("Kayıt bilgisi"))}</th><th scope="col">${escapeHtml(t("Durum ve risk"))}</th><th scope="col">${escapeHtml(t("İşlem"))}</th></tr></thead>
          <tbody>${file.map(record => `
            <tr>
              <th scope="row">${escapeHtml(operations[record.type].title)}<br><small>${escapeHtml(departmentLabel(record.department))}</small></th>
              <td class="details">${renderDetails(record)}${evidenceLink(record.id, record.evidence)}</td>
              <td>${renderProductStatus(record)}</td>
              <td><div class="actions">
                ${!record.proposal && record.assessmentActions.length ? `<button type="button" data-action="assessment" data-id="${escapeHtml(record.id)}">${panel.canApprove ? t("MuDecision kararı") : t("MuDecision önerisi")}</button>` : ''}
                <button type="button" class="secondary" data-action="open-operation" data-id="${escapeHtml(record.id)}">${escapeHtml(t("Operasyon kaydına git"))}</button>
                ${panel.role === 'admin' && !operations[record.type].disabled ? deleteButton(record) : ''}
              </div></td>
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </article>`;
  }).join('') || (files.size
    ? ("<p>" + escapeHtml(t("Aramanızla eşleşen karar dosyası bulunamadı.")) + "</p>")
    : activeDepartmentGroup ? ("<p>" + escapeHtml(t("Bu reyonda henüz ürün kaydı yok.")) + "</p>")
    : ("<p>" + escapeHtml(t("Henüz ürün kaydı yok. Bir operasyon modülünden ürün eklediğinizde karar dosyası burada görünecek.")) + "</p>"));
}

function recordedDay(product) {
  const time = Date.parse(product.createdAt);
  return Number.isFinite(time) ? dayFormat.format(time) : '';
}

function operationRecordGroups(forExport = false) {
  const query = $('search').value.trim().toLocaleLowerCase('tr');
  const groups = new Map(calendarDay ? [[calendarDay, []]] : []);
  for (const product of products) {
    if (product.type !== activeModule || !inDepartment(product) || (forExport && !canExportProduct(product))) continue;
    if (![product.name, product.code, product.lot].join(' ').toLocaleLowerCase('tr').includes(query)) continue;
    const day = recordedDay(product);
    if (calendarDay && day !== calendarDay) continue;
    if (!groups.has(day)) groups.set(day, []);
    groups.get(day).push(product);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

function operationQuantity(product) {
  return product.type === 'Depo Fark'
    ? (product.details ? product.details.physicalStock - product.details.systemStock : null)
    : product.qty;
}

function operationQuantityLabel(type) {
  return type === 'Depo Fark' ? 'Sayım farkı' : operations[type].quantityLabel || 'Adet';
}

function renderRows() {
  const groups = operationRecordGroups();
  const options = departmentOptions();
  const empty = `<tr><td colspan="6">${escapeHtml(t('Kayıt bulunamadı'))}</td></tr>`;
  const row = product => {
    const quantity = operationQuantity(product);
    const time = Date.parse(product.createdAt);
    return `
    <tr id="record-${escapeHtml(product.id)}" tabindex="-1">
      <td>${escapeHtml(product.name)}<br><small>${escapeHtml(storeName(product.storeId))} · ${escapeHtml(departmentLabel(product.department))}${Number.isFinite(time) ? ` · ${calendarTimeFormat.format(time)}` : ''}</small></td>
      <td>${escapeHtml(product.code)}<br><small>${escapeHtml(product.lot)}</small></td>
      <td>${escapeHtml(quantity == null ? '—' : product.type === 'Depo Fark' ? signed(quantity) : quantity)}</td>
      <td class="details">${renderDetails(product)}${evidenceLink(product.id, product.evidence)}</td>
      <td>${renderProductStatus(product)}</td>
      <td>
        <div class="actions">${rowActions(product)}</div>
        ${product.department == null && panel.role !== 'staff' && !operations[product.type].disabled ? `<form class="department-assignment" data-product="${escapeHtml(product.id)}">
          <select name="department" aria-label="${escapeHtml(t('{product} için reyon', { product: product.name }))}" required>${options}</select>
          <button type="submit" class="secondary">${escapeHtml(t("Reyon ata"))}</button>
        </form>` : ''}
      </td>
    </tr>`;
  };
  const table = $('records-table');
  for (const body of Array.from(table.tBodies)) body.remove();
  table.insertAdjacentHTML('beforeend', groups.map(([day, items]) => {
    const heading = day ? calendarDateFormat.format(new Date(day)) : t('Kayıt tarihi bilinmiyor');
    return `<tbody><tr class="records-day"><th scope="rowgroup" colspan="6">${escapeHtml(heading)}<small>${escapeHtml(t('{count} kayıt', { count: items.length }))}</small></th></tr>
      ${items.length ? items.map(row).join('') : empty}</tbody>`;
  }).join('') || `<tbody>${empty}</tbody>`);
}

function historyRows() {
  const query = $('history-search').value.trim().toLocaleLowerCase('tr');
  const date = $('history-date').value;
  const operation = $('history-operation').value;
  return logs.filter(log => (
    inDepartment(log) &&
    (!lotFilter || (log.storeId === lotFilter.storeId && log.code === lotFilter.code && log.lot === lotFilter.lot)) &&
    (!barcodeHistory || (log.storeId === barcodeHistory.storeId && barcodeHistory.barcodes.includes(log.code))) &&
    (!operation || log.type === operation) &&
    (!date || dayFormat.format(new Date(log.time)) === date) &&
    [log.name, log.code, log.lot, log.staff, log.actor, log.choice, log.reason, log.result, log.destination]
      .join(' ').toLocaleLowerCase('tr').includes(query)
  ));
}

function renderHistory() {
  $('history').innerHTML = historyRows().map(log => `
    <tr>
      <td>${escapeHtml(dateFormat.format(new Date(log.time)))}</td>
      <td>${escapeHtml(log.name)}<br><small>${escapeHtml(storeName(log.storeId))} · ${escapeHtml(log.code)} · ${escapeHtml(log.lot)} · ${escapeHtml(departmentLabel(log.department))}</small></td>
      <td>${escapeHtml(t(operations[log.type]?.title ?? log.type))}</td>
      <td>${escapeHtml(log.staff)}${log.actor ? `<br><small>${escapeHtml(log.actor)}</small>` : ''}
        ${log.requestedBy && log.requestedBy !== log.actor ? `<br><small>${escapeHtml(t('Talep sahibi'))} · ${escapeHtml(log.requestedBy)}</small>` : ''}</td>
      <td>${log.kind === 'assessment' ? '<small>MuDecision</small><br>' : ''}${escapeHtml(t(log.choice))}<br><small>${escapeHtml(log.reason)}</small><br>${evidenceLink(log.id, log.evidence)}</td>
      <td>${escapeHtml(t(log.result))}${log.destination ? `<br><small>${escapeHtml(log.destination)}</small>` : ''}</td>
    </tr>`).join('') || ("<tr><td colspan=\"6\">" + escapeHtml(t("Karar kaydı bulunamadı")) + "</td></tr>");
}

function reportRows() {
  const byStore = panel.role === 'admin';
  const groups = new Map();
  const getGroup = key => {
    if (!groups.has(key)) groups.set(key, { name: byStore ? rawStoreName(key) : key, entries: 0, decisions: 0, pending: 0 });
    return groups.get(key);
  };
  if (byStore) for (const store of panel.stores) if (!activeStore || store.id === activeStore) getGroup(store.id);
  for (const product of products.filter(inDepartment)) {
    getGroup(byStore ? product.storeId : (product.createdBy || null)).entries++;
    if (product.proposal) getGroup(byStore ? product.storeId : product.proposal.actor).pending++;
    else if (product.status === 'Onay bekliyor') getGroup(byStore ? product.storeId : (product.createdBy || null)).pending++;
  }
  for (const log of logs.filter(inDepartment)) {
    if (log.choice !== 'Kontrol kaydı oluşturuldu') getGroup(byStore ? log.storeId : (log.actor || log.staff || null)).decisions++;
  }
  return [...groups.values()];
}

function renderDashboard() {
  $('report-group').textContent = panel.role === 'admin' ? t("Mağaza") : t("Personel");
  $('report-title').textContent = panel.role === 'admin' ? t("Mağaza raporları") : t("Personel performansı");
  const rows = reportRows().map(row => ({ ...row, name: t(row.name ?? 'Önceki kayıtlar') }));
  rows.sort((a, b) => a.name.localeCompare(b.name, english ? 'en' : 'tr'));
  $('report-rows').innerHTML = rows.map(row => `
    <tr><th scope="row">${escapeHtml(row.name)}</th><td>${row.entries}</td><td>${row.decisions}</td><td>${row.pending}</td></tr>`
  ).join('') || ("<tr><td colspan=\"4\">" + escapeHtml(t("Henüz raporlanacak işlem yok.")) + "</td></tr>");
  const controls = products.filter(product => inDepartment(product) && !product.scanExample);
  const activity = pilotActivity();
  const scanChecks = activity.filter(log => log.kind === 'proposal' && log.scanCheck).length;
  const durations = activity.filter(log => log.requestStatus && log.requestStatus !== 'pending' && log.requestedAt)
    .map(log => Date.parse(log.time) - Date.parse(log.requestedAt))
    .filter(duration => Number.isFinite(duration) && duration >= 0);
  const minutes = durations.length ? durations.reduce((total, duration) => total + duration, 0) / durations.length / 60_000 : null;
  const risks = new Map();
  for (const record of controls.filter(product => product.expiryRisk)) {
    const key = JSON.stringify([record.storeId, record.code, record.lot]);
    const earlier = risks.get(key);
    if (!earlier || (earlier.expiryRisk !== 'SKT geçmiş' && record.expiryRisk === 'SKT geçmiş')
      || (earlier.expiryRisk === 'SKT bilgisi eksik' && record.expiryRisk !== 'SKT bilgisi eksik')) risks.set(key, record);
  }
  const metrics = [
    ['Kontrol sayısı', controls.length + scanChecks],
    ['Bekleyen onaylar', controls.filter(record => record.proposal || record.status === 'Onay bekliyor').length],
    ['Ortalama karar süresi', minutes === null ? '—' : t('{minutes} dk', { minutes: new Intl.NumberFormat(calendarLocale, { maximumFractionDigits: 1 }).format(minutes) })],
    ['SKT riskleri', risks.size],
  ];
  $('pilot-metrics').innerHTML = metrics.map(([label, value]) => `<div class="card"><small>${escapeHtml(t(label))}</small><b>${escapeHtml(value)}</b></div>`).join('');
  $('pilot-risks').innerHTML = [...risks.values()].map(record => {
    const date = record.details?.expiryDate;
    return `<li><strong>${escapeHtml(record.name)}</strong> · ${escapeHtml(storeName(record.storeId))} · ${escapeHtml(record.lot)}
      · ${escapeHtml(t(record.expiryRisk))}${date && Number.isFinite(Date.parse(date)) ? ` · ${escapeHtml(detailDateFormat.format(new Date(date)))}` : ''}
      <button type="button" class="secondary" data-action="open-operation" data-id="${escapeHtml(record.id)}">${escapeHtml(t('Operasyon kaydına git'))}</button></li>`;
  }).join('') || `<li>${escapeHtml(t('SKT riski bulunamadı.'))}</li>`;
  renderPilotHistory(activity);
}

function pilotActivity() {
  const exampleIds = new Set(products.filter(product => product.scanExample).map(product => product.id));
  return logs.filter(log => inDepartment(log) && !exampleIds.has(log.id));
}

function renderPilotHistory(activity = pilotActivity()) {
  const query = $('pilot-history-search').value.trim().toLocaleLowerCase('tr');
  const matches = activity.filter(log => [log.name, log.code, log.lot].join(' ').toLocaleLowerCase('tr').includes(query));
  $('pilot-history').innerHTML = matches.slice(0, 50).map(log => `<tr>
    <td>${escapeHtml(dateFormat.format(new Date(log.time)))}</td>
    <td>${escapeHtml(log.name)}<br><small>${escapeHtml(log.code)} · ${escapeHtml(log.lot)}</small></td>
    <td>${escapeHtml(t(operations[log.type]?.title ?? log.type))}</td>
    <td>${escapeHtml(t(log.result))}</td>
    <td><button type="button" class="secondary" data-action="trace" data-id="${escapeHtml(log.id)}">${escapeHtml(t('Lot geçmişi'))}</button></td>
  </tr>`).join('') || `<tr><td colspan="5">${escapeHtml(t('Kayıt bulunamadı'))}</td></tr>`;
  $('pilot-history-limit').hidden = matches.length <= 50;
}

function renderApproval() {
  const scoped = products.filter(inDepartment);
  const pending = scoped.filter(product => product.proposal || product.recheck || (panel.role !== 'staff' && product.status === 'Onay bekliyor'));
  const drafts = new Map([...$('approval-list').querySelectorAll('form[data-proposal]')]
    .map(form => [form.dataset.proposal, form.elements.reason.value]));
  $('approval-list').innerHTML = pending.map(product => {
    const id = escapeHtml(product.id);
    const proposal = product.proposal;
    const returned = product.recheck;
    const scan = proposal?.scanCheck;
    const scanRks = { clear: 'Kontrol edildi, blokaj görülmedi', blocked: 'Blokaj görüldü', unknown: 'Doğrulanamadı' };
    const scanPackaging = { intact: 'Sağlam', damaged: 'Hasarlı', unknown: 'Kontrol edilemedi' };
    return `<article class="approval-item"${proposal ? ` id="talep-${escapeHtml(proposal.id)}" tabindex="-1"` : ''}>
      <h3>${escapeHtml(product.name)}</h3>
      <p>${escapeHtml(storeName(product.storeId))} · ${escapeHtml(t(operations[product.type].title))} · ${escapeHtml(t('Lot'))} ${escapeHtml(product.lot)}</p>
      ${proposal ? `<p><strong>${escapeHtml(t(proposal.choice))}</strong> · ${escapeHtml(proposal.actor)}</p><p>${escapeHtml(proposal.reason)}</p>
        <p>${evidenceLink(product.id, proposal.evidence ?? product.evidence)}</p>` : returned
        ? `<p><strong>${escapeHtml(t('Ek kontrol istendi'))}</strong> · ${escapeHtml(returned.actor)}</p><p>${escapeHtml(returned.reason)}</p>`
        : ("<p>" + escapeHtml(t("Depo farkı onay bekliyor.")) + "</p>")}
      ${scan ? `<p class="scan-check-summary"><strong>${panel.scanEnabled ? t("MuTerminal Scan kontrolü") : t("Kontrol sonuçları")}</strong> · RKS ${escapeHtml(t(scanRks[scan.rks]))} · ${escapeHtml(t('SKT'))} ${escapeHtml(scan.expiryDate?.split('-').reverse().join('.') ?? t('Okunamadı'))} · ${escapeHtml(t('Ambalaj'))} ${escapeHtml(t(scanPackaging[scan.packaging]))} · ${escapeHtml(t('{qty} adet', { qty: scan.quantity }))}</p>` : ''}
      <p><button type="button" class="secondary" data-action="open-operation" data-id="${id}">${escapeHtml(t("Operasyon kaydına git"))}</button></p>
      ${returned?.actor === panel.email && !operations[product.type].disabled
        ? returned.source === 'scan'
          ? panel.scanEnabled ? `<p><a href="/staff/scan?code=${encodeURIComponent(product.code)}&amp;lot=${encodeURIComponent(product.lot)}${$('core-panel').dataset.mobile === '1' ? '&amp;mobil=1' : ''}">${escapeHtml(t('Ek kontrol kaydet'))}</a></p>` : ''
          : `<p><button type="button" data-action="recheck" data-id="${id}">${escapeHtml(t('Ek kontrol kaydet'))}</button></p>` : ''}
      ${proposal && panel.canApprove && !operations[product.type].disabled ? `<form data-review="${id}" data-proposal="${escapeHtml(proposal.id)}">
        <label for="review-${id}">${escapeHtml(t("İnceleme gerekçesi"))}</label>
        <textarea id="review-${id}" name="reason" maxlength="1000" required>${escapeHtml(drafts.get(proposal.id) ?? '')}</textarea>
        <div class="actions"><button type="submit" value="approve">${escapeHtml(t("Onayla"))}</button><button type="submit" value="reject" class="secondary">${escapeHtml(t("Reddet"))}</button><button type="submit" value="recheck" class="secondary">${escapeHtml(t('Ek kontrol iste'))}</button></div>
      </form>` : ''}
    </article>`;
  }).join('') || ("<p>" + escapeHtml(t("Bekleyen talep yok.")) + "</p>");
  if (activeModule === approvalModule) renderApprovalHistory();
  if (panel.scanEnabled && !handoffFocused && handoffId && /^[a-f0-9]{24}$/.test(handoffId)) {
    const handoff = $(`talep-${handoffId}`);
    if (handoff) {
      handoffFocused = true;
      handoff.focus({ preventScroll: true });
      handoff.scrollIntoView({ block: 'center' });
    }
  }
}

function renderApprovalHistory() {
  $('approval-history').innerHTML = logs.filter(log => inDepartment(log) && (
    log.requestStatus || log.kind === 'proposal' || log.kind === 'review' || log.requestedBy
  )).map(log => `<tr>
    <td>${escapeHtml(dateFormat.format(new Date(log.time)))}</td>
    <td>${escapeHtml(log.name)} · ${escapeHtml(log.lot)}</td>
    <td>${escapeHtml(log.staff ?? log.actor)}</td>
    <td>${escapeHtml(t(log.choice))}<br><small>${escapeHtml(log.reason)}</small><br>${evidenceLink(log.id, log.evidence)}</td>
    <td>${escapeHtml(t(log.result))}</td>
  </tr>`).join('') || `<tr><td colspan="5">${escapeHtml(t('Karar kaydı bulunamadı'))}</td></tr>`;
}

function configureStores() {
  const options = panel.stores.map(store => `<option value="${escapeHtml(store.id)}">${escapeHtml(t(store.name))}</option>`).join('');
  const filter = $('store-filter');
  filter.innerHTML = ("<option value=\"\">" + escapeHtml(t("Tüm mağazalar")) + "</option>") + options;
  filter.value = activeStore;
  for (const id of ['entry-store', 'user-store', 'member-store']) {
    const select = $(id);
    if (!select) continue;
    const previous = select.value;
    select.innerHTML = options;
    select.value = previous || activeStore || panel.storeId;
  }
}

async function loadManagement() {
  const response = await requestApi('/api/admin/management');
  if (!response.ok) throw new Error('Yönetim verileri yüklenemedi.');
  const { users, stores, chains, settings, departmentGroups: groups } = await response.json();
  managedUsers = users;
  panel.stores = stores;
  configureStores();
  configureDepartments(groups);
  const chain = $('store-chain');
  const previousChain = chain.value;
  chain.replaceChildren(...chains.map(({ id, name }) => new Option(name, id)));
  chain.value = chains.some(({ id }) => id === previousChain) ? previousChain : 'pilot';
  $('managed-stores').innerHTML = stores.map(store => `<li>${escapeHtml(t(store.name))} <small>${escapeHtml(store.id)}</small></li>`).join('');
  $('managed-users').innerHTML = users.map(user => `
    <li>${user.displayName ? `${escapeHtml(user.displayName)} · ` : ''}${escapeHtml(user.email)} · ${escapeHtml(user.roles.map(role => roleNames[role]).join(', '))} · ${escapeHtml(storeName(user.storeId))}
      ${!user.builtIn && user.roles.includes('staff') ? ` · ${escapeHtml(panel.staffDepartments[user.staffDepartment] ?? 'İş unvanı atanmamış')}` : ''}
      ${user.canApprove && user.roles.includes('admin') ? ' · Onay yetkili' : ''}
      ${user.builtIn || user.email === panel.email ? '' : `<button type="button" class="secondary" data-user="${escapeHtml(user.email)}" data-edit>${user.roles.includes('staff') ? t("Yetki ve unvanı düzenle") : t("Yetkiyi düzenle")}</button>
      <button type="button" class="secondary" data-user="${escapeHtml(user.email)}" data-active="${!user.active}">${user.active ? t("Devre dışı bırak") : t("Etkinleştir")}</button>`}
    </li>`).join('');
  $('product-source').value = settings.productSource;
  $('expiry-warning').value = settings.expiryWarningDays;
  $('erp-endpoint').value = settings.erpEndpoint;
  $('wms-endpoint').value = settings.wmsEndpoint;
  $('rks-scope').checked = settings.blockRksAcrossLots;
}

function editManagedUser(user) {
  $('user-form').reset();
  $('user-email').value = user?.email ?? '';
  $('user-email').readOnly = Boolean(user);
  $('user-name-field').hidden = Boolean(user);
  $('user-name').disabled = Boolean(user);
  $('user-name').required = !user;
  $('user-password-field').hidden = Boolean(user);
  $('user-password').disabled = Boolean(user);
  $('user-role').value = user?.roles[0] ?? 'staff';
  $('user-job-title').value = user?.staffDepartment ?? '';
  $('user-store').value = user?.storeId ?? panel.storeId;
  updateUserRoleFields();
  $('user-approval').querySelector('input').checked = user?.canApprove ?? false;
  $('save-user').textContent = user ? t("Değişiklikleri kaydet") : t("Kullanıcı oluştur");
  $('cancel-user-edit').hidden = !user;
}

function updateUserRoleFields() {
  const role = $('user-role').value;
  $('user-approval').hidden = role !== 'admin';
  $('user-job-title-field').hidden = role !== 'staff';
  $('user-job-title').disabled = role !== 'staff';
}

function staffJobTitleOptions(selected) {
  return ("<option value=\"\">" + escapeHtml(t("İş unvanı seçin")) + "</option>") + Object.entries(panel.staffDepartments).map(([id, name]) => (
    `<option value="${escapeHtml(id)}"${id === selected ? ' selected' : ''}>${escapeHtml(t(name))}</option>`
  )).join('');
}

async function loadTeam() {
  const response = await requestApi('/api/manager/staff');
  if (!response.ok) throw new Error('Personel listesi yüklenemedi.');
  const staff = await response.json();
  $('team-members').innerHTML = staff.map(member => `<li>
    <strong>${escapeHtml(member.displayName ?? member.email)}</strong> · ${escapeHtml(member.email)}
    ${panel.role === 'admin' ? ` · ${escapeHtml(panel.stores.find(store => store.id === member.storeId)?.name ?? member.storeId ?? '')}` : ''}
    ${member.active ? '' : ' · Devre dışı'}
    <button type="button" class="secondary" data-member="${escapeHtml(member.email)}">${escapeHtml(t("Şifreyi değiştir"))}</button>
    <form class="department-assignment">
      <input type="hidden" name="email" value="${escapeHtml(member.email)}">
      <select name="staffDepartment" aria-label="${escapeHtml(member.displayName ?? member.email)} iş unvanı" required>${staffJobTitleOptions(member.staffDepartment)}</select>
      <button type="submit" class="secondary">${escapeHtml(t("Unvanı kaydet"))}</button>
    </form>
  </li>`).join('') || ("<li>" + escapeHtml(t("Henüz personel hesabı yok.")) + "</li>");
}

function renderEntry(product) {
  const operation = operations[activeModule];
  const stockCount = activeModule === 'Depo Fark';
  const checksDate = activeModule === 'SKT';
  const quantityLabel = operation.quantityLabel || 'Adet';
  editingId = product?.id;
  entryRevision++;
  $('product-form').reset();
  for (const id of ['name', 'code', 'lot', 'qty']) {
    $(id).value = product?.[id] ?? '';
    $(id).readOnly = Boolean(product);
  }
  $('entry-title').textContent = product ? t("Operasyon bilgilerini tamamla") : t("Manuel ürün kaydı");
  $('department-field').hidden = Boolean(product);
  $('department').disabled = Boolean(product);
  $('department').value = defaultDepartment();
  $('entry-store-field').hidden = Boolean(product) || panel.role !== 'admin';
  $('entry-store').disabled = $('entry-store-field').hidden;
  $('entry-store').value = activeStore || panel.storeId;
  $('save-product').textContent = product ? t("Bilgileri kaydet") : t("Ürünü kaydet");
  $('cancel-edit').hidden = !product;
  $('entry-evidence').hidden = Boolean(product);
  $('quantity-label').textContent = t(quantityLabel);
  $('quantity-column').textContent = t(operationQuantityLabel(activeModule));
  $('quantity-field').hidden = stockCount;
  $('qty').required = !stockCount && !product;
  $('qty').disabled = stockCount || Boolean(product);
  $('expired-field').hidden = checksDate || Boolean(product);
  $('expired').disabled = checksDate || Boolean(product);
  $('operation-fields').innerHTML = operation.fields.map(field => {
    const attributes = field.type === 'number' ? ' min="0" step="1"' : field.max ? ` maxlength="${field.max}"` : '';
    return `<div><label for="${field.name}">${escapeHtml(t(field.label))}</label><input id="${field.name}" name="${field.name}" type="${field.type}"${attributes} required></div>`;
  }).join('');
  $('stock-preview').hidden = true;
  showStatus('product-status', '');
}

function selectModule(type, product) {
  const isHistory = type === historyModule;
  const isDecision = type === decisionModule;
  const isDashboard = type === dashboardModule;
  const isApproval = type === approvalModule;
  const isScan = type === scanModule;
  const isManagement = type === managementModule;
  const isStaffManagement = type === staffManagementModule;
  const isOperation = Object.hasOwn(operations, type);
  const isReadOnly = isOperation && operations[type].disabled;
  activeModule = type;
  renderCalendar();
  barcodeHistory = product?.barcodes ? product : undefined;
  lotFilter = barcodeHistory ? undefined : product;
  currentId = null;
  editingId = undefined;
  for (const button of $('modules').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.module === type));
  }
  document.dispatchEvent(new CustomEvent('muterminal:module', { detail: type }));
  $('decision-files-panel').hidden = !isDecision;
  $('dashboard-panel').hidden = !isDashboard;
  $('approval-panel').hidden = !isDashboard && !isApproval;
  $('approval-history-panel').hidden = !isApproval;
  $('management-panel').hidden = !isManagement;
  $('staff-management-panel').hidden = !isStaffManagement;
  $('stats').hidden = isDecision || isManagement || isStaffManagement || isApproval || isScan || panel.role === 'staff';
  $('module-header').hidden = !isOperation && !isHistory;
  $('entry-panel').hidden = !isOperation || isReadOnly;
  $('records-panel').hidden = !isOperation;
  $('decision').hidden = true;
  $('history-panel').hidden = !isHistory;
  if (isDecision) {
    if (lastState !== undefined) renderDecisionFiles();
    return;
  }
  if (isDashboard) {
    renderDashboard();
    renderApproval();
    return;
  }
  if (isApproval) {
    renderApproval();
    return;
  }
  if (isScan) return;
  if (isManagement) {
    loadManagement().catch(error => showStatus('management-status', error.message, true));
    return;
  }
  if (isStaffManagement) {
    loadTeam().catch(error => showStatus('team-status', error.message, true));
    return;
  }

  const module = isHistory ? {
    title: barcodeHistory ? t('Ürün karar geçmişi') : panel.role === 'staff' ? t("Kendi İşlem Geçmişim") : t("Karar Geçmişi"),
    feature: barcodeHistory ? 'MuTrace Lite' : 'MuLog',
    description: 'Tarih, ürün, lot, gerekçe ve sonuca göre kararları inceleyin.',
  } : operations[type];
  $('module-title').textContent = t(module.title);
  $('module-feature').textContent = module.feature;
  $('module-description').textContent = t(isReadOnly ? 'Cross-Dock sonraki geliştirme aşamasında kullanıma açılacak.' : module.description);
  $('clear-lot').hidden = !product;
  $('clear-lot').textContent = t(barcodeHistory ? 'Ürün filtresini kaldır' : 'Lot filtresini kaldır');
  $('lot-filter').hidden = !product;
  if (product) {
    $('lot-filter').textContent = barcodeHistory
      ? `${product.name} · ${storeName(product.storeId)} · ${t('Barkod')} ${product.barcode}`
      : `${product.name} · ${storeName(product.storeId)} · Barkod ${product.code} · Lot ${product.lot}`;
    for (const id of ['history-search', 'history-date', 'history-operation']) $(id).value = '';
  }
  if (isHistory) {
    renderHistory();
  } else {
    $('search').value = '';
    showStatus('records-status', '');
    if (isReadOnly) $('quantity-column').textContent = t(operationQuantityLabel(type));
    else renderEntry();
    renderRows();
  }
}

function render() {
  calendarEntries = indexCalendar();
  renderCalendar();
  const visibleProducts = products.filter(inDepartment);
  const stats = [
    ['Toplam ürün kaydı', visibleProducts.length],
    ['RKS blokajlı', visibleProducts.filter(product => product.type === 'RKS Blokaj' && product.locked).length],
    ['Delist blokajlı', visibleProducts.filter(product => product.type === 'Delist Blokaj' && product.locked).length],
    ['Geçici blokajlı', visibleProducts.filter(product => product.type === 'Geçici Blokaj' && product.locked).length],
    ['SKT kontrolü', visibleProducts.filter(product => product.type === 'SKT').length],
    ['Karar kaydı', logs.filter(inDepartment).length],
  ];
  $('stats').innerHTML = stats.map(([label, value]) => `<div class="card"><small>${label}</small><b>${value}</b></div>`).join('');
  if (activeModule === historyModule) renderHistory();
  else if (activeModule === decisionModule) renderDecisionFiles();
  else if (activeModule === dashboardModule) {
    renderDashboard();
    renderApproval();
  } else if (activeModule === approvalModule) renderApproval();
  else if (Object.hasOwn(operations, activeModule)) renderRows();
  if (editingId && !products.some(product => product.id === editingId)) renderEntry();
  if (currentId) {
    const product = products.find(item => item.id === currentId);
    if (product) renderDecisionChoices(product);
    else {
      currentId = null;
      $('decision').hidden = true;
    }
  }
}

async function requestApi(path, options) {
  const headers = new Headers(options?.headers);
  const { panel: role, mobile } = $('core-panel').dataset;
  headers.set('X-MuTerminal-Panel', role);
  if (mobile === '1') headers.set('X-MuTerminal-Mobile', '1');
  const response = await fetch(path, { ...options, headers });
  if (response.status === 401) window.location.replace(panel ? `/?panel=${panel.role}#admin-giris` : '/#admin-giris');
  return response;
}

async function refresh() {
  const id = ++refreshId;
  try {
    const response = await requestApi('/api/state');
    if (!response.ok) throw new Error();
    const snapshot = await response.text();
    if (id !== refreshId) return;
    if (lastState !== snapshot) {
      const state = JSON.parse(snapshot);
      ({ products, logs } = state);
      if (state.departmentGroups && JSON.stringify(state.departmentGroups) !== JSON.stringify(departmentGroups)) {
        configureDepartments(state.departmentGroups);
      }
      render();
      lastState = snapshot;
    }
    showStatus('sync-status', '');
    $('export').disabled = false;
    setReportAvailability(true);
  } catch {
    if (id !== refreshId) return;
    showStatus('sync-status', 'Kayıtlar güncellenemedi. MuTerminal sunucusunu ve PostgreSQL bağlantısını kontrol edin.', true);
    $('export').disabled = true;
    setReportAvailability(false);
  }
}

function setReportAvailability(available) {
  for (const kind of ['department', 'operation', 'summary', 'history']) $(`report-export-${kind}`).disabled = !available;
}

async function writeApi(path, method, body) {
  const options = { method };
  if (body !== undefined) {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify(body);
  }
  const response = await requestApi(path, options);
  if (response.ok) return;
  const result = await response.json().catch(() => ({}));
  throw new Error(result.error || 'Kayıt işlemi tamamlanamadı.');
}

async function formEvidence(prefix) {
  const file = $(`${prefix}-evidence-photo`).files[0];
  const category = $(`${prefix}-evidence-category`).value;
  if (!file && !category) return;
  const { encodeEvidence } = await import('/mu-evidence.mjs');
  return encodeEvidence(file, category);
}

$('product-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  if (button.disabled) return;
  const module = activeModule;
  const revision = entryRevision;
  const id = editingId;
  const data = new FormData(form);
  const { name, code, lot, qty, department, storeId } = Object.fromEntries(data);
  const details = Object.fromEntries(operations[module].fields.map(field => [
    field.name, field.type === 'number' ? Number(data.get(field.name)) : data.get(field.name),
  ]));
  button.disabled = true;
  showStatus('product-status', 'Kaydediliyor…');
  try {
    if (id) await writeApi(`/api/products/${id}/details`, 'POST', { details });
    else await writeApi('/api/products', 'POST', {
      name, code, lot, department, storeId, type: module, qty: Number(qty), expired: data.has('expired'), details,
      evidence: await formEvidence('entry'),
    });
    if (module === activeModule && revision === entryRevision) {
      renderEntry();
      $('search').value = '';
      renderRows();
      showStatus('product-status', id ? t("Operasyon bilgileri kaydedildi.") : `Ürün kaydedildi · ${departmentLabel(department)}`);
    }
    await refresh();
  } catch (error) {
    if (module === activeModule && revision === entryRevision) showStatus('product-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

function updateDestination() {
  const product = products.find(item => item.id === currentId);
  const action = product?.actions.find(item => item.choice === $('choice').value);
  const required = decisionKind !== 'assessment' && Boolean(action?.destination);
  $('destination-field').hidden = !required;
  $('destination').disabled = !required;
  $('destination').required = required;
}

function renderDecisionChoices(product) {
  const previous = $('choice').value;
  const actions = (decisionKind === 'assessment' ? product?.assessmentActions : product?.actions) ?? [];
  $('choice').innerHTML = ("<option value=\"\">" + escapeHtml(t("Karar seçin")) + "</option>") + actions.map(action => (
    `<option value="${escapeHtml(action.choice)}">${escapeHtml(t(action.choice))}</option>`
  )).join('');
  if (actions.some(action => action.choice === previous)) $('choice').value = previous;
  updateDestination();
}

async function deleteProduct(product, button) {
  const label = `${product.name} · ${operations[product.type].title} · ${departmentLabel(product.department)} · Lot ${product.lot}`;
  if (button.disabled || !window.confirm(`${label}\n\n${t('Bu kayıt ve bağlı karar geçmişi kalıcı olarak silinecek. İşlem geri alınamaz. Silinsin mi?')}`)) return;
  const status = activeModule === decisionModule ? 'decision-file-status' : 'records-status';
  button.disabled = true;
  showStatus(status, 'Siliniyor…');
  try {
    await writeApi(`/api/products/${product.id}`, 'DELETE');
    showStatus(status, 'Kayıt ve bağlı karar geçmişi silindi.');
    await refresh();
  } catch (error) {
    showStatus(status, error.message, true);
  } finally {
    button.disabled = false;
  }
}

function openOperationRecord(product) {
  const day = recordedDay(product);
  if (calendarDay && calendarDay !== day) selectCalendarDay(day);
  $('search').value = '';
  selectModule(product.type);
  const row = $(`record-${product.id}`);
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row?.focus({ preventScroll: true });
}

function handleProductAction(event) {
  const button = event.target.closest('button[data-id]');
  if (!button) return;
  const product = products.find(item => item.id === button.dataset.id);
  if (!product) return;
  if (button.dataset.action === 'delete') return deleteProduct(product, button);
  if (button.dataset.action === 'trace') {
    selectModule(historyModule, product);
    $('module-title').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  if (button.dataset.action === 'open-operation') {
    openOperationRecord(product);
    return;
  }
  if (button.dataset.action === 'edit') {
    renderEntry(product);
    $('operation-fields').querySelector('input').focus();
    return;
  }
  if ($('decision-form').querySelector('button').disabled) return;
  currentId = product.id;
  const returned = button.dataset.action === 'recheck' ? product.recheck : undefined;
  decisionKind = button.dataset.action === 'assessment' || returned?.kind === 'assessment' ? 'assessment' : undefined;
  $('decision-title').textContent = decisionKind ? (panel.canApprove ? t("MuDecision kararı") : t("MuDecision önerisi")) : (panel.canApprove ? t("Operasyon kararı") : t("Operasyon talebi"));
  $('selected').textContent = `${product.name} · ${storeName(product.storeId)} · ${operations[product.type].title} · Barkod ${product.code} · Lot ${product.lot}`;
  $('proposal-field').hidden = !decisionKind || !panel.canApprove;
  $('submit-as-proposal').checked = Boolean(returned);
  $('choice').value = '';
  $('reason').value = '';
  $('destination').value = '';
  $('decision-evidence-category').value = '';
  $('decision-evidence-photo').value = '';
  renderDecisionChoices(product);
  if (returned && [...$('choice').options].some(option => option.value === returned.choice)) {
    $('choice').value = returned.choice;
    updateDestination();
  }
  if (button.dataset.action === 'release') {
    $('choice').value = product.actions.find(action => action.releaseTemporary).choice;
  }
  showStatus('decision-status', '');
  if (activeModule === decisionModule) showStatus('decision-file-status', '');
  $('decision').hidden = false;
  $('decision').scrollIntoView({ behavior: 'smooth' });
  $('staff').focus({ preventScroll: true });
}

$('records-table').addEventListener('click', handleProductAction);
$('decision-files').addEventListener('click', handleProductAction);
$('approval-list').addEventListener('click', handleProductAction);
$('pilot-history').addEventListener('click', handleProductAction);
$('pilot-risks').addEventListener('click', handleProductAction);
$('pilot-history-search').addEventListener('input', () => renderPilotHistory());
$('approval-new')?.addEventListener('click', () => {
  selectModule(decisionModule);
  $('decision-search').focus();
});

document.addEventListener('muterminal:scan-open', async event => {
  if (!products.some(item => item.id === event.detail)) await refresh();
  const product = products.find(item => item.id === event.detail);
  if (!product) return;
  if (!inDepartment(product)) selectDepartmentScope('');
  openOperationRecord(product);
});

document.addEventListener('muterminal:scan-entry', event => {
  const { operation, name, barcode, lot } = event.detail;
  if (!Object.hasOwn(operations, operation) || operations[operation].disabled) return;
  selectModule(operation);
  $('name').value = name;
  $('code').value = barcode;
  $('lot').value = lot;
  $(lot ? 'department' : 'lot').focus();
});

document.addEventListener('muterminal:scan-history', event => {
  selectModule(historyModule, event.detail);
  $('module-title').scrollIntoView({ behavior: 'smooth' });
});

$('approval-list').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const outcome = event.submitter?.value;
  if (!outcome) return;
  const buttons = [...form.querySelectorAll('button')];
  buttons.forEach(button => { button.disabled = true; });
  try {
    await writeApi(`/api/products/${form.dataset.review}/review`, 'POST', {
      outcome, proposalId: form.dataset.proposal, reason: new FormData(form).get('reason'),
    });
    showStatus('review-status', { approve: 'Talep onaylandı.', reject: 'Talep reddedildi.', recheck: 'Talep ek kontrole gönderildi.' }[outcome]);
    await refresh();
  } catch (error) {
    showStatus('review-status', error.message, true);
  } finally {
    buttons.forEach(button => { button.disabled = false; });
  }
});

$('records-table').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  if (button.disabled) return;
  const department = new FormData(form).get('department');
  button.disabled = true;
  showStatus('records-status', 'Reyon atanıyor…');
  try {
    await writeApi(`/api/products/${form.dataset.product}/department`, 'POST', { department });
    showStatus('records-status', `Reyon atandı · ${departmentLabel(department)}`);
    await refresh();
  } catch (error) {
    showStatus('records-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('decision-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const button = form.querySelector('button');
  if (!currentId || button.disabled) return;
  const id = currentId;
  button.disabled = true;
  showStatus('decision-status', 'Kaydediliyor…');
  try {
    const body = Object.fromEntries(new FormData(form));
    if (decisionKind) body.kind = decisionKind;
    if (decisionKind && $('submit-as-proposal').checked) body.submitAsProposal = true;
    body.evidence = await formEvidence('decision');
    await writeApi(`/api/products/${id}/decisions`, 'POST', body);
    if (currentId === id) {
      $('decision').hidden = true;
      currentId = null;
      const status = activeModule === decisionModule ? 'decision-file-status' : activeModule === approvalModule ? 'review-status' : 'records-status';
      showStatus(status, !panel.canApprove || body.submitAsProposal ? t("Talep onaya gönderildi.") : t("Karar kaydedildi."));
    }
    await refresh();
  } catch (error) {
    if (currentId === id) showStatus('decision-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});

$('search').addEventListener('input', renderRows);
$('decision-search').addEventListener('input', () => {
  if (lastState !== undefined) renderDecisionFiles();
});
$('choice').addEventListener('change', updateDestination);
$('cancel-edit').addEventListener('click', () => renderEntry());
$('clear-lot').addEventListener('click', () => selectModule(historyModule));
$('modules').addEventListener('click', event => {
  const button = event.target.closest('button[data-module]');
  if (button && (button.dataset.module !== activeModule || lotFilter || barcodeHistory)) selectModule(button.dataset.module);
});
function selectDepartmentScope(group, department = '') {
  if (activeDepartmentGroup === group && activeDepartment === department) return;
  const groupChanged = activeDepartmentGroup !== group;
  activeDepartmentGroup = group;
  activeDepartment = department;
  for (const button of $('departments').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.departmentGroup === group));
  }
  if (groupChanged) renderSubdepartments();
  else for (const button of $('subdepartments').querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(button.dataset.department === department));
  }
  renderDepartmentReportScope();
  if (!editingId) $('department').value = defaultDepartment();
  currentId = null;
  $('decision').hidden = true;
  showStatus('decision-file-status', '');
  showStatus('records-status', '');
  if (lastState !== undefined) render();
}
$('departments').addEventListener('click', event => {
  const button = event.target.closest('button[data-department-group]');
  if (button) selectDepartmentScope(button.dataset.departmentGroup);
});
$('subdepartments').addEventListener('click', event => {
  const button = event.target.closest('button[data-department]');
  if (button) selectDepartmentScope(activeDepartmentGroup, button.dataset.department);
});
$('calendar-previous').addEventListener('click', () => moveCalendarMonth(-1));
$('calendar-next').addEventListener('click', () => moveCalendarMonth(1));
$('calendar-today').addEventListener('click', () => selectCalendarDay(dayFormat.format(new Date())));
$('calendar-all').addEventListener('click', () => selectCalendarDay(''));
$('calendar-date').addEventListener('change', event => {
  if (event.target.validity.valid) selectCalendarDay(event.target.value);
});
$('records-date').addEventListener('change', event => {
  if (event.target.validity.valid) selectCalendarDay(event.target.value);
});
$('records-all-dates').addEventListener('click', () => selectCalendarDay(''));
$('calendar-days').addEventListener('click', event => {
  const button = event.target.closest('button[data-day]');
  if (button) selectCalendarDay(button.dataset.day);
});
$('store-filter').addEventListener('change', event => {
  activeStore = event.target.value;
  renderDepartmentReportScope();
  currentId = null;
  $('decision').hidden = true;
  if (editingId) renderEntry();
  else $('entry-store').value = activeStore || panel.storeId;
  if (lastState !== undefined) render();
});
$('user-role').addEventListener('change', updateUserRoleFields);

const managementForms = {
  'store-form': ['/api/admin/stores', 'Mağaza eklendi.'],
  'chain-form': ['/api/admin/chains', 'Market zinciri eklendi.'],
  'department-form': ['/api/admin/departments', 'Alt reyon eklendi.'],
  'user-form': ['/api/admin/users', 'Kullanıcı oluşturuldu.'],
  'settings-form': ['/api/admin/settings', 'Ayarlar kaydedildi.'],
};
for (const [id, [path, message]] of Object.entries(managementForms)) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    const values = Object.fromEntries(new FormData(form));
    if (id === 'settings-form') {
      values.expiryWarningDays = Number(values.expiryWarningDays);
      values.blockRksAcrossLots = Boolean(values.blockRksAcrossLots);
    }
    if (id === 'user-form') values.canApprove = Boolean(values.canApprove);
    const editingUser = id === 'user-form' && $('user-email').readOnly;
    button.disabled = true;
    try {
      await writeApi(editingUser ? '/api/admin/users/permissions' : path, 'POST', values);
      if (id === 'user-form') editManagedUser();
      if (id === 'store-form' || id === 'chain-form') form.reset();
      if (id === 'department-form') $('subdepartment-name').value = '';
      await loadManagement();
      showStatus('management-status', editingUser ? t("Hesap bilgileri güncellendi.") : message);
      await refresh();
    } catch (error) {
      showStatus('management-status', error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}

$('managed-users').addEventListener('click', async event => {
  const button = event.target.closest('button[data-user]');
  if (!button) return;
  if (button.hasAttribute('data-edit')) {
    editManagedUser(managedUsers.find(user => user.email === button.dataset.user));
    $('user-role').focus();
    return;
  }
  button.disabled = true;
  try {
    await writeApi('/api/admin/users/status', 'POST', { email: button.dataset.user, active: button.dataset.active === 'true' });
    await loadManagement();
    showStatus('management-status', 'Hesap durumu güncellendi.');
  } catch (error) {
    showStatus('management-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('cancel-user-edit').addEventListener('click', () => editManagedUser());

$('team-members').addEventListener('click', event => {
  const button = event.target.closest('button[data-member]');
  if (!button) return;
  $('team-password').reset();
  $('team-password-user').value = button.dataset.member;
  $('team-password-target').textContent = button.dataset.member;
  $('team-password').hidden = false;
  $('team-password-new').focus();
});
$('team-members').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.target;
  const button = form.querySelector('button');
  if (button.disabled) return;
  button.disabled = true;
  try {
    await writeApi('/api/manager/staff/department', 'POST', Object.fromEntries(new FormData(form)));
    await loadTeam();
    showStatus('team-status', 'Personel iş unvanı kaydedildi.');
  } catch (error) {
    showStatus('team-status', error.message, true);
  } finally {
    button.disabled = false;
  }
});
$('cancel-team-password').addEventListener('click', () => {
  $('team-password').reset();
  $('team-password').hidden = true;
});

const teamForms = {
  'team-create': ['/api/manager/staff', 'Personel hesabı oluşturuldu.'],
  'team-password': ['/api/manager/staff/password', 'Personel şifresi değiştirildi.'],
};
for (const [id, [path, message]] of Object.entries(teamForms)) {
  $(id).addEventListener('submit', async event => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await writeApi(path, 'POST', Object.fromEntries(new FormData(form)));
      form.reset();
      if (id === 'team-password') form.hidden = true;
      await loadTeam();
      showStatus('team-status', message);
    } catch (error) {
      showStatus('team-status', error.message, true);
    } finally {
      button.disabled = false;
    }
  });
}
for (const id of ['history-search', 'history-date', 'history-operation']) $(id).addEventListener('input', renderHistory);
$('operation-fields').addEventListener('input', () => {
  if (activeModule !== 'Depo Fark') return;
  const system = $('systemStock');
  const physical = $('physicalStock');
  const valid = system.value !== '' && physical.value !== '' && system.validity.valid && physical.validity.valid;
  $('stock-preview').hidden = !valid;
  if (valid) $('stock-preview').textContent = t('Sayım farkı {difference} adet', { difference: signed(physical.valueAsNumber - system.valueAsNumber) });
});
function downloadJson(data, name) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function canExportProduct(product) {
  return panel.role !== 'staff' || product.createdBy === panel.email;
}

function exportableProducts() {
  return products.filter(product => inDepartment(product) && canExportProduct(product));
}

$('export').addEventListener('click', () => {
  const visible = exportableProducts();
  const scope = activeDepartment || activeDepartmentGroup;
  downloadJson({ products: visible, logs: logs.filter(inDepartment) }, scope ? `muterminal-${scope}-kayitlar.json` : 'muterminal-kayitlar.json');
});

function reportRecord(record) {
  return {
    ...record, store: rawStoreName(record.storeId), department: departmentNames(record.department),
    operation: operations[record.type]?.title ?? record.type,
  };
}

function reportProduct(product) {
  const fields = product.details ? (operations[product.type]?.fields ?? []).map(field => ({
    label: field.label, type: field.type, value: product.details[field.name],
  })) : [];
  if (product.details?.destination) fields.push({ label: 'Varış noktası', type: 'text', value: product.details.destination });
  return { ...reportRecord(product), qty: operationQuantity(product), fields, pending: Boolean(product.proposal), missingDetails: !product.details };
}

$('core-panel').addEventListener('muterminal:report-data', event => {
  const { kind } = event.detail;
  if ($(`report-export-${kind}`)?.disabled || !lastState) return;
  if (kind === 'summary' && panel.role !== 'staff') {
    event.detail.data = { kind, byStore: panel.role === 'admin', rows: reportRows() };
  }
  if (kind === 'history') {
    event.detail.data = { kind, rows: historyRows().map(reportRecord) };
  }
  if (kind === 'operation' && Object.hasOwn(operations, activeModule)) {
    event.detail.data = {
      kind, scope: departmentReportScope(), operation: operations[activeModule].title,
      date: calendarDay || undefined, quantityLabel: operationQuantityLabel(activeModule),
      groups: operationRecordGroups(true).map(([day, items]) => ({ day, products: items.map(reportProduct) })),
    };
  }
  if (kind === 'department') {
    const daily = calendarDay ? calendarEntries.get(calendarDay) ?? [] : null;
    const recordsFor = key => daily.filter(item => item.kind === key).map(item => item.record);
    event.detail.data = {
      kind, scope: departmentReportScope(),
      ...(daily && { date: calendarDay, scheduled: daily.filter(item => item.kind === 'scheduled').map(({ record, label, value }) => ({
        ...reportRecord(record), label, value,
      })) }),
      products: (daily ? recordsFor('products').filter(canExportProduct) : exportableProducts()).map(reportProduct),
      history: (daily ? recordsFor('history') : logs.filter(inDepartment)).map(reportRecord),
    };
  }
});

async function poll() {
  await refresh();
  setTimeout(poll, 2000);
}

async function start() {
  try {
    const [operationResponse, departmentResponse, contextResponse] = await Promise.all([
      requestApi('/api/operations'), requestApi('/api/department-groups'), requestApi('/api/context'),
      english && !Object.keys(messages).length ? fetch('/ui-en.json').then(response => {
        if (!response.ok) throw new Error();
        return response.json();
      }).then(translations => { messages = translations; }) : Promise.resolve(),
    ]);
    if (!operationResponse.ok || !departmentResponse.ok || !contextResponse.ok) throw new Error();
    const [operationData, groups, context] = await Promise.all([operationResponse.json(), departmentResponse.json(), contextResponse.json()]);
    operations = operationData;
    panel = context;
    $('panel-role').textContent = t(panel.title);
    const identity = panel.displayName ? `${panel.displayName} (${panel.email})` : panel.email;
    $('panel-account').textContent = [identity, t(panel.jobTitle), panel.role === 'admin' ? t("Tüm mağazalar") : storeName(panel.storeId)].filter(Boolean).join(' · ');
    document.title = t(panel.title);
    $('staff').readOnly = panel.role === 'staff';
    if ($('staff').readOnly) $('staff').value = panel.displayName ?? panel.email;
    $('store-filter-field').hidden = panel.role !== 'admin';
    configureStores();
    const options = Object.entries(operations);
    if (panel.role !== 'staff') $('modules').insertAdjacentHTML('afterbegin', '<button type="button" data-module="dashboard">MuDashboard Lite</button>');
    $('modules').insertAdjacentHTML('beforeend', '<button type="button" data-module="scan-lite">MuScan Lite</button><button type="button" data-module="approval-lite">MuApproval Lite</button>');
    $('modules').insertAdjacentHTML('beforeend', options.filter(([, operation]) => !operation.disabled).map(([id, operation]) => (
      `<button type="button" data-module="${escapeHtml(id)}">${escapeHtml(t(operation.title))}</button>`
    )).join('') + `<button type="button" data-module="history">${panel.role === 'staff' ? t("Kendi İşlem Geçmişim") : t("Karar Geçmişi")}</button>`);
    if (panel.role === 'admin') {
      $('user-job-title').innerHTML = staffJobTitleOptions();
      updateUserRoleFields();
      $('modules').insertAdjacentHTML('beforeend', ("<button type=\"button\" data-module=\"management\">" + escapeHtml(t("Sistem Yönetimi")) + "</button>"));
    }
    if (panel.role === 'admin' || panel.role === 'manager') {
      $('member-department').innerHTML = staffJobTitleOptions();
      $('modules').insertAdjacentHTML('beforeend', ("<button type=\"button\" data-module=\"staff-management\">" + escapeHtml(t("Personel Yönetimi")) + "</button>"));
    }
    $('history-operation').innerHTML = ("<option value=\"\">" + escapeHtml(t("Tüm operasyonlar")) + "</option>") + options.map(([id, operation]) => (
      `<option value="${escapeHtml(id)}">${escapeHtml(t(operation.title))}</option>`
    )).join('');
    configureDepartments(groups);
    const initialModule = window.location.hash === '#muscan-lite' ? scanModule
      : window.location.hash === '#muapproval-lite' ? approvalModule : panel.role === 'staff' ? decisionModule : dashboardModule;
    selectModule(initialModule);
    poll();
  } catch {
    showStatus('sync-status', 'Operasyon modülleri yüklenemedi. MuTerminal sunucusunu kontrol edin.', true);
    setTimeout(start, 2000);
  }
}

window.addEventListener('pageshow', event => {
  if (event.persisted) window.location.reload();
});
start();
