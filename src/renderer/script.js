const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbxThygspXN6eB8cDUfY7XavKmhXZfewEUfQqd3vARScZ5y7adterInsbXshNkgPgfiF/exec',
  REFRESH_INTERVAL: 300000
};

let cache = { viewConfig: null, categories: [], channels: [], movies: { items: [], categories: [] }, series: { items: [], categories: [] } };
let currentPlayer = null;

// ===== Loading =====
document.addEventListener('DOMContentLoaded', () => {
  // TitleBar
  document.getElementById('btn-minimize').onclick = () => window.electronAPI?.minimize();
  document.getElementById('btn-maximize').onclick = () => window.electronAPI?.maximize();
  document.getElementById('btn-close').onclick = () => window.electronAPI?.close();

  // Navigation
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => navigateTo(btn.dataset.section));
  });
  document.querySelectorAll('.home-card').forEach(card => {
    card.addEventListener('click', () => navigateTo(card.dataset.section));
  });

  // Player controls
  document.getElementById('btn-close-player').onclick = closePlayer;
  document.getElementById('btn-fullscreen').onclick = toggleFullscreen;
  document.getElementById('btn-pip').onclick = togglePiP;

  // Update controls
  document.getElementById('btn-update-later').onclick = () => document.getElementById('update-overlay').classList.add('hidden');
  document.getElementById('btn-update-close').onclick = () => document.getElementById('update-overlay').classList.add('hidden');
  document.getElementById('btn-update-install').onclick = () => window.electronAPI?.installUpdate();

  // Search
  document.getElementById('channel-search').addEventListener('input', filterChannels);
  document.getElementById('channel-category').addEventListener('change', filterChannels);
  document.getElementById('movie-search').addEventListener('input', filterMovies);
  document.getElementById('movie-category').addEventListener('change', filterMovies);
  document.getElementById('series-search').addEventListener('input', filterSeries);
  document.getElementById('series-category').addEventListener('change', filterSeries);

  // Start
  loadAll();
  setupAutoUpdater();
});

