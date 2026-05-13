param(
  [string]$Version = "17",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "[postgres setup] $Message"
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[postgres setup warning] $Message" -ForegroundColor Yellow
}

function Test-Admin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Find-Psql {
  $command = Get-Command psql -ErrorAction SilentlyContinue

  if ($command) {
    return $command.Source
  }

  $roots = @(
    "$env:ProgramFiles\PostgreSQL",
    "${env:ProgramFiles(x86)}\PostgreSQL"
  ) | Where-Object { $_ -and (Test-Path $_) }

  $candidates = foreach ($root in $roots) {
    Get-ChildItem -Path $root -Filter psql.exe -Recurse -ErrorAction SilentlyContinue
  }

  return $candidates |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Add-BinToPath {
  param([string]$PsqlPath)

  $binDir = Split-Path -Parent $PsqlPath
  $pathParts = $env:Path -split ";" | Where-Object { $_ }

  if ($pathParts -notcontains $binDir) {
    $env:Path = "$env:Path;$binDir"
    Write-Step "Added $binDir to this PowerShell session PATH."
  }

  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $userPathParts = ($userPath -split ";") | Where-Object { $_ }

  if ($userPathParts -notcontains $binDir) {
    $nextUserPath = if ($userPath) { "$userPath;$binDir" } else { $binDir }
    [Environment]::SetEnvironmentVariable("Path", $nextUserPath, "User")
    Write-Step "Added $binDir to your user PATH. New terminals will pick it up automatically."
  }
}

function Find-PgHba {
  param([string]$PsqlPath)

  if ($env:PGDATA) {
    $candidate = Join-Path $env:PGDATA "pg_hba.conf"
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  $postgresRoot = Split-Path -Parent (Split-Path -Parent $PsqlPath)
  $candidateFromPsql = Join-Path $postgresRoot "data\pg_hba.conf"

  if (Test-Path $candidateFromPsql) {
    return $candidateFromPsql
  }

  $roots = @(
    "$env:ProgramFiles\PostgreSQL",
    "${env:ProgramFiles(x86)}\PostgreSQL"
  ) | Where-Object { $_ -and (Test-Path $_) }

  $candidates = foreach ($root in $roots) {
    Get-ChildItem -Path $root -Filter pg_hba.conf -Recurse -ErrorAction SilentlyContinue
  }

  return $candidates |
    Sort-Object FullName -Descending |
    Select-Object -First 1 -ExpandProperty FullName
}

function Enable-PasswordlessLocalAuth {
  param([string]$PgHbaPath)

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupPath = "$PgHbaPath.bak-$timestamp"
  Copy-Item -LiteralPath $PgHbaPath -Destination $backupPath
  Write-Step "Backed up pg_hba.conf to $backupPath."

  $lines = Get-Content -LiteralPath $PgHbaPath
  $hasIpv4Rule = $false
  $hasIpv6Rule = $false

  $nextLines = foreach ($line in $lines) {
    if ($line -match "^\s*host\s+all\s+all\s+127\.0\.0\.1/32\s+\S+") {
      $hasIpv4Rule = $true
      "host    all             all             127.0.0.1/32            trust"
      continue
    }

    if ($line -match "^\s*host\s+all\s+all\s+::1/128\s+\S+") {
      $hasIpv6Rule = $true
      "host    all             all             ::1/128                 trust"
      continue
    }

    $line
  }

  if (-not $hasIpv4Rule) {
    $nextLines += "host    all             all             127.0.0.1/32            trust"
  }

  if (-not $hasIpv6Rule) {
    $nextLines += "host    all             all             ::1/128                 trust"
  }

  Set-Content -LiteralPath $PgHbaPath -Value $nextLines -Encoding ASCII
  Write-Step "Enabled passwordless local TCP auth in pg_hba.conf."
}

function Restart-PostgresService {
  param([string]$Version)

  $services = Get-Service |
    Where-Object {
      $_.Name -like "*postgres*" -and
      ($_.Name -like "*$Version*" -or $_.DisplayName -like "*$Version*")
    }

  if (-not $services) {
    $services = Get-Service | Where-Object { $_.Name -like "*postgres*" }
  }

  $service = $services | Select-Object -First 1

  if (-not $service) {
    Write-Warn "Could not find a PostgreSQL Windows service. Restart PostgreSQL manually, then run npm run dev."
    return
  }

  Write-Step "Restarting PostgreSQL service $($service.Name)..."
  Restart-Service -Name $service.Name
}

function Test-PostgresConnection {
  param([string]$PsqlPath)

  Write-Step "Testing passwordless Postgres connection..."
  & $PsqlPath "postgres://postgres@localhost:5432/postgres" -c "select 1;" | Out-Host

  if ($LASTEXITCODE -ne 0) {
    throw "Passwordless Postgres connection test failed."
  }
}

Write-Step "Preparing native local PostgreSQL for Bonsai AI..."

$psqlPath = Find-Psql

if (-not $psqlPath -and -not $SkipInstall) {
  Write-Step "PostgreSQL was not found. Installing PostgreSQL $Version with winget..."
  winget install -e --id "PostgreSQL.PostgreSQL.$Version"
  $psqlPath = Find-Psql
}

if (-not $psqlPath) {
  throw "Could not find psql.exe. Install PostgreSQL $Version, then rerun this script."
}

Write-Step "Found psql at $psqlPath."
Add-BinToPath -PsqlPath $psqlPath

$pgHbaPath = Find-PgHba -PsqlPath $psqlPath

if (-not $pgHbaPath) {
  throw "Could not find pg_hba.conf. Confirm PostgreSQL server is installed, not only command-line tools."
}

if (-not (Test-Admin)) {
  Write-Warn "This script needs Administrator PowerShell to edit pg_hba.conf and restart PostgreSQL."
  Write-Warn "Rerun: Start-Process powershell -Verb RunAs"
  Write-Warn "Then from the repo: npm run setup:postgres:windows"
  exit 1
}

Write-Step "Using pg_hba.conf at $pgHbaPath."
Enable-PasswordlessLocalAuth -PgHbaPath $pgHbaPath
Restart-PostgresService -Version $Version
Test-PostgresConnection -PsqlPath $psqlPath

Write-Step "PostgreSQL is ready for Bonsai AI."
Write-Step "Next: npm run dev"
