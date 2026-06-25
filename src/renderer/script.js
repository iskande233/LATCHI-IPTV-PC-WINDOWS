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
let tsPlayer     = null;
let lastPlayableUrl = "";
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
  } catch (_) { return false; }
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
async function playChannel(idx) {
  const ch = allChannels[idx];
  if (!ch) return;
  if (String(ch.url||'').startsWith('series://')) { await openSeriesEpisodes(ch); return; }
  currentCh = ch;
  document.getElementById('player-ch-name').textContent = ch.name;
  document.getElementById('player-ch-group').textContent = ch.group;
  document.getElementById('video-overlay').classList.add('hidden');
  renderChannelList(allChannels.filter(c => c.group === (currentCat || ch.group)));
  sendPing(ch.name);
  playMediaUrl(ch.url, ch.name);
  focusPanel = 'player';
}
function destroyPlayers(){ if (hlsPlayer){try{hlsPlayer.destroy()}catch(_){} hlsPlayer=null;} if(tsPlayer){try{tsPlayer.destroy()}catch(_){} tsPlayer=null;} }
function playMediaUrl(url, title='') {
  if (!url) return; lastPlayableUrl=url;
  const video=document.getElementById('player'); destroyPlayers(); video.pause(); video.removeAttribute('src'); video.load();
  const clean=String(url).replace(/&amp;/g,'&'); const lower=clean.toLowerCase().split('?')[0];
  const fallbackNative=()=>{ try{ destroyPlayers(); video.src=clean; video.load(); video.play().catch(err=>setStatus('⚠️ Player: '+err.message,false)); }catch(e){setStatus('❌ تشغيل فشل: '+e.message,false);} };
  if (lower.endsWith('.m3u8') || clean.includes('.m3u8')) {
    if (typeof Hls!=='undefined' && Hls.isSupported()) { hlsPlayer=new Hls({lowLatencyMode:true,maxBufferLength:45,maxMaxBufferLength:90,enableWorker:true}); hlsPlayer.loadSource(clean); hlsPlayer.attachMedia(video); hlsPlayer.on(Hls.Events.MANIFEST_PARSED,()=>video.play().catch(()=>{})); hlsPlayer.on(Hls.Events.ERROR,(_,d)=>{if(d.fatal)fallbackNative();}); }
    else fallbackNative(); return;
  }
  if (lower.endsWith('.ts') || clean.includes('/live/')) {
    if (typeof mpegts!=='undefined' && mpegts.getFeatureList?.().mseLivePlayback) { try{ tsPlayer=mpegts.createPlayer({type:'mpegts',isLive:true,cors:true,url:clean},{enableWorker:true,liveBufferLatencyChasing:true}); tsPlayer.attachMediaElement(video); tsPlayer.load(); video.play().catch(()=>{}); tsPlayer.on(mpegts.Events.ERROR,()=>fallbackNative()); }catch(e){fallbackNative();} }
    else fallbackNative(); return;
  }
  fallbackNative();
}
async function openSeriesEpisodes(seriesChannel){
  const creds=xtreamCreds(masterUrl); const id=String(seriesChannel.url||'').replace('series://',''); if(!creds||!id)return;
  setStatus('⏳ تحميل الحلقات...');
  try{ const url=`${creds.server}/player_api.php?username=${enc(creds.username)}&password=${enc(creds.password)}&action=get_series_info&series_id=${enc(id)}`; const info=await fetch(url,{signal:AbortSignal.timeout(20000)}).then(r=>r.json()); const epsObj=info.episodes||{}; const eps=[]; Object.keys(epsObj).forEach(season=>{(epsObj[season]||[]).forEach(ep=>{const epId=ep.id||ep.episode_id; const ext=ep.container_extension||'mp4'; if(epId) eps.push({name:`S${season}E${ep.episode_num||''} - ${ep.title||seriesChannel.name}`,logo:seriesChannel.logo||'',url:`${creds.server}/series/${creds.username}/${creds.password}/${epId}.${ext}`,group:seriesChannel.name});});}); allChannels=eps; currentCat=seriesChannel.name; renderChannelList(eps); setStatus(`✅ ${eps.length} حلقة`,true); setTimeout(()=>focusFirstChannel(),100); }catch(e){setStatus('❌ فشل تحميل الحلقات: '+e.message,false);}
}
function retryCurrent(){ if(currentCh) playMediaUrl(currentCh.url,currentCh.name); else if(lastPlayableUrl) playMediaUrl(lastPlayableUrl); }
function openCurrentExternal(){ if(lastPlayableUrl) window.electronAPI?.openExternal?.(lastPlayableUrl); }

