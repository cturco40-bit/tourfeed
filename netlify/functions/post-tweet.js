const crypto = require('crypto');

// OAuth 1.0a signature generation
function oauthSign(method, url, params, consumerSecret, tokenSecret) {
  const sortedParams = Object.keys(params).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(params[k])}`).join('&');
  const baseString = `${method.toUpperCase()}&${encodeURIComponent(url)}&${encodeURIComponent(sortedParams)}`;
  const signingKey = `${encodeURIComponent(consumerSecret)}&${encodeURIComponent(tokenSecret)}`;
  return crypto.createHmac('sha1', signingKey).update(baseString).digest('base64');
}

function buildAuthHeader(params) {
  const header = Object.keys(params)
    .filter(k => k.startsWith('oauth_'))
    .sort()
    .map(k => `${encodeURIComponent(k)}="${encodeURIComponent(params[k])}"`)
    .join(', ');
  return `OAuth ${header}`;
}

function getOAuthParams() {
  return {
    oauth_consumer_key: process.env.TWITTER_API_KEY,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: process.env.TWITTER_ACCESS_TOKEN,
    oauth_version: '1.0',
  };
}

// Upload image to Twitter via v1.1 media upload
async function uploadMedia(imageUrl) {
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  // Download the image
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) throw new Error(`Image fetch failed: ${imgRes.status}`);
  const buffer = Buffer.from(await imgRes.arrayBuffer());
  const base64 = buffer.toString('base64');

  // Determine media type
  const contentType = imgRes.headers.get('content-type') || 'image/png';
  const mediaType = contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' :
                    contentType.includes('gif') ? 'image/gif' : 'image/png';

  // Upload via v1.1 media/upload (simple upload for images < 5MB)
  const url = 'https://upload.twitter.com/1.1/media/upload.json';

  // For media upload, create boundary for multipart
  const boundary = '----TourFeed' + crypto.randomBytes(8).toString('hex');
  let multipartBody = '';
  multipartBody += `--${boundary}\r\n`;
  multipartBody += `Content-Disposition: form-data; name="media_data"\r\n\r\n`;
  multipartBody += `${base64}\r\n`;
  multipartBody += `--${boundary}--\r\n`;

  const oauthParams = getOAuthParams();
  oauthParams.oauth_signature = oauthSign('POST', url, oauthParams, apiSecret, accessSecret);

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': buildAuthHeader(oauthParams),
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Media upload failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.media_id_string;
}

// Post tweet with optional media
async function tweet(text, mediaIds) {
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  const url = 'https://api.twitter.com/2/tweets';
  const oauthParams = getOAuthParams();
  oauthParams.oauth_signature = oauthSign('POST', url, oauthParams, apiSecret, accessSecret);

  const body = { text: text.length > 280 ? text.slice(0, text.lastIndexOf(' ', 280)) : text };
  if (mediaIds && mediaIds.length > 0) {
    body.media = { media_ids: mediaIds };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': buildAuthHeader(oauthParams),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Twitter API ${res.status}: ${errText}`);
  }

  return await res.json();
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = process.env.TWITTER_API_KEY;
  const apiSecret = process.env.TWITTER_API_SECRET;
  const accessToken = process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = process.env.TWITTER_ACCESS_SECRET;

  if (!apiKey || !apiSecret || !accessToken || !accessSecret) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Twitter OAuth credentials not configured' }) };
  }

  try {
    const parsed = JSON.parse(event.body);
    const text = parsed.text;
    const image = parsed.image || parsed.image_url;
    if (!text) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing tweet text' }) };
    }

    // Upload image if provided
    let mediaIds = [];
    if (image) {
      try {
        const mediaId = await uploadMedia(image);
        mediaIds.push(mediaId);
      } catch (imgErr) {
        console.warn('Image upload failed, posting without image:', imgErr.message);
      }
    }

    const result = await tweet(text, mediaIds);

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        tweet_id: result.data?.id,
        text: text.slice(0, 280),
        has_image: mediaIds.length > 0,
      }),
    };

  } catch (err) {
    console.error('Tweet error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: err.message }),
    };
  }
};

// Export for other functions to use
exports.uploadMedia = uploadMedia;
exports.tweet = tweet;
