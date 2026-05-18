# One-time: create the studycanvas database (run from project root)
$psql = "C:\Program Files\PostgreSQL\17\bin\psql.exe"
if (-not (Test-Path $psql)) {
    Write-Error "psql not found. Adjust path in this script if PostgreSQL is elsewhere."
    exit 1
}

$plain = Read-Host "Enter your PostgreSQL 'postgres' user password (from install)" -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($plain)
$env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)

& $psql -U postgres -h localhost -c "SELECT 1 FROM pg_database WHERE datname = 'studycanvas'" -tA | Out-Null
$exists = & $psql -U postgres -h localhost -tAc "SELECT 1 FROM pg_database WHERE datname = 'studycanvas'"

if ($exists -eq "1") {
    Write-Host "Database 'studycanvas' already exists."
} else {
    & $psql -U postgres -h localhost -c "CREATE DATABASE studycanvas;"
    Write-Host "Created database 'studycanvas'."
}

Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
Write-Host "Done. Set the same password in backend\.env (DATABASE_URL)."
