const express = require('express');
const bcrypt = require('bcrypt');
const { authenticateToken } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/authorization');
const { attachDbContext } = require('../middleware/dbContext');

const router = express.Router();

router.get('/departments', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  try {
    const db = req.dbPool;
    const result = await db.query(
      `
      SELECT id, store_id, code, name, business_type
      FROM departments
      WHERE store_id = $1
        AND code <> 'PRINC'
      ORDER BY name ASC
      `,
      [req.user.store_id]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur departments :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/users', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  try {
    const db = req.dbPool;
    const usersResult = await db.query(
      `
      SELECT
        u.id,
        u.email,
        u.role,
        u.store_id,
        u.is_active,
        s.name AS store_name
      FROM users u
      LEFT JOIN stores s ON s.id = u.store_id
      WHERE u.store_id = $1
      ORDER BY u.email ASC
      `,
      [req.user.store_id]
    );

    const linksResult = await db.query(
      `
      SELECT
        ud.user_id,
        ud.department_id,
        ud.is_default,
        d.name AS department_name,
        d.code AS department_code
      FROM user_departments ud
      INNER JOIN departments d ON d.id = ud.department_id
      WHERE d.store_id = $1
        AND d.code <> 'PRINC'
      ORDER BY d.name ASC
      `,
      [req.user.store_id]
    );

    const users = usersResult.rows.map((user) => {
      const departments = linksResult.rows
        .filter((link) => link.user_id === user.id)
        .map((link) => ({
          department_id: link.department_id,
          department_name: link.department_name,
          department_code: link.department_code,
          is_default: link.is_default,
        }));

      return {
        ...user,
        departments,
      };
    });

    res.json(users);
  } catch (err) {
    console.error('Erreur users :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/users', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  const db = req.dbPool;
  const client = await db.connect();

  try {
    const {
      email,
      password,
      role,
      department_ids,
      default_department_id,
    } = req.body;

    const storeId = req.user.store_id;

    if (!email || !password || !role) {
      return res.status(400).json({ error: 'Champs obligatoires manquants' });
    }

    if (!Array.isArray(department_ids) || department_ids.length === 0) {
      return res.status(400).json({ error: 'Au moins un service doit être sélectionné' });
    }

    if (!default_department_id) {
      return res.status(400).json({ error: 'Le service par défaut est obligatoire' });
    }

    if (!department_ids.includes(default_department_id)) {
      return res.status(400).json({
        error: 'Le service par défaut doit faire partie des services autorisés',
      });
    }

    const allowedRoles = ['admin', 'responsable', 'commercial', 'qualite', 'vendeur'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    const existingUser = await client.query(
      `SELECT id FROM users WHERE email = $1`,
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'Cet email existe déjà' });
    }

    const departmentsCheck = await client.query(
      `
      SELECT id
      FROM departments
      WHERE store_id = $1
        AND code <> 'PRINC'
        AND id = ANY($2::uuid[])
      `,
      [storeId, department_ids]
    );

    if (departmentsCheck.rows.length !== department_ids.length) {
      return res.status(400).json({ error: 'Services invalides pour ce magasin' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await client.query('BEGIN');

    const userInsert = await client.query(
      `
      INSERT INTO users (id, store_id, email, password_hash, role, is_active)
      VALUES (gen_random_uuid(), $1, $2, $3, $4, true)
      RETURNING id, email, role, store_id, is_active
      `,
      [storeId, email, hashedPassword, role]
    );

    const user = userInsert.rows[0];

    for (const departmentId of department_ids) {
      await client.query(
        `
        INSERT INTO user_departments (id, user_id, department_id, is_default)
        VALUES (gen_random_uuid(), $1, $2, $3)
        `,
        [user.id, departmentId, departmentId === default_department_id]
      );
    }

    await client.query('COMMIT');

    res.status(201).json({
      ok: true,
      message: 'Utilisateur créé avec succès',
      user,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur create user :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/users/:id', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  const db = req.dbPool;
  const client = await db.connect();

  try {
    const userId = req.params.id;
    const { email, role, department_ids, default_department_id, password } = req.body;

    const allowedRoles = ['admin', 'responsable', 'commercial', 'qualite', 'vendeur'];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: 'Rôle invalide' });
    }

    if (!email) {
      return res.status(400).json({ error: 'Email obligatoire' });
    }

    if (!Array.isArray(department_ids) || department_ids.length === 0) {
      return res.status(400).json({ error: 'Au moins un service doit être sélectionné' });
    }

    if (!default_department_id) {
      return res.status(400).json({ error: 'Le service par défaut est obligatoire' });
    }

    if (!department_ids.includes(default_department_id)) {
      return res.status(400).json({
        error: 'Le service par défaut doit faire partie des services autorisés',
      });
    }

    const userCheck = await client.query(
      `SELECT id FROM users WHERE id = $1 AND store_id = $2`,
      [userId, req.user.store_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    const duplicateCheck = await client.query(
      `SELECT id FROM users WHERE email = $1 AND id <> $2`,
      [email, userId]
    );

    if (duplicateCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Cet email existe déjà' });
    }

    const departmentsCheck = await client.query(
      `
      SELECT id
      FROM departments
      WHERE store_id = $1
        AND code <> 'PRINC'
        AND id = ANY($2::uuid[])
      `,
      [req.user.store_id, department_ids]
    );

    if (departmentsCheck.rows.length !== department_ids.length) {
      return res.status(400).json({ error: 'Services invalides pour ce magasin' });
    }

    await client.query('BEGIN');

    if (password && password.trim() !== '') {
      const hashedPassword = await bcrypt.hash(password, 10);

      await client.query(
        `
        UPDATE users
        SET email = $1, role = $2, password_hash = $3
        WHERE id = $4 AND store_id = $5
        `,
        [email, role, hashedPassword, userId, req.user.store_id]
      );
    } else {
      await client.query(
        `
        UPDATE users
        SET email = $1, role = $2
        WHERE id = $3 AND store_id = $4
        `,
        [email, role, userId, req.user.store_id]
      );
    }

    await client.query(`DELETE FROM user_departments WHERE user_id = $1`, [userId]);

    for (const departmentId of department_ids) {
      await client.query(
        `
        INSERT INTO user_departments (id, user_id, department_id, is_default)
        VALUES (gen_random_uuid(), $1, $2, $3)
        `,
        [userId, departmentId, departmentId === default_department_id]
      );
    }

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Utilisateur modifié avec succès' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur update user :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

router.patch('/users/:id/deactivate', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  try {
    const db = req.dbPool;
    const userId = req.params.id;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Tu ne peux pas désactiver ton propre compte' });
    }

    const result = await db.query(
      `
      UPDATE users
      SET is_active = false
      WHERE id = $1 AND store_id = $2
      RETURNING id
      `,
      [userId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur désactivation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.patch('/users/:id/reactivate', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  try {
    const db = req.dbPool;
    const userId = req.params.id;

    const result = await db.query(
      `
      UPDATE users
      SET is_active = true
      WHERE id = $1 AND store_id = $2
      RETURNING id
      `,
      [userId, req.user.store_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur réactivation :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/users/:id', authenticateToken, attachDbContext, requireAdmin, async (req, res) => {
  const db = req.dbPool;
  const client = await db.connect();

  try {
    const userId = req.params.id;

    if (userId === req.user.id) {
      return res.status(400).json({ error: 'Tu ne peux pas supprimer ton propre compte' });
    }

    const userCheck = await client.query(
      `
      SELECT id
      FROM users
      WHERE id = $1 AND store_id = $2
      `,
      [userId, req.user.store_id]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Utilisateur introuvable' });
    }

    await client.query('BEGIN');

    await client.query(
      `DELETE FROM user_departments WHERE user_id = $1`,
      [userId]
    );

    await client.query(
      `DELETE FROM users WHERE id = $1 AND store_id = $2`,
      [userId, req.user.store_id]
    );

    await client.query('COMMIT');

    res.json({ ok: true, message: 'Utilisateur supprimé avec succès' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur suppression utilisateur :', err);
    res.status(500).json({ error: 'Erreur serveur' });
  } finally {
    client.release();
  }
});

module.exports = router;
