const fs = require('fs').promises;
const os = require('os');
const { execFile } = require('child_process');
const { promisify } = require('util');

const execFileAsync = promisify(execFile);
const KB = 1024;
const MB = KB * 1024;
const GB = MB * 1024;
const pseudoFilesystems = new Set([
  'autofs', 'cgroup', 'cgroup2', 'configfs', 'debugfs', 'devpts', 'devtmpfs',
  'fusectl', 'mqueue', 'proc', 'pstore', 'securityfs', 'sysfs', 'tmpfs'
]);

let lastCpuStats = null;
let lastNetStats = null;
let osReleasePromise = null;

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatBytes(bytes) {
  const units = ['B', 'K', 'M', 'G', 'T', 'P'];
  let value = Math.max(0, toNumber(bytes));
  let index = 0;
  while (value >= KB && index < units.length - 1) {
    value /= KB;
    index += 1;
  }
  const digits = value >= 10 || index === 0 ? 0 : 1;
  return `${value.toFixed(digits)}${units[index]}`;
}

function formatUptime(seconds) {
  const safe = Math.max(0, Math.floor(toNumber(seconds)));
  return `${Math.floor(safe / 3600)}h ${Math.floor((safe % 3600) / 60)}m`;
}

async function readProc(file) {
  try {
    return await fs.readFile(file, 'utf8');
  } catch {
    return '';
  }
}

function parseMeminfo(data) {
  const values = {};
  for (const line of data.split('\n')) {
    const match = line.match(/^([^:]+):\s*(\d+)/);
    if (match) values[match[1]] = Number(match[2]);
  }
  return values;
}

async function getCpu() {
  const data = await readProc('/proc/stat');
  const fields = data.split('\n')[0]?.trim().split(/\s+/).slice(1).map(Number) || [];
  const safeFields = fields.map(value => (Number.isFinite(value) ? value : 0));
  const idle = (safeFields[3] || 0) + (safeFields[4] || 0);
  const total = safeFields.slice(0, 8).reduce((sum, value) => sum + value, 0);
  const busy = Math.max(0, total - idle);
  let usage = 0;

  if (lastCpuStats) {
    const totalDelta = total - lastCpuStats.total;
    const busyDelta = busy - lastCpuStats.busy;
    usage = totalDelta > 0 ? (busyDelta / totalDelta) * 100 : 0;
  }
  lastCpuStats = { total, busy };

  const load = os.loadavg();
  return {
    usage: +usage.toFixed(2),
    cores: os.cpus().length,
    load_1m: +toNumber(load[0]).toFixed(2),
    load_5m: +toNumber(load[1]).toFixed(2),
    load_15m: +toNumber(load[2]).toFixed(2)
  };
}

async function getMemory() {
  const values = parseMeminfo(await readProc('/proc/meminfo'));
  const total = toNumber(values.MemTotal) * KB;
  const availableKb = values.MemAvailable ?? (
    toNumber(values.MemFree) + toNumber(values.Buffers) + toNumber(values.Cached)
      + toNumber(values.SReclaimable) - toNumber(values.Shmem)
  );
  const available = Math.max(0, toNumber(availableKb) * KB);
  const used = Math.max(0, total - available);
  const swapTotal = toNumber(values.SwapTotal) * KB;
  const swapFree = toNumber(values.SwapFree) * KB;
  const swapUsed = Math.max(0, swapTotal - swapFree);

  return {
    total_gb: +(total / GB).toFixed(2),
    used_gb: +(used / GB).toFixed(2),
    usage_percent: total ? +((used / total) * 100).toFixed(2) : 0,
    swap_total_gb: +(swapTotal / GB).toFixed(2),
    swap_used_gb: +(swapUsed / GB).toFixed(2),
    swap_percent: swapTotal ? +((swapUsed / swapTotal) * 100).toFixed(2) : 0
  };
}

