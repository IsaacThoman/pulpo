// The Windows helper that lets the agent see and control other apps' windows. The desktop app's
// main process starts it once through host.ps1 and speaks the JSON-lines protocol described in
// apps/desktop/src/computer/control/protocol.ts: one request per line on standard input, one
// answer per line on standard output, in order.
//
// This file holds the transport, the dispatch and the state the requests share. The other files
// beside it hold the window list (Desktop.cs), the picture (Capture.cs), the element outline
// (Outline.cs), the actions (Actions.cs) and the agent's pointer (Pointer.cs).
//
// It is compiled by Windows PowerShell 5.1's Add-Type, so it is C# 5 against .NET Framework 4.x.
// Keep these files ASCII: that compiler reads a file without a byte order mark in the system's ANSI
// code page, so other characters are written as \u escapes.

using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

namespace Pulpo.Control
{
    /// <summary>An answer with `ok: false`. Code is one of protocol.ts's ControlErrorCode words.</summary>
    public class ControlException : Exception
    {
        public readonly string Code;
        public ControlException(string code, string message) : base(message) { Code = code; }
    }

    /// <summary>What the helper remembers about a window between a snapshot and the actions that follow it.</summary>
    internal class WindowState
    {
        /// <summary>Image pixels per screen pixel in the latest snapshot.</summary>
        public double Scale = 1;
        public int ImageWidth;
        public int ImageHeight;
        /// <summary>The emitted elements of the latest snapshot; index 1 is Elements[0].</summary>
        public List<AutomationElement> Elements = new List<AutomationElement>();
        public List<string> Labels = new List<string>();
        public List<string> Roles = new List<string>();
    }

    public static class Host
    {
        public const int ProtocolVersion = 1;

        /// <summary>A request that has not answered by then answers `failed`, so the app is never left waiting.</summary>
        const int RequestTimeoutMs = 10000;

        internal static readonly object Lock = new object();
        internal static HashSet<int> ExcludedPids = new HashSet<int>();
        internal static string ImageDir;
        internal static int MaxImageEdge = 1568;
        internal static readonly Dictionary<long, WindowState> Windows = new Dictionary<long, WindowState>();
        internal static readonly int OwnPid = System.Diagnostics.Process.GetCurrentProcess().Id;

        /// <summary>
        /// Set when standard input has closed: the app is done with the helper (the reply was stopped,
        /// the access taken back, or the app quit). A long action checks it and stops where it is.
        /// </summary>
        internal static volatile bool Closing;

        /// <summary>How long an action still running when input closed gets to end by itself.</summary>
        const int ClosingGraceMs = 1000;

        /// <summary>
        /// Set when an action was answered `failed` because it did not finish in time. Its thread is
        /// still stuck in the app and would carry on (press the button, send the keys) whenever the
        /// app answers, long after the agent was told it failed. The helper leaves instead, taking
        /// the thread with it; the app starts another for the next request.
        /// </summary>
        static bool leaveAfterAnswer;

        static Stream errorStream;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false);

        /// <summary>Reads requests until standard input closes. Returns the process's exit code.</summary>
        public static int Run()
        {
            errorStream = Console.OpenStandardError();
            // Every rectangle the helper reads or writes is in physical pixels; this must happen before
            // anything asks Windows for coordinates or creates a window.
            Dpi.MakeProcessAware();

            // Raw streams with an explicit UTF-8 encoding: PowerShell's console encodings are the OEM code
            // page by default and would mangle anything outside ASCII.
            StreamReader input = new StreamReader(Console.OpenStandardInput(), Utf8, false, 65536);
            Stream output = Console.OpenStandardOutput();
            JavaScriptSerializer json = NewSerializer();

            // Requests are read on a thread of their own, so the end of input is noticed while an
            // action is still running: text being typed stops there, instead of running on for up to
            // half a minute after the user stopped the reply.
            BlockingCollection<string> lines = new BlockingCollection<string>();
            Thread reader = new Thread(delegate ()
            {
                try
                {
                    string read;
                    while ((read = input.ReadLine()) != null) lines.Add(read);
                }
                catch (Exception) { }
                Closing = true;
                lines.CompleteAdding();
            });
            reader.IsBackground = true;
            reader.Start();

            foreach (string line in lines.GetConsumingEnumerable())
            {
                // What was still waiting when input closed is not wanted any more.
                if (Closing) break;
                if (line.Trim().Length == 0) continue;
                Dictionary<string, object> answer = Answer(json, line);
                try
                {
                    byte[] bytes = Utf8.GetBytes(json.Serialize(answer) + "\n");
                    output.Write(bytes, 0, bytes.Length);
                    output.Flush();
                }
                catch (IOException) { break; }
                if (leaveAfterAnswer) break;
            }
            Pointer.Shutdown();
            return 0;
        }

