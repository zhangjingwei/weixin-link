import AppKit
import SwiftUI

private let leaf = Color(red: 0.23, green: 0.56, blue: 0.24)
private let surface = Color(nsColor: .controlBackgroundColor)

@MainActor struct ConversationView: View {
  @State private var rows: [Snapshot.Conversation] = []
  @State private var selected: String?
  @State private var snapshot: Snapshot?
  @State private var phone: String?
  @State private var online = false
  @State private var editRevision:Int?
  @State private var writing = false
  @State private var drafts: [String: String] = [:]
  @State private var notices: [String: String] = [:]

  @State private var search = ""
  @State private var collapsed = Set<String>()
  @State private var preview: Snapshot.File?
  @State private var diffTurn: String?
  @FocusState private var searching: Bool
  @State private var focusedResult: String?
  func refresh(_ project: String?) async {
    do {
      let data = try await call(Request(action: "view", project: project,result:focusedResult))
      let view = try JSONDecoder().decode(Snapshot.self, from: data)
      guard !Task.isCancelled, selected == project, project == nil || project == view.project else {
        return
      }
      if snapshot?.project != view.project
        || !(view.messages.flatMap { $0.files ?? [] }.contains { $0 == preview })
      {
        preview = nil
      }
      if view.diff == nil || diffTurn != view.target { diffTurn = nil }
      rows = view.conversations
      phone = view.activeProject
      snapshot = view
      online = true
    } catch {
      guard !Task.isCancelled, selected == project else { return }
      online = false
      if case ClientError.rejected = error, project != nil {
        snapshot = nil
        selected = nil
      }
    }
  }

  func select(_ id: String, result: String? = nil) {
    guard id != (selected ?? snapshot?.project) else { return }
    focusedResult = result
    preview = nil
    diffTurn = nil
    snapshot = nil
    selected = id
  }

  func act(_ action: String, _ current: Snapshot) async {
    guard !writing, online, snapshot?.target == current.target,
      current.project == current.activeProject
    else { return }
    writing = true
    defer { writing = false }
    let target = current.target
    let original = drafts[target] ?? ""
    let project = current.project
    do {
      let data = try await call(
        Request(
          action: action, project: project, thread: current.thread, turn: current.turn,
          revision: current.revision, text: action == "take" ? nil : original, id: UUID().uuidString
        ))
      struct Receipt: Decodable { let status: String }
      switch try JSONDecoder().decode(Receipt.self, from: data).status {
      case "taken": editRevision=current.revision+1; notices[project] = "Mac 已接手。"
      case "queued", "accepted":
        notices[project] = action == "steer" ? "补充已提交给原任务。" : "消息已排队。"
        if drafts[target] == original { drafts.removeValue(forKey: target) }
      case "not_sent", "rejected": notices[project] = "未提交，草稿已保留。"
      default: notices[project] = "未取得明确回执，请核对消息后再操作。"
      }
    } catch ClientError.rejected { notices[project] = "操作端或任务已变化，请核对后再试。" } catch {
      notices[project] = "未取得回执，未自动重发。"
    }
    if (selected ?? snapshot?.project) == project { await refresh(selected) }
  }

  func groupName(_ row: Snapshot.Conversation?) -> String {
    guard let row, let group = row.group else { return "独立会话" }
    if let label = row.groupLabel, !label.isEmpty, UUID(uuidString:label) == nil { return label }
    let first = rows.filter { $0.group == group }.map(\.id).min { $0.localizedStandardCompare($1) == .orderedAscending }
    return "项目 " + (first ?? row.id)
  }

