// The agent's own pointer: an arrow drawn over the screen where the agent acts, so the user sees what
// it is doing. It is a separate window that takes no clicks, no focus and no part in screenshots;
// the system's own cursor is never hidden or replaced (a crash would leave the user without one).

using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Threading;

namespace Pulpo.Control
{
    internal static class Pointer
    {
        /// <summary>Relative to the system arrow, so it reads as a pointer but is told apart from the user's.</summary>
        const double ArrowScale = 1.3;
        const int GlideMs = 200;
        const int PulseMs = 450;
        /// <summary>How long it stays after the last action before fading out, and how long the fade takes.</summary>
        const int IdleMs = 4000;
        const int FadeMs = 300;
        /// <summary>The overlay's edge at 96 DPI. The arrow's tip, its hot spot, is the middle, so a click ring fits around it.</summary>
        const int Edge = 72;
        const uint FrameMs = 15;
        const uint WM_UPDATE = Native.WM_APP + 1;

        static readonly Color Fill = Color.FromArgb(0xF2, 0xD3, 0x1B);
        static readonly Color Outline = Color.FromArgb(0x1A, 0x1A, 0x1A);
        // The arrow's outline in system-arrow units (about 19 tall at 96 DPI), tip at the origin.
        static readonly PointF[] Arrow = new PointF[] {
            new PointF(0f, 0f), new PointF(0f, 15.5f), new PointF(3.6f, 12.1f), new PointF(6.1f, 17.9f),
            new PointF(8.7f, 16.8f), new PointF(6.2f, 11.2f), new PointF(11.0f, 11.2f),
        };

        static readonly object sync = new object();
        static Thread thread;
        static IntPtr hwnd;
        static Native.WndProc proc;
        static bool excludedFromCapture;

        // The animation's state, shared with the overlay's thread under `sync`.
        static bool visible;
        static bool shown;
        static bool timerOn;
        static double currentX, currentY, fromX, fromY, toX, toY;
        static DateTime glideStart;
        static bool gliding;
        static ManualResetEvent arrived;
        static DateTime pulseStart;
        static bool pulsing;
        static DateTime lastAction;
        static bool capturing;
        // What was drawn last, so an idle frame costs nothing.
        static double drawnX = double.NaN, drawnY, drawnScale, drawnPulse;
        static byte drawnAlpha;

        /// <summary>Glides from where it was (from the real cursor when it was hidden) to the point and returns once there.</summary>
        public static void GlideTo(int x, int y)
        {
            if (!EnsureWindow()) return;
            ManualResetEvent done;
            lock (sync)
            {
                if (!visible)
                {
                    Native.POINT cursor;
                    Native.GetCursorPos(out cursor);
                    currentX = cursor.X;
                    currentY = cursor.Y;
                }
                fromX = currentX;
                fromY = currentY;
                toX = x;
                toY = y;
                glideStart = DateTime.UtcNow;
                gliding = true;
                visible = true;
                lastAction = DateTime.UtcNow;
                if (arrived != null) arrived.Set();
                arrived = new ManualResetEvent(false);
                done = arrived;
            }
            Native.PostMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
            done.WaitOne(GlideMs + 500);
        }

