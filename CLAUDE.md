# PurePin Review — Claude Code

## Projekt

WordPress plugin: ügyfelek pineket és kommenteket hagyhatnak az élő WP oldalon.

## Struktúra

```
D:\dev\purepin\
├── plugin\                    ← plugin forráskód (git trackeli)
│   ├── purepin-review.php     ← főfájl, DB, enqueue, admin bar
│   ├── includes\
│   │   ├── Api.php            ← REST API (purepin/v1/)
│   │   ├── Settings.php       ← admin beállítások, auto-lezárás cron
│   │   └── Cli.php            ← wp purepin CLI parancsok
│   └── assets\
│       ├── js\review.js       ← teljes frontend (~1650 sor)
│       └── css\review.css     ← dark mode UI
└── docs\                      ← dokumentáció, logo
```

## WP telepítés

- Local URL: `http://purepin.local/`
- Plugins: `C:\Users\peti\Local Sites\purepin\app\public\wp-content\plugins\`
- Junction: `plugins\purepin-review` → `D:\dev\purepin\plugin`

## WP-CLI gyorsparancsok

```powershell
$phpExe = "C:\Users\peti\AppData\Roaming\Local\lightning-services\php-8.2.29+0\bin\win64\php.exe"
$phpIni = "D:\dev\wpcli-php.ini"
$wpPhar = "D:\dev\wp-cli.phar"
$wpRoot = "C:\Users\peti\Local Sites\purepin\app\public"

& $phpExe -c $phpIni $wpPhar <parancs> --path="$wpRoot"
```

## REST API

- Namespace: `purepin/v1`
- Végpontok: `/pins`, `/pins/{id}`, `/pins/{id}/comments`, `/pins/{id}/read`, `/verify-token`, `/token`

## Adatbázis táblák

- `wp_kgb_pins` — pin pozíciók, státusz, szerző
- `wp_kgb_pin_comments` — kommentek és esemény logok

## Plugin verzió

Jelenleg: `2.0.8` (konstans: `KGB_REVIEW_VERSION`)
