# Database (PostgreSQL)

该目录提供 NexusOps 的 PostgreSQL 初始化脚本与数据库容器配置。

## 结构

```text
db/
├── docker-compose.yml
└── configdata/
    └── init.sql
```

## 初始化脚本

启动 PostgreSQL 容器时，会自动执行 `configdata/init.sql`：
- 创建核心表：servers、repos、deployments、deployment_history
- 创建配置中心表：task_configs、task_config_snapshots、task_config_snapshot_files
- 创建常用索引
- 写入最小化种子数据（不包含 Token 等敏感信息，每张表只保留最少一条用于本地测试）

## 说明

后端默认连接本目录的 PostgreSQL（见环境变量 `NEXUSOPS_PG_HOST/NEXUSOPS_PG_PORT/...` 或 `DATABASE_URL`）。
