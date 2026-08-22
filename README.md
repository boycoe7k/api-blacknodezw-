# Black Node ZW API

A self-contained REST API platform built from scratch with Node.js. This version does **not** proxy TikTok, YouTube, Instagram, weather, AI, news, or any other third-party API. It also does **not** require users to create or paste API keys.

## What it provides

The service exposes internal bearer-token authentication and a private CRUD resource called `items`. Data is held in memory for this first version, which makes the project easy to run locally but means data is reset whenever the process restarts or a serverless instance is recycled.

| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/` or `/status` | No | Service status and capability information |
| POST | `/v1/auth/register` | No | Create an account and receive a bearer token |
| POST | `/v1/auth/login` | No | Sign in and receive a bearer token |
| GET | `/v1/me` | Bearer token | Return the current user |
| GET | `/v1/items` | Bearer token | List the current user's items |
| POST | `/v1/items` | Bearer token | Create an item |
| GET | `/v1/items/:id` | Bearer token | Read one owned item |
| PATCH | `/v1/items/:id` | Bearer token | Update one owned item |
| DELETE | `/v1/items/:id` | Bearer token | Delete one owned item |

## Authentication

There are no user-facing API keys. Register or log in, then send the returned token as a standard bearer token:

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"you@example.com","password":"a-secure-password","name":"You"}'
```

Use the returned token for protected routes:

```bash
curl http://localhost:3000/v1/items \
  -H 'Authorization: Bearer YOUR_TOKEN'
```

The token is signed locally with HMAC-SHA256. Set `JWT_SECRET` in production; the built-in fallback is only for local development.

## Local development

```bash
npm install
npm start
```

The local server entrypoint is intended to be paired with a small adapter such as Vercel's development runtime. The deployed function is `api/index.js`.

## Example CRUD request

```bash
curl -X POST http://localhost:3000/v1/items \
  -H 'Authorization: Bearer YOUR_TOKEN' \
  -H 'Content-Type: application/json' \
  -d '{"title":"First item","description":"Created locally","metadata":{"category":"demo"}}'
```

## Design boundaries

The implementation uses only Node.js built-in modules and makes no outbound network calls. It includes basic CORS handling, JSON validation, ownership checks, password hashing with `crypto.scryptSync`, signed bearer tokens, and a lightweight in-process rate limiter. Before production use, the in-memory maps should be replaced with a persistent database and the JWT secret must be supplied through secure deployment configuration.
