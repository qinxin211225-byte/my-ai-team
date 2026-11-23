#!/usr/bin/env node
'use strict';
// AI 团队工作台 v0
// 零依赖：只用 Node 自带模块。调用你电脑上已登录的 Claude Code / Codex / Gemini CLI。

const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, execSync, exec } = require('child_process');

const major = parseInt(process.versions.node.split('.')[0], 10);
if (major < 18) {
  console.error('需要 Node.js 18 或以上版本，你现在是 ' + process.version);
  process.exit(1);
}

const os = require('os');
const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 3939;
const HOST = '127.0.0.1';
const DEMO_ALL = process.env.DEMO === '1' || process.argv.includes('--demo');
const NO_OPEN = process.argv.includes('--no-open');
// 你的数据放在用户目录里（~/.my-ai-team），更新程序不会丢
const HOME_DIR = process.env.AI_TEAM_HOME || path.join(os.homedir(), '.my-ai-team');
const WORKDIR = path.join(HOME_DIR, 'workspace');
const DATA_DIR = path.join(HOME_DIR, 'data');
const HISTORY_DIR = path.join(DATA_DIR, 'history');
const SESSION_FILE = path.join(DATA_DIR, 'session.json');
const RULES_FILE = path.join(HOME_DIR, 'rules.md');
for (const d of [WORKDIR, DATA_DIR, HISTORY_DIR]) fs.mkdirSync(d, { recursive: true });
if (!fs.existsSync(RULES_FILE)) fs.copyFileSync(path.join(ROOT, 'rules.md'), RULES_FILE);

// ---------- 团队配置（~/.my-ai-team/team.json 存在就用它，否则用默认的） ----------
const TEAM_FILE = fs.existsSync(path.join(HOME_DIR, 'team.json')) ? path.join(HOME_DIR, 'team.json') : path.join(ROOT, 'team.json');
const team = JSON.parse(fs.readFileSync(TEAM_FILE, 'utf8'));
const members = team.members;
const pm = members.find((m) => m.id === team.pm) || members[0];
const TIMEOUT_MS = (team.timeoutSec || 300) * 1000;
const MAX_STEPS = team.maxAutoSteps || 8;

