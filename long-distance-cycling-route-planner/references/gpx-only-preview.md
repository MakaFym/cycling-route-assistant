# GPX-only 未完成参考预览

只有原始 GPX、暂时没有道路服务、没有已定位起点，或尚未明确拓扑/方向时，使用这个显式入口先生成可查看的参考草稿。它不是 OSM 研究地图或完整高德地图的替代品，也不能因用户最终需要完整导航而静默降低要求。

```sh
node scripts/prepare-gpx-preview.mjs --gpx INPUT.gpx --out-dir PRIVATE_TEST_DIR
node scripts/prepare-gpx-preview.mjs --gpx INPUT.gpx --start-name "尚未定位的起点名称" --out-dir PRIVATE_TEST_DIR
```

`--start-name` 只保存文字，不地理编码、不猜坐标、不放起点标记。`--title` 只修改草稿标题。未知、重复或缺值选项必须报错。

## 固定边界

- 接受普通 GPX 1.0、1.1 和现有解析器支持的无命名空间简化文件；继续拒绝 DTD、外部实体、异常 XML、混合轨迹/路线来源和无效坐标。
- 原始 `trkseg` 或独立 `rte` 分别保留为参考线。段间空白不画连接线；文件顺序只用于忠实显示来源，不代表骑行方向、拓扑或道路连通。
- 输出始终为 `status: draft`、`mode: gpx-only-reference`、`totalKm: null`、`topology: null`、`direction: null`。道路组成、导航段、下一点、关键点、补给、道路候选和本地道路图层均为空。
- GPX 几何只是参考，不是导航距离、可骑行道路、道路许可、闭环证明或当前开放证据。不得计算或显示完整骑行总里程，也不得从首尾接近推断环线。
- 模板不发起底图请求，并明确说明缺少详细底图和道路服务。它不是完整离线地图；只是本地打包的 GPX 参考线和界面。
- 可选名称和标题只能作为文本写入；生成器通过模板的 JSON 转义写入，浏览器使用 `textContent` 显示，不把标签内容当 HTML。

固定输出为：

- `gpx-preview.html`：使用包内 `assets/map-shell.html` 生成的参考草稿；
- `gpx-preview-data.json`：按段保留的源几何和空的道路/导航数组；
- `gpx-preview-report.json`：地图哈希、点/段/缺口数量、阻塞项与后续责任。

## 验证与后续

对生成 HTML 运行包内离线浏览器测试，并在新目录保存手机、桌面及其他既有视口截图：

```sh
node scripts/check-map-browser.mjs PRIVATE_TEST_DIR/gpx-preview.html PRIVATE_TEST_DIR/qa
node scripts/write-map-report.mjs --map PRIVATE_TEST_DIR/gpx-preview.html --acceptance PRIVATE_TEST_DIR/gpx-preview-report.json --browser-results PRIVATE_TEST_DIR/qa/browser-results.json --out-md PRIVATE_TEST_DIR/report-facts.zh.md --out-json PRIVATE_TEST_DIR/report-data.json
```

Playwright 与 Chrome 只是浏览器测试环境的可选依赖，不随 Skill 打包，也不会自动安装。若 Node 不能直接解析 `playwright`，用 `PLAYWRIGHT_MODULE` 指向已有的本地 Playwright 模块；若该模块没有可用的浏览器内核，再用 `MAP_TEST_CHROME` 指向已有 Chrome/Chromium 可执行文件。依赖缺失会让测试明确失败，不会跳过或伪造通过。

自动事实报告只能证明当前产物、源分段保留和哈希绑定的浏览器检查；具体路线仍为 `not-accepted`。截图须实际查看，确认各独立段可见、段间没有连线、总里程待核实、导航禁用，并显示缺少详细底图和道路服务。

要继续规划，先定位实际起点，再让用户明确 `open|loop` 和 `forward|reverse`。已有获准的原始 OSM 时进入 [研究地图流程](research-map.md)；取得授权且需要正式道路距离与分段时进入 [高德响应组装流程](amap-route-assembly.md)。所有完整地图质量门槛保持不变。
