// 加载环境变量（固定相对 server.js 的路径，避免启动目录不同导致读不到 .env）
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const express = require('express');
const bodyParser = require('body-parser');
const fs = require('fs');
const https = require('https');
const axios = require('axios');
const { sendBookingSuccessSMS, sendCancelBookingSMS, sendStylistCancelBookingSMS, initSmsTemplates, refreshSmsTemplateStatus, SMS_ENABLED } = require('./sms-service');
const {
    ready: dbReady,
    appointments: dbAppointments,
    blockedSlots: dbBlockedSlots,
    sessions: dbSessions,
    stylistVacations: dbStylistVacations,
    stores: dbStores,
    phoneBlacklist: dbPhoneBlacklist,
    auditLogs,
    stylistAccounts: dbStylistAccounts,
    publicStylistRow: dbPublicStylistRow,
    normalizePhoneDigits: dbNormalizePhoneDigits
} = require('./database');
const {
    buildSlotsForDate,
    validateSlotBookable,
    clampBookAheadDays,
    isDateWithinBookAhead
} = require('./slot-config');
const { createPlatformRouter } = require('./platform-routes');
const { ensureAvatarDir } = require('./avatar-upload');
const app = express();
app.use(bodyParser.json({ limit: '5mb' }));
// 静态文件延后挂载，确保 /api 等路由优先匹配（见文件末尾）

let wechatAccessTokenCache = { token: '', expiresAt: 0 };

const WECHAT_CLOUD_CERT_PATH = process.env.NODE_EXTRA_CA_CERTS || '/app/cert/certificate.crt';

function hasWechatCloudCert() {
    try {
        return fs.existsSync(WECHAT_CLOUD_CERT_PATH);
    } catch (_) {
        return false;
    }
}

/** 仅当显式开启时才走 HTTP 云调用；证书存在不代表开放接口服务已配置完成 */
function useWechatCloudOpenApi() {
    return process.env.WX_USE_OPENAPI === '1';
}

function getWechatApiBaseUrl() {
    return useWechatCloudOpenApi() ? 'http://api.weixin.qq.com' : 'https://api.weixin.qq.com';
}

function getWechatRequestConfig() {
    const config = { timeout: 10000 };
    if (!useWechatCloudOpenApi() && hasWechatCloudCert()) {
        config.httpsAgent = new https.Agent({
            ca: fs.readFileSync(WECHAT_CLOUD_CERT_PATH)
        });
    }
    return config;
}

function formatWechatApiError(e) {
    const status = e.response && e.response.status;
    const wechatMsg = e.response && e.response.data && (e.response.data.errmsg || e.response.data.message);
    if (status === 502) {
        return '微信接口网关异常(502)。若已开启开放接口服务，请确认权限含 /wxa/business/getuserphonenumber 并重新发布版本；否则请配置 WX_APPSECRET 后重试';
    }
    if (wechatMsg) return wechatMsg;
    if (e.message && e.message.includes('未配置 WX_APPSECRET')) return e.message;
    if (e.message && !/status code \d+/.test(e.message)) return e.message;
    return '获取手机号失败，请稍后重试';
}

function normalizePhone(phone) {
    return String(phone || '').replace(/\D/g, '');
}

function findStylistByAdminPhone(phone) {
    const digits = normalizePhone(phone);
    if (!digits) return null;
    const matches = stylists.filter((s) => (
        s.enabled !== false
        && normalizePhone(s.phone) === digits
    ));
    return matches.length === 1 ? matches[0] : null;
}

function createAdminSessionForPhone(phone) {
    const stylist = findStylistByAdminPhone(phone);
    if (!stylist) return null;

    const sessionId = 'stylist_' + stylist.id + '_' + Date.now() + '_phone';
    dbSessions.create(sessionId, {
        role: 'stylist',
        stylistId: stylist.id,
        username: stylist.name,
        phone: normalizePhone(phone)
    });
    return {
        sessionId,
        role: 'stylist',
        stylistId: stylist.id,
        stylistName: stylist.name
    };
}

async function getWechatAccessToken() {
    if (useWechatCloudOpenApi()) {
        return null;
    }
    const appid = process.env.WX_APPID || process.env.WECHAT_APPID || 'wxb76bea40dcb2999b';
    const secret = process.env.WX_APPSECRET || process.env.WECHAT_APPSECRET;
    if (!secret) {
        throw new Error('未配置 WX_APPSECRET');
    }
    if (wechatAccessTokenCache.token && Date.now() < wechatAccessTokenCache.expiresAt) {
        return wechatAccessTokenCache.token;
    }
    const { data } = await axios.get(`${getWechatApiBaseUrl()}/cgi-bin/token`, {
        params: {
            grant_type: 'client_credential',
            appid,
            secret
        },
        ...getWechatRequestConfig()
    });
    if (!data || !data.access_token) {
        throw new Error((data && data.errmsg) || '获取微信 access_token 失败');
    }
    wechatAccessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + Math.max(60, Number(data.expires_in || 7200) - 300) * 1000
    };
    return data.access_token;
}

async function generateStoreWxacode(storeId) {
    const accessToken = await getWechatAccessToken();
    const scene = `s=${Number(storeId)}`;
    const envVersion = process.env.WX_QRCODE_ENV_VERSION || 'release';
    const checkPath = process.env.WX_QRCODE_CHECK_PATH === '1';
    const { data } = await axios.post(
        `${getWechatApiBaseUrl()}/wxa/getwxacodeunlimit?access_token=${encodeURIComponent(accessToken)}`,
        {
            scene,
            page: 'pages/index/index',
            check_path: checkPath,
            width: 430,
            env_version: envVersion
        },
        { responseType: 'arraybuffer', ...getWechatRequestConfig() }
    );
    const buf = Buffer.from(data);
    if (buf.length < 512 && buf[0] === 0x7b) {
        let errMsg = '生成小程序码失败';
        try {
            const err = JSON.parse(buf.toString('utf8'));
            errMsg = err.errmsg || errMsg;
        } catch (_) { /* ignore */ }
        throw new Error(errMsg);
    }
    return buf;
}

async function invokeCloudFunction(name, event) {
    const accessToken = await getWechatAccessToken();
    const env = process.env.TCB_ENV_ID
        || process.env.WX_CLOUD_ENV
        || 'reservation-d2gf73dgv8fd17503';
    const { data } = await axios.post(
        `${getWechatApiBaseUrl()}/tcb/invokecloudfunction?access_token=${encodeURIComponent(accessToken)}`,
        {
            env,
            name: name || process.env.CLOUD_FUNCTION_NAME || 'api',
            req_data: JSON.stringify(event || {})
        },
        getWechatRequestConfig()
    );
    if (!data || data.errcode) {
        throw new Error((data && data.errmsg) || '云函数调用失败');
    }
    try {
        return JSON.parse(data.resp_data || '{}');
    } catch (_) {
        return { raw: data.resp_data };
    }
}

app.post('/api/wechat/phone-number', async (req, res) => {
    const { code } = req.body || {};
    if (!code) {
        return res.json({ success: false, message: '缺少手机号授权 code' });
    }
    try {
        let url = `${getWechatApiBaseUrl()}/wxa/business/getuserphonenumber`;
        if (!useWechatCloudOpenApi()) {
            const accessToken = await getWechatAccessToken();
            url += `?access_token=${encodeURIComponent(accessToken)}`;
        }
        const { data } = await axios.post(
            url,
            { code },
            getWechatRequestConfig()
        );
        const phoneNumber = data && data.phone_info && data.phone_info.phoneNumber;
        if (!phoneNumber) {
            return res.json({ success: false, message: (data && data.errmsg) || '获取手机号失败' });
        }
        const adminSession = createAdminSessionForPhone(phoneNumber);
        res.json({
            success: true,
            phone: phoneNumber,
            isAdmin: !!adminSession,
            adminSession
        });
    } catch (e) {
        console.error('获取微信手机号失败:', {
            message: e.message,
            code: e.code,
            status: e.response && e.response.status,
            response: e.response && e.response.data,
            useOpenApi: useWechatCloudOpenApi(),
            hasCloudCert: hasWechatCloudCert()
        });
        res.json({ success: false, message: formatWechatApiError(e) });
    }
});

