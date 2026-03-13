import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import axios from "axios";
import dotenv from "dotenv";
import https from "https";

dotenv.config();

// 忽略自签名证书错误（针对内网 GitLab）
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname, { index: "index.html" }));

const PORT = parseInt(process.env.PORT || 8080, 10);
const GITLAB_BASE_URL = process.env.GITLAB_BASE_URL || "https://gitlab.xuelangyun.com";
const GITLAB_PROJECT = process.env.GITLAB_PROJECT || "MetaLM/Metalm-NexusOps";
const TRIGGER_REF = process.env.TRIGGER_REF || "master";
const TRIGGER_TOKEN = process.env.TRIGGER_TOKEN;
const PRIVATE_TOKEN = process.env.PRIVATE_TOKEN;

function encProject(p) {
  return encodeURIComponent(p);
}

// 记录配置状态（不打印 Token）
console.log(`[Config] Project: ${GITLAB_PROJECT}`);
console.log(`[Config] Ref: ${TRIGGER_REF}`);
console.log(`[Config] Trigger Token: ${TRIGGER_TOKEN ? 'Present' : 'Missing'}`);
console.log(`[Config] Private Token: ${PRIVATE_TOKEN ? 'Present' : 'Missing'}`);

app.post("/api/deploy", async (req, res) => {
  console.log(`[Deploy] Triggering deployment for ${GITLAB_PROJECT} on ${TRIGGER_REF}...`);
  try {
    let result;
    if (TRIGGER_TOKEN) {
      const url = `${GITLAB_BASE_URL}/api/v4/projects/${encProject(GITLAB_PROJECT)}/trigger/pipeline`;
      const params = new URLSearchParams();
      params.append("token", TRIGGER_TOKEN);
      params.append("ref", TRIGGER_REF);
      
      const r = await axios.post(url, params, {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      result = r.data;
    } else if (PRIVATE_TOKEN) {
      const url = `${GITLAB_BASE_URL}/api/v4/projects/${encProject(GITLAB_PROJECT)}/pipeline`;
      const params = new URLSearchParams();
      params.append("ref", TRIGGER_REF);
      
      const r = await axios.post(url, params, {
        headers: { 
          "Content-Type": "application/x-www-form-urlencoded", 
          "PRIVATE-TOKEN": PRIVATE_TOKEN 
        },
      });
      result = r.data;
    } else {
      console.error("[Deploy] Error: No token configured");
      return res.status(400).json({ ok: false, error: "未配置任何 Token (TRIGGER_TOKEN 或 PRIVATE_TOKEN)" });
    }

    console.log(`[Deploy] Success: Pipeline ID ${result.id}`);
    const webUrl = result.web_url || `${GITLAB_BASE_URL}/${GITLAB_PROJECT}/-/pipelines/${result.id}`;
    res.json({ 
      ok: true, 
      pipeline: { id: result.id, status: result.status, ref: result.ref }, 
      web_url: webUrl 
    });
  } catch (e) {
    const status = e.response ? e.response.status : 'Unknown';
    const msg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    console.error(`[Deploy] Failed (Status ${status}):`, msg);
    res.status(500).json({ ok: false, error: `触发失败: ${msg}` });
  }
});

app.get("/api/status", async (req, res) => {
  try {
    if (!PRIVATE_TOKEN) {
      return res.json({ ok: false, error: "未配置 PRIVATE_TOKEN，无法查询详细状态" });
    }
    
    const url = `${GITLAB_BASE_URL}/api/v4/projects/${encProject(GITLAB_PROJECT)}/pipelines`;
    const r = await axios.get(url, {
      headers: { "PRIVATE-TOKEN": PRIVATE_TOKEN },
      params: { ref: TRIGGER_REF, per_page: 1 },
    });
    
    const latest = r.data && r.data.length ? r.data[0] : null;
    if (!latest) return res.json({ ok: true, pipeline: null });

    // 获取详细状态以获取 web_url
    const detailUrl = `${GITLAB_BASE_URL}/api/v4/projects/${encProject(GITLAB_PROJECT)}/pipelines/${latest.id}`;
    const d = await axios.get(detailUrl, { 
      headers: { "PRIVATE-TOKEN": PRIVATE_TOKEN } 
    });
    
    res.json({ 
      ok: true, 
      pipeline: { 
        id: latest.id, 
        status: d.data.status, 
        ref: d.data.ref 
      }, 
      web_url: d.data.web_url 
    });
  } catch (e) {
    const msg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[Status] Failed:", msg);
    res.status(500).json({ ok: false, error: "查询失败" });
  }
});

app.get("/api/pipelines", async (req, res) => {
  try {
    if (!PRIVATE_TOKEN) {
      return res.json({ ok: false, error: "未配置 PRIVATE_TOKEN，无法查询历史列表" });
    }
    
    const url = `${GITLAB_BASE_URL}/api/v4/projects/${encProject(GITLAB_PROJECT)}/pipelines`;
    const r = await axios.get(url, {
      headers: { "PRIVATE-TOKEN": PRIVATE_TOKEN },
      params: { ref: TRIGGER_REF, per_page: 20 },
    });
    
    res.json({ ok: true, pipelines: r.data });
  } catch (e) {
    const msg = e.response && e.response.data ? JSON.stringify(e.response.data) : e.message;
    console.error("[Pipelines] Failed:", msg);
    res.status(500).json({ ok: false, error: `查询历史失败: ${msg}` });
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`=========================================`);
    console.log(`NexusOps UI running at http://localhost:${port}/`);
    console.log(`=========================================`);
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error(e);
    }
  });
}

startServer(PORT);
