# PurePin Review — E2E tesztesetek

## Formátum

Gherkin (`Given / When / Then`) szintaxis, `.feature` blokkokban.  
Minden teszteset önállóan futtatható; a `Background` szekció az adott csoport közös előfeltételeit adja meg.

Minden csoport tartalmaz:
- **Funkcionális esetek** — normál működés, elégedett út (happy path)
- **Negatív / hibaesetek** — érvénytelen input, tiltott műveletek
- **Invariánsok** — feltételek, amelyek MINDEN körülmények között igazak kell maradjanak, bármilyen állapotban

**Szerepkör-rövidítések:**
- **DEV** — Developer szerepkörű bejelentkezett felhasználó (pl. administrator)
- **CLIENT** — Client szerepkörű bejelentkezett felhasználó (pl. subscriber)
- **GUEST** — Nem bejelentkezett látogató

---

## 1. Szerepkörök és jogosultságok

```gherkin
Feature: Roles & Permissions

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @AUTH-001
  Scenario: open_pin URL paraméter automatikusan megnyitja a pint betöltés után
    Given az URL tartalmazza a ?review=1&open_pin=42 paramétert
    When az oldal betöltődik
    Then 300ms elteltével a #42 pin detail popupja automatikusan megnyílik
    And az URL history.replaceState-tel megtisztul (paraméter eltűnik)

  @AUTH-002
  Scenario: CSS selector alapján scrollozás pin megnyitásakor
    Given egy pin rendelkezik css_selector mezővel
    When a pin detail-t megnyitja a listából
    Then a css_selector által megjelölt elem scrollIntoView-ba kerül (smooth)
    And 420ms után a popup megnyílik a marker helyén

  @AUTH-003
  Scenario: Scroll context visszaállítása pin megnyitásakor
    Given egy pin rendelkezik scroll_context JSON mezővel (belső scrollozható konténerrel)
    When a pin detail-t megnyitja a listából
    Then a scroll_context-ben tárolt konténerek scrollTop értéke visszaállítódik

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @AUTH-004
  Scenario: [INV] Egy időben legfeljebb egy detail popup létezik a DOM-ban
    Given az #1 pin detail popupja nyitva van
    When a #2 pin markerére kattint
    Then az #1 popup eltávolítódik a DOM-ból
    And az #2 popup jelenik meg
    # closePopup() mindig meghívódik openPinDetail() elején

  @AUTH-005
  Scenario: [INV] Detail popup és add mode soha nem aktív egyszerre
    Given add mode aktív
    When valami okból a detail popup megjelenne
    Then az nem lehetséges — add mode kattintás-kezelő elnyeli az eseményt
    # Ha a popup már nyitva van és add mode-ot aktiválnak: add mode bekapcsol, popup bezárul
    Given detail popup nyitva van
    When FAB-ot és "+" speed-dial gombot megnyom
    Then a popup bezárul (closePopup via toggleSpeedDial/closePanel)

  @AUTH-006
  Scenario: [INV] A /pins/{id}/read hívás mindig megtörténik popup megnyitáskor — sikertelen válasz sem akadályozza a popup megjelenítését
    Given a /pins/{id}/read endpoint átmenetileg nem elérhető (pl. 500 hiba)
    When a felhasználó megnyitja a pin detail popupot
    Then a popup megjelenik (a mark_read hívás .catch(() => {}) el van kapva)
    And nem jelenik meg hibaüzenet a felhasználónak

  @AUTH-007
  Scenario: [INV] Nem létező open_pin URL paraméter nem okoz hibát
    Given az URL tartalmaz ?open_pin=999999 paramétert, de ilyen pin nem létezik
    When az oldal betöltődik
    Then az oldal hibamentesen tölt be
    And semmilyen popup nem jelenik meg

  @AUTH-008
  Scenario: [INV] open_pin paraméter törlődik az URL-ből, mielőtt a felhasználó elnavigálna
    Given az oldal ?open_pin=42 paraméterrel töltődött be
    When a popup megnyílik
    Then az URL-ben már nem szerepel az open_pin paraméter (history.replaceState megtörtént)
    # Oldal újratöltésekor nem nyílik meg újra automatikusan a popup

  @AUTH-009
  Scenario: [INV] WP admin bar magassága mindig figyelembevételre kerül popup pozicionáláskor
    Given a WP admin bar látható (32px vagy 46px magas)
    When egy pin a képernyő tetejéhez közel van
    Then a popup legalább (adminbar magasság + 8px) távolságra jelenik meg a képernyő tetejétől
    # positionPopup() minTop = wpBar.offsetHeight + 8 logika
```

---

## 6. Kommentelés

