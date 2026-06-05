/**
 * 短信模板配置
 * 变量说明：
 * {stylistName} - 发型师姓名
 * {date} - 预约日期（格式：YYYY-MM-DD）
 * {dateDisplay} - 预约日期（格式：MM月DD日）
 * {time} - 预约时间段（格式：HH:MM-HH:MM）
 * {appId} - 预约号（手机号后4位）
 * {phone} - 手机号
 * {shopName} - 店铺名称
 * {shopPhone} - 店铺电话
 * {shopAddress} - 店铺地址
 */

// 店铺信息配置（可根据实际情况修改）
const SHOP_INFO = {
    name: '欧诺造型',
    phone: '17675610733',
    address: '广州市白云区白灰场南路2号'
};

/**
 * 预约成功短信模板
 */
function getBookingSuccessSMS(data) {
    const {
        stylistName,
        date,
        time,
        appId,
        phone,
        shopName = SHOP_INFO.name,
        shopPhone = SHOP_INFO.phone,
        shopAddress = SHOP_INFO.address
    } = data;
    
    // 格式化日期显示
    const dateObj = new Date(date);
    const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    
    // 格式化时间显示：从时间段（如"10:00-10:30"）提取开始时间（"10:00"）
    function formatTimeDisplay(timeStr) {
        if (!timeStr) return '';
        // 如果是逗号分隔的多个时间段（烫染服务），取第一个时间段的开始时间
        if (timeStr.includes(',')) {
            const firstTime = timeStr.split(',')[0].trim();
            const [startTime] = firstTime.split('-');
            return startTime;
        }
        // 单个时间段，提取开始时间
        const [startTime] = timeStr.split('-');
        return startTime || timeStr;
    }
    
    const displayTime = formatTimeDisplay(time);
    
    // 短信模板
    const template = `【${shopName}】预约成功！您的预约号：${appId}，发型师：${stylistName}，时间：${dateDisplay} ${displayTime}。如需取消请回复"取消${appId}"或致电${shopPhone}。地址：${shopAddress}`;
    
    return template;
}

/**
 * 取消预约短信模板
 */
function getCancelBookingSMS(data) {
    const {
        stylistName,
        date,
        time,
        appId,
        phone,
        shopName = SHOP_INFO.name,
        shopPhone = SHOP_INFO.phone
    } = data;
    
    // 格式化日期显示
    const dateObj = new Date(date);
    const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    
    // 格式化时间显示：从时间段（如"10:00-10:30"）提取开始时间（"10:00"）
    function formatTimeDisplay(timeStr) {
        if (!timeStr) return '';
        // 如果是逗号分隔的多个时间段（烫染服务），取第一个时间段的开始时间
        if (timeStr.includes(',')) {
            const firstTime = timeStr.split(',')[0].trim();
            const [startTime] = firstTime.split('-');
            return startTime;
        }
        // 单个时间段，提取开始时间
        const [startTime] = timeStr.split('-');
        return startTime || timeStr;
    }
    
    const displayTime = formatTimeDisplay(time);
    
    // 短信模板
    const template = `【${shopName}】您已成功取消预约（预约号：${appId}）。原预约信息：${stylistName}，${dateDisplay} ${displayTime}。如需重新预约，请致电${shopPhone}或访问预约系统。`;
    
    return template;
}

/**
 * 简化版预约成功短信（更简洁）
 */
function getBookingSuccessSMSSimple(data) {
    const {
        stylistName,
        date,
        time,
        appId,
        shopName = SHOP_INFO.name
    } = data;
    
    const dateObj = new Date(date);
    const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    
    // 格式化时间显示：从时间段（如"10:00-10:30"）提取开始时间（"10:00"）
    function formatTimeDisplay(timeStr) {
        if (!timeStr) return '';
        if (timeStr.includes(',')) {
            const firstTime = timeStr.split(',')[0].trim();
            const [startTime] = firstTime.split('-');
            return startTime;
        }
        const [startTime] = timeStr.split('-');
        return startTime || timeStr;
    }
    
    const displayTime = formatTimeDisplay(time);
    
    return `【${shopName}】预约成功！预约号：${appId}，${stylistName}，${dateDisplay} ${displayTime}。`;
}

/**
 * 简化版取消预约短信（更简洁）
 */
function getCancelBookingSMSSimple(data) {
    const {
        stylistName,
        date,
        time,
        appId,
        shopName = SHOP_INFO.name
    } = data;
    
    const dateObj = new Date(date);
    const dateDisplay = `${dateObj.getMonth() + 1}月${dateObj.getDate()}日`;
    
    // 格式化时间显示：从时间段（如"10:00-10:30"）提取开始时间（"10:00"）
    function formatTimeDisplay(timeStr) {
        if (!timeStr) return '';
        if (timeStr.includes(',')) {
            const firstTime = timeStr.split(',')[0].trim();
            const [startTime] = firstTime.split('-');
            return startTime;
        }
        const [startTime] = timeStr.split('-');
        return startTime || timeStr;
    }
    
    const displayTime = formatTimeDisplay(time);
    
    return `【${shopName}】已取消预约（${appId}），${stylistName}，${dateDisplay} ${displayTime}。`;
}

module.exports = {
    SHOP_INFO,
    getBookingSuccessSMS,
    getCancelBookingSMS,
    getBookingSuccessSMSSimple,
    getCancelBookingSMSSimple
};