        /// <summary>Moves at once, for the steps of a drag.</summary>
        public static void JumpTo(int x, int y)
        {
            if (!EnsureWindow()) return;
            lock (sync)
            {
                currentX = x;
                currentY = y;
                gliding = false;
                visible = true;
                lastAction = DateTime.UtcNow;
            }
            Native.PostMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>A brief ring around the tip, for a click.</summary>
        public static void Pulse()
        {
            if (hwnd == IntPtr.Zero) return;
            lock (sync)
            {
                pulsing = true;
                pulseStart = DateTime.UtcNow;
                lastAction = DateTime.UtcNow;
            }
            Native.PostMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>A keyboard action: the pointer stays where it is, but does not fade yet.</summary>
        public static void Touch()
        {
            lock (sync) { if (visible) lastAction = DateTime.UtcNow; }
        }

        /// <summary>Hides it at once: the reply is over.</summary>
        public static void Release()
        {
            if (hwnd == IntPtr.Zero) return;
            lock (sync)
            {
                visible = false;
                gliding = false;
                pulsing = false;
                if (arrived != null) arrived.Set();
            }
            Native.PostMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>Before a copy of the screen: hides it unless Windows already keeps it out of captures. True when it was hidden.</summary>
        public static bool HideForCapture()
        {
            if (hwnd == IntPtr.Zero || excludedFromCapture) return false;
            lock (sync)
            {
                if (!shown) return false;
                capturing = true;
            }
            // SendMessage waits until the overlay's thread has drawn the frame that hides it.
            Native.SendMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
            return true;
        }

        public static void ShowAfterCapture()
        {
            lock (sync) { capturing = false; drawnX = double.NaN; }
            Native.PostMessage(hwnd, WM_UPDATE, IntPtr.Zero, IntPtr.Zero);
        }

        public static void Shutdown()
        {
            if (hwnd != IntPtr.Zero) Native.PostMessage(hwnd, Native.WM_CLOSE, IntPtr.Zero, IntPtr.Zero);
        }

        /// <summary>Starts the overlay's thread on first use. False when the window cannot be made; actions go on without it.</summary>
        static bool EnsureWindow()
        {
            lock (sync)
            {
                if (thread == null)
                {
                    ManualResetEvent ready = new ManualResetEvent(false);
                    // A window belongs to the thread that made it and needs that thread to pump its
                    // messages, so the overlay has an STA thread of its own for as long as the helper runs.
                    thread = new Thread(delegate () { Run(ready); });
                    thread.IsBackground = true;
                    thread.SetApartmentState(ApartmentState.STA);
                    thread.Start();
                    ready.WaitOne(3000);
                }
                return hwnd != IntPtr.Zero;
            }
        }

        static void Run(ManualResetEvent ready)
        {
            try
            {
                Dpi.MakeThreadAware();
                proc = WindowProc;
                Native.WNDCLASSEX windowClass = new Native.WNDCLASSEX();
                windowClass.Size = Marshal.SizeOf(typeof(Native.WNDCLASSEX));
                windowClass.WndProc = proc;
                windowClass.Instance = Native.GetModuleHandle(null);
                windowClass.ClassName = "PulpoAgentPointer";
                Native.RegisterClassEx(ref windowClass);
                IntPtr window = Native.CreateWindowEx(
                    Native.WS_EX_LAYERED | Native.WS_EX_TRANSPARENT | Native.WS_EX_TOOLWINDOW | Native.WS_EX_NOACTIVATE | Native.WS_EX_TOPMOST,
                    windowClass.ClassName, "Pulpo agent pointer", Native.WS_POPUP, 0, 0, 1, 1, IntPtr.Zero, IntPtr.Zero, windowClass.Instance, IntPtr.Zero);
                if (window == IntPtr.Zero)
                {
                    Host.Log("the agent's pointer could not be created (error " + Marshal.GetLastWin32Error() + ")");
                    return;
                }
                // Windows 10 2004 and later keep it out of every screen capture, the helper's own included.
                excludedFromCapture = Native.SetWindowDisplayAffinity(window, Native.WDA_EXCLUDEFROMCAPTURE);
                hwnd = window;
            }
            finally { ready.Set(); }

            Native.MSG msg;
            while (Native.GetMessage(out msg, IntPtr.Zero, 0, 0) > 0)
            {
                Native.TranslateMessage(ref msg);
                Native.DispatchMessage(ref msg);
            }
        }

        static IntPtr WindowProc(IntPtr window, uint msg, IntPtr wParam, IntPtr lParam)
        {
            try
            {
                switch (msg)
                {
                    case WM_UPDATE:
                    case Native.WM_TIMER:
                        Tick();
                        return IntPtr.Zero;
                    case Native.WM_NCHITTEST:
                        return new IntPtr(Native.HTTRANSPARENT);
                    case Native.WM_MOUSEACTIVATE:
                        return new IntPtr(Native.MA_NOACTIVATE);
                    case Native.WM_DPICHANGED:
                        // The size follows the monitor's DPI in Tick; Windows must not resize it on its own.
                        return IntPtr.Zero;
                    case Native.WM_CLOSE:
                        Native.DestroyWindow(window);
                        return IntPtr.Zero;
                    case Native.WM_DESTROY:
                        Native.PostQuitMessage(0);
                        return IntPtr.Zero;
                }
            }
            catch (Exception e)
            {
                // An exception must never cross back into Windows' message dispatch.
                Host.Log("pointer: " + e.Message);
            }
            return Native.DefWindowProc(window, msg, wParam, lParam);
        }

        /// <summary>One frame of the animation, on the overlay's thread.</summary>
        static void Tick()
        {
            double x, y, pulse = -1;
            byte alpha = 255;
            bool show;
            ManualResetEvent reached = null;
            lock (sync)
            {
                DateTime now = DateTime.UtcNow;
                if (visible && (now - lastAction).TotalMilliseconds > IdleMs + FadeMs) visible = false;
                show = visible && !capturing;
                if (gliding)
                {
                    double t = Math.Min(1.0, (now - glideStart).TotalMilliseconds / GlideMs);
                    // Ease-out cubic: quick to leave, gentle to arrive.
                    double e = 1 - Math.Pow(1 - t, 3);
                    currentX = fromX + (toX - fromX) * e;
                    currentY = fromY + (toY - fromY) * e;
                    if (t >= 1) { gliding = false; reached = arrived; }
                }
                if (pulsing)
                {
                    pulse = (now - pulseStart).TotalMilliseconds / PulseMs;
                    if (pulse >= 1) { pulsing = false; pulse = -1; }
                }
                double idle = (now - lastAction).TotalMilliseconds;
                if (idle > IdleMs) alpha = (byte)Math.Max(0, Math.Min(255, 255 * (1 - (idle - IdleMs) / FadeMs)));
                x = currentX;
                y = currentY;
            }

            if (!show)
            {
                if (shown) { Native.ShowWindow(hwnd, Native.SW_HIDE); shown = false; }
                if (timerOn) { Native.KillTimer(hwnd, new IntPtr(1)); timerOn = false; }
                drawnX = double.NaN;
                if (reached != null) reached.Set();
                return;
            }
            if (!timerOn) { Native.SetTimer(hwnd, new IntPtr(1), FrameMs, IntPtr.Zero); timerOn = true; }

            double scale = Dpi.ScaleAt((int)Math.Round(x), (int)Math.Round(y));
            if (x != drawnX || y != drawnY || scale != drawnScale || pulse != drawnPulse || alpha != drawnAlpha)
            {
                Draw(x, y, scale, pulse, alpha);
                drawnX = x; drawnY = y; drawnScale = scale; drawnPulse = pulse; drawnAlpha = alpha;
            }
            if (!shown)
            {
                // Above other topmost windows that appeared since, without taking the focus.
                Native.SetWindowPos(hwnd, Native.HWND_TOPMOST, 0, 0, 0, 0, Native.SWP_NOMOVE | Native.SWP_NOSIZE | Native.SWP_NOACTIVATE | Native.SWP_SHOWWINDOW);
                shown = true;
            }
            if (reached != null) reached.Set();
        }

        static void Draw(double x, double y, double scale, double pulse, byte alpha)
        {
            int size = (int)Math.Ceiling(Edge * scale);
            using (Bitmap bitmap = Render(size, scale, pulse))
            {
                IntPtr screen = Native.GetDC(IntPtr.Zero);
                IntPtr memory = Native.CreateCompatibleDC(screen);
                // GDI+ hands out the bitmap premultiplied, which is what per-pixel alpha wants.
                IntPtr handle = bitmap.GetHbitmap(Color.FromArgb(0));
                IntPtr old = Native.SelectObject(memory, handle);
                try
                {
                    Native.POINT destination = new Native.POINT((int)Math.Round(x) - size / 2, (int)Math.Round(y) - size / 2);
                    Native.SIZE extent = new Native.SIZE(size, size);
                    Native.POINT source = new Native.POINT(0, 0);
                    Native.BLENDFUNCTION blend = new Native.BLENDFUNCTION();
                    blend.BlendOp = Native.AC_SRC_OVER;
                    blend.SourceConstantAlpha = alpha;
                    blend.AlphaFormat = Native.AC_SRC_ALPHA;
                    Native.UpdateLayeredWindow(hwnd, screen, ref destination, ref extent, memory, ref source, 0, ref blend, Native.ULW_ALPHA);
                }
                finally
                {
                    Native.SelectObject(memory, old);
                    Native.DeleteObject(handle);
                    Native.DeleteDC(memory);
                    Native.ReleaseDC(IntPtr.Zero, screen);
                }
            }
        }

        /// <summary>The arrow (and the click ring when `pulse` is from 0 to 1), its tip in the middle of the square.</summary>
        static Bitmap Render(int size, double scale, double pulse)
        {
            Bitmap bitmap = new Bitmap(size, size, PixelFormat.Format32bppArgb);
            using (Graphics g = Graphics.FromImage(bitmap))
            {
                g.SmoothingMode = SmoothingMode.AntiAlias;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.Clear(Color.Transparent);
                float center = size / 2f;
                float unit = (float)(ArrowScale * scale);

                if (pulse >= 0)
                {
                    float radius = (float)((7 + 17 * pulse) * scale);
                    int ringAlpha = (int)(220 * (1 - pulse));
                    using (Pen dark = new Pen(Color.FromArgb(ringAlpha / 2, Outline), (float)(4.5 * scale)))
                    using (Pen ring = new Pen(Color.FromArgb(ringAlpha, Fill), (float)(2.5 * scale)))
                    {
                        g.DrawEllipse(dark, center - radius, center - radius, radius * 2, radius * 2);
                        g.DrawEllipse(ring, center - radius, center - radius, radius * 2, radius * 2);
                    }
                }

                using (GraphicsPath arrow = new GraphicsPath())
                {
                    PointF[] points = new PointF[Arrow.Length];
                    for (int i = 0; i < Arrow.Length; i++) points[i] = new PointF(center + Arrow[i].X * unit, center + Arrow[i].Y * unit);
                    arrow.AddPolygon(points);

                    // A soft shadow: the shape offset down and right, drawn several times wider and fainter.
                    using (Matrix offset = new Matrix())
                    using (GraphicsPath shadow = (GraphicsPath)arrow.Clone())
                    {
                        offset.Translate((float)(1.2 * scale), (float)(2.0 * scale));
                        shadow.Transform(offset);
                        for (int i = 3; i >= 0; i--)
                        {
                            using (Pen blur = new Pen(Color.FromArgb(18 + (3 - i) * 8, 0, 0, 0), (float)((1 + i * 1.6) * scale)))
                            {
                                blur.LineJoin = LineJoin.Round;
                                g.DrawPath(blur, shadow);
                            }
                        }
                        using (SolidBrush shade = new SolidBrush(Color.FromArgb(60, 0, 0, 0))) g.FillPath(shade, shadow);
                    }

                    using (SolidBrush fill = new SolidBrush(Fill)) g.FillPath(fill, arrow);
                    using (Pen outline = new Pen(Outline, (float)(1.4 * scale)))
                    {
                        outline.LineJoin = LineJoin.Round;
                        g.DrawPath(outline, arrow);
                    }
                }
            }
            return bitmap;
        }
    }
}
