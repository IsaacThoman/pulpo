// The `act` request. An action that an element's own UI Automation pattern can do is done that way,
// with no pointer and no change of focus. Everything else brings the window to the front and uses the
// real pointer and keyboard, as a person would: Windows has no way to send input to a window in the
// background that apps reliably accept.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

namespace Pulpo.Control
{
    internal static class Actions
    {
        /// <summary>A pattern call that has not returned by then (an Invoke that opened a modal dialog) is left running.</summary>
        const int PatternWaitMs = 2500;

        public static Dictionary<string, object> Act(int pid, long windowId, Dictionary<string, object> action)
        {
            IntPtr hwnd = Desktop.Resolve(pid, windowId);
            string type = Params.String(action, "type");
            string note;
            switch (type)
            {
                case "click": note = Click(hwnd, pid, action); break;
                case "type": note = TypeText(hwnd, pid, Params.String(action, "text")); break;
                case "key": note = PressKeys(hwnd, pid, Params.String(action, "keys")); break;
                case "scroll": note = Scroll(hwnd, pid, action); break;
                case "drag": note = Drag(hwnd, pid, action); break;
                case "set_value": note = SetValue(hwnd, action); break;
                default: throw new ControlException("invalid_request", "Unknown action " + type + ".");
            }
            Dictionary<string, object> result = new Dictionary<string, object>();
            if (note != null) result["note"] = note;
            return result;
        }

        // ----- click -----

        static string Click(IntPtr hwnd, int pid, Dictionary<string, object> action)
        {
            string button = Params.Has(action, "button") ? Params.String(action, "button") : "left";
            if (button != "left" && button != "right" && button != "middle") throw new ControlException("invalid_request", "button must be left, right or middle.");
            int count = Params.OptionalInt(action, "count", 1);
            if (count < 1 || count > 3) throw new ControlException("invalid_request", "count must be 1, 2 or 3.");

            Native.POINT point;
            string described = null;
            if (Params.Has(action, "element"))
            {
                int index = Params.Int(action, "element");
                AutomationElement element = Element(hwnd, index);
                described = Describe(hwnd, index);
                if (button == "left" && count == 1)
                {
                    string done = PressByPattern(element, described);
                    if (done != null) return done;
                }
                point = Middle(element);
            }
            else
            {
                point = ToScreen(hwnd, Params.Number(action, "x"), Params.Number(action, "y"));
            }

            PrepareForPointer(hwnd, pid, point);
            Input.Click(button, count);
            Pointer.Pulse();
            if (described == null) return null;
            string clicks = count == 1 ? "Clicked" : count == 2 ? "Double-clicked" : "Triple-clicked";
            string which = button == "left" ? "" : " with the " + button + " button";
            return clicks + " " + described + which + ".";
        }

