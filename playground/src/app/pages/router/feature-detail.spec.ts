import {TestBed} from '@angular/core/testing';
import {By} from '@angular/platform-browser';
import {provideRouter, Router, withComponentInputBinding} from '@angular/router';
import {RouterTestingHarness} from '@angular/router/testing';
import {beforeEach, describe, expect, it} from 'vitest';
import {routes} from '../../routes';
import {FeatureDetail} from './feature-detail';

/** The app's real routes: /router and its :slug child both load lazily. */
describe('FeatureDetail, routed', () => {
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({providers: [provideRouter(routes, withComponentInputBinding())]});
    harness = await RouterTestingHarness.create();
  });

  /** The harness's outlet holds RouterDemo; FeatureDetail is in RouterDemo's own outlet. */
  function detail(): {component: FeatureDetail; element: HTMLElement} {
    const debug = harness.fixture.debugElement.query(By.directive(FeatureDetail));
    return {component: debug.componentInstance, element: debug.nativeElement};
  }

  it('gets its slug input from the route parameter', async () => {
    await harness.navigateByUrl('/router/signals');
    const {component, element} = detail();
    expect(component.slug()).toBe('signals');
    expect(element.querySelector('h2')!.textContent).toContain('Signals');
    expect(element.querySelector('a.open')!.getAttribute('href')).toBe('/signals');
  });

  it('links to the next feature, and follows the link', async () => {
    await harness.navigateByUrl('/router/signals');
    const next = Array.from(detail().element.querySelectorAll('a')).find((a) => a.textContent!.includes('→'))!;
    expect(next.getAttribute('href')).toBe('/router/control-flow');

    next.click();
    await harness.fixture.whenStable();

    expect(TestBed.inject(Router).url).toBe('/router/control-flow');
    expect(detail().element.querySelector('h2')!.textContent).toContain('Control flow');
  });

  it('says so when no feature matches the slug', async () => {
    await harness.navigateByUrl('/router/nope');
    expect(detail().element.querySelector('h2')!.textContent).toBe('No feature called “nope”');
  });
});
