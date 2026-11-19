# 高德骑行结果到交互地图

API相邻step折线首尾必须在1米坐标精度容差内连续；超过时拒绝该捕获，不画直线补路。长的单step折线可能本来稀疏，不能仅凭相邻顶点距离判缺路；step之间是有明确来源边界的断裂检查。必经点按折线边与边内投影进度核对顺序，不仅比较边编号。

导航组边界的 `endMandatory/mandatoryKind/mandatoryEvidence` 显式设置优先于对应末组成leg；未设置时继承末leg。内部组成边界不要求手动切换。采集与组装使用相同规则，强制原因仍须满足具体证据门槛，不能为了省删除查询随意标true。

默认 GPX 引导的合理近似模式：完整保留原 GPX，与高德实际算路分层对照，不要求逐点重合。明显差异必须有具体道路走廊审核；不能借此接受反向、顺序异常或大段折返。程序以均匀采样的单调对齐距离减去双向最近样点距离作顺序异常筛查（超出300米需修正），它不是没有折返的证明，仍须结合道路说明和必经点核对。严格贴合仅在明确要求时启用。

仅在需要“实际地图导航生成的骑行距离”和完整手机交互地图时读取。官方 [路径规划 2.0](https://lbs.amap.com/api/webservice/guide/api/newroute) 提供 `/v5/direction/bicycling`，要求 Web 服务 Key；骑行路径的 `distance` 单位是米，若要获得 `steps.polyline`，请求须包含 `show_fields=polyline`。地图的 [URI 路径规划](https://lbs.amap.com/api/uri-api/guide/travel/route) 支持 `mode=ride`，但骑行模式只在移动端有效，高德可能在每段重新算路，且骑行的 `via` 不生效。

## 没有 API Key 时的官方网页路径

据高德 [新版网页路线规划说明](https://www.amap.com/ssr/doc/route-plan)（2026-10-11 核查），新版网页提供骑行规划；旧版可能需要“体验新版”。实际运行时检查当前界面，不假定文档说明已在当前账号部署。通过官方可见界面输入起终点并选择骑行；可用时通过官方分享、发到手机功能留存方案。不得借用网页内部令牌或逆向私有接口。

网页路径必须留存每段查询时间、准确起终点、骑行模式、已选方案的显示距离、原始精度、结果截图及可用分享链接；同时核对方案折线、道路入口与参考主线是否吻合。距离若只显示一位小数，保留其显示精度；仅在确认舍入规则后说明误差范围，总和不能伪装为精确到米。删除测试同样由网页重算前后跨度并保留证据。

若当前桌面界面只有驾车、公交和步行，且找不到新版入口，还应测试官方手机网页：在手机浏览器或手机视口中打开文档规定的 `https://uri.amap.com/navigation`，明确填写 GCJ-02 起终点、`mode=ride`、`callnative=0`。这是网页算路取证，不是 App 调起测试。实际确认最终页面为骑行结果，而不是驾车回退；检查选中模式、骑行标题、方案折线和“详情”中的道路说明。不能把地图比例尺误当距离。未查明页面舍入规则时只保留显示精度，不能自行假定误差区间；详情逐步米数之和是衍生估算，不是官方 API 总里程。

测试环境已有 Playwright 时，可用随附 `capture-amap-mobile.mjs` 留存手机网页结果。清单 `legs` 每项有 WGS-84 `start`、`end` 和名称，删除测试作为单独查询条目。脚本只读取可见页面文字和保存截图，不读取网页内部令牌、私有接口或隐藏路径对象；采集输出始终为“已捕获、未验收”。环境依赖与浏览器路径配置方式同研究地图测试脚本。

```sh
node scripts/capture-amap-mobile.mjs --manifest manifest.json --out-dir PRIVATE_EVIDENCE_DIR --send-segment-endpoints-to-amap
```

网页无法导出道路折线时，不能凭截图描线或 GPX 长度冒充高德折线/米数。原 GPX 可作为固定地图几何，但须逐段证实与网页路线处于同一道路走廊；接驳与返程仍须有真实连续道路几何，并分别说明“几何出处”和“导航距离出处”。仅有网页总里程或无法辨认道路的截图，不足以完成地图。使用下面的网页证据模式，不填造 `status:1` 响应绕过验证。

### 手机网页证据组装

在正常分段清单中，对对应 `legs` 或 `removalTests` 条目填写：

- `evidenceType:"amap-mobile-web"`，`responseFile` 指向采集器实际保存的单条查询 JSON；截图保留在该 JSON 的目录。
- `geometryEvidence.coordinateSystem:"WGS-84"`，`points` 为独立道路折线。已核对几何的 `source` 为 `original-gpx` 或 `reviewed-road-geometry`；本地道路候选只能写 `local-road-candidate`，即使填入审核标志也保持草稿。`sourceEvidence` 说明原始文件、区间及其他可追溯依据。
- `geometryEvidence.corridorReview` 包含 `checked`、有效日期 `checkedAt` 和具体 `evidence`。必须核对网页实际道路、入口和进出方向与几何相同，不能因两者都能在地图显示就填 `checked:true`。

仍使用 `assemble-amap-map.mjs` 的正常 CLI。它重新解析网页可见原文，不信任旧 `parsed` 数值；核对请求、结果端点及截图文件存在，保留网页显示精度、原始里程文字和几何出处。缺少同走廊复核时可显示候选几何，但地图仍为草稿，完整总里程为空且导航禁用。网页结果没有包含算路坐标，组装器也不会替它虚构坐标。

全部证据齐全后的网页总和只能称近似值，舍入规则未知时不得宣称误差区间或精确到米。界面标注“约”，各段证据类型可与 API 分开追溯。几何筛查报告的 `comparedGeometryKm` 是所提供折线的几何长度，`geometrySource` 标明出处；网页模式下不代表高德导出的算路折线，也不替代同走廊核对。删除测试的合并跨度也须有独立几何与实际走廊复核，否则不能据此批准保留或删除端点。

形状对比同时执行按里程均匀采样的顺序对齐：反向闭环、交换自交环的次序和额外长折返不能仅因道路形状相同而通过。过长跨度导致采样过粗时拒绝自动认证，要求拆分检查跨度，不必增加骑手的导航切换数。自动阈值只是筛查，不能证明路权、同侧道路或所有局部差异均正确。

## 准备分段清单

默认 `alignmentMode:"gpx-guided"`，明确严格保持轨迹时才用 `"strict"`。`originalGpx` 保留完整原始WGS-84点列和名称作独立原线图层，不添加虚构闭环接缝。主段 `referencePoints` 用于对比，150/500m等阈值只是显著差异筛查，不是合理近似模式自动判失败的条件。

显著差异需有真实的 `alignmentReview`：`checked:true`、日期 `checkedAt`、`outcome:"same-corridor"|"accepted-local-reroute"` 和具体 `evidence`，解释道路差异、入口、折返及是否遗漏必经点。“用户允许近似”不能代替该核查，也不能把原GPX与高德不一致推断为封路。相同形状的反向/错环/额外折返仍拒绝；`essentialWaypoints` 每项有名称与WGS-84点位，必须按顺序经过，不能靠近似审核豁免。`alignmentReview` 只解释局部道路差异，不能豁免组装器的全程双向覆盖与连续偏离门槛。

两条路线默认同时显示。总/累计/剩余使用高德当前选定方案，原GPX几何或实骑里程独立说明。网页距离与网页显示的独立几何仍必须同走廊；这与“高德方案允许不同于原GPX”是两件事。

组成部分的essentialWaypoints必须继续约束实际navigationGroups折线及删除测试跨度，按组成顺序核对，不能只因整体形状在容差内就丢失必经桥梁或入口。删除后漏必经点时保留该边界并在removalReports记录具体原因；保留必经点的冗余边界仍应合并。此约束不要求逐点保持GPX，也不把必经点自动变成新的手动切换点。

局部重算与旧响应复用时，`legs`、`navigationGroups`、`removalTests`分别保留自己的`queriedAt`（实际原始请求时间），不能把全局日期改为今天后宣称所有段今天重新查询。未指定记录日期时兼容全局`queriedAt`，因此混合批次必须逐条填写并关联原始捕获；日期未知就说明缺口，不用文件修改时间冒充。明确填`null`代表未知，不能回退为全局日期后认证。日期为真实存在的`YYYY-MM-DD`或带`Z`/时区偏移的ISO时间戳，不接受2月30日等自动进位日期或无时区时间；查询和人工审核日期共用同一校验。地图保留精确记录时间，顶栏按上海时区汇总实际导航日期；独立组成与组合算路日期可以不同。采集器把实际请求时间写入记录；导入器只从采集清单恢复匹配响应文件的日期，不复制旧审核标志。

先确定实际起点与终点、接入点、固定路书方向，以及少量必要导航终点。分段端点不能单纯按 10 km 间隔生成；应经固定路线比对和删除测试。清单使用 WGS-84 `[纬度,经度]`，每个主线分段提供按骑行方向排列的 `referencePoints`，可从 GPX 对应区间取样，但不能用其长度替代高德距离。去程接驳、主线、必要返程均应列出，不得把可选支线混入主线。

每个内部导航终点都要通过自动删除测试：去掉它，请求从前一段起点直达后一段终点，并与原两段的高德折线双向比较。若仍处在相同道路走廊，就必须合并，不得保留该终点。真实计划停靠、接入或离开、住宿、可选支线边界及通行边界可标记 `endMandatory:true`，但必须同时填写 `mandatoryKind`（`planned_stop`、`route_join`、`route_leave`、`overnight`、`option_boundary`、`access_boundary`）和可追溯的 `mandatoryEvidence`。单纯“重要路口”“距离够长”不能豁免删除测试。脚本检查字段与几何，证据真实性仍须人工核对。

```json
{
  "title": "示例：实际起点至终点",
  "actualStart": [0, 0],
  "actualEnd": [0, 0.01],
  "days": 1,
  "queriedAt": "2026-10-10",
  "legs": [
    {
      "type": "main",
      "name": "固定主线一段",
      "reason": "此处需保持指定道路走廊",
      "start": [0, 0],
      "end": [0, 0.01],
      "referencePoints": [[0, 0], [0, 0.01]],
      "responseFile": "leg-01.json"
    }
  ],
  "review": {
    "routeAndRoadsChecked": false,
    "navDeletionChecked": false,
    "accessChecked": false,
    "checkedAt": "",
    "evidence": ""
  }
}
```

上述坐标是合成测试值，不能用于真实路线。真正填写 `review` 前，逐段核对固定路线贴合、可骑行通行、路口与桥梁入口、必须分段的理由，并保留可追溯证据。布尔值不是证据；不能为让输出变成 `complete` 而臆造审核。脚本的几何阈值只是异常筛选，不能代替现场或权威道路信息。

组装器输出`reviewStatus`，分别指出道路、分段和通行的完成情况、责任类型及具体下一步；有效审核日期不可为空或无效。未解决的具体问题可填`review.pendingChecks`，字段见[原始输入流程](fresh-input-workflow.md)。它们不会因全部审核布尔值为true而被忽略。默认缺审核属于Agent待核查，不自动推给用户；真实手机验证状态独立列出，不能假称已测。

## 取得与组装响应

### 大清单的审核元数据写回

在原始响应导入后，已有具体核查依据可用小型JSON补丁写回，不重抄几千行点列。格式示例（仅结构，不是已审核证据）：

```json
{"title":"候选路线","legs":[{"index":1,"name":"接入点名称","reason":"此处是实际计划接入边界"}],"review":{"routeAndRoadsChecked":false,"accessChecked":false,"pendingChecks":[{"code":"entry-review","description":"具体入口的道路身份与通行限制仍需核对","owner":"agent","action":"查对应道路结构与权威资料，再记录实际依据"}]}}
```

```sh
node scripts/apply-review-metadata.mjs --manifest PRIVATE_JOB/manifest.json --patch review-patch.json --out PRIVATE_JOB/reviewed.json
node scripts/assemble-amap-map.mjs --manifest PRIVATE_JOB/reviewed.json --template assets/map-shell.html --out-html map.html --out-report acceptance.json
```

顶层允许`title/subtitle/note/cues/supplies/turnCandidates/review`；点位数组和`pendingChecks`是显式替换，未提供的字段保留。`legs`或既有`navigationGroups`用1-based `index`更新`name/reason/endMandatory/mandatoryKind/mandatoryEvidence/alignmentReview`。工具校验字段、索引及批准信息的日期/证据完整性，但不判断证据真实，也不批准道路。只有已核实才能填true；计划接入/离开字段也须可追溯依据。改变路线、参考区间、分段或捕获须回到正常导入/算路流程，不能用补丁绕过。输出必须为原清单同目录的新文件；不覆盖原清单或旧审核。之后重新组装和界面测试，不能只改报告。

### 路线组成与低切换导航分离

`legs`是有独立几何/距离依据的组成部分，去程、主线、返程保持分类。可选`navigationGroups`表示需要切换的导航任务，每项有`firstLeg`、`lastLeg`（1-based且连续完整覆盖）、`name`、`reason`、`responseFile`和证据类型。主线尾段与返程可以属于同一组，不增加中间切换。

每个组必须保留真实高德响应；合并折线须与组成部分同方向、同走廊，不能把抄近路藏在组内。采集器为多部分组单独算路，单部分组复用对应响应；删除测试只针对导航组边界，跨度覆盖前后完整组，内部组成边界不要求切换。新版采集/组装CLI直接支持，不借用项目外脚本。

报告分别保留`navigationTotalKm`与`compositionDifferenceKm`。独立算路出现米级差异时明确显示两个来源，不强行均摊或按几何拆分；超过10米保持草稿要求检查。这只是数字一致性门槛，不能替代道路审核。

组合导航被拒绝时仍保持草稿，显示有原始证据的组成候选及其原始类型/距离来源；不能使用失败组合的无来源几何或把组成边界伪称无需切换。`navigationGroupsAccepted`明确记录是否采用组合。修正后重新采集或组装并验收，不通过时不要靠隐藏报告异常来启用按钮。

示意：3个组成部分可以使用`navigationGroups:[{firstLeg:1,lastLeg:1,name:"去程",reason:"目标走廊接入",responseFile:"navigation-group-01.json"},{firstLeg:2,lastLeg:3,name:"主线尾段直接返程",reason:"内部边界无需停车切换",responseFile:"navigation-group-02.json"}]`。这不是固定数量要求；未指定组时兼容每leg一个导航段。

优先使用已获授权的高德 Web 服务 Key。在用户对高德算路的授权范围内运行下面的脚本；不要对已有授权反复索取相同确认。它发送每段起终点以及每个非强制边界的合并测试起终点，不上传整个 GPX，Key 从环境变量读取且不写入输出文件。没有 Key 时检查上面的官方网页路径；无法取得可信骑行结果时保留草稿，不改用驾车距离冒充骑行。

先运行只读预检，无需Key、发送确认标志或输出目录：

```sh
node scripts/fetch-amap-bicycle.mjs --manifest manifest.json --dry-run
```

预检验证全部组成端点与导航组覆盖，列出整批组成查询、多组成导航组查询及实际导航边界删除测试；单组成组复用该组成响应，不重复计请求。形状点、关键提示、补给和组内部边界不增加请求或手动切换。输出只含阶段/索引/范围/数量，不含坐标、URL或Key；不估算价格、不查询账户配额、不证明入口合法、必经点已通过或路线已批准。

`--dry-run --max-requests 0`仍输出需求但退出非零，表示当前预算不能执行，绝不是发送许可。真正采集必须明确`--max-requests N`，N来自现有有效授权的有限上限，不由Agent擅自扩大。下面N是需替换的已批准整数，不是推荐预算或既有授权。整批超限或任意后段端点无效时，在读取CLI Key、创建输出或提交第一请求之前拒绝，不部分消耗预算后再停。采集在预检快照上执行，保留`collection-plan.json`及实际成功/失败记录。

```sh
node scripts/fetch-amap-bicycle.mjs --manifest manifest.json --out-dir responses --max-requests N --send-segment-endpoints-to-amap
node scripts/assemble-amap-map.mjs --manifest responses/manifest-with-responses.json --template assets/map-shell.html --out-html map.html --out-report acceptance.json
```

预检是整批计划，不会自动识别或重用目录中的旧成功捕获。只缺一两个跨度时先按原端点、日期和来源核对已有响应，另行规划缺失查询，不为满足整个预检数字就重复提交全线；当前工具没有自动局部重试模式。预检通过后仍须按正常组装流程检查必经点、路权、方向、差异和删除结果。应用层请求数不等于套餐费用，亦不代表官方网页或其他服务获得授权。

直接调用公开批采集函数时同样必须显式传入 `collectToDirectory(manifest, key, outDir, request, {maxRequests: N})`。`N` 必须是有限、非负的安全整数；缺失、`null`、`NaN`、无穷值、负数、小数或字符串，以及不足整批请求数的预算，都会在创建输出目录或调用客户端之前拒绝。恰好或高于整批需求的合法上限可执行；`planCollection` 与 CLI `--dry-run` 仍允许省略上限作本地计划。低层单请求函数是请求原语，不提供完整权限或预算控制系统，调用方仍须遵守已有授权范围。

若骑行响应已由其他经授权的方式保存为 JSON，可直接在清单 `responseFile` 指向每段的原始响应，再运行第二条命令。从网页清单重新查询API时，采集器会把响应类型明确改为 `amap-api-v5` 并移除过期网页几何证据，保留固定路线参考与未完成审核；不能只替换响应文件却继续按网页记录解析。批量采集共享串行节流，默认请求起始间隔400ms；用`--interval-ms 2000`等参数匹配授权或服务限速。每次使用新的空输出目录，逐条保存已成功响应和请求证据；HTTP错误、非JSON、限速失败也保存实际响应体，网络无响应时明确标为空，不虚构body。服务若回显Key，仅该值脱敏并记录，不保存含密钥URL。中途失败保留前面的成功证据和`collection-status.json`，不输出完整成功清单，不自动重试权限、配额或付费错误，也不因接口查询成功就批准道路审核。后续可用实际已保存响应重建候选；不要仅为补一个失败跨度重新查询整个已成功批次。组装器检查 API 成功状态、道路折线和米数、端点与相邻分段连续性、主线相对于固定参考线的偏离、非强制终点的删除测试及人工复核。失败时 HTML 必须显示未完成状态，禁用高德按钮，`usableTotalKm` 保持空值；报告里的候选总和不是可交付骑行里程。

组装器会把随 Skill 附带的 Leaflet 1.9.4 及许可文字嵌入生成的单个 HTML，因此界面脚本不依赖外部 CDN；在线详细底图和高德导航仍需联网，不能把该 HTML 称作完整离线地图。组装完成后仍需在手机和电脑实测：在线底图放大细节、全线是否被面板遮挡、高德按钮是否能在手机调起 `mode=ride`、分段是否覆盖完整路线、GPS 拒绝与弱信号提示，以及每个非强制终点的删除测试。公共版本另做隐私脱敏。API 查询日期、道路开放与高德客户端重新规划风险必须随图交付。
