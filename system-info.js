// 引入依赖模块
const fs = require('fs').promises;   // 文件系统（用于读取 /proc 下的系统文件）
const os = require('os');            // Node 内置操作系统模块（获取基础系统信息）
const { exec } = require('child_process'); // 执行 Linux 命令（如 df -h 查看磁盘）

// 全局缓存变量（用于计算差值）
let lastCpuStats = null;  // 保存上一次 CPU 数据（计算使用率）
let lastNetStats = null;  // 保存上一次网卡数据（计算实时网速）

/**
 * 工具函数：安全读取 Linux /proc 目录下的系统文件
 * 所有系统信息（CPU、内存、网络）都从这里读取
 * @param {string} path - 要读取的文件路径
 * @return {string} 文件内容（失败返回空字符串）
 */
async function readProc(path) {
  try {
    return await fs.readFile(path, 'utf8');
  } catch (e) {
    return '';
  }
}

/**
 * 1. 获取 CPU 使用率 + 系统负载
 * 从 /proc/stat 读取原始数据，通过两次差值计算使用率
 */
async function getCpu() {
  const data = await readProc('/proc/stat');
  // 按行拆分，取第一行（cpu 总信息）
  const line = data.split('\n')[0].trim().split(/\s+/);

  // 解析各个状态的 CPU 时间片
  const user = +line[1];    // 用户态
  const nice = +line[2];    // 低优先级用户态
  const system = +line[3];  // 内核态
  const idle = +line[4];    // 空闲

  // 总时间片
  const total = user + nice + system + idle;
  // 繁忙时间片
  const busy = total - idle;

  let usage = 0;
  // 和上一次数据对比，计算使用率
  if (lastCpuStats) {
    const dTotal = total - lastCpuStats.total;
    const dBusy = busy - lastCpuStats.busy;
    usage = dTotal > 0 ? +((dBusy / dTotal) * 100).toFixed(2) : 0;
  }

  // 更新缓存
  lastCpuStats = { total, busy };

  // 获取系统 1/5/15 分钟负载
  const load = os.loadavg();

  return {
    usage,                // CPU 使用率
    cores: os.cpus().length, // 核心数
    load_1m: +load[0].toFixed(2),
    load_5m: +load[1].toFixed(2),
    load_15m: +load[2].toFixed(2)
  };
}

/**
 * 2. 获取内存 + Swap 分区信息
 * 从 /proc/meminfo 读取
 */
async function getMemory() {
  const data = await readProc('/proc/meminfo');
  const map = {};

  // 按行解析，把 key:value 存入对象
  data.split('\n').forEach(line => {
    const [k, v] = line.split(':').map(i => i?.trim());
    if (!k || !v) return;
    map[k] = parseInt(v.replace(/\D/g, '')) || 0;
  });

  // 计算总内存、已用内存
  const total = map.MemTotal;
  const free = map.MemFree + map.Buffers + map.Cached;
  const used = total - free;

  // Swap 分区
  const swapTotal = map.SwapTotal;
  const swapFree = map.SwapFree;
  const swapUsed = swapTotal - swapFree;

  return {
    total_gb: +(total / 1024 / 1024).toFixed(2),
    used_gb: +(used / 1024 / 1024).toFixed(2),
    usage_percent: +((used / total) * 100).toFixed(2),

    swap_total_gb: +(swapTotal / 1024 / 1024).toFixed(2),
    swap_used_gb: +(swapUsed / 1024 / 1024).toFixed(2),
    swap_percent: swapTotal ? +((swapUsed / swapTotal) * 100).toFixed(2) : 0
  };
}

/**
 * 3. 获取磁盘使用情况（挂载点、容量、使用率）
 * 执行 Linux 命令 df -h
 */
