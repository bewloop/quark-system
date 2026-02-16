const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production'
    ? { rejectUnauthorized: false }
    : false
});


// =============================
// GET ALL PERIODS
// =============================
router.get('/periods', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM payroll_periods
       ORDER BY start_date DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch periods' });
  }
});


// =============================
// CREATE PERIOD
// =============================
router.post('/period', async (req, res) => {
  const { start_date, end_date } = req.body;

  try {
    const result = await pool.query(
      `INSERT INTO payroll_periods (start_date, end_date)
       VALUES ($1, $2)
       RETURNING *`,
      [start_date, end_date]
    );

    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create period' });
  }
});


// =============================
// GET STAFF
// =============================
router.get('/staff', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, username
       FROM users
       WHERE role = 'staff'
       ORDER BY username ASC`
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch staff' });
  }
});


// =============================
// CALCULATE PIECE LOGIC
// =============================
function calculatePiece(piece_count, extraRate = 25) {
  let total = 0;

  if (piece_count <= 10) {
    total = piece_count * 380;
  } else if (piece_count <= 14) {
    total = piece_count * 420;
  } else {
    const base = 14 * 420;
    const extra = (piece_count - 14) * extraRate;
    total = base + extra;
  }

  return total;
}


// =============================
// SAVE PAYROLL
// =============================
router.post('/save', async (req, res) => {
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

    // เช็คว่ารอบล็อคไหม
    const lockCheck = await pool.query(
      `SELECT is_locked FROM payroll_periods WHERE id = $1`,
      [period_id]
    );

    if (lockCheck.rows[0].is_locked) {
      return res.status(400).json({ error: 'Period is locked' });
    }

    let wage = 0;

    if (pay_type === 'daily') {
      wage = (daily_rate || 0) * (work_days || 0);
    }

    if (pay_type === 'piece') {
      wage = calculatePiece(piece_count || 0, 25);
    }

    const otTotal = (ot_hours || 0) * 60;
    const total =
      wage +
      otTotal +
      (bonus || 0) -
      (deduction || 0);

    const result = await pool.query(
      `INSERT INTO payroll_items
       (period_id, user_id, pay_type,
        daily_rate, work_days,
        piece_count, piece_total,
        ot_hours, ot_total,
        bonus, deduction,
        total, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING *`,
      [
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
      ]
    );

    res.json(result.rows[0]);

  } catch (err) {
    console
