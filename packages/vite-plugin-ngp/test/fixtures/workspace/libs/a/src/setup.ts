// Domino's DOM as globals, and TestBed on the server platform, like the playground's server project.
import '@angular/platform-server/init';
import {getTestBed} from '@angular/core/testing';
import {platformServerTesting, ServerTestingModule} from '@angular/platform-server/testing';
import {afterEach} from 'vitest';

getTestBed().initTestEnvironment(ServerTestingModule, platformServerTesting());
afterEach(() => getTestBed().resetTestingModule());
