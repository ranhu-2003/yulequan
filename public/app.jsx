const { useState, useEffect, useRef } = React;


/* ============================================================
   娱乐圈模拟器 · 真实手机 UI（浅色）
   · 开局可配置 LLM 接口（内置 / OpenAI 兼容 / Anthropic）
   · 关系靠大模型用自然语言模拟，无数值
   · 通讯录支持一键随机生成人物
   ============================================================ */

/* ---------- LLM 接口 ---------- */
let API = { mode: "builtin", key: "", host: "", path: "", model: "" };
function setAPI(c) { API = c; }

async function rawLLM(system, user, override) {
  const A = override || API;
  if (A.mode === "openai") {
    const url = (A.host || "https://api.openai.com").replace(/\/+$/, "") + (A.path || "/v1/chat/completions");
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + (A.key || "") },
      body: JSON.stringify({ model: A.model || "gpt-4o-mini", max_tokens: 1400, messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    });
    if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`接口返回 ${res.status}：${t.slice(0, 200) || res.statusText}`); }
    const data = await res.json();
    const txt = data?.choices?.[0]?.message?.content;
    if (txt == null) throw new Error("接口未返回内容（响应格式异常）");
    return txt;
  }
  // anthropic / builtin
  const url = (A.host || "https://api.anthropic.com").replace(/\/+$/, "") + (A.path || "/v1/messages");
  const headers = { "Content-Type": "application/json" };
  if (A.mode === "anthropic" && A.key) {
    headers["x-api-key"] = A.key;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const res = await fetch(url, {
    method: "POST", headers,
    body: JSON.stringify({ model: A.model || "claude-sonnet-4-6", max_tokens: 1024, system, messages: [{ role: "user", content: user }] }),
  });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`接口返回 ${res.status}：${t.slice(0, 200) || res.statusText}`); }
  const data = await res.json();
  const txt = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n");
  if (!txt) throw new Error("接口未返回内容（响应格式异常）");
  return txt;
}

async function callLLM(system, user) {
  const text = await rawLLM(system, user);
  const clean = text.replace(/```json|```/g, "").trim();
  const s = clean.indexOf("{"), e = clean.lastIndexOf("}");
  if (s < 0 || e < 0) throw new Error("模型未返回有效 JSON，可换一个更强的模型重试");
  return JSON.parse(clean.slice(s, e + 1));
}

/* ---------- storage ---------- */
let bootstrapCache = null;

async function requestJSON(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(message || `请求失败：${response.status}`);
  }
  return response.json();
}

async function bootstrap() {
  if (!bootstrapCache) {
    bootstrapCache = requestJSON("/api/bootstrap").catch((error) => {
      bootstrapCache = null;
      throw error;
    });
  }
  return bootstrapCache;
}

function normalizeContact(out = {}) {
  const fallbackId = String(out.id || out.docId || Date.now());
  return {
    ...out,
    id: fallbackId,
    docId: fallbackId,
    avatar: out.avatar || "🙂",
    tags: Array.isArray(out.tags) ? out.tags : [],
    chat: Array.isArray(out.chat) ? out.chat : [],
    events: Array.isArray(out.events) ? out.events : [],
    identity: out.identity || out.role || "圈内人士",
    relation: out.relation || "刚认识",
  };
}

function sanitizeRelation(raw) {
  const text = String(raw || "").replace(/\s+/g, "").slice(0, 40);
  if (!text) return "初识，保持礼貌沟通";
  if (/(泼|骨相|诅咒|献祭|发癫|中邪|怪谈)/.test(text)) return "有接触，但彼此还在观察";
  return text;
}

function normalizePost(raw = {}) {
  const commentsList = Array.isArray(raw.commentsList) ? raw.commentsList : [];
  return {
    ...raw,
    id: raw.id || Date.now(),
    comments: Number(raw.comments || 0),
    commentsList: commentsList.map((c, idx) => ({
      id: c.id || `${raw.id || Date.now()}-${idx}`,
      user: c.user || "路人",
      text: c.text || "",
      reply: c.reply || "",
      ts: c.ts || raw.ts || "",
    })),
  };
}

function normalizeState(raw) {
  if (!raw) return null;
  return {
    ...raw,
    npcs: (raw.npcs || []).map(normalizeContact),
    weibo: (raw.weibo || []).map(normalizePost),
  };
}

async function load() {
  try {
    const data = await bootstrap();
    if (!data.state) return null;
    return normalizeState(data.state);
  } catch {
    return null;
  }
}

async function save(state) {
  try {
    await requestJSON("/api/state", { method: "POST", body: JSON.stringify({ state }) });
  } catch (error) {
    console.warn("保存失败", error);
  }
}

async function loadApi() {
  try {
    const data = await bootstrap();
    return data.api || null;
  } catch {
    return null;
  }
}

async function saveApi(api) {
  await requestJSON("/api/api-config", { method: "POST", body: JSON.stringify({ api }) });
  bootstrapCache = null;
}

async function resetStorage() {
  await requestJSON("/api/reset", { method: "POST", body: JSON.stringify({}) });
  bootstrapCache = null;
}

async function createContact(contact) {
  const data = await requestJSON("/api/contacts", { method: "POST", body: JSON.stringify({ contact }) });
  bootstrapCache = null;
  return normalizeContact(data.contact || contact);
}

async function updateContact(contact) {
  const docId = encodeURIComponent(String(contact.docId || contact.id));
  const data = await requestJSON(`/api/contacts/${docId}`, { method: "PUT", body: JSON.stringify({ contact }) });
  bootstrapCache = null;
  return normalizeContact(data.contact || contact);
}

const todayLabel = (day) => {
  const d = new Date(2026, 5, 1 + (day - 1));
  return `2026.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`;
};

/* ---------- options ---------- */
const AVATARS = ["🧑‍🎤","👩‍🎤","🦸","🧛","🧚","💂","🤵","👰","🧑‍🍳","🕵️","👨‍🎨","👩‍🎨","🦹","🧞","🧙","👨‍🚀","🧑‍💼","💃"];
const MBTIS = ["INTJ","INTP","ENTJ","ENTP","INFJ","INFP","ENFJ","ENFP","ISTJ","ISFJ","ESTJ","ESFJ","ISTP","ISFP","ESTP","ESFP"];
const APPEAR = ["清冷禁欲","氧气甜美","浓颜大气","钝感少年","病娇美人","英气飒爽","书卷温润","野性性感"];
const TALENTS = ["唱跳俱佳","演技派","综艺感强","台词功底","商业头脑","颜值天花板","学霸人设","舞蹈天赋","乐器全能"];
const DOMAINS = ["演员","流量偶像","唱作歌手","选秀爱豆","综艺咖","导演","编剧","网红博主","模特"];
const FAMILY = ["素人出身","星二代","富商家庭","艺术世家","草根逆袭","落魄豪门","体制内家庭","海外归侨"];
const GENDERS = ["女","男","非二元"];

