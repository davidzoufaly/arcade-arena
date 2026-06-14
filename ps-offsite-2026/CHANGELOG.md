# Changelog

## 2026-06-14

### Novinky

- Lobby má dva režimy: týmy, nebo jednotlivci. Volí se při zakládání.
- V režimu jednotlivců hraje každý sám. Strop je 12 hráčů.
- Nová admin stránka games.html spravuje mise pro celé lobby.
- Host přidává a odebírá mise. Skryté mise se v lobby neukážou.
- Host zamyká a odemyká mise. Globálně i pro jeden tým.
- Host nastavuje časový limit a pravidla misí. Globálně i per-team.
- Host zakládá vlastní mise. Název, emoji, pravidla, volitelný limit.
- Týmy i hráči se přejmenují sami klikem na jméno v topbaru.
- Host přejmenuje týmy ze scoreboardu v režimu úprav.
- Scoreboard má tlačítko Celebrate winner. Popover s vítězem a konfety.

### Změny

- Scoreboard ukazuje jen přidané mise. Sloupce, žebříček i počítadla.
- Zamykání, limity a pravidla se přesunuly ze scoreboardu do games.html.
- Scoreboard ukazuje stav zámku misí, ale needituje ho.
- Topbar má pro admina odkazy Games / Scoreboard / Quiz.
- Topbar počítá body jen z přidaných misí.
- Portál přejmenován na obecný Arcade Arena.

### Mise

- Pantomime zrušil duo pózy. Zbývá 8 sólo póz: 2 lehké, 3 střední, 3 těžké.
- Pantomime přidal zelený indikátor výdrže po obvodu kamery.
- Dino jede po vlnách. ~20s hraní, pak 10s pauza na výměnu hráčů.
- Dino má na vlnu aktivní jen 2–3 hráče. Kalibrují jen oni.

### Technické

- MediaPipe runtime i modely jsou self-hostované, ne z CDN.
- Modely stahuje scripts/fetch-vision-assets.mjs při install / dev / build.
- Runtime se lazy-loaduje až při startu mise. Nezdržuje načtení stránky.

## Základ (před 2026-06-14)

### Mise v prohlížeči

- Airlock Override (Gesture Lock). Kamera čte ruce. Tým opakuje sekvenci gest po paměti.
- Human Mimic Checkpoint (Pantomime). Kamera čte tělo. Tým trefuje pózy.
- Gravity Corridor (Dino Dash). Kamera čte ruce. Tým skáče s panáčkem.
- Sonic Stabilizer (Flappy Voice). Mikrofon. Tým křikem nadnáší objekt.
- Každá mise dává 0 až 100 bodů. Zapisuje se sama do scoreboardu.

### Výzvy bodované hostem

- Math No-Brain, Math Big-Brain, Cipher, Gandalf, Hidden Document, Draw & Guess.
- Hrají se mimo obrazovku. Body zadává host.

### Lobby a skóre

- Host založí lobby. Zadá počet týmů (2 až 20).
- Dostane ID lobby, admin heslo a heslo pro každý tým.
- Tým se připojí přes ID a týmové heslo.
- Skóre teče živě přes Firebase do společného scoreboardu.
- Žádné ruční submit kódy. Vše jde přes lobby.

### Hostitelský panel

- Scoreboard.html ukazuje žebříček živě. Vhodné na projektor.
- Host zadává body za ručně bodované výzvy.
- Reset smaže všechna skóre a historii lobby.

### Pub Quiz

- Host řídí kvíz v quiz-admin.html.
- Aplikace drží jen kategorie, počty otázek a bonusy. Ne otázky a odpovědi.
- Host čte otázky nahlas. Týmy píšou odpovědi v quiz.html.
- Vždy jen jedna kategorie. Zpět to nejde.
- Host známkuje ✓ / ✗. +1 za správnou, +1 za bonus.

### Technické

- Celé v prohlížeči. Build přes Vite.
- Jednorázové nastavení Firebase. Viz SETUP.md.
- Stačí běžný notebook z posledních ~5 let a aktuální prohlížeč.
