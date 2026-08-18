TIKTOK NODE SUITE — COMPLETE PROJECT
===================================

This TXT contains every source file for the Node.js conversion.
The project combines TikVerify and TikTok Explorer with one-click switching.
Create the same folders/files from the headings below.


==============================================================================
FILE: package.json
==============================================================================
{
  "name": "tiktok-node-suite",
  "version": "1.0.0",
  "private": true,
  "description": "Node.js suite combining TikVerify and TikTok Explorer with one-click switching.",
  "type": "commonjs",
  "scripts": {"start":"node server.js"},
  "engines": {"node": ">=18"}
}

==============================================================================
FILE: server.js
==============================================================================
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

const RAPIDAPI_HOST = process.env.RAPIDAPI_HOST || 'tiktok-scraper7.p.rapidapi.com';
const RAPIDAPI_KEYS = (process.env.RAPIDAPI_KEYS || '').split(',').map(s => s.trim()).filter(Boolean);
const CACHE_TTL = Number(process.env.CACHE_TTL || 300) * 1000;
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
  if(!RAPIDAPI_KEYS.length) return {_error:'No RAPIDAPI_KEYS configured',_code:0};
  let keyIndex=Number(process.env.RAPIDAPI_KEY_INDEX||0)%RAPIDAPI_KEYS.length;
  let last=null;
  for(let i=0;i<RAPIDAPI_KEYS.length;i++){
    const key=RAPIDAPI_KEYS[keyIndex];
    const u=new URL('https://'+RAPIDAPI_HOST+pathname); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v));
    try{
      const r=await fetch(u,{headers:{'x-rapidapi-key':key,'x-rapidapi-host':RAPIDAPI_HOST},signal:AbortSignal.timeout(15000)});
      const text=await r.text(); let data; try{data=JSON.parse(text)}catch{data={_error:'bad json',_code:r.status,_body:text.slice(0,120)}}
      if(r.status===429){ keyIndex=(keyIndex+1)%RAPIDAPI_KEYS.length; last={_error:'http: 429',_code:429}; continue; }
      if(!r.ok)return {_error:(r.status===403?'Not subscribed to this API':'http: '+r.status),_code:r.status};
      return data;
    }catch(e){ last={_error:'network: '+e.message,_code:0}; }
  }
  return last||{_error:'network: all keys failed',_code:0};
}
async function explorerApi(req,res,url){
  const action=url.searchParams.get('action')||''; const username=extractUsername(url.searchParams.get('username')||'');
  if(!username)return json(res,400,{error:'username is required'});
  if(action==='profile'){
    const ck='profile:'+username.toLowerCase(); const c=cacheGet(ck); if(c)return json(res,200,c);
    const data=await rapidApiFetch('/user/info',{unique_id:username});
    if(data._error){ if(data._code===403)return json(res,403,{error:'Not subscribed to this API'}); if(data._code===429)return json(res,429,{error:'Rate limited — try again later'}); return json(res,502,{error:'Could not reach TikTok API: '+data._error}); }
    if(data.code===-1||data.msg==='error')return json(res,404,{error:'Profile not found or private account'});
    const inner=Array.isArray(data.data)?{}:(data.data&&typeof data.data==='object'?data.data:(data.userInfo||{}));
    const user=inner.user||data.user||{}; const stats=inner.stats||data.stats||{};
    if(!Object.keys(user).length)return json(res,404,{error:'Profile not found'});
    const profile={id:String(user.id??user.uid??''),uniqueId:user.uniqueId??username,nickname:user.nickname??username,avatarUrl:user.avatarLarger??user.avatarMedium??user.avatarThumb??'',bio:user.signature??'',verified:Boolean(user.verified),followers:Number(stats.followerCount??0),following:Number(stats.followingCount??0),likes:Number(stats.heartCount??stats.heart??0),videoCount:Number(stats.videoCount??0),profileUrl:'https://www.tiktok.com/@'+(user.uniqueId??username)};
    cacheSet(ck,profile); return json(res,200,profile);
  }
  if(action==='videos'){
    const count=Math.max(1,Math.min(500,Number(url.searchParams.get('count')||30))); const cursor=url.searchParams.get('cursor')||'0'; const ck=`videos:${username}:${count}:${cursor}`; const c=cacheGet(ck); if(c)return json(res,200,c);
    const data=await rapidApiFetch('/user/posts',{unique_id:username,count,cursor});
    if(data._error){if(data._code===403)return json(res,403,{error:'Not subscribed to this API'});if(data._code===429)return json(res,429,{error:'Rate limited — try again later'});return json(res,502,{error:'Could not reach TikTok API: '+data._error});}
    if(data.code===-1)return json(res,404,{error:'Profile not found or private account'});
    const inner=data.data&&typeof data.data==='object'?data.data:data; const raw=Array.isArray(inner.videos)?inner.videos:(Array.isArray(inner.aweme_list)?inner.aweme_list:(Array.isArray(data.videos)?data.videos:[]));
    const videos=raw.map(v=>{const desc=typeof v.title==='string'&&v.title?v.title:(Array.isArray(v.content_desc)?v.content_desc.filter(Boolean).join(' '):(v.content_desc||v.desc||v.description||''));const vm=v.video&&typeof v.video==='object'?v.video:{};const stats=v.stats&&typeof v.stats==='object'?v.stats:{};const thumb=v.cover??v.origin_cover??v.ai_dynamic_cover??vm.cover??vm.originCover??'';const views=Number(v.play_count??stats.playCount??stats.play_count??0),likes=Number(v.digg_count??stats.diggCount??stats.digg_count??0),comments=Number(v.comment_count??stats.commentCount??stats.comment_count??0),shares=Number(v.share_count??stats.shareCount??stats.share_count??0);const hashtags=[...desc.matchAll(/#([\w\u00C0-\u024F]+)/gu)].map(m=>m[1]);const vid=String(v.aweme_id??v.video_id??v.id??'');const numeric=String(v.video_id??v.id??'');const share=typeof v.share_url==='string'?v.share_url.trim():'';let videoUrl=share||(numberLike(numeric)?`https://www.tiktok.com/@${username}/video/${numeric}`:numberLike(vid)?`https://www.tiktok.com/@${username}/video/${vid}`:`https://www.tiktok.com/@${username}`);return{id:vid,description:desc,thumbnailUrl:thumb,videoUrl,views,likes,comments,shares,duration:Number(v.duration??vm.duration??0),uploadDate:Number(v.create_time??v.createTime??0),hashtags};});
    const result={videos,cursor:inner.cursor!=null?String(inner.cursor):null,hasMore:Boolean(inner.hasMore??data.has_more??false),total:videos.length}; if(cursor==='0')cacheSet(ck,result); return json(res,200,result);
  }
  return json(res,400,{error:'Unknown action. Use ?action=profile or ?action=videos'});
}
function numberLike(v){return /^\d+$/.test(v||'')&&v!=='';}

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
  const file=safeFilePath(url.pathname); if(!file)return json(res,404,{error:'Not found'});
  if(!fs.existsSync(file)||!fs.statSync(file).isFile())return json(res,404,{error:'Not found'});
  const ext=path.extname(file); const types={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json'};
  res.writeHead(200,{'Content-Type':types[ext]||'application/octet-stream','X-Content-Type-Options':'nosniff'}); fs.createReadStream(file).pipe(res);
}

const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://localhost');
  try{
    if(req.method==='POST'&&url.pathname==='/api/tikverify')return await tikVerifyApi(req,res);
    if(req.method==='GET'&&url.pathname==='/api/explorer')return await explorerApi(req,res,url);
    if(req.method==='GET')return await serve(req,res,url);
    return json(res,405,{error:'Method not allowed'});
  }catch(e){ console.error(e); return json(res,500,{error:'Internal server error'}); }
});
server.listen(PORT,()=> {
  console.log(`TikTok Node Suite running at http://localhost:${PORT}`);
  startKeepAlive();
});

==============================================================================
FILE: .env.example
==============================================================================
RAPIDAPI_KEYS=YOUR_KEY_1,YOUR_KEY_2
RAPIDAPI_HOST=tiktok-scraper7.p.rapidapi.com
CACHE_TTL=300
TIKVERIFY_TIMEOUT=15000

==============================================================================
FILE: .gitignore
==============================================================================
node_modules/
.env
npm-debug.log*

==============================================================================
FILE: README.md
==============================================================================
# TikTok Node Suite

A single Node.js website containing the two original tools:

- **TikVerify** — bulk TikTok link checker/verifier with exports and Create Service.
- **TikTok Explorer** — profile/video explorer using RapidAPI.

## One-click switching

Open `/` and use the two buttons in the top bar. Each tool stays loaded in its own iframe, so switching back does not reset the other tool's page state.

## Run

1. Install Node.js 18+ (Node 24 is fine).
2. Keep `.env` beside `server.js` and edit the RapidAPI keys if needed.
3. Run:

```bash
node server.js
```

4. Open `http://localhost:3000`

No PHP, Composer, npm packages, or build step are required.

## Security change

The old Explorer exposed RapidAPI keys in browser JavaScript. In this Node version the keys are read from `.env` by the server and Explorer calls `/api/explorer` instead.

If this project will be shared publicly, replace the supplied RapidAPI keys with your own private keys and do not commit `.env`.

==============================================================================
FILE: public/shell.html
==============================================================================
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>TikTok Tools Suite</title>
<style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#070910;color:#eef0f8;font-family:Inter,system-ui,-apple-system,Segoe UI,sans-serif;overflow:hidden}
.switcher{height:64px;display:flex;align-items:center;gap:10px;padding:10px 16px;background:rgba(10,11,18,.94);border-bottom:1px solid rgba(255,255,255,.1);backdrop-filter:blur(14px);position:relative;z-index:10}
.brand{font-weight:800;font-size:17px;margin-right:auto}.brand span{background:linear-gradient(135deg,#7c5cff,#2fd3c7);-webkit-background-clip:text;background-clip:text;color:transparent}
.tool{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);color:#aeb4c8;border-radius:999px;padding:10px 16px;font-weight:700;cursor:pointer;transition:.2s}.tool:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.25);color:#fff}.tool.active{background:linear-gradient(135deg,#7c5cff,#2fd3c7);border-color:transparent;color:#fff}
.frame-wrap{height:calc(100vh - 64px);width:100%;position:relative}.app-frame{position:absolute;inset:0;width:100%;height:100%;border:0;background:#0a0b12;display:none}.app-frame.active{display:block}
</style>
</head>
<body>
<nav class="switcher">
  <div class="brand">TikTok <span>Tools Suite</span></div>
  <button class="tool active" data-target="tikverifyFrame">TikVerify</button>
  <button class="tool" data-target="explorerFrame">TikTok Explorer</button>
</nav>
<div class="frame-wrap">
  <iframe id="tikverifyFrame" class="app-frame active" src="/tikverify" title="TikVerify"></iframe>
  <iframe id="explorerFrame" class="app-frame" src="/explorer" title="TikTok Explorer"></iframe>
</div>
<script>
const buttons=[...document.querySelectorAll('.tool')]; const frames=[...document.querySelectorAll('.app-frame')];
function switchTool(id){buttons.forEach(b=>b.classList.toggle('active',b.dataset.target===id));frames.forEach(f=>f.classList.toggle('active',f.id===id));localStorage.setItem('tiktok_suite_tool',id)}
buttons.forEach(b=>b.addEventListener('click',()=>switchTool(b.dataset.target)));
const saved=localStorage.getItem('tiktok_suite_tool'); if(saved&&document.getElementById(saved))switchTool(saved);
</script>
</body></html>

==============================================================================
FILE: public/tikverify.template.html
==============================================================================
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>TikVerify — Bulk TikTok Link Checker</title>
<meta name="description" content="Premium bulk TikTok link verification.">
<meta name="csrf-token" content="__CSRF_TOKEN__">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css">
</head>
<body>
<div class="bg-aurora" aria-hidden="true"></div>

<header class="topbar">
  <div class="topbar-inner">
    <div class="brand">
      <span class="brand-mark">
        <svg width="26" height="26" viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M34 6c1.2 6 5.4 10 12 10.6v7.4c-4.4 0-8.4-1.3-12-3.8v12.6C34 41 27.8 47 20 47S6 41 6 33.2c0-7.6 6-13.7 13.6-14v8.1c-3.1.5-5.6 3.2-5.6 6.5 0 3.7 3 6.6 6.6 6.6s6.6-2.9 6.6-6.6V6z" fill="url(#g)"/>
          <defs><linearGradient id="g" x1="6" y1="6" x2="46" y2="47" gradientUnits="userSpaceOnUse"><stop stop-color="#7C5CFF"/><stop offset="1" stop-color="#2FD3C7"/></linearGradient></defs>
        </svg>
      </span>
      <span class="brand-name">TikVerify</span>
    </div>

    <div class="topbar-search">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      <input type="text" id="topSearch" placeholder="Search results by title or URL…" autocomplete="off">
    </div>

    <nav class="topbar-actions">
      <button class="icon-btn" id="themeToggle" title="Toggle dark / light mode" aria-label="Toggle theme">
        <svg class="icon-sun" width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="4" stroke="currentColor" stroke-width="2"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <svg class="icon-moon" width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-btn" id="settingsBtn" title="Settings" aria-label="Settings">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      </button>
      <button class="icon-btn" id="aboutBtn" title="About" aria-label="About">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </nav>
  </div>
</header>

<main class="shell">

  <section class="hero">
    <div class="hero-badge">Bulk verification · real-time · zero setup</div>
    <h1 class="hero-title">Verify thousands of <span>TikTok links</span> in minutes.</h1>
    <p class="hero-sub">Paste links, campaign notes, or messy exports. TikVerify extracts every URL, checks availability, and pulls views, likes, comments and HD thumbnails automatically — with automatic fallbacks when TikTok blocks a method.</p>

    <div class="hero-stats" id="heroStats">
      <div class="hstat"><span class="hstat-num" data-count="0" id="statTotalHero">0</span><span class="hstat-label">Links Checked</span></div>
      <div class="hstat"><span class="hstat-num" data-count="0" id="statAvailHero">0</span><span class="hstat-label">Available</span></div>
      <div class="hstat"><span class="hstat-num" data-count="0" id="statBrokenHero">0</span><span class="hstat-label">Broken</span></div>
      <div class="hstat"><span class="hstat-num" data-count="0" id="statRateHero">0%</span><span class="hstat-label">Success Rate</span></div>
    </div>
  </section>

  <section class="panel input-panel">
    <div class="panel-head">
      <h2>1. Add your links</h2>
      <span class="panel-hint">Paste raw text, or drop a .txt / .csv file below</span>
    </div>

    <div class="dropzone" id="dropzone">
      <textarea id="inputText" placeholder="Paste TikTok links, campaign text, or mixed content here…&#10;&#10;https://www.tiktok.com/@user/video/1234567890123456789&#10;https://vm.tiktok.com/ABCdef/"></textarea>
      <div class="dropzone-overlay" id="dropOverlay">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M12 4l-4 4M12 4l4 4M5 20h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        <p>Drop your .txt or .csv file</p>
      </div>
    </div>

    <div class="input-toolbar">
      <button class="btn btn-ghost" id="btnUpload">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 16V4M12 4l-4 4M12 4l4 4M5 20h14" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Upload File
      </button>
      <input type="file" id="fileInput" accept=".txt,.csv" hidden>
      <button class="btn btn-ghost" id="btnPaste">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="4" width="12" height="17" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" stroke="currentColor" stroke-width="1.8"/></svg>
        Paste Clipboard
      </button>
      <button class="btn btn-ghost" id="btnExample">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 2l2.4 6.6L21 11l-6.6 2.4L12 20l-2.4-6.6L3 11l6.6-2.4z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        Load Example
      </button>
      <button class="btn btn-ghost" id="btnClear">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        Clear
      </button>
      <span class="toolbar-spacer"></span>
      <span class="input-summary" id="inputSummary">0 links detected</span>
    </div>

    <div class="run-row">
      <button class="btn btn-primary btn-lg" id="btnStart">
        <span class="btn-glow"></span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M7 5v14l12-7L7 5z" fill="currentColor"/></svg>
        <span>Start Checking</span>
      </button>
      <button class="btn btn-secondary" id="btnPause" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>
        Pause
      </button>
      <button class="btn btn-secondary" id="btnResume" disabled hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M7 5v14l12-7L7 5z" fill="currentColor"/></svg>
        Resume
      </button>
      <button class="btn btn-danger" id="btnStop" disabled>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>
        Stop
      </button>
      <button class="btn btn-secondary" id="btnOpenCreateService" hidden>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        Create Service
      </button>
    </div>
  </section>

  <section class="panel progress-panel" id="progressPanel" hidden>
    <div class="panel-head">
      <h2>Live Progress</h2>
      <span class="status-pill" id="statusPill">Idle</span>
    </div>

    <div class="progress-track">
      <div class="progress-fill" id="progressFill"></div>
    </div>

    <div class="progress-grid">
      <div class="progress-current">
        <img id="currentThumb" class="current-thumb" alt="" src="" hidden>
        <div class="current-thumb placeholder" id="currentThumbPlaceholder"></div>
        <div class="current-info">
          <div class="current-label">Currently checking</div>
          <div class="current-link" id="currentLink">—</div>
          <div class="current-status" id="currentStatus">Waiting to start…</div>
        </div>
      </div>

      <div class="progress-stats">
        <div class="pstat"><span id="pProcessed">0</span><label>Processed</label></div>
        <div class="pstat"><span id="pRemaining">0</span><label>Remaining</label></div>
        <div class="pstat"><span id="pElapsed">0s</span><label>Elapsed</label></div>
        <div class="pstat"><span id="pETA">—</span><label>Est. Remaining</label></div>
        <div class="pstat"><span id="pSpeed">—</span><label>Speed</label></div>
      </div>
    </div>
  </section>

  <section class="panel summary-panel" id="summaryPanel" hidden>
    <div class="panel-head"><h2>Summary</h2></div>
    <div class="summary-grid">
      <div class="scard"><div class="scard-num" id="sTotal">0</div><div class="scard-label">Total URLs</div></div>
      <div class="scard good"><div class="scard-num" id="sAvailable">0</div><div class="scard-label">Available</div></div>
      <div class="scard bad"><div class="scard-num" id="sBroken">0</div><div class="scard-label">Broken</div></div>
      <div class="scard"><div class="scard-num" id="sDuplicates">0</div><div class="scard-label">Duplicates Removed</div></div>
      <div class="scard"><div class="scard-num" id="sNoUrl">0</div><div class="scard-label">Lines Without URLs</div></div>
      <div class="scard"><div class="scard-num" id="sTime">0s</div><div class="scard-label">Processing Time</div></div>
      <div class="scard"><div class="scard-num" id="sSpeed">0/s</div><div class="scard-label">Average Speed</div></div>
      <div class="scard accent"><div class="scard-num" id="sRate">0%</div><div class="scard-label">Success Rate</div></div>
    </div>
  </section>

  <section class="panel results-panel" id="resultsPanel" hidden>
    <div class="panel-head results-head">
      <h2>Results</h2>
      <div class="view-toggle">
        <button class="vtab" data-view="cards">Cards</button>
        <button class="vtab active" data-view="gallery">Gallery</button>
      </div>
    </div>

    <div class="filters-row">
      <div class="chip-group" id="filterChips">
        <button class="chip active" data-filter="all">All</button>
        <button class="chip" data-filter="available">Available</button>
        <button class="chip" data-filter="broken">Broken</button>
        <button class="chip" data-filter="missing">Missing Stats</button>
        <button class="chip" data-filter="newest">Newest</button>
        <button class="chip" data-filter="oldest">Oldest</button>
      </div>
      <div class="results-search">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.3-4.3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        <input type="text" id="resultsSearch" placeholder="Filter by URL or title…">
      </div>
    </div>

    <div class="export-row">
      <button class="btn btn-ghost sm" id="btnCopyAllAvailable" hidden>Copy All Available Links</button>
      <button class="btn btn-ghost sm" id="btnCopyAvailable">Copy Available</button>
      <button class="btn btn-ghost sm" id="btnCopyBroken">Copy Broken</button>
      <button class="btn btn-ghost sm" id="btnDownloadTxt">Download TXT</button>
      <button class="btn btn-ghost sm" id="btnDownloadCsv">Download CSV</button>
      <button class="btn btn-ghost sm" id="btnDownloadJson">Download JSON</button>
      <button class="btn btn-ghost sm" id="btnExportHtml">Export HTML</button>
      <button class="btn btn-ghost sm" id="btnExportPdf">Export PDF</button>
    </div>

    <div class="results-grid gallery-view" id="resultsGrid"></div>
    <div class="empty-state" id="emptyState" hidden>
      <svg width="46" height="46" viewBox="0 0 24 24" fill="none"><path d="M4 4h16v16H4z" stroke="currentColor" stroke-width="1.4" opacity=".3"/><path d="M9 15l2.2-2.8L13 14l3-4 3 5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
      <p>No results match this filter yet.</p>
    </div>
  </section>

  <!-- =====================================================================
       Create Service — generate bulk SMM panel order lists (opened as a
       dialog once at least one AVAILABLE result exists)
       ===================================================================== -->
  <dialog class="app-dialog cs-dialog cs-panel" id="createServiceModal">
    <div class="modal-head">
      <h3>Create Service</h3>
      <button type="button" class="icon-btn" data-close aria-label="Close">&times;</button>
    </div>
    <p class="panel-hint cs-dialog-hint">Generate bulk order lists for SMM panels</p>

    <div class="cs-top-row">
      <!-- Service ID + history -->
      <div class="cs-field-group">
        <label class="cs-label" for="csServiceId">Service ID</label>
        <div class="cs-service-wrap">
          <input type="number" id="csServiceId" class="cs-input" placeholder="e.g. 17759" min="1" step="1">
          <button class="btn btn-ghost sm" id="csHistoryToggle" type="button">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3 3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            History
          </button>
        </div>
        <div class="cs-history-panel" id="csHistoryPanel" hidden>
          <div class="cs-history-head">
            <span class="cs-history-title">Recent Services</span>
            <button class="btn btn-ghost sm" id="csClearHistory" type="button">Clear All</button>
          </div>
          <div class="cs-history-list" id="csHistoryList"></div>
          <div class="cs-history-empty" id="csHistoryEmpty" hidden>No history yet</div>
        </div>
      </div>

      <!-- Price Per 1000 -->
      <div class="cs-field-group">
        <label class="cs-label" for="csPricePer1k">Price Per 1000 (BDT) <span class="cs-optional">(optional)</span></label>
        <input type="number" id="csPricePer1k" class="cs-input" placeholder="e.g. 35" min="0" step="0.01">
      </div>
    </div>

    <!-- Available videos readout (auto-sourced from verified Results) -->
    <div class="cs-field-group cs-urls-group">
      <label class="cs-label">Available Videos <span class="cs-url-count" id="csUrlCount"></span></label>
      <div class="cs-source-note" id="csSourceNote">Uses every AVAILABLE link from the Results section below — no need to paste URLs again.</div>
    </div>

    <!-- Quantity mode -->
    <div class="cs-qty-section">
      <div class="cs-mode-row">
        <span class="cs-label">Quantity Mode</span>
        <div class="cs-mode-toggle">
          <button class="cs-mode-btn active" data-mode="fixed" type="button">Fixed</button>
          <button class="cs-mode-btn" data-mode="random" type="button">Random</button>
        </div>
      </div>
      <div id="csFixedBlock">
        <label class="cs-label" for="csQtyFixed">Quantity per video</label>
        <input type="number" id="csQtyFixed" class="cs-input cs-qty-input" placeholder="e.g. 3000" min="1" step="1">
      </div>
      <div class="cs-top-row" id="csRandomBlock" hidden>
        <div class="cs-field-group">
          <label class="cs-label" for="csQtyMin">Minimum Quantity</label>
          <input type="number" id="csQtyMin" class="cs-input" placeholder="e.g. 2500" min="1" step="1">
        </div>
        <div class="cs-field-group">
          <label class="cs-label" for="csQtyMax">Maximum Quantity</label>
          <input type="number" id="csQtyMax" class="cs-input" placeholder="e.g. 3000" min="1" step="1">
        </div>
      </div>
    </div>

    <!-- Actions -->
    <div class="cs-actions-row">
      <button class="btn btn-primary" id="csBtnGenerate" type="button">
        <span class="btn-glow"></span>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        Generate
      </button>
      <button class="btn btn-ghost" id="csBtnCopyOutput" type="button" hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="1.8"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.8"/></svg>
        Copy Output
      </button>
      <button class="btn btn-ghost" id="csBtnDownloadOutput" type="button" hidden>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
        Download TXT
      </button>
      <button class="btn btn-ghost sm" id="csBtnClear" type="button">Clear</button>
    </div>

    <!-- Live Summary -->
    <div class="cs-summary" id="csSummary" hidden>
      <div class="cs-summary-inner">
        <div class="cs-sum-stat cs-sum-primary">
          <div class="cs-sum-val" id="csSumBdt">৳—</div>
          <div class="cs-sum-label">Total Cost (BDT)</div>
        </div>
        <div class="cs-sum-stat">
          <div class="cs-sum-val" id="csSumVideos">—</div>
          <div class="cs-sum-label">Available Videos</div>
        </div>
        <div class="cs-sum-stat">
          <div class="cs-sum-val" id="csSumOrders">—</div>
          <div class="cs-sum-label">Generated Orders</div>
        </div>
        <div class="cs-sum-stat">
          <div class="cs-sum-val" id="csSumQty">—</div>
          <div class="cs-sum-label">Total Quantity</div>
        </div>
        <div class="cs-sum-stat">
          <div class="cs-sum-val" id="csSumMode">—</div>
          <div class="cs-sum-label">Quantity Mode</div>
        </div>
        <div class="cs-sum-stat">
          <div class="cs-sum-val" id="csSumPrice">—</div>
          <div class="cs-sum-label">Price / 1000</div>
        </div>
      </div>
    </div>

    <!-- Generated output -->
    <div class="cs-output-section" id="csOutputSection" hidden>
      <div class="cs-output-head">
        <label class="cs-label">Generated Output</label>
        <span class="cs-output-lines" id="csOutputLines"></span>
      </div>
      <textarea id="csOutput" class="cs-textarea cs-output-textarea" readonly></textarea>
    </div>
  </dialog>

</main>

<footer class="app-footer">
  <span>TikVerify — runs entirely on standard PHP hosting. No frameworks, no build step.</span>
</footer>

<!-- Settings dialog (native <dialog>) -->
<dialog class="app-dialog" id="settingsModal">
  <div class="modal-head"><h3>Settings</h3><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></div>
  <div class="modal-body">
    <label class="field">
      <span>Delay between checks (ms)</span>
      <input type="range" id="settingDelay" min="100" max="1500" step="50" value="350">
      <span class="field-value" id="settingDelayValue">350ms</span>
    </label>
    <label class="field checkbox">
      <input type="checkbox" id="settingLazyLoad" checked>
      <span>Lazy-load thumbnails</span>
    </label>
    <label class="field checkbox">
      <input type="checkbox" id="settingSound" checked>
      <span>Sound on completion</span>
    </label>
  </div>
</dialog>

<!-- About dialog (native <dialog>) -->
<dialog class="app-dialog" id="aboutModal">
  <div class="modal-head"><h3>About TikVerify</h3><button type="button" class="icon-btn" data-close aria-label="Close">&times;</button></div>
  <div class="modal-body">
    <p>Premium bulk TikTok link verification.. Extracts TikTok links from any pasted text or file, verifies availability, and retrieves view/like/comment counts and thumbnails using several fallback methods so results stay accurate even when TikTok changes its page structure.</p>
    <p class="muted">Built with plain PHP, HTML, CSS and JavaScript — deployable to any standard shared hosting provider.</p>
  </div>
</dialog>

<div class="toast-stack" id="toastStack"></div>

<template id="cardTemplate">
  <article class="result-card">
    <div class="card-thumb-wrap">
      <img class="card-thumb" loading="lazy" alt="">
      <span class="status-badge"></span>
    </div>
    <div class="card-body">
      <h3 class="card-title"></h3>
      <a class="card-url" target="_blank" rel="noopener"></a>
      <div class="card-stats">
        <span class="cstat views"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg><b></b></span>
        <span class="cstat likes"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 21s-7.5-4.6-10-9.3C.5 8 2.4 4.5 6 4.5c2 0 3.5 1 6 3.5 2.5-2.5 4-3.5 6-3.5 3.6 0 5.5 3.5 4 7.2C19.5 16.4 12 21 12 21Z" stroke="currentColor" stroke-width="1.6"/></svg><b></b></span>
        <span class="cstat comments"><svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M21 11.5a8.4 8.4 0 0 1-8.9 8.4A9 9 0 0 1 8 19l-5 1 1.4-4.2A8.4 8.4 0 1 1 21 11.5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg><b></b></span>
      </div>
      <p class="card-error"></p>
      <div class="card-actions">
        <a class="btn btn-ghost sm card-open" target="_blank" rel="noopener">Open Video</a>
        <button class="btn btn-ghost sm card-copy">Copy URL</button>
      </div>
    </div>
  </article>
</template>

<script src="tikverify.js"></script>
</body>
</html>

==============================================================================
FILE: public/tikverify.js
==============================================================================
/* =========================================================================
   TikVerify — client-side application logic.
   Plain vanilla JS. Talks to process.php via fetch/AJAX. No build step.
   ========================================================================= */
(function () {
  "use strict";

  const CSRF_TOKEN = document.querySelector('meta[name="csrf-token"]').content;

  const EXTRACT_PATTERN =
    /https?:\/\/(?:(?:www\.)?tiktok\.com\/@[^\/\s]+\/video\/\d+[^\s|]*|(?:vm|vt|m)\.tiktok\.com\/[\w]+[^\s|]*|(?:www\.)?tiktok\.com\/t\/[\w]+[^\s|]*)/gi;

  const EXAMPLE_TEXT =
    "Campaign batch — TikTok creator drops\n" +
    "https://www.tiktok.com/@tiktok/video/7300000000000000001\n" +
    "https://vm.tiktok.com/ZMabcd123/\n" +
    "Notes: check these before Friday\n" +
    "https://www.tiktok.com/@tiktok/video/7300000000000000002 | extra text\n" +
    "https://www.tiktok.com/@tiktok/video/7300000000000000001 (duplicate on purpose)\n" +
    "no link on this line, just a reminder";

  // ---- State -------------------------------------------------------------
  const state = {
    results: [], // { url, status, title, thumbnail, views, likes, comments, error, order }
    queue: [],
    running: false,
    paused: false,
    stopped: false,
    processedCount: 0,
    startTime: 0,
    activeFilter: "all",
    activeView: "gallery",
    searchTerm: "",
    delayMs: 350,
  };

  // ---- DOM shortcuts -------------------------------------------------------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const inputText = $("#inputText");
  const dropzone = $("#dropzone");
  const fileInput = $("#fileInput");
  const inputSummary = $("#inputSummary");

  const btnStart = $("#btnStart");
  const btnPause = $("#btnPause");
  const btnResume = $("#btnResume");
  const btnStop = $("#btnStop");
  const btnOpenCreateService = $("#btnOpenCreateService");

  const progressPanel = $("#progressPanel");
  const summaryPanel = $("#summaryPanel");
  const resultsPanel = $("#resultsPanel");
  const resultsGrid = $("#resultsGrid");
  const emptyState = $("#emptyState");

  // =========================================================================
  // Toasts
  // =========================================================================
  function toast(message, type) {
    type = type || "info";
    const el = document.createElement("div");
    el.className = "toast " + type;
    el.textContent = message;
    $("#toastStack").appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  // =========================================================================
  // Theme
  // =========================================================================
  (function initTheme() {
    const saved = localStorage.getItem("tikverify_theme");
    const theme = saved || "dark";
    document.documentElement.setAttribute("data-theme", theme);
    $("#themeToggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("tikverify_theme", next);
    });
  })();

  // =========================================================================
  // Dialogs — native <dialog> element (no custom backdrop/hidden logic).
  // =========================================================================
  function openDialog(id) {
    const dlg = document.getElementById(id);
    if (dlg && typeof dlg.showModal === "function") {
      if (!dlg.open) dlg.showModal();
    } else if (dlg) {
      // Extremely old browser fallback: dialog polyfill absent, just show it.
      dlg.setAttribute("open", "");
    }
  }
  $("#settingsBtn").addEventListener("click", () =>
    openDialog("settingsModal"),
  );
  $("#aboutBtn").addEventListener("click", () => openDialog("aboutModal"));
  $("#btnOpenCreateService").addEventListener("click", () =>
    openDialog("createServiceModal"),
  );

  $$(".app-dialog").forEach((dlg) => {
    // Close via the × button.
    dlg.querySelectorAll("[data-close]").forEach((btn) => {
      btn.addEventListener("click", () => dlg.close());
    });
    // Click on the ::backdrop (outside the dialog box) closes it — a click that
    // lands directly on the <dialog> element itself (not its children) is a
    // backdrop click, since the dialog box is sized to its content.
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) dlg.close();
    });
  });

  const settingDelay = $("#settingDelay");
  const settingDelayValue = $("#settingDelayValue");
  settingDelay.value = localStorage.getItem("tikverify_delay") || 350;
  settingDelayValue.textContent = settingDelay.value + "ms";
  state.delayMs = parseInt(settingDelay.value, 10);
  settingDelay.addEventListener("input", () => {
    settingDelayValue.textContent = settingDelay.value + "ms";
    state.delayMs = parseInt(settingDelay.value, 10);
    localStorage.setItem("tikverify_delay", settingDelay.value);
  });

  const settingSound = $("#settingSound");
  const savedSound = localStorage.getItem("tikverify_sound");
  // Default ON (checked in HTML) unless the user has explicitly turned it off before.
  settingSound.checked = savedSound === null ? true : savedSound === "1";
  settingSound.addEventListener("change", () => {
    localStorage.setItem("tikverify_sound", settingSound.checked ? "1" : "0");
  });

  // =========================================================================
  // Ripple + button micro interactions
  // =========================================================================
  $$(".btn").forEach((btn) => {
    btn.addEventListener("click", function (e) {
      if (btn.disabled) return;
      const rect = btn.getBoundingClientRect();
      const ripple = document.createElement("span");
      ripple.className = "ripple";
      const size = Math.max(rect.width, rect.height);
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = e.clientX - rect.left - size / 2 + "px";
      ripple.style.top = e.clientY - rect.top - size / 2 + "px";
      btn.appendChild(ripple);
      setTimeout(() => ripple.remove(), 650);
    });
  });

  // =========================================================================
  // Input extraction preview (debounced)
  // =========================================================================
  let extractTimer = null;
  function updateInputSummary() {
    const text = inputText.value;
    const matches = text.match(EXTRACT_PATTERN) || [];
    const unique = uniqueUrls(matches);
    inputSummary.textContent =
      unique.length + " link" + (unique.length === 1 ? "" : "s") + " detected";
  }
  function uniqueUrls(list) {
    const seen = new Set();
    const out = [];
    list.forEach((u) => {
      const clean = u.split("|")[0].trim();
      if (!seen.has(clean)) {
        seen.add(clean);
        out.push(clean);
      }
    });
    return out;
  }
  inputText.addEventListener("input", () => {
    clearTimeout(extractTimer);
    extractTimer = setTimeout(updateInputSummary, 150);
  });

  // =========================================================================
  // File upload / drag & drop / clipboard / example / clear
  // =========================================================================
  $("#btnUpload").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (file) readFileIntoInput(file);
  });

  ["dragenter", "dragover"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add("dragging");
    }),
  );
  ["dragleave", "drop"].forEach((evt) =>
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragging");
    }),
  );
  dropzone.addEventListener("drop", (e) => {
    const file = e.dataTransfer.files[0];
    if (file) readFileIntoInput(file);
  });

  function readFileIntoInput(file) {
    const reader = new FileReader();
    reader.onload = () => {
      inputText.value = String(reader.result);
      updateInputSummary();
      toast('Loaded "' + file.name + '"', "success");
    };
    reader.onerror = () => toast("Could not read file", "error");
    reader.readAsText(file);
  }

  $("#btnPaste").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      inputText.value += (inputText.value ? "\n" : "") + text;
      updateInputSummary();
      toast("Pasted from clipboard", "success");
    } catch (err) {
      toast("Clipboard access denied by browser", "error");
    }
  });

  $("#btnExample").addEventListener("click", () => {
    inputText.value = EXAMPLE_TEXT;
    updateInputSummary();
  });

  $("#btnClear").addEventListener("click", () => {
    inputText.value = "";
    updateInputSummary();
  });

  // =========================================================================
  // API helper
  // =========================================================================
  async function api(action, payload) {
    const res = await fetch("/api/tikverify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": CSRF_TOKEN,
      },
      body: JSON.stringify(
        Object.assign(
          { action: action, csrf_token: CSRF_TOKEN },
          payload || {},
        ),
      ),
    });
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      throw new Error(errBody.error || "Request failed (" + res.status + ")");
    }
    return res.json();
  }

  // =========================================================================
  // Batch run controller
  // =========================================================================
  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  async function startRun() {
    const text = inputText.value.trim();
    if (!text) {
      toast("Add some links first", "error");
      return;
    }

    let stats;
    try {
      stats = await api("stats", { text: text });
    } catch (err) {
      toast(err.message, "error");
      return;
    }

    if (stats.unique === 0 || !stats.urls || stats.urls.length === 0) {
      toast("No TikTok links found in the input", "error");
      return;
    }

    state.queue = stats.urls.slice();
    state.results = [];
    state.processedCount = 0;
    state.running = true;
    state.paused = false;
    state.stopped = false;
    state.startTime = Date.now();
    state.linesWithoutUrl = stats.lines_without_url;
    state.duplicatesRemoved = stats.duplicates_removed;

    progressPanel.hidden = false;
    summaryPanel.hidden = true;
    resultsPanel.hidden = false;
    cardNodeMap.clear();
    resultsGrid.innerHTML = "";

    setRunningUI(true);
    updateProgressUI(0, state.queue.length);
    renderResults();

    for (let i = 0; i < state.queue.length; i++) {
      if (state.stopped) break;
      while (state.paused && !state.stopped) {
        setStatusPill("paused");
        await sleep(200);
      }
      if (state.stopped) break;

      const url = state.queue[i];
      setCurrent(url, "Checking…");
      setStatusPill("running");

      let newResult;
      try {
        const resp = await api("check", { url: url });
        newResult = resp.result;
        newResult.order = i;
        state.results.push(newResult);
        setCurrent(
          url,
          newResult.status === "available"
            ? "Available"
            : "Error: " + (newResult.error || "unknown"),
          newResult.thumbnail,
        );
      } catch (err) {
        newResult = { url: url, status: "error", error: err.message, order: i };
        state.results.push(newResult);
        setCurrent(url, "Error: " + err.message);
      }

      state.processedCount++;
      updateProgressUI(state.processedCount, state.queue.length);
      // Append only the newly finished card — never rebuild the whole grid,
      // so previously rendered cards/thumbnails/animations stay untouched.
      appendResultCard(newResult);
      updateHeroStats();

      if (i < state.queue.length - 1) {
        await sleep(state.delayMs);
      }
    }

    finishRun();
  }

  function setRunningUI(running) {
    btnStart.disabled = running;
    btnStart.classList.toggle("loading", running);
    btnPause.disabled = !running;
    btnStop.disabled = !running;
    btnResume.hidden = true;
    btnPause.hidden = false;
    inputText.disabled = running;
    // Hide while running; finishRun() reveals it once the batch is done.
    if (running) {
      btnCopyAllAvailable.hidden = true;
      btnOpenCreateService.hidden = true;
    }
  }

  function setStatusPill(kind) {
    const pill = $("#statusPill");
    pill.className = "status-pill " + kind;
    pill.textContent =
      kind === "running"
        ? "Running"
        : kind === "paused"
          ? "Paused"
          : kind === "done"
            ? "Complete"
            : "Idle";
  }

  function setCurrent(url, statusText, thumb) {
    $("#currentLink").textContent = url;
    $("#currentStatus").textContent = statusText;
    const img = $("#currentThumb");
    const placeholder = $("#currentThumbPlaceholder");
    if (thumb) {
      img.src = thumb;
      img.hidden = false;
      placeholder.hidden = true;
    } else {
      img.hidden = true;
      placeholder.hidden = false;
    }
  }

  function updateProgressUI(processed, total) {
    const pct = total ? Math.round((processed / total) * 100) : 0;
    $("#progressFill").style.width = pct + "%";
    $("#pProcessed").textContent = processed;
    $("#pRemaining").textContent = Math.max(0, total - processed);

    const elapsedSec = (Date.now() - state.startTime) / 1000;
    $("#pElapsed").textContent = formatDuration(elapsedSec);

    const speed = processed > 0 ? processed / elapsedSec : 0;
    $("#pSpeed").textContent = speed > 0 ? speed.toFixed(2) + "/s" : "—";

    const remaining = total - processed;
    const eta = speed > 0 ? remaining / speed : null;
    $("#pETA").textContent =
      eta !== null && isFinite(eta) ? formatDuration(eta) : "—";
  }

  function formatDuration(seconds) {
    if (seconds < 60) return Math.round(seconds) + "s";
    const m = Math.floor(seconds / 60);
    const s = Math.round(seconds % 60);
    return m + "m " + s + "s";
  }

  function finishRun() {
    state.running = false;
    setRunningUI(false);
    setStatusPill(state.stopped ? "idle" : "done");
    renderSummary();
    updateHeroStats();
    // Reveal after the batch finishes (hidden again at next run start via setRunningUI).
    const availableCount = state.results.filter(
      (r) => r.status === "available",
    ).length;
    btnCopyAllAvailable.hidden = availableCount === 0;
    btnOpenCreateService.hidden = availableCount === 0;
    toast(
      state.stopped ? "Stopped early" : "Batch complete",
      state.stopped ? "info" : "success",
    );
    if (settingSound.checked && !state.stopped) {
      playChime();
    }
  }

  function playChime() {
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
      osc.start();
      osc.stop(ctx.currentTime + 0.5);
    } catch (e) {
      /* audio not available, ignore */
    }
  }

  btnStart.addEventListener("click", startRun);
  btnPause.addEventListener("click", () => {
    state.paused = true;
    btnPause.hidden = true;
    btnResume.hidden = false;
    btnResume.disabled = false;
    setStatusPill("paused");
  });
  btnResume.addEventListener("click", () => {
    state.paused = false;
    btnResume.hidden = true;
    btnPause.hidden = false;
    setStatusPill("running");
  });
  btnStop.addEventListener("click", () => {
    state.stopped = true;
    state.paused = false;
  });

  // =========================================================================
  // Hero stats (animated counters)
  // =========================================================================
  function animateCounter(el, to) {
    const from = parseInt(el.getAttribute("data-count") || "0", 10);
    const duration = 500;
    const start = performance.now();
    function step(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(from + (to - from) * eased);
      el.textContent = el.id === "statRateHero" ? val + "%" : String(val);
      if (t < 1) requestAnimationFrame(step);
      else el.setAttribute("data-count", String(to));
    }
    requestAnimationFrame(step);
  }

  function updateHeroStats() {
    const total = state.results.length;
    const available = state.results.filter(
      (r) => r.status === "available",
    ).length;
    const broken = state.results.filter((r) => r.status === "error").length;
    const rate = total ? Math.round((available / total) * 100) : 0;
    animateCounter($("#statTotalHero"), total);
    animateCounter($("#statAvailHero"), available);
    animateCounter($("#statBrokenHero"), broken);
    animateCounter($("#statRateHero"), rate);
  }

  // =========================================================================
  // Summary panel
  // =========================================================================
  function renderSummary() {
    const total = state.results.length;
    const available = state.results.filter(
      (r) => r.status === "available",
    ).length;
    const broken = total - available;
    const elapsedSec = (Date.now() - state.startTime) / 1000;
    const speed = total > 0 ? total / elapsedSec : 0;
    const rate = total ? Math.round((available / total) * 100) : 0;

    document.dispatchEvent(new CustomEvent("tikverify:resultsChanged"));

    $("#sTotal").textContent = total;
    $("#sAvailable").textContent = available;
    $("#sBroken").textContent = broken;
    $("#sDuplicates").textContent = state.duplicatesRemoved || 0;
    $("#sNoUrl").textContent = state.linesWithoutUrl || 0;
    $("#sTime").textContent = formatDuration(elapsedSec);
    $("#sSpeed").textContent = speed.toFixed(2) + "/s";
    $("#sRate").textContent = rate + "%";
    summaryPanel.hidden = false;
  }

  // =========================================================================
  // Results rendering, filters, search
  // =========================================================================
  const cardTemplate = $("#cardTemplate");
  // Maps a result object (by reference) to the DOM node already rendered for
  // it, so completed results are appended once and never rebuilt/reloaded.
  const cardNodeMap = new Map();

  function formatStat(v) {
    if (v === null || v === undefined || v === "N/A") return "N/A";
    const n = Number(v);
    if (isNaN(n)) return String(v);
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
  }

  function matchesFilter(r) {
    switch (state.activeFilter) {
      case "available":
        return r.status === "available";
      case "broken":
        return r.status === "error";
      case "missing":
        return (
          r.status === "available" &&
          (r.views === "N/A" || r.likes === "N/A" || r.comments === "N/A")
        );
      default:
        return true;
    }
  }

  function matchesSearch(r) {
    if (!state.searchTerm) return true;
    const term = state.searchTerm.toLowerCase();
    return (
      (r.url || "").toLowerCase().includes(term) ||
      (r.title || "").toLowerCase().includes(term)
    );
  }

  function getVisibleResults() {
    let list = state.results.filter(
      (r) => matchesFilter(r) && matchesSearch(r),
    );
    if (state.activeFilter === "newest")
      list = list.slice().sort((a, b) => b.order - a.order);
    else if (state.activeFilter === "oldest")
      list = list.slice().sort((a, b) => a.order - b.order);
    else list = list.slice().sort((a, b) => a.order - b.order);
    return list;
  }

  // Builds (but does not insert) the DOM node for a single result. Reused by
  // both the full rebuild path and the incremental append path so a given
  // result's card, thumbnail, and animation are only ever created once.
  function buildCardNode(r) {
    const node = cardTemplate.content.cloneNode(true);
    const card = node.querySelector(".result-card");
    const img = node.querySelector(".card-thumb");
    const badge = node.querySelector(".status-badge");
    const title = node.querySelector(".card-title");
    const urlEl = node.querySelector(".card-url");
    const errorEl = node.querySelector(".card-error");
    const openBtn = node.querySelector(".card-open");
    const copyBtn = node.querySelector(".card-copy");

    img.src = r.thumbnail || "";
    img.alt = r.title || r.url;
    if (!r.thumbnail) img.classList.add("skeleton");

    if (r.status === "available") {
      const missing =
        r.views === "N/A" || r.likes === "N/A" || r.comments === "N/A";
      badge.textContent = missing ? "Missing Stats" : "Available";
      badge.classList.toggle("missing", missing);
    } else {
      badge.textContent = "Broken";
      badge.classList.add("broken");
    }

    title.textContent = r.title || r.url;
    urlEl.textContent = r.url;
    urlEl.href = r.url;
    openBtn.href = r.url;

    card.querySelector(".views b").textContent = formatStat(r.views);
    card.querySelector(".likes b").textContent = formatStat(r.likes);
    card.querySelector(".comments b").textContent = formatStat(r.comments);

    if (r.error) {
      errorEl.textContent = r.error;
    } else {
      errorEl.remove();
    }

    copyBtn.addEventListener("click", () => copyText(r.url, "URL copied"));

    cardNodeMap.set(r, card);
    return card;
  }

  // Full rebuild: used only when the visible set can change for reasons
  // other than "a new result was appended" (filter chip, search, new run).
  // Reuses already-built card nodes where possible so existing thumbnails
  // and cards are never recreated or re-animated even on a full rebuild.
  function renderResults() {
    const visible = getVisibleResults();
    emptyState.hidden = visible.length > 0;

    const frag = document.createDocumentFragment();
    visible.forEach((r) => {
      const node = cardNodeMap.get(r) || buildCardNode(r);
      frag.appendChild(node);
    });
    resultsGrid.replaceChildren(frag);
  }

  // Incremental update: called once per newly completed result while a run
  // is in progress. Never touches existing cards — only builds and inserts
  // the one new card, in the correct position for the active sort/filter.
  function appendResultCard(r) {
    if (!matchesFilter(r) || !matchesSearch(r)) return;

    const node = buildCardNode(r);
    if (state.activeFilter === "newest") {
      resultsGrid.prepend(node);
    } else {
      resultsGrid.appendChild(node);
    }
    // Only flip empty state once a card has actually been inserted; a
    // non-matching result must not hide the "no results" placeholder.
    emptyState.hidden = true;
  }

  $("#filterChips").addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    $$(".chip").forEach((c) => c.classList.remove("active"));
    chip.classList.add("active");
    state.activeFilter = chip.getAttribute("data-filter");
    renderResults();
  });

  $$(".vtab").forEach((tab) => {
    tab.addEventListener("click", () => {
      $$(".vtab").forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");
      state.activeView = tab.getAttribute("data-view");
      resultsGrid.classList.toggle(
        "gallery-view",
        state.activeView === "gallery",
      );
      resultsGrid.classList.toggle("cards-view", state.activeView === "cards");
    });
  });

  function bindSearch(input) {
    input.addEventListener("input", () => {
      state.searchTerm = input.value.trim();
      renderResults();
    });
  }
  bindSearch($("#resultsSearch"));
  bindSearch($("#topSearch"));

  // =========================================================================
  // Copy / export
  // =========================================================================
  function copyText(text, successMsg) {
    navigator.clipboard.writeText(text).then(
      () => toast(successMsg, "success"),
      () => toast("Copy failed", "error"),
    );
  }

  function downloadBlob(content, filename, mime) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const btnCopyAllAvailable = $("#btnCopyAllAvailable");

  btnCopyAllAvailable.addEventListener("click", () => {
    const list = state.results
      .filter((r) => r.status === "available")
      .map((r) => r.url);
    if (!list.length) return toast("No available links", "error");
    copyText(
      list.join("\n"),
      list.length + " available links copied to clipboard.",
    );
  });

  $("#btnCopyAvailable").addEventListener("click", () => {
    const list = state.results
      .filter((r) => r.status === "available")
      .map((r) => r.url);
    if (!list.length) return toast("No available links yet", "error");
    copyText(list.join("\n"), list.length + " available links copied");
  });

  $("#btnCopyBroken").addEventListener("click", () => {
    const list = state.results
      .filter((r) => r.status === "error")
      .map((r) => r.url);
    if (!list.length) return toast("No broken links yet", "error");
    copyText(list.join("\n"), list.length + " broken links copied");
  });

  $("#btnDownloadTxt").addEventListener("click", () => {
    const lines = state.results.map(
      (r) =>
        r.url + "\t" + r.status.toUpperCase() + (r.error ? "\t" + r.error : ""),
    );
    downloadBlob(lines.join("\n"), "tikverify-results.txt", "text/plain");
  });

  $("#btnDownloadCsv").addEventListener("click", () => {
    const header = [
      "URL",
      "Status",
      "Title",
      "Views",
      "Likes",
      "Comments",
      "Error",
    ];
    const rows = state.results.map((r) => [
      r.url,
      r.status,
      r.title || "",
      r.views ?? "",
      r.likes ?? "",
      r.comments ?? "",
      r.error || "",
    ]);
    const csv = [header]
      .concat(rows)
      .map((row) =>
        row
          .map((cell) => '"' + String(cell).replace(/"/g, '""') + '"')
          .join(","),
      )
      .join("\n");
    downloadBlob(csv, "tikverify-results.csv", "text/csv");
  });

  $("#btnDownloadJson").addEventListener("click", () => {
    downloadBlob(
      JSON.stringify(state.results, null, 2),
      "tikverify-results.json",
      "application/json",
    );
  });

  $("#btnExportHtml").addEventListener("click", () => {
    const rows = state.results
      .map((r) => {
        const thumb = r.thumbnail ? escapeHtml(r.thumbnail) : "";
        const imgTag = thumb
          ? `<img src="${thumb}" style="width:50px;height:66px;object-fit:cover;border-radius:6px" onerror="this.style.display='none'" alt="">`
          : "";
        const safeUrl = escapeHtml(r.url);
        return `<tr>
        <td>${imgTag}</td>
        <td>${escapeHtml(r.title || "")}</td>
        <td><a href="${safeUrl}">${safeUrl}</a></td>
        <td>${escapeHtml(formatStat(r.views))}</td>
        <td>${escapeHtml(formatStat(r.likes))}</td>
        <td>${escapeHtml(formatStat(r.comments))}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`;
      })
      .join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>TikVerify Report</title>
      <style>body{font-family:sans-serif;padding:24px;background:#0a0b12;color:#eef0f8}
      table{width:100%;border-collapse:collapse}th,td{padding:10px;border-bottom:1px solid #2a2c3c;text-align:left;font-size:13px}
      th{color:#9aa0b4;text-transform:uppercase;font-size:11px}</style></head>
      <body><h1>TikVerify Report</h1><p>${escapeHtml(String(state.results.length))} links checked</p>
      <table><thead><tr><th>Thumb</th><th>Title</th><th>URL</th><th>Views</th><th>Likes</th><th>Comments</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`;
    downloadBlob(html, "tikverify-report.html", "text/html");
  });

  $("#btnExportPdf").addEventListener("click", () => {
    const w = window.open("", "_blank");
    if (!w) {
      toast("Pop-up blocked. Allow pop-ups to export PDF.", "error");
      return;
    }
    const rows = state.results
      .map((r) => {
        const safeUrl = escapeHtml(r.url);
        return `<tr>
        <td>${escapeHtml(r.title || "")}</td>
        <td><a href="${safeUrl}">${safeUrl}</a></td>
        <td>${escapeHtml(formatStat(r.views))}</td>
        <td>${escapeHtml(formatStat(r.likes))}</td>
        <td>${escapeHtml(formatStat(r.comments))}</td>
        <td>${escapeHtml(r.status)}</td>
      </tr>`;
      })
      .join("");
    const checkedOn = escapeHtml(new Date().toLocaleString());
    const count = escapeHtml(String(state.results.length));
    w.document.write(`<!DOCTYPE html><html><head><title>TikVerify Report</title>
      <style>body{font-family:Arial,sans-serif;padding:24px;color:#111}
      table{width:100%;border-collapse:collapse}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left;font-size:12px}</style>
      </head><body><h1>TikVerify Report</h1><p>${count} links checked on ${checkedOn}</p>
      <table><thead><tr><th>Title</th><th>URL</th><th>Views</th><th>Likes</th><th>Comments</th><th>Status</th></tr></thead>
      <tbody>${rows}</tbody></table></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  });

  function escapeHtml(str) {
    return String(str).replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  }

  // =========================================================================
  // Create Service — SMM panel bulk order list generator
  // Price Per 1000 is entered directly in BDT — no currency conversion.
  // =========================================================================
  (function () {
    const CS_STORAGE_KEY = "tikverify_service_history";

    let csMode = "fixed"; // 'fixed' | 'random'
    let csHistory = []; // [{ id: string, price: string }, …]

    // -- DOM refs --------------------------------------------------------
    const csServiceId = $("#csServiceId");
    const csPricePer1k = $("#csPricePer1k");
    const csQtyFixed = $("#csQtyFixed");
    const csQtyMin = $("#csQtyMin");
    const csQtyMax = $("#csQtyMax");
    const csFixedBlock = $("#csFixedBlock");
    const csRandomBlock = $("#csRandomBlock");

    csFixedBlock.style.display = csMode === "fixed" ? "block" : "none";
    csRandomBlock.style.display = csMode === "random" ? "grid" : "none";

    const csHistoryPanel = $("#csHistoryPanel");
    const csHistoryList = $("#csHistoryList");
    const csHistoryEmpty = $("#csHistoryEmpty");
    const csSummary = $("#csSummary");
    const csOutputSection = $("#csOutputSection");
    const csOutput = $("#csOutput");
    const csBtnCopyOutput = $("#csBtnCopyOutput");
    const csBtnDownloadOutput = $("#csBtnDownloadOutput");
    const csUrlCount = $("#csUrlCount");
    const csOutputLines = $("#csOutputLines");

    // -- History helpers -------------------------------------------------
    function csLoad() {
      try {
        csHistory = JSON.parse(localStorage.getItem(CS_STORAGE_KEY) || "[]");
      } catch {
        csHistory = [];
      }
      if (!Array.isArray(csHistory)) csHistory = [];
    }

    function csPersist() {
      localStorage.setItem(CS_STORAGE_KEY, JSON.stringify(csHistory));
    }

    // Insert / update an entry and move it to front (most-recently used).
    function csUpsert(id, price) {
      const idx = csHistory.findIndex((h) => h.id === id);
      if (idx >= 0) csHistory.splice(idx, 1);
      csHistory.unshift({ id, price });
      if (csHistory.length > 50) csHistory.pop();
      csPersist();
      csRenderHistory();
    }

    function csDelete(id) {
      csHistory = csHistory.filter((h) => h.id !== id);
      csPersist();
      csRenderHistory();
    }

    function csRenderHistory() {
      csHistoryList.innerHTML = "";
      csHistoryEmpty.hidden = csHistory.length > 0;

      csHistory.forEach((item) => {
        const row = document.createElement("div");
        row.className = "cs-history-item";

        row.innerHTML =
          '<span class="cs-hi-content">' +
          '<span class="cs-hi-id">' +
          escapeHtml(item.id) +
          "</span>" +
          (item.price
            ? '<span class="cs-hi-arrow">→</span>' +
              '<span class="cs-hi-price">' +
              escapeHtml(item.price) +
              " BDT/1k</span>"
            : "") +
          "</span>" +
          '<span class="cs-hi-actions">' +
          '<button class="cs-hi-btn cs-hi-edit" title="Edit">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>' +
          "</button>" +
          '<button class="cs-hi-btn cs-hi-del" title="Delete">' +
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>' +
          "</button>" +
          "</span>";

        // Select item → fill fields
        row.querySelector(".cs-hi-content").addEventListener("click", () => {
          csServiceId.value = item.id;
          if (item.price) csPricePer1k.value = item.price;
          csHistoryPanel.hidden = true;
          csUpdateSummary();
        });

        // Edit → inline form
        row.querySelector(".cs-hi-edit").addEventListener("click", (e) => {
          e.stopPropagation();
          csShowEditForm(row, item);
        });

        // Delete
        row.querySelector(".cs-hi-del").addEventListener("click", (e) => {
          e.stopPropagation();
          csDelete(item.id);
        });

        csHistoryList.appendChild(row);
      });
    }

    function csShowEditForm(row, item) {
      row.innerHTML =
        '<div class="cs-hi-edit-form">' +
        '<input class="cs-input" type="number" value="' +
        escapeHtml(item.id) +
        '" placeholder="Service ID" min="1" style="max-width:110px">' +
        '<input class="cs-input" type="number" value="' +
        escapeHtml(item.price || "") +
        '" placeholder="Price/1k" step="0.01" min="0" style="max-width:100px">' +
        '<button class="cs-hi-btn cs-hi-save" title="Save">✓</button>' +
        '<button class="cs-hi-btn cs-hi-cancel" title="Cancel">✕</button>' +
        "</div>";

      const idInput = row.querySelector('input[placeholder="Service ID"]');
      const priceInput = row.querySelector('input[placeholder="Price/1k"]');

      row.querySelector(".cs-hi-save").addEventListener("click", () => {
        const newId = idInput.value.trim();
        if (!newId) return;
        csHistory = csHistory.filter((h) => h.id !== item.id);
        csHistory.unshift({ id: newId, price: priceInput.value.trim() });
        csPersist();
        csRenderHistory();
      });
      row
        .querySelector(".cs-hi-cancel")
        .addEventListener("click", () => csRenderHistory());
    }

    // -- Parsing helpers ------------------------------------------------
    // Source of truth: verified AVAILABLE links from the main checker's results — never re-pasted.
    function csGetUrls() {
      return state.results
        .filter((r) => r.status === "available")
        .map((r) => r.url);
    }

    function csRandomInt(min, max) {
      return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    function csGetQtys(urlCount) {
      if (csMode === "fixed") {
        const q = parseInt(csQtyFixed.value, 10);
        return q > 0 ? Array(urlCount).fill(q) : null;
      }
      const min = parseInt(csQtyMin.value, 10);
      const max = parseInt(csQtyMax.value, 10);
      if (!(min > 0) || !(max > 0) || min > max) return null;
      return Array.from({ length: urlCount }, () => csRandomInt(min, max));
    }

    // -- Live summary ---------------------------------------------------
    function csUpdateSummary() {
      const urls = csGetUrls();
      const count = urls.length;
      const price = parseFloat(csPricePer1k.value) || 0;

      csUrlCount.textContent =
        count > 0
          ? "(" + count + " available)"
          : "(none yet — run the checker first)";

      if (count === 0) {
        csSummary.hidden = true;
        return;
      }
      csSummary.hidden = false;

      const outputLines = csOutputSection.hidden
        ? []
        : csOutput.value.split("\n").filter(Boolean);
      const generated = outputLines.length;
      const totalQty = outputLines.reduce(
        (s, line) => s + (parseInt(line.split("|")[2], 10) || 0),
        0,
      );
      const hasCost = price > 0 && totalQty > 0;
      const totalBdt = hasCost ? (totalQty / 1000) * price : 0;

      $("#csSumVideos").textContent = count.toLocaleString();
      $("#csSumOrders").textContent =
        generated > 0 ? generated.toLocaleString() : "—";
      $("#csSumQty").textContent =
        totalQty > 0 ? totalQty.toLocaleString() : "—";
      $("#csSumMode").textContent = csMode === "fixed" ? "Fixed" : "Random";
      $("#csSumPrice").textContent =
        price > 0 ? price.toFixed(2) + " BDT" : "—";

      $("#csSumBdt").textContent = hasCost
        ? "\u09F3" +
          totalBdt.toLocaleString("en-US", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })
        : "৳—";
    }

    // -- Generate -------------------------------------------------------
    function csGenerate() {
      const serviceId = csServiceId.value.trim();
      const urls = csGetUrls();

      if (!serviceId) {
        toast("Enter a Service ID", "error");
        return;
      }
      if (!urls.length) {
        toast("No AVAILABLE videos yet — run the checker first", "error");
        return;
      }

      const qtys = csGetQtys(urls.length);
      if (!qtys) {
        toast(
          csMode === "fixed"
            ? "Enter a quantity"
            : "Enter a valid min/max quantity range",
          "error",
        );
        return;
      }

      const lines = urls.map((url, i) => serviceId + "|" + url + "|" + qtys[i]);

      csOutput.value = lines.join("\n");
      csOutputSection.hidden = false;
      csOutputLines.textContent =
        "(" + lines.length + " line" + (lines.length !== 1 ? "s" : "") + ")";
      csBtnCopyOutput.hidden = false;
      csBtnDownloadOutput.hidden = false;

      // Save to history (price optional)
      csUpsert(serviceId, csPricePer1k.value.trim());

      csUpdateSummary();
      toast(
        "Generated " + lines.length + " line" + (lines.length !== 1 ? "s" : ""),
        "success",
      );
      csOutputSection.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // -- Wire up events ------------------------------------------------
    csLoad();
    csRenderHistory();

    // History toggle
    $("#csHistoryToggle").addEventListener("click", (e) => {
      e.stopPropagation();
      csHistoryPanel.hidden = !csHistoryPanel.hidden;
    });
    document.addEventListener("click", (e) => {
      if (
        !e.target.closest("#csHistoryToggle") &&
        !e.target.closest("#csHistoryPanel")
      ) {
        csHistoryPanel.hidden = true;
      }
    });

    // Clear all history
    $("#csClearHistory").addEventListener("click", () => {
      csHistory = [];
      csPersist();
      csRenderHistory();
    });

    // Mode toggle (Fixed / Random)
    $$(".cs-mode-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".cs-mode-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        csMode = btn.dataset.mode;

        csFixedBlock.style.display = csMode === "fixed" ? "block" : "none";
        csRandomBlock.style.display = csMode === "random" ? "grid" : "none";

        csUpdateSummary();
      });
    });

    // Live summary on any input change
    [csServiceId, csPricePer1k, csQtyFixed, csQtyMin, csQtyMax].forEach(
      (el) => {
        el.addEventListener("input", csUpdateSummary);
      },
    );

    // Generate
    $("#csBtnGenerate").addEventListener("click", csGenerate);

    // Copy output
    csBtnCopyOutput.addEventListener("click", () => {
      copyText(csOutput.value, "Output copied to clipboard");
    });

    // Download output as TXT
    csBtnDownloadOutput.addEventListener("click", () => {
      downloadBlob(csOutput.value, "tikverify-orders.txt", "text/plain");
    });

    // Clear / reset
    $("#csBtnClear").addEventListener("click", () => {
      csServiceId.value = "";
      csPricePer1k.value = "";
      csQtyFixed.value = "";
      csQtyMin.value = "";
      csQtyMax.value = "";
      csOutput.value = "";
      csOutputSection.hidden = true;
      csBtnCopyOutput.hidden = true;
      csBtnDownloadOutput.hidden = true;
      csSummary.hidden = true;
      csUrlCount.textContent = "";
      csHistoryPanel.hidden = true;
      csMode = "fixed";
      $$(".cs-mode-btn").forEach((b) =>
        b.classList.toggle("active", b.dataset.mode === "fixed"),
      );
      csFixedBlock.style.display = "block";
      csRandomBlock.style.display = "none";
    });

    // Keep the "Available Videos" count in sync as the checker runs / results change.
    document.addEventListener("tikverify:resultsChanged", csUpdateSummary);
  })();
})();

==============================================================================
FILE: public/explorer.html
==============================================================================
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>TikTok Explorer</title>

    <!-- ════════════ STYLES ════════════ -->
    <style>
        /* ── Reset & Base ─────────────────────────── */
        *,
        *::before,
        *::after {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }

        :root {
            --bg:        #0a0e1a;
            --surface:   rgba(255, 255, 255, 0.05);
            --border:    rgba(255, 255, 255, 0.08);
            --border-hi: rgba(255, 255, 255, 0.15);
            --text:      #e2e8f0;
            --muted:     #64748b;
            --accent:    #6366f1;
            --accent2:   #818cf8;
            --blue:      #3b82f6;
            --green:     #10b981;
            --red:       #ef4444;
            --radius:    12px;
            --shadow:    0 8px 32px rgba(0, 0, 0, 0.4);
        }

        html {
            scroll-behavior: smooth;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--bg);
            color: var(--text);
            min-height: 100vh;
            line-height: 1.5;
        }

        /* ── Scrollbar ───────────────────────────── */
        ::-webkit-scrollbar {
            width: 6px;
        }

        ::-webkit-scrollbar-track {
            background: transparent;
        }

        ::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, 0.15);
            border-radius: 3px;
        }

        /* ── Glass card ──────────────────────────── */
        .glass {
            background: var(--surface);
            border: 1px solid var(--border);
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border-radius: var(--radius);
        }

        /* ── Hero / Search ───────────────────────── */
        #hero {
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            padding: 2rem;
            background: radial-gradient(ellipse 80% 60% at 50% 0%, rgba(99, 102, 241, 0.12) 0%, transparent 70%);
        }

        #hero h1 {
            font-size: clamp(2.5rem, 8vw, 5rem);
            font-weight: 800;
            letter-spacing: -2px;
            margin-bottom: 1rem;
            text-align: center;
        }

        #hero h1 span {
            color: var(--accent2);
        }

        #hero p {
            color: var(--muted);
            font-size: 1.1rem;
            text-align: center;
            max-width: 520px;
            margin-bottom: 2.5rem;
            font-family: 'Courier New', monospace;
        }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            background: rgba(99, 102, 241, .12);
            border: 1px solid rgba(99, 102, 241, .3);
            color: var(--accent2);
            font-size: .75rem;
            font-weight: 600;
            letter-spacing: .05em;
            text-transform: uppercase;
            padding: .3rem .8rem;
            border-radius: 999px;
            margin-bottom: 1.5rem;
        }

        /* ── Search form ─────────────────────────── */
        #search-form {
            display: flex;
            gap: 0;
            width: 100%;
            max-width: 700px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: var(--radius);
            overflow: hidden;
            transition: border-color .2s;
        }

        #search-form:focus-within {
            border-color: rgba(99, 102, 241, .6);
        }

        #search-input {
            flex: 1;
            background: transparent;
            border: none;
            outline: none;
            padding: 1rem 1.2rem;
            color: var(--text);
            font-size: 1rem;
        }

        #search-input::placeholder {
            color: var(--muted);
        }

        #count-select {
            background: rgba(255, 255, 255, 0.06);
            border: none;
            border-left: 1px solid rgba(255, 255, 255, 0.08);
            border-right: 1px solid rgba(255, 255, 255, 0.08);
            color: var(--text);
            padding: 0 .75rem;
            font-size: .875rem;
            outline: none;
            width: 90px;
            text-align: center;
        }

        #count-select::-webkit-inner-spin-button,
        #count-select::-webkit-outer-spin-button {
            opacity: .5;
        }

        #count-select::placeholder {
            color: var(--muted);
        }

        #search-btn {
            background: var(--accent);
            border: none;
            color: #fff;
            font-size: .95rem;
            font-weight: 600;
            padding: 0 1.5rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: .5rem;
            transition: background .2s;
            white-space: nowrap;
        }

        #search-btn:hover {
            background: #4f52d8;
        }

        #search-btn:disabled {
            opacity: .6;
            cursor: not-allowed;
        }

        /* ── Search form mobile fix ──────────────── */
        @media (max-width: 600px) {
            #search-form {
                flex-direction: column;
                overflow: visible;
                background: transparent;
                border: none;
                gap: .5rem;
            }

            #search-input {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.12);
                border-radius: var(--radius);
                padding: .9rem 1.1rem;
                font-size: .95rem;
                transition: border-color .2s;
            }

            #search-form:focus-within #search-input {
                border-color: rgba(99, 102, 241, .6);
            }

            #count-select {
                background: rgba(255, 255, 255, 0.05);
                border: 1px solid rgba(255, 255, 255, 0.12) !important;
                border-radius: var(--radius);
                padding: .75rem 1rem;
                width: 100%;
                font-size: .875rem;
            }

            #search-btn {
                border-radius: var(--radius);
                padding: .85rem 1.5rem;
                justify-content: center;
                font-size: 1rem;
            }
        }

        /* ── Search History Dropdown ──────────────── */
        .search-history-dropdown {
            position: absolute;
            top: 100%;
            left: 0;
            right: 0;
            z-index: 50;
            background: rgba(20, 24, 44, 0.95);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid var(--border);
            border-radius: 0 0 var(--radius) var(--radius);
            margin-top: 4px;
            max-height: 280px;
            overflow-y: auto;
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.6);
        }

        .search-history-dropdown.hidden {
            display: none;
        }

        .history-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: .65rem 1rem;
            font-size: .9rem;
            cursor: pointer;
            transition: background .15s;
            border-bottom: 1px solid rgba(255, 255, 255, 0.05);
        }

        .history-item:last-child {
            border-bottom: none;
        }

        .history-item:hover {
            background: rgba(255, 255, 255, 0.06);
        }

        .history-item-username {
            flex: 1;
            color: var(--text);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }

        .history-item-delete {
            background: none;
            border: none;
            color: var(--muted);
            cursor: pointer;
            font-size: 1.1rem;
            line-height: 1;
            padding: 0 0 0 .75rem;
            transition: color .15s;
        }

        .history-item-delete:hover {
            color: #fca5a5;
        }

        .history-clear {
            text-align: center;
            padding: .55rem 1rem;
            font-size: .8rem;
            color: var(--muted);
            cursor: pointer;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            transition: color .15s;
        }

        .history-clear:hover {
            color: var(--text);
        }

        /* ── Mini search wrap (for history dropdown) */
        .mini-search-wrap {
            flex: 1;
            min-width: 200px;
            position: relative;
        }

        .mini-search-wrap .search-history-dropdown {
            top: calc(100% + 4px);
            border-radius: var(--radius);
        }

        /* ── Error banner ─────────────────────────── */
        .error-banner {
            background: rgba(239, 68, 68, .1);
            border: 1px solid rgba(239, 68, 68, .3);
            border-radius: var(--radius);
            padding: 1rem 1.5rem;
            color: #fca5a5;
            text-align: center;
            max-width: 600px;
            margin: 1rem auto;
        }

        .error-banner button {
            background: rgba(239, 68, 68, .2);
            border: 1px solid rgba(239, 68, 68, .4);
            color: #fca5a5;
            padding: .4rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            margin-top: .6rem;
            font-size: .875rem;
        }

        /* ── Dashboard ────────────────────────────── */
        #dashboard {
            display: none;
            padding: 1.5rem;
            max-width: 1400px;
            margin: 0 auto;
        }

        /* ── Navbar ───────────────────────────────── */
        #topbar {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-bottom: 1.5rem;
            flex-wrap: wrap;
        }

        #topbar .brand {
            font-size: 1.1rem;
            font-weight: 700;
            letter-spacing: -0.5px;
        }

        #topbar .brand span {
            color: var(--accent2);
        }

        #mini-search {
            width: 100%;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: .5rem .9rem;
            color: var(--text);
            font-size: .875rem;
            outline: none;
        }

        #mini-search:focus {
            border-color: rgba(99, 102, 241, .5);
        }

        #back-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--muted);
            padding: .5rem 1rem;
            border-radius: 8px;
            cursor: pointer;
            font-size: .875rem;
            transition: all .2s;
        }

        #back-btn:hover {
            border-color: var(--border-hi);
            color: var(--text);
        }

        /* ── Profile header ──────────────────────── */
        #profile-header {
            padding: 1.5rem;
            margin-bottom: 1.5rem;
            display: flex;
            gap: 1.5rem;
            align-items: flex-start;
            flex-wrap: wrap;
        }

        #profile-header img {
            width: 80px;
            height: 80px;
            border-radius: 50%;
            object-fit: cover;
            border: 2px solid var(--border-hi);
            flex-shrink: 0;
        }

        .profile-info {
            flex: 1;
            min-width: 200px;
        }

        .profile-name {
            display: flex;
            align-items: center;
            gap: .5rem;
            font-size: 1.4rem;
            font-weight: 700;
            margin-bottom: .2rem;
        }

        .verified-badge {
            background: var(--blue);
            color: #fff;
            font-size: .6rem;
            padding: .2rem .4rem;
            border-radius: 4px;
            font-weight: 700;
            letter-spacing: .05em;
        }

        .profile-handle {
            color: var(--muted);
            font-size: .9rem;
            margin-bottom: .6rem;
        }

        .profile-bio {
            font-size: .875rem;
            color: #94a3b8;
            max-width: 500px;
            margin-bottom: .8rem;
        }

        .profile-stats {
            display: flex;
            gap: 1.5rem;
            flex-wrap: wrap;
        }

        .stat {
            text-align: center;
        }

        .stat-num {
            font-size: 1.1rem;
            font-weight: 700;
        }

        .stat-label {
            font-size: .7rem;
            color: var(--muted);
            text-transform: uppercase;
            letter-spacing: .06em;
        }

        .profile-actions {
            display: flex;
            gap: .5rem;
            flex-wrap: wrap;
            align-items: flex-start;
        }

        .btn {
            display: inline-flex;
            align-items: center;
            gap: .4rem;
            padding: .5rem 1rem;
            border-radius: 8px;
            font-size: .8rem;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all .15s;
            text-decoration: none;
        }

        .btn-ghost {
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text);
        }

        .btn-ghost:hover {
            border-color: var(--border-hi);
            background: rgba(255, 255, 255, .08);
        }

        .btn-accent {
            background: var(--accent);
            color: #fff;
        }

        .btn-accent:hover {
            background: #4f52d8;
        }

        .btn-green {
            background: rgba(16, 185, 129, .15);
            border: 1px solid rgba(16, 185, 129, .3);
            color: #6ee7b7;
        }

        .btn-green:hover {
            background: rgba(16, 185, 129, .25);
        }

        /* ── Controls bar ────────────────────────── */
        #controls {
            display: flex;
            gap: .75rem;
            align-items: center;
            margin-bottom: 1.25rem;
            flex-wrap: wrap;
        }

        #filter-input {
            flex: 1;
            min-width: 180px;
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: .55rem 1rem;
            color: var(--text);
            font-size: .875rem;
            outline: none;
        }

        #filter-input:focus {
            border-color: rgba(99, 102, 241, .5);
        }

        #sort-select {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: .55rem .9rem;
            color: var(--text);
            font-size: .875rem;
            outline: none;
            cursor: pointer;
        }

        #sort-select option {
            background: #1e2235;
        }

        .count-badge {
            display: inline-flex;
            align-items: center;
            gap: .35rem;
            font-size: .8rem;
            font-weight: 700;
            white-space: nowrap;
            color: #fff;
            background: rgba(99, 102, 241, .18);
            border: 1px solid rgba(99, 102, 241, .35);
            padding: .3rem .75rem;
            border-radius: 999px;
            letter-spacing: .01em;
        }

        /* ── Bulk actions ────────────────────────── */
        #bulk-bar {
            display: none;
            align-items: center;
            gap: .75rem;
            padding: .75rem 1rem;
            margin-bottom: 1rem;
            background: rgba(99, 102, 241, .08);
            border: 1px solid rgba(99, 102, 241, .2);
            border-radius: 10px;
            flex-wrap: wrap;
        }

        #bulk-bar.visible {
            display: flex;
        }

        #bulk-count {
            font-size: .875rem;
            color: var(--accent2);
            font-weight: 600;
        }

        /* ── Selected Statistics Panel ────────────── */
        #selected-stats {
            display: none;
            padding: 1rem 1.25rem;
            margin-bottom: 1rem;
            flex-wrap: wrap;
            gap: 1rem;
        }

        #selected-stats.visible {
            display: flex;
            flex-wrap: wrap;
            align-items: flex-start;
        }

        .stats-summary {
            display: flex;
            flex-wrap: wrap;
            gap: 1.5rem;
            flex: 1;
            min-width: 0;
        }

        .stat-box {
            display: flex;
            flex-direction: column;
            gap: .15rem;
        }

        .stat-box-label {
            font-size: .65rem;
            text-transform: uppercase;
            letter-spacing: .07em;
            color: var(--muted);
        }

        .stat-box-value {
            font-size: 1.2rem;
            font-weight: 700;
            color: #fff;
            font-family: monospace;
        }

        .stats-expand-btn {
            background: transparent;
            border: 1px solid var(--border);
            color: var(--muted);
            padding: .4rem 1rem;
            border-radius: 6px;
            cursor: pointer;
            font-size: .8rem;
            transition: all .15s;
            white-space: nowrap;
        }

        .stats-expand-btn:hover {
            border-color: var(--border-hi);
            color: var(--text);
        }

        #stats-extra {
            width: 100%;
            display: none;
            margin-top: .75rem;
            gap: 1.2rem;
            flex-wrap: wrap;
            border-top: 1px solid var(--border);
            padding-top: .75rem;
        }

        #stats-extra.visible {
            display: flex;
        }

        .stats-extra-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
            gap: .75rem;
            width: 100%;
        }

        .extra-stat-row {
            display: flex;
            justify-content: space-between;
            gap: .5rem;
            font-size: .8rem;
            padding: .4rem 0;
            border-bottom: 1px solid rgba(255, 255, 255, 0.04);
        }

        .extra-stat-label {
            color: var(--muted);
        }

        .extra-stat-value {
            font-weight: 600;
            font-family: monospace;
        }

        /* ── Video grid ──────────────────────────── */
        #video-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 1rem;
        }

        @media (max-width: 1100px) {
            #video-grid {
                grid-template-columns: repeat(3, 1fr);
            }
        }

        @media (max-width: 760px) {
            #video-grid {
                grid-template-columns: repeat(3, 1fr);
                gap: .6rem;
            }
        }

        @media (max-width: 400px) {
            #video-grid {
                grid-template-columns: repeat(2, 1fr);
                gap: .5rem;
            }
        }

        /* ── Video card ──────────────────────────── */
        .video-card {
            border-radius: var(--radius);
            overflow: hidden;
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid var(--border);
            transition: transform .2s, border-color .2s, box-shadow .2s;
            cursor: pointer;
            position: relative;
        }

        .video-card:hover {
            transform: translateY(-3px);
            border-color: rgba(99, 102, 241, .4);
            box-shadow: 0 12px 40px rgba(99, 102, 241, .15);
        }

        .video-card.selected {
            border-color: var(--accent);
            background: rgba(99, 102, 241, .08);
        }

        .video-card.submitted {
            border-color: rgba(16, 185, 129, .35);
        }

        .thumb-wrap {
            position: relative;
            aspect-ratio: 9/16;
            background: #0f1424;
            overflow: hidden;
        }

        .thumb-wrap img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
            transition: transform .3s;
        }

        .video-card:hover .thumb-wrap img {
            transform: scale(1.04);
        }

        .thumb-placeholder {
            width: 100%;
            height: 100%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 2rem;
            color: var(--muted);
        }

        .duration-badge {
            position: absolute;
            bottom: .4rem;
            right: .4rem;
            background: rgba(0, 0, 0, .75);
            color: #fff;
            font-size: .7rem;
            font-weight: 600;
            padding: .15rem .45rem;
            border-radius: 4px;
        }

        .submitted-icon {
            position: absolute;
            top: .4rem;
            right: .4rem;
            background: rgba(16,185,129,.15);
            border: 1px solid rgba(16,185,129,.35);
            color: #6ee7b7;
            font-size: .65rem;
            font-weight: 700;
            padding: .1rem .4rem;
            border-radius: 4px;
            z-index: 3;
            letter-spacing: .02em;
        }

        .select-checkbox {
            position: absolute;
            top: .5rem;
            left: .5rem;
            width: 26px;
            height: 26px;
            border-radius: 6px;
            border: 2px solid rgba(255, 255, 255, .5);
            background: rgba(0, 0, 0, .4);
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            z-index: 2;
            transition: all .15s;
        }

        .video-card.selected .select-checkbox,
        .select-checkbox:hover {
            border-color: var(--accent);
            background: var(--accent);
        }

        .select-checkbox svg {
            display: none;
        }

        .video-card.selected .select-checkbox svg {
            display: block;
        }

        .card-body {
            padding: .75rem;
            cursor: default;
        }

        .card-desc {
            font-size: .78rem;
            color: var(--text);
            margin-bottom: .5rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            line-height: 1.4;
        }

        .card-tags {
            display: flex;
            flex-wrap: wrap;
            gap: .3rem;
            margin-bottom: .5rem;
        }

        .tag {
            font-size: .65rem;
            color: var(--accent2);
            background: rgba(99, 102, 241, .1);
            border: 1px solid rgba(99, 102, 241, .2);
            padding: .1rem .4rem;
            border-radius: 999px;
        }

        .card-stats {
            display: flex;
            gap: .75rem;
            flex-wrap: wrap;
            margin-bottom: .6rem;
        }

        .card-stat {
            font-size: .7rem;
            color: var(--muted);
            display: flex;
            align-items: center;
            gap: .25rem;
        }

        .card-stat svg {
            opacity: .7;
        }

        .card-date {
            font-size: .65rem;
            color: #475569;
            margin-bottom: .6rem;
        }

        .card-actions {
            display: flex;
            gap: .4rem;
            flex-wrap: wrap;
        }

        .card-btn {
            flex: 1;
            background: rgba(255, 255, 255, .05);
            border: 1px solid var(--border);
            color: var(--muted);
            padding: .35rem .5rem;
            border-radius: 6px;
            font-size: .65rem;
            cursor: pointer;
            text-align: center;
            transition: all .15s;
            white-space: nowrap;
        }

        .card-btn:hover {
            border-color: var(--border-hi);
            color: var(--text);
        }

        .card-btn a {
            color: inherit;
            text-decoration: none;
        }

        /* ── Skeleton loader ─────────────────────── */
        .skeleton {
            animation: shimmer 1.5s infinite;
        }

        @keyframes shimmer {
            0% {
                background-position: -400px 0;
            }
            100% {
                background-position: 400px 0;
            }
        }

        .skel-card {
            border-radius: var(--radius);
            overflow: hidden;
            border: 1px solid var(--border);
        }

        .skel-thumb {
            aspect-ratio: 9/16;
            background: linear-gradient(90deg, #1a1f35 25%, #222840 50%, #1a1f35 75%);
            background-size: 400px 100%;
            animation: shimmer 1.5s infinite;
        }

        .skel-body {
            padding: .75rem;
        }

        .skel-line {
            border-radius: 4px;
            margin-bottom: .5rem;
            background: linear-gradient(90deg, #1a1f35 25%, #222840 50%, #1a1f35 75%);
            background-size: 400px 100%;
            animation: shimmer 1.5s infinite;
        }

        /* ── Load more ───────────────────────────── */
        #load-more-wrap {
            text-align: center;
            padding: 2rem 0;
        }

        #load-more-btn {
            background: var(--surface);
            border: 1px solid var(--border);
            color: var(--text);
            padding: .75rem 2rem;
            border-radius: 10px;
            cursor: pointer;
            font-size: .9rem;
            transition: all .2s;
        }

        #load-more-btn:hover {
            border-color: var(--border-hi);
        }

        #load-more-btn:disabled {
            opacity: .5;
            cursor: not-allowed;
        }

        /* ── Video Detail Panel ──────────────────── */
        #vd-overlay {
            display: none;
            position: fixed;
            inset: 0;
            z-index: 9999;
            background: rgba(0, 0, 0, .88);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            align-items: center;
            justify-content: center;
            padding: .75rem;
        }

        #vd-overlay.open {
            display: flex;
        }

        #vd-panel {
            position: relative;
            width: 100%;
            max-width: 920px;
            max-height: 94vh;
            background: linear-gradient(145deg, #0f1428, #0a0e1a);
            border: 1px solid rgba(255, 255, 255, .1);
            border-radius: 20px;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            box-shadow: 0 40px 80px rgba(0, 0, 0, .7), 0 0 0 1px rgba(99, 102, 241, .1);
            animation: vd-in .28s cubic-bezier(.16, 1, .3, 1);
        }

        @keyframes vd-in {
            from {
                opacity: 0;
                transform: scale(.94) translateY(16px);
            }
            to {
                opacity: 1;
                transform: none;
            }
        }

        @media (min-width: 640px) {
            #vd-panel {
                flex-direction: row;
            }
        }

        #vd-left {
            flex-shrink: 0;
            position: relative;
            width: 100%;
            min-height: 240px;
            background: #000;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
        }

        @media (min-width: 640px) {
            #vd-left {
                width: 260px;
                min-height: 0;
            }
        }

        #vd-thumb-bg {
            position: absolute;
            inset: 0;
            background-size: cover;
            background-position: center;
            filter: blur(18px) brightness(.35);
            transform: scale(1.12);
        }

        #vd-thumb {
            position: relative;
            z-index: 1;
            max-width: 100%;
            max-height: 420px;
            object-fit: contain;
        }

        #vd-play-btn {
            position: absolute;
            inset: 0;
            z-index: 2;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity .2s;
            cursor: pointer;
        }

        #vd-left:hover #vd-play-btn,
        #vd-left:focus-within #vd-play-btn {
            opacity: 1;
        }

        #vd-play-icon {
            width: 56px;
            height: 56px;
            background: rgba(99, 102, 241, .9);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 0 40px rgba(99, 102, 241, .5);
            transform: scale(.9);
            transition: transform .2s;
        }

        #vd-left:hover #vd-play-icon {
            transform: scale(1);
        }

        #vd-right {
            flex: 1;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 1rem;
            padding: 1.25rem;
        }

        #vd-right::-webkit-scrollbar {
            width: 4px;
        }

        #vd-right::-webkit-scrollbar-thumb {
            background: rgba(255, 255, 255, .12);
            border-radius: 2px;
        }

        #vd-close {
            position: absolute;
            top: .7rem;
            right: .7rem;
            z-index: 20;
            width: 30px;
            height: 30px;
            background: rgba(0, 0, 0, .55);
            border: 1px solid rgba(255, 255, 255, .15);
            border-radius: 50%;
            color: #fff;
            font-size: .9rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background .15s;
        }

        #vd-close:hover {
            background: rgba(255, 255, 255, .1);
        }

        .vd-nav {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            z-index: 15;
            width: 34px;
            height: 34px;
            background: rgba(0, 0, 0, .55);
            border: 1px solid rgba(255, 255, 255, .15);
            border-radius: 50%;
            color: #fff;
            font-size: 1.4rem;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: all .15s;
            user-select: none;
            line-height: 1;
        }

        .vd-nav:hover {
            background: rgba(99, 102, 241, .5);
            border-color: rgba(99, 102, 241, .4);
        }

        #vd-prev {
            left: .6rem;
        }

        #vd-next {
            right: .6rem;
        }

        @media (min-width: 640px) {
            #vd-prev {
                left: -17px;
            }
            #vd-next {
                right: -17px;
            }
        }

        .vd-counter {
            font-size: .7rem;
            color: var(--muted);
            text-align: center;
            font-family: monospace;
        }

        .vd-meta-row {
            display: flex;
            gap: .75rem;
            flex-wrap: wrap;
            font-size: .75rem;
            color: var(--muted);
        }

        .vd-meta-item {
            display: flex;
            align-items: center;
            gap: .3rem;
        }

        .vd-stat-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: .5rem;
        }

        .vd-stat-box {
            background: rgba(255, 255, 255, .04);
            border: 1px solid rgba(255, 255, 255, .07);
            border-radius: 10px;
            padding: .65rem;
            display: flex;
            flex-direction: column;
            gap: .2rem;
        }

        .vd-stat-label {
            font-size: .6rem;
            text-transform: uppercase;
            letter-spacing: .07em;
            color: var(--muted);
            display: flex;
            align-items: center;
            gap: .3rem;
        }

        .vd-stat-val {
            font-size: 1.2rem;
            font-weight: 700;
            color: #fff;
            font-family: monospace;
        }

        .vd-section-title {
            font-size: .62rem;
            text-transform: uppercase;
            letter-spacing: .08em;
            color: var(--muted);
            margin-bottom: .4rem;
        }

        .vd-desc {
            font-size: .85rem;
            color: rgba(255, 255, 255, .85);
            line-height: 1.65;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .vd-tags {
            display: flex;
            flex-wrap: wrap;
            gap: .3rem;
            margin-top: .5rem;
        }

        .vd-tag {
            font-size: .68rem;
            color: var(--accent2);
            background: rgba(99, 102, 241, .1);
            border: 1px solid rgba(99, 102, 241, .2);
            padding: .15rem .55rem;
            border-radius: 999px;
        }

        .vd-actions {
            display: flex;
            gap: .5rem;
            margin-top: auto;
            padding-top: .5rem;
        }

        .vd-btn {
            flex: 1;
            padding: .6rem .5rem;
            border-radius: 10px;
            font-size: .8rem;
            font-weight: 600;
            cursor: pointer;
            border: none;
            transition: all .15s;
            text-align: center;
        }

        .vd-btn-primary {
            background: var(--accent);
            color: #fff;
        }

        .vd-btn-primary:hover {
            background: var(--accent2);
        }

        .vd-btn-ghost {
            background: rgba(255, 255, 255, .05);
            color: var(--text);
            border: 1px solid var(--border);
        }

        .vd-btn-ghost:hover {
            background: rgba(255, 255, 255, .1);
            border-color: var(--border-hi);
        }

        /* ── Toast ────────────────────────────────── */
        #toast {
            position: fixed;
            bottom: 1.5rem;
            right: 1.5rem;
            background: #1e2235;
            border: 1px solid var(--border-hi);
            color: var(--text);
            padding: .75rem 1.25rem;
            border-radius: 10px;
            font-size: .875rem;
            box-shadow: var(--shadow);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity .2s, transform .2s;
            pointer-events: none;
            z-index: 9998;
            max-width: 300px;
        }

        #toast.show {
            opacity: 1;
            transform: none;
        }

        /* ── Mobile: dashboard topbar ─────────────── */
        @media (max-width: 600px) {
            #topbar {
                gap: .5rem;
            }

            #topbar .brand {
                font-size: 1rem;
            }

            .mini-search-wrap {
                min-width: 0;
                flex: 1 1 100%;
                order: 2;
            }

            #topbar .btn {
                order: 3;
                flex: 1;
                justify-content: center;
                font-size: .8rem;
            }

            #back-btn {
                order: 4;
                flex: 1;
            }

            #topbar .brand {
                order: 1;
            }
        }

        /* ── Mobile: compact card body ────────────── */
        @media (max-width: 760px) {
            .card-body {
                padding: .45rem .4rem;
            }

            .card-desc {
                font-size: .7rem;
                -webkit-line-clamp: 2;
            }

            .card-stats {
                gap: .35rem;
                margin-bottom: .4rem;
            }

            .card-stat {
                font-size: .6rem;
            }

            .card-date {
                font-size: .58rem;
                margin-bottom: .4rem;
            }

            .card-actions {
                gap: .3rem;
            }

            .card-btn {
                padding: .28rem .3rem;
                font-size: .58rem;
            }

            .card-tags {
                gap: .2rem;
                margin-bottom: .35rem;
            }

            .tag {
                font-size: .58rem;
                padding: .08rem .3rem;
            }

            #dashboard {
                padding: .75rem .6rem;
            }

            #controls {
                gap: .5rem;
            }

            #filter-input,
            #sort-select {
                font-size: .8rem;
                padding: .45rem .7rem;
            }
        }

        /* ── Utility ───────────────────────────────── */
        .hidden {
            display: none !important;
        }

        .spinner {
            display: inline-block;
            width: 16px;
            height: 16px;
            border: 2px solid rgba(255, 255, 255, .3);
            border-top-color: #fff;
            border-radius: 50%;
            animation: spin .7s linear infinite;
        }

        @keyframes spin {
            to {
                transform: rotate(360deg);
            }
        }
    </style>
