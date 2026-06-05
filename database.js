/**
 * 数据库操作模块
 * 生产环境使用 MySQL；本地未配置 MySQL 时回退到内存存储。
 *
 * 现有业务代码是同步数据访问风格。为了不大面积改写所有 Express 路由，
 * 这里在启动时把 MySQL 数据加载到内存缓存，写操作先更新缓存，再异步写回 MySQL。
 * 云托管生产环境建议先保持单实例，避免多实例缓存不一致。
 */

const mysql = require('mysql2/promise');

function parseMysqlAddress() {
    const address = process.env.MYSQL_ADDRESS || process.env.MYSQL_HOST || '';
    if (!address) {
        return { host: '', port: Number(process.env.MYSQL_PORT || 3306) };
    }
    const [host, port] = address.split(':');
    return {
        host,
        port: Number(process.env.MYSQL_PORT || port || 3306)
    };
}

const mysqlAddress = parseMysqlAddress();

const MYSQL_CONFIG = {
    host: mysqlAddress.host,
    port: mysqlAddress.port,
    user: process.env.MYSQL_USER || process.env.MYSQL_USERNAME,
    password: process.env.MYSQL_PASSWORD,
    database: process.env.MYSQL_DATABASE || process.env.MYSQL_DB || process.env.MYSQL_DATABASE_NAME || 'reservation_system',
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
    charset: 'utf8mb4'
};

const hasMysqlConfig = Boolean(MYSQL_CONFIG.host && MYSQL_CONFIG.user && MYSQL_CONFIG.database);

let pool = null;
let useDatabase = false;

let memoryAppointments = [];
let memoryBlockedSlots = [];
let memorySessions = {};
let memoryStylistVacations = {};

function toMysqlDateTime(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return toMysqlDateTime(new Date());
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function normalizeAppointment(row) {
    return {
        ...row,
        stylistId: Number(row.stylistId),
        serviceType: row.serviceType || 'cut',
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
    };
}

function normalizeBlockedSlot(row) {
    return {
        ...row,
        stylistId: Number(row.stylistId)
    };
}

function asyncWrite(label, fn) {
    if (!useDatabase || !pool) return;
    fn().catch(error => {
        console.error(`[MySQL写入失败] ${label}:`, error.message);
    });
}

async function ensureDatabase() {
    if (!hasMysqlConfig) {
        console.warn('⚠️  未配置 MySQL，使用内存存储（仅用于本地调试，数据不会持久化）');
        useDatabase = false;
        return;
    }

    const bootstrapPool = mysql.createPool({
        host: MYSQL_CONFIG.host,
        port: MYSQL_CONFIG.port,
        user: MYSQL_CONFIG.user,
        password: MYSQL_CONFIG.password,
        waitForConnections: true,
        connectionLimit: 2,
        charset: 'utf8mb4'
    });
    await bootstrapPool.query(
        `CREATE DATABASE IF NOT EXISTS \`${MYSQL_CONFIG.database}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await bootstrapPool.end();

    pool = mysql.createPool(MYSQL_CONFIG);
    await pool.query('SELECT 1');
    useDatabase = true;
    console.log(`✓ 使用 MySQL 数据库：${MYSQL_CONFIG.host}:${MYSQL_CONFIG.port}/${MYSQL_CONFIG.database}`);

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

    await reloadCache();
    console.log('✓ MySQL 数据缓存加载完成');
}

async function reloadCache() {
    if (!useDatabase || !pool) return;
    const [appointmentsRows] = await pool.query('SELECT * FROM appointments ORDER BY date, time');
    memoryAppointments = appointmentsRows.map(normalizeAppointment);

    const [blockedRows] = await pool.query('SELECT * FROM blocked_slots ORDER BY date, time');
    memoryBlockedSlots = blockedRows.map(normalizeBlockedSlot);

    const [sessionRows] = await pool.query('SELECT * FROM sessions');
    memorySessions = {};
    sessionRows.forEach(row => {
        memorySessions[row.sessionId] = {
            role: row.role,
            username: row.username,
            stylistId: row.stylistId,
            expiresAt: row.expiresAt ? new Date(row.expiresAt) : null
        };
    });

    const [vacationRows] = await pool.query('SELECT * FROM stylist_vacations');
    memoryStylistVacations = {};
    vacationRows.forEach(row => {
        memoryStylistVacations[Number(row.stylistId)] = {
            vacationStartDate: row.vacationStartDate,
            vacationEndDate: row.vacationEndDate,
            rangesJson: row.rangesJson
        };
    });
}

const ready = ensureDatabase().catch(error => {
    console.error('❌ MySQL 初始化失败:', error.message);
    console.warn('⚠️  已回退到内存存储，请检查 MySQL 环境变量。');
    useDatabase = false;
});

function matchConditions(row, conditions) {
    if (!conditions) return true;
    if (conditions.id !== undefined && row.id !== conditions.id) return false;
    if (conditions.stylistId !== undefined && row.stylistId != conditions.stylistId) return false;
    if (conditions.date !== undefined && row.date !== conditions.date) return false;
    if (conditions.time !== undefined && row.time !== conditions.time) return false;
    if (conditions.phone !== undefined && row.phone !== conditions.phone) return false;
    if (conditions.appId !== undefined && row.appId !== conditions.appId) return false;
    if (conditions.status !== undefined) {
        if (Array.isArray(conditions.status)) {
            if (!conditions.status.includes(row.status)) return false;
        } else if (row.status !== conditions.status) {
            return false;
        }
    }
    return true;
}

const appointments = {
    getAll() {
        return [...memoryAppointments].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });
    },

    find(conditions) {
        return memoryAppointments
            .filter(app => matchConditions(app, conditions))
            .sort((a, b) => {
                if (a.date !== b.date) return a.date.localeCompare(b.date);
                return a.time.localeCompare(b.time);
            });
    },

    findOne(conditions) {
        return this.find(conditions)[0] || null;
    },

    create(appointment) {
        const appointmentId = appointment.id || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        const createdAt = appointment.createdAt || new Date();
        const row = normalizeAppointment({
            id: appointmentId,
            appId: appointment.appId,
            stylistId: Number(appointment.stylistId),
            date: appointment.date,
            time: appointment.time,
            userName: appointment.userName || '',
            user: appointment.user || appointment.userName || '',
            phone: appointment.phone,
            status: appointment.status || 'booked',
            serviceType: appointment.serviceType || 'cut',
            createdAt
        });
        memoryAppointments.push(row);

        asyncWrite('appointments.create', () => pool.query(`
            INSERT INTO appointments (id, appId, stylistId, date, time, userName, user, phone, status, serviceType, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            row.id,
            row.appId,
            row.stylistId,
            row.date,
            row.time,
            row.userName,
            row.user,
            row.phone,
            row.status,
            row.serviceType,
            toMysqlDateTime(row.createdAt)
        ]));

        return row;
    },

    updateStatus(appIdOrId, status) {
        const app = memoryAppointments.find(a => a.id === appIdOrId);
        if (!app) return false;
        app.status = status;
        asyncWrite('appointments.updateStatus', () => pool.query(
            'UPDATE appointments SET status = ? WHERE id = ?',
            [status, appIdOrId]
        ));
        return true;
    },

    delete(appId) {
        const initialLength = memoryAppointments.length;
        memoryAppointments = memoryAppointments.filter(a => a.appId !== appId && a.id !== appId);
        const changed = memoryAppointments.length < initialLength;
        if (changed) {
            asyncWrite('appointments.delete', () => pool.query(
                'DELETE FROM appointments WHERE appId = ? OR id = ?',
                [appId, appId]
            ));
        }
        return changed;
    }
};