// 提供根目录的 favicon.ico
app.get('/favicon.ico', (req, res) => {
    const faviconPath = path.join(__dirname, 'favicon.ico');
    if (fs.existsSync(faviconPath)) {
        res.sendFile(faviconPath);
    } else {
        // 如果根目录没有，尝试从 public 目录提供
        const publicFaviconPath = path.join(__dirname, 'public', 'favicon.ico');
        if (fs.existsSync(publicFaviconPath)) {
            res.sendFile(publicFaviconPath);
        } else {
            res.status(404).end();
        }
    }
});

// 设置时区（确保使用正确的时区）
process.env.TZ = process.env.TZ || 'Asia/Shanghai';

/**
 * 获取今天的日期（使用本地时区，格式：YYYY-MM-DD）
 */
function getTodayDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** 使用 YYYY-MM-DD 字符串比较日历日，避免 Date 解析与时区错位 */
function isYmdInVacation(stylist, ymd) {
    const ranges = stylist && Array.isArray(stylist.vacationRanges) ? stylist.vacationRanges : [];
    for (const r of ranges) {
        if (r.vacationStartDate && r.vacationEndDate && ymd >= r.vacationStartDate && ymd <= r.vacationEndDate) {
            return true;
        }
    }
    return false;
}

function stylistHasAnyVacationRange(stylist) {
    return Array.isArray(stylist.vacationRanges) && stylist.vacationRanges.length > 0;
}

function applyPersistedVacationsToStylists(list) {
    for (const s of list) {
        const dbRanges = dbStylistVacations.getRanges(s.id);
        if (dbRanges !== undefined) {
            s.vacationRanges = dbRanges;
        } else if (s.vacationStartDate && s.vacationEndDate) {
            s.vacationRanges = [
                { vacationStartDate: s.vacationStartDate, vacationEndDate: s.vacationEndDate }
            ];
        } else {
            s.vacationRanges = [];
        }
    }
}

/** 每次读接口时以数据库为准刷新内存中的休假区间，避免与持久层不一致 */
function refreshStylistVacationFromStore(stylist) {
    if (!stylist || stylist.id == null) return;
    const dbRanges = dbStylistVacations.getRanges(stylist.id);
    if (dbRanges !== undefined) {
        stylist.vacationRanges = dbRanges;
        const first = dbRanges[0];
        stylist.vacationStartDate = first ? first.vacationStartDate : null;
        stylist.vacationEndDate = first ? first.vacationEndDate : null;
    }
}

// 发型师数据：启动后从 MySQL 加载，空库时写入占位账号（请在 /platform/ 管理）
let stylists = [];

function getBootstrapStylists() {
    return [{
        id: 1,
        storeId: 1,
        name: '店长',
        workStatus: 'working',
        username: 'tony',
        password: 'change-me',
        phone: '',
        enabled: true
    }];
}

function getStoreForStylist(stylist) {
    const storeId = stylist && stylist.storeId != null ? Number(stylist.storeId) : 1;
    return dbStores.getById(storeId) || dbStores.getById(1) || dbStores.getAll()[0] || null;
}

function smsPayloadForStylist(stylist, payload) {
    const store = getStoreForStylist(stylist);
    if (!store) return payload;
    return {
        ...payload,
        shopName: store.name || payload.shopName || '门店',
        shopPhone: store.phone || payload.shopPhone || '',
        miniProgramUrl: store.miniProgramUrl || process.env.MINI_PROGRAM_URL || payload.miniProgramUrl
    };
}

function getBlacklistNoticeForPhone(phone) {
    const digits = dbNormalizePhoneDigits(phone);
    if (!digits) return null;
    const globalHit = dbPhoneBlacklist.getAll().find(
        (row) => row.phone === digits && row.storeId == null
    );
    if (globalHit) {
        return {
            scope: 'global',
            scopeLabel: '全平台',
            reason: globalHit.reason || '该手机号已被限制预约'
        };
    }
    const storeHits = dbPhoneBlacklist.getAll()
        .filter(row => row.phone === digits && row.storeId != null)
        .map((row) => {
            const store = dbStores.getById(row.storeId);
            return {
                scope: 'store',
                storeId: row.storeId,
                scopeLabel: (store && store.name) || `门店#${row.storeId}`,
                reason: row.reason || '该手机号在此门店已被限制预约'
            };
        });
    if (storeHits.length) return storeHits[0];
    return null;
}

function isPhoneBlacklistedForStylist(phone, stylist) {
    const store = getStoreForStylist(stylist);
    const storeId = store ? store.id : 1;
    const hit = dbPhoneBlacklist.findActive(phone, storeId);
    if (hit) return hit;
    return dbPhoneBlacklist.findActive(phone, null);
}

// 平台最高管理员 API（PC 端，与小程序 API 同端口部署）
app.use('/api/platform', createPlatformRouter({
    dbSessions,
    dbAppointments,
    dbStores,
    dbPhoneBlacklist,
    dbAuditLogs: auditLogs,
    dbStylistAccounts,
    publicStylistRow: dbPublicStylistRow,
    stylists,
    getTodayDate,
    normalizePhone: dbNormalizePhoneDigits,
    syncStylistsRef: () => dbStylistAccounts.syncToArray(stylists),
    generateStoreWxacode,
    invokeCloudFunction,
    getWechatAccessToken,
    getWechatApiBaseUrl,
    getWechatRequestConfig,
    useWechatCloudOpenApi,
    refreshSmsTemplateStatus,
    SMS_ENABLED
}));

// 平台管理 PC 端（Apple 风格 SPA，云托管 80 端口静态资源）
// 注意：Express 默认非严格路由下 /platform 会匹配 /platform/，若再 redirect 会死循环
app.get(['/platform', '/platform/'], (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'platform', 'index.html'));
});

// 使用数据库存储会话（已迁移到 database.js）



// 可以新增一个API获取轮播图
app.get('/api/carousel-images', (req, res) => {
    res.json([
        "https://images.unsplash.com/photo-1560066984-138dadb4c035?q=80&w=1000",
        "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?q=80&w=1000",
        "https://images.unsplash.com/photo-1503951914875-452162b0f3f1?q=80&w=1000"
    ]);
});

// 使用数据库存储（已迁移到 database.js）
// appointments、blockedSlots、sessions 现在都存储在 MySQL 数据库中

// --- API 接口 ---

// 用户端：营业门店列表（小程序选店 / 导航）
app.get('/api/stores', (req, res) => {
    const list = dbStores.getAll()
        .filter(s => s.status === 'active')
        .map(s => ({
            id: s.id,
            name: String(s.name || '').trim().slice(0, 6),
            phone: s.phone || '',
            latitude: s.latitude != null ? Number(s.latitude) : null,
            longitude: s.longitude != null ? Number(s.longitude) : null,
            bookAheadDays: clampBookAheadDays(s.bookAheadDays),
            status: s.status
        }));
    res.set('Cache-Control', 'no-store');
    res.json(list);
});