function unescapeMount(value) {
  return value.replace(/\\([0-7]{3})/g, (_, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function parseMounts(data) {
  const mounts = [];
  const seen = new Set();
  for (const line of data.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)\s+(\S+)/);
    if (!match) continue;
    const device = unescapeMount(match[1]);
    const mount = unescapeMount(match[2]);
    const filesystem = match[3];
    const isRoot = mount === '/';
    if ((!isRoot && !device.startsWith('/dev/')) || (!isRoot && pseudoFilesystems.has(filesystem))) continue;
    if (seen.has(mount)) continue;
    seen.add(mount);
    mounts.push({ device, mount, filesystem });
  }
  return mounts.sort((left, right) => {
    if (left.mount === '/') return -1;
    if (right.mount === '/') return 1;
    return left.mount.localeCompare(right.mount);
  });
}

function makeDisk(device, mount, stats) {
  const blockSize = toNumber(stats.bsize);
  const total = blockSize * toNumber(stats.blocks);
  const free = blockSize * toNumber(stats.bfree);
  const available = blockSize * toNumber(stats.bavail);
  const used = Math.max(0, total - free);
  const percent = total ? (used / (used + available)) * 100 : 0;
  return {
    dev: device || '-',
    size: formatBytes(total),
    used: formatBytes(used),
    avail: formatBytes(available),
    pcent: `${percent.toFixed(1)}%`,
    mount: mount || '-'
  };
}

async function getDiskWithStatfs() {
  if (typeof fs.statfs !== 'function') return [];
  const mounts = parseMounts(await readProc('/proc/self/mounts'));
  const result = [];
  for (const item of mounts) {
    try {
      const stats = await fs.statfs(item.mount);
      result.push(makeDisk(item.device, item.mount, stats));
    } catch {
      // A disappearing mount should not invalidate the other disks.
    }
  }
  return result;
}

async function getDiskWithDf() {
  try {
    const { stdout } = await execFileAsync('df', ['-kP'], { maxBuffer: 1024 * 1024 });
    return stdout.split('\n').slice(1).flatMap(line => {
      const match = line.trim().match(/^(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
      if (!match || (!match[1].startsWith('/dev/') && match[6] !== '/')) return [];
      const total = Number(match[2]) * KB;
      const used = Number(match[3]) * KB;
      return [{
        dev: match[1],
        size: formatBytes(total),
        used: formatBytes(used),
        avail: formatBytes(Number(match[4]) * KB),
        pcent: `${match[5]}%`,
        mount: match[6]
      }];
    });
  } catch {
    return [];
  }
}

async function getDisk() {
  const nativeResult = await getDiskWithStatfs();
  return nativeResult.length ? nativeResult : getDiskWithDf();
}

async function getNetwork() {
  const data = await readProc('/proc/net/dev');
  const now = Date.now();
  const current = [];

  for (const line of data.split('\n').slice(2)) {
    const separator = line.indexOf(':');
    if (separator < 0) continue;
    const name = line.slice(0, separator).trim();
    if (!name || name === 'lo') continue;
    const values = line.slice(separator + 1).trim().split(/\s+/).map(Number);
    if (values.length < 10) continue;
    current.push({ interface: name, rx_bytes: toNumber(values[0]), tx_bytes: toNumber(values[8]) });
  }

  const previous = lastNetStats?.map || new Map();
  const deltaSeconds = lastNetStats ? Math.max(0.001, (now - lastNetStats.time) / 1000) : 0;
  const result = current.map(item => {
    const old = previous.get(item.interface);
    return {
      ...item,
      rx_speed: old ? Math.floor(Math.max(0, (item.rx_bytes - old.rx_bytes) / deltaSeconds)) : 0,
      tx_speed: old ? Math.floor(Math.max(0, (item.tx_bytes - old.tx_bytes) / deltaSeconds)) : 0
    };
  });
  lastNetStats = { time: now, map: new Map(current.map(item => [item.interface, item])) };
  return result;
}

async function getProcessCount() {
  try {
    const entries = await fs.readdir('/proc', { withFileTypes: true });
    return entries.filter(entry => entry.isDirectory() && /^\d+$/.test(entry.name)).length;
  } catch {
    return 0;
  }
}

async function getOsRelease() {
  if (!osReleasePromise) {
    osReleasePromise = readProc('/etc/os-release').then(data => {
      const line = data.split('\n').find(item => item.startsWith('PRETTY_NAME='));
      return line ? line.slice('PRETTY_NAME='.length).replace(/^(?:"(.*)"|'(.*)')$/, '$1$2') : 'Linux';
    });
  }
  return osReleasePromise;
}

function getSystem() {
  const uptime = os.uptime();
  return {
    hostname: os.hostname(),
    kernel: os.release(),
    uptime,
    uptime_human: formatUptime(uptime),
    arch: os.arch(),
    platform: os.platform()
  };
}

async function getLinuxSystemInfo() {
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
    data_source: 'Linux 原生接口 (/proc + statfs/df)'
  };
}

module.exports = { getLinuxSystemInfo };
