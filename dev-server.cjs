const { readFile } = require('node:fs/promises');
const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { MongoClient, ObjectId } = require('mongodb');
const { operations, saleApproval, assessments } = require('./operations.cjs');
const { createChallenge, challengeImage, verifyChallenge } = require('./login-challenge.cjs');

const host = '127.0.0.1';
const port = Number(process.env.PORT ?? 4173);
const client = new MongoClient(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017', {
  serverSelectionTimeoutMS: 3000,
});
const db = client.db(process.env.MONGODB_DATABASE ?? 'muterminal');
const records = db.collection('products');
const users = db.collection('users');
const passwordOverrides = db.collection('passwordOverrides');
const stores = db.collection('stores');
const settingsCollection = db.collection('settings');
const pilotStore = { id: 'pilot', name: 'Pilot Mağaza' };
const panels = { admin: 'MuTerminal Admin', manager: 'MuTerminal Manager', staff: 'MuTerminal Staff' };
const loginTitles = { admin: 'Admin girişi', manager: 'Yönetici girişi', staff: 'Personel girişi' };
const defaultPilotPassword = '1234567890';
const defaultSettings = { expiryWarningDays: 7, blockRksAcrossLots: false, productSource: 'Manuel ürün girişi', erpEndpoint: '', wmsEndpoint: '' };
const derivePassword = promisify(scrypt);
const departments = {
  'unlu-mamuller': 'Unlu Mamuller',
  un: 'Un',
  seker: 'Şeker',
  sut: 'Süt',
  tahil: 'Tahıl',
  zeytin: 'Zeytin',
  baklagiller: 'Baklagiller',
  konserveler: 'Konserveler',
  tursu: 'Turşu',
  ezme: 'Ezme',
  receller: 'Reçeller',
};
const legacyChoices = new Set([saleApproval, 'Blokaj devam', 'Depoya iade', 'İncelemeye sevk']);
const localTime = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short',
});
const assets = new Map([
  ['/public.css', ['public.css', 'text/css']],
  ['/muterminal-logo.png', ['muterminal-logo.png', 'image/png']],
  ['/muterminal-core-logo.png', ['muterminal-core-logo.png', 'image/png']],
  ['/mudecision-logo.png', ['mudecision-logo.png', 'image/png']],
  ['/admin', ['index.html', 'text/html', true]],
  ['/manager', ['index.html', 'text/html', true]],
  ['/staff', ['index.html', 'text/html', true]],
  ['/app.js', ['app.js', 'text/javascript', true]],
]);
const hashText = value => createHash('sha256').update(value).digest();
const accounts = new Map([
  ['tester@muterminal.com', process.env.MUTERMINAL_TESTER_PASSWORD ?? 'tester123!', Object.keys(panels), true],
  [process.env.MUTERMINAL_ADMIN_EMAIL ?? 'admin@muterminal.com', process.env.MUTERMINAL_ADMIN_PASSWORD ?? defaultPilotPassword, ['admin'], process.env.MUTERMINAL_ADMIN_CAN_APPROVE !== 'false'],
  ['yonetici@muterminal.com', defaultPilotPassword, ['manager'], false, true],
].map(([email, password, roles, canApprove, changeable = false]) => [email.toLowerCase(), {
  email: email.toLowerCase(), passwordHash: hashText(password), roles, canApprove, changeable, storeId: pilotStore.id,
}]));
const sessionCookie = 'muterminal_session';
const sessionSeconds = 8 * 60 * 60;
const sessions = new Map();
const accountVersions = new Map();
const landingLogin = '/#admin-giris';
const loginErrors = new Map([
  ['dogrulama', 'Doğrulama kodu hatalı veya süresi dolmuş. Yeni görseldeki harfleri girin.'],
  ['bilgi', 'Kullanıcı adı veya şifre hatalı.'],
  ['yetki', 'Bu hesap seçilen panele erişemiyor.'],
]);

class RequestError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(response, status, data) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }).end(JSON.stringify(data));
}

async function readBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > 16_384) {
      request.resume();
      throw new RequestError(413, 'Gönderilen veri çok büyük.');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readJson(request) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new RequestError(415, 'Kayıt verisi JSON biçiminde olmalıdır.');
  }
  const text = await readBody(request);
  try {
    const body = JSON.parse(text);
    if (body && typeof body === 'object' && !Array.isArray(body)) return body;
  } catch {
    // Invalid JSON and non-object payloads use the same response.
  }
  throw new RequestError(400, 'Geçersiz kayıt verisi.');
}

function sessionToken(request) {
  return request.headers.cookie?.split(';').map(cookie => cookie.trim())
    .find(cookie => cookie.startsWith(`${sessionCookie}=`))?.slice(sessionCookie.length + 1);
}

