// Stockage local des vidéos (IndexedDB), morceau par morceau.
const DB_NAME = 'confessionnal';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) {
        const s = db.createObjectStore('chunks', { keyPath: ['videoId', 'seq'] });
        s.createIndex('byVideo', 'videoId');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

function reqP(r) {
  return new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
}

export const db = {
  putVideo(v) { return tx('videos', 'readwrite', (s) => { s.put(v); }); },
  getVideo(id) { return tx('videos', 'readonly', (s) => reqP(s.get(id))); },
  allVideos() { return tx('videos', 'readonly', (s) => reqP(s.getAll())); },
  putChunk(videoId, seq, buf) { return tx('chunks', 'readwrite', (s) => { s.put({ videoId, seq, buf, at: Date.now() }); }); },
  async videoBlob(v) {
    const chunks = await tx('chunks', 'readonly', (s) => reqP(s.index('byVideo').getAll(IDBKeyRange.only(v.id))));
    chunks.sort((a, b) => a.seq - b.seq);
    return new Blob(chunks.map((c) => c.buf), { type: v.mime });
  },
  async lastChunkAt(id) {
    const chunks = await tx('chunks', 'readonly', (s) => reqP(s.index('byVideo').getAll(IDBKeyRange.only(id))));
    let bytes = 0, at = 0;
    for (const c of chunks) { bytes += c.buf.byteLength; at = Math.max(at, c.at); }
    return { bytes, at, count: chunks.length };
  }
};
