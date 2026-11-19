const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { operations, saleApproval, assessments } = require('../operations.cjs');

function createCore(database, challenge, scanEnabled) {
  const { Table, newRecordId, createSession, findSession, deleteSession, revokeSessions } = database;
  const { challengeImage, verifyChallenge } = challenge;
  const records = new Table('products');
  const users = new Table('accounts');
  const passwordOverrides = new Table('account_password_overrides');
  const stores = new Table('stores');
  const settingsCollection = new Table('system_settings');
  const departmentOptions = new Table('department_options');
  const pilotStore = { id: 'pilot', name: 'Pilot Mağaza' };
  const panels = { admin: 'MuTerminal Admin', manager: 'MuTerminal Manager', staff: 'MuTerminal Staff' };
  const defaultPilotPassword = '1234567890';
  const defaultSettings = { expiryWarningDays: 7, blockRksAcrossLots: false, productSource: 'Manuel ürün girişi', erpEndpoint: '', wmsEndpoint: '' };
  const derivePassword = promisify(scrypt);
  const kasaDepartments = {
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
  const departmentMainNames = {
    'kasa-reyon': 'Kasa Reyon',
    kasap: 'Kasap',
    sarkuteri: 'Şarküteri',
    'meyve-sebze': 'Meyve Sebze',
    'unlu-mamuller-reyon': 'Unlu Mamuller',
  };
  const staffDepartments = {
    'kasa-reyon': departmentMainNames['kasa-reyon'],
    'kasap-sarkuteri': 'Kasap - Şarküteri',
    'meyve-sebze': departmentMainNames['meyve-sebze'],
    'unlu-mamuller-reyon': departmentMainNames['unlu-mamuller-reyon'],
  };
  const legacyChoices = new Set([saleApproval, 'Blokaj devam', 'Depoya iade', 'İncelemeye sevk']);
  const localTime = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'short',
  });
  const hashText = value => createHash('sha256').update(value).digest();
  for (const name of [
    'Salça', 'Yağlar', 'Ezme ve Krema', 'Bisküvi', 'Çikolatalar', 'Bebek Ürünleri',
    'Kedi Ürünleri', 'Köpek Ürünleri', 'Diğer Hayvan Ürünleri',
  ]) {
    kasaDepartments[departmentOptionId('kasa-reyon', name)] = name;
  }
  const accounts = new Map([
    ['tester@muterminal.com', process.env.MUTERMINAL_TESTER_PASSWORD ?? 'tester123!', Object.keys(panels), true],
    [process.env.MUTERMINAL_ADMIN_EMAIL ?? 'admin@muterminal.com', process.env.MUTERMINAL_ADMIN_PASSWORD ?? defaultPilotPassword, ['admin'], process.env.MUTERMINAL_ADMIN_CAN_APPROVE !== 'false'],
    ['yonetici@muterminal.com', defaultPilotPassword, ['manager'], false, true],
  ].map(([email, password, roles, canApprove, changeable = false]) => [email.toLowerCase(), {
    email: email.toLowerCase(), password, roles, canApprove, changeable, storeId: pilotStore.id,
  }]));
  let pilotAccountsReady;
  const sessionCookie = 'muterminal_session';
  const sessionSeconds = 8 * 60 * 60;
  const landingLogin = '/#admin-giris';
  const scanBarcode = '8690000000011';

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

  function credentialTag(account) {
    return hashText(JSON.stringify([account.passwordHash, account.salt, account.roles, account.canApprove, account.storeId, account.displayName])).toString('hex');
  }

  async function getSession(request) {
    const token = sessionToken(request);
    if (!token) return;
    const stored = await findSession(token);
    if (!stored) return;
    const account = await activeAccount(stored.payload.email);
    if (account && stored.credential_tag === credentialTag(account)) return stored.payload;
  }

  function redirect(response, path, cookie) {
    const headers = { Location: path, 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    response.writeHead(303, headers).end();
  }

  function sessionHeader(request, token, maxAge) {
    const secure = request.socket.encrypted || process.env.MUTERMINAL_PUBLIC_ORIGIN?.startsWith('https://') ? '; Secure' : '';
    return `${sessionCookie}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Strict${secure}`;
  }

  function requireSameOrigin(request) {
    const scheme = request.socket.encrypted ? 'https' : 'http';
    const origin = request.headers.origin;
    const expected = process.env.MUTERMINAL_PUBLIC_ORIGIN ?? `${scheme}://${request.headers.host}`;
    if (origin && origin !== expected) {
      throw new RequestError(403, 'Geçersiz istek kaynağı.');
    }
  }

  function loginDestination(role, requestId, error) {
    const query = new URLSearchParams(error ? { giris: error, panel: role } : { panel: role });
    if (scanEnabled() && role === 'manager' && isRecordId(requestId)) query.set('talep', requestId);
    return `/?${query}#admin-giris`;
  }

  function isRecordId(value) {
    return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
  }

  async function serveApi(request, response, path) {
    try {
      const method = request.method;
      if (path === '/api/session/login' && method === 'POST') {
        requireSameOrigin(request);
        await adminLogin(request, response);
        return;
      }
      if (path === '/api/session/login' && (method === 'GET' || method === 'HEAD')) {
        const url = new URL(request.url, 'http://localhost');
        const role = url.searchParams.get('panel');
        redirect(response, Object.hasOwn(panels, role) ? loginDestination(role, url.searchParams.get('talep')) : landingLogin);
        return;
      }
      if (path === '/api/session/logout' && method === 'POST') {
        requireSameOrigin(request);
        const token = sessionToken(request);
        if (token) await deleteSession(token);
        redirect(response, '/', sessionHeader(request, '', 0));
        return;
      }
      const challenge = path.match(/^\/api\/session\/challenge\/([0-9a-f]{32})\.bmp$/);
      if (challenge && (method === 'GET' || method === 'HEAD')) {
        const image = await challengeImage(challenge[1]);
        if (!image) throw new RequestError(404, 'Doğrulama görseli bulunamadı.');
        sendContent(response, 'image/bmp', image);
        return;
      }
      const session = await getSession(request);
      if (!session) throw new RequestError(401, 'MuTerminal paneline giriş yapın.');
      if (method === 'POST' || method === 'DELETE') requireSameOrigin(request);
      await handleApi(request, response, path, session);
    } catch (error) {
      if (error instanceof RequestError) {
        json(response, error.status, { error: error.message });
        return;
      }
      if (error.code === '23505') {
        json(response, 409, { error: 'Bu kod veya kullanıcı adı zaten kayıtlı.' });
        return;
      }
      console.error(error.message);
      json(response, 500, { error: 'İşlem tamamlanamadı. PostgreSQL bağlantısını kontrol edin.' });
    }
  }


  function sendContent(response, type, content) {
    response.writeHead(200, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
    }).end(content);
  }

  async function activeAccount(username) {
    const builtIn = accounts.get(username);
    if (builtIn) {
      await ensurePilotAccounts();
      const account = await users.findOne({ _id: username, active: true, builtIn: true });
      const override = builtIn.changeable && await passwordOverrides.findOne({ _id: username });
      return account ? { ...account, ...(override || {}), canApprove: builtIn.canApprove, hasPasswordOverride: Boolean(override) } : null;
    }
    return username ? users.findOne({ _id: username, active: true, builtIn: { $in: [null, false] } }) : null;
  }

  function ensurePilotAccounts() {
    pilotAccountsReady ??= (async () => {
      for (const { password, ...account } of accounts.values()) {
        const saved = await users.findOne({ _id: account.email });
        if (saved?.builtIn) continue;
        if (saved) throw new Error('The existing account conflicts with a reserved pilot username.');
        try {
          await users.insertOne({ _id: account.email, ...account, ...await passwordCredentials(password), active: true, builtIn: true });
        } catch (error) {
          if (error.code !== '23505' || !(await users.findOne({ _id: account.email, builtIn: true }))) throw error;
        }
      }
    })().catch(error => {
      pilotAccountsReady = undefined;
      throw error;
    });
    return pilotAccountsReady;
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
    const requestId = fields.get('talep');
    if (!await verifyChallenge(fields.get('challengeId'), fields.get('challengeAnswer'))) {
      redirect(response, loginDestination(chosenPanel, requestId, 'dogrulama'));
      return;
    }
    const email = fields.get('email')?.trim().toLowerCase();
    const password = fields.get('password') ?? '';
    const account = await activeAccount(email);
    const validPassword = await matchesPassword(account, password);
    if (!validPassword) {
      redirect(response, loginDestination(chosenPanel, requestId, 'bilgi'));
      return;
    }
    if (!Object.hasOwn(panels, role) || !account.roles.includes(role)) {
      redirect(response, loginDestination(chosenPanel, requestId, 'yetki'));
      return;
    }
    const previous = sessionToken(request);
    if (previous) await deleteSession(previous);
    const token = randomBytes(32).toString('base64url');
    await createSession(token, email, new Date(Date.now() + sessionSeconds * 1000), credentialTag(account), {
      email: account.email, displayName: account.displayName, role, storeId: account.storeId,
      canApprove: role === 'manager' || (role === 'admin' && account.canApprove),
      canChangePassword: role === 'manager' && (!accounts.has(email) || account.changeable === true),
    });
    let destination = `/${role}`;
    if (scanEnabled()) {
      if (role === 'staff') destination = '/staff/scan';
      if (role === 'manager' && isRecordId(requestId)) destination = `/manager?talep=${requestId}#talep-${requestId}`;
    }
    redirect(response, destination, sessionHeader(request, token, sessionSeconds));
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

  function normalizeDepartmentName(name) {
    return name.normalize('NFC').toLocaleLowerCase('tr').replaceAll('ı', 'i');
  }

  function departmentOptionId(parentId, name) {
    return `alt-${hashText(`${parentId}:${normalizeDepartmentName(name)}`).toString('hex').slice(0, 24)}`;
  }

  async function departmentGroups() {
    const extras = await departmentOptions.find().toArray();
    const known = Object.entries(kasaDepartments).map(([id, name]) => ({ id, name }));
    return Object.entries(departmentMainNames).map(([id, name]) => ({
      id, name,
      children: [
        ...(id === 'kasa-reyon' ? known : []),
        ...extras.filter(item => item.parentId === id && (id !== 'kasa-reyon' || !Object.hasOwn(kasaDepartments, item._id)))
          .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
          .map(item => ({ id: item._id, name: item.name })),
      ],
    }));
  }

  async function createSubdepartment(body) {
    const parentId = requiredText(body, 'parentId', 'Ana reyon', 40);
    const name = requiredText(body, 'name', 'Alt reyon adı', 80).normalize('NFC');
    const group = (await departmentGroups()).find(item => item.id === parentId);
    if (!group) throw new RequestError(400, 'Geçerli bir ana reyon seçin.');
    const normalized = normalizeDepartmentName(name);
    if ([group.name, ...group.children.map(item => item.name)].some(item => normalizeDepartmentName(item) === normalized)) {
      throw new RequestError(409, 'Bu ad ilgili reyonda zaten tanımlı.');
    }
    const id = departmentOptionId(parentId, name);
    await departmentOptions.insertOne({ _id: id, parentId, name });
  }

  async function accountPermissions(body) {
    const { role } = body;
    if (typeof role !== 'string' || !Object.hasOwn(panels, role)) throw new RequestError(400, 'Geçerli bir rol seçin.');
    return { roles: [role], storeId: await requiredStore(body.storeId), canApprove: role === 'admin' && body.canApprove === true };
  }

  async function insertManagedAccount(body, permissions, password = body.password) {
    const email = requiredUsername(body);
    if (accounts.has(email)) throw new RequestError(409, 'Bu kullanıcı adı zaten kayıtlı.');
    const displayName = permissions.roles.includes('staff') || body.displayName
      ? requiredText(body, 'displayName', 'Ad soyad', 100) : undefined;
    const credentials = await passwordCredentials(password);
    await users.insertOne({ _id: email, email, ...credentials, ...permissions, ...(displayName && { displayName }), active: true });
  }

  function staffDepartmentSelection(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'string' && Object.hasOwn(staffDepartments, value)) return value;
    throw new RequestError(400, 'Geçerli bir personel reyonu seçin.');
  }

  async function handleManagerAccounts(request, response, path, session) {
    if (session.role !== 'manager') throw new RequestError(403, 'Bu işlem için yönetici paneline giriş yapın.');
    const staffScope = { storeId: session.storeId, roles: ['staff'] };
    if (request.method === 'GET' && path === '/api/manager/staff') {
      const list = await users.find(staffScope, { projection: { _id: 0, email: 1, displayName: 1, active: 1, staffDepartment: 1 } }).sort({ displayName: 1, email: 1 }).toArray();
      json(response, 200, list);
      return;
    }
    if (request.method !== 'POST') throw new RequestError(404, 'Personel işlemi bulunamadı.');
    const body = await readJson(request);
    if (path === '/api/manager/staff') {
      const password = body.password === '' || body.password === undefined ? defaultPilotPassword : body.password;
      const staffDepartment = staffDepartmentSelection(body.staffDepartment);
      await insertManagedAccount(body, { roles: ['staff'], storeId: session.storeId, canApprove: false, staffDepartment }, password);
    } else if (path === '/api/manager/staff/department') {
      const email = requiredUsername(body);
      if (!Object.hasOwn(body, 'staffDepartment')) throw new RequestError(400, 'Personel reyonunu belirtin.');
      const staffDepartment = staffDepartmentSelection(body.staffDepartment);
      const result = await users.updateOne({ _id: email, ...staffScope }, { $set: { staffDepartment } });
      if (!result.matchedCount) throw new RequestError(404, 'Bu mağazada personel hesabı bulunamadı.');
    } else if (path === '/api/manager/staff/password') {
      const email = requiredUsername(body);
      const credentials = await passwordCredentials(body.password);
      const result = await users.updateOne({ _id: email, ...staffScope }, { $set: credentials });
      if (!result.matchedCount) throw new RequestError(404, 'Bu mağazada personel hesabı bulunamadı.');
      await revokeSessions(email);
    } else if (path === '/api/manager/password') {
      if (!session.canChangePassword) throw new RequestError(403, 'Bu hesabın şifresi panelden değiştirilemez.');
      const account = await activeAccount(session.email);
      if (!await matchesPassword(account, body.currentPassword)) throw new RequestError(400, 'Mevcut şifre hatalı.');
      const credentials = await passwordCredentials(body.password);
      if (account.changeable && !account.hasPasswordOverride) {
        await passwordOverrides.insertOne({ _id: session.email, ...credentials });
      } else {
        const collection = account.changeable ? passwordOverrides : users;
        const filter = { _id: session.email, passwordHash: account.passwordHash };
        if (!account.changeable) Object.assign(filter, { active: true, roles: ['manager'], storeId: session.storeId });
        const result = await collection.updateOne(filter, { $set: credentials });
        if (!result.matchedCount) throw new RequestError(409, 'Hesap bilgisi değişti, yeniden giriş yapın.');
      }
      await revokeSessions(session.email);
      response.writeHead(204, { 'Set-Cookie': sessionHeader(request, '', 0) }).end();
      return;
    } else throw new RequestError(404, 'Personel işlemi bulunamadı.');
    response.writeHead(204).end();
  }

  async function handleManagement(request, response, path, session) {
    requireAdmin(session);
    if (request.method === 'GET' && path === '/api/admin/management') {
      const savedUsers = await users.find({ builtIn: { $in: [null, false] } }, { projection: { passwordHash: 0, salt: 0, _id: 0 } }).sort({ email: 1 }).toArray();
      const builtIns = [...accounts.values()].map(({ email, roles, canApprove, storeId }) => ({ email, roles, canApprove, storeId, active: true, builtIn: true }));
      json(response, 200, { users: [...builtIns, ...savedUsers], stores: await storeList(), settings: await getSettings(), departmentGroups: await departmentGroups() });
      return;
    }
    if (request.method !== 'POST') throw new RequestError(404, 'Yönetim işlemi bulunamadı.');
    const body = await readJson(request);
    if (path === '/api/admin/stores') {
      const name = requiredText(body, 'name', 'Mağaza adı', 100);
      const id = requiredText(body, 'id', 'Mağaza kodu', 50).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(id) || id === pilotStore.id) throw new RequestError(400, 'Benzersiz bir mağaza kodu girin.');
      await stores.insertOne({ _id: id, name });
    } else if (path === '/api/admin/departments') {
      await createSubdepartment(body);
    } else if (path === '/api/admin/users') {
      await insertManagedAccount(body, await accountPermissions(body));
    } else if (path === '/api/admin/users/permissions') {
      const email = requiredText(body, 'email', 'E-posta', 100).toLowerCase();
      if (email === session.email) throw new RequestError(400, 'Kendi hesabınızın yetkilerini düzenleyemezsiniz.');
      const result = await users.updateOne({ _id: email, builtIn: { $in: [null, false] } }, { $set: await accountPermissions(body) });
      if (!result.matchedCount) throw new RequestError(404, 'Yönetilebilir bir hesap bulunamadı.');
      await revokeSessions(email);
    } else if (path === '/api/admin/users/status') {
      const email = requiredText(body, 'email', 'E-posta', 100).toLowerCase();
      if (email === session.email || typeof body.active !== 'boolean') throw new RequestError(400, 'Geçersiz hesap durumu.');
      const result = await users.updateOne({ _id: email, builtIn: { $in: [null, false] } }, { $set: { active: body.active } });
      if (!result.matchedCount) throw new RequestError(404, 'Yönetilebilir bir hesap bulunamadı.');
      if (!body.active) await revokeSessions(email);
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

  async function requiredDepartment(department) {
    if (typeof department === 'string') {
      if (Object.hasOwn(kasaDepartments, department) || Object.hasOwn(departmentMainNames, department)) return department;
      if (/^alt-[0-9a-f]{24}$/.test(department) && await departmentOptions.findOne({ _id: department })) return department;
    }
    throw new RequestError(400, 'Geçerli bir reyon seçin.');
  }

  async function newProduct(body) {
    const name = requiredText(body, 'name', 'Ürün adı', 150);
    const code = requiredText(body, 'code', 'Barkod', 80);
    const lot = requiredText(body, 'lot', 'Lot', 80);
    const { type, expired } = body;
    if (!Object.hasOwn(operations, type)) throw new RequestError(400, 'Geçerli bir operasyon seçin.');
    const department = await requiredDepartment(body.department);
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
    const [entries, settings, groups] = await Promise.all([
      records.find(accessScope(session)).sort({ createdAt: -1, _id: -1 }).toArray(), getSettings(), departmentGroups(),
    ]);
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
      const id = _id;
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
    logs.sort((first, second) => Date.parse(second.time) - Date.parse(first.time));
    return { products, logs, departmentGroups: groups };
  }

  function chooseRisk(ownRisk, lotRisk) {
    return ((lotRisk?.level === 'danger' && ownRisk?.level !== 'danger') || (!ownRisk?.blocks && lotRisk))
      ? { ...lotRisk, label: `Aynı lot · ${lotRisk.label}` }
      : ownRisk;
  }

  function scanLot(recordsForBarcode, lot, settings, now) {
    const lotRecords = recordsForBarcode.filter(item => item.lot === lot);
    const product = lotRecords.find(item => item.type === 'SKT') ?? lotRecords[0];
    if (!product) return null;
    const expiryDate = lotRecords.map(item => item.details?.expiryDate).filter(Boolean).sort()[0] ?? null;
    const rksBlocked = recordsForBarcode.some(item => item.type === 'RKS Blokaj' && (item.lot === lot || settings.blockRksAcrossLots));
    const blocked = rksBlocked || lotRecords.some(item => productRisk(item, now, settings)?.blocks);
    const quantity = product.type === 'Depo Fark' ? product.details?.systemStock : product.qty;
    const choices = assessments.filter(action => matchesAssessment(product, action) && (!action.guarded || !blocked))
      .map(action => action.choice);
    return {
      id: product._id, name: product.name, barcode: product.code, productCode: product.productCode ?? product.code, lot,
      expiryDate, rksBlocked, expired: lotRecords.some(item => item.expired) || Boolean(expiryDate && expiryDate < now.slice(0, 10)),
      quantity: Number.isSafeInteger(quantity) ? quantity : null, pending: Boolean(product.proposal), example: product.scanExample === true, choices,
    };
  }

  async function scanLookup(session, code) {
    const settings = await getSettings();
    const now = currentMinute();
    const matches = await records.find({ ...accessScope(session), $or: [{ code }, { productCode: code }] })
      .sort({ createdAt: -1, _id: -1 }).toArray();
    const found = [];
    for (const barcode of new Set(matches.map(item => item.code))) {
      const entries = await records.find({ ...accessScope(session), code: barcode }).sort({ createdAt: -1, _id: -1 }).toArray();
      for (const lot of new Set(entries.map(item => item.lot))) found.push(scanLot(entries, lot, settings, now));
    }
    return { products: found, today: now.slice(0, 10) };
  }

  function scanCheckDetails(body) {
    const { expiryDate, rks, packaging, quantity } = body;
    if (!['clear', 'blocked', 'unknown'].includes(rks) || !['intact', 'damaged', 'unknown'].includes(packaging)) {
      throw new RequestError(400, 'RKS ve ambalaj kontrol sonuçlarını seçin.');
    }
    if (!Number.isSafeInteger(quantity) || quantity < 0) throw new RequestError(400, 'Sayılan miktar sıfır veya pozitif tam sayı olmalıdır.');
    return { expiryDate: expiryDate === null ? null : dateField(expiryDate, { label: 'SKT', type: 'date' }), rks, packaging, quantity };
  }

  async function validateScanClearance(product, check, now) {
    const recordsForBarcode = await records.find({ ...storeScope(productStore(product)), code: product.code }).toArray();
    const lot = scanLot(recordsForBarcode, product.lot, await getSettings(), now);
    if (!lot || lot.expired || lot.rksBlocked || (lot.expiryDate && lot.expiryDate !== check.expiryDate) ||
        !check.expiryDate || check.expiryDate < now.slice(0, 10) || check.rks !== 'clear' || check.packaging !== 'intact' ||
        check.quantity < 1 || (lot.quantity !== null && lot.quantity !== check.quantity)) {
      throw new RequestError(409, 'Satış ön onayı veya sevkiyat uygunluğu için RKS, SKT, ambalaj ve miktar kontrolleri uygun olmalıdır.');
    }
  }

  async function scanHistory(session) {
    const entries = await records.find(accessScope(session)).toArray();
    const history = new Map();
    for (const entry of entries) {
      for (const decision of entry.decisions ?? []) {
        if (decision.source !== 'scan' || (decision.actor !== session.email && decision.requestedBy !== session.email)) continue;
        const earlier = history.get(decision.requestId);
        history.set(decision.requestId, {
          requestId: decision.requestId, name: entry.name, barcode: entry.code, lot: entry.lot,
          choice: decision.choice, status: decision.requestStatus, time: decision.time, reason: earlier?.reason ?? decision.reason,
          reviewReason: decision.requestStatus === 'pending' ? null : decision.reason,
        });
      }
    }
    const rows = [...history.values()].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
    return { pending: rows.filter(row => row.status === 'pending'), history: rows.slice(0, 50) };
  }

  async function handleScan(request, response, path, session, options) {
    if (session.role !== 'staff') throw new RequestError(403, 'MuScan için personel paneline giriş yapın.');
    if (request.method === 'GET' && path === '/api/scan') {
      const code = requiredText({ code: options.get('code') }, 'code', 'Barkod veya ürün kodu', 80);
      json(response, 200, await scanLookup(session, code));
      return;
    }
    if (request.method === 'GET' && path === '/api/scan/history') {
      json(response, 200, await scanHistory(session));
      return;
    }
    if (request.method === 'POST' && path === '/api/scan/example') {
      const existing = await scanLookup(session, scanBarcode);
      if (existing.products.length) return json(response, 200, existing);
      const item = await newProduct({
        name: 'Örnek Süt 1 L', code: scanBarcode, lot: 'SUT-221126', type: 'SKT', department: 'sut',
        qty: 12, expired: false, details: { expiryDate: '2026-11-22' },
      });
      const id = hashText(`scan-example:${session.storeId}`).toString('hex').slice(0, 24);
      try {
        await records.insertOne({ ...item, _id: id, storeId: session.storeId, createdBy: session.email, scanExample: true });
      } catch (error) {
        if (error.code !== '23505') throw error;
      }
      json(response, 200, await scanLookup(session, scanBarcode));
      return;
    }
    if (request.method === 'POST' && path === '/api/scan/requests') {
      const body = await readJson(request);
      if (!isRecordId(body.productId)) throw new RequestError(400, 'Geçerli bir ürün ve lot seçin.');
      const check = scanCheckDetails(body);
      const selected = await records.findOne({ _id: body.productId, ...accessScope(session) });
      if (!selected) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
      const { products } = await scanLookup(session, selected.code);
      const option = products.find(item => item.id === body.productId);
      if (!option || !option.choices.includes(body.choice)) throw new RequestError(409, 'Bu ürün ve lot için geçerli bir karar önerisi seçin.');
      const requestId = await saveDecision(body.productId, { choice: body.choice, reason: body.reason, kind: 'assessment' }, session, undefined, check);
      json(response, 201, { requestId });
      return;
    }
    throw new RequestError(404, 'MuScan işlemi bulunamadı.');
  }

  async function saveDecision(id, body, session, proposalId, scanCheck) {
    const staff = session.role === 'staff' ? (session.displayName ?? session.email) : requiredText(body, 'staff', 'Personel', 100);
    const reason = requiredText(body, 'reason', 'Gerekçe', 1000);
    const { choice, kind } = body;
    if (kind !== undefined && kind !== 'assessment') throw new RequestError(400, 'Geçersiz karar türü.');
    const isAssessment = kind === 'assessment';
    const filter = { _id: id, ...accessScope(session) };
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
    const proposal = proposalId && product.proposal?.id === proposalId ? product.proposal : undefined;
    const scan = scanCheck ?? proposal?.scanCheck;
    if (scan && action.guarded) await validateScanClearance(product, scan, now);
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
    if (scan) Object.assign(decision, { source: 'scan', scanCheck: scan });
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
      const requestId = newRecordId();
      if (scan) Object.assign(decision, { requestId, requestStatus: 'pending' });
      const proposal = { ...decision, id: requestId, result: 'Onay bekliyor' };
      const saved = await records.updateOne({ ...filter, proposal: null }, {
        $set: { proposal }, $push: { decisions: { ...decision, kind: 'proposal', result: 'Onay bekliyor' } },
      });
      if (!saved.matchedCount) throw new RequestError(409, 'Kayıt değişti veya bu kayıt için zaten bekleyen bir talep var.');
      return requestId;
    }
    if (proposalId) {
      filter['proposal.id'] = proposalId;
      decision.requestedBy = product.proposal?.actor;
      decision.result = `Onaylandı · ${status}`;
      if (scan) Object.assign(decision, { requestId: proposalId, requestStatus: 'approved' });
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
    const filter = { _id: id, ...accessScope(session), 'proposal.id': body.proposalId };
    const product = await records.findOne(filter);
    if (!product) throw new RequestError(404, 'Bekleyen talep bulunamadı.');
    const { choice, kind, destination, actor, scanCheck } = product.proposal;
    if (body.outcome === 'approve') {
      await saveDecision(id, { choice, kind, destination, staff: session.email, reason }, session, body.proposalId);
      return;
    }
    const result = await records.updateOne(filter, {
      $unset: { proposal: '' },
      $push: { decisions: { choice, reason, kind: 'review', result: 'Reddedildi', actor: session.email, staff: session.email, requestedBy: actor, time: new Date(),
        ...(scanCheck && { source: 'scan', scanCheck, requestId: body.proposalId, requestStatus: 'rejected' }) } },
    });
    if (!result.matchedCount) throw new RequestError(409, 'Talep başka bir oturumda değerlendirildi.');
  }

  function operationAction(product, choice) {
    if (product.details) return operations[product.type].actions.find(action => action.choice === choice);
    if (legacyChoices.has(choice)) return { choice, guarded: choice === saleApproval };
  }

  async function completeDetails(id, body, session) {
    const filter = { _id: id, details: { $exists: false }, ...accessScope(session) };
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
    if (path === '/api/scan' || path.startsWith('/api/scan/')) {
      if (!scanEnabled()) throw new RequestError(404, 'Bu modül şu anda kullanıma açık değil.');
      return handleScan(request, response, path, session, new URL(request.url, 'http://localhost').searchParams);
    }
    if (request.method === 'GET' && path === '/api/context') {
      const { email, displayName, role, canApprove, canChangePassword, storeId } = session;
      const locations = role === 'admin' ? await storeList() : [
        storeId === pilotStore.id ? pilotStore : { id: storeId, name: (await stores.findOne({ _id: storeId }))?.name ?? storeId },
      ];
      json(response, 200, { email, displayName, role, title: panels[role], canApprove, canChangePassword, storeId, stores: locations,
        staffDepartments: role === 'manager' ? staffDepartments : undefined, scanEnabled: scanEnabled() });
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
      const groups = await departmentGroups();
      const flat = groups.flatMap(({ id, name, children }) => [[id, name], ...children.map(child => [child.id, child.name])]);
      json(response, 200, Object.fromEntries(flat));
      return;
    }
    if (request.method === 'GET' && path === '/api/department-groups') {
      json(response, 200, await departmentGroups());
      return;
    }
    if (request.method === 'POST' && path === '/api/products') {
      const body = await readJson(request);
      const product = await newProduct(body);
      product.storeId = session.role === 'admin' ? await requiredStore(body.storeId ?? session.storeId) : session.storeId;
      product.createdBy = session.email;
      const result = await records.insertOne(product);
      json(response, 201, { id: result.insertedId });
      return;
    }
    const product = path.match(/^\/api\/products\/([0-9a-f]{24})$/);
    if (request.method === 'DELETE' && product) {
      requireAdmin(session);
      const result = await records.deleteOne({ _id: product[1] });
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
        { _id: reclassify[1], department: null, ...accessScope(session) },
        { $set: { department: await requiredDepartment(department) } },
      );
      if (!result.matchedCount) throw new RequestError(409, 'Kayıt bulunamadı veya reyonu zaten atanmış.');
      response.writeHead(204).end();
      return;
    }
    throw new RequestError(404, 'İstek adresi bulunamadı.');
  }

  return { getSession, serveApi, ensurePilotAccounts };
}

module.exports = { createCore };