function navigateTo(section) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn[data-section="${section}"]`)?.classList.add('active');
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
}

async function fetchAPI(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  try {
    const res = await fetch(url.toString(), { method: 'GET', headers: { 'Accept': 'application/json' } });
    const text = await res.text();
    return JSON.parse(text);
  } catch (err) { return null; }
}

async function loadAll() {
  try {
    const [viewConfig, categoriesData, moviesMeta, seriesMeta] = await Promise.all([
      fetchAPI('get_live_master_state').catch(() => null),
      fetchAPI('get_categories').catch(() => null),
      fetchAPI('get_catalog_meta', { type: 'movies' }).catch(() => null),
      fetchAPI('get_catalog_meta', { type: 'series' }).catch(() => null)
    ]);

    if (viewConfig?.success) cache.viewConfig = viewConfig;
    if (categoriesData?.success) {
      cache.channels = categoriesData.channels || [];
      cache.categories = categoriesData.categories || [];
      updateCategorySelect('channel-category', cache.categories);
      renderChannels();
    }
    if (moviesMeta?.success) {
      cache.movies.categories = moviesMeta.categories || [];
      const items = await fetchAPI('get_items_by_category', { type: 'movies', category: 'all' });
      if (items?.success) { cache.movies.items = items.items || []; renderMovies(); }
      updateCategorySelect('movie-category', cache.movies.categories);
    }
    if (seriesMeta?.success) {
      cache.series.categories = seriesMeta.categories || [];
      const items = await fetchAPI('get_items_by_category', { type: 'series', category: 'all' });
      if (items?.success) { cache.series.items = items.items || []; renderSeries(); }
      updateCategorySelect('series-category', cache.series.categories);
    }

    updateConnectionStatus(true);
    updateStats();
  } catch (e) {
    updateConnectionStatus(false);
    console.error('Load error:', e);
  }
}

function updateStats() {
  document.getElementById('count-channels').textContent = cache.channels.length;
  document.getElementById('count-movies').textContent = cache.movies.items.length;
  document.getElementById('count-series').textContent = cache.series.items.length;
}

function updateConnectionStatus(connected) {
  const el = document.getElementById('connection-status');
  el.className = connected ? 'status-connected' : 'status-disconnected';
  el.innerHTML = connected
    ? '<span class="status-dot"></span><span>متصل</span>'
    : '<span class="status-dot"></span><span>غير متصل</span>';
}

function updateCategorySelect(selectId, categories) {
  const select = document.getElementById(selectId);
  if (!select) return;
  select.innerHTML = '<option value="all">جميع الفئات</option>' +
    (categories || []).map(c => `<option value="${c}">${c}</option>`).join('');
}

// ===== Render =====
function renderChannels(list) {
  const items = list || cache.channels;
  const grid = document.getElementById('channels-grid');
  grid.innerHTML = items.map((ch, i) => `
    <div class="item-card" onclick="playChannel(${i})">
      <div class="item-thumb">
        <img src="${ch.logo || 'https://latchi.dz/logo.png'}" onerror="this.style.display='none'" alt="${ch.name}">
        <div class="play-overlay"><span class="play-icon">▶</span></div>
      </div>
      <div class="item-info">
        <div class="item-name">${ch.name}</div>
        <div class="item-category">${ch.group || ''}</div>
      </div>
    </div>
  `).join('');
}

function filterChannels() {
  const search = document.getElementById('channel-search').value.toLowerCase();
  const category = document.getElementById('channel-category').value;
  const filtered = cache.channels.filter(ch =>
    ch.name.toLowerCase().includes(search) && (category === 'all' || ch.group === category)
  );
  renderChannels(filtered);
}

function renderMovies(list) {
  const items = list || cache.movies.items;
  const grid = document.getElementById('movies-grid');
  grid.innerHTML = items.map((m, i) => `
    <div class="item-card" onclick="playMovie(${i})">
      <div class="item-thumb">
        <img src="${m.logo || m.thumbnail || ''}" onerror="this.style.display='none'" alt="${m.name}">
        <div class="play-overlay"><span class="play-icon">▶</span></div>
      </div>
      <div class="item-info">
        <div class="item-name">${m.name}</div>
        <div class="item-category">${m.category || ''}</div>
      </div>
    </div>
  `).join('');
}

function filterMovies() {
  const search = document.getElementById('movie-search').value.toLowerCase();
  const category = document.getElementById('movie-category').value;
  const filtered = cache.movies.items.filter(m =>
    m.name.toLowerCase().includes(search) && (category === 'all' || m.category === category)
  );
  renderMovies(filtered);
}

function renderSeries(list) {
  const items = list || cache.series.items;
  const grid = document.getElementById('series-grid');
  grid.innerHTML = items.map((s, i) => `
    <div class="item-card" onclick="playSeries(${i})">
      <div class="item-thumb">
        <img src="${s.logo || s.thumbnail || ''}" onerror="this.style.display='none'" alt="${s.name}">
        <div class="play-overlay"><span class="play-icon">▶</span></div>
      </div>
      <div class="item-info">
        <div class="item-name">${s.name}</div>
        <div class="item-category">${s.category || ''}</div>
      </div>
    </div>
  `).join('');
}

function filterSeries() {
  const search = document.getElementById('series-search').value.toLowerCase();
  const category = document.getElementById('series-category').value;
  const filtered = cache.series.items.filter(s =>
    s.name.toLowerCase().includes(search) && (category === 'all' || s.category === category)
  );
  renderSeries(filtered);
}

// ===== Player =====
function openPlayer(title, url, type) {
  if (!url) return alert('❌ رابط البث غير متاح');
  const overlay = document.getElementById('player-overlay');
  const video = document.getElementById('player-video');
  const loading = document.getElementById('player-loading');

  document.getElementById('player-title').textContent = title;
  document.getElementById('player-type-badge').textContent = type === 'live' ? 'مباشر' : type === 'movie' ? 'فيلم' : 'مسلسل';
  overlay.classList.remove('hidden');
  loading.classList.remove('hidden');
  if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }
  video.src = '';

  if (Hls.isSupported() && (url.includes('.m3u8') || url.includes('m3u8'))) {
    const hls = new Hls({ enableWorker: true, lowLatencyMode: true, backbufferLength: 30 });
    hls.loadSource(url);
    hls.attachMedia(video);
    currentPlayer = hls;
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      loading.classList.add('hidden');
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.ERROR, (event, data) => {
      if (data.fatal) loading.innerHTML = '<span style="color:#FF5577">❌ فشل التحميل</span>';
    });
  } else {
    video.src = url;
    video.addEventListener('loadedmetadata', () => {
      loading.classList.add('hidden');
      video.play().catch(() => {});
    });
  }
}

function closePlayer() {
  if (currentPlayer) { currentPlayer.destroy(); currentPlayer = null; }
  const video = document.getElementById('player-video');
  video.pause(); video.src = '';
  document.getElementById('player-overlay').classList.add('hidden');
}

function toggleFullscreen() {
  const container = document.getElementById('player-video-wrapper');
  if (document.fullscreenElement) document.exitFullscreen();
  else container.requestFullscreen();
}

function togglePiP() {
  const video = document.getElementById('player-video');
  if (document.pictureInPictureElement) document.exitPictureInPicture();
  else video.requestPictureInPicture().catch(() => {});
}

function playChannel(index) {
  const ch = cache.channels[index];
  if (ch) openPlayer(ch.name, ch.url, 'live');
}

async function playMovie(index) {
  const m = cache.movies.items[index];
  if (!m) return;
  let url = m.url || '';
  if (!url && m.id) { const d = await fetchAPI('get_items', { type: 'movie', id: m.id }); url = d?.url || ''; }
  openPlayer(m.name, url, 'movie');
}

async function playSeries(index) {
  const s = cache.series.items[index];
  if (!s) return;
  let url = s.url || '';
  if (!url && s.id) { const d = await fetchAPI('get_items', { type: 'series', id: s.id }); url = d?.url || ''; }
  openPlayer(s.name, url, 'series');
}

// ===== Settings =====
function reconnectServer() {
  updateConnectionStatus(false);
  CONFIG.API_URL = document.getElementById('setting-api-url').value.trim() || CONFIG.API_URL;
  loadAll();
}

function clearCache() {
  cache = { viewConfig: null, categories: [], channels: [], movies: { items: [], categories: [] }, series: { items: [], categories: [] } };
  loadAll();
}

// ===== Auto Updater =====
function setupAutoUpdater() {
  if (!window.electronAPI) return;
  window.electronAPI.onUpdateAvailable((info) => {
    document.getElementById('update-version-text').textContent = `إصدار جديد: ${info.version}`;
    document.getElementById('update-progress-container').classList.add('hidden');
    document.getElementById('update-overlay').classList.remove('hidden');
  });
  window.electronAPI.onDownloadProgress((progress) => {
    document.getElementById('update-progress-container').classList.remove('hidden');
    document.getElementById('update-progress-bar').style.setProperty('--progress', `${progress.percent}%`);
    document.getElementById('update-progress-text').textContent = `${Math.round(progress.percent)}%`;
  });
  window.electronAPI.onUpdateDownloaded(() => {
    document.getElementById('update-version-text').textContent = '✅ تم التحميل';
    document.getElementById('btn-update-install').textContent = '🔄 تثبيت';
  });
}

console.log('🚀 LATCHI IPTV v1.0.0 - PC Windows');
