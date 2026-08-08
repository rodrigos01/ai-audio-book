// IndexedDB-backed storage for chapters downloaded for in-app offline playback.
// Nothing here ever touches the filesystem or triggers a browser download —
// audio blobs live purely inside the browser's IndexedDB origin storage.

const DB_NAME = 'ai-audio-book-offline';
const DB_VERSION = 1;
const STORE_NAME = 'chapterDownloads';

let dbPromise = null;

function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'chapterId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  return dbPromise;
}

async function withStore(mode, callback) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = callback(store);

    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// record: { chapterId, titleId, chapterName, orderIndex, titleName, audioVersion, sizeBytes, downloadedAt, blob }
export async function putDownload(record) {
  await withStore('readwrite', (store) => store.put(record));
}

export async function getDownload(chapterId) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(chapterId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

export async function deleteDownload(chapterId) {
  await withStore('readwrite', (store) => store.delete(chapterId));
}

export async function getAllDownloads() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}
