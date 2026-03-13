# NexusOps 前端部署控制台（ui）

该目录提供一个最小化的 React 界面与 Node.js 代理服务，用于在页面中一键触发 GitLab Pipeline，从而执行项目根目录的 `.gitlab-ci.yml` 部署流程（目标分支为 `master`）。

## 快速开始

1. 准备 Node.js 18+
2. 进入目录并安装依赖
   ```bash
   cd ui
   npm install
   ```
3. 配置环境变量（建议在 `.env` 中按需设置）

   - PORT：服务端口，默认 `8080`
   - GITLAB_BASE_URL：GitLab 地址，默认 `https://gitlab.xuelangyun.com`
   - GITLAB_PROJECT：项目路径，默认 `MetaLM/Metalm-NexusOps`
   - TRIGGER_REF：触发分支，默认 `master`
   - TRIGGER_TOKEN：项目的 Pipeline Trigger Token（用于触发）
   - PRIVATE_TOKEN：个人访问令牌（可选，用于查询状态，亦可用于触发）

   仅配置 `TRIGGER_TOKEN` 时，可触发但无法查询状态；若需在页面展示最近一次 Pipeline 状态，请额外配置 `PRIVATE_TOKEN`。

4. 启动
   ```bash
   npm start
   ```
   打开浏览器访问 `http://localhost:8080/`。

## GitLab 配置要点

- 触发：推荐在项目 Settings → CI/CD → Pipeline triggers 新增一个 Trigger Token，将其作为 `TRIGGER_TOKEN`。
- 状态：若需在页面中查看最近一次 Pipeline 状态，请准备个人访问令牌（PRIVATE_TOKEN，需具有读 Pipeline 权限）。
- `.gitlab-ci.yml` 当前仅允许 `master` 分支运行部署任务，请确保 `TRIGGER_REF=master` 或在 GitLab 中调整策略。

## 安全建议

- 切勿将任何 Token 提交到仓库。使用 `.env` 或外部秘钥管理。
- 将该 UI 服务限制在内网或受控环境，前端不暴露 Token，所有与 GitLab 的交互均由服务端代理完成。

## 功能概览

- 一键触发部署：调用 GitLab Pipeline，执行 `.gitlab-ci.yml` 中的部署 Job。
- 状态查看（可选）：展示最近一次 Pipeline 的状态与快捷链接。

## 后续可扩展方向

- 权限控制与审计：为触发操作增加登录、角色与操作审计。
- 参数化部署：通过表单传入部署目标、环境变量，并作为 Pipeline 变量传递。
- Webhook 状态回流：在服务端接收 GitLab Webhook，实现更实时的状态推送与历史记录。
- 日志聚合：在页面展示最近部署日志摘要，或跳转到日志平台。
