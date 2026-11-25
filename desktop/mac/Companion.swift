import SwiftUI
import AppKit

struct Snapshot: Decodable {
    struct ResultLink: Decodable { let project, result: String }
    struct Message: Decodable { let role, text: String; let time: Double?; let messageId, resultId, delivery, legacyFooter: String?; let updates: [String]?; let route: ResultLink?; let truncated: Bool?; let files: [File]? }
    struct Conversation: Decodable, Identifiable { let id, name: String; let group, groupLabel: String? }
    struct File: Decodable, Hashable { let name, path: String; let root, sourcePath, delivery: String? }
    let name, project, thread, turn, writer: String
    let revision: Int
    let progress: [String]?
    let diff:String?
    let messages: [Message], files: [File]
    let conversations: [Conversation], activeProject: String
    var target: String { "\(project)/\(thread)/\(turn)/\(revision)" }
}

struct Request: Encodable {
    var action: String
    var project: String?, thread: String?, turn: String?, revision: Int?, text: String?, id: String?, result: String?
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

@main struct CompanionApp: App {
    var body: some Scene { Window("Weixin Link", id: "conversation") { SetupRoot() }.defaultSize(width: 1120, height: 720).windowStyle(.hiddenTitleBar) }
}

func wechatReceipt(_ state: String?) -> String? {
    switch state {
    case "failed": return "微信发送失败"
    case "partial": return "部分内容未确认送达微信"
    case "unknown", "sending": return "微信发送结果待确认"
    case "pending", "deferred": return "等待发送到微信"
    case "cancelled": return "微信发送已取消"
    default: return nil
    }
}
