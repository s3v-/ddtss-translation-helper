browser.browserAction.onClicked.addListener((tab) => {
  console.log("Click ricevuto, invio messaggio");
  browser.tabs.sendMessage(tab.id, { action: "toggle-panel" });
});
