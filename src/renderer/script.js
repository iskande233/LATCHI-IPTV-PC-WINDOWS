/**
 * LATCHI IPTV PC — الواجهة الرئيسية
 * مربوط مع Google Apps Script نفس التطبيقات الأخرى
 */

// ══════════════════════════════════════════════
// الإعدادات
// ══════════════════════════════════════════════
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwoxD7eNi6AVvhw9l_hPzaUkVt1F9U6trUXs28QYuNld_Ip15ZoefcTAdkd4B_DqoGO/exec';
const CHECK_INTERVAL = 30000; // فحص كل 30 ثانية

let masterUrl     = localStorage.getItem('masterUrl') || '';
let lastRevision  = parseInt(localStorage.getItem('lastRevision') || '0');
let allChannels   = [];
let allCategories = [];
let currentCat    = 'all';
let searchQuery   = '';
let hlsPlayer     = null;
let checkTimer    = null;

// ══════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupNav();
  setupWindowControls();
  setupSearch();
  syncFromScript();
  startRevisionCheck();
});

// ══════════════════════════════════════════════
// Window Controls (Electron)
// ══════════════════════════════════════════════
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.maximize());
  document.getElementById('btn-close')?.addEventListener('click',    () => window.electronAPI?.close());
}

// ══════════════════════════════════════════════
// Navigation
// ══════════════════════════════════════════════
function setupNav() {
  document.querySelectorAll('[data-section]').forEach(el => {
    el.addEventListener('click', () => {
      const sec = el.dataset.section;
      document.querySelectorAll('[data-section]').forEach(b => b.classList.remove('active'));
      el.classList.add('active');
      document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
      document.getElementById('page-' + sec)?.classList.add('active');
      if (sec === 'channels') renderChannels();
    });
  });
}

// ══════════════════════════════════════════════
// Google Script — جلب حالة السيرفر والرابط
// ══════════════════════════════════════════════
async function syncFromScript() {
  setStatus('⏳ جاري الاتصال بالسيرفر...');
  try {
    const ts  = Date.now();
    const res = await fetch(`${SCRIPT_URL}?action=get_live_master_state&_t=${ts}`);
    const data = await res.json();

    if (!data.success) { setStatus('❌ فشل الاتصال'); return; }

    const newRev = data.server_revision || 0;
    const newUrl = data.default_playlist_url || data.playlist_url || '';

    // إذا تغيّر الـ revision → حدّث الرابط
    if (newRev !== lastRevision || newUrl !== masterUrl) {
      lastRevision = newRev;
      if (newUrl) masterUrl = newUrl;
      localStorage.setItem('lastRevision', lastRevision);
      localStorage.setItem('masterUrl', masterUrl);
      log(`🔄 Revision: ${newRev} — جاري تحديث القنوات`);
      await loadChannels();
    } else {
      // نفس الـ revision — إذا القنوات فارغة نحملها
      if (allChannels.length === 0 && masterUrl) await loadChannels();
      else setStatus(`✅ متصل — ${allChannels.length} قناة`);
    }
  } catch (e) {
    setStatus('❌ لا يوجد اتصال بالإنترنت');
    log('❌ ' + e.message);
    // نحاول نحمل من الكاش
    const cached = localStorage.getItem('cachedChannels');
    if (cached && allChannels.length === 0) {
      allChannels = JSON.parse(cached);
      buildCategories();
      renderChannels();
      setStatus(`📦 من الكاش — ${allChannels.length} قناة`);
    }
  }
}

