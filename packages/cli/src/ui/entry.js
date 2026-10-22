import { installBrowserBridge } from "./bridge.ts";

if (installBrowserBridge()) {
  // Separate module ensures window.tm exists before any shared renderer code executes.
  await import("./renderer/index.js");
} else {
  document.getElementById("splash")?.remove();
  const root = document.getElementById("root");
  const section = document.createElement("main");
  section.className = "browser-connect";
  const title = document.createElement("h1");
  title.textContent = "Connect to your local Time Machine";
  const message = document.createElement("p");
  message.textContent = "Open the full URL printed by tm ui in your terminal, including the #token fragment. This private link connects this browser to your local projects. Do not share it.";
  const hint = document.createElement("p");
  hint.textContent = "If the terminal was closed, run tm ui again and use the new URL. Your saved projects and history stay local.";
  section.append(title, message, hint);
  root?.append(section);
}
