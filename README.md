# Poker între prieteni

Texas Hold'em No-Limit pe fise, în limba română. Gazda creează o masă, trimite linkul,
iar ceilalți intră doar cu numele (fără cont). Până la 10 jucători.

## Ce poate seta gazda
- fisele de la început (implicit 50.000)
- durata unui nivel de blind (implicit 6 minute) și structura nivelurilor
- dublarea blind-urilor când rămân 3 jucători (sau alt număr)
- timpul de gândire și pauza dintre mâini
- afișarea punctelor după regulament (locul 1 = 8 p … locul 8 = 1 p)
- pauză în timpul jocului, scoaterea unui jucător, schimbarea gazdei

## Pornire pe calculator
Ai nevoie de Node.js 18 sau mai nou. În folder: `npm start`, apoi deschizi http://localhost:3000

## Publicare gratuită pe Render
1. Pune fișierele într-un repository pe GitHub.
2. Pe render.com: New → Web Service → alegi repository-ul.
3. Runtime: Node · Build command: `npm install` · Start command: `npm start` · Instance type: Free.
