
// -- SUPABASE AUTH CLIENT ---------------------------------------
// Load Supabase JS via CDN (injected at runtime)
let _supabaseClient = null;
function getSB(){
  if(_supabaseClient) return _supabaseClient;
  const url = getSupabaseUrl();
  const key = getSupabaseKey();
  if(typeof window !== 'undefined' && window._supabase && url && key){
    _supabaseClient = window._supabase.createClient(url, key);
  }
  return _supabaseClient;
}

let currentUser = null;

// -- AUTH FUNCTIONS --------------------------------------------
let authMode = 'signin'; // 'signin' | 'signup'

function showAuthScreen(){
  document.getElementById('authScreen').classList.remove('hidden');
}
function hideAuthScreen(){
  document.getElementById('authScreen').classList.add('hidden');
}

function toggleAuthMode(){
  authMode = authMode === 'signin' ? 'signup' : 'signin';
  const btn = document.getElementById('authSubmitBtn');
  const toggle = document.getElementById('authToggle');
  if(authMode === 'signup'){
    btn.textContent = 'Create account';
    toggle.innerHTML = 'Already have an account? <span onclick="toggleAuthMode()">Sign in</span>';
  } else {
    btn.textContent = 'Sign in';
    toggle.innerHTML = "Don't have an account? <span onclick=\"toggleAuthMode()\">Sign up</span>";
  }
  showAuthError('');
}

function showAuthError(msg){
  const el = document.getElementById('authError');
  if(msg){ el.textContent = msg; el.classList.add('show'); }
  else { el.classList.remove('show'); }
}

async function submitAuth(){
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){ showAuthError('Please enter your email and password'); return; }

  const btn = document.getElementById('authSubmitBtn');
  btn.disabled = true;
  btn.textContent = authMode === 'signin' ? 'Signing in...' : 'Creating account...';
  showAuthError('');

  const sb = getSB();
  if(!sb){ showAuthError('Connection error — check your internet'); btn.disabled=false; btn.textContent=authMode==='signin'?'Sign in':'Create account'; return; }

  try{
    let result;
    if(authMode === 'signup'){
      result = await sb.auth.signUp({email, password});
      if(result.error) throw result.error;
      if(result.data?.user?.identities?.length === 0){
        showAuthError('An account with this email already exists. Try signing in.');
        btn.disabled=false; btn.textContent='Create account'; return;
      }
      showAuthError('');
      // If email confirmation required
      if(!result.data?.session){
        showToast('✓ Check your email to confirm your account');
        btn.disabled=false; btn.textContent='Create account'; return;
      }
    } else {
      result = await sb.auth.signInWithPassword({email, password});
      if(result.error) throw result.error;
    }
    // Session established - onAuthStateChange will handle the rest
  } catch(err){
    const msg = err.message || 'Authentication failed';
    showAuthError(msg.includes('Invalid login') ? 'Incorrect email or password' : msg);
    btn.disabled=false;
    btn.textContent=authMode==='signin'?'Sign in':'Create account';
  }
}

async function signInWithGoogle(){
  const sb = getSB();
  if(!sb){ showAuthError('Connection error'); return; }
  const { error } = await sb.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + window.location.pathname }
  });
  if(error) showAuthError(error.message);
}

async function showForgotPassword(){
  const email = document.getElementById('authEmail').value.trim();
  const addr = email || prompt('Enter your email address:');
  if(!addr) return;
  const sb = getSB();
  if(!sb) return;
  const { error } = await sb.auth.resetPasswordForEmail(addr, {
    redirectTo: window.location.origin + window.location.pathname + '?reset=true'
  });
  if(error) showAuthError(error.message);
  else showToast('✓ Password reset email sent');
}

async function signOut(){
  const sb = getSB();
  if(sb) await sb.auth.signOut();
  currentUser = null;
  cards = [];
  updateStats();
  renderGrid();
  document.getElementById('userBar').style.display = 'none';
  showAuthScreen();
  showToast('Signed out');
}

function onUserSignedIn(user){
  currentUser = user;
  hideAuthScreen();

  // Show user bar
  const bar = document.getElementById('userBar');
  bar.style.display = 'flex';
  const avatar = document.getElementById('userAvatar');
  const pic = user.user_metadata?.avatar_url;
  if(pic){ avatar.innerHTML = `<img src="${pic}" alt="">`; }
  else { avatar.textContent = (user.email||'?')[0].toUpperCase(); }

  // Load their cards from cloud
  loadUserCards();
}

async function loadUserCards(){
  if(!currentUser || !isSupabaseConnected()) return;
  try{
    const sbUrl = getSupabaseUrl();
    const sb = getSB();
    const { data, error } = await sb.from('cards').select('*').order('updated_at', {ascending:false});
    if(error) throw error;
    if(data && data.length > 0){
      cards = data.map(row=>({
        ...row.data,
        id: row.id,
        cloudImgUrl: row.img_url,
        imgData: row.img_url || row.data?.imgData || null,
      }));
      localStorage.setItem('cv_cards', JSON.stringify(cards));
      localStorage.setItem('cv_last_sync', Date.now().toString());
    } else {
      // No cloud cards — load from local storage as seed
      const local = JSON.parse(localStorage.getItem('cv_cards')||'[]');
      if(local.length > 0){
        cards = local;
        syncNow(); // push local cards up to cloud under this user
      }
    }
    updateStats();
    renderGrid();
  } catch(e){
    console.warn('loadUserCards failed', e);
    // Fall back to local
    cards = JSON.parse(localStorage.getItem('cv_cards')||'[]');
    updateStats();
    renderGrid();
  }
}

// Initialize auth on startup
async function initAuth(){
  // Load config (env vars) from Netlify function first
  await loadConfig();

  // Reset client so it gets rebuilt with fresh credentials
  _supabaseClient = null;

  // Wait for Supabase SDK to be available
  let attempts = 0;
  while(!window._supabase && attempts < 20){
    await new Promise(r=>setTimeout(r,100));
    attempts++;
  }

  const sb = getSB();
  if(!sb){
    console.warn('Supabase not available, running in local mode');
    cards = JSON.parse(localStorage.getItem('cv_cards')||'[]');
    updateStats(); renderGrid();
    return;
  }

  // Listen for auth state changes
  sb.auth.onAuthStateChange((event, session)=>{
    if(session?.user){
      onUserSignedIn(session.user);
    } else if(event === 'SIGNED_OUT'){
      currentUser = null;
      showAuthScreen();
    }
  });

  // Check for existing session
  const { data: { session } } = await sb.auth.getSession();
  if(session?.user){
    onUserSignedIn(session.user);
  } else {
    showAuthScreen();
  }
}

let cards = JSON.parse(localStorage.getItem('cv_cards') || '[]');

let hotData = JSON.parse(localStorage.getItem('cv_hot') || 'null');
let hotLastFetch = parseInt(localStorage.getItem('cv_hot_ts') || '0');
let currentFilter = 'all';
let currentView = 'catalog';
let prevView = 'catalog';

// -- SUPABASE SYNC ----------------------------------------------
// -- RUNTIME CONFIG (keys served from Netlify env vars, never in source) ----
let _runtimeConfig = null;

async function loadConfig(){
  if(_runtimeConfig) return _runtimeConfig;
  try{
    const resp = await fetch('/.netlify/functions/config');
    if(resp.ok){
      _runtimeConfig = await resp.json();
      // Cache in session storage so we don't fetch every page load
      sessionStorage.setItem('cv_config', JSON.stringify(_runtimeConfig));
    }
  } catch(e){
    // Fallback to session cache if function unreachable
    const cached = sessionStorage.getItem('cv_config');
    if(cached) _runtimeConfig = JSON.parse(cached);
  }
  return _runtimeConfig;
}

function getSupabaseUrl(){
  // Priority: runtime config > localStorage override > empty
  return (_runtimeConfig && _runtimeConfig.supabaseUrl) ||
         localStorage.getItem('cv_sb_url') || '';
}

function getSupabaseKey(){
  return (_runtimeConfig && _runtimeConfig.supabaseKey) ||
         localStorage.getItem('cv_sb_key') || '';
}

function isSupabaseConnected(){ return !!(getSupabaseUrl() && getSupabaseKey()); }
let syncInProgress = false;
let pendingSync = false;

function sbHeaders(){
  return {
    'Content-Type': 'application/json',
    'apikey': getSupabaseKey(),
    'Authorization': 'Bearer ' + getSupabaseKey(),
    'Prefer': 'return=minimal'
  };
}

function saveSupabaseKeys(){
  const url = document.getElementById('supabaseUrl').value.trim().replace(/\/$/, '');
  const key = document.getElementById('supabaseKey').value.trim();
  if(!url || !key){ showToast('Enter both URL and key'); return; }
  localStorage.setItem('cv_sb_url', url);
  localStorage.setItem('cv_sb_key', key);
  showToast(' Supabase connected  syncing...');
  renderSupabaseStatus();
  syncNow();
}

function copySupabaseSQL(){
  const sql = `create table cards (\n  id text primary key,\n  data jsonb not null,\n  img_url text,\n  updated_at timestamptz default now()\n);\nalter table cards enable row level security;\ncreate policy "public access" on cards\n  for all using (true) with check (true);`;
  navigator.clipboard.writeText(sql).then(()=>showToast(' SQL copied')).catch(()=>showToast('Copy failed'));
}

function renderSupabaseStatus(){
  const area = document.getElementById('supabaseStatusArea');
  if(!area) return;
  const connected = isSupabaseConnected();
  area.innerHTML = connected
    ? `<div class="ebay-connected" style="margin-bottom:10px"><div class="ebay-connected-dot"></div><div class="ebay-connected-text"> Cloud sync active</div><button class="ebay-disconnect-btn" onclick="disconnectSupabase()">Disconnect</button></div>`
    : '';
  const urlEl = document.getElementById('supabaseUrl');
  const keyEl = document.getElementById('supabaseKey');
  if(urlEl) urlEl.value = getSupabaseUrl();
  if(keyEl) keyEl.value = getSupabaseKey() ? '************' : '';
  updateSyncBar();
}

function disconnectSupabase(){
  if(!confirm('Disconnect cloud sync? Your local cards stay on this device.')) return;
  localStorage.removeItem('cv_sb_url');
  localStorage.removeItem('cv_sb_key');
  renderSupabaseStatus();
  showToast('Cloud sync disconnected');
}

function updateSyncBar(msg, isError){
  const bar = document.getElementById('syncStatusBar');
  if(!bar) return;
  const lastSync = localStorage.getItem('cv_last_sync');
  if(msg){
    bar.style.display = 'block';
    bar.style.borderColor = isError ? 'rgba(224,92,92,.3)' : 'var(--border2)';
    bar.style.color = isError ? 'var(--red)' : 'var(--text2)';
    bar.textContent = msg;
  } else if(lastSync){
    bar.style.display = 'block';
    bar.style.borderColor = 'rgba(76,175,125,.3)';
    bar.style.color = 'var(--green)';
    bar.textContent = ' Last synced: ' + new Date(parseInt(lastSync)).toLocaleString();
  } else {
    bar.style.display = 'none';
  }
}

