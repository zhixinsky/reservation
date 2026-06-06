/**
 * 强制向亿美平台提交创建全部小程序短信模板（忽略 .env 中已有模板 ID）
 * 用法：node scripts/create-sms-templates.js
 */

require('dotenv').config();
const {
    SHOP_INFO,
    getBookingSuccessEmayTemplate,
    getCancelBookingEmayTemplate,
    getBookingReminderEmayTemplate,
    getStylistCancelEmayTemplate
} = require('../sms-templates');
const { createTemplate, queryTemplate, SMS_ENABLED } = require('../sms-service');
const { upsertTemplateEntry, loadTemplateStore } = require('../sms-template-store');

const TEMPLATES = [
    { type: 'booking', label: '预约成功', content: getBookingSuccessEmayTemplate(SHOP_INFO) },
    { type: 'cancel', label: '取消预约', content: getCancelBookingEmayTemplate(SHOP_INFO) },
    { type: 'reminder', label: '预约提醒', content: getBookingReminderEmayTemplate(SHOP_INFO) },
    { type: 'stylistCancel', label: '门店取消预约', content: getStylistCancelEmayTemplate(SHOP_INFO) }
];

async function main() {
    if (!SMS_ENABLED) {
        console.error('未配置 EMAY_APPID / EMAY_SECRETKEY，无法创建模板');
        process.exit(1);
    }

    console.warn('⚠️  注意：亿美 createTemplateSMS 接口无法设置「模板分类」，API 创建的模板在后台分类为空。');
    console.warn('⚠️  如需显示「行业通知」，请运行: node scripts/print-sms-templates-for-console.js 并在控制台手动创建。');
    console.log('小程序链接:', SHOP_INFO.miniProgramUrl);
    console.log('---');

    const store = loadTemplateStore();
    const results = [];

    for (const item of TEMPLATES) {
        console.log(`\n【${item.label}】`);
        console.log('模板内容:', item.content);
        try {
            const templateId = await createTemplate(item.content);
            upsertTemplateEntry(store, item.type, {
                templateId,
                templateContent: item.content,
                status: '0'
            });

            let status = '0';
            try {
                const queried = await queryTemplate(templateId);
                status = queried.status;
            } catch (_) {
                // 刚创建可能还查不到，忽略
            }

            results.push({
                type: item.type,
                label: item.label,
                templateId,
                status,
                envKey: {
                    booking: 'EMAY_TEMPLATE_ID_BOOKING',
                    cancel: 'EMAY_TEMPLATE_ID_CANCEL',
                    reminder: 'EMAY_TEMPLATE_ID_REMINDER',
                    stylistCancel: 'EMAY_TEMPLATE_ID_STYLIST_CANCEL'
                }[item.type]
            });
            console.log(`✓ 已提交，templateId=${templateId}，审核状态=${status}（0待审核 1通过 2失败）`);
        } catch (error) {
            console.error(`✗ 创建失败: ${error.message}`);
            results.push({ type: item.type, label: item.label, error: error.message });
        }
    }

    console.log('\n========== 创建结果汇总 ==========');
    results.forEach(r => {
        if (r.templateId) {
            console.log(`${r.label}: ${r.templateId} (${r.envKey})`);
        } else {
            console.log(`${r.label}: 失败 - ${r.error}`);
        }
    });
    console.log('\n审核通过后，可将上述 ID 写入 .env，或删除 .env 中的旧 ID 让服务自动使用 data/sms-template-config.json');
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
