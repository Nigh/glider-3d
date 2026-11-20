import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const url = process.env.PERF_URL || 'http://127.0.0.1:5173';
const sampleMs = Number(process.env.PERF_SAMPLE_MS || 4000);
const longMs = Number(process.env.PERF_LONG_MS || sampleMs * 3);
const warmupMs = Number(process.env.PERF_WARMUP_MS || 500);
const resetMs = Number(process.env.PERF_RESET_MS || Math.max(5000, longMs / 2));
const output = path.resolve(process.env.PERF_OUTPUT || 'docs/performance-results.json');
for (const [key, value] of Object.entries({ sampleMs, longMs, resetMs })) {
  if (!Number.isFinite(value) || value < 1000) throw new Error(`${key} 必须是至少 1000 的毫秒数`);
}
if (!Number.isFinite(warmupMs) || warmupMs < 0) throw new Error('PERF_WARMUP_MS 必须是非负毫秒数');

const remote = Boolean(process.env.CDP_URL);
const browser = remote
  ? await chromium.connectOverCDP(process.env.CDP_URL)
  : await chromium.launch({ headless: process.env.HEADED !== '1' });
const contextOptions = { viewport: { width: 1440, height: 1000 }, locale: 'zh-CN' };
let context = await browser.newContext(contextOptions);
let page = await context.newPage();
page.setDefaultTimeout(10_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const results = {
  schemaVersion: 3,
  measuredAt: new Date().toISOString(),
  url,
  configuration: { sampleMs, longMs, warmupMs, resetMs, connection: remote ? 'existing-CDP-browser' : 'local-Chromium', headless: remote ? null : process.env.HEADED !== '1' },
  environment: null,
  methodology: {
    frameSource: 'Independent requestAnimationFrame timestamps in the visible application page; not application FPS metrics',
    fps: 'Observed rAF callbacks / actual elapsed window; includes initial and terminal callback gaps',
    percentiles: 'Nearest-rank percentiles of measured rAF frame intervals, milliseconds',
    renderMs: 'CPU time around renderer.render submission, NOT GPU execution duration',
    geometryMs: 'CPU time of the most recent aircraft geometry update; repeated samples do not imply new work',
    physicsMs: 'Most recent completed physics step CPU time, sampled from telemetry',
    longTasks: 'Main-thread tasks of at least 50 ms, observed with PerformanceObserver; excludes Worker computation',
    simulationProgress: 'Wind-tunnel simulated seconds / actual wall seconds; null outside the tunnel or without the elapsedTime diagnostic',
    inputTrace: 'Fresh isolated context per scenario; fixed planned editing trajectories and counts; measurement includes completion of the full input trace',
    gpuTimeMs: null,
    memory: 'Application metrics.memory estimates GPU resources in MiB; performance.memory is optional JS heap in bytes, not total process or GPU memory',
    processMemory: 'Linux whole-browser PSS/RSS through CDP and /proc, including resident WASM; RSS counts shared pages repeatedly; not app-only or dedicated GPU memory',
    deviceValidation: 'Desktop browsers only. Local runs use a 1440 × 1000 viewport; attached CDP browsers do not establish mobile support.',
  },
  scenarios: [],
  pageErrors,
};

let entryTimesMs = [];
async function design() {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '鸟人间挑战' }).click();
  await page.waitForFunction(() => window.glider?.state === 'design');
}
async function flight() {
  const started = performance.now();
  await page.getByRole('button', { name: '前往挑战' }).click();
  await page.waitForFunction(() => window.glider?.state === 'flight');
  await page.getByRole('button', { name: '开始试飞', exact: true }).click();
  await page.waitForFunction(() => window.glider.flightReady && window.glider.time > 0);
  entryTimesMs.push(performance.now() - started);
}
async function windTunnel() {
  await page.getByRole('button', { name: '风洞', exact: true }).click();
  await page.waitForFunction(() => window.glider?.laboratory?.mode === 'wind-tunnel');
  await page.getByRole('button', { name: '开启风洞', exact: true }).click();
  await page.waitForFunction(() => Math.abs(window.glider.laboratory.wind.speed - 10) < 0.05, undefined, { timeout: 60000 });
}
async function heapSnapshot() {
  return page.evaluate(() => {
    const memory = performance.memory;
    return memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null;
  });
}
async function browserMemory() {
  if (os.platform() !== 'linux') return { unavailable: 'Process memory sampling requires Linux /proc' };
  let session;
  try {
    session = await browser.newBrowserCDPSession();
    const { processInfo } = await session.send('SystemInfo.getProcessInfo');
    const processes = await Promise.all(processInfo.map(async ({ id, type }) => {
      try {
        const status = await readFile(`/proc/${id}/status`, 'utf8'), rss = status.match(/^VmRSS:\s+(\d+)\s+kB$/m);
        const record = { type, rssBytes: rss ? Number(rss[1]) * 1024 : null, pssBytes: null };
        try {
          const rollup = await readFile(`/proc/${id}/smaps_rollup`, 'utf8'), pss = rollup.match(/^Pss:\s+(\d+)\s+kB$/m);
          record.pssBytes = pss ? Number(pss[1]) * 1024 : null;
        } catch (error) { record.pssUnavailable = String(error); }
        return record;
      } catch (error) { return { type, unavailable: String(error) }; }
    }));
    const sum = key => processes.every(record => Number.isFinite(record[key])) ? processes.reduce((total, record) => total + record[key], 0) : null;
    return { rssBytes: sum('rssBytes'), pssBytes: sum('pssBytes'), processes };
  } catch (error) { return { unavailable: String(error) }; }
  finally { await session?.detach(); }
}

