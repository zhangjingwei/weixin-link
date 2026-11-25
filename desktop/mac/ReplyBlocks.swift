import SwiftUI
import AppKit

enum ReplyBlock: Equatable {
    case paragraph(String), heading(Int,String), bullet(String,String), quote(String), code(String,String)

    static func parse(_ source: String) -> [ReplyBlock] {
        let lines = (source as NSString).components(separatedBy:"\n")
        var result: [ReplyBlock] = [], prose: [String] = [], index = 0
        func flush() { if !prose.isEmpty { result.append(.paragraph(prose.joined(separator:"\n"))); prose.removeAll() } }
        while index < lines.count {
            let raw = lines[index], line = raw.hasSuffix("\r") ? String(raw.dropLast()) : raw
            index += 1
            let token = line.prefix { $0 == line.first }, rest = line.dropFirst(token.count)
            if let first = token.first, (first == "`" || first == "~"), token.count >= 3, !(first == "`" && rest.contains("`")) {
                flush(); var code = ""
                while index < lines.count {
                    let part = lines[index], end = part.trimmingCharacters(in:.whitespacesAndNewlines); index += 1
                    if end.count >= token.count && end.allSatisfy({ $0 == first }) { break }
                    code += part + (index < lines.count ? "\n" : "")
                }
                result.append(.code(rest.trimmingCharacters(in:.whitespaces),code))
            } else if token.first == "#", token.count <= 6, rest.first == " " { flush(); result.append(.heading(token.count,String(rest.dropFirst()))) }
            else if line.hasPrefix(">") { flush(); let body=line.dropFirst(); result.append(.quote(String(body.first == " " ? body.dropFirst() : body))) }
            else if let space=line.firstIndex(of:" "), space != line.startIndex {
                let marker=String(line[..<space]); let number=marker.dropLast()
                if ["-","*","+"].contains(marker) || (marker.last == "." && !number.isEmpty && number.allSatisfy(\.isNumber)) { flush(); result.append(.bullet(marker,String(line[line.index(after:space)...]))) } else { prose.append(line) }
            } else if line.isEmpty { flush() } else { prose.append(line) }
        }
        flush(); return result
    }
}

struct ReplyBody: View {
    let text: String
    var body: some View {
        VStack(alignment:.leading,spacing:10) {
            ForEach(Array(ReplyBlock.parse(text).enumerated()),id:\.offset) { _,block in
                switch block {
                case let .paragraph(value): Text(verbatim:value)
                case let .heading(level,value): Text(verbatim:value).font(.system(size:level < 3 ? 19 : 16,weight:.semibold)).padding(.top,3)
                case let .bullet(marker,value): HStack(alignment:.firstTextBaseline,spacing:8) { Text(marker.count == 1 ? "•" : marker).foregroundStyle(.secondary); Text(verbatim:value) }.padding(.leading,5)
                case let .quote(value): Text(verbatim:value).foregroundStyle(.secondary).padding(.leading,12).overlay(alignment:.leading){Capsule().fill(Color.secondary.opacity(0.35)).frame(width:3)}
                case let .code(language,raw): CodeCard(language:language,raw:raw)
                }
            }
        }.frame(maxWidth:.infinity,alignment:.leading).font(.system(size:15)).lineSpacing(3).textSelection(.enabled)
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
        VStack(alignment:.leading,spacing:0) {
            HStack { Label(language.isEmpty ? "代码" : language,systemImage:"chevron.left.forwardslash.chevron.right"); Spacer(); Button { copied = copyCode(raw, to: .general) } label:{Label(copied ? "已复制" : "复制",systemImage:copied ? "checkmark" : "doc.on.doc")}.buttonStyle(.plain) }.font(.caption).padding(9)
            Divider(); ScrollView(.horizontal) { Text(verbatim:raw.hasSuffix("\n") ? String(raw.dropLast()) : raw).font(.system(size:13,design:.monospaced)).fixedSize().padding(12) }
        }.background(Color.secondary.opacity(0.07),in:RoundedRectangle(cornerRadius:8)).overlay(RoundedRectangle(cornerRadius:8).stroke(Color.secondary.opacity(0.2))).onChange(of:raw){ _ in copied=false }
    }
}