        /// <summary>
        /// A single left click done through the element's own action, which needs neither the pointer
        /// nor the keyboard focus. Null when the element has none, so the caller clicks for real.
        /// </summary>
        static string PressByPattern(AutomationElement element, string described)
        {
            ControlType type = element.Current.ControlType;
            object pattern;
            // A row's single click selects it; its Invoke is what a double click does (open).
            bool selectFirst = type == ControlType.ListItem || type == ControlType.TreeItem || type == ControlType.DataItem || type == ControlType.TabItem;
            if (selectFirst && element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
            {
                MoveOverlayTo(element);
                Bounded(delegate () { ((SelectionItemPattern)pattern).Select(); });
                return "Selected " + described + ".";
            }
            if (element.TryGetCurrentPattern(InvokePattern.Pattern, out pattern))
            {
                MoveOverlayTo(element);
                bool returned = Bounded(delegate () { ((InvokePattern)pattern).Invoke(); });
                return "Pressed " + described + (returned ? "." : "; the app is still busy with it.");
            }
            if (element.TryGetCurrentPattern(TogglePattern.Pattern, out pattern))
            {
                MoveOverlayTo(element);
                TogglePattern toggle = (TogglePattern)pattern;
                // Its new state is not reported: some apps (browsers) change it only after the call returns.
                Bounded(delegate () { toggle.Toggle(); });
                return "Toggled " + described + ".";
            }
            if (element.TryGetCurrentPattern(SelectionItemPattern.Pattern, out pattern))
            {
                MoveOverlayTo(element);
                Bounded(delegate () { ((SelectionItemPattern)pattern).Select(); });
                return "Selected " + described + ".";
            }
            if (element.TryGetCurrentPattern(ExpandCollapsePattern.Pattern, out pattern))
            {
                MoveOverlayTo(element);
                ExpandCollapsePattern expand = (ExpandCollapsePattern)pattern;
                bool expanded = expand.Current.ExpandCollapseState == ExpandCollapseState.Expanded;
                Bounded(delegate () { if (expanded) expand.Collapse(); else expand.Expand(); });
                return (expanded ? "Collapsed " : "Expanded ") + described + ".";
            }
            return null;
        }

        /// <summary>
        /// Runs a pattern call, waiting a bounded time. Some providers return only once what they
        /// started is over (a button that opens a modal dialog); the request should not wait for that.
        /// Errors of a call that returned in time are thrown here.
        /// </summary>
        static bool Bounded(ThreadStart call)
        {
            Exception error = null;
            Thread thread = new Thread(delegate ()
            {
                Dpi.MakeThreadAware();
                try { call(); }
                catch (Exception e) { error = e; }
            });
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
            if (!thread.Join(PatternWaitMs)) return false;
            if (error is InvalidOperationException && !(error is ElementNotAvailableException) && !(error is ElementNotEnabledException))
            {
                throw new ControlException("unsupported", "The element refused: " + error.Message);
            }
            if (error != null) throw error;
            return true;
        }

        // ----- type and key -----

        static string TypeText(IntPtr hwnd, int pid, string text)
        {
            if (text.Length == 0) return null;
            Desktop.Foreground(hwnd);
            Pointer.Touch();
            Input.TypeText(text, delegate () { return Desktop.IsForeground(hwnd, Native.GetLastActivePopup(hwnd)); });
            return null;
        }

        static string PressKeys(IntPtr hwnd, int pid, string keys)
        {
            Input.Chord chord = Input.ParseChord(keys);
            Desktop.Foreground(hwnd);
            Pointer.Touch();
            Input.Press(chord);
            return null;
        }

        // ----- scroll -----

        static string Scroll(IntPtr hwnd, int pid, Dictionary<string, object> action)
        {
            double dx = Params.Has(action, "dx") ? Params.Number(action, "dx") : 0;
            double dy = Params.Has(action, "dy") ? Params.Number(action, "dy") : 0;
            int linesX = (int)Math.Round(dx);
            int linesY = (int)Math.Round(dy);
            if (linesX == 0 && linesY == 0) throw new ControlException("invalid_request", "dx or dy must be at least one line.");

            Native.POINT point;
            if (Params.Has(action, "element"))
            {
                int index = Params.Int(action, "element");
                AutomationElement element = Element(hwnd, index);
                string done = ScrollByPattern(element, linesX, linesY);
                if (done != null) return done;
                point = Middle(element);
            }
            else if (Params.Has(action, "x") || Params.Has(action, "y"))
            {
                point = ToScreen(hwnd, Params.Number(action, "x"), Params.Number(action, "y"));
            }
            else
            {
                Native.RECT frame = Native.FrameBounds(hwnd);
                point = new Native.POINT(frame.Left + frame.Width / 2, frame.Top + frame.Height / 2);
            }

            PrepareForPointer(hwnd, pid, point);
            // Wheel notches the way Windows itself turns them into lines: one notch (120) scrolls the
            // user's "lines per notch" setting (3 by default), so N lines are N / that many notches,
            // rounded, and at least one so that every request moves something.
            int perNotchY = WheelSetting(Native.SPI_GETWHEELSCROLLLINES);
            int perNotchX = WheelSetting(Native.SPI_GETWHEELSCROLLCHARS);
            int notchesY = linesY == 0 ? 0 : Math.Max(1, (int)Math.Round(Math.Abs(linesY) / (double)perNotchY));
            int notchesX = linesX == 0 ? 0 : Math.Max(1, (int)Math.Round(Math.Abs(linesX) / (double)perNotchX));
            // Positive dy moves down the page, which is a negative wheel turn; positive dx moves right.
            Input.Wheel(false, -Math.Sign(linesY), notchesY);
            Input.Wheel(true, Math.Sign(linesX), notchesX);
            List<string> parts = new List<string>();
            if (notchesY > 0) parts.Add(notchesY + (notchesY == 1 ? " notch " : " notches ") + (linesY > 0 ? "down" : "up"));
            if (notchesX > 0) parts.Add(notchesX + (notchesX == 1 ? " notch " : " notches ") + (linesX > 0 ? "right" : "left"));
            return "Turned the mouse wheel " + string.Join(" and ", parts.ToArray()) + " (" + perNotchY + " lines a notch).";
        }

        static int WheelSetting(uint setting)
        {
            int value = 3;
            Native.SystemParametersInfo(setting, 0, ref value, 0);
            // WHEEL_PAGESCROLL (-1 as unsigned) means a page a notch; count it as the default.
            return value <= 0 || value > 100 ? 3 : value;
        }

        /// <summary>Scrolls through the Scroll pattern of the element or its nearest scrollable ancestor; null when there is none.</summary>
        static string ScrollByPattern(AutomationElement element, int linesX, int linesY)
        {
            TreeWalker walker = TreeWalker.ControlViewWalker;
            AutomationElement current = element;
            for (int level = 0; current != null && level < 12; level++)
            {
                object pattern;
                if (current.TryGetCurrentPattern(ScrollPattern.Pattern, out pattern))
                {
                    ScrollPattern scroll = (ScrollPattern)pattern;
                    bool canY = linesY == 0 || scroll.Current.VerticallyScrollable;
                    bool canX = linesX == 0 || scroll.Current.HorizontallyScrollable;
                    if (canX && canY)
                    {
                        double beforeX = scroll.Current.HorizontalScrollPercent, beforeY = scroll.Current.VerticalScrollPercent;
                        int moved = 0;
                        int steps = Math.Max(Math.Abs(linesX), Math.Abs(linesY));
                        for (int i = 0; i < steps; i++)
                        {
                            ScrollAmount horizontal = i < Math.Abs(linesX) ? (linesX > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement) : ScrollAmount.NoAmount;
                            ScrollAmount vertical = i < Math.Abs(linesY) ? (linesY > 0 ? ScrollAmount.SmallIncrement : ScrollAmount.SmallDecrement) : ScrollAmount.NoAmount;
                            // At the end of the content the pattern refuses to go further.
                            try { scroll.Scroll(horizontal, vertical); moved++; }
                            catch (InvalidOperationException) { break; }
                        }
                        // Some providers (Chromium's pages) accept the call and do not move; the wheel does.
                        // The position is read again after a moment, since some report it late.
                        Thread.Sleep(60);
                        bool changed = scroll.Current.HorizontalScrollPercent != beforeX || scroll.Current.VerticalScrollPercent != beforeY;
                        if (!changed && moved > 0) return null;
                        MoveOverlayTo(current);
                        string what = current == element ? "it" : "its scrollable container";
                        return moved == 0 ? "Already at the end; nothing scrolled." : "Scrolled " + what + " by " + moved + (moved == 1 ? " line" : " lines") + " through UI Automation.";
                    }
                }
                try { current = walker.GetParent(current); }
                catch (ElementNotAvailableException) { break; }
            }
            return null;
        }

        // ----- drag -----

        static string Drag(IntPtr hwnd, int pid, Dictionary<string, object> action)
        {
            Native.POINT from = ToScreen(hwnd, Params.Number(action, "fromX"), Params.Number(action, "fromY"));
            Native.POINT to = ToScreen(hwnd, Params.Number(action, "toX"), Params.Number(action, "toY"));
            PrepareForPointer(hwnd, pid, from);
            CheckPointInApp(hwnd, pid, to, "the point where the drag would end");
            Input.Drag(from, to);
            return null;
        }

        // ----- set_value -----

        static string SetValue(IntPtr hwnd, Dictionary<string, object> action)
        {
            int index = Params.Int(action, "element");
            string value = Params.String(action, "value");
            AutomationElement element = Element(hwnd, index);
            string described = Describe(hwnd, index);
            object pattern;
            double parsed;
            // A slider can offer both; a number goes through RangeValue, which knows the slider's range.
            bool numeric = double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out parsed);
            object rangePattern;
            bool hasRange = element.TryGetCurrentPattern(RangeValuePattern.Pattern, out rangePattern);
            if (!(numeric && hasRange) && element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern))
            {
                ValuePattern field = (ValuePattern)pattern;
                if (field.Current.IsReadOnly) throw new ControlException("unsupported", "The element is read-only.");
                MoveOverlayTo(element);
                Bounded(delegate () { field.SetValue(value); });
                return "Set " + described + ".";
            }
            if (hasRange)
            {
                RangeValuePattern range = (RangeValuePattern)rangePattern;
                double number;
                if (!double.TryParse(value.Trim(), NumberStyles.Float, CultureInfo.InvariantCulture, out number)) throw new ControlException("invalid_request", "The element takes a number.");
                if (range.Current.IsReadOnly) throw new ControlException("unsupported", "The element is read-only.");
                if (number < range.Current.Minimum || number > range.Current.Maximum)
                {
                    throw new ControlException("invalid_request", "The element takes a number from " + range.Current.Minimum.ToString(CultureInfo.InvariantCulture) + " to " + range.Current.Maximum.ToString(CultureInfo.InvariantCulture) + ".");
                }
                MoveOverlayTo(element);
                Bounded(delegate () { range.SetValue(number); });
                return "Set " + described + " to " + number.ToString(CultureInfo.InvariantCulture) + ".";
            }
            throw new ControlException("unsupported", "The element holds no value that can be set; click it and type instead.");
        }

