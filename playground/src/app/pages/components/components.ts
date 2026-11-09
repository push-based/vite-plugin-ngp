import {CurrencyPipe, DatePipe, PercentPipe, TitleCasePipe} from '@angular/common';
import {ChangeDetectionStrategy, Component, computed, inject, signal} from '@angular/core';
import {ToastService} from '../../core/toast';
import {Highlight} from '../../shared/highlight';
import {RelativeTimePipe} from '../../shared/relative-time';
import {Card} from '../../ui/card';
import {PageHeader} from '../../ui/page-header';
import {Rating} from './rating';
import {Swatches} from './swatches';

@Component({
  selector: 'app-components',
  imports: [Card, PageHeader, Rating, Swatches, Highlight, CurrencyPipe, DatePipe, PercentPipe, TitleCasePipe, RelativeTimePipe],
  templateUrl: './components.html',
  styleUrl: './components.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Components {
  private readonly toasts = inject(ToastService);

  protected readonly rating = signal(4);
  protected readonly ratingLabel = computed(() => ['', 'Broken', 'Meh', 'Fine', 'Good', 'Superb'][this.rating()]);

  protected readonly colors = ['#c2185b', '#7b3fe4', '#1f8a5b', '#e08a00', '#0b7bd6'];
  protected readonly color = signal(this.colors[1]);

  protected readonly price = signal(1249.5);
  protected readonly ratio = signal(0.734);
  protected readonly released = new Date(2026, 9, 8);
  protected readonly phrase = signal('the hybrid preprocessor');

  protected readonly features = [
    {name: 'Analyzer', detail: 'Rust, on oxc', color: 'var(--accent-soft)'},
    {name: 'Code generator', detail: "Angular's template compiler", color: 'var(--accent-2-soft)'},
    {name: 'Linker', detail: 'oxc, for node_modules', color: 'var(--success-soft)'},
  ];

  protected pickColor(color: string): void {
    this.color.set(color);
    this.toasts.show(`Picked ${color} through an output()`, 'success');
  }

  protected notify(): void {
    this.toasts.show('Hello from ToastService, injected with inject()');
  }
}
