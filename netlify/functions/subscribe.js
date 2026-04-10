// Newsletter subscription via Beehiiv API — server-side to protect API key

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  var PUB_ID = process.env.BEEHIIV_PUB_ID;
  var API_KEY = process.env.BEEHIIV_API_KEY;
  if (!PUB_ID || !API_KEY) return { statusCode: 500, headers, body: JSON.stringify({ error: 'Newsletter not configured' }) };

  try {
    var body = JSON.parse(event.body || '{}');
    var email = (body.email || '').trim().toLowerCase();

    if (!email || !email.includes('@') || !email.includes('.')) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid email' }) };
    }

    var res = await ft('https://api.beehiiv.com/v2/publications/' + PUB_ID + '/subscriptions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY },
      body: JSON.stringify({ email: email, reactivate_existing: true, send_welcome_email: true })
    }, 8000);

    if (res.ok) {
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } else {
      var err = await res.text();
      console.log('Beehiiv error:', res.status, err.slice(0, 200));
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Subscription failed' }) };
    }
  } catch(e) {
    console.log('subscribe error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Subscription failed' }) };
  }
};
