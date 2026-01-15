# Start second instance for testing
$env:INSTANCE_ID = "2"
$env:ALLOW_MULTIPLE_INSTANCES = "true"
$env:SKIP_REBUILD = "true"
Write-Host "Starting Instance 2 (TCP: 8775, UDP: 8776)..." -ForegroundColor Cyan
Write-Host "Skipping native module rebuild to avoid conflicts..." -ForegroundColor Yellow
npm run dev