// Compress image to ~150KB for cloud storage
async function compressImage(dataUrl, maxKB=150){
  if(!dataUrl) return null;
  return new Promise(res=>{
    const img = new Image();
    img.onload = ()=>{
      const canvas = document.createElement('canvas');
      let w = img.width, h = img.height;
      const maxDim = 800;
      if(w > maxDim || h > maxDim){
        if(w > h){ h = Math.round(h * maxDim/w); w = maxDim; }
        else { w = Math.round(w * maxDim/h); h = maxDim; }
      }
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(img, 0, 0, w, h);
      // Try quality steps until under maxKB
      let quality = 0.8;
      let result = canvas.toDataURL('image/jpeg', quality);
      while(result.length > maxKB * 1024 * 1.37 && quality > 0.2){
        quality -= 0.1;
        result = canvas.toDataURL('image/jpeg', quality);
      }
      res(result);
    };
    img.onerror = ()=>res(dataUrl);
    img.src = dataUrl;
  });
}

// Upload image to Supabase Storage, return public URL
async function uploadImageToSupabase(cardId, dataUrl){
  if(!dataUrl || !isSupabaseConnected()) return null;
  const compressed = await compressImage(dataUrl);
  if(!compressed) return null;

  const base64 = compressed.split(',')[1];
  const mime = compressed.split(';')[0].split(':')[1] || 'image/jpeg';
  const ext = mime.includes('png') ? 'png' : 'jpg';
  const path = `cards/${cardId}.${ext}`;

  // Convert base64 to blob
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++) arr[i]=bytes.charCodeAt(i);
  const blob = new Blob([arr], {type: mime});

  const sbUrl = getSupabaseUrl();
  const sbKey = getSupabaseKey();

  try{
    // Upload to Supabase Storage
    const resp = await fetch(`${sbUrl}/storage/v1/object/card-images/${path}`, {
      method: 'POST',
      headers: { 'apikey': sbKey, 'Authorization': 'Bearer '+sbKey, 'Content-Type': mime, 'x-upsert': 'true' },
      body: blob
    });
    if(resp.ok || resp.status===200 || resp.status===201 || resp.status===409){
      return `${sbUrl}/storage/v1/object/public/card-images/${path}`;
    }
  } catch(e){ console.warn('Supabase image upload failed', e); }
  return null;
}

// Push a single card to Supabase
async function pushCard(card){
  if(!isSupabaseConnected()) return;

  // Strip local imgData, use cloud URL instead
  const {imgData, ...cardData} = card;
  let imgUrl = card.cloudImgUrl || null;

  // Upload image if not yet in cloud
  if(imgData && !imgUrl){
    imgUrl = await uploadImageToSupabase(card.id, imgData);
    if(imgUrl){
      const idx = cards.findIndex(c=>c.id===card.id);
      if(idx>=0){ cards[idx].cloudImgUrl = imgUrl; }
      localStorage.setItem('cv_cards', JSON.stringify(cards));
    }
  }

  const payload = { id: card.id, data: cardData, img_url: imgUrl, updated_at: new Date().toISOString(), user_id: currentUser?.id || null };

  const sb = getSB();
  if(sb){
    await sb.from('cards').upsert(payload);
  } else {
    await fetch(`${getSupabaseUrl()}/rest/v1/cards`, {
      method: 'POST',
      headers: { ...sbHeaders(), 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload)
    });
  }
}

// Push all local cards to cloud
async function syncNow(){
  if(!isSupabaseConnected()){ showToast('Set up cloud sync in Settings first'); return; }
  if(syncInProgress){ pendingSync=true; return; }
  syncInProgress = true;
  updateSyncBar(' Syncing ' + cards.length + ' cards...');

  try{
    // First ensure the storage bucket exists
    await ensureStorageBucket();

    for(let i=0; i<cards.length; i++){
      updateSyncBar(` Syncing card ${i+1}/${cards.length}...`);
      await pushCard(cards[i]);
    }
    localStorage.setItem('cv_last_sync', Date.now().toString());
    updateSyncBar();
    showToast(' Catalog synced to cloud');
  } catch(e){
    updateSyncBar(' Sync failed: ' + e.message, true);
    console.error(e);
  } finally{
    syncInProgress = false;
    if(pendingSync){ pendingSync=false; syncNow(); }
  }
}

// Pull all cards from cloud (replaces local)
async function pullFromCloud(){
  if(!isSupabaseConnected()){ showToast('Set up cloud sync first'); return; }
  if(!confirm('Pull from cloud? This will replace your local catalog with the cloud version.')) return;
  updateSyncBar('⏳ Pulling from cloud...');

  try{
    const sb = getSB();
    let rows;
    if(sb){
      const { data, error } = await sb.from('cards').select('*').order('updated_at', {ascending:false});
      if(error) throw error;
      rows = data;
    } else {
      const resp = await fetch(`${getSupabaseUrl()}/rest/v1/cards?select=*&order=updated_at.desc`, { headers: sbHeaders() });
      if(!resp.ok) throw new Error('Failed to fetch: ' + resp.status);
      rows = await resp.json();
    }
    if(!Array.isArray(rows)) throw new Error('Unexpected response');

    cards = rows.map(row => ({
      ...row.data,
      id: row.id,
      cloudImgUrl: row.img_url,
      imgData: row.img_url || row.data?.imgData || null,
    }));

    localStorage.setItem('cv_cards', JSON.stringify(cards));
    localStorage.setItem('cv_last_sync', Date.now().toString());
    updateStats();
    renderGrid();
    updateSyncBar();
    showToast(`✓ Pulled ${cards.length} cards from cloud`);
  } catch(e){
    updateSyncBar('❌ Pull failed: ' + e.message, true);
    console.error(e);
  }
}

// Delete a card from cloud
async function deleteCardFromCloud(id){
  if(!isSupabaseConnected()) return;
  const sbUrl = getSupabaseUrl();
  const sbKey = getSupabaseKey();
  try{
    const sb = getSB();
    if(sb){
      await sb.from('cards').delete().eq('id', id);
    } else {
      await fetch(`${sbUrl}/rest/v1/cards?id=eq.${id}`, { method: 'DELETE', headers: sbHeaders() });
    }
    // Also delete image
    await fetch(`${sbUrl}/storage/v1/object/card-images/cards/${id}.jpg`, {
      method: 'DELETE', headers: { 'apikey': sbKey, 'Authorization': 'Bearer '+sbKey }
    });
  } catch(e){ console.warn('Cloud delete failed', e); }
}

async function ensureStorageBucket(){
  const sbUrl = getSupabaseUrl();
  const sbKey = getSupabaseKey();
  try{
    // Create bucket if it doesn't exist
    await fetch(`${sbUrl}/storage/v1/bucket`, {
      method: 'POST',
      headers: { 'apikey': sbKey, 'Authorization': 'Bearer '+sbKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'card-images', name: 'card-images', public: true })
    });
  } catch(e){ /* bucket may already exist, that's fine */ }
}

// Auto-sync after every save
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2); }
function save(){
  localStorage.setItem('cv_cards', JSON.stringify(cards));
  // Debounced cloud sync  don't hammer Supabase on rapid changes
  clearTimeout(save._timer);
  save._timer = setTimeout(()=>{
    if(isSupabaseConnected()) syncNow();
  }, 3000);
}
function getApiKey(){ return localStorage.getItem('cv_apikey') || ''; }
function openLink(url){ window.open(url,'_blank'); }

function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'), 2600);
}

function saveApiKey(){
  const val = document.getElementById('apiKeyInput').value.trim();
  if(!val){ showToast('Please enter your API key'); return; }
  localStorage.setItem('cv_apikey', val);
  showToast(' API key saved');
}

function showView(name){
  prevView = currentView === 'detail' ? prevView : currentView;
  currentView = name;
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  if(name==='catalog'){ document.getElementById('viewCatalog').classList.add('active'); document.getElementById('navCatalog').classList.add('active'); renderGrid(); }
  else if(name==='hot'){ document.getElementById('viewHot').classList.add('active'); document.getElementById('navHot').classList.add('active'); loadHotCards(false); }
  else if(name==='detail'){ document.getElementById('viewDetail').classList.add('active'); }
  else if(name==='settings'){ document.getElementById('viewSettings').classList.add('active'); document.getElementById('navSettings').classList.add('active'); document.getElementById('apiKeyInput').value=getApiKey(); onSettingsOpen(); }
}

function goBack(){ showView(prevView||'catalog'); }

function updateStats(){
  const unsold = cards.filter(c=>!c.sold);
  document.getElementById('statTotal').textContent = cards.length;
  document.getElementById('statValue').textContent = '$' + unsold.reduce((a,c)=>a+(c.priceMid||c.priceMin||0),0).toLocaleString();
  document.getElementById('statRC').textContent = cards.filter(c=>c.rookie&&!c.sold).length;
  // Update sold count badge if it exists
  const soldEl = document.getElementById('statSold');
  if(soldEl) soldEl.textContent = cards.filter(c=>c.sold).length;
}

function getHotSet(){
  if(!hotData||!hotData.cards) return new Set();
  return new Set(hotData.cards.map(c=>(c.player||'').toLowerCase()));
}

function renderGrid(){
  const grid = document.getElementById('cardsGrid');
  const hotSet = getHotSet();
  let list;
  if(currentFilter==='sold') list = cards.filter(c=>c.sold);
  else if(currentFilter==='all') list = cards.filter(c=>!c.sold);
  else list = cards.filter(c=>c.sport===currentFilter&&!c.sold);
  if(!list.length){
    grid.innerHTML=`<div class="empty-state"><div class="empty-icon"></div><h3>${cards.length?'No cards here':'Collection is empty'}</h3><p>${cards.length?'Try another filter':'Tap Add Card to photograph your first card'}</p></div>`;
    return;
  }
  grid.innerHTML = list.map(c=>{
    const hot = hotSet.has((c.player||'').toLowerCase());
    const badge = c.parallel ? `<div class="parallel-badge ${getBadgeClass(c.parallel)}">${c.parallel}</div>` : '';
    const rc = c.rookie ? '<div class="badge-rc">RC</div>' : '';
    const fire = hot && !lotMode && !c.sold ? '<div class="fire-badge">🔥 HOT</div>' : '';
    const soldBadge = c.sold ? `<div style="position:absolute;bottom:5px;right:5px;background:var(--green);color:#fff;font-size:9px;font-weight:700;padding:2px 8px;border-radius:20px">✓ SOLD${c.soldPrice?' $'+c.soldPrice:''}</div>` : '';
    const img = c.imgData ? `<img src="${c.imgData}" alt="">` : '<div class="card-img-placeholder">🃏</div>';
    const chips = [c.numbered,c.grade,c.auto?'Auto':null,c.relic?'Relic':null].filter(Boolean).map(x=>`<span class="chip">${x}</span>`).join('');

    if(lotMode){
      const sel = lotSelected.has(c.id);
      const check = sel
        ? `<div class="lot-check">✓</div>`
        : `<div class="lot-check-empty"></div>`;
      return `<div class="card-thumb lot-selectable${sel?' lot-selected':''}" onclick="toggleLotCard('${c.id}',event)">
        <div class="card-img-wrap">${img}${badge}${rc}${check}</div>
        <div class="card-info">
          <div class="card-name">${c.player||'Identifying...'}</div>
          <div class="card-meta">${[c.year,c.brand].filter(Boolean).join(' · ')||c.team||''}</div>
          <div class="card-chips">${chips}</div>
        </div>
      </div>`;
    }

    return `<div class="card-thumb${hot&&!c.sold?' hot-card':''}${c.sold?' sold-card':''}" onclick="openDetail('${c.id}')">
      <div class="card-img-wrap">${img}${badge}${rc}${fire}${soldBadge}</div>
      <div class="card-info">
        <div class="card-name">${c.player||'Identifying...'}</div>
        <div class="card-meta">${[c.year,c.brand].filter(Boolean).join(' · ')||c.team||''}</div>
        <div class="card-chips">${chips}</div>
      </div>
    </div>`;
  }).join('');
}

