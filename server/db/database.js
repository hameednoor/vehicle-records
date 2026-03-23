/**
 * Database abstraction layer.
 *
 * Supports two backends selected via the DATABASE_URL env var:
 *   - PostgreSQL (pg Pool)       when DATABASE_URL is set
 *   - SQLite (better-sqlite3 or sql.js fallback) when it is not
 *
 * Exports a unified async interface so all consumers work identically
 * regardless of the engine:
 *
 *   db.run(sql, params)          - execute a write statement
 *   db.get(sql, params)          - return the first matching row or undefined
 *   db.all(sql, params)          - return an array of rows
 *   db.query(sql, params)        - return { rows } (alias used by pg style code)
 *   db.transaction(fn)           - run fn inside a transaction
 *   db.exec(sql)                 - execute raw SQL (DDL etc.)
 *
 * All methods accept `?` parameter placeholders which are automatically
 * converted to `$1, $2, ...` when running against PostgreSQL.
 */

const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'vehicle-tracker.db');

const isPostgres = !!process.env.DATABASE_URL;

let db; // Unified wrapper object

function getDb() {
  if (!db) {
    throw new Error('Database not initialized. Call initDb() first.');
  }
  return db;
}

// ---------------------------------------------------------------------------
// Placeholder conversion  ? -> $1, $2, ...
// ---------------------------------------------------------------------------

