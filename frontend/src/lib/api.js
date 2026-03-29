// Using native fetch since it's simple enough

const API_BASE = '/api';

// Set up credentials for cross-origin requests
const fetchOptions = (options = {}) => ({
  ...options,
  credentials: 'omit', // We want to send credentials to the backend but vite serves on 5173 and backend on 3001
  // Wait, to include cookies cross-origin, it must be 'include'
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  }
});

export const api = {
  getTitles: async () => {
    const res = await fetch(`${API_BASE}/titles`, fetchOptions());
    if (!res.ok) throw new Error('Failed to fetch titles');
    return res.json();
  },
  createTitle: async (name) => {
    const res = await fetch(`${API_BASE}/titles`, fetchOptions({
      method: 'POST',
      body: JSON.stringify({ name })
    }));
    if (!res.ok) throw new Error('Failed to create title');
    return res.json();
  },
  updateTitle: async (id, name) => {
    const res = await fetch(`${API_BASE}/titles/${id}`, fetchOptions({
      method: 'PATCH',
      body: JSON.stringify({ name })
    }));
    if (!res.ok) throw new Error('Failed to update title');
    return res.json();
  },
  deleteTitle: async (id) => {
    const res = await fetch(`${API_BASE}/titles/${id}`, fetchOptions({
      method: 'DELETE'
    }));
    if (!res.ok) throw new Error('Failed to delete title');
    return res.json();
  },
  getChapters: async (titleId) => {
    const res = await fetch(`${API_BASE}/titles/${titleId}/chapters`, fetchOptions());
    if (!res.ok) throw new Error('Failed to fetch chapters');
    return res.json();
  },
  getChapter: async (id) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions());
    if (!res.ok) throw new Error('Failed to fetch chapter');
    return res.json();
  },
  createChapter: async (titleId, content, voiceId, name) => {
    const res = await fetch(`${API_BASE}/titles/${titleId}/chapters`, fetchOptions({
      method: 'POST',
      body: JSON.stringify({ content, voice_id: voiceId, name })
    }));
    if (!res.ok) throw new Error('Failed to create chapter');
    return res.json();
  },
  updateChapter: async (id, name) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions({
      method: 'PATCH',
      body: JSON.stringify({ name })
    }));
    if (!res.ok) throw new Error('Failed to update chapter');
    return res.json();
  },
  deleteChapter: async (id) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions({
      method: 'DELETE'
    }));
    if (!res.ok) throw new Error('Failed to delete chapter');
    return res.json();
  },
  getVoices: async () => {
    const res = await fetch(`${API_BASE}/voices`, fetchOptions());
    if (!res.ok) throw new Error('Failed to fetch voices');
    return res.json();
  },
  getStreamUrl: (chapterId, offset = 0) => `${API_BASE}/chapters/${chapterId}/stream${offset ? `?offset=${offset}` : ''}`
};
