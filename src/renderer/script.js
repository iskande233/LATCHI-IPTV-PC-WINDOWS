/**
 * LATCHI IPTV PC — script.js
 * مربوط مع Backend v7.1
 * واجهة مثل التلفاز (3 أعمدة: فئات + قنوات + مشغل)
 */

// ══════════════════════════════════════════════
// الإعدادات
// ══════════════════════════════════════════════
const SCRIPT_URL     = 'https://script.google.com/macros/s/AKfycbxThygspXN6eB8cDUfY7XavKmhXZfewEUfQqd3vARScZ5y7adterInsbXshNkgPgfiF/exec';
const APP_VERSION    = 1;
const PING_INTERVAL  = 60_000;   // ping كل 60 ثانية
const CHECK_INTERVAL = 30_000;   // فحص revision كل 30 ثانية
const SESSION_KEY    = 'latchi_session';

// ══════════════════════════════════════════════
// State
// ══════════════════════════════════════════════
let allChannels   = [];
let allCategories = [];
let currentCat    = '';
let currentCh     = null;
let lastRevision  = parseInt(localStorage.getItem('latchi_revision') || '0');
let masterUrl     = localStorage.getItem('latchi_url') || '';
let hlsPlayer     = null;
let isFullscreen  = false;
let wallpapers    = [];
let wallIdx       = 0;
let wallTimer     = null;
let checkTimer    = null;
let pingTimer     = null;
let deviceId      = getOrCreateDeviceId();
let geoInfo       = { country:'', city:'', ip:'' };

// ══════════════════════════════════════════════
// Init
// ══════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  setupWindowControls();
  setupKeyboard();
  fetchGeo().then(() => boot());
});

async function boot() {
  setLoadingMsg('جاري جلب إعدادات السيرفر...');
  try {
    const ts  = Date.now();
    const res = await fetch(`${SCRIPT_URL}?action=get_config&_t=${ts}`);
    const cfg = await res.json();

    if (!cfg || cfg.status === 'error') throw new Error('فشل الاتصال');

    // تحديث الـ revision و master_url
    lastRevision = cfg.server_revision || 0;
    if (cfg.master_url) {
      masterUrl = cfg.master_url;
      localStorage.setItem('latchi_url', masterUrl);
    }
    localStorage.setItem('latchi_revision', lastRevision);

    // الخلفيات
    if (cfg.wallpapers && cfg.wallpapers.length > 0) {
      wallpapers = cfg.wallpapers;
      startWallpapers(cfg.wallpaper_interval_min || 5);
    }

    // نحدث الإعدادات في Panel
    updateSettingsPanel(cfg);

    // فحص app_mode
    if (cfg.app_mode === 'vip') {
      // هل عنده كود محفوظ؟
      const savedCode = localStorage.getItem('latchi_vip_code');
      if (savedCode) {
        // تحقق من صلاحية الكود
        setLoadingMsg('جاري التحقق من الاشتراك...');
        const valid = await verifyCodeSilent(savedCode);
        if (valid) {
          enterApp();
        } else {
          localStorage.removeItem('latchi_vip_code');
          showActivation();
        }
      } else {
        showActivation();
      }
    } else {
      // free mode → ادخل مباشرة
      enterApp();
    }

  } catch (e) {
    log('❌ ' + e.message);
    // إذا عنده كاش → ادخل بالكاش
    const cachedChannels = localStorage.getItem('latchi_channels');
    if (cachedChannels) {
      allChannels = JSON.parse(cachedChannels);
      buildCategories();
      enterApp();
      setStatus('📦 من الكاش', false);
    } else {
      setLoadingMsg('❌ لا يوجد اتصال — ' + e.message);
    }
  }
}

function enterApp() {
  hideLoading();
  showHomeScreen();
  loadChannels();
  startRevisionCheck();
  startPing();
  checkAppUpdate();
}

function showHomeScreen() {
  document.getElementById('home-screen').classList.remove('hidden');
  document.getElementById('main-view').classList.add('hidden');
  updateHomeStats();
}

function updateHomeStats() {
  const modeEl = document.getElementById('card-mode-label');
  const mode   = localStorage.getItem('latchi_vip_code') ? 'VIP 🔐' : 'مجاني 🔓';
  if (modeEl) modeEl.textContent = mode;
}

