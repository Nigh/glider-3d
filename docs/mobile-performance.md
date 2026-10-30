# 手机测量与交互验证

## 验证边界

**真实手机尚未验证。** 仓库中的 Playwright 手机项目只验证 390 × 844 竖屏和 844 × 390 横屏的布局、浏览器触摸事件与操作链路，不代表手机 CPU、GPU、热降频、触摸延迟或续航表现。桌面 Chromium 的设备像素比、触摸视口和 CPU 限速均不能替代真机证据。

本文件不提供预填性能数字。`docs/performance-results.json` 只由实际运行性能脚本生成。若脚本没有运行，就没有性能结果；不得把界面显示值或预期帧率当作实测数据。

## 浏览器交互测试

```sh
npm install
npx playwright install chromium
npm run test:e2e
```

Playwright 默认启动 `npm run dev -- --port 5173 --strictPort`，本地已有同端口服务时复用。连接其他现有服务：

```sh
PLAYWRIGHT_BASE_URL=http://127.0.0.1:5173 PLAYWRIGHT_NO_SERVER=1 npm run test:e2e
```

桌面项目覆盖机身长度、驾驶舱、主翼四个 SVG 点的真实鼠标拖动、主翼上反角、两种尾翼、安装位置和角度、撤销重做及快捷键、预设与画质、机库保存和刷新后加载、重命名、复制、JSON 下载与上传、无效 JSON 保留原设计、删除、键鼠飞控、暂停、着水结果、确定性输入重放、返回改进和再次飞行。手机项目检查菜单、所有设计页签、机库、飞行及结果页无页面溢出，并经 Chromium 输入通道发送真实浏览器触摸事件，验证四个飞控按钮按下与释放。测试只读 `window.glider` 断言，不通过脚本修改应用状态。

Vitest 必须只采集单元测试，例如在配置中使用 `test: { include: ['tests/**/*.test.ts'] }`，避免将 `tests/game.spec.ts` 交给 Vitest 执行。

## 自动性能采样

先保持应用服务运行，再执行：

```sh
npm run dev
# 在另一个终端执行：
npm run perf
```

性能工具不会自行启动第二个服务。默认连接 `http://127.0.0.1:5173`。正常运行采样约 36 秒，另加浏览器启动、页面加载、预热和 UI 操作时间。默认前六项各采样 4000 ms，最后一项 12000 ms；每项独立加载初始设计，预热 500 ms。自动完成七项：

1. 默认飞机飞行，着水后通过“再试一次”继续。
2. 通过精确编辑 UI 将主翼半展设为 12 m，测量 24 m 最大翼展飞行。
3. 在三维画布区域持续按住鼠标旋转相机。
4. 持续拖动主翼控制点，反复触发真实几何更新。
5. 反复进入飞行、返回设计。
6. 通过预设选择反复替换模型，观察几何、纹理及程序资源数量。
7. 较长时间飞行，着水或达到重置间隔后通过 UI 重置。

可配置参数：

```sh
PERF_URL=http://127.0.0.1:5173 \
PERF_SAMPLE_MS=6000 PERF_LONG_MS=60000 PERF_WARMUP_MS=1500 PERF_RESET_MS=15000 \
PERF_OUTPUT=docs/performance-results.json HEADED=1 npm run perf
```

`PERF_SAMPLE_MS`、`PERF_LONG_MS`、`PERF_RESET_MS` 至少为 1000 ms；预热允许为 0。长稳态与释放检查建议再运行 5 分钟版本：

```sh
PERF_SAMPLE_MS=10000 PERF_LONG_MS=300000 PERF_RESET_MS=30000 HEADED=1 npm run perf
```

默认输出为 `docs/performance-results.json`。运行会覆盖此文件；保存对比数据时设置不同 `PERF_OUTPUT`。失败场景记录原始错误并返回非零退出码，不补造数据。运行期间保持被测标签页在前台，不最小化窗口或切换浏览器标签页。

### 结果字段与解释