```gherkin
Feature: Comments

  Background:
    Given bejelentkezett felhasználó
    And egy pin detail popup nyitva van
    And a pin státusza nem "done"

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @COMMENT-001
  Scenario: Komment küldése
    Given a reply textarea látható
    When beír egy szöveget és a "Send" gombra kattint
    Then a komment elmentődik az adatbázisba
    And a kommentlista frissül és tartalmazza az új kommentet
    And a textarea kiürül

  @COMMENT-002
  Scenario: Ctrl+Enter billentyűparancs küldi a kommentet
    Given a reply textarea fókuszban van
    When beír szöveget és Ctrl+Enter-t üt
    Then a komment elküldődik

  @COMMENT-003
  Scenario: Üres komment nem küldhető
    Given a reply textarea üres
    When a "Send" gombra kattint
    Then a komment NEM kerül elküldésre
    And a textarea fókuszt kap

  @COMMENT-004
  Scenario: 1001 karakteres komment nem küldhető
    When a textarea-ba 1001 karaktert ír
    And a "Send" gombra kattint
    Then hibaüzenet jelenik meg: "text is too long (maximum 1000 characters)"

  @COMMENT-005
  Scenario: Kommentlista chat-szerű megjelenítése
    Given egy pin több kommenttel rendelkezik (különböző szerzőktől)
    Then a saját kommentek jobb oldalon jelennek meg (.pp-rv-bubble--mine)
    And más szerzők kommentjei bal oldalon jelennek meg
    And a szerző avatárja az első komment előtt látható

  @COMMENT-006
  Scenario: URL-ek kattintható linkekké alakulnak a kommentekben
    Given egy komment tartalmaz URL-t (pl. https://example.com)
    Then az URL kattintható <a> linkként jelenik meg
    And a link target="_blank" és rel="noopener noreferrer" attribútumokkal rendelkezik

  @COMMENT-007
  Scenario: Hosszú komment összecsukható
    Given egy komment 180 karakternél hosszabb
    Then a komment csonkítva jelenik meg
    And egy "More ▾" gomb látható
    When rákattint a "More ▾" gombra
    Then a teljes szöveg megjelenik
    And a gomb "Less ▴"-ra vált

  @COMMENT-008
  Scenario: Done státuszú pinhez nem lehet kommentet írni
    Given egy pin státusza "done"
    When megnyitja a pin detail popupot
    Then a reply textarea NEM látható
    And látható a "Reopen issue" gomb

  @COMMENT-009
  Scenario: Eseménynapló bejegyzés megjelenik státuszváltáskor
    Given DEV megváltoztatja egy pin státuszát "open"-ről "in_progress"-re
    Then a kommentlistában megjelenik egy eseménybejegyzés: "Status: Open → In Progress"
    And az esemény szürke/kisebb stílusban jelenik meg (.pp-rv-event)

  @COMMENT-010
  Scenario: Komment elküldése után a pin updated_at mezője frissül
    When új komment érkezik egy pinre
    Then a pin updated_at mezője az aktuális időre frissül az adatbázisban

  @COMMENT-011
  Scenario: DEV saját kommentje nem számít olvasatlannak
    Given DEV kommentet ír egy pinre
    Then az unread_count NEM nő a DEV nézőpontjából (author_wp_id kizárás a COUNT-ból)

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @COMMENT-012
  Scenario: [INV] Komment és eseménynapló szerzője mindig a bejelentkezett felhasználó — meghamisíthatatlan
    Given DEV bejelentkezve
    When POST /wp-json/purepin/v1/pins/1/comments kérést küld author_name: "Fake User" értékkel, vagy PATCH /pins/1 kéréssel státuszt vált
    Then az elmentett komment és eseménynapló author_name mezője a valódi DEV neve
    # wp_get_current_user() fut a backenden, a payload author_name figyelmen kívül marad

  @COMMENT-013
  Scenario: [INV] Eseménynaplók (type='event') mindig is_read=1-gyel kerülnek mentésre
    Given státuszváltás történik
    When az eseménynapló bejegyzés bekerül az adatbázisba
    Then a bejegyzés is_read értéke 1
    # Az esemény nem befolyásolja az unread_count-ot

  @COMMENT-014
  Scenario: [INV] Új komment mindig is_read=0-val kerül mentésre
    When purepin_rv_add_comment() lefut
    Then az új komment is_read=0 értékkel kerül az adatbázisba
    # A küldő nem jelölheti saját kommentjét olvasottnak a küldés pillanatában

  @COMMENT-015
  Scenario: [INV] Dupla "Send" kattintás nem küld el két kommentet
    Given a reply textarea ki van töltve
    When a "Send" gombra gyorsan kétszer kattint
    Then csak egy komment kerül elküldésre
    # btn.disabled = true az első kattintás után

  @COMMENT-016
  Scenario: [INV] CLIENT nem kommentelhet más CLIENT pinjéhez
    Given CLIENT-A bejelentkezve
    And létezik CLIENT-B pinje
    When POST /wp-json/purepin/v1/pins/{CLIENT-B-id}/comments kérés érkezik CLIENT-A-tól
    Then 403 Forbidden választ kap

  @COMMENT-017
  Scenario: [INV] Kommentlista mindig időrendi (ASC) sorrendben van betöltve
    Given egy pin több kommenttel rendelkezik
    When a kommentlista betöltődik (GET /pins/{id}/comments)
    Then a kommentek created_at ASC sorrendben érkeznek vissza
    And a legutóbbi komment a lista alján van
    # A UI a clist.scrollTop = clist.scrollHeight-el automatikusan az aljára scrolloz

  @COMMENT-018
  Scenario: [INV] XSS karakterek a kommenttartalomban nem hajtódnak végre
    When egy komment tartalma "<img src=x onerror=alert(1)>"
    Then a komment szövege plain text-ként jelenik meg (HTML entitásokká alakítva)
    # linkify() és esc() függvények gondoskodnak erről
```

---

## 7. Státusz módosítás

