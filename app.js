// ============================================================
//  Cotolengo Escala — Mobile PWA — app.js v1.0
//  Lógica completa: Auth, Swipe, Calendário, Solicitações, Admin
// ============================================================

// ── CONFIG ────────────────────────────────────────────────────
const GOOGLE_API_URL = 'https://script.google.com/macros/s/AKfycbz-qW0XE6R5iWSrBkMp79y_F6FIAAUqpUH6nhBkUUwK15HbYoksp3fl6B-UDWZJxLL2oQ/exec';

const SHIFTS = {
  'M1': { name:'Manhã 1',     h:7.0,  color:'#f59e0b', text:'#1a1a00', period:'morning' },
  'M2': { name:'Manhã 2',     h:4.5,  color:'#fcd34d', text:'#1a1a00', period:'morning' },
  'MF': { name:'Manhã Feriado',h:7.5, color:'#f97316', text:'#fff',    period:'morning' },
  'G':  { name:'Jornada',     h:9.5,  color:'#0ea5e9', text:'#fff',    period:'morning' },
  'P':  { name:'Tarde',       h:8.5,  color:'#8b5cf6', text:'#fff',    period:'afternoon' },
  'PF': { name:'Tarde Feriado',h:10,  color:'#a78bfa', text:'#fff',    period:'afternoon' },
  'N':  { name:'Noite',       h:9,    color:'#1e1b4b', text:'#fff',    period:'night'   },
  'OFF':{ name: 'Folga', h: 0, color: 'rgba(255,255,255,0.03)', text: 'rgba(255,255,255,0.2)', period:'off' },
  'FE': { name: 'Férias', h: 0, color: '#10b981', text: '#fff', period:'off' },
  'AT': { name:'Atestado',    h:0,    color:'#ef4444', text:'#fff',    period:'off'     },
};

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const DAY_NAMES = ['D','S','T','Q','Q','S','S'];

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

async function showSplash() {
  // Show splash for 1.5s then load data
  try {
    await initializeData();
  } catch (e) {
    console.error('Init error:', e);
  }

  setTimeout(() => {
    document.getElementById('splashScreen').classList.remove('active');
    document.getElementById('loginScreen').classList.add('active');
  }, 1500);
}

async function initializeData() {
  // Setup Google Sheets headers if needed
  await ensureSheetSetup();

  // Load users for login dropdown
  const usersResult = await apiRead('Usuarios');
  if (usersResult && usersResult.length > 0) {
    appUsers = usersResult;
  } else {
    // Create default admin user
    const adminUser = { id: 'admin_1', nome: 'Coordenadora', senha: 'coord2026', role: 'admin', nurseId: '' };
    await apiWrite('Usuarios', adminUser);
    appUsers = [adminUser];
  }

  // Populate login dropdown
  const loginSelect = document.getElementById('loginUser');
  loginSelect.innerHTML = '<option value="">Selecione seu nome...</option>' +
    appUsers.map(u => `<option value="${u.id}">${u.nome}${u.role === 'admin' ? ' (Admin)' : ''}</option>`).join('');

  // Load nurses (normaliza colunas do Sheet)
  const nursesResult = await apiRead('Funcionarios');
  console.log('📋 Raw Funcionarios from Sheet:', nursesResult);
  if (nursesResult && nursesResult.length > 0) {
    nurses = normalizeNurses(nursesResult);
    console.log('📋 Normalized nurses:', nurses);
  }
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
  if (!GOOGLE_API_URL) return null;
  try {
    const url = `${GOOGLE_API_URL}?action=${action}&sheetName=${sheetName}`;
    const opts = body ? {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body)
    } : {};
    const res = await fetch(url, opts);
    return await res.json();
  } catch (e) {
    console.error('API Error:', e);
    return null;
  }
}

