/**
 * LATCHI IPTV PC — v1.0.8
 * واجهة مثل التلفاز تماماً:
 * - تنقل كامل بالكيبورد في كل مكان
 * - صور بطاقات حقيقية
 * - أفلام + مسلسلات + قنوات تشتغل
 * - إعدادات حقيقية
 * - تحميل تلقائي من السيرفر
 */

// ══════════════════════════════════════════════
// الإعدادات
// ══════════════════════════════════════════════
const SCRIPT_URL    = 'https://script.google.com/macros/s/AKfycbxThygspXN6eB8cDUfY7XavKmhXZfewEUfQqd3vARScZ5y7adterInsbXshNkgPgfiF/exec';
const APP_VERSION   = 8;
const PING_INTERVAL = 60_000;
const CHECK_INTERVAL= 30_000;

// ══════════════════════════════════════════════
// State
// ══════════════════════════════════════════════
let allChannels  = [];
let allCategories= [];
let currentCat   = '';
let currentCh    = null;
let masterUrl    = localStorage.getItem('latchi_url') || '';
let lastRevision = parseInt(localStorage.getItem('latchi_revision') || '0');
let hlsPlayer    = null;
let isFullscreen = false;
let wallpapers   = [];
let wallIdx      = 0;
let wallTimer    = null;
let checkTimer   = null;
let pingTimer    = null;
let deviceId     = getOrCreateDeviceId();
let geoInfo      = { country:'', city:'', ip:'' };
let appMode      = 'free';
// تتبع أي عمود نشط للكيبورد
let focusPanel   = 'home'; // home | cats | channels | player | settings

// ══════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupWindowControls();
  setupKeyboard();
  fetchGeo().then(() => boot());
});

async function boot() {
  setLoadingMsg('⏳ جاري الاتصال بالسيرفر...');
  try {
    const res = await fetch(`${SCRIPT_URL}?action=get_config&_t=${Date.now()}`);
    const cfg = await res.json();
    if (!cfg || cfg.status === 'error') throw new Error('فشل الاتصال');

    appMode      = cfg.app_mode || 'free';
    lastRevision = cfg.server_revision || 0;
    if (cfg.master_url) { masterUrl = cfg.master_url; localStorage.setItem('latchi_url', masterUrl); }
    localStorage.setItem('latchi_revision', lastRevision);
    if (cfg.wallpapers?.length) { wallpapers = cfg.wallpapers; startWallpapers(cfg.wallpaper_interval_min || 5); }

    if (appMode === 'vip') {
      const saved = localStorage.getItem('latchi_vip_code');
      if (saved) {
        const ok = await verifyCodeSilent(saved);
        if (ok) { enterApp(); } else { localStorage.removeItem('latchi_vip_code'); showActivation(); }
      } else { showActivation(); }
    } else {
      enterApp();
    }
  } catch (e) {
    log('❌ ' + e.message);
    const cached = localStorage.getItem('latchi_channels');
    if (cached) {
      allChannels = JSON.parse(cached);
      buildCategories();
      enterApp();
      setStatus('📦 من الكاش', false);
    } else {
      setLoadingMsg('❌ لا يوجد اتصال: ' + e.message);
    }
  }
}

function enterApp() {
  hideLoading();
  showHome();
  loadChannels();
  startRevisionCheck();
  startPing();
  checkAppUpdate();
}

// ══════════════════════════════════════════════
// VIP
// ══════════════════════════════════════════════
function showActivation() {
  hideLoading();
  document.getElementById('activation-screen').classList.remove('hidden');
  setTimeout(() => document.getElementById('vip-code-input')?.focus(), 200);
  focusPanel = 'activation';
}

