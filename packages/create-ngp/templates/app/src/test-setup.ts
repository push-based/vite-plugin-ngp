// Domino's DOM as globals (`Element`, `Node`, `Event`, ...), the same DOM the server renders with.
// It has to be the first import.
import '@angular/platform-server/init';
import { getTestBed } from '@angular/core/testing';
import { platformServerTesting, ServerTestingModule } from '@angular/platform-server/testing';
import { afterEach } from 'vitest';

getTestBed().initTestEnvironment(ServerTestingModule, platformServerTesting());

// Angular registers this hook itself only when `afterEach` is a global, and Vitest's globals are
// off by default. Without it, every test in a file shares one TestBed.
afterEach(() => getTestBed().resetTestingModule());
