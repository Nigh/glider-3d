import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
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
const context = remote ? browser.contexts()[0] : await browser.newContext({ viewport: { width: 1440, height: 1000 } });
if (!context) throw new Error('CDP 浏览器没有可连接的 context');
const page = remote ? context.pages()[0] || await context.newPage() : await context.newPage();
page.setDefaultTimeout(10_000);
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
const results = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  url,
  configuration: { sampleMs, longMs, warmupMs, resetMs, connection: remote ? 'existing-CDP-browser' : 'local-Chromium', headless: remote ? null : process.env.HEADED !== '1' },
  environment: null,
  methodology: {
    frameSource: 'Independent requestAnimationFrame timestamps in the visible application page; not application FPS metrics',
    fps: '1000 / mean(frameIntervalsMs)',
    percentiles: 'Nearest-rank percentiles of measured rAF frame intervals, milliseconds',
    renderMs: 'CPU time around renderer.render submission, NOT GPU execution duration',
    gpuTimeMs: null,
    memory: 'Application metrics.memory estimates GPU resources in MiB; performance.memory is optional JS heap in bytes, not total process or GPU memory',
    deviceValidation: 'Local desktop or attached CDP browser only. Viewport dimensions do not establish real-phone hardware validation.',
  },
  scenarios: [],
  pageErrors,
};

async function design() {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '开始设计' }).click();
  await page.waitForFunction(() => window.glider?.state === 'design');
}
async function flight() {
  await page.getByRole('button', { name: '前往挑战' }).click();
  await page.waitForFunction(() => window.glider?.state === 'flight');
}
async function heapSnapshot() {
  return page.evaluate(() => {
    const memory = performance.memory;
    return memory ? { usedJSHeapSize: memory.usedJSHeapSize, totalJSHeapSize: memory.totalJSHeapSize, jsHeapSizeLimit: memory.jsHeapSizeLimit } : null;
  });
}
async function keepFlying(deadline, resets = false) {
  let count = 0, lastReset = Date.now();
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => window.glider.state);
    if (state === 'result') {
      await page.getByRole('button', { name: '再试一次', exact: true }).click();
      count++; lastReset = Date.now();
    } else if (resets && Date.now() - lastReset >= resetMs) {
      await page.getByRole('button', { name: '返回设计', exact: true }).click();
      await flight();
      count++; lastReset = Date.now();
    }
    await page.waitForTimeout(100);
  }
  return { resets: count };
}

// This collector owns only local instrumentation. It never writes window.glider or application state.
function collectFrames(durationMs) {
  return new Promise(resolve => {
    const intervals = [], samples = [];
    const started = performance.now();
    let previous = null, lastSample = -Infinity, request = 0, hiddenFrames = 0;
    const snapshot = now => {
      const heap = performance.memory;
      samples.push({ elapsedMs: now - started, state: window.glider.state, metrics: { ...window.glider.metrics },
        jsHeap: heap ? { usedJSHeapSize: heap.usedJSHeapSize, totalJSHeapSize: heap.totalJSHeapSize, jsHeapSizeLimit: heap.jsHeapSizeLimit } : null });
    };
    const timer = setTimeout(() => {
      cancelAnimationFrame(request);
      snapshot(performance.now());
      resolve({ intervalsMs: intervals, samples, elapsedMs: performance.now() - started, hiddenFrames, visibilityAtEnd: document.visibilityState });
    }, durationMs);
    const tick = now => {
      if (previous !== null) intervals.push(now - previous);
      previous = now;
      if (document.hidden) hiddenFrames++;
      if (now - lastSample >= 250) { snapshot(now); lastSample = now; }
      request = requestAnimationFrame(tick);
    };
    // Timer controls duration even if a background tab stops receiving rAF callbacks.
    void timer;
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
        while (Date.now() < deadline) {
          await page.mouse.move(x + Math.sin(moves * 0.2) * 95, y + Math.cos(moves * 0.2) * 60);
          moves++;
        }
      } finally { await page.mouse.up(); }
      return { pointerMoves: moves };
    } },
    { id: 'continuous-wing-drag', name: '主翼控制点连续拖动', action: async deadline => {
      const handle = page.locator('.planform-editor circle[role="presentation"]').nth(1);
      await handle.scrollIntoViewIfNeeded();
      const box = await handle.boundingBox();
      if (!box) throw new Error('主翼控制点不可见');
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      let moves = 0;
      await page.mouse.move(x, y); await page.mouse.down();
      try {
        while (Date.now() < deadline) {
          await page.mouse.move(x + Math.sin(moves * 0.15) * 16, y + Math.cos(moves * 0.15) * 5);
          moves++;
        }
      } finally { await page.mouse.up(); }
      return { pointerMoves: moves };
    } },
    { id: 'flight-entry-exit', name: '反复进入和退出飞行', action: async deadline => {
      let cycles = 0;
      while (Date.now() < deadline) {
        await flight();
        await page.waitForTimeout(80);
        await page.getByRole('button', { name: '返回设计', exact: true }).click();
        cycles++;
      }
      return { cycles };
    } },
    { id: 'geometry-create-dispose', name: '模型反复几何生成与释放', action: async deadline => {
      let rebuilds = 0;
      while (Date.now() < deadline) {
        // Presets regenerate all three real wing meshes through the same UI path as user edits.
        await page.getByRole('combobox', { name: '预设飞机', exact: true }).selectOption(String(rebuilds % 6));
        await page.waitForTimeout(40);
        rebuilds++;
      }
      return { rebuilds };
    } },
    { id: 'long-flight-reset', name: '长时间飞行并重置', duration: longMs, setup: flight, action: deadline => keepFlying(deadline, true) },
  ];

  for (const scenario of scenarios) {
    const errorStart = pageErrors.length;
    try {
      await design();
      await scenario.setup?.();
      await page.bringToFront();
      await page.waitForTimeout(warmupMs);
      const before = await heapSnapshot();
      const aircraft = await page.evaluate(() => window.glider.aircraft);
      const duration = scenario.duration || sampleMs;
      const pending = page.evaluate(collectFrames, duration);
      // Awaiting this read ensures instrumentation starts before the first interaction.
      await page.evaluate(() => performance.now());
      const [operations, measurement] = await Promise.all([scenario.action(Date.now() + duration), pending]);
      const after = await heapSnapshot();
      const sorted = [...measurement.intervalsMs].sort((a, b) => a - b);
      if (sorted.length < 2) throw new Error('rAF 样本不足；检查标签页可见性和浏览器渲染环境');
      const mean = measurement.intervalsMs.reduce((sum, value) => sum + value, 0) / sorted.length;
      const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
      const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
      results.scenarios.push({ id: scenario.id, name: scenario.name, requestedDurationMs: duration, aircraft, operations,
        frames: { count: sorted.length, averageFps: 1000 / mean, meanMs: mean, p95Ms: p95, p99Ms: p99, minMs: sorted[0], maxMs: sorted.at(-1) },
        heapBefore: before, heapAfter: after,
        heapUsedDeltaBytes: before && after ? after.usedJSHeapSize - before.usedJSHeapSize : null,
        ...measurement, errors: pageErrors.slice(errorStart) });
      console.log(`${scenario.id}: ${(1000 / mean).toFixed(1)} FPS, P95 ${p95.toFixed(2)} ms, P99 ${p99.toFixed(2)} ms`);
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
  if (!remote) await context.close();
  await browser.close();
}
