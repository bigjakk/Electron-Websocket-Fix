const { app, BrowserWindow } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// Filter out Electron/Chromium flags (e.g. --no-sandbox) from argv to find app args
const appArgs = process.argv.slice(1).filter(a => !a.startsWith('-'));
// appArgs[0] is the script path, rest are user arguments
const PORT = parseInt(appArgs[1] || '8085');
const LABEL = appArgs[2] || 'TEST';
const TEST_DURATION_MS = 12000;
const WARMUP_MS = 3000;

app.commandLine.appendSwitch('disable-frame-rate-limit');
app.commandLine.appendSwitch('disable-gpu-vsync');

// Server
const server = http.createServer((req, res) => {
    const filePath = path.join(__dirname, 'stress.html');
    fs.readFile(filePath, (err, data) => {
        if (err) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data);
    });
});
const wss = new WebSocketServer({ server });
wss.on('connection', (ws) => {
    console.log(`[${LABEL}] WS client connected`);
    const interval = setInterval(() => {
        if (ws.readyState === ws.OPEN) {
            ws.send(JSON.stringify({ t: performance.now() }));
        }
    }, 16);
    ws.on('close', () => clearInterval(interval));
});
server.listen(PORT, () => console.log(`[${LABEL}] Server on port ${PORT}`));

app.whenReady().then(async () => {
    const win = new BrowserWindow({
        width: 900, height: 700, show: true,
        webPreferences: { nodeIntegration: false, contextIsolation: true }
    });

    await win.loadURL('http://localhost:' + PORT);
    const wc = win.webContents;

    // Attach to debugger for CDP input dispatch
    wc.debugger.attach('1.3');
    console.log(`[${LABEL}] CDP debugger attached`);

    await new Promise(r => setTimeout(r, WARMUP_MS));
    await wc.executeJavaScript('wsLatencies = []; void 0;');

    console.log(`[${LABEL}] Starting ${TEST_DURATION_MS/1000}s stress test — CDP Input.dispatchMouseEvent...`);

    const startTime = Date.now();
    let eventCount = 0;
    let angle = 0;
    const centerX = 450, centerY = 350;

    // Initial mouse down via CDP
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mousePressed',
        x: centerX, y: centerY,
        button: 'left',
        clickCount: 1
    });
    eventCount++;

    // Flood with mouseMoved events via CDP
    // CDP dispatches go through the full Chromium input pipeline
    const flood = async () => {
        while (Date.now() - startTime < TEST_DURATION_MS) {
            const promises = [];
            for (let i = 0; i < 10; i++) {
                angle += 0.03;
                const radius = 100 + Math.sin(angle * 0.5) * 60;
                const x = Math.floor(centerX + Math.cos(angle) * radius);
                const y = Math.floor(centerY + Math.sin(angle) * radius);
                promises.push(
                    wc.debugger.sendCommand('Input.dispatchMouseEvent', {
                        type: 'mouseMoved',
                        x: x, y: y,
                        button: 'left',
                        buttons: 1
                    }).catch(() => {})
                );
                eventCount++;
            }
            await Promise.all(promises);
        }
    };

    await flood();

    // Release
    await wc.debugger.sendCommand('Input.dispatchMouseEvent', {
        type: 'mouseReleased',
        x: centerX, y: centerY,
        button: 'left'
    }).catch(() => {});

    await new Promise(r => setTimeout(r, 2000));

    // Collect
    const result = await wc.executeJavaScript(`
        (function() {
            if (!wsLatencies || wsLatencies.length === 0) return JSON.stringify({ error: 'no data' });
            const sorted = [...wsLatencies].sort((a,b) => a - b);
            const len = sorted.length;
            const avg = wsLatencies.reduce((a,b) => a+b, 0) / len;
            const p50 = sorted[Math.floor(len * 0.50)];
            const p75 = sorted[Math.floor(len * 0.75)];
            const p90 = sorted[Math.floor(len * 0.90)];
            const p95 = sorted[Math.floor(len * 0.95)];
            const p99 = sorted[Math.floor(len * 0.99)];
            const max = sorted[len - 1];
            const min = sorted[0];
            const over50 = wsLatencies.filter(x => x > 50).length;
            const over100 = wsLatencies.filter(x => x > 100).length;
            const over200 = wsLatencies.filter(x => x > 200).length;
            const over500 = wsLatencies.filter(x => x > 500).length;
            const mouseEvents = typeof moveCount !== 'undefined' ? moveCount : -1;
            const frames = typeof frameCount !== 'undefined' ? frameCount : -1;
            return JSON.stringify({ avg, min, p50, p75, p90, p95, p99, max, total: len, over50, over100, over200, over500, mouseEvents, frames });
        })()
    `);

    wc.debugger.detach();

    const d = JSON.parse(result);
    if (d.error) {
        console.log(`[${LABEL}] ERROR: ${d.error}`);
        process.exit(2);
    }

    console.log(`\\n[${LABEL}] ============ RESULTS ============`);
    console.log(`[${LABEL}] CDP events sent: ${eventCount}`);
    console.log(`[${LABEL}] Mouse events received by renderer: ${d.mouseEvents}`);
    console.log(`[${LABEL}] RAF frames rendered: ${d.frames}`);
    console.log(`[${LABEL}] WS samples collected: ${d.total}`);
    console.log(`[${LABEL}]`);
    console.log(`[${LABEL}] WS inter-message latency (ms):`);
    console.log(`[${LABEL}]   min:  ${d.min.toFixed(1)}`);
    console.log(`[${LABEL}]   avg:  ${d.avg.toFixed(1)}`);
    console.log(`[${LABEL}]   p50:  ${d.p50.toFixed(1)}`);
    console.log(`[${LABEL}]   p75:  ${d.p75.toFixed(1)}`);
    console.log(`[${LABEL}]   p90:  ${d.p90.toFixed(1)}`);
    console.log(`[${LABEL}]   p95:  ${d.p95.toFixed(1)}`);
    console.log(`[${LABEL}]   p99:  ${d.p99.toFixed(1)}`);
    console.log(`[${LABEL}]   max:  ${d.max.toFixed(1)}`);
    console.log(`[${LABEL}]`);
    console.log(`[${LABEL}] Threshold violations:`);
    console.log(`[${LABEL}]   >50ms:  ${d.over50} / ${d.total} (${(d.over50/d.total*100).toFixed(1)}%)`);
    console.log(`[${LABEL}]   >100ms: ${d.over100} / ${d.total} (${(d.over100/d.total*100).toFixed(1)}%)`);
    console.log(`[${LABEL}]   >200ms: ${d.over200} / ${d.total} (${(d.over200/d.total*100).toFixed(1)}%)`);
    console.log(`[${LABEL}]   >500ms: ${d.over500} / ${d.total} (${(d.over500/d.total*100).toFixed(1)}%)`);
    console.log(`[${LABEL}] ==================================`);

    process.exit(0);
});
