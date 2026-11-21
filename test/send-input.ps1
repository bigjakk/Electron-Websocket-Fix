# Injects relative mouse packets with SendInput, for the raw-input checks
# (c12-c15). A relative MOUSEINPUT becomes one RAWMOUSE packet (WM_INPUT, with
# hDevice NULL because it is injected) plus the legacy messages, so it takes
# the same HWNDMessageHandler::OnInputEvent path as a real mouse report. Not a
# substitute for a real 1000-8000 Hz device: nothing here measures cost.
#
#   send-input.ps1 -TargetPid <pid> -Plan "count,dx,dy,wheel,intervalUs[;...]"
#
# Before every packet the foreground window must belong to -TargetPid (the
# Electron browser process); otherwise it stops, so input never goes to another
# application. Prints one line per phase: "OK <sent>", "ABORT ..." or "ERROR ...".
param(
  [Parameter(Mandatory = $true)][int]$TargetPid,
  [Parameter(Mandatory = $true)][string]$Plan
)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class KccSendInput {
  [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }
  [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public MOUSEINPUT mi; }
  const uint INPUT_MOUSE = 0, MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_WHEEL = 0x0800;
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] inputs, int size);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  public static uint ForegroundPid() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); return pid; }
  public static string Run(uint targetPid, int count, int dx, int dy, int wheel, int intervalUs) {
    var inp = new INPUT[1];
    inp[0].type = INPUT_MOUSE;
    inp[0].mi.dx = dx;
    inp[0].mi.dy = dy;
    inp[0].mi.mouseData = unchecked((uint)wheel);
    inp[0].mi.dwFlags = ((dx != 0 || dy != 0) ? MOUSEEVENTF_MOVE : 0u) | (wheel != 0 ? MOUSEEVENTF_WHEEL : 0u);
    var sw = Stopwatch.StartNew();
    long next = 0;
    int sent = 0;
    for (int i = 0; i < count; i++) {
      uint fg = ForegroundPid();
      if (fg != targetPid) return "ABORT foreground window belongs to pid " + fg + " after " + sent + " packets";
      if (SendInput(1, inp, Marshal.SizeOf(typeof(INPUT))) != 1) return "ERROR SendInput " + Marshal.GetLastWin32Error() + " after " + sent + " packets";
      sent++;
      next += (long)intervalUs * Stopwatch.Frequency / 1000000;
      while (sw.ElapsedTicks < next) {
        if (next - sw.ElapsedTicks > Stopwatch.Frequency / 500) Thread.Sleep(1); else Thread.SpinWait(50);
      }
    }
    return "OK " + sent + " packets in " + sw.ElapsedMilliseconds + " ms";
  }
}
'@
foreach ($phase in ($Plan -split ';' | Where-Object { $_ })) {
  $p = @($phase -split ',' | ForEach-Object { [int]$_ })
  [KccSendInput]::Run([uint32]$TargetPid, $p[0], $p[1], $p[2], $p[3], $p[4])
}
