import { provideBrowserGlobalErrorListeners, type ApplicationConfig } from '@angular/core';
import { provideClientHydration, withEventReplay } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { routes } from './app.routes';

/** Providers shared by the browser (main.ts) and the server (main.server.ts). */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    // The browser takes over the server-rendered DOM instead of rendering it again, and replays
    // clicks that happen before it has.
    provideClientHydration(withEventReplay()),
  ],
};
