const express = require('express');
const http = require('http');
const path = require('path');
const { getSystemInfo } = require('./system-info');

const app = express();
const server = http.createServer(app);
const INDEX_FILE = path.join(__dirname, 'index.html');
const FONT_ASSET_DIR = path.join(__dirname, 'fontawesome-free-7.2.0-web');
const TIME_INTERVAL_MS = 1000;
const SYSTEM_INTERVAL_MS = 2000;

// 避免小响应触发 Nagle 等待，并让 3 秒一次的延迟探测复用 TCP 连接。
server.on('connection', socket => socket.setNoDelay(true));
server.keepAliveTimeout = 15000;
server.headersTimeout = 16000;

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  next();
});

// 仅公开页面需要的图标资源，避免将服务端源码和项目配置暴露为静态文件。
app.use('/fontawesome-free-7.2.0-web', express.static(FONT_ASSET_DIR, {
  dotfiles: 'deny',
  etag: true,
  immutable: true,
  maxAge: '30d'
}));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(INDEX_FILE);
});

app.head('/api/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(204).end();
});

// 保留旧版 POST 调用兼容性。
app.post('/api/ping', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ pong: true });
});

const timeClients = new Set();
const systemClients = new Set();
let timeTimer = null;
let systemTimer = null;
let systemCollecting = false;

function writeSse(res, data) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

function initializeSse(req, res, clients, onRemove) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  clients.add(res);

  let removed = false;
  const removeClient = () => {
    if (removed) return;
    removed = true;
    clients.delete(res);
    onRemove();
  };

  req.once('close', removeClient);
  res.once('close', removeClient);
  res.once('error', removeClient);
}

function stopTimeBroadcastIfIdle() {
  if (timeClients.size || !timeTimer) return;
  clearInterval(timeTimer);
  timeTimer = null;
}

function broadcastTime() {
  const payload = { serverTime: new Date().toISOString() };
  for (const client of timeClients) {
    if (!writeSse(client, payload)) timeClients.delete(client);
  }
  stopTimeBroadcastIfIdle();
}

function startTimeBroadcast() {
  if (timeTimer) return;
  broadcastTime();
  timeTimer = setInterval(broadcastTime, TIME_INTERVAL_MS);
}

async function broadcastSystem() {
  if (!systemClients.size || systemCollecting) return;
  systemTimer = null;
  systemCollecting = true;

  try {
    const info = await getSystemInfo();
    for (const client of systemClients) {
      if (!writeSse(client, info)) systemClients.delete(client);
    }
  } catch (err) {
    console.error('系统信息推送失败:', err);
  } finally {
    systemCollecting = false;
    if (systemClients.size) {
      systemTimer = setTimeout(broadcastSystem, SYSTEM_INTERVAL_MS);
    }
  }
}

function stopSystemBroadcastIfIdle() {
  if (systemClients.size || !systemTimer) return;
  clearTimeout(systemTimer);
  systemTimer = null;
}

app.get('/sse/time', (req, res) => {
  initializeSse(req, res, timeClients, stopTimeBroadcastIfIdle);
  startTimeBroadcast();
});

app.get('/sse/system', (req, res) => {
  initializeSse(req, res, systemClients, stopSystemBroadcastIfIdle);
  if (!systemTimer && !systemCollecting) broadcastSystem();
});

function parsePort(value) {
  const port = Number.parseInt(value, 10);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : 23456;
}

const PORT = parsePort(process.env.PORT);
const HOST = process.env.HOST || '0.0.0.0';
let shuttingDown = false;

server.listen(PORT, HOST, () => {
  console.log(`服务器已启动：http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`收到 ${signal}，正在关闭服务器...`);
  if (timeTimer) clearInterval(timeTimer);
  if (systemTimer) clearTimeout(systemTimer);

  for (const client of [...timeClients, ...systemClients]) {
    if (!client.writableEnded) client.end();
  }

  server.close(err => {
    if (err) {
      console.error('服务器关闭失败:', err);
      process.exitCode = 1;
    }
  });
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
