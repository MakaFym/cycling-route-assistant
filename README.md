# 骑行路线助手

一个面向长距离骑行路线制作的开源实验项目。当前仓库首先开放可复用的 Codex Skill：把 GPX、路书和实际起点整理为固定路线交互地图、低切换频率的高德分段导航方案，以及带证据边界的骑行计划。

## 当前状态

- 已提供：`long-distance-cycling-route-planner` Skill v0.67、地图模板、路线诊断与高德响应组装脚本、自动化测试。
- 规划中：面向普通骑手的微信小程序 MVP，详见 [产品路线](docs/PRODUCT_PLAN.zh-CN.md)。
- 尚未提供：可直接发布的小程序、后台持续导航、真正离线底图、对任意路线可骑行性的保证。

这个项目明确区分三件事：

1. GPX 原始几何是否被完整保留；
2. 高德当前路网能否生成接近的骑行路线；
3. 现场道路是否真实开放并允许骑行。

前两项可以通过软件检查，第三项仍可能需要骑手现场确认。

## 安装 Skill

将 `long-distance-cycling-route-planner` 目录复制到你的 Codex Skills 目录，然后在新会话中使用：

```text
使用 $long-distance-cycling-route-planner，根据我的 GPX 和实际起点生成骑行计划与交互地图。
```

Skill 的完整规则、输入要求和验收边界见 [SKILL.md](long-distance-cycling-route-planner/SKILL.md)。

## 本地测试

需要 Node.js 20 或更高版本：

```powershell
cd long-distance-cycling-route-planner
node --test scripts/*.test.mjs
```

涉及高德 Web 服务的脚本只从环境变量读取 Key。请在本机配置 `AMAP_WEB_SERVICE_KEY`，不要把 Key 写进仓库、地图 HTML、日志或截图。

## 隐私与安全

- 不要提交家庭精确地址、私人起点、完整私人轨迹、住宿订单或账号令牌。
- 公开示例应使用合成数据或经过模糊处理的区域信息。
- 交互地图仅用于辅助核对，不替代交通规则、封路信息、天气预警和现场判断。
- 高德分段链接可能重新算路，不能把任意自定义 GPX 锁定为连续语音导航。

漏洞与敏感信息处理方式见 [SECURITY.md](SECURITY.md)。

## 仓库结构

```text
long-distance-cycling-route-planner/
  SKILL.md           Skill 入口和规则
  references/        生成、分段、交付与验收规范
  scripts/           路线诊断、组装和测试脚本
  assets/            通用交互地图外壳与 Leaflet 资源
docs/
  PRODUCT_PLAN.zh-CN.md
```

## 开源协议

项目采用 [MIT License](LICENSE)。`assets/vendor/leaflet` 保留其原始 BSD-2-Clause 许可文件。