// ══════════════════════════════════════════════
// تحميل القنوات من M3U
// ══════════════════════════════════════════════
async function loadChannels() {
  if (!masterUrl) { setStatus('⚠️ لم يُعيَّن رابط بعد'); return; }
  setStatus('⏳ جاري تحميل القنوات...');
  try {
    const res  = await fetch(masterUrl, { signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    if (!text.includes('#EXTINF')) { setStatus('❌ الرابط لا يحتوي على قنوات'); return; }

    allChannels = parseM3U(text);
    localStorage.setItem('cachedChannels', JSON.stringify(allChannels.slice(0, 500)));
    buildCategories();
    renderHome();
    renderChannels();
    setStatus(`✅ ${allChannels.length} قناة`);
    log(`✅ تم تحميل ${allChannels.length} قناة`);
  } catch (e) {
    setStatus('❌ فشل تحميل القنوات: ' + e.message);
    log('❌ ' + e.message);
  }
}

function parseM3U(text) {
  const channels = [];
  const lines    = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;
    const urlLine = (lines[i + 1] || '').trim();
    if (!urlLine.startsWith('http')) continue;
    const name  = line.split(',').pop()?.trim() || 'قناة';
    const logo  = (line.match(/tvg-logo="([^"]+)"/) || [])[1] || '';
    const group = (line.match(/group-title="([^"]+)"/) || [])[1] || 'أخرى';
    channels.push({ name, logo, url: urlLine, group });
  }
  return channels;
}

function buildCategories() {
  const cats = [...new Set(allChannels.map(c => c.group).filter(Boolean))].sort();
  allCategories = cats;
  const container = document.getElementById('cat-list');
  if (!container) return;
  container.innerHTML = `<button class="cat-btn active" data-cat="all" onclick="filterCat(this,'all')">🌐 الكل</button>`;
  cats.forEach(cat => {
    const btn = document.createElement('button');
    btn.className = 'cat-btn';
    btn.dataset.cat = cat;
    btn.textContent = cat;
    btn.onclick = () => filterCat(btn, cat);
    container.appendChild(btn);
  });
}

// ══════════════════════════════════════════════
// Render
// ══════════════════════════════════════════════
function renderHome() {
  const el = document.getElementById('stat-channels');
  if (el) el.textContent = allChannels.length;
  const el2 = document.getElementById('stat-cats');
  if (el2) el2.textContent = allCategories.length;
}

function renderChannels() {
  const grid = document.getElementById('channels-grid');
  if (!grid) return;
  let list = allChannels;
  if (currentCat !== 'all') list = list.filter(c => c.group === currentCat);
  if (searchQuery) list = list.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()));

  if (list.length === 0) {
    grid.innerHTML = '<div class="empty-msg">لا توجد قنوات</div>';
    return;
  }

  grid.innerHTML = list.map((ch, i) => `
    <div class="channel-card" onclick="playChannel(${allChannels.indexOf(ch)})">
      <div class="ch-logo-wrap">
        ${ch.logo
          ? `<img src="${ch.logo}" alt="${ch.name}" onerror="this.style.display='none';this.nextSibling.style.display='flex'">`
          : ''}
        <div class="ch-logo-placeholder" style="${ch.logo ? 'display:none' : ''}">📺</div>
      </div>
      <div class="ch-name">${ch.name}</div>
      <div class="ch-group">${ch.group}</div>
    </div>
  `).join('');
}

function filterCat(btn, cat) {
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  currentCat = cat;
  renderChannels();
}

function setupSearch() {
  const inp = document.getElementById('search-input');
  if (!inp) return;
  inp.addEventListener('input', () => {
    searchQuery = inp.value.trim();
    renderChannels();
  });
}

// ══════════════════════════════════════════════
// Player HLS
// ══════════════════════════════════════════════
function playChannel(index) {
  const ch = allChannels[index];
  if (!ch) return;

  document.getElementById('player-overlay').classList.remove('hidden');
  document.getElementById('player-title').textContent = ch.name;
  document.getElementById('player-group').textContent  = ch.group;

  const video = document.getElementById('video-player');
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }

  const url = ch.url;
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    hlsPlayer = new Hls({ enableWorker: true, lowLatencyMode: true });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
  } else {
    video.src = url;
    video.play().catch(() => {});
  }
}

function closePlayer() {
  document.getElementById('player-overlay').classList.add('hidden');
  const video = document.getElementById('video-player');
  video.pause();
  video.src = '';
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
}

function toggleFullscreen() {
  const overlay = document.getElementById('player-overlay');
  overlay.classList.toggle('fullscreen-mode');
}

// ══════════════════════════════════════════════
// فحص التحديث التلقائي (كل 30 ثانية)
// ══════════════════════════════════════════════
function startRevisionCheck() {
  clearInterval(checkTimer);
  checkTimer = setInterval(syncFromScript, CHECK_INTERVAL);
}

// ══════════════════════════════════════════════
// Settings
// ══════════════════════════════════════════════
function saveSettings() {
  const urlInput = document.getElementById('setting-url');
  if (urlInput && urlInput.value.trim()) {
    masterUrl = urlInput.value.trim();
    localStorage.setItem('masterUrl', masterUrl);
  }
  loadChannels();
  log('💾 تم حفظ الإعدادات');
}

function loadSettingsPage() {
  const urlInput = document.getElementById('setting-url');
  if (urlInput) urlInput.value = masterUrl;
  const revEl = document.getElementById('setting-revision');
  if (revEl) revEl.textContent = lastRevision;
}

// ══════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════
function setStatus(msg) {
  const el = document.getElementById('status-text');
  if (el) el.textContent = msg;
}

function log(msg) {
  const el = document.getElementById('log-box');
  if (!el) return;
  const time = new Date().toLocaleTimeString('ar');
  el.innerHTML = `[${time}] ${msg}\n` + el.innerHTML;
  if (el.innerHTML.length > 3000) el.innerHTML = el.innerHTML.slice(0, 3000);
}
