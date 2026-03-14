## backend_frontend (develop)

该目录用于本地测试部署目录与“私有配置文件挂载”能力。

### 私有配置挂载

`docker-compose.yml` 支持将宿主机上的 TOML 配置文件挂载到容器内：

- 基础配置：`$NEXUSOPS_CONFIG_TOML`（默认 `./config.toml`）挂载到 `/config.toml`
- 开发覆盖：`$NEXUSOPS_CONFIG_DEV_TOML`（默认 `./config.dev.toml`）挂载到 `/config.dev.toml`
- 目标目录：`$DEST_DIR`（可选，默认 `/home/metalm/deploy/NexusOps`）

容器启动后会优先读取 `/config.dev.toml` 中的 `test_key`（如存在），否则读取 `/config.toml`，并打印 `metalm.test.test_key` 的值，方便验证覆盖规则是否生效。

### 示例

1) 准备私有配置（不会提交到仓库，已加入忽略列表）：

- `develop/backend_frontend/config.toml`
- `develop/backend_frontend/config.dev.toml`（可选，存在 `test_key` 时覆盖）

2) 启动：

- `docker-compose up -d`
