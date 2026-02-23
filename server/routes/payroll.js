const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});

/* ================= AUTH CHECK ================= */

function requireLogin(req, res, next) {
  if (!req.session.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden' });
  }
  next();
}

/* ================= GET ALL PERIODS ================= */

router.get('/periods', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT *
      FROM payroll_periods
      ORDER BY start_date DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('GET PERIODS ERROR:', err);
    res.status(500).json({ error: 'failed to fetch periods' });
  }
});

/* ================= CREATE PERIOD (ADMIN) ================= */

router.post('/period', requireAdmin, async (req, res) => {
  const { start_date, end_date } = req.body;

  if (!start_date || !end_date) {
    return res.status(400).json({ error: 'missing dates' });
  }

  try {
    // กันช่วงซ้อน
    const overlap = await pool.query(`
      SELECT id FROM payroll_periods
      WHERE ($1 <= end_date AND $2 >= start_date)
    `, [start_date, end_date]);

    if (overlap.rows.length) {
      return res.status(400).json({ error: 'period overlap' });
    }

    const result = await pool.query(`
      INSERT INTO payroll_periods (start_date, end_date, is_locked)
      VALUES ($1, $2, FALSE)
      RETURNING *
    `, [start_date, end_date]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error('CREATE PERIOD ERROR:', err);
    res.status(500).json({ error: 'failed to create period' });
  }
});

/* ================= GET STAFF ================= */

router.get('/staff', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, username
      FROM users
      WHERE role = 'staff'
      ORDER BY username ASC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error('GET STAFF ERROR:', err);
    res.status(500).json({ error: 'failed to fetch staff' });
  }
});

/* ================= GET PAYROLL ITEMS BY PERIOD ================= */

router.get('/:periodId', requireLogin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT pi.*, u.username
      FROM payroll_items pi
      JOIN users u ON u.id = pi.user_id
      WHERE pi.period_id = $1
      ORDER BY u.username
    `, [req.params.periodId]);

    res.json(result.rows);
  } catch (err) {
    console.error('GET PAYROLL ITEMS ERROR:', err);
    res.status(500).json({ error: 'failed to fetch payroll items' });
  }
});

/* ================= CALCULATION ================= */

function calculatePiece(piece_count, extraRate = 25) {
  if (piece_count <= 10) return piece_count * 380;
  if (piece_count <= 14) return piece_count * 420;

  const base = 14 * 420;
  const extra = (piece_count - 14) * extraRate;
  return base + extra;
}

/* ================= SAVE PAYROLL ITEM ================= */

router.post('/save', requireLogin, async (req, res) => {
  const {
    period_id,
    user_id,
    pay_type,
    daily_rate,
    work_days,
    piece_count,
    ot_hours,
    bonus,
    deduction,
    note
  } = req.body;

  try {
    // เช็ครอบล็อค
    const lockCheck = await pool.query(
      `SELECT is_locked FROM payroll_periods WHERE id = $1`,
      [period_id]
    );

    if (!lockCheck.rows.length) {
      return res.status(404).json({ error: 'period not found' });
    }

    if (lockCheck.rows[0].is_locked) {
      return res.status(400).json({ error: 'period locked' });
    }

    let wage = 0;

    if (pay_type === 'daily') {
      wage = (daily_rate || 0) * (work_days || 0);
    }

    if (pay_type === 'piece') {
      wage = calculatePiece(piece_count || 0);
    }

    const otTotal = (ot_hours || 0) * 60;

    const total =
      wage +
      otTotal +
      (bonus || 0) -
      (deduction || 0);

    const result = await pool.query(`
      INSERT INTO payroll_items
      (period_id, user_id, pay_type,
       daily_rate, work_days,
       piece_count, piece_total,
       ot_hours, ot_total,
       bonus, deduction,
       total, note)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
      RETURNING *
    `, [
      period_id,
      user_id,
      pay_type,
      daily_rate || null,
      work_days || null,
      piece_count || null,
      pay_type === 'piece' ? wage : null,
      ot_hours || 0,
      otTotal,
      bonus || 0,
      deduction || 0,
      total,
      note || null
    ]);

    res.json(result.rows[0]);

  } catch (err) {
    console.error('SAVE PAYROLL ERROR:', err);
    res.status(500).json({ error: 'failed to save payroll' });
  }
});

/* ================= LOCK PERIOD (ADMIN) ================= */

router.put('/lock/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`
      UPDATE payroll_periods
      SET is_locked = TRUE,
          locked_at = NOW(),
          locked_by = $2
      WHERE id = $1
    `, [req.params.id, req.session.user.id]);

    res.json({ message: 'period locked' });
  } catch (err) {
    console.error('LOCK ERROR:', err);
    res.status(500).json({ error: 'failed to lock period' });
  }
});

/* ================= UNLOCK PERIOD (ADMIN) ================= */

router.put('/unlock/:id', requireAdmin, async (req, res) => {
  try {
    await pool.query(`
      UPDATE payroll_periods
      SET is_locked = FALSE,
          locked_at = NULL,
          locked_by = NULL
      WHERE id = $1
    `, [req.params.id]);

    res.json({ message: 'period unlocked' });
  } catch (err) {
    console.error('UNLOCK ERROR:', err);
    res.status(500).json({ error: 'failed to unlock period' });
  }
});

module.exports = router;
