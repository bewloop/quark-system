-- ===============================
-- CUSTOMERS
-- ===============================
CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  customer_code VARCHAR(10) UNIQUE NOT NULL,
  name TEXT NOT NULL,
  address TEXT,
  tax_id VARCHAR(20),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===============================
-- INVOICES
-- ===============================
CREATE TABLE IF NOT EXISTS invoices (
  id SERIAL PRIMARY KEY,
  invoice_no VARCHAR(20) UNIQUE NOT NULL,
  customer_id INTEGER REFERENCES customers(id),
  invoice_date DATE NOT NULL,
  credit_days INTEGER DEFAULT 0,
  due_date DATE NOT NULL,
  note TEXT,

  total_amount NUMERIC(12,2),
  discount NUMERIC(12,2),
  after_discount NUMERIC(12,2),
  deposit NUMERIC(12,2),
  net_amount NUMERIC(12,2),
  vat_amount NUMERIC(12,2),
  grand_total NUMERIC(12,2),

  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ===============================
-- INVOICE ITEMS
-- ===============================
CREATE TABLE IF NOT EXISTS invoice_items (
  id SERIAL PRIMARY KEY,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  item_no INTEGER,
  description TEXT,
  qty NUMERIC(10,2),
  unit_price NUMERIC(10,2),
  total NUMERIC(12,2)
);