function getBadgeClass(p){
  const l=(p||'').toLowerCase();
  if(l.includes('gold')) return 'badge-gold';
  if(l.includes('silver')||l.includes('refract')) return 'badge-silver';
  return 'badge-base';
}

function filterCards(f,el){
  currentFilter=f;
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  renderGrid();
}

function handleFiles(files){
  const arr=Array.from(files);
  if(!arr.length) return;
  const key=getApiKey();
  if(!key){ showToast(' Add your API key in Settings first'); showView('settings'); return; }
  document.getElementById('fileInput').value='';
  (async()=>{ for(const f of arr){ const d=await readFile(f); await analyzeCard(d,f.name,key); } })();
}

function readFile(f){
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=e=>res(e.target.result); r.onerror=()=>rej(); r.readAsDataURL(f); });
}

async function analyzeCard(imgData, filename, key){
  const ov=document.getElementById('analyzingOverlay');
  document.getElementById('analyzingText').textContent='Analyzing '+filename;
  ov.classList.remove('hidden');
  const base64=imgData.split(',')[1];
  const mime=imgData.split(';')[0].split(':')[1];
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',max_tokens:1000,
        messages:[{role:'user',content:[
          {type:'image',source:{type:'base64',media_type:mime,data:base64}},
          {type:'text',text:`You are a sports card expert. Analyze this card image and return ONLY a valid JSON object, no markdown or explanation:
{"player":"Full name","team":"Team name","sport":"Baseball|Basketball|Football|Hockey|Soccer","year":"year string","brand":"e.g. Panini Prizm or Topps Chrome","set":"set name","parallel":"e.g. Gold Prizm or Silver or null","numbered":"e.g. /99 or null","rookie":true or false,"auto":true or false,"relic":true or false,"grade":"e.g. PSA 9 or null","condition":"Gem Mint|Near Mint|Good|Fair","priceMin":integer USD,"priceMax":integer USD,"priceMid":integer USD,"ebayTitle":"eBay optimized title under 80 chars","ebayDesc":"2-3 sentence eBay description"}`}
        ]}]
      })
    });
    const data=await resp.json();
    if(data.error){ showToast('API error: '+data.error.message); return; }
    let info={};
    try{ const raw=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join(''); info=JSON.parse(raw.replace(/```json|```/g,'').trim()); }
    catch(e){ info={player:'Unknown Card',sport:'Baseball',priceMin:5,priceMax:20,priceMid:10,condition:'Near Mint',ebayTitle:'Sports Card',ebayDesc:'Sports card in good condition.'}; }
    const card={id:uid(),imgData,...info};
    cards.push(card);
    save(); updateStats(); renderGrid();
    showToast(' Identified: '+(info.player||'Card'));
    openDetail(card.id);
  } catch(e){ showToast('Error  check API key in Settings'); console.error(e); }
  finally{ ov.classList.add('hidden'); }
}

function openDetail(id){
  const c=cards.find(x=>x.id===id);
  if(!c) return;
  const hotSet=getHotSet();
  const isHot=hotSet.has((c.player||'').toLowerCase());
  const hotInfo=hotData&&hotData.cards?hotData.cards.find(x=>(x.player||'').toLowerCase()===(c.player||'').toLowerCase()):null;
  document.getElementById('detailTitle').textContent=c.player||'Card Detail';
  document.getElementById('detailHotIcon').textContent=isHot?'🔥':'';
  const img=c.imgData?`<img src="${c.imgData}" alt="">`:'<div class="detail-img-placeholder">🃏</div>';
  const hotBox=isHot&&hotInfo?`<div class="hot-alert-box"><div class="hot-alert-title">🔥 This card is HOT right now</div><div class="hot-alert-body"><strong>${hotInfo.reason}</strong> — ${hotInfo.news}${hotInfo.sellWindow?'<br><br><strong>Sell window:</strong> '+hotInfo.sellWindow:''}</div></div>`:'';
  const fields=[['Player',c.player],['Team',c.team],['Sport',c.sport],['Year',c.year],['Brand',c.brand],['Set',c.set],['Parallel',c.parallel],['Numbered',c.numbered],['Rookie',c.rookie?'Yes':null],['Auto',c.auto?'Yes':null],['Relic',c.relic?'Yes':null],['Grade',c.grade],['Condition',c.condition]]
    .filter(([,v])=>v!=null)
    .map(([k,v])=>`<div class="field"><span class="field-key">${k}</span><span class="field-val">${v}</span></div>`).join('');
  const priceNote=isHot?` <span style="color:var(--orange);font-size:10px">↑ trending</span>`:'';

  // Cost & profit calculations
  const costBasis=c.costBasis!=null?`$${c.costBasis}`:'—';
  const profit=c.sold&&c.soldPrice!=null&&c.costBasis!=null?c.soldPrice-c.costBasis:null;
  const profitColor=profit!=null?(profit>=0?'var(--green)':'var(--red)'):'';
  const profitLabel=profit!=null?`${profit>=0?'+':''}$${profit.toFixed(2)}`:'';
  const unrealized=(c.priceMid||c.priceMin||0)-(c.costBasis||0);

  // Sold banner
  const soldBanner=c.sold?`
    <div style="background:rgba(76,175,125,.1);border:1px solid rgba(76,175,125,.3);border-radius:var(--radius);padding:12px 14px;margin-bottom:16px;display:flex;justify-content:space-between;align-items:center">
      <div>
        <div style="font-size:11px;font-weight:600;color:var(--green);margin-bottom:2px">✓ Sold${c.soldDate?' on '+new Date(c.soldDate).toLocaleDateString():''}</div>
        <div style="font-size:12px;color:var(--text2)">Sale price: <span style="color:var(--text);font-weight:600;font-family:'DM Mono',monospace">$${c.soldPrice||0}</span>${profitLabel?' · P&L: <span style="color:'+profitColor+';font-weight:600;font-family:\'DM Mono\',monospace">'+profitLabel+'</span>':''}</div>
      </div>
      <button onclick="markUnsold('${id}')" style="padding:5px 12px;border-radius:6px;border:1px solid var(--border2);background:var(--surface3);color:var(--text2);font-size:11px;cursor:pointer;font-family:'Sora',sans-serif">Undo</button>
    </div>`:'';

  document.getElementById('detailScroll').innerHTML=`
    <div class="detail-img-wrap">${img}</div>
    ${soldBanner}
    ${hotBox}
    <div class="section"><div class="section-label">Card details</div><div class="fields">${fields}</div></div>

    <div class="section">
      <div class="section-label">Financials</div>
      <div class="fields">
        <div class="field">
          <span class="field-key">Purchase price</span>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="field-val" id="costDisplay">${costBasis}</span>
            <button onclick="editCost('${id}')" style="font-size:10px;padding:3px 9px;border-radius:5px;border:1px solid var(--border2);background:var(--surface3);color:var(--text2);cursor:pointer;font-family:'Sora',sans-serif">${c.costBasis!=null?'Edit':'Add'}</button>
          </div>
        </div>
        ${c.priceMid||c.priceMin?`<div class="field"><span class="field-key">Est. sell value</span><span class="field-val" style="color:var(--green)">$${c.priceMid||c.priceMin||0}</span></div>`:''}
        ${c.costBasis!=null&&(c.priceMid||c.priceMin)?`<div class="field"><span class="field-key">Unrealized gain</span><span class="field-val" style="color:${unrealized>=0?'var(--green)':'var(--red)'}">${unrealized>=0?'+':''}$${unrealized.toFixed(2)}</span></div>`:''}
      </div>
    </div>

    <div class="section"><div class="section-label">eBay listing</div>
    <div class="ebay-box">
      <div class="ebay-title-text">${c.ebayTitle||'—'}</div>
      <div class="ebay-desc">${c.ebayDesc||'—'}</div>
      <div class="price-row">
        <div><div class="price-label">Suggested price${priceNote}</div><div class="price-range">$${c.priceMin||0}–$${c.priceMax||0} range</div></div>
        <div class="price-val">$${c.priceMid||c.priceMin||0}</div>
      </div>
      ${!c.sold?`<button class="list-btn" onclick="openEbayModal('${id}')"><span class="list-btn-icon">🛒</span> List on eBay</button>`:''}
      ${!c.sold?`<button onclick="openMarkSold('${id}')" style="width:100%;padding:11px;border-radius:8px;border:1px solid rgba(76,175,125,.3);background:rgba(76,175,125,.08);color:var(--green);font-size:13px;font-weight:600;cursor:pointer;font-family:'Sora',sans-serif;margin-bottom:8px">✓ Mark as Sold</button>`:''}
      <button class="copy-btn" onclick="copyListing('${id}')">Copy title + description</button>
      <button class="delete-btn" onclick="deleteCard('${id}')">Remove from catalog</button>
    </div></div>`;
  prevView=currentView;
  showView('detail');
}

function editCost(id){
  const c=cards.find(x=>x.id===id);
  if(!c) return;
  const val=prompt('What did you pay for this card? ($):', c.costBasis!=null?c.costBasis:'');
  if(val===null) return;
  const num=parseFloat(val);
  if(isNaN(num)||num<0){ showToast('Enter a valid price'); return; }
  const idx=cards.findIndex(x=>x.id===id);
  if(idx>=0){ cards[idx].costBasis=num; save(); }
  showToast('✓ Purchase price saved');
  openDetail(id);
}

function openMarkSold(id){
  const c=cards.find(x=>x.id===id);
  if(!c) return;
  const val=prompt(`What did you sell ${c.player||'this card'} for? ($):`, c.soldPrice||c.priceMid||'');
  if(val===null) return;
  const num=parseFloat(val);
  if(isNaN(num)||num<0){ showToast('Enter a valid price'); return; }
  const idx=cards.findIndex(x=>x.id===id);
  if(idx>=0){ cards[idx].sold=true; cards[idx].soldPrice=num; cards[idx].soldDate=new Date().toISOString(); save(); updateStats(); }
  showToast('✓ Marked as sold for $'+num);
  openDetail(id);
}

function markUnsold(id){
  if(!confirm('Mark this card as unsold?')) return;
  const idx=cards.findIndex(x=>x.id===id);
  if(idx>=0){ delete cards[idx].sold; delete cards[idx].soldPrice; delete cards[idx].soldDate; save(); updateStats(); }
  showToast('Marked as unsold');
  openDetail(id);
}

function copyListing(id){
  const c=cards.find(x=>x.id===id);
  if(!c) return;
  navigator.clipboard.writeText(`TITLE:\n${c.ebayTitle}\n\nDESCRIPTION:\n${c.ebayDesc}\n\nSuggested price: $${c.priceMid||c.priceMin} (range: $${c.priceMin}$${c.priceMax})`)
    .then(()=>showToast(' Copied!')).catch(()=>showToast('Copy failed  try selecting manually'));
}

