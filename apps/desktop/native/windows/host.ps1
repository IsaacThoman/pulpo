# Starts the helper that lets the agent see and control other apps' windows (see PulpoControl.cs).
# The app runs it with the built-in Windows PowerShell:
#   powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File host.ps1
# It only compiles the C# beside it and hands over; standard output belongs to the protocol, so
# nothing here may write to it.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
try {
  $sources = [System.IO.Directory]::GetFiles($PSScriptRoot, '*.cs')
  Add-Type -Path $sources -IgnoreWarnings -ReferencedAssemblies @(
    'System.Drawing', 'System.Web.Extensions', 'UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'
  )
} catch {
  [Console]::Error.WriteLine("pulpo-control: the helper did not compile: $_")
  exit 2
}
exit [Pulpo.Control.Host]::Run()
