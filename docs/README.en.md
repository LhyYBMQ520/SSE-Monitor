# SSE Real-Time System Monitor
### (This article was translated using AI. Please be aware that AI may make mistakes.)
A lightweight real-time monitoring system for Linux servers built with **Node.js + Express + SSE**. It delivers millisecond-level data pushes via Server-Sent Events (SSE), with no frontend polling required, low resource usage, and high real-time performance.

# Language Selection
[简体中文](../README.md) | [繁體中文](README.zh-TW.md) | [English](README.en.md)

## Author's Note
This is a small side project I made while experimenting with SSE.

Initially, the project only had three core features: server time push, local time display on the frontend, and connection latency testing — all of which are still fully retained today.

While developing, I suddenly realized that SSE long connections are inherently perfect for pushing real-time server data to the frontend. So what data should I push? Naturally, the system performance metrics I always keep an eye on!

I often log into my VPS via SSH and just leave `btop` running to monitor system status. That inspired me to build a feature to deliver btop-style system monitoring metrics via push, and this project was born.

The overall logic is actually very straightforward: the backend automatically collects system information according to the operating system platform, then sends real-time data to the frontend through the SSE protocol for display. That’s all 😂😂😂

## ✨ Project Features
- **Real-time Data Push**: SSE long connection based, delivering system data instantly
- **Comprehensive Metrics**: Full coverage of CPU, Memory, Swap, Disk, Network and system information
- **Low Resource Usage**: Built with pure native Node.js, no heavy dependencies, ultra-low server consumption
- **Out-of-the-Box**: One-click startup without complicated configuration
- **Visual Dashboard**: Clean and elegant web frontend to view all monitoring data in real time
- **Stable & Reliable**: Complete exception handling, automatic reconnection after disconnection

## 📊 Monitoring Metrics
| Module | Monitoring Content |
|--------|--------------------|
| **CPU** | Usage, core count, 1/5/15-minute load average (fixed to 0 on Windows) |
| **Memory** | Total capacity, used/free space, usage percentage |
| **Swap** | Swap partition usage and utilization rate |
| **Disk** | Mount points & disk usage |
| **Network** | Real-time upload/download speed, total traffic, network adapter info |
| **System** | Hostname, OS version, kernel version, uptime, process count |
| **Connection** | SSE connection status |

## 🕒 Extra Highlights
- **Dual Clock Display**: SSE pushes server time in real time; shows both server time and local time accurately
- **Real-time Latency Monitor**: Automatic ping test to display current server connection delay

## 🚀 Quick Start
### 1. Requirements
- Windows / Linux / Mac (Mac untested)
- Node.js 22+ (recommended, lower versions not tested)

### 2. Install & Run
```bash
# 1. Clone the project
git clone https://github.com/LhyYBMQ520/SSE-Monitor.git

# 2. Install dependencies
npm install

# 3. Start the service
npm start
```

### 3. Access
After startup, open your browser and visit:
```
IP:23456
```
You will see the real-time monitoring dashboard.

## 🔧 Core Technology
### 1. Server-Sent Events (SSE)
- An HTML5 technology that enables servers to actively push real-time data to clients
- Lighter than WebSocket, with one-way transmission (server → client only)
- Native disconnection and auto-reconnection, ideal for monitoring scenarios

### 2. System Data Collection
- Cross-platform system info collection powered by `systeminformation`
- Auto-adapts to Windows / Linux / Mac with no manual configuration
- Unified output of CPU, memory, swap, disk, network, process and OS details

## ⚙️ Custom Configuration
### Change Service Port
Open `server.js` and modify the `PORT` constant:
```javascript
const PORT = 23456; // Replace with your desired port
```

### Adjust Push Interval
Comments are clearly written in the source code. You can easily find and modify the corresponding parameters.

## 📝 API Documentation
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Return frontend monitoring page |
| `/api/ping` | POST | Latency test interface for network calculation |
| `/sse/time` | GET | SSE real-time time stream |
| `/sse/system` | GET | SSE system monitoring data stream |

## 🛡️ Security & Stability
- Full exception catching for all system operations to prevent service crashes
- Timers are automatically cleared on client disconnect to avoid memory leaks
- Frontend SSE auto-reconnection ensures continuous monitoring
- Read-only system information access, no write operations, completely safe

### ⚠️ Notice
- Network speed may show `0` on the first sampling; it will work normally from the second round.

## 📄 License
This project is open-sourced under the **MIT License**.
Free to use, modify, copy and distribute.
