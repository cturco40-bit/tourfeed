let draftsCache = [];
let rejectedIds = new Set(); // Persists as long as function is warm

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

  // GET — list pending drafts or rejected IDs
  if (event.httpMethod === 'GET' && !params.action) {
    return { statusCode: 200, headers, body: JSON.stringify({
      drafts: draftsCache,
      count: draftsCache.length,
      rejectedIds: [...rejectedIds],
    })};
  }

  // Approve
  if (params.action === 'approve') {
    const id = parseInt(params.id);
    const draft = draftsCache.find(d => d.id === id);
    if (!draft) return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2>Draft already posted or expired</h2><a href="/tf-admin-drafts" style="color:#2D8F6F;font-size:13px">← Back to Drafts</a></body></html>' };

    try {
      await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.text }),
      });
      // Track the source tweet ID as used
      const tweetIdMatch = draft.text.match(/twitter\.com\/\w+\/status\/(\d+)/);
      if (tweetIdMatch) rejectedIds.add(tweetIdMatch[1]); // "used" = don't re-draft
      draftsCache = draftsCache.filter(d => d.id !== id);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#2DD4A0">Tweet Posted!</h2><p style="color:#868E96;max-width:400px;margin:20px auto;line-height:1.6">${draft.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p><a href="/tf-admin-drafts" style="color:#2D8F6F;font-size:13px">← Back to Drafts</a></body></html>` };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#FF6B6B">Failed</h2><p style="color:#868E96">${e.message}</p></body></html>` };
    }
  }

  // Reject — store the source tweet ID so it never comes back
  if (params.action === 'reject') {
    const id = parseInt(params.id);
    const draft = draftsCache.find(d => d.id === id);
    if (draft) {
      const tweetIdMatch = draft.text.match(/twitter\.com\/\w+\/status\/(\d+)/);
      if (tweetIdMatch) rejectedIds.add(tweetIdMatch[1]);
    }
    draftsCache = draftsCache.filter(d => d.id !== id);
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#D4A853">Rejected</h2><a href="/tf-admin-drafts" style="color:#2D8F6F;font-size:13px">← Back</a></body></html>' };
  }

  // Clear
  if (params.action === 'clear') {
    draftsCache = [];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  // POST — add a new draft (check rejected IDs first)
  if (event.httpMethod === 'POST') {
    try {
      const { text, source } = JSON.parse(event.body);
      if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing text' }) };

      // Check if source tweet was already rejected
      const tweetIdMatch = text.match(/twitter\.com\/\w+\/status\/(\d+)/);
      if (tweetIdMatch && rejectedIds.has(tweetIdMatch[1])) {
        return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Source tweet was rejected', tweetId: tweetIdMatch[1] }) };
      }

      // Check if already in drafts
      if (tweetIdMatch) {
        const alreadyDrafted = draftsCache.some(d => d.text.includes(tweetIdMatch[1]));
        if (alreadyDrafted) {
          return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'Already in drafts' }) };
        }
      }

      const id = Date.now();
      draftsCache.push({ id, text, source: source || 'auto', created: new Date().toISOString() });
      if (draftsCache.length > 30) draftsCache = draftsCache.slice(-30);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id, text }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
