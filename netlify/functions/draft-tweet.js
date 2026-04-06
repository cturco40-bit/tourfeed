// Tweet draft queue — stores pending tweets, sends ntfy notification for approval
// Approve via: POST /draft-tweet?action=approve&id=X
// List via: GET /draft-tweet

let drafts = []; // In-memory queue (resets on cold start)

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
    return { statusCode: 200, headers, body: JSON.stringify({ drafts, count: drafts.length }) };
  }

  // Approve a draft
  if (params.action === 'approve') {
    const id = parseInt(params.id);
    const draft = drafts.find(d => d.id === id);
    if (!draft) return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2>Draft already posted or expired</h2></body></html>' };

    try {
      const res = await fetch('https://tourfeed.co/.netlify/functions/post-tweet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.text }),
      });
      const data = await res.json();
      drafts = drafts.filter(d => d.id !== id);
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#2DD4A0">Tweet Posted!</h2><p style="color:#868E96;max-width:400px;margin:20px auto">${draft.text.replace(/</g,'&lt;').replace(/\n/g,'<br>')}</p></body></html>` };
    } catch (e) {
      return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: `<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#FF6B6B">Failed to post</h2><p style="color:#868E96">${e.message}</p></body></html>` };
    }
  }

  // Reject a draft
  if (params.action === 'reject') {
    const id = parseInt(params.id);
    drafts = drafts.filter(d => d.id !== id);
    return { statusCode: 200, headers: { 'Content-Type': 'text/html' }, body: '<html><body style="background:#111;color:#fff;font-family:sans-serif;text-align:center;padding:60px"><h2 style="color:#D4A853">Tweet Rejected</h2><p style="color:#868E96">Draft has been discarded.</p></body></html>' };
  }

  // Clear all drafts
  if (params.action === 'clear') {
    drafts = [];
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, cleared: true }) };
  }

  // POST — add a new draft
  if (event.httpMethod === 'POST') {
    try {
      const { text, source } = JSON.parse(event.body);
      if (!text) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing text' }) };

      const id = Date.now();
      const draft = { id, text, source: source || 'auto', created: new Date().toISOString() };
      drafts.push(draft);

      // Keep only last 20 drafts
      if (drafts.length > 20) drafts = drafts.slice(-20);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id, text }) };
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
