package expo.modules.pulpoaudiofocus

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Holds transient exclusive audio focus while the user dictates, the way system voice input does:
 * music and podcast apps pause instead of being recorded over the user's voice, and resume once
 * focus is abandoned.
 */
class PulpoAudioFocusModule : Module() {
  private var request: AudioFocusRequest? = null
  private var held = false
  // Dictation ends on its own schedule; focus changes from other apps need no reaction here.
  private val listener = AudioManager.OnAudioFocusChangeListener { }

  private val audioManager: AudioManager?
    get() = appContext.reactContext?.getSystemService(Context.AUDIO_SERVICE) as? AudioManager

  override fun definition() = ModuleDefinition {
    Name("PulpoAudioFocus")

    AsyncFunction("acquire") { acquire() }
    AsyncFunction("release") { release() }

    OnDestroy { release() }
  }

  @Synchronized
  private fun acquire(): Boolean {
    if (held) return true
    val manager = audioManager ?: return false
    val result = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val focusRequest = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ASSISTANT)
            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
            .build()
        )
        .setOnAudioFocusChangeListener(listener)
        .build()
      request = focusRequest
      manager.requestAudioFocus(focusRequest)
    } else {
      @Suppress("DEPRECATION")
      manager.requestAudioFocus(listener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_EXCLUSIVE)
    }
    held = result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    if (!held) request = null
    return held
  }

  @Synchronized
  private fun release() {
    if (!held) return
    val manager = audioManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      request?.let { manager?.abandonAudioFocusRequest(it) }
    } else {
      @Suppress("DEPRECATION")
      manager?.abandonAudioFocus(listener)
    }
    request = null
    held = false
  }
}
