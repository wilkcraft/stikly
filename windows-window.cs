using System;
using System.Runtime.InteropServices;

public static class WindowApi
{
    private const int GWL_EXSTYLE = -20;
    private const long WS_EX_TOOLWINDOW = 0x00000080;
    private const long WS_EX_APPWINDOW = 0x00040000;

    private const uint SWP_NOSIZE = 0x0001;
    private const uint SWP_NOMOVE = 0x0002;
    private const uint SWP_NOACTIVATE = 0x0010;
    private const uint SWP_SHOWWINDOW = 0x0040;
    private const uint SWP_FRAMECHANGED = 0x0020;

    private static readonly IntPtr HWND_BOTTOM = new IntPtr(1);
    private static readonly IntPtr HWND_NOTOPMOST = new IntPtr(-2);
    private static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

    private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindowLongPtr(IntPtr hWnd, int nIndex);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int nIndex, IntPtr dwNewLong);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

    [DllImport("user32.dll")]
    private static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll")]
    private static extern IntPtr FindWindowEx(IntPtr hWndParent, IntPtr hWndChildAfter, string lpszClass, string lpszWindow);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetParent(IntPtr hWndChild, IntPtr hWndNewParent);

    private static void SetExtendedStyle(IntPtr hwnd, long style)
    {
        IntPtr current = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
        long currentValue = current.ToInt64();
        long newValue = (currentValue & ~WS_EX_TOOLWINDOW & ~WS_EX_APPWINDOW) | style;
        SetWindowLongPtr(hwnd, GWL_EXSTYLE, new IntPtr(newValue));
    }

    private static void RefreshWindow(IntPtr hwnd)
    {
        SetWindowPos(hwnd, IntPtr.Zero, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED);
    }

    private static IntPtr FindDesktopWorkerW()
    {
        IntPtr workerW = IntPtr.Zero;
        EnumWindows((hwnd, lParam) =>
        {
            IntPtr shellView = FindWindowEx(hwnd, IntPtr.Zero, "SHELLDLL_DefView", null);
            if (shellView != IntPtr.Zero)
            {
                workerW = hwnd;
                return false;
            }
            return true;
        }, IntPtr.Zero);
        return workerW;
    }

    public static void SetDesktop(IntPtr hwnd)
    {
        try
        {
            if (hwnd == IntPtr.Zero) throw new ArgumentException("hwnd es cero");
            SetExtendedStyle(hwnd, WS_EX_TOOLWINDOW);
            IntPtr workerW = FindDesktopWorkerW();
            Console.WriteLine("[SetDesktop] workerW=" + workerW);
            if (workerW != IntPtr.Zero)
            {
                IntPtr prevParent = SetParent(hwnd, workerW);
                int err = Marshal.GetLastWin32Error();
                Console.WriteLine("[SetDesktop] SetParent prevParent=" + prevParent + " lastWin32Error=" + err);
            }
            else
            {
                Console.Error.WriteLine("No se encontro WorkerW");
            }
            SetWindowPos(hwnd, HWND_BOTTOM, 0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
            RefreshWindow(hwnd);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine("SetDesktop exception: " + ex.ToString());
            throw;
        }
    }

    public static void SetNormal(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        SetParent(hwnd, IntPtr.Zero);
        SetExtendedStyle(hwnd, WS_EX_APPWINDOW);
        SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        RefreshWindow(hwnd);
    }

    public static void SetTop(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return;
        SetParent(hwnd, IntPtr.Zero);
        SetExtendedStyle(hwnd, WS_EX_APPWINDOW);
        SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
        RefreshWindow(hwnd);
    }
}