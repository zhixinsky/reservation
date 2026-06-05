const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const Database = require('better-sqlite3');
require('dotenv').config();

const root = path.resolve(__dirname, '..');
const sqlitePath = process.env.DB_PATH || path.join(root, 'data', 'reservations.db');

function required(name) {
  if (!process.env[name]) {
    throw new Error(`Missing env ${name}`);
  }
  return process.env[name];
}

function toMysqlDateTime(value) {
  const d = value ? new Date(value) : new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function tableExists(db, table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table));
}

function readTable(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all();
}

async function createTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS appointments (
      id VARCHAR(128) PRIMARY KEY,
      appId VARCHAR(64) NOT NULL,
      stylistId INT NOT NULL,
      date VARCHAR(10) NOT NULL,
      time VARCHAR(64) NOT NULL,
      userName VARCHAR(255) DEFAULT '',
      user VARCHAR(255) DEFAULT '',
      phone VARCHAR(32) NOT NULL,
      status VARCHAR(32) DEFAULT 'booked',
      serviceType VARCHAR(32) DEFAULT 'cut',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_appointments_stylist_date_time (stylistId, date, time),
      INDEX idx_appointments_phone_date (phone, date),
      INDEX idx_appointments_status (status),
      INDEX idx_appointments_stylist_date_status (stylistId, date, status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS blocked_slots (
      id INT AUTO_INCREMENT PRIMARY KEY,
      stylistId INT NOT NULL,
      date VARCHAR(10) NOT NULL,
      time VARCHAR(64) NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_blocked_slot (stylistId, date, time),
      INDEX idx_blocked_slots_stylist_date (stylistId, date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      sessionId VARCHAR(255) PRIMARY KEY,
      role VARCHAR(32) NOT NULL,
      username VARCHAR(255) NOT NULL,
      stylistId INT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      expiresAt DATETIME NULL,
      INDEX idx_sessions_expires (expiresAt)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS stylist_vacations (
      stylistId INT PRIMARY KEY,
      vacationStartDate VARCHAR(10) NULL,
      vacationEndDate VARCHAR(10) NULL,
      rangesJson TEXT NULL,
      updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

async function main() {
  if (!fs.existsSync(sqlitePath)) {
    throw new Error(`SQLite file not found: ${sqlitePath}`);
  }

  const pool = mysql.createPool({
    host: required('MYSQL_HOST'),
    port: Number(process.env.MYSQL_PORT || 3306),
    user: required('MYSQL_USER'),
    password: process.env.MYSQL_PASSWORD || '',
    database: required('MYSQL_DATABASE'),
    waitForConnections: true,
    connectionLimit: 5,
    charset: 'utf8mb4'
  });

  await createTables(pool);
  const db = new Database(sqlitePath, { readonly: true });

  const appointments = readTable(db, 'appointments');
  for (const row of appointments) {
    await pool.query(`
      INSERT INTO appointments (id, appId, stylistId, date, time, userName, user, phone, status, serviceType, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        appId = VALUES(appId),
        stylistId = VALUES(stylistId),
        date = VALUES(date),
        time = VALUES(time),
        userName = VALUES(userName),
        user = VALUES(user),
        phone = VALUES(phone),
        status = VALUES(status),
        serviceType = VALUES(serviceType),
        createdAt = VALUES(createdAt)
    `, [
      row.id,
      row.appId,
      Number(row.stylistId),
      row.date,
      row.time,
      row.userName || '',
      row.user || row.userName || '',
      row.phone,
      row.status || 'booked',
      row.serviceType || 'cut',
      toMysqlDateTime(row.createdAt)
    ]);
  }

  const blockedSlots = readTable(db, 'blocked_slots');
  for (const row of blockedSlots) {
    await pool.query(`
      INSERT INTO blocked_slots (stylistId, date, time, createdAt)
      VALUES (?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE createdAt = VALUES(createdAt)
    `, [
      Number(row.stylistId),
      row.date,
      row.time,
      toMysqlDateTime(row.createdAt)
    ]);
  }

  const vacations = readTable(db, 'stylist_vacations');
  for (const row of vacations) {
    await pool.query(`
      INSERT INTO stylist_vacations (stylistId, vacationStartDate, vacationEndDate, rangesJson, updatedAt)
      VALUES (?, ?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        vacationStartDate = VALUES(vacationStartDate),
        vacationEndDate = VALUES(vacationEndDate),
        rangesJson = VALUES(rangesJson),
        updatedAt = NOW()
    `, [
      Number(row.stylistId),
      row.vacationStartDate || null,
      row.vacationEndDate || null,
      row.rangesJson || null
    ]);
  }

  await pool.end();
  console.log(`Imported ${appointments.length} appointments, ${blockedSlots.length} blocked slots, ${vacations.length} vacation rows.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