function getDisk() {
  return new Promise(resolve => {
    exec('df -h --output=source,size,used,avail,pcent,target | grep "^/dev/"', (err, out) => {
      if (err || !out) return resolve([]);

      // 解析命令输出，转为数组对象
      const list = out.trim().split('\n').map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          dev: parts[0],
          size: parts[1],
          used: parts[2],
          avail: parts[3],
          pcent: parts[4],
          mount: parts[5]
        };
      });
      resolve(list);
    });
  });
}

/**
 * 4. 获取网络信息
 * 包含：网卡名、总接收/发送字节数、实时上下行速度
 */
async function getNetwork() {
  const data = await readProc('/proc/net/dev');
  const now = Date.now();
  const currentList = [];

  if (!data) return [];

  // 遍历所有网卡（跳过前两行标题，跳过 lo 回环网卡）
  data.trim().split('\n').slice(2).forEach(line => {
    const p = line.trim().split(/\s+/);
    const name = p[0].replace(':', '');
    if (name === 'lo') return;

    // 读取总流量（字节）
    const rx_bytes = +p[1];  // 总接收
    const tx_bytes = +p[9]; // 总发送

    currentList.push({
      interface: name,
      rx_bytes,
      tx_bytes,
    });
  });

  // 计算实时网速（两次差值 / 时间差）
  const result = [];
  if (lastNetStats) {
    const deltaTime = (now - lastNetStats.time) / 1000;
    currentList.forEach(net => {
      const old = lastNetStats.list.find(n => n.interface === net.interface);
      if (!old) return;

      const rx_speed = Math.max(0, (net.rx_bytes - old.rx_bytes) / deltaTime);
      const tx_speed = Math.max(0, (net.tx_bytes - old.tx_bytes) / deltaTime);

      result.push({ ...net, rx_speed: Math.floor(rx_speed), tx_speed: Math.floor(tx_speed) });
    });
  }

  // 更新缓存
  lastNetStats = { time: now, list: currentList };

  // 第一次运行返回 0 速度
  return result.length ? result : currentList.map(i => ({ ...i, rx_speed: 0, tx_speed: 0 }));
}

/**
 * 5. 获取当前系统进程总数
 * 读取 /proc 下所有数字命名的目录
 */
async function getProcessCount() {
  try {
    const files = await fs.readdir('/proc');
    const pids = files.filter(f => /^\d+$/.test(f)); // 过滤 PID 目录
    return pids.length;
  } catch (e) {
    return 0;
  }
}

/**
 * 6. 获取系统发行版信息
 * 读取 /etc/os-release
 */
async function getOsRelease() {
  try {
    const data = await readProc('/etc/os-release');
    const name = data.match(/PRETTY_NAME="(.+)"/)?.[1] || 'Linux';
    return name;
  } catch (e) {
    return 'Linux';
  }
}

/**
 * 7. 获取系统基础信息
 * 主机名、内核版本、运行时间、架构
 */
function getSystem() {
  return {
    hostname: os.hostname(),            // 主机名
    kernel: os.release(),               // 内核版本
    uptime: os.uptime(),                // 开机秒数
    uptime_human: `${Math.floor(os.uptime() / 3600)}h ${Math.floor((os.uptime() % 3600) / 60)}m`,
    arch: os.arch(),                    // 系统架构
    platform: os.platform()             // 平台
  };
}

/**
 * 最终汇总：把所有信息打包成一个对象返回
 * 给后端 server.js 调用，通过 SSE 推送给前端
 */
async function getSystemInfo() {
  // 并行获取所有信息（速度更快）
  const [cpu, memory, disk, network, system, process_count, os_release] = await Promise.all([
    getCpu(),
    getMemory(),
    getDisk(),
    getNetwork(),
    getSystem(),
    getProcessCount(),
    getOsRelease()
  ]);

  return {
    cpu,
    memory,
    disk,
    network,
    system,
    process_count,
    os_release
  };
}

// 导出给 server.js 使用
module.exports = { getSystemInfo };

// 直接运行此文件时，打印系统信息（方便调试）
if (require.main === module) {
  getSystemInfo().then(info => {
    console.log(JSON.stringify(info, null, 2));
  });
}
