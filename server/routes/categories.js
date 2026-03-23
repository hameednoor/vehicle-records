const express = require('express');
const { body, validationResult } = require('express-validator');
const { v4: uuidv4 } = require('uuid');
const { getDb } = require('../db/database');

const router = express.Router();

/**
 * GET / - List all categories. Optionally filter by archived status.
 * Query params:
 *   includeArchived=true  - include archived categories (default: false)
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    const includeArchived = req.query.includeArchived === 'true';

    let query = 'SELECT * FROM categories';

    if (!includeArchived) {
      query += ' WHERE "isArchived" = 0';
    }

    query += ' ORDER BY "isDefault" DESC, name ASC';

    const categories = await db.all(query);
    res.json(categories);
  } catch (error) {
    console.error('Error fetching categories:', error.message);
    res.status(500).json({ error: 'Failed to fetch categories.' });
  }
});

/**
 * POST / - Create a new category.
 */
router.post(
  '/',
  [body('name').trim().notEmpty().withMessage('Category name is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const id = uuidv4();
      const { name, defaultKms, defaultDays } = req.body;

      // Check for duplicate name
      const existing = await db.get(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER(?)',
        name
      );
      if (existing) {
        return res.status(409).json({ error: 'A category with this name already exists.' });
      }

      await db.run(
        'INSERT INTO categories (id, name, "isDefault", "isArchived", "defaultKms", "defaultDays") VALUES (?, ?, 0, 0, ?, ?)',
        id, name, defaultKms || null, defaultDays || null
      );

      const category = await db.get('SELECT * FROM categories WHERE id = ?', id);
      res.status(201).json(category);
    } catch (error) {
      console.error('Error creating category:', error.message);
      res.status(500).json({ error: 'Failed to create category.' });
    }
  }
);

/**
 * PUT /:id - Update a category.
 */
router.put(
  '/:id',
  [body('name').trim().notEmpty().withMessage('Category name is required.')],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const db = getDb();
      const category = await db.get('SELECT * FROM categories WHERE id = ?', req.params.id);

      if (!category) {
        return res.status(404).json({ error: 'Category not found.' });
      }

      const { name, defaultKms, defaultDays } = req.body;

      // Check for duplicate name (excluding current category)
      const duplicate = await db.get(
        'SELECT id FROM categories WHERE LOWER(name) = LOWER(?) AND id != ?',
        name, req.params.id
      );
      if (duplicate) {
        return res.status(409).json({ error: 'A category with this name already exists.' });
      }

      await db.run(
        'UPDATE categories SET name = ?, "defaultKms" = ?, "defaultDays" = ? WHERE id = ?',
        name,
        defaultKms !== undefined ? (defaultKms || null) : category.defaultKms,
        defaultDays !== undefined ? (defaultDays || null) : category.defaultDays,
        req.params.id
      );

      const updated = await db.get('SELECT * FROM categories WHERE id = ?', req.params.id);
      res.json(updated);
    } catch (error) {
      console.error('Error updating category:', error.message);
      res.status(500).json({ error: 'Failed to update category.' });
    }
  }
);

/**
 * PUT /:id/archive - Toggle archive status of a category.
 */
router.put('/:id/archive', async (req, res) => {
  try {
    const db = getDb();
    const category = await db.get('SELECT * FROM categories WHERE id = ?', req.params.id);

    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    const newStatus = category.isArchived ? 0 : 1;
    await db.run(
      'UPDATE categories SET "isArchived" = ? WHERE id = ?',
      newStatus, req.params.id
    );

    const updated = await db.get('SELECT * FROM categories WHERE id = ?', req.params.id);
    res.json(updated);
  } catch (error) {
    console.error('Error toggling category archive:', error.message);
    res.status(500).json({ error: 'Failed to update category.' });
  }
});

/**
 * DELETE /:id - Delete a category if no service records reference it.
 */
router.delete('/:id', async (req, res) => {
  try {
    const db = getDb();
    const category = await db.get('SELECT * FROM categories WHERE id = ?', req.params.id);

    if (!category) {
      return res.status(404).json({ error: 'Category not found.' });
    }

    // Check if any service records reference this category
    const refCount = await db.get(
      'SELECT COUNT(*) as count FROM service_records WHERE "categoryId" = ?',
      req.params.id
    );

    if (refCount.count > 0) {
      return res.status(409).json({
        error: `Cannot delete category. ${refCount.count} service record(s) reference it. Archive it instead.`,
      });
    }

    await db.run('DELETE FROM categories WHERE id = ?', req.params.id);
    res.json({ message: 'Category deleted successfully.' });
  } catch (error) {
    console.error('Error deleting category:', error.message);
    res.status(500).json({ error: 'Failed to delete category.' });
  }
});

module.exports = router;