        // ----- shared -----

        /// <summary>The element the latest snapshot listed under this index, checked to still exist.</summary>
        static AutomationElement Element(IntPtr hwnd, int index)
        {
            WindowState state = Host.State(hwnd, false);
            if (state == null || index < 1 || index > state.Elements.Count) throw new ControlException("stale_element", "There is no element " + index + " in the window's latest snapshot.");
            AutomationElement element = state.Elements[index - 1];
            try
            {
                // Throws ElementNotAvailableException when the element is gone.
                ControlType unused = element.Current.ControlType;
            }
            catch (ElementNotAvailableException) { throw new ControlException("stale_element", "Element " + index + " is gone; take a new snapshot."); }
            return element;
        }

        /// <summary>"the Save button", for notes.</summary>
        static string Describe(IntPtr hwnd, int index)
        {
            WindowState state = Host.State(hwnd, false);
            string label = state.Labels[index - 1];
            string role = state.Roles[index - 1];
            if (role == "textfield" || role == "textarea") role = "field";
            if (role == "row") role = "item";
            if (string.IsNullOrEmpty(label)) return "the " + role;
            if (label.Length > 40) label = label.Substring(0, 39) + "\u2026";
            // "the A button", not "the A button button".
            if (label.EndsWith(role, StringComparison.OrdinalIgnoreCase)) return "the " + label;
            return "the " + label + " " + role;
        }

