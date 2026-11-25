import AppKit

@main struct ReplyBlocksTest {
    static func main() {
        let source = "## 结论\n两行\n正文\n\n1. 一项\n> 摘录\n````swift\n    let s = 1\n\n```\n````\n结束"
        precondition(ReplyBlock.parse(source) == [.heading(2,"结论"), .paragraph("两行\n正文"), .bullet("1.","一项"), .quote("摘录"), .code("swift","    let s = 1\n\n```\n"), .paragraph("结束")])
        let raw = "\tfirst\r\n\r\n    last\r\n"
        guard case let .code(_, value)? = ReplyBlock.parse("~~~\r\n" + raw + "~~~").first else { fatalError("missing code block") }
        let pasteboard = NSPasteboard.withUniqueName()
        defer { pasteboard.releaseGlobally() }
        precondition(copyCode(value, to: pasteboard))
        precondition(pasteboard.string(forType:.string) == raw)
        precondition(ReplyBlock.parse("```\n- literal\n  tail") == [.code("","- literal\n  tail")])
    }
}
