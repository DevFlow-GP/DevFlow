/**
 * Data access layer. Every page goes through this module.
 *
 * Two sources while the integration is in progress:
 * - the DevFlow backend (VITE_API_BASE_URL, default http://localhost:8000) for
 *   everything it already supports;
 * - static JSON in /public/api for page copy and screens the backend can't serve yet
 *   (landing page, dashboard, job details, and the New Project form's framework,
 *   environment and module options).
 */

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
const MOCK_BASE_URL = `${import.meta.env.BASE_URL}api`;

/** Artificial latency on mock data so loading states behave like a real round-trip. */
const SIMULATED_LATENCY_MS = 300;

const MOCK_ENDPOINTS = {
  landing: 'landing.json',
  newProject: 'new-project.json',
  dashboard: 'dashboard.json',
  job: 'job.json',
  auth: 'auth.json',
};

const TOKEN_STORAGE_KEY = 'devflow-token';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- access token -------------------------------------------------------------

let accessToken = readStoredToken();
let onUnauthorized = null;

function readStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null; // storage unavailable (private mode, blocked site data)
  }
}

export const tokenStore = {
  get: () => accessToken,
  set(token) {
    accessToken = token;
    try {
      if (token) localStorage.setItem(TOKEN_STORAGE_KEY, token);
      else localStorage.removeItem(TOKEN_STORAGE_KEY);
    } catch {
      /* keep the in-memory token */
    }
  },
};

/** The session registers here so an expired or revoked token signs the user out. */
export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

// --- errors -------------------------------------------------------------------

/** A failed API call. `message` is ready to show to the user. */
export class ApiError extends Error {
  constructor(message, { status = 0, fieldErrors = {}, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    /** For 422 responses: { fieldName: 'message' }. */
    this.fieldErrors = fieldErrors;
    /** For 429 responses: seconds until the user may try again. */
    this.retryAfter = retryAfter;
  }
}

function formatWait(seconds) {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/** FastAPI validation errors: [{ loc: ['body', 'email'], msg: '...' }, ...] */
function parseValidationErrors(detail) {
  const fieldErrors = {};
  for (const item of detail) {
    const field = item.loc?.[item.loc.length - 1] ?? 'form';
    // Pydantic prefixes custom messages with "Value error, ".
    fieldErrors[field] ??= String(item.msg ?? 'Invalid value').replace(/^Value error, /, '');
  }
  return fieldErrors;
}

async function toApiError(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    /* not JSON */
  }
  const detail = body?.detail;
  const status = response.status;

  if (status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After')) || null;
    const message = retryAfter
      ? `Too many attempts. Try again in ${formatWait(retryAfter)}.`
      : 'Too many attempts. Please try again later.';
    return new ApiError(message, { status, retryAfter });
  }
  if (status === 422 && Array.isArray(detail)) {
    const fieldErrors = parseValidationErrors(detail);
    return new ApiError(Object.values(fieldErrors)[0] ?? 'Please check the form.', { status, fieldErrors });
  }
  if (typeof detail === 'string') return new ApiError(detail, { status });
  if (status >= 500) return new ApiError('The DevFlow server ran into a problem. Please try again.', { status });
  return new ApiError(`Request failed (HTTP ${status}).`, { status });
}

// --- requests -----------------------------------------------------------------

/**
 * Calls the backend. `body` is sent as JSON. Resolves with the parsed JSON,
 * or null for empty responses (204). Rejects with an ApiError.
 * `auth: false` skips the token, for sign-in and sign-up: there a 401 means a
 * wrong password, not an expired session.
 */
async function request(method, path, { body, auth = true } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const sentToken = auth ? accessToken : null;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(`Can't reach the DevFlow server at ${API_BASE_URL}. Is the backend running?`);
  }

  if (!response.ok) {
    const error = await toApiError(response);
    // Only a token we actually sent can have expired; a wrong password is also a 401.
    if (response.status === 401 && sentToken && sentToken === accessToken) onUnauthorized?.();
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

async function getMock(endpoint) {
  const [response] = await Promise.all([
    fetch(`${MOCK_BASE_URL}/${endpoint}`, { headers: { Accept: 'application/json' } }),
    wait(SIMULATED_LATENCY_MS),
  ]);

  if (!response.ok) {
    throw new Error(`Request to ${endpoint} failed (HTTP ${response.status})`);
  }
  return response.json();
}

export const api = {
  // Backend
  register: ({ name, email, password, companyName }) =>
    request('POST', '/auth/register', {
      body: { full_name: name, email, password, ...(companyName ? { company_name: companyName } : {}) },
      auth: false,
    }),
  login: ({ email, password }) => request('POST', '/auth/login', { body: { email, password }, auth: false }),
  getSession: () => request('GET', '/session'),

  // GitHub. `access` is 'public' (public repos only) or 'private' (public and private).
  getGitHubConnection: () => request('GET', '/github/connection'),
  /** Resolves with the GitHub URL to send the browser to. */
  getGitHubAuthorizationUrl: async (access) =>
    (await request('GET', `/github/connect?access=${encodeURIComponent(access)}`)).authorization_url,
  disconnectGitHub: () => request('DELETE', '/github/connection'),
  /** Most recently updated first: { repositories, page, per_page, has_next }. */
  listGitHubRepos: ({ page = 1, perPage = 30 } = {}) =>
    request('GET', `/github/repos?page=${page}&per_page=${perPage}`),
  /** `fullName` is "owner/repo": { default_branch, branches: [{ name, protected }], has_next, ... }. */
  listGitHubBranches: (fullName, { page = 1, perPage = 100 } = {}) =>
    request('GET', `/github/repos/${fullName}/branches?page=${page}&per_page=${perPage}`),

  // Projects
  getProjects: () => request('GET', '/projects'),
  createProject: ({ repoFullName, name, branch }) =>
    request('POST', '/projects', { body: { repo_full_name: repoFullName, name, branch } }),

  // Mock data (not served by the backend yet)
  getLandingContent: () => getMock(MOCK_ENDPOINTS.landing),
  getNewProjectOptions: () => getMock(MOCK_ENDPOINTS.newProject),
  getDashboard: () => getMock(MOCK_ENDPOINTS.dashboard),
  getJob: () => getMock(MOCK_ENDPOINTS.job),
  getAuthContent: () => getMock(MOCK_ENDPOINTS.auth),
};
