# Start first instance for testing
$env:INSTANCE_ID = "1"
$env:ALLOW_MULTIPLE_INSTANCES = "true"
Write-Host "Starting Instance 1 (TCP: 8765, UDP: 8766)..." -ForegroundColor Cyan
npm run dev