        internal static JavaScriptSerializer NewSerializer()
        {
            JavaScriptSerializer json = new JavaScriptSerializer();
            json.MaxJsonLength = int.MaxValue;
            json.RecursionLimit = 64;
            return json;
        }

        /// <summary>A line for standard error, which the app keeps as diagnostics.</summary>
        internal static void Log(string message)
        {
            try
            {
                byte[] bytes = Utf8.GetBytes("pulpo-control: " + message + "\n");
                lock (Utf8) { errorStream.Write(bytes, 0, bytes.Length); errorStream.Flush(); }
            }
            catch (Exception) { }
        }

        static Dictionary<string, object> Answer(JavaScriptSerializer json, string line)
        {
            object id = 0;
            Dictionary<string, object> request;
            try
            {
                request = json.DeserializeObject(line) as Dictionary<string, object>;
            }
            catch (Exception)
            {
                return Failure(id, "invalid_request", "The request is not JSON.");
            }
            if (request == null) return Failure(id, "invalid_request", "The request is not a JSON object.");
            if (request.ContainsKey("id") && request["id"] != null) id = request["id"];
            string method = request.ContainsKey("method") ? request["method"] as string : null;
            if (method == null) return Failure(id, "invalid_request", "The request has no method.");
            Dictionary<string, object> parameters = request.ContainsKey("params") ? request["params"] as Dictionary<string, object> : null;
            if (parameters == null) parameters = new Dictionary<string, object>();

            // Each request runs on a thread of its own so a hung app (UI Automation calls have no timeout
            // of their own) costs one request, not the helper: the thread is left behind and the request
            // answers `failed`. Its late result is dropped.
            object result = null;
            Exception error = null;
            Thread worker = new Thread(delegate ()
            {
                Dpi.MakeThreadAware();
                try { result = Dispatch(method, parameters); }
                catch (Exception e) { error = e; }
            });
            worker.IsBackground = true;
            worker.SetApartmentState(ApartmentState.MTA);
            worker.Start();
            int timeout = TimeoutFor(method, parameters);
            System.Diagnostics.Stopwatch waited = System.Diagnostics.Stopwatch.StartNew();
            long closingSince = -1;
            while (!worker.Join(50))
            {
                if (Closing && closingSince < 0) closingSince = waited.ElapsedMilliseconds;
                if (closingSince >= 0 && waited.ElapsedMilliseconds - closingSince > ClosingGraceMs) return Failure(id, "failed", "The helper is closing.");
                if (waited.ElapsedMilliseconds > timeout)
                {
                    Log(method + " did not finish within " + (timeout / 1000) + " s");
                    if (method == "act") leaveAfterAnswer = true;
                    return Failure(id, "failed", "The window did not respond in time.");
                }
            }
            if (error != null) return FailureFor(id, method, error);

            Dictionary<string, object> answer = new Dictionary<string, object>();
            answer["id"] = id;
            answer["ok"] = true;
            answer["result"] = result ?? new Dictionary<string, object>();
            return answer;
        }

