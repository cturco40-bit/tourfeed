// TourFeed Image Generator — Editorial style
// Real golf photos from Unsplash with branded text overlay
// Looks like ESPN, Bleacher Report, Action Network link cards

const { createCanvas, GlobalFonts, loadImage } = require('@napi-rs/canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');

const fontB64 = require('./font-data');
const fontPath = path.join(os.tmpdir(), 'DMSans.ttf');
if (!fs.existsSync(fontPath)) {
  fs.writeFileSync(fontPath, Buffer.from(fontB64, 'base64'));
}
GlobalFonts.registerFromPath(fontPath, 'DM Sans');

const GREEN = '#2D8F6F';
const GOLD = '#D4A853';
const WHITE = '#FFFFFF';
const RED = '#FF6B6B';

function font(weight, size) { return `${weight} ${size}px "DM Sans"`; }

// Curated golf photos — high quality, editorial feel
const PHOTOS = {
  masters: 'https://images.unsplash.com/photo-1535131749006-b7f58c99034b?w=1200&q=85',
  course: 'https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?w=1200&q=85',
  golfer: 'https://images.unsplash.com/photo-1593111774240-d529f12cf4bb?w=1200&q=85',
  sunset: 'https://images.unsplash.com/photo-1592919505780-303950717480?w=1200&q=85',
  fairway: 'https://images.unsplash.com/photo-1611374243147-44a702c2d44c?w=1200&q=85',
  clubhouse: 'https://images.unsplash.com/photo-1600011689032-8b628b8a8747?w=1200&q=85',
  green: 'https://images.unsplash.com/photo-1580128637001-5e6632bea4ba?w=1200&q=85',
  tee: 'https://images.unsplash.com/photo-1622396481328-9b1b78cdd9fd?w=1200&q=85',
};

function pickPhoto(tag, headline) {
  const t = ((tag || '') + ' ' + (headline || '')).toLowerCase();
  if (/masters|augusta/i.test(t)) return PHOTOS.masters;
  if (/betting|odds|pick|value|longshot/i.test(t)) return PHOTOS.sunset;
  if (/preview|course|setup/i.test(t)) return PHOTOS.fairway;
  if (/breaking|injury|withdraw/i.test(t)) return PHOTOS.clubhouse;
  if (/recap|winner|victory|dominat/i.test(t)) return PHOTOS.green;
  // Rotate through remaining
  const all = Object.values(PHOTOS);
  const hash = (t.length * 7 + t.charCodeAt(0)) % all.length;
  return all[hash];
}

async function fetchImg(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1000) return null;
    return await loadImage(buf);
  } catch (e) { return null; }
}

function drawLogo(ctx, x, y, size) {
  ctx.font = font(900, size);
  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.fillText('TOUR', x, y);
  const tw = ctx.measureText('TOUR').width;
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + tw + 3, y);
}

// Auto-size text to fit in available space
function drawFittedText(ctx, text, x, y, maxW, maxH, startSize, weight) {
  let sz = startSize;
  while (sz > 18) {
    ctx.font = font(weight, sz);
    const lh = Math.round(sz * 1.25);
    const lines = [];
    let line = '';
    for (const w of (text || '').split(' ')) {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length * lh <= maxH) {
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * lh));
      return y + lines.length * lh;
    }
    sz -= 2;
  }
  ctx.font = font(weight, 18);
  const lh = 22;
  let line = '';
  let cy = y;
  for (const w of (text || '').split(' ')) {
    const test = line + (line ? ' ' : '') + w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, cy); cy += lh; line = w; }
    else line = test;
  }
  if (line) { ctx.fillText(line, x, cy); cy += lh; }
  return cy;
}

function tagColor(tag) {
  const t = (tag || '').toUpperCase();
  if (t === 'RECAP' || t === 'TOURNAMENT') return GREEN;
  if (t === 'BETTING' || t === 'ANALYSIS') return GOLD;
  if (t === 'PREVIEW') return GREEN;
  if (t === 'BREAKING' || t === 'INJURY') return RED;
  if (t === 'HOT TAKE') return GREEN;
  return GREEN;
}

