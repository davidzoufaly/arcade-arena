# Project Future is US! 2026

Soutěž v misích pro firemní offsite, celá v prohlížeči. Mise přes kameru, jedna na hlas, pár živých výzev v místnosti a moderovaný pub quiz. Lobby jde rozjet ve dvou režimech: **týmy**, nebo **jednotlivci** (každý hráč hraje sám za sebe). Stavěné zhruba na 10 týmů, ale počet jde nastavit od 2 do 20. Skóre teče živě přes Firebase do společného scoreboardu, takže projektor ukáže výsledek hned, jak tým (nebo hráč) dohraje.

Je tu malý build krok (Vite) a jednorázové nastavení Firebase, viz SETUP.md.

---

## Mise

### Hrané v prohlížeči (na notebooku týmu)

| Mise | Vstup | Co tým dělá | Technologie |
|---|---|---|---|
| Airlock Override [Gesture Lock] | kamera (ruce) | Nejdřív 20s kalibrace: každý zvedne jednu ruku, mise spočítá velikost týmu. Pak jednou problikne náhodná sekvence gest (4 gesta na člověka, s opakováním ze šestice: otevřená dlaň, pěst, palec nahoru, palec dolů, véčko, ukazovák nahoru). Tým ji zopakuje po paměti. Jedno špatné gesto pokus shodí, na každé gesto je 10 sekund. 5 pokusů, počítá se nejlepší. | MediaPipe Gesture Recognizer |
| Human Mimic Checkpoint [Pantomime] | kamera (celé tělo) | Trefit 8 postupně těžších póz: 2 lehké, 3 střední, 3 těžké (žádné duo pózy, hráč pózuje sám). Dostat všechny geometrické kontroly nad 85 % a pak chvíli vydržet bez hnutí (1,2 / 1,5 / 2 s podle obtížnosti). Klepání výdrž vynuluje. Body jsou půl za čistotu pózy, půl za rychlost zamčení — zelená čára obkresluje rámeček kamery, jak výdrž běží. 25 s na pózu, hráči se střídají (jeden pózuje, ostatní navigují), 2 pokusy, počítá se nejlepší. | MediaPipe Pose Landmarker (heavy) |
| Gravity Corridor [Dino Dash] | kamera (ruce) | Panáček běží a tým ho ovládá otevřenými dlaněmi. Počítají se dlaně, ne prsty, takže čím víc otevřených dlaní, tím vyšší skok. Pěst misi skrčí, véčko ji nechá v klidu. Na vlnu jsou aktivní jen **2–3 hráči** a tým se ve hraní střídá: 20s kalibrace spočítá zvednuté ruce a podle nich škáluje sílu skoku, pak běží ~20s vlna s překážkami a 10s pauza na výměnu hráčů. Nekonečné, postupně zrychluje. 5 pokusů, počítá se nejlepší. | MediaPipe Hand Landmarker |
| Sonic Stabilizer [Flappy Voice] | mikrofon | Celý tým řve do mikrofonu a nadnáší objekt mezi mezerami, hlasitěji = výš. Nekonečné, zrychluje. Skóre je počet branek. 5 pokusů, počítá se nejlepší. | Web Audio (hlasitost z mikrofonu, žádný ML model) |

Čtyři mise v prohlížeči dávají skóre 0 až 100 a zapíšou ho do společného scoreboardu hned, jak je tým připojený do lobby.

### Výzvy bodované hostem

Pár výzev se hraje mimo obrazovku a body zadává host: Analog Blackout [Math No-Brain], Systems Recalibration [Math Big-Brain], Transmission Decoder [Cipher], Oracle Breach [Gandalf], Archive Recovery [Hidden Document] a Alien Glyph Activation [Draw & Guess]. K tomu živý Pub Quiz. Tyhle body host zadává ve scoreboard.html a kvíz známkuje v quiz-admin.html.

---

## Formát

### Vlastním tempem

Týmy se mezi misemi pohybují volně. Hrát může spousta týmů naráz, každý notebook má vlastní stránku mise připojenou do společné lobby a skóre teče živě na scoreboard.

