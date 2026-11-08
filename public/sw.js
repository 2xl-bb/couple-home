const CACHE_NAME='couple-home-v13';
const CACHE_PREFIXES=['couple-home-','couple-home-static-'];
const STATIC_ASSETS=['/','/manifest.json','/style.css?v=20261108-photo-location','/pet-view.js?v=20261031-pet-design','/room-helpers.js?v=20261027-album-ai','/exifr.js?v=7.1.3','/app.js?v=20261108-photo-location','/album.js?v=20261107-exif-fix','/features.js?v=20261108-truth-answer','/entry.js','/favicon.svg','/icon-192.svg','/icon-512.svg','/icon-192.png','/icon-512.png'];

self.addEventListener('install',event=>{event.waitUntil((async()=>{
  const cache=await caches.open(CACHE_NAME);
  await Promise.allSettled(STATIC_ASSETS.map(asset=>cache.add(new Request(asset,{cache:'reload'}))));
  await self.skipWaiting();
})())});

self.addEventListener('activate',event=>{event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>name!==CACHE_NAME&&CACHE_PREFIXES.some(prefix=>name.startsWith(prefix))).map(name=>caches.delete(name)));
  await self.clients.claim();
})())});

function isStaticRequest(request,url){
  if(request.method!=='GET'||url.origin!==self.location.origin)return false;
  if(url.pathname.startsWith('/api/')||request.headers.has('range')||request.headers.has('authorization'))return false;
  if(request.destination==='video'||request.destination==='audio')return false;
  return /\.(?:html?|css|js|json|svg|png|woff2?|ttf|otf)$/i.test(url.pathname);
}

function mayCache(response){
  if(!response||!response.ok||response.type!=='basic')return false;
  const policy=(response.headers.get('cache-control')||'').toLowerCase();
  const type=(response.headers.get('content-type')||'').toLowerCase();
  return !policy.includes('no-store')&&!policy.includes('private')&&!type.startsWith('video/')&&!type.startsWith('audio/');
}

async function updateStatic(request,cache){const response=await fetch(request);if(mayCache(response))await cache.put(request,response.clone());return response}
async function staleWhileRevalidate(request){const cache=await caches.open(CACHE_NAME),cached=await cache.match(request),network=updateStatic(request,cache);if(cached){network.catch(()=>{});return cached}return network}
async function navigationNetworkFirst(request){
  const cache=await caches.open(CACHE_NAME);
  try{const response=await fetch(request);if(new URL(request.url).pathname==='/'&&mayCache(response))await cache.put('/',response.clone());return response}
  catch{return await cache.match('/')||new Response('Couple Home 暂时离线，请恢复网络后重试。',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})}
}

self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==self.location.origin||url.pathname.startsWith('/api/')||request.headers.has('range')||request.headers.has('authorization'))return;
  if(request.mode==='navigate'){event.respondWith(navigationNetworkFirst(request));return}
  if(isStaticRequest(request,url))event.respondWith(staleWhileRevalidate(request));
});
