// Afterglow -- die Stunde als grosse, feine Ziffer. Im Lauf der Stunde wandert
// ein Minutenzeiger von 12 Uhr im Uhrzeigersinn herum, die Minutenmarken
// hinter ihm erscheinen nach und nach, und die Ziffer wird in dem bereits
// ueberstrichenen Kreissektor gedimmt: nach 5 Minuten sind das 30 Grad, nach
// 45 Minuten 270 Grad. Gedimmt wird ausschliesslich die Ziffer -- Hintergrund
// und Marken bleiben unberuehrt.
//
// Konfigurierbar sind Hintergrund- und Zeigerfarbe sowie 12-/24-Stunden-
// Format. Gezeichnet wird ausschliesslich in draw().

import Poco from "commodetto/Poco";
import Message from "pebble/message";
import parseBMF from "commodetto/parseBMF";
import parseRLE from "commodetto/parseRLE";
import Resource from "Resource";

const render = new Poco(screen);

// -------------------------------------------------------------------
// Display
// -------------------------------------------------------------------
const SCREEN_WIDTH  = render.width;
const SCREEN_HEIGHT = render.height;
const CENTER_X      = SCREEN_WIDTH  >> 1;
const CENTER_Y      = SCREEN_HEIGHT >> 1;
const IS_ROUND      = SCREEN_WIDTH === SCREEN_HEIGHT;   // gabbro rund, emery rechteckig

// Halbe Breite/Hoehe und Eckenradius der Anzeigeflaeche. Auf dem runden
// Gabbro macht CORNER_RADIUS == HALF_WIDTH == HALF_HEIGHT die Randfunktion
// unten zu einem exakten Kreis -- dieselbe Formel deckt also beide
// Geraeteformen ab. Auf dem rechteckigen Emery folgt der Markenkranz einem
// abgerundeten Rechteck; das nimmt der Reihe die harten Knicke in den Ecken.
const HALF_WIDTH    = CENTER_X;
const HALF_HEIGHT   = CENTER_Y;
const CORNER_RADIUS = IS_ROUND ? HALF_WIDTH : 46;

// -------------------------------------------------------------------
// Marken und Zeiger
// -------------------------------------------------------------------
const TICK_OUTER_INSET = 10;   // Abstand der Marken-Spitze zum Displayrand

// Minutenmarken kurz und haarfein, Stundenmarken laenger und etwas kraeftiger.
// Beide enden aussen am selben Rand, damit die Reihe buendig wirkt.
const MINUTE_TICK_LENGTH    = 9;
const MINUTE_TICK_THICKNESS = 1;
const HOUR_TICK_LENGTH      = 18;
const HOUR_TICK_THICKNESS   = 3;

// Der Zeiger laeuft bis an den inneren Rand der Minutenmarken durch.
const HAND_INSET     = TICK_OUTER_INSET + MINUTE_TICK_LENGTH;
const HAND_THICKNESS = 3;
const HUB_RADIUS     = 4;

// -------------------------------------------------------------------
// Schrift
// -------------------------------------------------------------------
const DIGIT_FONT_SIZE = IS_ROUND ? 150 : 112;

// Die Stellen stehen in Slots von der Breite der "8". Auf voller Slotbreite
// stuenden sie unnoetig weit auseinander -- der Faktor rueckt sie zusammen,
// ohne die feste Rasterung aufzugeben, die die Gruppe bei wechselnder Ziffer
// ruhig haelt.
const DIGIT_TRACKING = 0.74;

// Die Zeilenhoehe der Schrift enthaelt Ober- und Unterlaengen, die Ziffern
// stehen aber nur zwischen Grundlinie und Versalhoehe. Mittig gesetzt wird
// deshalb die Versalhoehe, nicht die Zeilenbox -- sonst sitzt die Zahl
// sichtbar zu hoch. Der Wert ist das Verhaeltnis von Versalhoehe zu
// Schriftgrad bei Poppins.
const DIGIT_CAP_RATIO = 0.7;

