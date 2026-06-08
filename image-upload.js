const fs = require('fs');
const path = require('path');
const axios = require('axios');
const tinify = require('tinify');

const AVATAR_DIR = path.join(__dirname, 'public', 'avatar');
const IMG_DIR = path.join(__dirname, 'public', 'img');
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const MAX_BACKGROUND_BYTES = 5 * 1024 * 1024;

function ensureAvatarDir() {
    fs.mkdirSync(AVATAR_DIR, { recursive: true });
}

function ensureImgDir() {
    fs.mkdirSync(IMG_DIR, { recursive: true });
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

function parseImageBase64(input, maxBytes = MAX_AVATAR_BYTES) {
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
    if (buffer.length > maxBytes) {
        return { ok: false, message: `图片不能超过 ${Math.round(maxBytes / 1024 / 1024)}MB` };
    }
    return { ok: true, buffer };
}

function isCloudFileId(photo) {
    return typeof photo === 'string' && photo.startsWith('cloud://');
}

function isHttpOrLocalPhoto(photo) {
    return typeof photo === 'string' && (/^https?:\/\//i.test(photo) || photo.startsWith('/'));
}

function buildCosMultipart({ key, signature, token, cosFileId, fileBuffer, filename, contentType }) {
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
    body += `Content-Type: ${contentType || 'image/jpeg'}\r\n\r\n`;
    const footer = `\r\n--${boundary}--\r\n`;
    return {
        body: Buffer.concat([Buffer.from(body, 'utf8'), fileBuffer, Buffer.from(footer, 'utf8')]),
        contentType: `multipart/form-data; boundary=${boundary}`
    };
}

async function requestWechatApi(wechatApi, apiPath, payload) {
    const {
        getWechatAccessToken,
        clearWechatAccessTokenCache,
        isWechatAccessTokenError,
        getWechatApiBaseUrl,
        getWechatRequestConfig,
        useWechatCloudOpenApi
    } = wechatApi;
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt++) {
        let url = `${getWechatApiBaseUrl()}${apiPath}`;
        if (!useWechatCloudOpenApi()) {
            const accessToken = await getWechatAccessToken(attempt > 0 ? { forceRefresh: true } : {});
            if (!accessToken) throw new Error('无法获取 access_token，请配置 WX_APPSECRET');
            url += `${apiPath.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(accessToken)}`;
        }
        const { data } = await axios.post(url, payload, getWechatRequestConfig());
        if (!data || !data.errcode) {
            return data;
        }
        lastError = new Error((data && data.errmsg) || '微信接口调用失败');
        if (!useWechatCloudOpenApi()
            && isWechatAccessTokenError
            && clearWechatAccessTokenCache
            && isWechatAccessTokenError(data)
            && attempt === 0) {
            clearWechatAccessTokenCache();
            continue;
        }
        throw lastError;
    }
    throw lastError || new Error('微信接口调用失败');
}

async function uploadToCloudHosting(cloudPath, buffer, wechatApi, contentType) {
    if (!wechatApi) return null;
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
        filename: path.basename(cloudPath),
        contentType
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

    const fileId = meta.file_id;
    let previewUrl = fileId;
    try {
        const preview = await resolveImagePreviewUrl(fileId, wechatApi);
        if (preview) previewUrl = preview;
    } catch (_) { /* ignore */ }

    return { fileId, previewUrl };
}

function uploadToLocal(localDir, filename, buffer) {
    fs.mkdirSync(localDir, { recursive: true });
    const filePath = path.join(localDir, filename);
    fs.writeFileSync(filePath, buffer);
    const version = Date.now();
    const publicPath = localDir === IMG_DIR
        ? `/img/${filename}?v=${version}`
        : `/avatar/${filename}?v=${version}`;
    return {
        fileId: publicPath,
        previewUrl: publicPath
    };
}

async function convertStoreBackgroundToWebp(jpegBuffer) {
    const key = process.env.TINIFY_API_KEY || '';
    if (!key) {
        if (allowLocalFallback()) {
            console.warn('[tinify] 未配置 TINIFY_API_KEY，门店背景将以 JPEG 上传（仅限本地开发）');
            return { ok: true, buffer: jpegBuffer, contentType: 'image/jpeg', ext: 'jpg' };
        }
        return { ok: false, message: '请配置 TINIFY_API_KEY 以将背景图转换为 WebP' };
    }
    try {
        tinify.key = key;
        if (process.env.TINIFY_PROXY) tinify.proxy = process.env.TINIFY_PROXY;
        const webpData = await tinify.fromBuffer(jpegBuffer).convert({ type: 'image/webp' }).toBuffer();
        const webpBuffer = Buffer.from(webpData);
        if (!webpBuffer.length) {
            return { ok: false, message: 'Tinify 转换 WebP 失败：结果为空' };
        }
        return { ok: true, buffer: webpBuffer, contentType: 'image/webp', ext: 'webp' };
    } catch (err) {
        console.warn('[tinify] 转换失败:', err.message);
        if (allowLocalFallback()) {
            console.warn('[tinify] 回退为 JPEG 上传');
            return { ok: true, buffer: jpegBuffer, contentType: 'image/jpeg', ext: 'jpg' };
        }
        return { ok: false, message: err.message || '图片 WebP 转换失败' };
    }
}

async function uploadImage({
    cloudPath,
    localDir,
    localFilename,
    imageBase64,
    buffer,
    wechatApi,
    maxBytes,
    contentType = 'image/jpeg'
}) {
    let fileBuffer = buffer;
    if (!fileBuffer) {
        const parsed = parseImageBase64(imageBase64, maxBytes);
        if (!parsed.ok) return parsed;
        fileBuffer = parsed.buffer;
    }

    if (wechatApi) {
        try {
            const cloudResult = await uploadToCloudHosting(cloudPath, fileBuffer, wechatApi, contentType);
            if (cloudResult) {
                return { ok: true, photo: cloudResult.fileId, previewUrl: cloudResult.previewUrl };
            }
        } catch (err) {
            console.warn(`[image-upload] 云托管对象存储上传失败 (${cloudPath}):`, err.message);
            if (!allowLocalFallback()) {
                return { ok: false, message: err.message || '上传到对象存储失败' };
            }
        }
    }

    if (!allowLocalFallback()) {
        return { ok: false, message: '对象存储上传失败，请检查云托管环境变量与微信令牌权限' };
    }

    const localResult = uploadToLocal(localDir, localFilename, fileBuffer);
    return { ok: true, photo: localResult.fileId, previewUrl: localResult.previewUrl, localFallback: true };
}

async function uploadStylistAvatar(stylistId, imageBase64, wechatApi) {
    const id = Number(stylistId);
    if (!Number.isFinite(id) || id <= 0) {
        return { ok: false, message: '发型师 ID 无效' };
    }
    return uploadImage({
        cloudPath: `avatar/stylist-${id}.jpg`,
        localDir: AVATAR_DIR,
        localFilename: `stylist-${id}.jpg`,
        imageBase64,
        wechatApi,
        maxBytes: MAX_AVATAR_BYTES
    });
}

async function uploadStoreBackground(storeId, imageBase64, wechatApi) {
    const id = Number(storeId);
    if (!Number.isFinite(id) || id <= 0) {
        return { ok: false, message: '门店 ID 无效' };
    }
    const parsed = parseImageBase64(imageBase64, MAX_BACKGROUND_BYTES);
    if (!parsed.ok) return parsed;

    const converted = await convertStoreBackgroundToWebp(parsed.buffer);
    if (!converted.ok) return converted;

    const ext = converted.ext || 'webp';
    const filename = `store-${id}-background.${ext}`;
    return uploadImage({
        cloudPath: `img/${filename}`,
        localDir: IMG_DIR,
        localFilename: filename,
        buffer: converted.buffer,
        wechatApi,
        contentType: converted.contentType
    });
}

async function resolveImagePreviewUrl(photo, wechatApi) {
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
        console.warn('[image-upload] 获取预览地址失败:', err.message);
    }
    return '';
}

module.exports = {
    uploadStylistAvatar,
    uploadStoreBackground,
    resolveImagePreviewUrl,
    ensureAvatarDir,
    ensureImgDir
};