function signedInAccount(request) {
  const session = sessions.get(sessionToken(request));
  return session?.expires > Date.now() ? session : undefined;
}

function redirect(response, path, cookie) {
  const headers = { Location: path, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  response.writeHead(303, headers).end();
}

function sessionHeader(request, token, maxAge) {
  const secure = request.socket.encrypted ? '; Secure' : '';
  return `${sessionCookie}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
}

function requireSameOrigin(request) {
  const scheme = request.socket.encrypted ? 'https' : 'http';
  const origin = request.headers.origin;
  if (origin && origin !== `${scheme}://${request.headers.host}`) {
    throw new RequestError(403, 'Geçersiz istek kaynağı.');
  }
}

function sendContent(response, type, content) {
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
  }).end(content);
}

async function sendLanding(response, query) {
  const html = await readFile(join(__dirname, 'muterminal', 'landing.html'), 'utf8');
  const parameters = new URLSearchParams(query);
  const error = loginErrors.get(parameters.get('giris'));
  const requestedPanel = parameters.get('panel');
  const role = Object.hasOwn(panels, requestedPanel) ? requestedPanel : 'admin';
  sendContent(response, 'text/html; charset=utf-8', html
    .replaceAll('{{challengeId}}', createChallenge())
    .replaceAll('{{loginRole}}', role)
    .replace('{{loginTitle}}', loginTitles[role])
    .replace(`data-login-role="${role}"`, `data-login-role="${role}" aria-current="true"`)
    .replace('<!-- login-status -->', parameters.get('password') === 'changed' ? '<p role="status">Şifreniz değiştirildi. Yeni şifrenizle giriş yapın.</p>' : '')
    .replace('<!-- login-error -->', error ? `<p class="login-error" role="alert">${error}</p>` : ''));
}

async function activeAccount(username) {
  const builtIn = accounts.get(username);
  if (builtIn) {
    return builtIn.changeable ? { ...builtIn, ...await passwordOverrides.findOne({ _id: username }) } : builtIn;
  }
  return username ? users.findOne({ _id: username, active: true }) : null;
}

async function matchesPassword(account, password) {
  if (!account || typeof password !== 'string' || password.length > 128) return false;
  const expected = Buffer.from(account.passwordHash, account.salt ? 'hex' : undefined);
  const actual = account.salt ? await derivePassword(password, account.salt, 32) : hashText(password);
  return timingSafeEqual(actual, expected);
}

async function passwordCredentials(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128 || !password.trim()) {
    throw new RequestError(400, 'Şifre 8–128 karakter olmalıdır.');
  }
  const salt = randomBytes(16).toString('hex');
  const passwordHash = (await derivePassword(password, salt, 32)).toString('hex');
  return { salt, passwordHash };
}

function requiredUsername(body) {
  const username = requiredText(body, 'email', 'Kullanıcı adı', 100).toLowerCase();
  if (!/^[\p{L}\p{N}][\p{L}\p{N}._-]{2,63}$/u.test(username) && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(username)) {
    throw new RequestError(400, 'En az üç karakterli kullanıcı adı veya geçerli bir e-posta adresi girin.');
  }
  return username;
}

async function adminLogin(request, response) {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
    throw new RequestError(415, 'Giriş formunu kullanın.');
  }
  const fields = new URLSearchParams(await readBody(request));
  const role = fields.get('role') || 'admin';
  const chosenPanel = Object.hasOwn(panels, role) ? role : 'admin';
  if (!verifyChallenge(fields.get('challengeId'), fields.get('challengeAnswer'))) {
    redirect(response, `/?giris=dogrulama&panel=${chosenPanel}#admin-giris`);
    return;
  }
  const email = fields.get('email')?.trim().toLowerCase();
  const version = accountVersions.get(email);
  const password = fields.get('password') ?? '';
  const account = await activeAccount(email);
  const validPassword = await matchesPassword(account, password);
  if (!validPassword || accountVersions.get(email) !== version) {
    redirect(response, `/?giris=bilgi&panel=${chosenPanel}#admin-giris`);
    return;
  }
  if (!Object.hasOwn(panels, role) || !account.roles.includes(role)) {
    redirect(response, `/?giris=yetki&panel=${chosenPanel}#admin-giris`);
    return;
  }
  const now = Date.now();
  for (const [token, session] of sessions) {
    if (session.expires <= now) sessions.delete(token);
  }
  sessions.delete(sessionToken(request));
  const token = randomBytes(32).toString('base64url');
  sessions.set(token, {
    email: account.email, displayName: account.displayName, role, storeId: account.storeId,
    canApprove: role === 'manager' || (role === 'admin' && account.canApprove),
    canChangePassword: role === 'manager' && (!accounts.has(email) || account.changeable === true),
    expires: now + sessionSeconds * 1000,
  });
  redirect(response, `/${role}`, sessionHeader(request, token, sessionSeconds));
}