        /// <summary>Typing goes one character at a time, so a long text gets longer than the usual limit.</summary>
        static int TimeoutFor(string method, Dictionary<string, object> parameters)
        {
            if (method != "act" || !parameters.ContainsKey("action")) return RequestTimeoutMs;
            Dictionary<string, object> action = parameters["action"] as Dictionary<string, object>;
            string text = action != null && action.ContainsKey("text") ? action["text"] as string : null;
            if (text == null) return RequestTimeoutMs;
            return (int)Math.Min(int.MaxValue, RequestTimeoutMs + 30L * text.Length);
        }

        static Dictionary<string, object> FailureFor(object id, string method, Exception error)
        {
            ControlException control = error as ControlException;
            if (control != null) return Failure(id, control.Code, control.Message);
            if (error is ElementNotAvailableException) return Failure(id, "stale_element", "The element is gone; take a new snapshot.");
            if (error is ElementNotEnabledException) return Failure(id, "unsupported", "The element is disabled.");
            Log(method + " failed: " + error);
            return Failure(id, "failed", error.Message);
        }

        static Dictionary<string, object> Failure(object id, string code, string message)
        {
            Dictionary<string, object> answer = new Dictionary<string, object>();
            answer["id"] = id;
            answer["ok"] = false;
            answer["code"] = code;
            answer["message"] = message;
            return answer;
        }

        static object Dispatch(string method, Dictionary<string, object> p)
        {
            switch (method)
            {
                case "configure": return Configure(p);
                case "permissions":
                    {
                        // Windows has no per-app consent for reading or driving other windows.
                        Dictionary<string, object> result = new Dictionary<string, object>();
                        result["accessibility"] = true;
                        result["screenRecording"] = true;
                        return result;
                    }
                case "apps":
                    {
                        Dictionary<string, object> result = new Dictionary<string, object>();
                        result["apps"] = Desktop.Apps();
                        return result;
                    }
                case "snapshot":
                    return Capture.Snapshot(Params.Int(p, "pid"), Params.Long(p, "windowId"), Params.OptionalBool(p, "outline", true), Params.OptionalInt(p, "maxElements", 300));
                case "act":
                    return Actions.Act(Params.Int(p, "pid"), Params.Long(p, "windowId"), Params.Object(p, "action"));
                case "release":
                    Pointer.Release();
                    return new Dictionary<string, object>();
                default:
                    throw new ControlException("invalid_request", "Unknown method " + method + ".");
            }
        }

        static object Configure(Dictionary<string, object> p)
        {
            HashSet<int> excluded = new HashSet<int>();
            object pids;
            if (p.TryGetValue("excludePids", out pids) && pids is IEnumerable && !(pids is string))
            {
                foreach (object pid in (IEnumerable)pids) excluded.Add(Convert.ToInt32(pid, CultureInfo.InvariantCulture));
            }
            string imageDir = Params.String(p, "imageDir");
            if (!Directory.Exists(imageDir)) throw new ControlException("invalid_request", "imageDir does not exist.");
            int maxEdge = Params.Int(p, "maxImageEdge");
            if (maxEdge < 16) throw new ControlException("invalid_request", "maxImageEdge is too small.");
            lock (Lock)
            {
                ExcludedPids = excluded;
                ImageDir = imageDir;
                MaxImageEdge = maxEdge;
            }
            Dictionary<string, object> result = new Dictionary<string, object>();
            result["protocol"] = ProtocolVersion;
            result["platform"] = "windows";
            result["background"] = false;
            return result;
        }

        internal static bool IsExcluded(int pid)
        {
            if (pid == OwnPid || pid == 0) return true;
            lock (Lock) { return ExcludedPids.Contains(pid); }
        }

        internal static WindowState State(IntPtr hwnd, bool create)
        {
            lock (Lock)
            {
                WindowState state;
                if (Windows.TryGetValue(hwnd.ToInt64(), out state)) return state;
                if (!create) return null;
                state = new WindowState();
                Windows[hwnd.ToInt64()] = state;
                return state;
            }
        }