function updateHomeChannelCount() {
  const el = document.getElementById('card-live-count');
  if (el && allChannels.length > 0) {
    const live = allChannels.filter(c => c.group !== 'VOD').length;
    el.textContent = `${live} قناة`;
  }
}

function goToLive() {
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
  if (allChannels.length === 0) loadChannels();
}

function goToBein() {
  document.getElementById('home-screen').classList.add('hidden');
  document.getElementById('main-view').classList.remove('hidden');
  // نجد فئة beIN تلقائياً
  const beinCat = allCategories.find(c =>
    c.toLowerCase().includes('bein') ||
    c.toLowerCase().includes('sport ar') ||
    c.toLowerCase().includes('sports')
  );
  if (beinCat) {
    currentCat = beinCat;
    renderChannels();
    // نحدد الفئة في القائمة
    setTimeout(() => {
      document.querySelectorAll('.cat-item').forEach(el => {
        el.classList.toggle('active', el.children[0].textContent === beinCat);
      });
    }, 100);
  }
}

function goToSection(section) {
  // الأفلام والمسلسلات → نفلتر القنوات من M3U بنفس الطريقة
  if (section === 'movies' || section === 'series') {
    const keyword = section === 'movies'
      ? ['movie','film','films','أفلام','افلام','vod']
      : ['series','مسلسل','مسلسلات'];

    // نبحث عن فئة مطابقة
    const matchCat = allCategories.find(c =>
      keyword.some(k => c.toLowerCase().includes(k))
    );
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    if (matchCat) {
      currentCat = matchCat;
    } else {
      // عرض كل القنوات مع فلتر نصي
      currentCat = '';
      document.getElementById('ch-search').value = section === 'movies' ? 'movie' : 'series';
    }
    renderChannels();
    return;
  }

  if (section === 'matches') {
    // نفتح قسم المباريات — نبحث عن فئة رياضة
    const matchCat = allCategories.find(c =>
      ['match','sport','كأس','دوري','مباريات'].some(k => c.toLowerCase().includes(k))
    );
    document.getElementById('home-screen').classList.add('hidden');
    document.getElementById('main-view').classList.remove('hidden');
    if (matchCat) { currentCat = matchCat; renderChannels(); }
    return;
  }

  if (section === 'theme') {
    // تغيير خلفية يدوية
    const url = prompt('🎨 أدخل رابط صورة الخلفية:', '');
    if (url) showWallpaper(url);
    return;
  }

  if (section === 'accounts') {
    // عرض معلومات الحساب
    const code = localStorage.getItem('latchi_vip_code') || 'مجاني';
    const rev  = lastRevision;
    alert(`👤 معلومات الحساب\n\nالوضع: ${code === 'مجاني' ? '🔓 مجاني' : '🔐 VIP'}\nالكود: ${code}\nRevision: ${rev}\nالجهاز: ${deviceId}`);
    return;
  }
}

// ══════════════════════════════════════════════
// VIP Activation
// ══════════════════════════════════════════════
function showActivation() {
  hideLoading();
  document.getElementById('activation-screen').classList.remove('hidden');
  document.getElementById('vip-code-input').focus();
}

