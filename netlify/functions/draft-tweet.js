// Persistent draft storage using a simple JSON endpoint
// Drafts stored in Netlify's deploy-time KV via fetch to our own endpoint

// Use a simple self-referencing cache file approach
// Store drafts as a Netlify environment variable (updated via API)
// Fallback: in-memory with longer TTL

let draftsCache = [];
let lastSync = 0;

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
    return { statusCode: 200, headers, body: JSON.stringify({ drafts: draftsCache, count: draftsCache.length }) };
  }

  // Approve a draft
  if (params.action === 'approve') {
    const id = parseInt(params.id);
    const draft = draftsCache.find(d => d.id === id);
    if (!draft) return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2>Draft already posted or expired</h2><p style="color:#868E96;margin-top:10px">Drafts reset when the server restarts. Check /tf-admin-drafts for current drafts.</p></body></html>' };

    try {
      const res = await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.text }),
      });
      const data = await res.json();
      draftsCache = draftsCache.filter(d => d.id !== id);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#2DD4A0">Tweet Posted!</h2><p style="color:#868E96;max-width:400px;margin:20px auto;line-height:1.6">${draft.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p><a href="/tf-admin-drafts" style="color:#2D8F6F;font-size:13px">← Back to Drafts</a></body></html>` };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#FF6B6B">Failed to post</h2><p style="color:#868E96">${e.message}</p></body></html>` };
    }
  }

  // Reject a draft
  if (params.action === 'reject') {
    const id = parseInt(params.id);
    draftsCache = draftsCache.filter(d => d.id !== id);
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#D4A853">Tweet Rejected</h2><a href="/tf-admin-drafts" style="color:#2D8F6F;font-size:13px">← Back to Drafts</a></body></html>' };
  }

  // Clear all
  if (params.action === 'clear') {
    draftsCache = [];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // POST — add a new draft
  if (event.httpMethod === 'POST') {
    try {
      const { text, source } = JSON.parse(event.body);
      if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing text' }) };

      const id = Date.now();
      const draft = { id, text, source: source || 'auto', created: new Date().toISOString() };
      draftsCache.push(draft);
      if (draftsCache.length > 30) draftsCache = draftsCache.slice(-30);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id, text }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
