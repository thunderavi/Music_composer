Set-Location "$PSScriptRoot\backend"
$envPath = Join-Path (Get-Location) ".env"
$port = "5050"
$hostName = "0.0.0.0"
if (Test-Path $envPath) {
  Get-Content $envPath | ForEach-Object {
    if ($_ -match "^\s*#" -or $_ -notmatch "^\s*([^=]+)\s*=\s*(.*)\s*$") {
      return
    }
    $name = $Matches[1].Trim()
    $value = $Matches[2].Trim().Trim('"').Trim("'")
    [Environment]::SetEnvironmentVariable($name, $value, "Process")
    if ($name -eq "PORT" -and $value) { $port = $value }
    if ($name -eq "HOST" -and $value) { $hostName = $value }
  }
}
..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --host $hostName --port $port
