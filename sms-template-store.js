/**
 * 短信模板 ID 本地持久化
 * 自动创建的模板 ID 保存在 data/sms-template-config.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(__dirname, 'data');
const CONFIG_FILE = path.join(CONFIG_DIR, 'sms-template-config.json');

function hashContent(content) {
    return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function defaultConfig() {
    return {
        booking: null,
        cancel: null,
        reminder: null,
        stylistCancel: null,
        updatedAt: null
    };
}

function normalizeEntry(entry) {
    if (!entry || !entry.templateId) return null;
    return {
        templateId: String(entry.templateId),
        templateContent: String(entry.templateContent || ''),
        contentHash: String(entry.contentHash || hashContent(entry.templateContent)),
        status: entry.status == null ? null : String(entry.status),
        createdAt: entry.createdAt || null,
        updatedAt: entry.updatedAt || null
    };
}

function loadTemplateStore() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) return defaultConfig();
        const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
        return {
            booking: normalizeEntry(raw.booking),
            cancel: normalizeEntry(raw.cancel),
            updatedAt: raw.updatedAt || null
        };
    } catch (error) {
        console.warn('[短信模板] 读取本地配置失败，将重新创建:', error.message);
        return defaultConfig();
    }
}

function saveTemplateStore(store) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const payload = {
        booking: store.booking,
        cancel: store.cancel,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(payload, null, 2), 'utf8');
}

function upsertTemplateEntry(store, type, data) {
    const now = new Date().toISOString();
    store[type] = {
        templateId: String(data.templateId),
        templateContent: String(data.templateContent || ''),
        contentHash: hashContent(data.templateContent),
        status: data.status == null ? null : String(data.status),
        createdAt: store[type]?.createdAt || now,
        updatedAt: now
    };
    saveTemplateStore(store);
    return store[type];
}

function updateTemplateStatus(store, type, status) {
    if (!store[type]) return null;
    store[type].status = String(status);
    store[type].updatedAt = new Date().toISOString();
    saveTemplateStore(store);
    return store[type];
}

function isTemplateApproved(entry) {
    return entry && entry.templateId && String(entry.status) === '1';
}

function isSameTemplateContent(entry, templateContent) {
    return entry && entry.contentHash === hashContent(templateContent);
}

module.exports = {
    CONFIG_FILE,
    hashContent,
    loadTemplateStore,
    saveTemplateStore,
    upsertTemplateEntry,
    updateTemplateStatus,
    isTemplateApproved,
    isSameTemplateContent
};
