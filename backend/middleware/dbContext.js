const { getPoolByClientKey } = require('../dbRegistry');

function attachDbContext(req, res, next) {
  const tokenClientKey = req.user && req.user.client_key;

  if (!tokenClientKey) {
    return res.status(401).json({ error: 'Session invalide, reconnecte-toi' });
  }

  try {
    req.dbPool = getPoolByClientKey(tokenClientKey);

    req.dbContext = {
      clientKey: tokenClientKey,
      fallbackToDefault: false,
    };

    next();
  } catch (err) {
    console.error('Erreur contexte DB :', err);
    res.status(403).json({ error: 'Contexte client invalide' });
  }
}

module.exports = {
  attachDbContext,
};
