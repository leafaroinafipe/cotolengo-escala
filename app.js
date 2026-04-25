// ============================================================
//  Cottolengo Escala — Mobile PWA — app.js v2.0
//  OPTIMIZADO PARA iOS + ANDROID
//  Lógica completa: Auth, Swipe, Calendário, Solicitações, Admin
// ============================================================

// ── CONFIG ────────────────────────────────────────────────────
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbw7Hzr4C0V7cIM0pnU7ehbT3rpiwg-BTBpb7hnkgzIICYIbf8tBHXdjw82bFzTVVh2XxA/exec';
const API_KEY = 'cotolengo_2026_secure_key';

// ── UTILS: SHA-256 Hash (para senhas) ───────────────────────
async function sha256(text) {
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    // Fallback para iOS em contextos não-HTTPS
    console.warn('crypto.subtle not available, using simple hash');
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }
}

// ── UTILS: Gerar ID único (com fallback iOS) ────────────────
function generateId() {
  try {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
  } catch (e) {
    console.warn('crypto.randomUUID not available');
  }
  // Fallback robusto
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 11);
  const random2 = Math.random().toString(36).substring(2, 11);
  return `${timestamp}-${random}-${random2}`;
}

// ── CACHE: localStorage com TTL por tipo (stale-while-revalidate) ─
const CACHE_PREFIX = 'cottolengo_cache_';
const CACHE_TTL = {
  Funcionarios:  60 * 60 * 1000,     // 1 hora — quase estático
  Escala:        10 * 60 * 1000,     // 10 min — muda quando admin publica
  Solicitacoes:  30 * 1000,          // 30 seg — alta frequência
  Usuarios:      10 * 60 * 1000      // 10 min
};

function cacheKey(name) { return CACHE_PREFIX + name; }

function cacheGet(name) {
  try {
    const raw = localStorage.getItem(cacheKey(name));
    if (!raw) return null;
    const obj = JSON.parse(raw);
    if (!obj || typeof obj.t !== 'number') return null;
    const ttl = CACHE_TTL[name] || 60 * 1000;
    const age = Date.now() - obj.t;
    return { data: obj.d, stale: age > ttl, age };
  } catch (e) { return null; }
}

function cacheSet(name, data) {
  try {
    localStorage.setItem(cacheKey(name), JSON.stringify({ t: Date.now(), d: data }));
  } catch (e) { console.warn('Cache set failed:', e.message); }
}

function cacheInvalidate(name) {
  try { localStorage.removeItem(cacheKey(name)); } catch (e) {}
}

const SHIFTS = {
  'M1': { name:'Mattina 1',     h:7.0,  color:'#f59e0b', text:'#1a1a00', period:'morning' },
  'M2': { name:'Mattina 2',     h:4.5,  color:'#fcd34d', text:'#1a1a00', period:'morning' },
  'MF': { name:'Mattina Festivo',h:7.5, color:'#f97316', text:'#fff',    period:'morning' },
  'G':  { name:'Giornata',     h:8,    color:'#0ea5e9', text:'#fff',    period:'morning' },
  'P':  { name:'Pomeriggio',       h:8,    color:'#8b5cf6', text:'#fff',    period:'afternoon' },
  'PF': { name:'Pomeriggio Festivo',h:7.5, color:'#a78bfa', text:'#fff',    period:'afternoon' },
  'N':  { name:'Notte',       h:9,    color:'#1e1b4b', text:'#fff',    period:'night'   },
  'OFF':{ name: 'Riposo', h: 0, color: 'rgba(255,255,255,0.03)', text: 'rgba(255,255,255,0.2)', period:'off' },
  'FE': { name: 'Ferie', h: 0, color: '#10b981', text: '#fff', period:'off' },
  'AT': { name:'Certificato',    h:0,    color:'#ef4444', text:'#fff',    period:'off'     },
};

const MONTH_NAMES = ['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'];
const DAY_NAMES = ['D','L','M','M','G','V','S'];

// ── STATE ─────────────────────────────────────────────────────
let currentUser = null;   // { id, nome, senha, role, nurseId }
let isAdmin = false;
let nurses = [];          // lista de enfermeiras (do Google Sheets "Funcionarios")
let schedule = {};        // key: nurseId_month_year_day → shiftCode
let requests = [];        // solicitações
let appUsers = [];        // usuários do app (do Google Sheets "Usuarios")

let currentMonth = new Date();
currentMonth.setDate(1);

let currentPage = 0;
let totalPages = 2; // 2 for users, 3 for admin
let statusFilter = 'all';
let nurseFilter = 'all';
let calNurseFilter = 'all'; // filtro de funcionário no calendário (admin)
let editingRequestId = null; // ID della richiesta in modifica (null = nuova richiesta)

// ── HELPERS: Normalizar dados do Sheet ───────────────────────
// Schema novo: id, nome, attivo, dataInicio, dataFim, cargaSemanal, notas
// Schema antigo: ID_Funcionario, Nome, Turno_Padrao, Carga_Horaria_Mensal (mantido por retrocompat)
function getNurseId(n)   { return n.id || n.ID_Funcionario || n.Id || n.ID || ''; }
function getNurseName(n) { return n.nome || n.name || n.Nome || n.Name || ''; }
function isNurseActive(n) {
  // Default = ativo. Só inativa se explicitamente attivo === 0 / "0" / false / "false" / "FALSE"
  if (n.attivo === undefined || n.attivo === null || n.attivo === '') return true;
  const v = String(n.attivo).trim().toLowerCase();
  return !(v === '0' || v === 'false' || v === 'no');
}
function normalizeNurses(rawList) {
  return rawList.map(n => ({
    id: String(getNurseId(n)),
    name: getNurseName(n),
    initials: (getNurseName(n)).split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase(),
    nightQuota: n.cargaSemanal || n.nightQuota || n.Carga_Horaria_Mensal || 5,
    attivo: isNurseActive(n),
    dataInicio: n.dataInicio || '',
    dataFim: n.dataFim || ''
  })).filter(n => n.id && n.name && n.attivo && n.id !== 'n0'); // exclui Coordinatrice e inativas
}

// ── INIT ──────────────────────────────────────────────────────
function bootstrap() {
  registerServiceWorker();
  initInstallUI();
  showSplash();
  // Atualiza UI biométrica após DOM ser renderizado
  setTimeout(() => { try { updateBiometricLoginUI(); } catch (e) {} }, 300);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap);
} else {
  bootstrap();
}

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true;
        window.location.reload();
      }
    });
  }
}

// ============================================================
// ── PWA INSTALL SYSTEM (iOS + Android) — versione minimal ──
// Una sola UI: il pulsante nell'header (visibile dopo il login).
// Il pulsante prova il prompt nativo (Android Chrome); se non disponibile
// (iOS Safari, in-app browser, ecc.) apre un modal con istruzioni reali.
// ============================================================

const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isAndroid = /Android/.test(navigator.userAgent);

// Detect in-app browser (WhatsApp, Instagram, Facebook, ecc.)
// PWA install è impossibile dentro di questi browser.
function isInAppBrowser() {
  const ua = navigator.userAgent || '';
  return /FBAN|FBAV|Instagram|Line|MicroMessenger|WhatsApp|Snapchat|TikTok|Twitter|LinkedInApp/i.test(ua);
}

function isStandalone() {
  return window.navigator.standalone === true ||
         window.matchMedia('(display-mode: standalone)').matches ||
         window.matchMedia('(display-mode: fullscreen)').matches ||
         document.referrer.startsWith('android-app://');
}

let deferredPrompt = null;

// Android Chrome: cattura il prompt nativo
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  console.log('✅ PWA install prompt nativo pronto');
  updateInstallUI();
});

// Conferma installazione
window.addEventListener('appinstalled', () => {
  console.log('✅ PWA installata con successo');
  deferredPrompt = null;
  updateInstallUI();
  toast('App installata con successo! 🎉', 'success');
});

// L'unico controllo UI: mostra/nasconde il pulsante nell'header.
function updateInstallUI() {
  const btn = document.getElementById('installPwaBtn');
  if (!btn) return;
  if (isStandalone()) {
    btn.style.display = 'none';
    return;
  }
  // Mostra il pulsante (display:flex per centrare il testo)
  btn.style.display = 'flex';
}

function installApp() {
  if (isStandalone()) {
    toast('App già installata!', 'info');
    return;
  }

  // 1) Android Chrome con prompt nativo pronto: installazione 1-clic
  if (deferredPrompt && !isIOS) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choice) => {
      console.log('PWA prompt outcome:', choice.outcome);
      if (choice.outcome === 'accepted') {
        toast('Installazione in corso...', 'info');
      }
      deferredPrompt = null;
      updateInstallUI();
    });
    return;
  }

  // 2) Tutti gli altri casi: apri modal con istruzioni
  const modal = document.getElementById('pwaInstallModal');
  if (!modal) return;

  const warning    = document.getElementById('installBrowserWarning');
  const iosSec     = document.getElementById('installIOS');
  const androidSec = document.getElementById('installAndroid');

  // Reset visibilità
  if (warning)    warning.style.display    = 'none';
  if (iosSec)     iosSec.style.display     = 'none';
  if (androidSec) androidSec.style.display = 'none';

  // In-app browser: non si può installare, mostra solo l'avviso
  if (isInAppBrowser()) {
    if (warning) warning.style.display = 'block';
  } else if (isIOS) {
    if (iosSec) iosSec.style.display = 'block';
  } else if (isAndroid) {
    if (androidSec) androidSec.style.display = 'block';
  } else {
    // Desktop o altro: mostra entrambe le sezioni
    if (iosSec)     iosSec.style.display     = 'block';
    if (androidSec) androidSec.style.display = 'block';
  }

  modal.classList.remove('hidden');
}

function initInstallUI() {
  // Pulisce qualsiasi flag dismiss vecchio rimasto in localStorage
  try {
    localStorage.removeItem('install_topbar_dismissed');
    localStorage.removeItem('install_topbar_dismissed_v2');
    localStorage.removeItem('install_topbar_dismissed_v3');
    localStorage.removeItem('install_banner_dismissed');
    localStorage.removeItem('install_banner_dismissed_v3');
  } catch (e) {}
  updateInstallUI();
}

function togglePassword() {
  const input = document.getElementById('loginPass');
  const eyeOpen = document.getElementById('eyeOpen');
  const eyeClosed = document.getElementById('eyeClosed');
  if (input.type === 'password') {
    input.type = 'text';
    if (eyeOpen) eyeOpen.style.display = 'none';
    if (eyeClosed) eyeClosed.style.display = 'block';
  } else {
    input.type = 'password';
    if (eyeOpen) eyeOpen.style.display = 'block';
    if (eyeClosed) eyeClosed.style.display = 'none';
  }
}

