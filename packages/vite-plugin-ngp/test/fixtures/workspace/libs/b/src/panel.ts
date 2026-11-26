import {Component} from '@angular/core';
import {Badge} from '../../ui/src/badge';

@Component({selector: 'lib-b-panel', imports: [Badge], template: '<ui-badge label="b" />'})
export class PanelB {}
