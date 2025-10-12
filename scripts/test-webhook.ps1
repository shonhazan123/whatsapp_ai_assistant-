# PowerShell script to test WhatsApp webhook

# Load .env file
if (Test-Path .env) {
    Get-Content .env | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, 'Process')
        }
    }
}

# Get ngrok URL or use localhost
$baseUrl = if ($env:NGROK_URL) { $env:NGROK_URL } else { "http://localhost:3000" }
$webhookUrl = "$baseUrl/webhook/whatsapp"

# Get message from command line argument or use default
$message = if ($args[0]) { $args[0] } else { "Hello, this is a test message" }

# Create test payload
$payload = @{
    entry = @(
        @{
            changes = @(
                @{
                    value = @{
                        messages = @(
                            @{
                                from = "1234567890"
                                id = "test_message_$(Get-Date -Format 'yyyyMMddHHmmss')"
                                type = "text"
                                text = @{
                                    body = $message
                                }
                            }
                        )
                    }
                }
            )
        }
    )
} | ConvertTo-Json -Depth 10

Write-Host "🧪 Testing WhatsApp Webhook...`n" -ForegroundColor Cyan
Write-Host "📍 URL: $webhookUrl" -ForegroundColor Yellow
Write-Host "💬 Message: `"$message`"`n" -ForegroundColor Yellow

try {
    $response = Invoke-RestMethod -Uri $webhookUrl -Method Post -Body $payload -ContentType "application/json"
    Write-Host "✅ Webhook test successful!" -ForegroundColor Green
    Write-Host "📊 Status: 200 OK" -ForegroundColor Green
    Write-Host "`nCheck your application logs to see the AI response." -ForegroundColor Cyan
} catch {
    Write-Host "❌ Webhook test failed!" -ForegroundColor Red
    Write-Host "📊 Status: $($_.Exception.Response.StatusCode.value__)" -ForegroundColor Red
    Write-Host "📝 Error: $($_.Exception.Message)" -ForegroundColor Red
    Write-Host "`nMake sure your application is running!" -ForegroundColor Yellow
    exit 1
}

