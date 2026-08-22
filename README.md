# Black Node ZW API

A self-contained implementation of the original Black Node ZW API surface. The endpoint names are preserved, but the service no longer proxies third-party API providers and does not require user-supplied API keys.

## Operating modes

The API is divided into two groups. Local utilities execute entirely inside this application. Features such as social-media downloading, live weather/news/currency lookup, hosted AI generation, messaging, screenshots, and cloud storage are retained as routes but return `501 Not Implemented` until an equivalent local engine or dataset is added. This is intentional: silently calling another provider would violate the self-contained requirement.

### Native local endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/` or `/status` | Service status and capability list |
| POST | `/auth/register` | Create a local account and receive a bearer token |
| POST | `/auth/login` | Log in to a local account |
| GET | `/me` | Return the authenticated local user |
| GET | `/qrcode/generate?text=...` | Generate an SVG QR code locally |
| GET | `/random/password` | Generate a cryptographically random password |
| GET | `/random/uuid` | Generate a UUID locally |
| GET | `/random/color` | Generate a random color and RGB values |
| GET | `/email/validate?email=...` | Validate email syntax locally |
| GET | `/country?code=ZW` | Look up entries in the bundled country dataset |
| POST | `/paste/create` | Create an in-memory paste |
| GET | `/paste/:id` | Read a locally created paste |
| POST | `/url/shorten` | Create an in-memory short URL |
| GET | `/s/:alias` | Redirect through a locally created short URL |
| GET | `/fun` | Return a local quote |

### Preserved compatibility routes

The original routes remain recognized, including TikTok, YouTube, Instagram, Facebook, Twitter, Pinterest, image, AI, weather, currency, IP, news, dictionary, GitHub, Spotify, movie, messaging, storage, phone, screenshot, and other operations. In self-contained mode, operations that require remote content or a hosted model return a structured `501` response explaining why they cannot run locally yet.

## Authentication without API keys

Users do not create or paste API keys. Registration and login return a locally signed bearer token:

```bash
curl -X POST http://localhost:3000/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-secure-password","name":"You"}'
```

Use the returned token as follows:

```bash
curl http://localhost:3000/me \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

The token is signed with HMAC-SHA256. Set `JWT_SECRET` in production; the built-in fallback is only for local development.

## Local development

```bash
npm install
npm start
```

The local adapter listens on `http://127.0.0.1:3000`. Vercel can deploy the same handler from `api/index.js` using the existing `vercel.json` configuration.

## Example requests

```bash
curl 'http://localhost:3000/qrcode/generate?text=Black%20Node%20ZW'
curl 'http://localhost:3000/random/password?length=24'
curl 'http://localhost:3000/email/validate?email=you@example.com'
curl -X POST http://localhost:3000/url/shorten \
  -H 'Content-Type: application/json' \
  -d '{"url":"https://example.com"}'
```

## Persistence and future local engines

Pastes, short URLs, and accounts are currently held in memory, so they reset when the process restarts. The next production step is to replace those maps with a local database. The preserved media, live-data, AI, messaging, and screenshot routes can then be connected to local libraries, bundled datasets, or self-hosted models without changing the public endpoint contract.