function requiredText(body, field, label, maxLength) {
  const value = typeof body[field] === 'string' ? body[field].trim() : '';
  if (!value || value.length > maxLength) {
    throw new RequestError(400, `${label} 1–${maxLength} karakter olmalıdır.`);
  }
  return value;
}

function storeScope(storeId) {
  return storeId === pilotStore.id ? { storeId: { $in: [null, pilotStore.id] } } : { storeId };
}

function accessScope(session) {
  return session.role === 'admin' ? {} : storeScope(session.storeId);
}

function productStore(product) {
  return product.storeId ?? pilotStore.id;
}

async function storeList() {
  const list = await stores.find().sort({ name: 1 }).toArray();
  return [pilotStore, ...list.map(({ _id, name }) => ({ id: _id, name }))];
}

async function requiredStore(storeId) {
  if (storeId === pilotStore.id || (typeof storeId === 'string' && await stores.findOne({ _id: storeId }))) return storeId;
  throw new RequestError(400, 'Geçerli bir mağaza seçin.');
}

async function getSettings() {
  const saved = await settingsCollection.findOne({ _id: 'system' }, { projection: { _id: 0 } });
  return { ...defaultSettings, ...saved };
}

function integrationAddress(body, field) {
  if (body[field] === '') return '';
  const address = requiredText(body, field, 'Entegrasyon adresi', 500);
  const url = URL.canParse(address) ? new URL(address) : null;
  if (!url || !['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new RequestError(400, 'Geçerli bir HTTP veya HTTPS adresi girin.');
  }
  return address;
}

function requireAdmin(session) {
  if (session.role !== 'admin') throw new RequestError(403, 'Bu işlem için admin yetkisi gerekir.');
}

async function accountPermissions(body) {
  const { role } = body;
  if (typeof role !== 'string' || !Object.hasOwn(panels, role)) throw new RequestError(400, 'Geçerli bir rol seçin.');
  return { roles: [role], storeId: await requiredStore(body.storeId), canApprove: role === 'admin' && body.canApprove === true };
}

function revokeAccountSessions(email) {
  accountVersions.set(email, (accountVersions.get(email) ?? 0) + 1);
  for (const [token, account] of sessions) if (account.email === email) sessions.delete(token);
}

async function insertManagedAccount(body, permissions, password = body.password) {
  const email = requiredUsername(body);
  if (accounts.has(email)) throw new RequestError(409, 'Bu kullanıcı adı zaten kayıtlı.');
  const displayName = permissions.roles.includes('staff') || body.displayName
    ? requiredText(body, 'displayName', 'Ad soyad', 100) : undefined;
  const credentials = await passwordCredentials(password);
  await users.insertOne({ _id: email, email, ...credentials, ...permissions, ...(displayName && { displayName }), active: true });
}

async function handleManagerAccounts(request, response, path, session) {
  if (session.role !== 'manager') throw new RequestError(403, 'Bu işlem için yönetici paneline giriş yapın.');
  const staffScope = { storeId: session.storeId, roles: ['staff'] };
  if (request.method === 'GET' && path === '/api/manager/staff') {
    const list = await users.find(staffScope, { projection: { _id: 0, email: 1, displayName: 1, active: 1 } }).sort({ displayName: 1, email: 1 }).toArray();
    json(response, 200, list);
    return;
  }
  if (request.method !== 'POST') throw new RequestError(404, 'Personel işlemi bulunamadı.');
  const body = await readJson(request);
  if (path === '/api/manager/staff') {
    const password = body.password === '' || body.password === undefined ? defaultPilotPassword : body.password;
    await insertManagedAccount(body, { roles: ['staff'], storeId: session.storeId, canApprove: false }, password);
  } else if (path === '/api/manager/staff/password') {
    const email = requiredUsername(body);
    const credentials = await passwordCredentials(body.password);
    const result = await users.updateOne({ _id: email, ...staffScope }, { $set: credentials });
    if (!result.matchedCount) throw new RequestError(404, 'Bu mağazada personel hesabı bulunamadı.');
    revokeAccountSessions(email);
  } else if (path === '/api/manager/password') {
    if (!session.canChangePassword) throw new RequestError(403, 'Bu hesabın şifresi panelden değiştirilemez.');
    const account = await activeAccount(session.email);
    if (!await matchesPassword(account, body.currentPassword)) throw new RequestError(400, 'Mevcut şifre hatalı.');
    const credentials = await passwordCredentials(body.password);
    if (account.changeable && !account.salt) {
      await passwordOverrides.insertOne({ _id: session.email, ...credentials });
    } else {
      const collection = account.changeable ? passwordOverrides : users;
      const filter = { _id: session.email, passwordHash: account.passwordHash };
      if (!account.changeable) Object.assign(filter, { active: true, roles: ['manager'], storeId: session.storeId });
      const result = await collection.updateOne(filter, { $set: credentials });
      if (!result.matchedCount) throw new RequestError(409, 'Hesap bilgisi değişti, yeniden giriş yapın.');
    }
    revokeAccountSessions(session.email);
    response.writeHead(204, { 'Set-Cookie': sessionHeader(request, '', 0) }).end();
    return;
  } else throw new RequestError(404, 'Personel işlemi bulunamadı.');
  response.writeHead(204).end();
}

async function handleManagement(request, response, path, session) {
  requireAdmin(session);
  if (request.method === 'GET' && path === '/api/admin/management') {
    const savedUsers = await users.find({}, { projection: { passwordHash: 0, salt: 0, _id: 0 } }).sort({ email: 1 }).toArray();
    const builtIns = [...accounts.values()].map(({ email, roles, canApprove, storeId }) => ({ email, roles, canApprove, storeId, active: true, builtIn: true }));
    json(response, 200, { users: [...builtIns, ...savedUsers], stores: await storeList(), settings: await getSettings() });
    return;
  }
  if (request.method !== 'POST') throw new RequestError(404, 'Yönetim işlemi bulunamadı.');
  const body = await readJson(request);
  if (path === '/api/admin/stores') {
    const name = requiredText(body, 'name', 'Mağaza adı', 100);
    const id = requiredText(body, 'id', 'Mağaza kodu', 50).toLowerCase();
    if (!/^[a-z0-9-]+$/.test(id) || id === pilotStore.id) throw new RequestError(400, 'Benzersiz bir mağaza kodu girin.');
    await stores.insertOne({ _id: id, name });
  } else if (path === '/api/admin/users') {
    await insertManagedAccount(body, await accountPermissions(body));
  } else if (path === '/api/admin/users/permissions') {
    const email = requiredText(body, 'email', 'E-posta', 100).toLowerCase();
    if (email === session.email) throw new RequestError(400, 'Kendi hesabınızın yetkilerini düzenleyemezsiniz.');
    const result = await users.updateOne({ _id: email }, { $set: await accountPermissions(body) });
    if (!result.matchedCount) throw new RequestError(404, 'Yönetilebilir bir hesap bulunamadı.');
    revokeAccountSessions(email);
  } else if (path === '/api/admin/users/status') {
    const email = requiredText(body, 'email', 'E-posta', 100).toLowerCase();
    if (email === session.email || typeof body.active !== 'boolean') throw new RequestError(400, 'Geçersiz hesap durumu.');
    const result = await users.updateOne({ _id: email }, { $set: { active: body.active } });
    if (!result.matchedCount) throw new RequestError(404, 'Yönetilebilir bir hesap bulunamadı.');
    if (!body.active) revokeAccountSessions(email);
  } else if (path === '/api/admin/settings') {
    const { expiryWarningDays, blockRksAcrossLots } = body;
    if (!Number.isInteger(expiryWarningDays) || expiryWarningDays < 0 || expiryWarningDays > 90 || typeof blockRksAcrossLots !== 'boolean') {
      throw new RequestError(400, 'SKT uyarı süresi 0–90 gün olmalıdır.');
    }
    const productSource = requiredText(body, 'productSource', 'Ürün veri kaynağı', 300);
    await settingsCollection.updateOne({ _id: 'system' }, { $set: {
      expiryWarningDays, blockRksAcrossLots, productSource,
      erpEndpoint: integrationAddress(body, 'erpEndpoint'), wmsEndpoint: integrationAddress(body, 'wmsEndpoint'),
    } }, { upsert: true });
  } else throw new RequestError(404, 'Yönetim işlemi bulunamadı.');
  response.writeHead(204).end();
}

function dateField(value, field) {
  const withTime = field.type === 'datetime-local';
  const pattern = withTime ? /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  if (typeof value === 'string' && pattern.test(value) && !value.startsWith('0000')) {
    const date = new Date(withTime ? `${value}Z` : value);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, value.length) === value) return value;
  }
  throw new RequestError(400, `${field.label} için geçerli bir değer girin.`);
}

