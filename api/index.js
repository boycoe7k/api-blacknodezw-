// api/index.js - Single unified handler for ALL endpoints
// Keeps everything within Vercel free plan 12-function limit

const axios = require('axios');
const QRCode = require('qrcode');

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,x-api-key,Authorization');
}
function ok(res, data) { return res.status(200).json({ status: 200, data }); }
function err(res, msg, code = 500) { return res.status(code).json({ status: code, error: msg }); }

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
  const key = req.headers['x-api-key'];
  if (!key) { err(res, 'Missing API key in x-api-key header.', 401); return false; }
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

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const path = req.url.replace(/\?.*/, '').replace(/^\/api/, '');

  // No auth routes
  if (path === '' || path === '/' || path === '/status') {
    return res.json({ status: 'online', name: 'Black Node ZW API', version: '1.0.0', base_url: 'https://api.blacknodezw.vercel.app', endpoints: 30, timestamp: new Date().toISOString() });
  }
  const shortMatch = path.match(/^\/s\/(.+)$/);
  if (shortMatch) {
    try {
      const db = await getDB();
      const snap = await db.collection('short_urls').doc(shortMatch[1]).get();
      if (!snap.exists) return res.status(404).send('Link not found');
      snap.ref.update({ clicks: (snap.data().clicks || 0) + 1 }).catch(() => {});
      return res.redirect(301, snap.data().url);
    } catch (e) { return res.redirect('https://api.blacknodezw.vercel.app'); }
  }

  if (!(await authCheck(req, res))) return;

  try {
    // TIKTOK
    if (path === '/tiktok/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const r = await axios.post('https://www.tikwm.com/api/', new URLSearchParams({ url, hd: '1' }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      const d = r.data?.data;
      if (r.data?.code === 0 && d) return ok(res, { title: d.title || '', author: '@' + (d.author?.unique_id || ''), thumbnail: d.cover || '', download_url_hd: d.hdplay || d.play || '', download_url_sd: d.play || '', music_url: d.music || '', duration: d.duration || 0, play_count: d.play_count || 0, like_count: d.digg_count || 0 });
      return err(res, 'Could not fetch video. Check the URL.');
    }

    if (path === '/tiktok/user') {
      const { username, include_videos = 'false', video_count = '10' } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const clean = username.replace(/^@/, '');
      const r = await axios.post('https://www.tikwm.com/api/user/info', new URLSearchParams({ unique_id: clean }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      if (r.data?.code !== 0) return err(res, 'User not found or account is private.');
      const u = r.data.data?.user || {}, s = r.data.data?.stats || {};
      const result = { username: u.uniqueId || clean, nickname: u.nickname || '', bio: u.signature || '', avatar: u.avatarLarger || '', verified: u.verified || false, private: u.privateAccount || false, followers: s.followerCount || 0, following: s.followingCount || 0, likes: s.heartCount || 0, video_count: s.videoCount || 0, profile_url: `https://www.tiktok.com/@${clean}` };
      if (include_videos === 'true') {
        try {
          const vr = await axios.post('https://www.tikwm.com/api/user/posts', new URLSearchParams({ unique_id: clean, count: Math.min(parseInt(video_count), 30), cursor: '0' }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
          if (vr.data?.code === 0) result.recent_videos = (vr.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', duration: v.duration || 0, play_count: v.play_count || 0, like_count: v.digg_count || 0, url: `https://www.tiktok.com/@${clean}/video/${v.video_id}` }));
        } catch (_) {}
      }
      return ok(res, result);
    }

    if (path === '/tiktok/search') {
      const { q, count = '20', cursor = '0' } = req.query;
      if (!q) return err(res, 'Missing: q', 400);
      const r = await axios.post('https://www.tikwm.com/api/feed/search', new URLSearchParams({ keywords: q, count: Math.min(parseInt(count), 50), cursor }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      if (r.data?.code !== 0) return err(res, 'Search failed.');
      return ok(res, { query: q, total: r.data.data?.videos?.length || 0, videos: (r.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', duration: v.duration || 0, play_count: v.play_count || 0, like_count: v.digg_count || 0, author: { username: v.author?.unique_id || '', nickname: v.author?.nickname || '' }, url: `https://www.tiktok.com/@${v.author?.unique_id}/video/${v.video_id}` })) });
    }

    if (path === '/tiktok/trending') {
      const { region = 'US', count = '20' } = req.query;
      const r = await axios.post('https://www.tikwm.com/api/feed/list', new URLSearchParams({ region, count: Math.min(parseInt(count), 50) }), { headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 });
      if (r.data?.code !== 0) return err(res, 'Could not fetch trending.');
      return ok(res, { region, total: r.data.data?.videos?.length || 0, videos: (r.data.data?.videos || []).map(v => ({ id: v.video_id, title: v.title || '', cover: v.cover || '', download_url: v.hdplay || v.play || '', duration: v.duration || 0, play_count: v.play_count || 0, author: { username: v.author?.unique_id || '', nickname: v.author?.nickname || '' } })) });
    }

    // YOUTUBE
    if (path === '/youtube/mp3' || path === '/youtube/mp4') {
      const { url, quality = '720' } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const videoId = url.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/)?.[1];
      if (!videoId) return err(res, 'Invalid YouTube URL', 400);
      const isAudio = path === '/youtube/mp3';
      const [cobalt, oembed] = await Promise.allSettled([
        axios.post('https://api.cobalt.tools/api/json', isAudio ? { url: `https://www.youtube.com/watch?v=${videoId}`, isAudioOnly: true, aFormat: 'mp3', audioBitrate: '320' } : { url: `https://www.youtube.com/watch?v=${videoId}`, vQuality: quality }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 }),
        axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { timeout: 6000 })
      ]);
      const title = oembed.value?.data?.title || 'YouTube';
      const channel = oembed.value?.data?.author_name || 'YouTube';
      const thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
      const cd = cobalt.value?.data;
      if (cd?.status === 'stream' || cd?.status === 'redirect') return ok(res, { video_id: videoId, title, channel, thumbnail, download_url: cd.url, quality: isAudio ? '320kbps' : quality + 'p', format: isAudio ? 'mp3' : 'mp4' });
      if (cd?.status === 'picker' && cd.picker?.length) return ok(res, { video_id: videoId, title, channel, thumbnail, download_url: cd.picker[0].url, quality: quality + 'p', format: 'mp4' });
      return err(res, 'Could not fetch. Try again.');
    }

    if (path === '/youtube/info') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const videoId = url.match(/(?:v=|youtu\.be\/|embed\/)([^&\n?#]+)/)?.[1];
      if (!videoId) return err(res, 'Invalid YouTube URL', 400);
      const ytKey = process.env.YOUTUBE_API_KEY;
      if (ytKey) {
        const r = await axios.get('https://www.googleapis.com/youtube/v3/videos', { params: { key: ytKey, id: videoId, part: 'snippet,statistics' }, timeout: 10000 });
        const item = r.data.items?.[0];
        if (item) return ok(res, { video_id: videoId, title: item.snippet.title, channel: item.snippet.channelTitle, thumbnail: item.snippet.thumbnails?.high?.url || '', views: parseInt(item.statistics.viewCount) || 0, likes: parseInt(item.statistics.likeCount) || 0, comments: parseInt(item.statistics.commentCount) || 0, published_at: item.snippet.publishedAt });
      }
      const r = await axios.get(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`, { timeout: 8000 });
      return ok(res, { video_id: videoId, title: r.data.title, channel: r.data.author_name, thumbnail: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` });
    }

    if (path === '/youtube/channel') {
      const { channel } = req.query;
      if (!channel) return err(res, 'Missing: channel', 400);
      const ytKey = process.env.YOUTUBE_API_KEY;
      if (!ytKey) return err(res, 'Set YOUTUBE_API_KEY in environment variables.');
      const search = await axios.get('https://www.googleapis.com/youtube/v3/search', { params: { key: ytKey, q: channel.replace(/^@/, ''), type: 'channel', part: 'id', maxResults: 1 }, timeout: 10000 });
      const channelId = search.data.items?.[0]?.id?.channelId;
      if (!channelId) return err(res, 'Channel not found.', 404);
      const stats = await axios.get('https://www.googleapis.com/youtube/v3/channels', { params: { key: ytKey, id: channelId, part: 'snippet,statistics' }, timeout: 10000 });
      const ch = stats.data.items?.[0];
      if (!ch) return err(res, 'Channel not found.', 404);
      return ok(res, { channel_id: channelId, title: ch.snippet.title, description: ch.snippet.description, avatar: ch.snippet.thumbnails?.high?.url || '', subscribers: parseInt(ch.statistics.subscriberCount) || 0, total_views: parseInt(ch.statistics.viewCount) || 0, video_count: parseInt(ch.statistics.videoCount) || 0 });
    }

    // INSTAGRAM
    if (path === '/instagram/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const r = await axios.post('https://api.cobalt.tools/api/json', { url }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 });
      if (r.data.status === 'stream' || r.data.status === 'redirect') return ok(res, { type: 'video', download_url: r.data.url });
      if (r.data.status === 'picker') return ok(res, { type: 'gallery', items: r.data.picker.map(p => ({ type: p.type, url: p.url })) });
      return err(res, 'Could not download. Make sure the post is public.');
    }

    if (path === '/instagram/user') {
      const { username } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const clean = username.replace(/^@/, '');
      const r = await axios.get(`https://www.instagram.com/api/v1/users/web_profile_info/?username=${clean}`, { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X)', 'X-IG-App-ID': '936619743392459', Referer: `https://www.instagram.com/${clean}/` }, timeout: 15000 });
      const u = r.data?.data?.user;
      if (!u) return err(res, 'User not found or account is private.', 404);
      return ok(res, { username: u.username, full_name: u.full_name || '', bio: u.biography || '', avatar: u.profile_pic_url_hd || u.profile_pic_url || '', verified: u.is_verified || false, private: u.is_private || false, followers: u.edge_followed_by?.count || 0, following: u.edge_follow?.count || 0, posts: u.edge_owner_to_timeline_media?.count || 0 });
    }

    // OTHER DOWNLOADERS
    if (path === '/facebook/download' || path === '/twitter/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const r = await axios.post('https://api.cobalt.tools/api/json', { url }, { headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, timeout: 20000 });
      if (r.data.status === 'stream' || r.data.status === 'redirect') return ok(res, { download_url: r.data.url });
      if (r.data.status === 'picker') return ok(res, { items: r.data.picker.map(p => ({ type: p.type, url: p.url })) });
      return err(res, 'Could not download. Make sure the content is public.');
    }

    if (path === '/pinterest/download') {
      const { url } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const cheerio = require('cheerio');
      const r = await axios.get(url, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' }, maxRedirects: 5, timeout: 15000 });
      const $ = cheerio.load(r.data);
      const videoUrl = $('meta[property="og:video"]').attr('content') || '';
      const imageUrl = $('meta[property="og:image"]').attr('content') || '';
      if (!videoUrl && !imageUrl) return err(res, 'No media found. Make sure the pin is public.');
      const hdImage = imageUrl.replace(/\/\d+x\//, '/originals/');
      return ok(res, { type: videoUrl ? 'video' : 'image', title: $('meta[property="og:title"]').attr('content') || '', download_url: videoUrl || hdImage, thumbnail: imageUrl, hd_image: hdImage });
    }

    // IMAGE
    if (path === '/image/search') {
      const { q, count = '10' } = req.query;
      if (!q) return err(res, 'Missing: q', 400);
      const gKey = process.env.GOOGLE_SEARCH_API_KEY, cx = process.env.GOOGLE_SEARCH_CX;
      if (gKey && cx) {
        const r = await axios.get('https://www.googleapis.com/customsearch/v1', { params: { key: gKey, cx, q, searchType: 'image', num: Math.min(parseInt(count), 10) }, timeout: 10000 });
        return ok(res, { query: q, images: (r.data.items || []).map(i => ({ url: i.link, thumbnail: i.image?.thumbnailLink || '', title: i.title })) });
      }
      const vqdR = await axios.get('https://duckduckgo.com/', { params: { q }, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000 });
      const vqd = vqdR.data.match(/vqd=['"](\d+-[^'"]+)['"]/)?.[1] || '';
      const imgR = await axios.get('https://duckduckgo.com/i.js', { params: { l: 'us-en', o: 'json', q, vqd, p: '-1' }, headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://duckduckgo.com/' }, timeout: 10000 });
      return ok(res, { query: q, images: (imgR.data.results || []).slice(0, parseInt(count)).map(r => ({ url: r.image, thumbnail: r.thumbnail, title: r.title })) });
    }

    if (path === '/image/generate') {
      const prompt = req.body?.prompt || req.query?.prompt;
      if (!prompt) return err(res, 'Missing: prompt', 400);
      const style = req.body?.style || req.query?.style || 'realistic';
      const styleMap = { anime: 'anime style,', art: 'digital art,', cartoon: 'cartoon,', sketch: 'pencil sketch,' };
      const fullPrompt = ((styleMap[style] || '') + ' ' + prompt).trim();
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        const r = await axios.post('https://api.openai.com/v1/images/generations', { model: 'dall-e-3', prompt: fullPrompt, n: 1, size: '1024x1024' }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 60000 });
        return ok(res, { prompt: fullPrompt, image_url: r.data.data[0]?.url, model: 'dall-e-3' });
      }
      const seed = Math.floor(Math.random() * 1000000);
      const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt)}?width=1024&height=1024&model=flux&seed=${seed}&nologo=true`;
      return ok(res, { prompt: fullPrompt, image_url: imageUrl, model: 'flux', seed });
    }

    // AI
    if (path === '/ai/chat') {
      const { message, system = 'You are a helpful AI assistant.' } = req.body || {};
      if (!message) return err(res, 'Missing: message', 400);
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        const r = await axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-3.5-turbo', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 1024 }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 25000 });
        return ok(res, { message, response: r.data.choices[0]?.message?.content || '', model: 'gpt-3.5-turbo', tokens_used: r.data.usage?.total_tokens || 0 });
      }
      const r = await axios.post('https://api.deepinfra.com/v1/openai/chat/completions', { model: 'meta-llama/Meta-Llama-3-8B-Instruct', messages: [{ role: 'system', content: system }, { role: 'user', content: message }], max_tokens: 1024 }, { headers: { 'Content-Type': 'application/json' }, timeout: 25000 });
      return ok(res, { message, response: r.data.choices[0]?.message?.content || '', model: 'llama-3-8b' });
    }

    if (path === '/ai/generate') {
      const { prompt, type = 'default', length = 'medium', tone = 'professional' } = req.body || {};
      if (!prompt) return err(res, 'Missing: prompt', 400);
      const typeMap = { article: 'Write a detailed article about:', code: 'Write clean code for:', story: 'Write a short story about:', email: 'Write a professional email for:' };
      const maxTokens = { short: 300, medium: 700, long: 1400 }[length] || 700;
      const fullPrompt = `${typeMap[type] || ''} ${prompt} (Tone: ${tone})`.trim();
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        const r = await axios.post('https://api.openai.com/v1/chat/completions', { model: 'gpt-3.5-turbo', messages: [{ role: 'user', content: fullPrompt }], max_tokens: maxTokens }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, timeout: 30000 });
        const output = r.data.choices[0]?.message?.content || '';
        return ok(res, { prompt, type, output, word_count: output.split(/\s+/).length });
      }
      const r = await axios.get(`https://text.pollinations.ai/${encodeURIComponent(fullPrompt)}`, { headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 25000 });
      const output = typeof r.data === 'string' ? r.data : JSON.stringify(r.data);
      return ok(res, { prompt, type, output, word_count: output.split(/\s+/).length, model: 'pollinations' });
    }

    if (path === '/ai/tts') {
      const text = req.body?.text || req.query?.text;
      const voice = req.body?.voice || req.query?.voice || 'Brian';
      if (!text) return err(res, 'Missing: text', 400);
      if (text.length > 3000) return err(res, 'Text too long. Max 3000 chars.', 400);
      const openaiKey = process.env.OPENAI_API_KEY;
      if (openaiKey) {
        const r = await axios.post('https://api.openai.com/v1/audio/speech', { model: 'tts-1', input: text, voice: 'alloy' }, { headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' }, responseType: 'arraybuffer', timeout: 25000 });
        res.setHeader('Content-Type', 'audio/mpeg');
        return res.send(Buffer.from(r.data));
      }
      const voices = ['Brian','Amy','Emma','Matthew','Joanna','Joey','Kendra','Kimberly','Salli'];
      const sel = voices.includes(voice) ? voice : 'Brian';
      return ok(res, { text, voice: sel, audio_url: `https://api.streamelements.com/kappa/v2/speech?voice=${sel}&text=${encodeURIComponent(text)}`, format: 'mp3' });
    }

    if (path === '/ai/translate') {
      const { text, to, from = 'auto' } = req.query;
      if (!text) return err(res, 'Missing: text', 400);
      if (!to) return err(res, 'Missing: to', 400);
      try {
        const r = await axios.get('https://translate.googleapis.com/translate_a/single', { params: { client: 'gtx', sl: from === 'auto' ? 'auto' : from, tl: to, dt: 't', q: text }, headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 10000 });
        return ok(res, { original: text, translated: r.data[0]?.map(s => s[0]).join('') || '', from: r.data[2] || from, to });
      } catch (_) {
        const r = await axios.get('https://api.mymemory.translated.net/get', { params: { q: text, langpair: `${from}|${to}` }, timeout: 10000 });
        return ok(res, { original: text, translated: r.data.responseData.translatedText, from, to });
      }
    }

    // UTILITY
    if (path === '/weather') {
      const { city, units = 'metric' } = req.query;
      if (!city) return err(res, 'Missing: city', 400);
      const geo = await axios.get('https://nominatim.openstreetmap.org/search', { params: { q: city, format: 'json', limit: 1 }, headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 8000 });
      if (!geo.data?.length) return err(res, `City not found: ${city}`, 404);
      const { lat, lon, display_name } = geo.data[0];
      const w = await axios.get('https://api.open-meteo.com/v1/forecast', { params: { latitude: lat, longitude: lon, current: 'temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation', daily: 'weather_code,temperature_2m_max,temperature_2m_min', temperature_unit: units === 'imperial' ? 'fahrenheit' : 'celsius', wind_speed_unit: units === 'imperial' ? 'mph' : 'kmh', timezone: 'auto', forecast_days: 7 }, timeout: 10000 });
      const c = w.data.current, unit = units === 'imperial' ? '°F' : '°C';
      const WMO = { 0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast', 45: 'Foggy', 61: 'Slight rain', 63: 'Moderate rain', 65: 'Heavy rain', 80: 'Showers', 95: 'Thunderstorm' };
      return ok(res, { city: display_name.split(',')[0], temperature: `${c.temperature_2m}${unit}`, feels_like: `${c.apparent_temperature}${unit}`, condition: WMO[c.weather_code] || 'Unknown', humidity: `${c.relative_humidity_2m}%`, wind_speed: `${c.wind_speed_10m} ${units === 'imperial' ? 'mph' : 'km/h'}`, forecast: w.data.daily.time.map((d, i) => ({ date: d, high: `${w.data.daily.temperature_2m_max[i]}${unit}`, low: `${w.data.daily.temperature_2m_min[i]}${unit}` })) });
    }

    if (path === '/currency/convert') {
      const { from = 'USD', to, amount = '1', action } = req.query;
      const r = await axios.get(`https://open.er-api.com/v6/latest/${from.toUpperCase()}`, { timeout: 10000 });
      if (action === 'rates') return ok(res, { base: from.toUpperCase(), rates: r.data.rates, last_updated: r.data.time_last_update_utc });
      if (!to) return err(res, 'Missing: to', 400);
      const rate = r.data.rates[to.toUpperCase()];
      if (!rate) return err(res, `Currency not found: ${to}`, 400);
      const amt = parseFloat(amount);
      return ok(res, { from: from.toUpperCase(), to: to.toUpperCase(), amount: amt, rate, result: parseFloat((amt * rate).toFixed(6)), formatted: `${(amt * rate).toFixed(2)} ${to.toUpperCase()}` });
    }

    if (path === '/qrcode/generate') {
      const { data, size = '300', color = '000000', bg = 'ffffff', format = 'png' } = req.query;
      if (!data) return err(res, 'Missing: data', 400);
      const sizeNum = Math.min(Math.max(parseInt(size) || 300, 100), 1000);
      const opts = { width: sizeNum, margin: 2, color: { dark: `#${color}`, light: `#${bg}` } };
      if (format === 'base64') { const dataUrl = await QRCode.toDataURL(data, opts); return ok(res, { data, image: dataUrl }); }
      if (format === 'svg') { res.setHeader('Content-Type', 'image/svg+xml'); return res.send(await QRCode.toString(data, { ...opts, type: 'svg' })); }
      res.setHeader('Content-Type', 'image/png');
      return res.send(await QRCode.toBuffer(data, opts));
    }

    if (path === '/ip/lookup') {
      let { ip } = req.query;
      if (!ip) ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || '';
      const r = await axios.get(`https://ipwho.is/${ip}`, { timeout: 8000 });
      if (!r.data.success) return err(res, 'IP lookup failed.', 400);
      return ok(res, { ip: r.data.ip, country: r.data.country, country_code: r.data.country_code, region: r.data.region, city: r.data.city, latitude: r.data.latitude, longitude: r.data.longitude, timezone: r.data.timezone?.id || '', isp: r.data.connection?.isp || '' });
    }

    if (path === '/url/shorten') {
      const url = req.body?.url || req.query?.url;
      const alias = req.body?.alias || req.query?.alias || Math.random().toString(36).slice(2, 8);
      if (!url) return err(res, 'Missing: url', 400);
      try { new URL(url); } catch { return err(res, 'Invalid URL format', 400); }
      const db = await getDB();
      const ref = db.collection('short_urls').doc(alias);
      const snap = await ref.get();
      if (!snap.exists) await ref.set({ url, alias, clicks: 0, created_at: new Date() });
      return ok(res, { original: url, short: `https://api.blacknodezw.vercel.app/api/s/${alias}`, alias, clicks: snap.exists ? snap.data().clicks : 0 });
    }

    if (path === '/news') {
      const { q, category = 'general', limit = '10' } = req.query;
      const ndKey = process.env.NEWSDATA_API_KEY;
      if (ndKey) {
        const params = { apikey: ndKey, language: 'en', size: Math.min(parseInt(limit), 50) };
        if (q) params.q = q; else params.category = category;
        const r = await axios.get('https://newsdata.io/api/1/news', { params, timeout: 12000 });
        if (r.data.status === 'success') return ok(res, { query: q || category, articles: (r.data.results || []).map(a => ({ title: a.title || '', description: a.description || '', url: a.link || '', image: a.image_url || '', source: a.source_id || '', published_at: a.pubDate || '' })) });
      }
      const RSS = { general: 'https://feeds.bbci.co.uk/news/rss.xml', technology: 'https://feeds.bbci.co.uk/news/technology/rss.xml', sports: 'https://feeds.bbci.co.uk/sport/rss.xml', business: 'https://feeds.bbci.co.uk/news/business/rss.xml' };
      const r = await axios.get(RSS[category] || RSS.general, { headers: { 'User-Agent': 'BlackNodeZW/1.0' }, timeout: 12000 });
      const items = [];
      for (const m of r.data.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
        const i = m[1];
        const title = (i.match(/<title><!\[CDATA\[(.+?)\]\]>/) || i.match(/<title>(.+?)<\/title>/))?.[1] || '';
        const link = i.match(/<link>(.+?)<\/link>/)?.[1] || '';
        if (title) items.push({ title: title.trim(), url: link.trim(), source: 'BBC News' });
        if (items.length >= parseInt(limit)) break;
      }
      return ok(res, { query: q || category, articles: items });
    }

    if (path === '/dictionary') {
      const { word, lang = 'en' } = req.query;
      if (!word) return err(res, 'Missing: word', 400);
      const r = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/${lang}/${encodeURIComponent(word.trim().toLowerCase())}`, { timeout: 10000 });
      const entry = r.data[0];
      return ok(res, { word: entry.word, phonetic: entry.phonetic || '', meanings: (entry.meanings || []).map(m => ({ part_of_speech: m.partOfSpeech, definitions: (m.definitions || []).slice(0, 3).map(d => ({ definition: d.definition, example: d.example || '' })), synonyms: (m.synonyms || []).slice(0, 8) })) });
    }

    if (path === '/github/user') {
      const { username, action = 'user', repo } = req.query;
      if (!username) return err(res, 'Missing: username', 400);
      const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}`, 'User-Agent': 'BlackNodeZW/1.0' } : { 'User-Agent': 'BlackNodeZW/1.0' };
      if (action === 'repos') {
        const r = await axios.get(`https://api.github.com/users/${username}/repos?sort=stars&per_page=20`, { headers, timeout: 10000 });
        return ok(res, { username, repos: r.data.map(r => ({ name: r.name, description: r.description || '', url: r.html_url, language: r.language || '', stars: r.stargazers_count, forks: r.forks_count })) });
      }
      const r = await axios.get(`https://api.github.com/users/${username}`, { headers, timeout: 10000 });
      const u = r.data;
      return ok(res, { username: u.login, name: u.name || '', bio: u.bio || '', avatar: u.avatar_url, url: u.html_url, followers: u.followers, following: u.following, public_repos: u.public_repos, location: u.location || '' });
    }

    if (path === '/fun') {
      const { type = 'quote', category = 'general' } = req.query;
      if (type === 'quote') { const r = await axios.get('https://zenquotes.io/api/random', { timeout: 8000 }); return ok(res, { type: 'quote', content: r.data[0].q, author: r.data[0].a }); }
      if (type === 'joke') { const r = await axios.get(`https://v2.jokeapi.dev/joke/Any?blacklistFlags=nsfw,racist,sexist`, { timeout: 8000 }); return ok(res, { type: 'joke', category: r.data.category, joke: r.data.joke || null, setup: r.data.setup || null, delivery: r.data.delivery || null }); }
      if (type === 'fact') { const r = await axios.get('https://uselessfacts.jsph.pl/api/v2/facts/random?language=en', { timeout: 8000 }); return ok(res, { type: 'fact', content: r.data.text }); }
      if (type === 'trivia') { const r = await axios.get('https://opentdb.com/api.php?amount=1&type=multiple', { timeout: 8000 }); const q = r.data.results?.[0]; if (q) return ok(res, { type: 'trivia', category: q.category, difficulty: q.difficulty, question: q.question, correct_answer: q.correct_answer, incorrect_answers: q.incorrect_answers }); }
      return err(res, `Invalid type: ${type}. Use: quote, joke, fact, trivia`, 400);
    }

    if (path === '/spotify/track') {
      const { url, action, q } = req.query;
      const clientId = process.env.SPOTIFY_CLIENT_ID, clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
      if (!clientId || !clientSecret) return err(res, 'Set SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET in environment variables.');
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
    }

    if (path === '/screenshot') {
      const { url, width = '1280', height = '720' } = req.query;
      if (!url) return err(res, 'Missing: url', 400);
      const r = await axios.get(`https://image.thum.io/get/width/${width}/crop/${height}/noanimate/${encodeURIComponent(url)}`, { responseType: 'arraybuffer', timeout: 20000, headers: { 'User-Agent': 'BlackNodeZW/1.0' } });
      res.setHeader('Content-Type', 'image/jpeg');
      return res.send(Buffer.from(r.data));
    }

    return res.status(404).json({ status: 404, error: `Endpoint not found: ${path}`, docs: 'https://api.blacknodezw.vercel.app' });

  } catch (e) {
    return err(res, e.message);
  }
};

