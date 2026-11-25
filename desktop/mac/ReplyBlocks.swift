import AppKit
import SwiftUI

enum ReplyBlock: Equatable {
  case paragraph(String)
  case heading(Int, String)
  case bullet(String, String)
  case quote(String)
  case code(String, String)

  static func parse(_ source: String) -> [ReplyBlock] {
    let lines = (source as NSString).components(separatedBy: "\n")
    var result: [ReplyBlock] = []
    var prose: [String] = []
    var index = 0
    func flush() {
      if !prose.isEmpty {
        result.append(.paragraph(prose.joined(separator: "\n")))
        prose.removeAll()
      }
    }
    while index < lines.count {
      let raw = lines[index]
      let line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
      index += 1
      let token = line.prefix { $0 == line.first }
      let rest = line.dropFirst(token.count)
      if let first = token.first, first == "`" || first == "~", token.count >= 3,
        !(first == "`" && rest.contains("`"))
      {
        flush()
        var code = ""
        while index < lines.count {
          let part = lines[index]
          let end = part.trimmingCharacters(in: .whitespacesAndNewlines)
          index += 1
          if end.count >= token.count && end.allSatisfy({ $0 == first }) { break }
          code += part + (index < lines.count ? "\n" : "")
        }
        result.append(.code(rest.trimmingCharacters(in: .whitespaces), code))
      } else if token.first == "#", token.count <= 6, rest.first == " " {
        flush()
        result.append(.heading(token.count, String(rest.dropFirst())))
      } else if line.hasPrefix(">") {
        flush()
        let body = line.dropFirst()
        result.append(.quote(String(body.first == " " ? body.dropFirst() : body)))
      } else if let space = line.firstIndex(of: " "), space != line.startIndex {
        let marker = String(line[..<space])
        let number = marker.dropLast()
        if ["-", "*", "+"].contains(marker)
          || (marker.last == "." && !number.isEmpty && number.allSatisfy(\.isNumber))
        {
          flush()
          result.append(.bullet(marker, String(line[line.index(after: space)...])))
        } else {
          prose.append(line)
        }
      } else if line.isEmpty {
        flush()
      } else {
        prose.append(line)
      }
    }
    flush()
    return result
  }
}

struct ReplyBody: View {
  let text: String
  var paths: Set<String> = []
  var legacyFooter: String? = nil
  var openFile: (String)->Void = { _ in }
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      let blocks = ReplyBlock.parse(text)
      ForEach(Array(blocks.enumerated()), id: \.offset) { index, block in
        switch block {
        case .paragraph(let value):
          if value == legacyFooter && text.hasSuffix("\n\n" + value) && index == blocks.count - 1 {
            DisclosureGroup("执行状态") { Text(verbatim:value) }.font(.caption).foregroundStyle(.secondary)
          } else {
            let visible = value.components(separatedBy:"\n").filter { !onlyFileLinks($0,paths:paths) }.joined(separator:"\n")
            if !visible.isEmpty { prose(visible) }
          }
        case .heading(let level, let value):
          prose(value).font(.system(size: level < 3 ? 19 : 16, weight: .semibold)).padding(
            .top, 3)
        case .bullet(let marker, let value):
          if !onlyFileLinks(value,paths:paths) { HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker.count == 1 ? "•" : marker).foregroundStyle(.secondary)
            prose(value)
          }.padding(.leading, 5) }
        case .quote(let value):
          prose(value).foregroundStyle(.secondary).padding(.leading, 12).overlay(
            alignment: .leading
          ) { Capsule().fill(Color.secondary.opacity(0.35)).frame(width: 3) }
        case .code(let language, let raw): CodeCard(language: language, raw: raw)
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading).font(.system(size: 15)).lineSpacing(3)
  }
  private func prose(_ value: String) -> some View {
    let spans = replySpans(value,paths:paths)
    return Group {
      if spans.contains(where: { if case .web = $0 { return true }; if case .file = $0 { return true }; return false }) {
        InlineFlow {
          ForEach(Array(spans.enumerated()),id: \.offset) { _, span in
            switch span {
            case .web(let label,let url): Button { NSWorkspace.shared.open(url) } label: { Text(verbatim:label).underline() }.buttonStyle(.plain).foregroundStyle(Color.accentColor).accessibilityAddTraits(.isLink)
            case .file(let label,let key): Button { openFile(key) } label: { Text(verbatim:label).underline() }.buttonStyle(.plain).foregroundStyle(Color.accentColor).accessibilityAddTraits(.isLink)
            default: styled(span)
            }
          }
        }
      } else { spans.reduce(Text("")) { $0 + styled($1) }.textSelection(.enabled) }
    }
  }
  private func styled(_ span: ReplySpan) -> Text {
    switch span { case .plain(let s):return Text(verbatim:s); case .strong(let s):return Text(verbatim:s).bold(); case .code(let s):return Text(verbatim:s).font(.system(size:14,design:.monospaced)); default:return Text("") }
  }

}

func copyCode(_ raw: String, to pasteboard: NSPasteboard) -> Bool {
  pasteboard.clearContents()
  return pasteboard.setString(raw, forType: .string)
}