async function submitVipCode() {
  const code = document.getElementById('vip-code-input').value.trim().toUpperCase();
  if (!code) return;
  document.getElementById('act-error').textContent = '';
  document.getElementById('vip-code-input').disabled = true;
  try {
    const res  = await fetch(`${SCRIPT_URL}?action=verify_code&code=${encodeURIComponent(code)}&device_id=${deviceId}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.valid) {
      localStorage.setItem('latchi_vip_code', code);
      if (data.master_url) { masterUrl = data.master_url; localStorage.setItem('latchi_url', masterUrl); }
      document.getElementById('activation-screen').classList.add('hidden');
      enterApp();
    } else {
      document.getElementById('act-error').textContent = data.message || 'كود غير صحيح';
      document.getElementById('vip-code-input').disabled = false;
    }
  } catch (e) {
    document.getElementById('act-error').textContent = 'خطأ في الاتصال';
    document.getElementById('vip-code-input').disabled = false;
  }
}

async function verifyCodeSilent(code) {
  try {
    const res  = await fetch(`${SCRIPT_URL}?action=verify_code&code=${encodeURIComponent(code)}&device_id=${deviceId}&_t=${Date.now()}`);
    const data = await res.json();
    if (data.valid && data.master_url) { masterUrl = data.master_url; localStorage.setItem('latchi_url', masterUrl); }
    return data.valid === true;
  } catch (_) { return true; }
}

// ══════════════════════════════════════════════
// Navigation
// ══════════════════════════════════════════════
function showHome() {
  hide('main-view'); show('home-screen');
  focusPanel = 'home';
  updateHomeStats();
  // فوكس تلقائي على أول بطاقة
  setTimeout(() => {
    const first = document.querySelector('.tv-card');
    if (first) first.focus();
  }, 100);
}

function goToLive() {
  hide('home-screen'); show('main-view');
  focusPanel = 'cats';
  if (allChannels.length === 0) loadChannels();
  else {
    buildCategories();
    setTimeout(() => focusFirstCat(), 100);
  }
}

function goToBein() {
  hide('home-screen'); show('main-view');
  focusPanel = 'cats';
  if (allChannels.length === 0) {
    loadChannels().then(() => selectBein());
  } else {
    buildCategories();
    selectBein();
  }
}

function selectBein() {
  const bein = allCategories.find(c =>
    ['bein','sport ar','sports','رياضة'].some(k => c.toLowerCase().includes(k))
  );
  if (bein) {
    selectCategory(bein);
    setTimeout(() => focusFirstChannel(), 150);
  } else {
    setTimeout(() => focusFirstCat(), 100);
  }
}

function goToSection(section) {
  if (section === 'movies' || section === 'series') {
    hide('home-screen'); show('main-view');
    focusPanel = 'cats';
    const keywords = section === 'movies'
      ? ['movie','film','films','أفلام','افلام','vod']
      : ['series','مسلسل','مسلسلات','serial'];
    if (allChannels.length === 0) {
      loadChannels().then(() => {
        const cat = allCategories.find(c => keywords.some(k => c.toLowerCase().includes(k)));
        if (cat) { selectCategory(cat); setTimeout(() => focusFirstChannel(), 150); }
        else setTimeout(() => focusFirstCat(), 100);
      });
    } else {
      const cat = allCategories.find(c => keywords.some(k => c.toLowerCase().includes(k)));
      if (cat) { selectCategory(cat); setTimeout(() => focusFirstChannel(), 150); }
      else { buildCategories(); setTimeout(() => focusFirstCat(), 100); }
    }
    return;
  }
  if (section === 'matches') {
    hide('home-screen'); show('main-view');
    const cat = allCategories.find(c =>
      ['match','sport','كأس','دوري','مباريات','football'].some(k => c.toLowerCase().includes(k))
    );
    if (cat) { selectCategory(cat); setTimeout(() => focusFirstChannel(), 150); }
    else goToLive();
    return;
  }
  if (section === 'theme') {
    showSettings(); return;
  }
  if (section === 'accounts') {
    const code = localStorage.getItem('latchi_vip_code') || '—';
    const mode = appMode === 'vip' ? '🔐 VIP' : '🔓 مجاني';
    alert(`👤 الحساب\n\nالوضع: ${mode}\nالكود: ${code}\nRevision: ${lastRevision}\nالجهاز: ${deviceId}`);
    return;
  }
}

// ══════════════════════════════════════════════
// تحميل القنوات
// ══════════════════════════════════════════════
async function loadChannels() {
  if (!masterUrl) { setStatus('⚠️ لم يُعيَّن رابط'); return; }
  setStatus('⏳ جاري تحميل القنوات...');
  try {
    const res  = await fetch(`${SCRIPT_URL}?action=get_categories&_t=${Date.now()}`);
    const data = await res.json();
    if (data.status === 'success' && data.channels?.length > 0) {
      allChannels = data.channels;
      localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 500)));
      buildCategories();
      updateHomeStats();
      setStatus(`✅ ${allChannels.length} قناة`, true);
      return;
    }
  } catch (_) {}
  // fallback M3U مباشر
  try {
    const res  = await fetch(masterUrl, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    if (text.includes('#EXTINF')) {
      allChannels = parseM3U(text);
      localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 500)));
      buildCategories();
      updateHomeStats();
      setStatus(`✅ ${allChannels.length} قناة`, true);
    }
  } catch (e) { setStatus('❌ ' + e.message, false); }
}

function parseM3U(text) {
  const chs = []; const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;
    const url = (lines[i+1]||'').trim();
    if (!url.startsWith('http')) continue;
    const name  = line.split(',').pop()?.trim() || 'قناة';
    const logo  = (line.match(/tvg-logo="([^"]*)"/) ||[])[1] || '';
    const group = (line.match(/group-title="([^"]*)"/) ||[])[1] || 'أخرى';
    const lc = (name+group).toLowerCase();
    if (['xxx','adult','porn','sex','18+'].some(b=>lc.includes(b))) continue;
    chs.push({ name, url, logo, group });
  }
  return chs;
}

// ══════════════════════════════════════════════
// بناء الفئات والقنوات
// ══════════════════════════════════════════════
function buildCategories() {
  allCategories = [...new Set(allChannels.map(c => c.group))].sort();
  const letters = [...new Set(allCategories.map(c => c[0]?.toUpperCase()).filter(Boolean))].sort();

  // حروف الفئات
  const catAlpha = document.getElementById('cat-alphabet');
  catAlpha.innerHTML = `<button class="alpha-btn active" tabindex="0" onclick="filterCatAlpha(this,'')">الكل</button>`;
  letters.slice(0,20).forEach(l => {
    catAlpha.innerHTML += `<button class="alpha-btn" tabindex="0" onclick="filterCatAlpha(this,'${l}')">${l}</button>`;
  });

  renderCatList(allCategories);

  // اختر أول فئة إذا لم تكن محددة
  if (!currentCat && allCategories.length > 0) {
    currentCat = allCategories[0];
    renderChannelList(allChannels.filter(c => c.group === currentCat));
  }
}

function renderCatList(cats) {
  const el = document.getElementById('cat-list');
  if (!cats.length) { el.innerHTML = '<div class="empty-msg">لا توجد فئات</div>'; return; }
  el.innerHTML = cats.map(cat => {
    const count = allChannels.filter(c => c.group === cat).length;
    return `<div class="cat-item ${cat===currentCat?'active':''}" tabindex="0" role="button"
      onclick="selectCategory('${esc(cat)}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){selectCategory('${esc(cat)}');event.preventDefault()}"
      onfocus="onCatFocus(this)">
      <span class="cat-name">${cat}</span>
      <span class="cat-count">${count}</span>
    </div>`;
  }).join('');
}

function filterCatAlpha(btn, letter) {
  document.querySelectorAll('#cat-alphabet .alpha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = letter ? allCategories.filter(c => c[0]?.toUpperCase() === letter) : allCategories;
  renderCatList(filtered);
}

function selectCategory(cat) {
  currentCat = cat;
  renderCatList(allCategories);
  let channels = allChannels.filter(c => c.group === cat);
  // ذكاء beIN
  if (['bein','sport ar','sports'].some(k => cat.toLowerCase().includes(k))) {
    const pure = channels.filter(c => c.name.toLowerCase().includes('bein'));
    if (pure.length) channels = pure;
    channels = channels.sort((a,b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      return (bn.includes('max')?1:0) - (an.includes('max')?1:0) || a.name.localeCompare(b.name);
    });
  }
  // فلتر حرف نشط
  const activeAlpha = document.querySelector('#ch-alphabet .alpha-btn.active');
  const letter = activeAlpha?.dataset?.letter || '';
  renderChannelList(letter ? channels.filter(c => c.name[0]?.toUpperCase() === letter) : channels);
}

function buildChAlpha(channels) {
  const letters = [...new Set(channels.map(c => c.name[0]?.toUpperCase()).filter(Boolean))].sort();
  const el = document.getElementById('ch-alphabet');
  el.innerHTML = `<button class="alpha-btn active" tabindex="0" data-letter="" onclick="filterChAlpha(this,'')">الكل</button>`;
  letters.slice(0,20).forEach(l => {
    el.innerHTML += `<button class="alpha-btn" tabindex="0" data-letter="${l}" onclick="filterChAlpha(this,'${l}')">${l}</button>`;
  });
}

function filterChAlpha(btn, letter) {
  document.querySelectorAll('#ch-alphabet .alpha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const base = currentCat ? allChannels.filter(c => c.group === currentCat) : allChannels;
  renderChannelList(letter ? base.filter(c => c.name[0]?.toUpperCase() === letter) : base);
}

function renderChannelList(channels) {
  buildChAlpha(channels);
  const el = document.getElementById('ch-list');
  if (!channels.length) { el.innerHTML = '<div class="empty-msg">لا توجد قنوات</div>'; return; }
  el.innerHTML = channels.map(ch => {
    const playing = currentCh?.url === ch.url;
    const idx = allChannels.indexOf(ch);
    return `<div class="ch-item ${playing?'playing':''}" tabindex="0" role="button"
      onclick="playChannel(${idx})"
      onkeydown="if(event.key==='Enter'||event.key===' '){playChannel(${idx});event.preventDefault()}"
      onfocus="onChFocus(this)">
      ${ch.logo
        ? `<img class="ch-logo" src="${ch.logo}" alt="" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="ch-logo-ph">📺</div>`}
      <div class="ch-info">
        <div class="ch-name">${ch.name}</div>
        ${playing ? '<div class="ch-badge">▶ يُشغَّل</div>' : `<div class="ch-group">${ch.group}</div>`}
      </div>
    </div>`;
  }).join('');
}

function filterChannels() {
  const q = document.getElementById('ch-search')?.value.toLowerCase().trim() || '';
  const base = currentCat ? allChannels.filter(c => c.group === currentCat) : allChannels;
  renderChannelList(q ? base.filter(c => c.name.toLowerCase().includes(q)) : base);
}

// ══════════════════════════════════════════════
// Player
// ══════════════════════════════════════════════
function playChannel(idx) {
  const ch = allChannels[idx];
  if (!ch) return;
  currentCh = ch;
  document.getElementById('player-ch-name').textContent = ch.name;
  document.getElementById('player-ch-group').textContent = ch.group;
  document.getElementById('video-overlay').classList.add('hidden');
  renderChannelList(allChannels.filter(c => c.group === (currentCat || ch.group)));
  sendPing(ch.name);
  const video = document.getElementById('player');
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
  const url = ch.url;
  if (typeof Hls !== 'undefined' && Hls.isSupported()) {
    hlsPlayer = new Hls({ lowLatencyMode: true, maxBufferLength: 30 });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
    hlsPlayer.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { video.src=url; video.play().catch(()=>{}); } });
  } else {
    video.src = url; video.play().catch(()=>{});
  }
  focusPanel = 'player';
}

function stopPlayer() {
  const video = document.getElementById('player');
  video.pause(); video.src = '';
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
  document.getElementById('video-overlay').classList.remove('hidden');
  currentCh = null;
}

function toggleFullscreen() {
  isFullscreen = !isFullscreen;
  const col = document.getElementById('col-player');
  if (isFullscreen) {
    col.style.cssText = 'position:fixed;inset:36px 0 0 0;z-index:50;background:#000;display:flex;flex-direction:column';
    document.getElementById('player-info').style.display = 'none';
    document.getElementById('player-controls').style.display = 'none';
    document.getElementById('col-categories').style.display = 'none';
    document.getElementById('col-channels').style.display = 'none';
    document.getElementById('player').style.cssText = 'width:100%;height:100%;object-fit:contain;flex:1';
    focusPanel = 'player-fs';
  } else {
    col.style.cssText = '';
    document.getElementById('player-info').style.display = '';
    document.getElementById('player-controls').style.display = '';
    document.getElementById('col-categories').style.display = '';
    document.getElementById('col-channels').style.display = '';
    document.getElementById('player').style.cssText = '';
    focusPanel = 'channels';
    setTimeout(() => focusCurrentChannel(), 100);
  }
}

// ══════════════════════════════════════════════
// Home Stats
// ══════════════════════════════════════════════
function updateHomeStats() {
  const live = allChannels.filter(c => !['movie','film','series','vod'].some(k => c.group.toLowerCase().includes(k))).length;
  const el = document.getElementById('stat-channels');
  if (el) el.textContent = live || allChannels.length;
  const el2 = document.getElementById('stat-cats');
  if (el2) el2.textContent = allCategories.length;
  const modeEl = document.getElementById('card-mode-label');
  if (modeEl) modeEl.textContent = appMode === 'vip' ? '🔐 VIP' : '🔓 مجاني';
}

// ══════════════════════════════════════════════
// Settings
// ══════════════════════════════════════════════
function showSettings() {
  show('settings-panel');
  document.getElementById('set-url').value  = masterUrl || '—';
  document.getElementById('set-rev').value  = lastRevision;
  document.getElementById('set-mode').value = appMode === 'vip' ? '🔐 VIP' : '🔓 مجاني';
  focusPanel = 'settings';
  setTimeout(() => document.querySelector('.btn-secondary')?.focus(), 100);
}

function hideSettings() {
  hide('settings-panel');
  focusPanel = document.getElementById('main-view').classList.contains('hidden') ? 'home' : 'cats';
  if (focusPanel === 'home') setTimeout(() => document.querySelector('.tv-card')?.focus(), 100);
  else setTimeout(() => focusFirstCat(), 100);
}

async function forceSync() {
  log('🔄 جاري التحديث...');
  await loadChannels();
  hideSettings();
}

// ══════════════════════════════════════════════
// Wallpapers
// ══════════════════════════════════════════════
function startWallpapers(min) {
  if (!wallpapers.length) return;
  showWallpaper(wallpapers[0]);
  if (wallTimer) clearInterval(wallTimer);
  wallTimer = setInterval(() => { wallIdx = (wallIdx+1)%wallpapers.length; showWallpaper(wallpapers[wallIdx]); }, min*60*1000);
}
function showWallpaper(url) {
  if (!url) return;
  const img = document.getElementById('wallpaper-img');
  if (!img) return;
  img.style.opacity='0';
  setTimeout(() => { img.src=url; img.style.opacity='1'; }, 500);
}

// ══════════════════════════════════════════════
// Revision Check
// ══════════════════════════════════════════════
function startRevisionCheck() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(async () => {
    try {
      const res = await fetch(`${SCRIPT_URL}?action=get_master_config&_t=${Date.now()}`);
      const d   = await res.json();
      const rev = d.server_revision || 0;
      if (rev !== lastRevision) {
        lastRevision = rev;
        localStorage.setItem('latchi_revision', rev);
        if (d.master_url) { masterUrl = d.master_url; localStorage.setItem('latchi_url', masterUrl); }
        if (d.wallpapers?.length) { wallpapers = d.wallpapers; startWallpapers(d.wallpaper_interval_min||5); }
        await loadChannels();
      }
    } catch (_) {}
  }, CHECK_INTERVAL);
}

// ══════════════════════════════════════════════
// Ping
// ══════════════════════════════════════════════
function startPing() {
  sendPing();
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => sendPing(currentCh?.name || ''), PING_INTERVAL);
}
async function sendPing(channel) {
  try {
    const p = new URLSearchParams({
      action:'ping', device_id:deviceId,
      device_name:'Windows PC', device_type:'pc', platform:'windows',
      code:localStorage.getItem('latchi_vip_code')||'',
      country:geoInfo.country, city:geoInfo.city, ip:geoInfo.ip,
      channel:channel||'', _t:Date.now()
    });
    await fetch(`${SCRIPT_URL}?${p}`);
  } catch(_) {}
}

// ══════════════════════════════════════════════
// App Update
// ══════════════════════════════════════════════
async function checkAppUpdate() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=get_app_update&version_code=${APP_VERSION}&platform=pc&_t=${Date.now()}`);
    const d   = await res.json();
    if (d.update_available && d.apk_url) log(`🆕 تحديث متوفر: v${d.version_name}`);
  } catch(_) {}
}