```gherkin
Feature: Status change

  Background:
    Given DEV bejelentkezve
    And egy pin detail popup nyitva van

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @STATUS-001
  Scenario: Státusz megváltoztatása "open"-ről "in_progress"-re
    When a státusz pillre kattint
    Then legördül a státusz menü
    When az "In Progress" opcióra kattint
    Then a pin státusza "in_progress"-re változik az adatbázisban
    And a státusz pill color/label frissül
    And a listában a pin a megfelelő tabba kerül
    And eseménynapló bejegyzés jelenik meg a kommentlistában

  @STATUS-002
  Scenario: Státusz megváltoztatása "in_progress"-ről "done"-ra
    Given egy "in_progress" pin detail popupja nyitva van
    When a státusz pillre kattint és "Done"-t választ
    Then a pin áthelyeződik a Done tabba
    And a marker zöld színű lesz

  @STATUS-003
  Scenario: Státusz menü bezárul kívüli kattintásra
    Given a státusz menü nyitva van
    When a popup más részére kattint
    Then a státusz menü bezárul

  @STATUS-004
  Scenario: Gyors "kész" gomb a listából
    Given a panel lista "open" tabján egy pin látható
    When a ✓ gombra kattint
    Then natív böngésző confirm dialog jelenik meg: "Are you sure you want to close this issue?"
    When a confirm dialogon "OK"-t kattint
    Then a pin státusza "done"-ra változik
    And a pin eltűnik az "open" listából

  @STATUS-005
  Scenario: Gyors "kész" gomb — Cancel
    Given a confirm dialog megjelent
    When "Cancel"-t választ
    Then a pin státusza nem változik

  @STATUS-006
  Scenario: "Reopen issue" gomb done pinon
    Given egy "done" státuszú pin detail popupja nyitva van
    When a "Reopen issue" gombra kattint
    Then PATCH kérés megy a status: "open" értékkel
    And automatikusan beküldődik egy komment: "This issue reappeared."
    And a popup bezárul
    And a pin visszakerül az "open" listába

  @STATUS-007
  Scenario: Státuszváltás frissíti a tab számlálókat
    Given Open tab 5 pinnel, Done tab 2 pinnel
    When egy "open" pin státuszát "done"-ra változtatja
    Then Open tab számlálója 4-re csökken
    And Done tab számlálója 3-ra nő

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @STATUS-008
  Scenario: [INV] Státusz értéke mindig csak "open", "in_progress" vagy "done" lehet
    When PATCH kérés érkezik status: "closed" értékkel
    Then az adatbázisba NEM kerül mentés
    # A backend in_array($status, ['open', 'in_progress', 'done'], true) validációt végez

  @STATUS-009
  Scenario: [INV] Minden státuszváltás eseménynaplót hoz létre — kivétel: azonos státuszra váltás
    Given egy "open" pin
    When PATCH kérés érkezik status: "open" értékkel (nem változott)
    Then eseménynapló bejegyzés NEM keletkezik
    # Csak akkor ír naplót, ha $status !== $pin->status

  @STATUS-010
  Scenario: [INV] Státuszváltás pillanatában a pill le van tiltva (disabled) — dupla kattintás ellen
    When a státusz pillre kattint és egy opciót választ
    Then a pill disabled=true állapotba kerül az API hívás idejére
    And az API válasz megérkezése után a disabled feloldódik

  @STATUS-011
  Scenario: [INV] "Done" tab listájából nem jelenik meg ✓ gomb
    Given a panel "Done" tabján vannak pinek
    Then a lista sorokban nem jelenik meg a ✓ (done) gomb
    # state.activeTab !== 'done' feltétel

  @STATUS-012
  Scenario: [INV] Státuszváltás után a listában az aktív tab mindig konzisztens marad
    Given az "Open" tab aktív
    When egy pin státuszát "done"-ra változtatja
    Then a pin azonnal eltűnik az "Open" tab listájából (renderList() újrafut)
    And a pin NEM jelenik meg egyszerre két tabban
```

---

## 8. Urgent / Important jelölés

```gherkin
Feature: Urgent (important) flag

  Background:
    Given DEV bejelentkezve

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @URGENT-001
  Scenario: Pin jelölése urgentnek a lista sorából
    Given a lista sorában látható a ! gomb
    When a ! gombra kattint
    Then a pin important=1 értékkel frissül
    And a gomb aktív állapotba kerül
    And a lista sor kiemelve jelenik meg (.pp-rv-pin-item--important)

  @URGENT-002
  Scenario: Urgent jelölő eltávolítása a lista sorából
    Given egy important=1 pin
    When a ! gombra kattint
    Then a pin important=0 értékre vált

  @URGENT-003
  Scenario: Urgent toggle a kebab menüből (popup)
    Given egy pin detail popup nyitva van
    And a kebab menü nyitva van
    When az "Urgent" kapcsolót bekapcsolja
    Then a pin important=1 értékre vált az adatbázisban
    And a popup fejlécben megjelenik a "!" sárga jelzés

  @URGENT-004
  Scenario: CLIENT nem látja az urgent gombot a listában
    Given CLIENT bejelentkezve
    When megnézi a lista sorokat
    Then nem látható a ! (star) gomb

  @URGENT-005
  Scenario: Fontossági sorrendben rendezés
    Given a listában vegyesen urgent és nem urgent pinek vannak
    When a Sort menüből "Important first"-et választ
    Then az important=1 pinek a lista tetején jelennek meg
    And ezen belül létrehozási dátum szerint csökkenő sorrendben

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @URGENT-006
  Scenario: [INV] important mező értéke csak 0 vagy 1 lehet — nincs null
    Given egy frissen létrehozott pin
    Then a pin important értéke pontosan 0 (nem null, nem undefined)

  @URGENT-007
  Scenario: [INV] CLIENT által küldött important=1 PATCH kérés nem módosítja az értéket
    Given CLIENT bejelentkezve
    When PATCH /wp-json/purepin/v1/pins/1 kérést küld important: 1 értékkel
    Then a szerver 403-at ad, vagy ha a státusz miatt engedélyezett a PATCH,
         az important mező nem változik (purepin_rv_is_developer() ellenőrzés)

  @URGENT-008
  Scenario: [INV] Urgent toggle lista sorban és popup kebab-ban szinkronban van
    Given egy pin detail popup nyitva van és a lista is látható
    When a lista sorban a ! gombbal urgent-re állítja
    Then a popup fejlécében is megjelenik a "!" sárga jelzés (renderList() és renderMarkers() újrafut)

  @URGENT-009
  Scenario: [INV] Marker megjelenítése nem függ az urgent flag-től
    Given egy important=1 pin
    Then a pin markere a státusz szerinti színt kapja (nem "urgent" külön szín)
    # Az important flag csak a lista item CSS osztályát és a popup fejlécét befolyásolja
```

---

## 9. Leírás szerkesztése

