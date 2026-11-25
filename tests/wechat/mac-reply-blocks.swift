import AppKit

@main struct ReplyBlocksTest {
    static func main() {
        let path = "/own/有 空格.png", other = "/foreign/有 空格.png"
        let link = "[设计](<" + path + ">)"
        precondition(replySpans("**新用户** `develop`", paths:[]) == [.strong("新用户"),.plain(" "),.code("develop")])
        precondition(replySpans("`"+link+"`",paths:[path]) == [.code(link)])
        precondition(replySpans("参考"+link,paths:[path]) == [.plain("参考"),.file("设计",path)])
        precondition(onlyFileLinks(link+"  "+link,paths:[path]) && !onlyFileLinks("参考"+link,paths:[path]))
        precondition(attachmentCaptions(link+" · "+link+"\n\n```\n"+link+"\n```",paths:[path]) == [path:["设计"]])
        precondition(replySpans("[设计](<"+other+">)",paths:[path]) == [.plain("设计")])
        precondition(replySpans("[本机](file:///tmp/test)",paths:[]) == [.plain("[本机](file:///tmp/test)")])
        precondition(replySpans("[示例](https://example.org/design)",paths:[]) == [.web("示例",URL(string:"https://example.org/design")!)])
        precondition(conversationTitle("你好接入层任务状态元…","3") == "你好" && conversationTitle("讨论接入层任务状态如何呈现","3") == "讨论接入层任务状态如何呈现")
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
