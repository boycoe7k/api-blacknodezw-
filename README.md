# Black Node ZW API Backend

Real working REST API backend. Deploy to Vercel in under 5 minutes.

---

## Project Structure

```
blacknodezw-api/
  api/
    index.js               - Root endpoint (portal info)
    tiktok/
      download.js          - TikTok video downloader
      user.js              - TikTok user profile (followers, likes, etc)
      search.js            - TikTok video search
      trending.js          - TikTok trending videos by region
    youtube/
      mp3.js               - YouTube to MP3 audio
      mp4.js               - YouTube to MP4 video
      info.js              - YouTube video metadata
      channel.js           - YouTube channel stats
    instagram/
      download.js          - Instagram media downloader
      user.js              - Instagram profile stats
    facebook/
      download.js          - Facebook video downloader
    twitter/
      download.js          - X/Twitter video downloader
    pinterest/
      download.js          - Pinterest image/video downloader
    spotify/
      track.js             - Spotify track, artist, playlist info + search
    image/
      search.js            - Image search
      generate.js          - AI image generation (Pollinations / DALL-E)
      removebg.js          - Background remover
    ai/
      chat.js              - AI chat (GPT / Llama)
      generate.js          - AI text generation
      tts.js               - Text to speech
      translate.js         - Language translation
    weather/
      index.js             - Real-time weather + 7-day forecast
    currency/
      convert.js           - Currency conversion with live rates
    news/
      index.js             - Latest news from 200+ sources
    dictionary/
      index.js             - Word definitions, synonyms, phonetics
    github/
      user.js              - GitHub profile, repos, stats
    ip/
      lookup.js            - IP geolocation and ISP info
    screenshot/
      index.js             - Website screenshot capture
    url/
      shorten.js           - URL shortener (stored in Firestore)
    fun/
      index.js             - Quotes, jokes, facts, trivia, riddles
    qrcode/
      generate.js          - QR code generator (returns PNG)
  middleware/
    auth.js                - API key validation + rate limiting
  package.json
  vercel.json
```

---

## Deploy to Vercel

### Step 1: Install Vercel CLI

```bash
npm install -g vercel
```

### Step 2: Install dependencies

```bash
cd blacknodezw-api
npm install
```

### Step 3: Deploy

```bash
vercel
```

Follow the prompts. When asked for the project name use: `api` (so the URL becomes api.blacknodezw.vercel.app)

For production:

```bash
vercel --prod
```

### Step 4: Set a custom domain (optional)

In the Vercel dashboard go to your project, then Settings > Domains and add:
`api.blacknodezw.vercel.app`

---

## Environment Variables

Set these in Vercel dashboard under Settings > Environment Variables.

### Required for Firebase auth validation

```
FIREBASE_SERVICE_ACCOUNT   JSON string of your Firebase service account key
```

To get it: Firebase Console > Project Settings > Service Accounts > Generate new private key. Copy the entire JSON and paste it as the value.

### Optional (free APIs work without these, but these give better results)

```
OPENAI_API_KEY             OpenAI API key - enables GPT-4, DALL-E 3, TTS
                           https://platform.openai.com/api-keys

YOUTUBE_API_KEY            YouTube Data API v3 key - enables channel/video stats
                           https://console.cloud.google.com

GOOGLE_SEARCH_API_KEY      Google Custom Search API key - enables image search
GOOGLE_SEARCH_CX           Google Custom Search Engine ID
                           https://developers.google.com/custom-search

SPOTIFY_CLIENT_ID          Spotify app credentials - enables full Spotify API
SPOTIFY_CLIENT_SECRET      https://developer.spotify.com/dashboard

NEWSDATA_API_KEY           NewsData.io key - enables 200+ news sources (free tier)
                           https://newsdata.io

REMOVEBG_API_KEY           remove.bg API key - enables background removal
                           https://www.remove.bg/api

HUGGINGFACE_API_KEY        HuggingFace key - enables Stable Diffusion fallback
                           https://huggingface.co/settings/tokens

GITHUB_TOKEN               GitHub personal access token - higher rate limits
                           https://github.com/settings/tokens

SCREENSHOTONE_API_KEY      ScreenshotOne key - reliable website screenshots
                           https://screenshotone.com
```

---

## Which APIs work without any keys

These work completely free with zero setup:

- TikTok Downloader (via tikwm.com)
- TikTok User Profile (via tikwm.com)
- TikTok Search and Trending
- YouTube MP3 and MP4 (via cobalt.tools)
- YouTube Video Info (via oembed)
- Instagram Downloader (via cobalt.tools)
- Facebook, Twitter, Pinterest Downloaders
- AI Translate (MyMemory + Google Translate)
- Weather (Open-Meteo + OpenStreetMap geocoding)
- Currency Converter (open.er-api.com + frankfurter.app)
- QR Code Generator (qrcode npm package)
- IP Lookup (ip-api.com + ipwho.is)
- Dictionary (dictionaryapi.dev)
- GitHub User Info (public API, 60 req/hour)
- Quotes, Jokes, Facts (multiple free APIs)
- News (BBC RSS fallback)
- URL Shortener (Firestore storage)
- AI Chat (DeepInfra Llama 3 fallback)
- AI Text Generator (Pollinations fallback)
- Image Generator (Pollinations Flux - completely free)
- TTS (StreamElements + Google TTS)

---

## API Key Auth

Every request must include:

```
x-api-key: bnzw_your_key_here
```

Users get their key automatically when they register on the portal.

---

## Base URL

```
https://api.blacknodezw.vercel.app
```

---

## Example Requests

### TikTok User Profile

```bash
curl "https://api.blacknodezw.vercel.app/api/tiktok/user?username=khaby.lame" \
  -H "x-api-key: bnzw_your_key"
```

### TikTok Download

```bash
curl "https://api.blacknodezw.vercel.app/api/tiktok/download?url=https://www.tiktok.com/@user/video/123" \
  -H "x-api-key: bnzw_your_key"
```

### YouTube MP3

```bash
curl "https://api.blacknodezw.vercel.app/api/youtube/mp3?url=https://youtu.be/dQw4w9WgXcQ" \
  -H "x-api-key: bnzw_your_key"
```

### Weather

```bash
curl "https://api.blacknodezw.vercel.app/api/weather?city=Harare" \
  -H "x-api-key: bnzw_your_key"
```

### AI Chat (POST)

```bash
curl -X POST "https://api.blacknodezw.vercel.app/api/ai/chat" \
  -H "x-api-key: bnzw_your_key" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the capital of Zimbabwe?"}'
```

### Translate

```bash
curl "https://api.blacknodezw.vercel.app/api/ai/translate?text=Hello&to=sn" \
  -H "x-api-key: bnzw_your_key"
```

### Currency Convert

```bash
curl "https://api.blacknodezw.vercel.app/api/currency/convert?from=USD&to=ZAR&amount=100" \
  -H "x-api-key: bnzw_your_key"
```
