const { createHash, randomBytes, scrypt, timingSafeEqual } = require('node:crypto');
const { promisify } = require('node:util');
const { operations, saleApproval, assessments, crossDock, hotSale, recipeControl, recipeCompliance } = require('../operations.cjs');
const { CatalogError, catalogDetails, readCatalogCsv } = require('./pilot-catalog.cjs');

function createCore(database, challenge, { scanEnabled, crossDockEnabled, testerEmail }, trace, traceAccess, traceControls, mobileAccess, notifications) {
  const { Table, newRecordId, createSession, findSession, deleteSession, revokeSessions, ensureSchema, transaction, query } = database;
  const { createChallenge, challengeImage, verifyChallenge, allowLoginRequest } = challenge;
  const records = new Table('products');
  const users = new Table('accounts');
  const passwordOverrides = new Table('account_password_overrides');
  const stores = new Table('stores');
  const settingsCollection = new Table('system_settings');
  const departmentOptions = new Table('department_options');
  const pilotCatalog = new Table('pilot_catalog');
  const evidenceBodyLimit = 720_000;
  const evidenceCategories = new Set(['Hasarlı ambalaj', 'Ürün etiketi', 'SKT bilgisi', 'Teşhir fotoğrafı']);
  const pilotStore = { id: 'pilot', name: 'Pilot Mağaza' };
  const panels = { admin: 'MuTerminal Admin', manager: 'MuTerminal Manager', staff: 'MuTerminal Staff' };
  const defaultPilotPassword = '1234567890';
  const pilotPasswordRevision = process.env.MUTERMINAL_PILOT_PASSWORD_REVISION?.trim();
  const warehouseEmail = 'depo@muterminal.com';
  const auditorEmail = 'denetci@muterminal.com';
  const localPilotDefaults = process.env.VERCEL !== '1'
    && !process.env.MUTERMINAL_PUBLIC_ORIGIN?.startsWith('https://');
  const defaultSettings = { expiryWarningDays: 7, blockRksAcrossLots: false, productSource: 'Manuel ürün girişi', erpEndpoint: '', wmsEndpoint: '' };
  const derivePassword = promisify(scrypt);
  const kasaDepartments = {
    'unlu-mamuller': 'Pastacılık',
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
    'kasa-reyon': 'Kasa Reyonu',
    kasap: 'Kasap',
    sarkuteri: 'Şarküteri',
    'meyve-sebze': 'Meyve ve Sebze',
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
    'Kedi Ürünleri', 'Köpek Ürünleri', 'Diğer Hayvan Ürünleri', 'Çaylar', 'Kahveler',
  ]) {
    kasaDepartments[departmentOptionId('kasa-reyon', name)] = name;
  }
  const builtInDepartments = {
    'kasa-reyon': kasaDepartments,
    'unlu-mamuller-reyon': Object.fromEntries(
      ['Simit+', 'Kruvasan+', 'Börek'].map(name => [departmentOptionId('unlu-mamuller-reyon', name), name]),
    ),
  };
  const accounts = new Map([
    [testerEmail, process.env.MUTERMINAL_TESTER_PASSWORD, 'tester123!', Object.keys(panels), true],
    [process.env.MUTERMINAL_ADMIN_EMAIL ?? 'admin@muterminal.com', process.env.MUTERMINAL_ADMIN_PASSWORD, defaultPilotPassword, Object.keys(panels), process.env.MUTERMINAL_ADMIN_CAN_APPROVE !== 'false'],
    ['yonetici@muterminal.com', process.env.MUTERMINAL_MANAGER_PASSWORD, defaultPilotPassword, ['manager'], false, true],
  ].filter(([, password]) => password || localPilotDefaults).map(([email, configuredPassword, fallback, roles, canApprove, changeable = false]) => [email.trim().toLowerCase(), {
    email: email.trim().toLowerCase(), password: configuredPassword || fallback, roles, canApprove, changeable, storeId: pilotStore.id,
    passwordRevision: configuredPassword ? pilotPasswordRevision : undefined,
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

  async function readBody(request, limit = 16_384) {
    const chunks = [];
    let size = 0;
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) {
        request.resume();
        throw new RequestError(413, 'Gönderilen veri çok büyük.');
      }
      chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
  }

  async function readJson(request, limit) {
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
      throw new RequestError(415, 'Kayıt verisi JSON biçiminde olmalıdır.');
    }
    const text = await readBody(request, limit);
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

  function canSignInToWarehouse(account) {
    return account?.builtIn && account.roles.includes('admin');
  }

  async function getSession(request, panel) {
    const token = sessionToken(request);
    if (!token) return;
    const stored = await findSession(token);
    if (!stored) return;
    if (stored.payload.role === 'trace') {
      if (stored.payload.coreWarehouseId) {
        const account = await activeAccount(stored.payload.email);
        if (!canSignInToWarehouse(account) || stored.credential_tag !== credentialTag(account)) return;
        return pilotPanelSession(account, stored.payload, panel);
      }
      if ([warehouseEmail, auditorEmail].includes(stored.payload.email)) await seedTraceAccounts();
      const account = await traceAccess.activeTraceAccount(stored.payload.email);
      if (account && stored.credential_tag === traceCredentialTag(account)) {
        const { role, tenantId, storeId, warehouseId, control, review } = account;
        return { ...stored.payload, scope: { role, tenantId, storeId, warehouseId, control, review } };
      }
      return;
    }
    const account = await activeAccount(stored.payload.email);
    if (account && stored.credential_tag === credentialTag(account)) {
      return canSignInToWarehouse(account) ? pilotPanelSession(account, stored.payload, panel) : stored.payload;
    }
  }

  async function pilotPanelSession(account, payload, panel) {
    if (panel === 'depo' || (!panel && payload.coreWarehouseId)) {
      const scope = await traceAccess.warehouseSignInScope(account.storeId, payload.coreWarehouseId ?? 'pilot-depo');
      if (!scope) return;
      return {
        ...payload, role: 'trace', scope, coreWarehouseId: scope.warehouseId, canApprove: false,
        canSwitchPanels: true,
      };
    }
    const role = panel === 'trace' || payload.coreWarehouseId ? 'admin' : payload.role;
    return {
      ...payload, ...coreSessionPayload(account, Object.hasOwn(panels, panel) ? panel : role, payload.mobile),
      canSwitchPanels: true,
    };
  }

  function redirect(response, path, cookie) {
    const headers = { Location: path, 'Cache-Control': 'no-store' };
    if (cookie) headers['Set-Cookie'] = cookie;
    response.writeHead(303, headers).end();
  }

  async function signIn(request, response, destination, payload, tag) {
    const previous = sessionToken(request);
    if (previous) await deleteSession(previous);
    const token = randomBytes(32).toString('base64url');
    await createSession(token, payload.email, new Date(Date.now() + sessionSeconds * 1000), tag, payload);
    redirect(response, destination, sessionHeader(request, token, sessionSeconds));
  }

  function coreSessionPayload(account, role, mobile) {
    return {
      email: account.email, displayName: account.displayName, role, storeId: account.storeId,
      mobile,
      canApprove: role === 'manager' || (role === 'admin' && account.canApprove),
      canChangePassword: role === 'manager' && (!accounts.has(account.email) || account.changeable === true),
    };
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
    if (role === 'manager' && isRecordId(requestId)) query.set('talep', requestId);
    if (mobile) query.set('mobil', '1');
    return `/?${query}#admin-giris`;
  }

  function isRecordId(value) {
    return typeof value === 'string' && /^[0-9a-f]{24}$/.test(value);
  }

  async function serveApi(request, response, path) {
    try {
      const method = request.method;
      if (path === '/api/notifications/dispatch' && (method === 'GET' || method === 'POST')) {
        if (!notifications.authorizedDispatch(request.headers.authorization)) throw new RequestError(401, 'Yetkisiz istek.');
        json(response, 200, await notifications.dispatchNotifications());
        return;
      }
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
        const issued = await createChallenge(request);
        if (!issued) throw new RequestError(429, 'Çok fazla doğrulama isteği gönderildi. Biraz bekleyip tekrar deneyin.');
        json(response, 200, issued);
        return;
      }
      const challenge = path.match(/^\/api\/session\/challenge\/([0-9a-f]{32})\.bmp$/);
      if (challenge && (method === 'GET' || method === 'HEAD')) {
        const image = await challengeImage(challenge[1]);
        if (!image) throw new RequestError(404, 'Doğrulama görseli bulunamadı.');
        sendContent(response, 'image/bmp', image);
        return;
      }
      const tracePath = path === '/api/trace' || path.startsWith('/api/trace/');
      const notificationPath = path === '/api/notifications';
      const scanPath = path === '/api/scan' || path.startsWith('/api/scan/');
      const evidencePath = path.startsWith('/api/products/') && path.includes('/evidence/');
      const panel = request.headers['x-muterminal-panel']
        ?? (evidencePath ? new URL(request.url, 'http://localhost').searchParams.get('panel') : null);
      const corePanel = typeof panel === 'string' && Object.hasOwn(panels, panel) ? panel : undefined;
      const session = await getSession(request, tracePath || (notificationPath && ['trace', 'depo'].includes(panel)) ? panel === 'depo' ? 'depo' : 'trace'
        : scanPath ? 'staff' : corePanel);
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
      if (notificationPath) {
        if (method === 'GET') {
          json(response, 200, await notifications.deviceSettings(session, request.headers['x-muterminal-push-id'], sessionToken(request)));
          return;
        }
        if (method === 'POST') {
          if (!notifications.pushConfiguration()) throw new RequestError(503, 'Bildirimler şu anda kapalı.');
          const saved = await notifications.saveDevice(session, sessionToken(request), await readJson(request), request.headers.cookie, mobile);
          if (!saved) throw new RequestError(400, 'Geçerli bir cihaz aboneliği veya bildirim türü seçin.');
          response.writeHead(204).end();
          return;
        }
        if (method === 'DELETE') {
          await notifications.removeDevice(session, request.headers['x-muterminal-push-id']);
          response.writeHead(204).end();
          return;
        }
      }
      if (method === 'POST' && (path === '/api/session/password' ||
          (path === '/api/manager/password' && session.role === 'manager'))) {
        await changeOwnPassword(request, response, session);
        return;
      }
      await handleApi(request, response, path, session);
    } catch (error) {
      if (error instanceof RequestError || error instanceof CatalogError || error instanceof trace.TraceError) {
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
    if (username === auditorEmail) return null;
    const builtIn = accounts.get(username);
    if (builtIn) {
      await ensurePilotAccounts();
      const account = await users.findOne({ _id: username, active: true, builtIn: true });
      const override = builtIn.changeable && await passwordOverrides.findOne({ _id: username });
      return account ? { ...account, ...(override || {}), roles: builtIn.roles, canApprove: builtIn.canApprove, hasPasswordOverride: Boolean(override) } : null;
    }
    return username ? users.findOne({ _id: username, active: true, builtIn: { $in: [null, false] } }) : null;
  }

  function ensurePilotAccounts() {
    pilotAccountsReady ??= (async () => {
      for (const { password, passwordRevision, ...account } of accounts.values()) {
        const saved = await users.findOne({ _id: account.email });
        if (saved && !saved.builtIn) throw new Error('The existing account conflicts with a reserved pilot username.');
        if (saved?.builtIn && (!passwordRevision || saved.passwordRevision === passwordRevision)) continue;
        const credentials = await passwordCredentials(password);
        if (passwordRevision) {
          await ensureSchema();
          await transaction(async client => {
            const result = await client.query(`
              INSERT INTO accounts (id, document) VALUES ($1, $2)
              ON CONFLICT (id) DO UPDATE SET document = accounts.document || $3::jsonb
              WHERE accounts.document->>'builtIn' = 'true'
                AND accounts.document->>'passwordRevision' IS DISTINCT FROM $4
            `, [account.email, JSON.stringify({ ...account, ...credentials, passwordRevision, active: true, builtIn: true }),
              JSON.stringify({ ...credentials, passwordRevision }), passwordRevision]);
            if (result.rowCount) {
              await client.query('DELETE FROM account_password_overrides WHERE id = $1', [account.email]);
            }
          });
          continue;
        }
        try {
          await users.insertOne({ _id: account.email, ...account, ...credentials, active: true, builtIn: true });
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
    return actual.length === expected.length && timingSafeEqual(actual, expected);
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
    const traceSession = session.role === 'trace' && !session.coreWarehouseId;
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
    if (!await allowLoginRequest(request, 'attempt')) {
      return redirect(response, loginDestination(chosenPanel, requestId, 'limit', mobile));
    }
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
    let destination = mobile ? '/mobil' : `/${role}`;
    if (scanEnabled({ email: account.email, canSwitchPanels: canSignInToWarehouse(account) })) {
      if (role === 'staff' && !mobile) destination = '/staff/scan';
      if (role === 'manager' && isRecordId(requestId)) destination = `/manager?talep=${requestId}${mobile ? '&mobil=1' : ''}#talep-${requestId}`;
    }
    await signIn(request, response, destination, coreSessionPayload(account, role, mobile), credentialTag(account));
  }

  function seedTraceAccounts() {
    traceAccountsReady ??= (async () => {
      const warehousePassword = process.env.MUTERMINAL_TRACE_PILOT_WAREHOUSE_PASSWORD;
      const auditorPassword = process.env.MUTERMINAL_TRACE_PILOT_AUDITOR_PASSWORD;
      const superPassword = process.env.MUTERMINAL_TRACE_SUPER_PASSWORD;
      const superEmail = process.env.MUTERMINAL_TRACE_SUPER_EMAIL?.trim().toLowerCase();
      const seeds = [
        [warehousePassword, { email: warehouseEmail, displayName: 'Depo Görevlisi', role: 'warehouse',
          tenantId: 'pilot', storeId: 'pilot', warehouseId: 'pilot-depo' }, pilotPasswordRevision],
        [auditorPassword, { email: auditorEmail, displayName: 'Denetçi', role: 'auditor',
          tenantId: 'pilot', storeId: null, warehouseId: null }, pilotPasswordRevision],
        [superEmail && superPassword, { email: superEmail, displayName: 'MuTerminal Süper Admin', role: 'super',
          tenantId: null, storeId: null, warehouseId: null }],
      ];
      for (const [password, account, revision] of seeds) {
        if (password) await traceAccess.seedTraceAccount(
          { ...account, ...await passwordCredentials(password), active: true, control: false, review: false },
          revision,
        );
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
    const warehouse = fields.get('panel') === 'depo';
    const returnParams = `${mobile ? '&mobil=1' : ''}${warehouse ? '&panel=depo' : ''}`;
    if (!await allowLoginRequest(request, 'attempt')) return redirect(response, `/trace?giris=limit${returnParams}`);
    if (!await verifyChallenge(fields.get('challengeId'), fields.get('challengeAnswer'))) return redirect(response, `/trace?giris=dogrulama${returnParams}`);
    await seedTraceAccounts();
    const email = fields.get('email')?.trim().toLowerCase();
    const password = fields.get('password');
    const destination = warehouse ? (mobile ? '/mobil?panel=depo' : '/trace?panel=depo') : mobile ? '/mobil' : '/trace';
    const traceAccount = email && !accounts.has(email) && await traceAccess.activeTraceAccount(email);
    const validTracePassword = await matchesPassword(traceAccount, password);
    if (validTracePassword && (!warehouse || traceAccount.role === 'warehouse')) {
      const { email, displayName, storeId } = traceAccount;
      await signIn(request, response, destination,
        { email, displayName, role: 'trace', storeId: storeId ?? '', canApprove: false, mobile }, traceCredentialTag(traceAccount));
      return;
    }
    const account = await activeAccount(email);
    const role = account?.roles?.find(candidate => Object.hasOwn(panels, candidate));
    if (!role || !await matchesPassword(account, password)) {
      return redirect(response, `/trace?giris=${validTracePassword ? 'yetki' : 'bilgi'}${returnParams}`);
    }
    if (warehouse) {
      if (!canSignInToWarehouse(account)) return redirect(response, `/trace?giris=yetki${returnParams}`);
      const scope = await traceAccess.warehouseSignInScope(account.storeId, 'pilot-depo');
      if (!scope) return redirect(response, `/trace?giris=depo${returnParams}`);
      const { email, displayName, storeId } = account;
      await signIn(request, response, destination,
        { email, displayName, role: 'trace', storeId, canApprove: false, mobile, coreWarehouseId: scope.warehouseId }, credentialTag(account));
      return;
    }
    await signIn(request, response, destination, coreSessionPayload(account, role, mobile), credentialTag(account));
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
    return Object.entries(departmentMainNames).map(([id, name]) => {
      const known = builtInDepartments[id] ?? {};
      return {
        id, name,
        children: [
          ...Object.entries(known).map(([childId, childName]) => ({ id: childId, name: childName })),
          ...extras.filter(item => item.parentId === id && !Object.hasOwn(known, item._id))
            .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
            .map(item => ({ id: item._id, name: item.name })),
        ],
      };
    });
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

  async function insertManagedAccount(body, permissions) {
    const email = requiredUsername(body);
    if (accounts.has(email) || email === warehouseEmail || email === auditorEmail) throw new RequestError(409, 'Bu kullanıcı adı zaten kayıtlı.');
    const displayName = permissions.roles.includes('staff') || body.displayName
      ? requiredText(body, 'displayName', 'Ad soyad', 100) : undefined;
    const credentials = await passwordCredentials(body.password);
    await users.insertOne({ _id: email, email, ...credentials, ...permissions, ...(displayName && { displayName }), active: true });
  }

  function requiredStaffDepartment(value) {
    if (typeof value === 'string' && Object.hasOwn(staffJobTitles, value)) return value;
    throw new RequestError(400, 'Personel için dört iş unvanından birini seçin.');
  }

  async function handleManagerAccounts(request, response, path, session) {
    const admin = session.role === 'admin';
    if (!admin && session.role !== 'manager') throw new RequestError(403, 'Personel yönetimi için admin veya yönetici yetkisi gerekir.');
    const staffScope = { roles: ['staff'], builtIn: { $in: [null, false] }, ...(!admin && { storeId: session.storeId }) };
    if (request.method === 'GET' && path === '/api/manager/staff') {
      const list = await users.find(staffScope, {
        projection: { _id: 0, email: 1, displayName: 1, active: 1, staffDepartment: 1, storeId: 1 },
      }).sort({ displayName: 1, email: 1 }).toArray();
      json(response, 200, list);
      return;
    }
    if (request.method !== 'POST') throw new RequestError(404, 'Personel işlemi bulunamadı.');
    const body = await readJson(request);
    if (path === '/api/manager/staff') {
      const staffDepartment = requiredStaffDepartment(body.staffDepartment);
      const storeId = admin ? await requiredStore(body.storeId) : session.storeId;
      await insertManagedAccount(body, { roles: ['staff'], storeId, canApprove: false, staffDepartment });
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
      } else if (field.type === 'select') {
        if (!field.options.includes(value)) throw new RequestError(400, `${field.label} için geçerli bir seçenek seçin.`);
        details[field.name] = value;
      } else {
        details[field.name] = dateField(value, field);
      }
    }
    return details;
  }

  async function requiredDepartment(department) {
    if (typeof department === 'string') {
      if (Object.hasOwn(departmentMainNames, department) ||
          Object.values(builtInDepartments).some(children => Object.hasOwn(children, department))) return department;
      if (/^alt-[0-9a-f]{24}$/.test(department) && await departmentOptions.findOne({ _id: department })) return department;
    }
    throw new RequestError(400, 'Geçerli bir reyon seçin.');
  }

  function operationEnabled(type) {
    return type !== crossDock || crossDockEnabled();
  }

  function requireEnabledOperation(type) {
    if (!operationEnabled(type)) throw new RequestError(409, 'Cross-Dock sonraki geliştirme aşamasında kullanıma açılacak.');
  }

  function readEvidence(value, session) {
    if (value === undefined) return;
    if (!value || !evidenceCategories.has(value.category) || typeof value.photo !== 'string') {
      throw new RequestError(400, 'Geçerli bir kanıt türü ve fotoğrafı seçin.');
    }
    const photo = Buffer.from(value.photo, 'base64');
    if (photo.length < 4 || photo.length > 524288 || photo.toString('base64') !== value.photo ||
        photo[0] !== 0xff || photo[1] !== 0xd8 || photo[2] !== 0xff || photo.readUInt16BE(photo.length - 2) !== 0xffd9) {
      throw new RequestError(400, 'Kanıt fotoğrafı en fazla 512 KB boyutunda bir JPEG olmalıdır.');
    }
    const reference = { id: newRecordId(), category: value.category };
    return {
      reference,
      afterWrite: (client, productId) => client.query(
        'INSERT INTO product_evidence (id, product_id, actor, photo) VALUES ($1, $2, $3, $4)',
        [reference.id, productId, session.email, photo],
      ),
    };
  }

  async function showEvidence(response, session, productId, evidenceId) {
    const product = await records.findOne({ _id: productId, ...accessScope(session) }, { projection: { _id: 1 } });
    const result = product && await query(
      'SELECT photo FROM product_evidence WHERE id = $1 AND product_id = $2 AND ($3::text IS NULL OR actor = $3)',
      [evidenceId, productId, session.role === 'staff' ? session.email : null],
    );
    const photo = result?.rows[0]?.photo;
    if (!photo) throw new RequestError(404, 'Kanıt fotoğrafı bulunamadı.');
    response.writeHead(200, {
      'Content-Type': 'image/jpeg', 'Content-Length': photo.length, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
    }).end(photo);
  }

  async function newProduct(body) {
    const name = requiredText(body, 'name', 'Ürün adı', 150);
    const code = requiredText(body, 'code', 'Barkod', 80);
    const lot = requiredText(body, 'lot', 'Lot', 80);
    const { type, expired } = body;
    if (!Object.hasOwn(operations, type)) throw new RequestError(400, 'Geçerli bir operasyon seçin.');
    requireEnabledOperation(type);
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
    if (operations[product.type]?.workflow) return null;
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
    if (!product.details || !operationEnabled(product.type)) return [];
    return operations[product.type].actions.filter(action => (
      action.choice !== saleApproval &&
      (!action.from || action.from.includes(product.status)) &&
      (!action.guarded || !risk?.blocks) &&
      (!action.releaseTemporary || (product.locked && temporaryBlockEnded(product, now)))
    ));
  }

  function matchesAssessment(product, action) {
    return !operations[product.type]?.workflow &&
      (!action.operation || (product.type === action.operation && product.details && action.from.includes(product.status)));
  }

  function workflowChoice(type, details) {
    if (type === hotSale) return details.saleAction;
    if (type === recipeControl) {
      const verified = operations[type].fields.every(({ name }) => details[name] === 'Uygun' ||
        (name === 'temperatureCheck' && details[name] === 'Uygulanmaz' && !details.recipe.temperatureRequired));
      return verified ? recipeCompliance : 'Reçete uygunsuzluğu incelemesi';
    }
    return [details.displayCondition, details.displayLabel, details.displayPlacement].every(value => value === 'Uygun')
      ? 'Teşhir uygunluğu onayı' : 'Teşhir düzeltme talebi';
  }

  function pendingDecision(decision) {
    const requestId = newRecordId();
    const entry = { ...decision, requestId, requestStatus: 'pending', result: 'Onay bekliyor' };
    return { proposal: { ...entry, id: requestId }, log: { ...entry, kind: 'proposal' } };
  }

  function lockProductBarcode(client, product) {
    const key = JSON.stringify([productStore(product), trace.traceBarcode(product.code)]);
    return client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['mu-product:' + key]);
  }

  function recipeRevision(recipe) {
    return hashText(JSON.stringify([recipe.code, recipe.allergens, recipe.temperatureRequired,
      recipe.components.map(({ name, amount, unit }) => [name, amount, unit])])).toString('hex');
  }

  function catalogKey(product) {
    return JSON.stringify([productStore(product), trace.traceBarcode(product.code)]);
  }

  async function lockedCatalog(client, product) {
    const { rows } = await client.query('SELECT document FROM pilot_catalog WHERE id = $1 FOR SHARE', [catalogKey(product)]);
    return rows[0]?.document;
  }

  function assertCurrentRecipe(catalog, product, revision) {
    if (!catalog?.recipe || catalog.name !== product.name || recipeRevision(catalog.recipe) !== revision) {
      throw new RequestError(409, 'Güncel reçete kartını MuScan Lite ile açıp kontrolü yeniden başlatın.');
    }
  }

  function assertRecipeChecklist(details) {
    if (details.recipe.temperatureRequired && details.temperatureCheck === 'Uygulanmaz') {
      throw new RequestError(400, 'Bu reçete için sıcaklık kontrolü zorunludur.');
    }
  }

  async function relatedProductRecords(client, product) {
    const { rows } = await client.query(`
      SELECT document FROM products
      WHERE (store_id = $1 OR ($1 = 'pilot' AND store_id IS NULL)) AND barcode = ANY($2::text[])
        AND (lot = $3 OR document->>'type' = 'RKS Blokaj')
      ORDER BY id FOR SHARE`, [productStore(product), trace.barcodeVariants(product.code), product.lot]);
    return rows.map(row => row.document).filter(entry => !entry.scanExample && !operations[entry.type]?.workflow);
  }

  async function validateRecipeLot(client, product) {
    await lockProductBarcode(client, product);
    await trace.assertNoRecall(client, traceKey(product));
    const related = await relatedProductRecords(client, product);
    const now = currentMinute();
    if (product.expired || related.some(entry => productRisk(entry, now)?.blocks)) {
      throw new RequestError(409, 'Bu lot veya ürün için açık risk var. Yönetici incelemesi için ilgili kontrolü uygunsuz olarak işaretleyin.');
    }
  }

  async function validateHotSale(client, product, creating = false) {
    const { expiryDate, saleCondition } = product.details;
    const now = currentMinute();
    if (product.expired || expiryDate < now.slice(0, 10) || saleCondition !== 'Satışa uygun') {
      throw new RequestError(409, 'SKT’si geçmiş veya fiziksel olarak satışa uygun olmayan ürün için talep oluşturulamaz.');
    }
    await lockProductBarcode(client, product);
    await trace.assertNoRecall(client, traceKey(product));
    const catalog = await lockedCatalog(client, product);
    if (catalog?.saleStatus !== 'sellable') {
      throw new RequestError(409, 'Pilot katalogda bu ürünün satışa uygunluğu doğrulanmalıdır.');
    }
    if (creating && product.name !== catalog.name) {
      throw new RequestError(409, 'Ürün adı pilot katalogla eşleşmelidir. MuScan Lite ile ürünü sorgulayın.');
    }
    const related = await relatedProductRecords(client, product);
    if (related.some(entry => productRisk(entry, now)?.blocks || ['Satılamaz', 'Depo İade', 'İncelemede'].includes(entry.assessment) ||
      ['Satılamaz', 'Ayrıldı', 'İadeye yönlendirildi'].includes(entry.status) || entry.type === 'Depo İade')) {
      throw new RequestError(409, 'Bu ürünün blokajı veya lotun satışa engel bir kaydı var.');
    }
    const recordedExpiry = related.filter(entry => entry.type === 'SKT')
      .map(entry => entry.details?.expiryDate).filter(Boolean).sort()[0];
    if (recordedExpiry !== expiryDate) {
      throw new RequestError(409, 'Girilen SKT bu lotun MuExpiry kaydıyla eşleşmelidir.');
    }
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
      const { _id, decisions, proposal, recheck, evidence, createdBy, ...product } = record;
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
      const workflow = operations[product.type]?.workflow;
      const canAct = (!workflow && !recheck) || (recheck?.actor === session.email && recheck.source !== 'scan');
      const actions = canAct ? availableActions(product, effectiveRisk, now).filter(action => session.canApprove || action.requestable) : [];
      const assessmentActions = canAct && operationEnabled(product.type)
        ? assessments.filter(action => matchesAssessment(product, action) && (!action.guarded || !effectiveRisk?.blocks))
        : [];
      const visibleProposal = session.role !== 'staff' || proposal?.actor === session.email ? proposal : undefined;
      const owner = session.role !== 'staff' || createdBy === session.email ? createdBy : undefined;
      const visibleRecheck = session.role !== 'staff' || recheck?.actor === session.email ? recheck : undefined;
      const visibleEvidence = session.role !== 'staff' || owner ? evidence : undefined;
      const expiry = product.details?.expiryDate;
      const daysToExpiry = expiry ? (Date.parse(expiry) - Date.parse(now.slice(0, 10))) / 86_400_000 : Infinity;
      const expiryRisk = product.expired || daysToExpiry < 0 ? 'SKT geçmiş'
        : product.type === 'SKT' && !expiry ? 'SKT bilgisi eksik'
        : daysToExpiry <= settings.expiryWarningDays ? (daysToExpiry ? `SKT’ye ${daysToExpiry} gün` : 'SKT bugün') : undefined;
      products.push({ id, ...product, storeId, createdBy: owner, proposal: visibleProposal, recheck: visibleRecheck,
        evidence: visibleEvidence, risk: effectiveRisk, expiryRisk, actions, assessmentActions });
      const { name, code, lot, department, type } = product;
      const baseLog = { id, name, code, lot, department, type, storeId };
      if (owner && product.createdAt) logs.push({ ...baseLog, actor: owner, staff: owner, time: product.createdAt,
        choice: 'Kontrol kaydı oluşturuldu', reason: '', result: 'Kaydedildi', evidence: visibleEvidence });
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
    if (access.role === 'auditor' && request.method !== 'GET' && request.method !== 'HEAD') {
      throw new RequestError(403, 'Denetçi erişimi salt okunurdur.');
    }
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

  function scanLot(recordsForBarcode, lot, settings, now, recalls, requester) {
    const lotRecords = recordsForBarcode.filter(item => item.lot === lot && !operations[item.type]?.workflow);
    const product = lotRecords.find(item => operationEnabled(item.type) && item.recheck?.source === 'scan' && item.recheck.actor === requester)
      ?? lotRecords.find(item => item.type === 'SKT') ?? lotRecords.find(item => operationEnabled(item.type));
    if (!product) return null;
    const expiryDate = lotRecords.map(item => item.details?.expiryDate).filter(Boolean).sort()[0] ?? null;
    const rksBlocked = recordsForBarcode.some(item => item.type === 'RKS Blokaj' && (item.lot === lot || settings.blockRksAcrossLots));
    const blocked = rksBlocked || lotRecords.some(item => productRisk(item, now, settings)?.blocks) ||
      recalls?.has(trace.traceLotKey(traceKey(product)));
    const quantity = product.type === 'Depo Fark' ? product.details?.systemStock : product.qty;
    const choices = !product.recheck || product.recheck.actor === requester
      ? assessments.filter(action => matchesAssessment(product, action) && (!action.guarded || !blocked)).map(action => action.choice)
      : [];
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
      for (const lot of new Set(entries.map(item => item.lot))) {
        const result = scanLot(entries, lot, settings, now, recalls, session.email);
        if (result) found.push(result);
      }
    }
    return { products: found, today: now.slice(0, 10) };
  }

  async function scanLite(request, response, session, importing) {
    const options = new URL(request.url, 'http://localhost').searchParams;
    const storeId = session.role === 'admin' && options.has('store')
      ? await requiredStore(options.get('store')) : session.storeId;
    if (importing) {
      requireAdmin(session);
      if (request.method !== 'POST') throw new RequestError(405, 'Bu yöntem desteklenmiyor.');
      const { csv } = await readJson(request, 512_000);
      const batch = readCatalogCsv(csv, trace.traceBarcode);
      await ensureSchema();
      const updated = await transaction(async client => {
        for (const product of batch.products.sort((a, b) => a.barcode.localeCompare(b.barcode))) {
          await client.query(`
            INSERT INTO pilot_catalog (id, document) VALUES ($1, $2)
            ON CONFLICT (id) DO UPDATE SET document = pilot_catalog.document || EXCLUDED.document`,
          [JSON.stringify([storeId, product.barcode]), JSON.stringify({ ...product, storeId })]);
        }
        let count = 0;
        const ordered = batch.snapshots.sort((a, b) => a.barcode.localeCompare(b.barcode) || a.warehouseCode.localeCompare(b.warehouseCode));
        for (const snapshot of ordered) {
          const result = await client.query(`
            INSERT INTO inventory_snapshots (store_id, barcode, warehouse_code, quantity, source_updated_at, imported_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (store_id, barcode, warehouse_code) DO UPDATE SET quantity = EXCLUDED.quantity,
              source_updated_at = EXCLUDED.source_updated_at, imported_by = EXCLUDED.imported_by, imported_at = now()
            WHERE inventory_snapshots.source_updated_at < EXCLUDED.source_updated_at`,
          [storeId, snapshot.barcode, snapshot.warehouseCode, snapshot.quantity, snapshot.sourceUpdatedAt, session.email]);
          count += result.rowCount;
        }
        return count;
      });
      return json(response, 200, { products: batch.products.length, snapshots: updated, skipped: batch.snapshots.length - updated });
    }
    if (request.method === 'POST') {
      requireAdmin(session);
      const body = await readJson(request);
      const barcode = trace.traceBarcode(requiredText(body, 'barcode', 'Barkod', 80));
      const name = requiredText(body, 'name', 'Ürün adı', 150);
      await pilotCatalog.updateOne({ _id: JSON.stringify([storeId, barcode]) },
        { $set: { ...catalogDetails(body), barcode, name, storeId } }, { upsert: true });
      return json(response, 200, { barcode, name });
    }
    if (request.method !== 'GET') throw new RequestError(405, 'Bu yöntem desteklenmiyor.');
    const code = requiredText({ code: options.get('code') }, 'code', 'Barkod', 80);
    let catalog = await pilotCatalog.findOne({ _id: JSON.stringify([storeId, trace.traceBarcode(code)]) });
    if (!catalog) {
      const { rows } = await query(`SELECT document FROM pilot_catalog
        WHERE document->>'storeId' = $1 AND document->>'productCode' = $2 LIMIT 2`, [storeId, code]);
      if (rows.length > 1) throw new RequestError(409, 'Bu ürün koduyla birden fazla kayıt var. Barkodla sorgulayın.');
      catalog = rows[0]?.document;
    }
    const barcode = catalog?.barcode ?? code;
    const barcodes = trace.barcodeVariants(barcode);
    const [matches, stock] = await Promise.all([
      records.find({ ...storeScope(storeId), code: { $in: barcodes } },
        { projection: { name: 1, code: 1, lot: 1, type: 1, status: 1, details: 1 } }).sort({ createdAt: -1, _id: -1 }).toArray(),
      query(`SELECT warehouse_code AS "warehouseCode", quantity, source_updated_at AS "sourceUpdatedAt"
        FROM inventory_snapshots WHERE store_id = $1 AND barcode = $2 ORDER BY warehouse_code`, [storeId, trace.traceBarcode(barcode)]),
    ]);
    const card = catalog && Object.fromEntries(['barcode', 'name', 'productCode', 'price', 'caseQuantity', 'priceValidFrom',
      'priceValidTo', 'orderStatus', 'saleStatus', 'recipe'].map(field => [field, catalog[field]]));
    if (card?.recipe) card.recipeRevision = recipeRevision(card.recipe);
    json(response, 200, {
      catalog: card ?? null, snapshots: stock.rows, storeId, barcodes,
      records: matches.map(({ _id, name, code, lot, type, status, details }) =>
        ({ id: _id, name, barcode: code, lot, type, status, expiryDate: details?.expiryDate ?? null })),
    });
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
      const body = await readJson(request, evidenceBodyLimit);
      if (!isRecordId(body.productId)) throw new RequestError(400, 'Geçerli bir ürün ve lot seçin.');
      const check = scanCheckDetails(body);
      const selected = await records.findOne({ _id: body.productId, ...accessScope(session) });
      if (!selected) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
      const { products } = await scanLookup(session, selected.code);
      const option = products.find(item => item.id === body.productId);
      if (!option || !option.choices.includes(body.choice)) throw new RequestError(409, 'Bu ürün ve lot için geçerli bir karar önerisi seçin.');
      const requestId = await saveDecision(body.productId, {
        choice: body.choice, reason: body.reason, kind: 'assessment', evidence: body.evidence,
      }, session, undefined, check);
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
    requireEnabledOperation(product.type);
    const operation = operations[product.type];
    const returned = product.recheck;
    const workflow = operation.workflow;
    if (workflow && (isAssessment || (!proposalId && returned?.actor !== session.email))) {
      throw new RequestError(409, 'Bu işlem MuApproval Lite üzerinden değerlendirilmelidir.');
    }
    const details = workflow && !proposalId ? operationDetails(operation, body.details ?? {}) : product.details;
    if (product.type === recipeControl) {
      if (!proposalId) details.recipe = product.details.recipe;
      assertRecipeChecklist(details);
    }
    const decisionChoice = workflow ? workflowChoice(product.type, details) : choice;
    const action = isAssessment
      ? assessments.find(option => option.choice === choice)
      : operationAction(product, decisionChoice);
    if (!action) throw new RequestError(400, 'Bu operasyon için geçerli bir karar seçin.');
    requireEnabledOperation(action.operation);
    const proposing = !session.canApprove || (!proposalId && (workflow || body.submitAsProposal === true));
    if (returned && (!proposing || returned.actor !== session.email || (returned.source === 'scan' && !scanCheck))) {
      throw new RequestError(409, 'Ek kontrolü talep sahibi kendi kontrol akışından yeniden göndermelidir.');
    }
    if (returned) filter['recheck.id'] = returned.id;
    else filter.recheck = null;
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
    const status = action.result ?? decisionChoice;
    filter.details = product.details ? { $exists: true } : { $exists: false };
    const update = isAssessment ? { assessment: status } : { status };
    const decision = { time: new Date(), choice: decisionChoice, result: status, staff, actor: session.email, reason };
    const evidence = readEvidence(body.evidence, session);
    if (evidence) decision.evidence = evidence.reference;
    else if (workflow && proposal?.evidence) decision.evidence = proposal.evidence;
    if (workflow) decision.details = details;
    const writeOptions = {
      beforeUpdate: product.type === hotSale ? client => validateHotSale(client, { ...product, details })
        : decisionChoice === recipeCompliance && product.type === recipeControl ? client => validateRecipeLot(client, product)
        : action.guarded ? client => trace.assertNoRecall(client, traceKey(product)) : undefined,
      afterWrite: evidence?.afterWrite,
    };
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
      if (returned) decision.followupOf = returned.id;
      const { proposal, log } = pendingDecision(decision);
      const change = {
        $set: { proposal, ...(workflow && { details, status: operation.initial }), ...(workflow && evidence && { evidence: evidence.reference }) },
        $push: { decisions: log },
      };
      if (returned) change.$unset = { recheck: '', ...(workflow && !evidence && { evidence: '' }) };
      const saved = await records.updateOne({ ...filter, proposal: null }, change, writeOptions);
      if (!saved.matchedCount) throw new RequestError(409, 'Kayıt değişti veya bu kayıt için zaten bekleyen bir talep var.');
      return proposal.id;
    }
    if (proposalId) {
      filter['proposal.id'] = proposalId;
      decision.requestedBy = product.proposal?.actor;
      decision.result = `Onaylandı · ${status}`;
      Object.assign(decision, { requestId: proposalId, requestStatus: 'approved', requestedAt: proposal?.time });
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
    if (!['approve', 'reject', 'recheck'].includes(body.outcome) || !isRecordId(body.proposalId)) {
      throw new RequestError(400, 'Geçerli bir talep ve karar seçin.');
    }
    const filter = { _id: id, ...accessScope(session), 'proposal.id': body.proposalId };
    const product = await records.findOne(filter);
    if (!product) throw new RequestError(404, 'Bekleyen talep bulunamadı.');
    requireEnabledOperation(product.type);
    const { choice, kind, destination, actor, scanCheck, source, details, evidence, time: requestedAt } = product.proposal;
    if (body.outcome === 'approve') {
      await saveDecision(id, { choice, kind, destination, staff: session.email, reason }, session, body.proposalId);
      return;
    }
    const recheck = body.outcome === 'recheck';
    const time = new Date();
    const resultLabel = recheck ? 'Ek kontrol istendi' : 'Reddedildi';
    const result = await records.updateOne(filter, {
      $unset: { proposal: '' },
      $set: { ...(operations[product.type].workflow && { status: resultLabel }),
        ...(recheck && { recheck: { id: body.proposalId, actor, choice, kind, reason, source, time } }) },
      $push: { decisions: { choice, reason, kind: 'review', result: resultLabel,
        actor: session.email, staff: session.email, requestedBy: actor, time, requestedAt,
        requestId: body.proposalId, requestStatus: recheck ? 'recheck' : 'rejected',
        ...(details && { details }), ...(evidence && { evidence }),
        ...(source && { source }), ...(scanCheck && { source: 'scan', scanCheck }) } },
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
    requireEnabledOperation(product.type);
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
    if (path === '/api/scan-lite' || path === '/api/scan-lite/import') return scanLite(request, response, session, path.endsWith('/import'));
    if (path === '/api/scan' || path.startsWith('/api/scan/')) {
      if (!scanEnabled(session)) throw new RequestError(404, 'Bu modül şu anda kullanıma açık değil.');
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
        jobTitle, staffDepartments: role !== 'staff' ? staffJobTitles : undefined, scanEnabled: scanEnabled(session) });
      return;
    }
    if (path.startsWith('/api/admin/')) return handleManagement(request, response, path, session);
    if (path.startsWith('/api/manager/')) return handleManagerAccounts(request, response, path, session);
    if (request.method === 'GET' && path === '/api/operations') {
      json(response, 200, crossDockEnabled() ? operations : {
        ...operations, [crossDock]: { ...operations[crossDock], disabled: true },
      });
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
      const body = await readJson(request, evidenceBodyLimit);
      const product = await newProduct(body);
      product.storeId = session.role === 'admin' ? await requiredStore(body.storeId ?? session.storeId) : session.storeId;
      product.createdBy = session.email;
      if (product.type === recipeControl) {
        const catalog = await pilotCatalog.findOne({ _id: catalogKey(product) });
        assertCurrentRecipe(catalog, product, body.recipeRevision);
        product.details.recipe = catalog.recipe;
        assertRecipeChecklist(product.details);
      }
      const evidence = readEvidence(body.evidence, session);
      if (evidence) product.evidence = evidence.reference;
      if (operations[product.type].workflow) {
        const reason = requiredText(body, 'reason', 'Personel açıklaması', 1000);
        const { proposal, log } = pendingDecision({
          time: product.createdAt, choice: workflowChoice(product.type, product.details), reason, details: product.details,
          staff: session.displayName ?? session.email, actor: session.email, ...(evidence && { evidence: evidence.reference }),
        });
        product.proposal = proposal;
        product.decisions.push(log);
      }
      const result = await records.insertOne(product, async (client, productId) => {
        if (product.type === hotSale) await validateHotSale(client, product, true);
        else if (product.type === recipeControl) {
          if (product.proposal.choice === recipeCompliance) await validateRecipeLot(client, product);
          assertCurrentRecipe(await lockedCatalog(client, product), product, body.recipeRevision);
        } else await lockProductBarcode(client, product);
        await evidence?.afterWrite(client, productId);
      });
      json(response, 201, { id: result.insertedId });
      return;
    }
    const evidence = path.match(/^\/api\/products\/([0-9a-f]{24})\/evidence\/([0-9a-f]{24})$/);
    if (request.method === 'GET' && evidence) return showEvidence(response, session, evidence[1], evidence[2]);
    const product = path.match(/^\/api\/products\/([0-9a-f]{24})$/);
    if (request.method === 'DELETE' && product) {
      requireAdmin(session);
      if (!crossDockEnabled()) requireEnabledOperation((await records.findOne({ _id: product[1] }))?.type);
      const result = await records.deleteOne({ _id: product[1] });
      if (!result.deletedCount) throw new RequestError(404, 'Ürün kaydı bulunamadı.');
      response.writeHead(204).end();
      return;
    }
    const decision = path.match(/^\/api\/products\/([0-9a-f]{24})\/decisions$/);
    if (request.method === 'POST' && decision) {
      await saveDecision(decision[1], await readJson(request, evidenceBodyLimit), session);
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
      const filter = { _id: reclassify[1], department: null, ...accessScope(session) };
      if (!crossDockEnabled()) requireEnabledOperation((await records.findOne(filter))?.type);
      const result = await records.updateOne(
        filter,
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
