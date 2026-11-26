import {TestBed} from '@angular/core/testing';
import {expect, test} from 'vitest';
import {PanelB} from './panel';

test('the panel renders the shared badge', () => {
  const fixture = TestBed.createComponent(PanelB);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.badge').textContent).toBe('b');
});
