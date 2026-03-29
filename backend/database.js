const fs = require('fs');
const path = require('path');

// STORAGE_BASE_PATH can be set via env var (e.g. /app/storage in production)
const STORAGE_BASE_PATH = path.resolve(process.env.STORAGE_BASE_PATH || __dirname);
const dbPath = path.join(STORAGE_BASE_PATH, 'database.json');

let dbData = { titles: [], chapters: [], chapter_sections: [] };
let isInitialized = false;

// Initialize by reading local file (works with GCS FUSE mount)
async function initDb() {
  if (isInitialized) return;
  
  if (fs.existsSync(dbPath)) {
    try {
      const data = fs.readFileSync(dbPath, 'utf8');
      dbData = JSON.parse(data);
      console.log(`Database initialized from ${dbPath}`);
    } catch (e) {
      console.error('Failed to parse DB:', e.message);
    }
  } else {
    console.log(`Database file not found at ${dbPath}, starting with empty data`);
  }
  isInitialized = true;
}

// Persist to local file (works with GCS FUSE mount)
async function persist() {
  try {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(dbPath, JSON.stringify(dbData, null, 2), 'utf8');
  } catch (e) {
    console.error('Failed to save DB:', e.message);
  }
}

// Emulate simple SQLite-like interface
const promiseDb = {
  all: async (sql, params = []) => {
    await initDb();
    if (sql.includes('FROM titles')) {
      const clientId = params?.[0];
      if (clientId) {
        return dbData.titles.filter(t => t.client_id === clientId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      }
      return [...dbData.titles].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
    if (sql.includes('FROM chapters')) {
      const titleId = params?.[0];
      return dbData.chapters.filter(c => c.title_id === titleId).sort((a, b) => a.order_index - b.order_index);
    }
    if (sql.includes('FROM chapter_sections')) {
      const chapterId = params?.[0];
      const startIndex = params?.[1] || 0;
      return dbData.chapter_sections
        .filter(s => s.chapter_id === chapterId && s.section_index >= startIndex)
        .sort((a, b) => a.section_index - b.section_index);
    }
    return [];
  },
  get: async (sql, params = []) => {
    await initDb();
    if (sql.includes('FROM chapters') && sql.includes('JOIN titles')) {
        const chapterId = params?.[0];
        const clientId = params?.[1];
        const chapter = dbData.chapters.find(c => c.id === chapterId);
        if (!chapter) return null;
        // If clientId is provided, verify it; otherwise just return chapter
        if (clientId) {
            const title = dbData.titles.find(t => t.id === chapter.title_id && t.client_id === clientId);
            if (!title) return null;
            return { ...chapter, title_name: title.name };
        }
        const title = dbData.titles.find(t => t.id === chapter.title_id);
        return { ...chapter, title_name: title ? title.name : 'Unknown' };
    }
    if (sql.includes('FROM titles')) {
      return dbData.titles.find(t => t.id === params?.[0] && (!params?.[1] || t.client_id === params?.[1]));
    }
    if (sql.includes('FROM chapters')) {
        if (sql.includes('MAX(order_index)')) {
            const titleId = params?.[0];
            const titleChapters = dbData.chapters.filter(c => c.title_id === titleId);
            if (titleChapters.length === 0) return { max_order: null };
            return { max_order: Math.max(...titleChapters.map(c => c.order_index)) };
        }
        return dbData.chapters.find(c => c.id === params?.[0]);
    }
    return null;
  },
  run: async (sql, params = []) => {
    await initDb();
    if (sql.includes('INSERT INTO titles')) {
      dbData.titles.push({ id: params?.[0], client_id: params?.[1], name: params?.[2], created_at: new Date().toISOString() });
    } else if (sql.includes('INSERT INTO chapters')) {
      dbData.chapters.push({ 
        id: params?.[0], 
        title_id: params?.[1], 
        order_index: params?.[2], 
        content: params?.[3], 
        voice_id: params?.[4],
        name: params?.[5] || null,
        created_at: new Date().toISOString() 
      });
    } else if (sql.includes('INSERT INTO chapter_sections')) {
      dbData.chapter_sections.push({ id: params?.[0], chapter_id: params?.[1], section_index: params?.[2], content: params?.[3], status: 'pending', audio_file_path: null });
    } else if (sql.includes('UPDATE titles')) {
      const title = dbData.titles.find(t => t.id === params?.[1]);
      if (title) title.name = params?.[0];
    } else if (sql.includes('UPDATE chapters')) {
      const chapter = dbData.chapters.find(c => c.id === params?.[1]);
      if (chapter) chapter.name = params?.[0];
    } else if (sql.includes('DELETE FROM titles')) {
      const id = params?.[0];
      dbData.titles = dbData.titles.filter(t => t.id !== id);
      dbData.chapters = dbData.chapters.filter(c => c.title_id !== id);
    } else if (sql.includes('DELETE FROM chapters')) {
      const id = params?.[0];
      dbData.chapters = dbData.chapters.filter(c => c.id !== id);
      dbData.chapter_sections = dbData.chapter_sections.filter(s => s.chapter_id !== id);
    } else if (sql.includes('UPDATE chapter_sections')) {
      const section = dbData.chapter_sections.find(s => s.id === params?.[2]);
      if (section) {
        section.status = params?.[0];
        section.audio_file_path = params?.[1];
      }
    }
    await persist();
    return { lastID: params?.[0] };
  },
  insertSections: async (sections) => {
    await initDb();
    dbData.chapter_sections.push(...sections);
    await persist();
  }
};

module.exports = { promiseDb };
