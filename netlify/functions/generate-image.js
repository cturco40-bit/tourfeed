// TourFeed Image Generator
// Player headshot cutouts on branded background — like Foreplay/TSN/BR
// ESPN headshots are transparent PNGs perfect for compositing

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
const NAVY_D = '#0F1923';
const GREEN = '#2D8F6F';
const GOLD = '#D4A853';
const WHITE = '#FFFFFF';
const GRAY = '#868E96';
const RED = '#FF6B6B';

function font(w, s) { return `${w} ${s}px "DM Sans"`; }

// Verified ESPN headshot IDs — every one visually confirmed
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
  'sam burns':9938,
  'wyndham clark':11119,
  'tom kim':4602673,
  'sungjae':11382,'sungjae im':11382,
  'reed':6011,'patrick reed':6011,
};

// Find up to 2 player IDs mentioned in text
function findPlayers(text) {
  const lower = (text || '').toLowerCase();
  const found = [];
  const used = new Set();
  // Check longer names first to avoid partial matches
  const sorted = Object.entries(PLAYER_IDS).sort((a,b) => b[0].length - a[0].length);
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
  return `https://a.espncdn.com/i/headshots/golf/players/full/${id}.png`;
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

function tagColor(tag) {
  const t = (tag || '').toUpperCase();
  if (t === 'RECAP' || t === 'PREVIEW') return GREEN;
  if (t === 'BETTING' || t === 'ANALYSIS') return GOLD;
  if (t === 'BREAKING' || t === 'INJURY') return RED;
  return GREEN;
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

// Auto-shrink text to fit
function drawText(ctx, text, x, y, maxW, maxH, startSize, weight) {
  let sz = startSize;
  while (sz > 16) {
    ctx.font = font(weight, sz);
    const lh = Math.round(sz * 1.3);
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
  ctx.font = font(weight, 16);
  let line = '', cy = y;
  for (const w of (text || '').split(' ')) {
    const test = line + (line ? ' ' : '') + w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, cy); cy += 20; line = w; }
    else line = test;
  }
  if (line) { ctx.fillText(line, x, cy); cy += 20; }
  return cy;
}

// ━━━ BUILD IMAGE ━━━
async function buildImage(w, h, opts) {
  const { tag, headline, quote, attribution, photo } = opts;
  const tc = tagColor(tag);
  const c = createCanvas(w, h);
  const ctx = c.getContext('2d');

  // 1. Branded gradient background
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, NAVY);
  bg.addColorStop(0.6, NAVY_D);
  bg.addColorStop(1, '#0a1018');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // 2. Accent elements
  ctx.fillStyle = tc;
  ctx.fillRect(0, 0, w, 4); // top bar
  ctx.globalAlpha = 0.08;
  ctx.fillRect(0, h * 0.15, w, h * 0.5); // subtle color wash
  ctx.globalAlpha = 1;

  // 3. Player headshot(s) — find from text content
  const text = (headline || '') + ' ' + (quote || '');
  const playerIds = findPlayers(text);

  // Also accept direct photo URL param (for external photos)
  let hasPlayer = false;
  if (photo) {
    const img = await fetchImg(photo);
    if (img) {
      drawSinglePlayer(ctx, img, w, h);
      hasPlayer = true;
    }
  } else if (playerIds.length >= 2) {
    const [img1, img2] = await Promise.all([
      fetchImg(headshotUrl(playerIds[0])),
      fetchImg(headshotUrl(playerIds[1])),
    ]);
    if (img1 && img2) { drawDualPlayer(ctx, img1, img2, w, h); hasPlayer = true; }
    else if (img1) { drawSinglePlayer(ctx, img1, w, h); hasPlayer = true; }
    else if (img2) { drawSinglePlayer(ctx, img2, w, h); hasPlayer = true; }
  } else if (playerIds.length === 1) {
    const img = await fetchImg(headshotUrl(playerIds[0]));
    if (img) { drawSinglePlayer(ctx, img, w, h); hasPlayer = true; }
  }

  // 4. Logo + tag
  drawLogo(ctx, 40, h < 700 ? 38 : 52, h < 700 ? 18 : 22);
  if (tag) {
    const tagY = h < 700 ? 60 : 80;
    ctx.font = font(700, 11);
    const tw = ctx.measureText(tag.toUpperCase()).width;
    ctx.fillStyle = tc;
    ctx.globalAlpha = 0.3;
    ctx.beginPath();
    ctx.roundRect(40, tagY, tw + 20, 24, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = tc;
    ctx.textAlign = 'left';
    ctx.fillText(tag.toUpperCase(), 50, tagY + 16);
  }

  // 5. Text — always on left side, player always on right
  const textX = 40;
  const textW = hasPlayer ? Math.min(w * 0.55, w - 80) : w - 80;
  const isQuote = !!quote;

  if (isQuote) {
    // Quote mark
    ctx.font = font(900, 70);
    ctx.fillStyle = tc;
    ctx.globalAlpha = 0.4;
    ctx.textAlign = 'left';
    ctx.fillText('\u201C', 30, h < 700 ? h * 0.3 : h * 0.25);
    ctx.globalAlpha = 1;

    // Quote text
    ctx.fillStyle = WHITE;
    const startY = h < 700 ? h * 0.3 + 10 : h * 0.27;
    const maxH = h < 700 ? h * 0.5 : h * 0.5;
    const endY = drawText(ctx, quote, textX, startY, textW, maxH, h < 700 ? 30 : 38, 700);

    if (attribution) {
      ctx.font = font(700, 15);
      ctx.fillStyle = GOLD;
      ctx.fillText('\u2014 ' + attribution, textX, endY + 14);
    }
  } else {
    // Headline
    ctx.fillStyle = WHITE;
    ctx.textAlign = 'left';
    const startY = h < 700 ? h * 0.3 : h * 0.28;
    const maxH = h < 700 ? h * 0.48 : h * 0.5;
    drawText(ctx, headline, textX, startY, textW, maxH, h < 700 ? 32 : 44, 800);
  }

  // 6. Footer
  drawLogo(ctx, 40, h - 22, 13);
  ctx.font = font(600, 10);
  ctx.fillStyle = GRAY;
  ctx.textAlign = 'right';
  ctx.fillText('tourfeed.co', w - 40, h - 22);
  ctx.textAlign = 'left';

  return c.toBuffer('image/png');
}

// Single player — right side, large, with gradient fade into background
function drawSinglePlayer(ctx, img, w, h) {
  const scale = (h * 0.85) / img.height;
  const iw = img.width * scale;
  const ih = img.height * scale;
  // Position: right-aligned, bottom-aligned
  const x = w - iw * 0.85;
  const y = h - ih;

  ctx.globalAlpha = 0.9;
  ctx.drawImage(img, x, y, iw, ih);
  ctx.globalAlpha = 1;

  // Fade left edge into background — protects text zone
  const fade = ctx.createLinearGradient(x - 20, 0, x + iw * 0.35, 0);
  fade.addColorStop(0, NAVY_D);
  fade.addColorStop(0.6, NAVY_D + 'CC');
  fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(x - 20, 0, iw * 0.5, h);

  // Bottom + top fade
  const bf = ctx.createLinearGradient(0, h - 80, 0, h);
  bf.addColorStop(0, 'transparent');
  bf.addColorStop(1, NAVY_D);
  ctx.fillStyle = bf;
  ctx.fillRect(x, h - 80, iw, 80);

  const tf = ctx.createLinearGradient(0, 0, 0, 70);
  tf.addColorStop(0, NAVY_D);
  tf.addColorStop(1, 'transparent');
  ctx.fillStyle = tf;
  ctx.fillRect(x, 0, iw, 70);
}

// Two players — left and right edges
function drawDualPlayer(ctx, img1, img2, w, h) {
  // Player 1 — left edge
  const s1 = (h * 0.65) / img1.height;
  ctx.globalAlpha = 0.7;
  ctx.drawImage(img1, -img1.width * s1 * 0.3, h - img1.height * s1, img1.width * s1, img1.height * s1);
  ctx.globalAlpha = 1;

  // Player 2 — right edge
  const s2 = (h * 0.65) / img2.height;
  const x2 = w - img2.width * s2 * 0.7;
  ctx.globalAlpha = 0.7;
  ctx.drawImage(img2, x2, h - img2.height * s2, img2.width * s2, img2.height * s2);
  ctx.globalAlpha = 1;

  // Center overlay for text
  const cg = ctx.createLinearGradient(w * 0.15, 0, w * 0.85, 0);
  cg.addColorStop(0, 'transparent');
  cg.addColorStop(0.25, NAVY_D + 'EE');
  cg.addColorStop(0.5, NAVY_D + 'F8');
  cg.addColorStop(0.75, NAVY_D + 'EE');
  cg.addColorStop(1, 'transparent');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, w, h);

  // Bottom fade
  const bf = ctx.createLinearGradient(0, h - 100, 0, h);
  bf.addColorStop(0, 'transparent');
  bf.addColorStop(1, NAVY_D);
  ctx.fillStyle = bf;
  ctx.fillRect(0, h - 100, w, 100);
}

exports.handler = async (event) => {
  const p = event.queryStringParameters || {};
  const type = p.type || 'headline';

  let w = 1080, h = 1080;
  if (type === 'article_header') { w = 1200; h = 630; }

  const opts = {
    tag: p.tag || (type === 'hot_take' ? 'HOT TAKE' : 'NEWS'),
    headline: type === 'hot_take' ? null : (p.headline || ''),
    quote: type === 'hot_take' ? (p.quote || p.headline || '') : null,
    attribution: p.attribution || '',
    photo: p.photo || '',
  };

  const buf = await buildImage(w, h, opts);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
    body: buf.toString('base64'),
    isBase64Encoded: true,
  };
};