function hasCommand(cmd) {
  if (!/^[\w.-]+$/.test(cmd)) return false;
  try {
    execSync(process.platform === 'win32' ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
// 双击启动时终端常常找不到这些命令：把常见的安装位置补进 PATH
function extendPath() {
  const home = os.homedir();
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = [
    path.dirname(process.execPath), // 正在运行的这个 node 所在的目录
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS',
    '/Applications/Codex.app/Contents/Resources',
  ];
  if (process.platform === 'win32' && process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'npm'));
  // nvm 等装在 ~/.nvm/versions/node/*/bin
  for (const base of [path.join(home, '.nvm', 'versions', 'node')]) {
    try {
      for (const v of fs.readdirSync(base)) dirs.push(path.join(base, v, 'bin'));
    } catch {}
  }
  const cur = (process.env.PATH || '').split(sep);
  const add = dirs.filter((d) => d && !cur.includes(d) && fs.existsSync(d));
  process.env.PATH = [...cur, ...add].join(sep);
}
extendPath();

function detect() {
  for (const m of members) {
    m.installed = hasCommand(m.command);
    m.online = !DEMO_ALL && m.installed;
  }
}
detect();

function readRules() {
  try {
    return fs.readFileSync(RULES_FILE, 'utf8').trim();
  } catch {
    return '';
  }
}

// ---------- 状态 ----------
function freshState() {
  return { messages: [], nodes: [], pending: null, seq: 0, row: 0, demoStage: 0, createdAt: new Date().toISOString() };
}
let state = freshState();
try {
  if (fs.existsSync(SESSION_FILE)) state = Object.assign(freshState(), JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8')));
} catch {}
// 上次没跑完的节点标成中断
for (const n of state.nodes) if (n.status === 'running') n.status = 'failed';

let busy = false;
let needPM = false;
const typing = new Set();
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => fs.writeFile(SESSION_FILE, JSON.stringify(state, null, 2), () => {}), 300);
}

const clients = new Set();
function broadcast(event, data) {
  const s = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(s);
}
function addMessage(m) {
  m.id = ++state.seq;
  m.time = Date.now();
  state.messages.push(m);
  broadcast('message', m);
  save();
  return m;
}
function patchMessage(id, patch) {
  const m = state.messages.find((x) => x.id === id);
  if (!m) return;
  Object.assign(m, patch);
  broadcast('message', m);
  save();
}
function addNode(n) {
  n.id = ++state.seq;
  if (n.row == null) n.row = ++state.row;
  state.nodes.push(n);
  broadcast('node', n);
  save();
  return n;
}
function patchNode(id, patch) {
  const n = state.nodes.find((x) => x.id === id);
  if (!n) return;
  Object.assign(n, patch);
  broadcast('node', n);
  save();
}
function setTyping(id, on) {
  if (on) typing.add(id);
  else typing.delete(id);
  broadcast('typing', [...typing]);
}
function setBusy(b) {
  busy = b;
  broadcast('busy', b);
}
function setPending(p) {
  state.pending = p;
  broadcast('pending', p);
  save();
}

// ---------- 工具函数 ----------
function memberById(x) {
  if (!x) return null;
  const k = String(x).trim().toLowerCase().replace(/^@/, '');
  return members.find((m) => m.id === k || m.name.toLowerCase() === k || (m.mention || []).includes(k)) || null;
}
function nameOf(id) {
  if (id === 'me') return '我（老板）';
  if (id === 'system') return '系统';
  const m = memberById(id);
  return m ? m.name : id;
}
function clip(s, n) {
  s = String(s || '');
  return s.length > n ? s.slice(0, n) + '…（略）' : s;
}
function mentionsIn(text) {
  const t = String(text).toLowerCase();
  return members.filter((m) => [m.id, m.name, ...(m.mention || [])].some((a) => t.includes('@' + String(a).toLowerCase())));
}
function transcript(limit = 40, per = 1800) {
  return state.messages
    .filter((m) => m.kind !== 'system')
    .slice(-limit)
    .map((m) => {
      let t = m.text || '';
      if (m.kind === 'decision' && m.card) {
        const c = m.card;
        t += `\n[拍板卡] 推荐：${c.title}`;
        if (c.adopted.length) t += '；采纳：' + c.adopted.map((a) => `${nameOf(a.from)}的${a.point}`).join('，');
        if (c.backup) t += `；备选：${c.backup}`;
        if (m.resolved) t += `；老板的决定：${m.resolved}`;
      }
      return `[${nameOf(m.from)}] ${clip(t, per)}`;
    })
    .join('\n\n');
}
function usable(m) {
  return !m.online || !m.lastTest || m.lastTest.ok;
}
function roster() {
  return members
    .map((m) => `- id: ${m.id}｜${m.name}｜角色：${m.role}｜擅长：${m.strengths}｜短板：${m.weaknesses}` + (usable(m) ? '' : '｜【现在接不通，不要派活给他，把他的活交给别人】'))
    .join('\n');
}
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------- 调用命令行 ----------
// format:
//   "claude-stream"：claude -p --output-format stream-json，边写边显示，能识别报错
//   "text"（默认）：读标准输出，边写边显示
//   有 {OUT} 参数的（Codex）：最后从文件里读最终回复
function runCLI(m, prompt, onPartial, timeoutMs = TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const outName = `.out-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`;
    const usesOut = m.args.includes('{OUT}');
    const args = m.args.map((a) => (a === '{OUT}' ? outName : a));
    const stream = m.format === 'claude-stream';
    const child = spawn(m.command, args, {
      cwd: WORKDIR,
      shell: process.platform === 'win32', // Windows 上 npm 装的命令是 .cmd，需要 shell
      env: process.env,
    });
    let out = '';
    let err = '';
    let buf = '';
    let partial = '';
    let result = null;
    let isError = false;
    const emit = (t) => onPartial && t && onPartial(t);
    child.stdout.on('data', (d) => {
      d = String(d);
      out += d;
      if (!stream) {
        if (!usesOut) emit(out.trim());
        return;
      }
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let ev;
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        const delta = ev.type === 'stream_event' && ev.event && ev.event.delta;
        if (delta && delta.type === 'text_delta' && delta.text) {
          partial += delta.text;
          emit(partial);
        } else if (ev.type === 'result') {
          result = typeof ev.result === 'string' ? ev.result : '';
          isError = !!ev.is_error;
        }
      }
    });
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${m.name} 超过 ${Math.round(timeoutMs / 1000)} 秒没回应`));
    }, timeoutMs);
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e.code === 'ENOENT' ? new Error(`找不到命令 ${m.command}，还没安装？`) : e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      let text = stream ? (result !== null ? result : partial) : out;
      const outPath = path.join(WORKDIR, outName);
      if (usesOut && fs.existsSync(outPath)) {
        text = fs.readFileSync(outPath, 'utf8');
        fs.unlink(outPath, () => {});
      }
      text = String(text || '').trim();
      if (isError) return reject(new Error(clip(text || err.trim(), 400) || '出错了'));
      if (code !== 0 && !text) return reject(new Error(clip(err.trim(), 400) || `退出码 ${code}`));
      resolve(text);
    });
    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

async function call(m, prompt, kind, onPartial) {
  if (!m.online) return demoReply(m, prompt, kind, onPartial);
  return runCLI(m, prompt, onPartial);
}

// ---------- 提示词 ----------
function pmPrompt() {
  const rules = readRules();
  return `你是一个 AI 小团队的项目经理，名字叫 ${pm.name}。这个团队像一个创业团队：每个成员把自己最擅长的拿出来，你负责知人善任、把对的活交给对的人。

团队成员：
${roster()}

用户在群里显示为「我（老板）」。他既是团队一员（随时会插话、提意见），也是老板：拍板卡由他决定，他的决定就是最终决定。

${rules ? '公司规章（所有人都要遵守）：\n' + rules + '\n' : ''}
你的工作方式：
1. 收到需求后拆成步骤，把每一步派给最擅长的成员。需要创意或方案的活，可以让两个成员各自独立出一份，方便对比。
2. 收齐结果后逐条对比，合成一份。用拍板卡交给老板：写清推荐什么、采纳了谁的什么、没采纳什么及原因、备选是什么。
3. 老板拍板后，派执行的活。全部做完后你终审，用 done 把最终结果交付给老板。
4. 你自己也可以干活：把任务派给 "${pm.id}"。
5. 老板只是聊天、提问或者事情很简单时，直接 reply，不要硬派活。
6. 老板插话提了意见，要认真吸收，必要时重新派活。

到目前为止的群聊记录：
${transcript() || '（空）'}

现在轮到你。只输出一个 JSON 对象，不要输出任何别的文字。从下面四种里选一种：
{"type":"dispatch","say":"你在群里说的话，可以 @成员","tasks":[{"to":"成员id","title":"流程图上的短标题，10个字以内","prompt":"给这个成员的完整、具体的指令"}]}
{"type":"decision","say":"你在群里说的话","card":{"title":"推荐方案，一句话","adopted":[{"from":"成员id","point":"采纳了他的什么"}],"rejected":[{"item":"没采纳的东西","reason":"原因"}],"backup":"备选方案，一句话"}}
{"type":"reply","say":"你在群里说的话"}
{"type":"done","say":"交付给老板的最终结果，完整写出来"}`;
}

function agentPrompt(m, instruction, from) {
  const rules = readRules();
  const first = state.messages.find((x) => x.from === 'me');
  return `你是一个 AI 小团队里的成员，名字叫 ${m.name}，角色是「${m.role}」，你擅长：${m.strengths}。
团队成员：${members.map((x) => `${x.name}（${x.role}）`).join('、')}。用户是老板，在群里显示为「我（老板）」。
${rules ? '\n公司规章：\n' + rules + '\n' : ''}
老板最初的需求：${first ? clip(first.text, 1500) : '（无）'}

最近的群聊：
${transcript(12, 800) || '（空）'}

${from === 'me' ? '老板刚在群里直接找你：' : `项目经理 ${pm.name} 派给你的任务：`}
${instruction}

要求：直接给出结果，用中文，简洁清楚，像在工作群里回复同事。发挥你最擅长的部分。除非任务明确要求，不要创建或修改任何文件。`;
}

function parseAction(text) {
  const s = text.indexOf('{');
  const e = text.lastIndexOf('}');
  if (s < 0 || e <= s) return { type: 'reply', say: text };
  try {
    const a = JSON.parse(text.slice(s, e + 1));
    if (!a || typeof a !== 'object') return { type: 'reply', say: text };
    if (!a.type) a.type = 'reply';
    return a;
  } catch {
    return { type: 'reply', say: text };
  }
}
function normalizeCard(c) {
  const arr = (x) => (Array.isArray(x) ? x : []);
  return {
    title: String(c.title || '（没写推荐）'),
    adopted: arr(c.adopted).map((a) => ({ from: (memberById(a.from) || {}).id || String(a.from || ''), point: String(a.point || '') })),
    rejected: arr(c.rejected).map((r) => ({ item: String(r.item || ''), reason: String(r.reason || '') })),
    backup: c.backup ? String(c.backup) : '',
  };
}

function errText(m, e) {
  const msg = String((e && e.message) || e);
  const login = /auth|login|log in|unauthori|401|403|credential|token|api key|登录/i.test(msg);
  return `${m.name} 出错了：${msg}` + (login ? `。看起来还没登录：在终端运行「${m.login || m.command}」登录，然后点左下角的成员打开「团队体检」测试。` : '');
}

// 真实干活的结果顺手记成"体检结果"：失败的成员显示没接通，项目经理不再派活给他
function markHealth(m, ok, err) {
  if (!m.online) return;
  const was = m.lastTest && m.lastTest.ok;
  if (ok && was) return;
  m.lastTest = ok ? { ok: true, text: '刚刚干活正常', at: Date.now() } : { ok: false, text: clip(err || '出错了', 300), at: Date.now() };
  broadcastTeam();
}

// ---------- 干活 ----------
async function runMember(m, prompt, title, row) {
  const node = addNode({ lane: m.id, title, status: 'running', row });
  setTyping(m.id, true);
  let msg = null;
  let last = 0;
  // 边写边显示：第一段文字出来时建消息，之后最多每 0.3 秒刷新一次
  const onPartial = (t) => {
    if (!msg) {
      msg = addMessage({ from: m.id, text: t, demo: !m.online, task: title, streaming: true });
      patchNode(node.id, { msgId: msg.id });
      last = Date.now();
    } else if (Date.now() - last > 300) {
      last = Date.now();
      msg.text = t;
      broadcast('message', msg);
    }
  };
  try {
    const text = await call(m, prompt, 'agent', onPartial);
    markHealth(m, true);
    setTyping(m.id, false);
    if (msg) patchMessage(msg.id, { text: text || msg.text || '（没有返回内容）', streaming: false });
    else msg = addMessage({ from: m.id, text: text || '（没有返回内容）', demo: !m.online, task: title });
    patchNode(node.id, { status: 'done', msgId: msg.id });
  } catch (e) {
    setTyping(m.id, false);
    if (msg) patchMessage(msg.id, { streaming: false });
    markHealth(m, false, e.message);
    msg = addMessage({ from: 'system', kind: 'system', text: errText(m, e) });
    patchNode(node.id, { status: 'failed', msgId: msg.id });
  }
}

async function pmLoop() {
  for (let i = 0; i < MAX_STEPS; i++) {
    setTyping(pm.id, true);
    let raw;
    try {
      raw = await call(pm, pmPrompt(), 'pm');
    } catch (e) {
      setTyping(pm.id, false);
      markHealth(pm, false, e.message);
      addMessage({ from: 'system', kind: 'system', text: errText(pm, e) });
      return;
    }
    setTyping(pm.id, false);
    const a = parseAction(raw);
    const say = a.say ? String(a.say) : '';

    if (a.type === 'dispatch' && Array.isArray(a.tasks) && a.tasks.length) {
      const msg = addMessage({ from: pm.id, text: say || '我来派一下活。', demo: !pm.online });
      addNode({ lane: pm.id, title: '拆活、派活', status: 'done', msgId: msg.id });
      const row = ++state.row;
      await Promise.all(
        a.tasks.slice(0, 6).map((t) => {
          const m = memberById(t.to) || pm;
          const title = clip(t.title || '干活', 14);
          return runMember(m, agentPrompt(m, String(t.prompt || t.title || ''), 'pm'), title, row);
        })
      );
      continue;
    }
    if (a.type === 'decision' && a.card) {
      const msg = addMessage({ from: pm.id, kind: 'decision', text: say, card: normalizeCard(a.card), demo: !pm.online });
      addNode({ lane: pm.id, title: '对比、合成一份', status: 'done', msgId: msg.id });
      const node = addNode({ lane: 'me', title: '拍板', status: 'waiting', msgId: msg.id, boss: true });
      setPending({ msgId: msg.id, nodeId: node.id });
      return;
    }
    if (a.type === 'done') {
      const msg = addMessage({ from: pm.id, kind: 'done', text: say || '完成了。', demo: !pm.online });
      addNode({ lane: pm.id, title: '终审、汇总给你', status: 'done', msgId: msg.id });
      return;
    }
    const msg = addMessage({ from: pm.id, text: say || raw, demo: !pm.online });
    addNode({ lane: pm.id, title: '回复', status: 'done', msgId: msg.id });
    return;
  }
  addMessage({ from: 'system', kind: 'system', text: '连续自动跑了好几轮，先停一下。你说一句，大家接着干。' });
}

async function runPM() {
  if (busy) {
    needPM = true;
    return;
  }
  setBusy(true);
  try {
    do {
      needPM = false;
      await pmLoop();
    } while (needPM);
  } finally {
    setBusy(false);
  }
}

async function onUserText(text) {
  const isFirst = !state.messages.some((m) => m.from === 'me');
  const msg = addMessage({ from: 'me', text });
  const mentioned = mentionsIn(text).filter((m) => m.id !== pm.id);
  const title = clip(isFirst ? '说需求' : mentioned.length ? '插话 @' + mentioned.map((m) => m.name).join(' @') : '提意见', 14);
  if (state.pending) {
    // 拍板卡没点按钮，直接说了话：这一格就变成"提意见/插话"
    patchMessage(state.pending.msgId, { resolved: '你提了意见' });
    patchNode(state.pending.nodeId, { status: 'done', title, dashed: true, boss: false, msgId: msg.id });
    setPending(null);
  } else {
    addNode({ lane: 'me', title, status: 'done', msgId: msg.id, dashed: !isFirst });
  }
  if (mentioned.length) {
    const row = ++state.row;
    await Promise.all(mentioned.map((m) => runMember(m, agentPrompt(m, text, 'me'), '回应插话', row)));
  }
  await runPM();
}

async function onDecide(choice) {
  if (!state.pending) return;
  const { msgId, nodeId } = state.pending;
  const card = (state.messages.find((m) => m.id === msgId) || {}).card || {};
  const backup = choice === 'backup';
  setPending(null);
  patchMessage(msgId, { resolved: backup ? '换成备选' : '就这么干' });
  patchNode(nodeId, { status: 'done', title: backup ? '拍板：换备选' : '拍板：就这么干' });
  addMessage({ from: 'me', text: backup ? `【拍板】换成备选：${card.backup || ''}` : `【拍板】就这么干：${card.title || ''}` });
  await runPM();
}

function resetSession() {
  if (state.messages.length) {
    const f = path.join(HISTORY_DIR, `${state.createdAt.replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(f, JSON.stringify(state, null, 2));
  }
  state = freshState();
  save();
  broadcast('reset', true);
}

