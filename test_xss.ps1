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
    
    $xssPayload = "<script>alert('XSS Hack!')</script><img src='x' onerror='alert(`XSS 2`)'>https://evil.com/`"onmouseover=`"alert(1)"
    
    Write-Host "Sending comment with the following content: $xssPayload"
    
    $commentData = @{
        content = $xssPayload
    } | ConvertTo-Json
    
    try {
        $commentRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins/9/comments" -Method Post -Body $commentData -ContentType "application/json" -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
        Write-Host "Successfully saved! Comment ID: $($commentRes.id)"
        
        Write-Host "Checking how it was stored on the server (GET request):"
        $getRes = Invoke-RestMethod -Uri "http://purepin.local/wp-json/purepin/v1/pins/9/comments" -Method Get -Headers @{"X-WP-Nonce"=$nonce} -WebSession $session
        
        $lastComment = $getRes[-1]
        Write-Host "Content returned by the server:"
        Write-Host $lastComment.content
    } catch {
        Write-Host "API Error: $_"
    }
}
