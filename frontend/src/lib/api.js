import axios from 'axios';

/**
 * Shared axios instance for the MyBanking API.
 *
 * baseURL defaults to the Vite env variable; falls back to localhost.
 * withCredentials is true for forward-compatibility (currently inert —
 * auth is bearer-token, not cookies).
 */
const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000',
  withCredentials: true,
});

// ── Request interceptor ────────────────────────────────────────────
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('mybanking_token');

  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }

  // Attach an Idempotency-Key for every transactional POST.
  // NOTE: the backend does NOT currently enforce idempotency; this is
  // forward-looking.  The real double-submit guard is disabling the
  // submit button while the request is pending.
  if (
    config.method === 'post' &&
    config.url &&
    config.url.includes('/api/transactions/')
  ) {
    config.headers['Idempotency-Key'] = crypto.randomUUID();
  }

  return config;
});

// ── Response interceptor ───────────────────────────────────────────
api.interceptors.response.use(
  // On success, return the full response so callers can access response.data.
  (response) => response,

  // On error, normalize into a plain { message, status } object.
  // Callers catch({ message, status }).
  (error) => {
    const message =
      error.response?.data?.message ||
      error.message ||
      'Something went wrong';
    const status = error.response?.status || 0;

    // A 401 means the token is no longer valid — clear it so route
    // guards redirect to login.
    if (status === 401) {
      localStorage.removeItem('mybanking_token');
    }

    return Promise.reject({ message, status });
  },
);

export default api;