function stopPlayer() {
  const video = document.getElementById('player');
  video.pause(); video.src = '';
  destroyPlayers();
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
// Matches / Favorites
// ══════════════════════════════════════════════
async function showMatches(){
  hide('home-screen'); show('main-view'); focusPanel='channels';
  document.getElementById('cat-list').innerHTML='<div class="cat-item active">⚽ المباريات</div>'; document.getElementById('cat-alphabet').innerHTML=''; document.getElementById('ch-alphabet').innerHTML='';
  const list=document.getElementById('ch-list'); list.innerHTML='<div class="empty-msg"><span class="spin">⏳</span> جاري تحميل المباريات...</div>';
  try{ const matches=await fetchYacine('/api/events'); const arr=matches.data||[]; if(!arr.length){list.innerHTML='<div class="empty-msg">لا توجد مباريات حالياً</div>';return;} list.innerHTML=arr.map((m,i)=>{const t1=m.team_1?.name||'?'; const t2=m.team_2?.name||'?'; const time=formatMatchTimePc(m.start_time,m.end_time); return `<div class="match-card" tabindex="0" onclick="playMatch(${i})" onkeydown="if(event.key==='Enter'){playMatch(${i})}"><div class="match-title">${t1} × ${t2}</div><div class="match-meta">${m.champions||''} • ${time} • 🎙️ ${m.commentary||''}</div><div class="match-channel">📺 ${m.channel||'—'}</div></div>`;}).join(''); window.__matches=arr; setTimeout(()=>document.querySelector('.match-card')?.focus(),100); }catch(e){ list.innerHTML='<div class="empty-msg">فشل تحميل المباريات: '+e.message+'</div>'; }
}
async function playMatch(i){ const m=(window.__matches||[])[i]; if(!m||!m.channel)return; setStatus('⏳ فتح قناة المباراة...'); try{ const ch=await findYacineChannel(m.channel); if(ch){ const st=await fetchYacine(`/api/channel/${ch.id}`); const stream=(st.data||[])[0]; if(stream?.url){ currentCh={name:m.channel,group:'Yacine TV',url:stream.url,logo:''}; document.getElementById('player-ch-name').textContent=currentCh.name; document.getElementById('player-ch-group').textContent=currentCh.group; document.getElementById('video-overlay').classList.add('hidden'); playMediaUrl(stream.url,m.channel); return; } } }catch(_){} setStatus('⚠️ لم يتم العثور على قناة المباراة',false); }
async function fetchYacine(path){ const KEY='c!xZj+N9&G@Ev@vw'; const res=await fetch('http://ver3.yacinelive.com'+path,{signal:AbortSignal.timeout(15000)}); const txt=await res.text(); const ts=res.headers.get('t')||Math.floor(Date.now()/1000).toString(); const bin=atob(txt); const key=KEY+ts; let out=''; for(let i=0;i<bin.length;i++) out+=String.fromCharCode(bin.charCodeAt(i)^key.charCodeAt(i%key.length)); return JSON.parse(out); }
async function findYacineChannel(name){ const cats=[4,5,6,7,89,9]; const q=normName(name); for(const cid of cats){ try{ const data=await fetchYacine(`/api/categories/${cid}/channels`); const found=(data.data||[]).find(c=>sameCh(q,normName(c.name))); if(found)return found; }catch(_){} } return null; }
function normName(s){return String(s||'').toLowerCase().replace('بي إن','bein').replace('بي ان','bein').replace('be in','bein').replace('sports','sport').replace(/[^a-z0-9]+/g,' ').trim();}
function sameCh(a,b){ const nums=x=>[...x.matchAll(/\d+/g)].map(m=>m[0]); const an=nums(a),bn=nums(b); const nOk=!an.length||!bn.length||an.some(n=>bn.includes(n)); const brand=['bein','ssc','alkass','kass'].some(k=>a.includes(k)&&b.includes(k)); return nOk&&brand&&(!a.includes('max')||b.includes('max'));}
function formatMatchTimePc(start,end){ const now=Math.floor(Date.now()/1000); if(now<start)return new Date(start*1000).toLocaleTimeString('ar-DZ',{hour:'2-digit',minute:'2-digit'}); if(now<=end)return'🔴 مباشر'; return'FT'; }
function showFavorites(){ hide('home-screen'); show('main-view'); focusPanel='channels'; document.getElementById('cat-list').innerHTML='<div class="cat-item active">⭐ المفضلة</div>'; document.getElementById('ch-list').innerHTML='<div class="empty-msg">⭐ سيتم تفعيل المفضلة في إصدار لاحق</div>'; }

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
    if (k === 'F11') { window.electronAPI?.toggleFullscreen?.(); e.preventDefault(); return; }
    if (k === 'F11') { window.electronAPI?.toggleFullscreen?.(); e.preventDefault(); return; }

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
  document.getElementById('btn-fullscreen')?.addEventListener('click', () => window.electronAPI?.toggleFullscreen?.());
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

// ══════════════════════════════════════════════
// v7.2 TV-like Lazy Engine override
// يحافظ على شكل التلفاز، لكن لا يحمل السيرفر كامل دفعة واحدة.
// ══════════════════════════════════════════════
let categoryIds = {};
let categoryCounts = {};
let currentType = 'live';

function xtreamCreds(url) {
  try {
    const u = new URL((url||'').replace(/&amp;/g,'&'));
    if (!u.href.toLowerCase().includes('get.php')) return null;
    const username = u.searchParams.get('username');
    const password = u.searchParams.get('password');
    if (!username || !password) return null;
    return { server: `${u.protocol}//${u.host}`, username, password };
  } catch(_) { return null; }
}
function enc(v){ return encodeURIComponent(v); }
function typeToCatAction(type){ return type==='movie'?'get_vod_categories':type==='series'?'get_series_categories':'get_live_categories'; }
function typeToStreamsAction(type){ return type==='movie'?'get_vod_streams':type==='series'?'get_series':'get_live_streams'; }
function normalizeCatName(n){ return String(n||'').trim(); }

async function loadChannels(type='live') {
  currentType = type;
  if (!masterUrl) { setStatus('⚠️ لم يُعيَّن رابط'); return; }
  const creds = xtreamCreds(masterUrl);
  if (creds) return loadXtreamCategories(type, creds);

  // fallback M3U فقط إذا ليس Xtream
  setStatus('⏳ جاري تحميل القنوات...');
  try {
    const res  = await fetch(`${SCRIPT_URL}?action=get_categories&_t=${Date.now()}`);
    const data = await res.json();
    if ((data.status === 'success' || data.success) && data.channels?.length > 0) {
      allChannels = data.channels.map(c => ({name:c.name, url:c.url||c.streamUrl, logo:c.logo||c.logoUrl||'', group:c.group||c.category||'أخرى'}));
      localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 500)));
      categoryIds = {}; categoryCounts = {};
      buildCategories(); updateHomeStats(); setStatus(`✅ ${allChannels.length} قناة`, true); return;
    }
  } catch (_) {}
  try {
    const res  = await fetch(masterUrl, { signal: AbortSignal.timeout(25000) });
    const text = await res.text();
    if (text.includes('#EXTINF')) {
      allChannels = parseM3U(text);
      localStorage.setItem('latchi_channels', JSON.stringify(allChannels.slice(0, 500)));
      categoryIds = {}; categoryCounts = {};
      buildCategories(); updateHomeStats(); setStatus(`✅ ${allChannels.length} قناة`, true);
    }
  } catch (e) { setStatus('❌ ' + e.message, false); }
}

