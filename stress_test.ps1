$ErrorActionPreference = 'Stop'

Write-Host "1. Logging in with admin/admin..."
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginParams = @{
    log = 'admin'
    pwd = 'admin'
    'wp-submit' = 'Log In'
}
$loginRes = Invoke-WebRequest -Uri "http://purepin.local/wp-login.php" -Method Post -Body $loginParams -WebSession $session -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue

Write-Host "2. Getting nonce from homepage..."
$homePage = Invoke-WebRequest -Uri "http://purepin.local/" -WebSession $session -UseBasicParsing
if ($homePage.Content -match '"nonce":"([a-f0-9]+)"') {
    $nonce = $matches[1]
    Write-Host "Nonce found: $nonce"
    
    Write-Host "3. Creating a test pin..."
    $pinData = @{
        page_url = "http://purepin.local/"
        page_title = "Stress Test"
        x_pct = 50.0
        y_pct = 50.0
    } | ConvertTo-Json
    
    $createRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins" -Method Post -Body $pinData -ContentType "application/json" -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
    $pinId = $createRes.id
    Write-Host "Pin created with ID: $pinId"

    Write-Host "4. Stress testing comment endpoint with large payload..."
    # Generate 100KB string
    $largeString = "A" * 100000
    
    $commentData = @{
        content = $largeString
    } | ConvertTo-Json
    
    Write-Host "Sending 100KB comment..."
    try {
        $commentRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins/$pinId/comments" -Method Post -Body $commentData -ContentType "application/json" -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
        Write-Host "100KB comment SUCCESS. Comment ID: $($commentRes.id)"
    } catch {
        Write-Host "100KB comment FAILED: $_"
    }
    
    # Generate 2MB string
    $hugeString = "B" * 2000000
    $commentDataHuge = @{
        content = $hugeString
    } | ConvertTo-Json -Depth 1
    
    Write-Host "Sending 2MB comment..."
    try {
        $commentResHuge = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins/$pinId/comments" -Method Post -Body $commentDataHuge -ContentType "application/json" -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
        Write-Host "2MB comment SUCCESS. Comment ID: $($commentResHuge.id)"
    } catch {
        Write-Host "2MB comment FAILED: $_"
    }
    
} else {
    Write-Host "Could not find nonce."
}