// 1. 获取所有发型师及其状态
app.get('/api/stylists', (req, res) => {
    const storeIdFilter = req.query.storeId != null && req.query.storeId !== ''
        ? Number(req.query.storeId)
        : null;

    const now = new Date();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;
    const today = getTodayDate();
    
    // 判断当前时间是否在工作时间内（11:00-22:30）
    const workStartMinutes = 11 * 60; // 11:00
    const workEndMinutes = 22 * 60 + 30; // 22:30
    const isWorkTime = currentTotalMinutes >= workStartMinutes && currentTotalMinutes < workEndMinutes;
    
    let stylistList = stylists.filter(s => s.enabled !== false);
    if (storeIdFilter != null && !Number.isNaN(storeIdFilter)) {
        stylistList = stylistList.filter(s => Number(s.storeId) === storeIdFilter);
    }

    const result = stylistList.map(s => {
        refreshStylistVacationFromStore(s);
        let displayStatus = 'working';
        let statusText = '';
        
        // 检查是否在任一休假日期范围内（YYYY-MM-DD 字符串比较）
        if (stylistHasAnyVacationRange(s)) {
            if (isYmdInVacation(s, today)) {
                statusText = '休假中';
                displayStatus = 'resting';
            } else if (isWorkTime) {
                // 工作时间：11:00-22:30
                statusText = '工作中';
                displayStatus = 'working';
            } else {
                // 休息时间：22:30-第二天11:00
                statusText = '休息中';
                displayStatus = 'resting';
            }
        } else {
            // 没有设置休假，根据时间判断
            if (isWorkTime) {
                statusText = '工作中';
                displayStatus = 'working';
            } else {
                statusText = '休息中';
                displayStatus = 'resting';
            }
        }
        
        const { password: _pw, ...pub } = s;
        return {
            ...pub,
            vacationRanges: Array.isArray(s.vacationRanges) ? s.vacationRanges : [],
            statusText,
            displayStatus
        };
    });
    res.set('Cache-Control', 'no-store');
    res.json(result);
});

// 获取可预约时间段
app.get('/api/slots/:stylistId', (req, res) => {
    const { stylistId } = req.params;
    const { date } = req.query;
    
    // 获取服务器当前时间（使用本地时区）
    const now = new Date();
    const today = getTodayDate();
    const targetDate = date || today;
    
    // 检查发型师是否存在
    const stylist = stylists.find(s => s.id == stylistId);
    if (!stylist) {
        return res.json([]);
    }
    refreshStylistVacationFromStore(stylist);
    
    const store = getStoreForStylist(stylist);
    if (!isDateWithinBookAhead(targetDate, today, store && store.bookAheadDays)) {
        return res.json([]);
    }

    // 优先：休假日期内不可预约（YYYY-MM-DD 字符串比较，与用户端「今天/明天/后天」一致）
    if (isYmdInVacation(stylist, targetDate)) {
        return res.json([]);
    }
    
    // 不再检查 workStatus，因为"休息中"只是当前时间不在工作时间内，但可以预约未来时段
    const slots = buildSlotsForDate({
        rules: store,
        targetDate,
        today,
        now,
        stylistId,
        appointmentsFind: cond => dbAppointments.find(cond),
        blockedFind: cond => dbBlockedSlots.find(cond)
    });

    res.json(slots);
});

// 在 server.js 中修改预约逻辑
let appointmentCounter = 1; // 用于生成自增编号

app.post('/api/book', (req, res) => {
    const { stylistId, time, userName, date, phone, serviceType } = req.body;
    
    // 检查发型师是否休息
    const stylist = stylists.find(s => s.id == stylistId);
    if (stylist) {
        refreshStylistVacationFromStore(stylist);
    }
    if (stylist && stylist.workStatus === 'resting') {
        return res.json({ success: false, message: '该发型师正在休息中，无法预约' });
    }
    
    const today = getTodayDate();
    const targetDate = date || today;
    if (stylist && isYmdInVacation(stylist, targetDate)) {
        return res.json({ success: false, message: '该日期发型师休假，无法预约' });
    }
    
    // 处理时间段：如果是烫染服务，time 可能是用逗号分隔的多个时间段（4个）
    const timeSlots = time.includes(',') ? time.split(',').map(t => t.trim()) : [time];
    
    // 检查时间段是否可用
    const now = new Date();
    
    const store = getStoreForStylist(stylist);
    if (!isDateWithinBookAhead(targetDate, today, store && store.bookAheadDays)) {
        return res.json({ success: false, message: '该日期不在可预约范围内' });
    }

    for (const timeSlot of timeSlots) {
        const check = validateSlotBookable({
            timeSlot,
            targetDate,
            today,
            now,
            stylistId,
            rules: store,
            appointmentsFind: cond => dbAppointments.find(cond),
            blockedFind: cond => dbBlockedSlots.find(cond)
        });
        if (!check.ok) {
            return res.json({ success: false, message: check.message });
        }
    }

    // 验证手机号格式（简单验证）
    if (!phone || !/^1[3-9]\d{9}$/.test(phone)) {
        return res.json({ success: false, message: '请输入正确的手机号码' });
    }

    const blacklistHit = isPhoneBlacklistedForStylist(phone, stylist);
    if (blacklistHit) {
        return res.json({
            success: false,
            message: blacklistHit.reason
                ? `无法预约：${blacklistHit.reason}`
                : '您的手机号已被限制预约，请联系门店'
        });
    }
    
    // 检查该手机号在目标日期是否已有有效预约（一个手机号一天内只能预约一次）
    // 只检查未取消和未完成的预约
    const existingAppointments = dbAppointments.find({
        phone: phone,
        date: targetDate
    }).filter(app => app.status !== 'cancelled' && app.status !== 'completed');
    
    if (existingAppointments.length > 0) {
        return res.json({ 
            success: false, 
            message: `您在该日期已有预约（预约号：${existingAppointments[0].appId}），一个手机号一天内只能预约一次` 
        });
    }
    
    // 预约号改为手机号后4位（用于显示）
    const appId = phone.slice(-4);
    
    // 为每个时间段创建预约记录
    const baseTime = Date.now();
    timeSlots.forEach((timeSlot, index) => {
        // 生成唯一的 id（时间戳 + 随机数 + 索引，确保唯一性）
        const uniqueId = `${baseTime}-${index}-${Math.random().toString(36).substr(2, 9)}`;
        
        const newAppointment = {
            id: uniqueId,  // 使用唯一ID作为主键
            appId: appId,  // 手机号后4位用于显示
            stylistId: parseInt(stylistId),
            date: targetDate,
            time: timeSlot,  // 使用单个时间段
            userName: userName || '',
            user: userName || '',
            phone: phone, // 保存手机号用于取消验证
            status: 'booked',
            createdAt: new Date(),
            serviceType: serviceType || 'cut'  // 保存服务类型
        };
        
        dbAppointments.create(newAppointment);
    });
    
    // 发送预约成功短信（异步，不阻塞响应）
    const bookingStylist = stylists.find(s => s.id == stylistId);
    if (bookingStylist) {
        let displayTime = timeSlots[0];
        // 如果是烫染服务且有多个时间段，合并成一个时间段
        if (serviceType === 'dye' && timeSlots.length > 1) {
            // 按时间排序
            const sortedSlots = [...timeSlots].sort();
            const firstTime = sortedSlots[0];
            const lastTime = sortedSlots[sortedSlots.length - 1];
            // 提取开始时间和结束时间
            const [firstStart] = firstTime.split('-');
            const [, lastEnd] = lastTime.split('-');
            displayTime = `${firstStart}-${lastEnd}`;
        } else if (timeSlots.length > 1) {
            // 其他情况，使用原来的显示方式
            displayTime = timeSlots.join('、');
        }
        
        sendBookingSuccessSMS(smsPayloadForStylist(bookingStylist, {
            phone: phone,
            appId: appId,
            stylistName: bookingStylist.name,
            date: targetDate,
            time: displayTime
        })).catch(err => {
            console.error('短信发送异常（不影响预约）:', err.message);
        });
    }
    
    res.json({ success: true, appId: appId });
});

// ========== 认证相关 API ==========

