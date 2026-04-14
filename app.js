// ============================================================
//  Cotolengo Escala — Mobile PWA — app.js v1.0
//  Lógica completa: Auth, Swipe, Calendário, Solicitações, Admin
// ============================================================

// ── CONFIG ────────────────────────────────────────────────────
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbwsfN_I_dP8H6C7odQDPeppoecyiUPAtdo6_P3bBgIj_vfMULKX6Qm5XyZB4P2zmYWiqQ/exec';
const API_KEY = 'cotolengo_2026_secure_key';

// ── UTILS: SHA-256 Hash (para senhas) ───────────────────────
async function sha256(text) {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── UTILS: Gerar ID único ────────────────────────────────
function generateId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now() + '-' + Math.random().toString(36).substring(2, 9);
}

const SHIFTS = {
  'M1': { name:'Mattina 1',     h:7.0,  color:'#f59e0b', text:'#1a1a00', period:'morning' },
  'M2': { name:'Mattina 2',     h:4.5,  color:'#fcd34d', text:'#1a1a00', period:'morning' },
  'MF': { name:'Mattina Festivo',h:7.5, color:'#f97316', text:'#fff',    period:'morning' },
  'G':  { name:'Giornata',     h:9.5,  color:'#0ea5e9', text:'#fff',    period:'morning' },
  'P':  { name:'Pomeriggio',       h:8.5,  color:'#8b5cf6', text:'#fff',    period:'afternoon' },
  'PF': { name:'Pomeriggio Festivo',h:10,  color:'#a78bfa', text:'#fff',    period:'afternoon' },
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

// ── HELPERS: Normalizar dados do Sheet ───────────────────────
// O Sheet usa colunas ID_Funcionario / Nome, mas o app interno usa id / name
function getNurseId(n) { return n.id || n.ID_Funcionario || n.Id || n.ID || ''; }
function getNurseName(n) { return n.name || n.Nome || n.nome || n.Name || ''; }
function normalizeNurses(rawList) {
  return rawList.map(n => ({
    id: String(getNurseId(n)),
    name: getNurseName(n),
    initials: (getNurseName(n)).split(' ').map(w => w[0]).join('').substring(0,2).toUpperCase(),
    nightQuota: n.nightQuota || n.Carga_Horaria_Mensal || 5
  })).filter(n => n.id && n.name);
}

// ── INIT ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  registerServiceWorker();
  showSplash();
});

function registerServiceWorker() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW:', e));
  }
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  document.getElementById('installPwaBtn').style.display = 'flex';
});

function installApp() {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    deferredPrompt.userChoice.then((choiceResult) => {
      if (choiceResult.outcome === 'accepted') {
        document.getElementById('installPwaBtn').style.display = 'none';
      }
      deferredPrompt = null;
    });
  } else {
    // Show manual install info for iOS
    document.getElementById('pwaInstallModal').classList.remove('hidden');
  }
}

