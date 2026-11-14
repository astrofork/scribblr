// Must run before Excalidraw loads: its fonts come from the app, never a CDN.
window.EXCALIDRAW_ASSET_PATH = new URL("./", window.location.href).href;
