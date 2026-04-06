// TourFeed Image Generator — Foreplay/TSN style
// Real player photos with bold text overlays, branded

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

const NAVY = '#1B2538';
const NAVY_D = '#0a1018';
const GREEN = '#2D8F6F';
const GOLD = '#D4A853';
const WHITE = '#FFFFFF';
const GRAY = '#868E96';
const RED = '#E63946';

function font(w, s) { return `${w} ${s}px "DM Sans"`; }

// Verified ESPN headshot IDs
const PLAYER_IDS = {
  'tiger':462,'woods':462,'tiger woods':462,
  'rory':3448,'mcilroy':3448,'rory mcilroy':3448,
  'scheffler':9780,'scottie':9780,'scottie scheffler':9780,
  'schauffele':10140,'xander':10140,
  'rahm':9527,'jon rahm':9527,
  'koepka':10592,'brooks':10592,
  'dechambeau':10046,'bryson':10046,
  'spieth':5765,'jordan spieth':5765,
  'morikawa':11098,'collin morikawa':11098,
  'hovland':4364873,'viktor hovland':4364873,
  'fleetwood':5539,'tommy fleetwood':5539,
  'lowry':4587,'shane lowry':4587,
  'cantlay':10404,'patrick cantlay':10404,
  'matsuyama':4375627,'hideki':4375627,
  'fowler':3702,'rickie':3702,'rickie fowler':3702,
  'finau':9478,'tony finau':9478,
  'thomas':4848,'justin thomas':4848,
  'aberg':4375972,'ludvig':4375972,
  'macintyre':11378,'robert macintyre':11378,
  'spaun':10166,'j.j. spaun':10166,
  'theegala':10980,'sahith theegala':10980,
  'homa':8973,'max homa':8973,
  'cameron smith':9131,'cam smith':9131,
  'fitzpatrick':9037,'matt fitzpatrick':9037,
  'sam burns':9938, 'wyndham clark':11119,
  'tom kim':4602673, 'sungjae':11382,
  'reed':6011,'patrick reed':6011,
  'phil':1037,'mickelson':1037,'phil mickelson':1037,
  'jason day':3044, 'day':3044,
  'rose':1129,'justin rose':1129,
};

function findPlayers(text) {
  const lower = (text || '').toLowerCase();
  const found = [];
  const used = new Set();
  const sorted = Object.entries(PLAYER_IDS).sort((a, b) => b[0].length - a[0].length);
  for (const [name, id] of sorted) {
    if (lower.includes(name) && !used.has(id)) {
      found.push(id);
      used.add(id);
      if (found.length >= 2) break;
    }
  }
  return found;
}

function headshotUrl(id) {
  return 'https://a.espncdn.com/i/headshots/golf/players/full/' + id + '.png';
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

// Auto-fit text — returns array of {text, y} for each line
function measureFit(ctx, text, maxW, maxH, startSize, weight) {
  let sz = startSize;
  while (sz > 14) {
    ctx.font = font(weight, sz);
    const lh = Math.round(sz * 1.2);
    const lines = [];
    let line = '';
    for (const w of (text || '').split(' ')) {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
      else line = test;
    }
    if (line) lines.push(line);
    if (lines.length * lh <= maxH) return { lines, sz, lh };
    sz -= 2;
  }
  ctx.font = font(weight, 14);
  const lines = [];
  let line = '';
  for (const w of (text || '').split(' ')) {
    const test = line + (line ? ' ' : '') + w;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);
  return { lines, sz: 14, lh: 18 };
}

function drawLogo(ctx, x, y, size) {
  ctx.font = font(900, size);
  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.fillText('TOUR', x, y);
  const tw = ctx.measureText('TOUR').width;
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + tw + 2, y);
  return tw + ctx.measureText('FEED').width + 2;
}

