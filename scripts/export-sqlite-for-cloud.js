const fs = require('fs');
const path = require('path');

const Database = require('better-sqlite3');

const root = path.resolve(__dirname, '..');
const dbPath = process.env.DB_PATH || path.join(root, 'data', 'reservations.db');
const outDir = process.env.OUT_DIR || path.join(root, 'data', 'cloud-export');

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function writeJson(name, data) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, name), JSON.stringify(data, null, 2), 'utf8');
}

function tableExists(db, table) {
  const row = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  return Boolean(row);
}

function readTable(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`SELECT * FROM ${table}`).all();
}

const db = new Database(dbPath, { readonly: true });

const appointments = readTable(db, 'appointments').map(row => ({
  ...row,
  stylistId: Number(row.stylistId),
  serviceType: row.serviceType || 'cut'
}));

const blockedSlots = readTable(db, 'blocked_slots').map(row => ({
  ...row,
  stylistId: Number(row.stylistId)
}));

const vacationRows = readTable(db, 'stylist_vacations');
const stylistVacations = [];
for (const row of vacationRows) {
  if (row.rangesJson) {
    try {
      const ranges = JSON.parse(row.rangesJson);
      if (Array.isArray(ranges)) {
        ranges.forEach(range => {
          if (range.vacationStartDate && range.vacationEndDate) {
            stylistVacations.push({
              stylistId: Number(row.stylistId),
              vacationStartDate: range.vacationStartDate,
              vacationEndDate: range.vacationEndDate
            });
          }
        });
        continue;
      }
    } catch (e) {
      // Fall through to the legacy single-range fields.
    }
  }
  if (row.vacationStartDate && row.vacationEndDate) {
    stylistVacations.push({
      stylistId: Number(row.stylistId),
      vacationStartDate: row.vacationStartDate,
      vacationEndDate: row.vacationEndDate
    });
  }
}

const stylists = readJson(path.join(root, 'stylists.json'), []).map(stylist => {
  const { password, ...rest } = stylist;
  return {
    ...rest,
    password: stylist.password,
    vacationRanges: stylist.vacationRanges || []
  };
});

const announcement = readJson(path.join(root, 'data', 'announcement.json'), { text: '' });

writeJson('appointments.json', appointments);
writeJson('blocked_slots.json', blockedSlots);
writeJson('stylist_vacations.json', stylistVacations);
writeJson('stylists.json', stylists);
writeJson('announcement.json', [{ _id: 'current', text: announcement.text || '' }]);

console.log(`Exported cloud import JSON to ${outDir}`);
