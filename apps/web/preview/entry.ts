// Browser preview: the real app renderer with the engine swapped for an in-memory demo.
import { start } from "../src/renderer/app.js";
import { FakeEngine, previewStory } from "./fake.js";

// ?state=works, ?state=unchecked or ?state=new tell a different story. The default is the broken demo.
// ?state=ask-off, no-key, ask-error or no-vercel show the opt-in features in that state.
// ?open=palette opens the command palette once the first page is drawn, so a screenshot can show it from a URL alone.
const params = new URLSearchParams(location.search);
const story = previewStory(params.get("state"));
const fake = new FakeEngine(story.scenario, story.features);

void start(fake, { preview: true }).then(() => {
  if (params.get("open") !== "palette") return;
  const button = [...document.querySelectorAll<HTMLElement>('[data-act="palette"]')].find((b) => b.getClientRects().length);
  button?.click();
});
