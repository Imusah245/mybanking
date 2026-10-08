# Security Verification & Deployment Guide

## Security Verification Checklist

### 1. No passwords or secrets in API responses ✅

The backend enforces multiple layers of protection against leaking credentials:

- **User model** (`backend/src/models/User.js`): The `password` field has `select: false`, so Mongoose excludes it from all query results by default. Only explicit `.select('+password')` (used only in the login flow) loads the hash.
- **Auth controller** (`backend/src/controllers/authController.js`): All responses pass through `toSafeUser()`, which projects a whitelist of safe fields (`id`, `firstName`, `lastName`, `email`, `phone`, `dateOfBirth`, `address`, `role`, `createdAt`, `updatedAt`). Bcrypt hashes never appear in any response body.
- **Error middleware** (`backend/src/middleware/errorMiddleware.js`): The central error handler scrubs secrets from error messages using regex patterns that detect bcrypt hashes (`$2a$`, `$2b$`, `$2y$` patterns), JWTs (base64-encoded `eyJ…` tokens), `jwt_secret` references, and `Bearer` tokens. Any message matching these patterns is replaced with a generic `"An unexpected error occurred"` message. Unknown/unexpected errors always return the generic message — internal details are never sent to the client.

**Verified by**: 404+ backend tests (Jest) and 18 frontend security/envelope integration tests (Vitest).

---

### 2. Rate limits active ✅

The backend auth endpoints (`POST /api/auth/register`, `POST /api/auth/login`) are protected by two independent mechanisms:

- **IP-based rate limiter** (`express-rate-limit`): 5 requests per 15-minute window per IP address. Exceeding the limit returns HTTP 429 with the standard failure envelope `{ success: false, message: "Too many requests, please try again later." }`.
- **Per-email login throttle**: 5 consecutive failed logins for the same email within a 300-second rolling window triggers a 15-minute (900-second) lockout. The lockout is tracked in-memory by normalized email; a successful login clears the counter. The User record is never modified by the throttle.

Both mechanisms are server-enforced. The frontend cannot bypass them.

---

### 3. CORS restricted ✅

The backend (`backend/src/app.js`) builds CORS options from the `CORS_ALLOWLIST` environment variable:

- `CORS_ALLOWLIST` is parsed as a comma-separated list of allowed origins in `env.js`.
- The `buildCorsOptions()` function creates a `Set` of allowed origins and uses a custom `origin` callback: only origins in the set receive the `Access-Control-Allow-Origin` header. Origins not on the list receive no CORS grant (the browser blocks the response). No wildcard `*` is ever used.
- Requests with no `Origin` header (same-origin, curl, server-to-server) are allowed through, which is standard CORS behavior.
- `credentials: true` is set so the browser sends the `Authorization` header on cross-origin requests.

The frontend origin must be in the allowlist: `http://localhost:5173` for development, the Vercel production URL for production.

---

### 4. No secrets in Git ✅

Both projects have `.gitignore` files that exclude sensitive files:

| File/directory   | backend/.gitignore | frontend/.gitignore |
|------------------|:------------------:|:-------------------:|
| `.env`           | ✅                 | ✅                  |
| `node_modules/`  | ✅                 | ✅                  |
| `dist/`          | —                  | ✅                  |
| `coverage/`      | ✅                 | —                   |
| `*.local`        | —                  | ✅                  |

`JWT_SECRET` and `MONGO_URI` are only in `.env` (never committed). Both projects provide `.env.example` files that document the required variables without real values.

---

### 5. Token storage model ✅

Authentication is Bearer JWT (not cookies). The backend returns a JWT in the login/register response body and reads `Authorization: Bearer <token>` from request headers. The backend does not set cookies.

**Frontend storage**: Token is stored in `localStorage` under the key `mybanking_token`. The axios request interceptor attaches it as `Authorization: Bearer <token>` on every request.

**Tradeoffs**:
- `localStorage` is accessible to any JavaScript running on the page, making it vulnerable to XSS attacks.
- `httpOnly` cookies would be more secure against XSS (JavaScript cannot read them), but the backend does not set cookies. This is a documented design decision, not an oversight.

**Mitigations**:
- Helmet CSP headers are applied by the backend via `helmet()`.
- No user-generated HTML rendering — React escapes all interpolated content by default.
- The 401 response interceptor clears the stored token immediately, so a stolen token becomes useless once the server invalidates it (token expiry, etc.).

**Cookie flags (Secure, SameSite, HttpOnly) are NOT APPLICABLE** for this backend. Auth is purely header-based.

---

### 6. Idempotency-Key ✅ (client-side only)

The frontend sends a fresh `Idempotency-Key: <uuid>` header (via `crypto.randomUUID()`) on every `POST` to `/api/transactions/*`. However, the backend does NOT enforce idempotency server-side — there is no idempotency store.

