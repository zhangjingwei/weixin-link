import AppKit
import ImageIO
import PDFKit
import Quartz
import SwiftUI
import UniformTypeIdentifiers

extension Snapshot.File {
  var url: URL? {
    guard let root else { return nil }
    let dir = URL(fileURLWithPath: root).standardizedFileURL
    let file = URL(fileURLWithPath: path).standardizedFileURL
    guard
      dir.resolvingSymlinksInPath().path == dir.path
        || dir.path.hasPrefix("/tmp/")
          && dir.resolvingSymlinksInPath().path == "/private" + dir.path,
      file.path.hasPrefix(dir.path + "/"),
      file.resolvingSymlinksInPath().path == dir.resolvingSymlinksInPath().path
        + String(file.path.dropFirst(dir.path.count)),
      (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true
    else { return nil }
    return file
  }
  var ext: String { (name as NSString).pathExtension.lowercased() }
  var kind: String {
    switch ext {
    case "pdf": return "pdf"
    case "png", "jpg", "jpeg", "heic", "tiff", "gif", "webp": return "image"
    case "txt", "md", "swift", "mjs", "js", "json", "log", "py", "css", "html", "yaml", "sh",
      "diff", "patch":
      return "text"
    case "docx", "doc", "xlsx", "xls", "pptx", "ppt", "mov", "mp4", "mp3", "wav", "m4a", "pages",
      "numbers", "key":
      return "system"
    default: return "other"
    }
  }
  func image(_ size: Int) -> NSImage? {
    guard let url, let source = CGImageSourceCreateWithURL(url as CFURL, nil),
      let thumb = CGImageSourceCreateThumbnailAtIndex(
        source, 0,
        [
          kCGImageSourceCreateThumbnailFromImageAlways: true,
          kCGImageSourceThumbnailMaxPixelSize: size,
          kCGImageSourceCreateThumbnailWithTransform: true,
        ] as CFDictionary)
    else { return nil }
    return NSImage(cgImage: thumb, size: .zero)
  }
}
struct AttachmentRow: View {
  let file: Snapshot.File, selected: Bool
  var caption: String? = nil
  let open: () -> Void
  var body: some View {
    Button(action: open) {
      HStack(spacing: 12) {
        if file.kind == "image", let image = file.image(120) {
          Image(nsImage: image).resizable().scaledToFit().frame(width: 64, height: 37)
        } else if file.ext == "pdf" || file.ext == "zip" {
          VStack(spacing: 1) {
            Image(systemName: file.ext == "pdf" ? "doc.richtext" : "doc.zipper")
            Text(file.ext.uppercased()).font(.system(size: 9, weight: .bold))
          }.foregroundStyle(.white).frame(width: 30, height: 38).background(
            file.ext == "pdf" ? Color.red : Color.gray, in: RoundedRectangle(cornerRadius: 4))
        } else {
          Image(nsImage: NSWorkspace.shared.icon(for: UTType(filenameExtension: file.ext) ?? .data))
            .resizable().frame(width: 34, height: 34)
        }
        VStack(alignment: .leading) {
          if let receipt = wechatReceipt(file.delivery) { Text(receipt).font(.caption).foregroundStyle(.secondary) }
          if let caption { Text(verbatim:caption).font(.subheadline.weight(.medium)).fixedSize(horizontal:false,vertical:true) }
          Text(verbatim: file.name).lineLimit(1).truncationMode(.middle)
          if let url = file.url, let n = try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize {
            Text(ByteCountFormatter.string(fromByteCount: Int64(n), countStyle: .file)).font(
              .caption
            ).foregroundStyle(.secondary)
          }
        }
        Spacer()
        Image(systemName: "chevron.right").foregroundStyle(.secondary)
      }.padding(10).background(
        selected ? Color.green.opacity(0.13) : Color(nsColor: .controlBackgroundColor),
        in: RoundedRectangle(cornerRadius: 9)
      ).overlay(RoundedRectangle(cornerRadius: 9).stroke(.secondary.opacity(0.17)))
    }.buttonStyle(.plain).accessibilityIdentifier("file-" + file.name)
  }
}
private struct PDFReader: View {
  let url: URL
  @State private var doc: PDFDocument?
  @State private var page = 0
  @State private var zoom: CGFloat = 1
  @State private var rendered: NSImage?
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Button {
          page -= 1
        } label: {
          Image(systemName: "chevron.left")
        }.disabled(page == 0)
        Text("\(page+1) / \(doc?.pageCount ?? 0)").monospacedDigit()
        Button {
          page += 1
        } label: {
          Image(systemName: "chevron.right")
        }.disabled(page + 1 >= doc?.pageCount ?? 0)
        Spacer()
        Button {
          zoom = max(0.5, zoom / 1.25)
        } label: {
          Image(systemName: "minus")
        }
        Button {
          zoom = min(3, zoom * 1.25)
        } label: {
          Image(systemName: "plus")
        }
      }.padding(9)
      GeometryReader { g in
        ScrollView([.horizontal, .vertical]) {
          if let im = rendered {
            Image(nsImage: im).resizable().scaledToFit().frame(
              width: max(100, g.size.width - 28) * zoom
            ).shadow(radius: 2).padding(14)
          } else {
            Text("无法读取 PDF 页面").padding()
          }
        }.frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.secondary.opacity(0.13))
      }
    }.task(id: url) {
      doc = PDFDocument(url: url)
      render()
    }.onChange(of: page) { _ in render() }
  }
  func render() {
    rendered = doc?.page(at: page)?.thumbnail(of: CGSize(width: 1400, height: 1800), for: .cropBox)
  }
}
private struct SystemPreview: NSViewRepresentable {
  let url: URL
  func makeNSView(context: Context) -> QLPreviewView {
    let v = QLPreviewView(frame: .zero, style: .normal)!
    v.autostarts = false
    v.previewItem = url as NSURL
    return v
  }
  func updateNSView(_ v: QLPreviewView, context: Context) {}
}
struct AttachmentPreview: View {
  let file: Snapshot.File, close: () -> Void
  @State private var text = ""
  @State private var fileError: String?
  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "doc")
        Text(verbatim: file.name).font(.headline).lineLimit(1)
        Spacer()
        Button(action: close) { Image(systemName: "xmark") }.buttonStyle(.plain).accessibilityLabel(
          "关闭预览")
      }.padding(16)
      Divider()
      if let url = file.url {
        switch file.kind {
        case "pdf": PDFReader(url: url)
        case "image":
          if let im = file.image(2400) { Image(nsImage: im).resizable().scaledToFit().padding() }
        case "text":
          VStack {
            HStack {
              Spacer()
              Button("复制文本") { _ = copyCode(text, to: .general) }.disabled(text.isEmpty)
            }
            ScrollView([.vertical, .horizontal]) {
              Text(verbatim: fileError ?? text).font(.system(.body, design: .monospaced))
                .textSelection(.enabled)
            }
          }.padding().task(id: url) {
            text = ""
            fileError = nil
            guard let h = try? FileHandle(forReadingFrom: url) else {
              fileError = "无法读取文件"
              return
            }
            defer { try? h.close() }
            if let data = try? h.read(upToCount: 512 * 1024 + 1), data.count <= 512 * 1024 {
              text = String(decoding: data, as: UTF8.self)
            } else {
              fileError = "文件过大或不可读取，请在 Finder 中查看。"
            }
          }
        case "system": SystemPreview(url: url)
        default:
          Spacer()
          Text("此格式不提供内嵌预览").foregroundStyle(.secondary)
        }
        Spacer(minLength: 0)
        Divider()
        Button("在 Finder 中显示") {
          if let verified = file.url { NSWorkspace.shared.activateFileViewerSelecting([verified]) }
        }.padding(10)
      } else {
        Text("文件已失效或不可访问").padding()
        Spacer()
      }
    }.frame(maxWidth: .infinity, maxHeight: .infinity).background(
      Color(nsColor: .windowBackgroundColor)
    ).id(file)
  }
}
