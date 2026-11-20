// The outline of a window: the elements a person could read or use, from UI Automation, in the
// pixels of the snapshot's image.

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using System.Windows;
using System.Windows.Automation;

namespace Pulpo.Control
{
    internal static class Outline
    {
        public const int MaxText = 160;
        /// <summary>How long a walk may take. Browsers and big lists have trees far larger than any outline.</summary>
        const int WalkBudgetMs = 3000;

        public static List<Dictionary<string, object>> Walk(List<IntPtr> roots, Native.RECT frame, double scale, int width, int height, int maxElements, WindowState state, out bool truncated)
        {
            Walker walker = new Walker(roots, frame, scale, width, height, maxElements);
            // The walk runs on a thread of its own: a single UI Automation call into a busy app can
            // block for a long time, and the snapshot should still answer with the picture and what the
            // walk found so far.
            Thread thread = new Thread(walker.Run);
            thread.IsBackground = true;
            thread.SetApartmentState(ApartmentState.MTA);
            thread.Start();
            bool finished = thread.Join(WalkBudgetMs + 500);
            lock (walker)
            {
                walker.Stopped = true;
                truncated = walker.Truncated || !finished;
                state.Elements.AddRange(walker.Elements);
                state.Labels.AddRange(walker.Labels);
                state.Roles.AddRange(walker.Roles);
                return new List<Dictionary<string, object>>(walker.Results);
            }
        }

        public static string Cut(string text)
        {
            if (text == null) return "";
            text = text.Trim();
            if (text.Length <= MaxText) return text;
            // Never cut a surrogate pair in half: the JSON would carry an unpaired surrogate.
            int length = MaxText - 1;
            if (char.IsHighSurrogate(text[length - 1])) length--;
            return text.Substring(0, length) + "\u2026";
        }

        static readonly Dictionary<int, string> roles = BuildRoles();

        static Dictionary<int, string> BuildRoles()
        {
            Dictionary<int, string> map = new Dictionary<int, string>();
            // UIA_AppBarControlTypeId (Windows 8 and later), which the .NET Framework's ControlType does not name.
            map[50040] = "toolbar";
            map[ControlType.Button.Id] = "button";
            map[ControlType.Calendar.Id] = "calendar";
            map[ControlType.CheckBox.Id] = "checkbox";
            map[ControlType.ComboBox.Id] = "combobox";
            map[ControlType.Custom.Id] = "group";
            map[ControlType.DataGrid.Id] = "table";
            map[ControlType.DataItem.Id] = "row";
            map[ControlType.Document.Id] = "textarea";
            map[ControlType.Edit.Id] = "textfield";
            map[ControlType.Group.Id] = "group";
            map[ControlType.Header.Id] = "header";
            map[ControlType.HeaderItem.Id] = "columnheader";
            map[ControlType.Hyperlink.Id] = "link";
            map[ControlType.Image.Id] = "image";
            map[ControlType.List.Id] = "list";
            map[ControlType.ListItem.Id] = "row";
            map[ControlType.Menu.Id] = "menu";
            map[ControlType.MenuBar.Id] = "menubar";
            map[ControlType.MenuItem.Id] = "menuitem";
            map[ControlType.Pane.Id] = "group";
            map[ControlType.ProgressBar.Id] = "progress";
            map[ControlType.RadioButton.Id] = "radio";
            map[ControlType.ScrollBar.Id] = "scrollbar";
            map[ControlType.Separator.Id] = "separator";
            map[ControlType.Slider.Id] = "slider";
            map[ControlType.Spinner.Id] = "stepper";
            map[ControlType.SplitButton.Id] = "menubutton";
            map[ControlType.StatusBar.Id] = "statusbar";
            map[ControlType.Tab.Id] = "tablist";
            map[ControlType.TabItem.Id] = "tab";
            map[ControlType.Table.Id] = "table";
            map[ControlType.Text.Id] = "text";
            map[ControlType.Thumb.Id] = "thumb";
            map[ControlType.TitleBar.Id] = "titlebar";
            map[ControlType.ToolBar.Id] = "toolbar";
            map[ControlType.ToolTip.Id] = "tooltip";
            map[ControlType.Tree.Id] = "tree";
            map[ControlType.TreeItem.Id] = "treeitem";
            map[ControlType.Window.Id] = "window";
            return map;
        }

        public static string Role(ControlType type)
        {
            string role;
            if (type != null && roles.TryGetValue(type.Id, out role)) return role;
            return "group";
        }

