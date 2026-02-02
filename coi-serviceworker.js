/*! coi-serviceworker v0.1.7 - Guido Zuidhof and contributors, licensed under MIT */
/*
 * Cross-Origin Isolation Service Worker
 * Enables SharedArrayBuffer on GitHub Pages by adding COOP/COEP headers
 * Based on: https://github.com/gzuidhof/coi-serviceworker
 */
let coepCredentialless = false;
if (typeof window === 'undefined') {
  self.addEventListener("install", () => self.skipWaiting());
  self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

  self.addEventListener("message", (ev) => {
    if (!ev.data) {
      return;
    } else if (ev.data.type === "deregister") {
      self.registration
        .unregister()
        .then(() => {
          return self.clients.matchAll();
        })
        .then((clients) => {
          clients.forEach((client) => client.navigate(client.url));
        });
    } else if (ev.data.type === "coepCredentialless") {
      coepCredentialless = ev.data.value;
    }
  });

  self.addEventListener("fetch", function (event) {
    const r = event.request;
    if (r.cache === "only-if-cached" && r.mode !== "same-origin") {
      return;
    }

    const request =
      coepCredentialless && r.mode === "no-cors"
        ? new Request(r, {
            credentials: "omit",
          })
        : r;

    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 0) {
            return response;
          }

          const newHeaders = new Headers(response.headers);
          newHeaders.set("Cross-Origin-Embedder-Policy",
            coepCredentialless ? "credentialless" : "require-corp"
          );
          newHeaders.set("Cross-Origin-Opener-Policy", "same-origin");

          return new Response(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: newHeaders,
          });
        })
        .catch((e) => console.error(e))
    );
  });
} else {
  (() => {
    const reloadedByCOI = window.sessionStorage.getItem("coiReloadedByCOI");
    window.sessionStorage.removeItem("coiReloadedByCOI");
    const coepDegrading = reloadedByCOI === "coepdegrade";

    // Check if already cross-origin isolated
    if (window.crossOriginIsolated !== false || reloadedByCOI) {
      return;
    }

    // Check if we can use credentialless mode (Chrome 96+)
    const hasCoepCredentialless = window.chrome !== undefined ||
      (navigator.userAgent.indexOf("Chrome") > -1 &&
       navigator.userAgent.indexOf("Edge") === -1);

    if (!window.isSecureContext) {
      console.log("COOP/COEP Service Worker: Not in a secure context, skipping.");
      return;
    }

    // Register the service worker
    navigator.serviceWorker
      .register(window.document.currentScript.src)
      .then((registration) => {
        if (registration.active && !navigator.serviceWorker.controller) {
          window.sessionStorage.setItem("coiReloadedByCOI", "reload");
          window.location.reload();
        } else if (registration.installing) {
          registration.installing.addEventListener("statechange", function () {
            if (this.state === "activated") {
              window.sessionStorage.setItem("coiReloadedByCOI", "reload");
              window.location.reload();
            }
          });
        }

        // Enable credentialless mode if available
        if (hasCoepCredentialless && !coepDegrading && registration.active) {
          registration.active.postMessage({
            type: "coepCredentialless",
            value: true,
          });
        }
      })
      .catch((e) => {
        console.error("COOP/COEP Service Worker failed to register:", e);
      });
  })();
}
