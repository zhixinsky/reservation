const fs = require('fs');
const path = require('path');
const axios = require('axios');

const AVATAR_DIR = path.join(__dirname, 'public', 'avatar');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

function ensureAvatarDir() {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

function getCloudEnvId() {
    return process.env.TCB_ENV_ID
        || process.env.WX_CLOUD_ENV
        || 'reservation-d2gf73dgv8fd17503';
}

function allowLocalFallback() {
    return process.env.AVATAR_LOCAL_FALLBACK === '1'
        || process.env.NODE_ENV !== 'production';
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

function buildCosMultipart({ key, signature, token, cosFileId, fileBuffer, filename }) {
    const boundary = `----FormBoundary${Date.now()}${Math.random().toString(16).slice(2)}`;
    const fields = [
        ['key', key],
        ['Signature', signature],
        ['x-cos-security-token', token],
        ['x-cos-meta-fileid', cosFileId]
    ];
    let body = '';
    fields.forEach(([name, value]) => {
        body += `--${boundary}\r\n`;
        body += `Content-Disposition: form-data; name="${name}"\r\n\r\n`;
        body += `${value}\r\n`;
    });
    body += `--${boundary}\r\n`;
    body += `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n`;
    body += 'Content-Type: image/jpeg\r\n\r\n';
    const footer = `\r\n--${boundary}--\r\n`;
    return {
        body: Buffer.concat([Buffer.from(body, 'utf8'), fileBuffer, Buffer.from(footer, 'utf8')]),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

async function requestWechatApi(wechatApi, apiPath, payload) {
    const {
        getWechatAccessToken,
        getWechatApiBaseUrl,
        getWechatRequestConfig,
        useWechatCloudOpenApi
    } = wechatApi;
    let url = `${getWechatApiBaseUrl()}${apiPath}`;
    if (!useWechatCloudOpenApi()) {
        const accessToken = await getWechatAccessToken();
        if (!accessToken) throw new Error('无法获取 access_token，请配置 WX_APPSECRET');
        url += `${apiPath.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
    }
    const { data } = await axios.post(url, payload, getWechatRequestConfig());
    if (!data || data.errcode) {
        throw new Error((data && data.errmsg) || '微信接口调用失败');
    }
    return data;
}

async function uploadToCloudHosting(stylistId, buffer, wechatApi) {
    if (!wechatApi) return null;
    const cloudPath = `avatar/stylist-${Number(stylistId)}.jpg`;
    const meta = await requestWechatApi(wechatApi, '/tcb/uploadfile', {
        env: getCloudEnvId(),
        path: cloudPath
    });

    const form = buildCosMultipart({
        key: cloudPath,
        signature: meta.authorization,
        token: meta.token,
        cosFileId: meta.cos_file_id,
        fileBuffer: buffer,
        filename: path.basename(cloudPath)
    });

    const uploadRes = await axios.post(meta.url, form.body, {
        headers: { 'Content-Type': form.contentType },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
    });
    if (uploadRes.status < 200 || uploadRes.status >= 300) {
        throw new Error(`对象存储上传失败: HTTP ${uploadRes.status}`);
    }

    const photo = meta.file_id;
    let previewUrl = photo;
    try {
        const preview = await resolvePhotoPreviewUrl(photo, wechatApi);
        if (preview) previewUrl = preview;
    } catch (_) { /* ignore */ }

    return { photo, previewUrl };
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

async function uploadStylistAvatar(stylistId, imageBase64, wechatApi) {
    const parsed = parseImageBase64(imageBase64);
    if (!parsed.ok) return parsed;
    const id = Number(stylistId);
    if (!Number.isFinite(id) || id <= 0) {
        return { ok: false, message: '发型师 ID 无效' };
    }

    if (wechatApi) {
        try {
            const cloudResult = await uploadToCloudHosting(id, parsed.buffer, wechatApi);
            if (cloudResult) {
                return { ok: true, ...cloudResult };
            }
        } catch (err) {
            console.warn('[avatar] 云托管对象存储上传失败:', err.message);
            if (!allowLocalFallback()) {
                return { ok: false, message: err.message || '上传到对象存储失败' };
            }
        }
    }

    if (!allowLocalFallback()) {
        return { ok: false, message: '对象存储上传失败，请检查云托管环境变量与微信令牌权限' };
    }

    const localResult = uploadToLocal(id, parsed.buffer);
    return { ok: true, ...localResult, localFallback: true };
}

async function resolvePhotoPreviewUrl(photo, wechatApi) {
    const value = String(photo || '').trim();
    if (!value) return '';
    if (isHttpOrLocalPhoto(value)) return value;
    if (!isCloudFileId(value) || !wechatApi) return '';

    try {
        const data = await requestWechatApi(wechatApi, '/tcb/batchdownloadfile', {
            env: getCloudEnvId(),
            file_list: [{ fileid: value, max_age: 7200 }]
        });
        const row = data && Array.isArray(data.file_list) && data.file_list[0];
        if (row && row.download_url) return row.download_url;
        if (row && row.tempFileURL) return row.tempFileURL;
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
