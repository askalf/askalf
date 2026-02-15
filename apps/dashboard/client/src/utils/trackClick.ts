const API_BASE = window.location.hostname.includes('askalf.org')
  ? ''
  : 'http://localhost:3005';

export function trackClick(link: string) {
  fetch(`${API_BASE}/api/v1/demo/track-click`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ link }),
  }).catch(() => {}); // fire-and-forget
}
