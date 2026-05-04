const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'web_walk',
  port: parseInt(process.env.DB_PORT) || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
});

async function initDb() {
  const conn = await pool.getConnection();
  try {
    await conn.query(`
      CREATE TABLE IF NOT EXISTS walks (
        id VARCHAR(36) PRIMARY KEY,
        name VARCHAR(255) NOT NULL DEFAULT 'Untitled Walk',
        duration_seconds INT NOT NULL DEFAULT 60,
        heading_offset DOUBLE NOT NULL DEFAULT 0,
        pitch DOUBLE NOT NULL DEFAULT 0,
        fov DOUBLE NOT NULL DEFAULT 90,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        total_frames INT NOT NULL DEFAULT 0,
        downloaded_frames INT NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS walk_points (
        id INT AUTO_INCREMENT PRIMARY KEY,
        walk_id VARCHAR(36) NOT NULL,
        sort_order INT NOT NULL,
        lat DOUBLE NOT NULL,
        lng DOUBLE NOT NULL,
        UNIQUE KEY uq_walk_sort (walk_id, sort_order),
        FOREIGN KEY (walk_id) REFERENCES walks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS api_usage (
        id INT AUTO_INCREMENT PRIMARY KEY,
        walk_id VARCHAR(36),
        api_type VARCHAR(50) NOT NULL,
        request_count INT NOT NULL DEFAULT 1,
        cost_usd DOUBLE NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS walk_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        walk_id VARCHAR(36) NOT NULL,
        level VARCHAR(10) NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        INDEX idx_walk_logs_walk (walk_id),
        FOREIGN KEY (walk_id) REFERENCES walks(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        \`key\` VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS streetview_cache (
        id INT AUTO_INCREMENT PRIMARY KEY,
        lat_key DOUBLE NOT NULL,
        lng_key DOUBLE NOT NULL,
        heading_key INT NOT NULL,
        pitch INT NOT NULL,
        fov INT NOT NULL,
        size VARCHAR(20) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INT NOT NULL DEFAULT 0,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_sv_cache (lat_key, lng_key, heading_key, pitch, fov, size)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Migrate: add columns if missing
    const migrateCols = [
      ['walks', 'heading_offset', 'DOUBLE NOT NULL DEFAULT 0'],
      ['walks', 'pitch', 'DOUBLE NOT NULL DEFAULT 0'],
      ['walks', 'fov', 'DOUBLE NOT NULL DEFAULT 90'],
      ['walks', 'aspect_ratio', "VARCHAR(10) NOT NULL DEFAULT '1:1'"],
      ['walks', 'direction', "VARCHAR(10) NOT NULL DEFAULT 'forward'"],
    ];
    for (const [table, col, def] of migrateCols) {
      try { await conn.query(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`); } catch (e) {}
    }
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDb };
