# Lusta Betöltés (Lazy Loading) és Teljesítmény Optimalizálási Terv

A cél a rendszer felkészítése több ezer pin kezelésére anélkül, hogy a böngésző vagy az adatbázis megakadna. 

## Milyen gyakorlatokat szoktak itt alkalmazni? (Iparági standardok)
Nagy mennyiségű adat kezelésekor a következő rétegekben szoktunk optimalizálni:
1. **Adatbázis szint (Indexing):** Indexek (mutatók) létrehozása a gyakran szűrt oszlopokra (pl. `status`, `created_at`), így az SQL szervernek nem kell végignéznie a teljes táblát egy kereséshez.
2. **API szint (Pagination & Projection):**
   - **Lapozás:** Soha nem küldjük le mind a 10.000 elemet. Csak az első 30-50 darabot, és ahogy a user görget lefelé, a többit.
   - **Projekció (Könnyített válasz):** Amikor az oldalra akarjuk rajzolni a markereket (a kis pöttyöket), nincs szükségünk a több ezer karakteres leírásokra vagy a szerzők nevére. Erre egy külön "könnyített" (lightweight) végpontot csinálunk, ami csak a koordinátákat és az azonosítókat küldi le.
3. **Frontend szint (Virtualization / Infinite Scroll):**
   - A listában nem generáljuk le az összes HTML elemet egyszerre, hanem "Infinite Scroll" (Végtelen görgetés) technikával (Intersection Observer segítségével) töltjük be a következő adagot, ha a lista aljára érünk.
   - A szűrést és rendezést a JavaScript helyett áthelyezzük a Backend API-ra, mivel a böngészőben már nem lesz meg az összes pin.

## Proposed Changes

### `purepin-review.php`
- Kibővítjük a `purepin_review_activate` és `purepin_review_maybe_upgrade` függvényeket, hogy SQL **INDEX**-eket hozzanak létre a `status`, `created_at`, és `author_name` mezőkön a gyorsabb szűrés és rendezés érdekében.

---

### `includes/Api.php`
#### [MODIFY] `Api.php`
- **Új végpont:** `GET /purepin/v1/markers`
  - Feladata: Csak a jelenlegi oldal marker-einek lekérése, szigorúan csak a megjelenítéshez szükséges adatokkal (`id, x_pct, y_pct, status, is_fixed, unread_count`). Ez villámgyors lesz.
- **Módosított végpont:** `GET /purepin/v1/pins`
  - Átalakítjuk lapozhatóra (Pagination). Elfogadja a következő paramétereket: `page`, `per_page`, `status`, `sort_by`, `search`, `author`, `important`.
  - A szűrést, rendezést, és a keresést teljes egészében MySQL szinten végezzük el.
  - A válasz JSON tartalmazni fogja a tabokhoz tartozó globális számlálókat (pl. `open_count: 24`, `done_count: 50`) is, hogy a frontend továbbra is ki tudja írni a fülekre a darabszámokat.

---

### `assets/js/review.js`
#### [MODIFY] `review.js`
- **Állapotkezelés:** A szűrők (`filterAuthors`, `sortBy`, `search`, stb.) megváltoztatásakor nem a böngésző memóriájában szűrünk, hanem küldünk egy új AJAX kérést az API-nak.
- **Lusta Betöltés (Infinite Scroll):** A lista aljára beillesztünk egy láthatatlan "figyelő" elemet (IntersectionObserver). Amikor ez a képernyőre (a panel aljára) ér, a JS automatikusan lekéri a következő `page`-t, és hozzáfűzi (append) az új HTML elemeket a meglévőkhöz.
- **Kétlépcsős indulás:**
  1. Oldalbetöltéskor csak a markereket kérjük le (`loadMarkers()`) a gyors megjelenítésért.
  2. Csak akkor vagy a háttérben kérjük le az oldalsáv adatait (`loadPanelPins(page=1)`), amivel spórolunk a kezdeti betöltési időn.

## User Review Required

> [!WARNING]
> **Nagyobb strukturális változás!** Mivel a szűrést áthelyezzük a backendre, a keresés és a szerző szerinti szűrés minden betűleütésnél/kattintásnál hálózati kérést indít (amit "debouncing"-gal, azaz kis késleltetéssel fogunk védeni).
> Elfogadod ezt a felépítést a maximális teljesítmény érdekében?
