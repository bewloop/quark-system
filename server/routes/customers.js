const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

// ใช้ pool ตัวเดียวกับระบบเดิม (ปรับตามไฟล์หลักของคุณได้)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===============================
// GET ALL CUSTOMERS
// ===============================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, customer_code, name, address, tax_id
      FROM customers
      ORDER BY customer_code
    `);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'load customers failed' });
  }
});

// ===============================
// CREATE CUSTOMER
// ===============================
router.post('/', async (req, res) => {
  const { customer_code, name, address, tax_id } = req.body;

  if (!customer_code || !name) {
    return res.status(400).json({ error: 'customer_code and name required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers (customer_code, name, address, tax_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [customer_code, name, address, tax_id]
    );

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'duplicate customer_code' });
    }
    console.error(err);
    res.status(500).json({ error: 'create customer failed' });
  }
});

// ===============================
// UPDATE CUSTOMER
// ===============================
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { customer_code, name, address, tax_id } = req.body;

  try {
    const result = await pool.query(
      `UPDATE customers
       SET customer_code = $1,
           name = $2,
           address = $3,
           tax_id = $4
       WHERE id = $5
       RETURNING *`,
      [customer_code, name, address, tax_id, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'customer not found' });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ error: 'duplicate customer_code' });
    }
    console.error(err);
    res.status(500).json({ error: 'update customer failed' });
  }
});

// ===============================
// DELETE CUSTOMER
// ===============================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM customers WHERE id = $1',
      [id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'customer not found' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'delete customer failed' });
  }
});

module.exports = router;