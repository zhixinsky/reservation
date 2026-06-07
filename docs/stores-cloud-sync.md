# 门店数据同步到云开发

平台 MySQL 为权威数据源；云开发 `stores` / `phone_blacklist` 集合供**云函数**按 `storeId` 读取规则（小程序主路径仍走云托管 Express + MySQL）。

## 配置

1. 在 `.env` 与云托管环境变量中设置相同值：

```text
PLATFORM_SYNC_SECRET=你的随机密钥
TCB_ENV_ID=reservation-d2gf73dgv8fd17503
CLOUD_FUNCTION_NAME=api
WX_APPSECRET=...
```

2. 在微信云开发控制台 → 云函数 `api` → 环境变量，添加：

```text
PLATFORM_SYNC_SECRET=与上面相同
```

3. 重新**上传并部署**云函数 `cloudfunctions/api`（含 `store-helpers.js`）。

## 同步步骤

1. 登录平台 PC → **门店管理**
2. 点击 **「同步到云开发」**
3. 成功后云数据库应有：
   - `stores`：每店一条（含营业时间、默认锁定、公告等）
   - `phone_blacklist`：当前有效黑名单

## 云函数行为（同步后）

| 能力 | 说明 |
|------|------|
| `getStores` | 返回营业中门店列表 |
| `getStylists` | 支持 `storeId` 过滤，营业时间按门店配置 |
| `getSlots` / `bookAppointment` | 按发型师所属门店规则与黑名单校验 |
| `getAnnouncement` | 支持 `storeId`，读门店 `announcementText` |

## 注意

- 未同步时云函数回退默认规则（11:00–22:30 等），与 MySQL 可能不一致。
- 修改门店规则后建议再次点击同步，或后续可扩展为保存门店时自动同步。