// Poppins Thin: geometrisch-monolinear, also kreisrunde Ziffern in
// Haarlinienstaerke. Nur die Ziffern werden gerastert, siehe manifest.json --
// dort ohne "monochrome", damit png2bmp die Alpha-Ebene auf Gray4 umschaltet
// und die duennen Striche geglaettete Kanten bekommen; ohne das zerfielen sie
// bei dieser Strichstaerke zu Treppchen.
function loadFont(name, size) {
    const font = parseBMF(new Resource(`${name}-${size}.fnt`));
    font.bitmap = parseRLE(new Resource(`${name}-${size}-alpha.bm4`));
    return font;
}

const fontDigit = loadFont("Poppins-Thin", DIGIT_FONT_SIZE);

// -------------------------------------------------------------------
// Helligkeitsstufen
// -------------------------------------------------------------------
// Pebble quantisiert jede Farbe auf zwei Bit je Kanal (PocoMakeColor ist auf
// dieser Plattform GColorFromRGB). Pro Kanal gibt es also nur 0, 85, 170 und
// 255 -- als Mischanteil 0, 1/3, 2/3 und 1. Zwischenwerte fallen stumm auf
// die naechste Stufe zurueck; eine Dimmstufe bei 16 % waere schlicht
// unsichtbar. Ein Drittel ist die unterste Stufe, die sich ueberhaupt vom
// Hintergrund abhebt.
const DIGIT_DIM_MIX = 1 / 3;
const DIGIT_LIT_MIX = 1;

// -------------------------------------------------------------------
// Geometrie des Displayrands
// -------------------------------------------------------------------
const DEG = Math.PI / 180;

// Distanzfunktion eines Rechtecks mit abgerundeten Ecken, Mittelpunkt im
// Ursprung. Negativ innerhalb, positiv ausserhalb.
function roundedBoxDistance(x, y, halfWidth, halfHeight, radius) {
    const qx = Math.abs(x) - (halfWidth  - radius);
    const qy = Math.abs(y) - (halfHeight - radius);
    const ax = Math.max(qx, 0);
    const ay = Math.max(qy, 0);
    return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

// Punkt auf dem Displayrand (abzueglich `inset` Pixel) in Richtung des
// Uhrwinkels `angleDeg` (0 = 12 Uhr, im Uhrzeigersinn). Ermittelt per
// Bisektion auf der Randfunktion -- robust fuer Kreis wie abgerundetes
// Rechteck, ohne Fallunterscheidung im Zeichencode.
function boundaryPoint(angleDeg, inset) {
    const rad = angleDeg * DEG;
    const dx  = Math.sin(rad);
    const dy  = -Math.cos(rad);
    const hw  = HALF_WIDTH  - inset;
    const hh  = HALF_HEIGHT - inset;
    const cr  = Math.max(0, CORNER_RADIUS - inset);

    // Die Obergrenze muss bis in die Ecken reichen -- auf dem rechteckigen
    // Emery ist die Diagonale deutlich laenger als die halbe Kantenlaenge.
    // Mit Math.max(hw, hh) blieben die Marken nahe den Ecken unerreichbar
    // und rutschten als Nulllaenge in sich zusammen.
    let lo = 0;
    let hi = Math.sqrt(HALF_WIDTH * HALF_WIDTH + HALF_HEIGHT * HALF_HEIGHT) + 4;
    for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (roundedBoxDistance(mid * dx, mid * dy, hw, hh, cr) < 0) lo = mid; else hi = mid;
    }
    return { x: CENTER_X + lo * dx, y: CENTER_Y + lo * dy };
}

// Auf Pebble ergaenzt poco-pebble die Poco-Schnittstelle um drawLine und
// drawCircle, die direkt auf graphics_draw_line bzw. graphics_fill_radial
// gehen -- sauberer und schneller, als Striche aus Rechtecken zu stempeln.
//
// Achtung: drawCircle rechnet den Zeichenursprung fehlerhaft ein (es addiert
// poco->xOrigin auf den Argument-Zeiger statt auf den Wert). Solange
// render.origin() ungenutzt bleibt, ist der Ursprung 0 und das folgenlos.
function drawLine(x0, y0, x1, y1, thickness, color) {
    render.drawLine(Math.round(x0), Math.round(y0),
                    Math.round(x1), Math.round(y1), color, thickness);
}

