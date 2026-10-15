// API base URL. Empty by default: the dev Vite proxy and a same-origin
// production deployment both work unchanged. For a SPLIT deployment (frontend
// on Vercel/Netlify, backend elsewhere) set VITE_API_BASE at build time,
// e.g. VITE_API_BASE=https://bilbilash-api.onrender.com npm run build
const BASE = import.meta.env.VITE_API_BASE || '';

let onUnauthorized = null;
export function setUnauthorizedHandler(fn) { onUnauthorized = fn; }

async function request(method, url, body, isForm = false) {
  const headers = {};
  const token = localStorage.getItem('token');
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body && !isForm) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(`${BASE}${url}`, {
      method,
      headers,
      body: body ? (isForm ? body : JSON.stringify(body)) : undefined,
    });
  } catch {
    // Dev: name the local command. Production: the deployed app must never
    // surface local port/stack hints to end users.
    throw new Error(import.meta.env.DEV
      ? 'Cannot reach the server. Is the backend running on port 5000?'
      : 'Cannot reach the server. Please check your internet connection and try again.');
  }

  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }

  // A 2xx answer that is not JSON means the request never reached the API
  // (e.g. VITE_API_BASE missing in a split deployment, so the SPA rewrite
  // answered with index.html). Fail loudly with a diagnosable message instead
  // of letting callers crash on `null.data`.
  if (res.ok && data === null && /text\/html/i.test(res.headers.get('content-type') || '')) {
    const err = new Error('The server answered with a web page instead of API data. The API base URL is wrong for this deployment.');
    err.status = 502;
    throw err;
  }

  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) {
    // Carry the HTTP status on the error so callers can react precisely
    // (e.g. login: 401/403 = clear any stale session; 5xx = keep state).
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body) => request('POST', url, body),
  put: (url, body) => request('PUT', url, body),
  patch: (url, body) => request('PATCH', url, body),
  putForm: (url, formData) => request('PUT', url, formData, true),
  postForm: (url, formData) => request('POST', url, formData, true),
  del: (url, body) => request('DELETE', url, body),
};
