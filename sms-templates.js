/**
 * 短信模板配置（小程序版）
 * 变量说明：
 * {stylistName} - 发型师姓名
 * {date} - 预约日期（格式：YYYY-MM-DD）
 * {dateDisplay} - 预约日期（格式：MM月DD日）
 * {time} - 预约时间段（格式：HH:MM-HH:MM）
 * {appId} - 预约号（手机号后4位）
 * {phone} - 手机号
 * {companyName} - 固定公司名称（如：育文游）
 * {shopName} - 店铺名称（如：欧诺造型）
 * {shopPhone} - 店铺电话
 * {shopAddress} - 店铺地址
 * {miniProgramUrl} - 小程序访问链接
 */

const MINI_PROGRAM_URL = process.env.MINI_PROGRAM_URL || 'https://wxaurl.cn/byRtNK8KNSc';
const COMPANY_NAME = process.env.COMPANY_NAME || '育文游';

// 店铺信息配置（可根据实际情况修改）
const SHOP_INFO = {
    companyName: COMPANY_NAME,
    name: '欧诺造型',
    phone: '17675610733',
    address: '广州市白云区白灰场南路2号',
    miniProgramUrl: MINI_PROGRAM_URL
};

function formatDateDisplay(date) {
    const dateObj = new Date(date);
    return `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
}

function formatTimeDisplay(timeStr) {
    if (!timeStr) return '';
    if (timeStr.includes(',')) {
        const slots = timeStr.split(',').map(s => s.trim());
        const [firstStart] = slots[0].split('-');
        const [, lastEnd] = slots[slots.length - 1].split('-');
        return lastEnd ? `${firstStart}-${lastEnd}` : firstStart;
    }
    return timeStr;
}

/** 品牌前缀：【育文游】欧诺造型提醒您， */
function getBrandPrefix(shopInfo = SHOP_INFO) {
    const { companyName, name } = shopInfo;
    return `【${companyName}】${name}提醒您，`;
}

/**
 * 亿美个性模板内容（变量格式 {#name#}）
 */
function getBookingSuccessEmayTemplate(shopInfo = SHOP_INFO) {
    const { miniProgramUrl } = shopInfo;
    return `${getBrandPrefix(shopInfo)}您已成功预约！您的预约号：{#appId#}，发型师：{#stylistName#}，预约时间：{#date#} {#time#}。请提前5分钟到店，如需取消预约，请打开小程序 ${miniProgramUrl}`;
}

function getCancelBookingEmayTemplate(shopInfo = SHOP_INFO) {
    const { miniProgramUrl } = shopInfo;
    return `${getBrandPrefix(shopInfo)}您的预约已取消。预约号：{#appId#}，发型师：{#stylistName#}，预约时间：{#date#} {#time#}。如需重新预约，请打开小程序 ${miniProgramUrl}`;
}

function getBookingReminderEmayTemplate(shopInfo = SHOP_INFO) {
    const { address, miniProgramUrl } = shopInfo;
    return `${getBrandPrefix(shopInfo)}您已预约{#stylistName#}，预约时间：{#date#} {#time#}，请提前5分钟到店。地址：${address}。打开小程序 ${miniProgramUrl}`;
}

function getStylistCancelEmayTemplate(shopInfo = SHOP_INFO) {
    const { miniProgramUrl } = shopInfo;
    return `${getBrandPrefix(shopInfo)}您的预约因门店安排已取消。预约号：{#appId#}，发型师：{#stylistName#}，预约时间：{#date#} {#time#}。如需重新预约，请打开小程序 ${miniProgramUrl}`;
}

function buildBookingSmsVariables(data) {
    return {
        appId: String(data.appId),
        stylistName: String(data.stylistName),
        date: formatDateDisplay(data.date),
        time: formatTimeDisplay(data.time)
    };
}

function buildCancelSmsVariables(data) {
    return buildBookingSmsVariables(data);
}

function buildReminderSmsVariables(data) {
    return buildBookingSmsVariables(data);
}

function buildStylistCancelSmsVariables(data) {
    return buildBookingSmsVariables(data);
}

function renderBookingSuccessText(data, shopInfo = SHOP_INFO) {
    const { stylistName, date, time, appId } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    const miniProgramUrl = data.miniProgramUrl || shopInfo.miniProgramUrl;
    return `${getBrandPrefix(shopInfo)}您已成功预约！您的预约号：${appId}，发型师：${stylistName}，预约时间：${dateDisplay} ${displayTime}。请提前5分钟到店，如需取消预约，请打开小程序 ${miniProgramUrl}`;
}

function renderCancelBookingText(data, shopInfo = SHOP_INFO) {
    const { stylistName, date, time, appId } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    const miniProgramUrl = data.miniProgramUrl || shopInfo.miniProgramUrl;
    return `${getBrandPrefix(shopInfo)}您的预约已取消。预约号：${appId}，发型师：${stylistName}，预约时间：${dateDisplay} ${displayTime}。如需重新预约，请打开小程序 ${miniProgramUrl}`;
}

function renderBookingReminderText(data, shopInfo = SHOP_INFO) {
    const { stylistName, date, time } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    const miniProgramUrl = data.miniProgramUrl || shopInfo.miniProgramUrl;
    const address = data.shopAddress || shopInfo.address;
    return `${getBrandPrefix(shopInfo)}您已预约${stylistName}，预约时间：${dateDisplay} ${displayTime}，请提前5分钟到店。地址：${address}。打开小程序 ${miniProgramUrl}`;
}

function renderStylistCancelText(data, shopInfo = SHOP_INFO) {
    const { stylistName, date, time, appId } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    const miniProgramUrl = data.miniProgramUrl || shopInfo.miniProgramUrl;
    return `${getBrandPrefix(shopInfo)}您的预约因门店安排已取消。预约号：${appId}，发型师：${stylistName}，预约时间：${dateDisplay} ${displayTime}。如需重新预约，请打开小程序 ${miniProgramUrl}`;
}

function getBookingSuccessSMS(data) {
    return renderBookingSuccessText(data);
}

function getCancelBookingSMS(data) {
    return renderCancelBookingText(data);
}

function getBookingReminderSMS(data) {
    return renderBookingReminderText(data);
}

function getStylistCancelSMS(data) {
    return renderStylistCancelText(data);
}

function getBookingSuccessSMSSimple(data) {
    const { stylistName, date, time, appId } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    return `${getBrandPrefix()}您已成功预约！${appId}，${stylistName}，${dateDisplay} ${displayTime}。`;
}

function getCancelBookingSMSSimple(data) {
    const { stylistName, date, time, appId } = data;
    const dateDisplay = formatDateDisplay(date);
    const displayTime = formatTimeDisplay(time);
    return `${getBrandPrefix()}您的预约已取消。${appId}，${stylistName}，${dateDisplay} ${displayTime}。`;
}

module.exports = {
    MINI_PROGRAM_URL,
    COMPANY_NAME,
    SHOP_INFO,
    getBrandPrefix,
    formatDateDisplay,
    formatTimeDisplay,
    getBookingSuccessEmayTemplate,
    getCancelBookingEmayTemplate,
    getBookingReminderEmayTemplate,
    getStylistCancelEmayTemplate,
    buildBookingSmsVariables,
    buildCancelSmsVariables,
    buildReminderSmsVariables,
    buildStylistCancelSmsVariables,
    getBookingSuccessSMS,
    getCancelBookingSMS,
    getBookingReminderSMS,
    getStylistCancelSMS,
    getBookingSuccessSMSSimple,
    getCancelBookingSMSSimple
};