async function inputTrace(deadline, rate, action) {
  const started = performance.now(), duration = Math.max(0, deadline - started), count = Math.max(1, Math.round(sampleMs * rate / 1000));
  for (let index = 0; index < count; index++) {
    const wait = started + index * duration / count - performance.now();
    if (wait > 0) await page.waitForTimeout(wait);
    await action(index);
  }
  await page.waitForTimeout(Math.max(0, deadline - performance.now()));
  return count;
}

async function keepFlying(deadline, resets = false) {
  let count = 0, lastReset = performance.now();
  while (performance.now() < deadline) {
    const state = await page.evaluate(() => window.glider.state);
    if (state === 'result') {
      await page.getByRole('button', { name: '再试一次', exact: true }).click();
      count++; lastReset = performance.now();
      await page.getByRole('button', { name: '开始试飞', exact: true }).click();
    } else if (resets && performance.now() - lastReset >= resetMs) {
      await page.getByRole('button', { name: '返回设计', exact: true }).click();
      await flight();
      count++; lastReset = performance.now();
    }
    await page.waitForTimeout(100);
  }
  return { resets: count };
}

// This collector owns only local instrumentation. It never writes window.glider or application state.
function collectFrames() {
  return new Promise(resolve => {
    const intervals = [], samples = [];
    const started = performance.now();
    const simulationStarted = window.glider.laboratory?.mode === 'wind-tunnel' ? window.glider.elapsedTime : null;
    const longTasks = [];
    const recordLongTasks = entries => {
      for (const entry of entries) if (entry.startTime >= started) longTasks.push({ startMs: entry.startTime - started, durationMs: entry.duration });
    };
    const observer = typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes.includes('longtask')
      ? new PerformanceObserver(list => recordLongTasks(list.getEntries())) : null;
    observer?.observe({ type: 'longtask' });
    let previous = null, firstFrameLatencyMs = null, frameCount = 0, lastSample = -Infinity, request = 0, hiddenFrames = 0;
    const snapshot = now => {
      const heap = performance.memory;
      samples.push({ elapsedMs: now - started, state: window.glider.state, metrics: { ...window.glider.metrics },
        jsHeap: heap ? { usedJSHeapSize: heap.usedJSHeapSize, totalJSHeapSize: heap.totalJSHeapSize, jsHeapSizeLimit: heap.jsHeapSizeLimit } : null });
    };
    const finish = () => {
      cancelAnimationFrame(request);
      Reflect.deleteProperty(window, '__gliderPerformanceStop');
      const ended = performance.now();
      snapshot(ended);
      if (observer) { recordLongTasks(observer.takeRecords()); observer.disconnect(); }
      const simulationEnded = window.glider.laboratory?.mode === 'wind-tunnel' ? window.glider.elapsedTime : null;
      const simulatedSeconds = Number.isFinite(simulationStarted) && Number.isFinite(simulationEnded) && simulationEnded >= simulationStarted
        ? simulationEnded - simulationStarted : null;
      resolve({ intervalsMs: intervals, samples, longTasks: observer ? longTasks : null, elapsedMs: ended - started, frameCount, firstFrameLatencyMs,
        tailGapMs: ended - (previous ?? started), hiddenFrames, visibilityAtEnd: document.visibilityState,
        simulationProgress: { simulatedSeconds, wallSeconds: (ended - started) / 1000,
          simulatedSecondsPerWallSecond: simulatedSeconds === null ? null : simulatedSeconds * 1000 / (ended - started) } });
    };
    const tick = now => {
      frameCount++;
      if (firstFrameLatencyMs === null) firstFrameLatencyMs = now - started;
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (document.hidden) hiddenFrames++;
      if (now - lastSample >= 250) { snapshot(now); lastSample = now; }
      request = requestAnimationFrame(tick);
    };
    Reflect.set(window, '__gliderPerformanceStop', finish);
    request = requestAnimationFrame(tick);
  });
}

