$ErrorActionPreference = 'Stop'

Write-Host "1. Logging in with admin/admin account..."
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginParams = @{
    log = 'admin'
    pwd = 'admin'
    'wp-submit' = 'Log In'
}

$loginRes = Invoke-WebRequest -Uri "http://purepin.local/wp-login.php" -Method Post -Body $loginParams -WebSession $session -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue

Write-Host "Cookies acquired successfully."

Write-Host "2. Fetching home page to extract nonce..."
$homePage = Invoke-WebRequest -Uri "http://purepin.local/" -WebSession $session -UseBasicParsing
if ($homePage.Content -match '"nonce":"([a-f0-9]+)"') {
    $nonce = $matches[1]
    Write-Host "Nonce found: $nonce"
    
    Write-Host "3. Creating a new pin (POST /pins)..."
    $pinData = @{
        page_url = "http://purepin.local/"
        page_title = "Test Page"
        x_pct = 50.0
        y_pct = 50.0
    } | ConvertTo-Json
    
    $createRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins" -Method Post -Body $pinData -ContentType "application/json" -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
    Write-Host "Pin created! Response:"
    $createRes | ConvertTo-Json -Depth 3

    Write-Host "4. Fetching pins (GET /pins)..."
    $getRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins" -Method Get -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
    Write-Host "Number of pins: $($getRes.Count)"
} else {
    Write-Host "No nonce found in the source code! The script might not have loaded."
}
