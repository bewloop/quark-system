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
      order_date DATE NOT NULL,
      car_model TEXT,
      car_year TEXT,
      mat_type TEXT,
      mat_color TEXT,
      mat_qty INTEGER,
      channel TEXT,
      customer TEXT,
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

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true })); // ⭐ เพิ่ม
app.use(express.static('public'));

app.use(session({
  secret: 'quark-secret',
  resave: false,
  saveUninitialized: false
}));

/* ================= AUTH ================= */

function auth(requiredRoles = []) {
  return (req, res, next) => {
    if (!req.session.user) {
      // ⭐ ถ้าเป็น API → JSON
      if (req.path.startsWith('/api')) {
        return res.status(401).json({ error: 'unauthorized' });
      }
      // ⭐ ถ้าเป็นหน้าเว็บ → redirect
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

/* ================= ORDERS ================= */

app.post('/api/orders', auth(['admin', 'quarkmgr']), async (req, res) => {
  const o = req.body;

  const r = await pool.query(`
    insert into orders
    (order_date, car_model, car_year, mat_type, mat_color, mat_qty, channel, customer, note, status)
    values
    (current_date,$1,$2,$3,$4,$5,$6,$7,$8,'ตัด')
    returning id
  `, [
    o.car_model,
    o.car_year,
    o.mat_type,
    o.mat_color,
    o.mat_qty,
    o.channel,
    o.customer,
    o.note
  ]);

  res.json({ id: r.rows[0].id });
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
    insert into order_status_log
    (order_id, status, user_id)
    values ($1,$2,$3)
  `, [req.params.id, status, user.id]);

  if (status === 'ยกเลิก') {
    const o = await pool.query(
      'select * from orders where id=$1',
      [req.params.id]
    );

    await pool.query(`
      insert into stock
      (car_model, car_year, mat_type, mat_color, mat_qty, note)
      values ($1,$2,$3,$4,$5,$6)
    `, [
      o.rows[0].car_model,
      o.rows[0].car_year,
      o.rows[0].mat_type,
      o.rows[0].mat_color,
      o.rows[0].mat_qty,
      'ยกเลิกจากออเดอร์ #' + req.params.id
    ]);
  }

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

// update user
app.put('/api/users/:id', auth(['admin']), async (req, res) => {
  const { password, role } = req.body;

  if (!password && !role) {
    return res.status(400).json({ error: 'nothing to update' });
  }

  if (password && role) {
    await pool.query(
      'update users set password=$1, role=$2 where id=$3',
      [password, role, req.params.id]
    );
  } else if (password) {
    await pool.query(
      'update users set password=$1 where id=$2',
      [password, req.params.id]
    );
  } else if (role) {
    await pool.query(
      'update users set role=$1 where id=$2',
      [role, req.params.id]
    );
  }

  res.json({ ok: true });
});

// delete user
app.delete('/api/users/:id', auth(['admin']), async (req, res) => {
  // กันลบ admin ตัวเอง
  if (req.session.user.id == req.params.id) {
    return res.status(400).json({ error: 'cannot delete yourself' });
  }

  await pool.query('delete from users where id=$1', [req.params.id]);
  res.json({ ok: true });
});


/* ================= START ================= */

app.listen(PORT, async () => {
  await initDB();
  console.log('QUARK running on', PORT);
});
