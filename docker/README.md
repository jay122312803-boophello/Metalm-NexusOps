## Docker

该目录用于构建与启动 NexusOps 的前端、后端与数据库。

### 目录结构

- `docker/backend/Dockerfile`：后端镜像
- `docker/frontend/Dockerfile`：前端镜像（Nginx 托管静态文件，并反向代理 `/api` 到后端）
- `docker/db/docker-compose.yml`：数据库单独启动
- `docker/docker-compose.yml`：启动 frontend + backend（同一网络）

### 启动

- 先启动数据库：
  - `docker-compose -f docker/db/docker-compose.yml up -d`

### 构建镜像（两步走）

- 构建后端镜像：
  - `NEXUSOPS_BACKEND_IMAGE=nexusops-backend:latest sh docker/backend/build.sh`
- 构建前端镜像：
  - `NEXUSOPS_FRONTEND_IMAGE=nexusops-frontend:latest sh docker/frontend/build.sh`

### 启动前后端（不构建）

- `docker-compose -f docker/docker-compose.yml up -d --no-build`

默认：
- 前端：`http://localhost:18088/`
- 后端：`http://localhost:18070/`

可选环境变量：
- `NEXUSOPS_PG_IMAGE`：PostgreSQL 镜像（不同架构/镜像源可覆盖）
- `NEXUSOPS_PG_PASS`：PostgreSQL 密码（默认 metalm2024）
- `NEXUSOPS_PG_HOST`：PostgreSQL 容器名/地址（默认 nexusops-pg）
- `NEXUSOPS_BASE_IMAGE`：前后端构建用基础镜像（不同架构/镜像源可覆盖）
- `NEXUSOPS_PLATFORM`：构建/运行平台（例如 linux/amd64）
- `NEXUSOPS_BACKEND_IMAGE`：后端镜像名（compose 会用这个）
- `NEXUSOPS_FRONTEND_IMAGE`：前端镜像名（compose 会用这个）

如果本机已存在旧的 `nexusops-pg` 容器导致冲突，先停止并移除旧容器后再启动。