// ---------- 演示模式（没装命令行工具时用） ----------
async function demoReply(m, prompt, kind, onPartial) {
  await sleep(600 + Math.random() * 700);
  if (kind === 'pm') return JSON.stringify(demoPM());
  const text = demoText(m, prompt);
  // 演示也一段一段地出字，和真的一样
  if (onPartial) {
    for (let i = 6; i < text.length; i += 6) {
      onPartial(text.slice(0, i));
      await sleep(60);
    }
  }
  return text;
}

function demoText(m, prompt) {
  const fromMe = prompt.includes('老板刚在群里直接找你：');
  const instruction = prompt.split(/老板刚在群里直接找你：|派给你的任务：/).pop().split('\n\n要求：')[0];
  if (fromMe) {
    return m.role.includes('点子')
      ? '懂了，第 2 个换成：**我每天真在用的 AI 工作流，照着抄就行**（附步骤）。'
      : `（演示）收到，我按你说的改：${clip(instruction.replace(/\s+/g, ' ').trim(), 40)}`;
  }
  if (/选题/.test(instruction) && !/标题|脚本/.test(instruction)) {
    return m.role.includes('点子')
      ? '我的 3 个：\n1. 我让三个 AI 开了一家公司，我只负责拍板\n2. 在纽约实习的一周，AI 帮我省了哪些活\n3. 普通人第一次用 AI 做视频的翻车现场'
      : '我的 3 个：\n1. 同一个任务让三个 AI PK，谁最靠谱\n2. 用 AI 30 分钟做完一个网站\n3. 一句话让 AI 帮我找合作博主';
  }
  if (/脚本/.test(instruction)) {
    return '60 秒口播脚本：\n**开头（0-5 秒）**：刘邦说他不如张良、萧何、韩信，但他能用这三个人。我也一样。\n**中段（5-45 秒）**：同一个选题任务，Claude 拆活，Gemini 出点子，GPT 写稿，我只在群里拍板。\n**结尾（45-60 秒）**：你只要会用人，就能有一个 AI 团队。下期教你搭。';
  }
  if (/标题/.test(instruction)) {
    return '3 个标题：\n1. 我不如 AI，但我能用 AI\n2. 我给三个 AI 建了个群，它们自己分好了工\n3. 一个人的创业公司，员工全是 AI\n封面文案：「我只负责拍板」';
  }
  return `（演示）收到，我按你说的改一下：${clip(instruction.replace(/\s+/g, ' ').trim(), 40)}`;
}

