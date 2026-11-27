# Kippwelt

Mobiles Ein-Daumen-Spiel im Stil der Gestenwelten mit zwei Modi:

* **Lauf** (Endlos-Runner): Die Kugel rast über einen 3×3-Balken. Zwei Spuren pro Seite (die Kanten, dazwischen eine dunkle Rinne); wer über die äußere Spur hinaus wechselt, kippt auf die nächste Seite des Balkens und die Welt dreht sich um 90°. Am Ende jedes Abschnitts knickt die Strecke ab. Dazu Sprungfelder, Sprungringe in der Luft, Schwerkraftportale, Phasenringe und ein Synth-Beat, im dem die Blöcke pulsieren. Alle 420 m wechselt das Biom (wabe, senke, schacht) und das Tempo steigt.
* **Rätsel**: Eine Kugel rollt über schwebende Blöcke, an jeder Kante kippt die Schwerkraft mit. Sammle alle Schlüssel, dann öffnet sich der Ausgang.

Die Mechaniken sind von Kula World, Subway Surfers, Temple Run und Geometry Dash inspiriert. Levels, Strecken-Generator, Grafik und die Phasenmechanik sind eigene Entwürfe.

Stack: Three.js 0.170 (Shader für Blöcke, Kugel, Hintergründe), GSAP 3.12 (Bewegungen, Kamera, Übergänge), Anime.js 4 (Daumen-Feedback, HUD, Menüs), Web Audio (Samples und Musik aus `audio/`, Synth als Rückfall). Kein Build-Schritt.

## Starten

```sh
cd kippwelt
python3 -m http.server 8080
```

## Steuerung Lauf

| Geste | Wirkung |
| --- | --- |
| Wisch links / rechts | Spur wechseln, außen über die Kante auf die nächste Seite kippen |
| Tippen oder Wisch hoch | springen; in einem Sprungring nochmal springen |
| Wisch hoch / Tippen vor hoher Wand | Boden-Dash direkt durch die Wand (wenn die Dash-Leiste voll ist) |
| In der Luft Wisch hoch | Dash: 2,4-faches Tempo, ohne Schwerkraft, bricht durch Blöcke (lädt in 2,2 s nach) |
| In der Luft Wisch runter | Stampfen: harter Fall mit Schockwelle |
| Am Boden Wisch runter | Phase wechseln (Phasenringe sind nur in ihrer Phase fest) |
| Halten | Bullet Time, solange die Fokus-Leiste reicht |
| Pfeil in der Bildmitte | in Pfeilrichtung wischen, um abzubiegen |

Hindernisse: Blöcke und Türme, Stacheln, Lücken, Schieber (gleiten über die Spuren), tiefe Laser (drüberspringen), hohe Laser (am Boden bleiben), Stampfer (fallen in eine Spur und heben sich), Bröckelboden (markierte Spur bricht kurz vorher weg), Kipp-Platten (werfen dich auf die Gegenseite), Drehringe (rotierender Blockring um den Balken mit einer Lücke), Phasenringe. Kippring um den Balken: kippt dich auf die Gegenseite. Ikosaeder: Sog, zieht 8 s lang Splitter an.

## Wandlungs-Zonen

Ab 80 m und danach alle 90 bis 170 m verwandelt sich die Welt für 170 bis 240 m: **Spirale** (Strecke, Schacht und Hintergrund drehen sich korkenzieherartig um die Bahn), **Trichter** (die Strecke stürzt vor dir in eine Senke), **Welle**, **Schlange** und **Negativ** (alles invertiert), **Wurmloch** (Feldlinien laufen zu einer Kehle um die Strecke zusammen) und **Strudel** (ein Sandfeld aus Partikeln strömt in ein schwarzes Loch, die Strecke taucht darauf zu). Im Trichter öffnet sich die Punktgitter-Senke vor dir. Die Kamera folgt der verbogenen Strecke. Jeder Biomwechsel ist ein Feldlinien-Portal, durch das du hindurchrollst. Zonen kombinieren sich (zu Beginn selten, später häufiger). Die Verformung wirkt nur vor der Kugel und glättet sich beim Näherkommen, rund um die Kugel bleibt alles flach und spielbar. Technisch ist das eine gemeinsame Vertex-Funktion `warpRun`, die alle Shader und auch die eingebauten Materialien nutzen.

## Power-ups und Einführung

Alle 170 bis 290 m liegt ein Power-up auf der Strecke, abwechselnd **Schild** (fängt den nächsten Treffer ab und verwandelt ihn in einen kurzen Dash, rettet auch eine verpasste Kurve), **Höhenflug** (6 s in drei Blöcken Höhe über allen Hindernissen, landet nur auf sicherem Boden) und **Sog** (zieht 8 s lang Splitter an). Hindernistypen werden nach und nach freigeschaltet: Blöcke, Wände und Stacheln von Anfang an, Lücken ab 30 m, Laser ab 150 m, Sprungfelder ab 200 m, Kipp-Platten ab 250 m, Stampfer und Phasenringe ab 300 m, Bröckelboden ab 350 m, Schieber ab 400 m, Kippringe ab 450 m, hohe Laser ab 500 m, Luftringe ab 550 m, Drehringe ab 600 m. Beim ersten Auftauchen eines Typs erklärt ein Hinweis, was zu tun ist (einmal pro Gerät).

