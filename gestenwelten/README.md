# Gestenwelten

Mobile-first Creative-Coding-Seite: sechs monochrome 3D-Welten, die du mit Touch-Gesten steuerst. Die Welten wandeln sich auf Wischgeste und von selbst, wenn du eine Weile nichts tust.

Stack: Three.js 0.170 (alle Welten als Shader auf Instanced Geometry), GSAP 3.12 (Weltwechsel, Sog/Entladung, Wandlungen), Anime.js 4 (Touch-Ringe, Labels, Gestenanleitung). Kein Build-Schritt, alle Bibliotheken kommen vom CDN.

## Starten

```sh
cd gestenwelten
python3 -m http.server 8080
```

Dann `http://<lokale-ip>:8080` auf dem Handy öffnen (gleiches WLAN).

## Gesten

| Geste | Wirkung |
| --- | --- |
| Ziehen | umsehen, mit Nachlauf |
| Wischen ← → | Welt wechseln |
| Wischen ↑ ↓ | Welt wandeln (3 Zustände) |
| Spreizen / Zusammenziehen | fliegen, zoomen, Tempo |
| Zwei Finger drehen | verdrehen (Spirale, Rollen, Wirbel) |
| Tippen | Impulswelle an der Stelle |
| Halten | Sog an der Stelle, Loslassen entlädt |
| Doppeltippen | Schockwelle |

Desktop: Maus ziehen, Mausrad (Shift + Rad dreht), Pfeiltasten, Q/E, Leertaste.

## Welten

| # | Name | Wandlung |
| --- | --- | --- |
| 01 | wabe: Sechseckfeld | Hügel → Terrassen → Krater |
| 02 | sog: Kacheltunnel | Röhre → Kissen → Kasten |
| 03 | senke: Punktgitter-Trichter | Einzeltrichter → Verschmelzung → Doppeltrichter |
| 04 | würfel: Isometrie | flach → Stufen → Türme |
| 05 | schacht: Drahtkorridor | gerade → gedreht → Spirale |
| 06 | fluss: Feldlinien | Katenoid → Übergang → Helikoid |

Neue Welt: Klasse von `World` ableiten, `update`, `rig` und optional `pulse`/`hold*` überschreiben und in das `worlds`-Array in `main.js` eintragen.

`tools/build-artifact.mjs` erzeugt eine Einzeldatei-Version (JS inline, ohne Dokument-Hülle) für Hosts, die die Seite selbst einbetten.