        internal static void SetState(IntPtr hwnd, WindowState state)
        {
            lock (Lock) { Windows[hwnd.ToInt64()] = state; }
        }
    }

    /// <summary>Reads request parameters, answering `invalid_request` for what is missing or of the wrong kind.</summary>
    internal static class Params
    {
        public static bool Has(Dictionary<string, object> p, string name)
        {
            return p.ContainsKey(name) && p[name] != null;
        }

        public static double Number(Dictionary<string, object> p, string name)
        {
            if (!Has(p, name)) throw new ControlException("invalid_request", name + " is missing.");
            object value = p[name];
            if (value is string || value is bool || value is IDictionary || value is ICollection) throw new ControlException("invalid_request", name + " is not a number.");
            try
            {
                double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(number) || double.IsInfinity(number)) throw new FormatException();
                return number;
            }
            catch (Exception) { throw new ControlException("invalid_request", name + " is not a number."); }
        }

        public static int Int(Dictionary<string, object> p, string name)
        {
            double number = Number(p, name);
            if (number < int.MinValue || number > int.MaxValue || Math.Floor(number) != number) throw new ControlException("invalid_request", name + " is not a whole number.");
            return (int)number;
        }

        public static long Long(Dictionary<string, object> p, string name)
        {
            double number = Number(p, name);
            if (Math.Floor(number) != number) throw new ControlException("invalid_request", name + " is not a whole number.");
            return (long)number;
        }

        public static int OptionalInt(Dictionary<string, object> p, string name, int fallback)
        {
            return Has(p, name) ? Int(p, name) : fallback;
        }

        public static bool OptionalBool(Dictionary<string, object> p, string name, bool fallback)
        {
            if (!Has(p, name)) return fallback;
            if (!(p[name] is bool)) throw new ControlException("invalid_request", name + " is not true or false.");
            return (bool)p[name];
        }

        public static string String(Dictionary<string, object> p, string name)
        {
            string value = Has(p, name) ? p[name] as string : null;
            if (value == null) throw new ControlException("invalid_request", name + " is missing or not text.");
            return value;
        }

        public static Dictionary<string, object> Object(Dictionary<string, object> p, string name)
        {
            Dictionary<string, object> value = Has(p, name) ? p[name] as Dictionary<string, object> : null;
            if (value == null) throw new ControlException("invalid_request", name + " is missing or not an object.");
            return value;
        }
    }

    /// <summary>Makes coordinates physical pixels on every monitor.</summary>
    internal static class Dpi
    {
        public static void MakeProcessAware()
        {
            // Per-monitor v2 (Windows 10 1703 and later), then per-monitor v1 (Windows 8.1), then
            // system aware. A call that fails because the process already has an awareness is harmless,
            // and every thread the helper starts also asks for v2 on its own (MakeThreadAware).
            try { if (Native.SetProcessDpiAwarenessContext(Native.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)) return; }
            catch (EntryPointNotFoundException) { }
            try { if (Native.SetProcessDpiAwareness(2) == 0) return; }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            Native.SetProcessDPIAware();
        }

        public static void MakeThreadAware()
        {
            try { Native.SetThreadDpiAwarenessContext(Native.DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2); }
            catch (EntryPointNotFoundException) { }
        }

        /// <summary>The monitor's scale at a point: 1 at 96 DPI.</summary>
        public static double ScaleAt(int x, int y)
        {
            try
            {
                IntPtr monitor = Native.MonitorFromPoint(new Native.POINT(x, y), Native.MONITOR_DEFAULTTONEAREST);
                uint dpiX, dpiY;
                if (Native.GetDpiForMonitor(monitor, Native.MDT_EFFECTIVE_DPI, out dpiX, out dpiY) == 0 && dpiX > 0) return dpiX / 96.0;
            }
            catch (DllNotFoundException) { }
            catch (EntryPointNotFoundException) { }
            return 1;
        }
    }
}
