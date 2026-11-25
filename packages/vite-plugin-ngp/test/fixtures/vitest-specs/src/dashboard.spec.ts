// A component whose only use of Chart is inside @defer. Under AOT Chart is a dynamic import, and
// Dashboard's metadata only resolves in `compileComponents()`; under JIT it was there at once.
import {DeferBlockBehavior, DeferBlockState, TestBed} from '@angular/core/testing';
import {expect, test} from 'vitest';
import {Dashboard} from './dashboard';

test('an override works without compileComponents()', () => {
  TestBed.overrideComponent(Dashboard, {set: {template: '<span>overridden</span>'}});
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  expect(fixture.nativeElement.textContent).toBe('overridden');
});

test('the decorator metadata is there synchronously, as ng-mocks reads it', () => {
  const annotations = (Dashboard as any).decorators ?? (Dashboard as any).__annotations__;
  expect(annotations).toBeDefined();
});

test('the @defer block can still be stepped through', async () => {
  TestBed.configureTestingModule({deferBlockBehavior: DeferBlockBehavior.Manual});
  const fixture = TestBed.createComponent(Dashboard);
  fixture.detectChanges();
  const [block] = await fixture.getDeferBlocks();
  await block.render(DeferBlockState.Placeholder);
  expect(fixture.nativeElement.textContent).toBe('loading');
  await block.render(DeferBlockState.Complete);
  expect(fixture.nativeElement.textContent).toBe('chart');
});
