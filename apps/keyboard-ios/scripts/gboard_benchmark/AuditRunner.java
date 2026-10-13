package com.pulpo.keyboardaudit;

import android.accessibilityservice.*;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.*;
import android.view.*;
import android.view.accessibility.*;
import android.view.inputmethod.*;
import java.io.*;
import java.util.*;
import org.json.*;

public class AuditRunner extends Instrumentation {
  Bundle args;
  UiAutomation ui;
  float row0 = 1715.5f, rowPitch = 155, xPitch = 107;
  JSONArray results = new JSONArray();
  java.lang.reflect.Method injection;
  long gestureMillis;

  public void onCreate(Bundle b) {
    super.onCreate(b);
    args = b;
    start();
  }

  String asset(String name) throws Exception {
    return new String(
        getTargetContext().getAssets().open(name).readAllBytes(),
        java.nio.charset.StandardCharsets.UTF_8);
  }

  public void onStart() {
    try {
      startActivitySync(
          new Intent(getTargetContext(), AuditActivity.class)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
      SystemClock.sleep(2000);
      ui = getUiAutomation();
      injection =
          UiAutomation.class.getDeclaredMethod(
              "injectInputEvent", InputEvent.class, boolean.class, boolean.class);
      MotionEvent cancel =
          MotionEvent.obtain(
              SystemClock.uptimeMillis(),
              SystemClock.uptimeMillis(),
              MotionEvent.ACTION_CANCEL,
              500,
              1800,
              0);
      cancel.setSource(InputDevice.SOURCE_TOUCHSCREEN);
      injection.invoke(ui, cancel, true, false);
      cancel.recycle();
      AccessibilityServiceInfo info = ui.getServiceInfo();
      info.flags |=
          AccessibilityServiceInfo.FLAG_RETRIEVE_INTERACTIVE_WINDOWS
              | AccessibilityServiceInfo.FLAG_REPORT_VIEW_IDS;
      ui.setServiceInfo(info);
      String mode = args.getString("mode", "probe");
      if (mode.equals("probe")) {
        for (AccessibilityWindowInfo w : ui.getWindows()) {
          dump(w.getRoot(), 0);
        }
        tap(54, row0);
        tap(165, row0);
        SystemClock.sleep(600);
        dumpAll();
      } else if (mode.equals("swipes")) {
        getTargetContext().deleteFile("swipes.json");
        JSONArray cases = new JSONArray(asset("swipes.json"));
        for (int i = 0;
            i < Math.min(cases.length(), Integer.parseInt(args.getString("maxCases", "100000")));
            i++) {
          JSONObject c = cases.getJSONObject(i);
          reset("");
          JSONArray points = c.getJSONArray("points");
          long down = SystemClock.uptimeMillis();
          for (int j = 0; j < points.length(); j++) {
            JSONArray p = points.getJSONArray(j);
            SystemClock.sleep(j == 0 ? 0 : 20);
            event(
                j == 0 ? MotionEvent.ACTION_DOWN : MotionEvent.ACTION_MOVE,
                5 + (float) p.getDouble(0) * xPitch,
                row0 + (float) p.getDouble(1) * rowPitch,
                down);
          }
          JSONArray p = points.getJSONArray(points.length() - 1);
          event(
              MotionEvent.ACTION_UP,
              5 + (float) p.getDouble(0) * xPitch,
              row0 + (float) p.getDouble(1) * rowPitch,
              down);
          gestureMillis = SystemClock.uptimeMillis() - down;
          SystemClock.sleep(450);
          record("swipes", c.getString("word"), c.getString("word"));
        }
      } else {
        JSONObject all = new JSONObject(asset("cases.json"));
        JSONArray cases = all.getJSONArray(mode);
        for (int i = 0;
            i < Math.min(cases.length(), Integer.parseInt(args.getString("maxCases", "100000")));
            i++) {
          JSONObject c = cases.getJSONObject(i);
          String input = c.getString("input");
          if ((mode.equals("predictions") || mode.endsWith("Predictions"))) {
            reset(input + " ");
            SystemClock.sleep(500);
            record(mode, input, c.getString("expected"));
          } else {
            if (!input.matches("[a-zA-Z]+")) continue;
            reset("and ");
            for (char ch : input.toCharArray()) {
              if (ch >= 'A' && ch <= 'Z') tap(85, row0 + 2 * rowPitch);
              float[] xy = key(Character.toLowerCase(ch));
              if (xy == null) continue;
              tap(xy[0], xy[1]);
              SystemClock.sleep(40);
            }
            SystemClock.sleep(250);
            JSONArray suggestions = suggestions();
            tap(590, row0 + 3 * rowPitch);
            SystemClock.sleep(300);
            JSONObject result = make(mode, input, c.getString("expected"));
            result.put("suggestions", suggestions);
            results.put(result);
          }
        }
      }
      if (!mode.equals("probe")) {
        try (FileOutputStream f = getTargetContext().openFileOutput(mode + ".json", 0)) {
          f.write(results.toString(2).getBytes());
        }
      }
      Bundle out = new Bundle();
      out.putString("stream", "Completed " + mode + ": " + results.length());
      finish(0, out);
    } catch (Exception e) {
      Bundle out = new Bundle();
      out.putString("stream", android.util.Log.getStackTraceString(e));
      finish(1, out);
    }
  }

  void reset(String text) {
    runOnMainSync(
        () -> {
          AuditActivity.instance.field.setText(text);
          AuditActivity.instance.field.setSelection(text.length());
          InputMethodManager im =
              (InputMethodManager)
                  AuditActivity.instance.getSystemService(Context.INPUT_METHOD_SERVICE);
          im.restartInput(AuditActivity.instance.field);
          im.showSoftInput(AuditActivity.instance.field, 0);
        });
    SystemClock.sleep(500);
    try {
      ui.waitForIdle(150, 3000);
    } catch (Exception ignored) {
    }
  }

  void tap(float x, float y) {
    long d = SystemClock.uptimeMillis();
    event(MotionEvent.ACTION_DOWN, x, y, d);
    SystemClock.sleep(35);
    event(MotionEvent.ACTION_UP, x, y, d);
  }

  void event(int action, float x, float y, long down) {
    MotionEvent e = MotionEvent.obtain(down, SystemClock.uptimeMillis(), action, x, y, 0);
    e.setSource(InputDevice.SOURCE_TOUCHSCREEN);
    inject(e, true);
    e.recycle();
  }

  float[] key(char c) {
    String[] rows = {"qwertyuiop", "asdfghjkl", "zxcvbnm"};
    float[] starts = {0.5f, 1f, 2f};
    for (int r = 0; r < 3; r++) {
      int i = rows[r].indexOf(c);
      if (i >= 0) return new float[] {5 + (starts[r] + i) * xPitch, row0 + r * rowPitch};
    }
    return null;
  }

  void inject(InputEvent e, boolean sync) {
    try {
      if (!(Boolean) injection.invoke(ui, e, sync, false))
        throw new RuntimeException("Injection rejected: " + e.toString());
    } catch (Exception failure) {
      throw new RuntimeException(failure);
    }
  }

  void dumpAll() {
    for (AccessibilityWindowInfo w : ui.getWindows()) dump(w.getRoot(), 0);
  }

  void dump(AccessibilityNodeInfo n, int depth) {
    if (n == null) return;
    Rect b = new Rect();
    n.getBoundsInScreen(b);
    android.util.Log.i(
        "KeyboardAudit",
        depth
            + " "
            + n.getPackageName()
            + " "
            + n.getViewIdResourceName()
            + " text="
            + n.getText()
            + " desc="
            + n.getContentDescription()
            + " "
            + b);
    for (int i = 0; i < n.getChildCount(); i++) dump(n.getChild(i), depth + 1);
  }

  JSONArray suggestions() {
    LinkedHashSet<String> texts = new LinkedHashSet<>();
    for (AccessibilityWindowInfo w : ui.getWindows()) {
      AccessibilityNodeInfo root = w.getRoot();
      if (root != null)
        for (AccessibilityNodeInfo bar :
            root.findAccessibilityNodeInfosByViewId(
                "com.google.android.inputmethod.latin:id/softkey_holder_fixed_candidates"))
          collect(bar, texts);
    }
    return new JSONArray(texts);
  }

  void collect(AccessibilityNodeInfo n, Set<String> texts) {
    if (n == null) return;
    Rect b = new Rect();
    n.getBoundsInScreen(b);
    if ("com.google.android.inputmethod.latin"
            .contentEquals(n.getPackageName() == null ? "" : n.getPackageName())
        && b.top < row0 - 70
        && b.top > 1450) {
      if (n.getText() != null) texts.add(n.getText().toString());
      else if (n.getContentDescription() != null) texts.add(n.getContentDescription().toString());
    }
    for (int i = 0; i < n.getChildCount(); i++) collect(n.getChild(i), texts);
  }

  JSONObject make(String mode, String input, String expected) throws Exception {
    String[] text = {""};
    runOnMainSync(() -> text[0] = AuditActivity.instance.field.getText().toString());
    JSONObject r = new JSONObject();
    r.put("gestureMillis", gestureMillis);
    r.put("input", input);
    r.put("expected", expected);
    r.put("output", text[0]);
    r.put("suggestions", suggestions());
    return r;
  }

  void record(String mode, String input, String expected) throws Exception {
    results.put(make(mode, input, expected));
  }
}
