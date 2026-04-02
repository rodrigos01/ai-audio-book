import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { doc, collection, query, where, onSnapshot, orderBy, getDoc } from 'firebase/firestore';

export default function TitleDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [title, setTitle] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [newContent, setNewContent] = useState('');
  const [chapterName, setChapterName] = useState('');
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [editChapterName, setEditChapterName] = useState('');
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [previewingId, setPreviewingId] = useState(null);
  const [deleteChapterId, setDeleteChapterId] = useState(null);
  const [error, setError] = useState(null);
  
  const { user, getToken } = useAuth();

  useEffect(() => {
    if (!user || !id) return;

    setLoading(true);
    setError(null);

    // 1. Fetch Title for metadata and permission check
    const titleRef = doc(db, 'titles', id);
    getDoc(titleRef).then(snap => {
      if (!snap.exists()) {
        setError('Book not found');
      } else {
        setTitle({ id: snap.id, ...snap.data() });
      }
    }).catch(err => {
      if (err.code === 'permission-denied') {
        setError('You do not have permission to access this book.');
      } else {
        setError('Failed to load book details.');
      }
    });

    // 2. Subscribe to Chapters
    const q = query(
      collection(db, 'chapters'),
      where('title_id', '==', id),
      orderBy('order_index', 'asc')
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setChapters(data);
      if (voices.length > 0) setLoading(false);
    }, (error) => {
      console.error("Chapters Firestore Error:", error);
      if (error.code === 'permission-denied') {
        setError('You do not have permission to access these chapters.');
      }
    });

    return unsubscribe;
  }, [id, user, voices.length]);

  const loadVoices = useCallback(async () => {
    try {
      const token = await getToken();
      const data = await api.getVoices(token);
      setVoices(data);
      if (data.length > 0) setSelectedVoice(data[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const handlePreviewVoice = (voice) => {
    if (previewingId === voice.id) {
        setPreviewingId(null);
        return;
    }
    const audio = new Audio(voice.sampleUrl);
    setPreviewingId(voice.id);
    audio.play();
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => {
        console.error('Failed to play sample');
        setPreviewingId(null);
    };
  };

  const handleAddChapter = async (e) => {
    e.preventDefault();
    if (!newContent.trim() || !selectedVoice) return;
    setCreating(true);
    try {
      const token = await getToken();
      await api.createChapter(id, newContent, selectedVoice, chapterName, token);
      setNewContent('');
      setChapterName('');
    } catch (e) {
      console.error(e);
    } finally {
      setCreating(false);
    }
  };

  const handleRenameChapter = async (chapterId) => {
    if (!editChapterName.trim()) return;
    try {
      const token = await getToken();
      await api.updateChapter(chapterId, editChapterName, token);
      setEditingChapterId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleDeleteChapter = async (chapterId) => {
    try {
      const token = await getToken();
      await api.deleteChapter(chapterId, token);
      setDeleteChapterId(null);
    } catch (e) {
      console.error(e);
    }
  };

  return (
    <div className="flex-col gap-8 pb-10">
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--md-sys-color-primary)', textDecoration: 'none', paddingLeft: '0.5rem' }}>
        <md-icon><span className="material-symbols-outlined">arrow_back</span></md-icon>
        <span style={{ fontWeight: 500 }}>Back to Library</span>
      </Link>

      {error && (
        <div style={{ 
          padding: '2rem', 
          backgroundColor: 'var(--md-sys-color-error-container)', 
          color: 'var(--md-sys-color-on-error-container)',
          borderRadius: '1.5rem',
          textAlign: 'center',
          border: '1px solid var(--md-sys-color-error)'
        }}>
          <md-icon><span className="material-symbols-outlined">error</span></md-icon>
          <h2 style={{ fontSize: '1.25rem', marginTop: '1rem' }}>{error}</h2>
          <p>Please check the URL or your permissions.</p>
        </div>
      )}

      {/* Content Section */}
      {!error && (
        <>
          <section className="animate-fade-in">
            <h2 style={{ fontSize: '1.5rem', color: 'var(--md-sys-color-on-surface)', marginBottom: '1.5rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.75rem', paddingLeft: '0.5rem' }}>
              <md-icon><span className="material-symbols-outlined">book</span></md-icon>
              {title?.name || 'Loading Book...'}
            </h2>
            
            {loading ? (
              <md-linear-progress indeterminate style={{ width: '100%', borderRadius: '4px' }}></md-linear-progress>
            ) : chapters.length === 0 ? (
              <div className="surface-container" style={{ backgroundColor: 'var(--md-sys-color-surface-container-lowest)', textAlign: 'center', padding: '4rem 2rem' }}>
                <md-icon style={{ fontSize: '48px', opacity: 0.3, marginBottom: '1rem' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: '48px' }}>notes</span>
                </md-icon>
                <p className="text-muted">No chapters yet. Add your first chapter below!</p>
              </div>
            ) : (
              <md-list style={{ borderRadius: '1.5rem', overflow: 'hidden', backgroundColor: 'var(--md-sys-color-surface-container)' }}>
                {chapters.map((chapter) => (
                  <div key={chapter.id}>
                    {deleteChapterId === chapter.id ? (
                      <md-list-item>
                        <div slot="headline">Delete "{chapter.name || `Chapter ${chapter.order_index}`}"?</div>
                        <div slot="supporting-text">Audio files for this chapter will be permanently removed. This cannot be undone.</div>
                        <div slot="end" style={{ display: 'flex', gap: '0.5rem' }}>
                          <md-filled-button onClick={() => handleDeleteChapter(chapter.id)} style={{ '--md-filled-button-container-color': 'var(--danger-color)', '--md-filled-button-label-text-color': 'white' }}>Delete</md-filled-button>
                          <md-outlined-button onClick={() => setDeleteChapterId(null)}>Cancel</md-outlined-button>
                        </div>
                      </md-list-item>
                    ) : (
                      <md-list-item 
                        type="button" 
                        onClick={() => editingChapterId !== chapter.id && navigate(`/player/${chapter.id}`)}
                        style={{'--md-list-item-label-text-color': 'var(--md-sys-color-on-surface)'}}
                      >
                        <div slot="start" style={{ 
                          width: '40px', 
                          height: '40px', 
                          borderRadius: '50%', 
                          backgroundColor: 'var(--md-sys-color-surface-container-high)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 'bold',
                          color: 'var(--md-sys-color-primary)',
                          fontSize: '0.9rem'
                        }}>
                          {chapter.order_index}
                        </div>

                        {editingChapterId === chapter.id ? (
                          <div slot="headline" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.5rem 0' }} onClick={(e) => e.stopPropagation()}>
                            <md-outlined-text-field
                              label="Rename Chapter"
                              value={editChapterName}
                              onInput={(e) => setEditChapterName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleRenameChapter(chapter.id);
                                if (e.key === 'Escape') setEditingChapterId(null);
                              }}
                              autoFocus
                              style={{ flex: 1 }}
                            ></md-outlined-text-field>
                            <md-icon-button onClick={() => handleRenameChapter(chapter.id)}>
                              <md-icon style={{ color: 'var(--success-color)' }}><span className="material-symbols-outlined">check</span></md-icon>
                            </md-icon-button>
                            <md-icon-button onClick={() => setEditingChapterId(null)}>
                              <md-icon style={{ color: 'var(--danger-color)' }}><span className="material-symbols-outlined">close</span></md-icon>
                            </md-icon-button>
                          </div>
                        ) : (
                          <>
                            <div slot="headline" style={{ fontWeight: 500 }}>{chapter.name || `Chapter ${chapter.order_index}`}</div>
                            <div slot="supporting-text">Added {new Date(chapter.created_at).toLocaleDateString()}</div>
                          </>
                        )}

                        <div slot="end" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          {editingChapterId !== chapter.id && (
                            <>
                              <md-icon-button onClick={() => { setEditingChapterId(chapter.id); setEditChapterName(chapter.name || `Chapter ${chapter.order_index}`); }}>
                                <md-icon><span className="material-symbols-outlined">edit</span></md-icon>
                              </md-icon-button>
                              <md-icon-button onClick={() => setDeleteChapterId(chapter.id)}>
                                <md-icon><span className="material-symbols-outlined">delete</span></md-icon>
                              </md-icon-button>
                            </>
                          )}
                          <md-icon style={{ color: 'var(--md-sys-color-primary)', marginRight: '0.5rem' }}><span className="material-symbols-outlined">play_circle</span></md-icon>
                        </div>
                      </md-list-item>
                    )}
                    <md-divider></md-divider>
                  </div>
                ))}
              </md-list>
            )}
          </section>

          {/* Add Chapter Section */}
          <section className="surface-container animate-fade-in" style={{ 
            animationDelay: '0.1s',
            display: 'flex',
            flexDirection: 'column',
            gap: '2rem',
            backgroundColor: 'var(--md-sys-color-surface-container-low)',
            border: '1px solid var(--md-sys-color-outline-variant)'
          }}>
            <h2 style={{ fontSize: '1.25rem', color: 'var(--md-sys-color-on-surface)', fontWeight: 400, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
              <md-icon><span className="material-symbols-outlined">add_circle</span></md-icon>
              Generate New Chapter
            </h2>

            <form onSubmit={handleAddChapter} className="flex-col gap-6">
              <md-outlined-text-field
                label="Chapter Name (Optional)"
                placeholder="e.g. Introduction"
                value={chapterName}
                onInput={(e) => setChapterName(e.target.value)}
              ></md-outlined-text-field>

              <md-outlined-text-field
                type="textarea"
                label="Narrative Content"
                placeholder="Paste your story or text here..."
                rows="12"
                value={newContent}
                onInput={(e) => setNewContent(e.target.value)}
                style={{ width: '100%' }}
              ></md-outlined-text-field>

              <div className="flex-col gap-4">
                <h3 style={{ fontSize: '1rem', color: 'var(--md-sys-color-on-surface)', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <md-icon><span className="material-symbols-outlined">record_voice_over</span></md-icon>
                  Narrator Voice
                </h3>
                <div className="voice-grid">
                  {voices.map((voice) => (
                    <div 
                      key={voice.id}
                      onClick={() => setSelectedVoice(voice.id)}
                      style={{ 
                        padding: '1.25rem', 
                        borderRadius: '1.25rem', 
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        border: '2px solid transparent',
                        borderColor: selectedVoice === voice.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                        backgroundColor: selectedVoice === voice.id ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
                        transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)'
                      }}
                    >
                      <div className="flex-col gap-1">
                        <span style={{ fontWeight: 600, fontSize: '0.95rem', color: selectedVoice === voice.id ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface)' }}>{voice.name}</span>
                        <div className="flex-row gap-2">
                          <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)', color: 'var(--md-sys-color-on-surface-variant)' }}>{voice.gender}</span>
                          <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)', color: 'var(--md-sys-color-secondary)' }}>{voice.quality}</span>
                        </div>
                      </div>
                      <md-icon-button 
                        onClick={(e) => { e.stopPropagation(); handlePreviewVoice(voice); }}
                        style={{'--md-icon-button-icon-color': selectedVoice === voice.id ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-primary)'}}
                      >
                        <md-icon>
                          <span className="material-symbols-outlined">
                            {previewingId === voice.id ? 'pause_circle' : 'play_circle'}
                          </span>
                        </md-icon>
                      </md-icon-button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex-col gap-4" style={{ marginTop: '1rem' }}>
                <md-filled-button 
                    type="submit" 
                    disabled={!newContent.trim() || creating || !selectedVoice || undefined}
                    style={{ height: '56px', alignSelf: 'flex-end', minWidth: '280px', '--md-filled-button-container-shape': '16px' }}
                  >
                    <md-icon slot="icon"><span className="material-symbols-outlined">settings_suggest</span></md-icon>
                    {creating ? 'Transcribing & Generating...' : 'Generate Chapter Audio'}
                  </md-filled-button>
                  
                  {creating && <md-linear-progress indeterminate style={{ width: '100%', borderRadius: '4px' }}></md-linear-progress>}
              </div>
            </form>
          </section>
        </>
      )}
    </div>
  );
}
