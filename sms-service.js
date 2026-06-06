/**
 * 亿美软通短信发送与模板管理服务
 * 支持自动创建、查询短信模板，无需手动在控制台配置模板 ID
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const {
    SHOP_INFO,
    getBookingSuccessEmayTemplate,
    getCancelBookingEmayTemplate,
    getBookingReminderEmayTemplate,
    getStylistCancelEmayTemplate,
    buildBookingSmsVariables,
    buildCancelSmsVariables,
    buildReminderSmsVariables,
    buildStylistCancelSmsVariables
} = require('./sms-templates');
const {
    loadTemplateStore,
    upsertTemplateEntry,
    updateTemplateStatus,
    isTemplateApproved,
    isSameTemplateContent
} = require('./sms-template-store');

const EMAY_APPID = process.env.EMAY_APPID;
const EMAY_SECRETKEY = process.env.EMAY_SECRETKEY;
const EMAY_BASE_URL = process.env.EMAY_BASE_URL || 'http://www.btom.cn:8080';

const SMS_ENABLED = Boolean(EMAY_APPID && EMAY_SECRETKEY);
const AUTO_CREATE_TEMPLATES = process.env.EMAY_AUTO_CREATE_TEMPLATES !== '0'
    && process.env.EMAY_AUTO_CREATE_TEMPLATES !== 'false';

const TEMPLATE_TYPES = {
    booking: {
        envKey: 'EMAY_TEMPLATE_ID_BOOKING',
        fallbackEnvKey: 'EMAY_TEMPLATE_ID',
        label: '预约成功',
        getTemplateContent: () => getBookingSuccessEmayTemplate(SHOP_INFO),
        buildVariables: buildBookingSmsVariables
    },
    cancel: {
        envKey: 'EMAY_TEMPLATE_ID_CANCEL',
        fallbackEnvKey: 'EMAY_TEMPLATE_ID',
        label: '取消预约',
        getTemplateContent: () => getCancelBookingEmayTemplate(SHOP_INFO),
        buildVariables: buildCancelSmsVariables
    },
    reminder: {
        envKey: 'EMAY_TEMPLATE_ID_REMINDER',
        fallbackEnvKey: null,
        label: '预约提醒',
        getTemplateContent: () => getBookingReminderEmayTemplate(SHOP_INFO),
        buildVariables: buildReminderSmsVariables
    },
    stylistCancel: {
        envKey: 'EMAY_TEMPLATE_ID_STYLIST_CANCEL',
        fallbackEnvKey: null,
        label: '门店取消预约',
        getTemplateContent: () => getStylistCancelEmayTemplate(SHOP_INFO),
        buildVariables: buildStylistCancelSmsVariables
    }
};

let activeTemplateIds = {
    booking: process.env.EMAY_TEMPLATE_ID_BOOKING || process.env.EMAY_TEMPLATE_ID || '',
    cancel: process.env.EMAY_TEMPLATE_ID_CANCEL || process.env.EMAY_TEMPLATE_ID || '',
    reminder: process.env.EMAY_TEMPLATE_ID_REMINDER || '',
    stylistCancel: process.env.EMAY_TEMPLATE_ID_STYLIST_CANCEL || ''
};

let templateReadyState = {
    booking: Boolean(activeTemplateIds.booking),
    cancel: Boolean(activeTemplateIds.cancel),
    reminder: Boolean(activeTemplateIds.reminder),
    stylistCancel: Boolean(activeTemplateIds.stylistCancel)
};

if (!SMS_ENABLED) {
    console.warn('⚠️  短信服务未配置（EMAY_APPID 或 EMAY_SECRETKEY 未设置），短信功能将不会启用');
}

function encryptAES(text, key) {
    const keyBuffer = Buffer.from(key.slice(0, 16).padEnd(16, '0'), 'utf8');
    const cipher = crypto.createCipheriv('aes-128-ecb', keyBuffer, null);
    cipher.setAutoPadding(true);
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return encrypted;
}

function decryptAES(encryptedBuffer, key) {
    const keyBuffer = Buffer.from(key.slice(0, 16).padEnd(16, '0'), 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-ecb', keyBuffer, null);
    decipher.setAutoPadding(true);
    let decrypted = decipher.update(encryptedBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString('utf8');
}

async function emayRequest(urlPath, payload) {
    const jsonStr = JSON.stringify({
        ...payload,
        requestTime: Date.now(),
        requestValidPeriod: 60
    });
    const encryptedBytes = encryptAES(jsonStr, EMAY_SECRETKEY);
    const response = await axios.post(`${EMAY_BASE_URL}${urlPath}`, encryptedBytes, {
        headers: {
            appId: EMAY_APPID,
            'Content-Type': 'application/octet-stream',
            encode: 'UTF-8'
        },
        timeout: 10000,
        responseType: 'arraybuffer',
        validateStatus: () => true
    });

    const resultCode = response.headers.result || response.headers['result'];
    if (resultCode !== 'SUCCESS') {
        throw new Error(`亿美接口错误码: ${resultCode || 'UNKNOWN'}`);
    }

    const decrypted = decryptAES(Buffer.from(response.data), EMAY_SECRETKEY);
    return JSON.parse(decrypted);
}

async function createTemplate(templateContent) {
    const result = await emayRequest('/inter/createTemplateSMS', {
        templateContent
    });
    if (!result.templateId) {
        throw new Error('创建模板失败：未返回 templateId');
    }
    return String(result.templateId);
}

async function queryTemplate(templateId) {
    const result = await emayRequest('/inter/queryTemplateSMS', {
        templateId: String(templateId)
    });
    return {
        templateId: String(result.templateId || templateId),
        status: result.status == null ? null : String(result.status)
    };
}

async function deleteTemplate(templateId) {
    const result = await emayRequest('/inter/deleteTemplateSMS', {
        templateId: String(templateId)
    });
    return String(result.code) === 'true';
}

function getEnvTemplateId(type) {
    const config = TEMPLATE_TYPES[type];
    return process.env[config.envKey] || (config.fallbackEnvKey ? process.env[config.fallbackEnvKey] : '') || '';
}

function setActiveTemplate(type, templateId, ready) {
    activeTemplateIds[type] = String(templateId || '');
    templateReadyState[type] = Boolean(ready && activeTemplateIds[type]);
}

async function resolveTemplate(type, store) {
    const config = TEMPLATE_TYPES[type];
    const templateContent = config.getTemplateContent();
    const envTemplateId = getEnvTemplateId(type);

    if (envTemplateId) {
        setActiveTemplate(type, envTemplateId, true);
        console.log(`📱 [短信模板] ${config.label} 使用环境变量模板 ID: ${envTemplateId}`);
        return {
            type,
            templateId: envTemplateId,
            status: '1',
            source: 'env'
        };
    }

    const stored = store[type];
    if (stored && isSameTemplateContent(stored, templateContent)) {
        if (isTemplateApproved(stored)) {
            setActiveTemplate(type, stored.templateId, true);
            console.log(`📱 [短信模板] ${config.label} 使用已审核模板: ${stored.templateId}`);
            return {
                type,
                templateId: stored.templateId,
                status: stored.status,
                source: 'store'
            };
        }

        try {
            const queried = await queryTemplate(stored.templateId);
            updateTemplateStatus(store, type, queried.status);
            if (String(queried.status) === '1') {
                setActiveTemplate(type, stored.templateId, true);
                console.log(`📱 [短信模板] ${config.label} 模板已审核通过: ${stored.templateId}`);
                return {
                    type,
                    templateId: stored.templateId,
                    status: queried.status,
                    source: 'store'
                };
            }
            if (String(queried.status) === '2') {
                console.warn(`⚠️  [短信模板] ${config.label} 模板审核失败，将重新创建`);
            } else if (String(queried.status) === '-1') {
                console.warn(`⚠️  [短信模板] ${config.label} 模板不存在，将重新创建`);
            } else {
                setActiveTemplate(type, stored.templateId, false);
                console.warn(`⏳ [短信模板] ${config.label} 模板审核中 (${stored.templateId})，审核通过前无法发送`);
                return {
                    type,
                    templateId: stored.templateId,
                    status: queried.status || '0',
                    source: 'pending'
                };
            }
        } catch (error) {
            console.warn(`⚠️  [短信模板] 查询 ${config.label} 模板状态失败: ${error.message}`);
        }
    } else if (stored && !isSameTemplateContent(stored, templateContent)) {
        console.log(`📱 [短信模板] ${config.label} 模板内容已变更，将创建新模板`);
    }

    const templateId = await createTemplate(templateContent);
    upsertTemplateEntry(store, type, {
        templateId,
        templateContent,
        status: '0'
    });
    setActiveTemplate(type, templateId, false);
    console.log(`✅ [短信模板] ${config.label} 模板已提交创建: ${templateId}（等待平台审核）`);
    return {
        type,
        templateId,
        status: '0',
        source: 'created'
    };
}

/**
 * 启动时自动创建/加载短信模板
 */