// ━━━ BREAKING NEWS STYLE ━━━
// Player photo top half, red BREAKING banner, bold headline bottom
async function buildBreaking(w, h, headline, playerImg) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  // Background
  ctx.fillStyle = NAVY_D;
  ctx.fillRect(0, 0, w, h);

  // Player photo — top portion, large
  const photoH = h * 0.5;
  if (playerImg) {
    const scale = Math.max(w / playerImg.width, photoH / playerImg.height);
    const sw = playerImg.width * scale;
    const sh = playerImg.height * scale;
    ctx.drawImage(playerImg, (w - sw) / 2, (photoH - sh) / 2, sw, sh);
    // Bottom fade on photo
    const fade = ctx.createLinearGradient(0, photoH - 80, 0, photoH);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(1, NAVY_D);
    ctx.fillStyle = fade;
    ctx.fillRect(0, photoH - 80, w, 80);
  }

  // TOURFEED logo top-left
  drawLogo(ctx, 30, 38, 20);

  // Red BREAKING NEWS banner
  const bannerY = photoH - 20;
  ctx.fillStyle = RED;
  ctx.fillRect(w * 0.1, bannerY, w * 0.8, 40);
  ctx.font = font(900, 16);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.fillText('BREAKING NEWS', w / 2, bannerY + 27);
  ctx.textAlign = 'left';

  // Headline — big bold, bottom half
  const textY = bannerY + 60;
  const textW = w - 80;
  const maxTextH = h - textY - 60;
  const fit = measureFit(ctx, headline.toUpperCase(), textW, maxTextH, 42, 900);
  ctx.fillStyle = WHITE;
  ctx.font = font(900, fit.sz);
  fit.lines.forEach((line, i) => ctx.fillText(line, 40, textY + i * fit.lh));

  // Footer line
  ctx.fillStyle = GRAY + '40';
  ctx.fillRect(40, h - 50, w - 80, 1);
  drawLogo(ctx, 40, h - 22, 12);

  return c.toBuffer('image/png');
}

// ━━━ QUOTE STYLE ━━━
// Player photo top, quote marks + text bottom, attribution
async function buildQuote(w, h, quote, attribution, context, playerImg) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  ctx.fillStyle = NAVY_D;
  ctx.fillRect(0, 0, w, h);

  // Player photo — top 40%
  const photoH = h * 0.4;
  if (playerImg) {
    const scale = Math.max(w / playerImg.width, photoH / playerImg.height) * 1.2;
    const sw = playerImg.width * scale;
    const sh = playerImg.height * scale;
    ctx.drawImage(playerImg, (w - sw) / 2, (photoH - sh) / 2 - 20, sw, sh);
    // Heavy fade so text below is always readable
    const fade = ctx.createLinearGradient(0, photoH - 140, 0, photoH + 30);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(0.5, NAVY_D + 'AA');
    fade.addColorStop(1, NAVY_D);
    ctx.fillStyle = fade;
    ctx.fillRect(0, photoH - 140, w, 170);
  }

  drawLogo(ctx, 30, 38, 20);

  // Quote marks
  ctx.font = font(900, 80);
  ctx.fillStyle = GREEN;
  ctx.globalAlpha = 0.5;
  ctx.textAlign = 'left';
  ctx.fillText('\u201C\u201D', 30, photoH + 20);
  ctx.globalAlpha = 1;

  // Quote text — big bold
  const textY = photoH + 40;
  const textW = w - 80;
  const maxH = h - textY - 100;
  const fit = measureFit(ctx, quote.toUpperCase(), textW, maxH, 36, 900);
  ctx.fillStyle = WHITE;
  ctx.font = font(900, fit.sz);
  let endY = textY;
  fit.lines.forEach((line, i) => { ctx.fillText(line, 40, textY + i * fit.lh); endY = textY + (i + 1) * fit.lh; });

  // Attribution line
  if (attribution) {
    ctx.fillStyle = GRAY + '40';
    ctx.fillRect(40, endY + 10, w - 80, 1);
    ctx.font = font(700, 14);
    ctx.fillStyle = WHITE;
    ctx.fillText(attribution.toUpperCase(), 40, endY + 32);
    if (context) {
      ctx.font = font(500, 12);
      ctx.fillStyle = GRAY;
      ctx.fillText(context.toUpperCase(), 40, endY + 50);
    }
  }

  drawLogo(ctx, 40, h - 22, 12);
  return c.toBuffer('image/png');
}