- Délka: 30 až 45 minut celkem.
- Scoreboard: projektor nebo velká TV se scoreboard.html plus notebook hosta u baru nebo vchodu.
- Backend: Firebase Realtime Database (viz SETUP.md).

### Lobby a skóre

Žádné ruční „submit kódy" nejsou, skóre jde přes lobby:

1. Host otevře index.html, dá Vytvořit lobby, vybere režim (**Týmy** výchozí, nebo **Jednotlivci**) a zadá počet účastníků (výchozí 10, rozsah 2 až 20). Dostane ID lobby (třeba PS-7Q2K), admin heslo a heslo pro každý tým / hráče.
2. Tým (nebo hráč) otevře připojovací odkaz nebo index.html, zadá ID lobby, vybere sebe a potvrdí heslem. Pak přistane na games.html.
3. Čtyři mise v prohlížeči zapisují skóre 0 až 100 samy. Host zadává body za ručně bodované výzvy a známkuje pub quiz ve scoreboard.html a quiz-admin.html.
4. scoreboard.html na projektoru ukazuje žebříček živě.

### Režim: týmy vs. jednotlivci

Režim se volí při zakládání lobby a mění, jak se účastníkům říká i jak hrají kamerové mise:

- **Týmy** — víc lidí na tým, scoreboard má sloupce „Team 1, Team 2…". Mise počítají s víc hráči: Dino kalibruje počet rukou a střídá 2–3 aktivní hráče, Pantomime střídá pozéry.
- **Jednotlivci** — každý hraje sám za sebe, scoreboard ukazuje „Player 1, Player 2…". Mise se zjednoduší: Dino vynechá kalibraci rukou i pauzy na výměnu a má jednu fixní sílu skoku (a tvrdší křivku obtížnosti), Pantomime vynechá střídání hráčů. Strop je 12 hráčů.

Účastník (tým i jednotlivec) se může přejmenovat sám klikem na své jméno v topbaru.

---

## Hostitelský panel

Host řídí průběh ze tří admin stránek, všechny chtějí admin heslo: **scoreboard.html** (skóre + žebříček), **games.html** (správa misí) a **quiz-admin.html** (pub quiz). V topbaru má admin odkazy Games / Scoreboard / Quiz.

### Scoreboard (scoreboard.html)

Mimo režim úprav je to živý žebříček. Tlačítkem **Edit** se přepne do režimu úprav (**Save** / **Cancel** / **Reset**); změny se bufferují a zapíšou až tlačítkem **Save**, **Cancel** je zahodí. V režimu úprav host:

- **Zadává body** za ručně bodované výzvy — klik do buňky týmu, celé číslo od 0. Čtyři mise v prohlížeči si skóre zapisují samy, do těch host nesahá.
- **Přejmenuje týmy / hráče** — inline pole s názvem (max 24 znaků).

Sloupce a žebříček **sledují přidané mise** — ukazují se jen mise zapnuté v games.html, odebrané vypadnou. Hlavička sloupce mise nese **read-only indikátor zámku** (🔒 / 🔓); samotné zamykání se dělá v games.html. Mimo úpravy je tlačítko **Celebrate winner** — popover s vítězem a fullscreen konfety.

### Správa misí (games.html, admin)

Admin verze games.html je řídicí panel misí pro lobby:

- **Přidat / odebrat misi** — 👁 / 🚫 zapne nebo skryje misi v lobby týmů. Scoreboard i topbar počítají jen z přidaných misí.
- **🔒 / 🔓 Zámek** — zamkne/odemkne misi. Zamčená mise je v games.html prošedlá, při pokusu o vstup tým vidí „Mission locked".
- **📋 Pravidla** — text pravidel, který tým uvidí u mise. Prázdné = výchozí text z katalogu.
- **⏱ Časový limit** — limit v minutách pro ručně bodované a vlastní mise (prázdné/0 = bez limitu). Tým ho vidí v games.html a před vstupem dostane upozornění.
- **⋯ Per-team** — rozbalí podřádky a nastaví zámek / limit / pravidla pro **jeden tým** zvlášť.
- **Vlastní mise** — založ novou misi (název max 40 znaků, emoji, pravidla, volitelný limit). Každá dostane klíč `CUSTOMxxxx` a tlačítko 🗑 na smazání.

