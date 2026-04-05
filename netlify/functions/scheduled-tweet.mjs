import { schedule } from '@netlify/functions';

const handler = async () => {
  const minute = new Date().getMinutes();

  try {
    // Every 20 min: tweet a news headline
    if (minute % 20 === 0) {
      const res = await fetch('https://tourfeed.co/.netlify/functions/tweet-news', { method: 'POST' });
      const data = await res.json();
      console.log('News tweet:', JSON.stringify(data));
    }

    // Every 30 min: reply to a big golf account tweet
    if (minute % 30 === 0) {
      const res = await fetch('https://tourfeed.co/.netlify/functions/engage-tweets', { method: 'POST' });
      const data = await res.json();
      console.log('Engage tweet:', JSON.stringify(data));
    }

    // Every 10 min: check for score updates (leader changes, big plays, hourly)
    const res = await fetch('https://tourfeed.co/.netlify/functions/auto-tweet', { method: 'POST' });
    const data = await res.json();
    console.log('Score tweet:', JSON.stringify(data));
  } catch (err) {
    console.error('Scheduled tweet error:', err);
  }
};

export default schedule('*/10 * * * *', handler);