        static Native.POINT Middle(AutomationElement element)
        {
            Rect bounds = element.Current.BoundingRectangle;
            if (bounds.IsEmpty || bounds.Width <= 0 || bounds.Height <= 0) throw new ControlException("unsupported", "The element has no place on the screen.");
            return new Native.POINT((int)Math.Round(bounds.Left + bounds.Width / 2), (int)Math.Round(bounds.Top + bounds.Height / 2));
        }

        static void MoveOverlayTo(AutomationElement element)
        {
            try
            {
                Native.POINT point = Middle(element);
                Pointer.GlideTo(point.X, point.Y);
                Pointer.Pulse();
            }
            catch (ControlException) { }
        }

        /// <summary>
        /// A point in the latest snapshot's image as a screen point. The window may have moved since;
        /// its content moved with it, so the point is taken from where the frame is now.
        /// </summary>
        static Native.POINT ToScreen(IntPtr hwnd, double x, double y)
        {
            Native.RECT frame = Native.FrameBounds(hwnd);
            WindowState state = Host.State(hwnd, false);
            double scale;
            int width, height;
            if (state != null && state.ImageWidth > 0)
            {
                scale = state.Scale;
                width = state.ImageWidth;
                height = state.ImageHeight;
            }
            else
            {
                int maxEdge;
                lock (Host.Lock) { maxEdge = Host.MaxImageEdge; }
                scale = Math.Min(1.0, (double)maxEdge / Math.Max(1, Math.Max(frame.Width, frame.Height)));
                width = (int)Math.Round(frame.Width * scale);
                height = (int)Math.Round(frame.Height * scale);
            }
            if (x < 0 || y < 0 || x > width || y > height) throw new ControlException("invalid_request", "The point is outside the window's image (" + width + "\u00d7" + height + ").");
            int sx = frame.Left + (int)Math.Floor(Math.Min(x, width - 0.5) / scale);
            int sy = frame.Top + (int)Math.Floor(Math.Min(y, height - 0.5) / scale);
            return new Native.POINT(sx, sy);
        }

