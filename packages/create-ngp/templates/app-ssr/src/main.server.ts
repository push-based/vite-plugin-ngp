import { mergeApplicationConfig } from '@angular/core';
import { bootstrapApplication, type BootstrapContext } from '@angular/platform-browser';
import { provideServerRendering, renderApplication } from '@angular/platform-server';
import { App } from './app/app';
import { appConfig } from './app/app.config';

const serverConfig = mergeApplicationConfig(appConfig, { providers: [provideServerRendering()] });

/**
 * Renders one page. vite-plugin-ngp calls this for every page request in dev, and server.mjs
 * calls the built copy in production. `document` is index.html, already transformed by Vite.
 */
export default function render(url: string, document: string): Promise<string> {
  return renderApplication(
    (context: BootstrapContext) => bootstrapApplication(App, serverConfig, context),
    {
      document,
      url,
      // Angular renders only URLs on hosts listed here. Add the hosts your server answers for.
      allowedHosts: ['localhost'],
    },
  );
}
