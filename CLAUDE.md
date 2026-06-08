# PurePin Review — Claude Code

## Project

WordPress plugin: clients can leave pins and comments on the live WP site.

## Structure

```
D:\dev\purepin\
├── plugin\                    ← plugin source code (tracked by git)
│   ├── purepin-review.php     ← main file, DB, enqueue, admin bar
│   ├── includes\
│   │   ├── Api.php            ← REST API (purepin/v1/)
│   │   ├── Settings.php       ← admin settings, auto-close cron
│   │   └── Cli.php            ← wp purepin CLI commands
│   └── assets\
│       ├── js\review.js       ← full frontend (~1650 lines)
│       └── css\review.css     ← dark mode UI
└── docs\                      ← documentation, logo
```

## WP Installation

- Local URL: `http://purepin.local/`
- MySQL port: `127.0.0.1:10011` (DB_HOST in wp-config.php)
- Plugins: `C:\Users\peti\Local Sites\purepin\app\public\wp-content\plugins\`
- Junction: `plugins\purepin-review` → `D:\dev\purepin\plugin`

## WP-CLI shortcuts

```powershell
$phpExe = "C:\Users\peti\AppData\Roaming\Local\lightning-services\php-8.2.29+0\bin\win64\php.exe"
$phpIni = "D:\dev\wpcli-php.ini"
$wpPhar = "D:\dev\wp-cli.phar"
$wpRoot = "C:\Users\peti\Local Sites\purepin\app\public"

& $phpExe -c $phpIni $wpPhar <command> --path="$wpRoot"
```

## REST API

- Namespace: `purepin/v1`
- Endpoints: `/pins`, `/pins/{id}`, `/pins/{id}/comments`, `/pins/{id}/read`, `/verify-token`, `/token`

## Database tables

- `wp_kgb_pins` — pin positions, status, author
- `wp_kgb_pin_comments` — comments and event logs

## Plugin version

Current: `2.0.8` (constant: `KGB_REVIEW_VERSION`)
