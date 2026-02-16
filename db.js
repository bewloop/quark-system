const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./quark.db');

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_no TEXT,
      order_date TEXT,
      car_model TEXT,
      car_year TEXT,
      mat_type TEXT,
      mat_color TEXT,
      mat_qty INTEGER,
      channel TEXT,
      customer TEXT,
      note TEXT,
      status TEXT DEFAULT 'ตัด'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS order_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      status TEXT,
      user TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS stock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      car_model TEXT,
      car_year TEXT,
      mat_type TEXT,
      mat_color TEXT,
      mat_qty INTEGER,
      note TEXT
    )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS payroll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period TEXT,            -- เช่น 2026-02
    start_date TEXT,
    end_date TEXT,
    name TEXT,
    position TEXT,
    base_salary REAL,
    work_days INTEGER,
    job_count INTEGER,
    ot_pay REAL,
    bonus REAL,
    deduct REAL,
    total REAL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )
`);


});

module.exports = db;