async function initSmsTemplates() {
    if (!SMS_ENABLED) {
        return { enabled: false, templates: [] };
    }

    if (!AUTO_CREATE_TEMPLATES) {
        console.log('📱 [短信模板] 已关闭 API 自动创建（EMAY_AUTO_CREATE_TEMPLATES=false），请使用 .env 中的模板 ID');
        return {
            enabled: true,
            autoCreate: false,
            templates: [],
            ready: { ...templateReadyState },
            activeTemplateIds: { ...activeTemplateIds }
        };
    }

    const store = loadTemplateStore();
    const results = [];

    for (const type of Object.keys(TEMPLATE_TYPES)) {
        try {
            results.push(await resolveTemplate(type, store));
        } catch (error) {
            console.error(`❌ [短信模板] ${TEMPLATE_TYPES[type].label} 初始化失败:`, error.message);
            results.push({
                type,
                error: error.message
            });
        }
    }

    return {
        enabled: true,
        templates: results,
        ready: { ...templateReadyState },
        activeTemplateIds: { ...activeTemplateIds }
    };
}

async function sendVariableTemplateSMS(templateType, data) {
    if (!SMS_ENABLED) {
        console.log(`📱 [短信] ${TEMPLATE_TYPES[templateType].label} 短信（未启用）:`, data);
        return false;
    }

    const config = TEMPLATE_TYPES[templateType];
    const templateId = activeTemplateIds[templateType];

    if (!templateId) {
        console.warn(`⚠️  [短信] ${config.label} 模板 ID 未配置，跳过发送`);
        return false;
    }

    if (!templateReadyState[templateType]) {
        console.warn(`⚠️  [短信] ${config.label} 模板尚未审核通过 (${templateId})，跳过发送`);
        return false;
    }

    try {
        const { phone, appId } = data;
        const cleanPhone = String(phone).trim().replace(/^(\+86)/, '');
        if (!/^1\d{10}$/.test(cleanPhone)) {
            throw new Error('手机号格式不正确');
        }

        const businessData = {
            smses: [{
                mobile: cleanPhone,
                customSmsId: String(appId),
                content: config.buildVariables(data)
            }],
            templateId: String(templateId),
            timerTime: null,
            requestTime: Date.now(),
            requestValidPeriod: 60
        };

        const jsonStr = JSON.stringify(businessData);
        console.log(`📝 [短信] ${config.label} - 待加密 JSON:`, jsonStr);

        const encryptedBytes = encryptAES(jsonStr, EMAY_SECRETKEY);
        const response = await axios.post(`${EMAY_BASE_URL}/inter/sendTemplateVariableSMS`, encryptedBytes, {
            headers: {
                appId: EMAY_APPID,
                'Content-Type': 'application/octet-stream',
                encode: 'UTF-8'
            },
            timeout: 10000
        });

        const resultCode = response.headers.result || response.headers['result'];
        console.log(`📥 [短信] ${config.label} - 亿美平台返回: ${resultCode}`);

        if (resultCode === 'SUCCESS') {
            console.log(`✅ [短信] ${config.label} 短信发送成功: ${cleanPhone}`);
            return true;
        }
        throw new Error(`亿美接口错误码: ${resultCode}`);
    } catch (err) {
        console.error(`❌ [短信] ${config.label} 短信发送失败:`, err.message);
        return false;
    }
}