// ══════════════════════════════════════════════
// ⌨️ تنقل بالكيبورد — مثل ريموت التلفاز
// ══════════════════════════════════════════════
function setupKeyboard() {
  document.addEventListener('keydown', e => {
    const k = e.key;

    // ── Escape ─────────────────────────────────────────────────
    if (k === 'Escape') {
      if (isFullscreen)       { toggleFullscreen(); return; }
      if (focusPanel === 'settings') { hideSettings(); return; }
      if (focusPanel !== 'home') { showHome(); return; }
      e.preventDefault();
    }

    // ── Backspace = رجوع ──────────────────────────────────────
    if (k === 'Backspace' && focusPanel !== 'home' && focusPanel !== 'activation') {
      if (isFullscreen) { toggleFullscreen(); return; }
      if (focusPanel === 'settings') { hideSettings(); return; }
      showHome(); e.preventDefault(); return;
    }

    // ── Enter / Space ──────────────────────────────────────────
    if (k === 'Enter' || k === ' ') {
      const el = document.activeElement;
      if (el?.id === 'vip-code-input') { submitVipCode(); e.preventDefault(); return; }
      if (el?.classList.contains('tv-card'))  { el.click(); e.preventDefault(); return; }
      if (el?.classList.contains('cat-item')) { el.click(); e.preventDefault(); return; }
      if (el?.classList.contains('ch-item'))  { el.click(); e.preventDefault(); return; }
      if (el?.classList.contains('alpha-btn')){ el.click(); e.preventDefault(); return; }
      if (focusPanel === 'player' || focusPanel === 'player-fs') {
        toggleFullscreen(); e.preventDefault(); return;
      }
    }

    // ── F5 = تحديث ─────────────────────────────────────────────
    if (k === 'F5') { loadChannels(); e.preventDefault(); return; }
    if (k === 'F10') { showSettings(); e.preventDefault(); return; }

    // ── Arrows ─────────────────────────────────────────────────
    if (!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(k)) return;
    e.preventDefault();

    switch (focusPanel) {
      case 'home':       navigateHome(k); break;
      case 'cats':       navigateCats(k); break;
      case 'channels':   navigateChannels(k); break;
      case 'player':     navigatePlayer(k); break;
      case 'player-fs':  if (k==='ArrowLeft') toggleFullscreen(); break;
      case 'settings':   navigateSettings(k); break;
    }
  });

  // تحديث focusPanel عند التركيز
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el.closest('#home-screen'))       focusPanel = 'home';
    else if (el.closest('#cat-list') || el.closest('#cat-alphabet')) focusPanel = 'cats';
    else if (el.closest('#ch-list')  || el.closest('#ch-alphabet') || el.id==='ch-search') focusPanel = 'channels';
    else if (el.closest('#col-player'))   focusPanel = isFullscreen ? 'player-fs' : 'player';
    else if (el.closest('#settings-panel')) focusPanel = 'settings';
  });
}

