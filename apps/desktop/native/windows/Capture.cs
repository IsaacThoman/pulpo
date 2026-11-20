// The `snapshot` request: a picture of one window, even when other windows cover it, and its outline.

using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Threading;
using System.Windows.Automation;

namespace Pulpo.Control
{
    internal static class Capture
    {
        const long JpegQuality = 80;
        static int counter;
        static ImageCodecInfo jpegCodec;

        public static Dictionary<string, object> Snapshot(int pid, long windowId, bool outline, int maxElements)
        {
            string imageDir;
            int maxEdge;
            lock (Host.Lock) { imageDir = Host.ImageDir; maxEdge = Host.MaxImageEdge; }
            if (imageDir == null) throw new ControlException("invalid_request", "configure has not been sent.");
            if (maxElements < 1) throw new ControlException("invalid_request", "maxElements must be at least 1.");
            IntPtr hwnd = Desktop.Resolve(pid, windowId);

            if (Native.IsIconic(hwnd))
            {
                // Shown again without activation where Windows allows it; a minimized window has nothing to draw.
                Native.ShowWindow(hwnd, Native.SW_SHOWNOACTIVATE);
                for (int i = 0; i < 20 && Native.IsIconic(hwnd); i++) Thread.Sleep(15);
                if (Native.IsIconic(hwnd)) Native.ShowWindow(hwnd, Native.SW_RESTORE);
                // The restore animation and the app's first paint.
                Thread.Sleep(300);
            }

            Native.RECT frame = Native.FrameBounds(hwnd);
            if (frame.Width <= 0 || frame.Height <= 0) throw new ControlException("unsupported", "The window has no size.");

            Bitmap picture = PrintedWindow(hwnd, frame);
            if (picture == null)
            {
                // Some windows draw nothing through PrintWindow (certain games, video, protected
                // content); the screen still shows them once they are in front.
                Desktop.Foreground(hwnd);
                Thread.Sleep(200);
                frame = Native.FrameBounds(hwnd);
                // Being in front is not being uncovered: a window that stays on top of others may
                // still lie over this one, and the screen there shows that app, not this one.
                IntPtr cover = Desktop.CoveringWindow(hwnd, pid, frame);
                if (cover != IntPtr.Zero)
                {
                    throw new ControlException("unsupported", "This window can only be pictured from the screen, and a window of " + Desktop.AppNameOf(cover) + " lies over it. Nothing was pictured; ask the user to move that window away.");
                }
                picture = FromScreen(frame);
            }

            try
            {
                List<IntPtr> popups = Desktop.Popups(hwnd, pid);
                foreach (IntPtr popup in Reverse(popups)) DrawPopup(picture, popup, frame, pid);

                double scale = Math.Min(1.0, (double)maxEdge / Math.Max(frame.Width, frame.Height));
                int width = Math.Max(1, (int)Math.Round(frame.Width * scale));
                int height = Math.Max(1, (int)Math.Round(frame.Height * scale));
                // Recomputed from the rounded size, so a point maps back to exactly the pixel it was read from.
                double actualScale = (double)width / frame.Width;
                string path = Path.Combine(imageDir, "window-" + hwnd.ToInt64() + "-" + DateTime.UtcNow.Ticks + "-" + Interlocked.Increment(ref counter) + ".jpg");
                using (Bitmap scaled = Scaled(picture, width, height)) SaveJpeg(scaled, path);

                WindowState state = new WindowState();
                state.Scale = actualScale;
                state.ImageWidth = width;
                state.ImageHeight = height;
                List<Dictionary<string, object>> elements = new List<Dictionary<string, object>>();
                bool truncated = false;
                if (outline)
                {
                    // Chromium (Chrome, Edge, Electron apps) builds the accessibility tree of its pages
                    // only once something asks for it, and then over a moment; without this pause the
                    // first snapshot of such a window would hold the browser's frame and no page.
                    if (Host.State(hwnd, false) == null && Native.ClassName(hwnd).StartsWith("Chrome_WidgetWin", StringComparison.Ordinal))
                    {
                        try { AutomationElement.FromHandle(hwnd).FindFirst(TreeScope.Descendants, new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Document)); }
                        catch (Exception) { }
                        Thread.Sleep(500);
                    }
                    List<IntPtr> roots = new List<IntPtr>();
                    roots.Add(hwnd);
                    roots.AddRange(popups);
                    elements = Outline.Walk(roots, frame, actualScale, width, height, maxElements, state, out truncated);
                }
                // A new snapshot replaces the elements of the earlier one, outline or not.
                Host.SetState(hwnd, state);

                Dictionary<string, object> image = new Dictionary<string, object>();
                image["path"] = path;
                image["width"] = width;
                image["height"] = height;
                image["mimeType"] = "image/jpeg";
                Dictionary<string, object> result = new Dictionary<string, object>();
                result["window"] = Desktop.WindowInfo(hwnd);
                result["image"] = image;
                result["elements"] = elements;
                result["truncated"] = truncated;
                return result;
            }
            finally { picture.Dispose(); }
        }