async function showSplash() {
  // Show splash for 1.5s then load data
  let initSuccess = false;
  try {
    await initializeData();
    initSuccess = true;
  } catch (e) {
    console.error('❌ Init error:', e);
  }

  setTimeout(() => {
    document.getElementById('splashScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
    if (!initSuccess) {
      showLoginError('Errore di connessione al server. Verifica la tua connessione internet.');
    }
  }, 1500);
}

function showLoginError(msg) {
  const errorEl = document.getElementById('loginError');
  if (errorEl) {
    errorEl.innerHTML = `${msg}<br><button onclick="retryConnection()" style="margin-top:8px; padding:8px 20px; background:var(--primary); color:white; border:none; border-radius:8px; font-weight:700; font-family:var(--font); cursor:pointer; font-size:13px;">🔄 Riprova</button>`;
  }
}

async function retryConnection() {
  const errorEl = document.getElementById('loginError');
  if (errorEl) errorEl.innerHTML = '<span style="color:var(--text-3)">Connessione in corso...</span>';
  try {
    await initializeData();
    if (errorEl) errorEl.textContent = '';
    toast('Connessione riuscita!', 'success');
  } catch (e) {
    console.error('❌ Retry error:', e);
    showLoginError('Impossibile connettersi. Verifica la connessione e riprova.');
  }
}

async function initializeData() {
  console.log('🔄 initializeData: Starting...');
  console.log('🔗 API URL:', GOOGLE_API_URL);

  // ── Fase 1: Hidratar do cache imediatamente (login instantâneo) ──
  const cached = cacheGet('Usuarios');
  if (cached && cached.data && cached.data.length > 0) {
    appUsers = cached.data;
    populateLoginDropdown();
    console.log('📦 Usuarios do cache:', appUsers.length, 'users (age:', Math.round(cached.age / 1000), 's, stale:', cached.stale, ')');
  }

  // Se o cache está fresco, atualiza em background (não bloqueia tela)
  if (cached && !cached.stale && appUsers.length > 0) {
    apiRead('Usuarios').then(fresh => {
      if (fresh && fresh.length > 0) {
        appUsers = fresh;
        cacheSet('Usuarios', fresh);
        populateLoginDropdown();
      }
    }).catch(e => console.warn('Background refresh Usuarios failed:', e.message));
    return;
  }

  // ── Fase 2: Sem cache ou cache velho — busca da rede ──
  let usersResult;
  try {
    usersResult = await apiRead('Usuarios');
    console.log('✅ Users loaded:', usersResult.length, 'users');
    cacheSet('Usuarios', usersResult);
  } catch (e) {
    console.error('❌ Failed to load users:', e.message);
    // Se já hidratamos do cache (mesmo stale), seguimos em frente
    if (appUsers.length > 0) {
      console.warn('⚠️ Usando cache stale para não bloquear login');
      return;
    }
    throw new Error('Impossibile caricare gli utenti: ' + e.message);
  }

  if (usersResult && usersResult.length > 0) {
    appUsers = usersResult;
  } else {
    console.log('📝 No users found, creating default admin...');
    // Database empty or fresh, ensure sheets exist before proceeding
    try {
      await ensureSheetSetup();
    } catch (e) {
      console.warn('⚠️ Sheet setup warning:', e.message);
    }

    // Create default admin user
    const adminUser = { id: 'admin_' + Date.now(), nome: 'Coordinatrice', senha: 'coord2026', role: 'admin', nurseId: '' };
    try {
      await apiWrite('Usuarios', adminUser);
      console.log('✅ Default admin created');
    } catch (e) {
      console.error('❌ Failed to create admin:', e.message);
      // Still use the admin locally so user can at least see the login screen
    }
    appUsers = [adminUser];
    cacheSet('Usuarios', appUsers);
  }

  populateLoginDropdown();
}

function populateLoginDropdown() {
  const loginSelect = document.getElementById('loginUser');
  if (!loginSelect) return;
  loginSelect.innerHTML = '<option value="">Seleziona il tuo nome...</option>' +
    appUsers.map(u => `<option value="${u.id}">${u.nome}${u.role === 'admin' ? ' (Admin)' : ''}</option>`).join('');
  console.log('✅ Login dropdown populated with', appUsers.length, 'users');
}

async function ensureSheetSetup() {
  // Ensure the required sheets exist — NÃO toca em Funcionarios (já existe com seus próprios headers)
  try {
    await apiCall('setupHeaders', 'Usuarios', { headers: ['id', 'nome', 'senha', 'role', 'nurseId'] });
    await apiCall('setupHeaders', 'Solicitacoes', { headers: ['id', 'type', 'status', 'nurseId', 'nurseName', 'nurseIdcambio', 'nursecambio', 'startDate', 'endDate', 'dataRichiedente', 'dataCambio', 'turnoRichiedente', 'turnoCambio', 'desc', 'autoApplied', 'createdAt', 'approvedAt', 'approvedBy'] });
    await apiCall('setupHeaders', 'Funcionarios', { headers: ['id', 'nome', 'attivo', 'dataInicio', 'dataFim', 'cargaSemanal', 'notas'] });
    await apiCall('setupHeaders', 'Escala', { headers: ['nurseId', 'month', 'year', 'd1','d2','d3','d4','d5','d6','d7','d8','d9','d10','d11','d12','d13','d14','d15','d16','d17','d18','d19','d20','d21','d22','d23','d24','d25','d26','d27','d28','d29','d30','d31'] });
  } catch (e) {
    console.warn('Sheet setup:', e);
  }
}

// ── API LAYER ─────────────────────────────────────────────────
async function apiCall(action, sheetName, body = null) {
  if (!GOOGLE_API_URL) {
    throw new Error('API URL not configured');
  }

  const url = `${GOOGLE_API_URL}?action=${action}&sheetName=${sheetName}&apiKey=${API_KEY}`;
  console.log(`📡 API [${action}] → ${sheetName}`, body ? '(POST)' : '(GET)');

  // Build fetch options explicitly
  const opts = {
    method: body ? 'POST' : 'GET',
    redirect: 'follow', // Explicitly follow Google's 302 redirects
  };

  if (body) {
    opts.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
    opts.body = JSON.stringify(body);
  }

  // Timeout de 30 segundos (Google Apps Script cold start pode demorar)
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  opts.signal = controller.signal;

  let res;
  try {
    res = await fetch(url, opts);
    clearTimeout(timeoutId);
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      console.error('⏱️ API Timeout: Request exceeded 30 seconds');
      throw new Error('Timeout: il server non risponde. Riprova.');
    }
    console.error('🌐 Network Error:', e.message);
    throw new Error('Errore di rete: ' + e.message);
  }

  // Check HTTP status
  if (!res.ok) {
    console.error(`❌ API HTTP Error: ${res.status} ${res.statusText}`);
    throw new Error(`Errore HTTP ${res.status}: ${res.statusText}`);
  }

  // Parse response safely — Google may return HTML instead of JSON
  // (e.g., auth pages, deployment errors)
  let responseText;
  try {
    responseText = await res.text();
  } catch (e) {
    console.error('❌ Failed to read response body:', e);
    throw new Error('Impossibile leggere la risposta del server.');
  }

  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error('❌ API returned non-JSON response:', responseText.substring(0, 300));
    // Check if it's an HTML error page from Google
    if (responseText.includes('<!DOCTYPE') || responseText.includes('<html')) {
      throw new Error('Il server ha restituito una pagina HTML invece di dati. Verifica che il deploy di Apps Script sia corretto e accessibile a "Chiunque".');
    }
    throw new Error('Risposta del server non valida (non è JSON).');
  }

  // Check API-level errors
  if (data.status === 'error') {
    console.error('❌ API Error:', data.message);
    throw new Error(data.message || 'Errore sconosciuto dal server.');
  }

  console.log(`✅ API [${action}] → ${sheetName}: OK`);
  return data;
}

async function apiRead(sheetName) {
  const result = await apiCall('read', sheetName);
  if (!result || result.status !== 'success') {
    throw new Error(`Errore nel leggere ${sheetName}`);
  }
  return result.data || [];
}

async function apiWrite(sheetName, data) {
  return await apiCall('write', sheetName, data);
}

async function apiUpdate(sheetName, keyColumn, keyValue, updates) {
  return await apiCall('update', sheetName, { _keyColumn: keyColumn, _keyValue: keyValue, ...updates });
}

async function apiDelete(sheetName, keyColumn, keyValue) {
  return await apiCall('delete', sheetName, { _keyColumn: keyColumn, _keyValue: keyValue });
}

// ── AUTH ──────────────────────────────────────────────────────
function doLogin() {
  const userId = document.getElementById('loginUser').value;
  const pass = document.getElementById('loginPass').value;
  const errorEl = document.getElementById('loginError');

  if (!userId) {
    errorEl.textContent = 'Seleziona il tuo nome';
    return;
  }

  const user = appUsers.find(u => String(u.id) === String(userId));
  if (!user) {
    errorEl.textContent = 'Utente non trovato';
    return;
  }

  if (String(user.senha) !== String(pass)) {
    errorEl.textContent = 'Password errata';
    return;
  }

  errorEl.textContent = '';
  currentUser = user;
  isAdmin = user.role === 'admin';

  // Save session
  localStorage.setItem('cotolengo_session', JSON.stringify({ userId: user.id }));

  enterApp();
}

function doLogout() {
  localStorage.removeItem('cotolengo_session');
  currentUser = null;
  isAdmin = false;
  document.getElementById('mainApp').classList.remove('active');
  document.getElementById('loginScreen').classList.add('active');
  document.getElementById('loginPass').value = '';
  currentPage = 0;
  updateSwipePosition();
  // Revalida a visibilidade do botão biométrico no login
  updateBiometricLoginUI();
}

// ── BIOMETRIC AUTHENTICATION (WebAuthn) ──────────────────
// Usa as credenciais de plataforma do dispositivo (Touch ID, Face ID, Windows Hello, impronta Android).
// Armazena apenas o credentialId + userId localmente; a chave privada biométrica fica no Secure Enclave/TPM.

const BIOMETRIC_STORAGE_KEY = 'cotolengo_biometric_v1';
const BIOMETRIC_RP_NAME = 'Cottolengo Turni';

function biometricSupported() {
  return !!(window.PublicKeyCredential
    && navigator.credentials
    && typeof navigator.credentials.create === 'function'
    && typeof navigator.credentials.get === 'function');
}

function getStoredBiometric() {
  try {
    const raw = localStorage.getItem(BIOMETRIC_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

function setStoredBiometric(data) {
  try { localStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(data)); }
  catch (e) { console.warn('Biometric storage failed:', e); }
}

function clearStoredBiometric() {
  try { localStorage.removeItem(BIOMETRIC_STORAGE_KEY); } catch (e) {}
}

// Helpers para conversão ArrayBuffer <-> base64url
function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

// Atualiza visibilidade do botão biométrico na tela de login.
function updateBiometricLoginUI() {
  const btn = document.getElementById('biometricLoginBtn');
  const hint = document.getElementById('biometricHint');
  if (!btn) return;
  if (!biometricSupported()) {
    btn.style.display = 'none';
    if (hint) hint.style.display = 'none';
    return;
  }
  const stored = getStoredBiometric();
  if (stored && stored.credentialId && stored.userId) {
    btn.style.display = 'flex';
    if (hint) hint.style.display = 'none';
  } else {
    btn.style.display = 'none';
    if (hint) hint.style.display = 'block';
  }
}

// Mostra/esconde o toggle biométrico no header após login.
function updateBiometricToggleUI() {
  const btn = document.getElementById('biometricToggleBtn');
  if (!btn) return;
  if (!biometricSupported() || !currentUser) {
    btn.style.display = 'none';
    return;
  }
  btn.style.display = 'flex';
  const stored = getStoredBiometric();
  const isEnabled = stored && String(stored.userId) === String(currentUser.id);
  btn.title = isEnabled
    ? 'Biometria abilitata — clicca per disabilitare'
    : 'Abilita accesso biometrico su questo dispositivo';
  btn.style.color = isEnabled ? 'var(--primary, #a78bfa)' : '';
}

// Registra credencial biométrica para o usuário logado atualmente.
async function registerBiometric() {
  if (!biometricSupported()) {
    toast('Il tuo dispositivo non supporta l\'autenticazione biometrica', 'error');
    return false;
  }
  if (!currentUser) {
    toast('Devi prima effettuare l\'accesso', 'warning');
    return false;
  }
  try {
    // Usa ID aleatório para o challenge (registro não depende do servidor aqui)
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    const userIdBytes = new TextEncoder().encode(String(currentUser.id));

    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: challenge,
        rp: { name: BIOMETRIC_RP_NAME, id: location.hostname },
        user: {
          id: userIdBytes,
          name: currentUser.nome || String(currentUser.id),
          displayName: currentUser.nome || String(currentUser.id)
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },    // ES256
          { type: 'public-key', alg: -257 }   // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',  // biometria do próprio dispositivo
          userVerification: 'required',
          residentKey: 'preferred'
        },
        timeout: 60000,
        attestation: 'none'
      }
    });

    if (!credential) {
      toast('Registrazione annullata', 'info');
      return false;
    }

    setStoredBiometric({
      credentialId: bufToB64url(credential.rawId),
      userId: String(currentUser.id),
      userName: currentUser.nome,
      createdAt: new Date().toISOString()
    });

    toast('Accesso biometrico attivato! 🔒', 'success');
    updateBiometricLoginUI();
    updateBiometricToggleUI();
    return true;
  } catch (err) {
    console.error('[biometric register] Erro:', err);
    if (err && err.name === 'NotAllowedError') {
      toast('Operazione annullata o non consentita', 'warning');
    } else {
      toast('Registrazione biometrica fallita', 'error');
    }
    return false;
  }
}

