# 服务维护

1. 判断用户要做什么：
   - 查询服务、安装、诊断或维护状态 → 直接调用对应查询工具。
   - 检查更新 → 执行“检查更新”工作流。
   - 跳过某个版本 → 执行“跳过版本”工作流。
   - 重启当前账号 → 执行“重启服务”工作流。
   - 升级共享安装 → 执行“升级安装”工作流。

## 检查更新

1. 调用 `check_updates`，核对当前版本与可用版本。
2. 报告查询结果；不自行跳过或升级。

## 跳过版本

1. 调用 `check_updates`，核对用户要跳过的确切版本并取得 `updateToken`。
2. 调用 `skip_update`；核对工具回执，后续出现的新版本不受影响。

## 重启服务

1. 用 `get_service_status` 和 `get_maintenance_status` 核对当前账号状态及已有维护请求。
2. 调用 `request_service_restart`；按工具回执及后续 `get_maintenance_status` 核对结果。`pending` 或 `scheduled` 只表示已安排。

## 升级安装

1. 调用 `check_updates`，核对目标版本并取得 `updateToken`；升级影响共享安装中的账号。
2. 调用 `request_upgrade`；按工具回执及后续 `get_maintenance_status` 核对结果。`pending` 或 `scheduled` 只表示已安排，目标版本变化时重新检查更新。
