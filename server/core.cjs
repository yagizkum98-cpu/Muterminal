const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { operations, saleApproval, assessments } = require('../operations.cjs');

function createCore(database, challenge, scanEnabled, trace, traceAccess, traceControls, mobileAccess) {
  const { Table, newRecordId, createSession, findSession, deleteSession, revokeSessions } = database;
  const { createChallenge, challengeImage, verifyChallenge } = challenge;
  const records = new Table('products');
  const users = new Table('accounts');
  const passwordOverrides = new Table('account_password_overrides');
  const stores = new Table('stores');
  const settingsCollection = new Table('system_settings');
  const departmentOptions = new Table('department_options');
  const pilotStore = { id: 'pilot', name: 'Pilot Mağaza' };
  const panels = { admin: 'MuTerminal Admin', manager: 'MuTerminal Manager', staff: 'MuTerminal Staff' };
  const defaultPilotPassword = '1234567890';
  const localPilotDefaults = process.env.VERCEL !== '1'
    && !process.env.MUTERMINAL_PUBLIC_ORIGIN?.startsWith('https://');
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
  const staffJobTitles = {
    'kasa-reyon': 'Kasa Reyon Görevlisi',
    'kasap-sarkuteri': 'Kasap Şarküteri Görevlisi',
    'meyve-sebze': 'Meyve Sebze Görevlisi',
    'unlu-mamuller-reyon': 'Unlu Mamülleri Görevlisi',
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
    ['tester@muterminal.com', process.env.MUTERMINAL_TESTER_PASSWORD || (localPilotDefaults && 'tester123!'), Object.keys(panels), true],
    [process.env.MUTERMINAL_ADMIN_EMAIL ?? 'admin@muterminal.com', process.env.MUTERMINAL_ADMIN_PASSWORD || (localPilotDefaults && defaultPilotPassword), ['admin'], process.env.MUTERMINAL_ADMIN_CAN_APPROVE !== 'false'],
    ['yonetici@muterminal.com', process.env.MUTERMINAL_MANAGER_PASSWORD || (localPilotDefaults && defaultPilotPassword), ['manager'], false, true],
  ].filter(([, password]) => password).map(([email, password, roles, canApprove, changeable = false]) => [email.toLowerCase(), {
    email: email.toLowerCase(), password, roles, canApprove, changeable, storeId: pilotStore.id,
  }]));
  let pilotAccountsReady;
  let traceAccountsReady;
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

  function traceCredentialTag(account) {
    return hashText(JSON.stringify(account)).toString('hex');
  }

  async function getSession(request) {
    const token = sessionToken(request);
    if (!token) return;
    const stored = await findSession(token);
    if (!stored) return;
    if (stored.payload.role === 'trace') {
      const account = await traceAccess.activeTraceAccount(stored.payload.email);
      if (account && stored.credential_tag === traceCredentialTag(account)) {
        const { role, tenantId, storeId, warehouseId, control, review } = account;
        return { ...stored.payload, scope: { role, tenantId, storeId, warehouseId, control, review } };
      }
      return;
    }
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

  function loginDestination(role, requestId, error, mobile = false) {
    const query = new URLSearchParams(error ? { giris: error, panel: role } : { panel: role });
    if (scanEnabled() && role === 'manager' && isRecordId(requestId)) query.set('talep', requestId);
    if (mobile) query.set('mobil', '1');
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
      if (path === '/api/trace/login' && method === 'POST') {
        requireSameOrigin(request);
        await traceLogin(request, response);
        return;
      }
      if (path === '/api/session/login' && (method === 'GET' || method === 'HEAD')) {
        const url = new URL(request.url, 'http://localhost');
        const role = url.searchParams.get('panel');
        redirect(response, Object.hasOwn(panels, role)
          ? loginDestination(role, url.searchParams.get('talep'), undefined, url.searchParams.get('mobil') === '1') : landingLogin);
        return;
      }
      if (path === '/api/session/logout' && method === 'POST') {
        requireSameOrigin(request);
        const token = sessionToken(request);
        if (token) await deleteSession(token);
        const mobile = new URL(request.url, 'http://localhost').searchParams.get('mobil') === '1';
        redirect(response, mobile ? '/mobil' : '/', sessionHeader(request, '', 0));
        return;
      }
      if (path === '/api/session/challenge' && method === 'POST') {
        requireSameOrigin(request);
        json(response, 200, await createChallenge());
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
      if (path === '/api/trace/mobile/verify' && method === 'POST') {
        if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
          throw new RequestError(415, 'Mobil onay formunu kullanın.');
        }
        const code = new URLSearchParams(await readBody(request)).get('code') ?? '';
        const verified = await mobileAccess.verifyMobileStaffCode(session, sessionToken(request), code);
        return redirect(response, verified ? '/mobil' : '/mobil?onay=hata');
      }
      const mobile = session.mobile || request.headers['x-muterminal-mobile'] === '1' ||
        new URL(request.url, 'http://localhost').searchParams.get('mobil') === '1';
      if (mobile && await mobileAccess.mobileStaffState(session) !== 'allowed') {
        throw new RequestError(403, 'Mobil personel erişimi için onay kodu gerekir.');
      }
      if (method === 'POST' && (path === '/api/session/password' ||
          (path === '/api/manager/password' && session.role === 'manager'))) {
        await changeOwnPassword(request, response, session);
        return;
      }
      await handleApi(request, response, path, session);
    } catch (error) {
      if (error instanceof RequestError || error instanceof trace.TraceError) {
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

  async function changeOwnPassword(request, response, session) {
    const { currentPassword, password } = await readJson(request);
    const traceSession = session.role === 'trace';
    const account = traceSession ? await traceAccess.activeTraceAccount(session.email) : await activeAccount(session.email);
    if (!await matchesPassword(account, currentPassword)) throw new RequestError(400, 'Mevcut şifre hatalı.');
    if (!localPilotDefaults && ['1234567890', 'admin123!', 'tester123!', 'depo123!'].includes(password)) {
      throw new RequestError(400, 'Farklı bir şifre seçin.');
    }
    const credentials = await passwordCredentials(password);
    let changed;
    if (traceSession) {
      changed = await traceAccess.changeTracePassword(session.email, account.passwordHash, credentials);
    } else if (accounts.get(session.email)?.changeable && !account.hasPasswordOverride) {
      await passwordOverrides.insertOne({ _id: session.email, ...credentials });
      changed = true;
    } else {
      const collection = account.hasPasswordOverride ? passwordOverrides : users;
      const filter = { _id: session.email, passwordHash: account.passwordHash };
      if (!account.hasPasswordOverride) filter.active = true;
      changed = (await collection.updateOne(filter, { $set: credentials })).matchedCount;
    }
    if (!changed) throw new RequestError(409, 'Hesap bilgisi değişti, yeniden giriş yapın.');
    response.writeHead(204, { 'Set-Cookie': sessionHeader(request, '', 0) }).end();
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
    const mobile = fields.get('mobil') === '1';
    if (!await verifyChallenge(fields.get('challengeId'), fields.get('challengeAnswer'))) {
      redirect(response, loginDestination(chosenPanel, requestId, 'dogrulama', mobile));
      return;
    }
    const email = fields.get('email')?.trim().toLowerCase();
    const password = fields.get('password') ?? '';
    const account = await activeAccount(email);
    const validPassword = await matchesPassword(account, password);
    if (!validPassword) {
      redirect(response, loginDestination(chosenPanel, requestId, 'bilgi', mobile));
      return;
    }
    if (!Object.hasOwn(panels, role) || !account.roles.includes(role)) {
      redirect(response, loginDestination(chosenPanel, requestId, 'yetki', mobile));
      return;
    }
    const previous = sessionToken(request);
    if (previous) await deleteSession(previous);
    const token = randomBytes(32).toString('base64url');
    await createSession(token, email, new Date(Date.now() + sessionSeconds * 1000), credentialTag(account), {
      email: account.email, displayName: account.displayName, role, storeId: account.storeId,
      mobile,
      canApprove: role === 'manager' || (role === 'admin' && account.canApprove),
      canChangePassword: role === 'manager' && (!accounts.has(email) || account.changeable === true),
    });
    let destination = mobile ? '/mobil' : `/${role}`;
    if (scanEnabled()) {
      if (role === 'staff' && !mobile) destination = '/staff/scan';
      if (role === 'manager' && isRecordId(requestId)) destination = `/manager?talep=${requestId}${mobile ? '&mobil=1' : ''}#talep-${requestId}`;
    }
    redirect(response, destination, sessionHeader(request, token, sessionSeconds));
  }

  function seedTraceAccounts() {
    traceAccountsReady ??= (async () => {
      const warehousePassword = process.env.MUTERMINAL_TRACE_PILOT_WAREHOUSE_PASSWORD;
      const superPassword = process.env.MUTERMINAL_TRACE_SUPER_PASSWORD;
      const superEmail = process.env.MUTERMINAL_TRACE_SUPER_EMAIL?.trim().toLowerCase();
      const seeds = [
        [warehousePassword, { email: 'depo@muterminal.com', displayName: 'Depo Görevlisi', role: 'warehouse',
          tenantId: 'pilot', storeId: 'pilot', warehouseId: 'pilot-depo' }],
        [superEmail && superPassword, { email: superEmail, displayName: 'MuTerminal Süper Admin', role: 'super',
          tenantId: null, storeId: null, warehouseId: null }],
      ];
      for (const [password, account] of seeds) {
        if (password) await traceAccess.seedTraceAccount({ ...account, ...await passwordCredentials(password), active: true, control: false, review: false });
      }
    })().catch(error => {
      traceAccountsReady = undefined;
      throw error;
    });
    return traceAccountsReady;
  }

  async function traceLogin(request, response) {
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') {
      throw new RequestError(415, 'Giriş formunu kullanın.');
    }
    const fields = new URLSearchParams(await readBody(request));
    const mobile = fields.get('mobil') === '1';
    const mobileParam = mobile ? '&mobil=1' : '';
    if (!await verifyChallenge(fields.get('challengeId'), fields.get('challengeAnswer'))) return redirect(response, `/trace?giris=dogrulama${mobileParam}`);
    await seedTraceAccounts();
    const email = fields.get('email')?.trim().toLowerCase();
    const account = email && await traceAccess.activeTraceAccount(email);
    if (!await matchesPassword(account, fields.get('password'))) return redirect(response, `/trace?giris=bilgi${mobileParam}`);
    const previous = sessionToken(request);
    if (previous) await deleteSession(previous);
    const token = randomBytes(32).toString('base64url');
    await createSession(token, account.email, new Date(Date.now() + sessionSeconds * 1000), traceCredentialTag(account),
      { email: account.email, displayName: account.displayName, role: 'trace', storeId: account.storeId ?? '', canApprove: false, mobile });
    redirect(response, mobile ? '/mobil' : '/trace', sessionHeader(request, token, sessionSeconds));
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

  function traceKey(product) {
    return { storeId: productStore(product), barcode: product.code, lot: product.lot, name: product.name };
  }

  function coreRecallScope(session) {
    return session.role === 'admin' ? null : session.storeId;
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
    const assignment = role === 'staff' ? { staffDepartment: requiredStaffDepartment(body.staffDepartment) } : {};
    return { roles: [role], storeId: await requiredStore(body.storeId), canApprove: role === 'admin' && body.canApprove === true, ...assignment };
  }

  async function insertManagedAccount(body, permissions, password = body.password) {
    const email = requiredUsername(body);
    if (accounts.has(email)) throw new RequestError(409, 'Bu kullanıcı adı zaten kayıtlı.');
    const displayName = permissions.roles.includes('staff') || body.displayName
      ? requiredText(body, 'displayName', 'Ad soyad', 100) : undefined;
    const credentials = await passwordCredentials(password);
    await users.insertOne({ _id: email, email, ...credentials, ...permissions, ...(displayName && { displayName }), active: true });
  }

  function requiredStaffDepartment(value) {
    if (typeof value === 'string' && Object.hasOwn(staffJobTitles, value)) return value;
    throw new RequestError(400, 'Personel için dört iş unvanından birini seçin.');
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
      const staffDepartment = requiredStaffDepartment(body.staffDepartment);
      await insertManagedAccount(body, { roles: ['staff'], storeId: session.storeId, canApprove: false, staffDepartment }, password);
    } else if (path === '/api/manager/staff/department') {
      const email = requiredUsername(body);
      const staffDepartment = requiredStaffDepartment(body.staffDepartment);
      const result = await users.updateOne({ _id: email, ...staffScope }, { $set: { staffDepartment } });
      if (!result.matchedCount) throw new RequestError(404, 'Bu mağazada personel hesabı bulunamadı.');
    } else if (path === '/api/manager/staff/password') {
      const email = requiredUsername(body);
      const credentials = await passwordCredentials(body.password);
      const result = await users.updateOne({ _id: email, ...staffScope }, { $set: credentials });
      if (!result.matchedCount) throw new RequestError(404, 'Bu mağazada personel hesabı bulunamadı.');
      await revokeSessions(email);
    } else throw new RequestError(404, 'Personel işlemi bulunamadı.');
    response.writeHead(204).end();
  }

  async function handleManagement(request, response, path, session) {
    requireAdmin(session);
    if (request.method === 'GET' && path === '/api/admin/management') {
      const savedUsers = await users.find({ builtIn: { $in: [null, false] } }, { projection: { passwordHash: 0, salt: 0, _id: 0 } }).sort({ email: 1 }).toArray();
      const builtIns = [...accounts.values()].map(({ email, roles, canApprove, storeId }) => ({ email, roles, canApprove, storeId, active: true, builtIn: true }));
      const [locations, chains, settings, groups] = await Promise.all([
        storeList(), traceAccess.retailChains(), getSettings(), departmentGroups(),
      ]);
      json(response, 200, { users: [...builtIns, ...savedUsers], stores: locations, chains, settings, departmentGroups: groups });
      return;
    }
    if (request.method !== 'POST') throw new RequestError(404, 'Yönetim işlemi bulunamadı.');
    const body = await readJson(request);
    if (path === '/api/admin/stores') {
      const name = requiredText(body, 'name', 'Mağaza adı', 100);
      const id = requiredText(body, 'id', 'Mağaza kodu', 50).toLowerCase();
      if (!/^[a-z0-9-]+$/.test(id) || id === pilotStore.id) throw new RequestError(400, 'Benzersiz bir mağaza kodu girin.');
      const tenantId = body.tenantId === undefined ? 'pilot' : requiredText(body, 'tenantId', 'Market zinciri', 50);
      const province = body.province === undefined || body.province === '' ? undefined : requiredText(body, 'province', 'İl', 50);
      const district = body.district === undefined || body.district === '' ? undefined : requiredText(body, 'district', 'İlçe', 100);
      await traceAccess.createRetailStore(id, tenantId, { name, province, district });
    } else if (path === '/api/admin/chains') {
      const id = requiredText(body, 'id', 'Zincir kodu', 50).toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new RequestError(400, 'Geçerli bir zincir kodu girin.');
      await traceAccess.createRetailChain(id, requiredText(body, 'name', 'Zincir adı', 100));
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
    const [entries, settings, groups, recalls] = await Promise.all([
      records.find(accessScope(session)).sort({ createdAt: -1, _id: -1 }).toArray(), getSettings(), departmentGroups(),
      trace.openRecallKeys(coreRecallScope(session)),
    ]);
    const lotRisks = new Map();
    const blockedRks = new Set();
    const risks = entries.map(record => {
      const risk = productRisk(record, now, settings);
      const key = trace.traceLotKey(traceKey(record));
      if (risk?.blocks && (risk.level === 'danger' || !lotRisks.has(key))) lotRisks.set(key, risk);
      if (settings.blockRksAcrossLots && record.type === 'RKS Blokaj') blockedRks.add(JSON.stringify([productStore(record), trace.traceBarcode(record.code)]));
      return risk;
    });
    for (const [index, record] of entries.entries()) {
      const { _id, decisions, proposal, createdBy, ...product } = record;
      const id = _id;
      const storeId = productStore(product);
      const ownRisk = risks[index];
      const lotKey = trace.traceLotKey({ storeId, barcode: product.code, lot: product.lot });
      const lotRisk = lotRisks.get(lotKey);
      const relatedRks = blockedRks.has(JSON.stringify([storeId, trace.traceBarcode(product.code)]));
      const risk = chooseRisk(ownRisk, lotRisk);
      const recalled = recalls.has(lotKey);
      const effectiveRisk = recalled ? { label: 'Açık geri çağırma', level: 'danger', blocks: true }
        : relatedRks && !risk?.blocks ? { label: 'Mağazada açık RKS blokajı', level: 'warn', blocks: true } : risk;
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

  async function traceLookup(session, access, input, selectedLot) {
    const { code, lot } = trace.traceLookupInput(input, selectedLot);
    const [entries, settings, locations, assignedLots, warningDays, warehouses] = await Promise.all([
      trace.lookupOperations(code, access.storeIds), getSettings(), traceLocations(access),
      access.warehouseId ? traceAccess.warehouseLots(access.warehouseId) : null, traceAccess.traceWarningDays(access.tenantId),
      access.role === 'company' ? traceAccess.warehousesInStores(access.storeIds) : [],
    ]);
    const codes = [...new Set([code, ...entries.map(entry => trace.traceBarcode(entry.code))])];
    const [events, controls] = await Promise.all([
      trace.lookupEvents(codes, access, lot), traceControls.lookupControls(access, session.email, codes, lot),
    ]);
    const warehouseVisible = (barcode, lot) => !assignedLots || assignedLots.has(JSON.stringify([trace.traceBarcode(barcode), lot]));
    const groups = new Map();
    const openRks = new Set();
    const now = currentMinute();
    function group(item) {
      const key = trace.traceLotKey(item);
      if (!groups.has(key)) {
        groups.set(key, { ...item, storeName: Object.hasOwn(locations, item.storeId) ? locations[item.storeId] : item.storeId,
          expiryDates: [], rksBlocked: false, events: [], operations: [], controls: [],
          warehouses: warehouses.filter(warehouse => warehouse.storeId === item.storeId) });
      }
      return groups.get(key);
    }
    for (const entry of entries) {
      const item = traceKey(entry);
      if (settings.blockRksAcrossLots && entry.type === 'RKS Blokaj') {
        openRks.add(JSON.stringify([item.storeId, trace.traceBarcode(item.barcode)]));
      }
      if ((lot && item.lot !== lot) || !warehouseVisible(item.barcode, item.lot)) continue;
      const result = group(item);
      const risk = productRisk(entry, now, { ...settings, expiryWarningDays: warningDays });
      result.rksBlocked ||= entry.type === 'RKS Blokaj';
      const expiry = entry.details?.expiryDate;
      if (expiry && !result.expiryDates.includes(expiry)) result.expiryDates.push(expiry);
      result.operations.push({
        id: entry._id, type: entry.type, status: entry.status, qty: entry.qty, time: entry.createdAt,
        details: entry.details, risk,
        decisions: (entry.decisions ?? []).filter(decision => access.role === 'warehouse' ? decision.actor === session.email
          : access.role !== 'staff' || decision.actor === session.email || decision.requestedBy === session.email),
      });
    }
    for (const { storeId, barcode, lot: eventLot, name, actor, ...event } of events) {
      if (!warehouseVisible(barcode, eventLot)) continue;
      const result = group({ storeId, barcode, lot: eventLot, name });
      result.events.push({ ...event, actor: access.role !== 'staff' || actor === session.email ? actor : undefined });
    }
    for (const control of controls) {
      const { storeId, barcode, lot, name } = control;
      if (warehouseVisible(barcode, lot)) group({ storeId, barcode, lot, name }).controls.push(control);
    }
    for (const result of groups.values()) {
      result.expiryDates.sort();
      result.rksBlocked ||= openRks.has(JSON.stringify([result.storeId, trace.traceBarcode(result.barcode)]));
    }
    return { lots: [...groups.values()] };
  }

  async function traceLocations(access) {
    const locations = access.tenantId ? await traceAccess.traceStoreLocations(access.tenantId) : [];
    return Object.fromEntries(locations.filter(({ id }) => access.storeIds.includes(id)).map(({ id, name }) => [id, name]));
  }

  async function scopedTraceProduct(id, access) {
    if (!isRecordId(id)) throw new RequestError(400, 'Geçerli bir ürün ve lot seçin.');
    const scope = access.storeIds.includes(pilotStore.id) ? [...access.storeIds, null] : access.storeIds;
    const product = await records.findOne({ _id: id, storeId: { $in: scope } });
    if (!product) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
    return product;
  }

  async function handleTrace(request, response, path, session) {
    const access = await traceAccess.resolveTraceAccess(session);
    if (path === '/api/trace/management' && request.method === 'GET') {
      const [management, mobileStaff] = await Promise.all([
        traceAccess.traceManagement(access), mobileAccess.listMobileStaff(access),
      ]);
      return json(response, 200, { ...management, mobileStaff });
    }
    if (path === '/api/trace/management/mobile' && request.method === 'POST') {
      return json(response, 200, await mobileAccess.manageMobileCode(access, session.email, await readJson(request)));
    }
    if (request.method === 'POST' && path.startsWith('/api/trace/management/')) {
      await traceAccess.changeTraceManagement(access, session.email, path.slice('/api/trace/management/'.length), await readJson(request), passwordCredentials);
      return json(response, 200, { saved: true });
    }
    if (access.role === 'super') throw new RequestError(403, 'Müşteri kayıtları firma ve lokasyon yetkisi gerektirir.');
    if (request.method === 'GET' && path === '/api/trace/lookup') {
      const options = new URL(request.url, 'http://localhost').searchParams;
      return json(response, 200, await traceLookup(session, access, options.get('code')?.trim() ?? '', options.get('lot')?.trim() || null));
    }
    if (request.method === 'GET' && path === '/api/trace/report') {
      if (access.role === 'staff') return json(response, 200, { personal: await traceControls.personalReport(access, session.email) });
      const today = currentMinute().slice(0, 10);
      const expiryWarningDays = await traceAccess.traceWarningDays(access.tenantId);
      const warningDate = new Date(Date.parse(today) + expiryWarningDays * 86_400_000).toISOString().slice(0, 10);
      const [report, locations] = await Promise.all([trace.report(access, today, warningDate), traceLocations(access)]);
      return json(response, 200, { ...report, locations });
    }
    if (request.method === 'POST' && path === '/api/trace/decisions') {
      if (!access.canControl) throw new RequestError(403, 'Kontrol kaydı için yetkiniz yok.');
      const body = await readJson(request);
      const product = await scopedTraceProduct(body.productId, access);
      const { rks, expiryDate = null, condition, followupOf = null } = body;
      if (!['clear', 'blocked', 'unknown'].includes(rks) || !['good', 'damaged', 'unknown'].includes(condition)) {
        throw new RequestError(400, 'RKS ve fiziksel kontrol sonucunu seçin.');
      }
      if (expiryDate !== null) dateField(expiryDate, { type: 'date', label: 'Ürün üzerindeki SKT' });
      if (followupOf !== null && (typeof followupOf !== 'string' || !trace.uuidPattern.test(followupOf))) {
        throw new RequestError(400, 'Geçerli bir ek kontrol talebi seçin.');
      }
      const requestId = await traceControls.addControl(access, session.email, { id: product._id, ...traceKey(product) }, {
        choice: body.choice, note: requiredText(body, 'reason', 'Kontrol gerekçesi', 1000),
        location: requiredText(body, 'location', 'Kontrol konumu', 150), followupOf,
        checks: { rks, expiryDate, condition, expired: expiryDate ? expiryDate < currentMinute().slice(0, 10) : null },
      });
      return json(response, 201, { requestId });
    }
    if (request.method === 'POST' && path === '/api/trace/review') {
      if (!access.canReview) throw new RequestError(403, 'Karar inceleme yetkisi gerekir.');
      const body = await readJson(request);
      if (typeof body.id !== 'string' || !trace.uuidPattern.test(body.id)) throw new RequestError(400, 'Geçerli bir karar talebi seçin.');
      await traceControls.reviewControl(access, session.email, body.id, body.outcome, requiredText(body, 'reason', 'İnceleme gerekçesi', 1000));
      return json(response, 200, { saved: true });
    }
    if (request.method === 'POST' && path === '/api/trace/warehouse-lots') {
      if (access.role !== 'company') throw new RequestError(403, 'Depo lot ataması firma adminine aittir.');
      const body = await readJson(request);
      if (typeof body.enabled !== 'boolean') throw new RequestError(400, 'Atama işlemi seçin.');
      const product = await scopedTraceProduct(body.productId, access);
      await traceAccess.assignWarehouseLot(access, session.email, traceKey(product), body.warehouseId, body.enabled);
      return json(response, 200, { saved: true });
    }
    if (request.method === 'POST' && ['/api/trace/movements', '/api/trace/recalls', '/api/trace/recalls/close'].includes(path)) {
      const movement = path === '/api/trace/movements';
      if (!movement && !access.canRecall) throw new RequestError(403, 'Geri çağırma için onay yetkisi gerekir.');
      if (movement && !access.stages.length) throw new RequestError(403, 'Hareket kaydı için yetkiniz yok.');
      const body = await readJson(request);
      const note = requiredText(body, 'note', movement ? 'Hareket açıklaması' : 'Geri çağırma gerekçesi', 1000);
      if (path === '/api/trace/recalls/close') {
        if (typeof body.recallId !== 'string' || !trace.uuidPattern.test(body.recallId)) throw new RequestError(400, 'Geçerli bir geri çağırma seçin.');
        await trace.closeRecall(body.recallId, access.storeIds, session.email, note);
        return response.writeHead(204, { 'Cache-Control': 'no-store' }).end();
      }
      const product = await scopedTraceProduct(body.productId, access);
      if (!movement) return json(response, 201, { id: await trace.openRecall(traceKey(product), session.email, note) });
      const { id, stage, quantity = null } = body;
      if (typeof id !== 'string' || !trace.uuidPattern.test(id) || !trace.isTraceStage(stage)) {
        throw new RequestError(400, 'Geçerli bir hareket kimliği ve aşama seçin.');
      }
      if (!access.stages.includes(stage)) throw new RequestError(403, 'Bu hareket aşaması yetkiniz dışında.');
      if (quantity !== null && (!Number.isInteger(quantity) || quantity < 1 || quantity > 2147483647)) {
        throw new RequestError(400, 'Miktar pozitif bir tam sayı olmalıdır.');
      }
      const location = requiredText(body, 'location', 'Konum', 150);
      const origin = body.origin == null || body.origin === '' ? null : requiredText(body, 'origin', 'Çıkış konumu', 150);
      const inserted = await trace.addMovement(traceKey(product), session.email, { id, stage, quantity, origin, location, note, warehouseId: access.warehouseId });
      return json(response, inserted ? 201 : 200, { id });
    }
    throw new RequestError(404, 'İstek adresi bulunamadı.');
  }

  function scanLot(recordsForBarcode, lot, settings, now, recalls) {
    const lotRecords = recordsForBarcode.filter(item => item.lot === lot);
    const product = lotRecords.find(item => item.type === 'SKT') ?? lotRecords[0];
    if (!product) return null;
    const expiryDate = lotRecords.map(item => item.details?.expiryDate).filter(Boolean).sort()[0] ?? null;
    const rksBlocked = recordsForBarcode.some(item => item.type === 'RKS Blokaj' && (item.lot === lot || settings.blockRksAcrossLots));
    const blocked = rksBlocked || lotRecords.some(item => productRisk(item, now, settings)?.blocks) ||
      recalls?.has(trace.traceLotKey(traceKey(product)));
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
    const options = { $in: trace.barcodeVariants(code) };
    const matches = await records.find({ ...accessScope(session), $or: [{ code: options }, { productCode: options }] })
      .sort({ createdAt: -1, _id: -1 }).toArray();
    const found = [];
    for (const barcode of new Set(matches.map(item => trace.traceBarcode(item.code)))) {
      const [entries, recalls] = await Promise.all([
        records.find({ ...accessScope(session), code: { $in: trace.barcodeVariants(barcode) } }).sort({ createdAt: -1, _id: -1 }).toArray(),
        trace.openRecallKeys(coreRecallScope(session), barcode),
      ]);
      for (const lot of new Set(entries.map(item => item.lot))) found.push(scanLot(entries, lot, settings, now, recalls));
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
    const recordsForBarcode = await records.find({ ...storeScope(productStore(product)), code: { $in: trace.barcodeVariants(product.code) } }).toArray();
    const lot = scanLot([product, ...recordsForBarcode.filter(record => record._id !== product._id)], product.lot, await getSettings(), now);
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
    const writeOptions = action.guarded ? { beforeUpdate: client => trace.assertNoRecall(client, traceKey(product)) } : undefined;
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
      const scope = { ...storeScope(productStore(product)), code: { $in: trace.barcodeVariants(product.code) } };
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
    else if (proposal?.source) decision.source = proposal.source;
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
      }, writeOptions);
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
    const result = await records.updateOne(filter, change, writeOptions);
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
    const { choice, kind, destination, actor, scanCheck, source } = product.proposal;
    if (body.outcome === 'approve') {
      await saveDecision(id, { choice, kind, destination, staff: session.email, reason }, session, body.proposalId);
      return;
    }
    const result = await records.updateOne(filter, {
      $unset: { proposal: '' },
      $push: { decisions: { choice, reason, kind: 'review', result: 'Reddedildi', actor: session.email, staff: session.email, requestedBy: actor, time: new Date(),
        ...(source && { source }),
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
    if (path === '/api/trace' || path.startsWith('/api/trace/')) return handleTrace(request, response, path, session);
    if (session.role === 'trace') throw new RequestError(403, 'Bu hesap MU TRACE’e erişebilir.');
    if (path === '/api/scan' || path.startsWith('/api/scan/')) {
      if (!scanEnabled()) throw new RequestError(404, 'Bu modül şu anda kullanıma açık değil.');
      return handleScan(request, response, path, session, new URL(request.url, 'http://localhost').searchParams);
    }
    if (request.method === 'GET' && path === '/api/context') {
      const { email, displayName, role, canApprove, canChangePassword, storeId } = session;
      const locations = role === 'admin' ? await storeList() : [
        storeId === pilotStore.id ? pilotStore : { id: storeId, name: (await stores.findOne({ _id: storeId }))?.name ?? storeId },
      ];
      const assignment = role === 'staff' ? (await users.findOne({ _id: email }))?.staffDepartment : undefined;
      const jobTitle = Object.hasOwn(staffJobTitles, assignment) ? staffJobTitles[assignment] : undefined;
      json(response, 200, { email, displayName, role, title: panels[role], canApprove, canChangePassword, storeId, stores: locations,
        jobTitle, staffDepartments: role !== 'staff' ? staffJobTitles : undefined, scanEnabled: scanEnabled() });
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