// Desativa biometria (remove credencial local).
function unregisterBiometric() {
  clearStoredBiometric();
  toast('Accesso biometrico disabilitato', 'info');
  updateBiometricLoginUI();
  updateBiometricToggleUI();
}

// Alterna registro/desregistro a partir do botão no header.
async function toggleBiometricRegistration() {
  const stored = getStoredBiometric();
  const isEnabledForMe = stored && currentUser && String(stored.userId) === String(currentUser.id);
  if (isEnabledForMe) {
    if (!confirm('Disabilitare l\'accesso biometrico su questo dispositivo?')) return;
    unregisterBiometric();
  } else {
    if (stored && stored.userId && currentUser && String(stored.userId) !== String(currentUser.id)) {
      if (!confirm('Un altro utente ha già registrato la biometria su questo dispositivo. Sostituirla con il tuo accesso?')) return;
    }
    await registerBiometric();
  }
}

// Realiza login usando credencial biométrica armazenada.
async function doBiometricLogin() {
  if (!biometricSupported()) {
    toast('Il tuo dispositivo non supporta l\'autenticazione biometrica', 'error');
    return;
  }
  const stored = getStoredBiometric();
  if (!stored || !stored.credentialId || !stored.userId) {
    toast('Nessuna biometria registrata su questo dispositivo', 'warning');
    return;
  }
  try {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);

    const assertion = await navigator.credentials.get({
      publicKey: {
        challenge: challenge,
        allowCredentials: [{
          type: 'public-key',
          id: b64urlToBuf(stored.credentialId),
          transports: ['internal']
        }],
        userVerification: 'required',
        timeout: 60000,
        rpId: location.hostname
      }
    });

    if (!assertion) {
      toast('Autenticazione annullata', 'info');
      return;
    }

    // O fato do assertion ter sucesso já prova que o usuário passou na biometria local.
    const user = (appUsers || []).find(u => String(u.id) === String(stored.userId));
    if (!user) {
      toast('Utente non più presente — riaccedere con password', 'error');
      clearStoredBiometric();
      updateBiometricLoginUI();
      return;
    }

    currentUser = user;
    isAdmin = user.role === 'admin';
    localStorage.setItem('cotolengo_session', JSON.stringify({ userId: user.id }));
    const errorEl = document.getElementById('loginError');
    if (errorEl) errorEl.textContent = '';
    enterApp();
    toast(`Benvenuto/a, ${user.nome}! 👋`, 'success');
  } catch (err) {
    console.error('[biometric login] Erro:', err);
    if (err && err.name === 'NotAllowedError') {
      toast('Autenticazione annullata', 'warning');
    } else {
      toast('Accesso biometrico fallito — usa la password', 'error');
    }
  }
}

function enterApp() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('mainApp').classList.add('active');

  // Set header info
  const initials = currentUser.nome.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerName').textContent = currentUser.nome;
  document.getElementById('headerRole').textContent = isAdmin ? 'Amministratore' : 'Dipendente';

  // Show/hide admin tab and report tab
  // Admin: Turni(0) + Richieste(1) + Utenti(2) = 3 pages
  // User:  Turni(0) + Richieste(1) + Report(2) = 3 pages
  totalPages = 3;
  document.getElementById('navAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('dotAdmin').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('pageAdmin').style.display = isAdmin ? 'block' : 'none';

  // Report tab: visible only for non-admin (employees)
  const showReport = !isAdmin;
  document.getElementById('navReportBtn').style.display = showReport ? 'flex' : 'none';
  document.getElementById('dotReport').style.display = showReport ? 'block' : 'none';
  document.getElementById('pageReport').style.display = showReport ? 'block' : 'none';

  // Build UI
  buildLegend();
  buildCalendarFilter();
  updateMonthDisplay();
  setupSwipe();
  loadAllData();

  // Atualiza o toggle biométrico no header
  try { updateBiometricToggleUI(); } catch (e) {}

  // Oferece ativar biometria após primeiro login bem-sucedido (apenas se suportado e nunca perguntado)
  try {
    if (biometricSupported()) {
      const stored = getStoredBiometric();
      const promptedKey = `biometric_prompted_${currentUser.id}`;
      const alreadyAsked = localStorage.getItem(promptedKey) === '1';
      const alreadyRegistered = stored && String(stored.userId) === String(currentUser.id);
      if (!alreadyRegistered && !alreadyAsked) {
        setTimeout(() => {
          if (confirm('Vuoi abilitare l\'accesso biometrico (impronta / Face ID) su questo dispositivo per accessi futuri più rapidi?')) {
            registerBiometric();
          }
          try { localStorage.setItem(promptedKey, '1'); } catch (e) {}
        }, 1500);
      }
    }
  } catch (e) { console.warn('[biometric prompt] skip:', e); }
}

// ── CALENDAR FILTER ──────────────────────────────────────────
function buildCalendarFilter() {
  // Filtro visível para todos agora
}

function populateCalendarFilter() {
  const sel = document.getElementById('calNurseFilter');
  if (!sel) return;
  // Everyone sees all employees + their own selection
  sel.innerHTML = '<option value="all">👥 Tutti i dipendenti</option>' +
    nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
  // Non-admin: default to their own nurse if they haven't changed the filter
  if (!isAdmin && currentUser && currentUser.nurseId && calNurseFilter === 'all') {
    // Keep "all" as default so they can see everyone
  }
  sel.value = calNurseFilter;
}

function onCalFilterChange() {
  calNurseFilter = document.getElementById('calNurseFilter').value;
  renderCalendar();
}

// ── DATA LOADING ──────────────────────────────────────────────
// Estratégia: Hidratar do cache (instantâneo) → Fetch em paralelo → Re-render
async function loadAllData() {
  showLoading(true);

  // ── FASE 1: Cache (render imediato, sem rede) ──
  const cacheHasData = hydrateFromCache();
  if (cacheHasData) {
    renderAll();
    console.log('⚡ Render inicial do cache (sem rede)');
  }

  // ── FASE 2: Fetch em paralelo ──
  const t0 = Date.now();
  const fetches = [
    apiRead('Funcionarios').catch(e => { console.error('❌ Funcionarios:', e.message); return { __err: e }; }),
    apiRead('Escala').catch(e => { console.error('❌ Escala:', e.message); return { __err: e }; }),
    apiRead('Solicitacoes').catch(e => { console.error('❌ Solicitacoes:', e.message); return { __err: e }; })
  ];
  if (isAdmin) {
    fetches.push(apiRead('Usuarios').catch(e => { console.error('❌ Usuarios:', e.message); return { __err: e }; }));
  }

  const results = await Promise.all(fetches);
  const [nursesData, escalaData, reqData, usersData] = results;
  console.log(`⏱️ Parallel fetch completado em ${Date.now() - t0}ms`);

  let hasErrors = false;

  // Funcionarios
  if (nursesData && !nursesData.__err) {
    if (Array.isArray(nursesData) && nursesData.length > 0) {
      nurses = normalizeNurses(nursesData);
      cacheSet('Funcionarios', nursesData);
      console.log('📋 Funcionarios atualizados:', nurses.length);
    } else {
      console.warn('⚠️ Nenhum funcionário na aba Funcionarios.');
    }
  } else if (nursesData && nursesData.__err) {
    hasErrors = true;
  }

  // Escala
  if (escalaData && !escalaData.__err) {
    if (Array.isArray(escalaData)) {
      cacheSet('Escala', escalaData);
      parseSchedule(escalaData);
    }
  } else if (escalaData && escalaData.__err) {
    hasErrors = true;
  }

  // Solicitacoes
  if (reqData && !reqData.__err) {
    if (Array.isArray(reqData)) {
      requests = reqData;
      cacheSet('Solicitacoes', reqData);
    }
  } else if (reqData && reqData.__err) {
    hasErrors = true;
  }

  // Usuarios (admin)
  if (isAdmin && usersData && !usersData.__err) {
    if (Array.isArray(usersData)) {
      appUsers = usersData;
      cacheSet('Usuarios', usersData);
    }
  } else if (isAdmin && usersData && usersData.__err) {
    hasErrors = true;
  }

  // Auto-match user by name if needed (depois de ter Funcionarios)
  if (!isAdmin && currentUser && (!currentUser.nurseId || currentUser.nurseId === '')) {
    const userName = currentUser.nome.toLowerCase().trim();
    const match = nurses.find(n => {
      const nn = n.name.toLowerCase().trim();
      return nn === userName || nn.includes(userName) || userName.includes(nn);
    });
    if (match) {
      currentUser.nurseId = match.id;
      calNurseFilter = match.id;
      apiUpdate('Usuarios', 'id', currentUser.id, { nurseId: match.id })
        .then(() => cacheInvalidate('Usuarios'))
        .catch(() => {});
    }
  }

  // Re-render com dados frescos
  renderAll();

  if (hasErrors) {
    toast('Alcuni dati non sono stati caricati', 'warning');
  } else {
    toast('Dati sincronizzati', 'success');
  }

  showLoading(false);
}

// Hidrata estado a partir do cache (sem rede). Retorna true se havia dados.
function hydrateFromCache() {
  let hasData = false;

  const fCache = cacheGet('Funcionarios');
  if (fCache && Array.isArray(fCache.data) && fCache.data.length > 0) {
    nurses = normalizeNurses(fCache.data);
    hasData = true;
    console.log('📦 Funcionarios do cache:', nurses.length);
  }

  const eCache = cacheGet('Escala');
  if (eCache && Array.isArray(eCache.data)) {
    parseSchedule(eCache.data);
    hasData = true;
    console.log('📦 Escala do cache:', Object.keys(schedule).length, 'entries');
  }

  const rCache = cacheGet('Solicitacoes');
  if (rCache && Array.isArray(rCache.data)) {
    requests = rCache.data;
    hasData = true;
    console.log('📦 Solicitacoes do cache:', requests.length);
  }

  if (isAdmin) {
    const uCache = cacheGet('Usuarios');
    if (uCache && Array.isArray(uCache.data)) {
      appUsers = uCache.data;
    }
  }

  return hasData;
}

// ── NURSE PERSONAL METRICS ─────────────────────────────────
// NOTE: I KPI personali sono stati rimossi dalla guida Scala.
// Tutti gli indicatori sono ora centralizzati nella guida Report
// (vedi renderReportTab). Questa funzione è mantenuta come no-op
// per non rompere eventuali chiamate residue.
function renderNurseMetrics() {
  return;
}

function renderAll() {
  renderCalendar();
  renderRequests();
  populateFilterNurse();
  populateCalendarFilter();
  if (isAdmin) renderAdminUsers();
  if (!isAdmin) renderReportTab();
  updateBadges();
}