function navigateHome(k) {
  const cards = Array.from(document.querySelectorAll('.tv-card'));
  const idx   = cards.indexOf(document.activeElement);
  const cols  = 4;
  let next = -1;
  if (k==='ArrowRight') next = idx+1;   // LTR في الـ grid
  if (k==='ArrowLeft')  next = idx-1;
  if (k==='ArrowDown')  next = idx+cols;
  if (k==='ArrowUp')    next = idx-cols;
  if (next>=0 && next<cards.length) cards[next].focus();
  else if (idx===-1 && cards.length) cards[0].focus();
}

function navigateCats(k) {
  if (k==='ArrowLeft') { focusPanel='channels'; focusFirstChannel(); return; }
  const items = Array.from(document.querySelectorAll('#cat-list .cat-item'));
  const alphas= Array.from(document.querySelectorAll('#cat-alphabet .alpha-btn'));
  const el    = document.activeElement;
  const inCat = items.includes(el);
  const inAlp = alphas.includes(el);

  if (k==='ArrowDown') {
    if (inAlp) { items[0]?.focus(); }
    else { const i=items.indexOf(el); items[i+1]?.focus(); items[i+1]?.scrollIntoView({block:'nearest'}); }
  }
  if (k==='ArrowUp') {
    if (inCat) {
      const i=items.indexOf(el);
      if (i===0) alphas[0]?.focus();
      else { items[i-1]?.focus(); items[i-1]?.scrollIntoView({block:'nearest'}); }
    } else {
      const i=alphas.indexOf(el); if(i>0) alphas[i-1]?.focus();
    }
  }
  if (k==='ArrowRight') { // بين حروف الـ alphabet
    if (inAlp) { const i=alphas.indexOf(el); alphas[i+1]?.focus(); }
  }
  if (k==='ArrowLeft' && inAlp) { const i=alphas.indexOf(el); alphas[i-1]?.focus(); }
}

