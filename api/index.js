// api/index.js - Black Node ZW - All endpoints unified
const axios = require('axios');
const QRCode = require('qrcode');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,Authorization');
}
const ok = (res, data) => res.status(200).json({ status: 200, data });
const err = (res, msg, code = 500) => res.status(code).json({ status: code, error: msg });

// ── FIREBASE ──────────────────────────────────────────────────────────────────
let _db = null;
async function getDB() {
  if (_db) return _db;
  const { initializeApp, getApps, cert } = require('firebase-admin/app');
  const { getFirestore } = require('firebase-admin/firestore');
  if (!getApps().length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      initializeApp({ credential: cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) });
    } else { initializeApp({ projectId: 'apiblacknodezw' }); }
  }
  _db = getFirestore();
  return _db;
}

async function authCheck(req, res) {
  if (req.method === 'OPTIONS') { res.status(200).end(); return false; }
  const key = req.headers['x-api-key'] || req.query.api_key || req.query.apikey || req.query.key;
  if (!key) { err(res, 'Missing API key. Add x-api-key header or ?api_key=YOUR_KEY to URL.', 401); return false; }
  try {
    const db = await getDB();
    const snap = await db.collection('users').where('apiKey', '==', key).limit(1).get();
    if (snap.empty) { err(res, 'Invalid API key.', 403); return false; }
    const user = snap.docs[0].data();
    const limit = user.plan === 'pro' ? 50000 : 1000;
    if ((user.requests || 0) >= limit) { err(res, 'Monthly limit reached. Upgrade to Pro.', 429); return false; }
    snap.docs[0].ref.update({ requests: (user.requests || 0) + 1 }).catch(() => {});
    return true;
  } catch (e) { return true; }
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
// Extract YouTube video ID from any YouTube URL including Shorts
function getYTId(url) {
  return url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/|\/v\/)([^&\n?#]+)/)?.[1] || null;
}

// Cobalt download helper with retries
async function cobaltDownload(url, opts = {}) {
  try {
    const resp = await axios.post('https://api.cobalt.tools/api/json',
      { url, ...opts },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 25000 }
    );
    return resp.data;
  } catch (e) {
    return null;
  }
}

// ── MAIN ROUTER ───────────────────────────────────────────────────────────────
module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();

  const path = req.url.replace(/\?.*/, '').replace(/^\/api/, '');

  // No auth routes
  if (path === '' || path === '/' || path === '/status') {
    return res.json({ status: 'online', name: 'Black Node ZW API', version: '1.0.0', base_url: 'https://api-blacknode-zw.vercel.app', endpoints: 40, timestamp: new Date().toISOString() });
  }

  // Short URL redirect
  const shortMatch = path.match(/^\/s\/(.+)$/);
  if (shortMatch) {
    try {
      const db = await getDB();
      const snap = await db.collection('short_urls').doc(shortMatch[1]).get();
      if (!snap.exists) return res.status(404).send('Link not found');
      snap.ref.update({ clicks: (snap.data().clicks || 0) + 1 }).catch(() => {});
      return res.redirect(301, snap.data().url);
    } catch (e) { return res.redirect('https://api-blacknode-zw.vercel.app'); }
  }

  if (!(await authCheck(req, res))) return;

  try {

    // ── TIKTOK ──────────────────────────────────────────────────────────────
    if (path === '/tiktok/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const decodedUrl = decodeURIComponent(url);
      try {
        const r = await axios.post('https://www.tikwm.com/api/',
          new URLSearchParams({ url: decodedUrl, hd: '1' }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
        );
        const d = r.data?.data;
        if (r.data?.code === 0 && d) {
          return ok(res, { title: d.title || '', author: '@' + (d.author?.unique_id || ''), author_name: d.author?.nickname || '', thumbnail: d.cover || '', download_url_hd: d.hdplay || d.play || '', download_url_sd: d.play || '', music_url: d.music || '', duration: d.duration || 0, play_count: d.play_count || 0, like_count: d.digg_count || 0 });
        }
      } catch (e) {}
      // Fallback: cobalt
      const cd = await cobaltDownload(decodedUrl);
      if (cd?.status === 'stream' || cd?.status === 'redirect') {
        return ok(res, { title: 'TikTok Video', download_url_hd: cd.url, download_url_sd: cd.url });
      }
      return err(res, 'Could not download. Make sure the video is public and the URL is correct.');
    }

    if (path === '/tiktok/user') {
      const { username, include_videos = 'false', video_count = '10' } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const clean = username.replace(/^@/, '');
      const r = await axios.post('https://www.tikwm.com/api/user/info',
        new URLSearchParams({ unique_id: clean }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }
      );
      if (r.data?.code !== 0) return err(res, 'User not found or account is private.');
      const u = r.data.data?.user || {}, s = r.data.data?.stats || {};
      const result = { username: u.uniqueId || clean, nickname: u.nickname || '', bio: u.signature || '', avatar: u.avatarLarger || '', verified: u.verified || false, private: u.privateAccount || false, followers: s.followerCount || 0, following: s.followingCount || 0, likes: s.heartCount || 0, video_count: s.videoCount || 0, profile_url: `https://www.tiktok.com/@${clean}` };
      if (include_videos === 'true') {
        try {
          const vr = await axios.post('https://www.tikwm.com/api/user/posts', new URLSearchParams({ unique_id: clean, count: Math.min(parseInt(video_count), 30), cursor: '0' }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
          if (vr.data?.code === 0) result.recent_videos = (vr.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', duration: v.duration || 0, play_count: v.play_count || 0, like_count: v.digg_count || 0 }));
        } catch (_) {}
      }
      return ok(res, result);
    }

    if (path === '/tiktok/search') {
      const { q, count = '20', cursor = '0' } = req.query;
      if (!q) return err(res, 'Missing: q', 400);
      const r = await axios.post('https://www.tikwm.com/api/feed/search', new URLSearchParams({ keywords: q, count: Math.min(parseInt(count), 50), cursor }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
      if (r.data?.code !== 0) return err(res, 'Search failed. Try again.');
      return ok(res, { query: q, total: r.data.data?.videos?.length || 0, videos: (r.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', duration: v.duration || 0, play_count: v.play_count || 0, like_count: v.digg_count || 0, author: { username: v.author?.unique_id || '', nickname: v.author?.nickname || '' } })) });
    }

    if (path === '/tiktok/trending') {
      const { region = 'US', count = '20' } = req.query;
      const r = await axios.post('https://www.tikwm.com/api/feed/list', new URLSearchParams({ region, count: Math.min(parseInt(count), 50) }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 });
      if (r.data?.code !== 0) return err(res, 'Could not fetch trending.');
      return ok(res, { region, total: r.data.data?.videos?.length || 0, videos: (r.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', play_count: v.play_count || 0, author: { username: v.author?.unique_id || '', nickname: v.author?.nickname || '' } })) });
    }

    // ── YOUTUBE ──────────────────────────────────────────────────────────────
    if (path === '/youtube/mp3' || path === '/youtube/mp4') {
      const { url, quality = '720' } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const videoId = getYTId(url);
      if (!videoId) return err(res, 'Invalid YouTube URL. Supported: youtube.com/watch, youtu.be, youtube.com/shorts', 400);
      const fullUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const isAudio = path === '/youtube/mp3';

      // Get title
      let title = 'YouTube Video', channel = 'YouTube';
      try {
        const oe = await axios.get(`https://www.youtube.com/oembed?url=${encodeURIComponent(fullUrl)}&format=json`, { timeout: 6000 });
        title = oe.data.title || title;
        channel = oe.data.author_name || channel;
      } catch (_) {}

      const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

      // Try cobalt first
      const cd = await cobaltDownload(fullUrl, isAudio ? { isAudioOnly: true, aFormat: 'mp3', audioBitrate: '320' } : { vQuality: quality });
      if (cd?.status === 'stream' || cd?.status === 'redirect') {
        return ok(res, { video_id: videoId, title, channel, thumbnail, download_url: cd.url, quality: isAudio ? '320kbps' : quality + 'p', format: isAudio ? 'mp3' : 'mp4' });
      }
      if (cd?.status === 'picker' && cd.picker?.length) {
        return ok(res, { video_id: videoId, title, channel, thumbnail, download_url: cd.picker[0].url, quality: quality + 'p', format: 'mp4' });
      }

      // Fallback: yt-dlp via loader.to free API
      try {
        const loaderResp = await axios.get(`https://loader.to/api/button/?url=${encodeURIComponent(fullUrl)}&f=${isAudio ? 'mp3' : 'mp4-' + quality}`, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (loaderResp.data) {
          return ok(res, { video_id: videoId, title, channel, thumbnail, download_url: `https://loader.to/api/download/?url=${encodeURIComponent(fullUrl)}&f=${isAudio ? 'mp3' : 'mp4'}`, format: isAudio ? 'mp3' : 'mp4', note: 'Use download_url in browser to download' });
        }
      } catch (_) {}

      return err(res, 'Could not fetch. cobalt.tools may be temporarily down. Try again in a moment.');
    }

    if (path === '/youtube/info') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const videoId = getYTId(url);
      if (!videoId) return err(res, 'Invalid YouTube URL', 400);
      const ytKey = process.env.YOUTUBE_API_KEY;
      if (ytKey) {
        try {
          const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', { params: { key: ytKey, id: videoId, part: 'snippet,statistics' }, timeout: 10000 });
          const item = r.data.items?.[0];
          if (item) return ok(res, { video_id: videoId, title: item.snippet.title, channel: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.high?.url || '', views: parseInt(item.statistics.viewCount) || 0, likes: parseInt(item.statistics.likeCount) || 0, comments: parseInt(item.statistics.commentCount) || 0, published_at: item.snippet.publishedAt });
        } catch (_) {}
      }
      const r = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { timeout: 8000 });
      return ok(res, { video_id: videoId, title: r.data.title, channel: r.data.author_name, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, url: `https://www.youtube.com/watch?v=${videoId}` });
    }

    if (path === '/youtube/channel') {
      const { channel } = req.query;
      if (!channel) return err(res, 'Missing: channel', 400);
      const ytKey = process.env.YOUTUBE_API_KEY;
      if (!ytKey) return err(res, 'Set YOUTUBE_API_KEY in Vercel environment variables for this endpoint.', 400);
      const search = await axios.get('https://www.googleapis.com/youtube/v3/search', { params: { key: ytKey, q: channel.replace(/^@/, ''), type: 'channel', part: 'id', maxResults: 1 }, timeout: 10000 });
      const channelId = search.data.items?.[0]?.id?.channelId;
      if (!channelId) return err(res, 'Channel not found.', 404);
      const stats = await axios.get('https://www.googleapis.com/youtube/v3/channels', { params: { key: ytKey, id: channelId, part: 'snippet,statistics' }, timeout: 10000 });
      const ch = stats.data.items?.[0];
      if (!ch) return err(res, 'Channel not found.', 404);
      return ok(res, { channel_id: channelId, title: ch.snippet.title, description: ch.snippet.description?.slice(0, 300), avatar: ch.snippet.thumbnails?.high?.url || '', subscribers: parseInt(ch.statistics.subscriberCount) || 0, total_views: parseInt(ch.statistics.viewCount) || 0, video_count: parseInt(ch.statistics.videoCount) || 0 });
    }

    // ── INSTAGRAM ────────────────────────────────────────────────────────────
    if (path === '/instagram/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      // Method 1: cobalt
      const cd = await cobaltDownload(url);
      if (cd?.status === 'stream' || cd?.status === 'redirect') return ok(res, { type: 'video', download_url: cd.url });
      if (cd?.status === 'picker') return ok(res, { type: 'gallery', items: cd.picker.map(p => ({ type: p.type, url: p.url })) });
      // Method 2: instadownloader
      try {
        const r = await axios.get(`https://instagram-downloader-download-instagram-videos-stories.p.rapidapi.com/index?url=${encodeURIComponent(url)}`, {
          headers: { 'X-RapidAPI-Key': process.env.RAPIDAPI_KEY || '', 'X-RapidAPI-Host': 'instagram-downloader-download-instagram-videos-stories.p.rapidapi.com' },
          timeout: 15000
        });
        if (r.data?.media) return ok(res, { type: 'video', download_url: r.data.media });
      } catch (_) {}
      return err(res, 'Could not download. Make sure the post is public. Instagram frequently blocks scrapers.');
    }

    if (path === '/instagram/user') {
      const { username } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const clean = username.replace(/^@/, '');
      // Method 1: Instagram API
      try {
        const r = await axios.get(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${clean}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'X-IG-App-ID': '936619743392459', Referer: `https://www.instagram.com/${clean}/`, Accept: '*/*' },
          timeout: 15000
        });
        const u = r.data?.data?.user;
        if (u) return ok(res, { username: u.username, full_name: u.full_name || '', bio: u.biography || '', avatar: u.profile_pic_url_hd || u.profile_pic_url || '', verified: u.is_verified || false, private: u.is_private || false, followers: u.edge_followed_by?.count || 0, following: u.edge_follow?.count || 0, posts: u.edge_owner_to_timeline_media?.count || 0 });
      } catch (_) {}
      // Method 2: page scrape
      try {
        const r = await axios.get(`https://www.instagram.com/${clean}/`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', Accept: 'text/html' }, timeout: 12000 });
        const desc = r.data.match(/<meta name="description" content="([^"]+)"/)?.[1] || '';
        const fMatch = desc.match(/([\d,.KMB]+)\s*Followers/i);
        const fgMatch = desc.match(/([\d,.KMB]+)\s*Following/i);
        const pMatch = desc.match(/([\d,.KMB]+)\s*Posts/i);
        const parseK = s => { if (!s) return 0; s = s.replace(/,/g, '').toUpperCase(); if (s.includes('M')) return Math.round(parseFloat(s) * 1e6); if (s.includes('K')) return Math.round(parseFloat(s) * 1e3); return parseInt(s) || 0; };
        return ok(res, { username: clean, followers: fMatch ? parseK(fMatch[1]) : 0, following: fgMatch ? parseK(fgMatch[1]) : 0, posts: pMatch ? parseK(pMatch[1]) : 0, profile_url: `https://www.instagram.com/${clean}/`, note: 'Instagram limits profile data. Set RAPIDAPI_KEY for full data.' });
      } catch (e) {
        return err(res, 'Instagram profile fetch failed. Instagram actively blocks scrapers. Try again later.');
      }
    }

    // ── OTHER DOWNLOADERS ────────────────────────────────────────────────────
    if (path === '/facebook/download' || path === '/twitter/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const cd = await cobaltDownload(url);
      if (cd?.status === 'stream' || cd?.status === 'redirect') return ok(res, { download_url: cd.url, quality: 'hd' });
      if (cd?.status === 'picker' && cd.picker?.length) return ok(res, { items: cd.picker.map(p => ({ quality: p.quality || 'unknown', url: p.url })) });
      return err(res, 'Could not download. Make sure the content is public.');
    }

    if (path === '/pinterest/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      try {
        const cheerio = require('cheerio');
        const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, maxRedirects: 5, timeout: 15000 });
        const $ = cheerio.load(r.data);
        const videoUrl = $('meta[property="og:video"]').attr('content') || '';
        const imageUrl = $('meta[property="og:image"]').attr('content') || '';
        if (!videoUrl && !imageUrl) return err(res, 'No media found. Make sure the pin is public.');
        const hdImage = imageUrl.replace(/\/\d+x\//, '/originals/');
        return ok(res, { type: videoUrl ? 'video' : 'image', title: $('meta[property="og:title"]').attr('content') || '', download_url: videoUrl || hdImage, thumbnail: imageUrl, hd_image: hdImage });
      } catch (e) { return err(res, e.message); }
    }

    // ── IMAGE ────────────────────────────────────────────────────────────────
    if (path === '/image/search') {
      const { q, count = '10' } = req.query;
      if (!q) return err(res, 'Missing: q', 400);
      const gKey = process.env.GOOGLE_SEARCH_API_KEY, cx = process.env.GOOGLE_SEARCH_CX;
      if (gKey && cx) {
        try {
          const r = await axios.get('https://www.googleapis.com/customsearch/v1', { params: { key: gKey, cx, q, searchType: 'image', num: Math.min(parseInt(count), 10) }, timeout: 10000 });
          return ok(res, { query: q, images: (r.data.items || []).map(i => ({ url: i.link, thumbnail: i.image?.thumbnailLink || '', title: i.title, source: i.image?.contextLink || '' })) });
        } catch (_) {}
      }
      // Fallback: Unsplash public API (no key needed)
      try {
        const r = await axios.get(`https://source.unsplash.com/featured/?${encodeURIComponent(q)}`, { maxRedirects: 0, timeout: 8000, validateStatus: s => s < 400 });
        const finalUrl = r.headers?.location || r.request?.res?.responseUrl || '';
        if (finalUrl) return ok(res, { query: q, images: [{ url: finalUrl, thumbnail: finalUrl, title: q, source: 'unsplash.com' }], note: 'Set GOOGLE_SEARCH_API_KEY for more results' });
      } catch (_) {}
      // Fallback: Pixabay free API
      try {
        const r = await axios.get('https://pixabay.com/api/', { params: { key: process.env.PIXABAY_API_KEY || '44556677-abc123def456', q, image_type: 'photo', per_page: Math.min(parseInt(count), 20) }, timeout: 10000 });
        if (r.data?.hits?.length) return ok(res, { query: q, images: r.data.hits.map(i => ({ url: i.largeImageURL || i.webformatURL, thumbnail: i.previewURL, title: i.tags, source: 'pixabay.com' })) });
      } catch (_) {}
      return err(res, 'Image search failed. Set GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX in Vercel environment variables for reliable image search.');
    }

    if (path === '/image/generate') {
      const prompt = req.body?.prompt || req.query?.prompt;
      if (!prompt) return err(res, 'Missing: prompt', 400);
      const style = req.body?.style || req.query?.style || 'realistic';
      const styleMap = { anime: 'anime style,', art: 'digital art,', cartoon: 'cartoon,', sketch: 'pencil sketch,' };
      const fullPrompt = ((styleMap[style] || '') + ' ' + prompt).trim();
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await axios.post('https://api.openai.com/v1/images/generations', { model: 'dall-e-3', prompt: fullPrompt, n: 1, size: '1024x1024' }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
          return ok(res, { prompt: fullPrompt, image_url: r.data.data[0]?.url, model: 'dall-e-3' });
        } catch (_) {}
      }
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&model=flux&seed=${seed}&nologo=true`;
      return ok(res, { prompt: fullPrompt, image_url: imageUrl, model: 'flux', seed, note: 'Open image_url in browser to view the generated image' });
    }

    if (path === '/image/removebg') {
      const imageUrl = req.body?.url || req.query?.url;
      if (!imageUrl) return err(res, 'Missing: url', 400);
      const rbKey = process.env.REMOVEBG_API_KEY;
      if (rbKey) {
        try {
          const FormData = require('form-data');
          const form = new FormData();
          form.append('image_url', imageUrl);
          form.append('size', 'auto');
          const r = await axios.post('https://api.remove.bg/v1.0/removebg', form, { headers: { ...form.getHeaders(), 'X-Api-Key': rbKey }, responseType: 'arraybuffer', timeout: 30000 });
          const b64 = Buffer.from(r.data).toString('base64');
          return ok(res, { original: imageUrl, result_base64: `data:image/png;base64,${b64}`, format: 'png', provider: 'remove.bg' });
        } catch (_) {}
      }
      // Free fallback: bg.removal.ai
      try {
        const r = await axios.post('https://api.photoroom.com/v1/segment', { image_url: imageUrl }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        if (r.data?.image_url) return ok(res, { original: imageUrl, result_url: r.data.image_url, format: 'png', provider: 'photoroom' });
      } catch (_) {}
      return err(res, 'Background removal requires REMOVEBG_API_KEY. Get a free key at remove.bg/api');
    }

    // ── AI ───────────────────────────────────────────────────────────────────
    if (path === '/ai/chat') {
      const { message, system = 'You are a helpful AI assistant.', model = 'default' } = req.body || {};
      if (!message) return err(res, 'Missing: message', 400);
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-3.5-turbo', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 1024 }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 25000 });
          return ok(res, { message, response: r.data.choices[0]?.message?.content || '', model: 'gpt-3.5-turbo', tokens_used: r.data.usage?.total_tokens || 0 });
        } catch (_) {}
      }
      // Free fallback: Groq (very fast free AI)
      const groqKey = process.env.GROQ_API_KEY;
      if (groqKey) {
        try {
          const r = await axios.post('https://api.groq.com/openai/v1/chat/completions', { model: 'llama3-8b-8192', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 1024 }, { headers: { 'Authorization': `Bearer ${groqKey}`, 'Content-Type': 'application/json' }, timeout: 20000 });
          return ok(res, { message, response: r.data.choices[0]?.message?.content || '', model: 'llama3-8b (groq)', tokens_used: r.data.usage?.total_tokens || 0 });
        } catch (_) {}
      }
      // Final fallback: DeepInfra
      try {
        const r = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', { model: 'meta-llama/Meta-Llama-3-8B-Instruct', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 1024 }, { headers: { 'Content-Type': 'application/json' }, timeout: 30000 });
        return ok(res, { message, response: r.data.choices[0]?.message?.content || '', model: 'llama-3-8b' });
      } catch (e) { return err(res, 'AI service temporarily unavailable. Set OPENAI_API_KEY or GROQ_API_KEY (free at groq.com) for reliable AI chat.'); }
    }

    if (path === '/ai/generate') {
      const { prompt, type = 'default', length = 'medium', tone = 'professional' } = req.body || {};
      if (!prompt) return err(res, 'Missing: prompt', 400);
      const typeMap = { article: 'Write a detailed article about:', code: 'Write clean well-commented code for:', story: 'Write a creative short story about:', email: 'Write a professional email for:', essay: 'Write an essay about:', caption: 'Write social media captions for:' };
      const maxTokens = { short: 300, medium: 700, long: 1400 }[length] || 700;
      const fullPrompt = `${typeMap[type] || ''} ${prompt}. Tone: ${tone}`.trim();
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: fullPrompt }], max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
          const output = r.data.choices[0]?.message?.content || '';
          return ok(res, { prompt, type, output, word_count: output.split(/\s+/).length });
        } catch (_) {}
      }
      // Fallback: Pollinations text
      try {
        const r = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}`, { headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 30000 });
        const output = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
        return ok(res, { prompt, type, output, word_count: output.split(/\s+/).length, model: 'pollinations' });
      } catch (e) { return err(res, 'AI generation timed out. Set OPENAI_API_KEY or GROQ_API_KEY for faster responses.'); }
    }

    if (path === '/ai/tts') {
      const text = req.body?.text || req.query?.text;
      const voice = req.body?.voice || req.query?.voice || 'Brian';
      if (!text) return err(res, 'Missing: text', 400);
      if (text.length > 3000) return err(res, 'Text too long. Max 3000 characters.', 400);
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        try {
          const r = await axios.post('https://api.openai.com/v1/audio/speech', { model: 'tts-1', input: text, voice: 'alloy' }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 25000 });
          res.setHeader('Content-Type', 'audio/mpeg');
          return res.send(Buffer.from(r.data));
        } catch (_) {}
      }
      const voices = ['Brian','Amy','Emma','Matthew','Joanna','Joey','Kendra','Kimberly','Salli','Justin'];
      const sel = voices.includes(voice) ? voice : 'Brian';
      const audioUrl = `https://api.streamelements.com/kappa/v2/speech?voice=${sel}&text=${encodeURIComponent(text)}`;
      return ok(res, { text, voice: sel, audio_url: audioUrl, format: 'mp3', note: 'Open audio_url in browser or use in an audio player' });
    }

    if (path === '/ai/translate') {
      const { text, to, from = 'auto' } = req.query;
      if (!text) return err(res, 'Missing: text', 400);
      if (!to) return err(res, 'Missing: to (target language code e.g. es, fr, sn)', 400);
      try {
        const r = await axios.get('https://translate.googleapis.com/translate_a/single', { params: { client: 'gtx', sl: from === 'auto' ? 'auto' : from, tl: to, dt: 't', q: text }, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        return ok(res, { original: text, translated: r.data[0]?.map(s => s[0]).join('') || '', from: r.data[2] || from, to });
      } catch (_) {
        try {
          const r = await axios.get('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `${from}|${to}` }, timeout: 10000 });
          return ok(res, { original: text, translated: r.data.responseData.translatedText, from, to });
        } catch (e) { return err(res, 'Translation failed. Try again.'); }
      }
    }

    // NEW: AI Music Generator
    if (path === '/ai/music') {
      const prompt = req.body?.prompt || req.query?.prompt;
      const style = req.body?.style || req.query?.style || 'pop';
      if (!prompt) return err(res, 'Missing: prompt', 400);
      // Uses MusicGen via Hugging Face
      const hfKey = process.env.HUGGINGFACE_API_KEY;
      if (hfKey) {
        try {
          const r = await axios.post('https://api-inference.huggingface.co/models/facebook/musicgen-small',
            { inputs: `${style} music: ${prompt}` },
            { headers: { 'Authorization': `Bearer ${hfKey}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 60000 }
          );
          const b64 = Buffer.from(r.data).toString('base64');
          return ok(res, { prompt, style, audio_base64: `data:audio/wav;base64,${b64}`, format: 'wav', model: 'musicgen-small', note: 'Set HUGGINGFACE_API_KEY for this endpoint' });
        } catch (_) {}
      }
      // Fallback: Suno AI public URL
      return ok(res, { prompt, style, note: 'Set HUGGINGFACE_API_KEY for AI music generation. Free at huggingface.co', alternative: 'Try suno.com or udio.com for free AI music generation' });
    }

    // ── WEATHER ──────────────────────────────────────────────────────────────
    if (path === '/weather') {
      const { city, units = 'metric' } = req.query;
      if (!city) return err(res, 'Missing: city', 400);
      try {
        const geo = await axios.get('https://nominatim.openstreetmap.org/search', { params: { q: city, format: 'json', limit: 1 }, headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 10000 });
        if (!geo.data?.length) return err(res, `City not found: "${city}"`, 404);
        const { lat, lon, display_name } = geo.data[0];
        const w = await axios.get('https://api.open-meteo.com/v1/forecast', { params: { latitude: lat, longitude: lon, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation', daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum', temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius', wind_speed_unit: units === 'imperial' ? 'mph' : 'kmh', timezone: 'auto', forecast_days: 7 }, timeout: 12000 });
        const c = w.data.current, unit = units === 'imperial' ? '°F' : '°C';
        const WMO = { 0:'Clear sky',1:'Mainly clear',2:'Partly cloudy',3:'Overcast',45:'Foggy',51:'Light drizzle',61:'Slight rain',63:'Moderate rain',65:'Heavy rain',71:'Slight snow',80:'Showers',95:'Thunderstorm' };
        return ok(res, { city: display_name.split(',')[0], full_location: display_name, coordinates: { lat: parseFloat(lat), lon: parseFloat(lon) }, temperature: `${c.temperature_2m}${unit}`, feels_like: `${c.apparent_temperature}${unit}`, condition: WMO[c.weather_code] || 'Unknown', humidity: `${c.relative_humidity_2m}%`, wind_speed: `${c.wind_speed_10m} ${units === 'imperial' ? 'mph' : 'km/h'}`, precipitation: `${c.precipitation}mm`, units, forecast: w.data.daily.time.map((d, i) => ({ date: d, condition: WMO[w.data.daily.weather_code[i]] || 'Unknown', high: `${w.data.daily.temperature_2m_max[i]}${unit}`, low: `${w.data.daily.temperature_2m_min[i]}${unit}`, precipitation: `${w.data.daily.precipitation_sum[i]}mm` })) });
      } catch (e) { return err(res, `Weather fetch failed: ${e.message}`); }
    }

    // ── CURRENCY ─────────────────────────────────────────────────────────────
    if (path === '/currency/convert') {
      let { from = 'USD', to, amount = '1', action } = req.query;
      // Clean up common user mistakes
      from = from.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
      if (!from || from.length < 2) from = 'USD';
      try {
        const r = await axios.get(`https://open.er-api.com/v6/latest/${from}`, { timeout: 10000 });
        if (r.data.result !== 'success') throw new Error('Exchange rate API failed');
        if (action === 'rates') return ok(res, { base: from, rates: r.data.rates, last_updated: r.data.time_last_update_utc });
        if (!to) return err(res, 'Missing: to (target currency code e.g. ZAR, EUR, GBP)', 400);
        to = to.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
        const rate = r.data.rates[to];
        if (!rate) return err(res, `Currency not found: "${to}". Use standard codes like USD, EUR, ZAR, GBP.`, 400);
        const amt = parseFloat(amount) || 1;
        return ok(res, { from, to, amount: amt, rate, result: parseFloat((amt * rate).toFixed(6)), formatted: `${(amt * rate).toFixed(2)} ${to}`, last_updated: r.data.time_last_update_utc });
      } catch (e) {
        // Fallback: Frankfurter
        try {
          const to2 = (to || 'USD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
          const r = await axios.get(`https://api.frankfurter.app/latest?from=${from}&to=${to2}`, { timeout: 10000 });
          const rate = r.data.rates[to2];
          if (!rate) return err(res, `Currency not found: "${to2}"`, 400);
          const amt = parseFloat(amount) || 1;
          return ok(res, { from, to: to2, amount: amt, rate, result: parseFloat((amt * rate).toFixed(6)), formatted: `${(amt * rate).toFixed(2)} ${to2}` });
        } catch (e2) { return err(res, 'Currency conversion failed. Try again.'); }
      }
    }

    // ── QR CODE ──────────────────────────────────────────────────────────────
    if (path === '/qrcode/generate') {
      const { data, size = '300', color = '000000', bg = 'ffffff', format = 'json' } = req.query;
      if (!data) return err(res, 'Missing: data', 400);
      const sizeNum = Math.min(Math.max(parseInt(size) || 300, 100), 1000);
      const opts = { width: sizeNum, margin: 2, color: { dark: `#${color.replace('#', '')}`, light: `#${bg.replace('#', '')}` } };
      // Always return base64/JSON by default so tester can display it
      if (format === 'svg') {
        const svg = await QRCode.toString(data, { ...opts, type: 'svg' });
        res.setHeader('Content-Type', 'image/svg+xml');
        return res.send(svg);
      }
      if (format === 'png') {
        res.setHeader('Content-Type', 'image/png');
        return res.send(await QRCode.toBuffer(data, opts));
      }
      // Default: return as JSON with base64
      const dataUrl = await QRCode.toDataURL(data, opts);
      return ok(res, { data, format: 'base64', size: `${sizeNum}x${sizeNum}`, image: dataUrl, note: 'Use format=png or format=svg in URL for direct image response' });
    }

    // ── IP LOOKUP ────────────────────────────────────────────────────────────
    if (path === '/ip/lookup') {
      let { ip } = req.query;
      if (!ip) ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
      try {
        const r = await axios.get(`https://ipwho.is/${ip}`, { timeout: 8000 });
        if (r.data.success) return ok(res, { ip: r.data.ip, country: r.data.country, country_code: r.data.country_code, region: r.data.region, city: r.data.city, latitude: r.data.latitude, longitude: r.data.longitude, timezone: r.data.timezone?.id || '', isp: r.data.connection?.isp || '', org: r.data.connection?.org || '' });
      } catch (_) {}
      try {
        const r = await axios.get(`http://ip-api.com/json/${ip}`, { timeout: 8000 });
        if (r.data.status === 'success') return ok(res, { ip: r.data.query, country: r.data.country, country_code: r.data.countryCode, region: r.data.regionName, city: r.data.city, latitude: r.data.lat, longitude: r.data.lon, timezone: r.data.timezone, isp: r.data.isp });
      } catch (_) {}
      return err(res, 'IP lookup failed. Try again.');
    }

    // ── URL SHORTENER ────────────────────────────────────────────────────────
    if (path === '/url/shorten') {
      const url = req.body?.url || req.query?.url;
      const alias = req.body?.alias || req.query?.alias || Math.random().toString(36).slice(2, 8);
      if (!url) return err(res, 'Missing: url', 400);
      try { new URL(url); } catch { return err(res, 'Invalid URL format. Must start with https://', 400); }
      try {
        const db = await getDB();
        const ref = db.collection('short_urls').doc(alias);
        const snap = await ref.get();
        if (!snap.exists) await ref.set({ url, alias, clicks: 0, created_at: new Date() });
        return ok(res, { original: url, short: `https://api-blacknode-zw.vercel.app/api/s/${alias}`, alias, clicks: snap.exists ? snap.data().clicks : 0 });
      } catch (e) { return err(res, e.message); }
    }

    // ── NEWS ─────────────────────────────────────────────────────────────────
    if (path === '/news') {
      const { q, category = 'general', limit = '10' } = req.query;
      const ndKey = process.env.NEWSDATA_API_KEY;
      if (ndKey) {
        try {
          const params = { apikey: ndKey, language: 'en', size: Math.min(parseInt(limit), 50) };
          if (q) params.q = q; else params.category = category;
          const r = await axios.get('https://newsdata.io/api/1/news', { params, timeout: 12000 });
          if (r.data.status === 'success') return ok(res, { query: q || category, articles: (r.data.results || []).map(a => ({ title: a.title || '', description: a.description || '', url: a.link || '', image: a.image_url || '', source: a.source_id || '', published_at: a.pubDate || '' })) });
        } catch (_) {}
      }
      // RSS fallback
      const RSS = { general: 'https://feeds.bbci.co.uk/news/rss.xml', technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sports: 'https://feeds.bbci.co.uk/sport/rss.xml', business: 'https://feeds.bbci.co.uk/news/business/rss.xml', health: 'https://feeds.bbci.co.uk/news/health/rss.xml', science: 'https://feeds.bbci.co.uk/news/science_and_environment/rss.xml' };
      try {
        const r = await axios.get(RSS[category] || RSS.general, { headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 12000 });
        const items = [];
        for (const m of r.data.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
          const i = m[1];
          const title = (i.match(/<title><!\[CDATA\[(.+?)\]\]>/) || i.match(/<title>(.+?)<\/title>/))?.[1] || '';
          const link = i.match(/<link>(.+?)<\/link>/)?.[1] || '';
          const desc = (i.match(/<description><!\[CDATA\[(.+?)\]\]>/) || i.match(/<description>(.+?)<\/description>/))?.[1] || '';
          const pubDate = i.match(/<pubDate>(.+?)<\/pubDate>/)?.[1] || '';
          if (title) items.push({ title: title.trim(), description: desc.replace(/<[^>]+>/g, '').slice(0, 200), url: link.trim(), source: 'BBC News', published_at: pubDate });
          if (items.length >= parseInt(limit)) break;
        }
        return ok(res, { query: q || category, total: items.length, articles: items, note: 'Set NEWSDATA_API_KEY for 200+ news sources' });
      } catch (e) { return err(res, 'News fetch failed. Try again.'); }
    }

    // ── DICTIONARY ───────────────────────────────────────────────────────────
    if (path === '/dictionary') {
      const { word, lang = 'en' } = req.query;
      if (!word) return err(res, 'Missing: word', 400);
      try {
        const r = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word.trim().toLowerCase())}`, { timeout: 10000 });
        const entry = r.data[0];
        return ok(res, { word: entry.word, phonetic: entry.phonetic || '', phonetics: (entry.phonetics || []).filter(p => p.text || p.audio).map(p => ({ text: p.text || '', audio: p.audio || '' })), meanings: (entry.meanings || []).map(m => ({ part_of_speech: m.partOfSpeech, definitions: (m.definitions || []).slice(0, 3).map(d => ({ definition: d.definition, example: d.example || '' })), synonyms: (m.synonyms || []).slice(0, 8), antonyms: (m.antonyms || []).slice(0, 5) })) });
      } catch (e) {
        if (e.response?.status === 404) return err(res, `No definition found for: "${word}"`, 404);
        return err(res, e.message);
      }
    }

    // ── GITHUB ───────────────────────────────────────────────────────────────
    if (path === '/github/user') {
      const { username, action = 'user', repo } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'BlackNodeZW/1.0' } : { 'User-Agent': 'BlackNodeZW/1.0' };
      try {
        if (action === 'repos') {
          const r = await axios.get(`https://api.github.com/users/${username}/repos?sort=stars&per_page=20`, { headers, timeout: 10000 });
          return ok(res, { username, repos: r.data.map(r => ({ name: r.name, description: r.description || '', url: r.html_url, language: r.language || '', stars: r.stargazers_count, forks: r.forks_count })) });
        }
        if (action === 'repo' && repo) {
          const r = await axios.get(`https://api.github.com/repos/${username}/${repo}`, { headers, timeout: 10000 });
          return ok(res, { name: r.data.name, description: r.data.description || '', url: r.data.html_url, language: r.data.language || '', stars: r.data.stargazers_count, forks: r.data.forks_count, issues: r.data.open_issues_count });
        }
        const r = await axios.get(`https://api.github.com/users/${username}`, { headers, timeout: 10000 });
        const u = r.data;
        return ok(res, { username: u.login, name: u.name || '', bio: u.bio || '', avatar: u.avatar_url, url: u.html_url, followers: u.followers, following: u.following, public_repos: u.public_repos, location: u.location || '', company: u.company || '', twitter: u.twitter_username || '' });
      } catch (e) { return err(res, e.response?.data?.message || e.message); }
    }

    // ── SCREENSHOT ───────────────────────────────────────────────────────────
    if (path === '/screenshot') {
      const { url, width = '1280', height = '720', format = 'jpg' } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      try { new URL(url); } catch { return err(res, 'Invalid URL. Must start with https://', 400); }
      const w = Math.min(parseInt(width) || 1280, 1920);
      const h = Math.min(parseInt(height) || 720, 1080);
      // Try screenshotone
      const ssKey = process.env.SCREENSHOTONE_API_KEY;
      if (ssKey) {
        try {
          const r = await axios.get('https://api.screenshotone.com/take', { params: { access_key: ssKey, url, viewport_width: w, viewport_height: h, format: 'jpg', block_ads: true }, responseType: 'arraybuffer', timeout: 30000 });
          res.setHeader('Content-Type', 'image/jpeg');
          return res.send(Buffer.from(r.data));
        } catch (_) {}
      }
      // Fallback: thum.io (free)
      try {
        const r = await axios.get(`https://image.thum.io/get/width/${w}/crop/${h}/${encodeURIComponent(url)}`, { responseType: 'arraybuffer', timeout: 25000, headers: { 'User-Agent': 'BlackNodeZW/1.0' } });
        if (r.data?.byteLength > 1000) {
          res.setHeader('Content-Type', 'image/jpeg');
          return res.send(Buffer.from(r.data));
        }
      } catch (_) {}
      // Fallback: return JSON with screenshot URL
      return ok(res, { url, screenshot_url: `https://image.thum.io/get/width/${w}/crop/${h}/${encodeURIComponent(url)}`, note: 'Open screenshot_url in browser to view the screenshot' });
    }

    // ── FUN ───────────────────────────────────────────────────────────────────
    if (path === '/fun') {
      const { type = 'quote', category = 'general' } = req.query;
      try {
        if (type === 'quote') { const r = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 }); return ok(res, { type: 'quote', content: r.data[0].q, author: r.data[0].a }); }
        if (type === 'joke') { const r = await axios.get('https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist', { timeout: 8000 }); return ok(res, { type: 'joke', category: r.data.category, joke: r.data.joke || null, setup: r.data.setup || null, delivery: r.data.delivery || null }); }
        if (type === 'fact') { const r = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { timeout: 8000 }); return ok(res, { type: 'fact', content: r.data.text }); }
        if (type === 'trivia') { const r = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 }); const q = r.data.results?.[0]; if (q) return ok(res, { type: 'trivia', category: q.category, difficulty: q.difficulty, question: q.question, correct_answer: q.correct_answer, incorrect_answers: q.incorrect_answers }); }
        if (type === 'riddle') { const r = await axios.get('https://riddles-api.vercel.app/random', { timeout: 8000 }); return ok(res, { type: 'riddle', riddle: r.data.riddle, answer: r.data.answer }); }
        return err(res, `Invalid type: ${type}. Use: quote, joke, fact, trivia, riddle`, 400);
      } catch (e) { return err(res, e.message); }
    }

    // ── SPOTIFY ──────────────────────────────────────────────────────────────
    if (path === '/spotify/track') {
      const { url, action, q } = req.query;
      const clientId = process.env.SPOTIFY_CLIENT_ID, clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
      if (!clientId || !clientSecret) return err(res, 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in Vercel environment variables. Free at developer.spotify.com', 400);
      try {
        const tokenR = await axios.post('https://accounts.spotify.com/api/token', new URLSearchParams({ grant_type: 'client_credentials' }), { headers: { 'Authorization': `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 });
        const headers = { 'Authorization': `Bearer ${tokenR.data.access_token}` };
        if (action === 'search' && q) {
          const r = await axios.get('https://api.spotify.com/v1/search', { params: { q, type: 'track', limit: 10, market: 'US' }, headers, timeout: 10000 });
          return ok(res, { query: q, tracks: (r.data.tracks?.items || []).map(t => ({ id: t.id, title: t.name, artists: t.artists?.map(a => a.name).join(', '), album: t.album?.name, cover: t.album?.images?.[0]?.url || '', preview_url: t.preview_url || '', spotify_url: t.external_urls?.spotify || '' })) });
        }
        if (!url) return err(res, 'Missing: url or use action=search&q=query', 400);
        const trackId = url.match(/track\/([a-zA-Z0-9]+)/)?.[1];
        if (!trackId) return err(res, 'Invalid Spotify URL', 400);
        const r = await axios.get(`https://api.spotify.com/v1/tracks/${trackId}`, { headers, timeout: 10000 });
        const t = r.data;
        return ok(res, { id: t.id, title: t.name, artists: t.artists?.map(a => a.name).join(', '), album: t.album?.name, cover: t.album?.images?.[0]?.url || '', duration_ms: t.duration_ms, preview_url: t.preview_url || '', popularity: t.popularity, spotify_url: t.external_urls?.spotify || '' });
      } catch (e) { return err(res, e.message); }
    }

    // ── MOVIE APIs (NEW) ─────────────────────────────────────────────────────
    if (path === '/movie/search') {
      const { q, year, type = 'movie', page = '1' } = req.query;
      if (!q) return err(res, 'Missing: q (movie title to search)', 400);
      const omdbKey = process.env.OMDB_API_KEY || 'trilogy'; // free demo key
      try {
        const params = { apikey: omdbKey, s: q, type, page };
        if (year) params.y = year;
        const r = await axios.get('https://www.omdbapi.com/', { params, timeout: 10000 });
        if (r.data.Response === 'False') return err(res, r.data.Error || 'No results found.', 404);
        return ok(res, { query: q, total: parseInt(r.data.totalResults) || 0, page: parseInt(page), results: (r.data.Search || []).map(m => ({ imdb_id: m.imdbID, title: m.Title, year: m.Year, type: m.Type, poster: m.Poster !== 'N/A' ? m.Poster : null })) });
      } catch (e) { return err(res, 'Movie search failed. Set OMDB_API_KEY (free at omdbapi.com) for reliable results.'); }
    }

    if (path === '/movie/details') {
      const { id, title } = req.query;
      if (!id && !title) return err(res, 'Missing: id (IMDb ID like tt1234567) or title', 400);
      const omdbKey = process.env.OMDB_API_KEY || 'trilogy';
      try {
        const params = { apikey: omdbKey, plot: 'full' };
        if (id) params.i = id; else params.t = title;
        const r = await axios.get('https://www.omdbapi.com/', { params, timeout: 10000 });
        if (r.data.Response === 'False') return err(res, r.data.Error || 'Movie not found.', 404);
        const m = r.data;
        return ok(res, { imdb_id: m.imdbID, title: m.Title, year: m.Year, rated: m.Rated, released: m.Released, runtime: m.Runtime, genre: m.Genre, director: m.Director, actors: m.Actors, plot: m.Plot, language: m.Language, country: m.Country, awards: m.Awards, poster: m.Poster !== 'N/A' ? m.Poster : null, imdb_rating: m.imdbRating, imdb_votes: m.imdbVotes, type: m.Type, box_office: m.BoxOffice || null });
      } catch (e) { return err(res, 'Movie details fetch failed. Set OMDB_API_KEY (free at omdbapi.com).'); }
    }

    if (path === '/movie/trending') {
      // Uses TMDB API for trending movies
      const tmdbKey = process.env.TMDB_API_KEY;
      if (!tmdbKey) return err(res, 'Set TMDB_API_KEY in Vercel environment variables. Free at themoviedb.org/settings/api', 400);
      const { time_window = 'week' } = req.query;
      try {
        const r = await axios.get(`https://api.themoviedb.org/3/trending/movie/${time_window}`, { params: { api_key: tmdbKey }, timeout: 10000 });
        return ok(res, { time_window, results: (r.data.results || []).map(m => ({ id: m.id, title: m.title, overview: m.overview?.slice(0, 200), release_date: m.release_date, rating: m.vote_average, poster: m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null, popularity: m.popularity })) });
      } catch (e) { return err(res, e.message); }
    }

    // ── WHATSAPP BOT API (NEW) ───────────────────────────────────────────────
    if (path === '/whatsapp/send') {
      const { phone, message } = req.body || {};
      if (!phone || !message) return err(res, 'Missing: phone (with country code) and message', 400);
      const waKey = process.env.WHATSAPP_API_KEY;
      const waPhone = process.env.WHATSAPP_PHONE_ID;
      if (!waKey || !waPhone) return err(res, 'Set WHATSAPP_API_KEY and WHATSAPP_PHONE_ID in Vercel environment variables. Get from developers.facebook.com/docs/whatsapp', 400);
      try {
        const r = await axios.post(`https://graph.facebook.com/v18.0/${waPhone}/messages`, { messaging_product: 'whatsapp', to: phone.replace(/\D/g, ''), type: 'text', text: { body: message } }, { headers: { 'Authorization': `Bearer ${waKey}`, 'Content-Type': 'application/json' }, timeout: 15000 });
        return ok(res, { success: true, message_id: r.data.messages?.[0]?.id, to: phone, status: 'sent' });
      } catch (e) { return err(res, e.response?.data?.error?.message || e.message); }
    }

    if (path === '/whatsapp/verify') {
      // WhatsApp webhook verification
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];
      const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'blacknodezw';
      if (mode === 'subscribe' && token === verifyToken) return res.status(200).send(challenge);
      return err(res, 'Verification failed', 403);
    }

    // ── TELEGRAM BOT API (NEW) ───────────────────────────────────────────────
    if (path === '/telegram/send') {
      const { chat_id, message, parse_mode = 'HTML' } = req.body || {};
      if (!chat_id || !message) return err(res, 'Missing: chat_id and message', 400);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return err(res, 'Set TELEGRAM_BOT_TOKEN in Vercel environment variables. Get from @BotFather on Telegram.', 400);
      try {
        const r = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, { chat_id, text: message, parse_mode }, { timeout: 15000 });
        return ok(res, { success: true, message_id: r.data.result?.message_id, chat_id, status: 'sent' });
      } catch (e) { return err(res, e.response?.data?.description || e.message); }
    }

    if (path === '/telegram/file') {
      const { chat_id, file_url, caption = '' } = req.body || {};
      if (!chat_id || !file_url) return err(res, 'Missing: chat_id and file_url', 400);
      const botToken = process.env.TELEGRAM_BOT_TOKEN;
      if (!botToken) return err(res, 'Set TELEGRAM_BOT_TOKEN in Vercel environment variables.', 400);
      try {
        const ext = file_url.split('.').pop().split('?')[0].toLowerCase();
        let endpoint = 'sendDocument', key = 'document';
        if (['jpg','jpeg','png','webp'].includes(ext)) { endpoint = 'sendPhoto'; key = 'photo'; }
        else if (['mp4','mov','avi'].includes(ext)) { endpoint = 'sendVideo'; key = 'video'; }
        else if (['mp3','ogg','wav'].includes(ext)) { endpoint = 'sendAudio'; key = 'audio'; }
        const r = await axios.post(`https://api.telegram.org/bot${botToken}/${endpoint}`, { chat_id, [key]: file_url, caption }, { timeout: 15000 });
        return ok(res, { success: true, message_id: r.data.result?.message_id, status: 'sent' });
      } catch (e) { return err(res, e.response?.data?.description || e.message); }
    }

    // ── CLOUD STORAGE (NEW) ─────────────────────────────────────────────────
    if (path === '/storage/upload') {
      const { base64, filename, folder = 'uploads' } = req.body || {};
      if (!base64 || !filename) return err(res, 'Missing: base64 (file data) and filename', 400);
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) return err(res, 'Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET. Free at cloudinary.com', 400);
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const crypto = require('crypto');
        const sig = crypto.createHash('sha1').update(`folder=${folder}&public_id=${filename}&timestamp=${timestamp}${apiSecret}`).digest('hex');
        const FormData = require('form-data');
        const form = new FormData();
        form.append('file', base64);
        form.append('public_id', filename);
        form.append('folder', folder);
        form.append('timestamp', timestamp);
        form.append('api_key', apiKey);
        form.append('signature', sig);
        const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, form, { headers: form.getHeaders(), timeout: 60000 });
        return ok(res, { success: true, url: r.data.secure_url, public_id: r.data.public_id, format: r.data.format, size: r.data.bytes, width: r.data.width || null, height: r.data.height || null });
      } catch (e) { return err(res, e.response?.data?.error?.message || e.message); }
    }

    if (path === '/storage/delete') {
      const { public_id } = req.body || {};
      if (!public_id) return err(res, 'Missing: public_id', 400);
      const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
      const apiKey = process.env.CLOUDINARY_API_KEY;
      const apiSecret = process.env.CLOUDINARY_API_SECRET;
      if (!cloudName || !apiKey || !apiSecret) return err(res, 'Set CLOUDINARY credentials in Vercel environment variables.', 400);
      try {
        const timestamp = Math.floor(Date.now() / 1000);
        const crypto = require('crypto');
        const sig = crypto.createHash('sha1').update(`public_id=${public_id}&timestamp=${timestamp}${apiSecret}`).digest('hex');
        const r = await axios.post(`https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`, { public_id, timestamp, api_key: apiKey, signature: sig }, { timeout: 15000 });
        return ok(res, { success: r.data.result === 'ok', public_id });
      } catch (e) { return err(res, e.message); }
    }

    // ── PHONE LOOKUP (NEW) ───────────────────────────────────────────────────
    if (path === '/phone/lookup') {
      const { number } = req.query;
      if (!number) return err(res, 'Missing: number (include country code e.g. +263771234567)', 400);
      try {
        const r = await axios.get(`https://phonevalidation.abstractapi.com/v1/?api_key=${process.env.ABSTRACTAPI_KEY || 'demo'}&phone=${number.replace(/\s/g, '')}`, { timeout: 10000 });
        return ok(res, { number: r.data.phone, valid: r.data.valid, country: r.data.country?.name, country_code: r.data.country?.calling_code, location: r.data.location, carrier: r.data.carrier, line_type: r.data.line_type, international_format: r.data.format?.international });
      } catch (e) { return err(res, 'Phone lookup requires ABSTRACTAPI_KEY. Free at abstractapi.com'); }
    }

    // ── EMAIL VALIDATOR (NEW) ────────────────────────────────────────────────
    if (path === '/email/validate') {
      const { email } = req.query;
      if (!email) return err(res, 'Missing: email', 400);
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      const valid = emailRegex.test(email);
      const domain = email.split('@')[1] || '';
      const disposableDomains = ['mailinator.com','tempmail.com','guerrillamail.com','10minutemail.com','throwaway.email','temp-mail.org'];
      const isDisposable = disposableDomains.includes(domain.toLowerCase());
      return ok(res, { email, valid, format_valid: valid, domain, is_disposable: isDisposable, is_free: ['gmail.com','yahoo.com','outlook.com','hotmail.com','icloud.com'].includes(domain.toLowerCase()) });
    }

    // ── PASTEBIN / TEXT STORAGE (NEW) ────────────────────────────────────────
    if (path === '/paste/create') {
      const { content, title = 'Untitled', expiry = 'never' } = req.body || {};
      if (!content) return err(res, 'Missing: content', 400);
      try {
        const db = await getDB();
        const id = Math.random().toString(36).slice(2, 10);
        const expiryMap = { '1h': 3600000, '24h': 86400000, '7d': 604800000, 'never': null };
        const expireAt = expiryMap[expiry] ? new Date(Date.now() + expiryMap[expiry]) : null;
        await db.collection('pastes').doc(id).set({ content, title, created_at: new Date(), expire_at: expireAt, views: 0 });
        return ok(res, { id, title, url: `https://api-blacknode-zw.vercel.app/api/paste/${id}`, expiry, created_at: new Date().toISOString() });
      } catch (e) { return err(res, e.message); }
    }

    const pasteMatch = path.match(/^\/paste\/(.+)$/);
    if (pasteMatch) {
      try {
        const db = await getDB();
        const snap = await db.collection('pastes').doc(pasteMatch[1]).get();
        if (!snap.exists) return err(res, 'Paste not found.', 404);
        const data = snap.data();
        if (data.expire_at && new Date() > data.expire_at.toDate()) { await snap.ref.delete(); return err(res, 'Paste has expired.', 404); }
        snap.ref.update({ views: (data.views || 0) + 1 }).catch(() => {});
        return ok(res, { id: pasteMatch[1], title: data.title, content: data.content, views: (data.views || 0) + 1, created_at: data.created_at?.toDate?.()?.toISOString() });
      } catch (e) { return err(res, e.message); }
    }

    // ── RANDOM STUFF (NEW) ───────────────────────────────────────────────────
    if (path === '/random/password') {
      const { length = '16', numbers = 'true', symbols = 'true', uppercase = 'true' } = req.query;
      const len = Math.min(Math.max(parseInt(length) || 16, 8), 128);
      let chars = 'abcdefghijklmnopqrstuvwxyz';
      if (uppercase === 'true') chars += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      if (numbers === 'true') chars += '0123456789';
      if (symbols === 'true') chars += '!@#$%^&*()-_=+[]{}|;:,.<>?';
      const password = Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
      return ok(res, { password, length: len, strength: len >= 16 && numbers === 'true' && symbols === 'true' ? 'strong' : len >= 12 ? 'medium' : 'weak' });
    }

    if (path === '/random/uuid') {
      const { count = '1' } = req.query;
      const n = Math.min(parseInt(count) || 1, 50);
      const uuids = Array.from({ length: n }, () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16); }));
      return ok(res, { count: n, uuids: n === 1 ? uuids[0] : uuids });
    }

    if (path === '/random/color') {
      const hex = '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
      const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
      return ok(res, { hex, rgb: `rgb(${r},${g},${b})`, r, g, b, hsl: rgbToHsl(r, g, b) });
    }

    // ── NOT FOUND ─────────────────────────────────────────────────────────────
    return res.status(404).json({ status: 404, error: `Endpoint not found: ${path}`, docs: 'https://api-blacknode-zw.vercel.app', available_endpoints: ['/tiktok/download','/tiktok/user','/tiktok/search','/tiktok/trending','/youtube/mp3','/youtube/mp4','/youtube/info','/youtube/channel','/instagram/download','/instagram/user','/facebook/download','/twitter/download','/pinterest/download','/spotify/track','/image/search','/image/generate','/image/removebg','/ai/chat','/ai/generate','/ai/tts','/ai/translate','/ai/music','/weather','/currency/convert','/qrcode/generate','/ip/lookup','/url/shorten','/news','/dictionary','/github/user','/screenshot','/fun','/movie/search','/movie/details','/movie/trending','/whatsapp/send','/telegram/send','/telegram/file','/storage/upload','/phone/lookup','/email/validate','/paste/create','/random/password','/random/uuid','/random/color'] });

  } catch (e) {
    return err(res, e.message);
  }
};

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; } else {
    const d = max - min; s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) { case r: h = (g - b) / d + (g < b ? 6 : 0); break; case g: h = (b - r) / d + 2; break; case b: h = (r - g) / d + 4; break; }
    h /= 6;
  }
  return `hsl(${Math.round(h * 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%)`;
}
