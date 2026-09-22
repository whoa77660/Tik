const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { URL } = require('node:url');

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.PORT || 3000);

function loadEnv(file = path.join(ROOT, '.env')) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m || m[1] in process.env) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      process.env[m[1]] = v;
    }
  } catch {}
}
loadEnv();

// Optional local configuration. This lets the API keys be managed in
// config.js while still allowing Render Environment Variables to override
// the values when provided.
let APP_CONFIG = {};
try {
  APP_CONFIG = require(path.join(ROOT, 'config.js'));
} catch (error) {
  if (error && error.code !== 'MODULE_NOT_FOUND') {
    console.error('[Config] Failed to load config.js:', error.message);
  }
}

/*
 * Render self-ping / keep-alive
 * ----------------------------
 * Render exposes RENDER_EXTERNAL_URL automatically.
 * No manual public URL is required.
 */
const KEEP_ALIVE_ENABLED =
  String(process.env.KEEP_ALIVE_ENABLED ?? 'true').toLowerCase() !== 'false';
const KEEP_ALIVE_INTERVAL = Math.max(
  60_000,
  Number(process.env.KEEP_ALIVE_INTERVAL_MS || 49_000)
);
const KEEP_ALIVE_URL =
  process.env.RENDER_EXTERNAL_URL ||
  process.env.RENDER_URL ||
  '';

async function selfPing() {
  if (!KEEP_ALIVE_ENABLED || !KEEP_ALIVE_URL) return;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(KEEP_ALIVE_URL, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': 'TikTok-Node-Suite-KeepAlive/1.0',
        'Cache-Control': 'no-cache',
      },
    });

    clearTimeout(timer);
    console.log(`[KeepAlive] Self Ping: ${response.status}`);
  } catch (error) {
    console.log(`[KeepAlive] Self Ping Error: ${error.message}`);
  }
}

function startKeepAlive() {
  if (!KEEP_ALIVE_ENABLED) {
    console.log('[KeepAlive] Disabled');
    return;
  }

  if (!KEEP_ALIVE_URL) {
    console.log('[KeepAlive] No public Render URL detected; self-ping skipped');
    return;
  }

  console.log(`[KeepAlive] Enabled: ${KEEP_ALIVE_URL}`);
  setTimeout(selfPing, 2_000);
  setInterval(selfPing, KEEP_ALIVE_INTERVAL);
}

const rapidApiConfig = (APP_CONFIG && APP_CONFIG.rapidApi) || {};
const configuredKeys = Array.isArray(rapidApiConfig.keys)
  ? rapidApiConfig.keys
  : (rapidApiConfig.key ? [rapidApiConfig.key] : []);
const envKeys = String(process.env.RAPIDAPI_KEYS || process.env.RAPIDAPI_KEY || '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);

// Environment variables win when present; otherwise config.js is used.
// Duplicate keys are removed while preserving order.
const RAPIDAPI_KEYS = [...new Set((envKeys.length ? envKeys : configuredKeys)
  .map(s => String(s).trim())
  .filter(Boolean))];
const RAPIDAPI_HOST = String(
  process.env.RAPIDAPI_HOST || rapidApiConfig.host || 'tiktok-scraper7.p.rapidapi.com'
).trim();
const CACHE_TTL = Number(process.env.CACHE_TTL || rapidApiConfig.cacheTtl || 300) * 1000;
const cache = new Map();
const TIKVERIFY_CSRF_TOKEN = process.env.TIKVERIFY_CSRF_TOKEN || crypto.randomBytes(24).toString('hex');

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
  });
  res.end(data);
}

function readBody(req, max = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let chunks = [], size = 0;
    req.on('data', c => {
      size += c.length;
      if (size > max) { reject(new Error('Request body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function cacheGet(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > CACHE_TTL) { cache.delete(key); return null; }
  return item.value;
}
function cacheSet(key, value) { cache.set(key, { time: Date.now(), value }); }

function extractUrls(text) {
  const re = /https?:\/\/(?:(?:www\.)?tiktok\.com\/@[^\/\s]+\/video\/\d+[^\s|]*|(?:vm|vt|m)\.tiktok\.com\/[\w]+[^\s|]*|(?:www\.)?tiktok\.com\/t\/[\w]+[^\s|]*)/gi;
  const seen = new Set(), out = [];
  for (const m of text.matchAll(re)) {
    const u = m[0].split('|')[0].trim();
    if (!seen.has(u)) { seen.add(u); out.push(u); }
  }
  return out;
}
function countLinesWithoutUrl(text) {
  return text.split(/\r\n|\r|\n/).filter(line => line.trim() && extractUrls(line).length === 0).length;
}
function validTikTokUrl(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && /(^|\.)tiktok\.com$/i.test(u.hostname) && url.length <= 4096;
  } catch { return false; }
}
function extractVideoId(url) {
  const m = url.match(/\/video\/(\d+)/);
  return m ? m[1] : null;
}
function allowedRemoteUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    const h = u.hostname.toLowerCase();
    return ['tiktok.com','www.tiktok.com','vm.tiktok.com','vt.tiktok.com','m.tiktok.com'].includes(h) || /^[a-z0-9-]+\.tiktokcdn\.com$/i.test(h);
  } catch { return false; }
}

async function httpGet(url, headers = {}) {
  if (!allowedRemoteUrl(url)) return { ok:false, body:'', status:0, url, error:'URL not in allowlist' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.TIKTOK_TIMEOUT || 15000));
  try {
    const r = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'accept-language': 'en-US,en;q=0.9',
        'cache-control': 'no-cache',
        'pragma': 'no-cache',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0 Safari/537.36',
        ...headers,
      },
    });
    const effective = r.url || url;
    if (!allowedRemoteUrl(effective)) return { ok:false, body:'', status:r.status, url:effective, error:'Redirect target not in allowlist' };
    const body = await r.text();
    return { ok:r.ok, body, status:r.status, url:effective, error:r.ok ? '' : `HTTP ${r.status}` };
  } catch (e) {
    return { ok:false, body:'', status:0, url, error:e.name === 'AbortError' ? 'Request timed out' : e.message };
  } finally { clearTimeout(timer); }
}

