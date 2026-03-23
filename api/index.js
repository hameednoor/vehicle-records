const app = require('../server/index');
const { ensureInit } = require('../server/index');

// Wrap express app for Vercel serverless
module.exports = async (req, res) => {
  await ensureInit();
  return app(req, res);
};
