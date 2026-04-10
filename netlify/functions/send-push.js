// Send push notification to all subscribed browsers

var webpush = require('web-push');

function ft(url, opts, ms) {
  var c = new AbortController();
  var t = setTimeout(function() { c.abort(); }, ms || 8000);
  return fetch(url, Object.assign({}, opts, { signal: c.signal })).finally(function() { clearTimeout(t); });
}

exports.handler = async (event) => {
  var headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  try {
    var body = JSON.parse(event.body || '{}');
    var title = body.title || 'TourFeed — New Draft';
    var message = body.body || 'New content ready for approval.';

    var publicKey = process.env.VAPID_PUBLIC_KEY;
    var privateKey = process.env.VAPID_PRIVATE_KEY;
    if (!publicKey || !privateKey) return { statusCode: 200, headers, body: JSON.stringify({ skipped: 'VAPID keys not configured' }) };

    webpush.setVapidDetails('mailto:drafts@tourfeed.co', publicKey, privateKey);

    var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    var url = process.env.SUPABASE_URL || 'https://yumahmnoltvbiadjefxw.supabase.co';
    var res = await ft(url + '/rest/v1/push_subscriptions?select=subscription', { headers: { 'apikey': key, 'Authorization': 'Bearer ' + key } });
    var subs = await res.json();
    if (!Array.isArray(subs) || subs.length === 0) return { statusCode: 200, headers, body: JSON.stringify({ sent: 0 }) };

    var results = await Promise.allSettled(
      subs.map(function(s) {
        try {
          var sub = typeof s.subscription === 'string' ? JSON.parse(s.subscription) : s.subscription;
          return webpush.sendNotification(sub, JSON.stringify({ title: title, body: message }));
        } catch(e) { return Promise.reject(e); }
      })
    );

    var sent = results.filter(function(r) { return r.status === 'fulfilled'; }).length;
    console.log('Push sent to', sent, '/', subs.length, 'subscribers');
    return { statusCode: 200, headers, body: JSON.stringify({ sent: sent, total: subs.length }) };
  } catch(e) {
    console.log('send-push error:', e.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
