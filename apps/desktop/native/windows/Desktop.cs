// The desktop's apps and windows: which windows count as an app's ordinary windows, which process
// a window really belongs to, whether the helper may drive it, and bringing it to the front.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

namespace Pulpo.Control
{
    internal static class Desktop
    {
        const string FrameHostClass = "ApplicationFrameWindow";
        const string CoreWindowClass = "Windows.UI.Core.CoreWindow";
        /// <summary>Smaller than this on either edge is a helper surface, not a window someone works in.</summary>
        const int MinimumEdge = 48;

        static readonly Dictionary<string, string> namesByPath = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        static int ownIntegrity = -2;

        /// <summary>Every top-level window, front to back.</summary>
        public static List<IntPtr> TopLevelWindows()
        {
            List<IntPtr> windows = new List<IntPtr>();
            Native.EnumWindows(delegate (IntPtr hwnd, IntPtr unused) { windows.Add(hwnd); return true; }, IntPtr.Zero);
            return windows;
        }

        /// <summary>
        /// The process a window belongs to as the user sees it. UWP apps (Calculator, Settings) draw
        /// inside a frame that ApplicationFrameHost.exe owns; the app's own process owns the
        /// CoreWindow inside it. 0 when that cannot be found (a suspended UWP app's frame is empty).
        /// </summary>
        public static int EffectivePid(IntPtr hwnd)
        {
            if (Native.ClassName(hwnd) == FrameHostClass)
            {
                IntPtr core = Native.FindWindowEx(hwnd, IntPtr.Zero, CoreWindowClass, null);
                return core == IntPtr.Zero ? 0 : Native.ProcessId(core);
            }
            return Native.ProcessId(hwnd);
        }

        /// <summary>
        /// A window a person works in: visible or minimized, titled, not a tool window, and owned by
        /// no window they can see. That is the taskbar's rule, under which a dialog whose owner is a
        /// hidden helper window (the Run dialog) counts, and one in front of an app's window does not.
        /// </summary>
        public static bool IsOrdinary(IntPtr hwnd)
        {
            if (!Native.IsWindowVisible(hwnd)) return false;
            uint ex = Native.ExStyle(hwnd);
            IntPtr owner = Native.GetWindow(hwnd, Native.GW_OWNER);
            if (owner != IntPtr.Zero && Native.IsWindowVisible(owner) && (ex & Native.WS_EX_APPWINDOW) == 0) return false;
            if ((ex & Native.WS_EX_TOOLWINDOW) != 0) return false;
            if (Native.IsCloaked(hwnd)) return false;
            if (Native.WindowText(hwnd).Trim().Length == 0) return false;
            string cls = Native.ClassName(hwnd);
            // The desktop itself and the taskbar are explorer.exe's, but they are not windows of an app.
            if (cls == "Progman" || cls == "WorkerW" || cls == "Shell_TrayWnd" || cls == "Shell_SecondaryTrayWnd") return false;
            Native.RECT rect = NormalBounds(hwnd);
            return rect.Width >= MinimumEdge && rect.Height >= MinimumEdge;
        }

        /// <summary>The frame as it is, or as it would be once restored when the window is minimized.</summary>
        public static Native.RECT NormalBounds(IntPtr hwnd)
        {
            if (Native.IsIconic(hwnd))
            {
                Native.WINDOWPLACEMENT placement = new Native.WINDOWPLACEMENT();
                placement.Length = Marshal.SizeOf(typeof(Native.WINDOWPLACEMENT));
                if (Native.GetWindowPlacement(hwnd, ref placement)) return placement.NormalPosition;
            }
            return Native.FrameBounds(hwnd);
        }

