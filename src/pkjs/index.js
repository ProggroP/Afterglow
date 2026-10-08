// PebbleKit JS: reicht die Clay-Einstellungen an die Uhr weiter. Alles, was
// angezeigt wird, ermittelt die Uhr selbst.

var Clay = require('@rebble/clay');
var clayConfig = require('./config');

var clay = new Clay(clayConfig);

// Clays automatischer Handler sendet die Einstellungen nur beim Schliessen der
// Konfigurationsseite. Das Watchface haelt sie aber nicht selbst vor -- es
// kennt nur die im Code stehenden Vorgabewerte, bis eine AppMessage kommt.
// Ohne das Folgende faende der Nutzer nach jedem Neustart der Uhr wieder
// Schwarz auf Weiss vor und muesste die Seite erneut oeffnen. Also beim
// Verbinden einmal den gespeicherten Stand nachreichen.
Pebble.addEventListener('ready', function() {
    var stored = null;
    try {
        stored = JSON.parse(localStorage.getItem('clay-settings') || 'null');
    } catch (e) {
        console.log('Gespeicherte Einstellungen nicht lesbar: ' + e.message);
    }
    if (!stored) return;   // noch nie konfiguriert: die Uhr bleibt bei ihren Vorgaben

    Pebble.sendAppMessage(
        Clay.prepareSettingsForAppMessage(stored),
        function() {},
        function(error) {
            console.log('Senden fehlgeschlagen: ' + JSON.stringify(error));
        }
    );
});
