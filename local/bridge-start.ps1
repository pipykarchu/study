param()
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
try {
  Add-Type -AssemblyName System.Security
  $bridgeRoot = Split-Path -Parent $PSScriptRoot
  $bridgeTarget = Join-Path $bridgeRoot '.local-runtime/cloud-bridge.protected.json'
  $bridgeFile = Get-Item -LiteralPath $bridgeTarget
  if ($bridgeFile.Length -gt 40000) { throw 'Invalid protected config.' }
  $bridgeEnvelope = [IO.File]::ReadAllText($bridgeTarget, [Text.Encoding]::UTF8) | ConvertFrom-Json
  if ($bridgeEnvelope.version -ne 1 -or $bridgeEnvelope.protection -ne 'WindowsDPAPI-CurrentUser') { throw 'Invalid protected config.' }
  $bridgeProtected = [Convert]::FromBase64String($bridgeEnvelope.payload)
  $bridgeBytes = [Security.Cryptography.ProtectedData]::Unprotect($bridgeProtected, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)
  try { $bridgeJson = [Text.Encoding]::UTF8.GetString($bridgeBytes) }
  finally { [Array]::Clear($bridgeBytes, 0, $bridgeBytes.Length) }
  $bridgeNode = (Get-Command node.exe -ErrorAction Stop).Source
  $bridgeScript = Join-Path $PSScriptRoot 'bridge.mjs'
  $bridgeStart = New-Object Diagnostics.ProcessStartInfo
  $bridgeStart.FileName = $bridgeNode
  $bridgeStart.Arguments = '"' + $bridgeScript + '"'
  $bridgeStart.WorkingDirectory = $bridgeRoot
  $bridgeStart.UseShellExecute = $false
  $bridgeStart.CreateNoWindow = $true
  $bridgeStart.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
  $bridgeStart.RedirectStandardInput = $true
  $bridgeStart.RedirectStandardOutput = $true
  $bridgeStart.RedirectStandardError = $true
  $bridgeStart.EnvironmentVariables['NODE_USE_ENV_PROXY'] = '1'
  $bridgeProcess = New-Object Diagnostics.Process
  $bridgeProcess.StartInfo = $bridgeStart
  if (-not $bridgeProcess.Start()) { throw 'Bridge start failed.' }
  $bridgeInputBytes = [Text.Encoding]::UTF8.GetBytes($bridgeJson + [Environment]::NewLine)
  try {
    $bridgeProcess.StandardInput.BaseStream.Write($bridgeInputBytes, 0, $bridgeInputBytes.Length)
    $bridgeProcess.StandardInput.BaseStream.Flush()
    $bridgeProcess.StandardInput.Close()
  } finally { [Array]::Clear($bridgeInputBytes, 0, $bridgeInputBytes.Length); $bridgeJson = $null }
  if ($bridgeProcess.WaitForExit(1200)) {
    if ($bridgeProcess.ExitCode -ne 0) { throw 'Bridge start failed.' }
    [Console]::Out.WriteLine('{"alreadyRunning":true}')
  } else { [Console]::Out.WriteLine('{"started":true,"pid":' + $bridgeProcess.Id + '}') }
} catch {
  [Console]::Error.WriteLine('Cloud membership bridge could not start. Return to Codex to check the protected setup.')
  exit 1
}
