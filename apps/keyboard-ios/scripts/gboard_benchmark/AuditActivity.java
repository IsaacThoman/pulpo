package com.pulpo.keyboardaudit;

import android.app.*;
import android.content.*;
import android.os.*;
import android.text.*;
import android.view.*;
import android.view.inputmethod.*;
import android.widget.*;

public class AuditActivity extends Activity {
  public static AuditActivity instance;
  public EditText field;

  public void onCreate(Bundle b) {
    super.onCreate(b);
    instance = this;
    LinearLayout box = new LinearLayout(this);
    box.setOrientation(1);
    TextView title = new TextView(this);
    title.setText("Pulpo / Gboard keyboard benchmark");
    title.setTextSize(20);
    box.addView(title);
    field = new EditText(this);
    field.setSingleLine(false);
    field.setMinLines(3);
    field.setInputType(
        InputType.TYPE_CLASS_TEXT
            | InputType.TYPE_TEXT_FLAG_MULTI_LINE
            | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT
            | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES);
    field.setImeOptions(EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
    box.addView(field);
    setContentView(box);
    field.requestFocus();
    field.postDelayed(
        () ->
            ((InputMethodManager) getSystemService(INPUT_METHOD_SERVICE))
                .showSoftInput(field, InputMethodManager.SHOW_IMPLICIT),
        500);
  }
}
