/**
 * 打印可在亿美控制台手动创建的短信模板（需选择「行业通知」分类）
 * 用法：node scripts/print-sms-templates-for-console.js
 */

require('dotenv').config();
const {
    SHOP_INFO,
    getBookingSuccessEmayTemplate,
    getCancelBookingEmayTemplate,
    getBookingReminderEmayTemplate,
    getStylistCancelEmayTemplate
} = require('../sms-templates');

const TEMPLATES = [
    { label: '预约成功', envKey: 'EMAY_TEMPLATE_ID_BOOKING', content: getBookingSuccessEmayTemplate(SHOP_INFO) },
    { label: '取消预约', envKey: 'EMAY_TEMPLATE_ID_CANCEL', content: getCancelBookingEmayTemplate(SHOP_INFO) },
    { label: '预约提醒', envKey: 'EMAY_TEMPLATE_ID_REMINDER', content: getBookingReminderEmayTemplate(SHOP_INFO) },
    { label: '门店取消预约', envKey: 'EMAY_TEMPLATE_ID_STYLIST_CANCEL', content: getStylistCancelEmayTemplate(SHOP_INFO) }
];

console.log('请在亿美后台手动创建模板，分类选择：行业通知');
console.log('创建并审核通过后，将 templateId 写入 .env 对应变量\n');

TEMPLATES.forEach((item, index) => {
    console.log(`========== ${index + 1}. ${item.label} ==========`);
    console.log(`分类：行业通知`);
    console.log(`.env 变量：${item.envKey}`);
    console.log('模板内容：');
    console.log(item.content);
    console.log('');
});
