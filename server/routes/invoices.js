const express = require('express');
const router = express.Router();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// ===============================
// GET ALL INVOICES (for index page)
// ===============================
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.id,
        i.invoice_no,
        i.receipt_no,
        i.invoice_date,
        i.grand_total,
        c.name AS customer_name
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      ORDER BY i.invoice_date DESC, i.id DESC
    `);

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'load invoices failed' });
  }
});

// ===============================
// GET NEXT INVOICE NUMBER (preview)
// ===============================
router.get('/next-number/iv', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT current_no
      FROM document_running
      WHERE doc_type = 'IV'
    `);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'IV running not found' });
    }

    const year = new Date().getFullYear().toString().slice(2);
    const running = result.rows[0].current_no.toString().padStart(3, '0');

    const invoiceNo = `IV${year}${running}`;

    res.json({ invoice_no: invoiceNo });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'load next invoice failed' });
  }
});

// ===============================
// GET SINGLE INVOICE (invoice.html)
// ===============================
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const invoice = await pool.query(`
      SELECT 
        i.*, 
        c.customer_code,
        c.name AS customer_name,
        c.address AS customer_address,
        c.tax_id AS customer_tax
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id
      WHERE i.id = $1
    `, [id]);

    if (invoice.rowCount === 0) {
      return res.status(404).json({ error: 'invoice not found' });
    }

    const items = await pool.query(`
      SELECT item_no, description, qty, unit_price, total
      FROM invoice_items
      WHERE invoice_id = $1
      ORDER BY item_no
    `, [id]);

    res.json({
      invoice: invoice.rows[0],
      items: items.rows
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'load invoice failed' });
  }
});

// ===============================
// CREATE INVOICE (IV + RE together)
// ===============================
router.post('/', async (req, res) => {
  const client = await pool.connect();

  try {
    const {
      customer_id,
      invoice_date,
      credit_days,
      due_date,
      note,
      totals,
      items
    } = req.body;

    await client.query('BEGIN');

    // 🔢 run invoice number
    const runIV = await client.query(`
      UPDATE document_running
      SET current_no = current_no + 1
      WHERE doc_type = 'IV'
      RETURNING current_no
    `);

    const runRE = await client.query(`
      UPDATE document_running
      SET current_no = current_no + 1
      WHERE doc_type = 'RE'
      RETURNING current_no
    `);

    const year = new Date().getFullYear().toString().slice(2);
    const invoiceNo = `IV${year}${runIV.rows[0].current_no}`;
    const receiptNo = `RE${year}${runRE.rows[0].current_no}`;

    // 🧾 insert invoice
    const invoiceResult = await client.query(`
      INSERT INTO invoices (
        invoice_no,
        receipt_no,
        customer_id,
        invoice_date,
        credit_days,
        due_date,
        note,
        total_amount,
        discount,
        after_discount,
        deposit,
        net_amount,
        vat_amount,
        grand_total
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      RETURNING id
    `, [
      invoiceNo,
      receiptNo,
      customer_id,
      invoice_date,
      credit_days,
      due_date,
      note,
      totals.total,
      totals.discount,
      totals.afterDiscount,
      totals.deposit,
      totals.net,
      totals.vat,
      totals.grand
    ]);

    const invoiceId = invoiceResult.rows[0].id;

    // 📦 insert items
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      await client.query(`
        INSERT INTO invoice_items (
          invoice_id,
          item_no,
          description,
          qty,
          unit_price,
          total
        ) VALUES ($1,$2,$3,$4,$5,$6)
      `, [
        invoiceId,
        i + 1,
        it.description,
        it.qty,
        it.unit_price,
        it.total
      ]);
    }

    await client.query('COMMIT');

    res.json({
      success: true,
      id: invoiceId,
      invoice_no: invoiceNo,
      receipt_no: receiptNo
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: 'create invoice failed' });
  } finally {
    client.release();
  }
});

module.exports = router;
