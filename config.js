// TikTok Node Suite API configuration
// RapidAPI keys are read automatically by server.js.
// Environment variables can still override these values on Render.

module.exports = {
  rapidApi: {
    host: 'tiktok-scraper7.p.rapidapi.com',
    keys: [
      '88451e46a1msh4da5011a9b08fefp1cd049jsn0fb24108803a',
      '25d664956fmsh8528a6b12b10b8ap11d93cjsn23c8df392588',
      '5ed7dcbd27msh819c421722d2f09p1da46ajsne996e42b9e06',
      '1a0fb94230mshcaf977a0415cc69p1def6bjsn50c3b678f1b6',
      '8056a15492mshcce2ca7c0a7ebfap17f565jsna40a60c6e8e7'
    ],
    cacheTtl: 300
  },

  // Instagram Explorer uses ReefAPI (1,000 free credits on signup).
  instagramApi: {
    provider: 'reefapi',
    baseUrl: 'https://api.reefapi.com',
    key: 'ak_live_g1wIkrPjxM0JMNb1tAnwvhssK_Ola895',
    cacheTtl: 300,
    timeoutMs: 20000
  },

  // Firebase Admin is configured with environment variables/serviceAccountKey.json.
  // It is used ONLY for the Instagram API key settings; TikTok keys are untouched.
  firebase: {
    databaseURL: 'https://free-call-a148e-default-rtdb.firebaseio.com',
    instagramKeyPath: 'settings/instagram/reefapiKey'
  }

};
