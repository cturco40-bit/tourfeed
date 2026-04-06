// Draft system powered by Supabase — persistent, no more cold start issues
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://yumahmnoltvbiadjefxw.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inl1bWFobW5vbHR2YmlhZGplZnh3Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTM5NjQ0MCwiZXhwIjoyMDkwOTcyNDQwfQ.VXcPybKl1c3uJAO59im8hb0zQjEmdwd4e6WGAakC-qs';
const TWITTER_BEARER = process.env.TWITTER_BEARER_TOKEN;

async function sb(path, method, body) {
  const key = SUPABASE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!key) throw new Error('No Supabase key');
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method: method || 'GET',
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : (method === 'PATCH' ? 'return=minimal' : ''),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (method === 'GET') {
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }
  if (method === 'POST' && res.ok) {
    try { return await res.json(); } catch(e) { return []; }
  }
  return res.ok;
}

// Simple hash for dedup
function hashText(text) {
  const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3).sort().join(' ');
  let hash = 0;
  for (let i = 0; i < words.length; i++) hash = ((hash << 5) - hash + words.charCodeAt(i)) | 0;
  return 'h' + Math.abs(hash).toString(36);
}

// Check if content is too similar to posted tweets
async function isSimilarToPosted(text) {
  if (!TWITTER_BEARER) return false;
  try {
    const uRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
      headers: { 'Authorization': `Bearer ${TWITTER_BEARER}` },
    });
    if (!uRes.ok) return false;
    const userId = (await uRes.json()).data?.id;
    if (!userId) return false;

    const tRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=50&tweet.fields=text`, {
      headers: { 'Authorization': `Bearer ${TWITTER_BEARER}` },
    });
    if (!tRes.ok) return false;

    const newWords = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
    const posted = (await tRes.json()).data || [];
    for (const t of posted) {
      const postedWords = t.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      const overlap = newWords.filter(w => postedWords.includes(w)).length;
      if (overlap >= newWords.length * 0.4) return true;
    }
  } catch(e) {}
  return false;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  const params = event.queryStringParameters || {};

  // GET — list pending drafts
  if (event.httpMethod === 'GET' && !params.action) {
    let drafts = [];
    try {
      drafts = await sb('content_drafts?status=eq.pending&order=created_at.desc&limit=30');
      if (!Array.isArray(drafts)) drafts = [];
    } catch(e) { drafts = []; }
    return { statusCode: 200, headers, body: JSON.stringify({ drafts, count: drafts.length }) };
  }

  // Approve
  if (params.action === 'approve') {
    const id = parseInt(params.id);
    const drafts = await sb(`content_drafts?id=eq.${id}&status=eq.pending`);
    const draft = drafts?.[0];
    if (!draft) return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2>Draft expired or already handled</h2><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>' };

    try {
      // Post the tweet (use edited text from query param if provided)
      const tweetText = params.text || draft.body;
      await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: tweetText, image: draft.image_url || undefined }),
      });

      // Mark as published
      await sb(`content_drafts?id=eq.${id}`, 'PATCH', { status: 'published', published_at: new Date().toISOString() });

      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#2DD4A0">Posted</h2><p style="color:#868E96;max-width:400px;margin:20px auto;line-height:1.6">${tweetText.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>` };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#FF6B6B">Failed</h2><p style="color:#868E96">${e.message}</p><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>` };
    }
  }

  // Reject
  if (params.action === 'reject') {
    const id = parseInt(params.id);
    await sb(`content_drafts?id=eq.${id}`, 'PATCH', { status: 'rejected', reviewed_at: new Date().toISOString() });
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#D4A853">Rejected</h2><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>' };
  }

  // Clear all pending
  if (params.action === 'clear') {
    await sb('content_drafts?status=eq.pending', 'PATCH', { status: 'rejected', reviewed_at: new Date().toISOString() });
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // POST — add draft
  if (event.httpMethod === 'POST') {
    try {
      const { text, source, type, title, image_url, article_url, article_slug, meta } = JSON.parse(event.body);
      if (!text || text.length < 10) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Too short' }) };

      // Generate content hash for dedup
      const hash = hashText(text);

      // Check if this hash already exists (posted, pending, or rejected)
      const existing = await sb(`content_hashes?hash=eq.${hash}`);
      if (existing?.length > 0) {
        return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Duplicate content hash' }) };
      }

      // Check against posted tweets on Twitter
      if (await isSimilarToPosted(text)) {
        // Store the hash so we don't check again
        await sb('content_hashes', 'POST', { hash, type: 'rejected_similar', source: 'twitter_check' });
        return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Similar to posted tweet' }) };
      }

      // Check against existing pending/rejected drafts in Supabase
      let recent = [];
      try { recent = await sb('content_drafts?order=created_at.desc&limit=50&select=body') || []; } catch(e) { recent = []; }
      if (!Array.isArray(recent)) recent = [];
      const newWords = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      for (const d of recent) {
        const existingWords = d.body.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
        const overlap = newWords.filter(w => existingWords.includes(w)).length;
        if (overlap >= newWords.length * 0.4) {
          return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Similar to existing draft' }) };
        }
      }

      // Store the hash
      await sb('content_hashes', 'POST', { hash, type: type || 'tweet', source: source || 'auto' });

      // Create the draft
      const draft = await sb('content_drafts', 'POST', {
        type: type || 'tweet_reaction',
        body: text,
        title: title || null,
        image_url: image_url || null,
        article_url: article_url || null,
        article_slug: article_slug || null,
        content_hash: hash,
        source_event: source || 'auto',
        meta: meta || {},
      });

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: draft?.[0]?.id }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
