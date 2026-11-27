# Kippwelt

Mobiles Ein-Daumen-Spiel im Stil der Gestenwelten mit zwei Modi:

* **Lauf** (Endlos-Runner): Die Kugel rast über einen 3×3-Balken. Drei Spuren pro Seite; wer über die äußere Spur hinaus wechselt, kippt auf die nächste Seite des Balkens und die Welt dreht sich um 90°. Am Ende jedes Abschnitts knickt die Strecke ab. Dazu Sprungfelder, Sprungringe in der Luft, Schwerkraftportale, Phasenringe und ein Synth-Beat, im dem die Blöcke pulsieren. Alle 420 m wechselt das Biom (wabe, senke, schacht) und das Tempo steigt.
* **Rätsel**: Eine Kugel rollt über schwebende Blöcke, an jeder Kante kippt die Schwerkraft mit. Sammle alle Schlüssel, dann öffnet sich der Ausgang.

Die Mechaniken sind von Kula World, Subway Surfers, Temple Run und Geometry Dash inspiriert. Levels, Strecken-Generator, Grafik und die Phasenmechanik sind eigene Entwürfe.

Stack: Three.js 0.170 (Shader für Blöcke, Kugel, Hintergründe), GSAP 3.12 (Bewegungen, Kamera, Übergänge), Anime.js 4 (Daumen-Feedback, HUD, Menüs), Web Audio (Synth-Sounds). Kein Build-Schritt.

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
| Wisch runter | Phase wechseln (Phasenringe sind nur in ihrer Phase fest) |
| Halten | Zeitlupe, solange die Fokus-Leiste reicht |
| Pfeil in der Bildmitte | in Pfeilrichtung wischen, um abzubiegen |

Ring um den Balken: kippt dich auf die Gegenseite. Ikosaeder: Sog, zieht 8 s lang Splitter an.

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

## Dateien

* `logic.js`: Spielregeln und Leveldaten, ohne DOM, in Node testbar
* `main.js`: Rendering, Animation, Eingabe, HUD und der Lauf-Modus (Abschnitt „LAUF“: Strecken-Generator, Physik, Musik)
* `tools/solve.mjs`: Breitensuche beweist, dass jedes Level lösbar ist und alle Splitter erreichbar sind (`node tools/solve.mjs`)
* `tools/build-artifact.mjs`: erzeugt eine Einzeldatei-Version

Neues Level: Eintrag in `LEVELS` in `logic.js` anlegen, danach `node tools/solve.mjs` laufen lassen.
