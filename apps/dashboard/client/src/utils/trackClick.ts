const API_BASE = (() => {
  const host = window.location.hostname;
  if (host.includes('orcastr8r.com') || host.includes('integration.tax') || host.includes('amnesia.tax')) return '';
  return 'http://localhost:3001';
})();

export function trackClick(link: string) {
  fetch(`${API_BASE}/api/v1/demo/track-click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link }),
  }).catch(() => {}); // fire-and-forget
}
