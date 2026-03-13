import json
import uuid
import os
from datetime import datetime

# Data extracted from user request and ui/.env
repo_data = {
    "id": str(uuid.uuid4()),
    "name": "Metalm-NexusOps",
    "url": "https://gitlab.xuelangyun.com/MetaLM/Metalm-NexusOps",
    "branch": "master",
    "trigger_token": "d782472ee4ec7543e5683953b26dba",
    "private_token": "suzR1Jzj6W6TAhs2EKwv",
    "project_id": "MetaLM/Metalm-NexusOps",
    "created_at": datetime.now().isoformat()
}

# Data extracted from user request (CI variables)
# Using 10.88.36.61 as the host based on previous context, as 'SERVER_HOST' looks like a placeholder key
server_data = {
    "id": str(uuid.uuid4()),
    "name": "生产环境-01",
    "address": "10.88.36.61", 
    "deploy_path": "/home/metalm/deploy/NexusOps/",
    "description": "User: metalm",
    "created_at": datetime.now().isoformat()
}

db_path = "data/db.json"
os.makedirs("data", exist_ok=True)

db = {"servers": [], "repos": [], "deployments": [], "history": []}
if os.path.exists(db_path):
    try:
        with open(db_path, 'r') as f:
            content = f.read()
            if content.strip():
                db = json.loads(content)
    except Exception as e:
        print(f"Error reading db: {e}")

# Add if not exists (simple check by name)
repo_id = None
existing_repo = next((r for r in db['repos'] if r['name'] == repo_data['name']), None)
if not existing_repo:
    db['repos'].append(repo_data)
    repo_id = repo_data['id']
    print("Added Repo: Metalm-NexusOps")
else:
    repo_id = existing_repo['id']
    # Update tokens just in case
    existing_repo['trigger_token'] = repo_data['trigger_token']
    existing_repo['private_token'] = repo_data['private_token']
    print("Updated Repo: Metalm-NexusOps")

server_id = None
existing_server = next((s for s in db['servers'] if s['name'] == server_data['name']), None)
if not existing_server:
    db['servers'].append(server_data)
    server_id = server_data['id']
    print("Added Server: 生产环境-01")
else:
    server_id = existing_server['id']
    print("Server already exists")

# Add a default deployment linking them
if repo_id and server_id:
    dep_name = "Nexus 智能体部署"
    if not any(d['name'] == dep_name for d in db['deployments']):
        dep_data = {
            "id": str(uuid.uuid4()),
            "name": dep_name,
            "server_id": server_id,
            "repo_id": repo_id,
            "created_at": datetime.now().isoformat()
        }
        db['deployments'].append(dep_data)
        print("Added Deployment: Nexus 智能体部署")
    else:
        print("Deployment already exists")

with open(db_path, 'w') as f:
    json.dump(db, f, indent=2, ensure_ascii=False)
