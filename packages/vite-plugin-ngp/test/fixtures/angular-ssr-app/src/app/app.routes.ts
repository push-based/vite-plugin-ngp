import {Component, input} from '@angular/core';
import type {Routes} from '@angular/router';

// Home and User have a listener for event replay to queue; About has none.
@Component({selector: 'app-home', template: '<p id="page">home</p><button (click)="clicks = clicks + 1">{{ clicks }}</button>'})
class Home {
  clicks = 0;
}

@Component({selector: 'app-about', template: '<p id="page">about</p>'})
class About {}

@Component({selector: 'app-user', template: '<p id="page">user {{ id() }}</p><button (click)="clicks = clicks + 1">{{ clicks }}</button>'})
class User {
  readonly id = input('');
  clicks = 0;
}

@Component({selector: 'app-not-found', template: '<p id="page">not found</p>'})
class NotFound {}

export const routes: Routes = [
  {path: '', component: Home},
  {path: 'about', component: About},
  {path: 'user/:id', component: User},
  {path: 'client', component: Home},
  {path: 'old', redirectTo: 'about'},
  {path: '**', component: NotFound},
];