function convertPlaceholders(sql) {
  if (!isPostgres) return sql;
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

/**
 * Normalise parameter values before they reach the driver.
 * - undefined -> null  (pg throws on undefined)
 */
function normaliseParams(params) {
  if (!params || params.length === 0) return [];
  return params.map((p) => (p === undefined ? null : p));
}

// ---------------------------------------------------------------------------
// SQL dialect helpers
// ---------------------------------------------------------------------------

/**
 * Return an expression for "current timestamp" suitable for embedding in SQL.
 * For PG we use NOW(); for SQLite we use datetime('now').
 */
function nowExpr() {
  return isPostgres ? 'NOW()' : "datetime('now')";
}

/**
 * Convert `INSERT OR REPLACE` (SQLite syntax) to
 * `INSERT ... ON CONFLICT ... DO UPDATE` for PostgreSQL.
 *
 * This is a best-effort helper used by the import route.  It expects the
 * SQL to start with "INSERT OR REPLACE INTO <table> (" and the first column
 * to be the primary key.
 */
function upsertSql(sql) {
  if (!isPostgres) return sql;

  // Replace INSERT OR REPLACE with INSERT
  let pgSql = sql.replace(/INSERT\s+OR\s+REPLACE\s+INTO/i, 'INSERT INTO');

  // Extract table name
  const tableMatch = pgSql.match(/INSERT\s+INTO\s+(\w+)\s*\(/i);
  if (!tableMatch) return pgSql;

  // Extract column list
  const colStart = pgSql.indexOf('(') + 1;
  const colEnd = pgSql.indexOf(')');
  const columns = pgSql
    .substring(colStart, colEnd)
    .split(',')
    .map((c) => c.trim());

  const pk = columns[0]; // first column is always the PK in our schema
  const updateCols = columns
    .slice(1)
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(', ');

  pgSql += ` ON CONFLICT (${pk}) DO UPDATE SET ${updateCols}`;
  return pgSql;
}

/**
 * Convert `INSERT OR IGNORE` (SQLite syntax) to
 * `INSERT ... ON CONFLICT ... DO NOTHING` for PostgreSQL.
 *
 * Used by the import route to skip existing records without overwriting.
 */
function insertIgnoreSql(sql) {
  if (!isPostgres) return sql;

  let pgSql = sql.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO');

  const tableMatch = pgSql.match(/INSERT\s+INTO\s+(\w+)\s*\(/i);
  if (!tableMatch) return pgSql;

  const colStart = pgSql.indexOf('(') + 1;
  const colEnd = pgSql.indexOf(')');
  const columns = pgSql
    .substring(colStart, colEnd)
    .split(',')
    .map((c) => c.trim());

  const pk = columns[0];
  pgSql += ` ON CONFLICT (${pk}) DO NOTHING`;
  return pgSql;
}

/**
 * Return the function name for extracting 'YYYY-MM' from a date column.
 * SQLite:  strftime('%Y-%m', col)
 * PG:      to_char(col::date, 'YYYY-MM')
 */
function monthExtract(column) {
  return isPostgres
    ? `to_char(${column}::date, 'YYYY-MM')`
    : `strftime('%Y-%m', ${column})`;
}

// ---------------------------------------------------------------------------
// PostgreSQL wrapper
// ---------------------------------------------------------------------------

function createPgWrapper(pool) {
  return {
    async run(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await pool.query(pgSql, normaliseParams(flat));
      return { changes: result.rowCount };
    },

    async get(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await pool.query(pgSql, normaliseParams(flat));
      return result.rows[0] || undefined;
    },

    async all(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await pool.query(pgSql, normaliseParams(flat));
      return result.rows;
    },

    async query(sql, params) {
      const pgSql = convertPlaceholders(sql);
      const result = await pool.query(pgSql, normaliseParams(params || []));
      return result;
    },

    async exec(sql) {
      await pool.query(sql);
    },

    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const wrappedClient = createPgClientWrapper(client);
        const result = await fn(wrappedClient);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },

    nowExpr,
    monthExtract,
    upsertSql,
    insertIgnoreSql,
    isPostgres: true,
  };
}

/**
 * Wrapper around a single pg client (used inside transactions).
 */
function createPgClientWrapper(client) {
  return {
    async run(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await client.query(pgSql, normaliseParams(flat));
      return { changes: result.rowCount };
    },
    async get(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await client.query(pgSql, normaliseParams(flat));
      return result.rows[0] || undefined;
    },
    async all(sql, ...params) {
      const flat = flattenParams(params);
      const pgSql = convertPlaceholders(sql);
      const result = await client.query(pgSql, normaliseParams(flat));
      return result.rows;
    },
  };
}

// ---------------------------------------------------------------------------
// SQLite wrapper (mirrors the async interface above but synchronous under
// the hood, wrapped in resolved promises so callers can always use await)
// ---------------------------------------------------------------------------

function createSqliteWrapper(rawDb) {
  const wrapper = {
    async run(sql, ...params) {
      const flat = flattenParams(params);
      return rawDb.prepare(sql).run(...flat);
    },

    async get(sql, ...params) {
      const flat = flattenParams(params);
      return rawDb.prepare(sql).get(...flat);
    },

    async all(sql, ...params) {
      const flat = flattenParams(params);
      return rawDb.prepare(sql).all(...flat);
    },

    async query(sql, params) {
      const rows = rawDb.prepare(sql).all(...(params || []));
      return { rows };
    },

    async exec(sql) {
      rawDb.exec(sql);
    },

    async transaction(fn) {
      // better-sqlite3's transaction() is synchronous, but our fn is async.
      // We manually handle BEGIN/COMMIT/ROLLBACK to support async callbacks.
      rawDb.exec('BEGIN TRANSACTION');
      try {
        const result = await fn(wrapper);
        rawDb.exec('COMMIT');
        return result;
      } catch (e) {
        rawDb.exec('ROLLBACK');
        throw e;
      }
    },

    nowExpr,
    monthExtract,
    upsertSql,
    insertIgnoreSql,
    isPostgres: false,

    // Expose for scheduler compatibility (it was receiving the raw db before)
    _raw: rawDb,
  };
  return wrapper;
}

// ---------------------------------------------------------------------------
// sql.js (pure JS) wrapper -> mirrors better-sqlite3 synchronous API,
// then is wrapped by createSqliteWrapper above.
// ---------------------------------------------------------------------------

function createSqlJsRawWrapper(sqliteDb) {
  function save() {
    const data = sqliteDb.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_PATH, buffer);
  }

  let dirty = false;
  const saveInterval = setInterval(() => {
    if (dirty) {
      try {
        save();
        dirty = false;
      } catch (e) {
        console.error('Auto-save failed:', e.message);
      }
    }
  }, 5000);
  if (saveInterval.unref) saveInterval.unref();

  function markDirty() {
    dirty = true;
  }

  function flattenSqlJsParams(params) {
    if (params.length === 0) return [];
    if (params.length === 1 && Array.isArray(params[0])) return params[0];
    return params;
  }

  function prepare(sql) {
    return {
      run(...params) {
        const flat = flattenSqlJsParams(params);
        sqliteDb.run(sql, flat);
        markDirty();
        return { changes: sqliteDb.getRowsModified() };
      },
      get(...params) {
        const flat = flattenSqlJsParams(params);
        const stmt = sqliteDb.prepare(sql);
        if (flat.length > 0) stmt.bind(flat);
        if (stmt.step()) {
          const row = stmt.getAsObject();
          stmt.free();
          return row;
        }
        stmt.free();
        return undefined;
      },
      all(...params) {
        const flat = flattenSqlJsParams(params);
        const results = [];
        const stmt = sqliteDb.prepare(sql);
        if (flat.length > 0) stmt.bind(flat);
        while (stmt.step()) {
          results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
      },
    };
  }

  function exec(sql) {
    sqliteDb.exec(sql);
    markDirty();
  }

  function pragma(pragmaStr) {
    try {
      sqliteDb.exec(`PRAGMA ${pragmaStr};`);
    } catch (_) {
      // WAL mode not supported by sql.js in-memory; ignore silently
    }
  }

  function transaction(fn) {
    return (...args) => {
      exec('BEGIN TRANSACTION');
      try {
        const result = fn(...args);
        exec('COMMIT');
        return result;
      } catch (e) {
        exec('ROLLBACK');
        throw e;
      }
    };
  }

  function close() {
    save();
    clearInterval(saveInterval);
    sqliteDb.close();
  }

  return { prepare, exec, pragma, transaction, close, save };
}

// ---------------------------------------------------------------------------
// Flatten params helper (shared)
// ---------------------------------------------------------------------------

function flattenParams(params) {
  if (!params || params.length === 0) return [];
  if (params.length === 1 && Array.isArray(params[0])) return params[0];
  return params;
}

// ---------------------------------------------------------------------------
// Table creation DDL
// ---------------------------------------------------------------------------

function getCreateTablesSql() {
  if (isPostgres) {
    return `
      CREATE TABLE IF NOT EXISTS vehicles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        make TEXT,
        model TEXT,
        year INTEGER,
        type TEXT DEFAULT 'car',
        plate TEXT,
        vin TEXT,
        "currentKms" REAL DEFAULT 0,
        photo TEXT,
        notes TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS categories (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        "isDefault" INTEGER DEFAULT 0,
        "isArchived" INTEGER DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS service_records (
        id TEXT PRIMARY KEY,
        "vehicleId" TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        "categoryId" TEXT NOT NULL REFERENCES categories(id),
        date TEXT NOT NULL,
        "kmsAtService" REAL,
        cost REAL DEFAULT 0,
        currency TEXT DEFAULT 'AED',
        provider TEXT,
        notes TEXT,
        "nextDueKms" REAL,
        "nextDueDays" INTEGER,
        "nextDueDate" TEXT,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        "serviceRecordId" TEXT NOT NULL REFERENCES service_records(id) ON DELETE CASCADE,
        "filePath" TEXT NOT NULL,
        "originalName" TEXT,
        "fileType" TEXT,
        "ocrText" TEXT,
        "ocrProcessed" INTEGER DEFAULT 0,
        "uploadedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS reminder_configs (
        id TEXT PRIMARY KEY,
        "vehicleId" TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        channel TEXT DEFAULT 'email',
        frequency TEXT DEFAULT 'once',
        recipients TEXT DEFAULT '[]',
        "isActive" INTEGER DEFAULT 1,
        "createdAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS km_logs (
        id TEXT PRIMARY KEY,
        "vehicleId" TEXT NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        kms REAL NOT NULL,
        "loggedAt" TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        currency TEXT DEFAULT 'AED',
        timezone TEXT DEFAULT 'Asia/Dubai',
        emails TEXT DEFAULT '[]',
        "whatsappNumber" TEXT,
        "reminderBufferKms" REAL DEFAULT 500,
        "reminderBufferDays" INTEGER DEFAULT 7,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        "updatedAt" TIMESTAMP DEFAULT NOW()
      );
    `;
  }

  // SQLite DDL (original)
  return `
    CREATE TABLE IF NOT EXISTS vehicles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      make TEXT,
      model TEXT,
      year INTEGER,
      type TEXT CHECK(type IN ('car', 'motorcycle', 'other')) DEFAULT 'car',
      plate TEXT,
      vin TEXT,
      currentKms REAL DEFAULT 0,
      photo TEXT,
      notes TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      isDefault INTEGER DEFAULT 0,
      isArchived INTEGER DEFAULT 0,
      createdAt TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS service_records (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      categoryId TEXT NOT NULL,
      date TEXT NOT NULL,
      kmsAtService REAL,
      cost REAL DEFAULT 0,
      currency TEXT DEFAULT 'AED',
      provider TEXT,
      notes TEXT,
      nextDueKms REAL,
      nextDueDays INTEGER,
      nextDueDate TEXT,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicleId) REFERENCES vehicles(id) ON DELETE CASCADE,
      FOREIGN KEY (categoryId) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      serviceRecordId TEXT NOT NULL,
      filePath TEXT NOT NULL,
      originalName TEXT,
      fileType TEXT,
      ocrText TEXT,
      ocrProcessed INTEGER DEFAULT 0,
      uploadedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (serviceRecordId) REFERENCES service_records(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reminder_configs (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      type TEXT CHECK(type IN ('maintenance', 'kmLog')) NOT NULL,
      channel TEXT CHECK(channel IN ('email', 'whatsapp', 'both')) DEFAULT 'email',
      frequency TEXT CHECK(frequency IN ('once', 'daily', 'weekly')) DEFAULT 'once',
      recipients TEXT DEFAULT '[]',
      isActive INTEGER DEFAULT 1,
      createdAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicleId) REFERENCES vehicles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS km_logs (
      id TEXT PRIMARY KEY,
      vehicleId TEXT NOT NULL,
      kms REAL NOT NULL,
      loggedAt TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (vehicleId) REFERENCES vehicles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      currency TEXT DEFAULT 'AED',
      timezone TEXT DEFAULT 'Asia/Dubai',
      emails TEXT DEFAULT '[]',
      whatsappNumber TEXT,
      reminderBufferKms REAL DEFAULT 500,
      reminderBufferDays INTEGER DEFAULT 7,
      createdAt TEXT DEFAULT (datetime('now')),
      updatedAt TEXT DEFAULT (datetime('now'))
    );
  `;
}

function getCreateIndexesSql() {
  // Quote column names for PG compatibility, works fine in SQLite too
  return [
    'CREATE INDEX IF NOT EXISTS idx_service_records_vehicleId ON service_records("vehicleId")',
    'CREATE INDEX IF NOT EXISTS idx_service_records_categoryId ON service_records("categoryId")',
    'CREATE INDEX IF NOT EXISTS idx_service_records_date ON service_records(date)',
    'CREATE INDEX IF NOT EXISTS idx_service_records_nextDueDate ON service_records("nextDueDate")',
    'CREATE INDEX IF NOT EXISTS idx_invoices_serviceRecordId ON invoices("serviceRecordId")',
    'CREATE INDEX IF NOT EXISTS idx_reminder_configs_vehicleId ON reminder_configs("vehicleId")',
    'CREATE INDEX IF NOT EXISTS idx_km_logs_vehicleId ON km_logs("vehicleId")',
    'CREATE INDEX IF NOT EXISTS idx_km_logs_loggedAt ON km_logs("loggedAt")',
  ];
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

async function initDb() {
  if (isPostgres) {
    // ---- PostgreSQL via pg Pool ----
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    db = createPgWrapper(pool);

    // Create tables
    await db.exec(getCreateTablesSql());

    // Create indexes (execute one-by-one because PG doesn't do multi-statement well in some drivers)
    for (const idx of getCreateIndexesSql()) {
      await db.exec(idx);
    }

    // Add new columns (safe to re-run)
    const alterStatements = [
      'ALTER TABLE service_records ADD COLUMN "originalCost" REAL',
      'ALTER TABLE service_records ADD COLUMN "originalCurrency" TEXT',
      'ALTER TABLE service_records ADD COLUMN "exchangeRate" REAL',
      'ALTER TABLE categories ADD COLUMN "defaultKms" REAL',
      'ALTER TABLE categories ADD COLUMN "defaultDays" INTEGER',
      'ALTER TABLE settings ADD COLUMN "whatsappApiKey" TEXT',
    ];
    for (const stmt of alterStatements) {
      try { await db.exec(stmt); } catch (e) { /* column already exists */ }
    }

    console.log('Database engine: PostgreSQL');
    console.log('Database initialized successfully.');
    return db;
  }

  // ---- SQLite ----
  const dataDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  let rawDb;
  try {
    const Database = require('better-sqlite3');
    rawDb = new Database(DB_PATH);
    rawDb.pragma('journal_mode = WAL');
    rawDb.pragma('foreign_keys = ON');
    console.log('Database engine: better-sqlite3 (native)');
  } catch (_e) {
    console.log('better-sqlite3 not available, using sql.js (pure JS) fallback.');
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs();

    let sqliteDb;
    if (fs.existsSync(DB_PATH)) {
      const fileBuffer = fs.readFileSync(DB_PATH);
      sqliteDb = new SQL.Database(fileBuffer);
    } else {
      sqliteDb = new SQL.Database();
    }

    rawDb = createSqlJsRawWrapper(sqliteDb);
    rawDb.pragma('foreign_keys = ON');
  }

  db = createSqliteWrapper(rawDb);

  // Create tables and indexes
  await db.exec(getCreateTablesSql());
  for (const idx of getCreateIndexesSql()) {
    await db.exec(idx);
  }

  // Add new columns (safe to re-run)
  const alterStatements = [
    'ALTER TABLE service_records ADD COLUMN "originalCost" REAL',
    'ALTER TABLE service_records ADD COLUMN "originalCurrency" TEXT',
    'ALTER TABLE service_records ADD COLUMN "exchangeRate" REAL',
    'ALTER TABLE categories ADD COLUMN "defaultKms" REAL',
    'ALTER TABLE categories ADD COLUMN "defaultDays" INTEGER',
    'ALTER TABLE settings ADD COLUMN "whatsappApiKey" TEXT',
  ];
  for (const stmt of alterStatements) {
    try { await db.exec(stmt); } catch (e) { /* column already exists */ }
  }

  console.log('Database initialized successfully.');
  return db;
}

module.exports = { getDb, initDb, isPostgres, nowExpr, monthExtract, upsertSql, insertIgnoreSql };