- `frames.averageFps` 来自独立 `requestAnimationFrame` 回调的时间戳，以 `1000 / 平均帧间隔` 计算。`meanMs`、`p95Ms`、`p99Ms` 是实际帧间隔的平均值及 nearest-rank 分位数，不是每帧 FPS 的分位数。原始 `intervalsMs` 保留以便复算。
- `samples` 约每 250 ms 保存当前只读 `window.glider.metrics`、界面状态和可用的 JS 堆信息。模型自报 FPS 单独保存在 metrics 中，不替代独立 rAF 数据。
- `metrics.renderMs` 是 CPU 调用 `renderer.render()` 周围的提交耗时，可能包括驱动同步等待，**不是 GPU 实际执行时长**，也不等同于整帧时间。GPU 命令通常异步执行；不能用提交时间推算 GPU 余量。
- `gpuTimeMs` 当前为 `null`。即使 `gpuTimerQuerySupported` 为真，脚本也没有执行 GPU 查询。若后续使用 WebGL `EXT_disjoint_timer_query_webgl2`，必须在实际渲染命令前后放置查询，异步读取结果，丢弃 `GPU_DISJOINT_EXT` 为真的样本，并标明单位及设备支持情况。远程调试 trace 里的 GPU track 可另行提供证据。
- `metrics.memory` 是应用几何、索引、纹理与实例矩阵资源的 MiB 估计，不是完整显存占用；1 MiB = 1048576 字节。`geometries`、`textures`、`programs` 来自 renderer 资源计数；反复重建后应趋于稳定。资源计数、JS 堆和驱动内存不是同一指标。
- `heapBefore`、`heapAfter` 和采样中的 `jsHeap` 使用浏览器可选的 `performance.memory`；不支持时为 `null`。堆增量受 GC 时机影响，单次增量不能证明泄漏。长时间采样观察多轮平台值；需要时单独采集 Chrome 堆快照和系统进程内存。
- `environment.webgl` 读取实际画布上下文的 vendor、renderer 和可用的未屏蔽信息；`browserGpu` 保存可获得的 CDP GPU 信息。若输出 SwiftShader 或其他软件渲染器，报告必须明确写为软件渲染结果，不能宣传硬件加速手机帧率。
- `environment.runner` 是运行 Node 工具的主机，不一定是被测手机。真正被测浏览器的信息在 `userAgent`、`webgl`、`browserGpu`、屏幕与视口字段中。CDP 连接本身也不能自动证明设备身份，必须附实际机型记录。
- 页面隐藏、rAF 样本不足和 `pageErrors` 均需保留并调查，不得通过删除慢帧改善统计。

## Android 真机远程调试

1. 记录机型、SoC/GPU、内存、Android 与 Chrome 版本、屏幕刷新率、浏览器缩放、横竖屏、亮度、电量、温度、是否充电、省电模式及网络。关闭其他重任务。首次测量前预热，之后做冷机和热机两轮，每个场景至少三次。
2. 手机启用开发者选项与 USB 调试。使用数据线连接，确认授权。工作站运行 `adb devices`，确认设备为实际目标手机，而非模拟器。
3. 应用运行在工作站时，转发网页服务与 Chrome 调试端口：

   ```sh
   adb reverse tcp:5173 tcp:5173
   adb forward tcp:9222 localabstract:chrome_devtools_remote
   ```

4. 在手机 Chrome 打开 `http://127.0.0.1:5173`，确认实际 WebGL 场景运行。关闭其他 Chrome 标签页，仅保留被测页面。工作站通过 `chrome://inspect/#devices` 检查连接。调试端口仅绑定可信工作站，不向公网暴露。
5. 手机保持解锁、屏幕常亮、页面前台。先用手指执行设计、拖点、双指缩放、安装角、机库与飞控，分别记录横竖屏截图及触摸反馈。自动化触摸通过不等于人手触摸体验通过。
6. 使用实际手机现有浏览器连接，不创建桌面模拟手机 context、不覆盖真机视口：

   ```sh
   CDP_URL=http://127.0.0.1:9222 PERF_URL=http://127.0.0.1:5173 \
   PERF_SAMPLE_MS=10000 PERF_LONG_MS=300000 PERF_RESET_MS=30000 \
   PERF_OUTPUT=docs/performance-android-portrait.json npm run perf
   ```

   工具使用 CDP 默认 context 的首个标签页，导航该页并驱动真实 UI。运行前关闭不相关标签页。另测横屏时先在手机旋转屏幕，再运行并使用新文件名。某些 Android Chrome 版本不支持部分浏览器级 CDP GPU 信息；缺失字段不应伪填。
7. 在 `chrome://inspect` 打开的 DevTools 中录制 Performance trace，包含 CPU、Frames、内存和可用 GPU track。远程调试本身存在开销；正式采样关闭 DevTools 面板，保留单独 trace 轮次。使用 Android 系统工具另记应用进程内存、温度和热降频，不能以 `performance.memory` 代替系统内存。
8. 保留原始 JSON、trace、设备记录、截图和运行时间。给出 FPS、平均帧间隔、P95/P99、画质切换、资源计数稳定性及异常说明。出现掉帧时先按物理、几何构建、渲染提交、GPU 和 GC 分类，不凭单个数字归因。

## iPhone / iPad

Android CDP 流程不适用于 iOS Safari。使用 macOS Safari 的“开发”菜单连接已开启 Web Inspector 的真实设备，按相同七场景手动操作并采集 Timelines/帧率、内存及可用 GPU 数据。记录 Safari/iOS 版本与设备型号。无该设备和连接条件时，应明确写“iOS 真机未验证”，不能把 Chromium 触摸视口结果改称 Safari 或 iPhone 实测。