        static readonly HashSet<int> interactiveTypes = new HashSet<int>(new int[] {
            ControlType.Button.Id, ControlType.CheckBox.Id, ControlType.ComboBox.Id, ControlType.Edit.Id,
            ControlType.Hyperlink.Id, ControlType.ListItem.Id, ControlType.MenuItem.Id, ControlType.RadioButton.Id,
            ControlType.Slider.Id, ControlType.Spinner.Id, ControlType.SplitButton.Id, ControlType.TabItem.Id,
            ControlType.TreeItem.Id, ControlType.DataItem.Id, ControlType.Document.Id, ControlType.HeaderItem.Id,
        });

        /// <summary>Controls whose children only repeat them (a button's text) or are their own parts.</summary>
        static readonly HashSet<int> leafTypes = new HashSet<int>(new int[] {
            ControlType.Button.Id, ControlType.CheckBox.Id, ControlType.RadioButton.Id, ControlType.Hyperlink.Id,
            ControlType.Edit.Id, ControlType.Slider.Id, ControlType.ProgressBar.Id, ControlType.Image.Id,
        });

        static readonly HashSet<int> repeatTypes = new HashSet<int>(new int[] {
            ControlType.Button.Id, ControlType.Text.Id, ControlType.Image.Id, ControlType.Hyperlink.Id, ControlType.SplitButton.Id,
        });

        /// <summary>Never shown nor descended into: scroll bars are reached through `scroll`, separators say nothing.</summary>
        static readonly HashSet<int> skippedTypes = new HashSet<int>(new int[] {
            ControlType.ScrollBar.Id, ControlType.Separator.Id, ControlType.Thumb.Id,
        });

        /// <summary>The properties each element brings along in the one call that finds it.</summary>
        public static CacheRequest NewCacheRequest()
        {
            CacheRequest request = new CacheRequest();
            request.TreeFilter = Automation.ControlViewCondition;
            request.TreeScope = TreeScope.Element;
            request.AutomationElementMode = AutomationElementMode.Full;
            AutomationProperty[] properties = new AutomationProperty[] {
                AutomationElement.ControlTypeProperty, AutomationElement.NameProperty, AutomationElement.BoundingRectangleProperty,
                AutomationElement.IsOffscreenProperty, AutomationElement.IsEnabledProperty, AutomationElement.HasKeyboardFocusProperty,
                AutomationElement.IsPasswordProperty, AutomationElement.ClassNameProperty, AutomationElement.NativeWindowHandleProperty,
                AutomationElement.IsInvokePatternAvailableProperty, AutomationElement.IsTogglePatternAvailableProperty,
                AutomationElement.IsSelectionItemPatternAvailableProperty, AutomationElement.IsExpandCollapsePatternAvailableProperty,
                AutomationElement.IsValuePatternAvailableProperty, AutomationElement.IsRangeValuePatternAvailableProperty,
                AutomationElement.IsScrollPatternAvailableProperty, AutomationElement.IsTextPatternAvailableProperty,
                ValuePattern.ValueProperty, ValuePattern.IsReadOnlyProperty, TogglePattern.ToggleStateProperty,
                RangeValuePattern.ValueProperty, SelectionItemPattern.IsSelectedProperty,
            };
            foreach (AutomationProperty property in properties) request.Add(property);
            return request;
        }

        /// <summary>A cached property, or null when the element does not support it.</summary>
        public static object Cached(AutomationElement element, AutomationProperty property)
        {
            object value = element.GetCachedPropertyValue(property, true);
            return value == AutomationElement.NotSupported ? null : value;
        }

        public static bool CachedBool(AutomationElement element, AutomationProperty property)
        {
            object value = Cached(element, property);
            return value is bool && (bool)value;
        }

        /// <summary>What the element holds, read from whichever pattern it has.</summary>
        public static string ValueOf(AutomationElement element, ControlType type)
        {
            if (CachedBool(element, AutomationElement.IsPasswordProperty)) return null;
            if (CachedBool(element, AutomationElement.IsValuePatternAvailableProperty))
            {
                string text = Cached(element, ValuePattern.ValueProperty) as string;
                if (!string.IsNullOrEmpty(text)) return Cut(text);
            }
            if (CachedBool(element, AutomationElement.IsTogglePatternAvailableProperty))
            {
                object toggle = Cached(element, TogglePattern.ToggleStateProperty);
                if (toggle is ToggleState)
                {
                    ToggleState state = (ToggleState)toggle;
                    return state == ToggleState.On ? "on" : state == ToggleState.Off ? "off" : "mixed";
                }
            }
            if (CachedBool(element, AutomationElement.IsRangeValuePatternAvailableProperty))
            {
                object number = Cached(element, RangeValuePattern.ValueProperty);
                if (number is double) return ((double)number).ToString("G6", CultureInfo.InvariantCulture);
            }
            if (CachedBool(element, AutomationElement.IsSelectionItemPatternAvailableProperty) && CachedBool(element, SelectionItemPattern.IsSelectedProperty)) return "selected";
            // A document (Notepad's page, a rich edit) often offers its text only through the Text pattern.
            if ((type == ControlType.Document || type == ControlType.Edit) && CachedBool(element, AutomationElement.IsTextPatternAvailableProperty))
            {
                try
                {
                    TextPattern pattern = (TextPattern)element.GetCurrentPattern(TextPattern.Pattern);
                    string text = pattern.DocumentRange.GetText(MaxText + 1);
                    if (!string.IsNullOrEmpty(text)) return Cut(text);
                }
                catch (Exception) { }
            }
            return null;
        }

