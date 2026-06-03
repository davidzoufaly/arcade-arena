# PS Offsite 2026

Týmová herní soutěž pro firemní offsite, celá v prohlížeči. Hry přes kameru, jedna na hlas, pár živých výzev v místnosti a moderovaný pub quiz. Stavěné zhruba na 10 týmů, ale počet jde nastavit od 2 do 20. Skóre teče živě přes Firebase do společného scoreboardu, takže projektor ukáže výsledek hned, jak tým dohraje.

Je tu malý build krok (Vite) a jednorázové nastavení Firebase, viz SETUP.md.

---

## Hry

### Hrané v prohlížeči (na notebooku týmu)

| Hra | Vstup | Co tým dělá | Technologie |
|---|---|---|---|
| Airlock Override | kamera (ruce) | Nejdřív 20s kalibrace: každý zvedne jednu ruku, hra spočítá velikost týmu. Pak jednou problikne náhodná sekvence gest (4 gesta na člověka, s opakováním ze šestice: otevřená dlaň, pěst, palec nahoru, palec dolů, véčko, ukazovák nahoru). Tým ji zopakuje po paměti. Jedno špatné gesto pokus shodí, na každé gesto je 10 sekund. 5 pokusů, počítá se nejlepší. | MediaPipe Gesture Recognizer |
| Human Mimic Checkpoint | kamera (celé tělo) | Trefit 8 postupně těžších póz: 2 lehké, 2 střední, 2 těžké a na konec 2 duo pózy, kde musí být v záběru druhý člověk. Dostat všechny geometrické kontroly nad 85 % a pak chvíli vydržet bez hnutí (1,2 / 1,5 / 2 s podle obtížnosti). Klepání výdrž vynuluje. 25 s na pózu, 2 pokusy, počítá se nejlepší. | MediaPipe Pose Landmarker (heavy) |
| Gravity Corridor | kamera (ruce) | Panáček běží a tým ho ovládá otevřenými dlaněmi. Počítají se dlaně, ne prsty, takže čím víc otevřených dlaní, tím vyšší skok. Pěst hru skrčí, véčko ji nechá v klidu. 20s kalibrace spočítá zvednuté ruce a podle velikosti týmu škáluje sílu skoku. Nekonečné, postupně zrychluje. | MediaPipe Hand Landmarker |
| Sonic Stabilizer | mikrofon | Celý tým řve do mikrofonu a nadnáší objekt mezi mezerami, hlasitěji = výš. Nekonečné, zrychluje. Skóre je počet branek. 5 pokusů, počítá se nejlepší. | Web Audio (hlasitost z mikrofonu, žádný ML model) |

Čtyři hry v prohlížeči dávají skóre 0 až 100 a zapíšou ho do společného scoreboardu hned, jak je tým připojený do lobby.

### Výzvy bodované hostem

Pár výzev se hraje mimo obrazovku a body zadává host: Analog Blackout, Systems Recalibration, Transmission Decoder, Oracle Breach, Archive Recovery a Alien Glyph Activation. K tomu živý Pub Quiz. Tyhle body host zadává ve scoreboard.html a kvíz známkuje v quiz-admin.html.

---

## AI modely

Modely pro kameru (MediaPipe) se stahují z veřejných CDN až za běhu, v repu nejsou. Sonic Stabilizer žádný model nepotřebuje, čte hlasitost z mikrofonu přes Web Audio.

### Co potřebuje notebook týmu

- Jakýkoli notebook z posledních zhruba 5 let. Integrovaná grafika stačí, dedikovaná GPU netřeba.
- Prohlížeč Chrome, Edge, Safari nebo Firefox v aktuální verzi.
- Aspoň 4 GB RAM.
- Vestavěná nebo USB kamera (kamerové hry) a funkční mikrofon (Sonic Stabilizer).
- Internet jen na první načtení každé hry. Pak je model v cache a hra běží i bez wifi.

Airlock Override a Gravity Corridor jedou na integrované grafice plynule. Human Mimic Checkpoint používá heavy model pózy, takže tam počítej s citelně nižším FPS. Na držení póz to stačí, ale je to nejnáročnější hra. Paměť na záložku prohlížeče vyjde na 200 až 400 MB, u heavy modelu víc.

---

## Formát

### Vlastním tempem

Týmy se mezi hrami pohybují volně. Hrát může spousta týmů naráz, každý notebook má vlastní stránku hry připojenou do společné lobby a skóre teče živě na scoreboard.

- Délka: 30 až 45 minut celkem.
- Scoreboard: projektor nebo velká TV se scoreboard.html plus notebook hosta u baru nebo vchodu.
- Backend: Firebase Realtime Database (viz SETUP.md).

