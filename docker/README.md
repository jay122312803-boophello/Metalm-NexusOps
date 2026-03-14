## Docker

该目录用于构建与启动 NexusOps 的前端、后端与数据库。

### 目录结构

- `docker/backend/Dockerfile`：后端镜像
- `docker/frontend/Dockerfile`：前端镜像（Nginx 托管静态文件，并反向代理 `/api` 到后端）
- `docker/docker-compose.yml`：一键启动 frontend + backend + db（同一网络）

### 启动

- 先启动数据库：
  - `docker-compose -f docker/db/docker-compose.yml up -d`
- 再启动前后端：
  - `docker-compose -f docker/docker-compose.yml up -d --build`

默认：
- 前端：`http://localhost:18088/`
- 后端：`http://localhost:18070/`

可选环境变量：
- `NEXUSOPS_PG_IMAGE`：PostgreSQL 镜像（不同架构/镜像源可覆盖）
- `NEXUSOPS_PG_PASS`：PostgreSQL 密码（默认 metalm2024）
- `NEXUSOPS_PG_HOST`：PostgreSQL 容器名/地址（默认 nexusops-pg）
- `NEXUSOPS_BASE_IMAGE`：前后端构建用基础镜像（不同架构/镜像源可覆盖）

如果本机已存在旧的 `nexusops-pg` 容器导致冲突，先停止并移除旧容器后再启动。