// ━━━ HEADLINE / ARTICLE STYLE ━━━
// Player photo top 55%, headline bottom, tag pill
async function buildHeadline(w, h, tag, headline, playerImg) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');
  const tc = tag === 'BETTING' || tag === 'ANALYSIS' ? GOLD : tag === 'BREAKING' ? RED : GREEN;

  ctx.fillStyle = NAVY_D;
  ctx.fillRect(0, 0, w, h);

  // Player/editorial photo — top portion
  const photoH = h * (h < 700 ? 0.45 : 0.55);
  if (playerImg) {
    const scale = Math.max(w / playerImg.width, photoH / playerImg.height);
    const sw = playerImg.width * scale;
    const sh = playerImg.height * scale;
    ctx.drawImage(playerImg, (w - sw) / 2, (photoH - sh) / 2, sw, sh);
    const fade = ctx.createLinearGradient(0, photoH - 100, 0, photoH + 20);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(1, NAVY_D);
    ctx.fillStyle = fade;
    ctx.fillRect(0, photoH - 100, w, 120);
  }

  // Top accent
  ctx.fillStyle = tc;
  ctx.fillRect(0, 0, w, 3);
  drawLogo(ctx, 30, h < 700 ? 34 : 42, h < 700 ? 16 : 20);

  // Headline — bottom portion, ALL CAPS, bold
  const textY = photoH + 10;
  const textW = w - 80;
  const maxH = h - textY - 60;
  const fit = measureFit(ctx, headline.toUpperCase(), textW, maxH, h < 700 ? 30 : 40, 900);
  ctx.fillStyle = WHITE;
  ctx.font = font(900, fit.sz);
  fit.lines.forEach((line, i) => ctx.fillText(line, 40, textY + i * fit.lh));

  // Tag + footer
  const tagY = h - 50;
  ctx.fillStyle = GRAY + '40';
  ctx.fillRect(40, tagY, w - 80, 1);
  if (tag) {
    ctx.font = font(700, 11);
    ctx.fillStyle = tc;
    ctx.fillText(tag, 40, tagY + 20);
  }
  drawLogo(ctx, 40, h - 18, 11);
  ctx.font = font(600, 10);
  ctx.fillStyle = GRAY;
  ctx.textAlign = 'right';
  ctx.fillText('tourfeed.co', w - 40, h - 18);
  ctx.textAlign = 'left';

  return c.toBuffer('image/png');
}

// ━━━ WINNER / CHAMPION STYLE ━━━
// Big player photo, "CHAMPION" text, tournament name
async function buildWinner(w, h, name, tournament, score, playerImg) {
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  ctx.fillStyle = NAVY_D;
  ctx.fillRect(0, 0, w, h);

  // Player photo — fills most of the image
  const photoH = h * 0.6;
  if (playerImg) {
    const scale = Math.max(w / playerImg.width, photoH / playerImg.height);
    const sw = playerImg.width * scale;
    const sh = playerImg.height * scale;
    ctx.drawImage(playerImg, (w - sw) / 2, 0, sw, sh);
    const fade = ctx.createLinearGradient(0, photoH - 120, 0, photoH + 30);
    fade.addColorStop(0, 'transparent');
    fade.addColorStop(1, NAVY_D);
    ctx.fillStyle = fade;
    ctx.fillRect(0, photoH - 120, w, 150);
  }

  ctx.fillStyle = GOLD;
  ctx.fillRect(0, 0, w, 4);
  drawLogo(ctx, 30, 38, 20);

  // Player name script-style
  ctx.font = font(500, 28);
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'center';
  ctx.fillText(name, w / 2, photoH + 20);

  // CHAMPION huge
  ctx.font = font(900, 64);
  ctx.fillStyle = WHITE;
  ctx.fillText('CHAMPION', w / 2, photoH + 90);

  // Tournament
  ctx.font = font(700, 16);
  ctx.fillStyle = GRAY;
  ctx.fillText(tournament.toUpperCase(), w / 2, photoH + 120);

  if (score) {
    ctx.font = font(900, 24);
    ctx.fillStyle = GREEN;
    ctx.fillText(score, w / 2, photoH + 155);
  }

  ctx.textAlign = 'left';
  drawLogo(ctx, 40, h - 22, 12);
  return c.toBuffer('image/png');
}

// ━━━ HANDLER ━━━
exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const type = p.type || 'headline';
  const tag = (p.tag || '').toUpperCase();
  const headline = p.headline || '';
  const quote = p.quote || '';
  const attribution = p.attribution || '';
  const context = p.context || '';

  let w = 1080, h = 1080;
  if (type === 'article_header') { w = 1200; h = 630; }

  // Get player photo(s) — from text or explicit photo param
  const text = headline + ' ' + quote;
  const playerIds = findPlayers(text);
  let mainImg = null;

  if (p.photo) {
    mainImg = await fetchImg(p.photo);
  } else if (playerIds.length > 0) {
    mainImg = await fetchImg(headshotUrl(playerIds[0]));
  }

  let buf;
  if (type === 'hot_take') {
    buf = await buildQuote(w, h, quote || headline, attribution, context, mainImg);
  } else if (tag === 'BREAKING' || tag === 'INJURY') {
    buf = await buildBreaking(w, h, headline, mainImg);
  } else if (type === 'winner') {
    buf = await buildWinner(w, h, p.name || '', p.tournament || '', p.score || '', mainImg);
  } else {
    buf = await buildHeadline(w, h, tag, headline, mainImg);
  }

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
