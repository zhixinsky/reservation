const fs = require('fs');
const path = require('path');

const AVATAR_DIR = path.join(__dirname, 'public', 'avatar');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function ensureAvatarDir() {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

function parseImageBase64(input) {
    const raw = String(input || '').trim();
    if (!raw) return { ok: false, message: '缺少图片数据' };
    const match = raw.match(/^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/i);
    const base64 = match ? match[2] : raw;
    let buffer;
    try {
        buffer = Buffer.from(base64, 'base64');
    } catch (_) {
        return { ok: false, message: '图片数据无效' };
    }
    if (!buffer.length) return { ok: false, message: '图片数据为空' };
    if (buffer.length > MAX_AVATAR_BYTES) {
        return { ok: false, message: '图片不能超过 2MB' };
    }
    return { ok: true, buffer };
}

function isCloudFileId(photo) {
    return typeof photo === 'string' && photo.startsWith('cloud://');
}

function isHttpOrLocalPhoto(photo) {
    return typeof photo === 'string' && (/^https?:\/\//i.test(photo) || photo.startsWith('/'));
}

async function uploadToCloud(invokeCloudFunction, stylistId, buffer) {
    if (!invokeCloudFunction) return null;
    const secret = process.env.PLATFORM_SYNC_SECRET || '';
    if (!secret) return null;
    try {
        const result = await invokeCloudFunction(process.env.CLOUD_FUNCTION_NAME || 'api', {
            action: 'uploadStylistAvatar',
            payload: {
                secret,
                stylistId: Number(stylistId),
                imageBase64: buffer.toString('base64')
            }
        });
        if (!result || !result.success || !result.photo) return null;
        return {
            photo: result.photo,
            previewUrl: result.previewUrl || result.photo
        };
    } catch (err) {
        console.warn('[avatar] 云存储上传失败，回退本地:', err.message);
        return null;
    }
}

function uploadToLocal(stylistId, buffer) {
    ensureAvatarDir();
    const filename = `stylist-${Number(stylistId)}.jpg`;
    const filePath = path.join(AVATAR_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const version = Date.now();
    return {
        photo: `/avatar/${filename}?v=${version}`,
        previewUrl: `/avatar/${filename}?v=${version}`
    };
}

async function uploadStylistAvatar(stylistId, imageBase64, invokeCloudFunction) {
    const parsed = parseImageBase64(imageBase64);
    if (!parsed.ok) return parsed;
    const id = Number(stylistId);
    if (!Number.isFinite(id) || id <= 0) {
        return { ok: false, message: '发型师 ID 无效' };
    }

    const cloudResult = await uploadToCloud(invokeCloudFunction, id, parsed.buffer);
    if (cloudResult) {
        return { ok: true, ...cloudResult };
    }
    const localResult = uploadToLocal(id, parsed.buffer);
    return { ok: true, ...localResult };
}

async function resolvePhotoPreviewUrl(photo, invokeCloudFunction) {
    const value = String(photo || '').trim();
    if (!value) return '';
    if (isHttpOrLocalPhoto(value)) return value;
    if (!isCloudFileId(value) || !invokeCloudFunction) return '';
    const secret = process.env.PLATFORM_SYNC_SECRET || '';
    if (!secret) return '';
    try {
        const result = await invokeCloudFunction(process.env.CLOUD_FUNCTION_NAME || 'api', {
            action: 'getFilePreviewUrl',
            payload: { secret, fileID: value }
        });
        if (result && result.success && result.previewUrl) return result.previewUrl;
    } catch (err) {
        console.warn('[avatar] 获取预览地址失败:', err.message);
    }
    return '';
}

module.exports = {
    uploadStylistAvatar,
    resolvePhotoPreviewUrl,
    ensureAvatarDir
};
