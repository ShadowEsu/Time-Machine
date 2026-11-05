// Runs in the head before the first paint (a classic script, so the page waits for it): every open holds the launch
// splash back, so a quick open or reload never draws it. splash.ts shows it later (splashHoldMs) if the first page is
// still not drawn. The wordmark also waits for its face, which starts loading here, so it is laid out once and never moves.
import { SPLASH_FONT, SPLASH_FONT_CLASS, SPLASH_HELD_CLASS } from "./splash.js";

const page = document.documentElement;
page.classList.add(SPLASH_HELD_CLASS);
page.classList.add(SPLASH_FONT_CLASS);
void document.fonts.load(SPLASH_FONT).finally(() => page.classList.remove(SPLASH_FONT_CLASS));
