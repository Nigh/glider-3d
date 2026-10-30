# 无动力滑翔

纯静态的三维滑空机设计与飞行游戏。TypeScript、Svelte 5、Three.js、Vite；不使用通用物理引擎。中文界面，支持桌面、手机竖屏及横屏。

## 运行

```sh
npm install
npm run dev
```

打开终端中的本地地址。生产构建：

```sh
npm run check
npm test
npm run build
npx vite preview --host 0.0.0.0
```

将 `dist/` 部署至静态站点。首次获取中文网络字体失败时使用本机 sans-serif，不影响游戏。

## GitHub Pages 自动部署

在线地址：[无动力滑翔](https://nigh.github.io/glider-3d/)。

`.github/workflows/deploy-pages.yml` 在推送或合并到 `main` 后自动部署，也支持在 Actions 页面通过 `Run workflow` 手动触发。仓库 Pages 的构建来源为 **GitHub Actions**。

工作流使用 Node.js 24，依次执行 `npm ci`、类型检查、单元测试和生产构建，然后通过官方 Pages Actions 上传并部署 `dist/`。构建路径直接使用 `configure-pages` 返回的 `base_path`，无需硬编码仓库名称，也不改变本地开发路径。构建任务没有部署写权限，部署任务单独申请 `pages: write` 和 `id-token: write`。

Action 版本于2026-10-30通过各官方仓库的最新发布接口核实，并固定到对应提交 SHA：`checkout` v7.0.1、`setup-node` v7.1.0、`configure-pages` v6.0.0、`upload-pages-artifact` v5.0.0、`deploy-pages` v5.0.1。升级时同时更新 SHA 和旁边的版本注释。

本地复现项目子路径构建：

```sh
npm run build -- --base /glider-3d/
npx vite preview --base /glider-3d/
```

## 游戏

1. 进入飞机工坊，修改机身长度、驾驶舱和驾驶员质量。
2. 在主翼、水平尾翼或垂直尾翼页直接拖动三维飞机上的四个控制点。编辑时自动锁定俯视或侧视正投影，数字输入提供同等编辑能力。左右翼保持对称。
3. 在组装页直接拖动部件的纵向位置、主翼高度；安装角仍用滑条设置。重心、升力中心及估算中性点帮助判断配平。
4. 飞机从10米平台入口静止出发，以固定加速度助跑，在平台边缘达到统一的10 m/s后进入无动力飞行。
5. `W/S` 或上下方向键移动驾驶员重心；`A/D` 或左右方向键使用方向舵。手机按住对应控制按钮，松手归零。空格暂停。
6. 接水或接触平台/地形后查看距离、时间、速度、高度与基于飞行数据的反馈。返回设计继续改进。

翼面编辑时拖动覆盖在实体上的控制点，正投影锁定避免误转相机。组装时拖动部件位置，其余视图支持鼠标轨道旋转、滚轮缩放及右键平移；触屏支持对应手势。所有相机保持在地面和水面以上。飞行提供追尾、侧面、驾驶员及自由视角。

实验模式开放升降舵、副翼和实际受力、速度、轨迹与作用点可视化。三种模式共用同一核心，成绩分开存储。

飞行仪表显示实时攻角、实际升阻比、下沉率和距离—高度曲线。能量槽从离台开始显示重力势能、动能（含转动）及累计耗散；助跑的外部输入能量不计入飞行守恒基准。飞机在所有画质下均向湖面投影，便于判断高度。

## 保存与重放

“保存”和“机库”提供本地保存、加载、改名、复制、删除及JSON导入导出。删除需确认。坏记录不会覆盖其他有效记录；存储满或权限错误会显示提示。浏览器清除站点数据会删除机库，重要设计请导出备份。

撤销与重做最多保留60个快照。`Ctrl/Cmd+Z` 撤销，`Ctrl/Cmd+Shift+Z` 重做。参数拖动结束形成快照。撤销/重做后保存创建新记录，避免跨飞机历史覆盖其他设计。预设包含均衡、高展弦比、高稳定、灵敏、重心过后、高翼载荷六型。

结果页可重放最近一次飞行；保存的是固定时间步操纵输入，不是预制轨迹。重放重新执行同一飞行核心。

## 检查

```sh
npm run check
npm test
npm run test:e2e
```

浏览器测试默认启动开发服务。如已有服务且环境启用 CI：

```sh
PLAYWRIGHT_NO_SERVER=1 npm run test:e2e
```

需要 Playwright Chromium：`npx playwright install chromium`。交互测试涵盖设计、组装、试飞、操纵、着水、成绩、再次编辑、机库和重放。

## 性能

```sh
# 先启动 npm run dev
npm run perf
```

结果写入 `docs/performance-results.json`。工具独立采样浏览器 rAF 帧间隔，不把应用的目标FPS当实测。可通过 `PERF_SAMPLE_MS`、`PERF_LONG_MS`、`PERF_RESET_MS` 调整持续时间。`CDP_URL` 支持连接真实设备浏览器；详见 [手机验证方案](docs/mobile-performance.md)。

默认不显示性能面板，点击“性能”打开。显示平均/P95/P99帧时、物理耗时、CPU渲染提交耗时、几何更新时间、draw calls、三角形和几何/纹理内存估算。渲染提交耗时不是GPU执行时间。

**普通手机60FPS仍须真实设备验证。桌面或模拟手机视口不能证明该目标。** High/Medium/Low档位与自动降档降低像素比、阴影和环境细节，带采样与滞回，避免频繁切换。

飞机材质、驾驶员几何与机体网格持续复用；连续编辑请求合并到每个渲染帧，仅重建变化的翼面。不在拖动中重新设置画布尺寸或遍历全场景计算内存。气动核心复用数学对象，飞行输入写入预分配 TypedArray。Auto 从保守 Low 开始，再按稳定帧时调整。

## 代码地图

- `src/model.ts`：独立飞机定义、范围、四边形几何、预设。
- `src/physics.ts`：质量/惯量、五气动面、刚体积分、接触与成绩、输入录制回放。
- `src/scene.ts`：参数化厚翼型、湖畔环境、相机、资源释放、画质与性能监控。
- `src/App.svelte`：页面状态、固定60Hz累积循环、操纵和UI节流。
- `src/WingEditor.svelte`、`src/Parameter.svelte`：精确坐标和参数编辑；三维拖动由场景层负责。
- `src/storage.ts`：本地机库、导入边界、分组纪录及历史快照。
- `tests/`：几何、存储、物理行为及Playwright交互验收。

## 模型与边界

这是经过游戏化简化的气动模型，不是工程级仿真。设计参数会改变质量、惯量、升阻与力矩。无CFD、涡流求解、随机成绩或固定飞行轨迹。

- 原版调查：[docs/original-game-analysis.md](docs/original-game-analysis.md)。Observed / Inferred / Unknown 区分事实与推断。
- 物理、坐标系、系数及限制：[docs/physics.md](docs/physics.md)。
- 性能采样与真机复现：[docs/mobile-performance.md](docs/mobile-performance.md)。
- 飞行预设和配平实测：[docs/flight-balance.md](docs/flight-balance.md)。
- 真实设备连接检查：[docs/device-validation.md](docs/device-validation.md)。
- 性能瓶颈、优化前后与最终实测：[docs/performance-analysis.md](docs/performance-analysis.md)。

不含账号、服务器、在线排行榜、复杂水体或飞机破碎。尾翼和主翼使用固定轻量翼型，不能编辑翼型截面；四点编辑保持根部和梢部等展向坐标，防止自交。安装位置可超出机身形成不合理但几何有效的设计；允许试飞暴露后果。
