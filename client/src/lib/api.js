const BASE = import.meta.env.VITE_API_URL || '/api';

let accessToken = null;
let onUnauthorized = null;
let refreshing = null;

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

export class ApiError extends Error {
  constructor(message, status, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

async function parse(res) {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) return res.text();
  return res.json().catch(() => ({}));
}

/** Single in-flight refresh, so a burst of 401s doesn't cause a token stampede. */
async function refreshOnce() {
  refreshing ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) throw new ApiError('Session expired', 401);
      const data = await res.json();
      accessToken = data.accessToken;
      return data;
    })
    .finally(() => { refreshing = null; });
  return refreshing;
}

async function request(path, { method = 'GET', body, params, raw = false, retry = true } = {}) {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  }

  const isForm = body instanceof FormData;
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: {
      ...(isForm || !body ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: isForm ? body : body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    try {
      await refreshOnce();
      return request(path, { method, body, params, raw, retry: false });
    } catch {
      onUnauthorized?.();
      throw new ApiError('Your session expired. Sign in again.', 401);
    }
  }

  if (raw) {
    if (!res.ok) throw new ApiError('Download failed', res.status);
    return res.blob();
  }

  const data = await parse(res);
  if (!res.ok) throw new ApiError(data?.error || `Request failed (${res.status})`, res.status, data?.details);
  return data;
}

export const api = {
  get: (p, params) => request(p, { params }),
  post: (p, body, params) => request(p, { method: 'POST', body, params }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p, params) => request(p, { method: 'DELETE', params }),
  blob: (p, params) => request(p, { params, raw: true }),
  /** POST that returns a file — used by report exports, which send a spec. */
  postBlob: (p, body) => request(p, { method: 'POST', body, raw: true }),
  refresh: refreshOnce,
};

/** Hands a blob to the browser as a download. */
function saveBlob(blob, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

/** Triggers a browser download from an authenticated GET endpoint. */
export async function downloadFile(path, params, filename) {
  saveBlob(await api.blob(path, params), filename);
}

/** Same, for endpoints that need a request body rather than query params. */
export async function downloadPost(path, body, filename) {
  saveBlob(await api.postBlob(path, body), filename);
}
