# S-HAIR 预约系统

理发店预约管理系统，支持用户端预约和管理端管理。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

复制 `env.example` 文件为 `.env`，并修改其中的账号信息：

**Windows:**
```bash
copy env.example .env
```

**Linux/Mac:**
```bash
cp env.example .env
```

编辑 `.env` 文件：

```env
# 超级管理员账号
ADMIN_USERNAME=your_admin_username
ADMIN_PASSWORD=your_admin_password
```

### 3. 配置门店与发型师

启动服务后访问 **平台管理中心** `http://localhost:3000/platform/`，使用 `.env` 中的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录，在后台创建门店和发型师（含手机号，用于小程序「管理」入口）。

### 4. 启动服务器

```bash
npm start
```

服务器将在 `http://localhost:3000` 启动。

## 环境变量说明

完整说明见 **[docs/cloud-hosting-env.md](docs/cloud-hosting-env.md)**（云托管控制台配置清单）。本地开发复制 `.env.example` 为 `.env`。

常用项：

| 变量 | 用途 |
|------|------|
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | 平台管理中心登录 |
| `MYSQL_*` | MySQL 连接（发型师、门店等数据入库） |
| `WX_APPID` / `WX_APPSECRET` | 微信手机号授权 |
| `EMAY_*` / `MINI_PROGRAM_URL` | 短信通知（可选；签名在亿美账号侧配置） |
| `TCB_ENV_ID` / `PLATFORM_SYNC_SECRET` | 平台同步到云开发（可选） |

发型师账号与手机号在 **平台后台** 维护，不再使用 `STYLISTS_JSON` 或 `stylists.json`。

### 短信服务配置（可选）

系统支持集成亿美软通短信服务，用于发送预约成功和取消预约的短信通知。

在 `.env` 文件中配置以下参数：

```env
# 亿美软通短信服务配置
EMAY_APPID=your_app_id
EMAY_SECRETKEY=your_secret_key_16chars
EMAY_TEMPLATE_ID_BOOKING=your_booking_template_id
EMAY_TEMPLATE_ID_CANCEL=your_cancel_template_id
```

**配置说明：**
- `EMAY_APPID` - 亿美软通应用ID
- `EMAY_SECRETKEY` - 亿美软通密钥（必须是16位字符串）
- `EMAY_TEMPLATE_ID_BOOKING` - 预约成功短信模板ID（可选，默认使用 `EMAY_TEMPLATE_ID`）
- `EMAY_TEMPLATE_ID_CANCEL` - 取消预约短信模板ID（可选，默认使用 `EMAY_TEMPLATE_ID`）

**注意：**
- 如果未配置短信服务，系统仍可正常使用，只是不会发送短信通知
- 短信发送是异步的，不会影响预约和取消操作的响应速度
- 短信模板中的变量名需要与 `sms-service.js` 中的变量名匹配

**短信模板变量：**
- `{#appId#}` - 预约号（手机号后4位）
- `{#stylistName#}` - 发型师姓名
- `{#date#}` - 预约日期（如：1月15日）
- `{#time#}` - 预约时间段（如：14:30-15:00）

## 访问地址

- 用户端 H5：`http://localhost:3000/`
- 平台管理 PC：`http://localhost:3000/platform/`
- 发型师管理：小程序「我的」→「管理」（需在平台为发型师填写手机号）

## 功能特性

- ✅ 用户端预约（无需注册）
- ✅ 手机号验证取消预约
- ✅ 发型师个人管理后台
- ✅ 超级管理员控制台
- ✅ 实时预约状态更新
- ✅ 移动端优化
- ✅ 短信通知（可选，需配置亿美软通）
- ✅ SQLite 数据库持久化（数据不会因重启丢失）

## 短信模板

系统提供了预约成功和取消预约的短信模板，位于 `sms-templates.js` 文件中。

### 使用方法

```javascript
const { 
    getBookingSuccessSMS, 
    getCancelBookingSMS,
    getBookingSuccessSMSSimple,
    getCancelBookingSMSSimple
} = require('./sms-templates');

// 预约成功短信
const bookingSMS = getBookingSuccessSMS({
    stylistName: 'Alexander',
    date: '2024-01-15',
    time: '14:30-15:00',
    appId: '1234',
    phone: '13800138000'
});

// 取消预约短信
const cancelSMS = getCancelBookingSMS({
    stylistName: 'Alexander',
    date: '2024-01-15',
    time: '14:30-15:00',
    appId: '1234',
    phone: '13800138000'
});
```

### 模板变量

- `stylistName` - 发型师姓名
- `date` - 预约日期（格式：YYYY-MM-DD）
- `time` - 预约时间段（格式：HH:MM-HH:MM）
- `appId` - 预约号（手机号后4位）
- `phone` - 手机号
- `shopName` - 店铺名称（可在 `sms-templates.js` 中配置）
- `shopPhone` - 店铺电话（可在 `sms-templates.js` 中配置）
- `shopAddress` - 店铺地址（可在 `sms-templates.js` 中配置）

### 自定义店铺信息

编辑 `sms-templates.js` 文件中的 `SHOP_INFO` 对象：

```javascript
const SHOP_INFO = {
    name: 'S-HAIR',
    phone: '400-888-8888',
    address: 'XX市XX区XX路XX号'
};
```

### 短信模板示例

**预约成功短信（完整版）：**
```
【S-HAIR】预约成功！您的预约号：1234，发型师：Alexander，时间：1月15日 14:30-15:00。如需取消请回复"取消1234"或致电400-888-8888。地址：XX市XX区XX路XX号
```

**预约成功短信（简化版）：**
```
【S-HAIR】预约成功！预约号：1234，Alexander，1月15日 14:30-15:00。
```

**取消预约短信（完整版）：**
```
【S-HAIR】您已成功取消预约（预约号：1234）。原预约信息：Alexander，1月15日 14:30-15:00。如需重新预约，请致电400-888-8888或访问预约系统。
```

**取消预约短信（简化版）：**
```
【S-HAIR】已取消预约（1234），Alexander，1月15日 14:30-15:00。
```

更多使用示例请参考 `sms-templates.example.js` 文件。