function currentMinute() {
  return localTime.format(new Date()).replace(' ', 'T');
}

function temporaryBlockEnded(product, now) {
  return Boolean(product.details?.blockEndsAt && product.details.blockEndsAt <= now);
}

function operationDetails(operation, values) {
  const details = {};
  for (const field of operation.fields) {
    const value = values[field.name];
    if (field.type === 'text') {
      details[field.name] = requiredText(values, field.name, field.label, field.max);
    } else if (field.type === 'number') {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new RequestError(400, `${field.label} sıfır veya pozitif bir tam sayı olmalıdır.`);
      }
      details[field.name] = value;
    } else {
      details[field.name] = dateField(value, field);
    }
  }
  return details;
}

function requiredDepartment(department) {
  if (typeof department !== 'string' || !Object.hasOwn(departments, department)) {
    throw new RequestError(400, 'Geçerli bir reyon seçin.');
  }
  return department;
}

function newProduct(body) {
  const name = requiredText(body, 'name', 'Ürün adı', 150);
  const code = requiredText(body, 'code', 'Barkod', 80);
  const lot = requiredText(body, 'lot', 'Lot', 80);
  const { type, expired } = body;
  if (!Object.hasOwn(operations, type)) throw new RequestError(400, 'Geçerli bir operasyon seçin.');
  const department = requiredDepartment(body.department);
  const operation = operations[type];
  const details = operationDetails(operation, body.details ?? {});
  const difference = type === 'Depo Fark' ? details.physicalStock - details.systemStock : null;
  const qty = difference === null ? body.qty : Math.abs(difference);
  if (difference === null && (!Number.isSafeInteger(qty) || qty < 1)) {
    throw new RequestError(400, 'Adet pozitif bir tam sayı olmalıdır.');
  }
  if (typeof expired !== 'boolean') throw new RequestError(400, 'SKT durumu geçersiz.');
  return {
    name, code, lot, department, type, qty, expired, details,
    locked: Boolean(operation.blockLabel),
    status: difference === 0 ? 'Fark yok' : operation.initial,
    createdAt: new Date(),
    decisions: [],
  };
}

