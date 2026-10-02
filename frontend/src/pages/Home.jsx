import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { collection, query, where, onSnapshot } from 'firebase/firestore';

const LANGUAGES = [
  'English', 'Spanish', 'French', 'German', 'Italian', 'Portuguese', 'Dutch', 'Russian',
  'Japanese', 'Korean', 'Chinese', 'Arabic', 'Hindi', 'Polish', 'Turkish', 'Vietnamese',
  'Thai', 'Indonesian', 'Romanian', 'Ukrainian', 'Bengali', 'Tamil', 'Telugu', 'Marathi'
];

export default function Home() {
  const [titles, setTitles] = useState([]);
  const [newTitleName, setNewTitleName] = useState('');
  const [aiCastingEnabled, setAiCastingEnabled] = useState(false);
  const [language, setLanguage] = useState('English');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState('');
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [deleteId, setDeleteId] = useState(null);

  const navigate = useNavigate();
  const { user, getToken } = useAuth();

  // Voice Library voices for the chosen language (narrator picker).
  useEffect(() => {
    api.getVoices({ language }).then(data => {
      setVoices(data);
      // With AI casting the narrator defaults to a custom-designed voice ('');
      // otherwise a concrete voice is required.
      setSelectedVoice(prev => (data.some(v => v.id === prev) || (aiCastingEnabled && prev === '')) ? prev : (aiCastingEnabled ? '' : (data[0]?.id || '')));
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'titles'),
      where('owner_id', '==', `user:${user.uid}`)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })).sort((a, b) => {
        const dateA = a.created_at?.toDate ? a.created_at.toDate() : new Date(a.created_at || 0);
        const dateB = b.created_at?.toDate ? b.created_at.toDate() : new Date(b.created_at || 0);
        return dateB - dateA;
      });

      setTitles(data);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error:", error);
      setLoading(false);
    });

    return unsubscribe;
  }, [user]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!newTitleName.trim()) return;
    try {
      const token = await getToken();
      await api.createTitle(newTitleName, aiCastingEnabled, selectedVoice || null, language, token);
      setNewTitleName('');
      setAiCastingEnabled(false);
      setLanguage('English');
    } catch (e) {
      console.error(e);
    }
  };

  const handleRename = async (id) => {
    if (!editName.trim()) return;
    try {
      const token = await getToken();
      await api.updateTitle(id, { name: editName }, token);
      setEditingId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDelete = async (id) => {
    try {
      const token = await getToken();
      await api.deleteTitle(id, token);
      setDeleteId(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-col gap-8">
      {/* Create Section */}
      <section className="surface-container animate-fade-in" style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.5rem',
        backgroundColor: 'var(--md-sys-color-surface-container-low)',
        border: '1px solid var(--md-sys-color-outline-variant)'
      }}>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--md-sys-color-on-surface)', fontWeight: 400 }}>Create New Book</h2>
        <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <md-filled-text-field
            label="Book Title"
            value={newTitleName}
            onInput={(e) => setNewTitleName(e.target.value)}
            style={{ width: '100%' }}
          ></md-filled-text-field>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            {/* AI Casting Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', backgroundColor: 'var(--md-sys-color-surface-container-high)', padding: '0.5rem 1rem', borderRadius: '0.75rem', border: '1px solid var(--md-sys-color-outline-variant)', height: '44px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <span style={{ fontSize: '0.875rem', fontWeight: 500, color: 'var(--md-sys-color-on-surface)' }}>AI Casting</span>
                <div className="tooltip-parent">
                  <md-icon-button style={{ '--md-icon-button-icon-size': '18px', width: '28px', height: '28px' }} type="button">
                    <md-icon><span className="material-symbols-outlined" style={{ fontSize: '18px', opacity: 0.7 }}>info</span></md-icon>
                  </md-icon-button>
                  <div className="tooltip-box">
                    Analyzes text to identify characters and assign consistent voices automatically.
                  </div>
                </div>
              </div>
              <md-switch
                selected={aiCastingEnabled || undefined}
                onClick={() => {
                  const nextState = !aiCastingEnabled;
                  setAiCastingEnabled(nextState);
                  // AI casting designs the narrator's voice unless one is picked.
                  setSelectedVoice(nextState ? '' : (voices[0]?.id || ''));
                }}
              ></md-switch>
            </div>

            {/* Voice Options Dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 240px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--md-sys-color-on-surface-variant)' }}>
                {aiCastingEnabled ? 'Narrator Voice' : 'Voice'}
              </label>
              <select
                value={selectedVoice}
                onChange={(e) => setSelectedVoice(e.target.value)}
                style={{
                  height: '44px',
                  padding: '0 0.75rem',
                  borderRadius: '0.75rem',
                  backgroundColor: 'var(--md-sys-color-surface-container-high)',
                  color: 'var(--md-sys-color-on-surface)',
                  border: '1px solid var(--md-sys-color-outline-variant)',
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                {aiCastingEnabled && <option value="">Custom-designed by AI</option>}
                {voices.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({[v.gender, v.persona].filter(Boolean).join(' - ')})
                  </option>
                ))}
              </select>
            </div>

            {/* Language Dropdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', flex: '1 1 240px' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--md-sys-color-on-surface-variant)' }}>Language</label>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                style={{
                  height: '44px',
                  padding: '0 0.75rem',
                  borderRadius: '0.75rem',
                  backgroundColor: 'var(--md-sys-color-surface-container-high)',
                  color: 'var(--md-sys-color-on-surface)',
                  border: '1px solid var(--md-sys-color-outline-variant)',
                  fontSize: '0.9rem',
                  cursor: 'pointer'
                }}
              >
                {LANGUAGES.map(lang => (
                  <option key={lang} value={lang}>{lang}</option>
                ))}
              </select>
            </div>
          </div>

          <md-filled-button type="submit" disabled={!newTitleName.trim() || undefined} style={{ height: '52px', width: '100%', marginTop: '0.5rem' }}>
            <md-icon slot="icon"><span className="material-symbols-outlined">add</span></md-icon>
            Create Book
          </md-filled-button>
        </form>
      </section>

      {/* Library Section */}
      <section className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
        <h2 style={{ fontSize: '1.25rem', color: 'var(--md-sys-color-on-surface)', marginBottom: '1.5rem', fontWeight: 400, paddingLeft: '0.5rem' }}>Library</h2>

        {loading ? (
          <md-linear-progress indeterminate style={{ width: '100%', borderRadius: '4px' }}></md-linear-progress>
        ) : titles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem 2rem', color: 'var(--md-sys-color-on-surface-variant)', backgroundColor: 'var(--md-sys-color-surface-container-lowest)', borderRadius: '1.5rem' }}>
            <md-icon style={{ fontSize: '64px', opacity: 0.3, marginBottom: '1.5rem' }}>
              <span className="material-symbols-outlined" style={{ fontSize: '64px' }}>library_books</span>
            </md-icon>
            <p style={{ margin: 0, fontSize: '1.1rem' }}>Your library is empty. Start by creating a new book above.</p>
          </div>
        ) : (
          <md-list style={{ borderRadius: '1.5rem', overflow: 'hidden', backgroundColor: 'var(--md-sys-color-surface-container)' }}>
            {titles.map((title) => (
              <div key={title.id}>
                {deleteId === title.id ? (
                  <md-list-item>
                    <div slot="headline">Delete "{title.name}"?</div>
                    <div slot="supporting-text">All chapters and audio files will be removed. This cannot be undone.</div>
                    <div slot="end" style={{ display: 'flex', gap: '0.5rem' }}>
                      <md-filled-button onClick={() => handleDelete(title.id)} style={{ '--md-filled-button-container-color': 'var(--danger-color)', '--md-filled-button-label-text-color': 'white' }}>Confirm</md-filled-button>
                      <md-outlined-button onClick={() => setDeleteId(null)}>Cancel</md-outlined-button>
                    </div>
                  </md-list-item>
                ) : (
                  <md-list-item
                    type="button"
                    onClick={() => editingId !== title.id && navigate(`/title/${title.id}`)}
                    style={{ '--md-list-item-label-text-color': 'var(--md-sys-color-on-surface)' }}
                  >
                    <md-icon slot="start">
                      <span className="material-symbols-outlined">book</span>
                    </md-icon>

                    {editingId === title.id ? (
                      <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0' }} onClick={(e) => e.stopPropagation()}>
                        <md-outlined-text-field
                          label="Rename Book"
                          value={editName}
                          onInput={(e) => setEditName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleRename(title.id);
                            if (e.key === 'Escape') setEditingId(null);
                          }}
                          autoFocus
                          style={{ flex: 1 }}
                        ></md-outlined-text-field>
                        <md-icon-button onClick={() => handleRename(title.id)}>
                          <md-icon style={{ color: 'var(--success-color)' }}><span className="material-symbols-outlined">check</span></md-icon>
                        </md-icon-button>
                        <md-icon-button onClick={() => setEditingId(null)}>
                          <md-icon style={{ color: 'var(--danger-color)' }}><span className="material-symbols-outlined">close</span></md-icon>
                        </md-icon-button>
                      </div>
                    ) : (
                      <>
                        <div slot="headline" style={{ fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <span>{title.name}</span>
                          {title.ai_casting_enabled && (
                            <span style={{
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              padding: '0.15rem 0.5rem',
                              borderRadius: '0.5rem',
                              backgroundColor: 'rgba(156, 39, 176, 0.15)',
                              color: '#d81b60',
                              border: '1px solid #d81b60'
                            }}>
                              AI CAST
                            </span>
                          )}
                        </div>
                        <div slot="supporting-text">Created on {title.created_at?.toDate ? title.created_at.toDate().toLocaleDateString() : (title.created_at ? new Date(title.created_at).toLocaleDateString() : 'Just now')}</div>
                      </>
                    )}

                    <div slot="end" onClick={(e) => e.stopPropagation()} style={{ display: 'flex', gap: '0.25rem' }}>
                      {editingId !== title.id && (
                        <>
                          <md-icon-button onClick={() => { setEditingId(title.id); setEditName(title.name); }}>
                            <md-icon><span className="material-symbols-outlined">edit</span></md-icon>
                          </md-icon-button>
                          <md-icon-button onClick={() => setDeleteId(title.id)}>
                            <md-icon><span className="material-symbols-outlined">delete</span></md-icon>
                          </md-icon-button>
                        </>
                      )}
                    </div>
                  </md-list-item>
                )}
                <md-divider></md-divider>
              </div>
            ))}
          </md-list>
        )}
      </section>
    </div>
  );
}