function deleteCard(id){
  if(!confirm('Remove this card from your catalog?')) return;
  cards=cards.filter(c=>c.id!==id);
  save(); updateStats();
  deleteCardFromCloud(id);
  showToast('Card removed');
  showView(prevView||'catalog');
}

async function loadHotCards(force){
  const key=getApiKey();
  if(!key){
    document.getElementById('hotContent').innerHTML=`<div class="empty-state"><div class="empty-icon"></div><h3>API key needed</h3><p>Add your Anthropic API key in Settings to enable market trend tracking</p></div>`;
    return;
  }
  const TWO_HOURS=2*60*60*1000;
  if(!force && hotData && (Date.now()-hotLastFetch)<TWO_HOURS){ renderHotCards(); return; }
  document.getElementById('hotContent').innerHTML=`<div class="hot-loading"><div class="hot-spinner"></div><p>Scanning player news &amp; market momentum...</p></div>`;
  const myPlayers=[...new Set(cards.map(c=>c.player).filter(Boolean))];
  const myList=myPlayers.length?`Cards in my collection: ${myPlayers.slice(0,25).join(', ')}.`:'My collection is currently empty.';
  const today=new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  try{
    const resp=await fetch('https://api.anthropic.com/v1/messages',{
      method:'POST',
      headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01','anthropic-dangerous-direct-browser-access':'true'},
      body:JSON.stringify({
        model:'claude-sonnet-4-20250514',max_tokens:2000,
        tools:[{type:'web_search_20250305',name:'web_search'}],
        messages:[{role:'user',content:`You are a sports card market expert. Today is ${today}. Use web search to find current sports news and identify cards that are hot right now.

${myList}

Search for: recent big performances, awards, trades, call-ups, records broken, playoff/championship impact, and eBay sales surges. Prioritize players from my collection if they qualify, then fill the rest with the hottest cards on the market.

Return ONLY a valid JSON object with no markdown:
{"lastUpdated":"${today}","cards":[{"player":"Full name","team":"Current team","sport":"Baseball|Basketball|Football|Hockey","reason":"Short hot reason (5 words max)","news":"1-2 sentences on exactly why this card is surging right now with specific recent event","priceChange":"e.g. +30% this week","momentum":"high|medium","inMyCollection":true or false,"sellWindow":"Now|This week|Hold  with brief explanation"}]}`}]
      })
    });
    const data=await resp.json();
    if(data.error) throw new Error(data.error.message);
    let info=null;
    try{
      const raw=(data.content||[]).filter(b=>b.type==='text').map(b=>b.text).join('');
      const m=raw.match(/\{[\s\S]*\}/);
      if(m) info=JSON.parse(m[0]);
    } catch(e){ console.error('parse',e); }
    if(!info||!info.cards) throw new Error('Could not parse response');
    hotData=info;
    hotLastFetch=Date.now();
    localStorage.setItem('cv_hot',JSON.stringify(hotData));
    localStorage.setItem('cv_hot_ts',hotLastFetch.toString());
    const hasOwned=info.cards.some(c=>c.inMyCollection);
    document.getElementById('hotDot').classList.toggle('show',hasOwned);
    renderGrid();
    renderHotCards();
  } catch(e){
    document.getElementById('hotContent').innerHTML=`<div class="empty-state"><div class="empty-icon"></div><h3>Couldn't load trends</h3><p>${e.message||'Check your connection and API key, then try again'}</p></div>`;
    console.error(e);
  }
}

function renderHotCards(){
  if(!hotData||!hotData.cards){ document.getElementById('hotContent').innerHTML=`<div class="empty-state"><div class="empty-icon"></div><h3>No data yet</h3><p>Tap Refresh to scan the market</p></div>`; return; }
  const mine=hotData.cards.filter(c=>c.inMyCollection);
  const others=hotData.cards.filter(c=>!c.inMyCollection);
  let html=`<div class="hot-updated">Updated ${hotData.lastUpdated||'recently'}</div>`;
  if(mine.length){ html+=`<div class="hot-section-label"> In your collection</div>`+mine.map(c=>hotRowHTML(c)).join(''); }
  if(others.length){ html+=`<div class="hot-section-label" style="margin-top:${mine.length?'18':'4'}px"> Trending now</div>`+others.map(c=>hotRowHTML(c)).join(''); }
  document.getElementById('hotContent').innerHTML=html;
}

function hotRowHTML(c){
  const cc=cards.find(x=>(x.player||'').toLowerCase()===(c.player||'').toLowerCase());
  const thumb=cc&&cc.imgData?`<img src="${cc.imgData}" alt="">`:{Baseball:'',Basketball:'',Football:'',Hockey:'',Soccer:''}[c.sport]||'';
  const momChip=c.momentum==='high'?`<span class="hot-chip chip-hot"> High</span>`:`<span class="hot-chip chip-up"> Rising</span>`;
  const sellChip=c.sellWindow&&c.sellWindow.startsWith('Now')?`<span class="hot-chip chip-up"> Sell now</span>`:c.sellWindow&&c.sellWindow.startsWith('Hold')?`<span class="hot-chip chip-neutral"> Hold</span>`:`<span class="hot-chip chip-up"> Sell soon</span>`;
  const onclick=cc?`onclick="openDetail('${cc.id}')"`:'';
  return `<div class="hot-card-row${c.inMyCollection?' in-collection':''}" ${onclick}>
    <div class="hot-thumb">${thumb}</div>
    <div class="hot-card-body">
      <div class="hot-card-name">${c.player}</div>
      <div class="hot-card-reason"> ${c.reason}</div>
      <div class="hot-card-news">${c.news}</div>
      <div class="hot-card-meta">${momChip}${c.priceChange?`<span class="hot-chip chip-up">${c.priceChange}</span>`:''}${sellChip}<span class="hot-chip chip-neutral">${c.sport}</span></div>
    </div>
    ${c.inMyCollection?'<span class="own-badge">In vault</span>':''}
  </div>`;
}

