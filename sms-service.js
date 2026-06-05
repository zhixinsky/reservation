/**
 * 亿美软通短信发送服务
 * 参考文档：http://www.btom.cn:8080/inter/sendTemplateVariableSMS
 */

require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');

// 亿美软通配置
const EMAY_APPID = process.env.EMAY_APPID;
const EMAY_SECRETKEY = process.env.EMAY_SECRETKEY; // 必须是16位字符串
const EMAY_TEMPLATE_ID_BOOKING = process.env.EMAY_TEMPLATE_ID_BOOKING || process.env.EMAY_TEMPLATE_ID || "176794312148400419";
const EMAY_TEMPLATE_ID_CANCEL = process.env.EMAY_TEMPLATE_ID_CANCEL || process.env.EMAY_TEMPLATE_ID || "176794312148400419";

// 个性化变量短信接口地址
const EMAY_URL = "http://www.btom.cn:8080/inter/sendTemplateVariableSMS";

// 是否启用短信发送（如果未配置则不发送）
const SMS_ENABLED = EMAY_APPID && EMAY_SECRETKEY;

if (!SMS_ENABLED) {
    console.warn("⚠️  短信服务未配置（EMAY_APPID 或 EMAY_SECRETKEY 未设置），短信功能将不会启用");
}

/**
 * AES 加密函数
 * @param {string} text - 待加密文本
 * @param {string} key - 密钥（16位）
 * @returns {Buffer} 加密后的字节流
 */
function encryptAES(text, key) {
    // 确保密钥是16位
    const keyBuffer = Buffer.from(key.slice(0, 16).padEnd(16, '0'), 'utf8');
    
    // 使用 AES-128-ECB 加密
    const cipher = crypto.createCipheriv('aes-128-ecb', keyBuffer, null);
    cipher.setAutoPadding(true);
    
    let encrypted = cipher.update(text, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    return encrypted;
}

/**
 * 发送预约成功短信
 * @param {Object} data - 预约数据
 * @param {string} data.phone - 手机号
 * @param {string} data.appId - 预约号（手机号后4位）
 * @param {string} data.stylistName - 发型师姓名
 * @param {string} data.date - 预约日期（YYYY-MM-DD）
 * @param {string} data.time - 预约时间段（HH:MM-HH:MM）
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendBookingSuccessSMS(data) {
    if (!SMS_ENABLED) {
        console.log("📱 [短信] 预约成功短信（未启用）:", data);
        return false;
    }

    try {
        const { phone, appId, stylistName, date, time } = data;
        
        // 格式化日期显示
        const dateObj = new Date(date);
        const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
        
        // 清理手机号
        const cleanPhone = String(phone).trim().replace(/^(\+86)/, "");
        
        if (!/^1\d{10}$/.test(cleanPhone)) {
            throw new Error("手机号格式不正确");
        }

        // 构建短信内容变量（变量名必须匹配模板中的 {#变量名#}）
        // 根据实际模板调整变量名
        const businessData = {
            "smses": [{
                "mobile": cleanPhone,
                "customSmsId": String(appId),
                "content": {
                    "appId": String(appId),           // 预约号
                    "stylistName": String(stylistName), // 发型师姓名
                    "date": String(dateDisplay),      // 日期（如：1月15日）
                    "time": String(time)              // 时间段（如：14:30-15:00）
                }
            }],
            "templateId": String(EMAY_TEMPLATE_ID_BOOKING),
            "timerTime": null,
            "requestTime": Date.now(),
            "requestValidPeriod": 60
        };

        const jsonStr = JSON.stringify(businessData);
        console.log("📝 [短信] 预约成功 - 待加密 JSON:", jsonStr);

        const encryptedBytes = encryptAES(jsonStr, EMAY_SECRETKEY);

        const response = await axios.post(EMAY_URL, encryptedBytes, {
            headers: {
                'appId': EMAY_APPID,
                'Content-Type': 'application/octet-stream',
                'encode': 'UTF-8'
            },
            timeout: 10000 // 10秒超时
        });

        const resultCode = response.headers['result'];
        console.log(`📥 [短信] 预约成功 - 亿美平台返回: ${resultCode}`);

        if (resultCode === "SUCCESS") {
            console.log(`✅ [短信] 预约成功短信发送成功: ${cleanPhone}`);
            return true;
        } else {
            throw new Error(`亿美接口错误码: ${resultCode}`);
        }

    } catch (err) {
        console.error("❌ [短信] 预约成功短信发送失败:", err.message);
        return false;
    }
}

/**
 * 发送取消预约短信
 * @param {Object} data - 取消预约数据
 * @param {string} data.phone - 手机号
 * @param {string} data.appId - 预约号（手机号后4位）
 * @param {string} data.stylistName - 发型师姓名
 * @param {string} data.date - 预约日期（YYYY-MM-DD）
 * @param {string} data.time - 预约时间段（HH:MM-HH:MM）
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendCancelBookingSMS(data) {
    if (!SMS_ENABLED) {
        console.log("📱 [短信] 取消预约短信（未启用）:", data);
        return false;
    }

    try {
        const { phone, appId, stylistName, date, time } = data;
        
        // 格式化日期显示
        const dateObj = new Date(date);
        const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
        
        // 清理手机号
        const cleanPhone = String(phone).trim().replace(/^(\+86)/, "");
        
        if (!/^1\d{10}$/.test(cleanPhone)) {
            throw new Error("手机号格式不正确");
        }

        // 构建短信内容变量
        const businessData = {
            "smses": [{
                "mobile": cleanPhone,
                "customSmsId": String(appId),
                "content": {
                    "appId": String(appId),           // 预约号
                    "stylistName": String(stylistName), // 发型师姓名
                    "date": String(dateDisplay),      // 日期（如：1月15日）
                    "time": String(time)              // 时间段（如：14:30-15:00）
                }
            }],
            "templateId": String(EMAY_TEMPLATE_ID_CANCEL),
            "timerTime": null,
            "requestTime": Date.now(),
            "requestValidPeriod": 60
        };

        const jsonStr = JSON.stringify(businessData);
        console.log("📝 [短信] 取消预约 - 待加密 JSON:", jsonStr);

        const encryptedBytes = encryptAES(jsonStr, EMAY_SECRETKEY);

        const response = await axios.post(EMAY_URL, encryptedBytes, {
            headers: {
                'appId': EMAY_APPID,
                'Content-Type': 'application/octet-stream',
                'encode': 'UTF-8'
            },
            timeout: 10000 // 10秒超时
        });

        const resultCode = response.headers['result'];
        console.log(`📥 [短信] 取消预约 - 亿美平台返回: ${resultCode}`);

        if (resultCode === "SUCCESS") {
            console.log(`✅ [短信] 取消预约短信发送成功: ${cleanPhone}`);
            return true;
        } else {
            throw new Error(`亿美接口错误码: ${resultCode}`);
        }

    } catch (err) {
        console.error("❌ [短信] 取消预约短信发送失败:", err.message);
        return false;
    }
}

module.exports = {
    sendBookingSuccessSMS,
    sendCancelBookingSMS,
    SMS_ENABLED
};
