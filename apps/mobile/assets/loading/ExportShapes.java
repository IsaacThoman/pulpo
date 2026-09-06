import androidx.compose.material3.MaterialShapes;
import androidx.graphics.shapes.*;
import java.util.*;
public class ExportShapes {
  static String path(List<Cubic> cs) {
    StringJoiner out = new StringJoiner(",", "[", "]");
    out.add(String.format(Locale.ROOT,"%.5f,%.5f",cs.get(0).getAnchor0X(),cs.get(0).getAnchor0Y()));
    for(Cubic c:cs) out.add(String.format(Locale.ROOT,"%.5f,%.5f,%.5f,%.5f,%.5f,%.5f",c.getControl0X(),c.getControl0Y(),c.getControl1X(),c.getControl1Y(),c.getAnchor1X(),c.getAnchor1Y()));
    return out.toString();
  }
  public static void main(String[] args) {
    var m = MaterialShapes.Companion;
    var shapes = List.of(m.getSoftBurst(),m.getCookie9Sided(),m.getPentagon(),m.getPill(),m.getSunny(),m.getCookie4Sided(),m.getOval());
    System.out.println("[");
    for(int i=0;i<shapes.size();i++) {
      var morph = new Morph(shapes.get(i).normalized(),shapes.get((i+1)%shapes.size()).normalized());
      System.out.print("["+path(morph.asCubics(0))+","+path(morph.asCubics(1))+"]"+(i<6?",":"")+"\n");
    }
    System.out.println("]");
  }
}
