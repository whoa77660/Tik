// TikTok Node Suite API configuration
// RapidAPI keys are read automatically by server.js.
// Environment variables can still override these values on Render.

module.exports = {
  rapidApi: {
    host: 'tiktok-scraper7.p.rapidapi.com',
    keys: [
      '88451e46a1msh4da5011a9b08fefp1cd049jsn0fb24108803a',
      '25d664956fmsh8528a6b12b10b8ap11d93cjsn23c8df392588',
      '5ed7dcbd27msh819c421722d2f09p1da46ajsne996e42b9e06'
    ],
    cacheTtl: 300
  },

  // Instagram Explorer uses HikerAPI by default. Add your own token(s)
  // here, or set INSTAGRAM_API_KEYS / HIKER_API_KEYS on Render.
  // HikerAPI exposes public Instagram profile and media endpoints.
  instagramApi: {
    provider: 'hikerapi',
    host: 'api.hikerapi.com',
    keys: [
      't09oj7dxzlzs6w0v6782ahz6i0ueqhqu'
    ],
    cacheTtl: 300,
    timeoutMs: 15000
  }
};
