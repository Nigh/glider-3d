import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const server = await createServer({ root, configFile: false, logLevel: 'error', optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null }, appType: 'custom' });
try {
  const { presets } = await server.ssrLoadModule('/src/model.ts');
  const { analyzeCruiseReference } = await server.ssrLoadModule('/src/cruise.ts');
  const results = presets.filter(definition => definition.engine.count > 0).map(definition => {
    const started = performance.now(), analysis = analyzeCruiseReference(definition);
    return { name: definition.name, ...analysis, display: analysis.reference ? {
      throttlePercent: Math.round(analysis.reference.throttle * 100), speedMetersPerSecond: Math.round(analysis.reference.speed),
    } : null, milliseconds: performance.now() - started };
  });
  console.log(JSON.stringify(results, null, 2));
  if (results.some(result => !result.reference)) process.exitCode = 1;
} finally { await server.close(); }
