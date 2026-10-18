package com.pulpo.keyboardaudit;
import android.app.*;
import android.content.*;
import android.accessibilityservice.*;
import android.graphics.Rect;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import java.io.*;
import org.json.*;

/** Harness only. Every frozen row is emitted, even when entry is unavailable. */
public class MultilingualRunner extends AuditRunner {
  JSONArray nodes() throws Exception {
    ui.clearCache();
    JSONArray a = new JSONArray();
    for (AccessibilityWindowInfo w : ui.getWindows()) walk(w.getRoot(), a);
    return a;
  }
  void walk(AccessibilityNodeInfo n, JSONArray a) throws Exception {
    if (n == null) return;
    Rect b = new Rect(); n.getBoundsInScreen(b);
    JSONObject j = new JSONObject();
    j.put("package", String.valueOf(n.getPackageName()));
    j.put("text", String.valueOf(n.getText())); j.put("desc", String.valueOf(n.getContentDescription()));
    j.put("bounds", new JSONArray(new int[]{b.left,b.top,b.right,b.bottom}));
    a.put(j);
    for (int i=0;i<n.getChildCount();i++) walk(n.getChild(i),a);
  }
  void save(String file, Object value) throws Exception {
    try(FileOutputStream f=getTargetContext().openFileOutput(file,0)) { f.write(value.toString().getBytes(java.nio.charset.StandardCharsets.UTF_8)); }
  }
  public void onStart() {
    try {
      startActivitySync(new Intent(getTargetContext(),MultilingualActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      SystemClock.sleep(1800);
      ui=getUiAutomation();
      injection=UiAutomation.class.getDeclaredMethod("injectInputEvent",InputEvent.class,boolean.class,boolean.class);
      AccessibilityServiceInfo info=ui.getServiceInfo();
      info.flags |= AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
      ui.setServiceInfo(info);
      SystemClock.sleep(500);
      String mode=args.getString("language","en");
      String select=args.getString("selectLanguage","");
      if(!select.isEmpty()) {
        JSONObject space=null;JSONArray initial=nodes();
        for(int i=0;i<initial.length();i++) if(initial.getJSONObject(i).getString("desc").equals("Space") || initial.getJSONObject(i).getString("desc").equals("Espacio")) {space=initial.getJSONObject(i);break;}
        if(space==null) throw new IllegalStateException("No visible Space key for language picker");
        JSONArray b=space.getJSONArray("bounds");float x=(b.getInt(0)+b.getInt(2))/2f,y=(b.getInt(1)+b.getInt(3))/2f;
        long d=SystemClock.uptimeMillis();event(MotionEvent.ACTION_DOWN,x,y,d);SystemClock.sleep(800);event(MotionEvent.ACTION_UP,x,y,d);SystemClock.sleep(800);
        JSONArray picker=nodes();save("language-picker.json",picker);JSONObject choice=null;
        for(int i=0;i<picker.length();i++) {JSONObject n=picker.getJSONObject(i);if(n.getString("text").equals(select)) {choice=n;break;}}
        if(choice==null) throw new IllegalStateException("Language picker lacks label "+select);
        b=choice.getJSONArray("bounds");tap((b.getInt(0)+b.getInt(2))/2f,(b.getInt(1)+b.getInt(3))/2f);SystemClock.sleep(900);
      }
      if(args.getString("action","probe").equals("probe")) {
        String probeKey=args.getString("probeKey","");
        long held=0; float hx=0,hy=0;
        if(!probeKey.isEmpty()) {
          JSONArray ns=nodes(); JSONObject found=null;
          for(int i=0;i<ns.length();i++) { JSONObject n=ns.getJSONObject(i); if(n.getString("package").equals("com.google.android.inputmethod.latin") && n.getString("desc").equals(probeKey)) {found=n;break;} }
          if(found==null) throw new IllegalStateException("Missing probe label "+probeKey);
          JSONArray b=found.getJSONArray("bounds"); hx=(b.getInt(0)+b.getInt(2))/2f;hy=(b.getInt(1)+b.getInt(3))/2f;
          if(args.getString("hold","false").equals("true")) { held=SystemClock.uptimeMillis();event(MotionEvent.ACTION_DOWN,hx,hy,held);SystemClock.sleep(1100); }
          else {tap(hx,hy);SystemClock.sleep(500);}
        }
        save("probe.json",nodes());
        try(FileOutputStream f=getTargetContext().openFileOutput("probe.png",0)) {ui.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,f);}
        if(held!=0) event(MotionEvent.ACTION_CANCEL,hx,hy,held);
      } else {
        JSONObject geometry=new JSONObject(asset("geometry.json")).getJSONObject(mode);
        JSONArray cases=new JSONObject(asset("multilingual-cases.json")).getJSONArray("cases");
        JSONArray out=new JSONArray();
        save(mode+".json",out); // replace stale output before first attempt
        for(int i=0;i<cases.length();i++) {
          JSONObject c=cases.getJSONObject(i);
          if(!mode.equals(c.getString("mode"))) continue;
          JSONObject r=new JSONObject(); r.put("id",c.getString("id"));
          String input=c.getString("typed")+c.getString("final_boundary");
          long start=SystemClock.uptimeMillis();
          try {
            // Preflight complete input. Do not type or score a silently truncated stream.
            for(int k=0;k<input.length();) {
              int cp=input.codePointAt(k);k+=Character.charCount(cp);
              if(!geometry.has(new String(Character.toChars(cp)))) throw new UnsupportedOperationException("No verified entry for U+"+Integer.toHexString(cp));
            }
            reset("");
            JSONArray current=nodes();
            save(mode+"-before-"+c.getString("id")+".json",current);
            String active=geometry.getString("__active");
            boolean activeFound=false;
            for(int n=0;n<current.length();n++) if(current.getJSONObject(n).getString("desc").equals(active)) activeFound=true;
            if(!activeFound) throw new IllegalStateException("Active language label missing: "+active);
            for(char letter='a';letter<='z';letter++) {
              JSONArray xy=geometry.getJSONArray(String.valueOf(letter)).getJSONArray(0);boolean matched=false;
              for(int n=0;n<current.length();n++) {
                JSONObject key=current.getJSONObject(n);
                if(!key.getString("package").equals("com.google.android.inputmethod.latin") || !key.getString("desc").equals(String.valueOf(letter))) continue;
                JSONArray b=key.getJSONArray("bounds");
                if(xy.getDouble(0)>b.getInt(0) && xy.getDouble(0)<b.getInt(2) && xy.getDouble(1)>b.getInt(1) && xy.getDouble(1)<b.getInt(3)) matched=true;
              }
              if(!matched) throw new IllegalStateException("Geometry mismatch for "+letter);
            }
            for(int k=0;k<input.length();) {
              int cp=input.codePointAt(k); k+=Character.charCount(cp);
              String ch=new String(Character.toChars(cp));
              // A character can require a verified sequence (e.g. symbols page then digit).
              JSONArray steps=geometry.getJSONArray(ch);
              for(int j=0;j<steps.length();j++) {
                JSONArray xy=steps.getJSONArray(j);
                if(xy.length()==2) tap((float)xy.getDouble(0),(float)xy.getDouble(1));
                else {
                  long d=SystemClock.uptimeMillis();
                  event(MotionEvent.ACTION_DOWN,(float)xy.getDouble(0),(float)xy.getDouble(1),d);
                  SystemClock.sleep(650);
                  event(MotionEvent.ACTION_MOVE,(float)xy.getDouble(2),(float)xy.getDouble(3),d);
                  SystemClock.sleep(120);
                  event(MotionEvent.ACTION_UP,(float)xy.getDouble(2),(float)xy.getDouble(3),d);
                }
                SystemClock.sleep(ch.equals(" ")?350:120);
              }
            }
            SystemClock.sleep(750);
            String[] text={""};runOnMainSync(()->text[0]=AuditActivity.instance.field.getText().toString());
            save(mode+"-after-"+c.getString("id")+".json",nodes());
            try(FileOutputStream f=getTargetContext().openFileOutput(c.getString("id")+".png",0)) {ui.takeScreenshot().compress(android.graphics.Bitmap.CompressFormat.PNG,100,f);}
            r.put("status","observed"); r.put("output",text[0]); r.put("exact",text[0].equals(c.getString("expected")));
          } catch(UnsupportedOperationException e) {
            r.put("status","unavailable");r.put("reason",e.toString());
          } catch(Exception e) {
            r.put("status","error");r.put("reason",android.util.Log.getStackTraceString(e));
          }
          r.put("elapsedMillis",SystemClock.uptimeMillis()-start);out.put(r);save(mode+".json",out);
        }
      }
      Bundle b=new Bundle();b.putString("stream","Completed multilingual "+mode);finish(0,b);
    } catch(Exception e) { Bundle b=new Bundle();b.putString("stream",android.util.Log.getStackTraceString(e));finish(1,b); }
  }
}
