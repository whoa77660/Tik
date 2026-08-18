module.exports = {
  server: {
    port: 3000,
    cacheTtl: 300,
  },

  rapidApi: {
    host: "tiktok-scraper7.p.rapidapi.com",

    keys: [
      "5ed7dcbd27msh819c421722d2f09p1da46ajsne996e42b9e06",
      "25d664956fmsh8528a6b12b10b8ap11d93cjsn23c8df392588",
      "88451e46a1msh4da5011a9b08fefp1cd049jsn0fb24108803a",
    ],

    timeout: 15000,

    endpoints: {
      profile: "/user/info",
      videos: "/user/posts",
    },
  },

  tikTok: {
    timeout: 15000,
    requestDelay: 350,
    userAgent: "Mozilla/5.0 ...",
  },

  tikVerify: {
    maxInputSize: 5 * 1024 * 1024,
    csrfEnabled: true,
  },

  explorer: {
    defaultVideoCount: 30,
    maxVideoCount: 500,
  },
};
