// Generate branded TourFeed images as PNG using canvas
// All images are real PNGs with bundled DM Sans font — no SVG, no font issues

const { createCanvas, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Load font from embedded base64 data — avoids all file path issues on Netlify
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

function font(weight, size) {
  return `${weight} ${size}px "DM Sans"`;
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
  ctx.fillStyle = WHITE;
  ctx.fillText('TOUR', x, y);
  const tw = ctx.measureText('TOUR').width;
  ctx.fillStyle = GOLD;
  ctx.fillText('FEED', x + tw + 4, y);
}

function drawTag(ctx, tag, x, y, color) {
  ctx.font = font(700, 13);
  const tw = ctx.measureText(tag).width;
  // Tag background
  ctx.fillStyle = color + '30';
  roundRect(ctx, x, y - 18, tw + 24, 28, 6);
  ctx.fill();
  // Tag text
  ctx.fillStyle = color;
  ctx.fillText(tag, x + 12, y);
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
  const words = (text || '').split(' ');
  let line = '';
  let lines = 0;
  for (const word of words) {
    const test = line + (line ? ' ' : '') + word;
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      lines++;
      if (lines >= (maxLines || 6)) return y;
      line = word;
    } else {
      line = test;
    }
  }
  if (line) { ctx.fillText(line, x, y); y += lineHeight; }
  return y;
}

function drawAccent(ctx, w, h, color) {
  // Top bar
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, 5);
  // Left bar
  ctx.globalAlpha = 0.6;
  ctx.fillRect(0, 0, 6, h);
  ctx.globalAlpha = 1;
  // Gradient wash
  const grad = ctx.createLinearGradient(0, 120, 0, h * 0.65);
  grad.addColorStop(0, color + '20');
  grad.addColorStop(1, 'transparent');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 120, w, h * 0.5);
}

function drawFooter(ctx, w, h, color) {
  ctx.fillStyle = color + '60';
  roundRect(ctx, 50, h - 65, 160, 3, 2);
  ctx.fill();
  drawLogo(ctx, 50, h - 30, 18);
  ctx.font = font(600, 12);
  ctx.fillStyle = GRAY;
  ctx.textAlign = 'right';
  ctx.fillText('tourfeed.co', w - 50, h - 30);
  ctx.textAlign = 'left';
}

// ────── HEADLINE (1080x1080) ──────
function generateHeadline(params) {
  const tag = params.tag || 'BREAKING';
  const headline = params.headline || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : RED;

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);
  drawAccent(ctx, 1080, 1080, tagColor);
  drawLogo(ctx, 50, 65, 26);
  drawTag(ctx, tag, 50, 120, tagColor);
  ctx.font = font(800, 48);
  ctx.fillStyle = WHITE;
  wrapText(ctx, headline, 50, 260, 980, 60, 6);
  drawFooter(ctx, 1080, 1080, tagColor);
  return c.toBuffer('image/png');
}

// ────── ARTICLE HEADER (1200x630) ──────
function generateArticleHeader(params) {
  const tag = params.tag || 'NEWS';
  const headline = params.headline || '';
  const tagColor = tag === 'RECAP' ? GREEN : tag === 'BETTING' ? GOLD : tag === 'PREVIEW' ? GREEN : tag === 'ANALYSIS' ? '#4A90D9' : tag === 'BREAKING' ? RED : GREEN;

  const c = createCanvas(1200, 630);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1200, 630);
  drawAccent(ctx, 1200, 630, tagColor);
  drawLogo(ctx, 50, 55, 22);
  drawTag(ctx, tag, 50, 100, tagColor);
  ctx.font = font(800, 38);
  ctx.fillStyle = WHITE;
  wrapText(ctx, headline, 50, 190, 1100, 50, 6);
  drawFooter(ctx, 1200, 630, tagColor);
  return c.toBuffer('image/png');
}

// ────── HOT TAKE (1080x1080) ──────
function generateHotTake(params) {
  const quote = params.quote || '';
  const context = params.context || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);
  drawAccent(ctx, 1080, 1080, GREEN);
  drawLogo(ctx, 50, 65, 26);
  drawTag(ctx, 'HOT TAKE', 50, 120, GREEN);

  // Big quote mark
  ctx.font = font(900, 120);
  ctx.fillStyle = GREEN + '25';
  ctx.fillText('\u201C', 40, 300);

  // Quote text
  ctx.font = font(700, 40);
  ctx.fillStyle = WHITE;
  wrapText(ctx, quote, 60, 350, 960, 52, 6);

  if (context) {
    ctx.font = font(600, 15);
    ctx.fillStyle = GRAY;
    ctx.textAlign = 'center';
    ctx.fillText(context, 540, 920);
    ctx.textAlign = 'left';
  }

  drawFooter(ctx, 1080, 1080, GREEN);
  return c.toBuffer('image/png');
}

