import AppKit

let root = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let sourceURL = root.appendingPathComponent("assets/branding/safari-app-icon-source.png")
let outputURL = root.appendingPathComponent("admin/public", isDirectory: true)

guard let source = NSImage(contentsOf: sourceURL) else {
  fputs("无法读取图标源图：\(sourceURL.path)\n", stderr)
  exit(1)
}

let targets: [(name: String, size: Int)] = [
  ("favicon-32.png", 32),
  ("apple-touch-icon.png", 180),
  ("app-icon-192.png", 192),
  ("app-icon-512.png", 512)
]

for target in targets {
  guard let bitmap = NSBitmapImageRep(
    bitmapDataPlanes: nil,
    pixelsWide: target.size,
    pixelsHigh: target.size,
    bitsPerSample: 8,
    samplesPerPixel: 4,
    hasAlpha: true,
    isPlanar: false,
    colorSpaceName: .deviceRGB,
    bytesPerRow: 0,
    bitsPerPixel: 0
  ) else {
    fputs("无法创建 \(target.name)\n", stderr)
    exit(1)
  }

  NSGraphicsContext.saveGraphicsState()
  guard let context = NSGraphicsContext(bitmapImageRep: bitmap) else {
    fputs("无法创建绘图上下文：\(target.name)\n", stderr)
    exit(1)
  }
  context.imageInterpolation = .high
  NSGraphicsContext.current = context
  NSColor(calibratedRed: CGFloat(0xfb) / 255, green: CGFloat(0xf0) / 255, blue: CGFloat(0xe6) / 255, alpha: 1).setFill()
  NSRect(x: 0, y: 0, width: target.size, height: target.size).fill()
  source.draw(
    in: NSRect(x: 0, y: 0, width: target.size, height: target.size),
    from: NSRect(origin: .zero, size: source.size),
    operation: .sourceOver,
    fraction: 1
  )
  NSGraphicsContext.restoreGraphicsState()

  guard let data = bitmap.representation(using: .png, properties: [:]) else {
    fputs("无法输出 \(target.name)\n", stderr)
    exit(1)
  }
  try data.write(to: outputURL.appendingPathComponent(target.name), options: .atomic)
}

print("已生成 \(targets.count) 个 Safari/PWA 图标")
