import SwiftUI
import AppKit

struct Snapshot: Decodable {
    struct Message: Decodable { let role, text: String }
    struct File: Decodable { let name, path: String }
    let name, project, thread, turn, writer: String
    let revision: Int
    let messages: [Message], files: [File]
    var target: String { "\(project)/\(thread)/\(turn)/\(revision)" }
}

struct Request: Encodable {
    var action: String
    var project: String?, thread: String?, turn: String?, revision: Int?, text: String?, id: String?
}

enum ClientError: Error { case rejected, unavailable }
func call(_ request: Request) async throws -> Data {
    let body = try JSONEncoder().encode(request)
    return try await Task.detached {
        let process = Process(), input = Pipe(), output = Pipe()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/curl")
        let socket = ProcessInfo.processInfo.environment["WEIXIN_LINK_MAC_SOCKET"] ?? FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".local/share/wechat-ping-bot/runtime.sock").path
        process.arguments = ["--disable", "--silent", "--fail", "--noproxy", "*", "--max-time", "12", "--unix-socket", socket, "--data-binary", "@-", "http://localhost/mac-companion"]
        process.standardInput = input; process.standardOutput = output; process.standardError = FileHandle.nullDevice
        try process.run()
        try input.fileHandleForWriting.write(contentsOf: body); try input.fileHandleForWriting.close()
        let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
        guard process.terminationStatus == 0 else { throw process.terminationStatus == 22 ? ClientError.rejected : ClientError.unavailable }
        return data
    }.value
}

@MainActor struct ConversationView: View {
    @State private var snapshot: Snapshot?
    @State private var draftTarget: String?
    @State private var draft = ""
    @State private var feedback = ""
    @State private var writing = false
    @State private var online = false
    func refresh() async {
        do { let data = try await call(Request(action: "view")); snapshot = try JSONDecoder().decode(Snapshot.self, from: data); online = true }
        catch { online = false }
    }
    func act(_ action: String, _ current: Snapshot) async {
        guard !writing else { return }; writing = true; defer { writing = false }
        let target = current.target, original = draft
        do {
            let data = try await call(Request(action: action, project: current.project, thread: current.thread, turn: current.turn, revision: current.revision, text: action == "take" ? nil : original, id: UUID().uuidString))
            struct Receipt: Decodable { let status: String }
            switch try JSONDecoder().decode(Receipt.self, from: data).status {
            case "taken": feedback = "Mac 已接手。"
            case "queued", "accepted": feedback = action == "steer" ? "补充已提交给原任务。" : "消息已排队。"; if draft == original && draftTarget == target { draft = ""; draftTarget = nil }
            case "not_sent", "rejected": feedback = "补充未提交。草稿已保留。"
            default: feedback = "提交结果待核对，请先查看会话。"
            }
        } catch ClientError.rejected { feedback = "服务拒绝了操作，请核对当前操作端和任务。" }
        catch { feedback = "未取得回执，请先核对会话；未自动重发。" }
        await refresh()
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading) { Text(snapshot?.name ?? "Weixin Link").font(.title2.bold()); Text(online ? (snapshot?.writer == "mac" ? "Mac 正在操作" : "微信正在操作 · Mac 只读") : "未连接：请确认本机服务已手动更新并启动").foregroundColor(.secondary) }
                Spacer()
                if online, let current = snapshot, current.writer != "mac" { Button("在 Mac 接手") { Task { await act("take", current) } }.disabled(writing) }
            }
            Divider()
            ScrollView { VStack(alignment: .leading, spacing: 12) {
                if snapshot?.messages.isEmpty != false { Text("暂无可显示的近期消息").foregroundColor(.secondary) }
                ForEach(Array((snapshot?.messages ?? []).enumerated()), id: \.offset) { _, message in VStack(alignment: .leading) { Text(message.role).font(.caption.bold()); Text(message.text).textSelection(.enabled) } }
            }.frame(maxWidth: .infinity, alignment: .leading) }
            if let files = snapshot?.files, !files.isEmpty { Menu("共享文件（\(files.count)）") { ForEach(Array(files.enumerated()), id: \.offset) { _, file in Button(file.name) { if FileManager.default.fileExists(atPath: file.path) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: file.path)]) } else { feedback = "文件已过期或不在本机。" } } } } }
            if let current = snapshot, current.writer == "mac" {
                TextField(current.turn.isEmpty ? "发给当前会话" : "补充到正在执行的任务", text: $draft, axis: .vertical).textFieldStyle(.roundedBorder).lineLimit(1...5).onChange(of: draft) { value in if value.isEmpty { draftTarget = nil } else if draftTarget == nil { draftTarget = current.target } }
                if !draft.isEmpty && draftTarget != current.target { Button("将草稿用于当前会话和任务") { draftTarget = current.target } }
                Button(current.turn.isEmpty ? "发送" : "补充要求") { Task { await act(current.turn.isEmpty ? "send" : "steer", current) } }.disabled(!online || writing || draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draftTarget != current.target)
            }
            Text(feedback).font(.caption).foregroundColor(.secondary)
        }.padding(20).frame(minWidth: 530, minHeight: 420).task { while !Task.isCancelled { await refresh(); try? await Task.sleep(nanoseconds: 2_000_000_000) } }
    }
}

@main struct CompanionApp: App {
    var body: some Scene { Window("Weixin Link", id: "conversation") { ConversationView() }.defaultSize(width: 720, height: 600) }
}
