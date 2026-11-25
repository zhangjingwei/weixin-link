import SwiftUI
import AppKit

private let leaf = Color(red: 0.10, green: 0.48, blue: 0.36)
private let surface = Color(nsColor: .controlBackgroundColor)

@MainActor struct ConversationView: View {
    @State private var rows: [Snapshot.Conversation] = []
    @State private var selected: String?
    @State private var snapshot: Snapshot?
    @State private var phone: String?
    @State private var online = false
    @State private var writing = false
    @State private var drafts: [String:String] = [:]
    @State private var notices: [String:String] = [:]

    func refresh(_ project: String?) async {
        do {
            let data = try await call(Request(action: "view", project: project))
            let view = try JSONDecoder().decode(Snapshot.self, from: data)
            guard !Task.isCancelled, selected == project, project == nil || project == view.project else { return }
            rows = view.conversations; phone = view.activeProject; snapshot = view; online = true
        } catch {
            guard !Task.isCancelled, selected == project else { return }
            online = false
            if case ClientError.rejected = error, project != nil { snapshot = nil; selected = nil }
        }
    }

    func select(_ id: String) {
        guard id != (selected ?? snapshot?.project) else { return }
        snapshot = nil; selected = id
    }

    func act(_ action: String, _ current: Snapshot) async {
        guard !writing, online, snapshot?.target == current.target, current.project == current.activeProject else { return }
        writing = true; defer { writing = false }
        let target = current.target, original = drafts[target] ?? "", project = current.project
        do {
            let data = try await call(Request(action: action, project: project, thread: current.thread, turn: current.turn, revision: current.revision, text: action == "take" ? nil : original, id: UUID().uuidString))
            struct Receipt: Decodable { let status: String }
            switch try JSONDecoder().decode(Receipt.self, from: data).status {
            case "taken": notices[project] = "Mac 已接手。"
            case "queued", "accepted": notices[project] = action == "steer" ? "补充已提交给原任务。" : "消息已排队。"; if drafts[target] == original { drafts.removeValue(forKey: target) }
            case "not_sent", "rejected": notices[project] = "未提交，草稿已保留。"
            default: notices[project] = "未取得明确回执，请核对消息后再操作。"
            }
        } catch ClientError.rejected { notices[project] = "操作端或任务已变化，请核对后再试。" }
        catch { notices[project] = "未取得回执，未自动重发。" }
        if (selected ?? snapshot?.project) == project { await refresh(selected) }
    }