// -------------------------------------------------------------------
// Sektor-Geometrie
// -------------------------------------------------------------------
// Ein Sektor bis 180 Grad ist der Schnitt zweier Halbebenen durch den
// Mittelpunkt. Fuer eine feste Bildzeile ergibt jede Halbebene ein
// dx-Intervall; der Schnitt beider ist die im Sektor liegende Strecke -- genau
// das, worauf beim Zeichnen zugeschnitten wird.
//
// Das Ergebnis steht in Modulvariablen statt in einem Rueckgabeobjekt, und die
// Winkelfunktionen werden einmal je Neuzeichnen vorberechnet statt je Zeile.
// Der XS-Heap der Uhr ist klein: legt diese Schleife pro Bildzeile auch nur
// ein Array an, bricht die Maschine mit "memory full" ab.
let spanLo = 0;
let spanHi = 0;

function sectorSpan(cosStart, sinStart, cosEnd, sinEnd, dy) {
    let lo = -Infinity;
    let hi = Infinity;

    // Sektoranfang: cosStart * dx + sinStart * dy >= 0
    if (Math.abs(cosStart) < 1e-9) {
        if (sinStart * dy < 0) return false;      // Zeile liegt ganz davor
    } else if (cosStart > 0) {
        lo = -sinStart * dy / cosStart;
    } else {
        hi = -sinStart * dy / cosStart;
    }

    // Sektorende: cosEnd * dx + sinEnd * dy <= 0
    if (Math.abs(cosEnd) < 1e-9) {
        if (sinEnd * dy > 0) return false;        // Zeile liegt ganz dahinter
    } else if (cosEnd > 0) {
        hi = Math.min(hi, -sinEnd * dy / cosEnd);
    } else {
        lo = Math.max(lo, -sinEnd * dy / cosEnd);
    }

    if (lo > hi) return false;
    spanLo = lo;
    spanHi = hi;
    return true;
}

// -------------------------------------------------------------------
// Marken -- einmalig berechnet, danach nur noch gezeichnet
// -------------------------------------------------------------------
const ticks = [];
for (let minute = 0; minute < 60; minute++) {
    const isHour    = 0 === minute % 5;
    const length    = isHour ? HOUR_TICK_LENGTH    : MINUTE_TICK_LENGTH;
    const thickness = isHour ? HOUR_TICK_THICKNESS : MINUTE_TICK_THICKNESS;
    const angle     = minute * 6;
    const outer     = boundaryPoint(angle, TICK_OUTER_INSET);
    const inner     = boundaryPoint(angle, TICK_OUTER_INSET + length);
    ticks.push({ x0: inner.x, y0: inner.y, x1: outer.x, y1: outer.y, thickness });
}

// -------------------------------------------------------------------
// Farben
// -------------------------------------------------------------------
let backgroundRGB = { r: 0,   g: 0,   b: 0   };
let pointerRGB    = { r: 255, g: 255, b: 255 };
let use24Hour     = true;

let colorBackground;
let colorPointer;
let colorDigitDim;
let colorDigitLit;

function mixColor(t) {
    return render.makeColor(
        Math.round(backgroundRGB.r + (pointerRGB.r - backgroundRGB.r) * t),
        Math.round(backgroundRGB.g + (pointerRGB.g - backgroundRGB.g) * t),
        Math.round(backgroundRGB.b + (pointerRGB.b - backgroundRGB.b) * t)
    );
}

function applyColors() {
    colorBackground = mixColor(0);
    colorPointer    = mixColor(1);
    colorDigitDim   = mixColor(DIGIT_DIM_MIX);
    colorDigitLit   = mixColor(DIGIT_LIT_MIX);
}

function rgbFromPacked(value) {
    return { r: (value >> 16) & 0xFF, g: (value >> 8) & 0xFF, b: value & 0xFF };
}

applyColors();

