const os = require('os');
// 引入第三方库systeminformation：专业获取硬件/系统详细信息
const IS_LINUX = process.platform === 'linux';
const si = IS_LINUX ? null : require('systeminformation');
const { getLinuxSystemInfo } = IS_LINUX ? require('./linux-system-info') : {};

// 全局缓存变量：存储上一次获取的网卡数据
// 作用：在部分系统上，通过【本次数据 - 上次数据】的差值，计算实时网速
let lastNetStats = null;

// 系统信息结果缓存，避免短时间内重复调用 systeminformation 的昂贵函数
let _cache = null;
let _cacheTime = 0;
let _cachePromise = null;
const CACHE_TTL = 1000; // 缓存有效期 1 秒
let osReleasePromise = null;

/**
 * 工具函数：安全转换为数字
 * @param {any} value 任意类型的值
 * @returns {number} 有效数字返回原值，无效值(NaN/undefined)返回0
 */
function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

/**
 * 工具函数：格式化系统运行时间（秒 → 时:分）
 * @param {number} seconds 运行总秒数
 * @returns {string} 格式化后的字符串，如 2h 30m
 */
function formatUptime(seconds) {
  // 确保数值非负，且转为整数
  const safe = Math.max(0, Math.floor(toNumber(seconds)));
  // 计算小时：总秒数 ÷ 3600（1小时=3600秒）
  const hours = Math.floor(safe / 3600);
  // 计算分钟：总秒数取模3600后 ÷ 60
  const minutes = Math.floor((safe % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * 工具函数：格式化字节数（转为B/K/M/G/T/P易读单位）
 * @param {number} bytes 字节数
 * @returns {string} 格式化后的大小，如 2G、512M、100K
 */
function formatBytes(bytes) {
  // 定义存储单位数组
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  // 确保数值非负
  let value = Math.max(0, toNumber(bytes));
  let idx = 0;

  // 循环除以1024，直到数值小于1024或到达最大单位
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }

  // 格式化小数：数值≥10或单位是B时，保留0位小数；否则保留1位
  const digits = value >= 10 || idx === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${units[idx]}`;
}

/**
 * 1. 获取CPU信息
 * 包含：CPU使用率、核心数、1/5/15分钟系统平均负载
 * 兼容说明：Windows系统loadavg固定为0，Linux/macOS返回真实负载
 * @returns {object} CPU信息对象
 */
async function getCpu() {
  try {
    // 并行获取：CPU实时负载 + 系统平均负载
    const [load, avg] = await Promise.all([
      si.currentLoad(),  // 第三方库获取CPU使用率
      Promise.resolve(os.loadavg())  // 原生模块获取系统负载
    ]);
    return {
      usage: +toNumber(load.currentLoad).toFixed(2),       // CPU使用率（保留2位小数）
      cores: os.cpus().length,                              // CPU物理核心数
      load_1m: +toNumber(avg[0]).toFixed(2),                // 1分钟平均负载
      load_5m: +toNumber(avg[1]).toFixed(2),                // 5分钟平均负载
      load_15m: +toNumber(avg[2]).toFixed(2)                 // 15分钟平均负载
    };
  } catch (e) {
    // 异常捕获：获取失败时返回默认值，避免程序崩溃
    return {
      usage: 0,
      cores: os.cpus().length,
      load_1m: 0,
      load_5m: 0,
      load_15m: 0
    };
  }
}

/**
 * 2. 获取内存 + 交换分区(Swap)信息
 * @returns {object} 内存/Swap的总大小、已用大小、使用率
 */
async function getMemory() {
  try {
    const m = await si.mem(); // 获取内存原始数据
    const total = toNumber(m.total);                // 总物理内存
    const used = Math.max(0, total - toNumber(m.available)); // 已用内存 = 总内存 - 可用内存
    const swapTotal = toNumber(m.swaptotal);        // 总Swap分区
    const swapUsed = toNumber(m.swapused);          // 已用Swap分区

    return {
      // 内存信息（单位：GB，保留2位小数）
      total_gb: +(total / 1024 / 1024 / 1024).toFixed(2),
      used_gb: +(used / 1024 / 1024 / 1024).toFixed(2),
      usage_percent: total ? +((used / total) * 100).toFixed(2) : 0,  // 内存使用率

      // Swap分区信息（单位：GB，保留2位小数）
      swap_total_gb: +(swapTotal / 1024 / 1024 / 1024).toFixed(2),
      swap_used_gb: +(swapUsed / 1024 / 1024 / 1024).toFixed(2),
      swap_percent: swapTotal ? +((swapUsed / swapTotal) * 100).toFixed(2) : 0  // Swap使用率
    };
  } catch (e) {
    // 异常兜底
    return {
      total_gb: 0,
      used_gb: 0,
      usage_percent: 0,
      swap_total_gb: 0,
      swap_used_gb: 0,
      swap_percent: 0
    };
  }
}

/**
 * 3. 获取磁盘分区使用情况
 * @returns {array} 所有有效磁盘分区的信息数组（过滤空分区）
 */
async function getDisk() {
  try {
    const fsList = await si.fsSize(); // 获取所有磁盘分区信息
    return fsList
      .filter(item => toNumber(item.size) > 0) // 过滤：只保留容量>0的有效分区
      .map(item => {
        const size = toNumber(item.size);     // 分区总大小
        const used = toNumber(item.used);     // 已用大小
        const avail = Math.max(0, size - used); // 可用大小
        return {
          dev: item.fs || item.type || '-',      // 设备名/文件系统类型
          size: formatBytes(size),               // 总大小（格式化）
          used: formatBytes(used),               // 已用大小（格式化）
          avail: formatBytes(avail),             // 可用大小（格式化）
          pcent: `${toNumber(item.use).toFixed(1)}%`, // 使用率
          mount: item.mount || item.fs || '-'    // 挂载点
        };
      });
  } catch (e) {
    return []; // 异常返回空数组
  }
}

/**
 * 4. 获取网络信息（核心：实时网速计算）
 * 包含：网卡名、总接收/发送字节数、实时上下行速度
 * 逻辑：优先用库自带网速，无数据时用【两次数据差值】计算
 * @returns {array} 网卡信息数组
 */
async function getNetwork() {
  try {
    const now = Date.now(); // 当前时间戳（用于计算时间差）
    const raw = await si.networkStats(); // 获取所有网卡原始数据

    // 过滤：排除回环网卡(lo/loopback)，只保留物理网卡
    const filtered = raw.filter(item => {
      const name = (item.iface || '').toLowerCase();
      return name && !name.startsWith('lo') && !name.includes('loopback');
    });

    // 有过滤后的物理网卡就用，没有就用原始数据
    const source = filtered.length ? filtered : raw;
    // 格式化网卡基础数据
    const currentList = source.map(item => ({
      interface: item.iface || '-',        // 网卡名称
      rx_bytes: toNumber(item.rx_bytes),   // 总接收字节数
      tx_bytes: toNumber(item.tx_bytes),   // 总发送字节数
      rx_sec: toNumber(item.rx_sec),       // 库自带的实时下载速度
      tx_sec: toNumber(item.tx_sec)        // 库自带的实时上传速度
    }));

    // 无网卡数据，直接返回空
    if (!currentList.length) {
      return [];
    }

    // 计算时间差：本次与上次获取数据的间隔（秒）
    const deltaTime = lastNetStats ? (now - lastNetStats.time) / 1000 : 0;
    // 计算最终网速数据
    const result = currentList.map(net => {
      let rxSpeed = net.rx_sec;
      let txSpeed = net.tx_sec;

      // 兼容逻辑：如果库没有返回实时速度，则用【差值法】计算
      if ((!rxSpeed && !txSpeed) && lastNetStats && deltaTime > 0) {
        // 从缓存中获取上一次该网卡的数据
        const old = lastNetStats.map.get(net.interface);
        if (old) {
          // 实时速度 = (本次总流量 - 上次总流量) / 时间差
          rxSpeed = Math.max(0, (net.rx_bytes - old.rx_bytes) / deltaTime);
          txSpeed = Math.max(0, (net.tx_bytes - old.tx_bytes) / deltaTime);
        }
      }

      return {
        interface: net.interface,
        rx_bytes: net.rx_bytes,    // 总接收流量
        tx_bytes: net.tx_bytes,    // 总发送流量
        rx_speed: Math.floor(Math.max(0, rxSpeed || 0)), // 实时下载速度（向下取整）
        tx_speed: Math.floor(Math.max(0, txSpeed || 0))  // 实时上传速度（向下取整）
      };
    });

    // 更新缓存：保存本次数据和时间，用于下一次计算网速
    lastNetStats = {
      time: now,
      map: new Map(currentList.map(item => [item.interface, item]))
    };

    return result;
  } catch (e) {
    return []; // 异常返回空数组
  }
}

/**
 * 5. 获取系统当前总进程数
 * @returns {number} 进程总数（失败返回0）
 */
async function getProcessCount() {
  try {
    const processes = await si.processes();
    return toNumber(processes.all);
  } catch (e) {
    return 0;
  }
}

/**
 * 6. 获取系统发行版信息（如 Ubuntu 22.04、Windows 11）
 * @returns {string} 系统版本字符串
 */
async function getOsRelease() {
  if (!osReleasePromise) {
    osReleasePromise = si.osInfo()
      .then(info => (info.distro && info.release
        ? `${info.distro} ${info.release}`
        : info.distro || os.platform()))
      .catch(() => os.platform());
  }
  return osReleasePromise;
}

/**
 * 7. 获取系统基础信息（同步函数）
 * 包含：主机名、内核版本、运行时间、系统架构
 * @returns {object} 系统基础信息
 */
function getSystem() {
  const uptime = os.uptime(); // 系统运行总秒数
  return {
    hostname: os.hostname(),       // 主机名
    kernel: os.release(),          // 内核版本
    uptime: uptime,                // 运行秒数（原始值）
    uptime_human: formatUptime(uptime), // 格式化运行时间
    arch: os.arch(),               // 系统架构（x64/arm64）
    platform: os.platform()        // 系统平台（win32/linux/darwin）
  };
}

/**
 * 最终汇总函数：并行获取所有系统信息
 * 用Promise.all并行请求，提升执行效率
 * 给后端server.js调用，通过SSE推送给前端展示
 * @returns {object} 完整的系统监控信息
 */
async function getSystemInfo() {
  // 有有效缓存时直接返回，避免短时间内重复调用昂贵的系统API
  if (_cache && Date.now() - _cacheTime < CACHE_TTL) {
    return _cache;
  }

  // 复用进行中的采集任务，避免多个请求同时触发重复的系统查询。
  if (!_cachePromise) {
    _cachePromise = collectSystemInfo().then(info => {
      _cache = info;
      _cacheTime = Date.now();
      return _cache;
    }).finally(() => {
      _cachePromise = null;
    });
  }

  return _cachePromise;
}

async function collectSystemInfo() {
  if (IS_LINUX) return getLinuxSystemInfo();

  const [cpu, memory, disk, network, process_count, os_release] = await Promise.all([
    getCpu(),
    getMemory(),
    getDisk(),
    getNetwork(),
    getProcessCount(),
    getOsRelease()
  ]);
  return {
    cpu,
    memory,
    disk,
    network,
    system: getSystem(),
    process_count,
    os_release,
    data_source: 'systeminformation 跨平台库'
  };
}

// 导出核心函数，供server.js调用
module.exports = { getSystemInfo };

// 调试入口：直接运行此文件时，自动打印格式化的系统信息
if (require.main === module) {
  getSystemInfo().then(info => {
    console.log(JSON.stringify(info, null, 2));
  });
}