const blockedSlots = {
    getAll() {
        return [...memoryBlockedSlots].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });
    },

    find(conditions) {
        return memoryBlockedSlots.filter(slot => {
            if (conditions.stylistId !== undefined && slot.stylistId != conditions.stylistId) return false;
            if (conditions.date !== undefined && slot.date !== conditions.date) return false;
            if (conditions.time !== undefined && slot.time !== conditions.time) return false;
            return true;
        });
    },

    create(slot) {
        const row = normalizeBlockedSlot({
            id: slot.id || Date.now(),
            stylistId: Number(slot.stylistId),
            date: slot.date,
            time: slot.time,
            createdAt: new Date()
        });
        memoryBlockedSlots = memoryBlockedSlots.filter(s => !(s.stylistId == row.stylistId && s.date === row.date && s.time === row.time));
        memoryBlockedSlots.push(row);

        asyncWrite('blockedSlots.create', () => pool.query(`
            INSERT INTO blocked_slots (stylistId, date, time)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE createdAt = CURRENT_TIMESTAMP
        `, [row.stylistId, row.date, row.time]));

        return row;
    },

    delete(conditions) {
        const initialLength = memoryBlockedSlots.length;
        memoryBlockedSlots = memoryBlockedSlots.filter(slot => {
            if (conditions.stylistId !== undefined && slot.stylistId != conditions.stylistId) return true;
            if (conditions.date !== undefined && slot.date !== conditions.date) return true;
            if (conditions.time !== undefined && slot.time !== conditions.time) return true;
            return false;
        });
        const changed = memoryBlockedSlots.length < initialLength;
        if (changed) {
            const clauses = [];
            const params = [];
            if (conditions.stylistId !== undefined) {
                clauses.push('stylistId = ?');
                params.push(Number(conditions.stylistId));
            }
            if (conditions.date !== undefined) {
                clauses.push('date = ?');
                params.push(conditions.date);
            }
            if (conditions.time !== undefined) {
                clauses.push('time = ?');
                params.push(conditions.time);
            }
            asyncWrite('blockedSlots.delete', () => pool.query(
                `DELETE FROM blocked_slots WHERE ${clauses.length ? clauses.join(' AND ') : '1=1'}`,
                params
            ));
        }
        return changed;
    }
};