**Double-submit prevention**: The submit button is disabled while a request is pending (`disabled` state in Deposit, Withdraw, and Transfer forms). This is the effective guard against duplicate submissions.

**Documented**: This is a forward-looking header. If the backend adds idempotency enforcement in the future, the client is already compliant.

---

## Deployment Guide

### Frontend — Vercel

| Setting            | Value                                                       |
|--------------------|-------------------------------------------------------------|
| **Framework**      | Vite (auto-detected by Vercel)                              |
| **Build command**  | `npm run build`                                             |
| **Output dir**     | `dist/`                                                     |
| **Install command**| `npm install`                                               |

**Environment variable** (set in Vercel project settings → Environment Variables):

| Variable       | Value                                              | Notes                       |
|----------------|----------------------------------------------------|-----------------------------|
| `VITE_API_URL` | The deployed backend URL (e.g. `https://mybanking-api.onrender.com`) | Must be set at build time — Vite inlines it during the build. |

**SPA routing**: A `vercel.json` file is included in `frontend/` with a rewrite rule that sends all routes to `index.html`, so client-side routing (React Router) works on page refresh and direct URL access:

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

**Build verification**: `npm run build` succeeds — 746 modules transformed, zero errors.

---

### Backend — Render

| Setting            | Value                               |
|--------------------|-------------------------------------|
| **Runtime**        | Node.js (>= 18)                    |
| **Build command**  | `npm install`                       |
| **Start command**  | `npm start` (`node src/server.js`)  |
| **Health check**   | `GET /health` → 200                |

**Environment variables** (set in Render dashboard → Environment):

| Variable          | Value                              | Notes                                            |
|-------------------|------------------------------------|--------------------------------------------------|
| `MONGO_URI`       | MongoDB Atlas connection string    | Required. See Database section below.            |
| `JWT_SECRET`      | A strong random secret             | Required. Min 32 characters recommended.         |
| `JWT_EXPIRES_IN`  | `3600` (default)                   | Optional. Token lifetime in seconds.             |
| `PORT`            | *(auto-set by Render)*             | Render injects this automatically. The backend reads `process.env.PORT` from `env.js` with a default of 5000. No code change needed. |
| `CORS_ALLOWLIST`  | The Vercel frontend URL            | Comma-separated. E.g. `https://mybanking.vercel.app`. |
| `BCRYPT_ROUNDS`   | `12` (default)                     | Optional. Cost factor for bcrypt hashing (4–31). |

---

### Database — MongoDB Atlas

1. **Create a free-tier cluster** (M0 Shared) on [MongoDB Atlas](https://www.mongodb.com/cloud/atlas).
   - Atlas M0 clusters are replica sets by default. The backend requires a replica set for multi-document transactions (transfers use `session.withTransaction()`, and registration creates User + Account atomically).

2. **Create a database user** with read/write access to the `mybanking` database.

3. **Network access**: Whitelist the Render service IP address.
   - For development, you can use `0.0.0.0/0` (allow all), but restrict to specific IPs in production.

4. **Connection string format**:
   ```
   mongodb+srv://<username>:<password>@<cluster>.mongodb.net/mybanking?retryWrites=true&w=majority
   ```
   Set this as the `MONGO_URI` environment variable on Render.

5. **Seed the database** (first deployment only):
   ```bash
   # From the backend directory, with MONGO_URI set:
   npm run seed
   ```
   This creates the admin user and two test customers. **Warning**: Seed credentials are for development only and must be changed in production.

---

### Cross-Domain Notes

Since auth uses a Bearer header (not cookies), there are **no SameSite / Secure / withCredentials cookie concerns**. The cross-origin requirements are:

1. **CORS allowlist**: The backend `CORS_ALLOWLIST` must include the exact Vercel frontend origin (e.g. `https://mybanking.vercel.app`). The backend's `buildCorsOptions()` does an exact-match check — no trailing slashes, no wildcards.

2. **Authorization header**: The backend CORS config sets `credentials: true`, which allows the browser to send the `Authorization` header on cross-origin requests. The frontend axios instance sets `withCredentials: true` for forward-compatibility, though it is inert since no cookies are involved.

3. **No proxy or same-domain deployment required**: Because there are no cookies, the frontend and backend can live on completely different domains without any issues. However, proxying through Vercel rewrites is an option if preferred for cleaner URLs.

**Common deployment pitfall**: If the frontend gets CORS errors after deployment, check that:
- The `CORS_ALLOWLIST` value on Render exactly matches the Vercel URL (protocol + domain, no trailing slash).
- The backend has been restarted after changing the environment variable.
- The Vercel URL does not have a different protocol (http vs https).