async function loadXtreamCategories(type='live', creds=xtreamCreds(masterUrl)) {
  if (!creds) return loadChannels(type);
  setStatus('⏳ جاري تحميل الفئات...');
  currentType = type;
  try {
    const url = `${creds.server}/player_api.php?username=${enc(creds.username)}&password=${enc(creds.password)}&action=${typeToCatAction(type)}`;
    const cats = await fetch(url, {signal: AbortSignal.timeout(18000)}).then(r=>r.json());
    categoryIds = {}; categoryCounts = {}; allChannels = [];
    allCategories = (Array.isArray(cats)?cats:[]).map(c => {
      const name = normalizeCatName(c.category_name || c.name || 'أخرى');
      const id = String(c.category_id || c.id || '');
      if (id) categoryIds[name] = id;
      categoryCounts[name] = Number(c.count || c.category_count || c.child_count || -1);
      return name;
    }).filter(Boolean).sort((a,b)=>scoreCategory(a)-scoreCategory(b) || a.localeCompare(b));
    buildCategories(); updateHomeStats();
    setStatus(`✅ ${allCategories.length} فئة`, true);
    const preferred = choosePreferredCategory(type);
    if (preferred) await selectCategory(preferred);
    setTimeout(()=>focusFirstCat(),100);
  } catch(e) { setStatus('❌ فشل تحميل الفئات: '+e.message, false); }
}