function navigateChannels(k) {
  if (k==='ArrowRight') { focusPanel='cats'; focusFirstCat(); return; }
  if (k==='ArrowLeft')  { focusPanel='player'; document.getElementById('video-wrap')?.focus(); return; }
  const items = Array.from(document.querySelectorAll('#ch-list .ch-item'));
  const alphas= Array.from(document.querySelectorAll('#ch-alphabet .alpha-btn'));
  const el    = document.activeElement;

  if (k==='ArrowDown') {
    if (alphas.includes(el)) { items[0]?.focus(); }
    else { const i=items.indexOf(el); items[i+1]?.focus(); items[i+1]?.scrollIntoView({block:'nearest'}); }
  }
  if (k==='ArrowUp') {
    if (items.includes(el)) {
      const i=items.indexOf(el);
      if (i===0) alphas[0]?.focus();
      else { items[i-1]?.focus(); items[i-1]?.scrollIntoView({block:'nearest'}); }
    } else { const i=alphas.indexOf(el); if(i>0) alphas[i-1]?.focus(); }
  }
  if (k==='ArrowRight' && alphas.includes(el)) { const i=alphas.indexOf(el); alphas[i+1]?.focus(); }
  if (k==='ArrowLeft'  && alphas.includes(el)) { const i=alphas.indexOf(el); alphas[i-1]?.focus(); }
}

