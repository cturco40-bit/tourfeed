import { schedule } from '@netlify/functions';

const handler = async () => {
  // Alternate between score updates and news tweets
  const minute = new Date().getMinutes();
  const isNewsRun = minute % 20 === 0; // News every 20 min, scores on the rest

  try {
    if (isNewsRun) {
      // Tweet a news headline
      const res = await fetch('https://tourfeed.co/.netlify/functions/tweet-news', { method: 'POST' });
      const data = await res.json();
      console.log('News tweet result:', JSON.stringify(data));
    }

    // Always check for score updates (leader changes, big plays, hourly)
    const res = await fetch('https://tourfeed.co/.netlify/functions/auto-tweet', { method: 'POST' });
    const data = await res.json();
    console.log('Score tweet result:', JSON.stringify(data));
  } catch (err) {
    console.error('Scheduled tweet error:', err);
  }
};

export default schedule('*/10 * * * *', handler);