### Lobby a skóre

Žádné ruční „submit kódy" nejsou, skóre jde přes lobby:

1. Host otevře index.html, dá Vytvořit lobby a zadá počet týmů (výchozí 10, rozsah 2 až 20). Dostane ID lobby (třeba PS-7Q2K), admin heslo a heslo pro každý tým.
2. Tým otevře připojovací odkaz nebo index.html, zadá ID lobby, vybere svůj tým a potvrdí týmovým heslem. Pak přistane na games.html.
3. Čtyři hry v prohlížeči zapisují skóre 0 až 100 samy. Host zadává body za ručně bodované výzvy a známkuje pub quiz ve scoreboard.html a quiz-admin.html.
4. scoreboard.html na projektoru ukazuje žebříček živě.

---

## Hostitelský panel (scoreboard.html)

Host řídí celý průběh ze scoreboard.html, chce to admin heslo. Mimo režim úprav je to jen živý žebříček; tlačítkem **Edit** se přepne do režimu úprav a objeví se **Save**, **Cancel**, **Lock all** a **Reset**. Všechny změny se bufferují a zapíšou se až tlačítkem **Save**, **Cancel** je zahodí.

### Zamknutí a odemknutí her

Každá hra je pro tým ve výchozím stavu **zamčená** — host ji musí odemknout, aby se dala hrát. Zamčená hra je v games.html prošedlá a needitovatelná, při pokusu o vstup tým vidí stránku „Game locked". To řídí, kdy se která hra otevře.

- 🔒 / 🔓 v hlavičce hry zamkne/odemkne hru pro **všechny týmy** naráz.
- 🔒 / 🔓 v buňce skóre zamkne/odemkne hru pro **jeden tým**.
- **Lock all** / **Unlock all** přepne **všechny hry** najednou a smaže dílčí výjimky.

Přednost: buňka > hra > globální > výchozí (zamčeno).

### Body za ručně bodované výzvy

U výzev bodovaných hostem (Analog Blackout, Systems Recalibration, Transmission Decoder, Oracle Breach, Archive Recovery, Alien Glyph Activation) host v režimu úprav klikne do buňky týmu a zapíše skóre (celé číslo od 0). Čtyři hry v prohlížeči si skóre zapisují samy, do těch host nesahá.

### Časový limit (⏱) a pravidla (📋)

U ručně bodovaných výzev a kvízu jsou v režimu úprav dvě tlačítka:

- **⏱ Time limit** — modální okno, zadá se limit v minutách (prázdné nebo 0 = bez limitu). Limit jde nastavit pro celou hru, nebo jen pro jeden tým. Tým ho vidí v games.html a před vstupem do časované hry dostane upozornění.
- **📋 Rules** — modální okno s textem pravidel, který tým uvidí u dané výzvy. Prázdné pole spadne zpět na výchozí text z katalogu. Taky pro celou hru, nebo jeden tým.

### Reset

**Reset** (červené, s potvrzením) smaže všechna skóre a historii lobby. Týmy zůstanou, ale akce je nevratná a týká se všech v lobby.

---

## Nastavení Pub Quizu

Pub Quiz řídí host. Aplikace nedrží ani otázky, ani správné odpovědi, jen názvy kategorií, kolik má každá otázek a které jsou bonusové. Otázky čte host nahlas a odpovědi známkuje ručně.

Nová lobby startuje se 4 kategoriemi po 8 otázkách (Category 1 až 4). Kvíz host poskládá v quiz-admin.html, chce to admin heslo:

1. **Úprava kategorií.** Přejmenuj, přidej (+ Add category) nebo odeber kategorie, změň počet otázek (− / +) a označ libovolnou otázku jako bonusovou přepínači Q1 až Qn. Úpravy se bufferují, publikují se až tlačítkem Save.
2. **Průběh.** Host čte otázky nahlas. V quiz.html tým napíše jednu odpověď na otázku v aktuální kategorii a odešle ji. Tím se kategorie zamkne (odpovědi už nejdou změnit) a odkryje se další. Vždycky jen jedna kategorie, zpátky to nejde.
3. **Známkování.** Když týmy dohrají, host v panelu Grading přepne u každé odpovědi ✓ nebo ✗, u bonusové ještě druhé, a každou kategorii odešle.

Bodování: +1 za každou správnou otázku a +1 navíc, když je správně i bonusová. Součet jde do řádku týmu na scoreboardu.

---

## Licence

MIT. Vzniklo pro interní offsite, ale klidně si to forkni a uprav.
