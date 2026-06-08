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
let memoryStores = [];
let memoryPhoneBlacklist = [];
let memoryAuditLogs = [];
let memoryStylists = [];
let nextBlacklistId = 1;
let nextAuditLogId = 1;

function toMysqlDateTime(value) {
    const d = value ? new Date(value) : new Date();
    if (Number.isNaN(d.getTime())) return toMysqlDateTime(new Date());
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function getTodayYmdLocal() {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function autoCompleteStaleAppointments() {
    const today = getTodayYmdLocal();
    let count = 0;
    memoryAppointments.forEach((app) => {
        const isPastBooked = (app.status === 'booked' || app.status === 'pending')
            && app.date
            && app.date < today;
        const isLegacyUnhandled = app.status === 'unhandled';
        if (!isPastBooked && !isLegacyUnhandled) return;
        app.status = 'completed';
        count += 1;
        asyncWrite('appointments.autoComplete', () => pool.query(
            'UPDATE appointments SET status = ? WHERE id = ?',
            ['completed', app.id]
        ));
    });
    if (count > 0) {
        console.log(`✓ 已将 ${count} 条过期未完结预约自动标记为已完成`);
    }
    return count;
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
        seedMemoryStoresIfEmpty();
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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS stores (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(128) NOT NULL,
            code VARCHAR(64) NOT NULL DEFAULT '',
            status VARCHAR(16) NOT NULL DEFAULT 'active',
            address VARCHAR(255) DEFAULT '',
            phone VARCHAR(32) DEFAULT '',
            latitude DECIMAL(10, 6) NULL,
            longitude DECIMAL(10, 6) NULL,
            workStart VARCHAR(8) NOT NULL DEFAULT '11:00',
            workEnd VARCHAR(8) NOT NULL DEFAULT '22:30',
            slotIntervalMinutes INT NOT NULL DEFAULT 30,
            bookAheadDays INT NOT NULL DEFAULT 3,
            defaultBlockedSlots JSON NULL,
            dyeSlotCount INT NOT NULL DEFAULT 4,
            announcementText TEXT NULL,
            backgroundImage VARCHAR(512) DEFAULT '',
            smsCompanyName VARCHAR(64) DEFAULT '',
            miniProgramUrl VARCHAR(255) DEFAULT '',
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_store_code (code)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS platform_audit_logs (
            id INT AUTO_INCREMENT PRIMARY KEY,
            actor VARCHAR(64) NOT NULL DEFAULT '',
            action VARCHAR(64) NOT NULL,
            targetType VARCHAR(32) DEFAULT '',
            targetId VARCHAR(64) DEFAULT '',
            storeId INT NULL,
            detail JSON NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_audit_created (createdAt),
            INDEX idx_audit_action (action),
            INDEX idx_audit_store (storeId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS phone_blacklist (
            id INT AUTO_INCREMENT PRIMARY KEY,
            storeId INT NULL,
            phone VARCHAR(32) NOT NULL,
            reason VARCHAR(255) DEFAULT '',
            createdBy VARCHAR(64) DEFAULT '',
            expiresAt DATETIME NULL,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_blacklist_phone (phone),
            INDEX idx_blacklist_store (storeId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS stylists (
            id INT PRIMARY KEY,
            storeId INT NOT NULL DEFAULT 1,
            name VARCHAR(128) NOT NULL,
            username VARCHAR(64) NOT NULL,
            phone VARCHAR(256) NOT NULL DEFAULT '',
            password VARCHAR(255) NOT NULL,
            workStatus VARCHAR(16) NOT NULL DEFAULT 'working',
            rankLabel VARCHAR(64) DEFAULT '',
            specialty VARCHAR(255) DEFAULT '',
            price VARCHAR(64) DEFAULT '',
            photo VARCHAR(512) DEFAULT '',
            enabled TINYINT(1) NOT NULL DEFAULT 1,
            createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
            updatedAt DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY uniq_stylist_username (username),
            INDEX idx_stylists_store (storeId)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    const [phoneCol] = await pool.query(`SHOW COLUMNS FROM stylists LIKE 'phone'`);
    if (!phoneCol.length) {
        await pool.query(`ALTER TABLE stylists ADD COLUMN phone VARCHAR(256) NOT NULL DEFAULT '' AFTER username`);
        await pool.query(`CREATE INDEX idx_stylists_phone ON stylists (phone)`);
    } else {
        const phoneType = String(phoneCol[0].Type || '');
        if (!phoneType.includes('256')) {
            await pool.query(`ALTER TABLE stylists MODIFY COLUMN phone VARCHAR(256) NOT NULL DEFAULT ''`);
        }
    }

    const [bgCol] = await pool.query(`SHOW COLUMNS FROM stores LIKE 'backgroundImage'`);
    if (!bgCol.length) {
        await pool.query(`ALTER TABLE stores ADD COLUMN backgroundImage VARCHAR(512) NOT NULL DEFAULT '' AFTER announcementText`);
    }

    await seedDefaultStoreIfEmpty();
    await reloadCache();
    autoCompleteStaleAppointments();
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

    const [storeRows] = await pool.query('SELECT * FROM stores ORDER BY id');
    memoryStores = storeRows.map(normalizeStoreRow);

    const [blacklistRows] = await pool.query('SELECT * FROM phone_blacklist ORDER BY id DESC');
    memoryPhoneBlacklist = blacklistRows.map(normalizeBlacklistRow);
    nextBlacklistId = memoryPhoneBlacklist.reduce((max, row) => Math.max(max, row.id), 0) + 1;

    const [auditRows] = await pool.query(
        'SELECT * FROM platform_audit_logs ORDER BY id DESC LIMIT 2000'
    );
    memoryAuditLogs = auditRows.map(normalizeAuditRow);
    nextAuditLogId = memoryAuditLogs.reduce((max, row) => Math.max(max, row.id), 0) + 1;

    const [stylistRows] = await pool.query('SELECT * FROM stylists ORDER BY id');
    memoryStylists = stylistRows.map(normalizeStylistRow);
}

function parseJsonArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : fallback;
        } catch (_) {
            return fallback;
        }
    }
    return fallback;
}

function normalizeStoreRow(row) {
    return {
        id: Number(row.id),
        name: row.name || '',
        code: row.code || '',
        status: row.status || 'active',
        address: row.address || '',
        phone: row.phone || '',
        latitude: row.latitude != null ? Number(row.latitude) : null,
        longitude: row.longitude != null ? Number(row.longitude) : null,
        workStart: row.workStart || '11:00',
        workEnd: row.workEnd || '22:30',
        slotIntervalMinutes: Number(row.slotIntervalMinutes) || 30,
        bookAheadDays: Number(row.bookAheadDays) || 3,
        defaultBlockedSlots: parseJsonArray(row.defaultBlockedSlots, ['12:00-12:30', '18:00-18:30']),
        dyeSlotCount: Number(row.dyeSlotCount) || 4,
        announcementText: row.announcementText || '',
        backgroundImage: row.backgroundImage || '',
        smsCompanyName: row.smsCompanyName || '',
        miniProgramUrl: row.miniProgramUrl || '',
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
    };
}

function normalizeBlacklistRow(row) {
    return {
        id: Number(row.id),
        storeId: row.storeId == null ? null : Number(row.storeId),
        phone: String(row.phone || '').replace(/\D/g, ''),
        reason: row.reason || '',
        createdBy: row.createdBy || '',
        expiresAt: row.expiresAt ? new Date(row.expiresAt) : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
    };
}

function normalizeStylistRow(row) {
    return {
        id: Number(row.id),
        storeId: Number(row.storeId) || 1,
        name: row.name || '',
        username: row.username || '',
        phone: joinStylistPhones(row.phone),
        password: row.password || '',
        workStatus: row.workStatus || 'working',
        rank: row.rank || row.rankLabel || '',
        specialty: row.specialty || '',
        price: row.price || '',
        photo: row.photo || '',
        enabled: row.enabled !== 0 && row.enabled !== false && row.enabled !== '0'
    };
}

function publicStylistRow(row) {
    const { password, ...pub } = normalizeStylistRow(row);
    return pub;
}

function getDefaultStoreSeed() {
    return {
        name: process.env.STORE_NAME || '欧诺造型',
        code: process.env.STORE_CODE || 'ounuo-main',
        status: 'active',
        address: process.env.STORE_ADDRESS || '广州市白云区白灰场南路2号',
        phone: process.env.STORE_PHONE || '17675610733',
        latitude: process.env.STORE_LATITUDE ? Number(process.env.STORE_LATITUDE) : 23.185396,
        longitude: process.env.STORE_LONGITUDE ? Number(process.env.STORE_LONGITUDE) : 113.323372,
        workStart: '11:00',
        workEnd: '22:30',
        slotIntervalMinutes: 30,
        bookAheadDays: 3,
        defaultBlockedSlots: ['12:00-12:30', '18:00-18:30'],
        dyeSlotCount: 4,
        announcementText: process.env.DEFAULT_ANNOUNCEMENT || '欢迎光临欧诺造型，本店营业时间 11:00-22:00，请提前预约到店！',
        smsCompanyName: '',
        miniProgramUrl: process.env.MINI_PROGRAM_URL || ''
    };
}

async function seedDefaultStoreIfEmpty() {
    if (!useDatabase || !pool) {
        if (memoryStores.length === 0) {
            memoryStores = [{ id: 1, ...getDefaultStoreSeed() }];
        }
        return;
    }
    const [rows] = await pool.query('SELECT COUNT(*) AS cnt FROM stores');
    if (Number(rows[0].cnt) > 0) return;
    const seed = getDefaultStoreSeed();
    await pool.query(`
        INSERT INTO stores (
            name, code, status, address, phone, latitude, longitude,
            workStart, workEnd, slotIntervalMinutes, bookAheadDays,
            defaultBlockedSlots, dyeSlotCount, announcementText, smsCompanyName, miniProgramUrl
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        seed.name, seed.code, seed.status, seed.address, seed.phone,
        seed.latitude, seed.longitude, seed.workStart, seed.workEnd,
        seed.slotIntervalMinutes, seed.bookAheadDays,
        JSON.stringify(seed.defaultBlockedSlots), seed.dyeSlotCount,
        seed.announcementText, seed.smsCompanyName, seed.miniProgramUrl
    ]);
    console.log('✓ 已初始化默认门店数据');
}

function seedMemoryStoresIfEmpty() {
    if (memoryStores.length === 0) {
        memoryStores = [{ id: 1, ...getDefaultStoreSeed() }];
    }
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
    autoCompleteStaleAppointments,

    getAll() {
        autoCompleteStaleAppointments();
        return [...memoryAppointments].sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.time.localeCompare(b.time);
        });
    },

    find(conditions) {
        autoCompleteStaleAppointments();
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

const stores = {
    getAll() {
        seedMemoryStoresIfEmpty();
        return [...memoryStores].sort((a, b) => a.id - b.id);
    },

    getById(id) {
        return this.getAll().find(s => Number(s.id) === Number(id)) || null;
    },

    create(payload) {
        seedMemoryStoresIfEmpty();
        const nextId = memoryStores.reduce((max, s) => Math.max(max, s.id), 0) + 1;
        const row = normalizeStoreRow({ id: nextId, ...payload });
        memoryStores.push(row);
        asyncWrite('stores.create', () => pool.query(`
            INSERT INTO stores (
                name, code, status, address, phone, latitude, longitude,
                workStart, workEnd, slotIntervalMinutes, bookAheadDays,
                defaultBlockedSlots, dyeSlotCount, announcementText, backgroundImage, smsCompanyName, miniProgramUrl
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            row.name, row.code, row.status, row.address, row.phone,
            row.latitude, row.longitude, row.workStart, row.workEnd,
            row.slotIntervalMinutes, row.bookAheadDays,
            JSON.stringify(row.defaultBlockedSlots), row.dyeSlotCount,
            row.announcementText, row.backgroundImage, row.smsCompanyName, row.miniProgramUrl
        ]));
        return row;
    },

    update(id, payload) {
        const idx = memoryStores.findIndex(s => Number(s.id) === Number(id));
        if (idx === -1) return null;
        const merged = normalizeStoreRow({ ...memoryStores[idx], ...payload, id: Number(id) });
        memoryStores[idx] = merged;
        asyncWrite('stores.update', () => pool.query(`
            UPDATE stores SET
                name = ?, code = ?, status = ?, address = ?, phone = ?,
                latitude = ?, longitude = ?, workStart = ?, workEnd = ?,
                slotIntervalMinutes = ?, bookAheadDays = ?, defaultBlockedSlots = ?,
                dyeSlotCount = ?, announcementText = ?, backgroundImage = ?, smsCompanyName = ?, miniProgramUrl = ?
            WHERE id = ?
        `, [
            merged.name, merged.code, merged.status, merged.address, merged.phone,
            merged.latitude, merged.longitude, merged.workStart, merged.workEnd,
            merged.slotIntervalMinutes, merged.bookAheadDays,
            JSON.stringify(merged.defaultBlockedSlots), merged.dyeSlotCount,
            merged.announcementText, merged.backgroundImage, merged.smsCompanyName, merged.miniProgramUrl,
            merged.id
        ]));
        return merged;
    }
};

const stylistAccounts = {
    getAll() {
        return [...memoryStylists].sort((a, b) => a.id - b.id);
    },

    getById(id) {
        return this.getAll().find(s => Number(s.id) === Number(id)) || null;
    },

    getByUsername(username) {
        return this.getAll().find(s => s.username === username) || null;
    },

    getByPhone(phone, excludeId) {
        const digits = normalizePhoneDigits(phone);
        if (!digits) return null;
        return this.getAll().find((s) => {
            if (excludeId != null && Number(s.id) === Number(excludeId)) return false;
            return stylistHasAdminPhone(s, digits);
        }) || null;
    },

    async seedFromConfigIfEmpty(list) {
        const source = Array.isArray(list) ? list : [];
        if (memoryStylists.length === 0 && source.length > 0) {
            for (const item of source) {
                const row = normalizeStylistRow({
                    ...item,
                    storeId: item.storeId != null ? item.storeId : 1,
                    enabled: item.enabled !== false
                });
                memoryStylists.push(row);
                if (useDatabase && pool) {
                    await pool.query(`
                        INSERT INTO stylists (
                            id, storeId, name, username, phone, password, workStatus,
                            rankLabel, specialty, price, photo, enabled
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    `, [
                        row.id, row.storeId, row.name, row.username, row.phone, row.password, row.workStatus,
                        row.rank, row.specialty, row.price, row.photo, row.enabled ? 1 : 0
                    ]).catch(err => {
                        console.error('[MySQL] stylists seed failed:', err.message);
                    });
                }
            }
            console.log(`✓ 已初始化 ${memoryStylists.length} 个发型师账号到数据库`);
        }
        return this.getAll();
    },

    syncToArray(targetArray) {
        const all = this.getAll();
        targetArray.length = 0;
        targetArray.push(...all);
        return targetArray;
    },

    create(payload) {
        const username = String(payload.username || '').trim();
        if (!username) throw new Error('请填写登录名');
        if (this.getByUsername(username)) throw new Error('登录名已存在');
        const nextId = payload.id != null
            ? Number(payload.id)
            : memoryStylists.reduce((max, s) => Math.max(max, s.id), 0) + 1;
        const row = normalizeStylistRow({ ...payload, id: nextId, username });
        memoryStylists.push(row);
        asyncWrite('stylists.create', () => pool.query(`
            INSERT INTO stylists (
                id, storeId, name, username, phone, password, workStatus,
                rankLabel, specialty, price, photo, enabled
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            row.id, row.storeId, row.name, row.username, row.phone, row.password, row.workStatus,
            row.rank, row.specialty, row.price, row.photo, row.enabled ? 1 : 0
        ]));
        return row;
    },

    update(id, payload) {
        const idx = memoryStylists.findIndex(s => Number(s.id) === Number(id));
        if (idx === -1) return null;
        const username = payload.username != null ? String(payload.username).trim() : memoryStylists[idx].username;
        const dup = this.getByUsername(username);
        if (dup && Number(dup.id) !== Number(id)) throw new Error('登录名已存在');
        const merged = normalizeStylistRow({ ...memoryStylists[idx], ...payload, id: Number(id), username });
        memoryStylists[idx] = merged;
        asyncWrite('stylists.update', () => pool.query(`
            UPDATE stylists SET
                storeId = ?, name = ?, username = ?, phone = ?, password = ?, workStatus = ?,
                rankLabel = ?, specialty = ?, price = ?, photo = ?, enabled = ?
            WHERE id = ?
        `, [
            merged.storeId, merged.name, merged.username, merged.phone, merged.password, merged.workStatus,
            merged.rank, merged.specialty, merged.price, merged.photo, merged.enabled ? 1 : 0,
            merged.id
        ]));
        return merged;
    }
};

function normalizePhoneDigits(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function parseStylistPhones(phone) {
    const raw = String(phone || '');
    if (!raw) return [];
    const matches = raw.match(/1[3-9]\d{9}/g) || [];
    return [...new Set(matches)];
}

function joinStylistPhones(phones) {
    const list = Array.isArray(phones) ? phones : parseStylistPhones(phones);
    return [...new Set(list.map(normalizePhoneDigits).filter(Boolean))].join(',');
}

function stylistHasAdminPhone(stylistOrPhone, targetDigits) {
    const digits = normalizePhoneDigits(targetDigits);
    if (!digits) return false;
    const phones = typeof stylistOrPhone === 'object'
        ? parseStylistPhones(stylistOrPhone && stylistOrPhone.phone)
        : parseStylistPhones(stylistOrPhone);
    return phones.includes(digits);
}

function normalizeAuditRow(row) {
    let detail = row.detail;
    if (typeof detail === 'string') {
        try {
            detail = JSON.parse(detail);
        } catch (_) {
            detail = null;
        }
    }
    return {
        id: Number(row.id),
        actor: row.actor || '',
        action: row.action || '',
        targetType: row.targetType || '',
        targetId: row.targetId != null ? String(row.targetId) : '',
        storeId: row.storeId != null ? Number(row.storeId) : null,
        detail: detail && typeof detail === 'object' ? detail : null,
        createdAt: row.createdAt ? new Date(row.createdAt) : new Date()
    };
}

const auditLogs = {
    create(payload) {
        const row = normalizeAuditRow({
            id: nextAuditLogId++,
            actor: payload.actor || '',
            action: payload.action || '',
            targetType: payload.targetType || '',
            targetId: payload.targetId != null ? String(payload.targetId) : '',
            storeId: payload.storeId != null ? Number(payload.storeId) : null,
            detail: payload.detail || null,
            createdAt: new Date()
        });
        memoryAuditLogs.unshift(row);
        if (memoryAuditLogs.length > 2000) {
            memoryAuditLogs.length = 2000;
        }
        const detailJson = row.detail ? JSON.stringify(row.detail) : null;
        asyncWrite('auditLogs.create', () => pool.query(`
            INSERT INTO platform_audit_logs (actor, action, targetType, targetId, storeId, detail)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            row.actor,
            row.action,
            row.targetType,
            row.targetId,
            row.storeId,
            detailJson
        ]));
        return row;
    },

    list(query = {}) {
        const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500);
        let list = [...memoryAuditLogs];
        if (query.action) {
            list = list.filter(r => r.action === query.action);
        }
        if (query.storeId != null && query.storeId !== '') {
            const sid = Number(query.storeId);
            list = list.filter(r => Number(r.storeId) === sid);
        }
        if (query.from) {
            const fromTs = new Date(query.from).getTime();
            list = list.filter(r => r.createdAt.getTime() >= fromTs);
        }
        if (query.to) {
            const toEnd = new Date(query.to);
            toEnd.setHours(23, 59, 59, 999);
            list = list.filter(r => r.createdAt.getTime() <= toEnd.getTime());
        }
        return list.slice(0, limit);
    }
};

function isBlacklistActive(row) {
    if (!row) return false;
    if (row.expiresAt && new Date(row.expiresAt) < new Date()) return false;
    return true;
}

const phoneBlacklist = {
    getAll() {
        return memoryPhoneBlacklist
            .filter(isBlacklistActive)
            .sort((a, b) => b.id - a.id);
    },

    findActive(phone, storeId) {
        const digits = normalizePhoneDigits(phone);
        if (!digits) return null;
        return this.getAll().find(row => {
            if (row.phone !== digits) return false;
            if (row.storeId == null) return true;
            return Number(row.storeId) === Number(storeId);
        }) || null;
    },

    create(payload) {
        const row = normalizeBlacklistRow({
            id: nextBlacklistId++,
            storeId: payload.storeId == null || payload.storeId === '' ? null : Number(payload.storeId),
            phone: normalizePhoneDigits(payload.phone),
            reason: payload.reason || '',
            createdBy: payload.createdBy || '',
            expiresAt: payload.expiresAt || null,
            createdAt: new Date()
        });
        memoryPhoneBlacklist.push(row);
        asyncWrite('phoneBlacklist.create', () => pool.query(`
            INSERT INTO phone_blacklist (storeId, phone, reason, createdBy, expiresAt)
            VALUES (?, ?, ?, ?, ?)
        `, [
            row.storeId,
            row.phone,
            row.reason,
            row.createdBy,
            row.expiresAt ? toMysqlDateTime(row.expiresAt) : null
        ]));
        return row;
    },

    remove(id) {
        const initial = memoryPhoneBlacklist.length;
        memoryPhoneBlacklist = memoryPhoneBlacklist.filter(r => Number(r.id) !== Number(id));
        const changed = memoryPhoneBlacklist.length < initial;
        if (changed) {
            asyncWrite('phoneBlacklist.remove', () => pool.query(
                'DELETE FROM phone_blacklist WHERE id = ?',
                [Number(id)]
            ));
        }
        return changed;
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
    stores,
    phoneBlacklist,
    auditLogs,
    stylistAccounts,
    publicStylistRow,
    normalizePhoneDigits,
    parseStylistPhones,
    joinStylistPhones,
    stylistHasAdminPhone,
    initDatabase: ensureDatabase,
    reloadCache,
    useDatabase: () => useDatabase
};
