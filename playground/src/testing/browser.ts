// Components with i18n text call `$localize`. The app gets it from vite-plugin-ngp's i18n option;
// specs need the runtime loaded here.
import '@angular/localize/init';
import {getTestBed} from '@angular/core/testing';
import {BrowserTestingModule, platformBrowserTesting} from '@angular/platform-browser/testing';
import {afterEach} from 'vitest';

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting());

// Angular registers this hook itself only when `afterEach` is a global, and Vitest's globals are
// off by default. Without it, every test in a file shares one TestBed.
afterEach(() => getTestBed().resetTestingModule());
