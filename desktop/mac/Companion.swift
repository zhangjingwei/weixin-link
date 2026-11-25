import SwiftUI
import AppKit

struct Snapshot: Decodable {
    struct Message: Decodable { let role, text: String; let time: Double?; let legacyFooter: String?; let truncated: Bool?; let files: [File]? }
    struct Conversation: Decodable, Identifiable { let id, name: String; let group, groupLabel: String? }
    struct File: Decodable, Hashable { let name, path: String; let root, sourcePath: String? }
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

@main struct CompanionApp: App {
    var body: some Scene { Window("Weixin Link", id: "conversation") { SetupRoot() }.defaultSize(width: 1120, height: 720).windowStyle(.hiddenTitleBar) }
}
