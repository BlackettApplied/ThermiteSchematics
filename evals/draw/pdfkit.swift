// Optional macOS reference rasterizer: no third-party dependencies.
// PDFKit catches Quartz soft-mask defects that pdf.js can render correctly.
import Foundation
import AppKit
import PDFKit
let args = CommandLine.arguments
if args.count != 4 && args.count != 9 { fputs("usage: pdfkit input.pdf output-directory dpi\n", stderr); exit(2) }
guard let doc = PDFDocument(url: URL(fileURLWithPath: args[1])), let dpi = Double(args[3]) else { exit(2) }
for i in 0..<doc.pageCount {
  if args.count == 9 && i != Int(args[4])! - 1 { continue }
  guard let page = doc.page(at: i) else { exit(2) }
  let b = page.bounds(for: .mediaBox), s = dpi / 72.0
  let unit = 72.0/25.4
  let crop = args.count == 9 ? CGRect(x: Double(args[5])!*unit, y: Double(args[6])!*unit, width: Double(args[7])!*unit, height: Double(args[8])!*unit) : CGRect(x: 0,y: 0,width: b.width,height: b.height)
  let w = Int(ceil(crop.width*s)), h = Int(ceil(crop.height*s))
  guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0), let graphics = NSGraphicsContext(bitmapImageRep: rep) else { exit(2) }
  NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current = graphics
  let ctx = graphics.cgContext
  ctx.setFillColor(NSColor.white.cgColor); ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
  ctx.scaleBy(x: s, y: s); ctx.translateBy(x: -crop.minX, y: -(b.height-crop.minY-crop.height)); page.draw(with: .mediaBox, to: ctx)
  NSGraphicsContext.restoreGraphicsState()
  guard let bytes = rep.representation(using: .png, properties: [:]) else { exit(2) }
  try bytes.write(to: URL(fileURLWithPath: args[2]).appendingPathComponent(String(format:"pdfkit-%03d.png", i+1)))
}