// 登录（仅支持发型师登录）
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    
    console.log(`[登录尝试] 用户名: ${username}`);
    
    // 检查是否为发型师
    const stylist = stylists.find(s => s.username === username && s.password === password);
    if (stylist) {
        if (stylist.enabled === false) {
            return res.json({ success: false, message: '该账号已停用，请联系平台管理员' });
        }
        const sessionId = 'stylist_' + stylist.id + '_' + Date.now();
        dbSessions.create(sessionId, { role: 'stylist', stylistId: stylist.id, username: stylist.name });
        console.log(`[登录成功] 发型师登录: ${stylist.name}，SessionId: ${sessionId}`);
        return res.json({ success: true, sessionId, role: 'stylist', stylistId: stylist.id, stylistName: stylist.name });
    }
    
    console.log(`[登录失败] 用户名或密码错误: ${username}`);
    res.json({ success: false, message: '用户名或密码错误' });
});

// 验证会话
app.get('/api/auth/verify', (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const session = dbSessions.get(sessionId);
    if (!session) {
        return res.json({ valid: false });
    }
    res.json({ valid: true, ...session });
});

// ========== 管理端 API ==========

// 中间件：验证登录
function requireAuth(req, res, next) {
    const sessionId = req.headers['x-session-id'];
    const session = dbSessions.get(sessionId);
    if (!session) {
        return res.status(401).json({ error: '未登录' });
    }
    req.session = session;
    next();
}

// 获取发型师的预约
app.get('/api/admin/appointments', requireAuth, (req, res) => {
    const { role, stylistId } = req.session;
    
    if (role !== 'stylist') {
        return res.status(403).json({ error: '需要发型师权限' });
    }
    
    // 发型师：返回自己的预约（包含已取消和已完成的，用于统计和显示）
    let allApps = dbAppointments.find({ stylistId: stylistId });
    // 不在这里过滤已取消的预约，让前端来决定是否显示
    
    // 合并染烫服务的两个时间段记录
    // 使用 processedIds 来跟踪已处理的记录 id，避免重复处理
    const mergedApps = [];
    const processedIds = new Set(); // 跟踪已处理的记录 id
    
    // 先按状态排序，有效预约优先，然后按创建时间排序
    allApps.sort((a, b) => {
        const statusOrder = { 'booked': 0, 'pending': 0, 'completed': 1, 'cancelled': 2 };
        const aOrder = statusOrder[a.status] !== undefined ? statusOrder[a.status] : 3;
        const bOrder = statusOrder[b.status] !== undefined ? statusOrder[b.status] : 3;
        if (aOrder !== bOrder) {
            return aOrder - bOrder;
        }
        // 相同状态时，按创建时间排序（新的在前）
        const aTime = new Date(a.createdAt || 0).getTime();
        const bTime = new Date(b.createdAt || 0).getTime();
        return bTime - aTime;
    });
    
    allApps.forEach(app => {
        // 如果已经处理过这个记录，跳过
        if (processedIds.has(app.id)) {
            return;
        }
        
        // 判断是否为新客：查询该手机号是否有已完成的预约记录
        // 只有当预约完成后（status === 'completed'），才判断为老客
        // 否则显示新客
        const allUserAppointments = dbAppointments.find({ phone: app.phone });
        
        // 查找该手机号是否有已完成的预约记录（排除当前预约和同一批预约的记录）
        const appCreatedTime = new Date(app.createdAt || 0).getTime();
        let hasCompletedAppointments = false;
        
        if (app.serviceType === 'dye') {
            // 对于染烫服务，同一批预约会有多个时间段记录
            // 需要排除这些记录来判断
            const sameBatchAppIds = new Set();
            allUserAppointments.forEach(a => {
                if (a.id === app.id) return; // 跳过当前记录
                if (a.appId === app.appId && 
                    a.phone === app.phone && 
                    a.date === app.date &&
                    a.serviceType === 'dye' &&
                    Math.abs(new Date(a.createdAt || 0).getTime() - appCreatedTime) < 60000) {
                    // 同一批预约的记录，不计算
                    sameBatchAppIds.add(a.id);
                }
            });
            // 检查是否有已完成的预约（排除同一批的）
            hasCompletedAppointments = allUserAppointments.some(a => 
                a.id !== app.id && 
                !sameBatchAppIds.has(a.id) &&
                a.status === 'completed'
            );
        } else {
            // 剪发服务，检查是否有已完成的预约（排除当前记录）
            hasCompletedAppointments = allUserAppointments.some(a => 
                a.id !== app.id && 
                a.status === 'completed'
            );
        }
        
        // 如果有已完成的预约，则是老客；否则是新客
        const isNewUser = !hasCompletedAppointments;
        
        // 如果是染烫服务，查找同一预约的其他时间段记录
        // 需要确保是同一个预约：相同的 appId、phone、date、serviceType、status
        // 并且创建时间相近（同一批创建的）
        if (app.serviceType === 'dye') {
            // 查找同一 appId、phone、date、serviceType、status 的其他记录
            // 并且创建时间在合理范围内（同一批预约）
            const appCreatedTime = new Date(app.createdAt || 0).getTime();
            const relatedApps = allApps.filter(a => 
                !processedIds.has(a.id) && // 未被处理过
                a.appId === app.appId && 
                a.phone === app.phone && 
                a.date === app.date &&
                a.serviceType === 'dye' &&
                a.status === app.status && // 只合并相同状态的记录
                Math.abs(new Date(a.createdAt || 0).getTime() - appCreatedTime) < 60000 // 创建时间相差小于1分钟（同一批预约）
            );
            
            if (relatedApps.length > 1) {
                // 合并时间段：按时间排序，取第一个的开始时间和最后一个的结束时间
                relatedApps.sort((a, b) => a.time.localeCompare(b.time));
                const firstTime = relatedApps[0].time;
                const lastTime = relatedApps[relatedApps.length - 1].time;
                
                // 提取开始时间和结束时间
                const [firstStart] = firstTime.split('-');
                const [, lastEnd] = lastTime.split('-');
                
                // 创建合并后的预约记录
                const mergedApp = {
                    ...app,
                    time: `${firstStart}-${lastEnd}`, // 合并时间段
                    originalTimeSlots: relatedApps.map(a => a.time), // 保存原始时间段，用于后续操作
                    isNewUser: isNewUser // 添加新用户标识
                };
                
                mergedApps.push(mergedApp);
                // 标记所有相关记录为已处理
                relatedApps.forEach(relatedApp => {
                    processedIds.add(relatedApp.id);
                });
            } else {
                // 只有一个记录，直接添加
                mergedApps.push({ ...app, isNewUser: isNewUser });
                processedIds.add(app.id);
            }
        } else {
            // 剪发服务，直接添加
            mergedApps.push({ ...app, isNewUser: isNewUser });
            processedIds.add(app.id);
        }
    });
    
    res.json(mergedApps);
});

