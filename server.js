const express = require('express');
const bodyParser = require('body-parser');
const session = require('express-session');
const { Pool } = require('pg');
const path = require('path');

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
      status TEXT,
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
app.use(express.static('public'));

app.use(session({
  secret: process.env.SESSION_SECRET || 'quark-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    sameSite: 'none',
    maxAge: 1000 * 60 * 60 * 8
  }
}));

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
    INSERT INTO orders
    (order_no, order_date, car_model, car_year, mat_type, mat_color, mat_qty, channel, customer, payment_status, note, status)
    VALUES
    ($1, current_date, $2,$3,$4,$5,$6,$7,$8,$9,$10,'ตัด')
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
    o.note
  ]);

  res.json({ ok: true, id: r.rows[0].id, order_no: r.rows[0].order_no });
});

app.get('/api/orders', auth(['admin', 'quarkmgr']), async (req, res) => {
  const r = await pool.query('select * from orders order by id desc');
  res.json(r.rows);
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
        order_date = $1,
        channel = $2,
        customer = $3,
        car_model = $4,
        car_year = $5,
        mat_color = $6,
        mat_type = $7,
        mat_qty = $8,
        payment_status = $9,
        note = $10
      WHERE id = $11
    `, [
      o.order_date,
      o.channel,
      o.customer,
      o.car_model,
      o.car_year,
      o.mat_color,
      o.mat_type,
      o.mat_qty,
      o.payment_status,
      o.note,
      req.params.id
    ]);

    res.json({ ok: true });
  } catch (err) {
    console.error('UPDATE ORDER ERROR:', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/* ================= STATUS ================= */

const STATUS_FLOW = ['ตัด','ประกบ','กุ๊น','QC','ส่งออก','ยกเลิก'];

app.put('/api/orders/:id/status', auth(), async (req, res) => {
  const { status } = req.body;
  const user = req.session.user;

  const r = await pool.query(
    'select status from orders where id=$1',
    [req.params.id]
  );

  const current = r.rows[0].status;

  if (
    STATUS_FLOW.indexOf(status) !== STATUS_FLOW.indexOf(current) + 1 &&
    status !== 'ยกเลิก'
  ) {
    return res.status(400).json({ error: 'invalid status flow' });
  }

  await pool.query(
    'update orders set status=$1 where id=$2',
    [status, req.params.id]
  );

  await pool.query(`
    insert into order_status_log (order_id, status, user_id)
    values ($1,$2,$3)
  `, [req.params.id, status, user.id]);

  res.json({ ok: true });
});

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

/* ================= PERFORMANCE (ADMIN ONLY) ================= */

app.get('/api/admin/performance', auth(['admin']), async (req, res) => {
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

/* ================= START ================= */

app.listen(PORT, async () => {
  await initDB();
  console.log('🚀 QUARK running on', PORT);
});
