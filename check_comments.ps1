$ErrorActionPreference = 'Stop'

$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginParams = @{
    log = 'admin'
    pwd = 'admin'
    'wp-submit' = 'Log In'
}
$loginRes = Invoke-WebRequest -Uri "http://purepin.local/wp-login.php" -Method Post -Body $loginParams -WebSession $session -MaximumRedirection 0 -UseBasicParsing -ErrorAction SilentlyContinue

$homePage = Invoke-WebRequest -Uri "http://purepin.local/" -WebSession $session -UseBasicParsing
if ($homePage.Content -match '"nonce":"([a-f0-9]+)"') {
    $nonce = $matches[1]
    
    $commentsRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins/9/comments" -Method Get -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
    
    Write-Host "Comments for Pin #9:"
    foreach ($c in $commentsRes) {
        Write-Host "ID: $($c.id), Length: $($c.content.Length)"
    }
}
