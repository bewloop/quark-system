const express = require('express');
const router = express.Router();
const db = require('../../db');

// ✅ บันทึก
router.post('/', (req, res) => {

  const {
    period,
    start_date,
    end_date,
    name,
    position,
    base_salary,
    work_days,
    job_count,
    ot_pay,
    bonus,
    deduct,
    total
  } = req.body;

  db.run(
    `INSERT INTO payroll
     (period, start_date, end_date, name, position,
      base_salary, work_days, job_count,
      ot_pay, bonus, deduct, total)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      period,
      start_date,
      end_date,
      name,
      position,
      base_salary,
      work_days,
      job_count,
      ot_pay,
      bonus,
      deduct,
      total
    ],
    function(err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'save failed' });
      }
      res.json({ success: true });
    }
  );
});

// ✅ ดูตามเดือน
router.get('/', (req, res) => {

  const { period } = req.query;

  db.all(
    `SELECT * FROM payroll
     WHERE period = ?
     ORDER BY created_at DESC`,
    [period],
    (err, rows) => {
      if (err) return res.status(500).json({ error: 'fetch failed' });
      res.json(rows);
    }
  );
});

module.exports = router;
