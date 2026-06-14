# E2E Tesztelés a PurePin Projektben

A PurePin beépített E2E tesztelési keretrendszere a **Playwright** és a **@wordpress/env** (Docker alapú lokális WordPress) együttesére épül.

Ez a dokumentum bemutatja, hogyan épül fel a rendszer és hogyan futtathatod az automatizált teszteket a gépeden.

## Előfeltételek
- **Docker** telepítve és futnia kell a háttérben.
- **Node.js** (és `npm`) telepítve.

## Környezet Indítása

Mielőtt a teszteket futtatnád, el kell indítani a Docker-alapú teszt WordPress környezetet:
```bash
npx wp-env start
```
Ez a parancs felhúzza a WordPress-t a `8888`-as porton, és automatikusan betölti a `plugin/` mappában lévő PurePin kódot (a `.wp-env.json` konfiguráció alapján).

## Tesztek Futtatása

Ha a `wp-env` fut, a teszteket az alábbi parancsokkal indíthatod a gyökérkönyvtárból:

- **Minden teszt futtatása a háttérben (headless mód):**
  ```bash
  npm run test:e2e
  ```
- **Tesztek futtatása vizuális felülettel (Playwright UI):**
  ```bash
  npm run test:e2e:ui
  ```

> [!TIP]
> A Playwright UI módban lépésről lépésre láthatod, mit csinál a böngésző, visszanézheted a kattintásokat, a DOM állapotát és a hálózati kéréseket. Fejlesztéshez mindig ezt használd!

## Hogyan Működik a Rendszer?

### 1. Global Setup (`tests/e2e/auth.setup.ts`)
A tesztek futtatása előtt a Playwright elindít egy speciális `setup` projektet. Ez a lépés:
- A `wp-env run cli ...` parancsok segítségével létrehoz az adatbázisban egy **DEV** (`administrator`) és egy **CLIENT** (`subscriber`) tesztfelhasználót, illetve egy teszt oldalt.
- A böngésző a háttérben bejelentkezik mindkét felhasználóval.
- Elmenti a session sütiket a `playwright/.auth/` mappába.

### 2. Playwright Konfiguráció (`playwright.config.ts`)
A konfiguráció tartalmaz két tesztkörnyezetet:
- `chromium-dev`: Ebbe a projektbe automatikusan befűzi a DEV (admin) bejelentkezési sessionjét.
- `chromium-client`: Ebbe a kliens bejelentkezési állapotát fűzi be.

Így amikor egy teszt fut, már nem kell a bejelentkezéssel (login form kitöltéssel) időzni, a teszt azonnal az éles funkciókat vizsgálhatja.

### 3. Tesztesetek (`tests/e2e/`)
Két fő teszt kategória létezik:
- `ui.spec.ts`: Böngészőt indít, és az olyan felhasználói műveleteket szimulálja, mint a gombnyomás, a pin lehelyezése, vagy a popup kitöltése.
- `api.spec.ts`: Közvetlenül az `http://localhost:8888/wp-json/purepin/v1/` REST API-ra küld kéréseket, ami villámgyorsan alkalmas az invariánsok (`[INV]`), a hibakezelések és jogosultságok tesztelésére, anélkül, hogy végigvárná a UI felépülését.
