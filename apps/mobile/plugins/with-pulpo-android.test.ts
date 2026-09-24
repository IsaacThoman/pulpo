import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { claimMathScrollGestures, unclipDropdownMenu } = require('./with-pulpo-android.js')
// Expo UI 57's android/src/main/java/expo/modules/ui/menu/DropdownMenu.kt
const original = `import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.MenuDefaults
import androidx.compose.runtime.Composable
import expo.modules.kotlin.views.FunctionalComposableScope
import expo.modules.ui.UIComposableScope
import expo.modules.ui.ModifierRegistry
import expo.modules.ui.composeOrNull
import expo.modules.ui.findChildSlotView
import expo.modules.ui.isSlotView

@Composable
fun FunctionalComposableScope.DropdownMenuContent(
  props: DropdownMenuProps,
  onDismissRequest: () -> Unit
) {
  val itemsSlotView = findChildSlotView(view, "items")

  Box(modifier = ModifierRegistry.applyModifiers(props.modifiers, appContext, composableScope, globalEventDispatcher)) {
    // Trigger - non-items children
    Children(UIComposableScope(), filter = { !isSlotView(it) })

    DropdownMenu(
      containerColor = props.color?.composeOrNull ?: MenuDefaults.containerColor,
      expanded = props.expanded,
      onDismissRequest = onDismissRequest
    ) {`

describe('Android Expo UI dropdown menu prebuild patch', () => {
  it('measures menus against the full window so they open beside their anchor', () => {
    const source = unclipDropdownMenu(original)
    expect(source).toContain('import androidx.compose.ui.window.PopupProperties\n')
    expect(source).toContain('onDismissRequest = onDismissRequest,\n      properties = PopupProperties(')
    expect(source).toContain('focusable = true')
    expect(source).toContain('clippingEnabled = false')
    expect(unclipDropdownMenu(source)).toBe(source)
  })

  it('fails loudly when Expo UI changes the patched call', () => {
    expect(() => unclipDropdownMenu('DropdownMenu(expanded = props.expanded)')).toThrow(/update withPulpoAndroid/)
  })
})

// Excerpt of react-native-enriched-markdown 0.7's MathContainerView.kt
const mathContainer = `import android.content.Context
import android.view.Gravity
import android.view.View
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import kotlin.math.ceil

class MathContainerView(
  context: Context,
  styleConfig: StyleConfig,
) : FrameLayout(context),
  BlockSegmentView {
  private val mathStyle: MathStyle = styleConfig.mathStyle
  private val scrollView = HorizontalScrollView(context)
  private var cachedLatex: String = ""
}
`

describe('Android display math scroll prebuild patch', () => {
  it('lets overflowing math claim horizontal drags from the drawer and chat list', () => {
    const source = claimMathScrollGestures(mathContainer)
    expect(source).toContain('private val scrollView: HorizontalScrollView = MathScrollView(context)')
    expect(source).toContain('import android.view.MotionEvent\nimport android.view.View\nimport android.view.ViewConfiguration\n')
    expect(source).toContain('import kotlin.math.abs\n')
    expect(source).toContain('private class MathScrollView(')
    expect(source).toContain('parent?.requestDisallowInterceptTouchEvent(true)')
    expect(source).toContain('if (dy > dx) parent?.requestDisallowInterceptTouchEvent(false)')
    expect(claimMathScrollGestures(source)).toBe(source)
  })

  it('fails loudly when the math container changes', () => {
    expect(() => claimMathScrollGestures('class MathContainerView')).toThrow(/update withPulpoAndroid/)
  })
})