// 取消预约
app.post('/api/admin/cancel', requireAuth, (req, res) => {
    const { appointmentId } = req.body; // 使用唯一的 id
    const { role, stylistId } = req.session;
    
    // 使用唯一的 id 查找预约
    const app = dbAppointments.findOne({ id: appointmentId });
    if (!app) {
        return res.json({ success: false, message: '预约不存在' });
    }
    
    // 检查预约状态
    if (app.status === 'cancelled') {
        return res.json({ success: false, message: '该预约已取消' });
    }
    
    if (app.status === 'completed') {
        return res.json({ success: false, message: '该预约已完成' });
    }
    
    // 检查权限：发型师只能取消自己的预约
    if (role === 'stylist' && app.stylistId !== stylistId) {
        return res.status(403).json({ error: '无权取消此预约' });
    }
    
    // 如果是染烫服务，需要获取合并后的时间段，并更新所有相关记录
    let displayTime = app.time;
    if (app.serviceType === 'dye') {
        // 查找所有相同 appId、phone、date 的记录
        // 对于烫染服务，不依赖创建时间判断，而是查找所有相同条件的记录
        const allRelatedApps = dbAppointments.find({
            appId: app.appId,
            phone: app.phone,
            date: app.date,
            serviceType: 'dye'
        });
        
        // 过滤出有效预约（状态不是已取消或已完成）
        // 不依赖创建时间判断，因为可能存在创建时间差异
        let relatedApps = allRelatedApps.filter(relatedApp => {
            return relatedApp.status !== 'cancelled' && relatedApp.status !== 'completed';
        });
        
        // 确保 app 本身也被包含在 relatedApps 中（无论是否在查找结果中）
        // 因为 app 是用户点击取消的记录，必须被取消
        const appInRelated = relatedApps.some(relatedApp => relatedApp.id === app.id);
        if (!appInRelated) {
            // 如果 app 不在 relatedApps 中，直接添加（即使状态可能已经是 cancelled，也要确保更新）
            relatedApps.push(app);
        }
        
        // 按时间段排序，确保顺序正确
        relatedApps.sort((a, b) => a.time.localeCompare(b.time));
        
        // 使用 Set 去重，避免重复更新同一个记录
        const uniqueRelatedApps = [];
        const seenIds = new Set();
        relatedApps.forEach(relatedApp => {
            if (!seenIds.has(relatedApp.id)) {
                uniqueRelatedApps.push(relatedApp);
                seenIds.add(relatedApp.id);
            }
        });
        
        if (uniqueRelatedApps.length > 1) {
            // 合并时间段：按时间排序，取第一个的开始时间和最后一个的结束时间
            const firstTime = uniqueRelatedApps[0].time;
            const lastTime = uniqueRelatedApps[uniqueRelatedApps.length - 1].time;
            const [firstStart] = firstTime.split('-');
            const [, lastEnd] = lastTime.split('-');
            displayTime = `${firstStart}-${lastEnd}`;
            
            // 更新所有相关记录的状态（使用唯一的 id）
            // 确保所有记录都被更新，包括 app 本身
            uniqueRelatedApps.forEach(relatedApp => {
                const success = dbAppointments.updateStatus(relatedApp.id, 'cancelled');
                if (!success) {
                    console.error(`[取消预约] 更新失败: id=${relatedApp.id}, time=${relatedApp.time}, status=${relatedApp.status}`);
                }
            });
        } else {
            // 只有一个记录，正常更新（使用唯一的 id）
            const success = dbAppointments.updateStatus(app.id, 'cancelled');
            if (!success) {
                console.error(`[取消预约] 更新失败: id=${app.id}, time=${app.time}, status=${app.status}`);
            }
        }
    } else {
        // 剪发服务，正常更新（使用唯一的 id）
        dbAppointments.updateStatus(app.id, 'cancelled');
    }
    console.log(`[短信提醒] 您的预约 ${app.appId} 已由发型师取消。`);
    
    // 发送取消预约短信（异步，不阻塞响应）
    const cancelStylist = stylists.find(s => s.id == app.stylistId);
    if (cancelStylist && app.phone) {
        sendStylistCancelBookingSMS(smsPayloadForStylist(cancelStylist, {
            phone: app.phone,
            appId: app.appId,
            stylistName: cancelStylist.name,
            date: app.date,
            time: displayTime
        })).catch(err => {
            console.error('短信发送异常（不影响取消）:', err.message);
        });
    }
    
    res.json({ success: true });
});

// 锁定时间段
app.post('/api/admin/block', requireAuth, (req, res) => {
    const { stylistId, date, time } = req.body;
    const { role, stylistId: sessionStylistId } = req.session;
    
    // 检查权限：发型师只能锁定自己的时间段
    if (role === 'stylist' && stylistId != sessionStylistId) {
        return res.status(403).json({ error: '无权操作此发型师的时间段' });
    }
    
    const now = new Date();
    const today = getTodayDate();
    const targetDate = date || today;
    
    // 检查是否是默认锁定的时间段（12:00-12:30 和 18:00-18:30）
    // 如果是，并且之前已解锁（有 _UNLOCKED 标记），则删除解锁标记
    const isDefaultMealTime = (time === '12:00-12:30' || time === '18:00-18:30');
    if (isDefaultMealTime) {
        // 删除解锁标记（如果存在）
        dbBlockedSlots.delete({ stylistId: parseInt(stylistId), date: targetDate, time: time + '_UNLOCKED' });
        // 注意：对于默认锁定的时间段，不需要创建锁定记录，因为它们默认就是锁定的
        // 只需要删除解锁标记即可
    } else {
        // 普通时间段，创建锁定记录
        dbBlockedSlots.create({ stylistId: parseInt(stylistId), date: targetDate, time });
    }
    res.json({ success: true });
});

