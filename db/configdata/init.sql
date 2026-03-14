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

CREATE INDEX IF NOT EXISTS idx_history_created_at ON deployment_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_history_deployment_id ON deployment_history(deployment_id);
CREATE INDEX IF NOT EXISTS idx_history_status ON deployment_history(status);
CREATE INDEX IF NOT EXISTS idx_deployments_server_id ON deployments(server_id);
CREATE INDEX IF NOT EXISTS idx_deployments_repo_id ON deployments(repo_id);
CREATE INDEX IF NOT EXISTS idx_task_configs_deployment_id ON task_configs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_task_config_snapshots_history_id ON task_config_snapshots(history_id);
CREATE INDEX IF NOT EXISTS idx_task_config_snapshot_files_snapshot_id ON task_config_snapshot_files(snapshot_id);

WITH
  s AS (
    INSERT INTO servers (name, address, ssh_user, deploy_path, description)
    SELECT '生产环境-01', '10.88.36.61', 'metalm', '/home/metalm/deploy/NexusOps/', 'seed'
    WHERE NOT EXISTS (SELECT 1 FROM servers)
    RETURNING id
  ),
  r AS (
    INSERT INTO repos (name, url, branch, project_id)
    SELECT 'Metalm-NexusOps', 'https://gitlab.xuelangyun.com/MetaLM/Metalm-NexusOps', 'master', 'MetaLM/Metalm-NexusOps'
    WHERE NOT EXISTS (SELECT 1 FROM repos)
    RETURNING id
  ),
  d AS (
    INSERT INTO deployments (name, server_id, repo_id)
    SELECT 'Nexus 智能体部署',
           COALESCE((SELECT id FROM s), (SELECT id FROM servers ORDER BY created_at ASC LIMIT 1)),
           COALESCE((SELECT id FROM r), (SELECT id FROM repos ORDER BY created_at ASC LIMIT 1))
    WHERE NOT EXISTS (SELECT 1 FROM deployments)
    RETURNING id
  )
INSERT INTO deployment_history (deployment_id, status, ref, server_snapshot, repo_snapshot, variables)
SELECT
  (SELECT id FROM d),
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
    'SERVER_USER', 'metalm'
  )
WHERE
  (SELECT id FROM d) IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM deployment_history);
