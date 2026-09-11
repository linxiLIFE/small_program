import AppKit
let output = URL(fileURLWithPath: CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "assets/tabbar")
for name in ["home", "styles", "booking", "profile"] {
  for active in [false,true] {
    let image = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:81,pixelsHigh:81,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0)!
    NSGraphicsContext.saveGraphicsState(); NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:image)
    let c=NSGraphicsContext.current!.cgContext
    c.clear(CGRect(x:0,y:0,width:81,height:81)); c.scaleBy(x:3,y:3)
    let rgb: [CGFloat] = active ? [0.69,0.36,0.42] : [0.55,0.46,0.45]
    c.setStrokeColor(CGColor(red:rgb[0],green:rgb[1],blue:rgb[2],alpha:1)); c.setLineWidth(1.7);c.setLineCap(.round);c.setLineJoin(.round)
    func line(_ points:[CGPoint]) { c.beginPath();c.addLines(between:points);c.strokePath() }
    func p(_ x:CGFloat,_ y:CGFloat)->CGPoint {CGPoint(x:x,y:y)}
    switch name {
    case "home":
      line([p(4,13),p(13.5,22),p(23,13)]);line([p(6.5,14),p(6.5,5),p(20.5,5),p(20.5,14)]);line([p(11,5),p(11,11),p(16,11),p(16,5)])
    case "booking":
      c.stroke(CGRect(x:5,y:4,width:17,height:17));line([p(5,16),p(22,16)]);line([p(9,19),p(9,23)]);line([p(18,19),p(18,23)]);line([p(9,10),p(12,7),p(18,13)])
    case "profile":
      c.strokeEllipse(in:CGRect(x:9,y:14,width:9,height:9));c.beginPath();c.move(to:p(5,4));c.addCurve(to:p(22,4),control1:p(5,16),control2:p(22,16));c.strokePath()
    default:
      c.beginPath();c.move(to:p(13.5,4));c.addCurve(to:p(4,16),control1:p(7,9),control2:p(4,12));c.addCurve(to:p(13.5,20),control1:p(4,23),control2:p(11,24));c.addCurve(to:p(23,16),control1:p(16,24),control2:p(23,23));c.addCurve(to:p(13.5,4),control1:p(23,12),control2:p(20,9));c.strokePath()
    }
    NSGraphicsContext.restoreGraphicsState()
    try image.representation(using:.png,properties:[:])!.write(to:output.appendingPathComponent(name+(active ? "-active" : "")+".png"))
  }
}
