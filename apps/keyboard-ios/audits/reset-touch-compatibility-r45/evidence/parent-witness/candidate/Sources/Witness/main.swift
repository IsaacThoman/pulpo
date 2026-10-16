import Foundation
import KeyboardCore
struct Row: Codable { let id:String; let targetLength:Int; let tapCount:Int; let weight:Double }
let geometry=LetterGeometry.qwerty
var rows:[Row]=[]
for (name,length,taps) in [("dense40",40,40),("dense41",41,41),("sparse41",41,40),("dense64",64,64),("tapless41",41,0)] {
 let text=String(repeating:"a",count:length)
 let center=geometry.center(UInt8(97))!
 let points:[KeyPoint?]=(0..<length).map { $0<taps ? center : nil }
 let word=TypedWord(text:text,taps:points)
 let model=TouchModel(url:nil)
 model.learn(word,intended:text,geometry:geometry)
 rows.append(Row(id:name,targetLength:length,tapCount:taps,weight:model.weight))
}
print(String(data:try JSONEncoder().encode(rows),encoding:.utf8)!)
