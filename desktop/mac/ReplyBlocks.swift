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
  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(Array(ReplyBlock.parse(text).enumerated()), id: \.offset) { _, block in
        switch block {
        case .paragraph(let value): inlineLinks(value)
        case .heading(let level, let value):
          Text(verbatim: value).font(.system(size: level < 3 ? 19 : 16, weight: .semibold)).padding(
            .top, 3)
        case .bullet(let marker, let value):
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(marker.count == 1 ? "•" : marker).foregroundStyle(.secondary)
            inlineLinks(value)
          }.padding(.leading, 5)
        case .quote(let value):
          inlineLinks(value).foregroundStyle(.secondary).padding(.leading, 12).overlay(
            alignment: .leading
          ) { Capsule().fill(Color.secondary.opacity(0.35)).frame(width: 3) }
        case .code(let language, let raw): CodeCard(language: language, raw: raw)
        }
      }
    }.frame(maxWidth: .infinity, alignment: .leading).font(.system(size: 15)).lineSpacing(3)
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

// Preserve plain prose; only explicit web links are interactive.
@ViewBuilder func inlineLinks(_ source: String) -> some View {
  let value = webLinkText(source)
  if value.runs.contains(where: { $0.link != nil }) {
    ClickableWebProse(value: value)
  } else {
    Text(verbatim: source).textSelection(.enabled)
  }
}
private struct ClickableWebProse: View {
  let value: AttributedString
  var body: some View {
    let pieces = value.runs.flatMap { run -> [(String, URL?)] in
      let text = String(value[run.range].characters)
      if let url = run.link { return [(text, url)] }
      return text.split(separator: " ", omittingEmptySubsequences: false).enumerated().map {
        ($0.offset == 0 ? String($0.element) : " " + $0.element, nil)
      }
    }
    InlineFlow {
      ForEach(Array(pieces.enumerated()), id: \.offset) { _, piece in
        if let url = piece.1 {
          Button {
            NSWorkspace.shared.open(url)
          } label: {
            Text(verbatim: piece.0).underline().foregroundStyle(.blue)
          }.buttonStyle(.plain).accessibilityAddTraits(.isLink)
        } else {
          Text(verbatim: piece.0)
        }
      }
    }
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
func webLinkText(_ source: String) -> AttributedString {
  let ns = source as NSString
  let pattern = #"\[([^\]\n]+)\]\((https?://[^\s)]+)\)|(https?://[^\s<>，。；）]+)"#
  var value = AttributedString()
  var start = 0
  for m in (try! NSRegularExpression(pattern: pattern)).matches(
    in: source, range: NSRange(location: 0, length: ns.length))
  {
    value.append(
      AttributedString(
        ns.substring(with: NSRange(location: start, length: m.range.location - start))))
    let markdown = m.range(at: 1).location != NSNotFound
    let target = ns.substring(with: m.range(at: markdown ? 2 : 3))
    var label = AttributedString(markdown ? ns.substring(with: m.range(at: 1)) : target)
    if let url = URL(string: target), url.host != nil {
      label.link = url
      label.foregroundColor = .blue
      label.underlineStyle = .single
    }
    value.append(label)
    start = NSMaxRange(m.range)
  }
  value.append(AttributedString(ns.substring(from: start)))
  return value
}
