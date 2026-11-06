Home Assistant 仅授权读取设备状态、房间信息和历史；不能开关设备或修改配置。
通过源码目录的 `node src/integrations/cli.mjs call home-assistant` 调用，JSON 从标准输入提供：
- 状态查询：`{"operation":"states","query":"书房"}`；省略 query 可列出设备。
- 历史查询：`{"operation":"history","entityId":"sensor.example_temperature","hours":24}`；范围 1–168 小时。
先查询实际 entity_id，再查历史。匹配是简单文本搜索；无匹配时缩短关键词。
工具返回原始记录，最高/最低值与趋势由智能体分析；不填补 unknown/unavailable 缺测。
若返回 HA_REGISTRY_UNAVAILABLE，房间和设备元数据未能取得，不能据此断言设备不属于某个房间。
凭据由工具读取，不输出令牌，不绕过工具调用写接口。配置和启用是两个独立步骤；禁用后不可继续调用。