## Prüfläufe

`tools/playtest-bot.js` spielt den Lauf-Modus ohne Grafik mit einer Vorausplanung über die Kollisionsregeln; `tools/playtest.cjs` startet ihn mit Playwright. Ein Tod, den das Modell nicht erwartet hat, deutet auf einen Spielbug, eine Stelle ohne überlebende Eingabefolge auf eine unfaire Strecke.

## Fairness-Regeln des Generators

Jedes Muster auf einer Seite ist ohne Dash schaffbar: eine Spur bleibt frei, das Hindernis ist überspringbar oder ein Sprungfeld trägt dich darüber. Ringförmige Wände (Phasenringe, Kippringe, Drehringe) kommen nie direkt hintereinander. Der Boden-Dash löst nur aus, wenn das erste Hindernis in deiner Spur zu hoch zum Springen ist; zerschlagene Blöcke verlängern den Dash, und über einem Loch trägt er dich bis zum nächsten Boden. Kleine Kanten bis etwa einer halben Blockhöhe steigt die Kugel hinauf.

## Effekte

Die Strecke lebt: Weit voraus fliegen die Blöcke des Balkens heran und setzen sich zusammen, Hindernisse fahren kurz vor dir mit Überschwingen aus dem Balken, die Kanten atmen im Beat und hinter dir zerbröselt der Balken ins Leere. Das Oberflächenmuster wandelt sich mit dem Biom (Ringe, Punkte, Gitter). Gemusterte Trümmerwürfel treiben um die Strecke, Speed-Lines werden mit dem Tempo länger.


Die Szene wird in eine Textur gerendert und in einem Compositing-Pass nachbearbeitet: chromatische Aberration (Grundwert steigt mit dem Tempo, Stöße bei Dash, Portal, Tod), radiale Bewegungsunschärfe, Vignette, Filmkorn und in Bullet Time ein Feedback-Puffer für Nachbilder. Portale, Sprungringe und der Tod lösen kurze automatische Bullet-Time-Momente aus. Die Kugel streckt sich in Bewegungsrichtung, staucht beim Landen und federt elastisch zurück (Squash & Stretch). Bei `prefers-reduced-motion` bleiben diese Effekte aus.

## Steuerung Rätsel (ein Daumen, überall auf dem Bildschirm)

| Geste | Wirkung |
| --- | --- |
| Wisch hoch | ein Feld rollen |
| Daumen nach dem Wisch liegen lassen | weiterrollen, seitlich schieben lenkt |
| Wisch links / rechts | 90° drehen |
| Tippen | springen: zwei Felder weit, auf Sockel hinauf oder eine Ebene tiefer |
| Wisch runter | Phase wechseln (Welt II), sonst umdrehen |
| Halten | Übersichtskamera |

Tastatur: Pfeile oder WASD, Leertaste springt, Shift zeigt die Übersicht, Esc pausiert.

## Welten

* **I · wabe** (Sechseckfeld im Hintergrund): erste kante, sprung, würfel
* **II · senke** (Gravitationstrichter folgt der Kugel): phase, turm, kehle

Phasenblöcke (gepunktet / schraffiert) sind nur in ihrer Phase fest. Stacheln sind entweder fest oder fahren im 2,4-Sekunden-Takt aus und ein. Pro Level gibt es drei Rauten: Ausgang erreicht, alle Splitter, ohne Sturz.

## Musik und Sounds

Wie bei Geometry Dash, das Songs von Newgrounds-Künstlern lizenziert, stammt die Musik von unabhängigen Künstlern, hier ausschließlich unter CC0: Komiku, Loyalty Freak Music und Soft and Furious (Free Music Archive), Effekte aus Kenneys „Digital Audio“, Jingles von Beatscribe. Jede Welt hat ihren Song, jeder Lauf startet ihn von vorn, beim Tod bricht er ab, beim Biomwechsel blendet er über, in der Bullet Time sinkt er in Tonhöhe und klingt dumpf. Details und Quellen: `audio/CREDITS.md`.

## Dateien

* `logic.js`: Spielregeln und Leveldaten, ohne DOM, in Node testbar
* `main.js`: Rendering, Animation, Eingabe, HUD und der Lauf-Modus (Abschnitt „LAUF“: Strecken-Generator, Physik, Musik)
* `tools/solve.mjs`: Breitensuche beweist, dass jedes Level lösbar ist und alle Splitter erreichbar sind (`node tools/solve.mjs`)
* `tools/build-artifact.mjs`: erzeugt eine Einzeldatei-Version

Neues Level: Eintrag in `LEVELS` in `logic.js` anlegen, danach `node tools/solve.mjs` laufen lassen.
