import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { db } from '../lib/firebase';
import { doc, collection, query, where, getDoc, getDocs, orderBy } from 'firebase/firestore';

export default function Player() {
  const { chapterId } = useParams();
  const audioRef = useRef(null);
  const sliderRef = useRef(null);
  const { user, getToken, loading: authLoading } = useAuth();
  
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isBuffering, setIsBuffering] = useState(true);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubTime, setScrubTime] = useState(0);
  const [chapter, setChapter] = useState(null);
  const [currentSectionIndex, setCurrentSectionIndex] = useState(0);
  const [seekToTime, setSeekToTime] = useState(null);
  const [authToken, setAuthToken] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const currentSection = chapter?.sections?.[currentSectionIndex];
  const totalDuration = chapter?.estimated_duration_seconds || duration;
  const displayCurrentTime = isScrubbing ? scrubTime : (currentSection?.estimated_start_time || 0) + currentTime;

  const handleSeekTo = (targetTime) => {
    if (!chapter?.sections) return;

    // Find the section that covers the target time
    let selectedSectionIndex = chapter.sections.findIndex((s, idx) => {
      const nextSection = chapter.sections[idx + 1];
      return targetTime >= s.estimated_start_time && (!nextSection || targetTime < nextSection.estimated_start_time);
    });

    if (selectedSectionIndex === -1) selectedSectionIndex = chapter.sections.length - 1;

    const section = chapter.sections[selectedSectionIndex];
    const timeWithinSection = targetTime - section.estimated_start_time;

    if (selectedSectionIndex === currentSectionIndex) {
      // Just seek within the current stream
      if (audioRef.current) {
        audioRef.current.currentTime = timeWithinSection;
      }
    } else {
      // Remounting the audio element via key will trigger a fresh load
      setSeekToTime(timeWithinSection);
      setCurrentSectionIndex(selectedSectionIndex);
    }
  };

  const loadChapter = useCallback(async () => {
    if (!user || !chapterId) return;
    
    try {
      setLoading(true);
      setError(null);
      const token = await getToken();
      setAuthToken(token);

      // 1. Get Chapter
      const chapterRef = doc(db, 'chapters', chapterId);
      const chapterSnap = await getDoc(chapterRef);
      
      if (!chapterSnap.exists()) {
        setError('Chapter not found');
        return;
      }
      const chapterData = { id: chapterSnap.id, ...chapterSnap.data() };

      // 2. Get Title (for title name and permission check)
      const titleRef = doc(db, 'titles', chapterData.title_id);
      const titleSnap = await getDoc(titleRef);
      
      if (!titleSnap.exists()) {
          setError('Parent book not found');
          return;
      }
      const titleData = titleSnap.data();

      // 3. Get Sections
      const q = query(
        collection(db, 'chapter_sections'),
        where('chapter_id', '==', chapterId),
        orderBy('section_index', 'asc')
      );
      const sectionsSnap = await getDocs(q);
      const sections = sectionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate estimated duration & start times for each section
      let totalEst = 0;
      const sectionsWithTime = sections.map((s) => {
        const est = (s.content?.length || 0) / 8.1 + 0.5;
        const startTime = totalEst;
        totalEst += est;
        return { ...s, estimated_start_time: startTime, estimated_duration: est };
      });

      setChapter({
        ...chapterData,
        title_name: titleData.name,
        sections: sectionsWithTime,
        estimated_duration_seconds: totalEst
      });

    } catch (e) {
      console.error('Player error:', e);
      if (e.code === 'permission-denied') {
        setError('You do not have permission to listen to this chapter.');
      } else {
        setError('Failed to load player data.');
      }
    } finally {
      setLoading(false);
    }
  }, [chapterId, getToken, user]);

  useEffect(() => {
    if (!authLoading) {
        loadChapter();
    }
  }, [loadChapter, authLoading]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onTimeUpdate = () => {
      setCurrentTime(audio.currentTime);
    };
    const onDurationChange = () => setDuration(audio.duration);
    const onWaiting = () => setIsBuffering(true);
    const onPlaying = () => setIsBuffering(false);
    const onEnded = () => {
      if (chapter?.sections && currentSectionIndex < chapter.sections.length - 1) {
        setCurrentSectionIndex(prev => prev + 1);
        setCurrentTime(0);
      } else {
        setIsPlaying(false);
      }
    };
    const onError = (e) => {
      console.error('Audio element error:', audio.error);
      setIsBuffering(false);
    };

    audio.addEventListener('play', onPlay);
    audio.addEventListener('pause', onPause);
    audio.addEventListener('timeupdate', onTimeUpdate);
    audio.addEventListener('durationchange', onDurationChange);
    audio.addEventListener('waiting', onWaiting);
    audio.addEventListener('playing', onPlaying);
    audio.addEventListener('ended', onEnded);
    audio.addEventListener('error', onError);

    return () => {
      audio.removeEventListener('play', onPlay);
      audio.removeEventListener('pause', onPause);
      audio.removeEventListener('timeupdate', onTimeUpdate);
      audio.removeEventListener('durationchange', onDurationChange);
      audio.removeEventListener('waiting', onWaiting);
      audio.removeEventListener('playing', onPlaying);
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
  }, [currentSectionIndex, chapter]);

  // Handle seeking to a specific time within a new stream
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || seekToTime === null) return;

    const onCanPlay = () => {
      if (seekToTime !== null) {
        audio.currentTime = seekToTime;
        setSeekToTime(null);
        audio.play();
      }
    };

    audio.addEventListener('canplay', onCanPlay);
    return () => audio.removeEventListener('canplay', onCanPlay);
  }, [seekToTime]);

  // Sync slider value
  useEffect(() => {
    if (sliderRef.current && !isScrubbing) {
      sliderRef.current.value = displayCurrentTime;
    }
  }, [displayCurrentTime, isScrubbing]);

  // Media Session API for background playback and lock screen controls
  useEffect(() => {
    if (!chapter || !('mediaSession' in navigator)) return;

    navigator.mediaSession.metadata = new MediaMetadata({
      title: chapter.name || `Chapter ${chapter.order_index}`,
      artist: chapter.title_name || 'AI Audio Book',
      album: 'AI Audio Book',
      artwork: [
        { src: 'https://placehold.co/96x96/7c4dff/ffffff?text=AI+Book', sizes: '96x96', type: 'image/png' },
        { src: 'https://placehold.co/512x512/7c4dff/ffffff?text=AI+Audio+Book', sizes: '512x512', type: 'image/png' },
      ]
    });

    navigator.mediaSession.setActionHandler('play', () => {
      audioRef.current?.play();
    });
    navigator.mediaSession.setActionHandler('pause', () => {
      audioRef.current?.pause();
    });
    navigator.mediaSession.setActionHandler('seekbackward', (details) => {
      const skipTime = details.seekOffset || 10;
      handleSeekTo(Math.max(displayCurrentTime - skipTime, 0));
    });
    navigator.mediaSession.setActionHandler('seekforward', (details) => {
      const skipTime = details.seekOffset || 10;
      handleSeekTo(Math.min(displayCurrentTime + skipTime, totalDuration));
    });

    return () => {
      navigator.mediaSession.setActionHandler('play', null);
      navigator.mediaSession.setActionHandler('pause', null);
      navigator.mediaSession.setActionHandler('seekbackward', null);
      navigator.mediaSession.setActionHandler('seekforward', null);
    };
  }, [chapter, currentTime, currentSectionIndex]);

  useEffect(() => {
    if ('mediaSession' in navigator) {
      navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
    }
  }, [isPlaying]);

  const togglePlay = () => {
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
  };


  const handleSliderInput = (e) => {
    setIsScrubbing(true);
    setScrubTime(parseFloat(e.target.value));
  };

  const handleSliderChange = (e) => {
    setIsScrubbing(false);
    handleSeekTo(parseFloat(e.target.value));
  };

  const handleVolume = (e) => {
    const vol = e.target.value / 100;
    if (audioRef.current) {
      audioRef.current.volume = vol;
    }
    setVolume(vol);
  };

  const formatTime = (time) => {
    if (isNaN(time)) return "0:00";
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (authLoading || (loading && !chapter && !error)) {
    return (
      <div className="flex-col items-center justify-center mt-20 gap-4">
        <md-circular-progress indeterminate></md-circular-progress>
        <span className="text-secondary">Loading player...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex-col gap-8 mt-4 max-w-2xl mx-auto items-center">
        <Link to="/" style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--md-sys-color-primary)', textDecoration: 'none' }}>
            <md-icon><span className="material-symbols-outlined">arrow_back</span></md-icon>
            <span style={{ fontWeight: 500 }}>Back to Library</span>
        </Link>
        <div style={{ 
          width: '100%',
          padding: '3rem 2rem', 
          backgroundColor: 'var(--md-sys-color-error-container)', 
          color: 'var(--md-sys-color-on-error-container)',
          borderRadius: '2.5rem',
          textAlign: 'center',
          border: '1px solid var(--md-sys-color-error)',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)'
        }}>
          <md-icon style={{ fontSize: '48px' }}><span className="material-symbols-outlined">error_outline</span></md-icon>
          <h2 style={{ fontSize: '1.5rem', marginTop: '1.5rem', marginBottom: '0.5rem' }}>{error}</h2>
          <p style={{ opacity: 0.8 }}>Please verify the link or your access permissions.</p>
          <md-filled-button onClick={() => window.location.reload()} style={{ marginTop: '2rem' }}>
            Try Again
          </md-filled-button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-col gap-8 mt-4 max-w-2xl mx-auto pb-10">
      <Link to="/" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', color: 'var(--md-sys-color-primary)', textDecoration: 'none' }}>
        <md-icon><span className="material-symbols-outlined">arrow_back</span></md-icon>
        <span style={{ fontWeight: 500 }}>Back to Library</span>
      </Link>

      <div className="surface-container animate-fade-in" style={{ 
        display: 'flex', 
        flexDirection: 'column', 
        alignItems: 'center', 
        textAlign: 'center',
        padding: '3rem 2rem',
        backgroundColor: 'var(--md-sys-color-surface-container-high)',
        borderRadius: '2.5rem',
        border: '1px solid var(--md-sys-color-outline-variant)',
        boxShadow: '0 12px 48px rgba(0,0,0,0.4)'
      }}>
        <div style={{ 
          width: '120px', 
          height: '120px', 
          borderRadius: '2.5rem', 
          backgroundColor: 'var(--md-sys-color-primary-container)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: '2rem',
          boxShadow: '0 8px 24px rgba(208, 188, 255, 0.2)'
        }}>
          <md-icon style={{ fontSize: '56px', color: 'var(--md-sys-color-on-primary-container)' }}>
            <span className="material-symbols-outlined" style={{ fontSize: '56px' }}>headphones</span>
          </md-icon>
        </div>

        <h2 style={{ fontSize: '1.75rem', color: 'var(--md-sys-color-on-surface)', marginBottom: '0.5rem', fontWeight: 500 }}>
          {chapter ? (chapter.name || `Chapter ${chapter.order_index}`) : 'Loading...'}
        </h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--md-sys-color-on-surface-variant)', marginBottom: '2.5rem' }}>
           <md-icon style={{ color: 'var(--md-sys-color-primary)', fontSize: '20px' }}>
            <span className="material-symbols-outlined">book</span>
          </md-icon>
          <span style={{ fontSize: '0.95rem', letterSpacing: '0.5px', fontWeight: 500, textTransform: 'uppercase' }}>{chapter?.title_name || 'Audio Book'}</span>
        </div>

        <div className="w-full flex-col gap-6">
          {/* Progress Slider */}
          <div className="flex-col gap-2 w-full">
            <md-slider
              ref={sliderRef}
              min="0"
              max={totalDuration || 100}
              value={displayCurrentTime}
              onInput={handleSliderInput}
              onChange={handleSliderChange}
              style={{ width: '100%' }}
            ></md-slider>
            <div className="flex-row justify-between w-full text-xs text-muted" style={{ padding: '0 1rem' }}>
              <span>{formatTime(displayCurrentTime)}</span>
              <span>{formatTime(totalDuration)}</span>
            </div>
          </div>

          <div className="flex-row items-center justify-center w-full" style={{ marginTop: '1rem', position: 'relative', minHeight: '80px' }}>
            {/* Volume Control - Hidden on Mobile */}
            <div className="mobile-hide" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', width: '160px', position: 'absolute', left: 0 }}>
              <md-icon style={{ color: 'var(--md-sys-color-on-surface-variant)', fontSize: '24px' }}>
                <span className="material-symbols-outlined">
                  {volume === 0 ? 'volume_off' : volume < 0.5 ? 'volume_down' : 'volume_up'}
                </span>
              </md-icon>
              <md-slider
                min="0"
                max="100"
                value={volume * 100}
                onInput={handleVolume}
                style={{ width: '100%', '--md-slider-active-track-height': '4px', '--md-slider-inactive-track-height': '4px' }}
              ></md-slider>
            </div>

            {/* Play/Pause Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', zIndex: 1 }}>
                <md-filled-icon-button 
                   onClick={togglePlay} 
                   style={{ 
                     '--md-filled-icon-button-container-width': '80px', 
                     '--md-filled-icon-button-container-height': '80px',
                     '--md-filled-icon-button-icon-size': '40px'
                   }}
                >
                  <md-icon>
                    <span className="material-symbols-outlined" style={{ fontSize: '40px' }}>
                      {isBuffering ? 'hourglass_empty' : isPlaying ? 'pause' : 'play_arrow'}
                    </span>
                  </md-icon>
                </md-filled-icon-button>
            </div>
          </div>
        </div>

        {chapter && !loading && (
          <audio 
            ref={audioRef} 
            key={`${chapterId}-${currentSectionIndex}-${authToken}`}
            autoPlay 
            preload="auto"
            style={{ display: 'none' }}
          >
            <source src={api.getStreamUrl(chapterId, currentSectionIndex, authToken)} type="audio/mpeg" />
          </audio>
        )}

        <div style={{ 
          marginTop: '3.5rem', 
          padding: '1.25rem 2rem', 
          backgroundColor: 'var(--md-sys-color-surface-container-low)', 
          borderRadius: '1.25rem',
          fontSize: '0.85rem',
          color: 'var(--md-sys-color-on-surface-variant)',
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          lineHeight: '1.5'
        }}>
          <md-icon style={{ fontSize: '20px', color: 'var(--md-sys-color-primary)', flexShrink: 0 }}>
            <span className="material-symbols-outlined">info</span>
          </md-icon>
          <span>Audio is generated dynamically using Google Cloud TTS. Chapters are split into sections and converted on-the-fly for a seamless listening experience.</span>
        </div>
      </div>
    </div>
  );
}