        /// <summary>Whether a Win32 edit control takes several lines (ES_MULTILINE); UI Automation does not say.</summary>
        public static bool IsMultiline(AutomationElement element)
        {
            object handle = Cached(element, AutomationElement.NativeWindowHandleProperty);
            if (!(handle is int) || (int)handle == 0) return false;
            return (Native.Style(new IntPtr((int)handle)) & Native.ES_MULTILINE) != 0;
        }

        class Walker
        {
            readonly List<IntPtr> roots;
            readonly Native.RECT frame;
            readonly double scale;
            readonly int width;
            readonly int height;
            readonly int maxElements;
            readonly DateTime deadline;

            public readonly List<Dictionary<string, object>> Results = new List<Dictionary<string, object>>();
            public readonly List<AutomationElement> Elements = new List<AutomationElement>();
            public readonly List<string> Labels = new List<string>();
            public readonly List<string> Roles = new List<string>();
            public bool Truncated;
            public bool Stopped;
            readonly HashSet<string> seen = new HashSet<string>();

            public Walker(List<IntPtr> roots, Native.RECT frame, double scale, int width, int height, int maxElements)
            {
                this.roots = roots;
                this.frame = frame;
                this.scale = scale;
                this.width = width;
                this.height = height;
                this.maxElements = maxElements;
                deadline = DateTime.UtcNow.AddMilliseconds(WalkBudgetMs);
            }

            public void Run()
            {
                Dpi.MakeThreadAware();
                try
                {
                    CacheRequest request = NewCacheRequest();
                    using (request.Activate())
                    {
                        for (int i = 0; i < roots.Count && !Done(); i++)
                        {
                            AutomationElement root;
                            try { root = AutomationElement.FromHandle(roots[i]); }
                            catch (Exception) { continue; }
                            // The window itself is the snapshot; its menus and dialogs are listed as themselves.
                            if (i == 0) VisitChildren(root, 0, "", false);
                            else Visit(root, 0, "", false);
                        }
                    }
                }
                catch (Exception e)
                {
                    Host.Log("outline walk stopped: " + e.Message);
                }
            }

            bool Done()
            {
                lock (this)
                {
                    if (Stopped) return true;
                    if (DateTime.UtcNow > deadline) { Truncated = true; return true; }
                    return false;
                }
            }

            void VisitChildren(AutomationElement element, int depth, string parentLabel, bool parentActs)
            {
                if (Done()) return;
                AutomationElementCollection children;
                try { children = element.FindAll(TreeScope.Children, Automation.ControlViewCondition); }
                catch (Exception) { return; }
                foreach (AutomationElement child in children)
                {
                    if (Done()) return;
                    Visit(child, depth, parentLabel, parentActs);
                }
            }

            void Visit(AutomationElement element, int depth, string parentLabel, bool parentActs)
            {
                ControlType type;
                Rect bounds;
                bool offscreen;
                string name;
                try
                {
                    type = Cached(element, AutomationElement.ControlTypeProperty) as ControlType;
                    object rect = Cached(element, AutomationElement.BoundingRectangleProperty);
                    bounds = rect is Rect ? (Rect)rect : Rect.Empty;
                    offscreen = CachedBool(element, AutomationElement.IsOffscreenProperty);
                    name = Cut(Cached(element, AutomationElement.NameProperty) as string);
                }
                catch (ElementNotAvailableException) { return; }
                if (type == null) return;
                if (skippedTypes.Contains(type.Id)) return;
                bool sized = !bounds.IsEmpty && bounds.Width > 0 && bounds.Height > 0;
                // Off screen with a place of its own: scrolled away or on a hidden page, and so is
                // everything inside it. Without a place, it may be a wrapper whose children have one.
                if (offscreen && sized) return;

                int childDepth = depth;
                string label = parentLabel;
                bool acts = parentActs;
                // A button inside a control of the same name (Paint's shape buttons inside their list
                // rows) adds nothing: the outer one already does what clicking either would. A field
                // inside one (a combo box's edit) is kept, since it is what takes a value.
                bool repeats = parentActs && name.Length > 0 && name == parentLabel && repeatTypes.Contains(type.Id);
                if (!offscreen && sized && !repeats && Emits(element, type, name, parentLabel))
                {
                    Dictionary<string, object> entry = Entry(element, type, name, bounds, depth);
                    // XAML lists an open popup both inside the window and as a window of its own; the
                    // second time it, and everything in it, is skipped.
                    if (entry != null && !seen.Add(entry["role"] + "|" + name + "|" + entry["x"] + "," + entry["y"] + "," + entry["width"] + "," + entry["height"])) return;
                    if (entry != null)
                    {
                        lock (this)
                        {
                            if (Stopped) return;
                            if (Results.Count >= maxElements) { Truncated = true; Stopped = true; return; }
                            entry["index"] = Results.Count + 1;
                            Results.Add(Reordered(entry));
                            Elements.Add(element);
                            Labels.Add(name);
                            Roles.Add((string)entry["role"]);
                        }
                        childDepth = depth + 1;
                        label = name;
                        acts = Acts(element, type);
                    }
                }
                if (leafTypes.Contains(type.Id)) return;
                VisitChildren(element, childDepth, label, acts);
            }

