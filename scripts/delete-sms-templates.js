/**
 * 批量删除亿美短信模板
 * 用法：node scripts/delete-sms-templates.js [templateId...]
 * 示例：node scripts/delete-sms-templates.js 178074546420000334 178074546422300334
 */

require('dotenv').config();
const { deleteTemplate, queryTemplate, SMS_ENABLED } = require('../sms-service');

const DEFAULT_IDS = [
    { label: '预约成功（旧）', id: '178074546420000334' },
    { label: '取消预约（旧）', id: '178074546422300334' },
    { label: '预约提醒（旧）', id: '178074546423700334' },
    { label: '门店取消预约（旧）', id: '178074546425100334' }
];

async function main() {
    if (!SMS_ENABLED) {
        console.error('未配置 EMAY_APPID / EMAY_SECRETKEY');
        process.exit(1);
    }

    const cliIds = process.argv.slice(2);
    const targets = cliIds.length > 0
        ? cliIds.map(id => ({ label: id, id }))
        : DEFAULT_IDS;

    for (const item of targets) {
        try {
            const queried = await queryTemplate(item.id);
            console.log(`查询 ${item.label} (${item.id}): status=${queried.status}`);
        } catch (error) {
            console.log(`查询 ${item.label} (${item.id}): ${error.message}`);
        }

        try {
            const ok = await deleteTemplate(item.id);
            console.log(`${ok ? '✓' : '✗'} 删除 ${item.label} (${item.id}): ${ok ? '成功' : '失败'}`);
        } catch (error) {
            console.log(`✗ 删除 ${item.label} (${item.id}): ${error.message}`);
        }
    }
}

main().catch(error => {
    console.error(error);
    process.exit(1);
});
