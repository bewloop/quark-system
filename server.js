const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');
const customerRoutes = require('./server/routes/customers');
const invoiceRoutes = require('./server/routes/invoices');
const payrollRoutes = require('./server/routes/payroll');


const app = express();
const PORT = process.env.PORT || 8080;

/* ================= DATABASE ================= */

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://localhost/quark',
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      order_no TEXT UNIQUE,
      order_date DATE NOT NULL,
      car_model TEXT,
      car_year TEXT,
      mat_type TEXT,
      mat_color TEXT,
      mat_qty INTEGER,
      channel TEXT,
      customer TEXT,
      payment_status TEXT DEFAULT 'จ่ายแล้ว',
      note TEXT,
      production_status TEXT DEFAULT 'สั่งงาน',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS order_status_log (
      id SERIAL PRIMARY KEY,
      order_id INTEGER REFERENCES orders(id),
      status TEXT,
      user_id INTEGER REFERENCES users(id),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock (
      id SERIAL PRIMARY KEY,
      car_model TEXT,
      car_year TEXT,
      mat_type TEXT,
      mat_color TEXT,
      mat_qty INTEGER,
      note TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await pool.query(`
  ALTER TABLE stock
  ADD COLUMN IF NOT EXISTS stock_out_date TIMESTAMP
`);

   await pool.query(`
  ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS set_type TEXT
`);

  await pool.query(`
    INSERT INTO users (username, password, role)
    VALUES ('admin', 'admin123', 'admin')
    ON CONFLICT (username) DO NOTHING
  `);

  console.log('✅ DB initialized');
}


/* ================= BASIC ================= */

app.set('trust proxy', 1);

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use('/api/customers', customerRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/payroll', payrollRoutes);

app.use(session({
  secret: process.env.SESSION_SECRET || 'quark-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 22 * 60 * 60 * 1000
  }
}));

app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login.html');
  }
  res.redirect('/index.html');
});

app.use(express.static('public'));


/* ================= AUTH ================= */

function auth(requiredRoles = []) {
  return (req, res, next) => {
    if (!req.session.user) {
      if (req.path.startsWith('/api')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      return res.redirect('/login.html');
    }

    if (
      requiredRoles.length &&
      !requiredRoles.includes(req.session.user.role)
    ) {
      if (req.path.startsWith('/api')) {
        return res.status(403).json({ error: 'forbidden' });
      }
      return res.status(403).send('ไม่มีสิทธิ์เข้าใช้งาน');
    }

    next();
  };
}

/* ================= LOGIN ================= */

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  const r = await pool.query(
    'select * from users where username=$1 and password=$2',
    [username, password]
  );

  if (!r.rows.length) {
    return res.status(401).json({ error: 'invalid' });
  }

  req.session.user = {
    id: r.rows[0].id,
    username: r.rows[0].username,
    role: r.rows[0].role
  };

  res.json({ ok: true, role: r.rows[0].role });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  res.json(req.session.user);
});

/* ================= ORDERS ================= */

app.post('/api/orders', auth(['admin', 'quarkmgr']), async (req, res) => {
  const o = req.body;
  const year = new Date().getFullYear();

  const last = await pool.query(`
    SELECT order_no
    FROM orders
    WHERE order_no LIKE $1
    ORDER BY order_no DESC
    LIMIT 1
  `, [`QK-${year}%`]);

  let nextRun = 1;
  if (last.rows.length) {
    nextRun = parseInt(last.rows[0].order_no.slice(-4)) + 1;
  }

  const orderNo = `QK-${year}${String(nextRun).padStart(4, '0')}`;

 const r = await pool.query(`
  INSERT INTO orders (
    order_no,
    order_date,
    car_model,
    car_year,
    mat_type,
    mat_color,
    mat_qty,
    channel,
    customer,
    payment_status,
    note,
    production_status,
    set_type
  )
  VALUES (
    $1,
    CURRENT_DATE,
    $2,$3,$4,$5,$6,$7,$8,$9,$10,
    'สั่งงาน',
    $11
  )
  RETURNING id, order_no
`, [
  orderNo,
  o.car_model,
  o.car_year,
  o.mat_type,
  o.mat_color,
  o.mat_qty,
  o.channel,
  o.customer,
  o.payment_status,
  o.note,
  o.set_type   // 🔥 เพิ่มบรรทัดนี้
]);

  res.json({ ok: true, id: r.rows[0].id, order_no: r.rows[0].order_no });
});