function scoreCategory(cat) {
  const l=cat.toLowerCase();
  if (l.includes('world cup')||l.includes('كأس')||l.includes('كاس')) return 0;
  if (l.includes('bein')||l.includes('بي ان')||l.includes('بي إن')) return 1;
  if (l.includes('sport')||l.includes('رياض')||l.includes('ssc')||l.includes('alkass')) return 2;
  if (l.includes('movie')||l.includes('film')||l.includes('vod')||l.includes('أفلام')||l.includes('افلام')) return 3;
  if (l.includes('series')||l.includes('مسلسل')) return 4;
  return 10;
}
function choosePreferredCategory(type) {
  if (!allCategories.length) return '';
  if (type==='live') return allCategories.find(c=>scoreCategory(c)<=2) || allCategories[0];
  return allCategories[0];
}

function buildCategories() {
  if (!allCategories.length) allCategories = [...new Set(allChannels.map(c => c.group))].sort();
  const letters = [...new Set(allCategories.map(c => c[0]?.toUpperCase()).filter(Boolean))].sort();
  const catAlpha = document.getElementById('cat-alphabet');
  catAlpha.innerHTML = `<button class="alpha-btn active" tabindex="0" onclick="filterCatAlpha(this,'')">الكل</button>`;
  letters.slice(0,20).forEach(l => { catAlpha.innerHTML += `<button class="alpha-btn" tabindex="0" onclick="filterCatAlpha(this,'${l}')">${l}</button>`; });
  renderCatList(allCategories);
}

function renderCatList(cats) {
  const el = document.getElementById('cat-list');
  if (!cats.length) { el.innerHTML = '<div class="empty-msg">لا توجد فئات</div>'; return; }
  el.innerHTML = cats.map(cat => {
    const count = categoryIds[cat] ? (categoryCounts[cat] >= 0 ? categoryCounts[cat] : '…') : allChannels.filter(c => c.group === cat).length;
    return `<div class="cat-item ${cat===currentCat?'active':''}" tabindex="0" role="button"
      onclick="selectCategory('${esc(cat)}')"
      onkeydown="if(event.key==='Enter'||event.key===' '){selectCategory('${esc(cat)}');event.preventDefault()}"
      onfocus="onCatFocus(this)">
      <span class="cat-name">${cat}</span><span class="cat-count">${count}</span></div>`;
  }).join('');
}