try {
  await design();
  const environment = await page.evaluate(() => {
    const canvas = document.querySelector('.scene canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return {
      userAgent: navigator.userAgent, platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGB: navigator.deviceMemory ?? null,
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      screen: { width: screen.width, height: screen.height },
      touchPoints: navigator.maxTouchPoints, visibility: document.visibilityState,
      webgl: gl ? { version: gl.getParameter(gl.VERSION), shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
        vendor: gl.getParameter(gl.VENDOR), renderer: gl.getParameter(gl.RENDERER),
        unmaskedVendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
        unmaskedRenderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
        gpuTimerQuerySupported: Boolean(gl.getExtension('EXT_disjoint_timer_query_webgl2') || gl.getExtension('EXT_disjoint_timer_query')) } : null,
    };
  });
  let gpu = null;
  try {
    const session = await browser.newBrowserCDPSession();
    gpu = (await session.send('SystemInfo.getInfo')).gpu;
    await session.detach();
  } catch (error) {
    gpu = { unavailable: String(error) };
  }
  results.environment = { ...environment, browserVersion: browser.version(), browserGpu: gpu,
    runner: { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem() } };

  const scenarios = [
    { id: 'default-flight', name: '默认飞机飞行', setup: flight, action: deadline => keepFlying(deadline) },
    { id: 'maximum-span-flight', name: '最大翼展 24 m 飞行', setup: async () => {
      await page.getByRole('tab', { name: '主翼', exact: true }).click();
      await page.getByText('精确编辑四个顶点', { exact: true }).click();
      const input = page.getByRole('spinbutton', { name: '顶点2展向坐标', exact: true });
      await input.fill('12'); await input.press('Tab');
      await page.waitForFunction(() => window.glider.aircraft.mainWing.points[1].y === 12);
      await flight();
    }, action: deadline => keepFlying(deadline) },
    { id: 'continuous-orbit', name: '三维相机连续旋转', action: async deadline => {
      const viewport = page.viewportSize() || await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
      const x = viewport.width * 0.72, y = viewport.height * 0.45;
      let moves = 0;
      await page.mouse.move(x, y); await page.mouse.down();
      try {
        moves = await inputTrace(deadline, 60, index => page.mouse.move(x + Math.sin(index * 0.2) * 95, y + Math.cos(index * 0.2) * 60));
      } finally { await page.mouse.up(); }
      return { pointerMoves: moves };
    } },
    { id: 'continuous-wing-drag', name: '主翼控制点连续拖动', action: async deadline => {
      const handle = page.getByRole('button', { name: '主翼顶点2', exact: true });
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      if (!box) throw new Error('主翼控制点不可见');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      let moves = 0;
      await page.mouse.move(x, y); await page.mouse.down();
      try {
        moves = await inputTrace(deadline, 30, index => page.mouse.move(x + Math.sin(index * 0.15) * 16, y + Math.cos(index * 0.15) * 5));
      } finally { await page.mouse.up(); }
      return { pointerMoves: moves };
    } },
    { id: 'flight-entry-exit', name: '反复进入和退出飞行', action: async deadline => {
      const cycles = await inputTrace(deadline, 1, async () => {
        await flight();
        await page.getByRole('button', { name: '返回设计', exact: true }).click();
      });
      return { cycles };
    } },
    { id: 'geometry-create-dispose', name: '模型反复几何生成与释放', action: async deadline => {
      const rebuilds = await inputTrace(deadline, 2, async index => {
        const incidence = page.getByRole('spinbutton', { name: '主翼安装角精确值', exact: true });
        await incidence.fill(String(index % 2 ? 5 : 6));
        await incidence.press('Tab');
      });
      return { rebuilds };
    } },
    { id: 'wind-tunnel-steady', name: '风洞稳定气流', setup: windTunnel, action: async deadline => {
      await page.waitForTimeout(Math.max(0, deadline - performance.now()));
      return {};
    } },
    { id: 'wind-tunnel-live-edit', name: '风洞安装角连续修改', setup: windTunnel, action: async deadline => {
      let lastAngle = 0;
      const edits = await inputTrace(deadline, 2, async index => {
        lastAngle = index % 2 ? 6 : 9;
        await page.getByRole('spinbutton', { name: '主翼安装角数值', exact: true }).fill(String(lastAngle));
        await page.getByRole('spinbutton', { name: '主翼安装角数值', exact: true }).press('Tab');
      });
      await page.waitForFunction(target => Math.abs(window.glider.laboratory.wind.mainIncidence - target) < 1e-5, lastAngle, { timeout: 60000 });
      return { edits };
    } },
    { id: 'long-flight-reset', name: '长时间飞行并重置', duration: longMs, setup: flight, action: deadline => keepFlying(deadline, true) },
  ];

  for (const scenario of scenarios) {
    const errorStart = pageErrors.length;
    entryTimesMs = [];
    try {
      await context.close();
      context = await browser.newContext(contextOptions);
      page = await context.newPage();
      page.setDefaultTimeout(10_000);
      page.on('pageerror', error => pageErrors.push(error.message));
      await design();
      await scenario.setup?.();
      await page.bringToFront();
      await page.waitForTimeout(warmupMs);
      const before = await heapSnapshot();
      const processMemoryBefore = await browserMemory();
      const aircraft = await page.evaluate(() => window.glider.aircraft);
      const duration = scenario.duration || sampleMs;
      const pending = page.evaluate(collectFrames);
      // Awaiting this read ensures instrumentation starts before the first interaction.
      await page.evaluate(() => performance.now());
      const interactionStarted = performance.now();
      const action = (async () => {
        try {
          const operations = await scenario.action(performance.now() + duration);
          return { operations, elapsedMs: performance.now() - interactionStarted };
        } finally {
          await page.evaluate(() => Reflect.get(window, '__gliderPerformanceStop')());
        }
      })();
      const [interaction, measurement] = await Promise.all([action, pending]);
      const after = await heapSnapshot();
      const processMemoryAfter = await browserMemory();
      const aircraftAfter = await page.evaluate(() => window.glider.aircraft);
      const sorted = [...measurement.intervalsMs].sort((a, b) => a - b);
      if (sorted.length < 2) throw new Error('rAF 样本不足；检查标签页可见性和浏览器渲染环境');
      const mean = measurement.intervalsMs.reduce((sum, value) => sum + value, 0) / sorted.length;
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
      const averageFps = measurement.frameCount * 1000 / measurement.elapsedMs;
      results.scenarios.push({ id: scenario.id, name: scenario.name, requestedDurationMs: duration, aircraft, aircraftAfter,
        operations: interaction.operations, interactionElapsedMs: interaction.elapsedMs, entryTimesMs,
        frames: { count: measurement.frameCount, intervalCount: sorted.length, averageFps, meanMs: mean, p95Ms: p95, p99Ms: p99, minMs: sorted[0], maxMs: sorted.at(-1) },
        heapBefore: before, heapAfter: after,
        processMemoryBefore, processMemoryAfter,
        heapUsedDeltaBytes: before && after ? after.usedJSHeapSize - before.usedJSHeapSize : null,
        ...measurement, errors: pageErrors.slice(errorStart) });
      console.log(`${scenario.id}: ${averageFps.toFixed(1)} FPS, P95 ${p95.toFixed(2)} ms, P99 ${p99.toFixed(2)} ms`);
    } catch (error) {
      results.scenarios.push({ id: scenario.id, name: scenario.name, error: String(error), errors: pageErrors.slice(errorStart) });
      process.exitCode = 1;
      console.error(`${scenario.id}: ${String(error)}`);
    }
  }
} catch (error) {
  results.error = String(error);
  process.exitCode = 1;
} finally {
  if (pageErrors.length) process.exitCode = 1;
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(results, null, 2) + '\n');
  console.log(`真实测量记录：${output}`);
  await context.close();
  await browser.close();
}