    var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Image(systemName: "bubble.left.and.bubble.right.fill").font(.system(size: 18)).foregroundStyle(.white).frame(width: 36,height: 36).background(leaf,in: RoundedRectangle(cornerRadius: 11))
                Text("Weixin Link").font(.system(size: 19, weight: .semibold, design: .rounded))
            }.padding(.horizontal,20).padding(.vertical,24)
            HStack { Text("会话").font(.headline); Spacer(); Text("\(rows.count)").font(.caption.monospacedDigit()).foregroundStyle(.secondary) }.padding(.horizontal,22).padding(.bottom,10)
            ScrollView { LazyVStack(spacing: 4) {
                ForEach(rows) { row in
                    let chosen = row.id == (selected ?? snapshot?.project)
                    Button { select(row.id) } label: {
                        HStack(spacing: 10) {
                            Image(systemName: chosen ? "text.bubble.fill" : "text.bubble").foregroundStyle(chosen ? leaf : .secondary)
                            Text(row.name).font(.system(size: 14, weight: chosen ? .semibold : .regular)).lineLimit(2).multilineTextAlignment(.leading)
                            Spacer(minLength: 2)
                            if row.id == phone { Image(systemName: "iphone").foregroundStyle(.secondary).help("微信当前会话") }
                        }.padding(.horizontal,12).padding(.vertical,11).frame(maxWidth:.infinity, alignment:.leading).background(chosen ? leaf.opacity(0.15) : .clear,in: RoundedRectangle(cornerRadius:8)).contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityIdentifier("conversation-" + row.id).accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }.padding(.horizontal,10) }
            Divider(); Label(online ? "本机服务已连接" : "本机服务未连接",systemImage: "circle.fill").font(.caption).foregroundStyle(online ? leaf : .secondary).padding(18)
        }.frame(minWidth:205,idealWidth:235,maxWidth:280).background(Color(nsColor:.windowBackgroundColor))
    }

    func messageRow(_ message: Snapshot.Message) -> some View {
        let assistant = message.role == "助手"
        return HStack(alignment:.top,spacing:12) {
            Image(systemName:assistant ? "sparkle" : "person.fill").font(.system(size:14,weight:.medium)).foregroundStyle(assistant ? leaf : .secondary).frame(width:30,height:30).background(assistant ? leaf.opacity(0.12) : Color.secondary.opacity(0.09),in:RoundedRectangle(cornerRadius:9))
            VStack(alignment:.leading,spacing:7) {
                HStack(spacing:9) { Text(message.role).font(.headline); if let time = message.time { Text(Date(timeIntervalSince1970:time/1000),style:.time).font(.caption.monospacedDigit()).foregroundStyle(.secondary) } }
                if assistant { ReplyBody(text:message.text) } else { Text(verbatim:message.text).font(.system(size:15)).lineSpacing(4).textSelection(.enabled).padding(12).background(leaf.opacity(0.075),in:RoundedRectangle(cornerRadius:10)) }
                if message.truncated == true { Text("长回复仅显示开头，可在微信查询完整结果。").font(.caption).foregroundStyle(.secondary) }
            }.frame(maxWidth:.infinity,alignment:.leading)
        }
    }

    @ViewBuilder func content(_ view: Snapshot) -> some View {
        let active = view.project == view.activeProject, writable = active && view.writer == "mac" && online
        VStack(alignment:.leading,spacing:0) {
            HStack {
                VStack(alignment:.leading,spacing:7) { Label(active ? "微信当前会话" : "会话预览",systemImage:active ? "iphone" : "text.bubble").font(.caption).foregroundStyle(.secondary); Text(view.name).font(.system(size:25,weight:.semibold)).lineLimit(2) }
                Spacer(); if active && view.writer != "mac" { Button("在 Mac 接手") { Task { await act("take", view) } }.disabled(!online || writing) }
            }.padding(.horizontal,28).padding(.vertical,20)
            Divider()
            ScrollViewReader { reader in ScrollView { LazyVStack(alignment:.leading,spacing:25) {
                if view.messages.isEmpty { Label("这个会话还没有近期消息",systemImage:"bubble.left").foregroundStyle(.secondary) }
                ForEach(Array(view.messages.enumerated()),id:\.offset) { _, item in messageRow(item) }
                if let steps=view.progress,!steps.isEmpty { ProgressSummary(steps:steps).id(view.target) }
                Color.clear.frame(height:1).id("end")
            }.padding(28) }.onAppear { reader.scrollTo("end",anchor:.bottom) }.onChange(of:view.messages.last?.time) { _ in reader.scrollTo("end",anchor:.bottom) } }.id(view.project)
            if !view.files.isEmpty {
                Divider(); ScrollView(.horizontal) { HStack { ForEach(Array(view.files.enumerated()),id:\.offset) { _, file in Button { if FileManager.default.fileExists(atPath:file.path) { NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath:file.path)]) } else { notices[view.project] = "文件已过期或不在本机。" } } label: {
                    HStack { Image(systemName:"doc.fill").foregroundStyle(leaf); VStack(alignment:.leading,spacing:2) {Text(verbatim:file.name).font(.callout.weight(.medium)).lineLimit(1).truncationMode(.middle);Text("在 Finder 中显示").font(.caption2).foregroundStyle(.secondary)} }.padding(.horizontal,12).padding(.vertical,7).background(Color.secondary.opacity(0.08),in:RoundedRectangle(cornerRadius:8))
                }.buttonStyle(.plain).help(file.name) } } }.padding(.horizontal,28).padding(.vertical,9)
            }
            Divider()
            VStack(alignment:.leading,spacing:10) {
                if writable { HStack { TextField(view.turn.isEmpty ? "写消息…" : "补充当前任务…",text:Binding(get:{ drafts[view.target] ?? "" },set:{ drafts[view.target] = $0 }),axis:.vertical).lineLimit(1...4).textFieldStyle(.plain); Button { Task { await act(view.turn.isEmpty ? "send" : "steer",view) } } label:{Image(systemName:"arrow.up.circle.fill").font(.title2)}.buttonStyle(.plain).foregroundStyle(leaf).disabled(writing || (drafts[view.target] ?? "").trimmingCharacters(in:.whitespacesAndNewlines).isEmpty).accessibilityLabel("发送") }.padding(12).background(surface,in:RoundedRectangle(cornerRadius:10)) }
                Label(!online ? "服务未连接 · 只读" : !active ? "仅浏览此会话 · 微信仍停留在原会话" : writable ? "Mac 正在操作" : "微信正在操作 · Mac 只读",systemImage:writable ? "macbook" : "eye").font(.caption).foregroundStyle(.secondary)
                if let notice = notices[view.project] { Text(notice).font(.caption) }
            }.padding(.horizontal,28).padding(.vertical,16).frame(maxWidth:.infinity,alignment:.leading).background(Color(nsColor:.windowBackgroundColor))
        }.background(surface)
    }

    var body: some View {
        HSplitView { sidebar; Group { if let current = snapshot { content(current) } else { VStack(spacing:12) { Image(systemName:"bubble.left.and.bubble.right").font(.largeTitle).foregroundStyle(leaf); Text(online ? "正在打开会话…" : "正在连接本机服务").font(.headline); if !online { Text("请确认本机服务已更新并启动。").foregroundStyle(.secondary) } }.frame(maxWidth:.infinity,maxHeight:.infinity) } }.frame(minWidth:430) }
            .frame(minWidth:680,minHeight:440).tint(leaf).task(id:selected) { let project = selected; while !Task.isCancelled { await refresh(project); try? await Task.sleep(nanoseconds:2_000_000_000) } }
    }
}

private struct ProgressSummary: View {
    let steps: [String]
    @State private var expanded=false
    var body: some View { DisclosureGroup(isExpanded:$expanded) { VStack(alignment:.leading,spacing:6) { ForEach(Array(steps.enumerated()),id:\.offset) { _,step in Text(verbatim:step).frame(maxWidth:.infinity,alignment:.leading) } }.font(.callout).padding(.top,6) } label:{Label("当前任务进展 · \(steps.count) 项",systemImage:"list.bullet").font(.callout.weight(.medium))}.padding(10).background(Color.secondary.opacity(0.06),in:RoundedRectangle(cornerRadius:8)) }
}
