// Using native fetch since it's simple enough

const API_BASE = import.meta.env.VITE_API_BASE_URL || '/api';

// Retrieve stored client_id from localStorage
const getLocalClientId = () => localStorage.getItem('client_id');

// Save client_id to localStorage if present in response headers
const handleResponseHeaders = (headers) => {
  const cid = headers.get('x-client-id');
  if (cid) {
    localStorage.setItem('client_id', cid);
  }
};

// Set up credentials for cross-origin requests
const fetchOptions = (options = {}, token = null) => {
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const localCid = getLocalClientId();
  if (localCid) {
    headers['X-Client-ID'] = localCid;
  }

  return {
    ...options,
    credentials: 'include',
    headers
  };
};

const request = async (url, options = {}, token = null) => {
  const res = await fetch(url, fetchOptions(options, token));
  handleResponseHeaders(res.headers);
  return res;
};

export const api = {
  getTitles: async (token) => {
    const res = await request(`${API_BASE}/titles`, {}, token);
    if (!res.ok) throw new Error('Failed to fetch titles');
    return res.json();
  },
  createTitle: async (name, aiCastingEnabled, ttsTier = 'basic', narratorVoice = null, token) => {
    const res = await request(`${API_BASE}/titles`, {
      method: 'POST',
      body: JSON.stringify({ name, ai_casting_enabled: aiCastingEnabled, tts_tier: ttsTier, narrator_voice: narratorVoice })
    }, token);
    if (!res.ok) throw new Error('Failed to create title');
    return res.json();
  },
  castChapter: async (chapterId, token) => {
    const res = await request(`${API_BASE}/chapters/${chapterId}/cast`, {
      method: 'POST'
    }, token);
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to cast chapter');
    }
    return res.json();
  },
  updateTitle: async (id, data, token) => {
    const res = await request(`${API_BASE}/titles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }, token);
    if (!res.ok) throw new Error('Failed to update title');
    return res.json();
  },
  deleteTitle: async (id, token) => {
    const res = await request(`${API_BASE}/titles/${id}`, {
      method: 'DELETE'
    }, token);
    if (!res.ok) throw new Error('Failed to delete title');
    return res.json();
  },
  getChapters: async (titleId, token) => {
    const res = await request(`${API_BASE}/titles/${titleId}/chapters`, {}, token);
    if (!res.ok) throw new Error('Failed to fetch chapters');
    return res.json();
  },
  getChapter: async (id, token) => {
    const res = await request(`${API_BASE}/chapters/${id}`, {}, token);
    if (!res.ok) throw new Error('Failed to fetch chapter');
    return res.json();
  },
  createChapter: async (titleId, content, voiceId, name, token) => {
    const res = await request(`${API_BASE}/titles/${titleId}/chapters`, {
      method: 'POST',
      body: JSON.stringify({ content, voice_id: voiceId, name })
    }, token);
    if (!res.ok) throw new Error('Failed to create chapter');
    return res.json();
  },
  updateChapter: async (id, data, token) => {
    const res = await request(`${API_BASE}/chapters/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data)
    }, token);
    if (!res.ok) throw new Error('Failed to update chapter');
    return res.json();
  },
  deleteChapter: async (id, token) => {
    const res = await request(`${API_BASE}/chapters/${id}`, {
      method: 'DELETE'
    }, token);
    if (!res.ok) throw new Error('Failed to delete chapter');
    return res.json();
  },
  getVoices: async (tier = null, token = null) => {
    let actualTier = tier;
    let actualToken = token;
    if (typeof tier === 'string' && (tier.startsWith('eyJ') || tier.length > 50) && !token) {
      actualToken = tier;
      actualTier = null;
    }
    const url = actualTier ? `${API_BASE}/voices?tier=${actualTier}` : `${API_BASE}/voices`;
    const res = await request(url, {}, actualToken);
    if (!res.ok) throw new Error('Failed to fetch voices');
    return res.json();
  },
  prepareChapterDownload: async (chapterId, token, signal) => {
    const res = await fetch(`${API_BASE}/chapters/${chapterId}/prepare`, fetchOptions({
      method: 'POST',
      signal
    }, token));
    if (!res.ok) throw new Error('Failed to prepare chapter download');
    return res.json();
  },
  getStreamUrl: (chapterId, offset = 0, token = null) => {
    let url = `${API_BASE}/chapters/${chapterId}/stream?offset=${offset}`;
    if (token) url += `&token=${encodeURIComponent(token)}`;
    const localCid = getLocalClientId();
    if (localCid) url += `&client_id=${encodeURIComponent(localCid)}`;
    return url;
  },
  claimBooks: async (token) => {
    const res = await request(`${API_BASE}/auth/claim`, {
      method: 'POST'
    }, token);
    if (!res.ok) throw new Error('Failed to claim books');
    return res.json();
  },
  fetchGoogleDoc: async (documentId, googleAccessToken, firebaseToken) => {
    const res = await request(`${API_BASE}/google-docs/fetch`, {
      method: 'POST',
      body: JSON.stringify({ documentId, googleAccessToken })
    }, firebaseToken);
    if (!res.ok) {
      const errorData = await res.json();
      throw new Error(errorData.error || 'Failed to fetch Google Document');
    }
    return res.json();
  }
};
