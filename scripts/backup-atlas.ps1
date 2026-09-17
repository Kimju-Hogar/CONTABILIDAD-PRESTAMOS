# ============================================================
# backup-atlas.ps1 — Backup de la base de datos en MongoDB Atlas
# GotaGota | Windows
#
# Uso:
#   .\scripts\backup-atlas.ps1
#   .\scripts\backup-atlas.ps1 -Destino "D:\backups" -Retencion 60
#
# Lee MONGODB_URI y MONGODB_DB de .env.production (o del archivo que le pases).
# Requiere MongoDB Database Tools (mongodump).
# ============================================================

param(
  [string]$EnvFile   = ".env.production",
  [string]$Destino   = "$env:USERPROFILE\Desktop\CONTABILIDAD-PRESTAMOS-BACKUPS",
  [int]$Retencion    = 30
)

$ErrorActionPreference = "Stop"

# ─── Localizar mongodump ──────────────────────────────────────
$mongodump = (Get-Command mongodump -ErrorAction SilentlyContinue).Source
if (-not $mongodump) {
  $candidato = Get-ChildItem "C:\Program Files\MongoDB\Tools" -Recurse -Filter "mongodump.exe" -ErrorAction SilentlyContinue |
               Select-Object -First 1
  if ($candidato) { $mongodump = $candidato.FullName }
}
if (-not $mongodump) {
  Write-Error "No se encontró mongodump. Instala MongoDB Database Tools: https://www.mongodb.com/try/download/database-tools"
}

# ─── Leer variables del .env ──────────────────────────────────
if (-not (Test-Path $EnvFile)) { Write-Error "No existe el archivo $EnvFile" }

$uri = $null
$db  = "gotagota"
foreach ($linea in Get-Content $EnvFile) {
  if ($linea -match '^\s*MONGODB_URI\s*=\s*(.+)$') { $uri = $Matches[1].Trim() }
  if ($linea -match '^\s*MONGODB_DB\s*=\s*(.+)$')  { $db  = $Matches[1].Trim() }
}
if (-not $uri) { Write-Error "MONGODB_URI no está definida en $EnvFile" }

# ─── Ejecutar el dump ─────────────────────────────────────────
if (-not (Test-Path $Destino)) { New-Item -ItemType Directory -Force $Destino | Out-Null }

$marca   = Get-Date -Format "yyyyMMdd_HHmmss"
$nombre  = "atlas_${db}_$marca"
$carpeta = Join-Path $Destino $nombre

Write-Host "Respaldando la base '$db'..."
& $mongodump --uri="$uri" --db=$db --gzip --out=$carpeta
if ($LASTEXITCODE -ne 0) { Write-Error "mongodump terminó con código $LASTEXITCODE" }

# ─── Comprimir y limpiar ──────────────────────────────────────
$zip = "$carpeta.zip"
Compress-Archive -Path $carpeta -DestinationPath $zip -Force
Remove-Item -Recurse -Force $carpeta

$tam = [math]::Round((Get-Item $zip).Length / 1KB, 1)
Write-Host "Backup listo: $zip ($tam KB)"

# ─── Borrar backups viejos ────────────────────────────────────
$limite = (Get-Date).AddDays(-$Retencion)
$viejos = Get-ChildItem $Destino -Filter "atlas_${db}_*.zip" | Where-Object { $_.LastWriteTime -lt $limite }
foreach ($v in $viejos) {
  Remove-Item $v.FullName -Force
  Write-Host "Eliminado backup antiguo: $($v.Name)"
}

$total = (Get-ChildItem $Destino -Filter "atlas_${db}_*.zip").Count
Write-Host "Backups en disco: $total"
