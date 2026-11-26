import {Component} from '@angular/core';
import {Badge} from '../../ui/src/badge';

@Component({selector: 'lib-a-panel', imports: [Badge], template: '<ui-badge label="a" />'})
export class PanelA {}