const INTERVENTIONS = ["同组演员带资进组要求加戏","品牌方临时撤换代言人","对家粉丝控评带节奏","狗仔蹲守拍到深夜行程","投资方资金链断裂项目停摆","前合作方爆料合同纠纷","新人空降抢占资源位","平台算法限流话题被压","金主要求出席私人饭局","老剧翻红带来意外热度","队友/同事私下立场不一致","品牌方临时压缩预算"];
const SCHEDULES = ["进组拍戏第一天","品牌活动红毯","直播带货","综艺录制","剧本围读会","专辑打歌行程","粉丝见面会","商务洽谈午餐","杂志封面拍摄","颁奖典礼候场"];

const NPC_ROLES = ["金牌经纪人","当红对家艺人","新锐导演","毒舌编剧","神秘投资金主","同公司师妹/师弟","选秀同期对手","八卦狗仔","头部粉头","综艺制片人","时尚造型师","过气老前辈","品牌方负责人","影视圈大佬","当红流量","话题营销号老板"];
const NPC_STANCE = ["想拉拢你为己所用","暗中视你为眼中钉","对你颇为欣赏","对你有所图谋","急于和你绑定利益","单纯看你不顺眼","对你态度暧昧不明","想借你上位","与你有旧怨未了","把你当潜力股投资"];
const NPC_VIBE = ["八面玲珑","阴晴不定","表面温和实则算计","直来直去口无遮拦","笑里藏刀","清高孤傲","世故老练","天真却危险","强势霸道","深藏不露"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

const OAI_PRESETS = [
  { label: "OpenAI", host: "https://api.openai.com", model: "gpt-4o-mini" },
  { label: "DeepSeek", host: "https://api.deepseek.com", model: "deepseek-chat" },
  { label: "Kimi", host: "https://api.moonshot.cn", model: "moonshot-v1-8k" },
  { label: "通义千问", host: "https://dashscope.aliyuncs.com/compatible-mode", model: "qwen-plus" },
  { label: "OpenRouter", host: "https://openrouter.ai/api", model: "openai/gpt-4o-mini" },
];

/* ============================================================ */
function App() {
  const [loaded, setLoaded] = useState(false);
  const [api, setApi] = useState(null);
  const [editingApi, setEditingApi] = useState(false);
  const [state, setState] = useState(null);
  const [screen, setScreen] = useState("home");
  const [active, setActive] = useState(null);
  const [toast, setToast] = useState("");
  const skip = useRef(true);

  useEffect(() => {
    Promise.all([loadApi(), load()]).then(([a, s]) => {
      if (a) { setApi(a); setAPI(a); }
      if (s) setState(s);
      setLoaded(true);
    });
  }, []);
  useEffect(() => { if (skip.current) { skip.current = false; return; } if (state) save(state); }, [state]);

  const flash = (m) => { setToast(m); setTimeout(() => setToast(""), 3200); };
  if (!loaded) return <Frame><div className="center-load"><div className="spin" /></div></Frame>;

  if (!api || editingApi) return (
    <Frame><ApiSetup initial={api} canCancel={!!api}
      onCancel={() => setEditingApi(false)}
      onDone={(c) => { setApi(c); setAPI(c); saveApi(c); setEditingApi(false); }} /></Frame>
  );

  if (!state) return <Frame><Create onDone={(s) => { setState(normalizeState(s)); setScreen("home"); }} onEditApi={() => setEditingApi(true)} /></Frame>;

  const unread = state.npcs.filter(n => n.unread).length;
  const pending = state.npcs.filter(n => n.pending).length;
  const back = () => { setScreen("home"); setActive(null); };
  const ctx = { state, setState, flash, active, setActive, setScreen, back, openApiSetup: () => setEditingApi(true) };

  return (
    <Frame light={screen === "home"}>
      {screen === "home" && <Home state={state} go={setScreen} badges={{ wechat: unread + pending, contacts: pending }} />}
      {screen === "wechat" && <WeChat {...ctx} />}
      {screen === "weibo" && <Weibo {...ctx} />}
      {screen === "contacts" && <Contacts {...ctx} />}
      {screen === "schedule" && <Schedule {...ctx} />}
      {screen === "profile" && <Profile {...ctx} />}
      {screen === "bank" && <Bank {...ctx} />}
      {["dingtalk", "phone", "taobao"].includes(screen) &&
        <Soon title={{ dingtalk: "钉钉", phone: "电话", taobao: "淘宝" }[screen]} back={back} />}
      {toast && <div className="toast">{toast}</div>}
    </Frame>
  );
}

function Frame({ children }) {
  return (
    <div className="sb-root">
      <div className="phone">
        <div className="notch" />
        <div className="statusbar"><span>11:38</span><span className="bat">100<span className="bat-i"><i /></span></span></div>
        <div className="screen">{children}</div>
      </div>
    </div>
  );
}

/* ============================================================ API SETUP */
function ApiSetup({ initial, onDone, onCancel, canCancel }) {
  const [cfg, setCfg] = useState(initial || { mode: "builtin", key: "", host: "", path: "", model: "" });
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState(null);
  const set = (k, v) => setCfg(p => ({ ...p, [k]: v }));

  function switchMode(m) {
    if (m === "builtin") setCfg({ mode: "builtin", key: "", host: "", path: "", model: "" });
    else if (m === "openai") setCfg(p => ({ mode: "openai", key: p.key || "", host: p.host || "https://api.openai.com", path: p.path || "", model: p.model || "gpt-4o-mini" }));
    else setCfg(p => ({ mode: "anthropic", key: p.key || "", host: "https://api.anthropic.com", path: "", model: "claude-sonnet-4-6" }));
    setResult(null);
  }

  async function test() {
    setTesting(true); setResult(null);
    try {
      const t = await rawLLM("你是连接测试助手。", "只回复两个字：成功", cfg);
      setResult({ ok: true, msg: "连接成功 ✓　模型回复：" + t.trim().slice(0, 40) });
    } catch (e) { setResult({ ok: false, msg: e.message }); }
    setTesting(false);
  }

  return (
    <div className="pad">
      <h2 style={{ fontSize: 24, fontWeight: 700 }}>配置 AI 接口</h2>
      <p className="muted" style={{ marginTop: 4 }}>所有人物对话与事件都由这个接口驱动。</p>

      <label className="label">接口模式</label>
      <div className="seg">
        {[["builtin", "内置 Claude"], ["openai", "OpenAI 兼容"], ["anthropic", "Anthropic"]].map(([m, l]) =>
          <div key={m} className={"seg-i" + (cfg.mode === m ? " on" : "")} onClick={() => switchMode(m)}>{l}</div>)}
      </div>

      {cfg.mode === "builtin" && (
        <div className="note" style={{ marginTop: 14 }}>
          免配置，直接可用 —— <b>仅在 Claude 官方 App / 网页内有效</b>。如果你在外部环境打开、或一直「生成失败」，请改用「OpenAI 兼容」填入自己的密钥。
        </div>
      )}

      {cfg.mode === "openai" && (
        <>
          <label className="label">快捷预设</label>
          <div className="chips">
            {OAI_PRESETS.map(p => <div key={p.label} className="chip sm" onClick={() => setCfg(c => ({ ...c, host: p.host, model: p.model, path: p.path || "" }))}>{p.label}</div>)}
          </div>
          <label className="label">API 密钥</label>
          <input className="input" type="password" value={cfg.key} placeholder="sk-..." onChange={e => set("key", e.target.value)} />
          <label className="label">API 主机</label>
          <input className="input" value={cfg.host} placeholder="https://api.openai.com" onChange={e => set("host", e.target.value)} />
          <label className="label">API 路径（选填）</label>
          <input className="input" value={cfg.path} placeholder="/v1/chat/completions" onChange={e => set("path", e.target.value)} />
          <label className="label">模型</label>
          <input className="input" value={cfg.model} placeholder="gpt-4o-mini" onChange={e => set("model", e.target.value)} />
        </>
      )}

      {cfg.mode === "anthropic" && (
        <>
          <label className="label">API 密钥</label>
          <input className="input" type="password" value={cfg.key} placeholder="sk-ant-..." onChange={e => set("key", e.target.value)} />
          <label className="label">API 主机</label>
          <input className="input" value={cfg.host} placeholder="https://api.anthropic.com" onChange={e => set("host", e.target.value)} />
          <label className="label">API 路径（选填）</label>
          <input className="input" value={cfg.path} placeholder="/v1/messages" onChange={e => set("path", e.target.value)} />
          <label className="label">模型</label>
          <input className="input" value={cfg.model} placeholder="claude-sonnet-4-6" onChange={e => set("model", e.target.value)} />
        </>
      )}

      {result && <div className={"result " + (result.ok ? "ok" : "bad")}>{result.msg}</div>}

      <button className="btn btn-ghost" style={{ marginTop: 16 }} onClick={test} disabled={testing}>{testing ? "测试中…" : "测试连接"}</button>
      <button className="btn" style={{ marginTop: 10 }} onClick={() => onDone(cfg)}>保存并继续</button>
      {canCancel && <button className="btn btn-red" style={{ marginTop: 10 }} onClick={onCancel}>取消</button>}
      <p className="muted" style={{ marginTop: 12, textAlign: "center" }}>提示：浏览器直连部分服务商可能受 CORS 限制，建议用支持跨域的服务商或自建代理。</p>
    </div>
  );
}

/* ============================================================ HOME */
function Home({ state, go, badges }) {
  const apps = [
    { id: "weibo", n: "微博", e: "🅦", c: "linear-gradient(135deg,#ff9a3c,#ff5e3a)" },
    { id: "wechat", n: "微信", e: "💬", c: "linear-gradient(135deg,#4be07a,#07c160)", b: badges.wechat },
    { id: "dingtalk", n: "钉钉", e: "📌", c: "linear-gradient(135deg,#39adff,#1677ff)" },
    { id: "phone", n: "电话", e: "📞", c: "linear-gradient(135deg,#5be36a,#34c759)" },
    { id: "bank", n: "银行卡", e: "💳", c: "linear-gradient(135deg,#ff6b6b,#e64340)" },
    { id: "taobao", n: "淘宝", e: "🛍️", c: "linear-gradient(135deg,#ff8a3c,#ff5000)" },
    { id: "contacts", n: "通讯录", e: "👥", c: "linear-gradient(135deg,#bfc4cc,#8a8f99)", b: badges.contacts },
    { id: "schedule", n: "日程表", e: "📅", c: "linear-gradient(135deg,#ff5e7a,#e0245e)" },
    { id: "profile", n: "个人信息", e: "🎭", c: "linear-gradient(135deg,#bb8af0,#7c3aed)" },
  ];
  return (
    <div className="home">
      <div className="home-hd"><div className="home-time">11:38</div><div className="home-date">{todayLabel(state.day)} · 出道第 {state.day} 天</div></div>
      <div className="appgrid">{apps.map(a => (
        <div className="app" key={a.id} onClick={() => go(a.id)}>
          <div className="icon" style={{ background: a.c }}>{a.e}</div>
          {a.b ? <div className="badge">{a.b}</div> : null}<span>{a.n}</span>
        </div>))}</div>
    </div>
  );
}

/* ============================================================ CREATE */
function Create({ onDone, onEditApi }) {
  const [f, setF] = useState({ name: "", gender: "女", avatar: "🧑‍🎤", mbti: "INFP", appearance: "清冷禁欲", talent: "演技派", domain: "演员", family: "素人出身", custom: "" });
  const [bio, setBio] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  async function generate() {
    if (!f.name.trim()) { setErr("先给 Ta 起个名字"); return; }
    setBusy(true); setErr("");
    try {
      const out = await callLLM(
        "你是中文娱乐圈人生模拟器的设定作者。根据玩家设定写一篇约160-240字的中文人物小传，第三人称，文风像业内艺人资料，有质感、有命运感、留有钩子。再提炼4-6个核心标签。只返回JSON：{\"bio\":\"...\",\"tags\":[\"...\"]}",
        `姓名:${f.name}\n性别:${f.gender}\nMBTI:${f.mbti}\n外形:${f.appearance}\n天赋:${f.talent}\n领域:${f.domain}\n家庭背景:${f.family}\n补充:${f.custom || "无"}`
      );
      setBio(out);
    } catch (e) { setErr(e.message || "生成失败"); }
    setBusy(false);
  }

  function start() {
    onDone({
      player: { ...f, bio: bio.bio, tags: bio.tags }, npcs: [],
      ledger: [{ ts: todayLabel(1), text: `${f.name} 正式出道，进入娱乐圈。` }],
      laws: { 资本干预: "强势主导", 舆论: "一点就炸", 道德容忍: "对劣迹近乎零容忍" },
      weibo: [normalizePost({
        id: 1,
        author: f.name + " 工作室",
        avatar: f.avatar,
        v: true,
        text: `#${f.name}出道# 全新旅程，请多指教。`,
        ts: todayLabel(1),
        likes: 1280,
        comments: 2,
        commentsList: [
          { user: "官方后援会", text: "欢迎新旅程！", ts: todayLabel(1) },
          { user: "娱乐观察员", text: "期待后续作品。", ts: todayLabel(1) },
        ],
      })],
      hotsearch: [{ rank: 1, title: `#${f.name}出道#`, heat: "新", real: true }],
      day: 1, balance: 50000, tx: [{ t: "签约定金", v: 50000, ts: todayLabel(1) }],
    });
  }

  if (busy) return <div className="center-load"><div className="spin" /><div>正在撰写人物小传…</div></div>;

  if (bio) return (
    <div className="pad">
      <div className="profile-card">
        <div style={{ fontSize: 22, fontWeight: 700 }}>{f.name}</div>
        <div className="muted" style={{ margin: "2px 0 14px" }}>{f.domain} · {f.mbti} · {f.appearance}</div>
        <div style={{ fontSize: 15, lineHeight: 1.85, color: "#2b2b30" }}>{bio.bio}</div>
        <div style={{ marginTop: 12 }}>{bio.tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
        <button className="btn btn-ghost" onClick={() => setBio(null)}>重新调整</button>
        <button className="btn" onClick={start}>保存并进入</button>
      </div>
    </div>
  );

  return (
    <div className="pad">
      <h2 style={{ fontSize: 24, fontWeight: 700 }}>建立艺人档案</h2>
      <p className="muted" style={{ marginTop: 4 }}>这份设定会成为之后所有事件、对话、社会关系生成的依据。</p>
      <label className="label">艺名</label>
      <input className="input" value={f.name} placeholder="输入艺名" onChange={e => set("name", e.target.value)} />
      <label className="label">性别</label>
      <div className="chips">{GENDERS.map(g => <div key={g} className={"chip" + (f.gender === g ? " on" : "")} onClick={() => set("gender", g)}>{g}</div>)}</div>
      <label className="label">头像</label>
      <div className="emoji-grid">{AVATARS.map(a => <div key={a} className={"emoji-o" + (f.avatar === a ? " on" : "")} onClick={() => set("avatar", a)}>{a}</div>)}</div>
      <label className="label">MBTI 性格</label>
      <div className="mbti-grid">{MBTIS.map(m => <div key={m} className={"mbti" + (f.mbti === m ? " on" : "")} onClick={() => set("mbti", m)}>{m}</div>)}</div>
      <label className="label">外形气质</label>
      <div className="chips">{APPEAR.map(a => <div key={a} className={"chip" + (f.appearance === a ? " on" : "")} onClick={() => set("appearance", a)}>{a}</div>)}</div>
      <label className="label">天赋</label>
      <div className="chips">{TALENTS.map(a => <div key={a} className={"chip" + (f.talent === a ? " on" : "")} onClick={() => set("talent", a)}>{a}</div>)}</div>
      <label className="label">主攻领域</label>
      <div className="chips">{DOMAINS.map(a => <div key={a} className={"chip" + (f.domain === a ? " on" : "")} onClick={() => set("domain", a)}>{a}</div>)}</div>
      <label className="label">家庭背景</label>
      <div className="chips">{FAMILY.map(a => <div key={a} className={"chip" + (f.family === a ? " on" : "")} onClick={() => set("family", a)}>{a}</div>)}</div>
      <label className="label">补充设定（自由发挥）</label>
      <textarea className="area" rows={3} value={f.custom} placeholder="例如：曾因一场塌房消失两年，如今带着金主资源强势复出…" onChange={e => set("custom", e.target.value)} />
      {err && <div className="result bad" style={{ marginTop: 12 }}>{err}<br /><span onClick={onEditApi} style={{ textDecoration: "underline", cursor: "pointer" }}>检查 AI 接口设置 ›</span></div>}
      <button className="btn" style={{ marginTop: 22 }} onClick={generate}>生成人物小传</button>
    </div>
  );
}

/* ============================================================ WECHAT */
function WeChat({ state, setState, back, active, setActive, flash }) {
  if (active) {
    const npc = state.npcs.find(n => n.id === active);
    if (!npc) { setActive(null); return null; }
    return <ChatView npc={npc} state={state} setState={setState} onBack={() => setActive(null)} flash={flash} />;
  }

  const accept = (id) => {
    const target = state.npcs.find(n => n.id === id);
    setState(p => ({ ...p, npcs: p.npcs.map(n => n.id === id ? { ...n, pending: false } : n) }));
    if (target) updateContact({ ...target, pending: false }).catch(() => {});
  };

  const openChat = (id) => {
    const target = state.npcs.find(n => n.id === id);
    setState(p => ({ ...p, npcs: p.npcs.map(x => x.id === id ? { ...x, unread: false } : x) }));
    if (target) updateContact({ ...target, unread: false }).catch(() => {});
    setActive(id);
  };

  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>微信</h2><span className="nav-act dim"> </span></div>
      {state.npcs.length === 0 && <div className="empty">还没有联系人。<br />去「通讯录」添加，或等待主动加你的人。</div>}
      <div className="group" style={{ borderRadius: 0, boxShadow: "none" }}>
        {state.npcs.map(n => (
          <div className="row" key={n.id} onClick={() => n.pending ? null : openChat(n.id)}>
            <div className="av">{n.avatar}</div>
            <div className="row-main"><div className="row-name">{n.name}{n.pending && <span className="pill">好友申请</span>}</div>
              <div className="row-sub">{n.pending ? n.opening : (n.chat?.slice(-1)[0]?.text || "打个招呼吧")}</div></div>
            {n.pending ? <button className="send" style={{ height: 32, padding: "0 12px", fontSize: 13 }} onClick={(e) => { e.stopPropagation(); accept(n.id); }}>接受</button>
              : n.unread ? <div className="dot" /> : null}
          </div>))}
      </div>
    </>
  );
}

function ChatView({ npc, state, setState, onBack, flash }) {
  const [txt, setTxt] = useState("");
  const [busy, setBusy] = useState(false);
  const bodyRef = useRef();
  useEffect(() => { bodyRef.current?.scrollTo(0, 9e9); }, [npc.chat, busy]);

  async function send() {
    const message = txt.trim();
    if (!message || busy) return;
    setTxt("");
    const withMe = [...(npc.chat || []), { from: "me", text: message }];
    setState(p => ({ ...p, npcs: p.npcs.map(n => n.id === npc.id ? { ...n, chat: [...(n.chat || []), { from: "me", text: message }] } : n) }));
    setBusy(true);
    try {
      const recentChat = withMe.slice(-8).map(m => `${m.from === "me" ? state.player.name : npc.name}: ${m.text}`).join("\n");
      const recentLedger = state.ledger.slice(-6).map(l => `[${l.ts}] ${l.text}`).join("\n");
      const out = await callLLM(
        `你在中文娱乐圈模拟器里扮演NPC「${npc.name}」。严格依据其人设、标签和与玩家的当前关系说话，语气自然口语化，像真实微信聊天（通常1-3句，可带语气词，可多条短句用换行分隔）。\n关系完全用自然语言理解，不要数字：据小传、标签、当前关系和聊天历史判断此刻该亲近、客套、试探还是疏远；利益捆绑深的即使私下不和也会表面合作；手里有你把柄的会有恃无恐。\n回复后更新一句话「当前关系」（概括此刻真实关系动态，30字内）。若发生重要选择/冲突/交易/承诺则写一条记忆账本摘要，否则memory为null。\n只返回JSON：{"reply":"...","relation":"...","memory":null}`,
        `【玩家】${state.player.name}（${state.player.domain}）小传：${state.player.bio}\n标签：${state.player.tags.join("、")}\n\n【NPC ${npc.name}】身份：${npc.identity || "圈内人士"}\n小传：${npc.bio}\n标签：${(npc.tags || []).join("、")}\n当前关系：${npc.relation || "刚认识"}\n\n【近期聊天】\n${recentChat || "（无）"}\n\n【近期事件记忆】\n${recentLedger}\n\n【${state.player.name}刚发来】${message}`
      );
      const memoryEvent = out.memory ? `${todayLabel(state.day)}：${out.memory}` : null;
      const updatedNpc = normalizeContact({
        ...npc,
        chat: [...withMe, { from: "npc", text: out.reply }],
        relation: sanitizeRelation(out.relation || npc.relation),
        events: memoryEvent ? [...(npc.events || []), memoryEvent] : (npc.events || []),
      });
      setState(p => {
        const npcs = p.npcs.map(n => n.id !== npc.id ? n : updatedNpc);
        const ledger = out.memory ? [...p.ledger, { ts: todayLabel(p.day), text: out.memory }] : p.ledger;
        return { ...p, npcs, ledger };
      });
      updateContact(updatedNpc).catch(() => {});
      if (out.memory) flash("📒 已记入记忆账本");
    } catch (e) {
      const fallbackNpc = normalizeContact({ ...npc, chat: [...withMe, { from: "sys", text: "发送失败：" + e.message }] });
      setState(p => ({ ...p, npcs: p.npcs.map(n => n.id === npc.id ? fallbackNpc : n) }));
      updateContact(fallbackNpc).catch(() => {});
    }
    setBusy(false);
  }

  return (
    <div className="chat-wrap">
      <div className="nav" style={{ background: "rgba(237,237,237,.9)" }}><span className="back" onClick={onBack}>‹</span><h2 style={{ fontSize: 16 }}>{npc.name}</h2><span className="nav-act dim">···</span></div>
      <div className="chat-body" ref={bodyRef}>
        <div className="msg-sys">{npc.bio?.slice(0, 38)}…</div>
        {(npc.chat || []).map((m, i) => m.from === "sys"
          ? <div className="msg-sys" key={i}>{m.text}</div>
          : <div className={"msg-line " + m.from} key={i}><div className="msg-av">{m.from === "me" ? state.player.avatar : npc.avatar}</div><div className={"bubble " + m.from}>{m.text}</div></div>)}
        {busy && <div className="msg-line npc"><div className="msg-av">{npc.avatar}</div><div className="bubble">正在输入…</div></div>}
      </div>
      <div className="chat-in"><input value={txt} placeholder="发消息" onChange={e => setTxt(e.target.value)} onKeyDown={e => e.key === "Enter" && send()} /><button className="send" onClick={send} disabled={busy}>发送</button></div>
    </div>
  );
}

/* ============================================================ WEIBO */
function Weibo({ state, setState, back, flash }) {
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState("发现");
  const [composing, setComposing] = useState("");
  const [openCommentsId, setOpenCommentsId] = useState(null);
  const [commentInput, setCommentInput] = useState({});

  function commentCount(post) {
    const list = Array.isArray(post.commentsList) ? post.commentsList : [];
    return Math.max(Number(post.comments || 0), list.length);
  }

  function buildSeedComments(seedComments) {
    if (!Array.isArray(seedComments)) return [];
    return seedComments.slice(0, 4).map((item, idx) => ({
      id: `${Date.now()}-${idx}`,
      user: item.user || `吃瓜网友${idx + 1}`,
      text: item.text || "",
      reply: "",
      ts: todayLabel(state.day),
    })).filter((c) => c.text.trim());
  }

  function hasIdentityConflict(npc, text) {
    const identity = npc?.identity || "";
    const merged = String(text || "");
    if (/粉丝|后援会/.test(identity) && /(抢戏|加戏|拿女主|拿男主|进组拍戏|抢角色)/.test(merged)) return true;
    if (/营销号|狗仔/.test(identity) && /(主演|导演选角|进组定妆)/.test(merged)) return true;
    return false;
  }

  async function triggerEvent() {
    setBusy(true);
    try {
      const sched = pick(SCHEDULES);
      const intv = pick(INTERVENTIONS);
      const mem = state.ledger.slice(-6).map(l => `[${l.ts}] ${l.text}`).join("\n");
      const npcProfiles = state.npcs.length
        ? state.npcs.map(n => `- ${n.name}｜身份:${n.identity || "圈内人士"}｜关系:${n.relation || "未知"}`).join("\n")
        : "（暂无可用NPC）";
      const worldMode = Math.random() < 0.45;
      const sys = worldMode
        ? `你是娱乐圈模拟器的微博事件引擎。请生成与玩家不直接相关的“行业/社会/国家/其他明星”类虚构新闻，保证像真实热搜。语气自然，信息具体。\n只返回JSON：{"scope":"industry或society","hotSearch":"#带#号的热搜标题#","weiboPost":"一条相关微博正文","author":"发布账号名","fromNpc":null,"wechatMsg":null,"ledger":null,"balanceDelta":0,"seedComments":[{"user":"评论者","text":"评论内容"}]}`
        : `你是娱乐圈模拟器的微博事件引擎。请围绕玩家生成一个现实、克制、行业逻辑成立的娱乐圈事件。若牵涉已有NPC，必须严格符合其身份边界（例如粉丝不能突然变成抢戏演员）。\n只返回JSON：{"scope":"player","hotSearch":"#带#号的热搜标题#","weiboPost":"一条相关微博正文","author":"发布账号名","fromNpc":"已存在的NPC名或null","wechatMsg":"该NPC发来的微信或null","ledger":"记忆账本一句话摘要或null","balanceDelta":0,"seedComments":[{"user":"评论者","text":"评论内容"}]}`;
      const out = await callLLM(
        sys,
        `【玩家】${state.player.name}（${state.player.domain}）标签:${state.player.tags.join("、")}\n【当前日程】${sched}\n【随机干预变量】${intv}\n【社会法则】资本干预:${state.laws.资本干预}；舆论:${state.laws.舆论}；道德容忍:${state.laws.道德容忍}\n【可用NPC及身份】\n${npcProfiles}\n【记忆检索】\n${mem}`
      );

      const seedComments = buildSeedComments(out.seedComments);
      const eventLine = out.ledger ? `${todayLabel(state.day)}：${out.ledger}` : null;
      let targetNpc = out.fromNpc && out.wechatMsg ? state.npcs.find(n => n.name === out.fromNpc) : null;
      if (targetNpc && hasIdentityConflict(targetNpc, `${out.wechatMsg || ""}\n${out.weiboPost || ""}`)) targetNpc = null;
      const syncedTarget = targetNpc ? normalizeContact({
        ...targetNpc,
        unread: true,
        chat: [...(targetNpc.chat || []), { from: "npc", text: out.wechatMsg }],
        events: eventLine ? [...(targetNpc.events || []), eventLine] : (targetNpc.events || []),
      }) : null;

      setState(p => {
        const scope = out.scope === "player" ? "player" : (out.scope === "industry" ? "industry" : "society");
        const newPost = normalizePost({
          id: Date.now(),
          author: out.author || (scope === "player" ? "娱乐圈那点事" : "社会新闻速递"),
          avatar: scope === "player" ? "📰" : (scope === "industry" ? "🎬" : "🛰️"),
          v: false,
          text: out.weiboPost,
          ts: todayLabel(p.day),
          likes: Math.floor(Math.random() * 90000),
          comments: Math.max(Math.floor(Math.random() * 9000), seedComments.length),
          commentsList: seedComments,
        });
        const hot = [{ rank: 1, title: out.hotSearch, heat: "爆", real: true }, ...p.hotsearch.map((h, i) => ({ ...h, rank: i + 2 }))].slice(0, 8);
        let npcs = p.npcs;
        if (syncedTarget) npcs = p.npcs.map(n => n.id === syncedTarget.id ? syncedTarget : n);
        return {
          ...p,
          weibo: [newPost, ...p.weibo],
          hotsearch: hot,
          npcs,
          ledger: out.ledger ? [...p.ledger, { ts: todayLabel(p.day), text: out.ledger }] : p.ledger,
          balance: p.balance + (out.balanceDelta || 0),
          tx: out.balanceDelta ? [{ t: "事件影响", v: out.balanceDelta, ts: todayLabel(p.day) }, ...p.tx] : p.tx,
        };
      });
      if (syncedTarget) updateContact(syncedTarget).catch(() => {});
      flash("🔥 新热搜：" + out.hotSearch);
    } catch (e) { flash("事件生成失败：" + e.message); }
    setBusy(false);
  }

  function post() {
    if (!composing.trim()) return;
    setState(p => ({
      ...p,
      weibo: [normalizePost({
        id: Date.now(),
        author: p.player.name,
        avatar: p.player.avatar,
        v: true,
        text: composing,
        ts: todayLabel(p.day),
        likes: 0,
        comments: 0,
        commentsList: [],
      }), ...p.weibo],
    }));
    setComposing("");
    flash("已发布");
  }

  function addComment(postId) {
    const text = (commentInput[postId] || "").trim();
    if (!text) return;
    const nextComment = {
      id: `${postId}-${Date.now()}`,
      user: state.player.name,
      text,
      reply: "",
      ts: todayLabel(state.day),
    };
    setState(p => ({
      ...p,
      weibo: p.weibo.map(post => {
        if (post.id !== postId) return post;
        const nextList = [...(post.commentsList || []), nextComment];
        return { ...post, commentsList: nextList, comments: Math.max(post.comments || 0, nextList.length) };
      }),
    }));
    setCommentInput(prev => ({ ...prev, [postId]: "" }));
    setOpenCommentsId(postId);
    flash("评论成功");
  }

  function flipComment(postId, commentId) {
    setState(p => ({
      ...p,
      weibo: p.weibo.map(post => {
        if (post.id !== postId) return post;
        return {
          ...post,
          commentsList: (post.commentsList || []).map(comment => {
            if (comment.id !== commentId || comment.reply) return comment;
            return { ...comment, reply: `${state.player.name}：收到，感谢支持。` };
          }),
        };
      }),
    }));
    flash("已翻牌");
  }

  return (
    <>
      <div className="nav" style={{ background: "rgba(255,255,255,.92)" }}><span className="back" onClick={back}>‹ 主屏</span><h2>微博</h2><span className="nav-act" style={{ color: "var(--weibo)" }} onClick={triggerEvent}>{busy ? "…" : "触发事件"}</span></div>
      <div className="wb-tabs">{["发现", "热搜"].map(t => <div key={t} className={"wb-tab" + (tab === t ? " on" : "")} onClick={() => setTab(t)}>{t}</div>)}</div>
      {tab === "发现" && <>
        <div className="pad" style={{ background: "#fff", paddingBottom: 12, borderBottom: "8px solid #f2f2f7" }}>
          <textarea className="area" style={{ background: "#f6f6f8" }} rows={2} placeholder="分享新鲜事…" value={composing} onChange={e => setComposing(e.target.value)} />
          <button className="btn" style={{ marginTop: 9, background: "var(--weibo)" }} onClick={post}>发布</button>
        </div>
        {state.weibo.map(rawPost => {
          const p = normalizePost(rawPost);
          const expanded = openCommentsId === p.id;
          return (
          <div className="post" key={p.id}>
            <div className="post-hd"><div className="av" style={{ width: 40, height: 40, borderRadius: 20, fontSize: 21 }}>{p.avatar}</div><div><div className={"post-name" + (p.v ? " v" : "")}>{p.author}{p.v && " ✔"}</div><div className="muted" style={{ fontSize: 11 }}>{p.ts}</div></div></div>
            <div className="post-txt">{p.text}</div>
            <div className="post-foot">
              <span>↗ 转发</span>
              <span style={{ cursor: "pointer" }} onClick={() => setOpenCommentsId(expanded ? null : p.id)}>💬 {commentCount(p).toLocaleString()}</span>
              <span>♡ {p.likes.toLocaleString()}</span>
            </div>
            {expanded && (
              <div className="comment-panel">
                <div className="comment-input">
                  <input
                    value={commentInput[p.id] || ""}
                    placeholder="写评论…"
                    onChange={(e) => setCommentInput(prev => ({ ...prev, [p.id]: e.target.value }))}
                    onKeyDown={(e) => e.key === "Enter" && addComment(p.id)}
                  />
                  <button onClick={() => addComment(p.id)}>发送</button>
                </div>
                {p.commentsList.length === 0 && <div className="muted" style={{ fontSize: 12 }}>暂无评论，来抢首评。</div>}
                {p.commentsList.map(comment => (
                  <div className="comment-item" key={comment.id}>
                    <div style={{ flex: 1 }}>
                      <div className="comment-user">{comment.user}</div>
                      <div className="comment-text">{comment.text}</div>
                      {comment.reply && <div className="comment-reply">{comment.reply}</div>}
                    </div>
                    {!comment.reply && <button className="comment-flip" onClick={() => flipComment(p.id, comment.id)}>翻牌</button>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )})}
      </>}
      {tab === "热搜" && <div className="group" style={{ borderRadius: 0, boxShadow: "none" }}>
        {state.hotsearch.map(h => (<div className="hot" key={h.rank} onClick={triggerEvent}><span className={"hot-rank" + (h.rank <= 3 ? " top" : "")}>{h.rank}</span><span style={{ flex: 1, fontSize: 15 }}>{h.title}</span>{h.heat && <span className={"hot-fire" + (h.heat === "新" ? " new" : "")}>{h.heat}</span>}</div>))}
        <div className="muted" style={{ padding: "14px 16px", textAlign: "center" }}>点任意热搜可触发新事件</div>
      </div>}
    </>
  );
}

/* ============================================================ CONTACTS */
function Contacts({ state, setState, back, setActive, setScreen, flash }) {
  const [adding, setAdding] = useState(false);
  const [desc, setDesc] = useState("");
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);

  function toDraft(out) {
    return normalizeContact({
      ...out,
      relation: sanitizeRelation(out.relation),
      pending: false,
      unread: false,
      chat: [],
      events: [`${todayLabel(state.day)}：创建联系人档案`],
    });
  }

  async function saveDraft() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      const saved = await createContact(draft);
      setState(p => ({ ...p, npcs: [...p.npcs, saved] }));
      flash("已保存 " + saved.name);
      setAdding(false);
      setDraft(null);
      setDesc("");
    } catch (e) {
      flash("保存失败：" + e.message);
    }
    setBusy(false);
  }

  async function addByDesc() {
    if (!desc.trim() || busy) return;
    setBusy(true);
    try {
      const out = await callLLM(
        `你是现实向娱乐圈模拟器的人物编辑。根据用户描述生成一个逻辑自洽、身份明确、行为克制的联系人。\n要求：\n1) 身份必须稳定且现实，不能出现离谱戏剧化表达。\n2) relation 用 12-24 字描述当前关系状态，语言自然、清晰、可理解，不要猎奇比喻。\n3) opening 是一条正常微信开场白。\n只返回JSON：{"name":"","identity":"","avatar":"emoji","bio":"约70-100字小传","tags":["",""],"relation":"一句话","opening":"主动发来的第一句微信"}`,
        `玩家:${state.player.name}（${state.player.domain}）\n人物描述：${desc}`
      );
      setDraft(toDraft(out));
    } catch (e) { flash("生成失败：" + e.message); }
    setBusy(false);
  }

  async function addRandom() {
    if (busy) return;
    setBusy(true);
    try {
      const role = pick(NPC_ROLES), vibe = pick(NPC_VIBE), stance = pick(NPC_STANCE);
      const out = await callLLM(
        `为现实向娱乐圈模拟器随机生成一个联系人。要求人物身份明确且可信，避免夸张离奇台词；relation 必须自然、简洁，不要戏谑或神经质表达。\n只返回JSON：{"name":"","identity":"","avatar":"emoji","bio":"约70-100字小传","tags":["",""],"relation":"与玩家此刻关系一句话","opening":"主动发来的第一句微信"}`,
        `玩家:${state.player.name}（${state.player.domain}）标签:${state.player.tags.join("、")}\n请按以下随机种子发挥：角色倾向「${role}」，性格基调「${vibe}」，与玩家关系倾向「${stance}」。`
      );
      setDraft(toDraft(out));
    } catch (e) { flash("生成失败：" + e.message); }
    setBusy(false);
  }

  if (busy) return <div className="center-load"><div className="spin" /><div>正在生成人物设定…</div></div>;

  if (adding) return (
    <>
      <div className="nav"><span className="back" onClick={() => setAdding(false)}>‹</span><h2>添加联系人</h2><span className="nav-act dim"> </span></div>
      <div className="pad">
        <button className="btn btn-green" onClick={addRandom}>🎲 随机生成一位</button>
        <p className="muted" style={{ textAlign: "center", margin: "14px 0" }}>— 或 按描述生成 —</p>
        <textarea className="area" rows={4} value={desc} placeholder="例如：捧红过三个顶流的金牌经纪人，圈内人称'老狐狸'，最近盯上了我。" onChange={e => setDesc(e.target.value)} />
        <button className="btn" style={{ marginTop: 14 }} onClick={addByDesc}>按描述生成</button>
        {draft && (
          <div className="profile-card" style={{ marginTop: 16 }}>
            <div className="row-name">{draft.name}</div>
            <div className="muted" style={{ marginTop: 4 }}>身份：{draft.identity || "圈内人士"}</div>
            <div style={{ marginTop: 6 }}>{(draft.tags || []).map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
            <div className="muted" style={{ marginTop: 10, lineHeight: 1.6 }}>{draft.bio}</div>
            <div className="relation">当前关系 · {draft.relation}</div>
            <button className="btn" style={{ marginTop: 12 }} onClick={saveDraft}>保存联系人并加入微信</button>
          </div>
        )}
      </div>
    </>
  );

  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>通讯录</h2><span className="nav-act" onClick={() => setAdding(true)}>添加</span></div>
      <div className="pad" style={{ paddingBottom: 8 }}><button className="btn btn-green" onClick={() => { setAdding(true); setDraft(null); }}>🎲 生成并保存联系人</button></div>
      {state.npcs.length === 0 && <div className="empty" style={{ padding: "30px 34px" }}>人脉空空。<br />点上方按钮随机生成，或右上角按描述添加。</div>}
      {state.npcs.map(n => (
        <div key={n.id} style={{ background: "#fff", padding: "14px 16px", borderBottom: "8px solid #f2f2f7" }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <div className="av">{n.avatar}</div>
            <div style={{ flex: 1 }}><div className="row-name">{n.name}{n.pending && <span className="pill">待通过</span>}</div><div className="muted" style={{ marginTop: 2, fontSize: 12 }}>身份：{n.identity || "圈内人士"}</div><div style={{ marginTop: 3 }}>{(n.tags || []).map((t, i) => <span className="tag" key={i}>{t}</span>)}</div></div>
            {!n.pending && <span className="nav-act" style={{ color: "var(--green)" }} onClick={() => { setActive(n.id); setScreen("wechat"); }}>私信</span>}
          </div>
          <div className="muted" style={{ marginTop: 9, lineHeight: 1.65 }}>{n.bio}</div>
          <div className="relation">当前关系 · {n.relation}</div>
        </div>))}
    </>
  );
}

/* ============================================================ SCHEDULE */
function Schedule({ state, setState, back, flash }) {
  const [busy, setBusy] = useState(false);
  const today = SCHEDULES[(state.day - 1) % SCHEDULES.length];
  const tomorrow = SCHEDULES[state.day % SCHEDULES.length];

  async function advance() {
    setBusy(true);
    let req = null;
    if (Math.random() < 0.6) {
      try {
        const role = pick(NPC_ROLES), stance = pick(NPC_STANCE);
        const out = await callLLM(
          `为现实向娱乐圈模拟器生成一个主动加玩家微信的新联系人。必须身份稳定、逻辑真实，不要离谱设定。\n只返回JSON：{"name":"","identity":"","avatar":"emoji","bio":"约70字小传","tags":[""],"relation":"一句话关系","opening":"申请验证语+加你的理由"}`,
          `玩家:${state.player.name}（${state.player.domain}）第${state.day}天刚结束「${today}」。随机种子：角色「${role}」，关系倾向「${stance}」。`
        );
        const pendingNpc = normalizeContact({
          ...out,
          relation: sanitizeRelation(out.relation || "陌生人"),
          pending: true,
          unread: true,
          chat: [],
          events: [`${todayLabel(state.day)}：发起好友申请`],
        });
        req = await createContact(pendingNpc);
      } catch (e) {}
    }
    setState(p => ({ ...p, day: p.day + 1, npcs: req ? [...p.npcs, req] : p.npcs, ledger: [...p.ledger, { ts: todayLabel(p.day), text: `完成日程「${today}」。` }] }));
    flash(req ? `📅 新的一天 · ${req.name} 申请加你微信` : "📅 进入新的一天");
    setBusy(false);
  }

  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>日程表</h2><span className="nav-act dim"> </span></div>
      <div className="pad">
        <div className="muted" style={{ marginLeft: 4 }}>{todayLabel(state.day)} · 第 {state.day} 天</div>
        <div className="profile-card" style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12, color: "#ff3b30", fontWeight: 600, letterSpacing: 1 }}>今日安排</div>
          <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4 }}>{today}</div>
          <div style={{ height: 1, background: "var(--line)", margin: "14px 0" }} />
          <div className="muted">明日预告</div><div style={{ fontSize: 16, marginTop: 2 }}>{tomorrow}</div>
        </div>
        <button className="btn" style={{ marginTop: 18 }} onClick={advance} disabled={busy}>{busy ? "推进中…" : "结束今天 →"}</button>
        <p className="muted" style={{ marginTop: 10, textAlign: "center" }}>推进时间可能触发被动好友申请与关系变化。</p>
      </div>
    </>
  );
}