const sessions = {
    create(sessionId, sessionData) {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);
        memorySessions[sessionId] = {
            role: sessionData.role,
            username: sessionData.username,
            stylistId: sessionData.stylistId || null,
            expiresAt
        };

        asyncWrite('sessions.create', () => pool.query(`
            INSERT INTO sessions (sessionId, role, username, stylistId, expiresAt)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                role = VALUES(role),
                username = VALUES(username),
                stylistId = VALUES(stylistId),
                expiresAt = VALUES(expiresAt)
        `, [
            sessionId,
            sessionData.role,
            sessionData.username,
            sessionData.stylistId || null,
            toMysqlDateTime(expiresAt)
        ]));

        return this.get(sessionId);
    },

    get(sessionId) {
        const session = memorySessions[sessionId];
        if (!session) return null;
        if (session.expiresAt && new Date(session.expiresAt) < new Date()) {
            delete memorySessions[sessionId];
            return null;
        }
        return {
            role: session.role,
            username: session.username,
            stylistId: session.stylistId
        };
    },

    delete(sessionId) {
        if (!memorySessions[sessionId]) return false;
        delete memorySessions[sessionId];
        asyncWrite('sessions.delete', () => pool.query(
            'DELETE FROM sessions WHERE sessionId = ?',
            [sessionId]
        ));
        return true;
    },

    cleanExpired() {
        const now = new Date();
        let cleaned = 0;
        for (const [sessionId, session] of Object.entries(memorySessions)) {
            if (session.expiresAt && new Date(session.expiresAt) < now) {
                delete memorySessions[sessionId];
                cleaned++;
            }
        }
        asyncWrite('sessions.cleanExpired', () => pool.query(
            'DELETE FROM sessions WHERE expiresAt IS NOT NULL AND expiresAt <= NOW()'
        ));
        return cleaned;
    }
};

function vacationRangesFromRow(row) {
    if (!row) return [];
    let fromJson = [];
    if (row.rangesJson) {
        try {
            const arr = JSON.parse(row.rangesJson);
            if (Array.isArray(arr)) {
                fromJson = arr
                    .map(it => ({
                        vacationStartDate: String(it.vacationStartDate || '').trim(),
                        vacationEndDate: String(it.vacationEndDate || '').trim()
                    }))
                    .filter(it => /^\d{4}-\d{2}-\d{2}$/.test(it.vacationStartDate) && /^\d{4}-\d{2}-\d{2}$/.test(it.vacationEndDate) && it.vacationStartDate <= it.vacationEndDate);
            }
        } catch (_) {
            fromJson = [];
        }
    }
    if (fromJson.length > 0) return fromJson;
    if (row.vacationStartDate && row.vacationEndDate) {
        return [{ vacationStartDate: row.vacationStartDate, vacationEndDate: row.vacationEndDate }];
    }
    return [];
}

const stylistVacations = {
    get(stylistId) {
        const id = Number(stylistId);
        return Object.prototype.hasOwnProperty.call(memoryStylistVacations, id)
            ? memoryStylistVacations[id]
            : undefined;
    },

    getRanges(stylistId) {
        const row = this.get(stylistId);
        if (row === undefined) return undefined;
        return vacationRangesFromRow(row);
    },

    set(stylistId, vacationRanges) {
        const id = Number(stylistId);
        const ranges = Array.isArray(vacationRanges) ? vacationRanges : [];
        const first = ranges[0];
        const row = {
            vacationStartDate: first ? first.vacationStartDate : null,
            vacationEndDate: first ? first.vacationEndDate : null,
            rangesJson: JSON.stringify(ranges)
        };
        memoryStylistVacations[id] = row;

        asyncWrite('stylistVacations.set', () => pool.query(`
            INSERT INTO stylist_vacations (stylistId, vacationStartDate, vacationEndDate, rangesJson, updatedAt)
            VALUES (?, ?, ?, ?, NOW())
            ON DUPLICATE KEY UPDATE
                vacationStartDate = VALUES(vacationStartDate),
                vacationEndDate = VALUES(vacationEndDate),
                rangesJson = VALUES(rangesJson),
                updatedAt = NOW()
        `, [id, row.vacationStartDate, row.vacationEndDate, row.rangesJson]));
    }
};

setInterval(() => {
    const cleaned = sessions.cleanExpired();
    if (cleaned > 0) {
        console.log(`清理了 ${cleaned} 个过期会话`);
    }
}, 3600000);

module.exports = {
    db: pool,
    ready,
    appointments,
    blockedSlots,
    sessions,
    stylistVacations,
    initDatabase: ensureDatabase,
    reloadCache,
    useDatabase: () => useDatabase
};