// 完成预约
app.post('/api/admin/complete', requireAuth, (req, res) => {
    const { appointmentId } = req.body; // 使用唯一的 id
    const { role, stylistId } = req.session;
    
    try {
        // 使用唯一的 id 查找预约
        const appointment = dbAppointments.findOne({ id: appointmentId });
        if (!appointment) {
            return res.json({ success: false, message: '预约不存在' });
        }
        
        // 检查权限：发型师只能完成自己的预约
        if (role === 'stylist' && appointment.stylistId != stylistId) {
            return res.status(403).json({ error: '无权限操作' });
        }
        
        // 检查预约状态
        if (appointment.status === 'cancelled') {
            return res.json({ success: false, message: '该预约已取消' });
        }
        
        if (appointment.status === 'completed') {
            return res.json({ success: false, message: '该预约已完成' });
        }
        
        // 如果是染烫服务，需要完成所有相关的时间段
        if (appointment.serviceType === 'dye') {
            // 查找所有相同 appId、phone、date 的记录
            // 对于烫染服务，不依赖创建时间判断，而是查找所有相同条件的记录
            const allRelatedApps = dbAppointments.find({
                appId: appointment.appId,
                phone: appointment.phone,
                date: appointment.date,
                serviceType: 'dye'
            });
            
            // 过滤出有效预约（状态不是已取消或已完成）
            // 不依赖创建时间判断，因为可能存在创建时间差异
            let relatedApps = allRelatedApps.filter(relatedApp => {
                return relatedApp.status !== 'cancelled' && relatedApp.status !== 'completed';
            });
            
            // 确保 appointment 本身也被包含在 relatedApps 中
            // 因为 appointment 是用户点击完成的记录，必须被完成
            const appointmentInRelated = relatedApps.some(relatedApp => relatedApp.id === appointment.id);
            if (!appointmentInRelated && appointment.status !== 'cancelled' && appointment.status !== 'completed') {
                relatedApps.push(appointment);
            }
            
            // 按时间段排序，确保顺序正确
            relatedApps.sort((a, b) => a.time.localeCompare(b.time));
            
            // 更新所有相关记录的状态（使用唯一的 id）
            // 确保所有记录都被更新，包括 appointment 本身
            relatedApps.forEach(relatedApp => {
                dbAppointments.updateStatus(relatedApp.id, 'completed');
            });
        } else {
            // 剪发服务，只更新当前记录（使用唯一的 id）
            dbAppointments.updateStatus(appointment.id, 'completed');
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('完成预约失败:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

// 解锁时间段
app.post('/api/admin/unblock', requireAuth, (req, res) => {
    const { stylistId, date, time } = req.body;
    const { role, stylistId: sessionStylistId } = req.session;
    
    // 检查权限：发型师只能解锁自己的时间段
    if (role === 'stylist' && stylistId != sessionStylistId) {
        return res.status(403).json({ error: '无权操作此发型师的时间段' });
    }
    
    const now = new Date();
    const today = getTodayDate();
    const targetDate = date || today;
    
    // 检查是否是默认锁定的时间段（12:00-12:30 和 18:00-18:30）
    // 如果是，则创建解锁标记（使用特殊格式：time + '_UNLOCKED'）
    const isDefaultMealTime = (time === '12:00-12:30' || time === '18:00-18:30');
    if (isDefaultMealTime) {
        // 创建解锁标记
        dbBlockedSlots.create({ 
            stylistId: parseInt(stylistId), 
            date: targetDate, 
            time: time + '_UNLOCKED' 
        });
        res.json({ success: true });
    } else {
        // 普通时间段，删除锁定记录
        const deleted = dbBlockedSlots.delete({ stylistId: parseInt(stylistId), date: targetDate, time });
        res.json({ success: deleted });
    }
});

// 获取锁定时间段列表
app.get('/api/admin/blocked-slots', requireAuth, (req, res) => {
    const { stylistId, date } = req.query;
    const { role, stylistId: sessionStylistId } = req.session;
    
    // 检查权限：发型师只能查看自己的锁定时间段
    if (role === 'stylist' && stylistId != sessionStylistId) {
        return res.status(403).json({ error: '无权查看此发型师的锁定时间段' });
    }
    
    const conditions = { stylistId: parseInt(stylistId) };
    if (date) {
        conditions.date = date;
    }
    const blocked = dbBlockedSlots.find(conditions);
    res.json(blocked);
});

// 获取当前发型师信息（发型师管理端）
app.get('/api/admin/stylist/info', requireAuth, (req, res) => {
    const { role, stylistId } = req.session;
    if (role !== 'stylist') {
        return res.status(403).json({ error: '需要发型师权限' });
    }
    const stylist = stylists.find(s => s.id == stylistId);
    if (!stylist) {
        return res.status(404).json({ error: '发型师不存在' });
    }
    refreshStylistVacationFromStore(stylist);
    const { password, ...stylistWithoutPassword } = stylist;
    res.set('Cache-Control', 'no-store');
    res.json({
        ...stylistWithoutPassword,
        vacationRanges: Array.isArray(stylist.vacationRanges) ? stylist.vacationRanges : []
    });
});

function normalizeVacationRangesFromBody(body) {
    if (body && Array.isArray(body.vacationRanges)) {
        const out = [];
        for (const it of body.vacationRanges) {
            if (!it || typeof it !== 'object') continue;
            const a = String(it.vacationStartDate || '').trim();
            const b = String(it.vacationEndDate || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(a) || !/^\d{4}-\d{2}-\d{2}$/.test(b)) continue;
            if (a > b) return { error: '开始日期不能晚于结束日期' };
            out.push({ vacationStartDate: a, vacationEndDate: b });
        }
        return { ranges: out };
    }
    const startStr = body && body.vacationStartDate ? String(body.vacationStartDate).trim() : '';
    const endStr = body && body.vacationEndDate ? String(body.vacationEndDate).trim() : '';
    if (!startStr && !endStr) return { ranges: [] };
    if (!startStr || !endStr) return { error: '请选择开始和结束日期' };
    if (startStr > endStr) return { error: '开始日期不能晚于结束日期' };
    return { ranges: [{ vacationStartDate: startStr, vacationEndDate: endStr }] };
}

// 设置发型师休假日期（支持多段 vacationRanges；兼容旧版单段字段）
app.post('/api/admin/stylist/vacation', requireAuth, (req, res) => {
    const { role, stylistId } = req.session;
    if (role !== 'stylist') {
        return res.status(403).json({ error: '需要发型师权限' });
    }

    const stylist = stylists.find(s => s.id == stylistId);
    if (!stylist) {
        return res.status(404).json({ error: '发型师不存在' });
    }

    const parsed = normalizeVacationRangesFromBody(req.body || {});
    if (parsed.error) {
        return res.json({ success: false, message: parsed.error });
    }
    const ranges = parsed.ranges;

    for (const r of ranges) {
        const conflictingApps = dbAppointments.find({
            stylistId: stylistId,
            status: ['booked', 'pending']
        }).filter(app => {
            if (app.status === 'cancelled' || app.status === 'completed') return false;
            return app.date >= r.vacationStartDate && app.date <= r.vacationEndDate;
        });

        if (conflictingApps.length > 0) {
            const conflictDates = [...new Set(conflictingApps.map(app => app.date))].sort();
            const conflictDatesStr = conflictDates.map(ymd => {
                const parts = String(ymd).split('-');
                const m = parts[1] ? parseInt(parts[1], 10) : 0;
                const d = parts[2] ? parseInt(parts[2], 10) : 0;
                return `${m}月${d}日`;
            }).join('、');
            return res.json({
                success: false,
                message: `以下日期已有预约，无法设置休假：${conflictDatesStr}。请先取消这些预约后再设置休假。`
            });
        }
    }

    stylist.vacationRanges = ranges;
    const first = ranges[0];
    stylist.vacationStartDate = first ? first.vacationStartDate : null;
    stylist.vacationEndDate = first ? first.vacationEndDate : null;
    dbStylistVacations.set(stylist.id, ranges);
    refreshStylistVacationFromStore(stylist);

    res.json({ success: true, vacationRanges: stylist.vacationRanges });
});

// ========== 公告 API ==========
const dataDir = path.join(__dirname, 'data');
const announcementFile = path.join(dataDir, 'announcement.json');
const DEFAULT_ANNOUNCEMENT_TEXT = '欢迎光临欧诺造型，本店营业时间 11:00-22:00，请提前预约到店！';

function getAnnouncementText(storeId = 1) {
    const store = dbStores.getById(storeId) || dbStores.getAll()[0];
    if (store && String(store.announcementText || '').trim()) {
        return String(store.announcementText).trim();
    }
    try {
        if (fs.existsSync(announcementFile)) {
            const data = fs.readFileSync(announcementFile, 'utf8');
            const obj = JSON.parse(data);
            const legacy = (obj.text != null ? String(obj.text) : '').trim();
            if (legacy) return legacy;
        }
    } catch (e) {
        console.error('读取公告失败:', e.message);
    }
    return DEFAULT_ANNOUNCEMENT_TEXT;
}

function saveAnnouncementForStore(storeId, text) {
    const store = dbStores.getById(storeId) || dbStores.getAll()[0];
    if (!store) return false;
    dbStores.update(store.id, { announcementText: text || '' });
    return true;
}

// 用户端：获取公告（无需登录）
app.get('/api/announcement', (req, res) => {
    const storeId = Number(req.query.storeId) || 1;
    res.json({ text: getAnnouncementText(storeId) });
});

// 管理端：获取公告
app.get('/api/admin/announcement', requireAuth, (req, res) => {
    const stylist = stylists.find(s => Number(s.id) === Number(req.session.stylistId));
    const storeId = stylist && stylist.storeId != null ? Number(stylist.storeId) : 1;
    res.json({ text: getAnnouncementText(storeId) });
});

// 管理端：保存公告
app.post('/api/admin/announcement', requireAuth, (req, res) => {
    const text = req.body && req.body.text != null ? String(req.body.text).trim() : '';
    const stylist = stylists.find(s => Number(s.id) === Number(req.session.stylistId));
    const storeId = stylist && stylist.storeId != null ? Number(stylist.storeId) : 1;
    if (!saveAnnouncementForStore(storeId, text)) {
        return res.status(500).json({ success: false, message: '保存失败' });
    }
    res.json({ success: true });
});

// ========== 用户端取消预约 API ==========

// 查询用户预约（用于取消预约时显示）
app.post('/api/appointments/query', (req, res) => {
    const { phone } = req.body;
    
    if (!phone) {
        return res.json({ success: false, message: '请输入手机号' });
    }
    
    // 验证手机号格式
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.json({ success: false, message: '请输入正确的手机号码' });
    }
    
    // 获取今天的日期（用于过滤过去日期的预约）
    const now = new Date();
    const today = getTodayDate();
    
    // 查找该手机号的所有未取消和未完成的预约，并且只返回今天和未来的预约
    const userAppointments = dbAppointments.find({
        phone: phone
    }).filter(app => 
        app.status !== 'cancelled' && 
        app.status !== 'completed' &&
        app.date >= today // 只返回今天和未来的预约，过滤掉过去日期的预约
    );
    
    // 合并染烫服务的多个时间段记录（类似管理端的处理）
    const mergedAppointments = [];
    const processedIds = new Set(); // 跟踪已处理的记录 id
    
    // 先按日期和时间排序
    userAppointments.sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return a.time.localeCompare(b.time);
    });
    
    userAppointments.forEach(app => {
        // 如果已经处理过这个记录，跳过
        if (processedIds.has(app.id)) {
            return;
        }
        
        // 如果是染烫服务，查找同一批预约的其他时间段记录
        if (app.serviceType === 'dye') {
            const appCreatedTime = new Date(app.createdAt || 0).getTime();
            // 查找同一 appId、phone、date、serviceType 的其他记录
            // 并且创建时间相近（同一批预约）
            const relatedApps = userAppointments.filter(a => 
                !processedIds.has(a.id) && // 未被处理过
                a.appId === app.appId && 
                a.phone === app.phone && 
                a.date === app.date &&
                a.serviceType === 'dye' &&
                a.status === app.status && // 只合并相同状态的记录
                Math.abs(new Date(a.createdAt || 0).getTime() - appCreatedTime) < 60000 // 创建时间相差小于1分钟（同一批预约）
            );
            
            if (relatedApps.length > 1) {
                // 合并时间段：按时间排序，取第一个的开始时间和最后一个的结束时间
                relatedApps.sort((a, b) => a.time.localeCompare(b.time));
                const firstTime = relatedApps[0].time;
                const lastTime = relatedApps[relatedApps.length - 1].time;
                
                // 提取开始时间和结束时间
                const [firstStart] = firstTime.split('-');
                const [, lastEnd] = lastTime.split('-');
                
                // 创建合并后的预约记录
                const mergedApp = {
                    ...app,
                    time: `${firstStart}-${lastEnd}`, // 合并时间段
                    originalTimeSlots: relatedApps.map(a => a.time), // 保存原始时间段，用于取消时找到所有相关记录
                    originalIds: relatedApps.map(a => a.id) // 保存所有相关记录的 id，用于取消
                };
                
                mergedAppointments.push(mergedApp);
                // 标记所有相关记录为已处理
                relatedApps.forEach(relatedApp => {
                    processedIds.add(relatedApp.id);
                });
            } else {
                // 只有一个记录，直接添加
                mergedAppointments.push(app);
                processedIds.add(app.id);
            }
        } else {
            // 剪发服务，直接添加
            mergedAppointments.push(app);
            processedIds.add(app.id);
        }
    });
    
    // 检查是否可以取消
    // now 和 today 已在前面定义，这里不需要重复定义
    
    const appointments = mergedAppointments.map(app => {
        let canCancel = false;
        let reason = '';
        
        if (app.date === today) {
            // 当天预约即使已经到点也允许用户取消。
            canCancel = true;
        } else if (app.date > today) {
            // 未来日期的预约可以取消
            canCancel = true;
        } else {
            // 过去日期的预约不能取消
            canCancel = false;
            reason = '预约已过期，无法取消';
        }
        
        return {
            id: app.originalIds && app.originalIds.length > 0 ? app.originalIds[0] : app.id, // 使用第一个记录的 id 作为标识
            appId: app.appId,
            date: app.date,
            time: app.time, // 合并后的时间段
            serviceType: app.serviceType,
            status: app.status,
            stylistId: app.stylistId,
            canCancel,
            reason,
            originalIds: app.originalIds || [app.id] // 保存所有相关记录的 id，用于取消时找到所有记录
        };
    });
    
    const blacklistNotice = getBlacklistNoticeForPhone(phone);

    res.json({
        success: true,
        appointments,
        blacklistNotice
    });
});

app.post('/api/appointments/history', (req, res) => {
    const { phone } = req.body;
    if (!phone) {
        return res.json({ success: false, message: '请输入手机号' });
    }
    if (!/^1[3-9]\d{9}$/.test(phone)) {
        return res.json({ success: false, message: '请输入正确的手机号码' });
    }

    const rows = dbAppointments.find({ phone });
    rows.sort((a, b) => {
        if (a.date !== b.date) return b.date.localeCompare(a.date);
        return b.time.localeCompare(a.time);
    });

    const processedIds = new Set();
    const merged = [];
    rows.forEach(app => {
        if (processedIds.has(app.id)) return;
        if (app.serviceType === 'dye') {
            const appCreatedTime = new Date(app.createdAt || 0).getTime();
            const related = rows.filter(a =>
                !processedIds.has(a.id) &&
                a.appId === app.appId &&
                a.phone === app.phone &&
                a.date === app.date &&
                a.serviceType === 'dye' &&
                a.status === app.status &&
                Math.abs(new Date(a.createdAt || 0).getTime() - appCreatedTime) < 60000
            );
            if (related.length > 1) {
                related.sort((a, b) => a.time.localeCompare(b.time));
                const [firstStart] = related[0].time.split('-');
                const [, lastEnd] = related[related.length - 1].time.split('-');
                merged.push({
                    ...app,
                    time: `${firstStart}-${lastEnd}`,
                    originalIds: related.map(a => a.id)
                });
                related.forEach(a => processedIds.add(a.id));
            } else {
                merged.push({ ...app, originalIds: [app.id] });
                processedIds.add(app.id);
            }
        } else {
            merged.push({ ...app, originalIds: [app.id] });
            processedIds.add(app.id);
        }
    });

    res.json({
        success: true,
        appointments: merged.map(app => ({
            id: app.originalIds && app.originalIds.length > 0 ? app.originalIds[0] : app.id,
            appId: app.appId,
            date: app.date,
            time: app.time,
            serviceType: app.serviceType,
            status: app.status,
            stylistId: app.stylistId,
            originalIds: app.originalIds || [app.id]
        }))
    });
});

// 当日排队列表（用于用户端进度查询：计算预估推迟时间）
app.get('/api/appointments/day-queue', (req, res) => {
    const { date, stylistId } = req.query;
    if (!date || !stylistId) {
        return res.json([]);
    }
    const dayApps = dbAppointments.find({
        stylistId: String(stylistId),
        date: date
    }).filter(a => a.status !== 'cancelled' && a.status !== 'completed');

    const processedIds = new Set();
    const merged = [];
    dayApps.sort((a, b) => a.time.localeCompare(b.time));

    dayApps.forEach(app => {
        if (processedIds.has(app.id)) return;
        if (app.serviceType === 'dye') {
            const related = dayApps.filter(a =>
                !processedIds.has(a.id) &&
                a.appId === app.appId &&
                a.phone === app.phone &&
                a.date === app.date &&
                a.serviceType === 'dye'
            );
            related.forEach(a => processedIds.add(a.id));
            if (related.length > 0) {
                related.sort((a, b) => a.time.localeCompare(b.time));
                const [firstStart] = related[0].time.split('-');
                const [, lastEnd] = related[related.length - 1].time.split('-');
                merged.push({ time: `${firstStart}-${lastEnd}`, serviceType: 'dye' });
            }
        } else {
            processedIds.add(app.id);
            merged.push({ time: app.time, serviceType: 'cut' });
        }
    });
    merged.sort((a, b) => a.time.localeCompare(b.time));
    res.json(merged);
});

// 用户取消预约（支持批量取消）
app.post('/api/cancel', (req, res) => {
    const { appointmentIds } = req.body; // 接收预约ID数组
    
    if (!appointmentIds || !Array.isArray(appointmentIds) || appointmentIds.length === 0) {
        return res.json({ success: false, message: '请选择要取消的预约' });
    }
    
    const today = getTodayDate();
    let cancelledCount = 0;
    const errors = [];
    const processedIds = new Set(); // 防止重复处理
    const cancelledDates = new Set(); // 防止重复发送短信
    
    appointmentIds.forEach(appointmentId => {
        if (processedIds.has(appointmentId)) {
            return; // 跳过已处理的
        }
        
        // 使用唯一的 id 查找预约
        const app = dbAppointments.findOne({ id: appointmentId });
        if (!app) {
            errors.push(`预约ID ${appointmentId} 不存在`);
            return;
        }
        
        // 检查预约状态
        if (app.status === 'cancelled') {
            errors.push(`预约号 ${app.appId} 已取消`);
            return;
        }
        
        if (app.status === 'completed') {
            errors.push(`预约号 ${app.appId} 已完成`);
            return;
        }
        
        // 检查是否可以取消：当天预约允许取消，过去日期不允许取消
        if (app.date < today) {
            errors.push(`预约号 ${app.appId} 已过期，无法取消`);
            return;
        }
        
        // 如果是染烫服务，需要取消所有相关的时间段
        if (app.serviceType === 'dye') {
            // 查找所有相同 appId、phone、date 的记录
            // 对于烫染服务，不依赖创建时间判断，而是查找所有相同条件的记录
            const allRelatedApps = dbAppointments.find({
                appId: app.appId,
                phone: app.phone,
                date: app.date,
                serviceType: 'dye'
            });
            
            // 过滤出有效预约（状态不是已取消或已完成）
            // 不依赖创建时间判断，因为可能存在创建时间差异
            let relatedApps = allRelatedApps.filter(relatedApp => {
                return relatedApp.status !== 'cancelled' && relatedApp.status !== 'completed';
            });
            
            // 确保 app 本身也被包含在 relatedApps 中
            // 因为 app 是用户选择取消的记录，必须被取消
            const appInRelated = relatedApps.some(relatedApp => relatedApp.id === app.id);
            if (!appInRelated && app.status !== 'cancelled' && app.status !== 'completed') {
                relatedApps.push(app);
            }
            
            // 按时间段排序，确保顺序正确
            relatedApps.sort((a, b) => a.time.localeCompare(b.time));
            
            // 更新所有相关记录的状态（使用唯一的 id）
            // 确保所有记录都被更新，包括 app 本身
            relatedApps.forEach(relatedApp => {
                if (!processedIds.has(relatedApp.id)) {
                    dbAppointments.updateStatus(relatedApp.id, 'cancelled');
                    processedIds.add(relatedApp.id);
                    cancelledCount++;
                }
            });
        } else {
            // 剪发服务，只取消当前记录
            dbAppointments.updateStatus(app.id, 'cancelled');
            processedIds.add(app.id);
            cancelledCount++;
        }
        
        // 发送取消预约短信（每个日期只发送一次）
        const dateKey = `${app.date}_${app.serviceType}`;
        if (!cancelledDates.has(dateKey)) {
            cancelledDates.add(dateKey);
            const stylist = stylists.find(s => s.id == app.stylistId);
            if (stylist && app.phone) {
                // 对于染烫服务，合并时间段显示
                let displayTime = app.time;
                if (app.serviceType === 'dye') {
                    const relatedApps = dbAppointments.find({
                        appId: app.appId,
                        phone: app.phone,
                        date: app.date,
                        serviceType: 'dye'
                    });
                    if (relatedApps.length > 1) {
                        relatedApps.sort((a, b) => a.time.localeCompare(b.time));
                        const firstTime = relatedApps[0].time;
                        const lastTime = relatedApps[relatedApps.length - 1].time;
                        const [firstStart] = firstTime.split('-');
                        const [, lastEnd] = lastTime.split('-');
                        displayTime = `${firstStart}-${lastEnd}`;
                    }
                }
                
                sendCancelBookingSMS(smsPayloadForStylist(stylist, {
                    phone: app.phone,
                    appId: app.appId,
                    stylistName: stylist.name,
                    date: app.date,
                    time: displayTime
                })).catch(err => {
                    console.error('短信发送异常（不影响取消）:', err.message);
                });
            }
        }
    });
    
    if (cancelledCount === 0) {
        return res.json({ 
            success: false, 
            message: errors.length > 0 ? errors.join('; ') : '没有可取消的预约' 
        });
    }
    
    res.json({ 
        success: true, 
        cancelledCount,
        message: errors.length > 0 ? `部分取消成功: ${errors.join('; ')}` : undefined
    });
});

// 查询预约信息（通过预约号）
app.get('/api/appointment/:appId', (req, res) => {
    const { appId } = req.params;
    const appointment = dbAppointments.findOne({ appId: appId });
    
    if (!appointment) {
        return res.json({ success: false, message: '预约不存在' });
    }
    
    // 只返回基本信息，不返回手机号
    res.json({
        success: true,
        appointment: {
            appId: appointment.appId,
            date: appointment.date,
            time: appointment.time,
            userName: appointment.userName,
            status: appointment.status,
            stylistId: appointment.stylistId
        }
    });
});

// ========== 主题设置 API ==========

// 主题配置文件路径
const themeFile = path.join(__dirname, 'theme.json');

// 读取主题设置
function getTheme() {
    try {
        if (fs.existsSync(themeFile)) {
            const data = fs.readFileSync(themeFile, 'utf8');
            const config = JSON.parse(data);
            return config.theme || 'default';
        }
    } catch (error) {
        console.error('读取主题设置失败:', error);
    }
    return 'default';
}

// 保存主题设置
function saveTheme(theme) {
    try {
        fs.writeFileSync(themeFile, JSON.stringify({ theme: theme }, null, 2));
        return true;
    } catch (error) {
        console.error('保存主题设置失败:', error);
        return false;
    }
}

// 获取用户端主题设置
app.get('/api/theme', (req, res) => {
    const theme = getTheme();
    res.json({ success: true, theme: theme });
});

// 短信模板状态（管理员可查看审核进度）
app.get('/api/admin/sms-templates', async (req, res) => {
    const sessionId = req.headers['x-session-id'];
    const session = dbSessions.get(sessionId);
    if (!session || session.role !== 'stylist') {
        return res.status(401).json({ success: false, message: '未授权' });
    }

    if (!SMS_ENABLED) {
        return res.json({
            success: true,
            enabled: false,
            message: '短信服务未配置'
        });
    }

    try {
        const status = await refreshSmsTemplateStatus();
        res.json({ success: true, ...status });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// 已移除主题设置功能（仅保留读取）

// 静态文件最后挂载，保证 /api 等路由先匹配
app.use(express.static('public'));

const PORT = process.env.PORT || 3000;
dbReady.then(async () => {
    try {
        ensureAvatarDir();
        await dbStylistAccounts.seedFromConfigIfEmpty(getBootstrapStylists());
        dbStylistAccounts.syncToArray(stylists);
        applyPersistedVacationsToStylists(stylists);
        stylists.forEach(s => {
            if (s.storeId == null) s.storeId = 1;
        });
        console.log(`✓ 发型师账号已从数据库加载（${stylists.length} 个，请在 /platform/ 管理）`);
    } catch (e) {
        console.warn('⚠️  发型师账号同步失败:', e.message);
    }

    if (SMS_ENABLED) {
        try {
            const smsInitResult = await initSmsTemplates();
            console.log('📱 短信模板初始化完成:', JSON.stringify(smsInitResult, null, 2));
        } catch (error) {
            console.warn('⚠️  短信模板初始化失败:', error.message);
        }
    }

    app.listen(PORT, '0.0.0.0', () => {
        const platformUser = String(process.env.ADMIN_USERNAME || 'admin').trim();
        console.log(`✓ 服务器运行在 http://0.0.0.0:${PORT}`);
        console.log(`✓ 用户端访问: http://localhost:${PORT}`);
        console.log(`✓ 发型师管理: 小程序「我的」页 → 管理`);
        console.log(`✓ 平台管理 PC: http://localhost:${PORT}/platform/ （账号: ${platformUser}）`);
    });
});
