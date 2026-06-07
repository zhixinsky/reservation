/**
 * 平台最高管理员 API（PC 端）
 */
const express = require('express');
const { clampBookAheadDays } = require('./slot-config');
const { uploadStylistAvatar, resolvePhotoPreviewUrl } = require('./avatar-upload');

const STORE_NAME_MAX_LEN = 6;

function normalizeStoreName(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return { ok: false, message: '请填写门店名称' };
    if (trimmed.length > STORE_NAME_MAX_LEN) {
        return { ok: false, message: `门店名称最多${STORE_NAME_MAX_LEN}个字` };
    }
    return { ok: true, name: trimmed };
}

function isValidStylistPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    return /^1[3-9]\d{9}$/.test(digits);
}

function normalizeStylistPhone(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function validateStylistPhoneField(phone, dbStylistAccounts, excludeId) {
    const digits = normalizeStylistPhone(phone);
    if (!digits) return { ok: true, phone: '' };
    if (!isValidStylistPhone(digits)) {
        return { ok: false, message: '手机号格式不正确' };
    }
    const dup = dbStylistAccounts.getByPhone(digits, excludeId);
    if (dup) return { ok: false, message: '该手机号已被其他发型师使用' };
    return { ok: true, phone: digits };
}

function duplicateStoreName(sourceName) {
    const base = String(sourceName || '门店').replace(/（副本）$/u, '').trim();
    const suffix = '副本';
    const maxBase = STORE_NAME_MAX_LEN - suffix.length;
    return `${base.slice(0, Math.max(1, maxBase))}${suffix}`;
}

function createPlatformRouter(deps) {
    const {
        dbSessions,
        dbAppointments,
        dbStores,
        dbPhoneBlacklist,
        dbAuditLogs,
        dbStylistAccounts,
        publicStylistRow,
        stylists,
        getTodayDate,
        normalizePhone,
        syncStylistsRef,
        generateStoreWxacode,
        invokeCloudFunction,
        refreshSmsTemplateStatus,
        SMS_ENABLED
    } = deps;

    const router = express.Router();

    function getAdminCredentials() {
        return {
            username: String(process.env.ADMIN_USERNAME || 'admin').trim(),
            password: String(process.env.ADMIN_PASSWORD || 'admin123').trim()
        };
    }

    function getSession(req) {
        const sessionId = req.headers['x-session-id'];
        if (!sessionId) return null;
        return dbSessions.get(sessionId);
    }

    function requirePlatformAdmin(req, res, next) {
        const session = getSession(req);
        if (!session || session.role !== 'platform_admin') {
            return res.status(401).json({ success: false, message: '未登录或无权访问' });
        }
        req.platformSession = session;
        next();
    }

    function stylistStoreId(stylist) {
        return Number(stylist && stylist.storeId) || 1;
    }

    function storeNameByStylistId(stylistId) {
        const stylist = stylists.find(s => Number(s.id) === Number(stylistId));
        const store = dbStores.getById(stylistStoreId(stylist));
        return store ? store.name : '—';
    }

    function decorateAppointment(app) {
        const stylist = stylists.find(s => Number(s.id) === Number(app.stylistId));
        return {
            ...app,
            stylistName: stylist ? stylist.name : '—',
            storeName: storeNameByStylistId(app.stylistId),
            serviceLabel: app.serviceType === 'dye' ? '烫染' : '剪发',
            statusLabel: app.status === 'cancelled' ? '已取消'
                : app.status === 'completed' ? '已完成' : '待服务'
        };
    }

    function stylistStoreIdFromApp(app) {
        const stylist = stylists.find(s => Number(s.id) === Number(app.stylistId));
        return stylistStoreId(stylist);
    }

    function appointmentGroupKey(app) {
        return `${app.appId}|${app.date}|${app.phone}|${app.stylistId}`;
    }

    function filterAppointmentsForReport(query) {
        const { from, to, storeId } = query;
        let list = dbAppointments.getAll();
        if (from) list = list.filter(a => a.date >= from);
        if (to) list = list.filter(a => a.date <= to);
        if (storeId != null && storeId !== '') {
            const sid = Number(storeId);
            list = list.filter(a => stylistStoreIdFromApp(a) === sid);
        }
        return list;
    }

    function slotStartHour(timeStr) {
        const first = String(timeStr || '').split(',')[0].trim();
        const start = first.split('-')[0] || '';
        const hour = Number(start.split(':')[0]);
        return Number.isNaN(hour) ? null : hour;
    }

    function buildReportOverview(list) {
        const groups = new Map();
        list.forEach((app) => {
            const key = appointmentGroupKey(app);
            if (!groups.has(key)) {
                groups.set(key, {
                    key,
                    status: app.status,
                    serviceType: app.serviceType || 'cut',
                    storeId: stylistStoreIdFromApp(app),
                    hour: slotStartHour(app.time)
                });
            }
        });
        const orders = Array.from(groups.values());
        const total = orders.length;
        const cancelled = orders.filter(o => o.status === 'cancelled').length;
        const completed = orders.filter(o => o.status === 'completed').length;
        const booked = orders.filter(o => o.status === 'booked').length;
        const cut = orders.filter(o => o.serviceType !== 'dye').length;
        const dye = orders.filter(o => o.serviceType === 'dye').length;

        const hourMap = {};
        list.forEach((app) => {
            if (app.status === 'cancelled') return;
            const hour = slotStartHour(app.time);
            if (hour == null) return;
            hourMap[hour] = (hourMap[hour] || 0) + 1;
        });
        const peakHours = Object.entries(hourMap)
            .map(([hour, count]) => ({ hour: Number(hour), count }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

        const stores = dbStores.getAll();
        const byStore = stores.map((store) => {
            const storeOrders = orders.filter(o => o.storeId === store.id);
            const stTotal = storeOrders.length;
            const stCancelled = storeOrders.filter(o => o.status === 'cancelled').length;
            return {
                id: store.id,
                name: store.name,
                total: stTotal,
                booked: storeOrders.filter(o => o.status === 'booked').length,
                completed: storeOrders.filter(o => o.status === 'completed').length,
                cancelled: stCancelled,
                cancelRate: stTotal ? Math.round((stCancelled / stTotal) * 1000) / 10 : 0,
                cut: storeOrders.filter(o => o.serviceType !== 'dye').length,
                dye: storeOrders.filter(o => o.serviceType === 'dye').length
            };
        }).filter(row => row.total > 0 || stores.length <= 3);

        return {
            total,
            booked,
            completed,
            cancelled,
            cancelRate: total ? Math.round((cancelled / total) * 1000) / 10 : 0,
            cut,
            dye,
            dyeRate: total ? Math.round((dye / total) * 1000) / 10 : 0,
            peakHours,
            byStore
        };
    }

    function csvEscape(value) {
        const text = String(value == null ? '' : value);
        if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
        return text;
    }

    function writeAudit(req, action, meta = {}) {
        if (!dbAuditLogs || typeof dbAuditLogs.create !== 'function') return;
        dbAuditLogs.create({
            actor: (req.platformSession && req.platformSession.username) || '平台管理员',
            action,
            targetType: meta.targetType || '',
            targetId: meta.targetId != null ? String(meta.targetId) : '',
            storeId: meta.storeId != null ? Number(meta.storeId) : null,
            detail: meta.detail || null
        });
    }

    function appointmentSlotEnd(app) {
        const timePart = String(app.time || '').split(',')[0].trim();
        const endPart = timePart.includes('-') ? timePart.split('-')[1] : timePart;
        const [h, m] = endPart.split(':').map(Number);
        const parts = String(app.date || '').split('-').map(Number);
        if (parts.length < 3) return null;
        return new Date(parts[0], parts[1] - 1, parts[2], h || 0, m || 0, 0);
    }

    function isLikelyNoShow(app, now = new Date()) {
        if (app.status !== 'booked' && app.status !== 'pending') return false;
        const endAt = appointmentSlotEnd(app);
        return endAt != null && endAt < now;
    }

    function buildBlacklistSuggestions(query = {}) {
        const days = Math.min(Math.max(Number(query.days) || 90, 7), 365);
        const minCancel = Math.max(Number(query.minCancel) || 3, 1);
        const minNoShow = Math.max(Number(query.minNoShow) || 2, 1);
        const storeFilter = query.storeId != null && query.storeId !== ''
            ? Number(query.storeId)
            : null;
        const now = new Date();
        const fromDate = new Date(now);
        fromDate.setDate(fromDate.getDate() - days);
        const pad = (n) => String(n).padStart(2, '0');
        const fromYmd = `${fromDate.getFullYear()}-${pad(fromDate.getMonth() + 1)}-${pad(fromDate.getDate())}`;

        const buckets = new Map();
        dbAppointments.getAll().forEach((app) => {
            const phone = normalizePhone(app.phone);
            if (!/^1[3-9]\d{9}$/.test(phone)) return;
            const sid = stylistStoreIdFromApp(app);
            if (storeFilter != null && !Number.isNaN(storeFilter) && sid !== storeFilter) return;

            const key = `${phone}::${sid}`;
            if (!buckets.has(key)) {
                buckets.set(key, {
                    phone,
                    storeId: sid,
                    storeName: storeNameByStylistId(app.stylistId),
                    cancelled: 0,
                    noShow: 0,
                    total: 0
                });
            }
            const row = buckets.get(key);
            row.total += 1;
            if (app.status === 'cancelled' && app.date >= fromYmd) row.cancelled += 1;
            if (isLikelyNoShow(app, now)) row.noShow += 1;
        });

        const stores = dbStores.getAll();
        const suggestions = [];
        buckets.forEach((row) => {
            const reasons = [];
            if (row.cancelled >= minCancel) reasons.push(`近${days}天取消${row.cancelled}次`);
            if (row.noShow >= minNoShow) reasons.push(`疑似爽约${row.noShow}次`);
            if (!reasons.length) return;

            const storeScope = row.storeId;
            const blocked = dbPhoneBlacklist.findActive(row.phone, storeScope);
            if (blocked) return;

            suggestions.push({
                phone: row.phone,
                storeId: row.storeId,
                storeName: row.storeName || ((stores.find(s => s.id === row.storeId) || {}).name || `门店#${row.storeId}`),
                cancelled: row.cancelled,
                noShow: row.noShow,
                total: row.total,
                reason: reasons.join('；'),
                score: row.cancelled * 2 + row.noShow * 3
            });
        });

        suggestions.sort((a, b) => b.score - a.score);
        const limit = Math.min(Number(query.limit) || 50, 100);
        return suggestions.slice(0, limit);
    }

    router.post('/auth/login', (req, res) => {
        const { username: ADMIN_USERNAME, password: ADMIN_PASSWORD } = getAdminCredentials();
        const username = String(req.body.username || '').trim();
        const password = String(req.body.password || '');
        if (username !== ADMIN_USERNAME || password !== ADMIN_PASSWORD) {
            return res.json({ success: false, message: '用户名或密码错误' });
        }
        const sessionId = `platform_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        dbSessions.create(sessionId, {
            role: 'platform_admin',
            username: '平台管理员',
            stylistId: null
        });
        if (dbAuditLogs) {
            dbAuditLogs.create({
                actor: '平台管理员',
                action: 'auth.login',
                targetType: 'session',
                targetId: sessionId,
                detail: { ip: req.ip || '' }
            });
        }
        res.json({ success: true, sessionId, role: 'platform_admin', username: '平台管理员' });
    });

    router.get('/auth/verify', (req, res) => {
        const session = getSession(req);
        if (!session || session.role !== 'platform_admin') {
            return res.json({ valid: false });
        }
        res.json({ valid: true, role: session.role, username: session.username });
    });

    router.get('/sms/status', requirePlatformAdmin, async (req, res) => {
        if (!SMS_ENABLED) {
            return res.json({
                success: true,
                enabled: false,
                message: '未配置 EMAY_APPID / EMAY_SECRETKEY'
            });
        }
        try {
            const status = refreshSmsTemplateStatus
                ? await refreshSmsTemplateStatus()
                : { enabled: true, ready: {}, activeTemplateIds: {} };
            res.json({ success: true, ...status });
        } catch (e) {
            res.json({ success: false, message: e.message || '查询失败' });
        }
    });

    router.get('/dashboard/summary', requirePlatformAdmin, (req, res) => {
        const today = getTodayDate();
        const all = dbAppointments.getAll();
        const todayApps = all.filter(a => a.date === today && a.status !== 'cancelled');
        const pending = all.filter(a => a.status !== 'cancelled' && a.status !== 'completed');
        const stores = dbStores.getAll();
        res.json({
            success: true,
            today,
            storeCount: stores.length,
            todayAppointments: todayApps.length,
            pendingAppointments: pending.length,
            blacklistCount: dbPhoneBlacklist.getAll().length,
            stores: stores.map(s => ({
                id: s.id,
                name: s.name,
                status: s.status,
                todayCount: todayApps.filter(a => storeNameByStylistId(a.stylistId) === s.name).length
            }))
        });
    });

    router.get('/stores', requirePlatformAdmin, (req, res) => {
        res.json({ success: true, stores: dbStores.getAll() });
    });

    router.post('/cloud/sync-stores', requirePlatformAdmin, async (req, res) => {
        if (!invokeCloudFunction) {
            return res.json({ success: false, message: '未配置云函数调用' });
        }
        const secret = process.env.PLATFORM_SYNC_SECRET || '';
        if (!secret) {
            return res.json({
                success: false,
                message: '请在 .env 配置 PLATFORM_SYNC_SECRET，并在云函数环境变量中设置相同值'
            });
        }
        try {
            const stores = dbStores.getAll();
            const blacklist = dbPhoneBlacklist.getAll();
            const result = await invokeCloudFunction(process.env.CLOUD_FUNCTION_NAME || 'api', {
                action: 'syncStores',
                payload: { secret, stores, blacklist }
            });
            writeAudit(req, 'cloud.sync_stores', {
                detail: {
                    storeCount: stores.length,
                    blacklistCount: blacklist.length,
                    cloud: result
                }
            });
            if (result && result.success === false) {
                return res.json(result);
            }
            res.json({
                success: true,
                message: (result && result.message) || '已同步到云开发',
                result
            });
        } catch (e) {
            console.error('同步云开发失败:', e.message);
            res.json({ success: false, message: e.message || '同步失败' });
        }
    });

    router.get('/stores/:id', requirePlatformAdmin, (req, res) => {
        const store = dbStores.getById(req.params.id);
        if (!store) return res.status(404).json({ success: false, message: '门店不存在' });
        const storeStylists = stylists
            .filter(s => stylistStoreId(s) === Number(store.id))
            .map(s => ({ id: s.id, name: s.name, rank: s.rank || '', username: s.username }));
        res.json({ success: true, store, stylists: storeStylists });
    });

    router.post('/stores', requirePlatformAdmin, (req, res) => {
        const body = req.body || {};
        const nameCheck = normalizeStoreName(body.name);
        if (!nameCheck.ok) return res.json({ success: false, message: nameCheck.message });
        const code = String(body.code || `store-${Date.now()}`).trim();
        const store = dbStores.create({
            name: nameCheck.name,
            code,
            status: body.status === 'disabled' ? 'disabled' : 'active',
            address: body.address || '',
            phone: body.phone || '',
            latitude: body.latitude,
            longitude: body.longitude,
            workStart: body.workStart || '11:00',
            workEnd: body.workEnd || '22:30',
            slotIntervalMinutes: body.slotIntervalMinutes || 30,
            bookAheadDays: clampBookAheadDays(body.bookAheadDays),
            defaultBlockedSlots: Array.isArray(body.defaultBlockedSlots)
                ? body.defaultBlockedSlots
                : ['12:00-12:30', '18:00-18:30'],
            dyeSlotCount: body.dyeSlotCount || 4,
            announcementText: body.announcementText || '',
            smsCompanyName: body.smsCompanyName || '',
            miniProgramUrl: body.miniProgramUrl || ''
        });
        writeAudit(req, 'store.create', {
            targetType: 'store',
            targetId: store.id,
            storeId: store.id,
            detail: { name: store.name }
        });
        res.json({ success: true, store });
    });

    router.put('/stores/:id', requirePlatformAdmin, (req, res) => {
        const body = req.body || {};
        const patch = { ...body };
        if (Array.isArray(body.defaultBlockedSlots)) {
            patch.defaultBlockedSlots = body.defaultBlockedSlots;
        } else if (typeof body.defaultBlockedSlots === 'string') {
            patch.defaultBlockedSlots = body.defaultBlockedSlots
                .split(/[\n,]/)
                .map(s => s.trim())
                .filter(Boolean);
        }
        if (body.bookAheadDays != null) {
            patch.bookAheadDays = clampBookAheadDays(body.bookAheadDays);
        }
        if (body.name != null) {
            const nameCheck = normalizeStoreName(body.name);
            if (!nameCheck.ok) return res.json({ success: false, message: nameCheck.message });
            patch.name = nameCheck.name;
        }
        const store = dbStores.update(req.params.id, patch);
        if (!store) return res.status(404).json({ success: false, message: '门店不存在' });
        writeAudit(req, 'store.update', {
            targetType: 'store',
            targetId: store.id,
            storeId: store.id,
            detail: { name: store.name, fields: Object.keys(patch) }
        });
        res.json({ success: true, store });
    });

    router.patch('/stores/:id/status', requirePlatformAdmin, (req, res) => {
        const status = req.body && req.body.status === 'disabled' ? 'disabled' : 'active';
        const store = dbStores.update(req.params.id, { status });
        if (!store) return res.status(404).json({ success: false, message: '门店不存在' });
        writeAudit(req, 'store.status', {
            targetType: 'store',
            targetId: store.id,
            storeId: store.id,
            detail: { status }
        });
        res.json({ success: true, store });
    });

    router.get('/stores/:id/qrcode', requirePlatformAdmin, async (req, res) => {
        const store = dbStores.getById(req.params.id);
        if (!store) return res.status(404).json({ success: false, message: '门店不存在' });
        if (!generateStoreWxacode) {
            return res.status(500).json({ success: false, message: '未配置小程序码生成' });
        }
        try {
            const png = await generateStoreWxacode(store.id);
            res.setHeader('Content-Type', 'image/png');
            res.setHeader('Cache-Control', 'private, max-age=3600');
            res.setHeader('Content-Disposition', `inline; filename="store-${store.id}-qrcode.png"`);
            res.send(png);
        } catch (e) {
            console.error('生成门店小程序码失败:', e.message);
            res.status(500).json({ success: false, message: e.message || '生成小程序码失败' });
        }
    });

    router.post('/stores/:id/duplicate', requirePlatformAdmin, (req, res) => {
        const source = dbStores.getById(req.params.id);
        if (!source) return res.status(404).json({ success: false, message: '门店不存在' });
        const store = dbStores.create({
            name: duplicateStoreName(source.name),
            code: `${source.code || 'store'}-copy-${Date.now()}`,
            status: 'disabled',
            address: source.address || '',
            phone: source.phone || '',
            latitude: source.latitude,
            longitude: source.longitude,
            workStart: source.workStart,
            workEnd: source.workEnd,
            slotIntervalMinutes: source.slotIntervalMinutes,
            bookAheadDays: source.bookAheadDays,
            defaultBlockedSlots: source.defaultBlockedSlots,
            dyeSlotCount: source.dyeSlotCount,
            announcementText: source.announcementText || '',
            smsCompanyName: source.smsCompanyName || '',
            miniProgramUrl: source.miniProgramUrl || ''
        });
        writeAudit(req, 'store.duplicate', {
            targetType: 'store',
            targetId: store.id,
            storeId: store.id,
            detail: { sourceId: source.id, name: store.name }
        });
        res.json({ success: true, store });
    });

    router.get('/reports/overview', requirePlatformAdmin, (req, res) => {
        const list = filterAppointmentsForReport(req.query);
        res.json({
            success: true,
            from: req.query.from || '',
            to: req.query.to || '',
            ...buildReportOverview(list)
        });
    });

    router.get('/appointments', requirePlatformAdmin, (req, res) => {
        const { storeId, date, phone, status, risk, limit } = req.query;
        let list = dbAppointments.getAll();
        if (risk === 'no_show') {
            const now = new Date();
            list = list.filter((app) => isLikelyNoShow(app, now));
        }
        if (storeId) {
            const sid = Number(storeId);
            list = list.filter(a => {
                const stylist = stylists.find(s => Number(s.id) === Number(a.stylistId));
                return stylistStoreId(stylist) === sid;
            });
        }
        if (date) list = list.filter(a => a.date === date);
        if (phone) {
            const digits = normalizePhone(phone);
            list = list.filter(a => normalizePhone(a.phone).includes(digits));
        }
        if (status) list = list.filter(a => a.status === status);
        list = list.map(decorateAppointment);
        const max = Math.min(Number(limit) || 200, 500);
        res.json({ success: true, appointments: list.slice(0, max) });
    });

    router.post('/appointments/:id/cancel', requirePlatformAdmin, (req, res) => {
        const app = dbAppointments.findOne({ id: req.params.id })
            || dbAppointments.getAll().find(a => a.appId === req.params.id);
        if (!app) return res.json({ success: false, message: '预约不存在' });
        if (app.status === 'cancelled') return res.json({ success: false, message: '预约已取消' });
        if (app.status === 'completed') return res.json({ success: false, message: '预约已完成' });
        dbAppointments.updateStatus(app.id, 'cancelled');
        writeAudit(req, 'appointment.cancel', {
            targetType: 'appointment',
            targetId: app.appId || app.id,
            storeId: stylistStoreIdFromApp(app),
            detail: { phone: normalizePhone(app.phone), date: app.date }
        });
        res.json({ success: true, message: '已取消预约' });
    });

    router.post('/appointments/:id/complete', requirePlatformAdmin, (req, res) => {
        const app = dbAppointments.findOne({ id: req.params.id })
            || dbAppointments.getAll().find(a => a.appId === req.params.id);
        if (!app) return res.json({ success: false, message: '预约不存在' });
        if (app.status === 'cancelled') return res.json({ success: false, message: '预约已取消' });
        if (app.status === 'completed') return res.json({ success: false, message: '预约已完成' });
        dbAppointments.updateStatus(app.id, 'completed');
        writeAudit(req, 'appointment.complete', {
            targetType: 'appointment',
            targetId: app.appId || app.id,
            storeId: stylistStoreIdFromApp(app),
            detail: { phone: normalizePhone(app.phone), date: app.date }
        });
        res.json({ success: true, message: '已标记完成' });
    });

    router.get('/appointments/export', requirePlatformAdmin, (req, res) => {
        const { storeId, date, phone, status, from, to } = req.query;
        let list = dbAppointments.getAll();
        if (from) list = list.filter(a => a.date >= from);
        if (to) list = list.filter(a => a.date <= to);
        if (storeId) {
            const sid = Number(storeId);
            list = list.filter(a => stylistStoreIdFromApp(a) === sid);
        }
        if (date) list = list.filter(a => a.date === date);
        if (phone) {
            const digits = normalizePhone(phone);
            list = list.filter(a => normalizePhone(a.phone).includes(digits));
        }
        if (status) list = list.filter(a => a.status === status);
        list = list.map(decorateAppointment).sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return b.time.localeCompare(a.time);
        });
        const max = Math.min(Number(req.query.limit) || 5000, 10000);
        list = list.slice(0, max);

        const header = ['预约号', '门店', '发型师', '日期', '时间', '服务', '手机', '状态'];
        const lines = list.map((a) => [
            a.appId,
            a.storeName,
            a.stylistName,
            a.date,
            String(a.time).split(',')[0],
            a.serviceLabel,
            a.phone,
            a.statusLabel
        ].map(csvEscape).join(','));
        const csv = `\ufeff${header.join(',')}\n${lines.join('\n')}`;
        const filename = `appointments-${getTodayDate()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    });

    router.get('/appointments/history', requirePlatformAdmin, (req, res) => {
        const phone = normalizePhone(req.query.phone);
        if (!/^1[3-9]\d{9}$/.test(phone)) {
            return res.json({ success: false, message: '请输入正确的手机号' });
        }
        let list = dbAppointments.getAll().filter(a => normalizePhone(a.phone) === phone);
        if (req.query.storeId) {
            const sid = Number(req.query.storeId);
            list = list.filter(a => {
                const stylist = stylists.find(s => Number(s.id) === Number(a.stylistId));
                return stylist && Number(stylist.storeId) === sid;
            });
        }
        list = list.map(decorateAppointment).sort((a, b) => {
            if (a.date !== b.date) return b.date.localeCompare(a.date);
            return b.time.localeCompare(a.time);
        });
        const max = Math.min(Number(req.query.limit) || 50, 200);
        res.json({ success: true, appointments: list.slice(0, max) });
    });

    router.get('/stylists', requirePlatformAdmin, (req, res) => {
        let list = dbStylistAccounts.getAll();
        if (req.query.storeId) {
            const sid = Number(req.query.storeId);
            list = list.filter(s => Number(s.storeId) === sid);
        }
        const stores = dbStores.getAll();
        res.json({
            success: true,
            stylists: list.map(s => ({
                ...publicStylistRow(s),
                storeName: (stores.find(st => st.id === s.storeId) || {}).name || '—'
            }))
        });
    });

    router.get('/stylists/:id', requirePlatformAdmin, async (req, res) => {
        const stylist = dbStylistAccounts.getById(req.params.id);
        if (!stylist) return res.status(404).json({ success: false, message: '发型师不存在' });
        const photoPreviewUrl = await resolvePhotoPreviewUrl(stylist.photo, invokeCloudFunction);
        res.json({
            success: true,
            stylist: { ...stylist, photoPreviewUrl: photoPreviewUrl || stylist.photo || '' }
        });
    });

    router.post('/stylists/:id/avatar', requirePlatformAdmin, async (req, res) => {
        try {
            const stylist = dbStylistAccounts.getById(req.params.id);
            if (!stylist) return res.status(404).json({ success: false, message: '发型师不存在' });
            const upload = await uploadStylistAvatar(
                req.params.id,
                req.body && req.body.imageBase64,
                invokeCloudFunction
            );
            if (!upload.ok) return res.json({ success: false, message: upload.message || '上传失败' });
            const row = dbStylistAccounts.update(req.params.id, { photo: upload.photo });
            if (!row) return res.status(404).json({ success: false, message: '发型师不存在' });
            syncStylistsRef();
            writeAudit(req, 'stylist.update', {
                targetType: 'stylist',
                targetId: row.id,
                storeId: row.storeId,
                detail: { name: row.name, fields: ['photo'] }
            });
            res.json({
                success: true,
                photo: upload.photo,
                previewUrl: upload.previewUrl || upload.photo,
                stylist: publicStylistRow(row)
            });
        } catch (e) {
            res.json({ success: false, message: e.message || '上传失败' });
        }
    });

    router.post('/stylists', requirePlatformAdmin, (req, res) => {
        try {
            const body = req.body || {};
            const name = String(body.name || '').trim();
            const username = String(body.username || '').trim();
            const password = String(body.password || '').trim();
            const phoneCheck = validateStylistPhoneField(body.phone, dbStylistAccounts);
            if (!phoneCheck.ok) return res.json({ success: false, message: phoneCheck.message });
            if (!phoneCheck.phone) {
                return res.json({ success: false, message: '请填写手机号（用于小程序管理入口）' });
            }
            if (!name || !username || !password) {
                return res.json({ success: false, message: '请填写姓名、登录名和密码' });
            }
            const row = dbStylistAccounts.create({
                storeId: Number(body.storeId) || 1,
                name,
                username,
                phone: phoneCheck.phone,
                password,
                workStatus: body.workStatus === 'resting' ? 'resting' : 'working',
                rank: body.rank || '',
                specialty: body.specialty || '',
                price: body.price || '',
                photo: body.photo || '',
                enabled: body.enabled !== false
            });
            syncStylistsRef();
            writeAudit(req, 'stylist.create', {
                targetType: 'stylist',
                targetId: row.id,
                storeId: row.storeId,
                detail: { name: row.name, username: row.username }
            });
            res.json({ success: true, stylist: publicStylistRow(row) });
        } catch (e) {
            res.json({ success: false, message: e.message || '创建失败' });
        }
    });

    router.put('/stylists/:id', requirePlatformAdmin, (req, res) => {
        try {
            const body = req.body || {};
            const patch = { ...body };
            if (body.password != null) patch.password = String(body.password);
            if (body.enabled != null) patch.enabled = body.enabled !== false;
            if (body.phone != null) {
                const phoneCheck = validateStylistPhoneField(body.phone, dbStylistAccounts, req.params.id);
                if (!phoneCheck.ok) return res.json({ success: false, message: phoneCheck.message });
                patch.phone = phoneCheck.phone;
            }
            const row = dbStylistAccounts.update(req.params.id, patch);
            if (!row) return res.status(404).json({ success: false, message: '发型师不存在' });
            syncStylistsRef();
            writeAudit(req, 'stylist.update', {
                targetType: 'stylist',
                targetId: row.id,
                storeId: row.storeId,
                detail: { name: row.name, fields: Object.keys(patch) }
            });
            res.json({ success: true, stylist: publicStylistRow(row) });
        } catch (e) {
            res.json({ success: false, message: e.message || '更新失败' });
        }
    });

    router.get('/audit-logs', requirePlatformAdmin, (req, res) => {
        const logs = (dbAuditLogs && dbAuditLogs.list(req.query)) || [];
        const stores = dbStores.getAll();
        res.json({
            success: true,
            logs: logs.map((row) => ({
                ...row,
                storeName: row.storeId == null
                    ? '—'
                    : ((stores.find(s => s.id === row.storeId) || {}).name || `门店#${row.storeId}`)
            }))
        });
    });

    router.get('/blacklist/suggestions', requirePlatformAdmin, (req, res) => {
        res.json({
            success: true,
            days: Math.min(Math.max(Number(req.query.days) || 90, 7), 365),
            suggestions: buildBlacklistSuggestions(req.query)
        });
    });

    router.get('/blacklist', requirePlatformAdmin, (req, res) => {
        const { phone, storeId } = req.query;
        let list = dbPhoneBlacklist.getAll();
        if (phone) {
            const digits = normalizePhone(phone);
            list = list.filter(r => r.phone.includes(digits));
        }
        if (storeId !== undefined && storeId !== '') {
            const sid = storeId === 'global' ? null : Number(storeId);
            list = list.filter(r => (sid == null ? r.storeId == null : Number(r.storeId) === sid));
        }
        const stores = dbStores.getAll();
        list = list.map(row => ({
            ...row,
            scopeLabel: row.storeId == null
                ? '全平台'
                : ((stores.find(s => s.id === row.storeId) || {}).name || `门店#${row.storeId}`)
        }));
        res.json({ success: true, blacklist: list });
    });

    router.post('/blacklist', requirePlatformAdmin, (req, res) => {
        const phone = normalizePhone(req.body.phone);
        if (!/^1[3-9]\d{9}$/.test(phone)) {
            return res.json({ success: false, message: '请输入正确的手机号' });
        }
        const storeIdRaw = req.body.storeId;
        const storeId = storeIdRaw === 'global' || storeIdRaw === '' || storeIdRaw == null
            ? null
            : Number(storeIdRaw);
        const existing = dbPhoneBlacklist.findActive(phone, storeId == null ? 0 : storeId);
        if (existing && (existing.storeId == null || existing.storeId === storeId)) {
            return res.json({ success: false, message: '该手机号已在黑名单中' });
        }
        const row = dbPhoneBlacklist.create({
            storeId,
            phone,
            reason: req.body.reason || '',
            createdBy: req.platformSession.username,
            expiresAt: req.body.expiresAt || null
        });
        writeAudit(req, 'blacklist.add', {
            targetType: 'blacklist',
            targetId: row.id,
            storeId: storeId,
            detail: { phone, reason: row.reason, scope: storeId == null ? 'global' : 'store' }
        });
        res.json({ success: true, item: row });
    });

    router.delete('/blacklist/:id', requirePlatformAdmin, (req, res) => {
        const existing = dbPhoneBlacklist.getAll().find(r => Number(r.id) === Number(req.params.id));
        const ok = dbPhoneBlacklist.remove(req.params.id);
        if (!ok) return res.json({ success: false, message: '记录不存在' });
        writeAudit(req, 'blacklist.remove', {
            targetType: 'blacklist',
            targetId: req.params.id,
            storeId: existing ? existing.storeId : null,
            detail: existing ? { phone: existing.phone } : null
        });
        res.json({ success: true });
    });

    return router;
}

module.exports = { createPlatformRouter };
