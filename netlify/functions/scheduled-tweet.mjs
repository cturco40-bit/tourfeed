import { schedule } from '@netlify/functions';

const handler = async () => {
  try {
    // Call the auto-tweet function internally
    const res = await fetch('https://tourfeed.co/.netlify/functions/auto-tweet', {
      method: 'POST',
    });
    const data = await res.json();
    console.log('Scheduled tweet result:', JSON.stringify(data));
  } catch (err) {
    console.error('Scheduled tweet error:', err);
  }
};

export default schedule('*/10 * * * *', handler);
