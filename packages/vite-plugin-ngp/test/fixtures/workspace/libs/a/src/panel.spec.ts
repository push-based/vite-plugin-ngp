import {TestBed} from '@angular/core/testing';
import {expect, test} from 'vitest';
import {PanelA} from './panel';

test('the panel renders the shared badge', () => {
  const fixture = TestBed.createComponent(PanelA);
  fixture.detectChanges();
  expect(fixture.nativeElement.querySelector('.badge').textContent).toBe('a');
});