function togglePassword() {
  const input = document.getElementById('loginPass');
  const toggle = document.querySelector('.pw-toggle');
  if (input.type === 'password') {
    input.type = 'text';
    if (toggle) toggle.textContent = '🙈';
  } else {
    input.type = 'password';
    if (toggle) toggle.textContent = '👁️';
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

  // Load users for login dropdown
  let usersResult;
  try {
    usersResult = await apiRead('Usuarios');
    console.log('✅ Users loaded:', usersResult.length, 'users');
  } catch (e) {
    console.error('❌ Failed to load users:', e.message);
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
  }

  // Populate login dropdown
  const loginSelect = document.getElementById('loginUser');
  loginSelect.innerHTML = '<option value="">Seleziona il tuo nome...</option>' +
    appUsers.map(u => `<option value="${u.id}">${u.nome}${u.role === 'admin' ? ' (Admin)' : ''}</option>`).join('');
  console.log('✅ Login dropdown populated with', appUsers.length, 'users');
}

async function ensureSheetSetup() {
  // Ensure the required sheets exist — NÃO toca em Funcionarios (já existe com seus próprios headers)
  try {
    await apiCall('setupHeaders', 'Usuarios', { headers: ['id', 'nome', 'senha', 'role', 'nurseId'] });
    await apiCall('setupHeaders', 'Solicitacoes', { headers: ['id', 'type', 'status', 'nurseId', 'nurseName', 'startDate', 'endDate', 'desc', 'createdAt', 'approvedAt', 'approvedBy'] });
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
}

function enterApp() {
  document.getElementById('loginScreen').classList.remove('active');
  document.getElementById('mainApp').classList.add('active');

  // Set header info
  const initials = currentUser.nome.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
  document.getElementById('headerAvatar').textContent = initials;
  document.getElementById('headerName').textContent = currentUser.nome;
  document.getElementById('headerRole').textContent = isAdmin ? 'Amministratore' : 'Dipendente';

  // Show/hide admin tab
  totalPages = isAdmin ? 3 : 2;
  document.getElementById('navAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('dotAdmin').style.display = isAdmin ? 'block' : 'none';
  document.getElementById('pageAdmin').style.display = isAdmin ? 'block' : 'none';

  // Build UI
  buildLegend();
  buildCalendarFilter();
  updateMonthDisplay();
  setupSwipe();
  loadAllData();
}

// ── CALENDAR FILTER ──────────────────────────────────────────
function buildCalendarFilter() {
  // Filtro visível para todos agora
}

function populateCalendarFilter() {
  const sel = document.getElementById('calNurseFilter');
  if (!sel) return;
  // Non-admin: auto-select their own nurse; admin: default to "all"
  if (!isAdmin && currentUser && currentUser.nurseId) {
    sel.innerHTML = nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    sel.value = currentUser.nurseId;
    calNurseFilter = currentUser.nurseId;
  } else {
    sel.innerHTML = '<option value="all">👥 Tutti i dipendenti</option>' +
      nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
    sel.value = calNurseFilter;
  }
}

function onCalFilterChange() {
  calNurseFilter = document.getElementById('calNurseFilter').value;
  renderCalendar();
}

// ── DATA LOADING ──────────────────────────────────────────────
async function loadAllData() {
  showLoading(true);
  let hasErrors = false;

  try {
    // Load nurses (normaliza colunas do Sheet)
    try {
      const nursesData = await apiRead('Funcionarios');
      console.log('📋 Raw Funcionarios:', nursesData);
      if (nursesData && nursesData.length > 0) {
        nurses = normalizeNurses(nursesData);
        console.log('📋 Normalized nurses:', nurses);
      } else {
        console.warn('⚠️ Nenhum funcionário encontrado na aba Funcionarios do Google Sheets.');
      }
    } catch (e) {
      console.error('❌ Failed to load Funcionarios:', e.message);
      hasErrors = true;
    }

    // Auto-match user by name if needed
    if (!isAdmin && currentUser && (!currentUser.nurseId || currentUser.nurseId === '')) {
      const userName = currentUser.nome.toLowerCase().trim();
      const match = nurses.find(n => {
        const nn = n.name.toLowerCase().trim();
        return nn === userName || nn.includes(userName) || userName.includes(nn);
      });
      if (match) {
        currentUser.nurseId = match.id;
        calNurseFilter = match.id;
        apiUpdate('Usuarios', 'id', currentUser.id, { nurseId: match.id }).catch(() => {});
      }
    }

    // Load schedule
    try {
      await loadSchedule();
      console.log('📅 Schedule entries:', Object.keys(schedule).length);
    } catch (e) {
      console.error('❌ Failed to load Escala:', e.message);
      hasErrors = true;
    }

    // Load requests
    try {
      const reqData = await apiRead('Solicitacoes');
      console.log('📝 Solicitações carregadas:', reqData);
      if (reqData) {
        requests = reqData;
      }
    } catch (e) {
      console.error('❌ Failed to load Solicitacoes:', e.message);
      hasErrors = true;
    }

    // Load users if admin
    if (isAdmin) {
      try {
        const usrData = await apiRead('Usuarios');
        if (usrData) appUsers = usrData;
      } catch (e) {
        console.error('❌ Failed to reload Usuarios:', e.message);
        hasErrors = true;
      }
    }

    // Render (always render with whatever data we have)
    renderCalendar();
    renderRequests();
    populateFilterNurse();
    populateCalendarFilter();
    if (isAdmin) renderAdminUsers();
    updateBadges();

    if (hasErrors) {
      toast('Alcuni dati non sono stati caricati', 'warning');
    } else {
      toast('Dati sincronizzati', 'success');
    }
  } catch (e) {
    console.error('❌ Critical load error:', e);
    toast('Errore critico nel caricamento', 'error');
  }

  showLoading(false);
}

async function loadSchedule() {
  const data = await apiRead('Escala');
  console.log('📅 Escala raw data:', data);
  if (!data || data.length === 0) return;

  schedule = {};
  const m = currentMonth.getMonth();
  const y = currentMonth.getFullYear();

  data.forEach(row => {
    const rowMonth = parseInt(row.month);
    const rowYear = parseInt(row.year);
    if (rowMonth === m && rowYear === y) {
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
  loadSchedule().then(() => renderCalendar());
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
  statusFilter = document.getElementById('filterStatus').value;
  nurseFilter = document.getElementById('filterNurse').value;
  renderRequests();
}

function renderRequests() {
  const list = document.getElementById('reqList');

  let filtered = [...requests];

  // Status filter
  if (statusFilter !== 'all') {
    filtered = filtered.filter(r => r.status === statusFilter);
  }

  // Nurse filter
  if (nurseFilter !== 'all') {
    filtered = filtered.filter(r => r.nurseId === nurseFilter || r.fromNurseId === nurseFilter);
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
    const canDelete = isAdmin || (currentUser && currentUser.nurseId === req.nurseId);

    // Date display (requested dates)
    let dateDisplay = '';
    if (req.startDate) {
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

    // Build card sections
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
    let actionsHtml = '';
    if (canApprove || canDelete) {
      let btns = '';
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
function openNewRequestModal() {
  // Show nurse field only for admin
  document.getElementById('reqNurseField').style.display = isAdmin ? 'block' : 'none';

  // Populate nurse selects
  const nurseOptions = nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

  document.getElementById('reqNurse').innerHTML = nurseOptions;
  document.getElementById('reqSwapNurse').innerHTML = nurseOptions;

  // Reset form
  document.getElementById('reqType').value = 'FE';
  document.getElementById('reqStartDate').value = '';
  document.getElementById('reqEndDate').value = '';
  document.getElementById('reqDesc').value = '';
  onReqTypeChange();

  openModal('newReqModal');
}

function onReqTypeChange() {
  const type = document.getElementById('reqType').value;
  const isSwap = type === 'swap';
  const isRange = ['FE', 'AT'].includes(type);

  document.getElementById('reqEndField').style.display = isRange ? 'block' : 'none';
  document.getElementById('reqSwapField').style.display = isSwap ? 'block' : 'none';
  document.getElementById('reqDateLabel').textContent = isRange ? 'Data Inizio' : 'Data';
}

async function submitNewRequest() {
  const type = document.getElementById('reqType').value;
  const startDate = document.getElementById('reqStartDate').value;
  const endDate = document.getElementById('reqEndDate').value || startDate;
  const desc = document.getElementById('reqDesc').value;

  if (!startDate) {
    toast('Compila la data', 'warning');
    return;
  }

  let nurseId, nurseName;
  if (isAdmin) {
    nurseId = document.getElementById('reqNurse').value;
    const nurse = nurses.find(n => n.id === nurseId);
    nurseName = nurse ? nurse.name : '';
  } else {
    nurseId = currentUser.nurseId;
    nurseName = currentUser.nome;
  }

  const req = {
    id: generateId(),
    type,
    status: 'pending',
    nurseId,
    nurseName,
    startDate,
    endDate: ['FE', 'AT'].includes(type) ? endDate : startDate,
    desc,
    createdAt: new Date().toISOString(),
    approvedAt: '',
    approvedBy: ''
  };

  showLoading(true);
  try {
    await apiWrite('Solicitacoes', req);
    requests.push(req);
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

// ── APPROVE / REJECT ──────────────────────────────────────────
async function approveRequest(id) {
  showLoading(true);
  try {
    await apiUpdate('Solicitacoes', 'id', id, {
      status: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: currentUser.nome
    });
    const req = requests.find(r => String(r.id) === String(id));
    if (req) {
      req.status = 'approved';
      req.approvedAt = new Date().toISOString();
      req.approvedBy = currentUser.nome;
    }
    renderRequests();
    updateBadges();
    toast('Richiesta approvata!', 'success');
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
  if (!confirm('Sei sicuro di voler eliminare questa richiesta?')) return;
  showLoading(true);
  try {
    await apiDelete('Solicitacoes', 'id', id);
    requests = requests.filter(r => String(r.id) !== String(id));
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
    renderAdminUsers();
    closeModal('editUserModal');
    toast('Utente eliminato', 'info');
  } catch (e) {
    console.error('❌ deleteUser:', e.message);
    toast("Errore durante l'eliminazione", 'error');
  }
  showLoading(false);
}

// ── MODALS ────────────────────────────────────────────────────
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// Close modal on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-backdrop')) {
    e.target.classList.add('hidden');
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
