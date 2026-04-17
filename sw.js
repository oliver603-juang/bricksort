// BrickSort Service Worker - Web Share Target handler
// v2026.04.17

const CACHE_NAME = 'bricksort-share-v1';

// Install: skip waiting so new SW activates immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// Activate: take control of all clients immediately
self.addEventListener('activate', (event) => {
  event.waitUntil(clients.claim());
});

// Fetch handler - intercept POST share target
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Intercept share POST requests
  if (event.request.method === 'POST' && url.searchParams.get('share') === '1') {
    event.respondWith(handleShareTarget(event.request));
    return;
  }
  
  // Default: let network handle everything else
  // (no cache for data integrity; this SW only handles share)
});

async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('image');
    const sharedText = formData.get('text') || '';
    const sharedTitle = formData.get('title') || '';
    const sharedUrl = formData.get('url') || '';
    
    // Find first image file
    let imageBlob = null;
    for (const f of files) {
      if (f && f.size > 0 && f.type && f.type.startsWith('image/')) {
        imageBlob = f;
        break;
      }
    }
    
    // Store in IndexedDB for the page to read
    await storeSharedContent({
      image: imageBlob,
      text: sharedText,
      title: sharedTitle,
      url: sharedUrl,
      timestamp: Date.now()
    });
    
    // Redirect to root with marker, so page can detect and load shared content
    return Response.redirect('./?share=received&t=' + Date.now(), 303);
  } catch (err) {
    console.error('[SW] share handler error:', err);
    return Response.redirect('./?share=error', 303);
  }
}

// Store shared payload in IndexedDB
function storeSharedContent(payload) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('bricksort-share', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('inbox', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction('inbox', 'readwrite');
      const store = tx.objectStore('inbox');
      // Clear old entries first (keep only the latest)
      store.clear();
      store.put({ id: 'latest', ...payload });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}
