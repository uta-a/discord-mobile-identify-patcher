param(
  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

$source = @"
using System;
using System.Runtime.InteropServices;

public static class RestartManagerLockCheck {
  [StructLayout(LayoutKind.Sequential)]
  public struct RM_UNIQUE_PROCESS {
    public int dwProcessId;
    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
  }

  public enum RM_APP_TYPE {
    RmUnknownApp = 0,
    RmMainWindow = 1,
    RmOtherWindow = 2,
    RmService = 3,
    RmExplorer = 4,
    RmConsole = 5,
    RmCritical = 1000
  }

  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct RM_PROCESS_INFO {
    public RM_UNIQUE_PROCESS Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)]
    public string strAppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)]
    public string strServiceShortName;
    public RM_APP_TYPE ApplicationType;
    public uint AppStatus;
    public uint TSSessionId;
    [MarshalAs(UnmanagedType.Bool)]
    public bool bRestartable;
  }

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
  public static extern int RmRegisterResources(
    uint pSessionHandle,
    uint nFiles,
    string[] rgsFilenames,
    uint nApplications,
    RM_UNIQUE_PROCESS[] rgApplications,
    uint nServices,
    string[] rgsServiceNames
  );

  [DllImport("rstrtmgr.dll")]
  public static extern int RmGetList(
    uint dwSessionHandle,
    out uint pnProcInfoNeeded,
    ref uint pnProcInfo,
    [In, Out] RM_PROCESS_INFO[] rgAffectedApps,
    ref uint lpdwRebootReasons
  );

  [DllImport("rstrtmgr.dll")]
  public static extern int RmEndSession(uint pSessionHandle);
}
"@

Add-Type -TypeDefinition $source

$resolvedPath = (Resolve-Path -LiteralPath $Path).Path
$handle = [uint32]0
$sessionKey = [guid]::NewGuid().ToString()
$result = [RestartManagerLockCheck]::RmStartSession([ref]$handle, 0, $sessionKey)
if ($result -ne 0) {
  throw "RmStartSession failed with code $result"
}

try {
  $files = [string[]]@($resolvedPath)
  $result = [RestartManagerLockCheck]::RmRegisterResources($handle, 1, $files, 0, $null, 0, $null)
  if ($result -ne 0) {
    throw "RmRegisterResources failed with code $result"
  }

  $needed = [uint32]0
  $count = [uint32]0
  $reasons = [uint32]0
  $result = [RestartManagerLockCheck]::RmGetList($handle, [ref]$needed, [ref]$count, $null, [ref]$reasons)

  if ($needed -eq 0) {
    Write-Output "No locking process reported by Restart Manager for $resolvedPath"
    exit 0
  }

  $count = $needed
  $processInfos = New-Object RestartManagerLockCheck+RM_PROCESS_INFO[] $count
  $result = [RestartManagerLockCheck]::RmGetList($handle, [ref]$needed, [ref]$count, $processInfos, [ref]$reasons)
  if ($result -ne 0) {
    throw "RmGetList failed with code $result"
  }

  $processInfos |
    Select-Object -First $count |
    ForEach-Object {
      $processId = $_.Process.dwProcessId
      $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
      [PSCustomObject]@{
        Id = $processId
        AppName = $_.strAppName
        ProcessName = $process.ProcessName
        Path = $process.Path
        Restartable = $_.bRestartable
        Type = $_.ApplicationType
      }
    }
} finally {
  [RestartManagerLockCheck]::RmEndSession($handle) | Out-Null
}
