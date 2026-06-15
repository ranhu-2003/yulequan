const http = require("http");
const path = require("path");
const fs = require("fs/promises");

const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const DATA_DIR = path.join(ROOT_DIR, "data");
const CONTACTS_DIR = path.join(DATA_DIR, "contacts");
const PROTAGONIST_PROFILE_DIR = path.join(DATA_DIR, "protagonist", "人物信息");
const PROTAGONIST_PROFILE_FILE = path.join(PROTAGONIST_PROFILE_DIR, "主角.md");
const STATE_FILE = path.join(DATA_DIR, "game_state.json");
const API_FILE = path.join(DATA_DIR, "api_config.json");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".jsx": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
};

function safeSlug(input) {
  const normalized = String(input || "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return normalized || "unnamed";
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureLayout() {
  await fs.mkdir(CONTACTS_DIR, { recursive: true });
  await fs.mkdir(PROTAGONIST_PROFILE_DIR, { recursive: true });
}

async function readJson(filePath, fallback = null) {
  try {
    const text = await fs.readFile(filePath, "utf8");
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function parseMachineData(markdown) {
  const match = markdown.match(/<!-- MACHINE_DATA\s*([\s\S]*?)\s*-->/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function toLineList(items, fallback = "暂无") {
  if (!items || !items.length) return `- ${fallback}`;
  return items.map((item) => `- ${item}`).join("\n");
}

function normalizeNpc(raw, fallbackId) {
  const docId = String(raw?.docId || raw?.id || fallbackId || Date.now());
  return {
    docId,
    id: docId,
    name: (raw?.name || "未命名人物").trim(),
    avatar: raw?.avatar || "🙂",
    bio: raw?.bio || "暂无",
    tags: Array.isArray(raw?.tags) ? raw.tags : [],
    relation: raw?.relation || "刚认识",
    opening: raw?.opening || "你好",
    pending: Boolean(raw?.pending),
    unread: Boolean(raw?.unread),
    chat: Array.isArray(raw?.chat) ? raw.chat : [],
    events: Array.isArray(raw?.events) ? raw.events : [],
    personality: raw?.personality || "",
    createdAt: raw?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function buildNpcMarkdown(raw) {
  const npc = normalizeNpc(raw, raw?.docId);
  const basicInfo = [
    `- 头像：${npc.avatar}`,
    `- 标签：${npc.tags.length ? npc.tags.join("、") : "暂无"}`,
    `- 添加状态：${npc.pending ? "待通过好友申请" : "已保存到通讯录"}`,
    `- 初始消息：${npc.opening || "暂无"}`,
  ].join("\n");
  const personality = npc.personality || (npc.tags.length ? `呈现出 ${npc.tags.join("、")} 的特征。` : "待补充");
  const events = toLineList(npc.events, "暂无");
  const other = npc.bio || "暂无";
  const machineData = JSON.stringify(npc, null, 2);

  return [
    `# 人物档案：${npc.name}`,
    "",
    "## 姓名",
    npc.name,
    "",
    "## 基本信息",
    basicInfo,
    "",
    "## 性格",
    personality,
    "",
    "## 人物关系",
    npc.relation,
    "",
    "## 人物背景基本事件",
    events,
    "",
    "## 其他",
    other,
    "",
    "<!-- MACHINE_DATA",
    machineData,
    "-->",
    "",
  ].join("\n");
}

function buildPlayerMarkdown(state) {
  const player = state.player || {};
  const events = (state.ledger || []).slice(-30).map((entry) => `${entry.ts}：${entry.text}`);
  const machineData = JSON.stringify(
    {
      player,
      latestDay: state.day || 1,
      events: events.slice(-10),
      updatedAt: new Date().toISOString(),
    },
    null,
    2
  );

  return [
    `# 主角档案：${player.name || "未命名主角"}`,
    "",
    "## 姓名",
    player.name || "未命名主角",
    "",
    "## 基本信息",
    `- 性别：${player.gender || "未知"}`,
    `- 头像：${player.avatar || "🧑‍🎤"}`,
    `- 主攻领域：${player.domain || "未知"}`,
    `- 家庭背景：${player.family || "未知"}`,
    "",
    "## 性格",
    `- MBTI：${player.mbti || "未知"}`,
    `- 外形气质：${player.appearance || "未知"}`,
    `- 天赋：${player.talent || "未知"}`,
    "",
    "## 人物关系",
    `- 当前圈内人脉数量：${Array.isArray(state.npcs) ? state.npcs.length : 0}`,
    "",
    "## 人物背景基本事件",
    toLineList(events, "暂无"),
    "",
    "## 其他",
    player.bio || "暂无",
    "",
    `标签：${Array.isArray(player.tags) && player.tags.length ? player.tags.join("、") : "暂无"}`,
    "",
    "<!-- MACHINE_DATA",
    machineData,
    "-->",
    "",
  ].join("\n");
}

async function readContacts() {
  await ensureLayout();
  const entries = await fs.readdir(CONTACTS_DIR, { withFileTypes: true });
  const contacts = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(CONTACTS_DIR, entry.name);
    const text = await fs.readFile(filePath, "utf8");
    const parsed = parseMachineData(text);
    if (!parsed) continue;
    contacts.push(normalizeNpc({ ...parsed, fileName: entry.name }, parsed.docId));
  }

  contacts.sort((a, b) => Number(a.docId) - Number(b.docId));
  return contacts;
}

async function findContactByDocId(docId) {
  const entries = await fs.readdir(CONTACTS_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    if (!entry.name.startsWith(`${docId}-`) && entry.name !== `${docId}.md`) continue;
    return path.join(CONTACTS_DIR, entry.name);
  }
  return null;
}

async function saveContact(raw, docId) {
  await ensureLayout();
  const normalized = normalizeNpc(raw, docId);
  const previousPath = await findContactByDocId(normalized.docId);
  const fileName = `${normalized.docId}-${safeSlug(normalized.name)}.md`;
  const nextPath = path.join(CONTACTS_DIR, fileName);
  const markdown = buildNpcMarkdown(normalized);
  await fs.writeFile(nextPath, markdown, "utf8");
  if (previousPath && previousPath !== nextPath && (await exists(previousPath))) {
    await fs.rm(previousPath, { force: true });
  }
  return { ...normalized, fileName };
}

async function saveState(state) {
  await ensureLayout();
  if (!state) {
    await fs.rm(STATE_FILE, { force: true });
    return;
  }
  const { npcs, ...rest } = state;
  await writeJson(STATE_FILE, rest);
  if (state.player) {
    await fs.writeFile(PROTAGONIST_PROFILE_FILE, buildPlayerMarkdown(state), "utf8");
  }
}

async function resetAll() {
  await fs.rm(STATE_FILE, { force: true });
  await fs.rm(PROTAGONIST_PROFILE_FILE, { force: true });
  await fs.rm(CONTACTS_DIR, { recursive: true, force: true });
  await ensureLayout();
}

async function readRequestJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    return {};
  }
}

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

async function handleApi(req, res, pathname) {
  if (req.method === "GET" && pathname === "/api/bootstrap") {
    const api = await readJson(API_FILE, null);
    const state = await readJson(STATE_FILE, null);
    const contacts = await readContacts();
    const merged = state ? { ...state, npcs: contacts } : null;
    return sendJson(res, 200, { api, state: merged });
  }

  if (req.method === "POST" && pathname === "/api/state") {
    const payload = await readRequestJson(req);
    await saveState(payload.state || null);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/reset") {
    await resetAll();
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/api-config") {
    const payload = await readRequestJson(req);
    await writeJson(API_FILE, payload.api || null);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === "POST" && pathname === "/api/contacts") {
    const payload = await readRequestJson(req);
    const contact = await saveContact(payload.contact || {}, undefined);
    return sendJson(res, 200, { contact });
  }

  if (req.method === "PUT" && pathname.startsWith("/api/contacts/")) {
    const docId = decodeURIComponent(pathname.slice("/api/contacts/".length));
    if (!docId) return sendJson(res, 400, { error: "missing contact id" });
    const payload = await readRequestJson(req);
    const currentPath = await findContactByDocId(docId);
    let current = {};
    if (currentPath) {
      const text = await fs.readFile(currentPath, "utf8");
      current = parseMachineData(text) || {};
    }
    const merged = { ...current, ...(payload.contact || {}), docId, id: docId };
    const contact = await saveContact(merged, docId);
    return sendJson(res, 200, { contact });
  }

  return sendJson(res, 404, { error: "not found" });
}

async function handleStatic(req, res, pathname) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const normalized = path.normalize(requestedPath).replace(/^(\.\.[/\\])+/, "");
  const safeRelative = normalized.replace(/^[/\\]+/, "");
  const filePath = path.join(PUBLIC_DIR, safeRelative || "index.html");
  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || "application/octet-stream";
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
  } catch {
    sendText(res, 404, "Not Found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }
    await handleStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "internal error" });
  }
});

ensureLayout()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`showbiz local server running at http://localhost:${PORT}`);
    });
  })
  .catch((error) => {
    console.error("failed to initialize storage", error);
    process.exit(1);
  });
