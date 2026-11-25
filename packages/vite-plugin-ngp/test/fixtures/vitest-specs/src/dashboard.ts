import {Component} from '@angular/core';
import {Chart} from './chart';

// Chart is used only inside @defer, so AOT loads it with a dynamic import, and Dashboard's class
// metadata is set asynchronously (ɵsetClassMetadataAsync).
@Component({selector: 'app-dashboard', imports: [Chart], template: '@defer (on immediate) { <app-chart /> } @placeholder { <span>loading</span> }'})
export class Dashboard {}