function productRisk(product, now, settings = defaultSettings) {
  const today = now.slice(0, 10);
  const expiry = product.details?.expiryDate;
  if (product.expired || (expiry && expiry < today)) return { label: 'SKT geçmiş', level: 'danger', blocks: true };
  if (product.locked || product.type === 'RKS Blokaj') {
    const label = temporaryBlockEnded(product, now)
      ? 'Süre doldu · kaldırma bekliyor'
      : operations[product.type].blockLabel ?? 'Blokajlı';
    return { label, level: 'warn', blocks: true };
  }
  if (product.type === 'SKT') {
    if (!expiry) return { label: 'SKT bilgisi eksik', level: 'warn', blocks: true };
    const days = (Date.parse(expiry) - Date.parse(today)) / 86_400_000;
    if (days <= settings.expiryWarningDays) return { label: days ? `SKT’ye ${days} gün` : 'SKT bugün', level: 'warn' };
  }
  if (product.type === 'Depo Fark') {
    if (!product.details) return { label: 'Sayım bilgisi eksik', level: 'warn' };
    const difference = product.details.physicalStock - product.details.systemStock;
    if (difference) return { label: `Sayım farkı ${difference > 0 ? '+' : ''}${difference}`, level: 'warn', blocks: true };
  }
  return null;
}

function availableActions(product, risk, now) {
  if (!product.details) return [];
  return operations[product.type].actions.filter(action => (
    action.choice !== saleApproval &&
    (!action.from || action.from.includes(product.status)) &&
    (!action.guarded || !risk?.blocks) &&
    (!action.releaseTemporary || (product.locked && temporaryBlockEnded(product, now)))
  ));
}

function matchesAssessment(product, action) {
  return !action.operation || (product.type === action.operation && product.details && action.from.includes(product.status));
}

