// sw.js — Service Worker de MathSolver (Vanilla, sin Workbox).
// Cachés:
//   shell-vN    app (HTML/CSS/JS/omnicalc.wasm) y librerías locales /vendor/ (Nerdamer, KaTeX):
//               se precachea y se actualiza en segundo plano (stale-while-revalidate)
//   pyodide-vN  /pyodide/* (~30 MB): cache-first, se llena la 1.ª vez y no se vuelve a descargar
//   cdn-vN      reservada para recursos de jsDelivr (ya no se usan para Nerdamer ni KaTeX): cache-first
// Para forzar actualización de la app sube VERSION. Si cambias archivos de /pyodide/, sube PYODIDE.

const VERSION = 'v8';
const PYODIDE = 'v1';
const SHELL = `shell-${VERSION}`;
const PYO = `pyodide-${PYODIDE}`;
const CDN = `cdn-${VERSION}`;
const VIGENTES = [SHELL, PYO, CDN];

const PRECACHE = [
  './', 'index.html', 'style.css', 'omnicalc.wasm',
  'js/core.js', 'js/router.js', 'js/ui.js', 'js/StepsPanel.js', 'js/frac.js', 'js/aritmetica.js', 'js/fracciones.js', 'js/identidades.js', 'js/especiales.js', 'js/sistemas.js',
  'js/motorJS.js', 'js/motorPasos.js', 'js/simplificarPasos.js', 'js/motorPyodide.js', 'js/pyodideWorker.js',
  '/vendor/nerdamer/all.min.js',
  '/vendor/katex/katex.min.js',
  '/vendor/katex/katex.min.css',
  // Fuentes de KaTeX (woff2: el CSS las pide primero; los demás formatos no se usan en navegadores actuales)
  '/vendor/katex/fonts/KaTeX_AMS-Regular.woff2', '/vendor/katex/fonts/KaTeX_Caligraphic-Bold.woff2', '/vendor/katex/fonts/KaTeX_Caligraphic-Regular.woff2',
  '/vendor/katex/fonts/KaTeX_Fraktur-Bold.woff2', '/vendor/katex/fonts/KaTeX_Fraktur-Regular.woff2', '/vendor/katex/fonts/KaTeX_Main-Bold.woff2',
  '/vendor/katex/fonts/KaTeX_Main-BoldItalic.woff2', '/vendor/katex/fonts/KaTeX_Main-Italic.woff2', '/vendor/katex/fonts/KaTeX_Main-Regular.woff2',
  '/vendor/katex/fonts/KaTeX_Math-BoldItalic.woff2', '/vendor/katex/fonts/KaTeX_Math-Italic.woff2', '/vendor/katex/fonts/KaTeX_SansSerif-Bold.woff2',
  '/vendor/katex/fonts/KaTeX_SansSerif-Italic.woff2', '/vendor/katex/fonts/KaTeX_SansSerif-Regular.woff2', '/vendor/katex/fonts/KaTeX_Script-Regular.woff2',
  '/vendor/katex/fonts/KaTeX_Size1-Regular.woff2', '/vendor/katex/fonts/KaTeX_Size2-Regular.woff2', '/vendor/katex/fonts/KaTeX_Size3-Regular.woff2',
  '/vendor/katex/fonts/KaTeX_Size4-Regular.woff2', '/vendor/katex/fonts/KaTeX_Typewriter-Regular.woff2',
];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    // Un archivo que falle no debe impedir la instalación.
    const res = await Promise.allSettled(PRECACHE.map((u) => {
      const req = u.startsWith('http') ? new Request(u, { mode: 'no-cors' }) : u;
      return shell.add(req);
    }));
    res.forEach((r, i) => { if (r.status === 'rejected') console.warn('[sw] no se pudo precargar:', PRECACHE[i], r.reason?.message ?? ''); });
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (!VIGENTES.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const guardable = (r) => r && (r.status === 200 || r.type === 'opaque');

async function cacheFirst(req, nombre) {
  const cache = await caches.open(nombre);
  const hit = await cache.match(req, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (guardable(res)) cache.put(req, res.clone()).catch(() => {});
  return res;
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(req, { ignoreSearch: true });
  const red = fetch(req).then((res) => { if (res.status === 200) cache.put(req, res.clone()).catch(() => {}); return res; });
  if (hit) { red.catch(() => {}); return hit; }
  return red;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || req.headers.has('range')) return; // deja pasar peticiones parciales
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    if (url.pathname === '/sw.js') return;
    if (url.pathname.includes('/pyodide/')) { e.respondWith(cacheFirst(req, PYO)); return; }
    e.respondWith(
      staleWhileRevalidate(req).catch(async () => (await caches.match('index.html')) || new Response('Sin conexión', { status: 503 })),
    );
    return;
  }
  if (url.hostname === 'cdn.jsdelivr.net') e.respondWith(cacheFirst(req, CDN));
});
