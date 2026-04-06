// Generate branded TourFeed images as PNG using canvas
// Player headshots from ESPN, composited with branded overlays

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
const DIM = '#CED4DA';
const RED = '#FF6B6B';

function font(weight, size) { return `${weight} ${size}px "DM Sans"`; }

async function fetchImage(url) {
  if (!url) return null;
  try {
    const res = await fetch(url);
    if (!res.ok || res.headers.get('content-type')?.includes('text')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 500) return null;
    return await loadImage(buf);
  } catch(e) { return null; }
}

function drawGradientBg(ctx, w, h) {
  const grad = ctx.createLinearGradient(0, 0, w * 0.5, h);
  grad.addColorStop(0, NAVY);
  grad.addColorStop(1, NAVY_D);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawLogo(ctx, x, y, size) {
  ctx.font = font(900, size);
  ctx.textAlign = 'left';
  ctx.fillStyle = WHITE;
  ctx.fillText('TOUR', x, y);
  const tw = ctx.measureText('TOUR').width;
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + tw + 4, y);
}

function drawTag(ctx, tag, x, y, color) {
  ctx.font = font(700, 13);
  ctx.textAlign = 'left';
  const tw = ctx.measureText(tag).width;
  ctx.fillStyle = color + '30';
  ctx.beginPath();
  ctx.roundRect(x, y - 18, tw + 24, 28, 6);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.fillText(tag, x + 12, y);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = (text || '').split(' ');
  let line = '';
  let linesDrawn = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      linesDrawn++;
      if (linesDrawn >= (maxLines || 8)) return y;
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineHeight; linesDrawn++; }
  return y;
}

function drawAccent(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, 5);
  ctx.globalAlpha = 0.5;
  ctx.fillRect(0, 0, 5, h);
  ctx.globalAlpha = 1;
}

function drawFooter(ctx, w, h, color) {
  ctx.fillStyle = color + '50';
  ctx.fillRect(50, h - 60, 120, 2);
  drawLogo(ctx, 50, h - 28, 16);
  ctx.font = font(600, 11);
  ctx.fillStyle = GRAY;
  ctx.textAlign = 'right';
  ctx.fillText('tourfeed.co', w - 50, h - 28);
  ctx.textAlign = 'left';
}

// Draw single player headshot on right side
function drawPlayer(ctx, img, w, h) {
  if (!img) return;
  const scale = (h * 0.9) / img.height;
  const imgW = img.width * scale;
  const imgH = img.height * scale;
  const x = w - imgW + 80;
  const y = h - imgH;

  ctx.globalAlpha = 0.8;
  ctx.drawImage(img, x, y, imgW, imgH);
  ctx.globalAlpha = 1;

  // Left fade
  const fade = ctx.createLinearGradient(x - 30, 0, x + imgW * 0.45, 0);
  fade.addColorStop(0, NAVY_D);
  fade.addColorStop(0.5, NAVY_D + 'DD');
  fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(x - 30, 0, imgW + 60, h);

  // Bottom fade
  const bf = ctx.createLinearGradient(0, h - 120, 0, h);
  bf.addColorStop(0, 'transparent');
  bf.addColorStop(1, NAVY_D);
  ctx.fillStyle = bf;
  ctx.fillRect(0, h - 120, w, 120);

  // Top fade
  const tf = ctx.createLinearGradient(0, 0, 0, 100);
  tf.addColorStop(0, NAVY_D);
  tf.addColorStop(1, 'transparent');
  ctx.fillStyle = tf;
  ctx.fillRect(x - 30, 0, imgW + 60, 100);
}

// Draw two player headshots — debate/comparison style
function drawTwoPlayers(ctx, img1, img2, w, h) {
  // Player 1 on left
  if (img1) {
    const scale = (h * 0.75) / img1.height;
    const iw = img1.width * scale;
    const ih = img1.height * scale;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img1, -40, h - ih, iw, ih);
    ctx.globalAlpha = 1;
  }
  // Player 2 on right
  if (img2) {
    const scale = (h * 0.75) / img2.height;
    const iw = img2.width * scale;
    const ih = img2.height * scale;
    ctx.globalAlpha = 0.6;
    ctx.drawImage(img2, w - iw + 40, h - ih, iw, ih);
    ctx.globalAlpha = 1;
  }
  // Center dark overlay for text readability
  const cg = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
  cg.addColorStop(0, 'transparent');
  cg.addColorStop(0.3, NAVY_D + 'EE');
  cg.addColorStop(0.7, NAVY_D + 'EE');
  cg.addColorStop(1, 'transparent');
  ctx.fillStyle = cg;
  ctx.fillRect(0, 0, w, h);
  // Bottom + top fades
  const bf = ctx.createLinearGradient(0, h - 150, 0, h);
  bf.addColorStop(0, 'transparent');
  bf.addColorStop(1, NAVY_D);
  ctx.fillStyle = bf;
  ctx.fillRect(0, h - 150, w, 150);
  const tf = ctx.createLinearGradient(0, 0, 0, 120);
  tf.addColorStop(0, NAVY_D);
  tf.addColorStop(1, 'transparent');
  ctx.fillStyle = tf;
  ctx.fillRect(0, 0, w, 120);
}