function navigatePlayer(k) {
  if (k==='ArrowRight') { focusPanel='channels'; focusCurrentChannel(); }
}

function navigateSettings(k) {
  const btns = Array.from(document.querySelectorAll('#settings-panel button, #settings-panel .btn-primary, #settings-panel .btn-secondary'));
  const i = btns.indexOf(document.activeElement);
  if (k==='ArrowDown' || k==='ArrowRight') btns[i+1]?.focus();
  if (k==='ArrowUp'   || k==='ArrowLeft')  btns[i-1]?.focus();
}

function focusFirstCat() {
  const el = document.querySelector('#cat-list .cat-item');
  if (el) { el.focus(); el.scrollIntoView({block:'nearest'}); }
}
function focusFirstChannel() {
  const el = document.querySelector('#ch-list .ch-item');
  if (el) { el.focus(); el.scrollIntoView({block:'nearest'}); }
}
function focusCurrentChannel() {
  const items = document.querySelectorAll('#ch-list .ch-item');
  const playing = Array.from(items).find(el => el.classList.contains('playing'));
  const target = playing || items[0];
  if (target) { target.focus(); target.scrollIntoView({block:'nearest'}); }
}
function onCatFocus(el)  { focusPanel='cats'; }
function onChFocus(el)   { focusPanel='channels'; }

