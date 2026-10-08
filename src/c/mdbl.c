// Einstiegspunkt der Watchapp. Die eigentliche Logik liegt in
// src/embeddedjs/main.js; hier wird nur die XS-Maschine gestartet.

#include <pebble.h>

int main(void) {
  Window *window = window_create();
  window_stack_push(window, true);

  moddable_createMachine(NULL);

  window_destroy(window);
}