async function state(session) {
  const products = [];
  const logs = [];
  const now = currentMinute();
  const [entries, settings] = await Promise.all([records.find(accessScope(session)).sort({ _id: -1 }).toArray(), getSettings()]);
  const lotRisks = new Map();
  const blockedRks = new Set();
  const risks = entries.map(record => {
    const risk = productRisk(record, now, settings);
    const key = JSON.stringify([productStore(record), record.code, record.lot]);
    if (risk?.blocks && (risk.level === 'danger' || !lotRisks.has(key))) lotRisks.set(key, risk);
    if (settings.blockRksAcrossLots && record.type === 'RKS Blokaj') blockedRks.add(JSON.stringify([productStore(record), record.code]));
    return risk;
  });
  for (const [index, record] of entries.entries()) {
    const { _id, decisions, proposal, createdBy, ...product } = record;
    const id = _id.toHexString();
    const storeId = productStore(product);
    const ownRisk = risks[index];
    const lotRisk = lotRisks.get(JSON.stringify([storeId, product.code, product.lot]));
    const relatedRks = blockedRks.has(JSON.stringify([storeId, product.code]));
    const risk = chooseRisk(ownRisk, lotRisk);
    const effectiveRisk = relatedRks && !risk?.blocks ? { label: 'Mağazada açık RKS blokajı', level: 'warn', blocks: true } : risk;
    const actions = availableActions(product, effectiveRisk, now).filter(action => session.canApprove || action.requestable);
    const assessmentActions = assessments.filter(action => matchesAssessment(product, action) && (!action.guarded || !effectiveRisk?.blocks));
    const visibleProposal = session.role !== 'staff' || proposal?.actor === session.email ? proposal : undefined;
    const owner = session.role !== 'staff' || createdBy === session.email ? createdBy : undefined;
    products.push({ id, ...product, storeId, createdBy: owner, proposal: visibleProposal, risk: effectiveRisk, actions, assessmentActions });
    const { name, code, lot, department, type } = product;
    const baseLog = { id, name, code, lot, department, type, storeId };
    if (owner && product.createdAt) logs.push({ ...baseLog, actor: owner, staff: owner, time: product.createdAt, choice: 'Kontrol kaydı oluşturuldu', reason: '', result: 'Kaydedildi' });
    for (const decision of decisions) {
      if (session.role !== 'staff' || decision.actor === session.email || decision.requestedBy === session.email) {
        logs.push({ ...baseLog, result: decision.choice, ...decision });
      }
    }
  }
  logs.sort((first, second) => second.time - first.time);
  return { products, logs };
}

function chooseRisk(ownRisk, lotRisk) {
  return ((lotRisk?.level === 'danger' && ownRisk?.level !== 'danger') || (!ownRisk?.blocks && lotRisk))
    ? { ...lotRisk, label: `Aynı lot · ${lotRisk.label}` }
    : ownRisk;
}

async function saveDecision(id, body, session, proposalId) {
  const staff = session.role === 'staff' ? (session.displayName ?? session.email) : requiredText(body, 'staff', 'Personel', 100);
  const reason = requiredText(body, 'reason', 'Gerekçe', 1000);
  const { choice, kind } = body;
  if (kind !== undefined && kind !== 'assessment') throw new RequestError(400, 'Geçersiz karar türü.');
  const isAssessment = kind === 'assessment';
  const filter = { _id: new ObjectId(id), ...accessScope(session) };
  const product = await records.findOne(filter);
  if (!product) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
  const action = isAssessment
    ? assessments.find(option => option.choice === choice)
    : operationAction(product, choice);
  if (!action) throw new RequestError(400, 'Bu operasyon için geçerli bir karar seçin.');
  const proposing = !session.canApprove || body.submitAsProposal === true;
  if (proposing && !isAssessment && !action.requestable) {
    throw new RequestError(403, 'Bu operasyonu yalnızca onay yetkisi olan hesaplar yürütebilir.');
  }
  if (isAssessment && !matchesAssessment(product, action)) {
    throw new RequestError(409, 'Cross-Dock uygunluk kararını önce ilgili operasyon kaydında onaylayın.');
  }
  const now = currentMinute();
  if (action.guarded) {
    const settings = await getSettings();
    const scope = { ...storeScope(productStore(product)), code: product.code };
    const lotOrRks = settings.blockRksAcrossLots ? { $or: [{ lot: product.lot }, { type: 'RKS Blokaj' }] } : { lot: product.lot };
    const related = records.find({ ...scope, ...lotOrRks });
    for await (const entry of related) {
      if (productRisk(entry, now)?.blocks) {
        throw new RequestError(409, 'Bu ürün ve lot için açık risk veya eksik kontrol bilgisi var.');
      }
    }
  }
  if (action.from) {
    if (!action.from.includes(product.status)) {
      throw new RequestError(409, 'Kayıt bu işlem için gereken durumda değil.');
    }
    filter.status = product.status;
  }
  const status = action.result ?? choice;
  filter.details = product.details ? { $exists: true } : { $exists: false };
  const update = isAssessment ? { assessment: status } : { status };
  const decision = { time: new Date(), choice, result: status, staff, actor: session.email, reason };
  if (isAssessment) decision.kind = kind;
  if (action.releaseTemporary) {
    if (!product.locked || !temporaryBlockEnded(product, now)) {
      throw new RequestError(409, 'Geçici blokaj ancak bitiş zamanı dolduğunda kaldırılabilir.');
    }
    filter.locked = true;
    update.locked = false;
  }
  if (action.destination) {
    decision.destination = requiredText(body, 'destination', 'Varış noktası', 150);
    update['details.destination'] = decision.destination;
  }
  if (proposing) {
    const proposal = { ...decision, id: new ObjectId().toHexString(), result: 'Onay bekliyor' };
    const saved = await records.updateOne({ ...filter, proposal: null }, {
      $set: { proposal }, $push: { decisions: { ...decision, kind: 'proposal', result: 'Onay bekliyor' } },
    });
    if (!saved.matchedCount) throw new RequestError(409, 'Kayıt değişti veya bu kayıt için zaten bekleyen bir talep var.');
    return;
  }
  if (proposalId) {
    filter['proposal.id'] = proposalId;
    decision.requestedBy = product.proposal?.actor;
    decision.result = `Onaylandı · ${status}`;
  } else {
    filter.proposal = null;
  }
  const change = {
    $set: update,
    $push: { decisions: decision },
  };
  if (proposalId) change.$unset = { proposal: '' };
  const result = await records.updateOne(filter, change);
  if (!result.matchedCount) {
    throw new RequestError(409, 'Kayıt durumu değişti. Güncel kaydı kontrol edin.');
  }
}

