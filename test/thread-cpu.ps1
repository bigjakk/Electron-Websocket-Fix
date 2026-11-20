# Prints, as JSON, the cumulative CPU time (kernel + user, 100 ns units) of every
# thread of a process together with its thread description (the name Chromium
# gives its threads with SetThreadDescription, e.g. VizCompositorThread), plus
# the process total and a timestamp (UTC ticks, 100 ns) taken at query time.
# Used by frame-cap-test.js --kcc-suite=cpu.
param([Parameter(Mandatory = $true)][int]$ProcessId)

$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KccThreadInfo {
  [DllImport("kernel32.dll", SetLastError = true)]
  static extern IntPtr OpenThread(uint access, bool inherit, uint tid);
  [DllImport("kernel32.dll")]
  static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll")]
  static extern int GetThreadDescription(IntPtr h, out IntPtr desc);
  [DllImport("kernel32.dll")]
  static extern IntPtr LocalFree(IntPtr p);
  [DllImport("kernel32.dll")]
  static extern bool GetThreadTimes(IntPtr h, out long creation, out long exit, out long kernel, out long user);
  const uint THREAD_QUERY_LIMITED_INFORMATION = 0x0800;
  // Returns "name|cpu100ns", or null if the thread is gone.
  public static string Query(uint tid) {
    IntPtr h = OpenThread(THREAD_QUERY_LIMITED_INFORMATION, false, tid);
    if (h == IntPtr.Zero) return null;
    try {
      string name = "";
      IntPtr p;
      if (GetThreadDescription(h, out p) >= 0 && p != IntPtr.Zero) {
        name = Marshal.PtrToStringUni(p);
        LocalFree(p);
      }
      long c, e, k, u;
      if (!GetThreadTimes(h, out c, out e, out k, out u)) return null;
      return name + "|" + (k + u).ToString();
    } finally {
      CloseHandle(h);
    }
  }
}
'@

$p = Get-Process -Id $ProcessId
$ticks = [DateTime]::UtcNow.Ticks
$threads = @()
foreach ($t in $p.Threads) {
  $q = [KccThreadInfo]::Query([uint32]$t.Id)
  if ($null -eq $q) { continue }
  $i = $q.LastIndexOf('|')
  $threads += [pscustomobject]@{ tid = $t.Id; name = $q.Substring(0, $i); cpu100ns = [int64]$q.Substring($i + 1) }
}
$p.Refresh()
[pscustomobject]@{
  pid = $ProcessId
  ticks = $ticks
  processCpu100ns = [int64]$p.TotalProcessorTime.Ticks
  threads = $threads
} | ConvertTo-Json -Depth 4 -Compress
