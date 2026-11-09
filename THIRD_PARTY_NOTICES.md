# 第三方依赖与许可证说明

本项目自有代码采用 MIT，见 LICENSE。第三方包、内嵌代码、原生库及下载的可执行文件保留其原始许可证和版权声明；本文件不对其重新授权。

## 直接 npm 依赖

以下依据本仓库 package-lock.json 中声明的版本和 license 字段整理。它是清单，不替代各包随附的 LICENSE、NOTICE、源码提供要求或实际构建核查。

- `@napi-rs/canvas` 1.0.11：MIT。
- `wechatbot-zerolink` 2.2.0-zerolink.2：MIT，基于 `@wechatbot/wechatbot` 2.2.0；来源提交与校验值见 `vendor/README.md`，包内保留原许可证。
- `pdfjs-dist` 6.4.299：Apache-2.0。
- `qrcode` 1.5.4：MIT。
- `sharp` 0.35.5：Apache-2.0。
- `silk-wasm` 3.7.1：MIT。
- `proper-lockfile` 4.1.2：MIT。
- `@ffmpeg-installer/darwin-arm64` 4.1.5：https://git.ffmpeg.org/gitweb/ffmpeg.git/blob_plain/HEAD:/LICENSE.md。
- `@ffmpeg-installer/darwin-x64` 4.1.0：LGPL-2.1。
- `@ffmpeg-installer/linux-arm64` 4.1.4：GPLv3。
- `@ffmpeg-installer/linux-x64` 4.1.0：GPLv3。
- `@ffmpeg-installer/win32-x64` 4.1.0：GPLv3。

## 原生库与二进制

FFmpeg 平台包的许可声明并不一致：当前锁文件中 Linux arm64/x64 和 Windows x64 标注 GPLv3，macOS x64 标注 LGPL-2.1，macOS arm64 指向 FFmpeg 上游 LICENSE.md。不能将这些二进制标记为 MIT，也不能仅凭包装包的声明判断实际编译产物的全部义务。

若制作包含 node_modules、FFmpeg、浏览器、容器镜像或其他原生库的安装包，应核查实际分发版本、编译选项、上游许可证与 NOTICE，并落实适用的源码提供及声明保留要求。当前文档没有完成这些二进制的分发审计。sharp、canvas 等包所使用的底层库也需分别核查。

## SDK 修改与传递依赖

本仓库分发来自独立 `wechatbot-zerolink` 项目的固定 SDK 包。该包保留上游 MIT 许可证与归属说明，源码修改包括绑定协议兼容、游标持久化、发送结果、精确消息 ID、引用字段、原子存储和上传超时。安装时不修改 `node_modules`。

升级依赖时同步更新本清单；传递依赖以锁文件和实际安装内容为准，本清单未穷举。部署者安装的 Codex、Podman、Python 库、浏览器、字体与其他外部工具各自遵循上游许可证和使用条件。

## 第三方内容与服务

用户附件、聊天记录、RSS 正文、网站内容、图片和字体不因项目采用 MIT 而获得转载授权。凭据、SSH 密钥、HA 令牌和账号配置不属于源码发布内容。微信与 OpenAI 等名称属于各自权利人，项目不作官方关联声明。