function demoPM() {
  const ideas = members.find((m) => m.role.includes('点子')) || members[1] || pm;
  const exec_ = members.find((m) => m.role.includes('执行')) || members[2] || pm;
  const lastMe = [...state.messages].reverse().find((m) => m.from === 'me');
  // 拍板卡发出后老板没点按钮、而是提了意见：重新合成一份再拍板
  if (state.demoStage === 2 && lastMe && !lastMe.text.startsWith('【拍板】')) {
    return {
      type: 'decision',
      say: '收到老板的意见，Gemini 也改好了，我重新合成了一份，请再拍板。',
      card: {
        title: '我让三个 AI 开了一家公司，我只负责拍板',
        adopted: [
          { from: ideas.id, point: '切入角度，“我只拍板”有反差' },
          { from: exec_.id, point: '拍法，同一个任务三个 AI PK，好拍有看点' },
        ],
        rejected: [{ item: '30 分钟做完一个网站', reason: '同类视频太多，和账号定位不够贴' }],
        backup: '我每天真在用的 AI 工作流，照着抄就行',
      },
    };
  }
  const s = state.demoStage++;
  save();
  if (s === 0)
    return {
      type: 'dispatch',
      say: `收到，我拆一下：@${ideas.name} 和 @${exec_.name} 各自独立出 3 个选题，我逐条对比、合成一份给你拍板。`,
      tasks: [
        { to: ideas.id, title: '出 3 个选题', prompt: '根据老板的需求，独立出 3 个选题。' },
        { to: exec_.id, title: '独立出 3 个选题', prompt: '根据老板的需求，独立出 3 个选题。' },
      ],
    };
  if (s === 1)
    return {
      type: 'decision',
      say: '两份都收齐了，我逐条对比完了，请老板拍板。',
      card: {
        title: '我让三个 AI 开了一家公司，我只负责拍板',
        adopted: [
          { from: ideas.id, point: '切入角度，“我只拍板”有反差' },
          { from: exec_.id, point: '拍法，同一个任务三个 AI PK，好拍有看点' },
        ],
        rejected: [{ item: '30 分钟做完一个网站', reason: '同类视频太多，和账号定位不够贴' }],
        backup: '我每天真在用的 AI 工作流',
      },
    };
  if (s === 2)
    return {
      type: 'dispatch',
      say: `收到，开工。@${exec_.name} 写 60 秒口播脚本，@${ideas.name} 出 3 个标题和封面文案。写完我审一遍再给你。`,
      tasks: [
        { to: exec_.id, title: '写 60 秒脚本', prompt: '按拍板的选题写 60 秒口播脚本。' },
        { to: ideas.id, title: '标题 + 封面文案', prompt: '出 3 个标题和封面文案。' },
      ],
    };
  if (s === 3)
    return {
      type: 'done',
      say: '都审过了，交付给你：\n**选题**：我让三个 AI 开了一家公司，我只负责拍板\n**脚本**：用 GPT 的版本，开头的刘邦那句保留\n**标题**：用 Gemini 的第 2 个\n\n（这是演示模式。装好 Claude Code、Codex、Gemini CLI 并重启后，这里就是它们真实的回复。）',
    };
  return { type: 'reply', say: '（演示模式）我现在只会按剧本走。装好 Claude Code 后我就能真正听懂你的话了。点右上角“新任务”可以重新看一遍演示。' };
}