```gherkin
Feature: Edit pin description

  Background:
    Given DEV bejelentkezve
    And egy pin detail popup nyitva van

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @EDIT-001
  Scenario: Leírás szerkesztése — sikeres eset
    When megnyomja a kebab menüt
    And az "Edit description" gombra kattint
    Then az eredeti leírás szövege eltűnik
    And egy textarea jelenik meg az eredeti szöveggel kitöltve
    And "Cancel" és "Save" gombok jelennek meg

    When módosítja a szöveget és "Save"-t nyom
    Then PATCH kérés megy az új description értékkel
    And a popup-ban a leírás frissül
    And megjelenik az "Edited · <dátum>" metainfo a leírás alatt

  @EDIT-002
  Scenario: Leírás szerkesztés megszakítása
    Given az inline szerkesztő textarea nyitva van
    When a "Cancel" gombra kattint
    Then a textarea eltűnik
    And az eredeti szöveg visszajelenik

  @EDIT-003
  Scenario: Leírás szerkesztése 1001 karakterrel — hiba
    Given az inline szerkesztő textarea nyitva van
    When 1001 karaktert ír be és "Save"-t nyom
    Then hibaüzenet jelenik meg a maximális hosszról

  @EDIT-004
  Scenario: CLIENT nem tud leírást szerkeszteni
    Given CLIENT bejelentkezve, pin detail popupja nyitva van
    When megnyitja a kebab menüt
    Then nem látható az "Edit description" opció

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @EDIT-005
  Scenario: [INV] Egyszerre csak egy szerkesztő textarea lehet nyitva
    Given az "Edit description" textarea már nyitva van
    When ismét a "Edit description" menüpontra kattint (pl. kebab újranyitással)
    Then nem nyílik meg egy második textarea
    # Az if (descBlock.querySelector('.pp-rv-desc-edit-area')) return; védi

  @EDIT-006
  Scenario: [INV] description_updated_at mindig beállítódik leírás-mentéskor
    When a leírás szerkesztésre és mentésre kerül
    Then az adatbázisban a description_updated_at mező az aktuális időre frissül
    And a popup metasorában megjelenik az "Edited" jelzés

  @EDIT-007
  Scenario: [INV] Üres leírásra mentés nem lehetséges (trim utáni ellenőrzés)
    Given az inline szerkesztő textarea nyitva van
    When csak szóközöket ír be és "Save"-t nyom
    Then a szerver 400-as hibát ad ("Description is required")
    # trim() alapú validáció a backenden

  @EDIT-008
  Scenario: [INV] A szerkesztés mentése dupla kattintásra nem küld két PATCH-et
    Given az inline textarea ki van töltve
    When a "Save" gombra gyorsan kétszer kattint
    Then csak egy PATCH kérés megy el
    # saveBtn.disabled = true az első kattintásra
```

---

## 10. Pin törlése

```gherkin
Feature: Delete pin

  Background:
    Given DEV bejelentkezve
    And egy pin detail popup nyitva van

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @DELETE-001
  Scenario: Pin törlése — sikeres eset
    When megnyomja a kebab (⋮) gombot
    And a "Delete review" gombra kattint
    Then a confirm sáv megjelenik a popup tetején: "Are you sure you want to delete this review?"

    When a "Yes" gombra kattint
    Then DELETE kérés megy a /pins/{id} végpontra
    And a pin és összes kommentje törlődik az adatbázisból
    And a popup bezárul
    And a pin eltűnik a listából és a markerek közül

  @DELETE-002
  Scenario: Pin törlés megszakítása
    Given a confirm sáv látható
    When a "Cancel" gombra kattint
    Then a confirm sáv eltűnik
    And a pin nem törlődik

  @DELETE-003
  Scenario: Törlés után a list és markerek frissülnek
    When egy pin törlése megtörténik
    Then a loadPins() újra lefut
    And a törölt pin markere eltűnik az oldalról

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @DELETE-004
  Scenario: [INV] Pin törlése mindig kaszkád-törli a kommenteket is
    Given egy pinhez 5 komment tartozik
    When a pin törlődik (DELETE /pins/{id})
    Then a purepin_pin_comments táblából is törlődik mind az 5 komment
    # A backend explicit DELETE a comments táblán fut: $wpdb->delete($ct, ['pin_id' => $id])

  @DELETE-005
  Scenario: [INV] Törölt pin ID soha nem kerül újrafelhasználásra (AUTO_INCREMENT)
    Given a #42 pin törlődött
    When az adatbázisba új pin kerül
    Then az új pin ID nagyobb mint 42 (MySQL AUTO_INCREMENT nem reciklálja)

  @DELETE-006
  Scenario: [INV] Törölt pin detail popupja nem nyitható meg a /read végponton sem
    Given a #42 pin törlődött
    When POST /wp-json/purepin/v1/pins/42/read kérés érkezik
    Then a request nem okoz szerver hibát (a 0 affected rows nem error)
    # A backend nem ellenőrzi, hogy a pin létezik-e a /read végponton — dokumentált korlát

  @DELETE-007
  Scenario: [INV] open_pin URL paraméterrel törölt pin URL-je nem okoz látható hibát
    Given a #42 pin törlődött
    When az oldal ?open_pin=42 paraméterrel töltődik be
    Then az oldal betölt, nincs JS hiba
    And a popup nem jelenik meg (a pin nem található a state.pins tömbben)
```

---

## 11. "Set unread" funkció

