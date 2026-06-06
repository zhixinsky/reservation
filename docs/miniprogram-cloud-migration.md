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

**方式 A（推荐，默认）：HTTPS + WX_APPSECRET**

1. 在云托管环境变量配置 `WX_APPSECRET`（小程序 AppSecret）。
2. 重新发布服务版本。`Dockerfile` 已配置 `NODE_EXTRA_CA_CERTS`，`server.js` 会自动信任云托管注入证书，解决 `self-signed certificate`。

**方式 B：HTTP 开放接口服务（免 AppSecret）**

1. 在云托管控制台打开 **云调用 → 开放接口服务** 开关。
2. 在权限配置中加入接口：`/wxa/business/getuserphonenumber`。
3. 环境变量设置 `WX_USE_OPENAPI=1`。
4. **重新发布服务版本**（仅改变量不够，必须重新构建版本）。

若出现 `502`，通常是走了方式 B 但开放接口服务未正确生效；去掉 `WX_USE_OPENAPI` 并配置 `WX_APPSECRET` 即可回到方式 A。

本地开发不走云调用，仍需配置 `WX_APPSECRET`。

服务启动时会自动创建这些 MySQL 表，不需要手动建表：

```text
appointments
blocked_slots
sessions
stylist_vacations
```

公告目前仍存放在 `data/announcement.json`，发型师账号仍优先读取 `stylists.json`。如需把公告和发型师账号也迁入 MySQL，可以继续扩展。

## 发型师账号

云托管生产环境推荐用 `STYLISTS_JSON` 环境变量配置发型师账号。示例：

```json
[{"id":1,"name":"店长","workStatus":"working","username":"tony","password":"你的密码"}]
```

后端读取顺序：

```text
STYLISTS_JSON 环境变量 -> stylists.json 本地文件 -> 默认占位账号
```

正式环境请务必设置 `STYLISTS_JSON`，不要依赖默认占位账号。

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
- 左上角隐藏入口进入管理员登录
- 管理员登录
- 管理员预约列表
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
