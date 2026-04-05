// Shared cooldown check — returns minutes since last tweet from @TourFeedGolf
async function getMinutesSinceLastTweet() {
  const bearer = process.env.TWITTER_BEARER_TOKEN;
  if (!bearer) return 999;

  try {
    const userRes = await fetch('https://api.twitter.com/2/users/by/username/TourFeedGolf', {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!userRes.ok) return 999;
    const userData = await userRes.json();
    const userId = userData.data?.id;
    if (!userId) return 999;

    const tweetsRes = await fetch(`https://api.twitter.com/2/users/${userId}/tweets?max_results=5&tweet.fields=created_at`, {
      headers: { 'Authorization': `Bearer ${bearer}` },
    });
    if (!tweetsRes.ok) return 999;
    const tweetsData = await tweetsRes.json();
    const last = tweetsData.data?.[0];
    if (!last) return 999;

    return (Date.now() - new Date(last.created_at).getTime()) / 60000;
  } catch (e) {
    return 999;
  }
}

module.exports = { getMinutesSinceLastTweet };