app.get('/api/orders', auth(['admin', 'quarkmgr']), async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const offset = (page - 1) * limit;

  // จำนวนทั้งหมด
  const countResult = await pool.query(
    'SELECT COUNT(*) FROM orders'
  );
  const total = parseInt(countResult.rows[0].count);
  const totalPages = Math.ceil(total / limit);

  // ดึงเฉพาะหน้าที่ต้องการ
  const result = await pool.query(
    `
    SELECT *
    FROM orders
    ORDER BY id DESC
    LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  res.json({
    orders: result.rows,
    totalPages
  });
});


app.get('/api/orders/:id', auth(), async (req, res) => {
  const r = await pool.query(
    'select * from orders where id=$1',
    [req.params.id]
  );
  res.json(r.rows[0]);
});

/* 🔥 UPDATE ORDER (ตัวแก้ปัญหาบันทึกไม่สำเร็จ) */
app.put('/api/orders/:id', auth(['admin','quarkmgr']), async (req, res) => {
  try {
    const o = req.body;

    await pool.query(`
  UPDATE orders SET
    channel = $1,
    customer = $2,
    car_model = $3,
    car_year = $4,
    mat_color = $5,
    mat_type = $6,
    mat_qty = $7,
    payment_status = $8,
    note = $9,
    set_type = $10
  WHERE id = $11
`, [
  o.channel,
  o.customer,
  o.car_model,
  o.car_year,
  o.mat_color,
  o.mat_type,
  o.mat_qty,
  o.payment_status,
  o.note,
  o.set_type,
  req.params.id
]);

    res.json({ ok: true });
  } catch (err) {
    console.error('UPDATE ORDER ERROR:', err);
    res.status(500).json({ error: 'update failed' });
  }
});


/* ================= DELETE ================= */


app.delete('/api/orders', auth(['admin']), async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || !ids.length) {
      return res.status(400).json({ error: 'no ids' });
    }

    const intIds = ids.map(Number);

    // 🔥 ลบ log ก่อน
    await pool.query(
      'DELETE FROM order_status_log WHERE order_id = ANY($1::int[])',
      [intIds]
    );

    // 🔥 ค่อยลบ order
    await pool.query(
      'DELETE FROM orders WHERE id = ANY($1::int[])',
      [intIds]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE ORDER ERROR:', err);
    res.status(500).json({ error: 'delete failed' });
  }
});


/* ================= STATUS ================= */

const PRODUCTION_STATUS = [
  'สั่งงาน',
  'ตัด',
  'ประกบ',
  'กุ๊น',
  'QC',
  'ส่งออก',
  'เข้าสต็อก',
  'ยกเลิก'
];


app.put(
  '/api/orders/:id/production-status',
  auth(['admin','quarkmgr']),
  async (req, res) => {

    const { id } = req.params;
    const { production_status } = req.body;

    if (!PRODUCTION_STATUS.includes(production_status)) {
      return res.status(400).json({ error: 'invalid production status' });
    }

    await pool.query(
      'UPDATE orders SET production_status=$1 WHERE id=$2',
      [production_status, id]
    );

    await pool.query(
      'INSERT INTO order_status_log (order_id, status, user_id) VALUES ($1,$2,$3)',
      [id, production_status, req.session.user.id]
    );

    res.json({ ok: true });
  }
);

/* ================= STOCK ================= */

app.get('/api/stock', auth(['admin','quarkmgr']), async (req, res) => {
  const r = await pool.query('select * from stock order by id desc');
  res.json(r.rows);
});

app.post('/api/stock', auth(['admin','quarkmgr']), async (req, res) => {
  const s = req.body;
  await pool.query(`
    insert into stock
    (car_model, car_year, mat_type, mat_color, mat_qty, note)
    values ($1,$2,$3,$4,$5,$6)
  `, [
    s.car_model,
    s.car_year,
    s.mat_type,
    s.mat_color,
    s.mat_qty,
    s.note
  ]);
  res.json({ ok: true });
});

app.patch('/api/stock/:id/out', auth(['admin','quarkmgr']), async (req, res) => {
  const { id } = req.params;

  await pool.query(
    'UPDATE stock SET stock_out_date = NOW() WHERE id = $1',
    [id]
  );

  res.json({ ok: true });
});

app.delete('/api/stock/:id', auth(['admin']), async (req, res) => {
  const { id } = req.params;

  await pool.query(
    'DELETE FROM stock WHERE id = $1',
    [id]
  );

  res.json({ ok: true });
});


/* ================= PERFORMANCE (ADMIN ONLY) ================= */

app.get('/api/admin/performance-summary', auth(['admin']), async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'missing date range' });
  }

  const r = await pool.query(`
    SELECT
      u.username AS staff,
      COUNT(*) FILTER (WHERE l.status = 'ตัด') AS cut,
      COUNT(*) FILTER (WHERE l.status = 'ประกบ') AS assemble,
      COUNT(*) FILTER (WHERE l.status = 'กุ๊น') AS sew,
      COUNT(*) FILTER (WHERE l.status = 'QC') AS qc
    FROM order_status_log l
    JOIN users u ON u.id = l.user_id
    WHERE l.created_at::date BETWEEN $1 AND $2
    GROUP BY u.username
    ORDER BY u.username
  `, [from, to]);

  res.json(r.rows);
});

app.get('/api/admin/performance-detail', auth(['admin']), async (req, res) => {
  const { from, to } = req.query;

  if (!from || !to) {
    return res.status(400).json({ error: 'missing date range' });
  }

  const r = await pool.query(`
    SELECT
      u.username,
      o.id AS order_id,
      o.order_no,
      o.car_model,
      o.car_year,
      l.status,
      l.created_at
    FROM order_status_log l
    JOIN users u ON u.id = l.user_id
    JOIN orders o ON o.id = l.order_id
    WHERE l.created_at::date BETWEEN $1 AND $2
    ORDER BY l.created_at DESC
  `, [from, to]);

  res.json(r.rows);
});


/* ================= USERS ================= */

app.get('/api/users', auth(['admin']), async (req, res) => {
  const r = await pool.query('select id,username,role from users');
  res.json(r.rows);
});

app.post('/api/users', auth(['admin']), async (req, res) => {
  const u = req.body;
  await pool.query(
    'insert into users (username,password,role) values ($1,$2,$3)',
    [u.username, u.password, u.role]
  );
  res.json({ ok: true });
});

// ลบผู้ใช้ (admin เท่านั้น)
app.delete('/api/users/:id', auth(['admin']), async (req, res) => {
  try {
    const { id } = req.params;

    // ป้องกันลบตัวเอง
    if (req.session.user.id == id) {
      return res.status(400).json({ error: 'cannot delete yourself' });
    }

    await pool.query(
      'DELETE FROM users WHERE id = $1',
      [id]
    );

    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE USER ERROR:', err);
    res.status(500).json({ error: 'delete failed' });
  }
});



/* ================= START ================= */

app.listen(PORT, async () => {
  await initDB();
  console.log('🚀 QUARK running on', PORT);
});