Přednost zámku: per-team > mise > výchozí (zamčeno).

### Reset

**Reset** na scoreboardu (červené, s potvrzením) smaže všechna skóre a historii lobby. Účastníci zůstanou, ale akce je nevratná a týká se všech v lobby.

### Tipy pro kamerové hry (prostředí)

Kamerové hry stojí a padají na tom, jak dobře model vidí hráče. Než hru pustíš, mrkni na pozadí a osvětlení:

- **Pantomime** (rozpoznávání pózy) — potřebuje **kontrast celé postavy vůči pozadí**. Postav notebook tak, aby za hráčem byla čistá, jednolitá plocha (zeď), ne dav lidí, okno do protisvětla nebo členitá scéna. Hráč ať má na sobě barvu odlišnou od zdi a vejde se do záběru celý (hlava až kotníky).
- **Gesture Lock** (rozpoznávání ruky) — potřebuje **kontrast ruky vůči pozadí**. Hráč ať jde blízko ke kameře, ruku drží před jednolitým pozadím (ne před vlastním obličejem nebo vzorovaným oblečením) a v dobrém světle. Protisvětlo z okna za hráčem rozpoznání ruky kazí.

Obecně: víc světla zepředu, klidné jednobarevné pozadí, žádné protisvětlo.

---

## Nastavení Pub Quizu

Pub Quiz řídí host. Aplikace nedrží ani otázky, ani správné odpovědi, jen názvy kategorií, kolik má každá otázek a které jsou bonusové. Otázky čte host nahlas a odpovědi známkuje ručně.

Nová lobby startuje se 4 kategoriemi po 8 otázkách (Category 1 až 4). Kvíz host poskládá v quiz-admin.html, chce to admin heslo:

1. **Úprava kategorií.** Přejmenuj, přidej (+ Add category) nebo odeber kategorie, změň počet otázek (− / +) a označ libovolnou otázku jako bonusovou přepínači Q1 až Qn. Úpravy se bufferují, publikují se až tlačítkem Save.
2. **Průběh.** Host čte otázky nahlas. V quiz.html tým napíše jednu odpověď na otázku v aktuální kategorii a odešle ji. Tím se kategorie zamkne (odpovědi už nejdou změnit) a odkryje se další. Vždycky jen jedna kategorie, zpátky to nejde.
3. **Známkování.** Když týmy dohrají, host v panelu Grading přepne u každé odpovědi ✓ nebo ✗, u bonusové ještě druhé, a každou kategorii odešle.

Bodování: +1 za každou správnou otázku a +1 navíc, když je správně i bonusová. Součet jde do řádku týmu na scoreboardu.

---

## AI modely

Kamerové mise běží na MediaPipe: Gesture Recognizer (Airlock Override), Pose Landmarker heavy (Human Mimic Checkpoint) a Hand Landmarker (Gravity Corridor). Runtime i modely jsou **self-hostované**, ne z CDN — `@mediapipe/tasks-vision` je z npm a wasm + `.task` modely (~60 MB) leží pod `public/mediapipe/` (gitignored, stahuje je `scripts/fetch-vision-assets.mjs` při postinstall/predev/prebuild). Runtime se lazy-loaduje až při startu mise. Detaily v SETUP.md. Sonic Stabilizer žádný model nepotřebuje, čte hlasitost z mikrofonu přes Web Audio.

### Co potřebuje notebook týmu

- Jakýkoli notebook z posledních zhruba 5 let. Integrovaná grafika stačí, dedikovaná GPU netřeba.
- Prohlížeč Chrome, Edge, Safari nebo Firefox v aktuální verzi.
- Aspoň 4 GB RAM.
- Vestavěná nebo USB kamera (kamerové mise) a funkční mikrofon (Sonic Stabilizer).
- Internet jen na první načtení každé mise. Pak je model v cache a mise běží i bez wifi.

Airlock Override a Gravity Corridor jedou na integrované grafice plynule. Human Mimic Checkpoint používá heavy model pózy, takže tam počítej s citelně nižším FPS. Na držení póz to stačí, ale je to nejnáročnější mise. Paměť na záložku prohlížeče vyjde na 200 až 400 MB, u heavy modelu víc.
