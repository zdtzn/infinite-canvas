# 安全公网部署

## 首次部署

1. 把域名 A 记录解析到服务器公网 IP。首次管理员完成初始化前，先不要开放 Caddy 的 `80/443`。
2. 在项目目录复制 `.env.example` 为 `.env`，填写 `DOMAIN`、`PUBLIC_BASE_URL`、固定镜像 `IMAGE_REF` 和 `APP_ENCRYPTION_KEY`。加密密钥可用 `openssl rand -base64 32` 生成，部署后不要随意更换，否则旧渠道 Key 无法解密。
3. 先只启动绑定在服务器回环地址的应用：

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  up -d app
```

4. 在服务器上创建仅 root 可读的临时请求文件，并通过回环地址完成管理员初始化。管理员个人密码至少 10 位：

```bash
install -m 600 /dev/null /root/initial-admin.json
editor /root/initial-admin.json
# 文件内容：
# {"displayName":"管理员昵称","accessCode":"至少8位站点口令","personalCode":"至少10位管理员个人密码"}

curl -fsS \
  -H 'Content-Type: application/json' \
  --data-binary @/root/initial-admin.json \
  http://127.0.0.1:3000/api/auth/setup
rm -f /root/initial-admin.json
```

返回 `authenticated: true` 后，管理员已经建立。此接口只能成功一次，并且服务端只接受 `127.0.0.1`、`localhost` 或 `::1` 主机地址上的初始化请求。

5. 再开放安全组的 `80/443`，启动 Caddy，并从正式域名登录：

```bash
docker compose \
  --profile https \
  -f docker-compose.yml \
  -f docker-compose.production.yml \
  up -d
```

6. 受邀成员共用站点口令，但每个人使用自己的昵称和个人密码。所有成员完成首次登录后，在 `.env` 设置 `ALLOW_NEW_USERS=0`，再执行一次上述 `up -d`。这只关闭新账号创建，不影响已有账号登录。
7. 在“配置 -> 渠道”中填写接口地址与 API Key。Key 会加密写入 Docker 数据卷，不再保存在浏览器。

公网模式下项目、生成任务、图片、缩略图、视频和音频都会按用户写入 `infinite-canvas-data` 数据卷。默认每个用户最多保存 2 GiB 服务端素材和 2 GiB 任务结果，可分别通过 `MAX_USER_ASSET_BYTES`、`MAX_USER_JOB_FILE_BYTES` 调整。单张图片或音频最大 16 MB，单个视频最大 32 MB。

## 自动更新与回滚

正式环境使用 `IMAGE_REF` 固定版本号或镜像摘要，不使用移动的 `latest`。升级前先备份数据卷：

```bash
BACKUP_ROOT=/root/infinite-canvas-backups \
DATA_VOLUME_NAME=infinite-canvas-data \
sh ops/backup-volume.sh
```

生产环境文件与 `APP_ENCRYPTION_KEY` 应另存到加密的密钥备份中，不要和数据归档放在同一个备份目录。

升级时修改 `.env` 的 `IMAGE_REF`，再执行：

```bash
docker compose -f docker-compose.yml -f docker-compose.production.yml pull
docker compose --profile https -f docker-compose.yml -f docker-compose.production.yml up -d
```

需要回滚时把 `IMAGE_REF` 改回上一个已经验证的版本并重新执行以上两条命令。Compose 已明确禁止 Watchtower 自动更新应用容器，避免未经验证的镜像覆盖生产环境。

## 健康检查

```bash
curl -fsS https://你的域名/health
docker inspect --format '{{json .State.Health}}' infinite-canvas
docker logs --tail=100 infinite-canvas
```

`/health` 会返回版本、提交号，以及 SQLite、剩余磁盘和关机状态。HTTP `503` 表示数据库不可用、磁盘低于安全水位或服务正在平滑退出。服务端日志包含请求 ID、耗时和状态码；未预期的内部异常不会把堆栈或内部错误详情返回给浏览器。

上线后还应验证：真实域名 HTTPS 证书、渠道最小生图请求、刷新后的任务恢复、第二台设备的项目与素材恢复、成员停用，以及数据卷备份和回滚。

## 恢复失败时的处理

`ops/restore-volume.sh` 要求明确传入已验证的 `IMAGE_REF`，并会先校验校验和、试读压缩包，确认可读取后才停止应用。覆盖数据前还会在原备份目录自动创建 `pre-restore-*.tar.gz` 安全备份。旧备份缺少 `.sha256` 文件时默认拒绝恢复；只有确认归档可信时才可显式设置 `ALLOW_UNVERIFIED_RESTORE=1`，恢复后应立即重新创建带校验和的备份。

如果清空、解压或权限修复任一步失败，脚本会让应用保持停止，避免在不完整数据上启动。先检查错误；需要撤回时，把刚生成的 `pre-restore-*.tar.gz` 作为 `ARCHIVE` 再执行恢复。恢复成功并通过 `/health`、登录、项目和素材抽查后，才能删除这份安全备份。