// ────── PICK (1080x1080) ──────
function generatePick(params) {
  const label = params.label || 'BEST BET';
  const name = params.name || '';
  const odds = params.odds || '';
  const reason = params.reason || '';
  const labelColor = label === 'LONGSHOT' ? GOLD : label === 'FADE' ? RED : label === 'VALUE PLAY' ? '#4A90D9' : GREEN;

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);
  drawAccent(ctx, 1080, 1080, labelColor);
  drawLogo(ctx, 50, 65, 26);
  drawTag(ctx, label, 50, 120, labelColor);

  ctx.font = font(900, 56);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(name, 540, 400);

  ctx.font = font(800, 48);
  ctx.fillStyle = labelColor;
  ctx.fillText(odds, 540, 480);
  ctx.textAlign = 'left';

  if (reason) {
    ctx.font = font(500, 20);
    ctx.fillStyle = DIM;
    wrapText(ctx, reason, 80, 560, 920, 30, 4);
  }

  drawFooter(ctx, 1080, 1080, labelColor);
  return c.toBuffer('image/png');
}

// ────── WINNER (1080x1080) ──────
function generateWinner(params) {
  const name = params.name || '';
  const tournament = params.tournament || '';
  const score = params.score || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);

  // Gold glow
  const glow = ctx.createLinearGradient(0, 200, 0, 600);
  glow.addColorStop(0, GOLD + '18');
  glow.addColorStop(1, 'transparent');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 200, 1080, 400);

  drawAccent(ctx, 1080, 1080, GOLD);
  drawLogo(ctx, 50, 65, 26);

  ctx.font = font(700, 20);
  ctx.fillStyle = GOLD;
  ctx.textAlign = 'center';
  ctx.letterSpacing = '8px';
  ctx.fillText('W I N N E R', 540, 310);

  ctx.font = font(900, 56);
  ctx.fillStyle = WHITE;
  ctx.fillText(name, 540, 420);

  ctx.font = font(900, 68);
  ctx.fillStyle = GREEN;
  ctx.fillText(score, 540, 530);

  ctx.font = font(600, 22);
  ctx.fillStyle = DIM;
  ctx.fillText(tournament, 540, 600);
  ctx.textAlign = 'left';

  drawFooter(ctx, 1080, 1080, GOLD);
  return c.toBuffer('image/png');
}

// ────── STAT CARD (1080x1080) ──────
function generateStat(params) {
  const number = params.number || '';
  const label = params.label || '';
  const player = params.player || '';
  const context = params.context || '';

  const c = createCanvas(1080, 1080);
  const ctx = c.getContext('2d');
  drawGradientBg(ctx, 1080, 1080);
  drawAccent(ctx, 1080, 1080, GREEN);
  drawLogo(ctx, 50, 65, 26);

  ctx.font = font(900, 110);
  ctx.fillStyle = WHITE;
  ctx.textAlign = 'center';
  ctx.fillText(number, 540, 400);

  ctx.font = font(600, 22);
  ctx.fillStyle = DIM;
  ctx.fillText(label, 540, 450);

  ctx.font = font(800, 28);
  ctx.fillStyle = WHITE;
  ctx.fillText(player, 540, 530);

  if (context) {
    ctx.font = font(600, 16);
    ctx.fillStyle = GRAY;
    ctx.fillText(context, 540, 575);
  }
  ctx.textAlign = 'left';

  drawFooter(ctx, 1080, 1080, GREEN);
  return c.toBuffer('image/png');
}

// ────── LEADERBOARD (1080x1080) ──────
function generateLeaderboard(params) {
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
  drawLogo(ctx, 50, 60, 26);

  ctx.font = font(700, 14);
  ctx.fillStyle = GREEN;
  ctx.fillText(title, 50, 105);

  if (subtitle) {
    ctx.font = font(800, 24);
    ctx.fillStyle = WHITE;
    ctx.fillText(subtitle, 50, 140);
  }

  players.forEach((p, i) => {
    const y = 185 + i * 52;
    if (i === 0) {
      ctx.fillStyle = GREEN + '15';
      roundRect(ctx, 30, y - 18, 1020, 46, 8);
      ctx.fill();
    }

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
    case 'leaderboard': pngBuffer = generateLeaderboard(params); break;
    case 'headline': pngBuffer = generateHeadline(params); break;
    case 'article_header': pngBuffer = generateArticleHeader(params); break;
    case 'pick': pngBuffer = generatePick(params); break;
    case 'winner': pngBuffer = generateWinner(params); break;
    case 'stat': pngBuffer = generateStat(params); break;
    case 'hot_take': pngBuffer = generateHotTake(params); break;
    default: pngBuffer = generateHeadline(params);
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