// Parseia linhas brutas de Escala para o dicionário `schedule` do mês atual
function parseSchedule(data) {
  schedule = {};
  if (!data || data.length === 0) return;
  const m = currentMonth.getMonth();
  const y = currentMonth.getFullYear();

  data.forEach(row => {
    // row.month vem do Sheets (1 a 12). m é 0 a 11.
    if (String(row.month) === String(m + 1) && String(row.year) === String(y)) {
      for (let d = 1; d <= 31; d++) {
        const val = row['d' + d];
        if (val && val !== '' && val !== 'undefined') {
          schedule[`${row.nurseId}_${m}_${y}_${d}`] = String(val);
        }
      }
    }
  });
  console.log('📅 Schedule parsed for', MONTH_NAMES[m], y, ':', Object.keys(schedule).length, 'entries');
}

// Usada pelo changeMonth: tenta cache primeiro, senão busca e atualiza
async function loadSchedule() {
  const cached = cacheGet('Escala');
  if (cached && Array.isArray(cached.data)) {
    parseSchedule(cached.data);
    // Se o cache está fresco, evita a chamada de rede
    if (!cached.stale) return;
  }
  try {
    const data = await apiRead('Escala');
    console.log('📅 Escala raw data:', data);
    if (Array.isArray(data)) {
      cacheSet('Escala', data);
      parseSchedule(data);
    }
  } catch (e) {
    console.warn('⚠️ loadSchedule fallback no cache:', e.message);
  }
}

async function syncData() {
  const btn = document.getElementById('syncBtn');
  btn.classList.add('syncing');
  await loadAllData();
  btn.classList.remove('syncing');
}

function showLoading(show) {
  document.getElementById('loadingOverlay').classList.toggle('hidden', !show);
}

// ── SWIPE NAVIGATION ──────────────────────────────────────────
let touchStartX = 0;
let touchStartY = 0;
let touchCurrentX = 0;
let isDragging = false;
let isVerticalScroll = false;

function setupSwipe() {
  const container = document.getElementById('swipeContainer');
  const track = document.getElementById('swipeTrack');

  container.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchCurrentX = touchStartX;
    isDragging = false;
    isVerticalScroll = false;
  }, { passive: true });

  container.addEventListener('touchmove', (e) => {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    // Determine scroll direction on first significant move
    if (!isDragging && !isVerticalScroll) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        isVerticalScroll = true;
        return;
      }
      if (Math.abs(dx) > 10) {
        isDragging = true;
        track.classList.add('dragging');
      }
    }

    if (isVerticalScroll) return;
    if (!isDragging) return;

    touchCurrentX = e.touches[0].clientX;
    const offset = -(currentPage * window.innerWidth) + (touchCurrentX - touchStartX);
    track.style.transform = `translateX(${offset}px)`;
  }, { passive: true });

  container.addEventListener('touchend', () => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove('dragging');

    const dx = touchCurrentX - touchStartX;
    const threshold = window.innerWidth * 0.25;

    if (dx < -threshold && currentPage < totalPages - 1) {
      currentPage++;
    } else if (dx > threshold && currentPage > 0) {
      currentPage--;
    }

    updateSwipePosition();
  }, { passive: true });
}

function goToPage(page) {
  if (page < 0 || page >= totalPages) return;
  currentPage = page;
  updateSwipePosition();
}

function updateSwipePosition() {
  const track = document.getElementById('swipeTrack');
  track.style.transform = `translateX(-${currentPage * 100}%)`;

  // Update nav
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.page) === currentPage);
  });

  // Update dots
  document.querySelectorAll('.dot').forEach((dot, i) => {
    dot.classList.toggle('active', i === currentPage);
  });
}

// ── CALENDAR (MOBILE CARD GRID) ──────────────────────────────
function buildLegend() {
  const codes = ['M1','M2','MF','G','P','PF','N','OFF','FE','AT'];
  document.getElementById('shiftLegend').innerHTML = codes.map(c => {
    const s = SHIFTS[c];
    return `<div class="legend-item"><div class="legend-dot" style="background:${s.color}"></div>${c}</div>`;
  }).join('');
}

function changeMonth(dir) {
  currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + dir, 1);
  updateMonthDisplay();
  loadSchedule().then(() => { renderCalendar(); });
}

function updateMonthDisplay() {
  document.getElementById('monthLabel').textContent =
    `${MONTH_NAMES[currentMonth.getMonth()]} ${currentMonth.getFullYear()}`;
}

function getShift(nurseId, day) {
  const m = currentMonth.getMonth();
  const y = currentMonth.getFullYear();
  return schedule[`${nurseId}_${m}_${y}_${day}`] || 'OFF';
}

function daysInMonth(m) {
  return new Date(m.getFullYear(), m.getMonth() + 1, 0).getDate();
}

let selectedDay = null;

function renderCalendar() {
  const days = daysInMonth(currentMonth);
  const m = currentMonth.getMonth();
  const y = currentMonth.getFullYear();
  const today = new Date();
  const isCurrentMonth = today.getMonth() === m && today.getFullYear() === y;
  const todayDate = today.getDate();

  // Weekday headers
    const weekdayNames = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom'];
    const weekdaysEl = document.getElementById('calWeekdays');
    weekdaysEl.innerHTML = weekdayNames.map((name, i) =>
      `<div class="cal-weekday ${i === 5 || i === 6 ? 'wkend' : ''}">${name}</div>`
    ).join('');

    // First day of month (0=Sun)
    const firstDow = new Date(y, m, 1).getDay();
    const emptyCells = (firstDow + 6) % 7;

    // Build day cells
    const daysEl = document.getElementById('calDays');
    let html = '';

    // Empty cells for days before month starts
    for (let i = 0; i < emptyCells; i++) {
        html += '<div class="cal-day-cell empty"></div>';
    }

    // Determine what to show
    const showingSingle = calNurseFilter !== 'all';
    const selectedNurse = showingSingle ? nurses.find(n => n.id === calNurseFilter) : null;

    // Update subtitle
    const hasData = Object.keys(schedule).some(k => k.includes(`_${m}_${y}_`));
    if (showingSingle && selectedNurse) {
        document.getElementById('monthSub').textContent = hasData ? `Turni di ${selectedNurse.name}` : 'In attesa di pubblicazione';
    } else {
        document.getElementById('monthSub').textContent = hasData ? 'Turno Generale' : 'In attesa di pubblicazione';
    }

  // Day cells
  for (let d = 1; d <= days; d++) {
    const dow = new Date(y, m, d).getDay();
    const isWk = dow === 0 || dow === 6;
    const isToday = isCurrentMonth && d === todayDate;

    let shiftHtml = '';

    if (showingSingle && selectedNurse) {
      // Show single nurse's shift as a badge
      const code = getShift(selectedNurse.id, d);
      if (code !== 'OFF') {
        const sh = SHIFTS[code];
        shiftHtml = `<div class="cal-day-shift" style="background:${sh.color};color:${sh.text}">${code}</div>`;
      }
    } else if (nurses.length > 0 && hasData) {
      // Show colored dots for all nurses (summary view)
      const dots = nurses.slice(0, 7).map(n => {
        const code = getShift(n.id, d);
        if (code === 'OFF') return '';
        const sh = SHIFTS[code];
        return `<div class="cal-shift-dot" style="background:${sh.color}" title="${n.name}: ${code}"></div>`;
      }).join('');
      shiftHtml = `<div class="cal-day-dots">${dots}</div>`;
    }

    html += `<div class="cal-day-cell${isWk ? ' wkend' : ''}${isToday ? ' today' : ''}" onclick="toggleDayDetail(${d})">
      <div class="cal-day-num">${d}</div>
      ${shiftHtml}
    </div>`;
  }

  daysEl.innerHTML = html;

  // Remove old detail panel if month changed
  const oldPanel = document.getElementById('calDetailPanel');
  if (oldPanel) oldPanel.remove();
}

function toggleDayDetail(day) {
  const oldPanel = document.getElementById('calDetailPanel');
  if (oldPanel) {
    if (selectedDay === day) {
      oldPanel.remove();
      selectedDay = null;
      return;
    }
    oldPanel.remove();
  }
  selectedDay = day;

  const m = currentMonth.getMonth();
  const y = currentMonth.getFullYear();
  const date = new Date(y, m, day);
  const dayNames = ['Domenica','Lunedì','Martedì','Mercoledì','Giovedì','Venerdì','Sabato'];

  // Determine which nurses to show
  let detailNurses;
  if (calNurseFilter !== 'all') {
    detailNurses = nurses.filter(n => n.id === calNurseFilter);
  } else {
    detailNurses = nurses;
  }

  let listHtml = detailNurses.map(nurse => {
    const code = getShift(nurse.id, day);
    if (code === 'OFF') return '';
    const sh = SHIFTS[code];
    return `<div class="cal-detail-item">
      <div class="cal-detail-shift" style="background:${sh.color};color:${sh.text}">${code}</div>
      <div class="cal-detail-name">${nurse.name}</div>
      <div class="cal-detail-hours">${sh.h}h</div>
    </div>`;
  }).join('');

  if (detailNurses.length === 0) {
    listHtml = '<div style="text-align:center;color:var(--text-3);padding:16px;">Nessun dipendente selezionato</div>';
  }

  const panel = document.createElement('div');
  panel.id = 'calDetailPanel';
  panel.className = 'cal-day-detail-panel';
  panel.innerHTML = `
    <div class="cal-detail-title">
      <span>📅 Giorno ${day} — ${dayNames[date.getDay()]}</span>
      <button class="cal-detail-close" onclick="closeDayDetail()">✕</button>
    </div>
    <div class="cal-detail-list">${listHtml}</div>
  `;

  document.getElementById('calMonthGrid').after(panel);
}

function closeDayDetail() {
  const panel = document.getElementById('calDetailPanel');
  if (panel) panel.remove();
  selectedDay = null;
}

// ── REQUESTS ──────────────────────────────────────────────────
function populateFilterNurse() {
  const selWrap = document.querySelector('#filterNurse').parentElement;
  if (!isAdmin) {
    if (selWrap) selWrap.style.display = 'none';
  } else {
    if (selWrap) selWrap.style.display = 'block';
  }
  
  const sel = document.getElementById('filterNurse');
  sel.innerHTML = '<option value="all">👤 Tutti i dipendenti</option>' +
    nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
}

function setStatusFilter(filter, el) {
  statusFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderRequests();
}

function applyFilters() {
  const statusEl = document.getElementById('filterStatus');
  if (statusEl) statusFilter = statusEl.value;
  const nurseEl = document.getElementById('filterNurse');
  if (nurseEl) nurseFilter = nurseEl.value;
  renderRequests();
}

// Atualiza os contadores individuais nos chips de filtro.
// Recebe a lista JÁ com os filtros de visibilidade (não-admin) e de dipendente aplicados,
// mas ANTES do filtro de status (para que cada contador represente o próprio status).
function updateFilterCounters(scopedList) {
  try {
    const counts = { all: 0, pending: 0, approved: 0, rejected: 0 };
    (scopedList || []).forEach(r => {
      counts.all++;
      if (r.status && counts.hasOwnProperty(r.status)) counts[r.status]++;
    });
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    };
    set('allCount', counts.all);
    set('pendingCount', counts.pending);
    set('approvedCount', counts.approved);
    set('rejectedCount', counts.rejected);
  } catch (e) {
    console.warn('[updateFilterCounters] erro:', e);
  }
}