async function apiRead(sheetName) {
  const result = await apiCall('read', sheetName);
  return (result && result.status === 'success') ? result.data : [];
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
    errorEl.textContent = 'Selecione seu nome';
    return;
  }

  const user = appUsers.find(u => String(u.id) === String(userId));
  if (!user) {
    errorEl.textContent = 'Usuário não encontrado';
    return;
  }

  if (String(user.senha) !== String(pass)) {
    errorEl.textContent = 'Senha incorreta';
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
  document.getElementById('headerRole').textContent = isAdmin ? 'Administradora' : 'Funcionária';

  // Show/hide admin tab
  totalPages = isAdmin ? 3 : 2;
  document.getElementById('navAdminBtn').style.display = isAdmin ? 'flex' : 'none';
  document.getElementById('dotAdmin').style.display = isAdmin ? 'block' : 'none';

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
    sel.innerHTML = '<option value="all">👥 Todos os funcionários</option>' +
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

  try {
    // Load nurses (normaliza colunas do Sheet)
    const nursesData = await apiRead('Funcionarios');
    console.log('📋 Raw Funcionarios:', nursesData);
    if (nursesData && nursesData.length > 0) {
      nurses = normalizeNurses(nursesData);
      console.log('📋 Normalized nurses:', nurses);
    } else {
      console.warn('⚠️ Nenhum funcionário encontrado na aba Funcionarios do Google Sheets.');
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
    await loadSchedule();
    console.log('📅 Schedule entries:', Object.keys(schedule).length);

    // Load requests
    const reqData = await apiRead('Solicitacoes');
    console.log('📝 Solicitações carregadas:', reqData);
    if (reqData) {
      requests = reqData;
    }

    // Load users if admin
    if (isAdmin) {
      const usrData = await apiRead('Usuarios');
      if (usrData) appUsers = usrData;
    }

    // Render
    renderCalendar();
    renderRequests();
    populateFilterNurse();
    populateCalendarFilter();
    if (isAdmin) renderAdminUsers();
    updateBadges();

    toast('Dados sincronizados', 'success');
  } catch (e) {
    console.error('Load error:', e);
    toast('Erro ao carregar dados', 'error');
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
  const weekdayNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const weekdaysEl = document.getElementById('calWeekdays');
  weekdaysEl.innerHTML = weekdayNames.map((name, i) =>
    `<div class="cal-weekday ${i === 0 || i === 6 ? 'wkend' : ''}">${name}</div>`
  ).join('');

  // First day of month (0=Sun)
  const firstDow = new Date(y, m, 1).getDay();

  // Build day cells
  const daysEl = document.getElementById('calDays');
  let html = '';

  // Empty cells for days before month starts
  for (let i = 0; i < firstDow; i++) {
    html += '<div class="cal-day-cell empty"></div>';
  }

  // Determine what to show
  const showingSingle = calNurseFilter !== 'all';
  const selectedNurse = showingSingle ? nurses.find(n => n.id === calNurseFilter) : null;

  // Update subtitle
  const hasData = Object.keys(schedule).some(k => k.includes(`_${m}_${y}_`));
  if (showingSingle && selectedNurse) {
    document.getElementById('monthSub').textContent = hasData ? `Escala de ${selectedNurse.name}` : 'Aguardando publicação';
  } else {
    document.getElementById('monthSub').textContent = hasData ? 'Escala Geral' : 'Aguardando publicação';
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
      const sh = SHIFTS[code] || SHIFTS['OFF'];
      shiftHtml = `<div class="cal-day-shift" style="background:${sh.color};color:${sh.text}">${code === 'OFF' ? 'FO' : code}</div>`;
    } else if (nurses.length > 0 && hasData) {
      // Show colored dots for all nurses (summary view)
      const dots = nurses.slice(0, 7).map(n => {
        const code = getShift(n.id, d);
        const sh = SHIFTS[code] || SHIFTS['OFF'];
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
  const dayNames = ['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'];

  // Determine which nurses to show
  let detailNurses;
  if (calNurseFilter !== 'all') {
    detailNurses = nurses.filter(n => n.id === calNurseFilter);
  } else {
    detailNurses = nurses;
  }

  let listHtml = detailNurses.map(nurse => {
    const code = getShift(nurse.id, day);
    const sh = SHIFTS[code] || SHIFTS['OFF'];
    return `<div class="cal-detail-item">
      <div class="cal-detail-shift" style="background:${sh.color};color:${sh.text}">${code === 'OFF' ? 'FO' : code}</div>
      <div class="cal-detail-name">${nurse.name}</div>
      <div class="cal-detail-hours">${sh.h}h</div>
    </div>`;
  }).join('');

  if (detailNurses.length === 0) {
    listHtml = '<div style="text-align:center;color:var(--text-3);padding:16px;">Nenhum funcionário selecionado</div>';
  }

  const panel = document.createElement('div');
  panel.id = 'calDetailPanel';
  panel.className = 'cal-day-detail-panel';
  panel.innerHTML = `
    <div class="cal-detail-title">
      <span>📅 Dia ${day} — ${dayNames[date.getDay()]}</span>
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
  sel.innerHTML = '<option value="all">👤 Todos os funcionários</option>' +
    nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');
}

function setStatusFilter(filter, el) {
  statusFilter = filter;
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  renderRequests();
}

function applyFilters() {
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
      <p>${statusFilter !== 'all' || nurseFilter !== 'all' ? 'Nenhuma solicitação com estes filtros' : 'Nenhuma solicitação ainda'}</p>
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
    swap: '🔄 Troca de Turno',
    vacation: '🏖️ Férias',
    justified: '📋 Folga',
    FE: '🏖️ Férias',
    OFF: '📋 Folga',
    AT: '🏥 Atestado/Licença',
    OFF_INJ: '⚠️ Falta Injustificada'
  };

  const statusLabels = { pending: '⏳ Pendente', approved: '✅ Aprovado', rejected: '❌ Reprovado' };

  list.innerHTML = filtered.map((req, idx) => {
    const isPending = req.status === 'pending';
    const canApprove = isAdmin && isPending;

    // Waiting time
    let waitingHtml = '';
    if (isPending && req.createdAt) {
      const diff = Math.floor((new Date() - new Date(req.createdAt)) / (1000 * 60 * 60 * 24));
      waitingHtml = `<div class="req-waiting">⏱️ Há ${diff === 0 ? 'menos de 1 dia' : diff + ' dia' + (diff > 1 ? 's' : '')}</div>`;
    }

    // Date display
    let dateDisplay = '';
    if (req.startDate) {
      const start = formatDate(req.startDate);
      const end = req.endDate ? formatDate(req.endDate) : start;
      dateDisplay = start === end ? start : `${start} → ${end}`;
    }

    return `<div class="req-card status-${req.status}" style="animation-delay:${idx * 0.05}s">
      <div class="req-card-top">
        <div class="req-card-type">${typeLabels[req.type] || req.type}</div>
        <div class="req-card-status status-pill-${req.status}">${statusLabels[req.status] || req.status}</div>
      </div>
      <div class="req-card-details">
        <div class="req-detail-row">
          <span class="req-detail-icon">👤</span>
          <strong>${req.nurseName || ''}</strong>
        </div>
        ${dateDisplay ? `<div class="req-detail-row">
          <span class="req-detail-icon">📅</span>
          <span>${dateDisplay}</span>
        </div>` : ''}
        ${req.desc ? `<div class="req-detail-row">
          <span class="req-detail-icon">💬</span>
          <span>${req.desc}</span>
        </div>` : ''}
        ${req.approvedBy ? `<div class="req-detail-row">
          <span class="req-detail-icon">✍️</span>
          <span style="color:${req.status === 'approved' ? 'var(--success)' : 'var(--danger)'}">${req.status === 'approved' ? 'Aprovado' : 'Reprovado'} por ${req.approvedBy}</span>
        </div>` : ''}
      </div>
      ${waitingHtml}
      ${canApprove ? `<div class="req-card-actions">
        <button class="req-action-btn btn-approve" onclick="approveRequest('${req.id}')">✅ Aprovar</button>
        <button class="req-action-btn btn-reject" onclick="rejectRequest('${req.id}')">❌ Reprovar</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
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
  document.getElementById('reqDateLabel').textContent = isRange ? 'Data Início' : 'Data';
}

async function submitNewRequest() {
  const type = document.getElementById('reqType').value;
  const startDate = document.getElementById('reqStartDate').value;
  const endDate = document.getElementById('reqEndDate').value || startDate;
  const desc = document.getElementById('reqDesc').value;

  if (!startDate) {
    toast('Preencha a data', 'warning');
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
    id: String(Date.now()),
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
  const result = await apiWrite('Solicitacoes', req);
  if (result && result.status === 'success') {
    requests.push(req);
    renderRequests();
    updateBadges();
    closeModal('newReqModal');
    toast('Solicitação enviada!', 'success');
  } else {
    toast('Erro ao enviar solicitação', 'error');
  }
  showLoading(false);
}

// ── APPROVE / REJECT ──────────────────────────────────────────
async function approveRequest(id) {
  showLoading(true);
  const result = await apiUpdate('Solicitacoes', 'id', id, {
    status: 'approved',
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.nome
  });

  if (result && result.status === 'success') {
    const req = requests.find(r => String(r.id) === String(id));
    if (req) {
      req.status = 'approved';
      req.approvedAt = new Date().toISOString();
      req.approvedBy = currentUser.nome;
    }
    renderRequests();
    updateBadges();
    toast('Solicitação aprovada!', 'success');
  } else {
    toast('Erro ao aprovar', 'error');
  }
  showLoading(false);
}

async function rejectRequest(id) {
  showLoading(true);
  const result = await apiUpdate('Solicitacoes', 'id', id, {
    status: 'rejected',
    approvedAt: new Date().toISOString(),
    approvedBy: currentUser.nome
  });

  if (result && result.status === 'success') {
    const req = requests.find(r => String(r.id) === String(id));
    if (req) {
      req.status = 'rejected';
      req.approvedAt = new Date().toISOString();
      req.approvedBy = currentUser.nome;
    }
    renderRequests();
    updateBadges();
    toast('Solicitação reprovada', 'warning');
  } else {
    toast('Erro ao reprovar', 'error');
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
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div><p>Nenhum usuário cadastrado</p></div>';
    return;
  }

  list.innerHTML = appUsers.map(user => {
    const initials = user.nome.split(' ').map(w => w[0]).join('').substring(0, 2).toUpperCase();
    const linkedNurse = nurses.find(n => String(n.id) === String(user.nurseId));
    const nurseName = linkedNurse ? linkedNurse.name : 'Não vinculado';

    return `<div class="user-card" onclick="openEditUserModal('${user.id}')">
      <div class="user-avatar role-${user.role}">${initials}</div>
      <div class="user-info">
        <div class="user-info-name">${user.nome}</div>
        <div class="user-info-meta">
          <span class="role-badge ${user.role}">${user.role === 'admin' ? 'Admin' : 'Usuário'}</span>
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
  document.getElementById('newUserNurse').innerHTML = '<option value="">-- Nenhum --</option>' +
    nurses.map(n => `<option value="${n.id}">${n.name}</option>`).join('');

  openModal('addUserModal');
}

async function submitNewUser() {
  const nome = document.getElementById('newUserName').value.trim();
  const nurseId = document.getElementById('newUserNurse').value;
  const senha = document.getElementById('newUserPass').value;
  const role = document.getElementById('newUserRole').value;

  if (!nome || !senha) {
    toast('Preencha nome e senha', 'warning');
    return;
  }

  const newUser = {
    id: 'user_' + Date.now(),
    nome,
    senha,
    role,
    nurseId
  };

  showLoading(true);
  const result = await apiWrite('Usuarios', newUser);
  if (result && result.status === 'success') {
    appUsers.push(newUser);
    renderAdminUsers();
    closeModal('addUserModal');
    toast(`${nome} cadastrado!`, 'success');
  } else {
    toast('Erro ao cadastrar', 'error');
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

  if (!nome) { toast('Preencha o nome', 'warning'); return; }

  const updates = { nome, role };
  if (senha) updates.senha = senha;

  showLoading(true);
  const result = await apiUpdate('Usuarios', 'id', id, updates);
  if (result && result.status === 'success') {
    const user = appUsers.find(u => String(u.id) === String(id));
    if (user) {
      user.nome = nome;
      user.role = role;
      if (senha) user.senha = senha;
    }
    renderAdminUsers();
    closeModal('editUserModal');
    toast('Usuário atualizado!', 'success');
  } else {
    toast('Erro ao atualizar', 'error');
  }
  showLoading(false);
}

async function deleteUser() {
  const id = document.getElementById('editUserId').value;
  const user = appUsers.find(u => String(u.id) === String(id));

  if (user && user.role === 'admin' && appUsers.filter(u => u.role === 'admin').length <= 1) {
    toast('Não é possível excluir o único administrador', 'error');
    return;
  }

  if (!confirm(`Excluir ${user?.nome}?`)) return;

  showLoading(true);
  const result = await apiDelete('Usuarios', 'id', id);
  if (result && result.status === 'success') {
    appUsers = appUsers.filter(u => String(u.id) !== String(id));
    renderAdminUsers();
    closeModal('editUserModal');
    toast('Usuário excluído', 'info');
  } else {
    toast('Erro ao excluir', 'error');
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

// ── PWA INSTALL PROMPT ────────────────────────────────────────
let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;

  // Show install banner after entering app
  setTimeout(() => {
    if (document.getElementById('mainApp').classList.contains('active')) {
      showInstallBanner();
    }
  }, 5000);
});

function showInstallBanner() {
  if (document.querySelector('.install-banner')) return;

  const banner = document.createElement('div');
  banner.className = 'install-banner';
  banner.innerHTML = `
    <div class="install-banner-text">📲 Instale o app para acesso rápido!</div>
    <button class="install-banner-btn" onclick="installApp()">Instalar</button>
    <button class="install-banner-close" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('mainApp').appendChild(banner);
}

async function installApp() {
  const banner = document.querySelector('.install-banner');
  if (banner) banner.remove();
  if (!deferredPrompt) return;

  deferredPrompt.prompt();
  const { outcome } = await deferredPrompt.userChoice;
  if (outcome === 'accepted') {
    toast('App instalado com sucesso!', 'success');
  }
  deferredPrompt = null;
}
