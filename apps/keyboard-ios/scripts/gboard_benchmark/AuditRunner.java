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
  JSONObject gestureTiming;

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
      } else if (mode.equals("swipes") || mode.equals("recordedSwipes")) {
        getTargetContext().deleteFile(mode + ".json");
        JSONArray cases = new JSONArray(asset("swipes.json"));
        for (int i = 0;
            i < Math.min(cases.length(), Integer.parseInt(args.getString("maxCases", "100000")));
            i++) {
          JSONObject c = cases.getJSONObject(i);
          reset("");
          gestureTiming = null;
          if (mode.equals("recordedSwipes")) {
            replayRecorded(c);
          } else {
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
          }
          SystemClock.sleep(450);
          record(mode, c.getString("word"), c.getString("word"));
          JSONObject result = results.getJSONObject(results.length() - 1);
          if (c.has("id")) result.put("caseId", c.get("id"));
          result.put("replayedPointCount", c.getJSONArray("points").length());
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

  // human-recorded-v1: retain source samples and event times; do not let a
  // synchronous IPC for each MOVE stretch the gesture. A synchronous final UP
  // drains the injected stream before reading the IME result.
  void replayRecorded(JSONObject c) throws Exception {
    if (!"recorded".equals(c.optString("replayTiming")))
      throw new IllegalArgumentException("Recorded replay requires raw recorded preparation");
    JSONArray points = c.getJSONArray("points"), times = c.getJSONArray("times");
    int count = points.length();
    if (count < 2 || times.length() != count)
      throw new IllegalArgumentException("Recorded points/times must align and have at least two samples");
    double first = times.getDouble(0), previous = first;
    double[] sourceOffsets = new double[count];
    long[] offsets = new long[count], starts = new long[count], ends = new long[count];
    float[] xs = new float[count], ys = new float[count];
    for (int j = 0; j < count; j++) {
      double time = times.getDouble(j);
      JSONArray p = points.getJSONArray(j);
      double x = p.getDouble(0), y = p.getDouble(1);
      if (!Double.isFinite(time) || time < previous || !Double.isFinite(x) || !Double.isFinite(y))
        throw new IllegalArgumentException("Recorded samples must be finite and chronological");
      previous = time;
      sourceOffsets[j] = (time - first) * 1000;
      offsets[j] = Math.round(sourceOffsets[j]);
      xs[j] = 5 + (float) x * xPitch;
      ys[j] = row0 + (float) y * rowPitch;
    }
    long down = SystemClock.uptimeMillis() + 100;
    MotionEvent[] events = new MotionEvent[count];
    try {
      for (int j = 0; j < count; j++) {
        int action = j == 0 ? MotionEvent.ACTION_DOWN
            : j == count - 1 ? MotionEvent.ACTION_UP : MotionEvent.ACTION_MOVE;
        events[j] = MotionEvent.obtain(down, down + offsets[j], action, xs[j], ys[j], 0);
        events[j].setSource(InputDevice.SOURCE_TOUCHSCREEN);
      }
      for (int j = 0; j < count; j++) {
        long deadline = down + offsets[j], remaining;
        while ((remaining = deadline - SystemClock.uptimeMillis()) > 0) SystemClock.sleep(remaining);
        starts[j] = SystemClock.uptimeMillis() - down;
        inject(events[j], j == count - 1);
        ends[j] = SystemClock.uptimeMillis() - down;
      }
      gestureMillis = ends[count - 1];
      long[] lateness = new long[count];
      long maxLateness = 0, totalLateness = 0, maxCall = 0, totalCall = 0;
      double maxTimestampError = 0;
      JSONArray trace = new JSONArray();
      for (int j = 0; j < count; j++) {
        lateness[j] = starts[j] - offsets[j];
        maxLateness = Math.max(maxLateness, lateness[j]);
        totalLateness += lateness[j];
        long call = ends[j] - starts[j];
        maxCall = Math.max(maxCall, call);
        totalCall += call;
        long eventOffset = events[j].getEventTime() - down;
        maxTimestampError = Math.max(maxTimestampError, Math.abs(eventOffset - sourceOffsets[j]));
        JSONArray sample = new JSONArray();
        sample.put(sourceOffsets[j]);
        sample.put(eventOffset);
        sample.put(starts[j]);
        sample.put(ends[j]);
        trace.put(sample);
      }
      Arrays.sort(lateness);
      long p95 = lateness[(int) Math.ceil(count * 0.95) - 1];
      gestureTiming = new JSONObject();
      gestureTiming.put("protocol", "human-recorded-v1");
      gestureTiming.put("injection", "async-down-moves-sync-up");
      gestureTiming.put("pointCount", count);
      gestureTiming.put("requestedDurationMillis", sourceOffsets[count - 1]);
      gestureTiming.put("scheduledDurationMillis", offsets[count - 1]);
      gestureTiming.put("actualDurationMillis", starts[count - 1]);
      gestureTiming.put("completionDurationMillis", gestureMillis);
      gestureTiming.put("meanLatenessMillis", (double) totalLateness / count);
      gestureTiming.put("p95LatenessMillis", p95);
      gestureTiming.put("maxLatenessMillis", maxLateness);
      gestureTiming.put("meanInjectionCallMillis", (double) totalCall / count);
      gestureTiming.put("maxInjectionCallMillis", maxCall);
      gestureTiming.put("maxTimestampErrorMillis", maxTimestampError);
      gestureTiming.put("withinTimingTolerance", p95 <= 8 && maxLateness <= 32);
      gestureTiming.put("traceColumns", new JSONArray(Arrays.asList(
          "sourceOffsetMillis", "eventOffsetMillis", "injectionStartOffsetMillis", "injectionEndOffsetMillis")));
      gestureTiming.put("trace", trace);
    } finally {
      for (MotionEvent event : events) if (event != null) event.recycle();
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
    if (gestureTiming != null) r.put("timing", gestureTiming);
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