function renderRequests() {
  const list = document.getElementById('reqList');

  let filtered = [...requests];

  // Nurse visibility for non-admins
  if (!isAdmin && currentUser) {
    filtered = filtered.filter(r => String(r.nurseId) === String(currentUser.nurseId) || String(r.fromNurseId) === String(currentUser.nurseId));
  }

  // Nurse filter (Admin only) — aplica ANTES dos contadores para que reflitam a seleção
  if (isAdmin && nurseFilter !== 'all') {
    filtered = filtered.filter(r => String(r.nurseId) === String(nurseFilter) || String(r.fromNurseId) === String(nurseFilter));
  }

  // Atualiza contadores individuais por status (escopo: usuário logado + filtro de dipendente)
  updateFilterCounters(filtered);

  // Status filter (aplicado após os contadores para que as contagens não fiquem zeradas quando um status é selecionado)
  if (statusFilter !== 'all') {
    filtered = filtered.filter(r => r.status === statusFilter);
  }

  if (filtered.length === 0) {
    list.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📄</div>
      <p>${statusFilter !== 'all' || nurseFilter !== 'all' ? 'Nessuna richiesta con questi filtri' : 'Nessuna richiesta ancora'}</p>
    </div>`;
    return;
  }

  // Sort: pending (oldest first) → then approved/rejected (newest first)
  filtered.sort((a, b) => {
    if (a.status === 'pending' && b.status !== 'pending') return -1;
    if (b.status === 'pending' && a.status !== 'pending') return 1;
    if (a.status === 'pending' && b.status === 'pending') {
      return new Date(a.createdAt) - new Date(b.createdAt);
    }
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  const typeLabels = {
    swap: 'Cambio Turno',
    vacation: 'Ferie',
    justified: 'Riposo',
    FE: 'Ferie',
    OFF: 'Riposo',
    AT: 'Certificato/Licenza',
    OFF_INJ: 'Assenza Ingiustificata'
  };

  const typeIcons = {
    swap: '🔄',
    vacation: '🏖️',
    justified: '📋',
    FE: '🏖️',
    OFF: '📋',
    AT: '🏥',
    OFF_INJ: '⚠️'
  };

  const statusLabels = { pending: 'In attesa', approved: 'Approvato', rejected: 'Rifiutato' };
  const statusIcons = { pending: '⏳', approved: '✅', rejected: '❌' };

  list.innerHTML = filtered.map((req, idx) => {
    const isPending = req.status === 'pending';
    const canApprove = isAdmin && isPending;
    // Una richiesta può essere eliminata solo se è ancora in attesa (pending).
    // Dopo l'approvazione o il rifiuto resta nello storico e non è più cancellabile.
    const canDelete = isPending && (isAdmin || (currentUser && currentUser.nurseId === req.nurseId));

    // Date display (requested dates)
    let dateDisplay = '';
    if (req.type === 'swap') {
      // Per swap cross-date mostra le due date; single-date mostra quella unica
      const fromRaw = req.dataRichiedente || req.startDate || '';
      const toRaw   = req.dataCambio      || req.startDate || '';
      const from    = fromRaw ? formatDate(fromRaw) : '';
      const to      = toRaw   ? formatDate(toRaw)   : '';
      if (from && to && from !== to) {
        dateDisplay = `${from} ↔ ${to}`;
      } else {
        dateDisplay = from || to;
      }
    } else if (req.startDate) {
      const start = formatDate(req.startDate);
      const end = req.endDate ? formatDate(req.endDate) : start;
      dateDisplay = start === end ? start : `${start} → ${end}`;
    }

    // Creation date
    let createdStr = '';
    if (req.createdAt) {
      const d = new Date(req.createdAt);
      if (!isNaN(d.getTime())) {
        const dStr = d.toLocaleDateString('it-IT');
        const tStr = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
        createdStr = `${dStr} • ${tStr}`;
      }
    }

    // Person initials
    const personName = req.nurseName || '';
    const initials = personName.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();

    // Build card sections — swap layout em 2 colunas (quem cede o quê)
    const swapPartner = req.swapNurseName || req.nursecambio || req.toNurseName || '';
    let swapHtml = '';
    if (req.type === 'swap' && swapPartner) {
      const fromRaw = req.dataRichiedente || req.startDate || '';
      const toRaw   = req.dataCambio      || req.startDate || '';
      const isCross = fromRaw && toRaw && fromRaw !== toRaw;
      const fromShiftCode = req.turnoRichiedente || req.fromShift || '';
      const toShiftCode   = req.turnoCambio      || req.toShift   || '';
      const fromShiftName = SHIFTS[fromShiftCode]?.name || fromShiftCode || '';
      const toShiftName   = SHIFTS[toShiftCode]?.name   || toShiftCode   || '';
      const fromDateStr = fromRaw ? formatDate(fromRaw) : '';
      const toDateStr   = toRaw   ? formatDate(toRaw)   : '';

      if (isCross) {
        swapHtml = `
        <div class="req-swap-summary">
          <div class="req-swap-grid">
            <div class="req-swap-side">
              <div class="swap-side-label">${personName}</div>
              <div class="swap-side-info">📅 ${fromDateStr}</div>
              <div class="swap-side-info">⏰ ${fromShiftName || '—'}</div>
            </div>
            <div class="req-swap-arrow">⇄</div>
            <div class="req-swap-side">
              <div class="swap-side-label">${swapPartner}</div>
              <div class="swap-side-info">📅 ${toDateStr}</div>
              <div class="swap-side-info">⏰ ${toShiftName || '—'}</div>
            </div>
          </div>
        </div>`;
      } else {
        // Same-date: troca turnos no mesmo dia
        const dateLabel = fromDateStr || toDateStr || '';
        swapHtml = `
        <div class="req-swap-summary">
          ${dateLabel ? `<div class="req-swap-header"><span>📅</span><strong>${dateLabel}</strong></div>` : ''}
          <div class="req-swap-grid">
            <div class="req-swap-side">
              <div class="swap-side-label">${personName}</div>
              <div class="swap-side-info">⏰ ${fromShiftName || '—'}</div>
            </div>
            <div class="req-swap-arrow">⇄</div>
            <div class="req-swap-side">
              <div class="swap-side-label">${swapPartner}</div>
              <div class="swap-side-info">⏰ ${toShiftName || '—'}</div>
            </div>
          </div>
        </div>`;
      }
    }

    const descHtml = req.desc ? `
      <div class="req-card-desc">
        <span class="desc-icon">💬</span>
        <span class="desc-text">${req.desc}</span>
      </div>` : '';

    const approvedHtml = req.approvedBy ? `
      <div class="req-approved-row ${req.status === 'approved' ? 'is-approved' : 'is-rejected'}">
        <span>✍️</span>
        <span>${req.status === 'approved' ? 'Approvato' : 'Rifiutato'} da <strong>${req.approvedBy}</strong></span>
      </div>` : '';

    // Action buttons
    // "Modifica" è consentita con gli stessi permessi di eliminazione
    // (solo se la richiesta è ancora in attesa e l'utente è admin o il proprietario).
    const canEdit = canDelete;
    let actionsHtml = '';
    if (canApprove || canDelete || canEdit) {
      let btns = '';
      if (canEdit) {
        btns += `<button class="req-action-btn btn-edit-new" onclick="editRequest('${req.id}')">✏️ Modifica</button>`;
      }
      if (canDelete) {
        btns += `<button class="req-action-btn btn-delete-new" onclick="deleteRequest('${req.id}')">🗑️ Elimina</button>`;
      }
      if (canApprove) {
        btns += `<button class="req-action-btn btn-reject-new" onclick="rejectRequest('${req.id}')">✕ Rifiuta</button>`;
        btns += `<button class="req-action-btn btn-approve-new" onclick="approveRequest('${req.id}')">✓ Approva</button>`;
      }
      actionsHtml = `<div class="req-card-footer">${btns}</div>`;
    }

    return `<div class="req-card status-${req.status}" style="animation-delay:${idx * 0.05}s">
      <div class="req-card-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="req-card-type-wrap">
          <div class="req-type-icon">${typeIcons[req.type] || '📄'}</div>
          <div class="req-card-type">${typeLabels[req.type] || req.type}</div>
        </div>
        <div style="display:flex; align-items:center; gap:8px;">
          <div class="req-card-status status-pill-${req.status}">${statusIcons[req.status] || ''} ${statusLabels[req.status] || req.status}</div>
          <div class="expand-chevron">⌄</div>
        </div>
      </div>
      <div class="req-card-body">
        <div class="req-card-person">
          <div class="req-person-avatar">${initials}</div>
          <div class="req-person-name">${personName}</div>
        </div>
        ${swapHtml}
        ${descHtml}
        <div class="req-card-meta">
          ${dateDisplay ? `<div class="req-meta-chip"><span class="meta-icon">📅</span> <strong>${dateDisplay}</strong></div>` : ''}
          ${createdStr ? `<div class="req-meta-chip"><span class="meta-icon">🕒</span> ${createdStr}</div>` : ''}
        </div>
        ${approvedHtml}
      </div>
      ${actionsHtml}
    </div>`;
  }).join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const dStr = String(dateStr).split('T')[0];
  const parts = dStr.split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dStr;
}

// ── NEW REQUEST ───────────────────────────────────────────────
function openNewRequestModal(reqToEdit = null) {
  // Imposta stato globale: se reqToEdit è presente siamo in modalità modifica
  editingRequestId = reqToEdit ? reqToEdit.id : null;

  // Aggiorna il titolo della modale in funzione della modalità
  const modalTitle = document.querySelector('#newReqModal .modal-header h3, #newReqModal .modal-title');
  if (modalTitle) {
    modalTitle.textContent = editingRequestId ? 'Modifica Richiesta' : 'Nuova Richiesta';
  }

  // Aggiorna il testo del pulsante di submit (se esiste)
  const submitBtn = document.querySelector('#newReqModal button[onclick="submitNewRequest()"]');
  if (submitBtn) {
    submitBtn.textContent = editingRequestId ? 'Salva Modifiche' : 'Invia';
  }

  // Show nurse field only for admin
  document.getElementById('reqNurseField').style.display = isAdmin ? 'block' : 'none';

  // Populate nurse selects
  const nurseOptions = nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

  document.getElementById('reqNurse').innerHTML = nurseOptions;
  document.getElementById('reqSwapNurse').innerHTML = nurseOptions;

  if (reqToEdit) {
    // Popola il form con i dati della richiesta esistente
    document.getElementById('reqType').value = reqToEdit.type || 'FE';
    // Per swap cross-date: la "data principale" è dataRichiedente; fallback a startDate
    const primaryDate = reqToEdit.type === 'swap'
      ? (reqToEdit.dataRichiedente || reqToEdit.startDate || '')
      : (reqToEdit.startDate || '');
    document.getElementById('reqStartDate').value = primaryDate ? String(primaryDate).split('T')[0] : '';
    document.getElementById('reqEndDate').value = reqToEdit.endDate ? String(reqToEdit.endDate).split('T')[0] : '';
    document.getElementById('reqDesc').value = reqToEdit.desc || '';
    if (isAdmin && reqToEdit.nurseId) {
      document.getElementById('reqNurse').value = reqToEdit.nurseId;
    }
    onReqTypeChange();
    if (reqToEdit.type === 'swap') {
      const swapId = reqToEdit.swapNurseId || reqToEdit.nurseIdcambio || '';
      if (swapId) document.getElementById('reqSwapNurse').value = swapId;
      // Restaura data della controparte (cross-date)
      const cpDate = reqToEdit.dataCambio || reqToEdit.startDate || '';
      document.getElementById('reqSwapDate').value = cpDate ? String(cpDate).split('T')[0] : '';
      // Aggiorna i display dei turni
      refreshSwapShiftDisplays();
    }
  } else {
    // Reset form
    document.getElementById('reqType').value = 'FE';
    document.getElementById('reqStartDate').value = '';
    document.getElementById('reqEndDate').value = '';
    document.getElementById('reqDesc').value = '';
    const sd = document.getElementById('reqSwapDate');         if (sd) sd.value = '';
    const fs = document.getElementById('reqFromShiftDisplay'); if (fs) fs.value = '';
    const ts = document.getElementById('reqToShiftDisplay');   if (ts) ts.value = '';
    onReqTypeChange();
  }

  openModal('newReqModal');
}

// Wrapper: apre la modale in modalità modifica per la richiesta indicata
function editRequest(id) {
  const req = requests.find(r => String(r.id) === String(id));
  if (!req) { toast('Richiesta non trovata', 'error'); return; }
  if (req.status !== 'pending') {
    toast('Puoi modificare solo richieste ancora in attesa', 'warning');
    return;
  }
  // Verifica permessi (stessa logica del canDelete)
  const allowed = isAdmin || (currentUser && currentUser.nurseId === req.nurseId);
  if (!allowed) {
    toast('Non hai i permessi per modificare questa richiesta', 'warning');
    return;
  }
  openNewRequestModal(req);
}

function onReqTypeChange() {
  const type = document.getElementById('reqType').value;
  const isSwap = type === 'swap';
  const isRange = ['FE', 'AT'].includes(type);

  document.getElementById('reqEndField').style.display = isRange ? 'block' : 'none';
  document.getElementById('reqSwapField').style.display = isSwap ? 'block' : 'none';
  // Campi cross-date (solo swap)
  document.getElementById('reqSwapHint').style.display      = isSwap ? 'block' : 'none';
  document.getElementById('reqFromShiftField').style.display = isSwap ? 'block' : 'none';
  document.getElementById('reqSwapDateField').style.display  = isSwap ? 'block' : 'none';
  document.getElementById('reqToShiftField').style.display   = isSwap ? 'block' : 'none';

  // Label della data principale: per swap è "La tua data (turno che cederai)"
  document.getElementById('reqDateLabel').textContent = isSwap
    ? 'La tua data (turno che cederai)'
    : (isRange ? 'Data Inizio' : 'Data');

  // Reset display fields quando si cambia tipo
  if (!isSwap) {
    const fs = document.getElementById('reqFromShiftDisplay'); if (fs) fs.value = '';
    const ts = document.getElementById('reqToShiftDisplay');   if (ts) ts.value = '';
    const sd = document.getElementById('reqSwapDate');         if (sd) sd.value = '';
  }

  // Atualiza dropdown de enfermeiras de swap quando muda tipo
  if (isSwap) {
    updateSwapNurseOptions();
    refreshSwapShiftDisplays();
  }
}

function onReqDateChange() {
  const type = document.getElementById('reqType').value;
  if (type === 'swap') {
    updateSwapNurseOptions();
    refreshSwapShiftDisplays();
  }
}

function onReqSwapNurseChange() { refreshSwapShiftDisplays(); }
function onReqSwapDateChange()  { refreshSwapShiftDisplays(); }

// Helper: recupera il turno di un'infermiera su una data ISO arbitraria
function getShiftForDateMobile(nurseId, isoDate) {
  if (!nurseId || !isoDate) return '';
  const parts = String(isoDate).split('-');
  if (parts.length !== 3) return '';
  const y = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[2], 10);
  if (isNaN(y) || isNaN(m) || isNaN(d)) return '';
  return schedule[`${nurseId}_${m}_${y}_${d}`] || '';
}

// Popola i campi readonly dei turni (richiedente e controparte) in base alle date/nurse
function refreshSwapShiftDisplays() {
  const startDate = document.getElementById('reqStartDate').value;
  const swapDate  = document.getElementById('reqSwapDate').value;

  // Risolve il richiedente (admin: dropdown reqNurse; altrimenti currentUser)
  let requesterId = '';
  if (isAdmin) {
    requesterId = document.getElementById('reqNurse').value;
  } else if (currentUser) {
    requesterId = currentUser.nurseId;
  }
  const swapNurseId = document.getElementById('reqSwapNurse').value;

  const fromShiftCode = getShiftForDateMobile(requesterId, startDate);
  const toShiftCode   = getShiftForDateMobile(swapNurseId, swapDate);

  const fromEl = document.getElementById('reqFromShiftDisplay');
  const toEl   = document.getElementById('reqToShiftDisplay');
  if (fromEl) {
    fromEl.value = fromShiftCode
      ? `${fromShiftCode} — ${SHIFTS[fromShiftCode]?.name || fromShiftCode}`
      : '';
  }
  if (toEl) {
    toEl.value = toShiftCode
      ? `${toShiftCode} — ${SHIFTS[toShiftCode]?.name || toShiftCode}`
      : '';
  }
}

function updateSwapNurseOptions() {
  const sel = document.getElementById('reqSwapNurse');

  // Determina quem está solicitando para excluí-lo da lista
  let requesterId = '';
  if (isAdmin) {
    requesterId = document.getElementById('reqNurse').value;
  } else if (currentUser) {
    requesterId = currentUser.nurseId;
  }

  // Mostra todas as enfermeiras (exceto o solicitante)
  const available = nurses.filter(n => n.id !== requesterId);

  if (available.length === 0) {
    sel.innerHTML = '<option value="">— Nessuna disponibile —</option>';
  } else {
    sel.innerHTML = available.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
  }
}

async function submitNewRequest() {
  const type = document.getElementById('reqType').value;
  const startDate = document.getElementById('reqStartDate').value;
  const endDate = document.getElementById('reqEndDate').value || startDate;
  const desc = document.getElementById('reqDesc').value;

  // Validação obrigatória: tipo da solicitação
  if (!type) {
    toast('Seleziona il tipo di richiesta', 'warning');
    return;
  }

  // Validação obrigatória: data de início
  if (!startDate) {
    toast('Compila la data', 'warning');
    return;
  }

  // Para tipos com intervalo de datas (ferie/permesso), data fim é obrigatória
  if (['FE', 'AT'].includes(type)) {
    const endDateValue = document.getElementById('reqEndDate').value;
    if (!endDateValue) {
      toast('Compila la data di fine', 'warning');
      return;
    }
    // Valida que data fim não é anterior à data início
    if (endDateValue < startDate) {
      toast('La data di fine non può essere precedente a quella di inizio', 'warning');
      return;
    }
  }

  let nurseId, nurseName;
  if (isAdmin) {
    nurseId = document.getElementById('reqNurse').value;
    // Validação obrigatória para admin: seleção do funcionário
    if (!nurseId) {
      toast('Seleziona il personale', 'warning');
      return;
    }
    const nurse = nurses.find(n => n.id === nurseId);
    nurseName = nurse ? nurse.name : '';
  } else {
    nurseId = currentUser.nurseId;
    nurseName = currentUser.nome;
  }

  // Captura dados da enfermeira de troca (swap)
  let swapNurseId = '', swapNurseName = '';
  // Cross-date swap fields
  let dataRichiedente = '', dataCambio = '', turnoRichiedente = '', turnoCambio = '';
  if (type === 'swap') {
    swapNurseId = document.getElementById('reqSwapNurse').value;
    const swapNurse = nurses.find(n => n.id === swapNurseId);
    swapNurseName = swapNurse ? swapNurse.name : '';
    if (!swapNurseId) {
      toast('Seleziona la persona per il cambio', 'warning');
      return;
    }
    // Evita troca consigo mesmo
    if (swapNurseId === nurseId) {
      toast('Non puoi scambiare il turno con te stesso', 'warning');
      return;
    }

    // Data della controparte (cross-date)
    const swapDateValue = document.getElementById('reqSwapDate').value;
    if (!swapDateValue) {
      toast('Compila la data della controparte', 'warning');
      return;
    }
    // Stesso mese/anno della data del richiedente (coerenza temporale)
    const dA = new Date(startDate + 'T00:00:00');
    const dB = new Date(swapDateValue + 'T00:00:00');
    if (dA.getFullYear() !== dB.getFullYear() || dA.getMonth() !== dB.getMonth()) {
      toast('Le due date devono essere nello stesso mese', 'warning');
      return;
    }

    dataRichiedente = startDate;
    dataCambio = swapDateValue;
    turnoRichiedente = getShiftForDateMobile(nurseId, dataRichiedente) || '';
    turnoCambio      = getShiftForDateMobile(swapNurseId, dataCambio) || '';

    // Defense-in-depth: entrambi devono avere un turno in quelle date
    if (!turnoRichiedente) {
      toast('Non hai un turno assegnato in questa data', 'warning');
      return;
    }
    if (!turnoCambio) {
      toast('La controparte non ha un turno assegnato in questa data', 'warning');
      return;
    }
    // Se stessa data e stesso turno, nulla da scambiare
    if (dataRichiedente === dataCambio && turnoRichiedente === turnoCambio) {
      toast('I turni sono uguali, nulla da scambiare', 'warning');
      return;
    }
  }

  // Se siamo in modalità modifica aggiorniamo la richiesta esistente,
  // altrimenti creiamo una nuova richiesta in stato "pending".
  if (editingRequestId) {
    const existing = requests.find(r => String(r.id) === String(editingRequestId));
    if (!existing) {
      toast('Richiesta non trovata', 'error');
      editingRequestId = null;
      return;
    }
    if (existing.status !== 'pending') {
      toast('Puoi modificare solo richieste ancora in attesa', 'warning');
      editingRequestId = null;
      return;
    }

    const updates = {
      type,
      nurseId,
      nurseName,
      nursecambio: swapNurseName,
      nurseIdcambio: swapNurseId,
      startDate,
      endDate: ['FE', 'AT'].includes(type) ? endDate : startDate,
      desc,
      swapNurseId,
      swapNurseName,
      // Cross-date swap fields (vazios per tipi diversi da swap)
      dataRichiedente,
      dataCambio,
      turnoRichiedente,
      turnoCambio
    };

    showLoading(true);
    try {
      await apiUpdate('Solicitacoes', 'id', editingRequestId, updates);
      Object.assign(existing, updates);
      cacheSet('Solicitacoes', requests);
      renderRequests();
      updateBadges();
      closeModal('newReqModal');
      toast('Richiesta aggiornata!', 'success');
    } catch (e) {
      console.error('❌ submitNewRequest (edit):', e.message);
      toast("Errore durante l'aggiornamento della richiesta", 'error');
    }
    editingRequestId = null;
    showLoading(false);
    return;
  }

  const req = {
    id: generateId(),
    type,
    status: 'pending',
    nurseId,
    nurseName,
    nursecambio: swapNurseName,
    nurseIdcambio: swapNurseId,
    startDate,
    endDate: ['FE', 'AT'].includes(type) ? endDate : startDate,
    desc,
    swapNurseId,
    swapNurseName,
    // Cross-date swap fields
    dataRichiedente,
    dataCambio,
    turnoRichiedente,
    turnoCambio,
    createdAt: new Date().toISOString(),
    approvedAt: '',
    approvedBy: ''
  };

  showLoading(true);
  try {
    await apiWrite('Solicitacoes', req);
    requests.push(req);
    cacheSet('Solicitacoes', requests);
    renderRequests();
    updateBadges();
    closeModal('newReqModal');
    toast('Richiesta inviata!', 'success');
  } catch (e) {
    console.error('❌ submitNewRequest:', e.message);
    toast("Errore durante l'invio della richiesta", 'error');
  }
  showLoading(false);
}

// ── APPLY APPROVED SWAP ENGINE ────────────────────────────────
// Aplica imediatamente a troca de turno aprovada na sheet Escala.
// Suporta swap mesmo dia (2 células) e cross-date (4 células simétricas).
// Idempotente: usa snapshot turnoRichiedente/turnoCambio para detectar reaplicação.
async function applyApprovedSwapMobile(req) {
  if (!req || req.type !== 'swap') return { applied: false, reason: 'not-swap' };
  // Idempotência: aceita boolean true OU string 'TRUE' vinda do cloud
  if (req.autoApplied === true) return { applied: false, reason: 'already-applied' };
  if (typeof req.autoApplied === 'string' && req.autoApplied.trim().toUpperCase() === 'TRUE') {
    req.autoApplied = true;
    return { applied: false, reason: 'already-applied-cloud' };
  }

  const nurseId     = String(req.nurseId || req.fromNurseId || '').trim();
  const swapNurseId = String(req.nurseIdcambio || req.swapNurseId || req.toNurseId || '').trim();
  if (!nurseId || !swapNurseId) return { applied: false, reason: 'missing-nurses' };

  const fromDateStr = String(req.dataRichiedente || req.startDate || req.date || '').slice(0, 10);
  const toDateStr   = String(req.dataCambio      || req.startDate || req.date || '').slice(0, 10);
  if (!fromDateStr || !toDateStr) return { applied: false, reason: 'missing-dates' };

  const fromDate = new Date(fromDateStr + 'T00:00:00');
  const toDate   = new Date(toDateStr   + 'T00:00:00');
  const m = fromDate.getMonth();
  const y = fromDate.getFullYear();
  if (toDate.getMonth() !== m || toDate.getFullYear() !== y) {
    return { applied: false, reason: 'cross-month-not-supported' };
  }
  const fromDay = fromDate.getDate();
  const toDay   = toDate.getDate();

  // Lê rows frescos do cloud para garantir consistência
  let escalaData;
  try {
    escalaData = await apiRead('Escala');
  } catch (e) {
    console.warn('[APPLY-SWAP] apiRead Escala falhou, uso cache:', e.message);
    const cached = cacheGet('Escala');
    escalaData = cached && Array.isArray(cached.data) ? cached.data : null;
  }
  if (!Array.isArray(escalaData)) return { applied: false, reason: 'no-escala-data' };

  const targetMonth = String(m + 1);
  const targetYear  = String(y);
  const monthRows = escalaData.filter(r =>
    String(r.month) === targetMonth && String(r.year) === targetYear
  );
  const reqRow = monthRows.find(r => String(r.nurseId) === nurseId);
  const cpRow  = monthRows.find(r => String(r.nurseId) === swapNurseId);
  if (!reqRow || !cpRow) return { applied: false, reason: 'nurse-row-not-found' };

  const cellVal = (row, day) => String(row['d' + day] || '').trim();

  if (fromDay === toDay) {
    // Swap legacy mesmo dia (2 células)
    const a = cellVal(reqRow, fromDay);
    const b = cellVal(cpRow,  fromDay);
    if (a === b) return { applied: true, reason: 'noop-equal-shifts' };
    if (!a || !b) return { applied: false, reason: 'missing-shift-cell' };
    reqRow['d' + fromDay] = b;
    cpRow['d'  + fromDay] = a;
  } else {
    // Cross-date 4-cell swap com snapshot idempotency
    const snapFrom = String(req.turnoRichiedente || '').trim();
    const snapTo   = String(req.turnoCambio      || '').trim();
    const reqOnFrom = cellVal(reqRow, fromDay);
    const cpOnFrom  = cellVal(cpRow,  fromDay);
    const reqOnTo   = cellVal(reqRow, toDay);
    const cpOnTo    = cellVal(cpRow,  toDay);

    // Já aplicado: o estado pós-swap bate com o snapshot trocado
    if (snapFrom && snapTo && cpOnFrom === snapFrom && reqOnTo === snapTo) {
      return { applied: true, reason: 'already-applied-detected' };
    }
    // Sanity check: estado atual deve bater com snapshot original
    if (snapFrom && snapTo) {
      if (reqOnFrom !== snapFrom || cpOnTo !== snapTo) {
        console.warn(`[APPLY-SWAP] Stato incoerente per ${req.id}, salto.`,
          { fromDay, reqOnFrom, snapFrom, toDay, cpOnTo, snapTo });
        return { applied: false, reason: 'inconsistent-state' };
      }
    }
    // Scambio simmetrico a 4 celle
    reqRow['d' + fromDay] = cpOnFrom;
    cpRow['d'  + fromDay] = reqOnFrom;
    reqRow['d' + toDay]   = cpOnTo;
    cpRow['d'  + toDay]   = reqOnTo;
  }

  // Push no cloud: bulkWrite limpando o mês inteiro e regravando
  try {
    await apiCall('bulkWrite', 'Escala', {
      clearFilter: [
        { column: 'month', value: targetMonth },
        { column: 'year',  value: targetYear }
      ],
      rows: monthRows
    });
  } catch (e) {
    console.error('[APPLY-SWAP] bulkWrite falhou:', e.message);
    return { applied: false, reason: 'bulkwrite-failed: ' + e.message };
  }

  // Atualiza cache e schedule em memória
  cacheSet('Escala', escalaData);
  if (currentMonth.getMonth() === m && currentMonth.getFullYear() === y) {
    parseSchedule(escalaData);
  }

  return { applied: true, reason: 'ok' };
}

// ── APPROVE / REJECT ──────────────────────────────────────────
async function approveRequest(id) {
  showLoading(true);
  try {
    const req = requests.find(r => String(r.id) === String(id));
    if (!req) {
      toast('Richiesta non trovata', 'error');
      showLoading(false);
      return;
    }

    // 1) Aprova na sheet Solicitacoes
    await apiUpdate('Solicitacoes', 'id', id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: currentUser.nome
    });
    req.status = 'approved';
    req.approvedAt = new Date().toISOString();
    req.approvedBy = currentUser.nome;

    // 2) Se for swap, aplica imediatamente a troca na Escala
    if (req.type === 'swap') {
      const result = await applyApprovedSwapMobile(req);
      if (result.applied) {
        req.autoApplied = true;
        // Persiste flag no cloud para que o Web App Local não tente aplicar de novo
        try {
          await apiUpdate('Solicitacoes', 'id', id, { autoApplied: 'TRUE' });
        } catch (e) {
          console.warn('[APPROVE] Não conseguiu marcar autoApplied no cloud:', e.message);
        }
        toast('Richiesta approvata e turno scambiato!', 'success');
        // Atualiza calendário se a tela atual mostra
        if (typeof renderCalendar === 'function') renderCalendar();
      } else {
        console.warn('[APPROVE] Swap non applicato:', result.reason);
        toast('Approvata, ma scambio non applicato: ' + result.reason, 'warning');
      }
    } else {
      toast('Richiesta approvata!', 'success');
    }

    cacheSet('Solicitacoes', requests);
    renderRequests();
    updateBadges();
  } catch (e) {
    console.error('❌ approveRequest:', e.message);
    toast("Errore durante l'approvazione", 'error');
  }
  showLoading(false);
}

async function rejectRequest(id) {
  showLoading(true);
  try {
    await apiUpdate('Solicitacoes', 'id', id, {
      status: 'rejected',
      approvedAt: new Date().toISOString(),
      approvedBy: currentUser.nome
    });
    const req = requests.find(r => String(r.id) === String(id));
    if (req) {
      req.status = 'rejected';
      req.approvedAt = new Date().toISOString();
      req.approvedBy = currentUser.nome;
    }
    cacheSet('Solicitacoes', requests);
    renderRequests();
    updateBadges();
    toast('Richiesta rifiutata', 'warning');
  } catch (e) {
    console.error('❌ rejectRequest:', e.message);
    toast('Errore durante il rifiuto', 'error');
  }
  showLoading(false);
}

async function deleteRequest(id) {
  // Difesa in profondità: non si può eliminare una richiesta già approvata o rifiutata.
  const req = requests.find(r => String(r.id) === String(id));
  if (!req) { toast('Richiesta non trovata', 'error'); return; }
  if (req.status !== 'pending') {
    toast('Non puoi eliminare una richiesta già approvata o rifiutata', 'warning');
    return;
  }
  if (!confirm('Sei sicuro di voler eliminare questa richiesta?')) return;
  showLoading(true);
  try {
    await apiDelete('Solicitacoes', 'id', id);
    requests = requests.filter(r => String(r.id) !== String(id));
    cacheSet('Solicitacoes', requests);
    renderRequests();
    updateBadges();
    toast('Richiesta eliminata', 'info');
  } catch (e) {
    console.error('❌ deleteRequest:', e.message);
    toast("Errore durante l'eliminazione", 'error');
  }
  showLoading(false);
}

// ── BADGES ────────────────────────────────────────────────────
function updateBadges() {
  const pending = requests.filter(r => r.status === 'pending').length;

  const navBadge = document.getElementById('navBadge');
  navBadge.style.display = pending > 0 ? 'flex' : 'none';
  navBadge.textContent = pending;

  const pendingCount = document.getElementById('pendingCount');
  pendingCount.textContent = pending;
}

// ── ADMIN: USER MANAGEMENT ───────────────────────────────────
function renderAdminUsers() {
  const list = document.getElementById('adminUsersList');

  if (appUsers.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Nessun utente registrato</p></div>';
    return;
  }

  list.innerHTML = appUsers.map(user => {
    const initials = user.nome.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const linkedNurse = nurses.find(n => String(n.id) === String(user.nurseId));
    const nurseName = linkedNurse ? linkedNurse.name : 'Non collegato';

    return `<div class="user-card" onclick="openEditUserModal('${user.id}')">
      <div class="user-avatar role-${user.role}">${initials}</div>
      <div class="user-info">
        <div class="user-info-name">${user.nome}</div>
        <div class="user-info-meta">
          <span class="role-badge ${user.role}">${user.role === 'admin' ? 'Admin' : 'Utente'}</span>
          <span>${nurseName}</span>
        </div>
      </div>
      <div class="user-edit-chevron">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>
      </div>
    </div>`;
  }).join('');
}

function openAddUserModal() {
  document.getElementById('newUserName').value = '';
  document.getElementById('newUserPass').value = '';
  document.getElementById('newUserRole').value = 'user';

  // Populate nurse select
  document.getElementById('newUserNurse').innerHTML = '<option value="">-- Nessuno --</option>' +
    nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

  openModal('addUserModal');
}

async function submitNewUser() {
  const nome = document.getElementById('newUserName').value.trim();
  const nurseId = document.getElementById('newUserNurse').value;
  const senha = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;

  if (!nome || !senha) {
    toast('Compila nome e password', 'warning');
    return;
  }

  const newUser = {
    id: 'user_' + generateId(),
    nome,
    senha,
    role,
    nurseId
  };

  showLoading(true);
  try {
    await apiWrite('Usuarios', newUser);
    appUsers.push(newUser);
    cacheSet('Usuarios', appUsers);
    renderAdminUsers();
    closeModal('addUserModal');
    toast(`${nome} registrato!`, 'success');
  } catch (e) {
    console.error('❌ submitNewUser:', e.message);
    toast('Errore di registrazione', 'error');
  }
  showLoading(false);
}

function openEditUserModal(userId) {
  const user = appUsers.find(u => String(u.id) === String(userId));
  if (!user) return;

  document.getElementById('editUserId').value = user.id;
  document.getElementById('editUserName').value = user.nome;
  document.getElementById('editUserPass').value = '';
  document.getElementById('editUserRole').value = user.role;

  openModal('editUserModal');
}

async function submitEditUser() {
  const id = document.getElementById('editUserId').value;
  const nome = document.getElementById('editUserName').value.trim();
  const senha = document.getElementById('editUserPass').value;
  const role = document.getElementById('editUserRole').value;

  if (!nome) { toast('Compila il nome', 'warning'); return; }

  const updates = { nome, role };
  if (senha) updates.senha = senha;

  showLoading(true);
  try {
    await apiUpdate('Usuarios', 'id', id, updates);
    const user = appUsers.find(u => String(u.id) === String(id));
    if (user) {
      user.nome = nome;
      user.role = role;
      if (senha) user.senha = senha;
    }
    cacheSet('Usuarios', appUsers);
    renderAdminUsers();
    closeModal('editUserModal');
    toast('Utente aggiornato!', 'success');
  } catch (e) {
    console.error('❌ submitEditUser:', e.message);
    toast("Errore durante l'aggiornamento", 'error');
  }
  showLoading(false);
}

async function deleteUser() {
  const id = document.getElementById('editUserId').value;
  const user = appUsers.find(u => String(u.id) === String(id));

  if (user && user.role === 'admin' && appUsers.filter(u => u.role === 'admin').length <= 1) {
    toast("Non è possibile eliminare l'unico amministratore", 'error');
    return;
  }

  if (!confirm(`Eliminare ${user?.nome}?`)) return;

  showLoading(true);
  try {
    await apiDelete('Usuarios', 'id', id);
    appUsers = appUsers.filter(u => String(u.id) !== String(id));
    cacheSet('Usuarios', appUsers);
    renderAdminUsers();
    closeModal('editUserModal');
    toast('Utente eliminato', 'info');
  } catch (e) {
    console.error('❌ deleteUser:', e.message);
    toast("Errore durante l'eliminazione", 'error');
  }
  showLoading(false);
}

// ── REPORT TAB (NON-ADMIN ONLY) ──────────────────────────────
let reportMonth = new Date();
reportMonth.setDate(1);

function changeReportMonth(dir) {
  reportMonth = new Date(reportMonth.getFullYear(), reportMonth.getMonth() + dir, 1);
  renderReportTab();
}

function renderReportTab() {
  const container = document.getElementById('reportContent');
  const monthLabel = document.getElementById('reportMonthLabel');
  if (!container || !monthLabel) return;

  // Only render for non-admin with a linked nurseId
  if (isAdmin || !currentUser || !currentUser.nurseId) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Nessun dato disponibile</p></div>`;
    return;
  }

  const nId = currentUser.nurseId;
  const nurse = nurses.find(n => n.id === nId);
  if (!nurse) {
    container.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><p>Dipendente non trovato</p></div>`;
    return;
  }

  // Update month label
  const rm = reportMonth.getMonth();
  const ry = reportMonth.getFullYear();
  monthLabel.textContent = `${MONTH_NAMES[rm]} ${ry}`;

  // Get ALL raw escala data from cache
  const rawEscala = (() => {
    const c = cacheGet('Escala');
    return (c && Array.isArray(c.data)) ? c.data : [];
  })();

  // Filter rows for this nurse and the selected report month
  const myRow = rawEscala.find(r =>
    String(r.nurseId).trim() === String(nId).trim() &&
    String(r.month).trim() === String(rm + 1) &&
    String(r.year).trim() === String(ry)
  );

  if (!myRow) {
    container.innerHTML = `<div class="empty-state" style="padding:40px 20px;"><div class="empty-icon">📅</div><p>Nessun turno pubblicato per ${MONTH_NAMES[rm]} ${ry}</p></div>`;
    return;
  }

  const daysInMo = new Date(ry, rm + 1, 0).getDate();

  // Calculate metrics for this month
  let totalH = 0, workDays = 0, restDays = 0, nightCount = 0;
  let feDays = 0, atDays = 0, festiviWorked = 0;
  const shiftCounts = {};
  const activeCodes = ['M1','M2','MF','G','P','PF','N','FE','AT','OFF'];

  for (let d = 1; d <= daysInMo; d++) {
    const val = String(myRow['d' + d] || '').trim();
    if (!val || val === 'undefined') continue;
    const sh = SHIFTS[val];
    if (!sh) continue;

    totalH += sh.h;
    shiftCounts[val] = (shiftCounts[val] || 0) + 1;

    if (val === 'OFF') { restDays++; }
    else if (val === 'FE') { feDays++; restDays++; }
    else if (val === 'AT') { atDays++; restDays++; }
    else { workDays++; }

    if (val === 'N') { nightCount++; }

    const dow = new Date(ry, rm, d).getDay();
    if ((dow === 0 || dow === 6) && !['OFF','FE','AT'].includes(val)) {
      festiviWorked++;
    }
  }

  // Night quota
  const nightQuota = nurse.nightQuota || 5;
  const nightPct = nightQuota > 0 ? Math.min((nightCount / nightQuota) * 100, 100).toFixed(0) : '0';
  const nightColor = nightCount > nightQuota ? '#ef4444' : parseInt(nightPct) >= 90 ? '#fbbf24' : '#8b5cf6';

  // Accumulated metrics (all months)
  const allMyRows = rawEscala.filter(r => String(r.nurseId).trim() === String(nId).trim());
  let accH = 0, accWork = 0, accNights = 0, accMonths = 0;
  const monthlyBreakdown = [];

  allMyRows.forEach(row => {
    const rowMonth = parseInt(String(row.month || '0').trim());
    const rowYear = parseInt(String(row.year || '0').trim());
    if (rowMonth < 1 || rowMonth > 12 || !rowYear) return;
    const mo = rowMonth - 1;
    const dimm = new Date(rowYear, mo + 1, 0).getDate();
    let mH = 0, mW = 0, mN = 0;

    for (let d = 1; d <= dimm; d++) {
      const v = String(row['d' + d] || '').trim();
      if (!v || v === 'undefined') continue;
      const s = SHIFTS[v];
      if (!s) continue;
      mH += s.h;
      if (!['OFF','FE','AT'].includes(v)) mW++;
      if (v === 'N') mN++;
    }

    accH += mH; accWork += mW; accNights += mN;
    accMonths++;
    monthlyBreakdown.push({
      month: mo, year: rowYear,
      label: MONTH_NAMES[mo].substring(0, 3),
      hours: mH, nights: mN, workDays: mW,
      isCurrent: mo === rm && rowYear === ry
    });
  });

  monthlyBreakdown.sort((a, b) => (a.year * 12 + a.month) - (b.year * 12 + b.month));

  // Pending requests count
  const pendingReqs = requests.filter(r =>
    String(r.nurseId) === String(nId) && r.status === 'pending'
  ).length;

  // Build HTML
  container.innerHTML = `
    <!-- KPI Cards -->
    <div class="rpt-kpi-grid">
      <div class="rpt-kpi-card rpt-accent-purple">
        <div class="rpt-kpi-icon">⏱</div>
        <div class="rpt-kpi-val">${totalH.toFixed(1)}h</div>
        <div class="rpt-kpi-lbl">Ore Mensili</div>
      </div>
      <div class="rpt-kpi-card rpt-accent-blue">
        <div class="rpt-kpi-icon">📋</div>
        <div class="rpt-kpi-val">${workDays}</div>
        <div class="rpt-kpi-lbl">Giorni Lavorati</div>
      </div>
      <div class="rpt-kpi-card rpt-accent-green">
        <div class="rpt-kpi-icon">🛌</div>
        <div class="rpt-kpi-val">${restDays}</div>
        <div class="rpt-kpi-lbl">Giorni Riposo</div>
      </div>
      <div class="rpt-kpi-card rpt-accent-indigo">
        <div class="rpt-kpi-icon">🌙</div>
        <div class="rpt-kpi-val">${nightCount}</div>
        <div class="rpt-kpi-lbl">Notti</div>
      </div>
    </div>

    <!-- Absence & Festival summary -->
    <div class="rpt-absence-grid">
      <div class="rpt-absence-card rpt-abs-fe">
        <div class="rpt-abs-val">${feDays}</div>
        <div class="rpt-abs-lbl">Ferie</div>
      </div>
      <div class="rpt-absence-card rpt-abs-at">
        <div class="rpt-abs-val">${atDays}</div>
        <div class="rpt-abs-lbl">Certificati</div>
      </div>
      <div class="rpt-absence-card rpt-abs-fest">
        <div class="rpt-abs-val">${festiviWorked}</div>
        <div class="rpt-abs-lbl">Festivi Lavorati</div>
      </div>
      <div class="rpt-absence-card rpt-abs-pend">
        <div class="rpt-abs-val">${pendingReqs}</div>
        <div class="rpt-abs-lbl">Richieste In Attesa</div>
      </div>
    </div>

    <!-- Shift Distribution -->
    <div class="rpt-section">
      <div class="rpt-section-title">Distribuzione Turni</div>
      <div class="rpt-shift-grid">
        ${activeCodes.map(c => {
          const s = SHIFTS[c];
          const cnt = shiftCounts[c] || 0;
          const opacity = cnt > 0 ? '1' : '0.3';
          return `<div class="rpt-shift-chip" style="background:${s.color}; opacity:${opacity};">
            <span class="rpt-shift-code" style="color:${s.text}">${c}</span>
            <span class="rpt-shift-count" style="color:${s.text}">${cnt}</span>
          </div>`;
        }).join('')}
      </div>
    </div>

    <!-- Night Quota Bar -->
    <div class="rpt-section">
      <div class="rpt-bar-header">
        <span>🌙 Quota Notti del Mese</span>
        <span style="color:${nightColor}; font-weight:800;">${nightCount}/${nightQuota}</span>
      </div>
      <div class="rpt-bar-track">
        <div class="rpt-bar-fill" style="width:${nightPct}%; background:${nightColor};"></div>
      </div>
    </div>

    <!-- Accumulated Overview -->
    ${accMonths > 0 ? `
    <div class="rpt-section rpt-acc-section">
      <div class="rpt-section-title">📈 Riepilogo Accumulato (${accMonths} ${accMonths === 1 ? 'mese' : 'mesi'})</div>
      <div class="rpt-acc-row">
        <div class="rpt-acc-item">
          <span class="rpt-acc-val">${accH.toFixed(0)}h</span>
          <span class="rpt-acc-lbl">Ore Totali</span>
        </div>
        <div class="rpt-acc-item">
          <span class="rpt-acc-val">${accWork}</span>
          <span class="rpt-acc-lbl">Giorni Lavorati</span>
        </div>
        <div class="rpt-acc-item">
          <span class="rpt-acc-val">${accNights}</span>
          <span class="rpt-acc-lbl">Notti Totali</span>
        </div>
      </div>
    </div>` : ''}

    <!-- Monthly Breakdown -->
    ${monthlyBreakdown.length > 1 ? `
    <div class="rpt-section">
      <div class="rpt-section-title">📅 Dettaglio Mensile</div>
      <div class="rpt-monthly-list">
        ${monthlyBreakdown.map(md => {
          const maxH = Math.max(...monthlyBreakdown.map(x => x.hours), 1);
          const barW = ((md.hours / maxH) * 100).toFixed(0);
          return `<div class="rpt-monthly-row ${md.isCurrent ? 'rpt-month-active' : ''}">
            <span class="rpt-monthly-label">${md.label}</span>
            <div class="rpt-monthly-bar-track">
              <div class="rpt-monthly-bar-fill" style="width:${barW}%;"></div>
            </div>
            <span class="rpt-monthly-val">${md.hours.toFixed(0)}h</span>
            <span class="rpt-monthly-extra">${md.nights}N</span>
          </div>`;
        }).join('')}
      </div>
    </div>` : ''}
  `;
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
  // Se viene chiusa la modale di richiesta, azzera lo stato di editing
  if (id === 'newReqModal') {
    editingRequestId = null;
  }
}

// Close modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
    // Azzera stato di editing se la modale chiusa è quella delle richieste
    if (e.target.id === 'newReqModal') {
      editingRequestId = null;
    }
  }
});

// ── TOAST ─────────────────────────────────────────────────────
function toast(msg, type = 'success', dur = 3000) {
  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-icon">${icons[type] || '•'}</span><span>${msg}</span>`;
  document.getElementById('toastContainer').appendChild(el);
  setTimeout(() => {
    el.classList.add('hiding');
    setTimeout(() => el.remove(), 300);
  }, dur);
}
