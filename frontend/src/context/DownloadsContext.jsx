import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import * as offlineStorage from '../lib/offlineStorage';
import { beginDownload, endDownload } from '../lib/activeDownloads';

const DownloadsContext = createContext();

export const useDownloads = () => useContext(DownloadsContext);

// Combines both phases into a single 0-1 fraction, treating the final
// download as one more segment after the totalSections generated during
// preparation - a chapter with N sections has N+1 segments: N fill in one
// at a time as they're prepared, and the last one fills in once the (now
// fully-cached, fast) download itself finishes.
export const getDownloadProgressFraction = (dl) => {
  if (!dl) return null;
  if (dl.status === 'preparing') {
    return dl.total ? dl.progress / (dl.total + 1) : 0;
  }
  if (dl.status === 'downloading') {
    return (dl.total || 0) / ((dl.total || 0) + 1);
  }
  if (dl.status === 'downloaded') return 1;
  return null;
};

export const DownloadsProvider = ({ children }) => {
  // { [chapterId]: { status: 'none'|'preparing'|'downloading'|'downloaded'|'error', progress, total, sizeBytes, downloadedAt, audioVersion } }
  const [downloads, setDownloads] = useState({});
  const abortControllers = useRef({});

  useEffect(() => {
    offlineStorage.getAllDownloads().then((records) => {
      const initial = {};
      for (const record of records) {
        initial[record.chapterId] = {
          status: 'downloaded',
          sizeBytes: record.sizeBytes,
          downloadedAt: record.downloadedAt,
          audioVersion: record.audioVersion
        };
      }
      setDownloads(initial);
    }).catch((err) => {
      console.error('Failed to load offline downloads:', err);
    });
  }, []);

  const setStatus = (chapterId, patch) => {
    setDownloads((prev) => ({
      ...prev,
      [chapterId]: { ...prev[chapterId], ...patch }
    }));
  };

  const startDownload = async (chapter, titleName, token) => {
    const chapterId = chapter.id;
    if (abortControllers.current[chapterId]) return; // already in flight

    const controller = new AbortController();
    abortControllers.current[chapterId] = controller;
    beginDownload();
    setStatus(chapterId, { status: 'preparing', progress: 0, total: 0 });

    try {
      // Phase 1: make sure every section is generated & cached server-side
      // first. Long chapters can take minutes of TTS synthesis; doing that
      // across short, bounded polling requests avoids riding on one
      // long-lived request that could hit a timeout partway through.
      let ready = false;
      let lastGenerated = -1;
      let stallRounds = 0;
      while (!ready) {
        const data = await api.prepareChapterDownload(chapterId, token, controller.signal);
        ready = data.ready;
        setStatus(chapterId, { status: 'preparing', progress: data.generatedSections, total: data.totalSections });

        if (!ready) {
          stallRounds = data.generatedSections === lastGenerated ? stallRounds + 1 : 0;
          lastGenerated = data.generatedSections;
          if (stallRounds >= 3) throw new Error('Chapter preparation stalled');
        }
      }

      // Phase 2: everything is cached now, so this should be a fast read+transfer.
      setStatus(chapterId, { status: 'downloading', sizeBytes: 0 });
      const res = await fetch(api.getStreamUrl(chapterId, 0, token), { signal: controller.signal });
      if (!res.ok || !res.body) throw new Error('Failed to download chapter audio');

      const reader = res.body.getReader();
      const chunks = [];
      let bytesReceived = 0;

      // Transfer-Encoding: chunked has no Content-Length, so progress is a
      // running byte count rather than a percentage.
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        bytesReceived += value.byteLength;
        setStatus(chapterId, { sizeBytes: bytesReceived });
      }

      const blob = new Blob(chunks, { type: 'audio/mpeg' });
      const record = {
        chapterId,
        titleId: chapter.title_id,
        chapterName: chapter.name || `Chapter ${chapter.order_index}`,
        orderIndex: chapter.order_index,
        titleName,
        audioVersion: chapter.audio_version ?? null,
        sizeBytes: blob.size,
        downloadedAt: Date.now(),
        blob
      };
      await offlineStorage.putDownload(record);

      setStatus(chapterId, {
        status: 'downloaded',
        sizeBytes: record.sizeBytes,
        downloadedAt: record.downloadedAt,
        audioVersion: record.audioVersion
      });
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chapter download failed:', err);
        setStatus(chapterId, { status: 'error' });
      } else {
        setStatus(chapterId, { status: 'none' });
      }
    } finally {
      delete abortControllers.current[chapterId];
      endDownload();
    }
  };

  const cancelDownload = (chapterId) => {
    abortControllers.current[chapterId]?.abort();
  };

  const removeDownload = async (chapterId) => {
    await offlineStorage.deleteDownload(chapterId);
    setDownloads((prev) => {
      const next = { ...prev };
      delete next[chapterId];
      return next;
    });
  };

  const value = { downloads, startDownload, cancelDownload, removeDownload };

  return (
    <DownloadsContext.Provider value={value}>
      {children}
    </DownloadsContext.Provider>
  );
};
