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
  title.textContent = "Open the link from your terminal";
  const message = document.createElement("p");
  message.textContent = "tm ui printed a private link that ends in #token=…. Open that full link in this browser. Don’t share it: it opens your local projects.";
  const hint = document.createElement("p");
  hint.textContent = "Closed the terminal? Run tm ui again and open the new link.";
  section.append(title, message, hint);
  root?.append(section);
}