function exportCatalog(){
  // Build CSV
  const headers = ['Player','Team','Sport','Year','Brand','Set','Parallel','Numbered','Rookie','Auto','Relic','Grade','Condition','Purchase Price','Est. Value (Low)','Est. Value (Mid)','Est. Value (High)','Unrealized Gain','Status','Sale Price','Sale Date','Realized P&L','eBay Listing ID','Notes'];

  const esc = v => {
    if(v==null) return '';
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? '"'+s.replace(/"/g,'""')+'"' : s;
  };

  const rows = cards.map(c => {
    const cost = c.costBasis!=null ? c.costBasis : null;
    const mid = c.priceMid || c.priceMin || null;
    const unrealized = cost!=null && mid!=null ? (mid - cost).toFixed(2) : '';
    const realizedPL = c.sold && c.soldPrice!=null && cost!=null ? (c.soldPrice - cost).toFixed(2) : '';
    return [
      c.player, c.team, c.sport, c.year, c.brand, c.set, c.parallel, c.numbered,
      c.rookie?'Yes':'No', c.auto?'Yes':'No', c.relic?'Yes':'No',
      c.grade, c.condition,
      cost!=null?cost:'', c.priceMin||'', mid||'', c.priceMax||'',
      unrealized,
      c.sold?'Sold':'In collection',
      c.soldPrice||'',
      c.soldDate?new Date(c.soldDate).toLocaleDateString():'',
      realizedPL,
      c.ebayListingId||'',
      c.notes||''
    ].map(esc).join(',');
  });

  // Summary rows
  const totalCards = cards.length;
  const soldCards = cards.filter(c=>c.sold);
  const unsoldCards = cards.filter(c=>!c.sold);
  const totalCost = cards.reduce((a,c)=>a+(c.costBasis||0),0);
  const totalSoldRevenue = soldCards.reduce((a,c)=>a+(c.soldPrice||0),0);
  const totalSoldCost = soldCards.reduce((a,c)=>a+(c.costBasis||0),0);
  const realizedPL = totalSoldRevenue - totalSoldCost;
  const estUnsoldValue = unsoldCards.reduce((a,c)=>a+(c.priceMid||c.priceMin||0),0);
  const unsoldCost = unsoldCards.reduce((a,c)=>a+(c.costBasis||0),0);
  const unrealizedPL = estUnsoldValue - unsoldCost;

  const summaryRows = [
    '',
    '"--- SUMMARY ---"',
    `"Total cards","${totalCards}"`,
    `"Total cards sold","${soldCards.length}"`,
    `"Total cards in collection","${unsoldCards.length}"`,
    `"Total amount invested","$${totalCost.toFixed(2)}"`,
    `"Total sold revenue","$${totalSoldRevenue.toFixed(2)}"`,
    `"Realized P&L (sold cards)","${realizedPL>=0?'+':''}$${realizedPL.toFixed(2)}"`,
    `"Est. unsold collection value","$${estUnsoldValue.toFixed(2)}"`,
    `"Unrealized P&L (unsold cards)","${unrealizedPL>=0?'+':''}$${unrealizedPL.toFixed(2)}"`,
    `"Total P&L","${(realizedPL+unrealizedPL)>=0?'+':''}$${(realizedPL+unrealizedPL).toFixed(2)}"`,
    `"Export date","${new Date().toLocaleDateString()}"`,
  ];

  const csv = [headers.join(','), ...rows, ...summaryRows].join('\n');
  const blob = new Blob([csv], {type:'text/csv'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url;
  a.download=`cardvault-export-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('✓ CSV exported');
}

function clearAll(){
  if(!confirm('Delete all '+cards.length+' cards? This cannot be undone.')) return;
  cards=[]; save(); updateStats(); renderGrid();
  showToast('Catalog cleared');
  showView('catalog');
}

// -- ADD CARD MODAL --------------------------------------------
let manualImgData = null;
let manualImgDataAll = [];
let manualSport = 'Baseball';
let manualCondition = '';

function openAddModal(){ document.getElementById('addModal').classList.remove('hidden'); }
function closeAddModal(){ document.getElementById('addModal').classList.add('hidden'); }
document.getElementById('addModal').addEventListener('click', function(e){ if(e.target===this) closeAddModal(); });

function chooseAiScan(){
  closeAddModal();
  document.getElementById('fileInput').click();
}

function chooseManual(imgData){
  manualImgData = imgData || null;
  manualSport = 'Baseball';
  manualCondition = '';
  closeAddModal();
  resetManualForm();
  if(imgData) showManualPhotoPreview(imgData);
  document.getElementById('manualModal').classList.remove('hidden');
}

function chooseManualWithPhoto(){
  closeAddModal();
  document.getElementById('manualFileInput').click();
}

function handleManualPhoto(input){
  const files = Array.from(input.files);
  if(!files.length) return;

  // Read all files
  const readers = files.map(file => new Promise(res => {
    const r = new FileReader();
    r.onload = e => res(e.target.result);
    r.readAsDataURL(file);
  }));

  Promise.all(readers).then(results => {
    // Use first image as primary, store all
    manualImgData = results[0];
    manualImgDataAll = results;

    // Open manual form if not already open
    if(document.getElementById('manualModal').classList.contains('hidden')){
      resetManualForm();
      document.getElementById('manualModal').classList.remove('hidden');
    }
    showManualPhotoPreview(results);
  });
  input.value = '';
}

function showManualPhotoPreview(imgDataArr){
  const arr = Array.isArray(imgDataArr) ? imgDataArr : [imgDataArr];
  const preview = document.getElementById('manualPhotoPreview');
  if(arr.length === 1){
    preview.innerHTML = `<img src="${arr[0]}" style="width:100%;height:100%;object-fit:cover;border-radius:8px">`;
    preview.style.width = '80px';
  } else {
    // Show a small grid of thumbnails
    preview.style.width = '100%';
    preview.style.height = 'auto';
    preview.style.flexWrap = 'wrap';
    preview.style.gap = '4px';
    preview.style.padding = '4px';
    preview.innerHTML = arr.map((d,i) => `<img src="${d}" style="width:${arr.length<=4?'calc(50% - 2px)':'calc(33% - 2px)'};aspect-ratio:3/4;object-fit:cover;border-radius:5px${i===0?';border:2px solid var(--gold)':''}" title="${i===0?'Primary photo':'Photo '+(i+1)}">`).join('') +
      `<div style="width:100%;font-size:9px;color:var(--text3);margin-top:2px">${arr.length} photos · first is primary</div>`;
  }
  preview.onclick = () => document.getElementById('manualFileInput').click();
}

function resetManualForm(){
  manualImgData = null;
  manualImgDataAll = [];
  manualSport = 'Baseball';
  manualCondition = '';
  ['mPlayer','mYear','mTeam','mBrand','mParallel','mNumbered','mGrade','mPriceMin','mPriceMax','mNotes'].forEach(id => { const el = document.getElementById(id); if(el) el.value = ''; });
  ['mRookie','mAuto','mRelic'].forEach(id => { const el = document.getElementById(id); if(el) el.checked = false; });
  document.querySelectorAll('.sport-btn').forEach((b,i) => b.classList.toggle('selected', i===0));
  document.querySelectorAll('#manualModal .condition-btn').forEach(b => b.classList.remove('selected'));
  const preview = document.getElementById('manualPhotoPreview');
  preview.innerHTML = '📷<div style="font-size:9px">Add photo</div>';
  preview.style.width = '80px';
  preview.style.height = '104px';
  preview.onclick = () => document.getElementById('manualFileInput').click();
}

function closeManualModal(){
  document.getElementById('manualModal').classList.add('hidden');
  manualImgData = null;
  manualImgDataAll = [];
}
document.getElementById('manualModal').addEventListener('click', function(e){ if(e.target===this) closeManualModal(); });

function selectSport(sport, el){
  manualSport = sport;
  document.querySelectorAll('.sport-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
}

function selectCondition(cond, el){
  manualCondition = cond;
  document.querySelectorAll('#manualModal .condition-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  // Also fill the grade input if it's a grade code
  const gradeInput = document.getElementById('mGrade');
  if(gradeInput && !gradeInput.value) gradeInput.value = cond.includes('PSA')||cond.includes('BGS') ? cond : '';
}

function saveManualCard(){
  const player = document.getElementById('mPlayer').value.trim();
  if(!player){ showToast('Please enter a player name'); return; }

  const priceMin = parseFloat(document.getElementById('mPriceMin').value) || 0;
  const priceMax = parseFloat(document.getElementById('mPriceMax').value) || 0;
  const priceMid = priceMin && priceMax ? Math.round((priceMin + priceMax) / 2) : (priceMin || priceMax || 0);
  const grade = document.getElementById('mGrade').value.trim() || null;
  const condition = manualCondition || (grade ? grade : 'Near Mint');

  const card = {
    id: uid(),
    imgData: manualImgData || null,
    player,
    team: document.getElementById('mTeam').value.trim() || null,
    sport: manualSport,
    year: document.getElementById('mYear').value.trim() || null,
    brand: document.getElementById('mBrand').value.trim() || null,
    set: null,
    parallel: document.getElementById('mParallel').value.trim() || null,
    numbered: document.getElementById('mNumbered').value.trim() || null,
    rookie: document.getElementById('mRookie').checked,
    auto: document.getElementById('mAuto').checked,
    relic: document.getElementById('mRelic').checked,
    grade,
    condition,
    priceMin: priceMin || null,
    priceMax: priceMax || null,
    priceMid: priceMid || null,
    notes: document.getElementById('mNotes').value.trim() || null,
    // Auto-generate eBay title
    ebayTitle: generateEbayTitle({player, year: document.getElementById('mYear').value.trim(), brand: document.getElementById('mBrand').value.trim(), parallel: document.getElementById('mParallel').value.trim(), numbered: document.getElementById('mNumbered').value.trim(), rookie: document.getElementById('mRookie').checked, auto: document.getElementById('mAuto').checked, grade, team: document.getElementById('mTeam').value.trim()}),
    ebayDesc: `${player}${document.getElementById('mYear').value?' '+document.getElementById('mYear').value:''}${document.getElementById('mBrand').value?' '+document.getElementById('mBrand').value:''} sports card${document.getElementById('mRookie').checked?' rookie card':''}${document.getElementById('mAuto').checked?', autographed':''}${document.getElementById('mRelic').checked?', with relic/patch':''}. Condition: ${condition}.${document.getElementById('mNotes').value?' '+document.getElementById('mNotes').value:''}`,
    manualEntry: true,
  };

  cards.push(card);
  save();
  updateStats();
  renderGrid();
  closeManualModal();
  showToast(' Card saved: ' + player);
  openDetail(card.id);
}

function generateEbayTitle(c){
  const parts = [c.year, c.brand, c.player, c.parallel, c.numbered ? c.numbered : '', c.rookie ? 'RC' : '', c.auto ? 'Auto' : '', c.grade || '', c.team].filter(Boolean);
  let title = parts.join(' ');
  if(title.length > 80) title = title.substring(0, 77) + '...';
  return title;
}

// -- LOT MODE --------------------------------------------------
let lotMode = false;
let lotSelected = new Set(); // card IDs
let lotType = 'auction';
let lotDuration = 5;

function enterLotMode(){
  lotMode = true;
  lotSelected.clear();
  document.getElementById('normalToolbar').classList.add('hidden');
  document.getElementById('lotToolbar').classList.remove('hidden');
  updateLotCount();
  renderGrid();
}

function exitLotMode(){
  lotMode = false;
  lotSelected.clear();
  document.getElementById('lotToolbar').classList.add('hidden');
  document.getElementById('normalToolbar').classList.remove('hidden');
  renderGrid();
}

function toggleLotCard(id, e){
  e.stopPropagation();
  if(lotSelected.has(id)) lotSelected.delete(id);
  else lotSelected.add(id);
  updateLotCount();
  renderGrid();
}

function updateLotCount(){
  const n = lotSelected.size;
  document.getElementById('lotCount').textContent = n === 0 ? 'Tap cards to select' : `${n} card${n>1?'s':''} selected`;
  const btn = document.getElementById('lotListBtn');
  if(n >= 2){
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';
  } else {
    btn.style.opacity = '.4';
    btn.style.pointerEvents = 'none';
  }
}

function openLotModal(){
  if(lotSelected.size < 2){ showToast('Select at least 2 cards'); return; }
  const selected = cards.filter(c => lotSelected.has(c.id));
  lotType = localStorage.getItem('cv_default_type') || 'auction';
  lotDuration = parseInt(localStorage.getItem('cv_default_duration') || '5');

  // Auto-generate title and description
  const sports = [...new Set(selected.map(c=>c.sport).filter(Boolean))];
  const brands = [...new Set(selected.map(c=>c.brand).filter(Boolean))];
  const years = [...new Set(selected.map(c=>c.year).filter(Boolean))].sort();
  const players = selected.map(c=>c.player).filter(Boolean);
  const totalMin = selected.reduce((a,c)=>a+(c.priceMin||0),0);
  const totalMid = selected.reduce((a,c)=>a+(c.priceMid||c.priceMin||0),0);

  const autoTitle = [
    years.length===1?years[0]:(years.length>1?years[0]+'-'+years[years.length-1]:''),
    brands.slice(0,2).join('/'),
    sports.length===1?sports[0]:'Multi-Sport',
    'Lot',
    `(${selected.length} Cards)`
  ].filter(Boolean).join(' ').substring(0,80);

  const autoDesc = `Lot of ${selected.length} sports card${selected.length>1?'s':''}.\n\nCards included:\n${selected.map((c,i)=>`${i+1}. ${[c.year,c.brand,c.player,c.parallel,c.numbered,c.rookie?'RC':null,c.auto?'Auto':null,c.grade].filter(Boolean).join(' ')}`).join('\n')}\n\nAll cards shipped together with tracking. Combined estimated value $${totalMid}+.`;

  document.getElementById('lotTitle').value = autoTitle;
  document.getElementById('lotDesc').value = autoDesc;
  document.getElementById('lotStartPrice').value = Math.max(0.99, Math.round(totalMin * 0.5 * 100)/100) || '';
  document.getElementById('lotBinPrice').value = totalMid || '';
  document.getElementById('lotTotalValue').textContent = '$' + (totalMid||totalMin||0);
  document.getElementById('lotCardCount').textContent = selected.length;
  document.getElementById('lotModalSub').textContent = `${selected.length} cards  ${sports.join(', ')||'Sports'}`;
  document.getElementById('lotSubmitLabel').textContent = isEbayConnected() ? 'Post Lot to eBay' : 'Copy Lot Listing';

  // Render card strip
  document.getElementById('lotCardStrip').innerHTML = selected.map(c=>`
    <div class="lot-card-thumb" onclick="removeLotCard('${c.id}')">
      ${c.imgData?`<img src="${c.imgData}" alt="">`:(({Baseball:'',Basketball:'',Football:'',Hockey:''})[c.sport]||'')}
      <div class="lot-card-remove"></div>
    </div>`).join('');

  // Set lot type buttons
  document.getElementById('lotTypeAuction').classList.toggle('selected', lotType==='auction');
  document.getElementById('lotTypeBIN').classList.toggle('selected', lotType==='bin');
  toggleLotPriceFields();

  // Set duration
  document.querySelectorAll('#lotDurationGrid .duration-btn').forEach(b=>{
    b.classList.toggle('selected', parseInt(b.textContent)===lotDuration);
  });

  document.getElementById('lotModal').classList.remove('hidden');

  // Build and show collage preview
  const imgDataUrls = selected.map(c=>c.imgData).filter(Boolean);
  if(imgDataUrls.length >= 2){
    setTimeout(async ()=>{
      const strip = document.getElementById('lotCardStrip');
      const previewNote = document.createElement('div');
      previewNote.style.cssText = 'font-size:10px;color:var(--text3);margin-bottom:6px;width:100%';
      previewNote.textContent = 'Building collage preview...';
      strip.parentNode.insertBefore(previewNote, strip.nextSibling);

      const collage = await buildLotCollage(imgDataUrls);
      if(collage){
        previewNote.textContent = '📸 Collage preview (used as lead photo on eBay)';
        previewNote.style.color = 'var(--text2)';
        const existingPreview = document.getElementById('lotCollagePreview');
        if(existingPreview) existingPreview.remove();
        const previewImg = document.createElement('img');
        previewImg.id = 'lotCollagePreview';
        previewImg.src = collage;
        previewImg.style.cssText = 'width:100%;border-radius:10px;border:1px solid var(--border2);margin-bottom:14px;display:block';
        strip.parentNode.insertBefore(previewImg, previewNote.nextSibling);
      } else {
        previewNote.remove();
      }
    }, 100);
  }
}{ document.getElementById('lotModal').classList.add('hidden'); }
document.getElementById('lotModal').addEventListener('click', function(e){ if(e.target===this) closeLotModal(); });

function removeLotCard(id){
  lotSelected.delete(id);
  if(lotSelected.size < 2){ closeLotModal(); updateLotCount(); renderGrid(); showToast('Need at least 2 cards for a lot'); return; }
  openLotModal(); // re-render with updated selection
}

function setLotType(type){
  lotType = type;
  document.getElementById('lotTypeAuction').classList.toggle('selected', type==='auction');
  document.getElementById('lotTypeBIN').classList.toggle('selected', type==='bin');
  toggleLotPriceFields();
}

function toggleLotPriceFields(){
  const row = document.getElementById('lotPriceRow');
  if(lotType === 'bin'){
    row.innerHTML = `<div><label class="form-label">Buy It Now price</label><input class="form-input" id="lotBinPrice" type="number" min="0.99" step="0.01" placeholder="29.99"></div><div></div>`;
  } else {
    row.innerHTML = `<div><label class="form-label">Starting bid</label><input class="form-input" id="lotStartPrice" type="number" min="0.99" step="0.01" placeholder="9.99"></div><div><label class="form-label">BIN price (optional)</label><input class="form-input" id="lotBinPrice" type="number" min="0.99" step="0.01" placeholder="29.99"></div>`;
  }
}

function setLotDuration(days, el){
  lotDuration = days;
  document.querySelectorAll('#lotDurationGrid .duration-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}

async function submitLotListing(){
  const title = document.getElementById('lotTitle').value.trim();
  if(!title){ showToast('Please add a lot title'); return; }
  const desc = document.getElementById('lotDesc').value.trim();
  const binPrice = parseFloat(document.getElementById('lotBinPrice')?.value) || 0;
  const startPrice = parseFloat(document.getElementById('lotStartPrice')?.value) || (lotType==='auction' ? 0.99 : binPrice);
  const selected = cards.filter(c => lotSelected.has(c.id));

  if(!isEbayConnected()){
    const text = `TITLE: ${title}\n\nDESCRIPTION:\n${desc}\n\nPrice: $${binPrice||startPrice}`;
    navigator.clipboard.writeText(text).then(()=>showToast(' Lot listing copied!')).catch(()=>showToast('Copy failed'));
    closeLotModal(); exitLotMode();
    return;
  }

  await refreshEbayTokenIfNeeded();

  const btn = document.querySelector('#lotModal .list-btn');
  btn.disabled = true;

  // Build collage + upload individual images
  const imgDataUrls = selected.map(c=>c.imgData).filter(Boolean);
  let pictureXml = '';
  if(imgDataUrls.length){
    btn.innerHTML = `<span class="list-btn-icon"></span> Building collage...`;

    // 1. Build the collage grid image
    const collageDataUrl = await buildLotCollage(imgDataUrls);

    // 2. Upload collage as the FIRST (hero) image
    btn.innerHTML = `<span class="list-btn-icon"></span> Uploading collage...`;
    const collageUrl = collageDataUrl ? await uploadImageToEbay(collageDataUrl) : null;

    // 3. Upload individual card photos after the collage
    const individualUrls = [];
    for(let i = 0; i < imgDataUrls.length; i++){
      btn.innerHTML = `<span class="list-btn-icon"></span> Uploading card ${i+1}/${imgDataUrls.length}...`;
      const url = await uploadImageToEbay(imgDataUrls[i]);
      if(url) individualUrls.push(url);
    }

    // Collage first, then individuals
    const allUrls = [collageUrl, ...individualUrls].filter(Boolean);
    pictureXml = allUrls.length
      ? `<PictureDetails>${allUrls.map(u=>`<PictureURL>${escXml(u)}</PictureURL>`).join('')}</PictureDetails>`
      : '';

    if(!collageUrl) showToast(' Collage upload failed  using individual photos');
    else if(!individualUrls.length) showToast(' Individual photo uploads failed');
  }

  btn.innerHTML = '<span class="list-btn-icon"></span> Creating lot listing...';

  const token = getEbayToken();
  const sport = selected[0]?.sport || 'Baseball';
  const catId = EBAY_CATEGORIES[sport] || '261328';
  const isAuction = lotType === 'auction';
  const zip = getSellerZip();
  const shipCost = getShippingLot();

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <Title>${escXml(title)}</Title>
    <Description><![CDATA[${desc}]]></Description>
    <PrimaryCategory><CategoryID>${catId}</CategoryID></PrimaryCategory>
    <StartPrice>${isAuction ? (startPrice||0.99) : binPrice}</StartPrice>
    ${isAuction && binPrice ? `<BuyItNowPrice>${binPrice}</BuyItNowPrice>` : ''}
    ${!isAuction ? `<BuyItNowPrice>${binPrice}</BuyItNowPrice>` : ''}
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>3000</ConditionID>
    <Country>US</Country><Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    <ListingDuration>${isAuction?'Days_'+lotDuration:'GTC'}</ListingDuration>
    <ListingType>${isAuction?'Chinese':'FixedPriceItem'}</ListingType>
    <PaymentMethods>PayPal</PaymentMethods>
    ${pictureXml}
    <PostalCode>${escXml(zip)}</PostalCode>
    <Quantity>1</Quantity>
    <LotSize>${selected.length}</LotSize>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSFirstClass</ShippingService>
        <ShippingServiceCost>${shipCost}</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>US</Site>
  </Item>
</AddItemRequest>`;

  try{
    const resp = await fetch('/.netlify/functions/ebay-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_name: 'AddItem', app_id: getEbayAppId(), xml_body: xml })
    });
    const text = await resp.text();
    const itemIdMatch = text.match(/<ItemID>(\d+)<\/ItemID>/);
    const ackMatch = text.match(/<Ack>(\w+)<\/Ack>/);
    const errMatch = text.match(/<ShortMessage>(.*?)<\/ShortMessage>/);

    if(ackMatch&&(ackMatch[1]==='Success'||ackMatch[1]==='Warning')&&itemIdMatch){
      const itemId = itemIdMatch[1];
      const url = `https://www.ebay.com/itm/${itemId}`;
      lotSelected.forEach(id=>{
        const idx = cards.findIndex(x=>x.id===id);
        if(idx>=0){ cards[idx].ebayListingId=itemId; cards[idx].ebayListingUrl=url; cards[idx].inLot=true; cards[idx].listedAt=new Date().toISOString(); }
      });
      save();
      document.getElementById('lotModal').querySelector('.modal-sheet').innerHTML = `
        <div class="listing-success">
          <div class="listing-success-icon"></div>
          <h3>Lot Listed!</h3>
          <p>${selected.length} cards are now live as a lot on eBay.</p>
          <button class="view-listing-btn" onclick="openLink('${url}')">View Lot on eBay </button><br>
          <button class="cancel-btn" style="margin-top:8px" onclick="closeLotModal();exitLotMode()">Done</button>
        </div>`;
    } else {
      throw new Error(errMatch?errMatch[1]:'eBay returned an error');
    }
  } catch(err){
    btn.disabled = false;
    btn.innerHTML = '<span></span> Post Lot to eBay';
    showToast(' ' + (err.message||'Listing failed'));
    console.error(err);
  }
}

// -- EBAY KEYS & STATE -----------------------------------------
function getEbayToken(){ return localStorage.getItem('cv_ebay_token') || ''; }
function getEbayAppId(){ return localStorage.getItem('cv_ebay_appid') || ''; }
function getEbayCertId(){ return localStorage.getItem('cv_ebay_certid') || ''; }
function getEbayRuName(){ return localStorage.getItem('cv_ebay_runame') || ''; }
function getSellerZip(){ return localStorage.getItem('cv_zip') || '10001'; }
function getShippingSingle(){ return parseFloat(localStorage.getItem('cv_ship_single') || '4.99'); }
function getShippingLot(){ return parseFloat(localStorage.getItem('cv_ship_lot') || '5.99'); }
function isEbayConnected(){ return !!getEbayToken() && !!getEbayAppId(); }
let ebayListingState = { type: localStorage.getItem('cv_default_type')||'auction', duration: parseInt(localStorage.getItem('cv_default_duration')||'5'), condition: '', price: '', startPrice: '', cardId: null };

function saveEbayKeys(){
  const appId = document.getElementById('ebayAppId').value.trim();
  const certId = document.getElementById('ebayCertId').value.trim();
  const ruName = document.getElementById('ebayRuName').value.trim();
  if(!appId){ showToast('Please enter your App ID'); return; }
  localStorage.setItem('cv_ebay_appid', appId);
  if(certId) localStorage.setItem('cv_ebay_certid', certId);
  if(ruName) localStorage.setItem('cv_ebay_runame', ruName);
  showToast(' eBay keys saved  now tap Connect');
  renderEbayStatus();
}

function saveManualToken(){
  const token = document.getElementById('ebayUserToken').value.trim();
  if(!token || token.startsWith('*')){ showToast('Please paste a valid token'); return; }
  localStorage.setItem('cv_ebay_token', token);
  showToast(' Token saved');
  renderEbayStatus();
}

function saveShipping(){
  const zip = document.getElementById('sellerZip').value.trim();
  const single = document.getElementById('shippingSingle').value;
  const lot = document.getElementById('shippingLot').value;
  if(zip) localStorage.setItem('cv_zip', zip);
  if(single) localStorage.setItem('cv_ship_single', single);
  if(lot) localStorage.setItem('cv_ship_lot', lot);
  showToast(' Shipping settings saved');
}

function renderEbayStatus(){
  const area = document.getElementById('ebayStatusArea');
  if(!area) return;
  area.innerHTML = isEbayConnected()
    ? `<div class="ebay-connected"><div class="ebay-connected-dot"></div><div class="ebay-connected-text"> eBay account connected</div><button class="ebay-disconnect-btn" onclick="disconnectEbay()">Disconnect</button></div>`
    : '';

  // Populate saved values
  const fields = {ebayAppId:'cv_ebay_appid', ebayCertId:'cv_ebay_certid', ebayRuName:'cv_ebay_runame', sellerZip:'cv_zip', shippingSingle:'cv_ship_single', shippingLot:'cv_ship_lot'};
  Object.entries(fields).forEach(([id, key])=>{ const el=document.getElementById(id); if(el) el.value=localStorage.getItem(key)||''; });
  const tokenEl = document.getElementById('ebayUserToken');
  if(tokenEl) tokenEl.value = getEbayToken() ? '************' : '';

  // Show redirect URL
  const rdEl = document.getElementById('oauthRedirectDisplay');
  if(rdEl) rdEl.textContent = window.location.origin + window.location.pathname;
}

function disconnectEbay(){
  if(!confirm('Disconnect eBay account?')) return;
  localStorage.removeItem('cv_ebay_token');
  localStorage.removeItem('cv_ebay_refresh_token');
  renderEbayStatus();
  showToast('eBay disconnected');
}

// -- EBAY OAUTH ------------------------------------------------
function connectEbay(){
  const appId = getEbayAppId() || document.getElementById('ebayAppId')?.value.trim();
  const ruName = getEbayRuName() || document.getElementById('ebayRuName')?.value.trim();
  if(!appId){ showToast('Save your App ID first'); return; }
  if(!ruName){ showToast('Save your RuName first'); return; }

  // eBay OAuth 2.0 authorization URL
  const scopes = [
    'https://api.ebay.com/oauth/api_scope',
    'https://api.ebay.com/oauth/api_scope/sell.inventory',
    'https://api.ebay.com/oauth/api_scope/sell.inventory.readonly',
    'https://api.ebay.com/oauth/api_scope/sell.account',
    'https://api.ebay.com/oauth/api_scope/sell.fulfillment',
  ].join('%20');

  const authUrl = `https://auth.ebay.com/oauth2/authorize?client_id=${encodeURIComponent(appId)}&response_type=code&redirect_uri=${encodeURIComponent(ruName)}&scope=${scopes}&prompt=login`;

  // Open OAuth window and listen for redirect
  const popup = window.open(authUrl, 'ebay_oauth', 'width=500,height=650,scrollbars=yes');

  // Poll for the auth code in the popup URL
  const poll = setInterval(()=>{
    try{
      if(!popup || popup.closed){
        clearInterval(poll);
        return;
      }
      const popupUrl = popup.location.href;
      if(popupUrl && popupUrl.includes('code=')){
        clearInterval(poll);
        popup.close();
        const code = new URL(popupUrl).searchParams.get('code');
        if(code) exchangeEbayCode(code);
      }
    } catch(e){ /* cross-origin, keep polling */ }
  }, 500);

  // Timeout after 5 minutes
  setTimeout(()=>{ clearInterval(poll); if(popup && !popup.closed) popup.close(); }, 300000);
}

async function exchangeEbayCode(code){
  showToast('Authorizing with eBay...');
  const appId = getEbayAppId();
  const certId = getEbayCertId();
  const ruName = getEbayRuName();
  if(!certId){ showToast('Save your Cert ID first, then reconnect'); return; }
  try{
    const resp = await fetch('/.netlify/functions/ebay-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, app_id: appId, cert_id: certId, ru_name: ruName, grant_type: 'authorization_code' })
    });
    const data = await resp.json();
    if(data.access_token){
      localStorage.setItem('cv_ebay_token', data.access_token);
      if(data.refresh_token) localStorage.setItem('cv_ebay_refresh_token', data.refresh_token);
      const expiry = Date.now() + (data.expires_in || 7200) * 1000;
      localStorage.setItem('cv_ebay_token_expiry', expiry.toString());
      renderEbayStatus();
      showToast('✓ eBay connected successfully!');
    } else {
      throw new Error(data.error_description || data.error || 'Token exchange failed');
    }
  } catch(err){
    showToast('❌ Auth failed: ' + err.message);
    console.error(err);
  }
}

async function refreshEbayTokenIfNeeded(){
  const expiry = parseInt(localStorage.getItem('cv_ebay_token_expiry')||'0');
  const refreshToken = localStorage.getItem('cv_ebay_refresh_token');
  if(!refreshToken || Date.now() < expiry - 300000) return;
  const appId = getEbayAppId();
  const certId = getEbayCertId();
  if(!appId || !certId) return;
  try{
    const resp = await fetch('/.netlify/functions/ebay-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken, app_id: appId, cert_id: certId, grant_type: 'refresh_token' })
    });
    const data = await resp.json();
    if(data.access_token){
      localStorage.setItem('cv_ebay_token', data.access_token);
      const expiry = Date.now() + (data.expires_in || 7200) * 1000;
      localStorage.setItem('cv_ebay_token_expiry', expiry.toString());
    }
  } catch(e){ console.warn('Token refresh failed', e); }
}