private struct CodeCard: View {
  let language, raw: String
  @State private var copied = false
  var body: some View {
    VStack(alignment: .leading, spacing: 0) {
      HStack {
        Label(
          language.isEmpty ? "代码" : language, systemImage: "chevron.left.forwardslash.chevron.right"
        )
        Spacer()
        Button {
          copied = copyCode(raw, to: .general)
        } label: {
          Label(copied ? "已复制" : "复制", systemImage: copied ? "checkmark" : "doc.on.doc")
        }.buttonStyle(.plain)
      }.font(.caption).padding(9)
      Divider()
      ScrollView(.horizontal) {
        Text(verbatim: raw.hasSuffix("\n") ? String(raw.dropLast()) : raw).font(
          .system(size: 13, design: .monospaced)
        ).fixedSize().padding(12)
      }
    }.background(Color.secondary.opacity(0.07), in: RoundedRectangle(cornerRadius: 8)).overlay(
      RoundedRectangle(cornerRadius: 8).stroke(Color.secondary.opacity(0.2))
    ).onChange(of: raw) { _ in copied = false }
  }
}

private struct InlineFlow: Layout {
  func positions(_ width: CGFloat, _ subviews: Subviews) -> ([CGPoint], CGFloat) {
    var x: CGFloat = 0
    var y: CGFloat = 0
    var h: CGFloat = 0
    var points: [CGPoint] = []
    for child in subviews {
      let size = child.sizeThatFits(.init(width: width, height: nil))
      if x > 0 && x + size.width > width {
        x = 0
        y += h + 3
        h = 0
      }
      points.append(.init(x: x, y: y))
      x += size.width
      h = max(h, size.height)
    }
    return (points, y + h)
  }
  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let width = proposal.width ?? subviews.reduce(0) { $0 + $1.sizeThatFits(.unspecified).width }
    return .init(width: width, height: positions(width, subviews).1)
  }
  func placeSubviews(
    in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()
  ) {
    for (v, p) in zip(subviews, positions(bounds.width, subviews).0) {
      let s = v.sizeThatFits(.init(width: bounds.width, height: nil))
      v.place(
        at: .init(x: bounds.minX + p.x, y: bounds.minY + p.y), anchor: .topLeading,
        proposal: .init(s))
    }
  }
}
// Link destinations are matched inside one message. Only the archived file is opened by the caller.
private let inlinePattern = try! NSRegularExpression(pattern: #"(`+)([^\n]*?)\1(?!`)|!?\[([^\]\n]+)\]\((?:<([^>\n]+)>|([^\s)]+))\)|(https?://[^\s<>，。；）]+)|\*\*([^*\n]+)\*\*"#)
enum ReplySpan: Equatable {
  case plain(String), strong(String), code(String), web(String, URL), file(String, String)
}
func replySpans(_ source: String, paths: Set<String>) -> [ReplySpan] {
  let ns = source as NSString
  var spans: [ReplySpan] = [], start = 0
  for match in inlinePattern.matches(in: source, range: NSRange(location: 0, length: ns.length)) {
    func field(_ i: Int) -> String? { let r = match.range(at: i); return r.location == NSNotFound ? nil : ns.substring(with: r) }
    if start < match.range.location { spans.append(.plain(ns.substring(with: NSRange(location:start,length:match.range.location-start)))) }
    if let code = field(2) { spans.append(.code(code)) }
    else if let strong = field(7) { spans.append(.strong(strong)) }
    else if let target = field(4) ?? field(5) ?? field(6) {
      let label = field(3) ?? target
      let path = target.hasPrefix("sandbox:/") ? String(target.dropFirst(8)) : target
      if paths.contains(path) { spans.append(.file(label,path)) }
      else if let u = URL(string:target), ["https","http"].contains(u.scheme?.lowercased()), u.host != nil { spans.append(.web(label,u)) }
      else if path.hasPrefix("/") { spans.append(.plain(label)) }
      else { spans.append(.plain(field(0)!)) }
    }
    start = NSMaxRange(match.range)
  }
  if start < ns.length { spans.append(.plain(ns.substring(from:start))) }
  return spans
}
func onlyFileLinks(_ line: String, paths: Set<String>) -> Bool {
  let spans = replySpans(line,paths:paths)
  return spans.contains { if case .file = $0 { return true }; return false } && spans.allSatisfy {
    switch $0 { case .file: return true; case .plain(let s): return s.trimmingCharacters(in:CharacterSet.whitespaces.union(CharacterSet(charactersIn:"·、|"))).isEmpty; default: return false }
  }
}

func conversationTitle(_ raw: String, _ id: String) -> String {
  let clean = raw.replacingOccurrences(of: #"(?s)(?:接入层(?:任务状态|记忆)元数据\s*nonce=.*|接入层任务状态(?:元(?:数(?:据)?)?)?(?:…|\.{3})?)$"#,with:"",options:.regularExpression).trimmingCharacters(in:.whitespacesAndNewlines)
  return clean.isEmpty || UUID(uuidString:clean) != nil ? "会话 " + id : clean
}

// Preserve descriptive labels from rows compacted into attachment cards.
func attachmentCaptions(_ source: String, paths: Set<String>) -> [String:[String]] {
  var labels: [String:[String]] = [:]
  for block in ReplyBlock.parse(source) {
    let text: String
    switch block { case .paragraph(let s), .bullet(_,let s): text = s; default: continue }
    for line in text.components(separatedBy:"\n") where onlyFileLinks(line,paths:paths) {
      for case .file(let label,let key) in replySpans(line,paths:paths) where !(labels[key] ?? []).contains(label) { labels[key,default:[]].append(label) }
    }
  }
  return labels
}