        public static List<Dictionary<string, object>> Apps()
        {
            IntPtr foreground = Native.GetForegroundWindow();
            IntPtr foregroundRoot = foreground == IntPtr.Zero ? IntPtr.Zero : Native.GetAncestor(foreground, Native.GA_ROOTOWNER);
            int foregroundPid = foregroundRoot == IntPtr.Zero ? 0 : EffectivePid(foregroundRoot);

            List<int> order = new List<int>();
            Dictionary<int, List<Dictionary<string, object>>> windowsByPid = new Dictionary<int, List<Dictionary<string, object>>>();
            Dictionary<int, bool> allowed = new Dictionary<int, bool>();
            foreach (IntPtr hwnd in TopLevelWindows())
            {
                if (!IsOrdinary(hwnd)) continue;
                int pid = EffectivePid(hwnd);
                if (Host.IsExcluded(pid) || Host.IsExcluded(Native.ProcessId(hwnd))) continue;
                bool ok;
                if (!allowed.TryGetValue(pid, out ok))
                {
                    // Windows of a process at a higher integrity level (an app run as administrator) take
                    // no input from this one (UIPI), so they are not offered at all.
                    ok = CanDrive(pid);
                    allowed[pid] = ok;
                }
                if (!ok) continue;
                List<Dictionary<string, object>> list;
                if (!windowsByPid.TryGetValue(pid, out list))
                {
                    list = new List<Dictionary<string, object>>();
                    windowsByPid[pid] = list;
                    order.Add(pid);
                }
                list.Add(WindowInfo(hwnd));
            }
            if (order.Remove(foregroundPid)) order.Insert(0, foregroundPid);

            List<Dictionary<string, object>> apps = new List<Dictionary<string, object>>();
            foreach (int pid in order)
            {
                string path = ProcessPath(pid);
                if (path == null) continue;
                Dictionary<string, object> app = new Dictionary<string, object>();
                app["id"] = Path.GetFileName(path).ToLowerInvariant();
                app["name"] = PackagedName(pid) ?? FriendlyName(path);
                app["pid"] = pid;
                app["frontmost"] = pid == foregroundPid;
                app["windows"] = windowsByPid[pid];
                apps.Add(app);
            }
            return apps;
        }

        public static Dictionary<string, object> WindowInfo(IntPtr hwnd)
        {
            Dictionary<string, object> window = new Dictionary<string, object>();
            window["id"] = hwnd.ToInt64();
            window["title"] = Native.WindowText(hwnd);
            window["minimized"] = Native.IsIconic(hwnd);
            return window;
        }

        /// <summary>The window the request names, checked to still exist and to belong to the process it names.</summary>
        public static IntPtr Resolve(int pid, long windowId)
        {
            IntPtr hwnd = new IntPtr(windowId);
            if (windowId == 0 || !Native.IsWindow(hwnd)) throw new ControlException("not_found", "The window is gone.");
            if (Host.IsExcluded(pid) || Host.IsExcluded(Native.ProcessId(hwnd))) throw new ControlException("not_found", "There is no such window.");
            if (EffectivePid(hwnd) != pid)
            {
                if (!ProcessExists(pid)) throw new ControlException("not_found", "The app is no longer running.");
                throw new ControlException("not_found", "That window does not belong to the app.");
            }
            if (!CanDrive(pid)) throw new ControlException("unsupported", "The app runs as administrator; Windows does not let a normal app read or control it.");
            return hwnd;
        }

        static bool ProcessExists(int pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return false;
            Native.CloseHandle(process);
            return true;
        }

        public static string ProcessPath(int pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return null;
            try
            {
                StringBuilder name = new StringBuilder(1024);
                int size = name.Capacity;
                return Native.QueryFullProcessImageName(process, 0, name, ref size) ? name.ToString(0, size) : null;
            }
            finally { Native.CloseHandle(process); }
        }

        /// <summary>The file description from the executable's version information (`Notepad`), else its name without `.exe`.</summary>
        public static string FriendlyName(string path)
        {
            lock (namesByPath)
            {
                string name;
                if (namesByPath.TryGetValue(path, out name)) return name;
                try
                {
                    string description = FileVersionInfo.GetVersionInfo(path).FileDescription;
                    if (description != null) name = description.Trim();
                }
                catch (Exception) { }
                if (string.IsNullOrEmpty(name)) name = Path.GetFileNameWithoutExtension(path);
                namesByPath[path] = name;
                return name;
            }
        }

