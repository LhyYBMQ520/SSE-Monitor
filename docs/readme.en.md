# SSE Real-Time System Monitor
### (This article was translated using Doubao AI. Please be aware that AI may make mistakes.)
A lightweight real-time monitoring system for Linux servers built with **Node.js + Express + SSE**. It delivers millisecond-level data pushes via Server-Sent Events (SSE), with no frontend polling required, low resource usage, and high real-time performance.

# Language Selection
[简体中文](../readme.md) | [繁體中文](readme.zh-TW.md) | [English](readme.en.md)

## From the Author
This is a little project I made while experimenting with SSE.

In its earliest version, it only did three things: push server time to the frontend, display local time on the client, and test connection latency — all of which are still preserved today.

As I worked on it, I realized: SSE long connections are *perfect* for pushing real-time server data to the browser.
So what should I push? The performance metrics I love checking, of course!

I often SSH into my VPS just to stare at `btop` and watch system stats. So I decided to build a tool that pushes those same btop-style metrics to a web dashboard — and this project was born.

The logic is really simple: read system info from native Linux interfaces, then push it to the frontend in real time via SSE. That’s it, haha 😂😂😂

Oh, and don’t be surprised by all the Chinese comments in the code — I had AI add them so I wouldn’t forget what everything does later.

## ✨ Features
- **Real-time data push**: SSE long connection with 500ms system metric updates
- **Comprehensive monitoring**: Full coverage of CPU, RAM, Swap, disk, network, and system info
- **Lightweight**: Pure native Node.js, no heavy dependencies, minimal server footprint
- **Out-of-the-box**: One command to start, no complicated setup
- **Clean web UI**: Simple, modern dashboard to view live stats
- **Stable & robust**: Full error handling and automatic reconnection on disconnect

## 📊 Monitored Metrics
| Module | Details |
|--------|---------|
| **CPU** | Usage percentage, core count, 1/5/15-minute system load |
| **Memory** | Total capacity, used/free, usage percentage |
| **Swap** | Swap partition usage & percentage |
| **Disk** | Mount point, usage percentage |
| **Network** | Real-time upload/download speed, total traffic, network interface info |
| **System** | Hostname, OS version, kernel version, uptime, process count |
| **Network** | SSE connection status |

## 🕒 Extra Features
- **Dual clock display**: Live server time via SSE + local client time
- **Real-time latency monitoring**: Automatic ping tests to show current server connection delay

## 🚀 Quick Start
### 1. Requirements
- Linux system (depends on `/proc` filesystem, Linux only)
- Node.js 22 (recommended; other versions untested)

### 2. Install & Run
```bash
# 1. Clone / download the project

# 2. Install dependencies
npm install

# 3. Start the server
npm start
```

### 3. Access the Dashboard
After starting, open in your browser:
```
http://your-server-ip:23456
```

## 🔧 Core Technologies
### 1. Server-Sent Events (SSE)
- HTML5 standard for server-to-client real-time data streaming
- Lighter than WebSocket, supports server→client one-way delivery only
- Native reconnection behavior ideal for monitoring

### 2. System Information Collection
- Reads real-time data from Linux `/proc` virtual filesystem
- CPU, memory, network, and process data from kernel interfaces for accuracy
- Disk info parsed from `df -h`, compatible with major Linux distributions

## ⚙️ Custom Configuration
### Change Server Port
Open `server.js` and modify the `PORT` constant:
```javascript
const PORT = 23456; // Change to your desired port
```

### Adjust Update Frequency
Comments in the code clearly mark where to change intervals — if you can read Chinese, you’ll figure it out 😉

## 📝 API Reference
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Serve the monitoring dashboard |
| `/api/ping` | POST | Latency test endpoint, measures round-trip time |
| `/sse/time` | GET | SSE stream for real-time server time |
| `/sse/system` | GET | SSE stream for real-time system monitoring data |

## 🛡️ Security & Stability
- All system commands wrapped in error handling to prevent crashes
- Timers cleaned up automatically on client disconnect to avoid memory leaks
- Frontend auto-reconnects if SSE drops
- Read-only system access — no writes, safe for production use

## 📌 Use Cases
- Personal Linux server real-time monitoring
- Small-scale service status visualization
- Teaching demo: SSE real-time communication & Node.js system operations
- Lightweight alternative to heavy monitoring suites

### ⚠️ Notes
- **Linux only**: Windows/macOS cannot read `/proc` files and will show incorrect data.

## 📄 License
This project is open source under the **MIT License**. You are free to use, modify, copy, and distribute it.