/* ============================================================ PROFILE */
function Profile({ state, back, setState, openApiSetup }) {
  const p = state.player;
  async function reset() {
    if (!confirm("确定重开？当前存档会被清除。")) return;
    try {
      await resetStorage();
      setState(null);
    } catch (e) {
      alert("重置失败：" + e.message);
    }
  }
  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>个人信息</h2><span className="nav-act dim"> </span></div>
      <div className="pad">
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}><div className="av" style={{ width: 66, height: 66, fontSize: 34 }}>{p.avatar}</div><div><div style={{ fontSize: 22, fontWeight: 700 }}>{p.name}</div><div className="muted">{p.domain} · {p.mbti} · {p.gender}</div></div></div>
        <div className="profile-card">
          <div style={{ fontSize: 12, color: "var(--txt2)", letterSpacing: 1, marginBottom: 8 }}>人物小传</div>
          <div style={{ fontSize: 15, lineHeight: 1.85, color: "#2b2b30" }}>{p.bio}</div>
          <div style={{ marginTop: 12 }}>{p.tags.map((t, i) => <span className="tag" key={i}>{t}</span>)}</div>
        </div>
        <div className="stat-grid" style={{ marginTop: 14 }}>
          <div className="stat"><div className="stat-v">{state.day}</div><div className="stat-l">出道天数</div></div>
          <div className="stat"><div className="stat-v">{state.npcs.length}</div><div className="stat-l">圈内人脉</div></div>
          <div className="stat"><div className="stat-v">¥{(state.balance / 10000).toFixed(1)}w</div><div className="stat-l">资产</div></div>
          <div className="stat"><div className="stat-v">{state.ledger.length}</div><div className="stat-l">记忆条目</div></div>
        </div>
        <label className="label">社会法则（环境）</label>
        <div className="group"><div className="law-row"><span>资本干预</span><b>{state.laws.资本干预}</b></div><div className="law-row"><span>舆论环境</span><b>{state.laws.舆论}</b></div><div className="law-row"><span>道德容忍</span><b>{state.laws.道德容忍}</b></div></div>
        <label className="label">记忆账本</label>
        <div className="group">{[...state.ledger].reverse().map((l, i) => (<div className="ledger-item" key={i}><span className="ledger-ts">{l.ts}</span>{l.text}</div>))}</div>
        <button className="btn btn-ghost" style={{ marginTop: 22 }} onClick={openApiSetup}>AI 接口设置</button>
        <button className="btn btn-red" style={{ marginTop: 10 }} onClick={reset}>重开人生</button>
      </div>
    </>
  );
}