async function reviewProposal(id, body, session) {
  if (!session.canApprove) throw new RequestError(403, 'Talep değerlendirmek için onay yetkisi gerekir.');
  const reason = requiredText(body, 'reason', 'İnceleme gerekçesi', 1000);
  if (!['approve', 'reject'].includes(body.outcome) || !/^[a-f0-9]{24}$/.test(body.proposalId ?? '')) {
    throw new RequestError(400, 'Geçerli bir talep ve karar seçin.');
  }
  const filter = { _id: new ObjectId(id), ...accessScope(session), 'proposal.id': body.proposalId };
  const product = await records.findOne(filter);
  if (!product) throw new RequestError(404, 'Bekleyen talep bulunamadı.');
  const { choice, kind, destination, actor } = product.proposal;
  if (body.outcome === 'approve') {
    await saveDecision(id, { choice, kind, destination, staff: session.email, reason }, session, body.proposalId);
    return;
  }
  const result = await records.updateOne(filter, {
    $unset: { proposal: '' },
    $push: { decisions: { choice, reason, kind: 'review', result: 'Reddedildi', actor: session.email, staff: session.email, requestedBy: actor, time: new Date() } },
  });
  if (!result.matchedCount) throw new RequestError(409, 'Talep başka bir oturumda değerlendirildi.');
}

function operationAction(product, choice) {
  if (product.details) return operations[product.type].actions.find(action => action.choice === choice);
  if (legacyChoices.has(choice)) return { choice, guarded: choice === saleApproval };
}

async function completeDetails(id, body, session) {
  const filter = { _id: new ObjectId(id), details: { $exists: false }, ...accessScope(session) };
  if (session.role === 'staff') filter.createdBy = session.email;
  const product = await records.findOne(filter);
  if (!product) throw new RequestError(409, 'Kayıt bulunamadı veya operasyon bilgileri tamamlanmış.');
  const operation = operations[product.type];
  const details = operationDetails(operation, body.details ?? {});
  const update = { details, status: operation.initial };
  if (product.type === 'Depo Fark') {
    update.qty = Math.abs(details.physicalStock - details.systemStock);
    if (update.qty === 0) update.status = 'Fark yok';
  }
  const result = await records.updateOne({ ...filter, status: product.status }, { $set: update });
  if (!result.matchedCount) throw new RequestError(409, 'Kayıt durumu değişti. Güncel kaydı kontrol edin.');
}

