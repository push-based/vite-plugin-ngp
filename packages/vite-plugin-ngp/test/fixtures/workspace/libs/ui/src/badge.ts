import {Component, input} from '@angular/core';

// A library both projects import, outside either one's folder.
@Component({selector: 'ui-badge', templateUrl: './badge.html'})
export class Badge {
  readonly label = input('');
}
