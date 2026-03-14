CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS servers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  address text NOT NULL,
  ssh_user text NOT NULL DEFAULT 'metalm',
  deploy_path text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS repos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  url text NOT NULL,
  branch text NOT NULL DEFAULT 'master',
  project_id text,
  trigger_token text,
  private_token text,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deployments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  server_id uuid NOT NULL REFERENCES servers(id) ON DELETE RESTRICT,
  repo_id uuid NOT NULL REFERENCES repos(id) ON DELETE RESTRICT,
  input_dir text,
  dest_dir text,
  deploy_script text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS deployment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  pipeline_id bigint,
  status text,
  ref text,
  web_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  server_snapshot jsonb,
  repo_snapshot jsonb,
  variables jsonb
);

CREATE TABLE IF NOT EXISTS task_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  rel_path text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (deployment_id, rel_path)
);

CREATE TABLE IF NOT EXISTS task_config_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  history_id uuid NOT NULL REFERENCES deployment_history(id) ON DELETE CASCADE,
  deployment_id uuid NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (history_id)
);

CREATE TABLE IF NOT EXISTS task_config_snapshot_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES task_config_snapshots(id) ON DELETE CASCADE,
  rel_path text NOT NULL,
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (snapshot_id, rel_path)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_servers_name ON servers (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_repos_name ON repos (name);
CREATE UNIQUE INDEX IF NOT EXISTS uq_deployments_name ON deployments (name);

CREATE INDEX IF NOT EXISTS idx_history_created_at ON deployment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_deployment_id ON deployment_history(deployment_id);
CREATE INDEX IF NOT EXISTS idx_history_status ON deployment_history(status);
CREATE INDEX IF NOT EXISTS idx_deployments_server_id ON deployments(server_id);
CREATE INDEX IF NOT EXISTS idx_deployments_repo_id ON deployments(repo_id);
CREATE INDEX IF NOT EXISTS idx_task_configs_deployment_id ON task_configs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_task_config_snapshots_history_id ON task_config_snapshots(history_id);
CREATE INDEX IF NOT EXISTS idx_task_config_snapshot_files_snapshot_id ON task_config_snapshot_files(snapshot_id);

INSERT INTO servers (name, address, ssh_user, deploy_path, description)
VALUES ('生产环境-01', '10.88.36.61', 'metalm', '/home/metalm/deploy/NexusOps/', 'seed')
ON CONFLICT (name) DO NOTHING;

INSERT INTO repos (name, url, branch, project_id, description)
VALUES (
  'Metalm-NexusOps',
  'https://gitlab.xuelangyun.com/MetaLM/Metalm-NexusOps',
  'master',
  'MetaLM/Metalm-NexusOps',
  'seed'
)
ON CONFLICT (name) DO NOTHING;

INSERT INTO deployments (name, server_id, repo_id, input_dir, dest_dir, deploy_script)
SELECT
  'Nexus 智能体部署',
  s.id,
  r.id,
  './',
  '/home/metalm/deploy/NexusOps/',
  E'chmod +x down.sh up.sh\nsh down.sh\ndocker-compose up -d\n'
FROM servers s, repos r
WHERE s.name = '生产环境-01' AND r.name = 'Metalm-NexusOps'
ON CONFLICT (name) DO NOTHING;

INSERT INTO task_configs (deployment_id, rel_path, content)
SELECT
  d.id,
  'agents/backend/config.toml',
  E'[db]\nhost=\"127.0.0.1\"\nport=5432\nuser=\"postgres\"\npassword=\"example\"\n'
FROM deployments d
WHERE d.name = 'Nexus 智能体部署'
ON CONFLICT (deployment_id, rel_path) DO NOTHING;

INSERT INTO deployment_history (deployment_id, status, ref, server_snapshot, repo_snapshot, variables)
SELECT
  d.id,
  'success',
  'master',
  jsonb_build_object(
    'name', '生产环境-01',
    'address', '10.88.36.61',
    'ssh_user', 'metalm',
    'deploy_path', '/home/metalm/deploy/NexusOps/'
  ),
  jsonb_build_object(
    'name', 'Metalm-NexusOps',
    'url', 'https://gitlab.xuelangyun.com/MetaLM/Metalm-NexusOps',
    'branch', 'master',
    'project_id', 'MetaLM/Metalm-NexusOps'
  ),
  jsonb_build_object(
    'SERVER_HOST', '10.88.36.61',
    'SERVER_USER', 'metalm',
    'INPUT_DIR', './',
    'DEST_DIR', '/home/metalm/deploy/NexusOps/'
  )
FROM deployments d
WHERE d.name = 'Nexus 智能体部署'
  AND NOT EXISTS (SELECT 1 FROM deployment_history);

INSERT INTO task_config_snapshots (history_id, deployment_id)
SELECT
  h.id,
  h.deployment_id
FROM deployment_history h
ORDER BY h.created_at ASC
LIMIT 1
ON CONFLICT (history_id) DO NOTHING;

INSERT INTO task_config_snapshot_files (snapshot_id, rel_path, content)
SELECT
  s.id,
  c.rel_path,
  c.content
FROM task_config_snapshots s
JOIN task_configs c ON c.deployment_id = s.deployment_id
ORDER BY s.created_at ASC
LIMIT 1
ON CONFLICT (snapshot_id, rel_path) DO NOTHING;