        static readonly Dictionary<string, string> namesByAppId = new Dictionary<string, string>();

        /// <summary>
        /// The name Start shows for a packaged app (`Calculator`), whose executable's own description is
        /// often an internal name (`CalculatorApp`). Null for an ordinary desktop app.
        /// </summary>
        public static string PackagedName(int pid)
        {
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return null;
            string appId;
            try
            {
                StringBuilder id = new StringBuilder(512);
                int length = id.Capacity;
                // Fails (APPMODEL_ERROR_NO_APPLICATION) for a process that is not a packaged app.
                if (Native.GetApplicationUserModelId(process, ref length, id) != 0) return null;
                appId = id.ToString();
            }
            catch (EntryPointNotFoundException) { return null; }
            finally { Native.CloseHandle(process); }
            lock (namesByAppId)
            {
                string name;
                if (namesByAppId.TryGetValue(appId, out name)) return name;
                try
                {
                    Native.IShellItem item;
                    Native.SHCreateItemFromParsingName("shell:AppsFolder\\" + appId, IntPtr.Zero, typeof(Native.IShellItem).GUID, out item);
                    item.GetDisplayName(0, out name);
                    Marshal.ReleaseComObject(item);
                }
                catch (Exception) { name = null; }
                if (name != null && name.Trim().Length == 0) name = null;
                namesByAppId[appId] = name;
                return name;
            }
        }

