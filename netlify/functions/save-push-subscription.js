// Save browser push subscription to Supabase

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Not allowed' }) };

  try {
    var body = JSON.parse(event.body || '{}');
    var subscription = body.subscription;
    if (!subscription || !subscription.endpoint) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid subscription' }) };

    var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    var url = process.env.SUPABASE_URL || 'https://yumahmnoltvbiadjefxw.supabase.co';
    await ft(url + '/rest/v1/push_subscriptions', {
      method: 'POST',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({ endpoint: subscription.endpoint, subscription: JSON.stringify(subscription), created_at: new Date().toISOString() })
    });

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch(e) {
    console.log('save-push-subscription error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
