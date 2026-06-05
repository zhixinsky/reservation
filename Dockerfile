# 使用官方 Node.js 运行时作为基础镜像
FROM node:18-alpine

# 安装时区数据和 CA 根证书（请求微信 HTTPS 接口需要）
RUN apk add --no-cache tzdata ca-certificates && update-ca-certificates

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json（如果存在）
COPY package*.json ./

# 安装依赖
RUN npm install --production

# 复制应用代码
COPY . .

# 创建必要的目录（数据库文件将存储在这里）
RUN mkdir -p /app/data

# 设置数据目录权限
RUN chmod 755 /app/data

# 云托管默认探测 80 端口
EXPOSE 80

# 设置环境变量
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
ENV PORT=80
# 微信云托管「开放接口服务」会注入自签名证书，Node.js 需信任该证书
ENV NODE_EXTRA_CA_CERTS=/app/cert/certificate.crt

# 启动应用
CMD ["node", "server.js"]