async function submitVipCode() {
  const code = document.getElementById('vip-code-input').value.trim().toUpperCase();
  if (!code) return;
  document.getElementById('act-error').textContent = '';
  document.getElementById('vip-code-input').disabled = true;

  try {
    const ts  = Date.now();
    const res = await fetch(`${SCRIPT_URL}?action=verify_code&code=${encodeURIComponent(code)}&device_id=${deviceId}&_t=${ts}`);
    const data = await res.json();

    if (data.valid) {
      // ✅ حفظ الكود محلياً → لا يسأل مرة ثانية
      localStorage.setItem('latchi_vip_code', code);
      if (data.master_url) {
        masterUrl = data.master_url;
        localStorage.setItem('latchi_url', masterUrl);
      }
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
    const ts  = Date.now();
    const res = await fetch(`${SCRIPT_URL}?action=verify_code&code=${encodeURIComponent(code)}&device_id=${deviceId}&_t=${ts}`);
    const data = await res.json();
    if (data.valid && data.master_url) {
      masterUrl = data.master_url;
      localStorage.setItem('latchi_url', masterUrl);
    }
    return data.valid === true;
  } catch (_) { return true; } // في حالة انقطاع الإنترنت → نسمح بالدخول
}

// ══════════════════════════════════════════════
// تحميل القنوات
// ══════════════════════════════════════════════
async function loadChannels() {
  if (!masterUrl) { setStatus('⚠️ لم يُعيَّن رابط', false); return; }
  setStatus('⏳ جاري تحميل القنوات...');

  try {
    const ts  = Date.now();
    const res = await fetch(`${SCRIPT_URL}?action=get_categories&_t=${ts}`);
    const data = await res.json();

    if (data.status === 'success' && data.channels && data.channels.length > 0) {
      allChannels = data.channels;
      localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 300)));
      buildCategories();
      setStatus(`✅ ${allChannels.length} قناة`, true);
      log(`✅ ${allChannels.length} قناة محملة`);
      updateHomeChannelCount();
      updateHomeStats();
      return;
    }
  } catch (_) {}

  // Fallback: نحمل M3U مباشرة
  if (masterUrl) await loadM3UDirect();
}

async function loadM3UDirect() {
  try {
    const res  = await fetch(masterUrl, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    if (!text.includes('#EXTINF')) { setStatus('❌ الرابط لا يحتوي قنوات', false); return; }
    allChannels = parseM3U(text);
    localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 300)));
    buildCategories();
    setStatus(`✅ ${allChannels.length} قناة`, true);
    log(`✅ ${allChannels.length} قناة (M3U مباشر)`);
  } catch (e) {
    setStatus('❌ ' + e.message, false);
    log('❌ ' + e.message);
  }
}

function parseM3U(text) {
  const chs = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('#EXTINF')) continue;
    const url = (lines[i+1]||'').trim();
    if (!url.startsWith('http')) continue;
    const name  = line.split(',').pop()?.trim() || 'قناة';
    const logo  = (line.match(/tvg-logo="([^"]*)"/) ||[])[1] || '';
    const group = (line.match(/group-title="([^"]*)"/) ||[])[1] || 'أخرى';
    const lc    = (name+group).toLowerCase();
    if (['xxx','adult','porn','sex','18+'].some(b => lc.includes(b))) continue;
    chs.push({ name, url, logo, group });
  }
  return chs;
}

// ══════════════════════════════════════════════
// بناء الفئات والقنوات
// ══════════════════════════════════════════════
function buildCategories() {
  const cats = [...new Set(allChannels.map(c => c.group))].sort();
  allCategories = cats;

  // حروف الفئات
  const catLetters = [...new Set(cats.map(c => c[0]?.toUpperCase()).filter(Boolean))].sort();
  const catAlpha = document.getElementById('cat-alphabet');
  catAlpha.innerHTML = '<button class="alpha-btn active" onclick="filterCatAlpha(this,\'\')">الكل</button>';
  catLetters.forEach(l => {
    catAlpha.innerHTML += `<button class="alpha-btn" onclick="filterCatAlpha(this,'${l}')">${l}</button>`;
  });

  // قائمة الفئات
  renderCategories(cats);

  // اختر أول فئة تلقائياً
  if (cats.length > 0 && !currentCat) {
    selectCategory(cats[0]);
  }
}

function renderCategories(cats) {
  const el = document.getElementById('cat-list');
  if (cats.length === 0) { el.innerHTML = '<div class="empty-msg">لا توجد فئات</div>'; return; }
  el.innerHTML = cats.map(cat => {
    const count = allChannels.filter(c => c.group === cat).length;
    const isAct = cat === currentCat ? 'active' : '';
    return `<div class="cat-item ${isAct}" tabindex="0" role="button"
                  onclick="selectCategory('${escHtml(cat)}')"
                  onkeydown="if(event.key==='Enter'||event.key===' ')selectCategory('${escHtml(cat)}')">
      <span>${cat}</span><span class="cat-count">${count}</span>
    </div>`;
  }).join('');
}

