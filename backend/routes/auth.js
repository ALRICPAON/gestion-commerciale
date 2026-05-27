const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { DB_CLIENTS, getPoolByClientKey } = require('../dbRegistry');
const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

const LOGIN_CLIENT_PRIORITY = ['scorpa', 'default'];

function getLoginClientKeys() {
  const configuredClientKeys = Object.keys(DB_CLIENTS);
  const configured = new Set(configuredClientKeys);
  const prioritized = LOGIN_CLIENT_PRIORITY.filter((clientKey) => configured.has(clientKey));
  const remaining = configuredClientKeys.filter(
    (clientKey) => !prioritized.includes(clientKey)
  );

  return [
    ...prioritized,
    ...remaining,
  ];
}

async function comparePassword(password, passwordHash) {
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch (err) {
    return false;
  }
}

async function findLoginContext(email, password) {
  for (const clientKey of getLoginClientKeys()) {
    const clientPool = getPoolByClientKey(clientKey);

    let userResult;

    try {
      userResult = await clientPool.query(
        `
        SELECT u.id, u.store_id, u.email, u.role, u.is_active, u.password_hash, s.client_key
        FROM users u
        LEFT JOIN stores s ON s.id = u.store_id
        WHERE u.email = $1
          AND u.is_active = true
        `,
        [email]
      );
    } catch (err) {
      console.warn(`Login multi-DB ignore ${clientKey} :`, err.message);
      continue;
    }

    for (const user of userResult.rows) {
      const passwordOk = await comparePassword(password, user.password_hash);

      if (!passwordOk) {
        continue;
      }

      const storeResult = await clientPool.query(
        `
        SELECT id, code, name, client_key
        FROM stores
        WHERE id = $1
        `,
        [user.store_id]
      );

      const departmentsResult = await clientPool.query(
        `
        SELECT d.id, d.code, d.name, d.business_type, ud.is_default
        FROM user_departments ud
        JOIN departments d ON d.id = ud.department_id
        WHERE ud.user_id = $1
        ORDER BY d.name ASC
        `,
        [user.id]
      );

      const store = storeResult.rows[0] || null;
      const clientKeyFromStore = (store && store.client_key) || user.client_key || null;
      const effectiveClientKey =
        clientKey === 'default' ? clientKeyFromStore || 'default' : clientKey;

      return {
        user: {
          ...user,
          client_key: effectiveClientKey,
        },
        store: store
          ? {
              ...store,
              client_key: effectiveClientKey,
            }
          : null,
        departments: departmentsResult.rows,
      };
    }
  }

  return null;
}

router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const loginContext = await findLoginContext(email, password);

    if (!loginContext) {
      return res.status(401).json({ error: 'Identifiants invalides' });
    }

    const { user, store, departments } = loginContext;

    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        store_id: user.store_id,
        client_key: user.client_key || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: '12h' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        is_active: user.is_active,
        store_id: user.store_id,
        client_key: user.client_key || null,
      },
      store,
      departments,
    });
  } catch (err) {
    console.error('Erreur login :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/me', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const userResult = await req.dbPool.query(
      `
      SELECT u.id, u.store_id, u.email, u.role, u.is_active, s.client_key
      FROM users u
      LEFT JOIN stores s ON s.id = u.store_id
      WHERE u.id = $1
      `,
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const user = userResult.rows[0];

    if (!user.is_active) {
      return res.status(403).json({ error: 'Compte désactivé' });
    }

    const storeResult = await req.dbPool.query(
      `
      SELECT id, code, name, client_key
      FROM stores
      WHERE id = $1
      `,
      [user.store_id]
    );

    const departmentsResult = await req.dbPool.query(
      `
      SELECT d.id, d.code, d.name, d.business_type, ud.is_default
      FROM user_departments ud
      JOIN departments d ON d.id = ud.department_id
      WHERE ud.user_id = $1
      ORDER BY d.name ASC
      `,
      [user.id]
    );

    res.json({
      user,
      store: storeResult.rows[0] || null,
      departments: departmentsResult.rows,
    });
  } catch (err) {
    console.error('Erreur /api/me :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/db-context-test', authenticateToken, attachDbContext, async (req, res) => {
  try {
    const dbResult = await req.dbPool.query(
      'SELECT current_database() as database_name, NOW() as now'
    );

    res.json({
      ok: true,
      user: {
        id: req.user.id,
        email: req.user.email,
        role: req.user.role,
        store_id: req.user.store_id,
        client_key: req.user.client_key || null,
      },
      dbContext: {
        client_key: req.dbContext.clientKey,
        fallback_to_default: req.dbContext.fallbackToDefault,
        database_name: dbResult.rows[0].database_name,
      },
      serverTime: dbResult.rows[0].now,
    });
  } catch (err) {
    console.error('Erreur /api/db-context-test :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