        static List<IntPtr> Reverse(List<IntPtr> list)
        {
            List<IntPtr> copy = new List<IntPtr>(list);
            copy.Reverse();
            return copy;
        }

        /// <summary>
        /// The window drawn by itself through PrintWindow, cropped to its visible frame. With
        /// PW_RENDERFULLCONTENT, DWM supplies the content of DirectX and XAML windows too. Null when the
        /// call fails or comes back blank.
        /// </summary>
        static Bitmap PrintedWindow(IntPtr hwnd, Native.RECT frame)
        {
            Native.RECT rect;
            if (!Native.GetWindowRect(hwnd, out rect) || rect.Width <= 0 || rect.Height <= 0) return null;
            Bitmap whole = Print(hwnd, rect);
            if (whole == null) return null;
            using (whole)
            {
                if (IsBlank(whole)) return null;
                return Crop(whole, frame.Left - rect.Left, frame.Top - rect.Top, frame.Width, frame.Height);
            }
        }

        static Bitmap Print(IntPtr hwnd, Native.RECT rect)
        {
            IntPtr screen = Native.GetDC(IntPtr.Zero);
            IntPtr dc = Native.CreateCompatibleDC(screen);
            IntPtr bitmap = Native.CreateCompatibleBitmap(screen, rect.Width, rect.Height);
            IntPtr old = Native.SelectObject(dc, bitmap);
            try
            {
                if (!Native.PrintWindow(hwnd, dc, Native.PW_RENDERFULLCONTENT)) return null;
                Native.SelectObject(dc, old);
                old = IntPtr.Zero;
                return Image.FromHbitmap(bitmap);
            }
            finally
            {
                if (old != IntPtr.Zero) Native.SelectObject(dc, old);
                Native.DeleteObject(bitmap);
                Native.DeleteDC(dc);
                Native.ReleaseDC(IntPtr.Zero, screen);
            }
        }

        /// <summary>The screen's pixels in the rectangle. The agent's pointer is excluded from capture, or hidden meanwhile.</summary>
        static Bitmap FromScreen(Native.RECT rect)
        {
            bool hidden = Pointer.HideForCapture();
            try
            {
                IntPtr screen = Native.GetDC(IntPtr.Zero);
                IntPtr dc = Native.CreateCompatibleDC(screen);
                IntPtr bitmap = Native.CreateCompatibleBitmap(screen, rect.Width, rect.Height);
                IntPtr old = Native.SelectObject(dc, bitmap);
                try
                {
                    Native.BitBlt(dc, 0, 0, rect.Width, rect.Height, screen, rect.Left, rect.Top, Native.SRCCOPY | Native.CAPTUREBLT);
                    Native.SelectObject(dc, old);
                    old = IntPtr.Zero;
                    return Image.FromHbitmap(bitmap);
                }
                finally
                {
                    if (old != IntPtr.Zero) Native.SelectObject(dc, old);
                    Native.DeleteObject(bitmap);
                    Native.DeleteDC(dc);
                    Native.ReleaseDC(IntPtr.Zero, screen);
                }
            }
            finally { if (hidden) Pointer.ShowAfterCapture(); }
        }