```gherkin
Feature: Set unread

  Background:
    Given DEV bejelentkezve
    And egy pin detail popup nyitva van
    And a pin kommentjei olvasottak

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @UNREAD-001
  Scenario: Pin visszajelölése olvasatlannak
    When megnyomja a kebab (⋮) gombot
    And a "Set unread" gombra kattint
    Then POST kérés megy a /pins/{id}/unread végpontra
    And a pin unread_count értéke lokálisan frissül (comment_count értékére)
    And a FAB badge megjelenik/frissül
    And a lista sorban megjelenik az olvasatlan jelzés

  @UNREAD-002
  Scenario: "Set unread" gomb csak DEV-nek látható
    Given CLIENT bejelentkezve
    When megnézi a kebab menüt
    Then nem látható a "Set unread" opció

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @UNREAD-003
  Scenario: [INV] /unread endpoint minden kommentet is_read=0-ra állít (nem csak egyet)
    Given egy pinhez 3 komment tartozik, mind is_read=1
    When POST /pins/{id}/unread kérés érkezik
    Then mindhárom komment is_read értéke 0 lesz az adatbázisban
    # $wpdb->update() a pin_id alapján tömeges UPDATE-et végez

  @UNREAD-004
  Scenario: [INV] Set unread után a FAB badge megjelenik (nem 0 marad)
    Given a FAB badge rejtve van (összes komment olvasott)
    When "Set unread" kerül alkalmazásra
    Then a FAB badge láthatóvá válik pozitív számmal

  @UNREAD-005
  Scenario: [INV] Set unread gombra dupla kattintás nem okoz dupla API hívást
    When a "Set unread" gombra kattint
    Then a gomb disabled=true állapotba kerül az API hívás idejére
    And az API válasz után visszaengedélyeződik
```

---

## 12. Pin lista panel — szűrők és keresés

```gherkin
Feature: Panel filters and search

  Background:
    Given DEV bejelentkezve
    And a panel nyitva van
    And több pin létezik különböző státusszal, szerzőkkel, oldalakkal

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @PANEL-001
  Scenario: Tab váltás Open → In Progress
    When az "In Progress" tabra kattint
    Then csak az "in_progress" státuszú pinek láthatók

  @PANEL-002
  Scenario: Tab váltás Open → Done
    When a "Done" tabra kattint
    Then csak a "done" státuszú pinek láthatók

  @PANEL-003
  Scenario: Tab számlálók megjelennek
    Then az "Open" tab számát mutatja az open pinekre
    And az "In Progress" tab a megfelelő számot mutatja

  @PANEL-004
  Scenario: Szöveges keresés — szerző neve alapján
    When a keresőmezőbe beírja "Anna"
    Then csak azok a pinek láthatók, amelyek author_name mezője tartalmazza "Anna"-t

  @PANEL-005
  Scenario: Szöveges keresés — leírás alapján
    When a keresőmezőbe beírja "fejléc"
    Then csak azok a pinek láthatók, amelyek description mezője tartalmazza "fejléc"-et

  @PANEL-006
  Scenario: Szöveges keresés — oldal neve alapján
    When a keresőmezőbe beírja "Főoldal"
    Then csak azok a pinek láthatók, amelyek page_title-je tartalmazza "Főoldal"-t

  @PANEL-007
  Scenario: Keresés kiürítésére minden pin visszajelenik
    Given az előző keresőmező ki van töltve
    When a keresőmezőt kiüríti
    Then az összes (tabnak megfelelő) pin visszajelenik

  @PANEL-008
  Scenario: Szűrő — "Only urgent"
    When a Filter gombra kattint és az "Only urgent" kapcsolót bekapcsolja
    Then csak az important=1 pinek láthatók
    And a Filter gomb "has-value" kiemelést kap

  @PANEL-009
  Scenario: Szűrő — "Unread comments"
    When az "Unread comments" kapcsolót bekapcsolja
    Then csak azok a pinek láthatók, amelyek unread_count > 0

  @PANEL-010
  Scenario: Szűrő — "New pins"
    When a "New pins" kapcsolót bekapcsolja
    Then csak azok a pinek láthatók, amelyeket a felhasználó még sosem nyitott meg

  @PANEL-011
  Scenario: Oldal-szűrő — "Only current page"
    When a Page filter gombra kattint és "Only current page"-t választ
    Then csak az aktuális oldal URL-jéhez tartozó pinek láthatók

  @PANEL-012
  Scenario: Oldal-szűrő — adott oldal kiválasztása
    When a Page filter menüből egy konkrét oldalra kattint
    Then csak az adott oldal pinjei láthatók
    And a Page filter gomb "has-value" kiemelést kap

  @PANEL-013
  Scenario: Oldal-szűrő — visszaállítás "All pages"-re
    Given egy konkrét oldal szűrő aktív
    When a Page filter menüből "All pages (Global)"-t választ
    Then az összes oldal pinjei láthatók

  @PANEL-014
  Scenario: Rendezés — Newest pin first (alapértelmezett)
    Then a lista created_at csökkenő sorrendben van rendezve

  @PANEL-015
  Scenario: Rendezés — Oldest pin first
    When a Sort menüből "Oldest pin first"-et választ
    Then a lista created_at növekvő sorrendben van rendezve

  @PANEL-016
  Scenario: Rendezés — Newest comment first
    When "Newest comment first"-et választ
    Then a lista updated_at csökkenő sorrendben van rendezve

  @PANEL-017
  Scenario: Rendezés — Important first
    When "Important first"-et választ
    Then az urgent pinek a lista tetején vannak
    And ezen belül newest first sorrendben



  @PANEL-018
  Scenario: Több szűrő kombinálása
    Given "Only urgent" szűrő aktív
    And "Only current page" oldal szűrő aktív
    When az Open tabra navigál
    Then csak az aktuális oldalon lévő, urgent, open státuszú pinek láthatók

  @PANEL-019
  Scenario: Infinite scroll — 30 pinenkénti lapozás
    Given 35 pin van az aktuális szűrővel
    Then először 30 pin jelenik meg
    When legörget a lista aljára (IntersectionObserver trigger)
    Then betöltődik a maradék 5 pin

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @PANEL-020
  Scenario: [INV] Az összes aktív szűrő AND kapcsolatban van — nem OR
    Given "Only urgent" szűrő aktív
    And "Unread comments" szűrő aktív
    Then csak azok a pinek láthatók, amelyek egyszerre urgent ÉS unread
    # Nem: urgent VAGY unread

  @PANEL-021
  Scenario: [INV] Tab váltás mindig visszaállítja a listát az 1. oldalra
    Given a 2. oldalon van az infinite scroll (30+ pin után)
    When tabra kattint
    Then a lista az elejéről kezdődik (listPage=1)
    # renderList(resetPage=true) hívódik tab váltáskor

  @PANEL-022
  Scenario: [INV] Keresési szűrő case-insensitive
    Given van pin amelynek author_name-je "Anna Kovács"
    When a keresőmezőbe "anna kovács"-t ír (kisbetűvel)
    Then a pin megjelenik a listában
    # .toLowerCase().includes(q) logika

  @PANEL-023
  Scenario: [INV] Üres keresőmező sosem szűr ki semmit
    Given a keresőmező üres (state.search = '')
    Then az összes (tab által engedett) pin megjelenik
    # if (state.search) feltétel — üres stringre nem fut a szűrés

  @PANEL-024
  Scenario: [INV] Oldal-szűrő "current" opció mindig az aktuális oldal pathname-jét használja
    Given a felhasználó a /rolunk oldalon van
    And vannak pinek /rolunk és /kapcsolat URL-ekről is
    When "Only current page" szűrőt aktivál
    Then csak /rolunk pinek láthatók
    # urlPathname() normalizálja a trailing slash-t és a query stringet levágja

  @PANEL-025
  Scenario: [INV] Szűrők megváltozása után az IntersectionObserver mindig újra kötődik
    Given infinite scroll aktív (sentry elem a DOM-ban)
    When szűrő megváltozik és renderList(true) lefut
    Then az előző IntersectionObserver disconnect()-elve lesz
    And új observer csak akkor kötődik, ha az új lista > 30 elem
    # listObserver.disconnect() és listObserver = null mindig meghívódik

  @PANEL-026
  Scenario: [INV] Panel scrollozás csak a pin listán belül hat — az oldal többi része nem scrollozódik
    Given a panel nyitva van
    When az egérkereket görgeti a panel fejlécén vagy a szűrő sávon
    Then az esemény preventDefault()-del el van nyomva
    And a pinList.scrollTop kézzel frissül
    And az oldal maga (document body) nem scrollozódik

  @PANEL-027
  Scenario: [INV] A tab számlálók a teljes state.pins tömb alapján frissülnek — nem csak az aktuális szűrőre
    Given "Only urgent" szűrő aktív (csak urgent pinek láthatók)
    Then az Open tab számlálója az összes open pint mutatja (nem csak az urgenteket)
    # renderTabs() a state.pins teljes tömbjén fut, nem filteredPins()-en
```

