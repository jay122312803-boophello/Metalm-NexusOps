# NexusOps (Monorepo)

## 目录结构

```text
.
├── frontend/   # React + Vite
├── backend/    # FastAPI
└── .gitlab-ci.yml
```

## 本地开发

### Backend

```bash
cd backend
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

默认情况下，前端开发服务器会将 `/api` 代理到 `http://localhost:8000`。

## 生产构建

```bash
cd frontend
npm run build
```

后端会在检测到 `frontend/dist` 存在时，自动作为静态站点提供（SPA）。