async function handleApi(request, response, path, session) {
  if (request.method === 'GET' && path === '/api/context') {
    const { email, displayName, role, canApprove, canChangePassword, storeId } = session;
    const locations = role === 'admin' ? await storeList() : [
      storeId === pilotStore.id ? pilotStore : { id: storeId, name: (await stores.findOne({ _id: storeId }))?.name ?? storeId },
    ];
    json(response, 200, { email, displayName, role, title: panels[role], canApprove, canChangePassword, storeId, stores: locations });
    return;
  }
  if (path.startsWith('/api/admin/')) return handleManagement(request, response, path, session);
  if (path.startsWith('/api/manager/')) return handleManagerAccounts(request, response, path, session);
  if (request.method === 'GET' && path === '/api/operations') {
    json(response, 200, operations);
    return;
  }
  if (request.method === 'GET' && path === '/api/state') {
    json(response, 200, await state(session));
    return;
  }
  if (request.method === 'GET' && path === '/api/departments') {
    json(response, 200, departments);
    return;
  }
  if (request.method === 'POST' && path === '/api/products') {
    const body = await readJson(request);
    const product = newProduct(body);
    product.storeId = session.role === 'admin' ? await requiredStore(body.storeId ?? session.storeId) : session.storeId;
    product.createdBy = session.email;
    const result = await records.insertOne(product);
    json(response, 201, { id: result.insertedId.toHexString() });
    return;
  }
  const product = path.match(/^\/api\/products\/([0-9a-f]{24})$/);
  if (request.method === 'DELETE' && product) {
    requireAdmin(session);
    const result = await records.deleteOne({ _id: new ObjectId(product[1]) });
    if (!result.deletedCount) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
    response.writeHead(204).end();
    return;
  }
  const decision = path.match(/^\/api\/products\/([0-9a-f]{24})\/decisions$/);
  if (request.method === 'POST' && decision) {
    await saveDecision(decision[1], await readJson(request), session);
    response.writeHead(204).end();
    return;
  }
  const review = path.match(/^\/api\/products\/([0-9a-f]{24})\/review$/);
  if (request.method === 'POST' && review) {
    await reviewProposal(review[1], await readJson(request), session);
    response.writeHead(204).end();
    return;
  }
  const details = path.match(/^\/api\/products\/([0-9a-f]{24})\/details$/);
  if (request.method === 'POST' && details) {
    await completeDetails(details[1], await readJson(request), session);
    response.writeHead(204).end();
    return;
  }
  const reclassify = path.match(/^\/api\/products\/([0-9a-f]{24})\/department$/);
  if (request.method === 'POST' && reclassify) {
    if (session.role === 'staff') throw new RequestError(403, 'Reyon atamak için yönetici yetkisi gerekir.');
    const { department } = await readJson(request);
    const result = await records.updateOne(
      { _id: new ObjectId(reclassify[1]), department: null, ...accessScope(session) },
      { $set: { department: requiredDepartment(department) } },
    );
    if (!result.matchedCount) throw new RequestError(409, 'Kayıt bulunamadı veya reyonu zaten atanmış.');
    response.writeHead(204).end();
    return;
  }
  throw new RequestError(404, 'İstek adresi bulunamadı.');
}

const server = createServer(async (request, response) => {
  const [path, query] = request.url.split('?', 2);
  try {
    const session = signedInAccount(request);
    if (path.startsWith('/api/')) {
      if (!session) throw new RequestError(401, 'MuTerminal paneline giriş yapın.');
      if (request.method === 'POST' || request.method === 'DELETE') requireSameOrigin(request);
      await handleApi(request, response, path, session);
      return;
    }
    const { method } = request;
    if ((path === '/admin/login' || path === '/admin/logout') && method === 'POST') {
      requireSameOrigin(request);
      if (path === '/admin/login') await adminLogin(request, response);
      else {
        sessions.delete(sessionToken(request));
        redirect(response, '/', sessionHeader(request, '', 0));
      }
      return;
    }
    if (path === '/admin/login' && (method === 'GET' || method === 'HEAD')) {
      const role = new URLSearchParams(query).get('panel');
      redirect(response, Object.hasOwn(panels, role) ? `/?panel=${role}#admin-giris` : landingLogin);
      return;
    }
    if ((path === '/' || path === '/index.html') && (method === 'GET' || method === 'HEAD')) {
      await sendLanding(response, query);
      return;
    }
    const challenge = path.match(/^\/admin\/challenge\/([0-9a-f]{32})\.bmp$/);
    if (challenge && (method === 'GET' || method === 'HEAD')) {
      const image = challengeImage(challenge[1]);
      if (!image) throw new RequestError(404, 'Doğrulama görseli bulunamadı.');
      sendContent(response, 'image/bmp', image);
      return;
    }
    const asset = assets.get(path);
    if (!asset) {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const [filename, contentType, privateAsset] = asset;
    const role = path.slice(1);
    if (privateAsset && !session) {
      if (Object.hasOwn(panels, role)) redirect(response, role === 'admin' ? landingLogin : `/?panel=${role}#admin-giris`);
      else throw new RequestError(401, 'Admin paneline giriş yapın.');
      return;
    }
    if (Object.hasOwn(panels, role) && session.role !== role) {
      redirect(response, `/${session.role}`);
      return;
    }
    const content = await readFile(join(__dirname, 'muterminal', filename));
    const type = contentType.startsWith('text/') ? `${contentType}; charset=utf-8` : contentType;
    sendContent(response, type, content);
  } catch (error) {
    if (error instanceof RequestError) {
      json(response, error.status, { error: error.message });
      return;
    }
    if (error.code === 11000) {
      json(response, 409, { error: 'Bu kod veya e-posta adresi zaten kayıtlı.' });
      return;
    }
    console.error(error.message);
    json(response, 500, { error: 'İşlem tamamlanamadı. MongoDB bağlantısını kontrol edin.' });
  }
});

server.listen(port, host, () => {
  console.log(`MuTerminal http://${host}:${server.address().port}`);
});