// ══════════════════════════════════════════════
// Window Controls
// ══════════════════════════════════════════════
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.maximize());
  document.getElementById('btn-close')?.addEventListener('click',    () => window.electronAPI?.close());
}

// ══════════════════════════════════════════════
// Geo
// ══════════════════════════════════════════════
async function fetchGeo() {
  try {
    const d = await fetch('https://ipapi.co/json/', { signal:AbortSignal.timeout(5000) }).then(r=>r.json());
    geoInfo = { country: d.country_name||'', city: d.city||'', ip: d.ip||'' };
  } catch(_) {}
}

// ══════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════
function show(id) { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id) { document.getElementById(id)?.classList.add('hidden'); }
function setStatus(msg, online) {
  document.getElementById('status-text').textContent = msg;
  const dot = document.getElementById('status-dot');
  dot.className = 'status-dot' + (online===true ? ' online' : '');
}
function setLoadingMsg(msg) { const el=document.getElementById('loading-msg'); if(el) el.textContent=msg; }
function hideLoading() { hide('loading-screen'); }
function log(msg) {
  const el=document.getElementById('settings-log'); if(!el) return;
  el.textContent=`[${new Date().toLocaleTimeString('ar')}] ${msg}\n`+el.textContent;
  if(el.textContent.length>2000) el.textContent=el.textContent.slice(0,2000);
}
function getOrCreateDeviceId() {
  let id=localStorage.getItem('latchi_device_id');
  if(!id) { id='PC-'+Math.random().toString(36).substr(2,8).toUpperCase(); localStorage.setItem('latchi_device_id',id); }
  return id;
}
function esc(s) { return s.replace(/'/g,"\\'"); }