/* ============================================================ BANK */
function Bank({ state, back }) {
  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>银行卡</h2><span className="nav-act dim"> </span></div>
      <div className="pad">
        <div style={{ background: "linear-gradient(135deg,#ff6b6b,#e64340)", borderRadius: 16, padding: 20, color: "#fff", boxShadow: "0 8px 20px rgba(230,67,64,.3)" }}>
          <div style={{ fontSize: 12, opacity: .85, letterSpacing: 1 }}>可用余额</div>
          <div style={{ fontSize: 33, fontWeight: 800, marginTop: 6 }}>¥ {state.balance.toLocaleString()}</div>
          <div style={{ fontSize: 14, marginTop: 22, letterSpacing: 3, opacity: .9 }}>**** **** **** {state.day.toString().padStart(4, "0")}</div>
        </div>
        <label className="label">交易记录</label>
        <div className="group">{state.tx.map((t, i) => (<div className="law-row" key={i}><div><div style={{ fontSize: 15 }}>{t.t}</div><div className="muted" style={{ fontSize: 12 }}>{t.ts}</div></div><b style={{ color: t.v >= 0 ? "var(--green)" : "#ff3b30" }}>{t.v >= 0 ? "+" : ""}{t.v.toLocaleString()}</b></div>))}</div>
      </div>
    </>
  );
}

/* ============================================================ SOON */
function Soon({ title, back }) {
  return (
    <>
      <div className="nav"><span className="back" onClick={back}>‹ 主屏</span><h2>{title}</h2><span className="nav-act dim"> </span></div>
      <div className="empty"><div className="soon-ico">🚧</div>「{title}」框架已就绪，等待接入。<br /><br /><span style={{ fontSize: 13 }}>当前完整实现：微信 · 微博 · 通讯录 · 日程 · 个人信息 · 银行卡，关系全部由大模型用自然语言模拟。</span></div>
    </>
  );
}


ReactDOM.createRoot(document.getElementById("root")).render(<App />);
