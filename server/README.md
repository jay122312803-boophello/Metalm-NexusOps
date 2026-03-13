# NexusOps Server

FastAPI 后端服务，负责管理服务器、仓库及触发 GitLab 部署。

## 启动方式 (使用 uv)

本项目使用 `uv` 进行依赖管理和启动。

1. **安装 uv** (如果尚未安装):
   ```bash
   curl -LsSf https://astral.sh/uv/install.sh | sh
   ```

2. **安装依赖**:
   ```bash
   uv sync
   ```

3. **启动服务**:
   ```bash
   uv run main.py
   ```
   或者直接使用 uvicorn:
   ```bash
   uv run uvicorn main:app --host 0.0.0.0 --port 8000 --reload
   ```

## 数据存储
所有数据存储在 `data/db.json` 中。该文件已被 `.gitignore` 忽略，确保本地数据不被提交。

## API 文档
启动后访问: [http://localhost:8000/docs](http://localhost:8000/docs)
