let draftsCache = [];

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

  // GET — list drafts
  if (event.httpMethod === 'GET' && !params.action) {
    return { statusCode: 200, headers, body: JSON.stringify({ drafts: draftsCache, count: draftsCache.length }) };
  }

  // Approve
  if (params.action === 'approve') {
    const id = parseInt(params.id);
    const draft = draftsCache.find(d => d.id === id);
    if (!draft) return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2>Draft expired</h2><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>' };

    try {
      await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.text }),
      });
      draftsCache = draftsCache.filter(d => d.id !== id);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#2DD4A0">Posted</h2><p style="color:#868E96;max-width:400px;margin:20px auto;line-height:1.6">${draft.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>` };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#FF6B6B">Failed</h2><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>` };
    }
  }

  // Reject
  if (params.action === 'reject') {
    const id = parseInt(params.id);
    draftsCache = draftsCache.filter(d => d.id !== id);
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#D4A853">Rejected</h2><a href="/tf-admin-drafts" style="color:#2D8F6F">Back</a></body></html>' };
  }

  // Clear
  if (params.action === 'clear') {
    draftsCache = [];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // POST — add draft
  if (event.httpMethod === 'POST') {
    try {
      const { text, source } = JSON.parse(event.body);
      if (!text || text.length < 10) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Too short' }) };

      // Dedup: check if this exact text (or very similar) is already in drafts
      const newWords = text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      for (const d of draftsCache) {
        const existingWords = d.text.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3);
        const overlap = newWords.filter(w => existingWords.includes(w)).length;
        if (overlap >= newWords.length * 0.5) {
          return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Similar draft exists' }) };
        }
      }

      const id = Date.now() + Math.floor(Math.random() * 1000);
      draftsCache.push({ id, text, source: source || 'auto', created: new Date().toISOString() });
      if (draftsCache.length > 30) draftsCache = draftsCache.slice(-30);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