        /// <summary>
        /// Whether input from this process reaches the other: its integrity level is not higher than
        /// ours. A process whose token cannot even be read is treated as higher, which is what it
        /// almost always is (an elevated app seen from a normal one).
        /// </summary>
        public static bool CanDrive(int pid)
        {
            if (ownIntegrity == -2) ownIntegrity = Integrity(Native.GetCurrentProcess());
            if (ownIntegrity < 0) return true;
            IntPtr process = Native.OpenProcess(Native.PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
            if (process == IntPtr.Zero) return false;
            try
            {
                int level = Integrity(process);
                return level >= 0 && level <= ownIntegrity;
            }
            finally { Native.CloseHandle(process); }
        }

        /// <summary>The process's mandatory integrity level (0x2000 medium, 0x3000 high), or -1.</summary>
        static int Integrity(IntPtr process)
        {
            IntPtr token;
            if (!Native.OpenProcessToken(process, Native.TOKEN_QUERY, out token)) return -1;
            IntPtr buffer = IntPtr.Zero;
            try
            {
                int length;
                Native.GetTokenInformation(token, Native.TokenIntegrityLevel, IntPtr.Zero, 0, out length);
                if (length <= 0) return -1;
                buffer = Marshal.AllocHGlobal(length);
                if (!Native.GetTokenInformation(token, Native.TokenIntegrityLevel, buffer, length, out length)) return -1;
                // TOKEN_MANDATORY_LABEL starts with a pointer to the label's SID; its last sub-authority is the level.
                IntPtr sid = Marshal.ReadIntPtr(buffer);
                int count = Marshal.ReadByte(Native.GetSidSubAuthorityCount(sid));
                if (count == 0) return -1;
                return Marshal.ReadInt32(Native.GetSidSubAuthority(sid, (uint)(count - 1)));
            }
            finally
            {
                if (buffer != IntPtr.Zero) Marshal.FreeHGlobal(buffer);
                Native.CloseHandle(token);
            }
        }

        /// <summary>
        /// The app's other surfaces that belong with the window right now and float above it: open
        /// menus, drop-down lists, tooltips and dialogs it owns. They are separate top-level windows on
        /// Windows, so a picture of the window alone would miss the menu the agent just opened. Front
        /// to back.
        /// </summary>
        public static List<IntPtr> Popups(IntPtr hwnd, int pid)
        {
            List<IntPtr> popups = new List<IntPtr>();
            Native.RECT frame = Native.FrameBounds(hwnd);
            foreach (IntPtr other in TopLevelWindows())
            {
                // Windows above the target come first in z-order; nothing below it is drawn over it.
                if (other == hwnd) break;
                if (!Native.IsWindowVisible(other) || Native.IsCloaked(other)) continue;
                if (Native.ProcessId(other) != Native.ProcessId(hwnd) && EffectivePid(other) != pid) continue;
                bool owned = false;
                for (IntPtr owner = Native.GetWindow(other, Native.GW_OWNER); owner != IntPtr.Zero; owner = Native.GetWindow(owner, Native.GW_OWNER))
                {
                    if (owner == hwnd) { owned = true; break; }
                }
                bool popup = (Native.Style(other) & Native.WS_POPUP) != 0 && Native.GetWindow(other, Native.GW_OWNER) == IntPtr.Zero && !IsOrdinary(other);
                if (!owned && !popup) continue;
                Native.RECT bounds = Native.FrameBounds(other);
                if (bounds.Width <= 0 || bounds.Height <= 0) continue;
                if (bounds.Right <= frame.Left || bounds.Left >= frame.Right || bounds.Bottom <= frame.Top || bounds.Top >= frame.Bottom) continue;
                popups.Add(other);
            }
            return popups;
        }

        /// <summary>
        /// Brings the window (or the dialog it is waiting on) to the front with the keyboard focus, so
        /// real input reaches it. Windows refuses SetForegroundWindow to a process that did not receive
        /// the last input, so this falls back on the usual ways around that.
        /// </summary>
        public static void Foreground(IntPtr hwnd)
        {
            if (Native.IsIconic(hwnd))
            {
                Native.ShowWindow(hwnd, Native.SW_RESTORE);
                Thread.Sleep(250);
            }
            // A modal dialog the window is waiting on is what takes the input.
            IntPtr target = Native.GetLastActivePopup(hwnd);
            if (target == IntPtr.Zero || !Native.IsWindowVisible(target) || !Native.IsWindowEnabled(target)) target = hwnd;
            if (IsForeground(hwnd, target))
            {
                // Activation and stacking can part: a browser activated through UI Automation keeps
                // the keyboard while staying behind other windows. Raising it needs no permission
                // once it is the foreground window.
                Native.SetWindowPos(target, Native.HWND_TOP, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE);
                return;
            }

            if (!TrySetForeground(target))
            {
                // AttachThreadInput shares the foreground thread's input state, which lets the call through.
                IntPtr current = Native.GetForegroundWindow();
                int unusedPid;
                uint foregroundThread = current == IntPtr.Zero ? 0 : Native.GetWindowThreadProcessId(current, out unusedPid);
                uint ownThread = Native.GetCurrentThreadId();
                bool attached = foregroundThread != 0 && foregroundThread != ownThread && Native.AttachThreadInput(ownThread, foregroundThread, true);
                try
                {
                    Native.BringWindowToTop(target);
                    TrySetForeground(target);
                }
                finally
                {
                    if (attached) Native.AttachThreadInput(ownThread, foregroundThread, false);
                }
            }
            if (!IsForeground(hwnd, target))
            {
                // A synthetic Alt press makes this process the one that received the last input. The key
                // goes up only after the switch, so the old window does not open its menu bar.
                Input.Key(Input.VK_MENU, true);
                TrySetForeground(target);
                Input.Key(Input.VK_MENU, false);
            }
            for (int i = 0; i < 20 && !IsForeground(hwnd, target); i++) Thread.Sleep(15);
            if (!IsForeground(hwnd, target))
            {
                // Input from a normal app cannot reach an app run as administrator, Alt included.
                IntPtr front = Native.GetForegroundWindow();
                if (front != IntPtr.Zero && !CanDrive(EffectivePid(Native.GetAncestor(front, Native.GA_ROOTOWNER))))
                {
                    throw new ControlException("failed", "An app running as administrator is in front (\u201c" + Native.WindowText(front) + "\u201d), and Windows does not let this window come in front of it. Ask the user to click the window or that app's minimize button.");
                }
                throw new ControlException("failed", "Windows did not let the window come to the front.");
            }
        }

        static bool TrySetForeground(IntPtr target)
        {
            Native.SetForegroundWindow(target);
            for (int i = 0; i < 6; i++)
            {
                if (Native.GetForegroundWindow() == target) return true;
                Thread.Sleep(10);
            }
            return false;
        }

        /// <summary>The foreground window is the window, the dialog it waits on, or one of its own menus.</summary>
        public static bool IsForeground(IntPtr hwnd, IntPtr target)
        {
            IntPtr foreground = Native.GetForegroundWindow();
            if (foreground == IntPtr.Zero) return false;
            if (foreground == hwnd || foreground == target) return true;
            return Native.GetAncestor(foreground, Native.GA_ROOTOWNER) == hwnd && Native.ProcessId(foreground) == Native.ProcessId(hwnd);
        }

        /// <summary>The name of the app a window belongs to, for telling the agent what is in the way.</summary>
        public static string AppNameOf(IntPtr window)
        {
            int pid = EffectivePid(window);
            string path = ProcessPath(pid);
            return path == null ? "another app" : PackagedName(pid) ?? FriendlyName(path);
        }

        /// <summary>
        /// A window of another app drawn over some part of the rectangle, in front of the given
        /// window; zero when there is none. A copy of the screen there would show that app, which the
        /// user never let the agent see, so nothing is copied from the screen where this answers one.
        /// The app's own windows in front (its menus and dialogs) are its own to show, and overlays
        /// that take no clicks are not another app's window.
        /// </summary>
        public static IntPtr CoveringWindow(IntPtr hwnd, int pid, Native.RECT rect)
        {
            int process = Native.ProcessId(hwnd);
            foreach (IntPtr other in TopLevelWindows())
            {
                // Front to back: everything from here on is behind the window.
                if (other == hwnd) break;
                if (!Native.IsWindowVisible(other) || Native.IsCloaked(other) || Native.IsIconic(other)) continue;
                int otherProcess = Native.ProcessId(other);
                if (otherProcess == Host.OwnPid || otherProcess == process || EffectivePid(other) == pid) continue;
                if ((Native.ExStyle(other) & (Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED)) == (Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED)) continue;
                Native.RECT bounds = Native.FrameBounds(other);
                if (bounds.Width <= 0 || bounds.Height <= 0) continue;
                if (bounds.Left < rect.Right && bounds.Right > rect.Left && bounds.Top < rect.Bottom && bounds.Bottom > rect.Top) return other;
            }
            return IntPtr.Zero;
        }

        /// <summary>
        /// The top-level window that would receive a click at this screen point, so a click never
        /// lands in another app. The agent's pointer takes no clicks; when the hit test finds it
        /// anyway, the windows under it are searched by z-order instead.
        /// </summary>
        public static IntPtr WindowAtPoint(Native.POINT point)
        {
            IntPtr hit = Native.WindowFromPoint(point);
            if (hit != IntPtr.Zero && Native.ProcessId(hit) != Host.OwnPid)
            {
                IntPtr root = Native.GetAncestor(hit, Native.GA_ROOT);
                return root == IntPtr.Zero ? hit : root;
            }
            foreach (IntPtr window in TopLevelWindows())
            {
                if (!Native.IsWindowVisible(window) || Native.IsCloaked(window) || Native.ProcessId(window) == Host.OwnPid) continue;
                if ((Native.ExStyle(window) & (Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED)) == (Native.WS_EX_TRANSPARENT | Native.WS_EX_LAYERED)) continue;
                Native.RECT rect = Native.FrameBounds(window);
                if (point.X >= rect.Left && point.X < rect.Right && point.Y >= rect.Top && point.Y < rect.Bottom) return window;
            }
            return IntPtr.Zero;
        }
    }
}