// ────── HEADLINE (1080x1080) ──────
async function generateHeadline(params) {
  const tag = params.tag || 'BREAKING';
  const headline = params.headline || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : RED;

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  // Photos — ESPN headshots or Unsplash backgrounds
  const photos = (params.photo || '').split(',').filter(Boolean);
  const isUnsplash = photos[0]?.includes('unsplash');
  let hasPhoto = false;

  if (isUnsplash && photos[0]) {
    // Full background photo with dark overlay
    const bg = await fetchImage(photos[0]);
    if (bg) {
      const scale = Math.max(1080 / bg.width, 1080 / bg.height);
      ctx.globalAlpha = 0.35;
      ctx.drawImage(bg, (1080 - bg.width * scale) / 2, (1080 - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = NAVY_D + 'AA';
      ctx.fillRect(0, 0, 1080, 1080);
      hasPhoto = true;
    }
  } else if (photos.length >= 2) {
    const [img1, img2] = await Promise.all([fetchImage(photos[0]), fetchImage(photos[1])]);
    if (img1 || img2) { drawTwoPlayers(ctx, img1, img2, 1080, 1080); hasPhoto = true; }
  } else if (photos.length === 1) {
    const img = await fetchImage(photos[0]);
    if (img) { drawPlayer(ctx, img, 1080, 1080); hasPhoto = true; }
  }

  drawAccent(ctx, 1080, 1080, tagColor);
  drawLogo(ctx, 50, 60, 24);
  drawTag(ctx, tag, 50, 110, tagColor);

  ctx.font = font(800, hasPhoto ? 44 : 48);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  wrapText(ctx, headline, 50, 240, hasPhoto && !isUnsplash ? 750 : 980, 56, 10);
  drawFooter(ctx, 1080, 1080, tagColor);
  return c.toBuffer('image/png');
}

// ────── ARTICLE HEADER (1200x630) ──────
async function generateArticleHeader(params) {
  const tag = params.tag || 'NEWS';
  const headline = params.headline || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : tag === 'BREAKING' ? RED : GREEN;

  const c = createCanvas(1200, 630);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1200, 630);

  const photos = (params.photo || '').split(',').filter(Boolean);
  const isUnsplash = photos[0]?.includes('unsplash');
  let hasPhoto = false;

  if (isUnsplash && photos[0]) {
    const bg = await fetchImage(photos[0]);
    if (bg) {
      const scale = Math.max(1200 / bg.width, 630 / bg.height);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(bg, (1200 - bg.width * scale) / 2, (630 - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = NAVY_D + 'BB';
      ctx.fillRect(0, 0, 1200, 630);
      hasPhoto = true;
    }
  } else if (photos.length >= 2) {
    const [img1, img2] = await Promise.all([fetchImage(photos[0]), fetchImage(photos[1])]);
    if (img1 || img2) { drawTwoPlayers(ctx, img1, img2, 1200, 630); hasPhoto = true; }
  } else if (photos.length === 1) {
    const img = await fetchImage(photos[0]);
    if (img) { drawPlayer(ctx, img, 1200, 630); hasPhoto = true; }
  }

  drawAccent(ctx, 1200, 630, tagColor);
  drawLogo(ctx, 50, 50, 20);
  drawTag(ctx, tag, 50, 90, tagColor);

  ctx.font = font(800, hasPhoto ? 34 : 38);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  wrapText(ctx, headline, 50, 170, hasPhoto && !isUnsplash ? 850 : 1100, 44, 10);
  drawFooter(ctx, 1200, 630, tagColor);
  return c.toBuffer('image/png');
}

// ────── HOT TAKE / QUOTE (1080x1080) ──────
async function generateHotTake(params) {
  const quote = params.quote || '';
  const context = params.context || '';
  const attribution = params.attribution || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  const photos = (params.photo || '').split(',').filter(Boolean);
  const isUnsplash = photos[0]?.includes('unsplash');
  let hasPhoto = false;

  if (isUnsplash && photos[0]) {
    const bg = await fetchImage(photos[0]);
    if (bg) {
      const scale = Math.max(1080 / bg.width, 1080 / bg.height);
      ctx.globalAlpha = 0.3;
      ctx.drawImage(bg, (1080 - bg.width * scale) / 2, (1080 - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
      ctx.globalAlpha = 1;
      ctx.fillStyle = NAVY_D + 'AA';
      ctx.fillRect(0, 0, 1080, 1080);
      hasPhoto = true;
    }
  } else if (photos.length >= 2) {
    const [img1, img2] = await Promise.all([fetchImage(photos[0]), fetchImage(photos[1])]);
    if (img1 || img2) { drawTwoPlayers(ctx, img1, img2, 1080, 1080); hasPhoto = true; }
  } else if (photos.length === 1) {
    const img = await fetchImage(photos[0]);
    if (img) { drawPlayer(ctx, img, 1080, 1080); hasPhoto = true; }
  }

  drawAccent(ctx, 1080, 1080, GREEN);
  drawLogo(ctx, 50, 60, 24);
  drawTag(ctx, 'HOT TAKE', 50, 110, GREEN);

  // Big quote mark
  ctx.font = font(900, 100);
  ctx.fillStyle = GREEN + '30';
  ctx.textAlign = 'left';
  ctx.fillText('\u201C', 40, 260);

  // Quote text
  ctx.font = font(700, hasPhoto ? 36 : 40);
  ctx.fillStyle = WHITE;
  const endY = wrapText(ctx, quote, 55, 310, hasPhoto && !isUnsplash ? 720 : 960, 48, 8);

  // Attribution
  if (attribution) {
    ctx.font = font(700, 18);
    ctx.fillStyle = GOLD;
    ctx.fillText('— ' + attribution, 55, endY + 20);
  }

  // Context / topic
  if (context) {
    ctx.font = font(600, 14);
    ctx.fillStyle = GRAY;
    ctx.fillText(context, 55, endY + (attribution ? 50 : 20));
  }

  drawFooter(ctx, 1080, 1080, GREEN);
  return c.toBuffer('image/png');
}

// ────── PICK (1080x1080) ──────
async function generatePick(params) {
  const label = params.label || 'BEST BET';
  const name = params.name || '';
  const odds = params.odds || '';
  const reason = params.reason || '';
  const labelColor = label === 'LONGSHOT' ? GOLD : label === 'FADE' ? RED : label === 'VALUE PLAY' ? '#4A90D9' : GREEN;

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  const img = await fetchImage(params.photo || '');
  if (img) drawPlayer(ctx, img, 1080, 1080);

  drawAccent(ctx, 1080, 1080, labelColor);
  drawLogo(ctx, 50, 60, 24);
  drawTag(ctx, label, 50, 110, labelColor);

  ctx.font = font(900, 52);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  ctx.fillText(name, 50, 350);

  ctx.font = font(800, 44);
  ctx.fillStyle = labelColor;
  ctx.fillText(odds, 50, 420);

  if (reason) {
    ctx.font = font(500, 18);
    ctx.fillStyle = DIM;
    wrapText(ctx, reason, 50, 480, img ? 560 : 980, 26, 5);
  }

  drawFooter(ctx, 1080, 1080, labelColor);
  return c.toBuffer('image/png');
}

// ────── WINNER (1080x1080) ──────
async function generateWinner(params) {
  const name = params.name || '';
  const tournament = params.tournament || '';
  const score = params.score || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  const img = await fetchImage(params.photo || '');
  if (img) drawPlayer(ctx, img, 1080, 1080);

  // Gold glow
  const glow = ctx.createLinearGradient(0, 200, 0, 600);
  glow.addColorStop(0, GOLD + '18');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 200, 1080, 400);

  drawAccent(ctx, 1080, 1080, GOLD);
  drawLogo(ctx, 50, 60, 24);

  ctx.font = font(700, 18);
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'left';
  ctx.fillText('W I N N E R', 50, 300);

  ctx.font = font(900, 52);
  ctx.fillStyle = WHITE;
  ctx.fillText(name, 50, 380);

  ctx.font = font(900, 64);
  ctx.fillStyle = GREEN;
  ctx.fillText(score, 50, 470);

  ctx.font = font(600, 20);
  ctx.fillStyle = DIM;
  ctx.fillText(tournament, 50, 520);

  drawFooter(ctx, 1080, 1080, GOLD);
  return c.toBuffer('image/png');
}

// ────── STAT CARD (1080x1080) ──────
async function generateStat(params) {
  const number = params.number || '';
  const label = params.label || '';
  const player = params.player || '';
  const context = params.context || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  const img = await fetchImage(params.photo || '');
  if (img) drawPlayer(ctx, img, 1080, 1080);

  drawAccent(ctx, 1080, 1080, GREEN);
  drawLogo(ctx, 50, 60, 24);

  ctx.font = font(900, 100);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'left';
  ctx.fillText(number, 50, 380);

  ctx.font = font(600, 20);
  ctx.fillStyle = DIM;
  ctx.fillText(label, 50, 420);

  ctx.font = font(800, 26);
  ctx.fillStyle = WHITE;
  ctx.fillText(player, 50, 490);

  if (context) {
    ctx.font = font(600, 15);
    ctx.fillStyle = GRAY;
    ctx.fillText(context, 50, 525);
  }

  drawFooter(ctx, 1080, 1080, GREEN);
  return c.toBuffer('image/png');
}

// ────── LEADERBOARD (1080x1080) ──────
async function generateLeaderboard(params) {
  const title = params.title || 'LEADERBOARD';
  const subtitle = params.subtitle || '';
  const players = (params.players || '').split(',').filter(Boolean).map(p => {
    const [name, score, today, pos] = p.split('|');
    return { name: name || '', score: score || '', today: today || '', pos: pos || '' };
  }).slice(0, 8);

  const h = Math.max(1080, 200 + players.length * 52);
  const c = createCanvas(1080, h);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, h);
  drawAccent(ctx, 1080, h, GREEN);
  drawLogo(ctx, 50, 55, 24);

  ctx.font = font(700, 14);
  ctx.fillStyle = GREEN;
  ctx.textAlign = 'left';
  ctx.fillText(title, 50, 100);

  if (subtitle) {
    ctx.font = font(800, 22);
    ctx.fillStyle = WHITE;
    ctx.fillText(subtitle, 50, 130);
  }

  players.forEach((p, i) => {
    const y = 175 + i * 52;
    if (i === 0) {
      ctx.fillStyle = GREEN + '15';
      ctx.beginPath();
      ctx.roundRect(30, y - 18, 1020, 46, 8);
      ctx.fill();
    }
    ctx.textAlign = 'left';
    ctx.font = font(700, 16);
    ctx.fillStyle = i === 0 ? GOLD : GRAY;
    ctx.fillText(p.pos || String(i + 1), 50, y + 10);
    ctx.font = font(i === 0 ? 800 : 600, 18);
    ctx.fillStyle = WHITE;
    ctx.fillText(p.name, 100, y + 10);
    const sc = !p.score ? GRAY : p.score.startsWith('+') ? RED : p.score === 'E' ? GRAY : '#2DD4A0';
    ctx.font = font(800, 20);
    ctx.fillStyle = sc;
    ctx.textAlign = 'right';
    ctx.fillText(p.score, 1030, y + 10);
    ctx.textAlign = 'left';
    if (i < players.length - 1) {
      ctx.fillStyle = WHITE + '08';
      ctx.fillRect(40, y + 30, 1000, 1);
    }
  });

  drawFooter(ctx, 1080, h, GREEN);
  return c.toBuffer('image/png');
}

exports.handler = async (event) => {
  const params = event.queryStringParameters || {};
  const type = params.type || 'headline';

  let pngBuffer;
  switch (type) {
    case 'leaderboard': pngBuffer = await generateLeaderboard(params); break;
    case 'headline': pngBuffer = await generateHeadline(params); break;
    case 'article_header': pngBuffer = await generateArticleHeader(params); break;
    case 'pick': pngBuffer = await generatePick(params); break;
    case 'winner': pngBuffer = await generateWinner(params); break;
    case 'stat': pngBuffer = await generateStat(params); break;
    case 'hot_take': pngBuffer = await generateHotTake(params); break;
    default: pngBuffer = await generateHeadline(params);
  }

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
    },
    body: pngBuffer.toString('base64'),
    isBase64Encoded: true,
  };
};