// ---------- 网页服务 ----------
function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', (d) => {
      b += d;
      if (b.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(b ? JSON.parse(b) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
function publicMember(m) {
  const { id, name, role, avatar, color, strengths, weaknesses, online, installed, install, login, lastTest } = m;
  return { id, name, role, avatar, color, strengths, weaknesses, online, installed, install, login, lastTest: lastTest || null, installing: installing.has(id) };
}
function broadcastTeam() {
  broadcast('team', members.map(publicMember));
}

// ---------- 团队体检：检查、测试、安装 ----------
function versionOf(m) {
  return new Promise((r) => {
    if (!m.installed) return r('');
    exec(`${m.command} --version`, { timeout: 15000, cwd: WORKDIR }, (e, so) => r(e ? '' : String(so).trim().split('\n')[0].slice(0, 60)));
  });
}
async function testMember(m) {
  detect();
  if (!m.installed) {
    m.lastTest = { ok: false, text: `还没安装 ${m.name}`, at: Date.now() };
  } else {
    try {
      const t = await runCLI(m, '这是一次连通测试。只回复两个字：在线', null, 120000);
      m.lastTest = { ok: true, text: clip(t, 80), at: Date.now() };
    } catch (e) {
      m.lastTest = { ok: false, text: clip(e.message, 300), at: Date.now() };
    }
  }
  broadcastTeam();
  return m.lastTest;
}
const installing = new Set();
function installMember(m) {
  if (installing.has(m.id) || !/^@?[\w./-]+$/.test(m.install || '')) return false;
  installing.add(m.id);
  broadcastTeam();
  const send = (line) => broadcast('install', { id: m.id, line });
  send(`npm install -g ${m.install}`);
  let log = '';
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['install', '-g', m.install], { shell: process.platform === 'win32' });
  const onData = (d) => {
    log += d;
    String(d).split(/\r?\n/).filter((l) => l.trim()).forEach((l) => send(l.slice(0, 300)));
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const finish = (ok, hint) => {
    installing.delete(m.id);
    detect();
    broadcast('install', { id: m.id, done: true, ok, hint });
    broadcastTeam();
  };
  child.on('error', (e) => finish(false, '没找到 npm，先装 Node.js：' + e.message));
  child.on('close', (code) => {
    if (code === 0) return finish(true, '');
    const perm = /EACCES|permission denied|operation not permitted/i.test(log);
    finish(false, perm ? `权限不够。打开终端，运行：sudo npm install -g ${m.install}（会让你输开机密码，输的时候屏幕不显示，正常）` : '安装失败，看上面的日志');
  });
  return true;
}

const server = http.createServer(async (req, res) => {
  // 只接受本机访问，防止别的网站偷偷调用
  if (!ALLOWED_HOSTS.has(req.headers.host)) return sendJSON(res, 403, { error: 'forbidden' });
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return fs.createReadStream(path.join(ROOT, 'public', 'index.html')).pipe(res);
    }
    if (req.method === 'GET' && url.pathname === '/api/state') {
      return sendJSON(res, 200, { team: { pm: pm.id, members: members.map(publicMember) }, state, busy, typing: [...typing] });
    }
    if (req.method === 'GET' && url.pathname === '/api/history') {
      const list = fs
        .readdirSync(HISTORY_DIR)
        .filter((f) => /^[\w-]+\.json$/.test(f))
        .map((f) => {
          try {
            const s = JSON.parse(fs.readFileSync(path.join(HISTORY_DIR, f), 'utf8'));
            const first = (s.messages || []).find((m) => m.from === 'me');
            const done = (s.messages || []).some((m) => m.kind === 'done');
            return { id: f.replace(/\.json$/, ''), title: first ? first.text : '（空任务）', time: s.createdAt, done };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.time).localeCompare(String(a.time)));
      return sendJSON(res, 200, list);
    }
    const hm = url.pathname.match(/^\/api\/history\/([\w-]+)$/);
    if (req.method === 'GET' && hm) {
      const f = path.join(HISTORY_DIR, hm[1] + '.json');
      if (!fs.existsSync(f)) return sendJSON(res, 404, { error: '没找到' });
      return sendJSON(res, 200, { state: JSON.parse(fs.readFileSync(f, 'utf8')) });
    }
    if (req.method === 'GET' && url.pathname === '/api/doctor') {
      detect();
      const list = await Promise.all(members.map(async (m) => ({ ...publicMember(m), version: await versionOf(m) })));
      broadcastTeam();
      return sendJSON(res, 200, { node: process.version, demo: DEMO_ALL, home: HOME_DIR, members: list });
    }
    if (req.method === 'GET' && url.pathname === '/api/rules') {
      return sendJSON(res, 200, { text: readRules() });
    }
    if (req.method === 'GET' && url.pathname === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      res.write('retry: 2000\n\n');
      clients.add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => {
        clearInterval(ping);
        clients.delete(res);
      });
      return;
    }
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      if (origin && !ALLOWED_HOSTS.has(origin.replace(/^https?:\/\//, ''))) return sendJSON(res, 403, { error: 'forbidden' });
      if (!String(req.headers['content-type'] || '').includes('application/json')) return sendJSON(res, 415, { error: 'json only' });
      const body = await readBody(req);
      if (url.pathname === '/api/message') {
        const text = String(body.text || '').trim();
        if (!text) return sendJSON(res, 400, { error: '空消息' });
        onUserText(text).catch((e) => addMessage({ from: 'system', kind: 'system', text: '出错了：' + e.message }));
        return sendJSON(res, 200, { ok: true });
      }
      if (url.pathname === '/api/decide') {
        onDecide(body.choice === 'backup' ? 'backup' : 'main').catch((e) => addMessage({ from: 'system', kind: 'system', text: '出错了：' + e.message }));
        return sendJSON(res, 200, { ok: true });
      }
      if (url.pathname === '/api/test' || url.pathname === '/api/install') {
        const m = memberById(body.id);
        if (!m) return sendJSON(res, 404, { error: '没有这个成员' });
        if (url.pathname === '/api/test') return sendJSON(res, 200, await testMember(m));
        if (!installMember(m)) return sendJSON(res, 409, { error: '正在安装，或者这个成员没写安装包名' });
        return sendJSON(res, 200, { ok: true });
      }
      if (url.pathname === '/api/rules') {
        fs.writeFileSync(RULES_FILE, String(body.text || '').slice(0, 20000));
        return sendJSON(res, 200, { ok: true });
      }
      if (url.pathname === '/api/reset') {
        if (busy) return sendJSON(res, 409, { error: '大家还在干活，等这一轮做完再开新任务' });
        resetSession();
        return sendJSON(res, 200, { ok: true });
      }
    }
    sendJSON(res, 404, { error: 'not found' });
  } catch (e) {
    sendJSON(res, 500, { error: e.message });
  }
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log('\n  AI 团队工作台已启动：' + url);
  console.log('  成员：' + members.map((m) => `${m.name}（${m.role}）${m.online ? '在线' : '演示模式'}`).join('，'));
  console.log('  关掉这个窗口就会停止。\n');
  if (!NO_OPEN) {
    const cmd = process.platform === 'darwin' ? `open ${url}` : process.platform === 'win32' ? `start "" ${url}` : `xdg-open ${url}`;
    exec(cmd, () => {});
  }
});
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`端口 ${PORT} 被占用了。可能已经开着一个，直接打开 http://localhost:${PORT} 试试。`);
  else console.error(e);
  process.exit(1);
});
