# 设备验证边界

2026-10-30 在当前工作站运行 `command -v adb && adb devices`：存在 `/usr/bin/adb`，启动ADB服务后输出 `List of devices attached`，设备列表为空。

因此本次没有可连接的Android真实手机。iOS需要macOS Safari与真实设备，当前Linux工作站未进行该验证。Playwright的390×844及844×390触摸视口用于布局与浏览器输入验证，不代表真实手机硬件性能。

真实手机60FPS尚未验收。连接设备后的自动采样与远程调试步骤见 [mobile-performance.md](mobile-performance.md)。当前实测环境及原始帧间隔见 `performance-results.json`；CPU渲染提交耗时不等于GPU执行时间。