        /// <summary>
        /// A menu or dialog of the window drawn where it floats over it. While open it is in front of
        /// everything, so it is copied from the screen, which also gets the rounded corners and shadow
        /// of XAML popups right (PrintWindow paints their transparent parts black). When something
        /// covers it after all, PrintWindow draws it. The screen is never copied where another app's
        /// window lies over any part of it: a popup that then draws nothing by itself is left out.
        /// </summary>
        static void DrawPopup(Bitmap picture, IntPtr popup, Native.RECT frame, int pid)
        {
            Native.RECT bounds = Native.FrameBounds(popup);
            if (bounds.Width <= 0 || bounds.Height <= 0) return;
            Native.POINT middle = new Native.POINT(bounds.Left + bounds.Width / 2, bounds.Top + bounds.Height / 2);
            IntPtr hit = Native.WindowFromPoint(middle);
            bool uncovered = Desktop.CoveringWindow(popup, pid, bounds) == IntPtr.Zero;
            Bitmap image = null;
            if (!uncovered || hit == IntPtr.Zero || Native.GetAncestor(hit, Native.GA_ROOT) != popup) image = PrintedWindow(popup, bounds);
            if (image == null && uncovered) image = FromScreen(bounds);
            if (image == null) return;
            using (image)
            using (Graphics g = Graphics.FromImage(picture))
            {
                g.DrawImageUnscaled(image, bounds.Left - frame.Left, bounds.Top - frame.Top);
            }
        }

        /// <summary>Whether PrintWindow drew nothing: every sampled pixel is the same colour.</summary>
        static bool IsBlank(Bitmap bitmap)
        {
            int first = bitmap.GetPixel(0, 0).ToArgb();
            int stepX = Math.Max(1, bitmap.Width / 24);
            int stepY = Math.Max(1, bitmap.Height / 24);
            for (int y = 0; y < bitmap.Height; y += stepY)
            {
                for (int x = 0; x < bitmap.Width; x += stepX)
                {
                    if (bitmap.GetPixel(x, y).ToArgb() != first) return false;
                }
            }
            return true;
        }

        static Bitmap Crop(Bitmap source, int x, int y, int width, int height)
        {
            Bitmap cropped = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (Graphics g = Graphics.FromImage(cropped))
            {
                g.Clear(Color.Black);
                g.DrawImage(source, new Rectangle(0, 0, width, height), new Rectangle(x, y, width, height), GraphicsUnit.Pixel);
            }
            return cropped;
        }

        static Bitmap Scaled(Bitmap source, int width, int height)
        {
            Bitmap scaled = new Bitmap(width, height, PixelFormat.Format24bppRgb);
            using (Graphics g = Graphics.FromImage(scaled))
            {
                if (width == source.Width && height == source.Height)
                {
                    g.DrawImageUnscaled(source, 0, 0);
                    return scaled;
                }
                g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                g.CompositingQuality = CompositingQuality.HighQuality;
                g.SmoothingMode = SmoothingMode.HighQuality;
                // Without this the bicubic filter blends the image's edges with transparent black.
                using (ImageAttributes attributes = new ImageAttributes())
                {
                    attributes.SetWrapMode(WrapMode.TileFlipXY);
                    g.DrawImage(source, new Rectangle(0, 0, width, height), 0, 0, source.Width, source.Height, GraphicsUnit.Pixel, attributes);
                }
            }
            return scaled;
        }

        static void SaveJpeg(Bitmap bitmap, string path)
        {
            if (jpegCodec == null)
            {
                foreach (ImageCodecInfo codec in ImageCodecInfo.GetImageEncoders())
                {
                    if (codec.FormatID == ImageFormat.Jpeg.Guid) jpegCodec = codec;
                }
            }
            using (EncoderParameters parameters = new EncoderParameters(1))
            {
                parameters.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, JpegQuality);
                bitmap.Save(path, jpegCodec, parameters);
            }
        }
    }
}