// -------------------------------------------------------------------
// Ziffern
// -------------------------------------------------------------------
// Ohne fuehrende Null, in beiden Zeitformaten: um 5 Uhr steht da "5", nicht
// "05". Einstellige Stunden ruecken dadurch in die Mitte, weil updateLayout
// die Slots nach der Zahl der Stellen ausrichtet.
function hourDigits(now) {
    if (use24Hour) return String(now.getHours());
    const hour = now.getHours() % 12;
    return String(0 === hour ? 12 : hour);
}

// Jede Ziffer sitzt in einem Slot von der Breite der "8", damit die Stellen
// unabhaengig von ihrer eigenen Breite ruhig stehen und eine wechselnde "1"
// die Gruppe nicht verschiebt. Einmal je Neuzeichnen vorberechnet -- besonders
// die einzelnen Zeichen, denn `digits[i]` legt jedes Mal eine neue
// Zeichenkette an, und das hundertfach je Bild sprengt den XS-Heap.
const layout = {
    slotWidth: 0,
    left:      0,
    top:       Math.round(fontDigit.ascent
                          ? CENTER_Y - fontDigit.ascent + DIGIT_CAP_RATIO * DIGIT_FONT_SIZE / 2
                          : CENTER_Y - (fontDigit.height >> 1)),
    glyphs:    [],
    x:         []
};

function updateLayout(digits) {
    layout.slotWidth = Math.round(render.getTextWidth("8", fontDigit) * DIGIT_TRACKING);
    layout.left      = CENTER_X - ((layout.slotWidth * digits.length) >> 1);
    layout.glyphs.length = 0;
    layout.x.length      = 0;

    for (let i = 0; i < digits.length; i++) {
        const glyph = digits.charAt(i);
        layout.glyphs.push(glyph);
        layout.x.push(layout.left + i * layout.slotWidth
                      + ((layout.slotWidth - render.getTextWidth(glyph, fontDigit)) >> 1));
    }
}

// Immer alle Stellen zeichnen. Nach Slots auszusortieren waere falsch: die
// Glyphen sind wegen DIGIT_TRACKING breiter als ihre Slots und ragen
// ineinander -- der obere Bogen einer "6" reicht in den Slot der Stelle davor.
function paintDigits(color) {
    for (let i = 0; i < layout.glyphs.length; i++)
        render.drawText(layout.glyphs[i], fontDigit, color, layout.x[i], layout.top);
}

// -------------------------------------------------------------------
// Die Ziffer im Sektor umfaerben
// -------------------------------------------------------------------
// Die Ziffernflaeche wird in waagerechte Streifen zerlegt und je Streifen auf
// die im Sektor liegende Strecke zugeschnitten neu gezeichnet; benachbarte
// Zeilen mit gleichem Ausschnitt werden zusammengefasst.
//
// Zugeschnitten wird ueber render.begin(rect)/render.end() und NICHT ueber
// render.clip(). Dessen JS-Wrapper reicht immer vier Argumente durch, sodass
// das argumentlose render.clip() nicht poppt, sondern einen leeren Ausschnitt
// schiebt: schon der zweite Streifen kaeme dann nicht mehr an, und alles
// danach Gezeichnete bliebe unsichtbar. begin/end dagegen legen den Ausschnitt
// in C an und raeumen ihn dort auch wieder ab. pebbledisplayEnd ist leer und
// Poco zeichnet direkt in den Bildspeicher, ein Zyklus je Streifen kostet
// also fast nichts.
let runTop = -1;
let runLo  = 0;
let runHi  = 0;

function flushRun(color, runBottom) {
    if (runTop < 0) return;
    render.begin(runLo, runTop, runHi - runLo + 1, runBottom - runTop);
    paintDigits(color);
    render.end();
    runTop = -1;
}

