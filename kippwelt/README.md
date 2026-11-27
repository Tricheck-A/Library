# Kippwelt

Mobiles Ein-Daumen-Spiel im Stil der Gestenwelten: Eine Kugel rollt über schwebende Blöcke, an jeder Kante kippt die Schwerkraft mit. Sammle alle Schlüssel, dann öffnet sich der Ausgang. Die Spielmechanik ist vom PS1-Klassiker Kula World inspiriert. Levels, Grafik und die Phasenmechanik sind eigene Entwürfe.

Stack: Three.js 0.170 (Shader für Blöcke, Kugel, Hintergründe), GSAP 3.12 (Bewegungen, Kamera, Übergänge), Anime.js 4 (Daumen-Feedback, HUD, Menüs), Web Audio (Synth-Sounds). Kein Build-Schritt.

## Starten

```sh
cd kippwelt
python3 -m http.server 8080
```

## Steuerung (ein Daumen, überall auf dem Bildschirm)

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
* `main.js`: Rendering, Animation, Eingabe, HUD
* `tools/solve.mjs`: Breitensuche beweist, dass jedes Level lösbar ist und alle Splitter erreichbar sind (`node tools/solve.mjs`)
* `tools/build-artifact.mjs`: erzeugt eine Einzeldatei-Version

Neues Level: Eintrag in `LEVELS` in `logic.js` anlegen, danach `node tools/solve.mjs` laufen lassen.