  var sidebar: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(leaf)
        Text("Weixin Link")
      }.font(.system(size: 20, weight: .bold)).padding(.top, 18)
      HStack {
        Image(systemName: "magnifyingglass")
        TextField("搜索会话或项目", text: $search).textFieldStyle(.plain).focused($searching)
        Text("⌘K").font(.caption)
      }.foregroundStyle(.secondary).padding(8).background(
        .background, in: RoundedRectangle(cornerRadius: 7)
      ).overlay(RoundedRectangle(cornerRadius: 7).stroke(.secondary.opacity(0.2)))
      Button("") { searching = true }.keyboardShortcut("k").frame(width: 0, height: 0).opacity(0)
        .accessibilityHidden(true)
      Text("项目").font(.caption).foregroundStyle(.secondary)
      ScrollView {
        LazyVStack(alignment: .leading, spacing: 4) {
          let matches = rows.filter {
            search.isEmpty || conversationTitle($0.name,$0.id).localizedCaseInsensitiveContains(search)
              || groupName($0).localizedCaseInsensitiveContains(search)
          }
          let groups = matches.reduce(into: [String]()) { a, r in
            let g = r.group ?? ""
            if !a.contains(g) { a.append(g) }
          }
          ForEach(groups, id: \.self) { g in
            let members = matches.filter { ($0.group ?? "") == g }
            Button {
              if collapsed.contains(g) { collapsed.remove(g) } else { collapsed.insert(g) }
            } label: {
              HStack {
                Image(systemName: collapsed.contains(g) ? "chevron.right" : "chevron.down").font(
                  .caption)
                Image(systemName: "folder")
                Text(groupName(members.first)).lineLimit(1)
                Spacer()
                Text("\(members.count)").font(.caption).foregroundStyle(.secondary)
              }
            }.buttonStyle(.plain).padding(.vertical, 8)
            if !collapsed.contains(g) || !search.isEmpty {
              ForEach(members) { r in
                let chosen = r.id == (selected ?? snapshot?.project)
                Button {
                  select(r.id)
                } label: {
                  HStack {
                    Image(systemName: "bubble.left")
                    Text(conversationTitle(r.name,r.id)).lineLimit(1)
                    Spacer()
                    if r.id == phone {
                      Image(systemName: "iphone").font(.caption).foregroundStyle(.secondary)
                    }
                  }.padding(.horizontal, 12).padding(.vertical, 8).background(
                    chosen ? leaf.opacity(0.16) : .clear, in: RoundedRectangle(cornerRadius: 7)
                  ).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("conversation-" + r.id)
              }
            }
          }
          if matches.isEmpty { Text("没有匹配的会话").foregroundStyle(.secondary) }
        }
      }
      Spacer(minLength: 0)
    }.padding(.horizontal, 14).frame(minWidth: 185, idealWidth: 222, maxWidth: 246).background(
      Color(nsColor: .windowBackgroundColor))
  }
  @ViewBuilder func files(_ items: [Snapshot.File], captions: [String:[String]] = [:]) -> some View {
    if !items.isEmpty {
      VStack(alignment: .leading, spacing: 7) {
        Text("附件 \(items.count) 个").font(.subheadline.weight(.medium))
        ForEach(Array(items.enumerated()), id: \.offset) { _, f in
          let labels = ((captions[f.path] ?? []) + (f.sourcePath.flatMap { captions[$0] } ?? [])).filter { $0 != f.name }
          AttachmentRow(file: f, selected: preview == f, caption:labels.isEmpty ? nil : labels.joined(separator:" · ")) {
            diffTurn = nil
            preview = f
          }
        }
      }
    }
  }
  func messageRow(_ m: Snapshot.Message) -> some View {
    let assistant = m.role == "助手"
    return HStack(alignment: .top, spacing: 9) {
      if assistant {
        Image(systemName: "bubble.left.and.bubble.right.fill").foregroundStyle(.white).padding(7)
          .background(leaf, in: Circle())
      } else {
        Spacer(minLength: 30)
      }
      VStack(alignment: assistant ? .leading : .trailing, spacing: 10) {
        if assistant {
          let aliases = (m.files ?? []).flatMap { f in Set([f.path,f.sourcePath].compactMap { $0 }).map { ($0,f) } }
          let scoped = Dictionary(grouping:aliases,by:{ $0.0 }).compactMapValues { items in
            Set(items.map { $0.1 }).count == 1 ? items.first?.1 : nil
          }
          if let updates=m.updates, !updates.isEmpty { ProgressSummary(steps:updates,title:"本轮最近的进展") }
          ReplyBody(text:m.text, paths:Set(scoped.keys), legacyFooter:m.legacyFooter) { key in
            if let f = scoped[key] { diffTurn = nil; preview = f }
          }.padding(14).background(
            RoundedRectangle(cornerRadius: 12).stroke(.secondary.opacity(0.2)))
          if m.truncated == true { Text("仅显示长回复开头").font(.caption) }
          if let receipt = wechatReceipt(m.delivery) { Label(receipt,systemImage:"info.circle").font(.caption).foregroundStyle(.secondary) }
          if let route = m.route {
            Button("查看会话 \(route.project) 的执行结果") { select(route.project,result:route.result) }
          }
          files(m.files ?? [], captions:attachmentCaptions(m.text,paths:Set(scoped.keys)))
        } else {
          Text(verbatim: m.text).textSelection(.enabled).padding(12).background(
            leaf.opacity(0.14), in: RoundedRectangle(cornerRadius: 12))
          files(m.files ?? [])
        }
      }
      if !assistant {
        Image(systemName: "person.crop.circle.fill").font(.title2).foregroundStyle(.secondary)
      }
    }
  }
  func content(_ view: Snapshot) -> some View {
    let active = view.project == view.activeProject
    let writable = active && view.writer == "mac" && online && editRevision == view.revision
    return VStack(alignment: .leading, spacing: 0) {
      VStack(alignment: .leading, spacing: 4) {
        Text(conversationTitle(view.name,view.project)).font(.title2.bold())
        Text(groupName(rows.first { $0.id == view.project })).font(.subheadline)
          .foregroundStyle(.secondary)
      }.padding(18)
      Divider()
      ScrollViewReader { reader in
        ScrollView {
          LazyVStack(alignment: .leading, spacing: 22) {
            Text("最近的会话记录").font(.caption).foregroundStyle(.secondary)
            ForEach(Array(view.messages.enumerated()), id: \.offset) { i, m in messageRow(m).id(m.resultId ?? "line-\(i)") }
            if view.messages.allSatisfy({ $0.files == nil }) { files(view.files) }
            if view.diff != nil {
              Button {
                preview = nil
                diffTurn = view.target
              } label: {
                Label("查看本轮代码差异", systemImage: "plusminus")
              }
            }
            if let steps = view.progress, !steps.isEmpty {
              ProgressSummary(steps: steps).id(view.target)
            }
            Color.clear.frame(height: 1).id("end")
          }.padding(18)
        }.onAppear {
          if let id = focusedResult, view.messages.contains(where: { $0.resultId == id }) { reader.scrollTo(id,anchor:.top) }
          else { reader.scrollTo("end",anchor:.bottom) }
        }.onChange(
          of: view.messages.last?.time
        ) { _ in if preview == nil && focusedResult == nil { reader.scrollTo("end", anchor: .bottom) } }
      }.id(view.project)
      VStack(alignment: .leading, spacing: 7) {
        if writable {
          HStack {
            TextField(
              view.turn.isEmpty ? "写消息…" : "补充当前任务…",
              text: Binding(get: { drafts[view.target] ?? "" }, set: { drafts[view.target] = $0 }),
              axis: .vertical
            ).lineLimit(1...4).textFieldStyle(.plain)
            Button {
              Task { await act(view.turn.isEmpty ? "send" : "steer", view) }
            } label: {
              Image(systemName: "arrow.up.circle.fill").font(.title2)
            }.buttonStyle(.plain).foregroundStyle(leaf).disabled(
              writing
                || (drafts[view.target] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                  .isEmpty
            ).accessibilityLabel("发送")
          }.padding(12).background(surface, in: RoundedRectangle(cornerRadius: 10))
        }
        HStack {
          Image(systemName: "laptopcomputer")
          Text(!online ? "服务未连接 · 只读" : !active ? "只读浏览会话 \(view.project) · 微信当前会话 \(view.activeProject)" : writable ? "Mac 正在操作" : view.writer == "mac" ? "Mac 持有操作权 · 当前只读" : "微信端正在操作")
          Spacer()
          if !active {
            Button("跟随微信会话") { focusedResult=nil; preview=nil; diffTurn=nil; snapshot=nil; selected=nil }
          }
          if active && !writable && online {
            Button {
              if view.writer == "mac" {editRevision=view.revision}else{Task { await act("take", view) }}
            } label: {
              Text(view.writer == "mac" ? "继续在 Mac 操作":"在 Mac 接手").fontWeight(.medium).foregroundStyle(.white).padding(.horizontal, 12)
                .padding(.vertical, 6).background(leaf, in: RoundedRectangle(cornerRadius: 6))
            }.buttonStyle(.plain).disabled(writing)
          }
        }
        if let n = notices[view.project] { Text(n).font(.caption) }
      }.padding(10).background(
        Color(nsColor: .windowBackgroundColor), in: RoundedRectangle(cornerRadius: 10)
      ).padding(12)
    }.background(surface)
  }
  @ViewBuilder var inspector: some View {
    if let f = preview {
      AttachmentPreview(file: f) { preview = nil }.id(f)
    } else if let v = snapshot, diffTurn == v.target, let diff = v.diff {
      VStack {
        HStack {
          Text("代码差异").font(.headline)
          Spacer()
          Button {
            diffTurn = nil
          } label: {
            Image(systemName: "xmark")
          }
        }.padding()
        Divider()
        ScrollView([.vertical, .horizontal]) {
          LazyVStack(alignment: .leading, spacing: 1) {
            ForEach(Array(diff.components(separatedBy: "\n").enumerated()), id: \.offset) {
              _, line in
              Text(verbatim: line).font(.system(.caption, design: .monospaced)).textSelection(
                .enabled
              ).frame(maxWidth: .infinity, alignment: .leading).background(
                line.hasPrefix("+")
                  ? Color.green.opacity(0.14)
                  : line.hasPrefix("-") ? Color.red.opacity(0.14) : .clear)
            }
          }.padding(8)
        }
        Spacer()
      }.background(Color(nsColor: .windowBackgroundColor))
    }
  }
  var body: some View {
    GeometryReader { geo in
      HStack(spacing: 0) {
        sidebar.frame(width: max(185, min(geo.size.width * 0.23, 230)))
        Divider()
        ZStack(alignment: .trailing) {
          if let current = snapshot {
            content(current)
          } else {
            Text(online ? "正在打开会话…" : "正在连接本机服务").frame(maxWidth: .infinity, maxHeight: .infinity)
          }
          if geo.size.width < 940, preview != nil || diffTurn != nil {
            inspector.frame(maxWidth: 430).shadow(radius: 5)
          }
        }
        if geo.size.width >= 940, preview != nil || diffTurn != nil {
          Divider()
          inspector.frame(width: min(geo.size.width * 0.34, 470))
        }
      }
    }.frame(minWidth: 680, minHeight: 440).tint(leaf).onDisappear { editRevision=nil }.task(id: selected) {
      let p = selected
      while !Task.isCancelled {
        await refresh(p)
        try? await Task.sleep(nanoseconds: 2_000_000_000)
      }
    }
  }
}

private struct ProgressSummary: View {
  let steps: [String]
  var title = "当前任务进展"
  @State private var expanded = false
  var body: some View {
    DisclosureGroup(isExpanded: $expanded) {
      VStack(alignment: .leading, spacing: 6) {
        ForEach(Array(steps.enumerated()), id: \.offset) { _, step in
          Text(verbatim: step).frame(maxWidth: .infinity, alignment: .leading)
        }
      }.font(.callout).padding(.top, 6)
    } label: {
      Label("\(title) · \(steps.count) 项", systemImage: "list.bullet").font(.callout.weight(.medium))
    }.padding(10).background(Color.secondary.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
  }
}
