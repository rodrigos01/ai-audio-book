// Tracks how many chapter downloads are currently in flight, outside React
// state, so code running before any component mounts (the service worker's
// update handler in main.jsx) can check whether it's safe to reload the
// page without aborting a user's in-progress download.
let count = 0;

export const beginDownload = () => { count += 1; };
export const endDownload = () => { count = Math.max(0, count - 1); };
export const hasActiveDownloads = () => count > 0;
