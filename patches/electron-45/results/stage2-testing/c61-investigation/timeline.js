const { readTraceEvents } = require('C:/projects/Electron-Websocket-Fix/test/perfetto-trace');
const ev = readTraceEvents(process.argv[2]);
const r = require(process.argv[3]);
const rp = r.latency.renderer, gp = r.latency.gpu;
const want = new Set(['Scheduler::BeginImplFrame', 'ProxyMain::BeginMainFrame', 'ProxyImpl::ScheduledActionDraw', 'LayerTreeHostImpl::DidReceiveCompositorFrameAck', 'Scheduler::OnBeginImplFrameDeadline',
  'SendBeginFrameDecision', 'DisplayScheduler::BeginFrame', 'DisplayScheduler::OnBeginFrameDeadline', 'DisplayScheduler::DrawAndSwap', 'Swap throttled', 'DisplayScheduler::ScheduleBeginFrameDeadline',
  'CompositorFrameSinkSupport::SubmitCompositorFrame', 'CompositorFrameSinkSupport::DidReceiveCompositorFrameAck', 'Display::DidReceiveSwapBuffersAck', 'DisplayScheduler::DidReceiveSwapBuffersAck']);
const sel = ev.filter((e) => want.has(e.name) && (e.pid === rp || e.pid === gp)).sort((a, b) => a.ts - b.ts);
const mid = sel[Math.floor(sel.length / 2)].ts;
const from = parseFloat(process.argv[4] || '0');
const win = sel.filter((e) => e.ts >= mid + from && e.ts < mid + from + 30000);
const t0 = win.length ? win[0].ts : 0;
for (const e of win) {
  const who = e.pid === rp ? 'R' : 'G';
  const extra = e.name === 'SendBeginFrameDecision' ? ` ${e.args.reason}` : (e.name === 'Swap throttled' ? '' : '');
  console.log(`${((e.ts - t0) / 1000).toFixed(3).padStart(8)} ms ${who} ${e.ph} ${(e.dur / 1000).toFixed(3).padStart(6)}  ${e.name}${extra}`);
}
const names = {}; for (const e of ev) if (e.pid === gp || e.pid === rp) names[e.name] = (names[e.name] || 0) + 1;
console.error('distinct names (top 40):', Object.entries(names).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([k, v]) => `${k}=${v}`).join(' | '));
