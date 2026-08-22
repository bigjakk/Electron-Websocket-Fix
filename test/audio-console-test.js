// Paste this whole file into KCC's DevTools console, click back into the game,
// then press F8. Run kccAudioLatencyTest.stop() to remove the test.
(() => {
  const previous = globalThis.kccAudioLatencyTest;
  if (previous?.stop) previous.stop();

  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AudioContext) throw new Error('Web Audio is not available on this page.');

  const context = new AudioContext({ latencyHint: 'interactive' });
  let stopped = false;

  const milliseconds = (seconds) =>
    Number.isFinite(seconds) ? Number((seconds * 1000).toFixed(3)) : 'unavailable';

  const report = () => {
    const timestamp = context.getOutputTimestamp?.();
    const metrics = {
      state: context.state,
      sampleRateHz: context.sampleRate,
      renderQuantumMs: milliseconds(128 / context.sampleRate),
      baseLatencyMs: milliseconds(context.baseLatency),
      outputLatencyMs: milliseconds(context.outputLatency),
      outputContextTimeMs: milliseconds(timestamp?.contextTime),
      outputPerformanceTimeMs: Number.isFinite(timestamp?.performanceTime)
        ? Number(timestamp.performanceTime.toFixed(3))
        : 'unavailable',
    };
    console.table(metrics);
    return metrics;
  };

  const click = async () => {
    if (stopped) return;
    if (context.state !== 'running') await context.resume();

    const now = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1200;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.026);
  };

  const onKeyDown = (event) => {
    if (event.code !== 'F8' || event.repeat) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    void click();
  };

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    globalThis.removeEventListener('keydown', onKeyDown, true);
    await context.close();
    delete globalThis.kccAudioLatencyTest;
    console.info('[KCC audio test] stopped');
  };

  globalThis.addEventListener('keydown', onKeyDown, true);
  globalThis.kccAudioLatencyTest = { click, report, stop };

  console.info('[KCC audio test] Ready. Click the game, then press F8 for a 25 ms tone.');
  console.info('[KCC audio test] Compare separate app launches with the setting off and on.');
  console.info('[KCC audio test] Browser metrics are useful for A/B checks but are not a physical loopback measurement.');
  report();
})();
