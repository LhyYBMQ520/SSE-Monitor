const express = require('express'); // 后端 Web 框架，用来快速写接口、静态服务
const http = require('http');       // Node.js 内置 HTTP 模块，用于创建服务器
const { getSystemInfo } = require('./system-info'); // 引入我们写的系统信息采集工具

// 创建 Express 实例 + HTTP 服务器
const app = express();             // 创建 Express 应用
const server = http.createServer(app); // 用 HTTP 服务包裹 Express（方便 SSE 长连接）

// 配置中间件
app.use(express.json()); // 允许后端解析 JSON 格式的请求体
app.use(express.static(__dirname)); // 把当前文件夹设为静态目录 → 可以直接访问 index.html

// 路由1：访问网站根目录 /
// 作用：打开浏览器时，返回前端页面 index.html
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/index.html');
});

// 路由2：Ping 测试接口 /api/ping
// 作用：前端用来测试延迟，后端立刻返回 { pong: true }
// 前端通过计算请求耗时 = 真实网络延迟
app.post('/api/ping', (req, res) => {
  res.json({ pong: true });
});

// 路由3：SSE 时钟推送 /sse/time
// 作用：建立长连接，每秒向前端推送服务器当前时间
app.get('/sse/time', (req, res) => {
  // SSE 必须设置这三个响应头，告诉浏览器这是长连接流
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 立即发送响应头，建立连接

  // 定时器：每隔 500 毫秒，向前端推送一次时间
  const timer = setInterval(() => {
    // 构造要推送的数据
    const data = JSON.stringify({
      serverTime: new Date().toISOString()
    });
    // SSE 格式固定：data: 内容\n\n
    res.write(`data: ${data}\n\n`);
  }, 500);

  // 前端关闭页面 / 断开连接时，清除定时器，避免内存泄漏
  req.on('close', () => {
    clearInterval(timer);
  });
});

// 路由4：SSE 系统监控实时推送 /sse/system
// 作用：每秒推送 CPU、内存、磁盘、网络、进程数、系统版本等数据
app.get('/sse/system', async (req, res) => {
  // SSE 固定响应头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // 每500毫秒获取一次系统信息并推送给前端
  const timer = setInterval(async () => {
    try {
      // 调用 system-info.js 里的方法，获取所有系统数据
      const info = await getSystemInfo();
      // 推送给前端
      res.write(`data: ${JSON.stringify(info)}\n\n`);
    } catch (err) {
      // 捕获错误，防止服务器崩溃
      console.error('系统信息推送失败:', err);
    }
  }, 500);

  // 客户端断开连接时清理定时器
  req.on('close', () => {
    clearInterval(timer);
  });
});

// 启动服务器，监听端口 23456
const PORT = 23456;
server.listen(PORT, () => {
  console.log(`✅ 服务器已启动：http://localhost:${PORT}`);
});