async function selectCategory(cat) {
  currentCat = cat;
  renderCatList(allCategories);
  const creds = xtreamCreds(masterUrl);
  if (creds && categoryIds[cat]) {
    setStatus(`⏳ ${cat}...`);
    const channels = await fetchXtreamCategoryChannels(creds, currentType, categoryIds[cat], cat);
    allChannels = channels;
    renderChannelList(channels);
    setStatus(`✅ ${channels.length} قناة`, true);
    return;
  }
  let channels = allChannels.filter(c => c.group === cat);
  if (['bein','sport ar','sports'].some(k => cat.toLowerCase().includes(k))) {
    const pure = channels.filter(c => c.name.toLowerCase().includes('bein'));
    if (pure.length) channels = pure;
    channels = channels.sort((a,b)=>(b.name.toLowerCase().includes('max')?1:0)-(a.name.toLowerCase().includes('max')?1:0)||a.name.localeCompare(b.name));
  }
  renderChannelList(channels);
}

async function fetchXtreamCategoryChannels(creds,type,catId,catName) {
  try {
    const url = `${creds.server}/player_api.php?username=${enc(creds.username)}&password=${enc(creds.password)}&action=${typeToStreamsAction(type)}&category_id=${enc(catId)}`;
    const arr = await fetch(url,{signal:AbortSignal.timeout(25000)}).then(r=>r.json());
    return (Array.isArray(arr)?arr:[]).map(o=>{
      const id = String(o.stream_id || o.series_id || o.id || '');
      const name = o.name || o.title || 'Stream';
      const logo = o.stream_icon || o.cover || o.logo || '';
      const ext = o.container_extension || 'mp4';
      let streamUrl = '';
      if (type==='live') streamUrl = `${creds.server}/live/${creds.username}/${creds.password}/${id}.ts`;
      else if (type==='movie') streamUrl = `${creds.server}/movie/${creds.username}/${creds.password}/${id}.${ext}`;
      else streamUrl = `series://${id}`;
      return {name, logo, url:streamUrl, group:catName};
    }).filter(c=>c.url && !c.url.endsWith('/.ts'));
  } catch(e) { return []; }
}

function goToLive(){ hide('home-screen'); show('main-view'); focusPanel='cats'; loadChannels('live'); }
function goToBein(){ hide('home-screen'); show('main-view'); focusPanel='cats'; loadXtreamCategories('live').then(()=>{ const b=allCategories.find(c=>['bein','sport','رياض'].some(k=>c.toLowerCase().includes(k))); if(b) selectCategory(b); }); }
function goToSection(section){
  if(section==='movies'){ hide('home-screen'); show('main-view'); focusPanel='cats'; loadChannels('movie'); return; }
  if(section==='series'){ hide('home-screen'); show('main-view'); focusPanel='cats'; loadChannels('series'); return; }
  if(section==='matches'){ showMatches(); return; }
  if(section==='favorites'){ showFavorites(); return; }
  if(section==='accounts'){ const code=localStorage.getItem('latchi_vip_code')||'—'; alert(`👤 الحساب\n\nالوضع: ${appMode==='vip'?'🔐 VIP':'🔓 مجاني'}\nالكود: ${code}\nRevision: ${lastRevision}\nالجهاز: ${deviceId}`); }
}

function updateHomeStats(){
  const el=document.getElementById('stat-channels'); if(el) el.textContent = allChannels.length || '—';
  const el2=document.getElementById('stat-cats'); if(el2) el2.textContent = allCategories.length || '—';
  const modeEl=document.getElementById('card-mode-label'); if(modeEl) modeEl.textContent = appMode==='vip'?'🔐 VIP':'🔓 مجاني';
}

