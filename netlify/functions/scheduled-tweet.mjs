import { schedule } from '@netlify/functions';

const handler = async () => {
  const base = 'https://tourfeed.co/.netlify/functions';

  try {
    // v2 pipeline — all content flows through Supabase drafts

    // 1. Fetch latest scores into Supabase
    await fetch(`${base}/fetch-scores-v2`, { method: 'POST' }).catch(() => {});

    // 2. Generate content from leaderboard data (recaps, tweets, betting)
    await fetch(`${base}/generate-content-v2`, { method: 'POST' }).catch(() => {});

    // 3. Generate original tweets from headlines
    await fetch(`${base}/generate-tweets`, { method: 'POST' }).catch(() => {});

    // 4. Publish any approved drafts
    await fetch(`${base}/publish-approved`, { method: 'POST' }).catch(() => {});

    console.log('v2 pipeline run complete');
  } catch (err) {
    console.error('Scheduled pipeline error:', err);
  }
};

export default schedule('*/10 * * * *', handler);
