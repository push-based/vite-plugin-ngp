import {Component, signal} from '@angular/core';
import {TestBed} from '@angular/core/testing';
import {describe, expect, it} from 'vitest';
import {Rating} from './rating';

/**
 * A host declared in the spec: ngp compiles it AOT like any other component.
 *
 * In browser mode the real pointer rests at the page's origin, over the first star, and Chromium
 * sends it a mouse move after a layout change under it. That `mouseenter` raced the hover spec's
 * synthetic events and left the first star hovered. `pointer-events: none` keeps the real pointer
 * out of hit-testing; `dispatchEvent` and `click()` don't hit-test, so the specs are unaffected.
 */
@Component({
  imports: [Rating],
  template: `<div style="pointer-events: none"><app-rating [(value)]="score" [max]="4" /></div><output>{{ score() }}</output>`,
})
class Host {
  readonly score = signal(2);
}

function stars(root: HTMLElement): HTMLButtonElement[] {
  return Array.from(root.querySelectorAll<HTMLButtonElement>('app-rating button'));
}

describe('Rating', () => {
  it('renders one button per star, following the max input', async () => {
    const fixture = TestBed.createComponent(Rating);
    fixture.componentRef.setInput('max', 3);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(3);

    fixture.componentRef.setInput('max', 7);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelectorAll('button')).toHaveLength(7);
  });

  it('writes a click back to the parent through [(value)]', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;
    expect(stars(root).map((b) => b.classList.contains('filled'))).toEqual([true, true, false, false]);

    stars(root)[3].click();
    await fixture.whenStable();

    expect(fixture.componentInstance.score()).toBe(4);
    expect(root.querySelector('output')!.textContent).toBe('4');
    expect(stars(root)[3].getAttribute('aria-pressed')).toBe('true');
    expect(stars(root)[3].getAttribute('aria-label')).toBe('4 of 4');
  });

  it('previews a rating on hover without changing the value', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root: HTMLElement = fixture.nativeElement;

    stars(root)[2].dispatchEvent(new Event('mouseenter'));
    await fixture.whenStable();
    expect(stars(root).filter((b) => b.classList.contains('filled'))).toHaveLength(3);
    expect(fixture.componentInstance.score()).toBe(2);

    stars(root)[2].dispatchEvent(new Event('mouseleave'));
    await fixture.whenStable();
    expect(stars(root).filter((b) => b.classList.contains('filled'))).toHaveLength(2);
  });

  it('accepts a TestBed template override, which recompiles the component in JIT', async () => {
    TestBed.overrideComponent(Rating, {set: {template: `<p>{{ value() }} of {{ max() }}</p>`}});
    const fixture = TestBed.createComponent(Rating);
    fixture.componentRef.setInput('value', 3);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('3 of 5');
  });
});