            /// <summary>Something a click on does something: an interactive control or one with a pattern that acts.</summary>
            static bool Acts(AutomationElement element, ControlType type)
            {
                return interactiveTypes.Contains(type.Id)
                    || CachedBool(element, AutomationElement.IsInvokePatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsTogglePatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsSelectionItemPatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsExpandCollapsePatternAvailableProperty);
            }

            static bool Emits(AutomationElement element, ControlType type, string name, string parentLabel)
            {
                if (type == ControlType.Text || type == ControlType.Image)
                {
                    // A button's or row's own caption is already its label.
                    return name.Length > 0 && name != parentLabel;
                }
                if (interactiveTypes.Contains(type.Id)) return true;
                if (CachedBool(element, AutomationElement.IsInvokePatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsTogglePatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsSelectionItemPatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsExpandCollapsePatternAvailableProperty)
                    || CachedBool(element, AutomationElement.IsRangeValuePatternAvailableProperty))
                {
                    return true;
                }
                if (CachedBool(element, AutomationElement.IsValuePatternAvailableProperty) && !CachedBool(element, ValuePattern.IsReadOnlyProperty)) return true;
                // Panes, groups, lists and the like say something only when they have a name.
                return name.Length > 0;
            }

            Dictionary<string, object> Entry(AutomationElement element, ControlType type, string name, Rect bounds, int depth)
            {
                double left = Math.Max(0, (bounds.Left - frame.Left) * scale);
                double top = Math.Max(0, (bounds.Top - frame.Top) * scale);
                double right = Math.Min(width, (bounds.Right - frame.Left) * scale);
                double bottom = Math.Min(height, (bounds.Bottom - frame.Top) * scale);
                int x = (int)Math.Round(left);
                int y = (int)Math.Round(top);
                int w = (int)Math.Round(right) - x;
                int h = (int)Math.Round(bottom) - y;
                // Entirely outside the picture (a part of a menu that hangs past the window's edge).
                if (w <= 0 || h <= 0) return null;

                string role = Role(type);
                if (type == ControlType.Edit && IsMultiline(element)) role = "textarea";
                // A web page is a document that cannot be typed into; Notepad's page is one that can.
                if (type == ControlType.Document && CachedBool(element, AutomationElement.IsValuePatternAvailableProperty) && CachedBool(element, ValuePattern.IsReadOnlyProperty)) role = "document";
                if (type == ControlType.Pane && CachedBool(element, AutomationElement.IsScrollPatternAvailableProperty)) role = "scrollarea";

                Dictionary<string, object> entry = new Dictionary<string, object>();
                entry["depth"] = depth;
                entry["role"] = role;
                if (name.Length > 0) entry["label"] = name;
                string value = ValueOf(element, type);
                if (value != null && value != name) entry["value"] = value;
                entry["x"] = x;
                entry["y"] = y;
                entry["width"] = w;
                entry["height"] = h;
                if (CachedBool(element, AutomationElement.HasKeyboardFocusProperty)) entry["focused"] = true;
                object enabled = Cached(element, AutomationElement.IsEnabledProperty);
                if (enabled is bool && !(bool)enabled) entry["enabled"] = false;
                return entry;
            }

            /// <summary>The fields in protocol.ts's order, index first, so the outline reads naturally.</summary>
            static Dictionary<string, object> Reordered(Dictionary<string, object> entry)
            {
                Dictionary<string, object> ordered = new Dictionary<string, object>();
                ordered["index"] = entry["index"];
                foreach (KeyValuePair<string, object> pair in entry)
                {
                    if (pair.Key != "index") ordered[pair.Key] = pair.Value;
                }
                return ordered;
            }
        }
    }
}