</head>
<body>

    <!-- ═══════════════ HERO ═══════════════ -->
    <div id="hero">
        <div class="badge">✦ Professional Analytics Engine</div>
        <h1>TikTok <span>Explorer</span></h1>
        <p>Enter a username or profile URL to deep-dive into video metrics, engagement, and metadata instantly.</p>

        <div style="position:relative; width:100%; max-width:700px;">
            <form id="search-form" onsubmit="return doSearch()">
                <input id="search-input" type="text" placeholder="Username or tiktok.com/@username..."
                       autocomplete="off" autocorrect="off" spellcheck="false">
                <input id="count-select" type="number" min="1" max="500" value="50"
                       placeholder="50" list="count-presets" title="Number of videos (1–500)">
                <datalist id="count-presets">
                    <option value="10">
                    <option value="20">
                    <option value="30">
                    <option value="50">
                    <option value="100">
                    <option value="200">
                    <option value="500">
                </datalist>
                <button type="submit" id="search-btn">
                    <span id="btn-text">Analyze</span>
                    <span>↵</span>
                </button>
            </form>
            <div id="history-dropdown" class="search-history-dropdown hidden"></div>
        </div>

        <div id="hero-error" class="error-banner hidden"></div>
    </div>

    <!-- ═══════════════ DASHBOARD ═══════════════ -->
    <div id="dashboard">
        <!-- Top bar -->
        <div id="topbar">
            <div class="brand">TikTok <span>Explorer</span></div>
            <div class="mini-search-wrap">
                <input id="mini-search" type="text" placeholder="Search another username…"
                       onkeydown="if(event.key==='Enter')doMiniSearch()">
                <div id="mini-history-dropdown" class="search-history-dropdown hidden"></div>
            </div>
            <button class="btn btn-ghost" onclick="doMiniSearch()">Analyze</button>
            <button id="back-btn" onclick="showHero()">← Back</button>
        </div>

        <!-- Profile -->
        <div id="profile-header" class="glass"></div>

        <!-- Controls -->
        <div id="controls">
            <input id="filter-input" type="text" placeholder="🔍 Filter by keyword or #hashtag…"
                   oninput="applyFilters()">
            <select id="sort-select" onchange="applyFilters()">
                <option value="newest">Newest first</option>
                <option value="oldest">Oldest first</option>
                <option value="views">Most views</option>
                <option value="likes">Most likes</option>
                <option value="comments">Most comments</option>
            </select>
            <label style="display:flex;align-items:center;gap:.4rem;font-size:.8rem;color:var(--muted);cursor:pointer">
                <input type="checkbox" id="select-all-chk" onchange="toggleSelectAll()">
                Select all
            </label>
            <button class="btn btn-ghost" onclick="selectAllSubmitted()">Select Submitted</button>
            <span class="count-badge" id="count-label"></span>
        </div>

        <!-- Bulk actions -->
        <div id="bulk-bar">
            <span id="bulk-count"></span>
            <button class="btn btn-ghost" onclick="openSelected()">Open in tabs</button>
            <button class="btn btn-accent" onclick="copySelectedLinks()">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:-.15em;margin-right:5px"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy Links
            </button>
            <button class="btn btn-ghost" onclick="markSelectedAsSubmitted()">Mark as Submitted</button>
            <button class="btn btn-ghost" onclick="unmarkSelectedSubmitted()">Unmark Submitted</button>
            <button class="btn btn-green" onclick="exportData('csv')">Export CSV</button>
            <button class="btn btn-green" onclick="exportData('json')">Export JSON</button>
            <button class="btn btn-ghost" onclick="clearSelection()" style="margin-left:auto">Clear</button>
        </div>

        <!-- Selected statistics panel -->
        <div id="selected-stats" class="glass">
            <div class="stats-summary" id="stats-summary"></div>
            <button class="stats-expand-btn" id="stats-expand-btn" onclick="toggleStatsMore()">More ▼</button>
            <div id="stats-extra"></div>
        </div>

        <!-- Grid -->
        <div id="video-grid"></div>

        <!-- Load more -->
        <div id="load-more-wrap" class="hidden">
            <button id="load-more-btn" onclick="loadMore()">Load more videos</button>
        </div>

        <!-- Dashboard error -->
        <div id="dash-error" class="error-banner hidden"></div>
    </div>

    <!-- ═══════════════ VIDEO DETAIL PANEL ═══════════════ -->
    <div id="vd-overlay" onclick="closeVideoDetail()">
        <div id="vd-panel" onclick="event.stopPropagation()">
            <button id="vd-close" onclick="closeVideoDetail()" title="Close (Esc)">✕</button>
            <button class="vd-nav" id="vd-prev" onclick="navVideo(-1)" title="Previous">‹</button>
            <button class="vd-nav" id="vd-next" onclick="navVideo(1)"  title="Next">›</button>

            <div id="vd-left">
                <div id="vd-thumb-bg"></div>
                <img id="vd-thumb" src="" alt="Thumbnail">
                <div id="vd-play-btn">
                    <div id="vd-play-icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                    </div>
                </div>
            </div>

            <div id="vd-right">
                <div id="vd-counter" class="vd-counter"></div>
                <div id="vd-meta"></div>
                <div id="vd-stats"></div>
                <div id="vd-desc-wrap"></div>
                <div id="vd-actions" class="vd-actions"></div>
            </div>
        </div>
    </div>

    <!-- ═══════════════ TOAST ═══════════════ -->
    <div id="toast"></div>

    <!-- ═══════════════ SCRIPTS ═══════════════ -->
    <script>
        // ──────────────────────────────────────────────
        //  STATE
        // ──────────────────────────────────────────────
        let allVideos      = [];
        let filtered       = [];
        let selected       = new Set();
        let currentUser    = '';
        let currentCount   = 50;
        let nextCursor     = null;
        let hasMore        = false;
        let loading        = false;
        let detailIndex    = -1;
        let statsMoreOpen  = false;
        let submitted      = new Set();   // persisted in localStorage

        // ── API key rotation ────────────────────────

        // ──────────────────────────────────────────────
        //  PERSISTENT SUBMITTED STATUS
        // ──────────────────────────────────────────────
        function loadSubmitted() {
            try {
                const raw = localStorage.getItem('tiktok_explorer_submitted');
                submitted = raw ? new Set(JSON.parse(raw)) : new Set();
            } catch (e) {
                submitted = new Set();
            }
        }
        function saveSubmitted() {
            localStorage.setItem('tiktok_explorer_submitted', JSON.stringify([...submitted]));
        }
        loadSubmitted();

        function markSelectedAsSubmitted() {
            if (selected.size === 0) { toast('Nothing selected'); return; }
            selected.forEach(id => submitted.add(id));
            saveSubmitted();
            renderGrid();
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
            toast(`Marked ${selected.size} as submitted`);
        }

        function unmarkSelectedSubmitted() {
            if (selected.size === 0) { toast('Nothing selected'); return; }
            selected.forEach(id => submitted.delete(id));
            saveSubmitted();
            renderGrid();
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
            toast(`Unmarked ${selected.size} as submitted`);
        }

        function selectAllSubmitted() {
            const submittedVids = filtered.filter(v => submitted.has(v.id));
            if (submittedVids.length === 0) {
                toast('No submitted videos found');
                return;
            }
            // Clear current selection and add all submitted
            selected = new Set(submittedVids.map(v => v.id));
            renderGrid();
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
            toast(`Selected ${submittedVids.length} submitted videos`);
        }

        // ──────────────────────────────────────────────
        //  UTILITY HELPERS
        // ──────────────────────────────────────────────
        const $ = id => document.getElementById(id);

        function fmt(n) {
            if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'K';
            return String(n);
        }

        function fmtDate(ts) {
            if (!ts) return '';
            return new Date(ts * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        }

        function fmtDur(s) {
            if (!s) return '';
            const m = Math.floor(s / 60);
            const sec = s % 60;
            return m + ':' + String(sec).padStart(2, '0');
        }

        function toast(msg, ms = 2500) {
            const t = $('toast');
            t.textContent = msg;
            t.classList.add('show');
            setTimeout(() => t.classList.remove('show'), ms);
        }

        function copyText(txt) {
            navigator.clipboard.writeText(txt).then(() => toast('Copied!')).catch(() => toast('Copy failed'));
        }

        function showHero() {
            $('dashboard').style.display = 'none';
            $('hero').style.display = 'flex';
        }

        // ──────────────────────────────────────────────
        //  SEARCH HISTORY (localStorage)
        // ──────────────────────────────────────────────
        const HISTORY_KEY = 'tiktok_explorer_history';
        const MAX_HISTORY = 25;

        function getHistory() {
            try {
                const raw = localStorage.getItem(HISTORY_KEY);
                return raw ? JSON.parse(raw) : [];
            } catch (e) {
                return [];
            }
        }

        function saveHistory(arr) {
            localStorage.setItem(HISTORY_KEY, JSON.stringify(arr));
        }

        function addToHistory(username) {
            let hist = getHistory();
            hist = hist.filter(u => u.toLowerCase() !== username.toLowerCase());
            hist.unshift(username);
            if (hist.length > MAX_HISTORY) hist = hist.slice(0, MAX_HISTORY);
            saveHistory(hist);
        }

        function removeHistoryItem(username) {
            let hist = getHistory().filter(u => u !== username);
            saveHistory(hist);
            renderHistoryDropdowns();
        }

        function clearAllHistory() {
            saveHistory([]);
            renderHistoryDropdowns();
            closeAllHistoryDropdowns();
        }

        function renderDropdown(container, hist, inputId) {
            if (!container) return;
            if (!hist.length) {
                container.innerHTML = '';
                container.classList.add('hidden');
                return;
            }
            const filterText = ($(inputId)?.value || '').trim().toLowerCase();
            let items = hist;
            if (filterText) {
                items = hist.filter(u => u.toLowerCase().includes(filterText));
            }
            if (!items.length) {
                container.innerHTML = '';
                container.classList.add('hidden');
                return;
            }
            let html = items.map(u => `
                <div class="history-item" data-username="${esc(u)}">
                    <span class="history-item-username" onclick="useHistoryItem('${esc(u)}','${inputId}')">${esc(u)}</span>
                    <button class="history-item-delete" onclick="event.stopPropagation();removeHistoryItem('${esc(u)}')" title="Remove">×</button>
                </div>
            `).join('');
            html += `<div class="history-clear" onclick="clearAllHistory()">Clear History</div>`;
            container.innerHTML = html;
            container.classList.remove('hidden');
        }

        function renderHistoryDropdowns() {
            const hist = getHistory();
            renderDropdown($('history-dropdown'), hist, 'search-input');
            renderDropdown($('mini-history-dropdown'), hist, 'mini-search');
        }

        function useHistoryItem(username, inputId) {
            $(inputId).value = username;
            if (inputId === 'mini-search') {
                doMiniSearch();
            } else {
                doSearch();
            }
            closeAllHistoryDropdowns();
        }

        function closeAllHistoryDropdowns() {
            document.querySelectorAll('.search-history-dropdown').forEach(d => d.classList.add('hidden'));
        }

        // ──────────────────────────────────────────────
        //  SEARCH FUNCTIONS
        // ──────────────────────────────────────────────
        function doSearch() {
            const val = $('search-input').value.trim();
            if (!val) return false;
            currentCount = parseInt($('count-select').value);
            startSearch(val);
            closeAllHistoryDropdowns();
            return false;
        }

        function doMiniSearch() {
            const val = $('mini-search').value.trim();
            if (!val) return;
            currentCount = 30;
            startSearch(val);
            closeAllHistoryDropdowns();
        }

        async function startSearch(rawUsername) {
            // Extract username from URL if needed
            let username = rawUsername.trim();
            const m = username.match(/tiktok\.com\/@([^\/\?#\s]+)/i);
            if (m) username = m[1];
            username = username.replace(/^@/, '');
            if (!username) return;

            addToHistory(username);
            renderHistoryDropdowns();

            currentUser  = username;
            allVideos    = [];
            selected.clear();
            nextCursor   = null;
            hasMore      = false;
            statsMoreOpen = false;
            updateSelectedStats();

            // Switch to dashboard view with skeletons
            $('hero').style.display = 'none';
            $('dashboard').style.display = 'block';
            $('profile-header').innerHTML = '';
            $('dash-error').classList.add('hidden');
            $('hero-error').classList.add('hidden');
            $('load-more-wrap').classList.add('hidden');
            $('mini-search').value = username;
            renderSkeletons(12);
            updateBulkBar();
            updateSelectAllCheckbox();

            // Fetch profile + first page of videos in parallel
            const [profResult, vidsResult] = await Promise.all([
                apiFetch('profile', { username }),
                apiFetch('videos',  { username, count: currentCount, cursor: 0 })
            ]);

            if (profResult.error) {
                showDashError(profResult.error);
                $('video-grid').innerHTML = '';
                updateSelectedStats();
                updateSelectAllCheckbox();
                return;
            }

            renderProfile(profResult);

            if (vidsResult.error) {
                showDashError(vidsResult.error);
                $('video-grid').innerHTML = '';
                updateSelectedStats();
                updateSelectAllCheckbox();
                return;
            }

            allVideos  = vidsResult.videos || [];
            nextCursor = vidsResult.cursor;
            hasMore    = vidsResult.hasMore;

            applyFilters();
            updateSelectedStats();

            if (hasMore && nextCursor) {
                $('load-more-wrap').classList.remove('hidden');
            }
        }

        async function loadMore() {
            if (loading || !hasMore || !nextCursor) return;
            loading = true;
            $('load-more-btn').disabled = true;
            $('load-more-btn').textContent = 'Loading…';

            const result = await apiFetch('videos', {
                username: currentUser,
                count: currentCount,
                cursor: nextCursor
            });

            loading = false;
            $('load-more-btn').disabled = false;
            $('load-more-btn').textContent = 'Load more videos';

            if (result.error) {
                toast('Error: ' + result.error);
                return;
            }

            allVideos  = allVideos.concat(result.videos || []);
            nextCursor = result.cursor;
            hasMore    = result.hasMore;
            applyFilters();
            updateSelectedStats();

            if (!hasMore || !nextCursor) $('load-more-wrap').classList.add('hidden');
        }

        // ──────────────────────────────────────────────
        //  API CLIENT
        // ──────────────────────────────────────────────
        function extractUsername(input) {
            input = input.trim();
            const m = input.match(/tiktok\.com\/@([^\/\?#\s]+)/i);
            return m ? m[1] : input.replace(/^@/, '');
        }

        async function rapidGet(path, params) {
            const qs = new URLSearchParams(params || {}).toString();
            const url = '/api/explorer' + path + (qs ? '?' + qs : '');
            try {
                const r = await fetch(url, {
                    headers: { 'Accept': 'application/json' }
                });
                let data;
                try { data = await r.json(); }
                catch (e) { return { error: 'Bad JSON from server (status ' + r.status + ')' }; }
                if (!r.ok) return data && data.error ? data : { error: 'API error ' + r.status };
                return data;
            } catch (e) {
                return { error: 'Network error: ' + e.message };
            }
        }

        function normalizeProfile(data, username) {
            if (data.error) return data;
            if ((data.code ?? 0) === -1 || data.msg === 'error') return { error: 'Profile not found or private account' };
            const inner  = data.data        || data.userInfo || {};
            const user   = inner.user       || data.user     || {};
            const stats  = inner.stats      || data.stats    || {};
            if (!user || !Object.keys(user).length) return { error: 'Profile not found' };
            return {
                id:         String(user.id || user.uid || ''),
                uniqueId:   user.uniqueId  || username,
                nickname:   user.nickname  || username,
                avatarUrl:  user.avatarLarger || user.avatarMedium || user.avatarThumb || '',
                bio:        user.signature || '',
                verified:   !!user.verified,
                followers:  parseInt(stats.followerCount  || 0, 10),
                following:  parseInt(stats.followingCount || 0, 10),
                likes:      parseInt(stats.heartCount || stats.heart || 0, 10),
                videoCount: parseInt(stats.videoCount || 0, 10),
                profileUrl: 'https://www.tiktok.com/@' + (user.uniqueId || username),
            };
        }

        function normalizeVideos(data, username) {
            if (data.error) return data;
            if ((data.code ?? 0) === -1) return { error: 'Profile not found or private account' };
            const inner     = data.data || data;
            const rawVideos = inner.videos || inner.aweme_list || data.videos || [];
            if (!Array.isArray(rawVideos)) return { error: 'Unexpected API response shape' };

            const videos = rawVideos.map(v => {
                let desc = '';
                if (v.title)           desc = v.title;
                else if (v.content_desc) desc = Array.isArray(v.content_desc) ? v.content_desc.join(' ') : v.content_desc;
                else if (v.desc)       desc = v.desc;

                const vm    = (v.video && typeof v.video === 'object') ? v.video : {};
                const thumb = v.cover || v.origin_cover || v.ai_dynamic_cover || vm.cover || vm.originCover || '';

                const st    = (v.stats && typeof v.stats === 'object') ? v.stats : {};
                const views    = parseInt(v.play_count    ?? st.playCount    ?? 0, 10);
                const likes    = parseInt(v.digg_count    ?? st.diggCount    ?? 0, 10);
                const comments = parseInt(v.comment_count ?? st.commentCount ?? 0, 10);
                const shares   = parseInt(v.share_count   ?? st.shareCount   ?? 0, 10);

                const hashtags = [];
                const tagMatches = desc.match(/#([\w\u00C0-\u024F]+)/gu) || [];
                tagMatches.forEach(t => hashtags.push(t.slice(1)));

                const vid       = String(v.aweme_id || v.video_id || v.id || '');
                const numericId = String(v.video_id || v.id || '');
                const shareUrl  = (v.share_url && typeof v.share_url === 'string') ? v.share_url.trim() : '';
                let videoUrl;
                if (shareUrl)                           videoUrl = shareUrl;
                else if (/^\d+$/.test(numericId))       videoUrl = 'https://www.tiktok.com/@' + username + '/video/' + numericId;
                else if (/^\d+$/.test(vid))             videoUrl = 'https://www.tiktok.com/@' + username + '/video/' + vid;
                else                                    videoUrl = 'https://www.tiktok.com/@' + username;

                return {
                    id: vid,
                    description: desc,
                    thumbnailUrl: thumb,
                    videoUrl,
                    views,
                    likes,
                    comments,
                    shares,
                    duration:   parseInt(v.duration ?? vm.duration ?? 0, 10),
                    uploadDate: parseInt(v.create_time ?? v.createTime ?? 0, 10),
                    hashtags,
                };
            });

            return {
                videos,
                cursor:  inner.cursor != null ? String(inner.cursor) : null,
                hasMore: !!(inner.hasMore ?? data.has_more ?? false),
                total:   videos.length,
            };
        }

        async function apiFetch(action, params) {
            const user = extractUsername(params.username || '');
            if (action === 'profile') {
                const raw = await rapidGet('/user/info', { unique_id: user });
                return normalizeProfile(raw, user);
            }
            if (action === 'videos') {
                const raw = await rapidGet('/user/posts', {
                    unique_id: user,
                    count:     params.count  || 30,
                    cursor:    params.cursor || 0,
                });
                return normalizeVideos(raw, user);
            }
            return { error: 'Unknown action' };
        }

        // ──────────────────────────────────────────────
        //  PROFILE RENDER
        // ──────────────────────────────────────────────
        function renderProfile(p) {
            const avatar = p.avatarUrl
                ? `<img src="${esc(p.avatarUrl)}" alt="Avatar" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2280%22 height=%2280%22><rect width=%2280%22 height=%2280%22 rx=%2240%22 fill=%22%236366f1%22/><text x=%2240%22 y=%2252%22 font-size=%2236%22 text-anchor=%22middle%22 fill=%22white%22>${p.nickname?.[0]?.toUpperCase()||'?'}</text></svg>'">`
                : `<div style="width:80px;height:80px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:2rem;flex-shrink:0">${p.nickname?.[0]?.toUpperCase()||'?'}</div>`;

            const verified = p.verified ? `<span class="verified-badge">✓ Verified</span>` : '';
            const bio = p.bio ? `<div class="profile-bio">${esc(p.bio)}</div>` : '';

            $('profile-header').innerHTML = `
                ${avatar}
                <div class="profile-info">
                    <div class="profile-name">${esc(p.nickname)} ${verified}</div>
                    <div class="profile-handle">@${esc(p.uniqueId)}</div>
                    ${bio}
                    <div class="profile-stats">
                        <div class="stat"><div class="stat-num">${fmt(p.followers)}</div><div class="stat-label">Followers</div></div>
                        <div class="stat"><div class="stat-num">${fmt(p.following)}</div><div class="stat-label">Following</div></div>
                        <div class="stat"><div class="stat-num">${fmt(p.likes)}</div><div class="stat-label">Likes</div></div>
                        <div class="stat"><div class="stat-num">${fmt(p.videoCount)}</div><div class="stat-label">Videos</div></div>
                    </div>
                </div>
                <div class="profile-actions">
                    <a class="btn btn-accent" href="${esc(p.profileUrl)}" target="_blank" rel="noopener">Open Profile</a>
                    <button class="btn btn-ghost" onclick="copyText('@${esc(p.uniqueId)}')">Copy @handle</button>
                    <button class="btn btn-ghost" onclick="copyText('${esc(p.profileUrl)}')">Copy Link</button>
                </div>`;
        }

        // ──────────────────────────────────────────────
        //  FILTER & SORT
        // ──────────────────────────────────────────────
        function applyFilters() {
            const term = $('filter-input').value.trim().toLowerCase();
            const sort = $('sort-select').value;

            filtered = allVideos.filter(v => {
                if (!term) return true;
                const hay = (v.description + ' ' + (v.hashtags || []).join(' ')).toLowerCase();
                return hay.includes(term);
            });

            filtered.sort((a, b) => {
                if (sort === 'newest')   return b.uploadDate - a.uploadDate;
                if (sort === 'oldest')   return a.uploadDate - b.uploadDate;
                if (sort === 'views')    return b.views    - a.views;
                if (sort === 'likes')    return b.likes    - a.likes;
                if (sort === 'comments') return b.comments - a.comments;
                return 0;
            });

            $('count-label').textContent = `${filtered.length} video${filtered.length !== 1 ? 's' : ''}`;
            renderGrid();
            updateSelectedStats();
            updateSelectAllCheckbox();
        }

        // ──────────────────────────────────────────────
        //  VIDEO GRID RENDER
        // ──────────────────────────────────────────────
        function renderGrid() {
            const grid = $('video-grid');
            if (!filtered.length) {
                grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:3rem;color:var(--muted)">No videos found</div>`;
                return;
            }
            grid.innerHTML = filtered.map((v, idx) => videoCardHTML(v, idx)).join('');
        }

        function videoCardHTML(v, idx) {
            const sel   = selected.has(v.id);
            const sub   = submitted.has(v.id);
            const thumb = v.thumbnailUrl
                ? `<img src="${esc(v.thumbnailUrl)}" alt="Thumbnail" loading="lazy"
                       onerror="this.parentElement.innerHTML='<div class=thumb-placeholder>🎬</div>'">`
                : `<div class="thumb-placeholder">🎬</div>`;

            const dur    = fmtDur(v.duration);
            const tags   = (v.hashtags || []).slice(0, 4).map(t => `<span class="tag">#${esc(t)}</span>`).join('');
            const date   = fmtDate(v.uploadDate);
            const shortId = v.id ? v.id.slice(-8) : '';

            return `<div class="video-card${sel ? ' selected' : ''}${sub ? ' submitted' : ''}" id="card-${esc(v.id)}">
                <div class="thumb-wrap" onclick="toggleSelect('${esc(v.id)}',event); event.stopPropagation()">
                    ${thumb}
                    ${dur ? `<span class="duration-badge">${dur}</span>` : ''}
                    ${sub ? `<span class="submitted-icon" title="Submitted">✓</span>` : ''}
                    <div class="select-checkbox" onclick="toggleSelect('${esc(v.id)}',event); event.stopPropagation()">
                        <svg width="14" height="11" viewBox="0 0 14 11" fill="none">
                            <path d="M1 5L5 9L13 1" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </div>
                </div>
                <div class="card-body" onclick="openVideoDetail(${idx})">
                    ${v.description ? `<div class="card-desc">${esc(v.description)}</div>` : ''}
                    ${tags ? `<div class="card-tags">${tags}</div>` : ''}
                    <div class="card-stats">
                        <span class="card-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${fmt(v.views)}</span>
                        <span class="card-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>${fmt(v.likes)}</span>
                        <span class="card-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>${fmt(v.comments)}</span>
                        <span class="card-stat"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>${fmt(v.shares)}</span>
                    </div>
                    ${date ? `<div class="card-date">${date}</div>` : ''}
                    <div class="card-actions">
                        <div class="card-btn" onclick="event.stopPropagation();window.open('${esc(v.videoUrl)}','_blank')">Open ↗</div>
                        <div class="card-btn" onclick="event.stopPropagation();openVideoDetail(${idx})">Details</div>
                        <div class="card-btn" onclick="event.stopPropagation();copyText('${esc(v.videoUrl)}')">Copy Link</div>
                        ${shortId ? `<div class="card-btn" onclick="event.stopPropagation();copyText('${esc(v.id)}')">ID</div>` : ''}
                    </div>
                </div>
            </div>`;
        }

        function renderSkeletons(n) {
            $('video-grid').innerHTML = Array.from({ length: n }, () => `
                <div class="skel-card">
                    <div class="skel-thumb"></div>
                    <div class="skel-body">
                        <div class="skel-line" style="height:12px;width:90%;margin-bottom:6px"></div>
                        <div class="skel-line" style="height:12px;width:70%;margin-bottom:10px"></div>
                        <div class="skel-line" style="height:10px;width:50%"></div>
                    </div>
                </div>`).join('');
        }

        // ──────────────────────────────────────────────
        //  SELECTION
        // ──────────────────────────────────────────────
        function toggleSelect(id, e) {
            if (e) e.stopPropagation();
            if (selected.has(id)) selected.delete(id);
            else selected.add(id);
            const card = document.getElementById('card-' + id);
            if (card) {
                card.classList.toggle('selected', selected.has(id));
            }
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
        }

        function toggleSelectAll() {
            const selectable = filtered.filter(v => !submitted.has(v.id));
            if (selectable.length === 0) {
                selected.clear();
            } else {
                const allSelected = selectable.every(v => selected.has(v.id));
                if (allSelected) {
                    selectable.forEach(v => selected.delete(v.id));
                } else {
                    selected = new Set(selectable.map(v => v.id));
                }
            }
            renderGrid();
            $('select-all-chk').checked = false; // will be updated immediately after
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
        }

        function clearSelection() {
            selected.clear();
            $('select-all-chk').checked = false;
            renderGrid();
            updateBulkBar();
            updateSelectedStats();
            updateSelectAllCheckbox();
        }

        function updateBulkBar() {
            const n = selected.size;
            const bar = $('bulk-bar');
            if (n > 0) {
                bar.classList.add('visible');
                $('bulk-count').textContent = `${n} selected`;
            } else {
                bar.classList.remove('visible');
            }
        }

        function updateSelectAllCheckbox() {
            const checkbox = $('select-all-chk');
            const selectable = filtered.filter(v => !submitted.has(v.id));
            if (selectable.length === 0) {
                checkbox.checked = false;
                checkbox.indeterminate = false;
                checkbox.disabled = true;
            } else {
                checkbox.disabled = false;
                const allSelected = selectable.every(v => selected.has(v.id));
                const noneSelected = selectable.every(v => !selected.has(v.id));
                if (allSelected) {
                    checkbox.checked = true;
                    checkbox.indeterminate = false;
                } else if (noneSelected) {
                    checkbox.checked = false;
                    checkbox.indeterminate = false;
                } else {
                    checkbox.checked = false;
                    checkbox.indeterminate = true;
                }
            }
        }

        function openSelected() {
            const vids = filtered.filter(v => selected.has(v.id));
            if (!vids.length) {
                toast('Nothing selected');
                return;
            }
            if (vids.length > 10) {
                if (!confirm(`Open ${vids.length} tabs?`)) return;
            }
            vids.forEach(v => window.open(v.videoUrl, '_blank'));
        }

        function copySelectedLinks() {
            const source = selected.size > 0 ? filtered.filter(v => selected.has(v.id)) : filtered;
            if (!source.length) {
                toast('No videos to copy');
                return;
            }
            const text = source.map(v => v.videoUrl).join('\n');
            if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(text).then(() => toast(`✓ Copied ${source.length} link${source.length > 1 ? 's' : ''}`));
            } else {
                const ta = document.createElement('textarea');
                ta.value = text;
                ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
                document.body.appendChild(ta);
                ta.select();
                try {
                    document.execCommand('copy');
                    toast(`✓ Copied ${source.length} link${source.length > 1 ? 's' : ''}`);
                } catch {
                    toast('Copy failed — try HTTPS');
                }
                document.body.removeChild(ta);
            }
        }

        // ──────────────────────────────────────────────
        //  SELECTED STATISTICS PANEL
        // ──────────────────────────────────────────────
        function updateSelectedStats() {
            const panel = $('selected-stats');
            const summary = $('stats-summary');
            const extra = $('stats-extra');
            const selVideos = filtered.filter(v => selected.has(v.id));
            if (selVideos.length === 0) {
                panel.classList.remove('visible');
                return;
            }
            panel.classList.add('visible');

            const totalViews    = selVideos.reduce((s, v) => s + v.views,    0);
            const totalLikes    = selVideos.reduce((s, v) => s + v.likes,    0);
            const totalComments = selVideos.reduce((s, v) => s + v.comments, 0);
            const totalShares   = selVideos.reduce((s, v) => s + v.shares,   0);
            const cnt = selVideos.length;

            summary.innerHTML = `
                <div class="stat-box"><div class="stat-box-label">Selected</div><div class="stat-box-value">${cnt}</div></div>
                <div class="stat-box"><div class="stat-box-label">Total Views</div><div class="stat-box-value">${fmt(totalViews)}</div></div>
                <div class="stat-box"><div class="stat-box-label">Total Likes</div><div class="stat-box-value">${fmt(totalLikes)}</div></div>
                <div class="stat-box"><div class="stat-box-label">Total Comments</div><div class="stat-box-value">${fmt(totalComments)}</div></div>
                <div class="stat-box"><div class="stat-box-label">Total Shares</div><div class="stat-box-value">${fmt(totalShares)}</div></div>
            `;

            const avgViews    = totalViews    / cnt;
            const avgLikes    = totalLikes    / cnt;
            const avgComments = totalComments / cnt;
            const avgShares   = totalShares   / cnt;

            const viewsArr    = selVideos.map(v => v.views);
            const likesArr    = selVideos.map(v => v.likes);
            const commentsArr = selVideos.map(v => v.comments);
            const sharesArr   = selVideos.map(v => v.shares);

            const maxViews    = Math.max(...viewsArr);
            const minViews    = Math.min(...viewsArr);
            const maxLikes    = Math.max(...likesArr);
            const minLikes    = Math.min(...likesArr);
            const maxComments = Math.max(...commentsArr);
            const minComments = Math.min(...commentsArr);
            const maxShares   = Math.max(...sharesArr);
            const minShares   = Math.min(...sharesArr);

            extra.innerHTML = `
                <div class="stats-extra-grid">
                    <div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Avg Views</span><span class="extra-stat-value">${fmt(Math.round(avgViews))}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Avg Likes</span><span class="extra-stat-value">${fmt(Math.round(avgLikes))}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Avg Comments</span><span class="extra-stat-value">${fmt(Math.round(avgComments))}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Avg Shares</span><span class="extra-stat-value">${fmt(Math.round(avgShares))}</span></div>
                    </div>
                    <div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Highest Views</span><span class="extra-stat-value">${fmt(maxViews)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Lowest Views</span><span class="extra-stat-value">${fmt(minViews)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Highest Likes</span><span class="extra-stat-value">${fmt(maxLikes)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Lowest Likes</span><span class="extra-stat-value">${fmt(minLikes)}</span></div>
                    </div>
                    <div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Highest Comments</span><span class="extra-stat-value">${fmt(maxComments)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Lowest Comments</span><span class="extra-stat-value">${fmt(minComments)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Highest Shares</span><span class="extra-stat-value">${fmt(maxShares)}</span></div>
                        <div class="extra-stat-row"><span class="extra-stat-label">Lowest Shares</span><span class="extra-stat-value">${fmt(minShares)}</span></div>
                    </div>
                </div>
            `;

            if (statsMoreOpen) {
                extra.classList.add('visible');
                $('stats-expand-btn').textContent = 'Less ▲';
            } else {
                extra.classList.remove('visible');
                $('stats-expand-btn').textContent = 'More ▼';
            }
        }

        function toggleStatsMore() {
            statsMoreOpen = !statsMoreOpen;
            updateSelectedStats();
        }

        // ──────────────────────────────────────────────
        //  EXPORT
        // ──────────────────────────────────────────────
        function exportData(format) {
            const data = selected.size > 0 ? filtered.filter(v => selected.has(v.id)) : filtered;
            if (!data.length) {
                toast('No videos to export');
                return;
            }

            let content, mime, ext;
            if (format === 'csv') {
                const cols = ['id', 'description', 'videoUrl', 'views', 'likes', 'comments', 'shares', 'duration', 'uploadDate', 'hashtags'];
                const rows = [cols.join(',')];
                data.forEach(v => {
                    const row = cols.map(c => {
                        const val = c === 'hashtags' ? (v[c] || []).join(';') : (v[c] ?? '');
                        return '"' + String(val).replace(/"/g, '""') + '"';
                    }).join(',');
                    rows.push(row);
                });
                content = rows.join('\n');
                mime = 'text/csv';
                ext = 'csv';
            } else {
                content = JSON.stringify(data, null, 2);
                mime = 'application/json';
                ext = 'json';
            }

            const blob = new Blob([content], { type: mime });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `tiktok-${currentUser}-${Date.now()}.${ext}`;
            a.click();
            URL.revokeObjectURL(url);
            toast(`Exported ${data.length} videos as ${ext.toUpperCase()}`);
        }

        // ──────────────────────────────────────────────
        //  VIDEO DETAIL PANEL
        // ──────────────────────────────────────────────
        function openVideoDetail(idx) {
            detailIndex = idx;
            _renderDetail();
            $('vd-overlay').classList.add('open');
            document.body.style.overflow = 'hidden';
        }

        function closeVideoDetail() {
            $('vd-overlay').classList.remove('open');
            document.body.style.overflow = '';
            $('vd-thumb').src = '';
            $('vd-thumb-bg').style.backgroundImage = '';
        }

        function navVideo(dir) {
            if (!filtered.length) return;
            detailIndex = ((detailIndex + dir) + filtered.length) % filtered.length;
            _renderDetail();
        }

        function _renderDetail() {
            const v = filtered[detailIndex];
            if (!v) return;
            const safeUrl = v.thumbnailUrl ? v.thumbnailUrl.replace(/\\/g, '\\\\').replace(/'/g, "\\'") : '';
            $('vd-thumb').src = v.thumbnailUrl || '';
            $('vd-thumb-bg').style.backgroundImage = safeUrl ? `url('${safeUrl}')` : '';
            $('vd-play-btn').onclick = () => window.open(v.videoUrl, '_blank');
            $('vd-counter').textContent = `${detailIndex + 1} / ${filtered.length}`;

            $('vd-meta').innerHTML = `<div class="vd-meta-row">
                ${v.uploadDate ? `<span class="vd-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>${fmtDate(v.uploadDate)}</span>` : ''}
                ${v.duration ? `<span class="vd-meta-item"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>${fmtDur(v.duration)}</span>` : ''}
                ${v.id ? `<span class="vd-meta-item" style="font-family:monospace;opacity:.6">ID: ${esc(v.id.slice(-12))}</span>` : ''}
            </div>`;

            $('vd-stats').innerHTML = `<div class="vd-stat-grid">
                <div class="vd-stat-box"><div class="vd-stat-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>Views</div><div class="vd-stat-val">${fmt(v.views)}</div></div>
                <div class="vd-stat-box"><div class="vd-stat-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/></svg>Likes</div><div class="vd-stat-val">${fmt(v.likes)}</div></div>
                <div class="vd-stat-box"><div class="vd-stat-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Comments</div><div class="vd-stat-val">${fmt(v.comments)}</div></div>
                <div class="vd-stat-box"><div class="vd-stat-label"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>Shares</div><div class="vd-stat-val">${fmt(v.shares)}</div></div>
            </div>`;

            const tags = (v.hashtags || []).map(t => `<span class="vd-tag">#${esc(t)}</span>`).join('');
            $('vd-desc-wrap').innerHTML = `
                ${v.description ? `<div class="vd-section-title">Description</div><div class="vd-desc">${esc(v.description)}</div>` : ''}
                ${tags ? `<div class="vd-tags">${tags}</div>` : ''}`;

            $('vd-actions').innerHTML = `
                <button class="vd-btn vd-btn-primary" onclick="window.open('${esc(v.videoUrl)}','_blank')">▶ Open on TikTok</button>
                <button class="vd-btn vd-btn-ghost" onclick="copyText('${esc(v.videoUrl)}')">⧉ Copy Link</button>`;
        }

        // ──────────────────────────────────────────────
        //  ERROR HANDLING
        // ──────────────────────────────────────────────
        function showDashError(msg) {
            const el = $('dash-error');
            el.innerHTML = `<div>⚠ ${esc(msg)}</div><button onclick="startSearch(currentUser)">Retry</button>`;
            el.classList.remove('hidden');
        }

        // ──────────────────────────────────────────────
        //  KEYBOARD SHORTCUTS
        // ──────────────────────────────────────────────
        document.addEventListener('keydown', e => {
            if (!$('vd-overlay').classList.contains('open')) return;
            if (e.key === 'Escape')     closeVideoDetail();
            if (e.key === 'ArrowLeft')  navVideo(-1);
            if (e.key === 'ArrowRight') navVideo(1);
        });

        // ──────────────────────────────────────────────
        //  ESCAPE HELPER
        // ──────────────────────────────────────────────
        function esc(s) {
            return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
        }

        // ──────────────────────────────────────────────
        //  SEARCH HISTORY UI EVENTS
        // ──────────────────────────────────────────────
        function setupHistoryDropdowns() {
            const heroInput = $('search-input');
            const miniInput = $('mini-search');
            const heroDrop  = $('history-dropdown');
            const miniDrop  = $('mini-history-dropdown');

            function showHeroDropdown() {
                renderDropdown(heroDrop, getHistory(), 'search-input');
            }
            function showMiniDropdown() {
                renderDropdown(miniDrop, getHistory(), 'mini-search');
            }

            heroInput.addEventListener('focus', showHeroDropdown);
            heroInput.addEventListener('input', showHeroDropdown);
            miniInput.addEventListener('focus', showMiniDropdown);
            miniInput.addEventListener('input', showMiniDropdown);

            // Close dropdowns when clicking outside
            document.addEventListener('click', function(e) {
                if (!e.target.closest('#search-form') && !e.target.closest('#history-dropdown')) {
                    heroDrop.classList.add('hidden');
                }
                if (!e.target.closest('.mini-search-wrap') && !e.target.closest('#mini-history-dropdown')) {
                    miniDrop.classList.add('hidden');
                }
            });

            heroDrop.addEventListener('click', e => e.stopPropagation());
            miniDrop.addEventListener('click', e => e.stopPropagation());
        }

        // ──────────────────────────────────────────────
        //  INITIALIZATION
        // ──────────────────────────────────────────────
        (function init() {
            setupHistoryDropdowns();
            renderHistoryDropdowns();
            updateSelectAllCheckbox(); // initial sync
        })();
    </script>
</body>
</html>

==============================================================================
FILE: public/style.css
==============================================================================
/* =========================================================================
   TikVerify — premium dashboard styling
   Plain CSS, no build step required.
   ========================================================================= */

:root {
  --bg: #0a0b12;
  --bg-elev: #12131e;
  --panel: rgba(255,255,255,0.045);
  --panel-border: rgba(255,255,255,0.09);
  --panel-border-strong: rgba(255,255,255,0.16);
  --text: #eef0f8;
  --text-dim: #9aa0b4;
  --text-faint: #656b82;
  --accent: #7c5cff;
  --accent-2: #2fd3c7;
  --accent-grad: linear-gradient(135deg, #7c5cff 0%, #2fd3c7 100%);
  --good: #35d68a;
  --bad: #ff5d7a;
  --warn: #ffb84d;
  --radius-sm: 10px;
  --radius: 16px;
  --radius-lg: 24px;
  --shadow-soft: 0 20px 60px -20px rgba(0,0,0,0.55);
  --ease: cubic-bezier(.22,1,.36,1);
}

html[data-theme="light"] {
  --bg: #f4f5fb;
  --bg-elev: #ffffff;
  --panel: rgba(20,20,40,0.035);
  --panel-border: rgba(20,20,40,0.08);
  --panel-border-strong: rgba(20,20,40,0.16);
  --text: #14151f;
  --text-dim: #565c72;
  --text-faint: #8b90a3;
  --shadow-soft: 0 20px 60px -25px rgba(30,30,60,0.25);
}

* { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  background: var(--bg);
  color: var(--text);
  min-height: 100vh;
  overflow-x: hidden;
  transition: background .4s var(--ease), color .4s var(--ease);
}
h1, h2, h3, .brand-name { font-family: 'Manrope', 'Inter', sans-serif; }
::selection { background: var(--accent); color: #fff; }

/* ---------- Animated background ---------- */
.bg-aurora {
  position: fixed; inset: 0; z-index: -1; pointer-events: none;
  background:
    radial-gradient(600px circle at 15% 20%, rgba(124,92,255,0.22), transparent 60%),
    radial-gradient(700px circle at 85% 15%, rgba(47,211,199,0.16), transparent 60%),
    radial-gradient(800px circle at 50% 100%, rgba(124,92,255,0.12), transparent 60%);
  animation: auroraShift 18s ease-in-out infinite alternate;
}
@keyframes auroraShift {
  0% { filter: hue-rotate(0deg) brightness(1); }
  100% { filter: hue-rotate(25deg) brightness(1.08); }
}

/* ---------- Topbar ---------- */
.topbar {
  position: sticky; top: 0; z-index: 40;
  background: rgba(10,11,18,0.65);
  backdrop-filter: blur(16px) saturate(140%);
  -webkit-backdrop-filter: blur(16px) saturate(140%);
  border-bottom: 1px solid var(--panel-border);
}
html[data-theme="light"] .topbar { background: rgba(255,255,255,0.72); }
.topbar-inner {
  max-width: 1200px; margin: 0 auto; padding: 14px 24px;
  display: flex; align-items: center; gap: 24px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand-mark { display: flex; filter: drop-shadow(0 0 12px rgba(124,92,255,.5)); }
.brand-name { font-weight: 800; font-size: 19px; letter-spacing: -0.02em; }
.topbar-search {
  flex: 1; max-width: 420px; display: flex; align-items: center; gap: 8px;
  background: var(--panel); border: 1px solid var(--panel-border);
  padding: 9px 14px; border-radius: 999px; color: var(--text-faint);
  transition: border-color .25s var(--ease), background .25s var(--ease);
}
.topbar-search:focus-within { border-color: var(--accent); background: var(--panel-border); }
.topbar-search input {
  background: none; border: none; outline: none; color: var(--text);
  font-size: 14px; width: 100%; font-family: inherit;
}
.topbar-search input::placeholder { color: var(--text-faint); }
.topbar-actions { display: flex; gap: 8px; margin-left: auto; }
.icon-btn {
  width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
  border-radius: 999px; border: 1px solid var(--panel-border); background: var(--panel);
  color: var(--text-dim); cursor: pointer; transition: all .25s var(--ease);
}
.icon-btn:hover { color: var(--text); border-color: var(--panel-border-strong); transform: translateY(-1px); }
.icon-moon { display: none; }
html[data-theme="light"] .icon-sun { display: none; }
html[data-theme="light"] .icon-moon { display: block; }

/* ---------- Shell / layout ---------- */
.shell { max-width: 1200px; margin: 0 auto; padding: 0 24px 80px; }

/* ---------- Hero ---------- */
.hero { padding: 72px 0 44px; text-align: center; }
.hero-badge {
  display: inline-block; font-size: 12.5px; font-weight: 600; letter-spacing: .04em;
  color: var(--accent-2); background: rgba(47,211,199,0.1); border: 1px solid rgba(47,211,199,0.25);
  padding: 6px 16px; border-radius: 999px; margin-bottom: 22px;
  animation: fadeInUp .7s var(--ease) both;
}
.hero-title {
  font-size: clamp(32px, 5vw, 54px); font-weight: 800; line-height: 1.08; letter-spacing: -0.03em;
  margin: 0 0 18px; animation: fadeInUp .7s .05s var(--ease) both;
}
.hero-title span {
  background: var(--accent-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
}
.hero-sub {
  font-size: 17px; color: var(--text-dim); max-width: 620px; margin: 0 auto 40px; line-height: 1.6;
  animation: fadeInUp .7s .1s var(--ease) both;
}
.hero-stats {
  display: flex; justify-content: center; gap: 48px; flex-wrap: wrap;
  animation: fadeInUp .7s .18s var(--ease) both;
}
.hstat { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hstat-num { font-size: 30px; font-weight: 800; letter-spacing: -0.02em; }
.hstat-label { font-size: 12.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .06em; }

@keyframes fadeInUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

/* ---------- Panels ---------- */
.panel {
  background: var(--panel); border: 1px solid var(--panel-border); border-radius: var(--radius-lg);
  padding: 28px; margin-bottom: 24px; backdrop-filter: blur(10px);
  box-shadow: var(--shadow-soft);
  animation: fadeInUp .5s var(--ease) both;
}
.panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 18px; flex-wrap: wrap; }
.panel-head h2 { font-size: 19px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.panel-hint { font-size: 13px; color: var(--text-faint); }

/* ---------- Input panel ---------- */
.dropzone { position: relative; }
#inputText {
  width: 100%; min-height: 168px; resize: vertical; font-family: 'Inter', monospace;
  background: rgba(0,0,0,0.18); border: 1px solid var(--panel-border); border-radius: var(--radius);
  color: var(--text); padding: 18px; font-size: 14.5px; line-height: 1.6; outline: none;
  transition: border-color .25s var(--ease), box-shadow .25s var(--ease);
}
html[data-theme="light"] #inputText { background: rgba(0,0,0,0.03); }
#inputText:focus { border-color: var(--accent); box-shadow: 0 0 0 4px rgba(124,92,255,0.15); }
#inputText::placeholder { color: var(--text-faint); }
.dropzone-overlay {
  position: absolute; inset: 0; display: none; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  background: rgba(124,92,255,0.14); border: 2px dashed var(--accent); border-radius: var(--radius);
  color: var(--accent); font-weight: 600; backdrop-filter: blur(4px);
}
.dropzone.dragging .dropzone-overlay { display: flex; }

.input-toolbar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 16px; }
.toolbar-spacer { flex: 1; }
.input-summary { font-size: 13px; color: var(--text-faint); font-weight: 500; }

.run-row { display: flex; align-items: center; gap: 12px; margin-top: 22px; flex-wrap: wrap; }

/* ---------- Buttons ---------- */
.btn {
  position: relative; display: inline-flex; align-items: center; gap: 8px; justify-content: center;
  border: 1px solid var(--panel-border); background: var(--panel); color: var(--text);
  font-family: inherit; font-size: 14px; font-weight: 600; letter-spacing: -0.005em;
  padding: 11px 18px; border-radius: 999px; cursor: pointer; overflow: hidden;
  transition: transform .18s var(--ease), border-color .25s var(--ease), background .25s var(--ease), box-shadow .25s var(--ease), opacity .2s;
  -webkit-tap-highlight-color: transparent;
}
.btn:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--panel-border-strong); }
.btn:active:not(:disabled) { transform: translateY(0) scale(.97); }
.btn:disabled { opacity: .4; cursor: not-allowed; }
.btn.sm { padding: 8px 14px; font-size: 13px; }
.btn-ghost:hover:not(:disabled) { background: var(--panel-border); }

.btn-primary {
  background: var(--accent-grad); border: none; color: #fff; padding: 15px 30px; font-size: 15.5px;
  box-shadow: 0 10px 30px -8px rgba(124,92,255,0.55);
}
.btn-primary:hover:not(:disabled) { box-shadow: 0 14px 38px -8px rgba(124,92,255,0.7); transform: translateY(-2px) scale(1.015); }
.btn-lg { border-radius: 999px; }
.btn-glow {
  position: absolute; inset: -40%; background: radial-gradient(circle, rgba(255,255,255,0.35), transparent 60%);
  opacity: 0; transition: opacity .3s;
}
.btn-primary:hover .btn-glow { opacity: 1; }
.btn-primary.loading .btn-glow { opacity: 1; animation: spin 1.4s linear infinite; }
@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

.btn-secondary { background: rgba(255,255,255,0.06); }
.btn-danger { color: var(--bad); border-color: rgba(255,93,122,0.35); }
.btn-danger:hover:not(:disabled) { background: rgba(255,93,122,0.12); }

/* Ripple effect */
.btn .ripple {
  position: absolute; border-radius: 50%; background: rgba(255,255,255,0.5);
  transform: scale(0); animation: rippleAnim .6s var(--ease);
  pointer-events: none;
}
@keyframes rippleAnim { to { transform: scale(3); opacity: 0; } }

/* ---------- Progress panel ---------- */
.status-pill {
  font-size: 12px; font-weight: 700; padding: 5px 12px; border-radius: 999px;
  background: rgba(124,92,255,0.15); color: var(--accent); text-transform: uppercase; letter-spacing: .04em;
}
.status-pill.running { background: rgba(255,184,77,0.15); color: var(--warn); }
.status-pill.paused { background: rgba(154,160,180,0.18); color: var(--text-dim); }
.status-pill.done { background: rgba(53,214,138,0.15); color: var(--good); }

.progress-track {
  height: 10px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; margin-bottom: 22px;
}
.progress-fill {
  height: 100%; width: 0%; border-radius: 999px; background: var(--accent-grad);
  transition: width .35s var(--ease); position: relative;
  box-shadow: 0 0 16px rgba(124,92,255,0.6);
}
.progress-fill::after {
  content: ''; position: absolute; inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
  animation: shimmer 1.6s linear infinite;
}
@keyframes shimmer { from { transform: translateX(-100%); } to { transform: translateX(100%); } }

.progress-grid { display: grid; grid-template-columns: 1.4fr 1fr; gap: 24px; }
@media (max-width: 760px) { .progress-grid { grid-template-columns: 1fr; } }
.progress-current { display: flex; gap: 16px; align-items: center; }
.current-thumb {
  width: 76px; height: 96px; border-radius: var(--radius-sm); object-fit: cover; flex-shrink: 0;
  background: rgba(255,255,255,0.06); border: 1px solid var(--panel-border);
}
.current-thumb.placeholder { display: flex; }
.current-info { min-width: 0; }
.current-label { font-size: 12px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
.current-link {
    font-size: 13.5px;
    font-weight: 600;
    white-space: normal;
    overflow-wrap: anywhere;
    word-break: break-word;
    line-height: 1.45;
    max-width: 100%;
}
.current-status { font-size: 13px; color: var(--text-dim); margin-top: 4px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; max-width: 100%; }
@media (max-width: 480px) {
  .progress-current { gap: 12px; }
  .current-thumb { width: 56px; height: 72px; }
}

.progress-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 10px; }
@media (max-width: 760px) { .progress-stats { grid-template-columns: repeat(3, 1fr); } }
.pstat { text-align: center; background: rgba(255,255,255,0.04); border-radius: var(--radius-sm); padding: 12px 6px; }
.pstat span { display: block; font-size: 18px; font-weight: 800; }
.pstat label { font-size: 10.5px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }

/* ---------- Summary ---------- */
.summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 900px) { .summary-grid { grid-template-columns: repeat(2, 1fr); } }
.scard {
  background: rgba(255,255,255,0.04); border: 1px solid var(--panel-border); border-radius: var(--radius);
  padding: 18px; animation: fadeInUp .5s var(--ease) both;
}
.scard-num { font-size: 26px; font-weight: 800; letter-spacing: -0.02em; }
.scard-label { font-size: 12.5px; color: var(--text-faint); margin-top: 4px; }
.scard.good .scard-num { color: var(--good); }
.scard.bad .scard-num { color: var(--bad); }
.scard.accent .scard-num { background: var(--accent-grad); -webkit-background-clip: text; background-clip: text; color: transparent; }

/* ---------- Results ---------- */
.results-head { align-items: center; }
.view-toggle { display: flex; background: rgba(255,255,255,0.05); border-radius: 999px; padding: 3px; }
.vtab { border: none; background: none; color: var(--text-dim); font-size: 13px; font-weight: 600; padding: 7px 16px; border-radius: 999px; cursor: pointer; transition: all .2s var(--ease); }
.vtab.active { background: var(--accent-grad); color: #fff; }

.filters-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; margin-bottom: 14px; }
.chip-group { display: flex; gap: 8px; flex-wrap: wrap; }
.chip {
  border: 1px solid var(--panel-border); background: var(--panel); color: var(--text-dim);
  font-size: 12.5px; font-weight: 600; padding: 7px 14px; border-radius: 999px; cursor: pointer;
  transition: all .2s var(--ease);
}
.chip:hover { border-color: var(--panel-border-strong); }
.chip.active { background: var(--accent-grad); color: #fff; border-color: transparent; }
.results-search { display: flex; align-items: center; gap: 6px; background: var(--panel); border: 1px solid var(--panel-border); padding: 7px 12px; border-radius: 999px; color: var(--text-faint); }
.results-search input { background: none; border: none; outline: none; color: var(--text); font-size: 13px; font-family: inherit; width: 180px; }

.export-row { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 22px; }

.results-grid { display: grid; gap: 16px; }
.results-grid.cards-view { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); }
.results-grid.gallery-view { grid-template-columns: repeat(5, 1fr); }
@media (max-width: 1080px) { .results-grid.gallery-view { grid-template-columns: repeat(3, 1fr); } }
@media (max-width: 640px) { .results-grid.gallery-view { grid-template-columns: repeat(2, 1fr); } .results-grid.cards-view { grid-template-columns: 1fr; } }

.result-card {
  background: rgba(255,255,255,0.045); border: 1px solid var(--panel-border); border-radius: var(--radius);
  overflow: hidden; transition: transform .3s var(--ease), box-shadow .3s var(--ease), border-color .3s var(--ease);
  animation: cardIn .45s var(--ease) both;
}
@keyframes cardIn { from { opacity: 0; transform: translateY(14px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
.result-card:hover { transform: translateY(-4px); box-shadow: 0 20px 40px -18px rgba(0,0,0,0.5); border-color: var(--panel-border-strong); }
.card-thumb-wrap { position: relative; aspect-ratio: 9/13; background: rgba(255,255,255,0.05); overflow: hidden; }
.card-thumb { width: 100%; height: 100%; object-fit: cover; transition: transform .5s var(--ease); }
.result-card:hover .card-thumb { transform: scale(1.06); }
.status-badge {
  position: absolute; top: 10px; left: 10px; font-size: 11px; font-weight: 700; text-transform: uppercase;
  padding: 4px 10px; border-radius: 999px; letter-spacing: .04em; backdrop-filter: blur(6px);
  background: rgba(53,214,138,0.85); color: #06231a;
}
.status-badge.broken { background: rgba(255,93,122,0.88); color: #2b0510; }
.status-badge.missing { background: rgba(255,184,77,0.88); color: #2b1c02; }
.card-body { padding: 16px; }
.card-title { font-size: 14.5px; font-weight: 700; margin: 0 0 6px; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-url { font-size: 12px; color: var(--text-faint); display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-bottom: 10px; text-decoration: none; }
.card-url:hover { color: var(--accent-2); }
.card-stats { display: flex; gap: 14px; margin-bottom: 10px; }
.cstat { display: flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--text-dim); }
.cstat b { font-weight: 700; color: var(--text); }
.card-error { font-size: 12px; color: var(--bad); margin: 0 0 10px; }
.card-actions { display: flex; gap: 8px; }

/* Gallery mode compact cards */
.gallery-view .result-card .card-body { padding: 10px; }
.gallery-view .result-card .card-title { font-size: 12.5px; -webkit-line-clamp: 1; }
.gallery-view .result-card .card-stats { font-size: 11px; gap: 8px; }
.gallery-view .result-card .card-actions { display: none; }

.empty-state { text-align: center; padding: 60px 20px; color: var(--text-faint); }
.empty-state svg { margin-bottom: 12px; opacity: .6; }

/* ---------- Footer ---------- */
.app-footer { text-align: center; padding: 30px 20px 50px; color: var(--text-faint); font-size: 12.5px; }

/* ---------- Dialogs (native <dialog>) ---------- */
.app-dialog {
  width: min(440px, 90vw); background: var(--bg-elev); border: 1px solid var(--panel-border-strong);
  border-radius: var(--radius-lg); padding: 24px; box-shadow: var(--shadow-soft);
  color: var(--text); margin: auto; box-sizing: border-box;
}
.app-dialog[open] { animation: fadeInUp .3s var(--ease); }
.app-dialog::backdrop {
  background: rgba(4,4,10,0.6); backdrop-filter: blur(6px);
  animation: fadeIn .25s var(--ease);
}
.app-dialog.cs-dialog {
  width: min(680px, 94vw); max-height: 88vh; overflow-y: auto; overscroll-behavior: contain;
  padding: 28px 30px; scrollbar-width: thin; scrollbar-color: var(--panel-border-strong) transparent;
}
.app-dialog.cs-dialog::-webkit-scrollbar { width: 8px; }
.app-dialog.cs-dialog::-webkit-scrollbar-track { background: transparent; }
.app-dialog.cs-dialog::-webkit-scrollbar-thumb { background: var(--panel-border-strong); border-radius: 999px; }
.modal-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
.modal-head h3 { margin: 0; font-size: 17px; }
.cs-dialog .modal-head { align-items: flex-start; gap: 12px; margin-bottom: 6px; position: sticky; top: 0; background: var(--bg-elev); }
.cs-dialog .modal-head h3 { font-size: 19px; }
.cs-dialog .modal-head [data-close] {
  width: 34px; height: 34px; border-radius: 50%; font-size: 20px; line-height: 1;
  flex-shrink: 0; border: 1px solid var(--panel-border); background: rgba(255,255,255,0.04);
}
.cs-dialog-hint { margin: 0 0 22px; }
@media (max-width: 560px) {
  .cs-dialog .modal-head h3 { font-size: 17px; }
  .app-dialog.cs-dialog { padding: 20px 16px 24px; width: 100vw; max-width: 100vw; max-height: 92vh; border-radius: var(--radius-lg) var(--radius-lg) 0 0; margin: auto auto 0; }
  .app-dialog.cs-dialog[open] { animation: slideUpIn .28s var(--ease); }
}
@keyframes slideUpIn { from { transform: translateY(24px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.modal-body p { color: var(--text-dim); font-size: 14px; line-height: 1.6; }
.field { display: flex; flex-direction: column; gap: 8px; margin-bottom: 18px; font-size: 13.5px; font-weight: 600; }
.field input[type="range"] { accent-color: var(--accent); }
.field-value { font-weight: 700; color: var(--accent-2); font-size: 12.5px; }
.field.checkbox { flex-direction: row; align-items: center; gap: 10px; }

/* ---------- Toasts ---------- */
.toast-stack { position: fixed; bottom: 24px; right: 24px; display: flex; flex-direction: column; gap: 10px; z-index: 200; }
.toast {
  background: var(--bg-elev); border: 1px solid var(--panel-border-strong); border-radius: 12px;
  padding: 12px 18px; font-size: 13.5px; font-weight: 600; box-shadow: var(--shadow-soft);
  animation: toastIn .3s var(--ease), toastOut .3s var(--ease) 3.2s forwards;
  display: flex; align-items: center; gap: 8px; max-width: 320px;
}
.toast.success { border-left: 3px solid var(--good); }
.toast.error { border-left: 3px solid var(--bad); }
.toast.info { border-left: 3px solid var(--accent); }
@keyframes toastIn { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
@keyframes toastOut { to { opacity: 0; transform: translateX(30px); } }

/* Skeleton loading */
.skeleton { background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.09) 37%, rgba(255,255,255,0.04) 63%); background-size: 400% 100%; animation: skeletonLoad 1.4s ease infinite; }
@keyframes skeletonLoad { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }

/* =========================================================================
   Create Service section
   ========================================================================= */
.cs-panel { margin-top: 24px; }

/* Two-column top row (Service ID + Price) */
.cs-top-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;
}
@media (max-width: 640px) { .cs-top-row { grid-template-columns: 1fr; gap: 16px; } }
@media (max-width: 480px) {
  .cs-input, .cs-service-wrap .btn { min-height: 46px; }
  .cs-service-wrap { gap: 6px; }
}

/* Field groups */
.cs-field-group { display: flex; flex-direction: column; gap: 8px; }
.cs-urls-group { margin-bottom: 20px; }
.cs-label {
  font-size: 13px; font-weight: 600; color: var(--text-dim); letter-spacing: .01em;
  display: flex; align-items: center; gap: 8px;
}
.cs-optional { font-weight: 400; color: var(--text-faint); font-size: 12px; }
.cs-url-count { font-size: 12px; color: var(--accent-2); font-weight: 500; }
.cs-source-note {
  font-size: 13px; color: var(--text-dim); background: rgba(255,255,255,0.04);
  border: 1px solid var(--panel-border); border-radius: var(--radius-sm);
  padding: 11px 14px; line-height: 1.5;
}

/* Inputs */
.cs-input {
  width: 100%; background: rgba(0,0,0,0.18); border: 1px solid var(--panel-border);
  border-radius: var(--radius-sm); color: var(--text); padding: 11px 14px;
  font-size: 14px; font-family: inherit; outline: none;
  transition: border-color .25s var(--ease), box-shadow .25s var(--ease);
}
html[data-theme="light"] .cs-input { background: rgba(0,0,0,0.03); }
.cs-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,92,255,0.15); }
.cs-input::placeholder { color: var(--text-faint); }
/* Remove number spinners */
.cs-input[type="number"]::-webkit-inner-spin-button,
.cs-input[type="number"]::-webkit-outer-spin-button { -webkit-appearance: none; margin: 0; }
.cs-input[type="number"] { -moz-appearance: textfield; }

.cs-textarea {
  width: 100%; min-height: 130px; resize: vertical; font-family: 'Inter', monospace;
  background: rgba(0,0,0,0.18); border: 1px solid var(--panel-border); border-radius: var(--radius-sm);
  color: var(--text); padding: 14px; font-size: 13.5px; line-height: 1.6; outline: none;
  transition: border-color .25s var(--ease), box-shadow .25s var(--ease);
}
html[data-theme="light"] .cs-textarea { background: rgba(0,0,0,0.03); }
.cs-textarea:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(124,92,255,0.15); }
.cs-textarea::placeholder { color: var(--text-faint); }
.cs-textarea[readonly] { cursor: default; opacity: .85; }

/* Service ID row (input + history button side by side) */
.cs-service-wrap { display: flex; gap: 8px; align-items: stretch; }
.cs-service-wrap .cs-input { flex: 1; }
.cs-service-wrap .btn { flex-shrink: 0; border-radius: var(--radius-sm); }

/* History dropdown */
.cs-history-panel {
  position: relative; background: var(--bg-elev); border: 1px solid var(--panel-border-strong);
  border-radius: var(--radius); padding: 12px; margin-top: 4px;
  box-shadow: 0 16px 40px -12px rgba(0,0,0,0.55);
  animation: fadeInUp .2s var(--ease) both;
  max-height: 280px; overflow-y: auto;
  z-index: 20;
}
.cs-history-head {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px; padding-bottom: 10px; border-bottom: 1px solid var(--panel-border);
}
.cs-history-title { font-size: 12.5px; font-weight: 700; color: var(--text-dim); text-transform: uppercase; letter-spacing: .05em; }
.cs-history-empty { font-size: 13px; color: var(--text-faint); text-align: center; padding: 10px 0; }
.cs-history-list { display: flex; flex-direction: column; gap: 4px; }

.cs-history-item {
  display: flex; align-items: center; justify-content: space-between;
  padding: 9px 10px; border-radius: var(--radius-sm);
  background: var(--panel); border: 1px solid transparent;
  transition: border-color .2s, background .2s; cursor: pointer;
}
.cs-history-item:hover { border-color: var(--panel-border); background: var(--panel-border); }
.cs-hi-content { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; }
.cs-hi-id { font-size: 13.5px; font-weight: 700; font-family: 'Inter', monospace; }
.cs-hi-arrow { color: var(--text-faint); font-size: 12px; }
.cs-hi-price { font-size: 12.5px; color: var(--accent-2); font-weight: 600; }
.cs-hi-actions { display: flex; gap: 4px; flex-shrink: 0; }
.cs-hi-btn {
  width: 26px; height: 26px; display: flex; align-items: center; justify-content: center;
  border: none; background: transparent; color: var(--text-faint); cursor: pointer;
  border-radius: 6px; transition: color .15s, background .15s;
}
.cs-hi-btn:hover { color: var(--text); background: rgba(255,255,255,0.1); }
.cs-hi-save { color: var(--good); }
.cs-hi-save:hover { color: var(--good); background: rgba(53,214,138,0.15); }
.cs-hi-cancel:hover { color: var(--bad); background: rgba(255,93,122,0.12); }
.cs-hi-del:hover { color: var(--bad); background: rgba(255,93,122,0.12); }

/* Inline edit form inside history item */
.cs-hi-edit-form {
  display: flex; gap: 6px; align-items: center; width: 100%;
}
.cs-hi-edit-form .cs-input { padding: 7px 10px; font-size: 13px; flex: 1; min-width: 0; }

/* Quantity section */
.cs-qty-section { margin-bottom: 20px; display: flex; flex-direction: column; gap: 12px; }
.cs-mode-row { display: flex; align-items: center; gap: 14px; }
.cs-mode-toggle {
  display: flex; background: rgba(255,255,255,0.05); border-radius: 999px;
  padding: 3px; gap: 2px;
}
.cs-mode-btn {
  border: none; background: none; color: var(--text-dim); font-size: 12.5px; font-weight: 600;
  padding: 6px 16px; border-radius: 999px; cursor: pointer;
  transition: all .2s var(--ease); font-family: inherit;
}
.cs-mode-btn.active { background: var(--accent-grad); color: #fff; }
.cs-qty-input { max-width: 220px; }
.cs-qty-textarea { min-height: 90px; }

/* Action row */
.cs-actions-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 22px; }
@media (max-width: 480px) {
  .cs-actions-row { gap: 8px; }
  .cs-actions-row .btn { flex: 1 1 calc(50% - 8px); }
  .cs-actions-row #csBtnGenerate { flex-basis: 100%; }
}

/* Live price summary */
.cs-summary {
  background: rgba(124,92,255,0.07); border: 1px solid rgba(124,92,255,0.2);
  border-radius: var(--radius); padding: 20px 24px; margin-bottom: 22px;
  animation: fadeInUp .35s var(--ease) both;
}
.cs-summary-inner {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px 8px;
}
.cs-sum-stat {
  text-align: center; padding: 6px 8px; min-width: 0;
}
.cs-sum-primary {
  grid-column: 1 / -1; padding: 4px 8px 14px; border-bottom: 1px solid rgba(124,92,255,0.18); margin-bottom: 2px;
}
.cs-sum-primary .cs-sum-val {
  background: var(--accent-grad); -webkit-background-clip: text; background-clip: text; color: transparent;
  font-size: clamp(24px, 7vw, 32px);
}
.cs-sum-val {
  font-size: 19px; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 4px;
  overflow-wrap: break-word; word-break: break-word; line-height: 1.15;
}
.cs-sum-label { font-size: 11px; color: var(--text-faint); text-transform: uppercase; letter-spacing: .04em; }
@media (max-width: 480px) {
  .cs-summary-inner { grid-template-columns: repeat(2, 1fr); gap: 16px 6px; }
  .cs-sum-val { font-size: 17px; }
}

/* Output */
.cs-output-section { animation: fadeInUp .35s var(--ease) both; }
.cs-output-head {
  display: flex; align-items: center; gap: 10px; margin-bottom: 8px;
}
.cs-output-lines { font-size: 12px; color: var(--text-faint); }
.cs-output-textarea { min-height: 160px; font-family: 'Inter', monospace; font-size: 13px; }

@media print {
  .topbar, .app-footer, .input-panel, .progress-panel, .export-row, .filters-row, .toast-stack, .view-toggle { display: none !important; }
  body { background: #fff; color: #111; }
  .panel { box-shadow: none; border: 1px solid #ddd; }
}

@media (max-width: 560px) {
  .topbar-search { display: none; }
  .run-row .btn span:not(.btn-glow) { font-size: 13px; }
}
