/* Copy buttons. A button[data-copy="<id>"] copies the text of the element with that id.
   Without the Clipboard API it selects the text so people can copy it by hand.
   The result is read out by the nearest [data-copy-status] live region. */
(function () {
  "use strict";

  var buttons = document.querySelectorAll("button[data-copy]");
  var timers = new WeakMap();

  function say(status, text) {
    if (!status) return;
    clearTimeout(timers.get(status));
    // Empty first, so the same words are announced again on a second press.
    status.textContent = "";
    setTimeout(function () { status.textContent = text; }, 50);
    timers.set(status, setTimeout(function () { status.textContent = ""; }, 4000));
  }

  function select(el) {
    var sel = window.getSelection && window.getSelection();
    if (!sel) return false;
    var range = document.createRange();
    range.selectNodeContents(el);
    sel.removeAllRanges();
    sel.addRange(range);
    return true;
  }

  function fallback(el, status) {
    if (!select(el)) return say(status, "Copy did not work. Select the commands and copy them by hand.");
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (e) { copied = false; }
    say(status, copied ? "Copied" : "Selected. Press Command C or Control C to copy.");
  }

  Array.prototype.forEach.call(buttons, function (button) {
    var target = document.getElementById(button.getAttribute("data-copy"));
    if (!target) return;
    var box = button.closest("[data-copy-box]");
    var status = box && box.querySelector("[data-copy-status]");
    button.hidden = false;
    button.addEventListener("click", function () {
      var text = target.textContent.replace(/\s+$/, "");
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(
          function () { say(status, "Copied"); },
          function () { fallback(target, status); }
        );
      } else {
        fallback(target, status);
      }
    });
  });
})();
