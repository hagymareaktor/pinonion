$ErrorActionPreference = 'Stop'

Write-Host "Testing with app password..."
$user = "admin"
$pass = "hl3y 0Qyr Qp1g uLuT FaEY gHpF"
$pair = "$($user):$($pass)"
$bytes = [System.Text.Encoding]::ASCII.GetBytes($pair)
$base64 = [System.Convert]::ToBase64String($bytes)
$basicAuthValue = "Basic $base64"

$headers = @{
    Authorization = $basicAuthValue
}

Write-Host "1. Creating a new pin (POST /pins)..."
$pinData = @{
    page_url = "http://purepin.local/"
    page_title = "App Password Test"
    x_pct = 20.0
    y_pct = 20.0
} | ConvertTo-Json

try {
    $createRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins" -Method Post -Body $pinData -ContentType "application/json" -Headers $headers
    Write-Host "Pin created! Response:"
    $createRes | ConvertTo-Json -Depth 3
} catch {
    Write-Host "Error occurred during POST:"
    $_.Exception.Response.GetResponseStream() | %{ (New-Object System.IO.StreamReader($_)).ReadToEnd() }
}

Write-Host "`n2. Fetching pins (GET /pins)..."
try {
    $getRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins" -Method Get -Headers $headers
    Write-Host "Number of pins: $($getRes.Count)"
} catch {
    Write-Host "Error occurred during GET:"
    $_.Exception.Response.GetResponseStream() | %{ (New-Object System.IO.StreamReader($_)).ReadToEnd() }
}
