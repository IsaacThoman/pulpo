package com.pulpo.keyboardaudit;
import android.os.Bundle;
import android.text.InputType;
public class MultilingualActivity extends AuditActivity {
  public void onCreate(Bundle b) {
    super.onCreate(b);
    field.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_MULTI_LINE | InputType.TYPE_TEXT_FLAG_AUTO_CORRECT);
  }
}
