# Poker între prieteni

Texas Hold'em No-Limit pe fise, în limba română. Gazda creează o masă, trimite linkul,
iar ceilalți intră doar cu numele (fără cont). Până la 10 jucători.

## Ce poate face gazda
- alege jocul: joc simplu sau turneu din câte jocuri vrea, cu sau fără punctaj (locul 1 = 8 p … locul 8 = 1 p)
- pornește oricând un joc sau un turneu nou, încheie jocul (clasament după fise) sau îl reîncepe de la zero
- fise de început, durata nivelurilor, structura blind-urilor, dublarea când rămân 3 jucători
- timp de gândire și timp suplimentar, pauze programate, culoarea mesei, alegerea sau amestecarea locurilor
- reintrare (rebuy) doar la jocul simplu
- intrare și ieșire oricând (efect de la mâna următoare), scoaterea unui jucător, modificarea fiselor
- toate setările se pot schimba și în timpul jocului

## Masa permanentă POKER8
Masa POKER8 are deja jucătorii adăugați (ANDREI, ANDU, CHINEZU, KOSTICA, MARIUS B, MARIUS PDM, MIRCEA, REMUS).
Gazda (CHINEZU) intră cu linkul ei personal și vede, la „Linkuri personale”, linkul fiecărui jucător (Copiază / WhatsApp).
Linkurile rămân valabile și după ce serverul repornește: masa se reface singură.

## Pentru toți jucătorii
- „Stau o mână”, „Stau deoparte” și „Revin în joc”; cine se deconectează în timpul jocului stă automat deoparte până revine
- buton de punctaj disponibil oricând, chat cu mesaje deasupra jucătorului, emoji
- poză de profil, sunete cu volum reglabil, animații

## Pornire pe calculator
Ai nevoie de Node.js 18 sau mai nou. În folder: `npm start`, apoi deschizi http://localhost:3000

## Publicare gratuită pe Render
1. Pune fișierele într-un repository pe GitHub.
2. Pe render.com: New → Web Service → alegi repository-ul.
3. Runtime: Node · Build command: `npm install` · Start command: `npm start` · Instance type: Free.

## Punctajul oficial (salvare pe GitHub)
În Render → Environment adaugă: `GITHUB_TOKEN` (cod de acces fine-grained cu „Contents: Read and write” pe acest repository)
și `GITHUB_REPO` (ex. `Chinez81/poker`). Punctajul se salvează în ramura `punctaj`, fișierul `punctaj-oficial.json`.

## Voce
Folosește STUN public. Dacă unii jucători nu se aud, adaugă un releu TURN în Render: `TURN_URL`, `TURN_USER`, `TURN_PASS`.