// -- IMAGE HOSTING via eBay EPS ---------------------------------
// eBay's own image hosting service  no third party needed.
// Uploads base64 image and returns a hosted eBay URL.
async function uploadImageToEbay(base64DataUrl){
  if(!base64DataUrl) return null;
  const token = getEbayToken();
  if(!token) return null;
  const base64 = base64DataUrl.split(',')[1];
  if(!base64) return null;

  try{
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<UploadSiteHostedPicturesRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <PictureSet>Supersize</PictureSet>
  <PictureData>${base64}</PictureData>
</UploadSiteHostedPicturesRequest>`;

    const resp = await fetch('/.netlify/functions/ebay-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_name: 'UploadSiteHostedPictures', app_id: getEbayAppId(), xml_body: xml })
    });
    const text = await resp.text();
    const urlMatch = text.match(/<FullURL>(.*?)<\/FullURL>/);
    if(urlMatch) return urlMatch[1];
  } catch(e){ console.warn('Image upload failed', e); }
  return null;
}

// Upload multiple images, return array of URLs
async function uploadImages(imgDataUrls, onProgress){
  const urls = [];
  for(let i=0; i<imgDataUrls.length; i++){
    if(onProgress) onProgress(i+1, imgDataUrls.length);
    const url = await uploadImageToEbay(imgDataUrls[i]);
    if(url) urls.push(url);
  }
  return urls;
}

// -- LOT COLLAGE BUILDER ---------------------------------------
// Stitches card images into a clean grid collage using Canvas.
// Returns a base64 PNG data URL ready to upload.
async function buildLotCollage(imgDataUrls){
  const count = imgDataUrls.length;
  if(!count) return null;

  // Figure out grid dimensions
  const cols = count <= 2 ? count : count <= 4 ? 2 : count <= 6 ? 3 : count <= 9 ? 3 : 4;
  const rows = Math.ceil(count / cols);

  const CARD_W = 300;   // each card cell width px
  const CARD_H = 420;   // each card cell height px (standard card ratio ~2.53.5)
  const GAP = 12;
  const PADDING = 20;
  const BG = '#0f0f11';
  const LABEL_H = 36;

  const canvasW = PADDING * 2 + cols * CARD_W + (cols - 1) * GAP;
  const canvasH = PADDING * 2 + rows * (CARD_H + LABEL_H) + (rows - 1) * GAP;

  const canvas = document.createElement('canvas');
  canvas.width = canvasW;
  canvas.height = canvasH;
  const ctx = canvas.getContext('2d');

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, canvasW, canvasH);

  // Load all images in parallel
  const loadImage = src => new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => res(null);
    img.src = src;
  });

  const images = await Promise.all(imgDataUrls.map(loadImage));

  for(let i = 0; i < count; i++){
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = PADDING + col * (CARD_W + GAP);
    const y = PADDING + row * (CARD_H + LABEL_H + GAP);

    // Card background
    ctx.fillStyle = '#222228';
    roundRect(ctx, x, y, CARD_W, CARD_H, 10);
    ctx.fill();

    const img = images[i];
    if(img){
      // Clip to rounded rect and draw image cover
      ctx.save();
      roundRect(ctx, x, y, CARD_W, CARD_H, 10);
      ctx.clip();

      const scale = Math.max(CARD_W / img.width, CARD_H / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      const dx = x + (CARD_W - dw) / 2;
      const dy = y + (CARD_H - dh) / 2;
      ctx.drawImage(img, dx, dy, dw, dh);
      ctx.restore();
    } else {
      // Placeholder
      ctx.fillStyle = '#44444f';
      ctx.font = `${CARD_W * 0.25}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('', x + CARD_W/2, y + CARD_H/2);
    }

    // Card number badge
    ctx.fillStyle = '#f5c542';
    ctx.beginPath();
    ctx.arc(x + CARD_W - 14, y + 14, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(i + 1, x + CARD_W - 14, y + 14);
  }

  // Watermark / branding strip at bottom
  ctx.fillStyle = '#f5c54220';
  ctx.fillRect(0, canvasH - 28, canvasW, 28);
  ctx.fillStyle = '#f5c542';
  ctx.font = '500 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`CardVault Lot  ${count} Cards`, canvasW / 2, canvasH - 14);

  return canvas.toDataURL('image/jpeg', 0.92);
}

