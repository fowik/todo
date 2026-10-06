const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadConfig() {
  const sandbox = { window: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'config.js'), 'utf8'), sandbox, { timeout: 1000 });
  return {
    SUPABASE_URL: process.env.SUPABASE_URL || sandbox.window.RTU_CONFIG.SUPABASE_URL,
    SUPABASE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY || sandbox.window.RTU_CONFIG.SUPABASE_KEY
  };
}

function createAuth(config, request = fetch) {
  return async (req, res, next) => {
    const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
    res.set('Cache-Control', 'no-store');
    if (!token) return res.status(401).json({ ok: false, error: 'Сначала войди в RTU Todo.' });
    try {
      const response = await request(`${config.SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: config.SUPABASE_KEY, Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000)
      });
      if (!response.ok) return res.status(401).json({ ok: false, error: 'Сессия истекла. Войди в RTU Todo заново.' });
      const user = await response.json();
      if (!/^[a-f0-9-]{36}$/i.test(user.id || '')) return res.status(401).json({ ok: false, error: 'Не удалось проверить аккаунт.' });
      req.userId = user.id;
      next();
    } catch {
      res.status(503).json({ ok: false, error: 'Не удалось проверить вход через Supabase. Попробуй позже.' });
    }
  };
}

module.exports = { loadConfig, createAuth };