---

## 13. Navigáció pinek között (popup)

```gherkin
Feature: Pin navigation in popup

  Background:
    Given DEV bejelentkezve
    And egy pin detail popup nyitva van
    And legalább 3 pin létezik (szűrt listában)

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @NAV-001
  Scenario: Következő pin megnyitása → gombbal
    Given a popup navigációban a pozíció "1 / 3"
    When a → gombra kattint
    Then a következő pin detail popupja nyílik meg
    And a navigáció mutatja "2 / 3"-at

  @NAV-002
  Scenario: Előző pin megnyitása ← gombbal
    Given a popup navigációban a pozíció "2 / 3"
    When a ← gombra kattint
    Then az előző pin detail popupja nyílik meg

  @NAV-003
  Scenario: Körkörös navigáció — utolsó pinről az elsőre ugrik
    Given a popup navigációban a pozíció "3 / 3"
    When a → gombra kattint
    Then az első pin detail popupja nyílik meg

  @NAV-004
  Scenario: Körkörös navigáció — első pinről az utolsóra ugrik
    Given a popup navigációban a pozíció "1 / 3"
    When a ← gombra kattint
    Then az utolsó pin detail popupja nyílik meg

  @NAV-005
  Scenario: Navigáció gombok letiltva, ha csak 1 pin van
    Given a szűrt listában pontosan 1 pin van
    When megnyitja a pin detail popupot
    Then a ← és → gombok disabled attribútummal rendelkeznek

  @NAV-006
  Scenario: Navigáció csak a nem done pineken lép át
    Given vannak "open", "in_progress" és "done" pinek is
    When a popupban navigál
    Then a navigáció kihagyja a "done" státuszú pineket

  @NAV-007
  Scenario: Navigáció figyelembe veszi az aktív szűrőket
    Given a panel "Only urgent" szűrője aktív
    And az első popup megnyitva
    When navigál a → gombbal
    Then a következő urgent pin nyílik meg (nem urgent pinek kihagyódnak)

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @NAV-008
  Scenario: [INV] A navigáció számlálója mindig a szűrt lista alapján számol, nem az összes pin alapján
    Given 10 pin van összesen, de a szűrő után csak 3 marad
    Then a popup navigációja "X / 3"-at mutat (nem "X / 10"-et)

  @NAV-009
  Scenario: [INV] Navigáció körkörös — sosem lép "undefined" indexre
    Given a navigációs lista végén vagyunk (utolsó elem)
    When → gombra kattint
    Then a next index = 0 (nem -1 vagy lista.length)
    # next = (idx + dir + pins.length) % pins.length logika

  @NAV-010
  Scenario: [INV] Ha navigáció közben a szűrt lista megváltozik, a következő lépés az aktuális lista alapján számol
    Given popup #2 nyitva, szűrt lista: [#1, #2, #3]
    When "Only urgent" szűrőt bekapcsol (lista: [#2])
    And → gombra kattint
    Then a navigáció a friss szűrt listán alapul (filteredPins(true) fut)
```

