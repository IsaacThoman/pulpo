$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# Both release architectures are built on x64 runners. Match the signing tools
# and .NET runtime to the host, not the architecture of the application.
if (![Environment]::Is64BitProcess -or $env:RUNNER_ARCH -ne 'X64') {
  throw 'Windows signing tools require an x64 runner and PowerShell process.'
}
$runtimes = & dotnet --list-runtimes
if ($LASTEXITCODE -ne 0 -or !($runtimes -match '^Microsoft.NETCore.App 8\.0\.')) {
  throw 'Set up the x64 .NET 8 runtime before preparing Windows signing tools.'
}

# Avoid the client MSI, which can hang indefinitely at InstallFinalize on
# hosted runners: https://github.com/actions/runner-images/issues/13538
# Use the NuGet packages documented by Microsoft for manual SignTool setup.
# Keep each version and SHA-256 together when upgrading these packages.
$packages = @(
  @{
    Id = 'microsoft.artifactsigning.client'
    Version = '1.0.128'
    Sha256 = '74bd7d27e6ce1051409c38d9b46bc8df0400ecd643d51ffbf2ac00869061e40b'
    Bin = 'bin/x64'
  },
  @{
    Id = 'microsoft.windows.sdk.buildtools'
    Version = '10.0.26100.4188'
    Sha256 = '180deb372659029864c10a0c04787833234d64aacd1d2c0661d2c00295d8e022'
    Bin = 'bin/10.0.26100.0/x64'
  }
)

# Electron's signing command needs paths without spaces. Copy complete binary
# directories so the Dlib runtime config, VC++ runtime, and SDK DLLs stay beside
# their respective binaries.
$toolDirectory = Join-Path $env:SystemDrive 'pulpo-artifact-signing'
New-Item -ItemType Directory -Force -Path $toolDirectory | Out-Null
foreach ($package in $packages) {
  $id = $package.Id
  $version = $package.Version
  $archive = Join-Path $env:RUNNER_TEMP "$id.$version.zip"
  $extracted = Join-Path $env:RUNNER_TEMP "$id.$version"
  Write-Host "Downloading $id $version..."
  Invoke-WebRequest -Uri "https://api.nuget.org/v3-flatcontainer/$id/$version/$id.$version.nupkg" -OutFile $archive -ConnectionTimeoutSeconds 120 -OperationTimeoutSeconds 120
  if ((Get-FileHash $archive -Algorithm SHA256).Hash -ne $package.Sha256) {
    throw "SHA-256 verification failed for $id $version."
  }
  Expand-Archive -Path $archive -DestinationPath $extracted -Force
  Copy-Item -Path (Join-Path $extracted "$($package.Bin)/*") -Destination $toolDirectory -Recurse -Force
  Remove-Item $archive, $extracted -Recurse -Force
}

$signToolPath = Join-Path $toolDirectory 'signtool.exe'
$dlibPath = Join-Path $toolDirectory 'Azure.CodeSigning.Dlib.dll'
foreach ($file in @($signToolPath, $dlibPath)) {
  $signature = Get-AuthenticodeSignature $file
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notlike '*Microsoft Corporation*') {
    throw "Expected a valid Microsoft signature on $file."
  }
}

# Exercise the native tools without signing credentials in pull-request CI.
& $signToolPath /? | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'SignTool could not start.' }
$searchPath = [System.Runtime.InteropServices.DllImportSearchPath]::UseDllDirectoryForDependencies -bor [System.Runtime.InteropServices.DllImportSearchPath]::SafeDirectories
$library = [System.Runtime.InteropServices.NativeLibrary]::Load($dlibPath, [object].Assembly, $searchPath)
[System.Runtime.InteropServices.NativeLibrary]::Free($library)

@(
  "WINDOWS_SIGNTOOL_PATH=$signToolPath",
  "AZURE_CODE_SIGNING_DLIB=$dlibPath"
) | Out-File -FilePath $env:GITHUB_ENV -Encoding utf8 -Append
Write-Host 'Windows signing tools are ready.'
