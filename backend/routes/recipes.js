const express = require('express');

const { authenticateToken } = require('../middleware/auth');
const { attachDbContext } = require('../middleware/dbContext');
const {
  requireAdminOrManager
} = require('../middleware/authorization');
const { assertDepartmentBelongsToStore } = require('../utils/departmentHelpers');

const router = express.Router();

/**
 * GET /api/recipes
 */
router.get('/', authenticateToken, attachDbContext, async (req, res) => {

  try {

    const departmentId = req.query.department_id;

    if (!departmentId) {
      return res.status(400).json({
        error: 'department_id requis'
      });
    }

    const result = await req.dbPool.query(`
      SELECT
        r.*,
        a.plu,
        a.designation AS article_name
      FROM recipes r
      JOIN articles a
        ON a.id = r.output_article_id
      WHERE r.store_id = $1
        AND r.department_id = $2
      ORDER BY r.name ASC
    `, [
      req.user.store_id,
      departmentId
    ]);

    res.json(result.rows);

  } catch (err) {

    console.error('GET /api/recipes error', err);

    res.status(500).json({
      error: 'Erreur serveur'
    });
  }
});

/**
 * GET /api/recipes/:id
 */
router.get('/:id', authenticateToken, attachDbContext, async (req, res) => {

  try {

    const recipeResult = await req.dbPool.query(`
      SELECT *
      FROM recipes
      WHERE id = $1
        AND store_id = $2
    `, [
      req.params.id,
      req.user.store_id
    ]);

    if (!recipeResult.rows.length) {
      return res.status(404).json({
        error: 'Recette introuvable'
      });
    }

    const recipe = recipeResult.rows[0];

    const ingredientsResult = await req.dbPool.query(`
      SELECT
        ri.*,
        a.plu,
        a.designation
      FROM recipe_ingredients ri
      JOIN articles a
        ON a.id = ri.article_id
      WHERE ri.recipe_id = $1
      ORDER BY ri.line_number ASC
    `, [recipe.id]);

    recipe.ingredients = ingredientsResult.rows;

    res.json(recipe);

  } catch (err) {

    console.error('GET /api/recipes/:id error', err);

    res.status(500).json({
      error: 'Erreur serveur'
    });
  }
});

/**
 * POST /api/recipes
 */
router.post(
  '/',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {

    const client = await req.dbPool.connect();

    try {

      await client.query('BEGIN');

      const {
        department_id,
        name,
        output_article_id,
        output_quantity,
        output_unit,
        dlc_days,
        procedure,
        ingredients
      } = req.body;

      const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

      if (!department) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Rayon invalide pour ce magasin'
        });
      }

      const recipeResult = await client.query(`
        INSERT INTO recipes (
          store_id,
          department_id,
          name,
          output_article_id,
          output_quantity,
          output_unit,
          dlc_days,
          procedure,
          created_by,
          updated_by
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$9
        )
        RETURNING *
      `, [
        req.user.store_id,
        department_id,
        name,
        output_article_id,
        output_quantity || 1,
        output_unit || 'kg',
        dlc_days || 0,
        procedure || null,
        req.user.id
      ]);

      const recipe = recipeResult.rows[0];

      if (Array.isArray(ingredients)) {

        for (let i = 0; i < ingredients.length; i++) {

          const ing = ingredients[i];

          await client.query(`
            INSERT INTO recipe_ingredients (
              recipe_id,
              article_id,
              line_number,
              quantity,
              unit
            )
            VALUES ($1,$2,$3,$4,$5)
          `, [
            recipe.id,
            ing.article_id,
            i + 1,
            ing.quantity,
            ing.unit || 'kg'
          ]);
        }
      }

      await client.query('COMMIT');

      res.status(201).json(recipe);

    } catch (err) {

      await client.query('ROLLBACK');

      console.error('POST /api/recipes error', err);

      res.status(500).json({
        error: 'Erreur serveur'
      });

    } finally {

      client.release();
    }
  }
);

/**
 * PATCH /api/recipes/:id
 */
router.patch(
  '/:id',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {

    const client = await req.dbPool.connect();

    try {

      await client.query('BEGIN');

      const {
        department_id,
        name,
        output_article_id,
        output_quantity,
        output_unit,
        dlc_days,
        procedure,
        ingredients
      } = req.body;

      const department = await assertDepartmentBelongsToStore(client, department_id, req.user.store_id);

      if (!department) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: 'Rayon invalide pour ce magasin'
        });
      }

      const recipeResult = await client.query(`
        UPDATE recipes
        SET
          department_id = $1,
          name = $2,
          output_article_id = $3,
          output_quantity = $4,
          output_unit = $5,
          dlc_days = $6,
          procedure = $7,
          updated_by = $8,
          updated_at = NOW()
        WHERE id = $9
          AND store_id = $10
        RETURNING *
      `, [
        department_id,
        name,
        output_article_id,
        output_quantity || 1,
        output_unit || 'kg',
        dlc_days || 0,
        procedure || null,
        req.user.id,
        req.params.id,
        req.user.store_id
      ]);

      if (!recipeResult.rows.length) {

        await client.query('ROLLBACK');

        return res.status(404).json({
          error: 'Recette introuvable'
        });
      }

      await client.query(`
        DELETE FROM recipe_ingredients
        WHERE recipe_id = $1
      `, [req.params.id]);

      if (Array.isArray(ingredients)) {

        for (let i = 0; i < ingredients.length; i++) {

          const ing = ingredients[i];

          await client.query(`
            INSERT INTO recipe_ingredients (
              recipe_id,
              article_id,
              line_number,
              quantity,
              unit
            )
            VALUES ($1,$2,$3,$4,$5)
          `, [
            req.params.id,
            ing.article_id,
            i + 1,
            ing.quantity,
            ing.unit || 'kg'
          ]);
        }
      }

      await client.query('COMMIT');

      res.json(recipeResult.rows[0]);

    } catch (err) {

      await client.query('ROLLBACK');

      console.error('PATCH /api/recipes/:id error', err);

      res.status(500).json({
        error: 'Erreur serveur'
      });

    } finally {

      client.release();
    }
  }
);

/**
 * DELETE /api/recipes/:id
 */
router.delete(
  '/:id',
  authenticateToken,
  attachDbContext,
  requireAdminOrManager,
  async (req, res) => {

    try {

      const result = await req.dbPool.query(`
        DELETE FROM recipes
        WHERE id = $1
          AND store_id = $2
        RETURNING id
      `, [
        req.params.id,
        req.user.store_id
      ]);

      if (!result.rows.length) {
        return res.status(404).json({
          error: 'Recette introuvable'
        });
      }

      res.json({
        success: true
      });

    } catch (err) {

      console.error('DELETE /api/recipes/:id error', err);

      res.status(500).json({
        error: 'Erreur serveur'
      });
    }
  }
);

module.exports = router;