async function sendBookingSuccessSMS(data) {
    return sendVariableTemplateSMS('booking', data);
}

async function sendCancelBookingSMS(data) {
    return sendVariableTemplateSMS('cancel', data);
}

async function sendBookingReminderSMS(data) {
    return sendVariableTemplateSMS('reminder', data);
}

async function sendStylistCancelBookingSMS(data) {
    return sendVariableTemplateSMS('stylistCancel', data);
}

async function refreshSmsTemplateStatus() {
    if (!SMS_ENABLED) {
        return { enabled: false, templates: [] };
    }

    const store = loadTemplateStore();
    const results = [];

    for (const type of Object.keys(TEMPLATE_TYPES)) {
        const config = TEMPLATE_TYPES[type];
        const entry = store[type];
        if (!entry?.templateId) {
            results.push({ type, status: null, message: '未创建模板' });
            continue;
        }

        try {
            const queried = await queryTemplate(entry.templateId);
            updateTemplateStatus(store, type, queried.status);
            const approved = String(queried.status) === '1';
            if (approved) {
                setActiveTemplate(type, entry.templateId, true);
            }
            results.push({
                type,
                templateId: entry.templateId,
                status: queried.status,
                label: config.label,
                ready: approved
            });
        } catch (error) {
            results.push({
                type,
                templateId: entry.templateId,
                error: error.message,
                label: config.label
            });
        }
    }

    return {
        enabled: true,
        templates: results,
        ready: { ...templateReadyState },
        activeTemplateIds: { ...activeTemplateIds }
    };
}

module.exports = {
    sendBookingSuccessSMS,
    sendCancelBookingSMS,
    sendBookingReminderSMS,
    sendStylistCancelBookingSMS,
    initSmsTemplates,
    refreshSmsTemplateStatus,
    createTemplate,
    queryTemplate,
    deleteTemplate,
    SMS_ENABLED,
    AUTO_CREATE_TEMPLATES,
    TEMPLATE_TYPES,
    getSmsTemplateState: () => ({
        ready: { ...templateReadyState },
        activeTemplateIds: { ...activeTemplateIds }
    })
};
