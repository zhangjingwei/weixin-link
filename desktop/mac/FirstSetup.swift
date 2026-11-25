import AppKit
import CoreImage.CIFilterBuiltins
import SwiftUI

struct SetupEvidence: Decodable {
  var phase: String?
  var model: String?
  var url: String?
  var seconds: Int?
  var device: String?
  var code: String?
}
@MainActor final class FirstSetup: ObservableObject {
  @Published var phase = "checking"
  @Published var busy = ""
  @Published var notice = ""
  @Published var qr: String?
  @Published var device: URL?
  @Published var code = ""
  @Published var model = ""
  @Published var pin = ""
  private var child: Process?, checking = false, generation = 0
  private var expires = Date.distantPast
  let fm = FileManager.default
  var home: String { ProcessInfo.processInfo.environment["HOME"] ?? NSHomeDirectory() }
  var base: String { home + "/.local/share" }
  var standard: String { base + "/weixin-link/source" }
  var legacy: String { base + "/zero-link/source" }
  func present(_ p: String) -> Bool {
    fm.fileExists(atPath: p) || (try? fm.destinationOfSymbolicLink(atPath: p)) != nil
  }
  var root: String { present(legacy) ? legacy : standard }
  var ready: Bool { phase == "ready" && ["configured", "authorized"].contains(model) }
  func launch(_ action: String) throws -> (Process, Pipe, Pipe) {
    guard let res = Bundle.main.resourceURL else { throw CocoaError(.fileNoSuchFile) }
    let p = Process()
    let out = Pipe()
    let input = Pipe()
    let tools = base + "/wechat-ping-bot/tools/node/bin"
    let dirs = [
      tools, home + "/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin",
      "/usr/sbin", "/sbin",
    ]
    p.environment = ProcessInfo.processInfo.environment.merging([
      "PATH": dirs.joined(separator: ":"), "WECHAT_ACCOUNT": "default",
    ]) { _, v in v }
    p.standardError = FileHandle.nullDevice
    p.standardOutput = action == "install" ? FileHandle.nullDevice : out.fileHandleForWriting
    p.standardInput = input
    if action == "install" {
      p.executableURL = URL(fileURLWithPath: "/bin/sh")
      p.arguments = [res.appendingPathComponent("first-install.sh").path]
    } else {
      guard let node = dirs.map({ $0 + "/node" }).first(where: fm.isExecutableFile(atPath:)) else {
        throw CocoaError(.executableNotLoadable)
      }
      p.executableURL = URL(fileURLWithPath: node)
      p.arguments = [res.appendingPathComponent("setup-bridge.mjs").path, root, action]
    }
    try p.run()
    try out.fileHandleForWriting.close()
    return (p, out, input)
  }
  func inspect() async {
    guard !checking, busy.isEmpty else { return }
    checking = true
    defer { checking = false }
    let version = generation
    if Date() >= expires { qr = nil }
    if present(standard) && present(legacy) {
      phase = "conflict"
      return
    }
    if !present(root) {
      phase =
        present(base + "/wechat-ping-bot")
          || present(home + "/Library/LaunchAgents/com.wechat-assistant.wechat-ping-bot.plist")
        ? "conflict" : "install"
      return
    }
    if present(root + "/.mac-first-install") {
      phase = "install"
      return
    }
    do {
      let (p, out, input) = try launch("status")
      try input.fileHandleForWriting.close()
      let result = await Task.detached {
        let d = out.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return p.terminationStatus == 0
          ? try? JSONDecoder().decode(SetupEvidence.self, from: d) : nil
      }.value
      guard generation == version else { return }
      guard let r = result, let stage = r.phase else { throw CocoaError(.fileReadUnknown) }
      phase = stage
      model = r.model ?? ""
      qr = r.url
      expires = Date().addingTimeInterval(Double(r.seconds ?? 0))
      if !stage.hasPrefix("verification_code_") { pin = "" }
    } catch {
      if generation == version {
        phase = "unknown"
        qr = nil
      }
    }
  }
  func act(_ action: String) async {
    guard busy.isEmpty else { return }
    generation += 1
    let version = generation
    busy = action
    notice = ""
    qr = nil
    do {
      let (p, out, input) = try launch(action)
      child = p
      if action == "pin" {
        try input.fileHandleForWriting.write(contentsOf: Data(pin.utf8))
        pin = ""
      }
      if action != "authorize" { try input.fileHandleForWriting.close() }
      for try await line in out.fileHandleForReading.bytes.lines {
        if action == "authorize", generation == version,
          let r = try? JSONDecoder().decode(SetupEvidence.self, from: Data(line.utf8)),
          let s = r.device,
          ["https://auth.openai.com/codex/device", "https://auth.openai.com/device"].contains(s),
          let u = URL(string: s)
        {
          device = u
          code = r.code ?? ""
          NSWorkspace.shared.open(u)
        }
      }
      await Task.detached { p.waitUntilExit() }.value
      withExtendedLifetime(input) {}
      if p.terminationStatus != 0 && generation == version { notice = "这一步未完成，请重新检查后再试。" }
    } catch { notice = "无法完成此步骤，请重新检查。" }
    child = nil
    device = nil
    code = ""
    busy = ""
    await inspect()
  }
  func cancel() {
    if busy == "authorize" {
      generation += 1
      child?.terminate()
      device = nil
      code = ""
      notice = "已取消本次授权，可重新开始。"
    }
  }
}
struct SetupRoot: View {
  @StateObject var setup = FirstSetup()
  @Environment(\.scenePhase) var scene
  var body: some View {
    Group {
      if setup.ready {
        ConversationView()
      } else {
        VStack(alignment: .leading, spacing: 16) {
          Label("Weixin Link", systemImage: "bubble.left.and.bubble.right.fill").foregroundStyle(
            .green
          ).font(.headline)
          Text("连接你的微信助手").font(.largeTitle.bold())
          steps
          if [
            "waiting_scan", "waiting_confirmation", "verification_code_required",
            "verification_code_rejected", "requesting_qr",
          ].contains(setup.phase) && setup.busy.isEmpty {
            button("取消本次扫码", "cancelPair")
          }
          if !setup.notice.isEmpty { Text(setup.notice).foregroundStyle(.secondary) }
          if !setup.busy.isEmpty {
            ProgressView()
            if setup.busy == "authorize" {
              if let url = setup.device {
                Link("重新打开官方授权页", destination: url)
                Text(verbatim: setup.code).font(.title.monospaced()).textSelection(.enabled)
              }
              Button("取消授权") { setup.cancel() }
            }
          } else if setup.phase != "checking" {
            Button("重新检查") { Task { await setup.inspect() } }
          }
        }.padding(36).frame(maxWidth: 520).frame(maxWidth: .infinity, maxHeight: .infinity)
      }
    }.frame(minWidth: 680, minHeight: 440).task {
      while !Task.isCancelled {
        if !setup.ready { await setup.inspect() }
        try? await Task.sleep(nanoseconds: 3_000_000_000)
      }
    }.onChange(of: scene) { p in if p == .active { Task { await setup.inspect() } } }
  }
  func button(_ title: String, _ action: String) -> some View {
    Button(title) { Task { await setup.act(action) } }.buttonStyle(.borderedProminent).disabled(
      !setup.busy.isEmpty)
  }
  @ViewBuilder var steps: some View {
    switch setup.phase {
    case "checking": ProgressView("正在检查本机配置…")
    case "install":
      Text("先为当前 Mac 用户安装本地服务。安装依赖需要联网。")
      button("安装本机服务", "install")
    case "conflict", "unknown": Text("发现已有实例或配置，但未能确认状态。请检查实例是否可用；这里不会覆盖现有数据。")
    default:
      if setup.model == "missing" {
        Text("在官方页面登录模型账号。授权完成后回到这里，应用会再次核对状态。")
        button("开始官方账号授权", "authorize")
      } else {
        switch setup.phase {
        case "stopped":
          Text("已找到微信账号，后台服务尚未启动。")
          button("启动已有服务", "start")
        case "starting", "service_started", "logged_in": ProgressView("等待后台服务就绪…")
        case "verification_code_required", "verification_code_rejected":
          SecureField("微信手机上显示的一次性 PIN", text: $setup.pin)
          button("提交微信验证码", "pin").disabled(
            setup.pin.range(of: #"^\d{4,12}$"#, options: .regularExpression) == nil)
        case "waiting_confirmation", "requesting_qr": ProgressView("等待微信确认…")
        default:
          if let qr = setup.qr, let image = qrImage(qr) {
            Image(nsImage: image).interpolation(.none).resizable().frame(width: 172, height: 172)
              .padding(8).background(.white)
            Text("用手机微信扫码，并在手机上确认。")
          } else {
            Text(
              ["qr_refresh_required", "qr_expired"].contains(setup.phase)
                ? "二维码已过期，请刷新。" : "用手机微信扫码连接本机服务。")
          }
          button(setup.qr == nil ? "获取微信二维码" : "刷新二维码", "qr")
        }
      }
    }
  }
  func qrImage(_ text: String) -> NSImage? {
    let f = CIFilter.qrCodeGenerator()
    f.message = Data(text.utf8)
    guard let im = f.outputImage, let cg = CIContext().createCGImage(im, from: im.extent) else {
      return nil
    }
    return NSImage(cgImage: cg, size: .zero)
  }
}
