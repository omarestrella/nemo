const params = new URLSearchParams(window.location.search);
const challenge = params.get("challenge") || "";

const shell = document.querySelector(".shell");
const requestPanel = document.querySelector("#request-panel");
const actionPanel = document.querySelector("#action-panel");
const resultPanel = document.querySelector("#result-panel");
const details = document.querySelector("#details");
const deviceName = document.querySelector("#device-name");
const approve = document.querySelector("#approve");
const deny = document.querySelector("#deny");

const text = {
  stateLabel: document.querySelector("#state-label"),
  headline: document.querySelector("#headline"),
  message: document.querySelector("#message"),
  endpoint: document.querySelector("#endpoint"),
  expires: document.querySelector("#expires"),
  resultLabel: document.querySelector("#result-label"),
  resultHeadline: document.querySelector("#result-headline"),
  resultMessage: document.querySelector("#result-message"),
  manualFallback: document.querySelector("#manual-fallback"),
};

const openNemo = document.querySelector("#open-nemo");

initialize().catch((error) => {
  showLocked(error instanceof Error ? error.message : "Unable to load this pairing request.");
});

approve.addEventListener("click", () => complete("approve"));
deny.addEventListener("click", () => complete("deny"));

async function initialize() {
  if (!challenge) {
    showLocked("Browser pairing is only available after Nemo creates a short-lived challenge for this endpoint.");
    return;
  }

  const response = await fetch(`/v1/pairing/browser/challenge?challenge=${encodeURIComponent(challenge)}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    showLocked("This pairing request is missing, expired, or already used.");
    return;
  }

  const payload = await response.json();
  shell.dataset.state = "ready";
  text.stateLabel.textContent = "Pairing request";
  text.headline.textContent = "Pair this device with Nemo";
  text.message.hidden = true;
  text.endpoint.textContent = payload.endpoint;
  text.expires.textContent = formatTime(payload.expiresAt);
  deviceName.value = payload.deviceName || "Nemo Mac";
  details.hidden = false;
  actionPanel.hidden = false;
}

async function complete(decision) {
  approve.disabled = true;
  deny.disabled = true;
  const response = await fetch("/v1/pairing/browser/complete", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      challenge,
      decision,
      deviceName: deviceName.value,
    }),
  });

  if (!response.ok) {
    showLocked("This pairing request is no longer available. Start browser pairing again from Nemo.");
    return;
  }

  const payload = await response.json();
  actionPanel.hidden = true;
  requestPanel.hidden = true;
  details.hidden = true;
  resultPanel.hidden = false;

  if (payload.status === "denied") {
    text.resultLabel.textContent = "Pairing denied";
    text.resultHeadline.textContent = "No setup link was created";
    text.resultMessage.textContent = "Start browser pairing from Nemo when you are ready to try again.";
    openNemo.hidden = true;
    text.manualFallback.textContent = "";
    return;
  }

  text.resultLabel.textContent = "Approved";
  text.resultHeadline.textContent = "Open Nemo to finish pairing";
  text.resultMessage.textContent = `Your setup link expires at ${formatTime(payload.expiresAt)} and can be used once.`;
  openNemo.href = payload.setupUri;
  openNemo.hidden = false;
  text.manualFallback.innerHTML = `If the app does not open, use manual pairing with ID <code>${escapeHtml(payload.id)}</code> and code <code>${escapeHtml(payload.code)}</code>.`;
  setTimeout(() => {
    window.location.href = payload.setupUri;
  }, 250);
}

function showLocked(message) {
  shell.dataset.state = "locked";
  text.stateLabel.textContent = "Pairing locked";
  text.headline.textContent = "Start from Nemo";
  text.message.textContent = message;
  text.message.hidden = false;
  actionPanel.hidden = true;
  resultPanel.hidden = true;
  details.hidden = false;
  text.endpoint.textContent = window.location.origin;
  text.expires.textContent = "No active challenge";
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
