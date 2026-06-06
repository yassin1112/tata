if (!process.env.VERCEL) {
  require('dotenv').config();
}
const { createApp } = require('../server/app');
const { connectDb } = require('../server/config/db');
const { ensureBootstrapped } = require('../server/services/autoSeed');

let app;
let initPromise;

async function handler(req, res) {
  try {
    if (!initPromise) {
      initPromise = connectDb()
        .then(() => ensureBootstrapped())
        .catch((err) => {
          console.error('MongoDB unavailable — catalog fallback only:', err.message);
          global.__mongoDown = true;
        })
        .then(() => {
          app = createApp({ serveStatic: false });
        });
    }
    await initPromise;
    return app(req, res);
  } catch (err) {
    console.error('API error:', err);
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Server error',
        message: process.env.VERCEL
          ? 'Check MONGODB_URI in Vercel → Settings → Environment Variables'
          : err.message,
      });
    }
  }
}

handler.config = {
  maxDuration: 60,
  memory: 1024,
};

module.exports = handler;
