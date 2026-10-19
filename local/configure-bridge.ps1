param([switch]$FromStdin)
$ErrorActionPreference = 'Stop'
$env:PSModulePath = (Join-Path $PSHOME 'Modules') + ';' + [Environment]::GetEnvironmentVariable('PSModulePath', 'Machine')
try {
  if (-not $FromStdin) { throw 'Use the protected setup flow from Codex.' }
  Add-Type -AssemblyName System.Security
  $bridgeRaw = [Console]::In.ReadLine()
  if ([string]::IsNullOrWhiteSpace($bridgeRaw) -or $bridgeRaw.Length -gt 16000) { throw 'Invalid config.' }
  $bridgeConfig = $bridgeRaw | ConvertFrom-Json
  $bridgeUrl = [Uri]$bridgeConfig.siteUrl
  if ($bridgeConfig.version -ne 1 -or $bridgeUrl.Scheme -ne 'https' -or -not $bridgeUrl.Host.EndsWith('.chatgpt.site') -or -not $bridgeUrl.IsDefaultPort -or $bridgeUrl.UserInfo -or $bridgeUrl.Query -or $bridgeUrl.Fragment -or $bridgeUrl.AbsolutePath -ne '/') { throw 'Invalid site.' }
  if ($bridgeConfig.siteBearerToken -notmatch '^[A-Za-z0-9._~+/-]{32,8192}={0,2}$' -or $bridgeConfig.bridgeKey -notmatch '^[A-Za-z0-9_-]{32,128}$') { throw 'Invalid secret.' }
  $bridgeBytes = [Text.Encoding]::UTF8.GetBytes($bridgeRaw)
  try { $bridgeProtected = [Security.Cryptography.ProtectedData]::Protect($bridgeBytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser) }
  finally { [Array]::Clear($bridgeBytes, 0, $bridgeBytes.Length); $bridgeRaw = $null; $bridgeConfig = $null }
  $bridgeRoot = Split-Path -Parent $PSScriptRoot
  $bridgeDirectory = Join-Path $bridgeRoot '.local-runtime'
  [IO.Directory]::CreateDirectory($bridgeDirectory) | Out-Null
  $bridgeTarget = Join-Path $bridgeDirectory 'cloud-bridge.protected.json'
  $bridgeEnvelope = @{version=1;protection='WindowsDPAPI-CurrentUser';payload=[Convert]::ToBase64String($bridgeProtected)} | ConvertTo-Json -Compress
  [IO.File]::WriteAllText($bridgeTarget, $bridgeEnvelope, (New-Object Text.UTF8Encoding($false)))
  $bridgeAcl = New-Object Security.AccessControl.FileSecurity
  $bridgeAcl.SetAccessRuleProtection($true, $false)
  $bridgeIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().User
  $bridgeSystem = New-Object Security.Principal.SecurityIdentifier('S-1-5-18')
  $bridgeAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($bridgeIdentity, 'FullControl', 'Allow')))
  $bridgeAcl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($bridgeSystem, 'FullControl', 'Allow')))
  [IO.File]::SetAccessControl($bridgeTarget, $bridgeAcl)
  [Console]::Out.WriteLine('{"configured":true}')
} catch {
  [Console]::Error.WriteLine('Protected bridge configuration failed. No secret was printed.')
  exit 1
}
