// Using native fetch since it's simple enough

const API_BASE = '/api';

// Set up credentials for cross-origin requests
const fetchOptions = (options = {}, token = null) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return {
    ...options,
    credentials: 'include',
    headers
  };
};

export const api = {
  getTitles: async (token) => {
    const res = await fetch(`${API_BASE}/titles`, fetchOptions({}, token));
    if (!res.ok) throw new Error('Failed to fetch titles');
    return res.json();
  },
  createTitle: async (name, token) => {
    const res = await fetch(`${API_BASE}/titles`, fetchOptions({
      method: 'POST',
      body: JSON.stringify({ name })
    }, token));
    if (!res.ok) throw new Error('Failed to create title');
    return res.json();
  },
  updateTitle: async (id, name, token) => {
    const res = await fetch(`${API_BASE}/titles/${id}`, fetchOptions({
      method: 'PATCH',
      body: JSON.stringify({ name })
    }, token));
    if (!res.ok) throw new Error('Failed to update title');
    return res.json();
  },
  deleteTitle: async (id, token) => {
    const res = await fetch(`${API_BASE}/titles/${id}`, fetchOptions({
      method: 'DELETE'
    }, token));
    if (!res.ok) throw new Error('Failed to delete title');
    return res.json();
  },
  getChapters: async (titleId, token) => {
    const res = await fetch(`${API_BASE}/titles/${titleId}/chapters`, fetchOptions({}, token));
    if (!res.ok) throw new Error('Failed to fetch chapters');
    return res.json();
  },
  getChapter: async (id, token) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions({}, token));
    if (!res.ok) throw new Error('Failed to fetch chapter');
    return res.json();
  },
  createChapter: async (titleId, content, voiceId, name, token) => {
    const res = await fetch(`${API_BASE}/titles/${titleId}/chapters`, fetchOptions({
      method: 'POST',
      body: JSON.stringify({ content, voice_id: voiceId, name })
    }, token));
    if (!res.ok) throw new Error('Failed to create chapter');
    return res.json();
  },
  updateChapter: async (id, name, token) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions({
      method: 'PATCH',
      body: JSON.stringify({ name })
    }, token));
    if (!res.ok) throw new Error('Failed to update chapter');
    return res.json();
  },
  deleteChapter: async (id, token) => {
    const res = await fetch(`${API_BASE}/chapters/${id}`, fetchOptions({
      method: 'DELETE'
    }, token));
    if (!res.ok) throw new Error('Failed to delete chapter');
    return res.json();
  },
  getVoices: async (token) => {
    const res = await fetch(`${API_BASE}/voices`, fetchOptions({}, token));
    if (!res.ok) throw new Error('Failed to fetch voices');
    return res.json();
  },
  getStreamUrl: (chapterId, offset = 0, token = null) => {
    let url = `${API_BASE}/chapters/${chapterId}/stream?offset=${offset}`;
    if (token) url += `&token=${encodeURIComponent(token)}`;
    return url;
  },
  claimBooks: async (token) => {
    const res = await fetch(`${API_BASE}/auth/claim`, fetchOptions({
      method: 'POST'
    }, token));
    if (!res.ok) throw new Error('Failed to claim books');
    return res.json();
  },
  fetchGoogleDoc: async (documentId, googleAccessToken, firebaseToken) => {
    const res = await fetch(`${API_BASE}/google-docs/fetch`, fetchOptions({
      method: 'POST',
      body: JSON.stringify({ documentId, googleAccessToken })
    }, firebaseToken));
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to fetch Google Document');
    }
    return res.json();
  }
};