function roundRect(ctx, x, y, w, h, r){
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function setDefaultDuration(days, el){
  localStorage.setItem('cv_default_duration', days);
  ebayListingState.duration = days;
  document.querySelectorAll('#defaultDurationGrid .duration-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}

function setDefaultType(type){
  localStorage.setItem('cv_default_type', type);
  ebayListingState.type = type;
  document.getElementById('defaultAuction').classList.toggle('selected', type==='auction');
  document.getElementById('defaultBIN').classList.toggle('selected', type==='bin');
}

// -- EBAY MODAL ------------------------------------------------
function openEbayModal(cardId){
  const c = cards.find(x=>x.id===cardId);
  if(!c) return;

  ebayListingState.cardId = cardId;
  ebayListingState.type = localStorage.getItem('cv_default_type')||'auction';
  ebayListingState.duration = parseInt(localStorage.getItem('cv_default_duration')||'5');
  ebayListingState.price = c.priceMid || c.priceMin || 10;
  ebayListingState.startPrice = Math.max(1, Math.round((c.priceMin||5) * 0.7));
  ebayListingState.condition = c.grade ? 'graded' : 'near_mint';

  document.getElementById('ebayModal').classList.remove('hidden');
  renderEbayModalContent(c);
}

function closeEbayModal(){
  document.getElementById('ebayModal').classList.add('hidden');
}

// Close modal on backdrop tap
document.getElementById('ebayModal').addEventListener('click', function(e){
  if(e.target === this) closeEbayModal();
});

function renderEbayModalContent(c){
  const s = ebayListingState;
  const connected = isEbayConnected();
  const connWarning = !connected ? `<div style="background:rgba(255,124,58,.1);border:1px solid rgba(255,124,58,.3);border-radius:8px;padding:10px 12px;margin-bottom:16px;font-size:12px;color:var(--orange)"> eBay not connected  go to Settings to add your credentials. You can still preview the listing.</div>` : '';

  const conditionOptions = [
    {key:'gem_mint', label:'Gem Mint', sub:'PSA 10 / BGS 9.5+'},
    {key:'near_mint', label:'Near Mint', sub:'PSA 89 / Ungraded NM'},
    {key:'very_good', label:'Very Good', sub:'Lightly played'},
    {key:'good', label:'Good', sub:'Visible wear'},
    {key:'graded', label:'Graded', sub:'PSA/BGS/SGC slab'},
    {key:'poor', label:'Poor', sub:'Heavy wear'},
  ].map(o=>`<div class="condition-btn${s.condition===o.key?' selected':''}" onclick="setModalCondition('${o.key}',this)">${o.label}<br><span style="font-size:9px;opacity:.7">${o.sub}</span></div>`).join('');

  const durations = s.type === 'auction'
    ? [3,5,7,10].map(d=>`<div class="duration-btn${s.duration===d?' selected':''}" onclick="setModalDuration(${d},this)">${d} days</div>`).join('')
    : `<div class="duration-btn selected" style="grid-column:1/-1;cursor:default">Good 'Til Cancelled <span style="opacity:.6;font-size:10px">(eBay standard for fixed price)</span></div>`;

  const priceSection = s.type === 'auction'
    ? `<label class="form-label">Starting bid</label><input class="form-input" type="number" id="modalStartPrice" value="${s.startPrice}" min="0.99" step="0.01" oninput="ebayListingState.startPrice=this.value">
       <label class="form-label">Buy It Now price (optional)</label><input class="form-input" type="number" id="modalBinPrice" value="${s.price}" min="0.99" step="0.01" oninput="ebayListingState.price=this.value">`
    : `<label class="form-label">Buy It Now price</label><input class="form-input" type="number" id="modalBinPrice" value="${s.price}" min="0.99" step="0.01" oninput="ebayListingState.price=this.value">`;

  document.getElementById('ebayModalContent').innerHTML = `
    <div class="modal-title">List on eBay</div>
    <div class="modal-sub">${c.player||'Card'}  ${c.year||''} ${c.brand||''}</div>
    ${connWarning}

    <div class="listing-type-row">
      <div class="listing-type-btn${s.type==='auction'?' selected':''}" onclick="setModalType('auction')">
        <div class="type-icon"></div>
        <div class="type-label">Auction</div>
        <div class="type-sub">Let buyers bid</div>
      </div>
      <div class="listing-type-btn${s.type==='bin'?' selected':''}" onclick="setModalType('bin')">
        <div class="type-icon"></div>
        <div class="type-label">Buy It Now</div>
        <div class="type-sub">Set your price</div>
      </div>
    </div>

    ${priceSection}

    <label class="form-label">Duration</label>
    <div class="duration-grid">${durations}</div>

    <label class="form-label">Condition</label>
    <div class="condition-grid">${conditionOptions}</div>

    <div class="ebay-preview-box">
      <div class="ebay-preview-title">eBay title preview</div>
      <div class="ebay-preview-text">${c.ebayTitle||''}</div>
    </div>

    <button class="list-btn" onclick="submitEbayListing()">
      <span class="list-btn-icon"></span> ${connected ? 'Post to eBay' : 'Copy listing (eBay not connected)'}
    </button>
    <button class="cancel-btn" onclick="closeEbayModal()">Cancel</button>`;
}

function setModalType(type){
  ebayListingState.type = type;
  const c = cards.find(x=>x.id===ebayListingState.cardId);
  if(c) renderEbayModalContent(c);
}

function setModalDuration(days, el){
  ebayListingState.duration = days;
  document.querySelectorAll('.modal-sheet .duration-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}

function setModalCondition(key, el){
  ebayListingState.condition = key;
  document.querySelectorAll('.condition-btn').forEach(b=>b.classList.remove('selected'));
  el.classList.add('selected');
}

// eBay condition ID map
const EBAY_CONDITIONS = {
  gem_mint: {id:'4000', name:'Very Good'},
  near_mint: {id:'3000', name:'Very Good'},
  very_good: {id:'3000', name:'Very Good'},
  good: {id:'5000', name:'Good'},
  graded: {id:'2750', name:'Like New'},
  poor: {id:'7000', name:'For parts or not working'},
};

const EBAY_CATEGORIES = {
  Baseball: '261328', Basketball: '261329', Football: '261330',
  Hockey: '261331', Soccer: '261333',
};

async function submitEbayListing(){
  const c = cards.find(x=>x.id===ebayListingState.cardId);
  if(!c) return;

  if(!isEbayConnected()){
    copyListing(c.id);
    showToast('Copied! Connect eBay in Settings to post directly.');
    closeEbayModal();
    return;
  }

  await refreshEbayTokenIfNeeded();

  const listBtn = document.querySelector('#ebayModal .list-btn');
  listBtn.disabled = true;
  listBtn.innerHTML = '<span class="list-btn-icon">⏳</span> Preparing...';

  const s = ebayListingState;
  const token = getEbayToken();
  const condInfo = EBAY_CONDITIONS[s.condition] || EBAY_CONDITIONS.near_mint;
  const catId = EBAY_CATEGORIES[c.sport] || '261328';
  const isAuction = s.type === 'auction';

  // Read prices from the live input fields
  const binPriceEl = document.getElementById('modalBinPrice');
  const startPriceEl = document.getElementById('modalStartPrice');
  const binPrice = parseFloat(binPriceEl?.value) || parseFloat(s.price) || 9.99;
  const startPrice = parseFloat(startPriceEl?.value) || parseFloat(s.startPrice) || 0.99;

  // Validate
  if(isAuction && startPrice < 0.99){ showToast('Starting bid must be at least $0.99'); listBtn.disabled=false; listBtn.innerHTML='<span>🛒</span> Post to eBay'; return; }
  if(!isAuction && binPrice < 0.99){ showToast('Buy It Now price must be at least $0.99'); listBtn.disabled=false; listBtn.innerHTML='<span>🛒</span> Post to eBay'; return; }

  const zip = getSellerZip();
  const shipCost = getShippingSingle();

  // Upload image first
  let pictureUrl = '';
  if(c.imgData){
    listBtn.innerHTML = '<span class="list-btn-icon">📤</span> Uploading photo...';
    const uploaded = await uploadImageToEbay(c.imgData);
    pictureUrl = uploaded || '';
    if(!uploaded) showToast('⚠ Photo upload failed — listing without image');
  }

  listBtn.innerHTML = '<span class="list-btn-icon">⏳</span> Creating listing...';

  const descBody = `${c.ebayDesc||'Sports card in good condition.'}\n\n${[c.auto?'✓ Autographed':null, c.relic?'✓ Relic/Patch':null, c.rookie?'✓ Rookie Card':null, c.numbered?'✓ Numbered '+c.numbered:null].filter(Boolean).join('\n')}\nCondition: ${condInfo.name}`;

  // Build XML — BIN and Auction have different price/duration structures
  const priceXml = isAuction
    ? `<StartPrice>${startPrice.toFixed(2)}</StartPrice>${binPrice > startPrice ? `<BuyItNowPrice>${binPrice.toFixed(2)}</BuyItNowPrice>` : ''}`
    : `<StartPrice>${binPrice.toFixed(2)}</StartPrice>`;

  const durationXml = isAuction
    ? `<ListingDuration>Days_${s.duration}</ListingDuration>`
    : `<ListingDuration>GTC</ListingDuration>`;

  const xml = `<?xml version="1.0" encoding="utf-8"?>
<AddItemRequest xmlns="urn:ebay:apis:eBLBaseComponents">
  <RequesterCredentials><eBayAuthToken>${token}</eBayAuthToken></RequesterCredentials>
  <Item>
    <Title>${escXml(c.ebayTitle||'Sports Card')}</Title>
    <Description><![CDATA[${descBody}]]></Description>
    <PrimaryCategory><CategoryID>${catId}</CategoryID></PrimaryCategory>
    ${priceXml}
    <CategoryMappingAllowed>true</CategoryMappingAllowed>
    <ConditionID>${condInfo.id}</ConditionID>
    <Country>US</Country><Currency>USD</Currency>
    <DispatchTimeMax>3</DispatchTimeMax>
    ${durationXml}
    <ListingType>${isAuction ? 'Chinese' : 'FixedPriceItem'}</ListingType>
    <PaymentMethods>PayPal</PaymentMethods>
    ${pictureUrl ? `<PictureDetails><PictureURL>${escXml(pictureUrl)}</PictureURL></PictureDetails>` : ''}
    <PostalCode>${escXml(zip)}</PostalCode>
    <Quantity>1</Quantity>
    <ItemSpecifics>
      <NameValueList><Name>Manufacturer</Name><Value>${escXml(c.brand||'Unknown')}</Value></NameValueList>
      <NameValueList><Name>Player</Name><Value>${escXml(c.player||'Unknown')}</Value></NameValueList>
      <NameValueList><Name>Sport</Name><Value>${escXml(c.sport||'')}</Value></NameValueList>
      <NameValueList><Name>Season</Name><Value>${escXml(c.year||'')}</Value></NameValueList>
      <NameValueList><Name>Team</Name><Value>${escXml(c.team||'')}</Value></NameValueList>
      <NameValueList><Name>Card Name</Name><Value>${escXml(c.player||'')}</Value></NameValueList>
      <NameValueList><Name>Set</Name><Value>${escXml(c.set||c.brand||'')}</Value></NameValueList>
      ${c.parallel ? `<NameValueList><Name>Parallel/Variety</Name><Value>${escXml(c.parallel)}</Value></NameValueList>` : ''}
      ${c.numbered ? `<NameValueList><Name>Print Run</Name><Value>${escXml(c.numbered)}</Value></NameValueList>` : ''}
      ${c.grade ? `<NameValueList><Name>Grade</Name><Value>${escXml(c.grade)}</Value></NameValueList>` : ''}
      <NameValueList><Name>Autographed</Name><Value>${c.auto ? 'Yes' : 'No'}</Value></NameValueList>
      <NameValueList><Name>Rookie Card</Name><Value>${c.rookie ? 'Yes' : 'No'}</Value></NameValueList>
    </ItemSpecifics>
    <ReturnPolicy>
      <ReturnsAcceptedOption>ReturnsAccepted</ReturnsAcceptedOption>
      <RefundOption>MoneyBack</RefundOption>
      <ReturnsWithinOption>Days_30</ReturnsWithinOption>
      <ShippingCostPaidByOption>Buyer</ShippingCostPaidByOption>
    </ReturnPolicy>
    <ShippingDetails>
      <ShippingType>Flat</ShippingType>
      <ShippingServiceOptions>
        <ShippingServicePriority>1</ShippingServicePriority>
        <ShippingService>USPSFirstClass</ShippingService>
        <ShippingServiceCost>${shipCost}</ShippingServiceCost>
      </ShippingServiceOptions>
    </ShippingDetails>
    <Site>US</Site>
  </Item>
</AddItemRequest>`;

  try{
    const resp = await fetch('/.netlify/functions/ebay-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call_name: 'AddItem', app_id: getEbayAppId(), xml_body: xml })
    });
    const text = await resp.text();
    const itemIdMatch = text.match(/<ItemID>(\d+)<\/ItemID>/);
    const ackMatch = text.match(/<Ack>(\w+)<\/Ack>/);
    const errMatch = text.match(/<ShortMessage>(.*?)<\/ShortMessage>/);

    if(ackMatch&&(ackMatch[1]==='Success'||ackMatch[1]==='Warning')&&itemIdMatch){
      const itemId = itemIdMatch[1];
      const listingUrl = `https://www.ebay.com/itm/${itemId}`;
      const idx = cards.findIndex(x=>x.id===c.id);
      if(idx>=0){ cards[idx].ebayListingId=itemId; cards[idx].ebayListingUrl=listingUrl; cards[idx].listedAt=new Date().toISOString(); save(); }
      showListingSuccess(itemId, listingUrl, c.player);
    } else {
      throw new Error(errMatch ? errMatch[1] : 'eBay returned an error. Check your token.');
    }
  } catch(err){
    listBtn.disabled = false;
    listBtn.innerHTML = '<span class="list-btn-icon"></span> Post to eBay';
    showToast(' ' + (err.message||'Listing failed'));
    console.error(err);
  }
}

function showListingSuccess(itemId, url, player){
  document.getElementById('ebayModalContent').innerHTML = `
    <div class="listing-success">
      <div class="listing-success-icon"></div>
      <h3>Listed on eBay!</h3>
      <p>${player||'Card'} is now live on eBay.<br>Item ID: ${itemId}</p>
      <button class="view-listing-btn" onclick="openLink('${url}')">View listing on eBay </button>
      <br>
      <button class="cancel-btn" onclick="closeEbayModal()">Done</button>
    </div>`;
}

function escXml(str){ return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// -- Init
updateStats();
renderGrid();
if(hotData){ const hasOwned=(hotData.cards||[]).some(c=>c.inMyCollection); document.getElementById('hotDot').classList.toggle('show',hasOwned); }

// Boot auth — shows login screen or loads user's cards
initAuth();

// Refresh status panels when settings opened — hooked into showView
function onSettingsOpen(){
  setTimeout(()=>{ renderEbayStatus(); renderSupabaseStatus(); }, 50);
}