---

``

---

## 15. Állapotmegőrzés (State persistence)

```gherkin
Feature: State persistence

  Background:
    Given DEV bejelentkezve

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @STATE-001
  Scenario: Panel nyitott állapota megmarad oldal újratöltés után
    Given a panel nyitva van
    When az oldalt újratölti
    Then a panel betöltés után nyitva marad

  @STATE-002
  Scenario: Aktív tab megmarad oldal újratöltés után
    Given a "In Progress" tab aktív
    When az oldalt újratölti
    Then a "In Progress" tab marad aktív

  @STATE-003
  Scenario: Szűrőbeállítások megmaradnak oldal újratöltés után
    Given az "Only urgent" szűrő aktív
    When az oldalt újratölti
    Then az "Only urgent" szűrő aktív marad

  @STATE-004
  Scenario: Rendezési sorrend megmarad oldal újratöltés után
    Given "Oldest pin first" rendezés aktív
    When az oldalt újratölti
    Then az "Oldest pin first" rendezés aktív marad

  @STATE-005
  Scenario: DB preferenciák felülírják a session storage-t
    Given a session storage-ban "open" tab van elmentve
    And az adatbázisban (user_meta) "done" tab van elmentve
    When az oldal betöltődik és a DB prefs betöltődnek
    Then a "done" tab aktiválódik (DB preferencia nyer)

  @STATE-006
  Scenario: Preferenciák elmentése (debounced)
    Given bejelentkezett felhasználó
    When tabváltás, szűrőváltás vagy panel toggle történik
    Then 800ms elteltével POST kérés megy a /prefs végpontra
    And a mentett preferenciák tartalmazzák az aktuális állapotot

  @STATE-007
  Scenario: Speed-dial nyitott állapota session storage-ban tárolódik
    Given a speed-dial nyitva van
    When egy másik oldalra navigál (session tart)
    Then az új oldalon a speed-dial nyitva van és a markerek láthatók

  # ── Invariánsok ────────────────────────────────────────────────────────────



  @STATE-009
  Scenario: [INV] speedDialOpen=false esetén pinsVisible is false — markerek nem láthatók
    Given a speed-dial zárva van (state.speedDialOpen = false)
    Then state.pinsVisible értéke is false
    And nincsenek .pp-rv-pin markerek a DOM-ban
    # Az initiális state-ben pinsVisible = _savedInit.speedDialOpen || false

  @STATE-010
  Scenario: [INV] A /prefs endpoint csak az engedélyezett kulcsokat menti
    When POST /wp-json/purepin/v1/prefs kérés érkezik nem engedélyezett kulccsal (pl. "adminMode": true)
    Then az extra kulcs NEM kerül mentésre
    # $allowed = ['activeTab', 'filterImportant', ...] whitelist szűrés

  @STATE-011
  Scenario: [INV] DB preferencia betöltés nem blokkolja a UI inicializálást
    Given a /prefs API hívás lassú (pl. 2 másodperc)
    When az oldal betöltődik
    Then a UI azonnal megjelenik a session storage állapotával
    And a DB prefs visszaérkezésekor frissül a lista (ha eltér)
    # loadPrefsFromDB() async, nem await-eli az init()
```

---

## 16. Viewport mismatch figyelmeztetés

```gherkin
Feature: Viewport mismatch badge

  Background:
    Given a panel nyitva van

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @VIEWPORT-001
  Scenario: Viewport mismatch figyelmeztetés megjelenik
    Given egy pin viewport_width=1440-nel készült
    And a felhasználó jelenlegi ablakszélessége 375px (mobil)
    Then a lista sorban ⚠ badge látható a pin mellett
    And a badge title attribútuma tartalmazza az eredeti viewport szélességét

  @VIEWPORT-002
  Scenario: Nincs figyelmeztetés, ha a viewport eltérés < 30%
    Given egy pin viewport_width=1200-zal készült
    And a jelenlegi ablakszélesség 1100px (8% eltérés)
    Then nem jelenik meg viewport badge

  @VIEWPORT-003
  Scenario: Nincs figyelmeztetés, ha viewport_width=0 (ismeretlen)
    Given egy pin viewport_width=0-val
    Then nem jelenik meg viewport badge

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @VIEWPORT-004
  Scenario: [INV] Viewport badge kizárólag a listában jelenik meg — a markeren nem
    Given egy viewport_mismatch-es pin
    Then a lista sorban ⚠ badge látható
    And a pin markeren NEM jelenik meg semmilyen viewport figyelmeztetés

  @VIEWPORT-005
  Scenario: [INV] A 30%-os küszöb szimmetrikus — kisebb és nagyobb ablak esetén is aktiválódik
    Given egy pin viewport_width=1000-rel készült
    When az ablak szélessége 600px (40% eltérés — kisebb ablak)
    Then ⚠ badge látható

    When az ablak szélessége 1500px (50% eltérés — nagyobb ablak)
    Then ⚠ badge látható
    # Math.abs(curVw - pinVw) / pinVw > 0.3 — abszolút értékes különbség

  @VIEWPORT-006
  Scenario: [INV] Ablak átméretezésekor a badge megjelenése dinamikusan frissül
    Given egy pin viewport_width=1440-nel, aktuális ablak 1400px (< 30% eltérés, nincs badge)
    When az ablakot 900px-re szűkíti
    Then 150ms után a lista újrarenderelődik és a ⚠ badge megjelenik
    # resize event → renderMarkers() → renderList() láncreakció
```

---

## 17. REST API — közvetlen hívások (backend validáció)

