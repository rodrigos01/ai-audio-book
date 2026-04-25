import { useEffect, useState, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { openGooglePicker } from '../lib/googlePicker';
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
  const [expandedVoiceId, setExpandedVoiceId] = useState(null);
  const [filterGender, setFilterGender] = useState(null);
  const [filterStyle, setFilterStyle] = useState(null);
  const [isChangingVoice, setIsChangingVoice] = useState(false);
  const [linkedDoc, setLinkedDoc] = useState(null); // { id: string, title: string }
  const [syncing, setSyncing] = useState(false);
  const [castingMap, setCastingMap] = useState({}); // { "Character": "voice-id" }
  const [changingCharacter, setChangingCharacter] = useState(null); // Character name being changed
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [error, setError] = useState(null);
  
  const { user, googleAccessToken, getToken, loginWithGoogle } = useAuth();

  const filteredVoices = voices.filter(v => {
    if (filterGender && v.gender !== filterGender) return false;
    if (filterStyle && v.style !== filterStyle) return false;
    return true;
  });

  const styleTags = [...new Set(voices.map(v => v.style))].sort();

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
        const data = snap.data();
        setTitle({ id: snap.id, ...data });
        if (data.casting_map) setCastingMap(data.casting_map);
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

  const handleImportGoogleDoc = async () => {
    try {
      setError(null);
      if (!googleAccessToken) {
        // Simple way to refresh token: re-trigger sign in
        await loginWithGoogle();
        // State update might be delayed, so we might need to ask the user to click again if it fails
        setError("Account re-authorized. Please click 'Import' again.");
        return;
      }
      const doc = await openGooglePicker(googleAccessToken);
      if (doc) {
        setLinkedDoc(doc);
        setChapterName(doc.title);
      }
    } catch (err) {
      setError('Failed to open Google Picker. Please ensure popups are allowed and you are signed in.');
    }
  };

  const handleAddChapter = async (e) => {
    e.preventDefault();
    if (!chapterName.trim()) return;
    if (!linkedDoc && !newContent.trim()) return;
    
    setCreating(true);
    setError(null);
    try {
      const firebaseToken = await getToken();
      let finalContent = newContent;

      if (linkedDoc) {
        setSyncing(true);
        const { content } = await api.fetchGoogleDoc(linkedDoc.id, googleAccessToken, firebaseToken);
        finalContent = content;
        setSyncing(false);
      }

      const voiceId = selectedVoice || voices[0]?.id;
      await api.createChapter(id, finalContent, voiceId, chapterName, firebaseToken);
      setChapterName('');
      setNewContent('');
      setLinkedDoc(null);
      setShowAddDialog(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
      setSyncing(false);
    }
  };

  const handleUpdateCharacterVoice = async (character, voiceId) => {
    const newMap = { ...castingMap, [character]: voiceId };
    setCastingMap(newMap);
    setIsChangingVoice(false);
    setChangingCharacter(null);
    
    try {
      const token = await getToken();
      await api.updateTitle(id, { casting_map: newMap }, token);
      // Propagation to chapters and section invalidation is now handled by the backend
    } catch (err) {
      setError(err.message);
    }
  };

  const handleRenameChapter = async (chapterId) => {
    if (!editChapterName.trim()) return;
    try {
      const token = await getToken();
      await api.updateChapter(chapterId, { name: editChapterName }, token);
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

  const VoiceSelector = ({ onSelect, currentVoiceId }) => {
    return (
      <>
        <div className="flex-col gap-4" style={{ backgroundColor: 'var(--md-sys-color-surface-container-highest)', padding: '1rem', borderRadius: '1rem', marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 500, minWidth: '60px' }}>Gender:</span>
                <md-chip-set>
                    <md-filter-chip 
                        label="Male" 
                        selected={filterGender === 'Male' || undefined}
                        onClick={() => setFilterGender(filterGender === 'Male' ? null : 'Male')}
                    ></md-filter-chip>
                    <md-filter-chip 
                        label="Female" 
                        selected={filterGender === 'Female' || undefined}
                        onClick={() => setFilterGender(filterGender === 'Female' ? null : 'Female')}
                    ></md-filter-chip>
                </md-chip-set>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
                <span style={{ fontSize: '0.8rem', fontWeight: 500, minWidth: '60px', marginTop: '8px' }}>Style:</span>
                <md-chip-set style={{ display: 'flex', flexWrap: 'wrap' }}>
                    {styleTags.map(tag => (
                        <md-filter-chip 
                            key={tag}
                            label={tag}
                            selected={filterStyle === tag || undefined}
                            onClick={() => setFilterStyle(filterStyle === tag ? null : tag)}
                        ></md-filter-chip>
                    ))}
                </md-chip-set>
            </div>
        </div>
        <div className="voice-grid">
          {filteredVoices.map((voice) => (
            <div key={voice.id} style={{ display: 'flex', flexDirection: 'column' }}>
              <div 
                onClick={() => onSelect(voice.id)}
                style={{ 
                  padding: '1.25rem', 
                  borderRadius: '1.25rem', 
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  border: '2px solid transparent',
                  borderColor: currentVoiceId === voice.id ? 'var(--md-sys-color-primary)' : 'var(--md-sys-color-outline-variant)',
                  backgroundColor: currentVoiceId === voice.id ? 'var(--md-sys-color-primary-container)' : 'var(--md-sys-color-surface-container-high)',
                  transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                  zIndex: 1
                }}
              >
                <div className="flex-col gap-1">
                  <span style={{ fontWeight: 600, fontSize: '0.95rem', color: currentVoiceId === voice.id ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-on-surface)' }}>{voice.name}</span>
                  <div className="flex-row gap-2">
                    <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)', color: 'var(--md-sys-color-on-surface-variant)' }}>{voice.gender}</span>
                    <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)', color: 'var(--md-sys-color-secondary)' }}>{voice.quality}</span>
                    <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'var(--md-sys-color-tertiary-container)', color: 'var(--md-sys-color-on-tertiary-container)' }}>{voice.style}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.25rem' }}>
                  <md-icon-button 
                    className="desktop-hide"
                    onClick={(e) => { e.stopPropagation(); setExpandedVoiceId(expandedVoiceId === voice.id ? null : voice.id); }}
                    style={{'--md-icon-button-icon-color': currentVoiceId === voice.id ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-primary)'}}
                  >
                    <md-icon><span className="material-symbols-outlined">{expandedVoiceId === voice.id ? 'info' : 'info_outline'}</span></md-icon>
                  </md-icon-button>
                  <md-icon-button 
                    onClick={(e) => { e.stopPropagation(); handlePreviewVoice(voice); }}
                    style={{'--md-icon-button-icon-color': currentVoiceId === voice.id ? 'var(--md-sys-color-on-primary-container)' : 'var(--md-sys-color-primary)'}}
                  >
                    <md-icon><span className="material-symbols-outlined">{previewingId === voice.id ? 'pause_circle' : 'play_circle'}</span></md-icon>
                  </md-icon-button>
                </div>
              </div>
              <div className={`voice-description ${expandedVoiceId === voice.id ? 'expanded' : ''}`} style={{ 
                backgroundColor: 'var(--md-sys-color-surface-container-low)',
                borderBottomLeftRadius: '1.25rem',
                borderBottomRightRadius: '1.25rem',
                marginTop: '-0.75rem',
                paddingTop: '0.75rem',
                border: '1px solid var(--md-sys-color-outline-variant)',
                borderTop: 'none'
              }}>
                <div style={{ padding: '1rem', fontSize: '0.875rem', color: 'var(--md-sys-color-on-surface-variant)', lineHeight: '1.4' }}>
                    <div style={{ fontStyle: 'italic', marginBottom: '0.5rem' }}>"{voice.personality}"</div>
                    <div style={{ opacity: 0.8 }}>{voice.description}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </>
    );
  };

  return (
    <>
    <div className="flex-col gap-8 pb-10 animate-fade-in">
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
          <section className="animate-fade-in" style={{ marginBottom: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '1rem' }}>
                <h2 style={{ fontSize: '1.75rem', color: 'var(--md-sys-color-on-surface)', margin: 0, fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <md-icon><span className="material-symbols-outlined">book</span></md-icon>
                    {title?.name || 'Loading Book...'}
                </h2>
                {title?.ai_casting_enabled && (
                    <span style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '100px', backgroundColor: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)', fontWeight: 600 }}>AI CASTING ENABLED</span>
                )}
            </div>

            {title?.ai_casting_enabled && Object.keys(castingMap).length > 0 && (
                <div style={{ 
                    display: 'flex', 
                    overflowX: 'auto', 
                    gap: '1rem', 
                    paddingBottom: '1rem', 
                    marginBottom: '1rem',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none',
                    maxWidth: '100%'
                }} className="no-scrollbar">
                    {Object.entries(castingMap).map(([character, voiceId]) => {
                        const voice = voices.find(v => v.id === voiceId);
                        const isChanging = changingCharacter === character;
                        return (
                            <div key={character} style={{ minWidth: '280px' }}>
                                <div style={{ 
                                    padding: '1rem', 
                                    borderRadius: '1rem', 
                                    backgroundColor: 'var(--md-sys-color-surface-container-high)',
                                    border: isChanging ? '2px solid var(--md-sys-color-primary)' : '1px solid var(--md-sys-color-outline-variant)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.75rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div className="flex-col">
                                            <span className="text-xs" style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600 }}>{character}</span>
                                            <span style={{ fontWeight: 600 }}>{voice?.name || 'Unknown'}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                                            <md-icon-button onClick={() => handlePreviewVoice(voice)} style={{'--md-icon-button-icon-size': '20px'}}>
                                                <md-icon><span className="material-symbols-outlined">{previewingId === voice?.id ? 'pause' : 'play_arrow'}</span></md-icon>
                                            </md-icon-button>
                                            <md-icon-button onClick={() => { setChangingCharacter(character); setIsChangingVoice(true); setFilterStyle(voice?.style); }} style={{'--md-icon-button-icon-size': '20px'}}>
                                                <md-icon><span className="material-symbols-outlined">edit</span></md-icon>
                                            </md-icon-button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
            
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
                            <div slot="supporting-text">Added {chapter.created_at?.toDate ? chapter.created_at.toDate().toLocaleDateString() : (chapter.created_at ? new Date(chapter.created_at).toLocaleDateString() : 'Just now')}</div>
                          </>
                        )}

                        <div slot="end" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          {editingChapterId !== chapter.id && (
                            <>
                              {chapter.is_ssml && (
                                 <md-icon style={{ color: 'var(--md-sys-color-tertiary)', marginRight: '0.5rem' }} title="AI Casted"><span className="material-symbols-outlined">verified</span></md-icon>
                              )}
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
        </>
      )}
    </div>

    {/* Modals & Overlays */}
    {isChangingVoice && changingCharacter && (
        <div style={{ 
            position: 'fixed', 
            top: 0, left: 0, right: 0, bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            zIndex: 3000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '1rem'
        }} onClick={() => setIsChangingVoice(false)}>
            <div style={{ 
                backgroundColor: 'var(--md-sys-color-surface)', 
                width: '100%', 
                maxWidth: '800px', 
                borderRadius: '1.75rem',
                padding: '2.5rem',
                overflowY: 'auto',
                maxHeight: '90vh',
                boxShadow: '0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2)'
            }} onClick={e => e.stopPropagation()}>
                    <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <md-icon><span className="material-symbols-outlined">person_search</span></md-icon>
                        Change Voice for {changingCharacter}
                    </h2>
                    <md-icon-button onClick={() => setIsChangingVoice(false)}>
                        <md-icon><span className="material-symbols-outlined">close</span></md-icon>
                    </md-icon-button>
                    </div>
                    <VoiceSelector 
                    onSelect={(vid) => handleUpdateCharacterVoice(changingCharacter, vid)}
                    currentVoiceId={castingMap[changingCharacter]}
                    />
            </div>
        </div>
    )}

    {showAddDialog && (
        <div style={{ 
            position: 'fixed', 
            top: 0, left: 0, right: 0, bottom: 0, 
            backgroundColor: 'rgba(0,0,0,0.5)', 
            zIndex: 3000, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center',
            padding: '1rem'
        }} onClick={() => setShowAddDialog(false)}>
            <div style={{ 
                backgroundColor: 'var(--md-sys-color-surface)', 
                width: '100%', 
                maxWidth: '700px', 
                borderRadius: '1.75rem',
                padding: '2.5rem',
                overflowY: 'auto',
                maxHeight: '90vh',
                boxShadow: '0 24px 38px 3px rgba(0,0,0,0.14), 0 9px 46px 8px rgba(0,0,0,0.12), 0 11px 15px -7px rgba(0,0,0,0.2)'
            }} onClick={e => e.stopPropagation()}>
                <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
                    <h2 style={{ margin: 0, fontSize: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        <md-icon><span className="material-symbols-outlined">add_circle</span></md-icon>
                        Add New Chapter
                    </h2>
                    <md-icon-button onClick={() => setShowAddDialog(false)}>
                        <md-icon><span className="material-symbols-outlined">close</span></md-icon>
                    </md-icon-button>
                </div>

                <form onSubmit={handleAddChapter} className="flex-col gap-6">
                    <div className="flex-row gap-4" style={{ alignItems: 'center' }}>
                    <md-outlined-text-field
                        label="Chapter Name"
                        value={chapterName}
                        onInput={(e) => setChapterName(e.target.value)}
                        style={{ flex: 1 }}
                    ></md-outlined-text-field>
                    {user && !user.isAnonymous && (
                        <md-filled-button onClick={handleImportGoogleDoc} style={{ '--md-filled-button-container-color': 'var(--md-sys-color-tertiary)' }}>
                        <md-icon slot="icon"><span className="material-symbols-outlined">cloud_download</span></md-icon>
                        Import
                        </md-filled-button>
                    )}
                    </div>

                    {linkedDoc ? (
                    <div style={{ padding: '1.5rem', borderRadius: '1.25rem', backgroundColor: 'var(--md-sys-color-secondary-container)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600 }}>{linkedDoc.title}</span>
                        <md-icon-button onClick={() => setLinkedDoc(null)}><md-icon>close</md-icon></md-icon-button>
                    </div>
                    ) : (
                    <md-outlined-text-field
                        label="Chapter Content"
                        type="textarea"
                        rows="8"
                        value={newContent}
                        onInput={(e) => setNewContent(e.target.value)}
                    ></md-outlined-text-field>
                    )}

                    <div className="flex-col gap-4">
                    <span style={{ fontWeight: 500 }}>Narrator setup</span>
                    {title?.ai_casting_enabled ? (
                        <div style={{ padding: '1rem', borderRadius: '1rem', backgroundColor: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <md-icon><span className="material-symbols-outlined">auto_awesome</span></md-icon>
                            <span style={{ fontSize: '0.9rem' }}>AI will automatically assign voices based on the text contents.</span>
                        </div>
                    ) : (
                        <div style={{ backgroundColor: 'var(--md-sys-color-surface-container-low)', padding: '1rem', borderRadius: '1rem' }}>
                            <div className="flex-row" style={{ justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                                <span style={{ fontSize: '0.9rem' }}>Selected: {voices.find(v => v.id === selectedVoice)?.name}</span>
                                <md-text-button onClick={() => setIsChangingVoice(true)}>Change</md-text-button>
                            </div>
                        </div>
                    )}
                    </div>

                    <md-filled-button 
                    type="submit" 
                    disabled={!chapterName.trim() || (!newContent.trim() && !linkedDoc) || creating || (!selectedVoice && !title?.ai_casting_enabled) || undefined}
                    style={{ height: '56px', '--md-filled-button-container-shape': '16px' }}
                    >
                    {creating ? 'Creating...' : 'Create Chapter'}
                    </md-filled-button>
                    {creating && <md-linear-progress indeterminate></md-linear-progress>}
                </form>
            </div>
        </div>
    )}

    {/* Floating Action Button */}
    <div style={{ position: 'fixed', bottom: '2.5rem', right: '2.5rem', zIndex: 1000, display: 'flex' }}>
        <md-fab 
            onClick={() => setShowAddDialog(true)}
            label="Add Chapter"
            variant="primary"
        >
            <md-icon slot="icon"><span className="material-symbols-outlined">add</span></md-icon>
        </md-fab>
    </div>
    </>
  );
}
