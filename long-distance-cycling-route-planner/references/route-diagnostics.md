# GPX 与 OSM 道路诊断

仅在已有 GPX 和合法取得的原始 OSM 道路数据、但还没有可信的完整骑行道路结果时，运行 `../scripts/diagnose-osm-route.mjs`。它是本地诊断器，不是路线生成完成证明，不联网，也不上传轨迹。原始 OSM JSON 需含 `elements`，道路 way 需带 `geometry` 和 `tags`；用户必须另行确认数据来源、覆盖范围和时间。不要把 Skill 打包成含他人私人 GPX 或过期道路缓存的通用数据包。

示例（经纬度是演示格式，不是预设起点）：

```sh
node scripts/diagnose-osm-route.mjs --gpx route.gpx --osm roads.json --start 31.100000,121.100000 --start-crs gcj02 --out diagnostics.json
```

`--start` 按纬度、经度输入。起点来自高德时用 `--start-crs gcj02`，已是标准 GPS 坐标时用 `wgs84`。GPX 默认同时测试 WGS-84 与误标为 WGS-84 的 GCJ-02 两种假设；道路贴合差距不足两倍时标为 `ambiguous`。也可明确指定 `--gpx-crs wgs84|gcj02`，但指定不等于证明。实际地铁出口、道路侧别和合法接入仍需核实。

输出中的 `originalGpxGeometryKm` 只是 GPX 几何长度；`rawGraphSumKm` 即使有值也只是一组道路图最短路的诊断和，不能写成骑行总里程；`usableTotalKm` 始终为 `null`。检查 `gaps`、`detours`、`anchorSnap`、`accessCandidates`、`closureCandidateKm` 和道路数据时间。默认按约 350 m 设置内部形状锚点，超过“GPX 对应段长度 × 1.6 + 100 m”或锚点离候选道路超过 100 m 时报警；这些是异常筛选阈值，不是合法性或准确性证明，也不是导航终点。

程序不会凭“图论上可达”宣称维持原路线：绕行可能是道路数据断裂、桥梁未连通、坐标误判、路权限制、真实道路改线或贴路算法选择造成的。先逐段核查来源和现场通行，再决定修数据、换算法或改计划；不得仅放宽 footway/path 权限、调大阈值或删掉异常段来让测试通过。

完成地图仍需独立核实连续骑行道路、实际起终点、路权和现时路况、每段距离出处、固定路线与高德分段对照以及手机实测。高德导航 URI 可能重新规划；导航终点与固定轨迹对应，不等于高德会一直沿固定轨迹行驶。