async function resolveCanonical(url) {
  let host = '';
  try { host = new URL(url).hostname; } catch { return null; }
  if (!/^(vm|vt|m)\.tiktok\.com$/i.test(host) && !url.includes('/t/')) return null;
  const r = await httpGet(url, { referer:'https://www.tiktok.com/' });
  if (r.url && r.url !== url && extractVideoId(r.url)) return r.url;
  const m = r.body.match(/https:\/\/www\.tiktok\.com\/@[^"'\\\s]+\/video\/\d+/);
  return m ? m[0] : (r.url && extractVideoId(r.url) ? r.url : null);
}
function unescapeJsonFragment(s) {
  try { return JSON.parse('"' + s + '"'); } catch { return s; }
}
function normalizeItem(item) {
  const stats = item.stats || item.statsV2 || {};
  const video = item.video || {};
  const author = item.author || {};
  const num = v => v === undefined || v === null || v === '' ? null : Number(v);
  return {
    title: item.desc ?? null,
    author: author.nickname ?? author.uniqueId ?? null,
    thumbnail: video.originCover ?? video.cover ?? video.dynamicCover ?? null,
    views: num(stats.playCount), likes: num(stats.diggCount), comments: num(stats.commentCount), shares: num(stats.shareCount),
  };
}
function universal(html) {
  const m = html.match(/<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const item = d?.__DEFAULT_SCOPE__?.['webapp.video-detail']?.itemInfo?.itemStruct;
    return item ? normalizeItem(item) : null;
  } catch { return null; }
}
function sigi(html, url) {
  const m = html.match(/<script id="SIGI_STATE"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    const module = d?.ItemModule || {};
    const id = extractVideoId(url);
    const item = (id && module[id]) || Object.values(module)[0];
    return item ? normalizeItem(item) : null;
  } catch { return null; }
}
function regexScrape(html) {
  const get = key => { const m = html.match(new RegExp('"' + key + '":(\\d+)')); return m ? Number(m[1]) : null; };
  const views=get('playCount'), likes=get('diggCount'), comments=get('commentCount'), shares=get('shareCount');
  if (views === null && likes === null && comments === null) return null;
  let title = null, thumbnail = null, m;
  if ((m=html.match(/"desc":"(.*?)","/))) title=unescapeJsonFragment(m[1]);
  if ((m=html.match(/"originCover":"(.*?)"/))) thumbnail=unescapeJsonFragment(m[1]);
  else if ((m=html.match(/"cover":"(.*?)"/))) thumbnail=unescapeJsonFragment(m[1]);
  return { title, author:null, thumbnail, views, likes, comments, shares };
}
async function oembed(url) {
  const r = await httpGet('https://www.tiktok.com/oembed?url=' + encodeURIComponent(url));
  if (!r.ok) return null;
  try { const d=JSON.parse(r.body); return { title:d.title??null, author:d.author_name??null, thumbnail:d.thumbnail_url??null, views:null, likes:null, comments:null, shares:null }; } catch { return null; }
}
async function getVideoData(originalUrl) {
  const result = { url:originalUrl,status:'error',method:null,video_id:null,title:null,author:null,thumbnail:null,views:null,likes:null,comments:null,shares:null,error:null };
  if (!validTikTokUrl(originalUrl)) { result.error='Not a valid TikTok URL'; return result; }
  let url=originalUrl;
  const canonical=await resolveCanonical(url); if (canonical) { url=canonical; result.url=canonical; }
  result.video_id=extractVideoId(url);
  let page=await httpGet(url,{referer:'https://www.tiktok.com/'});
  let lastError=page.error || `HTTP ${page.status}`;
  if (!page.ok && result.video_id && !url.includes('m.tiktok.com')) {
    const mobile=url.replace(/^https:\/\/(www\.)?tiktok\.com/i,'https://m.tiktok.com');
    const retry=await httpGet(mobile,{referer:'https://www.tiktok.com/'});
    if (retry.ok) { page=retry; url=mobile; }
  }
  const merge=(d,method)=>{ if(!d)return; for(const f of ['title','author','thumbnail','views','likes','comments','shares']) if(result[f]===null && d[f]!==null && d[f]!==undefined) result[f]=d[f]; result.method=result.method?result.method+'+'+method:method; };
  const core=()=>result.views!==null&&result.likes!==null&&result.comments!==null;
  if(page.ok){ merge(universal(page.body),'universal_data'); if(!core()) merge(sigi(page.body,url),'sigi_state'); if(!core()) merge(regexScrape(page.body),'regex_scrape'); }
  const any=()=>['title','author','thumbnail','views','likes','comments','shares'].some(f=>result[f]!==null);
  if(!any()) merge(await oembed(originalUrl),'oembed_fallback');
  if(any()){ result.status='available'; result.title=result.title||'(title unavailable)'; result.views=result.views??'N/A'; result.likes=result.likes??'N/A'; result.comments=result.comments??'N/A'; }
  else result.error=lastError||'Unable to retrieve video data (all methods failed)';
  return result;
}

async function tikVerifyApi(req, res) {
  const token=req.headers['x-csrf-token'];
  let input={};
  try { input=JSON.parse(await readBody(req)); } catch { return json(res,400,{error:'Invalid JSON'}); }
  if (token !== TIKVERIFY_CSRF_TOKEN || input.csrf_token !== TIKVERIFY_CSRF_TOKEN) return json(res,403,{error:'Invalid or missing CSRF token'});
  const action=input.action;
  if(action==='stats'){
    const text=String(input.text||''); const raw=[...text.matchAll(/https?:\/\/(?:(?:www\.)?tiktok\.com\/@[^\/\s]+\/video\/\d+[^\s|]*|(?:vm|vt|m)\.tiktok\.com\/[\w]+[^\s|]*|(?:www\.)?tiktok\.com\/t\/[\w]+[^\s|]*)/gi)].map(m=>m[0]);
    const urls=extractUrls(text); return json(res,200,{total_found:raw.length,unique:urls.length,duplicates_removed:Math.max(0,raw.length-urls.length),lines_without_url:countLinesWithoutUrl(text),urls});
  }
  if(action==='check'){
    const url=String(input.url||'').trim(); if(!url)return json(res,400,{error:'Missing url'});
    return json(res,200,{result:await getVideoData(url)});
  }
  return json(res,400,{error:'Unknown action'});
}

function extractUsername(input){ const s=String(input||'').trim(); const m=s.match(/tiktok\.com\/@([^\/?#\s]+)/i); return m?m[1]:s.replace(/^@/,''); }
async function rapidApiFetch(pathname, params){
  if(!RAPIDAPI_KEYS.length)return {_error:'No RapidAPI keys configured',_code:0,_detail:'Add API keys in config.js or RAPIDAPI_KEYS on Render.'};
  let keyIndex=Number(process.env.RAPIDAPI_KEY_INDEX||0)%RAPIDAPI_KEYS.length,last=null;
  for(let i=0;i<RAPIDAPI_KEYS.length;i++){
    const key=RAPIDAPI_KEYS[keyIndex],u=new URL('https://'+RAPIDAPI_HOST+pathname);
    Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
    try{
      const r=await fetch(u,{headers:{'x-rapidapi-key':key,'x-rapidapi-host':RAPIDAPI_HOST,'accept':'application/json'},signal:AbortSignal.timeout(15000)}),text=await r.text();
      let data;try{data=JSON.parse(text)}catch{data=null}
      console.log(`[RapidAPI] ${pathname} HTTP ${r.status} key ${keyIndex+1}/${RAPIDAPI_KEYS.length}`);
      console.log(`[RapidAPI] Body: ${text.slice(0,1000)}`);
      if(r.status===429){last={_error:'Rate limited (HTTP 429)',_code:429,_body:text.slice(0,1000)};keyIndex=(keyIndex+1)%RAPIDAPI_KEYS.length;continue}
      if(r.status===401){last={_error:'Invalid RapidAPI key (HTTP 401)',_code:401,_body:text.slice(0,1000)};keyIndex=(keyIndex+1)%RAPIDAPI_KEYS.length;continue}
      if(r.status===403)return {_error:'RapidAPI access denied (HTTP 403)',_code:403,_body:text.slice(0,1000)};
      if(!r.ok)return {_error:`RapidAPI HTTP ${r.status}`,_code:r.status,_body:text.slice(0,1000)};
      if(!data)return {_error:'RapidAPI returned non-JSON response',_code:r.status,_body:text.slice(0,1000)};
      return data;
    }catch(e){last={_error:'RapidAPI network error: '+e.message,_code:0}}
  }
  return last||{_error:'All RapidAPI keys failed',_code:0};
}

function providerDetail(data){if(!data||typeof data!=='object')return '';const p=[];if(data.msg)p.push('msg='+String(data.msg));if(data.message)p.push('message='+String(data.message));if(data.status)p.push('status='+String(data.status));if(data.code!==undefined)p.push('code='+String(data.code));return p.join(' | ')}
function findProfileParts(data){const candidates=[];if(data?.data&&typeof data.data==='object')candidates.push(data.data);if(data?.userInfo&&typeof data.userInfo==='object')candidates.push(data.userInfo);candidates.push(data);for(const inner of candidates){const user=[inner?.user,inner?.userInfo?.user,inner?.data?.user].find(v=>v&&typeof v==='object'&&!Array.isArray(v));if(user){const stats=[inner?.stats,inner?.userInfo?.stats,inner?.data?.stats].find(v=>v&&typeof v==='object'&&!Array.isArray(v))||{};return {user,stats}}}return {user:{},stats:{}}}
async function explorerApi(req,res,url){
  // The current Explorer frontend uses the original TikExplore API paths
  // (/user/info and /user/posts), while this Node server normally exposes
  // the newer action-based API. Support both formats so the working
  // Explorer frontend does not need to be changed.
  const pathnameAction = url.pathname.endsWith('/user/info')
    ? 'profile'
    : (url.pathname.endsWith('/user/posts') ? 'videos' : '');
  const actionFromQuery = url.searchParams.get('action') || '';
  const action = actionFromQuery || pathnameAction;
  const legacyProviderPath = !actionFromQuery && Boolean(pathnameAction);

  if(action==='config'){
    return json(res,200,{
      configured:Boolean(RAPIDAPI_KEYS.length),
      keyCount:RAPIDAPI_KEYS.length,
      host:RAPIDAPI_HOST
    });
  }
  const username=extractUsername(url.searchParams.get('username')||url.searchParams.get('unique_id')||'');
  if(!username)return json(res,400,{error:'username is required'});

  // Legacy-compatible raw provider responses. The original TikExplore
  // frontend normalizes the tiktok-scraper7 response in the browser, so
  // these two paths must return the provider payload rather than the
  // server-normalized profile/video object.
  if(legacyProviderPath){
    const providerPath = action==='profile' ? '/user/info' : '/user/posts';
    const params = action==='profile'
      ? {unique_id:username}
      : {
          unique_id:username,
          count:Math.max(1,Math.min(500,Number(url.searchParams.get('count')||30))),
          cursor:url.searchParams.get('cursor')||'0'
        };
    const data=await rapidApiFetch(providerPath,params);
    if(data._error){
      const detail=data._body?` — Provider: ${data._body.slice(0,500)}`:'';
      if(data._code===401)return json(res,502,{error:`RapidAPI key invalid. ${data._error}${detail}`});
      if(data._code===403)return json(res,502,{error:`RapidAPI subscription/access problem. ${data._error}${detail}`});
      if(data._code===429)return json(res,429,{error:`All RapidAPI keys are rate-limited. ${data._error}${detail}`});
      return json(res,502,{error:`RapidAPI error: ${data._error}${detail}`});
    }
    return json(res,200,data);
  }

  if(action==='profile'){
    const ck='profile:'+username.toLowerCase(); const c=cacheGet(ck); if(c)return json(res,200,c);
    const data=await rapidApiFetch('/user/info',{unique_id:username});
    if(data._error){
      const detail=data._body?` — Provider: ${data._body.slice(0,500)}`:'';
      if(data._code===401)return json(res,502,{error:`RapidAPI key invalid. ${data._error}${detail}`});
      if(data._code===403)return json(res,502,{error:`RapidAPI subscription/access problem. ${data._error}${detail}`});
      if(data._code===429)return json(res,429,{error:`All RapidAPI keys are rate-limited. ${data._error}${detail}`});
      return json(res,502,{error:`RapidAPI error: ${data._error}${detail}`});
    }
    if(data.code===-1)return json(res,404,{error:`TikTok API says profile was not found/private.${providerDetail(data)?' '+providerDetail(data):''}`});
    const {user,stats}=findProfileParts(data);
    if(!Object.keys(user).length){const keys=Object.keys(data).slice(0,30).join(', ')||'(no keys)';return json(res,502,{error:`RapidAPI returned HTTP 200, but no profile object was found. Response keys: ${keys}${providerDetail(data)?' | '+providerDetail(data):''}`});}
    const profile={id:String(user.id??user.uid??''),uniqueId:user.uniqueId??username,nickname:user.nickname??username,avatarUrl:user.avatarLarger??user.avatarMedium??user.avatarThumb??'',bio:user.signature??'',verified:Boolean(user.verified),followers:Number(stats.followerCount??0),following:Number(stats.followingCount??0),likes:Number(stats.heartCount??stats.heart??0),videoCount:Number(stats.videoCount??0),profileUrl:'https://www.tiktok.com/@'+(user.uniqueId??username)};
    cacheSet(ck,profile); return json(res,200,profile);
  }
  if(action==='videos'){
    const count=Math.max(1,Math.min(500,Number(url.searchParams.get('count')||30))); const cursor=url.searchParams.get('cursor')||'0'; const ck=`videos:${username}:${count}:${cursor}`; const c=cacheGet(ck); if(c)return json(res,200,c);
    const data=await rapidApiFetch('/user/posts',{unique_id:username,count,cursor});
    if(data._error){
      const detail=data._body?` — Provider: ${data._body.slice(0,500)}`:'';
      if(data._code===401)return json(res,502,{error:`RapidAPI key invalid. ${data._error}${detail}`});
      if(data._code===403)return json(res,502,{error:`RapidAPI subscription/access problem. ${data._error}${detail}`});
      if(data._code===429)return json(res,429,{error:`All RapidAPI keys are rate-limited. ${data._error}${detail}`});
      return json(res,502,{error:`RapidAPI error: ${data._error}${detail}`});
    }
    if(data.code===-1)return json(res,404,{error:`TikTok API says profile was not found/private.${providerDetail(data)?' '+providerDetail(data):''}`});
    const inner=data.data&&typeof data.data==='object'?data.data:data; const raw=Array.isArray(inner.videos)?inner.videos:(Array.isArray(inner.aweme_list)?inner.aweme_list:(Array.isArray(data.videos)?data.videos:[]));
    const videos=raw.map(v=>{const desc=typeof v.title==='string'&&v.title?v.title:(Array.isArray(v.content_desc)?v.content_desc.filter(Boolean).join(' '):(v.content_desc||v.desc||v.description||''));const vm=v.video&&typeof v.video==='object'?v.video:{};const stats=v.stats&&typeof v.stats==='object'?v.stats:{};const thumb=v.cover??v.origin_cover??v.ai_dynamic_cover??vm.cover??vm.originCover??'';const views=Number(v.play_count??stats.playCount??stats.play_count??0),likes=Number(v.digg_count??stats.diggCount??stats.digg_count??0),comments=Number(v.comment_count??stats.commentCount??stats.comment_count??0),shares=Number(v.share_count??stats.shareCount??stats.share_count??0);const hashtags=[...desc.matchAll(/#([\w\u00C0-\u024F]+)/gu)].map(m=>m[1]);const vid=String(v.aweme_id??v.video_id??v.id??'');const numeric=String(v.video_id??v.id??'');const share=typeof v.share_url==='string'?v.share_url.trim():'';let videoUrl=share||(numberLike(numeric)?`https://www.tiktok.com/@${username}/video/${numeric}`:numberLike(vid)?`https://www.tiktok.com/@${username}/video/${vid}`:`https://www.tiktok.com/@${username}`);return{id:vid,description:desc,thumbnailUrl:thumb,videoUrl,views,likes,comments,shares,duration:Number(v.duration??vm.duration??0),uploadDate:Number(v.create_time??v.createTime??0),hashtags};});
    const result={videos,cursor:inner.cursor!=null?String(inner.cursor):null,hasMore:Boolean(inner.hasMore??data.has_more??false),total:videos.length}; if(cursor==='0')cacheSet(ck,result); return json(res,200,result);
  }
  return json(res,400,{error:'Unknown action. Use ?action=profile or ?action=videos'});
}
function numberLike(v){return /^\d+$/.test(v||'')&&v!=='';}


// ─────────────────────────────────────────────────────────────────────────────
// Instagram Explorer
// ─────────────────────────────────────────────────────────────────────────────
const instagramApiConfig = (APP_CONFIG && APP_CONFIG.instagramApi) || {};
const instagramProvider = String(
  process.env.INSTAGRAM_API_PROVIDER || instagramApiConfig.provider || 'hikerapi'
).trim().toLowerCase();
const instagramConfiguredKeys = Array.isArray(instagramApiConfig.keys)
  ? instagramApiConfig.keys
  : (instagramApiConfig.key ? [instagramApiConfig.key] : []);
const instagramEnvKeys = String(
  process.env.INSTAGRAM_API_KEYS || process.env.INSTAGRAM_API_KEY || process.env.HIKER_API_KEYS || process.env.HIKER_API_KEY || ''
).split(',').map(s => s.trim()).filter(Boolean);
const INSTAGRAM_API_KEYS = [...new Set((instagramEnvKeys.length ? instagramEnvKeys : instagramConfiguredKeys)
  .map(s => String(s).trim()).filter(Boolean))];
const INSTAGRAM_API_HOST = String(
  process.env.INSTAGRAM_API_HOST || instagramApiConfig.host || (instagramProvider === 'rapidapi' ? 'instagram-public-data-api1.p.rapidapi.com' : 'api.hikerapi.com')
).trim();
const INSTAGRAM_CACHE_TTL = Number(process.env.INSTAGRAM_CACHE_TTL || instagramApiConfig.cacheTtl || 300) * 1000;
const INSTAGRAM_TIMEOUT = Math.max(5000, Number(process.env.INSTAGRAM_TIMEOUT_MS || instagramApiConfig.timeoutMs || 15000));
const instagramCache = new Map();

function instagramCacheGet(key) {
  const item = instagramCache.get(key);
  if (!item) return null;
  if (Date.now() - item.time > INSTAGRAM_CACHE_TTL) { instagramCache.delete(key); return null; }
  return item.value;
}
function instagramCacheSet(key, value) { instagramCache.set(key, { time: Date.now(), value }); }

function instagramProviderDetail(data) {
  if (!data || typeof data !== 'object') return '';
  const p = [];
  if (data.message) p.push('message=' + String(data.message));
  if (data.error) p.push('error=' + String(data.error));
  if (data.detail) p.push('detail=' + String(data.detail));
  if (data.status) p.push('status=' + String(data.status));
  if (data.code !== undefined) p.push('code=' + String(data.code));
  return p.join(' | ');
}

async function instagramHttpGet(pathname, params = {}) {
  if (!INSTAGRAM_API_KEYS.length) {
    return {_error:'No Instagram API key configured', _code:0, _detail:'Add an Instagram API token in config.js or INSTAGRAM_API_KEYS / HIKER_API_KEYS on Render.'};
  }

  let keyIndex = Number(process.env.INSTAGRAM_API_KEY_INDEX || 0) % INSTAGRAM_API_KEYS.length;
  let last = null;
  for (let i = 0; i < INSTAGRAM_API_KEYS.length; i++) {
    const key = INSTAGRAM_API_KEYS[keyIndex];
    const u = new URL('https://' + INSTAGRAM_API_HOST + pathname);
    Object.entries(params).forEach(([k,v]) => {
      if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    });
    try {
      const headers = instagramProvider === 'rapidapi'
        ? { 'x-rapidapi-key': key, 'x-rapidapi-host': INSTAGRAM_API_HOST, accept: 'application/json' }
        : { 'x-access-key': key, accept: 'application/json' };
      const r = await fetch(u, { headers, signal: AbortSignal.timeout(INSTAGRAM_TIMEOUT) });
      const text = await r.text();
      let data; try { data = JSON.parse(text); } catch { data = null; }
      console.log(`[InstagramAPI] ${instagramProvider} ${pathname} HTTP ${r.status} key ${keyIndex+1}/${INSTAGRAM_API_KEYS.length}`);
      if (r.status === 429) {
        last = {_error:'Rate limited (HTTP 429)', _code:429, _body:text.slice(0,1000)};
        keyIndex=(keyIndex+1)%INSTAGRAM_API_KEYS.length; continue;
      }
      if (r.status === 401) {
        last = {_error:'Invalid Instagram API key (HTTP 401)', _code:401, _body:text.slice(0,1000)};
        keyIndex=(keyIndex+1)%INSTAGRAM_API_KEYS.length; continue;
      }
      if (r.status === 403) return {_error:'Instagram API access denied (HTTP 403)', _code:403, _body:text.slice(0,1000)};
      if (!r.ok) return {_error:`Instagram API HTTP ${r.status}`, _code:r.status, _body:text.slice(0,1000)};
      if (!data) return {_error:'Instagram API returned non-JSON response', _code:r.status, _body:text.slice(0,1000)};
      return data;
    } catch (e) {
      last = {_error:'Instagram API network error: ' + e.message, _code:0};
    }
  }
  return last || {_error:'All Instagram API keys failed', _code:0};
}

function findInstagramUser(data) {
  if (!data) return null;
  if (Array.isArray(data)) {
    for (const item of data) { const found = findInstagramUser(item); if (found) return found; }
    return null;
  }
  if (typeof data !== 'object') return null;
  const looksLikeUser = (o) => o && typeof o === 'object' && (
    (o.username && (o.pk !== undefined || o.id !== undefined)) ||
    (o.username && (o.follower_count !== undefined || o.followers_count !== undefined))
  );
  if (looksLikeUser(data)) return data;
  for (const key of ['data','user','userInfo','response','result']) {
    if (data[key] && typeof data[key] === 'object') {
      const found = findInstagramUser(data[key]); if (found) return found;
    }
  }
  return null;
}

function instagramProfileNormalize(data, username) {
  const user = findInstagramUser(data);
  if (!user) return null;
  const followerCount = Number(user.follower_count ?? user.followers_count ?? user.followerCount ?? 0) || 0;
  const followingCount = Number(user.following_count ?? user.followingCount ?? 0) || 0;
  const mediaCount = Number(user.media_count ?? user.mediaCount ?? user.post_count ?? 0) || 0;
  const uniqueId = String(user.username ?? username);
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(uniqueId)}/`;
  return {
    id: String(user.pk ?? user.id ?? ''),
    uniqueId,
    nickname: user.full_name ?? user.fullName ?? uniqueId,
    avatarUrl: user.profile_pic_url_hd ?? user.profile_pic_url ?? user.profilePicUrl ?? '',
    bio: user.biography ?? user.bio ?? '',
    verified: Boolean(user.is_verified ?? user.verified),
    private: Boolean(user.is_private ?? user.private),
    followers: followerCount,
    following: followingCount,
    videoCount: mediaCount,
    likes: 0,
    profileUrl,
    externalUrl: user.external_url ?? user.externalUrl ?? ''
  };
}

function flattenInstagramMediaResponse(data) {
  let items = [], cursor = null;
  if (Array.isArray(data)) {
    if (Array.isArray(data[0])) items = data[0];
    cursor = typeof data[1] === 'string' || typeof data[1] === 'number' ? String(data[1]) : null;
    if (!items.length && data.every(v => v && typeof v === 'object' && !Array.isArray(v))) items = data;
  } else if (data && typeof data === 'object') {
    const candidates = [data.items, data.medias, data.data, data.response, data.result];
    for (const c of candidates) {
      if (Array.isArray(c)) {
        items = c.flat ? c.flat(Infinity).filter(v => v && typeof v === 'object' && !Array.isArray(v)) : c;
        break;
      }
    }
    cursor = data.next_cursor ?? data.end_cursor ?? data.cursor ?? data.next_page_id ?? null;
    if (!items.length && data.stream_rows) {
      // Best-effort support for GraphQL-shaped provider responses.
      const found = [];
      const walk = (v) => {
        if (!v) return;
        if (Array.isArray(v)) return v.forEach(walk);
        if (typeof v !== 'object') return;
        if (v.pk && (v.username || v.caption_text || v.like_count !== undefined || v.thumbnail_url)) found.push(v);
        for (const val of Object.values(v)) if (val && typeof val === 'object') walk(val);
      };
      walk(data.stream_rows);
      items = found;
    }
  }
  return {items, cursor};
}

function instagramMetricValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'object') {
    for (const k of ['count','value','total']) {
      if (value[k] !== undefined) {
        const n = instagramMetricValue(value[k]);
        if (n !== null) return n;
      }
    }
    return null;
  }
  const raw = String(value).trim().replace(/,/g, '');
  if (!raw) return null;
  const m = raw.match(/^(-?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  const base = Number(m[1]);
  const mult = !m[2] ? 1 : ({k:1e3,m:1e6,b:1e9}[m[2].toLowerCase()] || 1);
  return Number.isFinite(base * mult) ? base * mult : null;
}

function instagramMetric(item, keys, maxDepth = 5, seen = new Set()) {
  if (!item || typeof item !== 'object' || maxDepth < 0 || seen.has(item)) return null;
  seen.add(item);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(item, key)) {
      const n = instagramMetricValue(item[key]);
      if (n !== null) return n;
    }
  }
  if (maxDepth === 0) return null;
  for (const [key, value] of Object.entries(item)) {
    if (!value || typeof value !== 'object') continue;
    // Avoid crawling huge unrelated blobs while still covering HikerAPI nested media metadata.
    if (/^(user|owner|caption|comments|likers|usertags|location|music|audio|sharing_info)$/i.test(key)) continue;
    const n = instagramMetric(value, keys, maxDepth - 1, seen);
    if (n !== null) return n;
  }
  return null;
}

function instagramMediaNormalize(item, username) {
  if (!item || typeof item !== 'object') return null;
  const desc = String(item.caption_text ?? item.caption?.text ?? item.caption ?? item.description ?? item.title ?? '');
  const mediaTypeCode = Number(item.media_type ?? item.mediaType ?? 0);
  const productType = String(item.product_type ?? item.productType ?? '').toLowerCase();
  let mediaType = 'image';
  if (productType === 'clips' || productType === 'reels' || productType === 'igtv') mediaType = 'reel';
  else if (mediaTypeCode === 8 || item.carousel_media || item.carouselMedia) mediaType = 'carousel';
  else if (mediaTypeCode === 2 || item.video_url || item.videoUrl || (item.video_versions && item.video_versions.length)) mediaType = 'video';

  const firstImage = Array.isArray(item.image_versions) && item.image_versions.length
    ? item.image_versions[item.image_versions.length - 1]?.url
    : '';
  const resources = Array.isArray(item.resources) ? item.resources : [];
  const firstResourceImage = resources.find(r => r && (r.thumbnail_url || r.image_url || r.url))?.thumbnail_url
    || resources.find(r => r && (r.image_url || r.url))?.image_url
    || resources.find(r => r && r.url)?.url || '';
  const thumbnailUrl = item.thumbnail_url ?? item.thumbnailUrl ?? item.display_url ?? firstImage ?? firstResourceImage ?? '';
  const code = String(item.code ?? item.shortcode ?? item.shortCode ?? '');
  const postUrl = String(item.url ?? item.permalink ?? (code ? `https://www.instagram.com/${mediaType === 'reel' ? 'reel' : 'p'}/${code}/` : `https://www.instagram.com/${username}/`));
  const viewMetricKeys = ['play_count','view_count','video_view_count','viewCount','videoViewCount','views','plays','playCount'];
  const likeMetricKeys = ['like_count','likes','likeCount'];
  const commentMetricKeys = ['comment_count','comments','commentCount'];
  const shareMetricKeys = ['reshare_count','share_count','shares','shareCount'];
  const views = instagramMetric(item, viewMetricKeys) ?? 0;
  const likes = instagramMetric(item, likeMetricKeys) ?? 0;
  const comments = instagramMetric(item, commentMetricKeys) ?? 0;
  const shares = instagramMetric(item, shareMetricKeys) ?? 0;
  const duration = instagramMetric(item, ['video_duration','duration','videoDuration']) ?? 0;
  const uploadDate = Number(item.taken_at_ts ?? item.uploadDate ?? 0) || (item.taken_at ? Math.floor(new Date(item.taken_at).getTime()/1000) : 0);
  const hashtags = [...desc.matchAll(/#([\w\u00C0-\u024F]+)/gu)].map(m => m[1]);
  const id = String(item.pk ?? item.id ?? item.media_id ?? code ?? '');
  return { id, description: desc, thumbnailUrl, postUrl, views, likes, comments, shares, duration, uploadDate, hashtags, mediaType };
}

async function getInstagramProfile(username) {
  const key = 'profile:' + username.toLowerCase();
  const cached = instagramCacheGet(key); if (cached) return cached;
  const data = await instagramHttpGet('/v1/user/by/username', { username });
  if (data && data._error) return data;
  const profile = instagramProfileNormalize(data, username);
  if (!profile) return {_error:'Instagram API returned HTTP 200, but no profile object was found', _code:502, _body: JSON.stringify(data).slice(0,1000)};
  instagramCacheSet(key, profile);
  return profile;
}

async function getInstagramPosts(username, count, cursor) {
  const profile = await getInstagramProfile(username);
  if (profile && profile._error) return profile;
  const userId = profile.id;
  let data;
  if (instagramProvider === 'rapidapi') {
    // The RapidAPI public-data provider documents a paginated user-media endpoint.
    data = await instagramHttpGet('/gql/user/medias', { user_id: userId, cursor: cursor || '', count: Math.max(1, Math.min(100, Number(count || 50))) });
  } else {
    data = await instagramHttpGet('/v1/user/medias/chunk', { user_id: userId, end_cursor: cursor || '' });
  }
  if (data && data._error) return data;
  const {items, cursor: nextCursor} = flattenInstagramMediaResponse(data);
  let posts = items.map(item => instagramMediaNormalize(item, username)).filter(Boolean).slice(0, Math.max(1, Math.min(500, Number(count || 50))));

  // HikerAPI documents play_count/view count for reels. Some media-feed responses can
  // omit that field from the top level, so use the dedicated reels endpoint only when
  // a video/reel is missing its view count, then merge the exact metric by media id/code.
  const missingViewVideoIds = posts.filter(p => ['reel','video'].includes(p.mediaType) && !Number(p.views)).map(p => p.id).filter(Boolean);
  if (missingViewVideoIds.length) {
    try {
      const clipsData = await instagramHttpGet('/v1/user/clips', { user_id: userId });
      if (!(clipsData && clipsData._error)) {
        const clipList = flattenInstagramMediaResponse(clipsData).items;
        const clipMap = new Map();
        for (const raw of clipList) {
          const clip = instagramMediaNormalize(raw, username);
          if (!clip) continue;
          if (clip.id) clipMap.set(String(clip.id), clip);
          const clipCode = String(raw.code ?? raw.shortcode ?? raw.shortCode ?? '');
          if (clipCode) clipMap.set('code:' + clipCode, clip);
        }
        posts = posts.map(p => {
          if (Number(p.views)) return p;
          const byId = clipMap.get(String(p.id));
          if (byId && Number(byId.views)) return { ...p, views: byId.views, likes: byId.likes || p.likes, comments: byId.comments || p.comments, shares: byId.shares || p.shares, duration: byId.duration || p.duration };
          const codeMatch = String(p.postUrl || '').match(/\/(?:p|reel)\/([^/\?#]+)/);
          const byCode = codeMatch ? clipMap.get('code:' + codeMatch[1]) : null;
          if (byCode && Number(byCode.views)) return { ...p, views: byCode.views, likes: byCode.likes || p.likes, comments: byCode.comments || p.comments, shares: byCode.shares || p.shares, duration: byCode.duration || p.duration };
          return p;
        });
      }
    } catch (e) {
      console.warn('[InstagramAPI] reel view fallback failed:', e.message);
    }
  }

  return { profile, posts, cursor: nextCursor, hasMore: Boolean(nextCursor), total: posts.length };
}

async function instagramExplorerApi(req, res, url) {
  const action = url.searchParams.get('action') || '';
  const usernameRaw = url.searchParams.get('username') || '';
  const username = String(usernameRaw).trim().replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');
  if (action === 'config') {
    return json(res,200,{configured:Boolean(INSTAGRAM_API_KEYS.length), keyCount:INSTAGRAM_API_KEYS.length, provider:instagramProvider, host:INSTAGRAM_API_HOST});
  }
  if (!username) return json(res,400,{error:'Instagram username is required'});
  if (action === 'profile') {
    const result = await getInstagramProfile(username);
    if (result && result._error) {
      const detail = result._body ? ` — Provider: ${result._body.slice(0,500)}` : (result._detail ? ` — ${result._detail}` : '');
      if (result._code === 401) return json(res,502,{error:`Instagram API key invalid. ${result._error}${detail}`});
      if (result._code === 403) return json(res,502,{error:`Instagram API access problem. ${result._error}${detail}`});
      if (result._code === 429) return json(res,429,{error:`Instagram API rate-limited. ${result._error}${detail}`});
      return json(res,502,{error:`Instagram API error: ${result._error}${detail}`});
    }
    return json(res,200,result);
  }
  if (action === 'posts') {
    const count = Math.max(1, Math.min(500, Number(url.searchParams.get('count') || 50)));
    const cursor = url.searchParams.get('cursor') || '';
    const ck = `posts:${username.toLowerCase()}:${count}:${cursor}`;
    const cached = instagramCacheGet(ck); if (cached) return json(res,200,cached);
    const result = await getInstagramPosts(username, count, cursor);
    if (result && result._error) {
      const detail = result._body ? ` — Provider: ${result._body.slice(0,500)}` : (result._detail ? ` — ${result._detail}` : '');
      if (result._code === 401) return json(res,502,{error:`Instagram API key invalid. ${result._error}${detail}`});
      if (result._code === 403) return json(res,502,{error:`Instagram API access problem. ${result._error}${detail}`});
      if (result._code === 429) return json(res,429,{error:`Instagram API rate-limited. ${result._error}${detail}`});
      return json(res,502,{error:`Instagram API error: ${result._error}${detail}`});
    }
    const payload = { profile: result.profile, videos: result.posts, cursor: result.cursor, hasMore: result.hasMore, total: result.total };
    instagramCacheSet(ck,payload);
    return json(res,200,payload);
  }
  return json(res,400,{error:'Unknown Instagram Explorer action. Use ?action=profile, ?action=posts, or ?action=config'});
}

function safeFilePath(urlPath){
  const rel=urlPath.split('?')[0].replace(/^\/+/, '') || 'index.html';
  const map={ '/':'__shell__' };
  if(rel==='index.html') return path.join(PUBLIC,'shell.html');
  const full=path.resolve(PUBLIC,rel);
  if(!full.startsWith(path.resolve(PUBLIC)+path.sep)) return null;
  return full;
}
async function serve(req,res,url){
  if(url.pathname==='/tikverify'){
    let html=fs.readFileSync(path.join(PUBLIC,'tikverify.template.html'),'utf8').replaceAll('__CSRF_TOKEN__',TIKVERIFY_CSRF_TOKEN);
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}); return res.end(html);
  }
  if(url.pathname==='/explorer'){
    const html=fs.readFileSync(path.join(PUBLIC,'explorer.html'),'utf8'); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}); return res.end(html);
  }
  if(url.pathname==='/instagram-explorer'){
    const html=fs.readFileSync(path.join(PUBLIC,'instagram-explorer.html'),'utf8'); res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','X-Content-Type-Options':'nosniff'}); return res.end(html);
  }
  const file=safeFilePath(url.pathname); if(!file)return json(res,404,{error:'Not found'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
  const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff'}); fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(req.method==='POST'&&url.pathname==='/api/tikverify')return await tikVerifyApi(req,res);
    if(req.method==='GET'&&(url.pathname==='/api/explorer'||url.pathname==='/api/explorer/user/info'||url.pathname==='/api/explorer/user/posts'))return await explorerApi(req,res,url);
    if(req.method==='GET'&&url.pathname==='/api/instagram-explorer')return await instagramExplorerApi(req,res,url);
    if(req.method==='GET')return await serve(req,res,url);
    return json(res,405,{error:'Method not allowed'});
  }catch(e){ console.error(e); return json(res,500,{error:'Internal server error'}); }
});
server.listen(PORT,()=> {
  console.log(`TikTok Node Suite running at http://localhost:${PORT}`);
  startKeepAlive();
});