        /// <summary>
        /// Before real pointer input: the window comes to the front, the agent's pointer glides to the
        /// point, and the point is checked to be in the app's own window, so the click can never land in
        /// another app that happens to cover it. Then the real pointer moves there.
        /// </summary>
        static void PrepareForPointer(IntPtr hwnd, int pid, Native.POINT point)
        {
            Desktop.Foreground(hwnd);
            CheckPointInApp(hwnd, pid, point, "that point of the app's window");
            Pointer.GlideTo(point.X, point.Y);
            Native.SetCursorPos(point.X, point.Y);
        }

        /// <summary>Whether a click at the screen point reaches the app (its window, or a menu of its own) and no other; throws when not.</summary>
        static void CheckPointInApp(IntPtr hwnd, int pid, Native.POINT point, string what)
        {
            IntPtr hit = Desktop.WindowAtPoint(point);
            if (hit == IntPtr.Zero) return;
            int raw = Native.ProcessId(hit);
            if (raw == pid || raw == Native.ProcessId(hwnd) || Desktop.EffectivePid(hit) == pid) return;
            throw new ControlException("failed", "A window of " + Desktop.AppNameOf(hit) + " (\u201c" + Native.WindowText(hit) + "\u201d) covers " + what + "; nothing was done.");
        }
    }

    /// <summary>Real keyboard and pointer input through SendInput.</summary>
    internal static class Input
    {
        public const ushort VK_BACK = 0x08, VK_TAB = 0x09, VK_RETURN = 0x0D, VK_SHIFT = 0x10, VK_CONTROL = 0x11, VK_MENU = 0x12;
        public const ushort VK_ESCAPE = 0x1B, VK_SPACE = 0x20, VK_PRIOR = 0x21, VK_NEXT = 0x22, VK_END = 0x23, VK_HOME = 0x24;
        public const ushort VK_LEFT = 0x25, VK_UP = 0x26, VK_RIGHT = 0x27, VK_DOWN = 0x28, VK_INSERT = 0x2D, VK_DELETE = 0x2E;
        public const ushort VK_LWIN = 0x5B, VK_F1 = 0x70;

        static readonly HashSet<ushort> extendedKeys = new HashSet<ushort>(new ushort[] {
            VK_PRIOR, VK_NEXT, VK_END, VK_HOME, VK_LEFT, VK_UP, VK_RIGHT, VK_DOWN, VK_INSERT, VK_DELETE, VK_LWIN,
        });

        public class Chord
        {
            public List<ushort> Modifiers = new List<ushort>();
            public ushort Key;
            /// <summary>A character no key of the layout types, sent as text instead of a key.</summary>
            public string Unicode;
        }

        static readonly Dictionary<string, ushort> named = BuildNamed();

        static Dictionary<string, ushort> BuildNamed()
        {
            Dictionary<string, ushort> map = new Dictionary<string, ushort>(StringComparer.OrdinalIgnoreCase);
            map["enter"] = VK_RETURN; map["return"] = VK_RETURN; map["escape"] = VK_ESCAPE; map["esc"] = VK_ESCAPE;
            map["tab"] = VK_TAB; map["space"] = VK_SPACE; map["backspace"] = VK_BACK; map["delete"] = VK_DELETE; map["del"] = VK_DELETE;
            map["insert"] = VK_INSERT; map["up"] = VK_UP; map["down"] = VK_DOWN; map["left"] = VK_LEFT; map["right"] = VK_RIGHT;
            map["home"] = VK_HOME; map["end"] = VK_END; map["pageup"] = VK_PRIOR; map["pagedown"] = VK_NEXT;
            for (int i = 1; i <= 24; i++) map["f" + i] = (ushort)(VK_F1 + i - 1);
            return map;
        }

        static ushort Modifier(string name)
        {
            switch (name.ToLowerInvariant())
            {
                case "cmd": case "command": case "win": case "windows": case "meta": case "super": return VK_LWIN;
                case "ctrl": case "control": return VK_CONTROL;
                case "alt": case "option": case "opt": return VK_MENU;
                case "shift": return VK_SHIFT;
                default: return 0;
            }
        }

        public static Chord ParseChord(string keys)
        {
            string text = keys.Trim();
            if (text.Length == 0) throw new ControlException("invalid_request", "keys is empty.");
            List<string> parts = new List<string>();
            // "ctrl++" is ctrl with the plus key: a trailing "+" after a "+" is the key itself.
            if (text.Length > 1 && text.EndsWith("++"))
            {
                parts.AddRange(text.Substring(0, text.Length - 2).Split('+'));
                parts.Add("+");
            }
            else if (text == "+") parts.Add("+");
            else parts.AddRange(text.Split('+'));

            Chord chord = new Chord();
            for (int i = 0; i < parts.Count; i++)
            {
                string part = parts[i].Trim();
                if (part.Length == 0 && parts[i].Length > 0) part = " ";
                if (part.Length == 0) throw new ControlException("invalid_request", "keys has an empty part: " + keys + ".");
                bool last = i == parts.Count - 1;
                ushort modifier = Modifier(part);
                if (!last)
                {
                    if (modifier == 0) throw new ControlException("invalid_request", part + " is not a modifier (cmd, ctrl, alt, shift).");
                    if (!chord.Modifiers.Contains(modifier)) chord.Modifiers.Add(modifier);
                    continue;
                }
                ushort vk;
                if (modifier != 0) { chord.Key = modifier; continue; }
                if (named.TryGetValue(part, out vk)) { chord.Key = vk; continue; }
                if (part.Length == 1 || (part.Length == 2 && char.IsSurrogatePair(part, 0)))
                {
                    char c = part[0];
                    if (c >= 'a' && c <= 'z') { chord.Key = (ushort)char.ToUpperInvariant(c); continue; }
                    if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) { chord.Key = c; continue; }
                    ushort key;
                    bool shifted;
                    // Punctuation: the key of the app's layout that types it, with Shift if it needs it.
                    if (part.Length == 1 && LayoutKey(c, ForegroundLayout(), out key, out shifted))
                    {
                        chord.Key = key;
                        if (shifted && !chord.Modifiers.Contains(VK_SHIFT)) chord.Modifiers.Add(VK_SHIFT);
                        continue;
                    }
                    if (chord.Modifiers.Count == 0) { chord.Unicode = part; continue; }
                }
                throw new ControlException("invalid_request", "Unknown key " + part + ".");
            }
            return chord;
        }

        /// <summary>The keyboard layout of the app in front, which is the one that reads the keys.</summary>
        static IntPtr ForegroundLayout()
        {
            int unusedPid;
            return Native.GetKeyboardLayout(Native.GetWindowThreadProcessId(Native.GetForegroundWindow(), out unusedPid));
        }

        public static void Press(Chord chord)
        {
            if (chord.Unicode != null)
            {
                TypeText(chord.Unicode, null);
                return;
            }
            // Pressed as a person does, with a moment between the steps: apps that read input late
            // (XAML apps) can otherwise see the modifiers go up before the key arrives.
            try
            {
                foreach (ushort modifier in chord.Modifiers) Key(modifier, true);
                if (chord.Modifiers.Count > 0) Thread.Sleep(CharPauseMs);
                Key(chord.Key, true);
                Key(chord.Key, false);
                if (chord.Modifiers.Count > 0) Thread.Sleep(CharPauseMs);
            }
            finally
            {
                // The modifiers always go up, so a failure never leaves one held down.
                for (int i = chord.Modifiers.Count - 1; i >= 0; i--)
                {
                    try { Key(chord.Modifiers[i], false); }
                    catch (ControlException) { }
                }
            }
        }

        public static void Key(ushort vk, bool down)
        {
            List<Native.INPUT> inputs = new List<Native.INPUT>();
            inputs.Add(KeyInput(vk, down));
            Send(inputs);
        }

        static Native.INPUT KeyInput(ushort vk, bool down)
        {
            Native.INPUT input = new Native.INPUT();
            input.Type = Native.INPUT_KEYBOARD;
            input.U.Keyboard.Vk = vk;
            // Apps that read scan codes (games, terminals, remote desktops) get the real one too.
            input.U.Keyboard.Scan = (ushort)Native.MapVirtualKey(vk, 0);
            input.U.Keyboard.Flags = (down ? 0 : Native.KEYEVENTF_KEYUP) | (extendedKeys.Contains(vk) ? Native.KEYEVENTF_EXTENDEDKEY : 0);
            return input;
        }

        static Native.INPUT CharInput(char c, bool down)
        {
            Native.INPUT input = new Native.INPUT();
            input.Type = Native.INPUT_KEYBOARD;
            input.U.Keyboard.Scan = c;
            input.U.Keyboard.Flags = Native.KEYEVENTF_UNICODE | (down ? 0 : Native.KEYEVENTF_KEYUP);
            return input;
        }

        /// <summary>
        /// Types text as characters (KEYEVENTF_UNICODE events), so any character arrives as itself
        /// whatever the keyboard layout; a character outside the basic plane goes as its two UTF-16
        /// halves, which Windows reassembles. Line breaks and tabs go as the Enter and Tab keys, which
        /// is what apps expect of them.
        ///
        /// One character per SendInput call, with a pause after each. Windows keeps the character of a
        /// Unicode event aside until the app reads it, so when several wait in the queue of an app that
        /// reads its input late (Notepad and other XAML apps) it gets the last one several times over
        /// ("def" arrives as "fff"); such apps even reorder plain key presses sent together (an Enter
        /// overtakes the letters before it). Paced like this, about 60 characters a second, they keep up.
        ///
        /// Stops if the window loses the keyboard focus, so the rest never lands in another app.
        /// </summary>
        public static void TypeText(string text, Func<bool> stillFocused)
        {
            text = text.Replace("\r\n", "\n").Replace('\r', '\n');
            for (int i = 0; i < text.Length; i++)
            {
                // The app closed the helper's input: the reply was stopped or its access taken back.
                if (Host.Closing) throw new ControlException("failed", "Stopped after " + i + " of " + text.Length + " characters.");
                if (stillFocused != null && i % 10 == 0 && !stillFocused())
                {
                    throw new ControlException("failed", "The window lost the keyboard focus after " + i + " of " + text.Length + " characters; nothing more was typed.");
                }
                char c = text[i];
                List<Native.INPUT> inputs = new List<Native.INPUT>();
                if (c == '\n' || c == '\t')
                {
                    ushort vk = c == '\n' ? VK_RETURN : VK_TAB;
                    inputs.Add(KeyInput(vk, true));
                    inputs.Add(KeyInput(vk, false));
                }
                else
                {
                    inputs.Add(CharInput(c, true));
                    inputs.Add(CharInput(c, false));
                }
                Send(inputs);
                Thread.Sleep(CharPauseMs);
            }
        }

        /// <summary>After each typed character. Sleep rounds up to the system timer, about 15 ms.</summary>
        const int CharPauseMs = 10;

        /// <summary>
        /// The key that types the character on the layout, with or without Shift. VkKeyScanEx alone is
        /// not enough: for a character the layout lacks it answers the key of a look-alike (e-acute gives
        /// the E key), so the answer is checked by typing it in ToUnicodeEx. Not for dead keys.
        /// </summary>
        static bool LayoutKey(char c, IntPtr layout, out ushort vk, out bool shift)
        {
            vk = 0;
            shift = false;
            if (c < ' ' || char.IsSurrogate(c)) return false;
            short scan = Native.VkKeyScanEx(c, layout);
            if (scan == -1) return false;
            int modifiers = (scan >> 8) & 0xFF;
            if ((modifiers & ~1) != 0) return false;
            vk = (ushort)(scan & 0xFF);
            shift = (modifiers & 1) != 0;
            byte[] state = new byte[256];
            if (shift) state[VK_SHIFT] = 0x80;
            StringBuilder typed = new StringBuilder(8);
            // Flag 4: leave the keyboard's dead-key state alone (Windows 10 1607 and later).
            int count = Native.ToUnicodeEx(vk, Native.MapVirtualKeyEx(vk, 0, layout), state, typed, typed.Capacity, 4, layout);
            return count == 1 && typed[0] == c;
        }

        public static void Click(string button, int count)
        {
            uint down = button == "right" ? Native.MOUSEEVENTF_RIGHTDOWN : button == "middle" ? Native.MOUSEEVENTF_MIDDLEDOWN : Native.MOUSEEVENTF_LEFTDOWN;
            uint up = button == "right" ? Native.MOUSEEVENTF_RIGHTUP : button == "middle" ? Native.MOUSEEVENTF_MIDDLEUP : Native.MOUSEEVENTF_LEFTUP;
            for (int i = 0; i < count; i++)
            {
                List<Native.INPUT> inputs = new List<Native.INPUT>();
                inputs.Add(MouseInput(down, 0, 0, 0));
                inputs.Add(MouseInput(up, 0, 0, 0));
                Send(inputs);
                // Well inside the double-click time, so two or three clicks count as one double or triple click.
                if (i < count - 1) Thread.Sleep(40);
            }
        }

        public static void Wheel(bool horizontal, int direction, int notches)
        {
            for (int i = 0; i < notches; i++)
            {
                List<Native.INPUT> inputs = new List<Native.INPUT>();
                inputs.Add(MouseInput(horizontal ? Native.MOUSEEVENTF_HWHEEL : Native.MOUSEEVENTF_WHEEL, 0, 0, direction * 120));
                Send(inputs);
                Thread.Sleep(30);
            }
        }

        /// <summary>Press, move in small steps over about 300 ms (so apps see a drag rather than a jump), let go.</summary>
        public static void Drag(Native.POINT from, Native.POINT to)
        {
            const int steps = 20;
            const int durationMs = 300;
            List<Native.INPUT> press = new List<Native.INPUT>();
            press.Add(MouseInput(Native.MOUSEEVENTF_LEFTDOWN, 0, 0, 0));
            Send(press);
            Thread.Sleep(60);
            try
            {
                for (int i = 1; i <= steps; i++)
                {
                    double t = (double)i / steps;
                    int x = (int)Math.Round(from.X + (to.X - from.X) * t);
                    int y = (int)Math.Round(from.Y + (to.Y - from.Y) * t);
                    MoveTo(x, y);
                    Pointer.JumpTo(x, y);
                    Thread.Sleep(durationMs / steps);
                }
                Native.SetCursorPos(to.X, to.Y);
                Thread.Sleep(40);
            }
            finally
            {
                // The button always goes up, so a failure halfway never leaves it held down.
                List<Native.INPUT> release = new List<Native.INPUT>();
                release.Add(MouseInput(Native.MOUSEEVENTF_LEFTUP, 0, 0, 0));
                Send(release);
            }
        }

        /// <summary>A real move event (absolute, over the whole virtual desktop) as well as the cursor position.</summary>
        static void MoveTo(int x, int y)
        {
            int left = Native.GetSystemMetrics(Native.SM_XVIRTUALSCREEN);
            int top = Native.GetSystemMetrics(Native.SM_YVIRTUALSCREEN);
            int width = Math.Max(2, Native.GetSystemMetrics(Native.SM_CXVIRTUALSCREEN));
            int height = Math.Max(2, Native.GetSystemMetrics(Native.SM_CYVIRTUALSCREEN));
            int nx = (int)Math.Round((x - left) * 65535.0 / (width - 1));
            int ny = (int)Math.Round((y - top) * 65535.0 / (height - 1));
            List<Native.INPUT> inputs = new List<Native.INPUT>();
            inputs.Add(MouseInput(Native.MOUSEEVENTF_MOVE | Native.MOUSEEVENTF_ABSOLUTE | Native.MOUSEEVENTF_VIRTUALDESK, nx, ny, 0));
            Send(inputs);
        }

        static Native.INPUT MouseInput(uint flags, int dx, int dy, int data)
        {
            Native.INPUT input = new Native.INPUT();
            input.Type = Native.INPUT_MOUSE;
            input.U.Mouse.Dx = dx;
            input.U.Mouse.Dy = dy;
            input.U.Mouse.MouseData = data;
            input.U.Mouse.Flags = flags;
            return input;
        }

        static void Send(List<Native.INPUT> inputs)
        {
            if (inputs.Count == 0) return;
            uint sent = Native.SendInput((uint)inputs.Count, inputs.ToArray(), System.Runtime.InteropServices.Marshal.SizeOf(typeof(Native.INPUT)));
            // Windows refuses all of it when another desktop (the lock screen, a UAC prompt) has the input.
            if (sent != inputs.Count) throw new ControlException("failed", "Windows did not accept the input (is the screen locked or a security prompt open?).");
        }
    }
}