// ━━━━ MAIN IMAGE BUILDER ━━━━
// All templates use the same core: photo bg + gradient + text + branding
async function buildImage(w, h, opts) {
  const { tag, headline, quote, attribution, context, photo } = opts;
  const tc = tagColor(tag);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  // 1. Background photo — full bleed
  const photoUrl = photo || pickPhoto(tag, headline || quote);
  const bg = await fetchImg(photoUrl);
  if (bg) {
    const scale = Math.max(w / bg.width, h / bg.height);
    const sw = bg.width * scale;
    const sh = bg.height * scale;
    ctx.drawImage(bg, (w - sw) / 2, (h - sh) / 2, sw, sh);
  } else {
    // Solid fallback
    ctx.fillStyle = '#0F1923';
    ctx.fillRect(0, 0, w, h);
  }

  // 2. Dark gradient overlay — bottom-heavy for text readability
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(15,25,35,0.3)');
  grad.addColorStop(0.35, 'rgba(15,25,35,0.5)');
  grad.addColorStop(0.65, 'rgba(15,25,35,0.85)');
  grad.addColorStop(1, 'rgba(15,25,35,0.95)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 3. Accent bar at top
  ctx.fillStyle = tc;
  ctx.fillRect(0, 0, w, 4);

  // 4. Logo top-left
  drawLogo(ctx, 40, h < 800 ? 40 : 50, h < 800 ? 18 : 22);

  // 5. Tag pill
  if (tag) {
    const tagText = tag.toUpperCase();
    ctx.font = font(700, 11);
    const tw = ctx.measureText(tagText).width;
    const tagY = h < 800 ? 58 : 75;
    ctx.fillStyle = tc + '40';
    ctx.beginPath();
    ctx.roundRect(40, tagY, tw + 20, 24, 5);
    ctx.fill();
    ctx.fillStyle = tc;
    ctx.fillText(tagText, 50, tagY + 16);
  }

  // 6. Main text — positioned in bottom half over the dark gradient
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  const textX = 40;
  const textW = w - 80;
  const isQuote = !!quote;

  if (isQuote) {
    // Quote style — big quote mark + text + attribution
    const textY = h * 0.35;
    const maxTextH = h * 0.45;
    ctx.font = font(900, 60);
    ctx.fillStyle = tc + '50';
    ctx.fillText('\u201C', 30, textY);
    ctx.fillStyle = WHITE;
    const endY = drawFittedText(ctx, quote, textX, textY + 20, textW, maxTextH, 36, 700);
    if (attribution) {
      ctx.font = font(700, 16);
      ctx.fillStyle = GOLD;
      ctx.fillText('\u2014 ' + attribution, textX, endY + 16);
    }
    if (context) {
      ctx.font = font(500, 13);
      ctx.fillStyle = '#868E96';
      ctx.fillText(context, textX, endY + (attribution ? 40 : 16));
    }
  } else {
    // Headline style — bold text in bottom half
    const textY = h < 800 ? h * 0.38 : h * 0.4;
    const maxTextH = h < 800 ? h * 0.42 : h * 0.4;
    ctx.fillStyle = WHITE;
    drawFittedText(ctx, headline, textX, textY, textW, maxTextH, h < 800 ? 34 : 44, 800);
  }

  // 7. Footer — logo + url
  drawLogo(ctx, 40, h - 22, 14);
  ctx.font = font(600, 10);
  ctx.fillStyle = '#868E96';
  ctx.textAlign = 'right';
  ctx.fillText('tourfeed.co', w - 40, h - 22);
  ctx.textAlign = 'left';

  return c.toBuffer('image/png');
}

// ━━━━ HANDLER ━━━━
exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const type = p.type || 'headline';

  let w = 1080, h = 1080;
  if (type === 'article_header') { w = 1200; h = 630; }

  const opts = {
    tag: p.tag || (type === 'hot_take' ? 'HOT TAKE' : 'NEWS'),
    headline: p.headline || '',
    quote: type === 'hot_take' ? (p.quote || p.headline || '') : null,
    attribution: p.attribution || '',
    context: p.context || '',
    photo: p.photo || '',
  };

  // For hot_take, use quote mode
  if (type === 'hot_take') {
    opts.headline = null;
  }

  const buf = await buildImage(w, h, opts);

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
