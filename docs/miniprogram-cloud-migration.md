# 原生小程序改造说明

本次新增的是一套独立的微信原生小程序实现，保留原 H5/Express 代码不动。

## 目录

```text
miniprogram/              小程序前台
server.js                 云托管 Express 后端
docs/                     迁移和部署说明
```

## 微信开发者工具

1. 用微信开发者工具导入项目根目录。
2. 将 `project.config.json` 里的 `appid` 改成你自己的小程序 AppID。
3. 将 `miniprogram/app.js` 里的 `replace-with-your-cloud-env-id` 改成你的云开发环境 ID。
4. 确认云托管环境 ID 为 `reservation-d2gf73dgv8fd17503`。
5. 将当前 Express 服务部署到云托管服务 `express-vbry`。

小程序端通过 `wx.cloud.callContainer` 调用云托管服务，服务名配置在：

```text
miniprogram/utils/api.js
```

## MySQL 数据库

当前后端已经改为 MySQL 优先。云托管环境变量需要配置：

```text
MYSQL_ADDRESS=你的 MySQL 地址:3306
MYSQL_USERNAME=你的 MySQL 用户名
MYSQL_PASSWORD=你的 MySQL 密码
MYSQL_DATABASE=reservation_system
MYSQL_CONNECTION_LIMIT=10
WX_APPID=wxb76bea40dcb2999b
WX_APPSECRET=你的小程序 AppSecret
```

如果未填写 `MYSQL_DATABASE`，后端默认使用并自动创建 `reservation_system` 数据库。

手机号快速登录：小程序前端只拿手机号授权 `code`，后端调用微信 `getuserphonenumber` 接口换取手机号。

### 云托管手机号接口问题

云托管调用微信接口有两种方式，二选一即可：

**方式 B（推荐）：HTTP 开放接口服务**

1. 云托管控制台 → **云调用** → **开启「开放接口服务」**。
2. **微信令牌**白名单加入：`/wxa/business/getuserphonenumber`（头像上传另加 `/tcb/uploadfile`、`/tcb/batchdownloadfile`）。
3. 环境变量设置 `WX_USE_OPENAPI=1`。
4. **重新发布服务版本**（仅改变量不够，必须重新发布）。

**方式 A：HTTPS + WX_APPSECRET**

1. **关闭**「开放接口服务」。
2. 配置 `WX_APPSECRET`，**不要**设 `WX_USE_OPENAPI=1`。
3. 重新发布服务版本。

若出现 `502`，方案 B 请检查白名单是否含对应接口并已重新发布；方案 A 请确认已关闭开放接口服务。

本地开发不走云调用，仍需配置 `WX_APPSECRET`。

服务启动时会自动创建这些 MySQL 表，不需要手动建表：

```text
stores
stylists
appointments
blocked_slots
sessions
stylist_vacations
phone_blacklist
platform_audit_logs
```

公告按门店存放在 `stores.announcementText`。发型师账号在 `stylists` 表，通过平台 PC `/platform/` 维护。

## 发型师账号与管理入口

1. 访问 `http://你的域名/platform/`，用 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。
2. 在「发型师管理」为每位发型师填写**手机号**（须与微信授权手机号一致）。
3. 发型师在小程序「我的」页授权同号登录后，点击「管理」进入 `admin-dashboard`。

已移除 `STYLISTS_JSON`、`stylists.json`、`ADMIN_PHONES` 等环境变量配置方式。空库首次启动会写入占位发型师，请尽快在平台修改密码并填写手机号。

环境变量清单见 `.env.example`。

## 初始化公告

在 `announcement` 集合新增或导入文档，文档 `_id` 必须是 `current`：

```json
{
  "_id": "current",
  "text": ""
}
```

## 已迁移能力

- 获取公告
- 获取发型师及休假状态
- 获取今天、明天、后天可预约时段
- 剪发预约
- 烫染预约，自动选择 4 个可用时段
- 手机号一天一次预约限制
- 查询预约
- 查询排队进度
- 批量取消预约
- 本地保存最近一次预约手机号
- 「我的」页管理员手机号登录后显示「管理」入口
- 发型师预约列表（`admin-dashboard`）
- 管理员完成/取消预约
- 管理员锁定/解锁时间段
- 管理员休假设置
- 管理员公告设置

## 暂未迁移的能力

- 短信发送
- 微信开发者工具/真机联调

当前后端仍复用 `server.js` 的短信逻辑。短信密钥只应放在云托管服务环境变量中，不要放到小程序前台。

## 从旧系统迁移数据

旧系统使用 `data/reservations.db`。可以直接导入 MySQL。

安装依赖后可以运行：

```bash
npm install
node scripts/import-sqlite-to-mysql.js
```

运行前请先在 `.env` 或云托管环境变量里配置 MySQL 连接信息。

## 后续建议

1. 先在开发环境用空数据库完整跑通预约、取消、查询。
2. 再导入旧数据。
3. 在微信开发者工具和真机中完整联调用户端与管理端。
