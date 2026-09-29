import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { openGooglePicker } from '../lib/googlePicker';
import { useAuth } from '../context/AuthContext';
import { useDownloads } from '../context/DownloadsContext';
import { db } from '../lib/firebase';
import { doc, collection, query, where, onSnapshot, orderBy } from 'firebase/firestore';

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
  const [castingMap, setCastingMap] = useState({}); // legacy: { "Character": "voice-id" }
  const [voiceEdit, setVoiceEdit] = useState({ description: '', gender: 'neutral', kind: 'named' });
  const [changingCharacter, setChangingCharacter] = useState(null); // Character name being changed
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [skipScriptGeneration, setSkipScriptGeneration] = useState(false);
  const [showImportMenu, setShowImportMenu] = useState(false);
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);
  
  const { user, googleAccessToken, getToken, loginWithGoogle } = useAuth();
  const { downloads, startDownload, removeDownload } = useDownloads();

  const titleLanguage = title?.language || 'English';
  const filteredVoices = voices.filter(v => {
    if (filterGender && (v.gender || '').toLowerCase() !== filterGender.toLowerCase()) return false;
    if (filterStyle && v.persona !== filterStyle) return false;
    return true;
  });

  const styleTags = [...new Set(voices.map(v => v.persona).filter(Boolean))].sort();

  // Characters shown in the cast strip: the new per-title `voices` map, plus any
  // legacy casting_map characters (pre-Gemini-3.8 titles) not in it.
  const titleVoices = title?.voices || {};
  const castEntries = [
    ...Object.entries(titleVoices).map(([name, entry]) => ({ name, entry })),
    ...Object.keys(castingMap)
      .filter(name => !Object.keys(titleVoices).some(k => k.toLowerCase() === name.toLowerCase()))
      .map(name => ({ name, entry: null, legacyVoiceId: castingMap[name] })),
  ];

  useEffect(() => {
    if (!user || !id) return;

    setLoading(true);
    setError(null);

    // 1. Subscribe to Title for metadata and permission check
    const titleRef = doc(db, 'titles', id);
    const unsubTitle = onSnapshot(titleRef, (snap) => {
      if (!snap.exists()) {
        setError('Book not found');
      } else {
        const data = snap.data();
        setTitle({ id: snap.id, ...data });
        if (data.casting_map) setCastingMap(data.casting_map);
      }
    }, (err) => {
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

    return () => {
      unsubTitle();
      unsubscribe();
    };
  }, [id, user, voices.length]);

  const loadVoices = useCallback(async () => {
    if (!title) return;
    try {
      const token = await getToken();
      const data = await api.getVoices({ language: title.language || 'English' }, token);
      setVoices(data);
      if (data.length > 0) setSelectedVoice(prev => prev || data[0].id);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [getToken, title?.language, !!title]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadVoices();
  }, [loadVoices]);

  const audioRef = useRef(null);
  const playPreview = (key, url) => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null; }
    if (previewingId === key) { setPreviewingId(null); return; }
    const audio = new Audio(url);
    audioRef.current = audio;
    setPreviewingId(key);
    audio.play().catch(() => setPreviewingId(null));
    audio.onended = () => setPreviewingId(null);
    audio.onerror = () => {
      console.error('Failed to play sample');
      setPreviewingId(null);
    };
  };

  // Library voice sample (synthesized on first request, then cached).
  const handlePreviewVoice = async (voice) => {
    const token = await getToken();
    playPreview(voice.id, api.getLibraryVoicePreviewUrl(voice.id, titleLanguage, token));
  };

  // Sample of a cast character's current voice.
  const handlePreviewCharacter = async (character, entry, legacyVoiceId) => {
    const token = await getToken();
    if (!entry && legacyVoiceId) {
      playPreview(`char:${character}`, api.getLibraryVoicePreviewUrl(legacyVoiceId, titleLanguage, token));
      return;
    }
    playPreview(`char:${character}`, api.getVoicePreviewUrl(id, character, token, entry?.voiceId || ''));
  };

  const handleImportGoogleDoc = async () => {
    try {
      setError(null);
      let token = googleAccessToken || sessionStorage.getItem('google_access_token');
      if (!token) {
        const loginRes = await loginWithGoogle();
        token = loginRes?.accessToken || sessionStorage.getItem('google_access_token');
      }
      if (!token) {
        setError('Could not obtain Google access token. Please sign in with Google.');
        return;
      }
      const doc = await openGooglePicker(token);
      if (doc) {
        setLinkedDoc(doc);
        setChapterName(doc.title);
      }
    } catch (err) {
      console.error('Google Picker Error:', err);
      setError('Failed to open Google Picker. Please ensure popups are allowed and you are signed in.');
    }
  };

  const handleLocalFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result || '';
      setNewContent(text);
      if (!chapterName.trim()) {
        const nameWithoutExt = file.name.replace(/\.[^/.]+$/, '');
        setChapterName(nameWithoutExt);
      }
      setLinkedDoc(null);
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleAddChapter = async (e) => {
    e.preventDefault();
    if (!chapterName.trim()) return;
    if (!linkedDoc && !newContent.trim()) return;
    
    setCreating(true);
    setError(null);
    try {
      const firebaseToken = await getToken();
      const voiceId = selectedVoice || voices[0]?.id;

      const payload = { voiceId, name: chapterName, skipScriptGeneration };
      if (linkedDoc) {
        setSyncing(true);
        payload.googleDocId = linkedDoc.id;
        payload.googleAccessToken = googleAccessToken || sessionStorage.getItem('google_access_token');
      } else {
        payload.content = newContent;
      }
      await api.createChapter(id, payload, firebaseToken);

      setChapterName('');
      setNewContent('');
      setLinkedDoc(null);
      setSkipScriptGeneration(false);
      setShowAddDialog(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setCreating(false);
      setSyncing(false);
    }
  };

  // Picks a specific library voice for a character (pins it).
  const handleUpdateCharacterVoice = async (character, voiceId) => {
    const isLegacy = !titleVoices[character];
    setIsChangingVoice(false);
    setChangingCharacter(null);
    try {
      const token = await getToken();
      if (isLegacy) {
        const newMap = { ...castingMap, [character]: voiceId };
        setCastingMap(newMap);
        await api.updateTitle(id, { casting_map: newMap }, token);
      } else {
        await api.updateTitle(id, { voices: { [character]: { voiceId } } }, token);
      }
      // Cached audio for the affected sections is invalidated by the backend.
    } catch (err) {
      setError(err.message);
    }
  };

  // Saves an edited custom-voice description / gender / kind; the backend
  // re-designs (or re-matches) the voice and invalidates that character's audio.
  const handleSaveVoiceDescription = async (character) => {
    setIsChangingVoice(false);
    setChangingCharacter(null);
    try {
      const token = await getToken();
      await api.updateTitle(id, { voices: { [character]: {
        description: voiceEdit.description,
        gender: voiceEdit.gender,
        kind: voiceEdit.kind,
      } } }, token);
    } catch (err) {
      setError(err.message);
    }
  };

  const openVoiceEditor = (character, entry) => {
    setChangingCharacter(character);
    setIsChangingVoice(true);
    setFilterGender(null);
    setFilterStyle(null);
    setVoiceEdit({
      description: entry?.description || '',
      gender: entry?.gender || 'neutral',
      kind: entry?.kind || 'named',
    });
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

  const handleDownloadChapter = async (chapter) => {
    const token = await getToken();
    await startDownload(chapter, title?.name, token);
  };

  const renderDownloadButton = (chapter) => {
    const dl = downloads[chapter.id];
    const status = dl?.status || 'none';
    const isStale = status === 'downloaded' && chapter.audio_version != null && (dl.audioVersion ?? null) !== (chapter.audio_version ?? null);

    if (status === 'preparing' || status === 'downloading') {
      const isPreparing = status === 'preparing';
      const hasProgress = isPreparing && dl?.total > 0;
      const progressValue = hasProgress ? Math.max(0, Math.min(1, dl.progress / dl.total)) : 0;
      const title = isPreparing
        ? (dl?.total ? `Preparing audio… ${dl.progress}/${dl.total}` : 'Preparing audio…')
        : 'Downloading…';
      return (
        <md-circular-progress
          indeterminate={!hasProgress}
          value={progressValue}
          title={title}
          style={{ '--md-circular-progress-size': '20px' }}
        ></md-circular-progress>
      );
    }

    if (status === 'downloaded' && !isStale) {
      return (
        <md-icon-button onClick={() => removeDownload(chapter.id)} title="Downloaded for offline listening — tap to remove">
          <md-icon style={{ color: 'var(--md-sys-color-tertiary)' }}><span className="material-symbols-outlined">download_done</span></md-icon>
        </md-icon-button>
      );
    }

    return (
      <md-icon-button onClick={() => handleDownloadChapter(chapter)} title={isStale ? 'Chapter audio was updated — tap to re-download' : 'Download for offline listening'}>
        <md-icon><span className="material-symbols-outlined">download</span></md-icon>
      </md-icon-button>
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
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {title?.ai_casting_enabled && (
                        <span style={{ fontSize: '0.75rem', padding: '4px 12px', borderRadius: '100px', backgroundColor: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)', fontWeight: 600 }}>AI CASTING ENABLED</span>
                    )}
                </div>
            </div>

            {title?.ai_casting_enabled && castEntries.length > 0 && (
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
                    {castEntries.map(({ name: character, entry, legacyVoiceId }) => {
                        const libraryVoice = entry?.origin === 'library' || !entry
                          ? voices.find(v => v.id.toLowerCase() === (entry?.voiceId || legacyVoiceId || '').toLowerCase())
                          : null;
                        const isChanging = changingCharacter === character;
                        const resolving = entry && !entry.voiceId;
                        const kindLabel = !entry ? 'Legacy' : (entry.kind === 'supporting' ? 'Supporting' : 'Named');
                        const voiceLabel = !entry
                          ? (libraryVoice?.name || 'Library voice')
                          : resolving ? 'Preparing voice…'
                          : entry.origin === 'design' ? 'Custom voice'
                          : `${libraryVoice?.name || 'Library voice'}${entry.fallback ? ' (fallback)' : ''}`;
                        return (
                            <div key={character} style={{ minWidth: '280px', maxWidth: '320px' }}>
                                <div style={{
                                    padding: '1rem',
                                    borderRadius: '1rem',
                                    backgroundColor: 'var(--md-sys-color-surface-container-high)',
                                    border: isChanging ? '2px solid var(--md-sys-color-primary)' : '1px solid var(--md-sys-color-outline-variant)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '0.5rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <div className="flex-col">
                                            <span className="text-xs" style={{ color: 'var(--md-sys-color-primary)', fontWeight: 600 }}>
                                                {character} · {kindLabel}
                                            </span>
                                            <span style={{ fontWeight: 600 }}>{voiceLabel}</span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                                            <md-icon-button
                                                disabled={resolving || undefined}
                                                onClick={() => handlePreviewCharacter(character, entry, legacyVoiceId)}
                                                style={{'--md-icon-button-icon-size': '20px'}}
                                            >
                                                <md-icon><span className="material-symbols-outlined">{previewingId === `char:${character}` ? 'pause' : 'play_arrow'}</span></md-icon>
                                            </md-icon-button>
                                            <md-icon-button onClick={() => openVoiceEditor(character, entry)} style={{'--md-icon-button-icon-size': '20px'}}>
                                                <md-icon><span className="material-symbols-outlined">edit</span></md-icon>
                                            </md-icon-button>
                                        </div>
                                    </div>
                                    {entry?.description && (
                                        <span className="text-xs" style={{ color: 'var(--md-sys-color-on-surface-variant)', lineHeight: 1.4 }}>
                                            {entry.description}
                                        </span>
                                    )}
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
                        type={chapter.ai_casting_status === 'in_progress' ? undefined : 'button'} 
                        onClick={() => editingChapterId !== chapter.id && chapter.ai_casting_status !== 'in_progress' && navigate(`/player/${chapter.id}`)}
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
                            <div slot="headline" style={{ fontWeight: 500, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                              <span>{chapter.name || `Chapter ${chapter.order_index}`}</span>
                              {chapter.ai_casting_status === 'in_progress' && (
                                <span style={{ 
                                  display: 'inline-flex', 
                                  alignItems: 'center', 
                                  gap: '6px', 
                                  fontSize: '0.75rem', 
                                  padding: '2px 10px', 
                                  borderRadius: '12px', 
                                  backgroundColor: 'var(--md-sys-color-tertiary-container)', 
                                  color: 'var(--md-sys-color-on-tertiary-container)',
                                  fontWeight: 500 
                                }}>
                                  <md-circular-progress indeterminate style={{ '--md-circular-progress-size': '14px' }}></md-circular-progress>
                                  AI Casting in progress...
                                </span>
                              )}
                              {chapter.ai_casting_status === 'failed' && (
                                <span style={{ 
                                  fontSize: '0.75rem', 
                                  padding: '2px 8px', 
                                  borderRadius: '12px', 
                                  backgroundColor: 'var(--md-sys-color-error-container)', 
                                  color: 'var(--md-sys-color-on-error-container)',
                                  fontWeight: 500 
                                }}>
                                  AI Casting Failed (Standard Audio Ready)
                                </span>
                              )}
                            </div>
                            <div slot="supporting-text">Added {chapter.created_at?.toDate ? chapter.created_at.toDate().toLocaleDateString() : (chapter.created_at ? new Date(chapter.created_at).toLocaleDateString() : 'Just now')}</div>
                          </>
                        )}

                        <div slot="end" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }} onClick={(e) => e.stopPropagation()}>
                          {editingChapterId !== chapter.id && (
                            <>
                              {chapter.ai_casting_status !== 'in_progress' && (
                                <>
                                  {chapter.is_ssml && (
                                    <md-icon style={{ color: 'var(--md-sys-color-tertiary)', marginRight: '0.5rem' }} title="AI Casted"><span className="material-symbols-outlined">verified</span></md-icon>
                                  )}
                                  {renderDownloadButton(chapter)}
                                  <md-icon-button onClick={() => { setEditingChapterId(chapter.id); setEditChapterName(chapter.name || `Chapter ${chapter.order_index}`); }}>
                                    <md-icon><span className="material-symbols-outlined">edit</span></md-icon>
                                  </md-icon-button>
                                </>
                              )}
                              <md-icon-button onClick={() => setDeleteChapterId(chapter.id)}>
                                <md-icon><span className="material-symbols-outlined">delete</span></md-icon>
                              </md-icon-button>
                            </>
                          )}
                          <md-icon-button 
                            disabled={chapter.ai_casting_status === 'in_progress' || undefined} 
                            onClick={() => chapter.ai_casting_status !== 'in_progress' && navigate(`/player/${chapter.id}`)} 
                            title={chapter.ai_casting_status === 'in_progress' ? 'AI Casting in progress...' : 'Play chapter'}
                          >
                            <md-icon style={{ color: chapter.ai_casting_status === 'in_progress' ? 'var(--md-sys-color-outline)' : 'var(--md-sys-color-primary)' }}>
                              <span className="material-symbols-outlined">play_circle</span>
                            </md-icon>
                          </md-icon-button>
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
                        Voice for {changingCharacter}
                    </h2>
                    <md-icon-button onClick={() => setIsChangingVoice(false)}>
                        <md-icon><span className="material-symbols-outlined">close</span></md-icon>
                    </md-icon-button>
                    </div>
                    {titleVoices[changingCharacter] && (
                      <div className="flex-col gap-4" style={{ backgroundColor: 'var(--md-sys-color-surface-container-highest)', padding: '1rem', borderRadius: '1rem', marginBottom: '1.5rem' }}>
                        <span style={{ fontWeight: 600 }}>Custom voice</span>
                        <span className="text-xs" style={{ color: 'var(--md-sys-color-on-surface-variant)' }}>
                          Describe only how the voice sounds (age, pitch, pace, accent). Saving designs a new voice for this character.
                        </span>
                        <textarea
                          value={voiceEdit.description}
                          onChange={(e) => setVoiceEdit(v => ({ ...v, description: e.target.value }))}
                          rows={4}
                          style={{ width: '100%', padding: '0.75rem', borderRadius: '0.75rem', border: '1px solid var(--md-sys-color-outline-variant)', backgroundColor: 'var(--md-sys-color-surface-container)', color: 'var(--md-sys-color-on-surface)', fontFamily: 'inherit', fontSize: '0.9rem', resize: 'vertical' }}
                        />
                        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                            Gender
                            <select value={voiceEdit.gender} onChange={(e) => setVoiceEdit(v => ({ ...v, gender: e.target.value }))} style={{ height: '40px', borderRadius: '0.5rem', padding: '0 0.5rem' }}>
                              <option value="female">Female</option>
                              <option value="male">Male</option>
                              <option value="neutral">Neutral</option>
                            </select>
                          </label>
                          <label style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem' }}>
                            Voice type
                            <select value={voiceEdit.kind} onChange={(e) => setVoiceEdit(v => ({ ...v, kind: e.target.value }))} style={{ height: '40px', borderRadius: '0.5rem', padding: '0 0.5rem' }}>
                              <option value="named">Named (custom-designed)</option>
                              <option value="supporting">Supporting (library)</option>
                            </select>
                          </label>
                        </div>
                        <md-filled-button onClick={() => handleSaveVoiceDescription(changingCharacter)} disabled={!voiceEdit.description.trim() || undefined}>
                          Save voice
                        </md-filled-button>
                      </div>
                    )}
                    <h3 style={{ fontSize: '1rem', fontWeight: 600, margin: '0 0 0.75rem' }}>Or pick a library voice</h3>
                    <VoiceSelector 
                      onSelect={(vid) => handleUpdateCharacterVoice(changingCharacter, vid)}
                      currentVoiceId={titleVoices[changingCharacter]?.origin === 'library' ? titleVoices[changingCharacter]?.voiceId : castingMap[changingCharacter]}
                      filteredVoices={filteredVoices}
                      filterGender={filterGender}
                      setFilterGender={setFilterGender}
                      filterStyle={filterStyle}
                      setFilterStyle={setFilterStyle}
                      styleTags={styleTags}
                      expandedVoiceId={expandedVoiceId}
                      setExpandedVoiceId={setExpandedVoiceId}
                      handlePreviewVoice={handlePreviewVoice}
                      previewingId={previewingId}
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
                    <div style={{ position: 'relative' }}>
                      <input
                        type="file"
                        ref={fileInputRef}
                        accept=".txt,text/plain"
                        style={{ display: 'none' }}
                        onChange={handleLocalFileUpload}
                      />
                      <md-filled-button
                        type="button"
                        onClick={() => setShowImportMenu(!showImportMenu)}
                        style={{ '--md-filled-button-container-color': 'var(--md-sys-color-tertiary)' }}
                      >
                        <md-icon slot="icon"><span className="material-symbols-outlined">cloud_download</span></md-icon>
                        Import
                        <md-icon slot="icon"><span className="material-symbols-outlined">arrow_drop_down</span></md-icon>
                      </md-filled-button>

                      {showImportMenu && (
                        <div
                          style={{
                            position: 'absolute',
                            right: 0,
                            top: '100%',
                            marginTop: '0.5rem',
                            backgroundColor: 'var(--md-sys-color-surface-container-high)',
                            borderRadius: '1rem',
                            border: '1px solid var(--md-sys-color-outline-variant)',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                            zIndex: 4000,
                            minWidth: '180px',
                            overflow: 'hidden'
                          }}
                        >
                          {user && !user.isAnonymous && (
                            <div
                              onClick={() => {
                                setShowImportMenu(false);
                                handleImportGoogleDoc();
                              }}
                              style={{
                                padding: '0.85rem 1.25rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '0.75rem',
                                cursor: 'pointer',
                                color: 'var(--md-sys-color-on-surface)',
                                fontSize: '0.9rem',
                                fontWeight: 500
                              }}
                              onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--md-sys-color-surface-container-highest)'}
                              onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                            >
                              <md-icon style={{ color: 'var(--md-sys-color-primary)', fontSize: '20px' }}>
                                <span className="material-symbols-outlined">cloud_download</span>
                              </md-icon>
                              <span>Google Drive</span>
                            </div>
                          )}
                          <div
                            onClick={() => {
                              setShowImportMenu(false);
                              fileInputRef.current?.click();
                            }}
                            style={{
                              padding: '0.85rem 1.25rem',
                              display: 'flex',
                              alignItems: 'center',
                              gap: '0.75rem',
                              cursor: 'pointer',
                              color: 'var(--md-sys-color-on-surface)',
                              fontSize: '0.9rem',
                              fontWeight: 500
                            }}
                            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = 'var(--md-sys-color-surface-container-highest)'}
                            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
                          >
                            <md-icon style={{ color: 'var(--md-sys-color-primary)', fontSize: '20px' }}>
                              <span className="material-symbols-outlined">upload_file</span>
                            </md-icon>
                            <span>Upload File</span>
                          </div>
                        </div>
                      )}
                    </div>
                    </div>

                    {linkedDoc ? (
                    <div style={{ padding: '1.5rem', borderRadius: '1.25rem', backgroundColor: 'var(--md-sys-color-secondary-container)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontWeight: 600 }}>{linkedDoc.title} {syncing && <span style={{ fontSize: '0.8rem', opacity: 0.8 }}>(Syncing...)</span>}</span>
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
                        <>
                        <div style={{ padding: '1rem', borderRadius: '1rem', backgroundColor: 'var(--md-sys-color-primary-container)', color: 'var(--md-sys-color-on-primary-container)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
                            <md-icon><span className="material-symbols-outlined">auto_awesome</span></md-icon>
                            <span style={{ fontSize: '0.9rem' }}>AI will automatically assign voices based on the text contents.</span>
                        </div>
                        <label style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', cursor: 'pointer', padding: '0 0.25rem' }}>
                            <md-checkbox
                                checked={skipScriptGeneration || undefined}
                                onClick={() => setSkipScriptGeneration(!skipScriptGeneration)}
                            ></md-checkbox>
                            <span style={{ fontSize: '0.9rem' }}>Skip script formatting -- my text is already a formatted script (voices will still be auto-cast).</span>
                        </label>
                        </>
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

function VoiceSelector({
  onSelect,
  currentVoiceId,
  filteredVoices,
  filterGender,
  setFilterGender,
  filterStyle,
  setFilterStyle,
  styleTags,
  expandedVoiceId,
  setExpandedVoiceId,
  handlePreviewVoice,
  previewingId
}) {
  return (
    <>
      <div className="flex-col gap-4" style={{ backgroundColor: 'var(--md-sys-color-surface-container-highest)', padding: '1rem', borderRadius: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, minWidth: '60px' }}>Gender:</span>
              <md-chip-set>
                  <md-filter-chip 
                      label="Male" 
                      selected={filterGender === 'male' || undefined}
                      onClick={() => setFilterGender(filterGender === 'male' ? null : 'male')}
                  ></md-filter-chip>
                  <md-filter-chip 
                      label="Female" 
                      selected={filterGender === 'female' || undefined}
                      onClick={() => setFilterGender(filterGender === 'female' ? null : 'female')}
                  ></md-filter-chip>
              </md-chip-set>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '1rem' }}>
              <span style={{ fontSize: '0.8rem', fontWeight: 500, minWidth: '60px', marginTop: '8px' }}>Persona:</span>
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
                  <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'rgba(0,0,0,0.2)', color: 'var(--md-sys-color-secondary)' }}>{voice.accent}</span>
                  <span className="text-xs" style={{ padding: '2px 8px', borderRadius: '4px', backgroundColor: 'var(--md-sys-color-tertiary-container)', color: 'var(--md-sys-color-on-tertiary-container)' }}>{voice.persona}</span>
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
                  <div style={{ opacity: 0.8 }}>{voice.description}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