function filterCatAlpha(btn, letter) {
  document.querySelectorAll('#cat-alphabet .alpha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const filtered = letter ? allCategories.filter(c => c[0]?.toUpperCase() === letter) : allCategories;
  renderCategories(filtered);
}

function selectCategory(cat) {
  currentCat = cat;
  renderCategories(allCategories.filter(c => !document.querySelector('#cat-alphabet .alpha-btn.active')?.dataset?.letter
    || c[0]?.toUpperCase() === document.querySelector('#cat-alphabet .alpha-btn.active')?.textContent));
  renderCategories(allCategories); // نعيد كل الفئات مع highlight
  document.querySelectorAll('.cat-item').forEach(el => {
    el.classList.toggle('active', el.children[0].textContent === cat);
  });
  renderChannels();
}

// حروف القنوات
function buildChAlphabet(channels) {
  const letters = [...new Set(channels.map(c => c.name[0]?.toUpperCase()).filter(Boolean))].sort();
  const el = document.getElementById('ch-alphabet');
  el.innerHTML = '<button class="alpha-btn active" onclick="filterChAlpha(this,\'\')">الكل</button>';
  letters.slice(0,20).forEach(l => {
    el.innerHTML += `<button class="alpha-btn" onclick="filterChAlpha(this,'${l}')">${l}</button>`;
  });
}

function filterChAlpha(btn, letter) {
  document.querySelectorAll('#ch-alphabet .alpha-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const base = currentCat ? allChannels.filter(c => c.group === currentCat) : allChannels;
  const filtered = letter ? base.filter(c => c.name[0]?.toUpperCase() === letter) : base;
  renderChannelList(filtered);
}

function filterChannels() {
  const q = document.getElementById('ch-search').value.toLowerCase().trim();
  const base = currentCat ? allChannels.filter(c => c.group === currentCat) : allChannels;
  const filtered = q ? base.filter(c => c.name.toLowerCase().includes(q)) : base;
  renderChannelList(filtered);
}

function renderChannels() {
  const channels = currentCat ? allChannels.filter(c => c.group === currentCat) : allChannels;
  buildChAlphabet(channels);
  renderChannelList(channels);
}

function renderChannelList(channels) {
  const el = document.getElementById('ch-list');
  if (channels.length === 0) { el.innerHTML = '<div class="empty-msg">لا توجد قنوات</div>'; return; }
  el.innerHTML = channels.map((ch, i) => {
    const isPlaying = currentCh && ch.url === currentCh.url;
    const idx = allChannels.indexOf(ch);
    return `<div class="ch-item ${isPlaying?'playing':''}" tabindex="0" role="button"
                  onclick="playChannel(${idx})"
                  onkeydown="if(event.key==='Enter'||event.key===' ')playChannel(${idx})">
      ${ch.logo
        ? `<img class="ch-logo" src="${ch.logo}" alt="" onerror="this.style.display='none'">`
        : `<div class="ch-logo-placeholder">📺</div>`}
      <div class="ch-info">
        <div class="ch-name">${ch.name}</div>
        ${isPlaying ? '<div class="ch-playing-badge">▶ يُشغَّل الآن</div>' : `<div class="ch-group">${ch.group}</div>`}
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════════════
// Player
// ══════════════════════════════════════════════
function playChannel(index) {
  const ch = allChannels[index];
  if (!ch) return;
  currentCh = ch;

  document.getElementById('player-ch-name').textContent = ch.name;
  document.getElementById('player-ch-group').textContent = ch.group;
  document.getElementById('video-overlay').classList.add('hidden');
  document.getElementById('epg-text').textContent = '';

  // تحديث القائمة لإظهار "يُشغَّل الآن"
  renderChannels();

  const video = document.getElementById('player');
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }

  const url = ch.url;
  if (typeof Hls !== 'undefined' && Hls.isSupported() &&
      (url.includes('.m3u8') || url.includes('m3u8') || !url.includes('.'))) {
    hlsPlayer = new Hls({ enableWorker: true, lowLatencyMode: true, maxBufferLength: 30 });
    hlsPlayer.loadSource(url);
    hlsPlayer.attachMedia(video);
    hlsPlayer.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(()=>{}));
    hlsPlayer.on(Hls.Events.ERROR, (_, d) => {
      if (d.fatal) { video.src = url; video.play().catch(()=>{}); }
    });
  } else {
    video.src = url;
    video.play().catch(()=>{});
  }

  // ping مع اسم القناة
  sendPing(ch.name);
  log(`▶ ${ch.name}`);
}

function stopPlayer() {
  const video = document.getElementById('player');
  video.pause(); video.src = '';
  if (hlsPlayer) { hlsPlayer.destroy(); hlsPlayer = null; }
  document.getElementById('video-overlay').classList.remove('hidden');
  currentCh = null;
  renderChannels();
}

function handleVideoClick() {
  if (!currentCh) return;
  toggleFullscreen();
}

function toggleFullscreen() {
  const col = document.getElementById('col-player');
  isFullscreen = !isFullscreen;
  col.classList.toggle('fullscreen-mode', isFullscreen);
  if (isFullscreen) {
    document.getElementById('player-hint').textContent = 'Esc = رجوع';
  }
}

// ══════════════════════════════════════════════
// الخلفيات المتغيرة
// ══════════════════════════════════════════════
function startWallpapers(intervalMin) {
  if (wallpapers.length === 0) return;
  showWallpaper(wallpapers[0]);
  if (wallTimer) clearInterval(wallTimer);
  wallTimer = setInterval(() => {
    wallIdx = (wallIdx + 1) % wallpapers.length;
    showWallpaper(wallpapers[wallIdx]);
  }, intervalMin * 60 * 1000);
}

function showWallpaper(url) {
  if (!url) return;
  const img = document.getElementById('wallpaper-img');
  img.style.opacity = '0';
  setTimeout(() => {
    img.src = url;
    img.style.opacity = '1';
    img.style.transition = 'opacity 1s ease';
  }, 500);
}

// ══════════════════════════════════════════════
// Revision Check (كل 30 ثانية)
// ══════════════════════════════════════════════
function startRevisionCheck() {
  if (checkTimer) clearInterval(checkTimer);
  checkTimer = setInterval(async () => {
    try {
      const ts  = Date.now();
      const res = await fetch(`${SCRIPT_URL}?action=get_master_config&_t=${ts}`);
      const d   = await res.json();
      const newRev = d.server_revision || 0;
      if (newRev !== lastRevision) {
        log(`🔄 Revision جديد: ${newRev} — تحديث القنوات`);
        lastRevision = newRev;
        localStorage.setItem('latchi_revision', newRev);
        if (d.master_url) { masterUrl = d.master_url; localStorage.setItem('latchi_url', masterUrl); }
        if (d.wallpapers?.length) { wallpapers = d.wallpapers; startWallpapers(d.wallpaper_interval_min||5); }
        updateSettingsPanel(d);
        await loadChannels();
      }
    } catch (_) {}
  }, CHECK_INTERVAL);
}

// ══════════════════════════════════════════════
// Ping (كل 60 ثانية)
// ══════════════════════════════════════════════
function startPing() {
  sendPing();
  if (pingTimer) clearInterval(pingTimer);
  pingTimer = setInterval(() => sendPing(currentCh?.name || ''), PING_INTERVAL);
}

async function sendPing(channel) {
  try {
    const code = localStorage.getItem('latchi_vip_code') || '';
    const params = new URLSearchParams({
      action:      'ping',
      device_id:   deviceId,
      device_name: getPCName(),
      device_type: 'pc',
      platform:    'windows',
      code:        code,
      country:     geoInfo.country,
      city:        geoInfo.city,
      ip:          geoInfo.ip,
      channel:     channel || '',
      _t:          Date.now()
    });
    await fetch(`${SCRIPT_URL}?${params}`);
  } catch (_) {}
}

// ══════════════════════════════════════════════
// فحص تحديث التطبيق
// ══════════════════════════════════════════════
async function checkAppUpdate() {
  try {
    const res = await fetch(`${SCRIPT_URL}?action=get_app_update&version_code=${APP_VERSION}&platform=pc&_t=${Date.now()}`);
    const d   = await res.json();
    if (d.update_available && d.apk_url) {
      log(`🆕 تحديث متوفر: v${d.version_name}`);
      // يمكن إضافة إشعار هنا
    }
  } catch (_) {}
}

// ══════════════════════════════════════════════
// Settings Panel
// ══════════════════════════════════════════════
function toggleSettings() {
  const el = document.getElementById('settings-panel');
  el.classList.toggle('hidden');
  if (!el.classList.contains('hidden')) {
    document.getElementById('set-url').value = masterUrl || 'لم يُعيَّن بعد';
    document.getElementById('set-rev').value = lastRevision;
  }
}

function updateSettingsPanel(cfg) {
  const modeEl = document.getElementById('set-mode');
  if (modeEl) modeEl.value = cfg.app_mode === 'free' ? '🔓 مجاني' : '🔐 VIP';
  const revEl = document.getElementById('set-rev');
  if (revEl) revEl.value = cfg.server_revision || lastRevision;
  const urlEl = document.getElementById('set-url');
  if (urlEl) urlEl.value = cfg.master_url || masterUrl || '';
}

async function forceSync() {
  log('🔄 جاري التحديث...');
  await loadChannels();
  toggleSettings();
}

// ══════════════════════════════════════════════
// Keyboard
// ══════════════════════════════════════════════
// ══════════════════════════════════════════════
// ⌨️ نظام التنقل بالكيبورد (مثل ريموت التلفاز)
// Arrow Keys = تنقل | Enter/Space = تحديد | Esc = رجوع
// ══════════════════════════════════════════════
function setupKeyboard() {
  // tabindex لكل العناصر القابلة للتركيز
  document.querySelectorAll('.tv-card').forEach((el, i) => {
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
  });

  document.addEventListener('keydown', e => {
    const key = e.key;

    // ── Esc ────────────────────────────────────────────────────
    if (key === 'Escape') {
      if (isFullscreen) {
        isFullscreen = false;
        document.getElementById('col-player').classList.remove('fullscreen-mode');
        return;
      }
      if (!document.getElementById('settings-panel').classList.contains('hidden')) {
        toggleSettings(); return;
      }
      // رجوع للـ Home من شاشة القنوات
      if (!document.getElementById('main-view').classList.contains('hidden')) {
        showHomeScreen(); return;
      }
    }

    // ── Enter / Space — تفعيل العنصر المحدد ──────────────────
    if ((key === 'Enter' || key === ' ') && document.activeElement) {
      const el = document.activeElement;

      // كود VIP
      if (el.id === 'vip-code-input') { submitVipCode(); return; }

      // بطاقة TV
      if (el.classList.contains('tv-card') || el.classList.contains('cat-item') ||
          el.classList.contains('ch-item')) {
        el.click(); e.preventDefault(); return;
      }

      // مشغل الفيديو → fullscreen
      if (el.id === 'video-wrap' || el.id === 'player') {
        toggleFullscreen(); e.preventDefault(); return;
      }
    }

    // ── Arrow Keys — تنقل بين العناصر ────────────────────────
    if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key)) {
      e.preventDefault();

      const focused = document.activeElement;
      const isHome  = !document.getElementById('home-screen').classList.contains('hidden');
      const isMain  = !document.getElementById('main-view').classList.contains('hidden');

      if (isHome) {
        // تنقل بين بطاقات الـ Home
        navigateCards(key);
      } else if (isMain) {
        // تحديد العمود النشط وتنقل داخله
        if (focused.closest('#col-categories') || focused.closest('#cat-list')) {
          navigateList('#cat-list', '.cat-item', key);
        } else if (focused.closest('#col-channels') || focused.closest('#ch-list')) {
          navigateList('#ch-list', '.ch-item', key);
          // إذا اليسار → انتقل للفيديو
          if (key === 'ArrowLeft') {
            document.getElementById('video-wrap')?.focus();
          }
          // إذا اليمين → انتقل للفئات
          if (key === 'ArrowRight') {
            document.querySelector('#cat-list .cat-item')?.focus();
          }
        } else if (focused.closest('#col-player')) {
          if (key === 'ArrowRight') {
            document.querySelector('#ch-list .ch-item')?.focus();
          }
          if (key === 'Enter' || key === ' ') toggleFullscreen();
        } else {
          // تركيز افتراضي على أول فئة
          document.querySelector('#cat-list .cat-item')?.focus();
        }
      }
    }

    // ── F5 → تحديث القنوات ────────────────────────────────────
    if (key === 'F5') { forceSync(); }
  });

  // تفعيل hover style عند التركيز بالكيبورد
  document.addEventListener('focusin', e => {
    const el = e.target;
    if (el.classList.contains('tv-card'))   el.style.borderColor = 'var(--gold)';
    if (el.classList.contains('cat-item'))  el.style.background  = 'rgba(255,215,0,0.08)';
    if (el.classList.contains('ch-item'))   el.style.background  = 'rgba(0,229,255,0.08)';
  });
  document.addEventListener('focusout', e => {
    const el = e.target;
    if (el.classList.contains('tv-card') && !el.matches(':hover')) el.style.borderColor = '';
    if (el.classList.contains('cat-item') && !el.classList.contains('active')) el.style.background = '';
    if (el.classList.contains('ch-item') && !el.classList.contains('playing'))  el.style.background = '';
  });
}

// تنقل بين بطاقات الشاشة الرئيسية
function navigateCards(key) {
  const cards   = Array.from(document.querySelectorAll('.tv-card'));
  const focused = document.activeElement;
  const idx     = cards.indexOf(focused);
  const cols    = 4; // عدد الأعمدة

  let next = -1;
  if (key === 'ArrowRight') next = idx - 1; // RTL
  if (key === 'ArrowLeft')  next = idx + 1;
  if (key === 'ArrowDown')  next = idx + cols;
  if (key === 'ArrowUp')    next = idx - cols;

  if (next >= 0 && next < cards.length) {
    cards[next].focus();
  } else if (idx === -1 && cards.length > 0) {
    cards[0].focus();
  }
}

// تنقل داخل قائمة (فئات أو قنوات)
function navigateList(listSel, itemSel, key) {
  const items   = Array.from(document.querySelectorAll(listSel + ' ' + itemSel));
  const focused = document.activeElement;
  const idx     = items.indexOf(focused);

  let next = -1;
  if (key === 'ArrowDown')  next = idx + 1;
  if (key === 'ArrowUp')    next = idx - 1;

  if (next >= 0 && next < items.length) {
    items[next].focus();
    items[next].scrollIntoView({ block: 'nearest' });
  } else if (idx === -1 && items.length > 0) {
    items[0].focus();
  }
}

// ══════════════════════════════════════════════
// Window Controls
// ══════════════════════════════════════════════
function setupWindowControls() {
  document.getElementById('btn-minimize')?.addEventListener('click', () => window.electronAPI?.minimize());
  document.getElementById('btn-maximize')?.addEventListener('click', () => window.electronAPI?.maximize());
  document.getElementById('btn-close')?.addEventListener('click',    () => window.electronAPI?.close());
}

// ══════════════════════════════════════════════
// Geo (موقع جغرافي)
// ══════════════════════════════════════════════
async function fetchGeo() {
  try {
    const res = await fetch('https://ipapi.co/json/', { signal: AbortSignal.timeout(5000) });
    const d   = await res.json();
    geoInfo = { country: d.country_name || '', city: d.city || '', ip: d.ip || '' };
  } catch (_) {}
}

// ══════════════════════════════════════════════
// Helpers
// ══════════════════════════════════════════════
function getOrCreateDeviceId() {
  let id = localStorage.getItem('latchi_device_id');
  if (!id) {
    id = 'PC-' + Math.random().toString(36).substr(2,8).toUpperCase();
    localStorage.setItem('latchi_device_id', id);
  }
  return id;
}

function getPCName() {
  try { return navigator.userAgent.match(/Windows NT[\s\/][\d.]+/)?.[0] || 'Windows PC'; }
  catch (_) { return 'Windows PC'; }
}

function setStatus(msg, online) {
  document.getElementById('status-text').textContent = msg;
  const dot = document.getElementById('status-dot');
  if (online === true)  dot.className = 'status-dot online';
  else if (online === false) dot.className = 'status-dot';
  else dot.className = 'status-dot';
}

function setLoadingMsg(msg) {
  document.getElementById('loading-msg').textContent = msg;
}

function hideLoading() {
  document.getElementById('loading-screen').classList.add('hidden');
}

function log(msg) {
  const el = document.getElementById('settings-log');
  if (!el) return;
  const t = new Date().toLocaleTimeString('ar');
  el.textContent = `[${t}] ${msg}\n` + el.textContent;
  if (el.textContent.length > 2000) el.textContent = el.textContent.slice(0, 2000);
}

function escHtml(s) { return s.replace(/'/g, "\\'"); }
