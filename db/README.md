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
- 创建常用索引
- 写入最小化种子数据（不包含 Token 等敏感信息）

## 说明

当前后端仍使用 `backend/data/db.json` 作为存储；该 PostgreSQL 结构用于后续将存储迁移到数据库时直接复用。