```gherkin
Feature: REST API validation

  # ── Funkcionális esetek ────────────────────────────────────────────────────

  @TEST-001
  Scenario: Nem bejelentkezett felhasználó nem érheti el a pin listát
    When GET /wp-json/purepin/v1/pins kérés megy autentikáció nélkül
    Then 401 Unauthorized választ kap

  @TEST-002
  Scenario: CLIENT nem törölhet pint
    Given CLIENT hitelesítési nonce-szal
    When DELETE /wp-json/purepin/v1/pins/1 kérés megy
    Then 403 Forbidden választ kap

  @TEST-003
  Scenario: CLIENT nem jelölhet pint olvasatlannak
    Given CLIENT hitelesítési nonce-szal
    When POST /wp-json/purepin/v1/pins/1/unread kérés megy
    Then 403 Forbidden választ kap

  @TEST-004
  Scenario: Pin létrehozása üres description-nel — backend validáció
    When POST /wp-json/purepin/v1/pins kérés megy üres description-nel
    Then 400 Bad Request választ kap
    And a hibaüzenet tartalmazza: "Description is required"

  @TEST-005
  Scenario: Pin létrehozása 1001 karakteres description-nel
    When POST /wp-json/purepin/v1/pins kérés megy 1001 kar. description-nel
    Then 400 Bad Request választ kap

  @TEST-006
  Scenario: Más felhasználó pinjének megtekintése CLIENT-ként
    Given CLIENT-A bejelentkezve
    And CLIENT-B pinjének ID-ja ismert
    When GET /wp-json/purepin/v1/pins/{CLIENT-B pin id} kérés megy
    Then 403 Forbidden választ kap

  @TEST-007
  Scenario: Nem létező pin lekérése
    When GET /wp-json/purepin/v1/pins/999999 kérés megy
    Then 404 Not Found választ kap

  @TEST-008
  Scenario: PATCH kérés üres body-val
    When PATCH /wp-json/purepin/v1/pins/1 kérés megy üres payload-dal
    Then 400 Bad Request választ kap: "No data to update"

  @TEST-009
  Scenario: CLIENT nem állíthat be "in_progress" státuszt
    Given CLIENT bejelentkezve, client_can_close=true
    When PATCH kérés megy status: "in_progress" értékkel CLIENT saját pinjére
    Then 403 Forbidden választ kap: "You can only set the status to Open or Done"

  # ── Invariánsok ────────────────────────────────────────────────────────────

  @TEST-010
  Scenario: [INV] Minden endpoint require is_user_logged_in vagy purepin_rv_can_manage — nincs publikus endpoint
    When az összes regisztrált route permission_callback értékét ellenőrzi
    Then minden route rendelkezik permission_callback-kel (nem __return_true)
    # Register_rest_route hívásonként ellenőrizendő

  @TEST-011
  Scenario: [INV] SQL injection kísérlet a page_url paraméterben nem fut le
    When GET /pins?url=' OR 1=1-- kérés érkezik
    Then az URL $wpdb->prepare()-en megy keresztül
    And nem ad vissza extra sorokat (nem kerül az injection az SQL-be)

  @TEST-012
  Scenario: [INV] A /prefs endpoint csak az engedélyezett kulcsokat írja vissza
    When GET /wp-json/purepin/v1/prefs kérés érkezik
    Then a válasz csak a whitelist-ben szereplő kulcsokat tartalmazza
    And nem tartalmaz semmilyen érzékeny felhasználói adatot

  @TEST-013
  Scenario: [INV] Nagy payload-ot tartalmazó pin-létrehozás elutasítódik
    When POST /pins kérés érkezik:
      - css_selector: 2001 karakter
    Then 400 Bad Request választ kap: "Payload too large"

    When POST /pins kérés érkezik:
      - scroll_context: 10001 karakter
    Then 400 Bad Request választ kap: "Payload too large"

    When POST /pins kérés érkezik:
      - page_url: 2001 karakter
    Then 400 Bad Request választ kap: "Payload too large"
    # Egyetlen backend validáció, amit a JS NEM ellenőriz előre

  @TEST-014
  Scenario: [INV] A REST API válaszai sosem adnak vissza WordPress belső hibát JSON helyett
    Given az adatbázis átmenetileg hibás lekérdezést produkál
    When GET /pins kérés érkezik
    Then a válasz JSON formátumú
    And nem tartalmaz PHP Warning vagy Error stack trace-t a response body-ban
```

---

## Tesztelési megjegyzések

### Szükséges teszt fixture-ök
- **DEV felhasználó:** administrator szerepkörrel
- **CLIENT-A, CLIENT-B:** subscriber szerepkörrel
- **Teszteldalak:** legalább 2 különböző URL (cross-page navigációhoz)
- **Pinek:** legalább 5-10 vegyes státusszal, szerzőkkel, urgency flag-gel

### Kritikus E2E utak (smoke test)
1. CLIENT létrehoz egy pint → DEV látja a listában és kommentel → CLIENT olvasatlannak látja
2. DEV státuszt vált "done"-ra → CLIENT "Reopen issue"-t nyom
3. Megosztott link (`?open_pin=`) automatikusan megnyitja a pint

### Automatizálásra javasolt eszközök
- **Playwright** + **@cucumber/cucumber** (natív Gherkin `.feature` fájlok futtatása)
- Alternatíva: Playwright natív `test()` API-val (Gherkin nélkül, de BDD stílusban)
- WP-specifikus: `@wordpress/e2e-test-utils-playwright` segédkönyvtár

### Invariáns-tesztelés módszertani megjegyzés
Az `[INV]` jelölésű tesztesetek nem egy konkrét felhasználói forgatókönyvet tesztelnek, hanem **biztonsági és adatkonzisztencia-garanciákat** — ezeket érdemes:
- **Biztonsági invariánsokat** (jogosultság-megkerülés, SQL injection) minden release előtt futtatni
- **UI konzisztencia-invariánsokat** (dupla popup, dupla kattintás) regressziós csomagba sorolni
- **Backend validációs invariánsokat** unit tesztekkel kiegészíteni (PHPUnit)
