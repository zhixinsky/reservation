/**
 * 短信模板配置（小程序版）
 * 变量说明：
 * {stylistName} - 发型师姓名
 * {date} - 预约日期（格式：YYYY-MM-DD）
 * {dateDisplay} - 预约日期（格式：MM月DD日）
 * {time} - 预约时间段（格式：HH:MM-HH:MM）
 * {appId} - 预约号（手机号后4位）
 * {phone} - 手机号
 * {shopName} - 店铺名称（如：欧诺造型）
 * {shopPhone} - 店铺电话
 * {shopAddress} - 店铺地址
 * {miniProgramUrl} - 小程序访问链接
 */

const MINI_PROGRAM_URL = process.env.MINI_PROGRAM_URL || 'https://wxaurl.cn/byRtNK8KNSc';

// 默认店铺信息（无门店上下文时的兜底，正式环境以 stores 表为准）
const SHOP_INFO = {
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

/** 短信正文前缀（签名【育文游】等在亿美账号侧配置，不在代码里拼） */
function getBrandPrefix(shopInfo = SHOP_INFO) {
    const name = shopInfo.name || SHOP_INFO.name;
    return `${name}提醒您，`;
}

/**
 * 亿美个性模板内容（变量格式 {#name#}）
 * 短信签名在亿美账号侧配置；正文使用 {#shopName#} / {#shopPhone#} 支持多门店。
 */
function getBookingSuccessEmayTemplate() {
    return '{#shopName#}提醒您，您已成功预约！预约号：{#appId#}，发型师：{#stylistName#}，时间：{#date#} {#time#}。门店电话：{#shopPhone#}。请提前5分钟到店，取消或改约请打开 {#miniProgramUrl#}';
}

function getCancelBookingEmayTemplate() {
    return '{#shopName#}提醒您，您的预约已取消。预约号：{#appId#}，发型师：{#stylistName#}，时间：{#date#} {#time#}。门店电话：{#shopPhone#}。如需重新预约请打开 {#miniProgramUrl#}';
}

function getBookingReminderEmayTemplate() {
    return '{#shopName#}提醒您，您已预约{#stylistName#}，时间：{#date#} {#time#}。门店电话：{#shopPhone#}。请提前5分钟到店，打开 {#miniProgramUrl#}';
}

function getStylistCancelEmayTemplate() {
    return '{#shopName#}提醒您，您的预约因门店安排已取消。预约号：{#appId#}，发型师：{#stylistName#}，时间：{#date#} {#time#}。门店电话：{#shopPhone#}。如需重新预约请打开 {#miniProgramUrl#}';
}

function buildMiniProgramUrl(data) {
    return String(data.miniProgramUrl || SHOP_INFO.miniProgramUrl);
}

function buildBookingSmsVariables(data) {
    const vars = {
        appId: String(data.appId),
        stylistName: String(data.stylistName),
        date: formatDateDisplay(data.date),
        time: formatTimeDisplay(data.time),
        miniProgramUrl: buildMiniProgramUrl(data)
    };
    vars.shopName = String(data.shopName || SHOP_INFO.name);
    vars.shopPhone = String(data.shopPhone || SHOP_INFO.phone);
    return vars;
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
    SHOP_INFO,
    getBrandPrefix,
    formatDateDisplay,
    formatTimeDisplay,
    getBookingSuccessEmayTemplate,
    getCancelBookingEmayTemplate,
    getBookingReminderEmayTemplate,
    getStylistCancelEmayTemplate,
    buildMiniProgramUrl,
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