function paintDigitsInSector(color, startDeg, endDeg) {
    const cosStart = Math.cos(startDeg * DEG);
    const sinStart = Math.sin(startDeg * DEG);
    const cosEnd   = Math.cos(endDeg   * DEG);
    const sinEnd   = Math.sin(endDeg   * DEG);

    // Ueber die volle Bildbreite und die ganze Zeilenbox der Schrift: die
    // Glyphen ragen seitlich ueber die Slot-Box hinaus, ein engerer
    // Ausschnitt liesse genau diese Auslaeufer ungedimmt.
    const bottom = layout.top + fontDigit.height;

    runTop = -1;
    for (let y = layout.top; y < bottom; y++) {
        if (!sectorSpan(cosStart, sinStart, cosEnd, sinEnd, y - CENTER_Y)) {
            flushRun(color, y);
            continue;
        }

        const lo = Math.max(0,                Math.round(CENTER_X + spanLo));
        const hi = Math.min(SCREEN_WIDTH - 1, Math.round(CENTER_X + spanHi));
        if (hi < lo) { flushRun(color, y); continue; }

        if (runTop >= 0 && (lo !== runLo || hi !== runHi)) flushRun(color, y);
        if (runTop < 0) { runTop = y; runLo = lo; runHi = hi; }
    }
    flushRun(color, bottom);
}

// -------------------------------------------------------------------
// Zeichnen
// -------------------------------------------------------------------
function draw() {
    const now    = new Date();
    const minute = now.getMinutes();
    const swept  = minute * 6;          // seit der vollen Stunde ueberstrichener Winkel

    updateLayout(hourDigits(now));

    // Hintergrund, Marken und die Ziffer in der Farbe, die auf dem groesseren
    // der beiden Sektoren liegt.
    render.begin();
    render.fillRectangle(colorBackground, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // Die Marken bauen sich im Lauf der Stunde auf: gezeichnet wird, was die
    // Minute bereits passiert hat. Die Marke bei 12 Uhr gehoert dabei allein
    // zum Augenblick des Stundenwechsels -- sie steht nur bei :00 und ist ab
    // :01 wieder fort, sodass der Kranz jede Stunde von vorn beginnt.
    for (let i = 0 === minute ? 0 : 1; i <= minute; i++) {
        const tick = ticks[i];
        drawLine(tick.x0, tick.y0, tick.x1, tick.y1, tick.thickness, colorPointer);
    }

    paintDigits(swept > 180 ? colorDigitDim : colorDigitLit);
    render.end();

    // Das Dim-Segment. Zugeschnitten wird immer auf den kleineren der beiden
    // Sektoren -- er ist hoechstens 180 Grad breit und damit als Schnitt
    // zweier Halbebenen darstellbar.
    if (minute > 0) {
        if (swept <= 180) paintDigitsInSector(colorDigitDim, 0, swept);
        else              paintDigitsInSector(colorDigitLit, swept, 360);
    }

    // Minutenzeiger zuletzt und damit ueber allem. Er endet genau an der
    // zuletzt erschienenen Marke.
    render.begin();
    const tip = boundaryPoint(swept, HAND_INSET);
    drawLine(CENTER_X, CENTER_Y, tip.x, tip.y, HAND_THICKNESS, colorPointer);
    render.drawCircle(colorPointer, CENTER_X, CENTER_Y, HUB_RADIUS);
    render.end();
}

// -------------------------------------------------------------------
// AppMessage vom Telefon (Clay-Einstellungen)
// -------------------------------------------------------------------
// Reihenfolge muss Zeichen fuer Zeichen zu pebble.messageKeys in
// package.json passen: pebble/message bildet den Index auf 10000+n ab.
const MESSAGE_KEYS = ["backgroundColor", "pointerColor", "use24Hour"];

const message = new Message({
    input: 64,
    output: 64,
    keys: MESSAGE_KEYS,
    onReadable() {
        const received = message.read();

        const background = received.get("backgroundColor");
        const pointer    = received.get("pointerColor");
        const hourFormat = received.get("use24Hour");

        if (background !== undefined) backgroundRGB = rgbFromPacked(background);
        if (pointer    !== undefined) pointerRGB    = rgbFromPacked(pointer);
        if (hourFormat !== undefined) use24Hour     = 0 !== hourFormat;

        applyColors();
        draw();
    }
});

// -------------------------------------------------------------------
// Jede Minute neu zeichnen
// -------------------------------------------------------------------
watch.addEventListener("minutechange", draw);

draw();
